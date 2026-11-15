# ADR 0100：AI 行程报价 P1 后端——行程单、服务段、跨段费用、编排接口、四类跨段规则、方案对比（实施篇）

- 状态：**草案第一稿（2026-11-15）**。设计依据是 ADR 0094（M10-00，草案第四稿，在审）；本篇是它 P1 的**后端实施 ADR**，只写本车道要落地的部分和实施时才看得清的细节。
- 工作项：**M9T-00**（本篇）；实施 **M9T-01**（domain 编排与规则）、**M9T-02**（迁移 0600、规则配置接口）、**M9T-03**（编排接口）、**M9T-04**（固定测试集与验收）。
- 依据（冲突时按这个顺序）：
  1. 业主《NOZOMI AI 行程报价 · 设计方案（草案 v1）》`docs/requirements/ai-trip-quote-design-2026-11-14.md`（下称「原文」）；
  2. ADR 0094（下称「设计篇」）：数据模型、编排接口、规则配置键、分段判定、方案对比、第十一节默认值；
  3. ADR 0093（三层区域、按上下车点找商品、各商品自选套餐、13 小时拦截）、ADR 0091（预计用时 T）。
- 编号：main 上最大是 0096；0097（#255）、0098（#259 / #261）、0099（#260）已被未合并的 PR 占用，这里用 **0100**。数据库迁移按监工要求从 **0600** 起（0520 #261，0480～0510 其他车道）。
- **硬约束（原文第 0 节、监工 2026-11-15）**：只新增表、新增接口、新增模块；**不改现有报价接口、不改现有表**（不改 `quoteProduct`、`siteQuotes`、`previewPlatformQuote` 的入参与结果，不给现有表加列）。不碰包车（M9P）车道的文件。

---

## 〇、结论摘要

1. **本车道交付 = 设计篇 P1a（同城多日底层）+ 返程规则的纯函数**。不做行程下单与付款（P1b）、新干线方案（P1c）、跨城市一车到底（P1d）、地图（P2）、AI（P3–P5）。
2. **数据**：迁移 0600 新增 5 张表——平台表 `trips`、`trip_plans`、`trip_segments`、`trip_fees`，租户表 `trip_rule_configs`。P1 只收结构化输入、**不收自由文字**，所以不需要加密列（P3 再加）。
3. **接口**：`POST /site/v1/trips`、`GET /site/v1/trips/:id`、`POST /site/v1/trips/:id/quote`（官网渠道）；`GET/PUT /tenant/v1/products/:id/trip-rules`、`GET /platform/v1/products/:id/trip-rules`。
4. **每一段都经现有报价服务报价**：编排器调 `previewPlatformQuote`（`apps/api/src/services/quotes.ts:301`），按官网渠道的加价、汇率、比价规则算，**结果和客人单独查这一段的对外价一致**（同一函数、同一渠道）。编排器不算任何一段的价。
5. **四类跨段规则**（新模块 `packages/domain/src/trip/`，纯函数）：住宿、多日停驻、工时与第二司机、长途返程（返程在 P1 不会触发，见第四节第 4 条）。
6. **方案对比**：多日行程出「一车到底」（`one_car`，同一商品同一车型组贯穿）和「每天各自最优」（`daily_best`）两个方案；单日行程只出一个。
7. **待确认项按原文第 8 节 / 设计篇第十一节的默认值实施**（第九节逐条列出）。

---

## 一、范围

| 项 | 本车道 | 理由 / 去向 |
| --- | --- | --- |
| 行程单、方案、服务段、跨段费用、规则配置的数据模型 | ✅ | 设计篇第二节第 1 小节，只取 P1a 需要的 5 张表 |
| 标准行程单（`schemaVersion: 1`）校验与上限 | ✅ | 设计篇第二节第 3 小节；P1 只认坐标和平台地点编号 |
| 编排接口（只收结构化输入） | ✅ | 原文第 7 节 P1 |
| 分段判定、同一天合并比价 | ✅（不含机场套餐拆法） | 机场开始 / 结束套餐（M9P-09 / #261）合并后再加进拆法候选，见第三节第 3 小节 |
| 住宿、多日停驻、工时 + 第二司机、单日上限与备选 | ✅ | 原文 3.1、3.3、3.4、3.7「单日上限」 |
| 长途返程 | 纯函数 + 配置 ✅；编排里**不会触发** | 返程只在车开到①③以外结束时成立，那种日子现有引擎报不出价（设计篇第三节第 3 小节「异地日」），要等 P1d 的代理请求 |
| 方案对比 | ✅ `one_car` / `daily_best` | `local_cars`、`shinkansen`、`one_car_then_local` 在 P1c / P1d |
| 行程下单、一次付款、行程报价编号 `trip_quotes` | ❌ | P1b，另写付款 ADR |
| 新干线站点、铁路参考表、长途档位价、高速费 | ❌ | P1c / P1d |

## 二、数据模型（迁移 0600，只新增）

行程单跨供应商，是**平台表**（不带 `tenant_id`，供应商读不到，同 `quotes`）；规则配置属于供应商的商品，是**租户表**（带 `tenant_id`、行级安全、租户隔离集成测试，CLAUDE.md 第 2 条）。

| 表 | 归属 | 列（P1） | 说明 |
| --- | --- | --- | --- |
| `trips` | 平台 | `id`（`TR` + 本地日期 + 12 位随机，客人凭它访问）、`channel_id`、`source`（P1 只有 `form`）、`status`（`draft / quoted / expired`）、`itinerary`（标准行程单 JSON）、`currency`（客人支付币种）、`created_at`、`updated_at`、`expires_at` | P1 没有自由文字列；设计篇的 `raw_input_enc`、`texts_enc`、`ai_meta` 等在 P3 以新迁移加列 |
| `trip_plans` | 平台 | `id`、`trip_id`、`seq`、`kind`（`one_car / daily_best`）、`recommended`、`vehicle_group_id`（`one_car` 用的车型组；`daily_best` 为空）、`product_id`（`one_car` 用的商品）、`sell_minor`、`currency`、`status`（`quoted / unquoted`）、`unquoted`（原因列表 JSON）、`warnings`、`quoted_at`、`expires_at` | 一次报价重写这一行程的全部方案（先删后插，见第三节第 6 小节） |
| `trip_segments` | 平台 | `id`、`plan_id`、`seq`、`day_index`、`service_date`、`segment_type`（`airport_pickup / airport_dropoff / p2p / charter / idle_day`）、`start_local`、`end_local`、`points`（起点、经停和停留、终点 JSON）、`category`、`city_id`、`product_id`、`tenant_id`（钱给谁，只给平台看）、`vehicle_group_id`、`package_hours`、`settlement_minor`、`settlement_currency`、`sell_minor`、`breakdown`（引擎明细快照）、`route`（米、分钟） | `quote_id`、`order_id` 在 P1b 以新迁移加列（P1 不写 `quotes`，见第三节第 5 小节） |
| `trip_fees` | 平台 | `id`、`plan_id`、`seq`、`fee_type`（`lodging / idle / second_driver / return`）、`tenant_id`、`product_id`、`rule_version`、`settlement_minor`、`settlement_currency`、`sell_minor`、`night_index`、`day_index`、`area_id`、`label`（明细文字）、`calc`（算式快照 JSON） | 时间类加价不在这里，每段自带（设计篇第四节第 10 条） |
| `trip_rule_configs` | **租户** | `tenant_id`、`product_id`、`version`、`config`（JSON，第四节）、`updated_at` | 主键 `(tenant_id, product_id)`；没有这一行 = 全部用默认值（第九节）。`version` 每次保存加一，写进 `trip_fees.rule_version` |

- 平台表只授权给 `nozomi_platform`（编排接口在平台事务里写）；`trip_rule_configs` 授权给 `nozomi_app`（读写）和 `nozomi_platform`（只读），登记 `schema-structure.itest.ts`、`rls.itest.ts`。
- 外键：`trip_plans → trips`、`trip_segments → trip_plans`、`trip_fees → trip_plans` 都 `on delete cascade`（只在同一事务里重写方案时删）；`trip_rule_configs (tenant_id, product_id) → products` `on delete cascade`。`trip_segments.product_id` / `tenant_id` **不设外键**：段是报价时的快照，商品后来删了，快照照留。
- **没有演示数据**：迁移里不写任何行；默认值写在 domain 常量里（第九节）。
- **保留期**：`trips` 只存结构化行程（坐标、时间、人数），不含姓名电话。P1 不做清理任务，`expires_at` 后只读；P3 引入原文时再按设计篇第八节第 6 小节加 30 天清理。

### 标准行程单（P1 子集）

沿用设计篇第二节第 3 小节的结构，P1 收紧为：

```jsonc
{
  "schemaVersion": 1,
  "party": { "adults": 4, "children": 0, "luggage": 3 },
  "preferences": { "vehicleGroupIds": [], "driverLanguage": null, "addons": [] },
  "days": [
    { "date": "2027-03-28",
      "items": [
        { "kind": "arrive_flight", "place": { "placeId": "<机场>" }, "time": "14:30" },
        { "kind": "stop", "place": { "lat": 35.69, "lng": 139.70, "kind": "hotel" }, "stayMinutes": 0 }
      ],
      "nightAt": { "lat": 35.69, "lng": 139.70 } }
  ]
}
```

- `place` 只能是平台地点（`placeId`，机场 / 车站）或坐标（`lat`、`lng`，可带 `kind: hotel / poi / address`）。谷歌地点编号、名称解析在 P3。
- `items[0]` 是当天起点（`arrive_flight` / `start`，必须带 `time`），之后是 `stop`（停留分钟 0–720）和最后的 `end`（可选 `kind: depart_flight`，机场）。
- **不收**：`note`、`notes`、航班号、`provenance`（P1 全部是客人填的）。航班号只在接机段用于免费等待（ADR 0097），P1 接机段按商品自己的免费等待报。
- 上限（服务端 zod 和 domain 共用一组常量，设计篇第二节第 3 小节）：14 天、每天 12 个点、全程 60 个不同地点、附加项 10 个；人数 1–60、行李 0–99。
- 日期连续性：P1 要求 `days` 按日期升序、不重复；中间可以有空的一天（`items` 为空 = 空闲日，见第四节第 2 条）。

## 三、编排接口与算法

### 1. 接口

| 接口 | 说明 |
| --- | --- |
| `POST /site/v1/trips` | 校验标准行程单（第二节），存为 `draft`，返回 `trip_id`。同一 IP 限频（新加一档 `site_trip`，额度同 `site_quote`） |
| `GET /site/v1/trips/:id` | 行程单和最近一次报价的方案（过期的标 `expired`）。凭行程单编号访问，和 `booking_drafts` 一样不要登录 |
| `POST /site/v1/trips/:id/quote` | 编排 + 分段报价 + 跨段费用 + 方案对比，写方案、段、费用，返回第 2 小节的结构。限频同 `site_quote` |
| `GET / PUT /tenant/v1/products/:id/trip-rules` | 供应商读、改这个商品的跨段规则（第四节），带商品版本号乐观锁、写审计；只有结算价 |
| `GET /platform/v1/products/:id/trip-rules` | 运营只读 |

- 渠道：用官网渠道（`requireOpenSite`），授权城市、品类、供应商名单和官网询价完全一样；验收会话（ADR 0078）同样只报 QA 测试供应商。
- `tenant_id` 不出现在任何入参里；对客应答不含结算价、加价比例、供应商编号（规则 4）。

### 2. 应答

```jsonc
{
  "trip_id": "TR…", "currency": "JPY", "expires_at": "…",   // 所有方案里最早到期的段报价
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
  "unquoted": [ { "plan_kind": "one_car", "day_index": 3, "reason": "WORK_HOURS_HARD_LIMIT" } ]
}
```

金额是客人支付币种的最小单位整数；明细项沿用官网询价的 `price_breakdown`（`apps/api/src/routes/site.ts:306`）。

### 3. 分段判定（设计篇第三节第 3 小节）

每天把点排成 `P0 → … → Pn`（`P0` = 当天起点，`Pn` = 当天终点；没写终点时 = 当晚 `nightAt`）：

1. `n = 1`、`P0` 是机场 → **接机**（接送机，`direction: pickup`）；
2. `n = 1`、`Pn` 是机场 → **送机**；
3. `n = 1`、两端都不是机场、不停留 → **点对点**；
4. 有经停或停留 → **包车**（按行程计价，`charterSelection: "auto"`，每个商品在引擎里按自己的 T 选档）；`P0` 或 `Pn` 是机场时**另试**「接机 + 包车」「包车 + 送机」拆法（第 4 小节）；
5. `items` 为空 → **空闲日**（`idle_day`，只可能挂停驻费）。

机场开始 / 结束套餐（M9P-09，#261）合并后，包车段的引擎会自己匹配机场场景（同一商品内替换普通套餐），编排器不用改；「接机 + 包车」和「机场开始包车」的比价由第 4 小节的拆法比较自然完成。

### 4. 同一天合并比价（设计篇第三节第 4 小节）

- 拆点只在自然断点：机场、车站、`kind: hotel` 的点、停留 ≥ 60 分钟（`splitStayMinutes`，平台常量）的点。每天最多 4 种拆法（含「不拆」），超出只留「不拆」和「在第一个酒店拆」。
- 每种拆法的每一段都单独报价；同一天取**总价低**的拆法，一样时取段数少的。
- 一车到底方案里，「拆」只在同一商品、同一车型组内比较（第 6 小节）。

### 5. 每一段怎么报价

- **调用**：`previewPlatformQuote(ctx, input, { fresh: false, audience })`，`channelId` = 官网渠道、`currency` = 行程单币种。它和官网询价用同一个候选目录缓存、同一套加价 / 汇率 / 比价（`compareQuotes`），返回**所有候选商品**每个车型组的对外价和结算价——一车到底要按商品挑（第 6 小节），只拿中标价不够。
- **城市**：接送机按机场的城市；点对点、包车按上下车点找城市，和官网包车同一判断（`loadCharterCityCandidates` + `charterMatches` + `chooseCharterCity`，`packages/domain/src/charter-match.ts:19,34`；点对点按上车点所在的服务城市）。
- **包车行程**：经停点、停留、全程米数和分钟由服务器逐段估路线（现有 `ctx.quote.routes.estimate`，有缓存和每日上限），同官网 `itineraryRoute`（`apps/api/src/services/site.ts:605`）；取不到路线 → 这一段报不出（`ROUTE_UNAVAILABLE`），整个方案进 `unquoted`。
- **不写 `quotes`**：P1 不能下单，段报价只是展示，用试算（不落库）避免每次编排写几十条 30 分钟后作废的报价行。P1b 下单前对选中的方案逐段走正式询价（`siteQuotes`）落报价、写 `trip_segments.quote_id`，总价变了按设计篇第五节第 3 小节先给客人看新旧对比。
- **调用量上限**：一次编排最多 60 次段报价（14 天 × 每天至多 4 种拆法 + 余量），超出直接 422 `TRIP_TOO_COMPLEX`。同一对上下车点、同一时间的段在一次编排里只报一次（内存缓存）。
- **未覆盖需求**：P1 不记。编排里的段报价是试算，不是客人的一次询价；现有 `uncovered_demands` 的品类只能是三种单品（`0290_area_roles_uncovered_demands.sql:60`），行程级的转人工记录按设计篇第九节放到 P3 的 `trip_handoffs`（待确认 Q6）。

### 6. 方案（设计篇第三节第 5 小节，P1 子集）

| 方案 | 何时出 | 组成 |
| --- | --- | --- |
| `one_car` 一车到底 | 有 2 天以上用车时总是尝试；单日行程只出它 | **同一商品、同一车型组**贯穿全部用车日：对每个「能报出全部用车日」的商品 × 车型组，按天取它自己的最低拆法，加上它的跨段费用（住宿、停驻、第二司机），取总价最低的商品 × 车型组。车型组要容得下人数行李 |
| `daily_best` 每天各自最优 | 2 天以上用车时 | 每天独立取当天最便宜的拆法和中标商品（可不同供应商、不同车型组）；不加住宿、停驻（车每天回基地，不是同一辆车）；工时只按单日检查 |

- 「推荐」：总价低的那个；差不到 3%（`recommendGapBp`，平台常量 300）时推荐 `one_car`（同一辆车、同一位司机，省去每天换车）。
- 某天一个商品都报不出：`daily_best` 进 `unquoted`（带天和原因），`one_car` 也一样；两个都报不出时 `plans` 为空、`unquoted` 列原因（转人工的入口在 P3 / P5 页面）。
- 每次 `POST …/quote` 在一个平台事务里删掉这一行程的旧方案、写新方案（段、费用跟着），`trips.status` 改为 `quoted`、`expires_at` = 方案里最早到期的段报价。

## 四、跨段规则（`packages/domain/src/trip/`，纯函数，不碰数据库和网络）

输入：已经报好价的各段（带商品、车型组、①基础价区域图形、当天时间和 T）、当晚过夜点、商品的规则配置。输出：`trip_fees` 行（含算式快照）和告警。**不改 `quote.ts`、`pricing.ts`。**

规则配置 `trip_rule_configs.config`（金额是商品结算币种最小单位，比例是基点；不填的键 = 默认值，第九节）：

| 键 | 内容 |
| --- | --- |
| `lodging` | `{ enabled, perNightMinor, byArea: [{ areaId, perNightMinor }] }` |
| `idleDay` | `{ enabled, perDayMinor, orShortestPackage }` |
| `workHours` | `{ maxBindMinutes, hardMaxBindMinutes, minRestMinutes, absoluteMinRestMinutes, maxDriveMinutes, maxDailyKm, garageMinutes, awayGarageMinutes }` |
| `secondDriver` | `{ enabled, mode: "shortest_package" \| "fixed", fixedMinor }` |
| `returnTrip` | `{ enabled, ratioBp, fixedByCity: [{ cityId, minor }], maxOneWayKm }` |

1. **住宿（3.1）**：一车到底方案里，第 N 晚——第 N 天结束点和第 N+1 天开始点**都不在**这个商品任一①基础价区域里（用 `locateInAreas`，和引擎①判断同一函数），且第 N+1 天还用这辆车 → 一笔住宿费；过夜点落在 `byArea` 的区域取区域金额，否则 `perNightMinor`。明细「司机住宿费（第 N 晚，区域名）」，区域名取过夜点所在的③ / ②区域名，都不在时写「外地」。中间夹空闲日时，空闲日那晚照样算（车留在当地）。
2. **多日停驻（3.3）**：一车到底方案里，两个用车日之间的空闲日 → 每天比两种做法取低：
   - a. 车留在当地：停驻费 `min(perDayMinor, 该车型组最短套餐结算价)`（`orShortestPackage` 开时）+ 当晚住宿（第 1 条）；
   - b. 车回基地再来：**P1 只在过夜点在①里时成立**（回基地不产生费用，即不收停驻费、不收住宿）；过夜点在①外时 b 要两段返程，返程在 P1 不报（第 4 条），所以只用 a。
   最短套餐结算价从这一商品这一车型组报价的候选里取（引擎给的套餐时长列表中最短那档的套餐价），取不到时只用 `perDayMinor`。
3. **工时与第二司机（3.4、3.7 单日上限）**：
   - 每天拘束分钟 = 当天各段服务时长之和（包车段用引擎明细里的预计用时 T，`itinerary.estimatedMinutes`，没有时用全程分钟；接送机、点对点用路线分钟 + 免费等待）+ 出入库（过夜点在①里 `garageMinutes`，在外地 `awayGarageMinutes`）。
   - 两天之间休息 = 次日开始 − 当日结束 − 出入库。
   - 当天驾驶分钟 = 路线行驶分钟之和；当天公里 = 路线米数之和。
   - 超 `maxBindMinutes`（13 小时）、或休息少于 `minRestMinutes`（11 小时）、或驾驶超 `maxDriveMinutes`（9 小时）、或公里超 `maxDailyKm`（600）→ **第二司机**：`secondDriver.enabled` 时加一笔第二司机费（`shortest_package` = 该车型组最短套餐结算价，或 `fixed`），告警 `SECOND_DRIVER`；没开 → 这一天进 `unquoted`（`WORK_HOURS_EXCEEDED`）。
   - 超 `hardMaxBindMinutes`（15 小时）或休息少于 `absoluteMinRestMinutes`（9 小时）→ 第二司机也不行，进 `unquoted`（`WORK_HOURS_HARD_LIMIT`）。设计篇备选顺序里的「拆成两天」「新干线」在 P1 不自动生成（P1c 起），只在告警里提示。
   - 单日 13 小时拦截（`ITINERARY_TOO_LONG`）由引擎做，编排器把它翻成同样的 `unquoted` 原因。
   - `daily_best` 只按单日检查（不同的车，不看两天之间的休息）。
4. **长途返程（3.2）**：纯函数 `returnFee({ returnKm, overKmPerKmMinor, ratioBp, fixedByCityMinor, maxOneWayKm })` = `min(返程公里 × 超公里单价 × ratioBp / 10000, 城市固定表)`（只取有配置的项，`D/money.ts` 统一取整），超 `maxOneWayKm` → 转人工。**P1 编排里不会调用它**：返程只在一车到底最后停在这个商品①③以外时成立，而那一天引擎报不出价（`OUT_OF_SERVICE_AREA`），方案已进 `unquoted`（`CROSS_CITY_ONE_CAR_NOT_AVAILABLE`）。P1d 接入代理请求后直接用。配置项照样可以先填。
5. **对客价**：跨段费用的结算价按那个商品那个车型组当天报价用的加价比例和汇率换成对外价（`sellPrice`，`packages/domain/src/quote.ts` 的同一函数，用这一方案第一段报价的 `markupBp`、`fx`），保证同一行程只有一个汇率（设计篇第五节第 3 小节）。
6. 所有费用带算式快照 `calc`（例：`{ rule: "lodging", night: 1, areaId, perNightMinor, source: "byArea" }`），明细和以后的地图联动都用它。

## 五、规则配置接口

- `PUT /tenant/v1/products/:id/trip-rules`：整体替换 `config`，带商品版本号（`If-Match`），成功后商品版本号加一、`version` 加一、写审计（`resource: product`、`after.trip_rules`）。只有包车商品能配（别的品类 400 `TRIP_RULES_NOT_APPLICABLE`）。
- 校验（domain `tripRuleIssues`）：金额 0 – 10 亿；比例 0 – 10000 基点；分钟 0 – 2880 且 `maxBindMinutes ≤ hardMaxBindMinutes`、`absoluteMinRestMinutes ≤ minRestMinutes`；`byArea` 最多 50 条、区域是本租户的（别的租户的 404）、不重复；`fixedByCity` 最多 50 条、城市是平台启用城市。
- `GET` 返回「保存的值 + 默认值合并后的生效值」两份，前端（以后的规则配置页）据此显示「默认」标记。
- 租户 A 读不到、改不了 B 的（集成测试，规则 2）；返回里只有结算价（规则 4）。

## 六、和现有代码的边界

| 现有 | 用法 | 改不改 |
| --- | --- | --- |
| `previewPlatformQuote`（`services/quotes.ts:301`） | 每段报价 | 不改 |
| `loadCharterCityCandidates`、`charterMatches`、`chooseCharterCity` | 包车段找城市 | 不改 |
| `ctx.quote.routes.estimate` | 包车行程逐段路线、工时公里 | 不改 |
| `requireOpenSite`、`takeSiteSlot` | 渠道、限频 | `SALES_RATE_LIMITS` 加一档 `site_trip`（新增键，不改已有键） |
| `sellPrice`、`locateInAreas` | 跨段费用对客价、①判断 | 不改 |
| 迁移、表 | 0600 新增 5 张表 | 不改已有表 |

## 七、验收标准

1. 迁移 0600：5 张表、约束、行级安全、授权登记；租户隔离集成测试（规则配置）；迁移测试。
2. 同一段在编排里的对外价 = 用同样条件调官网询价的中标价（集成测试逐段比对，接送机、点对点、包车各至少一条）。
3. 固定测试集（第八节）逐条比对：段型、拆法、每笔跨段费用（类型、晚次、金额）、方案数、推荐标记、`unquoted` 原因。
4. 规则单元测试：住宿（①内不收、①外收、`byArea`、空闲日那晚）、停驻（取低、最短套餐取不到）、工时（13 / 15 小时、11 / 9 小时休息、9 小时驾驶、600 公里、第二司机开 / 关）、返程函数（取低、超范围）。
5. 现有询价、包车 golden、itinerary golden 0 条变化（没改引擎，回归照跑）。
6. 对客应答没有结算价、加价比例、供应商编号（OpenAPI 断言）。
7. 单元 + 集成（真实 PostgreSQL）；独立审查、合并、部署后测试站验收（用 QA 测试供应商，ADR 0077）。

## 八、固定测试集

原文第 7 节要「30 条真实客人需求」。仓库里没有真实客人数据（也不能放演示数据），本篇做法：

- 在测试代码里构造 30 条（东京、大阪两城，覆盖接机 → 酒店、酒店 → 送机、当天游览、接机 + 下午游览、多日同城、夹空闲日、过夜在箱根 / 日光（①外）、超 13 小时、超 15 小时、两天之间休息不足、人数超车型、某天无商品、跨城市一车到底（P1 应 `unquoted`）等），商品、区域、价格全部在测试里建、测完删（规则 1）。
- 每条写明期望（段型、拆法、费用、方案、推荐、`unquoted`）。
- 业主日后给出去掉个人信息的真实需求时，逐条替换进同一套测试（待确认 Q1）。

## 九、待确认项（先按默认值做，监工 / 业主可改）

| # | 问题 | 采用的答案 |
| --- | --- | --- |
| Q1 | 30 条真实客人需求从哪来？ | 先在测试代码里按真实场景构造 30 条（第八节），业主给真实脱敏需求后替换 |
| Q2 | 默认值 | 原文第 8 节 / 设计篇第十一节：住宿 ¥15,000 / 车 / 晚（`byArea` 可单独设）；停驻 ¥10,000 / 天与最短套餐取低；第二司机 = 该车型组最短套餐结算价；拘束 13 h（上限 15 h）、休息 11 h（至少 9 h）、驾驶 9 h、单日 600 km；出入库 60 分钟（外地 15 分钟）；返程单价 = 超公里单价 × 50%、单程 ≤ 600 km。默认值写在 domain 常量里、供应商可改，**不是**平台替供应商定价（金额是结算价） |
| Q3 | 默认值的币种 | 默认金额按日元写；商品结算币种不是日元时（现在没有），默认的住宿 / 停驻**不生效**、只用供应商填的值 |
| Q4 | 方案「推荐」怎么定 | 总价低者；差 3% 以内推荐一车到底（第三节第 6 小节） |
| Q5 | 段报价落不落 `quotes` | P1 不落（试算），P1b 下单前再走正式询价（第三节第 5 小节） |
| Q6 | 报不出时记不记未覆盖需求 | P1 不记：现有表的品类只能是三种单品，行程级转人工记录随 P3 的 `trip_handoffs` 做 |
| Q7 | 返程规则 P1 不触发是否接受 | 接受：跨城一车到底在 P1 一律 `unquoted`（`CROSS_CITY_ONE_CAR_NOT_AVAILABLE`），返程费随 P1d 上线；函数和配置先做好 |
| Q8 | 航班号 | P1 不收，接机段按商品免费等待报；P3 引入航班号后按 ADR 0097 |
| Q9 | 设计篇（ADR 0094）还在审 | 本篇只用它已经过两轮复核、没有争议的 P1a 部分；设计篇有改动时本篇跟着改 |

## 十、实施任务与工作量

| 任务 | 内容 | 人日 |
| --- | --- | --- |
| M9T-00 | 本 ADR、roadmap | 1 |
| M9T-01 | domain `trip/`：行程单校验与上限、分段判定、拆法枚举、四类规则、方案组装、规则配置校验；单元测试 | 5–6 |
| M9T-02 | 迁移 0600、迁移测试、规则配置接口（租户读写、平台只读）、租户隔离测试、OpenAPI | 3 |
| M9T-03 | 编排接口（建行程、查行程、报价）、逐段调用现有报价服务、写方案 / 段 / 费用、限频、OpenAPI、集成测试 | 5–6 |
| M9T-04 | 固定测试集 30 条、测试站验收 | 3 |
| **合计** | | **17–19 人日** |

每个任务一个 PR（分支 `m9t-*`，标题以 `[M9T]` 开头），各自独立审查、CI 全绿后合并。

## 十一、风险

1. **包车引擎在 M9P 车道持续变化**：编排器只调用、不复制逻辑，变化自动跟上；固定测试集的期望金额可能要随 M9P 改动更新（以 CI 为准）。
2. **调用量**：14 天 × 4 种拆法的上限是 60 次段报价；路线估算走现有缓存和每日上限。
3. **一车到底挑商品**：按「所有用车日都能报」的商品筛，可能一个都没有（不同日子落在不同城市）——这正是 P1d 要解决的，P1 进 `unquoted`。
4. **设计篇未定稿**：数据模型只取了没有争议的部分，P1b 的付款表、P3 的加密列都以新迁移追加，不回改 0600。
