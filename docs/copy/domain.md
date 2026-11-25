# 前后端共用的业务说法（domain 包）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 832 条：写死 806 条，已走 key 26 条。列的意思见 [README](README.md)。

## 页面

- [角色与权限（access.ts）](#角色与权限accessts)（42 条）
- [区域（areas.ts）](#区域areasts)（11 条）
- [银行转账批量文件和供应商收款账户的纯规则（bank-transfer.ts）](#银行转账批量文件和供应商收款账户的纯规则bank-transferts)（14 条）
- [供应商应付账单与付款批次的纯规则（billing.ts）](#供应商应付账单与付款批次的纯规则billingts)（15 条）
- [平台统一取消政策（cancellation.ts）](#平台统一取消政策cancellationts)（13 条）
- [包车机场开始 / 机场结束套餐（charter-airport.ts）](#包车机场开始--机场结束套餐charter-airportts)（2 条）
- [客人赔付表（compensation.ts）](#客人赔付表compensationts)（7 条）
- [CSV 解析（csv.ts）](#csv-解析csvts)（3 条）
- [派车（dispatch.ts）](#派车dispatchts)（15 条）
- [计程价（distance-price.ts）](#计程价distance-pricets)（3 条）
- [订单异常队列（exceptions.ts）](#订单异常队列exceptionsts)（23 条）
- [服务后加收（extra-charges.ts）](#服务后加收extra-chargests)（7 条）
- [「一口价包含」清单（fixed-price-includes.ts）](#一口价包含清单fixed-price-includests)（13 条）
- [履约（fulfilment.ts）](#履约fulfilmentts)（26 条）
- [免费汇率源的解析（fx-source.ts）](#免费汇率源的解析fx-sourcets)（11 条）
- [地理计算（geo.ts）](#地理计算geots)（6 条）
- [机场的中文名、日文名从 GeoNames 导入（geonames-airports.ts）](#机场的中文名日文名从-geonames-导入geonames-airportsts)（13 条）
- [城市主数据的公开数据源（geonames.ts）](#城市主数据的公开数据源geonamests)（21 条）
- [含公里数和区域加价的说法（included-km.ts）](#含公里数和区域加价的说法included-kmts)（10 条）
- [库存（inventory.ts）](#库存inventoryts)（2 条）
- [官网和嵌入页的三份法律文案（legal-pages.ts）](#官网和嵌入页的三份法律文案legal-pagests)（33 条）
- [人工报价申请（manual-quote.ts）](#人工报价申请manual-quotets)（10 条）
- [平台主数据的规则（master-data.ts）](#平台主数据的规则master-datats)（38 条）
- [订单与付款（orders.ts）](#订单与付款ordersts)（12 条）
- [机场主数据的公开数据源（ourairports.ts）](#机场主数据的公开数据源ourairportsts)（18 条）
- [运营「代客人改单」改乘客邮箱要双人复核（passenger-email-review.ts）](#运营代客人改单改乘客邮箱要双人复核passenger-email-reviewts)（2 条）
- [密码最小强度规则（password-policy.ts）](#密码最小强度规则password-policyts)（5 条）
- [机场 / 航站楼的地址、集合地点说明（place-content-texts.ts）](#机场--航站楼的地址集合地点说明place-content-textsts)（11 条）
- [地点名称的匹配规则（place-match.ts）](#地点名称的匹配规则place-matchts)（15 条）
- [价格表导入第 1 阶段（price-import.ts）](#价格表导入第-1-阶段price-importts)（53 条）
- [价格表导入第 0 阶段（price-sheet.ts）](#价格表导入第-0-阶段price-sheetts)（229 条）
- [价格规则与调价规则（pricing.ts）](#价格规则与调价规则pricingts)（11 条）
- [乘客信息打码（privacy.ts）](#乘客信息打码privacyts)（6 条）
- [商品（products.ts）](#商品productsts)（18 条）
- [救援改派与违约金（rescue.ts）](#救援改派与违约金rescuets)（20 条）
- [路线预估（route-estimate.ts）](#路线预估route-estimatets)（14 条）
- [官网路线小地图（static-map.ts）](#官网路线小地图static-mapts)（13 条）
- [供应商名称和企业信息的维护（tenant-profile.ts）](#供应商名称和企业信息的维护tenant-profilets)（8 条）
- [供应商（tenants.ts）](#供应商tenantsts)（15 条）
- [工单（tickets.ts）](#工单ticketsts)（17 条）
- [「未覆盖需求」（uncovered-demand.ts）](#未覆盖需求uncovered-demandts)（3 条）
- [车型标识（vehicle-label.ts）](#车型标识vehicle-labelts)（7 条）
- [官网订单链接发到下单邮箱（view-link.ts）](#官网订单链接发到下单邮箱view-linkts)（9 条）
- [推送给供应商（webhooks.ts）](#推送给供应商webhooksts)（8 条）

## 角色与权限（access.ts）

文件：`packages/domain/src/access.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `access.56124667` | 写死 | 超级管理员 | 名称 | [access.ts:14](../../packages/domain/src/access.ts#L14) |
| `access.c4126833` | 写死 | 运营 | 名称 | [access.ts:15](../../packages/domain/src/access.ts#L15) |
| `access.d26e90aa` | 写死 | 招商 | 名称 | [access.ts:16](../../packages/domain/src/access.ts#L16) |
| `access.0c380c62` | 写死 | 渠道经理 | 名称 | [access.ts:17](../../packages/domain/src/access.ts#L17) |
| `access.3cc32031` | 写死 | 客服 | 名称 | [access.ts:18](../../packages/domain/src/access.ts#L18) |
| `access.03bfabbf` | 写死 | 财务 | 名称 | [access.ts:19](../../packages/domain/src/access.ts#L19)、32 行 |
| `access.44364523` | 写死 | 风控 | 名称 | [access.ts:20](../../packages/domain/src/access.ts#L20) |
| `access.004462b7` | 写死 | 主数据运营 | 名称 | [access.ts:21](../../packages/domain/src/access.ts#L21) |
| `access.749d4374` | 写死 | 技术 | 名称 | [access.ts:22](../../packages/domain/src/access.ts#L22) |
| `access.f3c4e700` | 写死 | 只读 | 名称 | [access.ts:23](../../packages/domain/src/access.ts#L23)、33 行 |
| `access.1dcbc850` | 写死 | 管理员 | 名称 | [access.ts:29](../../packages/domain/src/access.ts#L29) |
| `access.d3c7801f` | 写死 | 商品价格 | 名称 | [access.ts:30](../../packages/domain/src/access.ts#L30) |
| `access.e6a13b07` | 写死 | 调度 | 名称 | [access.ts:31](../../packages/domain/src/access.ts#L31) |
| `access.d41e4254` | 写死 | 查看 | 名称 | [access.ts:323](../../packages/domain/src/access.ts#L323) |
| `access.43e45338` | 写死 | 编辑 | 名称 | [access.ts:324](../../packages/domain/src/access.ts#L324) |
| `access.f89d3037` | 写死 | 审核 | 名称 | [access.ts:325](../../packages/domain/src/access.ts#L325) |
| `access.868c8ced` | 写死 | 导出 | 名称 | [access.ts:326](../../packages/domain/src/access.ts#L326) |
| `access.49302a9b` | 写死 | 供应商 | 名称 | [access.ts:341](../../packages/domain/src/access.ts#L341) |
| `access.2ba97790` | 写死 | 供应商商品 | 名称 | [access.ts:342](../../packages/domain/src/access.ts#L342) |
| `access.0d62b3cf` | 写死 | 报价试算 | 名称 | [access.ts:343](../../packages/domain/src/access.ts#L343) |
| `access.d8727b72` | 写死 | 未覆盖需求 | 名称 | [access.ts:345](../../packages/domain/src/access.ts#L345) |
| `access.f3c0a3b0` | 写死 | 渠道 | 名称 | [access.ts:346](../../packages/domain/src/access.ts#L346) |
| `access.ae517fdc` | 写死 | 嵌入组件 | 名称 | [access.ts:348](../../packages/domain/src/access.ts#L348) |
| `access.dcb5a5f7` | 写死 | 订单 | 名称 | [access.ts:351](../../packages/domain/src/access.ts#L351) |
| `access.24ff99ec` | 写死 | 代传履约 | 名称 | [access.ts:353](../../packages/domain/src/access.ts#L353) |
| `access.cb8a2bf1` | 写死 | 代处理改单 | 名称 | [access.ts:355](../../packages/domain/src/access.ts#L355) |
| `access.d67ef443` | 写死 | 订单链接重发 | 名称 | [access.ts:357](../../packages/domain/src/access.ts#L357) |
| `access.01ef9ceb` | 写死 | 异常队列 | 名称 | [access.ts:359](../../packages/domain/src/access.ts#L359) |
| `access.50a83025` | 写死 | 救援 | 名称 | [access.ts:361](../../packages/domain/src/access.ts#L361) |
| `access.b1cd8950` | 写死 | 取消政策 | 名称 | [access.ts:363](../../packages/domain/src/access.ts#L363) |
| `access.dcc5da43` | 写死 | 工单 | 名称 | [access.ts:365](../../packages/domain/src/access.ts#L365) |
| `access.754c93c7` | 写死 | 赔付表 | 名称 | [access.ts:367](../../packages/domain/src/access.ts#L367) |
| `access.68ebde93` | 写死 | 待审核 | 名称 | [access.ts:368](../../packages/domain/src/access.ts#L368) |
| `access.c6d96212` | 写死 | 财务结算 | 名称 | [access.ts:370](../../packages/domain/src/access.ts#L370) |
| `access.1c98fa1a` | 写死 | 通知中心 | 名称 | [access.ts:373](../../packages/domain/src/access.ts#L373) |
| `access.46bc3a1b` | 写死 | 人工报价 | 名称 | [access.ts:375](../../packages/domain/src/access.ts#L375) |
| `access.fa87b447` | 写死 | 官网设置 | 名称 | [access.ts:377](../../packages/domain/src/access.ts#L377) |
| `access.921f2f7b` | 写死 | 主数据与汇率 | 名称 | [access.ts:378](../../packages/domain/src/access.ts#L378) |
| `access.1a2aa8aa` | 写死 | 平台账号 | 名称 | [access.ts:379](../../packages/domain/src/access.ts#L379) |
| `access.3d420cee` | 写死 | 角色 | 名称 | [access.ts:380](../../packages/domain/src/access.ts#L380) |
| `access.a708af9d` | 写死 | 审计日志 | 名称 | [access.ts:381](../../packages/domain/src/access.ts#L381) |
| `access.47d97c4a` | 写死 | 集成状态 | 名称 | [access.ts:383](../../packages/domain/src/access.ts#L383) |

## 区域（areas.ts）

文件：`packages/domain/src/areas.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `areas.70fb5e64` | 写死 | 通用 | 文字 | [areas.ts:22](../../packages/domain/src/areas.ts#L22) |
| `areas.5eb79bdf` | 写死 | 接送机 | 文字 | [areas.ts:23](../../packages/domain/src/areas.ts#L23) |
| `areas.43b05d85` | 写死 | 点对点 | 文字 | [areas.ts:24](../../packages/domain/src/areas.ts#L24) |
| `areas.61cc5829` | 写死 | 包车 | 文字 | [areas.ts:25](../../packages/domain/src/areas.ts#L25) |
| `areas.0fe6232d` | 写死 | 运营区域 | 文字 | [areas.ts:35](../../packages/domain/src/areas.ts#L35) |
| `areas.184f8a19` | 写死 | 报价区域 | 文字 | [areas.ts:35](../../packages/domain/src/areas.ts#L35) |
| `areas.1e04f235` | 写死 | 运营 + 报价 | 文字 | [areas.ts:35](../../packages/domain/src/areas.ts#L35) |
| `areas.30101ab9` | 写死 | 供应商独立 | 文字 | [areas.ts:43](../../packages/domain/src/areas.ts#L43) |
| `areas.a3a0ea24` | 写死 | 平台共享 | 文字 | [areas.ts:43](../../packages/domain/src/areas.ts#L43) |
| `areas.2b209c37` | 写死 | 营运 | 文字 | [areas.ts:62](../../packages/domain/src/areas.ts#L62) |
| `areas.98db7587` | 写死 | 禁行 | 文字 | [areas.ts:62](../../packages/domain/src/areas.ts#L62) |

## 银行转账批量文件和供应商收款账户的纯规则（bank-transfer.ts）

文件：`packages/domain/src/bank-transfer.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `bank-transfer.c3a2db1e` | 写死 | 必填 | 提示 | [bank-transfer.ts:162](../../packages/domain/src/bank-transfer.ts#L162) |
| `bank-transfer.55fa48b2` | 写死 | 太长了 | 文字 | [bank-transfer.ts:163](../../packages/domain/src/bank-transfer.ts#L163) |
| `bank-transfer.91ad81f0` | 写死 | 只能用英文字母、数字和 / - ? : ( ) . , ' +（中文、&amp; 银行传不了，请写英文） | 文字 | [bank-transfer.ts:164](../../packages/domain/src/bank-transfer.ts#L164) |
| `bank-transfer.0b59e30d` | 写死 | 不能以 - : / 开头 | 说明 | [bank-transfer.ts:165](../../packages/domain/src/bank-transfer.ts#L165) |
| `bank-transfer.89ef8d62` | 写死 | IBAN 不对（国家、长度或校验位），请核对 | 提示 | [bank-transfer.ts:166](../../packages/domain/src/bank-transfer.ts#L166) |
| `bank-transfer.de4122c9` | 写死 | 账号要 4–34 位英文字母和数字 | 文字 | [bank-transfer.ts:167](../../packages/domain/src/bank-transfer.ts#L167) |
| `bank-transfer.47e3c777` | 写死 | SWIFT/BIC 要 8 或 11 位，如 ABCDJPJT 或 ABCDJPJTXXX | 提示 | [bank-transfer.ts:168](../../packages/domain/src/bank-transfer.ts#L168) |
| `bank-transfer.2b86670e` | 写死 | 平台不支持这种币种 | 文字 | [bank-transfer.ts:169](../../packages/domain/src/bank-transfer.ts#L169)、211 行 |
| `bank-transfer.0b3bf982` | 写死 | 这张账单不是「已复核通过、待付款」 | 文字 | [bank-transfer.ts:209](../../packages/domain/src/bank-transfer.ts#L209) |
| `bank-transfer.b6e92298` | 写死 | 金额不是正数，不需要转账 | 文字 | [bank-transfer.ts:210](../../packages/domain/src/bank-transfer.ts#L210) |
| `bank-transfer.e535ee10` | 写死 | 供应商还没有这种币种的收款账户 | 文字 | [bank-transfer.ts:212](../../packages/domain/src/bank-transfer.ts#L212) |
| `bank-transfer.062488a8` | 写死 | 供应商的收款账户还在审核，没有生效 | 文字 | [bank-transfer.ts:213](../../packages/domain/src/bank-transfer.ts#L213) |
| `bank-transfer.7707ba38` | 写死 | 收款账户的内容不合规则，请供应商重新提交 | 提示 | [bank-transfer.ts:214](../../packages/domain/src/bank-transfer.ts#L214) |
| `bank-transfer.d0c84a18` | 写死 | 收款账号解不开（数据加密密钥可能换过），请供应商重新提交 | 文字 | [bank-transfer.ts:215](../../packages/domain/src/bank-transfer.ts#L215) |

## 供应商应付账单与付款批次的纯规则（billing.ts）

文件：`packages/domain/src/billing.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `billing.0f2a3fee` | 写死 | 已完成订单 | 文字 | [billing.ts:136](../../packages/domain/src/billing.ts#L136) |
| `billing.75cf8ac3` | 写死 | 客人未出现 | 文字 | [billing.ts:137](../../packages/domain/src/billing.ts#L137) |
| `billing.5e7e2cb7` | 写死 | 有偿取消 | 文字 | [billing.ts:138](../../packages/domain/src/billing.ts#L138) |
| `billing.4fa3c484` | 写死 | 事后加收 | 文字 | [billing.ts:139](../../packages/domain/src/billing.ts#L139) |
| `billing.61e3a5b7` | 写死 | 违约金与扣款 | 文字 | [billing.ts:140](../../packages/domain/src/billing.ts#L140) |
| `billing.054ce01e` | 写死 | 扣款免除 | 文字 | [billing.ts:141](../../packages/domain/src/billing.ts#L141) |
| `billing.bb3e365b` | 写死 | 上期结转 | 文字 | [billing.ts:142](../../packages/domain/src/billing.ts#L142) |
| `billing.0ce96e06` | 写死 | 待确认 | 文字 | [billing.ts:267](../../packages/domain/src/billing.ts#L267) |
| `billing.1d8a5e1d` | 写死 | 有异议 | 文字 | [billing.ts:268](../../packages/domain/src/billing.ts#L268) |
| `billing.fc48d7ce` | 写死 | 待复核 | 文字 | [billing.ts:269](../../packages/domain/src/billing.ts#L269) |
| `billing.812ca7fb` | 写死 | 待付款 | 文字 | [billing.ts:270](../../packages/domain/src/billing.ts#L270) |
| `billing.9ace5998` | 写死 | 已付款 | 文字 | [billing.ts:271](../../packages/domain/src/billing.ts#L271) |
| `billing.a1eb64ab` | 写死 | 无需付款 | 文字 | [billing.ts:272](../../packages/domain/src/billing.ts#L272) |
| `billing.2f602964` | 写死 | 转入下期 | 文字 | [billing.ts:273](../../packages/domain/src/billing.ts#L273) |
| `billing.c04be852` | 写死 | 已作废 | 文字 | [billing.ts:274](../../packages/domain/src/billing.ts#L274) |

## 平台统一取消政策（cancellation.ts）

文件：`packages/domain/src/cancellation.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `cancellation.ff4f2176` | 写死 | 经济 | 文字 | [cancellation.ts:26](../../packages/domain/src/cancellation.ts#L26) |
| `cancellation.ed2b5a5a` | 写死 | 舒适 | 文字 | [cancellation.ts:27](../../packages/domain/src/cancellation.ts#L27) |
| `cancellation.44657e99` | 写死 | 商务 | 文字 | [cancellation.ts:28](../../packages/domain/src/cancellation.ts#L28) |
| `cancellation.0f32fea6` | 写死 | 豪华 | 文字 | [cancellation.ts:29](../../packages/domain/src/cancellation.ts#L29) |
| `cancellation.2a0228d6` | 写死 | 中巴（10 座及以上） | 文字 | [cancellation.ts:30](../../packages/domain/src/cancellation.ts#L30) |
| `cancellation.b4cf08a1` | 写死 | 超时未支付，系统自动取消 | 文字 | [cancellation.ts:184](../../packages/domain/src/cancellation.ts#L184) |
| `cancellation.ded736e5` | 写死 | 付款被取消 | 文字 | [cancellation.ts:185](../../packages/domain/src/cancellation.ts#L185) |
| `cancellation.0ab102b1` | 写死 | 客人取消（按取消政策扣款） | 文字 | [cancellation.ts:186](../../packages/domain/src/cancellation.ts#L186) |
| `cancellation.7b7b5081` | 写死 | 改期没有得到供应商确认，客人免费取消 | 文字 | [cancellation.ts:187](../../packages/domain/src/cancellation.ts#L187) |
| `cancellation.ce332367` | 写死 | 航班取消（有证明），免费取消 | 文字 | [cancellation.ts:188](../../packages/domain/src/cancellation.ts#L188) |
| `cancellation.9c7c6e24` | 写死 | 不可抗力，免费取消 | 文字 | [cancellation.ts:189](../../packages/domain/src/cancellation.ts#L189) |
| `cancellation.8448e92a` | 写死 | 供应商原因，免费取消 | 文字 | [cancellation.ts:190](../../packages/domain/src/cancellation.ts#L190) |
| `cancellation.28419909` | 写死 | 平台原因，免费取消 | 文字 | [cancellation.ts:191](../../packages/domain/src/cancellation.ts#L191) |

## 包车机场开始 / 机场结束套餐（charter-airport.ts）

文件：`packages/domain/src/charter-airport.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `charter-airport.1973ca53` | 写死 | {name}接机 + {hours} 小时包车 | 名称 | [charter-airport.ts:88](../../packages/domain/src/charter-airport.ts#L88) |
| `charter-airport.638fd73e` | 写死 | {hours} 小时包车 + {name}送机 | 名称 | [charter-airport.ts:88](../../packages/domain/src/charter-airport.ts#L88) |

## 客人赔付表（compensation.ts）

文件：`packages/domain/src/compensation.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `compensation.5ddb7505` | 写死 | 司机迟到 15–29 分钟 | 文字 | [compensation.ts:22](../../packages/domain/src/compensation.ts#L22) |
| `compensation.562003c5` | 写死 | 司机迟到 30 分钟及以上 | 文字 | [compensation.ts:23](../../packages/domain/src/compensation.ts#L23) |
| `compensation.8e696ef8` | 写死 | 司机未到 | 文字 | [compensation.ts:24](../../packages/domain/src/compensation.ts#L24) |
| `compensation.2b7de380` | 写死 | 车型降级 | 文字 | [compensation.ts:25](../../packages/domain/src/compensation.ts#L25) |
| `compensation.f16f1d8d` | 写死 | 未举牌（商品含举牌） | 文字 | [compensation.ts:26](../../packages/domain/src/compensation.ts#L26) |
| `compensation.905f7ac3` | 写死 | 没送到目的地 | 文字 | [compensation.ts:27](../../packages/domain/src/compensation.ts#L27) |
| `compensation.75a23a4f` | 写死 | 车况、司机态度投诉成立 | 文字 | [compensation.ts:28](../../packages/domain/src/compensation.ts#L28) |

## CSV 解析（csv.ts）

文件：`packages/domain/src/csv.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `csv.1a82c933` | 写死 | 文件不是 UTF-8 编码（可能被另存成了别的编码）。请用原始下载的文件，或另存为 UTF-8 后再试 | 错误提示 | [csv.ts:23](../../packages/domain/src/csv.ts#L23) |
| `csv.1d2ec95a` | 写死 | 文件用的是只有 CR 的旧式换行，无法可靠地分行。请另存为 LF 或 CRLF 换行后再试 | 错误提示 | [csv.ts:66](../../packages/domain/src/csv.ts#L66) |
| `csv.cbe783a6` | 写死 | CSV 文件不完整：有一个双引号没有闭合 | 错误提示 | [csv.ts:72](../../packages/domain/src/csv.ts#L72) |

## 派车（dispatch.ts）

文件：`packages/domain/src/dispatch.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `dispatch.61c6d4eb` | 写死 | 在职 | 文字 | [dispatch.ts:94](../../packages/domain/src/dispatch.ts#L94) |
| `dispatch.b8b202e6` | 写死 | 停用 | 文字 | [dispatch.ts:94](../../packages/domain/src/dispatch.ts#L94)、98 行 |
| `dispatch.5ee16549` | 写死 | 可用 | 文字 | [dispatch.ts:98](../../packages/domain/src/dispatch.ts#L98) |
| `dispatch.7fcc5be4` | 写死 | 维修 | 文字 | [dispatch.ts:98](../../packages/domain/src/dispatch.ts#L98) |
| `dispatch.742b0491` | 写死 | 非营业牌照 | 文字 | [dispatch.ts:103](../../packages/domain/src/dispatch.ts#L103) |
| `dispatch.93c5726b` | 写死 | 营业牌照（绿牌） | 文字 | [dispatch.ts:103](../../packages/domain/src/dispatch.ts#L103) |
| `dispatch.78d6afda` | 写死 | 司机已停用 | 文字 | [dispatch.ts:252](../../packages/domain/src/dispatch.ts#L252) |
| `dispatch.39b30e94` | 写死 | 司机的驾照在用车日前已过期 | 文字 | [dispatch.ts:253](../../packages/domain/src/dispatch.ts#L253) |
| `dispatch.1d42fca1` | 写死 | 客人要求的司机语言，这位司机不会 | 文字 | [dispatch.ts:254](../../packages/domain/src/dispatch.ts#L254) |
| `dispatch.5ab2b0d2` | 写死 | 车辆不是「可用」状态（维修或停用） | 文字 | [dispatch.ts:255](../../packages/domain/src/dispatch.ts#L255) |
| `dispatch.27749d82` | 写死 | 非营业牌照的车辆不能派单 | 文字 | [dispatch.ts:256](../../packages/domain/src/dispatch.ts#L256) |
| `dispatch.d1846967` | 写死 | 车辆保险在用车日前已过期 | 文字 | [dispatch.ts:257](../../packages/domain/src/dispatch.ts#L257) |
| `dispatch.9b896521` | 写死 | 车辆车检在用车日前已过期 | 文字 | [dispatch.ts:258](../../packages/domain/src/dispatch.ts#L258) |
| `dispatch.4fcafa4e` | 写死 | 车辆的车型组比订单的低（只能同级或升级） | 文字 | [dispatch.ts:259](../../packages/domain/src/dispatch.ts#L259) |
| `dispatch.ca46fc7d` | 写死 | 车辆座位比订单车型组的少 | 文字 | [dispatch.ts:260](../../packages/domain/src/dispatch.ts#L260) |

## 计程价（distance-price.ts）

文件：`packages/domain/src/distance-price.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `distance-price.984e061e` | 写死 | 含里程费 | 文字 | [distance-price.ts:78](../../packages/domain/src/distance-price.ts#L78) |
| `distance-price.1f17fb96` | 写死 | 按里程计价 | 文字 | [distance-price.ts:79](../../packages/domain/src/distance-price.ts#L79) |
| `distance-price.11f80d18` | 写死 | 车费已含高速费、停车费等，无需另付 | 文字 | [distance-price.ts:93](../../packages/domain/src/distance-price.ts#L93) |

## 订单异常队列（exceptions.ts）

文件：`packages/domain/src/exceptions.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `exceptions.ced62e77` | 写死 | 超时未派车 | 文字 | [exceptions.ts:25](../../packages/domain/src/exceptions.ts#L25) |
| `exceptions.1c99ef75` | 写死 | 司机未出发 | 文字 | [exceptions.ts:26](../../packages/domain/src/exceptions.ts#L26) |
| `exceptions.fc6c55ec` | 写死 | 司机未到达 | 文字 | [exceptions.ts:27](../../packages/domain/src/exceptions.ts#L27) |
| `exceptions.1694d8a3` | 写死 | 状态推送失败 | 提示 | [exceptions.ts:28](../../packages/domain/src/exceptions.ts#L28) |
| `exceptions.5c173a26` | 写死 | no-show 待审核 | 文字 | [exceptions.ts:29](../../packages/domain/src/exceptions.ts#L29) |
| `exceptions.69507694` | 写死 | 附加费用待审核 | 文字 | [exceptions.ts:30](../../packages/domain/src/exceptions.ts#L30) |
| `exceptions.8b25d13f` | 写死 | 履约未结束 | 文字 | [exceptions.ts:31](../../packages/domain/src/exceptions.ts#L31) |
| `exceptions.93cb3e66` | 写死 | 支付异常 | 文字 | [exceptions.ts:32](../../packages/domain/src/exceptions.ts#L32) |
| `exceptions.8d6685d4` | 写死 | 救援中 | 文字 | [exceptions.ts:33](../../packages/domain/src/exceptions.ts#L33) |
| `exceptions.5e07299f` | 写死 | 改单未确认 | 文字 | [exceptions.ts:34](../../packages/domain/src/exceptions.ts#L34) |
| `exceptions.50c6e832` | 写死 | 电话催租户；用车前 6 小时仍未派车，自动进入救援改派 | 文字 | [exceptions.ts:39](../../packages/domain/src/exceptions.ts#L39) |
| `exceptions.6016e425` | 写死 | 联系租户和司机 | 文字 | [exceptions.ts:40](../../packages/domain/src/exceptions.ts#L40) |
| `exceptions.edb674d2` | 写死 | 联系司机，并主动联系客人；到点 15 分钟仍未到达且联系不上，启动救援改派或请客人自行打车凭票报销 | 文字 | [exceptions.ts:41](../../packages/domain/src/exceptions.ts#L41) |
| `exceptions.d47f4c74` | 写死 | 技术排查后手工重发 | 提示 | [exceptions.ts:42](../../packages/domain/src/exceptions.ts#L42) |
| `exceptions.f3afdbfa` | 写死 | 转工单审核 | 文字 | [exceptions.ts:43](../../packages/domain/src/exceptions.ts#L43) |
| `exceptions.1c0a09b6` | 写死 | 审核通过后推送渠道 | 文字 | [exceptions.ts:44](../../packages/domain/src/exceptions.ts#L44) |
| `exceptions.d09ce81d` | 写死 | 催租户提交 | 文字 | [exceptions.ts:45](../../packages/domain/src/exceptions.ts#L45) |
| `exceptions.82ba791e` | 写死 | 财务核实，必要时取消订单 | 文字 | [exceptions.ts:46](../../packages/domain/src/exceptions.ts#L46) |
| `exceptions.e98300ec` | 写死 | 按救援流程处理：发救援单、人工指定或取消退款 | 文字 | [exceptions.ts:47](../../packages/domain/src/exceptions.ts#L47) |
| `exceptions.8016342e` | 写死 | 催供应商处理客人的修改申请；联系不上时可以在订单详情代为同意或拒绝（要写原因） | 文字 | [exceptions.ts:48](../../packages/domain/src/exceptions.ts#L48) |
| `exceptions.4cd57a3f` | 写死 | 待处理 | 文字 | [exceptions.ts:85](../../packages/domain/src/exceptions.ts#L85) |
| `exceptions.4ec3d9b1` | 写死 | 已关闭 | 文字 | [exceptions.ts:85](../../packages/domain/src/exceptions.ts#L85) |
| `exceptions.d3d4f1ee` | 写死 | 处理中 | 文字 | [exceptions.ts:85](../../packages/domain/src/exceptions.ts#L85) |

## 服务后加收（extra-charges.ts）

文件：`packages/domain/src/extra-charges.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `extra-charges.c8bc5870` | 写死 | 包车超时 | 文字 | [extra-charges.ts:31](../../packages/domain/src/extra-charges.ts#L31) |
| `extra-charges.6cf10030` | 写死 | 包车超公里 | 文字 | [extra-charges.ts:32](../../packages/domain/src/extra-charges.ts#L32) |
| `extra-charges.b83036b7` | 写死 | 付费等待 | 文字 | [extra-charges.ts:33](../../packages/domain/src/extra-charges.ts#L33) |
| `extra-charges.fe4218e7` | 写死 | 现场加停靠点 | 文字 | [extra-charges.ts:34](../../packages/domain/src/extra-charges.ts#L34) |
| `extra-charges.649ee834` | 写死 | 现场加附加服务 | 文字 | [extra-charges.ts:35](../../packages/domain/src/extra-charges.ts#L35) |
| `extra-charges.bdf90cbc` | 写死 | 高速费（凭票实报） | 文字 | [extra-charges.ts:36](../../packages/domain/src/extra-charges.ts#L36) |
| `extra-charges.3958610b` | 写死 | 停车费（凭票实报） | 文字 | [extra-charges.ts:37](../../packages/domain/src/extra-charges.ts#L37) |

## 「一口价包含」清单（fixed-price-includes.ts）

文件：`packages/domain/src/fixed-price-includes.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fixed-price-includes.charterOverage` | 已走 key | 超出套餐的时长和公里服务后按实际收取 | 文字 | [fixed-price-includes.ts:35](../../packages/domain/src/fixed-price-includes.ts#L35) |
| `fixed-price-includes.charterItineraryOverage` | 已走 key | 超公里已按预计行程算进价格；用时超出套餐、或当天超出预计的部分，服务后按实际收取 | 文字 | [fixed-price-includes.ts:46](../../packages/domain/src/fixed-price-includes.ts#L46) |
| `fixed-price-includes.b4a26157` | 写死 | 包车报价须包含高速费、停车费：对客人是一口价全含，服务后不能再另收高速费、停车费；超出套餐的时长和公里仍按商品规则加收。 | 说明 | [fixed-price-includes.ts:52](../../packages/domain/src/fixed-price-includes.ts#L52) |
| `fixed-price-includes.allInclusive` | 已走 key | 一口价已含所有费用（高速费、停车费等），无需另付 | 文字 | [fixed-price-includes.ts:68](../../packages/domain/src/fixed-price-includes.ts#L68) |
| `fixed-price-includes.privateCar` | 已走 key | 专车专用，不拼车 | 文字 | [fixed-price-includes.ts:69](../../packages/domain/src/fixed-price-includes.ts#L69) |
| `fixed-price-includes.meetAndGreet` | 已走 key | 举牌接机 | 文字 | [fixed-price-includes.ts:70](../../packages/domain/src/fixed-price-includes.ts#L70) |
| `fixed-price-includes.freeWaitAfterLanding` | 已走 key | 航班落地后免费等待 {minutes} 分钟 | 文字 | [fixed-price-includes.ts:71](../../packages/domain/src/fixed-price-includes.ts#L71) |
| `fixed-price-includes.freeWaitAfterLandingRange` | 已走 key | 航班落地后免费等待：国际线最长 {international} 分钟、国内线最长 {domestic} 分钟 | 文字 | [fixed-price-includes.ts:72](../../packages/domain/src/fixed-price-includes.ts#L72) |
| `fixed-price-includes.freeWait` | 已走 key | 免费等待 {minutes} 分钟 | 文字 | [fixed-price-includes.ts:73](../../packages/domain/src/fixed-price-includes.ts#L73) |
| `fixed-price-includes.4815a4ed` | 写死 | 一口价包含 | 文字 | [fixed-price-includes.ts:118](../../packages/domain/src/fixed-price-includes.ts#L118) |
| `fixed-price-includes.709e54be` | 写死 | 车费包含 | 文字 | [fixed-price-includes.ts:118](../../packages/domain/src/fixed-price-includes.ts#L118) |
| `fixed-price-includes.795b17b3` | 写死 | 一口价 | 文字 | [fixed-price-includes.ts:125](../../packages/domain/src/fixed-price-includes.ts#L125) |
| `fixed-price-includes.ab9cb070` | 写死 | 车费 | 文字 | [fixed-price-includes.ts:125](../../packages/domain/src/fixed-price-includes.ts#L125) |

## 履约（fulfilment.ts）

文件：`packages/domain/src/fulfilment.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fulfilment.09fa1cf7` | 写死 | 客人确认「我已落地」 | 文字 | [fulfilment.ts:32](../../packages/domain/src/fulfilment.ts#L32) |
| `fulfilment.89c72ef4` | 写死 | 司机填写（附到达屏照片） | 文字 | [fulfilment.ts:33](../../packages/domain/src/fulfilment.ts#L33) |
| `fulfilment.5a0b6ed3` | 写死 | 计划到达时间 | 文字 | [fulfilment.ts:34](../../packages/domain/src/fulfilment.ts#L34) |
| `fulfilment.aa9e5cec` | 写死 | 免费等待开始前点了「已到达」，定位距上车点 ≤ 300 米 | 文字 | [fulfilment.ts:141](../../packages/domain/src/fulfilment.ts#L141) |
| `fulfilment.e92bbb2d` | 写死 | 免费等待内至少 3 次联系客人的记录 | 文字 | [fulfilment.ts:142](../../packages/domain/src/fulfilment.ts#L142) |
| `fulfilment.4a33ba9a` | 写死 | 在上车点举牌的照片（带系统时间） | 文字 | [fulfilment.ts:143](../../packages/domain/src/fulfilment.ts#L143) |
| `fulfilment.366d2d07` | 写死 | 点了「申请离开」，客服 10 分钟内没有反对 | 文字 | [fulfilment.ts:144](../../packages/domain/src/fulfilment.ts#L144) |
| `fulfilment.dfb6dbee` | 写死 | 用车后 24 小时内提交 | 文字 | [fulfilment.ts:145](../../packages/domain/src/fulfilment.ts#L145) |
| `fulfilment.410c2a6d` | 写死 | 司机已出发 | 文字 | [fulfilment.ts:264](../../packages/domain/src/fulfilment.ts#L264) |
| `fulfilment.67fdb86e` | 写死 | 司机已到达 | 文字 | [fulfilment.ts:265](../../packages/domain/src/fulfilment.ts#L265) |
| `fulfilment.d37cfc0a` | 写死 | 已接到客人 | 文字 | [fulfilment.ts:266](../../packages/domain/src/fulfilment.ts#L266) |
| `fulfilment.417ea6aa` | 写死 | 已完成 | 文字 | [fulfilment.ts:267](../../packages/domain/src/fulfilment.ts#L267)、321 行 |
| `fulfilment.6cefffc6` | 写死 | 我出发了 | 文字 | [fulfilment.ts:310](../../packages/domain/src/fulfilment.ts#L310) |
| `fulfilment.6fafce5a` | 写死 | 已到达上车点 | 文字 | [fulfilment.ts:311](../../packages/domain/src/fulfilment.ts#L311) |
| `fulfilment.7d4e1b18` | 写死 | 接到客人了 | 文字 | [fulfilment.ts:312](../../packages/domain/src/fulfilment.ts#L312) |
| `fulfilment.961aa912` | 写死 | 服务完成 | 文字 | [fulfilment.ts:313](../../packages/domain/src/fulfilment.ts#L313) |
| `fulfilment.1a65b5bf` | 写死 | 已出发 | 文字 | [fulfilment.ts:318](../../packages/domain/src/fulfilment.ts#L318) |
| `fulfilment.7bf2c462` | 写死 | 已到达 | 文字 | [fulfilment.ts:319](../../packages/domain/src/fulfilment.ts#L319) |
| `fulfilment.dedc35c6` | 写死 | 接到客人 | 文字 | [fulfilment.ts:320](../../packages/domain/src/fulfilment.ts#L320) |
| `fulfilment.9f9e8449` | 写死 | 最早在用车前 {…} 小时，也就是 {…}（{timeZone} 当地时间）以后 | 文字 | [fulfilment.ts:330](../../packages/domain/src/fulfilment.ts#L330) |
| `fulfilment.10e3e919` | 写死 | 现在还不能回传「{…}」（{type}）：{earliest}才能回传（用车时间 {service}）。用车时间有变请先改单。 | 提示 | [fulfilment.ts:331](../../packages/domain/src/fulfilment.ts#L331) |
| `fulfilment.42065ef3` | 写死 | 现在还不能点「{…}」：{earliest}才能点（用车时间 {service}）。行程有变请联系调度。 | 提示 | [fulfilment.ts:332](../../packages/domain/src/fulfilment.ts#L332) |
| `fulfilment.10f0a9c6` | 写死 | 发生时间不能晚于现在 | 提示 | [fulfilment.ts:366](../../packages/domain/src/fulfilment.ts#L366) |
| `fulfilment.e8dd47f3` | 写死 | 发生时间不能早于上一个履约节点 | 提示 | [fulfilment.ts:367](../../packages/domain/src/fulfilment.ts#L367) |
| `fulfilment.ff20c45f` | 写死 | 发生时间不能早于用车时间前 {…} 小时 | 提示 | [fulfilment.ts:368](../../packages/domain/src/fulfilment.ts#L368) |
| `fulfilment.09e0c029` | 写死 | 发生时间不能早于 {maxBackdateDays} 天前，更早的请走工单 | 提示 | [fulfilment.ts:369](../../packages/domain/src/fulfilment.ts#L369) |

## 免费汇率源的解析（fx-source.ts）

文件：`packages/domain/src/fx-source.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx-source.d91fcfe3` | 写死 | 免费、免密钥；对方要求展示署名链接（https://www.exchangerate-api.com）；每天更新一次 | 文字 | [fx-source.ts:18](../../packages/domain/src/fx-source.ts#L18) |
| `fx-source.9df79de6` | 写死 | 响应不是 JSON | 文字 | [fx-source.ts:85](../../packages/domain/src/fx-source.ts#L85) |
| `fx-source.adf7930c` | 写死 | 响应不是一个 JSON 对象 | 文字 | [fx-source.ts:87](../../packages/domain/src/fx-source.ts#L87) |
| `fx-source.3888120f` | 写死 | 数据源返回的结果不是 success{kind} | 文字 | [fx-source.ts:90](../../packages/domain/src/fx-source.ts#L90) |
| `fx-source.46b7fae0` | 写死 | 基准币种应为 {base} | 文字 | [fx-source.ts:92](../../packages/domain/src/fx-source.ts#L92) |
| `fx-source.99672355` | 写死 | 没有可用的更新时间（time\_last\_update\_unix） | 文字 | [fx-source.ts:94](../../packages/domain/src/fx-source.ts#L94) |
| `fx-source.e6d27ace` | 写死 | 更新时间 {asOf} 比现在晚，数据源或时钟出了错 | 文字 | [fx-source.ts:95](../../packages/domain/src/fx-source.ts#L95) |
| `fx-source.f0aedd96` | 写死 | 没有汇率表（rates） | 文字 | [fx-source.ts:98](../../packages/domain/src/fx-source.ts#L98) |
| `fx-source.99e9f62f` | 写死 | 汇率表里 {base} 应当是 1 | 文字 | [fx-source.ts:101](../../packages/domain/src/fx-source.ts#L101) |
| `fx-source.f9f946f7` | 写死 | {currency} 的汇率不是正的十进制数：{…} | 文字 | [fx-source.ts:112](../../packages/domain/src/fx-source.ts#L112) |
| `fx-source.eec1f2c4` | 写死 | 缺少币种：{…} | 文字 | [fx-source.ts:115](../../packages/domain/src/fx-source.ts#L115) |

## 地理计算（geo.ts）

文件：`packages/domain/src/geo.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `geo.d15787a2` | 写死 | 多边形为空 | 错误提示 | [geo.ts:114](../../packages/domain/src/geo.ts#L114) |
| `geo.49df7833` | 写死 | 第 {…} 个多边形没有外环 | 错误提示 | [geo.ts:116](../../packages/domain/src/geo.ts#L116) |
| `geo.38c83704` | 写死 | 第 {…} 个多边形的第 {…} 个环 | 名称 | [geo.ts:118](../../packages/domain/src/geo.ts#L118) |
| `geo.97525611` | 写死 | {name}至少需要 4 个点（首尾相同） | 错误提示 | [geo.ts:119](../../packages/domain/src/geo.ts#L119) |
| `geo.f7e71a95` | 写死 | {name}首尾点不一致 | 错误提示 | [geo.ts:122](../../packages/domain/src/geo.ts#L122) |
| `geo.77e1ed20` | 写死 | {name}含无效坐标 | 错误提示 | [geo.ts:123](../../packages/domain/src/geo.ts#L123) |

## 机场的中文名、日文名从 GeoNames 导入（geonames-airports.ts）

文件：`packages/domain/src/geonames-airports.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `geonames-airports.49861738` | 写死 | 機場國際東島廣帶歲館釧滿內對馬奧長門關灣臺縣區鄉鎮華雲豐濱澤戶與論慶間飛見岡隱陽陸線鐵車號樓橋龍鳥嶼頭風開發圓萬寶興蘭蘇溫漢寧學運遠達邊舊樂經營黃葉齊嶺峽濟維綠陳鄭趙錦銀鏡隊險電領顯麗壓劍聖臨淺廳庫亞熱賀輪壽 | 文字 | [geonames-airports.ts:47](../../packages/domain/src/geonames-airports.ts#L47) |
| `geonames-airports.cde2814a` | 写死 | 国家文件是空的 | 错误提示 | [geonames-airports.ts:143](../../packages/domain/src/geonames-airports.ts#L143) |
| `geonames-airports.e1d201a2` | 写死 | 国家文件不是 GeoNames 的 &lt;国家码&gt;.txt：每行应当有 {COUNTRY\_FILE\_COLUMNS} 列（制表符分隔） | 错误提示 | [geonames-airports.ts:145](../../packages/domain/src/geonames-airports.ts#L145) |
| `geonames-airports.d94d6998` | 写死 | 国家文件的第 {…} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试 | 错误提示 | [geonames-airports.ts:148](../../packages/domain/src/geonames-airports.ts#L148) |
| `geonames-airports.f792154a` | 写死 | 这一行有 {length} 列，应当是 {COUNTRY\_FILE\_COLUMNS} 列 | 文字 | [geonames-airports.ts:160](../../packages/domain/src/geonames-airports.ts#L160) |
| `geonames-airports.5297b145` | 写死 | 数据源编号不是数字 | 文字 | [geonames-airports.ts:161](../../packages/domain/src/geonames-airports.ts#L161) |
| `geonames-airports.aab9a81b` | 写死 | 数据源编号在文件里重复出现 | 文字 | [geonames-airports.ts:162](../../packages/domain/src/geonames-airports.ts#L162) |
| `geonames-airports.b8326f5a` | 写死 | 坐标缺失或超出范围（要求十进制数字） | 文字 | [geonames-airports.ts:163](../../packages/domain/src/geonames-airports.ts#L163) |
| `geonames-airports.ac51a82a` | 写死 | 名称文件的第 {…} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试 | 错误提示 | [geonames-airports.ts:209](../../packages/domain/src/geonames-airports.ts#L209) |
| `geonames-airports.8ec9e68e` | 写死 | 名称文件的第 {…} 行不是 GeoNames 的 alternateNames 格式（至少要有 4 列） | 错误提示 | [geonames-airports.ts:211](../../packages/domain/src/geonames-airports.ts#L211) |
| `geonames-airports.408acfca` | 写死 | 数据源里有 {length} 个机场记录都用这个三字码（{…}），分不清是哪一个，没有填 | 提示 | [geonames-airports.ts:341](../../packages/domain/src/geonames-airports.ts#L341) |
| `geonames-airports.edccb9d8` | 写死 | 数据源里这个三字码的机场在 {countryCode}，库里的在 {countryCode}，没有填 | 提示 | [geonames-airports.ts:350](../../packages/domain/src/geonames-airports.ts#L350) |
| `geonames-airports.2d28b15a` | 写死 | 数据源里这个三字码的机场「{label}」和库里的坐标相差约 {…} 公里，可能不是同一个机场，没有填 | 提示 | [geonames-airports.ts:355](../../packages/domain/src/geonames-airports.ts#L355) |

## 城市主数据的公开数据源（geonames.ts）

文件：`packages/domain/src/geonames.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `geonames.89d48d22` | 写死 | 知识共享 署名 4.0（CC BY 4.0），使用时须注明来源 GeoNames；不保证准确 | 文字 | [geonames.ts:35](../../packages/domain/src/geonames.ts#L35) |
| `geonames.91b1a718` | 写死 | 是城市里的区（日文名以「区」结尾），不是城市 | 文字 | [geonames.ts:73](../../packages/domain/src/geonames.ts#L73) |
| `geonames.26a9ecc4` | 写死 | 是某个市里面的街区（同一个市另有一条首府记录），不是城市 | 文字 | [geonames.ts:74](../../packages/domain/src/geonames.ts#L74) |
| `geonames.2528421b` | 写死 | 名称文件的第 {…} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试 | 错误提示 | [geonames.ts:166](../../packages/domain/src/geonames.ts#L166) |
| `geonames.427c6e50` | 写死 | 名称文件的第 {…} 行不是 GeoNames 的 alternateNames 格式（至少要有 4 列） | 错误提示 | [geonames.ts:168](../../packages/domain/src/geonames.ts#L168) |
| `geonames.68816061` | 写死 | 城市文件是空的 | 错误提示 | [geonames.ts:203](../../packages/domain/src/geonames.ts#L203) |
| `geonames.825df95e` | 写死 | 城市文件不是 GeoNames 的 cities15000.txt：每行应当有 {CITY\_COLUMNS} 列（制表符分隔） | 错误提示 | [geonames.ts:205](../../packages/domain/src/geonames.ts#L205) |
| `geonames.8dd9d34f` | 写死 | 城市文件的第 {…} 行里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试 | 错误提示 | [geonames.ts:214](../../packages/domain/src/geonames.ts#L214) |
| `geonames.046b96e0` | 写死 | （空行） | 名称 | [geonames.ts:221](../../packages/domain/src/geonames.ts#L221) |
| `geonames.f394f0d0` | 写死 | 这一行有 {length} 列，应当是 {CITY\_COLUMNS} 列 | 文字 | [geonames.ts:224](../../packages/domain/src/geonames.ts#L224) |
| `geonames.32853852` | 写死 | 数据源编号不是数字 | 文字 | [geonames.ts:240](../../packages/domain/src/geonames.ts#L240) |
| `geonames.7f4bc4f9` | 写死 | 数据源编号在文件里重复出现 | 文字 | [geonames.ts:241](../../packages/domain/src/geonames.ts#L241) |
| `geonames.09288d30` | 写死 | 国家码 {…} 不是合法的 ISO 3166-1 代码 | 文字 | [geonames.ts:242](../../packages/domain/src/geonames.ts#L242) |
| `geonames.3a089aeb` | 写死 | （空） | 文字 | [geonames.ts:242](../../packages/domain/src/geonames.ts#L242)、246 行 |
| `geonames.f204fe85` | 写死 | 名称为空或超过 200 个字符 | 文字 | [geonames.ts:243](../../packages/domain/src/geonames.ts#L243) |
| `geonames.94e6fb6b` | 写死 | 坐标缺失或超出范围（要求十进制数字） | 文字 | [geonames.ts:244](../../packages/domain/src/geonames.ts#L244) |
| `geonames.600ecfda` | 写死 | 坐标是 (0, 0)，多半是没有填 | 文字 | [geonames.ts:245](../../packages/domain/src/geonames.ts#L245) |
| `geonames.43445efb` | 写死 | 时区 {…} 不是合法的 IANA 时区名 | 文字 | [geonames.ts:246](../../packages/domain/src/geonames.ts#L246) |
| `geonames.85f00751` | 写死 | 这个编码已被库里另一个城市使用，没有覆盖 | 提示 | [geonames.ts:366](../../packages/domain/src/geonames.ts#L366) |
| `geonames.4f1dfee9` | 写死 | 后台已经有一个看起来相同的城市 {code}（名称相同或相距不到 5 公里），没有合并也没有重复创建 | 提示 | [geonames.ts:374](../../packages/domain/src/geonames.ts#L374) |
| `geonames.cebd841a` | 写死 | 数据源里这个城市的国家由 {countryCode} 变成了 {countryCode}，没有自动修改 | 提示 | [geonames.ts:381](../../packages/domain/src/geonames.ts#L381) |

## 含公里数和区域加价的说法（included-km.ts）

文件：`packages/domain/src/included-km.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `included-km.f019f795` | 写死 | 含 {…} 公里，本次路线约 {…} 公里， | 文字 | [included-km.ts:59](../../packages/domain/src/included-km.ts#L59) |
| `included-km.4121c92e` | 写死 | {head}在含的公里数以内 | 说明 | [included-km.ts:60](../../packages/domain/src/included-km.ts#L60)、71 行 |
| `included-km.cae82a4f` | 写死 | {head}超出的公里不另收 | 说明 | [included-km.ts:61](../../packages/domain/src/included-km.ts#L61) |
| `included-km.e3a6c113` | 写死 | {head}超出 {…} 公里 × {…}（已含在一口价里） | 说明 | [included-km.ts:62](../../packages/domain/src/included-km.ts#L62) |
| `included-km.5960f0de` | 写死 | 含 {…} 公里 · 路线约 {…} 公里（报价时）·  | 文字 | [included-km.ts:70](../../packages/domain/src/included-km.ts#L70) |
| `included-km.f81443c4` | 写死 | {head}超出 {…} 公里 | 说明 | [included-km.ts:71](../../packages/domain/src/included-km.ts#L71) |
| `included-km.5e5398de` | 写死 | {summary}，不另收 | 说明 | [included-km.ts:78](../../packages/domain/src/included-km.ts#L78) |
| `included-km.4ae09c5d` | 写死 | 路线 {…} 米 | 文字 | [included-km.ts:83](../../packages/domain/src/included-km.ts#L83) |
| `included-km.70207740` | 写死 | 含区域加价，已算在这个价格里 | 说明 | [included-km.ts:87](../../packages/domain/src/included-km.ts#L87) |
| `included-km.6a572f82` | 写死 | （含区域加价） | 说明 | [included-km.ts:88](../../packages/domain/src/included-km.ts#L88) |

## 库存（inventory.ts）

文件：`packages/domain/src/inventory.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `inventory.70894f3a` | 写死 | 不限量 | 文字 | [inventory.ts:15](../../packages/domain/src/inventory.ts#L15) |
| `inventory.c99eaea1` | 写死 | 限量 | 文字 | [inventory.ts:15](../../packages/domain/src/inventory.ts#L15) |

## 官网和嵌入页的三份法律文案（legal-pages.ts）

文件：`packages/domain/src/legal-pages.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `legal-pages.370eed6d` | 写死 | 特定商取引法表記「販売事業者」、プライバシーポリシー开头 | 文字 | [legal-pages.ts:41](../../packages/domain/src/legal-pages.ts#L41) |
| `legal-pages.526bc1b4` | 写死 | 販売事業者（销售主体） | 名称 | [legal-pages.ts:41](../../packages/domain/src/legal-pages.ts#L41) |
| `legal-pages.4350a9aa` | 写死 | 特定商取引法表記「日本国内の連絡先」：日本的地址和电话，或「請求があった場合は遅滞なく開示します」 | 文字 | [legal-pages.ts:42](../../packages/domain/src/legal-pages.ts#L42) |
| `legal-pages.459ed963` | 写死 | 日本国内の連絡先 | 名称 | [legal-pages.ts:42](../../packages/domain/src/legal-pages.ts#L42) |
| `legal-pages.5f769394` | 写死 | メールアドレス（联系邮箱） | 名称 | [legal-pages.ts:43](../../packages/domain/src/legal-pages.ts#L43) |
| `legal-pages.fac2983f` | 写死 | 特定商取引法表記「メールアドレス」、プライバシーポリシー第 7 条 | 文字 | [legal-pages.ts:43](../../packages/domain/src/legal-pages.ts#L43) |
| `legal-pages.2bf91503` | 写死 | メール配信事業者（邮件服务商） | 名称 | [legal-pages.ts:44](../../packages/domain/src/legal-pages.ts#L44) |
| `legal-pages.50c7db34` | 写死 | プライバシーポリシー第 4 条的表格 | 文字 | [legal-pages.ts:44](../../packages/domain/src/legal-pages.ts#L44)、45、46、47、48、49 行 |
| `legal-pages.da9160ff` | 写死 | メール配信事業者の所在国 | 名称 | [legal-pages.ts:45](../../packages/domain/src/legal-pages.ts#L45) |
| `legal-pages.8ad886df` | 写死 | 地図表示事業者（地图底图服务商） | 名称 | [legal-pages.ts:46](../../packages/domain/src/legal-pages.ts#L46) |
| `legal-pages.c519689e` | 写死 | 地図表示事業者の所在国 | 名称 | [legal-pages.ts:47](../../packages/domain/src/legal-pages.ts#L47) |
| `legal-pages.fde181b2` | 写死 | サーバー事業者（服务器服务商） | 名称 | [legal-pages.ts:48](../../packages/domain/src/legal-pages.ts#L48) |
| `legal-pages.3c88f75f` | 写死 | サーバー事業者の所在国 | 名称 | [legal-pages.ts:49](../../packages/domain/src/legal-pages.ts#L49) |
| `legal-pages.00a27e1f` | 写死 | プライバシーポリシー末尾「制定日」 | 文字 | [legal-pages.ts:50](../../packages/domain/src/legal-pages.ts#L50) |
| `legal-pages.dd4f61d4` | 写死 | 公開日（制定日） | 名称 | [legal-pages.ts:50](../../packages/domain/src/legal-pages.ts#L50) |
| `legal-pages.a7113fe6` | 写死 | 未設定 | 文字 | [legal-pages.ts:125](../../packages/domain/src/legal-pages.ts#L125) |
| `legal-pages.1278d4a0` | 写死 | {…}年{…}月{…}日 | 文字 | [legal-pages.ts:131](../../packages/domain/src/legal-pages.ts#L131) |
| `legal-pages.99401b6c` | 写死 | 空港送迎 | 文字 | [legal-pages.ts:137](../../packages/domain/src/legal-pages.ts#L137) |
| `legal-pages.f5a369ac` | 写死 | 地点間送迎 | 文字 | [legal-pages.ts:138](../../packages/domain/src/legal-pages.ts#L138) |
| `legal-pages.1a656f48` | 写死 | 貸切（チャーター） | 文字 | [legal-pages.ts:139](../../packages/domain/src/legal-pages.ts#L139) |
| `legal-pages.328f534a` | 写死 | エコノミー | 文字 | [legal-pages.ts:143](../../packages/domain/src/legal-pages.ts#L143) |
| `legal-pages.1e8c2e50` | 写死 | コンフォート | 文字 | [legal-pages.ts:144](../../packages/domain/src/legal-pages.ts#L144) |
| `legal-pages.2dc177ac` | 写死 | ビジネス | 文字 | [legal-pages.ts:145](../../packages/domain/src/legal-pages.ts#L145) |
| `legal-pages.287add8e` | 写死 | ラグジュアリー | 文字 | [legal-pages.ts:146](../../packages/domain/src/legal-pages.ts#L146) |
| `legal-pages.fb83c488` | 写死 | マイクロバス（10 名以上） | 文字 | [legal-pages.ts:147](../../packages/domain/src/legal-pages.ts#L147) |
| `legal-pages.87a9e260` | 写死 | 無料 | 名称 | [legal-pages.ts:169](../../packages/domain/src/legal-pages.ts#L169) |
| `legal-pages.57dc59a2` | 写死 | ご利用時間にかかわらず | 文字 | [legal-pages.ts:180](../../packages/domain/src/legal-pages.ts#L180) |
| `legal-pages.360ac408` | 写死 | {minHoursBefore} 時間前まで | 文字 | [legal-pages.ts:181](../../packages/domain/src/legal-pages.ts#L181) |
| `legal-pages.e5f8a6f8` | 写死 | {upper} 時間前以降 | 文字 | [legal-pages.ts:183](../../packages/domain/src/legal-pages.ts#L183) |
| `legal-pages.ee300d14` | 写死 | {upper} 時間前〜{minHoursBefore} 時間前 | 文字 | [legal-pages.ts:184](../../packages/domain/src/legal-pages.ts#L184) |
| `legal-pages.ae66c061` | 写死 | ちょうど {minHoursBefore} 時間前は{…} | 文字 | [legal-pages.ts:227](../../packages/domain/src/legal-pages.ts#L227) |
| `legal-pages.ea87828a` | 写死 | 全車種 | 名称 | [legal-pages.ts:233](../../packages/domain/src/legal-pages.ts#L233) |
| `legal-pages.9ada6ac3` | 写死 | {…}{…}とします | 说明 | [legal-pages.ts:235](../../packages/domain/src/legal-pages.ts#L235) |

## 人工报价申请（manual-quote.ts）

文件：`packages/domain/src/manual-quote.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `manual-quote.f2e50b03` | 写死 | 新 | 文字 | [manual-quote.ts:18](../../packages/domain/src/manual-quote.ts#L18) |
| `manual-quote.7430c0ef` | 写死 | 跟进中 | 文字 | [manual-quote.ts:19](../../packages/domain/src/manual-quote.ts#L19) |
| `manual-quote.25c23dc4` | 写死 | 已报价 | 文字 | [manual-quote.ts:20](../../packages/domain/src/manual-quote.ts#L20) |
| `manual-quote.cb2f6c19` | 写死 | 已转订单 | 文字 | [manual-quote.ts:21](../../packages/domain/src/manual-quote.ts#L21) |
| `manual-quote.3543463d` | 写死 | 关闭 | 文字 | [manual-quote.ts:22](../../packages/domain/src/manual-quote.ts#L22) |
| `manual-quote.41bd6e55` | 写死 | 包车 | 文字 | [manual-quote.ts:150](../../packages/domain/src/manual-quote.ts#L150) |
| `manual-quote.c6883a5b` | 写死 | 点对点 | 文字 | [manual-quote.ts:150](../../packages/domain/src/manual-quote.ts#L150) |
| `manual-quote.edf543d7` | 写死 | 接送机 | 文字 | [manual-quote.ts:150](../../packages/domain/src/manual-quote.ts#L150) |
| `manual-quote.86ca75ef` | 写死 |  {packageHours} 小时 | 文字 | [manual-quote.ts:162](../../packages/domain/src/manual-quote.ts#L162) |
| `manual-quote.87e55a1e` | 写死 | 您好，我想咨询用车报价：{…}{hours}，{route}，{when}，{passengers} 人。 | 文字 | [manual-quote.ts:164](../../packages/domain/src/manual-quote.ts#L164) |

## 平台主数据的规则（master-data.ts）

文件：`packages/domain/src/master-data.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `master-data.bd9c317c` | 写死 | 新干线 | 文字 | [master-data.ts:38](../../packages/domain/src/master-data.ts#L38) |
| `master-data.c993e07b` | 写死 | 铁路 | 文字 | [master-data.ts:39](../../packages/domain/src/master-data.ts#L39) |
| `master-data.e7b1880d` | 写死 | 地铁 | 文字 | [master-data.ts:40](../../packages/domain/src/master-data.ts#L40) |
| `master-data.17267afe` | 写死 | 酒店 | 文字 | [master-data.ts:41](../../packages/domain/src/master-data.ts#L41) |
| `master-data.44e73c8e` | 写死 | 景点 | 按钮 | [master-data.ts:42](../../packages/domain/src/master-data.ts#L42) |
| `master-data.51f7974b` | 写死 | 港口 | 文字 | [master-data.ts:43](../../packages/domain/src/master-data.ts#L43) |
| `master-data.a6c18506` | 写死 | 商场 | 文字 | [master-data.ts:44](../../packages/domain/src/master-data.ts#L44) |
| `master-data.8d6fa64b` | 写死 | 经济 | 文字 | [master-data.ts:56](../../packages/domain/src/master-data.ts#L56) |
| `master-data.d3e3fb00` | 写死 | 舒适 | 文字 | [master-data.ts:57](../../packages/domain/src/master-data.ts#L57) |
| `master-data.05d2fe0b` | 写死 | 商务 | 文字 | [master-data.ts:58](../../packages/domain/src/master-data.ts#L58) |
| `master-data.55c89209` | 写死 | 豪华 | 文字 | [master-data.ts:59](../../packages/domain/src/master-data.ts#L59) |
| `master-data.e2adfc92` | 写死 | 边界顶点太多（{points} 个），最多 {MAX\_BOUNDARY\_POINTS} 个 | 文字 | [master-data.ts:152](../../packages/domain/src/master-data.ts#L152) |
| `master-data.55f26d48` | 写死 | 格式应为 CTY-国家码-序号，序号是 2 到 8 位大写字母或数字，例如 CTY-JP-TYO | 文字 | [master-data.ts:160](../../packages/domain/src/master-data.ts#L160) |
| `master-data.bd1c4c0c` | 写死 | 编码里的国家码 {…} 和所属国家 {countryCode} 不一致 | 文字 | [master-data.ts:161](../../packages/domain/src/master-data.ts#L161)、191 行 |
| `master-data.1056d466` | 写死 | 机场编码必须是 IATA 三字码（3 个大写字母），例如 HND | 文字 | [master-data.ts:187](../../packages/domain/src/master-data.ts#L187) |
| `master-data.39a52195` | 写死 | 格式应为 STN-国家码-序号，序号是 1 到 10 位大写字母或数字，例如 STN-JP-TOKYO | 文字 | [master-data.ts:190](../../packages/domain/src/master-data.ts#L190) |
| `master-data.abf677df` | 写死 | 格式应为 POI-序号，序号是 1 到 12 位大写字母或数字，例如 POI-000123 | 文字 | [master-data.ts:194](../../packages/domain/src/master-data.ts#L194) |
| `master-data.f5e75e1e` | 写死 | 格式应为上级编码加后缀，后缀是 1 到 6 位大写字母或数字，例如 {…}-{…} | 文字 | [master-data.ts:199](../../packages/domain/src/master-data.ts#L199) |
| `master-data.50680b0b` | 写死 | 只有车站和地标有类型 | 错误提示 | [master-data.ts:290](../../packages/domain/src/master-data.ts#L290) |
| `master-data.695391a7` | 写死 | 必填 | 错误提示 | [master-data.ts:292](../../packages/domain/src/master-data.ts#L292) |
| `master-data.24f44214` | 写死 | 地标 | 错误提示 | [master-data.ts:295](../../packages/domain/src/master-data.ts#L295) |
| `master-data.77d93075` | 写死 | {…}的类型只能是：{names} | 错误提示 | [master-data.ts:295](../../packages/domain/src/master-data.ts#L295) |
| `master-data.bfef7cf4` | 写死 | 车站 | 错误提示 | [master-data.ts:295](../../packages/domain/src/master-data.ts#L295) |
| `master-data.43d4bd25` | 写死 | 只有机场和航站楼有国际 / 国内属性 | 错误提示 | [master-data.ts:298](../../packages/domain/src/master-data.ts#L298) |
| `master-data.66727411` | 写死 | 还没有指定所属城市，不能启用 | 文字 | [master-data.ts:308](../../packages/domain/src/master-data.ts#L308) |
| `master-data.47b16c5c` | 写死 | 所属城市已停用，请先启用城市 | 文字 | [master-data.ts:309](../../packages/domain/src/master-data.ts#L309) |
| `master-data.0c66f1d6` | 写死 | 上级地点已停用，请先启用上级地点 | 文字 | [master-data.ts:310](../../packages/domain/src/master-data.ts#L310) |
| `master-data.bf95056f` | 写死 | 格式应为 VG-等级-座位数，等级是 2 到 8 位大写字母或数字，例如 VG-BIZ-7 | 文字 | [master-data.ts:346](../../packages/domain/src/master-data.ts#L346) |
| `master-data.0b6258c8` | 写死 | 编码末尾的座位数 {…} 和座位数 {seats} 不一致 | 文字 | [master-data.ts:347](../../packages/domain/src/master-data.ts#L347) |
| `master-data.a8f8a97f` | 写死 | 编码里的 {…} 是「{…}」的缩写，和所选的等级「{…}」不一致（{…}的缩写是 {…}） | 文字 | [master-data.ts:352](../../packages/domain/src/master-data.ts#L352) |
| `master-data.310d7003` | 写死 | 至少要有一个「人数 / 行李数」组合 | 错误提示 | [master-data.ts:366](../../packages/domain/src/master-data.ts#L366) |
| `master-data.977cc55c` | 写死 | 组合最多 {MAX\_VEHICLE\_COMBOS} 个 | 错误提示 | [master-data.ts:367](../../packages/domain/src/master-data.ts#L367) |
| `master-data.4e390663` | 写死 | 第 {…} 个组合 | 名称 | [master-data.ts:370](../../packages/domain/src/master-data.ts#L370) |
| `master-data.a15962cb` | 写死 | {label}：人数必须是不小于 1 的整数 | 错误提示 | [master-data.ts:371](../../packages/domain/src/master-data.ts#L371) |
| `master-data.f17adca4` | 写死 | {label}：人数 {passengers} 超过了座位数 {seats} | 错误提示 | [master-data.ts:372](../../packages/domain/src/master-data.ts#L372) |
| `master-data.b4939b6e` | 写死 | {label}：行李数必须是 0 到 {MAX\_LUGGAGE} 的整数 | 错误提示 | [master-data.ts:374](../../packages/domain/src/master-data.ts#L374) |
| `master-data.21319d69` | 写死 | {label}：和前面的组合重复 | 错误提示 | [master-data.ts:377](../../packages/domain/src/master-data.ts#L377) |
| `master-data.88920c8e` | 写死 | 格式应为 ADD-代码，代码以大写字母开头，由大写字母、数字、下划线组成，例如 ADD-CHILD\_SEAT | 文字 | [master-data.ts:387](../../packages/domain/src/master-data.ts#L387) |

## 订单与付款（orders.ts）

文件：`packages/domain/src/orders.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `orders.02fff3f3` | 写死 | 待支付 | 文字 | [orders.ts:37](../../packages/domain/src/orders.ts#L37) |
| `orders.453d79ae` | 写死 | 已确认 | 文字 | [orders.ts:38](../../packages/domain/src/orders.ts#L38) |
| `orders.567a3d46` | 写死 | 已派车 | 文字 | [orders.ts:39](../../packages/domain/src/orders.ts#L39) |
| `orders.d333383a` | 写死 | 司机已出发 | 文字 | [orders.ts:40](../../packages/domain/src/orders.ts#L40) |
| `orders.b32bd938` | 写死 | 司机已到达 | 文字 | [orders.ts:41](../../packages/domain/src/orders.ts#L41) |
| `orders.d479c1b7` | 写死 | 服务中 | 文字 | [orders.ts:42](../../packages/domain/src/orders.ts#L42) |
| `orders.98010e92` | 写死 | 已完成 | 文字 | [orders.ts:43](../../packages/domain/src/orders.ts#L43) |
| `orders.77e0a68c` | 写死 | 客人未出现（待审核） | 文字 | [orders.ts:44](../../packages/domain/src/orders.ts#L44) |
| `orders.8839aff8` | 写死 | 客人未出现 | 文字 | [orders.ts:45](../../packages/domain/src/orders.ts#L45) |
| `orders.5af13c08` | 写死 | 已取消 | 文字 | [orders.ts:46](../../packages/domain/src/orders.ts#L46) |
| `orders.8659c802` | 写死 | 救援改派中 | 文字 | [orders.ts:47](../../packages/domain/src/orders.ts#L47) |
| `orders.24db2eae` | 写死 | 已转给救援供应商 | 文字 | [orders.ts:48](../../packages/domain/src/orders.ts#L48) |

## 机场主数据的公开数据源（ourairports.ts）

文件：`packages/domain/src/ourairports.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ourairports.98bfd536` | 写死 | 公有领域（Public Domain），不保证准确 | 文字 | [ourairports.ts:21](../../packages/domain/src/ourairports.ts#L21) |
| `ourairports.9f79949f` | 写死 | 文件是空的 | 错误提示 | [ourairports.ts:72](../../packages/domain/src/ourairports.ts#L72) |
| `ourairports.02357d6b` | 写死 | 文件不是 OurAirports 的 airports.csv：缺少列 {…} | 错误提示 | [ourairports.ts:74](../../packages/domain/src/ourairports.ts#L74) |
| `ourairports.6c4cee79` | 写死 | 文件的第 {…} 条记录{…}里有 NUL 字符，文件可能已损坏或不是文本文件。请重新下载后再试 | 错误提示 | [ourairports.ts:91](../../packages/domain/src/ourairports.ts#L91) |
| `ourairports.64b9390d` | 写死 | 数据源编号不是数字 | 文字 | [ourairports.ts:108](../../packages/domain/src/ourairports.ts#L108) |
| `ourairports.be5b4c3c` | 写死 | 数据源编号在文件里重复出现 | 文字 | [ourairports.ts:109](../../packages/domain/src/ourairports.ts#L109) |
| `ourairports.dfa6d84a` | 写死 | 没有 IATA 三字码 | 文字 | [ourairports.ts:110](../../packages/domain/src/ourairports.ts#L110) |
| `ourairports.e054359b` | 写死 | IATA 三字码 {iata} 格式不对 | 文字 | [ourairports.ts:111](../../packages/domain/src/ourairports.ts#L111) |
| `ourairports.4e0c947b` | 写死 | （空） | 文字 | [ourairports.ts:112](../../packages/domain/src/ourairports.ts#L112) |
| `ourairports.787308f7` | 写死 | 国家码 {…} 不是合法的 ISO 3166-1 代码 | 文字 | [ourairports.ts:112](../../packages/domain/src/ourairports.ts#L112) |
| `ourairports.47a08358` | 写死 | 名称为空或超过 200 个字符 | 文字 | [ourairports.ts:113](../../packages/domain/src/ourairports.ts#L113) |
| `ourairports.eb509b37` | 写死 | 坐标缺失或超出范围（要求十进制数字） | 文字 | [ourairports.ts:114](../../packages/domain/src/ourairports.ts#L114) |
| `ourairports.5b3d90b7` | 写死 | 坐标是 (0, 0)，多半是没有填 | 文字 | [ourairports.ts:115](../../packages/domain/src/ourairports.ts#L115) |
| `ourairports.0b8a5a33` | 写死 | IATA 三字码 {iata} 在文件里重复出现，只取第一条 | 文字 | [ourairports.ts:116](../../packages/domain/src/ourairports.ts#L116) |
| `ourairports.c151a6ff` | 写死 | 这个三字码已被另一条导入的机场使用 | 提示 | [ourairports.ts:192](../../packages/domain/src/ourairports.ts#L192) |
| `ourairports.ddd3e3eb` | 写死 | 后台已经手工录入了这个三字码的机场，没有覆盖 | 提示 | [ourairports.ts:192](../../packages/domain/src/ourairports.ts#L192) |
| `ourairports.e157021d` | 写死 | 数据源里这个机场的三字码由 {code} 变成了 {iata}，编码不能自动修改 | 提示 | [ourairports.ts:198](../../packages/domain/src/ourairports.ts#L198) |
| `ourairports.acff24fc` | 写死 | 数据源里这个机场的国家由 {countryCode} 变成了 {countryCode}，没有自动修改 | 提示 | [ourairports.ts:202](../../packages/domain/src/ourairports.ts#L202) |

## 运营「代客人改单」改乘客邮箱要双人复核（passenger-email-review.ts）

文件：`packages/domain/src/passenger-email-review.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `passenger-email-review.f8a88591` | 写死 | 这张单的乘客信息已按隐私规则清除，不能再改邮箱 | 文字 | [passenger-email-review.ts:39](../../packages/domain/src/passenger-email-review.ts#L39) |
| `passenger-email-review.b2c36edb` | 写死 | 审核期间订单上的邮箱已经被改过（客人或渠道），这条申请已经不适用 | 文字 | [passenger-email-review.ts:40](../../packages/domain/src/passenger-email-review.ts#L40) |

## 密码最小强度规则（password-policy.ts）

文件：`packages/domain/src/password-policy.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `password-policy.73504982` | 写死 | 密码至少 {PASSWORD\_MIN\_LENGTH} 个字符 | 文字 | [password-policy.ts:24](../../packages/domain/src/password-policy.ts#L24) |
| `password-policy.aee1b7b0` | 写死 | 密码最多 {PASSWORD\_MAX\_LENGTH} 个字符 | 文字 | [password-policy.ts:25](../../packages/domain/src/password-policy.ts#L25) |
| `password-policy.fe189e53` | 写死 | 密码要包含小写字母、大写字母、数字、符号中的至少三类 | 文字 | [password-policy.ts:26](../../packages/domain/src/password-policy.ts#L26) |
| `password-policy.50c644cd` | 写死 | 密码里至少要有 {MIN\_DISTINCT\_CHARACTERS} 个不同的字符 | 文字 | [password-policy.ts:27](../../packages/domain/src/password-policy.ts#L27) |
| `password-policy.81c535cf` | 写死 | 密码不能包含邮箱名 | 文字 | [password-policy.ts:28](../../packages/domain/src/password-policy.ts#L28) |

## 机场 / 航站楼的地址、集合地点说明（place-content-texts.ts）

文件：`packages/domain/src/place-content-texts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `place-content.blank` | 已走 key | 不能只有空白或不可见字符 | 文字 | [place-content-texts.ts:21](../../packages/domain/src/place-content-texts.ts#L21) |
| `place-content.untrimmed` | 已走 key | 首尾不能有空白 | 文字 | [place-content-texts.ts:22](../../packages/domain/src/place-content-texts.ts#L22) |
| `place-content.tooLong` | 已走 key | 最多 {max} 个字 | 文字 | [place-content-texts.ts:23](../../packages/domain/src/place-content-texts.ts#L23) |
| `place-content.notObject` | 已走 key | 要是一个按语言分开的文字对象，例如 {"zh": "…"} | 文字 | [place-content-texts.ts:24](../../packages/domain/src/place-content-texts.ts#L24) |
| `place-content.unknownLanguage` | 已走 key | 只支持这些语言：{languages} | 文字 | [place-content-texts.ts:25](../../packages/domain/src/place-content-texts.ts#L25) |
| `place-content.noLanguage` | 已走 key | 至少填一种语言 | 文字 | [place-content-texts.ts:26](../../packages/domain/src/place-content-texts.ts#L26) |
| `place-content.zhRequired` | 已走 key | 中文必填 | 提示 | [place-content-texts.ts:27](../../packages/domain/src/place-content-texts.ts#L27) |
| `place-content.addressType` | 已走 key | 只有地标、机场和航站楼有地址 | 文字 | [place-content-texts.ts:28](../../packages/domain/src/place-content-texts.ts#L28) |
| `place-content.meetingPointType` | 已走 key | 只有机场和航站楼有集合地点说明 | 文字 | [place-content-texts.ts:29](../../packages/domain/src/place-content-texts.ts#L29) |
| `place-content.terminalImportRunning` | 已走 key | 另一个航站楼核对表导入正在运行。数据库没有任何变化，请等它结束后再试 | 文字 | [place-content-texts.ts:30](../../packages/domain/src/place-content-texts.ts#L30) |
| `place-content.terminalImportCodeConflict` | 已走 key | 导入期间有人在后台新增了编码相同的航站楼。数据库没有任何变化，请再运行一次 | 文字 | [place-content-texts.ts:31](../../packages/domain/src/place-content-texts.ts#L31) |

## 地点名称的匹配规则（place-match.ts）

文件：`packages/domain/src/place-match.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `place-match.034cf574` | 写死 | 飞机场 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.0cb4a2af` | 写死 | 機場 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、87 行 |
| `place-match.100dfd3f` | 写死 | 机场 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、87 行 |
| `place-match.21ea5c40` | 写死 | 駅 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、86 行 |
| `place-match.375798ab` | 写死 | 国际机场 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.4af95cfd` | 写死 | 航站楼 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、87 行 |
| `place-match.679b08ef` | 写死 | 空港 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、87 行 |
| `place-match.6e42c51d` | 写死 | 国際 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.73e29580` | 写死 | 車站 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、86 行 |
| `place-match.846cf03a` | 写死 | 火车站 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、86 行 |
| `place-match.9f91beef` | 写死 | 國際 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.b97fcc0d` | 写死 | 车站 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12)、86 行 |
| `place-match.d6d23113` | 写死 | 國際機場 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.e71fc13d` | 写死 | 国際空港 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |
| `place-match.ed566fbc` | 写死 | 国际 | 文字 | [place-match.ts:12](../../packages/domain/src/place-match.ts#L12) |

## 价格表导入第 1 阶段（price-import.ts）

文件：`packages/domain/src/price-import.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `price-import.808665d6` | 写死 | 子品牌的币种（{currency}）和官网渠道的币种（{channelCurrency}）不同，显示价随汇率变，不能倒算 | 错误提示 | [price-import.ts:60](../../packages/domain/src/price-import.ts#L60) |
| `price-import.d7f42db4` | 写死 | 官网把对外价向上取整到固定单位，表上价不是这个单位的倍数 | 文字 | [price-import.ts:132](../../packages/domain/src/price-import.ts#L132) |
| `price-import.5a1259d8` | 写死 | 子品牌的结算价按取整单位取整，相邻两档的显示价跨过了表上价 | 文字 | [price-import.ts:133](../../packages/domain/src/price-import.ts#L133) |
| `price-import.e7827b77` | 写死 | 结算价每加 1 日元显示价加（1 + 加价比例）日元，表上价正好落在跳过去的那个数上 | 文字 | [price-import.ts:134](../../packages/domain/src/price-import.ts#L134) |
| `price-import.4f28c15f` | 写死 | 表上价比最低能报的价还低（通常是最低毛利比表上价高） | 文字 | [price-import.ts:135](../../packages/domain/src/price-import.ts#L135) |
| `price-import.39855a81` | 写死 | 映射文件的 {what} 要是对象 | 错误提示 | [price-import.ts:192](../../packages/domain/src/price-import.ts#L192) |
| `price-import.c528b71c` | 写死 | 映射文件的写法不对：{what} | 错误提示 | [price-import.ts:201](../../packages/domain/src/price-import.ts#L201) |
| `price-import.790f0a88` | 写死 | 最外层要是对象 | 文字 | [price-import.ts:202](../../packages/domain/src/price-import.ts#L202) |
| `price-import.f11528b4` | 写死 | 不认识的键 {…} | 文字 | [price-import.ts:204](../../packages/domain/src/price-import.ts#L204) |
| `price-import.0b64b60c` | 写死 | 机场「{name}」要写三位大写字母的 IATA 码或 null | 文字 | [price-import.ts:207](../../packages/domain/src/price-import.ts#L207) |
| `price-import.b071e269` | 写死 | 地区「{name}」只能有 lat、lng、radius\_m、polygon、source、note | 文字 | [price-import.ts:216](../../packages/domain/src/price-import.ts#L216) |
| `price-import.be83667d` | 写死 | 地区「{name}」写了多边形就不能再写中心点和半径 | 文字 | [price-import.ts:219](../../packages/domain/src/price-import.ts#L219) |
| `price-import.2ad3e82b` | 写死 | 地区「{name}」的多边形要是一圈合法的 \[经度, 纬度\] | 文字 | [price-import.ts:222](../../packages/domain/src/price-import.ts#L222) |
| `price-import.a65429f4` | 写死 | 地区「{name}」的多边形不合法（点太少或太多、共线、自相交、跨 180° 经线） | 文字 | [price-import.ts:224](../../packages/domain/src/price-import.ts#L224) |
| `price-import.51de76e1` | 写死 | 地区「{name}」的坐标不合法 | 文字 | [price-import.ts:229](../../packages/domain/src/price-import.ts#L229) |
| `price-import.b64cfab5` | 写死 | 地区「{name}」的半径要是 {minRadiusM} 到 {maxRadiusM} 米的整数 | 文字 | [price-import.ts:231](../../packages/domain/src/price-import.ts#L231) |
| `price-import.f88ec3b0` | 写死 | 车型「{name}」要写车型组编码（VG-等级-座位数）或 null | 文字 | [price-import.ts:237](../../packages/domain/src/price-import.ts#L237) |
| `price-import.2374b72b` | 写死 | 滑雪场，暂不导（决定 E） | 文字 | [price-import.ts:270](../../packages/domain/src/price-import.ts#L270) |
| `price-import.b64dd0da` | 写死 | 港口 / 码头，暂不导（决定 E） | 文字 | [price-import.ts:271](../../packages/domain/src/price-import.ts#L271) |
| `price-import.7a2a3128` | 写死 | 映射文件里没有这个机场 | 文字 | [price-import.ts:272](../../packages/domain/src/price-import.ts#L272) |
| `price-import.b53acdb7` | 写死 | 映射文件把这个机场标为不导 | 文字 | [price-import.ts:273](../../packages/domain/src/price-import.ts#L273) |
| `price-import.cef72ccd` | 写死 | 映射文件里没有这个地区 | 文字 | [price-import.ts:274](../../packages/domain/src/price-import.ts#L274) |
| `price-import.6a20f5eb` | 写死 | 地区范围待定（业主核对后再导） | 文字 | [price-import.ts:275](../../packages/domain/src/price-import.ts#L275) |
| `price-import.23c9926f` | 写死 | 映射文件里没有这个车型列，名字也给不出建议编码 | 文字 | [price-import.ts:276](../../packages/domain/src/price-import.ts#L276) |
| `price-import.045ff671` | 写死 | 车型列的等级不在现有四个里（Premium、Bus、Van、SUV 等），映射文件没写明编码或 null，不导 | 文字 | [price-import.ts:277](../../packages/domain/src/price-import.ts#L277) |
| `price-import.cbb6e4f0` | 写死 | 映射文件把这个车型列标为不导 | 文字 | [price-import.ts:278](../../packages/domain/src/price-import.ts#L278) |
| `price-import.16c4567d` | 写死 | 两个车型列映射到了同一个车型组，后面的不导 | 文字 | [price-import.ts:279](../../packages/domain/src/price-import.ts#L279) |
| `price-import.5f1a71b2` | 写死 | 车型列的容量读不出来（选车型组的人数 / 行李组合要用） | 文字 | [price-import.ts:280](../../packages/domain/src/price-import.ts#L280) |
| `price-import.ac9b257c` | 写死 | 同一方向重复列了几行、价格不一致，不选其中一行 | 文字 | [price-import.ts:281](../../packages/domain/src/price-import.ts#L281) |
| `price-import.d1e5a8b8` | 写死 | 只列了一个方向，说明页又没写反向同价 | 文字 | [price-import.ts:282](../../packages/domain/src/price-import.ts#L282) |
| `price-import.e2651279` | 写死 | 批次号只能用字母、数字和短横线，3 到 24 位，字母或数字开头 | 文字 | [price-import.ts:613](../../packages/domain/src/price-import.ts#L613) |
| `price-import.53410997` | 写死 | 价格表导入 {batch} | 名称 | [price-import.ts:618](../../packages/domain/src/price-import.ts#L618)、623 行 |
| `price-import.8f39a092` | 写死 | 目标环境的导出写法不对：{what} | 错误提示 | [price-import.ts:664](../../packages/domain/src/price-import.ts#L664) |
| `price-import.2dfea538` | 写死 | {what} 要是对象 | 文字 | [price-import.ts:666](../../packages/domain/src/price-import.ts#L666) |
| `price-import.f0dd432c` | 写死 | {what} 要是数组 | 文字 | [price-import.ts:670](../../packages/domain/src/price-import.ts#L670) |
| `price-import.dcdba366` | 写死 | {what} 要是 UUID | 文字 | [price-import.ts:674](../../packages/domain/src/price-import.ts#L674) |
| `price-import.e54500cd` | 写死 | {what} 要是文字 | 文字 | [price-import.ts:679](../../packages/domain/src/price-import.ts#L679) |
| `price-import.a75d39fd` | 写死 | {what} 要是不小于 0 的整数 | 文字 | [price-import.ts:683](../../packages/domain/src/price-import.ts#L683) |
| `price-import.c2542ca1` | 写死 | {what} 要是 YYYY-MM-DD 或 null | 文字 | [price-import.ts:693](../../packages/domain/src/price-import.ts#L693) |
| `price-import.7e4ca331` | 写死 | 最外层 | 文字 | [price-import.ts:697](../../packages/domain/src/price-import.ts#L697) |
| `price-import.7ff05fc5` | 写死 | channel.settle\_currency 不是支持的币种 | 文字 | [price-import.ts:701](../../packages/domain/src/price-import.ts#L701) |
| `price-import.142f552f` | 写死 | channel.sell\_rounding 的取整单位要是正整数 | 文字 | [price-import.ts:704](../../packages/domain/src/price-import.ts#L704) |
| `price-import.a23edfb4` | 写死 | markup\_rules\[{index}\].category 不认识 | 文字 | [price-import.ts:710](../../packages/domain/src/price-import.ts#L710) |
| `price-import.3aa55238` | 写死 | markup\_rules\[{index}\] 的维度不是五级之一 | 文字 | [price-import.ts:721](../../packages/domain/src/price-import.ts#L721) |
| `price-import.49253ca3` | 写死 | 目标租户的状态是 {status} | 文字 | [price-import.ts:792](../../packages/domain/src/price-import.ts#L792) |
| `price-import.70a30dde` | 写死 | 官网渠道的结算币种是 {settleCurrency}，价格表是 {currency} | 文字 | [price-import.ts:793](../../packages/domain/src/price-import.ts#L793) |
| `price-import.73d9f9cf` | 写死 | 主数据里没有这个机场 | 文字 | [price-import.ts:799](../../packages/domain/src/price-import.ts#L799) |
| `price-import.0b858457` | 写死 | 机场是停用的 | 文字 | [price-import.ts:803](../../packages/domain/src/price-import.ts#L803) |
| `price-import.ff59c352` | 写死 | 机场还没有指定所属城市（平台要先指定城市并启用） | 文字 | [price-import.ts:803](../../packages/domain/src/price-import.ts#L803) |
| `price-import.8e66596b` | 写死 | 机场所属的城市不存在或停用 | 文字 | [price-import.ts:808](../../packages/domain/src/price-import.ts#L808) |
| `price-import.c47f3429` | 写死 | 平台主数据里没有这个车型组，要由平台先建 | 文字 | [price-import.ts:819](../../packages/domain/src/price-import.ts#L819) |
| `price-import.c3b97f76` | 写死 | 车型组是停用的 | 文字 | [price-import.ts:823](../../packages/domain/src/price-import.ts#L823) |
| `price-import.58d1dc4e` | 写死 | 车型组没有「{passengers} 人 / {luggage} 件」这个组合 | 文字 | [price-import.ts:829](../../packages/domain/src/price-import.ts#L829) |

## 价格表导入第 0 阶段（price-sheet.ts）

文件：`packages/domain/src/price-sheet.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `price-sheet.0db2081a` | 写死 | 说明 | 说明 | [price-sheet.ts:30](../../packages/domain/src/price-sheet.ts#L30)、1192、1199、1257 行 |
| `price-sheet.cb35e1d1` | 写死 | 车型 | 文字 | [price-sheet.ts:31](../../packages/domain/src/price-sheet.ts#L31)、50、51、1245、1246 行 |
| `price-sheet.83480af2` | 写死 | 里程价 | 文字 | [price-sheet.ts:32](../../packages/domain/src/price-sheet.ts#L32) |
| `price-sheet.1b1fde7d` | 写死 | 日本 | 文字 | [price-sheet.ts:36](../../packages/domain/src/price-sheet.ts#L36) |
| `price-sheet.c9f13f79` | 写死 | 中国大陆 | 文字 | [price-sheet.ts:37](../../packages/domain/src/price-sheet.ts#L37) |
| `price-sheet.46a2cd70` | 写死 | 中国香港 | 文字 | [price-sheet.ts:38](../../packages/domain/src/price-sheet.ts#L38) |
| `price-sheet.233aad94` | 写死 | 中国台湾 | 文字 | [price-sheet.ts:39](../../packages/domain/src/price-sheet.ts#L39) |
| `price-sheet.792112d7` | 写死 | 韩国 | 文字 | [price-sheet.ts:40](../../packages/domain/src/price-sheet.ts#L40) |
| `price-sheet.554797cd` | 写死 | 泰国 | 文字 | [price-sheet.ts:41](../../packages/domain/src/price-sheet.ts#L41) |
| `price-sheet.93460a14` | 写死 | 越南 | 文字 | [price-sheet.ts:42](../../packages/domain/src/price-sheet.ts#L42) |
| `price-sheet.fd57a54e` | 写死 | 新加坡 | 文字 | [price-sheet.ts:43](../../packages/domain/src/price-sheet.ts#L43) |
| `price-sheet.db1d7a36` | 写死 | 马来西亚 | 文字 | [price-sheet.ts:44](../../packages/domain/src/price-sheet.ts#L44) |
| `price-sheet.c6afc689` | 写死 | 菲律宾 | 文字 | [price-sheet.ts:45](../../packages/domain/src/price-sheet.ts#L45) |
| `price-sheet.06fb9602` | 写死 | 最多行李 | 文字 | [price-sheet.ts:50](../../packages/domain/src/price-sheet.ts#L50) |
| `price-sheet.74b9bf1d` | 写死 | 代表车型（或同级） | 文字 | [price-sheet.ts:50](../../packages/domain/src/price-sheet.ts#L50) |
| `price-sheet.94c57432` | 写死 | 最多乘客 | 文字 | [price-sheet.ts:50](../../packages/domain/src/price-sheet.ts#L50) |
| `price-sheet.c0970e65` | 写死 | 国家/地区 | 文字 | [price-sheet.ts:50](../../packages/domain/src/price-sheet.ts#L50)、51 行 |
| `price-sheet.2d679b93` | 写死 | 最低消费（日元） | 文字 | [price-sheet.ts:51](../../packages/domain/src/price-sheet.ts#L51) |
| `price-sheet.547113e5` | 写死 | 价格包 | 文字 | [price-sheet.ts:51](../../packages/domain/src/price-sheet.ts#L51) |
| `price-sheet.5bb4a6c1` | 写死 | 超出后每公里（日元） | 文字 | [price-sheet.ts:51](../../packages/domain/src/price-sheet.ts#L51) |
| `price-sheet.98a2f7a8` | 写死 | 来源 | 文字 | [price-sheet.ts:51](../../packages/domain/src/price-sheet.ts#L51) |
| `price-sheet.c1e6b11a` | 写死 | 起步价（日元） | 文字 | [price-sheet.ts:51](../../packages/domain/src/price-sheet.ts#L51) |
| `price-sheet.4d80b37e` | 写死 | 出发地 | 文字 | [price-sheet.ts:52](../../packages/domain/src/price-sheet.ts#L52) |
| `price-sheet.c40bbcb4` | 写死 | 目的地 | 文字 | [price-sheet.ts:52](../../packages/domain/src/price-sheet.ts#L52) |
| `price-sheet.ba13363e` | 写死 | 单元格是公式，没有取值 | 文字 | [price-sheet.ts:112](../../packages/domain/src/price-sheet.ts#L112) |
| `price-sheet.b5eeb9de` | 写死 | 不是数字（{type}） | 文字 | [price-sheet.ts:116](../../packages/domain/src/price-sheet.ts#L116) |
| `price-sheet.a5082d04` | 写死 | 不是合规的正整数 | 文字 | [price-sheet.ts:120](../../packages/domain/src/price-sheet.ts#L120) |
| `price-sheet.04ce70d1` | 写死 | 超过单个金额的上限 {maxAmountMinor} | 文字 | [price-sheet.ts:125](../../packages/domain/src/price-sheet.ts#L125) |
| `price-sheet.657b32c1` | 写死 | 「{name}」的第 {…} 列表头应该是「{title}」 | 错误提示 | [price-sheet.ts:199](../../packages/domain/src/price-sheet.ts#L199) |
| `price-sheet.7e4e0bec` | 写死 | 车型列的表头不是有效的文字，这一列不读 | 文字 | [price-sheet.ts:231](../../packages/domain/src/price-sheet.ts#L231) |
| `price-sheet.f5f0f960` | 写死 | 容量不是「最多 N 人/M 件」的写法 | 文字 | [price-sheet.ts:235](../../packages/domain/src/price-sheet.ts#L235) |
| `price-sheet.7eff4e0d` | 写死 | 出发地、目的地必须是有效的文字，这一行不读 | 文字 | [price-sheet.ts:246](../../packages/domain/src/price-sheet.ts#L246) |
| `price-sheet.1288b407` | 写死 | 这一格所在的列没有车型表头，不读 | 文字 | [price-sheet.ts:250](../../packages/domain/src/price-sheet.ts#L250) |
| `price-sheet.316d6688` | 写死 | 不是约定的 10 个国家 / 地区之一，这一行不读 | 文字 | [price-sheet.ts:273](../../packages/domain/src/price-sheet.ts#L273)、298 行 |
| `price-sheet.e80fd86a` | 写死 | 车型名称不是有效的文字，这一行不读 | 文字 | [price-sheet.ts:277](../../packages/domain/src/price-sheet.ts#L277)、302 行 |
| `price-sheet.6ec91024` | 写死 | 缺少「{name}」这张表 | 错误提示 | [price-sheet.ts:319](../../packages/domain/src/price-sheet.ts#L319) |
| `price-sheet.236f6d62` | 写死 | 说明页没有写「{sheet}」的路线数 | 文字 | [price-sheet.ts:330](../../packages/domain/src/price-sheet.ts#L330) |
| `price-sheet.9c6dc2a8` | 写死 | 说明页写「{name}」{count} 条，实际读到 {actual} 条 | 文字 | [price-sheet.ts:334](../../packages/domain/src/price-sheet.ts#L334) |
| `price-sheet.1b211b3a` | 写死 | 以「港」结尾，可能是港口 | 文字 | [price-sheet.ts:371](../../packages/domain/src/price-sheet.ts#L371) |
| `price-sheet.e31b339f` | 写死 | 以「场」结尾，可能是机场或场地 | 文字 | [price-sheet.ts:372](../../packages/domain/src/price-sheet.ts#L372) |
| `price-sheet.6c2c7f22` | 写死 | 是口岸，地点类型里没有 | 文字 | [price-sheet.ts:373](../../packages/domain/src/price-sheet.ts#L373) |
| `price-sheet.e04a89c8` | 写死 | 机场↔非机场 | 文字 | [price-sheet.ts:379](../../packages/domain/src/price-sheet.ts#L379) |
| `price-sheet.cba77b6a` | 写死 | 车站或码头↔非机场 | 文字 | [price-sheet.ts:380](../../packages/domain/src/price-sheet.ts#L380) |
| `price-sheet.3417c3a8` | 写死 | 机场↔机场 | 文字 | [price-sheet.ts:381](../../packages/domain/src/price-sheet.ts#L381)、399 行 |
| `price-sheet.73f68576` | 写死 | 地点↔地点 | 文字 | [price-sheet.ts:382](../../packages/domain/src/price-sheet.ts#L382) |
| `price-sheet.06cf2907` | 写死 | 需业主确认 | 按钮 | [price-sheet.ts:387](../../packages/domain/src/price-sheet.ts#L387) |
| `price-sheet.6db90be5` | 写死 | 框架外 | 文字 | [price-sheet.ts:387](../../packages/domain/src/price-sheet.ts#L387) |
| `price-sheet.c391db52` | 写死 | 框架内 | 文字 | [price-sheet.ts:387](../../packages/domain/src/price-sheet.ts#L387) |
| `price-sheet.52d4c2f3` | 写死 | 接送机：接送点是机场，另一端是区域 | 说明 | [price-sheet.ts:391](../../packages/domain/src/price-sheet.ts#L391) |
| `price-sheet.cefaf32d` | 写死 | 机场↔地点 | 标题 | [price-sheet.ts:391](../../packages/domain/src/price-sheet.ts#L391) |
| `price-sheet.1ade9491` | 写死 | 车站↔地点 | 标题 | [price-sheet.ts:392](../../packages/domain/src/price-sheet.ts#L392) |
| `price-sheet.9ec4742d` | 写死 | 接送机：接送点是车站，另一端是区域 | 说明 | [price-sheet.ts:392](../../packages/domain/src/price-sheet.ts#L392) |
| `price-sheet.55885752` | 写死 | 车站↔机场 | 标题 | [price-sheet.ts:393](../../packages/domain/src/price-sheet.ts#L393) |
| `price-sheet.77a1ba2a` | 写死 | 接送机一条价只有一个接送点，另一端要当区域，需要决定以哪一端为接送点、另一端怎么画区域 | 说明 | [price-sheet.ts:393](../../packages/domain/src/price-sheet.ts#L393) |
| `price-sheet.4d92fe5d` | 写死 | 车站↔车站 | 标题 | [price-sheet.ts:394](../../packages/domain/src/price-sheet.ts#L394) |
| `price-sheet.833a74f3` | 写死 | 同上，两端都是接送点类型 | 说明 | [price-sheet.ts:394](../../packages/domain/src/price-sheet.ts#L394) |
| `price-sheet.583ad606` | 写死 | 码头↔地点 | 标题 | [price-sheet.ts:395](../../packages/domain/src/price-sheet.ts#L395) |
| `price-sheet.e3d1446f` | 写死 | 地点类型没有码头，接送点只能是机场或车站（ADR 0012、0016） | 说明 | [price-sheet.ts:395](../../packages/domain/src/price-sheet.ts#L395) |
| `price-sheet.09c88ea6` | 写死 | 码头↔机场 | 标题 | [price-sheet.ts:396](../../packages/domain/src/price-sheet.ts#L396) |
| `price-sheet.2515eb7f` | 写死 | 同上 | 说明 | [price-sheet.ts:396](../../packages/domain/src/price-sheet.ts#L396)、397、398 行 |
| `price-sheet.28ef741b` | 写死 | 码头↔车站 | 标题 | [price-sheet.ts:397](../../packages/domain/src/price-sheet.ts#L397) |
| `price-sheet.2c59ad29` | 写死 | 码头↔码头 | 标题 | [price-sheet.ts:398](../../packages/domain/src/price-sheet.ts#L398) |
| `price-sheet.cb0d0e6f` | 写死 | 接送机只有一个接送点；点对点的价按区域，不按起终点 | 说明 | [price-sheet.ts:399](../../packages/domain/src/price-sheet.ts#L399) |
| `price-sheet.d2bc93a1` | 写死 | 地点↔同一地点 | 标题 | [price-sheet.ts:401](../../packages/domain/src/price-sheet.ts#L401) |
| `price-sheet.9754b586` | 写死 | 可以映射成同一区域内的点对点价；但起终点跨区域时，引擎把两端区域的价都算、取最低（ADR 0020），导入后跨区行程会按区内价报出 | 说明 | [price-sheet.ts:404](../../packages/domain/src/price-sheet.ts#L404) |
| `price-sheet.3c7df77a` | 写死 | 点对点的价是「区域 × 车型组」，没有起点 + 终点的价（ADR 0018、0020） | 说明 | [price-sheet.ts:406](../../packages/domain/src/price-sheet.ts#L406) |
| `price-sheet.f77fc875` | 写死 | 地点↔另一地点 | 标题 | [price-sheet.ts:406](../../packages/domain/src/price-sheet.ts#L406) |
| `price-sheet.fa54f9e6` | 写死 | 起终点相同（没有反向） | 文字 | [price-sheet.ts:441](../../packages/domain/src/price-sheet.ts#L441) |
| `price-sheet.f57b9dd2` | 写死 | 只列了一个方向 | 文字 | [price-sheet.ts:442](../../packages/domain/src/price-sheet.ts#L442) |
| `price-sheet.e94a1f8b` | 写死 | 两个方向都列、价格相同 | 文字 | [price-sheet.ts:443](../../packages/domain/src/price-sheet.ts#L443) |
| `price-sheet.f334a593` | 写死 | 两个方向都列、共同的车型价格相同，但有车型只有一个方向有价 | 文字 | [price-sheet.ts:444](../../packages/domain/src/price-sheet.ts#L444) |
| `price-sheet.216117c8` | 写死 | 两个方向都列、有车型价格不同 | 文字 | [price-sheet.ts:445](../../packages/domain/src/price-sheet.ts#L445) |
| `price-sheet.9375738f` | 写死 | 同一方向重复列了几行、价格不一致（不选其中一行） | 文字 | [price-sheet.ts:446](../../packages/domain/src/price-sheet.ts#L446) |
| `price-sheet.9b7fbf85` | 写死 | 主数据文件的写法不对：{what} | 错误提示 | [price-sheet.ts:574](../../packages/domain/src/price-sheet.ts#L574) |
| `price-sheet.16d2fa17` | 写死 | 最外层要有 cities 数组 | 文字 | [price-sheet.ts:575](../../packages/domain/src/price-sheet.ts#L575) |
| `price-sheet.f7f5c172` | 写死 | cities 第 {…} 条缺少 code、country\_code、name 或 status | 文字 | [price-sheet.ts:577](../../packages/domain/src/price-sheet.ts#L577) |
| `price-sheet.d2a15758` | 写死 | cities 第 {…} 条的 name 不是文字 | 文字 | [price-sheet.ts:579](../../packages/domain/src/price-sheet.ts#L579) |
| `price-sheet.bcd1a56f` | 写死 | vehicle\_groups 要是数组 | 文字 | [price-sheet.ts:584](../../packages/domain/src/price-sheet.ts#L584) |
| `price-sheet.aa860ca0` | 写死 | vehicle\_groups 第 {…} 条缺少 code | 文字 | [price-sheet.ts:586](../../packages/domain/src/price-sheet.ts#L586) |
| `price-sheet.3558323f` | 写死 | 名称里没有座位数 | 文字 | [price-sheet.ts:671](../../packages/domain/src/price-sheet.ts#L671) |
| `price-sheet.562f33e3` | 写死 | 名称里有不认识的词 | 文字 | [price-sheet.ts:677](../../packages/domain/src/price-sheet.ts#L677) |
| `price-sheet.58ff029a` | 写死 | 未知 | 文字 | [price-sheet.ts:721](../../packages/domain/src/price-sheet.ts#L721) |
| `price-sheet.8ed11203` | 写死 | {passengers}人/{luggage}件 | 文字 | [price-sheet.ts:721](../../packages/domain/src/price-sheet.ts#L721) |
| `price-sheet.6ab5c98a` | 写死 | 路线：{title} | 标题 | [price-sheet.ts:1106](../../packages/domain/src/price-sheet.ts#L1106) |
| `price-sheet.44ee4b60` | 写死 | 说明页没有写反向同价的规则 | 说明 | [price-sheet.ts:1111](../../packages/domain/src/price-sheet.ts#L1111) |
| `price-sheet.9cb67a2d` | 写死 | 说明页写明未列出的反向同价 | 说明 | [price-sheet.ts:1111](../../packages/domain/src/price-sheet.ts#L1111) |
| `price-sheet.f583253c` | 写死 | 反向价：可映射成 direction=both 的价格条数 | 标题 | [price-sheet.ts:1111](../../packages/domain/src/price-sheet.ts#L1111) |
| `price-sheet.be66a111` | 写死 | 两个方向都列且价不同的接送机 | 说明 | [price-sheet.ts:1112](../../packages/domain/src/price-sheet.ts#L1112) |
| `price-sheet.f79fc084` | 写死 | 反向价：可映射成 pickup + dropoff 的价格条数 | 标题 | [price-sheet.ts:1112](../../packages/domain/src/price-sheet.ts#L1112) |
| `price-sheet.975fc65f` | 写死 | 反向价：两个方向都列、但这个车型只有一个方向有价 | 标题 | [price-sheet.ts:1113](../../packages/domain/src/price-sheet.ts#L1113) |
| `price-sheet.be1aebfe` | 写死 | 反向同价的规则说的是「未列出的路线」，这种情况是另一方向不卖还是同价要确认 | 说明 | [price-sheet.ts:1113](../../packages/domain/src/price-sheet.ts#L1113) |
| `price-sheet.4b19d4be` | 写死 | 点对点的价没有方向，也没有起终点 | 说明 | [price-sheet.ts:1114](../../packages/domain/src/price-sheet.ts#L1114) |
| `price-sheet.c92d1266` | 写死 | 反向价：点对点无法表达的端点对 | 标题 | [price-sheet.ts:1114](../../packages/domain/src/price-sheet.ts#L1114) |
| `price-sheet.1a2ac932` | 写死 | 价格挂在区域上，区域必须有营运区图形（ADR 0015）；表里只有名字。要决定图形从哪里来 | 说明 | [price-sheet.ts:1115](../../packages/domain/src/price-sheet.ts#L1115) |
| `price-sheet.86ff36bf` | 写死 | 区域图形：表里的地点没有图形 | 标题 | [price-sheet.ts:1115](../../packages/domain/src/price-sheet.ts#L1115) |
| `price-sheet.5abd3bf4` | 写死 | 商品的接送点、区域都要在商品的城市里（ADR 0016），机场到邻近城市的路线要决定怎么归属。不知道每个端点属于哪个城市前算不出确切数量，这里是上限 | 说明 | [price-sheet.ts:1116](../../packages/domain/src/price-sheet.ts#L1116) |
| `price-sheet.64c5ef6a` | 写死 | 跨城路线：接送点和区域必须属于同一城市 | 标题 | [price-sheet.ts:1116](../../packages/domain/src/price-sheet.ts#L1116) |
| `price-sheet.4ca46832` | 写死 | 匹配 {matched}，未匹配 {unmatched}，歧义 {ambiguous} | 说明 | [price-sheet.ts:1117](../../packages/domain/src/price-sheet.ts#L1117) |
| `price-sheet.e46c5b6f` | 写死 | 没有提供 --master，只输出待匹配清单 | 说明 | [price-sheet.ts:1117](../../packages/domain/src/price-sheet.ts#L1117) |
| `price-sheet.e8ff0df6` | 写死 | 城市：端点和主数据的匹配 | 标题 | [price-sheet.ts:1117](../../packages/domain/src/price-sheet.ts#L1117) |
| `price-sheet.101de8e5` | 写死 | 城市：未匹配和有歧义的端点 | 标题 | [price-sheet.ts:1118](../../packages/domain/src/price-sheet.ts#L1118) |
| `price-sheet.78e08b92` | 写死 | 不猜测，由人决定 | 说明 | [price-sheet.ts:1118](../../packages/domain/src/price-sheet.ts#L1118) |
| `price-sheet.cb318c1c` | 写死 | 车型：同一 sheet 里同名的列（歧义） | 标题 | [price-sheet.ts:1119](../../packages/domain/src/price-sheet.ts#L1119) |
| `price-sheet.f4ceaae0` | 写死 | 不合并、不覆盖；要决定哪一列是哪个车型 | 说明 | [price-sheet.ts:1119](../../packages/domain/src/price-sheet.ts#L1119) |
| `price-sheet.0fb2a911` | 写死 | 车型：现有车型组里没有、要新建的名称 | 标题 | [price-sheet.ts:1120](../../packages/domain/src/price-sheet.ts#L1120) |
| `price-sheet.fa065b11` | 写死 | 建议编码只是建议；车型组由平台创建 | 说明 | [price-sheet.ts:1120](../../packages/domain/src/price-sheet.ts#L1120) |
| `price-sheet.53528ddb` | 写死 | 现有等级只有经济、舒适、商务、豪华（ADR 0012） | 说明 | [price-sheet.ts:1121](../../packages/domain/src/price-sheet.ts#L1121) |
| `price-sheet.6a6109e8` | 写死 | 车型：等级对不上现有四级的名称（Premium、Bus、Van、SUV……） | 标题 | [price-sheet.ts:1121](../../packages/domain/src/price-sheet.ts#L1121) |
| `price-sheet.171cd589` | 写死 | 名称里没有座位数等，不猜 | 说明 | [price-sheet.ts:1122](../../packages/domain/src/price-sheet.ts#L1122) |
| `price-sheet.d4e5e45f` | 写死 | 车型：给不出建议编码的名称 | 标题 | [price-sheet.ts:1122](../../packages/domain/src/price-sheet.ts#L1122) |
| `price-sheet.714f7b9e` | 写死 | 车型：同名不同国家容量不同 | 标题 | [price-sheet.ts:1123](../../packages/domain/src/price-sheet.ts#L1123) |
| `price-sheet.e5bddb34` | 写死 | 车型组可以有多个「人数 / 行李」组合，商品选用其中的（ADR 0016），框架能放下；但要确认是不是同一个车型组 | 说明 | [price-sheet.ts:1123](../../packages/domain/src/price-sheet.ts#L1123) |
| `price-sheet.5752b29c` | 写死 | 车型：同级别座位多反而便宜的路线数 | 标题 | [price-sheet.ts:1124](../../packages/domain/src/price-sheet.ts#L1124) |
| `price-sheet.cb8af25a` | 写死 | 只列出，不判断对错 | 说明 | [price-sheet.ts:1124](../../packages/domain/src/price-sheet.ts#L1124) |
| `price-sheet.3493e5e9` | 写死 | 里程价：可映射成 mileage\_time 的行 | 标题 | [price-sheet.ts:1125](../../packages/domain/src/price-sheet.ts#L1125) |
| `price-sheet.79e7c8c1` | 写死 | 起步里程取说明页的公里数，起步时长和每分钟单价填 0；依赖路线预估（ADR 0018、0020） | 说明 | [price-sheet.ts:1125](../../packages/domain/src/price-sheet.ts#L1125) |
| `price-sheet.eebf07a6` | 写死 | 说明页没有写起步价含多少公里 | 说明 | [price-sheet.ts:1125](../../packages/domain/src/price-sheet.ts#L1125) |
| `price-sheet.69a4956e` | 写死 | 同一组合同一天只能有一条价（ADR 0018），几个区域都能报时取最低（ADR 0020），表里的「兜底」含义框架不能直接表达，要决定怎么挂区域 | 说明 | [price-sheet.ts:1126](../../packages/domain/src/price-sheet.ts#L1126) |
| `price-sheet.e7f734a3` | 写死 | 里程价：作为「没有固定线路时」的兜底 | 标题 | [price-sheet.ts:1126](../../packages/domain/src/price-sheet.ts#L1126) |
| `price-sheet.5d4c5fc9` | 写死 | 里程价：最低消费高于起步价的行 | 标题 | [price-sheet.ts:1127](../../packages/domain/src/price-sheet.ts#L1127) |
| `price-sheet.81bc6197` | 写死 | 公式能算（取较大值），只列出 | 说明 | [price-sheet.ts:1127](../../packages/domain/src/price-sheet.ts#L1127) |
| `price-sheet.0a7830b1` | 写死 | 里程价：同一国家同一车型重复的行 | 标题 | [price-sheet.ts:1128](../../packages/domain/src/price-sheet.ts#L1128) |
| `price-sheet.926c0841` | 写死 | 完全相同 {identical}，不一致 {conflicting} | 说明 | [price-sheet.ts:1128](../../packages/domain/src/price-sheet.ts#L1128) |
| `price-sheet.13e8adad` | 写死 | 涉及 {…} 条路线次；不改分类，由人确认 | 说明 | [price-sheet.ts:1129](../../packages/domain/src/price-sheet.ts#L1129) |
| `price-sheet.c818946c` | 写死 | 端点：算成地点、但名字看着可能不是的 | 标题 | [price-sheet.ts:1129](../../packages/domain/src/price-sheet.ts#L1129) |
| `price-sheet.6ea08d06` | 写死 | 同一端点名出现在几个 sheet 里 | 标题 | [price-sheet.ts:1130](../../packages/domain/src/price-sheet.ts#L1130) |
| `price-sheet.86dad7da` | 写死 | 比如中国大陆的表里有香港的地点；跨境路线一个商品只有一个城市，这些名字属于哪个国家 / 地区、跨境怎么挂要确认 | 说明 | [price-sheet.ts:1130](../../packages/domain/src/price-sheet.ts#L1130) |
| `price-sheet.2120c430` | 写死 | 同一端点对出现在几个 sheet 里 | 标题 | [price-sheet.ts:1131](../../packages/domain/src/price-sheet.ts#L1131) |
| `price-sheet.312e5bc4` | 写死 | 其中价格不同的 {differingPrices} 对（只比较名称唯一的车型列）；这些路线归哪个国家、用哪一份价要确认 | 说明 | [price-sheet.ts:1131](../../packages/domain/src/price-sheet.ts#L1131) |
| `price-sheet.ac9334d5` | 写死 | 价格规则存的是供应商结算价，对外价由加价算出（ADR 0020、0023）；表名是「官网」费率。不确认不能写入 | 说明 | [price-sheet.ts:1132](../../packages/domain/src/price-sheet.ts#L1132) |
| `price-sheet.da874604` | 写死 | 价格含义：表里的价是结算价还是对外价 | 标题 | [price-sheet.ts:1132](../../packages/domain/src/price-sheet.ts#L1132) |
| `price-sheet.818af9ed` | 写死 | 币种：全表是日元，路线分布在 10 个国家 / 地区 | 标题 | [price-sheet.ts:1133](../../packages/domain/src/price-sheet.ts#L1133) |
| `price-sheet.a9017dd0` | 写死 | 金额按子品牌的结算币种存（ADR 0016），要决定挂在哪个租户、哪个子品牌 | 说明 | [price-sheet.ts:1133](../../packages/domain/src/price-sheet.ts#L1133) |
| `price-sheet.b8836df5` | 写死 | 生效日期：表里没有 | 标题 | [price-sheet.ts:1134](../../packages/domain/src/price-sheet.ts#L1134) |
| `price-sheet.f842f128` | 写死 | 价格规则的开始日期必填（ADR 0018） | 说明 | [price-sheet.ts:1134](../../packages/domain/src/price-sheet.ts#L1134) |
| `price-sheet.3ce0e735` | 写死 | 点对点 | 文字 | [price-sheet.ts:1167](../../packages/domain/src/price-sheet.ts#L1167) |
| `price-sheet.72f0fe72` | 写死 | 车站 / 码头（待定） | 文字 | [price-sheet.ts:1167](../../packages/domain/src/price-sheet.ts#L1167) |
| `price-sheet.7a94d1e1` | 写死 | 接送机 | 文字 | [price-sheet.ts:1167](../../packages/domain/src/price-sheet.ts#L1167) |
| `price-sheet.444178be` | 写死 | \# 价格表映射报告（第 0 阶段，只读 dry-run） | 文字 | [price-sheet.ts:1173](../../packages/domain/src/price-sheet.ts#L1173) |
| `price-sheet.7f027cfb` | 写死 | 本报告没有写任何业务数据。内容含价格举例，属业主的商业数据，不要提交进仓库。 | 文字 | [price-sheet.ts:1175](../../packages/domain/src/price-sheet.ts#L1175) |
| `price-sheet.6153ea7f` | 写死 | - 文件：{…}（{bytes} 字节） | 文字 | [price-sheet.ts:1177](../../packages/domain/src/price-sheet.ts#L1177) |
| `price-sheet.39a47ab7` | 写死 | - 主数据：{…} | 文字 | [price-sheet.ts:1179](../../packages/domain/src/price-sheet.ts#L1179) |
| `price-sheet.6f4a3229` | 写死 | 已提供 --master | 文字 | [price-sheet.ts:1179](../../packages/domain/src/price-sheet.ts#L1179) |
| `price-sheet.b780aacc` | 写死 | 没有提供，城市只有待匹配清单 | 文字 | [price-sheet.ts:1179](../../packages/domain/src/price-sheet.ts#L1179) |
| `price-sheet.13a19dc5` | 写死 | \#\# 合计 | 文字 | [price-sheet.ts:1181](../../packages/domain/src/price-sheet.ts#L1181) |
| `price-sheet.0f1240c1` | 写死 | 分类 | 文字 | [price-sheet.ts:1184](../../packages/domain/src/price-sheet.ts#L1184) |
| `price-sheet.21912ef8` | 写死 | 空的格 | 文字 | [price-sheet.ts:1184](../../packages/domain/src/price-sheet.ts#L1184) |
| `price-sheet.2410240d` | 写死 | 路线 | 文字 | [price-sheet.ts:1184](../../packages/domain/src/price-sheet.ts#L1184)、1199、1214、1239、1250 行 |
| `price-sheet.64c48b6d` | 写死 | 不合规的格 | 文字 | [price-sheet.ts:1184](../../packages/domain/src/price-sheet.ts#L1184) |
| `price-sheet.6d9956a7` | 写死 | 有价的格 | 文字 | [price-sheet.ts:1184](../../packages/domain/src/price-sheet.ts#L1184) |
| `price-sheet.11075f68` | 写死 | 合计 | 文字 | [price-sheet.ts:1185](../../packages/domain/src/price-sheet.ts#L1185) |
| `price-sheet.37be3ca9` | 写死 | 机场、车站、码头都按名称里明确的字判断，判断不了的算地点。大类先看机场：一端是机场、另一端不是的都归「机场↔非机场」，其中机场↔车站、机场↔码头的结论不同，看下面的「路线种类」。 | 文字 | [price-sheet.ts:1188](../../packages/domain/src/price-sheet.ts#L1188) |
| `price-sheet.1dce84ae` | 写死 | \#\# 逐项结论 | 文字 | [price-sheet.ts:1190](../../packages/domain/src/price-sheet.ts#L1190) |
| `price-sheet.29496300` | 写死 | 结论 | 文字 | [price-sheet.ts:1192](../../packages/domain/src/price-sheet.ts#L1192)、1199、1200、1220 行 |
| `price-sheet.8bbd6ce5` | 写死 | 项目 | 文字 | [price-sheet.ts:1192](../../packages/domain/src/price-sheet.ts#L1192) |
| `price-sheet.b0e239fc` | 写死 | 数量 | 文字 | [price-sheet.ts:1192](../../packages/domain/src/price-sheet.ts#L1192) |
| `price-sheet.d3cd2669` | 写死 | \#\# 分国家 | 文字 | [price-sheet.ts:1194](../../packages/domain/src/price-sheet.ts#L1194) |
| `price-sheet.df98a03f` | 写死 | 路线 {routes}，车型列 {vehicleColumns}，有价 {pricedCells}，空 {emptyCells}，不合规 {invalidCells}；端点 {total}（机场 {airport}、车站 {station}、码头 {pier}、地点 {place}） | 文字 | [price-sheet.ts:1198](../../packages/domain/src/price-sheet.ts#L1198) |
| `price-sheet.3a994e60` | 写死 | 空 | 文字 | [price-sheet.ts:1199](../../packages/domain/src/price-sheet.ts#L1199) |
| `price-sheet.52ea7d13` | 写死 | 有价 | 文字 | [price-sheet.ts:1199](../../packages/domain/src/price-sheet.ts#L1199) |
| `price-sheet.de774209` | 写死 | 路线种类 | 文字 | [price-sheet.ts:1199](../../packages/domain/src/price-sheet.ts#L1199) |
| `price-sheet.244d2458` | 写死 | 端点对 | 文字 | [price-sheet.ts:1200](../../packages/domain/src/price-sheet.ts#L1200) |
| `price-sheet.2ec7fe59` | 写死 | 归属 | 文字 | [price-sheet.ts:1200](../../packages/domain/src/price-sheet.ts#L1200) |
| `price-sheet.820d816e` | 写死 | 反向价 | 文字 | [price-sheet.ts:1200](../../packages/domain/src/price-sheet.ts#L1200) |
| `price-sheet.0ea84fd5` | 写死 | 接送机可映射：通用 {transferBothRules} 条，接机 {transferPickupRules} 条，送机 {transferDropoffRules} 条；只有一个方向有价的 {transferOneSidedCells} 格；点对点无法表达 {pointToPointUnexpressible} 对。 | 文字 | [price-sheet.ts:1201](../../packages/domain/src/price-sheet.ts#L1201) |
| `price-sheet.2bcaf678` | 写死 | \#\# 城市 | 文字 | [price-sheet.ts:1204](../../packages/domain/src/price-sheet.ts#L1204) |
| `price-sheet.4b5e97d0` | 写死 | 匹配 {matched}，歧义 {ambiguous}，未匹配 {unmatched}；机场、车站、码头 {notCompared} 个不和城市比较。 | 文字 | [price-sheet.ts:1205](../../packages/domain/src/price-sheet.ts#L1205) |
| `price-sheet.3cc6f0c8` | 写死 | 没有提供 --master：下面是归一化后的待匹配清单。机场、车站、码头 {notCompared} 个不和城市比较。 | 文字 | [price-sheet.ts:1206](../../packages/domain/src/price-sheet.ts#L1206) |
| `price-sheet.552da879` | 写死 | 归一化只统一全半角、空白和大小写，不做繁简转换，不拆分，不去后缀；名字完全相同才算匹配。 | 文字 | [price-sheet.ts:1207](../../packages/domain/src/price-sheet.ts#L1207) |
| `price-sheet.a536c474` | 写死 | 待匹配 | 文字 | [price-sheet.ts:1209](../../packages/domain/src/price-sheet.ts#L1209) |
| `price-sheet.e3f6655f` | 写死 | 匹配 {…}（{…}） | 文字 | [price-sheet.ts:1210](../../packages/domain/src/price-sheet.ts#L1210) |
| `price-sheet.4a3e4e07` | 写死 | 未匹配 | 文字 | [price-sheet.ts:1211](../../packages/domain/src/price-sheet.ts#L1211) |
| `price-sheet.d1f85d59` | 写死 | 歧义：{…} | 文字 | [price-sheet.ts:1211](../../packages/domain/src/price-sheet.ts#L1211) |
| `price-sheet.1ab7abb8` | 写死 | 可能是几个地方 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214) |
| `price-sheet.29576bed` | 写死 | 归一化 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214) |
| `price-sheet.333168bf` | 写死 | 结果 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214) |
| `price-sheet.381544cc` | 写死 | 国家 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214)、1231、1245、1246、1247 行 |
| `price-sheet.6280561f` | 写死 | 是 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214)、1221、1227、1231、1246、1250 行 |
| `price-sheet.a8599e1a` | 写死 | 存疑 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214) |
| `price-sheet.cb3084b7` | 写死 | 原名 | 文字 | [price-sheet.ts:1214](../../packages/domain/src/price-sheet.ts#L1214) |
| `price-sheet.637d2ec9` | 写死 | 没有提供 --master，未核对 | 文字 | [price-sheet.ts:1217](../../packages/domain/src/price-sheet.ts#L1217) |
| `price-sheet.86386ac4` | 写死 | 无 | 文字 | [price-sheet.ts:1217](../../packages/domain/src/price-sheet.ts#L1217) |
| `price-sheet.974bda7c` | 写死 | 来自 --master | 文字 | [price-sheet.ts:1217](../../packages/domain/src/price-sheet.ts#L1217) |
| `price-sheet.bc67e10f` | 写死 | 共 {length} 个名称。现有车型组：{…}（{…}）。 | 文字 | [price-sheet.ts:1217](../../packages/domain/src/price-sheet.ts#L1217) |
| `price-sheet.fcf1ae2d` | 写死 | \#\# 车型 | 文字 | [price-sheet.ts:1217](../../packages/domain/src/price-sheet.ts#L1217) |
| `price-sheet.1f40d1b7` | 写死 | 已有 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220) |
| `price-sheet.3a2e846f` | 写死 | 容量 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220) |
| `price-sheet.4ce925c9` | 写死 | 建议编码 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220) |
| `price-sheet.93102df3` | 写死 | 名称 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220)、1227、1231、1253 行 |
| `price-sheet.cbcce091` | 写死 | 现有等级 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220) |
| `price-sheet.dea34b0a` | 写死 | 国家数 | 文字 | [price-sheet.ts:1220](../../packages/domain/src/price-sheet.ts#L1220) |
| `price-sheet.445c5d17` | 写死 | 无（{…}） | 文字 | [price-sheet.ts:1221](../../packages/domain/src/price-sheet.ts#L1221) |
| `price-sheet.f13dc11c` | 写死 | 对不上 | 文字 | [price-sheet.ts:1221](../../packages/domain/src/price-sheet.ts#L1221) |
| `price-sheet.55cf8b9b` | 写死 | \#\#\# 同名的车型列（歧义，不合并、不覆盖） | 文字 | [price-sheet.ts:1226](../../packages/domain/src/price-sheet.ts#L1226) |
| `price-sheet.2cce0ac7` | 写死 | 否 | 文字 | [price-sheet.ts:1227](../../packages/domain/src/price-sheet.ts#L1227)、1231、1246、1250 行 |
| `price-sheet.388a119d` | 写死 | 列 | 文字 | [price-sheet.ts:1227](../../packages/domain/src/price-sheet.ts#L1227) |
| `price-sheet.3a6e02e5` | 写死 | 容量相同 | 文字 | [price-sheet.ts:1227](../../packages/domain/src/price-sheet.ts#L1227)、1231 行 |
| `price-sheet.d4f937b1` | 写死 | 两列都有价的行 | 文字 | [price-sheet.ts:1227](../../packages/domain/src/price-sheet.ts#L1227) |
| `price-sheet.fa1ba06d` | 写死 | 其中价格不同 | 文字 | [price-sheet.ts:1227](../../packages/domain/src/price-sheet.ts#L1227) |
| `price-sheet.e11dc0a1` | 写死 | \#\#\# 车型表里同一国家重复的车型 | 文字 | [price-sheet.ts:1230](../../packages/domain/src/price-sheet.ts#L1230) |
| `price-sheet.99b53918` | 写死 | 行 | 文字 | [price-sheet.ts:1231](../../packages/domain/src/price-sheet.ts#L1231)、1246 行 |
| `price-sheet.a184753b` | 写死 | 代表车型 | 文字 | [price-sheet.ts:1231](../../packages/domain/src/price-sheet.ts#L1231) |
| `price-sheet.ce15ab0e` | 写死 | 只差大小写的名称：{…} | 文字 | [price-sheet.ts:1233](../../packages/domain/src/price-sheet.ts#L1233) |
| `price-sheet.f4c30ee1` | 写死 | 给出同一编码的名称：{…} | 文字 | [price-sheet.ts:1234](../../packages/domain/src/price-sheet.ts#L1234) |
| `price-sheet.48351eaf` | 写死 | 路线表容量和车型表不一致 {length} 列；路线表有、车型表没有 {length} 列；车型表有、路线表没有 {length} 个。 | 文字 | [price-sheet.ts:1235](../../packages/domain/src/price-sheet.ts#L1235) |
| `price-sheet.3f1a2740` | 写死 | \#\#\# 同级别座位多反而便宜（只列数量和前几例，不判断对错） | 文字 | [price-sheet.ts:1236](../../packages/domain/src/price-sheet.ts#L1236) |
| `price-sheet.2992e1d7` | 写死 | 路线数 | 文字 | [price-sheet.ts:1237](../../packages/domain/src/price-sheet.ts#L1237) |
| `price-sheet.63f337a0` | 写死 | 比较数 | 文字 | [price-sheet.ts:1237](../../packages/domain/src/price-sheet.ts#L1237) |
| `price-sheet.2402f3e0` | 写死 | 座位少 | 文字 | [price-sheet.ts:1239](../../packages/domain/src/price-sheet.ts#L1239)、1247 行 |
| `price-sheet.e86b1dac` | 写死 | 座位多 | 文字 | [price-sheet.ts:1239](../../packages/domain/src/price-sheet.ts#L1239)、1247 行 |
| `price-sheet.8a165923` | 写死 | \#\# 里程价 | 文字 | [price-sheet.ts:1242](../../packages/domain/src/price-sheet.ts#L1242) |
| `price-sheet.ef58f883` | 写死 | 共 {rows} 行，缺起步价或每公里的 {incompleteRows} 行；说明页写的起步公里数：{…}。 | 文字 | [price-sheet.ts:1242](../../packages/domain/src/price-sheet.ts#L1242) |
| `price-sheet.fc83e4d8` | 写死 | 没有写 | 文字 | [price-sheet.ts:1242](../../packages/domain/src/price-sheet.ts#L1242) |
| `price-sheet.11ede9bd` | 写死 | （空） | 文字 | [price-sheet.ts:1243](../../packages/domain/src/price-sheet.ts#L1243) |
| `price-sheet.c2e9871e` | 写死 | 来源：{…}。国家：{…}。 | 文字 | [price-sheet.ts:1243](../../packages/domain/src/price-sheet.ts#L1243) |
| `price-sheet.91c7412f` | 写死 | 最低消费高于起步价 {count} 行；重复行：完全相同 {identical} 组，不一致 {conflicting} 组；同级别座位多起步价反而低 {count} 对；车型表里没有的车型 {length} 个。 | 文字 | [price-sheet.ts:1244](../../packages/domain/src/price-sheet.ts#L1244) |
| `price-sheet.15496936` | 写死 | 起步价 | 文字 | [price-sheet.ts:1245](../../packages/domain/src/price-sheet.ts#L1245)、1247 行 |
| `price-sheet.3707eeb8` | 写死 | 最低消费 | 文字 | [price-sheet.ts:1245](../../packages/domain/src/price-sheet.ts#L1245) |
| `price-sheet.1b2fd07a` | 写死 | 不一致 | 文字 | [price-sheet.ts:1246](../../packages/domain/src/price-sheet.ts#L1246) |
| `price-sheet.312ca8ee` | 写死 | {count} 对，其中价格不同 {differingPrices} 对（前几例）。 | 文字 | [price-sheet.ts:1249](../../packages/domain/src/price-sheet.ts#L1249) |
| `price-sheet.689d07df` | 写死 | \#\# 跨 sheet 重复的路线 | 文字 | [price-sheet.ts:1249](../../packages/domain/src/price-sheet.ts#L1249) |
| `price-sheet.323ced10` | 写死 | 价格不同 | 文字 | [price-sheet.ts:1250](../../packages/domain/src/price-sheet.ts#L1250) |
| `price-sheet.d363d6c6` | 写死 | {length} 个。 | 文字 | [price-sheet.ts:1252](../../packages/domain/src/price-sheet.ts#L1252) |
| `price-sheet.d90a8e6d` | 写死 | \#\# 跨 sheet 重复的端点名 | 文字 | [price-sheet.ts:1252](../../packages/domain/src/price-sheet.ts#L1252) |
| `price-sheet.c6208a65` | 写死 | 路线次 | 文字 | [price-sheet.ts:1253](../../packages/domain/src/price-sheet.ts#L1253) |
| `price-sheet.2a140247` | 写死 | \#\# 解析问题 | 文字 | [price-sheet.ts:1255](../../packages/domain/src/price-sheet.ts#L1255) |
| `price-sheet.338c4c77` | 写死 | 没有。 | 文字 | [price-sheet.ts:1256](../../packages/domain/src/price-sheet.ts#L1256) |
| `price-sheet.6387f81d` | 写死 | 问题 | 文字 | [price-sheet.ts:1257](../../packages/domain/src/price-sheet.ts#L1257) |
| `price-sheet.bb6ed7bb` | 写死 | 位置 | 文字 | [price-sheet.ts:1257](../../packages/domain/src/price-sheet.ts#L1257) |

## 价格规则与调价规则（pricing.ts）

文件：`packages/domain/src/pricing.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `pricing.0c541b02` | 写死 | 上下车加价 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.1058e4ca` | 写死 | 包车套餐 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.16430928` | 写死 | 里程 + 时长 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.86669776` | 写死 | 机场套餐价 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.ef1f0b8a` | 写死 | 行程加价 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.fe467b90` | 写死 | 固定一口价 | 文字 | [pricing.ts:19](../../packages/domain/src/pricing.ts#L19) |
| `pricing.1d760fb8` | 写死 | 接送通用 | 文字 | [pricing.ts:65](../../packages/domain/src/pricing.ts#L65)、69 行 |
| `pricing.80b6612d` | 写死 | 接机 | 文字 | [pricing.ts:65](../../packages/domain/src/pricing.ts#L65) |
| `pricing.ece25d12` | 写死 | 送机 | 文字 | [pricing.ts:65](../../packages/domain/src/pricing.ts#L65) |
| `pricing.0e993cfa` | 写死 | 送站 | 文字 | [pricing.ts:69](../../packages/domain/src/pricing.ts#L69) |
| `pricing.9762a470` | 写死 | 接站 | 文字 | [pricing.ts:69](../../packages/domain/src/pricing.ts#L69) |

## 乘客信息打码（privacy.ts）

文件：`packages/domain/src/privacy.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `privacy.ab6e5b9d` | 写死 | \[已脱敏\] | 文字 | [privacy.ts:47](../../packages/domain/src/privacy.ts#L47) |
| `privacy.1df6abd2` | 写死 | \[已加密\] | 文字 | [privacy.ts:55](../../packages/domain/src/privacy.ts#L55) |
| `privacy.6f5bae20` | 写死 | 无法读取 | 文字 | [privacy.ts:59](../../packages/domain/src/privacy.ts#L59) |
| `privacy.7d527523` | 写死 | (?&lt;!\[0-9０-９\]\|\[0-9０-９\]\[-‐‑–—−－./／\])20\[0-9\]{2}(?:\[-/.\](?:0?\[1-9\]\|1\[0-2\])\[-/.\](?:0?\[1-9\]\|\[12\]\[0-9\]\|3\[01\])\|年(?:0?\[1-9\]\|1\[0-2\])月(?:0?\[1-9\]\|\[12\]\[0-9\]\|3\[01\])日)(?!\[0-9０-９\]) | 文字 | [privacy.ts:173](../../packages/domain/src/privacy.ts#L173) |
| `privacy.61edc5d3` | 写死 | \[¥￥$\]\[0-9０-９\]+\|(?&lt;!\[0-9０-９+＋\]\|\[0-9０-９\]\[-‐‑–—−－./／\])\[0-9０-９\]+(?=\\s?(?:JPY\|CNY\|USD\|KRW\|HKD\|TWD\|SGD\|EUR\|円\|日元\|元\|韩元\|美元)(?!\[A-Za-z\])) | 文字 | [privacy.ts:174](../../packages/domain/src/privacy.ts#L174) |
| `privacy.6a88820e` | 写死 | (?=先生\|女士\|小姐\|太太\|老师\|さん\|さま\|様\|氏\|君\|ちゃん) | 文字 | [privacy.ts:187](../../packages/domain/src/privacy.ts#L187) |

## 商品（products.ts）

文件：`packages/domain/src/products.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `products.fe4708f8` | 写死 | 接送机 | 文字 | [products.ts:19](../../packages/domain/src/products.ts#L19) |
| `products.e9bb7e1c` | 写死 | 点对点 | 文字 | [products.ts:20](../../packages/domain/src/products.ts#L20) |
| `products.93c3053d` | 写死 | 包车 | 文字 | [products.ts:21](../../packages/domain/src/products.ts#L21) |
| `products.09503af5` | 写死 | 已下架 | 文字 | [products.ts:36](../../packages/domain/src/products.ts#L36) |
| `products.5edeebbd` | 写死 | 草稿 | 文字 | [products.ts:36](../../packages/domain/src/products.ts#L36) |
| `products.9ddc6a4e` | 写死 | 已上架 | 文字 | [products.ts:36](../../packages/domain/src/products.ts#L36) |
| `products.c68ef784` | 写死 | 验收可售 | 文字 | [products.ts:36](../../packages/domain/src/products.ts#L36) |
| `products.aca54b9f` | 写死 | 基础信息 | 文字 | [products.ts:508](../../packages/domain/src/products.ts#L508) |
| `products.450893a8` | 写死 | 服务规则 | 文字 | [products.ts:509](../../packages/domain/src/products.ts#L509) |
| `products.af34d2dc` | 写死 | 价格规则 | 文字 | [products.ts:510](../../packages/domain/src/products.ts#L510) |
| `products.de8ab323` | 写死 | 商品详情 | 文字 | [products.ts:511](../../packages/domain/src/products.ts#L511) |
| `products.eed4b491` | 写死 | 调价规则 | 文字 | [products.ts:512](../../packages/domain/src/products.ts#L512) |
| `products.0d7a7cb5` | 写死 | 库存 | 文字 | [products.ts:513](../../packages/domain/src/products.ts#L513) |
| `products.79f1ef58` | 写死 | 运营区域 | 文字 | [products.ts:514](../../packages/domain/src/products.ts#L514) |
| `products.2eac5102` | 写死 | 最低套餐 | 文字 | [products.ts:515](../../packages/domain/src/products.ts#L515) |
| `products.4560b987` | 写死 | 热门地标覆盖 | 文字 | [products.ts:516](../../packages/domain/src/products.ts#L516) |
| `products.9074f18e` | 写死 | 加价表空格 | 空状态 | [products.ts:517](../../packages/domain/src/products.ts#L517) |
| `products.1331ada3` | 写死 | 三层区域重叠 | 文字 | [products.ts:518](../../packages/domain/src/products.ts#L518) |

## 救援改派与违约金（rescue.ts）

文件：`packages/domain/src/rescue.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `rescue.6e80b3af` | 写死 | 供应商声明无法履约 | 文字 | [rescue.ts:56](../../packages/domain/src/rescue.ts#L56) |
| `rescue.a4aeebc4` | 写死 | 用车前 6 小时仍未派车 | 文字 | [rescue.ts:57](../../packages/domain/src/rescue.ts#L57) |
| `rescue.2509c0f7` | 写死 | 司机未到 | 文字 | [rescue.ts:58](../../packages/domain/src/rescue.ts#L58) |
| `rescue.598144c9` | 写死 | 供应商被暂停 | 文字 | [rescue.ts:59](../../packages/domain/src/rescue.ts#L59) |
| `rescue.cd3fe75d` | 写死 | 待处理 | 文字 | [rescue.ts:276](../../packages/domain/src/rescue.ts#L276) |
| `rescue.59735df1` | 写死 | 救援单待接 | 文字 | [rescue.ts:277](../../packages/domain/src/rescue.ts#L277) |
| `rescue.601a9ba1` | 写死 | 候选都不接，待人工处理 | 文字 | [rescue.ts:278](../../packages/domain/src/rescue.ts#L278) |
| `rescue.45b49d4e` | 写死 | 已改派 | 文字 | [rescue.ts:279](../../packages/domain/src/rescue.ts#L279) |
| `rescue.041991e3` | 写死 | 已取消订单 | 文字 | [rescue.ts:280](../../packages/domain/src/rescue.ts#L280) |
| `rescue.d544a2c9` | 写死 | 待接单 | 文字 | [rescue.ts:303](../../packages/domain/src/rescue.ts#L303) |
| `rescue.1998d844` | 写死 | 已接单 | 文字 | [rescue.ts:304](../../packages/domain/src/rescue.ts#L304) |
| `rescue.96337ef0` | 写死 | 已拒绝 | 文字 | [rescue.ts:305](../../packages/domain/src/rescue.ts#L305) |
| `rescue.ce76af2a` | 写死 | 超时未接 | 文字 | [rescue.ts:306](../../packages/domain/src/rescue.ts#L306) |
| `rescue.32a068a4` | 写死 | 已收回 | 文字 | [rescue.ts:307](../../packages/domain/src/rescue.ts#L307) |
| `rescue.946ff4f7` | 写死 | 违约金 | 文字 | [rescue.ts:320](../../packages/domain/src/rescue.ts#L320) |
| `rescue.489faee4` | 写死 | 救援差价 | 文字 | [rescue.ts:321](../../packages/domain/src/rescue.ts#L321) |
| `rescue.d02e4687` | 写死 | 客人赔付 | 文字 | [rescue.ts:322](../../packages/domain/src/rescue.ts#L322) |
| `rescue.895b3515` | 写死 | 替代交通报销 | 文字 | [rescue.ts:323](../../packages/domain/src/rescue.ts#L323) |
| `rescue.e0942be8` | 写死 | 待结算时扣除 | 文字 | [rescue.ts:331](../../packages/domain/src/rescue.ts#L331) |
| `rescue.87b3a89b` | 写死 | 不可抗力，已免除 | 文字 | [rescue.ts:332](../../packages/domain/src/rescue.ts#L332) |

## 路线预估（route-estimate.ts）

文件：`packages/domain/src/route-estimate.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `route-estimate.0c761f5b` | 写死 | 谷歌地图的密钥没有配置：请超级管理员在运营后台『系统设置 → 系统状态 → 第三方密钥』填写 | 文字 | [route-estimate.ts:72](../../packages/domain/src/route-estimate.ts#L72) |
| `route-estimate.1c551986` | 写死 | 今天调用谷歌地图的次数已到每日上限（费用控制），明天 0 点（东京时间）恢复；需要放宽请调整 GOOGLE\_ROUTES\_DAILY\_LIMIT | 文字 | [route-estimate.ts:73](../../packages/domain/src/route-estimate.ts#L73) |
| `route-estimate.41aebab5` | 写死 | 谷歌地图的密钥无效：请在运营后台核对或更换 | 提示 | [route-estimate.ts:74](../../packages/domain/src/route-estimate.ts#L74) |
| `route-estimate.040d2f9a` | 写死 | 谷歌云项目没有启用 Routes API | 文字 | [route-estimate.ts:75](../../packages/domain/src/route-estimate.ts#L75) |
| `route-estimate.ded4bee2` | 写死 | 谷歌地图的密钥设了限制，不允许这台服务器调用 Routes API | 文字 | [route-estimate.ts:76](../../packages/domain/src/route-estimate.ts#L76) |
| `route-estimate.637c9cf6` | 写死 | 谷歌云项目没有绑定付款方式 | 文字 | [route-estimate.ts:77](../../packages/domain/src/route-estimate.ts#L77) |
| `route-estimate.328f8014` | 写死 | 谷歌拒绝了这次调用（权限不够） | 文字 | [route-estimate.ts:78](../../packages/domain/src/route-estimate.ts#L78) |
| `route-estimate.5fef140d` | 写死 | 谷歌地图的用量超过了上限或被限流，稍后自动重试 | 文字 | [route-estimate.ts:79](../../packages/domain/src/route-estimate.ts#L79) |
| `route-estimate.f00ecdbd` | 写死 | 谷歌地图在时限内没有应答 | 文字 | [route-estimate.ts:80](../../packages/domain/src/route-estimate.ts#L80) |
| `route-estimate.1590deba` | 写死 | 连不上谷歌地图（网络不通） | 文字 | [route-estimate.ts:81](../../packages/domain/src/route-estimate.ts#L81) |
| `route-estimate.5c524b6d` | 写死 | 谷歌地图暂时出错 | 文字 | [route-estimate.ts:82](../../packages/domain/src/route-estimate.ts#L82) |
| `route-estimate.c2060bd0` | 写死 | 谷歌地图的应答看不懂 | 文字 | [route-estimate.ts:83](../../packages/domain/src/route-estimate.ts#L83) |
| `route-estimate.0abb9598` | 写死 | 谷歌地图认为起点或终点无效 | 提示 | [route-estimate.ts:84](../../packages/domain/src/route-estimate.ts#L84) |
| `route-estimate.83f8b60e` | 写死 | 这两个地点之间没有可行驶的路线 | 文字 | [route-estimate.ts:85](../../packages/domain/src/route-estimate.ts#L85) |

## 官网路线小地图（static-map.ts）

文件：`packages/domain/src/static-map.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `static-map.ec1b3684` | 写死 | 谷歌地图的密钥没有配置：官网路线图用原来的地图显示 | 文字 | [static-map.ts:245](../../packages/domain/src/static-map.ts#L245) |
| `static-map.46fe3ff0` | 写死 | 今天调用谷歌静态地图的次数已到每日上限（费用控制），明天 0 点（东京时间）恢复；需要放宽请调整 GOOGLE\_STATIC\_MAPS\_DAILY\_LIMIT | 文字 | [static-map.ts:246](../../packages/domain/src/static-map.ts#L246) |
| `static-map.414d8853` | 写死 | 谷歌地图的密钥无效：请在运营后台核对或更换 | 提示 | [static-map.ts:247](../../packages/domain/src/static-map.ts#L247) |
| `static-map.25ca0380` | 写死 | 谷歌云项目没有启用 Maps Static API：官网路线图用原来的地图显示，需要时请在谷歌云后台开通 | 文字 | [static-map.ts:248](../../packages/domain/src/static-map.ts#L248) |
| `static-map.d4ad1983` | 写死 | 谷歌地图的密钥设了限制（如只允许某些网站或 API），不允许这台服务器调用 Maps Static API | 文字 | [static-map.ts:249](../../packages/domain/src/static-map.ts#L249) |
| `static-map.4006ae3d` | 写死 | 谷歌云项目没有绑定付款方式 | 文字 | [static-map.ts:250](../../packages/domain/src/static-map.ts#L250) |
| `static-map.d4ac4519` | 写死 | 谷歌拒绝了这次调用（权限不够） | 文字 | [static-map.ts:251](../../packages/domain/src/static-map.ts#L251) |
| `static-map.68a15f90` | 写死 | 谷歌静态地图的用量超过了上限或被限流，稍后自动重试 | 文字 | [static-map.ts:252](../../packages/domain/src/static-map.ts#L252) |
| `static-map.bb0a74dc` | 写死 | 谷歌静态地图在时限内没有应答 | 文字 | [static-map.ts:253](../../packages/domain/src/static-map.ts#L253) |
| `static-map.083fdafa` | 写死 | 连不上谷歌静态地图（网络不通） | 文字 | [static-map.ts:254](../../packages/domain/src/static-map.ts#L254) |
| `static-map.135d0778` | 写死 | 谷歌静态地图暂时出错 | 文字 | [static-map.ts:255](../../packages/domain/src/static-map.ts#L255) |
| `static-map.083273a7` | 写死 | 谷歌静态地图的应答看不懂（不是图片或跳转到了别处） | 文字 | [static-map.ts:256](../../packages/domain/src/static-map.ts#L256) |
| `static-map.ddb91995` | 写死 | 谷歌静态地图给的图太大，没有使用 | 文字 | [static-map.ts:257](../../packages/domain/src/static-map.ts#L257) |

## 供应商名称和企业信息的维护（tenant-profile.ts）

文件：`packages/domain/src/tenant-profile.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenant-profile.1839a772` | 写死 | 对外显示名称 | 名称 | [tenant-profile.ts:29](../../packages/domain/src/tenant-profile.ts#L29) |
| `tenant-profile.c945ca3a` | 写死 | 所在国家 | 文字 | [tenant-profile.ts:30](../../packages/domain/src/tenant-profile.ts#L30) |
| `tenant-profile.a177857f` | 写死 | 法定名称 | 名称 | [tenant-profile.ts:31](../../packages/domain/src/tenant-profile.ts#L31) |
| `tenant-profile.36405b1e` | 写死 | 登记号 | 文字 | [tenant-profile.ts:32](../../packages/domain/src/tenant-profile.ts#L32) |
| `tenant-profile.73337d9d` | 写死 | 注册地址 | 文字 | [tenant-profile.ts:33](../../packages/domain/src/tenant-profile.ts#L33) |
| `tenant-profile.e813ca96` | 写死 | 联系人 | 名称 | [tenant-profile.ts:34](../../packages/domain/src/tenant-profile.ts#L34) |
| `tenant-profile.c5a1cb05` | 写死 | 联系电话 | 文字 | [tenant-profile.ts:35](../../packages/domain/src/tenant-profile.ts#L35) |
| `tenant-profile.61b124e6` | 写死 | 联系邮箱 | 文字 | [tenant-profile.ts:36](../../packages/domain/src/tenant-profile.ts#L36) |

## 供应商（tenants.ts）

文件：`packages/domain/src/tenants.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tenants.3e0df22d` | 写死 | 申请中 | 文字 | [tenants.ts:67](../../packages/domain/src/tenants.ts#L67) |
| `tenants.e8365432` | 写死 | 审核中 | 文字 | [tenants.ts:68](../../packages/domain/src/tenants.ts#L68) |
| `tenants.097c7713` | 写死 | 已签约 | 文字 | [tenants.ts:69](../../packages/domain/src/tenants.ts#L69) |
| `tenants.41d5cbf7` | 写死 | 试运营 | 文字 | [tenants.ts:70](../../packages/domain/src/tenants.ts#L70) |
| `tenants.1264f0cd` | 写死 | 正常 | 文字 | [tenants.ts:71](../../packages/domain/src/tenants.ts#L71) |
| `tenants.5043a14f` | 写死 | 暂停 | 文字 | [tenants.ts:72](../../packages/domain/src/tenants.ts#L72) |
| `tenants.4dccb898` | 写死 | 已清退 | 文字 | [tenants.ts:73](../../packages/domain/src/tenants.ts#L73) |
| `tenants.6e9a794a` | 写死 | 登记簿謄本（履历事项全部证明书） | 名称 | [tenants.ts:183](../../packages/domain/src/tenants.ts#L183) |
| `tenants.72e72408` | 写死 | 营业执照 | 名称 | [tenants.ts:184](../../packages/domain/src/tenants.ts#L184) |
| `tenants.c9e39854` | 写死 | 旅客运输营运许可 | 名称 | [tenants.ts:185](../../packages/domain/src/tenants.ts#L185) |
| `tenants.d7769d48` | 写死 | 旅客赔偿责任保险 | 名称 | [tenants.ts:186](../../packages/domain/src/tenants.ts#L186) |
| `tenants.747ee15d` | 写死 | 营运车辆商业保险 | 名称 | [tenants.ts:187](../../packages/domain/src/tenants.ts#L187) |
| `tenants.d9dceac2` | 写死 | 结算账户证明 | 名称 | [tenants.ts:188](../../packages/domain/src/tenants.ts#L188) |
| `tenants.28f98006` | 写死 | 其他补充材料 | 名称 | [tenants.ts:189](../../packages/domain/src/tenants.ts#L189) |
| `tenants.04e833a3` | 写死 | 文件 | 名称 | [tenants.ts:421](../../packages/domain/src/tenants.ts#L421) |

## 工单（tickets.ts）

文件：`packages/domain/src/tickets.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `tickets.25aa6d11` | 写死 | 客人投诉 | 文字 | [tickets.ts:21](../../packages/domain/src/tickets.ts#L21) |
| `tickets.0ad1dbe6` | 写死 | no-show 审核 | 文字 | [tickets.ts:22](../../packages/domain/src/tickets.ts#L22) |
| `tickets.af51c25f` | 写死 | 履约失败 | 提示 | [tickets.ts:23](../../packages/domain/src/tickets.ts#L23) |
| `tickets.1167c9e2` | 写死 | 修改订单 | 文字 | [tickets.ts:24](../../packages/domain/src/tickets.ts#L24) |
| `tickets.b44ace08` | 写死 | 失物招领 | 文字 | [tickets.ts:25](../../packages/domain/src/tickets.ts#L25) |
| `tickets.84658045` | 写死 | 租户申诉 | 文字 | [tickets.ts:26](../../packages/domain/src/tickets.ts#L26) |
| `tickets.4756f0cb` | 写死 | 其他 | 文字 | [tickets.ts:27](../../packages/domain/src/tickets.ts#L27) |
| `tickets.2d6b7807` | 写死 | 普通 | 文字 | [tickets.ts:50](../../packages/domain/src/tickets.ts#L50) |
| `tickets.5ebc5392` | 写死 | 紧急 | 文字 | [tickets.ts:50](../../packages/domain/src/tickets.ts#L50) |
| `tickets.f0e63322` | 写死 | 高 | 文字 | [tickets.ts:50](../../packages/domain/src/tickets.ts#L50) |
| `tickets.f59d3e6d` | 写死 | 低 | 文字 | [tickets.ts:50](../../packages/domain/src/tickets.ts#L50) |
| `tickets.030432d1` | 写死 | 待处理 | 文字 | [tickets.ts:120](../../packages/domain/src/tickets.ts#L120) |
| `tickets.ac81d14e` | 写死 | 等租户回复 | 文字 | [tickets.ts:121](../../packages/domain/src/tickets.ts#L121) |
| `tickets.2f37749c` | 写死 | 处理中 | 文字 | [tickets.ts:122](../../packages/domain/src/tickets.ts#L122) |
| `tickets.5459b65f` | 写死 | 判定待复核 | 文字 | [tickets.ts:123](../../packages/domain/src/tickets.ts#L123) |
| `tickets.363c1351` | 写死 | 已判定 | 文字 | [tickets.ts:124](../../packages/domain/src/tickets.ts#L124) |
| `tickets.0452d00c` | 写死 | 已关闭 | 文字 | [tickets.ts:125](../../packages/domain/src/tickets.ts#L125) |

## 「未覆盖需求」（uncovered-demand.ts）

文件：`packages/domain/src/uncovered-demand.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `uncovered-demand.e134b930` | 写死 | 不在任何供应商的运营区域里 | 文字 | [uncovered-demand.ts:19](../../packages/domain/src/uncovered-demand.ts#L19) |
| `uncovered-demand.52ff9add` | 写死 | 在运营区域里，但没有报价区域 | 文字 | [uncovered-demand.ts:20](../../packages/domain/src/uncovered-demand.ts#L20) |
| `uncovered-demand.1bcd3696` | 写死 | 其他原因 | 文字 | [uncovered-demand.ts:21](../../packages/domain/src/uncovered-demand.ts#L21) |

## 车型标识（vehicle-label.ts）

文件：`packages/domain/src/vehicle-label.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `vehicle-label.luggage` | 已走 key | {count} 件 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.luggageBasis` | 已走 key | 行李按 28 寸行李箱计 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.maxLuggage` | 已走 key | 最多行李 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.maxPassengers` | 已走 key | 最多乘客 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.passengers` | 已走 key | {count} 人 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.representative` | 已走 key | 代表车型 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |
| `vehicle-label.similar` | 已走 key | 同级车型 | 文字 | [vehicle-label.ts:54](../../packages/domain/src/vehicle-label.ts#L54) |

## 官网订单链接发到下单邮箱（view-link.ts）

文件：`packages/domain/src/view-link.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `view-link.8cbe905d` | 写死 | 回拨下单时留的电话，本人确认 | 文字 | [view-link.ts:66](../../packages/domain/src/view-link.ts#L66) |
| `view-link.edc08a02` | 写死 | 客人用下单邮箱来信 | 文字 | [view-link.ts:67](../../packages/domain/src/view-link.ts#L67) |
| `view-link.e1c51304` | 写死 | 核对订单细节（行程、用车时间、人数、航班号） | 文字 | [view-link.ts:68](../../packages/domain/src/view-link.ts#L68) |
| `view-link.9be998f2` | 写死 | 核对付款信息（卡号末 4 位、付款时间、金额） | 文字 | [view-link.ts:69](../../packages/domain/src/view-link.ts#L69) |
| `view-link.fc524024` | 写死 | 其他（在原因里写清楚怎么核实的） | 文字 | [view-link.ts:70](../../packages/domain/src/view-link.ts#L70) |
| `view-link.75ce5afd` | 写死 | 这不是官网的订单：客人的通知由下单的渠道发，平台不发订单链接 | 文字 | [view-link.ts:103](../../packages/domain/src/view-link.ts#L103) |
| `view-link.8b18ed48` | 写死 | 这张单的乘客信息已按隐私规则清除，链接也已作废，不能再发 | 文字 | [view-link.ts:104](../../packages/domain/src/view-link.ts#L104) |
| `view-link.a209b974` | 写死 | 这张单没有下单邮箱：核实客人身份后，选「发到核实后的新邮箱」 | 文字 | [view-link.ts:105](../../packages/domain/src/view-link.ts#L105) |
| `view-link.04949819` | 写死 | 新邮箱和下单邮箱是同一个：请选「发到下单邮箱」，不用复核 | 文字 | [view-link.ts:106](../../packages/domain/src/view-link.ts#L106) |

## 推送给供应商（webhooks.ts）

文件：`packages/domain/src/webhooks.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `webhooks.8f289776` | 写死 | 新订单（客人付款后自动确认） | 文字 | [webhooks.ts:23](../../packages/domain/src/webhooks.ts#L23) |
| `webhooks.c5534924` | 写死 | 派车和改派（改派带 change=true） | 文字 | [webhooks.ts:24](../../packages/domain/src/webhooks.ts#L24) |
| `webhooks.bffb2a4a` | 写死 | 履约状态变化（出发、到达、接到客人、完成、客人未出现） | 文字 | [webhooks.ts:25](../../packages/domain/src/webhooks.ts#L25) |
| `webhooks.152a551c` | 写死 | 改单（时间、航班、人数等） | 文字 | [webhooks.ts:26](../../packages/domain/src/webhooks.ts#L26) |
| `webhooks.7fd6c41e` | 写死 | 订单取消 | 文字 | [webhooks.ts:27](../../packages/domain/src/webhooks.ts#L27) |
| `webhooks.658d4754` | 写死 | 收到救援单 | 文字 | [webhooks.ts:28](../../packages/domain/src/webhooks.ts#L28) |
| `webhooks.08b4ef3b` | 写死 | 订单已转给救援租户 | 文字 | [webhooks.ts:29](../../packages/domain/src/webhooks.ts#L29) |
| `webhooks.a1928e82` | 写死 | 账单已付款（银行流水号已回填） | 文字 | [webhooks.ts:30](../../packages/domain/src/webhooks.ts#L30) |
