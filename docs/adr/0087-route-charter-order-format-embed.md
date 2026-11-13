# ADR 0087：线路式包车、统一订单格式、嵌入预订组件

- 状态：草稿（2026-11-13，M9-01），待独立审查；业主答复「待业主确认」（需求文档 03 末尾）后定稿。
- 依据：需求《线路式包车、统一订单格式、嵌入预订组件》（`docs/requirements/03-route-charter-order-embed.md`，业主 2026-11-13 原话逐字在其中）。
- 补充（都不推翻）：ADR 0020（报价引擎）、0026（下单与付款）、0029（改期重算、服务后加收）、0032 / 0035（官网接口）、0042（路线预估）、0046（官网内容安全策略）、0069 / 0079（新预订页）、0070（包车一口价全含）、0073（包车区域加价、含公里数的对外单价口径）、0076（人工报价留资）、0078（测试环境验收通道）、0080（报价优先级）。
- 编号：写这篇时 main 上最大是 ADR 0086，这里用 0087。

## 一、可行性结论：报价接口能不能直接收「总时长、总公里」

**不能。** 读代码的结论：

| 问题 | 代码里的事实 | 结论 |
| --- | --- | --- |
| 报价接口收不收总时长 / 总公里 | `POST /site/v1/quotes`（`SiteQuoteRequest`）、`POST /sales/v1/quotes`（`SalesQuoteRequest`）包车只有 `package_hours`（整数 1–72），没有分钟数、米数字段（`additionalProperties: false`，多给就是 400）。引擎入参 `QuoteRequest` 也只有 `packageHours`（`quote.ts` 第 89–90 行） | 接口和引擎都不收 |
| `package_hours` 能不能随便填 | `selectPriceRule` 要求 `rule.packageHours === query.packageHours`（`pricing.ts` 第 477 行）：只能命中供应商配置过的那个套餐时长；有 5、10 小时的规则时问 8 小时得到 null（`pricing.test.ts` 第 250 行），这个车型组报 `NO_PRICE_RULE`。城市能选的时长由 `GET /site/v1/cities/{id}/charter-packages` 给出（官网渠道能卖的、已上架包车商品的启用规则的时长并集） | 必须等于某个已配置的套餐时长，否则这个车型组报不出 |
| 含公里、超时价、超公里价在报价时算不算 | 计价函数 `basePrice` 本身有完整公式 `P_pkg + max(0, H − H_pkg) × p_hour + max(0, D − D_pkg) × p_km`（`pricing.ts` 第 513–515 行），但引擎报包车时**故意不给用量**：`const usage = … product.category === "charter" ? {} : …`（`quote.ts` 第 700 行，注释「包车报价时 H = 套餐时长、里程不超套餐（超时、超公里履约后按实际结算）」），所以超时、超公里在报价时恒为 0 | 报价 = 套餐价（+ 区域加价、调价、加急、夜间、附加服务）。超时、超公里是**服务后另收**：供应商在服务结束 24 小时内按实际提交金额（结算价），客人付「金额 ×（1 + 加价比例）」，先通知、48 小时可异议（ADR 0029，`extra-charges.ts` 的 `charter_overtime`、`charter_over_km`） |
| 让引擎直接算总时长、总公里要改什么 | 把包车的 `usage` 换成 `{ meters, minutes }`，再给 `QuoteRequest` 加两个字段 | 这是引擎改动（同时会改变调价、中标的基数），违背「引擎不改」，**不做** |
| 对外单价能不能从现有接口拿到 | 官网报价 `SiteQuote.package` 只有 `{ hours, km }`（`km` 由 `findQuotePackageKm` 从中标价格规则读出，`repos/site.ts` 第 148–158 行）；渠道报价 `SalesQuote` 连 `km` 都没有。超时、超公里的对外单价**哪里都没有**（需求 01 示例里的 `post_service_fees` 没有实现） | 现在拿不到 |
| 能不能只扩应答、不改计算 | 能。中标报价的价格规则编号在快照里（`snapshot.winner.offer.priceRuleId`），规则参数里有 `packageKm`、`overtimePerHourMinor`、`overKmPerKmMinor`（结算价、商品币种）；把结算单价换成对外单价已有现成的函数 `sellEquivalentMinor`（按这一单的汇率、缓冲、加价比例单独换算、单独四舍五入；ADR 0073 的 `over_km_per_km`、区域加价对外参考就是这么算的） | 只在应答里加字段，引擎的计算一行不动 |

**所以按业主给的后备方案做**：销售端（官网服务层）把行程换算成引擎现有的输入（上车点、下车点、出发时间、套餐时长 H、人数、行李、附加服务），引擎原样报价；超时、超公里的对外单价和「预计超出」只作说明另列，不进付款金额（需求 03 待确认 Q1 推荐 A）。

**对业主原话「只在销售端用引擎规则单价拼总价」的解释**：拼出来的总价是页面上显示的「**预计合计 = 引擎对外价 + 预计另收（预计超出公里 × 超公里对外单价）**」，每个车型卡片都显示；**付款金额仍是引擎对外价**，预计另收部分服务后按实际公里走现有加收流程。这样「拼总价」满足了（客人看到包含超公里的合计），同时不动下单、付款、结算、退款。业主如要求按预计合计收款，就是 Q1-B，另写 ADR。

**「引擎一行不改」的落实口径（P1）**：超时 / 超公里的对外单价、`routeRates`、预计另收，都在 `apps/api` 的服务层（官网报价服务）里算——输入是报价快照（中标的 `priceRuleId`、`sell` 的汇率 / 缓冲 / 加价比例）+ 询价那一刻读到的价格规则参数，用现有的 `sellEquivalentMinor` 换算；`packages/domain/src/quote.ts`、`pricing.ts` 在 M9 的所有 PR 里**没有 diff**（审查时看 PR 的文件列表核对）。新的纯函数放新文件 `packages/domain/src/route-charter.ts`，只调用现有函数（`overKm`、`sellEquivalentMinor`、时间换算），不复制计价逻辑。

## 二、决定

### 1. 换算规则（`packages/domain/src/route-charter.ts`，纯函数）

| 步骤 | 规则 |
| --- | --- |
| 各段 | 地点列表相邻两点一段；每段用现有 `RouteEstimator`（ADR 0042：缓存键、7 天缓存、每日上限、冷却都不变），分钟按 ADR 0042 四舍五入，米数原样 |
| 合计 | T = Σ 段分钟 + Σ 停留分钟；D = Σ 段米数 |
| 选 H | `pickPackageHours(available, T)`：可选时长升序，取第一个满足 `H × 60 ≥ T` 的；没有 → `ROUTE_TOO_LONG`。余量（H × 60 − T）小于 30 分钟时**不升档**（需求 Q5 推荐 A），卡片上加一句提醒「行程接近套餐时长，超出按每小时 ¥X 另收」 |
| 总公里过远（需求 Q4 推荐 C） | 引擎报价后，某车型组中标规则的含公里 K：`D > 2 × K × 1000` 时这个车型组不给在线价，原因 `ROUTE_TOO_FAR`（转人工）；正好等于 2 倍照常报价 |
| 某车型组在 H 报 `NO_PRICE_RULE` | 只对这些车型组，按更大的下一个可选时长再询价，最多再试 2 个；每个车型组取第一个报得出的 |
| 只交两端给引擎 | `QuoteRequest.pickup` = 第一个点，`dropoff` = 最后一个点；途经点不进 `QuoteRequest`，也不进报价快照的 `request`。所以途经点**结构上**不可能参与区域判断、区域加价、禁行区 |
| 预计超出 | `overKm(D, packageKm)`（现有函数，向上取整到 1 公里）；超出分钟 `max(0, T − H × 60)` 按选 H 的规则恒为 0 |
| 对外单价 | `sellEquivalentMinor(结算单价, 结算币种, 中标 sell)`，整数最小单位（在 `apps/api` 服务层算，见第一节末） |
| 预计另收 | 超出公里数 × 超公里对外单价（整数 × 整数），不进 `sellMinor` |
| 预计合计 | 引擎对外价 + 预计另收（整数相加），只显示，不收款 |
| 时间表 | 出发时刻（城市当地 → 瞬间，`localDateTimeToInstant`）逐段累加分钟，再换回当地钟面；跨午夜按日期差写「次日 / 第 N 天」；按瞬间计算，夏令时城市也对 |

输入校验（`routeCharterIssues`）：地点 2–10 个（途经点 0–8，常量 `ROUTE_CHARTER_LIMITS`）；途经点停留必填、30 的倍数、30–480；首尾两点没有停留；坐标范围；地点名称 1–240 字。原因码 `REQUIRED`、`OUT_OF_RANGE`、`NOT_A_STEP`、`NOT_APPLICABLE`。

**名称长度三处不同，原因各自如下（统一由 `ROUTE_CHARTER_LIMITS` 定义）**：

| 位置 | 上限 | 原因 |
| --- | --- | --- |
| 接口和库里的地点名称（按行程询价请求、`route_itineraries`、`orders.itinerary`、模型线路的地点） | 1–240 字 | 与地址联想候选 `SitePlaceSuggestion.name`（maxLength 240）一致，谷歌给的名称不截断 |
| 链接（预订条件 `d=`）里的地点名称 | ≤ 30 字，编码时超出截断并加「…」 | 链接长度预算（见第三节第 1 小节）；名称只用于预填显示，坐标才是准的，客人在 `/book` 上可以重选 |
| 模型线路自己的名称（线路标题，不是地点名） | 每种语言 ≤ 60 字 | 显示在卡片标题上 |

### 2. 被否的方案

| 方案 | 为什么不选 |
| --- | --- |
| 改引擎：包车按 T、D 计价（`usage` 交给 `basePrice`） | 违背「引擎不改」；会改变调价规则作用的基数和中标排序，要重新做 888 个兼容样例的对比和业主确认 |
| 预计超公里算进付款金额（需求 Q1-B） | 订单金额 ≠ 报价快照，下单、Stripe 金额、结算（ADR 0040）、取消按比例退款（ADR 0029）、改期差价、救援差价（ADR 0031）全部要改；服务后再按实际收时还要扣掉已预收的部分 |
| 让客人自己选套餐时长、再提示超时 | 客人不知道行程要多久；业主要「系统算总时长」 |
| 选最大套餐兜底 + 预计超时 | 原话「超范围转人工」 |
| 途经点也交给引擎做区域判断 | 原话「途经点只算距离和时间，不加钱、不触发区域加价」；引擎也没有途经点这个入参 |

### 3. 后果

- 中标仍按套餐价比（引擎现有规则）。偶尔会出现：A 套餐价低 2%、超公里单价高，中标的是 A；客人卡片上能看到单价和预计另收。要「按预计合计比价」就得改引擎（需求 Q13）。
- 超公里的预计用谷歌不含路况的路线，实际可能更多或更少；页面写「预计」「服务后按实际收取」。
- 一次「按行程」询价最多调 9 段路线（缓存命中不花钱）+ 最多 3 次引擎询价（全在进程内）。限速只计一次（和官网询价共用每地址每分钟 30 次）。

## 三、数据结构与迁移（只加列、只加表，现有订单不动）

### 1. 预订条件（BookingDraft v1，入口 → `/book`，只在浏览器和链接里，不进库）

```json
{
  "v": 1,
  "tab": "charter",
  "charter_mode": "route",
  "package_hours": null,
  "service_local": "2026-12-01T09:00",
  "stops": [
    { "name": "銀座", "lat": 35.6717, "lng": 139.765, "stay_minutes": null },
    { "name": "途経点 1", "lat": 35.6, "lng": 139.7, "stay_minutes": 60 },
    { "name": "新宿", "lat": 35.6909, "lng": 139.7003, "stay_minutes": null }
  ],
  "passengers": 2,
  "luggage": 2,
  "route_template": null,
  "ref": null,
  "lang": "ja"
}
```

- 链接：`/book?d=<base64url(JSON)>`，`d` 的值 **≤ 7,000 字符**，整个网址的路径加查询串 ≤ 7,200 字符；`domain` 的 `parseBookingDraft` / `encodeBookingDraft`，逐项校验（不合格的那一项为 null，整份解不开为 null），前端和组件共用同一份（组件构建时打包进去）。
- **为什么是这个上限——整个请求要放进 nginx 的默认缓冲，不调 nginx**：测试服务器前面的 nginx 是业主机器上原有服务的（正式服务器如果也放在别的服务的 nginx 后面，同样处理），nozomi 的 server 段由业主自己加在共用配置里（`docs/deploy.md` 第 2 节）。nginx 默认 `large_client_header_buffers 4 8k`：整个请求行（`GET ` + 网址 + ` HTTP/1.1` + 换行）必须装进一个 8 KB（8,192 字节）缓冲；这个指令写在 server 级可能不生效（请求行在选虚拟主机之前就读完了），改 http 级又超出「只新增 nozomi 配置」的边界。所以不改 nginx，而是把链接控制在默认缓冲以内并留足余量。网址 ≤ 7,200 时请求行 ≤ 4 + 7,200 + 11 = 7,215 字节，离 8,192 还有 977 字节。
- **最坏情况的计算**（链接里地点名称 ≤ **30** 字、来源凭证里的 `return_url` ≤ **1,000** 字符）：
  - 每个地点：名称 30 个 4 字节字符 = 120 字节（4 字节字符比要转义的 `"`（2 字节）更长，是最坏情况；控制字符编码前已清掉）+ 其余键和值（`{"name":"",` `"lat":-89.123456,` `"lng":-179.123456,` `"stay_minutes":480},`）约 66 字节 = 186 字节；10 个地点 1,860 字节。
  - 其余字段（`v`、`tab`、`charter_mode`、`package_hours`、`service_local`、`passengers`、`luggage`、40 字符的 `route_template`、`lang` 和键名）约 230 字节。
  - 来源凭证：载荷 `{k: 36 位编号, o: ≤ 270 字符（https:// + 253 字符主机名 + :65535）, r: ≤ 1,000 字符（URL 解析后的 href，都是 ASCII）, e: 10 位}` 加键名约 1,346 字节，base64url 后 1,795 字符，加「.」和 43 字符签名 = 1,839 字符，JSON 里连引号约 1,850 字节。
  - JSON 合计约 1,860 + 230 + 1,850 = 3,940 字节，base64url 后 ⌈3,940 ÷ 3⌉ × 4 = 5,256 字符；网址 `/book?d=` + 5,256 = 5,264 字符；请求行约 5,279 字节。比 7,000 / 7,200 的上限还有约 1,700 字符余量，比 8,192 有约 2,900 字节余量。
- 从演示站整页跳过来时，浏览器发的 `Referer` 是对方页面的地址（不是这条长链接）；主站页面是 `Referrer-Policy: no-referrer`（ADR 0046），之后的请求也不带这条长链接，所以请求头里不会出现第二份。
- **组件跳转前检查长度**：编码后 `d` 超过 7,000 或网址超过 7,200 时，先把地点名称截到 20 字再编一次；仍超过就不跳转，提示「途经点太多或名称太长，请减少途经点」（按上面的上限算不会走到这一步，是兜底）。
- **往返测试**（`booking-draft.test.ts`）：10 个地点、名称都取 30 个 4 字节字符、停留取 480、`route_template` 取 40 字符、`return_url` 取 1,000 字符、来源取最长 → `d` ≤ 7,000、网址 ≤ 7,200，解码后与编码前逐项相等（名称是截断后的）。
- **证据从哪里来**：`deploy/ci/smoke.sh` 只测到 Caddy 容器，前面没有测试服务器上那台 nginx，**不能作为这一项的证据**；smoke 里只核对「7,200 字符网址的 `/book` 在 Caddy 上是 200」。经过外层 nginx 的证据是测试站验收（需求 03 F10：在浏览器里打开最坏情况的链接，不需要登录服务器）。
- 万一以后确实要调 nginx 的缓冲：由**业主按 `docs/deploy.md` 第 2 节自己改**，记进业主待办，不写成部署步骤。
- 坐标最多 6 位小数；名称清理控制字符（同现有链接参数的 `cleanName`），长度见第二节第 1 小节的表。
- **没有价格、没有报价编号**。
- 旧参数（`from`、`to`、`date`、`time`、`pax`、`bags`、`mode`）照旧；同时给了 `d` 和旧参数时以 `d` 为准。

### 2. 询价时保存的行程（新表，迁移 `03xx_route_itineraries.sql`）

`route_itineraries`（交易层，和 `quotes` 同样的数据库角色和权限；没有 `tenant_id`：行程属于这次询价，不属于哪个供应商）：

| 列 | 说明 |
| --- | --- |
| `id` uuid | |
| `created_at`、`expires_at` | 询价时刻；+ 24 小时。到期后整行删除（下单的单已把行程抄进 `orders.itinerary`，不再需要这一行），坐标不长留 |
| `city_id`、`service_local`、`timezone` | |
| `mode` | `transfer` / `charter_package` / `charter_route` |
| `stops` jsonb | `[{ seq, role: pickup/via/dropoff, name, lat, lng, stay_minutes }]` |
| `legs` jsonb | `[{ from_seq, to_seq, meters, minutes, source }]` |
| `drive_minutes`、`stay_minutes`、`total_minutes`、`total_meters` | 整数 |
| `source` jsonb | `{ entry, route_template_id, embed_key_id, embed_origin }`（询价时已知的部分；下单时再核对凭证） |

`quotes` 加一列 `itinerary_id uuid null references route_itineraries(id) on delete set null`：行程按上面的规则删除时，报价上的引用自动置空，报价本身保留（报价是交易记录，现在没有清理）。

另建 `quote_route_rates`（`quote_id` 主键、外键到 `quotes(id) on delete cascade`；`package_hours`、`package_km`、`overtime_per_hour_minor`、`over_km_per_km_minor`（结算、商品币种）、`settlement_currency`、`overtime_per_hour_sell_minor`、`over_km_per_km_sell_minor`、`over_km_estimate`（按行程才有，否则 null）、`over_km_estimate_sell_minor`（客人币种，按行程才有））——**询价时锁定**：
- **所有包车报价都写**：按行程询价，和普通 `POST /site/v1/quotes` 的包车（按时长，`post_service_rates` 也从这里读）都写；下单、订单页、`SiteQuote.post_service_rates` 都读这里，**不再读当前的价格规则**（避免 `findQuotePackageKm` 那样读到改过的规则）。
- 保留期：跟报价走（报价不删，它也不删；以后报价有了清理，按外键一起删）。里面只有单价和数量，没有地点和个人信息。

**清理任务**（`RouteItineraryRetentionJobs`，跑在 API 进程里，做法同 ADR 0076 的 `ManualQuoteRetentionJobs`）：启动 20 秒后第一次，之后每小时一轮；每轮最多 10 批、每批 500 行；一批一个事务，开头抢事务级 advisory lock，抢不到就跳过这一轮；`delete … where expires_at < now()`，行用 `for update skip locked`。
- 数据库角色：用平台连接 `nozomi_platform`。迁移给它 `route_itineraries` 的 `select, insert, delete`（不给 `update`：行程写入后不改），`quote_route_rates` 的 `select, insert`；租户角色 `nozomi_app` 对这两张表没有任何权限。
- `on delete set null` 是 PostgreSQL 的外键动作，由 `quotes` 表的所有者执行，不需要给 `nozomi_platform` 加 `quotes` 的 `update` 权限；集成测试用 `nozomi_platform` 跑一轮清理，核对行程被删、报价还在、`itinerary_id` 为 null、订单的 `itinerary` 不变。

### 3. 订单上（迁移同一个文件，`orders` 只加可空列）

| 列 | 说明 |
| --- | --- |
| `orders.itinerary` jsonb null | 订单行程 v1：`{ version, mode, stops[{…, planned_arrival_local, planned_departure_local}], legs, totals, package{hours, km}, estimate{over_km, overtime_minutes} }`——**没有金额** |
| `orders.entry_source` text null | `book` / `route_template` / `embed`（check 约束）；M9 之前的单、渠道单为 null |
| `orders.route_template_id` uuid null | 外键到模型线路；线路删除（只会下线，不删）不影响 |
| `orders.embed_key_id` uuid null、`orders.embed_origin` text null | 核对通过的来源凭证才写 |
| （说明） | `entry_source`、`route_template_id`、`embed_key_id`、`embed_origin` **只给官网订单应答和运营后台**：`/tenant/v1` 订单详情、列表和给供应商的 Webhook 都不给（供应商不需要知道客人从哪个网站来；集成测试扫键核对） |
| 平台侧 `order_sales.route_estimate` jsonb null | 对外单价和预计另收（客人币种），只给官网订单应答和运营后台 |
| 结算价明细（`price_snapshot`）加 `routeRates` | 超时、超公里的结算单价（供应商可见，规则 4 允许） |

- 订单行程由服务端从 `route_itineraries` + 时间表计算后写入，**客人提交的内容不直接进订单**。
- 改期（ADR 0029）：`stops` 不变，计划时间整体平移；`package` 不变（同一商品、同一 H 重新报价）。
- 隐私：订单行程里的地点和现有上下车地址同一口径（ADR 0055 待法务确认第 1 条：地址暂不脱敏）；以后把地址加进 180 天脱敏时，`orders.itinerary` 的 `name`、`lat`、`lng` 一并处理。
- 写入：只在 `POST /site/v1/orders` 新建订单的同一事务里写；幂等键重复的请求不再写（ADR 0026）。

### 4. 模型线路（新表 `charter_route_templates`，平台表）

`id`、`code`（唯一，`^[a-z0-9][a-z0-9-]{2,39}$`，建后不改）、`city_id`、`name` jsonb（zh 必填，ja、en 选填）、`description` jsonb、`stops` jsonb（同预订条件的 `stops`，校验用同一个 `routeCharterIssues`）、`suggested_start` text null（HH:mm）、`sort`、`status`（`draft` / `published` / `archived`）、`version`、`created_by`、`updated_by`、时间。只授权给 `nozomi_platform`；租户角色没有任何权限。迁移不写任何行。

### 5. 嵌入码（新表 `embed_keys`，平台表）

`id`、`public_key`（`nze_` + 24 位 base62，唯一，随机生成）、`name`、`allowed_origins` text[]（1–20 个，规范化后的 origin）、`default_lang`、`default_services` text[]、`status`（`enabled` / `disabled`）、`note`、`version`、`created_by`、`updated_by`、时间。只授权给 `nozomi_platform`。迁移不写任何行。

## 四、接口变化（只加，不改已有字段；`/sales/v1` 不变）

### 官网 `/site/v1`

| 接口 | 变化 |
| --- | --- |
| `POST /site/v1/quotes/charter-route`（新） | 入参：`city_id`、`service_local`、`stops`（2–10 个，途经点带 `stay_minutes`）、`passengers`、`luggage`、`addons`、`route_template`（可空）。应答：`currency`、`itinerary`（时间表、各段、合计、选中的 H）、`quotes[]`（`SiteQuote` + `post_service_rates` + `route_estimate`）、`unavailable[]`（原因多 `ROUTE_TOO_LONG`）。限速与官网询价共用 |
| `SiteQuote` | 加 `post_service_rates`：`{ overtime_per_hour: SalesMoney, over_km_per_km: SalesMoney }` 或 null（包车才有；普通 `POST /site/v1/quotes` 的包车也给，便于「按时长」也显示单价）；加 `route_estimate`：`{ over_km, amount: SalesMoney }` 或 null（只有按行程） |
| `SiteUnavailable.reasons` | 加 `ROUTE_TOO_LONG`（总时长超过最大套餐）、`ROUTE_TOO_FAR`（总公里超过中标规则含公里的 2 倍，需求 Q4） |
| `SiteOrderRequest` | 加可选 `source: { entry, route_template, ref }`（`entry` 是 `book` / `route_template` / `embed`，后两项是字符串或 null）；不给按 `book` |
| `SiteOrder`（订单应答） | 加 `itinerary`（订单行程 v1 或 null）、`entry_source`、`route_estimate`（对外，或 null）、`return_url`（来源凭证里的 `redirectUrl`，或 null） |
| `GET /site/v1/route-templates?city_id=`（新） | 已上线的模型线路（编码、名称、简介、地点和停留、建议出发时间），不含任何价格 |
| `GET /site/v1/route-templates/{code}`（新） | 一条；下线或不存在 404 `ROUTE_TEMPLATE_NOT_FOUND` |
| `POST /site/v1/manual-quote-requests` | 行程里加可选 `vias`（名称、坐标、停留），进已加密的 `contact_enc`（ADR 0076 的加密口径），明文只加 `via_count`（整数） |

### 运营后台 `/platform/v1`

- `GET/POST /platform/v1/route-templates`、`GET/PATCH /platform/v1/route-templates/{id}`（`If-Match`）：`route_template.read`（运营、客服、只读、超级管理员）、`route_template.manage`（运营、超级管理员）。
- `GET/POST /platform/v1/embed-keys`、`GET/PATCH /platform/v1/embed-keys/{id}`（`If-Match`）、`GET /platform/v1/embed-keys/{id}/snippet`（生成好的代码文本）：`embed.read`（运营、渠道经理、只读、超级管理员）、`embed.manage`（运营、渠道经理、超级管理员）。
- 订单详情、列表：加 `itinerary`、`entry_source`、`embed_origin`、`route_estimate`（对外和结算都给）；列表按来源筛选。

### 供应商 `/tenant/v1` 和给供应商的 Webhook

- 订单详情、`order.confirmed` / `order.changed` 载荷加 `itinerary`（地点、停留、计划时间、各段、合计、套餐）——**没有任何对外金额**；结算单价沿用结算价明细。租户编号只来自令牌，跨租户 404。
- **不给**来源相关的字段：`entry_source`、`route_template_id`、`embed_key_id`、`embed_origin`、`return_url` 都不出现在 `/tenant/v1` 和供应商 Webhook 里（集成测试扫键）。
- 司机页：地点列表逐个「导航到这里」，停留时长和计划时间。

### 嵌入 `/embed/v1`（新前缀，**跨域只开在这里**）

| 接口 | 说明 |
| --- | --- |
| `GET /embed/v1/config?key=&return_url=` | 浏览器 `Origin` 与这个嵌入码白名单里的某一项**完全相等**：200 + `Access-Control-Allow-Origin: <这个 origin>`、`Vary: Origin`，应答 `{ lang, services, site_origin, ref, ref_expires_at }`；`return_url` 按第五节第 2 小节校验，不合格时忽略（不进 `ref`，不报错）。不在白名单、**`Origin: null`、没有 `Origin` 请求头**、嵌入码不存在或停用：一律 403 `EMBED_ORIGIN_NOT_ALLOWED`，**不带** `Access-Control-Allow-Origin`（浏览器读不到）。`Cache-Control: private, max-age=60` |
| `GET /embed/v1/places/autocomplete`、`GET /embed/v1/places/details` | 和 `/site/v1/places/*` 同一个实现、同一份每日上限；先按 `key` + `Origin` 核对白名单（规则同上，`null` / 缺失也 403），再按现有每地址限速 + 每个嵌入码每分钟 600 次 |

- 不开 `Access-Control-Allow-Credentials`；组件所有请求 `credentials: "omit"`；只有 GET、不带自定义请求头（简单请求，没有预检）。`/site/v1`、`/platform/v1`、`/tenant/v1` 永远不带任何 CORS 头（集成测试核对）。
- 报价、下单不开跨域：组件不询价、不下单。

### 组件脚本放在哪、路由怎么同步

- **脚本是前端的构建产物，不归 API**：`apps/web` 加一个独立构建入口，产出 `dist/embed/widget-v1.js`（文件名带大版本，不带内容哈希，合作网站的代码不用改），网址 `https://<主站>/embed/widget-v1.js`，由 Caddy 和其他静态文件一样直接给。不放在 `/embed/v1/` 下：那个前缀整个归 API，混放就要在反向代理里写「这个前缀下一个文件例外」的规则，容易错。
- 同步改的地方：
  - `apps/web/src/lib/api-prefixes.ts`：`API_PATH_PREFIXES` 加 `/embed/v1`（Vite 开发和端到端的代理、`edge-config.ts` 生成的 Caddy 转发规则都从这张表来，自动跟上）；`portal.test.ts` 的「前端路由不落在 API 前缀下」照常检查。
  - `apps/web/build/edge-config.ts`：给 `/embed/widget-v1.js` 单开一条响应头：`Content-Type: text/javascript; charset=utf-8`、`Cache-Control: public, max-age=300`、`Cross-Origin-Resource-Policy: cross-origin`、`X-Content-Type-Options: nosniff`；不加 HTML 页面的内容安全策略（它不是页面）；文件不存在时 404，**不能**落到单页应用的 `index.html` 兜底。`deploy-web.test.ts` 核对生成的片段。
  - `apps/web/vite.config.ts`：多一个构建入口；开发服务器同样能给 `/embed/widget-v1.js`。
  - `deploy/ci/smoke.sh`：真实容器上核对 ① `/embed/widget-v1.js` 200、`Content-Type` 是 JavaScript、带 `Cross-Origin-Resource-Policy: cross-origin`；② `/embed/v1/config?key=nze_不存在` 带一个随便的 `Origin` 是 403 且没有 `Access-Control-Allow-Origin`；③ `/site/v1/config` 带 `Origin` 没有任何 CORS 头；④ 7,200 字符网址的 `/book` 在 Caddy 上是 200（只测到 Caddy，不能证明外层 nginx，见第三节第 1 小节）。

## 五、安全

### 1. 白名单的边界

- 浏览器发跨域请求时自动带 `Origin`，网页脚本改不了；主站只对白名单里的 origin 回 `Access-Control-Allow-Origin`，所以**在浏览器里**，未授权网站上的组件读不到配置、读不到地址提示，显示「此网站未获授权使用预订组件」。
- `Origin`、`Referer` 对非浏览器程序都可以伪造：伪造者能拿到的只是公开的标签、语言配置和地址提示（和直接用主站一样，受同样的限速和每日上限）。所以白名单**不是**访问控制，防的是「别人把组件放到未授权网站上」。
- 比较方式：把请求的 `Origin` 按同一个函数规范化（小写、punycode、去掉默认端口）后，和白名单逐项**完全相等**才算；不按后缀、不按主机名、不按包含。`Origin: null`（沙箱 iframe、`file:`、部分跳转）和没有 `Origin` 都不放行。
- 同样因为可伪造：**订单来源 `embed` 只用于统计**，不作为分佣、结算或任何金额的依据。以后要给合作网站分佣（需求 Q11-B），先重新设计来源的证明方式（例如合作方服务端签名），另写 ADR。
- 下单安全不靠白名单：仍是 `/book` 和 `/site/v1` 现有的校验（报价有效期、库存、下单校验、限速、Stripe）。
- 嵌入码是公开标识，不是密钥：可以出现在网页源码、日志里，不进 `packages/config`，不需要业主在设置页面填。

### 2. 来源凭证（`ref`）

- 内容：`{ k: 嵌入码编号, o: origin, r: return_url 或 null, e: 过期时刻（签发后 2 小时） }`，base64url + HMAC-SHA256 签名。
- 签名密钥：从现有的 `DATA_ENCRYPTION_KEY` 按 ADR 0057 的派生方式派生新用途 `embed-ref`（不新增密钥，业主不用做事）；没配主密钥时不签发凭证，来源一律记 `book`。
- 核对签名用**常数时间比较**（`crypto.timingSafeEqual`，先比长度）。
- 下单时核对：签名对、没过期、嵌入码仍启用、`o` 仍在**当前**白名单里 → 记 `embed`；否则记 `book`，**不拒单、不报错**，只在日志记原因码（不记凭证原文）。
- **凭证过期不静默变 `book`**：组件在客人点「查询价格」时**重新取一次配置**拿新凭证再跳转（不用页面打开时拿的那张）；跳到 `/book` 后 2 小时内下单都能记上来源。

**`redirectUrl` / `return_url` 的校验（写死在 `packages/domain` 的 `embedReturnUrl`，签发和下单两处都调它）**：

1. 长度 ≤ 1,000 字符（按 URL 解析后的 href 计；上限来自链接长度预算，见第三节第 1 小节）；用 WHATWG URL 解析，解析失败就拒。
2. 协议只能是 `https:`（测试环境另允许 `http:`，且只限 `localhost`、`127.0.0.1`，同白名单规则）；`javascript:`、`data:`、`blob:`、`file:` 等一律拒。
3. 不能带用户名、密码（`https://user:pass@…`）。
4. 解析后的 origin（协议 + 主机 + 端口，规范化同白名单）必须**完全等于**白名单里的某一项，**并且等于这张凭证的 `o`**（客人从哪个网站来，只能回哪个网站）；不按后缀、不按主机名比较。
5. 下单时再核一次：`r` 的 origin 仍在**当前**白名单里，才把它存进订单、在订单页显示「返回原网站」；不在就当作没有（来源可能仍记 `embed`，只是没有返回链接）。
6. 订单页的链接 `rel="noopener noreferrer"`，地址原样来自通过校验的值。

测试用例至少有：`javascript:alert(1)`、`data:text/html,…`、`https://user:pass@embed-demo.moveglobal.io/`、`https://embed-demo.moveglobal.io.evil.example/`、`https://evil.example/?u=https://embed-demo.moveglobal.io`、`https://embed-demo.moveglobal.io:8443/`（白名单没写端口时拒、写了 `:8443` 时过）、`http://embed-demo.moveglobal.io/`、正好 1,000 字符（过）和 1,001 字符（拒）、白名单里有但不等于凭证 `o` 的另一个域名、签发后从白名单移除再下单。

### 3. 为什么不用 iframe、CSP 怎么办

- 组件是脚本 + Shadow DOM，直接在合作网站页面里渲染，不嵌我们的页面：主站的 `frame-ancestors 'none'`、`X-Frame-Options: DENY`（ADR 0046）**不变**，主站页面仍不许被任何人嵌入。
- 组件跑在合作网站的页面里，受**对方**的内容安全策略约束：对方要在 `script-src`、`connect-src` 里放行主站域名。后台生成代码的页面写明这一点；演示站由业主在 MoveGlobal 工厂后台确认。
- 样式用 `adoptedStyleSheets`（不用内联 `<style>`、不用 `style` 属性），对方禁了内联样式也能显示；不支持的浏览器退回 Shadow DOM 里的 `<style>`。
- 演示站 `embed-demo.moveglobal.io` 和测试环境 `nozomi.moveglobal.io` 同属 `moveglobal.io`（同站不同源）：主站的 Cookie（如验收会话 `nozomi_qa`，`Path=/site/v1`）在组件的请求里也不会带，因为组件只请求 `/embed/v1` 且 `credentials: "omit"`。

### 4. 跨域方式的取舍

| 方式 | 好处 | 坏处 | 结论 |
| --- | --- | --- | --- |
| A. 组件完全不调接口，只收集条件后跳 `/book` | 没有任何跨域面 | 白名单无处执行（「非白名单被拒」做不到）；地址只能手打，到 `/book` 还要重选 | 否 |
| **B. 只开 `/embed/v1` 的配置和地址提示，白名单 origin 才放行；报价、下单不跨域** | 白名单能在浏览器里执行；地址有坐标，`/book` 打开即报价；跨域面小、都是只读 | 地址提示的谷歌费用多一个来源（共用每日上限，封顶不变） | **选这个** |
| C. 报价也跨域，组件里直接显示价格 | 客人在合作网站就看到价 | 价格、报价编号在第三方页面里，跨域面大；组件要跟着报价接口一起改 | 否（原话「提交跳主站 /book」） |

## 六、测试计划

| 层 | 内容 |
| --- | --- |
| domain 单元 | `route-charter.test.ts`：选 H（等于、差 1 分钟、超出最大、可选列表为空）、合计、预计超出公里（含 0.2 公里进 1）、时间表跨午夜 / 跨两天 / 夏令时城市、输入校验每个原因码、总公里正好 2 倍和多 1 米；`booking-draft.test.ts`：编码解码往返（含「10 个地点、名称取 30 个 4 字节字符、`return_url` 1,000 字符」编码后 `d` ≤ 7,000、网址 ≤ 7,200）、逐项校验、超长、未知版本、注入字符；`embed-origin.test.ts`：origin 规范化、大小写、punycode、带路径、带通配符、http 与 https、`.evil` 后缀、带端口、`null`；`embed-return-url.test.ts`：第五节第 2 小节列的全部用例；`embed-ref.test.ts`：签名、过期（正好 2 小时那一刻）、改一位、换嵌入码、长度不同的签名 |
| 引擎不变 | `quote-compat` 888 个样例逐分一致；M9 的每个 PR 的文件列表里没有 `packages/domain/src/quote.ts`、`packages/domain/src/pricing.ts`（审查核对） |
| 集成（真实 PostgreSQL，谷歌用本机替身） | 按行程询价 = 同条件 `POST /site/v1/quotes`（包车 H）逐分一致；途经点进加价区域、禁行区价格不变；车型组退到更大套餐；转人工各原因；下单写订单行程、来源；幂等并发只写一次；`/tenant/v1` 和 Webhook 扫键无对外金额（规则 4）；租户 A 读不到租户 B 的订单行程；模型线路、嵌入码的权限矩阵（各平台角色、租户令牌 401）、`If-Match` 409、审计；`/embed/v1` 的 CORS 头只对白名单 origin（`Origin: null`、缺 `Origin` 都 403）、`/site/v1` 永不带 CORS；凭证核对各失败情况都记 `book`；`/tenant/v1` 和供应商 Webhook 没有来源字段；普通包车报价也写 `quote_route_rates`，改价格规则后订单页单价不变；行程清理（`nozomi_platform` 跑、报价保留、`itinerary_id` 置空） |
| 前端组件 | `/book` 按行程：加删途经点、停留下拉、时间表、卡片明细、转人工；模型线路预填；`d=` 预填；运营后台两个页面；订单页、供应商详情、司机页的地点列表 |
| 端到端（Playwright） | 两个本机 origin（一个在白名单、一个不在）各起一个宿主页：白名单的显示表单、跳 `/book` 并报价，非白名单显示未授权；宿主页把元素全改红后组件不变；组件 320 px 不横向滚动、axe；`/book` 按行程从询价到付款（假 Stripe，ADR 0046 的做法） |
| 测试环境验收 | 见 M9-05 |

所有测试数据在测试里构造、结束清理；不写任何预置的嵌入码、模型线路、商品、价格。

## 七、分 PR（顺序：订单格式 → 线路包车 → 嵌入组件；每个 PR：独立审查 → 合并 → 部署 → 测试站验收）

| 任务 | 角色 | 内容 | 依赖 | 这一步的验收 |
| --- | --- | --- | --- | --- |
| M9-01 | 产品 | 本篇、需求 03、roadmap | — | 独立审查通过；业主答复待确认项（未答复按推荐） |
| M9-02 | 后端 + 前端（同一个 PR，后端先做接口和迁移，前端接着做 `/book?d=`） | 统一订单格式：`booking-draft`、订单加列、所有新官网订单写订单行程和来源（`book` / `route_template` 先占位）、订单应答加字段、`/book?d=`、`/book` 带 `d` 时转新页面（M8-05 之前）、链接长度上限和往返测试、smoke 第 ④ 条（只测 Caddy） | M9-01 | 需求 03 第 2.3 节 F1–F10 |
| M9-03 | 后端 | 按行程询价接口、换算、行程表、`quote_route_rates`（含普通包车报价）、`SiteQuote` 加字段、订单行程（`charter_route`）、行程清理任务、人工报价带途经点、供应商 / 司机 / 邮件显示的接口部分 | M9-02 | 需求 03 第四部分 R1–R17、R21–R23 的接口部分 |
| M9-03b | 前端 | `/book` 包车「按行程」：途经点、停留、时间表、卡片明细（含预计合计）、转人工；订单页、供应商详情、司机页地点列表 | M9-03 | R1–R17、R21–R23 的页面部分；亮暗、320 / 360、axe |
| M9-03c | 后端 + 前端（同一个 PR，后端先做表和接口，前端接着做两个页面） | 模型线路：运营后台页面和接口、官网列表和 `/book?route=` 预填 | M9-03b | R18–R20 |
| M9-04 | 后端 + 前端（同一个 PR，后端先做，前端接着做运营后台页面） | 嵌入码与白名单：表、运营后台页面、生成代码、`/embed/v1/config` 和地址提示的 CORS、来源凭证、`return_url` 校验、下单记来源；`api-prefixes.ts`、`edge-config.ts`、`smoke.sh` 第 ①～③ 条 | M9-02 | 需求 03 第 3.6 节 E2–E4、E8–E10、E12–E14 的接口部分 |
| M9-04b | 前端 | `widget-v1.js`：独立构建入口、init、两个标签、Shadow DOM、点「查询价格」时重取配置、跳 `/book`、跳转前查长度、语言、未授权提示、大小预算 | M9-04、M9-03b | E1、E5–E7、E11 |
| M9-05 | 验收 | 测试环境 + 演示站全链路 | 全部；业主在工厂后台放代码 | 需求 03 的「验收」原话三条 |

单个 PR 如果仍超过 3 天工作量，按后端 / 前端再拆，顺序不变。同时最多 2 个开发角色，不自批（ADR 0073 的做法）。
