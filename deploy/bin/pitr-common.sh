#!/usr/bin/env bash
# 恢复到任意时间点（ADR 0105）几个脚本共用的设置和小函数。不单独运行：由 pitr-backup.sh、pitr-offsite.sh、
# pitr-status.sh、pitr-restore.sh 用 source 引入。
#
# 数据都在 pitr 数据卷里（只有数据库容器以 postgres 的身份写）：
#   /pitr/wal/<系统标识>/<WAL 文件名>.gz  数据库自己归档的 WAL（compose.yml 里 db 的 archive_command）。
#                                       系统标识是数据库实例的编号：换了服务器、重建过的实例各用各的目录
#   /pitr/base/<开始时间>/                一次基础备份：base.tar.gz、pg_wal.tar.gz、backup_manifest、info
#   /pitr/base/<开始时间>/info            start_wal=<这次备份从哪个 WAL 文件开始>、system_id=<系统标识>、finished_at=<完成时间，Unix 秒>
# 部署目录下的 pitr-state/（权限 700）只放本机的状态：异地备份最近一次成功的时间、锁文件。
# 这里定义的设置由引入它的脚本使用
# shellcheck disable=SC2034
set -euo pipefail

# 本机保留几天的基础备份（再加上比它更早的最近一份，保证这几天里的任何时间点都能恢复）
PITR_LOCAL_DAYS=7
# 最近一次基础备份超过这么多小时就算不正常（每天一次，留两小时余量）
PITR_BASE_MAX_AGE_HOURS=26
# 等着归档的 WAL 文件超过这么多个就算归档卡住了（正常情况下最多一两个）
PITR_MAX_READY_FILES=5
# 异地备份最近一次成功超过这么多分钟就算不正常（每 15 分钟同步一次）
PITR_OFFSITE_MAX_AGE_MINUTES=60
# 异地备份的加密口令至少这么长
PITR_OFFSITE_MIN_PASSWORD_LENGTH=32
# 异地备份要配的四项（OFFSITE_BACKUP_REGION 可以不配）
PITR_OFFSITE_KEYS=(OFFSITE_BACKUP_REPOSITORY OFFSITE_BACKUP_ACCESS_KEY_ID OFFSITE_BACKUP_SECRET_ACCESS_KEY OFFSITE_BACKUP_PASSWORD)

pitr_bin_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pitr_root_dir="$(cd -P "$pitr_bin_dir/../../.." && pwd)"
pitr_state_dir="$pitr_root_dir/pitr-state"
compose="$pitr_bin_dir/compose.sh"
app_env="$(sed -n 's/^APP_ENV=//p' "$pitr_bin_dir/../release.env" | tail -n 1)"
# 异地仓库里快照的「主机名」前缀：nozomi-<环境>-<数据库实例的系统标识>。
# 带上系统标识，是为了换了服务器之后新实例的快照和旧实例的分得开：取回时取的是旧实例最后的那一份。
offsite_host_prefix="nozomi-$app_env"

ensure_state_dir() {
  mkdir -p "$pitr_state_dir"
  chmod 700 "$pitr_state_dir"
}

# .env 里某一项的值（没有或为空时输出空）。和 compose.sh 一样只认「行首就是 变量名=值」。
env_value() {
  sed -n "s/^$1=//p" "$pitr_root_dir/.env" | tail -n 1
}

# 异地备份配了没有：输出 none（四项都空）、ok（四项都有）或 partial:<缺的项>。
offsite_config_state() {
  local key missing=() present=0
  for key in "${PITR_OFFSITE_KEYS[@]}"; do
    if [[ -n "$(env_value "$key")" ]]; then present=$((present + 1)); else missing+=("$key"); fi
  done
  if ((present == 0)); then
    printf 'none'
  elif ((${#missing[@]} == 0)); then
    printf 'ok'
  else
    printf 'partial:%s' "${missing[*]}"
  fi
}

# 在数据库容器里用迁移账号（超级用户，本地套接字）执行一条查询，输出单个值。
db_query() {
  "$compose" exec -T db psql -U nozomi -d postgres -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align -c "$1"
}

# 已完成的基础备份，一行一个「名字 完成时间（Unix 秒） 开始的 WAL 文件 系统标识」，按名字（开始时间）从旧到新。
# 第一个参数是在哪个服务里读：db（正在运行的数据库）或 pitr-restore（数据库坏了也能读，临时起一个容器）。
list_base_backups() {
  # 这段在容器里执行，变量由容器里的 sh 展开
  # shellcheck disable=SC2016
  local script='for dir in /pitr/base/*/; do
    dir="${dir%/}"; name="${dir##*/}"
    case "$name" in *.partial) continue ;; esac
    [ -f "$dir/info" ] || continue
    finished="$(sed -n "s/^finished_at=//p" "$dir/info")"
    start="$(sed -n "s/^start_wal=//p" "$dir/info")"
    system="$(sed -n "s/^system_id=//p" "$dir/info")"
    printf "%s %s %s %s\n" "$name" "$finished" "$start" "$system"
  done'
  if [[ "$1" == "db" ]]; then
    "$compose" exec -T db sh -c "$script"
  else
    "$compose" run --rm --no-deps -T --entrypoint sh pitr-restore -c "$script"
  fi
}

utc_of() {
  date -u -d "@$1" '+%Y-%m-%d %H:%M:%S UTC'
}
