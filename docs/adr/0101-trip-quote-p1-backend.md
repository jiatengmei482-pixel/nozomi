# ADR 0101：AI 行程报价 P1 后端——行程单、服务段、跨段费用、编排接口、四类跨段规则、方案对比（实施篇）

- 状态：**已采纳（2026-11-15，监工书面确认，见第九节「监工确认」）**。正文为第三稿。第一稿经独立审查（PR #263 评论）「需要修改后复核」，11 条必须修改逐条处理；第二稿复核又提 3 条（M1–M3），第三稿处理，见文末「修改记录」。设计依据是 ADR 0094（M10-00，草案第四稿，在审）；本篇是它 P1 的**后端实施 ADR**，只写本车道要落地的部分和实施时才看得清的细节。
- 工作项：**M9T-00**（本篇）；实施 **M9T-01**（domain 编排与规则）、**M9T-02**（迁移 0600、规则配置接口）、**M9T-03**（编排接口）、**M9T-04**（固定测试集与验收）、**M9T-05**（行程单清理任务）；官网行程报价页 **M9T-06～M9T-10**（第十三节）。
- 依据（冲突时按这个顺序）：
  1. 业主《NOZOMI AI 行程报价 · 设计方案（草案 v1）》`docs/requirements/ai-trip-quote-design-2026-11-14.md`（下称「原文」）；
  2. ADR 0094（下称「设计篇」）：数据模型、编排接口、规则配置键、分段判定、方案对比、第十一节默认值；
  3. ADR 0093（三层区域、按上下车点找商品、各商品自选套餐、13 小时拦截）、ADR 0091（预计用时 T）。
- 编号：main 上最大是 0096；0097（#255）、0098（#259 / #261）、0099（#260）已被未合并的 PR 占用，这里用 **0100**。数据库迁移按监工要求从 **0600** 起。
- **硬约束（原文第 0 节、监工 2026-11-15）**：只新增表、新增接口、新增模块；**不改现有报价接口、不改现有表**（不改 `quoteProduct`、`siteQuotes`、`previewPlatformQuote` 的入参与结果，不给现有表加列）。不碰包车（M9P）车道的文件。唯一越线处是 B2（给三个现有函数加 `export`、不改函数体），监工 2026-11-15 已书面放行（第九节「监工确认」）。

---

## 〇、结论摘要

1. **本车道交付 = 设计篇 P1a（同城多日底层）**，外加返程规则的「纯函数 + 配置 + 单元测试」。**返程不接入编排**（P1a 里触发不了，第四节第 4 条），接入随 P1d；监工 2026-11-15 已接受（B3）。不做行程下单与付款（P1b）、新干线（P1c）、跨城市一车到底（P1d）、地图（P2）、AI（P3–P5）。
2. **数据**：迁移 0600 新增 5 张表——平台表 `trips`、`trip_plans`、`trip_segments`、`trip_fees`，租户表 `trip_rule_configs`。P1 只收结构化输入，不收自由文字。
3. **接口**：`POST /site/v1/trips`、`GET /site/v1/trips/:id`、`POST /site/v1/trips/:id/quote`（官网渠道）；`GET/PUT /tenant/v1/products/:id/trip-rules`、`GET /platform/v1/products/:id/trip-rules`。
4. **每一段都经现有报价服务报价**：编排器调 `previewPlatformQuote`（`apps/api/src/services/quotes.ts:301`），入参和官网询价**逐项一致**（币种 = 官网渠道结算币种、司机语言 null、车型组空，第三节第 5 小节），所以 `daily_best` 的段价 = 客人单独查这一段的中标价。编排器不算任何一段的价。
5. **「一车到底」的粒度是「同一供应商 × 同一车型组」**，不是「同一商品」：现有比价每个车型组每个租户只留一个报价（`rankCandidates`，`packages/domain/src/quote.ts:1647-1654`），要按商品取全就得改入参（偏离 D1，P1 按租户做）。
6. **四类跨段规则**（新模块 `packages/domain/src/trip/`，纯函数）：住宿（含客人提供住宿抵免、和③空驶加价不重复收）、多日停驻、工时与第二司机、长途返程（函数）。另加设计篇第四节第 9 条的「按次附加项去重」。
7. **方案对比**：多日行程出 `one_car` 和 `daily_best`；推荐门槛按设计篇用 **10%**。
8. **调用量**：段报价、路线调用分别设预算，超出降级为「只报不拆」，不直接 422；新加三个限频键 `site_trip`、`site_trip_quote`、`site_trip_quote_day`。

---

## 一、范围

| 项 | 本车道 | 理由 / 去向 |
| --- | --- | --- |
| 行程单、方案、服务段、跨段费用、规则配置的数据模型 | ✅ | 设计篇第二节第 1 小节，只取 P1a 需要的 5 张表（和设计篇的列差异见第二节末表） |
| 标准行程单（`schemaVersion: 1`）校验与上限 | ✅ | 设计篇第二节第 3 小节；P1 只认坐标和平台地点编号 |
| 编排接口（只收结构化输入） | ✅ | 原文第 7 节 P1 |
| 分段判定、同一天合并比价 | ✅ | 机场开始 / 结束套餐（M9P-21 / #261）合并后由引擎自己匹配，编排器不改，见第三节第 3 小节 |
| 住宿（含客人提供抵免）、多日停驻、工时 + 第二司机、单日上限、附加项去重 | ✅ | 原文 3.1、3.3、3.4、3.7；设计篇第四节第 9 条 |
| 长途返程 | 纯函数 + 配置 + 单元测试 ✅；**不接入编排** | 返程只在车停在①③以外时成立，那种日子现有引擎报不出价；接入随 P1d（阻塞项 B3） |
| 「拆成两天」备选 | ❌ 只给提示 | 设计篇 P1a 列了；自动拆要替客人选中途过夜地，P1 没有地图 / AI，见第九节偏离表 D3 |
| 方案对比 | ✅ `one_car` / `daily_best` | `local_cars`、`shinkansen`、`one_car_then_local` 在 P1c / P1d |
| 规则配置页（前端） | ❌ | 本车道只做后端接口；页面另开任务（roadmap M9T 备注，随前端车道排期） |
| 行程下单、一次付款、`trip_quotes` | ❌ | P1b，另写付款 ADR |
| 新干线、铁路参考表、长途档位价、高速费 | ❌ | P1c / P1d |

## 二、数据模型（迁移 0600，只新增）

行程单跨供应商，是**平台表**（不带 `tenant_id`，供应商读不到，同 `quotes`）；规则配置属于供应商的商品，是**租户表**（带 `tenant_id`、行级安全、租户隔离集成测试，CLAUDE.md 第 2 条）。

| 表 | 归属 | 列（P1） | 说明 |
| --- | --- | --- | --- |
| `trips` | 平台 | `id`（32 字节随机数 base64url，43 字符，同 `booking_drafts`，`apps/api/src/services/booking-drafts.ts:36`；客人凭它访问）、`channel_id`、`source`（P1 只有 `form`）、`status`（`draft / quoted`）、`itinerary`（标准行程单 JSON）、`currency`（= 官网渠道结算币种，建单时定）、`is_acceptance`（只由服务端在带有效验收会话时设 true，建好不可改，同 `0360_manual_quote_acceptance.sql`）、`created_at`、`updated_at`、`readable_until`（行程单可读、可再报价到何时：建单 + 30 天） | 报价到期时间不在这张表（在 `trip_plans.expires_at`），重报价不受影响 |
| `trip_plans` | 平台 | `id`、`trip_id`、`seq`、`kind`（`one_car / daily_best`）、`recommended`、`tenant_id`、`vehicle_group_id`（`one_car` 用；`daily_best` 为空）、`sell_minor`、`settlement_minor`（同一结算币种时才有，否则空）、`currency`、`status`（`quoted / unquoted`）、`unquoted`（原因列表 JSON）、`warnings`、`quoted_at`、`expires_at`（方案里最早到期的段报价） | 一次报价重写这一行程的全部方案（第三节第 6 小节） |
| `trip_segments` | 平台 | `id`、`plan_id`、`seq`、`day_index`、`service_date`、`segment_type`（`airport_pickup / airport_dropoff / p2p / charter / idle_day`）、`start_local`、`end_local`、`points`、`category`、`city_id`、`product_id`、`tenant_id`、`vehicle_group_id`、`package_hours`、`settlement_minor`、`settlement_currency`、`sell_minor`、`markup_bp`、`fx`（换算快照）、`breakdown`（引擎明细快照）、`route`（米、行驶分钟、停留分钟、来源） | `quote_id`、`order_id` 在 P1b 以新迁移加列 |
| `trip_fees` | 平台 | `id`、`trip_id`、`plan_id`、`seq`、`fee_type`（`lodging / lodging_offset / idle / second_driver / bundle_discount / return`）、`tenant_id`、`product_id`、`rule_version`、`settlement_minor`（可为负）、`settlement_currency`、`sell_minor`、`night_index`、`day_index`、`area_id`、`label`、`calc`（算式快照） | 时间类加价不在这里，每段自带（设计篇第四节第 10 条） |
| `trip_rule_configs` | **租户** | `tenant_id`、`product_id`、`version`、`config`（JSON，第四节）、`updated_at` | 主键 `(tenant_id, product_id)`；没有这一行 = 全部用默认值。`version` 每次保存加一，写进 `trip_fees.rule_version` |

- 平台表只授权给 `nozomi_platform`；`trip_rule_configs` 授权给 `nozomi_app`（读写）和 `nozomi_platform`（只读），照抄 `0330` 的授权与行级安全写法，登记 `schema-structure.itest.ts`、`rls.itest.ts`。
- 外键：`trip_plans → trips`、`trip_segments → trip_plans`、`trip_fees → trip_plans` 都 `on delete cascade`（只在同一事务里重写方案时删）；`trip_rule_configs (tenant_id, product_id) → products` `on delete cascade`。`trip_segments.product_id` / `tenant_id` 不设外键（报价时的快照）。
- 没有演示数据；默认值写在 domain 常量里。
- **保留期与清理**：`trips` 只存坐标、时间、人数，不含姓名电话。`readable_until` 过后 `GET` 返回 404；行和下属方案的清理做成 **M9T-05**（roadmap 已登记，CLAUDE.md 第 7 条），按设计篇第八节第 6 小节 30 天。
- **以后加列**：P1b（`quote_id`、`order_id`）、P3（加密原文列、`status` 加值）都是给**本篇新建的表**以新迁移追加，不算「改现有表」——监工已按 Q10 默认值确认。

和设计篇第二节第 1 小节的列差异（只列 P1 不同的）：

| 设计篇 | 本篇 | 原因 |
| --- | --- | --- |
| `trips.raw_input_enc`、`texts_enc`、`ai_meta` | 不建 | P1 没有自由文字，P3 加 |
| `trips.expires_at` | 改为 `readable_until`；报价到期在 `trip_plans.expires_at` | 审查第 11 条：一列两用会让行程 30 分钟后不能再报 |
| `trip_plans.product_id` | 改为 `tenant_id` | 一车到底的粒度是租户 × 车型组（第三节第 6 小节） |
| `trip_segments.quote_id` | P1b 加 | P1 不写 `quotes` |
| `trip_handoffs` | 不建 | P3；P1 报不出的记进现有 `uncovered_demands`（第三节第 5 小节） |

### 标准行程单（P1 子集）

```jsonc
{
  "schemaVersion": 1,
  "party": { "adults": 4, "children": 0, "luggage": 3 },
  "preferences": { "vehicleGroupIds": [], "addons": [] },
  "days": [
    { "date": "2027-03-28",
      "items": [
        { "kind": "arrive_flight", "place": { "placeId": "<机场>" }, "time": "14:30" },
        { "kind": "stop", "place": { "lat": 35.69, "lng": 139.70, "kind": "hotel" }, "stayMinutes": 0 }
      ],
      "nightAt": { "lat": 35.69, "lng": 139.70 },
      "driverLodgingProvided": false }
  ]
}
```

- `place` 只能是平台地点（`placeId`）或坐标（可带 `kind: hotel / poi / address`）。谷歌地点编号、名称解析在 P3。
- `items[0]` 是当天起点（`arrive_flight` / `start`，必须带 `time`），之后是 `stop`（停留分钟 0–720）和最后的 `end`（可选 `kind: depart_flight`）。**后续各点的到达时间由服务器推算**：上一点时间 + 停留 + 路线行驶分钟；客人不填。
- `driverLodgingProvided`：客人当晚给司机提供住宿（原文 3.1「客人提供住宿」抵免），这一晚住宿费记 0（`calc.source = "provided_by_guest"`）。
- `preferences.vehicleGroupIds` **不传给引擎**（官网询价传空），只在结果上过滤；**不收司机语言**（官网询价传 null，P1 不支持，P3 再议）。
- **不收**：`note`、航班号、`provenance`。
- 上限（服务端 zod 和 domain 共用常量）：14 天、每天 12 个点、全程 60 个不同地点、附加项 10 个；人数 1–60、**行李 0–60**（引擎上限 `QUOTE_RULES.maxLuggage`，`packages/domain/src/quote.ts:79`，超过会 400）。
- `days` 按日期升序、不重复；`items` 为空 = 空闲日。

## 三、编排接口与算法

### 1. 接口

| 接口 | 说明 |
| --- | --- |
| `POST /site/v1/trips` | 校验标准行程单，存为 `draft`，返回 `trip_id`。限频新加档 `site_trip`（同 IP 每分钟 10 次） |
| `GET /site/v1/trips/:id` | 行程单和最近一次报价的方案（到期的标 `expired`）。凭编号访问，同 `booking_drafts` |
| `POST /site/v1/trips/:id/quote` | 编排 + 分段报价 + 跨段费用 + 方案对比，写方案、段、费用。限频：一个限频键只有一个时间窗（`apps/api/src/services/rate-limit.ts:75-76`），所以加两个键 **`site_trip_quote`（同 IP 每分钟 5 次）** 和 **`site_trip_quote_day`（同 IP 每天 50 次）**，两个都放行才报价；不和 `site_quote` 共用 |
| `GET / PUT /tenant/v1/products/:id/trip-rules` | 供应商读、改这个商品的跨段规则，乐观锁、写审计；只有结算价 |
| `GET /platform/v1/products/:id/trip-rules` | 运营只读 |

- 渠道：官网渠道（`requireOpenSite`），授权城市、品类、供应商名单和官网询价完全一样；验收会话同样只报 QA 测试供应商。
- `tenant_id` 不出现在任何入参里；对客应答不含结算价、加价比例、供应商编号（规则 4）。
- **运营可查**：每次编排写一行结构化日志（`trip_id`、段报价次数、路线次数、降级与否、耗时、各方案状态），不含坐标以外的个人信息；`trip_*` 表本身就是完整快照。

### 2. 应答

```jsonc
{
  "trip_id": "…", "currency": "JPY", "expires_at": "…",
  "plans": [
    { "plan_id": "…", "kind": "one_car", "recommended": true, "status": "quoted",
      "total": { "amount": 0, "currency": "JPY" },
      "vehicle_group": { "id": "…", "name": { "zh": "…" } },
      "days": [
        { "date": "2027-03-28",
          "segments": [ { "segment_id": "…", "type": "airport_pickup", "label": "成田机场 → 酒店",
                          "start_local": "…", "end_local": "…", "amount": 0, "package_hours": null,
                          "price_breakdown": [ /* 同官网询价的对外明细 */ ], "route": { "meters": 0, "minutes": 0 } } ],
          "fees": [] } ],
      "fees": [ { "type": "lodging", "label": "司机住宿费（第 1 晚，箱根）", "amount": 0 } ],
      "warnings": [ { "code": "SECOND_DRIVER", "day_index": 2 } ] } ],
  "unquoted": [ { "plan_kind": "one_car", "day_index": 3, "reason": "WORK_HOURS_HARD_LIMIT" } ],
  "degraded": false
}
```

金额是渠道结算币种的最小单位整数；明细沿用官网询价的 `price_breakdown`（`apps/api/src/routes/site.ts:327`）。

### 3. 分段判定（设计篇第三节第 3 小节）

每天把点排成 `P0 → … → Pn`（没写终点时 `Pn` = 当晚 `nightAt`）：

1. `n = 1`、`P0` 是机场 → **接机**；
2. `n = 1`、`Pn` 是机场 → **送机**；
   - 「是机场」和官网按点询价同一判断：`placeId` 是机场，**或坐标落在平台机场里**（官网按坐标识别机场，`apps/api/src/services/site.ts` 的按点询价）。
   - **回落**（同官网 M8-33 / M8-35，`site.ts:982-995`）：接送机一个报价都没有时，再按出发地（不在时按目的地）所在、官网能订点对点的城市（`pointToPointCityOf`）用点对点报；回落的那次不再记未覆盖需求。段的 `segment_type` 仍是接机 / 送机，`category` 记 `point_to_point`。
3. `n = 1`、两端都不是机场、不停留 → **点对点**；
4. 有经停或停留 → **包车**（按行程计价，`charterSelection: "auto"`）；`P0` 或 `Pn` 是机场时另试「接机 + 包车」「包车 + 送机」拆法；
5. `items` 为空 → **空闲日**。

机场开始 / 结束套餐（M9P-21，#261）合并后，包车段的引擎自己匹配机场场景，编排器不用改。

### 4. 同一天合并比价

- 拆点只在自然断点：机场、车站、`kind: hotel` 的点、停留 ≥ 60 分钟的点。每天最多 4 种拆法（含「不拆」），超出只留「不拆」和「在第一个酒店拆」。4 种拆法合计最多 1 + 2 + 2 + 3 = **8 段**。
- 每种拆法的每一段单独报价；同一天取总价低的拆法，一样时取段数少的。
- `one_car` 方案里，拆法只在同一租户、同一车型组的报价里比较（第 6 小节）。

### 5. 每一段怎么报价

- **调用**：`previewPlatformQuote(ctx, input, { fresh: false, audience })`。入参和官网询价逐项一致（官网组装入参 `apps/api/src/services/site.ts:812-825`，进 `createSalesQuotes` 后的点位解析与 `assumeRoute: null` 见 `apps/api/src/services/sales-quotes.ts:258-282`）：`channelId` = 官网渠道、**`currency` = 渠道结算币种**、`driverLanguage: null`、`vehicleGroupIds: []`，人数、行李、附加项、时间、经停照客人填的。结果里每个车型组有比价后的报价列表 `group.ranked[]`（每个租户一个，`offer` / `sell`，`packages/domain/src/quote.ts:1745`），一车到底的非中标价从这里取；候选商品（含价格规则）在 `preview.candidates`（`apps/api/src/services/quotes.ts:279`）。
- **城市与路线**：官网的 `charterCityFor`（`site.ts:706`）在 `loadCharterCityCandidates` + `charterMatches` 之外还按渠道范围、`sells`、验收会话 listing 过滤；`itineraryRoute`（`site.ts:606`）逐段估路线。按 B2（监工已放行）在 `site.ts` 给这两个函数加 `export`，不改函数体；M9T-03 补一条测试保证官网询价行为不变，编排器直接调用。
- **路线分钟**：包车行程的全程分钟、行驶分钟由编排器自己估（逐段路线，有缓存和每日上限）——一口价商品的 `preview.route` 是 null（`quotes.ts:198-204`），不能从结果里取。取不到 → 这一段 `ROUTE_UNAVAILABLE`。
- **不写 `quotes`**：P1 段报价只是展示（试算）；P1b 下单前对选中方案逐段走正式询价落报价。
- **预算与降级**（审查第 8 条）：一次编排**段报价最多 120 次、路线调用最多 200 次**（14 天 × 8 段 = 112；路线每天最多 11 段 + 拆点衔接）。路线预算只算编排器自己估的包车行程路线，引擎内部为接送机、点对点算钱调的路线不在其内（走同一缓存和全站每日上限）。放大倍数：每 IP 每分钟最多 5 × 120 = 600 次段报价，约为 `site_quote`（30 次）的 20 倍——一次行程报价本来就等于十几次单段询价，靠每天 50 次和全站路线日上限兜底，上线后按日志调。同一对点同一时间只报一次（内存缓存）。按日期顺序编排，预算剩余不够下一天全部拆法时，余下各天**只报「不拆」**，应答 `degraded: true`；连「不拆」都报不完才 422 `TRIP_TOO_COMPLEX`。路线调用还受全站每日上限；行程报价单独的日上限（设计篇 715 行）随 `site_trip_quote` 的每日 50 次控制。
- **未覆盖需求**（采纳设计篇第九节的「按段照官网记」，第三稿按复核 M1 改）：
  - 编排器直接调 `previewPlatformQuote`，不会像官网那样在 `createSalesQuotes` 里自动记（`sales-quotes.ts:328-329`），所以编排器自己调 `recordUncoveredDemandLater`（`uncovered-demands.ts:159`）。要的事实由官网的私有函数 `demandFacts`（`sales-quotes.ts:334`）拼——按 B2（已放行）加 `export`，编排器直接调用。
  - 条件照官网：只在**每天各自取最低价的那组段**上、这一段一个报价都没有时记（多日行程 = `daily_best` 的段，单日行程只出 `one_car`，看它的段）；**验收会话不记**；**只因选短了（最低套餐 / 预计用时）报不出的不记**（`onlyTooShort`，`sales-quotes.ts:327-328`）；接送机回落点对点的那次不记。每次编排同一段只记一次，指纹去重照旧。
  - 主原因由 `uncoveredDemandReason`（`packages/domain/src/uncovered-demand.ts:83`）按候选数和拒报原因自己推，调用方**不能指定 `OTHER`**。所以行程特有原因（工时、跨城一车到底——后者只出现在 `one_car`）**P1 不记进 `uncovered_demands`**，只在方案 `unquoted` 和编排日志里；设计篇的 `trip_handoffs.reason` 和运营后台「行程原因」筛选随 P3，列为偏离 D6。

### 6. 方案（设计篇第三节第 5 小节，P1 子集）

| 方案 | 何时出 | 组成 |
| --- | --- | --- |
| `one_car` 一车到底 | 有 2 天以上用车时尝试；单日行程只出它 | **同一租户、同一车型组**贯穿全部用车日（细到同一商品要改入参，见偏离 D1）。对每个「能报出全部用车日」的租户 × 车型组，按天取它自己的最低拆法，加上跨段费用，取总价最低的。段价是这个租户在同一次比价里**自己的对外价**，不一定是中标价 |
| `daily_best` 每天各自最优 | 2 天以上用车时 | 每天独立取最便宜的拆法和中标报价；不加住宿、停驻、附加项去重（每天不是同一辆车）；工时只按单日检查 |

- **机场日、点对点日怎么进一车到底**（审查第 3 条、原文 3.3「按段选车」）：接机、送机、点对点段由别的品类商品报价，不可能和包车同一商品。规则：
  1. 这一天的机场 / 点对点段如果落在这个租户包车商品的①③里，**先试「不拆」按包车报**（同一租户同一车型组），能报就算同一辆车；
  2. 报不出或更贵时，这一天允许用这个租户的接送机 / 点对点报价，仍算同一辆车（同一供应商同一车型组）；
  3. 这个租户这一天连接送机 / 点对点都报不出 → 允许用别的供应商（按段选车），这一天在住宿、停驻、工时上**算作不是同一辆车**：前一晚、当晚不收住宿，工时休息从这一天断开，方案加告警 `SEGMENT_OTHER_VEHICLE`。
- **推荐**（采纳设计篇第三节第 5 小节）：`daily_best` 比 `one_car` 便宜 **10% 以上**（`recommendGapBp` 平台常量 1000）时推荐 `daily_best`，否则推荐 `one_car`（同一辆车、同一位司机）。设计篇的「门到门快 60 分钟」只在有新干线方案时有意义，P1 不用。
- 某天一个报价都没有：两个方案都进 `unquoted`（带天和原因）；都报不出时 `plans` 为空。
- 每次报价在一个平台事务里删掉这一行程的旧方案、写新方案，`trips.status` 改为 `quoted`。

## 四、跨段规则（`packages/domain/src/trip/`，纯函数，不碰数据库和网络）

输入：已经报好价的各段（带租户、商品、车型组、①区域、当天时间、路线）、当晚过夜点、各商品的规则配置和价格规则。输出：`trip_fees` 行（含算式快照）和告警。**不改 `quote.ts`、`pricing.ts`。**

规则配置 `trip_rule_configs.config`（金额是商品结算币种最小单位，比例是基点；不填的键 = 默认值）：

| 键 | 内容 |
| --- | --- |
| `lodging` | `{ enabled, perNightMinor, byArea: [{ areaId, perNightMinor }], offsetSurcharges }` |
| `idleDay` | `{ enabled, perDayMinor, orShortestPackage }` |
| `workHours` | `{ maxBindMinutes, hardMaxBindMinutes, minRestMinutes, absoluteMinRestMinutes, maxDriveMinutes, maxDailyKm, garageMinutes, awayGarageMinutes }` |
| `secondDriver` | `{ enabled, mode: "shortest_package" \| "fixed", fixedMinor }` |
| `bundleAddons` | `{ enabled }` |
| `returnTrip` | `{ enabled, ratioBp, fixedByCity: [{ cityId, minor }], maxOneWayKm }` |

规则用**第 N+1 天那段所用商品**的配置（同一租户不同商品时以次日为准，`calc.productId` 记下）。

0. **最短套餐价**（审查第 5 条）：报价结果只带选中的那一档（`VehicleOffer`，`quote.ts:538-550`），引擎不给套餐列表。做法：直接从这次试算返回的 `preview.candidates[].product.priceRules`（`quotes.ts:279`）取，取过夜点所在①区域、这一车型组、按小时套餐里时长最短那档的结算价；过夜点不在任何①时取这个商品所有①里最低的。取不到 → 停驻只用 `perDayMinor`，第二司机按 `fixed`（没配 → 这一天 `unquoted` `SECOND_DRIVER_PRICE_UNAVAILABLE`）。`calc` 记 `areaId`、`priceRuleId`、`packageHours`。不另发报价请求。
1. **住宿（3.1）**：一车到底方案里，第 N 晚——第 N 天结束点和第 N+1 天开始点**都不在**这个商品任一①基础价区域里，且第 N+1 天还是同一辆车 → 一笔住宿费；过夜点落在 `byArea` 的区域（**只认本商品的区域**）取区域金额，否则 `perNightMinor`。客人提供住宿（`driverLodgingProvided`）→ 记 0。中间夹空闲日时，空闲日那晚照样算。①判断用 M9P-06（基础价区域优先，#247 已合并部署）之后的区域层级，直接用。
   - **和③空驶加价不重复收**（审查第 9 条）：过夜点在③时，引擎已在第 N 天收了③下车加价、第 N+1 天收了③上车加价（车往返基地的空驶）。`offsetSurcharges` 开（默认开）时，收住宿就记一笔 `lodging_offset`（负数）= 这两笔③加价的结算价之和（取两段结算明细的 `settlement.areaSurcharge`，`quote.ts:403`；只有带下车点的包车报价才有这一项，且是调价前的金额，抵扣也按调价前金额，`calc` 注明），然后和「不收住宿、保留两笔③加价」（车回基地）比较，**取对客总价低的那种**。`calc` 记两种做法的金额。口径已由监工确认（D4）；业主以后要改只改 `offsetSurcharges` 配置。
2. **多日停驻（3.3）**：一车到底方案里，两个用车日之间的空闲日，每天比两种做法取低：
   - a. 车留在当地：停驻费 `min(perDayMinor, 最短套餐价)`（`orShortestPackage` 开时）+ 当晚住宿（第 1 条）；
   - b. 车回基地再来：过夜点在①里 → 不收停驻、不收住宿；过夜点在③ → 回基地的空驶已经由前后两天的③加价覆盖，不另收；过夜点在①③以外 → b 要两段返程，返程不接入编排（第 4 条），只用 a。
3. **工时与第二司机（3.4、3.7）**（审查第 7 条重写）：
   - **拘束分钟** = 当天首段开始到末段结束（含段间空档）+ 出入库（当天起点在①里 `garageMinutes`，否则 `awayGarageMinutes`；终点同理各算一次）。包车段的结束 = 开始 + 预计用时 T（`itinerary.estimatedMinutes`）；接送机、点对点 = 开始 + 免费等待 + 路线行驶分钟。
   - **驾驶分钟** = 当天各段路线**行驶分钟**之和（不含停留；明细里的 `routeMinutes` 含停留，不用）；**公里** = 路线米数之和。
   - **休息** = 次日拘束开始 − 当日拘束结束（两边都已含出入库）。
   - 超 `maxBindMinutes`（13 h）、或驾驶超 `maxDriveMinutes`（9 h）、或公里超 `maxDailyKm`（600）→ 当天加**第二司机**；两天之间休息少于 `minRestMinutes`（11 h）→ **次日**加第二司机（费用记在次日）。`secondDriver.enabled` 时加一笔第二司机费，告警 `SECOND_DRIVER`；没开 → 这一天 `unquoted`（`WORK_HOURS_EXCEEDED`）。加了第二司机之后驾驶分钟、公里**不再设上限**（两人轮换），拘束仍受硬上限。
   - 超 `hardMaxBindMinutes`（15 h）或休息少于 `absoluteMinRestMinutes`（9 h）→ 第二司机也不行，`unquoted`（`WORK_HOURS_HARD_LIMIT`），告警里提示「可拆成两天或改坐新干线」（自动生成在 P1c 起）。
   - 引擎在单段 T 超 780 分钟时已经拒报（`ITINERARY_TOO_LONG`），编排器翻成同一原因。所以「13–15 小时加第二司机」**只在加上出入库、或一天多段时出现**；固定测试集至少各一条（T = 720 + 出入库 120；接机 + 包车两段合计超 13 h）。
   - `daily_best` 只按单日检查。
4. **长途返程（3.2）**：纯函数 `returnFee({ returnKm, overKmPerKmMinor, ratioBp, fixedByCityMinor, maxOneWayKm })` = `min(返程公里 × 超公里单价 × ratioBp / 10000, 城市固定表)`（只取有配置的项，`D/money.ts` 统一取整），超 `maxOneWayKm` → 转人工。**P1 编排不调用**：返程只在一车到底最后停在这个商品①③以外时成立（`charterMatches` 要求上下车点都在①③里，`packages/domain/src/charter-match.ts:19-23`），那一天引擎报不出价，方案已进 `unquoted`（`CROSS_CITY_ONE_CAR_NOT_AVAILABLE`）。**不在 P1a 另造触发条件**。监工若要求 P1 就能出返程，唯一可行的是把 P1d 的「末日代理请求 + returnFee」切片前移（要带上代表点定义，约多 5 人日，且要先给 `previewPlatformQuote` 加 `productIds` 过滤，见 D1）——见阻塞项 B3。
5. **附加项去重**（设计篇第四节第 9 条）：`bundleAddons.enabled`（默认开）时，一车到底方案里儿童座椅等「按次」附加项从第二个同车段起，每段记一笔等额 `bundle_discount`（负数）抵掉；金额从该段引擎明细的附加项行取。按件 / 按人 / 按时长的照收。
6. **对客价**（审查第 6 条重写）：每笔跨段费用按**它所属那一天、那个商品、那个车型组的包车段**（没有包车段时用当天这辆车的任一段）的 `markup_bp` 和 `fx` 换成对外价：用 `D/money.ts` 的同一取整，**不套渠道最低毛利、不按渠道取整单位取整**（这两项是按「一单」设计的，已在段价里收过）。负数费用同样换算。整个行程只有一个币种（渠道结算币种）。
7. 所有费用带算式快照 `calc`（例：`{ rule: "lodging", night: 1, areaId, perNightMinor, source: "byArea", productId }`）。

## 五、规则配置接口

- `PUT /tenant/v1/products/:id/trip-rules`：整体替换 `config`，带商品版本号（`If-Match`），成功后商品版本号加一、`version` 加一、写审计。只有包车商品能配（别的品类 400 `TRIP_RULES_NOT_APPLICABLE`）。
- 校验（domain `tripRuleIssues`）：金额 0 – 10 亿；比例 0 – 10000 基点；分钟 0 – 2880 且 `maxBindMinutes ≤ hardMaxBindMinutes`、`absoluteMinRestMinutes ≤ minRestMinutes`；`byArea` 最多 50 条、区域必须是**本商品**的区域、不重复；`fixedByCity` 最多 50 条、城市是平台启用城市。
- `GET` 返回「保存的值 + 默认值合并后的生效值」。
- 租户 A 读不到、改不了 B 的（集成测试）；返回里只有结算价。

## 六、和现有代码的边界

| 现有 | 用法 | 改不改 |
| --- | --- | --- |
| `previewPlatformQuote`（`services/quotes.ts:301`） | 每段报价 | 不改 |
| `charterCityFor`、`itineraryRoute`（`services/site.ts:706,606`）、`demandFacts`（`services/sales-quotes.ts:334`）、`pointToPointCityOf` | 包车段找城市、估路线、未覆盖需求事实、接送机回落点对点 | B2（已放行）：只加 `export`，不改函数体；补测试保证官网询价行为不变 |
| 候选目录（`candidate.product.priceRules`） | 最短套餐价 | 只读 |
| `recordUncoveredDemandLater` | 报不出的段记未覆盖需求（条件照官网） | 不改 |
| `requireOpenSite`、`takeSiteSlot`、`SALES_RATE_LIMITS` | 渠道、限频 | 加三个键 `site_trip`、`site_trip_quote`、`site_trip_quote_day`（新增键，不改已有键） |
| `locateInAreas`、`D/money.ts` | ①判断、取整 | 不改 |
| 迁移、表 | 0600 新增 5 张表 | 不改已有表 |

## 七、验收标准

1. 迁移 0600：5 张表、约束、行级安全、授权登记；租户隔离集成测试（规则配置）；迁移测试。
2. **`daily_best`** 的每一段对外价 = 同样条件调官网询价的中标价（集成测试逐段比对，接送机、点对点、包车各至少一条）。**`one_car`** 的每一段 = 同一次比价里该租户该车型组自己的对外价（集成测试断言取自同一结果）。
3. 编排找到的城市、路线、写出的未覆盖需求和官网询价一致（加 `export` 后官网询价行为不变也要测）；机场按坐标识别、接送机报不出回落点对点各至少一条。
4. 固定测试集（第八节）逐条比对：段型、拆法、每笔跨段费用（类型、晚次、金额，含负数抵扣）、方案数、推荐、`unquoted` 原因、`degraded`。
5. 规则单元测试：住宿（①内不收、①外收、`byArea`、空闲日那晚、客人提供、③抵扣取低）、停驻（取低、最短套餐取不到、③过夜）、工时（13 / 15 h 只经出入库或多段触发、11 / 9 h 休息记在次日、9 h 驾驶、600 km、加第二司机后不限公里、开 / 关）、附加项去重、返程函数（取低、超范围）。
6. 预算：构造 14 天 × 每天 4 种拆法，断言不 422；构造超预算，断言 `degraded: true`。
7. 现有询价、包车 golden、itinerary golden 0 条变化。
8. 对客应答没有结算价、加价比例、供应商编号（OpenAPI 断言）。
9. 独立审查、合并、部署后测试站验收（QA 测试供应商）。
10. 返程 = 函数 + 配置 + 单元测试；**接入编排随 P1d**（roadmap M9T goal 与此一致）。

## 八、固定测试集

原文第 7 节要「30 条真实客人需求」。仓库里没有真实客人数据（也不能放演示数据）：

- 在测试代码里构造 30 条（东京、大阪两城：接机 → 酒店、酒店 → 送机、当天游览、接机 + 下午游览、多日同城、夹空闲日、过夜在箱根 / 日光（①外）、过夜在③（抵扣）、客人提供住宿、超 13 h（经出入库 / 两段）、超 15 h、休息不足、人数超车型、某天无商品、机场日由别的供应商接（按段选车）、14 天降级、跨城市一车到底（`unquoted`）等），商品、区域、价格全部在测试里建、测完删。
- 每条写明期望。
- 业主日后给出去掉个人信息的真实需求时，逐条替换（Q1）。

## 九、阻塞项、偏离与待确认项

### 监工确认（2026-11-15）

1. **B2 放行**：给 `charterCityFor`、`itineraryRoute`（`site.ts`）、`demandFacts`（`sales-quotes.ts`）加 `export`，不改函数体；M9T-03 补一条测试，保证官网询价行为不变。下文 B2 的「备选」不再适用。
2. **B3 接受**：返程费 P1 只做函数、配置和单元测试，P1d 再接入报价。
3. **D1–D6 全部同意**，按第三稿做。D4 的口径定为：收住宿时用负数 `lodging_offset` 抵掉前后两天的③上下车空驶加价（调价前金额），再与「车回基地」（不收住宿、保留两笔③加价）比较，取对客总价低者；`lodging.offsetSurcharges` 默认开，业主以后要改只改配置。
4. **Q1–Q10 按默认值**（原文第 8 节 / 本节表）。
5. 依赖：M9P-06（#247）已合并并部署，M9T-01 的住宿①判断直接用。

### 阻塞项（已由监工确认，留作记录）

（第二稿的 B1「给 `previewPlatformQuote` 加 `productIds` 过滤」自己的推荐就是「暂不需要」，不算阻塞，第三稿并进偏离 D1；P1d 代理请求时再提。）

| # | 问题 | 推荐 | 备选（未确认时实际做法） |
| --- | --- | --- | --- |
| B2 | `site.ts` 的 `charterCityFor`、`itineraryRoute`，`sales-quotes.ts` 的 `demandFacts` 加 `export`（不改函数体） | 放行，避免两份逻辑 | （已放行，不再适用） |
| B3 | 返程 P1 只做函数 + 配置 + 单测、不接入编排 | 接受 | （已接受，不再适用） |

### 和设计篇 / 原文的偏离（监工 2026-11-15 已全部同意）

| # | 设计篇 / 原文 | 本篇 | 原因 |
| --- | --- | --- | --- |
| D1 | 一车到底 = 同一商品 | 同一租户 × 车型组 | 现有比价每车型组每租户只留一个；要按商品取全得给 `previewPlatformQuote` 加 `productIds` 过滤（设计篇第五节第 5 小节第 4 条），P1 不做，P1d 再提 |
| D2 | 原文 3.3 按段选车 | 机场日 / 点对点日的处理按第三节第 6 小节三级规则 | 段品类不同，不可能同一商品 |
| D3 | 设计篇 P1a 含「拆成两天」备选 | 只给提示，不自动生成 | 要替客人选中途过夜地，P1 没有地图 / AI |
| D4 | 住宿与③加价 | 收住宿时负数抵掉③空驶加价，再与「车回基地」取低 | 不重复收（审查第 9 条）；口径已确认，业主要改只改配置 |
| D5 | 设计篇 `trips.expires_at` | 拆成 `trips.readable_until` 和 `trip_plans.expires_at` | 一列两用会挡住重报价 |
| D6 | 设计篇第九节：行程特有原因记 `OTHER`，细分原因记 `trip_handoffs.reason`，运营后台加「行程原因」筛选 | P1 只按段照官网记（主原因由引擎推）；行程特有原因不记，`trip_handoffs` 和筛选随 P3 | `recordUncoveredDemandLater` 不能指定原因；改它要改现有函数入参 |

（第一稿的「推荐门槛 3%」「不记未覆盖需求」「漏客人提供住宿」「漏附加项去重」已改回与设计篇一致，不再是偏离。）

### 待确认项（先按默认值做，监工 / 业主可改）

| # | 问题 | 采用的答案 |
| --- | --- | --- |
| Q1 | 30 条真实客人需求从哪来？ | 先在测试代码里构造（第八节），业主给真实脱敏需求后替换 |
| Q2 | 默认值 | 原文第 8 节 / 设计篇第十一节：住宿 ¥15,000 / 车 / 晚（`byArea` 可单独设）；停驻 ¥10,000 / 天与最短套餐取低；第二司机 = 最短套餐结算价；拘束 13 h（上限 15 h）、休息 11 h（至少 9 h）、驾驶 9 h、单日 600 km；出入库 60 分钟（外地 15 分钟）；返程单价 = 超公里单价 × 50%、单程 ≤ 600 km；附加项去重开。金额是结算价，供应商可改 |
| Q3 | 默认值的币种 | 按日元写；商品结算币种不是日元时，默认住宿 / 停驻不生效、只用供应商填的值 |
| Q4 | 住宿与③加价抵扣 | 默认开（第四节第 1 条，D4 已确认）；业主要改只改配置 |
| Q5 | 段报价落不落 `quotes` | P1 不落（试算），P1b 下单前再走正式询价 |
| Q6 | 推荐门槛 | 设计篇 10%（平台常量） |
| Q7 | 限频与预算 | 三个键：`site_trip` 每分钟 10 次；`site_trip_quote` 每分钟 5 次；`site_trip_quote_day` 每天 50 次。段报价 120 次、路线 200 次 / 编排 |
| Q8 | 航班号、司机语言 | P1 都不收；航班号随 P3 按 ADR 0097，司机语言 P3 再议 |
| Q9 | 设计篇（ADR 0094）还在审 | 本篇只用 P1a 部分；设计篇有改动时本篇跟着改 |
| Q10 | P1b / P3 给本篇新建的表加列、改 `status` 约束 | 不算「改现有表」（新表是本车道建的），监工已确认 |

## 十、实施任务与工作量

| 任务 | 内容 | 依赖 | 人日 |
| --- | --- | --- | --- |
| M9T-00 | 本 ADR、roadmap | — | 1 |
| M9T-01 | domain `trip/`：行程单校验、分段、拆法、四类规则 + 附加项去重、最短套餐价、方案组装、规则配置校验；单元测试 | M9T-00；住宿①判断 M9P-06 | 6–7 |
| M9T-02 | 迁移 0600、迁移测试、规则配置接口、租户隔离测试、OpenAPI | M9T-00 | 3 |
| M9T-03 | 编排接口、逐段报价、城市 / 路线（B2）、预算降级、未覆盖需求、限频、日志、OpenAPI、集成测试 | M9T-01、M9T-02 | 6–7 |
| M9T-04 | 固定测试集 30 条、测试站验收 | M9T-03 | 3 |
| M9T-05 | 行程单清理任务（`readable_until` 后删行程与方案） | M9T-02 | 1 |
| **合计** | | | **20–22 人日** |

每个任务一个 PR（分支 `m9t-*`，标题以 `[M9T]` 开头），各自独立审查、CI 全绿后合并。

## 十一、风险

1. **包车引擎在 M9P 车道持续变化**：编排器只调用、不复制逻辑（B2 放行后直接调用官网函数，不留副本）；固定测试集期望金额可能随 M9P 改动更新。
2. **调用量**：预算 + 降级 + 独立限频；路线仍受全站每日上限，上线后看日志调。
3. **一车到底挑不出**：不同日子落在不同城市时没有能报全部用车日的租户——这正是 P1d 要解决的，P1 进 `unquoted`。
4. **设计篇未定稿**：数据模型只取 P1a 部分，以后以新迁移追加，不回改 0600。

## 十二、补记（2026-11-17 / 11-18）

### 1. 业主确认：单日行程只出一车到底（11-18）

- **问题**（M9T-04 固定测试集第 4b 条）：单日「成田接机 + 下午游览」。包车商品不含成田，又没有一家能连着做接机和包车时，单日只出 `one_car`，整天报不出。
- **业主决定（2026-11-18，经监工在 #288 转达）：选 A，保持现行规则。**单日只出「同一辆车做完全天」的方案（第三节第 6 小节不变），报不出就转人工；不做「接机一家 + 包车另一家」。

### 2. 报不出时转人工的出口（P1 没有，随官网页面做）

- **P1 现状**：报价应答在 `unquoted` 里逐条给出方案、哪一天、原因码；没有直接连到人工报价。官网现有的人工报价申请（`POST /site/v1/manual-quote-requests`，ADR 0076）只收单程（一段），收不下多日行程，客服也看不到整张行程单。
- **规定（做 AI 行程报价官网页面时一起实施）**：
  1. 报价应答加 `manual_quote_suggested: boolean`：所有方案都报不出（`plans` 为空）时为 `true`；页面据此显示「转人工报价」，不让客人自己猜。
  2. 人工报价申请加可选的 `trip_id`：页面带上行程单编号，`trip` 填第一天的行程；运营后台人工报价详情凭 `trip_id` 显示整张行程单（每天的点、时间、报不出的原因）。行程单 30 天后清理（M9T-05），详情只在这之前能看到行程。
  3. 只是部分方案报不出（例如一车到底报不出、每天各自最优报得出）时不建议转人工，页面照常展示报得出的方案，并写明另一个方案为什么没有。

### 3. 固定测试集发现的两处实现偏差（11-17，#298 已修，正文规则不变）

- 住宿按区域定价（`byArea`）实现时只和①比对；收住宿的前提就是过夜点不在①，所以永远用不上。按本篇第四节第 1 条「过夜点落在 `byArea` 的区域（只认本商品的区域）」，改为①和③②都认。
- 跨城市一车到底是 P1d（第一节），实现时没有拦下；改为这种组合报不出 `CROSS_CITY_ONE_CAR`，只给每天各自最优。

## 十三、官网行程报价页（M9T-06～M9T-10，2026-11-18）

监工 2026-11-18 指派「AI 行程报价官网页面」（计划见 #288）。本节补记页面范围，以及第十二节第 2 小节「转人工出口」落地时的数据做法和下单出口。仍守本篇硬约束：**只新增表、新增接口，不给现有表加列**。

### 1. 范围（M9T-09）

- **新页面 `/book/trip`**：按天填写行程（每天一个编辑块：日期、上车时间、按顺序的点，可增删天、增删点），然后「建行程单 → 报价 → 两个方案对比」，即依次调用 `POST /site/v1/trips`、`POST /site/v1/trips/:id/quote`，结果按方案（`one_car` / `daily_best`）并排展示每天的段、价格和推荐标记。
- **样式跟 `/book/new` 一致**：桌面端左右两栏（左边填写 / 结果，右边地图，每天一张带编号点的地图）；≤1023px 时改为单栏 + 底部步骤条（ADR 0100 手机底部按钮条的做法）。
- **文案**：页面全部对客文案列在本节文末「文案表」，实现时以表为准，改文案先改表。
- **不做**：嵌入（embed）版行程页不在本次范围；官网首页、`/book/new` 等处**验收通过前不加入口链接**，只能直接打开地址访问。
- **报不出时**：
  - 全部方案报不出（`manual_quote_suggested: true`，M9T-07）：页面不展示方案，直接给「转人工报价」，带上行程单（第 2 小节）。
  - 部分报不出：照常展示报得出的方案，并按 `unquoted` 的原因码写明另一个方案为什么没有（第十二节第 2 小节第 3 条）。

### 2. 人工报价关联行程单（M9T-08）

第十二节第 2 小节第 2 条写的是「人工报价申请加可选的 `trip_id`」。落地时**不给 `manual_quote_requests` 加列**，改为：

- **新表 `manual_quote_trip_links`**（新迁移）：`request_id`（主键，外键 → `manual_quote_requests(id)`，`ON DELETE CASCADE`）、`trip_id`（text）、`plan_kind`（可空）、`created_at`（迁移 0610）。
  - `trip_id` **不加外键到 `trips`**：行程单 30 天后由 M9T-05 清理删除，人工报价申请的保留期更长（ADR 0076），外键会挡住清理或级联删掉关联。行程单被清理后关联行留着，只是查不到行程。
  - 和 `manual_quote_requests` 同为平台表（无租户列、不开行级安全），读写权限照人工报价现有口径；schema 结构测试登记。
- **请求**：`POST /site/v1/manual-quote-requests` 收可选的 `trip_id`、`plan_kind`（`one_car` / `daily_best`，可空）和 `trip_labels`（各点在客人页面上的名称，见下一条；只在带 `trip_id` 时可给）；`trip_id` 必须是本渠道、未过期、验收标记一致的行程单，否则 **400 `VALIDATION_FAILED`、`/trip_id` NOT_FOUND**——行程单不存在、已过期、属于别的渠道、验收标记对不上、编号格式不对都是同一个回答，不说是哪一种，也不回显编号（M9T-08 落地口径）。`trip` 照现有规定填第一天的行程，现有校验、去重、限频不变；不带 `trip_id` 时行为和现在完全一样。
- **地点名称**：运营要看整张行程单的地名，但行程单里的地名会随 30 天清理消失。提交时把每天的点的显示名称放进现有加密联系信息 JSON（`contact_enc`）的新键 `trip_labels`（按天、按点顺序的数组），和联系方式、上下车点一起加密，**保留期、清除方式与现有联系信息完全相同**（ADR 0076 到期清除时一并清空）。不另建明文列。
- **运营后台人工报价详情**：应答**不返回 `trip_id`**（客人访问行程单的凭证，数据最少；也不写日志、不进审计）。有关联时显示「整张行程单」——每天的日期、时间、点（名称取 `trip_labels`，结构取行程单）、客人选的方案（`plan_kind`）、每天报不出的原因；行程单已被清理时显示「行程单已清理」，仍显示 `trip_labels` 里的地名（联系信息已清除时则都不显示）。

### 3. 下单出口（M9T-10）

行程下单与一次付款是 P1b（第一节，另写付款 ADR）。页面先按方案的段数分两种：

- **单段方案**（整个方案只有一段，例如单日一车到底）：新增桥接接口 **`POST /site/v1/trips/{id}/plans/{planId}/order-quote`**，用这段的报价条件生成一张**普通官网报价（SiteQuote）**，价格必须与方案里这一段的对外价一致（不一致时 409，让客人重新报价）；之后完全走现有下单、付款流程（`/book/new` 的乘客信息、下单、Stripe），不新增付款代码。
- **多段方案**：**待业主决定**（已在 #288 提出）：
  - **A（推荐，正在按此做）**：按钮「提交预订，客服确认」，等于带 `trip_id` + `plan_kind` 的人工报价申请（第 2 小节），客服确认后在现有人工报价流程里成单；P1b 上线后改为直接下单。
  - **B**：多段方案先只展示、不提供预订，等 P1b。
  - **C（不采用）**：多段方案拆成多张普通订单各自付款——ADR 0094 规定行程订单「多张子订单、一次付款」，已否决。
- 业主选 B 时，M9T-10 只做单段方案，多段方案的按钮去掉；选 A 以外的做法不影响第 1、2 小节。

### 4. 拆分

| 任务 | 内容 |
| --- | --- |
| M9T-06 | 本节补记、roadmap（只有文档） |
| M9T-07 | 报价应答加 `manual_quote_suggested` |
| M9T-08 | `manual_quote_trip_links`、人工报价申请带 `trip_id` / `plan_kind`、`trip_labels`、运营后台显示整张行程单 |
| M9T-09 | `/book/trip` 页面：填写、报价、方案对比、转人工 |
| M9T-10 | 单段方案桥接下单付款；多段方案按业主决定 |

### 文案表（M9T-09 实现时以此为准）

| 键 | 文案 |
| --- | --- |
| `trip.title` | 多日行程报价 |
| `trip.day` | 第 {n} 天 |
| `trip.addDay` | 加一天 |
| `trip.addStop` | 加一个地点 |
| `trip.quote` | 查看报价 |
| `trip.plan.one_car` | 同一辆车跑完全程 |
| `trip.plan.daily_best` | 每天选最划算的车 |
| `trip.recommended` | 推荐 |
| `trip.unquoted` | 这个方案暂时报不出：{reason} |
| `trip.manual.title` | 这个行程需要客服人工报价 |
| `trip.manual.cta` | 转人工报价 |
| `trip.book` | 预订这个方案 |
| `trip.bookManual` | 提交预订，客服确认 |

---

## 修改记录

### 补记第十三节（2026-11-18，M9T-06）

监工 2026-11-18 指派官网行程报价页：补第十三节——页面范围、人工报价关联行程单改用新表 `manual_quote_trip_links`（守「不给现有表加列」，细化第十二节第 2 小节第 2 条）、地名放进加密联系信息、下单出口（单段方案桥接普通报价；多段方案待业主决定）；拆 M9T-06～10。

### 定稿（监工确认后，对应第三次复核）

记录监工 2026-11-15 确认；正文里所有「等监工确认 / 未放行时另写副本 / 请业主确认口径」改为已确认的写法；未覆盖需求的记录范围补上单日行程（看 `one_car` 的段）；M9P-06 改为已合并。

### 第三稿（对应第二稿复核）

| 复核 | 处理 |
| --- | --- |
| M1 未覆盖需求 | 编排器自己调 `recordUncoveredDemandLater`，事实由 `demandFacts` 拼（并进 B2）；排除验收会话、`onlyTooShort`、回落那次；只记 `daily_best` 段；不能指定 `OTHER`，行程特有原因 P1 不记（D6），删去与跨城矛盾的表述 |
| M2 官网等价 | 机场按 `placeId` 或坐标识别；接送机报不出回落点对点（同 `site.ts:982-995`）；验收第 3 条加两条测试 |
| M3 限频 | 一个键一个时间窗，改为三个键（`site_trip_quote_day` 管每天 50 次）；第六节、Q7 同步 |
| 建议 | 引 `sales-quotes.ts:258-282`；路线预算口径与放大倍数理由；B1 并进 D1；D6 列入偏离；非中标价来源 `quote.ts:1745`；套餐价直接取 `preview.candidates`；③抵扣取 `settlement.areaSurcharge`（调价前） |

### 第二稿（对应 PR #263 第一次独立审查）

| 审查 | 处理 |
| --- | --- |
| 1 返程 | B3 改为阻塞项；验收第 10 条、roadmap goal 写明「函数 + 配置 + 单测，接入随 P1d」；不另造触发条件 |
| 2 拿不到全部候选商品 | 粒度改为租户 × 车型组（D1），B1 列为可选；验收第 2 条分 `daily_best` / `one_car` |
| 3 一车到底与段品类 | 第三节第 6 小节三级规则（D2） |
| 4 和官网等价的入参 | 币种固定渠道结算币种，不收司机语言，车型组只在结果上过滤；`charterCityFor` / `itineraryRoute` 走 B2；行号更正（`site.ts:606`、`routes/site.ts:327`） |
| 5 最短套餐价 | 第四节第 0 条：只读候选目录价格规则，写明取哪个① |
| 6 跨段费用对外价 | 第四节第 6 条：按所属那天那个商品那个车型组的 `markup_bp`、`fx`，不套最低毛利和取整单位 |
| 7 工时算法 | 第四节第 3 条重写（首末段跨度 + 出入库、行驶分钟、一口价路线自估、第二司机后不限公里、费用记次日、13–15 h 只经出入库 / 多段触发并入测试集） |
| 8 调用上限与限频 | 段报价 120 / 路线 200 预算，超出降级不 422；新档 `site_trip_quote` |
| 9 住宿和③加价重复 | `lodging_offset` 负数抵扣再与车回基地取低（D4、Q4） |
| 10 与设计篇不一致 | 推荐门槛改回 10%；加客人提供住宿抵免；加附加项去重；未覆盖需求按设计篇记 `OTHER`；拆两天列偏离 D3 |
| 11 数据细节 | 行李上限 60；`expires_at` 拆两列；清理任务 M9T-05；M9T-01 `blockedBy` M9P-06 和 M9T-00 |
| 建议 | 采纳：43 字符随机编号、`is_acceptance`、列差异表、新表加列请确认（Q10）、`byArea` 限本商品、后续点时间推算、运营日志、规则配置页去向 |
