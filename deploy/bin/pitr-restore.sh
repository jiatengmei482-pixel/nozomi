#!/usr/bin/env bash
# 把数据库恢复到某个时间点（ADR 0105）。
#
# 用法：
#   pitr-restore.sh '<时间>'            恢复到这个时间点，放在一个临时数据库里给人查看。正在运行的数据库完全不动。
#   pitr-restore.sh latest              恢复到归档里最后的时刻（数据库坏了、数据卷没了时用）
#   pitr-restore.sh latest --system <系统标识>
#                                       只用某个数据库实例的备份（换了服务器、从异地取回之后，旧实例和新实例的备份都在，
#                                       pitr-offsite.sh fetch 会打印该用哪个）
#   pitr-restore.sh '<时间>' --apply    同上，确认无误后用恢复出来的数据替换正在运行的数据库（要输入环境名确认）
#   pitr-restore.sh '<时间>' --apply --yes   不再询问（只给演练和脚本用）
#   pitr-restore.sh --cleanup           删掉临时数据库
#
# <时间> 必须带时区，例如 '2026-11-22 10:15:00+09:00'（东京时间）或 '2026-11-22 01:15:00Z'（UTC）。
# 恢复的结果：这个时间点之前提交的改动都在，之后的都不在。
#
# 过程：
#   1. 让正在运行的数据库把当前的 WAL 立即归档（它在运行的话），这样最近的改动也在归档里
#   2. 选「在这个时间点之前已经完成」的最近一份基础备份
#   3. 在临时容器 pitr-restore 自己的数据卷里解开它，按归档的 WAL 重放到这个时间点，然后让它可读写
#   4. 不带 --apply：到此为止，打印怎么查看、怎么替换、怎么删掉
#      带 --apply：把临时数据库整库导出到 backups/（标签 pitr），交给 restore.sh 恢复——和用每日备份恢复是同一条路：
#      停 API、恢复前再备份一次当前库、清空、导入、迁移、启动并等健康。最后做一次新的基础备份。
set -euo pipefail

# shellcheck source=deploy/bin/pitr-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pitr-common.sh"

# 等重放完成的上限（秒）。几 GB 的库通常几分钟。
RESTORE_TIMEOUT_SECONDS="${PITR_RESTORE_TIMEOUT_SECONDS:-3600}"

log() { printf '[时间点恢复] %s\n' "$*"; }
die() {
  printf '[时间点恢复] 错误：%s\n' "$*" >&2
  exit 1
}

usage="用法：pitr-restore.sh '<带时区的时间>'|latest [--system <系统标识>] [--apply [--yes]]，或 pitr-restore.sh --cleanup"

scratch_psql() {
  "$compose" exec -T pitr-restore psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align "$@"
}

remove_scratch() {
  "$compose" rm --stop --force pitr-restore >/dev/null 2>&1 || true
}

cmd_cleanup() {
  remove_scratch
  "$compose" run --rm --no-deps -T --entrypoint sh pitr-restore -c 'find /var/lib/postgresql/data -mindepth 1 -delete'
  log "临时数据库已删除"
}

target="${1:-}"
[[ -n "$target" ]] || die "$usage"
if [[ "$target" == "--cleanup" ]]; then
  [[ $# -eq 1 ]] || die "$usage"
  cmd_cleanup
  exit 0
fi
shift
apply=no
confirm=""
only_system=""
while (($# > 0)); do
  case "$1" in
    --apply) apply=yes ;;
    --yes) confirm="--yes" ;;
    --system)
      only_system="${2:-}"
      [[ "$only_system" =~ ^[0-9]+$ ]] || die "--system 后面要跟数据库实例的系统标识（一串数字）"
      shift
      ;;
    *) die "$usage" ;;
  esac
  shift
done
[[ -z "$confirm" || "$apply" == yes ]] || die "--yes 只和 --apply 一起用"

now="$(date -u +%s)"
if [[ "$target" == "latest" ]]; then
  target_epoch="$now"
  target_label="归档里最后的时刻"
else
  # 必须写明时区：服务器、数据库、看日志的人可能各在一个时区，不带时区的时间是含糊的。
  [[ "$target" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}[T\ ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$ ]] ||
    die "时间要写成 '2026-11-22 10:15:00+09:00' 或 '2026-11-22 01:15:00Z' 这样，必须带时区"
  target_epoch="$(date -u -d "$target" +%s 2>/dev/null)" || die "读不懂这个时间：$target"
  ((target_epoch <= now)) || die "这个时间还没到：$target"
  # 交给数据库的是同一个时刻的 UTC 写法（保留小数秒）
  fraction=""
  if [[ "$target" =~ :[0-9]{2}(\.[0-9]{1,6}) ]]; then fraction="${BASH_REMATCH[1]}"; fi
  target_label="$(date -u -d "@$target_epoch" '+%Y-%m-%d %H:%M:%S')$fraction+00"
fi

if [[ "$(db_query 'show archive_mode' 2>/dev/null || true)" == "on" ]]; then
  # 当前正在写的 WAL 段立即归档，最近不到一分钟的改动也能恢复到
  db_query 'select pg_switch_wal()' >/dev/null
  waited=0
  while [[ "$(db_query "select count(*) from pg_ls_archive_statusdir() where name like '%.ready'")" != "0" ]]; do
    ((waited < 60)) || die "等了 60 秒，WAL 还没归档完（pitr-status.sh 看看归档是不是卡住了）"
    sleep 1
    waited=$((waited + 1))
  done
else
  log "正在运行的数据库不在或没开归档：只能用归档里已有的 WAL，最后一分钟左右的改动可能不在"
fi

base=""
base_system=""
first_finished=""
while read -r name finished _ system; do
  [[ -n "$name" ]] || continue
  [[ -z "$only_system" || "$system" == "$only_system" ]] || continue
  [[ -n "$first_finished" ]] || first_finished="$finished"
  if ((finished <= target_epoch)); then
    base="$name"
    base_system="$system"
  fi
done < <(list_base_backups pitr-restore)
[[ -n "$first_finished" ]] ||
  die "pitr 卷里没有${only_system:+数据库实例 $only_system 的}任何基础备份。服务器换过或数据卷没了时，先用 pitr-offsite.sh fetch 从异地取回"
[[ -n "$base" ]] ||
  die "最早的基础备份是 $(utc_of "$first_finished") 完成的，恢复不到比它更早的时间"
[[ "$base_system" =~ ^[0-9]+$ ]] || die "基础备份 $base 的 info 里没有系统标识"

log "从基础备份 $base 开始，重放 WAL 到 $target_label"
remove_scratch
recovery_target=""
[[ "$target" == "latest" ]] || recovery_target="recovery_target_time = '$target_label'"
# 以 root 在临时容器里准备数据目录：清空、解开基础备份和它自带的 WAL、写恢复设置。之后官方入口会把属主改成 postgres。
# shellcheck disable=SC2016
"$compose" run --rm --no-deps -T --entrypoint bash pitr-restore -c '
  set -euo pipefail
  data=/var/lib/postgresql/data
  find "$data" -mindepth 1 -delete
  tar -xzf "/pitr/base/$1/base.tar.gz" -C "$data"
  mkdir -p "$data/pg_wal"
  tar -xzf "/pitr/base/$1/pg_wal.tar.gz" -C "$data/pg_wal"
  touch "$data/recovery.signal"
  cat >>"$data/postgresql.auto.conf" <<CONF
restore_command = '"'"'f=/pitr/wal/$3/%f.gz; [ -f \$f ] && gzip -dc \$f > %p'"'"'
recovery_target_action = '"'"'promote'"'"'
$2
CONF
  chown -R postgres:postgres "$data"
  chmod 700 "$data"
' prepare "$base" "$recovery_target" "$base_system" || die "准备临时数据库失败"

"$compose" up -d --no-deps pitr-restore >/dev/null
waited=0
while :; do
  if [[ -z "$("$compose" ps --status running --quiet pitr-restore)" ]]; then
    "$compose" logs --no-log-prefix --tail 15 pitr-restore >&2 || true
    scratch_log="$("$compose" logs --no-log-prefix pitr-restore 2>/dev/null || true)"
    if grep -qF 'recovery ended before configured recovery target was reached' <<<"$scratch_log"; then
      die "归档里没有晚于这个时间的提交，没法确认停在哪里。请换一个稍早的时间，或用 latest 恢复到归档里最后的时刻"
    fi
    die "临时数据库没能完成恢复（上面是它的日志）"
  fi
  if [[ "$(scratch_psql -c 'select pg_is_in_recovery()' 2>/dev/null || true)" == "f" ]]; then break; fi
  ((waited < RESTORE_TIMEOUT_SECONDS)) || die "等了 $RESTORE_TIMEOUT_SECONDS 秒还没恢复完（PITR_RESTORE_TIMEOUT_SECONDS 可以放宽）"
  sleep 2
  waited=$((waited + 2))
done
stop_line="$("$compose" logs --no-log-prefix pitr-restore 2>/dev/null | grep -E 'recovery stopping|last completed transaction' | tail -n 1 || true)"
log "已恢复到 $target_label。数据库日志：${stop_line:-（没有提交记录，说明这个时间点之后到归档末尾没有新的改动）}"

if [[ "$apply" == no ]]; then
  cat <<DONE
[时间点恢复] 恢复出来的数据库在临时容器 pitr-restore 里，正在运行的数据库没有被改动。
  查看：         $pitr_bin_dir/compose.sh exec pitr-restore psql -U nozomi -d nozomi
  用它替换正式数据：$pitr_bin_dir/pitr-restore.sh '$target'${only_system:+ --system $only_system} --apply
  看完删掉：     $pitr_bin_dir/pitr-restore.sh --cleanup
DONE
  exit 0
fi

backup_dir="$pitr_root_dir/backups"
mkdir -p "$backup_dir"
dump="$backup_dir/nozomi-${app_env}-pitr-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$dump.partial"
trap 'rm -f "$partial"' EXIT
: >"$partial"
chmod 600 "$partial"
log "把恢复出来的数据整库导出到 $dump"
"$compose" exec -T pitr-restore pg_dump -U nozomi -d nozomi --format=custom >"$partial" || die "导出失败，正在运行的数据库没有被改动"
"$compose" exec -T pitr-restore pg_restore --list <"$partial" >/dev/null || die "导出的文件校验失败，正在运行的数据库没有被改动"
mv "$partial" "$dump"
remove_scratch

"$pitr_bin_dir/restore.sh" "$dump" ${confirm:+"$confirm"}

log "恢复完成。再做一次基础备份，作为之后恢复的新起点"
"$pitr_bin_dir/pitr-backup.sh" || log "基础备份失败（不影响刚才的恢复）：请稍后手工运行 pitr-backup.sh"
cmd_cleanup
