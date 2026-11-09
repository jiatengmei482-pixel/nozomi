# ADR 0072：官网路线小地图改用谷歌静态地图

- 状态：已采纳（2026-11-09，M8-10）。
- 落实 ADR 0069 B11（右侧栏路线图）：业主选「谷歌静态地图」——灰色调底图，路线和起终点用品牌色突出；**密钥不进浏览器**（后端代调）。
- 补充 ADR 0042「路线预估」：路线折线沿用同一个路线缓存键和 `RoutePreviewer`（M8-02），Routes 的调用照旧计入 `GOOGLE_ROUTES_DAILY_LIMIT`；冷却时长、东京日期、并发不超、记不了数就不调的做法照搬到静态地图，计数和上限另起一套。
- 补充 ADR 0005「配置」：新增普通配置 `GOOGLE_STATIC_MAPS_DAILY_LIMIT`（不是密钥）和只给测试用的 `GOOGLE_STATIC_MAPS_URL`（只有 local / ci 能改）。
- 迁移 0250（0240 是 M4-34 的）。编号：main 上最大是 ADR 0070，0071 已被 M4-34 分支占用，这里用 0072。
- **只改地图显示**：不改报价、不改路线预估的结果，不写询价日志。

## 接口

`GET /site/v1/route-map?from_lat=&from_lng=&to_lat=&to_lng=&theme=light|dark&width=200..640&height=150..640&scale=1|2`

| 参数 | 规则 |
| --- | --- |
| 四个坐标 | 必填；留空当作没填（不当 0） |
| `theme` | `light`（默认）/ `dark` |
| `width`、`height` | 必填整数，CSS 像素：宽 200–640、高 150–640（谷歌免费档最大 640 × 640） |
| `scale` | `1`（默认）/ `2`（高清屏，实际像素翻倍） |
| 其他参数 | 400 `VALIDATION_FAILED` |

- **200**：图片（`content-type` 按图片内容认，一般 `image/png`），`Cache-Control: private, max-age=86400`，`X-Content-Type-Options: nosniff`。
  `/site/` 下的应答原本一律 `no-store`；只有这个接口的 200 例外（图里没有个人或账号数据），出错的应答照旧 `no-store`。
- **503 `ROUTE_MAP_UNAVAILABLE`**：统一错误格式 `{ error: { code: "ROUTE_MAP_UNAVAILABLE", message, details: { reason } } }`（CLAUDE.md 的错误格式，与最初约定的 `{ code, reason }` 不同，页面读 `error.details.reason`）。`reason` 只有两类：

| `reason` | 什么时候 | 页面 |
| --- | --- | --- |
| `NOT_ENABLED` | 没配谷歌密钥；谷歌说静态地图没开通（「This API is not activated…」「This API project is not authorized to use this API」）、密钥限制（referer、IP、只允许某些 API）、密钥无效、没绑卡、没权限 | 继续用原来的 Leaflet 地图（后备） |
| `UNAVAILABLE` | 其余一切：静态地图到了每日上限、冷却中、超时、谷歌出错、图太大或不是图片、跳转；取不到路线（Routes 出错、到了路线上限、两点间没有路线、折线看不懂）；起终点取整后是同一个点；官网没开 | 只显示「约 X 分钟 · Y 公里」 |

  Routes 自己的「没开通」算 `UNAVAILABLE`：那是路线取不到，原来的地图也画不出路线。
- **429**：每个地址每分钟 30 次（`site_route_map`）、每天 200 次（`site_route_map_day`），缓存命中也算——换主题、换尺寸各算一次，一个人刷不光全站的每日上限。
- **400**：参数错误，现有格式。

## 出图的步骤（`apps/api/src/services/static-maps.ts`）

1. 起终点取整成路线缓存键（domain `routeCacheKey`，和报价、`POST /site/v1/quotes/by-points` 同一个键）；取整后是同一个点 → `UNAVAILABLE`。
2. 图的缓存键 = `s<样式版本>:<主题>:<宽>x<高>@<倍率>|<路线缓存键>`（domain `staticMapCacheKey`）。同一个键正在出图的直接等那一次（进程内并发只调一次谷歌）。
3. 查库里的图（`static_map_images`），1 天内有就直接给，**不调任何谷歌**（也不看密钥、冷却）。
4. 生效的谷歌密钥（运营后台填写的优先，每次现取）；没有 → `NOT_ENABLED`。
5. 这把密钥的静态地图在冷却中 → 按上次的原因降级（到了每日上限的冷却期内挡下的也记一次「被挡下」）。
6. 路线折线：`RoutePreviewer.preview`（按两个坐标报价时取过的在进程内 10 分钟，不再调 Routes；没有就按 ADR 0042 调 Routes，计入路线的每日上限）。
7. 请求参数（domain `staticMapQuery`，不含密钥）→ 每次真正发请求前占一个今天的名额 → 调谷歌 → 成功的写库（1 天），失败记计数和「最近一次失败」、按原因冷却。

## 调谷歌（`apps/api/src/integrations/google-static-maps.ts`）

- `GET https://maps.googleapis.com/maps/api/staticmap?<参数>&key=<密钥>`：Maps Static API 只认网址里的 `key`，所以密钥只在这一个发给谷歌的网址里；网址不进日志、错误、返回值、数据库。
- 不跟随跳转（3xx 当作看不懂）；整次最多 5 秒，每次尝试最多 3 秒；连不上、超时、5xx 剩余时间 ≥ 0.5 秒时再试 1 次；4xx（含 429）不重试。
- 成功的条件：200、应答头是图片、**内容开头确实是 PNG / JPEG / GIF**（按内容认类型，不信应答头）；边读边数，超过 1 MB 就停（`IMAGE_TOO_LARGE`，不存库）。
- 失败的应答只读前 64 KB、只用来归类成原因代码；谷歌的原文（有时回显密钥）不转述到任何地方。

### 请求参数

| 参数 | 值 |
| --- | --- |
| `size`、`scale` | 页面给的宽高、倍率 |
| `format`、`maptype`、`language` | `png`、`roadmap`、`zh-CN` |
| `style` | 灰色调（见下），去掉兴趣点、公交、地块和道路图标 |
| `path` | `color:0x<品牌色>ff\|weight:5\|enc:<折线>` |
| `markers` | 起点 `label:A`、终点 `label:B`，颜色同路线，取折线的第一个和最后一个点（和路线对得上） |

谷歌的网址最长 16384 个字符：查询参数（不含密钥）控制在 15000 以内，折线太长时按间隔抽稀（起终点不动）直到放得下（domain 的 `decodePolyline` / `encodePolyline`）。

### 颜色（都取自 `docs/design/tokens.css`）

| 用途 | 亮色 | 暗色 |
| --- | --- | --- |
| 路线、起终点标记 | **#1B2A5C**（`--color-brand`） | **#A9BBFF**（暗色的 `--color-text-link` / `--color-border-focus`） |
| 陆地底色 | #F4F5F7（`--color-bg-page`） | #1E232C（暗色 `--color-bg-subtle`） |
| 普通道路 | #FFFFFF | #2D3440（暗色 `--color-border-default`） |
| 高速、主干道 | #D6DAE1（`--color-border-default`） | #3A4250（暗色 `--color-neutral-border`） |
| 水面 | #D6DAE1 | #0F1217（暗色 `--color-bg-page`） |
| 地名文字 / 描边 | #5C6574 / #FFFFFF | #929BAA / #171B22 |

暗色为什么不用暗色的 `--color-brand`（#141C3D）：它是给白字做底的深海军蓝，画在 #1E232C 的深灰上几乎看不见（对比度约 1.1:1）。#A9BBFF 是同一色系（品牌蓝调亮），在暗色里本来就是链接和焦点框的颜色，在 #1E232C 上对比度约 8.4:1；亮色 #1B2A5C 在 #F4F5F7 上约 12.5:1。
改颜色或样式时把 `STATIC_MAP_RULES.styleVersion` 加一，旧样式的缓存自然不再命中。

## 缓存（表 `static_map_images`）

| 项 | 规则 |
| --- | --- |
| 键 | 样式版本 + 主题 + 尺寸 + 倍率 + 路线缓存键（检查约束核对格式） |
| 存什么 | 图片类型和字节；不存密钥、不存请求网址 |
| 单张上限 | 1 MB（检查约束 + 读应答时的上限） |
| 保留 | 1 天（和浏览器缓存一样长）；过期的查的时候当作没有，再调用后覆盖 |
| 清理 | 每次写入顺手删一批已过期的（最多 100 行） |
| 失败 | 不缓存，靠冷却 |

平台表，租户角色没有权限；放在库里（不只在内存）：重启后还在，以后多开进程也共用。

## 费用控制：每日调用上限（表 `static_map_api_usage`）

- 配置 `GOOGLE_STATIC_MAPS_DAILY_LIMIT`（不是密钥），**默认 300 次 / 天**，0 = 不调用，最大 100 万；按**东京时间**的日期计；和路线（`GOOGLE_ROUTES_DAILY_LIMIT`）、地址搜索（`GOOGLE_PLACES_DAILY_LIMIT`）分开计——小地图用多了不挡报价要用的路线。
- 每次真正发出的请求（含重试）之前锁住今天那一行占一个名额（domain `routeCallAllowed`），几个请求同时来也不超；到了上限不发，记一次「被挡下」，`UNAVAILABLE`。
- 记不了数（数据库出错）就不调用，`UNAVAILABLE`。
- 为什么 300：Maps Static API 属于谷歌地图平台的 Essentials 档，每月有一定的免费调用次数（按谷歌现行价目，约 1 万次 / 月）；300 × 30 天在免费额度以内。同一条热门线路（机场 ↔ 酒店）在 1 天内只花一次钱，一张页面通常只要 1–2 张图（亮 / 暗、手机 / 电脑尺寸）。不够时改配置即可。

## 冷却

和 ADR 0042 同一套时长（按密钥指纹记、只在内存、换天失效）：密钥 / 项目配置 / 配额 / 到了每日上限 60 秒；超时、连不上、对方出错、看不懂 15 秒；没配密钥、图太大不冷却。静态地图的冷却和路线预估的冷却各记各的（一个 API 没开通不影响另一个）。

## 系统状态

`GET /platform/v1/integrations` 加 `static_maps`，和 `routes` 同样的字段：今天的调用次数、每日上限、是否已到上限、失败次数、被上限挡下的次数、最近一次成功、最近一次失败（原因代码、中文说明、时间）。
运营看到 `API_NOT_ENABLED` / `KEY_RESTRICTED` 就知道要在谷歌云后台开通 Maps Static API 或放宽密钥限制；不含密钥和谷歌原文。

## 日志与密钥

- 失败时记一条 warn：只有原因代码（`staticMapFailure`），没有密钥、请求网址、谷歌的原文。读写缓存、计数失败记 warn（异常走统一的脱敏序列化）。
- 密钥只在发给谷歌的网址里；应答、应答头、错误、日志、两张新表都没有（集成测试按值核对，含谷歌错误应答回显密钥的情况）。

## 测试

- 单元：`packages/domain/src/static-map.test.ts`（折线解码 / 编码、尺寸、缓存键、灰色调和品牌色、请求参数、折线抽稀、给页面的两类原因、冷却）、
  `apps/api/src/integrations/google-static-maps.test.ts`（本机假服务器：请求的样子、按内容认图片、1 MB 上限、错误归类、重试和时限、不跟随跳转、每日上限的钩子）、
  `packages/config`（`GOOGLE_STATIC_MAPS_DAILY_LIMIT`、`GOOGLE_STATIC_MAPS_URL` 只有 local / ci 能改）。
- 集成（真实 PostgreSQL + 本机假谷歌，从不调用真实谷歌）：`apps/api/src/site-route-map.itest.ts`——出图、缓存与过期清理、并发只调一次、和按两个坐标报价共用路线、不改报价、
  Routes 失败和路线上限、`NOT_ENABLED` 四种谷歌应答和冷却、没配密钥、`UNAVAILABLE` 各种情况、每日上限（含并发不超、上限 0、冷却内记被挡下）、系统状态、输入校验、限频、密钥不外泄。
- OpenAPI：新路径和 `RouteMapUnavailable`、`static_maps`；契约测试（路由与定义一致）、集成测试按定义核对 400 / 429 / 503 和系统状态。

## 待负责人确认（都已按推荐值实现；第 1 项已完成）

| # | 问题 | 推荐（现在的做法） | 理由 |
| --- | --- | --- | --- |
| 1 | 开通 Maps Static API | **已完成（2026-11-09）**：业主已在谷歌云后台开通，测试环境用最小请求核对返回 200 `image/png` | 以后如果被关掉或密钥加了限制，页面自动用原来的地图，系统状态里能看到 `API_NOT_ENABLED` / `KEY_RESTRICTED` |
| 2 | 每日上限 | 300 次 / 天（`GOOGLE_STATIC_MAPS_DAILY_LIMIT`） | 免费额度以内；建议在谷歌云后台也给 Maps Static API 设每日配额作第二道保险 |
| 3 | 图片缓存多久 | 1 天（服务器 + 浏览器） | 谷歌地图平台的服务条款对缓存内容有限制，请在开通时确认允许的时长；要更短改一个常量（`STATIC_MAP_RULES.cacheTtlMs`、`browserMaxAgeSeconds`） |
| 4 | 网址签名 | 不签名 | 谷歌建议给静态地图的网址加数字签名（要另一把「签名密钥」）；不签名在每日用量不大时可用。用量上去或谷歌要求时，再由业主在后台填签名密钥、另开任务 |

## 本期不做

- 网址数字签名（见待确认 4）。
- 坐标限制在渠道授权的城市范围内：现在靠每个地址的限频和全站每日上限控制费用；需要时加。
- 多进程共享冷却和「并发只调一次」：同 ADR 0042，最坏每个进程各调一次，每日上限仍在库里统一计数，不会超。
- 前端（同一任务的前端部分）：右侧栏 `<img>` 按主题、尺寸、倍率请求；`NOT_ENABLED` 退回 Leaflet 地图，`UNAVAILABLE` 只显示时间和距离；端到端测试的假谷歌加 `GOOGLE_STATIC_MAPS_URL`（`apps/api/src/testing/fake-integrations.ts` 的 `startFakeGoogleStaticMaps`）。
