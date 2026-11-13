# ADR 0076：人工报价申请（客人留邮箱或 WhatsApp）和客服 WhatsApp 号码

- 状态：已采纳（2026-11-10；M8-21 实施）。
  - 业主 2026-11-10：官网所有供应商都报不出价时，客人除了看到「这个地址暂时没有在线报价，请联系客服」和客服电话，还能留下联系方式、请客服人工报价；客服在运营后台跟进。
  - 业主 2026-11-10（同日改定）：表单**只收两项联系方式：邮箱、WhatsApp**（国际格式的号码），至少一项；不收姓名，不要备注；行程由页面自动带上，客人不用再填。同一处加「通过 WhatsApp 联系我们」按钮，号码在运营后台填。
- 补充 ADR 0057（乘客信息加密）、ADR 0055（个人信息保留期）、ADR 0030（平台角色和数据范围）、ADR 0032（官网接口）、ADR 0045（按地址限速）。**都不改**。
- 和 ADR 0075（M8-20「未覆盖需求」）的关系见第 7 节。ADR 0069 的 B2「人工报价留资」由这一篇实现。
- 编号：写这篇时 main 上最大是 ADR 0074，M8-20 的方案占用 0075，这里用 0076。

## 决定

### 1. 收什么、不收什么

- 联系方式：**邮箱**、**WhatsApp**（以 + 开头的国际格式，去掉空格、连字符、括号、点后 8–15 位数字、国家码不以 0 开头），至少一项。不收姓名、电话（WhatsApp 号码就是电话）、备注，也不收别的。请求体里多一个字段就是 400（`additionalProperties: false`）。
- 行程：页面已有的内容自动带上——用车类型（接送机 / 点对点 / 包车）、城市（认得出时）、上车和下车地点（名称、坐标）、用车时间（当地）、人数、行李、包车时长。接送机、点对点要有下车地点；包车要有时长，下车地点可以没有（旧预订页只选上车地点）。
- 同意：请求体的 `consent` 必须是 `true`。页面在提交按钮旁写一句「提交即同意客服通过您留下的方式联系您」，点提交就是同意，不另加勾选框（业主要求不增加步骤）。库里记同意的时间。
- 校验规则在 `@nozomi/domain` 的 `manual-quote.ts`（`manualQuoteEmail`、`whatsappDigits`、`manualQuoteTripIssues`），页面和接口用同一份。

### 2. 数据模型（迁移 `0280_manual_quote_requests.sql`）

三张**平台表**，只授权给 `nozomi_platform`（`select, insert, update`，不给 `delete`），租户角色 `nozomi_app` 和登录前角色没有任何权限：

- `manual_quote_requests`：一次提交一行。
  - 明文只有**不指向个人**的部分：编号（`MQ` + 日期 + 8 位）、状态、用车类型、城市、官网渠道、用车时间、人数、行李、包车时长、有没有邮箱 / WhatsApp、跟进人、版本、时间。列表和筛选只用这些。
  - **联系方式和两端地点（名称、坐标）一份密文** `contact_enc`。地点也加密：家庭住址加上联系方式就能认出一个人。
  - 盲索引 `email_bidx`、`whatsapp_bidx`：客服按联系方式精确查找、按联系方式限速。去重键 `dedup_key`：联系方式的盲索引加行程要点的 HMAC。三样都不能反推出内容。
  - 状态：`new` 新 / `following` 跟进中 / `quoted` 已报价 / `converted` 已转订单 / `closed` 关闭。可以改成任何别的状态（关闭后也能重新跟进），不能改回「新」。进入「已转订单」「关闭」时记 `finished_at`，改回别的状态时清空。
  - 约束保证：没清除的一定有密文；清除了的密文、盲索引、去重键都为空。
- `manual_quote_request_events`：跟进记录，只追加——客人提交（`created`）、改状态、指派、备注。备注可能写进客人的姓名、电话，**同样加密**（`note_enc`，一条一份）。`seq` 是写入顺序（同一个事务里改状态 + 指派时间相同）。
- `site_settings`：官网设置，全站一行，第一次保存时写入（不预置）。现在只有客服 WhatsApp 号码 `support_whatsapp`（wa.me 用的纯数字）。

### 3. 加密（沿用 ADR 0057）

- 同一把 `DATA_ENCRYPTION_KEY`、同一个派生用途（`passenger-data` / `passenger-index`），AES-256-GCM，附加数据带种类（`manual_quote_request` / `manual_quote_note`）、固定的归属 `platform:manual_quote` 和这一行的编号：搬到别的行解不开；盲索引和任何供应商的订单分开（同一个邮箱算出的值不同）。代码在 `integrations/passenger-crypto.ts` 的 `sealManualQuote`、`openManualQuote`、`manualQuoteIndex`、`manualQuoteFingerprint`。
- **没有明文列**：和订单不同，这里从第一天就只存密文。没配主密钥时提交 503 `PASSENGER_ENCRYPTION_NOT_CONFIGURED`，不存明文顶替。
- 限制（和 ADR 0057「换主密钥」写的一样）：`PassengerCrypto` 只认一把密钥。换了主密钥，已有的申请详情读不出来（503 `PASSENGER_DECRYPT_FAILED`），只能等它们按保留期清除。申请最多留 365 天，影响有限；以后做多密钥读取时一并解决。
- 日志里只有事件名、编号和数量。客人提交**不写审计**：审计表只能追加、要留 3 年，客人的内容不能进去；提交本身在跟进记录里。

### 4. 防刷

- 限速，用现有的 `sales_rate_limits` 分层（`SALES_RATE_LIMITS`，数值在 domain 的 `MANUAL_QUOTE_LIMITS`），被前面拦下的不占后面的：
  - 每个来源地址 15 分钟 3 次（`site_manual_quote`，校验之前就计，IPv6 按 /64）；每天 10 次（`site_manual_quote_day`，生来就按 /64）；
  - 每个联系方式每天 3 次（`site_manual_quote_contact`，按盲索引；换地址也挡，防止拿别人的邮箱刷）；
  - 全站每小时 300 次（`site_manual_quote_all`）：换地址、换联系方式刷库时的总闸。到了上限所有人都要等，页面上还有 WhatsApp 按钮和客服电话。
- 去重：同一个联系方式、同一个行程（坐标按 4 位小数）24 小时内只记一次。
- 陷阱字段 `website`：页面不显示，人不会填；有内容时什么都不记。
- **应答一律 202 `{ status: "accepted" }`**：重复、陷阱都一样，不让机器人知道哪次记上了。
- **不发任何邮件**：不给客人发确认信，也不给客服发提醒。给客人发信就等于让任何人往任意地址发信（拿别人的邮箱刷），收益不值这个风险；客服在运营后台看「新」的数量。以后要提醒客服，用通知中心发到固定的客服地址，另做。
- 只收两项、都有格式核对，每项有长度上限（地点名称 300 字、邮箱 400 字、WhatsApp 60 字）。

### 5. 权限和审计

- 新操作（`@nozomi/domain` 的 `PLATFORM_ACTIONS`）：
  - `manual_quote.read`（列表、详情）、`manual_quote.manage`（指派、改状态、写备注、看能指派给谁）：**运营、客服**（和超级管理员）。只读、财务、风控等不给：他们的工作用不到客人的联系方式（和订单不同，这里没有对账、风控的用途）。
  - `site_settings.read`（看官网设置）：运营、客服；`site_settings.manage`（改客服 WhatsApp 号码）：**只归超级管理员**，自建角色也勾不了（`SUPER_ADMIN_ONLY_GRANTS` 加 `site_settings:edit`）——号码被换掉，客人就会把行程发给别人，和第三方密钥同一种风险。
  - 勾选表各单独一格：「人工报价」（查看 / 编辑）、「官网设置」（查看 / 编辑）。已有的自建角色不会因此多出看客人联系方式的权限。
- 数据范围（ADR 0030）：限定了城市的员工只看得到城市在范围里的申请（认不出城市的看不到）；限定了渠道的只看得到官网渠道在范围里的。指派时核对跟进人的权限和范围。
- **列表没有个人信息**：只有有没有邮箱 / WhatsApp。打开详情才解密，**每次打开写一条审计**（`manual_quote_request` / `view_passenger`，只记申请编号）。改状态（`change`）、指派（`assign`）、备注（`note`，只有备注编号和字数）各一条审计，审计里没有联系方式和备注原文。官网设置的修改记审计（`site_settings` / `update`，前后的号码：公开的客服号，不是个人信息）。
- 租户碰不到：没有任何 `/tenant/v1` 接口；租户令牌调运营后台接口是 401；数据库层面租户角色没有表权限（集成测试 `manual-quotes.itest.ts` 两层都验）。

### 6. 保留期和清除

- **结束（已转订单或关闭）满 180 天**清除；不管状态，**提交满 365 天**也清除（一直没人处理的申请不能无限期留着）。180 天和订单「完成 180 天后脱敏」一致（需求《平台运营端》「个人信息保护」）。两个数是 domain 的常量（`MANUAL_QUOTE_RULES`），这一期不做成配置项：改它要业主决定，到时改常量、写进本篇。
- 清除 = 密文、盲索引、去重键清空，备注的密文清空，记 `purged_at`；行和跟进记录（谁、什么时候、改成什么状态）留下，只做数量统计。清除后不能再改状态、写备注（409 `MANUAL_QUOTE_PURGED`），详情里联系方式、地点、备注为 null。
- 定时任务 `ManualQuoteRetentionJobs`（`services/manual-quotes.ts`）跑在 API 进程里（ADR 0022）：启动 20 秒后第一次，之后每小时一轮；每轮最多 10 批、每批 200 条；一批一个事务，开头抢事务级 advisory lock，抢不到就不做这一轮（多实例安全），行 `for update skip locked`。每批一条审计（`anonymize_passenger`，只有数量和两个截止时刻）。不设开关：这个表从第一天起就按保留期管。

### 7. 和「未覆盖需求」（M8-20，ADR 0075）的关系

- **个人信息只在这里**。未覆盖需求永远不存邮箱、WhatsApp。
- M8-20 落地时在 `uncovered_demands` 加一列可空的 `manual_quote_request_id uuid references manual_quote_requests (id)`：同一次「一家都报不出」既记了未覆盖需求、客人又留了联系方式时，从未覆盖需求指向这条申请（那边只存编号）。申请清除时行还在，外键不受影响；运营看未覆盖需求时，有 `manual_quote.read` 才能点进申请看联系方式。
- 这一期不加这一列、也不在提交接口里带未覆盖需求的编号：那张表还没有。M8-20 要做的只是加列、在两边都有时写上编号。

### 8. 接口

- 官网（不登录）：`POST /site/v1/manual-quote-requests`；`GET /site/v1/config` 多一项 `support_whatsapp`（纯数字；没设置为 null，页面不显示按钮）。
- 运营后台：`GET /platform/v1/manual-quote-requests`（列表，按状态、跟进人 `me` / `unassigned` / 编号、联系方式筛，带各状态的数量）、`GET …/assignees`、`GET …/{id}`、`PATCH …/{id}`（If-Match）、`POST …/{id}/notes`；`GET`、`PUT /platform/v1/site-settings`。
- 新路由、新服务放在新文件（`routes/manual-quotes.ts`、`services/manual-quotes.ts`、`repos/manual-quotes.ts`），报价相关的文件一行不改；`routes/site.ts` 只在 config 里加了一项。OpenAPI 另起「人工报价」「官网设置」两节。

### 9. 「通过 WhatsApp 联系我们」

- 号码在运营后台「系统设置 → 官网设置」的「客服 WhatsApp 号码」填（超级管理员）。填带国家码的号码（+ 可有可无，可以有空格、连字符），存成 wa.me 要的纯数字；清空就不显示按钮。代码、测试数据里不写任何真实号码。
- 前端（M8-21 前端部分）：三处去 WhatsApp 的链接（官网的按钮、客服点客人的 WhatsApp、官网设置里「在 WhatsApp 里打开看看」）都用一个组件 `components/WhatsappLink.tsx`，地址只由 `whatsappChatUrl` 拼，号码先核对是纯数字，新标签页、`rel` 写死 `noopener noreferrer`。构建产物的守卫（`e2e/build-output.spec.ts`「产物不引用任何站外资源」）因此只多放行一个：`whatsappChatUrl` 编译后的模板原样 `https://wa.me/${…}?text=${encodeURIComponent(…`——它是客人自己点开的站外链接，不是页面加载的资源；wa.me 的其他写法和任何别的站点照旧不许。
- 页面的链接：`https://wa.me/<号码>?text=<编码后的一句话>`，新标签页打开。这句话由 domain 的 `manualQuoteWhatsappText` 生成：「您好，我想咨询用车报价：点对点，新宿站 → 成田机场，2026-12-01 09:30，2 人。」——只有用车类型（包车加时长）、上车 → 下车、时间、人数，**没有客人的任何个人信息**（客人还没留）。地点名称太长时截短。链接由 `whatsappChatUrl` 拼。
- 和客服电话的区别：客服电话现在仍是部署配置 `SITE_SUPPORT_PHONE`（ADR 0061），不在后台改；以后要搬到「官网设置」时加一列即可。

## 没有选的做法

- **收姓名、电话**：业主改定只收邮箱和 WhatsApp。
- **给客人发确认邮件**：见第 4 节，等于开放「往任意地址发信」，不做。
- **把联系方式写进未覆盖需求**：见第 7 节。
- **明文 + 密文双写**（订单的过渡做法）：新表没有历史包袱，直接只存密文。
- **列表就显示联系方式**：列表一次几十条，每次翻页都等于看了几十个人的联系方式，审计也说不清看了谁；打开一条才看、一条一审计。

## 后续

- 前端（M8-21 前端部分）：新预订页和旧预订页报不出价时的表单和 WhatsApp 按钮；运营后台「人工报价」列表和详情页（菜单在客服相关的位置）、「系统设置 → 官网设置」页；权限和审计的中文名（`platform-display.ts`、`audit-display.ts`）；设计稿章节（`site-booking-v2.md` 和运营后台客服页面的规范）。
- M8-20：未覆盖需求加 `manual_quote_request_id`（第 7 节）。
- M8-39（2026-11-13）：测试环境验收会话里提交的留资标为验收留资（`is_acceptance`），运营后台列表默认不列。做法写在 ADR 0078「补充：验收留资」，本篇的规则都不改。
