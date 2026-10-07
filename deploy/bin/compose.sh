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
