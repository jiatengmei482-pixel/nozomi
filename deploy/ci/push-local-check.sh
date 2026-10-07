#!/usr/bin/env bash
# 手工部署路径的演练：真实执行 deploy/client/push-local.sh（它再调用 remote.sh），对象是一台「演练服务器」——
# 一个带 SSH 和自己的 Docker 的 CentOS Stream 10 容器，摆成和「已经跑着别的网站的机器」一样：
#   - Docker 事先已经装好并在运行（初始化脚本应原样使用它）；
#   - 上面跑着别人的项目：一个主机网络的 nginx 占着 80 和 443，另有一个带数据卷的容器；
#   - 那个 nginx 里有一段把演练域名转到本机 EDGE_LISTEN 的配置（转发头和 docs/deploy.md 的示例一致）。
#
# 依次验证（入口模式 behind-proxy）：
#   1. 主机身份对不上时拒绝连接
#   2. push-local.sh staging init（root 用管理员的钥匙登录，登记到部署用户名下的是另一把部署专用的钥匙）：
#      不重装 Docker、不碰防火墙、建好部署用户和密钥；部署专用的钥匙登录不了 root
#   3. 用 root 部署被拒绝，服务器上什么都没留下
#   4. push-local.sh staging deploy（nozomi）：本机构建两个镜像（API、前端）→ docker save | ssh docker load → 上传版本目录 → 部署；
#      服务器上不登录、不访问任何镜像仓库；外网访问不通（演练域名解析不了）只是提醒，不算失败
#   5. 服务器本机访问 EDGE_LISTEN 正常；经那个 nginx 按域名访问正常，域名根路径和 /login 是前端的登录页；
#      审计日志记下的是 nginx 看到的客户端地址，客户端伪造的 X-Forwarded-For 不被采信
#   6. 再部署一个新提交：迁移前备份、previous 指向上一个版本
#   7. 隔离：本项目的容器名都带 nozomi-staging 前缀，只发布回环地址上的一个端口；别人的容器、数据卷、镜像、
#      80 / 443 上的服务、Docker 本身（软件包版本、进程）、SSH 服务的配置、root 的密码，前后完全一样；没有装防火墙
#
# 这里验证不了的：systemd 管理的服务（容器里没有 systemd，systemctl 是只记录调用的替身，Docker 和 sshd 是手工启动的）、
# 真实的公网域名和证书、SELinux 为 Enforcing 的情形（容器里是 Disabled，和目前的测试服务器一致）。
# standalone 模式的同一套服务器脚本由 smoke.sh 覆盖；这里不重复。
#
# 用法：deploy/ci/push-local-check.sh        需要 Docker（会启动一个特权容器）和 git
# 这里的密钥都是本次运行临时生成的，结束即删除。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_dir="$(mktemp -d)"
snapshot="$work_dir/repo"
server="nozomi-push-local-check-server"
server_image="quay.io/centos/centos:stream10"
domain="nozomi.example.test"
edge_listen="127.0.0.1:18080"
forged_address="203.0.113.99"
env_root=/opt/nozomi/staging
built_images=()

step() { printf '\n=== %s ===\n' "$*"; }
fail() {
  printf '手工部署演练失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    # 排查用：演练服务器上 sshd 的日志（去掉地址）、容器状态和 Docker 的日志。
    printf '\n--- 演练服务器的 sshd 日志 ---\n'
    docker exec "$server" cat /var/log/sshd.log 2>/dev/null | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<地址>/g' || true
    printf '\n--- 演练服务器的容器和 Docker 日志 ---\n'
    docker exec "$server" bash -c 'docker ps --all; tail -n 30 /var/log/dockerd.log' 2>/dev/null || true
  fi
  docker rm --force --volumes "$server" >/dev/null 2>&1 || true
  if ((${#built_images[@]} > 0)); then
    docker image rm "${built_images[@]}" >/dev/null 2>&1 || true
  fi
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

on_server() { docker exec "$server" bash -c "$*"; }
# 把标准输入里的脚本（或文件内容）交给演练服务器上的命令。
on_server_stdin() { docker exec --interactive "$server" "$@"; }
as_deploy_user() { docker exec --user nozomi "$server" bash -c "$*"; }

# 「别人的东西」和这台机器本身的状态：部署前后必须一模一样。
machine_state() {
  on_server_stdin bash -s <<'STATE'
docker inspect --format "{{.Name}} {{.Id}} {{.State.StartedAt}} {{.State.Status}}" deploy-nginx-1 deploy-app-1
docker volume inspect --format "{{.Name}} {{.CreatedAt}}" deploy_data
docker image inspect --format "{{.Id}}" nginx:alpine
rpm -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
cat /run/dockerd.pid /run/sshd.pid
sha256sum /etc/ssh/sshd_config /root/.ssh/authorized_keys
ls /etc/docker 2>&1
getent shadow root
getenforce
rpm -q firewalld || true
STATE
}

# 用 push-local.sh 需要的环境变量运行它。用法：push_local <登录账号> <init|deploy> [变量=值 …]
# root 用管理员的钥匙登录，nozomi 用部署专用的钥匙登录。
push_local() {
  local user="$1" command="$2" key="$work_dir/key"
  shift 2
  [[ "$user" == "root" ]] && key="$work_dir/admin-key"
  env NOZOMI_SSH_HOST="$server_address" NOZOMI_SSH_PORT=22 NOZOMI_SSH_USER="$user" \
    NOZOMI_SSH_KEY_FILE="$key" NOZOMI_SSH_KNOWN_HOSTS_FILE="$work_dir/known_hosts" \
    NOZOMI_DEPLOY_PUBLIC_KEY_FILE="$work_dir/key.pub" \
    APP_DOMAIN="$domain" EDGE_MODE=behind-proxy EDGE_LISTEN="$edge_listen" "$@" \
    "$snapshot/deploy/client/push-local.sh" staging "$command"
}

db_value() {
  as_deploy_user "$env_root/current/bin/compose.sh exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align -c \"$1\""
}

step "准备：把当前代码做成一个干净的提交（push-local.sh 只部署已提交的版本）"
mkdir -p "$snapshot"
(
  cd "$repo_root"
  git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' path; do
    if [[ -e "$path" ]]; then printf '%s\0' "$path"; fi
  done | tar --null --files-from=- -cf -
) | tar -xf - -C "$snapshot"
git -C "$snapshot" init --quiet
git -C "$snapshot" add --all
git -C "$snapshot" -c user.name=push-local-check -c user.email=push-local-check@example.test commit --quiet --message "演练用的快照"

step "准备：演练服务器（CentOS Stream 10，Docker 已装好并在运行，SSH 可登录 root）"
# 两把钥匙：admin-key 是服务器管理员登录 root 用的；key 是部署专用的，只登记到部署用户名下。
ssh-keygen -q -t ed25519 -N '' -C '' -f "$work_dir/admin-key"
ssh-keygen -q -t ed25519 -N '' -C '' -f "$work_dir/key"
# 不只依赖 ssh-keygen 的默认权限：临时目录带默认 ACL 时私钥会过宽，而 ssh 拒绝使用权限过宽的私钥。
chmod 600 "$work_dir/admin-key" "$work_dir/key"
# systemctl 的替身：记录每次调用；问「在不在运行 / 是不是开机自启」时回答「不是」，其余一律成功。
cat >"$work_dir/systemctl" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >>/var/log/systemctl-stub.log
case "$1" in is-active | is-enabled) exit 1 ;; esac
exit 0
STUB
chmod 755 "$work_dir/systemctl"
docker run --detach --privileged --name "$server" --volume /var/lib/docker \
  --volume "$work_dir/systemctl:/usr/local/sbin/systemctl:ro" "$server_image" sleep infinity >/dev/null
on_server_stdin env ROOT_PUBLIC_KEY="$(cat "$work_dir/admin-key.pub")" bash -s <<'SETUP'
set -euo pipefail
curl -fsSL --retry 3 https://download.docker.com/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin openssh-server >/dev/null
# 容器套容器时让里面的 Docker 能用 cgroup v2（和 docker:dind 镜像的做法一样）。
if [[ -f /sys/fs/cgroup/cgroup.controllers ]]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 </sys/fs/cgroup/cgroup.procs >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  sed -e 's/ / +/g' -e 's/^/+/' </sys/fs/cgroup/cgroup.controllers >/sys/fs/cgroup/cgroup.subtree_control
fi
(dockerd --pidfile /run/dockerd.pid >/var/log/dockerd.log 2>&1 &)
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then break; fi
  sleep 1
done
docker info >/dev/null
ssh-keygen -A >/dev/null
install -d -m 700 /root/.ssh
printf '%s\n' "$ROOT_PUBLIC_KEY" >/root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
/usr/sbin/sshd -o PidFile=/run/sshd.pid -E /var/log/sshd.log
SETUP
server_address="$(docker inspect --format '{{.NetworkSettings.Networks.bridge.IPAddress}}' "$server")"
# 主机密钥直接从演练服务器里读出来（不是经网络现取），相当于负责人事先核对过的指纹。
printf '%s %s\n' "$server_address" "$(on_server 'cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub')" >"$work_dir/known_hosts"

step "准备：机器上「别人的项目」——主机网络的 nginx 占着 80 和 443，并把演练域名转到 $edge_listen"
on_server 'mkdir -p /srv/neighbor'
on_server_stdin tee /srv/neighbor/site.conf >/dev/null <<CONF
server {
    listen 80 default_server;
    listen 443 default_server;
    location / { return 200 "neighbor\n"; }
}
server {
    listen 80;
    server_name $domain;
    client_max_body_size 10m;
    location / {
        proxy_pass http://$edge_listen;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF
on_server_stdin bash -s <<'NEIGHBOR' || fail "「别人的」nginx 没有起来"
set -euo pipefail
docker run --detach --name deploy-nginx-1 --label com.docker.compose.project=deploy --network host \
  --volume /srv/neighbor/site.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine >/dev/null 2>&1
docker run --detach --name deploy-app-1 --label com.docker.compose.project=deploy \
  --volume deploy_data:/data nginx:alpine tail -f /dev/null >/dev/null
for _ in $(seq 1 30); do
  if [[ "$(curl --silent --max-time 2 http://127.0.0.1:80/)" == "neighbor" ]]; then exit 0; fi
  sleep 1
done
exit 1
NEIGHBOR
state_before="$(machine_state)"

step "1. 主机身份对不上时拒绝连接"
ssh-keygen -q -t ed25519 -N '' -C '' -f "$work_dir/other-host-key"
printf '%s %s\n' "$server_address" "$(cut -d' ' -f1,2 "$work_dir/other-host-key.pub")" >"$work_dir/wrong_known_hosts"
if output="$(push_local root init NOZOMI_SSH_KNOWN_HOSTS_FILE="$work_dir/wrong_known_hosts" 2>&1)"; then
  fail "主机密钥对不上时应拒绝连接"
fi
grep -q '连不上服务器' <<<"$output" || fail "主机密钥对不上时的报错不对：$output"
if on_server 'id nozomi >/dev/null 2>&1'; then fail "主机身份没通过校验时不应在服务器上做任何事"; fi

step "2. 初始化（root）：push-local.sh staging init"
output="$(push_local root init)"
printf '%s\n' "$output"
grep -q '版本够用：不重装、不升级' <<<"$output" || fail "已有的 Docker 应原样使用"
grep -q '防火墙：不管理（EDGE_MODE=behind-proxy，MANAGE_FIREWALL=0）' <<<"$output" || fail "behind-proxy 不应管理防火墙"
grep -q 'SELinux：Disabled。不做任何改动' <<<"$output" || fail "应报告 SELinux 的状态"
if grep -qF "$server_address" <<<"$output"; then fail "输出里不应出现服务器地址"; fi
[[ "$(on_server "stat -c '%a %U' $env_root/.env")" == "600 nozomi" ]] || fail ".env 应为 600、属于 nozomi"
on_server "grep -qF '$(cut -d' ' -f2 "$work_dir/key.pub")' /home/nozomi/.ssh/authorized_keys" || fail "部署公钥应已登记到 nozomi 账号"
push_local root init >/dev/null
[[ "$(on_server 'wc -l </home/nozomi/.ssh/authorized_keys')" == "1" ]] || fail "重复初始化不应重复登记公钥"
if on_server "grep -qF '$(cut -d' ' -f2 "$work_dir/admin-key.pub")' /home/nozomi/.ssh/authorized_keys"; then
  fail "指定了部署公钥时，管理员的钥匙不应登记到 nozomi 账号"
fi
[[ "$(on_server 'cat /root/.ssh/authorized_keys')" == "$(cat "$work_dir/admin-key.pub")" ]] || fail "root 的 authorized_keys 不应被改动"
if output="$(push_local root deploy NOZOMI_SSH_KEY_FILE="$work_dir/key" 2>&1)"; then fail "部署专用的钥匙不应能登录 root"; fi
grep -q '连不上服务器' <<<"$output" || fail "部署专用的钥匙登录 root 时的报错不对：$output"

step "3. 用 root 部署被拒绝"
if output="$(push_local root deploy 2>&1)"; then fail "用 root 部署应被拒绝"; fi
grep -q '不能用 root 部署' <<<"$output" || fail "用 root 部署时的报错不对：$output"
[[ -z "$(on_server "ls -A $env_root/releases")" ]] || fail "被拒绝的部署不应在服务器上留下文件"
sha_first="$(git -C "$snapshot" rev-parse HEAD)"
built_images+=("nozomi-api:$sha_first" "nozomi-web:$sha_first")

step "4. 首次部署（nozomi）：push-local.sh staging deploy"
output="$(push_local nozomi deploy 2>&1)" || {
  printf '%s\n' "$output"
  fail "首次部署失败"
}
printf '%s\n' "$output"
grep -q '镜像已在本机，不拉取' <<<"$output" || fail "手工部署不应拉取镜像"
grep -q "入口模式 behind-proxy（本机 $edge_listen，不占用 80/443）" <<<"$output" || fail "应以 behind-proxy 模式部署"
grep -q "本机访问 http://$edge_listen/health 返回 200" <<<"$output" || fail "应以服务器本机访问 EDGE_LISTEN 为准"
grep -q '部署成功' <<<"$output" || fail "应报告部署成功"
grep -q '外层代理还没有把这个域名转发过来，或证书还没有配置' <<<"$output" || fail "外网访问不通时应给出提醒（而不是失败）"
if grep -qF "$server_address" <<<"$output"; then fail "输出里不应出现服务器地址"; fi
[[ "$(on_server "readlink $env_root/current")" == "releases/$sha_first" ]] || fail "current 应指向这次的提交"
[[ "$(on_server "stat -c '%U' $env_root/releases/$sha_first/compose.yml")" == "nozomi" ]] || fail "版本目录里的文件应属于 nozomi"
on_server "docker image inspect nozomi-api:$sha_first nozomi-web:$sha_first >/dev/null" || fail "两个镜像（API、前端）都应已传到服务器"
[[ "$(on_server 'docker inspect --format "{{.Config.Image}}" nozomi-staging-caddy-1')" == "nozomi-web:$sha_first" ]] ||
  fail "反向代理应运行这次提交的前端镜像"
if on_server 'test -e /home/nozomi/.docker/config.json'; then fail "手工部署不应在服务器上登录任何镜像仓库"; fi

step "5. 入口：本机端口、经「别人的」nginx 按域名访问、客户端真实地址"
[[ "$(on_server "curl --silent --max-time 10 http://$edge_listen/health")" == *'"status":"ok"'* ]] || fail "服务器本机访问 EDGE_LISTEN 的 /health 应为 ok"
body="$(curl --silent --max-time 10 --header "Host: $domain" "http://$server_address/health")"
[[ "$body" == *'"status":"ok"'* && "$body" == *'"env":"staging"'* ]] || fail "经外层 nginx 按域名访问 /health 应为 ok，实际是：$body"
headers="$(curl --silent --max-time 10 --head --header "Host: $domain" "http://$server_address/health")"
for header in "strict-transport-security: max-age=" "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: no-referrer"; do
  grep -qi "^$header" <<<"$headers" || fail "经外层 nginx 的响应缺少安全头 $header"
done
# 前端：负责人打开域名看到的就是这一页；刷新 /login 不 404；接口前缀（带查询串）仍然到 API。
for path in / /login /platform/login; do
  page="$(curl --silent --max-time 10 --header "Host: $domain" "http://$server_address$path")"
  [[ "$page" == *'<div id="root"></div>'* && "$page" == *'src="/assets/'* ]] || fail "经外层 nginx 按域名访问 $path 应返回前端的登录页"
done
headers="$(curl --silent --max-time 10 --head --header "Host: $domain" "http://$server_address/login")"
grep -qi "^content-security-policy: default-src 'self'; script-src 'self' 'sha256-" <<<"$headers" || fail "登录页的响应缺少内容安全策略"
grep -qi '^cache-control: no-cache' <<<"$headers" || fail "登录页（index.html）不应被缓存"
[[ "$(curl --silent --max-time 10 --header "Host: $domain" "http://$server_address/platform/v1?probe=1")" == '{"error":{"code":'* ]] ||
  fail "接口前缀应仍然转给 API，而不是返回前端页面"
[[ "$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}' --header "Host: $domain" "http://$server_address/assets/does-not-exist.js")" == "404" ]] ||
  fail "不存在的 /assets/ 文件应返回 404"
[[ "$(curl --silent --max-time 10 "http://$server_address/")" == "neighbor" ]] || fail "别人的网站（80）应照常服务"
[[ "$(curl --silent --max-time 10 "http://$server_address:443/")" == "neighbor" ]] || fail "别人的网站（443）应照常服务"
code="$(curl --silent --max-time 15 --output /dev/null --write-out '%{http_code}' \
  --header "Host: $domain" --header "X-Forwarded-For: $forged_address" --header 'content-type: application/json' \
  --data '{"email":"edge-check@example.test","password":"Rehearsal-Placeholder-Passw0rd"}' \
  "http://$server_address/platform/v1/auth/login")"
[[ "$code" == "401" ]] || fail "不存在的账号登录应返回 401，实际是 $code"
seen_by_outer_proxy="$(on_server 'docker logs deploy-nginx-1 2>/dev/null | grep "POST /platform/v1/auth/login" | tail -n 1 | cut -d" " -f1')"
recorded="$(db_value "select ip from audit_logs where action = 'login_failed' and after ->> 'email' = 'edge-check@example.test'")"
[[ -n "$seen_by_outer_proxy" && "$recorded" == "$seen_by_outer_proxy" ]] ||
  fail "审计日志记下的来源地址应是外层 nginx 看到的客户端地址 $seen_by_outer_proxy，实际是「$recorded」"
[[ "$recorded" != "$forged_address" && "$recorded" != 127.* ]] || fail "来源地址不应是伪造的值或回环地址"

step "6. 再部署一个新提交"
git -C "$snapshot" -c user.name=push-local-check -c user.email=push-local-check@example.test commit --quiet --allow-empty --message "演练用的第二个提交"
sha_second="$(git -C "$snapshot" rev-parse HEAD)"
built_images+=("nozomi-api:$sha_second" "nozomi-web:$sha_second")
output="$(push_local nozomi deploy 2>&1)" || {
  printf '%s\n' "$output"
  fail "第二次部署失败"
}
grep -q '迁移前备份数据库' <<<"$output" || fail "第二次部署应先备份"
[[ "$(on_server "readlink $env_root/current")" == "releases/$sha_second" ]] || fail "current 应指向第二个提交"
[[ "$(on_server "readlink $env_root/previous")" == "releases/$sha_first" ]] || fail "previous 应指向第一个提交"
[[ "$(on_server "ls $env_root/backups | grep -c pre-deploy")" == "1" ]] || fail "应有一份迁移前备份"
[[ "$(db_value "select count(*) from audit_logs where action = 'login_failed'")" == "1" ]] || fail "第二次部署后数据应还在"

step "7. 隔离：本项目只有自己的东西，别人的东西和机器本身前后一样"
containers="$(on_server 'docker ps --all --format "{{.Names}}" | grep -v "^deploy-" | sort | tr "\n" " "')"
[[ "$containers" == "nozomi-staging-api-1 nozomi-staging-caddy-1 nozomi-staging-db-1 " ]] ||
  fail "除了别人的容器，应只有本项目的三个容器，实际是：$containers"
# docker port 只列出真正发布到主机的端口。
[[ -z "$(on_server 'docker port nozomi-staging-db-1; docker port nozomi-staging-api-1')" ]] || fail "数据库和 API 不应发布任何主机端口"
published="$(on_server 'docker port nozomi-staging-caddy-1')"
[[ "$published" == "8080/tcp -> $edge_listen" ]] || fail "反向代理应只发布回环地址上的一个端口，实际是：$published"
[[ "$(on_server 'docker network ls --format "{{.Name}}" | grep -Ev "^(bridge|host|none)$" | sort | tr "\n" " "')" == "nozomi-staging_backend nozomi-staging_edge " ]] ||
  fail "新增的网络应只有本项目的两个"
[[ "$(on_server 'docker volume ls --format "{{.Name}}" | sort | tr "\n" " "')" == "deploy_data nozomi-staging_caddy-config nozomi-staging_caddy-data nozomi-staging_db-data " ]] ||
  fail "数据卷应只有别人的 deploy_data 和本项目的三个"
state_after="$(machine_state)"
[[ "$state_before" == "$state_after" ]] || {
  diff <(printf '%s\n' "$state_before") <(printf '%s\n' "$state_after") || true
  fail "别人的容器 / 数据卷 / 镜像，或 Docker、SSH 服务、root 密码、SELinux、防火墙被动过"
}
if on_server 'grep -Eq "(docker|containerd|ssh|firewalld)" /var/log/systemctl-stub.log'; then
  fail "初始化和部署不应对 Docker、SSH、防火墙服务做任何 systemctl 操作"
fi
[[ "$(curl --silent --max-time 10 "http://$server_address/")" == "neighbor" ]] || fail "别人的网站最后仍应照常服务"

step "手工部署演练全部通过"
