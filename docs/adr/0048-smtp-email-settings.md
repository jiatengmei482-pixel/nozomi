# ADR 0048：在运营后台填写邮件发送（SMTP）

- 状态：已采纳（2026-11-01，M4-14）
- 补充 ADR 0041「在运营后台填写第三方密钥」：多一项 `email`。权限、加密存放、优先顺序、缓存、审计、「测试一下」的限速都**沿用 0041，不另起一套**；本文只写不一样的地方。
- 补充 ADR 0005「配置与密钥」：`.env` 多 7 项 `SMTP_*`（备选，可以不填）。
- 补充 ADR 0027 的出站防 SSRF：复用 `@nozomi/domain` 的地址分类（`ipAddressClass`、`webhookHostAllowed`）。
- 迁移 0130：`integration_secrets` 的 `integration` 允许 `email`。
- 后面的通知中心（M4-08）、邮箱验证码登录（M4-06）都经本文的内部发信接口发信。

## 背景

负责人决定：邮件通知先在运营后台加「邮件发送」卡片，支持通用 SMTP（不绑定某一家邮件服务商），他自己填写，不用登录服务器。和 Stripe 卡片同样的安全做法：加密保存、只显示末位、改动留审计、「测试一下」发一封测试邮件。

SMTP 和前两项有一个本质不同：**地址是人填的**。谷歌、Stripe 的地址写死在代码里，SMTP 的主机和端口却来自表单——能改这一项的人可以让服务器去连任意地址，所以多了防 SSRF；能发信的接口也可能被当成发信工具，所以收件人不接受外部输入。

## 决定

### 字段

| 接口字段 | `.env` | 规则 | 显示 |
| --- | --- | --- | --- |
| `host` | `SMTP_HOST` | 域名或 IP，最长 253；不能是内网、回环、链路本地地址和只在内网解析的名字（见「防 SSRF」） | 明文，只给超级管理员 |
| `port` | `SMTP_PORT` | 只能是 25、465、587、2525 | 同上 |
| `encryption` | `SMTP_ENCRYPTION` | `tls`（一连上就是 TLS，常配 465）/ `starttls`（连上后升级，升级不了就失败、不退回明文，常配 587）/ `none`（明文，**只有 local / ci 允许**，测试环境和正式环境拒绝） | 同上 |
| `username` | `SMTP_USERNAME` | 必填，1–255，不能有控制字符 | 同上 |
| `password` | `SMTP_PASSWORD` | 必填，8–255，不能有控制字符。**唯一的密钥** | 只显示 `••••` + 末 4 位（短于 16 个字符的只有圆点，同 0041） |
| `from_name` | `SMTP_FROM_NAME` | 必填，1–100，不能有换行等控制字符 | 明文，只给超级管理员 |
| `from_address` | `SMTP_FROM_ADDRESS` | 必填，一个邮箱地址（英文字符，不带姓名、不带逗号） | 同上 |

- 七项是一组，和 Stripe 三项一样整组来自同一处；`.env` 里只填几项启动报错，`none` 在测试环境、正式环境启动报错。
- **不支持免认证发信**：这个系统发信一律要账号密码。自建的开放转发不在范围内。
- 首尾空白去掉（粘贴时常带）；主机名转小写。
- **每次保存都要重新填密码，不能留空沿用旧密码**：否则能进这个页面的人只要改主机、留空密码、点「测试一下」，服务器就会把旧密码发到他指定的地方。这一点比「改个发件人名称要重输密码」重要。
- 校验放在 `packages/config`（`.env` 和后台共用、`resolveIntegrations` 也要用）；只有「主机是不是内网」放在 `packages/domain`（地址分类在那里，`config` 不依赖 `domain`），由 `apps/api` 在保存和读出时调用。

### 加密范围

整组七项作为一个 JSON 加密放进 `integration_secrets.sealed`（沿用 `SecretBox`，用途 `integration-secret`，附加数据是这一行的 `integration`）。`hints` 只有 `{ password: "••••1234" }`。其余六项不是密钥，也随整组加密：只有一个列、不用改结构，读出时一起解开。

### 谁能做什么

同 0041：改、清空、测试要 `integration.manage`（只归超级管理员，自建角色勾不了）；有 `integration.read` 的人（技术、勾了「集成状态 · 查看」的自建角色）只看到已配置 / 未配置和来源，`masked`、`settings`、`admin` 都是 null。

`/platform/v1/integrations` 的说明同理：超级管理员看到 `主机:端口 · 来源（••••1234）`，其他人只有来源。`/health` 只有已配置 / 未配置。

### 优先顺序

同 0041：**后台填写的优先；后台没填（或清空后）才用 `.env`；都没有就是未配置。**

后台那一份不生效、回落到 `.env` 的情况（`admin.problem`）：解不开（`UNREADABLE`）；写着 `none` 或内网主机的库到了测试环境、正式环境（`NOT_ALLOWED_IN_ENV`）。

### 防 SSRF

规则集中在 `@nozomi/domain` 的 `mail.ts`，分三道：

1. **保存时**（后台）：主机不能是内网、回环、链路本地、元数据地址，不能是 `localhost`、`.local`、`.internal` 这类名字，不能是没有点的名字，不能是数字写法的地址（`2130706433`、`0x7f.1`）。不合格 400，`reason = HOST_FORBIDDEN`。读出后台那一份时同样核对。
2. **每次发信前**：解析域名，**解析到的每一个地址**都必须是公网地址，有一个不是就整体拒绝（`TARGET_FORBIDDEN`）。`.env` 来的主机也走这一步。
3. **连接时只连第 2 步检查过的地址**：自己建连接交给 nodemailer，nodemailer 不再解析，防「检查时是公网、连接时变成内网」的 DNS 重绑定。TLS 证书仍按原来的域名校验，**任何环境都不关校验**。

端口只收 25、465、587、2525：防止把这个表单当成端口扫描工具，也防止对内部的其他服务说 SMTP。

**local / ci 的例外只放开回环地址**（本机的假 SMTP 服务器，它的端口是随机的，所以回环地址也不限端口）。内网、链路本地、元数据地址在任何环境都拒绝——比「local / ci 全放开」严，假服务器也用不到它们。例外由 `APP_ENV` 决定，测试环境、正式环境打不开。

顺带的代价：如果以后要用同一内网里的邮件转发，要先改这里的规则（写新 ADR）。

### 测试一下

- **收件人只能是当前操作的超级管理员自己的邮箱**。接口不接受任何收件人参数（请求体里写了也不看），不会被当成发信工具。结果的 `message` 写明发到了哪个地址。
- 测的是现在生效的那一份（不论来自后台还是 `.env`）；都没有配置 409 `INTEGRATION_NOT_CONFIGURED`。
- 限速沿用 0041：同一项每 5 秒最多一次，不分人（429 `INTEGRATION_TEST_RATE_LIMITED`）。
- 结果是数据（200），`code` 的分类：

| `code` | 含义 |
| --- | --- |
| null（`ok: true`） | 邮件服务器已接收。不代表已进收件箱（可能进垃圾箱），页面请负责人去邮箱确认 |
| `UNREACHABLE` | 连接失败：连不上、域名解析不了、连接被断开 |
| `TLS_FAILED` | TLS 失败：证书不对、过期，服务器不支持 STARTTLS，或加密方式和端口不配 |
| `AUTH_FAILED` | 认证失败：用户名或密码不对 |
| `SENDER_REJECTED` | 发件人被拒：账号不能用这个发件人地址，或服务器不接受这封邮件 |
| `RECIPIENT_REJECTED` | 收件人被拒（当前账号的邮箱） |
| `TARGET_FORBIDDEN` | 主机或解析到的地址是内网地址 |
| `TIMEOUT` | 超时 |
| `UNEXPECTED` | 服务器的应答看不懂 |

- `message` 是我们自己写的一句话，**不带服务器返回的原文**（里面可能有请求内容），更不带密码。
- 重用 0041 已有的 `UNREACHABLE`、`TIMEOUT`、`UNEXPECTED` 这几个代码，说法一样。

### 时限与重试

- 一次发信总时限 **15 秒**（含解析、连接、TLS、发送），到点直接断开连接。
- 连接一步最多 5 秒；**只有连接这一步失败才重试**（换下一个解析到的地址，再试 1 次，IPv4 排前面——很多服务器没有 IPv6）。连上之后失败不重试：可能已经发出去了，重试会让客人收到两封。
- 通知中心要的「过一阵再发」不在这里做，归 M4-08 的发送记录和任务。

### 内部发信接口

```ts
// apps/api/src/services/mail.ts
sendMail(ctx, { to, subject, text, html? }): Promise<MailResult>
// MailResult = { ok: true; messageId } | { ok: false; code; message }
```

- 每次现取生效的配置（`ctx.integrations`），保存后下一封就用新的；**失败是返回值，不抛异常**（通知中心要按失败记录）。没配置 `NOT_CONFIGURED`，内容不合格 `MESSAGE_INVALID`，其余同上表。
- **防邮件头注入**（`@nozomi/domain` 的 `mailMessageIssues`）：收件人只能是一个邮箱地址，不能有换行、逗号、尖括号、空白；主题最长 200，不能有换行等控制字符；`text` 必填。不合格一个字节都不发。发件人名称在保存时同样拒绝控制字符。
- 只接受这四项：没有附件、没有自定义头、不接受路径和网址（nodemailer 的 `disableFileAccess`、`disableUrlAccess` 打开）。
- nodemailer 只在 `apps/api/src/integrations/smtp.ts` 出现，它的日志关闭。

### 立即生效

同 0041：本进程保存后立刻重读，别的进程最迟 5 秒。发信的连接不复用，每封新建，所以换了配置下一封就用新的。

### 审计

资源 `integration_secret`，`resource_id = email`；动作 `set`、`replace`、`clear`、`test`。

- 前后值：`{ hints: { password: "••••1234" }, settings: { host, port, encryption, from_name, from_address } }`。记主机是因为「服务器被改去连哪里」正是要查的；**不记密码，也不记用户名**（审计日志的读者比这张卡片多，用户名常常就是邮箱账号）。
- 测试：`{ source, ok, code }`，收件人就是操作人。

### 日志

密码进日志脱敏的名单（`.env` 的和后台的，每次现取）；至少 8 个字符的校验保证它在脱敏的最短长度之上。其他六项不进名单（`587`、`tls` 不该被抹掉）。

## 接口

沿用 `/platform/v1/integration-secrets`，`key` 多一个 `email`：

| 接口 | 说明 |
| --- | --- |
| `GET /platform/v1/integration-secrets` | `items` 多一项 `email`；每一项多一个 `settings`（只有 `email` 且超级管理员才有内容，其余 null） |
| `PUT /platform/v1/integration-secrets/email` | `{ host, port, encryption, username, password, from_name, from_address }`；`port` 是数字 |
| `DELETE /platform/v1/integration-secrets/email` | 清空，回落 `.env` |
| `POST /platform/v1/integration-secrets/email/test` | 发测试邮件给自己 |

`/health`、`GET /platform/v1/integrations` 多一项 `email`。

不合格的新原因：`PORT_NOT_ALLOWED`、`ENCRYPTION_NOT_ALLOWED`、`HOST_FORBIDDEN`。

## 上线

- `deploy/compose.yml` 把 `SMTP_*` 传给服务进程（都可以不填）。正式环境不要求配置，和谷歌地图、Stripe 一样（0041）。
- 从 VPS 连外面的 25 端口常被云厂商封，推荐 465 或 587。
- SPF、DKIM、DMARC 由负责人在域名和邮件服务商那边设置：不设的话邮件能发出去，但容易进垃圾箱。本系统不做 DKIM 签名。

## 测试

- 单元：字段校验（`packages/config`）、主机和邮件内容规则（`packages/domain`）、发信模块（`apps/api/src/integrations/smtp.test.ts`，本机假 SMTP：加密方式、证书校验、错误分类、重试、时限、地址固定）。
- 集成（真实 PostgreSQL + 本机假 SMTP，**从不连真实的邮件服务**）：权限、原文不泄露（应答、审计、日志、数据库按值比对）、保存即生效、清空回落、测试邮件成功和各种失败、只发给本人、SSRF 拦截、头注入拒绝。

## 本期不做

- 改动的双人复核（同 0041）。
- 附件、抄送、自定义邮件头、DKIM 签名、连接池。
- 退信处理、「已送达」状态（归 M4-08）。
- 免认证的 SMTP、OAuth2 登录（Gmail / Microsoft 的 OAuth）：用应用专用密码或邮件服务商的 SMTP 密钥。
