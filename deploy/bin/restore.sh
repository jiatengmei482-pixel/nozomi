#!/usr/bin/env bash
# 用一个备份文件恢复数据库。会清空当前数据库，所以：
#   - 恢复前自动再做一次备份（标签 pre-restore），万一选错了文件还能回来；
#   - 需要输入环境名确认，或者加 --yes 跳过确认。
#
# 用法：restore.sh <备份文件> [--yes]
#   /opt/nozomi/<环境>/current/bin/restore.sh /opt/nozomi/<环境>/backups/nozomi-<环境>-daily-<时间>.dump
#
# 过程：停 API → 备份当前库 → 删库重建 → 导入备份 → 执行迁移（把结构补到当前版本）→ 启动 API 并等它健康。
set -euo pipefail

HEALTH_TIMEOUT_SECONDS=120

bin_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose="$bin_dir/compose.sh"

log() { printf '[恢复] %s\n' "$*"; }
die() {
  printf '[恢复] 错误：%s\n' "$*" >&2
  exit 1
}

backup_file="${1:-}"
confirm="${2:-}"
[[ -n "$backup_file" ]] || die "用法：restore.sh <备份文件> [--yes]"
[[ -f "$backup_file" && -s "$backup_file" ]] || die "备份文件不存在或是空的：$backup_file"

app_env="$(sed -n 's/^APP_ENV=//p' "$bin_dir/../release.env" | tail -n 1)"

"$compose" exec -T db pg_restore --list <"$backup_file" >/dev/null ||
  die "这个文件不是可用的备份（pg_restore 读不了），数据库没有被改动"

if [[ "$confirm" != "--yes" ]]; then
  printf '将清空 %s 环境的数据库，并用 %s 恢复。\n输入环境名 %s 确认：' "$app_env" "$backup_file" "$app_env"
  read -r answer
  [[ "$answer" == "$app_env" ]] || die "输入不一致，已取消，数据库没有被改动"
fi

log "停止 API"
"$compose" stop api

"$bin_dir/backup.sh" pre-restore

log "清空数据库并导入备份"
"$compose" exec -T db psql -U nozomi -d postgres -v ON_ERROR_STOP=1 --quiet \
  -c 'drop database if exists nozomi with (force)' \
  -c 'create database nozomi owner nozomi'
"$compose" exec -T db pg_restore -U nozomi -d nozomi --no-owner --exit-on-error <"$backup_file" ||
  die "导入失败。数据库现在不完整：请换一个备份重试，或用刚才生成的 pre-restore 备份恢复"

log "执行迁移，把结构补到当前版本"
migrated=yes
"$compose" run --rm --no-deps -T api node apps/api/src/db/migrate-cli.ts || migrated=no

log "启动 API"
if "$compose" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" && [[ "$migrated" == yes ]]; then
  log "恢复完成，服务健康"
else
  "$compose" ps || true
  die "数据已导入，但服务不健康。常见原因：备份比当前运行的版本新（备份里有当前版本不认识的迁移），需要部署对应的新版本"
fi
