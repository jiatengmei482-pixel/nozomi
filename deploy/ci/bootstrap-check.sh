#!/usr/bin/env bash
# 初始化脚本（deploy/bootstrap.sh）的实跑检查：在全新的 Ubuntu 22.04 和 24.04 容器里各跑两遍，
# 确认第二遍什么都不改（密钥不被覆盖、公钥不重复追加），并检查用户、目录权限、防火墙规则、定时任务。
#
# 容器里验证不了、所以这里没有覆盖的部分：
#   - Docker 服务的启动和开机自启（容器里没有 systemd，这里放了一个什么都不做的 systemctl，
#     docker 命令连的是外面这台机器的 Docker）；Docker 软件包本身是真实从官方软件源安装的。
#   - 防火墙对真实入站流量的效果（这里只检查规则内容和启用状态）。
#
# 用法：deploy/ci/bootstrap-check.sh        需要 Docker
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d)"
containers=()

fail() {
  printf '初始化检查失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if ((${#containers[@]} > 0)); then
    docker rm --force "${containers[@]}" >/dev/null 2>&1 || true
  fi
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

printf '#!/bin/sh\nexit 0\n' >"$work_dir/systemctl"
chmod +x "$work_dir/systemctl"
# 临时生成一把只在本次检查里用的密钥，取它的公钥；结束时随临时目录一起删除。
ssh-keygen -q -t ed25519 -N '' -C '' -f "$work_dir/key"
public_key="$(cut -d' ' -f1,2 "$work_dir/key.pub")"

bootstrap() {
  local name="$1"
  shift
  docker exec --interactive "$name" bash -s -- "$@" <"$repo_root/deploy/bootstrap.sh"
}

fingerprint() {
  docker exec "$1" sha256sum /opt/nozomi/staging/.env /home/nozomi/.ssh/authorized_keys /etc/cron.d/nozomi-backup-staging
}

password_digest() {
  docker exec "$1" grep '^POSTGRES_PASSWORD=' /opt/nozomi/staging/.env | sha256sum
}

app_password_digest() {
  docker exec "$1" grep '^POSTGRES_APP_PASSWORD=' /opt/nozomi/staging/.env | sha256sum
}

in_container() {
  local name="$1"
  shift
  docker exec "$name" bash -c "$*"
}

check_version() {
  local version="$1" name="nozomi-bootstrap-check-${1//./}" first second rules password_before app_password_before
  printf '\n=== Ubuntu %s ===\n' "$version"
  docker run --detach --name "$name" --cap-add NET_ADMIN \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$work_dir/systemctl:/usr/local/sbin/systemctl:ro" \
    "ubuntu:$version" sleep infinity >/dev/null
  containers+=("$name")

  bootstrap "$name" staging 22 "$public_key"
  first="$(fingerprint "$name")"
  bootstrap "$name" staging 22 "$public_key"
  second="$(fingerprint "$name")"
  [[ "$first" == "$second" ]] || fail "第二次运行改动了 .env、authorized_keys 或定时任务"

  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging/.env')" == "600 nozomi" ]] || fail ".env 应为 600、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging/backups')" == "700 nozomi" ]] || fail "backups 目录应为 700、属于 nozomi"
  [[ "$(in_container "$name" 'stat -c "%a %U" /home/nozomi/.ssh/authorized_keys')" == "600 nozomi" ]] || fail "authorized_keys 应为 600、属于 nozomi"
  [[ "$(in_container "$name" 'wc -l </home/nozomi/.ssh/authorized_keys')" == "1" ]] || fail "部署公钥应只登记一次"
  in_container "$name" 'grep -Eq "^POSTGRES_PASSWORD=[0-9a-f]{48}$" /opt/nozomi/staging/.env' || fail "POSTGRES_PASSWORD 应为 48 位十六进制"
  in_container "$name" 'grep -Eq "^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$" /opt/nozomi/staging/.env' || fail "POSTGRES_APP_PASSWORD 应为 48 位十六进制"
  [[ "$(in_container "$name" 'grep "^POSTGRES_PASSWORD=" /opt/nozomi/staging/.env | cut -d= -f2 | sha256sum')" != "$(in_container "$name" 'grep "^POSTGRES_APP_PASSWORD=" /opt/nozomi/staging/.env | cut -d= -f2 | sha256sum')" ]] ||
    fail "迁移账号和应用账号的密码不应相同"
  in_container "$name" 'grep -Eq "^AUTH_JWT_SECRET=[0-9a-f]{96}$" /opt/nozomi/staging/.env' || fail "AUTH_JWT_SECRET 应为 96 位十六进制"
  in_container "$name" 'grep -q "^STRIPE_SECRET_KEY=$" /opt/nozomi/staging/.env' || fail "应给 Stripe 密钥留好空位"
  in_container "$name" 'id -nG nozomi | grep -qw docker' || fail "nozomi 应属于 docker 组"
  [[ "$(in_container "$name" 'passwd --status nozomi | cut -d" " -f2')" == "L" ]] || fail "nozomi 不应有可用的密码"
  [[ "$(in_container "$name" 'stat -c "%a %U" /etc/cron.d/nozomi-backup-staging')" == "644 root" ]] || fail "定时任务文件应为 644、属于 root"

  rules="$(in_container "$name" 'ufw status verbose')"
  grep -q '^Status: active' <<<"$rules" || fail "防火墙应已启用"
  grep -q 'deny (incoming)' <<<"$rules" || fail "防火墙默认应拒绝入站"
  for port in 22 80 443; do
    grep -Eq "^$port/tcp +ALLOW IN" <<<"$rules" || fail "防火墙应放行 $port/tcp"
  done
  [[ "$(grep -c 'ALLOW IN' <<<"$rules")" == "6" ]] || fail "防火墙应只放行 22、80、443（IPv4 和 IPv6 各一条）"

  # 负责人已经填过的值、以及被清空的自动生成项：重跑后前者不变，后者补上。
  password_before="$(password_digest "$name")"
  in_container "$name" 'sed -i "s/^GOOGLE_MAPS_API_KEY=.*/GOOGLE_MAPS_API_KEY=placeholder-filled-by-owner/; s/^AUTH_JWT_SECRET=.*/AUTH_JWT_SECRET=/" /opt/nozomi/staging/.env'
  bootstrap "$name" staging 22 "$public_key" >/dev/null
  in_container "$name" 'grep -q "^GOOGLE_MAPS_API_KEY=placeholder-filled-by-owner$" /opt/nozomi/staging/.env' || fail "已经填过的值被改动了"
  in_container "$name" 'grep -Eq "^AUTH_JWT_SECRET=[0-9a-f]{96}$" /opt/nozomi/staging/.env' || fail "被清空的 AUTH_JWT_SECRET 应重新生成"
  [[ "$(password_digest "$name")" == "$password_before" ]] || fail "POSTGRES_PASSWORD 被改动了"

  # 在有应用账号之前初始化过的服务器：.env 里没有 POSTGRES_APP_PASSWORD。重跑后补上这一项，其余的值一个都不变。
  app_password_before="$(app_password_digest "$name")"
  bootstrap "$name" staging 22 "$public_key" >/dev/null
  [[ "$(app_password_digest "$name")" == "$app_password_before" ]] || fail "已有的 POSTGRES_APP_PASSWORD 被改动了"
  in_container "$name" 'sed -i "/^POSTGRES_APP_PASSWORD=/d" /opt/nozomi/staging/.env'
  first="$(in_container "$name" 'sha256sum </opt/nozomi/staging/.env')"
  bootstrap "$name" staging 22 "$public_key" >/dev/null
  in_container "$name" 'grep -Eq "^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$" /opt/nozomi/staging/.env' || fail "早先初始化过的服务器重跑后应补上 POSTGRES_APP_PASSWORD"
  [[ "$(in_container "$name" 'grep -v "^POSTGRES_APP_PASSWORD=" /opt/nozomi/staging/.env | sha256sum')" == "$first" ]] || fail "补 POSTGRES_APP_PASSWORD 时改动了 .env 里别的内容"
  [[ "$(password_digest "$name")" == "$password_before" ]] || fail "补 POSTGRES_APP_PASSWORD 时 POSTGRES_PASSWORD 被改动了"
  [[ "$(in_container "$name" 'stat -c "%a %U" /opt/nozomi/staging/.env')" == "600 nozomi" ]] || fail "补 POSTGRES_APP_PASSWORD 后 .env 应仍为 600、属于 nozomi"

  if docker exec --user nozomi --interactive "$name" bash -s -- staging 22 "$public_key" <"$repo_root/deploy/bootstrap.sh" >/dev/null 2>&1; then
    fail "非 root 运行应报错退出"
  fi
}

check_version 22.04
check_version 24.04

printf '\n=== 不支持的系统应明确报错 ===\n'
if output="$(docker run --rm --interactive debian:12-slim bash -s -- staging 22 "$public_key" <"$repo_root/deploy/bootstrap.sh" 2>&1)"; then
  fail "在 Debian 上应报错退出"
fi
grep -q '不支持的系统' <<<"$output" || fail "在 Debian 上的报错应说明系统不支持，实际输出：$output"

printf '\n=== 初始化检查全部通过 ===\n'
