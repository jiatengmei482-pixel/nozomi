#!/usr/bin/env bash
# 基础备份（ADR 0105）：做一次 pg_basebackup，清理本机超过保留期的基础备份和用不到的 WAL，
# 再把整个 pitr 卷同步到异地（配了的话）。每天由定时任务运行一次；部署成功后如果最近一次已经超过 20 小时也会顺手做一次。
#
# 用法：pitr-backup.sh [--if-older-than-hours <小时>]
#   --if-older-than-hours  最近一次基础备份比这个新就什么都不做（部署脚本用）
#
# 和每日的 pg_dump（backup.sh）互不影响：那份是「整库导出」，这份是「数据文件 + WAL」，用来恢复到任意时间点。
# 新备份写完并确认可读之后才清理旧的：这次失败不会删掉任何已有的备份。
set -euo pipefail

# shellcheck source=deploy/bin/pitr-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pitr-common.sh"

log() { printf '[基础备份] %s\n' "$*"; }
die() {
  printf '[基础备份] 错误：%s\n' "$*" >&2
  exit 1
}

min_age_hours=""
case "${1:-}" in
  "") ;;
  --if-older-than-hours)
    min_age_hours="${2:-}"
    [[ "$min_age_hours" =~ ^[0-9]+$ ]] || die "--if-older-than-hours 后面要跟小时数"
    ;;
  *) die "用法：pitr-backup.sh [--if-older-than-hours <小时>]" ;;
esac

[[ "$(db_query 'show archive_mode' 2>/dev/null || true)" == "on" ]] ||
  die "数据库没有在运行，或者没有开启 WAL 归档（这个版本的 compose.yml 早于 ADR 0105？请部署新版本）"

now="$(date -u +%s)"
newest="$(list_base_backups db | tail -n 1)"
if [[ -n "$min_age_hours" && -n "$newest" ]]; then
  read -r newest_name newest_finished _ <<<"$newest"
  if ((now - newest_finished < min_age_hours * 3600)); then
    log "最近一次基础备份 $newest_name 在 $(((now - newest_finished) / 3600)) 小时前，不到 $min_age_hours 小时，这次不做"
    exit 0
  fi
fi

name="$(date -u +%Y%m%dT%H%M%SZ)"
log "开始基础备份 $name"
# 以 postgres 的身份在数据库容器里执行，经本地套接字连接；先删掉以前失败留下的半截目录。
# --checkpoint=fast：不等下一次定期检查点；-Xs：把备份期间的 WAL 一起放进去，这份备份单独也能用。
# shellcheck disable=SC2016
"$compose" exec -T -u postgres db sh -c '
  set -eu
  rm -rf /pitr/base/*.partial
  partial="/pitr/base/$1.partial"
  pg_basebackup -h /var/run/postgresql -U nozomi -D "$partial" --format=tar --gzip --wal-method=stream --checkpoint=fast
  gzip -t "$partial/base.tar.gz" "$partial/pg_wal.tar.gz"
  start_wal="$(tar -xzOf "$partial/base.tar.gz" backup_label | sed -n "s/^START WAL LOCATION: .*(file \([0-9A-F]\{24\}\))\$/\1/p")"
  [ -n "$start_wal" ] || { echo "备份里的 backup_label 读不出起始 WAL" >&2; exit 1; }
  system_id="$(psql -h /var/run/postgresql -U nozomi -d postgres -At -c "select system_identifier from pg_control_system()")"
  printf "start_wal=%s\nsystem_id=%s\nfinished_at=%s\n" "$start_wal" "$system_id" "$(date -u +%s)" >"$partial/info"
  sync "$partial"/*
  mv "$partial" "/pitr/base/$1"
' sh "$name" || die "基础备份失败，已有的备份没有被删除"
log "基础备份 $name 完成（$("$compose" exec -T db du -sh "/pitr/base/$name" | cut -f1)）"

# 本机保留最近 PITR_LOCAL_DAYS 天的基础备份，外加比这更早的最近一份（这样这几天里的任何时间点都有可用的起点）；
# 比最早留下的那份更早的 WAL 也用不上了，一起删掉。别的数据库实例（换服务器、重建之前的）的 WAL 目录，
# 等到留下的基础备份里已经没有它的了再整个删掉。
keep_from=$((now - PITR_LOCAL_DAYS * 86400))
mapfile -t backups < <(list_base_backups db)
((${#backups[@]} > 0)) || die "刚做完的基础备份找不到了"
oldest_kept=0
for ((i = ${#backups[@]} - 1; i >= 0; i--)); do
  read -r _ finished _ _ <<<"${backups[i]}"
  oldest_kept=$i
  ((finished >= keep_from)) || break
done
for ((i = 0; i < oldest_kept; i++)); do
  read -r old_name _ _ _ <<<"${backups[i]}"
  "$compose" exec -T -u postgres db rm -rf "/pitr/base/$old_name"
  log "已删除超过 $PITR_LOCAL_DAYS 天的基础备份 $old_name"
done
kept_systems=" "
for ((i = oldest_kept; i < ${#backups[@]}; i++)); do
  read -r _ _ _ system <<<"${backups[i]}"
  kept_systems+="$system "
done
read -r kept_name _ kept_wal kept_system <<<"${backups[oldest_kept]}"
removed="$("$compose" exec -T -u postgres db pg_archivecleanup -d -x .gz "/pitr/wal/$kept_system" "$kept_wal" 2>&1 | grep -c 'removing file' || true)"
current_system="$(db_query 'select system_identifier from pg_control_system()')"
while IFS= read -r system; do
  [[ "$system" =~ ^[0-9]+$ && "$kept_systems" != *" $system "* && "$system" != "$current_system" ]] || continue
  "$compose" exec -T -u postgres db rm -rf "/pitr/wal/$system"
  log "已删除别的数据库实例（$system）的 WAL：留下的基础备份里已经没有它的了"
done < <("$compose" exec -T db ls /pitr/wal)
log "本机最早可恢复到基础备份 $kept_name 完成的时刻；清理了 $removed 个更早的 WAL 文件"

"$pitr_bin_dir/pitr-offsite.sh" sync --expire
