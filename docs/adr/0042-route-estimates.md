# ADR 0042：路线预估——谷歌 Routes API、缓存、每日上限与降级

- 状态：已采纳（2026-10-26，M2-02）
- 补充 ADR 0020「报价引擎」：`RouteEstimator` 的真实实现；接口改为返回「路线 + 来源」或「原因代码」（`RouteLookup`），入参去掉用车时间。
- 补充 ADR 0041「在运营后台填写第三方密钥」：路线预估每次现取生效的谷歌密钥；复用「测试一下」的调用方式和安全处理。
- 迁移 0110（0091–0109 留给别的任务，0100 是 M4-03 的）。

## 背景

需求（《用车报价服务平台》报价引擎第 6 步、计价公式、已确认的决策）：里程 + 时长模型的里程和时长用谷歌地图 Routes API 预估，**按预估报价，不按实际里程结算**。
需求没有写缓存、降级、费用控制的规则；下面的数值是推荐值，列在「待负责人确认」里。roadmap 的验收标准：真实调用 Routes API，失败有降级提示。

## 决定

### 调用（`apps/api/src/integrations/google-maps.ts` 的 `computeRoute`）

- Routes API `computeRoutes`，驾车（`DRIVE`）、**不考虑实时路况**（`TRAFFIC_UNAWARE`）、不要备选路线；字段掩码只要 `routes.distanceMeters,routes.duration`——Routes API 最便宜的一档（Essentials），和「测试一下」同一档。
- 密钥放请求头 `X-Goog-Api-Key`，不放网址；不跟随重定向（3xx 当作看不懂）；应答体边读边截，只读前 64 KB（超出的截断后解析失败，当作看不懂）。地址是配置 `GOOGLE_MAPS_ROUTES_URL`，只有 local / ci 能改（ADR 0041）。
- 询价要等它，时限比「测试一下」短：整次最多 1.6 秒，每次尝试最多 1 秒；连不上、超时、5xx 在剩余时间 ≥ 0.3 秒时再试 1 次；4xx（含 429）不重试。报价这一层的兜底仍是 2 秒（ADR 0020）。
- 应答：`routes[0].distanceMeters`（米，省略 = 0）、`routes[0].duration`（`"123s"`，取整秒）；没有 `routes` 或空数组 = 两点之间没有路线（`NO_ROUTE`）；里程 > 5000 公里或时长 > 7 天当作看不懂。
- 时长换成计价用的整分钟：**四舍五入**（30 秒进一分钟，domain 的 `routeMinutesFromSeconds`）。里程按米原样进计价公式（ADR 0018：超出部分不凑整）。

### 为什么不考虑实时路况、缓存键里没有时段

- 不考虑实时路况时，谷歌给的是同一组起终点的固定结果，和几点出发无关——缓存键里加时段不会改变结果，只会降低命中率。
- 按路况的预估（`TRAFFIC_AWARE`）是更贵的一档（Pro），同一段路早晚高峰报价不同，客人看到的价格不稳定；需求只说「按预估报价」，没要求按时段。
- 以后要按时段：改 `routingPreference`、在缓存键里加「东京时间的星期 × 小时」（`v2:` 前缀），本文的其余规则不变。列在「待负责人确认」第 2 条。

### 缓存（domain 的 `routeCacheKey`，表 `route_estimates`）

| 项 | 规则 |
| --- | --- |
| 键 | 起终点各自取整到小数点后 **3 位**（纬度方向约 111 米，东京一带经度方向约 90 米），有方向（A → B 和 B → A 各一条）：`v1:35.681,139.767>35.690,139.701` |
| 调谷歌用的坐标 | 取整后的坐标——同一个键的结果一定来自同一组坐标，谁先问都一样 |
| 取整后是同一个点 | 不调用，里程和时长按 0（最低消费 / 起步价兜底） |
| 成功 | 存库，**7 天**后过期 |
| 只跟这组点有关的失败（`NO_ROUTE`、`INVALID_POINTS`） | 也存库，**1 天**后过期——同一组点一天内不再花钱问 |
| 其他失败（超时、配额、密钥……） | 不缓存，靠冷却（见下） |
| 过期的行 | 查的时候当作没有；再调用后覆盖；每次写入顺手删一批过期一天以上的（最多 100 行） |
| 并发 | 同一个键正在查时，后来的直接等那一次（进程内）：同一组起终点并发只调一次谷歌 |

缓存在数据库里（不是只在内存）：重启后还在，以后多开服务进程也共用。缓存只有坐标和里程时长，不是哪个租户的数据，平台表、租户读不到。
多开进程时「并发只调一次」只在每个进程内成立：最坏是每个进程各调一次。

### 冷却（同一把密钥，进程内）

谷歌出问题时，不让每次询价都等满时限、也不把配额越打越紧：

| 原因 | 冷却 |
| --- | --- |
| 密钥、项目配置（`KEY_INVALID`、`API_NOT_ENABLED`、`KEY_RESTRICTED`、`BILLING_DISABLED`、`PERMISSION_DENIED`）、配额（`QUOTA_EXCEEDED`）、到了每日上限（`DAILY_LIMIT_REACHED`） | 60 秒 |
| 网络和对方（`TIMEOUT`、`UNREACHABLE`、`UNAVAILABLE`、`UNEXPECTED`） | 15 秒 |
| `NO_ROUTE`、`INVALID_POINTS`、`NOT_CONFIGURED` | 不冷却 |

冷却中直接按上次的原因降级，不调用。冷却**按密钥记**（密钥的 SHA-256 指纹，只在内存）：超级管理员在后台换了密钥，下一次询价立即用新密钥，不等冷却。
冷却还记下所属的东京日期，0 点换了新的一天立即失效：前一天「到了每日上限」的冷却不挡新的一天，也不把新一天记成「被挡下」（M3-12 测试发现的缺陷，ADR 0044 一并修正）。

### 费用控制：每日调用上限

- 配置 `GOOGLE_ROUTES_DAILY_LIMIT`（不是密钥），默认 **1000 次 / 天**，0 = 不调用，最大 100 万；按**东京时间**的日期计（和供应商的「今天」同一个时区）。
- 每次**真正发出的请求**（含重试）之前占一个名额：锁住今天那一行、读出已用次数，由 domain 的 `routeCallAllowed` 判断，允许才加一——几个请求同时来也不会超过上限。
  到了上限不发请求，原因 `DAILY_LIMIT_REACHED`（按降级处理），记一次「被挡下」。
- 记不了数（数据库出错）时不调用（宁可少调），原因按 `UNAVAILABLE`。
- 为什么 1000：Routes API Essentials 每月有一定的免费额度，超出后按千次计费；有 7 天缓存后，同一批热门线路（机场 ↔ 酒店）基本只在第一次花钱。1000 次 / 天在早期流量下绰绰有余，又给失控（被刷、程序出错）的费用封了顶。

### 降级（取不到路线时）

不 500，整次比价照常：

- 里程 + 时长的价格报 `ROUTE_UNAVAILABLE`（原有的拒绝原因）；一口价、包车套餐不受影响（包车本来就按套餐时长、不估路线）。按小时的夜间费、按时长的附加服务按 ADR 0020 原有的兜底处理。
- 原因代码（domain 的 `ROUTE_FAILURE_CODES`）：`NOT_CONFIGURED`、`DAILY_LIMIT_REACHED`、`KEY_INVALID`、`API_NOT_ENABLED`、`KEY_RESTRICTED`、`BILLING_DISABLED`、`PERMISSION_DENIED`、`QUOTA_EXCEEDED`、`TIMEOUT`、`UNREACHABLE`、`UNAVAILABLE`、`UNEXPECTED`、`INVALID_POINTS`、`NO_ROUTE`。
  报价这一层的兜底：路线服务超过 2 秒是 `TIMEOUT`，抛了异常是 `UNEXPECTED`。

谁看到什么：

| 谁 | 接口 | 看到的 |
| --- | --- | --- |
| 平台员工 | `POST /platform/v1/quotes/preview` | `route_status`：`status`（`not_needed` / `assumed` / `ok` / `unavailable`）、来源（`cache` / `google` / `same_point`）、完整的原因代码和中文说明 |
| 供应商 | `POST /tenant/v1/products/{id}/quote-preview` | `route_status`，原因只有 `NO_ROUTE`（没有可行驶的路线）和 `TEMPORARILY_UNAVAILABLE`（暂时不可用）——平台的密钥、配额问题不告诉供应商 |
| 渠道、官网 | `/sales/v1/quotes`、`/site/v1/quotes` 的 `unavailable.reasons` | 新增两个面向客人的原因：`NO_ROUTE`（换个地点）、`TEMPORARILY_UNAVAILABLE`（稍后再试） |
| 平台内部 | 询价日志 `quote_logs.route` | `{ status, source, meters, minutes }` 或 `{ status: "unavailable", code }`——每次询价的降级原因；没报出价的商品照旧在 `rejects` 里（`ROUTE_UNAVAILABLE`） |
| 超级管理员、技术 | `GET /platform/v1/integrations` 的 `routes`（系统状态） | 今天的调用次数、每日上限、是否已到上限、失败次数、被上限挡下的次数、最近一次成功、最近一次失败（原因代码、说明、时间） |

`/health` 不加这些：它不需要登录，最近失败的原因（密钥无效、没绑卡）不该公开；`/health` 照旧只报谷歌地图「已配置 / 未配置」。

### 日志与密钥

- 失败时记一条 warn：只有原因代码（`routeFailure`），没有密钥、没有谷歌返回的原文。读写缓存、计数失败记 warn（异常走统一的脱敏序列化）。
- 密钥只出现在发给谷歌的请求头里；应答、错误、询价日志、缓存表、计数表里都没有。ADR 0041 的日志脱敏名单（配置文件的和后台填写的密钥）照样覆盖这里的日志；集成测试逐项核对。

### 接口变化

- `RouteEstimator.estimate({ from, to })` → `RouteLookup`（`{ ok: true, route, source }` 或 `{ ok: false, code }`）。
- `PlatformQuotePreview`、`TenantQuotePreview` 加 `route_status`；`SalesQuoteResult.unavailable`、`SiteUnavailable` 的原因加 `NO_ROUTE`、`TEMPORARILY_UNAVAILABLE`；`GET /platform/v1/integrations` 加 `routes`。只加字段和枚举值，不升版本。
- 官网页面要给两个新原因配文字（前端任务，见「本期不做」）。

## 测试

- 单元：`packages/domain/src/route-estimate.test.ts`（坐标取整与缓存键、秒换分钟、合理范围、冷却与负缓存的判定、给客人的原因、每日上限、东京时间的日期、过期时间）、
  `apps/api/src/integrations/google-routes.test.ts`（本机假服务器：请求的样子、解析、各种失败的归类、重试和时限、不跟随重定向、64 KB、每日上限的钩子）、
  `packages/config/src/index.test.ts`（`GOOGLE_ROUTES_DAILY_LIMIT`）。
- 集成（真实 PostgreSQL + 本机假谷歌，从不调用真实谷歌）：`apps/api/src/route-estimates.itest.ts`——成功、缓存命中与过期、并发同一组只调一次、超时、429、400 负缓存、应答过大、
  每日上限（含并发不超、第二天恢复）、换密钥立即生效、密钥没配、同一个点、渠道 / 供应商看到的原因、询价日志、系统状态、日志和库里没有密钥。
- 原有的报价测试换成新接口的替身（`testing/routes.ts`）。

## 待负责人确认（都已按推荐值实现）

| # | 问题 | 推荐（现在的做法） | 理由 |
| --- | --- | --- | --- |
| 1 | 每日调用上限 | 1000 次 / 天（`GOOGLE_ROUTES_DAILY_LIMIT`），东京时间 0 点重置 | 早期流量足够；给失控的费用封顶。也建议在 Google Cloud Console 给 Routes API 设每日配额，作为第二道保险 |
| 2 | 要不要按实时路况 / 时段预估时长 | 不按（`TRAFFIC_UNAWARE`） | 价格稳定、费用低一半；需求没要求按时段 |
| 3 | 坐标取整精度 | 小数点后 3 位（约 100 米） | 同一酒店、同一航站楼的询价能共用缓存；里程误差在 ±150 米以内 |
| 4 | 缓存多久 | 成功 7 天、没有路线 1 天 | 不考虑路况的路线只随道路变化。谷歌地图平台的服务条款对缓存有限制，请在开通账号时确认允许的时长；需要更短改一个常量即可 |
| 5 | 时长取整 | 四舍五入到分钟 | 不偏向客人也不偏向供应商 |
| 6 | 起终点在 100 米格子里重合 | 里程时长按 0（最低消费或起步价兜底） | 不调用、不花钱 |

## 本期不做

- 按路况 / 时段预估（见待确认 2）。
- 地址搜索、地图选点（Places API）：官网的点对点仍用 ADR 0035 的辅助方式，另开任务。
- 运营后台「系统状态」页显示 `routes`、官网给 `NO_ROUTE` / `TEMPORARILY_UNAVAILABLE` 配文字：前端任务（接口已就绪）。
- 多进程共享的冷却和「并发只调一次」：现在只有一个服务进程；多开时最坏每个进程各调一次，每日上限仍在库里统一计数，不会超。
