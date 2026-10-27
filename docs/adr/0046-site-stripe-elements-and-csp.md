# ADR 0046：官网付款接入 Stripe Elements——Stripe.js 的加载、付款流程、银行验证回跳的令牌、只在官网页面放行 Stripe 的内容安全策略

- 状态：已采纳（2026-10-27，M3-08）
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
- 语言 `zh`（官网是中文界面），Stripe 的表单和它给的出错说明都是简体中文——失败卡的原因直接用 Stripe 的原话。

### 付款流程（`lib/payment-driver.ts` 的 `createStripePaymentDriver`，订单页 `PaymentPanel`）

1. 取付款凭据：刚下单时用下单应答里的，之后用 `GET /site/v1/order/payment`。`client_secret` 为 null（过了付款期限、订单不是待付款）时说「这张订单现在不能付款了」并刷新订单。
2. `stripe.retrievePaymentIntent(client_secret)` 先查这笔付款：已成功、处理中的**不再显示表单**，直接进第 6 步（刷新页面、从银行页面回来、在另一个标签页付过）；已取消的说明并刷新订单；上次没付成的（`last_payment_error`）把原因显示出来。
3. 挂 Payment Element（`layout: "tabs"`；只收银行卡由后端建付款时决定）。外观取自设计令牌：Stripe 的表单在 iframe 里读不到本站的 CSS 变量，所以挂表单时把令牌的当前值读出来交给它（主色、底色、文字、出错色、字体、字号、圆角、边框），亮暗主题按当前主题选 `stripe` / `night`；主题切换时重新读一遍交给它。
4. 客人点「付款 22,000 JPY」：先 `elements.submit()` 校验（卡号不完整等由 Stripe 在表单里标出，页面再给一句原话），通过才出页面内确认「确认支付 22,000 JPY？」——并写明「如果银行要求验证，会弹出银行的验证窗口」。
5. 「确认支付」：`stripe.confirmPayment({ elements, confirmParams: { return_url }, redirect: "if_required" })`。银行卡的 3D 验证由 Stripe 的弹窗完成，弹窗开着的时候按钮显示「正在付款」、「返回」不能点。结果：
   - 成功 / 处理中 → 第 6 步；
   - 卡被拒、余额不足、验证没通过、填写不对（`card_error`、`validation_error`、`payment_intent_authentication_failure`）→「付款没有成功：〈Stripe 的原话〉请换一张卡，或检查后再付。」表单留着；
   - 没连上 Stripe（`api_connection_error`、请求抛错）→ 先再查一次这笔付款（确认请求其实到了的话按实际结果），仍是待付款就说「没有连上 Stripe，这次付款可能没有提交。请检查网络后再点「付款」；同一张订单不会被扣两次」——同一笔 PaymentIntent 只能成功一次；
   - 其他错误 → 同样先再查一次，仍没付成就说「付款没有完成」+ Stripe 的说明（有的话）。
6. 付款已提交：拆掉表单，显示「付款成功，等待确认。订单通常几秒钟内确认，页面会自动更新，请不要重复付款。」（处理中：「银行正在处理这笔付款……」）。马上刷新一次订单，之后每 3 秒一次；2 分钟还没确认就改成每 15 秒，并补一句「确认比平时慢：您可以先关掉页面，稍后再打开这个链接查看；有疑问请联系客服」。
7. 订单不再是待付款时付款区块消失（轮询随之停止）；这次看页面时订单从待付款变成已确认，顶部显示「付款成功，订单已确认。派车后这里会显示司机和车辆。」

**订单是否确认只认 Stripe 发给平台的通知**（ADR 0026）：第 6 步说的是「Stripe 收下了这笔付款」，订单状态一律以后端为准，前端从不自己把订单标成已确认。

### 银行验证回跳：令牌不进 return_url

银行卡的 3D 验证一般在 Stripe 的弹窗里完成，页面不离开；但 `confirmPayment` 必须给 `return_url`，少数情况 Stripe 会把整页带去银行页面，验证完回到 `return_url?payment_intent=…&payment_intent_client_secret=…&redirect_status=…`。

- `return_url` 固定是 `https://<本站>/book/order`，**不带令牌**：`return_url` 会随确认请求发给 Stripe、记在这笔 PaymentIntent 上（Stripe 后台看得到）。考虑过放在 `#` 后面（`/book/order#nzo_…`）：令牌一样会发给 Stripe，而且 Stripe 往地址上加参数时是否保留 `#` 没有书面保证。
- 做法：点「确认支付」之前，把 `{ 付款编号, 令牌, 时间 }` 写进**本标签页**的 sessionStorage（键 `nozomi.payment-return`，`lib/payment-return.ts`）；确认有了结果（没被带走）立刻删掉。回到 `/book/order?payment_intent=pi_…` 时：读出来**先删掉**，付款编号对得上、令牌格式对、写入不超过 1 小时才用，地址换成 `/book/order#<令牌>`（`replace`，Stripe 加的参数——其中有 client_secret——不留在地址栏和浏览历史里），随后照常用请求头读订单。
- 取不回（换了标签页或浏览器、存储被清、对不上）：去「查订单」，提示「付款结果已交给银行处理……请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款」。
- 这是令牌唯一一次进浏览器存储：只在本标签页、最长 1 小时、只有一个键、取一次就删（`styles.edge.test.ts` 核对这个文件只碰这一个键，只有付款区块写、只有订单页读）。
- 回到订单页后照第 2 步：Stripe 说成功就等待确认，说没成功就显示原因、可以再付。

### 内容安全策略：只在官网页面放行 Stripe

| 指令 | 官网页面（`/book`、`/book/*`） | 其余页面（两个后台、登录、司机页等） |
| --- | --- | --- |
| script-src | `'self'` + 主题脚本哈希 + `https://js.stripe.com https://*.js.stripe.com` | `'self'` + 主题脚本哈希 |
| frame-src | `https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com` | 不写（按 `default-src 'self'`） |
| connect-src | `'self' https://api.stripe.com` | `'self'` |
| 其余 | 相同（`default-src 'self'`、`style-src 'self'`、`img-src 'self'` + 底图、`object-src 'none'`、`base-uri 'none'`、`form-action 'self'`、`frame-ancestors 'none'`） | 同左 |

- 来源按 Stripe 官方文档「Content Security Policy」的清单取本站用得到的最小集：Stripe.js 本身（`js.stripe.com`，以及它按版本拆出去的 `*.js.stripe.com`——文档要求两项都放）、付款表单和 3D 验证的 iframe（`js.stripe.com`、`hooks.stripe.com`）、Stripe.js 调的接口（`api.stripe.com`）。**不放**文档里 Address Element 地址补全用的 `maps.googleapis.com`（本站不用 Stripe 的地址表单）；不放 `img-src`、`style-src`（Stripe 的图片和样式都在它自己的 iframe 里，对父页面的样式只用脚本设置，不受 `style-src` 限制）；不放 `unsafe-inline`、`unsafe-eval`。
- 为什么按路径分两条而不是全站放行：后台页面登录后持有令牌，放行站外脚本来源只会扩大被注入时能做的事；后台用不到 Stripe。官网是一个单页应用，策略按**打开页面时**的路径定：从官网页面打开后在页面内跳到后台路由会沿用官网那一条，但官网页面上没有去后台的链接；直接打开后台的任何地址都是不放行的那一条。
- 实现：`apps/web/build/edge-config.ts` 的 `contentSecurityPolicy(哈希, 图片来源, { payments })` 和 `STRIPE_CSP_SOURCES`；构建镜像时生成的 Caddy 片段里是两个互斥的匹配器 `@site_pages path /book /book/*`、`@other_pages not path /book /book/*` 各一条 `header`（每个响应恰好一条策略；`caddy validate` 和真实 Caddy 上逐路径核对过）；端到端测试用的 `vite preview` 按同一个函数 `isSitePagePath` 选同样的两条。路径前缀和前端路由 `SITE_HOME_PATH` 由单元测试核对一致。
- `Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 不变（Stripe Elements 不依赖 Referer；本站页面仍不许被别人嵌入）。

### 测试怎么不碰真实 Stripe

- 组件测试：`createStripePaymentDriver(load)` 的加载函数换成 Stripe.js 的假实现（`src/testing/fake-stripe-js.ts`），覆盖加载中、可付、校验不过、验证中、失败卡、处理中、网络失败、付款成功轮询到已确认、加载失败重新加载、已经付过、付款已结束、回跳取回令牌和取不回、主题切换；加载器本身用不插进页面的 `append` 测（测试环境不真的去取站外脚本）。
- 端到端测试：另起一组「配了 Stripe」的 API 和前端（Stripe 三项是本次运行随机生成的 `sk_test_` / `pk_test_` / `whsec_`，不是任何账号的密钥），后端的 `STRIPE_API_URL` 指向本机的假 Stripe 服务（只有 local / ci 能配，同 `GOOGLE_MAPS_ROUTES_URL`），假 Stripe 付款有结果后给这个 API 发签了名的通知，订单由后端照常自动确认。浏览器这边**不给生产代码加任何「换 Stripe.js 地址」的开关**：页面照常请求 `https://js.stripe.com/v3/`，由 Playwright 在网络层换成假脚本，`api.stripe.com`、`hooks.stripe.com` 转给假 Stripe 服务——内容安全策略照样生效（被策略拦下的请求到不了网络层），所以端到端测试同时验证了策略放行得够用。比起环境变量换地址，这样正式构建里没有任何能把 Stripe.js 指到别处的配置。
- 内容安全策略：`e2e/security.spec.ts` 在登录页、运营后台等页面插 Stripe 的脚本、框架、连 Stripe 接口都被拦下，在官网页面都能加载；`site-payment.spec.ts` 全程没有任何策略违规；`deploy-web.test.ts`、`site-csp.test.ts` 核对生成的策略；`deploy/ci/smoke.sh` 在真实容器上核对官网页面的策略带着这三条。

### 测试环境验收（用真实的 Stripe 测试模式，由验收角色做）

1. 官网下一张单，订单页「付款」区块出现 Stripe 的银行卡表单（浏览器开发者工具的控制台里没有 Content-Security-Policy 的报错）。
2. 失败卡 `4000 0000 0000 0002`：显示「付款没有成功：您的银行卡被拒绝了……」，表单还在；`4000 0000 0000 9995`：余额不足。
3. 3D 验证卡 `4000 0027 6000 3184`：弹出验证窗口，点「失败」显示无法验证；再付一次点「完成」→「付款成功，等待确认」。
4. 成功卡 `4242 4242 4242 4242`（任意未来日期、任意 CVC）：「付款成功，等待确认」→ 几秒后自动变成「已确认」；运营后台订单中心里这一单已确认，Stripe 测试模式后台的 Webhook 记录是 200。

## 不做 / 已知限制

- Apple Pay、Google Pay、Link 等：后端建付款时只允许银行卡（事后加收要能离线扣同一张卡，ADR 0026、0029），Payment Element 里只会出现银行卡。以后要加别的支付方式时再看是否需要更多来源（例如需要整页跳转的支付方式会真正用到上面的回跳）。
- Stripe 将来如果要求新的来源（官方清单变了），要同时改 `STRIPE_CSP_SOURCES`、本文和对应测试；测试环境验收第 1 步的控制台检查能第一时间发现。
- 订单页在客人付完款但通知还没到时关掉：订单照样会由通知确认，客人之后打开链接看到已确认；页面不会、也不需要替平台确认订单。
