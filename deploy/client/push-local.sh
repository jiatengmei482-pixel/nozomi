#!/usr/bin/env bash
# 手工初始化 / 部署：在开发机上运行，不依赖 GitHub 上的流水线和镜像仓库。
# 用在流水线还不能用的时候（例如流水线文件还没有合并到 main）。之后改用流水线部署时什么都不用迁移：
# 两条路径在服务器上执行的是同一批脚本（deploy/bootstrap.sh、bin/deploy.sh），都经由同目录的 remote.sh。
#
# 用法：
#   deploy/client/push-local.sh <环境> init     服务器初始化（NOZOMI_SSH_USER 用 root）
#   deploy/client/push-local.sh <环境> deploy   本机构建两个镜像（API、前端）→ 传到服务器 → 上传版本目录 → 部署（NOZOMI_SSH_USER 用 nozomi）
#
# 连接信息从环境变量读，不写进仓库，本脚本也不打印它们的值：
#   NOZOMI_SSH_HOST               服务器地址
#   NOZOMI_SSH_PORT               SSH 端口，默认 22
#   NOZOMI_SSH_USER               登录账号：init 用 root，deploy 用 nozomi
#   NOZOMI_SSH_KEY_FILE           登录用的私钥文件的路径（不能带口令）
#   NOZOMI_SSH_KNOWN_HOSTS_FILE   服务器主机密钥文件的路径（ssh-keyscan 的输出，事先核对过）；只认这里登记的主机
#
# 只对 init 有用、可选：
#   NOZOMI_DEPLOY_PUBLIC_KEY_FILE 要登记到 nozomi 账号的部署公钥文件的路径。不设时登记的是 NOZOMI_SSH_KEY_FILE 的公钥。
#                                 设了它，root 就可以用管理员自己的钥匙登录，部署专用的钥匙不需要加到 root 名下。
#
# 与环境有关的非密钥配置，含义和 GitHub Environment variables 里的同名项一样（docs/secrets.md）：
#   APP_DOMAIN        域名（deploy 必填）
#   EDGE_MODE         standalone（默认）| behind-proxy
#   EDGE_LISTEN       behind-proxy 时必填，形如 127.0.0.1:18080
#   ACME_EMAIL        可选，只在 standalone 模式有用
#   MANAGE_FIREWALL   可选，只对 init 有用；不设时由 EDGE_MODE 决定
#
# deploy 部署的是当前检出的提交：工作区必须是干净的，版本号就是提交的 SHA，镜像名是 nozomi-api:<SHA> 和 nozomi-web:<SHA>
# （API 和「Caddy + 前端静态文件」，一个版本一对）。构建前端镜像需要 BuildKit（Docker 23 起的默认构建方式）。
# 不使用 set -x。
set -euo pipefail

client_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$client_dir/../.." && pwd)"
remote="$client_dir/remote.sh"
ssh_dir=""
ssh_port=""

log() { printf '[手工部署] %s\n' "$*"; }
die() {
  printf '[手工部署] 错误：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  [[ -n "$ssh_dir" && -d "$ssh_dir" ]] && rm -rf -- "$ssh_dir"
  exit "$status"
}
trap cleanup EXIT

# 用环境变量里的连接信息生成一份临时的 SSH 配置（和流水线里 ssh-setup 生成的一样严格），结束时删除。
# 私钥和主机密钥文件不复制，只引用路径。
prepare_ssh() {
  local host="${NOZOMI_SSH_HOST:-}" user="${NOZOMI_SSH_USER:-}" key_file="${NOZOMI_SSH_KEY_FILE:-}"
  local known_hosts_file="${NOZOMI_SSH_KNOWN_HOSTS_FILE:-}" missing=()
  [[ -n "$host" ]] || missing+=(NOZOMI_SSH_HOST)
  [[ -n "$user" ]] || missing+=(NOZOMI_SSH_USER)
  [[ -n "$key_file" ]] || missing+=(NOZOMI_SSH_KEY_FILE)
  [[ -n "$known_hosts_file" ]] || missing+=(NOZOMI_SSH_KNOWN_HOSTS_FILE)
  ((${#missing[@]} == 0)) || die "还没有设置这些环境变量：${missing[*]}（说明见脚本开头）"
  ssh_port="${NOZOMI_SSH_PORT:-22}"
  [[ "$ssh_port" =~ ^[0-9]{1,5}$ ]] || die "NOZOMI_SSH_PORT 必须是数字"
  [[ "$user" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "NOZOMI_SSH_USER 不是合法的 Linux 用户名"
  [[ "$host" =~ ^[A-Za-z0-9.:-]+$ ]] || die "NOZOMI_SSH_HOST 只填 IP 或主机名，不带端口或空格"
  [[ -f "$key_file" ]] || die "NOZOMI_SSH_KEY_FILE 指向的私钥文件不存在"
  [[ -s "$known_hosts_file" ]] || die "NOZOMI_SSH_KNOWN_HOSTS_FILE 指向的文件不存在或是空的"
  ssh-keygen -y -P '' -f "$key_file" >/dev/null 2>&1 ||
    die "NOZOMI_SSH_KEY_FILE 不是可用的私钥，或者带了口令（部署专用的钥匙不能带口令）；私钥文件的权限应为 600"

  key_file="$(cd "$(dirname "$key_file")" && pwd)/$(basename "$key_file")"
  known_hosts_file="$(cd "$(dirname "$known_hosts_file")" && pwd)/$(basename "$known_hosts_file")"
  ssh_dir="$(mktemp -d)"
  chmod 700 "$ssh_dir"
  ln -s "$key_file" "$ssh_dir/key"
  (
    umask 077
    cat >"$ssh_dir/config" <<CONFIG
Host vps
  HostName $host
  Port $ssh_port
  User $user
  IdentityFile "$key_file"
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile "$known_hosts_file"
  GlobalKnownHostsFile /dev/null
  BatchMode yes
  ConnectTimeout 15
  ServerAliveInterval 30
  ServerAliveCountMax 4
  LogLevel ERROR
CONFIG
  )
  chmod 600 "$ssh_dir/config"
  export NOZOMI_SSH_DIR="$ssh_dir"
  # 连不上时把 ssh 自己报的原因也打出来（去掉服务器地址）。
  local detail
  if ! detail="$(ssh -F "$ssh_dir/config" -o LogLevel=INFO vps true 2>&1)"; then
    detail="${detail//"$host"/<服务器>}"
    [[ -z "$detail" ]] || printf '[手工部署] ssh 报告：%s\n' "$detail" >&2
    die "连不上服务器。常见原因：地址或端口不对；部署公钥没有加到 NOZOMI_SSH_USER 这个账号；NOZOMI_SSH_KNOWN_HOSTS_FILE 不是这台服务器的；短时间内登录失败过几次，服务器暂时拒绝这个来源地址（ssh 报告 Connection reset / closed，等一两分钟再试）"
  fi
}

cmd_init() {
  local app_env="$1"
  prepare_ssh
  log "初始化 $app_env 服务器"
  SSH_PORT="$ssh_port" DEPLOY_PUBLIC_KEY_FILE="${NOZOMI_DEPLOY_PUBLIC_KEY_FILE:-}" "$remote" init "$app_env"
}

cmd_deploy() {
  local app_env="$1" sha image web_image platform status=0
  [[ -n "${APP_DOMAIN:-}" ]] || die "deploy 需要 APP_DOMAIN（这个环境的域名）"
  [[ -z "$(git -C "$repo_root" status --porcelain)" ]] ||
    die "工作区有没提交的改动。手工部署的是当前提交，请先提交（或暂存起来）再运行"
  sha="$(git -C "$repo_root" rev-parse HEAD)"
  image="nozomi-api:$sha"
  # 配对的前端镜像：同一个标签，名字是 nozomi-web（服务器上的 bin/deploy.sh 按同样的规则从 API 镜像名推出它）。
  web_image="nozomi-web:$sha"
  prepare_ssh

  platform="$("$remote" platform)"
  log "构建镜像 $image（$platform）"
  docker build --quiet --platform "$platform" --file "$repo_root/apps/api/Dockerfile" --tag "$image" \
    --label "org.opencontainers.image.revision=$sha" "$repo_root" >/dev/null
  log "构建镜像 $web_image（$platform）"
  docker build --quiet --platform "$platform" --file "$repo_root/apps/web/Dockerfile" --tag "$web_image" \
    --label "org.opencontainers.image.revision=$sha" "$repo_root" >/dev/null

  "$remote" upload "$app_env" "$sha"
  "$remote" load-image "$image" "$web_image"

  log "在服务器上部署（备份 → 建应用账号 → 迁移 → 启动 → 健康检查，不健康自动回退）"
  DEPLOY_SKIP_PULL=1 "$remote" deploy "$app_env" "$sha" "$image" </dev/null || status=$?
  case "$status" in
    0) ;;
    10) die "部署失败，线上仍是旧版本：新版本在切换之前就失败了（备份、建应用账号或数据库迁移），原因见上面的日志" ;;
    20) die "部署失败，已自动回退：新版本启动后健康检查没通过，上一个版本运行正常" ;;
    30) die "部署失败，服务可能不可用：新版本不健康，而且没有可回退的版本或回退后仍不健康。见 docs/deploy.md「出问题怎么办」" ;;
    *) die "部署没有执行：参数或服务器环境有问题（退出码 $status），线上没有被改动，原因见上面的日志" ;;
  esac

  if "$remote" public-health "$APP_DOMAIN" 6; then
    log "完成：https://$APP_DOMAIN/health 从外网可以访问"
    return 0
  fi
  if [[ "${EDGE_MODE:-standalone}" == "behind-proxy" ]]; then
    log "部署已成功：服务器本机访问 ${EDGE_LISTEN:-} 的 /health 是通的。"
    log "提醒：从外网还访问不到 https://$APP_DOMAIN/health——外层代理还没有把这个域名转发过来，或证书还没有配置（docs/deploy.md「服务器上已有别的网站时」）。"
    return 0
  fi
  log "服务器上健康检查已通过，但从外网访问不到。常见原因：域名没有解析到这台服务器、服务商控制台的防火墙没放行 80/443、证书申请失败。正在回退到上一个版本。"
  "$remote" rollback "$app_env" ||
    log "没有回退：没有可回退的版本（第一次部署时是正常的），或回退后仍不健康。服务器上保持当前状态，便于排查。"
  exit 1
}

main() {
  local app_env="${1:-}" command="${2:-}"
  [[ "$app_env" =~ ^(staging|production)$ ]] || die "用法：push-local.sh <staging|production> <init|deploy>"
  case "$command" in
    init) cmd_init "$app_env" ;;
    deploy) cmd_deploy "$app_env" ;;
    *) die "用法：push-local.sh <staging|production> <init|deploy>" ;;
  esac
}

main "$@"
