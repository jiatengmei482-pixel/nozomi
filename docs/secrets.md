# 账号与密钥存放规则

**一句话**：密钥只存在下面 4 个地方，代码仓库里永远没有密钥原文。也不要把密钥发在和 Claude 的聊天里——请你自己在对应的设置页面或服务器上填写。

测试环境和正式环境都部署在你自己的 VPS 上（见 ADR 0007）。

## 存放位置

| 位置 | 给谁用 | 怎么进入 | 填什么 |
| --- | --- | --- | --- |
| 本地 `.env` 文件 | 你自己的电脑上运行 | 复制 `.env.example` 为 `.env` | 开发用的变量，Stripe 只用测试密钥 |
| claude.ai/code 云端环境变量 | Claude 的开发会话 | claude.ai/code → 选择环境 → 环境设置 → Environment variables | 开发和端到端测试需要的变量，Stripe 只用测试密钥 |
| GitHub Environment 的 secrets 和 variables | 自动部署：让 GitHub 能登录你的 VPS | 见下面「一、填在 GitHub 上的」 | 「怎么连上服务器」的 5 项密钥，外加域名（不是密钥） |
| VPS 上的 `.env` 文件 | 服务器上运行的程序 | 见下面「二、放在 VPS 上的」 | 该环境运行所需的全部业务密钥（其中三项自动生成） |

**为什么分两处**：GitHub 只需要知道「怎么登录服务器」，不需要知道 Stripe 密钥、数据库密码；这些业务密钥只留在服务器上，GitHub 被盗也拿不到。

## 部署到 VPS 需要你提供的信息

测试环境（staging）和正式环境（production）各填一套，变量名相同、值不同，各用一台 VPS。完整的上线步骤（先做什么后做什么）见 `docs/deploy.md`，这里只说明每一项是什么、去哪里找。

### 准备工作（每台 VPS 做一次）

1. **系统**：Ubuntu 22.04 或 24.04，至少 2 核 CPU、4 GB 内存、40 GB 硬盘。
2. **域名**：给每个环境准备一个域名（例如正式环境一个、测试环境用一个子域名），在域名服务商的 DNS 设置里加一条 **A 记录**指向 VPS 的公网 IP。HTTPS 证书会自动申请，不用你操作。
3. **VPS 服务商控制台的防火墙**（安全组 / 防火墙，如果开了的话）：放行 3 个端口：SSH 端口（默认 22）、80、443。
4. **安装 Docker、建部署专用账号、服务器自身的防火墙、每日备份**：由初始化流程自动完成（Actions → Server init），不用你操作。

### 一、填在 GitHub 上的（让 GitHub 能登录 VPS）

**填在哪**：仓库页面 → Settings → Environments → 新建两个环境，名字必须是 `staging` 和 `production` → 点进每个环境。给 `production` 勾上 Required reviewers 并选你自己，这样正式环境每次部署都要你点一下批准。

**Environment secrets（密钥，5 项）**：点 Add environment secret。

| 变量名 | 是什么 | 去哪里找、怎么填 |
| --- | --- | --- |
| `VPS_HOST` | 服务器地址 | VPS 服务商控制台里显示的公网 IP，例如 `203.0.113.10` 这种格式 |
| `VPS_SSH_PORT` | SSH 端口 | 没改过就填 `22` |
| `VPS_SSH_USER` | 登录服务器用的账号 | **第一次填 `root`**；初始化流程跑完后改成 `nozomi`（初始化会自动建好这个部署专用账号） |
| `VPS_SSH_PRIVATE_KEY` | 部署专用的 SSH 私钥 | **新生成一把只给部署用的钥匙，不要用你平时登录的那把。** 在你自己的电脑上运行 `ssh-keygen -t ed25519 -f nozomi-deploy -N "" -C nozomi-deploy`，会得到两个文件：`nozomi-deploy`（私钥）和 `nozomi-deploy.pub`（公钥）。把**私钥文件的全部内容**（从 `-----BEGIN` 那行到 `-----END` 那行）粘贴到这里。再把**公钥文件的那一行**加到服务器上：Hostinger 的入口是 hPanel → VPS → 管理 → 设置 → SSH 密钥 → 添加。填完后把电脑上的这两个文件删掉 |
| `VPS_SSH_KNOWN_HOSTS` | 服务器的「身份指纹」，防止部署时连到冒充的机器 | 在你自己的电脑上运行 `ssh-keyscan -p 端口 服务器IP`，把输出的全部内容粘贴进来。服务器重装系统后要重新获取 |

**Environment variables（不是密钥，1 项必填、1 项可选）**：同一页面的 Environment variables → Add environment variable。

| 变量名 | 是什么 | 怎么填 |
| --- | --- | --- |
| `APP_DOMAIN` | 这个环境的域名 | 准备工作第 2 步的域名，只写域名本身，小写，不带 `https://` |
| `ACME_EMAIL`（可选） | 申请 HTTPS 证书用的联系邮箱 | 填你的邮箱；证书快到期出问题时证书机构会发邮件到这里。不填也能正常申请证书 |

### 二、放在 VPS 上的（`.env` 文件，程序运行要用的密钥）

**在哪**：初始化流程会自动建好这个文件并设成只有部署账号能读（权限 600）：

- 测试环境：`/opt/nozomi/staging/.env`
- 正式环境：`/opt/nozomi/production/.env`

文件里一行一个 `变量名=值`，值不加引号、等号两边不留空格。需要你填的几项已经留好了空行，用 `nozomi` 账号登录服务器后编辑即可；填完怎么生效见 `docs/deploy.md`「第一次上线」第 7 步。

| 变量名 | 是什么 | 谁来填 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | 数据库「迁移账号」的密码：只在更新数据库结构、备份和恢复时用，程序平时运行不用它，也拿不到它 | **自动生成，不用管。** 不要修改或删除：数据库是用它建的，改了就连不上 |
| `POSTGRES_APP_PASSWORD` | 数据库「应用账号」的密码：程序平时运行用的账号，权限最小（不能改数据库结构，不能改、删操作日志） | **自动生成，不用管。** 新服务器在初始化时生成；更早初始化的服务器在下一次部署时自动补上。不要修改或删除 |
| `AUTH_JWT_SECRET` | 登录签名密钥（用来防止别人伪造登录状态） | **自动生成，不用管。** 怀疑泄露时告诉 Claude 更换（所有人需要重新登录） |
| `STRIPE_SECRET_KEY` | Stripe 的后台密钥 | 你填。Stripe 控制台 → Developers → API keys → Secret key。测试环境必须用 Test mode 下以 `sk_test_` 开头的；正式环境用以 `sk_live_` 开头的 |
| `STRIPE_PUBLISHABLE_KEY` | Stripe 的前台密钥 | 你填。同一页面的 Publishable key。测试环境 `pk_test_` 开头，正式环境 `pk_live_` 开头 |
| `STRIPE_WEBHOOK_SECRET` | Stripe 通知的验证密钥 | 你填。Stripe 控制台 → Developers → Webhooks → Add endpoint，网址填 `https://你的域名/webhooks/stripe` → 建好后点开，复制 Signing secret（`whsec_` 开头）。要等这个环境第一次部署成功、域名能打开之后再建 |
| `GOOGLE_MAPS_API_KEY` | 谷歌地图密钥（算里程和时长、搜地址） | 你填。Google Cloud Console → 新建项目 → 启用 Routes API 和 Places API → 凭据 → 创建 API 密钥，并限制只能调用这两个 API |

**什么时候必须填**：Stripe 的三项要么都填、要么都不填。测试环境可以先不填就上线，对应功能在 `/health` 里显示「未配置」；**正式环境必须全部填好**，否则程序拒绝启动。

不用你填的：运行环境（`APP_ENV`）、域名（`APP_DOMAIN`）、两个数据库连接串（`DATABASE_URL`、`DATABASE_MIGRATION_URL`，由上面两个数据库密码拼出来）、对外网址（`PUBLIC_BASE_URL`）、程序版本，都由部署流程自动传入或拼出来；汇率数据源有默认值。

### 本地 `.env` 里的数据库两行

本地开发库是自己电脑上的容器，`.env.example` 里已经写好两行公开的默认值，复制过去不用改：

| 变量名 | 是什么 |
| --- | --- |
| `DATABASE_MIGRATION_URL` | 迁移账号的连接串：只有 `pnpm db:migrate`、`pnpm db:provision` 用 |
| `DATABASE_URL` | 应用账号的连接串：程序、管理员命令和测试用。第一次先运行 `pnpm db:provision` 把这个账号建出来 |

两行不能填成同一个账号；把迁移账号填进 `DATABASE_URL` 时程序会拒绝启动并说明原因（ADR 0010）。

### 填好之后

按 `docs/deploy.md`「第一次上线」的顺序操作（运行 Server init → 把 `VPS_SSH_USER` 改成 `nozomi` → 运行 Deploy）。需要 Claude 协助时告诉它「VPS 信息已填好」即可，**不要把任何值发到聊天里**。要看哪些密钥已配置，打开 `https://你的域名/health`，或在服务器上运行 `docs/deploy.md`「怎么看状态」里的命令，它只显示每一项「已配置 / 未配置」和打了码的片段。

## 需要注册的第三方账号

| 账号 | 用途 | 去哪里注册 | 必需于 |
| --- | --- | --- | --- |
| Stripe | 客人付款、退款、事后加收 | stripe.com，先用 Test mode | production（staging 可以先不配就上线） |
| Google Cloud | 里程 + 时长报价、地址搜索 | console.cloud.google.com，需要绑定付款方式 | production（staging 可以先不配就上线） |
| 汇率 | 中央换算中心 | 免费源 open.er-api.com，无需注册 | 已有默认值 |

## 规则

1. 测试环境只用 Stripe 测试密钥（`sk_test_`），代码会拒绝在非正式环境使用正式密钥。
2. 每个环境的 `AUTH_JWT_SECRET`、`POSTGRES_PASSWORD`、`POSTGRES_APP_PASSWORD` 都不一样；`AUTH_JWT_SECRET` 泄露后立即更换，所有人需要重新登录。数据库的两个密码怀疑泄露时告诉 Claude 更换。
3. 谷歌地图密钥必须在 Google Cloud 里限制 API 范围，并设置每日用量上限。
4. 部署用的 SSH 私钥只用于部署，只存在 GitHub 的 Environment secrets 里；怀疑泄露时从 VPS 的 `authorized_keys` 里删掉对应公钥，再生成一把新的。
5. VPS 上的 `.env` 文件权限保持 `600`，不要复制到别处，不要提交到仓库。
6. 任何人（包括 Claude）发现仓库里出现了密钥原文：立即在对应平台作废该密钥，再清理提交历史。
7. 新增一个第三方集成时，必须同时更新 `.env.example`、`packages/config`、本文件。
