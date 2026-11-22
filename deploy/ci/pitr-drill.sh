#!/usr/bin/env bash
# 恢复到任意时间点的演练（ADR 0105）：只用容器，在本机（CI 的 runner 或开发机）上用服务器上同一份 compose.yml 和
# bin/ 脚本跑一遍。不需要构建应用镜像：只起数据库、临时恢复用的数据库、异地备份（restic），外加一个代替对象存储的
# S3 兼容服务（deploy/ci/compose.pitr-drill.yml）。
#
# 依次验证：
#   1. 数据库开着 WAL 归档；还没有基础备份时，状态检查报异常
#   2. 写数据 → 基础备份（没配异地时明确说「只在本机」）→ 再写 → 记下时间 T1 → 再写、删一行 → 记下 T2 → 再写
#   3. 恢复到 T1、T2（T2 用东京时间写）、latest：临时数据库里正好是那一刻的那些行；正在运行的数据库一行没变
#   4. 不带时区、未来的时间、早于最早基础备份的时间都被拒绝，什么都不动；最后一次提交之后的时间给出明确提示
#   5. 异地：只配一部分时报错；配齐后基础备份顺带同步到对象存储，状态检查正常；口令不对读不了异地仓库
#   6. 整台服务器没了：删掉数据库和 pitr 两个数据卷，重新起一个空数据库并做一次基础备份 → 从异地取回 →
#      恢复到 T3、恢复旧实例的 latest，行数正好；新旧实例的 WAL 各在各的目录，新实例照常归档
#
# 用法：deploy/ci/pitr-drill.sh
# 需要 Docker（Compose 2.25 以上）。这里出现的「密码」「密钥」全部是明显的占位值，容器和数据卷结束即删除。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d)"
root_dir="$work_dir/root"
release_dir="$root_dir/releases/drill"
bin="$release_dir/bin"

export DEPLOY_COMPOSE_OVERRIDE="$repo_root/deploy/ci/compose.pitr-drill.yml"

step() { printf '\n=== %s ===\n' "$*"; }
fail() {
  printf '演练失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 && -x "$bin/compose.sh" ]]; then
    "$bin/compose.sh" ps --all || true
    "$bin/compose.sh" logs --tail 40 db pitr-restore || true
  fi
  docker compose --project-name nozomi-ci down --volumes --remove-orphans >/dev/null 2>&1 || true
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

compose() { "$bin/compose.sh" "$@"; }
live() { compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align -c "$1"; }
scratch() { compose exec -T pitr-restore psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align -c "$1"; }
rows_of() { "$1" "select string_agg(id::text, ',' order by id) from drill"; }
# 数据库自己的时钟（UTC，微秒）
now_utc() { live "select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || 'Z'"; }
# 让当前的 WAL 立即归档，并等归档完（模拟「过了一会儿」）
flush_wal() {
  live 'select pg_switch_wal()' >/dev/null
  local waited=0
  until [[ "$(live "select count(*) from pg_ls_archive_statusdir() where name like '%.ready'")" == "0" ]]; do
    ((waited < 60)) || fail "WAL 60 秒内没有归档完"
    sleep 1
    waited=$((waited + 1))
  done
}
# 执行一条命令，期望它失败，并且输出里有指定的文字
expect_failure() {
  local expected="$1" output
  shift
  if output="$("$@" 2>&1)"; then fail "应当失败却成功了：$*"; fi
  grep -qF -- "$expected" <<<"$output" || fail "失败的原因不对（应包含「$expected」）：$output"
}
restore_and_check() {
  local target="$1" expected="$2" actual
  "$bin/pitr-restore.sh" "$target"
  actual="$(rows_of scratch)"
  [[ "$actual" == "$expected" ]] || fail "恢复到 $target：临时数据库里应正好是 [$expected]，实际是 [$actual]"
  printf '恢复到 %s：[%s]，符合预期\n' "$target" "$actual"
}

step "准备目录（相当于服务器上的 /opt/nozomi/<环境>/，只放演练用得到的东西）"
mkdir -p "$release_dir" "$root_dir/backups"
tar -C "$repo_root/deploy" -cf - compose.yml compose.behind-proxy.yml Caddyfile bin | tar -xf - -C "$release_dir"
ln -s releases/drill "$root_dir/current"
(
  umask 077
  cat >"$root_dir/.env" <<'ENV'
POSTGRES_PASSWORD=ci-placeholder-not-a-real-password
POSTGRES_APP_PASSWORD=ci-placeholder-not-a-real-app-password
AUTH_JWT_SECRET=ci-placeholder-not-a-real-secret-0000000000
DATA_ENCRYPTION_KEY=ci-placeholder-not-a-real-data-encryption-key
ENV
)
# 演练不启动 API 和反向代理，镜像名只是让 compose 文件的变量齐全，不会被拉取
cat >"$release_dir/release.env" <<ENV
APP_ENV=ci
APP_DOMAIN=localhost
ACME_EMAIL=
CADDY_TLS_MODE=internal
API_IMAGE=nozomi-api:pitr-drill-not-used
WEB_IMAGE=nozomi-web:pitr-drill-not-used
EDGE_MODE=standalone
EDGE_LISTEN=
CADDY_SITE_ADDRESS=localhost
TRUST_PROXY_HOPS=1
REPORTS_DIR=$root_dir/reports
ENV

step "1. 起数据库：WAL 归档开着；还没有基础备份时状态检查报异常"
compose up -d --wait db
[[ "$(live 'show archive_mode')" == "on" ]] || fail "数据库应开启 WAL 归档"
expect_failure "还没有基础备份" "$bin/pitr-status.sh"

step "2. 写数据、基础备份、再写，记下两个时间点"
live 'create table drill (id integer primary key)'
live 'insert into drill values (1), (2), (3)'
output="$("$bin/pitr-backup.sh" 2>&1)" || fail "基础备份失败：$output"
printf '%s\n' "$output"
grep -qF "没有配置异地备份" <<<"$output" || fail "没配异地时应明确说备份只在本机"
live 'insert into drill values (4), (5), (6)'
t1="$(now_utc)"
sleep 1.2
live 'insert into drill values (7), (8), (9)'
live 'delete from drill where id = 1'
t2="$(now_utc)"
sleep 1.2
live 'insert into drill values (10)'
flush_wal
printf 'T1=%s T2=%s\n' "$t1" "$t2"
"$bin/pitr-status.sh" || fail "基础备份做完、归档正常时状态检查应通过"

step "3. 恢复到 T1、T2（东京时间写法）、latest；正在运行的数据库不受影响"
restore_and_check "$t1" "1,2,3,4,5,6"
t2_tokyo="$(TZ=Asia/Tokyo date -d "$t2" '+%Y-%m-%d %H:%M:%S.%6N+09:00')"
restore_and_check "$t2_tokyo" "2,3,4,5,6,7,8,9"
restore_and_check latest "2,3,4,5,6,7,8,9,10"
[[ "$(rows_of live)" == "2,3,4,5,6,7,8,9,10" ]] || fail "正在运行的数据库不应被改动"
[[ "$(live 'select pg_is_in_recovery()')" == "f" ]] || fail "正在运行的数据库应照常可写"

step "4. 写错的时间被拒绝，什么都不动"
expect_failure "必须带时区" "$bin/pitr-restore.sh" "2026-01-01 00:00:00"
expect_failure "这个时间还没到" "$bin/pitr-restore.sh" "$(date -u -d '+1 day' '+%Y-%m-%d %H:%M:%SZ')"
expect_failure "恢复不到比它更早的时间" "$bin/pitr-restore.sh" "$(date -u -d '-1 day' '+%Y-%m-%d %H:%M:%SZ')"
expect_failure "--yes 只和 --apply 一起用" "$bin/pitr-restore.sh" latest --yes
# 最后一次提交之后的时间：归档里没有更晚的提交，数据库没法确认停在哪里，要给出能照着做的提示
expect_failure "归档里没有晚于这个时间的提交" "$bin/pitr-restore.sh" "$(now_utc)"
"$bin/pitr-restore.sh" --cleanup
[[ -z "$(compose ps --quiet pitr-restore)" ]] || fail "--cleanup 之后临时数据库应已删除"
[[ "$(rows_of live)" == "2,3,4,5,6,7,8,9,10" ]] || fail "正在运行的数据库不应被改动"

step "5. 异地备份：只配一部分时报错；配齐后同步到对象存储"
compose up -d s3
printf 'OFFSITE_BACKUP_REPOSITORY=s3:http://s3:9000/nozomi-drill/ci\n' >>"$root_dir/.env"
expect_failure "配置不完整" "$bin/pitr-offsite.sh" sync
expect_failure "配置不完整" "$bin/pitr-status.sh"
cat >>"$root_dir/.env" <<'ENV'
OFFSITE_BACKUP_ACCESS_KEY_ID=ci-placeholder-access-key
OFFSITE_BACKUP_SECRET_ACCESS_KEY=ci-placeholder-secret-key
OFFSITE_BACKUP_PASSWORD=short
ENV
expect_failure "至少要 32 个字符" "$bin/pitr-offsite.sh" sync
sed -i 's/^OFFSITE_BACKUP_PASSWORD=.*/OFFSITE_BACKUP_PASSWORD=ci-placeholder-not-a-real-offsite-passphrase/' "$root_dir/.env"
expect_failure "异地备份还没有成功过" "$bin/pitr-status.sh"
"$bin/pitr-backup.sh"
"$bin/pitr-status.sh" | tee "$work_dir/status.txt"
grep -qF "异地备份最近一次成功" "$work_dir/status.txt" || fail "同步之后状态检查应显示异地备份成功的时间"
live 'insert into drill values (11)'
t3="$(now_utc)"
sleep 1.2
live 'insert into drill values (12)'
flush_wal
"$bin/pitr-offsite.sh" sync
"$bin/pitr-offsite.sh" snapshots
status=0
compose run --rm --no-deps -T -e RESTIC_PASSWORD=ci-placeholder-wrong-passphrase-0000000000 offsite cat config >/dev/null 2>&1 || status=$?
[[ "$status" == "12" ]] || fail "口令不对时应读不了异地仓库（restic 退出码 12），实际是 $status"

step "6. 整台服务器没了：删掉数据库和 pitr 数据卷，起一个空数据库（和新服务器首次部署一样做一次基础备份），从异地取回，再恢复"
old_system="$(live 'select system_identifier from pg_control_system()')"
compose rm --stop --force db pitr-restore
docker volume rm nozomi-ci_db-data nozomi-ci_pitr nozomi-ci_pitr-scratch >/dev/null
compose up -d --wait db
[[ -z "$(live "select to_regclass('drill')")" ]] || fail "新起的数据库应是空的"
[[ "$(live 'select system_identifier from pg_control_system()')" != "$old_system" ]] || fail "新起的数据库应是另一个实例"
expect_failure "没有任何基础备份" "$bin/pitr-restore.sh" "$t3"
"$bin/pitr-backup.sh"
output="$("$bin/pitr-offsite.sh" fetch 2>&1)" || fail "从异地取回失败：$output"
printf '%s\n' "$output"
grep -qF "pitr-restore.sh latest --system $old_system" <<<"$output" || fail "取回后应告诉人恢复旧实例要用哪条命令"
restore_and_check "$t3" "2,3,4,5,6,7,8,9,10,11"
# latest 不带 --system 会选到新实例自己的基础备份（空库）；带上旧实例的系统标识才是取回来的数据
"$bin/pitr-restore.sh" latest --system "$old_system"
[[ "$(rows_of scratch)" == "2,3,4,5,6,7,8,9,10,11,12" ]] || fail "恢复旧实例的 latest 应是取回前最后同步的样子，实际是 [$(rows_of scratch)]"
expect_failure "没有数据库实例 1 的任何基础备份" "$bin/pitr-restore.sh" latest --system 1
# 新实例的 WAL 和取回来的旧实例的 WAL 各在各的目录里，新实例照常归档
live 'create table after_fetch (id integer)'
flush_wal
[[ "$(compose exec -T db ls /pitr/wal | wc -l)" == "2" ]] || fail "pitr 卷里应有新旧两个实例各自的 WAL 目录"
[[ "$(live "select failed_count from pg_stat_archiver")" == "0" ]] || fail "新实例归档不应失败"

step "演练全部通过"
