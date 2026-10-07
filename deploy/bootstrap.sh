#!/usr/bin/env bash
# 服务器初始化：把一台 VPS 准备成可以部署 NOZOMI 的状态。
# 由 deploy/client/remote.sh init 通过 SSH 以 root 执行（GitHub 的 Server init 流水线和手工初始化走的是同一条路）；
# 可以反复运行，已经做过的步骤会跳过。
#
# 用法：[EDGE_MODE=<模式>] [MANAGE_FIREWALL=<1|0>] bootstrap.sh <环境> <SSH 端口> <部署公钥>
#   环境       staging | production
#   SSH 端口   连接服务器用的端口（管理防火墙时会放行它）
#   部署公钥   「类型 内容」两段，写进部署用户的 authorized_keys
#   EDGE_MODE        入口模式（ADR 0007），默认 standalone；机器上已有别的反向代理时是 behind-proxy
#   MANAGE_FIREWALL  要不要由本脚本管理服务器防火墙。不设时由入口模式推导：
#                    standalone 管（只放行 SSH、80、443）；behind-proxy 不管（一条规则都不碰）
#
# 支持的系统：Ubuntu 22.04 / 24.04；CentOS Stream、RHEL、Rocky Linux、AlmaLinux 的 9 和 10。
#
# 做的事：
#   1. 检查系统
#   2. 只安装缺少的基础工具（已有的软件包不升级）
#   3. Docker：已经装好且版本够用就原样使用，不重装、不升级；没装才从 Docker 官方软件源安装
#   4. 创建部署用户 nozomi（无密码，只能用密钥登录，属于 docker 组）
#   5. 建目录 /opt/nozomi/<环境>/
#   6. 生成 .env 里的两个数据库密码（迁移账号、应用账号）和登录签名密钥（已有的值绝不覆盖；
#      早先初始化过、还没有应用账号密码的服务器，重新运行会补上这一项）
#   7. 防火墙：要管理时只放行 SSH、80、443（Ubuntu 用 ufw，RHEL 系用 firewalld）；不管理时什么都不动
#   8. 安装每日数据库备份的定时任务
#
# 不做的事：不改 SSH 服务的任何设置（不禁用 root 登录、不禁用密码登录——那是负责人的决定，
# docs/deploy.md「可选的加固」），不改任何账号的密码，不改 SELinux 的模式，不升级系统已有的软件包，
# 不碰这台机器上别的服务（容器、网络、数据卷、端口）。
set -Eeuo pipefail
trap 'printf "[初始化] 错误：第 %s 行的命令失败，初始化中止（可以修复后重新运行）\n" "$LINENO" >&2' ERR

DEPLOY_USER=nozomi
BASE_DIR=/opt/nozomi
SUPPORTED_UBUNTU=("22.04" "24.04")
SUPPORTED_RHEL_IDS=("centos" "rhel" "rocky" "almalinux")
SUPPORTED_RHEL_MAJOR=("9" "10")
SUPPORTED_SUMMARY="Ubuntu ${SUPPORTED_UBUNTU[*]}，以及 CentOS Stream / RHEL / Rocky Linux / AlmaLinux ${SUPPORTED_RHEL_MAJOR[*]}"
# compose.behind-proxy.yml 用到的 !override 需要 Docker Compose 2.25 或更新的版本。
MIN_COMPOSE_MAJOR=2
MIN_COMPOSE_MINOR=25

# 由 detect_os 设置：debian（用 apt、ufw）或 rhel（用 dnf、firewalld），以及 /etc/os-release 里的系统标识。
OS_FAMILY=""
OS_ID=""
APT_UPDATED=0

log() { printf '[初始化] %s\n' "$*"; }
die() {
  printf '[初始化] 错误：%s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] ||
    die "初始化需要 root 权限。请暂时改用 root 账号（GitHub 上是这个环境的 VPS_SSH_USER；手工初始化是 NOZOMI_SSH_USER）再运行，结束后改回 $DEPLOY_USER"
}

contains() {
  local needle="$1" item
  shift
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

detect_os() {
  [[ -r /etc/os-release ]] || die "无法识别系统（没有 /etc/os-release）。只支持 $SUPPORTED_SUMMARY"
  local version
  # shellcheck source=/dev/null
  OS_ID="$(. /etc/os-release && printf '%s' "${ID:-}")"
  # shellcheck source=/dev/null
  version="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  if [[ "$OS_ID" == "ubuntu" ]]; then
    contains "$version" "${SUPPORTED_UBUNTU[@]}" || die "不支持的 Ubuntu 版本：$version。只支持 ${SUPPORTED_UBUNTU[*]}"
    OS_FAMILY=debian
  elif contains "$OS_ID" "${SUPPORTED_RHEL_IDS[@]}"; then
    contains "${version%%.*}" "${SUPPORTED_RHEL_MAJOR[@]}" ||
      die "不支持的 $OS_ID 版本：$version。只支持大版本 ${SUPPORTED_RHEL_MAJOR[*]}"
    OS_FAMILY=rhel
  else
    die "不支持的系统：${OS_ID:-未知} ${version}。只支持 $SUPPORTED_SUMMARY"
  fi
  log "系统：$OS_ID $version（$(uname -m)）"
}

# 安装软件包。只装指定的包，不做整机升级。
install_packages() {
  if [[ "$OS_FAMILY" == "debian" ]]; then
    if ((APT_UPDATED == 0)); then
      apt-get update -qq
      APT_UPDATED=1
    fi
    DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y -qq "$@" >/dev/null
  else
    dnf install -y -q "$@" >/dev/null
  fi
}

# 某个命令不存在时才安装提供它的软件包（已经有的不重装、不升级）。
# 用法：ensure_command <命令> <Ubuntu 的包名> <RHEL 系的包名>
ensure_command() {
  local command_name="$1" package
  command -v "$command_name" >/dev/null 2>&1 && return 0
  if [[ "$OS_FAMILY" == "debian" ]]; then package="$2"; else package="$3"; fi
  log "安装 $package（缺少 $command_name 命令）"
  install_packages "$package"
}

install_base_packages() {
  local ca_bundle=/etc/ssl/certs/ca-certificates.crt
  [[ "$OS_FAMILY" == "rhel" ]] && ca_bundle=/etc/pki/tls/certs/ca-bundle.crt
  if [[ ! -s "$ca_bundle" ]]; then
    log "安装 ca-certificates"
    install_packages ca-certificates
  fi
  ensure_command curl curl curl
  ensure_command openssl openssl openssl
  ensure_command flock util-linux util-linux
  ensure_command logger bsdutils util-linux
  ensure_command tar tar tar
  ensure_command find findutils findutils
  ensure_command awk gawk gawk
  ensure_command useradd passwd shadow-utils
  log "基础工具已就绪"
}

# Docker Compose 的版本够不够用（输出形如 2.29.1 或 v5.0.0）。
compose_version_ok() {
  local version="${1#v}" major minor
  [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]] || return 1
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  ((major > MIN_COMPOSE_MAJOR || (major == MIN_COMPOSE_MAJOR && minor >= MIN_COMPOSE_MINOR)))
}

install_docker_from_official_repo() {
  log "安装 Docker（官方软件源）"
  if [[ "$OS_FAMILY" == "debian" ]]; then
    local arch codename
    arch="$(dpkg --print-architecture)"
    # shellcheck source=/dev/null
    codename="$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$arch" "$codename" >/etc/apt/sources.list.d/docker.list
    APT_UPDATED=0
  else
    # RHEL 有自己的目录；CentOS Stream、Rocky Linux、AlmaLinux 用 centos 目录。
    local repo_os=centos
    [[ "$OS_ID" == "rhel" ]] && repo_os=rhel
    curl -fsSL --retry 3 "https://download.docker.com/linux/$repo_os/docker-ce.repo" -o /etc/yum.repos.d/docker-ce.repo
    chmod 644 /etc/yum.repos.d/docker-ce.repo
  fi
  install_packages docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  log "Docker 安装完成：$(docker --version)"
}

# 机器上已经有 Docker 时原样使用：不重装、不升级、不改它的配置（它可能正在给别的服务用）。
install_docker() {
  local compose_version
  if command -v docker >/dev/null 2>&1; then
    compose_version="$(docker compose version --short 2>/dev/null || true)"
    compose_version_ok "$compose_version" ||
      die "这台机器上已经有 Docker，但没有 Compose 插件或版本低于 $MIN_COMPOSE_MAJOR.$MIN_COMPOSE_MINOR（当前：${compose_version:-没有}）。初始化脚本不会重装或升级已有的 Docker（可能影响机器上别的服务），请先由服务器管理员处理"
    log "Docker 已安装（$(docker --version)，Compose $compose_version），版本够用：不重装、不升级"
    # 已在运行就什么都不动；没在运行（例如上一次初始化中断在启动之前）才去启动它。
    docker info >/dev/null 2>&1 && return 0
  else
    install_docker_from_official_repo
  fi
  systemctl enable --now docker >/dev/null 2>&1 || die "Docker 服务启动失败，请在服务器上运行 systemctl status docker 查看原因"
  docker info >/dev/null 2>&1 || die "Docker 已安装但无法使用（docker info 失败）"
}

selinux_state() {
  if command -v getenforce >/dev/null 2>&1; then
    getenforce
  else
    printf 'none'
  fi
}

# 只检测并说明，不改 SELinux 的模式和策略。
report_selinux() {
  case "$(selinux_state)" in
    Enforcing)
      log "SELinux：Enforcing（强制）。不改它的模式。数据库数据在 Docker 管理的数据卷里，不需要处理；从主机挂进容器的只有版本目录里的 Caddyfile，compose.yml 里已带 z 标记，由 Docker 给它打上容器可读的标签"
      ;;
    Permissive | Disabled)
      log "SELinux：$(selinux_state)。不做任何改动"
      ;;
    *)
      log "SELinux：这台机器没有 SELinux，不需要处理"
      ;;
  esac
}

# SELinux 强制模式下，把本脚本新建的文件恢复成策略规定的默认标签（例如 sshd 只读带正确标签的 authorized_keys）。
# 其他状态下什么都不做。
restore_selinux_label() {
  [[ "$(selinux_state)" == "Enforcing" ]] || return 0
  command -v restorecon >/dev/null 2>&1 || return 0
  restorecon -R "$@"
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
  restore_selinux_label "$ssh_dir"
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
# POSTGRES_PASSWORD、POSTGRES_APP_PASSWORD 和 AUTH_JWT_SECRET 是自动生成的，不要修改：
# 数据库已经用这个密码建好，改了会连不上。
HEADER
    )
  fi
  chmod 600 "$file"
  ensure_generated_secret "$file" POSTGRES_PASSWORD 24
  ensure_generated_secret "$file" POSTGRES_APP_PASSWORD 24
  ensure_generated_secret "$file" AUTH_JWT_SECRET 48
  for key in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET GOOGLE_MAPS_API_KEY; do
    ensure_placeholder "$file" "$key"
  done
  chown "$DEPLOY_USER:$DEPLOY_USER" "$file"
  chmod 600 "$file"
}

# 要管理防火墙时：先放行所有 SSH 端口，再启用防火墙，避免把自己锁在外面。
# SSH 端口取三处的并集：调用方传入的、当前这条连接实际用的、sshd 正在使用的配置里监听的（只读取，不修改）。
# 不管理时：不安装、不启用防火墙，不增删任何规则。
configure_firewall() {
  local manage="$1" given_port="$2" port ports
  if [[ "$manage" != "1" ]]; then
    log "防火墙：不管理（EDGE_MODE=$EDGE_MODE，MANAGE_FIREWALL=$manage）。没有安装或启用防火墙，没有增删任何规则，这台机器现有的端口和规则保持原样"
    return 0
  fi
  ports="$(
    {
      printf '%s\n' "$given_port"
      [[ -n "${SSH_CONNECTION:-}" ]] && awk '{print $4}' <<<"$SSH_CONNECTION"
      { sshd -T 2>/dev/null || true; } | awk '$1 == "port" {print $2}'
    } | { grep -E '^[0-9]+$' || true; } | sort -un
  )"
  [[ -n "$ports" ]] || die "没能确定 SSH 端口，为避免锁死服务器，没有启用防火墙"
  if [[ "$OS_FAMILY" == "debian" ]]; then
    ensure_command ufw ufw ufw
    for port in $ports; do
      ufw allow "$port/tcp" >/dev/null
    done
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw default deny incoming >/dev/null
    ufw default allow outgoing >/dev/null
    ufw --force enable >/dev/null
  else
    # firewall-offline-cmd 直接写永久配置，firewalld 没在运行时也能用：规则先写好，再启动服务。
    # 只往默认区域里加端口，不删除任何已有的规则；默认区域本来就拒绝没放行的入站连接。
    ensure_command firewall-offline-cmd firewalld firewalld
    for port in $ports 80 443; do
      firewall-offline-cmd --add-port="$port/tcp" >/dev/null 2>&1 ||
        die "写入防火墙规则失败（$port/tcp），没有启用防火墙"
    done
    systemctl enable --now firewalld >/dev/null 2>&1 || die "firewalld 启动失败，请在服务器上运行 systemctl status firewalld 查看原因"
    firewall-cmd --state >/dev/null 2>&1 || die "firewalld 没有在运行，防火墙规则没有生效"
    firewall-cmd --reload >/dev/null
  fi
  log "防火墙已开启，放行 TCP 端口：$(tr '\n' ' ' <<<"$ports")80 443"
}

install_backup_cron() {
  local app_env="$1" env_dir="$2" cron_file="/etc/cron.d/nozomi-backup-$1" cron_service=cron
  if [[ "$OS_FAMILY" == "debian" ]]; then
    ensure_command cron cron cronie
  else
    cron_service=crond
    ensure_command crond cron cronie
  fi
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
  restore_selinux_label "$cron_file"
  # 定时任务服务已经在运行并且开机自启时不动它；否则启动并设为开机自启。
  if ! { systemctl is-active --quiet "$cron_service" && systemctl is-enabled --quiet "$cron_service"; }; then
    systemctl enable --now "$cron_service" >/dev/null 2>&1 ||
      die "定时任务服务 $cron_service 启动失败（每日备份依赖它），请在服务器上运行 systemctl status $cron_service 查看原因"
  fi
  log "每日备份的定时任务已安装：$cron_file"
}

main() {
  local app_env="${1:-}" ssh_port="${2:-}" public_key="${3:-}" manage_firewall
  [[ "$app_env" =~ ^(staging|production)$ ]] || die "环境必须是 staging 或 production"
  if [[ ! "$ssh_port" =~ ^[0-9]{1,5}$ ]] || ((10#$ssh_port < 1 || 10#$ssh_port > 65535)); then
    die "SSH 端口必须是 1 到 65535 的数字"
  fi
  [[ "$public_key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\ [A-Za-z0-9+/=]+$ ]] ||
    die "部署公钥格式不对（应为「类型 内容」两段）"
  EDGE_MODE="${EDGE_MODE:-standalone}"
  [[ "$EDGE_MODE" =~ ^(standalone|behind-proxy)$ ]] || die "EDGE_MODE 必须是 standalone 或 behind-proxy"
  manage_firewall="${MANAGE_FIREWALL:-}"
  if [[ -z "$manage_firewall" ]]; then
    # behind-proxy：机器上还有别的服务，它们的端口必须保持原样，所以默认不碰防火墙。
    if [[ "$EDGE_MODE" == "behind-proxy" ]]; then manage_firewall=0; else manage_firewall=1; fi
  fi
  [[ "$manage_firewall" =~ ^[01]$ ]] || die "MANAGE_FIREWALL 只能是 1（管理防火墙）或 0（不管理）；不设时由 EDGE_MODE 决定"

  local env_dir="$BASE_DIR/$app_env"
  require_root
  detect_os
  report_selinux
  install_base_packages
  install_docker
  ensure_deploy_user "$public_key"
  ensure_directories "$env_dir"
  ensure_env_file "$env_dir/.env"
  configure_firewall "$manage_firewall" "$ssh_port"
  install_backup_cron "$app_env" "$env_dir"

  cat <<DONE

[初始化] 完成。接下来请你做这件事：
  以后部署都用专用账号 $DEPLOY_USER，不再用 root——
    - 用 GitHub 流水线部署：到仓库 → Settings → Environments → $app_env → Environment secrets，
      把 VPS_SSH_USER 的值改成 $DEPLOY_USER。
    - 手工部署（deploy/client/push-local.sh）：把 NOZOMI_SSH_USER 改成 $DEPLOY_USER。
DONE
  if [[ "$EDGE_MODE" == "behind-proxy" ]]; then
    cat <<DONE
这台机器的 80 / 443 和 HTTPS 证书由原有的反向代理负责：部署完成后，还要在它的配置里加一段
把域名转到本机 EDGE_LISTEN 端口的规则（docs/deploy.md「服务器上已有别的网站时」）。
DONE
  else
    cat <<DONE
另外请确认 VPS 服务商控制台里的防火墙也放行了 SSH 端口、80、443。
DONE
  fi
  cat <<DONE
Stripe 和谷歌地图的密钥以后填在 $env_dir/.env 里（docs/secrets.md）；不填也能先上线。
DONE
}

main "$@"
