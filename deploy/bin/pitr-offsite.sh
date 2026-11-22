#!/usr/bin/env bash
# 异地备份（ADR 0105）：用 restic 把 pitr 卷（WAL 归档 + 基础备份）加密后传到 S3 兼容的对象存储。
# 加密在本机完成，对象存储里只有密文；口令只在服务器的 .env 里（OFFSITE_BACKUP_PASSWORD），负责人另外自己保管一份。
#
# 用法：
#   pitr-offsite.sh sync [--expire] [--quiet-if-unconfigured]
#       把 pitr 卷同步上去（每 15 分钟由定时任务运行）。--expire：再按保留规则删掉旧快照并检查仓库（每天一次，由 pitr-backup.sh 调用）
#   pitr-offsite.sh fetch
#       把异地里别的数据库实例（换服务器之前的那个）最后的快照取回到 pitr 卷，之后用 pitr-restore.sh --system 恢复
#   pitr-offsite.sh snapshots
#       列出异地已有的快照
#
# 没配（.env 里四项都空）：什么都不传，明确说「只有本机副本」，以 0 退出——测试环境不配也照常工作。
# 只配了一部分、或口令太短：报错，以 1 退出。
set -euo pipefail

# shellcheck source=deploy/bin/pitr-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pitr-common.sh"

# 异地保留：最近 2 天的快照全留，之后每天留一份，留 35 天。每份快照里都有当时本机的 7 天，
# 所以异地至少能恢复到最近 35 天里的任何时间点。
KEEP_WITHIN=2d
KEEP_DAILY=35
LOCK_WAIT_SECONDS=1800

log() { printf '[异地备份] %s\n' "$*"; }
die() {
  printf '[异地备份] 错误：%s\n' "$*" >&2
  exit 1
}

restic() {
  "$compose" run --rm --no-deps -T offsite "$@"
}

# 配置齐全时返回 0；没配时返回 1；配错了直接报错退出。
require_config() {
  local state password
  state="$(offsite_config_state)"
  case "$state" in
    none) return 1 ;;
    partial:*) die ".env 里异地备份的配置不完整，缺：${state#partial:}（要么四项都填，要么都不填）" ;;
  esac
  password="$(env_value OFFSITE_BACKUP_PASSWORD)"
  ((${#password} >= PITR_OFFSITE_MIN_PASSWORD_LENGTH)) ||
    die "OFFSITE_BACKUP_PASSWORD 至少要 $PITR_OFFSITE_MIN_PASSWORD_LENGTH 个字符"
  [[ "$(env_value OFFSITE_BACKUP_REPOSITORY)" == s3:* ]] ||
    die "OFFSITE_BACKUP_REPOSITORY 应写成 s3:https://<服务商给的地址>/<存储桶>/<目录>"
  return 0
}

# 同一时间只有一个 restic 在操作仓库（每 15 分钟的同步和每天的清理可能撞上）。
take_lock() {
  ensure_state_dir
  exec 8>"$pitr_state_dir/.offsite.lock"
  flock -w "$LOCK_WAIT_SECONDS" 8 || die "等了 $LOCK_WAIT_SECONDS 秒，上一次异地备份还没结束"
}

# 仓库不存在就建（存储桶不存在时 restic 会去建；已经建过时它报「already initialized」，算正常）。
ensure_repository() {
  local output
  if output="$(restic init 2>&1)"; then
    log "异地仓库是新建的。请确认负责人已经把 OFFSITE_BACKUP_PASSWORD 另外保管好：没有它，异地备份谁也解不开"
  elif ! grep -q 'already initialized' <<<"$output"; then
    printf '%s\n' "$output" | tail -n 5 >&2
    die "连不上异地仓库或建不了仓库（地址、密钥、存储桶权限？）"
  fi
}

cmd_sync() {
  local expire=no quiet=no arg
  for arg in "$@"; do
    case "$arg" in
      --expire) expire=yes ;;
      --quiet-if-unconfigured) quiet=yes ;;
      *) die "用法：pitr-offsite.sh sync [--expire] [--quiet-if-unconfigured]" ;;
    esac
  done
  if ! require_config; then
    [[ "$quiet" == yes ]] || log "没有配置异地备份（.env 里的 OFFSITE_BACKUP_* 都是空的）：备份只在这台服务器上"
    return 0
  fi
  local system
  system="$(db_query 'select system_identifier from pg_control_system()' 2>/dev/null || true)"
  [[ "$system" =~ ^[0-9]+$ ]] || die "数据库没有在运行，读不到它的系统标识，这次不同步"
  take_lock
  ensure_repository
  restic backup --quiet --host "$offsite_host_prefix-$system" --tag pitr --exclude '*.part' --exclude '*.partial' /pitr ||
    die "上传失败，下次定时任务会重试"
  if [[ "$expire" == yes ]]; then
    # 按主机名分组各自套用保留规则：换服务器之前的旧实例也最多留 35 份每日快照
    restic forget --quiet --group-by host --keep-within "$KEEP_WITHIN" --keep-daily "$KEEP_DAILY" --prune ||
      die "清理旧快照失败"
    restic check --quiet || die "异地仓库检查没通过（restic check），请尽快排查"
  fi
  date -u +%s >"$pitr_state_dir/offsite-last-ok"
  log "已同步到异地$([[ "$expire" == yes ]] && printf '，并清理了超过保留期的快照、检查了仓库')"
}

cmd_fetch() {
  require_config || die "没有配置异地备份，无从取回"
  local current="" hosts host fetched=0
  current="$(db_query 'select system_identifier from pg_control_system()' 2>/dev/null || true)"
  take_lock
  hosts="$(restic snapshots --compact | grep -oE "\b$offsite_host_prefix-[0-9]+\b" | sort -u || true)"
  [[ -n "$hosts" ]] || die "异地仓库里没有这个环境（$app_env）的快照"
  # 每个数据库实例各取回它最后的那一份；正在运行的这个实例不用取（它的归档本来就在本机）
  while IFS= read -r host; do
    [[ "$host" != "$offsite_host_prefix-$current" ]] || continue
    log "取回数据库实例 ${host##*-} 最后的快照"
    restic restore "latest:/pitr" --host "$host" --target /pitr || die "取回失败"
    log "  恢复它的数据：$pitr_bin_dir/pitr-restore.sh latest --system ${host##*-}（或把 latest 换成具体时间）"
    fetched=$((fetched + 1))
  done <<<"$hosts"
  ((fetched > 0)) || die "异地只有正在运行的这个数据库实例自己的快照，没有别的可取回"
  log "已取回。恢复取回来的数据一定要带上 --system（否则 latest 会选到这台服务器自己的备份）"
}

cmd_snapshots() {
  require_config || die "没有配置异地备份"
  restic snapshots
}

case "${1:-}" in
  sync) shift && cmd_sync "$@" ;;
  fetch) cmd_fetch ;;
  snapshots) cmd_snapshots ;;
  *) die "用法：pitr-offsite.sh sync [--expire] [--quiet-if-unconfigured] | fetch | snapshots" ;;
esac
