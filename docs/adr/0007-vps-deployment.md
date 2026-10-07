# ADR 0007：部署到自有 VPS

- 状态：已采纳（2026-10-07）
- 取代：ADR 0001 中「部署：Render」一项，以及 ADR 0005 中密钥存放位置的「Render 环境变量」一项。ADR 0001、0005 的其余内容不变。

## 背景

负责人决定测试环境和正式环境都使用自己的 VPS，不使用 Render。

## 决定

- 每个环境在 VPS 上用 Docker Compose 运行三个容器：API、PostgreSQL 16、反向代理（自动申请和续期 HTTPS 证书）。
- 镜像由 GitHub Actions 构建并推送到 GitHub Container Registry（使用 Actions 自带的令牌，不需要额外密钥）；VPS 只拉取镜像，不在服务器上构建。
- 部署由 GitHub Actions 通过 SSH 执行：拉取镜像 → 执行 `db:migrate` → 启动新版本 → 检查 `/health`，不健康则回退到上一个镜像。
- 两个环境对应 GitHub 的两个 Environment（`staging`、`production`）。main 合并后自动部署 staging；production 需要负责人在 GitHub 上批准。
- 密钥分两处：GitHub Environment secrets 只放 SSH 连接信息；业务密钥只放在 VPS 的 `/opt/nozomi/<环境>/.env`（权限 600）。清单见 docs/secrets.md。
- 数据库只监听容器内部网络，不对公网开放端口。每日备份到 VPS 本地并保留 14 天；异地备份的存放位置由负责人提供后补充。

## 理由

- 业务密钥不经过 GitHub，SSH 密钥泄露的影响范围限于部署用户。
- 镜像在 CI 构建，服务器不需要 Node 和源码，回退只需切换镜像标签。
- Docker Compose 足以支撑当前规模，以后迁移到其他主机只需复制 `.env` 和恢复数据库备份。

## 影响

- 数据库的可用性和备份由我们自己负责（Render 托管数据库原本提供的时间点恢复不再有）。需求文档 02「备份与恢复」要求可恢复到任意时间点，本 ADR 的每日备份达不到，需在正式上线前补 WAL 归档（roadmap 任务 M0-08 的验收标准已注明）。

## 补充（2026-10-07）：测试环境的配置校验

- **决定**：只有 production 在启动时强制要求配齐 Stripe 和谷歌地图；staging 缺失时照常启动，缺的集成在 `/health` 和 `pnpm config:check` 里显示「未配置」（此前 staging 和 production 一样强制）。
- **原因**：负责人要求不依赖第三方密钥的部分先上线测试环境，Stripe、谷歌地图的账号之后再配。
- **不变**：非 production 环境禁止使用 Stripe 正式（live）密钥；Stripe 三项只填一部分仍然报错；production 的 `AUTH_JWT_SECRET` 至少 64 个字符。
- **代价**：staging 上「未配置」不再是启动失败，而是功能不可用。验收涉及支付或里程报价的任务前，要先在 `/health` 确认这两项已配置。

## 补充（2026-10-07）：实现约定

- **目录**：每个环境在服务器上是 `/opt/nozomi/<环境>/`：`.env`（密钥，600）、`releases/<提交 SHA>/`（该版本的 compose.yml、Caddyfile、脚本和非密钥变量 `release.env`）、`current` / `previous`（指向当前和上一个版本的符号链接）、`backups/`。回退 = 用上一个版本目录里的文件和镜像重新启动，compose 文件和镜像一起回退。只保留当前和上一个两个版本。
- **配置的三个来源**：GitHub Environment secrets 只有 SSH 连接信息；Environment variables 放非密钥项（`APP_DOMAIN`、可选的 `ACME_EMAIL`）；服务器 `.env` 只放业务密钥，其中 `POSTGRES_PASSWORD`、`AUTH_JWT_SECRET` 由初始化脚本在服务器上生成，不经过任何人和 GitHub。传给 API 的环境变量集中在 `deploy/compose.yml` 的 `api.environment` 一处拼装。
- **判断健康**：以容器健康检查为准（API 的健康检查就是 `/health`，数据库不通或迁移没执行完都算不健康；反向代理的健康检查经自身转发到 API 的 `/health`）。服务器上通过后，流水线再从外网访问一次 `https://<域名>/health`，不通则回退。
- **拉镜像的登录**：流水线把本次运行的短期令牌经 SSH 的标准输入传给服务器上的 `docker login`，部署结束即登出；不依赖镜像包是否公开，服务器上不留长期凭据。
- **部署用户**：`nozomi` 属于 `docker` 组，等同于拥有服务器的 root 权限。接受这一点，因为它没有密码、只能用部署专用密钥登录，而该密钥只存在 GitHub Environment secrets 里。
- **服务器防火墙**：ufw 只放行 SSH、80、443。Docker 映射的端口不受 ufw 约束，所以 compose 里只有反向代理映射端口（80、443），数据库和 API 不映射。不开 HTTP/3（需要 UDP 443）。
- **验证方式**：CI 每次都用同一份镜像、compose.yml、Caddyfile 和脚本在 runner 上真实跑一遍（`deploy/ci/smoke.sh`，含自动回退、备份恢复），并在 Ubuntu 22.04 / 24.04 容器里把初始化脚本跑两遍（`deploy/ci/bootstrap-check.sh`）。

### 已知限制

- **回退与迁移**：迁移只进不退（ADR 0006）。如果失败的部署已经执行了新迁移，回退后的旧版本会因「数据库里有它不认识的迁移」在 `/health` 报不健康。为此每次部署在迁移前自动备份一次数据库；处理办法是修复后重新部署，或用该备份恢复。
- **切换时有几秒中断**：新旧版本不是并行切换，重建 API 容器期间请求会失败。当前规模可以接受。
- **备份只在本机**：每日备份和迁移前备份都在同一台服务器上，保留 14 天。异地备份和 WAL 归档见上文「影响」。

## 补充（2026-10-07）：与其他服务共用一台机器（behind-proxy 模式）

### 背景

测试环境的服务器上已经跑着另一套不相关的服务（另一个 Compose 项目，容器用主机网络，它的 nginx 占着 80 和 443）。负责人决定两套共存。本 ADR 前文假设「一台机器只跑我们自己」：自己占 80/443、自己申请证书、自己管防火墙——在这台机器上都不成立。正式环境以后是独立的机器，仍按前文的方式。

### 决定

- **入口有两种模式**，由每个环境的非密钥配置 `EDGE_MODE` 选择（GitHub Environment variables；手工部署时是同名的环境变量）：
  - `standalone`（默认）：前文的方式，一字不变。Caddy 占 80/443、自动申请和续期证书。
  - `behind-proxy`：机器上原有的反向代理（下称「外层代理」）继续占 80/443 并负责 HTTPS。我们的 Caddy 只在容器里提供纯 HTTP（8080），发布到主机**回环地址**上的一个端口 `EDGE_LISTEN`（例如 `127.0.0.1:18080`），由外层代理按域名转发过来。不申请证书，不监听 80/443。
- **`EDGE_LISTEN` 只接受回环地址**（`127.x.x.x:端口`），写成别的直接报错。原因见前文「服务器防火墙」：Docker 发布的端口不受主机防火墙约束，发布到非回环地址等于直接暴露到外网。
- **由模式推导、不让人手填的三项**（写在版本目录的 `release.env` 里）：
  - API 信任几层反向代理（`TRUST_PROXY_HOPS`）：standalone 是 1（Caddy），behind-proxy 是 2（外层代理 + Caddy）。
  - Caddy 是否相信请求带来的 `X-Forwarded-For` / `X-Forwarded-Proto`：standalone 不信（请求直接来自互联网，一律重写）；behind-proxy 只信来自回环 / 私有网段的上一跳，保留它写的值并在后面追加。
  - 初始化脚本管不管服务器防火墙（`MANAGE_FIREWALL`）：standalone 管（只放行 SSH、80、443）；behind-proxy 不管，一条规则都不碰——那台机器上别的服务的端口必须保持原样。需要时可以明确设置 `MANAGE_FIREWALL=1` / `0` 覆盖。
- **安全响应头两种模式都由 Caddy 加**，包括 `Strict-Transport-Security`。behind-proxy 时响应经外层代理的 HTTPS 回到浏览器，这个头照样生效；外层代理的配置不在本仓库里，所以不依赖它来加，它也不应再加一遍。这个头不带 `includeSubDomains`，只对本项目自己的域名生效。
- **部署成败的判定**：behind-proxy 模式以「容器都健康，并且从服务器本机访问 `http://<EDGE_LISTEN>/health` 返回 200」为准，不通按不健康处理（回退，退出码同前）。流水线最后从外网访问 `https://<域名>/health` 这一步，在该模式下不通只给警告、不回退：那一段取决于外层代理有没有转发、证书有没有配好，不归本仓库管。standalone 模式不变（外网不通即失败并回退）。
- **初始化脚本支持的系统**：Ubuntu 22.04 / 24.04，以及 CentOS Stream / RHEL / Rocky Linux / AlmaLinux 的 9 和 10。机器上已经有 Docker 且 Compose 不低于 2.25 时原样使用，不重装、不升级、不改它的配置；版本不够时报错停下，由服务器管理员决定怎么处理。只安装缺少的工具，不升级系统已有的软件包；不改 SSH 服务的设置、不改任何账号的密码、不改 SELinux 的模式。
- **首次部署不依赖 GitHub 上的流水线**：对服务器的每一步操作都在 `deploy/client/remote.sh` 里，流水线调用它，手工部署（`deploy/client/push-local.sh`：本机构建镜像，`docker save | ssh … docker load` 传到服务器）也调用它；服务器上执行的是同一份 `bootstrap.sh` / `bin/deploy.sh`，参数用同一种方式传。镜像已经在服务器上时（`DEPLOY_SKIP_PULL=1`）不拉取、不登录镜像仓库，其余流程完全一样。

### 隔离边界

共用的只有一处：外层代理里把我们的域名转到 `EDGE_LISTEN` 的那一段配置。它和证书都在对方那边，由负责人手工维护，**不在本仓库的脚本里**。除此之外：

| | 我们自己的 | 不碰对方的 |
| --- | --- | --- |
| Compose 项目 | 项目名固定为 `nozomi-<环境>`（不是目录名），所有 `docker compose` 调用都经 `bin/compose.sh` 带上它 | 不对别的项目执行任何命令；`--remove-orphans` 只作用于本项目 |
| 容器 / 网络 / 数据卷 | 名字都以 `nozomi-<环境>` 开头；compose 文件里不写 `container_name`、不给网络和卷另起名字、不引用外部网络和卷、不用主机网络 | 不加入对方的网络，不挂对方的卷，不连对方的数据库 |
| 数据库 | 自己的 PostgreSQL 容器和数据卷，只在没有外网出口的内部网络里，不发布任何主机端口 | — |
| 主机端口 | 只有回环地址上的 `EDGE_LISTEN` 一个 | 80、443 和对方用的其他端口都不占、不改 |
| 镜像 | 清理旧版本时只在 `nozomi-api` 这一个镜像名下按标签逐个删 | 不用任何 `prune`；对方的镜像、停着的容器、没人用的卷一概不动 |
| 文件 | `/opt/nozomi/` 和部署用户 `nozomi` 的家目录 | 不读写对方的目录、环境变量和密钥 |
| 系统 | 新增一个用户、一个定时任务文件（`/etc/cron.d/nozomi-backup-<环境>`），按需安装缺少的小工具 | 防火墙、Docker 本身、SSH 服务、root 密码、SELinux 都不改 |

`apps/api/src/deploy-setup.test.ts` 用静态检查守住上表（项目名、命名、不发布数据库端口、没有波及全机的 docker 命令等）；`deploy/ci/smoke.sh` 和 `deploy/ci/push-local-check.sh` 在真实容器里放一组「别人的」容器、数据卷和镜像，确认多次部署、清理、回退之后它们原样还在。

### 已知限制

- **部署用户能操作这台机器上的所有容器**。`nozomi` 属于 docker 组（前文「部署用户」），这个权限没有办法只限定在我们自己的项目上：拿到部署钥匙的人同样能停掉、读取对方的容器和数据。隔离靠的是「我们的脚本不去碰」，不是「碰不到」。反过来也一样：对方的管理员能操作我们的容器。
- **HTTPS 证书和 80/443 由外层代理负责，不在本仓库管理**。证书的申请、续期、外层代理的配置都是对方那边的事。外层代理续期证书后需要有人重载它（例如 `nginx -s reload`），本仓库不管也不检查；证书过期时我们这边的健康检查仍然是绿的。
- **外层代理停了或配置被改掉，我们的网站就打不开**，而服务器本机的健康检查仍然通过。behind-proxy 模式下流水线只能对此给出警告。
- **来源地址的可信度依赖「只有外层代理能连到 `EDGE_LISTEN`」**。这个端口只在回环地址上，外网连不到；但这台机器上的任何本地进程（包括对方的服务）都能直接连它，并用自己写的 `X-Forwarded-For` 冒充任意来源地址，从而在审计日志里留下假的地址、绕开按地址的登录限速。接受这一点：能在这台机器上运行进程的人本来就拥有更大的权限（见第一条）。
- **外层代理必须按约定传请求头**（`X-Forwarded-For` 用追加的方式、`X-Forwarded-Proto`、`Host`，示例见 docs/deploy.md）。它如果不传 `X-Forwarded-For`，审计日志里的来源地址会变成 Docker 网桥的地址；这不会造成越权，但日志失去意义。
- **两套服务抢同一台机器的 CPU、内存和磁盘**，互相没有配额限制。
- **SELinux 为 Enforcing 的情形没有实测**。compose 里唯一从主机挂进容器的文件（Caddyfile）带了 `z` 标记，初始化脚本在 Enforcing 时会恢复自己新建文件的默认标签；目前的测试服务器 SELinux 是关闭的，CI 的容器里也没有 SELinux。换到开着 SELinux 的机器时需要先验证。
- **手工部署传上去的镜像名是 `nozomi-api:<提交>`**，和流水线用的 `ghcr.io/…/nozomi-api:<提交>` 不是同一个镜像名。改用流水线之后，服务器上最后两个手工传的镜像不会被自动清理（各几百 MB），需要时手工 `docker image rm`。

### 验证方式

- `deploy/ci/smoke.sh behind-proxy`：同一套全流程（部署、自动回退、手动回退、备份恢复），前面套一个主机网络的 nginx 模拟外层代理；断言只发布回环端口、不申请证书、API 信任 2 层，审计日志和登录限速拿到的是最外层客户端的地址而不是客户端伪造的值。`deploy/ci/smoke.sh`（standalone）同样断言来源地址（1 层）。
- `deploy/ci/bootstrap-check.sh`：Ubuntu 22.04 / 24.04、CentOS Stream 9 / 10 容器里各跑两遍，覆盖「全新机器」和「已有 Docker、不管防火墙」两种情形。
- `deploy/ci/push-local-check.sh`：对一台带 SSH、已装 Docker、80/443 被别人的 nginx 占着的 CentOS Stream 10 演练服务器，真实执行手工初始化和两次手工部署。
- 容器里验证不了的：systemd 管理的服务的真实启停、firewalld 对真实流量的效果、SELinux Enforcing、真实的公网域名和证书。
