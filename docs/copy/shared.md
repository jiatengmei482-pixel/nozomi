# 前端公共组件和共用文案（第 1 / 2 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 1814 条：写死 1632 条，已走 key 182 条。列的意思见 [README](README.md)。

本区域分 2 份：第 1 份 · [第 2 份](shared-2.md)

## 页面

- [路由表（App.tsx）](#路由表apptsx)（1 条）
- [登录相关接口的客户端（client.ts）](#登录相关接口的客户端clientts)（1 条）
- [账号信息（AccountLoadFailed.tsx）](#账号信息accountloadfailedtsx)（3 条）
- [后台框架（AppShell.tsx）](#后台框架appshelltsx)（63 条）
- [公开数据源的署名（Attribution.tsx）](#公开数据源的署名attributiontsx)（7 条）
- [NOZOMI 品牌标识（Brand.tsx）](#nozomi-品牌标识brandtsx)（1 条）
- [组合框（Combobox.tsx）](#组合框comboboxtsx)（3 条）
- [表格（DataTable.tsx）](#表格datatabletsx)（12 条）
- [对话框（Dialog.tsx）](#对话框dialogtsx)（1 条）
- [入口卡片（EntryCard.tsx）](#入口卡片entrycardtsx)（1 条）
- [整个页面出错（ErrorBoundary.tsx）](#整个页面出错errorboundarytsx)（3 条）
- [站外链接（ExternalLink.tsx）](#站外链接externallinktsx)（1 条）
- [筛选条（FilterBar.tsx）](#筛选条filterbartsx)（6 条）
- [表单里除了普通输入框以外的字段部件（FormFields.tsx）](#表单里除了普通输入框以外的字段部件formfieldstsx)（10 条）
- [两步验证的几块界面（MfaParts.tsx）](#两步验证的几块界面mfapartstsx)（16 条）
- [月历与日期范围选择（MonthGrid.tsx）](#月历与日期范围选择monthgridtsx)（15 条）
- [在新标签页打开的站内链接（NewTabLink.tsx）](#在新标签页打开的站内链接newtablinktsx)（1 条）
- [「写一段说明再提交」的对话框（NoteDialog.tsx）](#写一段说明再提交的对话框notedialogtsx)（4 条）
- [订单详情里的「附加服务」一项（OrderAddons.tsx）](#订单详情里的附加服务一项orderaddonstsx)（4 条）
- [订单详情「行程」卡片里的「用的价格」「计价方式」「公里数」「…（OrderAreaPriceItems.tsx）](#订单详情行程卡片里的用的价格计价方式公里数orderareapriceitemstsx)（5 条）
- [多选面板（PickerPanel.tsx）](#多选面板pickerpaneltsx)（2 条）
- [加载状态与错误状态（States.tsx）](#加载状态与错误状态statestsx)（1 条）
- [状态徽标（StatusBadge.tsx）](#状态徽标statusbadgetsx)（12 条）
- [步骤导航（StepNav.tsx）](#步骤导航stepnavtsx)（2 条）
- [输入框 + 标签 + 帮助说明 + 出错文字（TextField.tsx）](#输入框--标签--帮助说明--出错文字textfieldtsx)（3 条）
- [Toast.tsx](#toasttsx)（1 条）
- [包车行程（TripStops.tsx）](#包车行程tripstopstsx)（4 条）
- [车型标识的 4 项（VehicleLabelFacts.tsx）](#车型标识的-4-项vehiclelabelfactstsx)（1 条）
- [去 WhatsApp 的链接（WhatsappLink.tsx）](#去-whatsapp-的链接whatsapplinktsx)（1 条）
- [调价规则的表单模型和读回的话（adjust-form.ts）](#调价规则的表单模型和读回的话adjust-formts)（52 条）
- [金额输入框里的字 → 一个干净的十进制写法（amount-input.ts）](#金额输入框里的字--一个干净的十进制写法amount-inputts)（6 条）
- [区域地图（area-overview.ts）](#区域地图area-overviewts)（16 条）
- [区域的用途（area-roles.ts）](#区域的用途area-rolests)（19 条）
- [包车「区域加价」块的表格模型（area-surcharge.ts）](#包车区域加价块的表格模型area-surchargets)（33 条）
- [收款账户和银行转账文件在页面上的说法（bank-file-display.ts）](#收款账户和银行转账文件在页面上的说法bank-file-displayts)（12 条）
- [账单和付款批次在页面上的说法（billing-display.ts）](#账单和付款批次在页面上的说法billing-displayts)（22 条）
- [预订页（book-new.ts）](#预订页book-newts)（20 条）
- [渠道、加价规则、双人复核在页面上的写法（channel-display.ts）](#渠道加价规则双人复核在页面上的写法channel-displayts)（160 条）
- [包车机场开始 / 机场结束套餐的固定文案（charter-airport-copy.ts）](#包车机场开始--机场结束套餐的固定文案charter-airport-copyts)（106 条）
- [包车经停点和按行程计价（charter-itinerary.ts）](#包车经停点和按行程计价charter-itineraryts)（37 条）
- [包车三层区域的价格页模型（charter-layers.ts）](#包车三层区域的价格页模型charter-layersts)（32 条）
- [派车、司机 H5、Webhook 页面上的显示（dispatch-display.ts）](#派车司机-h5webhook-页面上的显示dispatch-displayts)（45 条）
- [distance.ts](#distancets)（2 条）
- [把一次失败的请求变成给用户看的话（failure.ts）](#把一次失败的请求变成给用户看的话failurets)（5 条）
- [免费等待按航班定（free-wait-display.ts）](#免费等待按航班定free-wait-displayts)（24 条）
- [汇率页、首页的显示规则（fx-display.ts）](#汇率页首页的显示规则fx-displayts)（35 条）
- [库存日历每一格的话、改一天和批量设置的表单、导入页的文字（inventory-form.ts）](#库存日历每一格的话改一天和批量设置的表单导入页的文字inventory-formts)（74 条）
- [包车行程地图和编号（itinerary-texts.ts）](#包车行程地图和编号itinerary-textsts)（52 条）
- [主数据各种值在界面上的写法（master-display.ts）](#主数据各种值在界面上的写法master-displayts)（29 条）
- [两步验证的文案（mfa-display.ts）](#两步验证的文案mfa-displayts)（14 条）
- [运营审核 no-show 时看的证据（no-show-evidence.ts）](#运营审核-no-show-时看的证据no-show-evidencets)（37 条）
- [供应商入驻（onboarding-display.ts）](#供应商入驻onboarding-displayts)（97 条）
- [订单详情「行程」卡片里的区域价说明（order-area-price-display.ts）](#订单详情行程卡片里的区域价说明order-area-price-displayts)（19 条）
- [订单中心（order-center-display.ts）](#订单中心order-center-displayts)（53 条）
- [取消、改单、事后加收、取消政策在页面上的说法（order-money-display.ts）](#取消改单事后加收取消政策在页面上的说法order-money-displayts)（74 条）
- [付款组件的接入点（payment-driver.ts）](#付款组件的接入点payment-driverts)（4 条）
- [Stripe 的付款错误 → 给客人看的中文（payment-errors.ts）](#stripe-的付款错误--给客人看的中文payment-errorsts)（19 条）
- [运营后台「供应商、平台员工」各页面共用的文字和校验（platform-display.ts）](#运营后台供应商平台员工各页面共用的文字和校验platform-displayts)（78 条）
- [两个后台（portal.ts）](#两个后台portalts)（4 条）
- [价格日历的月份、格子和选日期（price-calendar.ts）](#价格日历的月份格子和选日期price-calendarts)（7 条）

## 路由表（App.tsx）

文件：`apps/web/src/App.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `App.27124ffe` | 写死 | 正在打开行程报价页 | 名称 | [App.tsx:125](../../apps/web/src/App.tsx#L125) |

## 登录相关接口的客户端（client.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/api/client.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `client.0785929c` | 写死 | 网络连接失败 | 文字 | [client.ts:49](../../apps/web/src/api/client.ts#L49) |

## 账号信息（AccountLoadFailed.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）；运营后台 · 报价试算；运营后台 · 渠道

文件：`apps/web/src/components/AccountLoadFailed.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AccountLoadFailed.ce0341d6` | 写死 | 加载失败 | 标题 | [AccountLoadFailed.tsx:12](../../apps/web/src/components/AccountLoadFailed.tsx#L12) |
| `AccountLoadFailed.d54bfbd2` | 写死 | 请检查网络后重试。 | 说明 | [AccountLoadFailed.tsx:13](../../apps/web/src/components/AccountLoadFailed.tsx#L13) |
| `AccountLoadFailed.04dd86e5` | 写死 | 重试 | 按钮 | [AccountLoadFailed.tsx:17](../../apps/web/src/components/AccountLoadFailed.tsx#L17) |

## 后台框架（AppShell.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/components/AppShell.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AppShell.01310034` | 写死 | 首页 | 名称 | [AppShell.tsx:53](../../apps/web/src/components/AppShell.tsx#L53) |
| `AppShell.7e535b95` | 写死 | 供应商 | 名称 | [AppShell.tsx:54](../../apps/web/src/components/AppShell.tsx#L54) |
| `AppShell.e08e7115` | 写死 | 资质审核 | 名称 | [AppShell.tsx:55](../../apps/web/src/components/AppShell.tsx#L55) |
| `AppShell.a19c6540` | 写死 | 商品 | 名称 | [AppShell.tsx:56](../../apps/web/src/components/AppShell.tsx#L56)、125 行 |
| `AppShell.8e8916ae` | 写死 | 区域地图 | 名称 | [AppShell.tsx:58](../../apps/web/src/components/AppShell.tsx#L58) |
| `AppShell.bfaf2057` | 写死 | 报价试算 | 名称 | [AppShell.tsx:59](../../apps/web/src/components/AppShell.tsx#L59) |
| `AppShell.e3c8fb0c` | 写死 | 未覆盖需求 | 名称 | [AppShell.tsx:61](../../apps/web/src/components/AppShell.tsx#L61) |
| `AppShell.60719d4e` | 写死 | 渠道 | 名称 | [AppShell.tsx:62](../../apps/web/src/components/AppShell.tsx#L62) |
| `AppShell.67a9995d` | 写死 | 嵌入组件 | 名称 | [AppShell.tsx:64](../../apps/web/src/components/AppShell.tsx#L64) |
| `AppShell.c66927a3` | 写死 | 待审核 | 名称 | [AppShell.tsx:65](../../apps/web/src/components/AppShell.tsx#L65) |
| `AppShell.cfe8dbbc` | 写死 | 订单 | 名称 | [AppShell.tsx:66](../../apps/web/src/components/AppShell.tsx#L66)、128 行 |
| `AppShell.109af5ce` | 写死 | 异常队列 | 名称 | [AppShell.tsx:68](../../apps/web/src/components/AppShell.tsx#L68) |
| `AppShell.7fa647dc` | 写死 | 工单 | 名称 | [AppShell.tsx:69](../../apps/web/src/components/AppShell.tsx#L69)、133 行 |
| `AppShell.b53b8857` | 写死 | 人工报价 | 名称 | [AppShell.tsx:71](../../apps/web/src/components/AppShell.tsx#L71) |
| `AppShell.b73611c3` | 写死 | 救援 | 名称 | [AppShell.tsx:73](../../apps/web/src/components/AppShell.tsx#L73) |
| `AppShell.a3db04c5` | 写死 | 取消政策 | 名称 | [AppShell.tsx:75](../../apps/web/src/components/AppShell.tsx#L75) |
| `AppShell.5038b870` | 写死 | 赔付表 | 名称 | [AppShell.tsx:76](../../apps/web/src/components/AppShell.tsx#L76) |
| `AppShell.bd3f682e` | 写死 | 推送记录 | 名称 | [AppShell.tsx:77](../../apps/web/src/components/AppShell.tsx#L77) |
| `AppShell.470c7d40` | 写死 | 通知中心 | 名称 | [AppShell.tsx:80](../../apps/web/src/components/AppShell.tsx#L80) |
| `AppShell.8ed83f31` | 写死 | 通知记录 | 名称 | [AppShell.tsx:80](../../apps/web/src/components/AppShell.tsx#L80) |
| `AppShell.d0db52a4` | 写死 | 通知模板 | 名称 | [AppShell.tsx:80](../../apps/web/src/components/AppShell.tsx#L80) |
| `AppShell.6efe1820` | 写死 | 财务结算 | 名称 | [AppShell.tsx:86](../../apps/web/src/components/AppShell.tsx#L86) |
| `AppShell.d5adca56` | 写死 | 账单 | 名称 | [AppShell.tsx:89](../../apps/web/src/components/AppShell.tsx#L89)、134 行 |
| `AppShell.51d3ff5c` | 写死 | 付款批次 | 名称 | [AppShell.tsx:90](../../apps/web/src/components/AppShell.tsx#L90) |
| `AppShell.ebe03a25` | 写死 | 收款账户 | 名称 | [AppShell.tsx:91](../../apps/web/src/components/AppShell.tsx#L91) |
| `AppShell.e7957cf6` | 写死 | 主数据 | 名称 | [AppShell.tsx:98](../../apps/web/src/components/AppShell.tsx#L98) |
| `AppShell.1eb300ec` | 写死 | 城市 | 名称 | [AppShell.tsx:101](../../apps/web/src/components/AppShell.tsx#L101) |
| `AppShell.6535f17c` | 写死 | 地点 | 名称 | [AppShell.tsx:102](../../apps/web/src/components/AppShell.tsx#L102) |
| `AppShell.92f52517` | 写死 | 车型组 | 名称 | [AppShell.tsx:103](../../apps/web/src/components/AppShell.tsx#L103) |
| `AppShell.761a98a3` | 写死 | 附加服务 | 名称 | [AppShell.tsx:104](../../apps/web/src/components/AppShell.tsx#L104) |
| `AppShell.b46928ff` | 写死 | 汇率 | 名称 | [AppShell.tsx:105](../../apps/web/src/components/AppShell.tsx#L105) |
| `AppShell.60a29c94` | 写死 | 共享区域 | 名称 | [AppShell.tsx:107](../../apps/web/src/components/AppShell.tsx#L107) |
| `AppShell.e8459459` | 写死 | 平台员工 | 名称 | [AppShell.tsx:114](../../apps/web/src/components/AppShell.tsx#L114) |
| `AppShell.6b18ae98` | 写死 | 角色 | 名称 | [AppShell.tsx:115](../../apps/web/src/components/AppShell.tsx#L115) |
| `AppShell.0af0dd6e` | 写死 | 审计日志 | 名称 | [AppShell.tsx:116](../../apps/web/src/components/AppShell.tsx#L116) |
| `AppShell.45520825` | 写死 | 系统状态 | 名称 | [AppShell.tsx:117](../../apps/web/src/components/AppShell.tsx#L117) |
| `AppShell.c64fdcee` | 写死 | 官网设置 | 名称 | [AppShell.tsx:118](../../apps/web/src/components/AppShell.tsx#L118) |
| `AppShell.2a2b543e` | 写死 | 系统设置 | 名称 | [AppShell.tsx:120](../../apps/web/src/components/AppShell.tsx#L120) |
| `AppShell.dfc21b91` | 写死 | 区域 | 名称 | [AppShell.tsx:124](../../apps/web/src/components/AppShell.tsx#L124) |
| `AppShell.1cab697b` | 写死 | 价格规则 | 名称 | [AppShell.tsx:125](../../apps/web/src/components/AppShell.tsx#L125) |
| `AppShell.5f4e4bbc` | 写死 | 商品配置 | 名称 | [AppShell.tsx:127](../../apps/web/src/components/AppShell.tsx#L127) |
| `AppShell.9b4d66d1` | 写死 | 救援单 | 名称 | [AppShell.tsx:130](../../apps/web/src/components/AppShell.tsx#L130) |
| `AppShell.ad4fdf54` | 写死 | 违约金与扣款 | 名称 | [AppShell.tsx:131](../../apps/web/src/components/AppShell.tsx#L131) |
| `AppShell.793c6011` | 写死 | 司机 | 名称 | [AppShell.tsx:135](../../apps/web/src/components/AppShell.tsx#L135) |
| `AppShell.f80fa932` | 写死 | 车辆 | 名称 | [AppShell.tsx:135](../../apps/web/src/components/AppShell.tsx#L135) |
| `AppShell.e2827c63` | 写死 | 车队 | 名称 | [AppShell.tsx:136](../../apps/web/src/components/AppShell.tsx#L136) |
| `AppShell.fc7133ba` | 写死 | 企业资质 | 名称 | [AppShell.tsx:138](../../apps/web/src/components/AppShell.tsx#L138) |
| `AppShell.46fde615` | 写死 | 履约评分 | 名称 | [AppShell.tsx:139](../../apps/web/src/components/AppShell.tsx#L139) |
| `AppShell.45a8bc89` | 写死 | 企业信息 | 名称 | [AppShell.tsx:142](../../apps/web/src/components/AppShell.tsx#L142) |
| `AppShell.5742515b` | 写死 | 调度对接（Webhook） | 名称 | [AppShell.tsx:143](../../apps/web/src/components/AppShell.tsx#L143) |
| `AppShell.3e07b4d7` | 写死 | 通知 | 名称 | [AppShell.tsx:144](../../apps/web/src/components/AppShell.tsx#L144) |
| `AppShell.af36ee85` | 写死 | 设置 | 名称 | [AppShell.tsx:146](../../apps/web/src/components/AppShell.tsx#L146) |
| `AppShell.fcf8674c` | 写死 | {total} 条待办 | 读屏说明 | [AppShell.tsx:166](../../apps/web/src/components/AppShell.tsx#L166) |
| `AppShell.058b52e5` | 写死 | 正在加载菜单 | 名称 | [AppShell.tsx:232](../../apps/web/src/components/AppShell.tsx#L232) |
| `AppShell.a5c4c6aa` | 写死 | 主菜单 | 读屏说明 | [AppShell.tsx:243](../../apps/web/src/components/AppShell.tsx#L243)、363 行 |
| `AppShell.d58e0b10` | 写死 | 账号菜单： | 正文 | [AppShell.tsx:269](../../apps/web/src/components/AppShell.tsx#L269) |
| `AppShell.88dfce4a` | 写死 | 账号 | 正文 | [AppShell.tsx:270](../../apps/web/src/components/AppShell.tsx#L270) |
| `AppShell.58fd34b7` | 写死 | 账号安全 | 正文 | [AppShell.tsx:285](../../apps/web/src/components/AppShell.tsx#L285) |
| `AppShell.bf36130e` | 写死 | 修改密码 | 正文 | [AppShell.tsx:290](../../apps/web/src/components/AppShell.tsx#L290) |
| `AppShell.83b97d24` | 写死 | 退出登录 | 正文 | [AppShell.tsx:304](../../apps/web/src/components/AppShell.tsx#L304) |
| `AppShell.208f0c22` | 写死 | 跳到正文 | 链接 | [AppShell.tsx:354](../../apps/web/src/components/AppShell.tsx#L354) |
| `AppShell.024405bd` | 写死 | 打开菜单 | 名称 | [AppShell.tsx:389](../../apps/web/src/components/AppShell.tsx#L389) |
| `AppShell.4ef6b457` | 写死 | 当前位置 | 读屏说明 | [AppShell.tsx:399](../../apps/web/src/components/AppShell.tsx#L399) |

## 公开数据源的署名（Attribution.tsx）

用在：供应商后台 · 价格规则总览；供应商后台 · 区域列表；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；官网（客人预订） · 官网外框（页头、页脚、出错页）；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 报价试算；运营后台 · 渠道

文件：`apps/web/src/components/Attribution.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `Attribution.70663dd4` | 写死 | GeoNames | 链接 | [Attribution.tsx:12](../../apps/web/src/components/Attribution.tsx#L12) |
| `Attribution.8d679fa8` | 写死 | （geonames.org）， | 正文 | [Attribution.tsx:12](../../apps/web/src/components/Attribution.tsx#L12) |
| `Attribution.adbdeeba` | 写死 | CC BY 4.0 | 链接 | [Attribution.tsx:12](../../apps/web/src/components/Attribution.tsx#L12) |
| `Attribution.e39de720` | 写死 | 城市数据和机场的中文、日文名称来自 | 正文 | [Attribution.tsx:12](../../apps/web/src/components/Attribution.tsx#L12) |
| `Attribution.7cd7ff21` | 写死 | OurAirports | 链接 | [Attribution.tsx:16](../../apps/web/src/components/Attribution.tsx#L16) |
| `Attribution.95deadcd` | 写死 | （ourairports.com），公有领域 | 正文 | [Attribution.tsx:16](../../apps/web/src/components/Attribution.tsx#L16) |
| `Attribution.c22798c5` | 写死 | 机场数据来自 | 正文 | [Attribution.tsx:16](../../apps/web/src/components/Attribution.tsx#L16) |

## NOZOMI 品牌标识（Brand.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 官网外框（页头、页脚、出错页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/components/Brand.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `Brand.256c127f` | 写死 | NOZOMI | 正文 | [Brand.tsx:22](../../apps/web/src/components/Brand.tsx#L22) |

## 组合框（Combobox.tsx）

用在：供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/components/Combobox.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `Combobox.b508d16b` | 写死 | 加载中… | 正文 | [Combobox.tsx:213](../../apps/web/src/components/Combobox.tsx#L213) |
| `Combobox.d779dd45` | 写死 | 加载失败 | 正文 | [Combobox.tsx:214](../../apps/web/src/components/Combobox.tsx#L214) |
| `Combobox.082f7821` | 写死 | 没有匹配的选项 | 正文 | [Combobox.tsx:215](../../apps/web/src/components/Combobox.tsx#L215) |

## 表格（DataTable.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 区域列表；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；运营后台 · 主数据 · 地点；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 商品（只读查看）；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 收款账户审核和银行文件；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 资质审核

文件：`apps/web/src/components/DataTable.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `DataTable.96f27506` | 写死 | 加载中 | 正文 | [DataTable.tsx:100](../../apps/web/src/components/DataTable.tsx#L100) |
| `DataTable.d7c78cf3` | 写死 | 加载失败 | 标题 | [DataTable.tsx:104](../../apps/web/src/components/DataTable.tsx#L104) |
| `DataTable.4d23e600` | 写死 | 请检查网络后重试。 | 说明 | [DataTable.tsx:105](../../apps/web/src/components/DataTable.tsx#L105) |
| `DataTable.8fbbfc70` | 写死 | 重试 | 按钮 | [DataTable.tsx:109](../../apps/web/src/components/DataTable.tsx#L109) |
| `DataTable.94cf4993` | 写死 | 你没有权限查看这里 | 标题 | [DataTable.tsx:113](../../apps/web/src/components/DataTable.tsx#L113) |
| `DataTable.9a1e7d2c` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [DataTable.tsx:113](../../apps/web/src/components/DataTable.tsx#L113) |
| `DataTable.fa477f23` | 写死 | 分页 | 读屏说明 | [DataTable.tsx:135](../../apps/web/src/components/DataTable.tsx#L135) |
| `DataTable.890a7f35` | 写死 | 共 {…} 条 | 正文 | [DataTable.tsx:137](../../apps/web/src/components/DataTable.tsx#L137) |
| `DataTable.577c936c` | 写死 | 每页 | 表单标签 | [DataTable.tsx:140](../../apps/web/src/components/DataTable.tsx#L140) |
| `DataTable.c42fdc76` | 写死 | 条 | 表单标签 | [DataTable.tsx:148](../../apps/web/src/components/DataTable.tsx#L148) |
| `DataTable.d0e36479` | 写死 | 上一页 | 按钮 | [DataTable.tsx:153](../../apps/web/src/components/DataTable.tsx#L153) |
| `DataTable.abf879fe` | 写死 | 下一页 | 按钮 | [DataTable.tsx:156](../../apps/web/src/components/DataTable.tsx#L156) |

## 对话框（Dialog.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；官网（客人预订） · 订单页（查订单、管理订单）；登录和账号（两个后台共用） · 两步验证；运营后台 · 主数据 · 地点；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色

文件：`apps/web/src/components/Dialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `Dialog.fa130520` | 写死 | 关闭 | 读屏说明 | [Dialog.tsx:82](../../apps/web/src/components/Dialog.tsx#L82) |

## 入口卡片（EntryCard.tsx）

用在：供应商后台 · 首页；运营后台 · 首页

文件：`apps/web/src/components/EntryCard.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `EntryCard.2ecd72dd` | 写死 | 数量没有加载出来 | 正文 | [EntryCard.tsx:52](../../apps/web/src/components/EntryCard.tsx#L52) |

## 整个页面出错（ErrorBoundary.tsx）

文件：`apps/web/src/components/ErrorBoundary.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ErrorBoundary.6a679327` | 写死 | 页面出了点问题 | 标题 | [ErrorBoundary.tsx:19](../../apps/web/src/components/ErrorBoundary.tsx#L19) |
| `ErrorBoundary.0b313a9f` | 写死 | 请刷新重试。如果一直这样，请联系管理员。 | 说明 | [ErrorBoundary.tsx:20](../../apps/web/src/components/ErrorBoundary.tsx#L20) |
| `ErrorBoundary.ac27ee6a` | 写死 | 刷新页面 | 按钮 | [ErrorBoundary.tsx:24](../../apps/web/src/components/ErrorBoundary.tsx#L24) |

## 站外链接（ExternalLink.tsx）

用在：供应商后台 · 价格规则总览；供应商后台 · 区域列表；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；官网（客人预订） · 官网外框（页头、页脚、出错页）；运营后台 · 主数据 · 地点；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 报价试算；运营后台 · 渠道

文件：`apps/web/src/components/ExternalLink.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ExternalLink.359d4f02` | 写死 | （在新标签页打开） | 正文 | [ExternalLink.tsx:14](../../apps/web/src/components/ExternalLink.tsx#L14) |

## 筛选条（FilterBar.tsx）

用在：供应商后台 · 价格规则总览；供应商后台 · 区域列表；供应商后台 · 商品列表；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 商品（只读查看）；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 未覆盖需求；运营后台 · 渠道；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）

文件：`apps/web/src/components/FilterBar.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FilterBar.aa18ec31` | 写死 | 清除搜索 | 读屏说明 | [FilterBar.tsx:81](../../apps/web/src/components/FilterBar.tsx#L81) |
| `FilterBar.4cf5dbd1` | 写死 | 筛选 · {activeCount} | 按钮 | [FilterBar.tsx:155](../../apps/web/src/components/FilterBar.tsx#L155) |
| `FilterBar.5f2a4bc4` | 写死 | 筛选 | 按钮 | [FilterBar.tsx:155](../../apps/web/src/components/FilterBar.tsx#L155)、166 行 |
| `FilterBar.fe407cd8` | 写死 | 清空筛选 | 按钮 | [FilterBar.tsx:162](../../apps/web/src/components/FilterBar.tsx#L162) |
| `FilterBar.be082903` | 写死 | 清空 | 按钮 | [FilterBar.tsx:172](../../apps/web/src/components/FilterBar.tsx#L172) |
| `FilterBar.55df5c83` | 写死 | 查看结果 | 按钮 | [FilterBar.tsx:175](../../apps/web/src/components/FilterBar.tsx#L175) |

## 表单里除了普通输入框以外的字段部件（FormFields.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核

文件：`apps/web/src/components/FormFields.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FormFields.a6da98be` | 写死 | 已复制 | 提示 | [FormFields.tsx:278](../../apps/web/src/components/FormFields.tsx#L278) |
| `FormFields.98433987` | 写死 | 编码 {…} | 表单标签 | [FormFields.tsx:314](../../apps/web/src/components/FormFields.tsx#L314) |
| `FormFields.b913bde3` | 写死 | 复制编码 | 名称 | [FormFields.tsx:343](../../apps/web/src/components/FormFields.tsx#L343) |
| `FormFields.d6473f92` | 写死 | 编码创建后不能修改。 | 正文 | [FormFields.tsx:347](../../apps/web/src/components/FormFields.tsx#L347) |
| `FormFields.54fc7b07` | 写死 | 纬度 | 名称 | [FormFields.tsx:377](../../apps/web/src/components/FormFields.tsx#L377)、443 行 |
| `FormFields.d65b4dc5` | 写死 | 经度 | 名称 | [FormFields.tsx:377](../../apps/web/src/components/FormFields.tsx#L377)、444 行 |
| `FormFields.3694193a` | 写死 | 请输入{name} | 文字 | [FormFields.tsx:379](../../apps/web/src/components/FormFields.tsx#L379) |
| `FormFields.82c87c10` | 写死 | {name}要填数字，例如 {…} | 文字 | [FormFields.tsx:380](../../apps/web/src/components/FormFields.tsx#L380) |
| `FormFields.7690ad76` | 写死 | {name}必须在 -{limit} 到 {limit} 之间 | 文字 | [FormFields.tsx:382](../../apps/web/src/components/FormFields.tsx#L382) |
| `FormFields.0d8b6a93` | 写死 | 看起来是经度在前，已自动对调。请核对。 | 正文 | [FormFields.tsx:446](../../apps/web/src/components/FormFields.tsx#L446) |

## 两步验证的几块界面（MfaParts.tsx）

用在：登录和账号（两个后台共用） · 两步验证；运营后台 · 账号安全和角色

文件：`apps/web/src/components/MfaParts.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `MfaParts.22e05160` | 写死 | 动态码 | 文字 | [MfaParts.tsx:16](../../apps/web/src/components/MfaParts.tsx#L16) |
| `MfaParts.728aa5b4` | 写死 | 打开手机上的验证器 App，输入「NOZOMI 运营后台」这一项现在显示的 6 位数字。 | 说明 | [MfaParts.tsx:32](../../apps/web/src/components/MfaParts.tsx#L32) |
| `MfaParts.235fff1f` | 写死 | 在手机上装一个验证器 App（如 Google Authenticator、Microsoft Authenticator，或你在用的密码管理器）。 | 正文 | [MfaParts.tsx:56](../../apps/web/src/components/MfaParts.tsx#L56) |
| `MfaParts.59a91f15` | 写死 | 用它扫下面的二维码。扫不了的话，选「手动输入」，把下面的密钥输进去。 | 正文 | [MfaParts.tsx:58](../../apps/web/src/components/MfaParts.tsx#L58) |
| `MfaParts.fabca725` | 写死 | 绑定两步验证的二维码 | 名称 | [MfaParts.tsx:60](../../apps/web/src/components/MfaParts.tsx#L60) |
| `MfaParts.61d370ba` | 写死 | 密钥 | 正文 | [MfaParts.tsx:63](../../apps/web/src/components/MfaParts.tsx#L63) |
| `MfaParts.24246ea4` | 写死 | 输入 App 里显示的 6 位数字，完成绑定。 | 正文 | [MfaParts.tsx:67](../../apps/web/src/components/MfaParts.tsx#L67) |
| `MfaParts.9e9c201c` | 写死 | 正在绑定… | 文字 | [MfaParts.tsx:71](../../apps/web/src/components/MfaParts.tsx#L71) |
| `MfaParts.3c3d23e9` | 写死 | 完成绑定 | 按钮 | [MfaParts.tsx:73](../../apps/web/src/components/MfaParts.tsx#L73) |
| `MfaParts.f5ccbc17` | 写死 | 继续 | 文字 | [MfaParts.tsx:79](../../apps/web/src/components/MfaParts.tsx#L79) |
| `MfaParts.b072191b` | 写死 | 这些恢复码只显示这一次。 | 正文 | [MfaParts.tsx:97](../../apps/web/src/components/MfaParts.tsx#L97) |
| `MfaParts.b7c407c6` | 写死 | 手机丢了或验证器打不开时，登录时可以用其中一个代替动态码，每个只能用一次。请现在就存在只有你自己能打开的地方。 | 正文 | [MfaParts.tsx:98](../../apps/web/src/components/MfaParts.tsx#L98) |
| `MfaParts.e42a6660` | 写死 | 恢复码 | 读屏说明 | [MfaParts.tsx:100](../../apps/web/src/components/MfaParts.tsx#L100) |
| `MfaParts.f884ebbe` | 写死 | 复制 | 按钮 | [MfaParts.tsx:110](../../apps/web/src/components/MfaParts.tsx#L110) |
| `MfaParts.d3440557` | 写死 | 存成文件 | 按钮 | [MfaParts.tsx:113](../../apps/web/src/components/MfaParts.tsx#L113) |
| `MfaParts.f5a2d882` | 写死 | 我已经把恢复码存好了 | 正文 | [MfaParts.tsx:117](../../apps/web/src/components/MfaParts.tsx#L117) |

## 月历与日期范围选择（MonthGrid.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/components/MonthGrid.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `MonthGrid.6a48e10b` | 写死 | {…} 月 {…} 日 | 标题 | [MonthGrid.tsx:185](../../apps/web/src/components/MonthGrid.tsx#L185) |
| `MonthGrid.eab138f6` | 写死 | {…} 月 {…} 日 – {…} 日 | 标题 | [MonthGrid.tsx:185](../../apps/web/src/components/MonthGrid.tsx#L185) |
| `MonthGrid.4282ea0b` | 写死 | 终点 | 文字 | [MonthGrid.tsx:194](../../apps/web/src/components/MonthGrid.tsx#L194) |
| `MonthGrid.9bb32397` | 写死 | 起点 | 文字 | [MonthGrid.tsx:194](../../apps/web/src/components/MonthGrid.tsx#L194) |
| `MonthGrid.c24214de` | 写死 | 今天， | 文字 | [MonthGrid.tsx:194](../../apps/web/src/components/MonthGrid.tsx#L194) |
| `MonthGrid.d02f5e33` | 写死 | ，已选 | 文字 | [MonthGrid.tsx:194](../../apps/web/src/components/MonthGrid.tsx#L194) |
| `MonthGrid.e56c4b93` | 写死 | ，选中的{…} | 文字 | [MonthGrid.tsx:194](../../apps/web/src/components/MonthGrid.tsx#L194) |
| `MonthGrid.7f37c749` | 写死 | 今天 | 正文 | [MonthGrid.tsx:224](../../apps/web/src/components/MonthGrid.tsx#L224) |
| `MonthGrid.1c19d1af` | 写死 | 周四 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.2701e6b7` | 写死 | 周六 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.42910b28` | 写死 | 周二 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.69540dd6` | 写死 | 周三 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.79ba24d4` | 写死 | 周一 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.c6328e7e` | 写死 | 周五 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |
| `MonthGrid.dc8fab92` | 写死 | 周日 | 正文 | [MonthGrid.tsx:235](../../apps/web/src/components/MonthGrid.tsx#L235) |

## 在新标签页打开的站内链接（NewTabLink.tsx）

用在：供应商后台 · 商品编辑；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 商品（只读查看）

文件：`apps/web/src/components/NewTabLink.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `NewTabLink.129b7811` | 写死 | （在新标签页打开） | 正文 | [NewTabLink.tsx:19](../../apps/web/src/components/NewTabLink.tsx#L19) |

## 「写一段说明再提交」的对话框（NoteDialog.tsx）

用在：供应商后台 · 账单；运营后台 · 共享区域去重；运营后台 · 工单详情；运营后台 · 异常队列；运营后台 · 收款账户审核和银行文件；运营后台 · 财务结算（账单、付款批次）

文件：`apps/web/src/components/NoteDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `NoteDialog.9a46b134` | 写死 | 请写{label} | 错误提示 | [NoteDialog.tsx:54](../../apps/web/src/components/NoteDialog.tsx#L54) |
| `NoteDialog.8734a8f6` | 写死 | {…}你写的内容还在。 | 文字 | [NoteDialog.tsx:65](../../apps/web/src/components/NoteDialog.tsx#L65) |
| `NoteDialog.168859b5` | 写死 | 知道了 | 按钮 | [NoteDialog.tsx:81](../../apps/web/src/components/NoteDialog.tsx#L81) |
| `NoteDialog.ef4866ff` | 写死 | 取消 | 按钮 | [NoteDialog.tsx:81](../../apps/web/src/components/NoteDialog.tsx#L81) |

## 订单详情里的「附加服务」一项（OrderAddons.tsx）

用在：供应商后台 · 订单（列表、详情）；运营后台 · 订单（列表、详情）

文件：`apps/web/src/components/OrderAddons.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OrderAddons.88be7db1` | 写死 | 已删除的附加服务 | 名称 | [OrderAddons.tsx:20](../../apps/web/src/components/OrderAddons.tsx#L20) |
| `OrderAddons.be089096` | 写死 | 附加服务 {…} | 名称 | [OrderAddons.tsx:20](../../apps/web/src/components/OrderAddons.tsx#L20) |
| `OrderAddons.84830c42` | 写死 | 附加服务 | 正文 | [OrderAddons.tsx:33](../../apps/web/src/components/OrderAddons.tsx#L33) |
| `OrderAddons.f872a5fd` | 写死 | 正在读取附加服务… | 正文 | [OrderAddons.tsx:34](../../apps/web/src/components/OrderAddons.tsx#L34) |

## 订单详情「行程」卡片里的「用的价格」「计价方式」「公里数」「…（OrderAreaPriceItems.tsx）

用在：供应商后台 · 订单（列表、详情）；运营后台 · 订单（列表、详情）

文件：`apps/web/src/components/OrderAreaPriceItems.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OrderAreaPriceItems.2cfe6a12` | 写死 | 用的价格 | 名称 | [OrderAreaPriceItems.tsx:71](../../apps/web/src/components/OrderAreaPriceItems.tsx#L71) |
| `OrderAreaPriceItems.686784e5` | 写死 | 计价方式 | 名称 | [OrderAreaPriceItems.tsx:73](../../apps/web/src/components/OrderAreaPriceItems.tsx#L73) |
| `OrderAreaPriceItems.0a1977a4` | 写死 | 公里数 | 名称 | [OrderAreaPriceItems.tsx:78](../../apps/web/src/components/OrderAreaPriceItems.tsx#L78)、87 行 |
| `OrderAreaPriceItems.e294a9dd` | 写死 | 区域加价 | 名称 | [OrderAreaPriceItems.tsx:95](../../apps/web/src/components/OrderAreaPriceItems.tsx#L95) |
| `OrderAreaPriceItems.001f1d33` | 写死 | 超公里 / 超时 | 名称 | [OrderAreaPriceItems.tsx:100](../../apps/web/src/components/OrderAreaPriceItems.tsx#L100) |

## 多选面板（PickerPanel.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/components/PickerPanel.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PickerPanel.7c369f31` | 写死 | 没有匹配的选项 | 正文 | [PickerPanel.tsx:71](../../apps/web/src/components/PickerPanel.tsx#L71) |
| `PickerPanel.0853af68` | 写死 | 完成 | 按钮 | [PickerPanel.tsx:97](../../apps/web/src/components/PickerPanel.tsx#L97) |

## 加载状态与错误状态（States.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据 · 地点；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/components/States.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `States.5ccffd11` | 写死 | 加载中 | 文字 | [States.tsx:8](../../apps/web/src/components/States.tsx#L8) |

## 状态徽标（StatusBadge.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/components/StatusBadge.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `StatusBadge.57f30f43` | 写死 | 申请中 | 名称 | [StatusBadge.tsx:18](../../apps/web/src/components/StatusBadge.tsx#L18) |
| `StatusBadge.f9f52900` | 写死 | 审核中 | 名称 | [StatusBadge.tsx:19](../../apps/web/src/components/StatusBadge.tsx#L19) |
| `StatusBadge.3bd96d52` | 写死 | 已签约 | 名称 | [StatusBadge.tsx:20](../../apps/web/src/components/StatusBadge.tsx#L20) |
| `StatusBadge.d86cab9f` | 写死 | 试运营 | 名称 | [StatusBadge.tsx:21](../../apps/web/src/components/StatusBadge.tsx#L21) |
| `StatusBadge.7541b915` | 写死 | 正常 | 名称 | [StatusBadge.tsx:22](../../apps/web/src/components/StatusBadge.tsx#L22) |
| `StatusBadge.9fcd1b76` | 写死 | 已暂停 | 名称 | [StatusBadge.tsx:23](../../apps/web/src/components/StatusBadge.tsx#L23) |
| `StatusBadge.e86d1303` | 写死 | 已清退 | 名称 | [StatusBadge.tsx:24](../../apps/web/src/components/StatusBadge.tsx#L24) |
| `StatusBadge.5a3411df` | 写死 | 测试 | 名称 | [StatusBadge.tsx:28](../../apps/web/src/components/StatusBadge.tsx#L28) |
| `StatusBadge.9258cebe` | 写死 | 待派车 | 名称 | [StatusBadge.tsx:42](../../apps/web/src/components/StatusBadge.tsx#L42) |
| `StatusBadge.3fe1e24b` | 写死 | 等待投递 | 名称 | [StatusBadge.tsx:68](../../apps/web/src/components/StatusBadge.tsx#L68) |
| `StatusBadge.4eadd8df` | 写死 | 成功 | 名称 | [StatusBadge.tsx:69](../../apps/web/src/components/StatusBadge.tsx#L69) |
| `StatusBadge.93021ede` | 写死 | 失败 | 名称 | [StatusBadge.tsx:70](../../apps/web/src/components/StatusBadge.tsx#L70) |

## 步骤导航（StepNav.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/components/StepNav.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `StepNav.fdaa1174` | 写死 | 第 {number} 步， | 正文 | [StepNav.tsx:49](../../apps/web/src/components/StepNav.tsx#L49) |
| `StepNav.bb3b3b4e` | 写死 | 第 {number} 步，共 {length} 步 · {name}{statusText} | 说明 | [StepNav.tsx:76](../../apps/web/src/components/StepNav.tsx#L76) |

## 输入框 + 标签 + 帮助说明 + 出错文字（TextField.tsx）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表

文件：`apps/web/src/components/TextField.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TextField.524a6063` | 写死 | 密码 | 文字 | [TextField.tsx:70](../../apps/web/src/components/TextField.tsx#L70) |
| `TextField.bb381edc` | 写死 | 隐藏{noun} | 读屏说明 | [TextField.tsx:97](../../apps/web/src/components/TextField.tsx#L97)、106 行 |
| `TextField.d6cbe837` | 写死 | 显示{noun} | 读屏说明 | [TextField.tsx:97](../../apps/web/src/components/TextField.tsx#L97)、106 行 |

## Toast.tsx

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表

文件：`apps/web/src/components/Toast.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `Toast.ec4c8907` | 写死 | 关闭提示 | 读屏说明 | [Toast.tsx:58](../../apps/web/src/components/Toast.tsx#L58) |

## 包车行程（TripStops.tsx）

用在：供应商后台 · 订单（列表、详情）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 订单（列表、详情）

文件：`apps/web/src/components/TripStops.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TripStops.d02ecd79` | 写死 | 行程 | 文字 | [TripStops.tsx:24](../../apps/web/src/components/TripStops.tsx#L24) |
| `TripStops.7bf2b0aa` | 写死 | 停留 {…} | 正文 | [TripStops.tsx:37](../../apps/web/src/components/TripStops.tsx#L37) |
| `TripStops.73257f8a` | 写死 | 经停点 | 正文 | [TripStops.tsx:63](../../apps/web/src/components/TripStops.tsx#L63) |
| `TripStops.c9f5da04` | 写死 | 包车行程 | 名称 | [TripStops.tsx:65](../../apps/web/src/components/TripStops.tsx#L65) |

## 车型标识的 4 项（VehicleLabelFacts.tsx）

用在：供应商后台 · 订单（列表、详情）；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 订单（列表、详情）

文件：`apps/web/src/components/VehicleLabelFacts.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `VehicleLabelFacts.e02dbf60` | 写死 | 车型 | 正文 | [VehicleLabelFacts.tsx:47](../../apps/web/src/components/VehicleLabelFacts.tsx#L47) |

## 去 WhatsApp 的链接（WhatsappLink.tsx）

用在：官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 预订页（/book）；运营后台 · 人工报价；运营后台 · 官网设置

文件：`apps/web/src/components/WhatsappLink.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `WhatsappLink.2792beb5` | 写死 | （在新标签页打开） | 正文 | [WhatsappLink.tsx:19](../../apps/web/src/components/WhatsappLink.tsx#L19) |

## 调价规则的表单模型和读回的话（adjust-form.ts）

用在：供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/adjust-form.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `adjust-form.2f16ee82` | 写死 | 周三 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.35c65991` | 写死 | 周一 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.4e0e49ea` | 写死 | 周五 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.c70ef2a7` | 写死 | 周二 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.d79d216c` | 写死 | 周四 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.e622d1ba` | 写死 | 周六 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.ed5d7178` | 写死 | 周日 | 文字 | [adjust-form.ts:48](../../apps/web/src/lib/adjust-form.ts#L48) |
| `adjust-form.7cc312f2` | 写死 | 请填写名称 | 文字 | [adjust-form.ts:112](../../apps/web/src/lib/adjust-form.ts#L112) |
| `adjust-form.2325c0c5` | 写死 | 名称最多 {maxAdjustNameLength} 个字 | 文字 | [adjust-form.ts:113](../../apps/web/src/lib/adjust-form.ts#L113) |
| `adjust-form.00a8111d` | 写死 | 出行日期：这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [adjust-form.ts:118](../../apps/web/src/lib/adjust-form.ts#L118)、119 行 |
| `adjust-form.c99ca889` | 写死 | 出行日期：结束日期不能早于开始日期 | 文字 | [adjust-form.ts:120](../../apps/web/src/lib/adjust-form.ts#L120) |
| `adjust-form.64c8b64f` | 写死 | 周期：请至少选一天 | 文字 | [adjust-form.ts:122](../../apps/web/src/lib/adjust-form.ts#L122) |
| `adjust-form.2b673e6b` | 写死 | 周期：请至少添加一个日期 | 文字 | [adjust-form.ts:123](../../apps/web/src/lib/adjust-form.ts#L123) |
| `adjust-form.66dcb1e6` | 写死 | 周期：最多 {maxAdjustDates} 个日期 | 文字 | [adjust-form.ts:124](../../apps/web/src/lib/adjust-form.ts#L124) |
| `adjust-form.94ea9797` | 写死 | 周期：请至少选一个国家的节假日 | 文字 | [adjust-form.ts:125](../../apps/web/src/lib/adjust-form.ts#L125) |
| `adjust-form.ef7f4d07` | 写死 | 时段：请填时间，例如 22:00 | 文字 | [adjust-form.ts:131](../../apps/web/src/lib/adjust-form.ts#L131) |
| `adjust-form.64525c22` | 写死 | 时段：请填时间，例如 06:00 | 文字 | [adjust-form.ts:132](../../apps/web/src/lib/adjust-form.ts#L132) |
| `adjust-form.ec7e4659` | 写死 | 时段：开始和结束不能相同。全天都调请选「全天」 | 文字 | [adjust-form.ts:134](../../apps/web/src/lib/adjust-form.ts#L134) |
| `adjust-form.4fd2648d` | 写死 | 区域：请至少选一个区域，或改成「全部区域」 | 文字 | [adjust-form.ts:138](../../apps/web/src/lib/adjust-form.ts#L138) |
| `adjust-form.5f9f2622` | 写死 | 车型组：请至少选一个车型组，或改成「全部车型组」 | 文字 | [adjust-form.ts:139](../../apps/web/src/lib/adjust-form.ts#L139) |
| `adjust-form.1dbea238` | 写死 | 套餐：请至少选一个套餐，或改成「全部套餐」 | 文字 | [adjust-form.ts:140](../../apps/web/src/lib/adjust-form.ts#L140) |
| `adjust-form.f216cd6b` | 写死 | 第 {…} 步 | 名称 | [adjust-form.ts:145](../../apps/web/src/lib/adjust-form.ts#L145) |
| `adjust-form.43035b03` | 写死 | {label}：请填大于 0 的数。不想调，请删掉这一步 | 文字 | [adjust-form.ts:146](../../apps/web/src/lib/adjust-form.ts#L146)、150、157 行 |
| `adjust-form.4a600309` | 写死 | {label}：请填数字，最多两位小数 | 文字 | [adjust-form.ts:149](../../apps/web/src/lib/adjust-form.ts#L149) |
| `adjust-form.a462ebee` | 写死 | {label}：上调最多 {…}% | 文字 | [adjust-form.ts:151](../../apps/web/src/lib/adjust-form.ts#L151) |
| `adjust-form.e478b564` | 写死 | {label}：下调要小于 100% | 文字 | [adjust-form.ts:152](../../apps/web/src/lib/adjust-form.ts#L152) |
| `adjust-form.b45e796a` | 写死 | 怎么调：至少要有一步 | 文字 | [adjust-form.ts:161](../../apps/web/src/lib/adjust-form.ts#L161) |
| `adjust-form.313255ba` | 写死 | 这条规则不符合要求（{…}） | 文字 | [adjust-form.ts:178](../../apps/web/src/lib/adjust-form.ts#L178) |
| `adjust-form.268f2fdd` | 写死 | 下调 | 文字 | [adjust-form.ts:193](../../apps/web/src/lib/adjust-form.ts#L193) |
| `adjust-form.7708ed27` | 写死 | 上调 | 文字 | [adjust-form.ts:193](../../apps/web/src/lib/adjust-form.ts#L193) |
| `adjust-form.44db6b5a` | 写死 | 再 | 文字 | [adjust-form.ts:199](../../apps/web/src/lib/adjust-form.ts#L199) |
| `adjust-form.5dbc693f` | 写死 | {from} 至 {to} | 文字 | [adjust-form.ts:203](../../apps/web/src/lib/adjust-form.ts#L203) |
| `adjust-form.1137832c` | 写死 | {from} 起 | 文字 | [adjust-form.ts:204](../../apps/web/src/lib/adjust-form.ts#L204) |
| `adjust-form.177569ff` | 写死 | 到 {to} 为止 | 文字 | [adjust-form.ts:205](../../apps/web/src/lib/adjust-form.ts#L205) |
| `adjust-form.1ef529f9` | 写死 | 不限日期 | 文字 | [adjust-form.ts:205](../../apps/web/src/lib/adjust-form.ts#L205) |
| `adjust-form.381ab3c7` | 写死 | 每天 | 文字 | [adjust-form.ts:209](../../apps/web/src/lib/adjust-form.ts#L209) |
| `adjust-form.6cfddd79` | 写死 | 每{…} | 文字 | [adjust-form.ts:210](../../apps/web/src/lib/adjust-form.ts#L210) |
| `adjust-form.391ff66c` | 写死 | 指定的 {length} 天 | 文字 | [adjust-form.ts:211](../../apps/web/src/lib/adjust-form.ts#L211) |
| `adjust-form.c4bc5583` | 写死 | 指定日期 {…} | 文字 | [adjust-form.ts:211](../../apps/web/src/lib/adjust-form.ts#L211) |
| `adjust-form.e89d62c2` | 写死 | {…}的节假日 | 文字 | [adjust-form.ts:212](../../apps/web/src/lib/adjust-form.ts#L212) |
| `adjust-form.5d3b2987` | 写死 | 全天 | 文字 | [adjust-form.ts:217](../../apps/web/src/lib/adjust-form.ts#L217) |
| `adjust-form.78ea2a0f` | 写死 | {start}–次日 {end} | 文字 | [adjust-form.ts:220](../../apps/web/src/lib/adjust-form.ts#L220) |
| `adjust-form.252f0294` | 写死 | ，其余 {…} 天同样 | 文字 | [adjust-form.ts:237](../../apps/web/src/lib/adjust-form.ts#L237) |
| `adjust-form.92e6f988` | 写死 | 每个假日 | 文字 | [adjust-form.ts:239](../../apps/web/src/lib/adjust-form.ts#L239) |
| `adjust-form.148b68c0` | 写死 | 已启用 | 文字 | [adjust-form.ts:264](../../apps/web/src/lib/adjust-form.ts#L264) |
| `adjust-form.dca80f16` | 写死 | 已停用 | 文字 | [adjust-form.ts:264](../../apps/web/src/lib/adjust-form.ts#L264) |
| `adjust-form.03318fc6` | 写死 | 适用范围里现在没有价格，这条规则暂时调不到任何东西。 | 提示 | [adjust-form.ts:273](../../apps/web/src/lib/adjust-form.ts#L273) |
| `adjust-form.bb040ba9` | 写死 | 这段出行日期里，适用范围内没有生效的价格。 | 提示 | [adjust-form.ts:278](../../apps/web/src/lib/adjust-form.ts#L278) |
| `adjust-form.80fbbd42` | 写死 | 出行日期里没有{…}，这条规则不会生效。 | 提示 | [adjust-form.ts:283](../../apps/web/src/lib/adjust-form.ts#L283) |
| `adjust-form.86ac5947` | 写死 | {…}等 {length} 个 | 文字 | [adjust-form.ts:290](../../apps/web/src/lib/adjust-form.ts#L290) |
| `adjust-form.d15194d4` | 写死 | {pickup}和{dropoff} | 文字 | [adjust-form.ts:295](../../apps/web/src/lib/adjust-form.ts#L295) |
| `adjust-form.f132c623` | 写死 | 只{…} | 文字 | [adjust-form.ts:295](../../apps/web/src/lib/adjust-form.ts#L295) |

## 金额输入框里的字 → 一个干净的十进制写法（amount-input.ts）

用在：供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/amount-input.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `amount-input.0961f29a` | 写死 | 元 | 文字 | [amount-input.ts:15](../../apps/web/src/lib/amount-input.ts#L15) |
| `amount-input.a0e6bba3` | 写死 | 원 | 文字 | [amount-input.ts:15](../../apps/web/src/lib/amount-input.ts#L15) |
| `amount-input.cf7ac0fd` | 写死 | 円 | 文字 | [amount-input.ts:15](../../apps/web/src/lib/amount-input.ts#L15) |
| `amount-input.84581a3b` | 写死 | 逗号的位置不对：千分位的逗号前面不能以 0 开头、后面要正好三位（如 12,500）；小数点请用「.」 | 文字 | [amount-input.ts:55](../../apps/web/src/lib/amount-input.ts#L55) |
| `amount-input.17e0771e` | 写死 | 这一格的币种是 {…}，请不要带别的币种的符号，只填数字 | 文字 | [amount-input.ts:57](../../apps/web/src/lib/amount-input.ts#L57) |
| `amount-input.3890e376` | 写死 | 商品的币种 | 文字 | [amount-input.ts:57](../../apps/web/src/lib/amount-input.ts#L57) |

## 区域地图（area-overview.ts）

用在：供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/area-overview.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-overview.fc88e57f` | 写死 | 圆 · 半径 {…} 公里 | 说明 | [area-overview.ts:23](../../apps/web/src/lib/area-overview.ts#L23) |
| `area-overview.b665931f` | 写死 | 多边形 · {points} 个点 | 说明 | [area-overview.ts:24](../../apps/web/src/lib/area-overview.ts#L24) |
| `area-overview.67a2c1ed` | 写死 | 营运区 {length} 块 · 禁行区 {length} 块 · 共 {points} 个点 | 说明 | [area-overview.ts:25](../../apps/web/src/lib/area-overview.ts#L25) |
| `area-overview.74d20f1c` | 写死 | 与{shown}等 {length} 个区域重叠 | 文字 | [area-overview.ts:32](../../apps/web/src/lib/area-overview.ts#L32) |
| `area-overview.ad8c0562` | 写死 | 与{shown}重叠 | 文字 | [area-overview.ts:32](../../apps/web/src/lib/area-overview.ts#L32) |
| `area-overview.8c9dddcd` | 写死 | 约 {…} 平方米 | 文字 | [area-overview.ts:37](../../apps/web/src/lib/area-overview.ts#L37) |
| `area-overview.2a74ad9b` | 写死 | 约 {…} 平方公里 | 文字 | [area-overview.ts:39](../../apps/web/src/lib/area-overview.ts#L39) |
| `area-overview.af0b7407` | 写死 | 系统 | 文字 | [area-overview.ts:94](../../apps/web/src/lib/area-overview.ts#L94) |
| `area-overview.4e69ef9c` | 写死 | 已删除的账号 | 文字 | [area-overview.ts:95](../../apps/web/src/lib/area-overview.ts#L95) |
| `area-overview.5a302e6c` | 写死 | 营运 | 名称 | [area-overview.ts:114](../../apps/web/src/lib/area-overview.ts#L114) |
| `area-overview.b296cf1d` | 写死 | 禁行 | 名称 | [area-overview.ts:114](../../apps/web/src/lib/area-overview.ts#L114) |
| `area-overview.016ab07c` | 写死 | 区域地图-{…}-{…}-{…}.geojson | 名称 | [area-overview.ts:126](../../apps/web/src/lib/area-overview.ts#L126) |
| `area-overview.21a5723c` | 写死 | 只能导入 .geojson 或 .json 文件。 | 提示 | [area-overview.ts:139](../../apps/web/src/lib/area-overview.ts#L139) |
| `area-overview.5c1d7556` | 写死 | 文件超过 2 MB，读不了。 | 提示 | [area-overview.ts:140](../../apps/web/src/lib/area-overview.ts#L140) |
| `area-overview.b8c9f4ba` | 写死 | 这个文件读不出文字内容。 | 提示 | [area-overview.ts:141](../../apps/web/src/lib/area-overview.ts#L141) |
| `area-overview.0f9a6924` | 写死 | 这个文件里有 {areas} 个区域。一次只能导入一个区域：请在区域地图里只导出一个区域，或把文件拆开。 | 提示 | [area-overview.ts:143](../../apps/web/src/lib/area-overview.ts#L143) |

## 区域的用途（area-roles.ts）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/area-roles.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-roles.0c35ae4b` | 写死 | 只决定这一单能不能接，不带价格。可以画得很大（例如整个服务城市）；商品不勾选它，也不给它填价格。 | 说明 | [area-roles.ts:19](../../apps/web/src/lib/area-roles.ts#L19) |
| `area-roles.1e4fc4aa` | 写死 | 商品勾选后给它填价格或加价。要画在运营区域里面：超出运营区域的那部分不会报价。 | 说明 | [area-roles.ts:20](../../apps/web/src/lib/area-roles.ts#L20) |
| `area-roles.5d834978` | 写死 | 这块地方就是接单范围，也按它定价。只想画一个区域、按一个价时选它（以前画的区域都是这一种）。 | 说明 | [area-roles.ts:21](../../apps/web/src/lib/area-roles.ts#L21) |
| `area-roles.0dbccebe` | 写死 | 可以报价 | 标题 | [area-roles.ts:29](../../apps/web/src/lib/area-roles.ts#L29) |
| `area-roles.1d076167` | 写死 | 能接单的范围，不带价格 | 标题 | [area-roles.ts:29](../../apps/web/src/lib/area-roles.ts#L29) |
| `area-roles.46d730ae` | 写死 | 一个地点要同时在你的某个运营区域里、又在商品勾选的报价区域里，这个商品才报价。没勾选的地方不会被按别处的价格报出去。 | 说明 | [area-roles.ts:32](../../apps/web/src/lib/area-roles.ts#L32) |
| `area-roles.0c9f9582` | 写死 | 另有 {count} 个运营区域没有列出：运营区域只决定能不能接单，不带价格，所以不能给商品勾选。要在那里报价，请画一个报价区域（或把它改成「运营 + 报价」）。 | 文字 | [area-roles.ts:42](../../apps/web/src/lib/area-roles.ts#L42) |
| `area-roles.c7145dec` | 写死 | 这个报价区域有{…}不在任何运营区域里，那部分不会报价 | 文字 | [area-roles.ts:47](../../apps/web/src/lib/area-roles.ts#L47) |
| `area-roles.03c7b89a` | 写死 | 商品 {productCode} | 文字 | [area-roles.ts:116](../../apps/web/src/lib/area-roles.ts#L116) |
| `area-roles.73de2a5b` | 写死 | 一个已上架的商品 | 文字 | [area-roles.ts:116](../../apps/web/src/lib/area-roles.ts#L116) |
| `area-roles.60694713` | 写死 | {product}：报价区域{…}将有{…}不在任何运营区域里 | 文字 | [area-roles.ts:117](../../apps/web/src/lib/area-roles.ts#L117) |
| `area-roles.32c5a5e5` | 写死 | 保存 | 文字 | [area-roles.ts:122](../../apps/web/src/lib/area-roles.ts#L122) |
| `area-roles.bb7a98aa` | 写死 | 停用 | 文字 | [area-roles.ts:122](../../apps/web/src/lib/area-roles.ts#L122) |
| `area-roles.ebff1ff4` | 写死 | 删除 | 文字 | [area-roles.ts:122](../../apps/web/src/lib/area-roles.ts#L122) |
| `area-roles.232f20a8` | 写死 | 现在不能{verb}：已上架的商品会有地方报不出价。 | 标题 | [area-roles.ts:124](../../apps/web/src/lib/area-roles.ts#L124) |
| `area-roles.7e828e68` | 写死 | {verb}之后，下面这些已上架商品勾选的报价区域会有一部分不在任何运营区域里，那部分将报不出价。请先补画（或启用）覆盖它们的运营区域，或先把这些商品下架。 | 文字 | [area-roles.ts:125](../../apps/web/src/lib/area-roles.ts#L125) |
| `area-roles.5206ebb7` | 写死 | 有商品 | 文字 | [area-roles.ts:132](../../apps/web/src/lib/area-roles.ts#L132) |
| `area-roles.658b9226` | 写死 | 有 {count} 个商品 | 文字 | [area-roles.ts:132](../../apps/web/src/lib/area-roles.ts#L132) |
| `area-roles.9c753585` | 写死 | {who}把这个区域当报价区域用着（服务区域、包车区域加价或点对点线路价），不能改成运营区域：运营区域不带价格。请先在这些商品里换掉它，或改选「运营 + 报价」。 | 文字 | [area-roles.ts:133](../../apps/web/src/lib/area-roles.ts#L133) |

## 包车「区域加价」块的表格模型（area-surcharge.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/area-surcharge.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-surcharge.1b549d3b` | 写死 | 上车加价 | 文字 | [area-surcharge.ts:17](../../apps/web/src/lib/area-surcharge.ts#L17) |
| `area-surcharge.56f436c4` | 写死 | 途经加价 | 文字 | [area-surcharge.ts:17](../../apps/web/src/lib/area-surcharge.ts#L17) |
| `area-surcharge.df48fd64` | 写死 | 下车加价 | 文字 | [area-surcharge.ts:17](../../apps/web/src/lib/area-surcharge.ts#L17) |
| `area-surcharge.9a19a116` | 写死 | 请填{name}，不加钱请填 0 | 文字 | [area-surcharge.ts:103](../../apps/web/src/lib/area-surcharge.ts#L103) |
| `area-surcharge.b06ce921` | 写死 | {name}不能是负数 | 文字 | [area-surcharge.ts:104](../../apps/web/src/lib/area-surcharge.ts#L104) |
| `area-surcharge.30389132` | 写死 | {name}请填数字 | 文字 | [area-surcharge.ts:107](../../apps/web/src/lib/area-surcharge.ts#L107) |
| `area-surcharge.18d9ca38` | 写死 | {currency} 最多 {digits} 位小数 | 文字 | [area-surcharge.ts:112](../../apps/web/src/lib/area-surcharge.ts#L112) |
| `area-surcharge.2e616a5d` | 写死 | {name}最多 {…} | 文字 | [area-surcharge.ts:112](../../apps/web/src/lib/area-surcharge.ts#L112)、114 行 |
| `area-surcharge.7ed4b68d` | 写死 | {…}金额不能有小数 | 文字 | [area-surcharge.ts:112](../../apps/web/src/lib/area-surcharge.ts#L112) |
| `area-surcharge.973dc520` | 写死 | 请填开始日期 | 文字 | [area-surcharge.ts:136](../../apps/web/src/lib/area-surcharge.ts#L136) |
| `area-surcharge.93f4e5ce` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [area-surcharge.ts:137](../../apps/web/src/lib/area-surcharge.ts#L137)、138 行 |
| `area-surcharge.01212f99` | 写死 | 结束日期不能早于开始日期 | 文字 | [area-surcharge.ts:139](../../apps/web/src/lib/area-surcharge.ts#L139) |
| `area-surcharge.ef6cf444` | 写死 | 这一行不符合要求（{…}） | 文字 | [area-surcharge.ts:144](../../apps/web/src/lib/area-surcharge.ts#L144) |
| `area-surcharge.84defb3e` | 写死 | {end}在{areaName}时加 {…} | 文字 | [area-surcharge.ts:395](../../apps/web/src/lib/area-surcharge.ts#L395) |
| `area-surcharge.b77d01ca` | 写死 | {end}在{areaName}时不加钱 | 文字 | [area-surcharge.ts:395](../../apps/web/src/lib/area-surcharge.ts#L395) |
| `area-surcharge.38ae49de` | 写死 | 途经景点在{areaName}的单（没设途经加价）不报价 | 文字 | [area-surcharge.ts:396](../../apps/web/src/lib/area-surcharge.ts#L396) |
| `area-surcharge.6d223acd` | 写死 | {…}（几个景点都在这里只加一次；上车或下车已经在{areaName}的不再加） | 文字 | [area-surcharge.ts:396](../../apps/web/src/lib/area-surcharge.ts#L396) |
| `area-surcharge.c02d37ac` | 写死 | 途经景点 | 文字 | [area-surcharge.ts:396](../../apps/web/src/lib/area-surcharge.ts#L396) |
| `area-surcharge.563c52e2` | 写死 | 下车点 | 文字 | [area-surcharge.ts:397](../../apps/web/src/lib/area-surcharge.ts#L397) |
| `area-surcharge.7795a8b1` | 写死 | 上车点 | 文字 | [area-surcharge.ts:397](../../apps/web/src/lib/area-surcharge.ts#L397) |
| `area-surcharge.24c6119c` | 写死 | {validFrom} 至 {validTo} 有效。 | 文字 | [area-surcharge.ts:402](../../apps/web/src/lib/area-surcharge.ts#L402) |
| `area-surcharge.be73a9e7` | 写死 | {validFrom} 起一直有效。 | 文字 | [area-surcharge.ts:402](../../apps/web/src/lib/area-surcharge.ts#L402) |
| `area-surcharge.fe7ddedc` | 写死 | 现在是停用的，不会用来报价。 | 文字 | [area-surcharge.ts:402](../../apps/web/src/lib/area-surcharge.ts#L402) |
| `area-surcharge.0bcaa28b` | 写死 | 将删除 | 文字 | [area-surcharge.ts:408](../../apps/web/src/lib/area-surcharge.ts#L408) |
| `area-surcharge.ba07b26a` | 写死 | 和别的区域加价日期重叠 | 文字 | [area-surcharge.ts:410](../../apps/web/src/lib/area-surcharge.ts#L410) |
| `area-surcharge.641182fc` | 写死 | 新的，未保存 | 文字 | [area-surcharge.ts:411](../../apps/web/src/lib/area-surcharge.ts#L411) |
| `area-surcharge.3f6df6f3` | 写死 | 改过，未保存 | 文字 | [area-surcharge.ts:412](../../apps/web/src/lib/area-surcharge.ts#L412) |
| `area-surcharge.11957c6e` | 写死 | 没填 | 文字 | [area-surcharge.ts:414](../../apps/web/src/lib/area-surcharge.ts#L414) |
| `area-surcharge.e541e49a` | 写死 | 已停用 | 文字 | [area-surcharge.ts:415](../../apps/web/src/lib/area-surcharge.ts#L415) |
| `area-surcharge.69d4900f` | 写死 | 已过期 | 文字 | [area-surcharge.ts:416](../../apps/web/src/lib/area-surcharge.ts#L416) |
| `area-surcharge.875a54e4` | 写死 | {validFrom} 起生效 | 文字 | [area-surcharge.ts:417](../../apps/web/src/lib/area-surcharge.ts#L417) |
| `area-surcharge.0365d415` | 写死 | 生效中，{validTo} 到期 | 文字 | [area-surcharge.ts:418](../../apps/web/src/lib/area-surcharge.ts#L418) |
| `area-surcharge.dec0c3f9` | 写死 | 生效中 | 文字 | [area-surcharge.ts:419](../../apps/web/src/lib/area-surcharge.ts#L419) |

## 收款账户和银行转账文件在页面上的说法（bank-file-display.ts）

用在：供应商后台 · 收款账户；供应商后台 · 账单；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件

文件：`apps/web/src/lib/bank-file-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `bank-file-display.e1f05470` | 写死 | 已生成，待下载 | 名称 | [bank-file-display.ts:16](../../apps/web/src/lib/bank-file-display.ts#L16) |
| `bank-file-display.e5f83ba8` | 写死 | 已下载，待回填 | 名称 | [bank-file-display.ts:17](../../apps/web/src/lib/bank-file-display.ts#L17) |
| `bank-file-display.0c1f1a03` | 写死 | 已付款 | 名称 | [bank-file-display.ts:18](../../apps/web/src/lib/bank-file-display.ts#L18) |
| `bank-file-display.d0dc7e9a` | 写死 | 已作废 | 名称 | [bank-file-display.ts:19](../../apps/web/src/lib/bank-file-display.ts#L19) |
| `bank-file-display.d683c941` | 写死 | 待审核 | 名称 | [bank-file-display.ts:23](../../apps/web/src/lib/bank-file-display.ts#L23) |
| `bank-file-display.6fe8ef13` | 写死 | 生效中 | 名称 | [bank-file-display.ts:24](../../apps/web/src/lib/bank-file-display.ts#L24) |
| `bank-file-display.dcf7179e` | 写死 | 已被替换 | 名称 | [bank-file-display.ts:25](../../apps/web/src/lib/bank-file-display.ts#L25) |
| `bank-file-display.b0c41d2e` | 写死 | 已驳回 | 名称 | [bank-file-display.ts:26](../../apps/web/src/lib/bank-file-display.ts#L26) |
| `bank-file-display.d37ac17a` | 写死 | 已撤回 | 名称 | [bank-file-display.ts:27](../../apps/web/src/lib/bank-file-display.ts#L27) |
| `bank-file-display.7c18fe6f` | 写死 | SHA：各付各的（常用） | 文字 | [bank-file-display.ts:31](../../apps/web/src/lib/bank-file-display.ts#L31) |
| `bank-file-display.b39b6db2` | 写死 | OUR：手续费都由平台付 | 文字 | [bank-file-display.ts:32](../../apps/web/src/lib/bank-file-display.ts#L32) |
| `bank-file-display.de1caff6` | 写死 | BEN：手续费都由收款人付 | 文字 | [bank-file-display.ts:33](../../apps/web/src/lib/bank-file-display.ts#L33) |

## 账单和付款批次在页面上的说法（billing-display.ts）

用在：供应商后台 · 收款账户；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 财务结算（账单、付款批次）；运营后台 · 首页

文件：`apps/web/src/lib/billing-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `billing-display.dd5df4e8` | 写死 | 收账单中 | 名称 | [billing-display.ts:39](../../apps/web/src/lib/billing-display.ts#L39) |
| `billing-display.c2d880ba` | 写死 | 已锁定，待转账 | 名称 | [billing-display.ts:40](../../apps/web/src/lib/billing-display.ts#L40) |
| `billing-display.f56d1257` | 写死 | 已付款 | 名称 | [billing-display.ts:41](../../apps/web/src/lib/billing-display.ts#L41)、58 行 |
| `billing-display.82d228c7` | 写死 | 出账 | 文字 | [billing-display.ts:50](../../apps/web/src/lib/billing-display.ts#L50) |
| `billing-display.1b611bea` | 写死 | 供应商确认 | 按钮 | [billing-display.ts:51](../../apps/web/src/lib/billing-display.ts#L51) |
| `billing-display.136b28ba` | 写死 | 确认期满，视为确认 | 按钮 | [billing-display.ts:52](../../apps/web/src/lib/billing-display.ts#L52) |
| `billing-display.60990711` | 写死 | 供应商提出异议 | 文字 | [billing-display.ts:53](../../apps/web/src/lib/billing-display.ts#L53) |
| `billing-display.86b3bbdb` | 写死 | 平台答复异议 | 文字 | [billing-display.ts:54](../../apps/web/src/lib/billing-display.ts#L54) |
| `billing-display.fea1cdd1` | 写死 | 作废 | 文字 | [billing-display.ts:55](../../apps/web/src/lib/billing-display.ts#L55) |
| `billing-display.d0643803` | 写死 | 已提交付款复核 | 文字 | [billing-display.ts:56](../../apps/web/src/lib/billing-display.ts#L56) |
| `billing-display.3027dc8d` | 写死 | 付款复核通过 | 文字 | [billing-display.ts:57](../../apps/web/src/lib/billing-display.ts#L57) |
| `billing-display.3f5a4cb3` | 写死 | 系统 | 文字 | [billing-display.ts:61](../../apps/web/src/lib/billing-display.ts#L61) |
| `billing-display.42ae84be` | 写死 | 供应商 | 文字 | [billing-display.ts:61](../../apps/web/src/lib/billing-display.ts#L61) |
| `billing-display.75b5f0b6` | 写死 | 平台 | 文字 | [billing-display.ts:61](../../apps/web/src/lib/billing-display.ts#L61) |
| `billing-display.6d7714a5` | 写死 | 结算价 {…} | 文字 | [billing-display.ts:70](../../apps/web/src/lib/billing-display.ts#L70) |
| `billing-display.a7f170a0` | 写死 | 结算价 {…} × 扣款 {…}{…} | 文字 | [billing-display.ts:72](../../apps/web/src/lib/billing-display.ts#L72) |
| `billing-display.03c3b1de` | 写死 | 事后加收 | 文字 | [billing-display.ts:74](../../apps/web/src/lib/billing-display.ts#L74) |
| `billing-display.eb7a6cc1` | 写死 | ，报的 {…} | 文字 | [billing-display.ts:74](../../apps/web/src/lib/billing-display.ts#L74) |
| `billing-display.9ce5267e` | 写死 | {…}免除{…} | 文字 | [billing-display.ts:78](../../apps/web/src/lib/billing-display.ts#L78) |
| `billing-display.aae2306d` | 写死 | 扣款 | 文字 | [billing-display.ts:78](../../apps/web/src/lib/billing-display.ts#L78) |
| `billing-display.a4512393` | 写死 | 上期账单 {…}（{…}） | 文字 | [billing-display.ts:80](../../apps/web/src/lib/billing-display.ts#L80) |
| `billing-display.a21d29cd` | 写死 | {…} 年 {…} 月 | 文字 | [billing-display.ts:87](../../apps/web/src/lib/billing-display.ts#L87) |

## 预订页（book-new.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/book-new.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `book-new.64f0d6f6` | 写死 | {passengers} 人 · {luggage} 件 | 文字 | [book-new.ts:18](../../apps/web/src/lib/book-new.ts#L18) |
| `book-new.583d1c61` | 写死 | 区间 | 文字 | [book-new.ts:113](../../apps/web/src/lib/book-new.ts#L113)、115 行 |
| `book-new.81f86f45` | 写死 | 包车 | 文字 | [book-new.ts:113](../../apps/web/src/lib/book-new.ts#L113)、116 行 |
| `book-new.2d65aff7` | 写死 | 乘客信息 | 文字 | [book-new.ts:157](../../apps/web/src/lib/book-new.ts#L157) |
| `book-new.33a3e259` | 写死 | 车型和价格 | 文字 | [book-new.ts:157](../../apps/web/src/lib/book-new.ts#L157) |
| `book-new.c079645e` | 写死 | 行程 | 文字 | [book-new.ts:157](../../apps/web/src/lib/book-new.ts#L157) |
| `book-new.c952ef84` | 写死 | 核对并付款 | 文字 | [book-new.ts:157](../../apps/web/src/lib/book-new.ts#L157) |
| `book-new.0645ecbb` | 写死 | 已识别为接机：司机按航班落地时间等候，落地后免费等待 {minutes} 分钟 | 说明 | [book-new.ts:191](../../apps/web/src/lib/book-new.ts#L191) |
| `book-new.e5adf0d7` | 写死 | 已识别为接机：司机按航班落地时间等候，落地后免费等待：国际线最长 {international} 分钟、国内线最长 {domestic} 分钟 | 说明 | [book-new.ts:192](../../apps/web/src/lib/book-new.ts#L192) |
| `book-new.950c24a7` | 写死 | 已识别为接机：司机按航班落地时间等候，不限时免费等待 | 说明 | [book-new.ts:193](../../apps/web/src/lib/book-new.ts#L193) |
| `book-new.539d020d` | 写死 | 国际航班 | 文字 | [book-new.ts:196](../../apps/web/src/lib/book-new.ts#L196) |
| `book-new.e703f414` | 写死 | 国内航班 | 文字 | [book-new.ts:196](../../apps/web/src/lib/book-new.ts#L196) |
| `book-new.07f469b7` | 写死 | 航班号：{flight} | 说明 | [book-new.ts:210](../../apps/web/src/lib/book-new.ts#L210) |
| `book-new.68eb6678` | 写死 | 地图上选的位置（{…}, {…}） | 名称 | [book-new.ts:241](../../apps/web/src/lib/book-new.ts#L241) |
| `book-new.8bc16ef7` | 写死 | 时间太近，请选更晚的时间或联系客服 | 说明 | [book-new.ts:248](../../apps/web/src/lib/book-new.ts#L248) |
| `book-new.fe1cef53` | 写死 | 人数或行李超过所有车型，可以分两辆车预订或联系客服 | 文字 | [book-new.ts:249](../../apps/web/src/lib/book-new.ts#L249) |
| `book-new.2857e373` | 写死 | 这个地址暂时没有在线报价，请联系客服 | 文字 | [book-new.ts:250](../../apps/web/src/lib/book-new.ts#L250)、251 行 |
| `book-new.c7978a68` | 写死 | 约 {…} 分钟 · {km} 公里 | 说明 | [book-new.ts:373](../../apps/web/src/lib/book-new.ts#L373) |
| `book-new.c76289f0` | 写死 | 约 {…} 分钟 · {…} 公里 | 说明 | [book-new.ts:381](../../apps/web/src/lib/book-new.ts#L381) |
| `book-new.ad2c7072` | 写死 | 按当前汇率换算，仅供参考，实际以支付金额为准 | 说明 | [book-new.ts:426](../../apps/web/src/lib/book-new.ts#L426) |

## 渠道、加价规则、双人复核在页面上的写法（channel-display.ts）

用在：供应商后台 · 企业信息；供应商后台 · 公司；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/channel-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `channel-display.2237353c` | 写死 | 线下代理 | 文字 | [channel-display.ts:25](../../apps/web/src/lib/channel-display.ts#L25) |
| `channel-display.25109934` | 写死 | 自营 | 文字 | [channel-display.ts:25](../../apps/web/src/lib/channel-display.ts#L25) |
| `channel-display.5de74acc` | 写死 | API 分销商 | 文字 | [channel-display.ts:25](../../apps/web/src/lib/channel-display.ts#L25) |
| `channel-display.deb7236d` | 写死 | OTA（连接器） | 文字 | [channel-display.ts:25](../../apps/web/src/lib/channel-display.ts#L25) |
| `channel-display.44104b21` | 写死 | 自己的官网、App，直接调用销售端接口 | 文字 | [channel-display.ts:27](../../apps/web/src/lib/channel-display.ts#L27) |
| `channel-display.209e14e6` | 写死 | 旅行社、企业差旅平台，按我们的销售端接口对接 | 文字 | [channel-display.ts:28](../../apps/web/src/lib/channel-display.ts#L28) |
| `channel-display.6b87f986` | 写死 | Klook、Trip.com 等，由我们开发连接器适配对方的规范 | 文字 | [channel-display.ts:29](../../apps/web/src/lib/channel-display.ts#L29) |
| `channel-display.8cfc3bbf` | 写死 | 实体旅行社、酒店前台，在后台手工下单 | 文字 | [channel-display.ts:30](../../apps/web/src/lib/channel-display.ts#L30) |
| `channel-display.fbd0624f` | 写死 | 测试 | 名称 | [channel-display.ts:34](../../apps/web/src/lib/channel-display.ts#L34)、410 行 |
| `channel-display.9fc49eca` | 写死 | 启用 | 名称 | [channel-display.ts:35](../../apps/web/src/lib/channel-display.ts#L35)、410 行 |
| `channel-display.7678ed5d` | 写死 | 暂停 | 名称 | [channel-display.ts:36](../../apps/web/src/lib/channel-display.ts#L36)、410 行 |
| `channel-display.0c6c1efd` | 写死 | 名单里的不卖 | 文字 | [channel-display.ts:39](../../apps/web/src/lib/channel-display.ts#L39) |
| `channel-display.d24b37da` | 写死 | 只卖名单里的 | 文字 | [channel-display.ts:39](../../apps/web/src/lib/channel-display.ts#L39) |
| `channel-display.e52987b9` | 写死 | 全部供应商 | 文字 | [channel-display.ts:39](../../apps/web/src/lib/channel-display.ts#L39) |
| `channel-display.dffac038` | 写死 | 改定价参数 | 文字 | [channel-display.ts:43](../../apps/web/src/lib/channel-display.ts#L43) |
| `channel-display.d1de40a3` | 写死 | 暂停渠道 | 文字 | [channel-display.ts:44](../../apps/web/src/lib/channel-display.ts#L44) |
| `channel-display.90bf47bb` | 写死 | 新增加价规则 | 文字 | [channel-display.ts:45](../../apps/web/src/lib/channel-display.ts#L45) |
| `channel-display.3c70be11` | 写死 | 修改加价规则 | 文字 | [channel-display.ts:46](../../apps/web/src/lib/channel-display.ts#L46) |
| `channel-display.9e770733` | 写死 | 删除加价规则 | 文字 | [channel-display.ts:47](../../apps/web/src/lib/channel-display.ts#L47) |
| `channel-display.2c042c3c` | 写死 | 锁定汇率 | 文字 | [channel-display.ts:48](../../apps/web/src/lib/channel-display.ts#L48) |
| `channel-display.0148cdfa` | 写死 | 解除汇率锁定 | 文字 | [channel-display.ts:49](../../apps/web/src/lib/channel-display.ts#L49) |
| `channel-display.ab66253f` | 写死 | 暂停供应商 | 文字 | [channel-display.ts:50](../../apps/web/src/lib/channel-display.ts#L50) |
| `channel-display.cfbb0caa` | 写死 | 清退供应商 | 文字 | [channel-display.ts:51](../../apps/web/src/lib/channel-display.ts#L51) |
| `channel-display.a86a3a15` | 写死 | 供应商合同新版本 | 文字 | [channel-display.ts:52](../../apps/web/src/lib/channel-display.ts#L52) |
| `channel-display.379f7e2a` | 写死 | 供应商资料修改（名称、法定名称、登记号） | 文字 | [channel-display.ts:53](../../apps/web/src/lib/channel-display.ts#L53) |
| `channel-display.d8c400f1` | 写死 | 修改平台取消政策 | 文字 | [channel-display.ts:54](../../apps/web/src/lib/channel-display.ts#L54) |
| `channel-display.512f87b6` | 写死 | 代取消（多退给客人） | 文字 | [channel-display.ts:55](../../apps/web/src/lib/channel-display.ts#L55) |
| `channel-display.2b3aa226` | 写死 | 代供应商回传「已接到客人」 | 文字 | [channel-display.ts:56](../../apps/web/src/lib/channel-display.ts#L56) |
| `channel-display.9f778eef` | 写死 | 代供应商回传「已完成」 | 文字 | [channel-display.ts:57](../../apps/web/src/lib/channel-display.ts#L57) |
| `channel-display.910df256` | 写死 | 把官网订单链接发到新邮箱 | 文字 | [channel-display.ts:58](../../apps/web/src/lib/channel-display.ts#L58) |
| `channel-display.92b48618` | 写死 | 代客人改乘客邮箱 | 文字 | [channel-display.ts:59](../../apps/web/src/lib/channel-display.ts#L59) |
| `channel-display.0a46c1b6` | 写死 | 救援改派：人工指定供应商 | 文字 | [channel-display.ts:60](../../apps/web/src/lib/channel-display.ts#L60) |
| `channel-display.79fc01a8` | 写死 | 修改客人赔付表 | 文字 | [channel-display.ts:61](../../apps/web/src/lib/channel-display.ts#L61) |
| `channel-display.d6911c33` | 写死 | 工单判定（赔付达到复核阈值） | 文字 | [channel-display.ts:62](../../apps/web/src/lib/channel-display.ts#L62) |
| `channel-display.5cce160b` | 写死 | 修改角色 | 文字 | [channel-display.ts:63](../../apps/web/src/lib/channel-display.ts#L63) |
| `channel-display.c909b685` | 写死 | 重置两步验证 | 文字 | [channel-display.ts:64](../../apps/web/src/lib/channel-display.ts#L64) |
| `channel-display.7c693b93` | 写死 | 付款给供应商 | 文字 | [channel-display.ts:65](../../apps/web/src/lib/channel-display.ts#L65) |
| `channel-display.f6e312bf` | 写死 | 启用供应商收款账户 | 文字 | [channel-display.ts:66](../../apps/web/src/lib/channel-display.ts#L66) |
| `channel-display.9e3744ca` | 写死 | 生成银行转账文件 | 文字 | [channel-display.ts:67](../../apps/web/src/lib/channel-display.ts#L67) |
| `channel-display.bdaf304d` | 写死 | 待审核 | 名称 | [channel-display.ts:81](../../apps/web/src/lib/channel-display.ts#L81) |
| `channel-display.5854f502` | 写死 | 已批准 | 名称 | [channel-display.ts:82](../../apps/web/src/lib/channel-display.ts#L82) |
| `channel-display.47bced17` | 写死 | 已驳回 | 名称 | [channel-display.ts:83](../../apps/web/src/lib/channel-display.ts#L83) |
| `channel-display.8ff480cf` | 写死 | 已撤回 | 名称 | [channel-display.ts:84](../../apps/web/src/lib/channel-display.ts#L84) |
| `channel-display.716885b2` | 写死 | 供应商 × 城市 × 品类 × 车型组 | 文字 | [channel-display.ts:88](../../apps/web/src/lib/channel-display.ts#L88) |
| `channel-display.dd201f6c` | 写死 | 供应商 | 文字 | [channel-display.ts:89](../../apps/web/src/lib/channel-display.ts#L89)、290、301、355 行 |
| `channel-display.e73f8a0f` | 写死 | 城市 × 品类 × 车型组 | 文字 | [channel-display.ts:90](../../apps/web/src/lib/channel-display.ts#L90) |
| `channel-display.bf7e748a` | 写死 | 城市 × 品类 | 文字 | [channel-display.ts:91](../../apps/web/src/lib/channel-display.ts#L91) |
| `channel-display.5020e82e` | 写死 | 全渠道（促销期） | 文字 | [channel-display.ts:92](../../apps/web/src/lib/channel-display.ts#L92) |
| `channel-display.1b9981bb` | 写死 | （供应商） | 文字 | [channel-display.ts:109](../../apps/web/src/lib/channel-display.ts#L109) |
| `channel-display.acd5ef84` | 写死 | （城市） | 文字 | [channel-display.ts:109](../../apps/web/src/lib/channel-display.ts#L109) |
| `channel-display.f5921fb0` | 写死 | （车型组） | 文字 | [channel-display.ts:109](../../apps/web/src/lib/channel-display.ts#L109) |
| `channel-display.c564bf43` | 写死 | 全渠道 | 文字 | [channel-display.ts:110](../../apps/web/src/lib/channel-display.ts#L110) |
| `channel-display.59707033` | 写死 | 不限 | 文字 | [channel-display.ts:114](../../apps/web/src/lib/channel-display.ts#L114)、116、188、399 行 |
| `channel-display.d934b5e4` | 写死 | {…} 至 {…} | 文字 | [channel-display.ts:116](../../apps/web/src/lib/channel-display.ts#L116) |
| `channel-display.1e387913` | 写死 | 默认加价比例 | 名称 | [channel-display.ts:133](../../apps/web/src/lib/channel-display.ts#L133)、403 行 |
| `channel-display.be2f228c` | 写死 | 加价下限 | 名称 | [channel-display.ts:134](../../apps/web/src/lib/channel-display.ts#L134)、404 行 |
| `channel-display.3686ff08` | 写死 | 价格带 δ | 名称 | [channel-display.ts:135](../../apps/web/src/lib/channel-display.ts#L135)、405 行 |
| `channel-display.40e41926` | 写死 | 最低毛利 | 名称 | [channel-display.ts:136](../../apps/web/src/lib/channel-display.ts#L136)、406 行 |
| `channel-display.d1311928` | 写死 | 不设 | 文字 | [channel-display.ts:136](../../apps/web/src/lib/channel-display.ts#L136)、393 行 |
| `channel-display.2f00ee7b` | 写死 | 不取整（四舍五入到最小单位） | 文字 | [channel-display.ts:137](../../apps/web/src/lib/channel-display.ts#L137) |
| `channel-display.4bc00b24` | 写死 | 向上取整到 {…} | 文字 | [channel-display.ts:137](../../apps/web/src/lib/channel-display.ts#L137)、397 行 |
| `channel-display.beb0cb57` | 写死 | 对外价取整 | 名称 | [channel-display.ts:137](../../apps/web/src/lib/channel-display.ts#L137)、407 行 |
| `channel-display.009b3d4c` | 写死 | 试运营 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.0765e309` | 写死 | 申请中 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.0bc5c8d2` | 写死 | 审核中 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.79f5e1f8` | 写死 | 已暂停 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.96a8e6d1` | 写死 | 已签约 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.9b8c7574` | 写死 | 已清退 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141)、147 行 |
| `channel-display.f9f8b992` | 写死 | 正式 | 文字 | [channel-display.ts:141](../../apps/web/src/lib/channel-display.ts#L141) |
| `channel-display.25565d71` | 写死 | 状态 | 名称 | [channel-display.ts:146](../../apps/web/src/lib/channel-display.ts#L146)、147、358、410 行 |
| `channel-display.8481ca98` | 写死 | 已暂停（人工暂停） | 文字 | [channel-display.ts:146](../../apps/web/src/lib/channel-display.ts#L146) |
| `channel-display.1780cd07` | 写死 | 版本 | 名称 | [channel-display.ts:150](../../apps/web/src/lib/channel-display.ts#L150) |
| `channel-display.b8caa837` | 写死 | （还没有合同） | 文字 | [channel-display.ts:150](../../apps/web/src/lib/channel-display.ts#L150) |
| `channel-display.cc29c798` | 写死 | 第 {…} 版 | 文字 | [channel-display.ts:150](../../apps/web/src/lib/channel-display.ts#L150) |
| `channel-display.3b66c91d` | 写死 | 生效日期 | 名称 | [channel-display.ts:151](../../apps/web/src/lib/channel-display.ts#L151) |
| `channel-display.664a89c5` | 写死 | 结算币种 | 名称 | [channel-display.ts:152](../../apps/web/src/lib/channel-display.ts#L152) |
| `channel-display.3bab9076` | 写死 | 月结，次月 20 日付款 | 文字 | [channel-display.ts:153](../../apps/web/src/lib/channel-display.ts#L153) |
| `channel-display.b0a56060` | 写死 | 结算周期 | 名称 | [channel-display.ts:153](../../apps/web/src/lib/channel-display.ts#L153) |
| `channel-display.eff87594` | 写死 | 未锁定（中央汇率 {…}） | 文字 | [channel-display.ts:171](../../apps/web/src/lib/channel-display.ts#L171) |
| `channel-display.58858220` | 写死 | 锁定值 | 名称 | [channel-display.ts:174](../../apps/web/src/lib/channel-display.ts#L174)、179 行 |
| `channel-display.5971d917` | 写死 | 解除，恢复用中央汇率（发起时 {…}） | 文字 | [channel-display.ts:174](../../apps/web/src/lib/channel-display.ts#L174) |
| `channel-display.bbd7cb22` | 写死 | 到期时间 | 名称 | [channel-display.ts:175](../../apps/web/src/lib/channel-display.ts#L175)、180 行 |
| `channel-display.09686f75` | 写死 | 和发起时中央汇率的偏离 | 名称 | [channel-display.ts:181](../../apps/web/src/lib/channel-display.ts#L181) |
| `channel-display.822cb3a7` | 写死 | {length} 个 | 文字 | [channel-display.ts:188](../../apps/web/src/lib/channel-display.ts#L188) |
| `channel-display.bf8a15b7` | 写死 | 一个都不看 | 文字 | [channel-display.ts:188](../../apps/web/src/lib/channel-display.ts#L188) |
| `channel-display.4c7968ef` | 写死 | 名字 | 名称 | [channel-display.ts:191](../../apps/web/src/lib/channel-display.ts#L191) |
| `channel-display.0adc62ea` | 写死 | 说明 | 名称 | [channel-display.ts:192](../../apps/web/src/lib/channel-display.ts#L192) |
| `channel-display.93c34514` | 写死 | （没有勾选） | 文字 | [channel-display.ts:193](../../apps/web/src/lib/channel-display.ts#L193) |
| `channel-display.cffd1e31` | 写死 | 权限 | 名称 | [channel-display.ts:193](../../apps/web/src/lib/channel-display.ts#L193) |
| `channel-display.bac43370` | 写死 | 数据范围：城市 | 名称 | [channel-display.ts:194](../../apps/web/src/lib/channel-display.ts#L194) |
| `channel-display.8456297d` | 写死 | 数据范围：渠道 | 名称 | [channel-display.ts:195](../../apps/web/src/lib/channel-display.ts#L195) |
| `channel-display.25601b83` | 写死 | IP 白名单 | 名称 | [channel-display.ts:196](../../apps/web/src/lib/channel-display.ts#L196) |
| `channel-display.29a78970` | 写死 | 不限制 | 文字 | [channel-display.ts:196](../../apps/web/src/lib/channel-display.ts#L196) |
| `channel-display.59411f0e` | 写死 | （免收取消费） | 文字 | [channel-display.ts:230](../../apps/web/src/lib/channel-display.ts#L230) |
| `channel-display.f5a679e7` | 写死 | 取消原因 | 名称 | [channel-display.ts:230](../../apps/web/src/lib/channel-display.ts#L230) |
| `channel-display.30db7528` | 写死 | {…}（按取消政策） | 文字 | [channel-display.ts:231](../../apps/web/src/lib/channel-display.ts#L231) |
| `channel-display.ea9beac4` | 写死 | 退给客人 | 名称 | [channel-display.ts:231](../../apps/web/src/lib/channel-display.ts#L231) |
| `channel-display.0e08df62` | 写死 | 订单状态 | 名称 | [channel-display.ts:239](../../apps/web/src/lib/channel-display.ts#L239)、269 行 |
| `channel-display.c82a4e66` | 写死 | 服务中 | 文字 | [channel-display.ts:239](../../apps/web/src/lib/channel-display.ts#L239)、269 行 |
| `channel-display.faffb46f` | 写死 | 司机已到达 | 文字 | [channel-display.ts:239](../../apps/web/src/lib/channel-display.ts#L239) |
| `channel-display.9f095acc` | 写死 | 发生时间（当地） | 名称 | [channel-display.ts:240](../../apps/web/src/lib/channel-display.ts#L240)、270 行 |
| `channel-display.9400ae52` | 写死 | 订单 | 名称 | [channel-display.ts:249](../../apps/web/src/lib/channel-display.ts#L249)、259、280 行 |
| `channel-display.008769b1` | 写死 | 收件邮箱 | 名称 | [channel-display.ts:250](../../apps/web/src/lib/channel-display.ts#L250) |
| `channel-display.a8dfb160` | 写死 | {…}（下单邮箱） | 文字 | [channel-display.ts:250](../../apps/web/src/lib/channel-display.ts#L250) |
| `channel-display.faaa871f` | 写死 | 没有下单邮箱 | 文字 | [channel-display.ts:250](../../apps/web/src/lib/channel-display.ts#L250) |
| `channel-display.c32b6f67` | 写死 | 核实方式 | 名称 | [channel-display.ts:251](../../apps/web/src/lib/channel-display.ts#L251)、261 行 |
| `channel-display.67aa44f6` | 写死 | 没有邮箱 | 文字 | [channel-display.ts:260](../../apps/web/src/lib/channel-display.ts#L260) |
| `channel-display.6d949a1f` | 写死 | 乘客邮箱 | 名称 | [channel-display.ts:260](../../apps/web/src/lib/channel-display.ts#L260) |
| `channel-display.8241dd39` | 写死 | 已完成 | 文字 | [channel-display.ts:269](../../apps/web/src/lib/channel-display.ts#L269) |
| `channel-display.6004ae35` | 写死 | 进供应商账单的结算价 | 名称 | [channel-display.ts:271](../../apps/web/src/lib/channel-display.ts#L271) |
| `channel-display.5f46a295` | 写死 | 实际时长和里程 | 名称 | [channel-display.ts:272](../../apps/web/src/lib/channel-display.ts#L272) |
| `channel-display.ca58d796` | 写死 | {…} 分钟、{…} 公里 | 文字 | [channel-display.ts:272](../../apps/web/src/lib/channel-display.ts#L272) |
| `channel-display.2f92b8a9` | 写死 | 救援供应商 | 名称 | [channel-display.ts:281](../../apps/web/src/lib/channel-display.ts#L281) |
| `channel-display.d20fef52` | 写死 | 候选都不接 | 文字 | [channel-display.ts:281](../../apps/web/src/lib/channel-display.ts#L281) |
| `channel-display.540f9e82` | 写死 | 结算价 | 名称 | [channel-display.ts:282](../../apps/web/src/lib/channel-display.ts#L282) |
| `channel-display.4941be52` | 写死 | 账单 | 名称 | [channel-display.ts:291](../../apps/web/src/lib/channel-display.ts#L291) |
| `channel-display.96467213` | 写死 | 合计 | 名称 | [channel-display.ts:292](../../apps/web/src/lib/channel-display.ts#L292)、319 行 |
| `channel-display.68de358d` | 写死 | 应付日 | 名称 | [channel-display.ts:293](../../apps/web/src/lib/channel-display.ts#L293) |
| `channel-display.9495f265` | 写死 | 币种 | 名称 | [channel-display.ts:302](../../apps/web/src/lib/channel-display.ts#L302) |
| `channel-display.cf10e3f6` | 写死 | 收款人 | 名称 | [channel-display.ts:303](../../apps/web/src/lib/channel-display.ts#L303) |
| `channel-display.351dd187` | 写死 | 收款人地址 | 名称 | [channel-display.ts:304](../../apps/web/src/lib/channel-display.ts#L304) |
| `channel-display.5db081eb` | 写死 | 银行 | 名称 | [channel-display.ts:305](../../apps/web/src/lib/channel-display.ts#L305) |
| `channel-display.fe6c58cb` | 写死 | 银行地址 | 名称 | [channel-display.ts:306](../../apps/web/src/lib/channel-display.ts#L306) |
| `channel-display.eb48bd39` | 写死 | 账号 | 名称 | [channel-display.ts:308](../../apps/web/src/lib/channel-display.ts#L308) |
| `channel-display.f4c802f0` | 写死 | 付款日 | 名称 | [channel-display.ts:318](../../apps/web/src/lib/channel-display.ts#L318) |
| `channel-display.c4842254` | 写死 | {currency} {…}（{length} 笔） | 文字 | [channel-display.ts:319](../../apps/web/src/lib/channel-display.ts#L319) |
| `channel-display.e69284c8` | 写死 | 手续费 | 名称 | [channel-display.ts:320](../../apps/web/src/lib/channel-display.ts#L320) |
| `channel-display.0f2562b9` | 写死 | 付款：{…} | 名称 | [channel-display.ts:322](../../apps/web/src/lib/channel-display.ts#L322) |
| `channel-display.39156643` | 写死 |  · 账户最近变更，请核实 | 文字 | [channel-display.ts:324](../../apps/web/src/lib/channel-display.ts#L324) |
| `channel-display.8b051920` | 写死 | 排除：{…} | 名称 | [channel-display.ts:326](../../apps/web/src/lib/channel-display.ts#L326) |
| `channel-display.5d166eae` | 写死 | {…}（赔对外价） | 名称 | [channel-display.ts:338](../../apps/web/src/lib/channel-display.ts#L338) |
| `channel-display.04df7d0a` | 写死 | 对外价的 {…} | 文字 | [channel-display.ts:340](../../apps/web/src/lib/channel-display.ts#L340) |
| `channel-display.d58fa8ca` | 写死 | 每笔至少等值 | 名称 | [channel-display.ts:341](../../apps/web/src/lib/channel-display.ts#L341) |
| `channel-display.10613d38` | 写死 | 替代交通报销上限 | 名称 | [channel-display.ts:342](../../apps/web/src/lib/channel-display.ts#L342) |
| `channel-display.7498cb69` | 写死 | 判定要复核的阈值（赔客人达到） | 名称 | [channel-display.ts:343](../../apps/web/src/lib/channel-display.ts#L343) |
| `channel-display.a70b2400` | 写死 | 成立 | 文字 | [channel-display.ts:347](../../apps/web/src/lib/channel-display.ts#L347) |
| `channel-display.a7de6ca4` | 写死 | 通过 | 文字 | [channel-display.ts:347](../../apps/web/src/lib/channel-display.ts#L347) |
| `channel-display.b8f8a537` | 写死 | 不成立 / 驳回 | 文字 | [channel-display.ts:347](../../apps/web/src/lib/channel-display.ts#L347) |
| `channel-display.cfe74088` | 写死 | 已处理 | 文字 | [channel-display.ts:347](../../apps/web/src/lib/channel-display.ts#L347) |
| `channel-display.99493d16` | 写死 | 平台 | 文字 | [channel-display.ts:355](../../apps/web/src/lib/channel-display.ts#L355) |
| `channel-display.f97d0a2b` | 写死 | 工单 | 名称 | [channel-display.ts:357](../../apps/web/src/lib/channel-display.ts#L357) |
| `channel-display.915dfca2` | 写死 | 已判定 | 文字 | [channel-display.ts:358](../../apps/web/src/lib/channel-display.ts#L358) |
| `channel-display.24dcf164` | 写死 | 结论 | 名称 | [channel-display.ts:359](../../apps/web/src/lib/channel-display.ts#L359) |
| `channel-display.c8e6b2ae` | 写死 | 情形 · 责任方 | 名称 | [channel-display.ts:360](../../apps/web/src/lib/channel-display.ts#L360) |
| `channel-display.b4d3c13d` | 写死 | 赔客人 | 名称 | [channel-display.ts:361](../../apps/web/src/lib/channel-display.ts#L361) |
| `channel-display.1ca24d4c` | 写死 | 其中退回原卡 | 名称 | [channel-display.ts:362](../../apps/web/src/lib/channel-display.ts#L362) |
| `channel-display.ce34662f` | 写死 | 其中财务另付 | 名称 | [channel-display.ts:363](../../apps/web/src/lib/channel-display.ts#L363) |
| `channel-display.55737ed1` | 写死 | （空） | 文字 | [channel-display.ts:370](../../apps/web/src/lib/channel-display.ts#L370) |
| `channel-display.8d7dbeee` | 写死 | 两步验证 | 名称 | [channel-display.ts:385](../../apps/web/src/lib/channel-display.ts#L385) |
| `channel-display.a686fb30` | 写死 | 已绑定 | 文字 | [channel-display.ts:385](../../apps/web/src/lib/channel-display.ts#L385) |
| `channel-display.bd38175f` | 写死 | 清掉（下次登录重新绑定） | 文字 | [channel-display.ts:385](../../apps/web/src/lib/channel-display.ts#L385) |
| `channel-display.e55b9a06` | 写死 | 不取整 | 文字 | [channel-display.ts:397](../../apps/web/src/lib/channel-display.ts#L397) |
| `channel-display.441fd601` | 写死 | 加价比例 | 名称 | [channel-display.ts:412](../../apps/web/src/lib/channel-display.ts#L412) |
| `channel-display.b00e5304` | 写死 | 开始日期 | 名称 | [channel-display.ts:413](../../apps/web/src/lib/channel-display.ts#L413) |
| `channel-display.4ca3f3a3` | 写死 | 结束日期 | 名称 | [channel-display.ts:414](../../apps/web/src/lib/channel-display.ts#L414) |
| `channel-display.46ac8cba` | 写死 | 备注 | 名称 | [channel-display.ts:415](../../apps/web/src/lib/channel-display.ts#L415) |
| `channel-display.927bdf62` | 写死 | （删除） | 文字 | [channel-display.ts:418](../../apps/web/src/lib/channel-display.ts#L418) |
| `channel-display.ba4cf1fe` | 写死 | 全部品类 | 文字 | [channel-display.ts:423](../../apps/web/src/lib/channel-display.ts#L423) |
| `channel-display.72a35632` | 写死 | 第 {level} 级 · {…} = {…}（用车日期 {…}） | 文字 | [channel-display.ts:447](../../apps/web/src/lib/channel-display.ts#L447) |
| `channel-display.c29f2f1a` | 写死 | 有一条规则这里还没有显示（可能刚被改过），刷新页面后再看 | 文字 | [channel-display.ts:447](../../apps/web/src/lib/channel-display.ts#L447) |

## 包车机场开始 / 机场结束套餐的固定文案（charter-airport-copy.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/charter-airport-copy.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter.scenario.airportStart` | 已走 key | {airport}接机 + {hours} 小时包车 | 文字 | [charter-airport-copy.ts:8](../../apps/web/src/lib/charter-airport-copy.ts#L8) |
| `charter.scenario.airportEnd` | 已走 key | {hours} 小时包车 + {airport}送机 | 文字 | [charter-airport-copy.ts:9](../../apps/web/src/lib/charter-airport-copy.ts#L9) |
| `book.charter.quickAirportStart` | 已走 key | 机场接机开始 | 文字 | [charter-airport-copy.ts:10](../../apps/web/src/lib/charter-airport-copy.ts#L10) |
| `book.charter.quickAirportEnd` | 已走 key | 机场送机结束 | 文字 | [charter-airport-copy.ts:11](../../apps/web/src/lib/charter-airport-copy.ts#L11) |
| `book.charter.searchAirportHint` | 已走 key | 在上面的「{label}」里输入机场名称或地址（任何语言都可以，如 成田机场、Narita Airport、羽田第 3 ターミナル），选中后自动识别机场和航站楼 | 说明 | [charter-airport-copy.ts:12](../../apps/web/src/lib/charter-airport-copy.ts#L12) |
| `book.charter.matchingAirport` | 已走 key | 正在识别机场… | 文字 | [charter-airport-copy.ts:13](../../apps/web/src/lib/charter-airport-copy.ts#L13) |
| `book.charter.recognized` | 已走 key | 已识别：{place} | 文字 | [charter-airport-copy.ts:14](../../apps/web/src/lib/charter-airport-copy.ts#L14) |
| `book.charter.noAirport` | 已走 key | 没有认出这是哪个机场。可以照常询价（价格按这个地点算），也可以换一个地点 | 文字 | [charter-airport-copy.ts:15](../../apps/web/src/lib/charter-airport-copy.ts#L15) |
| `book.charter.matchFailed` | 已走 key | 机场识别暂时用不了，可以照常询价（价格按这个地点算） | 提示 | [charter-airport-copy.ts:16](../../apps/web/src/lib/charter-airport-copy.ts#L16) |
| `book.charter.anyTerminal` | 已走 key | 不指定航站楼 | 文字 | [charter-airport-copy.ts:17](../../apps/web/src/lib/charter-airport-copy.ts#L17) |
| `book.charter.terminalOptional` | 已走 key | 航站楼，选填 | 文字 | [charter-airport-copy.ts:18](../../apps/web/src/lib/charter-airport-copy.ts#L18) |
| `book.charter.terminalFreeHint` | 已走 key | 这个机场没有登记航站楼，知道的话写上（如 第 1 航站楼），不知道可以空着 | 说明 | [charter-airport-copy.ts:19](../../apps/web/src/lib/charter-airport-copy.ts#L19) |
| `book.charter.terminalFromName` | 已走 key | 已按选中地点的名称填上航站楼，不对可以改 | 名称 | [charter-airport-copy.ts:20](../../apps/web/src/lib/charter-airport-copy.ts#L20) |
| `book.charter.quickExit` | 已走 key | 改填其他地点 | 文字 | [charter-airport-copy.ts:21](../../apps/web/src/lib/charter-airport-copy.ts#L21) |
| `book.notes.flightHint` | 已走 key | 如需司机知道航班号，请填在这里 | 说明 | [charter-airport-copy.ts:22](../../apps/web/src/lib/charter-airport-copy.ts#L22) |
| `book.charter.airportTimingHint` | 已走 key | 包车从预约的上车时间开始计时，没有免费等待。建议把上车时间定在航班落地后 60–90 分钟（国内航班约 60 分钟，国际航班约 90 分钟，留出入境和取行李的时间）；航班可能延误时请再多留一些，或下单前联系客服 | 说明 | [charter-airport-copy.ts:23](../../apps/web/src/lib/charter-airport-copy.ts#L23) |
| `order.charterScenario.airportStart` | 已走 key | {airport}接机 | 文字 | [charter-airport-copy.ts:24](../../apps/web/src/lib/charter-airport-copy.ts#L24) |
| `order.charterScenario.airportEnd` | 已走 key | {airport}送机 | 文字 | [charter-airport-copy.ts:25](../../apps/web/src/lib/charter-airport-copy.ts#L25) |
| `order.charterScenario.own` | 已走 key | 单独定价，已含{end}加价 | 文字 | [charter-airport-copy.ts:26](../../apps/web/src/lib/charter-airport-copy.ts#L26) |
| `order.charterScenario.inherit` | 已走 key | 继承普通套餐价 | 文字 | [charter-airport-copy.ts:27](../../apps/web/src/lib/charter-airport-copy.ts#L27) |
| `order.charterScenario.line` | 已走 key | 机场套餐：{what}（{how}） | 文字 | [charter-airport-copy.ts:28](../../apps/web/src/lib/charter-airport-copy.ts#L28) |
| `order.charterScenario.endPickup` | 已走 key | 上车 | 文字 | [charter-airport-copy.ts:29](../../apps/web/src/lib/charter-airport-copy.ts#L29) |
| `order.charterScenario.endDropoff` | 已走 key | 下车 | 文字 | [charter-airport-copy.ts:30](../../apps/web/src/lib/charter-airport-copy.ts#L30) |
| `order.charterScenario.included` | 已走 key | 含在机场套餐里，不另加 | 文字 | [charter-airport-copy.ts:31](../../apps/web/src/lib/charter-airport-copy.ts#L31) |
| `tenant.charterAirport.title` | 已走 key | 机场套餐 | 标题 | [charter-airport-copy.ts:33](../../apps/web/src/lib/charter-airport-copy.ts#L33) |
| `tenant.charterAirport.lead` | 已走 key | 上车点在这里绑定的机场区域里 = 机场接机开始，下车点在里面 = 机场送机结束；价格页第四张表「机场套餐价」可以按机场单独定价。机场区域只用来判断上下车点在不在机场，要整块落在本商品的服务区域或上下车加价区域里。 | 说明 | [charter-airport-copy.ts:34](../../apps/web/src/lib/charter-airport-copy.ts#L34) |
| `tenant.charterAirport.leadPlatform` | 已走 key | 上车点在这些机场区域里 = 机场接机开始，下车点在里面 = 机场送机结束；机场套餐价见价格页第四张表。 | 说明 | [charter-airport-copy.ts:35](../../apps/web/src/lib/charter-airport-copy.ts#L35) |
| `tenant.charterAirport.notMigrated` | 已走 key | 迁移三层区域后可用 | 文字 | [charter-airport-copy.ts:36](../../apps/web/src/lib/charter-airport-copy.ts#L36) |
| `tenant.charterAirport.group.airportStart` | 已走 key | 机场开始（机场接机开始） | 文字 | [charter-airport-copy.ts:37](../../apps/web/src/lib/charter-airport-copy.ts#L37) |
| `tenant.charterAirport.group.airportEnd` | 已走 key | 机场结束（机场送机结束） | 文字 | [charter-airport-copy.ts:38](../../apps/web/src/lib/charter-airport-copy.ts#L38) |
| `tenant.charterAirport.scenario` | 已走 key | 场景 | 文字 | [charter-airport-copy.ts:39](../../apps/web/src/lib/charter-airport-copy.ts#L39) |
| `tenant.charterAirport.status` | 已走 key | 状态 | 文字 | [charter-airport-copy.ts:40](../../apps/web/src/lib/charter-airport-copy.ts#L40) |
| `tenant.charterAirport.scenario.airportStart` | 已走 key | 机场开始 | 文字 | [charter-airport-copy.ts:41](../../apps/web/src/lib/charter-airport-copy.ts#L41) |
| `tenant.charterAirport.scenario.airportEnd` | 已走 key | 机场结束 | 文字 | [charter-airport-copy.ts:42](../../apps/web/src/lib/charter-airport-copy.ts#L42) |
| `tenant.charterAirport.airport` | 已走 key | 机场 | 文字 | [charter-airport-copy.ts:43](../../apps/web/src/lib/charter-airport-copy.ts#L43) |
| `tenant.charterAirport.area` | 已走 key | 机场区域 | 文字 | [charter-airport-copy.ts:44](../../apps/web/src/lib/charter-airport-copy.ts#L44) |
| `tenant.charterAirport.shortName` | 已走 key | 中文简称（选填） | 名称 | [charter-airport-copy.ts:45](../../apps/web/src/lib/charter-airport-copy.ts#L45) |
| `tenant.charterAirport.shortNameHint` | 已走 key | 前台名称里的机场名，如「成田机场」；不填用主数据的中文名，最多 {max} 字 | 说明 | [charter-airport-copy.ts:46](../../apps/web/src/lib/charter-airport-copy.ts#L46) |
| `tenant.charterAirport.pickAirport` | 已走 key | 选择机场 | 文字 | [charter-airport-copy.ts:47](../../apps/web/src/lib/charter-airport-copy.ts#L47) |
| `tenant.charterAirport.pickArea` | 已走 key | 选择机场区域 | 文字 | [charter-airport-copy.ts:48](../../apps/web/src/lib/charter-airport-copy.ts#L48) |
| `tenant.charterAirport.disabledOption` | 已走 key | {name}（已停用） | 文字 | [charter-airport-copy.ts:49](../../apps/web/src/lib/charter-airport-copy.ts#L49) |
| `tenant.charterAirport.add` | 已走 key | 添加机场 | 文字 | [charter-airport-copy.ts:50](../../apps/web/src/lib/charter-airport-copy.ts#L50) |
| `tenant.charterAirport.remove` | 已走 key | 删除 | 文字 | [charter-airport-copy.ts:51](../../apps/web/src/lib/charter-airport-copy.ts#L51) |
| `tenant.charterAirport.removeLabel` | 已走 key | 删除{group}第 {index} 个机场 | 名称 | [charter-airport-copy.ts:52](../../apps/web/src/lib/charter-airport-copy.ts#L52) |
| `tenant.charterAirport.rowLabel` | 已走 key | {group}第 {index} 个机场的{field} | 名称 | [charter-airport-copy.ts:53](../../apps/web/src/lib/charter-airport-copy.ts#L53) |
| `tenant.charterAirport.save` | 已走 key | 保存机场套餐 | 文字 | [charter-airport-copy.ts:54](../../apps/web/src/lib/charter-airport-copy.ts#L54) |
| `tenant.charterAirport.saved` | 已走 key | 机场套餐已保存 | 文字 | [charter-airport-copy.ts:55](../../apps/web/src/lib/charter-airport-copy.ts#L55) |
| `tenant.charterAirport.unsaved` | 已走 key | 机场套餐有未保存的修改 | 文字 | [charter-airport-copy.ts:56](../../apps/web/src/lib/charter-airport-copy.ts#L56) |
| `tenant.charterAirport.empty` | 已走 key | 还没有绑定机场 | 空状态 | [charter-airport-copy.ts:57](../../apps/web/src/lib/charter-airport-copy.ts#L57) |
| `tenant.charterAirport.ineffective` | 已走 key | 机场区域或机场已停用，报价时这条不生效 | 文字 | [charter-airport-copy.ts:58](../../apps/web/src/lib/charter-airport-copy.ts#L58) |
| `tenant.charterAirport.loadFailed` | 已走 key | 机场套餐没有加载出来 | 提示 | [charter-airport-copy.ts:59](../../apps/web/src/lib/charter-airport-copy.ts#L59) |
| `tenant.charterAirport.retry` | 已走 key | 重试 | 文字 | [charter-airport-copy.ts:60](../../apps/web/src/lib/charter-airport-copy.ts#L60) |
| `tenant.charterAirport.reload` | 已走 key | 重新读取 | 文字 | [charter-airport-copy.ts:61](../../apps/web/src/lib/charter-airport-copy.ts#L61) |
| `tenant.charterAirport.required.airport` | 已走 key | 请选择机场 | 文字 | [charter-airport-copy.ts:62](../../apps/web/src/lib/charter-airport-copy.ts#L62) |
| `tenant.charterAirport.required.area` | 已走 key | 请选择机场区域 | 文字 | [charter-airport-copy.ts:63](../../apps/web/src/lib/charter-airport-copy.ts#L63) |
| `tenant.charterAirport.shortNameTooLong` | 已走 key | 中文简称最多 {max} 字 | 文字 | [charter-airport-copy.ts:64](../../apps/web/src/lib/charter-airport-copy.ts#L64) |
| `tenant.charterAirport.tooMany` | 已走 key | 一个场景最多绑 {max} 个机场 | 文字 | [charter-airport-copy.ts:65](../../apps/web/src/lib/charter-airport-copy.ts#L65) |
| `tenant.charterAirport.duplicateAirport` | 已走 key | 同一场景里这个机场绑了两次 | 文字 | [charter-airport-copy.ts:66](../../apps/web/src/lib/charter-airport-copy.ts#L66) |
| `tenant.charterAirport.duplicateArea` | 已走 key | 同一场景里一个机场区域只能绑一个机场 | 文字 | [charter-airport-copy.ts:67](../../apps/web/src/lib/charter-airport-copy.ts#L67) |
| `tenant.charterAirport.notSaved` | 已走 key | 没有保存。 | 文字 | [charter-airport-copy.ts:68](../../apps/web/src/lib/charter-airport-copy.ts#L68) |
| `tenant.charterAirport.fixBelow` | 已走 key | 有 {count} 处要改，见下面标红的地方。 | 文字 | [charter-airport-copy.ts:69](../../apps/web/src/lib/charter-airport-copy.ts#L69) |
| `tenant.charterAirport.versionConflict` | 已走 key | 别人刚改过这个商品，请点「重新读取」后再保存。 | 文字 | [charter-airport-copy.ts:70](../../apps/web/src/lib/charter-airport-copy.ts#L70) |
| `tenant.charterAirport.pricesExist` | 已走 key | 解绑的机场还有机场套餐价，请先在价格页删掉这些机场的机场套餐价，再解绑。 | 文字 | [charter-airport-copy.ts:71](../../apps/web/src/lib/charter-airport-copy.ts#L71) |
| `tenant.charterAirport.layoutNotMigrated` | 已走 key | 这个商品还没有迁移到三层区域，不能设机场套餐。 | 文字 | [charter-airport-copy.ts:72](../../apps/web/src/lib/charter-airport-copy.ts#L72) |
| `tenant.charterAirport.platformEmpty` | 已走 key | 没有绑定机场 | 空状态 | [charter-airport-copy.ts:73](../../apps/web/src/lib/charter-airport-copy.ts#L73) |
| `tenant.charterAirport.prices.title` | 已走 key | 机场套餐价 | 标题 | [charter-airport-copy.ts:75](../../apps/web/src/lib/charter-airport-copy.ts#L75) |
| `tenant.charterAirport.prices.lead` | 已走 key | 按场景 × 机场 × 车型组填，列是套餐时长。填了的格是单独价：替换普通套餐价，免掉这一端的上 / 下车加价；空格 = 继承（普通套餐价 + 这一端的加价），灰字是继承后的价。单独价高于继承价的格标黄。含公里、超公里、超时单价不填 = 同普通套餐。 | 说明 | [charter-airport-copy.ts:76](../../apps/web/src/lib/charter-airport-copy.ts#L76) |
| `tenant.charterAirport.prices.import` | 已走 key | 也可以用价格表导入：「机场场景」一列填「机场开始 / 机场结束」的行就是机场套餐价。 | 文字 | [charter-airport-copy.ts:77](../../apps/web/src/lib/charter-airport-copy.ts#L77) |
| `tenant.charterAirport.prices.noBindings` | 已走 key | 还没有绑定机场。先在「① 基础信息」的「机场套餐」里绑定机场，再回来填机场套餐价。 | 文字 | [charter-airport-copy.ts:78](../../apps/web/src/lib/charter-airport-copy.ts#L78) |
| `tenant.charterAirport.prices.noPackages` | 已走 key | 还没有套餐时长：先在上面「套餐价」里加套餐。 | 文字 | [charter-airport-copy.ts:79](../../apps/web/src/lib/charter-airport-copy.ts#L79) |
| `tenant.charterAirport.prices.loadFailed` | 已走 key | 机场套餐价要用的机场绑定没有加载出来 | 提示 | [charter-airport-copy.ts:80](../../apps/web/src/lib/charter-airport-copy.ts#L80) |
| `tenant.charterAirport.prices.groupHeader` | 已走 key | 车型组 | 文字 | [charter-airport-copy.ts:81](../../apps/web/src/lib/charter-airport-copy.ts#L81) |
| `tenant.charterAirport.prices.hoursHeader` | 已走 key | {hours} 小时（{currency}） | 文字 | [charter-airport-copy.ts:82](../../apps/web/src/lib/charter-airport-copy.ts#L82) |
| `tenant.charterAirport.prices.rowLabel` | 已走 key | {title} · {scenario} · {airport} · {group} · {hours} 小时 | 名称 | [charter-airport-copy.ts:83](../../apps/web/src/lib/charter-airport-copy.ts#L83) |
| `tenant.charterAirport.prices.groupRow` | 已走 key | {scenario} · {airport}（机场区域：{area}） | 文字 | [charter-airport-copy.ts:84](../../apps/web/src/lib/charter-airport-copy.ts#L84) |
| `tenant.charterAirport.prices.cellLabel` | 已走 key | {scenario} · {airport} · {group} · {hours} 小时 的单独价 | 名称 | [charter-airport-copy.ts:85](../../apps/web/src/lib/charter-airport-copy.ts#L85) |
| `tenant.charterAirport.prices.unitLabel` | 已走 key | {scenario} · {airport} · {group} · {hours} 小时 的{field} | 名称 | [charter-airport-copy.ts:86](../../apps/web/src/lib/charter-airport-copy.ts#L86) |
| `tenant.charterAirport.prices.inherit` | 已走 key | 继承：{parts} | 文字 | [charter-airport-copy.ts:87](../../apps/web/src/lib/charter-airport-copy.ts#L87) |
| `tenant.charterAirport.prices.inheritTotal` | 已走 key | 继承 {amount} | 文字 | [charter-airport-copy.ts:88](../../apps/web/src/lib/charter-airport-copy.ts#L88) |
| `tenant.charterAirport.prices.part.normal` | 已走 key | 普通 {amount} | 文字 | [charter-airport-copy.ts:89](../../apps/web/src/lib/charter-airport-copy.ts#L89) |
| `tenant.charterAirport.prices.part.pickup` | 已走 key | 上车加价 {amount} | 文字 | [charter-airport-copy.ts:90](../../apps/web/src/lib/charter-airport-copy.ts#L90) |
| `tenant.charterAirport.prices.part.dropoff` | 已走 key | 下车加价 {amount} | 文字 | [charter-airport-copy.ts:91](../../apps/web/src/lib/charter-airport-copy.ts#L91) |
| `tenant.charterAirport.prices.inheritUnknown` | 已走 key | 继承：{reason} | 文字 | [charter-airport-copy.ts:92](../../apps/web/src/lib/charter-airport-copy.ts#L92) |
| `tenant.charterAirport.prices.reason.noNormal` | 已走 key | 这个时长没有普通套餐价，空着报不出 | 文字 | [charter-airport-copy.ts:93](../../apps/web/src/lib/charter-airport-copy.ts#L93) |
| `tenant.charterAirport.prices.reason.noLocation` | 已走 key | 机场位置或区域图形没有取到，算不出继承价 | 文字 | [charter-airport-copy.ts:94](../../apps/web/src/lib/charter-airport-copy.ts#L94) |
| `tenant.charterAirport.prices.reason.noSurcharge` | 已走 key | 这一端没有能用的上 / 下车加价，空着报不出 | 文字 | [charter-airport-copy.ts:95](../../apps/web/src/lib/charter-airport-copy.ts#L95) |
| `tenant.charterAirport.prices.higher` | 已走 key | 高于继承价 {amount} | 文字 | [charter-airport-copy.ts:96](../../apps/web/src/lib/charter-airport-copy.ts#L96) |
| `tenant.charterAirport.prices.units` | 已走 key | 单价 | 文字 | [charter-airport-copy.ts:97](../../apps/web/src/lib/charter-airport-copy.ts#L97) |
| `tenant.charterAirport.prices.unitsOpen` | 已走 key | 展开单价：{label} | 文字 | [charter-airport-copy.ts:98](../../apps/web/src/lib/charter-airport-copy.ts#L98) |
| `tenant.charterAirport.prices.unitsHint` | 已走 key | 不填 = 同普通套餐 | 说明 | [charter-airport-copy.ts:99](../../apps/web/src/lib/charter-airport-copy.ts#L99) |
| `tenant.charterAirport.prices.field.price` | 已走 key | 单独价 | 文字 | [charter-airport-copy.ts:100](../../apps/web/src/lib/charter-airport-copy.ts#L100) |
| `tenant.charterAirport.prices.field.km` | 已走 key | 含公里 | 文字 | [charter-airport-copy.ts:101](../../apps/web/src/lib/charter-airport-copy.ts#L101) |
| `tenant.charterAirport.prices.field.overKm` | 已走 key | 超公里每公里 | 文字 | [charter-airport-copy.ts:102](../../apps/web/src/lib/charter-airport-copy.ts#L102) |
| `tenant.charterAirport.prices.field.overtime` | 已走 key | 超时每小时 | 文字 | [charter-airport-copy.ts:103](../../apps/web/src/lib/charter-airport-copy.ts#L103) |
| `tenant.charterAirport.prices.priceRequired` | 已走 key | 填了单价就要填单独价（单价只在单独定价时有用） | 提示 | [charter-airport-copy.ts:104](../../apps/web/src/lib/charter-airport-copy.ts#L104) |
| `tenant.charterAirport.prices.kmInvalid` | 已走 key | 含公里请填 1–{max} 的整数 | 提示 | [charter-airport-copy.ts:105](../../apps/web/src/lib/charter-airport-copy.ts#L105) |
| `tenant.charterAirport.prices.otherSegments` | 已走 key | 另有 {count} 段其他日期的价格，用价格表导入导出修改 | 文字 | [charter-airport-copy.ts:106](../../apps/web/src/lib/charter-airport-copy.ts#L106) |
| `tenant.charterAirport.prices.unsaved` | 已走 key | 改过，未保存 | 文字 | [charter-airport-copy.ts:107](../../apps/web/src/lib/charter-airport-copy.ts#L107) |
| `tenant.charterAirport.prices.deleted` | 已走 key | 将删除，改回继承 | 文字 | [charter-airport-copy.ts:108](../../apps/web/src/lib/charter-airport-copy.ts#L108) |
| `tenant.charterAirport.prices.enabled` | 已走 key | 启用 | 文字 | [charter-airport-copy.ts:109](../../apps/web/src/lib/charter-airport-copy.ts#L109) |
| `tenant.charterAirport.prices.disabled` | 已走 key | 已停用 | 文字 | [charter-airport-copy.ts:110](../../apps/web/src/lib/charter-airport-copy.ts#L110) |
| `tenant.charterAirport.prices.upcoming` | 已走 key | {date} 起生效 | 文字 | [charter-airport-copy.ts:111](../../apps/web/src/lib/charter-airport-copy.ts#L111) |
| `tenant.charterAirport.prices.expired` | 已走 key | 已过期 | 文字 | [charter-airport-copy.ts:112](../../apps/web/src/lib/charter-airport-copy.ts#L112) |
| `tenant.charterAirport.prices.expiring` | 已走 key | {date} 到期 | 文字 | [charter-airport-copy.ts:113](../../apps/web/src/lib/charter-airport-copy.ts#L113) |
| `tenant.charterAirport.prices.overlap` | 已走 key | 和这一格别的日期的价格重叠 | 文字 | [charter-airport-copy.ts:114](../../apps/web/src/lib/charter-airport-copy.ts#L114) |
| `tenant.charterAirport.prices.ineffective` | 已走 key | 绑定已停用，报价时不生效 | 文字 | [charter-airport-copy.ts:115](../../apps/web/src/lib/charter-airport-copy.ts#L115) |

## 包车经停点和按行程计价（charter-itinerary.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/charter-itinerary.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-itinerary.effb082f` | 写死 | 价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。 | 说明 | [charter-itinerary.ts:35](../../apps/web/src/lib/charter-itinerary.ts#L35) |
| `charter-itinerary.2c71536f` | 写死 | {rest} 分钟 | 文字 | [charter-itinerary.ts:63](../../apps/web/src/lib/charter-itinerary.ts#L63)、83 行 |
| `charter-itinerary.0b85d658` | 写死 | {hours} 小时 | 文字 | [charter-itinerary.ts:64](../../apps/web/src/lib/charter-itinerary.ts#L64)、84 行 |
| `charter-itinerary.df5e171b` | 写死 | {hours} 小时 {rest} 分钟 | 文字 | [charter-itinerary.ts:64](../../apps/web/src/lib/charter-itinerary.ts#L64) |
| `charter-itinerary.6374708f` | 写死 | （含缓冲） | 文字 | [charter-itinerary.ts:75](../../apps/web/src/lib/charter-itinerary.ts#L75) |
| `charter-itinerary.e57ebd8b` | 写死 | 预计用时 {…}{…} | 文字 | [charter-itinerary.ts:75](../../apps/web/src/lib/charter-itinerary.ts#L75) |
| `charter-itinerary.2fbf6dd9` | 写死 | {text}，超过套餐时长，超出部分服务后按实际收取 | 文字 | [charter-itinerary.ts:76](../../apps/web/src/lib/charter-itinerary.ts#L76) |
| `charter-itinerary.011f3ac7` | 写死 | {hours} 小时 {rest} 分 | 文字 | [charter-itinerary.ts:84](../../apps/web/src/lib/charter-itinerary.ts#L84) |
| `charter-itinerary.3eebbf4b` | 写死 | 请选择第 {…} 个经停点，或删除这一行 | 文字 | [charter-itinerary.ts:94](../../apps/web/src/lib/charter-itinerary.ts#L94) |
| `charter-itinerary.5ba33dd8` | 写死 | 请选择停留时长 | 文字 | [charter-itinerary.ts:95](../../apps/web/src/lib/charter-itinerary.ts#L95) |
| `charter-itinerary.af61e6aa` | 写死 | 自动（{own} 小时） | 名称 | [charter-itinerary.ts:157](../../apps/web/src/lib/charter-itinerary.ts#L157) |
| `charter-itinerary.8c68105d` | 写死 | 自动（{low} 小时） | 名称 | [charter-itinerary.ts:163](../../apps/web/src/lib/charter-itinerary.ts#L163) |
| `charter-itinerary.c8f6d108` | 写死 | 自动（按车型 {low}–{high} 小时） | 名称 | [charter-itinerary.ts:163](../../apps/web/src/lib/charter-itinerary.ts#L163) |
| `charter-itinerary.cd65c6f8` | 写死 | {…} 公里 | 文字 | [charter-itinerary.ts:178](../../apps/web/src/lib/charter-itinerary.ts#L178) |
| `charter-itinerary.5010a909` | 写死 | （行驶 {…} + 停留 {…}） | 文字 | [charter-itinerary.ts:184](../../apps/web/src/lib/charter-itinerary.ts#L184) |
| `charter-itinerary.0833d293` | 写死 | 按行程预计 {…}{parts}，全程约 {…}{…} | 文字 | [charter-itinerary.ts:185](../../apps/web/src/lib/charter-itinerary.ts#L185) |
| `charter-itinerary.8eb0dfe1` | 写死 | ，套餐 {packageHours} 小时 | 文字 | [charter-itinerary.ts:185](../../apps/web/src/lib/charter-itinerary.ts#L185) |
| `charter-itinerary.e03c35c3` | 写死 | 全程约 {…}，预计 {…}（含停留） | 文字 | [charter-itinerary.ts:191](../../apps/web/src/lib/charter-itinerary.ts#L191) |
| `charter-itinerary.5cd0844b` | 写死 | 有一段 | 文字 | [charter-itinerary.ts:203](../../apps/web/src/lib/charter-itinerary.ts#L203) |
| `charter-itinerary.eaaa5e27` | 写死 | {where}路线暂时算不出来，没有在线报价。请联系客服人工报价，或调整经停点再试。 | 提示 | [charter-itinerary.ts:204](../../apps/web/src/lib/charter-itinerary.ts#L204) |
| `charter-itinerary.7083b9d3` | 写死 | 上车加价 | 文字 | [charter-itinerary.ts:216](../../apps/web/src/lib/charter-itinerary.ts#L216) |
| `charter-itinerary.b9589c19` | 写死 | 下车加价 | 文字 | [charter-itinerary.ts:217](../../apps/web/src/lib/charter-itinerary.ts#L217) |
| `charter-itinerary.850c1f0f` | 写死 | 行程加价 | 文字 | [charter-itinerary.ts:218](../../apps/web/src/lib/charter-itinerary.ts#L218) |
| `charter-itinerary.8555f0f0` | 写死 | 超公里费 | 文字 | [charter-itinerary.ts:219](../../apps/web/src/lib/charter-itinerary.ts#L219) |
| `charter-itinerary.775eef59` | 写死 | 超时费 | 文字 | [charter-itinerary.ts:220](../../apps/web/src/lib/charter-itinerary.ts#L220) |
| `charter-itinerary.4e1f8373` | 写死 | 调价 | 文字 | [charter-itinerary.ts:221](../../apps/web/src/lib/charter-itinerary.ts#L221) |
| `charter-itinerary.ea33a6b1` | 写死 | 其他费用（加急、夜间、附加服务等） | 文字 | [charter-itinerary.ts:222](../../apps/web/src/lib/charter-itinerary.ts#L222) |
| `charter-itinerary.4145f2ee` | 写死 | 包车套餐 {packageHours} 小时 | 文字 | [charter-itinerary.ts:276](../../apps/web/src/lib/charter-itinerary.ts#L276) |
| `charter-itinerary.cce751e3` | 写死 | 基础价 | 文字 | [charter-itinerary.ts:276](../../apps/web/src/lib/charter-itinerary.ts#L276) |
| `charter-itinerary.f20e5eb8` | 写死 | 下车点 | 文字 | [charter-itinerary.ts:279](../../apps/web/src/lib/charter-itinerary.ts#L279) |
| `charter-itinerary.46c1894d` | 写死 | 其他费用 | 文字 | [charter-itinerary.ts:281](../../apps/web/src/lib/charter-itinerary.ts#L281) |
| `charter-itinerary.00974e63` | 写死 | 有经停点暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。 | 文字 | [charter-itinerary.ts:361](../../apps/web/src/lib/charter-itinerary.ts#L361) |
| `charter-itinerary.34e28860` | 写死 | {…}暂时没有在线报价，请联系客服人工报价，或去掉这个经停点再试。 | 文字 | [charter-itinerary.ts:362](../../apps/web/src/lib/charter-itinerary.ts#L362) |
| `charter-itinerary.41b16e16` | 写死 | ，选 {chosenHours} 小时订不了 | 文字 | [charter-itinerary.ts:383](../../apps/web/src/lib/charter-itinerary.ts#L383) |
| `charter-itinerary.996007df` | 写死 | 有 {count} 个车型 | 文字 | [charter-itinerary.ts:383](../../apps/web/src/lib/charter-itinerary.ts#L383) |
| `charter-itinerary.d4e5a6d6` | 写死 | 有一个车型 | 文字 | [charter-itinerary.ts:383](../../apps/web/src/lib/charter-itinerary.ts#L383) |
| `charter-itinerary.df14c3aa` | 写死 | {…}最短 {hours} 小时{…}。 | 文字 | [charter-itinerary.ts:383](../../apps/web/src/lib/charter-itinerary.ts#L383) |

## 包车三层区域的价格页模型（charter-layers.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/charter-layers.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-layers.24210ca8` | 写死 | 上车加价 | 文字 | [charter-layers.ts:24](../../apps/web/src/lib/charter-layers.ts#L24) |
| `charter-layers.4b64d28f` | 写死 | 行程加价 | 文字 | [charter-layers.ts:24](../../apps/web/src/lib/charter-layers.ts#L24)、28 行 |
| `charter-layers.a36c4b87` | 写死 | 下车加价 | 文字 | [charter-layers.ts:24](../../apps/web/src/lib/charter-layers.ts#L24) |
| `charter-layers.0b1f8899` | 写死 | 上下车加价 | 标题 | [charter-layers.ts:29](../../apps/web/src/lib/charter-layers.ts#L29) |
| `charter-layers.aee2f9ca` | 写死 | 套餐价 | 标题 | [charter-layers.ts:30](../../apps/web/src/lib/charter-layers.ts#L30) |
| `charter-layers.894122e3` | 写死 | 空 = 不报价 | 空状态 | [charter-layers.ts:31](../../apps/web/src/lib/charter-layers.ts#L31) |
| `charter-layers.578e31f5` | 写死 | 旧的按区域套餐价（只读，迁移前的数据） | 标题 | [charter-layers.ts:32](../../apps/web/src/lib/charter-layers.ts#L32) |
| `charter-layers.2c930c13` | 写死 | 基础价区域，不能设上下车加价 | 文字 | [charter-layers.ts:33](../../apps/web/src/lib/charter-layers.ts#L33) |
| `charter-layers.fd5a3015` | 写死 | 这个区域是商品的基础价区域（服务区域），在这里上下车不加价，不能再设上下车加价。 | 文字 | [charter-layers.ts:34](../../apps/web/src/lib/charter-layers.ts#L34) |
| `charter-layers.5c3f6d33` | 写死 | 删除这一行 | 文字 | [charter-layers.ts:35](../../apps/web/src/lib/charter-layers.ts#L35) |
| `charter-layers.39e16c9e` | 写死 | 所有套餐 | 文字 | [charter-layers.ts:36](../../apps/web/src/lib/charter-layers.ts#L36) |
| `charter-layers.7af58208` | 写死 | {count} 格没填 | 文字 | [charter-layers.ts:39](../../apps/web/src/lib/charter-layers.ts#L39) |
| `charter-layers.eadb348e` | 写死 | 迁移差异 {count} 条 | 文字 | [charter-layers.ts:40](../../apps/web/src/lib/charter-layers.ts#L40) |
| `charter-layers.590a8735` | 写死 | 请填开始日期 | 文字 | [charter-layers.ts:148](../../apps/web/src/lib/charter-layers.ts#L148) |
| `charter-layers.5d3cd4ab` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [charter-layers.ts:149](../../apps/web/src/lib/charter-layers.ts#L149)、150 行 |
| `charter-layers.f73c6b07` | 写死 | 结束日期不能早于开始日期 | 文字 | [charter-layers.ts:151](../../apps/web/src/lib/charter-layers.ts#L151) |
| `charter-layers.13e81024` | 写死 | 将删除 | 文字 | [charter-layers.ts:268](../../apps/web/src/lib/charter-layers.ts#L268) |
| `charter-layers.b039e9ef` | 写死 | 和别的加价日期重叠 | 文字 | [charter-layers.ts:270](../../apps/web/src/lib/charter-layers.ts#L270) |
| `charter-layers.0651fc29` | 写死 | 新的，未保存 | 文字 | [charter-layers.ts:271](../../apps/web/src/lib/charter-layers.ts#L271) |
| `charter-layers.661e7c78` | 写死 | 改过，未保存 | 文字 | [charter-layers.ts:272](../../apps/web/src/lib/charter-layers.ts#L272) |
| `charter-layers.b30d1d32` | 写死 | 没填 | 文字 | [charter-layers.ts:274](../../apps/web/src/lib/charter-layers.ts#L274) |
| `charter-layers.357aa1bd` | 写死 | 已停用 | 文字 | [charter-layers.ts:275](../../apps/web/src/lib/charter-layers.ts#L275) |
| `charter-layers.1dce79b8` | 写死 | 已过期 | 文字 | [charter-layers.ts:276](../../apps/web/src/lib/charter-layers.ts#L276) |
| `charter-layers.e7de9457` | 写死 | {validFrom} 起生效 | 文字 | [charter-layers.ts:277](../../apps/web/src/lib/charter-layers.ts#L277) |
| `charter-layers.737c92bb` | 写死 | 生效中，{validTo} 到期 | 文字 | [charter-layers.ts:278](../../apps/web/src/lib/charter-layers.ts#L278) |
| `charter-layers.09757216` | 写死 | 生效中 | 文字 | [charter-layers.ts:279](../../apps/web/src/lib/charter-layers.ts#L279) |
| `charter-layers.a8c960ad` | 写死 | 重叠约 {km2} 平方公里 | 文字 | [charter-layers.ts:309](../../apps/web/src/lib/charter-layers.ts#L309) |
| `charter-layers.ac3fdf98` | 写死 | 基础价区域「{a}」和上下车加价的区域「{b}」{area}：在基础价区域里上下车不加价，两者不能重叠。请先在区域页面切掉重叠的部分 | 文字 | [charter-layers.ts:310](../../apps/web/src/lib/charter-layers.ts#L310) |
| `charter-layers.19432972` | 写死 | 基础价区域 | 文字 | [charter-layers.ts:311](../../apps/web/src/lib/charter-layers.ts#L311) |
| `charter-layers.2840064a` | 写死 | 上下车加价的区域 | 文字 | [charter-layers.ts:311](../../apps/web/src/lib/charter-layers.ts#L311) |
| `charter-layers.3b6df015` | 写死 | 行程加价的区域 | 文字 | [charter-layers.ts:311](../../apps/web/src/lib/charter-layers.ts#L311) |
| `charter-layers.8d1610e7` | 写死 | 「{a}」和「{b}」{area}：同一个商品的{where}不能重叠（一个点只能有一个答案）。请先在区域页面切掉重叠的部分 | 文字 | [charter-layers.ts:312](../../apps/web/src/lib/charter-layers.ts#L312) |

## 派车、司机 H5、Webhook 页面上的显示（dispatch-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/dispatch-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `dispatch-display.78300f91` | 写死 | 司机的邮箱 | 文字 | [dispatch-display.ts:30](../../apps/web/src/lib/dispatch-display.ts#L30) |
| `dispatch-display.b5f07fdd` | 写死 | 已自动发到 {to}（邮件服务器已接收）。司机没有回应的话，请再联系他。 | 文字 | [dispatch-display.ts:33](../../apps/web/src/lib/dispatch-display.ts#L33) |
| `dispatch-display.548815ac` | 写死 | 邮件发送还没有配置好，请先复制链接手动发给司机 | 文字 | [dispatch-display.ts:35](../../apps/web/src/lib/dispatch-display.ts#L35) |
| `dispatch-display.74a6a2de` | 写死 | {…}。配置好后系统会发到 {to}。 | 文字 | [dispatch-display.ts:35](../../apps/web/src/lib/dispatch-display.ts#L35) |
| `dispatch-display.62fc9099` | 写死 | 暂时没发出去，系统会自动重试（发到 {to}）。着急的话请复制链接手动发。 | 文字 | [dispatch-display.ts:36](../../apps/web/src/lib/dispatch-display.ts#L36) |
| `dispatch-display.57fb0d18` | 写死 | 正在自动发到 {to}，等待邮件服务器接收。 | 文字 | [dispatch-display.ts:37](../../apps/web/src/lib/dispatch-display.ts#L37) |
| `dispatch-display.2fa0190b` | 写死 | 请复制链接手动发给司机 | 文字 | [dispatch-display.ts:39](../../apps/web/src/lib/dispatch-display.ts#L39) |
| `dispatch-display.965eaafd` | 写死 | 发送失败：{…} | 文字 | [dispatch-display.ts:39](../../apps/web/src/lib/dispatch-display.ts#L39) |
| `dispatch-display.a0d68984` | 写死 | 当前设置是手动发送，请复制链接发给司机。 | 文字 | [dispatch-display.ts:41](../../apps/web/src/lib/dispatch-display.ts#L41) |
| `dispatch-display.513059f2` | 写死 | 这位司机没有邮箱，请复制链接手动发。需要自动发的话，到「车队 → 司机」补上邮箱。 | 文字 | [dispatch-display.ts:43](../../apps/web/src/lib/dispatch-display.ts#L43) |
| `dispatch-display.dad520ec` | 写死 | 司机的邮箱改过了，之前那封邮件里的链接已作废。请点「重发邮件」发到 {to}，或复制链接手动发。 | 文字 | [dispatch-display.ts:45](../../apps/web/src/lib/dispatch-display.ts#L45) |
| `dispatch-display.b5140a54` | 写死 | 这条链接还没有发邮件。可以点「重发邮件」发到 {to}，或复制链接手动发。 | 文字 | [dispatch-display.ts:46](../../apps/web/src/lib/dispatch-display.ts#L46) |
| `dispatch-display.b97ca5bc` | 写死 | 现在没有有效的司机链接，要先重新生成才能发。 | 文字 | [dispatch-display.ts:48](../../apps/web/src/lib/dispatch-display.ts#L48) |
| `dispatch-display.00044525` | 写死 | 机场 | 文字 | [dispatch-display.ts:74](../../apps/web/src/lib/dispatch-display.ts#L74) |
| `dispatch-display.0f012dcf` | 写死 | 包车 | 文字 | [dispatch-display.ts:76](../../apps/web/src/lib/dispatch-display.ts#L76)、85 行 |
| `dispatch-display.930520a5` | 写死 | 包车 {package\_hours} 小时 | 文字 | [dispatch-display.ts:76](../../apps/web/src/lib/dispatch-display.ts#L76) |
| `dispatch-display.91cbc5dd` | 写死 | {head} · 上车：{from} | 文字 | [dispatch-display.ts:78](../../apps/web/src/lib/dispatch-display.ts#L78) |
| `dispatch-display.18f29a93` | 写死 | 点对点 | 文字 | [dispatch-display.ts:85](../../apps/web/src/lib/dispatch-display.ts#L85) |
| `dispatch-display.63a3c075` | 写死 | 接送机 | 文字 | [dispatch-display.ts:85](../../apps/web/src/lib/dispatch-display.ts#L85) |
| `dispatch-display.0324eb3b` | 写死 | 送机 | 名称 | [dispatch-display.ts:89](../../apps/web/src/lib/dispatch-display.ts#L89) |
| `dispatch-display.9e462641` | 写死 | 接机 | 名称 | [dispatch-display.ts:89](../../apps/web/src/lib/dispatch-display.ts#L89) |
| `dispatch-display.a548af54` | 写死 | {package\_hours} 小时 | 文字 | [dispatch-display.ts:95](../../apps/web/src/lib/dispatch-display.ts#L95) |
| `dispatch-display.6a4b60aa` | 写死 | 测试事件 | 名称 | [dispatch-display.ts:108](../../apps/web/src/lib/dispatch-display.ts#L108) |
| `dispatch-display.4598af70` | 写死 | 5 秒内没有应答 | 文字 | [dispatch-display.ts:114](../../apps/web/src/lib/dispatch-display.ts#L114) |
| `dispatch-display.412e467b` | 写死 | 对方返回的不是 2xx | 文字 | [dispatch-display.ts:115](../../apps/web/src/lib/dispatch-display.ts#L115) |
| `dispatch-display.07920953` | 写死 | 对方返回了重定向（不跟随） | 文字 | [dispatch-display.ts:116](../../apps/web/src/lib/dispatch-display.ts#L116) |
| `dispatch-display.ca9066b2` | 写死 | 连不上对方 | 提示 | [dispatch-display.ts:117](../../apps/web/src/lib/dispatch-display.ts#L117) |
| `dispatch-display.1516aa4e` | 写死 | HTTPS 证书有问题 | 提示 | [dispatch-display.ts:118](../../apps/web/src/lib/dispatch-display.ts#L118) |
| `dispatch-display.0272db14` | 写死 | 域名解析不了 | 提示 | [dispatch-display.ts:119](../../apps/web/src/lib/dispatch-display.ts#L119) |
| `dispatch-display.a3a9d2c7` | 写死 | 地址指向内网或本机，不允许推送 | 文字 | [dispatch-display.ts:120](../../apps/web/src/lib/dispatch-display.ts#L120) |
| `dispatch-display.68c34a9c` | 写死 | 接收地址不正确 | 提示 | [dispatch-display.ts:121](../../apps/web/src/lib/dispatch-display.ts#L121) |
| `dispatch-display.e8a8300b` | 写死 | 签名密钥读不出来，请换一把新的 | 文字 | [dispatch-display.ts:122](../../apps/web/src/lib/dispatch-display.ts#L122) |
| `dispatch-display.dff036cc` | 写死 | Webhook 已删除或暂停 | 文字 | [dispatch-display.ts:123](../../apps/web/src/lib/dispatch-display.ts#L123) |
| `dispatch-display.bfe55662` | 写死 | 乘客信息解不开，没有发送，请联系平台 | 提示 | [dispatch-display.ts:124](../../apps/web/src/lib/dispatch-display.ts#L124) |
| `dispatch-display.3ff72bf5` | 写死 | {…} 天 | 文字 | [dispatch-display.ts:135](../../apps/web/src/lib/dispatch-display.ts#L135) |
| `dispatch-display.29f6f408` | 写死 | {…} 小时 | 文字 | [dispatch-display.ts:136](../../apps/web/src/lib/dispatch-display.ts#L136) |
| `dispatch-display.9fece990` | 写死 | {…} 分钟 | 文字 | [dispatch-display.ts:137](../../apps/web/src/lib/dispatch-display.ts#L137) |
| `dispatch-display.7ce78b3d` | 写死 | {seconds} 秒 | 文字 | [dispatch-display.ts:138](../../apps/web/src/lib/dispatch-display.ts#L138) |
| `dispatch-display.befab289` | 写死 | 这条推送正在发送，稍后刷新查看结果 | 文字 | [dispatch-display.ts:155](../../apps/web/src/lib/dispatch-display.ts#L155) |
| `dispatch-display.2994c1aa` | 写死 | 供应商的 Webhook 设置已删除或暂停，没有发送 | 文字 | [dispatch-display.ts:156](../../apps/web/src/lib/dispatch-display.ts#L156) |
| `dispatch-display.20927102` | 写死 | 重推了，对方还是没收到 | 文字 | [dispatch-display.ts:157](../../apps/web/src/lib/dispatch-display.ts#L157) |
| `dispatch-display.859291d0` | 写死 | 已重推成功 | 文字 | [dispatch-display.ts:157](../../apps/web/src/lib/dispatch-display.ts#L157) |
| `dispatch-display.8c53a778` | 写死 | {minutes} 分钟 | 文字 | [dispatch-display.ts:166](../../apps/web/src/lib/dispatch-display.ts#L166) |
| `dispatch-display.dcd14161` | 写死 | 不限 | 文字 | [dispatch-display.ts:166](../../apps/web/src/lib/dispatch-display.ts#L166) |
| `dispatch-display.d44304b3` | 写死 | 商品设的「不限时」 | 文字 | [dispatch-display.ts:172](../../apps/web/src/lib/dispatch-display.ts#L172) |

## distance.ts

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/distance.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `distance.840a1088` | 写死 | 不到 1 公里 | 文字 | [distance.ts:5](../../apps/web/src/lib/distance.ts#L5) |
| `distance.ff051e79` | 写死 | 约 {…} 公里 | 文字 | [distance.ts:5](../../apps/web/src/lib/distance.ts#L5) |

## 把一次失败的请求变成给用户看的话（failure.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 预订页（/book）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/failure.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `failure.94a2f0fa` | 写死 | 网络连接失败，请检查网络后重试。 | 提示 | [failure.ts:6](../../apps/web/src/lib/failure.ts#L6) |
| `failure.a3fdf8f1` | 写死 | 尝试次数过多，请稍后再试。 | 文字 | [failure.ts:11](../../apps/web/src/lib/failure.ts#L11) |
| `failure.ff8e0e81` | 写死 | 尝试次数过多，请 {…} 分钟后再试。 | 文字 | [failure.ts:13](../../apps/web/src/lib/failure.ts#L13) |
| `failure.b0342f9c` | 写死 | 提交的内容不符合要求，请检查后重试。 | 提示 | [failure.ts:45](../../apps/web/src/lib/failure.ts#L45) |
| `failure.d818495f` | 写死 | 系统暂时无法{action}，请稍后再试。 | 提示 | [failure.ts:47](../../apps/web/src/lib/failure.ts#L47) |

## 免费等待按航班定（free-wait-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/free-wait-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `free-wait-display.freeWait.minutes.1` | 已走 key | 不限时 | 文字 | [free-wait-display.ts:13](../../apps/web/src/lib/free-wait-display.ts#L13) |
| `free-wait-display.freeWait.minutes.2` | 已走 key | {minutes} 分钟 | 文字 | [free-wait-display.ts:13](../../apps/web/src/lib/free-wait-display.ts#L13) |
| `free-wait-display.freeWait.previewDispatched` | 已走 key | 已派车：同意后免费等待不变（{current}） | 文字 | [free-wait-display.ts:14](../../apps/web/src/lib/free-wait-display.ts#L14) |
| `free-wait-display.freeWait.previewUnchanged` | 已走 key | 同意后免费等待不变（{current}） | 文字 | [free-wait-display.ts:15](../../apps/web/src/lib/free-wait-display.ts#L15) |
| `free-wait-display.freeWait.previewChange` | 已走 key | 同意后免费等待 {from} → {to} | 文字 | [free-wait-display.ts:16](../../apps/web/src/lib/free-wait-display.ts#L16) |
| `free-wait-display.freeWait.dispatchedNote` | 已走 key | 按派单时{kind}锁定 {minutes} 分钟 | 说明 | [free-wait-display.ts:17](../../apps/web/src/lib/free-wait-display.ts#L17) |
| `free-wait-display.freeWait.dispatchedKind.domestic` | 已走 key | 的国内航班 | 文字 | [free-wait-display.ts:18](../../apps/web/src/lib/free-wait-display.ts#L18) |
| `free-wait-display.freeWait.dispatchedKind.international` | 已走 key | 的国际航班 | 文字 | [free-wait-display.ts:18](../../apps/web/src/lib/free-wait-display.ts#L18) |
| `free-wait-display.freeWait.dispatchedKind.unconfirmed` | 已走 key | 航班类型未确认（按国内线） | 文字 | [free-wait-display.ts:18](../../apps/web/src/lib/free-wait-display.ts#L18) |
| `free-wait-display.freeWait.basisKind.domestic` | 已走 key | 国内航班 | 文字 | [free-wait-display.ts:19](../../apps/web/src/lib/free-wait-display.ts#L19) |
| `free-wait-display.freeWait.basisKind.international` | 已走 key | 国际航班 | 文字 | [free-wait-display.ts:19](../../apps/web/src/lib/free-wait-display.ts#L19) |
| `free-wait-display.freeWait.basisKind.unconfirmed` | 已走 key | 航班类型未确认，按国内线 | 文字 | [free-wait-display.ts:19](../../apps/web/src/lib/free-wait-display.ts#L19) |
| `free-wait-display.freeWait.basisRaised` | 已走 key | ；{base}，按平台规定补到 {minutes} 分钟 | 文字 | [free-wait-display.ts:20](../../apps/web/src/lib/free-wait-display.ts#L20) |
| `free-wait-display.freeWait.basisFixed` | 已走 key | ；机场接机按平台统一标准，{base}不适用 | 文字 | [free-wait-display.ts:21](../../apps/web/src/lib/free-wait-display.ts#L21) |
| `free-wait-display.freeWait.baseNotSet` | 已走 key | 商品没设 | 文字 | [free-wait-display.ts:22](../../apps/web/src/lib/free-wait-display.ts#L22) |
| `free-wait-display.freeWait.baseSet` | 已走 key | 商品设 {minutes} 分钟 | 文字 | [free-wait-display.ts:23](../../apps/web/src/lib/free-wait-display.ts#L23) |
| `free-wait-display.freeWait.flightKindLegend` | 已走 key | 航班类型 | 标题 | [free-wait-display.ts:24](../../apps/web/src/lib/free-wait-display.ts#L24) |
| `free-wait-display.freeWait.flightKindHint` | 已走 key | 按航班定免费等待：国际航班等得更久 | 说明 | [free-wait-display.ts:25](../../apps/web/src/lib/free-wait-display.ts#L25) |
| `free-wait-display.freeWait.flightKindDispatched` | 已走 key | 已派车，免费等待不再变化 | 文字 | [free-wait-display.ts:26](../../apps/web/src/lib/free-wait-display.ts#L26) |
| `free-wait-display.freeWait.flightKindOption` | 已走 key | 落地后免费等待 {minutes} 分钟 | 文字 | [free-wait-display.ts:27](../../apps/web/src/lib/free-wait-display.ts#L27) |
| `free-wait-display.freeWait.airportFixedValue` | 已走 key | 国际航班 90 分钟、国内航班 60 分钟 | 文字 | [free-wait-display.ts:28](../../apps/web/src/lib/free-wait-display.ts#L28) |
| `free-wait-display.freeWait.airportFixedTag` | 已走 key | 平台统一 · 不能修改 | 文字 | [free-wait-display.ts:29](../../apps/web/src/lib/free-wait-display.ts#L29) |
| `free-wait-display.freeWait.airportFixedHint` | 已走 key | 机场接机的免费等待按客人的航班由平台统一定（所有机场、所有供应商相同），从航班落地起算{…} | 说明 | [free-wait-display.ts:30](../../apps/web/src/lib/free-wait-display.ts#L30) |
| `free-wait-display.freeWait.p2pFlightHint` | 已走 key | 如 NH211。清空表示不是从机场接人，免费等待回到商品的设置 | 说明 | [free-wait-display.ts:31](../../apps/web/src/lib/free-wait-display.ts#L31) |

## 汇率页、首页的显示规则（fx-display.ts）

用在：供应商后台 · 企业信息；供应商后台 · 公司；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/fx-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx-display.0cbdaf88` | 写死 | 日元 | 文字 | [fx-display.ts:13](../../apps/web/src/lib/fx-display.ts#L13) |
| `fx-display.e39c795d` | 写死 | 韩元 | 文字 | [fx-display.ts:14](../../apps/web/src/lib/fx-display.ts#L14) |
| `fx-display.ea90c447` | 写死 | 人民币 | 文字 | [fx-display.ts:15](../../apps/web/src/lib/fx-display.ts#L15) |
| `fx-display.5d757960` | 写死 | 美元 | 文字 | [fx-display.ts:16](../../apps/web/src/lib/fx-display.ts#L16) |
| `fx-display.2475901c` | 写死 | 港币 | 文字 | [fx-display.ts:17](../../apps/web/src/lib/fx-display.ts#L17) |
| `fx-display.17f4a6bd` | 写死 | 新台币 | 文字 | [fx-display.ts:18](../../apps/web/src/lib/fx-display.ts#L18) |
| `fx-display.677fb314` | 写死 | 泰铢 | 文字 | [fx-display.ts:19](../../apps/web/src/lib/fx-display.ts#L19) |
| `fx-display.74812b0c` | 写死 | 新加坡元 | 文字 | [fx-display.ts:20](../../apps/web/src/lib/fx-display.ts#L20) |
| `fx-display.72323e5c` | 写死 | 正常 | 名称 | [fx-display.ts:27](../../apps/web/src/lib/fx-display.ts#L27) |
| `fx-display.c30dbef7` | 写死 | 已过期 | 名称 | [fx-display.ts:28](../../apps/web/src/lib/fx-display.ts#L28) |
| `fx-display.7cdde69e` | 写死 | 还没有汇率 | 名称 | [fx-display.ts:29](../../apps/web/src/lib/fx-display.ts#L29) |
| `fx-display.f57e2963` | 写死 | 正在拉取 | 名称 | [fx-display.ts:33](../../apps/web/src/lib/fx-display.ts#L33) |
| `fx-display.8e121cc2` | 写死 | 已更新 | 名称 | [fx-display.ts:34](../../apps/web/src/lib/fx-display.ts#L34) |
| `fx-display.c84c0a06` | 写死 | 数据源未更新 | 名称 | [fx-display.ts:35](../../apps/web/src/lib/fx-display.ts#L35) |
| `fx-display.fd93e8fc` | 写死 | 变动过大，待确认 | 名称 | [fx-display.ts:36](../../apps/web/src/lib/fx-display.ts#L36) |
| `fx-display.a2b48c04` | 写死 | 已确认生效 | 名称 | [fx-display.ts:37](../../apps/web/src/lib/fx-display.ts#L37) |
| `fx-display.b8a92a85` | 写死 | 已放弃 | 名称 | [fx-display.ts:38](../../apps/web/src/lib/fx-display.ts#L38) |
| `fx-display.3c944adc` | 写死 | 内容不对，未采用 | 名称 | [fx-display.ts:39](../../apps/web/src/lib/fx-display.ts#L39) |
| `fx-display.ad3b1f1d` | 写死 | 没有拉到 | 名称 | [fx-display.ts:40](../../apps/web/src/lib/fx-display.ts#L40) |
| `fx-display.03403863` | 写死 | 生效中 | 名称 | [fx-display.ts:45](../../apps/web/src/lib/fx-display.ts#L45) |
| `fx-display.df8a8861` | 写死 | 已解锁 | 名称 | [fx-display.ts:46](../../apps/web/src/lib/fx-display.ts#L46) |
| `fx-display.67536370` | 写死 | 已被取代 | 名称 | [fx-display.ts:47](../../apps/web/src/lib/fx-display.ts#L47) |
| `fx-display.7896000a` | 写死 | 已到期 | 名称 | [fx-display.ts:48](../../apps/web/src/lib/fx-display.ts#L48) |
| `fx-display.d45ab969` | 写死 | 定时 | 文字 | [fx-display.ts:53](../../apps/web/src/lib/fx-display.ts#L53) |
| `fx-display.6ca8f9a1` | 写死 | 手动（{name}） | 文字 | [fx-display.ts:54](../../apps/web/src/lib/fx-display.ts#L54) |
| `fx-display.9398d7de` | 写死 | 手动 | 文字 | [fx-display.ts:54](../../apps/web/src/lib/fx-display.ts#L54) |
| `fx-display.e57bc812` | 写死 | 基准币种 {base} 还没有汇率，所以全部显示「—」：刚加入的币种要等数据源下一次更新才有值，这不是拉取失败。到时候页面会自动有值，也可以先换一个基准币种看。 | 说明 | [fx-display.ts:69](../../apps/web/src/lib/fx-display.ts#L69) |
| `fx-display.6daca726` | 写死 | 显示「—」的币种还没有汇率：刚加入的币种要等数据源下一次更新才有值，这不是拉取失败。 | 说明 | [fx-display.ts:70](../../apps/web/src/lib/fx-display.ts#L70) |
| `fx-display.5f6be53c` | 写死 | 数据源在时限内没有应答 | 文字 | [fx-display.ts:136](../../apps/web/src/lib/fx-display.ts#L136) |
| `fx-display.7b8a194e` | 写死 | 连不上数据源，或数据源暂时出错 | 文字 | [fx-display.ts:137](../../apps/web/src/lib/fx-display.ts#L137) |
| `fx-display.123590ef` | 写死 | 数据源返回的内容不对，没有采用 | 文字 | [fx-display.ts:138](../../apps/web/src/lib/fx-display.ts#L138) |
| `fx-display.c1bd55df` | 写死 | 数据源给的汇率比现在这批还旧，没有采用 | 文字 | [fx-display.ts:139](../../apps/web/src/lib/fx-display.ts#L139) |
| `fx-display.4b22a720` | 写死 | 这批汇率变动超过 3%，已挂起，等人确认 | 文字 | [fx-display.ts:140](../../apps/web/src/lib/fx-display.ts#L140) |
| `fx-display.6ceb421b` | 写死 | 上一次拉取中途断了 | 文字 | [fx-display.ts:141](../../apps/web/src/lib/fx-display.ts#L141) |
| `fx-display.78772123` | 写死 | 原因见汇率页的「最近的拉取记录」 | 提示 | [fx-display.ts:143](../../apps/web/src/lib/fx-display.ts#L143) |

## 库存日历每一格的话、改一天和批量设置的表单、导入页的文字（inventory-form.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/lib/inventory-form.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `inventory-form.529e3453` | 写死 | 待付款 {…}{unit} | 文字 | [inventory-form.ts:30](../../apps/web/src/lib/inventory-form.ts#L30) |
| `inventory-form.5b5cac41` | 写死 | 共 {…}{unit} | 文字 | [inventory-form.ts:30](../../apps/web/src/lib/inventory-form.ts#L30) |
| `inventory-form.87e98046` | 写死 | 已售 {…}{unit} | 文字 | [inventory-form.ts:30](../../apps/web/src/lib/inventory-form.ts#L30) |
| `inventory-form.bcff151e` | 写死 | 超出可以设库存的范围 | 文字 | [inventory-form.ts:41](../../apps/web/src/lib/inventory-form.ts#L41) |
| `inventory-form.0d54b4cd` | 写死 | 已设停售，限量时生效 | 文字 | [inventory-form.ts:43](../../apps/web/src/lib/inventory-form.ts#L43) |
| `inventory-form.d07ec55f` | 写死 | 已设 {…}，限量时生效 | 文字 | [inventory-form.ts:43](../../apps/web/src/lib/inventory-form.ts#L43) |
| `inventory-form.5b986657` | 写死 | 不限量 | 文字 | [inventory-form.ts:44](../../apps/web/src/lib/inventory-form.ts#L44) |
| `inventory-form.d10f3925` | 写死 | 不限量，{preset} | 文字 | [inventory-form.ts:44](../../apps/web/src/lib/inventory-form.ts#L44) |
| `inventory-form.199e95c8` | 写死 | 没设，卖不出去 | 文字 | [inventory-form.ts:46](../../apps/web/src/lib/inventory-form.ts#L46) |
| `inventory-form.24973e18` | 写死 | 卖不出去 | 文字 | [inventory-form.ts:46](../../apps/web/src/lib/inventory-form.ts#L46) |
| `inventory-form.5e98a533` | 写死 | 没设 | 文字 | [inventory-form.ts:46](../../apps/web/src/lib/inventory-form.ts#L46) |
| `inventory-form.383132d8` | 写死 | 停售 | 文字 | [inventory-form.ts:47](../../apps/web/src/lib/inventory-form.ts#L47)、76、287 行 |
| `inventory-form.6a267fbd` | 写死 | 共 {…} 单 | 文字 | [inventory-form.ts:48](../../apps/web/src/lib/inventory-form.ts#L48) |
| `inventory-form.a21988c7` | 写死 | 已售 {…} 单 | 文字 | [inventory-form.ts:48](../../apps/web/src/lib/inventory-form.ts#L48) |
| `inventory-form.de080b05` | 写死 | 待付款 {…} 单 | 文字 | [inventory-form.ts:48](../../apps/web/src/lib/inventory-form.ts#L48) |
| `inventory-form.3c8575be` | 写死 | 已订满 | 文字 | [inventory-form.ts:49](../../apps/web/src/lib/inventory-form.ts#L49) |
| `inventory-form.7beb72e9` | 写死 | 已订满，{detail} | 文字 | [inventory-form.ts:49](../../apps/web/src/lib/inventory-form.ts#L49) |
| `inventory-form.5ec03349` | 写死 | 剩 {…} | 文字 | [inventory-form.ts:50](../../apps/web/src/lib/inventory-form.ts#L50) |
| `inventory-form.aee2c87b` | 写死 | 还剩 {…} 单，{detail} | 文字 | [inventory-form.ts:50](../../apps/web/src/lib/inventory-form.ts#L50) |
| `inventory-form.50f056ca` | 写死 | 请填 1 到 {…} 之间的整数。要停售请选「停售」 | 文字 | [inventory-form.ts:56](../../apps/web/src/lib/inventory-form.ts#L56) |
| `inventory-form.07fd8cab` | 写死 | 请选择要设成什么 | 文字 | [inventory-form.ts:66](../../apps/web/src/lib/inventory-form.ts#L66) |
| `inventory-form.3e14ea31` | 写死 | 清除 | 文字 | [inventory-form.ts:76](../../apps/web/src/lib/inventory-form.ts#L76)、172、287 行 |
| `inventory-form.b57d351a` | 写死 | 可售 {…} 单 | 文字 | [inventory-form.ts:76](../../apps/web/src/lib/inventory-form.ts#L76) |
| `inventory-form.2fd6b04d` | 写死 | 这一天已经有 {…} 单（已售 {…} 单、待付款 {…} 单），可售单数不能少于 {…}。 | 文字 | [inventory-form.ts:82](../../apps/web/src/lib/inventory-form.ts#L82) |
| `inventory-form.778c0f84` | 写死 | 请填结束日期 | 文字 | [inventory-form.ts:109](../../apps/web/src/lib/inventory-form.ts#L109)、137 行 |
| `inventory-form.e4ab134d` | 写死 | 请填开始日期 | 文字 | [inventory-form.ts:109](../../apps/web/src/lib/inventory-form.ts#L109)、136 行 |
| `inventory-form.cc8e000f` | 写死 | 结束日期不能早于开始日期 | 文字 | [inventory-form.ts:111](../../apps/web/src/lib/inventory-form.ts#L111) |
| `inventory-form.716bf453` | 写死 | 过去的日子不能改，最早从今天（{today}）开始 | 文字 | [inventory-form.ts:113](../../apps/web/src/lib/inventory-form.ts#L113) |
| `inventory-form.c42a4634` | 写死 | 最远只能设到 {…}（今天之后 {maxDaysAhead} 天） | 文字 | [inventory-form.ts:115](../../apps/web/src/lib/inventory-form.ts#L115) |
| `inventory-form.5cecf033` | 写死 | 一次最多设 {maxRangeDays} 天，请分几次 | 文字 | [inventory-form.ts:117](../../apps/web/src/lib/inventory-form.ts#L117) |
| `inventory-form.74985fb4` | 写死 | 请至少选一天 | 文字 | [inventory-form.ts:119](../../apps/web/src/lib/inventory-form.ts#L119)、138 行 |
| `inventory-form.eb13a4fb` | 写死 | 这段日期里没有{…}，请改日期或换一天 | 文字 | [inventory-form.ts:119](../../apps/web/src/lib/inventory-form.ts#L119) |
| `inventory-form.ddb3463e` | 写死 | 这一项不符合要求，请检查后重试 | 文字 | [inventory-form.ts:121](../../apps/web/src/lib/inventory-form.ts#L121) |
| `inventory-form.f1e5db4c` | 写死 | {from} 至 {to} | 文字 | [inventory-form.ts:157](../../apps/web/src/lib/inventory-form.ts#L157)、264 行 |
| `inventory-form.7ee1b4e4` | 写死 |  的每个{…} | 文字 | [inventory-form.ts:158](../../apps/web/src/lib/inventory-form.ts#L158) |
| `inventory-form.96e07cad` | 写死 |  的每一天 | 文字 | [inventory-form.ts:158](../../apps/web/src/lib/inventory-form.ts#L158) |
| `inventory-form.e5df60c0` | 写死 | {span}{which}，共 {…} 天 | 文字 | [inventory-form.ts:159](../../apps/web/src/lib/inventory-form.ts#L159) |
| `inventory-form.2ee24b05` | 写死 | 停售，这些天不接单。 | 文字 | [inventory-form.ts:163](../../apps/web/src/lib/inventory-form.ts#L163) |
| `inventory-form.32da5797` | 写死 | 清除，改回「没设」。 | 文字 | [inventory-form.ts:163](../../apps/web/src/lib/inventory-form.ts#L163) |
| `inventory-form.45fbb365` | 写死 | 每天可售 {…} 单。 | 文字 | [inventory-form.ts:163](../../apps/web/src/lib/inventory-form.ts#L163) |
| `inventory-form.0ab91299` | 写死 | 改成 {…} | 文字 | [inventory-form.ts:172](../../apps/web/src/lib/inventory-form.ts#L172) |
| `inventory-form.b00a1576` | 写死 | 其中 {…} 天现在已经有数，会被{…}。 | 文字 | [inventory-form.ts:172](../../apps/web/src/lib/inventory-form.ts#L172) |
| `inventory-form.e2dbc3ef` | 写死 | 改成停售 | 文字 | [inventory-form.ts:172](../../apps/web/src/lib/inventory-form.ts#L172) |
| `inventory-form.4196d49b` | 写死 | 现在是不限量，这些数要改成限量后才起作用。 | 文字 | [inventory-form.ts:173](../../apps/web/src/lib/inventory-form.ts#L173) |
| `inventory-form.fe638d22` | 写死 | {date} {…}：已占用 {…} 单 | 文字 | [inventory-form.ts:200](../../apps/web/src/lib/inventory-form.ts#L200) |
| `inventory-form.6ea4ff0c` | 写死 | 一次只能导入一个文件。 | 文字 | [inventory-form.ts:218](../../apps/web/src/lib/inventory-form.ts#L218) |
| `inventory-form.cd7fda9c` | 写死 | 只能导入 .xlsx 文件。「{name}」不是。如果是 .xls 或 .csv，请在 Excel 里另存为「Excel 工作簿（.xlsx）」。 | 文字 | [inventory-form.ts:221](../../apps/web/src/lib/inventory-form.ts#L221) |
| `inventory-form.df036044` | 写死 | 这个文件是空的。 | 文字 | [inventory-form.ts:222](../../apps/web/src/lib/inventory-form.ts#L222) |
| `inventory-form.b7dc5598` | 写死 | 「{name}」有 {…}，超过了 1 MB。请删掉用不到的行和工作表，或分成几份。 | 文字 | [inventory-form.ts:223](../../apps/web/src/lib/inventory-form.ts#L223) |
| `inventory-form.b59914c3` | 写死 | 文件超过了 1 MB。 | 提示 | [inventory-form.ts:229](../../apps/web/src/lib/inventory-form.ts#L229) |
| `inventory-form.62f8d5ef` | 写死 | 这不是一个 .xlsx 文件（可能只是改了扩展名）。请在 Excel 里另存为「Excel 工作簿（.xlsx）」再传。 | 提示 | [inventory-form.ts:232](../../apps/web/src/lib/inventory-form.ts#L232) |
| `inventory-form.43f46b68` | 写死 | 这个文件打不开，可能已经损坏。请在 Excel 里重新保存一份再传。 | 提示 | [inventory-form.ts:234](../../apps/web/src/lib/inventory-form.ts#L234) |
| `inventory-form.fceb9eae` | 写死 | 这个文件的内容太多（行、列或某个格子里的字超过了上限）。请只保留要导入的那张表和那些行。 | 提示 | [inventory-form.ts:236](../../apps/web/src/lib/inventory-form.ts#L236) |
| `inventory-form.b90fc396` | 写死 | 这个文件里有不允许的内容，不能导入。请把数据复制到刚下载的模版里再传。 | 提示 | [inventory-form.ts:238](../../apps/web/src/lib/inventory-form.ts#L238) |
| `inventory-form.80b17e61` | 写死 | 第一张表是空的，没有表头。请用下载的模版来填。 | 提示 | [inventory-form.ts:240](../../apps/web/src/lib/inventory-form.ts#L240) |
| `inventory-form.b9a51e1a` | 写死 | 表头里少了几列。第一行的表头不能改，请对照模版补上。 | 提示 | [inventory-form.ts:243](../../apps/web/src/lib/inventory-form.ts#L243) |
| `inventory-form.cbee0e93` | 写死 | 表头里少了这几列：{…}。第一行的表头不能改，请对照模版补上。 | 提示 | [inventory-form.ts:243](../../apps/web/src/lib/inventory-form.ts#L243) |
| `inventory-form.ef7ffc4b` | 写死 | 这个文件有效的行超过了{…}行。请分成几份，一份一份导入。 | 提示 | [inventory-form.ts:246](../../apps/web/src/lib/inventory-form.ts#L246) |
| `inventory-form.f6526125` | 写死 | 上限的 | 提示 | [inventory-form.ts:246](../../apps/web/src/lib/inventory-form.ts#L246) |
| `inventory-form.c9a16c12` | 写死 | 这个文件读不了，请用下载的模版重新填。 | 提示 | [inventory-form.ts:248](../../apps/web/src/lib/inventory-form.ts#L248) |
| `inventory-form.980ba45e` | 写死 | {…} 小时 | 文字 | [inventory-form.ts:256](../../apps/web/src/lib/inventory-form.ts#L256) |
| `inventory-form.7d562d6a` | 写死 | {from} 起一直有效 | 文字 | [inventory-form.ts:264](../../apps/web/src/lib/inventory-form.ts#L264) |
| `inventory-form.67670011` | 写死 | 含 {…} 公里{…} | 文字 | [inventory-form.ts:272](../../apps/web/src/lib/inventory-form.ts#L272) |
| `inventory-form.d7568031` | 写死 | ，超出每公里 {…} | 文字 | [inventory-form.ts:272](../../apps/web/src/lib/inventory-form.ts#L272) |
| `inventory-form.5bd843f8` | 写死 | 上车加价 {…} | 文字 | [inventory-form.ts:273](../../apps/web/src/lib/inventory-form.ts#L273) |
| `inventory-form.994f7a2a` | 写死 | 下车加价 {…} | 文字 | [inventory-form.ts:273](../../apps/web/src/lib/inventory-form.ts#L273) |
| `inventory-form.5f428125` | 写死 | 停用 | 文字 | [inventory-form.ts:274](../../apps/web/src/lib/inventory-form.ts#L274) |
| `inventory-form.89350700` | 写死 | 生效日期和第 {row} 行重叠{…} | 文字 | [inventory-form.ts:280](../../apps/web/src/lib/inventory-form.ts#L280) |
| `inventory-form.37943c5a` | 写死 | 生效日期和已有的一条价格重叠{…} | 文字 | [inventory-form.ts:282](../../apps/web/src/lib/inventory-form.ts#L282) |
| `inventory-form.97ec192b` | 写死 | 生效日期和已有的价格重叠：{…} | 文字 | [inventory-form.ts:282](../../apps/web/src/lib/inventory-form.ts#L282) |
| `inventory-form.5ab3875b` | 写死 | 设成 {…} 单 | 文字 | [inventory-form.ts:287](../../apps/web/src/lib/inventory-form.ts#L287) |
| `inventory-form.0ae60605` | 写死 | 这一天已经有 {…} 单，{…} | 文字 | [inventory-form.ts:292](../../apps/web/src/lib/inventory-form.ts#L292) |
| `inventory-form.aaca58fb` | 写死 | 不能改成 {…} | 文字 | [inventory-form.ts:292](../../apps/web/src/lib/inventory-form.ts#L292) |
| `inventory-form.eedd8347` | 写死 | 不能清除 | 文字 | [inventory-form.ts:292](../../apps/web/src/lib/inventory-form.ts#L292) |

## 包车行程地图和编号（itinerary-texts.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/itinerary-texts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `itinerary.pickup` | 已走 key | 上车 | 文字 | [itinerary-texts.ts:63](../../apps/web/src/lib/itinerary-texts.ts#L63) |
| `itinerary.stop` | 已走 key | 经停 | 文字 | [itinerary-texts.ts:64](../../apps/web/src/lib/itinerary-texts.ts#L64) |
| `itinerary.dropoff` | 已走 key | 下车 | 文字 | [itinerary-texts.ts:65](../../apps/web/src/lib/itinerary-texts.ts#L65) |
| `itinerary.routeTitle` | 已走 key | 行程路线 | 标题 | [itinerary-texts.ts:66](../../apps/web/src/lib/itinerary-texts.ts#L66) |
| `itinerary.listOnly` | 已走 key | 经停较多，仅显示列表 | 文字 | [itinerary-texts.ts:67](../../apps/web/src/lib/itinerary-texts.ts#L67) |
| `itinerary.updating` | 已走 key | 路线更新中 | 文字 | [itinerary-texts.ts:68](../../apps/web/src/lib/itinerary-texts.ts#L68) |
| `itinerary.mapAlt` | 已走 key | 路线图：{chain} | 文字 | [itinerary-texts.ts:69](../../apps/web/src/lib/itinerary-texts.ts#L69) |
| `itinerary.mapAltTotal` | 已走 key | 路线图：{chain}，约 {duration} · {km} | 文字 | [itinerary-texts.ts:70](../../apps/web/src/lib/itinerary-texts.ts#L70) |
| `itinerary.drive` | 已走 key | 行驶约 {duration} | 文字 | [itinerary-texts.ts:71](../../apps/web/src/lib/itinerary-texts.ts#L71) |
| `itinerary.driveKm` | 已走 key | 行驶约 {duration} · {km} | 文字 | [itinerary-texts.ts:72](../../apps/web/src/lib/itinerary-texts.ts#L72) |
| `itinerary.breakdownStops` | 已走 key | {numbers} · 经停 | 文字 | [itinerary-texts.ts:73](../../apps/web/src/lib/itinerary-texts.ts#L73) |
| `itinerary.unavailableStop` | 已走 key | {number} 号点「{name}」 | 文字 | [itinerary-texts.ts:74](../../apps/web/src/lib/itinerary-texts.ts#L74) |
| `itinerary.legFailure` | 已走 key | 第 {leg} 段（{from}「{fromName}」→ {to}「{toName}」） | 提示 | [itinerary-texts.ts:75](../../apps/web/src/lib/itinerary-texts.ts#L75) |
| `itinerary.areaStops` | 已走 key | 经停（{numbers} 号点） | 文字 | [itinerary-texts.ts:76](../../apps/web/src/lib/itinerary-texts.ts#L76) |
| `itinerary.navigateTo` | 已走 key | 导航到 {number} 号点 | 文字 | [itinerary-texts.ts:77](../../apps/web/src/lib/itinerary-texts.ts#L77) |
| `itinerary.suggestTitle` | 已走 key | 建议顺序，可省 {saved} | 标题 | [itinerary-texts.ts:78](../../apps/web/src/lib/itinerary-texts.ts#L78) |
| `itinerary.suggestTitleSame` | 已走 key | 建议顺序，可省 {saved}，价格不变 | 标题 | [itinerary-texts.ts:79](../../apps/web/src/lib/itinerary-texts.ts#L79) |
| `itinerary.suggestTooLong` | 已走 key | 当前顺序超过在线下单时长，按建议顺序约 {duration}，可以在线下单 | 文字 | [itinerary-texts.ts:80](../../apps/web/src/lib/itinerary-texts.ts#L80) |
| `itinerary.suggestPending` | 已走 key | 建议顺序：计算中… | 文字 | [itinerary-texts.ts:81](../../apps/web/src/lib/itinerary-texts.ts#L81) |
| `itinerary.suggestCurrent` | 已走 key | 当前顺序 | 文字 | [itinerary-texts.ts:82](../../apps/web/src/lib/itinerary-texts.ts#L82) |
| `itinerary.suggestSuggested` | 已走 key | 建议顺序 | 文字 | [itinerary-texts.ts:83](../../apps/web/src/lib/itinerary-texts.ts#L83) |
| `itinerary.suggestAdopt` | 已走 key | 采用建议顺序 | 文字 | [itinerary-texts.ts:84](../../apps/web/src/lib/itinerary-texts.ts#L84) |
| `itinerary.suggestKeep` | 已走 key | 保持我的顺序 | 文字 | [itinerary-texts.ts:85](../../apps/web/src/lib/itinerary-texts.ts#L85) |
| `itinerary.suggestRecomputing` | 已走 key | 正在按最新行程重算建议… | 文字 | [itinerary-texts.ts:86](../../apps/web/src/lib/itinerary-texts.ts#L86) |
| `itinerary.suggestRestore` | 已走 key | 恢复原来的顺序 | 文字 | [itinerary-texts.ts:87](../../apps/web/src/lib/itinerary-texts.ts#L87) |
| `itinerary.suggestAdopted` | 已走 key | 已按建议顺序排列：{chain} | 文字 | [itinerary-texts.ts:88](../../apps/web/src/lib/itinerary-texts.ts#L88) |
| `itinerary.suggestRestored` | 已走 key | 已恢复原来的顺序 | 文字 | [itinerary-texts.ts:89](../../apps/web/src/lib/itinerary-texts.ts#L89) |
| `itinerary.suggestPriceUpdated` | 已走 key | 价格已更新：{vehicle} {price} | 文字 | [itinerary-texts.ts:90](../../apps/web/src/lib/itinerary-texts.ts#L90) |
| `itinerary.suggestPrice` | 已走 key | {vehicle} {price} | 文字 | [itinerary-texts.ts:91](../../apps/web/src/lib/itinerary-texts.ts#L91) |
| `itinerary.suggestRegion` | 已走 key | 经停顺序建议 | 文字 | [itinerary-texts.ts:92](../../apps/web/src/lib/itinerary-texts.ts#L92) |
| `itinerary.optimizeTitle` | 已走 key | 经停顺序建议（谷歌地图） | 标题 | [itinerary-texts.ts:93](../../apps/web/src/lib/itinerary-texts.ts#L93) |
| `itinerary.optimizeIntro` | 已走 key | 包车客人填 2 个以上经停时，用谷歌地图算更省路程的顺序（按调用次数计费，比路线预估贵一倍）。同一组经停 24 小时内不再调用；次数按东京时间每天 0 点重新计。 | 说明 | [itinerary-texts.ts:94](../../apps/web/src/lib/itinerary-texts.ts#L94) |
| `itinerary.optimizeCalls` | 已走 key | 今天的调用（{day}） | 文字 | [itinerary-texts.ts:95](../../apps/web/src/lib/itinerary-texts.ts#L95) |
| `itinerary.optimizeLimit` | 已走 key | {calls} / {limit} 次（含重试） | 文字 | [itinerary-texts.ts:96](../../apps/web/src/lib/itinerary-texts.ts#L96) |
| `itinerary.optimizeRefused` | 已走 key | 今天被上限挡下 | 文字 | [itinerary-texts.ts:97](../../apps/web/src/lib/itinerary-texts.ts#L97) |
| `itinerary.rulesSuggestLegend` | 已走 key | 经停顺序建议 | 标题 | [itinerary-texts.ts:98](../../apps/web/src/lib/itinerary-texts.ts#L98) |
| `itinerary.rulesSuggestLabel` | 已走 key | 提示更省路程的经停顺序 | 名称 | [itinerary-texts.ts:99](../../apps/web/src/lib/itinerary-texts.ts#L99) |
| `itinerary.rulesSuggestHint` | 已走 key | 客人填 2 个以上经停时，提示更省路程的顺序，并给出按建议顺序的价格。关了只是这个商品不显示建议价，客人自己排的任何顺序照常报价。默认开。 | 说明 | [itinerary-texts.ts:100](../../apps/web/src/lib/itinerary-texts.ts#L100) |
| `itinerary.arriveByLabel` | 已走 key | 经停点 {number} 指定到达时间（选填） | 名称 | [itinerary-texts.ts:101](../../apps/web/src/lib/itinerary-texts.ts#L101) |
| `itinerary.arriveByNextDay` | 已走 key | 次日 {time} | 文字 | [itinerary-texts.ts:102](../../apps/web/src/lib/itinerary-texts.ts#L102) |
| `itinerary.arriveByLaterDay` | 已走 key | 第 {day} 天 {time} | 文字 | [itinerary-texts.ts:103](../../apps/web/src/lib/itinerary-texts.ts#L103) |
| `itinerary.arriveByFormat` | 已走 key | 请按 HH:MM 填写到达时间，或清空 | 文字 | [itinerary-texts.ts:104](../../apps/web/src/lib/itinerary-texts.ts#L104) |
| `itinerary.arriveByDeadline` | 已走 key | 须在 {time} 前到达 | 文字 | [itinerary-texts.ts:105](../../apps/web/src/lib/itinerary-texts.ts#L105) |
| `itinerary.arriveByLocked` | 已走 key | {name}，须在 {time} 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整 | 文字 | [itinerary-texts.ts:106](../../apps/web/src/lib/itinerary-texts.ts#L106) |
| `itinerary.arriveByLockedIcon` | 已走 key | 已锁定 | 文字 | [itinerary-texts.ts:107](../../apps/web/src/lib/itinerary-texts.ts#L107) |
| `itinerary.arriveByLate` | 已走 key | 预计 {eta} 到，晚于指定的 {time} | 文字 | [itinerary-texts.ts:108](../../apps/web/src/lib/itinerary-texts.ts#L108) |
| `itinerary.arriveByLateStop` | 已走 key | {name}：预计 {eta} 到，晚于指定的 {time} | 文字 | [itinerary-texts.ts:109](../../apps/web/src/lib/itinerary-texts.ts#L109) |
| `itinerary.arriveByLateAdjust` | 已走 key | 预计 {eta} 到，晚于指定的 {time}，来不及。请把上车时间提前到 {start} 或更早，或减少前面的经停、缩短停留 | 文字 | [itinerary-texts.ts:110](../../apps/web/src/lib/itinerary-texts.ts#L110) |
| `itinerary.timeDepart` | 已走 key | {time} 出发 | 文字 | [itinerary-texts.ts:111](../../apps/web/src/lib/itinerary-texts.ts#L111) |
| `itinerary.timeArrive` | 已走 key | 预计 {time} 到 | 文字 | [itinerary-texts.ts:112](../../apps/web/src/lib/itinerary-texts.ts#L112) |
| `itinerary.timeArriveDepart` | 已走 key | 预计 {arrive} 到 · {depart} 出发 | 文字 | [itinerary-texts.ts:113](../../apps/web/src/lib/itinerary-texts.ts#L113) |
| `itinerary.arriveByFieldHint` | 已走 key | 填了指定到达时间的经停会锁定位置，不参与建议顺序。 | 说明 | [itinerary-texts.ts:114](../../apps/web/src/lib/itinerary-texts.ts#L114) |

## 主数据各种值在界面上的写法（master-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/master-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `master-display.7dd41fc5` | 写死 | 中文 | 名称 | [master-display.ts:24](../../apps/web/src/lib/master-display.ts#L24) |
| `master-display.70e9ef0b` | 写死 | 日语 | 名称 | [master-display.ts:25](../../apps/web/src/lib/master-display.ts#L25) |
| `master-display.f835a065` | 写死 | 英语 | 名称 | [master-display.ts:26](../../apps/web/src/lib/master-display.ts#L26) |
| `master-display.0bfbaa07` | 写死 | 韩语 | 名称 | [master-display.ts:27](../../apps/web/src/lib/master-display.ts#L27) |
| `master-display.dabe6eaa` | 写死 | 启用 | 名称 | [master-display.ts:56](../../apps/web/src/lib/master-display.ts#L56) |
| `master-display.cdc4807e` | 写死 | 已停用 | 名称 | [master-display.ts:57](../../apps/web/src/lib/master-display.ts#L57) |
| `master-display.5484a98c` | 写死 | 车站 | 文字 | [master-display.ts:106](../../apps/web/src/lib/master-display.ts#L106) |
| `master-display.6e184a92` | 写死 | 出口 | 文字 | [master-display.ts:106](../../apps/web/src/lib/master-display.ts#L106) |
| `master-display.c19bf469` | 写死 | 机场 | 文字 | [master-display.ts:106](../../apps/web/src/lib/master-display.ts#L106) |
| `master-display.da32d373` | 写死 | 地标 | 文字 | [master-display.ts:106](../../apps/web/src/lib/master-display.ts#L106) |
| `master-display.ec9f0917` | 写死 | 航站楼 | 文字 | [master-display.ts:106](../../apps/web/src/lib/master-display.ts#L106) |
| `master-display.02a72fc5` | 写死 | 国际 | 文字 | [master-display.ts:107](../../apps/web/src/lib/master-display.ts#L107) |
| `master-display.0d7bd247` | 写死 | 国际和国内 | 文字 | [master-display.ts:107](../../apps/web/src/lib/master-display.ts#L107) |
| `master-display.a88b9440` | 写死 | 国内 | 文字 | [master-display.ts:107](../../apps/web/src/lib/master-display.ts#L107) |
| `master-display.68dfbf4d` | 写死 | 电动 | 文字 | [master-display.ts:108](../../apps/web/src/lib/master-display.ts#L108) |
| `master-display.aa38388c` | 写死 | 燃油 | 文字 | [master-display.ts:108](../../apps/web/src/lib/master-display.ts#L108) |
| `master-display.17939b03` | 写死 | 接送机 | 文字 | [master-display.ts:109](../../apps/web/src/lib/master-display.ts#L109) |
| `master-display.17cce1d5` | 写死 | 点对点 | 文字 | [master-display.ts:109](../../apps/web/src/lib/master-display.ts#L109) |
| `master-display.234c0ca1` | 写死 | 包车 | 文字 | [master-display.ts:109](../../apps/web/src/lib/master-display.ts#L109) |
| `master-display.2c66fbd9` | 写死 | 按时长 | 文字 | [master-display.ts:110](../../apps/web/src/lib/master-display.ts#L110) |
| `master-display.396969fd` | 写死 | 按个 | 文字 | [master-display.ts:110](../../apps/web/src/lib/master-display.ts#L110) |
| `master-display.4cecc991` | 写死 | 按人 | 文字 | [master-display.ts:110](../../apps/web/src/lib/master-display.ts#L110) |
| `master-display.9606e945` | 写死 | 按次 | 文字 | [master-display.ts:110](../../apps/web/src/lib/master-display.ts#L110) |
| `master-display.dd9e5639` | 写死 | 每个订单收一次 | 文字 | [master-display.ts:112](../../apps/web/src/lib/master-display.ts#L112) |
| `master-display.9d7cf241` | 写死 | 按数量收，例如每个座椅 | 文字 | [master-display.ts:113](../../apps/web/src/lib/master-display.ts#L113) |
| `master-display.dc29f913` | 写死 | 按乘客人数收 | 文字 | [master-display.ts:114](../../apps/web/src/lib/master-display.ts#L114) |
| `master-display.476b72cd` | 写死 | 按服务时长收 | 文字 | [master-display.ts:115](../../apps/web/src/lib/master-display.ts#L115) |
| `master-display.e2dff6c5` | 写死 | 没有名称或三字代码里带「{query}」的接送点。 | 文字 | [master-display.ts:171](../../apps/web/src/lib/master-display.ts#L171) |
| `master-display.ba3dc59c` | 写死 | 没有名称里带「{query}」的接送点。有 {length} 个机场或车站目前只有英文名（例如 {code} {text}），请输入英文名或三字代码查找；要用中文名搜，请联系平台运营在「主数据 → 地点」里补上中文名。 | 文字 | [master-display.ts:173](../../apps/web/src/lib/master-display.ts#L173) |

## 两步验证的文案（mfa-display.ts）

用在：登录和账号（两个后台共用） · 两步验证；运营后台 · 账号安全和角色

文件：`apps/web/src/lib/mfa-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `mfa-display.d9a7f74a` | 写死 | 请输入验证器上显示的 6 位数字 | 文字 | [mfa-display.ts:13](../../apps/web/src/lib/mfa-display.ts#L13) |
| `mfa-display.ece5d222` | 写死 | 恢复码是 16 个字母和数字（可以不带连字符） | 文字 | [mfa-display.ts:17](../../apps/web/src/lib/mfa-display.ts#L17) |
| `mfa-display.a348d5fa` | 写死 | 动态码或恢复码不对。请看验证器上现在显示的数字再输一次；手机时间不准也会对不上。 | 提示 | [mfa-display.ts:27](../../apps/web/src/lib/mfa-display.ts#L27) |
| `mfa-display.77e32d6d` | 写死 | 这个动态码刚刚用过了。请等验证器上出现下一个（最多 30 秒）再输入。 | 提示 | [mfa-display.ts:29](../../apps/web/src/lib/mfa-display.ts#L29) |
| `mfa-display.dbd7e5a9` | 写死 | 这个二维码已经过期（15 分钟），请重新生成一个再扫。 | 提示 | [mfa-display.ts:31](../../apps/web/src/lib/mfa-display.ts#L31) |
| `mfa-display.c37edbc7` | 写死 | 平台还没有配置好两步验证需要的加密密钥，现在不能绑定或验证。请联系技术人员。 | 提示 | [mfa-display.ts:33](../../apps/web/src/lib/mfa-display.ts#L33) |
| `mfa-display.63294e87` | 写死 | 读不出你的两步验证密钥。请联系超级管理员重置你的两步验证，然后重新绑定。 | 提示 | [mfa-display.ts:35](../../apps/web/src/lib/mfa-display.ts#L35) |
| `mfa-display.66883ba0` | 写死 | 请先输入现在验证器上的动态码（或一个恢复码），确认是你本人。 | 提示 | [mfa-display.ts:37](../../apps/web/src/lib/mfa-display.ts#L37) |
| `mfa-display.270264db` | 写死 | 系统暂时无法完成两步验证，请稍后再试。 | 提示 | [mfa-display.ts:42](../../apps/web/src/lib/mfa-display.ts#L42) |
| `mfa-display.7f412dc0` | 写死 | NOZOMI 运营后台 · 两步验证恢复码 | 文字 | [mfa-display.ts:48](../../apps/web/src/lib/mfa-display.ts#L48) |
| `mfa-display.b36384da` | 写死 | 账号：{email} | 文字 | [mfa-display.ts:49](../../apps/web/src/lib/mfa-display.ts#L49) |
| `mfa-display.039066b8` | 写死 | 生成时间：{…} | 文字 | [mfa-display.ts:50](../../apps/web/src/lib/mfa-display.ts#L50) |
| `mfa-display.c1ebe351` | 写死 | 手机丢了或验证器打不开时，登录时可以用其中一个代替动态码。每个只能用一次。 | 文字 | [mfa-display.ts:52](../../apps/web/src/lib/mfa-display.ts#L52) |
| `mfa-display.44911451` | 写死 | 请存在只有你自己能打开的地方（密码管理器、打印出来锁好），不要发给任何人。 | 文字 | [mfa-display.ts:53](../../apps/web/src/lib/mfa-display.ts#L53) |

## 运营审核 no-show 时看的证据（no-show-evidence.ts）

用在：供应商后台 · 订单（列表、详情）；运营后台 · 工单详情；运营后台 · 订单（列表、详情）

文件：`apps/web/src/lib/no-show-evidence.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `no-show-evidence.505f256b` | 写死 | ？没有核对记录 | 文字 | [no-show-evidence.ts:32](../../apps/web/src/lib/no-show-evidence.ts#L32) |
| `no-show-evidence.6e02be68` | 写死 | ✗ 不满足 | 提示 | [no-show-evidence.ts:32](../../apps/web/src/lib/no-show-evidence.ts#L32) |
| `no-show-evidence.97ac5fe0` | 写死 | ✓ 满足 | 文字 | [no-show-evidence.ts:32](../../apps/web/src/lib/no-show-evidence.ts#L32) |
| `no-show-evidence.0d8c3337` | 写死 | 审核通过 | 文字 | [no-show-evidence.ts:33](../../apps/web/src/lib/no-show-evidence.ts#L33) |
| `no-show-evidence.78bd53c6` | 写死 | 审核驳回 | 文字 | [no-show-evidence.ts:33](../../apps/web/src/lib/no-show-evidence.ts#L33) |
| `no-show-evidence.aeacdc89` | 写死 | 等平台审核 | 文字 | [no-show-evidence.ts:33](../../apps/web/src/lib/no-show-evidence.ts#L33) |
| `no-show-evidence.0f10e46d` | 写死 | 票据 | 文字 | [no-show-evidence.ts:35](../../apps/web/src/lib/no-show-evidence.ts#L35) |
| `no-show-evidence.25d272e2` | 写死 | 举牌照片 | 文字 | [no-show-evidence.ts:35](../../apps/web/src/lib/no-show-evidence.ts#L35) |
| `no-show-evidence.6c198a43` | 写死 | 联系截图 | 文字 | [no-show-evidence.ts:35](../../apps/web/src/lib/no-show-evidence.ts#L35) |
| `no-show-evidence.e4276d38` | 写死 | 到达屏 | 文字 | [no-show-evidence.ts:35](../../apps/web/src/lib/no-show-evidence.ts#L35) |
| `no-show-evidence.0e5ce924` | 写死 | {…} 到 {…} | 文字 | [no-show-evidence.ts:42](../../apps/web/src/lib/no-show-evidence.ts#L42) |
| `no-show-evidence.dd581bca` | 写死 | {…} 起，不限时长 | 文字 | [no-show-evidence.ts:42](../../apps/web/src/lib/no-show-evidence.ts#L42) |
| `no-show-evidence.4e618aac` | 写死 | {…}（提交时） | 文字 | [no-show-evidence.ts:60](../../apps/web/src/lib/no-show-evidence.ts#L60) |
| `no-show-evidence.0698c638` | 写死 | 按用车时间算 | 文字 | [no-show-evidence.ts:61](../../apps/web/src/lib/no-show-evidence.ts#L61) |
| `no-show-evidence.a3aac255` | 写死 | 按现在的落地时间算 | 文字 | [no-show-evidence.ts:61](../../apps/web/src/lib/no-show-evidence.ts#L61) |
| `no-show-evidence.8014b628` | 写死 | 提交之后落地时间变了，现在的免费等待是 {…}。5 项核对结果是按提交那一刻算的，判定时请留意。 | 说明 | [no-show-evidence.ts:70](../../apps/web/src/lib/no-show-evidence.ts#L70) |
| `no-show-evidence.d0856754` | 写死 | 司机没有点「已到达」 | 文字 | [no-show-evidence.ts:79](../../apps/web/src/lib/no-show-evidence.ts#L79) |
| `no-show-evidence.a082a450` | 写死 | 平台代传，没有定位 | 文字 | [no-show-evidence.ts:81](../../apps/web/src/lib/no-show-evidence.ts#L81) |
| `no-show-evidence.c8efa057` | 写死 | 没有定位 | 文字 | [no-show-evidence.ts:81](../../apps/web/src/lib/no-show-evidence.ts#L81) |
| `no-show-evidence.5889ee8f` | 写死 | {at}，距上车点 {arrival\_distance\_m} 米{…} | 文字 | [no-show-evidence.ts:82](../../apps/web/src/lib/no-show-evidence.ts#L82) |
| `no-show-evidence.c4dd7342` | 写死 | （超过 {maxArrivalDistanceMeters} 米） | 文字 | [no-show-evidence.ts:82](../../apps/web/src/lib/no-show-evidence.ts#L82) |
| `no-show-evidence.4c1d41ef` | 写死 | 这一单不是接机，不记落地时间 | 文字 | [no-show-evidence.ts:87](../../apps/web/src/lib/no-show-evidence.ts#L87) |
| `no-show-evidence.ed2b7eab` | 写死 | {…}（客人和司机都没有报，按计划到达时间算） | 文字 | [no-show-evidence.ts:88](../../apps/web/src/lib/no-show-evidence.ts#L88) |
| `no-show-evidence.82602fb1` | 写死 | ；客人和司机报的不一致，取较晚的 | 文字 | [no-show-evidence.ts:89](../../apps/web/src/lib/no-show-evidence.ts#L89) |
| `no-show-evidence.d75c6b52` | 写死 | {…}（来源：{…}）{…} | 文字 | [no-show-evidence.ts:89](../../apps/web/src/lib/no-show-evidence.ts#L89) |
| `no-show-evidence.0fe8c411` | 写死 | 到达：{…}；免费等待 {…} 开始 | 文字 | [no-show-evidence.ts:107](../../apps/web/src/lib/no-show-evidence.ts#L107) |
| `no-show-evidence.405fdedf` | 写死 | 共 {total} 次，免费等待内 {within} 次（至少要 {minContactAttempts} 次） | 文字 | [no-show-evidence.ts:110](../../apps/web/src/lib/no-show-evidence.ts#L110) |
| `no-show-evidence.41c4f224` | 写死 | 没有联系记录 | 文字 | [no-show-evidence.ts:110](../../apps/web/src/lib/no-show-evidence.ts#L110) |
| `no-show-evidence.9289afc4` | 写死 | {length} 张，最新一张的系统时间 {…} | 文字 | [no-show-evidence.ts:115](../../apps/web/src/lib/no-show-evidence.ts#L115) |
| `no-show-evidence.fc511ffe` | 写死 | 没有举牌照片 | 文字 | [no-show-evidence.ts:115](../../apps/web/src/lib/no-show-evidence.ts#L115) |
| `no-show-evidence.4198e577` | 写死 | 司机没有点「申请离开」 | 文字 | [no-show-evidence.ts:119](../../apps/web/src/lib/no-show-evidence.ts#L119) |
| `no-show-evidence.d817c408` | 写死 | 申请离开 {…}，{leaveConsentMinutes} 分钟后（{…}）没人反对视为同意 | 文字 | [no-show-evidence.ts:120](../../apps/web/src/lib/no-show-evidence.ts#L120) |
| `no-show-evidence.363e2328` | 写死 | 还没有提交，期限 {due} | 文字 | [no-show-evidence.ts:124](../../apps/web/src/lib/no-show-evidence.ts#L124) |
| `no-show-evidence.798aeafe` | 写死 | 提交 {…}，期限 {due} | 文字 | [no-show-evidence.ts:124](../../apps/web/src/lib/no-show-evidence.ts#L124) |
| `no-show-evidence.3ed4e3c4` | 写死 | （不在免费等待内） | 文字 | [no-show-evidence.ts:144](../../apps/web/src/lib/no-show-evidence.ts#L144) |
| `no-show-evidence.4017873f` | 写死 | 即时通讯 | 文字 | [no-show-evidence.ts:144](../../apps/web/src/lib/no-show-evidence.ts#L144) |
| `no-show-evidence.6813e606` | 写死 | 打电话 | 文字 | [no-show-evidence.ts:144](../../apps/web/src/lib/no-show-evidence.ts#L144) |

## 供应商入驻（onboarding-display.ts）

用在：供应商后台 · 公司；供应商后台 · 服务表现；供应商后台 · 首页；运营后台 · 供应商（列表、新建、详情）；运营后台 · 资质审核

文件：`apps/web/src/lib/onboarding-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `onboarding-display.5b36d6f5` | 写死 | 申请中 | 文字 | [onboarding-display.ts:10](../../apps/web/src/lib/onboarding-display.ts#L10) |
| `onboarding-display.9813f8b5` | 写死 | 审核中 | 文字 | [onboarding-display.ts:11](../../apps/web/src/lib/onboarding-display.ts#L11)、77、100 行 |
| `onboarding-display.3fb17163` | 写死 | 已签约 | 文字 | [onboarding-display.ts:12](../../apps/web/src/lib/onboarding-display.ts#L12) |
| `onboarding-display.de38d56d` | 写死 | 试运营 | 文字 | [onboarding-display.ts:13](../../apps/web/src/lib/onboarding-display.ts#L13) |
| `onboarding-display.d35ccea7` | 写死 | 正常 | 文字 | [onboarding-display.ts:14](../../apps/web/src/lib/onboarding-display.ts#L14) |
| `onboarding-display.29834ae8` | 写死 | 已暂停 | 文字 | [onboarding-display.ts:15](../../apps/web/src/lib/onboarding-display.ts#L15) |
| `onboarding-display.f09f3366` | 写死 | 已清退 | 文字 | [onboarding-display.ts:16](../../apps/web/src/lib/onboarding-display.ts#L16) |
| `onboarding-display.6d98d040` | 写死 | 填企业信息、上传资质，交齐后提交审核。 | 文字 | [onboarding-display.ts:21](../../apps/web/src/lib/onboarding-display.ts#L21) |
| `onboarding-display.7bce0098` | 写死 | 资质正在审核。审核通过、合同生效后签约。 | 文字 | [onboarding-display.ts:22](../../apps/web/src/lib/onboarding-display.ts#L22) |
| `onboarding-display.afdc19d4` | 写死 | 可以建区域和商品，还不能上架。完成测试单后开始试运营。 | 文字 | [onboarding-display.ts:23](../../apps/web/src/lib/onboarding-display.ts#L23) |
| `onboarding-display.68796df7` | 写死 | 可以上架、参与比价，每天最多接 10 单。满 30 天、完成 20 单且没有重大投诉后自动转正式。 | 文字 | [onboarding-display.ts:24](../../apps/web/src/lib/onboarding-display.ts#L24) |
| `onboarding-display.3263b647` | 写死 | 正常参与比价，没有每日订单上限。 | 文字 | [onboarding-display.ts:25](../../apps/web/src/lib/onboarding-display.ts#L25) |
| `onboarding-display.60a391ee` | 写死 | 商品不参与比价、不能接新订单；已经接下的订单照常履约。 | 文字 | [onboarding-display.ts:26](../../apps/web/src/lib/onboarding-display.ts#L26) |
| `onboarding-display.f81731af` | 写死 | 只能查看历史，不能再修改。 | 文字 | [onboarding-display.ts:27](../../apps/web/src/lib/onboarding-display.ts#L27) |
| `onboarding-display.33be6af0` | 写死 | 测试供应商只用于验收：可以建区域和商品，不上架、不参与比价，停在已签约。 | 说明 | [onboarding-display.ts:31](../../apps/web/src/lib/onboarding-display.ts#L31) |
| `onboarding-display.b4d707d6` | 写死 | 有资质已到期，请重新上传已到期的资质。审核通过、合同生效后签约。 | 说明 | [onboarding-display.ts:45](../../apps/web/src/lib/onboarding-display.ts#L45) |
| `onboarding-display.b4d8ca07` | 写死 | 有资质已到期，需要供应商重新上传，审核通过、合同生效后签约。 | 说明 | [onboarding-display.ts:45](../../apps/web/src/lib/onboarding-display.ts#L45) |
| `onboarding-display.4bccd583` | 写死 | 有资质被驳回或要求补充，请按平台的意见重新提交。 | 说明 | [onboarding-display.ts:46](../../apps/web/src/lib/onboarding-display.ts#L46) |
| `onboarding-display.ddd7f7f5` | 写死 | 有资质被驳回或要求补充，需要供应商重新提交。 | 说明 | [onboarding-display.ts:46](../../apps/web/src/lib/onboarding-display.ts#L46) |
| `onboarding-display.11d4a7be` | 写死 | 资质正在审核（合同已生效）。审核通过后签约。 | 说明 | [onboarding-display.ts:50](../../apps/web/src/lib/onboarding-display.ts#L50) |
| `onboarding-display.2e5b9087` | 写死 | 资质已全部审核通过。等合同生效后签约。 | 说明 | [onboarding-display.ts:51](../../apps/web/src/lib/onboarding-display.ts#L51) |
| `onboarding-display.fa997d3e` | 写死 | 资质已全部审核通过。合同生效后可以签约。 | 说明 | [onboarding-display.ts:51](../../apps/web/src/lib/onboarding-display.ts#L51) |
| `onboarding-display.79a3c565` | 写死 | 资质已全部审核通过、合同已生效，可以签约。 | 说明 | [onboarding-display.ts:52](../../apps/web/src/lib/onboarding-display.ts#L52) |
| `onboarding-display.9afbcace` | 写死 | 资质已全部审核通过、合同已生效，等平台签约。 | 说明 | [onboarding-display.ts:52](../../apps/web/src/lib/onboarding-display.ts#L52) |
| `onboarding-display.9a1a694a` | 写死 | 人工暂停 | 文字 | [onboarding-display.ts:56](../../apps/web/src/lib/onboarding-display.ts#L56) |
| `onboarding-display.495b342a` | 写死 | 必交资质已到期 | 文字 | [onboarding-display.ts:57](../../apps/web/src/lib/onboarding-display.ts#L57) |
| `onboarding-display.2ecc222b` | 写死 | 履约评分低于 3.50 | 文字 | [onboarding-display.ts:58](../../apps/web/src/lib/onboarding-display.ts#L58) |
| `onboarding-display.f9e7cdc7` | 写死 | 近 30 天司机未到 3 次 | 文字 | [onboarding-display.ts:59](../../apps/web/src/lib/onboarding-display.ts#L59) |
| `onboarding-display.7a5e0002` | 写死 | 履约评分低于 4.00 | 文字 | [onboarding-display.ts:63](../../apps/web/src/lib/onboarding-display.ts#L63) |
| `onboarding-display.1262bd11` | 写死 | 近 30 天司机未到 2 次 | 文字 | [onboarding-display.ts:64](../../apps/web/src/lib/onboarding-display.ts#L64) |
| `onboarding-display.d6ac239a` | 写死 | 未提交 | 名称 | [onboarding-display.ts:76](../../apps/web/src/lib/onboarding-display.ts#L76) |
| `onboarding-display.58355f8e` | 写死 | 已驳回 | 名称 | [onboarding-display.ts:78](../../apps/web/src/lib/onboarding-display.ts#L78)、102 行 |
| `onboarding-display.961c93b5` | 写死 | 要求补充 | 名称 | [onboarding-display.ts:79](../../apps/web/src/lib/onboarding-display.ts#L79)、103 行 |
| `onboarding-display.6b605d50` | 写死 | 已通过 | 名称 | [onboarding-display.ts:80](../../apps/web/src/lib/onboarding-display.ts#L80)、101 行 |
| `onboarding-display.6c7cc3a4` | 写死 | 快到期 | 名称 | [onboarding-display.ts:81](../../apps/web/src/lib/onboarding-display.ts#L81) |
| `onboarding-display.fbc8dea8` | 写死 | 已到期 | 名称 | [onboarding-display.ts:82](../../apps/web/src/lib/onboarding-display.ts#L82) |
| `onboarding-display.d61f7bb6` | 写死 | {pending}（审核中） | 文字 | [onboarding-display.ts:92](../../apps/web/src/lib/onboarding-display.ts#L92) |
| `onboarding-display.c4308415` | 写死 | 无到期日 | 文字 | [onboarding-display.ts:93](../../apps/web/src/lib/onboarding-display.ts#L93) |
| `onboarding-display.3487b1d9` | 写死 | （还有 {days\_left} 天） | 文字 | [onboarding-display.ts:95](../../apps/web/src/lib/onboarding-display.ts#L95) |
| `onboarding-display.4cfce67e` | 写死 | {current}；新的一份 {pending}（审核中） | 文字 | [onboarding-display.ts:96](../../apps/web/src/lib/onboarding-display.ts#L96) |
| `onboarding-display.f47fbb31` | 写死 | 已被新证件取代 | 名称 | [onboarding-display.ts:104](../../apps/web/src/lib/onboarding-display.ts#L104) |
| `onboarding-display.6bf163c2` | 写死 | 提交审核 | 按钮 | [onboarding-display.ts:108](../../apps/web/src/lib/onboarding-display.ts#L108) |
| `onboarding-display.ce9fde3d` | 写死 | 退回补充 | 文字 | [onboarding-display.ts:109](../../apps/web/src/lib/onboarding-display.ts#L109) |
| `onboarding-display.bb4c8ab0` | 写死 | 签约 | 文字 | [onboarding-display.ts:110](../../apps/web/src/lib/onboarding-display.ts#L110) |
| `onboarding-display.eeefbca5` | 写死 | 开始试运营 | 文字 | [onboarding-display.ts:111](../../apps/web/src/lib/onboarding-display.ts#L111) |
| `onboarding-display.a16db382` | 写死 | 转为正式 | 文字 | [onboarding-display.ts:112](../../apps/web/src/lib/onboarding-display.ts#L112) |
| `onboarding-display.3f6c1a85` | 写死 | 暂停 | 文字 | [onboarding-display.ts:113](../../apps/web/src/lib/onboarding-display.ts#L113) |
| `onboarding-display.928d2aa4` | 写死 | 恢复 | 文字 | [onboarding-display.ts:114](../../apps/web/src/lib/onboarding-display.ts#L114) |
| `onboarding-display.41c47b7d` | 写死 | 清退 | 文字 | [onboarding-display.ts:115](../../apps/web/src/lib/onboarding-display.ts#L115) |
| `onboarding-display.e284d13f` | 写死 | 观察期变化 | 文字 | [onboarding-display.ts:116](../../apps/web/src/lib/onboarding-display.ts#L116) |
| `onboarding-display.fe16ffe3` | 写死 | 供应商 | 文字 | [onboarding-display.ts:120](../../apps/web/src/lib/onboarding-display.ts#L120) |
| `onboarding-display.dc59b8b7` | 写死 | 平台 | 文字 | [onboarding-display.ts:121](../../apps/web/src/lib/onboarding-display.ts#L121) |
| `onboarding-display.2ddb4b72` | 写死 | 系统（每日检查） | 文字 | [onboarding-display.ts:122](../../apps/web/src/lib/onboarding-display.ts#L122) |
| `onboarding-display.83a1fbff` | 写死 | 暂停原因：{…} | 文字 | [onboarding-display.ts:131](../../apps/web/src/lib/onboarding-display.ts#L131) |
| `onboarding-display.2d858bd6` | 写死 | 消除：{…} | 文字 | [onboarding-display.ts:132](../../apps/web/src/lib/onboarding-display.ts#L132) |
| `onboarding-display.a3a093bd` | 写死 | 进入观察期：{…} | 文字 | [onboarding-display.ts:133](../../apps/web/src/lib/onboarding-display.ts#L133) |
| `onboarding-display.2f1bb423` | 写死 | 退出观察期 | 文字 | [onboarding-display.ts:134](../../apps/web/src/lib/onboarding-display.ts#L134) |
| `onboarding-display.88112577` | 写死 | 观察原因：{…} | 文字 | [onboarding-display.ts:135](../../apps/web/src/lib/onboarding-display.ts#L135) |
| `onboarding-display.53dd7474` | 写死 | 还没有提交 | 文字 | [onboarding-display.ts:140](../../apps/web/src/lib/onboarding-display.ts#L140) |
| `onboarding-display.30cff10e` | 写死 | 被驳回或要求补充，要重新提交一份 | 文字 | [onboarding-display.ts:141](../../apps/web/src/lib/onboarding-display.ts#L141) |
| `onboarding-display.c841f98f` | 写死 | 已到期，要换一份在有效期内的 | 文字 | [onboarding-display.ts:142](../../apps/web/src/lib/onboarding-display.ts#L142) |
| `onboarding-display.25ba19c4` | 写死 | 还没有审核通过 | 文字 | [onboarding-display.ts:143](../../apps/web/src/lib/onboarding-display.ts#L143) |
| `onboarding-display.5cb6c59d` | 写死 | 还没有已生效的合同 | 文字 | [onboarding-display.ts:144](../../apps/web/src/lib/onboarding-display.ts#L144) |
| `onboarding-display.4086499d` | 写死 | 还没有通过上架校验的商品 | 文字 | [onboarding-display.ts:145](../../apps/web/src/lib/onboarding-display.ts#L145) |
| `onboarding-display.1a996f10` | 写死 | 必交资质不全或已到期 | 提示 | [onboarding-display.ts:146](../../apps/web/src/lib/onboarding-display.ts#L146) |
| `onboarding-display.c0a7cca5` | 写死 | 必填 | 提示 | [onboarding-display.ts:147](../../apps/web/src/lib/onboarding-display.ts#L147) |
| `onboarding-display.e14a8d59` | 写死 | 所在国家 | 文字 | [onboarding-display.ts:151](../../apps/web/src/lib/onboarding-display.ts#L151) |
| `onboarding-display.d82ccedd` | 写死 | 法定名称 | 名称 | [onboarding-display.ts:152](../../apps/web/src/lib/onboarding-display.ts#L152) |
| `onboarding-display.1c59c290` | 写死 | 登记号 | 文字 | [onboarding-display.ts:153](../../apps/web/src/lib/onboarding-display.ts#L153) |
| `onboarding-display.fedd06ae` | 写死 | 地址 | 文字 | [onboarding-display.ts:154](../../apps/web/src/lib/onboarding-display.ts#L154) |
| `onboarding-display.9e2416c0` | 写死 | 联系人 | 名称 | [onboarding-display.ts:155](../../apps/web/src/lib/onboarding-display.ts#L155) |
| `onboarding-display.2bd1fe96` | 写死 | 联系电话 | 文字 | [onboarding-display.ts:156](../../apps/web/src/lib/onboarding-display.ts#L156) |
| `onboarding-display.c3cd034b` | 写死 | 联系邮箱 | 文字 | [onboarding-display.ts:157](../../apps/web/src/lib/onboarding-display.ts#L157) |
| `onboarding-display.024a90e0` | 写死 | 合同 | 文字 | [onboarding-display.ts:163](../../apps/web/src/lib/onboarding-display.ts#L163) |
| `onboarding-display.57a5217e` | 写死 | 资质 | 文字 | [onboarding-display.ts:163](../../apps/web/src/lib/onboarding-display.ts#L163)、200、201、202 行 |
| `onboarding-display.a34833c7` | 写死 | 商品 | 文字 | [onboarding-display.ts:163](../../apps/web/src/lib/onboarding-display.ts#L163) |
| `onboarding-display.bbfaf1ca` | 写死 | 测试单说明 | 文字 | [onboarding-display.ts:163](../../apps/web/src/lib/onboarding-display.ts#L163) |
| `onboarding-display.0ea06297` | 写死 | 按时派车率 | 文字 | [onboarding-display.ts:169](../../apps/web/src/lib/onboarding-display.ts#L169) |
| `onboarding-display.8ef1e6bc` | 写死 | 准时到达率 | 文字 | [onboarding-display.ts:170](../../apps/web/src/lib/onboarding-display.ts#L170) |
| `onboarding-display.12246bc4` | 写死 | 客人评价均分 | 文字 | [onboarding-display.ts:171](../../apps/web/src/lib/onboarding-display.ts#L171) |
| `onboarding-display.9412380e` | 写死 | 投诉率 | 文字 | [onboarding-display.ts:172](../../apps/web/src/lib/onboarding-display.ts#L172) |
| `onboarding-display.9331c396` | 写死 | 履约失败率 | 提示 | [onboarding-display.ts:173](../../apps/web/src/lib/onboarding-display.ts#L173) |
| `onboarding-display.504c3363` | 写死 | 没有数据 | 文字 | [onboarding-display.ts:183](../../apps/web/src/lib/onboarding-display.ts#L183)、188 行 |
| `onboarding-display.029098e4` | 写死 | {…} 分 | 文字 | [onboarding-display.ts:189](../../apps/web/src/lib/onboarding-display.ts#L189) |
| `onboarding-display.47f385c7` | 写死 | 原因：{…}。{suspended} | 文字 | [onboarding-display.ts:194](../../apps/web/src/lib/onboarding-display.ts#L194) |
| `onboarding-display.ef1cfe75` | 写死 | 已暂停。 | 标题 | [onboarding-display.ts:194](../../apps/web/src/lib/onboarding-display.ts#L194) |
| `onboarding-display.4100b59a` | 写死 | 原因：{…}。观察期里比价时排序价按对外价 ×1.05 计算，更难中标；原因消除后自动退出。 | 文字 | [onboarding-display.ts:195](../../apps/web/src/lib/onboarding-display.ts#L195) |
| `onboarding-display.f7783c2b` | 写死 | 在观察期。 | 标题 | [onboarding-display.ts:195](../../apps/web/src/lib/onboarding-display.ts#L195) |
| `onboarding-display.900622ef` | 写死 | {…}将在 {…} 到期（还有 {…} 天），请尽快上传新的证件。 | 文字 | [onboarding-display.ts:200](../../apps/web/src/lib/onboarding-display.ts#L200) |
| `onboarding-display.86432336` | 写死 | 这是必交资质，供应商已被暂停，换上新证件审核通过后自动恢复。 | 文字 | [onboarding-display.ts:201](../../apps/web/src/lib/onboarding-display.ts#L201) |
| `onboarding-display.ff8146c3` | 写死 | {…}已于 {…} 到期。{…} | 文字 | [onboarding-display.ts:201](../../apps/web/src/lib/onboarding-display.ts#L201) |
| `onboarding-display.3f7be88a` | 写死 | 被驳回：{…} | 文字 | [onboarding-display.ts:202](../../apps/web/src/lib/onboarding-display.ts#L202) |
| `onboarding-display.5c22ed60` | 写死 | 需要补充：{…} | 文字 | [onboarding-display.ts:202](../../apps/web/src/lib/onboarding-display.ts#L202) |
| `onboarding-display.fee19762` | 写死 | 已审核通过 | 文字 | [onboarding-display.ts:202](../../apps/web/src/lib/onboarding-display.ts#L202) |
| `onboarding-display.6c52b218` | 写死 | 状态变为「{…}」{…} | 文字 | [onboarding-display.ts:203](../../apps/web/src/lib/onboarding-display.ts#L203) |
| `onboarding-display.83da06ee` | 写死 | 进入观察期：{…}。请尽快整改。 | 文字 | [onboarding-display.ts:204](../../apps/web/src/lib/onboarding-display.ts#L204) |
| `onboarding-display.422ff445` | 写死 | 已退出观察期。 | 文字 | [onboarding-display.ts:205](../../apps/web/src/lib/onboarding-display.ts#L205) |

## 订单详情「行程」卡片里的区域价说明（order-area-price-display.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/order-area-price-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-area-price-display.3dbaff4f` | 写死 | （已删除的区域） | 文字 | [order-area-price-display.ts:72](../../apps/web/src/lib/order-area-price-display.ts#L72) |
| `order-area-price-display.31822b45` | 写死 | 区域价 · {…} | 文字 | [order-area-price-display.ts:79](../../apps/web/src/lib/order-area-price-display.ts#L79) |
| `order-area-price-display.525c83f4` | 写死 | 区域价 | 文字 | [order-area-price-display.ts:79](../../apps/web/src/lib/order-area-price-display.ts#L79) |
| `order-area-price-display.a830ec93` | 写死 | 线路价 · 下车区域 {to} | 文字 | [order-area-price-display.ts:81](../../apps/web/src/lib/order-area-price-display.ts#L81) |
| `order-area-price-display.fba66766` | 写死 | 线路价 | 文字 | [order-area-price-display.ts:81](../../apps/web/src/lib/order-area-price-display.ts#L81) |
| `order-area-price-display.883b397c` | 写死 | 线路价 · {…} → {…} | 文字 | [order-area-price-display.ts:82](../../apps/web/src/lib/order-area-price-display.ts#L82) |
| `order-area-price-display.ecbdf417` | 写死 | 每公里 对外 {…} / 结算 {…} | 文字 | [order-area-price-display.ts:100](../../apps/web/src/lib/order-area-price-display.ts#L100) |
| `order-area-price-display.05cbe51b` | 写死 | 下车 | 文字 | [order-area-price-display.ts:118](../../apps/web/src/lib/order-area-price-display.ts#L118) |
| `order-area-price-display.70f793ca` | 写死 | 上车 | 文字 | [order-area-price-display.ts:118](../../apps/web/src/lib/order-area-price-display.ts#L118) |
| `order-area-price-display.8e166cb3` | 写死 | 在服务区域里，不加价 | 文字 | [order-area-price-display.ts:119](../../apps/web/src/lib/order-area-price-display.ts#L119) |
| `order-area-price-display.03c72dce` | 写死 | 经停 | 名称 | [order-area-price-display.ts:124](../../apps/web/src/lib/order-area-price-display.ts#L124) |
| `order-area-price-display.835880d7` | 写死 | {…}：{…} · 对外 {…} / 结算 {…} | 文字 | [order-area-price-display.ts:135](../../apps/web/src/lib/order-area-price-display.ts#L135)、136 行 |
| `order-area-price-display.979089bd` | 写死 | {…}：{…} · 加 {…} | 文字 | [order-area-price-display.ts:146](../../apps/web/src/lib/order-area-price-display.ts#L146)、147 行 |
| `order-area-price-display.8ac38bd2` | 写死 | 超公里：全程 {…}，套餐含 {package\_km} 公里，超出 {…} × 每公里 {…} = {…} | 文字 | [order-area-price-display.ts:218](../../apps/web/src/lib/order-area-price-display.ts#L218) |
| `order-area-price-display.46dd5f56` | 写死 | 预计超出 {…}，未预收，服务后按实际提交 | 文字 | [order-area-price-display.ts:220](../../apps/web/src/lib/order-area-price-display.ts#L220) |
| `order-area-price-display.50b7cdb3` | 写死 | 超时：{…}预计 {…}（含停留），套餐 {…}，{…} | 文字 | [order-area-price-display.ts:220](../../apps/web/src/lib/order-area-price-display.ts#L220) |
| `order-area-price-display.b3df0780` | 写死 | 未超出套餐时长 | 文字 | [order-area-price-display.ts:220](../../apps/web/src/lib/order-area-price-display.ts#L220) |
| `order-area-price-display.e09552b8` | 写死 | 预计用时（含缓冲）{…}， | 文字 | [order-area-price-display.ts:220](../../apps/web/src/lib/order-area-price-display.ts#L220) |
| `order-area-price-display.fadf9511` | 写死 | 超时：预计 {…}（含停留），套餐 {…}，超出 {…} × 每小时 {…} = {…} | 文字 | [order-area-price-display.ts:221](../../apps/web/src/lib/order-area-price-display.ts#L221) |

## 订单中心（order-center-display.ts）

用在：供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 首页；运营后台 · 人工报价；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/order-center-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-center-display.28020208` | 写死 | 已超时 | 名称 | [order-center-display.ts:105](../../apps/web/src/lib/order-center-display.ts#L105) |
| `order-center-display.b903fc32` | 写死 | 人工处理完 | 文字 | [order-center-display.ts:107](../../apps/web/src/lib/order-center-display.ts#L107) |
| `order-center-display.c57c361c` | 写死 | 条件已解除（系统关闭） | 文字 | [order-center-display.ts:107](../../apps/web/src/lib/order-center-display.ts#L107) |
| `order-center-display.69a03116` | 写死 | 取消后才付到钱 | 按钮 | [order-center-display.ts:109](../../apps/web/src/lib/order-center-display.ts#L109) |
| `order-center-display.6c6642a6` | 写死 | 退款失败 | 提示 | [order-center-display.ts:109](../../apps/web/src/lib/order-center-display.ts#L109) |
| `order-center-display.a495df15` | 写死 | 客人拒付 | 文字 | [order-center-display.ts:109](../../apps/web/src/lib/order-center-display.ts#L109) |
| `order-center-display.f2c70f03` | 写死 | 事后加收扣款失败 | 提示 | [order-center-display.ts:109](../../apps/web/src/lib/order-center-display.ts#L109) |
| `order-center-display.2f07a42c` | 写死 | 工单赔付 | 文字 | [order-center-display.ts:110](../../apps/web/src/lib/order-center-display.ts#L110) |
| `order-center-display.680910d1` | 写死 | 取消 | 文字 | [order-center-display.ts:110](../../apps/web/src/lib/order-center-display.ts#L110) |
| `order-center-display.f9a72806` | 写死 | 改期退差价 | 文字 | [order-center-display.ts:110](../../apps/web/src/lib/order-center-display.ts#L110) |
| `order-center-display.0b5d3512` | 写死 | 改期补差价 | 文字 | [order-center-display.ts:111](../../apps/web/src/lib/order-center-display.ts#L111) |
| `order-center-display.9ada6773` | 写死 | 事后加收 | 文字 | [order-center-display.ts:111](../../apps/web/src/lib/order-center-display.ts#L111) |
| `order-center-display.e4de012a` | 写死 | 下单付款 | 文字 | [order-center-display.ts:111](../../apps/web/src/lib/order-center-display.ts#L111) |
| `order-center-display.4e65cb1e` | 写死 | 派车截止 | 文字 | [order-center-display.ts:124](../../apps/web/src/lib/order-center-display.ts#L124) |
| `order-center-display.4e199186` | 写死 | 司机应到 | 文字 | [order-center-display.ts:127](../../apps/web/src/lib/order-center-display.ts#L127) |
| `order-center-display.4f3f725c` | 写死 | 客人报告司机没到 | 文字 | [order-center-display.ts:128](../../apps/web/src/lib/order-center-display.ts#L128) |
| `order-center-display.819859e2` | 写死 | 用车时间 | 文字 | [order-center-display.ts:132](../../apps/web/src/lib/order-center-display.ts#L132)、156 行 |
| `order-center-display.c42a8dbd` | 写死 | 推送的事件 | 文字 | [order-center-display.ts:135](../../apps/web/src/lib/order-center-display.ts#L135) |
| `order-center-display.af61ca4a` | 写死 | 最后一次失败 | 文字 | [order-center-display.ts:136](../../apps/web/src/lib/order-center-display.ts#L136) |
| `order-center-display.1f342135` | 写死 | 对方的应答 | 文字 | [order-center-display.ts:137](../../apps/web/src/lib/order-center-display.ts#L137) |
| `order-center-display.337c1aa2` | 写死 | 供应商提交 no-show | 文字 | [order-center-display.ts:140](../../apps/web/src/lib/order-center-display.ts#L140) |
| `order-center-display.f717b8cd` | 写死 | 加收类型 | 文字 | [order-center-display.ts:143](../../apps/web/src/lib/order-center-display.ts#L143) |
| `order-center-display.75a3f85c` | 写死 | 转人工的原因 | 文字 | [order-center-display.ts:144](../../apps/web/src/lib/order-center-display.ts#L144) |
| `order-center-display.5afcdc28` | 写死 | 客人异议期到 | 文字 | [order-center-display.ts:145](../../apps/web/src/lib/order-center-display.ts#L145) |
| `order-center-display.53d91f88` | 写死 | 原因 | 文字 | [order-center-display.ts:148](../../apps/web/src/lib/order-center-display.ts#L148) |
| `order-center-display.f42e20c7` | 写死 | 退款用途 | 文字 | [order-center-display.ts:149](../../apps/web/src/lib/order-center-display.ts#L149) |
| `order-center-display.d2510542` | 写死 | 收款 | 文字 | [order-center-display.ts:150](../../apps/web/src/lib/order-center-display.ts#L150) |
| `order-center-display.07ba1505` | 写死 | 金额 | 文字 | [order-center-display.ts:151](../../apps/web/src/lib/order-center-display.ts#L151) |
| `order-center-display.5dfd81ff` | 写死 | 已退 | 文字 | [order-center-display.ts:152](../../apps/web/src/lib/order-center-display.ts#L152) |
| `order-center-display.e0c813d5` | 写死 | 救援情形 | 文字 | [order-center-display.ts:155](../../apps/web/src/lib/order-center-display.ts#L155) |
| `order-center-display.e288667b` | 写死 | 你 | 文字 | [order-center-display.ts:165](../../apps/web/src/lib/order-center-display.ts#L165)、237 行 |
| `order-center-display.d7ffc32a` | 写死 | （已停用的同事） | 文字 | [order-center-display.ts:166](../../apps/web/src/lib/order-center-display.ts#L166) |
| `order-center-display.7017a51f` | 写死 | 供应商 | 文字 | [order-center-display.ts:173](../../apps/web/src/lib/order-center-display.ts#L173)、197、199、224 行 |
| `order-center-display.76419952` | 写死 | 租户 | 文字 | [order-center-display.ts:173](../../apps/web/src/lib/order-center-display.ts#L173) |
| `order-center-display.2f8e8a53` | 写死 | 等供应商回复 | 名称 | [order-center-display.ts:178](../../apps/web/src/lib/order-center-display.ts#L178) |
| `order-center-display.1c34b49a` | 写死 | 系统 | 文字 | [order-center-display.ts:197](../../apps/web/src/lib/order-center-display.ts#L197)、230 行 |
| `order-center-display.206698be` | 写死 | 渠道 | 文字 | [order-center-display.ts:197](../../apps/web/src/lib/order-center-display.ts#L197)、226 行 |
| `order-center-display.8b8db200` | 写死 | 客人 | 文字 | [order-center-display.ts:197](../../apps/web/src/lib/order-center-display.ts#L197)、228 行 |
| `order-center-display.990d7f03` | 写死 | 客服 | 文字 | [order-center-display.ts:197](../../apps/web/src/lib/order-center-display.ts#L197) |
| `order-center-display.571c561c` | 写死 | 平台 | 文字 | [order-center-display.ts:199](../../apps/web/src/lib/order-center-display.ts#L199)、222 行 |
| `order-center-display.5fc5152a` | 写死 | 驳回（按未履约处理） | 名称 | [order-center-display.ts:204](../../apps/web/src/lib/order-center-display.ts#L204) |
| `order-center-display.faaaf88b` | 写死 | 通过（客人未出现） | 名称 | [order-center-display.ts:204](../../apps/web/src/lib/order-center-display.ts#L204) |
| `order-center-display.b1fd3f52` | 写死 | 成立 | 名称 | [order-center-display.ts:205](../../apps/web/src/lib/order-center-display.ts#L205) |
| `order-center-display.bc304548` | 写死 | 不成立 | 名称 | [order-center-display.ts:206](../../apps/web/src/lib/order-center-display.ts#L206) |
| `order-center-display.582c00dc` | 写死 | 已处理 | 名称 | [order-center-display.ts:207](../../apps/web/src/lib/order-center-display.ts#L207) |
| `order-center-display.e7736389` | 写死 | 通过 | 名称 | [order-center-display.ts:208](../../apps/web/src/lib/order-center-display.ts#L208) |
| `order-center-display.3e7bba26` | 写死 | 待财务另付 | 文字 | [order-center-display.ts:216](../../apps/web/src/lib/order-center-display.ts#L216) |
| `order-center-display.753e6fcd` | 写死 | 不用另付 | 文字 | [order-center-display.ts:216](../../apps/web/src/lib/order-center-display.ts#L216) |
| `order-center-display.f4a00c8b` | 写死 | 已另付 | 文字 | [order-center-display.ts:216](../../apps/web/src/lib/order-center-display.ts#L216) |
| `order-center-display.2da2b5d0` | 写死 | 平台员工 | 文字 | [order-center-display.ts:222](../../apps/web/src/lib/order-center-display.ts#L222) |
| `order-center-display.9f49836f` | 写死 | 你们 | 文字 | [order-center-display.ts:224](../../apps/web/src/lib/order-center-display.ts#L224) |
| `order-center-display.b04fb95e` | 写死 | （同事） | 名称 | [order-center-display.ts:238](../../apps/web/src/lib/order-center-display.ts#L238) |
| `order-center-display.6d50e5ad` | 写死 | （已超时） | 文字 | [order-center-display.ts:244](../../apps/web/src/lib/order-center-display.ts#L244) |

## 取消、改单、事后加收、取消政策在页面上的说法（order-money-display.ts）

用在：供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/order-money-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-money-display.3d386e54` | 写死 | 包车 | 文字 | [order-money-display.ts:32](../../apps/web/src/lib/order-money-display.ts#L32) |
| `order-money-display.4f3a0131` | 写死 | 接送机 | 文字 | [order-money-display.ts:32](../../apps/web/src/lib/order-money-display.ts#L32) |
| `order-money-display.d4a33ffa` | 写死 | 点对点 | 文字 | [order-money-display.ts:32](../../apps/web/src/lib/order-money-display.ts#L32) |
| `order-money-display.572ea3a2` | 写死 | 扣 {…} | 文字 | [order-money-display.ts:39](../../apps/web/src/lib/order-money-display.ts#L39) |
| `order-money-display.d4eb74ec` | 写死 | 免费 | 文字 | [order-money-display.ts:39](../../apps/web/src/lib/order-money-display.ts#L39) |
| `order-money-display.0959ff13` | 写死 | 用车前 ≥ {min\_hours\_before} 小时 | 文字 | [order-money-display.ts:49](../../apps/web/src/lib/order-money-display.ts#L49) |
| `order-money-display.2d9a593f` | 写死 | {min\_hours\_before}–{upper} 小时 | 文字 | [order-money-display.ts:49](../../apps/web/src/lib/order-money-display.ts#L49) |
| `order-money-display.6f9d571b` | 写死 | &lt; {upper} 小时 | 文字 | [order-money-display.ts:49](../../apps/web/src/lib/order-money-display.ts#L49) |
| `order-money-display.a5b1cc1b` | 写死 | 任何时候 | 文字 | [order-money-display.ts:49](../../apps/web/src/lib/order-money-display.ts#L49) |
| `order-money-display.24fd9dac` | 写死 | 改派 | 文字 | [order-money-display.ts:62](../../apps/web/src/lib/order-money-display.ts#L62) |
| `order-money-display.bf4b5c67` | 写死 | 改单 | 文字 | [order-money-display.ts:63](../../apps/web/src/lib/order-money-display.ts#L63) |
| `order-money-display.2e5e89f9` | 写死 | 客人申请修改 | 文字 | [order-money-display.ts:64](../../apps/web/src/lib/order-money-display.ts#L64) |
| `order-money-display.e8400a15` | 写死 | 修改调整中 | 文字 | [order-money-display.ts:65](../../apps/web/src/lib/order-money-display.ts#L65) |
| `order-money-display.181827e7` | 写死 | 修改被拒绝 | 文字 | [order-money-display.ts:66](../../apps/web/src/lib/order-money-display.ts#L66) |
| `order-money-display.f49cefff` | 写死 | 修改没有确认 | 文字 | [order-money-display.ts:67](../../apps/web/src/lib/order-money-display.ts#L67) |
| `order-money-display.1893fcbf` | 写死 | 审核通过 | 文字 | [order-money-display.ts:68](../../apps/web/src/lib/order-money-display.ts#L68) |
| `order-money-display.1aa94b36` | 写死 | 发起救援 | 文字 | [order-money-display.ts:69](../../apps/web/src/lib/order-money-display.ts#L69) |
| `order-money-display.69d8abef` | 写死 | 转给救援供应商 | 文字 | [order-money-display.ts:70](../../apps/web/src/lib/order-money-display.ts#L70) |
| `order-money-display.37eef5b7` | 写死 | 救援接单 | 文字 | [order-money-display.ts:71](../../apps/web/src/lib/order-money-display.ts#L71) |
| `order-money-display.9c51dee9` | 写死 | 客人报告司机未到 | 文字 | [order-money-display.ts:72](../../apps/web/src/lib/order-money-display.ts#L72) |
| `order-money-display.f71f903a` | 写死 | 客人对加收提异议 | 文字 | [order-money-display.ts:73](../../apps/web/src/lib/order-money-display.ts#L73) |
| `order-money-display.c9bc73c9` | 写死 | 还没有收款或退款。客人付款、平台退款后，每一笔都会列在这里。 | 文字 | [order-money-display.ts:77](../../apps/web/src/lib/order-money-display.ts#L77) |
| `order-money-display.89b2e753` | 写死 | 还没有状态变化的记录。 | 文字 | [order-money-display.ts:80](../../apps/web/src/lib/order-money-display.ts#L80) |
| `order-money-display.cf3ae3f4` | 写死 | 客人取消了订单 | 提示 | [order-money-display.ts:92](../../apps/web/src/lib/order-money-display.ts#L92) |
| `order-money-display.bb67509e` | 写死 | 正在建付款 | 文字 | [order-money-display.ts:101](../../apps/web/src/lib/order-money-display.ts#L101) |
| `order-money-display.1e606310` | 写死 | 等客人付款 | 文字 | [order-money-display.ts:102](../../apps/web/src/lib/order-money-display.ts#L102) |
| `order-money-display.3743b00e` | 写死 | 付款处理中 | 文字 | [order-money-display.ts:103](../../apps/web/src/lib/order-money-display.ts#L103) |
| `order-money-display.43629250` | 写死 | 已付款 | 文字 | [order-money-display.ts:104](../../apps/web/src/lib/order-money-display.ts#L104) |
| `order-money-display.aa99e28a` | 写死 | 已作废（没有付款） | 文字 | [order-money-display.ts:105](../../apps/web/src/lib/order-money-display.ts#L105) |
| `order-money-display.2b765973` | 写死 | 扣款失败 | 提示 | [order-money-display.ts:106](../../apps/web/src/lib/order-money-display.ts#L106)、149 行 |
| `order-money-display.9bc45dc3` | 写死 | 补差价中 | 名称 | [order-money-display.ts:114](../../apps/web/src/lib/order-money-display.ts#L114) |
| `order-money-display.655672ba` | 写死 | 修改待确认 | 名称 | [order-money-display.ts:115](../../apps/web/src/lib/order-money-display.ts#L115) |
| `order-money-display.8ccd9c48` | 写死 | 调整中 | 名称 | [order-money-display.ts:116](../../apps/web/src/lib/order-money-display.ts#L116) |
| `order-money-display.4298f1a1` | 写死 | 已生效 | 名称 | [order-money-display.ts:117](../../apps/web/src/lib/order-money-display.ts#L117) |
| `order-money-display.4aa55b6e` | 写死 | 已拒绝 | 名称 | [order-money-display.ts:118](../../apps/web/src/lib/order-money-display.ts#L118) |
| `order-money-display.af26098a` | 写死 | 超时没确认 | 名称 | [order-money-display.ts:119](../../apps/web/src/lib/order-money-display.ts#L119) |
| `order-money-display.95bcab28` | 写死 | 差价没扣到 | 名称 | [order-money-display.ts:120](../../apps/web/src/lib/order-money-display.ts#L120) |
| `order-money-display.b12e9fe6` | 写死 | 已作废 | 名称 | [order-money-display.ts:121](../../apps/web/src/lib/order-money-display.ts#L121) |
| `order-money-display.9bbbc8d4` | 写死 | 客人申请修改，等你处理 | 文字 | [order-money-display.ts:126](../../apps/web/src/lib/order-money-display.ts#L126) |
| `order-money-display.d47500cf` | 写死 | 客人改了联系信息，已生效 | 文字 | [order-money-display.ts:127](../../apps/web/src/lib/order-money-display.ts#L127) |
| `order-money-display.f576427f` | 写死 | 修改已生效 | 文字 | [order-money-display.ts:128](../../apps/web/src/lib/order-money-display.ts#L128) |
| `order-money-display.daf48ea1` | 写死 | 修改没有通过（超时或平台代为拒绝） | 文字 | [order-money-display.ts:129](../../apps/web/src/lib/order-money-display.ts#L129) |
| `order-money-display.ab2e8623` | 写死 | 订单已取消 | 文字 | [order-money-display.ts:130](../../apps/web/src/lib/order-money-display.ts#L130) |
| `order-money-display.d4a453dd` | 写死 | 订单进入救援改派 | 文字 | [order-money-display.ts:131](../../apps/web/src/lib/order-money-display.ts#L131) |
| `order-money-display.d14cda0c` | 写死 | 需调整司机：{driver\_name} 没有邮箱，系统通知不到，请马上联系他。 | 文字 | [order-money-display.ts:137](../../apps/web/src/lib/order-money-display.ts#L137) |
| `order-money-display.80e720dc` | 写死 | 需调整司机：你们设置了手动发送，系统没有给 {driver\_name} 发邮件，请马上联系他。 | 文字 | [order-money-display.ts:138](../../apps/web/src/lib/order-money-display.ts#L138) |
| `order-money-display.80e8cde8` | 写死 | 需调整司机：系统已发邮件给 {driver\_name}，请确认他已经知道。 | 文字 | [order-money-display.ts:139](../../apps/web/src/lib/order-money-display.ts#L139) |
| `order-money-display.ac94679e` | 写死 | 异议期内 | 名称 | [order-money-display.ts:143](../../apps/web/src/lib/order-money-display.ts#L143) |
| `order-money-display.7d3ae224` | 写死 | 待平台审核 | 名称 | [order-money-display.ts:144](../../apps/web/src/lib/order-money-display.ts#L144) |
| `order-money-display.3ce19fa7` | 写死 | 客人有异议 | 名称 | [order-money-display.ts:145](../../apps/web/src/lib/order-money-display.ts#L145) |
| `order-money-display.031bb4df` | 写死 | 等扣款 | 名称 | [order-money-display.ts:146](../../apps/web/src/lib/order-money-display.ts#L146) |
| `order-money-display.83cd4c9a` | 写死 | 扣款中 | 名称 | [order-money-display.ts:147](../../apps/web/src/lib/order-money-display.ts#L147) |
| `order-money-display.db2c1c1d` | 写死 | 已扣款 | 名称 | [order-money-display.ts:148](../../apps/web/src/lib/order-money-display.ts#L148) |
| `order-money-display.6b8e768d` | 写死 | 已驳回 | 名称 | [order-money-display.ts:150](../../apps/web/src/lib/order-money-display.ts#L150) |
| `order-money-display.b072f360` | 写死 | 已撤回 | 名称 | [order-money-display.ts:151](../../apps/web/src/lib/order-money-display.ts#L151) |
| `order-money-display.4b3c69fd` | 写死 | 等着发 | 名称 | [order-money-display.ts:155](../../apps/web/src/lib/order-money-display.ts#L155) |
| `order-money-display.24ca5573` | 写死 | 处理中 | 名称 | [order-money-display.ts:156](../../apps/web/src/lib/order-money-display.ts#L156) |
| `order-money-display.ebe735bd` | 写死 | 已退 | 名称 | [order-money-display.ts:157](../../apps/web/src/lib/order-money-display.ts#L157) |
| `order-money-display.b8c46cc8` | 写死 | 失败 | 名称 | [order-money-display.ts:158](../../apps/web/src/lib/order-money-display.ts#L158) |
| `order-money-display.8029b075` | 写死 | 客人提了异议 | 文字 | [order-money-display.ts:165](../../apps/web/src/lib/order-money-display.ts#L165) |
| `order-money-display.e651eb19` | 写死 | 没有凭证 | 文字 | [order-money-display.ts:165](../../apps/web/src/lib/order-money-display.ts#L165) |
| `order-money-display.fdb57ff6` | 写死 | 超过对外价 50% | 文字 | [order-money-display.ts:165](../../apps/web/src/lib/order-money-display.ts#L165) |
| `order-money-display.746a7d93` | 写死 | 乘客 | 文字 | [order-money-display.ts:182](../../apps/web/src/lib/order-money-display.ts#L182) |
| `order-money-display.f62d813f` | 写死 | 航班号 | 文字 | [order-money-display.ts:183](../../apps/web/src/lib/order-money-display.ts#L183) |
| `order-money-display.15e44e63` | 写死 | 航班类型 | 文字 | [order-money-display.ts:184](../../apps/web/src/lib/order-money-display.ts#L184) |
| `order-money-display.dbcc475a` | 写死 | 即时通讯 | 文字 | [order-money-display.ts:185](../../apps/web/src/lib/order-money-display.ts#L185) |
| `order-money-display.2cde1f2b` | 写死 | 备注 | 说明 | [order-money-display.ts:186](../../apps/web/src/lib/order-money-display.ts#L186) |
| `order-money-display.bb011796` | 写死 | 上车点地址 | 文字 | [order-money-display.ts:187](../../apps/web/src/lib/order-money-display.ts#L187) |
| `order-money-display.b2559e1a` | 写死 | 下车点地址 | 文字 | [order-money-display.ts:188](../../apps/web/src/lib/order-money-display.ts#L188) |
| `order-money-display.d55b1004` | 写死 | 用车时间 | 文字 | [order-money-display.ts:189](../../apps/web/src/lib/order-money-display.ts#L189) |
| `order-money-display.495c1779` | 写死 | 人数 | 文字 | [order-money-display.ts:190](../../apps/web/src/lib/order-money-display.ts#L190) |
| `order-money-display.184c6b62` | 写死 | 行李 | 文字 | [order-money-display.ts:191](../../apps/web/src/lib/order-money-display.ts#L191) |
| `order-money-display.317d9e19` | 写死 | 国际航班 | 文字 | [order-money-display.ts:202](../../apps/web/src/lib/order-money-display.ts#L202) |
| `order-money-display.f7f8c380` | 写死 | 国内航班 | 文字 | [order-money-display.ts:202](../../apps/web/src/lib/order-money-display.ts#L202) |

## 付款组件的接入点（payment-driver.ts）

用在：官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/lib/payment-driver.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `payment-driver.e6c6c3cb` | 写死 | 地址里还有订单令牌 | 错误提示 | [payment-driver.ts:209](../../apps/web/src/lib/payment-driver.ts#L209) |
| `payment-driver.673c3899` | 写死 | Stripe.js 没有加载出来 | 错误提示 | [payment-driver.ts:214](../../apps/web/src/lib/payment-driver.ts#L214) |
| `payment-driver.3f0070eb` | 写死 | 查不到这笔付款 | 错误提示 | [payment-driver.ts:218](../../apps/web/src/lib/payment-driver.ts#L218) |
| `payment-driver.45c8cf1d` | 写死 | 付款表单没有加载出来 | 错误提示 | [payment-driver.ts:229](../../apps/web/src/lib/payment-driver.ts#L229) |

## Stripe 的付款错误 → 给客人看的中文（payment-errors.ts）

用在：官网（客人预订） · 订单页（查订单、管理订单）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）

文件：`apps/web/src/lib/payment-errors.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `payment-errors.80440a83` | 写死 | 您的银行卡被拒绝了。请换一张卡，或联系发卡银行。 | 文字 | [payment-errors.ts:16](../../apps/web/src/lib/payment-errors.ts#L16) |
| `payment-errors.59d379fa` | 写死 | 银行没有接受这次付款。请换一张卡，或稍后再试；多次失败请联系客服。 | 文字 | [payment-errors.ts:17](../../apps/web/src/lib/payment-errors.ts#L17) |
| `payment-errors.c945639d` | 写死 | 请检查银行卡信息后再付。 | 文字 | [payment-errors.ts:18](../../apps/web/src/lib/payment-errors.ts#L18) |
| `payment-errors.0290b50f` | 写死 | 卡号不正确。请检查后再付。 | 文字 | [payment-errors.ts:20](../../apps/web/src/lib/payment-errors.ts#L20) |
| `payment-errors.35ece861` | 写死 | 安全码不正确。请检查后再付。 | 文字 | [payment-errors.ts:21](../../apps/web/src/lib/payment-errors.ts#L21) |
| `payment-errors.66133f1d` | 写死 | 有效期不正确。请检查后再付。 | 文字 | [payment-errors.ts:22](../../apps/web/src/lib/payment-errors.ts#L22) |
| `payment-errors.55592fbf` | 写死 | 这张卡已过期。请换一张卡。 | 文字 | [payment-errors.ts:23](../../apps/web/src/lib/payment-errors.ts#L23) |
| `payment-errors.effe7425` | 写死 | 这张卡不支持这笔付款。请换一张卡。 | 文字 | [payment-errors.ts:24](../../apps/web/src/lib/payment-errors.ts#L24) |
| `payment-errors.4b423312` | 写死 | 这张卡已超过可用额度或次数限制。请换一张卡，或联系发卡银行。 | 文字 | [payment-errors.ts:25](../../apps/web/src/lib/payment-errors.ts#L25) |
| `payment-errors.610cdbed` | 写死 | 银行暂时没能处理这笔付款。请稍后再试，或换一张卡。 | 文字 | [payment-errors.ts:26](../../apps/web/src/lib/payment-errors.ts#L26) |
| `payment-errors.3358fe77` | 写死 | 您的银行卡余额不足。请换一张卡。 | 文字 | [payment-errors.ts:31](../../apps/web/src/lib/payment-errors.ts#L31) |
| `payment-errors.bda330ab` | 写死 | 银行刚处理过一笔相同的付款，这次没有受理。请等几分钟，刷新页面看订单状态，还是待付款再重新付款。 | 文字 | [payment-errors.ts:37](../../apps/web/src/lib/payment-errors.ts#L37) |
| `payment-errors.e761921d` | 写死 | 银行验证没有通过。请重新付款并完成验证，或换一张卡。 | 文字 | [payment-errors.ts:42](../../apps/web/src/lib/payment-errors.ts#L42) |
| `payment-errors.674d6475` | 写死 | 银行要求验证，但这次验证没有完成。请重新付款并完成验证，或换一张卡。 | 文字 | [payment-errors.ts:43](../../apps/web/src/lib/payment-errors.ts#L43) |
| `payment-errors.db9bb1e6` | 写死 | 卡号不完整。请检查后再付。 | 文字 | [payment-errors.ts:46](../../apps/web/src/lib/payment-errors.ts#L46) |
| `payment-errors.61917161` | 写死 | 安全码不完整。请检查后再付。 | 文字 | [payment-errors.ts:49](../../apps/web/src/lib/payment-errors.ts#L49) |
| `payment-errors.fba12280` | 写死 | 有效期不完整。请检查后再付。 | 文字 | [payment-errors.ts:52](../../apps/web/src/lib/payment-errors.ts#L52) |
| `payment-errors.5305304f` | 写死 | 邮编不正确。请检查后再付。 | 文字 | [payment-errors.ts:55](../../apps/web/src/lib/payment-errors.ts#L55) |
| `payment-errors.e14d01ac` | 写死 | 邮编不完整。请检查后再付。 | 文字 | [payment-errors.ts:56](../../apps/web/src/lib/payment-errors.ts#L56) |

## 运营后台「供应商、平台员工」各页面共用的文字和校验（platform-display.ts）

用在：供应商后台 · 区域地图（运营后台也用）；运营后台 · 供应商（列表、新建、详情）；运营后台 · 平台员工；运营后台 · 未覆盖需求；运营后台 · 账号安全和角色

文件：`apps/web/src/lib/platform-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-display.c44dbe95` | 写死 | {name}（测试） | 名称 | [platform-display.ts:10](../../apps/web/src/lib/platform-display.ts#L10) |
| `platform-display.4471d26a` | 写死 | 测试供应商：只用于验收，不能上架、不参与官网和渠道比价（ADR 0077）。 | 文字 | [platform-display.ts:14](../../apps/web/src/lib/platform-display.ts#L14) |
| `platform-display.cc94f5e6` | 写死 | 请填写邮箱 | 文字 | [platform-display.ts:20](../../apps/web/src/lib/platform-display.ts#L20) |
| `platform-display.87a587fd` | 写死 | 这不是一个邮箱地址 | 文字 | [platform-display.ts:21](../../apps/web/src/lib/platform-display.ts#L21) |
| `platform-display.3623cbfa` | 写死 | 请填写{what} | 文字 | [platform-display.ts:27](../../apps/web/src/lib/platform-display.ts#L27) |
| `platform-display.d1dfbfe3` | 写死 | {what}最多 {NAME\_MAX} 个字 | 文字 | [platform-display.ts:28](../../apps/web/src/lib/platform-display.ts#L28) |
| `platform-display.cbb7ab31` | 写死 | 请填写暂停原因 | 提示 | [platform-display.ts:32](../../apps/web/src/lib/platform-display.ts#L32) |
| `platform-display.a6054e51` | 写死 | 原因最多 {REASON\_MAX} 个字 | 提示 | [platform-display.ts:33](../../apps/web/src/lib/platform-display.ts#L33) |
| `platform-display.6dd5f13e` | 写死 | 待激活 | 名称 | [platform-display.ts:38](../../apps/web/src/lib/platform-display.ts#L38) |
| `platform-display.53caa9ca` | 写死 | 在用 | 名称 | [platform-display.ts:39](../../apps/web/src/lib/platform-display.ts#L39) |
| `platform-display.e2cdeaa4` | 写死 | 已停用 | 名称 | [platform-display.ts:40](../../apps/web/src/lib/platform-display.ts#L40) |
| `platform-display.1f58a648` | 写死 | 什么都能做，包括管理平台员工、看审计日志。人数越少越好，但至少要有两个人，免得一个人忘了密码就没人能处理。 | 文字 | [platform-display.ts:45](../../apps/web/src/lib/platform-display.ts#L45) |
| `platform-display.16c84a6f` | 写死 | 日常运营：管理供应商，处理订单和异常。 | 文字 | [platform-display.ts:46](../../apps/web/src/lib/platform-display.ts#L46) |
| `platform-display.ed836636` | 写死 | 负责供应商入驻：新建供应商、邀请管理员、暂停和恢复。 | 文字 | [platform-display.ts:47](../../apps/web/src/lib/platform-display.ts#L47) |
| `platform-display.c65b1633` | 写死 | 负责销售渠道和加价规则。 | 文字 | [platform-display.ts:48](../../apps/web/src/lib/platform-display.ts#L48) |
| `platform-display.49cca03e` | 写死 | 处理订单、工单和投诉。 | 文字 | [platform-display.ts:49](../../apps/web/src/lib/platform-display.ts#L49) |
| `platform-display.24a5f7b7` | 写死 | 负责对账、结算和付款。 | 文字 | [platform-display.ts:50](../../apps/web/src/lib/platform-display.ts#L50) |
| `platform-display.af026d6d` | 写死 | 负责价格和下单的风险规则。 | 文字 | [platform-display.ts:51](../../apps/web/src/lib/platform-display.ts#L51) |
| `platform-display.e85f5a3f` | 写死 | 维护城市、机场、车站、车型组、附加服务。 | 文字 | [platform-display.ts:52](../../apps/web/src/lib/platform-display.ts#L52) |
| `platform-display.432c98d0` | 写死 | 负责连接器和系统配置，可以看系统状态。 | 文字 | [platform-display.ts:53](../../apps/web/src/lib/platform-display.ts#L53) |
| `platform-display.5d56c9a2` | 写死 | 只能看，不能改。 | 文字 | [platform-display.ts:54](../../apps/web/src/lib/platform-display.ts#L54) |
| `platform-display.063de7ae` | 写死 | 看供应商 | 文字 | [platform-display.ts:62](../../apps/web/src/lib/platform-display.ts#L62) |
| `platform-display.f54867fe` | 写死 | 新建供应商、邀请管理员 | 文字 | [platform-display.ts:63](../../apps/web/src/lib/platform-display.ts#L63) |
| `platform-display.76c5b82a` | 写死 | 改供应商的名称和企业信息 | 文字 | [platform-display.ts:64](../../apps/web/src/lib/platform-display.ts#L64) |
| `platform-display.e0b0b5c5` | 写死 | 签约、开始试运营、暂停和恢复供应商（暂停、清退要另一位同事审核） | 文字 | [platform-display.ts:65](../../apps/web/src/lib/platform-display.ts#L65) |
| `platform-display.0d2576c5` | 写死 | 审核资质、发起合同新版本、处理供应商改名称和登记号的申请 | 文字 | [platform-display.ts:66](../../apps/web/src/lib/platform-display.ts#L66) |
| `platform-display.ac03005e` | 写死 | 审核同事发起的供应商暂停、清退、合同和资料修改（另一位同事审核） | 文字 | [platform-display.ts:67](../../apps/web/src/lib/platform-display.ts#L67) |
| `platform-display.6af9ab07` | 写死 | 查看供应商的商品和价格 | 文字 | [platform-display.ts:68](../../apps/web/src/lib/platform-display.ts#L68) |
| `platform-display.e993b8ea` | 写死 | 报价试算 | 文字 | [platform-display.ts:69](../../apps/web/src/lib/platform-display.ts#L69) |
| `platform-display.7843db97` | 写死 | 看未覆盖需求（客人询价一家都报不出价的地方） | 文字 | [platform-display.ts:70](../../apps/web/src/lib/platform-display.ts#L70) |
| `platform-display.e2798e39` | 写死 | 看主数据 | 文字 | [platform-display.ts:71](../../apps/web/src/lib/platform-display.ts#L71) |
| `platform-display.c2d497c5` | 写死 | 维护主数据 | 文字 | [platform-display.ts:72](../../apps/web/src/lib/platform-display.ts#L72) |
| `platform-display.769c34cb` | 写死 | 管理汇率（立即拉取、确认或放弃变动过大的汇率，发起人工锁定和解锁） | 文字 | [platform-display.ts:73](../../apps/web/src/lib/platform-display.ts#L73) |
| `platform-display.ade773c1` | 写死 | 审核汇率的人工锁定和解锁 | 文字 | [platform-display.ts:74](../../apps/web/src/lib/platform-display.ts#L74) |
| `platform-display.0860d5bb` | 写死 | 看渠道 | 文字 | [platform-display.ts:75](../../apps/web/src/lib/platform-display.ts#L75) |
| `platform-display.ecbf2f05` | 写死 | 管理渠道和加价规则（改加价、停用渠道要另一位同事审核） | 文字 | [platform-display.ts:76](../../apps/web/src/lib/platform-display.ts#L76) |
| `platform-display.1925be2e` | 写死 | 审核渠道的改动 | 文字 | [platform-display.ts:77](../../apps/web/src/lib/platform-display.ts#L77) |
| `platform-display.5654ebc9` | 写死 | 看待审核的改动 | 文字 | [platform-display.ts:78](../../apps/web/src/lib/platform-display.ts#L78) |
| `platform-display.b0546a29` | 写死 | 看订单 | 文字 | [platform-display.ts:79](../../apps/web/src/lib/platform-display.ts#L79) |
| `platform-display.6c8d3518` | 写死 | 手动重推给供应商的 Webhook | 文字 | [platform-display.ts:80](../../apps/web/src/lib/platform-display.ts#L80) |
| `platform-display.73eba78e` | 写死 | 代客人取消和改单、审核事后加收 | 文字 | [platform-display.ts:81](../../apps/web/src/lib/platform-display.ts#L81) |
| `platform-display.e171f93f` | 写死 | 代供应商回传履约（接到客人、完成要另一位同事审核） | 文字 | [platform-display.ts:82](../../apps/web/src/lib/platform-display.ts#L82) |
| `platform-display.2b9e57fa` | 写死 | 审核代传的接到客人和完成 | 文字 | [platform-display.ts:83](../../apps/web/src/lib/platform-display.ts#L83) |
| `platform-display.e32134a9` | 写死 | 代供应商同意或拒绝客人的修改申请（要写原因，有审计） | 文字 | [platform-display.ts:84](../../apps/web/src/lib/platform-display.ts#L84) |
| `platform-display.b02358cc` | 写死 | 核实客人身份后重发官网订单链接（发到新邮箱要另一位同事审核） | 文字 | [platform-display.ts:85](../../apps/web/src/lib/platform-display.ts#L85) |
| `platform-display.fc68cb2c` | 写死 | 审核把订单链接发到新邮箱、代客人改乘客邮箱 | 文字 | [platform-display.ts:86](../../apps/web/src/lib/platform-display.ts#L86) |
| `platform-display.cb1f54ca` | 写死 | 处理退款和扣款的异常、审核多退给客人的取消 | 文字 | [platform-display.ts:87](../../apps/web/src/lib/platform-display.ts#L87) |
| `platform-display.7c33ac7f` | 写死 | 修改平台取消政策（要另一位同事审核） | 文字 | [platform-display.ts:88](../../apps/web/src/lib/platform-display.ts#L88) |
| `platform-display.1db3bff9` | 写死 | 审核平台取消政策的修改 | 文字 | [platform-display.ts:89](../../apps/web/src/lib/platform-display.ts#L89) |
| `platform-display.055f3491` | 写死 | 发起救援改派、给候选供应商发救援单、认定不可抗力 | 文字 | [platform-display.ts:90](../../apps/web/src/lib/platform-display.ts#L90) |
| `platform-display.d0a14f2c` | 写死 | 审核人工指定的救援供应商 | 文字 | [platform-display.ts:91](../../apps/web/src/lib/platform-display.ts#L91) |
| `platform-display.ddd60bf8` | 写死 | 认领和关闭订单异常 | 文字 | [platform-display.ts:92](../../apps/web/src/lib/platform-display.ts#L92) |
| `platform-display.dacb6c41` | 写死 | 看工单 | 文字 | [platform-display.ts:93](../../apps/web/src/lib/platform-display.ts#L93) |
| `platform-display.32c6f074` | 写死 | 处理工单（征求供应商意见、判定和赔付；赔付达到阈值要另一位同事审核） | 文字 | [platform-display.ts:94](../../apps/web/src/lib/platform-display.ts#L94) |
| `platform-display.46e6562a` | 写死 | 审核超过阈值的工单判定 | 文字 | [platform-display.ts:95](../../apps/web/src/lib/platform-display.ts#L95) |
| `platform-display.c6a7a2c1` | 写死 | 修改客人赔付表（要另一位同事审核） | 文字 | [platform-display.ts:96](../../apps/web/src/lib/platform-display.ts#L96) |
| `platform-display.f54ca80e` | 写死 | 审核客人赔付表的修改 | 文字 | [platform-display.ts:97](../../apps/web/src/lib/platform-display.ts#L97) |
| `platform-display.4a833013` | 写死 | 看平台员工 | 文字 | [platform-display.ts:98](../../apps/web/src/lib/platform-display.ts#L98) |
| `platform-display.bab77cc8` | 写死 | 管理平台员工 | 文字 | [platform-display.ts:99](../../apps/web/src/lib/platform-display.ts#L99) |
| `platform-display.3238bf40` | 写死 | 看审计日志 | 文字 | [platform-display.ts:100](../../apps/web/src/lib/platform-display.ts#L100) |
| `platform-display.f53505a5` | 写死 | 看系统状态 | 文字 | [platform-display.ts:101](../../apps/web/src/lib/platform-display.ts#L101) |
| `platform-display.d54c19b0` | 写死 | 管理第三方密钥（在后台填写、更换、清空和测试谷歌地图、Stripe 的密钥） | 文字 | [platform-display.ts:102](../../apps/web/src/lib/platform-display.ts#L102) |
| `platform-display.4aa89762` | 写死 | 看角色 | 文字 | [platform-display.ts:103](../../apps/web/src/lib/platform-display.ts#L103) |
| `platform-display.f5596a7e` | 写死 | 新建角色、发起角色的修改（要另一位超级管理员审核） | 文字 | [platform-display.ts:104](../../apps/web/src/lib/platform-display.ts#L104) |
| `platform-display.4f54702a` | 写死 | 审核角色的修改 | 文字 | [platform-display.ts:105](../../apps/web/src/lib/platform-display.ts#L105) |
| `platform-display.36a1b371` | 写死 | 看供应商账单和付款批次 | 文字 | [platform-display.ts:106](../../apps/web/src/lib/platform-display.ts#L106) |
| `platform-display.b01c742f` | 写死 | 出账、答复供应商的异议、作废重出、发起付款（要另一位同事审核）、锁定付款批次 | 文字 | [platform-display.ts:107](../../apps/web/src/lib/platform-display.ts#L107) |
| `platform-display.d716a2b0` | 写死 | 审核付款给供应商 | 文字 | [platform-display.ts:108](../../apps/web/src/lib/platform-display.ts#L108) |
| `platform-display.997f90b7` | 写死 | 看通知记录和通知模板 | 文字 | [platform-display.ts:109](../../apps/web/src/lib/platform-display.ts#L109) |
| `platform-display.c351d6d2` | 写死 | 手动重试发送失败的通知 | 文字 | [platform-display.ts:110](../../apps/web/src/lib/platform-display.ts#L110) |
| `platform-display.c7bcb45e` | 写死 | 看客人留下联系方式的人工报价申请（打开详情看联系方式，有审计） | 文字 | [platform-display.ts:111](../../apps/web/src/lib/platform-display.ts#L111) |
| `platform-display.d1efb10d` | 写死 | 跟进人工报价申请（指派、改状态、写备注） | 文字 | [platform-display.ts:112](../../apps/web/src/lib/platform-display.ts#L112) |
| `platform-display.deb3bcf6` | 写死 | 看官网设置 | 文字 | [platform-display.ts:113](../../apps/web/src/lib/platform-display.ts#L113) |
| `platform-display.d4582b06` | 写死 | 修改官网设置（客服 WhatsApp 号码） | 文字 | [platform-display.ts:114](../../apps/web/src/lib/platform-display.ts#L114) |
| `platform-display.be714a18` | 写死 | 看嵌入组件（嵌入码和域名白名单） | 文字 | [platform-display.ts:115](../../apps/web/src/lib/platform-display.ts#L115) |
| `platform-display.f83da62a` | 写死 | 管理嵌入组件（生成嵌入码、改域名白名单、停用） | 文字 | [platform-display.ts:116](../../apps/web/src/lib/platform-display.ts#L116) |
| `platform-display.31438f26` | 写死 | 管理供应商（新建、邀请管理员、改名称和企业信息、审核资质和合同、签约和试运营、暂停和恢复；暂停、清退、合同、供应商的资料修改要另一位同事审核） | 文字 | [platform-display.ts:134](../../apps/web/src/lib/platform-display.ts#L134) |
| `platform-display.2148b7b1` | 写死 | 系统不接受这个邮箱地址。请核对有没有写错：@ 前面只能是英文字母、数字和常见符号，@ 后面要是完整的域名（如 example.com）。 | 文字 | [platform-display.ts:168](../../apps/web/src/lib/platform-display.ts#L168) |

## 两个后台（portal.ts）

用在：供应商后台 · Webhook 设置（运营后台的推送记录也在这里）；供应商后台 · 价格规则总览；供应商后台 · 企业信息；供应商后台 · 公司；供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 司机和车辆；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 救援单和扣款；供应商后台 · 服务表现；供应商后台 · 订单（列表、详情）；供应商后台 · 账单；供应商后台 · 通知（运营后台的通知中心、通知模板也在这里）；供应商后台 · 首页；司机页 · 司机任务页；官网（客人预订） · 多日行程报价页（/book/trip）；官网（客人预订） · 官网外框（页头、页脚、出错页）；官网（客人预订） · 旧预订地址跳转；官网（客人预订） · 订单页（查订单、管理订单）；官网（客人预订） · 预订页（/book）；嵌入预订（合作网站上的组件和嵌入页） · 嵌入预订页（合作网站里的预订页）；登录和账号（两个后台共用） · 两步验证；登录和账号（两个后台共用） · 修改密码；登录和账号（两个后台共用） · 找不到页面；登录和账号（两个后台共用） · 登录；登录和账号（两个后台共用） · 设置密码（接受邀请、重设密码）；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 供应商（列表、新建、详情）；运营后台 · 共享区域去重；运营后台 · 取消政策；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 平台员工；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 收款账户审核和银行文件；运营后台 · 救援；运营后台 · 未覆盖需求；运营后台 · 汇率；运营后台 · 渠道；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 账号安全和角色；运营后台 · 资质审核；运营后台 · 赔付表；运营后台 · 首页

文件：`apps/web/src/lib/portal.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `portal.8a69ee33` | 写死 | 供应商后台 | 名称 | [portal.ts:28](../../apps/web/src/lib/portal.ts#L28) |
| `portal.2e4d0678` | 写死 | 平台管理员请从此登录 | 名称 | [portal.ts:37](../../apps/web/src/lib/portal.ts#L37) |
| `portal.e2312e4d` | 写死 | 运营后台 | 名称 | [portal.ts:41](../../apps/web/src/lib/portal.ts#L41) |
| `portal.933bebf5` | 写死 | 我是供应商，去供应商后台登录 | 名称 | [portal.ts:50](../../apps/web/src/lib/portal.ts#L50) |

## 价格日历的月份、格子和选日期（price-calendar.ts）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）；运营后台 · 报价试算

文件：`apps/web/src/lib/price-calendar.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `price-calendar.649d483e` | 写死 | {…} 年 {…} 月 | 标题 | [price-calendar.ts:50](../../apps/web/src/lib/price-calendar.ts#L50) |
| `price-calendar.7d634b5c` | 写死 | {…} 月 {…} 日{…} | 文字 | [price-calendar.ts:59](../../apps/web/src/lib/price-calendar.ts#L59) |
| `price-calendar.ba163597` | 写死 | 止 | 文字 | [price-calendar.ts:73](../../apps/web/src/lib/price-calendar.ts#L73) |
| `price-calendar.e025cc45` | 写死 | 起 | 文字 | [price-calendar.ts:73](../../apps/web/src/lib/price-calendar.ts#L73) |
| `price-calendar.7f5b8270` | 写死 | 调完和基础价一样 | 文字 | [price-calendar.ts:146](../../apps/web/src/lib/price-calendar.ts#L146) |
| `price-calendar.afce6369` | 写死 | 上调 | 文字 | [price-calendar.ts:146](../../apps/web/src/lib/price-calendar.ts#L146) |
| `price-calendar.ff615c66` | 写死 | 下调 | 文字 | [price-calendar.ts:146](../../apps/web/src/lib/price-calendar.ts#L146) |
