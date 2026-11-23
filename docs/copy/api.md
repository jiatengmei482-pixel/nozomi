# 后端返回的提示（接口错误等）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 1450 条：写死 1450 条，已走 key 0 条。列的意思见 [README](README.md)。

## 页面

- [构建 Fastify 应用（app.ts）](#构建-fastify-应用appts)（1 条）
- [统一的错误返回格式（errors.ts）](#统一的错误返回格式errorsts)（12 条）
- [健康检查（health.ts）](#健康检查healthts)（1 条）
- [游标分页（pagination.ts）](#游标分页paginationts)（2 条）
- [/tenant/v1 的区域接口（areas.ts）](#tenantv1-的区域接口areasts)（3 条）
- [银行转账文件和供应商收款账户的接口（bank-files.ts）](#银行转账文件和供应商收款账户的接口bank-filests)（4 条）
- [供应商应付账单与付款批次的接口（billing.ts）](#供应商应付账单与付款批次的接口billingts)（3 条）
- [渠道、加价规则、API 客户端、双人复核的平台接口（channels.ts）](#渠道加价规则api-客户端双人复核的平台接口channelsts)（5 条）
- [包车机场开始 / 机场结束套餐的机场绑定（charter-airports.ts）](#包车机场开始--机场结束套餐的机场绑定charter-airportsts)（13 条）
- [派车和调度回传（dispatch.ts）](#派车和调度回传dispatchts)（1 条）
- [司机 H5 的接口（driver.ts）](#司机-h5-的接口driverts)（1 条）
- [嵌入组件（embed.ts）](#嵌入组件embedts)（14 条）
- [司机、车辆（fleet.ts）](#司机车辆fleetts)（3 条）
- [汇率中心的接口（fx.ts）](#汇率中心的接口fxts)（3 条）
- [价格规则和库存的 Excel 导入导出接口（import-export.ts）](#价格规则和库存的-excel-导入导出接口import-exportts)（3 条）
- [库存的接口（inventory.ts）](#库存的接口inventoryts)（1 条）
- [人工报价申请和官网设置（manual-quotes.ts）](#人工报价申请和官网设置manual-quotests)（19 条）
- [平台主数据的接口（master-data.ts）](#平台主数据的接口master-datats)（5 条）
- [运营后台下拉框的主数据选项（master-options.ts）](#运营后台下拉框的主数据选项master-optionsts)（1 条）
- [通知中心（notifications.ts）](#通知中心notificationsts)（1 条）
- [取消、改单、事后加收、取消政策的接口（order-actions.ts）](#取消改单事后加收取消政策的接口order-actionsts)（7 条）
- [订单中心的异常队列、工单、赔付表（order-center.ts）](#订单中心的异常队列工单赔付表order-centerts)（4 条）
- [订单的只读接口（orders.ts）](#订单的只读接口ordersts)（3 条）
- [/platform/v1 查看供应商的商品（platform-products.ts）](#platformv1-查看供应商的商品platform-productsts)（1 条）
- [平台账号安全的接口（platform-security.ts）](#平台账号安全的接口platform-securityts)（5 条）
- [运营后台的区域共享库去重（platform-shared-areas.ts）](#运营后台的区域共享库去重platform-shared-areasts)（1 条）
- [platform.ts](#platformts)（3 条）
- [价格规则、调价规则、价格日历、缺价组合、价格概况、子品牌取整…（prices.ts）](#价格规则调价规则价格日历缺价组合价格概况子品牌取整pricests)（9 条）
- [/tenant/v1 的子品牌和商品接口（products.ts）](#tenantv1-的子品牌和商品接口productsts)（3 条）
- [报价试算的两个接口（quotes.ts）](#报价试算的两个接口quotests)（38 条）
- [平台的只读核对报告（reports.ts）](#平台的只读核对报告reportsts)（2 条）
- [救援改派与违约金的接口（rescues.ts）](#救援改派与违约金的接口rescuests)（11 条）
- [sales.ts](#salests)（4 条）
- [官网的行程报价接口（site-trips.ts）](#官网的行程报价接口site-tripsts)（4 条）
- [site.ts](#sitets)（49 条）
- [供应商入驻的接口（tenant-onboarding.ts）](#供应商入驻的接口tenant-onboardingts)（4 条）
- [供应商名称和企业信息的维护（tenant-profile.ts）](#供应商名称和企业信息的维护tenant-profilets)（15 条）
- [推送给供应商的 Webhook（tenant-webhooks.ts）](#推送给供应商的-webhooktenant-webhooksts)（1 条）
- [tenant.ts](#tenantts)（1 条）
- [跨段规则配置（trip-rules.ts）](#跨段规则配置trip-rulests)（11 条）
- [运营后台「未覆盖需求」（uncovered-demands.ts）](#运营后台未覆盖需求uncovered-demandsts)（3 条）
- [运营后台（view-link.ts）](#运营后台view-linkts)（3 条）
- [机场导入（airport-import.ts）](#机场导入airport-importts)（3 条）
- [机场的中文名、日文名从 GeoNames 导入（airport-name-import.ts）](#机场的中文名日文名从-geonames-导入airport-name-importts)（2 条）
- [敏感操作双人复核的通用机制（approvals.ts）](#敏感操作双人复核的通用机制approvalsts)（5 条）
- [区域重叠清理（area-cleanup.ts）](#区域重叠清理area-cleanupts)（7 条）
- [只读核对的接口版（area-role-preview-report.ts）](#只读核对的接口版area-role-preview-reportts)（1 条）
- [切换前的只读清单（area-role-preview.ts）](#切换前的只读清单area-role-previewts)（25 条）
- [区域的业务流程（areas.ts）](#区域的业务流程areasts)（28 条）
- [银行转账文件的流程（bank-files.ts）](#银行转账文件的流程bank-filests)（22 条）
- [供应商应付账单与付款批次的业务流程（billing.ts）](#供应商应付账单与付款批次的业务流程billingts)（19 条）
- [预订草稿（booking-drafts.ts）](#预订草稿booking-draftsts)（1 条）
- [平台统一取消政策（cancellation-policy.ts）](#平台统一取消政策cancellation-policyts)（14 条）
- [取消（cancellations.ts）](#取消cancellationsts)（10 条）
- [渠道的 API 客户端与密钥（channel-clients.ts）](#渠道的-api-客户端与密钥channel-clientsts)（4 条）
- [渠道与加价规则（channels.ts）](#渠道与加价规则channelsts)（44 条）
- [包车三层区域的保存校验（charter-layers.ts）](#包车三层区域的保存校验charter-layersts)（6 条）
- [包车三层区域的数据迁移（charter-three-layer.ts）](#包车三层区域的数据迁移charter-three-layerts)（10 条）
- [城市导入（city-import.ts）](#城市导入city-importts)（3 条）
- [客人赔付表（compensation-table.ts）](#客人赔付表compensation-tablets)（7 条）
- [派车（dispatch.ts）](#派车dispatchts)（7 条）
- [计程价的业务流程（distance-prices.ts）](#计程价的业务流程distance-pricests)（10 条）
- [司机链接自动发邮件（driver-link-email.ts）](#司机链接自动发邮件driver-link-emailts)（9 条）
- [司机 H5（driver-trip.ts）](#司机-h5driver-tripts)（16 条）
- [登录和账号相关的业务错误（errors.ts）](#登录和账号相关的业务错误errorsts)（51 条）
- [订单异常队列（exceptions.ts）](#订单异常队列exceptionsts)（4 条）
- [服务后加收（extra-charges.ts）](#服务后加收extra-chargests)（20 条）
- [司机、车辆的业务流程（fleet.ts）](#司机车辆的业务流程fleetts)（13 条）
- [履约回传（fulfilment.ts）](#履约回传fulfilmentts)（4 条）
- [汇率中心（fx-center.ts）](#汇率中心fx-centerts)（10 条）
- [汇率人工锁定（fx-locks.ts）](#汇率人工锁定fx-locksts)（18 条）
- [价格规则和库存的 Excel 批量导入导出（import-export.ts）](#价格规则和库存的-excel-批量导入导出import-exportts)（136 条）
- [运营后台填写的第三方密钥（integration-secrets.ts）](#运营后台填写的第三方密钥integration-secretsts)（43 条）
- [库存的业务流程（inventory.ts）](#库存的业务流程inventoryts)（11 条）
- [包车三层的旧价格数据清理（legacy-price-cleanup.ts）](#包车三层的旧价格数据清理legacy-price-cleanupts)（1 条）
- [内部发信接口（mail.ts）](#内部发信接口mailts)（2 条）
- [人工报价申请（manual-quotes.ts）](#人工报价申请manual-quotests)（7 条）
- [平台主数据的业务流程（master-data.ts）](#平台主数据的业务流程master-datats)（26 条）
- [通知中心的后台任务（notification-jobs.ts）](#通知中心的后台任务notification-jobsts)（23 条）
- [通知中心的接口层业务（notifications.ts）](#通知中心的接口层业务notificationsts)（6 条）
- [改单（order-changes.ts）](#改单order-changests)（25 条）
- [订单的退款和离线扣款（order-money.ts）](#订单的退款和离线扣款order-moneyts)（9 条）
- [查订单（order-queries.ts）](#查订单order-queriests)（2 条）
- [包车经停顺序建议（order-suggestion.ts）](#包车经停顺序建议order-suggestionts)（7 条）
- [供应商后台的待办和角标（order-todos.ts）](#供应商后台的待办和角标order-todosts)（2 条）
- [下单与付款（orders.ts）](#下单与付款ordersts)（22 条）
- [运营「代客人改单」改乘客邮箱要双人复核（passenger-email-review.ts）](#运营代客人改单改乘客邮箱要双人复核passenger-email-reviewts)（6 条）
- [运营看乘客的完整联系方式和手写内容原文（passenger-privacy.ts）](#运营看乘客的完整联系方式和手写内容原文passenger-privacyts)（1 条）
- [收款服务（payment-webhooks.ts）](#收款服务payment-webhooksts)（3 条）
- [供应商收款账户的流程（payout-accounts.ts）](#供应商收款账户的流程payout-accountsts)（10 条）
- [平台员工的两步验证（platform-mfa.ts）](#平台员工的两步验证platform-mfats)（2 条）
- [运营后台查看供应商的商品（platform-products.ts）](#运营后台查看供应商的商品platform-productsts)（1 条）
- [平台角色管理（platform-roles.ts）](#平台角色管理platform-rolests)（5 条）
- [平台员工账号管理（platform-staff.ts）](#平台员工账号管理platform-staffts)（5 条）
- [平台侧的租户管理（platform-tenants.ts）](#平台侧的租户管理platform-tenantsts)（2 条）
- [价格表导入第 1 阶段的写入（price-import.ts）](#价格表导入第-1-阶段的写入price-importts)（7 条）
- [价格规则、调价规则、价格日历、缺价组合、子品牌取整单位、节假…（prices.ts）](#价格规则调价规则价格日历缺价组合子品牌取整单位节假pricests)（51 条）
- [加价规则 / 渠道定价参数生效前的毛利试算（pricing-impact.ts）](#加价规则--渠道定价参数生效前的毛利试算pricing-impactts)（5 条）
- [子品牌和商品的业务流程（products.ts）](#子品牌和商品的业务流程productsts)（100 条）
- [运营代供应商回传履约（proxy-fulfilment.ts）](#运营代供应商回传履约proxy-fulfilmentts)（7 条）
- [测试环境专用的 QA 测试供应商（qa-tenant.ts）](#测试环境专用的-qa-测试供应商qa-tenantts)（14 条）
- [报价（quotes.ts）](#报价quotests)（20 条）
- [/sales/v1 的限流（rate-limit.ts）](#salesv1-的限流rate-limitts)（1 条）
- [救援改派与违约金（rescues.ts）](#救援改派与违约金rescuests)（35 条）
- [/sales/v1 的渠道鉴权（sales-auth.ts）](#salesv1-的渠道鉴权sales-authts)（3 条）
- [正式询价 POST /sales/v1/quotes、GET…（sales-quotes.ts）](#正式询价-post-salesv1quotesgetsales-quotests)（5 条）
- [区域共享库（shared-areas.ts）](#区域共享库shared-areasts)（12 条）
- [官网（site.ts）](#官网sitets)（9 条）
- [租户用户的登录、会话校验、退出、接受邀请（tenant-auth.ts）](#租户用户的登录会话校验退出接受邀请tenant-authts)（1 条）
- [供应商的每日检查（tenant-jobs.ts）](#供应商的每日检查tenant-jobsts)（6 条）
- [供应商入驻（tenant-onboarding.ts）](#供应商入驻tenant-onboardingts)（41 条）
- [租户用户管理（tenant-users.ts）](#租户用户管理tenant-usersts)（2 条）
- [推送给供应商（tenant-webhooks.ts）](#推送给供应商tenant-webhooksts)（12 条）
- [工单（tickets.ts）](#工单ticketsts)（48 条）
- [AI 行程报价 P1 的编排接口（trips.ts）](#ai-行程报价-p1-的编排接口tripsts)（29 条）
- [运营核实后把官网订单链接发给客人（view-link-resend.ts）](#运营核实后把官网订单链接发给客人view-link-resendts)（5 条）
- [请求参数校验（validation.ts）](#请求参数校验validationts)（29 条）

## 构建 Fastify 应用（app.ts）

文件：`apps/api/src/app.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `app.43e7e2d4` | 写死 | 接口不存在 | 文字 | [app.ts:240](../../apps/api/src/app.ts#L240) |

## 统一的错误返回格式（errors.ts）

文件：`apps/api/src/errors.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `errors.bcfe624c` | 写死 | 请求格式不正确 | 提示 | [errors.ts:34](../../apps/api/src/errors.ts#L34) |
| `errors.7f58c9ec` | 写死 | 接口不存在 | 提示 | [errors.ts:35](../../apps/api/src/errors.ts#L35) |
| `errors.b22509f3` | 写死 | 不支持的请求方法 | 提示 | [errors.ts:36](../../apps/api/src/errors.ts#L36) |
| `errors.c26feb63` | 写死 | 请求发送超时 | 提示 | [errors.ts:37](../../apps/api/src/errors.ts#L37) |
| `errors.c7df88d3` | 写死 | 请求体过大 | 提示 | [errors.ts:38](../../apps/api/src/errors.ts#L38) |
| `errors.09ac9840` | 写死 | 不支持的请求内容类型 | 提示 | [errors.ts:39](../../apps/api/src/errors.ts#L39) |
| `errors.1ae61091` | 写死 | 请求过于频繁 | 提示 | [errors.ts:40](../../apps/api/src/errors.ts#L40) |
| `errors.4ac0efd8` | 写死 | 请求头过大 | 提示 | [errors.ts:41](../../apps/api/src/errors.ts#L41) |
| `errors.fb645620` | 写死 | 请求参数校验未通过 | 文字 | [errors.ts:87](../../apps/api/src/errors.ts#L87) |
| `errors.9fab5f49` | 写死 | 这次操作和别人同时进行的修改撞上了，什么都没有改动，请重试 | 文字 | [errors.ts:94](../../apps/api/src/errors.ts#L94) |
| `errors.499cc1d5` | 写死 | 请求无法处理 | 提示 | [errors.ts:100](../../apps/api/src/errors.ts#L100) |
| `errors.a6f0cc0b` | 写死 | 服务器内部错误，请稍后重试 | 文字 | [errors.ts:106](../../apps/api/src/errors.ts#L106) |

## 健康检查（health.ts）

文件：`apps/api/src/health.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `health.5958ca4a` | 写死 | 超过 {ms} 毫秒未完成 | 文字 | [health.ts:29](../../apps/api/src/health.ts#L29) |

## 游标分页（pagination.ts）

文件：`apps/api/src/pagination.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `pagination.3fdfca49` | 写死 | 请求参数校验未通过 | 错误提示 | [pagination.ts:37](../../apps/api/src/pagination.ts#L37) |
| `pagination.b65e2a7f` | 写死 | 游标无效，请使用上一页返回的 next\_cursor | 提示 | [pagination.ts:39](../../apps/api/src/pagination.ts#L39) |

## /tenant/v1 的区域接口（areas.ts）

文件：`apps/api/src/routes/areas.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `areas.b5a6e9b9` | 写死 | 至少填写一种语言的名称 | 文字 | [areas.ts:45](../../apps/api/src/routes/areas.ts#L45) |
| `areas.3cb5c2d2` | 写死 | 区域 | 文字 | [areas.ts:256](../../apps/api/src/routes/areas.ts#L256)、307、315、330、337、343 行 |
| `areas.dba2d3b1` | 写死 | 共享区域 | 文字 | [areas.ts:271](../../apps/api/src/routes/areas.ts#L271) |

## 银行转账文件和供应商收款账户的接口（bank-files.ts）

文件：`apps/api/src/routes/bank-files.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `bank-files.61102bf5` | 写死 | 流水号是 1–64 位英文字母、数字和 / \_ . : -，要以字母或数字开头 | 文字 | [bank-files.ts:80](../../apps/api/src/routes/bank-files.ts#L80) |
| `bank-files.8601754d` | 写死 | 收款账户 | 文字 | [bank-files.ts:244](../../apps/api/src/routes/bank-files.ts#L244)、258、266 行 |
| `bank-files.17c4cfc2` | 写死 | 付款批次 | 文字 | [bank-files.ts:275](../../apps/api/src/routes/bank-files.ts#L275)、280 行 |
| `bank-files.d718a60c` | 写死 | 转账文件 | 文字 | [bank-files.ts:294](../../apps/api/src/routes/bank-files.ts#L294)、300、312、320 行 |

## 供应商应付账单与付款批次的接口（billing.ts）

文件：`apps/api/src/routes/billing.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `billing.fc95223f` | 写死 | 账单周期的格式是 YYYY-MM | 文字 | [billing.ts:47](../../apps/api/src/routes/billing.ts#L47) |
| `billing.9f384714` | 写死 | 账单 | 文字 | [billing.ts:166](../../apps/api/src/routes/billing.ts#L166)、171、176、203、208、215、223 行 |
| `billing.0a0b9d6d` | 写死 | 付款批次 | 文字 | [billing.ts:237](../../apps/api/src/routes/billing.ts#L237)、244 行 |

## 渠道、加价规则、API 客户端、双人复核的平台接口（channels.ts）

文件：`apps/api/src/routes/channels.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `channels.8f61341b` | 写死 | 日期写成 YYYY-MM-DD | 文字 | [channels.ts:36](../../apps/api/src/routes/channels.ts#L36) |
| `channels.24bfba1a` | 写死 | 渠道 | 文字 | [channels.ts:337](../../apps/api/src/routes/channels.ts#L337)、342、377、384、392、403、410、417、426、437、448、454、462、471、477、484 行 |
| `channels.ef973595` | 写死 | 加价规则 | 文字 | [channels.ts:427](../../apps/api/src/routes/channels.ts#L427)、438 行 |
| `channels.50800908` | 写死 | API 客户端 | 文字 | [channels.ts:463](../../apps/api/src/routes/channels.ts#L463)、471 行 |
| `channels.aa9b65b0` | 写死 | 复核记录 | 文字 | [channels.ts:529](../../apps/api/src/routes/channels.ts#L529)、536、542 行 |

## 包车机场开始 / 机场结束套餐的机场绑定（charter-airports.ts）

文件：`apps/api/src/routes/charter-airports.ts`、`apps/api/src/services/charter-airports.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-airports.fcf67031` | 写死 | 商品 | 文字 | [charter-airports.ts:50](../../apps/api/src/routes/charter-airports.ts#L50)、55 行 |
| `charter-airports.befd9c84` | 写死 | 商品 | 错误提示 | [charter-airports.ts:81](../../apps/api/src/services/charter-airports.ts#L81)、96 行 |
| `charter-airports.b0cc2410` | 写死 | 只有迁移到三层区域的包车商品能设机场套餐 | 错误提示 | [charter-airports.ts:99](../../apps/api/src/services/charter-airports.ts#L99) |
| `charter-airports.369a19f2` | 写死 | 一个场景最多绑 {MAX\_AIRPORTS\_PER\_SCENARIO} 个机场 | 提示 | [charter-airports.ts:107](../../apps/api/src/services/charter-airports.ts#L107) |
| `charter-airports.4b5f6bcf` | 写死 | 同一场景里一个机场区域只能绑一个机场 | 提示 | [charter-airports.ts:110](../../apps/api/src/services/charter-airports.ts#L110) |
| `charter-airports.f0c92806` | 写死 | 同一场景里这个机场绑了两次 | 提示 | [charter-airports.ts:110](../../apps/api/src/services/charter-airports.ts#L110) |
| `charter-airports.4057235a` | 写死 | 中文简称 1–20 个字 | 提示 | [charter-airports.ts:113](../../apps/api/src/services/charter-airports.ts#L113) |
| `charter-airports.b4f2abd2` | 写死 | 区域 | 错误提示 | [charter-airports.ts:119](../../apps/api/src/services/charter-airports.ts#L119) |
| `charter-airports.86d0cee7` | 写死 | 这个区域已停用，不能新选 | 提示 | [charter-airports.ts:131](../../apps/api/src/services/charter-airports.ts#L131) |
| `charter-airports.29349db0` | 写死 | 请选择启用中的机场 | 提示 | [charter-airports.ts:134](../../apps/api/src/services/charter-airports.ts#L134) |
| `charter-airports.96d621b1` | 写死 | 机场或航站楼不在这个机场区域里：{…} | 提示 | [charter-airports.ts:144](../../apps/api/src/services/charter-airports.ts#L144) |
| `charter-airports.2f4e7ffd` | 写死 | 机场区域有约 {uncovered} 平方米不在本商品的服务区域或上下车加价区域里（在那里上下车报不出价） | 提示 | [charter-airports.ts:150](../../apps/api/src/services/charter-airports.ts#L150) |
| `charter-airports.38613842` | 写死 | 这个机场还有机场套餐价，先在价格页删掉再解绑 | 错误提示 | [charter-airports.ts:159](../../apps/api/src/services/charter-airports.ts#L159) |

## 派车和调度回传（dispatch.ts）

文件：`apps/api/src/routes/dispatch.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `dispatch.e4a5eaca` | 写死 | 订单 | 文字 | [dispatch.ts:56](../../apps/api/src/routes/dispatch.ts#L56)、67、81、87、93、98、104 行 |

## 司机 H5 的接口（driver.ts）

文件：`apps/api/src/routes/driver.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `driver.01efa8fd` | 写死 | 照片 | 文字 | [driver.ts:150](../../apps/api/src/routes/driver.ts#L150) |

## 嵌入组件（embed.ts）

文件：`apps/api/src/routes/embed.ts`、`apps/api/src/services/embed.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `embed.aa7a6d01` | 写死 | &lt;!doctype html&gt;&lt;html lang="zh"&gt;&lt;head&gt;&lt;meta charset="utf-8"&gt;&lt;title&gt;NOZOMI&lt;/title&gt;&lt;/head&gt;&lt;body&gt;&lt;p&gt;这个网站不能显示 NOZOMI 预订页。&lt;/p&gt;&lt;/body&gt;&lt;/html&gt; | 文字 | [embed.ts:59](../../apps/api/src/routes/embed.ts#L59) |
| `embed.47129d03` | 写死 | 嵌入码 | 文字 | [embed.ts:122](../../apps/api/src/routes/embed.ts#L122)、127 行 |
| `embed.e36f62cd` | 写死 | 此网站未获授权使用预订组件 | 错误提示 | [embed.ts:92](../../apps/api/src/services/embed.ts#L92) |
| `embed.0fee1704` | 写死 | 嵌入码不存在 | 错误提示 | [embed.ts:93](../../apps/api/src/services/embed.ts#L93) |
| `embed.5d17b2bc` | 写死 | 必填 | 提示 | [embed.ts:168](../../apps/api/src/services/embed.ts#L168) |
| `embed.55f558ff` | 写死 | 超出允许的范围 | 文字 | [embed.ts:169](../../apps/api/src/services/embed.ts#L169) |
| `embed.792a8f0d` | 写死 | 写法不对：网站地址要写成 https://域名（可带端口），不带路径；不支持通配符 | 提示 | [embed.ts:170](../../apps/api/src/services/embed.ts#L170) |
| `embed.a4de9b08` | 写死 | 重复了 | 文字 | [embed.ts:171](../../apps/api/src/services/embed.ts#L171) |
| `embed.3bd79ae2` | 写死 | 预订页地址最多 2,000 个字符 | 文字 | [embed.ts:174](../../apps/api/src/services/embed.ts#L174) |
| `embed.d8c6c3eb` | 写死 | 预订页地址写法不对：要写完整的 https 地址，如 https://example.com/booking/，不带用户名密码 | 提示 | [embed.ts:175](../../apps/api/src/services/embed.ts#L175) |
| `embed.5a98e790` | 写死 | 预订页地址的网站不在「允许的网站」里：要和其中一项的协议、域名、端口完全一样。改了允许的网站时，请一起改预订页地址或把它清空 | 文字 | [embed.ts:176](../../apps/api/src/services/embed.ts#L176) |
| `embed.d64dbbdf` | 写死 | 写得不对 | 文字 | [embed.ts:178](../../apps/api/src/services/embed.ts#L178) |
| `embed.84246e11` | 写死 | 这个嵌入码同时有效的预订草稿太多了，请稍后再试 | 错误提示 | [embed.ts:309](../../apps/api/src/services/embed.ts#L309) |
| `embed.c72647e8` | 写死 | 预订条件写得不对 | 提示 | [embed.ts:319](../../apps/api/src/services/embed.ts#L319) |

## 司机、车辆（fleet.ts）

文件：`apps/api/src/routes/fleet.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fleet.22e07df9` | 写死 | 日期写成 YYYY-MM-DD | 文字 | [fleet.ts:17](../../apps/api/src/routes/fleet.ts#L17) |
| `fleet.2825778d` | 写死 | 司机 | 文字 | [fleet.ts:134](../../apps/api/src/routes/fleet.ts#L134)、139、147 行 |
| `fleet.8a21d233` | 写死 | 车辆 | 文字 | [fleet.ts:168](../../apps/api/src/routes/fleet.ts#L168)、173、181 行 |

## 汇率中心的接口（fx.ts）

文件：`apps/api/src/routes/fx.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx.509e81e4` | 写死 | 不是合法的编号 | 文字 | [fx.ts:34](../../apps/api/src/routes/fx.ts#L34) |
| `fx.264df3fa` | 写死 | 锁定记录 | 文字 | [fx.ts:155](../../apps/api/src/routes/fx.ts#L155) |
| `fx.cacf257c` | 写死 | 这次拉取记录不存在 | 错误提示 | [fx.ts:192](../../apps/api/src/routes/fx.ts#L192) |

## 价格规则和库存的 Excel 导入导出接口（import-export.ts）

文件：`apps/api/src/routes/import-export.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `import-export.9b0e9fdd` | 写死 | 要给预览返回的文件指纹（64 位十六进制） | 文字 | [import-export.ts:32](../../apps/api/src/routes/import-export.ts#L32) |
| `import-export.fd38eceb` | 写死 | 请把 .xlsx 文件本身作为请求体上传，Content-Type 用 {XLSX\_CONTENT\_TYPE} | 错误提示 | [import-export.ts:38](../../apps/api/src/routes/import-export.ts#L38) |
| `import-export.d4470c17` | 写死 | 商品 | 文字 | [import-export.ts:115](../../apps/api/src/routes/import-export.ts#L115)、122、128、141、148、154 行 |

## 库存的接口（inventory.ts）

文件：`apps/api/src/routes/inventory.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `inventory.8312f16e` | 写死 | 商品 | 文字 | [inventory.ts:43](../../apps/api/src/routes/inventory.ts#L43)、50、58 行 |

## 人工报价申请和官网设置（manual-quotes.ts）

文件：`apps/api/src/routes/manual-quotes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `manual-quotes.6dbee368` | 写死 | 请填地点名称 | 文字 | [manual-quotes.ts:49](../../apps/api/src/routes/manual-quotes.ts#L49) |
| `manual-quotes.86c82a2d` | 写死 | 写成当地时间 YYYY-MM-DDTHH:mm | 文字 | [manual-quotes.ts:61](../../apps/api/src/routes/manual-quotes.ts#L61) |
| `manual-quotes.6e2b1339` | 写死 | 需要同意客服通过您留下的方式联系您 | 提示 | [manual-quotes.ts:86](../../apps/api/src/routes/manual-quotes.ts#L86) |
| `manual-quotes.743ec429` | 写死 | 接送机、点对点要有下车地点 | 提示 | [manual-quotes.ts:101](../../apps/api/src/routes/manual-quotes.ts#L101) |
| `manual-quotes.007a71fe` | 写死 | 只有包车有套餐时长（请删掉） | 文字 | [manual-quotes.ts:102](../../apps/api/src/routes/manual-quotes.ts#L102) |
| `manual-quotes.3007a9be` | 写死 | 包车要有套餐时长（或经停点） | 提示 | [manual-quotes.ts:102](../../apps/api/src/routes/manual-quotes.ts#L102) |
| `manual-quotes.f69e6bd3` | 写死 | 只有包车有经停点（请删掉） | 文字 | [manual-quotes.ts:103](../../apps/api/src/routes/manual-quotes.ts#L103) |
| `manual-quotes.453fd9db` | 写死 | 用车时间不是真实存在的日期和时刻 | 提示 | [manual-quotes.ts:104](../../apps/api/src/routes/manual-quotes.ts#L104) |
| `manual-quotes.ec718784` | 写死 | 请留下邮箱或 WhatsApp，至少一项 | 提示 | [manual-quotes.ts:113](../../apps/api/src/routes/manual-quotes.ts#L113) |
| `manual-quotes.f34c555a` | 写死 | 邮箱格式不对，例如 name@example.com | 提示 | [manual-quotes.ts:114](../../apps/api/src/routes/manual-quotes.ts#L114) |
| `manual-quotes.9854d55a` | 写死 | 请填写带国家码的号码，以 + 开头，例如 +81 90 1234 5678 | 提示 | [manual-quotes.ts:115](../../apps/api/src/routes/manual-quotes.ts#L115) |
| `manual-quotes.05800c91` | 写死 | 行程信息不对 | 提示 | [manual-quotes.ts:131](../../apps/api/src/routes/manual-quotes.ts#L131) |
| `manual-quotes.fc560f79` | 写死 | 只有带行程单编号时才有方案 | 提示 | [manual-quotes.ts:134](../../apps/api/src/routes/manual-quotes.ts#L134) |
| `manual-quotes.6e581d87` | 写死 | 只有带行程单编号时才有地点名称 | 提示 | [manual-quotes.ts:135](../../apps/api/src/routes/manual-quotes.ts#L135) |
| `manual-quotes.01690cc6` | 写死 | 带行程单编号时要带上每天每个点的名称 | 提示 | [manual-quotes.ts:137](../../apps/api/src/routes/manual-quotes.ts#L137) |
| `manual-quotes.769eb990` | 写死 | 至少改一项（状态或跟进人） | 提示 | [manual-quotes.ts:158](../../apps/api/src/routes/manual-quotes.ts#L158) |
| `manual-quotes.ec602a39` | 写死 | 请填写带国家码的号码，例如 +81 90 1234 5678（8–15 位数字，国家码不以 0 开头） | 提示 | [manual-quotes.ts:171](../../apps/api/src/routes/manual-quotes.ts#L171) |
| `manual-quotes.83b00e97` | 写死 | 谷歌地图密钥是 AIza 开头、共 39 位的一串字母数字，请从谷歌后台整串复制 | 提示 | [manual-quotes.ts:186](../../apps/api/src/routes/manual-quotes.ts#L186) |
| `manual-quotes.2e0fbcf6` | 写死 | 人工报价申请 | 文字 | [manual-quotes.ts:306](../../apps/api/src/routes/manual-quotes.ts#L306)、311、320 行 |

## 平台主数据的接口（master-data.ts）

文件：`apps/api/src/routes/master-data.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `master-data.3d88c341` | 写死 | 只支持这些语言：{…} | 说明 | [master-data.ts:70](../../apps/api/src/routes/master-data.ts#L70) |
| `master-data.83ee57aa` | 写死 | 不能只有空白或不可见字符 | 文字 | [master-data.ts:74](../../apps/api/src/routes/master-data.ts#L74) |
| `master-data.3b55045e` | 写死 | 至少填写一种语言的名称 | 文字 | [master-data.ts:86](../../apps/api/src/routes/master-data.ts#L86) |
| `master-data.eb334bb5` | 写死 | 只能是这些类型：{…}；多个用逗号分隔 | 文字 | [master-data.ts:201](../../apps/api/src/routes/master-data.ts#L201) |
| `master-data.3c3040ac` | 写死 | 必须是两位大写字母的国家码 | 文字 | [master-data.ts:208](../../apps/api/src/routes/master-data.ts#L208)、432 行 |

## 运营后台下拉框的主数据选项（master-options.ts）

文件：`apps/api/src/routes/master-options.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `master-options.cd5fed64` | 写死 | 只能是这些类型：{…}；多个用逗号分隔 | 文字 | [master-options.ts:41](../../apps/api/src/routes/master-options.ts#L41) |

## 通知中心（notifications.ts）

文件：`apps/api/src/routes/notifications.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `notifications.1794793c` | 写死 | 通知 | 文字 | [notifications.ts:53](../../apps/api/src/routes/notifications.ts#L53)、61 行 |

## 取消、改单、事后加收、取消政策的接口（order-actions.ts）

文件：`apps/api/src/routes/order-actions.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-actions.b41f9829` | 写死 | 已经过了确认期限，这次修改按没确认处理 | 错误提示 | [order-actions.ts:169](../../apps/api/src/routes/order-actions.ts#L169) |
| `order-actions.4496ed06` | 写死 | 订单 | 错误提示 | [order-actions.ts:176](../../apps/api/src/routes/order-actions.ts#L176)、184、192、200、210、230、240、248、256、294、303、313、324、340、352、362、371 行 |
| `order-actions.eaabf0b7` | 写死 | 加收 | 文字 | [order-actions.ts:211](../../apps/api/src/routes/order-actions.ts#L211)、249、354、364 行 |
| `order-actions.dc05be2c` | 写死 | 改单 | 文字 | [order-actions.ts:257](../../apps/api/src/routes/order-actions.ts#L257)、342 行 |
| `order-actions.7c0d13df` | 写死 | 待办 | 文字 | [order-actions.ts:274](../../apps/api/src/routes/order-actions.ts#L274) |
| `order-actions.f7af82f1` | 写死 | 没有改乘客邮箱，不用写核实方式（请删掉） | 提示 | [order-actions.ts:328](../../apps/api/src/routes/order-actions.ts#L328) |
| `order-actions.40fd40e8` | 写死 | 退款 | 文字 | [order-actions.ts:373](../../apps/api/src/routes/order-actions.ts#L373) |

## 订单中心的异常队列、工单、赔付表（order-center.ts）

文件：`apps/api/src/routes/order-center.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-center.8d514894` | 写死 | 内部备注和给客人的回复只能选一个 | 提示 | [order-center.ts:171](../../apps/api/src/routes/order-center.ts#L171) |
| `order-center.9a2fe697` | 写死 | 异常 | 文字 | [order-center.ts:413](../../apps/api/src/routes/order-center.ts#L413)、414、419、420、427、428 行 |
| `order-center.b8d4e0f2` | 写死 | 工单 | 文字 | [order-center.ts:544](../../apps/api/src/routes/order-center.ts#L544)、545、551、559、560、568、569、577、578、586、587、595、596、605、606、614、615、642、654 行 |
| `order-center.fe980ba0` | 写死 | 订单 | 文字 | [order-center.ts:666](../../apps/api/src/routes/order-center.ts#L666)、671 行 |

## 订单的只读接口（orders.ts）

文件：`apps/api/src/routes/orders.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `orders.b9135631` | 写死 | 日期写成 YYYY-MM-DD | 文字 | [orders.ts:41](../../apps/api/src/routes/orders.ts#L41) |
| `orders.9a96cfe8` | 写死 | 照片 | 文字 | [orders.ts:239](../../apps/api/src/routes/orders.ts#L239) |
| `orders.14c3794b` | 写死 | 订单 | 文字 | [orders.ts:263](../../apps/api/src/routes/orders.ts#L263)、286、292、329、336 行 |

## /platform/v1 查看供应商的商品（platform-products.ts）

文件：`apps/api/src/routes/platform-products.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-products.eb151968` | 写死 | 商品 | 文字 | [platform-products.ts:73](../../apps/api/src/routes/platform-products.ts#L73)、78、83 行 |

## 平台账号安全的接口（platform-security.ts）

文件：`apps/api/src/routes/platform-security.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-security.845c7e02` | 写死 | 动态码和恢复码只填一个 | 提示 | [platform-security.ts:31](../../apps/api/src/routes/platform-security.ts#L31) |
| `platform-security.4a5412f0` | 写死 | 请输入动态码或恢复码 | 提示 | [platform-security.ts:34](../../apps/api/src/routes/platform-security.ts#L34) |
| `platform-security.fcf35227` | 写死 | 至少改一项 | 文字 | [platform-security.ts:46](../../apps/api/src/routes/platform-security.ts#L46) |
| `platform-security.3daede26` | 写死 | 不是合法的角色 | 提示 | [platform-security.ts:77](../../apps/api/src/routes/platform-security.ts#L77) |
| `platform-security.b91b5190` | 写死 | 账号 | 文字 | [platform-security.ts:155](../../apps/api/src/routes/platform-security.ts#L155)、160、167 行 |

## 运营后台的区域共享库去重（platform-shared-areas.ts）

文件：`apps/api/src/routes/platform-shared-areas.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-shared-areas.0384824a` | 写死 | 共享区域 | 文字 | [platform-shared-areas.ts:61](../../apps/api/src/routes/platform-shared-areas.ts#L61)、68 行 |

## platform.ts

文件：`apps/api/src/routes/platform.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform.e109a484` | 写死 | 不是合法的角色 | 文字 | [platform.ts:65](../../apps/api/src/routes/platform.ts#L65) |
| `platform.f0a2de4c` | 写死 | 账号 | 文字 | [platform.ts:238](../../apps/api/src/routes/platform.ts#L238)、244、250 行 |
| `platform.3e945f48` | 写死 | 租户 | 文字 | [platform.ts:275](../../apps/api/src/routes/platform.ts#L275)、280、288 行 |

## 价格规则、调价规则、价格日历、缺价组合、价格概况、子品牌取整…（prices.ts）

文件：`apps/api/src/routes/prices.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `prices.aa45e9c3` | 写死 | 这种计价方式不填这一项 | 提示 | [prices.ts:143](../../apps/api/src/routes/prices.ts#L143) |
| `prices.98f39d31` | 写死 | 必填 | 提示 | [prices.ts:145](../../apps/api/src/routes/prices.ts#L145) |
| `prices.84d34278` | 写死 | 必须是十进制整数 | 文字 | [prices.ts:318](../../apps/api/src/routes/prices.ts#L318) |
| `prices.550785f4` | 写死 | 商品 | 文字 | [prices.ts:426](../../apps/api/src/routes/prices.ts#L426)、431、447、468、484、498、503、509、557、562、572、580、589、598、610、616、626、635、644 行 |
| `prices.14f77d38` | 写死 | 价格规则 | 文字 | [prices.ts:469](../../apps/api/src/routes/prices.ts#L469)、485 行 |
| `prices.4d055063` | 写死 | 调价规则 | 文字 | [prices.ts:581](../../apps/api/src/routes/prices.ts#L581)、590、599 行 |
| `prices.834cb80b` | 写死 | 计程价 | 文字 | [prices.ts:627](../../apps/api/src/routes/prices.ts#L627)、636、645 行 |
| `prices.63e81a65` | 写死 | 子品牌 | 文字 | [prices.ts:654](../../apps/api/src/routes/prices.ts#L654) |
| `prices.9e8d4849` | 写死 | 节假日 | 错误提示 | [prices.ts:681](../../apps/api/src/routes/prices.ts#L681) |

## /tenant/v1 的子品牌和商品接口（products.ts）

文件：`apps/api/src/routes/products.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `products.40c83d79` | 写死 | 只支持这些语言：{…} | 文字 | [products.ts:233](../../apps/api/src/routes/products.ts#L233) |
| `products.b1b5770d` | 写死 | 子品牌 | 文字 | [products.ts:323](../../apps/api/src/routes/products.ts#L323) |
| `products.a2db08d3` | 写死 | 商品 | 文字 | [products.ts:366](../../apps/api/src/routes/products.ts#L366)、371、388、394、399、407、413、422、427、433、438 行 |

## 报价试算的两个接口（quotes.ts）

文件：`apps/api/src/routes/quotes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `quotes.c27a2208` | 写死 | 路线预估暂时不可用，里程 + 时长的价格暂时无法报价，请稍后再试 | 文字 | [quotes.ts:46](../../apps/api/src/routes/quotes.ts#L46) |
| `quotes.dfd994f9` | 写死 | 这两个地点之间没有可行驶的路线 | 文字 | [quotes.ts:46](../../apps/api/src/routes/quotes.ts#L46) |
| `quotes.3762c3c5` | 写死 | 商品没有上架 | 文字 | [quotes.ts:90](../../apps/api/src/routes/quotes.ts#L90) |
| `quotes.cae3cdfc` | 写死 | 供应商已被平台暂停，商品不参与比价 | 文字 | [quotes.ts:91](../../apps/api/src/routes/quotes.ts#L91) |
| `quotes.0d8421f3` | 写死 | 供应商还没完成入驻（申请中、审核中或已签约）或已清退：只有试运营和正式的供应商参与比价 | 文字 | [quotes.ts:92](../../apps/api/src/routes/quotes.ts#L92) |
| `quotes.42ddc58b` | 写死 | 供应商在试运营，今天的订单已到每日上限 | 文字 | [quotes.ts:93](../../apps/api/src/routes/quotes.ts#L93) |
| `quotes.ada4f1c5` | 写死 | 商品的子品牌已停用 | 文字 | [quotes.ts:94](../../apps/api/src/routes/quotes.ts#L94) |
| `quotes.15d50b77` | 写死 | 服务规则还没填全（服务时间、提前预订时长） | 文字 | [quotes.ts:95](../../apps/api/src/routes/quotes.ts#L95) |
| `quotes.2ba76f65` | 写死 | 用车时间写得不对 | 提示 | [quotes.ts:96](../../apps/api/src/routes/quotes.ts#L96) |
| `quotes.9ff64068` | 写死 | 今天不在这个商品的下单有效期里 | 文字 | [quotes.ts:97](../../apps/api/src/routes/quotes.ts#L97) |
| `quotes.592a97c6` | 写死 | 用车时间不在这个商品每天的服务时间里 | 文字 | [quotes.ts:98](../../apps/api/src/routes/quotes.ts#L98) |
| `quotes.865e2be8` | 写死 | 用车时间已经过去了 | 文字 | [quotes.ts:99](../../apps/api/src/routes/quotes.ts#L99) |
| `quotes.08dc6f63` | 写死 | 离用车的时间不够提前预订时长，而且没开加急（或没有够用的一档） | 说明 | [quotes.ts:100](../../apps/api/src/routes/quotes.ts#L100) |
| `quotes.d050a908` | 写死 | 这一天的加急库存用完了 | 文字 | [quotes.ts:101](../../apps/api/src/routes/quotes.ts#L101) |
| `quotes.4a94b7e5` | 写死 | 地址不在这个供应商的运营区域里，或不在这个商品任何一个区域的营运区里（包车：上车点、下车点都要在商品的区域或某个加价区域里） | 文字 | [quotes.ts:102](../../apps/api/src/routes/quotes.ts#L102) |
| `quotes.7e70623e` | 写死 | 地址在禁行区里 | 文字 | [quotes.ts:103](../../apps/api/src/routes/quotes.ts#L103) |
| `quotes.48a8e46e` | 写死 | 这个地点在运营区域里，但商品没有勾选覆盖它的报价区域 | 文字 | [quotes.ts:104](../../apps/api/src/routes/quotes.ts#L104) |
| `quotes.def6d276` | 写死 | 这个包车商品设了区域加价，要给下车地点才能报价 | 提示 | [quotes.ts:105](../../apps/api/src/routes/quotes.ts#L105) |
| `quotes.99fc3701` | 写死 | 有经停点不在这个商品的任何区域里（不在商品的区域、也不在任何加价区域，或不在这个供应商的运营区域里），转人工报价 | 文字 | [quotes.ts:106](../../apps/api/src/routes/quotes.ts#L106) |
| `quotes.632fa4ce` | 写死 | 要的附加服务这个商品不提供 | 文字 | [quotes.ts:107](../../apps/api/src/routes/quotes.ts#L107) |
| `quotes.dc786791` | 写死 | 要的司机语言这个商品不提供 | 文字 | [quotes.ts:108](../../apps/api/src/routes/quotes.ts#L108) |
| `quotes.596550c7` | 写死 | 这一天的库存不足 | 文字 | [quotes.ts:109](../../apps/api/src/routes/quotes.ts#L109) |
| `quotes.d5beead3` | 写死 | 这个商品没有选这个车型组 | 文字 | [quotes.ts:110](../../apps/api/src/routes/quotes.ts#L110) |
| `quotes.f746d532` | 写死 | 这个车型组已被平台停用 | 文字 | [quotes.ts:111](../../apps/api/src/routes/quotes.ts#L111) |
| `quotes.cdb3b2cf` | 写死 | 人数或行李数超过了这个车型组的组合 | 文字 | [quotes.ts:112](../../apps/api/src/routes/quotes.ts#L112) |
| `quotes.5983ae29` | 写死 | 这个区域、车型组、方向或套餐没有价格（包车：或者上车点、下车点、经停点所在的加价区域没有这个车型组、套餐的加价 / 途经加价） | 文字 | [quotes.ts:113](../../apps/api/src/routes/quotes.ts#L113) |
| `quotes.ad1c56b5` | 写死 | 有价格，但用车日期不在它的生效期里 | 文字 | [quotes.ts:114](../../apps/api/src/routes/quotes.ts#L114) |
| `quotes.7e8ee50e` | 写死 | 对得上的那条价格停用了 | 文字 | [quotes.ts:115](../../apps/api/src/routes/quotes.ts#L115) |
| `quotes.d4b2188e` | 写死 | 价格是「里程 + 时长」或设了含公里数的一口价，需要路线预估，而现在取不到（按计程价、区域外里程费报价时也一样） | 文字 | [quotes.ts:116](../../apps/api/src/routes/quotes.ts#L116) |
| `quotes.91f30a47` | 写死 | 调价、取整之后价格不大于 0 | 文字 | [quotes.ts:117](../../apps/api/src/routes/quotes.ts#L117) |
| `quotes.a810425b` | 写死 | 价格超过了结算价的上限 | 文字 | [quotes.ts:118](../../apps/api/src/routes/quotes.ts#L118) |
| `quotes.6dfa0198` | 写死 | 选的套餐比这个商品设的最低套餐短 | 文字 | [quotes.ts:119](../../apps/api/src/routes/quotes.ts#L119) |
| `quotes.03913690` | 写死 | 选的套餐比这个商品按行程算出的预计用时（含经停点默认占用和整单缓冲）短，又不是最长那一档 | 文字 | [quotes.ts:120](../../apps/api/src/routes/quotes.ts#L120) |
| `quotes.3b3337b8` | 写死 | 预计用时超过了这个商品的在线下单上限（默认 13 小时），转客服 | 文字 | [quotes.ts:121](../../apps/api/src/routes/quotes.ts#L121) |
| `quotes.4fd3a1a1` | 写死 | 商品的结算币种和客人支付的币种不同，而现在没有可用的汇率（没有，或超过 48 小时没更新） | 文字 | [quotes.ts:122](../../apps/api/src/routes/quotes.ts#L122) |
| `quotes.62d02341` | 写死 | 对外价超过了上限 | 文字 | [quotes.ts:123](../../apps/api/src/routes/quotes.ts#L123) |
| `quotes.cf923aba` | 写死 | 渠道 | 错误提示 | [quotes.ts:194](../../apps/api/src/routes/quotes.ts#L194) |
| `quotes.26bc1cb0` | 写死 | 商品 | 文字 | [quotes.ts:256](../../apps/api/src/routes/quotes.ts#L256) |

## 平台的只读核对报告（reports.ts）

文件：`apps/api/src/routes/reports.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `reports.314df444` | 写死 | 必须是十进制整数 | 文字 | [reports.ts:20](../../apps/api/src/routes/reports.ts#L20) |
| `reports.e0ec8aff` | 写死 | 不能晚于现在 | 提示 | [reports.ts:36](../../apps/api/src/routes/reports.ts#L36) |

## 救援改派与违约金的接口（rescues.ts）

文件：`apps/api/src/routes/rescues.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `rescues.0673f8a5` | 写死 | 这次救援已经拒绝了 | 文字 | [rescues.ts:61](../../apps/api/src/routes/rescues.ts#L61) |
| `rescues.4301abac` | 写死 | 这次救援的救援单超时没接 | 文字 | [rescues.ts:62](../../apps/api/src/routes/rescues.ts#L62) |
| `rescues.fde7d2fd` | 写死 | 救援单正在等它接 | 文字 | [rescues.ts:63](../../apps/api/src/routes/rescues.ts#L63) |
| `rescues.376361de` | 写死 | 这次救援的救援单已收回 | 文字 | [rescues.ts:64](../../apps/api/src/routes/rescues.ts#L64) |
| `rescues.4ed05291` | 写死 | 这一单的渠道不卖这家供应商 | 文字 | [rescues.ts:65](../../apps/api/src/routes/rescues.ts#L65) |
| `rescues.f8581df9` | 写死 | 救援 | 错误提示 | [rescues.ts:245](../../apps/api/src/routes/rescues.ts#L245) |
| `rescues.bd3e384b` | 写死 | 订单 | 文字 | [rescues.ts:253](../../apps/api/src/routes/rescues.ts#L253)、316、325、348、359、368、390、393 行 |
| `rescues.6fc584c4` | 写死 | 救援单 | 文字 | [rescues.ts:268](../../apps/api/src/routes/rescues.ts#L268)、273、280 行 |
| `rescues.25cd1d7d` | 写死 | 已经过了接单期限，这张救援单记为超时，平台已顺延给下一家 | 错误提示 | [rescues.ts:274](../../apps/api/src/routes/rescues.ts#L274) |
| `rescues.c4fa41eb` | 写死 | 已经过了接单期限，这张救援单记为超时 | 错误提示 | [rescues.ts:283](../../apps/api/src/routes/rescues.ts#L283) |
| `rescues.86b1646e` | 写死 | 租户 | 文字 | [rescues.ts:380](../../apps/api/src/routes/rescues.ts#L380) |

## sales.ts

文件：`apps/api/src/routes/sales.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `sales.31b89471` | 写死 | 不是 quote\_id 的格式（QT + 日期 + 10 位） | 文字 | [sales.ts:61](../../apps/api/src/routes/sales.ts#L61) |
| `sales.07f22c92` | 写死 | 订单 | 文字 | [sales.ts:286](../../apps/api/src/routes/sales.ts#L286)、293 行 |
| `sales.a93c751e` | 写死 | 订单不存在 | 错误提示 | [sales.ts:287](../../apps/api/src/routes/sales.ts#L287) |
| `sales.b53679a0` | 写死 | 报价不存在 | 错误提示 | [sales.ts:300](../../apps/api/src/routes/sales.ts#L300) |

## 官网的行程报价接口（site-trips.ts）

文件：`apps/api/src/routes/site-trips.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `site-trips.713a8655` | 写死 | 写成 HH:MM | 文字 | [site-trips.ts:33](../../apps/api/src/routes/site-trips.ts#L33) |
| `site-trips.20f52e72` | 写死 | 写成 YYYY-MM-DD | 文字 | [site-trips.ts:39](../../apps/api/src/routes/site-trips.ts#L39) |
| `site-trips.4dbe725d` | 写死 | 请写上行程 | 文字 | [site-trips.ts:140](../../apps/api/src/routes/site-trips.ts#L140) |
| `site-trips.2cabdb3b` | 写死 | 最多 {TRIP\_PARSE\_MAX\_CHARS} 个字 | 文字 | [site-trips.ts:141](../../apps/api/src/routes/site-trips.ts#L141) |

## site.ts

文件：`apps/api/src/routes/site.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `site.ac073318` | 写死 | 写成 HH:MM（00:00–23:59） | 文字 | [site.ts:130](../../apps/api/src/routes/site.ts#L130) |
| `site.c96c14b0` | 写死 | 指定到达时间写成当天或次日（day\_offset 0 / 1）加 HH:MM | 文字 | [site.ts:135](../../apps/api/src/routes/site.ts#L135) |
| `site.cb8c87d5` | 写死 | 指定到达时间要晚于用车开始时间 | 文字 | [site.ts:136](../../apps/api/src/routes/site.ts#L136) |
| `site.8593f39b` | 写死 | 指定到达时间不能晚于用车开始后 24 小时 | 文字 | [site.ts:137](../../apps/api/src/routes/site.ts#L137) |
| `site.dd2d829f` | 写死 | 最多 {maxWaypoints} 个经停点，更多请联系客服定制 | 文字 | [site.ts:180](../../apps/api/src/routes/site.ts#L180) |
| `site.143fafa6` | 写死 | 写成当地时间 YYYY-MM-DDTHH:mm | 文字 | [site.ts:185](../../apps/api/src/routes/site.ts#L185)、257 行 |
| `site.02896238` | 写死 | 地址那一端的坐标 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.1afb6bd9` | 写死 | 下车点的坐标 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.1b4f2cbf` | 写死 | 机场 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.72df1948` | 写死 | 包车套餐时长 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.93a4ef3b` | 写死 | 接机还是送机 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.af0fcbc7` | 写死 | 上车点的坐标 | 文字 | [site.ts:204](../../apps/api/src/routes/site.ts#L204) |
| `site.60cb853d` | 写死 | 包车 | 文字 | [site.ts:205](../../apps/api/src/routes/site.ts#L205) |
| `site.941cf7f0` | 写死 | 接送机 | 文字 | [site.ts:205](../../apps/api/src/routes/site.ts#L205) |
| `site.acd4ea58` | 写死 | 点对点 | 文字 | [site.ts:205](../../apps/api/src/routes/site.ts#L205) |
| `site.41635483` | 写死 | 只有包车可以按行程计价 | 提示 | [site.ts:210](../../apps/api/src/routes/site.ts#L210) |
| `site.09411e4c` | 写死 | {…}要填{…} | 提示 | [site.ts:218](../../apps/api/src/routes/site.ts#L218) |
| `site.fb64edb0` | 写死 | {…}不用填{…}（请删掉） | 提示 | [site.ts:219](../../apps/api/src/routes/site.ts#L219) |
| `site.cc2d5838` | 写死 | {…}不用填经停点（只有包车可以填，请删掉） | 提示 | [site.ts:222](../../apps/api/src/routes/site.ts#L222) |
| `site.97ffd0df` | 写死 | 会话令牌是 16–36 个字母、数字、下划线或连字符（推荐用 UUID） | 文字 | [site.ts:239](../../apps/api/src/routes/site.ts#L239) |
| `site.fb60d004` | 写死 | 不是谷歌地点 ID 的格式 | 文字 | [site.ts:242](../../apps/api/src/routes/site.ts#L242) |
| `site.6a3698ae` | 写死 | 请填地址 | 文字 | [site.ts:247](../../apps/api/src/routes/site.ts#L247) |
| `site.74c57df0` | 写死 | 每个点写成「纬度,经度」 | 文字 | [site.ts:286](../../apps/api/src/routes/site.ts#L286) |
| `site.54c03971` | 写死 | 坐标超出范围 | 文字 | [site.ts:291](../../apps/api/src/routes/site.ts#L291) |
| `site.a518bb26` | 写死 | 路线图服务没有开通，请用页面上的地图 | 文字 | [site.ts:312](../../apps/api/src/routes/site.ts#L312) |
| `site.e1ee6a17` | 写死 | 路线图暂时出不了，请稍后再试 | 文字 | [site.ts:313](../../apps/api/src/routes/site.ts#L313) |
| `site.0fa0561a` | 写死 | 经停标识只能是 1–40 个字母、数字、- 或 \_ | 文字 | [site.ts:328](../../apps/api/src/routes/site.ts#L328) |
| `site.2a814408` | 写死 | 报价编号格式不对 | 文字 | [site.ts:329](../../apps/api/src/routes/site.ts#L329) |
| `site.6f4c597f` | 写死 | 会话标识是 8–64 个字母、数字、- 或 \_ | 文字 | [site.ts:331](../../apps/api/src/routes/site.ts#L331) |
| `site.16f7968b` | 写死 | 关键字太长了，最多 100 个字 | 提示 | [site.ts:342](../../apps/api/src/routes/site.ts#L342) |
| `site.3df3a9db` | 写死 | 请至少输入 2 个字（字母、数字、汉字或假名），如酒店名、地址 | 提示 | [site.ts:342](../../apps/api/src/routes/site.ts#L342) |
| `site.38d6c94e` | 写死 | 不是报价编号的格式 | 文字 | [site.ts:362](../../apps/api/src/routes/site.ts#L362) |
| `site.0671dc46` | 写死 | 订单号是 NZ 开头的 18 位，如 NZ20261026AB12CD34 | 文字 | [site.ts:385](../../apps/api/src/routes/site.ts#L385) |
| `site.63e91981` | 写死 | 请填写下单时的邮箱 | 提示 | [site.ts:388](../../apps/api/src/routes/site.ts#L388) |
| `site.578a1937` | 写死 | 写成 纬度,经度，如 35.6812,139.7671 | 文字 | [site.ts:445](../../apps/api/src/routes/site.ts#L445) |
| `site.30637564` | 写死 | 纬度在 -90 到 90、经度在 -180 到 180 之间 | 文字 | [site.ts:450](../../apps/api/src/routes/site.ts#L450) |
| `site.21f3f33d` | 写死 | 接口不存在 | 文字 | [site.ts:495](../../apps/api/src/routes/site.ts#L495) |
| `site.1fdb30e7` | 写死 | 订单 | 错误提示 | [site.ts:553](../../apps/api/src/routes/site.ts#L553) |
| `site.02341d59` | 写死 | 城市 | 文字 | [site.ts:598](../../apps/api/src/routes/site.ts#L598)、604、664 行 |
| `site.733457b5` | 写死 | 地点编码只能是 1 到 32 位字母、数字和连字符 | 提示 | [site.ts:673](../../apps/api/src/routes/site.ts#L673) |
| `site.3a266ac3` | 写死 | 请给出经度 | 提示 | [site.ts:717](../../apps/api/src/routes/site.ts#L717) |
| `site.7fe8ec3c` | 写死 | 请给出纬度 | 提示 | [site.ts:717](../../apps/api/src/routes/site.ts#L717) |
| `site.aa5b5edd` | 写死 | 请给出 {name} | 提示 | [site.ts:738](../../apps/api/src/routes/site.ts#L738)、765 行 |
| `site.bc3a3615` | 写死 | 请给出 p | 提示 | [site.ts:784](../../apps/api/src/routes/site.ts#L784) |
| `site.85f7ee30` | 写死 | 请先询价，再申请建议顺序 | 错误提示 | [site.ts:799](../../apps/api/src/routes/site.ts#L799) |
| `site.6ca5e32d` | 写死 | 只有按行程计价、带经停点的包车询价能申请建议顺序，refs 个数要和经停点一样 | 提示 | [site.ts:802](../../apps/api/src/routes/site.ts#L802) |
| `site.d06e827a` | 写死 | 只有按行程计价的包车能申请建议顺序 | 提示 | [site.ts:805](../../apps/api/src/routes/site.ts#L805) |
| `site.cc955b57` | 写死 | 必填 | 提示 | [site.ts:846](../../apps/api/src/routes/site.ts#L846) |
| `site.015d49ae` | 写死 | 加收 | 文字 | [site.ts:972](../../apps/api/src/routes/site.ts#L972) |

## 供应商入驻的接口（tenant-onboarding.ts）

文件：`apps/api/src/routes/tenant-onboarding.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-onboarding.f7147a35` | 写死 | 两位国家代码，如 JP | 文字 | [tenant-onboarding.ts:76](../../apps/api/src/routes/tenant-onboarding.ts#L76) |
| `tenant-onboarding.2bd9c1bd` | 写死 | 文件 | 文字 | [tenant-onboarding.ts:322](../../apps/api/src/routes/tenant-onboarding.ts#L322)、390 行 |
| `tenant-onboarding.228cee57` | 写死 | 供应商 | 错误提示 | [tenant-onboarding.ts:361](../../apps/api/src/routes/tenant-onboarding.ts#L361)、369、375、380、384、390、395、413、426、434、441、448、455、462 行 |
| `tenant-onboarding.f9eebe89` | 写死 | 资质 | 文字 | [tenant-onboarding.ts:414](../../apps/api/src/routes/tenant-onboarding.ts#L414) |

## 供应商名称和企业信息的维护（tenant-profile.ts）

文件：`apps/api/src/routes/tenant-profile.ts`、`apps/api/src/services/tenant-profile.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-profile.d8efc94a` | 写死 | 修改申请 | 文字 | [tenant-profile.ts:68](../../apps/api/src/routes/tenant-profile.ts#L68)、142 行 |
| `tenant-profile.f5596915` | 写死 | 供应商 | 文字 | [tenant-profile.ts:79](../../apps/api/src/routes/tenant-profile.ts#L79)、87、96、101、110 行 |
| `tenant-profile.3cd23f51` | 写死 | 至少要改一项：对外显示名称、法定名称、登记号 | 提示 | [tenant-profile.ts:40](../../apps/api/src/services/tenant-profile.ts#L40) |
| `tenant-profile.1f349822` | 写死 | 不能为空 | 空状态 | [tenant-profile.ts:41](../../apps/api/src/services/tenant-profile.ts#L41) |
| `tenant-profile.1b4e8a17` | 写死 | 太长了 | 文字 | [tenant-profile.ts:42](../../apps/api/src/services/tenant-profile.ts#L42) |
| `tenant-profile.bfdb95ad` | 写死 | 和现在的一样，不用申请 | 文字 | [tenant-profile.ts:43](../../apps/api/src/services/tenant-profile.ts#L43) |
| `tenant-profile.bf6358cd` | 写死 | 供应商 | 错误提示 | [tenant-profile.ts:48](../../apps/api/src/services/tenant-profile.ts#L48)、148 行 |
| `tenant-profile.838a33bc` | 写死 | 已经有一条等平台处理的修改申请，先撤回它再提交 | 错误提示 | [tenant-profile.ts:94](../../apps/api/src/services/tenant-profile.ts#L94) |
| `tenant-profile.0adb80dd` | 写死 | 修改申请 | 错误提示 | [tenant-profile.ts:134](../../apps/api/src/services/tenant-profile.ts#L134)、168、189 行 |
| `tenant-profile.152a8e26` | 写死 | 只有等处理的申请能撤回 | 错误提示 | [tenant-profile.ts:135](../../apps/api/src/services/tenant-profile.ts#L135) |
| `tenant-profile.27ac6e61` | 写死 | 这条申请已经有一条待审核的复核：先在「待审核」里批准、驳回或撤回那条复核 | 错误提示 | [tenant-profile.ts:156](../../apps/api/src/services/tenant-profile.ts#L156) |
| `tenant-profile.d8755c76` | 写死 | （空） | 文字 | [tenant-profile.ts:160](../../apps/api/src/services/tenant-profile.ts#L160) |
| `tenant-profile.4971748c` | 写死 | 只有等处理的申请能发起复核 | 错误提示 | [tenant-profile.ts:169](../../apps/api/src/services/tenant-profile.ts#L169) |
| `tenant-profile.e53ea061` | 写死 | 供应商「{name}」申请修改：{…} | 说明 | [tenant-profile.ts:175](../../apps/api/src/services/tenant-profile.ts#L175) |
| `tenant-profile.333f94ef` | 写死 | 只有等处理的申请能驳回 | 错误提示 | [tenant-profile.ts:190](../../apps/api/src/services/tenant-profile.ts#L190) |

## 推送给供应商的 Webhook（tenant-webhooks.ts）

文件：`apps/api/src/routes/tenant-webhooks.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-webhooks.663d5707` | 写死 | 投递记录 | 文字 | [tenant-webhooks.ts:141](../../apps/api/src/routes/tenant-webhooks.ts#L141)、147、161、168 行 |

## tenant.ts

文件：`apps/api/src/routes/tenant.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant.98026f4b` | 写死 | 账号 | 文字 | [tenant.ts:168](../../apps/api/src/routes/tenant.ts#L168)、175、182 行 |

## 跨段规则配置（trip-rules.ts）

文件：`apps/api/src/routes/trip-rules.ts`、`apps/api/src/services/trip-rules.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `trip-rules.6b5b8719` | 写死 | 商品 | 文字 | [trip-rules.ts:34](../../apps/api/src/routes/trip-rules.ts#L34)、39、47 行 |
| `trip-rules.a1ab5c4a` | 写死 | 子品牌 | 错误提示 | [trip-rules.ts:47](../../apps/api/src/services/trip-rules.ts#L47) |
| `trip-rules.41832b21` | 写死 | 商品 | 错误提示 | [trip-rules.ts:55](../../apps/api/src/services/trip-rules.ts#L55)、66、89 行 |
| `trip-rules.2705555f` | 写死 | 只有包车商品能设跨段规则 | 错误提示 | [trip-rules.ts:91](../../apps/api/src/services/trip-rules.ts#L91) |
| `trip-rules.f83e234c` | 写死 | 不认识的设置项 | 提示 | [trip-rules.ts:122](../../apps/api/src/services/trip-rules.ts#L122) |
| `trip-rules.4aeafdf2` | 写死 | 超出允许的范围 | 提示 | [trip-rules.ts:124](../../apps/api/src/services/trip-rules.ts#L124) |
| `trip-rules.fc8f6968` | 写死 | 重复了 | 提示 | [trip-rules.ts:126](../../apps/api/src/services/trip-rules.ts#L126) |
| `trip-rules.51673280` | 写死 | 只能选本商品的服务区域或上下车加价区域 | 提示 | [trip-rules.ts:128](../../apps/api/src/services/trip-rules.ts#L128) |
| `trip-rules.7431bc29` | 写死 | 只能选平台启用中的城市 | 提示 | [trip-rules.ts:130](../../apps/api/src/services/trip-rules.ts#L130) |
| `trip-rules.458f4ae6` | 写死 | 上限不能低于常规值，绝对最短休息不能长于常规休息 | 提示 | [trip-rules.ts:132](../../apps/api/src/services/trip-rules.ts#L132) |
| `trip-rules.2fd0702a` | 写死 | 格式不对 | 提示 | [trip-rules.ts:134](../../apps/api/src/services/trip-rules.ts#L134) |

## 运营后台「未覆盖需求」（uncovered-demands.ts）

文件：`apps/api/src/routes/uncovered-demands.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `uncovered-demands.a3c02c4f` | 写死 | 不是真实存在的日期 | 文字 | [uncovered-demands.ts:22](../../apps/api/src/routes/uncovered-demands.ts#L22) |
| `uncovered-demands.c9c8546d` | 写死 | 日期写成 YYYY-MM-DD | 文字 | [uncovered-demands.ts:22](../../apps/api/src/routes/uncovered-demands.ts#L22) |
| `uncovered-demands.57bd4482` | 写死 | 开始日期不能晚于结束日期，范围最长 {MAX\_RANGE\_DAYS} 天 | 提示 | [uncovered-demands.ts:39](../../apps/api/src/routes/uncovered-demands.ts#L39) |

## 运营后台（view-link.ts）

文件：`apps/api/src/routes/view-link.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `view-link.776a0e5f` | 写死 | 订单 | 文字 | [view-link.ts:44](../../apps/api/src/routes/view-link.ts#L44)、58 行 |
| `view-link.64cee352` | 写死 | 请填写核实后的新邮箱 | 提示 | [view-link.ts:60](../../apps/api/src/routes/view-link.ts#L60) |
| `view-link.6dbc58ee` | 写死 | 发到下单邮箱不用填新邮箱（请删掉） | 提示 | [view-link.ts:61](../../apps/api/src/routes/view-link.ts#L61) |

## 机场导入（airport-import.ts）

文件：`apps/api/src/services/airport-import.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `airport-import.2c7beea6` | 写死 | 导入期间有人在后台新增了三字码相同的机场。数据库没有任何变化，请再运行一次 | 错误提示 | [airport-import.ts:57](../../apps/api/src/services/airport-import.ts#L57) |
| `airport-import.6b991568` | 写死 | 另一个机场导入正在运行。数据库没有任何变化，请等它结束后再试 | 错误提示 | [airport-import.ts:67](../../apps/api/src/services/airport-import.ts#L67) |
| `airport-import.42e5aa7e` | 写死 | 导入期间平台在后台改了这个机场，没有覆盖；需要的话请再运行一次导入 | 提示 | [airport-import.ts:146](../../apps/api/src/services/airport-import.ts#L146) |

## 机场的中文名、日文名从 GeoNames 导入（airport-name-import.ts）

文件：`apps/api/src/services/airport-name-import.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `airport-name-import.99555f44` | 写死 | 另一个机场名称导入正在运行。数据库没有任何变化，请等它结束后再试 | 错误提示 | [airport-name-import.ts:34](../../apps/api/src/services/airport-name-import.ts#L34) |
| `airport-name-import.328ee688` | 写死 | 导入期间平台在后台改了这个机场，没有填；需要的话请再运行一次导入 | 提示 | [airport-name-import.ts:53](../../apps/api/src/services/airport-name-import.ts#L53) |

## 敏感操作双人复核的通用机制（approvals.ts）

文件：`apps/api/src/services/approvals.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `approvals.3d48bf25` | 写死 | 这条复核已经有结论了（批准、驳回或撤回），不能再改 | 文字 | [approvals.ts:55](../../apps/api/src/services/approvals.ts#L55) |
| `approvals.f577409f` | 写死 | 发起人不能审核自己发起的改动，请让另一位有审核权限的同事处理 | 文字 | [approvals.ts:56](../../apps/api/src/services/approvals.ts#L56) |
| `approvals.fc073844` | 写死 | 只有发起人自己能撤回 | 文字 | [approvals.ts:57](../../apps/api/src/services/approvals.ts#L57) |
| `approvals.8bc3da15` | 写死 | 复核记录 | 错误提示 | [approvals.ts:138](../../apps/api/src/services/approvals.ts#L138)、153 行 |
| `approvals.d904503b` | 写死 | 发起这条复核之后，要改的对象已经被别的改动改过了；请驳回，再按现在的内容重新发起 | 错误提示 | [approvals.ts:170](../../apps/api/src/services/approvals.ts#L170) |

## 区域重叠清理（area-cleanup.ts）

文件：`apps/api/src/services/area-cleanup.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-cleanup.0d756119` | 写死 | 已执行 | 文字 | [area-cleanup.ts:252](../../apps/api/src/services/area-cleanup.ts#L252) |
| `area-cleanup.0f45526e` | 写死 | 试跑，没有写库 | 文字 | [area-cleanup.ts:252](../../apps/api/src/services/area-cleanup.ts#L252) |
| `area-cleanup.92a4c5ec` | 写死 | 区域重叠清理（{…}）：启用区域 {areas} 个 | 文字 | [area-cleanup.ts:252](../../apps/api/src/services/area-cleanup.ts#L252) |
| `area-cleanup.fb9ee75f` | 写死 | 标平台共享 {markedShared} 个 | 文字 | [area-cleanup.ts:253](../../apps/api/src/services/area-cleanup.ts#L253) |
| `area-cleanup.49703d5c` | 写死 | 完全重复 {duplicateGroups} 组、停用其中没人用的 {disabled} 个 | 文字 | [area-cleanup.ts:254](../../apps/api/src/services/area-cleanup.ts#L254) |
| `area-cleanup.385c28a5` | 写死 | 包车三层重叠 清理前 {overlapsBefore} 处 → 切掉 {subtracted} 对、没解决 {unresolved} 对 → 清理后 {overlapsAfter} 处 | 文字 | [area-cleanup.ts:255](../../apps/api/src/services/area-cleanup.ts#L255) |
| `area-cleanup.5a2db7c9` | 写死 | 批次 {runId} | 文字 | [area-cleanup.ts:256](../../apps/api/src/services/area-cleanup.ts#L256) |

## 只读核对的接口版（area-role-preview-report.ts）

文件：`apps/api/src/services/area-role-preview-report.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-role-preview-report.29c77517` | 写死 | 回放超过 {seconds} 秒还没算完，没有结果；请把天数改小再试 | 错误提示 | [area-role-preview-report.ts:31](../../apps/api/src/services/area-role-preview-report.ts#L31) |

## 切换前的只读清单（area-role-preview.ts）

文件：`apps/api/src/services/area-role-preview.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-role-preview.74318878` | 写死 | 回放超过了时限 | 文字 | [area-role-preview.ts:212](../../apps/api/src/services/area-role-preview.ts#L212) |
| `area-role-preview.56fef20f` | 写死 | 迁移 0290（区域用途）：{…} | 文字 | [area-role-preview.ts:359](../../apps/api/src/services/area-role-preview.ts#L359) |
| `area-role-preview.58fcd9d3` | 写死 | 还没执行，按迁移后的样子算（每个区域都是运营 + 报价） | 文字 | [area-role-preview.ts:359](../../apps/api/src/services/area-role-preview.ts#L359) |
| `area-role-preview.f9759dba` | 写死 | 已执行，按现在的用途算 | 文字 | [area-role-preview.ts:359](../../apps/api/src/services/area-role-preview.ts#L359) |
| `area-role-preview.6ccdcbd8` | 写死 | 区域合计 {totalAreas} 个，供应商 {length} 家： | 文字 | [area-role-preview.ts:360](../../apps/api/src/services/area-role-preview.ts#L360) |
| `area-role-preview.c55d9b6f` | 写死 | - {tenantName}：{total} 个（业务类型：{…}；状态：{…}；用途：{…}） | 文字 | [area-role-preview.ts:361](../../apps/api/src/services/area-role-preview.ts#L361) |
| `area-role-preview.1ba1fb69` | 写死 | 已上架商品 {length} 个，勾选的报价区域{…}： | 文字 | [area-role-preview.ts:362](../../apps/api/src/services/area-role-preview.ts#L362) |
| `area-role-preview.6b980071` | 写死 | （迁移后全部是运营 + 报价） | 文字 | [area-role-preview.ts:362](../../apps/api/src/services/area-role-preview.ts#L362) |
| `area-role-preview.402fcdeb` | 写死 | 商品区域：{…} | 文字 | [area-role-preview.ts:364](../../apps/api/src/services/area-role-preview.ts#L364) |
| `area-role-preview.dd36de5b` | 写死 | 无 | 文字 | [area-role-preview.ts:364](../../apps/api/src/services/area-role-preview.ts#L364) |
| `area-role-preview.b51c4e8f` | 写死 | 加价区域：{…} | 文字 | [area-role-preview.ts:365](../../apps/api/src/services/area-role-preview.ts#L365) |
| `area-role-preview.a6fff74e` | 写死 | 线路价两端：{…} | 文字 | [area-role-preview.ts:366](../../apps/api/src/services/area-role-preview.ts#L366) |
| `area-role-preview.ec4da00b` | 写死 | 回放最近 {days} 天（{since} 起）的询价日志 {logs} 条：回放 {replayed} 条、认不出跳过 {skipped} 条，算了 {evaluations} 次（候选商品 × 询价） | 文字 | [area-role-preview.ts:370](../../apps/api/src/services/area-role-preview.ts#L370) |
| `area-role-preview.2959ac3d` | 写死 | 对外结果不同：{externalDiffCount} 处{…} | 文字 | [area-role-preview.ts:371](../../apps/api/src/services/area-role-preview.ts#L371) |
| `area-role-preview.986f644b` | 写死 | （有不同，不能上线） | 文字 | [area-role-preview.ts:371](../../apps/api/src/services/area-role-preview.ts#L371) |
| `area-role-preview.c5513428` | 写死 | （可以上线） | 文字 | [area-role-preview.ts:371](../../apps/api/src/services/area-role-preview.ts#L371)、376 行 |
| `area-role-preview.bf98c519` | 写死 |   - 询价 {logId} 商品 {productCode}：之前 {before}；之后 {after} | 文字 | [area-role-preview.ts:372](../../apps/api/src/services/area-role-preview.ts#L372)、377 行 |
| `area-role-preview.39cbf76b` | 写死 | {change} {n} 次 | 文字 | [area-role-preview.ts:374](../../apps/api/src/services/area-role-preview.ts#L374) |
| `area-role-preview.3ef2e9af` | 写死 | 没有 | 文字 | [area-role-preview.ts:374](../../apps/api/src/services/area-role-preview.ts#L374)、379 行 |
| `area-role-preview.83bba2b4` | 写死 | 只在内部原因上变细的：{…} | 文字 | [area-role-preview.ts:374](../../apps/api/src/services/area-role-preview.ts#L374) |
| `area-role-preview.9717b597` | 写死 | M8-30 报价优先级：之前报得出的 {keptOffers} 个价不变；有变化 {changedCount} 处{…} | 文字 | [area-role-preview.ts:376](../../apps/api/src/services/area-role-preview.ts#L376) |
| `area-role-preview.d67e5074` | 写死 | （有变化，不能上线） | 文字 | [area-role-preview.ts:376](../../apps/api/src/services/area-role-preview.ts#L376) |
| `area-role-preview.45f1c5fb` | 写死 | {basis} {n} 个 | 文字 | [area-role-preview.ts:379](../../apps/api/src/services/area-role-preview.ts#L379) |
| `area-role-preview.b33f7086` | 写死 | 之前报不出、现在新报出的价：{…} | 文字 | [area-role-preview.ts:379](../../apps/api/src/services/area-role-preview.ts#L379) |
| `area-role-preview.51be6801` | 写死 | 报价结果摘要值（现在的规则，截止 {until}，{resultLines} 行）：{resultDigest}；回放用到的数据的状态摘要：{stateDigest} | 文字 | [area-role-preview.ts:380](../../apps/api/src/services/area-role-preview.ts#L380) |

## 区域的业务流程（areas.ts）

文件：`apps/api/src/services/areas.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `areas.91073da6` | 写死 | 有 {publishedProductCount} 个已上架的商品在用这个区域，不能{action}。请先把这些商品下架，或在商品里去掉这个区域（包车：或停用、删除挂在这个区域上的区域加价） | 错误提示 | [areas.ts:126](../../apps/api/src/services/areas.ts#L126) |
| `areas.c749dcdb` | 写死 | 至少要有一块营运区 | 文字 | [areas.ts:139](../../apps/api/src/services/areas.ts#L139) |
| `areas.3b97306f` | 写死 | 一个区域最多 {maxPolygons} 块图形 | 文字 | [areas.ts:140](../../apps/api/src/services/areas.ts#L140) |
| `areas.8e7d34a4` | 写死 | 一个区域的全部图形加起来最多 {maxTotalVertices} 个点 | 文字 | [areas.ts:141](../../apps/api/src/services/areas.ts#L141) |
| `areas.d3660eb3` | 写死 | 有坐标不合法：纬度必须在 -90 到 90 之间，经度必须在 -180 到 180 之间 | 提示 | [areas.ts:142](../../apps/api/src/services/areas.ts#L142) |
| `areas.a6158a54` | 写死 | 至少要 {minRingVertices} 个点才能围成一个范围 | 文字 | [areas.ts:143](../../apps/api/src/services/areas.ts#L143) |
| `areas.851afb03` | 写死 | 一个多边形最多 {maxRingVertices} 个点 | 文字 | [areas.ts:144](../../apps/api/src/services/areas.ts#L144) |
| `areas.49192948` | 写死 | 相邻的两个点在同一个位置 | 文字 | [areas.ts:145](../../apps/api/src/services/areas.ts#L145) |
| `areas.d911319b` | 写死 | 不支持跨过 180° 经线的图形 | 文字 | [areas.ts:146](../../apps/api/src/services/areas.ts#L146) |
| `areas.ba006c6e` | 写死 | 这些点在一条直线上，围不成一个范围 | 文字 | [areas.ts:147](../../apps/api/src/services/areas.ts#L147) |
| `areas.67e4e49c` | 写死 | 有两条边交叉了 | 文字 | [areas.ts:148](../../apps/api/src/services/areas.ts#L148) |
| `areas.9702de84` | 写死 | 这块图形不在这个区域里（新加的图形不要带编号），或者同一个编号出现了两次 | 提示 | [areas.ts:180](../../apps/api/src/services/areas.ts#L180) |
| `areas.87e1af01` | 写死 | 半径要在 0.1 到 100 公里之间（100 到 100000 的整数米） | 提示 | [areas.ts:194](../../apps/api/src/services/areas.ts#L194) |
| `areas.5d4ab1c5` | 写死 | 带了圆心和半径的图形，来源只能是 circle | 提示 | [areas.ts:196](../../apps/api/src/services/areas.ts#L196) |
| `areas.a90c91d0` | 写死 | 必填：多边形要给 geometry，圆要给 circle | 提示 | [areas.ts:203](../../apps/api/src/services/areas.ts#L203) |
| `areas.f768a3c4` | 写死 | 来源是 circle 的图形必须给圆心和半径 | 提示 | [areas.ts:205](../../apps/api/src/services/areas.ts#L205) |
| `areas.3783c95d` | 写死 | 图形不能带洞，也不能是空的：要在营运区中间挖掉一块，请在那里画一块禁行区 | 提示 | [areas.ts:207](../../apps/api/src/services/areas.ts#L207) |
| `areas.113b28b1` | 写死 | 这样改之后，{size} 个已上架商品勾选的报价区域会有一部分不在任何运营区域里，那部分将报不出价。请先补上运营区域，或先把这些商品下架 | 错误提示 | [areas.ts:268](../../apps/api/src/services/areas.ts#L268) |
| `areas.e14e29b1` | 写死 | 区域 | 错误提示 | [areas.ts:340](../../apps/api/src/services/areas.ts#L340)、419、484、515、542 行 |
| `areas.e67cdcac` | 写死 | 城市不存在 | 提示 | [areas.ts:366](../../apps/api/src/services/areas.ts#L366) |
| `areas.6aaa26cc` | 写死 | 所属城市已被平台停用，不能在它下面新增区域 | 文字 | [areas.ts:368](../../apps/api/src/services/areas.ts#L368) |
| `areas.adad8175` | 写死 | 有 {productCount} 个商品勾选了这个区域（商品区域、区域加价或线路价），不能改成运营区域。请先在这些商品里去掉它 | 错误提示 | [areas.ts:440](../../apps/api/src/services/areas.ts#L440) |
| `areas.80c74740` | 写死 | 所属城市已被平台停用，不能启用这个区域 | 文字 | [areas.ts:488](../../apps/api/src/services/areas.ts#L488) |
| `areas.dc9a5479` | 写死 | 停用 | 文字 | [areas.ts:491](../../apps/api/src/services/areas.ts#L491) |
| `areas.d212f17f` | 写死 | 删除 | 文字 | [areas.ts:517](../../apps/api/src/services/areas.ts#L517) |
| `areas.4e8532b4` | 写死 | 这个区域是包车机场套餐的机场区域，先在商品的「机场套餐」里解绑再删 | 错误提示 | [areas.ts:520](../../apps/api/src/services/areas.ts#L520) |
| `areas.ba71ae00` | 写死 | 纬度必须在 -90 到 90 之间 | 提示 | [areas.ts:535](../../apps/api/src/services/areas.ts#L535) |
| `areas.72afd60e` | 写死 | 经度必须在 -180 到 180 之间 | 提示 | [areas.ts:536](../../apps/api/src/services/areas.ts#L536) |

## 银行转账文件的流程（bank-files.ts）

文件：`apps/api/src/services/bank-files.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `bank-files.b8d907cb` | 写死 | 付款批次 | 错误提示 | [bank-files.ts:127](../../apps/api/src/services/bank-files.ts#L127)、165 行 |
| `bank-files.6240191a` | 写死 | 先锁定批次，再生成转账文件 | 错误提示 | [bank-files.ts:166](../../apps/api/src/services/bank-files.ts#L166) |
| `bank-files.e67dead5` | 写死 | 这个批次已经付款完成 | 错误提示 | [bank-files.ts:166](../../apps/api/src/services/bank-files.ts#L166) |
| `bank-files.d349664d` | 写死 | 这个批次里没有 {currency} 的账单 | 错误提示 | [bank-files.ts:168](../../apps/api/src/services/bank-files.ts#L168) |
| `bank-files.d58e6bb5` | 写死 | 这个批次的 {currency} 已经有一条待审核的生成复核 | 错误提示 | [bank-files.ts:169](../../apps/api/src/services/bank-files.ts#L169) |
| `bank-files.c7167546` | 写死 | 这个批次的 {currency} 没有能进文件的账单 | 错误提示 | [bank-files.ts:180](../../apps/api/src/services/bank-files.ts#L180) |
| `bank-files.203bbb80` | 写死 | 有 {length} 张账单进不了文件，确认后才能继续 | 错误提示 | [bank-files.ts:181](../../apps/api/src/services/bank-files.ts#L181) |
| `bank-files.1ba9f26f` | 写死 | 生成 {payDate} 付款批次的 {currency} 转账文件：{length} 笔，合计 {currency} {…}，手续费 {chargeBearer}{…} | 说明 | [bank-files.ts:188](../../apps/api/src/services/bank-files.ts#L188) |
| `bank-files.e53e65bb` | 写死 | ；排除 {length} 张账单 | 说明 | [bank-files.ts:188](../../apps/api/src/services/bank-files.ts#L188) |
| `bank-files.01cc6500` | 写死 | 有账号解不开或不合规则，没有生成文件。请驳回这条复核，让供应商重新提交账户后再发起 | 错误提示 | [bank-files.ts:276](../../apps/api/src/services/bank-files.ts#L276) |
| `bank-files.e437d253` | 写死 | 转账文件 | 错误提示 | [bank-files.ts:343](../../apps/api/src/services/bank-files.ts#L343)、420、472、522 行 |
| `bank-files.98a15d8f` | 写死 | 文件内容和批准时不一致，已拒绝下载。请联系技术核对，不要转账 | 提示 | [bank-files.ts:359](../../apps/api/src/services/bank-files.ts#L359) |
| `bank-files.ba2a0681` | 写死 | 有账号解不开（数据加密密钥可能换过），没有生成文件。请作废这个文件、让供应商重新提交账户后再生成 | 文字 | [bank-files.ts:383](../../apps/api/src/services/bank-files.ts#L383) |
| `bank-files.a34c11b4` | 写死 | 已付款或已作废的文件不能再下载 | 错误提示 | [bank-files.ts:421](../../apps/api/src/services/bank-files.ts#L421) |
| `bank-files.a671fd3a` | 写死 | 文件生成后供应商的收款账户换过，文件里还是批准时的账号。确认这个账号仍然可用再下载 | 错误提示 | [bank-files.ts:425](../../apps/api/src/services/bank-files.ts#L425) |
| `bank-files.38d2fbeb` | 写死 | 已付款或已作废的文件不能回填 | 错误提示 | [bank-files.ts:473](../../apps/api/src/services/bank-files.ts#L473) |
| `bank-files.c0f064c5` | 写死 | 先下载文件、到银行转账，再回填流水号 | 错误提示 | [bank-files.ts:473](../../apps/api/src/services/bank-files.ts#L473) |
| `bank-files.237149a8` | 写死 | 文件条目 | 错误提示 | [bank-files.ts:478](../../apps/api/src/services/bank-files.ts#L478) |
| `bank-files.6953a821` | 写死 | 账单 {statementNo} 这一笔已作废 | 错误提示 | [bank-files.ts:479](../../apps/api/src/services/bank-files.ts#L479) |
| `bank-files.749ef81a` | 写死 | 账单 {statementNo} 这一笔已经回填过别的流水号，不能改 | 错误提示 | [bank-files.ts:482](../../apps/api/src/services/bank-files.ts#L482) |
| `bank-files.68fa2205` | 写死 | 只有已进付款批次的账单能记为已付款 | 错误提示 | [bank-files.ts:485](../../apps/api/src/services/bank-files.ts#L485) |
| `bank-files.a37af9bc` | 写死 | 已付款或已作废的文件不能作废 | 错误提示 | [bank-files.ts:523](../../apps/api/src/services/bank-files.ts#L523) |

## 供应商应付账单与付款批次的业务流程（billing.ts）

文件：`apps/api/src/services/billing.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `billing.e8f748d8` | 写死 | 只有待确认、有异议的账单能确认 | 按钮 | [billing.ts:96](../../apps/api/src/services/billing.ts#L96) |
| `billing.7822458c` | 写死 | 只有待确认的账单能自动确认 | 按钮 | [billing.ts:97](../../apps/api/src/services/billing.ts#L97) |
| `billing.eb5ada5d` | 写死 | 只有待确认的账单能提异议（已经提过的等平台答复） | 文字 | [billing.ts:98](../../apps/api/src/services/billing.ts#L98) |
| `billing.db55472a` | 写死 | 只有有异议的账单能答复 | 文字 | [billing.ts:99](../../apps/api/src/services/billing.ts#L99) |
| `billing.f66b5d1e` | 写死 | 只有待确认、有异议、待复核的账单能作废；已进付款批次或已有复核结论的不能 | 文字 | [billing.ts:100](../../apps/api/src/services/billing.ts#L100) |
| `billing.2087aa75` | 写死 | 只有供应商已确认的账单能发起付款复核 | 文字 | [billing.ts:101](../../apps/api/src/services/billing.ts#L101) |
| `billing.66707e92` | 写死 | 只有待复核的账单能批准付款 | 文字 | [billing.ts:102](../../apps/api/src/services/billing.ts#L102) |
| `billing.0debb5d5` | 写死 | 只有已进付款批次的账单能记为已付款 | 文字 | [billing.ts:103](../../apps/api/src/services/billing.ts#L103) |
| `billing.ed1402b0` | 写死 | 账单里有退回的违约金找不到对应的扣款，已取消这次出账，请联系技术核对 | 错误提示 | [billing.ts:125](../../apps/api/src/services/billing.ts#L125) |
| `billing.1d920ded` | 写死 | 请求参数校验未通过 | 错误提示 | [billing.ts:170](../../apps/api/src/services/billing.ts#L170) |
| `billing.dca8cfe3` | 写死 | 账单周期的格式是 YYYY-MM | 提示 | [billing.ts:170](../../apps/api/src/services/billing.ts#L170) |
| `billing.8fcea009` | 写死 | {period} 还没结束（按东京日期），月份结束后才能出账 | 错误提示 | [billing.ts:171](../../apps/api/src/services/billing.ts#L171) |
| `billing.aebfcdc9` | 写死 | 出账时出错，这家供应商这一次没有出账；已记录错误日志，请稍后重试或联系技术 | 提示 | [billing.ts:183](../../apps/api/src/services/billing.ts#L183) |
| `billing.82d37e86` | 写死 | 账单 | 错误提示 | [billing.ts:223](../../apps/api/src/services/billing.ts#L223)、235、249、268、292、311、332 行 |
| `billing.3cc78870` | 写死 | 确认期已过，这张账单已视为确认，不能再提异议；有问题请联系平台财务 | 错误提示 | [billing.ts:280](../../apps/api/src/services/billing.ts#L280) |
| `billing.485ad2fa` | 写死 | 这张账单有待审核的付款复核，先驳回或撤回那条复核再作废 | 错误提示 | [billing.ts:314](../../apps/api/src/services/billing.ts#L314) |
| `billing.a4a44737` | 写死 | 这张账单已经有一条待审核的付款复核 | 错误提示 | [billing.ts:335](../../apps/api/src/services/billing.ts#L335) |
| `billing.67fa2899` | 写死 | 付款给供应商「{name}」：{period} 账单 {statementNo}，合计 {totalMinor} {currency}（{lineCount} 条明细），应付日 {payDueOn} | 说明 | [billing.ts:341](../../apps/api/src/services/billing.ts#L341) |
| `billing.535a9859` | 写死 | 付款批次 | 错误提示 | [billing.ts:405](../../apps/api/src/services/billing.ts#L405)、417 行 |

## 预订草稿（booking-drafts.ts）

文件：`apps/api/src/services/booking-drafts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `booking-drafts.bad77951` | 写死 | 链接已过期，请重新填写 | 错误提示 | [booking-drafts.ts:32](../../apps/api/src/services/booking-drafts.ts#L32) |

## 平台统一取消政策（cancellation-policy.ts）

文件：`apps/api/src/services/cancellation-policy.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `cancellation-policy.6042a715` | 写死 | 每个「品类 × 车型级别」都要有一条阶梯 | 文字 | [cancellation-policy.ts:21](../../apps/api/src/services/cancellation-policy.ts#L21) |
| `cancellation-policy.34820426` | 写死 | 同一个「品类 × 车型级别」写了两条 | 文字 | [cancellation-policy.ts:22](../../apps/api/src/services/cancellation-policy.ts#L22) |
| `cancellation-policy.3e949429` | 写死 | 没有这个品类或车型级别 | 文字 | [cancellation-policy.ts:23](../../apps/api/src/services/cancellation-policy.ts#L23) |
| `cancellation-policy.81905073` | 写死 | 每条阶梯 1 到 5 档 | 文字 | [cancellation-policy.ts:24](../../apps/api/src/services/cancellation-policy.ts#L24) |
| `cancellation-policy.1ac8fd1d` | 写死 | 「距用车多少小时」要是 0 到 720 的整数 | 提示 | [cancellation-policy.ts:25](../../apps/api/src/services/cancellation-policy.ts#L25) |
| `cancellation-policy.2958237d` | 写死 | 各档的小时数要从大到小 | 文字 | [cancellation-policy.ts:26](../../apps/api/src/services/cancellation-policy.ts#L26) |
| `cancellation-policy.dbf0a605` | 写死 | 最后一档要是 0 小时（到用车时间为止） | 文字 | [cancellation-policy.ts:27](../../apps/api/src/services/cancellation-policy.ts#L27) |
| `cancellation-policy.c4aa2d68` | 写死 | 扣款比例要在 0% 到 100% 之间（基点 0–10000 的整数） | 提示 | [cancellation-policy.ts:28](../../apps/api/src/services/cancellation-policy.ts#L28) |
| `cancellation-policy.1f2a69b0` | 写死 | 越接近用车扣得越多：这一档不能比前一档扣得少 | 文字 | [cancellation-policy.ts:29](../../apps/api/src/services/cancellation-policy.ts#L29) |
| `cancellation-policy.b69d6b44` | 写死 | 点对点 | 文字 | [cancellation-policy.ts:60](../../apps/api/src/services/cancellation-policy.ts#L60) |
| `cancellation-policy.c3852ba7` | 写死 | 包车 | 文字 | [cancellation-policy.ts:60](../../apps/api/src/services/cancellation-policy.ts#L60) |
| `cancellation-policy.dbddfce0` | 写死 | 接送机 | 文字 | [cancellation-policy.ts:60](../../apps/api/src/services/cancellation-policy.ts#L60) |
| `cancellation-policy.65488384` | 写死 | 修改平台取消政策：{text}（共 {length} 条阶梯） | 说明 | [cancellation-policy.ts:62](../../apps/api/src/services/cancellation-policy.ts#L62) |
| `cancellation-policy.a12c4d3d` | 写死 | 和现在的政策一样，不用发起 | 提示 | [cancellation-policy.ts:101](../../apps/api/src/services/cancellation-policy.ts#L101) |

## 取消（cancellations.ts）

文件：`apps/api/src/services/cancellations.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `cancellations.149491a9` | 写死 | 订单当前的状态不能取消（服务开始后不能取消） | 错误提示 | [cancellations.ts:121](../../apps/api/src/services/cancellations.ts#L121) |
| `cancellations.c205cb0a` | 写死 | 这张单不符合「修改没确认」免费取消的条件（用车前 24 小时内提出的改期被拒绝或没确认），请按取消政策处理 | 错误提示 | [cancellations.ts:128](../../apps/api/src/services/cancellations.ts#L128) |
| `cancellations.dfcf51ec` | 写死 | 订单 | 错误提示 | [cancellations.ts:208](../../apps/api/src/services/cancellations.ts#L208)、290、334 行 |
| `cancellations.38f16193` | 写死 | 收款服务出错，没能取消这笔付款，请稍后重试 | 错误提示 | [cancellations.ts:241](../../apps/api/src/services/cancellations.ts#L241) |
| `cancellations.18f2dd99` | 写死 | 客人的付款正在处理中，稍后再取消 | 错误提示 | [cancellations.ts:244](../../apps/api/src/services/cancellations.ts#L244) |
| `cancellations.b38fe64f` | 写死 | 这两种原因只由系统使用 | 提示 | [cancellations.ts:278](../../apps/api/src/services/cancellations.ts#L278) |
| `cancellations.76dd098d` | 写死 | 免费的原因本来就不扣取消费 | 提示 | [cancellations.ts:279](../../apps/api/src/services/cancellations.ts#L279) |
| `cancellations.05f48901` | 写死 | ，免收取消费 | 说明 | [cancellations.ts:312](../../apps/api/src/services/cancellations.ts#L312) |
| `cancellations.bda06d71` | 写死 | 代取消订单 {orderNo}（{reason}{…}）：退给客人 {…}，按取消政策应退 {…} | 说明 | [cancellations.ts:312](../../apps/api/src/services/cancellations.ts#L312) |
| `cancellations.3a7e8244` | 写死 | 这张单已经取消了（可能是客人自己取消的）；请驳回 | 错误提示 | [cancellations.ts:335](../../apps/api/src/services/cancellations.ts#L335) |

## 渠道的 API 客户端与密钥（channel-clients.ts）

文件：`apps/api/src/services/channel-clients.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `channel-clients.861160c2` | 写死 | 渠道 | 错误提示 | [channel-clients.ts:129](../../apps/api/src/services/channel-clients.ts#L129) |
| `channel-clients.e023d542` | 写死 | API 客户端 | 错误提示 | [channel-clients.ts:135](../../apps/api/src/services/channel-clients.ts#L135) |
| `channel-clients.6ff6f281` | 写死 | 这个 API 客户端已经吊销，不能轮换；请新建一个 | 错误提示 | [channel-clients.ts:174](../../apps/api/src/services/channel-clients.ts#L174) |
| `channel-clients.9b3434e0` | 写死 | 这个 API 客户端已经吊销了 | 错误提示 | [channel-clients.ts:200](../../apps/api/src/services/channel-clients.ts#L200) |

## 渠道与加价规则（channels.ts）

文件：`apps/api/src/services/channels.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `channels.615db72b` | 写死 | 超出了允许的范围 | 文字 | [channels.ts:62](../../apps/api/src/services/channels.ts#L62)、71 行 |
| `channels.29ef530d` | 写死 | 加价下限不能低于平台下限 {…}% | 文字 | [channels.ts:63](../../apps/api/src/services/channels.ts#L63) |
| `channels.51ede591` | 写死 | 默认加价比例不能低于这个渠道的加价下限 | 文字 | [channels.ts:64](../../apps/api/src/services/channels.ts#L64) |
| `channels.62bb3852` | 写死 | 不支持这个币种 | 文字 | [channels.ts:65](../../apps/api/src/services/channels.ts#L65) |
| `channels.3ab8c9c0` | 写死 | 必须是整数 | 文字 | [channels.ts:66](../../apps/api/src/services/channels.ts#L66) |
| `channels.fdf4d78b` | 写死 | 维度组合只能是五级之一：租户 × 城市 × 品类 × 车型组、租户、城市 × 品类 × 车型组、城市 × 品类、全渠道（带日期） | 文字 | [channels.ts:70](../../apps/api/src/services/channels.ts#L70) |
| `channels.8e981230` | 写死 | 加价比例低于这个渠道的加价下限，系统不允许 | 文字 | [channels.ts:72](../../apps/api/src/services/channels.ts#L72) |
| `channels.03088fad` | 写死 | 结束日期不能早于开始日期 | 文字 | [channels.ts:73](../../apps/api/src/services/channels.ts#L73) |
| `channels.c2684936` | 写死 | 不是真实存在的日期（YYYY-MM-DD） | 提示 | [channels.ts:74](../../apps/api/src/services/channels.ts#L74) |
| `channels.5b6a4403` | 写死 | 全渠道的规则必须带日期范围（不带日期的全渠道比例就是渠道的默认加价比例） | 提示 | [channels.ts:75](../../apps/api/src/services/channels.ts#L75) |
| `channels.51ef5f70` | 写死 | 已经有同名的渠道，请换一个名字 | 错误提示 | [channels.ts:84](../../apps/api/src/services/channels.ts#L84) |
| `channels.cbf62c6a` | 写死 | 可卖全部租户时不填租户名单 | 提示 | [channels.ts:89](../../apps/api/src/services/channels.ts#L89) |
| `channels.acbea4da` | 写死 | 白名单或黑名单至少要有一个租户 | 提示 | [channels.ts:90](../../apps/api/src/services/channels.ts#L90) |
| `channels.ac2dce25` | 写死 | 指定城市时至少选一个；不限城市请填 null | 提示 | [channels.ts:91](../../apps/api/src/services/channels.ts#L91) |
| `channels.1c6fd417` | 写死 | 租户不存在 | 提示 | [channels.ts:92](../../apps/api/src/services/channels.ts#L92)、361 行 |
| `channels.1269fa44` | 写死 | 城市不存在 | 提示 | [channels.ts:93](../../apps/api/src/services/channels.ts#L93)、362 行 |
| `channels.eea29d22` | 写死 | 渠道 | 错误提示 | [channels.ts:99](../../apps/api/src/services/channels.ts#L99) |
| `channels.726ab188` | 写死 | 渠道已经是启用状态 | 错误提示 | [channels.ts:235](../../apps/api/src/services/channels.ts#L235) |
| `channels.57671f6a` | 写死 | 包车 | 文字 | [channels.ts:244](../../apps/api/src/services/channels.ts#L244) |
| `channels.5b513418` | 写死 | 接送机 | 文字 | [channels.ts:244](../../apps/api/src/services/channels.ts#L244) |
| `channels.f3d9256d` | 写死 | 点对点 | 文字 | [channels.ts:244](../../apps/api/src/services/channels.ts#L244) |
| `channels.3ec4e8e3` | 写死 | 渠道已经是暂停状态 | 错误提示 | [channels.ts:274](../../apps/api/src/services/channels.ts#L274)、335 行 |
| `channels.730f780e` | 写死 | 有 {length} 条还在用的加价规则低于新的下限 {…}，请先把它们改到下限以上再调高下限 | 错误提示 | [channels.ts:281](../../apps/api/src/services/channels.ts#L281) |
| `channels.e73a9336` | 写死 | 和现在的定价参数一样，不用发起 | 提示 | [channels.ts:308](../../apps/api/src/services/channels.ts#L308) |
| `channels.ef76124a` | 写死 | 默认加价 {…} → {…} | 文字 | [channels.ts:311](../../apps/api/src/services/channels.ts#L311) |
| `channels.1d912ef0` | 写死 | 加价下限 {…} → {…} | 文字 | [channels.ts:312](../../apps/api/src/services/channels.ts#L312) |
| `channels.fd80f249` | 写死 | 价格带 {…} → {…} | 文字 | [channels.ts:313](../../apps/api/src/services/channels.ts#L313) |
| `channels.a1b1f808` | 写死 | 最低毛利金额 | 文字 | [channels.ts:314](../../apps/api/src/services/channels.ts#L314) |
| `channels.e2d92fd2` | 写死 | 对外价取整 | 文字 | [channels.ts:315](../../apps/api/src/services/channels.ts#L315) |
| `channels.ce94f9d7` | 写死 | 「{name}」改定价参数：{…} | 说明 | [channels.ts:320](../../apps/api/src/services/channels.ts#L320) |
| `channels.de0be1c9` | 写死 | 暂停渠道「{name}」 | 说明 | [channels.ts:336](../../apps/api/src/services/channels.ts#L336) |
| `channels.c56ca899` | 写死 | 加价比例不能低于这个渠道的加价下限 {…}，系统不允许 | 提示 | [channels.ts:358](../../apps/api/src/services/channels.ts#L358) |
| `channels.39dcf7d8` | 写死 | 车型组不存在 | 提示 | [channels.ts:363](../../apps/api/src/services/channels.ts#L363) |
| `channels.8345e46c` | 写死 | 同一组维度上已经有一条规则：不带日期的只能有一条，带日期的日期范围不能重叠 | 错误提示 | [channels.ts:367](../../apps/api/src/services/channels.ts#L367) |
| `channels.03701cfb` | 写死 | （{…} 至 {…}） | 文字 | [channels.ts:381](../../apps/api/src/services/channels.ts#L381) |
| `channels.ea0cfbdb` | 写死 | 不限 | 文字 | [channels.ts:381](../../apps/api/src/services/channels.ts#L381) |
| `channels.9101eb86` | 写死 | 全渠道 | 说明 | [channels.ts:382](../../apps/api/src/services/channels.ts#L382) |
| `channels.a140a4ad` | 写死 | 要改的这条加价规则已经被删除了；请驳回 | 错误提示 | [channels.ts:416](../../apps/api/src/services/channels.ts#L416) |
| `channels.db988bf9` | 写死 | 这条加价规则已经被删除了；请驳回 | 错误提示 | [channels.ts:436](../../apps/api/src/services/channels.ts#L436) |
| `channels.4d98b959` | 写死 | 「{name}」新增加价规则：{…} | 说明 | [channels.ts:453](../../apps/api/src/services/channels.ts#L453) |
| `channels.2a79d686` | 写死 | 加价规则 | 错误提示 | [channels.ts:463](../../apps/api/src/services/channels.ts#L463)、486 行 |
| `channels.58ea15c7` | 写死 | 和现在的规则一样，不用发起 | 提示 | [channels.ts:465](../../apps/api/src/services/channels.ts#L465) |
| `channels.e4407836` | 写死 | 「{name}」修改加价规则：{…} → {…} | 说明 | [channels.ts:470](../../apps/api/src/services/channels.ts#L470) |
| `channels.98377512` | 写死 | 「{name}」删除加价规则：{…} | 说明 | [channels.ts:488](../../apps/api/src/services/channels.ts#L488) |

## 包车三层区域的保存校验（charter-layers.ts）

文件：`apps/api/src/services/charter-layers.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-layers.cb16d99f` | 写死 | 基础价区域（服务区域） | 文字 | [charter-layers.ts:12](../../apps/api/src/services/charter-layers.ts#L12) |
| `charter-layers.69b07bd6` | 写死 | 行程加价的区域 | 文字 | [charter-layers.ts:13](../../apps/api/src/services/charter-layers.ts#L13) |
| `charter-layers.ec97c803` | 写死 | 上下车加价的区域 | 文字 | [charter-layers.ts:14](../../apps/api/src/services/charter-layers.ts#L14) |
| `charter-layers.508a4aed` | 写死 | 基础价区域和上下车加价的区域 | 文字 | [charter-layers.ts:15](../../apps/api/src/services/charter-layers.ts#L15) |
| `charter-layers.d9e54b51` | 写死 | 「{a}」和「{b}」重叠约 {…} 平方公里：同一个商品的{…}不能重叠（一个点只能有一个答案）。请先在区域页面切掉重叠的部分 | 提示 | [charter-layers.ts:42](../../apps/api/src/services/charter-layers.ts#L42) |
| `charter-layers.542fca2b` | 写死 | 基础价区域「{a}」和上下车加价的区域「{b}」重叠约 {…} 平方公里：在基础价区域里上下车不加价，两者不能重叠。请先在区域页面切掉重叠的部分 | 提示 | [charter-layers.ts:43](../../apps/api/src/services/charter-layers.ts#L43) |

## 包车三层区域的数据迁移（charter-three-layer.ts）

文件：`apps/api/src/services/charter-three-layer.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-three-layer.300f8522` | 写死 | 东京市内 | 名称 | [charter-three-layer.ts:26](../../apps/api/src/services/charter-three-layer.ts#L26) |
| `charter-three-layer.eee1a01d` | 写死 | 成田机场 | 文字 | [charter-three-layer.ts:51](../../apps/api/src/services/charter-three-layer.ts#L51) |
| `charter-three-layer.1f7b6990` | 写死 | 成田市 | 文字 | [charter-three-layer.ts:52](../../apps/api/src/services/charter-three-layer.ts#L52) |
| `charter-three-layer.35bc7816` | 写死 | 千叶超远 | 文字 | [charter-three-layer.ts:52](../../apps/api/src/services/charter-three-layer.ts#L52) |
| `charter-three-layer.0ece340b` | 写死 | 已定 A：按机场收 14,000，待切割成田市、千叶超远的包车副本 | 说明 | [charter-three-layer.ts:53](../../apps/api/src/services/charter-three-layer.ts#L53) |
| `charter-three-layer.58abdf67` | 写死 | 三层区域迁移（{mode}）：包车商品 {products} 个，迁移 {migrated}、已迁过跳过 {alreadyMigrated}、没有套餐价跳过 {noPackage}； | 文字 | [charter-three-layer.ts:157](../../apps/api/src/services/charter-three-layer.ts#L157) |
| `charter-three-layer.4c107664` | 写死 | 新建整商品套餐价 {createdPackages} 条、行程加价 {createdItinerary} 条； | 文字 | [charter-three-layer.ts:158](../../apps/api/src/services/charter-three-layer.ts#L158) |
| `charter-three-layer.f28fbc26` | 写死 | 报告：套餐价不一致 {packageMismatches}、基础价区域上的上下车加价 {baseAreaSurcharges}、重叠 {overlaps}、只有途经加价的行 {waypointOnlyRows}、空格 {emptyCells}、行程加价与已定金额不一致 {itineraryMismatches} | 文字 | [charter-three-layer.ts:159](../../apps/api/src/services/charter-three-layer.ts#L159) |
| `charter-three-layer.4a59ca80` | 写死 | 未配置 | 文字 | [charter-three-layer.ts:229](../../apps/api/src/services/charter-three-layer.ts#L229) |
| `charter-three-layer.ee18a3a4` | 写死 | （整个商品） | 文字 | [charter-three-layer.ts:241](../../apps/api/src/services/charter-three-layer.ts#L241) |

## 城市导入（city-import.ts）

文件：`apps/api/src/services/city-import.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `city-import.93e0cad1` | 写死 | 导入期间有人在后台新增了编码相同的城市。数据库没有任何变化，请再运行一次 | 错误提示 | [city-import.ts:41](../../apps/api/src/services/city-import.ts#L41) |
| `city-import.3e04a54e` | 写死 | 另一个城市导入正在运行。数据库没有任何变化，请等它结束后再试 | 错误提示 | [city-import.ts:51](../../apps/api/src/services/city-import.ts#L51) |
| `city-import.5fd09f63` | 写死 | 导入期间平台在后台改了这个城市，没有覆盖；需要的话请再运行一次导入 | 提示 | [city-import.ts:130](../../apps/api/src/services/city-import.ts#L130) |

## 客人赔付表（compensation-table.ts）

文件：`apps/api/src/services/compensation-table.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `compensation-table.ba76e4a6` | 写死 | 超出了允许的范围 | 文字 | [compensation-table.ts:21](../../apps/api/src/services/compensation-table.ts#L21) |
| `compensation-table.d440d245` | 写死 | 司机未到是全额退款，比例固定 100%，不能改 | 文字 | [compensation-table.ts:22](../../apps/api/src/services/compensation-table.ts#L22) |
| `compensation-table.30ae291b` | 写死 | 每笔最低 ¥{minimumJpy} → ¥{minimumJpy} | 文字 | [compensation-table.ts:37](../../apps/api/src/services/compensation-table.ts#L37) |
| `compensation-table.7dcc3d56` | 写死 | 报销上限 {…} 倍 → {…} 倍 | 文字 | [compensation-table.ts:38](../../apps/api/src/services/compensation-table.ts#L38) |
| `compensation-table.8dd6a529` | 写死 | 复核阈值 {…}% → {…}% | 文字 | [compensation-table.ts:39](../../apps/api/src/services/compensation-table.ts#L39) |
| `compensation-table.63a4eef4` | 写死 | 修改客人赔付表：{…} | 说明 | [compensation-table.ts:40](../../apps/api/src/services/compensation-table.ts#L40) |
| `compensation-table.3c71eb36` | 写死 | 和现在的赔付表一样，不用发起 | 提示 | [compensation-table.ts:76](../../apps/api/src/services/compensation-table.ts#L76) |

## 派车（dispatch.ts）

文件：`apps/api/src/services/dispatch.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `dispatch.d055054c` | 写死 | 订单 | 错误提示 | [dispatch.ts:53](../../apps/api/src/services/dispatch.ts#L53)、114 行 |
| `dispatch.31df1d01` | 写死 | 这位司机或这辆车不符合订单的要求 | 错误提示 | [dispatch.ts:135](../../apps/api/src/services/dispatch.ts#L135) |
| `dispatch.eee7f277` | 写死 | 这位司机或这辆车在同一时段已有别的订单。确认没问题的话，带上 confirm\_conflicts: true 再派一次 | 错误提示 | [dispatch.ts:139](../../apps/api/src/services/dispatch.ts#L139) |
| `dispatch.7a372d05` | 写死 | 司机不存在 | 提示 | [dispatch.ts:192](../../apps/api/src/services/dispatch.ts#L192) |
| `dispatch.b99a5ab2` | 写死 | 车辆不存在 | 提示 | [dispatch.ts:193](../../apps/api/src/services/dispatch.ts#L193) |
| `dispatch.c25b9edd` | 写死 | 用车结束已超过 24 小时，不能再生成司机链接 | 错误提示 | [dispatch.ts:238](../../apps/api/src/services/dispatch.ts#L238) |
| `dispatch.5020725f` | 写死 | 司机链接 | 错误提示 | [dispatch.ts:256](../../apps/api/src/services/dispatch.ts#L256) |

## 计程价的业务流程（distance-prices.ts）

文件：`apps/api/src/services/distance-prices.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `distance-prices.64d987bc` | 写死 | 必须是整数（金额用最小货币单位） | 文字 | [distance-prices.ts:29](../../apps/api/src/services/distance-prices.ts#L29) |
| `distance-prices.8ff92bad` | 写死 | 超出了允许的范围（起步价和每公里单价不能都是 0） | 文字 | [distance-prices.ts:30](../../apps/api/src/services/distance-prices.ts#L30) |
| `distance-prices.3f1fef97` | 写死 | 不是合法的日期（YYYY-MM-DD） | 提示 | [distance-prices.ts:31](../../apps/api/src/services/distance-prices.ts#L31) |
| `distance-prices.ac06fa60` | 写死 | 结束日期不能早于开始日期 | 文字 | [distance-prices.ts:32](../../apps/api/src/services/distance-prices.ts#L32) |
| `distance-prices.f04b540c` | 写死 | 计程价只有接送机、点对点商品能设（包车不用计程兜底） | 错误提示 | [distance-prices.ts:56](../../apps/api/src/services/distance-prices.ts#L56) |
| `distance-prices.c21cbeb3` | 写死 | 不正确 | 提示 | [distance-prices.ts:61](../../apps/api/src/services/distance-prices.ts#L61) |
| `distance-prices.da589276` | 写死 | 只能选这个商品选了的车型组 | 提示 | [distance-prices.ts:63](../../apps/api/src/services/distance-prices.ts#L63) |
| `distance-prices.660b3bb5` | 写死 | 同一个车型组的计程价，生效日期不能重叠（两头的日期都算在内，停用的也算） | 错误提示 | [distance-prices.ts:67](../../apps/api/src/services/distance-prices.ts#L67) |
| `distance-prices.5a56fa06` | 写死 | 一个商品最多 {MAX\_DISTANCE\_PRICES\_PER\_PRODUCT} 条计程价 | 提示 | [distance-prices.ts:100](../../apps/api/src/services/distance-prices.ts#L100) |
| `distance-prices.3ade12ee` | 写死 | 计程价 | 错误提示 | [distance-prices.ts:120](../../apps/api/src/services/distance-prices.ts#L120) |

## 司机链接自动发邮件（driver-link-email.ts）

文件：`apps/api/src/services/driver-link-email.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `driver-link-email.30d04793` | 写死 | 订单 | 错误提示 | [driver-link-email.ts:95](../../apps/api/src/services/driver-link-email.ts#L95)、108 行 |
| `driver-link-email.07c1d977` | 写死 | 这一单现在没有有效的司机链接，请先重新生成 | 错误提示 | [driver-link-email.ts:112](../../apps/api/src/services/driver-link-email.ts#L112) |
| `driver-link-email.51fb6a39` | 写死 | 这条司机链接已过期，请先重新生成 | 错误提示 | [driver-link-email.ts:115](../../apps/api/src/services/driver-link-email.ts#L115) |
| `driver-link-email.89b62f7a` | 写死 | 用车结束已超过 24 小时，不能再发司机链接 | 错误提示 | [driver-link-email.ts:116](../../apps/api/src/services/driver-link-email.ts#L116) |
| `driver-link-email.73a87725` | 写死 | 当前设置是调度员手动发送，系统不发邮件。请复制链接发给司机 | 错误提示 | [driver-link-email.ts:119](../../apps/api/src/services/driver-link-email.ts#L119) |
| `driver-link-email.de0e60ef` | 写死 | 这位司机没有邮箱，请到车队里补上，或复制链接手动发 | 错误提示 | [driver-link-email.ts:121](../../apps/api/src/services/driver-link-email.ts#L121) |
| `driver-link-email.2f5996e6` | 写死 | 这位司机已停用，不能发邮件。请先恢复在职或改派 | 错误提示 | [driver-link-email.ts:122](../../apps/api/src/services/driver-link-email.ts#L122) |
| `driver-link-email.e2a6902f` | 写死 | 见任务详情 | 文字 | [driver-link-email.ts:177](../../apps/api/src/services/driver-link-email.ts#L177)、215 行 |
| `driver-link-email.8dfd3045` | 写死 | 任务信息 | 文字 | [driver-link-email.ts:217](../../apps/api/src/services/driver-link-email.ts#L217) |

## 司机 H5（driver-trip.ts）

文件：`apps/api/src/services/driver-trip.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `driver-trip.ff3364b7` | 写死 | 链接无效或已过期，请联系调度重新发送 | 错误提示 | [driver-trip.ts:58](../../apps/api/src/services/driver-trip.ts#L58) |
| `driver-trip.42fcd4c0` | 写死 | 照片太大了（最大 {…} MB） | 错误提示 | [driver-trip.ts:180](../../apps/api/src/services/driver-trip.ts#L180) |
| `driver-trip.06971c73` | 写死 | 只能是 arrival\_screen、signboard、contact\_screenshot、receipt | 提示 | [driver-trip.ts:185](../../apps/api/src/services/driver-trip.ts#L185) |
| `driver-trip.909e7094` | 写死 | 没有收到照片 | 提示 | [driver-trip.ts:186](../../apps/api/src/services/driver-trip.ts#L186) |
| `driver-trip.0810d92d` | 写死 | 只能上传 JPEG、PNG、WebP 或 HEIC 格式的照片，且请求头 Content-Type 要和文件一致 | 错误提示 | [driver-trip.ts:190](../../apps/api/src/services/driver-trip.ts#L190) |
| `driver-trip.82beb1a1` | 写死 | 照片不存在 | 错误提示 | [driver-trip.ts:202](../../apps/api/src/services/driver-trip.ts#L202) |
| `driver-trip.610d3de7` | 写死 | 落地时间已经提交过，不能修改（有争议请联系客服走工单） | 错误提示 | [driver-trip.ts:208](../../apps/api/src/services/driver-trip.ts#L208) |
| `driver-trip.61576d4f` | 写死 | 落地时间比计划到达早了 3 小时以上，请检查 | 文字 | [driver-trip.ts:213](../../apps/api/src/services/driver-trip.ts#L213) |
| `driver-trip.a64f0123` | 写死 | 落地时间不能晚于现在 | 文字 | [driver-trip.ts:213](../../apps/api/src/services/driver-trip.ts#L213) |
| `driver-trip.59c5747f` | 写死 | 这一单不是接机，不需要填落地时间 | 错误提示 | [driver-trip.ts:232](../../apps/api/src/services/driver-trip.ts#L232) |
| `driver-trip.62cdeddd` | 写死 | 要先拍一张到达屏的照片（显示这个航班已到达） | 提示 | [driver-trip.ts:236](../../apps/api/src/services/driver-trip.ts#L236) |
| `driver-trip.c983a881` | 写死 | 截图不存在 | 提示 | [driver-trip.ts:252](../../apps/api/src/services/driver-trip.ts#L252) |
| `driver-trip.370b6c6a` | 写死 | 已经申请过离开 | 错误提示 | [driver-trip.ts:264](../../apps/api/src/services/driver-trip.ts#L264) |
| `driver-trip.cbbf700f` | 写死 | 免费等待还没结束，结束后才能申请离开 | 错误提示 | [driver-trip.ts:267](../../apps/api/src/services/driver-trip.ts#L267) |
| `driver-trip.edd915e7` | 写死 | 这一单是无限免费等待，不能申请离开，请联系调度 | 错误提示 | [driver-trip.ts:267](../../apps/api/src/services/driver-trip.ts#L267) |
| `driver-trip.a0edc820` | 写死 | no-show 的 5 项证据还不齐，不能提交 | 错误提示 | [driver-trip.ts:276](../../apps/api/src/services/driver-trip.ts#L276) |

## 登录和账号相关的业务错误（errors.ts）

文件：`apps/api/src/services/errors.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `errors.eae8a64a` | 写死 | 邮箱或密码不正确 | 错误提示 | [errors.ts:8](../../apps/api/src/services/errors.ts#L8) |
| `errors.54d0ded4` | 写死 | 账号已停用，请联系管理员 | 错误提示 | [errors.ts:12](../../apps/api/src/services/errors.ts#L12) |
| `errors.acac10c7` | 写死 | 请先登录 | 错误提示 | [errors.ts:16](../../apps/api/src/services/errors.ts#L16) |
| `errors.b32f702c` | 写死 | 当前角色没有这个操作的权限 | 错误提示 | [errors.ts:20](../../apps/api/src/services/errors.ts#L20)、25 行 |
| `errors.c78104f6` | 写死 | 请先修改密码，再继续使用 | 错误提示 | [errors.ts:30](../../apps/api/src/services/errors.ts#L30) |
| `errors.571074bf` | 写死 | {what}不存在 | 错误提示 | [errors.ts:34](../../apps/api/src/services/errors.ts#L34) |
| `errors.103fdbc4` | 写死 | 邀请无效或已过期，请联系邀请人重新发出邀请 | 错误提示 | [errors.ts:39](../../apps/api/src/services/errors.ts#L39) |
| `errors.0f6ba909` | 写死 | 密码强度不够 | 错误提示 | [errors.ts:43](../../apps/api/src/services/errors.ts#L43) |
| `errors.35fd10c0` | 写死 | 这个邮箱已被使用 | 错误提示 | [errors.ts:49](../../apps/api/src/services/errors.ts#L49) |
| `errors.bc2ea537` | 写死 | 至少要保留一个在用的{roleName} | 错误提示 | [errors.ts:53](../../apps/api/src/services/errors.ts#L53) |
| `errors.2863795d` | 写死 | 不能把账号改回待激活 | 文字 | [errors.ts:57](../../apps/api/src/services/errors.ts#L57) |
| `errors.593eb358` | 写死 | 账号从未激活，不能直接启用，请重新邀请 | 文字 | [errors.ts:58](../../apps/api/src/services/errors.ts#L58) |
| `errors.2277fe59` | 写死 | 尝试次数过多，请稍后再试 | 错误提示 | [errors.ts:66](../../apps/api/src/services/errors.ts#L66) |
| `errors.eb2bd1f5` | 写死 | 现在不能发送邮箱验证码，请改用密码登录 | 错误提示 | [errors.ts:73](../../apps/api/src/services/errors.ts#L73) |
| `errors.793ff163` | 写死 | 验证码不正确或已失效 | 错误提示 | [errors.ts:78](../../apps/api/src/services/errors.ts#L78) |
| `errors.68a7e951` | 写死 | 密码登录已关闭，请用邮箱验证码登录 | 错误提示 | [errors.ts:82](../../apps/api/src/services/errors.ts#L82) |
| `errors.940b6429` | 写死 | 当前密码不正确 | 错误提示 | [errors.ts:86](../../apps/api/src/services/errors.ts#L86) |
| `errors.b2c714f3` | 写死 | 这个账号的密码刚刚被别的操作改过，本次没有重设；确认后请再运行一次 | 错误提示 | [errors.ts:91](../../apps/api/src/services/errors.ts#L91) |
| `errors.850707f1` | 写死 | 新密码不能和当前密码相同 | 错误提示 | [errors.ts:95](../../apps/api/src/services/errors.ts#L95) |
| `errors.0a56b550` | 写死 | 重置链接无效或已过期，请联系管理员重新发起 | 错误提示 | [errors.ts:100](../../apps/api/src/services/errors.ts#L100) |
| `errors.545b9283` | 写死 | 账号不是在用状态：待激活的账号请重新邀请，已停用的账号请先启用 | 错误提示 | [errors.ts:105](../../apps/api/src/services/errors.ts#L105) |
| `errors.d22787a5` | 写死 | 这个城市已经有同名的区域，请换一个名字 | 错误提示 | [errors.ts:110](../../apps/api/src/services/errors.ts#L110) |
| `errors.f2b736a4` | 写死 | 这个 Idempotency-Key 已经用于另一个内容不同的请求，请换一个新的键 | 错误提示 | [errors.ts:122](../../apps/api/src/services/errors.ts#L122) |
| `errors.44473844` | 写死 | 这个 Idempotency-Key 上一次已经创建成功（见 details.created），这次的内容和上一次不同。要改内容请修改已经建好的那一条，或换一个新的键另建 | 错误提示 | [errors.ts:123](../../apps/api/src/services/errors.ts#L123) |
| `errors.d8153305` | 写死 | 这个编码已被使用 | 错误提示 | [errors.ts:130](../../apps/api/src/services/errors.ts#L130) |
| `errors.fca1f5de` | 写死 | 这些字段创建后不能修改 | 错误提示 | [errors.ts:135](../../apps/api/src/services/errors.ts#L135) |
| `errors.79fccfcf` | 写死 | 这条记录已被别人修改，请刷新后重试 | 错误提示 | [errors.ts:140](../../apps/api/src/services/errors.ts#L140) |
| `errors.70622898` | 写死 | 修改时必须用请求头 If-Match 带上当前的版本号 | 错误提示 | [errors.ts:145](../../apps/api/src/services/errors.ts#L145) |
| `errors.716aa419` | 写死 | 请先输入两步验证的动态码，再继续使用 | 错误提示 | [errors.ts:165](../../apps/api/src/services/errors.ts#L165) |
| `errors.9402fe81` | 写死 | 请先绑定两步验证，再继续使用 | 错误提示 | [errors.ts:165](../../apps/api/src/services/errors.ts#L165) |
| `errors.cf7e056a` | 写死 | 动态码或恢复码不正确 | 错误提示 | [errors.ts:171](../../apps/api/src/services/errors.ts#L171) |
| `errors.aa94bc36` | 写死 | 这个动态码已经用过了，请等验证器上出现下一个再输入 | 错误提示 | [errors.ts:175](../../apps/api/src/services/errors.ts#L175) |
| `errors.a99847d9` | 写死 | 要先输入现在的动态码（或一个恢复码）确认是本人 | 错误提示 | [errors.ts:179](../../apps/api/src/services/errors.ts#L179) |
| `errors.43a2b932` | 写死 | 这个账号还没有绑定两步验证，请先绑定 | 错误提示 | [errors.ts:183](../../apps/api/src/services/errors.ts#L183) |
| `errors.eb38725c` | 写死 | 这个账号已经绑定了两步验证，请输入动态码登录；要换手机请登录后在个人页更换 | 错误提示 | [errors.ts:187](../../apps/api/src/services/errors.ts#L187) |
| `errors.94387655` | 写死 | 这次登录已经通过了两步验证 | 错误提示 | [errors.ts:191](../../apps/api/src/services/errors.ts#L191) |
| `errors.66e5665c` | 写死 | 绑定已过期或还没开始，请重新生成二维码 | 错误提示 | [errors.ts:195](../../apps/api/src/services/errors.ts#L195) |
| `errors.91bdae36` | 写死 | 平台还没有配置数据加密密钥（DATA\_ENCRYPTION\_KEY），现在不能绑定或验证两步验证。请联系技术人员 | 错误提示 | [errors.ts:199](../../apps/api/src/services/errors.ts#L199) |
| `errors.46c10d22` | 写死 | 两步验证的密钥读取失败，请联系超级管理员重置你的两步验证后重新绑定 | 错误提示 | [errors.ts:204](../../apps/api/src/services/errors.ts#L204) |
| `errors.f4b90078` | 写死 | 不能重置自己的两步验证：换手机请在个人页更换；手机和恢复码都丢了，请另一位超级管理员处理 | 错误提示 | [errors.ts:208](../../apps/api/src/services/errors.ts#L208) |
| `errors.f9a1a67d` | 写死 | 当前网络地址不在这个账号允许的范围内，请在公司网络或指定的网络下登录，或联系超级管理员 | 错误提示 | [errors.ts:212](../../apps/api/src/services/errors.ts#L212) |
| `errors.062ff037` | 写死 | IP 白名单里有写错的地址段 | 错误提示 | [errors.ts:216](../../apps/api/src/services/errors.ts#L216) |
| `errors.7240f075` | 写死 | 改了之后，你现在的网络地址就不在名单里了，保存后你会立即无法使用。请先把当前地址加进去 | 错误提示 | [errors.ts:221](../../apps/api/src/services/errors.ts#L221) |
| `errors.553ce458` | 写死 | 内置角色是只读模板，不能修改或删除；可以复制它新建一个角色再改 | 错误提示 | [errors.ts:225](../../apps/api/src/services/errors.ts#L225) |
| `errors.919992df` | 写死 | 还有账号在用这个角色，先把它们改成别的角色再删除 | 错误提示 | [errors.ts:229](../../apps/api/src/services/errors.ts#L229) |
| `errors.f4dbe2fe` | 写死 | 已经有同名的角色 | 错误提示 | [errors.ts:233](../../apps/api/src/services/errors.ts#L233) |
| `errors.8bfd2c7b` | 写死 | 勾选的权限有问题 | 错误提示 | [errors.ts:237](../../apps/api/src/services/errors.ts#L237) |
| `errors.0df9362e` | 写死 | 数据范围里有不存在的城市或渠道 | 错误提示 | [errors.ts:241](../../apps/api/src/services/errors.ts#L241) |
| `errors.480ac5c3` | 写死 | 没有这个角色 | 提示 | [errors.ts:246](../../apps/api/src/services/errors.ts#L246) |
| `errors.c00da0a5` | 写死 | 不能修改自己的角色，请另一位超级管理员处理 | 错误提示 | [errors.ts:250](../../apps/api/src/services/errors.ts#L250) |
| `errors.808e87c3` | 写死 | 当前角色限定了数据范围，不能做这个操作 | 错误提示 | [errors.ts:255](../../apps/api/src/services/errors.ts#L255) |

## 订单异常队列（exceptions.ts）

文件：`apps/api/src/services/exceptions.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `exceptions.a841d412` | 写死 | 异常 | 错误提示 | [exceptions.ts:52](../../apps/api/src/services/exceptions.ts#L52)、64、88、110 行 |
| `exceptions.763b93f4` | 写死 | 这条异常已经关闭了 | 错误提示 | [exceptions.ts:76](../../apps/api/src/services/exceptions.ts#L76) |
| `exceptions.f60f7b51` | 写死 | 这条异常已经有人在处理；要转交请让现在的处理人操作 | 错误提示 | [exceptions.ts:94](../../apps/api/src/services/exceptions.ts#L94) |
| `exceptions.3b56d118` | 写死 | 指定的人不存在或没有在用 | 错误提示 | [exceptions.ts:97](../../apps/api/src/services/exceptions.ts#L97) |

## 服务后加收（extra-charges.ts）

文件：`apps/api/src/services/extra-charges.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `extra-charges.6f28b38f` | 写死 | 只有已完成的订单才能加收 | 提示 | [extra-charges.ts:55](../../apps/api/src/services/extra-charges.ts#L55) |
| `extra-charges.f6bdcf16` | 写死 | 服务结束已经超过 {submitWithinHours} 小时，不能再提交加收 | 提示 | [extra-charges.ts:56](../../apps/api/src/services/extra-charges.ts#L56) |
| `extra-charges.35d0d054` | 写死 | 这一单不能收这一项：接送机、点对点是一口价，含高速费和停车费；包车一口价已含高速费、停车费（东京时间 {…} 起下的包车单），只能加收超时、超公里、付费等待、加停靠点、加附加服务 | 提示 | [extra-charges.ts:57](../../apps/api/src/services/extra-charges.ts#L57) |
| `extra-charges.d0651c32` | 写死 | 高速费、停车费要附票据照片 | 提示 | [extra-charges.ts:58](../../apps/api/src/services/extra-charges.ts#L58) |
| `extra-charges.00dd765c` | 写死 | 金额要是大于 0 的整数（最小货币单位） | 提示 | [extra-charges.ts:59](../../apps/api/src/services/extra-charges.ts#L59) |
| `extra-charges.ef91ba43` | 写死 | 单笔加收不能超过这一单的结算价，请核对金额 | 提示 | [extra-charges.ts:60](../../apps/api/src/services/extra-charges.ts#L60) |
| `extra-charges.3aac6db9` | 写死 | 一张单最多 {maxItemsPerOrder} 项加收 | 提示 | [extra-charges.ts:61](../../apps/api/src/services/extra-charges.ts#L61) |
| `extra-charges.0e105d37` | 写死 | 没有收到照片 | 提示 | [extra-charges.ts:73](../../apps/api/src/services/extra-charges.ts#L73) |
| `extra-charges.cd2b77dd` | 写死 | 只能上传 JPEG、PNG、WebP 或 HEIC 格式的照片，且请求头 Content-Type 要和文件一致 | 错误提示 | [extra-charges.ts:77](../../apps/api/src/services/extra-charges.ts#L77) |
| `extra-charges.6a0c26fc` | 写死 | 订单 | 错误提示 | [extra-charges.ts:81](../../apps/api/src/services/extra-charges.ts#L81)、102 行 |
| `extra-charges.7f0d03fd` | 写死 | 订单已取消 | 错误提示 | [extra-charges.ts:83](../../apps/api/src/services/extra-charges.ts#L83) |
| `extra-charges.c765fffb` | 写死 | 凭证要是这一单上传的票据照片（kind=receipt），不能重复 | 提示 | [extra-charges.ts:106](../../apps/api/src/services/extra-charges.ts#L106) |
| `extra-charges.b30f9cde` | 写死 | 加收 | 错误提示 | [extra-charges.ts:143](../../apps/api/src/services/extra-charges.ts#L143)、159、183、202 行 |
| `extra-charges.825e4ff3` | 写死 | 只有异议期内的加收能撤回（异议期截止那一刻起不能） | 错误提示 | [extra-charges.ts:145](../../apps/api/src/services/extra-charges.ts#L145) |
| `extra-charges.0bb65d81` | 写死 | 异议期（提交后 {disputeHours} 小时）已经过了，或这一项已经有结果了 | 错误提示 | [extra-charges.ts:161](../../apps/api/src/services/extra-charges.ts#L161) |
| `extra-charges.e6003ccb` | 写死 | 这一项现在不能这样审核（异议期内的要等异议期结束才能通过；正在扣款、已经扣款或已经审过的不能再审） | 错误提示 | [extra-charges.ts:185](../../apps/api/src/services/extra-charges.ts#L185) |
| `extra-charges.81f02d99` | 写死 | 部分通过的金额要在 1 和提交的金额之间 | 提示 | [extra-charges.ts:188](../../apps/api/src/services/extra-charges.ts#L188) |
| `extra-charges.19a2c5e7` | 写死 | 只有扣款失败的能重试 | 错误提示 | [extra-charges.ts:203](../../apps/api/src/services/extra-charges.ts#L203) |
| `extra-charges.d94d9080` | 写死 | 这一单没有保存下来的支付方式 | 提示 | [extra-charges.ts:229](../../apps/api/src/services/extra-charges.ts#L229) |
| `extra-charges.d281a008` | 写死 | NOZOMI {orderNo} 服务后加收 | 说明 | [extra-charges.ts:245](../../apps/api/src/services/extra-charges.ts#L245) |

## 司机、车辆的业务流程（fleet.ts）

文件：`apps/api/src/services/fleet.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fleet.33456612` | 写死 | 必填 | 提示 | [fleet.ts:45](../../apps/api/src/services/fleet.ts#L45) |
| `fleet.67bbedcb` | 写死 | 太长了 | 文字 | [fleet.ts:46](../../apps/api/src/services/fleet.ts#L46) |
| `fleet.fad2fcd3` | 写死 | 电话要写成带国家码的国际格式，如 +81 90-1234-5678（客人来自不同国家） | 提示 | [fleet.ts:47](../../apps/api/src/services/fleet.ts#L47) |
| `fleet.5c481c0a` | 写死 | 只能是平台支持的语言（ja、zh、en、ko） | 文字 | [fleet.ts:48](../../apps/api/src/services/fleet.ts#L48) |
| `fleet.66b84aeb` | 写死 | 重复了 | 文字 | [fleet.ts:49](../../apps/api/src/services/fleet.ts#L49) |
| `fleet.70fc17a7` | 写死 | 超出范围 | 文字 | [fleet.ts:50](../../apps/api/src/services/fleet.ts#L50) |
| `fleet.3eb9ae97` | 写死 | 非营业牌照的车辆不能设为「可用」（不能收费载客） | 文字 | [fleet.ts:51](../../apps/api/src/services/fleet.ts#L51) |
| `fleet.0e1e6363` | 写死 | 已经有一位司机登记了这个电话 | 错误提示 | [fleet.ts:59](../../apps/api/src/services/fleet.ts#L59) |
| `fleet.033180ae` | 写死 | 已经登记过这个车牌 | 错误提示 | [fleet.ts:63](../../apps/api/src/services/fleet.ts#L63) |
| `fleet.8e9810dc` | 写死 | 司机 | 错误提示 | [fleet.ts:94](../../apps/api/src/services/fleet.ts#L94)、155、178 行 |
| `fleet.52af8436` | 写死 | 车型组不存在 | 提示 | [fleet.ts:222](../../apps/api/src/services/fleet.ts#L222) |
| `fleet.7dae4c34` | 写死 | 车型组已被平台停用 | 提示 | [fleet.ts:223](../../apps/api/src/services/fleet.ts#L223) |
| `fleet.4fc7a57b` | 写死 | 车辆 | 错误提示 | [fleet.ts:232](../../apps/api/src/services/fleet.ts#L232)、269、288 行 |

## 履约回传（fulfilment.ts）

文件：`apps/api/src/services/fulfilment.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fulfilment.7aee7da7` | 写死 | 订单当前的状态不允许这个操作 | 错误提示 | [fulfilment.ts:70](../../apps/api/src/services/fulfilment.ts#L70) |
| `fulfilment.37152892` | 写死 | 这一单在救援改派中或已转给其他供应商，只能查看 | 错误提示 | [fulfilment.ts:75](../../apps/api/src/services/fulfilment.ts#L75) |
| `fulfilment.b8723779` | 写死 | 包车完成时要填实际用了多少分钟 | 提示 | [fulfilment.ts:107](../../apps/api/src/services/fulfilment.ts#L107) |
| `fulfilment.c6c3b489` | 写死 | 包车完成时要填实际跑了多少公里 | 提示 | [fulfilment.ts:108](../../apps/api/src/services/fulfilment.ts#L108) |

## 汇率中心（fx-center.ts）

文件：`apps/api/src/services/fx-center.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx-center.49ef970b` | 写死 | 正在拉取汇率，请稍后再看结果 | 错误提示 | [fx-center.ts:178](../../apps/api/src/services/fx-center.ts#L178) |
| `fx-center.08cde829` | 写死 | 拉取中途中断（进程退出或超时），已作废 | 提示 | [fx-center.ts:181](../../apps/api/src/services/fx-center.ts#L181) |
| `fx-center.26471686` | 写死 | 取汇率时出错 | 文字 | [fx-center.ts:194](../../apps/api/src/services/fx-center.ts#L194) |
| `fx-center.6bc8a1d8` | 写死 | 数据源给的这批（{asOf}）比现在用的那批还旧 | 提示 | [fx-center.ts:248](../../apps/api/src/services/fx-center.ts#L248) |
| `fx-center.fa780a3f` | 写死 | 和挂起待确认的那批相同 | 提示 | [fx-center.ts:251](../../apps/api/src/services/fx-center.ts#L251) |
| `fx-center.3babfda5` | 写死 | 被更新的一批取代 | 文字 | [fx-center.ts:255](../../apps/api/src/services/fx-center.ts#L255) |
| `fx-center.2218bcbd` | 写死 | {…} 变动超过 {…}%，等待人工确认 | 提示 | [fx-center.ts:257](../../apps/api/src/services/fx-center.ts#L257) |
| `fx-center.55380c28` | 写死 | 这批汇率已经比现在用的旧，不能再确认 | 错误提示 | [fx-center.ts:270](../../apps/api/src/services/fx-center.ts#L270) |
| `fx-center.b91f7fc6` | 写死 | 这次拉取记录不存在 | 错误提示 | [fx-center.ts:297](../../apps/api/src/services/fx-center.ts#L297) |
| `fx-center.d0cde676` | 写死 | 这次拉取没有挂起待确认的汇率 | 错误提示 | [fx-center.ts:298](../../apps/api/src/services/fx-center.ts#L298) |

## 汇率人工锁定（fx-locks.ts）

文件：`apps/api/src/services/fx-locks.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx-locks.6b04bfd0` | 写死 | {base} 是基准币种（恒等于 1），不能锁定 | 文字 | [fx-locks.ts:35](../../apps/api/src/services/fx-locks.ts#L35) |
| `fx-locks.16c46591` | 写死 | 不是平台支持的币种 | 文字 | [fx-locks.ts:36](../../apps/api/src/services/fx-locks.ts#L36) |
| `fx-locks.bb012036` | 写死 | 锁定值要写成大于 0 的十进制数（如 151.2），不带正负号、千分位、指数；整数、小数各最多 {maxIntegerDigits} 位 | 提示 | [fx-locks.ts:37](../../apps/api/src/services/fx-locks.ts#L37) |
| `fx-locks.5d2b5207` | 写死 | 到期时间离现在至少 {minMinutes} 分钟 | 文字 | [fx-locks.ts:38](../../apps/api/src/services/fx-locks.ts#L38) |
| `fx-locks.2d93ebb3` | 写死 | 锁定最长 {maxHours} 小时 | 文字 | [fx-locks.ts:39](../../apps/api/src/services/fx-locks.ts#L39) |
| `fx-locks.40854ed8` | 写死 | 锁定值和现在的中央汇率相差超过 {…}%，请写明原因 | 提示 | [fx-locks.ts:40](../../apps/api/src/services/fx-locks.ts#L40) |
| `fx-locks.e54fa281` | 写死 | 锁定值和现在的中央汇率相差超过 {…}%，系统不允许；请核对币种和数量级 | 文字 | [fx-locks.ts:41](../../apps/api/src/services/fx-locks.ts#L41) |
| `fx-locks.44f8b550` | 写死 | 到期时间已经过了 | 提示 | [fx-locks.ts:47](../../apps/api/src/services/fx-locks.ts#L47) |
| `fx-locks.0e828a70` | 写死 | 还没有汇率，无法和中央汇率比对；请先拉取汇率 | 错误提示 | [fx-locks.ts:52](../../apps/api/src/services/fx-locks.ts#L52) |
| `fx-locks.d4cec9d7` | 写死 | 发起之后 {currency} 的锁定已经解除或到期了；请驳回，按现在的情况重新发起 | 文字 | [fx-locks.ts:109](../../apps/api/src/services/fx-locks.ts#L109) |
| `fx-locks.dd6e5af0` | 写死 | 发起之后 {currency} 已经有了另一条锁定（可能是别的复核先批准了）；请驳回，按现在的锁定重新发起 | 文字 | [fx-locks.ts:109](../../apps/api/src/services/fx-locks.ts#L109) |
| `fx-locks.35ab6a33` | 写死 | 要解除的这条锁定已经到期、解除或被新的锁定取代了；请驳回 | 文字 | [fx-locks.ts:147](../../apps/api/src/services/fx-locks.ts#L147) |
| `fx-locks.7d08631a` | 写死 | 和现在的锁定一样，不用发起 | 提示 | [fx-locks.ts:178](../../apps/api/src/services/fx-locks.ts#L178) |
| `fx-locks.9bc69524` | 写死 | 锁定 {currency} 汇率：{target}（中央汇率 {rate}，偏离 {…}），到 {…} | 说明 | [fx-locks.ts:183](../../apps/api/src/services/fx-locks.ts#L183) |
| `fx-locks.ecb8ed13` | 写死 | 改 {currency} 的锁定：1 {base} = {rate} → {rate} {currency}（中央汇率 {rate}，偏离 {…}），到 {…} | 说明 | [fx-locks.ts:184](../../apps/api/src/services/fx-locks.ts#L184) |
| `fx-locks.029c2136` | 写死 | 锁定记录 | 错误提示 | [fx-locks.ts:212](../../apps/api/src/services/fx-locks.ts#L212) |
| `fx-locks.9dc67a5a` | 写死 | 这条锁定已经结束（到期、解除或被取代），不用再解锁 | 错误提示 | [fx-locks.ts:214](../../apps/api/src/services/fx-locks.ts#L214) |
| `fx-locks.3a086b08` | 写死 | 解除 {currency} 的锁定（1 {base} = {rate} {currency}，原定到 {…}），恢复用中央汇率 {rate} | 说明 | [fx-locks.ts:220](../../apps/api/src/services/fx-locks.ts#L220) |

## 价格规则和库存的 Excel 批量导入导出（import-export.ts）

文件：`apps/api/src/services/import-export.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `import-export.5e6942ed` | 写死 | 这个文件读不了：{message}。请用下载的模版填写后另存为 .xlsx 再上传 | 错误提示 | [import-export.ts:71](../../apps/api/src/services/import-export.ts#L71) |
| `import-export.60278829` | 写死 | 文件是空的：第一行应当是表头。请用下载的模版填写 | 错误提示 | [import-export.ts:101](../../apps/api/src/services/import-export.ts#L101) |
| `import-export.a5a50897` | 写死 | 表头里缺少这些列：{…}。请用下载的模版填写，不要改第一行 | 错误提示 | [import-export.ts:104](../../apps/api/src/services/import-export.ts#L104) |
| `import-export.98cb14a3` | 写死 | 这一格是公式。请把它改成数值（复制后「选择性粘贴 → 值」） | 提示 | [import-export.ts:136](../../apps/api/src/services/import-export.ts#L136) |
| `import-export.3d180dca` | 写死 | 必填 | 文字 | [import-export.ts:145](../../apps/api/src/services/import-export.ts#L145)、635、678 行 |
| `import-export.7f3cb6d4` | 写死 | 这一格是逻辑值 {text}，不是数字。{hint} | 文字 | [import-export.ts:155](../../apps/api/src/services/import-export.ts#L155) |
| `import-export.20d8e85c` | 写死 | 这一格是错误值 {text}，不是数字。{hint} | 文字 | [import-export.ts:156](../../apps/api/src/services/import-export.ts#L156) |
| `import-export.0339c91a` | 写死 | 必须是整数 | 文字 | [import-export.ts:160](../../apps/api/src/services/import-export.ts#L160) |
| `import-export.097271e1` | 写死 | 不是合法的日期，请写成 2026-10-01 这样（不要带时间） | 说明 | [import-export.ts:165](../../apps/api/src/services/import-export.ts#L165) |
| `import-export.ea51bbb1` | 写死 | 价格编号 | 文字 | [import-export.ts:179](../../apps/api/src/services/import-export.ts#L179) |
| `import-export.72a4ac57` | 写死 | 区域 | 文字 | [import-export.ts:180](../../apps/api/src/services/import-export.ts#L180) |
| `import-export.eaeb2991` | 写死 | 下车区域 | 文字 | [import-export.ts:182](../../apps/api/src/services/import-export.ts#L182) |
| `import-export.3503f996` | 写死 | 车型组 | 文字 | [import-export.ts:183](../../apps/api/src/services/import-export.ts#L183) |
| `import-export.eb3eacba` | 写死 | 方向 | 文字 | [import-export.ts:184](../../apps/api/src/services/import-export.ts#L184) |
| `import-export.e6ee1a2f` | 写死 | 套餐时长(小时) | 文字 | [import-export.ts:185](../../apps/api/src/services/import-export.ts#L185) |
| `import-export.a16107bf` | 写死 | 计价方式 | 文字 | [import-export.ts:186](../../apps/api/src/services/import-export.ts#L186) |
| `import-export.977e9132` | 写死 | 基础价 | 文字 | [import-export.ts:187](../../apps/api/src/services/import-export.ts#L187) |
| `import-export.adf2c388` | 写死 | 起步价 | 文字 | [import-export.ts:188](../../apps/api/src/services/import-export.ts#L188) |
| `import-export.cebf6de1` | 写死 | 起步里程(公里) | 文字 | [import-export.ts:189](../../apps/api/src/services/import-export.ts#L189) |
| `import-export.f73487b5` | 写死 | 起步时长(分钟) | 文字 | [import-export.ts:190](../../apps/api/src/services/import-export.ts#L190) |
| `import-export.77b0dfd4` | 写死 | 每公里单价 | 文字 | [import-export.ts:191](../../apps/api/src/services/import-export.ts#L191) |
| `import-export.c09b8498` | 写死 | 每分钟单价 | 文字 | [import-export.ts:192](../../apps/api/src/services/import-export.ts#L192) |
| `import-export.5905c944` | 写死 | 最低消费 | 文字 | [import-export.ts:193](../../apps/api/src/services/import-export.ts#L193) |
| `import-export.a1e4abc9` | 写死 | 含公里数 | 文字 | [import-export.ts:195](../../apps/api/src/services/import-export.ts#L195) |
| `import-export.51eff122` | 写死 | 超出每公里 | 文字 | [import-export.ts:196](../../apps/api/src/services/import-export.ts#L196) |
| `import-export.dc5139c4` | 写死 | 套餐公里 | 文字 | [import-export.ts:197](../../apps/api/src/services/import-export.ts#L197) |
| `import-export.b4372691` | 写死 | 套餐价 | 文字 | [import-export.ts:198](../../apps/api/src/services/import-export.ts#L198) |
| `import-export.4fc8ae46` | 写死 | 超时单价(每小时) | 文字 | [import-export.ts:199](../../apps/api/src/services/import-export.ts#L199) |
| `import-export.f74675ef` | 写死 | 超公里单价(每公里) | 文字 | [import-export.ts:200](../../apps/api/src/services/import-export.ts#L200) |
| `import-export.510409d7` | 写死 | 上车加价 | 文字 | [import-export.ts:202](../../apps/api/src/services/import-export.ts#L202) |
| `import-export.7af6e9b5` | 写死 | 下车加价 | 文字 | [import-export.ts:203](../../apps/api/src/services/import-export.ts#L203) |
| `import-export.f411a2fc` | 写死 | 途经加价 | 文字 | [import-export.ts:204](../../apps/api/src/services/import-export.ts#L204) |
| `import-export.e461de9c` | 写死 | 行程加价 | 文字 | [import-export.ts:206](../../apps/api/src/services/import-export.ts#L206) |
| `import-export.5df328cb` | 写死 | 机场场景 | 文字 | [import-export.ts:208](../../apps/api/src/services/import-export.ts#L208) |
| `import-export.f8123c11` | 写死 | 生效开始 | 文字 | [import-export.ts:209](../../apps/api/src/services/import-export.ts#L209) |
| `import-export.e276d061` | 写死 | 生效结束 | 文字 | [import-export.ts:210](../../apps/api/src/services/import-export.ts#L210) |
| `import-export.4c612141` | 写死 | 状态 | 文字 | [import-export.ts:211](../../apps/api/src/services/import-export.ts#L211) |
| `import-export.42ddb20b` | 写死 | 机场开始 | 文字 | [import-export.ts:222](../../apps/api/src/services/import-export.ts#L222) |
| `import-export.64f0767c` | 写死 | 机场结束 | 文字 | [import-export.ts:222](../../apps/api/src/services/import-export.ts#L222) |
| `import-export.a6a1bee9` | 写死 | 价格 | 文字 | [import-export.ts:225](../../apps/api/src/services/import-export.ts#L225) |
| `import-export.50c8491d` | 写死 | 启用 | 文字 | [import-export.ts:227](../../apps/api/src/services/import-export.ts#L227) |
| `import-export.605910a6` | 写死 | 停用 | 文字 | [import-export.ts:227](../../apps/api/src/services/import-export.ts#L227) |
| `import-export.0b338e3c` | 写死 | 这一格只能填整数，请去掉小数 | 文字 | [import-export.ts:277](../../apps/api/src/services/import-export.ts#L277) |
| `import-export.103a4b1c` | 写死 | 「生效结束」不能早于「生效开始」，请改其中一个 | 文字 | [import-export.ts:278](../../apps/api/src/services/import-export.ts#L278) |
| `import-export.4af6b9f6` | 写死 | 不是合法的日期，请写成 2026-10-01 这样 | 提示 | [import-export.ts:279](../../apps/api/src/services/import-export.ts#L279) |
| `import-export.c4331c78` | 写死 | 这一格必填 | 提示 | [import-export.ts:280](../../apps/api/src/services/import-export.ts#L280) |
| `import-export.4a019b39` | 写死 | 这个商品的品类不填这一列，请留空 | 文字 | [import-export.ts:281](../../apps/api/src/services/import-export.ts#L281) |
| `import-export.e4192348` | 写死 | 这个商品的品类不能用这种计价方式，请按「填写说明」里列出的填 | 文字 | [import-export.ts:282](../../apps/api/src/services/import-export.ts#L282) |
| `import-export.59312050` | 写死 | 这个区域是商品的基础价区域（服务区域），在这里上下车不加价，不能再设上下车加价。请填商品区域以外的区域 | 文字 | [import-export.ts:283](../../apps/api/src/services/import-export.ts#L283) |
| `import-export.dda0c25f` | 写死 | 区域加价只能用业务类型是包车或「通用」的区域 | 文字 | [import-export.ts:284](../../apps/api/src/services/import-export.ts#L284) |
| `import-export.5fadc69f` | 写死 | 这个区域已停用，不能新设区域加价 | 文字 | [import-export.ts:285](../../apps/api/src/services/import-export.ts#L285) |
| `import-export.ce06684f` | 写死 | 「下车区域」不能和「区域」相同；同一个区域里的单用区域价，「下车区域」留空 | 文字 | [import-export.ts:286](../../apps/api/src/services/import-export.ts#L286) |
| `import-export.0c515b99` | 写死 | 这个商品还没有迁移到三层区域：不能设行程加价、整商品套餐价或不分套餐的加价 | 文字 | [import-export.ts:287](../../apps/api/src/services/import-export.ts#L287) |
| `import-export.25bdeb9f` | 写死 | 这是迁移前的旧数据（只读）：套餐价按车型组 × 套餐填一次（「区域」留空），经停加价填在「行程加价」里 | 文字 | [import-export.ts:288](../../apps/api/src/services/import-export.ts#L288) |
| `import-export.76e91175` | 写死 | 这个区域在商品的「机场套餐」里没有绑定这个机场场景：先在商品里绑定机场区域，再导入机场套餐价 | 提示 | [import-export.ts:289](../../apps/api/src/services/import-export.ts#L289) |
| `import-export.8c1c9706` | 写死 | 金额不能是负数，最多 {…} {currency}。请检查是不是多打了位数 | 提示 | [import-export.ts:294](../../apps/api/src/services/import-export.ts#L294) |
| `import-export.83f7b043` | 写死 | 含公里数请填 1 到 {…} 之间的整数 | 提示 | [import-export.ts:297](../../apps/api/src/services/import-export.ts#L297) |
| `import-export.b50635ea` | 写死 | 含公里数和超出每公里要一起填，或者都不填 | 提示 | [import-export.ts:298](../../apps/api/src/services/import-export.ts#L298) |
| `import-export.e6b45df9` | 写死 | 套餐时长要在 1 到 {maxPackageHours} 小时之间 | 提示 | [import-export.ts:303](../../apps/api/src/services/import-export.ts#L303) |
| `import-export.63457c24` | 写死 | 套餐公里要在 1 到 {maxPackageKm} 之间 | 提示 | [import-export.ts:304](../../apps/api/src/services/import-export.ts#L304) |
| `import-export.981cc596` | 写死 | 起步里程要在 0 到 {…} 公里之间，最多 1 位小数 | 提示 | [import-export.ts:305](../../apps/api/src/services/import-export.ts#L305) |
| `import-export.ede7cc0e` | 写死 | 起步时长要在 0 到 {maxStartMinutes} 分钟之间 | 提示 | [import-export.ts:306](../../apps/api/src/services/import-export.ts#L306) |
| `import-export.26e14ee0` | 写死 | 大于 0 | 提示 | [import-export.ts:308](../../apps/api/src/services/import-export.ts#L308) |
| `import-export.466ddbad` | 写死 | 不小于 0 | 提示 | [import-export.ts:308](../../apps/api/src/services/import-export.ts#L308) |
| `import-export.6dcccff0` | 写死 | 金额要{…}，最多 {…} {currency}。请检查是不是多打或少打了位数 | 提示 | [import-export.ts:308](../../apps/api/src/services/import-export.ts#L308) |
| `import-export.20795855` | 写死 | 填写说明 | 说明 | [import-export.ts:394](../../apps/api/src/services/import-export.ts#L394)、443、897、903 行 |
| `import-export.5e3a98d7` | 写死 | 最多 {digits} 位小数 | 说明 | [import-export.ts:395](../../apps/api/src/services/import-export.ts#L395) |
| `import-export.75c910d0` | 写死 | 只能填整数 | 说明 | [import-export.ts:395](../../apps/api/src/services/import-export.ts#L395) |
| `import-export.97d2d0a9` | 写死 | 商品 {code}；金额的币种是 {currency}，{…}。这些都是你的结算价。 | 说明 | [import-export.ts:395](../../apps/api/src/services/import-export.ts#L395) |
| `import-export.abbcafb7` | 写死 | 第一行是表头，不要改。每一行是一条价格；一次最多 500 行。 | 说明 | [import-export.ts:396](../../apps/api/src/services/import-export.ts#L396) |
| `import-export.a3e45a21` | 写死 | 「{id}」：导出的行带着它，留着 = 修改这一条；新增的行留空。这里不能删除价格（请在页面上删）。 | 说明 | [import-export.ts:397](../../apps/api/src/services/import-export.ts#L397) |
| `import-export.8d49eb66` | 写死 | 「{area}」填区域的名称，「{group}」填车型组的编码，只能用下面列出的。 | 说明 | [import-export.ts:398](../../apps/api/src/services/import-export.ts#L398) |
| `import-export.59f70145` | 写死 | 日期写成 2026-10-01；「生效结束」留空 = 一直有效。两头的日期都算在内，同一个组合的日期不能重叠。 | 说明 | [import-export.ts:399](../../apps/api/src/services/import-export.ts#L399) |
| `import-export.20b48224` | 写死 | 「{status}」填 启用 或 停用，留空 = 启用。 | 说明 | [import-export.ts:400](../../apps/api/src/services/import-export.ts#L400) |
| `import-export.b6201ad4` | 写死 | 套餐价：「{area}」留空（整个商品统一一个价，按车型组 × 套餐填一次），填「{packageHours}」「{packageKm}」「{packagePrice}」「{overtime}」「{overKm}」。 | 说明 | [import-export.ts:403](../../apps/api/src/services/import-export.ts#L403) |
| `import-export.186d34a7` | 写死 | 上下车加价：「{area}」填上下车加价区域（下面列出的），填「{pickupSurcharge}」「{dropoffSurcharge}」（可以填 0），套餐价那几列留空。上车点、下车点在这个区域时分别加这么多。 | 说明 | [import-export.ts:404](../../apps/api/src/services/import-export.ts#L404) |
| `import-export.ef50640e` | 写死 | 行程加价：「{area}」填行程区域（可以是商品的服务区域），只填「{itinerarySurcharge}」（可以填 0）。客人的经停点落在这个区域时加一次，同一区域一单只加一次。 | 说明 | [import-export.ts:405](../../apps/api/src/services/import-export.ts#L405) |
| `import-export.bce988c0` | 写死 | 两种加价的「{packageHours}」可以留空 = 这个车型组的所有套餐；填了只管这一档（同一区域先用填了套餐的那条）。没设 = 不报价，不加钱请填 0。 | 说明 | [import-export.ts:406](../../apps/api/src/services/import-export.ts#L406) |
| `import-export.4ae0b2ba` | 写死 | 机场套餐价：「{airportScenario}」填 {…}，「{area}」填商品「机场套餐」里绑定的机场区域，填「{packageHours}」「{packagePrice}」；「{packageKm}」「{overtime}」「{overKm}」留空 = 同普通套餐。没有这一行 = 继承（普通套餐价 + 这一端的机场加价）。 | 说明 | [import-export.ts:407](../../apps/api/src/services/import-export.ts#L407) |
| `import-export.8c256bbe` | 写死 |  或  | 文字 | [import-export.ts:407](../../apps/api/src/services/import-export.ts#L407)、418 行 |
| `import-export.7f380a1f` | 写死 | 这是迁移到三层区域之后的模版：迁移前的旧模版（有「{waypointSurcharge}」列）不能再导入，请重新下载。 | 说明 | [import-export.ts:408](../../apps/api/src/services/import-export.ts#L408) |
| `import-export.101944af` | 写死 | 包车：每一行要填「{packageHours}」「{packageKm}」「{packagePrice}」「{overtime}」「{overKm}」。 | 说明 | [import-export.ts:412](../../apps/api/src/services/import-export.ts#L412) |
| `import-export.d19dfeda` | 写死 | 区域加价：「{area}」填加价区域（下面列出的），填「{packageHours}」「{pickupSurcharge}」「{dropoffSurcharge}」（可以填 0），「{packageKm}」「{packagePrice}」「{overtime}」「{overKm}」留空。上车点、下车点在这个区域时分别加这么多。 | 说明 | [import-export.ts:413](../../apps/api/src/services/import-export.ts#L413) |
| `import-export.79b253a9` | 写死 | 「{waypointSurcharge}」可以留空：客人的途经景点（经停点）落在这个区域时加这么多，同一区域一单只加一次；上车或下车已经在这个区域的不再加。留空 = 这个区域对途经景点没有价格（只落在这个区域的途经景点报不出价），不加钱请填 0。 | 说明 | [import-export.ts:414](../../apps/api/src/services/import-export.ts#L414) |
| `import-export.b1e2f5f7` | 写死 | 旧模版没有「{pickupSurcharge}」「{dropoffSurcharge}」「{waypointSurcharge}」这几列也能导入（没有区域加价的列只导入套餐价；没有「{waypointSurcharge}」列的区域加价没有途经加价）。 | 说明 | [import-export.ts:415](../../apps/api/src/services/import-export.ts#L415) |
| `import-export.a3197b85` | 写死 | 「{model}」填 {…}。 | 说明 | [import-export.ts:418](../../apps/api/src/services/import-export.ts#L418) |
| `import-export.4ec71911` | 写死 | {fixed}：只填「{basePrice}」。{mileage\_time}：填「{startPrice}」「{startKm}」「{startMinutes}」「{perKm}」「{perMinute}」，「{minPrice}」可以不填。用不到的列留空。 | 说明 | [import-export.ts:419](../../apps/api/src/services/import-export.ts#L419) |
| `import-export.4867d301` | 写死 | 线路价：「{toArea}」填下车区域（下面列出的、和「{area}」不同），只管从「{area}」上车、到「{toArea}」下车的单（单向；返程另起一行）。「{toArea}」留空 = 区域价。 | 说明 | [import-export.ts:422](../../apps/api/src/services/import-export.ts#L422) |
| `import-export.68e4de7e` | 写死 | {fixed}可以再填「{includedKm}」（1 到 {maxIncludedKm} 的整数）和「{overKmPerKm}」（可以填 0），两列要么都填、要么都不填：报价时按路线距离，超出的公里（不足 1 公里按 1 公里）× 超出每公里加进一口价。 | 说明 | [import-export.ts:423](../../apps/api/src/services/import-export.ts#L423) |
| `import-export.f38567e9` | 写死 | 旧模版没有「{toArea}」「{includedKm}」「{overKmPerKm}」三列也能导入（都按留空）。 | 说明 | [import-export.ts:424](../../apps/api/src/services/import-export.ts#L424) |
| `import-export.81fc566b` | 写死 | 「{direction}」填 {…}。 | 说明 | [import-export.ts:428](../../apps/api/src/services/import-export.ts#L428) |
| `import-export.0abcd489` | 写死 | 可以填的区域 | 说明 | [import-export.ts:430](../../apps/api/src/services/import-export.ts#L430) |
| `import-export.3c99fcbd` | 写死 | 可以填的加价区域（区域加价用） | 说明 | [import-export.ts:433](../../apps/api/src/services/import-export.ts#L433) |
| `import-export.a2fb8820` | 写死 | 可以填的车型组（编码） | 说明 | [import-export.ts:436](../../apps/api/src/services/import-export.ts#L436) |
| `import-export.ca7654e0` | 写死 | 名称 | 说明 | [import-export.ts:436](../../apps/api/src/services/import-export.ts#L436) |
| `import-export.4b60ab08` | 写死 | 这个商品已经迁移到三层区域，这是迁移前的旧模版（有「{waypointSurcharge}」列）。请重新下载模版：经停加价填在「{itinerarySurcharge}」里，套餐价的「{area}」留空 | 错误提示 | [import-export.ts:539](../../apps/api/src/services/import-export.ts#L539) |
| `import-export.a871df8f` | 写死 | 一次最多导入 {maxPriceRows} 行，这个文件有 {length} 行。请分几次导入 | 错误提示 | [import-export.ts:542](../../apps/api/src/services/import-export.ts#L542) |
| `import-export.bd4fbc4d` | 写死 | 这个编号不是这个商品的价格。新增的行请把这一格留空 | 文字 | [import-export.ts:572](../../apps/api/src/services/import-export.ts#L572) |
| `import-export.bb17abb4` | 写死 | 同一个价格编号在文件里出现了两次 | 文字 | [import-export.ts:573](../../apps/api/src/services/import-export.ts#L573) |
| `import-export.e50aac37` | 写死 | 迁移到三层区域之后，套餐价按车型组 × 套餐填一次：「区域」请留空 | 文字 | [import-export.ts:583](../../apps/api/src/services/import-export.ts#L583) |
| `import-export.fbc06083` | 写死 | 这是运营区域，不带价格：加价只能挂在报价区域（或「运营 + 报价」的区域）上 | 文字 | [import-export.ts:589](../../apps/api/src/services/import-export.ts#L589) |
| `import-export.a5e231e5` | 写死 | 有不止一个区域叫这个名字，请先在区域页面把名字改得不一样 | 文字 | [import-export.ts:591](../../apps/api/src/services/import-export.ts#L591)、601 行 |
| `import-export.0d0a4a61` | 写死 | 没有叫这个名字的区域（加价区域见「填写说明」里列出的） | 文字 | [import-export.ts:592](../../apps/api/src/services/import-export.ts#L592) |
| `import-export.8680b40c` | 写死 | 这个商品没有选叫这个名字的区域（见「填写说明」里列出的） | 文字 | [import-export.ts:593](../../apps/api/src/services/import-export.ts#L593)、602 行 |
| `import-export.5b5f6f13` | 写死 | 这个商品没有选这个编码的车型组（见「填写说明」里列出的） | 文字 | [import-export.ts:609](../../apps/api/src/services/import-export.ts#L609) |
| `import-export.4411231d` | 写死 | 只能填：{…} | 文字 | [import-export.ts:616](../../apps/api/src/services/import-export.ts#L616) |
| `import-export.67303b1b` | 写死 | 必须是数字（只填数字，不带币种符号） | 说明 | [import-export.ts:620](../../apps/api/src/services/import-export.ts#L620) |
| `import-export.68949d7b` | 写死 | {currency} 的金额只能是整数 | 文字 | [import-export.ts:624](../../apps/api/src/services/import-export.ts#L624) |
| `import-export.fbfda36c` | 写死 | {currency} 的金额最多 {…} 位小数 | 文字 | [import-export.ts:624](../../apps/api/src/services/import-export.ts#L624) |
| `import-export.509af121` | 写死 | 这种计价方式不填这一列，请留空 | 文字 | [import-export.ts:630](../../apps/api/src/services/import-export.ts#L630) |
| `import-export.25d28a29` | 写死 | 机场套餐价的行不填这一列，请留空（加价另起一行） | 文字 | [import-export.ts:646](../../apps/api/src/services/import-export.ts#L646) |
| `import-export.030e6acf` | 写死 | 行程加价的行不填这一列，请留空（套餐价、上下车加价另起一行） | 文字 | [import-export.ts:656](../../apps/api/src/services/import-export.ts#L656) |
| `import-export.84b6104f` | 写死 | 上下车加价的行不填这一列，请留空（套餐价另起一行） | 文字 | [import-export.ts:662](../../apps/api/src/services/import-export.ts#L662) |
| `import-export.b0a2027a` | 写死 | 必须是数字 | 说明 | [import-export.ts:696](../../apps/api/src/services/import-export.ts#L696) |
| `import-export.33972faf` | 写死 | 起步里程最多 1 位小数（精确到 0.1 公里） | 文字 | [import-export.ts:702](../../apps/api/src/services/import-export.ts#L702) |
| `import-export.14916809` | 写死 | 起步里程要在 0 到 {maxKm} 公里之间 | 文字 | [import-export.ts:703](../../apps/api/src/services/import-export.ts#L703) |
| `import-export.95d4509d` | 写死 | 这个品类不能用包车套餐 | 文字 | [import-export.ts:708](../../apps/api/src/services/import-export.ts#L708) |
| `import-export.b882b493` | 写死 | 「{a}」和「{b}」重叠约 {overlap\_km2} 平方公里：同一个商品同一层的区域不能重叠。请先在区域页面切掉重叠的部分，再导入 | 提示 | [import-export.ts:811](../../apps/api/src/services/import-export.ts#L811) |
| `import-export.2a2a3876` | 写死 | 基础价区域「{a}」和上下车加价的区域「{b}」重叠约 {overlap\_km2} 平方公里：在基础价区域里上下车不加价，两者不能重叠。请先在区域页面切掉重叠的部分，再导入 | 提示 | [import-export.ts:812](../../apps/api/src/services/import-export.ts#L812) |
| `import-export.1cd22fb7` | 写死 | 这次上传的文件和预览时的不是同一份（内容变了）。请重新上传预览，确认结果后再导入 | 错误提示 | [import-export.ts:839](../../apps/api/src/services/import-export.ts#L839) |
| `import-export.1092e40c` | 写死 | 文件里有 {error} 行出错、{conflict} 行冲突，没有导入。请看下面每一行的说明，改好后重新上传 | 错误提示 | [import-export.ts:844](../../apps/api/src/services/import-export.ts#L844) |
| `import-export.ab0068e9` | 写死 | 文件里没有要新增或修改的内容，不用导入 | 错误提示 | [import-export.ts:844](../../apps/api/src/services/import-export.ts#L844) |
| `import-export.490f0e23` | 写死 | 可售单数 | 文字 | [import-export.ts:881](../../apps/api/src/services/import-export.ts#L881) |
| `import-export.9eea0aa5` | 写死 | 日期 | 文字 | [import-export.ts:881](../../apps/api/src/services/import-export.ts#L881) |
| `import-export.14a26f24` | 写死 | 库存 | 文字 | [import-export.ts:882](../../apps/api/src/services/import-export.ts#L882) |
| `import-export.e14f5c32` | 写死 | 最远只能设到 {maxDaysAhead} 天以后，请删掉这一行 | 文字 | [import-export.ts:883](../../apps/api/src/services/import-export.ts#L883) |
| `import-export.950fd5f9` | 写死 | 要给合法的开始和结束日期，最多 {maxRangeDays} 天 | 提示 | [import-export.ts:888](../../apps/api/src/services/import-export.ts#L888) |
| `import-export.6f37d708` | 写死 | 商品 {code} 的每日库存（按城市当地的用车日期）。 | 说明 | [import-export.ts:898](../../apps/api/src/services/import-export.ts#L898) |
| `import-export.477f7be2` | 写死 | 第一行是表头，不要改。每一行是一天；「可售单数」填 0 到 9999 的整数。 | 说明 | [import-export.ts:899](../../apps/api/src/services/import-export.ts#L899) |
| `import-export.c96b4ace` | 写死 | 填 0 = 这一天停售；留空 = 清除（限量模式下没设的日子不可售）。 | 说明 | [import-export.ts:900](../../apps/api/src/services/import-export.ts#L900) |
| `import-export.1d83a8c9` | 写死 | 只能改今天和以后的日子；已经有订单占着的日子，不能改到占用数以下。一次最多 366 行。 | 说明 | [import-export.ts:901](../../apps/api/src/services/import-export.ts#L901) |
| `import-export.bd01d586` | 写死 | 一次最多导入 {maxInventoryRows} 行，这个文件有 {length} 行 | 错误提示 | [import-export.ts:933](../../apps/api/src/services/import-export.ts#L933) |
| `import-export.5c132ace` | 写死 | 同一天在文件里出现了两次，请只留一行 | 文字 | [import-export.ts:948](../../apps/api/src/services/import-export.ts#L948) |
| `import-export.d88180ba` | 写死 | 要填 0 到 {maxDailyTotal} 的整数 | 文字 | [import-export.ts:952](../../apps/api/src/services/import-export.ts#L952) |
| `import-export.3475e2f9` | 写死 | 这一天已经过去了，库存不能再改。请把这一行改回原来的数，或者删掉这一行 | 提示 | [import-export.ts:969](../../apps/api/src/services/import-export.ts#L969) |
| `import-export.d92925ae` | 写死 | 这一天已经有 {occupied} 单占着库存，不能改到它以下，也不能清除 | 提示 | [import-export.ts:974](../../apps/api/src/services/import-export.ts#L974) |

## 运营后台填写的第三方密钥（integration-secrets.ts）

文件：`apps/api/src/services/integration-secrets.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `integration-secrets.29adacac` | 写死 | 读取运营后台填写的第三方密钥失败，先沿用之前的值 | 文字 | [integration-secrets.ts:173](../../apps/api/src/services/integration-secrets.ts#L173) |
| `integration-secrets.7a4d78fe` | 写死 | 谷歌地图 | 文字 | [integration-secrets.ts:255](../../apps/api/src/services/integration-secrets.ts#L255) |
| `integration-secrets.86059dde` | 写死 | 邮件发送 | 文字 | [integration-secrets.ts:255](../../apps/api/src/services/integration-secrets.ts#L255) |
| `integration-secrets.c064e039` | 写死 | Stripe 支付 | 文字 | [integration-secrets.ts:255](../../apps/api/src/services/integration-secrets.ts#L255) |
| `integration-secrets.cb8dc85c` | 写死 | Claude（AI 行程解析） | 文字 | [integration-secrets.ts:255](../../apps/api/src/services/integration-secrets.ts#L255) |
| `integration-secrets.1678e65b` | 写死 | API 密钥 | 名称 | [integration-secrets.ts:258](../../apps/api/src/services/integration-secrets.ts#L258) |
| `integration-secrets.66e8ef8c` | 写死 | API 密钥（sk-ant- 开头） | 名称 | [integration-secrets.ts:259](../../apps/api/src/services/integration-secrets.ts#L259) |
| `integration-secrets.48144ca3` | 写死 | Secret key（sk\_ 开头） | 名称 | [integration-secrets.ts:261](../../apps/api/src/services/integration-secrets.ts#L261) |
| `integration-secrets.b4540d2d` | 写死 | Publishable key（pk\_ 开头） | 名称 | [integration-secrets.ts:262](../../apps/api/src/services/integration-secrets.ts#L262) |
| `integration-secrets.db963451` | 写死 | Webhook signing secret（whsec\_ 开头） | 名称 | [integration-secrets.ts:263](../../apps/api/src/services/integration-secrets.ts#L263) |
| `integration-secrets.ad379b55` | 写死 | SMTP 主机 | 名称 | [integration-secrets.ts:266](../../apps/api/src/services/integration-secrets.ts#L266) |
| `integration-secrets.863b971e` | 写死 | 端口（25、465、587、2525） | 名称 | [integration-secrets.ts:267](../../apps/api/src/services/integration-secrets.ts#L267) |
| `integration-secrets.99b5843b` | 写死 | 加密方式 | 名称 | [integration-secrets.ts:268](../../apps/api/src/services/integration-secrets.ts#L268) |
| `integration-secrets.eff932a8` | 写死 | 用户名 | 名称 | [integration-secrets.ts:269](../../apps/api/src/services/integration-secrets.ts#L269) |
| `integration-secrets.b4ee8064` | 写死 | 密码 | 名称 | [integration-secrets.ts:270](../../apps/api/src/services/integration-secrets.ts#L270) |
| `integration-secrets.37bbccea` | 写死 | 发件人名称 | 名称 | [integration-secrets.ts:271](../../apps/api/src/services/integration-secrets.ts#L271) |
| `integration-secrets.c57cc944` | 写死 | 发件人地址 | 名称 | [integration-secrets.ts:272](../../apps/api/src/services/integration-secrets.ts#L272) |
| `integration-secrets.e639b615` | 写死 | 必填（Stripe 的三项要一起填） | 提示 | [integration-secrets.ts:277](../../apps/api/src/services/integration-secrets.ts#L277) |
| `integration-secrets.095c1fe7` | 写死 | 只能有英文字母、数字、下划线和连字符，请检查复制时是否带进了空格或别的字符 | 文字 | [integration-secrets.ts:278](../../apps/api/src/services/integration-secrets.ts#L278) |
| `integration-secrets.638c67e8` | 写死 | 太短了，请检查是否复制完整 | 文字 | [integration-secrets.ts:279](../../apps/api/src/services/integration-secrets.ts#L279) |
| `integration-secrets.713081a2` | 写死 | 太长了，请检查是否多复制了内容 | 文字 | [integration-secrets.ts:280](../../apps/api/src/services/integration-secrets.ts#L280) |
| `integration-secrets.3f581e05` | 写死 | 开头不对：secret key 以 sk\_test\_ 或 sk\_live\_ 开头，publishable key 以 pk\_test\_ 或 pk\_live\_ 开头，webhook signing secret 以 whsec\_ 开头 | 文字 | [integration-secrets.ts:281](../../apps/api/src/services/integration-secrets.ts#L281) |
| `integration-secrets.ded34270` | 写死 | secret key 和 publishable key 必须同为测试（test）或同为正式（live） | 文字 | [integration-secrets.ts:282](../../apps/api/src/services/integration-secrets.ts#L282) |
| `integration-secrets.44965120` | 写死 | 这个环境只能用 Stripe 的测试密钥（sk\_test\_ 开头） | 文字 | [integration-secrets.ts:283](../../apps/api/src/services/integration-secrets.ts#L283) |
| `integration-secrets.cfb9e688` | 写死 | 正式环境只能用 Stripe 的正式密钥（sk\_live\_ 开头） | 文字 | [integration-secrets.ts:284](../../apps/api/src/services/integration-secrets.ts#L284) |
| `integration-secrets.811b0320` | 写死 | 端口只能是 25、465、587、2525 | 文字 | [integration-secrets.ts:285](../../apps/api/src/services/integration-secrets.ts#L285) |
| `integration-secrets.02bec242` | 写死 | 这个环境不能用明文发信，请选 TLS 或 STARTTLS | 文字 | [integration-secrets.ts:286](../../apps/api/src/services/integration-secrets.ts#L286) |
| `integration-secrets.50599144` | 写死 | 不能填内网地址：请填写邮件服务商给的公网主机名 | 文字 | [integration-secrets.ts:287](../../apps/api/src/services/integration-secrets.ts#L287) |
| `integration-secrets.452aeecc` | 写死 | 开头不对：Claude 的 API 密钥以 sk-ant- 开头，请到 Anthropic Console 的 API Keys 页面复制 | 文字 | [integration-secrets.ts:292](../../apps/api/src/services/integration-secrets.ts#L292) |
| `integration-secrets.93183fb1` | 写死 | 必填（七项要一起填） | 提示 | [integration-secrets.ts:297](../../apps/api/src/services/integration-secrets.ts#L297) |
| `integration-secrets.62e7bc02` | 写死 | 写法不对，请检查是否带进了换行或别的字符 | 文字 | [integration-secrets.ts:298](../../apps/api/src/services/integration-secrets.ts#L298) |
| `integration-secrets.7c5c5212` | 写死 | 这一项第三方密钥 | 错误提示 | [integration-secrets.ts:309](../../apps/api/src/services/integration-secrets.ts#L309) |
| `integration-secrets.41040b15` | 写死 | 服务器还没有配置数据加密密钥（DATA\_ENCRYPTION\_KEY），现在不能在后台填写第三方密钥。请联系技术人员 | 错误提示 | [integration-secrets.ts:314](../../apps/api/src/services/integration-secrets.ts#L314) |
| `integration-secrets.25261a05` | 写死 | 后台没有填写这一项，不用清空 | 错误提示 | [integration-secrets.ts:491](../../apps/api/src/services/integration-secrets.ts#L491) |
| `integration-secrets.20ac2c3f` | 写死 | NOZOMI 邮件发送测试 | 邮件主题 | [integration-secrets.ts:509](../../apps/api/src/services/integration-secrets.ts#L509) |
| `integration-secrets.df5dbfbe` | 写死 | 这是一封测试邮件：{name} 在运营后台「系统设置 → 系统状态 → 第三方密钥」点了「测试一下」（环境：{appEnv}）。<br>收到这封邮件，说明邮件发送配置可用。不需要回复。 | 文字 | [integration-secrets.ts:510](../../apps/api/src/services/integration-secrets.ts#L510) |
| `integration-secrets.39266602` | 写死 | Claude 还没有配置，先填写密钥再测试 | 文字 | [integration-secrets.ts:517](../../apps/api/src/services/integration-secrets.ts#L517) |
| `integration-secrets.71198554` | 写死 | 邮件发送还没有配置，先填写再测试 | 文字 | [integration-secrets.ts:517](../../apps/api/src/services/integration-secrets.ts#L517) |
| `integration-secrets.a2f4825c` | 写死 | 谷歌地图 还没有配置，先填写密钥再测试 | 文字 | [integration-secrets.ts:517](../../apps/api/src/services/integration-secrets.ts#L517) |
| `integration-secrets.a7ef4b63` | 写死 | Stripe 还没有配置，先填写密钥再测试 | 文字 | [integration-secrets.ts:517](../../apps/api/src/services/integration-secrets.ts#L517) |
| `integration-secrets.01ea3f22` | 写死 | 刚测过，请过几秒再试 | 错误提示 | [integration-secrets.ts:532](../../apps/api/src/services/integration-secrets.ts#L532) |
| `integration-secrets.601a53a6` | 写死 | 邮件服务器已接收，测试邮件发到了 {email}，请去邮箱确认（也看看垃圾邮件） | 提示 | [integration-secrets.ts:557](../../apps/api/src/services/integration-secrets.ts#L557) |
| `integration-secrets.d094f5f2` | 写死 | {…}可用 | 提示 | [integration-secrets.ts:557](../../apps/api/src/services/integration-secrets.ts#L557) |

## 库存的业务流程（inventory.ts）

文件：`apps/api/src/services/inventory.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `inventory.7356f07b` | 写死 | 不是合法的日期（YYYY-MM-DD） | 提示 | [inventory.ts:39](../../apps/api/src/services/inventory.ts#L39) |
| `inventory.6eeae5a1` | 写死 | 结束日期不能早于开始日期 | 文字 | [inventory.ts:40](../../apps/api/src/services/inventory.ts#L40) |
| `inventory.5c1db4bc` | 写死 | 过去的日期不能设库存 | 文字 | [inventory.ts:41](../../apps/api/src/services/inventory.ts#L41) |
| `inventory.324531b2` | 写死 | 最远只能设到 {maxDaysAhead} 天以后 | 文字 | [inventory.ts:42](../../apps/api/src/services/inventory.ts#L42) |
| `inventory.11e4e06d` | 写死 | 一次最多 {maxRangeDays} 天 | 文字 | [inventory.ts:43](../../apps/api/src/services/inventory.ts#L43) |
| `inventory.45cf5b2f` | 写死 | 必须是整数 | 文字 | [inventory.ts:44](../../apps/api/src/services/inventory.ts#L44) |
| `inventory.d801ac07` | 写死 | 超出了允许的范围 | 文字 | [inventory.ts:45](../../apps/api/src/services/inventory.ts#L45) |
| `inventory.f0a5f117` | 写死 | 重复了 | 文字 | [inventory.ts:46](../../apps/api/src/services/inventory.ts#L46) |
| `inventory.ed86cfca` | 写死 | 这段日期里没有一天符合选的星期 | 文字 | [inventory.ts:47](../../apps/api/src/services/inventory.ts#L47) |
| `inventory.c3082e00` | 写死 | 商品 | 错误提示 | [inventory.ts:63](../../apps/api/src/services/inventory.ts#L63) |
| `inventory.d8ef1ccf` | 写死 | 有 {length} 天已经有订单占着库存：可售单数不能改到已占用的数以下，也不能清除 | 错误提示 | [inventory.ts:182](../../apps/api/src/services/inventory.ts#L182) |

## 包车三层的旧价格数据清理（legacy-price-cleanup.ts）

文件：`apps/api/src/services/legacy-price-cleanup.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `legacy-price-cleanup.a2c5fd32` | 写死 | 包车旧价格清理（{mode}，批次 {runId}）：迁移过三层的包车商品 {migratedProducts} 个（没迁移过的 {untouchedProducts} 个不动），有改动 {changedProducts} 个；删掉按服务区域的旧套餐价 {areaPackagesDeleted} 条；③行去掉途经加价 {waypointsStripped} 条（其中上下车加价都是 0 的 {zeroUpdownRows} 条）；只在旧行里有的车型组 × 时长 {hoursOnlyInLegacy} 个 | 文字 | [legacy-price-cleanup.ts:145](../../apps/api/src/services/legacy-price-cleanup.ts#L145) |

## 内部发信接口（mail.ts）

文件：`apps/api/src/services/mail.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `mail.9e5556de` | 写死 | 邮件内容不合格：收件人只能是一个邮箱地址，主题不能有换行，主题和正文都要有内容 | 提示 | [mail.ts:12](../../apps/api/src/services/mail.ts#L12) |
| `mail.83c7f26f` | 写死 | 邮件发送还没有配置，请超级管理员在运营后台「系统设置 → 系统状态 → 第三方密钥」填写 | 提示 | [mail.ts:23](../../apps/api/src/services/mail.ts#L23) |

## 人工报价申请（manual-quotes.ts）

文件：`apps/api/src/services/manual-quotes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `manual-quotes.8fac9988` | 写死 | 没有这个城市 | 提示 | [manual-quotes.ts:159](../../apps/api/src/services/manual-quotes.ts#L159) |
| `manual-quotes.b0dadd50` | 写死 | 地点名称要和行程单的天数、每天的点数一一对应 | 提示 | [manual-quotes.ts:168](../../apps/api/src/services/manual-quotes.ts#L168) |
| `manual-quotes.320ef774` | 写死 | 人工报价申请 | 错误提示 | [manual-quotes.ts:209](../../apps/api/src/services/manual-quotes.ts#L209) |
| `manual-quotes.5175561f` | 写死 | 这条申请已过保留期，客人的联系方式和地点已清除，不能再跟进 | 错误提示 | [manual-quotes.ts:213](../../apps/api/src/services/manual-quotes.ts#L213) |
| `manual-quotes.1a380088` | 写死 | 请输入完整的邮箱，或带国家码的 WhatsApp 号码 | 提示 | [manual-quotes.ts:231](../../apps/api/src/services/manual-quotes.ts#L231) |
| `manual-quotes.1952a85a` | 写死 | 不能改回「新」：「新」只表示还没人看过 | 错误提示 | [manual-quotes.ts:341](../../apps/api/src/services/manual-quotes.ts#L341) |
| `manual-quotes.839c65aa` | 写死 | 这位同事不能跟进人工报价申请（账号停用、没有权限或不在数据范围内） | 提示 | [manual-quotes.ts:344](../../apps/api/src/services/manual-quotes.ts#L344) |

## 平台主数据的业务流程（master-data.ts）

文件：`apps/api/src/services/master-data.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `master-data.0f7d37b7` | 写死 | 城市 | 名称 | [master-data.ts:95](../../apps/api/src/services/master-data.ts#L95) |
| `master-data.2c46dac1` | 写死 | 地点 | 名称 | [master-data.ts:112](../../apps/api/src/services/master-data.ts#L112) |
| `master-data.bf6452bb` | 写死 | 车型组 | 名称 | [master-data.ts:135](../../apps/api/src/services/master-data.ts#L135) |
| `master-data.4281910c` | 写死 | 附加服务 | 名称 | [master-data.ts:150](../../apps/api/src/services/master-data.ts#L150) |
| `master-data.9f5b30fe` | 写死 | 经度必须在 -180 到 180 之间 | 提示 | [master-data.ts:347](../../apps/api/src/services/master-data.ts#L347) |
| `master-data.850ca3aa` | 写死 | 纬度必须在 -90 到 90 之间 | 提示 | [master-data.ts:348](../../apps/api/src/services/master-data.ts#L348) |
| `master-data.acbe4d48` | 写死 | 有 {count} 个已上架的商品在用{what}，不能停用。请先让供应商下架这些商品或换掉它 | 文字 | [master-data.ts:358](../../apps/api/src/services/master-data.ts#L358) |
| `master-data.572fdd3b` | 写死 | 不是合法的 IANA 时区名，例如 Asia/Tokyo | 提示 | [master-data.ts:375](../../apps/api/src/services/master-data.ts#L375) |
| `master-data.5becc4ac` | 写死 | 不是合法的国家码（ISO 3166-1 两位大写字母） | 提示 | [master-data.ts:386](../../apps/api/src/services/master-data.ts#L386) |
| `master-data.d26b30d1` | 写死 | 这个城市下还有 {active} 个启用中的地点，请先停用它们 | 文字 | [master-data.ts:443](../../apps/api/src/services/master-data.ts#L443) |
| `master-data.10c4a2c3` | 写死 | 这个城市 | 文字 | [master-data.ts:444](../../apps/api/src/services/master-data.ts#L444) |
| `master-data.0b4705fc` | 写死 | 航站楼必须指定所属机场 | 提示 | [master-data.ts:501](../../apps/api/src/services/master-data.ts#L501) |
| `master-data.e4961f0b` | 写死 | 出口必须指定所属车站 | 提示 | [master-data.ts:501](../../apps/api/src/services/master-data.ts#L501) |
| `master-data.6edfe68d` | 写死 | 所属车站不存在 | 提示 | [master-data.ts:504](../../apps/api/src/services/master-data.ts#L504) |
| `master-data.d1f9a00f` | 写死 | 所属机场不存在 | 提示 | [master-data.ts:504](../../apps/api/src/services/master-data.ts#L504) |
| `master-data.8b134d83` | 写死 | 航站楼和出口的城市跟随上级，不用单独指定 | 提示 | [master-data.ts:507](../../apps/api/src/services/master-data.ts#L507)、552、635 行 |
| `master-data.3ff4300c` | 写死 | 只有航站楼和出口有上级 | 提示 | [master-data.ts:514](../../apps/api/src/services/master-data.ts#L514) |
| `master-data.13a7567d` | 写死 | 必填 | 提示 | [master-data.ts:515](../../apps/api/src/services/master-data.ts#L515) |
| `master-data.f6d2b4e2` | 写死 | 城市不存在 | 提示 | [master-data.ts:517](../../apps/api/src/services/master-data.ts#L517)、554、624 行 |
| `master-data.b2242ff1` | 写死 | 这个城市属于 {countryCode}，而地点在 {countryCode} | 提示 | [master-data.ts:556](../../apps/api/src/services/master-data.ts#L556)、626 行 |
| `master-data.c493fdf4` | 写死 | 只有地标能放进包车覆盖检查的清单 | 提示 | [master-data.ts:568](../../apps/api/src/services/master-data.ts#L568) |
| `master-data.83627d32` | 写死 | 它下面还有 {active} 个启用中的航站楼或出口，请先停用它们 | 文字 | [master-data.ts:618](../../apps/api/src/services/master-data.ts#L618) |
| `master-data.f4c95712` | 写死 | 这个地点 | 文字 | [master-data.ts:619](../../apps/api/src/services/master-data.ts#L619) |
| `master-data.391f22da` | 写死 | 这个地点已经有所属城市；要换城市请用修改接口 | 提示 | [master-data.ts:636](../../apps/api/src/services/master-data.ts#L636) |
| `master-data.db79ce9c` | 写死 | 这个车型组 | 文字 | [master-data.ts:740](../../apps/api/src/services/master-data.ts#L740) |
| `master-data.99fbd6c4` | 写死 | 这个附加服务 | 文字 | [master-data.ts:783](../../apps/api/src/services/master-data.ts#L783) |

## 通知中心的后台任务（notification-jobs.ts）

文件：`apps/api/src/services/notification-jobs.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `notification-jobs.4b2a598f` | 写死 | 邮件发送还没有配置，配好后自动发送 | 提示 | [notification-jobs.ts:133](../../apps/api/src/services/notification-jobs.ts#L133) |
| `notification-jobs.3a27b703` | 写死 | 测试环境的验收单：只给 {QA\_ACCEPTANCE\_MAIL\_RECIPIENT} 发信，这一封没有发出，内容可在发送记录里查看 | 提示 | [notification-jobs.ts:136](../../apps/api/src/services/notification-jobs.ts#L136) |
| `notification-jobs.4231139b` | 写死 | 包车 {packageHours} 小时 | 文字 | [notification-jobs.ts:190](../../apps/api/src/services/notification-jobs.ts#L190) |
| `notification-jobs.9f48d156` | 写死 | 见订单 | 文字 | [notification-jobs.ts:190](../../apps/api/src/services/notification-jobs.ts#L190)、191 行 |
| `notification-jobs.0c1d3ad4` | 写死 | {before} → {after} 分钟 | 文字 | [notification-jobs.ts:226](../../apps/api/src/services/notification-jobs.ts#L226) |
| `notification-jobs.1e74ee43` | 写死 | {after} 分钟 | 文字 | [notification-jobs.ts:226](../../apps/api/src/services/notification-jobs.ts#L226) |
| `notification-jobs.723ff9a4` | 写死 | 不限时 | 文字 | [notification-jobs.ts:226](../../apps/api/src/services/notification-jobs.ts#L226) |
| `notification-jobs.9285e611` | 写死 | {before} 分钟 | 文字 | [notification-jobs.ts:226](../../apps/api/src/services/notification-jobs.ts#L226) |
| `notification-jobs.7cc5ab0f` | 写死 | 免费等待 {change}（按客人的航班重新锁定，请按新的时长安排司机等候）。 | 文字 | [notification-jobs.ts:227](../../apps/api/src/services/notification-jobs.ts#L227) |
| `notification-jobs.d1558dd6` | 写死 | 订单信息 | 文字 | [notification-jobs.ts:230](../../apps/api/src/services/notification-jobs.ts#L230) |
| `notification-jobs.9fd94507` | 写死 | （见供应商详情） | 名称 | [notification-jobs.ts:296](../../apps/api/src/services/notification-jobs.ts#L296) |
| `notification-jobs.1086cccd` | 写死 | 企业信息 | 文字 | [notification-jobs.ts:297](../../apps/api/src/services/notification-jobs.ts#L297) |
| `notification-jobs.a028e366` | 写死 | 请到异常队列查看 | 文字 | [notification-jobs.ts:302](../../apps/api/src/services/notification-jobs.ts#L302) |
| `notification-jobs.d57be254` | 写死 | 见汇率中心的拉取记录 | 文字 | [notification-jobs.ts:306](../../apps/api/src/services/notification-jobs.ts#L306) |
| `notification-jobs.fa9188bd` | 写死 | 汇率源缺币种，这批整批拒收，继续用上一批 | 文字 | [notification-jobs.ts:306](../../apps/api/src/services/notification-jobs.ts#L306) |
| `notification-jobs.677e6ca0` | 写死 | 汇率变动超过 3%，已挂起，等待人工确认 | 文字 | [notification-jobs.ts:310](../../apps/api/src/services/notification-jobs.ts#L310) |
| `notification-jobs.c0b35d82` | 写死 | 汇率超过 48 小时没有更新，已暂停跨币种报价 | 文字 | [notification-jobs.ts:310](../../apps/api/src/services/notification-jobs.ts#L310) |
| `notification-jobs.64aa19b0` | 写死 | 涉及币种：{…} | 文字 | [notification-jobs.ts:311](../../apps/api/src/services/notification-jobs.ts#L311) |
| `notification-jobs.9fb2d01e` | 写死 | 最后一次更新时间见汇率中心 | 文字 | [notification-jobs.ts:311](../../apps/api/src/services/notification-jobs.ts#L311) |
| `notification-jobs.cfaad56f` | 写死 | 最后一次更新：{…} | 文字 | [notification-jobs.ts:311](../../apps/api/src/services/notification-jobs.ts#L311) |
| `notification-jobs.d811a069` | 写死 | 见汇率中心 | 文字 | [notification-jobs.ts:311](../../apps/api/src/services/notification-jobs.ts#L311) |
| `notification-jobs.a89b8a54` | 写死 | 订单号：{orderNo} | 文字 | [notification-jobs.ts:315](../../apps/api/src/services/notification-jobs.ts#L315) |
| `notification-jobs.ef675876` | 写死 | 这个订单号不存在：有人可能在猜订单号。 | 文字 | [notification-jobs.ts:315](../../apps/api/src/services/notification-jobs.ts#L315) |

## 通知中心的接口层业务（notifications.ts）

文件：`apps/api/src/services/notifications.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `notifications.cc4f08ea` | 写死 | 邮件发送还没有配置，请超级管理员在「系统设置 → 系统状态」填写；配好后等待中的通知会自动发送 | 错误提示 | [notifications.ts:59](../../apps/api/src/services/notifications.ts#L59) |
| `notifications.e9c9bb10` | 写死 | 通知 | 错误提示 | [notifications.ts:63](../../apps/api/src/services/notifications.ts#L63)、66 行 |
| `notifications.7af2efb6` | 写死 | 这条通知现在不能重试：只有失败的、过了有效期的可以 | 错误提示 | [notifications.ts:68](../../apps/api/src/services/notifications.ts#L68) |
| `notifications.3ea61d1b` | 写死 | 通知内容 | 错误提示 | [notifications.ts:96](../../apps/api/src/services/notifications.ts#L96)、99、102 行 |
| `notifications.04e37ae0` | 写死 | 开始和结束不能是同一个时间 | 提示 | [notifications.ts:116](../../apps/api/src/services/notifications.ts#L116) |
| `notifications.329e2928` | 写死 | 时间要写成 HH:mm | 提示 | [notifications.ts:116](../../apps/api/src/services/notifications.ts#L116) |

## 改单（order-changes.ts）

文件：`apps/api/src/services/order-changes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-changes.b6891176` | 写死 | 订单当前的状态不能这样改（司机出发后不能改时间和人数，服务开始后什么都不能改） | 提示 | [order-changes.ts:116](../../apps/api/src/services/order-changes.ts#L116) |
| `order-changes.21873019` | 写死 | 已经过了免费取消期，只能改航班号和乘客信息 | 提示 | [order-changes.ts:117](../../apps/api/src/services/order-changes.ts#L117) |
| `order-changes.3fe4dd73` | 写死 | 人数或行李超出了这个车型的容量，请取消后重新下单 | 提示 | [order-changes.ts:118](../../apps/api/src/services/order-changes.ts#L118) |
| `order-changes.773d7d00` | 写死 | 新的用车时间已经过了 | 提示 | [order-changes.ts:119](../../apps/api/src/services/order-changes.ts#L119) |
| `order-changes.e016b8ba` | 写死 | 没有要改的内容 | 提示 | [order-changes.ts:120](../../apps/api/src/services/order-changes.ts#L120) |
| `order-changes.822b1b6d` | 写死 | 必填 | 提示 | [order-changes.ts:124](../../apps/api/src/services/order-changes.ts#L124) |
| `order-changes.aed2e4d6` | 写死 | 这一单不填这一项 | 文字 | [order-changes.ts:125](../../apps/api/src/services/order-changes.ts#L125) |
| `order-changes.200c030f` | 写死 | 电话要写成带国家码的国际格式，如 +81 90-1234-5678 | 提示 | [order-changes.ts:126](../../apps/api/src/services/order-changes.ts#L126) |
| `order-changes.ab158cfd` | 写死 | 航班号的格式不对，如 NH211 | 提示 | [order-changes.ts:127](../../apps/api/src/services/order-changes.ts#L127) |
| `order-changes.75f3aa5a` | 写死 | 太长了 | 文字 | [order-changes.ts:128](../../apps/api/src/services/order-changes.ts#L128) |
| `order-changes.4df1a950` | 写死 | 格式不对 | 提示 | [order-changes.ts:129](../../apps/api/src/services/order-changes.ts#L129) |
| `order-changes.276d149a` | 写死 | 改乘客邮箱要另一位同事批准：请写明怎么核实的客人身份（核实方式、原因） | 提示 | [order-changes.ts:180](../../apps/api/src/services/order-changes.ts#L180) |
| `order-changes.67f8874f` | 写死 | 这家供应商在新的时间没法服务（或者已经订满），请取消后重新下单 | 错误提示 | [order-changes.ts:268](../../apps/api/src/services/order-changes.ts#L268) |
| `order-changes.f1dce57e` | 写死 | 新的那一天已经订满了，请取消后重新下单 | 错误提示 | [order-changes.ts:359](../../apps/api/src/services/order-changes.ts#L359) |
| `order-changes.6bdfdb18` | 写死 | 订单 | 错误提示 | [order-changes.ts:458](../../apps/api/src/services/order-changes.ts#L458) |
| `order-changes.6827e3e6` | 写死 | 新邮箱和订单上的是同一个地址（只是写法不同），不算改邮箱，不用写核实方式（请删掉） | 提示 | [order-changes.ts:466](../../apps/api/src/services/order-changes.ts#L466) |
| `order-changes.3f99f9da` | 写死 | 这一单没有保存下来的支付方式，补不了差价；请取消后重新下单 | 错误提示 | [order-changes.ts:521](../../apps/api/src/services/order-changes.ts#L521) |
| `order-changes.7825f7cd` | 写死 | 这张单还有一个修改申请没有结论（在等供应商确认或在补差价），请等它有结果再改；姓名、电话、邮箱随时可以直接改，备注在免费取消期内可以改 | 错误提示 | [order-changes.ts:546](../../apps/api/src/services/order-changes.ts#L546) |
| `order-changes.8c0214fb` | 写死 | NOZOMI {orderNo} 改期差价 | 说明 | [order-changes.ts:568](../../apps/api/src/services/order-changes.ts#L568) |
| `order-changes.86173a00` | 写死 | 收款服务出错，差价还没有扣到；这次改单会在几分钟内自动重试，请稍后查看订单 | 错误提示 | [order-changes.ts:572](../../apps/api/src/services/order-changes.ts#L572) |
| `order-changes.ebf5b1f3` | 写死 | 用保存的支付方式扣差价没有成功（卡被拒或需要客人验证），这次没有改；可以取消后重新下单 | 错误提示 | [order-changes.ts:610](../../apps/api/src/services/order-changes.ts#L610) |
| `order-changes.eab39065` | 写死 | 改单 | 错误提示 | [order-changes.ts:715](../../apps/api/src/services/order-changes.ts#L715)、717 行 |
| `order-changes.01d23dca` | 写死 | 这次修改不在等处理（已经有结论了） | 错误提示 | [order-changes.ts:720](../../apps/api/src/services/order-changes.ts#L720) |
| `order-changes.01408d2e` | 写死 | 订单当前的状态已经不能这样改了 | 错误提示 | [order-changes.ts:732](../../apps/api/src/services/order-changes.ts#L732) |
| `order-changes.5b94a75a` | 写死 | 已经标记过调整中了，只能标一次；请同意或拒绝 | 错误提示 | [order-changes.ts:734](../../apps/api/src/services/order-changes.ts#L734) |

## 订单的退款和离线扣款（order-money.ts）

文件：`apps/api/src/services/order-money.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-money.0d47631a` | 写死 | 支付未配置，不能退款。{PAYMENT\_SETUP\_HINT} | 文字 | [order-money.ts:83](../../apps/api/src/services/order-money.ts#L83) |
| `order-money.eb64a922` | 写死 | 这笔收款没有收款服务的付款编号 | 文字 | [order-money.ts:84](../../apps/api/src/services/order-money.ts#L84) |
| `order-money.edc4048c` | 写死 | 收款服务说这笔退款失败了 | 提示 | [order-money.ts:95](../../apps/api/src/services/order-money.ts#L95) |
| `order-money.2847640d` | 写死 | 退款 | 错误提示 | [order-money.ts:136](../../apps/api/src/services/order-money.ts#L136) |
| `order-money.0e55d2e0` | 写死 | 只有失败的退款能重试 | 错误提示 | [order-money.ts:137](../../apps/api/src/services/order-money.ts#L137) |
| `order-money.cbdec5ae` | 写死 | 订单取消时的退款已经包含了这一笔，不能再重试（再退就多退了） | 错误提示 | [order-money.ts:149](../../apps/api/src/services/order-money.ts#L149) |
| `order-money.08bae33c` | 写死 | 再退这一笔，客人留下的会少于应付的（对外价或取消费），请核对这一单的收款和退款 | 错误提示 | [order-money.ts:150](../../apps/api/src/services/order-money.ts#L150) |
| `order-money.94a7d497` | 写死 | 这一笔已经重试过了，请看重试的那一笔 | 错误提示 | [order-money.ts:170](../../apps/api/src/services/order-money.ts#L170) |
| `order-money.88f4c2a1` | 写死 | 支付未配置。{PAYMENT\_SETUP\_HINT} | 错误提示 | [order-money.ts:187](../../apps/api/src/services/order-money.ts#L187) |

## 查订单（order-queries.ts）

文件：`apps/api/src/services/order-queries.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-queries.57b5b615` | 写死 | 订单 | 错误提示 | [order-queries.ts:185](../../apps/api/src/services/order-queries.ts#L185)、250、315 行 |
| `order-queries.398c89d4` | 写死 | 照片 | 错误提示 | [order-queries.ts:213](../../apps/api/src/services/order-queries.ts#L213)、219、226 行 |

## 包车经停顺序建议（order-suggestion.ts）

文件：`apps/api/src/services/order-suggestion.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-suggestion.5643acf0` | 写死 | 报价不存在或已过期，请重新询价后再申请建议顺序 | 文字 | [order-suggestion.ts:81](../../apps/api/src/services/order-suggestion.ts#L81) |
| `order-suggestion.36e9e185` | 写死 | 经停点和报价对不上，请重新询价后再申请建议顺序 | 文字 | [order-suggestion.ts:83](../../apps/api/src/services/order-suggestion.ts#L83) |
| `order-suggestion.a2740a19` | 写死 | 这次询价不能用来申请建议顺序，请重新询价 | 文字 | [order-suggestion.ts:96](../../apps/api/src/services/order-suggestion.ts#L96) |
| `order-suggestion.144a1341` | 写死 | 经停点和询价对不上，请重新询价后再申请建议顺序 | 文字 | [order-suggestion.ts:97](../../apps/api/src/services/order-suggestion.ts#L97) |
| `order-suggestion.f34659a5` | 写死 | 请先询价，再申请建议顺序 | 文字 | [order-suggestion.ts:100](../../apps/api/src/services/order-suggestion.ts#L100) |
| `order-suggestion.59a8eed9` | 写死 | 每个经停点要有一个不重复的标识 | 错误提示 | [order-suggestion.ts:132](../../apps/api/src/services/order-suggestion.ts#L132) |
| `order-suggestion.9d34aaf7` | 写死 | 个数和经停点一样、不重复 | 提示 | [order-suggestion.ts:132](../../apps/api/src/services/order-suggestion.ts#L132) |

## 供应商后台的待办和角标（order-todos.ts）

文件：`apps/api/src/services/order-todos.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-todos.407703e9` | 写死 | 待办 | 错误提示 | [order-todos.ts:70](../../apps/api/src/services/order-todos.ts#L70) |
| `order-todos.d6776bec` | 写死 | 这条要同意或拒绝，不能只标记知道了 | 错误提示 | [order-todos.ts:71](../../apps/api/src/services/order-todos.ts#L71) |

## 下单与付款（orders.ts）

文件：`apps/api/src/services/orders.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `orders.45fe2782` | 写死 | 请超级管理员在运营后台「系统设置 → 系统状态 → 第三方密钥」填写 Stripe 的三个密钥 | 说明 | [orders.ts:107](../../apps/api/src/services/orders.ts#L107) |
| `orders.80fca552` | 写死 | 支付未配置（Stripe 还没有配置），现在不能下单。{PAYMENT\_SETUP\_HINT} | 错误提示 | [orders.ts:111](../../apps/api/src/services/orders.ts#L111) |
| `orders.68b4feea` | 写死 | 验收单只能用 Stripe 测试模式收款：现在生效的 Stripe 密钥不是测试密钥（sk\_test\_ / pk\_test\_），不能下验收单、不能建付款 | 错误提示 | [orders.ts:126](../../apps/api/src/services/orders.ts#L126) |
| `orders.eed42f16` | 写死 | 验收单的客人邮箱只能是 …@example.com 或 {QA\_ACCEPTANCE\_MAIL\_RECIPIENT} | 提示 | [orders.ts:134](../../apps/api/src/services/orders.ts#L134) |
| `orders.dc0167b5` | 写死 | ，请稍后用同一个 Idempotency-Key 重试（不会重复下单） | 文字 | [orders.ts:141](../../apps/api/src/services/orders.ts#L141) |
| `orders.1966816a` | 写死 | 收款服务出错，付款还没有建好{retry} | 错误提示 | [orders.ts:142](../../apps/api/src/services/orders.ts#L142) |
| `orders.a44944d8` | 写死 | 必填 | 提示 | [orders.ts:146](../../apps/api/src/services/orders.ts#L146) |
| `orders.9308d26d` | 写死 | 这一单不填这一项 | 文字 | [orders.ts:147](../../apps/api/src/services/orders.ts#L147) |
| `orders.b71544bc` | 写死 | 电话要写成带国家码的国际格式，如 +81 90-1234-5678 | 提示 | [orders.ts:148](../../apps/api/src/services/orders.ts#L148) |
| `orders.958777af` | 写死 | 航班号的格式不对，如 NH211 | 提示 | [orders.ts:149](../../apps/api/src/services/orders.ts#L149) |
| `orders.96b6c28b` | 写死 | 太长了 | 文字 | [orders.ts:150](../../apps/api/src/services/orders.ts#L150) |
| `orders.031c2daf` | 写死 | 格式不对 | 提示 | [orders.ts:151](../../apps/api/src/services/orders.ts#L151) |
| `orders.bb046a01` | 写死 | 客人要勾选同意保存支付方式（用于服务后的超时、超公里等费用）才能下单 | 提示 | [orders.ts:152](../../apps/api/src/services/orders.ts#L152) |
| `orders.102ccb5c` | 写死 | 这个报价的车已经不能预订了，请重新询价 | 错误提示 | [orders.ts:212](../../apps/api/src/services/orders.ts#L212) |
| `orders.bbff9b96` | 写死 | 这一天已经订满了，请重新询价 | 错误提示 | [orders.ts:216](../../apps/api/src/services/orders.ts#L216) |
| `orders.e891dc6a` | 写死 | 这一天的加急名额已经用完了，请重新询价 | 错误提示 | [orders.ts:216](../../apps/api/src/services/orders.ts#L216) |
| `orders.ba13b15e` | 写死 | 报价不存在 | 提示 | [orders.ts:233](../../apps/api/src/services/orders.ts#L233) |
| `orders.c3dce8f0` | 写死 | 这个报价已经下过单了，一个报价只能下一单；要再订一辆请重新询价 | 错误提示 | [orders.ts:243](../../apps/api/src/services/orders.ts#L243) |
| `orders.9c453b88` | 写死 | 订单 | 错误提示 | [orders.ts:466](../../apps/api/src/services/orders.ts#L466)、524 行 |
| `orders.bad169e8` | 写死 | 这一单不是接机，不需要确认落地 | 错误提示 | [orders.ts:525](../../apps/api/src/services/orders.ts#L525) |
| `orders.1fb6b42c` | 写死 | 订单当前的状态不允许这个操作 | 错误提示 | [orders.ts:526](../../apps/api/src/services/orders.ts#L526) |
| `orders.05fc7919` | 写死 | 离计划到达还早，落地后再点「我已落地」 | 错误提示 | [orders.ts:528](../../apps/api/src/services/orders.ts#L528) |

## 运营「代客人改单」改乘客邮箱要双人复核（passenger-email-review.ts）

文件：`apps/api/src/services/passenger-email-review.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `passenger-email-review.94722ec5` | 写死 | 这张单已经有一次改乘客邮箱在等审核，请先处理那一条（批准、驳回或撤回） | 错误提示 | [passenger-email-review.ts:44](../../apps/api/src/services/passenger-email-review.ts#L44) |
| `passenger-email-review.74ed634f` | 写死 | 把订单 {orderNo} 的乘客邮箱改成 {emailMasked} | 说明 | [passenger-email-review.ts:62](../../apps/api/src/services/passenger-email-review.ts#L62) |
| `passenger-email-review.b50c2840` | 写死 | {message}；请驳回 | 错误提示 | [passenger-email-review.ts:97](../../apps/api/src/services/passenger-email-review.ts#L97) |
| `passenger-email-review.a6ed0d4c` | 写死 | 订单 | 错误提示 | [passenger-email-review.ts:116](../../apps/api/src/services/passenger-email-review.ts#L116) |
| `passenger-email-review.59b39fb2` | 写死 | 这次改邮箱已经有结论了 | 文字 | [passenger-email-review.ts:118](../../apps/api/src/services/passenger-email-review.ts#L118) |
| `passenger-email-review.aeceb56f` | 写死 | 订单现在的状态已经不能改乘客信息了 | 文字 | [passenger-email-review.ts:119](../../apps/api/src/services/passenger-email-review.ts#L119) |

## 运营看乘客的完整联系方式和手写内容原文（passenger-privacy.ts）

文件：`apps/api/src/services/passenger-privacy.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `passenger-privacy.3bb5ff35` | 写死 | 订单 | 错误提示 | [passenger-privacy.ts:32](../../apps/api/src/services/passenger-privacy.ts#L32) |

## 收款服务（payment-webhooks.ts）

文件：`apps/api/src/services/payment-webhooks.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `payment-webhooks.9ce51a57` | 写死 | 通知的签名校验没有通过 | 错误提示 | [payment-webhooks.ts:49](../../apps/api/src/services/payment-webhooks.ts#L49) |
| `payment-webhooks.099cac3b` | 写死 | 通知的内容看不懂 | 错误提示 | [payment-webhooks.ts:51](../../apps/api/src/services/payment-webhooks.ts#L51) |
| `payment-webhooks.5b005c40` | 写死 | 收款服务说这笔退款失败了 | 提示 | [payment-webhooks.ts:82](../../apps/api/src/services/payment-webhooks.ts#L82) |

## 供应商收款账户的流程（payout-accounts.ts）

文件：`apps/api/src/services/payout-accounts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `payout-accounts.ce6ff293` | 写死 | 平台还没有配置数据加密密钥（DATA\_ENCRYPTION\_KEY），现在不能处理收款账号。请联系平台 | 错误提示 | [payout-accounts.ts:56](../../apps/api/src/services/payout-accounts.ts#L56) |
| `payout-accounts.9b0f7efa` | 写死 | {currency} 已经有一个待审核的收款账户，先撤回它再提交 | 错误提示 | [payout-accounts.ts:136](../../apps/api/src/services/payout-accounts.ts#L136) |
| `payout-accounts.ce3b0124` | 写死 | 收款账户 | 错误提示 | [payout-accounts.ts:144](../../apps/api/src/services/payout-accounts.ts#L144)、167、190 行 |
| `payout-accounts.e6538cf6` | 写死 | 只有待审核的账户能撤回 | 错误提示 | [payout-accounts.ts:145](../../apps/api/src/services/payout-accounts.ts#L145) |
| `payout-accounts.321ded84` | 写死 | 只有待审核的账户能发起复核 | 错误提示 | [payout-accounts.ts:168](../../apps/api/src/services/payout-accounts.ts#L168) |
| `payout-accounts.8c644d90` | 写死 | 这个账户已经有一条待审核的复核 | 错误提示 | [payout-accounts.ts:170](../../apps/api/src/services/payout-accounts.ts#L170) |
| `payout-accounts.275d3732` | 写死 | 启用供应商「{name}」的 {currency} 收款账户：{beneficiaryName}，{bankName}，{swiftBic}，账号 {…}{…} | 说明 | [payout-accounts.ts:176](../../apps/api/src/services/payout-accounts.ts#L176) |
| `payout-accounts.e0fc5410` | 写死 | （替换现在的 {…}） | 说明 | [payout-accounts.ts:176](../../apps/api/src/services/payout-accounts.ts#L176) |
| `payout-accounts.7338d1fa` | 写死 | 只有待审核的账户能驳回 | 错误提示 | [payout-accounts.ts:191](../../apps/api/src/services/payout-accounts.ts#L191) |
| `payout-accounts.83909e9a` | 写死 | 这个账户有一条待审核的复核，先驳回或撤回那条复核 | 错误提示 | [payout-accounts.ts:193](../../apps/api/src/services/payout-accounts.ts#L193) |

## 平台员工的两步验证（platform-mfa.ts）

文件：`apps/api/src/services/platform-mfa.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-mfa.695abc0f` | 写死 | NOZOMI 运营后台 | 文字 | [platform-mfa.ts:65](../../apps/api/src/services/platform-mfa.ts#L65) |
| `platform-mfa.362b5e2a` | 写死 | 没有这个邮箱的在用平台员工 | 错误提示 | [platform-mfa.ts:286](../../apps/api/src/services/platform-mfa.ts#L286) |

## 运营后台查看供应商的商品（platform-products.ts）

文件：`apps/api/src/services/platform-products.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-products.5601a661` | 写死 | 商品 | 错误提示 | [platform-products.ts:104](../../apps/api/src/services/platform-products.ts#L104)、117、130、133 行 |

## 平台角色管理（platform-roles.ts）

文件：`apps/api/src/services/platform-roles.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-roles.06dfb432` | 写死 | 角色 | 错误提示 | [platform-roles.ts:74](../../apps/api/src/services/platform-roles.ts#L74)、144 行 |
| `platform-roles.22b7f38e` | 写死 | 和现在的角色一样，不用发起 | 提示 | [platform-roles.ts:188](../../apps/api/src/services/platform-roles.ts#L188) |
| `platform-roles.32c64345` | 写死 | 修改角色「{name}」{…} | 说明 | [platform-roles.ts:191](../../apps/api/src/services/platform-roles.ts#L191) |
| `platform-roles.4f2f092e` | 写死 | （改名为「{name}」） | 说明 | [platform-roles.ts:191](../../apps/api/src/services/platform-roles.ts#L191) |
| `platform-roles.784f8c9f` | 写死 | 渠道 | 错误提示 | [platform-roles.ts:216](../../apps/api/src/services/platform-roles.ts#L216) |

## 平台员工账号管理（platform-staff.ts）

文件：`apps/api/src/services/platform-staff.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-staff.d0eba507` | 写死 | 账号 | 错误提示 | [platform-staff.ts:139](../../apps/api/src/services/platform-staff.ts#L139)、228、301、326、365、378 行 |
| `platform-staff.799fd754` | 写死 | 超级管理员 | 文字 | [platform-staff.ts:145](../../apps/api/src/services/platform-staff.ts#L145)、332 行 |
| `platform-staff.6ebe0878` | 写死 | 没有这个邮箱的在用超级管理员 | 错误提示 | [platform-staff.ts:258](../../apps/api/src/services/platform-staff.ts#L258)、266 行 |
| `platform-staff.8ae38693` | 写死 | 重置「{name}」（{email}）的两步验证 | 说明 | [platform-staff.ts:383](../../apps/api/src/services/platform-staff.ts#L383) |
| `platform-staff.7ad2de05` | 写死 | 没有这个邮箱的在用平台员工 | 错误提示 | [platform-staff.ts:399](../../apps/api/src/services/platform-staff.ts#L399) |

## 平台侧的租户管理（platform-tenants.ts）

文件：`apps/api/src/services/platform-tenants.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `platform-tenants.b6820cdf` | 写死 | 租户 | 错误提示 | [platform-tenants.ts:24](../../apps/api/src/services/platform-tenants.ts#L24)、79、108 行 |
| `platform-tenants.b2d9425e` | 写死 | 这个租户的管理员账号 | 错误提示 | [platform-tenants.ts:110](../../apps/api/src/services/platform-tenants.ts#L110) |

## 价格表导入第 1 阶段的写入（price-import.ts）

文件：`apps/api/src/services/price-import.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `price-import.31b3f014` | 写死 | 目标租户不存在 | 错误提示 | [price-import.ts:59](../../apps/api/src/services/price-import.ts#L59) |
| `price-import.dcd8f248` | 写死 | 官网渠道不存在 | 错误提示 | [price-import.ts:60](../../apps/api/src/services/price-import.ts#L60) |
| `price-import.f3b3afb8` | 写死 | 这一批的子品牌已存在，币种是 {currency} | 文字 | [price-import.ts:168](../../apps/api/src/services/price-import.ts#L168) |
| `price-import.8c7a6ebc` | 写死 | 这个城市里已经有同名的区域（不是这一批建的），不动它，也不能再建同名的 | 文字 | [price-import.ts:192](../../apps/api/src/services/price-import.ts#L192) |
| `price-import.2af6ce44` | 写死 | 这一批的商品已经不是草稿，不再改它 | 文字 | [price-import.ts:198](../../apps/api/src/services/price-import.ts#L198) |
| `price-import.a093ae26` | 写死 | 已有的价格和这次算出的不同（价、方向、日期或状态），不改 | 文字 | [price-import.ts:213](../../apps/api/src/services/price-import.ts#L213) |
| `price-import.ade47667` | 写死 | 没有一格能导入 | 文字 | [price-import.ts:215](../../apps/api/src/services/price-import.ts#L215) |

## 价格规则、调价规则、价格日历、缺价组合、子品牌取整单位、节假…（prices.ts）

文件：`apps/api/src/services/prices.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `prices.1eaba965` | 写死 | 必填 | 提示 | [prices.ts:100](../../apps/api/src/services/prices.ts#L100) |
| `prices.bdaa562e` | 写死 | 必须是整数（金额用最小货币单位，百分比用基点） | 文字 | [prices.ts:101](../../apps/api/src/services/prices.ts#L101) |
| `prices.0a5613f9` | 写死 | 超出了允许的范围 | 文字 | [prices.ts:102](../../apps/api/src/services/prices.ts#L102) |
| `prices.20412804` | 写死 | 不是合法的日期（YYYY-MM-DD） | 提示 | [prices.ts:103](../../apps/api/src/services/prices.ts#L103) |
| `prices.0b3753f4` | 写死 | 结束日期不能早于开始日期 | 文字 | [prices.ts:104](../../apps/api/src/services/prices.ts#L104) |
| `prices.616130a9` | 写死 | 这个品类的商品不填这一项 | 文字 | [prices.ts:105](../../apps/api/src/services/prices.ts#L105) |
| `prices.3491f805` | 写死 | 这个品类不能用这种计价方式 | 文字 | [prices.ts:106](../../apps/api/src/services/prices.ts#L106) |
| `prices.4a54af50` | 写死 | 时间要写成 HH:mm（结束可以是 24:00） | 提示 | [prices.ts:107](../../apps/api/src/services/prices.ts#L107) |
| `prices.2b959741` | 写死 | 开始和结束不能相同；全天请不填时段 | 空状态 | [prices.ts:108](../../apps/api/src/services/prices.ts#L108) |
| `prices.a1227ab3` | 写死 | 重复了 | 文字 | [prices.ts:109](../../apps/api/src/services/prices.ts#L109) |
| `prices.b9c4e2d1` | 写死 | 条数太多 | 文字 | [prices.ts:110](../../apps/api/src/services/prices.ts#L110) |
| `prices.64c049ee` | 写死 | 太长了 | 文字 | [prices.ts:111](../../apps/api/src/services/prices.ts#L111) |
| `prices.f303bc6f` | 写死 | 不是合法的国家码（ISO 3166-1 两位大写字母） | 提示 | [prices.ts:112](../../apps/api/src/services/prices.ts#L112) |
| `prices.6433bc9c` | 写死 | 调价的值不能是 0 | 文字 | [prices.ts:113](../../apps/api/src/services/prices.ts#L113) |
| `prices.7a1fa3b4` | 写死 | 下车区域不能和上车区域相同（同一个区域里的单用区域价，不填下车区域） | 文字 | [prices.ts:114](../../apps/api/src/services/prices.ts#L114) |
| `prices.a7b0807f` | 写死 | 运营区域不带价格：价格、区域加价、线路价只能挂在报价区域（或「运营 + 报价」的区域）上 | 提示 | [prices.ts:161](../../apps/api/src/services/prices.ts#L161) |
| `prices.53013862` | 写死 | 商品 | 错误提示 | [prices.ts:165](../../apps/api/src/services/prices.ts#L165) |
| `prices.fe85f02d` | 写死 | 这个商品还没有迁移到三层区域：不能设行程加价、整商品套餐价或不分套餐的加价 | 提示 | [prices.ts:258](../../apps/api/src/services/prices.ts#L258) |
| `prices.4f005b7f` | 写死 | 按服务区域的套餐价是迁移前的旧数据（只读）：套餐价请按车型组 × 套餐填一次（不选区域） | 提示 | [prices.ts:261](../../apps/api/src/services/prices.ts#L261) |
| `prices.f84e1fa0` | 写死 | 上下车加价里的途经加价是迁移前的旧数据（只读）：经停加价请在「行程加价」里设 | 提示 | [prices.ts:265](../../apps/api/src/services/prices.ts#L265) |
| `prices.e006afef` | 写死 | 一次最多改 {maxBatchChanges} 条价格规则 | 提示 | [prices.ts:340](../../apps/api/src/services/prices.ts#L340) |
| `prices.6dddacba` | 写死 | 先在商品的「机场套餐」里绑定这个机场区域和场景，再设机场套餐价 | 提示 | [prices.ts:360](../../apps/api/src/services/prices.ts#L360) |
| `prices.ba7e5377` | 写死 | 只能给这个商品选了的区域设价格 | 提示 | [prices.ts:363](../../apps/api/src/services/prices.ts#L363) |
| `prices.1a30dc1f` | 写死 | 下车区域只能选这个商品选了的区域 | 提示 | [prices.ts:367](../../apps/api/src/services/prices.ts#L367) |
| `prices.1c49629d` | 写死 | 只能给这个商品选了的车型组设价格 | 提示 | [prices.ts:375](../../apps/api/src/services/prices.ts#L375) |
| `prices.345c842d` | 写死 | 这条价格规则不存在，或者不是这个商品的 | 提示 | [prices.ts:382](../../apps/api/src/services/prices.ts#L382)、389 行 |
| `prices.0fc64eb6` | 写死 | 同一条价格规则在这次保存里出现了两次 | 提示 | [prices.ts:383](../../apps/api/src/services/prices.ts#L383)、390 行 |
| `prices.ffdb326e` | 写死 | 按服务区域的套餐价是迁移前的旧数据（只读），不能删除；清理旧数据另有任务（M9P-12） | 提示 | [prices.ts:393](../../apps/api/src/services/prices.ts#L393) |
| `prices.2b16ec55` | 写死 | 一个商品最多 {maxPriceRulesPerProduct} 条价格规则 | 提示 | [prices.ts:399](../../apps/api/src/services/prices.ts#L399) |
| `prices.cd3474a9` | 写死 | 同一个区域（点对点线路价：同一条线路）、车型组、方向或套餐的价格（基础定价、区域加价各算各的），生效日期不能重叠（两头的日期都算在内，停用的也算） | 错误提示 | [prices.ts:426](../../apps/api/src/services/prices.ts#L426) |
| `prices.dd05ca24` | 写死 | 这个区域是商品的基础价区域（服务区域），在这里上下车不加价，不能再设上下车加价。 | 提示 | [prices.ts:441](../../apps/api/src/services/prices.ts#L441) |
| `prices.a910b2ec` | 写死 | 只能选业务类型是包车或「通用」的区域 | 提示 | [prices.ts:442](../../apps/api/src/services/prices.ts#L442) |
| `prices.285a0b48` | 写死 | 这个区域已停用，不能新选 | 提示 | [prices.ts:444](../../apps/api/src/services/prices.ts#L444) |
| `prices.b42bb895` | 写死 | 区域 | 错误提示 | [prices.ts:468](../../apps/api/src/services/prices.ts#L468)、470 行 |
| `prices.994cfc69` | 写死 | 价格规则 | 错误提示 | [prices.ts:483](../../apps/api/src/services/prices.ts#L483) |
| `prices.12ada84c` | 写死 | 只能选这个商品选了的区域 | 提示 | [prices.ts:608](../../apps/api/src/services/prices.ts#L608) |
| `prices.41f83ee4` | 写死 | 只能选这个商品选了的车型组 | 提示 | [prices.ts:610](../../apps/api/src/services/prices.ts#L610) |
| `prices.a80fba68` | 写死 | 按这条规则调完（再按取整单位取整），有 {count} 条价格不大于 0（这样的价格报不出去）。请调小减价的幅度，或缩小适用范围 | 提示 | [prices.ts:616](../../apps/api/src/services/prices.ts#L616) |
| `prices.a54f8d4c` | 写死 | 按这条规则调完，有 {tooLarge} 条价格超过了结算价的上限（这样的价格报不出去）。请检查上调的幅度 | 提示 | [prices.ts:619](../../apps/api/src/services/prices.ts#L619) |
| `prices.5eb0a435` | 写死 | 一个商品最多 {maxAdjustRulesPerProduct} 条调价规则 | 提示 | [prices.ts:643](../../apps/api/src/services/prices.ts#L643) |
| `prices.ff97594b` | 写死 | 调价规则 | 错误提示 | [prices.ts:671](../../apps/api/src/services/prices.ts#L671) |
| `prices.a7c94dd4` | 写死 | 要给出这个商品全部调价规则的编号，每个一次（不多不少） | 提示 | [prices.ts:717](../../apps/api/src/services/prices.ts#L717) |
| `prices.4482ab47` | 写死 | 一次最多取 {maxCalendarDays} 天 | 提示 | [prices.ts:815](../../apps/api/src/services/prices.ts#L815) |
| `prices.ee4640ee` | 写死 | 接送机商品要给方向（pickup / dropoff） | 提示 | [prices.ts:818](../../apps/api/src/services/prices.ts#L818) |
| `prices.577969bb` | 写死 | 包车商品要给套餐时长 | 提示 | [prices.ts:821](../../apps/api/src/services/prices.ts#L821) |
| `prices.f83a16db` | 写死 | 子品牌 | 错误提示 | [prices.ts:930](../../apps/api/src/services/prices.ts#L930) |
| `prices.7aa6f711` | 写死 | {currency} 的取整单位只能是（最小货币单位）：{…} | 提示 | [prices.ts:933](../../apps/api/src/services/prices.ts#L933) |
| `prices.542b4160` | 写死 | 取整单位改成这个数之后，有 {length} 个商品的 {length} 条价格取整后是 0（比半个取整单位还小），就报不出价了。请先把这些价格调高或停用，或者选一个小一些的取整单位 | 错误提示 | [prices.ts:949](../../apps/api/src/services/prices.ts#L949) |
| `prices.e3e1cbc9` | 写死 | 一次最多取 {HOLIDAY\_QUERY\_MAX\_DAYS} 天 | 提示 | [prices.ts:980](../../apps/api/src/services/prices.ts#L980) |
| `prices.de8ace8b` | 写死 | 节假日 | 错误提示 | [prices.ts:988](../../apps/api/src/services/prices.ts#L988)、1017 行 |
| `prices.2774cb69` | 写死 | 名称至少要填一种语言，而且不能只有空白 | 提示 | [prices.ts:994](../../apps/api/src/services/prices.ts#L994) |

## 加价规则 / 渠道定价参数生效前的毛利试算（pricing-impact.ts）

文件：`apps/api/src/services/pricing-impact.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `pricing-impact.bb7d0f00` | 写死 | 要改的这条加价规则已经被删除了，无法试算；请驳回 | 错误提示 | [pricing-impact.ts:63](../../apps/api/src/services/pricing-impact.ts#L63) |
| `pricing-impact.e9e4e5b4` | 写死 | 加价规则 | 错误提示 | [pricing-impact.ts:88](../../apps/api/src/services/pricing-impact.ts#L88)、94 行 |
| `pricing-impact.6b6a9638` | 写死 | 复核记录 | 错误提示 | [pricing-impact.ts:363](../../apps/api/src/services/pricing-impact.ts#L363) |
| `pricing-impact.010e6668` | 写死 | 只有改定价参数、加价规则的复核才有毛利试算 | 错误提示 | [pricing-impact.ts:366](../../apps/api/src/services/pricing-impact.ts#L366) |
| `pricing-impact.bca9f71d` | 写死 | 这条复核已经有结论了，不用再试算 | 错误提示 | [pricing-impact.ts:367](../../apps/api/src/services/pricing-impact.ts#L367) |

## 子品牌和商品的业务流程（products.ts）

文件：`apps/api/src/services/products.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `products.01679b40` | 写死 | 已经有同名的子品牌，请换一个名字 | 错误提示 | [products.ts:158](../../apps/api/src/services/products.ts#L158) |
| `products.f206860e` | 写死 | 不支持这个币种 | 提示 | [products.ts:175](../../apps/api/src/services/products.ts#L175) |
| `products.fdf8bcb6` | 写死 | 子品牌 | 错误提示 | [products.ts:198](../../apps/api/src/services/products.ts#L198) |
| `products.39744fd8` | 写死 | 商品 | 错误提示 | [products.ts:283](../../apps/api/src/services/products.ts#L283)、495、542、680、695、740、971、989、1011、1031 行 |
| `products.4982f026` | 写死 | 这个区域已经设了上下车加价：同一个区域不能既是基础价区域（服务区域）又设上下车加价。请先删掉它的上下车加价 | 提示 | [products.ts:321](../../apps/api/src/services/products.ts#L321) |
| `products.45c86165` | 写死 | 一个商品最多选 {maxAreas} 个区域 | 提示 | [products.ts:340](../../apps/api/src/services/products.ts#L340) |
| `products.f6166be5` | 写死 | 同一个区域选了两次 | 提示 | [products.ts:346](../../apps/api/src/services/products.ts#L346) |
| `products.8cefd061` | 写死 | 区域不存在 | 提示 | [products.ts:347](../../apps/api/src/services/products.ts#L347) |
| `products.cbc64c17` | 写死 | 只能选商品所在城市的区域 | 提示 | [products.ts:348](../../apps/api/src/services/products.ts#L348) |
| `products.0c4b5bc9` | 写死 | 只能选业务类型和商品品类相同的区域，或「通用」的区域 | 提示 | [products.ts:349](../../apps/api/src/services/products.ts#L349) |
| `products.b0b84875` | 写死 | 运营区域不带价格，商品只能勾选报价区域（或「运营 + 报价」的区域） | 提示 | [products.ts:351](../../apps/api/src/services/products.ts#L351) |
| `products.5c10a6f9` | 写死 | 这个区域已停用，不能新选 | 提示 | [products.ts:352](../../apps/api/src/services/products.ts#L352) |
| `products.e4031c61` | 写死 | 一个商品最多选 {maxVehicleGroups} 个车型组 | 提示 | [products.ts:357](../../apps/api/src/services/products.ts#L357) |
| `products.230b728b` | 写死 | 同一个车型组选了两次 | 提示 | [products.ts:363](../../apps/api/src/services/products.ts#L363) |
| `products.0e12261d` | 写死 | 车型组不存在 | 提示 | [products.ts:364](../../apps/api/src/services/products.ts#L364) |
| `products.f00ac506` | 写死 | 这个车型组已被平台停用，不能新选 | 提示 | [products.ts:365](../../apps/api/src/services/products.ts#L365) |
| `products.20404f20` | 写死 | 「人数 / 行李数」必须是这个车型组可选的组合之一 | 提示 | [products.ts:367](../../apps/api/src/services/products.ts#L367) |
| `products.b14de0f6` | 写死 | 调度人最多 {maxDispatchers} 个 | 提示 | [products.ts:373](../../apps/api/src/services/products.ts#L373) |
| `products.b8241e26` | 写死 | 调度人姓名必填，最多 {maxDispatcherNameLength} 个字 | 提示 | [products.ts:376](../../apps/api/src/services/products.ts#L376) |
| `products.fbeeb344` | 写死 | 电话只能是数字，可以带开头的 + 和中间的空格、横线，6 到 20 位 | 提示 | [products.ts:378](../../apps/api/src/services/products.ts#L378) |
| `products.09812cf4` | 写死 | 子品牌不存在 | 提示 | [products.ts:415](../../apps/api/src/services/products.ts#L415) |
| `products.f432c833` | 写死 | 这个子品牌已停用 | 提示 | [products.ts:416](../../apps/api/src/services/products.ts#L416) |
| `products.e0bde5a2` | 写死 | 城市不存在 | 提示 | [products.ts:418](../../apps/api/src/services/products.ts#L418) |
| `products.b839761e` | 写死 | 这个城市已被平台停用，不能在它下面新增商品 | 文字 | [products.ts:421](../../apps/api/src/services/products.ts#L421) |
| `products.d894e3dd` | 写死 | 只有接送机商品有接送点 | 提示 | [products.ts:423](../../apps/api/src/services/products.ts#L423) |
| `products.4dd7decd` | 写死 | 接送机商品必须选一个机场或车站 | 提示 | [products.ts:425](../../apps/api/src/services/products.ts#L425) |
| `products.1c580b9b` | 写死 | 接送点不存在，或不是机场、车站 | 提示 | [products.ts:428](../../apps/api/src/services/products.ts#L428) |
| `products.89f54c89` | 写死 | 接送点不在商品所在的城市 | 提示 | [products.ts:429](../../apps/api/src/services/products.ts#L429) |
| `products.72484661` | 写死 | 这个接送点已被平台停用，不能用它新增商品 | 文字 | [products.ts:430](../../apps/api/src/services/products.ts#L430) |
| `products.fb55e47d` | 写死 | 这样修改之后商品就不满足上架的条件了。请调整后再保存，或者先下架再改 | 错误提示 | [products.ts:486](../../apps/api/src/services/products.ts#L486) |
| `products.472084a2` | 写死 | 只有草稿可以删除；上过架的商品请下架 | 错误提示 | [products.ts:543](../../apps/api/src/services/products.ts#L543) |
| `products.57fc2e7b` | 写死 | 包车的免费等待由平台固定为 0 分钟（从约定的开始时间起计入套餐时长），不能设别的值 | 文字 | [products.ts:559](../../apps/api/src/services/products.ts#L559) |
| `products.e142d1a7` | 写死 | 必填 | 提示 | [products.ts:560](../../apps/api/src/services/products.ts#L560) |
| `products.76d80485` | 写死 | 不是合法的日期（YYYY-MM-DD） | 提示 | [products.ts:561](../../apps/api/src/services/products.ts#L561) |
| `products.e299203b` | 写死 | 结束日期不能早于开始日期 | 文字 | [products.ts:562](../../apps/api/src/services/products.ts#L562) |
| `products.52ee7a6d` | 写死 | 时间要写成 HH:mm（结束可以是 24:00） | 提示 | [products.ts:563](../../apps/api/src/services/products.ts#L563) |
| `products.9acd9177` | 写死 | 开始和结束不能相同；全天请写 00:00 到 24:00 | 空状态 | [products.ts:564](../../apps/api/src/services/products.ts#L564) |
| `products.e61a849b` | 写死 | 超出了允许的范围 | 文字 | [products.ts:565](../../apps/api/src/services/products.ts#L565) |
| `products.453ac15e` | 写死 | 必须是整数 | 文字 | [products.ts:566](../../apps/api/src/services/products.ts#L566) |
| `products.81b8fcff` | 写死 | 条数太多 | 文字 | [products.ts:567](../../apps/api/src/services/products.ts#L567) |
| `products.ddb441f0` | 写死 | 太长了 | 文字 | [products.ts:568](../../apps/api/src/services/products.ts#L568) |
| `products.c4ff1379` | 写死 | 重复了 | 文字 | [products.ts:569](../../apps/api/src/services/products.ts#L569) |
| `products.6b086c60` | 写死 | 加急的小时数不能超过提前预订时长 | 说明 | [products.ts:570](../../apps/api/src/services/products.ts#L570) |
| `products.285dc5c6` | 写死 | 不能短于平台规定的免等时长 | 文字 | [products.ts:571](../../apps/api/src/services/products.ts#L571) |
| `products.727bc70a` | 写死 | 这个品类的商品不填这一项 | 文字 | [products.ts:572](../../apps/api/src/services/products.ts#L572) |
| `products.85723ae0` | 写死 | 司机语言只能是 {…} 之一 | 提示 | [products.ts:573](../../apps/api/src/services/products.ts#L573) |
| `products.8f4a14e8` | 写死 | 电话格式不对 | 提示 | [products.ts:574](../../apps/api/src/services/products.ts#L574) |
| `products.c83aa961` | 写死 | 至少要选一个区域 | 文字 | [products.ts:575](../../apps/api/src/services/products.ts#L575) |
| `products.65f61577` | 写死 | 至少要选一个车型组 | 文字 | [products.ts:576](../../apps/api/src/services/products.ts#L576) |
| `products.7ab98e9d` | 写死 | 至少要有一个调度人 | 文字 | [products.ts:577](../../apps/api/src/services/products.ts#L577) |
| `products.283bee7c` | 写死 | 子品牌已停用 | 文字 | [products.ts:578](../../apps/api/src/services/products.ts#L578) |
| `products.5de79217` | 写死 | 城市已被平台停用 | 文字 | [products.ts:579](../../apps/api/src/services/products.ts#L579) |
| `products.b41b2392` | 写死 | 还没有选接送点 | 文字 | [products.ts:580](../../apps/api/src/services/products.ts#L580) |
| `products.4517d7de` | 写死 | 接送点已被平台停用 | 文字 | [products.ts:581](../../apps/api/src/services/products.ts#L581) |
| `products.99699866` | 写死 | 接送点已经不在这个商品所在的城市（平台调整了它所属的城市） | 文字 | [products.ts:582](../../apps/api/src/services/products.ts#L582) |
| `products.86f5b973` | 写死 | 这个区域已停用 | 文字 | [products.ts:583](../../apps/api/src/services/products.ts#L583) |
| `products.1827ee5d` | 写死 | 这个区域所属的城市已被平台停用 | 文字 | [products.ts:584](../../apps/api/src/services/products.ts#L584) |
| `products.5ca1909a` | 写死 | 这个区域的业务类型和商品品类不一致 | 文字 | [products.ts:585](../../apps/api/src/services/products.ts#L585) |
| `products.1c053658` | 写死 | 这个车型组已被平台停用 | 文字 | [products.ts:586](../../apps/api/src/services/products.ts#L586) |
| `products.5904fb09` | 写死 | 选的「人数 / 行李数」已经不在这个车型组的可选组合里 | 文字 | [products.ts:587](../../apps/api/src/services/products.ts#L587) |
| `products.13d8e4bd` | 写死 | 这个附加服务已被平台停用 | 文字 | [products.ts:588](../../apps/api/src/services/products.ts#L588) |
| `products.385ba4c6` | 写死 | 这个附加服务不适用于这个品类 | 文字 | [products.ts:589](../../apps/api/src/services/products.ts#L589) |
| `products.5c612c04` | 写死 | 至少要有一条启用且未过期的价格规则 | 文字 | [products.ts:590](../../apps/api/src/services/products.ts#L590) |
| `products.49fd6640` | 写死 | 现有的价格都是给已经不在这个商品里的区域或车型组设的：请给现在选着的区域和车型组至少设一条启用且未过期的价格 | 文字 | [products.ts:591](../../apps/api/src/services/products.ts#L591) |
| `products.942e3691` | 写死 | 价格规则都停用了：至少要有一条启用且未过期的 | 文字 | [products.ts:592](../../apps/api/src/services/products.ts#L592) |
| `products.a1a5ca20` | 写死 | 启用的价格规则都过期了：至少要有一条启用且未过期的 | 文字 | [products.ts:593](../../apps/api/src/services/products.ts#L593) |
| `products.07ee7d28` | 写死 | 这条调价规则会把某些价格调到不大于 0（按取整单位取整之后），它生效时那些组合报不出价 | 文字 | [products.ts:594](../../apps/api/src/services/products.ts#L594) |
| `products.094e3014` | 写死 | 几条调价规则同时生效时，有些价格叠加、取整之后不大于 0 | 文字 | [products.ts:595](../../apps/api/src/services/products.ts#L595) |
| `products.ac262500` | 写死 | 调价规则生效时，有些价格调完超过了结算价的上限 | 文字 | [products.ts:596](../../apps/api/src/services/products.ts#L596) |
| `products.6c53f05f` | 写死 | 库存是限量的，但从今天起没有一天还有可售的库存，客人询价时报不出价 | 文字 | [products.ts:597](../../apps/api/src/services/products.ts#L597) |
| `products.b5e82dcd` | 写死 | 这个报价区域有一部分不在任何运营区域里，那部分不会报价。需要的话请补画运营区域 | 文字 | [products.ts:598](../../apps/api/src/services/products.ts#L598) |
| `products.13e774a4` | 写死 | 最低套餐比这个商品所有启用的套餐都长，这个商品将报不出价 | 文字 | [products.ts:599](../../apps/api/src/services/products.ts#L599) |
| `products.859e242e` | 写死 | 这个车型组还没有套餐价（按车型组 × 套餐填一次），报不出价 | 文字 | [products.ts:600](../../apps/api/src/services/products.ts#L600) |
| `products.7d852078` | 写死 | 城市热门地标清单里的这个地标不在这个商品的任何区域里：客人在这里上下车或经停报不出价。需要的话把它画进基础价、行程或上下车加价区域 | 文字 | [products.ts:601](../../apps/api/src/services/products.ts#L601) |
| `products.141528b9` | 写死 | 这个区域这个车型组没有填加价：空格 = 在这里不报价。不加钱请填 0 | 空状态 | [products.ts:602](../../apps/api/src/services/products.ts#L602) |
| `products.a90b293e` | 写死 | 这个商品有两个区域重叠：同一层的区域、基础价区域和上下车加价的区域都不能重叠。请到区域页面切掉重叠的部分 | 文字 | [products.ts:603](../../apps/api/src/services/products.ts#L603) |
| `products.1c54f100` | 写死 | 这项功能还没有上线 | 文字 | [products.ts:604](../../apps/api/src/services/products.ts#L604) |
| `products.f878d494` | 写死 | 提前预订时长是 0（用车之前随时可以订），用不上加急：请关掉加急，或把提前预订时长改成至少 1 小时 | 提示 | [products.ts:610](../../apps/api/src/services/products.ts#L610) |
| `products.d00ada3c` | 写死 | 加急的小时数不能超过提前预订时长（{…} 小时） | 提示 | [products.ts:611](../../apps/api/src/services/products.ts#L611) |
| `products.3254f34e` | 写死 | 请填 {…} 到 {…} 之间的整数 | 提示 | [products.ts:612](../../apps/api/src/services/products.ts#L612) |
| `products.64014672` | 写死 | 不能短于平台规定的免等时长（{…} 分钟） | 提示 | [products.ts:613](../../apps/api/src/services/products.ts#L613) |
| `products.751d9d55` | 写死 | 最低套餐 {…} 小时比这个商品所有启用的套餐（最长 {…} 小时）都长，这个商品将报不出价 | 提示 | [products.ts:614](../../apps/api/src/services/products.ts#L614) |
| `products.743e5a2d` | 写死 | 附加服务不存在 | 提示 | [products.ts:708](../../apps/api/src/services/products.ts#L708) |
| `products.5d1dd9c0` | 写死 | 例如 {date} {time}，今后一年里有 {dayCount} 天 | 文字 | [products.ts:783](../../apps/api/src/services/products.ts#L783) |
| `products.5c159b95` | 写死 | {who}生效时（{when}），有 {length} 条价格调完超过了结算价的上限，那些时候报不出价。请检查上调的幅度 | 提示 | [products.ts:786](../../apps/api/src/services/products.ts#L786) |
| `products.d30ac087` | 写死 | {who}同时生效时（{when}），有 {length} 条价格叠加、取整之后不大于 0，那些时候报不出价。请调小减价的幅度，或错开它们的日期、时段、适用范围 | 提示 | [products.ts:787](../../apps/api/src/services/products.ts#L787) |
| `products.0e21fd3c` | 写死 | 基础价区域（服务区域）之间 | 文字 | [products.ts:817](../../apps/api/src/services/products.ts#L817) |
| `products.800d9730` | 写死 | 行程加价的区域之间 | 文字 | [products.ts:818](../../apps/api/src/services/products.ts#L818) |
| `products.1a2d708a` | 写死 | 上下车加价的区域之间 | 文字 | [products.ts:819](../../apps/api/src/services/products.ts#L819) |
| `products.0aa95e8d` | 写死 | 基础价区域和上下车加价的区域 | 文字 | [products.ts:820](../../apps/api/src/services/products.ts#L820) |
| `products.ead430ed` | 写死 | 「{…}」和「{…}」 | 文字 | [products.ts:827](../../apps/api/src/services/products.ts#L827) |
| `products.29f66493` | 写死 | 和 | 文字 | [products.ts:830](../../apps/api/src/services/products.ts#L830) |
| `products.5a0f5f2d` | 写死 | 基础价区域{…}重叠约 {km2} 平方公里：在基础价区域里上下车不加价，两者不能重叠。请到区域页面用「从本区域减去另一个区域」切掉重叠的部分 | 提示 | [products.ts:830](../../apps/api/src/services/products.ts#L830) |
| `products.eca1f01e` | 写死 | 和上下车加价的区域 | 文字 | [products.ts:830](../../apps/api/src/services/products.ts#L830) |
| `products.7e2e576d` | 写死 | {…}{pair}重叠约 {km2} 平方公里：同一层的区域不能重叠（一个点只能有一个答案）。请到区域页面用「从本区域减去另一个区域」切掉重叠的部分 | 提示 | [products.ts:831](../../apps/api/src/services/products.ts#L831) |
| `products.ce61a826` | 写死 | 还没有开始试运营，商品不能上架：资质审核通过、签约并开始试运营以后才能上架 | 错误提示 | [products.ts:986](../../apps/api/src/services/products.ts#L986) |
| `products.37f96f5e` | 写死 | 还有上架条件没有满足 | 错误提示 | [products.ts:994](../../apps/api/src/services/products.ts#L994) |
| `products.2a20321e` | 写死 | 只有测试环境的 QA 测试供应商能把商品设为「验收可售」 | 错误提示 | [products.ts:1013](../../apps/api/src/services/products.ts#L1013) |
| `products.eb695fc1` | 写死 | 还有上架条件没有满足：验收可售和上架用同一份校验 | 错误提示 | [products.ts:1018](../../apps/api/src/services/products.ts#L1018) |
| `products.63f57b95` | 写死 | 草稿还没有上过架，不能下架 | 错误提示 | [products.ts:1033](../../apps/api/src/services/products.ts#L1033) |

## 运营代供应商回传履约（proxy-fulfilment.ts）

文件：`apps/api/src/services/proxy-fulfilment.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `proxy-fulfilment.eaf15359` | 写死 | 这一单还没付款，不能代传履约 | 错误提示 | [proxy-fulfilment.ts:47](../../apps/api/src/services/proxy-fulfilment.ts#L47) |
| `proxy-fulfilment.3311b754` | 写死 | 这一单已取消，不能代传履约 | 错误提示 | [proxy-fulfilment.ts:48](../../apps/api/src/services/proxy-fulfilment.ts#L48) |
| `proxy-fulfilment.3bce93b0` | 写死 | 这一单在救援改派中或已转给其他供应商，不能代传履约 | 错误提示 | [proxy-fulfilment.ts:49](../../apps/api/src/services/proxy-fulfilment.ts#L49) |
| `proxy-fulfilment.053a8813` | 写死 | 订单 | 错误提示 | [proxy-fulfilment.ts:77](../../apps/api/src/services/proxy-fulfilment.ts#L77)、119 行 |
| `proxy-fulfilment.8989e994` | 写死 | 这一单已经有一条代传「{…}」在等复核，请先处理那一条 | 错误提示 | [proxy-fulfilment.ts:90](../../apps/api/src/services/proxy-fulfilment.ts#L90) |
| `proxy-fulfilment.bfe0f334` | 写死 | 代供应商回传「{…}」：订单 {orderNo}，发生时间 {…}（当地） | 说明 | [proxy-fulfilment.ts:94](../../apps/api/src/services/proxy-fulfilment.ts#L94) |
| `proxy-fulfilment.9cb9c2b7` | 写死 | 这一单的状态已经变了（可能供应商或司机已经自己回传，或者已经取消）；请驳回 | 错误提示 | [proxy-fulfilment.ts:120](../../apps/api/src/services/proxy-fulfilment.ts#L120) |

## 测试环境专用的 QA 测试供应商（qa-tenant.ts）

文件：`apps/api/src/services/qa-tenant.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `qa-tenant.4b475410` | 写死 | QA 测试供应商（验收专用） | 名称 | [qa-tenant.ts:30](../../apps/api/src/services/qa-tenant.ts#L30) |
| `qa-tenant.959c6e44` | 写死 | QA 测试 | 文字 | [qa-tenant.ts:31](../../apps/api/src/services/qa-tenant.ts#L31) |
| `qa-tenant.74f1d917` | 写死 | QA 验收管理员 | 名称 | [qa-tenant.ts:32](../../apps/api/src/services/qa-tenant.ts#L32) |
| `qa-tenant.c728bff9` | 写死 | 需要密码：新建 QA 测试供应商或重设密码时要从标准输入给出密码 | 错误提示 | [qa-tenant.ts:66](../../apps/api/src/services/qa-tenant.ts#L66) |
| `qa-tenant.1cfb73c9` | 写死 | 供应商名称「{name}」里没有「{QA\_TENANT\_NAME\_MARK}」字样（可能被运营改过） | 错误提示 | [qa-tenant.ts:72](../../apps/api/src/services/qa-tenant.ts#L72) |
| `qa-tenant.2c57bb50` | 写死 | 这家 QA 测试供应商已被清退：只能查看，不能再写入 | 错误提示 | [qa-tenant.ts:73](../../apps/api/src/services/qa-tenant.ts#L73) |
| `qa-tenant.52e1d739` | 写死 | 这个邮箱的角色是 {role}，不是管理员 | 错误提示 | [qa-tenant.ts:74](../../apps/api/src/services/qa-tenant.ts#L74) |
| `qa-tenant.bf65543c` | 写死 | 这个账号现在是 {status}（不是在用），登录不了 | 错误提示 | [qa-tenant.ts:75](../../apps/api/src/services/qa-tenant.ts#L75) |
| `qa-tenant.fb1c30c8` | 写死 | 这个账号还没有设置密码：加 --reset-password 并从标准输入给出密码 | 错误提示 | [qa-tenant.ts:76](../../apps/api/src/services/qa-tenant.ts#L76) |
| `qa-tenant.6dc748f9` | 写死 | 已经有一家 QA 测试供应商「{name}」，这个邮箱不是它的账号（它的管理员：{…}）。没有做任何改动 | 错误提示 | [qa-tenant.ts:124](../../apps/api/src/services/qa-tenant.ts#L124) |
| `qa-tenant.c00d3190` | 写死 | 无 | 错误提示 | [qa-tenant.ts:124](../../apps/api/src/services/qa-tenant.ts#L124) |
| `qa-tenant.f3bec173` | 写死 | 另一次运行刚刚建好了 QA 测试供应商：请重新运行一次（这次会只核对） | 错误提示 | [qa-tenant.ts:135](../../apps/api/src/services/qa-tenant.ts#L135) |
| `qa-tenant.863de598` | 写死 | 不存在 | 错误提示 | [qa-tenant.ts:148](../../apps/api/src/services/qa-tenant.ts#L148) |
| `qa-tenant.f3745ba4` | 写死 | 这个账号现在是 {…}（不是在用），密码没有改动：请先在平台后台启用它 | 错误提示 | [qa-tenant.ts:148](../../apps/api/src/services/qa-tenant.ts#L148) |

## 报价（quotes.ts）

文件：`apps/api/src/services/quotes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `quotes.cd83f150` | 写死 | 必填 | 提示 | [quotes.ts:90](../../apps/api/src/services/quotes.ts#L90) |
| `quotes.5f702374` | 写死 | 这个品类不填这一项 | 文字 | [quotes.ts:91](../../apps/api/src/services/quotes.ts#L91) |
| `quotes.b952b55e` | 写死 | 超出了允许的范围 | 文字 | [quotes.ts:92](../../apps/api/src/services/quotes.ts#L92) |
| `quotes.54c463c4` | 写死 | 用车时间要写成当地时间 YYYY-MM-DDTHH:mm，而且是真实存在的日期 | 提示 | [quotes.ts:93](../../apps/api/src/services/quotes.ts#L93) |
| `quotes.030f3134` | 写死 | 重复了 | 文字 | [quotes.ts:94](../../apps/api/src/services/quotes.ts#L94) |
| `quotes.88b051b8` | 写死 | 里程要在 0 到 5000 公里之间（米），时长要在 0 到 7 天之间（分钟），都是整数 | 提示 | [quotes.ts:100](../../apps/api/src/services/quotes.ts#L100) |
| `quotes.31d3fe39` | 写死 | 路线预估 | 文字 | [quotes.ts:153](../../apps/api/src/services/quotes.ts#L153) |
| `quotes.3fcd30c2` | 写死 | {…}超过 {timeoutMs} 毫秒没有结果 | 文字 | [quotes.ts:153](../../apps/api/src/services/quotes.ts#L153) |
| `quotes.6262101c` | 写死 | 汇率 | 文字 | [quotes.ts:153](../../apps/api/src/services/quotes.ts#L153) |
| `quotes.143f7446` | 写死 | 这个渠道没有被授权卖这个城市 | 错误提示 | [quotes.ts:267](../../apps/api/src/services/quotes.ts#L267) |
| `quotes.48e345c0` | 写死 | 这个渠道没有被授权卖这个品类 | 错误提示 | [quotes.ts:267](../../apps/api/src/services/quotes.ts#L267) |
| `quotes.d1295fdc` | 写死 | 不支持这个币种 | 提示 | [quotes.ts:309](../../apps/api/src/services/quotes.ts#L309) |
| `quotes.a2559002` | 写死 | 接送机要给机场或车站 | 提示 | [quotes.ts:311](../../apps/api/src/services/quotes.ts#L311) |
| `quotes.ce7094a4` | 写死 | 城市不存在 | 提示 | [quotes.ts:322](../../apps/api/src/services/quotes.ts#L322) |
| `quotes.341d85f2` | 写死 | 接送点不存在、不是机场或车站，或者不在这个城市 | 提示 | [quotes.ts:325](../../apps/api/src/services/quotes.ts#L325) |
| `quotes.0a4a2f9b` | 写死 | 这个城市已被平台停用，现在不报价 | 文字 | [quotes.ts:328](../../apps/api/src/services/quotes.ts#L328) |
| `quotes.cf302d3c` | 写死 | 这个机场或车站已被平台停用，现在不报价 | 文字 | [quotes.ts:329](../../apps/api/src/services/quotes.ts#L329) |
| `quotes.2fef05ce` | 写死 | 渠道不存在 | 提示 | [quotes.ts:334](../../apps/api/src/services/quotes.ts#L334) |
| `quotes.a1ff1475` | 写死 | 商品 | 错误提示 | [quotes.ts:414](../../apps/api/src/services/quotes.ts#L414) |
| `quotes.001df296` | 写死 | 这个商品所在的城市或它的接送点已被平台停用，现在报不了价 | 文字 | [quotes.ts:419](../../apps/api/src/services/quotes.ts#L419) |

## /sales/v1 的限流（rate-limit.ts）

文件：`apps/api/src/services/rate-limit.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `rate-limit.b45a123a` | 写死 | 请求过于频繁，请稍后再试 | 错误提示 | [rate-limit.ts:109](../../apps/api/src/services/rate-limit.ts#L109) |

## 救援改派与违约金（rescues.ts）

文件：`apps/api/src/services/rescues.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `rescues.bbd7ef12` | 写死 | 订单当前的状态不能进入救援改派（只有已确认、已派车、司机已出发的单可以；派了车就不是「未派车」） | 提示 | [rescues.ts:131](../../apps/api/src/services/rescues.ts#L131) |
| `rescues.c818efeb` | 写死 | 还没到这种情形的触发时间（未派车：用车前 6 小时、且过了派车截止时间；司机未到：到点 15 分钟后，改派转来的单到点不早于改派后 60 分钟） | 提示 | [rescues.ts:132](../../apps/api/src/services/rescues.ts#L132) |
| `rescues.e773e1db` | 写死 | 这家供应商现在没有被暂停 | 提示 | [rescues.ts:133](../../apps/api/src/services/rescues.ts#L133) |
| `rescues.aaa42eba` | 写死 | 用车时间已经到了，不是未来订单 | 提示 | [rescues.ts:134](../../apps/api/src/services/rescues.ts#L134) |
| `rescues.cd401fc6` | 写死 | 这张单已经在救援改派中了 | 错误提示 | [rescues.ts:138](../../apps/api/src/services/rescues.ts#L138)、265 行 |
| `rescues.f6c58bf2` | 写死 | 这是测试环境的验收单，不能救援改派给别的供应商；不需要了请取消 | 错误提示 | [rescues.ts:221](../../apps/api/src/services/rescues.ts#L221) |
| `rescues.80bc86d6` | 写死 | 订单 | 错误提示 | [rescues.ts:322](../../apps/api/src/services/rescues.ts#L322)、325、379、439、870 行 |
| `rescues.e2498854` | 写死 | 这张订单还没付款：付款完成、订单确认后才能发起救援改派 | 错误提示 | [rescues.ts:326](../../apps/api/src/services/rescues.ts#L326) |
| `rescues.5eaca030` | 写死 | 租户 | 错误提示 | [rescues.ts:354](../../apps/api/src/services/rescues.ts#L354)、710 行 |
| `rescues.668ecfdb` | 写死 | 这家供应商现在没有被暂停或清退（观察期不算） | 错误提示 | [rescues.ts:355](../../apps/api/src/services/rescues.ts#L355) |
| `rescues.818d2f92` | 写死 | 订单当前的状态不能报告司机没到（司机已到达、服务已开始、订单已取消或正在为您改派） | 错误提示 | [rescues.ts:382](../../apps/api/src/services/rescues.ts#L382) |
| `rescues.002636dd` | 写死 | 还没到用车时间 | 错误提示 | [rescues.ts:383](../../apps/api/src/services/rescues.ts#L383) |
| `rescues.ef2952d5` | 写死 | 这张单现在不在救援改派中 | 错误提示 | [rescues.ts:441](../../apps/api/src/services/rescues.ts#L441)、872 行 |
| `rescues.185dd53d` | 写死 | 现在没有能接这一单的候选供应商；可以人工指定（双人复核）或取消订单全额退款 | 错误提示 | [rescues.ts:588](../../apps/api/src/services/rescues.ts#L588) |
| `rescues.84d470ac` | 写死 | 这家供应商现在不是这一单的候选（报不出价、已经拒绝或超时、或以前接过这一单） | 错误提示 | [rescues.ts:588](../../apps/api/src/services/rescues.ts#L588) |
| `rescues.3fb07a1a` | 写死 | 这张单现在不在救援改派中（可能刚被别人处理了） | 错误提示 | [rescues.ts:598](../../apps/api/src/services/rescues.ts#L598) |
| `rescues.8445366f` | 写死 | 已经有一张救援单在等供应商接单，等它有结果（接、拒或超时）再发下一张 | 错误提示 | [rescues.ts:601](../../apps/api/src/services/rescues.ts#L601) |
| `rescues.9e8f7020` | 写死 | 这次救援已经给这家发过救援单了 | 错误提示 | [rescues.ts:602](../../apps/api/src/services/rescues.ts#L602) |
| `rescues.abcc1b44` | 写死 | 刚有人给这一单发了救援单，请刷新 | 错误提示 | [rescues.ts:606](../../apps/api/src/services/rescues.ts#L606) |
| `rescues.390632ec` | 写死 | 救援单 | 错误提示 | [rescues.ts:661](../../apps/api/src/services/rescues.ts#L661)、1044 行 |
| `rescues.a7dc8b19` | 写死 | 这张救援单已经有结果了（接了、拒了、超时或被收回） | 错误提示 | [rescues.ts:666](../../apps/api/src/services/rescues.ts#L666) |
| `rescues.b3ab9859` | 写死 | 这家供应商现在不能接单（暂停中、已清退或还没开始试运营） | 错误提示 | [rescues.ts:711](../../apps/api/src/services/rescues.ts#L711)、879 行 |
| `rescues.53071968` | 写死 | 商品 | 错误提示 | [rescues.ts:713](../../apps/api/src/services/rescues.ts#L713) |
| `rescues.3fc6abbe` | 写死 | 这个商品在用车那一天已经订满了，接不了这一单 | 错误提示 | [rescues.ts:716](../../apps/api/src/services/rescues.ts#L716) |
| `rescues.cf7ff563` | 写死 | 换算救援差价要的汇率取不到（两家的结算币种不同） | 错误提示 | [rescues.ts:750](../../apps/api/src/services/rescues.ts#L750) |
| `rescues.edcec47f` | 写死 | 这张单没有救援记录：不可抗力免违约金只用于救援改派的单（取消订单请选「不可抗力」原因） | 错误提示 | [rescues.ts:816](../../apps/api/src/services/rescues.ts#L816) |
| `rescues.333d1739` | 写死 | 这次救援已经认定过不可抗力了 | 错误提示 | [rescues.ts:818](../../apps/api/src/services/rescues.ts#L818) |
| `rescues.3b417213` | 写死 | 还有一张救援单在等供应商接单，等它有结果再人工指定 | 错误提示 | [rescues.ts:874](../../apps/api/src/services/rescues.ts#L874) |
| `rescues.1adf942b` | 写死 | 这家以前接过这一单（原供应商），不能再指定给它 | 提示 | [rescues.ts:876](../../apps/api/src/services/rescues.ts#L876) |
| `rescues.59bfc2b4` | 写死 | 供应商不存在 | 提示 | [rescues.ts:878](../../apps/api/src/services/rescues.ts#L878) |
| `rescues.7f7b3009` | 写死 | 这家供应商没有这个商品 | 提示 | [rescues.ts:888](../../apps/api/src/services/rescues.ts#L888) |
| `rescues.bc16d30f` | 写死 | 商品要和这一单同城市、同品类（接送机同一个接送点），并且有这一单的车型组 | 提示 | [rescues.ts:890](../../apps/api/src/services/rescues.ts#L890) |
| `rescues.db977bba` | 写死 | 取不到 {currency} → {currency} 的汇率，换算不了救援差价 | 错误提示 | [rescues.ts:898](../../apps/api/src/services/rescues.ts#L898) |
| `rescues.abaa5228` | 写死 | 订单 {orderNo} 救援改派人工指定给「{tenantName}」：结算价 {settlementMinor} {currency}（原结算价 {originalSettlementMinor} {originalSettlementCurrency}） | 说明 | [rescues.ts:905](../../apps/api/src/services/rescues.ts#L905) |
| `rescues.4c07bd24` | 写死 | 这张单已经不在这次救援改派中了（可能已经被接走或取消）；请驳回 | 错误提示 | [rescues.ts:939](../../apps/api/src/services/rescues.ts#L939) |

## /sales/v1 的渠道鉴权（sales-auth.ts）

文件：`apps/api/src/services/sales-auth.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `sales-auth.613b98d6` | 写死 | client\_id 或 client\_secret 不正确，或这个客户端已经吊销 | 错误提示 | [sales-auth.ts:34](../../apps/api/src/services/sales-auth.ts#L34) |
| `sales-auth.38ccdf35` | 写死 | 访问令牌无效或已过期，请用 client\_id 和 client\_secret 重新换取 | 错误提示 | [sales-auth.ts:38](../../apps/api/src/services/sales-auth.ts#L38) |
| `sales-auth.66a4802f` | 写死 | 这个渠道已被平台暂停，现在不能调用销售端接口 | 错误提示 | [sales-auth.ts:42](../../apps/api/src/services/sales-auth.ts#L42) |

## 正式询价 POST /sales/v1/quotes、GET…（sales-quotes.ts）

文件：`apps/api/src/services/sales-quotes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `sales-quotes.9d9d2bc3` | 写死 | 城市不存在 | 提示 | [sales-quotes.ts:258](../../apps/api/src/services/sales-quotes.ts#L258) |
| `sales-quotes.003b5e10` | 写死 | 地点不存在、已停用，或者不在这个城市 | 提示 | [sales-quotes.ts:264](../../apps/api/src/services/sales-quotes.ts#L264) |
| `sales-quotes.65e6c082` | 写死 | 接送机的机场 / 车站那一端用 place\_id，这里填另一端 | 提示 | [sales-quotes.ts:268](../../apps/api/src/services/sales-quotes.ts#L268) |
| `sales-quotes.16165fec` | 写死 | 报价已过有效期，请重新询价 | 文字 | [sales-quotes.ts:477](../../apps/api/src/services/sales-quotes.ts#L477) |
| `sales-quotes.c4d967ce` | 写死 | 报价不存在 | 错误提示 | [sales-quotes.ts:487](../../apps/api/src/services/sales-quotes.ts#L487) |

## 区域共享库（shared-areas.ts）

文件：`apps/api/src/services/shared-areas.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `shared-areas.c8c98e56` | 写死 | 共享区域 | 错误提示 | [shared-areas.ts:55](../../apps/api/src/services/shared-areas.ts#L55)、168 行 |
| `shared-areas.aa5b45a2` | 写死 | 区域 | 错误提示 | [shared-areas.ts:130](../../apps/api/src/services/shared-areas.ts#L130) |
| `shared-areas.ae06979e` | 写死 | 这个区域是自己画的，不是从共享库引用的 | 错误提示 | [shared-areas.ts:131](../../apps/api/src/services/shared-areas.ts#L131) |
| `shared-areas.61bada85` | 写死 | 来源区域已经不在共享库里了（可能被停用或删除），你的区域保持现在的图形 | 错误提示 | [shared-areas.ts:134](../../apps/api/src/services/shared-areas.ts#L134) |
| `shared-areas.560f2d34` | 写死 | 这块区域你名下已经有了（共享库里的这一份就是你自己建的区域），直接用它即可 | 错误提示 | [shared-areas.ts:169](../../apps/api/src/services/shared-areas.ts#L169) |
| `shared-areas.86c1fedd` | 写死 | 共享区域不存在（可能已停用、删除，或是引用来的副本） | 提示 | [shared-areas.ts:237](../../apps/api/src/services/shared-areas.ts#L237) |
| `shared-areas.38d5b4b2` | 写死 | 这个区域已经标为重复了；要改指向，先撤销 | 提示 | [shared-areas.ts:238](../../apps/api/src/services/shared-areas.ts#L238) |
| `shared-areas.3208cc16` | 写死 | 有别的区域被标成了它的重复（它是保留的那份）；先撤销那些标记 | 提示 | [shared-areas.ts:239](../../apps/api/src/services/shared-areas.ts#L239) |
| `shared-areas.ef74a978` | 写死 | 保留的那份不在共享库里，或者自己也已标为重复 | 提示 | [shared-areas.ts:240](../../apps/api/src/services/shared-areas.ts#L240) |
| `shared-areas.bb946b21` | 写死 | 两个区域不在同一个城市 | 提示 | [shared-areas.ts:241](../../apps/api/src/services/shared-areas.ts#L241) |
| `shared-areas.f8272fb6` | 写死 | 不能把区域标成它自己的重复 | 提示 | [shared-areas.ts:242](../../apps/api/src/services/shared-areas.ts#L242) |
| `shared-areas.1a380915` | 写死 | 这个区域没有标为重复，不用撤销 | 错误提示 | [shared-areas.ts:284](../../apps/api/src/services/shared-areas.ts#L284) |

## 官网（site.ts）

文件：`apps/api/src/services/site.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `site.5b4aed8a` | 写死 | 官网暂未开放预订，请稍后再来 | 错误提示 | [site.ts:134](../../apps/api/src/services/site.ts#L134) |
| `site.07e3200b` | 写死 | 订单链接无效或已过期，请在「查订单」填订单号和下单邮箱，我们会把新链接发到下单邮箱 | 错误提示 | [site.ts:138](../../apps/api/src/services/site.ts#L138) |
| `site.20181878` | 写死 | 暂时发不了邮件，请联系客服找回订单 | 错误提示 | [site.ts:142](../../apps/api/src/services/site.ts#L142) |
| `site.2a6cc074` | 写死 | 地点 | 错误提示 | [site.ts:443](../../apps/api/src/services/site.ts#L443) |
| `site.65ebce5a` | 写死 | 城市不存在或暂不开放 | 提示 | [site.ts:483](../../apps/api/src/services/site.ts#L483)、751 行 |
| `site.276319f5` | 写死 | 这个位置离城市太远，请在城市附近选点 | 提示 | [site.ts:624](../../apps/api/src/services/site.ts#L624) |
| `site.27f09bde` | 写死 | 第 {leg} 段路线暂时算不出来，没法按行程报价，请联系客服人工报价 | 错误提示 | [site.ts:756](../../apps/api/src/services/site.ts#L756) |
| `site.003064a0` | 写死 | 机场不存在、已停用，或者不在这个城市 | 提示 | [site.ts:953](../../apps/api/src/services/site.ts#L953) |
| `site.35a599b0` | 写死 | 用车时间写成当地的 YYYY-MM-DDTHH:mm，并且是这个城市里存在的时间 | 提示 | [site.ts:959](../../apps/api/src/services/site.ts#L959) |

## 租户用户的登录、会话校验、退出、接受邀请（tenant-auth.ts）

文件：`apps/api/src/services/tenant-auth.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-auth.d0674d08` | 写死 | 这家供应商已清退，后台只能查看历史，不能再修改 | 错误提示 | [tenant-auth.ts:264](../../apps/api/src/services/tenant-auth.ts#L264) |

## 供应商的每日检查（tenant-jobs.ts）

文件：`apps/api/src/services/tenant-jobs.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-jobs.ebcc39d5` | 写死 | 试运营满 {trialMinDays} 天，完成 {completed} 单，没有重大投诉 | 说明 | [tenant-jobs.ts:147](../../apps/api/src/services/tenant-jobs.ts#L147) |
| `tenant-jobs.e43f934b` | 写死 | 资质已恢复有效 | 说明 | [tenant-jobs.ts:169](../../apps/api/src/services/tenant-jobs.ts#L169) |
| `tenant-jobs.bb494619` | 写死 | 必交资质已到期 | 文字 | [tenant-jobs.ts:178](../../apps/api/src/services/tenant-jobs.ts#L178) |
| `tenant-jobs.32d79416` | 写死 | 履约评分低于 {…} | 文字 | [tenant-jobs.ts:179](../../apps/api/src/services/tenant-jobs.ts#L179) |
| `tenant-jobs.844a48c7` | 写死 | 近 {noShowWindowDays} 天司机未到 {noShowSuspendCount} 次 | 文字 | [tenant-jobs.ts:180](../../apps/api/src/services/tenant-jobs.ts#L180) |
| `tenant-jobs.46385694` | 写死 | 人工暂停 | 文字 | [tenant-jobs.ts:181](../../apps/api/src/services/tenant-jobs.ts#L181) |

## 供应商入驻（tenant-onboarding.ts）

文件：`apps/api/src/services/tenant-onboarding.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-onboarding.f156c5b1` | 写死 | 必填 | 提示 | [tenant-onboarding.ts:112](../../apps/api/src/services/tenant-onboarding.ts#L112) |
| `tenant-onboarding.49f1266e` | 写死 | 这种证件没有到期日 | 文字 | [tenant-onboarding.ts:113](../../apps/api/src/services/tenant-onboarding.ts#L113) |
| `tenant-onboarding.a6edfb96` | 写死 | 不是合法的日期（YYYY-MM-DD） | 提示 | [tenant-onboarding.ts:114](../../apps/api/src/services/tenant-onboarding.ts#L114) |
| `tenant-onboarding.bc26190d` | 写死 | 到期日已经到了或过了：请上传还在有效期内的证件 | 文字 | [tenant-onboarding.ts:115](../../apps/api/src/services/tenant-onboarding.ts#L115) |
| `tenant-onboarding.30b91e20` | 写死 | 不认识的证件类型 | 文字 | [tenant-onboarding.ts:116](../../apps/api/src/services/tenant-onboarding.ts#L116) |
| `tenant-onboarding.475fd31c` | 写死 | 太长了 | 文字 | [tenant-onboarding.ts:117](../../apps/api/src/services/tenant-onboarding.ts#L117) |
| `tenant-onboarding.a2385c8b` | 写死 | 生效日期不能早于今天 | 文字 | [tenant-onboarding.ts:118](../../apps/api/src/services/tenant-onboarding.ts#L118) |
| `tenant-onboarding.a8390d2b` | 写死 | 生效日期要晚于已有的最后一个合同版本 | 文字 | [tenant-onboarding.ts:119](../../apps/api/src/services/tenant-onboarding.ts#L119) |
| `tenant-onboarding.bdd2d147` | 写死 | 不支持这个币种 | 文字 | [tenant-onboarding.ts:120](../../apps/api/src/services/tenant-onboarding.ts#L120) |
| `tenant-onboarding.456a1658` | 写死 | 文件不存在，或不是这家供应商的 | 文字 | [tenant-onboarding.ts:121](../../apps/api/src/services/tenant-onboarding.ts#L121) |
| `tenant-onboarding.3e184291` | 写死 | 这个文件不能用在这里（资质要用资质文件，合同要用合同文件） | 文字 | [tenant-onboarding.ts:122](../../apps/api/src/services/tenant-onboarding.ts#L122) |
| `tenant-onboarding.2db05ff6` | 写死 | 这是测试环境专用的 QA 测试供应商：只用于验收，不能开始试运营、不能上架、不参与比价 | 错误提示 | [tenant-onboarding.ts:207](../../apps/api/src/services/tenant-onboarding.ts#L207) |
| `tenant-onboarding.843850bc` | 写死 | 供应商现在是「{…}」，不能做这一步 | 错误提示 | [tenant-onboarding.ts:214](../../apps/api/src/services/tenant-onboarding.ts#L214) |
| `tenant-onboarding.b4e00de4` | 写死 | 供应商 | 错误提示 | [tenant-onboarding.ts:299](../../apps/api/src/services/tenant-onboarding.ts#L299)、314、432、456 行 |
| `tenant-onboarding.1ad8e1cd` | 写死 | 审核通过以后不能直接改{…}：法定名称、登记号请提交修改申请，由平台审核；所在国家请联系平台 | 错误提示 | [tenant-onboarding.ts:336](../../apps/api/src/services/tenant-onboarding.ts#L336) |
| `tenant-onboarding.49442228` | 写死 | 文件是空的 | 提示 | [tenant-onboarding.ts:361](../../apps/api/src/services/tenant-onboarding.ts#L361) |
| `tenant-onboarding.6f5b15f6` | 写死 | 文件太大了：最大 10 MB | 错误提示 | [tenant-onboarding.ts:362](../../apps/api/src/services/tenant-onboarding.ts#L362) |
| `tenant-onboarding.5363f4ec` | 写死 | 只收 PDF、JPEG、PNG 文件，并且请求头的 Content-Type 要和文件的实际格式一致 | 错误提示 | [tenant-onboarding.ts:365](../../apps/api/src/services/tenant-onboarding.ts#L365) |
| `tenant-onboarding.0054cb79` | 写死 | 文件 | 错误提示 | [tenant-onboarding.ts:388](../../apps/api/src/services/tenant-onboarding.ts#L388)、474 行 |
| `tenant-onboarding.61e1b805` | 写死 | 这个文件已经提交过一次了；要再交，请重新上传 | 错误提示 | [tenant-onboarding.ts:414](../../apps/api/src/services/tenant-onboarding.ts#L414) |
| `tenant-onboarding.e7a01da3` | 写死 | 资料还没有交齐，不能提交审核 | 文字 | [tenant-onboarding.ts:435](../../apps/api/src/services/tenant-onboarding.ts#L435) |
| `tenant-onboarding.7f6bc80b` | 写死 | 已清退的供应商不能再上传合同 | 错误提示 | [tenant-onboarding.ts:491](../../apps/api/src/services/tenant-onboarding.ts#L491) |
| `tenant-onboarding.cc05e44d` | 写死 | 资质 | 错误提示 | [tenant-onboarding.ts:516](../../apps/api/src/services/tenant-onboarding.ts#L516) |
| `tenant-onboarding.08ac1548` | 写死 | 已清退的供应商不再审核资质 | 错误提示 | [tenant-onboarding.ts:517](../../apps/api/src/services/tenant-onboarding.ts#L517) |
| `tenant-onboarding.0560b439` | 写死 | 这份资质已经审核过了 | 错误提示 | [tenant-onboarding.ts:518](../../apps/api/src/services/tenant-onboarding.ts#L518) |
| `tenant-onboarding.3e09b0dc` | 写死 | 供应商之后又交了一份同类型的资质，请审核最新的那份 | 错误提示 | [tenant-onboarding.ts:519](../../apps/api/src/services/tenant-onboarding.ts#L519) |
| `tenant-onboarding.960c0599` | 写死 | 资质已更新 | 说明 | [tenant-onboarding.ts:542](../../apps/api/src/services/tenant-onboarding.ts#L542) |
| `tenant-onboarding.ac85bfc6` | 写死 | 还不能签约 | 文字 | [tenant-onboarding.ts:557](../../apps/api/src/services/tenant-onboarding.ts#L557) |
| `tenant-onboarding.df409f9b` | 写死 | 还不能开始试运营 | 文字 | [tenant-onboarding.ts:581](../../apps/api/src/services/tenant-onboarding.ts#L581) |
| `tenant-onboarding.aab98e8b` | 写死 | 有必交资质已过期：请供应商换上新证件，审核通过后会自动恢复 | 错误提示 | [tenant-onboarding.ts:598](../../apps/api/src/services/tenant-onboarding.ts#L598) |
| `tenant-onboarding.29869064` | 写死 | 供应商现在的状态不能暂停 | 错误提示 | [tenant-onboarding.ts:614](../../apps/api/src/services/tenant-onboarding.ts#L614) |
| `tenant-onboarding.f8e1be4e` | 写死 | 供应商已清退 | 错误提示 | [tenant-onboarding.ts:642](../../apps/api/src/services/tenant-onboarding.ts#L642) |
| `tenant-onboarding.87313453` | 写死 | 合同生效日期 {validFrom} 已早于今天（{today}），不能追溯修改结算条款：请驳回或撤回后按新的生效日期重新发起 | 错误提示 | [tenant-onboarding.ts:675](../../apps/api/src/services/tenant-onboarding.ts#L675) |
| `tenant-onboarding.f8fc3257` | 写死 | 这家供应商还有没履约完的订单，全部完成或取消以后才能清退 | 错误提示 | [tenant-onboarding.ts:679](../../apps/api/src/services/tenant-onboarding.ts#L679) |
| `tenant-onboarding.a528df2d` | 写死 | 这家供应商已经被人工暂停了 | 错误提示 | [tenant-onboarding.ts:691](../../apps/api/src/services/tenant-onboarding.ts#L691) |
| `tenant-onboarding.c38b3258` | 写死 | 供应商现在是「{…}」，还不参与比价，不用暂停 | 错误提示 | [tenant-onboarding.ts:692](../../apps/api/src/services/tenant-onboarding.ts#L692) |
| `tenant-onboarding.79d003ae` | 写死 | 暂停供应商「{name}」：{reason} | 说明 | [tenant-onboarding.ts:696](../../apps/api/src/services/tenant-onboarding.ts#L696) |
| `tenant-onboarding.eab720e2` | 写死 | 这家供应商已经清退了 | 错误提示 | [tenant-onboarding.ts:711](../../apps/api/src/services/tenant-onboarding.ts#L711) |
| `tenant-onboarding.55c1ec48` | 写死 | 清退供应商「{name}」：{reason} | 说明 | [tenant-onboarding.ts:717](../../apps/api/src/services/tenant-onboarding.ts#L717) |
| `tenant-onboarding.afcc9941` | 写死 | 已清退的供应商不能再签合同 | 错误提示 | [tenant-onboarding.ts:740](../../apps/api/src/services/tenant-onboarding.ts#L740) |
| `tenant-onboarding.d4440724` | 写死 | 供应商「{name}」的合同第 {version} 版：{validFrom} 起生效，结算币种 {settleCurrency}，月结、次月 {paymentDay} 日付款 | 说明 | [tenant-onboarding.ts:755](../../apps/api/src/services/tenant-onboarding.ts#L755) |

## 租户用户管理（tenant-users.ts）

文件：`apps/api/src/services/tenant-users.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-users.3132c31e` | 写死 | 账号 | 错误提示 | [tenant-users.ts:128](../../apps/api/src/services/tenant-users.ts#L128)、219 行 |
| `tenant-users.11433b54` | 写死 | 管理员 | 文字 | [tenant-users.ts:133](../../apps/api/src/services/tenant-users.ts#L133) |

## 推送给供应商（tenant-webhooks.ts）

文件：`apps/api/src/services/tenant-webhooks.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-webhooks.25fabb72` | 写死 | 平台还没有配置数据加密密钥（DATA\_ENCRYPTION\_KEY），现在不能设置 Webhook。请联系平台 | 错误提示 | [tenant-webhooks.ts:56](../../apps/api/src/services/tenant-webhooks.ts#L56) |
| `tenant-webhooks.c596ab90` | 写死 | 不是合法的网址 | 提示 | [tenant-webhooks.ts:70](../../apps/api/src/services/tenant-webhooks.ts#L70) |
| `tenant-webhooks.12a9cce8` | 写死 | 网址太长了（最多 2048 个字符） | 文字 | [tenant-webhooks.ts:71](../../apps/api/src/services/tenant-webhooks.ts#L71) |
| `tenant-webhooks.eeabf7c6` | 写死 | 只接受 https:// 开头的地址 | 文字 | [tenant-webhooks.ts:72](../../apps/api/src/services/tenant-webhooks.ts#L72) |
| `tenant-webhooks.035ccb54` | 写死 | 网址里不能带账号和密码 | 文字 | [tenant-webhooks.ts:73](../../apps/api/src/services/tenant-webhooks.ts#L73) |
| `tenant-webhooks.0a591d2a` | 写死 | 网址里不能带 \# | 文字 | [tenant-webhooks.ts:74](../../apps/api/src/services/tenant-webhooks.ts#L74) |
| `tenant-webhooks.3ac03104` | 写死 | 不能推送到内网、本机或云服务器的元数据地址，请填公网可以访问的地址 | 文字 | [tenant-webhooks.ts:75](../../apps/api/src/services/tenant-webhooks.ts#L75) |
| `tenant-webhooks.54566b88` | 写死 | Webhook 设置 | 错误提示 | [tenant-webhooks.ts:144](../../apps/api/src/services/tenant-webhooks.ts#L144)、158、249 行 |
| `tenant-webhooks.d507a719` | 写死 | 这是一条测试事件，用来确认接收地址和签名校验是否正常 | 提示 | [tenant-webhooks.ts:185](../../apps/api/src/services/tenant-webhooks.ts#L185) |
| `tenant-webhooks.36c477e1` | 写死 | 投递记录 | 错误提示 | [tenant-webhooks.ts:289](../../apps/api/src/services/tenant-webhooks.ts#L289)、306、345、370 行 |
| `tenant-webhooks.ac755a2d` | 写死 | 这条推送已经成功，不需要重推 | 错误提示 | [tenant-webhooks.ts:297](../../apps/api/src/services/tenant-webhooks.ts#L297) |
| `tenant-webhooks.c14b3d02` | 写死 | 测试事件不能重推，请重新发送测试事件 | 错误提示 | [tenant-webhooks.ts:308](../../apps/api/src/services/tenant-webhooks.ts#L308) |

## 工单（tickets.ts）

文件：`apps/api/src/services/tickets.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tickets.342e53d8` | 写死 | 工单现在的状态不能做这一步 | 错误提示 | [tickets.ts:100](../../apps/api/src/services/tickets.ts#L100) |
| `tickets.b7310dae` | 写死 | 工单刚被别人改过，请刷新后再试 | 错误提示 | [tickets.ts:104](../../apps/api/src/services/tickets.ts#L104) |
| `tickets.48e5a586` | 写死 | 这张订单还没付款，付款完成后才能建工单 | 错误提示 | [tickets.ts:146](../../apps/api/src/services/tickets.ts#L146) |
| `tickets.e47765fe` | 写死 | 这张订单没有付过款就取消了，不能建工单 | 错误提示 | [tickets.ts:146](../../apps/api/src/services/tickets.ts#L146) |
| `tickets.3bfd2152` | 写死 | 这一类工单不能由这个来源建 | 错误提示 | [tickets.ts:150](../../apps/api/src/services/tickets.ts#L150) |
| `tickets.88b73f20` | 写死 | 订单 | 错误提示 | [tickets.ts:152](../../apps/api/src/services/tickets.ts#L152)、187、205、220、261、509、748、759 行 |
| `tickets.f60aefb6` | 写死 | 已经超过投诉时限（服务后 14 天内） | 错误提示 | [tickets.ts:155](../../apps/api/src/services/tickets.ts#L155) |
| `tickets.cbbb0890` | 写死 | 这个供应商没有接过这一单 | 错误提示 | [tickets.ts:191](../../apps/api/src/services/tickets.ts#L191) |
| `tickets.b629a222` | 写死 | 这一单的工单已经很多了，请直接联系客服 | 错误提示 | [tickets.ts:209](../../apps/api/src/services/tickets.ts#L209) |
| `tickets.87498495` | 写死 | 申诉要指明是对哪一张工单的判定 | 提示 | [tickets.ts:248](../../apps/api/src/services/tickets.ts#L248) |
| `tickets.e26d0c23` | 写死 | 工单 | 错误提示 | [tickets.ts:250](../../apps/api/src/services/tickets.ts#L250)、296、322、360、384、597、772、854 行 |
| `tickets.1c80b000` | 写死 | 这张工单的判定对你没有不利（或还没判定），不能申诉 | 错误提示 | [tickets.ts:252](../../apps/api/src/services/tickets.ts#L252) |
| `tickets.74e55b7a` | 写死 | 已经超过申诉期限（判定后 7 天内） | 错误提示 | [tickets.ts:253](../../apps/api/src/services/tickets.ts#L253) |
| `tickets.be731a0a` | 写死 | 这张工单的判定已经申诉过了（只能申诉一次） | 错误提示 | [tickets.ts:254](../../apps/api/src/services/tickets.ts#L254) |
| `tickets.9f3960b6` | 写死 | 只有申诉要指明工单 | 提示 | [tickets.ts:257](../../apps/api/src/services/tickets.ts#L257) |
| `tickets.42400f68` | 写死 | 必填 | 提示 | [tickets.ts:258](../../apps/api/src/services/tickets.ts#L258) |
| `tickets.c6618fca` | 写死 | 司机提交了客人未出现（no-show），5 项证据已在提交时核对，请审核。 | 说明 | [tickets.ts:278](../../apps/api/src/services/tickets.ts#L278) |
| `tickets.eeb2b27a` | 写死 | no-show 审核：订单 {orderNo} | 邮件主题 | [tickets.ts:278](../../apps/api/src/services/tickets.ts#L278) |
| `tickets.263a0da3` | 写死 | 指定的人不存在或没有在用 | 错误提示 | [tickets.ts:397](../../apps/api/src/services/tickets.ts#L397) |
| `tickets.6afaf1a5` | 写死 | 只有客人、渠道提的工单能回复客人 | 提示 | [tickets.ts:419](../../apps/api/src/services/tickets.ts#L419) |
| `tickets.bb14957e` | 写死 | 只能引用这一单的照片 | 提示 | [tickets.ts:457](../../apps/api/src/services/tickets.ts#L457) |
| `tickets.f255be85` | 写死 | 车型降级要填两个车型组的结算价之差（大于 0） | 提示 | [tickets.ts:526](../../apps/api/src/services/tickets.ts#L526) |
| `tickets.117655e4` | 写死 | 只有车型降级要填差价 | 文字 | [tickets.ts:527](../../apps/api/src/services/tickets.ts#L527) |
| `tickets.3094f37f` | 写死 | 只有司机未到可以报销替代交通 | 文字 | [tickets.ts:528](../../apps/api/src/services/tickets.ts#L528) |
| `tickets.a515f5af` | 写死 | 金额要是最小货币单位的非负整数 | 提示 | [tickets.ts:529](../../apps/api/src/services/tickets.ts#L529) |
| `tickets.939eeba3` | 写死 | 这一单已经开始服务或改派给别的供应商服务了，不适用「司机未到」 | 文字 | [tickets.ts:555](../../apps/api/src/services/tickets.ts#L555) |
| `tickets.d4995810` | 写死 | 这一单已经改派给别的供应商，只能按「司机未到」投诉原来的供应商 | 文字 | [tickets.ts:559](../../apps/api/src/services/tickets.ts#L559) |
| `tickets.a85d326e` | 写死 | 这一单还没有开始服务，不适用这一项赔付 | 文字 | [tickets.ts:560](../../apps/api/src/services/tickets.ts#L560) |
| `tickets.6d1188a3` | 写死 | 客人付的不是日元，换算「每笔至少等值 ¥500」需要汇率中心有 48 小时内的汇率 | 错误提示 | [tickets.ts:564](../../apps/api/src/services/tickets.ts#L564) |
| `tickets.c4b5a088` | 写死 | 这一单的报价快照里没有对得上的汇率，算不出客人那边的金额 | 错误提示 | [tickets.ts:587](../../apps/api/src/services/tickets.ts#L587) |
| `tickets.73b71f4a` | 写死 | 只有投诉、履约失败有赔付 | 错误提示 | [tickets.ts:605](../../apps/api/src/services/tickets.ts#L605) |
| `tickets.a6a26243` | 写死 | 工单 {ticketNo}：司机未到 | 说明 | [tickets.ts:666](../../apps/api/src/services/tickets.ts#L666) |
| `tickets.704b85c2` | 写死 | 这一单不在「客人未出现（待审核）」 | 错误提示 | [tickets.ts:749](../../apps/api/src/services/tickets.ts#L749) |
| `tickets.26d6504b` | 写死 | 工单 {ticketNo}：no-show 审核驳回 | 说明 | [tickets.ts:760](../../apps/api/src/services/tickets.ts#L760) |
| `tickets.ad11f8a9` | 写死 | 申诉成立（工单 {ticketNo}） | 提示 | [tickets.ts:775](../../apps/api/src/services/tickets.ts#L775) |
| `tickets.8c9c12fa` | 写死 | 申诉要由另一人复核：判定或复核过原工单的人不能判它的申诉，也不能直接关掉它 | 错误提示 | [tickets.ts:792](../../apps/api/src/services/tickets.ts#L792) |
| `tickets.0f560ae0` | 写死 | 这一类工单不能选这个结论 | 提示 | [tickets.ts:863](../../apps/api/src/services/tickets.ts#L863) |
| `tickets.0ea0da98` | 写死 | 还在等供应商回复（24 小时内），到期没回复视为认可后再判定 | 错误提示 | [tickets.ts:864](../../apps/api/src/services/tickets.ts#L864) |
| `tickets.9d84277f` | 写死 | 只有投诉、履约失败成立时才有赔付 | 提示 | [tickets.ts:867](../../apps/api/src/services/tickets.ts#L867) |
| `tickets.a11d361f` | 写死 | 投诉、履约失败成立要选赔付情形和责任方 | 提示 | [tickets.ts:867](../../apps/api/src/services/tickets.ts#L867) |
| `tickets.9d5494aa` | 写死 | 只有 no-show 驳回时可以选 | 提示 | [tickets.ts:869](../../apps/api/src/services/tickets.ts#L869) |
| `tickets.713feebf` | 写死 | 工单 {ticketNo} 判定成立：赔给客人 {…} {currency}（最小单位），达到复核阈值 | 说明 | [tickets.ts:875](../../apps/api/src/services/tickets.ts#L875) |
| `tickets.01c65e6d` | 写死 | 发起这条复核之后工单已经变了；请驳回，再按现在的情况重新判定 | 错误提示 | [tickets.ts:903](../../apps/api/src/services/tickets.ts#L903) |
| `tickets.6fe3f491` | 写死 | 按现在的数据算出来的赔付和发起时不一样（这一单的收款或退款变了）；请驳回后重新判定 | 错误提示 | [tickets.ts:908](../../apps/api/src/services/tickets.ts#L908) |
| `tickets.2fdb13fa` | 写死 | no-show 审核要先判定（通过或驳回），订单才不会一直卡在待审核 | 错误提示 | [tickets.ts:940](../../apps/api/src/services/tickets.ts#L940) |
| `tickets.f134eced` | 写死 | 赔付 | 错误提示 | [tickets.ts:958](../../apps/api/src/services/tickets.ts#L958) |
| `tickets.d1e301a1` | 写死 | 已经登记过了 | 错误提示 | [tickets.ts:959](../../apps/api/src/services/tickets.ts#L959) |
| `tickets.de8d919f` | 写死 | 这一笔赔付全部从收款里退，不用另付 | 错误提示 | [tickets.ts:959](../../apps/api/src/services/tickets.ts#L959) |

## AI 行程报价 P1 的编排接口（trips.ts）

文件：`apps/api/src/services/trips.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `trips.b097aefc` | 写死 | 行程单不存在或已过期，请重新填写 | 错误提示 | [trips.ts:75](../../apps/api/src/services/trips.ts#L75) |
| `trips.2e58a3fe` | 写死 | 行程太复杂，没法在线报价，请联系客服人工报价 | 错误提示 | [trips.ts:76](../../apps/api/src/services/trips.ts#L76) |
| `trips.5aec6ca7` | 写死 | 地点不存在、已停用，或者不是机场 / 车站 | 提示 | [trips.ts:116](../../apps/api/src/services/trips.ts#L116) |
| `trips.2ebd0406` | 写死 | 行程里的机场 / 车站已停用，请重新选择 | 提示 | [trips.ts:393](../../apps/api/src/services/trips.ts#L393) |
| `trips.a05d6fd4` | 写死 | 司机住宿费（第 {…} 晚） | 文字 | [trips.ts:433](../../apps/api/src/services/trips.ts#L433) |
| `trips.3174ae25` | 写死 | 住宿抵扣空驶费（第 {…} 晚） | 文字 | [trips.ts:434](../../apps/api/src/services/trips.ts#L434) |
| `trips.27c5d9fe` | 写死 | 车辆停驻费（第 {…} 天） | 文字 | [trips.ts:435](../../apps/api/src/services/trips.ts#L435) |
| `trips.678e38ff` | 写死 | 第二司机（第 {…} 天） | 文字 | [trips.ts:436](../../apps/api/src/services/trips.ts#L436) |
| `trips.e682b124` | 写死 | 附加服务同车免重复收费（第 {…} 天） | 文字 | [trips.ts:437](../../apps/api/src/services/trips.ts#L437) |
| `trips.41165c8c` | 写死 | 长途返程费 | 文字 | [trips.ts:438](../../apps/api/src/services/trips.ts#L438) |
| `trips.989eaec8` | 写死 | 方案不存在，请重新报价 | 错误提示 | [trips.ts:593](../../apps/api/src/services/trips.ts#L593) |
| `trips.6591754e` | 写死 | 方案的报价已过 30 分钟有效期，请重新报价 | 错误提示 | [trips.ts:594](../../apps/api/src/services/trips.ts#L594) |
| `trips.0994babe` | 写死 | 这个方案不能直接在线下单（只有整个方案只有一段、没有跨段费用的可以） | 错误提示 | [trips.ts:597](../../apps/api/src/services/trips.ts#L597) |
| `trips.c088ff24` | 写死 | 价格有变化，请重新报价 | 错误提示 | [trips.ts:602](../../apps/api/src/services/trips.ts#L602) |
| `trips.a483a8e8` | 写死 | 经停点名称要和这一段的经停点一样多（{waypointCount} 个） | 提示 | [trips.ts:660](../../apps/api/src/services/trips.ts#L660) |
| `trips.08ab5061` | 写死 | 经停 {…} | 名称 | [trips.ts:670](../../apps/api/src/services/trips.ts#L670) |
| `trips.7ee5377c` | 写死 | 必填 | 提示 | [trips.ts:784](../../apps/api/src/services/trips.ts#L784) |
| `trips.6ed9dd87` | 写死 | 超出范围 | 提示 | [trips.ts:786](../../apps/api/src/services/trips.ts#L786) |
| `trips.f9dfbe05` | 写死 | 日期要按先后排、不能重复 | 提示 | [trips.ts:788](../../apps/api/src/services/trips.ts#L788) |
| `trips.379cddad` | 写死 | 日期要连续，不用车的那天写成空闲日（items 为空） | 提示 | [trips.ts:790](../../apps/api/src/services/trips.ts#L790) |
| `trips.e76da3f2` | 写死 | 第一天和最后一天要用车 | 提示 | [trips.ts:793](../../apps/api/src/services/trips.ts#L793) |
| `trips.a7f1b98d` | 写死 | 每天第一个点是出发点（start 或 arrive\_flight） | 提示 | [trips.ts:795](../../apps/api/src/services/trips.ts#L795) |
| `trips.99990646` | 写死 | 出发点要写时间 HH:MM | 提示 | [trips.ts:797](../../apps/api/src/services/trips.ts#L797) |
| `trips.99d2b3b8` | 写死 | 只有出发点写时间，后面各点的时间由服务器按路线推算 | 提示 | [trips.ts:799](../../apps/api/src/services/trips.ts#L799) |
| `trips.4c7b8839` | 写死 | 终点只能是最后一个点 | 提示 | [trips.ts:801](../../apps/api/src/services/trips.ts#L801) |
| `trips.3aeb5e95` | 写死 | 只有经停点能写停留分钟 | 提示 | [trips.ts:803](../../apps/api/src/services/trips.ts#L803) |
| `trips.814dfe50` | 写死 | 一天至少要两个点（或写当晚过夜点） | 提示 | [trips.ts:805](../../apps/api/src/services/trips.ts#L805) |
| `trips.02556507` | 写死 | 重复 | 提示 | [trips.ts:807](../../apps/api/src/services/trips.ts#L807) |
| `trips.03332f42` | 写死 | 格式不对 | 提示 | [trips.ts:809](../../apps/api/src/services/trips.ts#L809) |

## 运营核实后把官网订单链接发给客人（view-link-resend.ts）

文件：`apps/api/src/services/view-link-resend.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `view-link-resend.0e88fb4b` | 写死 | 订单 | 错误提示 | [view-link-resend.ts:62](../../apps/api/src/services/view-link-resend.ts#L62)、94、142 行 |
| `view-link-resend.3e7bac9f` | 写死 | 这张单已经有一条「发到新邮箱」在等审核，请先处理那一条 | 错误提示 | [view-link-resend.ts:98](../../apps/api/src/services/view-link-resend.ts#L98) |
| `view-link-resend.10c2c15e` | 写死 | 把订单 {orderNo} 的链接发到核实后的新邮箱 {emailMasked} | 说明 | [view-link-resend.ts:115](../../apps/api/src/services/view-link-resend.ts#L115) |
| `view-link-resend.1a453dac` | 写死 | 这条重发已经有结论了；请驳回 | 错误提示 | [view-link-resend.ts:140](../../apps/api/src/services/view-link-resend.ts#L140) |
| `view-link-resend.45b9a2ca` | 写死 | {…}；请驳回 | 错误提示 | [view-link-resend.ts:144](../../apps/api/src/services/view-link-resend.ts#L144) |

## 请求参数校验（validation.ts）

文件：`apps/api/src/validation.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `validation.acb0442a` | 写死 | 类型不正确 | 提示 | [validation.ts:18](../../apps/api/src/validation.ts#L18) |
| `validation.bfa79fc6` | 写死 | 必填 | 提示 | [validation.ts:18](../../apps/api/src/validation.ts#L18) |
| `validation.80e2cd47` | 写死 | 只能是：{…} | 提示 | [validation.ts:20](../../apps/api/src/validation.ts#L20)、30、32 行 |
| `validation.ce1236c4` | 写死 | 至少 {minimum} 项 | 提示 | [validation.ts:22](../../apps/api/src/validation.ts#L22) |
| `validation.5065e410` | 写死 | 至少 {minimum} 个字符 | 提示 | [validation.ts:23](../../apps/api/src/validation.ts#L23) |
| `validation.b035b7f6` | 写死 | 不能小于 {minimum} | 提示 | [validation.ts:23](../../apps/api/src/validation.ts#L23) |
| `validation.632eddb0` | 写死 | 最多 {maximum} 项 | 提示 | [validation.ts:25](../../apps/api/src/validation.ts#L25) |
| `validation.7038d313` | 写死 | 不能大于 {maximum} | 提示 | [validation.ts:26](../../apps/api/src/validation.ts#L26) |
| `validation.ba267765` | 写死 | 最多 {maximum} 个字符 | 提示 | [validation.ts:26](../../apps/api/src/validation.ts#L26) |
| `validation.5d1dcb0e` | 写死 | 必须是有限的数字 | 提示 | [validation.ts:28](../../apps/api/src/validation.ts#L28) |
| `validation.4916bc07` | 写死 | 格式不正确 | 提示 | [validation.ts:34](../../apps/api/src/validation.ts#L34) |
| `validation.7dfe1e68` | 写死 | 不是合法的邮箱 | 提示 | [validation.ts:34](../../apps/api/src/validation.ts#L34) |
| `validation.68bd0bea` | 写死 | 不认识的字段：{…}（请删掉） | 提示 | [validation.ts:36](../../apps/api/src/validation.ts#L36) |
| `validation.745bc053` | 写死 | 不能包含空字符（NUL） | 提示 | [validation.ts:44](../../apps/api/src/validation.ts#L44) |
| `validation.7dbddcee` | 写死 | 包含不完整的字符（多半是被截断的表情符号），请删掉后重试 | 提示 | [validation.ts:45](../../apps/api/src/validation.ts#L45) |
| `validation.dad003d9` | 写死 | 请求参数校验未通过 | 错误提示 | [validation.ts:89](../../apps/api/src/validation.ts#L89) |
| `validation.a423e624` | 写死 | 验证码是 6 位数字 | 文字 | [validation.ts:130](../../apps/api/src/validation.ts#L130) |
| `validation.8c5d90fc` | 写死 | 必须是十进制整数 | 文字 | [validation.ts:144](../../apps/api/src/validation.ts#L144) |
| `validation.637528f1` | 写死 | 不能有换行等控制字符 | 提示 | [validation.ts:151](../../apps/api/src/validation.ts#L151) |
| `validation.305ddecb` | 写死 | 这个内容是系统保留的，请填真实信息 | 提示 | [validation.ts:154](../../apps/api/src/validation.ts#L154) |
| `validation.5fe13db6` | 写死 | 至少改一项（姓名、电话或邮箱） | 提示 | [validation.ts:161](../../apps/api/src/validation.ts#L161) |
| `validation.1041a976` | 写死 | 要写实际内容，不能只有空白或看不见的字符 | 提示 | [validation.ts:179](../../apps/api/src/validation.ts#L179) |
| `validation.7657ef8d` | 写死 | 不是带时区的 ISO 8601 时间 | 提示 | [validation.ts:184](../../apps/api/src/validation.ts#L184) |
| `validation.f8c8084c` | 写死 | 不是合法的时间 | 文字 | [validation.ts:186](../../apps/api/src/validation.ts#L186) |
| `validation.60517d91` | 写死 | 不是合法的编号 | 文字 | [validation.ts:188](../../apps/api/src/validation.ts#L188) |
| `validation.dbda4b9b` | 写死 | 动作最多 10 个，逗号分隔，每个 1 到 50 个字 | 提示 | [validation.ts:201](../../apps/api/src/validation.ts#L201) |
| `validation.4931b7b6` | 写死 | 必须是版本号（正整数），例如 "3" | 提示 | [validation.ts:225](../../apps/api/src/validation.ts#L225) |
| `validation.3c99f428` | 写死 | 必填：新增时要带请求头 Idempotency-Key（例如一个 UUID） | 提示 | [validation.ts:237](../../apps/api/src/validation.ts#L237) |
| `validation.406add1c` | 写死 | 必须是 8 到 128 位的字母、数字或 \_ . : - | 提示 | [validation.ts:237](../../apps/api/src/validation.ts#L237) |
