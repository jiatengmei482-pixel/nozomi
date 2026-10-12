#!/usr/bin/env bash
# 对某个版本目录执行 docker compose，自动带上项目名、密钥文件和该版本的变量文件。
# 服务器上所有的 docker compose 调用都经过这里，所以都限定在 nozomi-<环境> 这一个项目里，
# 碰不到同一台机器上别的 Compose 项目的容器、网络和数据卷。
#
# 在服务器上查看当前运行的版本：
#   /opt/nozomi/<环境>/current/bin/compose.sh ps
#   /opt/nozomi/<环境>/current/bin/compose.sh logs --tail 100 api
#
# 目录约定（<根目录> 默认是 /opt/nozomi/<环境>）：
#   <根目录>/.env                      密钥（权限 600）
#   <根目录>/releases/<版本>/           本脚本所在的版本目录：compose.yml、compose.behind-proxy.yml、Caddyfile、bin/、release.env
#   <根目录>/current -> releases/<版本>  当前运行的版本
set -euo pipefail

release_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root_dir="$(cd -P "$release_dir/../.." && pwd)"
release_env="$release_dir/release.env"

if [[ ! -f "$release_env" ]]; then
  printf '错误：%s 不存在，这个版本还没有被部署过。\n' "$release_env" >&2
  exit 1
fi
if [[ ! -f "$root_dir/.env" ]]; then
  printf '错误：%s 不存在，请先运行服务器初始化（docs/deploy.md）。\n' "$root_dir/.env" >&2
  exit 1
fi

app_env="$(sed -n 's/^APP_ENV=//p' "$release_env" | tail -n 1)"
if [[ -z "$app_env" ]]; then
  printf '错误：%s 里没有 APP_ENV。\n' "$release_env" >&2
  exit 1
fi

# docker compose 里，进程环境变量优先于 --env-file。这个版本用什么值只应由两个文件决定，
# 所以先把文件里出现的变量名从环境中清掉——否则「部署新版本失败后回退旧版本」时，
# 调用方环境里新版本的 API_IMAGE 会盖掉旧版本目录里记录的镜像。
while IFS= read -r name; do
  unset "$name"
done < <(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$root_dir/.env" "$release_env")

# 地图底图的图片来源 → 内容安全策略的 img-src（ADR 0015）。
# 从 .env 里的瓦片地址取「协议 + 主机 + 端口」，和 API 下发给浏览器的底图地址是同一个变量算出来的，不会一个改了另一个没改。
#
# 这里读 .env 的方式比 docker compose 窄：只认「行首就是 变量名=值」，值原样使用（不去引号、空白、注释）。
# docker compose 还认 `export 变量名=`、行首空白、`变量名 = 值`、`变量名: 值`。两边读出来不一样的后果是 API 下发了地址而
# img-src 没放行，地图悄悄变成一片灰——所以瓦片地址的两个变量只要有一行不是标准写法就停下，不去猜 docker compose 会怎么读。
# 调用方环境里的同名变量也清掉：这两个值只由文件决定。
tile_names=(MAP_TILE_URL_TEMPLATE MAP_TILE_DARK_URL_TEMPLATE)
unset "${tile_names[@]}"
for name in "${tile_names[@]}"; do
  for env_file in "$root_dir/.env" "$release_env"; do
    if grep -E "^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*[=:]" "$env_file" | grep -Evq "^${name}="; then
      printf '错误：%s 里的 %s 不是合法的瓦片地址写法：这一行必须顶格写成「%s=地址」，不带 export、行首空格、等号两边的空格，也不能写成「变量名: 值」。\n' "$env_file" "$name" "$name" >&2
      exit 1
    fi
  done
done

# 校验规则和 packages/config 的 mapTileOrigin / 底图配置相同（apps/api/src/deploy-map-tiles-qa.test.ts 逐条核对两边的结论一致）：
# 只接受 https://主机[:端口]/…，必须含 {z}、{x}、{y}；配了暗色地址就必须有主地址。写错了在这里就停下，而不是把奇怪的字符拼进策略。
map_tile_csp_sources=""
tile_url_pattern='^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?)/[A-Za-z0-9._~/{}?=&%@:+,-]*$'
tile_template() {
  # 同一个变量出现多次时 docker compose 取最后一次（后一个 --env-file 优先），这里一样
  sed -n "s/^$1=//p" "$root_dir/.env" "$release_env" | tail -n 1
}
for name in "${tile_names[@]}"; do
  template="$(tile_template "$name")"
  [[ -n "$template" ]] || continue
  if [[ ! "$template" =~ $tile_url_pattern || "$template" != *"{z}"* || "$template" != *"{x}"* || "$template" != *"{y}"* ]]; then
    printf '错误：%s 里的 %s 不是合法的瓦片地址（应当是 https://主机/…{z}/{x}/{y}… ，三个占位符都要有，不带引号和空格）。\n' "$root_dir/.env" "$name" >&2
    exit 1
  fi
  origin="${BASH_REMATCH[1]}"
  if [[ " $map_tile_csp_sources " != *" $origin "* ]]; then
    map_tile_csp_sources="${map_tile_csp_sources:+$map_tile_csp_sources }$origin"
  fi
done
if [[ -z "$(tile_template MAP_TILE_URL_TEMPLATE)" && -n "$(tile_template MAP_TILE_DARK_URL_TEMPLATE)" ]]; then
  printf '错误：%s 里配了 MAP_TILE_DARK_URL_TEMPLATE 却没有 MAP_TILE_URL_TEMPLATE，不是合法的瓦片地址配置（API 也会因此拒绝启动）。\n' "$root_dir/.env" >&2
  exit 1
fi
export MAP_TILE_CSP_SOURCES="$map_tile_csp_sources"

files=(-f "$release_dir/compose.yml")
# 入口模式记在这个版本的 release.env 里；behind-proxy 时叠加只改端口发布的那个文件。
edge_mode="$(sed -n 's/^EDGE_MODE=//p' "$release_env" | tail -n 1)"
if [[ "$edge_mode" == "behind-proxy" ]]; then
  files+=(-f "$release_dir/compose.behind-proxy.yml")
fi
# 只有 CI 冒烟和本地验证会设置这个变量（deploy/ci/smoke.sh）。
if [[ -n "${DEPLOY_COMPOSE_OVERRIDE:-}" ]]; then
  files+=(-f "$DEPLOY_COMPOSE_OVERRIDE")
fi

exec docker compose \
  --project-name "nozomi-$app_env" \
  --project-directory "$release_dir" \
  --env-file "$root_dir/.env" \
  --env-file "$release_env" \
  "${files[@]}" \
  "$@"
