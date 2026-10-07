#!/usr/bin/env bash
# 从「发起部署的机器」对服务器执行初始化和部署的每一步。GitHub 流水线（server-init.yml、deploy.yml）
# 和手工部署（同目录的 push-local.sh）调用的都是这一个脚本，所以两条路径在服务器上执行的命令、
# 传参数的方式完全一样。
#
# 前提：环境变量 NOZOMI_SSH_DIR 指向一个目录，里面有
#   config   SSH 配置，其中名为 vps 的主机就是目标服务器（严格校验主机身份）
#   key      连接用的私钥（init 用它算出要登记到部署用户名下的公钥）
# 流水线里由 .github/actions/ssh-setup 准备；手工部署时由 push-local.sh 准备。
#
# 用法：
#   remote.sh init <环境>                     以 root 在服务器上执行 deploy/bootstrap.sh
#       读取：SSH_PORT（必填）、EDGE_MODE、MANAGE_FIREWALL、
#             DEPLOY_PUBLIC_KEY_FILE（可选：要登记到部署用户名下的公钥文件；不设时用本次连接所用私钥的公钥）
#   remote.sh upload <环境> <版本>            把这个版本的 compose 文件和脚本传到服务器的版本目录
#   remote.sh load-image <镜像:标签>…         把本机的一个或几个镜像直接传到服务器（docker save → docker load），不经过镜像仓库
#   remote.sh deploy <环境> <版本> <镜像:标签>  在服务器上执行该版本的 bin/deploy.sh deploy，退出码原样传回。
#       <镜像:标签> 是 API 镜像（…/nozomi-api:<标签>）；配对的前端镜像（…/nozomi-web:<标签>）由服务器上的脚本推出来
#       读取：APP_DOMAIN（必填）、ACME_EMAIL、EDGE_MODE、EDGE_LISTEN、DEPLOY_SKIP_PULL、
#             REGISTRY_HOST、REGISTRY_USER（要登录镜像仓库时，令牌从本脚本的标准输入传给服务器）
#   remote.sh rollback <环境>                 在服务器上回退到上一个版本
#   remote.sh platform                        输出服务器的镜像平台（linux/amd64 或 linux/arm64）
#   remote.sh public-health <域名> <次数>     从本机访问 https://<域名>/health，每 5 秒一次，返回 200 即成功
#
# 环境、版本、域名等值都作为「变量名=值」前缀传给服务器上的脚本，由服务器上的脚本负责校验；
# 这里只负责原样、安全地传过去（每个值都经过 shell 转义）。不使用 set -x，不打印任何密钥。
#
# 退出码：0 成功；2 用法或本机环境不对；3 服务器还没有初始化；其余是服务器上脚本的退出码（deploy 见 bin/deploy.sh）。
set -euo pipefail

# 服务器上每个环境的根目录是 <DEPLOY_BASE>/<环境>，与 deploy/bootstrap.sh 里的 BASE_DIR 一致。
DEPLOY_BASE=/opt/nozomi
EXIT_USAGE=2
EXIT_NOT_INITIALIZED=3

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '[远程] %s\n' "$*" >&2; }
die() {
  printf '[远程] 错误：%s\n' "$*" >&2
  exit "$EXIT_USAGE"
}

# 把一个值转义成可以安全拼进远程命令行的形式。
quoted() { printf '%q' "$1"; }

remote() {
  ssh -F "$NOZOMI_SSH_DIR/config" vps "$@"
}

require_ssh() {
  [[ -n "${NOZOMI_SSH_DIR:-}" && -f "$NOZOMI_SSH_DIR/config" ]] ||
    die "没有准备好 SSH 连接（NOZOMI_SSH_DIR）。流水线里先运行 .github/actions/ssh-setup；手工部署请用 deploy/client/push-local.sh"
}

require_env_name() {
  [[ "$1" =~ ^(staging|production)$ ]] || die "环境必须是 staging 或 production"
}

require_release_id() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "版本只能包含字母、数字、点、下划线和连字符"
}

cmd_init() {
  local app_env="${1:-}" public_key
  require_env_name "$app_env"
  require_ssh
  [[ -n "${SSH_PORT:-}" ]] || die "init 需要 SSH_PORT（连接服务器用的端口）"
  # 写进部署用户 authorized_keys 的公钥（只取「类型 内容」两段）：默认从本次连接用的私钥算出来；
  # 也可以另外指定一把——这样 root 用管理员自己的钥匙登录，部署专用的钥匙从头到尾只属于部署用户。
  if [[ -n "${DEPLOY_PUBLIC_KEY_FILE:-}" ]]; then
    [[ -s "$DEPLOY_PUBLIC_KEY_FILE" ]] || die "DEPLOY_PUBLIC_KEY_FILE 指向的公钥文件不存在或是空的"
    public_key="$(head -n 1 "$DEPLOY_PUBLIC_KEY_FILE" | cut -d' ' -f1,2)"
  else
    public_key="$(ssh-keygen -y -P '' -f "$NOZOMI_SSH_DIR/key" | cut -d' ' -f1,2)" ||
      die "读不出部署私钥对应的公钥（私钥不能带口令）"
  fi
  remote "EDGE_MODE=$(quoted "${EDGE_MODE:-}") MANAGE_FIREWALL=$(quoted "${MANAGE_FIREWALL:-}") bash -s -- $(quoted "$app_env") $(quoted "$SSH_PORT") $(quoted "$public_key")" \
    <"$deploy_dir/bootstrap.sh"
}

cmd_upload() {
  local app_env="${1:-}" release="${2:-}" root release_dir
  require_env_name "$app_env"
  require_release_id "$release"
  require_ssh
  root="$DEPLOY_BASE/$app_env"
  release_dir="$root/releases/$release"
  # 用 root 上传会在版本目录里留下 root 属主的文件，之后部署账号就改不动了：所以 root 也算「没准备好」。
  if ! remote "test \"\$(id -u)\" -ne 0 && test -f $(quoted "$root/.env") && test -w $(quoted "$root/releases")"; then
    printf '[远程] 错误：服务器还没有初始化，或当前登录的不是部署账号 nozomi（不能用 root 部署；%s 不存在或不可写）\n' "$root" >&2
    exit "$EXIT_NOT_INITIALIZED"
  fi
  tar -C "$deploy_dir" -cf - compose.yml compose.behind-proxy.yml Caddyfile bin |
    remote "mkdir -p $(quoted "$release_dir") && tar -xf - --no-same-owner -C $(quoted "$release_dir")"
  log "已上传版本目录 $release_dir"
}

cmd_load_image() {
  local image
  [[ $# -gt 0 ]] || die "用法：remote.sh load-image <镜像:标签>…"
  require_ssh
  for image in "$@"; do
    docker image inspect "$image" >/dev/null 2>&1 || die "本机没有镜像 $image，请先构建"
  done
  log "把镜像 $* 传到服务器（视网速需要几分钟）"
  docker save "$@" | gzip -c | remote "gzip -dc | docker load"
}

cmd_deploy() {
  local app_env="${1:-}" release="${2:-}" image="${3:-}" release_dir
  require_env_name "$app_env"
  require_release_id "$release"
  [[ -n "$image" ]] || die "用法：remote.sh deploy <环境> <版本> <镜像:标签>"
  require_ssh
  release_dir="$DEPLOY_BASE/$app_env/releases/$release"
  # 镜像仓库的令牌（如果有）不在这里出现：它在本脚本的标准输入里，由 ssh 原样接到服务器上 deploy.sh 的标准输入。
  remote "APP_ENV=$(quoted "$app_env") API_IMAGE=$(quoted "$image") APP_DOMAIN=$(quoted "${APP_DOMAIN:-}") ACME_EMAIL=$(quoted "${ACME_EMAIL:-}") EDGE_MODE=$(quoted "${EDGE_MODE:-}") EDGE_LISTEN=$(quoted "${EDGE_LISTEN:-}") DEPLOY_SKIP_PULL=$(quoted "${DEPLOY_SKIP_PULL:-}") REGISTRY_HOST=$(quoted "${REGISTRY_HOST:-}") REGISTRY_USER=$(quoted "${REGISTRY_USER:-}") $(quoted "$release_dir/bin/deploy.sh") deploy"
}

cmd_rollback() {
  local app_env="${1:-}"
  require_env_name "$app_env"
  require_ssh
  remote "$(quoted "$DEPLOY_BASE/$app_env/current/bin/deploy.sh") rollback"
}

cmd_platform() {
  local machine
  require_ssh
  machine="$(remote "uname -m")"
  case "$machine" in
    x86_64) printf 'linux/amd64\n' ;;
    aarch64 | arm64) printf 'linux/arm64\n' ;;
    *) die "不认识的服务器架构：$machine" ;;
  esac
}

cmd_public_health() {
  local domain="${1:-}" attempts="${2:-}" attempt code=000
  [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "域名只写域名本身（小写），不带 https:// 和路径"
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || die "用法：remote.sh public-health <域名> <次数>"
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    code="$(curl --silent --output /dev/null --max-time 10 --write-out '%{http_code}' "https://$domain/health" || true)"
    if [[ "$code" == "200" ]]; then
      log "第 $attempt 次检查：https://$domain/health 返回 200"
      return 0
    fi
    ((attempt == attempts)) || sleep 5
  done
  log "从外网访问 https://$domain/health 没有返回 200（最后一次是 $code）"
  return 1
}

main() {
  local command="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$command" in
    init) cmd_init "$@" ;;
    upload) cmd_upload "$@" ;;
    load-image) cmd_load_image "$@" ;;
    deploy) cmd_deploy "$@" ;;
    rollback) cmd_rollback "$@" ;;
    platform) cmd_platform "$@" ;;
    public-health) cmd_public_health "$@" ;;
    *) die "用法：remote.sh init | upload | load-image | deploy | rollback | platform | public-health（说明见脚本开头）" ;;
  esac
}

main "$@"
