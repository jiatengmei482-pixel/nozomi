# ADR 0086：测试环境的只读核对改走只读接口，不用 SSH（M8-34）

- 状态：已采纳（业主 2026-11-12 要求：不用 SSH，改成「GitHub Actions + 只读平台账号」）。
- 补充 ADR 0075 第三部分第 3 节、ADR 0080 的「回放最近 30 天询价」怎么在测试环境执行；**不推翻**它们，也不改 ADR 0007 的部署方式（部署照旧用 SSH 和部署钥匙）。
- 来源：`docs/delivery/proposals/staging-readonly-check.md` 的方案 A。原方案是 Actions 用部署钥匙 SSH 上服务器跑 `areas:role-preview`；业主改为不用 SSH。

## 背景

`pnpm areas:role-preview`（回放最近 N 天询价，确认原来报得出的价 0 处变化）只能用服务的应用账号连数据库，以前只能登录服务器执行，没有写进文档。业主规定没有文档的手动上服务器一律不做，所以 M8-30 合并后没法在测试环境跑。

## 决定

### 1. 只读接口

新增 `GET /platform/v1/reports/area-role-preview?days=1..90`（默认 30）：

- 内容就是命令行用的 `buildRolePreview`，结构和 `--json` 一样（字段名也是驼峰），同一时刻、同一天数两边逐字段相同（集成测试核对）。没有客人信息、没有坐标。
- 权限用现有的 `quote.preview`（报价试算），**不加新权限、不改角色矩阵**：清单里有的（供应商名称、商品编号、区域名称、结算价对比）本来就是有试算权限的人能看到的。限定了数据范围的员工（ADR 0030）不能用（`DATA_SCOPE_DENIED`）：清单跨全部供应商、城市，切不开。
- 只读：回放在平台角色的只读快照事务里（`begin … read only`，可重复读），数据库拒绝任何写入。
- 调用本身留痕：先在一个普通事务里占一次限速额度、写一条审计（对象 `area`、操作 `view`，改后值 `{ report: "area_role_preview", days }`），再进只读事务回放。集成测试核对：一次调用之后，整个库里只有 `audit_logs`、`sales_rate_limits` 两张表有变化。
- 限速：每个员工 10 分钟 3 次（`staff_role_preview`，和其他限速同一张计数表、同一种做法），超过 429 + `Retry-After`。
- 时限：回放每条询价之前看一次墙钟，超过 45 秒就停下，503 `REPORT_TIMEOUT`，请把天数改小。45 秒比反向代理常见的 60 秒应答时限短，调用方拿到的是清楚的错误码而不是代理的 504。命令行不限时，行为不变。

### 2. 手动工作流

`.github/workflows/staging-readonly-check.yml`：

- 只有 `workflow_dispatch`（输入 `days`，默认 30）；环境固定 `staging`（不由输入决定）；权限只有 `contents: read`。
- **不用 SSH、不用部署钥匙**：只用 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact`，运行 `node scripts/staging-readonly-check.mjs`（不需要安装依赖）。
- 脚本用 staging 环境 secrets 里的 `STAGING_READONLY_EMAIL`、`STAGING_READONLY_PASSWORD`、`STAGING_READONLY_TOTP` 登录（密码 → `/platform/v1/auth/mfa/verify` 两步验证，动态码按 RFC 6238 现算；同一时间窗的码被用过时等下一个窗口再试一次），经 HTTPS（`https://` + 环境变量 `APP_DOMAIN`）调用上面的接口，存成 JSON 产物，最后退出登录。
- 退出码：0 = 0 处变化；2 = `externalDiffCount` 或 `priority.changedCount` 大于 0（工作流失败）；1 = 没配好或调用失败。缺 secrets 时写明缺哪几项、去哪填，不调用测试环境。
- 不打印密码、动态码密钥、动态码和令牌；接口报错只打印状态码和错误代码，不打印应答原文。
- 静态测试（`apps/api/src/staging-readonly-check.test.ts`）核对：只有 dispatch、环境只能是 staging、去掉注释后没有 ssh / 部署钥匙 / production、只用上面三个官方 action、secrets 只经环境变量传给脚本、输入不拼进命令行。

### 3. 账号

业主本人在测试环境建一个专用平台账号，建议用只勾「报价试算」、数据范围不限的自建角色（不加新的内置角色），密码和两步验证密钥只填在 GitHub 的 staging 环境 secrets 里（`docs/secrets.md`）。

## 为什么不用 SSH

- 部署钥匙能管理服务器上所有容器（测试服务器和别的服务共用，`docs/deploy.md` 第八节第 5 条），只读核对不该拿到这么大的权限。
- 只读接口的权限边界由应用自己保证（角色、只读事务、审计、限速），和运营后台其他功能一样，有集成测试覆盖；SSH 白名单命令的边界只能靠工作流脚本自律。
- 不用在服务器上执行任何命令，业主的「没有文档的手动上服务器一律不做」自然满足。

## 代价

- 接口占一个 API 进程的连接最多 45 秒；限速和时限把它控制住。测试环境数据量下回放 30 天远小于这个时间。
- 多了一个长期有效的平台账号密码 + 两步验证密钥存在 GitHub。缓解：只给报价试算权限、只放在 staging 环境、可以随时在运营后台停用。

## 留作方案（这次不做）

- **B：PR 版本先上测试环境预览**（`deploy.yml` 手动触发加 PR 编号，或同机第二套隔离的预览栈）。风险较高，需要业主再决定。
- **C：main 的 CI 失败导致测试环境没部署时的提醒**（例如在进度页标红「测试环境不是最新的 main」）。
- 两项的具体内容见 `docs/delivery/proposals/staging-readonly-check.md`。
- 正式环境不提供这个按钮；需要时另开任务，单独评估。
