#!/usr/bin/env bash
# 部署冒烟：在本机（CI 的 runner 或开发机）上用和服务器完全相同的镜像、compose.yml、Caddyfile、
# bin/ 脚本把整套服务真实跑一遍。和真实部署的差别只有 deploy/ci/compose.ci.yml 里的两处
# （自签证书、高位端口），以及镜像不经过镜像仓库。
#
# 依次验证：
#   1. 首次部署：迁移 → 启动 → 经反向代理的 HTTPS 访问 /health 返回 200
#   2. 安全响应头齐全；访问日志里没有查询串；数据库和 API 没有映射端口到主机
#   3. 部署一个起不来的版本：自动回退，旧版本继续服务，退出码 20
#   4. 再部署一个好版本，然后手动回退（流水线在外网访问不通时走的那条路）
#   5. 备份 → 删掉数据 → 恢复 → 数据回来
#
# 用法：deploy/ci/smoke.sh        需要 Docker；占用本机 127.0.0.1 的 18080、18443 端口
# 这里出现的所有「密码」都是明显的占位值，数据库是本次运行临时起的容器，结束即删除。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
https_port="${SMOKE_HTTPS_PORT:-18443}"
good_image="nozomi-api:smoke-good"
bad_image="nozomi-api:smoke-bad"

work_dir="$(mktemp -d)"
root_dir="$work_dir/root"

export DEPLOY_COMPOSE_OVERRIDE="$repo_root/deploy/ci/compose.ci.yml"
export DEPLOY_SKIP_PULL=1
export APP_ENV=ci
export APP_DOMAIN=localhost

step() { printf '\n=== %s ===\n' "$*"; }
fail() {
  printf '冒烟失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ -x "$root_dir/current/bin/compose.sh" ]]; then
    if [[ $status -ne 0 ]]; then
      "$root_dir/current/bin/compose.sh" ps --all || true
      "$root_dir/current/bin/compose.sh" logs --tail 40 || true
    fi
  fi
  docker compose --project-name nozomi-ci down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$good_image" "$bad_image" >/dev/null 2>&1 || true
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

# 和 .github/workflows/deploy.yml 上传到服务器的是同一组文件。
install_release() {
  local dir="$root_dir/releases/$1"
  mkdir -p "$dir"
  tar -C "$repo_root/deploy" -cf - compose.yml Caddyfile bin | tar -xf - -C "$dir"
  # 模拟服务器上 umask 很严的情况：上传的文件只有属主能读，deploy.sh 必须自己把权限摆对。
  chmod -R go-rwx "$dir"
}

deploy_release() {
  API_IMAGE="$2" "$root_dir/releases/$1/bin/deploy.sh" deploy </dev/null
}

compose() { "$root_dir/current/bin/compose.sh" "$@"; }

current_release() { basename "$(readlink "$root_dir/current")"; }

health_status() {
  curl --silent --insecure --max-time 10 --output /dev/null --write-out '%{http_code}' \
    "https://localhost:$https_port/health$1" || true
}

expect_healthy() {
  local code
  code="$(health_status "")"
  [[ "$code" == "200" ]] || fail "$1：/health 返回 $code，应为 200"
}

step "构建镜像"
docker build --quiet --file "$repo_root/apps/api/Dockerfile" --tag "$good_image" "$repo_root"

step "准备目录（相当于服务器上初始化之后的 /opt/nozomi/<环境>/）"
mkdir -p "$root_dir/releases" "$root_dir/backups"
(
  umask 077
  cat >"$root_dir/.env" <<'ENV'
POSTGRES_PASSWORD=ci-placeholder-not-a-real-password
AUTH_JWT_SECRET=ci-placeholder-not-a-real-secret-0000000000
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
GOOGLE_MAPS_API_KEY=
ENV
)

step "1. 首次部署"
install_release v1
deploy_release v1 "$good_image"
[[ "$(current_release)" == "v1" ]] || fail "current 应指向 v1"
expect_healthy "首次部署后"
body="$(curl --silent --insecure --max-time 10 "https://localhost:$https_port/health")"
grep -q '"status":"ok"' <<<"$body" || fail "/health 的 status 不是 ok"
grep -q '"env":"ci"' <<<"$body" || fail "/health 的 env 不是 ci"

step "2. 响应头、访问日志、端口"
headers="$(curl --silent --insecure --max-time 10 --head "https://localhost:$https_port/health")"
for header in "strict-transport-security: max-age=" "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: no-referrer"; do
  grep -qi "^$header" <<<"$headers" || fail "缺少响应头 $header"
done
if grep -qi '^server:' <<<"$headers"; then fail "响应里不应有 Server 头"; fi

marker="smoke-query-marker-$RANDOM"
[[ "$(health_status "?token=$marker")" == "200" ]] || fail "带查询串的请求没有返回 200"
caddy_log="$(compose logs --no-log-prefix caddy)"
grep -q '"uri":"/health"' <<<"$caddy_log" || fail "访问日志里没有 /health 的记录"
if grep -q "$marker" <<<"$caddy_log"; then fail "访问日志里出现了查询串"; fi

for service in db api; do
  [[ -z "$(docker port "$(compose ps --quiet "$service")")" ]] || fail "$service 不应映射端口到主机"
done
[[ -n "$(docker port "$(compose ps --quiet caddy)")" ]] || fail "反向代理应该映射了端口（否则上面的检查没有意义）"
[[ "$(compose exec -T api id -u)" != "0" ]] || fail "API 不应以 root 运行"

step "3. 部署一个起不来的版本，应自动回退"
# 「坏版本」：进程活着但从不监听端口，健康检查永远通不过。
# 到这一步才构建：每次成功部署都会清掉用不到的旧镜像，提前构建的会被删。
docker build --quiet --tag "$bad_image" - <<DOCKERFILE
FROM $good_image
CMD ["node", "-e", "setInterval(() => {}, 1000)"]
DOCKERFILE
install_release v2-bad
status=0
deploy_release v2-bad "$bad_image" || status=$?
[[ "$status" -eq 20 ]] || fail "坏版本的部署应以退出码 20（已回退）结束，实际是 $status"
[[ "$(current_release)" == "v1" ]] || fail "回退后 current 应仍指向 v1"
expect_healthy "自动回退后"

step "4. 再部署一个好版本，然后手动回退"
install_release v3
deploy_release v3 "$good_image"
[[ "$(current_release)" == "v3" ]] || fail "current 应指向 v3"
[[ "$(basename "$(readlink "$root_dir/previous")")" == "v1" ]] || fail "previous 应指向 v1"
[[ ! -e "$root_dir/releases/v2-bad" ]] || fail "成功部署后应清理掉失败的版本目录"
expect_healthy "第三次部署后"
"$root_dir/current/bin/deploy.sh" rollback
[[ "$(current_release)" == "v1" ]] || fail "手动回退后 current 应指向 v1"
[[ ! -e "$root_dir/previous" ]] || fail "手动回退后不应再有 previous"
expect_healthy "手动回退后"

step "5. 备份与恢复"
compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet \
  -c 'create table smoke_marker (id integer primary key)' -c 'insert into smoke_marker values (42)'
"$root_dir/current/bin/backup.sh" daily
backup_file="$(find "$root_dir/backups" -name 'nozomi-ci-daily-*.dump' | head -n 1)"
[[ -s "$backup_file" ]] || fail "没有生成每日备份文件"
[[ "$(stat -c '%a' "$backup_file")" == "600" ]] || fail "备份文件的权限应为 600"
compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet -c 'drop table smoke_marker'
"$root_dir/current/bin/restore.sh" "$backup_file" --yes
restored="$(compose exec -T db psql -U nozomi -d nozomi --tuples-only --no-align -c 'select id from smoke_marker')"
[[ "$restored" == "42" ]] || fail "恢复后数据没有回来"
expect_healthy "恢复后"

step "冒烟全部通过"
