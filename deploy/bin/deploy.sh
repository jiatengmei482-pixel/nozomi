#!/usr/bin/env bash
# 在服务器上部署本脚本所在的版本目录，不健康就回退到上一个成功的版本。
# 由 .github/workflows/deploy.yml 通过 SSH 调用；流程和各退出码的含义见 docs/deploy.md。
#
# 用法：
#   APP_ENV=staging API_IMAGE=<镜像:标签> APP_DOMAIN=<域名> [ACME_EMAIL=<邮箱>] deploy.sh deploy
#   deploy.sh rollback        把 current 回退到 previous（部署后从外网访问不通时由流水线调用）
#
# deploy 的可选环境变量：
#   REGISTRY_HOST / REGISTRY_USER   需要登录镜像仓库时设置；令牌从标准输入读取，结束时自动登出
#   DEPLOY_SKIP_PULL=1              不拉镜像（只给 CI 冒烟用：镜像就在本机）
#
# 目录约定见同目录的 compose.sh。
#
# 退出码：
#   0   成功
#   1   参数或环境不对，什么都没动
#   10  切换版本之前失败（拉镜像、备份、建应用账号、迁移），正在运行的旧版本没有被替换
#   20  新版本不健康，已回退到上一个版本，上一个版本健康
#   30  新版本不健康，且没有可回退的版本或回退后仍不健康——服务可能不可用，需要人工处理
set -euo pipefail

EXIT_USAGE=1
EXIT_NOT_SWITCHED=10
EXIT_ROLLED_BACK=20
EXIT_DOWN=30

HEALTH_TIMEOUT_SECONDS=120

log() { printf '[部署] %s\n' "$*"; }
die() {
  local code="$1"
  shift
  printf '[部署] 错误：%s\n' "$*" >&2
  exit "$code"
}

release_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
releases_dir="$(dirname "$release_dir")"
root_dir="$(dirname "$releases_dir")"
release_id="$(basename "$release_dir")"

# 读取符号链接指向的版本目录（绝对路径）；链接不存在或指向的目录已不在时输出空。
linked_release() {
  local link="$root_dir/$1" target
  [[ -L "$link" ]] || return 0
  target="$(cd -P "$link" 2>/dev/null && pwd)" || return 0
  printf '%s' "$target"
}

# 原子地把 <根目录>/<名字> 指向某个版本目录。
point_link() {
  local name="$1" target_dir="$2"
  ln -s "releases/$(basename "$target_dir")" "$root_dir/.$name.new"
  mv -T "$root_dir/.$name.new" "$root_dir/$name"
}

# 让某个版本目录成为正在运行的版本，并等所有容器健康。
activate() {
  "$1/bin/compose.sh" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" --remove-orphans
}

image_of() {
  sed -n 's/^API_IMAGE=//p' "$1/release.env" | tail -n 1
}

acquire_lock() {
  exec 9>"$root_dir/.deploy.lock"
  flock -n 9 || die "$EXIT_USAGE" "这个环境有另一个部署或回退正在进行，请等它结束"
}

check_layout() {
  [[ "$(basename "$releases_dir")" == "releases" ]] ||
    die "$EXIT_USAGE" "脚本必须位于 <根目录>/releases/<版本>/bin/ 下，当前在 $release_dir"
  [[ -f "$root_dir/.env" ]] ||
    die "$EXIT_USAGE" "$root_dir/.env 不存在，请先运行服务器初始化（docs/deploy.md）"
  chmod 600 "$root_dir/.env"
  local key
  for key in POSTGRES_PASSWORD AUTH_JWT_SECRET; do
    grep -Eq "^${key}=.+" "$root_dir/.env" ||
      die "$EXIT_USAGE" "$root_dir/.env 里没有 ${key}，请重新运行服务器初始化（已有的值不会被覆盖）"
  done
  grep -Eq '^POSTGRES_PASSWORD=[A-Za-z0-9_-]+$' "$root_dir/.env" ||
    die "$EXIT_USAGE" "POSTGRES_PASSWORD 只能包含字母、数字、下划线和连字符（它会被拼进数据库连接串）"
}

# 应用账号（nozomi_api）的数据库密码。新服务器由初始化脚本生成；在此之前初始化过的服务器没有这一项，
# 这里补上：值是本机随机生成的，只写进 .env（权限 600），永远不打印。已有的值绝不改动。
# 在拿到部署锁之后调用，不会有两个部署同时写 .env。
ensure_app_db_password() {
  local env_file="$root_dir/.env" value
  if ! grep -Eq '^POSTGRES_APP_PASSWORD=.+' "$env_file"; then
    value="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
    [[ "$value" =~ ^[0-9a-f]{48}$ ]] ||
      die "$EXIT_NOT_SWITCHED" "没能生成应用账号的数据库密码，旧版本没有被替换"
    if grep -q '^POSTGRES_APP_PASSWORD=' "$env_file"; then
      sed -i "s/^POSTGRES_APP_PASSWORD=.*/POSTGRES_APP_PASSWORD=$value/" "$env_file"
    else
      # 文件末尾可能没有换行，先补一个，避免和上一行连在一起
      [[ -z "$(tail -c 1 "$env_file")" ]] || printf '\n' >>"$env_file"
      printf 'POSTGRES_APP_PASSWORD=%s\n' "$value" >>"$env_file"
    fi
    chmod 600 "$env_file"
    log "POSTGRES_APP_PASSWORD（应用账号的数据库密码）原先没有，已自动生成并写入 .env"
  fi
  grep -Eq '^POSTGRES_APP_PASSWORD=[A-Za-z0-9_-]{8,}$' "$env_file" ||
    die "$EXIT_USAGE" "POSTGRES_APP_PASSWORD 至少 8 个字符，只能包含字母、数字、下划线和连字符（它会被拼进数据库连接串）"
  [[ "$(sed -n 's/^POSTGRES_APP_PASSWORD=//p' "$env_file" | tail -n 1)" != "$(sed -n 's/^POSTGRES_PASSWORD=//p' "$env_file" | tail -n 1)" ]] ||
    die "$EXIT_USAGE" "POSTGRES_APP_PASSWORD 不能和 POSTGRES_PASSWORD 相同：应用账号和迁移账号必须各用各的密码"
}

# 版本目录里的文件没有密钥。Caddyfile 要挂进反向代理容器，而容器里的进程去掉了
# 「无视文件权限」的特权，所以它必须所有人可读——不能依赖上传时服务器上的 umask。
normalize_permissions() {
  chmod 755 "$release_dir" "$release_dir/bin"
  chmod 644 "$release_dir/compose.yml" "$release_dir/Caddyfile"
  chmod 755 "$release_dir"/bin/*.sh
}

write_release_env() {
  local tls_mode=auto
  [[ -n "${ACME_EMAIL:-}" ]] && tls_mode=email
  cat >"$release_dir/release.env" <<ENV
# 由 bin/deploy.sh 生成，不含密钥。不要手工修改：下次部署会重写。
APP_ENV=$APP_ENV
APP_DOMAIN=$APP_DOMAIN
ACME_EMAIL=${ACME_EMAIL:-}
CADDY_TLS_MODE=$tls_mode
API_IMAGE=$API_IMAGE
ENV
}

registry_logout() {
  docker logout "$REGISTRY_HOST" >/dev/null 2>&1 || true
}

# 令牌只从标准输入读，不出现在命令行参数里；脚本退出时（无论成败）登出。
registry_login() {
  [[ -n "${REGISTRY_USER:-}" ]] || return 0
  [[ -n "${REGISTRY_HOST:-}" ]] || die "$EXIT_USAGE" "设置了 REGISTRY_USER 就必须同时设置 REGISTRY_HOST"
  trap registry_logout EXIT
  docker login "$REGISTRY_HOST" --username "$REGISTRY_USER" --password-stdin >/dev/null ||
    die "$EXIT_NOT_SWITCHED" "登录镜像仓库失败，旧版本没有被替换"
}

# 只保留 current 和 previous 两个版本的目录和镜像，其余删除。清理失败不影响部署结果。
cleanup_old() {
  local current previous dir keep_images image ref
  current="$(linked_release current)"
  previous="$(linked_release previous)"
  for dir in "$releases_dir"/*/; do
    dir="${dir%/}"
    [[ "$dir" == "$current" || "$dir" == "$previous" ]] && continue
    rm -rf "$dir"
  done
  keep_images="$(image_of "$current")"
  [[ -n "$previous" ]] && keep_images+=$'\n'"$(image_of "$previous")"
  image="${API_IMAGE%:*}"
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$image" | while IFS= read -r ref; do
    grep -qxF "$ref" <<<"$keep_images" || docker image rm "$ref" >/dev/null 2>&1 || true
  done
}

# 回退到指定版本目录；成功返回 0。
roll_back_to() {
  local fallback="$1"
  log "回退到上一个版本 $(basename "$fallback")（镜像 $(image_of "$fallback")）"
  activate "$fallback"
}

cmd_deploy() {
  [[ "${APP_ENV:-}" =~ ^(staging|production|ci)$ ]] ||
    die "$EXIT_USAGE" "APP_ENV 必须是 staging、production 或 ci"
  [[ "${API_IMAGE:-}" =~ ^([a-z0-9][a-z0-9.-]*(:[0-9]+)?/)?[a-z0-9]+([._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._-]*$ ]] ||
    die "$EXIT_USAGE" "API_IMAGE 必须是「[仓库地址/]镜像名:标签」的形式"
  [[ "${APP_DOMAIN:-}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] ||
    die "$EXIT_USAGE" "APP_DOMAIN 只写域名本身（小写），不带 https:// 和路径"
  [[ -z "${ACME_EMAIL:-}" || "$ACME_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] ||
    die "$EXIT_USAGE" "ACME_EMAIL 不是合法的邮箱地址"
  # 真实环境必须用部署专用账号：用 root 部署会留下 root 属主的文件，之后部署账号就写不进去了。
  [[ "$APP_ENV" == "ci" || "$(id -u)" -ne 0 ]] ||
    die "$EXIT_USAGE" "不要用 root 部署。请把 GitHub 上这个环境的 VPS_SSH_USER 改成 nozomi（初始化流程已建好这个账号）再重新部署"
  check_layout
  acquire_lock
  ensure_app_db_password

  local current fallback
  current="$(linked_release current)"
  # 重新部署当前版本时，可回退的是再上一个版本。
  if [[ "$current" == "$release_dir" ]]; then
    fallback="$(linked_release previous)"
  else
    fallback="$current"
  fi

  log "环境 $APP_ENV，版本 $release_id，镜像 $API_IMAGE"
  normalize_permissions
  write_release_env
  registry_login

  if [[ "${DEPLOY_SKIP_PULL:-}" != "1" ]]; then
    log "拉取镜像"
    "$release_dir/bin/compose.sh" pull --quiet api ||
      die "$EXIT_NOT_SWITCHED" "拉取镜像失败，旧版本没有被替换"
  fi

  log "确认数据库在运行"
  "$release_dir/bin/compose.sh" up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS" db ||
    die "$EXIT_NOT_SWITCHED" "数据库没有就绪，旧版本没有被替换"

  if [[ -n "$current" ]]; then
    log "迁移前备份数据库"
    "$release_dir/bin/backup.sh" pre-deploy ||
      die "$EXIT_NOT_SWITCHED" "迁移前备份失败，为安全起见中止部署，旧版本没有被替换"
  fi

  # 两步都用迁移账号，在临时的 migrate 容器里执行；api 容器拿不到迁移账号的密码（ADR 0010）。
  log "创建 / 核对数据库的应用账号"
  "$release_dir/bin/compose.sh" run --rm --no-deps -T migrate node apps/api/src/db/provision-cli.ts ||
    die "$EXIT_NOT_SWITCHED" "创建数据库的应用账号失败，旧版本没有被替换"

  log "执行数据库迁移"
  "$release_dir/bin/compose.sh" run --rm --no-deps -T migrate node apps/api/src/db/migrate-cli.ts ||
    die "$EXIT_NOT_SWITCHED" "数据库迁移失败（出错的那个迁移已整体撤销），旧版本没有被替换"

  log "启动新版本并等待健康检查通过（最多 $HEALTH_TIMEOUT_SECONDS 秒）"
  if activate "$release_dir"; then
    if [[ "$current" != "$release_dir" ]]; then
      [[ -n "$current" ]] && point_link previous "$current"
      point_link current "$release_dir"
    fi
    cleanup_old || log "清理旧版本和旧镜像时出错（不影响本次部署结果）"
    log "部署成功：$release_id 已在运行"
    return 0
  fi

  log "新版本没有在限时内变健康，各容器状态："
  "$release_dir/bin/compose.sh" ps --all || true
  if [[ -z "$fallback" ]]; then
    die "$EXIT_DOWN" "没有可回退的版本（这是第一次部署，或上一个版本已不在）。容器保持现状以便排查：在服务器上运行 $release_dir/bin/compose.sh logs --tail 100 api"
  fi
  if roll_back_to "$fallback"; then
    die "$EXIT_ROLLED_BACK" "新版本 $release_id 不健康，已回退，上一个版本 $(basename "$fallback") 运行正常"
  fi
  die "$EXIT_DOWN" "新版本不健康，回退后的上一个版本也不健康，服务可能不可用。如果这次部署带了新的数据库迁移，旧版本不认识新结构：请修复后重新部署，或用迁移前的备份恢复（docs/deploy.md）"
}

cmd_rollback() {
  [[ -f "$root_dir/.env" ]] || die "$EXIT_USAGE" "$root_dir/.env 不存在"
  acquire_lock
  local current previous
  current="$(linked_release current)"
  previous="$(linked_release previous)"
  [[ -n "$previous" ]] ||
    die "$EXIT_DOWN" "没有可回退的版本（previous 不存在），当前版本保持不动"
  if roll_back_to "$previous"; then
    point_link current "$previous"
    rm -f "$root_dir/previous"
    log "已回退：${current:+$(basename "$current") → }$(basename "$previous")"
    return 0
  fi
  die "$EXIT_DOWN" "回退后的版本也不健康，服务可能不可用，需要人工处理"
}

main() {
  case "${1:-}" in
    deploy) cmd_deploy ;;
    rollback) cmd_rollback ;;
    *) die "$EXIT_USAGE" "用法：deploy.sh deploy | rollback（说明见脚本开头）" ;;
  esac
}

main "$@"
