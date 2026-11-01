# ADR 0046：官网付款接入 Stripe Elements——Stripe.js 的加载、付款流程、银行验证回跳的令牌、只在官网页面放行 Stripe 的内容安全策略

- 状态：已采纳（2026-10-27，M3-08）；2026-11-01 按真实付款验收的结果修订：出错提示不再用 Stripe 的原话、钱包在 Payment Element 上关掉、失败回跳取不回令牌时的文案（见下文「付款流程」「银行验证回跳」「不做」）；2026-11-01 M3-13：要挂 Stripe 表单时令牌先离开页面地址（见下文「令牌不进 Stripe 读得到的地址」）
- 实现 ADR 0032「Stripe 配置后」和「本期不做 · Stripe.js 上线」：订单页的 `PaymentDriver` 换成 Stripe Elements 的实现；内容安全策略放行 Stripe；测试环境用测试卡验证。
- 补充 ADR 0011「现阶段的防线 · 不引入第三方脚本」：唯一的例外是 Stripe.js，只在官网订单页要付款时加载，地址只登记在 `apps/web/src/lib/external-scripts.ts`。
- 补充 ADR 0032「客人怎么看到自己的订单」（令牌只在地址的 `#` 后面和请求头里）：付款时被 Stripe 整页带去银行验证的那一小段时间，令牌临时放在本标签页的 sessionStorage，见下文。
- 补充 ADR 0007「前端接入部署」（内容安全策略由构建时生成）：策略从一条变成按路径的两条。
- 后端、数据库都不改：用的是 M3-01 / M3-05 已有的 `GET /site/v1/config`、下单应答和 `GET /site/v1/order/payment`（`client_secret`、`publishable_key`，publishable key 是后台生效的那一把，ADR 0041）、`POST /webhooks/stripe`。没有新迁移。

## 背景

roadmap M3-08 的验收标准：① 官网下单后用 Stripe Elements 付款，3D 验证卡、失败卡都有正确提示；② 内容安全策略只放行 Stripe 必需的域名；③ 测试环境用 Stripe 测试卡真实付款成功，订单自动确认。
负责人已在测试环境的运营后台填好 Stripe 测试密钥（M4-09），Webhook 在 Stripe 测试模式里建好（`https://nozomi.moveglobal.io/webhooks/stripe`）。

Stripe 的要求：Stripe.js 必须从 `js.stripe.com` 加载，不能打包进自己的代码、不能自托管（卡号只进 Stripe 的 iframe，商户才能按最轻的 PCI 自评问卷 SAQ A 合规）。

## 决定

### Stripe.js 怎么加载

- 地址 `https://js.stripe.com/v3/`，登记在 `lib/external-scripts.ts`（站外脚本唯一的登记处）；只有 `lib/stripe-js.ts` 插 `<script>`（`styles.edge.test.ts` 检查：别处不能插脚本、不能写站外网址，登记的恰好是这一个）。
- 不引 `@stripe/stripe-js`：它也只是插一个同样的 `<script>`，类型只写本站用到的几个方法，省一个依赖。
- 不加 SRI（`integrity`）：Stripe 会在同一个地址上更新这个文件，官方明确不支持 SRI。
- 只在订单页「付款」区块要挂表单时加载（询价页、下单页、后台都不加载）；整个页面只插一次；加载失败（网络、被拦、20 秒超时）时拿掉这次的 `<script>`，客人点「重新加载」会真的再试。
- 语言 `zh`（官网是中文界面）：Stripe 的表单是简体中文。**出错提示不用 Stripe 的原话**（`message`）：确认付款时它按语言翻译，之后再查付款（`retrievePaymentIntent`，刷新、再打开）给的却是英文，3D 验证失败时还是写给开发者的话（真实付款验收发现）。页面只看 `decline_code`、`code`，由 `lib/payment-errors.ts` 换成一句中文（原因 + 怎么办，页面不再另加建议）；不认识的代码给通用提示；疑似盗刷、挂失、风控拦截的代码一律说「被拒绝」（Stripe 要求不告诉客人真实原因）。官网接口不返回付款失败的原因，这些代码只从 Stripe.js 来。

### 付款流程（`lib/payment-driver.ts` 的 `createStripePaymentDriver`，订单页 `PaymentPanel`）

1. 取付款凭据：刚下单时用下单应答里的，之后用 `GET /site/v1/order/payment`。`client_secret` 为 null（过了付款期限、订单不是待付款）时说「这张订单现在不能付款了」并刷新订单。
2. `stripe.retrievePaymentIntent(client_secret)` 先查这笔付款：已成功、处理中的**不再显示表单**，直接进第 6 步（刷新页面、从银行页面回来、在另一个标签页付过）；已取消的说「这张订单现在不能付款了」并刷新订单；上次没付成的（`last_payment_error`）按它的代码把原因显示出来；刚从银行回来、地址上 `redirect_status=failed`、Stripe 查到确实是 `requires_payment_method` 却没写原因（如客人关掉了银行页面）的，提示「上次付款没有完成，请重新付款。」——地址上的参数不单独算数，以 Stripe 查到的状态为准。
3. 挂 Payment Element（`layout: "tabs"`、`wallets` 三项都是 `never`，见「不做」）。外观取自设计令牌：Stripe 的表单在 iframe 里读不到本站的 CSS 变量，所以挂表单时把令牌的当前值读出来交给它（主色、底色、文字、出错色、字体、字号、圆角、边框），亮暗主题按当前主题选 `stripe` / `night`；主题切换时重新读一遍交给它。
4. 客人点「付款 22,000 JPY」：先 `elements.submit()` 校验（卡号不完整等由 Stripe 在表单里标出，页面再按代码给一句中文），通过才出页面内确认「确认支付 22,000 JPY？」——并写明「如果银行要求验证，会弹出银行的验证窗口」。
5. 「确认支付」：`stripe.confirmPayment({ elements, confirmParams: { return_url }, redirect: "if_required" })`。银行卡的 3D 验证由 Stripe 的弹窗完成，弹窗开着的时候按钮显示「正在付款」、「返回」不能点。结果：
   - 成功 / 处理中 → 第 6 步；
   - 卡被拒、余额不足、验证没通过、填写不对（`card_error`、`validation_error`、`payment_intent_authentication_failure`）→「付款没有成功：〈按代码写的原因和怎么办〉」（如「您的银行卡余额不足。请换一张卡。」），表单留着；
   - 没连上 Stripe（`api_connection_error`、请求抛错）→ 先再查一次这笔付款（确认请求其实到了的话按实际结果），仍是待付款就说「没有连上 Stripe，这次付款可能没有提交。请检查网络后再点「付款」；同一张订单不会被扣两次」——同一笔 PaymentIntent 只能成功一次；
   - 其他错误 → 同样先再查一次，已取消（订单被取消、过了付款期限）的拆掉表单，说「这张订单现在不能付款了」并刷新订单；仍没付成就说「付款没有完成。请稍后再试；一直不行请联系客服。」。
   - 以上凡是客人点按钮后才出现的失败提示（含第 4 步校验不过），都在画这一帧之前滚进视野（`block: "nearest"`，已在屏幕里就不动）并把焦点移到提示位上：提示在区块顶部、确认按钮在底部，页面可能已滚到下面，3D 验证窗口关掉后焦点也没了去处。打开页面就有的提示（第 2 步）不抢焦点。
6. 付款已提交：拆掉表单，显示「付款成功，等待确认。订单通常几秒钟内确认，页面会自动更新，请不要重复付款。」（处理中：「银行正在处理这笔付款……」）。马上刷新一次订单，之后每 3 秒一次；2 分钟还没确认就改成每 15 秒，并补一句「确认比平时慢：您可以先关掉页面，稍后再打开这个链接查看；有疑问请联系客服」。
7. 订单不再是待付款时付款区块消失（轮询随之停止）；这次看页面时订单从待付款变成已确认，顶部显示「付款成功，订单已确认。派车后这里会显示司机和车辆。」

**订单是否确认只认 Stripe 发给平台的通知**（ADR 0026）：第 6 步说的是「Stripe 收下了这笔付款」，订单状态一律以后端为准，前端从不自己把订单标成已确认。

### 银行验证回跳：令牌不进 return_url

银行卡的 3D 验证一般在 Stripe 的弹窗里完成，页面不离开；但 `confirmPayment` 必须给 `return_url`，少数情况 Stripe 会把整页带去银行页面，验证完回到 `return_url?payment_intent=…&payment_intent_client_secret=…&redirect_status=…`。

- `return_url` 固定是 `https://<本站>/book/order`，**不带令牌**：`return_url` 会随确认请求发给 Stripe、记在这笔 PaymentIntent 上（Stripe 后台看得到）。考虑过放在 `#` 后面（`/book/order#nzo_…`）：令牌一样会发给 Stripe，而且 Stripe 往地址上加参数时是否保留 `#` 没有书面保证。
- 做法：点「确认支付」之前，把 `{ 付款编号, 令牌, 时间 }` 写进**本标签页**的 sessionStorage（键 `nozomi.payment-return`，`lib/payment-return.ts`）；确认有了结果（没被带走）立刻删掉。回到 `/book/order?payment_intent=pi_…` 时：读出来**先删掉**，付款编号对得上、令牌格式对、写入不超过 1 小时才用，地址换成 `/book/order#<令牌>`（`replace`，Stripe 加的参数——其中有 client_secret——不留在地址栏和浏览历史里），随后照常用请求头读订单。
- 取不回（换了标签页或浏览器、存储被清、对不上）：去「查订单」，提示「付款结果已交给银行处理……请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款」。
- 取不回且地址上是 `redirect_status=failed`：没有令牌就查不了 Stripe，「失败」只是地址上的说法，所以提示「银行返回的结果是这次付款没有成功。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单：订单页会显示最新的付款状态，还是待付款的话可以在那里重新付款。找不到订单号请联系客服。」不再说「已交给银行」「别重复付款」（付款失败时不准确）；也不提确认邮件（通知中心还没做，ADR 0032）。真正的状态到订单页以第 2 步为准，付过的不会再显示表单。
- 这是令牌唯一一次进浏览器的 Web 存储（历史记录的 state 见下一节）：只在本标签页、最长 1 小时、只有一个键、取一次就删（`styles.edge.test.ts` 核对这个文件只碰这一个键，只有付款区块写、只有订单页读）。
- 回到订单页后照第 2 步：Stripe 说成功就等待确认，说没成功就显示原因、可以再付。

### 令牌不进 Stripe 读得到的地址（M3-13）

**查到的事实**（2026-11-01 用真实 Stripe.js 实测：测试环境官网页面、虚构令牌 `nzo_M313PROBE…`、deferred 模式的 Payment Element、填测试卡后调 `elements.submit`、`createPaymentMethod`、`confirmPayment`，写请求在浏览器网络层拦下没有发出。记录所有 iframe 地址，和发往 stripe.com、stripe.network、hcaptcha 的所有请求的网址、Referer、请求体，按原文、URL 解码、base64 解码搜索）：

| 问题 | 结果 |
| --- | --- |
| 令牌在哪里 | 在 Stripe 的 iframe 地址的 `#` 后面：`controller-with-preconnect`、`elements-inner-*` 的 `referrer=`，`m-outer`、`m.stripe.network/inner.html` 的 `url=`。iframe 内的脚本读得到，HTTP 请求本身不带 `#` 后面的内容 |
| 令牌原文有没有发到 Stripe | **这次实测没有**：所有请求的网址、请求头、请求体都搜不到。接口上只带站点：`elements/sessions` 的 `referrer_host`，`payment_methods`、`confirm` 的 `referrer` 和 `r.stripe.com/b` 的 `referrer` 都只有 `https://<本站>`，`Referer` 是 Stripe 自己的域名（本站发 `no-referrer`） |
| 令牌的哈希有没有发到 Stripe | **有**：`m.stripe.com/6`（Stripe 的风控指纹）的 `b.b`、`url` 里是页面地址按段分开算的哈希值，含 `#` 这一段，和令牌一一对应。读 `m.stripe.network/out-4.5.45.js`：每段用 `sha256WithSalt` 算；实测同一个令牌在不同的浏览器会话里得到同样的值。令牌有 256 位随机量，从哈希还原不出令牌；但 Stripe 手里有一个能认出同一张单、只要令牌不换就不变的标识 |
| Stripe.js 什么时候读地址 | 不是加载脚本时：加载后、`Stripe()` 之前去掉片段，iframe 和请求里都没有。`Stripe()` 时建控制 iframe 就读（`Stripe()` 之后才去掉：控制 iframe 和 `m.stripe.com` 已经带上）。**之后还会再读**：表单挂好后把令牌放回地址，点确认付款时 `m.stripe.com` 又发了含 `#` 段的哈希 |
| 历史上的订单 | 查不清 Stripe 怎样保存、使用收到的哈希（服务端看不到）。本次之前的订单，付款页都发送过上述哈希。本站不认为令牌原文泄露，令牌不需要因此作废 |
| 没验证到的 | 实测用的是 deferred 模式，没有用真实订单的 client_secret，`retrievePaymentIntent` 没有实测，确认付款的请求被拦下、没有看到之后的步骤；真实 3D 验证弹窗和整页跳转银行（`hooks.stripe.com` 和发卡行页面）的请求没有测；`r.stripe.com/b` 按当时的版本观察，Stripe 随时可能改脚本。`m.stripe.com` 的页面标题字段同样是加盐哈希，标题里有订单号 |

**决定**：Stripe.js 加载之前令牌就离开地址，这个文档里加载过就不再放回去。只在挂载期间去掉不够：实测确认付款时它还会重读地址。

- 令牌放在**这条历史记录的 state** 里（`history.state.usr.orderToken`，由路由的 `navigate(..., { state })` 写入）：刷新、前进后退都还在，只属于这一条记录，复制地址、换标签页打开都带不走，不用新增存储键。实测放在这里 Stripe.js 没有带走。之前令牌留在浏览器历史的地址里，现在待付款的这一条也没有了。
- 什么时候移（`OrderPage`，`useLayoutEffect`）：这个页面要挂表单（订单待付款、配了 Stripe）或这个文档已经加载过 Stripe.js（`stripeJsInPage()`）。移之前付款区块只显示占位，不挂表单。其他页面（已确认等状态、没配 Stripe 的待付款）地址不动，还是 `#<令牌>`。
- 什么时候放回：刷新后是新文档，Stripe.js 没加载，订单已经不用付款，令牌放回地址，从 state 删掉。付款成功后不刷新就不放回。
- 地址上有 `#` 时只认地址：客人在同一个标签页贴了别的单的链接，按新令牌读单，同样移走。这个切换和移走之间有一帧，这一帧里令牌在地址上；实测 Stripe.js 在被调用时才读地址，这一帧页面不调用它，但不能排除它自己的定时上报正好读到。
- 最后一道防线：`createStripePaymentDriver().mount` 发现地址里有 `nzo_` 就报加载失败，不加载 Stripe.js。
- 从银行回跳不变：`return_url` 不带令牌，令牌在 sessionStorage，取回后先进地址，再按上面的规则移走。

**表单在屏时地址栏的取舍**：地址栏是 `/book/order`，**复制地址栏得不到这张单的链接**，收藏这个地址打开后是「查订单」（用订单号和邮箱、手机号能找回，不报错）。作为补偿，页面上有「复制订单链接」按钮和一句说明（刚下单的提示里本来就有带令牌的链接和「复制链接」，文案改成「请复制下面的链接保存」）。刷新、前进后退、从银行回跳、用页面按钮复制的链接都照常可用。

### 内容安全策略：只在官网页面放行 Stripe

| 指令 | 官网页面（字面上是 `/book`、`/book/checkout`、`/book/order`） | 其余页面（两个后台、登录、司机页等） |
| --- | --- | --- |
| script-src | `'self'` + 主题脚本哈希 + `https://js.stripe.com https://*.js.stripe.com` | `'self'` + 主题脚本哈希 |
| frame-src | `https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com` | 不写（按 `default-src 'self'`） |
| connect-src | `'self' https://api.stripe.com` | `'self'` |
| 其余 | 相同（`default-src 'self'`、`style-src 'self'`、`img-src 'self'` + 底图、`object-src 'none'`、`base-uri 'none'`、`form-action 'self'`、`frame-ancestors 'none'`） | 同左 |

- 来源按 Stripe 官方文档「Content Security Policy」的清单取本站用得到的最小集：Stripe.js 本身（`js.stripe.com`，以及它按版本拆出去的 `*.js.stripe.com`——文档要求两项都放）、付款表单和 3D 验证的 iframe（`js.stripe.com`、`hooks.stripe.com`）、Stripe.js 调的接口（`api.stripe.com`）。**不放**文档里 Address Element 地址补全用的 `maps.googleapis.com`（本站不用 Stripe 的地址表单）；不放 `img-src`、`style-src`（Stripe 的图片和样式都在它自己的 iframe 里，对父页面的样式只用脚本设置，不受 `style-src` 限制）；不放 `unsafe-inline`、`unsafe-eval`。
- 为什么按路径分两条而不是全站放行：后台页面登录后持有令牌，放行站外脚本来源只会扩大被注入时能做的事；后台用不到 Stripe。官网是一个单页应用，策略按**打开页面时**的路径定：从官网页面打开后在页面内跳到后台路由会沿用官网那一条，但官网页面上没有去后台的链接；直接打开后台的任何地址都是不放行的那一条。
- **按没解码的原始地址匹配，只认官网的三个页面**（测试发现的缺陷）：Caddy 的 `path` 匹配器会先解码、规整，`/platform/..%2Fbook`、`/login/..%2Fbook`、`/book%2Forder`、`//book/order` 都会被它当成 `/book`，而浏览器留在原地址，前端渲染的是后台或登录页——后台页面就拿到了放行 Stripe 的策略。所以改用请求行里的原始地址 `{http.request.orig_uri}` 和正则 `SITE_PAGE_URI_PATTERN` 比：只有字面上是 `/book`、`/book/checkout`、`/book/order`（可带结尾斜杠和查询串，从银行回来的 `/book/order?payment_intent=…` 照常）才放行。`/book/别的` 也不放行：前端路由对不上官网，落到的是供应商后台的页面。新增官网页面时要同时改这个正则（`site-csp.test.ts` 核对前端的三个路径）。任何没认出来的写法都落到不放行的那一条：最坏是 Stripe 表单加载不出来，不会多放行。
- 不分大小写：前端路由不分大小写，`/Book/order` 渲染的就是订单页，要能付款；`isSitePagePath`（vite preview）和 Caddy 用同一个正则，判断一致。
- 实现：`apps/web/build/edge-config.ts` 的 `contentSecurityPolicy(哈希, 图片来源, { payments })` 和 `STRIPE_CSP_SOURCES`；构建镜像时生成的 Caddy 片段里是两个互斥的表达式匹配器 `@site_pages`、`@other_pages` 各一条 `header`（每个响应恰好一条策略；`deploy-web-csp-paths.qa.test.ts` 在真实的 caddy:2 上逐路径核对，CI 上缺镜像就拉，拉不下来直接失败，不跳过）；端到端测试用的 `vite preview` 按同一个函数 `isSitePagePath` 选同样的两条。路径前缀和前端路由 `SITE_HOME_PATH` 由单元测试核对一致。
- `Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 不变（Stripe Elements 不依赖 Referer；本站页面仍不许被别人嵌入）。

### 测试怎么不碰真实 Stripe

- 组件测试：`createStripePaymentDriver(load)` 的加载函数换成 Stripe.js 的假实现（`src/testing/fake-stripe-js.ts`），覆盖加载中、可付、校验不过、验证中、失败卡、处理中、网络失败、付款成功轮询到已确认、加载失败重新加载、已经付过、付款已结束、回跳取回令牌和取不回、主题切换；加载器本身用不插进页面的 `append` 测（测试环境不真的去取站外脚本）。
- 端到端测试：另起一组「配了 Stripe」的 API 和前端（Stripe 三项是本次运行随机生成的 `sk_test_` / `pk_test_` / `whsec_`，不是任何账号的密钥），后端的 `STRIPE_API_URL` 指向本机的假 Stripe 服务（只有 local / ci 能配，同 `GOOGLE_MAPS_ROUTES_URL`），假 Stripe 付款有结果后给这个 API 发签了名的通知，订单由后端照常自动确认。浏览器这边**不给生产代码加任何「换 Stripe.js 地址」的开关**：页面照常请求 `https://js.stripe.com/v3/`，由 Playwright 在网络层换成假脚本，`api.stripe.com`、`hooks.stripe.com` 转给假 Stripe 服务——内容安全策略照样生效（被策略拦下的请求到不了网络层），所以端到端测试同时验证了策略放行得够用。比起环境变量换地址，这样正式构建里没有任何能把 Stripe.js 指到别处的配置。
- 内容安全策略：`e2e/security.spec.ts` 在登录页、运营后台等页面插 Stripe 的脚本、框架、连 Stripe 接口都被拦下，在官网页面都能加载；`site-payment.spec.ts` 全程没有任何策略违规；`deploy-web.test.ts`、`site-csp.test.ts` 核对生成的策略；`deploy/ci/smoke.sh` 在真实容器上核对官网页面的策略带着这三条。

### 测试环境验收（用真实的 Stripe 测试模式，由验收角色做）

1. 官网下一张单，订单页「付款」区块出现 Stripe 的银行卡表单（浏览器开发者工具的控制台里没有 Content-Security-Policy 的报错）；表单上没有 Link 的入口（「使用 Link……」「保存我的信息」），输完安全码焦点不会跳进 Link 的邮箱框。
2. 失败卡 `4000 0000 0000 0002`：显示「付款没有成功：您的银行卡被拒绝了……」，表单还在；`4000 0000 0000 9995`：余额不足；刷新后提示仍是中文。
3. 3D 验证卡 `4000 0027 6000 3184`：弹出验证窗口，点「失败」显示验证没有通过（滚到下面点确认时，提示也要出现在屏幕里）；再付一次点「完成」→「付款成功，等待确认」。
4. 成功卡 `4242 4242 4242 4242`（任意未来日期、任意 CVC）：「付款成功，等待确认」→ 几秒后自动变成「已确认」；运营后台订单中心里这一单已确认，Stripe 测试模式后台的 Webhook 记录是 200。

## 不做 / 已知限制

- Apple Pay、Google Pay、Link 等：只收银行卡（事后加收要能离线扣同一张卡，ADR 0026、0029）。要两处一起才做得到：后端建付款时 `allowed_payment_method_types: ["card"]` 管付款方式；Link、Apple Pay、Google Pay 这些钱包不算付款方式，只要允许银行卡就默认出现（真实付款验收发现 Link 的入口），所以前端建 Payment Element 时传 `wallets: { applePay: "never", googlePay: "never", link: "never" }`（Stripe.js 文档 create_payment_element）。不依赖 Stripe 后台的设置。以后要加别的支付方式时再看是否需要更多来源（例如需要整页跳转的支付方式会真正用到上面的回跳）。
- Stripe 将来如果要求新的来源（官方清单变了），要同时改 `STRIPE_CSP_SOURCES`、本文和对应测试；测试环境验收第 1 步的控制台检查能第一时间发现。
- 订单页在客人付完款但通知还没到时关掉：订单照样会由通知确认，客人之后打开链接看到已确认；页面不会、也不需要替平台确认订单。
