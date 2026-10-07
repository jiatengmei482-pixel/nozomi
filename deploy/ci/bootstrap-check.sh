#!/usr/bin/env bash
# 初始化脚本（deploy/bootstrap.sh）的实跑检查，在真实的系统镜像里执行，每种情形都跑两遍确认第二遍什么都不改。
#
# 情形一「全新的机器，standalone」：Ubuntu 22.04 / 24.04、CentOS Stream 9 / 10 各一个容器。
#   Docker 真实地从官方软件源安装；防火墙由脚本管理（Ubuntu 是 ufw，CentOS 是 firewalld），只放行 SSH、80、443。
# 情形二「机器上已经有 Docker 和别的服务，behind-proxy」：CentOS Stream 9 / 10、Ubuntu 24.04 各一个容器。
#   事先放一个 docker 命令的替身（自称 Compose 5.x）。检查：脚本不安装、不升级 Docker，不配置 Docker 软件源，
#   除了查版本和状态不执行任何 docker 命令；不安装也不启用防火墙；MANAGE_FIREWALL 可以明确覆盖由模式推导的结果；
#   已有的 Docker 版本太旧时报错停下，而不是去升级它。
#   CentOS 上另外检查内核模块预检：运行中的内核缺 Docker 容器网络需要的模块时报错停下、什么都不装；
#   这一项用 modprobe 的替身和一个空的模块目录来模拟（容器里看不到真实内核的模块）。
# 两种情形都检查：部署用户、目录权限、密钥生成且不被覆盖、公钥不重复追加、定时任务及其服务。
#
# 容器里验证不了、所以这里没有覆盖的部分：
#   - 服务的真实启动和开机自启（docker、crond / cron、firewalld）：容器里没有 systemd，这里放了一个
#     只记录调用的 systemctl 替身；情形一里 docker 命令连的是外面这台机器的 Docker。
#   - 防火墙对真实入站流量的效果：ufw 检查的是规则内容和启用状态；firewalld 检查的是写进永久配置的规则
#     （firewall-offline-cmd 是真实执行的），firewall-cmd（问运行中的 firewalld）是替身。
#   - SELinux 为 Enforcing 时的行为：容器里没有 SELinux，只覆盖了「没有 SELinux」这一种。
#
# 用法：deploy/ci/bootstrap-check.sh        需要 Docker
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d)"
containers=()
env_file=/opt/nozomi/staging/.env
systemctl_log=/var/log/systemctl-stub.log
docker_log=/var/log/docker-stub.log

fail() {
  printf '初始化检查失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if ((${#containers[@]} > 0)); then
    docker rm --force --volumes "${containers[@]}" >/dev/null 2>&1 || true
  fi
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

# systemctl 的替身：记录每次调用；问「在不在运行 / 是不是开机自启」时回答「不是」，其余一律成功。
cat >"$work_dir/systemctl" <<STUB
#!/bin/sh
printf '%s\n' "\$*" >>$systemctl_log
case "\$1" in is-active | is-enabled) exit 1 ;; esac
exit 0
STUB
# firewall-cmd 的替身（它要连运行中的 firewalld，容器里没有）：自称在运行，重载成功。
printf '#!/bin/sh\nexit 0\n' >"$work_dir/firewall-cmd"
# docker 的替身，代表「机器上原本就有的 Docker」：记录每次调用；Compose 的版本从一个文件里读。
cat >"$work_dir/docker" <<STUB
#!/bin/sh
printf '%s\n' "\$*" >>$docker_log
case "\$*" in
  "compose version --short") cat /etc/docker-stub-compose-version ;;
  "--version") echo "Docker version 29.0.0, build stub" ;;
esac
exit 0
STUB
# modprobe 的替身：记录每次调用；/etc/modprobe-stub-missing 里列出的模块算「没有」。
cat >"$work_dir/modprobe" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >>/var/log/modprobe-stub.log
for last; do :; done
if grep -qx "$last" /etc/modprobe-stub-missing 2>/dev/null; then exit 1; fi
exit 0
STUB
chmod 755 "$work_dir/systemctl" "$work_dir/firewall-cmd" "$work_dir/docker" "$work_dir/modprobe"

# 临时生成一把只在本次检查里用的密钥，取它的公钥；结束时随临时目录一起删除。
ssh-keygen -q -t ed25519 -N '' -C '' -f "$work_dir/key"
public_key="$(cut -d' ' -f1,2 "$work_dir/key.pub")"

# 用法：bootstrap <容器> [变量=值 …] -- <环境> <SSH 端口> <公钥>
bootstrap() {
  local name="$1" env_args=()
  shift
  while [[ "$1" != "--" ]]; do
    env_args+=(--env "$1")
    shift
  done
  shift
  docker exec --interactive "${env_args[@]}" "$name" bash -s -- "$@" <"$repo_root/deploy/bootstrap.sh"
}

in_container() {
  local name="$1"
  shift
  docker exec "$name" bash -c "$*"
}

fingerprint() {
  docker exec "$1" sha256sum "$env_file" /home/nozomi/.ssh/authorized_keys /etc/cron.d/nozomi-backup-staging
}

password_digest() {
  docker exec "$1" grep '^POSTGRES_PASSWORD=' "$env_file" | sha256sum
}

app_password_digest() {
  docker exec "$1" grep '^POSTGRES_APP_PASSWORD=' "$env_file" | sha256sum
}

# 某个软件包装了没有（两类系统各用各的查询方式）。
package_installed() {
  local name="$1" family="$2" package="$3"
  if [[ "$family" == "debian" ]]; then
    in_container "$name" "dpkg-query -W -f='\${Status}' $package 2>/dev/null | grep -q 'install ok installed'"
  else
    in_container "$name" "rpm -q $package >/dev/null 2>&1"
  fi
}

start_container() {
  local name="$1" image="$2"
  shift 2
  docker run --detach --name "$name" --cap-add NET_ADMIN \
    --volume "$work_dir/systemctl:/usr/local/sbin/systemctl:ro" \
    "$@" "$image" sleep infinity >/dev/null
  containers+=("$name")
}

# 两种情形共用：用户、目录、密钥、公钥、定时任务，以及「重跑不覆盖、只补缺」。
# 用法：check_common <容器> <系统类别> [变量=值 …]（后面的变量每次运行初始化都带上）
check_common() {
  local name="$1" family="$2" first password_before app_password_before cron_service=crond cron_package=cronie
  shift 2
  local env_args=("$@")
  [[ "$family" == "debian" ]] && cron_service=cron && cron_package=cron

  [[ "$(in_container "$name" "stat -c '%a %U' $env_file")" == "600 nozomi" ]] || fail ".env 应为 600、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging')" == "750 nozomi" ]] || fail "环境目录应为 750、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging/releases')" == "750 nozomi" ]] || fail "releases 目录应为 750、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging/backups')" == "700 nozomi" ]] || fail "backups 目录应为 700、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /home/nozomi/.ssh')" == "700 nozomi" ]] || fail ".ssh 目录应为 700、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /home/nozomi/.ssh/authorized_keys')" == "600 nozomi" ]] || fail "authorized_keys 应为 600、属于 nozomi"
  [[ "$(in_container "$name" 'wc -l </home/nozomi/.ssh/authorized_keys')" == "1" ]] || fail "部署公钥应只登记一次"
  in_container "$name" "grep -qF '$public_key' /home/nozomi/.ssh/authorized_keys" || fail "authorized_keys 里应是传入的那把公钥"
  in_container "$name" "grep -Eq '^POSTGRES_PASSWORD=[0-9a-f]{48}$' $env_file" || fail "POSTGRES_PASSWORD 应为 48 位十六进制"
  in_container "$name" "grep -Eq '^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$' $env_file" || fail "POSTGRES_APP_PASSWORD 应为 48 位十六进制"
  [[ "$(in_container "$name" "grep '^POSTGRES_PASSWORD=' $env_file | cut -d= -f2 | sha256sum")" != "$(in_container "$name" "grep '^POSTGRES_APP_PASSWORD=' $env_file | cut -d= -f2 | sha256sum")" ]] ||
    fail "迁移账号和应用账号的密码不应相同"
  in_container "$name" "grep -Eq '^AUTH_JWT_SECRET=[0-9a-f]{96}$' $env_file" || fail "AUTH_JWT_SECRET 应为 96 位十六进制"
  in_container "$name" "grep -q '^STRIPE_SECRET_KEY=$' $env_file" || fail "应给 Stripe 密钥留好空位"
  in_container "$name" 'id -nG nozomi | grep -qw docker' || fail "nozomi 应属于 docker 组"
  [[ "$(in_container "$name" 'getent passwd nozomi | cut -d: -f7')" == "/bin/bash" ]] || fail "nozomi 的登录 shell 应为 bash"
  # 密码字段以 ! 或 * 开头 = 没有可用的密码（Ubuntu 是「!」，CentOS 是「!!」）。
  in_container "$name" 'getent shadow nozomi | cut -d: -f2 | grep -Eq "^[!*]"' || fail "nozomi 不应有可用的密码"
  # root 的密码字段不能被动过（容器镜像里 root 没有密码；初始化前后应一样，这里只确认没有被设成可用的值）。
  in_container "$name" 'getent shadow root | cut -d: -f2 | grep -Eq "^([!*].*)?$"' || fail "root 的密码被改动了"

  [[ "$(in_container "$name" 'stat -c "%a %U" /etc/cron.d/nozomi-backup-staging')" == "644 root" ]] || fail "定时任务文件应为 644、属于 root"
  in_container "$name" "grep -q '^17 3 \* \* \* nozomi \[ -x /opt/nozomi/staging/current/bin/backup.sh \] && /opt/nozomi/staging/current/bin/backup.sh daily ' /etc/cron.d/nozomi-backup-staging" ||
    fail "定时任务的内容不对"
  package_installed "$name" "$family" "$cron_package" || fail "应已安装定时任务服务 $cron_package"
  in_container "$name" "grep -qx 'enable --now $cron_service' $systemctl_log" || fail "应启用定时任务服务 $cron_service"
  if in_container "$name" "grep -Eq '^(restart|reload|stop|disable|mask) ' $systemctl_log"; then
    fail "初始化不应重启、停止或禁用任何服务"
  fi
  if in_container "$name" "grep -Eq '(sshd?|docker\.socket)( |$)' $systemctl_log"; then fail "初始化不应碰 SSH 服务"; fi

  # 负责人已经填过的值、以及被清空的自动生成项：重跑后前者不变，后者补上。
  password_before="$(password_digest "$name")"
  in_container "$name" "sed -i 's/^GOOGLE_MAPS_API_KEY=.*/GOOGLE_MAPS_API_KEY=placeholder-filled-by-owner/; s/^AUTH_JWT_SECRET=.*/AUTH_JWT_SECRET=/' $env_file"
  bootstrap "$name" "${env_args[@]}" -- staging 22 "$public_key" >/dev/null
  in_container "$name" "grep -q '^GOOGLE_MAPS_API_KEY=placeholder-filled-by-owner$' $env_file" || fail "已经填过的值被改动了"
  in_container "$name" "grep -Eq '^AUTH_JWT_SECRET=[0-9a-f]{96}$' $env_file" || fail "被清空的 AUTH_JWT_SECRET 应重新生成"
  [[ "$(password_digest "$name")" == "$password_before" ]] || fail "POSTGRES_PASSWORD 被改动了"

  # 在有应用账号之前初始化过的服务器：.env 里没有 POSTGRES_APP_PASSWORD。重跑后补上这一项，其余的值一个都不变。
  app_password_before="$(app_password_digest "$name")"
  bootstrap "$name" "${env_args[@]}" -- staging 22 "$public_key" >/dev/null
  [[ "$(app_password_digest "$name")" == "$app_password_before" ]] || fail "已有的 POSTGRES_APP_PASSWORD 被改动了"
  in_container "$name" "sed -i '/^POSTGRES_APP_PASSWORD=/d' $env_file"
  first="$(in_container "$name" "sha256sum <$env_file")"
  bootstrap "$name" "${env_args[@]}" -- staging 22 "$public_key" >/dev/null
  in_container "$name" "grep -Eq '^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$' $env_file" || fail "早先初始化过的服务器重跑后应补上 POSTGRES_APP_PASSWORD"
  [[ "$(in_container "$name" "grep -v '^POSTGRES_APP_PASSWORD=' $env_file | sha256sum")" == "$first" ]] || fail "补 POSTGRES_APP_PASSWORD 时改动了 .env 里别的内容"
  [[ "$(password_digest "$name")" == "$password_before" ]] || fail "补 POSTGRES_APP_PASSWORD 时 POSTGRES_PASSWORD 被改动了"
  [[ "$(in_container "$name" "stat -c '%a %U' $env_file")" == "600 nozomi" ]] || fail "补 POSTGRES_APP_PASSWORD 后 .env 应仍为 600、属于 nozomi"

  if docker exec --user nozomi --interactive "$name" bash -s -- staging 22 "$public_key" <"$repo_root/deploy/bootstrap.sh" >/dev/null 2>&1; then
    fail "非 root 运行应报错退出"
  fi
}

# 情形一：全新的机器，standalone（默认模式）。
check_fresh() {
  local label="$1" image="$2" family="$3" name="nozomi-bootstrap-check-fresh-${2//[^a-z0-9]/}" first second rules output
  printf '\n=== 全新的机器（standalone）：%s ===\n' "$label"
  start_container "$name" "$image" \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$work_dir/firewall-cmd:/usr/local/sbin/firewall-cmd:ro"

  output="$(bootstrap "$name" -- staging 22 "$public_key")"
  printf '%s\n' "$output"
  grep -q '安装 Docker（官方软件源）' <<<"$output" || fail "全新的机器上应安装 Docker"
  grep -q '防火墙已开启，放行 TCP 端口：22 80 443' <<<"$output" || fail "standalone 默认应管理防火墙"
  grep -q 'SELinux：' <<<"$output" || fail "应报告 SELinux 的状态"
  first="$(fingerprint "$name")"
  output="$(bootstrap "$name" -- staging 22 "$public_key")"
  printf '%s\n' "$output"
  grep -q '版本够用：不重装、不升级' <<<"$output" || fail "第二次运行时 Docker 已存在，应跳过安装"
  if grep -q '安装 ' <<<"$output"; then fail "第二次运行不应再安装任何软件包"; fi
  second="$(fingerprint "$name")"
  [[ "$first" == "$second" ]] || fail "第二次运行改动了 .env、authorized_keys 或定时任务"

  package_installed "$name" "$family" docker-ce || fail "应已从官方软件源安装 docker-ce"
  package_installed "$name" "$family" docker-compose-plugin || fail "应已安装 Compose 插件"
  in_container "$name" "grep -qx 'enable --now docker' $systemctl_log" || fail "新装的 Docker 应启动并设为开机自启"

  if [[ "$family" == "debian" ]]; then
    rules="$(in_container "$name" 'ufw status verbose')"
    grep -q '^Status: active' <<<"$rules" || fail "防火墙应已启用"
    grep -q 'deny (incoming)' <<<"$rules" || fail "防火墙默认应拒绝入站"
    for port in 22 80 443; do
      grep -Eq "^$port/tcp +ALLOW IN" <<<"$rules" || fail "防火墙应放行 $port/tcp"
    done
    [[ "$(grep -c 'ALLOW IN' <<<"$rules")" == "6" ]] || fail "防火墙应只放行 22、80、443（IPv4 和 IPv6 各一条）"
  else
    in_container "$name" 'test -s /etc/yum.repos.d/docker-ce.repo' || fail "应配置了 Docker 官方软件源"
    grep -q '内核模块：这里看不到运行中内核' <<<"$output" || fail "容器里看不到内核模块目录时，预检应跳过并说明"
    rules="$(in_container "$name" 'firewall-offline-cmd --list-ports' | tr ' ' '\n' | sort | tr '\n' ' ')"
    [[ "$rules" == "22/tcp 443/tcp 80/tcp " ]] || fail "firewalld 的永久配置里应只多放行 22、80、443，实际是：$rules"
    in_container "$name" "grep -qx 'enable --now firewalld' $systemctl_log" || fail "应启动 firewalld 并设为开机自启"
  fi

  check_common "$name" "$family"
}

# 情形二：机器上已经有 Docker（替身）和别的服务，behind-proxy。
check_shared() {
  local label="$1" image="$2" family="$3" name="nozomi-bootstrap-check-shared-${2//[^a-z0-9]/}" first second output firewall_package=firewalld
  [[ "$family" == "debian" ]] && firewall_package=ufw
  printf '\n=== 已有 Docker 和别的服务的机器（behind-proxy）：%s ===\n' "$label"
  start_container "$name" "$image" --volume "$work_dir/docker:/usr/local/bin/docker:ro" --volume "$work_dir/modprobe:/mnt/modprobe:ro"

  if [[ "$family" == "rhel" ]]; then
    # 内核模块预检：模拟真实机器（有模块目录、有 modprobe）。「看不到模块目录时跳过」在情形一里检查。
    in_container "$name" 'echo 5.0.1 >/etc/docker-stub-compose-version'
    # shellcheck disable=SC2016
    in_container "$name" 'cp /mnt/modprobe /usr/local/sbin/modprobe && mkdir -p "/lib/modules/$(uname -r)" && printf "xt_nat\nnft_compat\n" >/etc/modprobe-stub-missing'
    if output="$(bootstrap "$name" EDGE_MODE=behind-proxy -- staging 22 "$public_key" 2>&1)"; then
      fail "运行中的内核缺少容器网络模块时应报错退出"
    fi
    grep -q '缺少 Docker 容器网络需要的模块：xt_nat nft_compat。' <<<"$output" || fail "缺内核模块时的报错应列出缺的模块，实际输出：$output"
    grep -q "dnf install kernel-modules-extra-$(in_container "$name" 'uname -r')" <<<"$output" || fail "缺内核模块时应告诉负责人安装哪个包"
    grep -q '升级内核和 kernel-modules-extra 并重启服务器' <<<"$output" || fail "缺内核模块时应说明装不到匹配版本怎么办"
    if in_container "$name" 'id nozomi >/dev/null 2>&1 || command -v crond >/dev/null 2>&1'; then fail "内核模块预检没过时不应继续安装软件或创建用户"; fi
    if in_container "$name" "grep -Ev '^--dry-run --quiet [a-z_]+$' /var/log/modprobe-stub.log"; then fail "预检只能试探模块在不在（--dry-run），不能加载模块"; fi
    in_container "$name" ': >/etc/modprobe-stub-missing'
    output="$(bootstrap "$name" EDGE_MODE=behind-proxy -- staging 22 "$public_key")"
    grep -q '内核模块：Docker 容器网络需要的模块齐全' <<<"$output" || fail "模块齐全时应说明检查通过"
    in_container "$name" 'userdel --remove nozomi && rm -rf /opt/nozomi /etc/cron.d/nozomi-backup-staging /var/log/systemctl-stub.log /var/log/docker-stub.log'
  fi

  # 已有的 Docker 太旧（Compose 低于 2.25）：报错停下，不去升级它，也不往下做任何事。
  in_container "$name" 'echo 2.20.3 >/etc/docker-stub-compose-version'
  if output="$(bootstrap "$name" EDGE_MODE=behind-proxy -- staging 22 "$public_key" 2>&1)"; then
    fail "已有的 Docker 版本太旧时应报错退出"
  fi
  grep -q '不会重装或升级已有的 Docker' <<<"$output" || fail "版本太旧时的报错应说明不会升级，实际输出：$output"
  if in_container "$name" 'id nozomi >/dev/null 2>&1'; then fail "Docker 版本检查没过时不应继续创建用户"; fi

  in_container "$name" 'echo 5.0.1 >/etc/docker-stub-compose-version'
  output="$(bootstrap "$name" EDGE_MODE=behind-proxy -- staging 22 "$public_key")"
  printf '%s\n' "$output"
  grep -q 'Compose 5.0.1），版本够用：不重装、不升级' <<<"$output" || fail "已有 Docker 且版本够用时应说明跳过"
  grep -q '防火墙：不管理（EDGE_MODE=behind-proxy，MANAGE_FIREWALL=0）' <<<"$output" || fail "behind-proxy 默认不应管理防火墙，并在输出里说明"
  grep -q '没有增删任何规则' <<<"$output" || fail "不管理防火墙时应说明没有碰任何规则"
  first="$(fingerprint "$name")"
  bootstrap "$name" EDGE_MODE=behind-proxy -- staging 22 "$public_key" >/dev/null
  second="$(fingerprint "$name")"
  [[ "$first" == "$second" ]] || fail "第二次运行改动了 .env、authorized_keys 或定时任务"

  # Docker：没有安装、没有配置软件源、没有启动或重启；除了查版本和状态没有执行任何 docker 命令。
  if package_installed "$name" "$family" docker-ce; then fail "已有 Docker 时不应再安装 docker-ce"; fi
  if in_container "$name" 'test -e /etc/yum.repos.d/docker-ce.repo || test -e /etc/apt/sources.list.d/docker.list'; then
    fail "已有 Docker 时不应配置 Docker 软件源"
  fi
  if in_container "$name" "grep -Evx 'compose version --short|--version|info' $docker_log"; then
    fail "已有 Docker 时，初始化只应查询版本和状态，不应执行别的 docker 命令"
  fi
  if in_container "$name" "grep -Eq '(docker|containerd)' $systemctl_log"; then fail "已有且在运行的 Docker 不应被启动、重启或改动"; fi

  # 防火墙：没有安装，没有任何调用。
  if package_installed "$name" "$family" "$firewall_package"; then fail "不管理防火墙时不应安装 $firewall_package"; fi
  if in_container "$name" "grep -q firewalld $systemctl_log"; then fail "不管理防火墙时不应启动 firewalld"; fi
  if in_container "$name" 'command -v ufw || command -v firewall-offline-cmd || command -v iptables' >/dev/null; then
    fail "不管理防火墙时机器上不应多出防火墙工具"
  fi

  check_common "$name" "$family" EDGE_MODE=behind-proxy

  # MANAGE_FIREWALL 明确指定时以它为准：standalone + 0 仍然不管；behind-proxy + 1 则管理。
  output="$(bootstrap "$name" EDGE_MODE=standalone MANAGE_FIREWALL=0 -- staging 22 "$public_key")"
  grep -q '防火墙：不管理（EDGE_MODE=standalone，MANAGE_FIREWALL=0）' <<<"$output" || fail "MANAGE_FIREWALL=0 应覆盖 standalone 的默认值"
  if package_installed "$name" "$family" "$firewall_package"; then fail "MANAGE_FIREWALL=0 时不应安装 $firewall_package"; fi
  if output="$(bootstrap "$name" EDGE_MODE=behind-proxy MANAGE_FIREWALL=yes -- staging 22 "$public_key" 2>&1)"; then
    fail "MANAGE_FIREWALL 不是 0 / 1 时应报错退出"
  fi
  if output="$(bootstrap "$name" EDGE_MODE=shared -- staging 22 "$public_key" 2>&1)"; then
    fail "EDGE_MODE 不合法时应报错退出"
  fi
}

check_shared "CentOS Stream 10" quay.io/centos/centos:stream10 rhel
check_shared "CentOS Stream 9" quay.io/centos/centos:stream9 rhel
check_shared "Ubuntu 24.04" ubuntu:24.04 debian

check_fresh "Ubuntu 22.04" ubuntu:22.04 debian
check_fresh "Ubuntu 24.04" ubuntu:24.04 debian
check_fresh "CentOS Stream 9" quay.io/centos/centos:stream9 rhel
check_fresh "CentOS Stream 10" quay.io/centos/centos:stream10 rhel

printf '\n=== 不支持的系统应明确报错 ===\n'
if output="$(docker run --rm --interactive debian:12-slim bash -s -- staging 22 "$public_key" <"$repo_root/deploy/bootstrap.sh" 2>&1)"; then
  fail "在 Debian 上应报错退出"
fi
grep -q '不支持的系统' <<<"$output" || fail "在 Debian 上的报错应说明系统不支持，实际输出：$output"

printf '\n=== 初始化检查全部通过 ===\n'
