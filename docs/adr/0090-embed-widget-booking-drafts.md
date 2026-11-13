# ADR 0090：嵌入预订组件——预订草稿 + 短编号、`/embed/v1` 域名白名单

- 状态：已采纳（2026-11-13，待独立审查）。
- 依据：业主 2026-11-13 新需求第 ③ 部分「嵌入组件」（原话见 `docs/requirements/03-route-charter-order-embed.md`，在 PR #186 分支上）；业主口径：区间 / 包车两个标签，Shadow DOM 隔离样式，提交跳主站预订页，嵌入码绑定域名白名单，后台生成嵌入代码。
- **取代 ADR 0087 草稿（PR #186，未合并）中的**：第三节「预订草稿」、第五节「`/embed/v1`」「组件脚本和路由同步」、第六节「安全」、第七节和第八节里嵌入组件的部分。0087 其余部分的去向：
  - **已由 ADR 0088 / 0089 实现**（所以不采用 0087 的做法）：包车填途经点和停留、按全程时长和公里算最终价、价格明细和行程时间表——走 `POST /site/v1/quotes`（`itinerary_pricing` + `waypoints`），不另开 `charter-route` 接口、不建 `route_itineraries`。
  - **这次不做**：① 模型线路（需求 03 第 1.7 节、R21–R23；ADR 0088「范围」也列在不做里）——嵌入组件不依赖它，先把组件上线；另立任务 M9E-04。② 统一订单格式里的「订单行程方式」（需求 03 F1–F3：`transfer` / `charter_package` / `charter_route`，订单上的地点列表）——订单已经有上下车点、经停点（ADR 0088 的 `orders.waypoints`）和锁定的报价编号，缺的只是一个统一的「行程方式」字段和把它给三个入口共用的结构；本篇只做其中的「渠道来源」（第三节第 3 小节）。另立任务 M9E-05。两项都要先请业主确认还要不要按 03 原样做（第八节）。
- 报价引擎、比价、下单流程一行不改；组件不询价、不下单、不显示价格。

## 一、总体

```
合作网站页面
  <div id="nozomi-booking"></div>
  <script src="https://<主站>/embed/widget-v1.js"></script>
  <script>NozomiBooking.init({ key: "nze_…", root: "#nozomi-booking" })</script>
        │ ① GET  /embed/v1/config?key=…            （跨域，只对白名单 Origin 回 CORS 头）
        │ ② GET  /embed/v1/places/autocomplete|details（跨域，地址输入即提示）
        │ ③ POST /embed/v1/booking-drafts?key=…    （跨域，建预订草稿，返回 43 位短编号）
        ▼
  整页跳转 https://<主站>/book/new?draft=<短编号>
        │ ④ GET /site/v1/booking-drafts/{id}       （同源，读草稿预填）
        ▼
  主站原有的询价 → 选车 → 乘客信息 → 付款（不跨域、不变）
```

## 二、预订草稿

### 1. 为什么用草稿、不把条件放进链接

10 个经停点加名称放进链接会接近测试服务器前面共用 nginx 的请求行上限（不能 SSH、不改它）；而且只有服务端能记下「从哪个网站来」。所以组件先把预订条件 POST 到服务端暂存，跳转链接只带一个短编号。

### 2. 预订条件 v1（domain 的 `BookingDraft` 类型和 `bookingDraftIssues` 校验）

```json
{
  "v": 1,
  "tab": "charter",
  "service_local": "2026-12-01T09:00",
  "pickup":  { "name": "銀座", "lat": 35.6717, "lng": 139.765 },
  "dropoff": { "name": "新宿駅", "lat": 35.6896, "lng": 139.7006 },
  "waypoints": [ { "name": "富士山五合目園地", "lat": 35.3955, "lng": 138.7334, "stay_minutes": 120 } ],
  "package_hours": null,
  "passengers": 2,
  "luggage": 2,
  "lang": "ja"
}
```

| 键 | 规则（和 `/site/v1/quotes`、`/book/new` 页面同一口径） |
| --- | --- |
| `v` | 固定 1 |
| `tab` | `transfer`（区间：接送机 / 点对点，由 `/book/new` 按地点自动判断，同 ADR 0081）或 `charter` |
| `service_local` | 城市当地 `YYYY-MM-DDTHH:mm`；只校验格式和日历合法，不校验是否已过去（过去的由 `/book/new` 现有校验提示） |
| `pickup`、`dropoff` | 必填；名称 1–200 字（同 `/site/v1/quotes` 经停点名称上限）；纬度 −90～90、经度 −180～180 |
| `waypoints` | 只有 `charter` 可以有；0–10 个（`QUOTE_RULES.maxWaypoints`）；每个带 `stay_minutes`：30 的倍数、30–480（同页面的停留选项） |
| `package_hours` | 只有 `charter` 且没有经停点时可以给（1–`PRICE_LIMITS.maxPackageHours` 的整数），客人仍可在 `/book/new` 改；有经停点时必须为 `null`（按行程计价自动选套餐，ADR 0089）；`transfer` 必须为 `null` |
| `passengers`、`luggage` | 整数，乘客 1–60、行李 0–60（同 `/site/v1/quotes`） |
| `lang` | `zh` / `ja` / `en`；`/book/new` 目前只有中文，先只记下 |

- **不含价格、报价编号、任何客人个人信息**：只有上面这些键，多一个键就拒（`additionalProperties: false`；测试：多一个 `passenger` 键 400）。姓名、电话、邮箱在 `/book/new` 填。
- **已知限制**：地点名称是自由文本，客人可能把电话填进去；不做内容识别，靠 2 小时过期删除兜底；组件和 `/book/new` 的地址框都提示「只填地点，不要填姓名、电话」。
- 序列化后 ≤ 16 KB（库里 check 约束 `octet_length(content::text) <= 16384`；10 个经停点 × 200 字名称远小于这个数）。

### 3. 表 `booking_drafts`（平台表，不带 `tenant_id`：不属于任何供应商）

| 列 | 说明 |
| --- | --- |
| `id` text 主键 | 32 字节密码学随机数的 base64url，43 字符（256 位熵）：不可猜、不可枚举、不含时间 |
| `content` jsonb | 预订条件 v1 |
| `embed_key_id` uuid null、`embed_origin` text null、`return_url` text null | 建草稿时服务端记下的来源（第四节）；M9E-01 时只建列，全为空 |
| `created_at`、`expires_at` | 有效期 **2 小时**（`BOOKING_DRAFT_TTL_MINUTES = 120`） |

- 写入后不改：数据库角色只给 `select, insert, delete`，不给 `update`。
- 有效期内可以反复打开（刷新、退回再进都行）；过期和不存在一样是 404。
- 2 小时：客人比价、选车、填信息、付款（报价、待支付各 30 分钟）并允许刷新，足够；更长只是让坐标多留在库里。
- **清理任务** `BookingDraftRetentionJobs`（同 `ManualQuoteRetentionJobs` 的做法）：启动 20 秒后第一次，之后每小时一轮；每轮最多 10 批、每批 500 行，`delete … where expires_at < now()`。

### 4. 读取 `GET /site/v1/booking-drafts/{id}`（同源）

- 200 `{ draft, expires_at }`；**不返回**嵌入码编号、来源、`return_url`。
- 过期、不存在、编号格式不对：都是 404 `BOOKING_DRAFT_NOT_FOUND`，不区分。
- 每个来源地址每分钟 60 次（现有站点限速表），超了 429。
- 不带任何 CORS 头（`/site/v1` 永远不跨域）。

### 5. `/book/new?draft=<id>`

- 读到草稿：预填用车类型、上 / 下车点、经停点和停留、日期时间、人数行李、包车时长；条件齐全时自动询价（直接到第 2 步，同现有链接参数的做法）。
- 404：页面顶部提示「链接已过期，请重新填写」，留空白表单；网络错误：提示「没能读取预订信息，请重新填写」。
- 带 `draft` 时忽略其他旧链接参数；不带时旧参数（`from`、`to`、`date`、`time`、`pax`、`bags`、`mode`）照旧。
- 主站自己的入口不建草稿，**不开** `POST /site/v1/booking-drafts`：少一个对外可写的接口。

## 三、嵌入码与域名白名单

### 1. 表 `embed_keys`（平台表）

| 列 | 说明 |
| --- | --- |
| `id` uuid | 内部编号 |
| `key` text 唯一 | 公开嵌入码 `nze_` + 24 字节随机数的 base64url；**不是密钥**，写在合作网站页面里 |
| `name` | ≤ 60 字 |
| `allowed_origins` text[] | 1–20 个 origin，规范化后存（第五节第 1 小节） |
| `default_lang` | `zh` / `ja` / `en` |
| `default_services` text[] | `transfer`、`charter` 的非空子集，顺序即标签顺序 |
| `status` | `active` / `disabled` |
| `note` | ≤ 500 字 |
| `version` int | `If-Match` 乐观锁 |
| `created_at`、`updated_at` | |

- 不预置任何嵌入码（规则 1）。
- 嵌入码、报价来源、订单来源三张表在同一个迁移里建（M9E-02）。
- 权限：`embed.read`（超级管理员、运营、渠道经理、只读）、`embed.manage`（超级管理员、运营、渠道经理）；不按城市 / 渠道范围限定（嵌入码是全平台的）。
- 平台接口：`GET/POST /platform/v1/embed-keys`、`GET/PATCH /platform/v1/embed-keys/{id}`（`If-Match`，409 版本冲突）；新建、改白名单、停用 / 启用都写审计。
- 运营后台「渠道 → 嵌入组件」：列表、新建、编辑、停用；详情页显示嵌入代码（第六节）和「复制代码」，并写明合作网站的内容安全策略要在 `script-src`、`connect-src` 放行主站域名。
- 生效：服务端每次请求都查库（嵌入码按 `key` 有唯一索引），改白名单、停用立即生效；组件的配置应答 `Cache-Control: private, max-age=60`，所以浏览器侧 60 秒内生效。

### 2. `/embed/v1`（跨域只开在这里）

| 接口 | 规则 |
| --- | --- |
| `GET /embed/v1/config?key=` | 200 `{ lang, services, site_origin }` |
| `GET /embed/v1/places/autocomplete`、`/places/details` | 同 `/site/v1/places/*` 的实现、每日上限、每地址限速；另加每个嵌入码每分钟 600 次 |
| `POST /embed/v1/booking-drafts?key=` | 请求体 `{ draft, return_url? }`；超过 16 KB 在解析前 413；`draft` 按 `bookingDraftIssues` 严格校验，不合格 400 `VALIDATION_FAILED`；`return_url` 不合格时忽略（不报错、不存）；成功 201 `{ id, expires_at, url }`（`url` = 主站 `/book/new?draft=<id>`）。限速：每个来源地址 10 分钟 30 次（IPv6 按 /64）、每个嵌入码每分钟 60 次，超了 429 `RATE_LIMITED`；每个嵌入码同时有效的草稿最多 5,000 个（`BOOKING_DRAFT_LIMITS.activePerKey`），满了 429 `EMBED_DRAFT_LIMIT` |
| 以上接口的 `OPTIONS` 预检 | 同样按 `key` + `Origin` 核对；通过回 `Access-Control-Allow-Methods: GET, POST`、`Access-Control-Allow-Headers: content-type`、`Access-Control-Max-Age: 600` |

共同规则：

- **核对在解析请求体之前**：嵌入码和 `Origin` 的核对放在路由的 `onRequest` 钩子里，比解析请求体（含 16 KB 上限的 413）、限速都早。
- `Origin` 规范化后与这个嵌入码的白名单某项**完全相等**才处理；`Origin: null`、没有 `Origin`、不在白名单、嵌入码不存在或停用 → 403 `EMBED_ORIGIN_NOT_ALLOWED`，**不带** `Access-Control-Allow-Origin`（只带 `Vary: Origin`，免得缓存把一个来源的应答给了另一个来源）。
- 来源一旦核对通过，这次请求的**所有应答**（200、201、400、413、429 含 `EMBED_DRAFT_LIMIT`、500）都带 `Access-Control-Allow-Origin: <请求的 Origin>` 和 `Vary: Origin`，组件才读得到状态码和错误码；**不开** `Access-Control-Allow-Credentials`；组件请求一律 `credentials: "omit"`。
- 被拒的 403 在浏览器里读不出来（`fetch` 只得到网络错误），所以组件**分不出「未授权」和「连不上」**，按下面第四节的说法处理。
- `/site/v1`、`/platform/v1`、`/tenant/v1`、`/sales/v1`、`/driver/v1` 永远不带 CORS 头（集成测试带白名单 `Origin` 扫一遍）。报价、下单不跨域。

### 3. 来源只做统计

- `POST /site/v1/quotes`、`/quotes/by-points` 加可选 `draft_id`。`draft_id` 格式不对、不存在、已过期、草稿没有来源时**一律忽略**：不报错、不影响报价，只是不记来源（集成测试覆盖）。草稿有效时，服务端把草稿上的来源（`embed_key_id`、`embed_origin`、`return_url`）按报价编号记进平台表 `quote_embed_sources`（不进报价快照、不影响价格和比价）。
- 下单时取报价的来源，再核一次「嵌入码仍启用、`embed_origin` 仍在当前白名单」：通过记一行订单来源（嵌入码、网站、`return_url`——`return_url` 也再按当前白名单核一次才存）；否则不记，按主站（`book`）算，**不拒单、不报错**。
- **存在哪里**：报价的来源、订单的来源各放一张平台表（`quote_embed_sources`、`order_embed_sources`），**不加在 `quotes` / `orders` 上**：租户角色（`nozomi_app`）对 `orders` 是整表 `select`（行级安全只按行过滤、不按列），来源加成列供应商在库里就读得到；`quotes` 虽然只给平台角色，报价、订单的来源也一起放单独的平台表，口径一致、写入后不能改。一个迁移（M9E-02），只建表、不回填：旧订单没有这一行，按主站显示。写入后不能改：平台角色对这两张表只有 `select` / `insert`（没有 `update` / `delete`），作用等同 `orders` 的「不可改列」触发器。
- 订单来源只给官网订单应答（只给 `return_url`，用来显示「返回原网站」）和运营后台（来源「嵌入组件 · <网站>」）；`/tenant/v1` 和供应商 Webhook 不给（集成测试扫键）。
- 来源**只用于统计**，不作为分佣、结算或任何金额的依据：非浏览器程序可以伪造 `Origin`。以后要分佣，先重新设计来源证明（例如合作方服务端签名），另写 ADR。

## 四、组件脚本 `widget-v1.js`

- 前端构建产物：`apps/web` 单独的构建入口，产出 `dist/embed/widget-v1.js`，由 Caddy 当静态文件给；**不放在** `/embed/v1/` 下（那个前缀整个归 API）。
- `apps/web/src/lib/api-prefixes.ts` 加 `/embed/v1`（Vite 代理、`edge-config.ts` 的转发规则都从这张表来）；`edge-config.ts` 给 `/embed/widget-v1.js` 单开响应头：`text/javascript`、`Cache-Control: public, max-age=300`、`Cross-Origin-Resource-Policy: cross-origin`、`nosniff`；不存在时 404，不落到 `index.html`。
- `NozomiBooking.init({ key, root, lang?, services?, redirectUrl? })`：`root` 是选择器或元素，找不到时控制台报错、不渲染；`lang`、`services` 不合法时用后台默认；`redirectUrl` 原样交给建草稿接口，由服务端校验。
- 两个标签：「区间」（出发地、目的地、日期、时间、人数、行李）、「包车」（上车点、经停点 + 停留、下车点、日期、时间、人数、行李；不填经停点时选包车时长）。地址经 `/embed/v1/places/*` 输入即提示。
- 样式在 Shadow DOM 里（`adoptedStyleSheets`，不支持时退回 `<style>`），和合作网站互不影响；不加载任何第三方资源（字体、图标都内联或用系统字体）；gzip 后 ≤ 60 KB（构建测试检查）。
- 点「查询价格」：先建草稿，成功后整页跳转返回的 `url`；失败时在组件里提示、不跳转。草稿在点按钮时才建，所以页面开着多久都不影响来源。
- **失败时的说法**（403 读不出，和网络错误分不开）：
  - 打开时取配置失败（读不出状态：未授权或连不上）：显示「预订组件暂时无法使用。请稍后刷新，或直接到主站预订。」和主站链接；不显示表单。控制台另输出一句开发者看的提示「请确认本网站已加入嵌入码的白名单」。
  - 建草稿 400：「有几项填得不对，请检查后再试」并标出是哪一项；429 `RATE_LIMITED`：「操作太频繁，请稍等一分钟再试」；429 `EMBED_DRAFT_LIMIT`：「暂时无法查询，请稍后再试或直接到主站预订」；413、读不出的失败：「暂时连不上，请稍后再试或直接到主站预订」。
- 地址输入即提示来自谷歌：候选列表下方显示「Powered by Google」标识，和主站 `/book/new` 地址框的做法一致（同一张图、同样位置）。
- 容器 320 px 不横向滚动；键盘能走完；axe 无严重问题。

## 五、安全

### 1. 白名单的边界

- 浏览器跨域请求自动带 `Origin`，网页脚本改不了；主站只对白名单 origin 回 CORS 头，所以未授权网站上的组件读不到配置、建不了草稿。
- origin 规范化：WHATWG URL 解析；协议只收 `https:`（`APP_ENV` 是 `local` / `ci` / `staging` 时另收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`）；主机名小写、punycode；去掉默认端口；不能有路径（`/` 除外）、查询、片段、用户名密码；不支持通配符。比较时**完全相等**，不按后缀、主机名、包含。
- 白名单防的是「别人把组件放到未授权网站上」，不是访问控制；非浏览器程序伪造 `Origin` 能拿到的只是公开配置、地址提示、一个 2 小时的草稿（受限速和数量上限）——和直接用主站一样。下单安全仍是 `/book/new` 和 `/site/v1` 现有的校验。
- 嵌入码是公开标识；草稿编号不可猜、不可枚举，过期和不存在不区分，读取有限速。
- **已知限制：每码 5,000 个有效草稿可能被人占满。** 伪造 `Origin` 的人换很多来源地址（IPv6 一个 /64 就够多），2 小时内建满 5,000 个，正常客人在这段时间里会被 429 `EMBED_DRAFT_LIMIT` 挡住（组件提示「暂时无法查询，请稍后再试或直接到主站预订」）。应对：同一个嵌入码的有效草稿到 80%（4,000 个）时写一条告警日志（`embed.draft_limit_near`，运维告警按它报）；运营在后台给这个合作网站新建嵌入码、停用旧码（合作网站换一行代码），旧码的草稿 2 小时内自然过期。上限本身不调大：它限制的是一个码最多占的库空间（约 80 MB）。

### 2. `redirectUrl` / `return_url` 校验（domain 的 `embedReturnUrl`；建草稿、下单两处都调用）

1. ≤ 2,000 字符；WHATWG URL 解析，失败就拒。
2. 协议规则同 origin（只收 https，测试环境另收 localhost）；`javascript:`、`data:`、`blob:`、`file:` 一律拒。
3. 不能带用户名、密码。
4. 它的 origin 必须**完全等于**白名单某项，**并且等于建草稿请求的 `Origin`**。
5. 下单时对**当前**白名单再核一次，通过才存进订单；订单页「返回原网站」链接 `rel="noopener noreferrer"`。

测试用例至少：`javascript:alert(1)`、`data:text/html,…`、`https://user:pass@embed-demo.moveglobal.io/`、`https://embed-demo.moveglobal.io.evil.example/`、`https://evil.example/?u=https://embed-demo.moveglobal.io`、`https://embed-demo.moveglobal.io:8443/`（白名单没写端口时拒）、`http://embed-demo.moveglobal.io/`、2,000 字符过 / 2,001 字符拒、白名单里有但不等于请求 `Origin` 的另一个域名、建草稿后从白名单移除再下单。

### 3. 为什么不用 iframe

- 组件是脚本 + Shadow DOM，在合作网站页面里渲染，主站的 `frame-ancestors 'none'`、`X-Frame-Options: DENY`（ADR 0046）不变。
- 组件受合作网站的内容安全策略约束：对方要在 `script-src`、`connect-src` 放行主站域名；生成代码的页面写明。
- 演示站和测试环境同属 `moveglobal.io`（同站不同源）：组件只请求 `/embed/v1` 且 `credentials: "omit"`，主站 Cookie（验收会话 `nozomi_qa`，`Path=/site/v1`）不会带上。

## 六、合作网站放的代码（后台详情页生成）

```html
<div id="nozomi-booking"></div>
<script src="https://<主站域名>/embed/widget-v1.js" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.init({ key: "nze_<嵌入码>", root: "#nozomi-booking", lang: "ja", services: ["transfer", "charter"] });
  });
</script>
```

## 七、测试计划

| 层 | 内容 |
| --- | --- |
| domain 单元 | `booking-draft.test.ts`：区间 / 包车的键、10 个经停点 × 200 字 ≤ 16 KB、多余键和个人信息键被拒、停留 45 分被拒、有经停点时 `package_hours` 必须为空、日期时间格式；`embed-origin.test.ts`、`embed-return-url.test.ts`：第五节全部用例 |
| 集成（真实 PostgreSQL） | 草稿：读到 / 过期和不存在同 404 / 格式不对 404 / 无 CORS / 限速 / 清理任务只删过期的 / 数据库角色不能 `update`；嵌入码：权限矩阵、`If-Match` 409、审计、白名单校验；`/embed/v1`：白名单 / `null` / 缺 Origin / 停用 / 预检、16 KB 413、每地址 / 每嵌入码限速、5,000 上限、`return_url` 不合格被忽略；来源：草稿 → 报价 → 下单记 `embed`，下单前移出白名单记 `book`；`/tenant/v1`、Webhook 扫键无来源字段；`/site/v1` 等永不带 CORS |
| 前端组件 | `/book/new?draft=` 预填区间 / 包车 / 经停点、过期提示；运营后台嵌入码列表、表单、代码；组件的两个标签、未授权、建草稿失败提示 |
| 端到端 | 两个本机 origin（白名单内、外）的宿主页：白名单的建草稿 → 跳 `/book/new?draft=` → 自动询价，价格等于在主站手填同样条件；非白名单（需求 03 E2，按本篇改写）显示「预订组件暂时无法使用…」、不显示表单；建草稿 429 / 400 / 网络错误（E12，改写）各显示第四节的说法、不跳转；宿主页全红样式不影响组件；320 px、axe |

所有测试数据在测试里构造、结束清理；不预置任何嵌入码、草稿。

## 八、待业主确认（答复前一律按「推荐」做，不停工）

需求 03 末尾的 Q 表业主还没答复。下面是本篇按推荐定下、业主改主意时要改的地方：

| # | 问题 | 本篇的做法（推荐） | 业主改主意时改哪里、代价 |
| --- | --- | --- | --- |
| Q7 | `redirectUrl` 是什么 | 付款后订单页「返回原网站」的链接，必须在白名单网站下（第五节第 2 小节） | 若要当「预订页地址」：有钓鱼风险，不建议；若不要这个功能：组件不传、订单页不显示，删一个字段，半天 |
| Q8 | 语言 | 组件可选中文 / 日文 / 英文；跳到的 `/book/new` 目前只有中文，客人体验会断开 | `/book/new` 多语言随 M8-08 的 B3；在那之前若要求一致，组件只开中文，改默认值，半小时 |
| Q9 | 演示站接哪个环境 | 测试环境（用 Stripe 测试卡验收） | 接正式环境：在正式站建嵌入码、白名单，演示站换一行代码，半小时；但只能真钱下单 |
| Q10 | 演示站现有的 Good Journey 占位组件 | 去掉（业主在 MoveGlobal 工厂后台、站点 ID 73 操作） | 保留：两个组件并存，不影响我们的代码 |
| Q11 | 嵌入组件的单要不要单独渠道 / 加价 | 和官网同渠道、同价，只记来源（只做统计） | 每个合作网站一个渠道：嵌入码绑渠道、询价用那个渠道的客户端，约 2 天，另写 ADR；分佣先重新设计来源证明 |
| Q14 | 跳 `/book` 还是 `/book/new` | 跳 `/book/new`：新预订页是现在的正式预订入口，经停点和按行程计价只在新页面上 | 若要 `/book`：`/book` 带 `draft` 时转到 `/book/new`，一行路由，半小时 |
| Q16 | 草稿有效期 | 2 小时 | 改常量 `BOOKING_DRAFT_RULES.ttlMinutes`，几分钟；更长只是坐标多留在库里 |
| — | 地点名称上限 | 200 字（同 `/site/v1/quotes` 现有上限）；需求 03 写的是 240 | 要 240：询价接口、草稿、库约束三处一起放宽，半天；03 的 F7「240 字」作废，按 200 验 |
| — | 途经点个数 | 10 个（随 ADR 0088 `QUOTE_RULES.maxWaypoints`）；需求 03 写的是 8 | 要 8：改一个常量，几分钟；03 的 F7「10 个地点」按 10 个途经点 + 上下车验 |
| — | 模型线路、订单行程方式（F1–F3） | 这次不做，另立 M9E-04、M9E-05（见文首） | 要做就按 03 原样排期，各约 2–3 天 |

## 九、分 PR（每个 PR：独立审查 → 合并 → 部署 → 测试站验收）

| 任务 | 内容 | 依赖 |
| --- | --- | --- |
| M9E-01 | `BookingDraft` 类型和校验、`booking_drafts` 表、`GET /site/v1/booking-drafts/{id}`、清理任务、`/book/new?draft=` 预填（草稿由测试直接写库） | 本篇 |
| M9E-02 | 嵌入码与白名单、运营后台页面和生成代码、`/embed/v1` 配置 / 地址提示 / 建草稿和 CORS、`return_url` 校验、来源只做统计（一个迁移：嵌入码、报价来源、订单来源三张表）、`api-prefixes` / `edge-config` / smoke | M9E-01 |
| M9E-03 | `widget-v1.js`：init、两个标签、Shadow DOM、先建草稿再跳转、失败提示、谷歌标识、大小预算、端到端 | M9E-02 |
| M9E-04 | 模型线路（需求 03 第 1.7 节）——待业主确认后排期 | M9E-01 |
| M9E-05 | 统一订单格式的「行程方式」（需求 03 F1–F3）——待业主确认后排期 | — |

测试站验收（M9E-03 之后）：演示站 `embed-demo.moveglobal.io` 加入白名单，业主在 MoveGlobal 工厂后台（站点 ID 73）放代码；区间、包车各用 Stripe 测试卡完整下一单；非白名单域名被拒。
