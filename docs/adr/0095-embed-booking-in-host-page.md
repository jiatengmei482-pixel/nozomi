# ADR 0095：预订流程整体嵌在合作网站页面里——`bookingUrl`、`mountBooking`、`/embed/book`、按嵌入码生成 `frame-ancestors`

- 状态：**草案**（2026-11-14，M9E-15）。业主 / 监工确认第十二节的待定事项后改为「已采纳」再开工；确认前不写代码。
- 依据：业主 2026-11-14 新需求（监工转达）：客人从合作网站预订时不离开合作网站，像 Good Journey（下称 GJ）那样，把整个预订流程嵌在合作网站的 `/booking/` 页里。参数名先按工厂整站开发提的写（`bookingUrl`、`mountBooking`）。
- **补充 ADR 0090**（嵌入组件）：组件多一个「草稿建好后跳到合作网站自己的预订页」的去处，多一个在合作网站页面里挂整个预订流程的方法。0090 的草稿、嵌入码、白名单、`/embed/v1`、来源统计都不改；不传新参数时组件行为逐字不变。
- **局部修订 ADR 0090 第五节第 3 小节「为什么不用 iframe」和 ADR 0046「`X-Frame-Options: DENY` 不变」**：只有新路由 `/embed/book` 可以被嵌，并且只允许被那一个嵌入码白名单里、本次声明的那一个网站嵌入；其余所有页面仍然 `frame-ancestors 'none'` + `X-Frame-Options: DENY`。
- **不改**：主站 `/book`、`/book/new`、`/book/order` 的流程和外观；报价引擎、比价、下单接口、付款状态机、Webhook、超时取消、退款、取消规则、邮件。

## 〇、结论先说

1. **主站现在用的就是 Stripe Payment Element，不是 Stripe 托管 Checkout**（ADR 0046，`lib/payment-driver.ts`）。所以「改用 Payment Element」不是新做一套付款，而是把现有付款区块原样放进嵌入页；后端付款（`order_payments`、Webhook、30 分钟超时取消、退款）**一行不改**。嵌入页真正要新做的是：嵌入页自己的内容安全策略、3D 验证弹窗在 iframe 里的显示位置、银行回跳落在 iframe 里。
2. **`/embed/book` 的 `frame-ancestors` 由应用算、由 Caddy 加**：Caddy 用 `forward_auth` 先问 API「这个嵌入码 + 这个宿主网站能不能嵌」，API 回一个只含**这一个**宿主 origin 的值，Caddy 拼进响应头。不缓存（`no-store`），改白名单、停用嵌入码在**下一次打开页面时**生效。
3. **不依赖任何 Cookie**：嵌入页调用的是同源的 `/site/v1`（iframe 的文档就在主站域名下），草稿用现有 43 位草稿号，订单用现有 `nzo_` 查看令牌（`Authorization` 请求头），都不是 Cookie，第三方 Cookie 被拦不影响。所以 CSRF 不适用；点击劫持靠 `frame-ancestors` 只放行一个网站。
4. **postMessage 双向核对 origin**，消息里只有步骤名、高度、订单号、错误代码，不带姓名、电话、邮箱、价格、令牌。
5. **谷歌地图条款**：嵌入页只用谷歌静态路线图（谷歌自己的地图），**不带 Leaflet 后备图和 Leaflet 地图选点**（ADR 0094 已认定把 Places / Routes 内容画在非谷歌地图上不合规，主站的同一问题由 M10-01 处理）。
6. **分四期，约 16–21 人日**（第十一节）：草稿跳宿主页 + `mountBooking` 骨架 + 动态 `frame-ancestors` → 嵌入预订页 → 付款进 iframe → 工厂接入和测试站验收。

## 一、现状（对照代码，2026-11-14 的 main）

### 1. 草稿怎么跳转、来源怎么记

- 组件 `widget-v1.js`（`apps/web/src/embed/widget-ui.ts`）点「查看价格」：`POST /embed/v1/booking-drafts?key=…`（跨域，只对白名单 `Origin` 回 CORS 头，`apps/api/src/routes/embed.ts`）→ 拿到 43 位草稿号 → `window.location.assign(<主站>/book/new?draft=<号>)` 整页跳到主站。
- 主站 `/book/new` 用 `GET /site/v1/booking-drafts/{id}` 读草稿预填（`BookNewPage.tsx`），齐了自动询价到第 2 步。
- 来源：询价带 `draft_id` 时，服务端把草稿上的嵌入码、宿主 origin、`return_url` 按报价编号记进 `quote_embed_sources`；下单时再核一次（嵌入码仍启用、宿主仍在白名单）才记 `order_embed_sources`（`apps/api/src/services/embed.ts`）。只做统计。
- **已知缺陷，正由 M9E-12 修**：main 上 `/book/new` 询价时没带 `draft_id`，所以组件来的单全记成「主站」。M9E-12（分支 `m9e-12-draft-source`，待验收）让接送、包车两种询价都带上。**本篇的嵌入页复用 `/book/new` 的询价代码，依赖 M9E-12 先合并**；嵌入页的端到端测试要断言来源记成嵌入组件。

### 2. 付款

- **Stripe Elements 的 Payment Element**（ADR 0046）：订单页 `/book/order` 的付款区块挂 Payment Element（`layout: "tabs"`，`wallets` 三项都是 `never`），`stripe.confirmPayment({ redirect: "if_required", return_url: <主站>/book/order })`。3D 验证一般在 Stripe 的弹窗里完成，少数情况整页去银行再回到 `return_url`，令牌临时放本标签页 sessionStorage 的 `nozomi.payment-return` 取回。
- 后端（ADR 0026、0029）：下单建 Customer + PaymentIntent（`setup_future_usage: "off_session"`，只收银行卡 `allowed_payment_method_types: ["card"]`，以便事后加收离线扣款）；订单是否确认**只认 Webhook**（和超时检查主动去查）；待支付 30 分钟超时取消；退款、事后加收走 `order_payments`。
- Stripe.js 加载前令牌先离开地址栏（M3-13，放进 `history.state`），防止 Stripe 的风控脚本读到令牌的哈希。

### 3. CSP / X-Frame-Options

- `deploy/Caddyfile` 的全局 `header` 块对**所有**响应加 `X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、HSTS、`nosniff`。
- `Content-Security-Policy` 由构建前端镜像时生成的片段 `/etc/nozomi/web.caddy` 加（`apps/web/build/edge-config.ts` 的 `renderEdgeConfig`）：两条互斥的表达式匹配器，按**未解码的原始请求地址** `{http.request.orig_uri}` 和正则 `SITE_PAGE_URI_PATTERN` 判断——官网四个页面（`/book`、`/book/checkout`、`/book/order`、`/book/new`）的策略放行 Stripe，其余不放行；两条都带 `frame-ancestors 'none'`。
- 嵌入组件脚本 `/embed/widget-v1.js` 单独有 `Cross-Origin-Resource-Policy: cross-origin`、5 分钟缓存。
- 测试环境前面还有一层共用 nginx（不能 SSH、不能改，ADR 0090），它会不会自己加 `X-Frame-Options` / CSP **还没核实**（第一期第一步用 `curl -I` 查）。

### 4. 订单页怎么用 `#nzo_` 访问

- 下单成功时服务端生成 `nzo_<32 字节随机数>`，库里只存 SHA-256（`site_order_links`），原文只在下单应答里给一次；页面跳到 `/book/order#<令牌>`，前端用 `Authorization: Bearer` 调 `/site/v1/order…`（ADR 0032）。不用 Cookie。
- 有效期按查看时算：用车时间后 30 天，至少到发链接后 1 天。链接丢了用「订单号 + 邮箱 / 手机号」找回，发新令牌。
- 邮件里的订单页链接是发邮件时另生成的令牌，地址是 `<publicBaseUrl>/book/order#<令牌>`（`notification-jobs.ts`），永远指向主站。

### 5. 其他和本篇有关的现状

- `/book/new`、订单页只有中文界面（日英韩界面是 M8-08 的 B 类待确认项）；组件有中 / 日 / 英。
- `/book/new` 的路线图：先用谷歌静态地图（ADR 0072，后端代调，密钥不进浏览器），拿不到时退回 Leaflet 画的路线图（`RouteMap.tsx`）；地点框可以打开 Leaflet 地图选点（`SiteMapPicker.tsx`）。这两处按 ADR 0094 有谷歌条款风险，由 M10-01 处理。
- 测试环境验收通道的 Cookie `nozomi_qa`（ADR 0078）是 `Path=/site/v1; SameSite=Strict`。
- 前端是一个单页应用，产物只有一个 JS、一个 CSS（`e2e/build-output.spec.ts`）。
- 演示站 `embed-demo.moveglobal.io` 现在没有 CSP（M9E-09 改动说明第 1 节）；GJ 组件的 `redirectUrl` 在 GJ 里是「预订页地址」（`https://embed-demo.moveglobal.io/booking/`），**和我们 ADR 0090 的 `redirectUrl`（付款后「返回原网站」）意思不同**，见第十二节 Q1。

## 二、总体

```
合作网站任意页（查价表单）                          合作网站 /booking/ 页
  NozomiBooking.init({ key, root,                  NozomiBooking.mountBooking({ key, root, lang?, redirectUrl? })
    bookingUrl: "https://宿主/booking/" })            │ 地址带 nzdraft：
        │ ① POST /embed/v1/booking-drafts（不变）       │ ③ 建 <iframe src="https://<主站>/embed/book?draft=…&key=…&lang=…&host=<宿主 origin>#ch=<随机>">
        │ ② 整页跳到 bookingUrl?nzdraft=<草稿号>  ──────▶│     ├ Caddy forward_auth → API 核对 key + host → 回 frame-ancestors <宿主 origin>
        ▼                                               │     ├ iframe 内：读草稿 → 询价（带 draft_id）→ 选车 → 乘客 → 核对 → 下单 → Payment Element 付款 → 成功页
  （不传 bookingUrl：照旧跳主站 /book/new?draft=）      │     └ postMessage：ready / resize / step / modal / completed{orderNo} / error
                                                        │ 地址不带 nzdraft：在 root 里画查价表单（= init，bookingUrl 默认本页）
```

iframe 里的文档在主站域名下，所以它调 `/site/v1` 是**同源请求**：不需要 CORS，不需要 Cookie，`/site/v1` 仍然永远不带 CORS 头（ADR 0090 不变）。

## 三、脚本方法（`widget-v1.js`，同一个文件，不改脚本地址）

### 1. `NozomiBooking.init({ …, bookingUrl? })`

- 新增可选参数 `bookingUrl`：合作网站自己预订页的完整网址。
- 传了且合格：草稿建好后整页跳到 `bookingUrl` 加查询参数 `nzdraft=<草稿号>`（保留 `bookingUrl` 原有的查询参数和 `#`，`URL.searchParams.set`，已有 `nzdraft` 覆盖）。
- 合格的条件（组件里判断，不合格就在控制台报一句、**按没传处理**，照旧跳主站）：WHATWG URL 能解析；`https:`（本机测试另收 `http://localhost`、`http://127.0.0.1`，同 ADR 0090 的 origin 规则）；不带用户名密码；**origin 必须等于当前页面的 `location.origin`**。理由：草稿号只该交给建草稿的这个网站；跨域名的预订页（例如 `www.` 和裸域）要求合作方在两个域名上都放组件，避免把草稿号送到别的网站。是否放宽成「白名单里任意一项」见 Q2。
- 没传：行为和现在**逐字一样**（组件测试固定「没传 `bookingUrl` 时跳 `<主站>/book/new?draft=`」）。
- 服务端不需要知道 `bookingUrl`；但建草稿请求多带一个 `delivery: "host_page"`（没传 `bookingUrl` 时不带），服务端存在草稿上，下单时随来源一起记，用来统计「嵌在宿主页」和「跳主站」各多少单（第八节；Q6）。

### 2. `NozomiBooking.mountBooking({ key, root, lang?, redirectUrl?, onEvent?, title? })`

- `key`、`root`、`lang` 同 `init`。
- `redirectUrl`：**沿用 ADR 0090 的意思**——付款后订单页「返回原网站」的链接、写进订单来源的 `return_url`；在 `mountBooking` 里只在「不带 `nzdraft`、画查价表单」时用（交给建草稿接口，服务端照 0090 第五节第 2 小节校验）。带 `nzdraft` 时草稿上已经存了，不再传。见 Q1。
- `onEvent(event)`：可选回调，收到 iframe 的 `step`、`completed`、`error` 时调用（字段见第六节），合作网站可以用来做自己的统计或跳转；也同时在 `root` 元素上派发 `CustomEvent("nozomi:booking", { detail })`，两种用法任选。
- `title`：iframe 的无障碍标题，不传用按语言的默认值（「NOZOMI 用车预订」/「NOZOMI 配車予約」/「NOZOMI ride booking」）。
- **地址带 `nzdraft`**（`URLSearchParams`，格式不是 43 位 base64url 的当作不带）：
  1. 在 `root` 里建 `<iframe>`：`src = <主站>/embed/book?draft=<号>&key=<嵌入码>&lang=<语言>&host=<encodeURIComponent(location.origin)>#ch=<16 字节随机数>`；`title` 如上；`allow="payment"`（只为以后的钱包，见第七节第 4 小节；现在只收银行卡，不靠它）；`referrerpolicy="no-referrer"`；**不加 `sandbox`**（Stripe 文档：3D 验证的 iframe 不能被 sandbox，套在 sandbox 里的子框架会继承限制）；`loading` 不设（首屏内容）；初始高度 720px、宽 100%、无边框。
  2. 15 秒内没收到 `ready`：拿掉 iframe，在 `root` 里显示「预订页暂时打不开。请刷新，或到主站继续预订。」和链接 `<主站>/book/new?draft=<号>`（整页、新标签页均可，按 Q3）。被 `frame-ancestors` 拒绝时浏览器不告诉父页面，所以只能靠超时判断；控制台另写一句开发者提示「请确认本网站已加入嵌入码白名单」。
  3. 主站地址取自加载脚本的 `<script>`（同 ADR 0090 第四节），不取宿主页地址。
- **地址不带 `nzdraft`**：在 `root` 里画查价表单，等于 `init({ key, root, lang, redirectUrl, bookingUrl: <本页地址去掉 nzdraft> })`。客人点「查看价格」后整页跳回本页带 `nzdraft`，上面的分支接手。
- 同一页面重复调用：先拆掉上一次的 iframe 和监听（同 M9E-10 的重复 `init`）。
- **宿主地址里的 `nzdraft` 不主动删**：刷新页面要能接着用。草稿号会出现在合作网站的访问日志、统计脚本里；草稿只有地点、日期、人数（不含个人信息，ADR 0090 第二节），2 小时过期，这个暴露可接受。

## 四、嵌入预订页 `/embed/book`

### 1. 复用还是另写：复用 `/book/new` 的组件，用一个「宿主环境」上下文切换差异

- 不另写一套：另写就是两份询价、校验、乘客表单、核对、付款的代码，价格和规则迟早不一致（需求要求和主站一致）。
- 做法：把 `BookNewPage` 里和「页面外壳」有关的少数几处抽成一个上下文 `BookingShell`（默认值就是现在的主站行为）：

  | 差异点 | 主站（默认值，不变） | 嵌入页 |
  | --- | --- | --- |
  | 外壳 | `SiteLayout`（顶栏、页脚、右侧栏） | `EmbedLayout`：无顶栏页脚、单栏、宽度跟 iframe，右侧栏变成顶部可展开的摘要条（就是主站 < 1024px 的样子） |
  | 每一步的网址 | `/book/new?step=N`（`navigate`） | 仍用 `?step=N`，但在 iframe 自己的历史里；宿主的「后退」会先退 iframe 的步骤（浏览器行为），可接受 |
  | 下单后 | `navigate(/book/order#<令牌>)` | 进 `/embed/book/order`，令牌放 `history.state`（同 M3-13，不进地址） |
  | 路线图后备 | 静态图失败 → Leaflet `RouteMap` | 静态图失败 → 只显示「约 X 分钟 · Y 公里」，**不加载 Leaflet** |
  | 地图选点 | `SiteMapPicker`（Leaflet） | 不提供（只能从谷歌候选里选）；见第九节第 2 小节 |
  | 事件 | 无 | 每换一步、完成、出错时调 `postToHost`（第六节） |
  | 外链 | 本窗口 | 「到主站查看订单」等一律 `target="_blank" rel="noopener noreferrer"` |

- **怎么保证主站不变**：抽上下文是纯重构，主站传默认值；`book-new.test.tsx`、`site-*.spec.ts`（第十节清单）一条不改、全部通过；另加一条组件测试，固定主站模式下询价、下单的请求体与重构前逐字相同（M9E-12 之后的版本）。重构单独成一个提交，便于审查。

### 2. 路由和构建

- **同一个单页应用、同一份产物**加路由 `/embed/book`、`/embed/book/order`，外壳用 `EmbedLayout`。不单独建 Vite 入口：单独入口要改「产物只有一个 JS、一个 CSS」的检查和 Caddy 缓存规则，而且组件代码会分叉。代价：嵌入页要下载整个前端包（含后台代码、Leaflet，gzip 后约数百 KB；首屏性能在第二期量一次，太慢再拆包，另立任务）。
- 主站的路由表不受影响：`/embed/` 下的路径和 API 前缀 `/embed/v1`、静态文件 `/embed/widget-v1.js` 不重叠（`api-prefixes.ts` 的 `/embed/v1` 仍然整个归 API；Caddy 的 `@widget` 精确匹配那一个文件）。
- Caddy：`/embed/book`、`/embed/book/order`（同样按 `orig_uri` + 正则，不用 `path` 匹配器，理由同 ADR 0046）走新匹配器 `@embed_book_pages`，**先经过 `forward_auth`**（第五节），再 `try_files … /index.html`，`Cache-Control: no-store`。`/embed/book/别的` 不匹配：落到普通页面那条策略（`frame-ancestors 'none'`），嵌不进去。
- 银行回跳：嵌入页的 `return_url` 是 `<主站>/embed/book/order`（在 iframe 里打开），回跳后照 ADR 0046 的办法用 sessionStorage 取回令牌（第七节第 3 小节）。

### 3. 多语言

- 现状：组件三种语言，`/book/new` 和订单页只有中文。
- 本篇推荐（Q4）：**第二期就把嵌入页做成中 / 日 / 英**——嵌在日本合作网站里却只有中文，体验比跳主站更差（跳主站至少客人知道换了网站）。做法：把 `/book/new`、核对、付款区块、订单页用到的文案抽成按语言的字典（主站继续只用中文字典，逐字不变），嵌入页按 `lang` 参数选；付款出错的说法（`lib/payment-errors.ts`）一起翻；Stripe 表单按语言设 `locale`。日期时间、金额按语言格式化。翻译由业主或运营过一遍。工作量单列（第十一节，约 4–5 人日）。
- 不做三语时的退路：嵌入页先只开中文（组件 `lang` 不是中文时 iframe 仍是中文），第二期少 4–5 人日。
- 邮件语言不在本篇范围（邮件模板按现状）。

## 五、按嵌入码生成 `frame-ancestors`

### 1. 在哪一层生成：应用算值，Caddy 加头

`frame-ancestors` 不能写在 `<meta>` 里，只能是响应头（MDN）。页面本身是 Caddy 给的静态 `index.html`，白名单在数据库里，所以：

```
@embed_book_pages expression `{http.request.orig_uri}.matches("(?i)^/embed/book(/order)?/?([?#].*)?$")`
handle @embed_book_pages {
  request_header -X-Nozomi-Frame-Ancestor          # 先删掉客户端自己带的同名头，防伪造
  forward_auth api:8080 {
    uri /embed/v1/frame-check?{query}               # key、host 两个查询参数
    copy_headers X-Nozomi-Frame-Ancestor
  }
  header Content-Security-Policy "<嵌入页策略>; frame-ancestors {http.request.header.X-Nozomi-Frame-Ancestor}"
  header Cache-Control "no-store"
  root * /srv/web
  try_files {path} /index.html
  file_server
}
```

（示意，实际片段由 `edge-config.ts` 生成，`deploy-web-csp-paths.qa.test.ts` 在真实 caddy:2 上核对。）

- `GET /embed/v1/frame-check?key=&host=`（只给 Caddy 调；对外也能访问，但只回一个公开信息「能 / 不能」）：
  - 嵌入码存在且启用，`host` 规范化后（ADR 0090 第五节第 1 小节的 origin 规则）**完全等于**白名单某一项 → 204，头 `X-Nozomi-Frame-Ancestor: <规范化的 host>`。
  - 其余（没有 key、key 无效或停用、没有 host、host 不合格、不在白名单）→ 403，正文是一页极简 HTML「这个网站不能显示 NOZOMI 预订页」，头 `Content-Security-Policy: frame-ancestors 'none'`、`X-Frame-Options: DENY`。浏览器在 iframe 里会直接拦掉（宿主页看到的是空框，靠 `mountBooking` 的 15 秒超时显示后备），直接在地址栏打开能看到这句话。
  - 限速：按来源地址，借用现有站点限速表（每地址每分钟 120 次）；超了 429，同样等于拒绝嵌入。
- **只放行这一个宿主**，不把整份白名单写进头：一是更严（声明 A 网站却被 B 网站嵌，浏览器拒绝）；二是不在响应头里公开同一合作方的其他域名。`frame-ancestors` 检查**所有**祖先（MDN），所以宿主页本身再被别的网站嵌一层（例如工厂后台的页面预览）时会被拒——这是想要的行为，工厂预览里预订页显示后备链接。
- 嵌入页的其余策略：同官网页面那条（放行 Stripe 的 `script-src`、`frame-src`、`connect-src`），外加 `frame-ancestors <宿主>`，**去掉** `'none'`。
- `X-Frame-Options`：CSP3 规定带强制的 `frame-ancestors` 时浏览器忽略 `X-Frame-Options`（W3C CSP3 §6.4.2.2）。所以全局 `X-Frame-Options: DENY` **先不动**：现代浏览器按 `frame-ancestors` 放行，老到不认 CSP 的浏览器按 DENY 拒绝（安全的失败）。第一期在 Chrome、Safari、Firefox 实测；任何一个被 DENY 挡住，就在这条路由上去掉 `X-Frame-Options`（改 Caddyfile 一处）。
- **伪造防线**：客户端自己带 `X-Nozomi-Frame-Ancestor` 请求头的，进 `forward_auth` 之前就删掉（Caddy 文档没写 `copy_headers` 在网关不回这个头时会不会删掉客户端带来的，所以自己删）；值只可能来自 API，API 只回规范化后的 origin（不含空格、分号、引号），不会注入别的指令。集成测试：带伪造头、带 `host=https://a.example; script-src *` 都拿不到放行。
- 测试环境的外层 nginx：如果它自己加 `X-Frame-Options` 或第二条 CSP（多条 CSP 同时生效，取最严），嵌入一定失败。第一期第一步在测试站 `curl -I` 核实；有就只能请管 nginx 的人去掉那一条，或者确认它只对 `/embed/book` 以外加（列入 Q8）。

### 2. 缓存、生效时间

- 嵌入页 HTML 和 `frame-check` 都 `Cache-Control: no-store`，每次打开都问一次库（嵌入码按 `key` 有唯一索引）：改白名单、停用嵌入码，**下一次打开（含刷新）立即生效**。
- 已经打开着的 iframe 不受影响：嵌入页里的询价、下单走 `/site/v1`，不看嵌入码（同跳主站的做法：停用嵌入码不该让正在付款的客人付不了）。来源统计在下单时照 ADR 0090 再核一次白名单。
- `/assets/*` 带内容哈希的长缓存不变：`frame-ancestors` 只对文档生效，脚本、样式文件不需要。

### 3. 没有 key、key 无效、宿主不在白名单

| 情况 | 结果 |
| --- | --- |
| iframe 地址没有 `key` / `host`，或格式不对 | 403 + `frame-ancestors 'none'`：嵌不进去；宿主页 15 秒后显示后备链接 |
| 嵌入码不存在 / 停用 | 同上 |
| `host` 不在这个嵌入码的白名单 | 同上 |
| `host` 在白名单，但实际宿主不是它（伪造 `host`） | 204，但浏览器按 `frame-ancestors <host>` 拒绝：嵌不进去 |
| 直接在地址栏打开 `/embed/book?…`（不是被嵌） | `frame-ancestors` 不管顶层打开；页面检测到 `window.top === window` 时**不显示预订流程**，改为一句「请在合作网站上预订」和到主站 `/book/new?draft=` 的链接（防止有人把嵌入页当成没有主站外壳的另一个入口） |

## 六、postMessage 协议（v1）

### 1. 消息格式

所有消息都是一个对象：`{ ns: "nozomi-booking", v: 1, ch: "<mountBooking 生成的随机数>", type, ... }`。`ch` 从 iframe 地址的 `#ch=` 传进去（`#` 后面不发给服务器、不进访问日志），用来区分同一页面上的多个 iframe，不是安全凭据。

iframe → 宿主：

| type | 字段 | 什么时候 |
| --- | --- | --- |
| `ready` | `lang` | 嵌入页加载完、核对过宿主之后 |
| `resize` | `height`（整数 px，1–20000） | 内容高度变了（`ResizeObserver`，同一帧只发一次） |
| `step` | `step`：`trip` / `vehicle` / `passenger` / `review` / `payment` / `paid` / `expired` | 换步、下单后进付款、付款已提交、草稿或报价过期 |
| `modal` | `open`：布尔 | Stripe 3D 验证弹窗打开 / 关闭（第七节第 2 小节） |
| `completed` | `orderNo` | 付款已提交、订单等待确认或已确认（按 Q5，推荐「付款已提交」时发一次） |
| `error` | `code`：`DRAFT_NOT_FOUND` / `NOT_EMBEDDABLE` / `SITE_NOT_OPEN` / `LOAD_FAILED` | 读不到草稿、不是被嵌的、官网暂停、加载失败 |

宿主 → iframe：

| type | 字段 | 说明 |
| --- | --- | --- |
| `viewport` | `height`（宿主窗口可视高度） | `ready` 后和窗口大小变化时发；嵌入页用它把 3D 验证弹窗放进客人看得见的位置 |

### 2. 核对 origin

- **iframe 发出**：`window.parent.postMessage(msg, hostOrigin)`，`hostOrigin` 是地址里的 `host`（服务端已核对在白名单里，浏览器已核对确实是祖先）。**从不用 `"*"`**。如果 `host` 和真实父页面不一致，浏览器直接丢弃消息（`targetOrigin` 规则）。
- **iframe 收到**：只认 `event.source === window.parent && event.origin === hostOrigin && data.ns === "nozomi-booking" && data.ch === 本页的 ch`，其余忽略。宿主发来的消息只能影响显示位置，不能改任何预订内容。
- **宿主收到**（`widget-v1.js` 里）：只认 `event.source === iframe.contentWindow && event.origin === <主站 origin>`（取自脚本地址）`&& ns、ch 对得上`；字段按白名单取值（`height` 截到 1–20000，`step`、`code` 只认上表的值），其余丢弃。
- **宿主发出**：`iframe.contentWindow.postMessage(msg, <主站 origin>)`。

### 3. 不带个人信息

- 消息里没有姓名、电话、邮箱、航班号、地址、价格、币种、`nzo_` 令牌、草稿内容。`orderNo` 是订单号（客人在邮件、订单页都看得到；单凭订单号查不到订单，找回还要邮箱或手机号，ADR 0032），业主要求给宿主，所以给。
- 组件测试逐条断言每种消息的键集合；端到端在宿主页记下收到的所有消息，断言里搜不到测试用的姓名、电话、邮箱、令牌。

### 4. 高度

- 默认 iframe 不出现内部滚动条：宿主按 `resize` 设 `height`。收不到 `resize`（老浏览器、脚本出错）时保留初始 720px，嵌入页内部可以滚动（不设 `scrolling="no"`）。
- 换步时嵌入页发 `step`，宿主如果 iframe 顶部在视口上方，就 `scrollIntoView({ block: "start" })`，客人不会停在一片空白里。

## 七、付款：Payment Element 进 iframe

### 1. 和现有付款怎么对接

- **后端一行不改**：嵌入页下单还是 `POST /site/v1/orders`（同一渠道、同一 `Idempotency-Key` 做法），应答里同样有 `client_secret`、`publishable_key`；`order_payments`、Webhook（`POST /webhooks/stripe`）、30 分钟超时取消、取消退款、事后加收离线扣款全部复用。订单确认仍然只认 Webhook。
- **前端复用 `PaymentPanel` 和 `createStripePaymentDriver`**：同样只收银行卡、钱包关掉、同样的出错说法、同样的「付款成功，等待确认」轮询。差别只有：`return_url` 是 `<主站>/embed/book/order`；Stripe 的 `locale` 按嵌入页语言；3D 验证弹窗的位置（下一小节）。
- **Stripe 托管 Checkout 不需要放弃**：主站从来没用它。顺带核实：Stripe 托管页是整页跳转的；Stripe 的 Embedded Checkout 快速入门也提醒不要把 Checkout 放进另一个 iframe，因为有些付款方式要跳转到别的页面确认。这条进一步说明嵌入页应继续用 Payment Element。

### 2. 3D 验证在 iframe 里

- Stripe.js 在 `confirmPayment` 里把 3D 验证界面显示在**弹窗**里（Stripe 文档「Authenticate with 3D Secure」：Stripe automatically displays the authentication UI in a pop-up modal）。弹窗画在调用它的那个文档里——也就是我们的 iframe 里，所以付款全程不离开宿主页。
- **问题**：iframe 已经被撑到内容全高（例如 1,800px），弹窗按 iframe 的视口居中，可能落在客人屏幕外。处理：确认付款前嵌入页发 `modal{open:true}`，宿主把 iframe 滚到顶部对齐，并临时把 iframe 高度设成宿主可视高度（`viewport`），嵌入页内部滚动；弹窗关掉（`confirmPayment` 返回）后发 `modal{open:false}`，宿主恢复按 `resize`。
- 尺寸：Stripe 文档写明 3DS2 的发卡行必须支持 250×400、390×400、500×600、600×400 和全屏，所以 390 宽手机能放下；iframe 高度至少 400px（`viewport` 取 max(宿主可视高度, 480)）。
- 3D 验证 iframe 不能 sandbox（Stripe 文档原话：You can't use the sandbox attribute on the 3DS iframe），所以 `mountBooking` 建的 iframe 也不加 `sandbox`（第三节）。
- 嵌入页 CSP 的 `frame-src` 已含 `https://hooks.stripe.com`（Stripe 安全指南的 Stripe.js 清单；我们的 `STRIPE_CSP_SOURCES` 已经有）。
- **还没核实的**：Stripe 官方文档没有找到「Payment Element 放在跨站 iframe 里」的专门说明（找到的只有下一小节的钱包域名规则）。第三期用 Stripe 测试模式在跨站宿主上实测：失败卡、3D 验证卡（成功 / 失败）、4242 卡；Chrome、Safari（含 iOS）、Firefox 各一遍。Stripe 的风控指纹脚本（`m.stripe.com`）在跨站 iframe 里拿不到它自己的第三方 Cookie，可能影响 Radar 评分，不影响能否付款——测试模式看不出来，上线后观察拒付率。

### 3. 银行整页回跳

- 只收银行卡、`redirect: "if_required"`：绝大多数 3D 验证在弹窗里完成。少数要整页跳转时，跳的是 **iframe 本身**（Stripe.js 在 iframe 里改 `location`），银行页面如果禁止被嵌入就会失败。失败的结果按 ADR 0046 处理（回到订单页后以 Stripe 查到的状态为准，可以重新付）；订单页另给「在新窗口打开订单页付款」（主站 `/book/order#<令牌>`，新标签页）作为最后退路。
- 回跳后取令牌：照 ADR 0046 用本标签页 sessionStorage。iframe 里的 sessionStorage 按顶层网站分区（Firefox 的 State Partitioning 文档：localStorage、sessionStorage 等按顶层网站静态分区），同一个宿主页、同一标签页里写和读是同一个分区，能取回。新增一个键 `nozomi.embed-order`（见第八节第 2 小节），`styles.edge.test.ts` 的「只碰这几个键」名单同步加。

### 4. Stripe 账号设置

- **现在什么都不用加**：只收银行卡、钱包全部关掉（ADR 0046），不需要注册付款方式域名。
- **以后要在嵌入页开 Apple Pay / Google Pay / Link**：按 Stripe「Register domains for payment methods」：Apple Pay 必须注册域名；iframe 的 origin 和顶层页面不同时，**顶层域名（每个合作网站的域名）和 iframe 的域名（主站）都要注册**在同一个 Stripe 账号上；Safari 17+ 另要求 iframe 带 `allow="payment"`（我们已经加了）；测试用的 sandbox 和正式模式要分别注册（在正式模式注册的会自动带到 sandbox）。也就是每加一个合作网站，运营都要去 Stripe 后台「Payment method domains」加一条——这是运营流程，不是代码。另外钱包和「保存银行卡以便事后加收」的关系要先按 ADR 0026 / 0029 重新评估，所以不在本篇范围（M8-08 B 类）。
- **验收只用测试模式**：测试环境后台填的是 Stripe 测试密钥（M4-09）；验收用 Stripe 测试卡，不碰正式模式。

### 5. PCI 范围

- 卡号只进 Stripe 的 iframe，主站和合作网站都碰不到卡号，商户仍按 SAQ A 的模式（ADR 0046）。
- PCI DSS v4.0.1 起，SAQ A 要求商户确认「放付款 iframe 的网页不易受脚本攻击」（PCI SSC FAQ 1588）。嵌入后，客人看到的是「合作网站页面 → 主站 iframe → Stripe iframe」三层：合作网站的脚本读不到跨源 iframe 里的内容（同源策略），但**合作网站被入侵后可以把我们的 iframe 换成假的付款页**——这是合作网站页面本身的风险，和客人在被入侵的网站上点了钓鱼链接一样，我们管不到。建议（Q9）：正式上线前请 Stripe 或 QSA 确认这种嵌法下我们的 SAQ 类型；合作协议里写明合作方对自己页面的安全负责。测试环境验收不受影响。

## 八、身份和令牌

### 1. 不依赖第三方 Cookie

- 嵌入页的文档在主站域名下，调 `/site/v1` 是同源请求；`/site/v1` 下单、查单本来就不用 Cookie（草稿号在路径里，订单令牌在 `Authorization` 头里，ADR 0032）。所以 Safari 的完整第三方 Cookie 拦截（WebKit 2020 起默认）、Chrome / Firefox 的分区 Cookie 都不影响。
- **唯一用 Cookie 的是测试环境验收通道 `nozomi_qa`**（`SameSite=Strict`）。演示站 `embed-demo.moveglobal.io` 和测试站同属 `moveglobal.io`（同站），这个 Cookie 在 iframe 里照样会带——**所以演示站上的验收测不出跨站问题**。补救：端到端测试用两个不同站的本机 origin（`localhost` 当主站、`127.0.0.1` 当宿主）跑全流程；第四期另在一个非 `moveglobal.io` 的测试宿主上手工走一遍（Q7）。

### 2. 草稿令牌、订单令牌

| | 草稿号（已有） | 订单查看令牌 `nzo_`（已有） |
| --- | --- | --- |
| 生成 | 建草稿时服务端，32 字节随机（256 位） | 下单时服务端，32 字节随机；库里只存 SHA-256 |
| 在哪 | 宿主地址 `?nzdraft=`、iframe 地址 `?draft=` | iframe 的 `history.state`（不进地址、不进宿主）；sessionStorage 键 `nozomi.embed-order`（见下） |
| 能做什么 | 只读：地点、日期、人数，没有个人信息 | 看这一张单、付款、取消、改单（同主站订单页） |
| 有效期 | 2 小时（ADR 0090） | 用车时间后 30 天（ADR 0032） |
| 一次性？ | **否**：有效期内可以反复打开（刷新、退回） | **否**：付款要轮询订单状态，要多次调用 |

- **为什么不做成真正的一次性令牌**（业主原话「草稿和订单都用一次性令牌」，Q10）：草稿一次性 → 客人刷新宿主页就要重新填；订单令牌一次性 → 付款轮询、取消都做不了。现有两种令牌已经满足「不依赖 Cookie、不可猜、有过期」，重放能拿到的只是同一份不含个人信息的草稿，或本来就属于这张单的操作。推荐不新增令牌类型。
- **刷新宿主页后怎么接着付款**：下单成功时嵌入页把 `{ 草稿号, 令牌, 时间 }` 写进本标签页 sessionStorage `nozomi.embed-order`（按顶层网站分区，只在这个宿主页、这个标签页里），最长 1 小时；刷新后用同一个草稿号打开时先看有没有，有就直接进订单页（待付款可以接着付）。Safari 在「阻止所有 Cookie」设置下访问存储会抛错：捕获后当作没有，客人仍然可以用邮件里的链接或「查订单」找回。订单页始终显示「在新窗口打开订单页」（主站，令牌在 `#` 后）。
- **和现有 `#nzo_` 链接的关系**：同一种令牌、同一张表 `site_order_links`、同样的有效期规则；嵌入页拿到的是下单应答里那一个，邮件里的是另生成的（不变），两者都打开同一张单。令牌**从不**发给宿主（postMessage 只有订单号）。
- **防重放**：下单靠 `Idempotency-Key`（同一次点击重试不会重复下单）；同一草稿再点一次「去付款」是另一张新单（同主站，按设计）；付款靠同一 PaymentIntent 只能成功一次；Webhook 有签名和幂等（ADR 0026）。

### 3. CSRF、点击劫持

- CSRF：嵌入页和 `/site/v1` 都不靠 Cookie 表明身份，跨站请求带不上任何凭据，所以 CSRF 不适用（验收通道的 Cookie 是 `SameSite=Strict`，且只在测试环境）。
- 点击劫持：被允许嵌入的宿主理论上可以在 iframe 上盖透明层诱导点击。限制：只有白名单里、本次声明的那一个网站能嵌；付款前有页面内「确认支付 X JPY？」（ADR 0046）；卡号要客人自己输入。合作方是签约的，靠协议约束。

## 九、来源统计、锁价、取消、邮件——和主站一致

1. **来源统计**：iframe 里的询价带 `draft_id`（复用 M9E-12 的代码），下单时照 ADR 0090 记 `order_embed_sources`。另加一列 `delivery`（`redirect` 跳主站 / `host_page` 嵌在宿主页，旧行为空按 `redirect`）：值来自建草稿时的 `delivery`（第三节第 1 小节），存在 `booking_drafts`、`quote_embed_sources`、`order_embed_sources` 上，一个迁移只加列、不回填。运营后台订单详情的来源显示「嵌入组件（宿主页内）· <网站>」。仍然只做统计（Q6）。
2. **报价锁价**：同一个 `POST /site/v1/quotes`、`/quotes/by-points`，报价 30 分钟有效、下单锁定报价编号，过期提示重新报价——代码是同一份，自然一致。
3. **取消规则**：同一个 `/site/v1/order/cancel-fee`、`/order/cancel`，平台统一取消政策（ADR 0029），订单页的取消区块原样复用。
4. **邮件**：同一个通知中心（ADR 0049），邮件里的订单页链接仍是 `<publicBaseUrl>/book/order#<令牌>`——**打开主站订单页**，不打开宿主页（业主要求）。邮件模板不改。
5. **地图和谷歌条款**：
   - 谷歌《地图平台服务专用条款》14.2（Places）、19.2（Routes）：这些内容不能和非谷歌地图一起用。嵌入页的地点候选（Places，经后端代调）、路线（Routes，经后端代调）、静态路线图（Maps Static，就是谷歌地图）都合规；**Leaflet 路线后备图和 Leaflet 地图选点不进嵌入页**（第四节第 1 小节）。
   - 条款全文里没有查到针对「在 iframe 里显示」的限制（2026-11-14 检索服务专用条款全文，无 iframe 相关条文）；嵌入页在别人网站里显示谷歌内容，和主站一样要带谷歌署名（静态图自带标志，地点候选下方「Google Maps」文字，M9E-06 已做）。
   - 浏览器里没有谷歌密钥（静态图和地点都是后端代调），不涉及密钥的来源限制。

## 十、主站和现有组件不变的保证：测试和回归清单

| 范围 | 要求 |
| --- | --- |
| 组件 `init` | 不传 `bookingUrl`：跳 `<主站>/book/new?draft=` 的组件测试、`site-embed-widget.spec.ts` 原样通过；传了不合格的 `bookingUrl`：同上并在控制台报一句 |
| `/book/new` | `book-new.test.tsx`、`default-date.test.tsx`、`waypoints.test.tsx`、`map-center.test.tsx` 不改；`site-booking*.spec.ts`（new、charter、waypoints、mobile、mobile-address、route-map、categories、qa）不改；新增「主站模式请求体与重构前逐字相同」 |
| 订单页、付款 | `site-payment.spec.ts`、`site-payment-qa.spec.ts`、`site-payment-token.qa.spec.ts`、`site-payment*.test.tsx` 不改 |
| 安全头 | `security.spec.ts`：后台、登录、`/book/*` 仍 `frame-ancestors 'none'` + `X-Frame-Options: DENY`，被别的 origin 嵌入被拒；新增：`/embed/book` 被白名单宿主嵌入成功、被非白名单 / 伪造 `host` / 嵌套两层被拒；`deploy-web-csp-paths.qa.test.ts` 在真实 caddy:2 上核对 `/embed/book`、`/embed/book/order`、`/embed/booking`、`/embed/book%2F..` 等写法各落到哪条策略；伪造 `X-Nozomi-Frame-Ancestor` 请求头无效；`deploy/ci/smoke.sh` 加一条 |
| 接口 | `/site/v1` 等仍永不带 CORS 头（ADR 0090 的扫描测试）；`frame-check` 的集成测试：启用 / 停用 / 不存在 / 白名单内外 / 格式不对 / 限速 |
| 产物 | `build-output.spec.ts`：仍是一个 JS、一个 CSS；组件 gzip 预算 60 KB |
| 端到端（新） | 两个不同站的本机 origin：宿主页 `init({bookingUrl})` → 跳宿主 `/booking/?nzdraft=` → `mountBooking` → iframe 内区间、包车各走到付款（假 Stripe）→ `completed{orderNo}` → 平台订单详情来源是嵌入组件（宿主页内）；postMessage 记录里没有个人信息；`error` / 超时后备；390 宽不横向滚动、axe 无严重问题、键盘能走完 |

## 十一、分期和工作量（人日按一个开发角色计，不含审查和验收等待）

| 期 | 任务 | 内容 | 估算 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | M9E-16 | `init` 的 `bookingUrl` 和 `delivery`；`mountBooking` 骨架（建 iframe、超时后备、postMessage 收发和核对、高度、事件回调）；`/embed/book` 占位页（只显示草稿内容 + `ready`/`resize`）；`frame-check` 接口、Caddy `forward_auth` 片段、嵌入页 CSP、`X-Frame-Options` 实测；迁移加 `delivery` 列；测试站外层 nginx 头核实 | 4–5 | 本篇采纳、M9E-12 合并 |
| 2 | M9E-17 | 抽 `BookingShell` 上下文；`EmbedLayout`；`/embed/book` 完整四步 + 订单页（不含付款）；无 Leaflet；`step`/`completed`/`error` 事件；`nozomi.embed-order` 刷新续接；顶层打开的拦截；390 宽、无障碍 | 6–7 | M9E-16 |
| 2b | M9E-18 | 嵌入页中 / 日 / 英（文案字典、付款出错说法、日期金额格式、Stripe `locale`），主站仍只用中文 | 4–5 | M9E-17；Q4 选「三语」才做 |
| 3 | M9E-19 | 付款进 iframe：`return_url`、3D 验证弹窗 `modal`/`viewport`、银行回跳取令牌、新窗口打开订单页退路；假 Stripe 端到端；Stripe 测试模式在跨站宿主上实测三种浏览器 | 3–4 | M9E-17 |
| 4 | M9E-20 | 更新给工厂的接入说明（`docs/integration/moveglobal-factory-nozomi-widget.md`，附录 A 定稿）；演示站加白名单、工厂接入；测试站验收：区间、包车各用 Stripe 测试卡全程不离开演示站、非白名单域名嵌入被拒、390 宽；非 `moveglobal.io` 宿主手工走一遍 | 2（不含工厂开发的时间） | M9E-19、工厂上线 |

合计：不做三语约 15–18 人日，做三语约 19–23 人日（按中值约 16 / 21）。

## 十二、需要业主或监工定的事项（答复前不开工）

| # | 问题 | 推荐 | 其他选项和代价 |
| --- | --- | --- | --- |
| Q1 | `mountBooking` 的 `redirectUrl` 是什么意思（GJ 的 `redirectUrl` 是预订页地址，我们 0090 的是「返回原网站」） | 沿用 0090：付款后「返回原网站」链接；预订页地址只用 `bookingUrl`。工厂接 NOZOMI 时把 GJ 的 `redirectUrl` 映射成我们的 `bookingUrl` | 改成 GJ 的意思：0090 的组件和后台生成代码都要改名，合作方容易混；不推荐 |
| Q2 | `bookingUrl` 必须和当前页同一个 origin 吗 | 是（防止草稿号送到别的网站） | 放宽到「白名单任意一项」：多一次服务端校验，约半天 |
| Q3 | 嵌不进去时的后备 | 在宿主页显示一句话 + 「到主站继续预订」链接（新标签页打开主站 `/book/new?draft=`） | 自动整页跳主站：客人不知道发生了什么，不推荐 |
| Q4 | 嵌入页语言 | 中 / 日 / 英三语（M9E-18），主站仍只中文 | 先只中文：省 4–5 人日，日本合作网站上体验差 |
| Q5 | `completed` 什么时候发 | 客人付款已提交（Stripe 收下）时发一次，带订单号；订单确认靠 Webhook，几秒后订单页自己变「已确认」 | 等后端确认再发：要多轮询，宿主晚几秒才知道；付款后关页面就收不到 |
| Q6 | 统计要不要区分「宿主页内」和「跳主站」 | 要：加 `delivery` 一列，后台来源显示区分 | 不区分：省一个迁移，约半天 |
| Q7 | 跨站验收 | 除演示站（同属 `moveglobal.io`，测不出第三方 Cookie 问题）外，再找一个非 `moveglobal.io` 的测试宿主手工走一遍；端到端用 `localhost` / `127.0.0.1` | 只在演示站验收：可能漏掉 Safari 跨站问题 |
| Q8 | 测试环境外层 nginx 若自己加 `X-Frame-Options` / CSP | 第一期先查；有的话请业主联系管 nginx 的人对 `/embed/book` 去掉 | 查到有且改不了：测试环境无法验收嵌入，只能在正式环境验（真钱），不推荐 |
| Q9 | PCI 范围 | 上线正式环境前请 Stripe / QSA 确认嵌入方式下的 SAQ 类型；合作协议写明合作方对自己页面安全负责 | 不确认：存在被认定为 SAQ A-EP 的风险 |
| Q10 | 「一次性令牌」 | 不新增令牌：沿用草稿号（2 小时、可重复打开）和 `nzo_` 订单令牌（第八节第 2 小节） | 真一次性：刷新就要重填、付款轮询做不了，不推荐 |
| Q11 | 嵌入页要不要地图选点 | 首期不要（只从谷歌候选选点），等 M10-01 把选点改成谷歌地图后再加 | 现在就加 Leaflet 选点：违反谷歌条款 14.2，不推荐 |

## 十三、风险汇总

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| Safari ITP / 第三方 Cookie | 我们不靠 Cookie，基本无影响；Stripe 风控指纹在跨站 iframe 里信号变少 | 第八节第 1 小节；上线后看拒付率 |
| 存储分区 | sessionStorage 按顶层网站分区，宿主页内续接可用；Safari「阻止所有 Cookie」时存储报错 | 捕获降级；订单页、邮件仍可找回 |
| 3D 验证弹窗位置 | 弹窗落在屏幕外，客人以为卡住 | `modal` / `viewport` 协议；三种浏览器 + iOS 实测 |
| 银行整页跳转被拒嵌 | 个别卡付不了 | 新窗口打开主站订单页付款的退路 |
| 宿主 CSP | 合作网站有 CSP 时要放行主站：`script-src`、`connect-src`（组件，ADR 0090 已写）**加 `frame-src`**（本篇新增） | 接入说明写明；后台生成代码页提示 |
| 外层代理加头 | 测试环境嵌不进 | 第一期核实（Q8） |
| 宿主页再被嵌套 | `frame-ancestors` 检查所有祖先，工厂预览等嵌套场景嵌不进 | 显示后备链接；接入说明写明 |
| 谷歌条款 | Leaflet 内容和谷歌内容混用 | 嵌入页不带 Leaflet（第九节第 5 小节） |
| 无障碍 | iframe 没标题、换步后焦点丢失 | iframe `title`；嵌入页换步时焦点移到步骤标题（主站已有）；宿主滚动对齐；axe |
| 性能 | 嵌入页加载整个前端包 | 第二期量首屏；太慢另立拆包任务 |
| 支付安全 / PCI | 合作网站被入侵可换掉 iframe | 第七节第 5 小节（Q9） |
| 主站回归 | 抽上下文改坏主站 | 第十节清单；重构单独提交 |

## 附录 A：给工厂整站开发的接口说明（草稿，采纳后并入 `docs/integration/moveglobal-factory-nozomi-widget.md`）

> 以下嵌入码、域名都是占位。

**1. 任意页面放查价表单，提交后跳到本站 `/booking/`**

```html
<div id="nozomi-booking"></div>
<script src="https://<主站域名>/embed/widget-v1.js" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.init({
      key: "nze_<嵌入码>",
      root: "#nozomi-booking",
      lang: "ja",
      bookingUrl: "https://<本站域名>/booking/"   // 必须和当前页同一个域名；不写则跳到 NOZOMI 主站
    });
  });
</script>
```

**2. `/booking/` 页放整个预订流程**

```html
<div id="nozomi-booking-flow"></div>
<script src="https://<主站域名>/embed/widget-v1.js" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.mountBooking({
      key: "nze_<嵌入码>",
      root: "#nozomi-booking-flow",
      lang: "ja",
      redirectUrl: "https://<本站域名>/",           // 可选：订单页「返回原网站」的链接
      onEvent: function (e) {                        // 可选
        // e.type: "step" | "completed" | "error"
        // e.step: "trip" | "vehicle" | "passenger" | "review" | "payment" | "paid" | "expired"
        // e.orderNo（completed 时）；e.code（error 时）
      }
    });
  });
</script>
```

- 地址带 `?nzdraft=…` 时显示预订流程（iframe，高度自动）；不带时显示查价表单，提交后回到本页带 `nzdraft`。
- 同一个元素上也会派发 `nozomi:booking` 事件（`event.detail` 同上）。
- 不要给容器设固定高度或 `overflow: hidden`；不要再包一层 iframe（预订页只允许被白名单网站的顶层页面直接嵌入）。
- 如果你们的站点有内容安全策略：`script-src`、`connect-src`、`frame-src` 都要放行 `https://<主站域名>`。
- 本站域名（含 `www.` 与否、端口）要由 NOZOMI 运营加到嵌入码白名单里，完全一致才放行。
- 付款在预订流程里完成（Stripe），客人不离开本站；确认邮件里的订单链接打开 NOZOMI 主站的订单页。

## 出处（2026-11-14 查阅）

- Stripe「Register domains for payment methods」（iframe 的 origin 规则、顶层和 iframe 域名都要注册、Safari 17+ `allow="payment"`、测试和正式分别注册）：https://docs.stripe.com/payments/payment-methods/pmd-registration
- Stripe「Authenticate with 3D Secure」（弹窗显示、3DS2 必须支持的尺寸、3D 验证 iframe 不能 sandbox、return_url 和 CSP）：https://docs.stripe.com/payments/3d-secure/authentication-flow
- Stripe「Integration security guide」（Stripe.js 的 CSP 清单、PCI）：https://docs.stripe.com/security/guide
- Stripe Embedded Checkout 快速入门（不要把 Checkout 放进另一个 iframe）：https://docs.stripe.com/checkout/embedded/quickstart
- W3C CSP Level 3 §6.4.2.2「Relation to X-Frame-Options」（带强制 `frame-ancestors` 时忽略 `X-Frame-Options`）：https://w3c.github.io/webappsec-csp/#frame-ancestors-and-frame-options
- MDN `frame-ancestors`（不支持 `<meta>`、检查所有祖先）：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
- MDN State Partitioning（Firefox 存储按顶层网站分区）：https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning
- WebKit「Full Third-Party Cookie Blocking and More」（Safari 13.1 起默认拦截第三方 Cookie）：https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- Caddy `forward_auth`（`copy_headers` 复制到原请求、非 2xx 时网关应答直接回客户端）：https://caddyserver.com/docs/caddyfile/directives/forward_auth
- 谷歌地图平台《服务专用条款》14.2 Places、19.2 Routes：https://cloud.google.com/maps-platform/terms/maps-service-terms
- PCI SSC FAQ 1588（SAQ A 关于脚本攻击的资格条件）：https://www.pcisecuritystandards.org/faqs/1588
