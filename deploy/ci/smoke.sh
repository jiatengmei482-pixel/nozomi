#!/usr/bin/env bash
# 部署冒烟：在本机（CI 的 runner 或开发机）上用和服务器完全相同的镜像、compose 文件、Caddyfile、
# bin/ 脚本把整套服务真实跑一遍，镜像不经过镜像仓库。两种入口模式（ADR 0007）各跑一遍：
#
#   smoke.sh               standalone：Caddy 自己终结 HTTPS。和真实部署的差别只有 deploy/ci/compose.ci.yml 里的
#                          两处（自签证书、高位端口）。
#   smoke.sh behind-proxy  机器上已有别的反向代理：这里用一个主机网络的 nginx 容器模拟它，转发到 EDGE_LISTEN。
#                          compose 文件、Caddyfile 和真实部署完全一样，没有任何覆盖文件。
#
# 依次验证：
#   1. 首次部署：建应用账号 → 迁移 → 启动 → 经反向代理访问 /health 返回 200
#      （.env 里故意不放应用账号的密码，模拟「在有应用账号之前就初始化过的服务器」：部署时应自动补上）
#   2. 安全响应头齐全；访问日志里没有查询串；数据库和 API 没有映射端口到主机；
#      behind-proxy 时反向代理只发布回环地址上的一个端口，不占 80/443
#   3. 前端（ADR 0007「前端接入部署」）：域名根路径是登录页所在的 index.html；刷新任意前端地址不 404；
#      接口前缀（含前缀本身带查询串）仍然到 API；不存在的 /assets/ 文件是 404；内容安全策略里的哈希和页面里的
#      内联脚本对得上；/assets/ 长缓存，index.html 不缓存
#   4. 客户端真实地址：审计日志和登录限速拿到的是最外层客户端的地址，客户端自己伪造的 X-Forwarded-For 不被采信
#      （standalone 信 1 层，behind-proxy 信 2 层，层数由入口模式推导）
#   5. 数据库的两个账号（ADR 0010）：api 容器只有应用账号的连接串；它不是超级用户、不拥有任何表；
#      用它自己的连接串去读表、改删审计日志、关触发器，全部被数据库拒绝
#   6. 部署一个起不来的版本：自动回退，旧版本继续服务，退出码 20
#   7. 再部署一个前端和后端都换了镜像的好版本，然后手动回退（流水线在外网访问不通时走的那条路）：
#      前端和后端一起回到上一个版本
#   8. 和别的项目隔离：本项目的容器 / 网络 / 数据卷都以 nozomi-ci 开头；事先放在旁边的「别人的」容器、
#      数据卷和镜像，在多次部署、清理旧镜像、回退之后原样还在
#   9. 建管理员 → 经反向代理登录并用令牌取自己的资料 → 备份 → 删掉数据 → 恢复 → 数据回来，登录照常可用，
#      应用账号仍是最小权限
#
# 用法：deploy/ci/smoke.sh [standalone|behind-proxy]
#   需要 Docker（带 BuildKit）、curl、perl、openssl；占用本机 127.0.0.1 的 18080、18443（standalone）或 18080、18088（behind-proxy）端口
# 这里出现的所有「密码」都是明显的占位值，数据库是本次运行临时起的容器，结束即删除。
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mode="${1:-standalone}"
https_port="${SMOKE_HTTPS_PORT:-18443}"
edge_port="${SMOKE_EDGE_PORT:-18080}"
outer_port="${SMOKE_OUTER_PORT:-18088}"
# 一个版本是一对同标签的镜像：API（nozomi-api）和「Caddy + 前端静态文件」（nozomi-web）。
# 部署时只传 API 镜像，配对的前端镜像由 bin/deploy.sh 推出来。
good_image="nozomi-api:smoke-good"
good_web_image="nozomi-web:smoke-good"
bad_image="nozomi-api:smoke-bad"
bad_web_image="nozomi-web:smoke-bad"
next_image="nozomi-api:smoke-next"
next_web_image="nozomi-web:smoke-next"
# 只有「下一个版本」的前端里有这个文件：用来确认前端跟着版本一起切换、一起回退。
version_marker_path="/smoke-version.txt"
admin_email="smoke-admin@example.test"
admin_password="Smoke-Placeholder-Passw0rd"
# 冒烟里「最外层客户端」用的源地址（回环网段里一个不常用的地址），和客户端伪造的地址（文档示例网段）。
client_address="127.0.0.42"
forged_address="203.0.113.99"
outer_proxy="smoke-outer-proxy"
neighbor="smoke-neighbor"
neighbor_image="smoke-neighbor-image:keep"

work_dir="$(mktemp -d)"
root_dir="$work_dir/root"

export DEPLOY_SKIP_PULL=1
export APP_ENV=ci
export APP_DOMAIN=localhost
case "$mode" in
  standalone)
    export DEPLOY_COMPOSE_OVERRIDE="$repo_root/deploy/ci/compose.ci.yml"
    base_url="https://localhost:$https_port"
    # 证书是 Caddy 自签的。
    curl_options=(--insecure)
    ;;
  behind-proxy)
    export EDGE_MODE=behind-proxy
    export EDGE_LISTEN="127.0.0.1:$edge_port"
    # 和真实流量一样，从外层代理进来。
    base_url="http://127.0.0.1:$outer_port"
    curl_options=()
    ;;
  *)
    printf '用法：smoke.sh [standalone|behind-proxy]\n' >&2
    exit 1
    ;;
esac

step() { printf '\n=== %s ===\n' "$*"; }
fail() {
  printf '冒烟失败：%s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [[ -x "$root_dir/current/bin/compose.sh" ]]; then
    if [[ $status -ne 0 ]]; then
      "$root_dir/current/bin/compose.sh" ps --all || true
      "$root_dir/current/bin/compose.sh" logs --tail 40 || true
    fi
  fi
  docker compose --project-name nozomi-ci down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker rm --force --volumes "$outer_proxy" "$neighbor" >/dev/null 2>&1 || true
  docker volume rm "$neighbor-data" >/dev/null 2>&1 || true
  docker image rm "$good_image" "$good_web_image" "$bad_image" "$bad_web_image" "$next_image" "$next_web_image" \
    "$neighbor_image" >/dev/null 2>&1 || true
  [[ -n "$work_dir" && -d "$work_dir" ]] && rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT

# 和 deploy/client/remote.sh 上传到服务器的是同一组文件。
install_release() {
  local dir="$root_dir/releases/$1"
  mkdir -p "$dir"
  tar -C "$repo_root/deploy" -cf - compose.yml compose.behind-proxy.yml Caddyfile bin | tar -xf - -C "$dir"
  # 模拟服务器上 umask 很严的情况：上传的文件只有属主能读，deploy.sh 必须自己把权限摆对。
  chmod -R go-rwx "$dir"
}

deploy_release() {
  API_IMAGE="$2" "$root_dir/releases/$1/bin/deploy.sh" deploy </dev/null
}

compose() { "$root_dir/current/bin/compose.sh" "$@"; }

# 用迁移账号在数据库容器里执行一条查询，输出单个值。
db_value() {
  compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align -c "$1"
}

# 在 api 容器里，用它自己环境里的连接串（也就是服务进程实际用的账号）逐条尝试越权操作。
# 每条都应被数据库以「没有权限」（42501）拒绝；输出「denied=被拒绝的条数/总条数 allowed=没被拒绝的语句」。
read -r -d '' tamper_script <<'JS' || true
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const asPlatform = "set role nozomi_platform; ";
const attempts = [
  "select count(*) from audit_logs",
  "select count(*) from tenant_users",
  "select count(*) from platform_users",
  "delete from audit_logs",
  "truncate audit_logs",
  "drop table audit_logs",
  "alter table audit_logs disable trigger user",
  "set session_replication_role = replica",
  "set role nozomi",
  "alter role nozomi_api superuser",
  asPlatform + "update audit_logs set action = 'tampered'",
  asPlatform + "delete from audit_logs",
  asPlatform + "truncate audit_logs",
  asPlatform + "drop table audit_logs",
  asPlatform + "alter table audit_logs disable trigger user",
  asPlatform + "set session_replication_role = replica",
  asPlatform + "alter table tenant_users disable row level security",
];
let denied = 0;
const allowed = [];
for (const sql of attempts) {
  try {
    await client.query("reset role");
    await client.query(sql);
    allowed.push(sql);
  } catch (err) {
    if (err.code === "42501") denied += 1;
    else allowed.push(`${sql} -> ${err.code}`);
  }
}
await client.end();
console.log(`denied=${denied}/${attempts.length} allowed=${allowed.join(" | ")}`);
JS

# 服务进程用的数据库账号是最小权限的应用账号，而且真的越不了权。部署后、恢复后各查一遍。
check_db_accounts() {
  local label="$1" value
  if compose exec -T api printenv DATABASE_MIGRATION_URL >/dev/null 2>&1; then
    fail "$label：api 容器的环境里不应有迁移账号的连接串"
  fi
  [[ "$(compose exec -T api printenv DATABASE_URL)" == postgres://nozomi_api:* ]] ||
    fail "$label：api 容器的 DATABASE_URL 应是应用账号 nozomi_api"
  if compose exec -T api env | grep -qF "$migration_password"; then
    fail "$label：api 容器的环境里出现了迁移账号的密码"
  fi

  value="$(db_value "select string_agg(distinct usename::text, ',') from pg_stat_activity where application_name = 'nozomi-api'")"
  [[ "$value" == "nozomi_api" ]] || fail "$label：数据库看到的 API 连接应全部来自 nozomi_api，实际是「$value」"
  value="$(db_value "select rolsuper::int + rolcreaterole::int + rolcreatedb::int + rolbypassrls::int + rolreplication::int + rolinherit::int from pg_roles where rolname = 'nozomi_api'")"
  [[ "$value" == "0" ]] || fail "$label：应用账号带有不该有的属性（超级用户、建角色、建库、绕过行级安全、复制、自动继承之一）"
  value="$(db_value "select string_agg(g.rolname || ':' || m.inherit_option, ',' order by g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member where u.rolname = 'nozomi_api'")"
  [[ "$value" == "nozomi_app:false,nozomi_platform:false,nozomi_preauth:false" ]] ||
    fail "$label：应用账号应恰好是三个权限角色的成员且不自动继承，实际是「$value」"
  value="$(db_value "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and pg_get_userbyid(c.relowner) <> 'nozomi'")"
  [[ "$value" == "0" ]] || fail "$label：有 $value 个表 / 索引 / 序列不属于迁移账号"
  value="$(db_value "select count(*) from pg_tables where schemaname = 'public' and tablename = 'audit_logs'")"
  [[ "$value" == "1" ]] || fail "$label：前提不成立，审计日志表不存在"

  value="$(compose exec -T -w /app/apps/api api node --input-type=module -e "$tamper_script")"
  [[ "$value" == "denied=17/17 allowed=" ]] || fail "$label：应用账号的越权尝试没有全部被拒绝：$value"
}

# 经反向代理发请求（standalone 直接到 Caddy 的 HTTPS；behind-proxy 先到外层代理）。
request() {
  curl --silent "${curl_options[@]}" "$@"
}

login_status() {
  request --max-time 15 --output /dev/null --write-out '%{http_code}' \
    --header 'content-type: application/json' \
    --data "{\"email\":\"$admin_email\",\"password\":\"$admin_password\"}" \
    "$base_url/platform/v1/auth/login" || true
}

# 经反向代理登录，输出访问令牌（登录没成功时输出空）。
login_access_token() {
  request --max-time 15 --header 'content-type: application/json' \
    --data "{\"email\":\"$admin_email\",\"password\":\"$admin_password\"}" \
    "$base_url/platform/v1/auth/login" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p' || true
}

status_of() {
  request --max-time 10 --output /dev/null --write-out '%{http_code}' "$base_url$1" || true
}

# 某个地址的响应头，统一成小写、去掉行尾的回车，便于比较。
headers_of() {
  request --max-time 10 --head "$base_url$1" | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}

# api 和反向代理两个容器正在用的镜像。
running_images() {
  docker inspect --format '{{.Config.Image}}' "$(compose ps --quiet api)" "$(compose ps --quiet caddy)" | paste -sd ' '
}

# 前端：和负责人在浏览器里做的事一样，全部经反向代理（behind-proxy 时再经外层代理）。部署后、回退后各查一遍。
# 内容安全策略里应当放行的地图底图来源；没配底图时为空。
expected_tile_origin=""

check_frontend() {
  local label="$1" index headers policy script_hash path body asset stylesheet
  index="$(request --max-time 10 "$base_url/")"
  grep -qF '<div id="root"></div>' <<<"$index" || fail "$label：域名根路径应返回前端的 index.html"
  [[ "$(status_of "/")" == "200" ]] || fail "$label：域名根路径应返回 200"

  headers="$(headers_of "/")"
  for header in "strict-transport-security: max-age=" "x-content-type-options: nosniff" "x-frame-options: deny" "referrer-policy: no-referrer" "content-type: text/html"; do
    grep -q "^$header" <<<"$headers" || fail "$label：index.html 的响应缺少 $header"
  done
  grep -q '^cache-control: no-cache$' <<<"$headers" || fail "$label：index.html 不应被缓存（应为 Cache-Control: no-cache）"

  # 内容安全策略：哈希在这里用另一套工具从实际拿到的页面重新算一遍，必须和响应头里的一致——
  # 对不上的话浏览器会拦掉那段内联脚本。
  policy="$(request --max-time 10 --head "$base_url/" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')"
  [[ -n "$policy" ]] || fail "$label：缺少 Content-Security-Policy 响应头"
  script_hash="$(request --max-time 10 "$base_url/" | perl -0777 -ne 'print $1 if m{<script>(.*?)</script>}s' | openssl dgst -sha256 -binary | base64)"
  [[ "$(grep -c '<script>' <<<"$index")" == "1" ]] || fail "$label：前提不成立，index.html 里应正好有一段内联脚本"
  grep -qF "script-src 'self' 'sha256-$script_hash';" <<<"$policy" ||
    fail "$label：内容安全策略里的脚本哈希和 index.html 里的内联脚本对不上（应为 sha256-$script_hash），实际策略：$policy"
  for directive in "default-src 'self'" "style-src 'self'" "connect-src 'self'" "object-src 'none'" "base-uri 'none'" "frame-ancestors 'none'"; do
    grep -qF "$directive" <<<"$policy" || fail "$label：内容安全策略缺少 $directive"
  done
  # 图片来源：没配地图底图时只认同源；配了以后只多出那一个来源（bin/compose.sh 从 .env 的 MAP_TILE_URL_TEMPLATE 算出）。
  if [[ -z "$expected_tile_origin" ]]; then
    grep -Eq "img-src 'self' ?;" <<<"$policy" || fail "$label：没有配置地图底图时 img-src 应只认同源，实际策略：$policy"
  else
    grep -qF "img-src 'self' $expected_tile_origin;" <<<"$policy" || fail "$label：img-src 应放行地图底图的来源 $expected_tile_origin，实际策略：$policy"
  fi
  if grep -Eq "unsafe-inline|unsafe-eval|https?:|\*" <<<"${policy//$expected_tile_origin/}"; then fail "$label：内容安全策略不应放行内联、eval 或底图之外的任何站外来源：$policy"; fi

  # 刷新任意前端地址：没有对应的文件，一律拿到 index.html。最后两个长得像接口前缀但不是，也归前端。
  for path in /login /platform/login /accept-invite /platform/reset-password /platform "/login?next=%2Faccount" /some/deep/page /healthz /platform/v1x; do
    [[ "$(status_of "$path")" == "200" ]] || fail "$label：刷新前端地址 $path 应返回 200"
    [[ "$(request --max-time 10 "$base_url$path")" == "$index" ]] || fail "$label：前端地址 $path 应返回 index.html"
    grep -q '^cache-control: no-cache$' <<<"$(headers_of "$path")" || fail "$label：前端地址 $path 的响应不应被缓存"
  done

  # 接口前缀仍然到 API：前缀本身、带查询串、带下级路径。API 对不存在的路径返回统一格式的 JSON 错误。
  [[ "$(status_of "/health?probe=1")" == "200" ]] || fail "$label：/health 带查询串应仍由 API 返回 200"
  for path in /platform/v1 "/platform/v1?probe=1" /tenant/v1 "/tenant/v1?probe=1" /sales/v1 "/sales/v1?probe=1" /webhooks "/webhooks?probe=1" /health/nothing /sales/v1/nothing/here; do
    body="$(request --max-time 10 "$base_url$path")"
    [[ "$body" == '{"error":{"code":'* ]] || fail "$label：$path 应由 API 回答（统一格式的 JSON 错误），实际是：${body:0:120}"
    [[ "$(status_of "$path")" == "404" ]] || fail "$label：$path 在 API 里不存在，应返回 404"
  done

  # /assets/：真实存在的文件长缓存；不存在的是 404，而不是 index.html。
  asset="$(grep -o '/assets/[A-Za-z0-9._-]*\.js' <<<"$index" | head -n 1)"
  stylesheet="$(grep -o '/assets/[A-Za-z0-9._-]*\.css' <<<"$index" | head -n 1)"
  [[ -n "$asset" && -n "$stylesheet" ]] || fail "$label：index.html 里应引用 /assets/ 下的脚本和样式"
  for path in "$asset" "$stylesheet"; do
    headers="$(headers_of "$path")"
    [[ "$(status_of "$path")" == "200" ]] || fail "$label：$path 应返回 200"
    grep -q '^cache-control: public, max-age=31536000, immutable$' <<<"$headers" || fail "$label：$path 应长期缓存（immutable）"
    grep -q '^x-content-type-options: nosniff' <<<"$headers" || fail "$label：$path 的响应缺少 nosniff"
  done
  grep -q '^content-type: text/javascript' <<<"$(headers_of "$asset")" || fail "$label：脚本的 Content-Type 应是 text/javascript"
  grep -q '^content-type: text/css' <<<"$(headers_of "$stylesheet")" || fail "$label：样式的 Content-Type 应是 text/css"
  for path in /assets/does-not-exist.js /assets/ /assets/nothing/here.css; do
    [[ "$(status_of "$path")" == "404" ]] || fail "$label：不存在的 $path 应返回 404"
    if grep -qF '<div id="root">' <<<"$(request --max-time 10 "$base_url$path")"; then fail "$label：不存在的 $path 不应回退到 index.html"; fi
    if grep -q '^cache-control:.*immutable' <<<"$(headers_of "$path")"; then fail "$label：不存在的 $path 不应带长缓存"; fi
  done
}

# 模拟机器上原有的反向代理：主机网络的 nginx，只转发到 EDGE_LISTEN。
# 转发时传的请求头和 docs/deploy.md 给负责人的示例配置一致（真实环境里它还负责 HTTPS，所以这里把协议写成 https）。
start_outer_proxy() {
  cat >"$work_dir/outer-proxy.conf" <<CONF
server {
    listen 127.0.0.1:$outer_port;
    location / {
        proxy_pass http://$EDGE_LISTEN;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
CONF
  chmod 644 "$work_dir/outer-proxy.conf"
  docker run --detach --name "$outer_proxy" --network host \
    --volume "$work_dir/outer-proxy.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null
  local attempt
  for attempt in $(seq 1 30); do
    if curl --silent --output /dev/null --max-time 2 "http://127.0.0.1:$outer_port/health"; then return 0; fi
    sleep 1
  done
  docker logs "$outer_proxy" || true
  fail "模拟外层代理的 nginx 没有在 30 秒内起来（第 $attempt 次仍不通）"
}

# 发一次必然失败的平台登录（邮箱不存在），返回审计日志里这次失败记下的来源地址。
# 用法：recorded_login_address <标记邮箱> <curl 的其余参数…>
recorded_login_address() {
  local email="$1" code
  shift
  code="$(request --max-time 15 --output /dev/null --write-out '%{http_code}' \
    --header 'content-type: application/json' \
    --data "{\"email\":\"$email\",\"password\":\"$admin_password\"}" \
    "$@" "$base_url/platform/v1/auth/login" || true)"
  [[ "$code" == "401" ]] || fail "不存在的账号登录应返回 401，实际是 $code"
  db_value "select ip from audit_logs where action = 'login_failed' and after ->> 'email' = '$email'"
}

# 登录限速按来源地址计数的那一行是否存在（key 的算法见 apps/api/src/services/login-guard.ts）。
throttled_address_count() {
  local key
  key="$(printf 'platform\nip\n%s' "$1" | sha256sum | cut -d' ' -f1)"
  db_value "select count(*) from login_throttles where key = '$key'"
}

# standalone 模式下的「最外层客户端」：一个接在 edge 网络上的临时容器，直接连 Caddy 的 443，带伪造的 X-Forwarded-For。
# （经主机映射的端口进来的连接，源地址会被 Docker 换成网桥地址，说明不了问题。）输出「HTTP 状态码 客户端自己的地址」。
read -r -d '' edge_client_script <<'JS' || true
import https from "node:https";
const body = JSON.stringify({ email: process.env.SMOKE_EMAIL, password: "Smoke-Placeholder-Passw0rd" });
const request = https.request(
  {
    host: "caddy",
    port: 443,
    servername: "localhost",
    rejectUnauthorized: false,
    method: "POST",
    path: "/platform/v1/auth/login",
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "x-forwarded-for": process.env.SMOKE_FORGED,
    },
  },
  (response) => {
    console.log(`${response.statusCode} ${response.socket.localAddress}`);
    response.resume();
  },
);
request.end(body);
JS

current_release() { basename "$(readlink "$root_dir/current")"; }

health_status() {
  request --max-time 10 --output /dev/null --write-out '%{http_code}' "$base_url/health$1" || true
}

expect_healthy() {
  local code
  code="$(health_status "")"
  [[ "$code" == "200" ]] || fail "$1：/health 返回 $code，应为 200"
}

step "构建镜像（API、前端各一个）"
docker build --quiet --file "$repo_root/apps/api/Dockerfile" --tag "$good_image" "$repo_root"
docker build --quiet --file "$repo_root/apps/web/Dockerfile" --tag "$good_web_image" "$repo_root"

step "准备目录（相当于服务器上初始化之后的 /opt/nozomi/<环境>/；没有 POSTGRES_APP_PASSWORD，相当于早先初始化的服务器）"
mkdir -p "$root_dir/releases" "$root_dir/backups"
(
  umask 077
  cat >"$root_dir/.env" <<'ENV'
POSTGRES_PASSWORD=ci-placeholder-not-a-real-password
AUTH_JWT_SECRET=ci-placeholder-not-a-real-secret-0000000000
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
GOOGLE_MAPS_API_KEY=
ENV
)

migration_password="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$root_dir/.env")"

step "放两样「别人的东西」在旁边：一个带数据卷的容器、一个没有容器在用的镜像（第 8 步检查它们原样还在）"
docker pull --quiet caddy:2 >/dev/null
docker tag caddy:2 "$neighbor_image"
docker run --detach --name "$neighbor" --volume "$neighbor-data:/data" caddy:2 tail -f /dev/null >/dev/null
neighbor_before="$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$neighbor")"

step "1. 首次部署（入口模式 $mode）"
install_release v1
deploy_release v1 "$good_image"
[[ "$(current_release)" == "v1" ]] || fail "current 应指向 v1"
if [[ "$mode" == "behind-proxy" ]]; then
  # 外层代理还没起来：部署已经成功（以本机访问 EDGE_LISTEN 为准），外层这一段不影响部署结果。
  [[ "$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code}' "http://$EDGE_LISTEN/health" || true)" == "200" ]] ||
    fail "behind-proxy：本机访问 EDGE_LISTEN 的 /health 应返回 200"
  start_outer_proxy
fi
expect_healthy "首次部署后"
body="$(request --max-time 10 "$base_url/health")"
grep -q '"status":"ok"' <<<"$body" || fail "/health 的 status 不是 ok"
grep -q '"env":"ci"' <<<"$body" || fail "/health 的 env 不是 ci"

step "2. 响应头、访问日志、端口"
headers="$(request --max-time 10 --head "$base_url/health")"
for header in "strict-transport-security: max-age=" "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: no-referrer"; do
  grep -qi "^$header" <<<"$headers" || fail "缺少响应头 $header"
done
# behind-proxy 时响应最后经过冒烟里的 nginx，Server 头是它加的；所以这一条直接问 Caddy。
if [[ "$mode" == "behind-proxy" ]]; then
  direct_headers="$(curl --silent --max-time 10 --head "http://$EDGE_LISTEN/health")"
else
  direct_headers="$headers"
fi
if grep -qi '^server:' <<<"$direct_headers"; then fail "Caddy 的响应里不应有 Server 头"; fi

marker="smoke-query-marker-$RANDOM"
[[ "$(health_status "?token=$marker")" == "200" ]] || fail "带查询串的请求没有返回 200"
caddy_log="$(compose logs --no-log-prefix caddy)"
grep -q '"uri":"/health"' <<<"$caddy_log" || fail "访问日志里没有 /health 的记录"
if grep -q "$marker" <<<"$caddy_log"; then fail "访问日志里出现了查询串"; fi

for service in db api; do
  [[ -z "$(docker port "$(compose ps --quiet "$service")")" ]] || fail "$service 不应映射端口到主机"
done
caddy_ports="$(docker port "$(compose ps --quiet caddy)")"
[[ -n "$caddy_ports" ]] || fail "反向代理应该映射了端口（否则上面的检查没有意义）"
if [[ "$mode" == "behind-proxy" ]]; then
  [[ "$caddy_ports" == "8080/tcp -> $EDGE_LISTEN" ]] ||
    fail "behind-proxy：反向代理应只把容器内的 8080 发布到 $EDGE_LISTEN，实际是：$caddy_ports"
  [[ "$(compose exec -T api printenv TRUST_PROXY_HOPS)" == "2" ]] || fail "behind-proxy：API 应信任 2 层反向代理"
  if compose exec -T caddy sh -c 'test -e /data/caddy/certificates || test -e /data/caddy/acme || test -e /data/caddy/pki'; then
    fail "behind-proxy：Caddy 不应申请或签发任何证书"
  fi
  for port in 80 443; do
    if compose exec -T caddy sh -c "nc -z 127.0.0.1 $port" >/dev/null 2>&1; then fail "behind-proxy：Caddy 在容器里也不应监听 $port"; fi
  done
  compose exec -T caddy sh -c 'nc -z 127.0.0.1 8080' >/dev/null 2>&1 || fail "behind-proxy：Caddy 应在容器里监听 8080（否则上一条检查没有意义）"
else
  grep -q '^443/tcp -> ' <<<"$caddy_ports" || fail "standalone：反向代理应发布 443 端口"
  [[ "$(compose exec -T api printenv TRUST_PROXY_HOPS)" == "1" ]] || fail "standalone：API 应信任 1 层反向代理"
fi
[[ "$(compose exec -T api id -u)" != "0" ]] || fail "API 不应以 root 运行"

step "3. 前端：登录页、刷新不 404、接口前缀、/assets/、内容安全策略、缓存"
[[ "$(running_images)" == "$good_image $good_web_image" ]] || fail "api 和反向代理应分别运行这个版本的两个镜像，实际是：$(running_images)"
check_frontend "首次部署后"
[[ "$(request --max-time 10 "$base_url$version_marker_path")" == *'<div id="root"></div>'* ]] ||
  fail "前提不成立：第一个版本的前端里不应有 $version_marker_path"
# 前端的请求也进访问日志，同样不记查询串。
if grep -q 'probe=1' <<<"$(compose logs --no-log-prefix caddy)"; then fail "访问日志里出现了查询串"; fi

step "4. 客户端真实地址：伪造的 X-Forwarded-For 不被采信"
if [[ "$mode" == "behind-proxy" ]]; then
  # 链路：客户端（源地址 $client_address，自带伪造的头）→ 外层 nginx → Docker 发布的端口 → Caddy → API。
  recorded="$(recorded_login_address "edge-check@example.test" --interface "$client_address" --header "X-Forwarded-For: $forged_address")"
  [[ "$recorded" == "$client_address" ]] ||
    fail "behind-proxy：审计日志记下的来源地址应是最外层客户端 $client_address，实际是「$recorded」"
  [[ "$(throttled_address_count "$client_address")" == "1" ]] || fail "behind-proxy：登录限速应按最外层客户端的地址计数"
else
  # 链路：客户端容器（edge 网络上，自带伪造的头）→ Caddy → API。
  edge_network="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' "$(compose ps --quiet caddy)" | grep -m 1 '_edge$')"
  read -r client_status client_address < <(docker run --rm --network "$edge_network" \
    --env SMOKE_EMAIL=edge-check@example.test --env SMOKE_FORGED="$forged_address" \
    "$good_image" node --input-type=module -e "$edge_client_script") || true
  [[ "$client_status" == "401" ]] || fail "standalone：不存在的账号登录应返回 401，实际是 $client_status"
  recorded="$(db_value "select ip from audit_logs where action = 'login_failed' and after ->> 'email' = 'edge-check@example.test'")"
  [[ -n "$client_address" && "$recorded" == "$client_address" ]] ||
    fail "standalone：审计日志记下的来源地址应是客户端容器的地址 $client_address，实际是「$recorded」"
  [[ "$(throttled_address_count "$client_address")" == "1" ]] || fail "standalone：登录限速应按客户端的地址计数"
  # 再从主机映射的端口进来一次：记下的是 Docker 网桥的地址，同样不是伪造的值。
  recorded="$(recorded_login_address "edge-host@example.test" --header "X-Forwarded-For: $forged_address")"
  [[ "$recorded" != "$forged_address" ]] || fail "standalone：伪造的地址被采信了"
fi
[[ "$(throttled_address_count "$forged_address")" == "0" ]] || fail "登录限速不应按伪造的地址计数"
[[ "$(db_value "select count(*) from audit_logs where ip = '$forged_address'")" == "0" ]] || fail "审计日志里出现了伪造的来源地址"

step "5. 数据库的两个账号：api 容器用的是最小权限的应用账号"
grep -Eq '^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$' "$root_dir/.env" || fail "部署时应自动生成 POSTGRES_APP_PASSWORD 并写入 .env"
[[ "$(stat -c '%a' "$root_dir/.env")" == "600" ]] || fail ".env 的权限应为 600"
[[ "$(grep -c '^POSTGRES_PASSWORD=ci-placeholder-not-a-real-password$' "$root_dir/.env")" == "1" ]] || fail "补应用账号密码时不应改动 POSTGRES_PASSWORD"
app_password_digest="$(grep '^POSTGRES_APP_PASSWORD=' "$root_dir/.env" | sha256sum)"
check_db_accounts "首次部署后"

step "6. 部署一个起不来的版本，应自动回退"
# 「坏版本」：进程活着但从不监听端口，健康检查永远通不过。配对的前端镜像本身是好的。
# 到这一步才构建：每次成功部署都会清掉用不到的旧镜像，提前构建的会被删。
docker build --quiet --tag "$bad_image" - <<DOCKERFILE
FROM $good_image
CMD ["node", "-e", "setInterval(() => {}, 1000)"]
DOCKERFILE
docker tag "$good_web_image" "$bad_web_image"
install_release v2-bad
status=0
deploy_release v2-bad "$bad_image" || status=$?
[[ "$status" -eq 20 ]] || fail "坏版本的部署应以退出码 20（已回退）结束，实际是 $status"
[[ "$(current_release)" == "v1" ]] || fail "回退后 current 应仍指向 v1"
expect_healthy "自动回退后"
[[ "$(running_images)" == "$good_image $good_web_image" ]] || fail "自动回退后应运行上一个版本的两个镜像，实际是：$(running_images)"

step "7. 再部署一个前端和后端都换了镜像的好版本，然后手动回退"
docker tag "$good_image" "$next_image"
docker build --quiet --tag "$next_web_image" - <<DOCKERFILE
FROM $good_web_image
RUN printf 'v3' >/srv/web$version_marker_path
DOCKERFILE
# 这一次部署前在 .env 里配上地图底图：API 拿到同一个地址，反向代理的 img-src 多出它的来源（地址不会被真的请求）。
printf '%s\n' 'MAP_TILE_URL_TEMPLATE=https://tiles.smoke.test/{z}/{x}/{y}.png' 'MAP_TILE_ATTRIBUTION=© 冒烟测试底图|https://tiles.smoke.test/copyright' >>"$root_dir/.env"
expected_tile_origin="https://tiles.smoke.test"
install_release v3
deploy_release v3 "$next_image"
[[ "$(compose exec -T api printenv MAP_TILE_URL_TEMPLATE)" == 'https://tiles.smoke.test/{z}/{x}/{y}.png' ]] || fail "API 容器应拿到 .env 里的地图底图地址"
check_frontend "配置地图底图后"
[[ "$(current_release)" == "v3" ]] || fail "current 应指向 v3"
[[ "$(running_images)" == "$next_image $next_web_image" ]] || fail "第三次部署后应运行新版本的两个镜像，实际是：$(running_images)"
[[ "$(request --max-time 10 "$base_url$version_marker_path")" == "v3" ]] || fail "第三次部署后前端应已换成新版本"
[[ "$(basename "$(readlink "$root_dir/previous")")" == "v1" ]] || fail "previous 应指向 v1"
[[ ! -e "$root_dir/releases/v2-bad" ]] || fail "成功部署后应清理掉失败的版本目录"
expect_healthy "第三次部署后"
"$root_dir/current/bin/deploy.sh" rollback
[[ "$(current_release)" == "v1" ]] || fail "手动回退后 current 应指向 v1"
[[ ! -e "$root_dir/previous" ]] || fail "手动回退后不应再有 previous"
expect_healthy "手动回退后"
[[ "$(running_images)" == "$good_image $good_web_image" ]] || fail "手动回退后前端和后端应一起回到上一个版本的镜像，实际是：$(running_images)"
check_frontend "手动回退后"
[[ "$(request --max-time 10 "$base_url$version_marker_path")" == *'<div id="root"></div>'* ]] ||
  fail "手动回退后前端应回到上一个版本（不再有 $version_marker_path）"
[[ "$(grep '^POSTGRES_APP_PASSWORD=' "$root_dir/.env" | sha256sum)" == "$app_password_digest" ]] ||
  fail "再次部署不应改动已有的 POSTGRES_APP_PASSWORD"

step "8. 和别的项目隔离"
project_filter=(--filter label=com.docker.compose.project=nozomi-ci)
project_containers="$(docker container ls --all "${project_filter[@]}" --format '{{.Names}}')"
project_networks="$(docker network ls "${project_filter[@]}" --format '{{.Name}}')"
project_volumes="$(docker volume ls "${project_filter[@]}" --format '{{.Name}}')"
[[ "$(wc -l <<<"$project_containers")" == "3" ]] || fail "本项目应正好有 3 个容器，实际是：$project_containers"
[[ "$(wc -l <<<"$project_networks")" == "2" ]] || fail "本项目应正好有 2 个网络，实际是：$project_networks"
[[ "$(wc -l <<<"$project_volumes")" == "3" ]] || fail "本项目应正好有 3 个数据卷，实际是：$project_volumes"
if grep -Ev '^nozomi-ci-' <<<"$project_containers"; then fail "本项目的容器名应全部以 nozomi-ci- 开头"; fi
if grep -Ev '^nozomi-ci_' <<<"$project_networks"$'\n'"$project_volumes"; then fail "本项目的网络和数据卷名应全部以 nozomi-ci_ 开头"; fi
[[ "$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' "$neighbor")" == "$neighbor_before" ]] ||
  fail "旁边那个不属于本项目的容器被动过（被删除、重建或重启）"
docker volume inspect "$neighbor-data" >/dev/null 2>&1 || fail "旁边那个不属于本项目的数据卷不见了"
docker image inspect "$neighbor_image" >/dev/null 2>&1 || fail "旁边那个不属于本项目的镜像被清理掉了"
[[ -z "$(docker image ls --quiet "$bad_image")$(docker image ls --quiet "$bad_web_image")" ]] ||
  fail "本项目用不到的旧镜像（API 和前端各一个）应已清理（否则上一条检查没有意义）"

step "9. 备份与恢复（含登录链路）"
# 平台上没有预置账号：和真实环境一样用命令行建第一个超级管理员（密码从标准输入传入），再经反向代理登录。
[[ "$(request --max-time 10 "$base_url/platform/login")" == *'<div id="root"></div>'* ]] || fail "运营后台的登录页应能打开"
printf '%s\n' "$admin_password" |
  compose exec -T api node apps/api/src/cli/admin-create.ts --email "$admin_email" --name "冒烟管理员" >/dev/null
# 和登录页里发生的事一样：同一个域名下，登录接口换到令牌，再带着令牌取自己的资料。
access_token="$(login_access_token)"
[[ -n "$access_token" ]] || fail "备份前：用刚建的管理员经反向代理登录应拿到访问令牌"
me="$(request --max-time 15 --header "authorization: Bearer $access_token" "$base_url/platform/v1/auth/me")"
grep -qF "\"email\":\"$admin_email\"" <<<"$me" || fail "备份前：带着令牌经反向代理取自己的资料，应返回刚建的管理员"
compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet \
  -c 'create table smoke_marker (id integer primary key)' -c 'insert into smoke_marker values (42)'
"$root_dir/current/bin/backup.sh" daily
backup_file="$(find "$root_dir/backups" -name 'nozomi-ci-daily-*.dump' | head -n 1)"
[[ -s "$backup_file" ]] || fail "没有生成每日备份文件"
[[ "$(stat -c '%a' "$backup_file")" == "600" ]] || fail "备份文件的权限应为 600"
compose exec -T db psql -U nozomi -d nozomi -v ON_ERROR_STOP=1 --quiet -c 'drop table smoke_marker'
"$root_dir/current/bin/restore.sh" "$backup_file" --yes
restored="$(compose exec -T db psql -U nozomi -d nozomi --tuples-only --no-align -c 'select id from smoke_marker')"
[[ "$restored" == "42" ]] || fail "恢复后数据没有回来"
expect_healthy "恢复后"
[[ "$(login_status)" == "200" ]] || fail "恢复后：同一个管理员登录应返回 200（账号在备份里，应用账号仍能读写）"
[[ "$(db_value "select count(*) from audit_logs where action = 'login' and actor_type = 'platform_user'")" == "2" ]] ||
  fail "恢复后：审计日志里应有恢复前、恢复后各一次登录记录"
check_db_accounts "恢复后"

step "冒烟全部通过（入口模式 $mode）"
