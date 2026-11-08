# ADR 0067：邮件的 HTML 版（品牌页眉）

- 状态：已采纳（2026-11-08，M6-06）。M6「整站美化」的一批：只改邮件的呈现，不改任何邮件的主题、正文文字、发信时机和收件人。
- 补充 ADR 0048「邮件发送（SMTP）」：内部发信接口不变（`sendMail(ctx, { to, subject, text, html? })`），只是 `html` 不给时由发信模块自动排一份。
- **改变 ADR 0049 和 ADR 0050 的一条决定**：两篇原来写邮件「只发纯文本」（通知中心的各类邮件、邮箱验证码邮件）。现在改为纯文本 + HTML 两部分一起发（multipart/alternative），纯文本部分和原来一字不差。原来只发纯文本的理由——客人填的内容不能变成 HTML（防注入）、不带追踪像素和外链图片——由本篇第 3 节（全部转义、只认 http/https、不引用任何外部资源）继续保证。
- 补充 ADR 0066「视觉规范」：邮件页眉用品牌色带（`color-brand`）和字标「NOZOMI」，颜色取自 `docs/design/tokens.css`。
- 编号：写这篇时 main 上最大是 ADR 0066（M6-01），这里用 0067。

## 背景

到 M6 为止所有邮件都只有纯文字。纯文字最稳，但在手机邮箱里是一整块小字：订单链接、司机任务链接要在一长串字里找，验证码和正文一样大。ADR 0066 已经把品牌色带定为「登录页、官网页眉、邮件页眉」共用。

约束：

- 邮件正文由很多地方拼出来（通知中心的模板、司机任务链接、验证码登录、工单、乘客邮箱复核……），改每一处既容易漏、也容易改动文案。
- 正文里有客人填写的内容（姓名、备注、行程地址），HTML 版一不小心就成了注入点。
- 邮件客户端对 HTML / CSS 的支持参差：不认 CSS 变量，Gmail 会删掉一部分 `<style>`，Outlook（Windows）用 Word 排版。

## 决定

### 1. 从纯文字自动生成，一处接上

- `@nozomi/domain` 的 `renderMailHtml({ subject, text })`（`packages/domain/src/mail-html.ts`）：纯函数，输入纯文字正文，输出整封 HTML。
- 接在 `apps/api/src/integrations/smtp.ts` 真正发信的地方：`html: message.html ?? renderMailHtml(message)`。所有邮件都从这里出去，调用方一行不改；纯文字版照旧作为 `text` 一起发，nodemailer 打成 `multipart/alternative`（客户端自己选：能显示 HTML 的显示 HTML，纯文字客户端、读屏软件照样读纯文字）。
- 调用方自己给了 `html` 的，原样用调用方的（目前没有调用方给）。
- 接在发信模块而不是 `services/mail.ts`：测试里替身发信器（`ctx.mailer`）收到的仍是调用方给的原样内容，已有的断言不受影响；真正发出去的邮件由「本机假 SMTP」的测试覆盖。

### 2. 文字一字不改

- HTML 版里的文字就是纯文字版的文字，只多一个页眉字标「NOZOMI」。**不加任何新文案**：没有「打开链接」之类的按钮文字，没有页脚说明（正文末尾本来就有「NOZOMI 用车」「NOZOMI 平台」落款，所以不另设页脚）。
- 排版规则：
  - 按空行分段（多个空行、只有空白的行都算空行），段内换行用 `<br>`。
  - **单独一行、整行就是 http(s) 网址**：做成醒目的按钮（`color-primary` 底、`color-on-primary` 字，圆角 8px），**按钮文字就是网址本身**（长网址自动折行）。考虑过两种做法都不用：「打开链接」是新增文案，而且对四种语言的客人不一定合适；拿上一行的说明（如「查看和管理订单：」）当按钮文字，会让说明出现两次或从原来的位置消失，也不是每个网址上一行都是说明。按钮文字 = 网址，读者看到的内容和纯文字版完全一样，复制网址也最直接。
  - **行内网址**（一行里夹着网址）：变成可点的链接，颜色 `color-text-link`。网址后面紧跟的中文标点（「。」「）」）本来就不在网址字符里，英文标点（`.`、`)`、`,` 等）去掉不算。
  - **单独一行、只有 4–8 位数字**（验证码）：等宽字体、32px、粗体、字距 0.3em，`color-bg-subtle` 底。3 位、9 位、全角数字、夹在文字里的数字不算。
- 单元测试把 HTML 去掉标签、还原实体、空白归一化以后和原文比较，必须等于「NOZOMI + 原文」。

### 3. 安全

- **先转义再排版**：所有文字（包括 `<title>` 里的主题）经 `&`、`<`、`>`、`"`、`'` 五个字符的转义后才放进 HTML。正文里写的 `<script>`、`<img onerror>` 只会显示成文字。
- **链接协议白名单**：只认 `http:`、`https:` 的绝对网址（`new URL` 能解析、有主机名）。`javascript:`、`data:`、`file:`、`mailto:`、`ftp:` 等一律原样当文字，不生成 `href`。`href` 的值同样经过转义，引号跳不出属性。
- 不引用任何外部资源：没有图片、外部样式、网络字体、跟踪像素（邮件打开时不会向任何地方发请求）。
- 防邮件头注入的规则（ADR 0048 的 `mailMessageIssues`）不变，HTML 只是正文的另一部分，不进邮件头。

### 4. 邮件客户端兼容的取舍

- **表格布局 + 内联样式**：外层 100% 宽的底色表格，里面一张最宽 600px 的卡片（1px 描边、圆角 10px），卡片顶部是品牌色带。按钮是「表格单元格底色 + 链接内边距」的写法（Outlook 也有底色）。
- **手机**：`width=100%` + `max-width:600px` 自适应；支持媒体查询的客户端在 620px 以下去掉外边距和卡片左右描边，正文内边距缩小。
- **暗色**：`<meta name="color-scheme" content="light dark">`、`supported-color-schemes` 和 `@media (prefers-color-scheme: dark)` 的一组暗色令牌（用 `!important` 盖过内联样式）。支持的客户端（Apple Mail、iOS 邮件等）显示我们的暗色；不支持的显示亮色，或由客户端自己反色（Gmail、Outlook 的做法）——亮色本身在白底上对比度合格，反色后也可读。
- **颜色**：邮件里不能用 CSS 变量，十六进制写死在 `MAIL_LIGHT_COLORS`、`MAIL_DARK_COLORS` 两张表里，键就是令牌名；单元测试读 `docs/design/tokens.css` 逐个比对，并检查 HTML 里出现的每个十六进制都在这两张表里。以后改令牌，这个测试会提醒同步邮件。
- **字体**：系统字体栈，合并 `font-family-sans` 和 `font-family-sans-ja`（含 Hiragino、Yu Gothic、Meiryo），验证码用 `font-family-mono`。不加载网络字体。
- **语言**：`<html lang="zh-Hans">`，和现有界面一致。邮件内容目前都是中文模板；以后有日文、英文模板时再按模板语言传 `lang`（那时新增参数，不影响现在的调用）。
- 不追求在所有客户端像素一致：Gmail 网页版会删掉 `<style>`（只剩内联的亮色样式，排版不受影响），Outlook（Windows）不认圆角（显示直角）。这些都不影响阅读和点击。

## 后果

- 每封邮件大约多 4–6 KB（HTML 部分），对发送没有影响。
- 测试辅助 `decodedMailText` 改成能从 `multipart/alternative` 里取纯文字那一部分，另加 `decodedMailHtml`。通知中心的三个集成测试文件（`notifications.itest.ts`、`notifications-delivery.qa.itest.ts`、`notifications-time.qa.itest.ts`）原来各有一份只认单一正文的解码函数，改为调用 `decodedMailText`，断言不变。
- `notifications-delivery.qa.itest.ts` 原有一条断言「邮件只有纯文本部分、没有 text/html」，那是为了确认客人填写的 HTML 不会被当成 HTML。按新行为改成：邮件是 `multipart/alternative`，HTML 版里客人填的 `<img onerror>`、`<b>` 都被转义成文字，备注仍然不进任何一部分。
- 以后要做「一封邮件专门设计的 HTML」（比如带行程表格），调用方直接给 `html` 即可，发信模块不再自动生成；但那时同样要遵守本篇的转义和协议白名单。

## 测试

- 单元（`packages/domain/src/mail-html.test.ts`）：转义（`<script>`、`&`、引号、主题）、分段与换行、单独一行网址变按钮且 `href` 正确、行内网址和尾随标点、非 http(s) 协议不变链接、验证码行、去标签后的文字与原文一致、空正文、整封结构（`lang`、暗色、600px、无外部资源）、颜色与 `tokens.css` 一致。
- 发信模块（`apps/api/src/integrations/smtp.test.ts`，本机假 SMTP）：只给纯文字时发出 `multipart/alternative`，纯文字版原样，HTML 版等于 `renderMailHtml` 的结果；调用方给了 HTML 就用调用方的。
- 集成（真实 PostgreSQL + 本机假 SMTP）：验证码登录发出的邮件（`email-login.itest.ts`）和经 `sendMail` 发出的含客人填写内容的邮件（`email-settings.itest.ts`）都同时有 `text/plain` 和 `text/html`，HTML 有品牌页眉，文字和纯文字版一致，客人内容被转义，只有 http(s) 网址成为链接。
