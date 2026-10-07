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
