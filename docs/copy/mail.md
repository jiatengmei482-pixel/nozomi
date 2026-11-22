# 邮件和通知模板

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 193 条：写死 182 条，已走 key 11 条。列的意思见 [README](README.md)。

## 页面

- [司机链接邮件（driver-link-email.ts）](#司机链接邮件driver-link-emailts)（19 条）
- [邮箱验证码登录的规则（email-login.ts）](#邮箱验证码登录的规则email-logints)（6 条）
- [通知中心（notifications.ts）](#通知中心notificationsts)（168 条）

## 司机链接邮件（driver-link-email.ts）

文件：`packages/domain/src/driver-link-email.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `driver-link-email.7dbdb0b2` | 写死 | 调度员手动发送 | 文字 | [driver-link-email.ts:7](../../packages/domain/src/driver-link-email.ts#L7) |
| `driver-link-email.d4a5d9a0` | 写死 | 系统自动发送 | 文字 | [driver-link-email.ts:7](../../packages/domain/src/driver-link-email.ts#L7) |
| `driver-link-email.error.NOT_CONFIGURED` | 已走 key | 平台的邮件发送还没有配置好，请先复制链接手动发给司机 | 文字 | [driver-link-email.ts:165](../../packages/domain/src/driver-link-email.ts#L165) |
| `driver-link-email.error.RECIPIENT_REJECTED` | 已走 key | 对方邮件服务器拒收了这个地址，请核对司机邮箱，或复制链接手动发 | 文字 | [driver-link-email.ts:166](../../packages/domain/src/driver-link-email.ts#L166) |
| `driver-link-email.error.MESSAGE_INVALID` | 已走 key | 司机邮箱的写法有问题，请核对后重发，或复制链接手动发 | 提示 | [driver-link-email.ts:167](../../packages/domain/src/driver-link-email.ts#L167) |
| `driver-link-email.error.OUTCOME_UNKNOWN` | 已走 key | 发送途中服务中断，不知道发出去了没有，请和司机确认，或复制链接手动发 | 文字 | [driver-link-email.ts:168](../../packages/domain/src/driver-link-email.ts#L168) |
| `driver-link-email.error.ORDER_STATE_CHANGED` | 已走 key | 订单情况变了（取消、改派或救援），这封不再发送 | 文字 | [driver-link-email.ts:169](../../packages/domain/src/driver-link-email.ts#L169) |
| `driver-link-email.error.DRIVER_LINK_REVOKED` | 已走 key | 排队期间链接已被作废，这封不再发送 | 文字 | [driver-link-email.ts:170](../../packages/domain/src/driver-link-email.ts#L170) |
| `driver-link-email.error.DRIVER_LINK_SUPERSEDED` | 已走 key | 后来又发起了一次发送，这封不再发送 | 文字 | [driver-link-email.ts:171](../../packages/domain/src/driver-link-email.ts#L171) |
| `driver-link-email.error.DRIVER_LINK_MANUAL` | 已走 key | 已改成手动发送，这封不再发送 | 文字 | [driver-link-email.ts:172](../../packages/domain/src/driver-link-email.ts#L172) |
| `driver-link-email.error.DRIVER_EMAIL_MISSING` | 已走 key | 司机已经没有邮箱，这封不再发送 | 文字 | [driver-link-email.ts:173](../../packages/domain/src/driver-link-email.ts#L173) |
| `driver-link-email.error.DRIVER_DISABLED` | 已走 key | 司机已停用，这封不再发送 | 文字 | [driver-link-email.ts:174](../../packages/domain/src/driver-link-email.ts#L174) |
| `driver-link-email.error.EXPIRED` | 已走 key | 过了有效期没有发出去，请重发或复制链接手动发 | 文字 | [driver-link-email.ts:175](../../packages/domain/src/driver-link-email.ts#L175) |
| `driver-link-email.cdcc7bcc` | 写死 | 邮件发送失败，请稍后重发，或复制链接手动发给司机 | 提示 | [driver-link-email.ts:183](../../packages/domain/src/driver-link-email.ts#L183) |
| `driver-link-email.7cb4466f` | 写死 | 点对点 | 文字 | [driver-link-email.ts:190](../../packages/domain/src/driver-link-email.ts#L190) |
| `driver-link-email.8819c34c` | 写死 | 接机 | 文字 | [driver-link-email.ts:190](../../packages/domain/src/driver-link-email.ts#L190) |
| `driver-link-email.8f85417d` | 写死 | 接送机 | 文字 | [driver-link-email.ts:190](../../packages/domain/src/driver-link-email.ts#L190) |
| `driver-link-email.99d64cbe` | 写死 | 送机 | 文字 | [driver-link-email.ts:190](../../packages/domain/src/driver-link-email.ts#L190) |
| `driver-link-email.e43db8ad` | 写死 | 包车 {packageHours} 小时 | 文字 | [driver-link-email.ts:190](../../packages/domain/src/driver-link-email.ts#L190) |

## 邮箱验证码登录的规则（email-login.ts）

文件：`packages/domain/src/email-login.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `email-login.26022ba2` | 写死 | 供应商后台 | 文字 | [email-login.ts:55](../../packages/domain/src/email-login.ts#L55) |
| `email-login.2f348ade` | 写死 | 运营后台 | 文字 | [email-login.ts:55](../../packages/domain/src/email-login.ts#L55) |
| `email-login.f3ad0367` | 写死 | NOZOMI 登录验证码 | 邮件主题 | [email-login.ts:60](../../packages/domain/src/email-login.ts#L60) |
| `email-login.e74c586f` | 写死 | 你正在登录 NOZOMI {…}，验证码是： | 文字 | [email-login.ts:62](../../packages/domain/src/email-login.ts#L62) |
| `email-login.a6297047` | 写死 | 验证码 {…} 分钟内有效，只能用一次。请不要告诉任何人，NOZOMI 的工作人员也不会向你索取。 | 文字 | [email-login.ts:66](../../packages/domain/src/email-login.ts#L66) |
| `email-login.35185a0e` | 写死 | 如果不是你本人操作，请忽略这封邮件，你的账号不受影响。 | 文字 | [email-login.ts:67](../../packages/domain/src/email-login.ts#L67) |

## 通知中心（notifications.ts）

文件：`packages/domain/src/notifications.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `notifications.3eb38d34` | 写死 | 平台员工 | 文字 | [notifications.ts:13](../../packages/domain/src/notifications.ts#L13) |
| `notifications.7d81313a` | 写死 | 供应商 | 文字 | [notifications.ts:13](../../packages/domain/src/notifications.ts#L13) |
| `notifications.7e74bf5c` | 写死 | 司机 | 文字 | [notifications.ts:13](../../packages/domain/src/notifications.ts#L13) |
| `notifications.ae304e12` | 写死 | 客人 | 文字 | [notifications.ts:13](../../packages/domain/src/notifications.ts#L13) |
| `notifications.e7779d8f` | 写死 | 订单确认 | 文字 | [notifications.ts:59](../../packages/domain/src/notifications.ts#L59) |
| `notifications.c0636e38` | 写死 | 司机信息 | 文字 | [notifications.ts:60](../../packages/domain/src/notifications.ts#L60) |
| `notifications.fbe6dd51` | 写死 | 司机链接 | 文字 | [notifications.ts:61](../../packages/domain/src/notifications.ts#L61) |
| `notifications.24b9ece3` | 写死 | 司机：客人申请修改 | 文字 | [notifications.ts:62](../../packages/domain/src/notifications.ts#L62) |
| `notifications.82155968` | 写死 | 司机：任务有更新 | 文字 | [notifications.ts:63](../../packages/domain/src/notifications.ts#L63) |
| `notifications.079817a4` | 写死 | 司机：修改没有通过 | 文字 | [notifications.ts:64](../../packages/domain/src/notifications.ts#L64) |
| `notifications.b7c9e2d6` | 写死 | 司机：任务取消 | 文字 | [notifications.ts:65](../../packages/domain/src/notifications.ts#L65) |
| `notifications.abfc2509` | 写死 | 用车提醒 | 文字 | [notifications.ts:66](../../packages/domain/src/notifications.ts#L66) |
| `notifications.282b1912` | 写死 | 司机已到达 | 文字 | [notifications.ts:67](../../packages/domain/src/notifications.ts#L67) |
| `notifications.7256dda8` | 写死 | 订单修改 | 文字 | [notifications.ts:68](../../packages/domain/src/notifications.ts#L68) |
| `notifications.81cb744b` | 写死 | 修改待确认 | 文字 | [notifications.ts:69](../../packages/domain/src/notifications.ts#L69) |
| `notifications.0dea2e7f` | 写死 | 修改未通过 | 文字 | [notifications.ts:70](../../packages/domain/src/notifications.ts#L70) |
| `notifications.c5146cae` | 写死 | 订单取消 | 文字 | [notifications.ts:71](../../packages/domain/src/notifications.ts#L71) |
| `notifications.cab7b0d8` | 写死 | 服务后费用 | 文字 | [notifications.ts:72](../../packages/domain/src/notifications.ts#L72) |
| `notifications.77f361ec` | 写死 | 工单回复 | 文字 | [notifications.ts:73](../../packages/domain/src/notifications.ts#L73) |
| `notifications.dcd0b9e5` | 写死 | 订单链接 | 文字 | [notifications.ts:74](../../packages/domain/src/notifications.ts#L74) |
| `notifications.250b50bc` | 写死 | 救援新订单 | 文字 | [notifications.ts:75](../../packages/domain/src/notifications.ts#L75) |
| `notifications.d808a56d` | 写死 | 进入救援改派 | 文字 | [notifications.ts:76](../../packages/domain/src/notifications.ts#L76) |
| `notifications.2c219f07` | 写死 | 超时未派车 | 文字 | [notifications.ts:77](../../packages/domain/src/notifications.ts#L77) |
| `notifications.edfae6d5` | 写死 | 司机未出发 | 文字 | [notifications.ts:78](../../packages/domain/src/notifications.ts#L78) |
| `notifications.bb8793f9` | 写死 | 工单待回复 | 文字 | [notifications.ts:79](../../packages/domain/src/notifications.ts#L79) |
| `notifications.4d1052e0` | 写死 | 资质快到期 | 文字 | [notifications.ts:80](../../packages/domain/src/notifications.ts#L80) |
| `notifications.4eef66f2` | 写死 | 资质已到期 | 文字 | [notifications.ts:81](../../packages/domain/src/notifications.ts#L81) |
| `notifications.55b85be0` | 写死 | 进入观察期 | 文字 | [notifications.ts:82](../../packages/domain/src/notifications.ts#L82) |
| `notifications.862ae2d9` | 写死 | 供应商状态变化 | 文字 | [notifications.ts:83](../../packages/domain/src/notifications.ts#L83) |
| `notifications.659ede4b` | 写死 | 供应商改了企业信息 | 文字 | [notifications.ts:84](../../packages/domain/src/notifications.ts#L84) |
| `notifications.7decb245` | 写死 | 供应商申请修改资料 | 文字 | [notifications.ts:85](../../packages/domain/src/notifications.ts#L85) |
| `notifications.a3f0b40b` | 写死 | 资料修改已生效 | 文字 | [notifications.ts:86](../../packages/domain/src/notifications.ts#L86)、200 行 |
| `notifications.0e461e13` | 写死 | 资料修改被驳回 | 文字 | [notifications.ts:87](../../packages/domain/src/notifications.ts#L87) |
| `notifications.3e797664` | 写死 | 收款账户已提交 | 文字 | [notifications.ts:88](../../packages/domain/src/notifications.ts#L88) |
| `notifications.183ad8b7` | 写死 | 收款账户已生效 | 文字 | [notifications.ts:89](../../packages/domain/src/notifications.ts#L89) |
| `notifications.3a1d32d9` | 写死 | 收款账户被驳回 | 文字 | [notifications.ts:90](../../packages/domain/src/notifications.ts#L90) |
| `notifications.8961b48b` | 写死 | 新的异常 | 文字 | [notifications.ts:91](../../packages/domain/src/notifications.ts#L91) |
| `notifications.a71e89d5` | 写死 | 汇率告警 | 文字 | [notifications.ts:92](../../packages/domain/src/notifications.ts#L92) |
| `notifications.d8127997` | 写死 | 官网找回告警 | 文字 | [notifications.ts:93](../../packages/domain/src/notifications.ts#L93) |
| `notifications.23e281a7` | 写死 | 失败 | 提示 | [notifications.ts:100](../../packages/domain/src/notifications.ts#L100) |
| `notifications.3ba8b4cd` | 写死 | 正在发送 | 文字 | [notifications.ts:100](../../packages/domain/src/notifications.ts#L100) |
| `notifications.73a17aed` | 写死 | 已发送 | 文字 | [notifications.ts:100](../../packages/domain/src/notifications.ts#L100) |
| `notifications.d4faab5b` | 写死 | 等待发送 | 文字 | [notifications.ts:100](../../packages/domain/src/notifications.ts#L100) |
| `notifications.f69821b7` | 写死 | 已过期 | 文字 | [notifications.ts:100](../../packages/domain/src/notifications.ts#L100) |
| `notifications.367b38d0` | 写死 | <br><br>查看和管理订单：<br>{{view\_url}}<br>这个链接只属于您的这张订单，请不要转发给别人。<br><br>NOZOMI 用车 | 文字 | [notifications.ts:154](../../packages/domain/src/notifications.ts#L154) |
| `notifications.1edd4672` | 写死 | 订单号：{{order\_no}}<br>用车时间：{{service\_time}}（当地时间）<br>行程：{{route}}<br>车型：{{vehicle\_group}}{VEHICLE\_LABEL\_LINES} | 文字 | [notifications.ts:158](../../packages/domain/src/notifications.ts#L158) |
| `notifications.c4f2491c` | 写死 | 订单号：{{order\_no}}<br>用车时间：{{service\_time}}（当地时间）<br>行程：{{route}}<br>车型：{{vehicle\_group}}{VEHICLE\_LABEL\_LINES}<br>人数：{{passengers}} | 文字 | [notifications.ts:159](../../packages/domain/src/notifications.ts#L159) |
| `notifications.5f3182b5` | 写死 | <br><br>到后台处理：<br>{{order\_url}}<br><br>NOZOMI 平台 | 文字 | [notifications.ts:160](../../packages/domain/src/notifications.ts#L160) |
| `notifications.188df130` | 写死 | 订单号：{{order\_no}}<br>用车时间：{{service\_time}}（当地时间）<br>行程：{{trip\_summary}}<br>车型：{{vehicle\_group}}{VEHICLE\_LABEL\_LINES} | 文字 | [notifications.ts:161](../../packages/domain/src/notifications.ts#L161) |
| `notifications.6df81c66` | 写死 | <br><br>NOZOMI 用车 | 文字 | [notifications.ts:162](../../packages/domain/src/notifications.ts#L162) |
| `notifications.e6a6f90b` | 写死 | <br><br>到后台查看：<br>{{console\_url}}<br><br>NOZOMI 平台 | 文字 | [notifications.ts:163](../../packages/domain/src/notifications.ts#L163) |
| `notifications.2970591e` | 写死 | {{passenger\_name}}，您好：<br><br>我们已收到您的付款，订单已确认。<br><br>{TRIP}<br>已付金额：{{paid\_amount}}{{area\_surcharge\_note}}{{pricing\_basis\_note}}<br>公里数：{{distance\_note}}<br>费用说明：{{fee\_note}}<br><br>派好司机后我们会再发邮件告诉您司机信息。{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:169](../../packages/domain/src/notifications.ts#L169) |
| `notifications.72e73a18` | 写死 | 预订已确认：{{order\_no}} | 邮件主题 | [notifications.ts:169](../../packages/domain/src/notifications.ts#L169) |
| `notifications.6cec79f3` | 写死 | {{passenger\_name}}，您好：<br><br>您的订单已安排司机。如果之前收到过司机信息，请以这一封为准。<br><br>{TRIP}<br>司机：{{driver\_name}}<br>电话：{{driver\_phone}}<br>车牌：{{vehicle\_plate}}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:170](../../packages/domain/src/notifications.ts#L170) |
| `notifications.9ad4eb7c` | 写死 | 司机信息：{{order\_no}} | 邮件主题 | [notifications.ts:170](../../packages/domain/src/notifications.ts#L170) |
| `notifications.2fe92a54` | 写死 | 用车提醒：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:171](../../packages/domain/src/notifications.ts#L171) |
| `notifications.c5c5b678` | 写死 | {{passenger\_name}}，您好：<br><br>您的用车时间快到了，请按时到达上车点。<br><br>{TRIP}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:171](../../packages/domain/src/notifications.ts#L171) |
| `notifications.1974202a` | 写死 | 司机已到达：{{order\_no}} | 邮件主题 | [notifications.ts:172](../../packages/domain/src/notifications.ts#L172) |
| `notifications.1d4af1bc` | 写死 | {{passenger\_name}}，您好：<br><br>司机已经到达上车点。<br><br>司机：{{driver\_name}}<br>电话：{{driver\_phone}}<br>车牌：{{vehicle\_plate}}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:172](../../packages/domain/src/notifications.ts#L172) |
| `notifications.12595293` | 写死 | {{passenger\_name}}，您好：<br><br>您的订单修改已生效，改动的内容：{{changed\_fields}}。<br><br>{TRIP}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:173](../../packages/domain/src/notifications.ts#L173) |
| `notifications.67a332bc` | 写死 | 订单已修改：{{order\_no}} | 邮件主题 | [notifications.ts:173](../../packages/domain/src/notifications.ts#L173)、188 行 |
| `notifications.9e496cb5` | 写死 | {{passenger\_name}}，您好：<br><br>很抱歉，您申请的修改（{{changed\_fields}}）{{change\_decline\_reason}}，订单仍按原来的预约执行；如果修改时补过差价，会原路退回。{{change\_decline\_advice}}<br><br>{TRIP}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:174](../../packages/domain/src/notifications.ts#L174) |
| `notifications.da14353c` | 写死 | 修改没有成功：{{order\_no}} | 邮件主题 | [notifications.ts:174](../../packages/domain/src/notifications.ts#L174) |
| `notifications.d2e3a034` | 写死 | {{passenger\_name}}，您好：<br><br>您的订单已取消。如有退款，会按取消政策原路退回，金额可在订单页查看。<br><br>{TRIP}{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:175](../../packages/domain/src/notifications.ts#L175) |
| `notifications.d3171e33` | 写死 | 订单已取消：{{order\_no}} | 邮件主题 | [notifications.ts:175](../../packages/domain/src/notifications.ts#L175)、190 行 |
| `notifications.8e377d03` | 写死 | {{passenger\_name}}，您好：<br><br>供应商提交了一项服务后费用。<br><br>项目：{{extra\_charge\_type}}<br>金额：{{extra\_charge\_amount}}<br><br>如有异议，请在 {{dispute\_until}}（东京时间）之前在订单页提出；没有异议的，到时会从您保存的支付方式中扣款。{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:176](../../packages/domain/src/notifications.ts#L176) |
| `notifications.e2a1d0a2` | 写死 | 服务后费用待确认：{{order\_no}} | 邮件主题 | [notifications.ts:176](../../packages/domain/src/notifications.ts#L176) |
| `notifications.2e3ab146` | 写死 | 您的订单链接：{{order\_no}} | 邮件主题 | [notifications.ts:181](../../packages/domain/src/notifications.ts#L181) |
| `notifications.a815f407` | 写死 | 您好：<br><br>这是您申请的 NOZOMI 用车订单链接（在官网「查订单」或联系客服时申请）。点下面的链接可以查看和管理订单 {{order\_no}}：<br><br>{{view\_url}}<br><br>这个链接只属于您的这张订单，请不要转发给别人。以前收到的链接仍然可以使用。<br><br>如果不是您本人申请的，可以忽略这封邮件：没有这个链接，别人看不到您的订单。<br><br>NOZOMI 用车 | 邮件正文 | [notifications.ts:182](../../packages/domain/src/notifications.ts#L182) |
| `notifications.58d15c50` | 写死 | {{passenger\_name}}，您好：<br><br>客服回复了您关于订单 {{order\_no}} 的问题，请到订单页查看。{GUEST\_FOOTER} | 邮件正文 | [notifications.ts:184](../../packages/domain/src/notifications.ts#L184) |
| `notifications.b6253be4` | 写死 | 您的工单有新回复：{{order\_no}} | 邮件主题 | [notifications.ts:184](../../packages/domain/src/notifications.ts#L184) |
| `notifications.28b6dd78` | 写死 | 你有一张新订单，请在派车截止时间前派好司机和车辆。<br><br>{TENANT\_TRIP}<br>派车截止：{{dispatch\_due\_at}}（东京时间）<br>{{charter\_price\_note}}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:186](../../packages/domain/src/notifications.ts#L186) |
| `notifications.fe99d677` | 写死 | 新订单：{{order\_no}} | 邮件主题 | [notifications.ts:186](../../packages/domain/src/notifications.ts#L186) |
| `notifications.6990c83d` | 写死 | 救援新订单：{{order\_no}} | 邮件主题 | [notifications.ts:187](../../packages/domain/src/notifications.ts#L187) |
| `notifications.d134c95a` | 写死 | 这张救援单已经转给你，请尽快派好司机和车辆。<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:187](../../packages/domain/src/notifications.ts#L187) |
| `notifications.03578f2d` | 写死 | 这张订单有修改，已经生效，改动的内容：{{changed\_fields}}。{{free\_wait\_change}}<br>{{driver\_notice}}<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:188](../../packages/domain/src/notifications.ts#L188) |
| `notifications.77b8681a` | 写死 | 客人申请修改订单（{{changed\_fields}}），确认前原预约仍然有效。<br>{{driver\_notice}}<br><br>请在 {{confirm\_due\_at}}（东京时间）之前到后台同意或拒绝；正在换司机或协调的，可以先标记「调整中」。超时没有结论的，修改不生效，客人可能免费取消。<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:189](../../packages/domain/src/notifications.ts#L189) |
| `notifications.ad578cf9` | 写死 | 修改待确认：{{order\_no}} | 邮件主题 | [notifications.ts:189](../../packages/domain/src/notifications.ts#L189) |
| `notifications.e93b5757` | 写死 | 这张订单已取消，不用再安排。<br>{{driver\_notice}}<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:190](../../packages/domain/src/notifications.ts#L190) |
| `notifications.18486171` | 写死 | 订单进入救援改派：{{order\_no}} | 邮件主题 | [notifications.ts:191](../../packages/domain/src/notifications.ts#L191) |
| `notifications.c1e0dedf` | 写死 | 这张订单已进入救援改派，平台在安排别的供应商，你不用再安排。<br>{{driver\_notice}}<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:191](../../packages/domain/src/notifications.ts#L191) |
| `notifications.120aaaca` | 写死 | 这张订单已过派车截止时间，还没有派司机和车辆，请马上处理。用车前 6 小时仍未派车会进入救援改派，并按规则扣违约金。<br><br>{TENANT\_TRIP}<br>派车截止：{{dispatch\_due\_at}}（东京时间）{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:192](../../packages/domain/src/notifications.ts#L192) |
| `notifications.d39bd00b` | 写死 | 超时未派车：{{order\_no}} | 邮件主题 | [notifications.ts:192](../../packages/domain/src/notifications.ts#L192) |
| `notifications.05ac7fe6` | 写死 | 司机还没有出发：{{order\_no}} | 邮件主题 | [notifications.ts:193](../../packages/domain/src/notifications.ts#L193) |
| `notifications.c610dff5` | 写死 | 离用车不到 1 小时，司机还没有点「已出发」，请马上确认。<br><br>{TENANT\_TRIP}{TENANT\_FOOTER} | 邮件正文 | [notifications.ts:193](../../packages/domain/src/notifications.ts#L193) |
| `notifications.87dfd631` | 写死 | 工单待回复：{{ticket\_no}} | 邮件主题 | [notifications.ts:194](../../packages/domain/src/notifications.ts#L194) |
| `notifications.bfe434ad` | 写死 | 平台在工单 {{ticket\_no}} 里征求你的意见，请在 24 小时内回复并上传证据。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:194](../../packages/domain/src/notifications.ts#L194) |
| `notifications.16c2477d` | 写死 | 你的「{{document\_type}}」将在 {{expires\_on}} 到期（还有 {{days\_left}} 天），请尽快上传新的证件。到期后供应商会被自动暂停。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:195](../../packages/domain/src/notifications.ts#L195) |
| `notifications.bce4cdb8` | 写死 | 资质快到期：{{document\_type}} | 邮件主题 | [notifications.ts:195](../../packages/domain/src/notifications.ts#L195) |
| `notifications.4ba1233b` | 写死 | 资质已到期：{{document\_type}} | 邮件主题 | [notifications.ts:196](../../packages/domain/src/notifications.ts#L196) |
| `notifications.eb08dd5c` | 写死 | 你的「{{document\_type}}」已在 {{expires\_on}} 到期，请尽快上传新的证件。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:196](../../packages/domain/src/notifications.ts#L196) |
| `notifications.2316960a` | 写死 | 进入观察期，请整改 | 邮件主题 | [notifications.ts:197](../../packages/domain/src/notifications.ts#L197) |
| `notifications.75fc4df9` | 写死 | 你的账号已进入观察期，原因：{{reasons}}。观察期内排序会受影响，请尽快整改。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:197](../../packages/domain/src/notifications.ts#L197) |
| `notifications.2d3b1b4a` | 写死 | 你的供应商状态已变为「{{tenant\_status}}」。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:198](../../packages/domain/src/notifications.ts#L198) |
| `notifications.9debd794` | 写死 | 供应商状态变化：{{tenant\_status}} | 邮件主题 | [notifications.ts:198](../../packages/domain/src/notifications.ts#L198) |
| `notifications.6f30d250` | 写死 | 你们申请修改的{{changed\_fields}}已通过平台审核，现在起按新的内容显示和使用。<br><br>如果不是你们提交的，请马上联系平台。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:200](../../packages/domain/src/notifications.ts#L200) |
| `notifications.c5070e0c` | 写死 | 资料修改没有通过 | 邮件主题 | [notifications.ts:201](../../packages/domain/src/notifications.ts#L201) |
| `notifications.f32452ce` | 写死 | 你们申请修改的{{changed\_fields}}没有通过平台审核，原因：{{reject\_reason}}。原来的内容照常使用；核对后可以重新提交。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:201](../../packages/domain/src/notifications.ts#L201) |
| `notifications.55ae45a9` | 写死 | 收款账户变更已提交：{{payout\_currency}} | 邮件主题 | [notifications.ts:204](../../packages/domain/src/notifications.ts#L204) |
| `notifications.b2eaea39` | 写死 | 你们提交了新的 {{payout\_currency}} 收款账户（账号 {{payout\_account}}），平台审核通过后生效，批准之前现在的账户继续有效。<br><br>如果不是你们提交的，请马上联系平台，并修改管理员密码。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:204](../../packages/domain/src/notifications.ts#L204) |
| `notifications.10dec67b` | 写死 | 你们的 {{payout\_currency}} 收款账户（账号 {{payout\_account}}）已通过审核，之后的转账付到这个账户。<br><br>如果不是你们提交的，请马上联系平台。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:205](../../packages/domain/src/notifications.ts#L205) |
| `notifications.bdfd2667` | 写死 | 收款账户已生效：{{payout\_currency}} | 邮件主题 | [notifications.ts:205](../../packages/domain/src/notifications.ts#L205) |
| `notifications.2bdfea49` | 写死 | 你们提交的 {{payout\_currency}} 收款账户（账号 {{payout\_account}}）没有通过审核，原因：{{reject\_reason}}。请核对后重新提交。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:206](../../packages/domain/src/notifications.ts#L206) |
| `notifications.6da220bd` | 写死 | 收款账户被驳回：{{payout\_currency}} | 邮件主题 | [notifications.ts:206](../../packages/domain/src/notifications.ts#L206) |
| `notifications.bd6e378d` | 写死 | 用车任务：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:212](../../packages/domain/src/notifications.ts#L212) |
| `notifications.5419184b` | 写死 | {{driver\_name}}，您好：<br><br>调度给您安排了一张用车任务，请打开下面的链接查看详情，并在行程中回传出发、到达、接到客人、完成。<br><br>{DRIVER\_TRIP}<br><br>打开任务：<br>{{driver\_link\_url}}<br><br>请不要转发这封邮件：这个链接能看到客人信息，只给您本人使用。<br>链接到 {{link\_expires\_at}}（当地时间）失效；改派或调度重新生成后也会失效，打不开时请联系调度。<br><br>NOZOMI 用车 | 邮件正文 | [notifications.ts:213](../../packages/domain/src/notifications.ts#L213) |
| `notifications.01b9265f` | 写死 | {{driver\_name}}，您好：<br><br>客人申请修改下面这张任务（{{changed\_fields}}），调度正在确认。确认之前请按原任务执行，有变化调度会再通知您。<br><br>{DRIVER\_TRIP}{DRIVER\_FOOTER} | 邮件正文 | [notifications.ts:217](../../packages/domain/src/notifications.ts#L217) |
| `notifications.1967cbeb` | 写死 | 客人申请修改任务：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:217](../../packages/domain/src/notifications.ts#L217) |
| `notifications.e42b15f2` | 写死 | {{driver\_name}}，您好：<br><br>这张任务有更新（{{changed\_fields}}），请打开下面的链接查看最新内容，以链接里的为准。<br><br>{DRIVER\_TRIP}<br><br>打开任务：<br>{{driver\_link\_url}}<br><br>请不要转发这封邮件：这个链接能看到客人信息，只给您本人使用。<br>链接到 {{link\_expires\_at}}（当地时间）失效；改派或调度重新生成后也会失效，打不开时请联系调度。{DRIVER\_FOOTER} | 邮件正文 | [notifications.ts:218](../../packages/domain/src/notifications.ts#L218) |
| `notifications.fa37fb77` | 写死 | 任务有更新：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:218](../../packages/domain/src/notifications.ts#L218) |
| `notifications.646528a1` | 写死 | 客人的修改没有通过：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:219](../../packages/domain/src/notifications.ts#L219) |
| `notifications.8df3136a` | 写死 | {{driver\_name}}，您好：<br><br>客人申请的修改（{{changed\_fields}}）没有通过，请继续按原任务执行。<br><br>{DRIVER\_TRIP}{DRIVER\_FOOTER} | 邮件正文 | [notifications.ts:219](../../packages/domain/src/notifications.ts#L219) |
| `notifications.002afb71` | 写死 | 任务已取消：{{service\_time}}（{{order\_no}}） | 邮件主题 | [notifications.ts:220](../../packages/domain/src/notifications.ts#L220) |
| `notifications.9c4f744e` | 写死 | {{driver\_name}}，您好：<br><br>这张任务已取消或已转给别的供应商，您不用再去了。如已在路上，请联系调度。<br><br>{DRIVER\_TRIP}{DRIVER\_FOOTER} | 邮件正文 | [notifications.ts:220](../../packages/domain/src/notifications.ts#L220) |
| `notifications.3e3cc11b` | 写死 | 异常队列新增一条，请处理。<br><br>类型：{{exception\_type}}<br>订单号：{{order\_no}}{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:222](../../packages/domain/src/notifications.ts#L222) |
| `notifications.f8fcb207` | 写死 | 新的异常：{{exception\_type}}（{{order\_no}}） | 邮件主题 | [notifications.ts:222](../../packages/domain/src/notifications.ts#L222) |
| `notifications.a63ddf2a` | 写死 | 汇率告警：{{alert\_kind}} | 邮件主题 | [notifications.ts:223](../../packages/domain/src/notifications.ts#L223) |
| `notifications.4cdcdca4` | 写死 | 供应商改了企业信息：{{tenant\_name}} | 邮件主题 | [notifications.ts:225](../../packages/domain/src/notifications.ts#L225) |
| `notifications.d3e20d9b` | 写死 | 供应商「{{tenant\_name}}」在供应商后台直接改了：{{changed\_fields}}。改动已经生效，改之前和改之后的内容见审计日志。如果对方没有事先打过招呼，请和供应商确认。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:225](../../packages/domain/src/notifications.ts#L225) |
| `notifications.226c649e` | 写死 | 供应商「{{tenant\_name}}」申请修改：{{changed\_fields}}。请按营业执照、登记簿核对后，在供应商详情里发起复核（另一位同事批准后生效）或驳回。审核期间原来的内容照常使用。{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:226](../../packages/domain/src/notifications.ts#L226) |
| `notifications.ef39d644` | 写死 | 供应商申请修改资料：{{tenant\_name}} | 邮件主题 | [notifications.ts:226](../../packages/domain/src/notifications.ts#L226) |
| `notifications.3eabd9be` | 写死 | 官网找回订单告警 | 邮件主题 | [notifications.ts:227](../../packages/domain/src/notifications.ts#L227) |
| `notifications.db47d8ee` | 写死 | 官网找回订单：同一个订单号 24 小时内失败满 100 次，接下来连对上的联系方式也会被挡，请留意是否有人在猜。<br><br>{{detail}}{COMPANY\_FOOTER} | 邮件正文 | [notifications.ts:227](../../packages/domain/src/notifications.ts#L227) |
| `notifications.b9b40456` | 写死 | 乘客信息 | 文字 | [notifications.ts:422](../../packages/domain/src/notifications.ts#L422) |
| `notifications.d18d668f` | 写死 | 航班号 | 文字 | [notifications.ts:423](../../packages/domain/src/notifications.ts#L423) |
| `notifications.9d7254a1` | 写死 | 航班类型 | 文字 | [notifications.ts:424](../../packages/domain/src/notifications.ts#L424) |
| `notifications.a31f4618` | 写死 | 即时通讯 | 文字 | [notifications.ts:425](../../packages/domain/src/notifications.ts#L425) |
| `notifications.1eaf0c28` | 写死 | 备注 | 说明 | [notifications.ts:426](../../packages/domain/src/notifications.ts#L426) |
| `notifications.c002c248` | 写死 | 上车地址 | 文字 | [notifications.ts:427](../../packages/domain/src/notifications.ts#L427) |
| `notifications.e8d36bf2` | 写死 | 下车地址 | 文字 | [notifications.ts:428](../../packages/domain/src/notifications.ts#L428) |
| `notifications.db2f4af6` | 写死 | 用车时间 | 文字 | [notifications.ts:429](../../packages/domain/src/notifications.ts#L429) |
| `notifications.f1e13776` | 写死 | 人数 | 文字 | [notifications.ts:430](../../packages/domain/src/notifications.ts#L430) |
| `notifications.a869a677` | 写死 | 行李数 | 文字 | [notifications.ts:431](../../packages/domain/src/notifications.ts#L431) |
| `notifications.1e5365fd` | 写死 | 您也可以在订单页免费取消后重新下单。 | 按钮 | [notifications.ts:436](../../packages/domain/src/notifications.ts#L436) |
| `notifications.4df83649` | 写死 | 如不再需要用车，可以按取消政策在订单页取消。 | 文字 | [notifications.ts:437](../../packages/domain/src/notifications.ts#L437)、440 行 |
| `notifications.de6a5a65` | 写死 | 我们正在为您安排新的服务方，订单继续有效。 | 文字 | [notifications.ts:438](../../packages/domain/src/notifications.ts#L438) |
| `notifications.254a80f0` | 写死 | 服务已经开始，如有问题请联系客服。 | 文字 | [notifications.ts:439](../../packages/domain/src/notifications.ts#L439) |
| `notifications.dd119d2e` | 写死 | 因为用保存的支付方式补差价没有成功，没有生效 | 提示 | [notifications.ts:445](../../packages/domain/src/notifications.ts#L445) |
| `notifications.e673c36d` | 写死 | 没有得到确认 | 提示 | [notifications.ts:445](../../packages/domain/src/notifications.ts#L445) |
| `notifications.f9dcd583` | 写死 | 这张单还没有派司机。 | 文字 | [notifications.ts:456](../../packages/domain/src/notifications.ts#L456) |
| `notifications.2f66d2ed` | 写死 | 你们设置了手动发送 | 提示 | [notifications.ts:457](../../packages/domain/src/notifications.ts#L457) |
| `notifications.a654e760` | 写死 | 这位司机没有邮箱 | 提示 | [notifications.ts:457](../../packages/domain/src/notifications.ts#L457) |
| `notifications.ca06fba1` | 写死 | 系统没有给司机发邮件（{reason}），请马上联系司机。 | 文字 | [notifications.ts:458](../../packages/domain/src/notifications.ts#L458) |
| `notifications.e1a04063` | 写死 | 已派司机 {driverName}，需调整司机：确认前司机按原任务执行。{…} | 文字 | [notifications.ts:459](../../packages/domain/src/notifications.ts#L459) |
| `notifications.fc493de9` | 写死 | 系统已发邮件告诉司机。 | 文字 | [notifications.ts:459](../../packages/domain/src/notifications.ts#L459) |
| `notifications.240c7526` | 写死 | 已派司机 {driverName}。{…} | 文字 | [notifications.ts:460](../../packages/domain/src/notifications.ts#L460) |
| `notifications.3343a43c` | 写死 | 系统已把最新信息发给司机。 | 文字 | [notifications.ts:460](../../packages/domain/src/notifications.ts#L460) |
| `notifications.94a1f051` | 写死 | 已派司机 {driverName}，需调整司机：请确认司机和车辆还合适。{…} | 文字 | [notifications.ts:460](../../packages/domain/src/notifications.ts#L460) |
| `notifications.b455a34c` | 写死 | 系统已把最新任务发给司机。 | 文字 | [notifications.ts:460](../../packages/domain/src/notifications.ts#L460) |
| `notifications.91d35455` | 写死 | 已派司机 {driverName}，需调整司机：司机不用再去了。{…} | 文字 | [notifications.ts:461](../../packages/domain/src/notifications.ts#L461) |
| `notifications.bda4f761` | 写死 | 系统已发邮件告诉司机，请确认他已经知道。 | 文字 | [notifications.ts:461](../../packages/domain/src/notifications.ts#L461) |
| `notifications.49286a26` | 写死 | 评分低于观察线 | 文字 | [notifications.ts:464](../../packages/domain/src/notifications.ts#L464) |
| `notifications.78d1e4ba` | 写死 | 司机未到 | 文字 | [notifications.ts:464](../../packages/domain/src/notifications.ts#L464) |
| `notifications.f0dcec13` | 写死 | 邮件发送还没有配置，配好后自动发送 | 文字 | [notifications.ts:511](../../packages/domain/src/notifications.ts#L511) |
| `notifications.4d843896` | 写死 | 在免打扰时段里，时段结束后发送 | 文字 | [notifications.ts:512](../../packages/domain/src/notifications.ts#L512) |
| `notifications.97c2b05e` | 写死 | 过了有效期，不再发送 | 文字 | [notifications.ts:513](../../packages/domain/src/notifications.ts#L513) |
| `notifications.2ded2576` | 写死 | 订单情况变了，再发只会误导，不再发送 | 文字 | [notifications.ts:514](../../packages/domain/src/notifications.ts#L514) |
| `notifications.e66567b1` | 写死 | 发送途中服务中断，不知道发出去了没有；可能已发出，重试前请先确认 | 文字 | [notifications.ts:515](../../packages/domain/src/notifications.ts#L515) |
| `notifications.0e5eaa52` | 写死 | 邮件内容生成失败（程序问题） | 提示 | [notifications.ts:516](../../packages/domain/src/notifications.ts#L516) |
| `notifications.2b53e409` | 写死 | 乘客信息解不开，没有发送；不会自动重试，请联系技术 | 提示 | [notifications.ts:517](../../packages/domain/src/notifications.ts#L517) |
| `notifications.7b5c40e5` | 写死 | 收件人地址或邮件内容不合格 | 提示 | [notifications.ts:518](../../packages/domain/src/notifications.ts#L518) |
| `notifications.a0165115` | 写死 | 准备或发送邮件时出错，系统会自动重试；一直不好请联系技术 | 文字 | [notifications.ts:519](../../packages/domain/src/notifications.ts#L519) |
| `notifications.850d8d23` | 写死 | 这封信排队期间链接已被作废（改派、吊销或重新生成），不再发送 | 文字 | [notifications.ts:520](../../packages/domain/src/notifications.ts#L520) |
| `notifications.888da01e` | 写死 | 这张单后来又发起了一次发送，只发最新的 | 文字 | [notifications.ts:521](../../packages/domain/src/notifications.ts#L521) |
| `notifications.f11238b6` | 写死 | 供应商已改成手动发送，不再发送 | 文字 | [notifications.ts:522](../../packages/domain/src/notifications.ts#L522) |
| `notifications.f7c5221e` | 写死 | 司机已经没有邮箱，不再发送 | 文字 | [notifications.ts:523](../../packages/domain/src/notifications.ts#L523) |
| `notifications.887a1eb2` | 写死 | 司机已停用，不再发送 | 文字 | [notifications.ts:524](../../packages/domain/src/notifications.ts#L524) |
| `notifications.aea4bc7a` | 写死 | 这次修改已经有结论，不再发送 | 文字 | [notifications.ts:525](../../packages/domain/src/notifications.ts#L525) |
