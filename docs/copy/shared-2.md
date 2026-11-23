# 前端公共组件和共用文案（第 2 / 2 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 1817 条：写死 1635 条，已走 key 182 条。列的意思见 [README](README.md)。

本区域分 2 份：[第 1 份](shared.md) · 第 2 份

## 页面

- [「价格规则」页签的表格模型（price-form.ts）](#价格规则页签的表格模型price-formts)（69 条）
- [后台（pricing-basis-display.ts）](#后台pricing-basis-displayts)（9 条）
- [商品在界面上怎么写（product-display.ts）](#商品在界面上怎么写product-displayts)（68 条）
- [商品各页面共用的出错文字（product-failure.ts）](#商品各页面共用的出错文字product-failurets)（5 条）
- [企业信息和资料修改申请（profile-display.ts）](#企业信息和资料修改申请profile-displayts)（17 条）
- [救援改派与违约金在页面上的说法（rescue-display.ts）](#救援改派与违约金在页面上的说法rescue-displayts)（32 条）
- [点对点「线路价」（route-prices.ts）](#点对点线路价route-pricests)（29 条）
- [② 服务规则的表单模型（service-rules-form.ts）](#②-服务规则的表单模型service-rules-formts)（48 条）
- [官网（site-display.ts）](#官网site-displayts)（108 条）
- [Stripe.js 的加载和本站用到的那一小部分类型（stripe-js.ts）](#stripejs-的加载和本站用到的那一小部分类型stripe-jsts)（1 条）
- [时刻、日期的输入整理和「读回来的话」（time-input.ts）](#时刻日期的输入整理和读回来的话time-inputts)（12 条）
- [「未覆盖需求」（uncovered-demand-display.ts）](#未覆盖需求uncovered-demand-displayts)（35 条）
- [把一段文字写进剪贴板（use-copy-text.tsx）](#把一段文字写进剪贴板use-copy-texttsx)（5 条）
- [主题切换（ThemeSwitcher.tsx）](#主题切换themeswitchertsx)（1 条）
- [主题（theme.ts）](#主题themets)（3 条）

## 「价格规则」页签的表格模型（price-form.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）；运营后台 · 报价试算

文件：`apps/web/src/lib/price-form.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `price-form.1c843ff0` | 写死 | 起步里程 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.1c8d737d` | 写死 | 最低消费 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.1d4bf233` | 写死 | 套餐公里 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.3e5bcc4b` | 写死 | 套餐价 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.3fdef88b` | 写死 | 超公里每公里 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.48109a89` | 写死 | 含公里数 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.525a2a08` | 写死 | 超时每小时 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.546e28f0` | 写死 | 超出每分钟 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.7fe663b1` | 写死 | 起步时长 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.a1e19e23` | 写死 | 超出每公里 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.fe37eefa` | 写死 | 基础价 | 文字 | [price-form.ts:75](../../apps/web/src/lib/price-form.ts#L75) |
| `price-form.73f00075` | 写死 | 含公里数和超出每公里要一起填，或者都不填 | 文字 | [price-form.ts:84](../../apps/web/src/lib/price-form.ts#L84) |
| `price-form.68c96492` | 写死 | 含公里数请填 1 到 {…} 之间的整数 | 文字 | [price-form.ts:85](../../apps/web/src/lib/price-form.ts#L85) |
| `price-form.b3fb99d9` | 写死 | 起步价 | 名称 | [price-form.ts:96](../../apps/web/src/lib/price-form.ts#L96) |
| `price-form.5ac71c53` | 写死 | {…}金额不能有小数 | 文字 | [price-form.ts:190](../../apps/web/src/lib/price-form.ts#L190) |
| `price-form.af01883e` | 写死 | {currency} 最多 {digits} 位小数 | 文字 | [price-form.ts:190](../../apps/web/src/lib/price-form.ts#L190) |
| `price-form.64fdb5ae` | 写死 | 请填数字 | 文字 | [price-form.ts:205](../../apps/web/src/lib/price-form.ts#L205)、235、244、248 行 |
| `price-form.ca1ac7de` | 写死 | 超出每公里不能是负数 | 文字 | [price-form.ts:205](../../apps/web/src/lib/price-form.ts#L205) |
| `price-form.d226badf` | 写死 | 超出每公里最多 {…} | 文字 | [price-form.ts:208](../../apps/web/src/lib/price-form.ts#L208) |
| `price-form.168fc2f3` | 写死 | 请填{name}{…} | 文字 | [price-form.ts:227](../../apps/web/src/lib/price-form.ts#L227) |
| `price-form.310082b2` | 写死 | ，不另收请填 0 | 文字 | [price-form.ts:227](../../apps/web/src/lib/price-form.ts#L227) |
| `price-form.373e81b9` | 写死 | {name}不能是负数 | 文字 | [price-form.ts:231](../../apps/web/src/lib/price-form.ts#L231) |
| `price-form.19f749c6` | 写死 | {name}最多 {…} | 文字 | [price-form.ts:238](../../apps/web/src/lib/price-form.ts#L238) |
| `price-form.dfbee73d` | 写死 | {name}要大于 0 | 文字 | [price-form.ts:239](../../apps/web/src/lib/price-form.ts#L239) |
| `price-form.e042e248` | 写死 | 请填 0 到 {…} 之间的数，最多 1 位小数 | 文字 | [price-form.ts:244](../../apps/web/src/lib/price-form.ts#L244) |
| `price-form.fe346593` | 写死 | 请填 {min} 到 {max} 之间的整数 | 文字 | [price-form.ts:248](../../apps/web/src/lib/price-form.ts#L248) |
| `price-form.7e13d9b8` | 写死 | 请填开始日期 | 文字 | [price-form.ts:254](../../apps/web/src/lib/price-form.ts#L254) |
| `price-form.9a67d878` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [price-form.ts:255](../../apps/web/src/lib/price-form.ts#L255)、256 行 |
| `price-form.ee9487c0` | 写死 | 结束日期不能早于开始日期 | 文字 | [price-form.ts:257](../../apps/web/src/lib/price-form.ts#L257) |
| `price-form.c8bf57b3` | 写死 | 起步价是 0 时，请填最低消费 | 文字 | [price-form.ts:259](../../apps/web/src/lib/price-form.ts#L259) |
| `price-form.3cd44cda` | 写死 | 这一行不符合要求（{…}） | 文字 | [price-form.ts:272](../../apps/web/src/lib/price-form.ts#L272) |
| `price-form.3ea88e5e` | 写死 | 最低消费比起步价低，不会起作用。 | 说明 | [price-form.ts:297](../../apps/web/src/lib/price-form.ts#L297) |
| `price-form.0c5a39d3` | 写死 | 将删除 | 文字 | [price-form.ts:430](../../apps/web/src/lib/price-form.ts#L430) |
| `price-form.dbc86be3` | 写死 | 和别的价格日期重叠 | 文字 | [price-form.ts:432](../../apps/web/src/lib/price-form.ts#L432) |
| `price-form.bca47704` | 写死 | 新的，未保存 | 文字 | [price-form.ts:433](../../apps/web/src/lib/price-form.ts#L433) |
| `price-form.9c065ccc` | 写死 | 改过，未保存 | 文字 | [price-form.ts:434](../../apps/web/src/lib/price-form.ts#L434) |
| `price-form.eb143a64` | 写死 | 没有价格 | 文字 | [price-form.ts:435](../../apps/web/src/lib/price-form.ts#L435)、437 行 |
| `price-form.a1118793` | 写死 | 已停用 | 文字 | [price-form.ts:438](../../apps/web/src/lib/price-form.ts#L438) |
| `price-form.5bdeac6f` | 写死 | 已过期 | 文字 | [price-form.ts:439](../../apps/web/src/lib/price-form.ts#L439) |
| `price-form.7c7d646f` | 写死 | {validFrom} 起生效 | 文字 | [price-form.ts:440](../../apps/web/src/lib/price-form.ts#L440) |
| `price-form.f73db8c0` | 写死 | {validTo} 到期，之后没有价格 | 文字 | [price-form.ts:444](../../apps/web/src/lib/price-form.ts#L444) |
| `price-form.78fe2909` | 写死 | 生效中 | 文字 | [price-form.ts:446](../../apps/web/src/lib/price-form.ts#L446) |
| `price-form.ae7c6284` | 写死 | 每单 {…}，不看里程和时长。 | 文字 | [price-form.ts:496](../../apps/web/src/lib/price-form.ts#L496) |
| `price-form.3b6b6f09` | 写死 | {…} 公里 | 文字 | [price-form.ts:498](../../apps/web/src/lib/price-form.ts#L498) |
| `price-form.67d04291` | 写死 | 起步价里不含里程 | 文字 | [price-form.ts:498](../../apps/web/src/lib/price-form.ts#L498) |
| `price-form.9745f356` | 写死 | 起步价里不含时长 | 文字 | [price-form.ts:498](../../apps/web/src/lib/price-form.ts#L498) |
| `price-form.d295942f` | 写死 | {startMinutes} 分钟 | 文字 | [price-form.ts:498](../../apps/web/src/lib/price-form.ts#L498) |
| `price-form.47bf86c2` | 写死 | 起步价 {…}（不含里程和时长） | 文字 | [price-form.ts:499](../../apps/web/src/lib/price-form.ts#L499) |
| `price-form.99866cbb` | 写死 | 以内 | 文字 | [price-form.ts:499](../../apps/web/src/lib/price-form.ts#L499) |
| `price-form.34aa840b` | 写死 | 每公里 {…}（不足 1 公里按比例） | 文字 | [price-form.ts:500](../../apps/web/src/lib/price-form.ts#L500) |
| `price-form.389c7c63` | 写死 | 每分钟 {…} | 文字 | [price-form.ts:500](../../apps/web/src/lib/price-form.ts#L500) |
| `price-form.7a3b5a9b` | 写死 | 超出里程不另收 | 文字 | [price-form.ts:500](../../apps/web/src/lib/price-form.ts#L500) |
| `price-form.e2e7a4d8` | 写死 | 超出时长不另收 | 文字 | [price-form.ts:500](../../apps/web/src/lib/price-form.ts#L500) |
| `price-form.2972af97` | 写死 | ；最少收 {…} | 文字 | [price-form.ts:502](../../apps/web/src/lib/price-form.ts#L502) |
| `price-form.544a45f2` | 写死 | {within}；超出的部分{…}{…}。按预估的里程和时长报价，不按实际跑的结算。例：预估 {…} 公里、{…} 分钟 = {…}。 | 文字 | [price-form.ts:502](../../apps/web/src/lib/price-form.ts#L502) |
| `price-form.1874272f` | 写死 | 经停点在这个区域加 {…}，同一区域一单只加一次（报价时加进一口价）。 | 文字 | [price-form.ts:504](../../apps/web/src/lib/price-form.ts#L504) |
| `price-form.e557024d` | 写死 | {…} 小时机场套餐 {…}（已含这一端的机场加价；含公里、超时、超公里没填的同普通套餐）。 | 文字 | [price-form.ts:506](../../apps/web/src/lib/price-form.ts#L506) |
| `price-form.d8bc74fd` | 写死 | 上车点在这个区域加 {…}，下车点在这个区域加 {…}（报价时加进一口价）。 | 文字 | [price-form.ts:507](../../apps/web/src/lib/price-form.ts#L507) |
| `price-form.5d630933` | 写死 | 超公里每公里 {…} | 文字 | [price-form.ts:508](../../apps/web/src/lib/price-form.ts#L508) |
| `price-form.959dab98` | 写死 | 超时不另收 | 文字 | [price-form.ts:508](../../apps/web/src/lib/price-form.ts#L508) |
| `price-form.bd7036cc` | 写死 | 超时每小时 {…} | 文字 | [price-form.ts:508](../../apps/web/src/lib/price-form.ts#L508) |
| `price-form.d71b3d0d` | 写死 | 超公里不另收 | 文字 | [price-form.ts:508](../../apps/web/src/lib/price-form.ts#L508) |
| `price-form.23754d19` | 写死 | {…} 小时、{packageKm} 公里以内 {…}；{…}（超出的部分服务结束后按实际结算，不足 1 小时、1 公里的按比例算）。 | 文字 | [price-form.ts:509](../../apps/web/src/lib/price-form.ts#L509) |
| `price-form.0f63807b` | 写死 | 现在是停用的，不会用来报价。 | 文字 | [price-form.ts:513](../../apps/web/src/lib/price-form.ts#L513) |
| `price-form.acf757e4` | 写死 | {validFrom} 至 {validTo} 有效。 | 文字 | [price-form.ts:513](../../apps/web/src/lib/price-form.ts#L513) |
| `price-form.d587922a` | 写死 | {validFrom} 起一直有效。 | 文字 | [price-form.ts:513](../../apps/web/src/lib/price-form.ts#L513) |
| `price-form.04152fc4` | 写死 | 每单 {…}，含 {includedKm} 公里，超出不另收。 | 文字 | [price-form.ts:522](../../apps/web/src/lib/price-form.ts#L522) |
| `price-form.69fb2f08` | 写死 | 每单 {…}，含 {includedKm} 公里，超出每公里 {…}（不足 1 公里按 1 公里）。按报价时的路线距离算进一口价，客人付的就是这一个价，车开绕路不另收。例：路线 {…} 公里 = {…} + {over} 公里 × {…} = {…}。 | 文字 | [price-form.ts:526](../../apps/web/src/lib/price-form.ts#L526) |
| `price-form.41f939ca` | 写死 | {text} 起 | 文字 | [price-form.ts:533](../../apps/web/src/lib/price-form.ts#L533) |

## 后台（pricing-basis-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/pricing-basis-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `pricing-basis-display.2356e355` | 写死 | 一口价 | 文字 | [pricing-basis-display.ts:13](../../apps/web/src/lib/pricing-basis-display.ts#L13) |
| `pricing-basis-display.6605850b` | 写死 | 一口价 + 区域外里程费 | 文字 | [pricing-basis-display.ts:14](../../apps/web/src/lib/pricing-basis-display.ts#L14) |
| `pricing-basis-display.d40d8589` | 写死 | 计程价（起步价 + 每公里） | 文字 | [pricing-basis-display.ts:15](../../apps/web/src/lib/pricing-basis-display.ts#L15) |
| `pricing-basis-display.b49f4ea2` | 写死 | 路线约 {…} 公里（报价时） | 文字 | [pricing-basis-display.ts:33](../../apps/web/src/lib/pricing-basis-display.ts#L33) |
| `pricing-basis-display.5c46f1b5` | 写死 | 区域外 {km} 公里 × {per\_km} = {fee}（已含在基础价里） | 文字 | [pricing-basis-display.ts:35](../../apps/web/src/lib/pricing-basis-display.ts#L35) |
| `pricing-basis-display.17aa4936` | 写死 | ，扣掉一口价含的 {included\_km} 公里 | 文字 | [pricing-basis-display.ts:36](../../apps/web/src/lib/pricing-basis-display.ts#L36) |
| `pricing-basis-display.f382ada0` | 写死 | {route}{…}；不足 1 公里按 1 公里 | 文字 | [pricing-basis-display.ts:36](../../apps/web/src/lib/pricing-basis-display.ts#L36) |
| `pricing-basis-display.097f7e69` | 写死 | 起步价 {start\_price} + {km} 公里 × {per\_km} = {fee}（已含在基础价里） | 文字 | [pricing-basis-display.ts:38](../../apps/web/src/lib/pricing-basis-display.ts#L38) |
| `pricing-basis-display.ba95043f` | 写死 | {route}；不足 1 公里按 1 公里 | 文字 | [pricing-basis-display.ts:39](../../apps/web/src/lib/pricing-basis-display.ts#L39) |

## 商品在界面上怎么写（product-display.ts）

用在：供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/product-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `product-display.5d953017` | 写死 | 未命名的{…}商品 | 文字 | [product-display.ts:25](../../apps/web/src/lib/product-display.ts#L25) |
| `product-display.64072e32` | 写死 | 港元 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.80691f68` | 写死 | 人民币 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.a089e7fb` | 写死 | 日元 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.a3208885` | 写死 | 新加坡元 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.e6d6d344` | 写死 | 新台币 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.e96cd5dc` | 写死 | 美元 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.efd5fee2` | 写死 | 韩元 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.f9488bb2` | 写死 | 泰铢 | 文字 | [product-display.ts:28](../../apps/web/src/lib/product-display.ts#L28) |
| `product-display.cc80f529` | 写死 | 中文 | 文字 | [product-display.ts:31](../../apps/web/src/lib/product-display.ts#L31) |
| `product-display.146494cf` | 写死 | {passengers} 人 {luggage} 件 | 文字 | [product-display.ts:48](../../apps/web/src/lib/product-display.ts#L48) |
| `product-display.0e11520a` | 写死 | 请填金额，只能是数字，不能是负数 | 提示 | [product-display.ts:87](../../apps/web/src/lib/product-display.ts#L87) |
| `product-display.0a4f2588` | 写死 | {currency} 最多 {digits} 位小数 | 提示 | [product-display.ts:93](../../apps/web/src/lib/product-display.ts#L93) |
| `product-display.1c6929d9` | 写死 | {…}没有小数，请填整数 | 提示 | [product-display.ts:93](../../apps/web/src/lib/product-display.ts#L93) |
| `product-display.aee81116` | 写死 | 这种币种 | 提示 | [product-display.ts:93](../../apps/web/src/lib/product-display.ts#L93) |
| `product-display.83a37f86` | 写死 | 金额太大了，请检查是不是多打了几个零 | 提示 | [product-display.ts:94](../../apps/web/src/lib/product-display.ts#L94) |
| `product-display.aa26a9a0` | 写死 | 其他检查 | 名称 | [product-display.ts:103](../../apps/web/src/lib/product-display.ts#L103) |
| `product-display.bb5c8816` | 写死 | 供应商需要的话把它画进基础价、行程加价或上下车加价区域 | 文字 | [product-display.ts:149](../../apps/web/src/lib/product-display.ts#L149) |
| `product-display.f7c96864` | 写死 | 供应商的管理员可以在供应商后台重新启用 | 文字 | [product-display.ts:150](../../apps/web/src/lib/product-display.ts#L150) |
| `product-display.03ab7ae9` | 写死 | 需要平台在主数据里处理 | 文字 | [product-display.ts:151](../../apps/web/src/lib/product-display.ts#L151) |
| `product-display.90c48f5c` | 写死 | 需要平台在主数据里处理，或由供应商在它现在的城市新建一个商品 | 文字 | [product-display.ts:152](../../apps/web/src/lib/product-display.ts#L152) |
| `product-display.ca78ed5b` | 写死 | 需要的话到区域页面把它画进基础价、行程加价或上下车加价区域 | 说明 | [product-display.ts:160](../../apps/web/src/lib/product-display.ts#L160) |
| `product-display.abf4f618` | 写死 | 接站指引 | 文字 | [product-display.ts:170](../../apps/web/src/lib/product-display.ts#L170) |
| `product-display.f084ec31` | 写死 | 接机指引 | 文字 | [product-display.ts:170](../../apps/web/src/lib/product-display.ts#L170) |
| `product-display.c619c76d` | 写死 | 子品牌「{brandName}」已停用 | 文字 | [product-display.ts:182](../../apps/web/src/lib/product-display.ts#L182) |
| `product-display.dfb77e09` | 写死 | 请联系你们的管理员 | 文字 | [product-display.ts:182](../../apps/web/src/lib/product-display.ts#L182) |
| `product-display.1cd12486` | 写死 | 请联系平台运营 | 文字 | [product-display.ts:183](../../apps/web/src/lib/product-display.ts#L183)、184、185 行 |
| `product-display.9486b2c0` | 写死 | 城市「{cityName}」已被平台停用 | 文字 | [product-display.ts:183](../../apps/web/src/lib/product-display.ts#L183) |
| `product-display.a52cfc7c` | 写死 | 这个商品没有接送点 | 文字 | [product-display.ts:184](../../apps/web/src/lib/product-display.ts#L184) |
| `product-display.4e2b2287` | 写死 | 接送点「{…}」已被平台停用 | 文字 | [product-display.ts:185](../../apps/web/src/lib/product-display.ts#L185) |
| `product-display.2500ce7a` | 写死 | 请联系平台运营，或在它现在的城市新建一个商品 | 文字 | [product-display.ts:187](../../apps/web/src/lib/product-display.ts#L187) |
| `product-display.cce0e1ad` | 写死 | 接送点「{…}」已被平台改到了别的城市，不在「{cityName}」了 | 文字 | [product-display.ts:187](../../apps/web/src/lib/product-display.ts#L187) |
| `product-display.7197c537` | 写死 | 还没有选服务区域 | 文字 | [product-display.ts:188](../../apps/web/src/lib/product-display.ts#L188) |
| `product-display.0194aae4` | 写死 | 选的服务区域里有 {disabled} 个已停用，请重新启用或移除 | 文字 | [product-display.ts:190](../../apps/web/src/lib/product-display.ts#L190) |
| `product-display.57cecc5e` | 写死 | 选的服务区域里有 {…} 个的业务类型不再适用于{category}，请移除 | 文字 | [product-display.ts:191](../../apps/web/src/lib/product-display.ts#L191) |
| `product-display.cf1cc4b1` | 写死 | 还没有选车型组 | 文字 | [product-display.ts:192](../../apps/web/src/lib/product-display.ts#L192) |
| `product-display.8823ccd0` | 写死 | 选的车型组里有 {…} 个已被平台停用，请移除 | 文字 | [product-display.ts:193](../../apps/web/src/lib/product-display.ts#L193) |
| `product-display.3d439485` | 写死 | 有 {…} 个车型组选的「人数 / 行李数」平台已经取消，请重新选择 | 文字 | [product-display.ts:194](../../apps/web/src/lib/product-display.ts#L194) |
| `product-display.c194a2ac` | 写死 | 还没有填调度人 | 文字 | [product-display.ts:195](../../apps/web/src/lib/product-display.ts#L195) |
| `product-display.02cb3c77` | 写死 | 还没有填服务时间 | 文字 | [product-display.ts:197](../../apps/web/src/lib/product-display.ts#L197) |
| `product-display.78ebdb20` | 写死 | 还没有填提前预订时长 | 文字 | [product-display.ts:198](../../apps/web/src/lib/product-display.ts#L198) |
| `product-display.13c90eef` | 写死 | 加急预订：还没有填加急阶梯 | 文字 | [product-display.ts:199](../../apps/web/src/lib/product-display.ts#L199) |
| `product-display.0e15cf05` | 写死 | 夜间加价：时段、计费方式、金额还没有填齐 | 文字 | [product-display.ts:200](../../apps/web/src/lib/product-display.ts#L200) |
| `product-display.6aef50b4` | 写死 | 还没有保存过免费等待（打开服务规则，确认后保存即可） | 文字 | [product-display.ts:201](../../apps/web/src/lib/product-display.ts#L201) |
| `product-display.d01d140c` | 写死 | 勾选的附加服务里有 {…} 项平台已停用或不再适用，请取消勾选 | 文字 | [product-display.ts:202](../../apps/web/src/lib/product-display.ts#L202) |
| `product-display.63ea7949` | 写死 | 免费等待比平台规定的最少时间短（平台调整过标准），请改长 | 文字 | [product-display.ts:203](../../apps/web/src/lib/product-display.ts#L203) |
| `product-display.b8babf02` | 写死 | 还没有填标题（至少一种语言） | 文字 | [product-display.ts:205](../../apps/web/src/lib/product-display.ts#L205) |
| `product-display.cecfef24` | 写死 | {…}还没有填{guide} | 文字 | [product-display.ts:207](../../apps/web/src/lib/product-display.ts#L207) |
| `product-display.caa66304` | 写死 | 还没有设价格（至少要有 1 条启用、没过期的价格） | 文字 | [product-display.ts:210](../../apps/web/src/lib/product-display.ts#L210) |
| `product-display.3c9c95d1` | 写死 | 现有的价格都是给已经不在这个商品里的区域或车型组设的。请给现在选着的区域和车型组设价格 | 文字 | [product-display.ts:211](../../apps/web/src/lib/product-display.ts#L211) |
| `product-display.09eb7230` | 写死 | 价格都停用了，至少要启用 1 条 | 文字 | [product-display.ts:212](../../apps/web/src/lib/product-display.ts#L212) |
| `product-display.ae138201` | 写死 | 价格都过期了，请把生效日期延长，或加一段新的 | 文字 | [product-display.ts:213](../../apps/web/src/lib/product-display.ts#L213) |
| `product-display.054a6c30` | 写死 | 调价规则「{name}」会把价格调到不大于 0，这些价格报不出来 | 文字 | [product-display.ts:222](../../apps/web/src/lib/product-display.ts#L222) |
| `product-display.e5cb4da6` | 写死 | 有 {unnamed} 条调价规则会把价格调到不大于 0，这些价格报不出来 | 文字 | [product-display.ts:225](../../apps/web/src/lib/product-display.ts#L225) |
| `product-display.55b13861` | 写死 | 几条调价规则 | 文字 | [product-display.ts:233](../../apps/web/src/lib/product-display.ts#L233) |
| `product-display.24827e6f` | 写死 | （最早是 {…}{…}{…}） | 文字 | [product-display.ts:234](../../apps/web/src/lib/product-display.ts#L234) |
| `product-display.26717e81` | 写死 | ，今后一年里有 {…} 天 | 文字 | [product-display.ts:234](../../apps/web/src/lib/product-display.ts#L234) |
| `product-display.9f1f811c` | 写死 | 有 {…} 条价格 | 文字 | [product-display.ts:235](../../apps/web/src/lib/product-display.ts#L235) |
| `product-display.da8110aa` | 写死 | 有的价格 | 文字 | [product-display.ts:235](../../apps/web/src/lib/product-display.ts#L235) |
| `product-display.0ac4d0a4` | 写死 | {names}同时生效时{when}，{prices}调完超过了结算价的上限，报不出来 | 文字 | [product-display.ts:237](../../apps/web/src/lib/product-display.ts#L237) |
| `product-display.3a7d9aff` | 写死 | {names}同时生效时{when}，{prices}调完不大于 0，报不出来 | 文字 | [product-display.ts:237](../../apps/web/src/lib/product-display.ts#L237) |
| `product-display.e98ccd45` | 写死 | 第 {…} 条 | 名称 | [product-display.ts:238](../../apps/web/src/lib/product-display.ts#L238) |
| `product-display.f03e63e3` | 写死 | 库存是限量的，但从今天起没有一天有库存——上了架也卖不出去。 | 文字 | [product-display.ts:241](../../apps/web/src/lib/product-display.ts#L241) |
| `product-display.d428556d` | 写死 | 热门地标「{name}」不在这个商品的任何区域里（基础价、行程加价、上下车加价区域都没有盖住），客人在这里上下车或经停报不出价 | 文字 | [product-display.ts:251](../../apps/web/src/lib/product-display.ts#L251) |
| `product-display.97fa24c1` | 写死 | 有 {unnamed} 个热门地标不在这个商品的任何区域里（基础价、行程加价、上下车加价区域都没有盖住），客人在那里上下车或经停报不出价 | 文字 | [product-display.ts:254](../../apps/web/src/lib/product-display.ts#L254) |
| `product-display.0db53618` | 写死 | 一部分 | 文字 | [product-display.ts:263](../../apps/web/src/lib/product-display.ts#L263) |
| `product-display.470aed49` | 写死 | 报价区域{…}有{…}不在任何运营区域里，那部分不会报价 | 文字 | [product-display.ts:263](../../apps/web/src/lib/product-display.ts#L263) |
| `product-display.9252469d` | 写死 | 有一项不符合要求 | 文字 | [product-display.ts:270](../../apps/web/src/lib/product-display.ts#L270) |

## 商品各页面共用的出错文字（product-failure.ts）

用在：供应商后台 · 商品列表；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 订单（列表、详情）；运营后台 · 赔付表

文件：`apps/web/src/lib/product-failure.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `product-failure.6bbfa92c` | 写死 | 你没有权限修改商品。需要的话，请联系你们的管理员开通。 | 文字 | [product-failure.ts:4](../../apps/web/src/lib/product-failure.ts#L4) |
| `product-failure.848a9d1e` | 写死 | 你填写的内容还在。 | 文字 | [product-failure.ts:8](../../apps/web/src/lib/product-failure.ts#L8) |
| `product-failure.730474a3` | 写死 | 网络连接失败，请检查网络后重试。{tail} | 提示 | [product-failure.ts:9](../../apps/web/src/lib/product-failure.ts#L9) |
| `product-failure.975363e3` | 写死 | 系统暂时无法{action}，请稍后再试。{tail} | 提示 | [product-failure.ts:10](../../apps/web/src/lib/product-failure.ts#L10) |
| `product-failure.6dcd041f` | 写死 | 这一项不符合要求，请检查后重试 | 提示 | [product-failure.ts:28](../../apps/web/src/lib/product-failure.ts#L28) |

## 企业信息和资料修改申请（profile-display.ts）

用在：供应商后台 · 企业信息；运营后台 · 供应商（列表、新建、详情）

文件：`apps/web/src/lib/profile-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `profile-display.6a4d05d4` | 写死 | 如 JP、KR。决定要交哪些资质。 | 说明 | [profile-display.ts:10](../../apps/web/src/lib/profile-display.ts#L10) |
| `profile-display.caecf589` | 写死 | {country\_code}（两位代码） | 名称 | [profile-display.ts:10](../../apps/web/src/lib/profile-display.ts#L10) |
| `profile-display.f9b8c2d0` | 写死 | 和营业执照、登记簿上的一致。 | 说明 | [profile-display.ts:11](../../apps/web/src/lib/profile-display.ts#L11) |
| `profile-display.d1e6884b` | 写死 | 营业执照号、法人登记号或统一社会信用代码。 | 说明 | [profile-display.ts:12](../../apps/web/src/lib/profile-display.ts#L12) |
| `profile-display.3d501b6c` | 写死 | 带国家码，如 +81 3-1234-5678。 | 说明 | [profile-display.ts:15](../../apps/web/src/lib/profile-display.ts#L15) |
| `profile-display.ea466eb1` | 写死 | 等平台审核 | 名称 | [profile-display.ts:36](../../apps/web/src/lib/profile-display.ts#L36) |
| `profile-display.5f65c435` | 写死 | 已生效 | 名称 | [profile-display.ts:37](../../apps/web/src/lib/profile-display.ts#L37) |
| `profile-display.45c3f558` | 写死 | 已驳回 | 名称 | [profile-display.ts:38](../../apps/web/src/lib/profile-display.ts#L38) |
| `profile-display.65dba9d6` | 写死 | 已撤回 | 名称 | [profile-display.ts:39](../../apps/web/src/lib/profile-display.ts#L39) |
| `profile-display.4687b4b2` | 写死 | 刚被别人改过。请刷新页面看最新的内容，再改。 | 文字 | [profile-display.ts:47](../../apps/web/src/lib/profile-display.ts#L47) |
| `profile-display.02eb22e1` | 写死 | 有填写不对的地方：国家要两位字母代码，邮箱要是邮箱的格式，名称不能为空、不能和现在一样。 | 文字 | [profile-display.ts:49](../../apps/web/src/lib/profile-display.ts#L49) |
| `profile-display.b8e5de6a` | 写死 | 法定名称、登记号、所在国家不能直接改：法定名称和登记号请用下面的「申请修改」，国家请联系平台。 | 文字 | [profile-display.ts:51](../../apps/web/src/lib/profile-display.ts#L51) |
| `profile-display.877ad523` | 写死 | 已经有一条等平台审核的申请。要改内容，请先撤回那一条再提交。 | 文字 | [profile-display.ts:53](../../apps/web/src/lib/profile-display.ts#L53) |
| `profile-display.1163bab8` | 写死 | 这条申请已经发起了复核：请在「待审核」里批准、驳回或撤回那条复核。 | 文字 | [profile-display.ts:55](../../apps/web/src/lib/profile-display.ts#L55) |
| `profile-display.82aa5a8b` | 写死 | 这条申请已经有结论了。请刷新页面。 | 文字 | [profile-display.ts:57](../../apps/web/src/lib/profile-display.ts#L57) |
| `profile-display.d3932321` | 写死 | 已清退，不能再修改。 | 文字 | [profile-display.ts:59](../../apps/web/src/lib/profile-display.ts#L59) |
| `profile-display.3d2d3e76` | 写死 | 你没有权限做这个操作。 | 文字 | [profile-display.ts:61](../../apps/web/src/lib/profile-display.ts#L61) |

## 救援改派与违约金在页面上的说法（rescue-display.ts）

用在：供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/rescue-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `rescue-display.12436dcb` | 写死 | 原结算价的 30%（用车前 2–24 小时） | 文字 | [rescue-display.ts:63](../../apps/web/src/lib/rescue-display.ts#L63) |
| `rescue-display.aafc70c9` | 写死 | 原结算价的 100% | 文字 | [rescue-display.ts:63](../../apps/web/src/lib/rescue-display.ts#L63) |
| `rescue-display.e8d00203` | 写死 | 0（用车前 24 小时以上） | 文字 | [rescue-display.ts:63](../../apps/web/src/lib/rescue-display.ts#L63) |
| `rescue-display.854d27a3` | 写死 | {…}：原结算价 {…} × {…}% | 文字 | [rescue-display.ts:73](../../apps/web/src/lib/rescue-display.ts#L73) |
| `rescue-display.e17f04cc` | 写死 | 工单 {ticket\_no} | 文字 | [rescue-display.ts:75](../../apps/web/src/lib/rescue-display.ts#L75) |
| `rescue-display.2d6f2756` | 写死 | {…}：结算价 {…} × {…}%{…} | 文字 | [rescue-display.ts:78](../../apps/web/src/lib/rescue-display.ts#L78) |
| `rescue-display.65dd2b87` | 写死 |  + 车型差价 {…} | 文字 | [rescue-display.ts:78](../../apps/web/src/lib/rescue-display.ts#L78) |
| `rescue-display.08baf9f8` | 写死 | （按订单报价时的汇率换成结算币种） | 文字 | [rescue-display.ts:80](../../apps/web/src/lib/rescue-display.ts#L80) |
| `rescue-display.d8a994c4` | 写死 | {…}：客人凭票报销的替代交通，全部由供应商承担{…} | 文字 | [rescue-display.ts:80](../../apps/web/src/lib/rescue-display.ts#L80) |
| `rescue-display.06a9faa2` | 写死 | 原结算价 {…} | 文字 | [rescue-display.ts:84](../../apps/web/src/lib/rescue-display.ts#L84) |
| `rescue-display.3d653cb7` | 写死 | 救援差价基准 {…}（原结算价 {…} + 加价重算多出的 {…}） | 文字 | [rescue-display.ts:84](../../apps/web/src/lib/rescue-display.ts#L84) |
| `rescue-display.0735c95f` | 写死 | 救援结算价{…} {…} − {subtrahend}{…} | 文字 | [rescue-display.ts:85](../../apps/web/src/lib/rescue-display.ts#L85) |
| `rescue-display.4e512230` | 写死 | （按两边报价时的汇率换算） | 文字 | [rescue-display.ts:85](../../apps/web/src/lib/rescue-display.ts#L85) |
| `rescue-display.e188d4a3` | 写死 | ，为负记 0 | 文字 | [rescue-display.ts:85](../../apps/web/src/lib/rescue-display.ts#L85) |
| `rescue-display.33828273` | 写死 | 找不到下单时的报价 | 文字 | [rescue-display.ts:90](../../apps/web/src/lib/rescue-display.ts#L90) |
| `rescue-display.74ceb28e` | 写死 | 原订单的商品已经不在了 | 文字 | [rescue-display.ts:91](../../apps/web/src/lib/rescue-display.ts#L91) |
| `rescue-display.6cd78b59` | 写死 | 原商品的结算币种变了 | 文字 | [rescue-display.ts:92](../../apps/web/src/lib/rescue-display.ts#L92) |
| `rescue-display.234e3bae` | 写死 | 原商品按现在的规则报不出这个车型 | 文字 | [rescue-display.ts:93](../../apps/web/src/lib/rescue-display.ts#L93) |
| `rescue-display.af394755` | 写死 | 重算时出错 | 提示 | [rescue-display.ts:94](../../apps/web/src/lib/rescue-display.ts#L94) |
| `rescue-display.835f1a3e` | 写死 | 原商品按现在的规则报不出（{reason}） | 文字 | [rescue-display.ts:98](../../apps/web/src/lib/rescue-display.ts#L98) |
| `rescue-display.8b589246` | 写死 | 按原结算价 {…} | 文字 | [rescue-display.ts:109](../../apps/web/src/lib/rescue-display.ts#L109) |
| `rescue-display.8a9153b8` | 写死 | 订单上的加价合计 {…}，按现在的规则重算 {…} | 文字 | [rescue-display.ts:110](../../apps/web/src/lib/rescue-display.ts#L110) |
| `rescue-display.32c5b925` | 写死 | {…}，就是原结算价（加价重算失败：{…}） | 文字 | [rescue-display.ts:111](../../apps/web/src/lib/rescue-display.ts#L111) |
| `rescue-display.e296ba6f` | 写死 | {…}，就是原结算价（{totals}） | 文字 | [rescue-display.ts:113](../../apps/web/src/lib/rescue-display.ts#L113) |
| `rescue-display.574da017` | 写死 | {…} = 原结算价 {…} + 加价重算多出的 {…}（{totals}） | 文字 | [rescue-display.ts:114](../../apps/web/src/lib/rescue-display.ts#L114) |
| `rescue-display.a90feff2` | 写死 | 已过期 | 文字 | [rescue-display.ts:134](../../apps/web/src/lib/rescue-display.ts#L134) |
| `rescue-display.2c998ddd` | 写死 | 还剩 {…} 秒 | 文字 | [rescue-display.ts:136](../../apps/web/src/lib/rescue-display.ts#L136) |
| `rescue-display.2ff3af19` | 写死 | 还剩 {minutes} 分钟 | 文字 | [rescue-display.ts:136](../../apps/web/src/lib/rescue-display.ts#L136) |
| `rescue-display.31d4137c` | 写死 | 供应商来电说接不了：写清楚是谁、什么时候说的、什么原因 | 文字 | [rescue-display.ts:141](../../apps/web/src/lib/rescue-display.ts#L141) |
| `rescue-display.f633e4bf` | 写死 | 用车前 6 小时仍未派车（系统每分钟会自动发起；没到时间不能发起） | 文字 | [rescue-display.ts:142](../../apps/web/src/lib/rescue-display.ts#L142) |
| `rescue-display.db778ff2` | 写死 | 到点 15 分钟司机仍未到达、联系不上：写清楚联系了谁、几次 | 文字 | [rescue-display.ts:143](../../apps/web/src/lib/rescue-display.ts#L143) |
| `rescue-display.30e90267` | 写死 | 供应商在暂停中、这是它的未来订单 | 文字 | [rescue-display.ts:144](../../apps/web/src/lib/rescue-display.ts#L144) |

## 点对点「线路价」（route-prices.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/route-prices.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `route-prices.9c96caa7` | 写死 | 给「从哪个区域上车、到哪个区域下车」单独定价，只管这一个方向。 | 说明 | [route-prices.ts:24](../../apps/web/src/lib/route-prices.ts#L24) |
| `route-prices.ef192a53` | 写死 | 有线路价的线路就用线路价，不再和区域价比谁低；没有线路价的线路照常用上面的区域价。 | 说明 | [route-prices.ts:25](../../apps/web/src/lib/route-prices.ts#L25) |
| `route-prices.8944f3dc` | 写死 | 填了会同时建反方向的线路价，车型组、含公里数、生效日期、启用都和去程一样。建好以后是两条独立的价格，各自改、停用、删除。 | 说明 | [route-prices.ts:26](../../apps/web/src/lib/route-prices.ts#L26) |
| `route-prices.6f7667e3` | 写死 | 一口价里含多少公里。报价时按客人这一单的路线距离算，超出的部分加进一口价。 | 说明 | [route-prices.ts:27](../../apps/web/src/lib/route-prices.ts#L27) |
| `route-prices.7142dbd7` | 写死 | 超过含的公里数以后每公里加多少。不足 1 公里按 1 公里算（和「里程 + 时长」的按比例不同）。 | 说明 | [route-prices.ts:28](../../apps/web/src/lib/route-prices.ts#L28) |
| `route-prices.02f0e562` | 写死 | 拿不到路线距离时（地图服务暂时不可用），这条价格不报价——宁可报不出，也不少收。 | 说明 | [route-prices.ts:29](../../apps/web/src/lib/route-prices.ts#L29) |
| `route-prices.fb5cb649` | 写死 | 至少选一个车型组 | 文字 | [route-prices.ts:81](../../apps/web/src/lib/route-prices.ts#L81) |
| `route-prices.1ae80656` | 写死 | 请填价格 | 文字 | [route-prices.ts:84](../../apps/web/src/lib/route-prices.ts#L84) |
| `route-prices.a4f7ecbd` | 写死 | 请填起步价 | 文字 | [route-prices.ts:84](../../apps/web/src/lib/route-prices.ts#L84) |
| `route-prices.277c7a71` | 写死 | 价格 | 文字 | [route-prices.ts:85](../../apps/web/src/lib/route-prices.ts#L85) |
| `route-prices.692a3ef3` | 写死 | 返程价格 | 文字 | [route-prices.ts:89](../../apps/web/src/lib/route-prices.ts#L89) |
| `route-prices.3b70732a` | 写死 | 会建 {length} 条线路价。 | 文字 | [route-prices.ts:137](../../apps/web/src/lib/route-prices.ts#L137) |
| `route-prices.a1566679` | 写死 | 会建 {length} 条线路价，返程 {length} 条，共 {…} 条。 | 文字 | [route-prices.ts:138](../../apps/web/src/lib/route-prices.ts#L138) |
| `route-prices.9badb279` | 写死 | 请选上车区域和下车区域 | 文字 | [route-prices.ts:179](../../apps/web/src/lib/route-prices.ts#L179) |
| `route-prices.4a049bee` | 写死 | 上车区域和下车区域不能相同 | 文字 | [route-prices.ts:180](../../apps/web/src/lib/route-prices.ts#L180) |
| `route-prices.e9ed46c7` | 写死 | 要复制到另一条线路 | 文字 | [route-prices.ts:181](../../apps/web/src/lib/route-prices.ts#L181) |
| `route-prices.4a5d1c6a` | 写死 | 至少勾一个车型组 | 文字 | [route-prices.ts:182](../../apps/web/src/lib/route-prices.ts#L182) |
| `route-prices.3583afca` | 写死 | 请填大于 0 的金额（{currency}） | 文字 | [route-prices.ts:183](../../apps/web/src/lib/route-prices.ts#L183) |
| `route-prices.3a88bf90` | 写死 | 请填 0.01 到 100 之间的百分比，最多 2 位小数 | 文字 | [route-prices.ts:183](../../apps/web/src/lib/route-prices.ts#L183) |
| `route-prices.a6c859c9` | 写死 | 会填 {length} 条 | 文字 | [route-prices.ts:252](../../apps/web/src/lib/route-prices.ts#L252) |
| `route-prices.cb34cf34` | 写死 | 跳过 {skipped} 条已经有线路价的 | 文字 | [route-prices.ts:253](../../apps/web/src/lib/route-prices.ts#L253) |
| `route-prices.66e70cf1` | 写死 | {notPositive} 条调完不大于 0，不填 | 文字 | [route-prices.ts:254](../../apps/web/src/lib/route-prices.ts#L254) |
| `route-prices.d3dcdd3d` | 写死 | 上车区域和下车区域相同，同一个区域请用区域价。 | 文字 | [route-prices.ts:266](../../apps/web/src/lib/route-prices.ts#L266) |
| `route-prices.c5907a66` | 写死 | 「{name}」已经不在这个商品里，这条线路价保存不了。 | 文字 | [route-prices.ts:267](../../apps/web/src/lib/route-prices.ts#L267) |
| `route-prices.2ea6605c` | 写死 | 「{name}」是运营区域，不能用来定价：运营区域只决定能不能接单，不带价格。请换一个报价区域（或到区域页面把它改成「运营 + 报价」）。 | 文字 | [route-prices.ts:268](../../apps/web/src/lib/route-prices.ts#L268) |
| `route-prices.690754bc` | 写死 | 只有点对点能设线路价（下车区域）。 | 文字 | [route-prices.ts:269](../../apps/web/src/lib/route-prices.ts#L269) |
| `route-prices.04de1aa9` | 写死 | 只有点对点的一口价能设含公里数。 | 文字 | [route-prices.ts:274](../../apps/web/src/lib/route-prices.ts#L274) |
| `route-prices.36786b7a` | 写死 | 超出每公里最多 {…} | 文字 | [route-prices.ts:278](../../apps/web/src/lib/route-prices.ts#L278) |
| `route-prices.a3da8453` | 写死 | 只有点对点的一口价能设超出每公里。 | 文字 | [route-prices.ts:279](../../apps/web/src/lib/route-prices.ts#L279) |

## ② 服务规则的表单模型（service-rules-form.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/service-rules-form.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `service-rules-form.73d13b84` | 写死 | 请填时间，例如 {example} | 文字 | [service-rules-form.ts:161](../../apps/web/src/lib/service-rules-form.ts#L161)、162 行 |
| `service-rules-form.9520a269` | 写死 | 请填 00:00 到 23:59 之间的时间 | 文字 | [service-rules-form.ts:161](../../apps/web/src/lib/service-rules-form.ts#L161)、162 行 |
| `service-rules-form.5f501170` | 写死 | 下单有效期：这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [service-rules-form.ts:221](../../apps/web/src/lib/service-rules-form.ts#L221) |
| `service-rules-form.1a9db6c3` | 写死 | 下单有效期：结束日期不能早于开始日期 | 文字 | [service-rules-form.ts:225](../../apps/web/src/lib/service-rules-form.ts#L225) |
| `service-rules-form.29878308` | 写死 | 开始和结束不能相同。全天都接单请勾「全天 24 小时」 | 文字 | [service-rules-form.ts:229](../../apps/web/src/lib/service-rules-form.ts#L229) |
| `service-rules-form.ddd1a125` | 写死 | 服务时间 | 文字 | [service-rules-form.ts:229](../../apps/web/src/lib/service-rules-form.ts#L229) |
| `service-rules-form.e0df5637` | 写死 | 提前预订时长：请填 0 到 {maxLeadTimeHours} 之间的整数 | 文字 | [service-rules-form.ts:234](../../apps/web/src/lib/service-rules-form.ts#L234) |
| `service-rules-form.8e94639a` | 写死 | 备注最多 {maxNoteLength} 个字 | 文字 | [service-rules-form.ts:237](../../apps/web/src/lib/service-rules-form.ts#L237) |
| `service-rules-form.9fd4dca1` | 写死 | 每日加急库存：要停掉加急，请取消勾选「允许加急预订」 | 文字 | [service-rules-form.ts:244](../../apps/web/src/lib/service-rules-form.ts#L244) |
| `service-rules-form.d1e5306c` | 写死 | 每日加急库存：请填 1 到 {…} 之间的整数，或留空表示不限 | 文字 | [service-rules-form.ts:247](../../apps/web/src/lib/service-rules-form.ts#L247) |
| `service-rules-form.4ed1a621` | 写死 | 加急阶梯第 {…} 档 | 名称 | [service-rules-form.ts:252](../../apps/web/src/lib/service-rules-form.ts#L252) |
| `service-rules-form.de5846d0` | 写死 | {label}：请填写小时数 | 文字 | [service-rules-form.ts:256](../../apps/web/src/lib/service-rules-form.ts#L256) |
| `service-rules-form.41fe6320` | 写死 | {label}：提前预订时长是 0 小时时没有「来不及」的单。请关掉加急，或把提前预订时长改成至少 1 小时 | 文字 | [service-rules-form.ts:257](../../apps/web/src/lib/service-rules-form.ts#L257) |
| `service-rules-form.421e92ff` | 写死 | {label}：提前不足的小时数不能超过提前预订时长（现在是 {limit} 小时），请填 1 到 {limit}；要把更早下的单也算加急，先把提前预订时长改大 | 文字 | [service-rules-form.ts:257](../../apps/web/src/lib/service-rules-form.ts#L257) |
| `service-rules-form.bc2af467` | 写死 | {label}：请填 1 到 {limit} 之间的整数 | 文字 | [service-rules-form.ts:257](../../apps/web/src/lib/service-rules-form.ts#L257) |
| `service-rules-form.79ef7271` | 写死 | 第 {…} 档和第 {…} 档的小时数相同 | 文字 | [service-rules-form.ts:258](../../apps/web/src/lib/service-rules-form.ts#L258) |
| `service-rules-form.5e5c5cb3` | 写死 | {label}：请填写加收的金额，不加收请填 0 | 文字 | [service-rules-form.ts:264](../../apps/web/src/lib/service-rules-form.ts#L264) |
| `service-rules-form.2ca8ce81` | 写死 | 开始和结束不能相同 | 文字 | [service-rules-form.ts:274](../../apps/web/src/lib/service-rules-form.ts#L274) |
| `service-rules-form.876c71a6` | 写死 | 夜间时段 | 文字 | [service-rules-form.ts:274](../../apps/web/src/lib/service-rules-form.ts#L274) |
| `service-rules-form.d596c608` | 写死 | 夜间加价的金额 | 文字 | [service-rules-form.ts:275](../../apps/web/src/lib/service-rules-form.ts#L275) |
| `service-rules-form.107191bb` | 写死 | 免费等待：{…} | 文字 | [service-rules-form.ts:289](../../apps/web/src/lib/service-rules-form.ts#L289) |
| `service-rules-form.9175444d` | 写死 | 不能少于平台规定的 {minimum} 分钟 | 文字 | [service-rules-form.ts:289](../../apps/web/src/lib/service-rules-form.ts#L289) |
| `service-rules-form.c11416b8` | 写死 | 请填 {minimum} 到 1,440 之间的整数 | 文字 | [service-rules-form.ts:289](../../apps/web/src/lib/service-rules-form.ts#L289) |
| `service-rules-form.1bb97377` | 写死 | 附加服务「{…}」 | 名称 | [service-rules-form.ts:298](../../apps/web/src/lib/service-rules-form.ts#L298) |
| `service-rules-form.8f4bdd3b` | 写死 | {label}：请填单价，免费提供请填 0 | 文字 | [service-rules-form.ts:300](../../apps/web/src/lib/service-rules-form.ts#L300) |
| `service-rules-form.ad13869b` | 写死 | 司机语言第 {…} 行：请选择语言 | 文字 | [service-rules-form.ts:313](../../apps/web/src/lib/service-rules-form.ts#L313) |
| `service-rules-form.57b54599` | 写死 | 司机语言：{name}已经在第 {…} 行了 | 文字 | [service-rules-form.ts:314](../../apps/web/src/lib/service-rules-form.ts#L314) |
| `service-rules-form.9bb7f569` | 写死 | 司机语言第 {…} 行：请填单价，免费提供请填 0 | 文字 | [service-rules-form.ts:316](../../apps/web/src/lib/service-rules-form.ts#L316) |
| `service-rules-form.d74c4bc1` | 写死 | 司机语言第 {…} 行 | 文字 | [service-rules-form.ts:317](../../apps/web/src/lib/service-rules-form.ts#L317) |
| `service-rules-form.5ea260df` | 写死 | {label}：请填 0 到 {max} 之间的整数（分钟） | 文字 | [service-rules-form.ts:328](../../apps/web/src/lib/service-rules-form.ts#L328) |
| `service-rules-form.0c6571a1` | 写死 | 经停点默认占用 | 文字 | [service-rules-form.ts:331](../../apps/web/src/lib/service-rules-form.ts#L331) |
| `service-rules-form.3a0958bf` | 写死 | 整单缓冲 | 文字 | [service-rules-form.ts:332](../../apps/web/src/lib/service-rules-form.ts#L332) |
| `service-rules-form.72e3bcb8` | 写死 | 最低套餐：请填 1 到 {maxPackageHours} 之间的整数（小时），不限请留空 | 文字 | [service-rules-form.ts:337](../../apps/web/src/lib/service-rules-form.ts#L337) |
| `service-rules-form.dd6febf1` | 写死 | {label}：请填 {min} 到 {max} 之间的整数（{unit}） | 文字 | [service-rules-form.ts:344](../../apps/web/src/lib/service-rules-form.ts#L344) |
| `service-rules-form.2ccf8751` | 写死 | 分钟 | 文字 | [service-rules-form.ts:347](../../apps/web/src/lib/service-rules-form.ts#L347) |
| `service-rules-form.eb469252` | 写死 | 预计用时提醒线 | 文字 | [service-rules-form.ts:347](../../apps/web/src/lib/service-rules-form.ts#L347) |
| `service-rules-form.f41f7b2d` | 写死 | 全程提醒线 | 文字 | [service-rules-form.ts:348](../../apps/web/src/lib/service-rules-form.ts#L348) |
| `service-rules-form.fb43adfb` | 写死 | 公里 | 文字 | [service-rules-form.ts:348](../../apps/web/src/lib/service-rules-form.ts#L348) |
| `service-rules-form.1baf9869` | 写死 | 加急阶梯：请填 1 到 {…} 之间的整数 | 文字 | [service-rules-form.ts:384](../../apps/web/src/lib/service-rules-form.ts#L384) |
| `service-rules-form.54b8991f` | 写死 | 加急阶梯：提前预订时长是 0 小时时没有「来不及」的单。请关掉加急，或把提前预订时长改成至少 1 小时 | 文字 | [service-rules-form.ts:384](../../apps/web/src/lib/service-rules-form.ts#L384) |
| `service-rules-form.98702c23` | 写死 | 提前预订时长 | 文字 | [service-rules-form.ts:384](../../apps/web/src/lib/service-rules-form.ts#L384) |
| `service-rules-form.b9fe5258` | 写死 | 免费等待：不能少于平台规定的 {…} 分钟 | 文字 | [service-rules-form.ts:386](../../apps/web/src/lib/service-rules-form.ts#L386) |
| `service-rules-form.b3f973ba` | 写死 | 免费等待：包车由平台固定为 {…} 分钟（从约定的开始时间起计入套餐时长），不能改 | 文字 | [service-rules-form.ts:388](../../apps/web/src/lib/service-rules-form.ts#L388) |
| `service-rules-form.bba81998` | 写死 | 请填 {…} 到 {…} 之间的数 | 文字 | [service-rules-form.ts:390](../../apps/web/src/lib/service-rules-form.ts#L390) |
| `service-rules-form.96733c27` | 写死 | 最多 {…} 条 | 文字 | [service-rules-form.ts:392](../../apps/web/src/lib/service-rules-form.ts#L392) |
| `service-rules-form.fd720179` | 写死 | 最多 {…} 个字 | 文字 | [service-rules-form.ts:394](../../apps/web/src/lib/service-rules-form.ts#L394) |
| `service-rules-form.400556ea` | 写死 | 有重复的内容 | 文字 | [service-rules-form.ts:396](../../apps/web/src/lib/service-rules-form.ts#L396) |
| `service-rules-form.b6b40d97` | 写死 | 这一项不符合要求，请检查后重试 | 文字 | [service-rules-form.ts:398](../../apps/web/src/lib/service-rules-form.ts#L398) |

## 官网（site-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/site-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `site-display.0d2150d6` | 写死 | {zh}：先通知您，48 小时内可以在订单页提异议。 | 说明 | [site-display.ts:24](../../apps/web/src/lib/site-display.ts#L24)、27 行 |
| `site-display.8fba9221` | 写死 | 下车地址或酒店名 | 文字 | [site-display.ts:91](../../apps/web/src/lib/site-display.ts#L91) |
| `site-display.b7533643` | 写死 | 上车地址或酒店名 | 文字 | [site-display.ts:91](../../apps/web/src/lib/site-display.ts#L91) |
| `site-display.46f757aa` | 写死 | 航班计划到达时间（当地） | 文字 | [site-display.ts:96](../../apps/web/src/lib/site-display.ts#L96) |
| `site-display.a04423a5` | 写死 | 航班计划到达 | 文字 | [site-display.ts:96](../../apps/web/src/lib/site-display.ts#L96) |
| `site-display.d7ef9966` | 写死 | 航班到达日期（当地） | 文字 | [site-display.ts:96](../../apps/web/src/lib/site-display.ts#L96) |
| `site-display.1da9770c` | 写死 | 上车时间（当地） | 文字 | [site-display.ts:97](../../apps/web/src/lib/site-display.ts#L97) |
| `site-display.7889aab0` | 写死 | 用车日期（当地） | 文字 | [site-display.ts:97](../../apps/web/src/lib/site-display.ts#L97) |
| `site-display.9c7f0e8c` | 写死 | 上车时间 | 文字 | [site-display.ts:97](../../apps/web/src/lib/site-display.ts#L97) |
| `site-display.e1bc6789` | 写死 | 不限时 | 文字 | [site-display.ts:122](../../apps/web/src/lib/site-display.ts#L122) |
| `site-display.cf55a7b6` | 写死 | 不另计免费等待（从约定的开始时间起计入包车时长） | 文字 | [site-display.ts:124](../../apps/web/src/lib/site-display.ts#L124) |
| `site-display.0dbe44c0` | 写死 | 从约定的上车时间起算 | 文字 | [site-display.ts:125](../../apps/web/src/lib/site-display.ts#L125) |
| `site-display.38bd6d10` | 写死 | {minutes} 分钟（{…}） | 文字 | [site-display.ts:125](../../apps/web/src/lib/site-display.ts#L125) |
| `site-display.91a820d7` | 写死 | 从航班落地起算 | 文字 | [site-display.ts:125](../../apps/web/src/lib/site-display.ts#L125) |
| `site-display.92a8f68d` | 写死 | {hours} 小时，含 {…} 公里 | 文字 | [site-display.ts:130](../../apps/web/src/lib/site-display.ts#L130) |
| `site-display.9c3e955a` | 写死 | {hours} 小时 | 文字 | [site-display.ts:130](../../apps/web/src/lib/site-display.ts#L130) |
| `site-display.4feac32b` | 写死 | 待付款 | 名称 | [site-display.ts:146](../../apps/web/src/lib/site-display.ts#L146) |
| `site-display.f1318fc1` | 写死 | 已确认 | 名称 | [site-display.ts:147](../../apps/web/src/lib/site-display.ts#L147) |
| `site-display.83e4c0e8` | 写死 | 已派车 | 名称 | [site-display.ts:148](../../apps/web/src/lib/site-display.ts#L148) |
| `site-display.0b849b1c` | 写死 | 司机已出发 | 名称 | [site-display.ts:149](../../apps/web/src/lib/site-display.ts#L149)、166 行 |
| `site-display.4c7b3efd` | 写死 | 司机已到达 | 名称 | [site-display.ts:150](../../apps/web/src/lib/site-display.ts#L150) |
| `site-display.87e6df72` | 写死 | 服务中 | 名称 | [site-display.ts:151](../../apps/web/src/lib/site-display.ts#L151) |
| `site-display.01a4551c` | 写死 | 已完成 | 名称 | [site-display.ts:152](../../apps/web/src/lib/site-display.ts#L152) |
| `site-display.099a65df` | 写死 | 司机报告未接到您（审核中） | 名称 | [site-display.ts:153](../../apps/web/src/lib/site-display.ts#L153) |
| `site-display.c70df6b0` | 写死 | 未接到乘客 | 名称 | [site-display.ts:154](../../apps/web/src/lib/site-display.ts#L154) |
| `site-display.c3754310` | 写死 | 已取消 | 名称 | [site-display.ts:155](../../apps/web/src/lib/site-display.ts#L155) |
| `site-display.d0d8a1cb` | 写死 | 正在为您重新安排车辆 | 名称 | [site-display.ts:156](../../apps/web/src/lib/site-display.ts#L156)、173 行 |
| `site-display.ab21fe3e` | 写死 | 已为您重新安排车辆 | 名称 | [site-display.ts:158](../../apps/web/src/lib/site-display.ts#L158)、174 行 |
| `site-display.01e8eaf7` | 写死 | 已下单，等待付款 | 文字 | [site-display.ts:163](../../apps/web/src/lib/site-display.ts#L163) |
| `site-display.d1b06cd7` | 写死 | 付款成功，订单已确认 | 文字 | [site-display.ts:164](../../apps/web/src/lib/site-display.ts#L164) |
| `site-display.4f9ac17b` | 写死 | 已安排司机和车辆 | 文字 | [site-display.ts:165](../../apps/web/src/lib/site-display.ts#L165) |
| `site-display.639c3a60` | 写死 | 司机已到达上车点 | 文字 | [site-display.ts:167](../../apps/web/src/lib/site-display.ts#L167) |
| `site-display.32f4456c` | 写死 | 已上车 | 文字 | [site-display.ts:168](../../apps/web/src/lib/site-display.ts#L168) |
| `site-display.2592906d` | 写死 | 服务完成 | 文字 | [site-display.ts:169](../../apps/web/src/lib/site-display.ts#L169) |
| `site-display.22584916` | 写死 | 司机报告未接到您，平台审核中 | 文字 | [site-display.ts:170](../../apps/web/src/lib/site-display.ts#L170) |
| `site-display.ec584fc5` | 写死 | 审核结果：未接到乘客 | 文字 | [site-display.ts:171](../../apps/web/src/lib/site-display.ts#L171) |
| `site-display.dff330ad` | 写死 | 订单已取消 | 文字 | [site-display.ts:172](../../apps/web/src/lib/site-display.ts#L172) |
| `site-display.551e59e6` | 写死 | 超过付款期限没有付款，系统自动取消 | 文字 | [site-display.ts:183](../../apps/web/src/lib/site-display.ts#L183) |
| `site-display.6e3ec0f5` | 写死 | 付款被取消 | 文字 | [site-display.ts:184](../../apps/web/src/lib/site-display.ts#L184) |
| `site-display.486120c4` | 写死 | 您取消了订单 | 文字 | [site-display.ts:185](../../apps/web/src/lib/site-display.ts#L185) |
| `site-display.7f3ef3b4` | 写死 | 改期没有被确认，免费取消 | 文字 | [site-display.ts:186](../../apps/web/src/lib/site-display.ts#L186) |
| `site-display.21951f79` | 写死 | 航班取消，免费取消 | 文字 | [site-display.ts:187](../../apps/web/src/lib/site-display.ts#L187) |
| `site-display.64a0fae1` | 写死 | 不可抗力，免费取消 | 文字 | [site-display.ts:188](../../apps/web/src/lib/site-display.ts#L188) |
| `site-display.5edfed8b` | 写死 | 服务方原因，免费取消 | 文字 | [site-display.ts:189](../../apps/web/src/lib/site-display.ts#L189) |
| `site-display.ae23cfc4` | 写死 | 平台原因，免费取消 | 文字 | [site-display.ts:190](../../apps/web/src/lib/site-display.ts#L190) |
| `site-display.50280218` | 写死 | 这里暂时没有这种服务可预订，请换一种服务或换一个城市。 | 文字 | [site-display.ts:195](../../apps/web/src/lib/site-display.ts#L195) |
| `site-display.1fc15955` | 写死 | 这个地址不在服务范围内，请换一个更靠近市区的地址。 | 文字 | [site-display.ts:196](../../apps/web/src/lib/site-display.ts#L196) |
| `site-display.4a6d5c05` | 写死 | 包车请填写下车地点。 | 提示 | [site-display.ts:197](../../apps/web/src/lib/site-display.ts#L197) |
| `site-display.55a62932` | 写死 | 有途经景点暂时没有在线报价，请联系客服人工报价，或去掉这个景点再试。 | 文字 | [site-display.ts:198](../../apps/web/src/lib/site-display.ts#L198) |
| `site-display.6d456377` | 写死 | 所选的套餐时长太短，请选更长的套餐。 | 文字 | [site-display.ts:199](../../apps/web/src/lib/site-display.ts#L199) |
| `site-display.7d107038` | 写死 | 该行程超出司机单日法定工作时长，无法在线预订。请缩减行程，或联系客服安排分两天用车。 | 文字 | [site-display.ts:201](../../apps/web/src/lib/site-display.ts#L201) |
| `site-display.75959f57` | 写死 | 离用车时间太近了，请选晚一些的时间。 | 说明 | [site-display.ts:202](../../apps/web/src/lib/site-display.ts#L202) |
| `site-display.a135836d` | 写死 | 这一天已经订满了，请换一天。 | 文字 | [site-display.ts:203](../../apps/web/src/lib/site-display.ts#L203) |
| `site-display.aee092f0` | 写死 | 这个时间不在服务时间内，请换一个时间。 | 文字 | [site-display.ts:204](../../apps/web/src/lib/site-display.ts#L204) |
| `site-display.8cc1c28c` | 写死 | 用车时间已经过了，请选一个以后的时间。 | 文字 | [site-display.ts:205](../../apps/web/src/lib/site-display.ts#L205) |
| `site-display.3b4d331b` | 写死 | 人数或行李超出了车辆能坐下的数量，请减少人数或行李。 | 文字 | [site-display.ts:206](../../apps/web/src/lib/site-display.ts#L206) |
| `site-display.a88abc55` | 写死 | 所选的附加服务暂不提供。 | 文字 | [site-display.ts:207](../../apps/web/src/lib/site-display.ts#L207) |
| `site-display.4460c35b` | 写死 | 所选的司机语言暂不提供。 | 文字 | [site-display.ts:208](../../apps/web/src/lib/site-display.ts#L208) |
| `site-display.44c7c529` | 写死 | 这两个地点之间没有可行驶的路线，请换一个地址。 | 文字 | [site-display.ts:209](../../apps/web/src/lib/site-display.ts#L209) |
| `site-display.545dbcef` | 写死 | 暂时算不出这段路程的价格，请稍后再试，或改订包车。 | 文字 | [site-display.ts:210](../../apps/web/src/lib/site-display.ts#L210) |
| `site-display.0e5e5706` | 写死 | 这个行程暂时无法在线报价，请联系客服人工报价，或调整行程后再试。 | 文字 | [site-display.ts:212](../../apps/web/src/lib/site-display.ts#L212) |
| `site-display.de317daa` | 写死 | 可提异议 | 名称 | [site-display.ts:266](../../apps/web/src/lib/site-display.ts#L266) |
| `site-display.05dbc1e0` | 写死 | 平台审核中 | 名称 | [site-display.ts:267](../../apps/web/src/lib/site-display.ts#L267) |
| `site-display.d0a62858` | 写死 | 已提异议，平台审核中 | 名称 | [site-display.ts:268](../../apps/web/src/lib/site-display.ts#L268) |
| `site-display.3741d94d` | 写死 | 审核通过，等待扣款 | 名称 | [site-display.ts:269](../../apps/web/src/lib/site-display.ts#L269) |
| `site-display.008940ab` | 写死 | 扣款中 | 名称 | [site-display.ts:270](../../apps/web/src/lib/site-display.ts#L270) |
| `site-display.0e904f78` | 写死 | 已扣款 | 名称 | [site-display.ts:271](../../apps/web/src/lib/site-display.ts#L271) |
| `site-display.e1722f2a` | 写死 | 扣款没有成功，平台会联系您 | 名称 | [site-display.ts:272](../../apps/web/src/lib/site-display.ts#L272) |
| `site-display.38fcf349` | 写死 | 不收取 | 名称 | [site-display.ts:273](../../apps/web/src/lib/site-display.ts#L273) |
| `site-display.c6e9f210` | 写死 | 已撤回 | 名称 | [site-display.ts:274](../../apps/web/src/lib/site-display.ts#L274) |
| `site-display.3c3cb51b` | 写死 | 正在补收差价 | 名称 | [site-display.ts:279](../../apps/web/src/lib/site-display.ts#L279) |
| `site-display.60b30f5f` | 写死 | 修改待确认 | 名称 | [site-display.ts:280](../../apps/web/src/lib/site-display.ts#L280) |
| `site-display.400ae68f` | 写死 | 服务方正在协调 | 名称 | [site-display.ts:281](../../apps/web/src/lib/site-display.ts#L281) |
| `site-display.909d309f` | 写死 | 已修改 | 名称 | [site-display.ts:282](../../apps/web/src/lib/site-display.ts#L282) |
| `site-display.2be73284` | 写死 | 没有被接受，原预约不变 | 名称 | [site-display.ts:283](../../apps/web/src/lib/site-display.ts#L283) |
| `site-display.5b41434d` | 写死 | 超时没有确认，原预约不变 | 名称 | [site-display.ts:284](../../apps/web/src/lib/site-display.ts#L284) |
| `site-display.8e596d21` | 写死 | 没有改成 | 名称 | [site-display.ts:285](../../apps/web/src/lib/site-display.ts#L285) |
| `site-display.1fde6aca` | 写死 | 已作废 | 名称 | [site-display.ts:286](../../apps/web/src/lib/site-display.ts#L286) |
| `site-display.2a95f1a3` | 写死 | {min\_hours\_before}–{upper} 小时内取消 | 文字 | [site-display.ts:304](../../apps/web/src/lib/site-display.ts#L304) |
| `site-display.9d7ed734` | 写死 | 用车前 {min\_hours\_before} 小时以上取消 | 文字 | [site-display.ts:304](../../apps/web/src/lib/site-display.ts#L304) |
| `site-display.d1effeaf` | 写死 | {upper} 小时内取消 | 文字 | [site-display.ts:304](../../apps/web/src/lib/site-display.ts#L304) |
| `site-display.e8e56520` | 写死 | 任何时候取消 | 文字 | [site-display.ts:304](../../apps/web/src/lib/site-display.ts#L304) |
| `site-display.125e3bb6` | 写死 | 收 {…} | 文字 | [site-display.ts:305](../../apps/web/src/lib/site-display.ts#L305) |
| `site-display.8a6b8426` | 写死 | 收全额 | 文字 | [site-display.ts:305](../../apps/web/src/lib/site-display.ts#L305) |
| `site-display.b3768152` | 写死 | 免费 | 文字 | [site-display.ts:305](../../apps/web/src/lib/site-display.ts#L305) |
| `site-display.017a1587` | 写死 | 周三 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.125f5735` | 写死 | 周二 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.95640f0e` | 写死 | 周五 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.ca8aff66` | 写死 | 周四 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.cdbbdac1` | 写死 | 周六 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.e00024a3` | 写死 | 周一 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.f49ea301` | 写死 | 周日 | 文字 | [site-display.ts:311](../../apps/web/src/lib/site-display.ts#L311) |
| `site-display.99c2ce32` | 写死 | {…}{…}月{…}日（{weekday}）{time} | 文字 | [site-display.ts:323](../../apps/web/src/lib/site-display.ts#L323) |
| `site-display.d5d5e6bf` | 写死 | {year}年 | 文字 | [site-display.ts:323](../../apps/web/src/lib/site-display.ts#L323) |
| `site-display.4c248719` | 写死 | 投诉服务 | 文字 | [site-display.ts:369](../../apps/web/src/lib/site-display.ts#L369) |
| `site-display.a6a6dac0` | 写死 | 其他问题 | 文字 | [site-display.ts:369](../../apps/web/src/lib/site-display.ts#L369) |
| `site-display.d93ca0d8` | 写死 | 修改订单 | 文字 | [site-display.ts:369](../../apps/web/src/lib/site-display.ts#L369) |
| `site-display.f032b4e5` | 写死 | 失物招领 | 文字 | [site-display.ts:369](../../apps/web/src/lib/site-display.ts#L369) |
| `site-display.864fe989` | 写死 | 司机迟到、没举牌、车况或态度不好、车型不对等，服务结束后 14 天内可以投诉 | 文字 | [site-display.ts:371](../../apps/web/src/lib/site-display.ts#L371) |
| `site-display.3989488b` | 写死 | 网上改不了的内容（时间、地址以外的） | 文字 | [site-display.ts:372](../../apps/web/src/lib/site-display.ts#L372) |
| `site-display.4ad31495` | 写死 | 东西落在车上了：写清楚是什么、坐的哪一程 | 文字 | [site-display.ts:373](../../apps/web/src/lib/site-display.ts#L373) |
| `site-display.c8437113` | 写死 | 别的问题 | 文字 | [site-display.ts:374](../../apps/web/src/lib/site-display.ts#L374) |
| `site-display.3713ec02` | 写死 | 已有结果 | 名称 | [site-display.ts:379](../../apps/web/src/lib/site-display.ts#L379) |
| `site-display.3a0adc6d` | 写死 | 已结束 | 名称 | [site-display.ts:380](../../apps/web/src/lib/site-display.ts#L380) |
| `site-display.1c8303c5` | 写死 | 处理中 | 名称 | [site-display.ts:381](../../apps/web/src/lib/site-display.ts#L381) |
| `site-display.4fb16a6b` | 写死 | 投诉成立，平台按赔付标准给您补偿 | 文字 | [site-display.ts:387](../../apps/web/src/lib/site-display.ts#L387) |
| `site-display.97059e34` | 写死 | 经核实投诉不成立 | 文字 | [site-display.ts:387](../../apps/web/src/lib/site-display.ts#L387) |
| `site-display.ab110e5e` | 写死 | 已处理 | 文字 | [site-display.ts:388](../../apps/web/src/lib/site-display.ts#L388) |

## Stripe.js 的加载和本站用到的那一小部分类型（stripe-js.ts）

用在：官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/lib/stripe-js.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `stripe-js.659ad8de` | 写死 | Stripe.js 没有加载出来 | 文字 | [stripe-js.ts:67](../../apps/web/src/lib/stripe-js.ts#L67) |

## 时刻、日期的输入整理和「读回来的话」（time-input.ts）

用在：供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/time-input.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `time-input.4a478b10` | 写死 | {rest} 分钟 | 文字 | [time-input.ts:32](../../apps/web/src/lib/time-input.ts#L32) |
| `time-input.831c767b` | 写死 | {hours} 小时 {rest} 分钟 | 文字 | [time-input.ts:32](../../apps/web/src/lib/time-input.ts#L32) |
| `time-input.e637ea0b` | 写死 | {hours} 小时 | 文字 | [time-input.ts:32](../../apps/web/src/lib/time-input.ts#L32) |
| `time-input.d31ec9ba` | 写死 | 全天 24 小时 | 文字 | [time-input.ts:47](../../apps/web/src/lib/time-input.ts#L47) |
| `time-input.86017af9` | 写死 | 每天 {start}–{end}，共 {…} | 文字 | [time-input.ts:48](../../apps/web/src/lib/time-input.ts#L48) |
| `time-input.33687955` | 写死 | 每天 {start}–次日 {end}，共 {…}{…} | 文字 | [time-input.ts:49](../../apps/web/src/lib/time-input.ts#L49) |
| `time-input.78499a50` | 写死 | （跨午夜） | 文字 | [time-input.ts:49](../../apps/web/src/lib/time-input.ts#L49) |
| `time-input.5925e5c1` | 写死 | = {days} 天 {rest} 小时 | 说明 | [time-input.ts:57](../../apps/web/src/lib/time-input.ts#L57) |
| `time-input.8bc2dc5c` | 写死 | = {days} 天 | 说明 | [time-input.ts:57](../../apps/web/src/lib/time-input.ts#L57) |
| `time-input.a8d238bc` | 写死 | {from} 至 {to} | 文字 | [time-input.ts:62](../../apps/web/src/lib/time-input.ts#L62) |
| `time-input.55469bca` | 写死 | 从 {from} 起 | 文字 | [time-input.ts:63](../../apps/web/src/lib/time-input.ts#L63) |
| `time-input.153587e9` | 写死 | 到 {to} 为止 | 文字 | [time-input.ts:64](../../apps/web/src/lib/time-input.ts#L64) |

## 「未覆盖需求」（uncovered-demand-display.ts）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）；运营后台 · 未覆盖需求

文件：`apps/web/src/lib/uncovered-demand-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `uncovered-demand-display.a2827edc` | 写死 | 不在任何运营区域里 | 文字 | [uncovered-demand-display.ts:9](../../apps/web/src/lib/uncovered-demand-display.ts#L9) |
| `uncovered-demand-display.5e85f70c` | 写死 | 在运营区域里，但没有报价区域 | 文字 | [uncovered-demand-display.ts:10](../../apps/web/src/lib/uncovered-demand-display.ts#L10) |
| `uncovered-demand-display.9832599d` | 写死 | 其他原因 | 文字 | [uncovered-demand-display.ts:11](../../apps/web/src/lib/uncovered-demand-display.ts#L11) |
| `uncovered-demand-display.dcf33f5b` | 写死 | 这里没有供应商接单：可以请招商找这一带的供应商，或请现有供应商把运营区域画大一些。 | 文字 | [uncovered-demand-display.ts:16](../../apps/web/src/lib/uncovered-demand-display.ts#L16) |
| `uncovered-demand-display.8142cc97` | 写死 | 有供应商能来，但商品没有勾选覆盖这里的报价区域：可以联系这些供应商补一个报价区域、设好价格。 | 文字 | [uncovered-demand-display.ts:17](../../apps/web/src/lib/uncovered-demand-display.ts#L17) |
| `uncovered-demand-display.f299ada9` | 写死 | 区域没有问题，是别的原因（提前预订不够、售罄、人数超出、没有价格……），见详情里的拒绝原因。 | 文字 | [uncovered-demand-display.ts:18](../../apps/web/src/lib/uncovered-demand-display.ts#L18) |
| `uncovered-demand-display.ce0bc235` | 写死 | 不在运营区域或商品区域里 | 文字 | [uncovered-demand-display.ts:23](../../apps/web/src/lib/uncovered-demand-display.ts#L23) |
| `uncovered-demand-display.54075d7d` | 写死 | 在禁行区里 | 文字 | [uncovered-demand-display.ts:24](../../apps/web/src/lib/uncovered-demand-display.ts#L24) |
| `uncovered-demand-display.e3b24886` | 写死 | 在运营区域里，但商品没有勾选覆盖它的报价区域 | 文字 | [uncovered-demand-display.ts:25](../../apps/web/src/lib/uncovered-demand-display.ts#L25) |
| `uncovered-demand-display.c5557b19` | 写死 | 提前预订时长不够 | 说明 | [uncovered-demand-display.ts:26](../../apps/web/src/lib/uncovered-demand-display.ts#L26) |
| `uncovered-demand-display.6bbcd015` | 写死 | 不在服务时间里 | 文字 | [uncovered-demand-display.ts:27](../../apps/web/src/lib/uncovered-demand-display.ts#L27) |
| `uncovered-demand-display.08a19111` | 写死 | 不在下单有效期里 | 文字 | [uncovered-demand-display.ts:28](../../apps/web/src/lib/uncovered-demand-display.ts#L28) |
| `uncovered-demand-display.cf11b46d` | 写死 | 用车时间已经过去 | 文字 | [uncovered-demand-display.ts:29](../../apps/web/src/lib/uncovered-demand-display.ts#L29) |
| `uncovered-demand-display.6120699a` | 写死 | 库存不足 | 文字 | [uncovered-demand-display.ts:30](../../apps/web/src/lib/uncovered-demand-display.ts#L30) |
| `uncovered-demand-display.7feff321` | 写死 | 加急库存用完 | 文字 | [uncovered-demand-display.ts:31](../../apps/web/src/lib/uncovered-demand-display.ts#L31) |
| `uncovered-demand-display.99d5e5fc` | 写死 | 人数或行李超出车型 | 文字 | [uncovered-demand-display.ts:32](../../apps/web/src/lib/uncovered-demand-display.ts#L32) |
| `uncovered-demand-display.3d0382d3` | 写死 | 没有这个车型组 | 文字 | [uncovered-demand-display.ts:33](../../apps/web/src/lib/uncovered-demand-display.ts#L33) |
| `uncovered-demand-display.0cc97063` | 写死 | 没有价格 | 文字 | [uncovered-demand-display.ts:34](../../apps/web/src/lib/uncovered-demand-display.ts#L34) |
| `uncovered-demand-display.4b80aab8` | 写死 | 价格不在生效期 | 文字 | [uncovered-demand-display.ts:35](../../apps/web/src/lib/uncovered-demand-display.ts#L35) |
| `uncovered-demand-display.07b30a0f` | 写死 | 价格已停用 | 文字 | [uncovered-demand-display.ts:36](../../apps/web/src/lib/uncovered-demand-display.ts#L36) |
| `uncovered-demand-display.18e6795c` | 写死 | 取不到路线 | 文字 | [uncovered-demand-display.ts:37](../../apps/web/src/lib/uncovered-demand-display.ts#L37) |
| `uncovered-demand-display.1f4cc323` | 写死 | 包车没给下车地点 | 提示 | [uncovered-demand-display.ts:38](../../apps/web/src/lib/uncovered-demand-display.ts#L38) |
| `uncovered-demand-display.8c22b79a` | 写死 | 经停点不在任何区域 | 文字 | [uncovered-demand-display.ts:39](../../apps/web/src/lib/uncovered-demand-display.ts#L39) |
| `uncovered-demand-display.fcb34820` | 写死 | 预计用时超过在线下单上限 | 文字 | [uncovered-demand-display.ts:40](../../apps/web/src/lib/uncovered-demand-display.ts#L40) |
| `uncovered-demand-display.2b3d9ba5` | 写死 | 附加服务不提供 | 文字 | [uncovered-demand-display.ts:41](../../apps/web/src/lib/uncovered-demand-display.ts#L41) |
| `uncovered-demand-display.f074e959` | 写死 | 没有可用的汇率 | 文字 | [uncovered-demand-display.ts:42](../../apps/web/src/lib/uncovered-demand-display.ts#L42) |
| `uncovered-demand-display.d31a4d35` | 写死 | 试运营每日上限 | 文字 | [uncovered-demand-display.ts:43](../../apps/web/src/lib/uncovered-demand-display.ts#L43) |
| `uncovered-demand-display.7850f8de` | 写死 | 接机 | 文字 | [uncovered-demand-display.ts:58](../../apps/web/src/lib/uncovered-demand-display.ts#L58) |
| `uncovered-demand-display.c60398de` | 写死 | 送机 | 文字 | [uncovered-demand-display.ts:58](../../apps/web/src/lib/uncovered-demand-display.ts#L58) |
| `uncovered-demand-display.b824d06a` | 写死 | 包车 {package\_hours} 小时 | 文字 | [uncovered-demand-display.ts:59](../../apps/web/src/lib/uncovered-demand-display.ts#L59) |
| `uncovered-demand-display.eb4f6afe` | 写死 | 没有给 | 文字 | [uncovered-demand-display.ts:69](../../apps/web/src/lib/uncovered-demand-display.ts#L69) |
| `uncovered-demand-display.4ac8dd74` | 写死 | 开始日期的写法不对，请写成「年-月-日」。 | 文字 | [uncovered-demand-display.ts:117](../../apps/web/src/lib/uncovered-demand-display.ts#L117) |
| `uncovered-demand-display.5303e910` | 写死 | 结束日期的写法不对，请写成「年-月-日」。 | 文字 | [uncovered-demand-display.ts:118](../../apps/web/src/lib/uncovered-demand-display.ts#L118) |
| `uncovered-demand-display.06298213` | 写死 | 开始日期不能晚于结束日期。 | 文字 | [uncovered-demand-display.ts:120](../../apps/web/src/lib/uncovered-demand-display.ts#L120) |
| `uncovered-demand-display.ba61899d` | 写死 | 日期范围最长 366 天，请缩短。 | 文字 | [uncovered-demand-display.ts:122](../../apps/web/src/lib/uncovered-demand-display.ts#L122) |

## 把一段文字写进剪贴板（use-copy-text.tsx）

用在：供应商后台 · 区域编辑；官网（客人预订） · 订单页（查订单、管理订单）；登录和账号（两个后台共用） · 两步验证；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 账号安全和角色

文件：`apps/web/src/lib/use-copy-text.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `use-copy-text.6b7a7a0e` | 写死 | 已复制 | 提示 | [use-copy-text.tsx:18](../../apps/web/src/lib/use-copy-text.tsx#L18) |
| `use-copy-text.f8b40db0` | 写死 | 没有复制成功 | 标题 | [use-copy-text.tsx:24](../../apps/web/src/lib/use-copy-text.tsx#L24) |
| `use-copy-text.fe6b0da4` | 写死 | 我已经复制好了 | 按钮 | [use-copy-text.tsx:29](../../apps/web/src/lib/use-copy-text.tsx#L29) |
| `use-copy-text.524baa24` | 写死 | 浏览器没有允许自动复制。内容在下面，已经全选好了，请按 Ctrl + C（Mac 上是 ⌘ + C）复制，再粘贴到别处存好。 | 提示 | [use-copy-text.tsx:33](../../apps/web/src/lib/use-copy-text.tsx#L33) |
| `use-copy-text.883ce19f` | 写死 | 要复制的内容 | 表单标签 | [use-copy-text.tsx:38](../../apps/web/src/lib/use-copy-text.tsx#L38) |

## 主题切换（ThemeSwitcher.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 官网外框（页头、页脚、出错页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/theme/ThemeSwitcher.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ThemeSwitcher.2a6b671c` | 写死 | 切换主题 | 名称 | [ThemeSwitcher.tsx:21](../../apps/web/src/theme/ThemeSwitcher.tsx#L21) |

## 主题（theme.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 官网外框（页头、页脚、出错页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/theme/theme.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `theme.2772cbce` | 写死 | 跟随系统 | 名称 | [theme.ts:11](../../apps/web/src/theme/theme.ts#L11) |
| `theme.221df0ba` | 写死 | 亮色 | 名称 | [theme.ts:12](../../apps/web/src/theme/theme.ts#L12) |
| `theme.36bf4150` | 写死 | 暗色 | 名称 | [theme.ts:13](../../apps/web/src/theme/theme.ts#L13) |
