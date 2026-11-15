# ADR 0099：包车经停点上限改为路径接口上限（25 个）；超限提醒（12 小时 / 360 公里，商品级）

- 状态：已采纳（2026-11-15，M9P-10）。待独立审查。
- 依据：
  - 业主《包车报价逻辑规格（开发版）》2026-11-14（`docs/requirements/charter-pricing-spec-2026-11-14.md`）步骤 2「经停数量不设业务上限，只受路径接口技术上限约束」、步骤 5「T > 12 小时或 D > 360 公里：在行程时间表下提醒客人缩减行程、减少经停，仍可下单……两个阈值做成商品级配置」，差异表第 10、11 条。
  - 旧需求 `docs/requirements/charter-airport-packages-2026-11-14.md` 第三节「超出时提示请联系客服定制」「待开发确认：路径接口单次计算的点数上限」，第四节第 2、3 条（基准线、提醒文案）。
  - ADR 0093 第四节第 10 条（13 小时拦截已随 M9P-03 上线）、第九节（M9W-14 → M9P-10）。
- **修改**：ADR 0088「最多 10 个经停点」、ADR 0090 第二节「`waypoints` 0–10 个、草稿 ≤ 16 KB」、ADR 0096 第一节第 2 小节「`MAX_WAYPOINTS = 10`」改为本篇的上限。其余不变。

## 一、路径接口的点数上限（M9W-14 的调查结论）

| 用法 | 怎么调 | 点数上限 |
| --- | --- | --- |
| 报价的路线（`itineraryRoute`，`apps/api/src/services/site.ts`） | `computeRoutes` **逐段两两**调用（上车 → 经停 1 → … → 下车），各段并行、各自缓存 | 单次请求只有起终点两个点，**没有**中间点上限；N 个经停 = N + 1 次调用，计入路线每日上限 |
| 行程地图的折线（ADR 0096 第二节第 2 小节） | 一次 `computeRoutes`，经停作 `intermediates` | **最多 25 个中间点**（10 个以内 Essentials，11–25 个 Pro 计费） |
| 顺序建议（ADR 0096，`optimizeWaypointOrder`） | 一次带全部经停 | **最多 25 个中间点** |

结论：技术上限取 **25 个经停点**——报价本身不受限制，但同一张单的地图折线、顺序建议都要一次带全部经停，超过 25 个这两项做不了。放到 25 以上只会让「地图 / 顺序建议出不来但能报价」，没有业务需要（规格用例最多 12 个）。

## 二、决定

1. **一个常量**：`packages/domain/src/charter-itinerary-limits.ts` 的 `CHARTER_ITINERARY_LIMITS.maxWaypoints = 25`（无依赖的文件，`@nozomi/domain/charter-itinerary-limits` 单独导出给嵌入组件，不把整个 domain 打进组件脚本）。`QUOTE_RULES.maxWaypoints`、`MANUAL_QUOTE_RULES.maxWaypoints`、草稿校验、`/book/new` 和嵌入组件的 `MAX_WAYPOINTS` 都引用它。M9P-20（行程地图）的点数上限另由 `ITINERARY_MAP_RULES` 管，超出时不出图、只显示列表（ADR 0096 第二节第 3 小节的约定）。
2. **超出时**：`/site/v1/quotes` 400 `VALIDATION_FAILED`，`/waypoints` 的说明「经停点最多 25 个（地图路径接口的上限），更多经停请联系客服定制」；页面加满 25 个后「添加经停点」按钮消失，提示同一句。人工报价表单同一上限（客人超过上限只能走客服）。
3. **订单**：`orders.waypoints` 的检查约束 1–10 → 1–25（迁移 0510）。
4. **预订草稿**：25 个经停点 × 200 字中文名称约 18 KB，超过原来的 16 KB；`BOOKING_DRAFT_RULES.maxBytes` 16 KB → **24 KB**（请求体上限同步）。库里的约束本来就是 32 KB，不改库。
5. **超限提醒**（规格步骤 5）：
   - 商品级配置 `service_rules.charterItinerary.warnMinutes`（默认 720 = 12 小时，可设 60–1440）、`warnKm`（默认 360，可设 1–5000），和 M9P-03 的三项、在线下单上限放在一起，只存和默认值不同的项；接口字段 `charter_itinerary.warn_minutes`、`warn_km`。默认值直接取规格的 12 小时 / 360 公里（只提醒，不影响价格和选档，所以不像 ADR 0091 那样「不取业主建议值」）。
   - 判断 `itineraryWarnings`（同一文件）：T（中标商品的预计用时，含经停点默认占用和整单缓冲）**大于** `warnMinutes` → `LONG_DURATION`；全程米数**大于** `warnKm × 1000` → `LONG_DISTANCE`；先用时后距离。
   - 不进报价引擎（`quote.ts` 不改选档、价格、快照）：服务层刚询价时按中标商品当时的配置算（`sales-quotes.ts` `itineraryWarningsOf`），只放在官网应答里：每个报价 `itinerary_warnings: ("LONG_DURATION" | "LONG_DISTANCE")[] | null`（没按行程计价为 null，没超为空数组）。查报价（`getSalesQuote`）、渠道接口 `/sales/v1` 不给。
   - 页面：`/book/new`（嵌入预订页复用同一组件）在「行程时间表」下方显示，按所选车型（没选时按最便宜的）的报价；文案取旧需求第四节第 3 条，并写出耗时 / 距离最长的一段（用地点名，不用编号，和 M9P-20 的编号改法无关）。只有中文（业主 2026-11-15：翻译放到 M11），文案按键集中在 `apps/web/src/lib/itinerary-warnings.ts`。
   - 超过在线下单上限（`ITINERARY_TOO_LONG`）的页面说法改为旧需求第四节第 3 条的「该行程超出司机单日法定工作时长，无法在线预订。请缩减行程，或联系客服安排分两天用车。」，和提醒同一套文案。
6. **总价提醒**（旧需求「总价可选，超过 12 小时套餐价的 1.5 倍时提醒」）：新规格步骤 5 没有这一条，不做。

## 三、影响

- 谷歌调用：一单最多 26 段路线（原来 11 段），都走现有的缓存和每日上限；没有新的计费档（报价只用两两调用）。
- 改期、救援不受影响（不看提醒、经停点照订单原样）。
- 回放：引擎没改，回放结果不变。
