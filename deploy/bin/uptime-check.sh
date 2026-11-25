#!/usr/bin/env bash
# 服务可用性检查（M12-05，ADR 0110）。每 5 分钟由定时任务运行（deploy/bootstrap.sh 装的 /etc/cron.d/nozomi-uptime-<环境>），
# 结果写进系统日志（标签 nozomi-uptime）。
#
# 用法：uptime-check.sh
# 退出码：0 正常；1 不正常（输出里逐条写明原因）
#
# 检查两件事：
#   1. 从服务器本机经正式入口访问 /health：返回 200，而且 status 是 ok（程序和数据库都正常）。
#      standalone    https://<域名>/health，连到本机的 443（和客人访问的是同一个入口，证书也一起验了）
#      behind-proxy  http://<EDGE_LISTEN>/health（外层反向代理转进来的那个本机端口）
#   2. 最近 5 分钟反向代理访问日志里归 API 的请求（路径前缀见下面的 API_PATH_PREFIXES）：
#      5xx 的次数 ≥ UPTIME_5XX_MIN_COUNT（默认 20）并且占比 ≥ UPTIME_5XX_MIN_PERCENT（默认 10）% 时算不正常。
#      两个条件都满足才算：流量很少时几次 5xx 不报，流量很大时零星的 5xx 也不报。
#      API 停了时反向代理回的 502 / 504 也记在这份日志里，一样算数。
#
# 提醒：.env 里配了 UPTIME_HEARTBEAT_URL（监控服务给的「心跳」地址）时，全部正常才访问它一次。
# 监控服务在约定时间内收不到心跳就会通知负责人——网站打不开、API 大量出错、定时任务没跑、整台服务器宕机，都会因此被发现。
# 没配时只写日志，不算异常。
#
# 输出里只有计数和原因：不出现心跳地址、请求的地址、来源地址和任何请求内容。
#
# 只有 CI 冒烟会设置的两个环境变量（deploy/ci/smoke.sh；真实服务器上都不设）：
#   UPTIME_CHECK_HTTPS_PORT  standalone 时连本机的哪个端口（默认 443；冒烟换成了高位端口）
#   UPTIME_CHECK_CA_FILE     standalone 时用哪个根证书验证（默认用系统的；冒烟的证书是 Caddy 自签的）
set -euo pipefail

# 统计 5xx 的时间窗，和定时任务的周期一致
WINDOW_MINUTES=5
DEFAULT_5XX_MIN_COUNT=20
DEFAULT_5XX_MIN_PERCENT=10
# 读访问日志最多等多久（秒）：Docker 卡住时不让这次检查一直挂着
LOGS_TIMEOUT_SECONDS=60
# 归 API 的路径前缀：和前端的 apps/web/src/lib/api-prefixes.ts 一致（apps/api/src/deploy-uptime.test.ts 核对两边相同）
API_PATH_PREFIXES=(/health /platform/v1 /tenant/v1 /sales/v1 /driver/v1 /site/v1 /embed/v1 /webhooks)

release_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root_dir="$(cd -P "$release_dir/../.." && pwd)"
compose="$release_dir/bin/compose.sh"

problems=()
ok() { printf '[可用性] 正常：%s\n' "$*"; }
problem() {
  problems+=("$*")
  printf '[可用性] 异常：%s\n' "$*"
}

release_value() {
  sed -n "s/^$1=//p" "$release_dir/release.env" | tail -n 1
}

# .env 里某一项的值（没有或为空时输出空）。和 compose.sh 一样只认「行首就是 变量名=值」。
env_value() {
  sed -n "s/^$1=//p" "$root_dir/.env" | tail -n 1
}

# 两次检查不重叠：上一次还卡着（多半是 Docker 没响应），这一次直接算不正常。
exec 9>"$root_dir/.uptime-check.lock"
if ! flock -n 9; then
  printf '[可用性] 异常：上一次检查还没有结束（Docker 可能没有响应），这次没有检查，没有发送心跳\n' >&2
  exit 1
fi

# 1. 经正式入口访问 /health。只看状态码和 status 字段，响应内容不打印。
check_health() {
  local edge_mode listen domain port url response code body
  local options=(--silent --max-time 10 --write-out '\n%{http_code}')
  edge_mode="$(release_value EDGE_MODE)"
  if [[ "$edge_mode" == "behind-proxy" ]]; then
    listen="$(release_value EDGE_LISTEN)"
    url="http://$listen/health"
  else
    domain="$(release_value APP_DOMAIN)"
    port="${UPTIME_CHECK_HTTPS_PORT:-443}"
    url="https://$domain:$port/health"
    options+=(--resolve "$domain:$port:127.0.0.1")
    [[ -n "${UPTIME_CHECK_CA_FILE:-}" ]] && options+=(--cacert "$UPTIME_CHECK_CA_FILE")
  fi
  response="$(curl "${options[@]}" "$url" 2>/dev/null || true)"
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [[ "$code" != "200" ]]; then
    problem "从本机经入口访问 /health 没有返回 200（返回的是 ${code:-000}，000 表示连不上或超时；入口模式 ${edge_mode:-standalone}）"
  elif [[ "$body" != *'"status":"ok"'* ]]; then
    problem "从本机经入口访问 /health 返回了 200，但 status 不是 ok"
  else
    ok "/health 返回 200，status 是 ok（入口模式 ${edge_mode:-standalone}）"
  fi
}

# 从反向代理的访问日志（一行一个 JSON）里数归 API 的请求：输出「总数 5xx 数」。
# 只认 Caddy 的访问日志行（"msg":"handled request"）；地址在日志里本来就去掉了查询串，这里再去一次。
count_api_requests() {
  awk -v prefixes="${API_PATH_PREFIXES[*]}" '
    BEGIN { n = split(prefixes, prefix, " "); total = 0; errors = 0 }
    index($0, "\"msg\":\"handled request\"") {
      if (!match($0, /"uri":"[^"]*"/)) next
      uri = substr($0, RSTART + 7, RLENGTH - 8)
      sub(/\?.*/, "", uri)
      api = 0
      for (i = 1; i <= n; i++) {
        if (uri == prefix[i] || index(uri, prefix[i] "/") == 1) { api = 1; break }
      }
      if (!api) next
      if (!match($0, /"status":[0-9]+/)) next
      total++
      if (substr($0, RSTART + 9, RLENGTH - 9) + 0 >= 500) errors++
    }
    END { printf "%d %d\n", total, errors }'
}

# .env 里的阈值：没填用默认值；填了但不是合法的数字就算不正常（不悄悄用默认值，免得以为调过了）。
threshold() {
  local key="$1" default="$2" max="$3" value
  value="$(env_value "$key")"
  if [[ -z "$value" ]]; then
    printf '%s' "$default"
  elif [[ "$value" =~ ^[0-9]{1,9}$ ]] && ((10#$value >= 1 && 10#$value <= max)); then
    printf '%s' "$((10#$value))"
  else
    return 1
  fi
}

# 2. 最近 5 分钟的 5xx。
check_errors() {
  local min_count min_percent logs total errors
  if ! min_count="$(threshold UPTIME_5XX_MIN_COUNT "$DEFAULT_5XX_MIN_COUNT" 999999999)"; then
    problem ".env 里的 UPTIME_5XX_MIN_COUNT 应是 1 以上的整数"
    return 0
  fi
  if ! min_percent="$(threshold UPTIME_5XX_MIN_PERCENT "$DEFAULT_5XX_MIN_PERCENT" 100)"; then
    problem ".env 里的 UPTIME_5XX_MIN_PERCENT 应是 1 到 100 的整数"
    return 0
  fi
  if ! logs="$(timeout "$LOGS_TIMEOUT_SECONDS" "$compose" logs --no-log-prefix --since "${WINDOW_MINUTES}m" caddy 2>/dev/null)"; then
    problem "读不到反向代理最近 $WINDOW_MINUTES 分钟的访问日志（容器没在运行，或者 Docker 没有响应）"
    return 0
  fi
  read -r total errors <<<"$(count_api_requests <<<"$logs")"
  if ((errors >= min_count && errors * 100 >= min_percent * total)); then
    problem "最近 $WINDOW_MINUTES 分钟 API 有 $errors 次 5xx，占 $total 次请求的 $((errors * 100 / total))%（阈值：至少 $min_count 次并且至少 $min_percent%）"
  else
    ok "最近 $WINDOW_MINUTES 分钟 API 请求 $total 次，其中 5xx $errors 次（阈值：至少 $min_count 次并且至少 $min_percent%）"
  fi
}

check_health
check_errors

if ((${#problems[@]} > 0)); then
  printf '[可用性] 共 %s 项异常，没有发送心跳\n' "${#problems[@]}" >&2
  exit 1
fi

heartbeat="$(env_value UPTIME_HEARTBEAT_URL)"
if [[ -z "$heartbeat" ]]; then
  printf '[可用性] 全部正常（没有配置 UPTIME_HEARTBEAT_URL，只记日志）\n'
  exit 0
fi
# 只接受 https://；本机回环地址上的 http:// 也接受（只出现在 CI 冒烟的假心跳接收端，不出这台机器）
if [[ ! "$heartbeat" =~ ^https://[^[:space:]]+$ && ! "$heartbeat" =~ ^http://127\.0\.0\.1(:[0-9]+)?/[^[:space:]]*$ ]]; then
  printf '[可用性] 异常：UPTIME_HEARTBEAT_URL 应以 https:// 开头\n' >&2
  exit 1
fi
# 不用 --show-error：curl 的报错里可能带着地址
status=0
curl --silent --fail --max-time 10 --retry 3 --output /dev/null "$heartbeat" || status=$?
if ((status != 0)); then
  printf '[可用性] 提示：发送心跳失败（curl 退出码 %s；监控服务那边会在超时后报警）\n' "$status" >&2
fi
printf '[可用性] 全部正常\n'
