# 账号与密钥存放规则

**一句话**：密钥只存在下面 4 个地方，代码仓库里永远没有密钥原文。也不要把密钥发在和 Claude 的聊天里——请你自己在对应的设置页面填写。

填好后在对应环境运行 `pnpm config:check`，会列出哪些账号已配置（只显示脱敏信息）。

## 存放位置

| 位置 | 给谁用 | 怎么进入 | 填什么 |
| --- | --- | --- | --- |
| 本地 `.env` 文件 | 你自己的电脑上运行 | 复制 `.env.example` 为 `.env` | 全部变量，Stripe 只用测试密钥 |
| claude.ai/code 云端环境变量 | Claude 的开发会话 | claude.ai/code → 选择环境 → 环境设置 → Environment variables | 开发和端到端测试需要的变量，Stripe 只用测试密钥 |
| GitHub Actions Secrets | 自动测试和自动部署 | 仓库 → Settings → Secrets and variables → Actions | 部署钩子、端到端测试用的测试密钥 |
| Render 环境变量 | 测试环境和正式环境的服务器 | Render 控制台 → 对应服务 → Environment | 该环境运行所需的全部变量 |

## 需要的账号

| 账号 | 用途 | 去哪里拿 | 变量名 | 必需于 |
| --- | --- | --- | --- | --- |
| Stripe | 客人付款、退款、事后加收 | Stripe 控制台 → Developers → API keys（先用 Test mode） | `STRIPE_SECRET_KEY`、`STRIPE_PUBLISHABLE_KEY` | staging、production |
| Stripe Webhook | 接收付款成功、拒付等通知 | Stripe 控制台 → Developers → Webhooks → 添加端点（需要先有测试环境网址，M0-08 完成后再建） | `STRIPE_WEBHOOK_SECRET` | staging、production |
| 谷歌地图 | 里程 + 时长报价、地址搜索 | Google Cloud Console → 新建项目 → 启用 Routes API、Places API → 凭据 → 创建 API 密钥，并限制只能调用这两个 API | `GOOGLE_MAPS_API_KEY` | staging、production |
| Render | 部署测试环境和正式环境（服务器 + 数据库） | render.com 注册 → 用 GitHub 登录并授权本仓库 | 部署钩子 `RENDER_DEPLOY_HOOK_STAGING`（放 GitHub Secrets） | 部署时 |
| 数据库 | 存全部业务数据 | Render 创建 PostgreSQL 后复制 Internal Database URL | `DATABASE_URL` | 全部环境 |
| 登录签名密钥 | 签发登录令牌 | 自己生成：`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` | `AUTH_JWT_SECRET` | 全部环境，各环境不同 |
| 汇率 | 中央换算中心 | 免费源 open.er-api.com，无需注册 | `FX_SOURCE_URL` | 已有默认值 |

## 规则

1. 测试环境只用 Stripe 测试密钥（`sk_test_`），代码会拒绝在非正式环境使用正式密钥。
2. 每个环境的 `AUTH_JWT_SECRET` 都不一样；泄露后立即更换，所有人需要重新登录。
3. 谷歌地图密钥必须在 Google Cloud 里限制 API 范围，并设置每日用量上限。
4. 任何人（包括 Claude）发现仓库里出现了密钥原文：立即在对应平台作废该密钥，再清理提交历史。
5. 新增一个第三方集成时，必须同时更新 `.env.example`、`packages/config`、本文件。
