#!/usr/bin/env bash
# 备份数据库到 <根目录>/backups/，并删除超过保留天数的旧备份。
#
# 用法：backup.sh [标签]
#   标签默认 daily（每日定时任务用）；部署前自动备份用 pre-deploy，恢复前自动备份用 pre-restore。
#
# 备份是 pg_dump 的自定义格式（已压缩），用同目录的 restore.sh 恢复。
# 用迁移账号（表的所有者）在数据库容器里执行：应用账号读不了全部数据，备份不能用它（ADR 0010）。
# 只有新备份写完并校验通过后才清理旧备份：备份失败时不会删掉任何已有的备份。
set -euo pipefail

RETENTION_DAYS=14

bin_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -P "$bin_dir/../../.." && pwd)"
backup_dir="$root_dir/backups"
label="${1:-daily}"

log() { printf '[备份] %s\n' "$*"; }
die() {
  printf '[备份] 错误：%s\n' "$*" >&2
  exit 1
}

[[ "$label" =~ ^[a-z][a-z-]*$ ]] || die "标签只能包含小写字母和连字符"

umask 077
mkdir -p "$backup_dir"

app_env="$(sed -n 's/^APP_ENV=//p' "$bin_dir/../release.env" | tail -n 1)"
target="$backup_dir/nozomi-${app_env}-${label}-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT

# 先建空文件并明确设成只有属主可读写，再往里写（不只依赖 umask：目录带默认 ACL 时 umask 不生效）。
: >"$partial"
chmod 600 "$partial"
"$bin_dir/compose.sh" exec -T db pg_dump -U nozomi -d nozomi --format=custom >"$partial" ||
  die "pg_dump 失败，没有生成备份"
[[ -s "$partial" ]] || die "备份文件是空的"
# 让 pg_restore 读一遍目录，确认文件完整可用。
"$bin_dir/compose.sh" exec -T db pg_restore --list <"$partial" >/dev/null ||
  die "备份文件校验失败（pg_restore 读不了）"

mv "$partial" "$target"
log "已生成 $target（$(du -h "$target" | cut -f1)）"

find "$backup_dir" -maxdepth 1 -type f -name 'nozomi-*.dump' -mtime "+$RETENTION_DAYS" -print -delete |
  while IFS= read -r removed; do log "已删除超过 $RETENTION_DAYS 天的旧备份 $removed"; done
