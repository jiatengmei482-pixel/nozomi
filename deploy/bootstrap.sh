#!/usr/bin/env bash
# 服务器初始化：把一台全新的 Ubuntu VPS 准备成可以部署 NOZOMI 的状态。
# 由 .github/workflows/server-init.yml 通过 SSH 以 root 执行；可以反复运行，已经做过的步骤会跳过。
#
# 用法：bootstrap.sh <环境> <SSH 端口> <部署公钥>
#   环境       staging | production
#   SSH 端口   流水线连接服务器用的端口（防火墙会放行它）
#   部署公钥   「类型 内容」两段，写进部署用户的 authorized_keys
#
# 做的事：
#   1. 检查系统（Ubuntu 22.04 / 24.04）
#   2. 安装 Docker（官方软件源）和需要的基础工具
#   3. 创建部署用户 nozomi（无密码，只能用密钥登录，属于 docker 组）
#   4. 建目录 /opt/nozomi/<环境>/
#   5. 生成 .env 里的数据库密码和登录签名密钥（已有的值绝不覆盖）
#   6. 开启防火墙，只放行 SSH、80、443
#   7. 安装每日数据库备份的定时任务
#
# 不做的事：不禁用 root 登录，不禁用密码登录——那是负责人的决定（docs/deploy.md「可选的加固」）。
set -Eeuo pipefail
trap 'printf "[初始化] 错误：第 %s 行的命令失败，初始化中止（可以修复后重新运行）\n" "$LINENO" >&2' ERR

DEPLOY_USER=nozomi
BASE_DIR=/opt/nozomi
SUPPORTED_UBUNTU=("22.04" "24.04")

log() { printf '[初始化] %s\n' "$*"; }
die() {
  printf '[初始化] 错误：%s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] ||
    die "初始化需要 root 权限。请把 GitHub 上这个环境的 VPS_SSH_USER 暂时改成 root 再运行，结束后改回 $DEPLOY_USER"
}

detect_os() {
  [[ -r /etc/os-release ]] || die "无法识别系统（没有 /etc/os-release）。只支持 Ubuntu ${SUPPORTED_UBUNTU[*]}"
  local id version supported
  # shellcheck source=/dev/null
  id="$(. /etc/os-release && printf '%s' "${ID:-}")"
  # shellcheck source=/dev/null
  version="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  [[ "$id" == "ubuntu" ]] || die "不支持的系统：${id:-未知} ${version}。只支持 Ubuntu ${SUPPORTED_UBUNTU[*]}"
  for supported in "${SUPPORTED_UBUNTU[@]}"; do
    if [[ "$version" == "$supported" ]]; then
      log "系统：Ubuntu $version（$(dpkg --print-architecture)）"
      return 0
    fi
  done
  die "不支持的 Ubuntu 版本：$version。只支持 ${SUPPORTED_UBUNTU[*]}"
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq "$@" >/dev/null
}

install_base_packages() {
  log "安装基础工具"
  apt-get update -qq
  apt_install ca-certificates curl openssl ufw cron util-linux
}

install_docker() {
  if docker compose version >/dev/null 2>&1; then
    log "Docker 已安装：$(docker --version)"
  else
    log "安装 Docker（官方软件源）"
    local arch codename
    arch="$(dpkg --print-architecture)"
    # shellcheck source=/dev/null
    codename="$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$arch" "$codename" >/etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    log "Docker 安装完成：$(docker --version)"
  fi
  # 无论是不是这次装的，都确认服务已启动并设为开机自启（上一次初始化可能中断在这一步之前）。
  systemctl enable --now docker >/dev/null 2>&1 || die "Docker 服务启动失败，请在服务器上运行 systemctl status docker 查看原因"
  docker info >/dev/null 2>&1 || die "Docker 已安装但无法使用（docker info 失败）"
}

ensure_deploy_user() {
  local public_key="$1" home ssh_dir keys
  if id "$DEPLOY_USER" >/dev/null 2>&1; then
    log "部署用户 $DEPLOY_USER 已存在"
  else
    # 不设密码：账号的密码处于锁定状态，只能用密钥登录。
    useradd --create-home --shell /bin/bash "$DEPLOY_USER"
    log "已创建部署用户 $DEPLOY_USER"
  fi
  getent group docker >/dev/null || groupadd --system docker
  usermod --append --groups docker "$DEPLOY_USER"

  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  ssh_dir="$home/.ssh"
  keys="$ssh_dir/authorized_keys"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
  touch "$keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$keys"
  chmod 600 "$keys"
  # 按密钥内容（第二段）判断是否已登记，避免重复追加。
  if grep -qF -- "$(cut -d' ' -f2 <<<"$public_key")" "$keys"; then
    log "部署公钥已在 $DEPLOY_USER 的 authorized_keys 里"
  else
    printf '%s nozomi-deploy\n' "$public_key" >>"$keys"
    log "已把部署公钥写入 $DEPLOY_USER 的 authorized_keys"
  fi
}

ensure_directories() {
  local env_dir="$1"
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE_DIR" "$env_dir" "$env_dir/releases"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$env_dir/backups"
  log "目录 $env_dir 已就绪"
}

# 输出 .env 里某一项的值（没有这一项或值为空时输出空）。
env_value() {
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

# 生成并写入一项密钥；这一项已经有值时什么都不做。值本身永远不打印。
ensure_generated_secret() {
  local file="$1" key="$2" bytes="$3" value
  if [[ -n "$(env_value "$file" "$key")" ]]; then
    log "$key 已存在，保持不变"
    return 0
  fi
  value="$(openssl rand -hex "$bytes")"
  if grep -q "^$key=" "$file"; then
    sed -i "s/^$key=.*/$key=$value/" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
  log "$key 已自动生成"
}

# 给需要负责人自己填的项留一个空行位；已经有这一项（无论填没填）就不动。
ensure_placeholder() {
  local file="$1" key="$2"
  grep -q "^$key=" "$file" || printf '%s=\n' "$key" >>"$file"
}

ensure_env_file() {
  local file="$1" key
  if [[ ! -f "$file" ]]; then
    (
      umask 077
      cat >"$file" <<'HEADER'
# NOZOMI 运行所需的密钥。每一项的说明见仓库 docs/secrets.md。
# 格式：一行一个「变量名=值」，值不加引号，等号两边不留空格。
# POSTGRES_PASSWORD 和 AUTH_JWT_SECRET 是初始化时自动生成的，不要修改：
# 数据库已经用这个密码建好，改了会连不上。
HEADER
    )
  fi
  chmod 600 "$file"
  ensure_generated_secret "$file" POSTGRES_PASSWORD 24
  ensure_generated_secret "$file" AUTH_JWT_SECRET 48
  for key in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET GOOGLE_MAPS_API_KEY; do
    ensure_placeholder "$file" "$key"
  done
  chown "$DEPLOY_USER:$DEPLOY_USER" "$file"
  chmod 600 "$file"
}

# 先放行所有 SSH 端口，再启用防火墙，避免把自己锁在外面。
# SSH 端口取三处的并集：流水线传入的、当前这条连接实际用的、sshd 配置里监听的。
configure_firewall() {
  local given_port="$1" port ports
  ports="$(
    {
      printf '%s\n' "$given_port"
      [[ -n "${SSH_CONNECTION:-}" ]] && awk '{print $4}' <<<"$SSH_CONNECTION"
      { sshd -T 2>/dev/null || true; } | awk '$1 == "port" {print $2}'
    } | { grep -E '^[0-9]+$' || true; } | sort -un
  )"
  [[ -n "$ports" ]] || die "没能确定 SSH 端口，为避免锁死服务器，没有启用防火墙"
  for port in $ports; do
    ufw allow "$port/tcp" >/dev/null
  done
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
  log "防火墙已开启，放行 TCP 端口：$(tr '\n' ' ' <<<"$ports")80 443"
}

install_backup_cron() {
  local app_env="$1" env_dir="$2" cron_file="/etc/cron.d/nozomi-backup-$1"
  cat >"$cron_file" <<CRON
# NOZOMI $app_env 每日数据库备份（由 deploy/bootstrap.sh 生成，重新运行初始化会重写）。
# 每天 03:17（服务器时间）执行；备份在 $env_dir/backups/，保留 14 天。
# 第一次部署之前 current 还不存在，这条任务什么都不做。
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * $DEPLOY_USER [ -x $env_dir/current/bin/backup.sh ] && $env_dir/current/bin/backup.sh daily 2>&1 | logger -t nozomi-backup
CRON
  chown root:root "$cron_file"
  chmod 644 "$cron_file"
  log "每日备份的定时任务已安装：$cron_file"
}

main() {
  local app_env="${1:-}" ssh_port="${2:-}" public_key="${3:-}"
  [[ "$app_env" =~ ^(staging|production)$ ]] || die "环境必须是 staging 或 production"
  if [[ ! "$ssh_port" =~ ^[0-9]{1,5}$ ]] || ((10#$ssh_port < 1 || 10#$ssh_port > 65535)); then
    die "SSH 端口必须是 1 到 65535 的数字"
  fi
  [[ "$public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\ [A-Za-z0-9+/=]+$ ]] ||
    die "部署公钥格式不对（应为「类型 内容」两段）"

  local env_dir="$BASE_DIR/$app_env"
  require_root
  detect_os
  install_base_packages
  install_docker
  ensure_deploy_user "$public_key"
  ensure_directories "$env_dir"
  ensure_env_file "$env_dir/.env"
  configure_firewall "$ssh_port"
  install_backup_cron "$app_env" "$env_dir"

  cat <<DONE

[初始化] 完成。接下来请你做两件事：
  1. 到 GitHub 仓库 → Settings → Environments → $app_env → Environment secrets，
     把 VPS_SSH_USER 的值改成 $DEPLOY_USER（以后部署都用这个专用账号，不再用 root）。
  2. 确认 VPS 服务商控制台里的防火墙也放行了 SSH 端口、80、443。
Stripe 和谷歌地图的密钥以后填在 $env_dir/.env 里（docs/secrets.md）；不填也能先上线。
DONE
}

main "$@"
