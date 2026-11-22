#!/usr/bin/env bash
# 检查「恢复到任意时间点」的备份是否正常（ADR 0105）。每 15 分钟由定时任务运行，结果写进系统日志（标签 nozomi-pitr）。
#
# 用法：pitr-status.sh
# 退出码：0 正常；1 不正常（输出里逐条写明哪里不对）。
#
# 检查四件事：
#   1. 数据库开着 WAL 归档
#   2. 归档没有卡住：最近一次失败早于最近一次成功，等着归档的 WAL 不超过 PITR_MAX_READY_FILES 个
#   3. 最近一次基础备份不超过 PITR_BASE_MAX_AGE_HOURS 小时
#   4. 异地备份：配了的话，最近一次成功不超过 PITR_OFFSITE_MAX_AGE_MINUTES 分钟；
#      没配时测试环境只提示，正式环境算不正常（正式环境必须有异地副本）
#
# 提醒：.env 里配了 BACKUP_HEARTBEAT_URL（监控服务给的「心跳」地址）时，全部正常才访问它一次。
# 监控服务在约定时间内收不到心跳就会通知负责人——归档停了、定时任务没跑、整台服务器宕机，都会因此被发现。
set -euo pipefail

# shellcheck source=deploy/bin/pitr-common.sh
source "$(dirname "${BASH_SOURCE[0]}")/pitr-common.sh"

problems=()
ok() { printf '[备份状态] 正常：%s\n' "$*"; }
note() { printf '[备份状态] 提示：%s\n' "$*"; }
problem() {
  problems+=("$*")
  printf '[备份状态] 异常：%s\n' "$*"
}

now="$(date -u +%s)"

archive_mode="$(db_query 'show archive_mode' 2>/dev/null || true)"
if [[ "$archive_mode" != "on" ]]; then
  problem "数据库没有在运行，或者没有开启 WAL 归档（archive_mode=${archive_mode:-读不到}）"
else
  ok "WAL 归档已开启"
  # 一行：成功次数|最近成功（Unix 秒，没有为空）|失败次数|最近失败|最近失败的文件|等着归档的文件数
  IFS='|' read -r archived last_ok failed last_fail last_fail_wal ready <<<"$(db_query "
    select archived_count, coalesce(extract(epoch from last_archived_time)::bigint::text, ''),
           failed_count, coalesce(extract(epoch from last_failed_time)::bigint::text, ''), coalesce(last_failed_wal, ''),
           (select count(*) from pg_ls_archive_statusdir() where name like '%.ready')
    from pg_stat_archiver")"
  if [[ -n "$last_fail" && (-z "$last_ok" || "$last_fail" -ge "$last_ok") ]]; then
    problem "WAL 归档在失败：最近一次失败是 $(utc_of "$last_fail")（文件 $last_fail_wal，累计失败 $failed 次）。数据库日志里有原因：compose.sh logs --tail 50 db"
  elif ((ready > PITR_MAX_READY_FILES)); then
    problem "有 $ready 个 WAL 文件等着归档，归档跟不上或卡住了"
  else
    ok "WAL 归档没有积压（已归档 $archived 个$([[ -n "$last_ok" ]] && printf '，最近一次 %s' "$(utc_of "$last_ok")")）"
  fi

  mapfile -t backups < <(list_base_backups db)
  if ((${#backups[@]} == 0)); then
    problem "还没有基础备份：在那之前恢复不到任何时间点（运行 pitr-backup.sh 做一次）"
  else
    read -r newest_name newest_finished _ <<<"${backups[-1]}"
    if ((now - newest_finished > PITR_BASE_MAX_AGE_HOURS * 3600)); then
      problem "最近一次基础备份 $newest_name 是 $(((now - newest_finished) / 3600)) 小时前，超过 $PITR_BASE_MAX_AGE_HOURS 小时（每天的定时任务没跑？）"
    else
      read -r _ oldest_finished _ <<<"${backups[0]}"
      ok "最近一次基础备份 $newest_name；本机可恢复的范围从 $(utc_of "$oldest_finished") 到现在"
    fi
  fi
fi

offsite="$(offsite_config_state)"
case "$offsite" in
  none)
    if [[ "$app_env" == "production" ]]; then
      problem "正式环境还没有配置异地备份（.env 里的 OFFSITE_BACKUP_*）：服务器整台坏掉时数据找不回来"
    else
      note "没有配置异地备份：备份只在这台服务器上"
    fi
    ;;
  partial:*) problem ".env 里异地备份的配置不完整，缺：${offsite#partial:}" ;;
  ok)
    last_offsite="$(cat "$pitr_state_dir/offsite-last-ok" 2>/dev/null || true)"
    if [[ ! "$last_offsite" =~ ^[0-9]+$ ]]; then
      problem "异地备份还没有成功过（看系统日志里 nozomi-pitr 的记录）"
    elif ((now - last_offsite > PITR_OFFSITE_MAX_AGE_MINUTES * 60)); then
      problem "异地备份最近一次成功是 $(((now - last_offsite) / 60)) 分钟前，超过 $PITR_OFFSITE_MAX_AGE_MINUTES 分钟"
    else
      ok "异地备份最近一次成功 $(utc_of "$last_offsite")"
    fi
    ;;
esac

if ((${#problems[@]} > 0)); then
  printf '[备份状态] 共 %s 项异常，没有发送心跳\n' "${#problems[@]}" >&2
  exit 1
fi

heartbeat="$(env_value BACKUP_HEARTBEAT_URL)"
if [[ -n "$heartbeat" ]]; then
  [[ "$heartbeat" =~ ^https://[^[:space:]]+$ ]] || {
    printf '[备份状态] 异常：BACKUP_HEARTBEAT_URL 应以 https:// 开头\n' >&2
    exit 1
  }
  curl --silent --show-error --fail --max-time 10 --retry 3 --output /dev/null "$heartbeat" ||
    printf '[备份状态] 提示：发送心跳失败（监控服务那边会在超时后报警）\n' >&2
fi
printf '[备份状态] 全部正常\n'
