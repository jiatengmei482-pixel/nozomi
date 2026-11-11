# ADR 0078：测试环境的验收通道（口令解锁会话 + 「验收可售」商品 + 验收单）

- 状态：已采纳（2026-11-10；M8-26 实施）。方案由负责人批准（M8-26 任务说明里的 7 条决定）。
- 补充 ADR 0077（QA 测试供应商）、ADR 0032（官网）、ADR 0026（下单与付款）、ADR 0040（账单）、ADR 0049（通知中心）。**都不改**：普通客人、销售端、平台试算、真实供应商的一切行为不变。
- 编号：写这篇时 main 上最大是 ADR 0077，迁移最大 0300。本篇用 ADR 0078、迁移 0310。

## 背景

M8-14 要在测试环境走一遍全链路：客人询价 → 下单 → Stripe 测试付款 → 订单页和邮件 → 供应商订单详情 → 派车 → 司机页。测试环境里的真实供应商不能拿来下测试单；QA 测试供应商（ADR 0077）永远停在申请中、不上架、不参与官网比价，官网上根本报不出它的价。需要一条**只有验收角色能进**、**不会碰到真实供应商和真实客人**、**不影响官网比价**的通道。

## 决定

### 1. 口令 `QA_ACCEPTANCE_TOKEN`（密钥）

- 只经 `packages/config` 读；32–256 个可见 ASCII 字符，不能和别的密钥相同。
- **两道关**：`APP_ENV=production` 时配了它，配置校验失败、服务拒绝启动；此外每一处用到它的代码（`services/qa-acceptance.ts` 的 `qaAcceptanceActive`、`siteAudienceOf`）再判断一次不是 production（domain 的 `qaAcceptanceEnabled`）。
- 没配置时测试环境和以前完全一样。
- 口令不进代码、日志（`logging.ts` 的 `secretValues` 抹掉它）、报错、审计、应答；`/health` 和 `pnpm config:check` 不提它（不透露有没有验收通道）。

### 2. 解锁：`POST / GET / DELETE /site/v1/qa-acceptance/session`

- `POST`，JSON `{ token }`：口令在请求体里，不进网址、地址栏和访问日志。两边各取 SHA-256 再 `timingSafeEqual`（常量时间，长度不同也不提前返回）。
- 对了：201，`Set-Cookie: nozomi_qa=<32 字节随机数 base64url>; Path=/site/v1; Max-Age=14400; HttpOnly; Secure; SameSite=Strict`。库里（`qa_acceptance_sessions`，平台表）只存它的 SHA-256、有效期（4 小时）和解锁时口令的指纹（加了用途前缀的 SHA-256；换了口令旧会话立即作废）；审计记「匿名 / 解锁」。
- 不对：**和接口不存在一模一样的 404**（`NOT_FOUND`「接口不存在」），审计记「匿名 / 口令不对」，只有原因 `WRONG_TOKEN`，不记口令。
- 没配置（或 production）：三个方法都在**解析请求体之前**（`onRequest`）答同样的 404，请求体写坏了也是 404，看不出这个接口存在。
- 限速（`rate-limit.ts` 的已有做法，计数先提交）：每个来源地址（IPv6 按 /64）15 分钟 10 次、全站每小时 30 次，**成功失败都计**；超限 429。所以只有在口令配置了、又有人在猜时，才会多出一个 429。
- `GET` 看这个浏览器的会话（验收确认自己解锁了）；`DELETE` 结束会话（记结束时间、审计）并清掉 Cookie。

### 3. 「验收可售」（`qa_listed`）和谁看得到它

- 商品多一个状态 `qa_listed`（「验收可售」）。新接口 `POST /tenant/v1/products/{id}/qa-list`（`product.manage`）：只有 `is_test_tenant` 的供应商能用，别的 409 `NOT_TEST_TENANT`；要过和上架同一份上架校验。下架用原来的「下架」。
- 三层把住「只有测试供应商」：数据库触发器 `products_qa_listed_test_tenant_only`（任何代码把别的供应商的商品写成 `qa_listed` 都拒绝；还有验收可售商品的测试供应商不能被摘掉测试标记）、服务层 409、测试。供应商仍停在申请中，ADR 0077 的约束、`tenantCanPublish`、`tenantBids` 一条没改。
- 带**有效**验收会话 Cookie 的官网请求（城市、机场、包车套餐、询价、按两个坐标报价、下单）：报价目录只取 QA 测试供应商的 `qa_listed` 商品（`loadQuoteCandidates` 的 `listing: "qa_listed"`，SQL 里要求 `t.is_test_tenant`），**不和真实供应商混在一起**，所以验收单一定落在 QA 测试供应商身上。报价引擎用 domain 的 `listedFor("acceptance", …)` 判断在卖（不看入驻状态，只认测试供应商的验收可售）；渠道的供应商名单不看（城市、品类的授权照旧）。
- 不带 Cookie：一切不变。普通询价只认「已上架」，SQL 和以前等价；目录缓存的键给验收另起一份（`qa_listed|` 前缀），两边不串。`/sales/v1`、平台试算、救援候选从不传验收，永远看不到它。
- 带了 Cookie 但会话无效、过期、已结束，或者通道没开：401 `QA_SESSION_INVALID`。**不悄悄退回普通客人**——那样验收角色以为在测 QA 供应商，单却下到了真实供应商。普通客人从不带这个 Cookie，不受影响；production 里 Cookie 一律不看。

### 4. 验收单

- `orders.is_acceptance`：只由服务端在验收会话下单时设，触发器保证建好之后谁都不能改。报价和询价日志也标 `is_acceptance`；下单时报价的标记要和会话一致（验收报价不带会话下不了单，普通报价带会话也下不了单，都按「报价不存在」）；`GET /sales/v1/quotes/{id}` 查不到验收报价。
- 运营后台订单列表和详情多一个字段 `is_acceptance`（页面上标「验收」的徽标留给前端）。
- **不进结算**：出账（`listBillableItems`、`listTenantsWithBillableItems`）排除验收单，所以账单、付款批次、银行转账文件都不会有它；毛利试算（ADR 0033）也不算验收报价和验收单；超时未派车的自动救援不扫它；救援改派对验收单 409 `ACCEPTANCE_ORDER_NOT_RESCUABLE`（不能转给真实供应商）。
- 留在库里：只取消，不删除。验收单不记「未覆盖需求」（那是给运营看的真实需求）。

### 5. 付款：只用 Stripe 测试模式

- 验收会话下单前先查收款服务：没配置 503 `PAYMENT_NOT_CONFIGURED`；不是测试模式（收款服务的 `livemode`，即密钥前缀判断，ADR 0041；再核对 publishable key 是 `pk_test_`）409 `ACCEPTANCE_REQUIRES_TEST_PAYMENTS`。两种都**不建单**。
- 已有的验收单在订单页接着付款（`GET /site/v1/order/payment`）同样要求测试模式。普通官网单的行为不变（Stripe 没配置照样建单）。

### 6. 邮件：只给 qa-staging@ 真的发

- 验收单的客人邮箱只能是 `…@example.com` 或正好 `qa-staging@nozomi.moveglobal.io`（不分大小写、全角转半角；`sub.example.com`、`example.com.cn` 不算），否则 400 `ACCEPTANCE_EMAIL_NOT_ALLOWED`。
- 通知中心发信前：订单是验收单、收件人不是 `qa-staging@nozomi.moveglobal.io` → **不发**，记成 `expired`、错误码 `ACCEPTANCE_SUPPRESSED`（不能重试），主题和正文存进 `notification_suppressions`（平台表，只给平台角色；供应商读得到发给自己的发送记录，但读不到这里）。客人、供应商、司机、运营的邮件都一样。
- 运营后台用 `GET /platform/v1/notifications/{id}/suppressed-content`（`notification.read`，数据范围同手动重试，每看一次记审计）查看内容；正文里有当时生成的订单链接、司机链接（验收要靠它们打开订单页、司机页）。日志只有编号，不写收件人和内容。

## 为什么这样

- 用口令 + 服务端会话而不是网址参数：口令不进地址栏、浏览器历史、访问日志、Referer；Cookie 是 HttpOnly、SameSite=Strict，页面脚本拿不到，别的网站带不过来。
- 给商品加一个专门的状态，而不是让测试供应商「上架」：上架的含义（参与官网比价）一点都不变，ADR 0077 的「永远不能上架」照旧成立；`qa_listed` 只有验收会话这一条路看得到。
- 验收会话只看测试供应商、不混真实供应商：验收单永远不会派给真实供应商，也不会因为真实供应商更便宜而被它中标。

## 测试

- `packages/domain/src/qa-acceptance.test.ts`（6）：开关、口令写法、客人邮箱白名单、收件人白名单、`listedFor`。
- `packages/config/src/qa-acceptance.test.ts`（4）：不配为 null；staging / local / ci 能配，production 配了拒绝启动；不合格的口令报错且报错里没有口令；集成状态里不出现。
- `apps/api/src/services/qa-acceptance.test.ts`（5）：常量时间比较的结果、Cookie 的属性和解析、第二道关、日志脱敏清单。
- `apps/api/src/qa-acceptance.itest.ts`（14，真实接口和 PostgreSQL）：没配置 404 和不存在一样；只有测试供应商能设验收可售（409、触发器）；不带会话时有没有验收可售商品应答逐字节相同（同一时刻，报价编号除外）；`/sales/v1` 和平台试算没有它；口令不对 404 + 审计 + 限速；解锁的 Cookie 属性、库里只有哈希、结束和过期后 401；带会话只报 QA 供应商、缓存不串；验收单（报价互不通用、邮箱白名单、`is_acceptance`、运营后台字段）；Stripe 正式模式 409、没配置 503、都不建单；邮件只发 qa-staging@、其余压下并留存内容、不能重试、验收单不能救援；不进出账；production 的第二道关；租户隔离；口令不出现在任何应答、日志、审计、库里。
- 守卫测试登记了新接口：`auth`（不带令牌 401）、`password-change-bypass`、`platform-admin`（权限矩阵）、`products-openapi`（每个接口都调到）、`schema-structure`（两张新平台表的授权）。

## 本期不做

| 内容 | 去向 |
| --- | --- |
| 运营后台订单列表、详情的「验收」徽标；发送记录里「查看内容」按钮；供应商后台「设为验收可售」按钮 | 前端（接口已经有了）；验收在这之前直接调接口 |
| 验收结束后自动清理验收单 | 不做：验收单只取消、不删除（负责人决定） |
