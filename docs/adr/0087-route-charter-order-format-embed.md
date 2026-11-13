# ADR 0087：线路式包车、统一订单格式、嵌入预订组件

- 状态：草稿（2026-11-13，M9-01），待独立审查；业主答复「待业主确认」（需求文档 03 末尾）后定稿。
- 依据：需求《线路式包车、统一订单格式、嵌入预订组件》（`docs/requirements/03-route-charter-order-embed.md`，业主 2026-11-13 原话逐字在其中）。业主口径纠正（监工 2026-11-13 转达）：「算出全程需要多少时间、多少公里数，给出最终报价」——客人按最终报价付款。
- 补充（都不推翻）：ADR 0020（报价引擎）、0023（渠道加价与取整）、0026（下单与付款）、0029（取消、改期重算、服务后加收）、0031（救援改派）、0032 / 0035（官网接口）、0040（账单）、0042（路线预估）、0046（官网内容安全策略）、0069 / 0079（新预订页）、0070（包车一口价全含）、0073（包车区域加价）、0076（人工报价留资）、0078（测试环境验收通道）、0080（报价优先级）。
- 编号：写这篇时 main 上最大是 ADR 0086，这里用 0087。

## 一、可行性结论：报价接口能不能直接收「总时长、总公里」

**不能。** 读代码的结论：

| 问题 | 代码里的事实 | 结论 |
| --- | --- | --- |
| 报价接口收不收总时长 / 总公里 | `POST /site/v1/quotes`（`SiteQuoteRequest`）、`POST /sales/v1/quotes`（`SalesQuoteRequest`）包车只有 `package_hours`（整数 1–72），没有分钟数、米数字段（`additionalProperties: false`）。引擎入参 `QuoteRequest` 也只有 `packageHours`（`quote.ts` 第 89–90 行） | 接口和引擎都不收 |
| `package_hours` 能不能随便填 | `selectPriceRule` 要求 `rule.packageHours === query.packageHours`（`pricing.ts` 第 477 行）：只能命中供应商配置过的套餐时长；有 5、10 小时的规则时问 8 小时得到 null（`pricing.test.ts` 第 250 行），这个车型组报 `NO_PRICE_RULE`。城市能选的时长由 `GET /site/v1/cities/{id}/charter-packages` 给出 | 必须等于某个已配置的套餐时长 |
| 含公里、超时价、超公里价在报价时算不算 | 计价函数 `basePrice` 有完整的包车公式（`pricing.ts` 第 513–515 行），但引擎报包车时**故意不给用量**：`quote.ts` 第 700 行 `product.category === "charter" ? {} : …`（注释「超时、超公里履约后按实际结算」），所以引擎报价里超时、超公里恒为 0 | 引擎只报**套餐部分**（套餐价 + 上 / 下车加价 + 调价 + 加急、夜间、附加服务） |
| 让引擎直接算要改什么 | 把包车的 `usage` 换成 `{ meters, minutes }`，再给 `QuoteRequest` 加两个字段 | 引擎改动，而且超时超公里会进调价基数，**不做** |
| 超时、超公里的单价能不能拿到 | 应答里没有（`SiteQuote.package` 只有 `{ hours, km }`）；但服务层在内存里有每个候选的 `offer.priceRuleId`，规则参数里有 `packageKm`、`overtimePerHourMinor`、`overKmPerKmMinor` | 服务层能拿到，不用改引擎 |

**所以**：`apps/api` 的官网报价服务把行程换算成引擎现有的输入，引擎对每个候选套餐时长原样报出套餐部分；服务层再按每个候选自己的包车规则加上**超时费、超公里费**，得到**最终报价**，按最终报价比价、下单、付款。只有当天客人自己延长停留、改线路，超出锁定的预计时长 / 公里的部分，才服务后补收。

**「引擎一行不改」的落实口径（P1）**：超时费、超公里费、最终价、按最终价排序都在 `apps/api` 服务层做；用到的 domain 函数都是**现有导出、原样调用**：`basePrice`（`pricing.ts` 第 497–516 行）、`sellEquivalentMinor`（`quote.ts` 第 1076–1084 行）、`rankCandidates`（`quote.ts` 第 1136–1153 行）、`roundFractionToUnit`。`packages/domain/src/quote.ts`、`pricing.ts` 在 M9 的所有 PR 里**没有 diff**（审查看 PR 的文件列表）。新的纯函数放新文件 `packages/domain/src/route-charter.ts`，只组合现有函数，不复制计价公式。

## 二、最终报价怎么算（线路式包车）

### 1. 步骤

| 步骤 | 规则 |
| --- | --- |
| 各段 | 地点列表相邻两点一段；每段用现有 `RouteEstimator`（ADR 0042：缓存、7 天、每日上限、冷却都不变），分钟按 ADR 0042 四舍五入，米数原样 |
| 合计 | T = Σ 段分钟 + Σ 停留分钟；D = Σ 段米数 |
| 试哪些套餐时长 | `candidatePackageHours(rules, T, D)`：商品、规则、汇率、评分**只取一次**；用取出的、启用中的 `charter_package` 规则**先预筛**套餐时长 H——要同时满足 ① `T − H × 60 ≤ 120`（超时不超过 2 小时，需求 Q2）② 至少有一条这个 H 的规则 `D ≤ 2 × 含公里 × 1000`（需求 Q4，先排除注定被 2 倍规则过滤的 H，不浪费轮数）——再从小到大取 **4 个**。预筛后一个都没有：没有满足 ① 的 → `ROUTE_TOO_LONG`；有满足 ① 但都不满足 ② 的 → `ROUTE_TOO_FAR`；城市没有包车套餐 → `NO_PRODUCT`；都转人工 |
| 每个套餐时长报一次 | 对每个 H 调现有的 `quoteCandidates`（`services/quotes.ts` 第 348 行）一次，得到每个商品对每个车型组的套餐部分报价。4 轮之后仍有车型组一个候选都没有（例如那几个 H 的规则在这个车型组都报不出），而预筛后还有更大的 H：只为这些车型组按从小到大再补试，**最多再 2 轮，总轮数上限 6** |
| 每个商品单独算对外价 | 对每个商品的报价**单独**调一次现有的 `compareQuotes`（只传这一个商品的 `ComparisonEntry`），得到它每个车型组的 `sell` 和以它为中标的快照。原因：`compareQuotes` 内部用 `rankCandidates` 按**套餐价**每个租户只留一个商品（`quote.ts` 第 1140–1142 行），把所有商品一起传会在算超时超公里之前就丢掉同一供应商的其他商品。单独调用只多了对外价换算和排序这类整数运算（引擎计价 `quoteCandidates` 每个 H 仍只跑一次），城市 100 个商品 × 6 个 H 也只是 600 次轻量调用，计入第 5 小节的 P95 实测 |
| 只交两端给引擎 | `QuoteRequest.pickup` = 第一个点，`dropoff` = 最后一个点；途经点不进 `QuoteRequest`、不进快照的 `request`，结构上不可能参与区域判断、区域加价、禁行区 |
| 每个候选的超时、超公里（结算价，精确值） | 用这个候选自己命中的 `charter_package` 规则：超时 = `basePrice(p, { minutes: T }, H) − basePrice(p, {}, H)`，超公里 = `basePrice(p, { meters: D }, H) − basePrice(p, {}, H)`——**直接调用引擎的包车公式**：`超时 = 每小时单价 × max(0, T − H × 60) ÷ 60`、`超公里 = 每公里单价 × max(0, D − 含公里 × 1000) ÷ 1000`（`pricing.ts` 第 513–514 行，`times` 是精确分数乘除，第 139–141 行），按分钟、按米**成比例、不向上取整**（第 494 行注释「超出 500 米就收 0.5 公里的钱」） |
| 结算价取整 | 两项精确值相加后，按商品的取整单位四舍五入**一次**（`roundFractionToUnit`，同引擎第 763 行结算总价的取整），得到超出部分结算价 X；明细里超时项单独四舍五入，超公里项 = X − 超时项（尾差计入超公里项，各项之和恒等于 X）。**最终结算价 = 引擎结算总价 + X** |
| 对外价 | 超出部分对外价 Y = `sellEquivalentMinor(X, 结算币种, 这个候选的 sell)`（这个候选的汇率、缓冲、加价比例，四舍五入一次）；渠道设了对外价取整单位（> 1）时 Y 向上取整到这个单位（同 ADR 0023 只往上取）。**最终对外价 = 引擎对外价 `sellMinor` + Y**。和引擎「对外价由取整后的整数结算价换算」同一口径；每个金额只从它自己的精确值取整一次 |
| 单价的对外参考 | 每小时、每公里的对外单价用 `sellEquivalentMinor` 单独换算，只用于页面说明和事后补收参考（同 ADR 0073 `over_km_per_km` 口径），不参与最终价 |
| 总公里过远（需求 Q4） | 某个候选 `D > 2 × 含公里 × 1000` 时不参加排序；某车型组所有候选都被排除 → `ROUTE_TOO_FAR`（转人工）；正好 2 倍照常 |
| 上限 | 最终结算价再过一遍现有的 `exceedsSettlementLimit`（`pricing.ts` 第 160 行），最终对外价不超过 `QUOTE_RULES.maxSellMinor`；超了这个候选不参加（原因 `PRICE_OVER_LIMIT`，同引擎） |
| 中标 | 同一车型组把**各套餐时长、各商品**的候选放在一起，每个候选的 `sellMinor` 换成最终对外价，交给现有 `rankCandidates(候选, bandBp)`：同一个 3% 价格带、观察期 +5%、评分、完成单数、价低者的规则，同一租户只留最终价最低的那个。中标候选的套餐时长就是这一单的 H |
| 时间表 | 出发时刻（城市当地 → 瞬间）逐段累加，再换回当地钟面；跨午夜写「次日 / 第 N 天」；按瞬间计算，夏令时城市也对 |

输入校验（`routeCharterIssues`）：地点 2–10 个（途经点 0–8，常量 `ROUTE_CHARTER_LIMITS`）；途经点停留必填、30 的倍数、30–480；首尾两点没有停留；坐标范围；地点名称 1–240 字（与地址联想候选 `SitePlaceSuggestion.name` 的上限一致；接口、草稿、库里、模型线路的地点都是这一个上限）。模型线路自己的标题每种语言 ≤ 60 字（卡片标题）。

### 2. 计费粒度（需求 Q1）

推荐按引擎包车公式成比例（按分钟、按米）：这是包车规则在引擎里唯一的计算公式，「超时价 / 超公里价」的含义由它定。事后补收现在**没有**计算公式——供应商自己填金额（`extra-charges.ts` 第 107–111 行 `ExtraChargeSubmission` 只有 `amountMinor`），ADR 0029「后续」写的「按商品规则自动算出建议金额」没做；以后做时用同一个公式，两边一致。ADR 0073 的「向上取整到 1 公里」是点对点一口价含公里数的规则，不是包车的。业主要按整小时、整公里向上取整时，只在 `route-charter.ts` 里先把 T、D 向上取整再交给 `basePrice`。

### 3. 中标比较——核对代码的结论

- `compareQuotes` 返回的 `groups[].ranked` 每个候选带完整的 `offer`（含 `priceRuleId`、结算价明细）和 `sell`（`quote.ts` 第 1220–1234、1296–1306 行），`previewPlatformQuote` 把它交回服务层（`services/quotes.ts` 第 371–374 行），救援改派已在服务层用 `group.ranked`（`services/rescues.ts` 第 397 行）。
- 但它**不是全部候选**：`compareQuotes` 里的 `rankCandidates` 已按**套餐价**每个租户只留一个商品（`quote.ts` 第 1140–1142 行）。所以按第 1 小节，服务层**对每个商品单独调一次 `compareQuotes`**，拿到每个商品自己的 `sell` 和快照，再统一按最终价排。
- 两个仍然存在的限制（引擎内部、不改）：① 一个商品对一个车型组只出一个报价——商品的几个区域都能报时，引擎按套餐结算价取最低的区域（`quote.ts` 第 768 行），不看各区域规则的超时、超公里单价；同一商品不同区域设了不同超公里单价才有影响，罕见，写进供应商价格页说明。② 存进库的 `snapshot.candidates` 没有 `priceRuleId`（第 1182 行），按最终价排序只能在询价当场、在内存里做。
- `rankCandidates` 是导出的纯函数，按传入的 `sellMinor` 排序。服务层传最终对外价：**比价规则一字不改，比较的是最终价**，客人拿到含超时、超公里最低的那家（需求 02「保证客人拿到最低价」）。
- 不选「沿用引擎按套餐价选的中标再加超时超公里」：套餐价低、超公里单价高的供应商会中标，客人付的不是最低价。

### 3a. 订单锁定哪个候选（存库快照怎么写、读取点怎么改）

按最终价中标的可能不是任何一个 H 里引擎（按套餐价）选的中标，也可能在另一个 H（例：需求 03 R6 的乙、R2 的 10 小时）。所以：

- **存库快照** = 中标候选**自己那个商品单独调 `compareQuotes`** 得到的、中标套餐时长那一组的 `snapshot`：`winner` 就是这个候选（它自己的 `offer`、`sell`），`request.packageHours` = 中标的 H，`request` 里没有途经点。`snapshot.candidates` 换成按最终价重排后的全部候选（字段形状不变：`settlementMinor`、`sellMinor` 写**最终**结算价、对外价，`rankPrice`、`inBand`、`position` 是按最终价算的），另外每个候选多 `packageHours`、`packageSellMinor`、`routeChargeSellMinor`。
- `quotes` 行：`winner_tenant_id`、`product_id`、`package_hours` = 中标候选的；`sell_minor`、`settlement_minor` = **最终**价；最终价的组成在 `quote_route_charges`。
- 读取点逐个处理：

| 位置 | 现在读什么 | 按行程报价时 |
| --- | --- | --- |
| `services/orders.ts` 第 292–310 行（车型、免费等待、`packageHours`） | `winner.offer` | 不改：winner 已是最终中标候选 |
| `services/orders.ts` 第 326–328 行（订单结算价、明细） | `winner.offer.settlement.totalMinor` / `settlement` | 结算价改读 `quote_route_charges.final_settlement_minor`（有这一行时）；明细仍是 `winner.offer.settlement`，另附 `routeCharge` |
| `services/orders.ts` 第 347–350 行（`order_sales`） | `winner.sell.sellMinor`、`markupBp`、`fx`、`fxBufferBp` | `sellMinor` 改读 `quote_route_charges.final_sell_minor`；加价比例、汇率仍读 `winner.sell`（同一个候选） |
| `services/orders.ts` 第 353 行（Stripe 金额） | `winner.sell.sellMinor` | 改读最终对外价 |
| `services/order-queries.ts` 第 172–174 行（订单用的区域） | `snapshot.winner` 的租户、商品是否等于订单的 | 不改：两者都是最终中标候选，比对通过（集成测试） |
| `services/order-changes.ts` 第 268 行（改期用的渠道取整规则） | `winner.sell.channel` | 不改：同一候选；改期金额按第四节第 3 小节重算 |
| `routes/orders.ts` 第 177 行（区域加价对外参考） | `winner.sell.areaSurcharge` | 不改 |
| `routes/quotes.ts` 第 209 行（运营报价试算） | 引擎 `group.snapshot.winner` | 不改：运营试算走引擎原流程，不是按行程 |
| `repos/site.ts` `findQuotePackageKm` | 按 `quotes.winner_tenant_id` + 快照 `priceRuleId` 读当前规则 | 按行程和按时长包车都改读 `quote_route_charges.package_km`（锁定值） |
| `services/sales-quotes.ts` 第 146–161、244、262–263、328–336 行 | 引擎快照 | 不改：按行程报价用新的存储函数；`/sales/v1` 和普通官网报价的路径完全不变 |
| 救援改派 `services/rescues.ts` | 引擎 `group.ranked`（按套餐价） | 按行程的单：对接手候选用同一函数算最终结算价、**按最终价排序**（和原单中标口径一致），差价按最终结算价算 |

- 集成测试：R6（只有 8 小时套餐，甲套餐价低、超公里贵，乙最终价低）→ 订单落在乙：`orders.tenant_id` = 乙，订单结算价 = 乙的 50,000 + 乙的超公里 8,000 = 58,000，Stripe 金额 63,800；`order-queries` 的「同一个中标」比对通过（`pricing_route` 不为 null 的情形照旧可读）。R2 → 订单 `package_hours` = 10。
- `/sales/v1` 不受影响：渠道接口不提供按行程报价，询价、下单、快照读取都是原路径。
- ADR 0033 生效前试算（按快照重算候选的对外价）：**排除按行程的报价**（`quotes.itinerary_id` 指向 `charter_route` 的行程，或有 `quote_route_charges.final_sell_minor`），试算结果里单独列「按行程报价 N 条，未试算」——快照里的价格含超时超公里，试算只会重算套餐部分，算出来会误导。

### 4. 例子（与需求 03 R 系列同一组数，加价 10%、同币种、取整单位 1）

| 套餐 | 套餐结算价 | 含公里 | 超时 / 小时 | 超公里 / 公里 |
| --- | --- | --- | --- | --- |
| 4 小时 | 30,000 | 80 | 5,000 | 400 |
| 8 小时 | 50,000 | 150 | 5,000 | 400 |
| 10 小时 | 60,000 | 200 | 5,000 | 400 |

- T = 310 分、D = 120,300 米：4 小时 = 30,000 + 5,833.33（70 分）+ 16,120（40.3 公里）→ X = 21,953，最终对外 33,000 + 24,148 = 57,148；8 小时不超出，最终对外 55,000；10 小时 66,000 → **8 小时中标，最终 55,000**。
- T = 310 分、D = 183,200 米：4 小时被 2 倍含公里排除（> 160 公里）；8 小时超 33.2 公里 = 13,280 → 最终对外 55,000 + 14,608 = 69,608；10 小时不超出 66,000 → **10 小时中标，最终 66,000**。
- T = 520 分、D = 120,300 米：8 小时超时 40 分 = 3,333.33 → X = 3,333，Y = 3,666，最终对外 58,666（结算 53,333）；10 小时 66,000；4 小时超时 280 分 > 120 不试 → **8 小时，最终 58,666**。

### 5. 后果

- 调价规则、夜间费只作用于套餐部分；超时费、超公里费按规则单价原价算（和事后补收一致）。夜间费按套餐时长算（引擎现有），超时部分不另算夜间费。
- 最终价按谷歌不含路况的路线和客人填的停留锁定；当天路况慢了不另收，只有客人自己延长停留、改线路使实际超出锁定的时长 / 公里才补收（第四节第 4 小节）。
- 性能：一次按行程询价 = 最多 9 段路线（缓存命中不花钱）+ 一次取数 + 最多 6 轮引擎计价（通常 4 轮）+ 每个商品每轮一次轻量 `compareQuotes` + 每个候选三次 `basePrice`。目标 P95 ≤ 1.2 秒（不含谷歌首次调用），M9-03 的 PR 里用 6 个套餐 × 现有基准数据量实测并写进 PR。限速只计一次（和官网询价共用每地址每分钟 30 次）。

### 6. 被否的方案

| 方案 | 为什么不选 |
| --- | --- |
| 改引擎：包车按 T、D 计价 | 违背「引擎不改」；超时超公里会进调价基数，和事后补收口径不一致 |
| 付款按引擎价、超时超公里只作「预计另收」 | 业主口径纠正：给出最终报价并按它付款 |
| 只选覆盖 T 的最小套餐 | 超时也计费后，小一档 + 超时、或大一档（含公里多）常常更便宜（第 4 小节例子） |
| 沿用引擎按套餐价选的中标再加超时超公里 | 见第 3 小节 |
| 途经点也交给引擎做区域判断 | 原话「途经点只算距离和时间，不加钱、不触发区域加价」 |

## 三、预订草稿（入口 → `/book`）

### 1. 为什么用草稿、不把条件放进链接

10 个地点加名称、来源放进 `?d=` 链接会接近服务器前面那台 nginx 的默认请求行上限；测试服务器的 nginx 是共用的、不能 SSH，**不改它**。改为：组件先把预订条件 POST 到服务端暂存，跳转链接只带一个短 ID：`/book?draft=<id>`。

### 2. 表 `booking_drafts`（平台表，迁移 `03xx_booking_drafts.sql`）

| 列 | 说明 |
| --- | --- |
| `id` text 主键 | 32 字节密码学随机数的 base64url（43 字符，256 位熵）：不可猜、不可枚举；不是自增、不含时间 |
| `content` jsonb | 预订条件 v1（下面的结构）；序列化后 ≤ 16 KB（check 约束 `octet_length(content::text) <= 16384`） |
| `entry` | `embed`（本期只有组件创建草稿，见第 4 小节） |
| `embed_key_id` uuid、`embed_origin` text | 创建时服务端按白名单核对通过的 `Origin` 记下（不是客人提交的值） |
| `return_url` text null | 按第六节第 2 小节校验通过的 `redirectUrl`，≤ 2,000 字符 |
| `created_at`、`expires_at` | 有效期 **2 小时** |

预订条件 v1（`content`，domain 的 `BookingDraft` 类型和 `bookingDraftIssues` 校验，`/book` 页内状态、模型线路预填用同一个类型）：

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
  "lang": "ja"
}
```

- 地点 2–10 个，名称 1–240 字，坐标最多 6 位小数；停留规则同第二节；区间（`tab: transfer`）正好 2 个地点、没有停留。
- **不含价格、报价编号、任何客人个人信息**：JSON Schema `additionalProperties: false`，只有上面这些键；姓名、电话、邮箱在 `/book` 填，不进草稿（集成测试：多给一个 `passenger` 键 400）。地点是客人选的地址，和订单上下车地址同一口径（ADR 0055）。**已知限制**：地点名称是自由文本（客人可以手打），可能被填进电话、姓名；不做内容识别（误判多、收益小），靠 2 小时过期删除兜底，组件和 `/book` 的地址框提示「只填地点」。
- **为什么 2 小时**：客人从合作网站跳过来后要比价、选车、填信息、付款（报价 30 分钟有效、待支付 30 分钟），中间可能刷新、退回改条件，2 小时足够；更长只是让坐标多留在库里。2 小时也就是来源归属的窗口（第 4 小节）。常量 `BOOKING_DRAFT_TTL_MINUTES = 120`，需求 Q16。
- 有效期内可以重复打开（刷新页面、退回再进都行），不是「用一次就失效」。
- **清理任务** `BookingDraftRetentionJobs`（同 ADR 0076 的做法）：启动 20 秒后第一次，之后每小时一轮；每轮最多 10 批、每批 500 行；一批一个事务，先抢事务级 advisory lock，抢不到跳过；`delete … where expires_at < now()`，`for update skip locked`。数据库角色 `nozomi_platform`：`booking_drafts` 只给 `select, insert, delete`（不给 `update`：草稿写入后不改）；租户角色 `nozomi_app` 没有任何权限。

### 3. 接口

| 接口 | 规则 |
| --- | --- |
| `POST /embed/v1/booking-drafts?key=nze_…`（组件跨域调用） | `Origin` 规范化后与这个嵌入码白名单某项**完全相等**才处理；`Origin: null`、缺 `Origin`、不在白名单、嵌入码不存在或停用 → 403 `EMBED_ORIGIN_NOT_ALLOWED`，不带 CORS 头。请求体 `{ draft, return_url }`：`Content-Length` > 16 KB 在解析前 413；`draft` 按 `bookingDraftIssues` **逐项严格校验**（任何一项不合格 400，和 `/book` 同一份规则）；`return_url` 不合格时忽略（不报错，不存）。成功 201 `{ id, expires_at }` + `Access-Control-Allow-Origin: <origin>`、`Vary: Origin`。限速：每个来源地址 10 分钟 30 次（IPv6 按 /64）、每个嵌入码每分钟 60 次，超限 429 `RATE_LIMITED`；另外每个嵌入码**有效（未过期）草稿最多 5,000 条**（常量 `BOOKING_DRAFT_LIMITS.activePerKey`），满了 429 `EMBED_DRAFT_LIMIT`，等旧草稿过期（2 小时内）自然恢复——防止有人伪造 `Origin` 用一个嵌入码把表刷大：一个嵌入码最多占 5,000 × 16 KB ≈ 80 MB。`Content-Type: application/json` 会触发预检：`OPTIONS` 同样按 `key`（在查询串里）+ `Origin` 核对，只回 `Access-Control-Allow-Methods: POST`、`Access-Control-Allow-Headers: content-type`、`Access-Control-Max-Age: 600`；不开 `Access-Control-Allow-Credentials` |
| `GET /site/v1/booking-drafts/{id}`（同源，`/book` 读取） | 200 `{ draft, expires_at }`（不返回嵌入码编号、来源、`return_url`）；**过期和不存在都是 404 `BOOKING_DRAFT_NOT_FOUND`，不区分**；id 格式不对也 404；每个地址每分钟 60 次。不带任何 CORS 头 |

`/book?draft=<id>`：读到就预填并自动询价；404 时显示「链接已过期，请重新填写」并留空白表单。旧链接参数（`from`、`to`、`date`、`time`、`pax`、`bags`、`mode`）照旧。M8-05 之前 `/book` 带 `draft` 时转到新预订页。

### 4. 主站自己的入口不用草稿；来源记在草稿里，不再要签名凭证

- **主站 `/book` 页内、模型线路**：直接用页面内状态（模型线路走 `GET /site/v1/route-templates/{code}` 预填）。**不开** `POST /site/v1/booking-drafts`：少一个对外可写的接口，就少一个被刷库的面；同源入口本来就不需要跨页面传条件。
- **来源归属**：草稿由服务端在创建时按白名单 `Origin` 记下 `embed_key_id`、`embed_origin`、`return_url`，客人改不了。询价请求（`POST /site/v1/quotes`、`/quotes/by-points`、`/quotes/charter-route`）带可选的 `draft_id`；草稿有效时，服务端把来源抄进这次询价的行程记录（`route_itineraries.source`），下单时从报价对应的行程取来源，再核一次「嵌入码仍启用、来源仍在当前白名单」，通过记 `embed`，否则记 `book`，不拒单、不报错。
- **不再需要签名凭证**：凭证当初是为了让来源信息经过浏览器链接还不被篡改；现在来源只存在服务端，链接里只有不可猜的 ID，伪造来源只能靠非浏览器程序伪造 `Origin` 去创建草稿——和签名凭证方案下的伪造能力一样（那时也能用伪造的 `Origin` 取到真凭证）。所以同样安全、更简单，也不用从主密钥派生签名密钥。原来「点查询价格时刷新凭证」变成「点查询价格时创建草稿」，2 小时从这一刻算。
- 来源 `embed` 因此**只用于统计**，不作为分佣、结算或任何金额的依据；以后要分佣（需求 Q11-B）先重新设计来源证明（例如合作方服务端签名），另写 ADR。

## 四、订单（统一订单格式）

### 1. 询价时保存的行程 `route_itineraries`（新表）

| 列 | 说明 |
| --- | --- |
| `id`、`created_at`、`expires_at` | 询价时刻 + 24 小时，到期整行删除（下了单的已抄进 `orders.itinerary`） |
| `city_id`、`service_local`、`timezone`、`mode` | `mode`：`transfer` / `charter_package` / `charter_route` |
| `stops`、`legs` jsonb | 地点（含停留）；各段米数、分钟数、来源 |
| `drive_minutes`、`stay_minutes`、`total_minutes`、`total_meters` | 整数 |
| `source` jsonb | `{ entry, embed_key_id, embed_origin, return_url, route_template_id }`（从草稿或模型线路来；没有为 `{ entry: "book" }`） |

`quotes` 加 `itinerary_id uuid null references route_itineraries(id) on delete set null`（行程删了，报价引用置空，报价保留）。

`quote_route_charges`（`quote_id` 主键、外键 `on delete cascade`）——**询价时锁定**：H、含公里、两项结算单价和结算币种、两项对外单价参考；按行程才有的：T、D、超时分钟、超出米数、超时结算项、超公里结算项、X、Y、最终结算价、最终对外价、按最终价重排后的候选（`tenantId`、`productId`、H、套餐部分对外价、Y、最终对外价、`rankPrice`、`inBand`、`position`）。普通 `POST /site/v1/quotes` 的包车也写（只有单价，给 `post_service_rates`），之后都读这里，不读当前规则。跟报价保留，没有地点和个人信息。

`quotes.sell_minor`、`quotes.settlement_minor` 存**最终**价；快照的 `winner` 是按最终价中标的候选（它的 `offer`、`sell` 是套餐部分），最终价的组成在 `quote_route_charges` 里；存法和各读取点见第二节第 3a 小节。

清理任务 `RouteItineraryRetentionJobs` 做法同第三节第 2 小节；`nozomi_platform` 对 `route_itineraries` 只有 `select, insert, delete`，对 `quote_route_charges` 只有 `select, insert`；`on delete set null` 由 `quotes` 表主执行，不用加 `update` 权限。集成测试用 `nozomi_platform` 跑一轮，核对行程被删、报价在、`itinerary_id` 为 null、订单行程不变。

### 2. 订单上（`orders` 只加可空列）

| 列 / 位置 | 说明 |
| --- | --- |
| `orders.itinerary` jsonb null | 订单行程 v1：`{ version, mode, stops[{…, planned_arrival_local, planned_departure_local}], legs, totals, package{hours, km}, locked{minutes, meters} }`——没有金额 |
| `orders.entry_source`、`route_template_id`、`embed_key_id`、`embed_origin`、`return_url` | 来源；**只给官网订单应答和运营后台**，`/tenant/v1` 和供应商 Webhook 都不给 |
| 订单结算价 | = 最终结算价；结算价明细（`price_snapshot`）在引擎明细之外加 `routeCharge { overtimeMinutes, overMeters, overtimePerHourMinor, overKmPerKmMinor, overtimeMinor, overKmMinor }`，引擎明细之和 + `overtimeMinor + overKmMinor` = 订单结算价 |
| `order_sales.sell_minor` | = 最终对外价（Stripe 收这个数） |
| `order_sales.route_charge` jsonb null | Y 和两项对外单价参考；只给官网订单应答和运营后台 |

- 新的官网订单（区间、按时长包车、按行程包车）都写订单行程；M9 之前的订单、`/sales/v1` 渠道单为 null。
- 订单行程由服务端从 `route_itineraries` 写入，客人提交的内容不直接进订单；只在 `POST /site/v1/orders` 建单的同一事务里写，幂等键重复不再写。
- 隐私：订单行程里的地点和上下车地址同一口径（ADR 0055 待法务确认第 1 条）；以后地址进 180 天脱敏时一并处理。

### 3. 付款、取消、改期、救援、账单

| 环节 | 口径（核对的现有规则） |
| --- | --- |
| 下单付款 | Stripe 收 `order_sales.sell_minor` = 最终对外价 |
| 取消 | ADR 0029：客人扣「对外价 × M%」、供应商得「结算价 × M%」，用的是订单上的对外价和结算价 → 自动按最终价算；退款 = 实际付了的 − 取消费 |
| 改期 | ADR 0029「同一商品重新报价」：套餐部分照旧由引擎按新时间报；`locked` 的分钟、米数不变（行程不变），两项单价从同一商品当前规则重读（和套餐价一样是「重新报价」），超出部分按第二节同一函数重算；新最终价与旧的差价走 ADR 0029 现有的补收 / 退差价。时间表整体平移。改途经点、停留不在线改：联系客服或取消重下 |
| 救援改派 | ADR 0031 在服务层用 `group.ranked` 找下一家（`services/rescues.ts` 第 397 行）：按行程的单对接手候选用同一个函数算最终结算价，**按最终价排序**（和原单中标同一口径），差价按最终结算价算（M9-03 的范围） |
| ADR 0033 生效前试算 | 排除按行程的报价，单独列条数（见第二节第 3a 小节） |
| 账单 | ADR 0040 按订单结算价出账 → 含 X |
| 供应商看到的 | 结算价（含超时、超公里两项和单价、数量）；没有对外价（规则 4） |

### 4. 事后补收（只补超出锁定的部分）

- 可补收的量：超时分钟 = 实际 − max(H × 60, T)；超公里 = 实际 − max(含公里 × 1000, D)。客人已经为 T、D 付过钱，只有超过它们（且超过套餐）的部分才补。
- 走现有流程（ADR 0029、0070）：供应商在服务结束 24 小时内提交 `charter_overtime` / `charter_over_km`，客人 48 小时内可提异议，到期用 Stripe 保存的支付方式离线扣款；单笔超过对外价 50%、无凭证、有异议转人工审核。
- 最小补充（M9-03b 页面、M9-03 接口；`packages/domain/src/extra-charges.ts` 和 `apps/api`，不碰引擎）：
  - 供应商后台提交事后加收时，按行程的单显示锁定的 T、D、H、含公里和两项结算单价，写明「只收超出锁定部分」；金额仍由供应商填。
  - 新审核原因 `ROUTE_LOCKED_USAGE`（加进 `EXTRA_CHARGE_REVIEW_REASONS`）：按行程的单提交 `charter_overtime`、`charter_over_km` 时**一律转人工审核**，不在异议期后自动扣款——平台核对它只收了超出锁定的部分。
  - 运营审核页对这类加收显示锁定的 T、D、H、含公里、两项结算单价，以及按供应商填的实际量算出的「可补的量」（实际 − max(H × 60, T) 分钟、实际 − max(含公里 × 1000, D) 米）和按同一公式算的参考金额。
- 「付款链接、客人不付由司机现场收现金」**现有流程没有**：ADR 0069 第二批确认 ② 只是方案，只针对支付宝 / 微信订单，随 M8-07 做（受阻）；现有代码写着平台订单不收现金（`extra-charges.ts` 第 9、12 行）。本期不做，列为需求 Q15（推荐：M9 沿用离线扣款，付款链接和现金按 ADR 0069 ② 另立任务）。

## 五、接口变化（只加，不改已有字段；`/sales/v1` 不变）

### 官网 `/site/v1`

| 接口 | 变化 |
| --- | --- |
| `POST /site/v1/quotes/charter-route`（新） | 入参：`city_id`、`service_local`、`stops`、`passengers`、`luggage`、`addons`、`route_template`（可空）、`draft_id`（可空）。应答：`currency`、`itinerary`（时间表、各段、合计）、`quotes[]`（`SiteQuote` + `route_charge`）、`unavailable[]` |
| `SiteQuote` | 加 `post_service_rates`（包车：每小时、每公里对外单价参考，或 null）；加 `route_charge`（按行程：`{ package_hours, package_km, overtime_minutes, over_meters, package_price, overtime, over_km, total }`，金额都是 `SalesMoney`，`total` = `price.total`；其他为 null）。按行程时 `price.total` 是**最终价** |
| `POST /site/v1/quotes`、`/quotes/by-points` | 加可选 `draft_id`（只用于记来源） |
| `SiteUnavailable.reasons` | 加 `ROUTE_TOO_LONG`、`ROUTE_TOO_FAR` |
| `GET /site/v1/booking-drafts/{id}`（新） | 见第三节第 3 小节 |
| `SiteOrder` | 加 `itinerary`、`entry_source`、`route_charge`（对外）、`return_url` |
| `GET /site/v1/route-templates?city_id=`、`/{code}`（新） | 已上线的模型线路，不含价格；下线或不存在 404 `ROUTE_TEMPLATE_NOT_FOUND` |
| `POST /site/v1/manual-quote-requests` | 行程加可选 `vias`，进已加密的 `contact_enc`（ADR 0076），明文只加 `via_count` |

### 运营后台 `/platform/v1`

- 模型线路：`GET/POST /platform/v1/route-templates`、`GET/PATCH …/{id}`（`If-Match`）；`route_template.read`（运营、客服、只读、超级管理员）、`route_template.manage`（运营、超级管理员）。
- 嵌入码：`GET/POST /platform/v1/embed-keys`、`GET/PATCH …/{id}`（`If-Match`）、`GET …/{id}/snippet`；`embed.read`（运营、渠道经理、只读、超级管理员）、`embed.manage`（运营、渠道经理、超级管理员）。
- 订单详情、列表：加 `itinerary`、来源、`route_charge`（对外和结算）；列表按来源筛选。

### 供应商 `/tenant/v1` 和 Webhook

- 订单详情、`order.confirmed` / `order.changed` 加 `itinerary`；结算价明细多 `routeCharge`（结算价）。没有对外金额、没有来源字段（集成测试扫键）。租户编号只来自令牌，跨租户 404。
- 司机页：地点列表逐个「导航到这里」，停留时长和计划时间；没有价格。

### 嵌入 `/embed/v1`（跨域只开在这里）

| 接口 | 规则 |
| --- | --- |
| `GET /embed/v1/config?key=` | `Origin` 完全等于白名单某项 → 200 `{ lang, services, site_origin }` + `Access-Control-Allow-Origin: <origin>`、`Vary: Origin`；其余（含 `null`、缺失、嵌入码停用）403 `EMBED_ORIGIN_NOT_ALLOWED`，不带 CORS 头。`Cache-Control: private, max-age=60` |
| `GET /embed/v1/places/autocomplete`、`/places/details` | 同 `/site/v1/places/*` 的实现和每日上限；先核白名单（同上），再按现有每地址限速 + 每个嵌入码每分钟 600 次 |
| `POST /embed/v1/booking-drafts` | 见第三节第 3 小节 |

- 不开 `Access-Control-Allow-Credentials`；组件请求一律 `credentials: "omit"`。`/site/v1`、`/platform/v1`、`/tenant/v1` 永远不带 CORS 头。报价、下单不跨域。

### 组件脚本和路由同步

- 脚本是前端构建产物：`apps/web` 独立构建入口，产出 `/embed/widget-v1.js`，由 Caddy 当静态文件给；不放在 `/embed/v1/` 下（那个前缀整个归 API）。
- `apps/web/src/lib/api-prefixes.ts` 加 `/embed/v1`（Vite 代理、`edge-config.ts` 的转发规则都从这张表来）；`edge-config.ts` 给 `/embed/widget-v1.js` 单开响应头（`text/javascript`、`Cache-Control: public, max-age=300`、`Cross-Origin-Resource-Policy: cross-origin`、`nosniff`；不存在时 404，不落到 `index.html`）；`vite.config.ts` 加构建入口。
- `deploy/ci/smoke.sh`：① 组件脚本 200、JavaScript 类型、带 CORP；② `/embed/v1/config?key=nze_不存在` 带 `Origin` 是 403 且无 CORS 头；③ `/site/v1/config` 带 `Origin` 无 CORS 头。
- 不改测试服务器的 nginx（共用、不能 SSH）；链接只带短 ID，不涉及请求行长度。

## 六、安全

### 1. 白名单的边界

- 浏览器跨域请求自动带 `Origin`，网页脚本改不了；主站只对白名单 origin 回 CORS 头，所以在浏览器里，未授权网站上的组件读不到配置、建不了草稿，只显示「此网站未获授权使用预订组件」。
- 比较方式：`Origin` 规范化（小写、punycode、去默认端口）后与白名单逐项**完全相等**；不按后缀、主机名、包含。`Origin: null` 和缺失一律不放行。
- `Origin` 对非浏览器程序可伪造：能拿到的只是公开配置、地址提示，能做的只是建一个 2 小时的草稿（受限速、大小上限）——和直接用主站一样。白名单防的是「别人把组件放到未授权网站上」，不是访问控制；下单安全仍是 `/book` 和 `/site/v1` 现有的校验。
- 嵌入码是公开标识，不是密钥。草稿 id 是 256 位随机数，不可猜、不可枚举；读取接口过期和不存在同一个 404，并有限速。

### 2. `redirectUrl` / `return_url` 校验（domain 的 `embedReturnUrl`；建草稿和下单两处都调用）

1. ≤ 2,000 字符；WHATWG URL 解析，失败就拒。
2. 只收 `https:`（测试环境另收 `http://localhost`、`http://127.0.0.1`）；`javascript:`、`data:`、`blob:`、`file:` 等一律拒。
3. 不能带用户名、密码。
4. origin 必须**完全等于**白名单某项，**并且等于创建草稿的请求的 `Origin`**。
5. 下单时再对**当前**白名单核一次，通过才存进订单、在订单页显示「返回原网站」。
6. 链接 `rel="noopener noreferrer"`。

测试用例至少：`javascript:alert(1)`、`data:text/html,…`、`https://user:pass@embed-demo.moveglobal.io/`、`https://embed-demo.moveglobal.io.evil.example/`、`https://evil.example/?u=https://embed-demo.moveglobal.io`、`https://embed-demo.moveglobal.io:8443/`（白名单没写端口时拒）、`http://embed-demo.moveglobal.io/`、2,000 字符过 / 2,001 字符拒、白名单里有但不等于请求 `Origin` 的另一个域名、建草稿后从白名单移除再下单。

### 3. 为什么不用 iframe、CSP

- 组件是脚本 + Shadow DOM，在合作网站页面里渲染：主站的 `frame-ancestors 'none'`、`X-Frame-Options: DENY`（ADR 0046）不变。
- 组件受对方的内容安全策略约束：对方要在 `script-src`、`connect-src` 放行主站域名；生成代码的页面写明，演示站由业主在工厂后台确认。
- 样式用 `adoptedStyleSheets`，不支持时退回 Shadow DOM 里的 `<style>`。
- 演示站和测试环境同属 `moveglobal.io`（同站不同源）：组件只请求 `/embed/v1` 且 `credentials: "omit"`，主站 Cookie（验收会话 `nozomi_qa`，`Path=/site/v1`）不会带上。

### 4. 跨域方式的取舍

| 方式 | 结论 |
| --- | --- |
| 组件不调接口、条件全放进链接 | 否：白名单无处执行；链接长度受共用 nginx 限制 |
| **只开 `/embed/v1` 的配置、地址提示、建草稿，白名单 origin 才放行；报价、下单不跨域** | **选这个** |
| 报价也跨域、组件里显示价格 | 否（原话「提交跳主站 /book」；跨域面大） |

## 七、测试计划

| 层 | 内容 |
| --- | --- |
| domain 单元 | `route-charter.test.ts`：候选套餐（超时正好 120 / 121 分、按 2 倍含公里预筛、取 4 个、补试到 6 轮、列表为空；城市 2、3、4、5、8、10 小时、T = 130 分、D = 300 公里时预筛后只试 8、10 小时，不误判 `ROUTE_TOO_FAR`）、最终价超过 `exceedsSettlementLimit` 的候选被排除、超时 / 超公里与 `basePrice` 差值一致、两项相加后只取整一次、尾差计入超公里、JPY / CNY / USD、渠道取整单位向上、2 倍含公里正好 / 多 1 米、第二节第 4 小节三个例子、时间表跨午夜 / 跨两天 / 夏令时、输入校验每个原因码；`booking-draft.test.ts`：10 个地点 × 240 字名称 ≤ 16 KB、多余键、个人信息键被拒、区间 / 包车的地点数；`embed-origin.test.ts`、`embed-return-url.test.ts`：第六节全部用例 |
| 引擎不变 | `quote-compat` 888 个样例逐分一致；M9 每个 PR 的文件列表里没有 `quote.ts`、`pricing.ts` |
| 集成（真实 PostgreSQL，谷歌替身） | 按行程最终价 = 中标候选的引擎对外价 + Y，且套餐部分 = 同条件 `POST /site/v1/quotes`（包车 H）逐分一致；按最终价重排（R6：订单落在乙，`orders.tenant_id` = 乙、订单结算价 58,000、Stripe 63,800、`order-queries` 同一中标比对通过；R2：订单 `package_hours` = 10）；同一供应商两个商品、套餐价低的那个超公里贵时，另一个商品仍参加并可中标（逐商品调 `compareQuotes`）；Stripe 金额 = 最终价；`/sales/v1` 询价下单回归不变；ADR 0033 试算排除按行程报价；按行程单的超时 / 超公里加收进 `ROUTE_LOCKED_USAGE` 审核；草稿每嵌入码每分钟 60 次、有效草稿 5,000 条上限；取消费按最终价；改期重算；救援差价按最终结算价；`/tenant/v1` 有 `routeCharge`、扫键无对外金额和来源字段；租户 A 读不到 B；草稿：白名单 / null / 缺 Origin、预检、16 KB、限速、过期和不存在同 404、重复打开、清理任务角色；行程清理；模型线路、嵌入码权限矩阵、`If-Match` 409、审计；`/site/v1` 永不带 CORS |
| 前端组件 | `/book` 按行程（途经点、停留、时间表、最终价明细、转人工）；`?draft=` 预填和过期提示；模型线路预填；运营后台两个页面；订单页、供应商详情（含补收提交的锁定值）、司机页 |
| 端到端 | 两个本机 origin（白名单内、外）的宿主页：白名单的建草稿 → 跳 `/book?draft=` → 报价 → 付款（假 Stripe）；非白名单显示未授权；宿主页全红样式不影响组件；320 px、axe |
| 测试环境验收 | 见 M9-05 |

所有测试数据在测试里构造、结束清理；不预置任何嵌入码、模型线路、草稿、商品、价格。

## 八、分 PR（顺序：订单格式 → 线路包车 → 嵌入组件；每个 PR：独立审查 → 合并 → 部署 → 测试站验收）

| 任务 | 角色 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| M9-01 | 产品 | 本篇、需求 03、roadmap | — | 独立审查通过 |
| M9-02 | 后端 + 前端（同一个 PR，后端先做） | 统一订单格式：`BookingDraft` 类型和校验、`booking_drafts` 表和读取接口、清理任务、`/book?draft=`、订单行程和来源列、订单应答加字段 | M9-01 | 需求 03 F1–F3、F5、F10–F12（草稿用测试直接写入；建草稿接口随 M9-04） |
| M9-03 | 后端 | 按行程询价（预筛候选套餐、逐商品对外价、最终价、按最终价排序、上限检查）、存库快照换成最终中标候选及第二节第 3a 小节各读取点、`quote_route_charges`、`route_itineraries`、订单和结算价明细、取消 / 改期 / 救援（按最终价排序）/ 账单按最终价、ADR 0033 试算排除、`ROUTE_LOCKED_USAGE` 审核原因、人工报价带途经点 | M9-02 | 需求 03 R1–R20、R24–R26 接口部分 |
| M9-03b | 前端 | `/book` 按行程页面、最终价明细、订单页、供应商详情（含补收提交显示锁定值）、运营加收审核页（锁定值和可补的量）、司机页 | M9-03 | R 系列页面部分 |
| M9-03c | 后端 + 前端（同一个 PR） | 模型线路 | M9-03b | R21–R23 |
| M9-04 | 后端 + 前端（同一个 PR） | 嵌入码与白名单、运营后台生成代码、`/embed/v1` 配置 / 地址提示 / 建草稿的 CORS、`return_url` 校验、来源归属、路由同步、smoke ①～③ | M9-02 | F4、F6–F9、E2–E4、E8–E10、E13、E14 |
| M9-04b | 前端 | `widget-v1.js`：init、两个标签、Shadow DOM、点「查询价格」先建草稿再跳 `/book?draft=`、未授权提示、大小预算 | M9-04、M9-03b | E1、E5–E7、E11、E12、E15 |
| M9-05 | 验收 | 测试环境 + 演示站全链路 | 全部；业主在工厂后台放代码 | 需求 03「验收」原话三条 |

单个 PR 超过 3 天工作量时按后端 / 前端再拆，顺序不变；同时最多 2 个开发角色，不自批。
