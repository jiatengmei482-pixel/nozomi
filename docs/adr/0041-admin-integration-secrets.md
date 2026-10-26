# ADR 0041：在运营后台填写第三方密钥（谷歌地图、Stripe）

- 状态：已采纳（2026-10-26，M4-09）
- 补充 ADR 0005「配置与密钥」：谷歌地图、Stripe 的密钥多一个来源——超级管理员在运营后台填写，加密存库，**后台填写的优先**。
  其余配置和密钥（数据库、登录签名密钥、数据加密密钥、汇率、底图等）仍然只来自环境变量；读取规则仍然集中在 `packages/config`（优先顺序、打码、校验都在那里，见下）。
  CLAUDE.md 规则 5「密钥只通过 packages/config 读取」对这两项的含义变成：**生效的值只经 `packages/config` 的 `resolveIntegrations` 选出**，后台那一份由 `apps/api` 从库里读出、解密后交给它。
- 补充 ADR 0007「测试环境的配置校验」：production 启动时**不再要求**配置文件里有谷歌地图和 Stripe（见「正式环境的启动检查」）。
- 补充 ADR 0027 / 0030 的 `SecretBox`：多一个用途 `integration-secret`。
- 补充 ADR 0030 的权限：新操作 `integration.manage`，菜单表「集成状态」多一格「编辑」，和平台账号的编辑、角色的编辑和审核一样**只归超级管理员、自建角色勾不了**。
- 迁移 0080（0052–0079 留给别的任务）。

## 背景

负责人不用命令行，希望在运营后台直接填谷歌地图密钥（以后还有 Stripe 测试密钥），不用登服务器改 `.env`、不用重新部署。

## 决定

### 谁能做什么

| 角色 | 看（`GET /platform/v1/integration-secrets`） | 填写 / 更换 / 清空 / 测试一下 |
| --- | --- | --- |
| 超级管理员 | 状态、来源、打码后的末 4 位、谁什么时候改的 | 能（`integration.manage`） |
| 技术、勾了「集成状态 · 查看」的自建角色（`integration.read`） | 只有「已配置 / 未配置」和来源（`masked`、`admin` 为 null） | 403 |
| 其他角色 | 403 | 403 |

- 只读的人（技术、自建角色）也看得到 Stripe 生效的是测试还是正式密钥（`mode`）：**有意保留**——这不是密钥的任何部分、不敏感，排查「为什么收不到钱 / 为什么扣的是测试卡」时最先要知道它。

- 两步验证没完成、必须先改密码的会话照例在鉴权这一步被拦（ADR 0013、0030）。
- **为什么只给超级管理员**：能换 Stripe 密钥就能把客人的钱收进别人的账户；和「管平台账号」「改角色」同一等级。自建角色勾不了 `integrations:edit`（400 `SUPER_ADMIN_ONLY`），万一库里存进了这一格，换算权限时也丢掉（`actionsOfGrants`）。
- 不走双人复核：负责人现在是唯一的超级管理员，复核会让他自己填不了；每次改动都有审计（见下）。以后要加复核，登记一类即可。

### 优先顺序

**运营后台填写的优先；后台没填（或清空后）才用服务器配置文件（`.env`）里的值；都没有就是未配置。**

- 谷歌地图、Stripe **分别**判断：可以谷歌地图用后台的、Stripe 用配置文件的。
- Stripe 三项（secret key、publishable key、webhook signing secret）是一组，整组来自同一处，不会一项来自后台、一项来自配置文件。
- 后台那一份不适用于当前环境时（例如测试环境的库被拿到正式环境用，里面是测试密钥）不生效，回落到配置文件，页面标出原因（`admin.problem = NOT_ALLOWED_IN_ENV`）。
  后台那一份解不开时（数据加密密钥换了、库里的内容被改过）同样不生效、回落，标 `UNREADABLE`，需要重新填写。
- 页面每一项显示生效来源：「后台设置（••••1234）」/「服务器配置文件（••••5678）」/「未配置」，并有一句话说明这个顺序（接口的 `precedence_note`）。
- `/health` 的 `integrations` 按生效的值报「已配置 / 未配置」（不带来源和打码）；`GET /platform/v1/integrations` 的说明写来源，末 4 位只给超级管理员。
- `pnpm config:check` 在服务器上只看配置文件，末尾提示「后台填写的优先，看运营后台」。

为什么后台优先：负责人日常用后台；如果配置文件优先，他在后台填了、但 `.env` 里有一份旧值时页面会「填了不生效」，很难理解。清空后台那一份就回到配置文件，可以随时撤回。

### 校验（`packages/config` 的 `stripeKeyIssues`、`adminStripeKeyIssues`、`googleMapsKeyIssues`）

- 每项 20–255 个字符，只能有英文字母、数字、下划线、连字符；首尾空白去掉（粘贴时常带）。
- Stripe 沿用配置文件的规则（同一个函数，配置文件那边换成原来的报错说法）：三项一组；`sk_test_` / `sk_live_`、`pk_test_` / `pk_live_`、`whsec_` 开头；两把密钥同为测试或同为正式；
  **非正式环境只收测试密钥，正式环境只收正式密钥**（正式环境的规则和原来一样，不放宽）。
- 不合格 400 `VALIDATION_FAILED`，每条只有字段（`/secret_key`）、原因代码（`REQUIRED`、`FORMAT`、`TOO_SHORT`、`TOO_LONG`、`PREFIX`、`MODE_MISMATCH`、`LIVE_KEY_NOT_ALLOWED`、`TEST_KEY_NOT_ALLOWED`）和一句说明，**不回显填的值**。
- publishable key 本来要发给浏览器（下单时给渠道、官网），但在后台页面上和另外两项一样打码显示，统一处理。

### 存储

- 新表 `integration_secrets`（迁移 0080）：一项一行（`google_maps`、`stripe`）；`sealed` 是 `SecretBox` 的密文（AES-256-GCM，主密钥 `DATA_ENCRYPTION_KEY` 经 HKDF 按用途 `integration-secret` 派生，附加数据是这一行的 `integration`，搬到别的行解不开），
  明文是这一项的几个值的 JSON；`hints` 是每个值打码后的样子（`••••` + 末 4 位，短于 16 个字符的只有圆点），显示用、不用解密；`version` 每次更换加一；`updated_at`、`updated_by`。
- 清空 = 删掉这一行。平台角色可读、写、删；租户角色没有任何权限（`schema-structure.itest.ts` 登记）。
- 服务器没有配置数据加密密钥时不能在后台填写（503 `INTEGRATION_ENCRYPTION_NOT_CONFIGURED`）。正式环境本来就必须配置它（ADR 0027）。
- 原文只出现在：请求体（进来就校验、加密）、每个进程的缓存（解密后给收款、测试一下用）。接口返回、错误信息、审计、日志里都没有；日志脱敏的名单每次现取，包括后台填写的值。

### 立即生效（不重启、不重新部署）

- 每个进程有一份缓存（`IntegrationSecretCache`）：读库、解密、按优先顺序选出生效的值。收款服务、`/health`、日志脱敏都**同步**从缓存取。
- **本进程**改了（填写、更换、清空）之后立刻重读：返回之前新值已经生效。
- **别的进程**（以后多开的服务进程）：缓存 5 秒过期；每个请求开始前、订单定时任务每轮开始前看一眼，过期了先重读（最多等 0.5 秒，等不到先用手上的值，重读在后台接着做）——所以最迟 5 秒后用上新值。
  选「短缓存」而不是「版本号 + 每个请求查一次」：只有两行、改得极少，每 5 秒一次查询足够；数据库慢或连不上时也不会拖住每个请求（`/health` 的时限照旧）。
- 收款服务（`ctx.payments`）每次取都按生效的 Stripe 密钥：三项变了才新建一个 `StripePaymentProvider`，没变一直用同一个。Stripe 的通知验签、下单、退款、离线扣款都跟着走。
- 谷歌地图现在只有「测试一下」用到（报价的路线预估接谷歌地图时，同样从缓存取生效的密钥）。

### 测试一下

- 谷歌地图：Routes API 的 `computeRoutes`，东京站 → 新宿站、驾车、不考虑实时路况，字段掩码只要 `routes.distanceMeters`——Routes API 最便宜的一档（Essentials），每次测试**产生一次调用，费用极少**（在谷歌每月的免费额度内基本不计费）。
  选 Routes API 而不是 Places API：报价要用的「里程 + 时长」就是它，测它最能说明密钥能不能用。密钥放在请求头 `X-Goog-Api-Key`，不放网址里；不跟随重定向；每次最多等 5 秒，连不上、超时、5xx 再试 1 次。
- Stripe：查余额（`GET /v1/balance`），只读、不产生费用；再核对余额的 `livemode` 和密钥的测试 / 正式对得上。每次最多等 8 秒，再试 1 次。publishable key、webhook signing secret 没有只读的验证办法，只核对格式。
- **限速**：同一项每 5 秒最多测一次，不分人（谷歌地图每次测试都计费，连点或被人刷不能放大费用）；超了 429 `INTEGRATION_TEST_RATE_LIMITED`（`details.retry_after_seconds` 和 `Retry-After`），页面显示「刚测过，请过几秒再试」。
  计数在每个进程里（现在只有一个服务进程）；以后多开进程，最坏是每个进程各 5 秒一次。
- 谷歌的应答体边读边截，只读前 64 KB（对方回一个超大应答也不会整个读进内存）。
- 测的是**现在生效的那一份**（不论来自后台还是配置文件）。结果是数据（200）：可用，或不可用 + 原因代码（`KEY_INVALID` 密钥无效、`API_NOT_ENABLED` 没启用 Routes API、`KEY_RESTRICTED` 密钥的限制不允许、`BILLING_DISABLED` 没绑定付款方式、
  `PERMISSION_DENIED`、`QUOTA_EXCEEDED`、`MODE_MISMATCH`、`TIMEOUT`、`UNREACHABLE` 网络不通、`UNAVAILABLE`、`UNEXPECTED`）+ 一句我们自己写的说明（不带对方返回的原文）。
- 测试代码**从不调用真实的外部服务**：单元测试和集成测试都用本机的假服务器（`testing/fake-integrations.ts`）。地址由配置 `GOOGLE_MAPS_ROUTES_URL`、`STRIPE_API_URL` 指定，**只有 local / ci 能改**，staging / production 改了启动报错（否则改一行配置就能把密钥发到别处）。
  这两项只给测试用，不进 `.env.example`。

### 日志

- 请求日志只记**路由模板**（如 `/platform/v1/integration-secrets/:key`），不记实际路径——全局生效：路径参数里可能是密钥、令牌（有人把密钥误填进地址也不会进日志）。没匹配上任何路由的请求记实际路径，并抹掉其中当前配置里的密钥原文。
- 没配置 Stripe 时收到 Stripe 的通知：这是配置状态，不是程序出错，记 warn，回 503（Stripe 会稍后重发）。
- 「支付未配置」的提示统一写「请超级管理员在运营后台『系统设置 → 系统状态 → 第三方密钥』填写 Stripe 的三个密钥」。

### 并发

两个人同时改同一项：先按项名取事务级 advisory lock 排队（这一项还没有行时 `for update` 锁不住任何东西），后到的在先到的提交后再读——所以两个人同时第一次填写，审计里是一条「填写」一条「更换」，更换的前值是先到那一份的末 4 位。清空同样排队。

### 审计

资源 `integration_secret`，`resource_id` 是 `google_maps` / `stripe`；动作 `set`（填写）、`replace`（更换）、`clear`（清空）、`test`（测试一下）。谁、何时、从哪个地址照常记录。
前后值只有打码后的末 4 位（`{ hints: { api_key: "••••1234" } }`）；测试记来源和结果（`{ source, ok, code }`）。**不记原文，也不记末 4 位以外的任何部分。**

### 正式环境的启动检查

- 原来：production 配置文件里没有 `GOOGLE_MAPS_API_KEY` 或 Stripe 三项就拒绝启动。
- 现在：**不再拒绝**。两项可以在配置文件或后台任一处填写；启动时配置文件里没有，`/health` 显示「未配置」，在后台填好后立即变成「已配置」。
- 理由：启动检查只看得到配置文件；后台的值要连上数据库、解密才知道。如果继续要求配置文件里有，「在后台填写」在正式环境就没有意义——第一次上线时程序起不来，也就进不了后台。
- 代价：正式环境可能「运行着但还不能收款」。上线检查清单（`docs/deploy.md`）要求上线后先看 `/health` 两项都是「已配置」，并在后台点「测试一下」。
- 不变：配置文件里**给了** Stripe 就必须三项齐全、正式环境必须是正式密钥、非正式环境不能用正式密钥；production 必须配置数据加密密钥、登录签名密钥至少 64 个字符。

## 接口

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /platform/v1/integration-secrets` | `integration.read` | 两项的状态、来源、（超级管理员才有的）打码值和后台那一份的详情、`precedence_note`、`can_manage`、`encryption_configured` |
| `PUT /platform/v1/integration-secrets/{google-maps\|stripe}` | `integration.manage` | 填写或更换；返回 `action`（`set` / `replace`）和这一项现在的状态 |
| `DELETE /platform/v1/integration-secrets/{google-maps\|stripe}` | `integration.manage` | 清空后台那一份（没填过 409 `INTEGRATION_SECRET_NOT_SET`） |
| `POST /platform/v1/integration-secrets/{google-maps\|stripe}/test` | `integration.manage` | 测试一下（都没配置 409 `INTEGRATION_NOT_CONFIGURED`） |

## 测试

- 单元：`packages/config/src/integration-secrets.test.ts`（打码、优先顺序、后台值不适用于当前环境时回落、集成状态按生效值、Stripe 三项一组和测试 / 正式前缀、后台填写的写法、日志脱敏的名单、测试用地址只有 local / ci 能改）、
  `index.test.ts`（production 不再要求配置文件里有两项、给了 Stripe 仍须正式密钥、说明只露末 4 位）、`packages/domain/src/access-roles.test.ts`（`integrations:edit` 只归超级管理员）、
  `apps/api/src/integrations/google-maps.test.ts`、`stripe.test.ts`（本机假服务器：请求的样子、各种不可用的归类、重试、超时、连不上，结果里没有密钥和对方原文）。
- 集成（真实 PostgreSQL）：`integration-secrets.itest.ts`（只有超级管理员；其他 9 个内置角色、自建角色、未完成两步验证 403；技术只看状态；返回、错误、审计、日志逐个值比对没有原文；库里是密文；
  保存后 `/health`、通知验签、测试一下立即用新值；清空回落到配置文件；另一个进程过了缓存周期用上新值；解不开时回落并标出；没有数据加密密钥 503；租户拿不到）；
  新接口登记进 `platform-admin.itest.ts`（权限矩阵）、`password-change-bypass.itest.ts`（必须先改密码）；`mfa-required.itest.ts` 自动遍历。

## 运营后台页面

放在「系统设置 → 系统状态」页，每项一行：名称、生效来源与打码值、「填写 / 更换」「清空」「测试一下」，加一句优先顺序的说明；只有 `can_manage` 为真时显示按钮。
由前端角色按本文的接口实现，组件测试和端到端测试随页面一起写（端到端用 `testing/fake-integrations.ts` 的假服务器，经 `GOOGLE_MAPS_ROUTES_URL`、`STRIPE_API_URL` 指过去）。

## 本期不做

- 改动的双人复核（见「谁能做什么」）。
- 其他密钥（数据库、登录签名密钥、数据加密密钥）不进后台：它们是程序启动、解密后台密钥本身所需要的。
