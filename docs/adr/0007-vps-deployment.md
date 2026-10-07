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
