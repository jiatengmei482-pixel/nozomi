# 运营后台（第 3 / 3 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 3935 条：写死 3929 条，已走 key 6 条。列的意思见 [README](README.md)。

本区域分 3 份：[第 1 份](platform.md) · [第 2 份](platform-2.md) · 第 3 份

## 页面

- [多个页面共用：审计日志的显示（audit-display.ts）](#多个页面共用审计日志的显示audit-displayts)（248 条）
- [多个页面共用：运营后台「人工报价」「官网设置」的地址、状态徽标和文字（manual-quote-display.ts）](#多个页面共用运营后台人工报价官网设置的地址状态徽标和文字manual-quote-displayts)（31 条）
- [多个页面共用：一次性链接（one-time-link.ts）](#多个页面共用一次性链接one-time-linkts)（14 条）
- [多个页面共用：路线预估（route-display.ts）](#多个页面共用路线预估route-displayts)（22 条）
- [多个页面共用：use-city-options.ts](#多个页面共用use-city-optionsts)（9 条）
- [多个页面共用：use-colleagues.ts](#多个页面共用use-colleaguests)（1 条）
- [多个页面共用：四个表单共用的校验和小部件（forms-common.tsx）](#多个页面共用四个表单共用的校验和小部件forms-commontsx)（6 条）
- [多个页面共用：四类主数据的列表页、表单页共用的小部件和取数（shared.tsx）](#多个页面共用四类主数据的列表页表单页共用的小部件和取数sharedtsx)（3 条）
- [多个页面共用：停用（useStatusToggle.tsx）](#多个页面共用停用usestatustoggletsx)（14 条）
- [多个页面共用：渠道详情的各个分区（ChannelSections.tsx）](#多个页面共用渠道详情的各个分区channelsectionstsx)（178 条）
- [多个页面共用：no-show 证据（NoShowEvidence.tsx）](#多个页面共用no-show-证据noshowevidencetsx)（24 条）
- [多个页面共用：运营看手写内容的原文（PassengerReveal.tsx）](#多个页面共用运营看手写内容的原文passengerrevealtsx)（27 条）
- [多个页面共用：加价规则 / 定价参数生效前的「近 30 天毛利试算」（PricingImpactPanel.tsx）](#多个页面共用加价规则--定价参数生效前的近-30-天毛利试算pricingimpactpaneltsx)（38 条）
- [多个页面共用：运营后台供应商详情里的入驻部分（TenantOnboardingSections.tsx）](#多个页面共用运营后台供应商详情里的入驻部分tenantonboardingsectionstsx)（106 条）
- [多个页面共用：运营后台供应商详情的「企业信息」（TenantProfileSection.tsx）](#多个页面共用运营后台供应商详情的企业信息tenantprofilesectiontsx)（42 条）
- [多个页面共用：订单中心、财务结算几个页面共用的小部件（order-center-parts.tsx）](#多个页面共用订单中心财务结算几个页面共用的小部件order-center-partstsx)（2 条）

## 多个页面共用：审计日志的显示（audit-display.ts）

用在：运营后台 · 人工报价；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 待审核；运营后台 · 系统设置（审计日志、系统状态）；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）

文件：`apps/web/src/lib/audit-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `audit-display.521c1482` | 写死 | 平台员工 | 文字 | [audit-display.ts:11](../../apps/web/src/lib/audit-display.ts#L11)、204 行 |
| `audit-display.1c6c8309` | 写死 | 供应商 | 文字 | [audit-display.ts:12](../../apps/web/src/lib/audit-display.ts#L12)、258、304 行 |
| `audit-display.5154573c` | 写死 | 供应商的账号 | 文字 | [audit-display.ts:13](../../apps/web/src/lib/audit-display.ts#L13)、204 行 |
| `audit-display.658f2d01` | 写死 | 系统状态 | 文字 | [audit-display.ts:14](../../apps/web/src/lib/audit-display.ts#L14) |
| `audit-display.f5412a1e` | 写死 | 第三方密钥 | 文字 | [audit-display.ts:15](../../apps/web/src/lib/audit-display.ts#L15) |
| `audit-display.b199fa87` | 写死 | 城市 | 文字 | [audit-display.ts:16](../../apps/web/src/lib/audit-display.ts#L16)、257 行 |
| `audit-display.b8b0fa49` | 写死 | 地点 | 文字 | [audit-display.ts:17](../../apps/web/src/lib/audit-display.ts#L17) |
| `audit-display.8265c78b` | 写死 | 车型组 | 文字 | [audit-display.ts:18](../../apps/web/src/lib/audit-display.ts#L18) |
| `audit-display.6c141dd5` | 写死 | 附加服务 | 文字 | [audit-display.ts:19](../../apps/web/src/lib/audit-display.ts#L19) |
| `audit-display.c10b67fd` | 写死 | 区域 | 文字 | [audit-display.ts:20](../../apps/web/src/lib/audit-display.ts#L20) |
| `audit-display.02b704f2` | 写死 | 子品牌 | 文字 | [audit-display.ts:21](../../apps/web/src/lib/audit-display.ts#L21) |
| `audit-display.41467a0f` | 写死 | 商品 | 文字 | [audit-display.ts:22](../../apps/web/src/lib/audit-display.ts#L22) |
| `audit-display.c1af5280` | 写死 | 价格规则 | 文字 | [audit-display.ts:23](../../apps/web/src/lib/audit-display.ts#L23) |
| `audit-display.48dc7154` | 写死 | 调价规则 | 文字 | [audit-display.ts:24](../../apps/web/src/lib/audit-display.ts#L24) |
| `audit-display.5afb1a7f` | 写死 | 计程价 | 文字 | [audit-display.ts:25](../../apps/web/src/lib/audit-display.ts#L25) |
| `audit-display.4affb64c` | 写死 | 节假日 | 文字 | [audit-display.ts:26](../../apps/web/src/lib/audit-display.ts#L26) |
| `audit-display.3d01e3e9` | 写死 | 库存 | 文字 | [audit-display.ts:27](../../apps/web/src/lib/audit-display.ts#L27) |
| `audit-display.7534c9f2` | 写死 | 汇率拉取 | 文字 | [audit-display.ts:28](../../apps/web/src/lib/audit-display.ts#L28) |
| `audit-display.381aa743` | 写死 | 汇率 | 文字 | [audit-display.ts:29](../../apps/web/src/lib/audit-display.ts#L29) |
| `audit-display.6e93f6c9` | 写死 | 汇率人工锁定 | 文字 | [audit-display.ts:30](../../apps/web/src/lib/audit-display.ts#L30) |
| `audit-display.7558d37a` | 写死 | 渠道 | 文字 | [audit-display.ts:31](../../apps/web/src/lib/audit-display.ts#L31) |
| `audit-display.8e86637f` | 写死 | 加价规则 | 文字 | [audit-display.ts:32](../../apps/web/src/lib/audit-display.ts#L32) |
| `audit-display.5c984a86` | 写死 | API 客户端 | 文字 | [audit-display.ts:33](../../apps/web/src/lib/audit-display.ts#L33) |
| `audit-display.f28a57b6` | 写死 | 双人复核 | 文字 | [audit-display.ts:34](../../apps/web/src/lib/audit-display.ts#L34) |
| `audit-display.20f4b703` | 写死 | 角色 | 文字 | [audit-display.ts:35](../../apps/web/src/lib/audit-display.ts#L35)、248 行 |
| `audit-display.706aa0cc` | 写死 | 供应商的企业信息 | 文字 | [audit-display.ts:36](../../apps/web/src/lib/audit-display.ts#L36) |
| `audit-display.5c10858c` | 写死 | 供应商的资料修改申请 | 文字 | [audit-display.ts:37](../../apps/web/src/lib/audit-display.ts#L37) |
| `audit-display.6a2638dc` | 写死 | 供应商的文件 | 文字 | [audit-display.ts:38](../../apps/web/src/lib/audit-display.ts#L38) |
| `audit-display.989d6187` | 写死 | 供应商的资质 | 文字 | [audit-display.ts:39](../../apps/web/src/lib/audit-display.ts#L39) |
| `audit-display.f0160422` | 写死 | 供应商的合同 | 文字 | [audit-display.ts:40](../../apps/web/src/lib/audit-display.ts#L40) |
| `audit-display.ea9ab885` | 写死 | 司机 | 文字 | [audit-display.ts:41](../../apps/web/src/lib/audit-display.ts#L41) |
| `audit-display.c6ad4ceb` | 写死 | 车辆 | 文字 | [audit-display.ts:42](../../apps/web/src/lib/audit-display.ts#L42) |
| `audit-display.602dac13` | 写死 | 订单 | 文字 | [audit-display.ts:43](../../apps/web/src/lib/audit-display.ts#L43)、266 行 |
| `audit-display.7cd51667` | 写死 | 司机链接 | 文字 | [audit-display.ts:44](../../apps/web/src/lib/audit-display.ts#L44) |
| `audit-display.5c5192e9` | 写死 | 供应商的 Webhook 设置 | 文字 | [audit-display.ts:45](../../apps/web/src/lib/audit-display.ts#L45) |
| `audit-display.12942751` | 写死 | Webhook 推送 | 文字 | [audit-display.ts:46](../../apps/web/src/lib/audit-display.ts#L46) |
| `audit-display.04a701f6` | 写死 | 通知 | 文字 | [audit-display.ts:47](../../apps/web/src/lib/audit-display.ts#L47) |
| `audit-display.b8635f09` | 写死 | 免打扰设置 | 文字 | [audit-display.ts:48](../../apps/web/src/lib/audit-display.ts#L48) |
| `audit-display.d777847d` | 写死 | 平台取消政策 | 文字 | [audit-display.ts:49](../../apps/web/src/lib/audit-display.ts#L49) |
| `audit-display.65745223` | 写死 | 改单 | 文字 | [audit-display.ts:50](../../apps/web/src/lib/audit-display.ts#L50)、141 行 |
| `audit-display.7ef90162` | 写死 | 事后加收 | 文字 | [audit-display.ts:51](../../apps/web/src/lib/audit-display.ts#L51) |
| `audit-display.c387a965` | 写死 | 退款 | 文字 | [audit-display.ts:52](../../apps/web/src/lib/audit-display.ts#L52) |
| `audit-display.4b065253` | 写死 | 救援改派 | 文字 | [audit-display.ts:53](../../apps/web/src/lib/audit-display.ts#L53) |
| `audit-display.34c828b7` | 写死 | 救援单 | 文字 | [audit-display.ts:54](../../apps/web/src/lib/audit-display.ts#L54) |
| `audit-display.a1357c4a` | 写死 | 客人赔付表 | 文字 | [audit-display.ts:55](../../apps/web/src/lib/audit-display.ts#L55) |
| `audit-display.47713b9c` | 写死 | 订单异常 | 文字 | [audit-display.ts:56](../../apps/web/src/lib/audit-display.ts#L56) |
| `audit-display.bf5a3140` | 写死 | 工单 | 文字 | [audit-display.ts:57](../../apps/web/src/lib/audit-display.ts#L57) |
| `audit-display.5e56bee7` | 写死 | 账单 | 文字 | [audit-display.ts:58](../../apps/web/src/lib/audit-display.ts#L58) |
| `audit-display.475dca68` | 写死 | 付款批次 | 文字 | [audit-display.ts:59](../../apps/web/src/lib/audit-display.ts#L59) |
| `audit-display.de55168f` | 写死 | 收款账户 | 文字 | [audit-display.ts:60](../../apps/web/src/lib/audit-display.ts#L60) |
| `audit-display.05bbb0cd` | 写死 | 银行转账文件 | 文字 | [audit-display.ts:61](../../apps/web/src/lib/audit-display.ts#L61) |
| `audit-display.677c632f` | 写死 | 人工报价申请 | 文字 | [audit-display.ts:62](../../apps/web/src/lib/audit-display.ts#L62) |
| `audit-display.0d95dc6f` | 写死 | 官网设置 | 文字 | [audit-display.ts:63](../../apps/web/src/lib/audit-display.ts#L63) |
| `audit-display.4adfaa50` | 写死 | 验收会话 | 文字 | [audit-display.ts:64](../../apps/web/src/lib/audit-display.ts#L64) |
| `audit-display.c82e1532` | 写死 | 共享库重复区域 | 文字 | [audit-display.ts:65](../../apps/web/src/lib/audit-display.ts#L65) |
| `audit-display.c3ea6e14` | 写死 | 嵌入组件的嵌入码 | 文字 | [audit-display.ts:66](../../apps/web/src/lib/audit-display.ts#L66) |
| `audit-display.8d2fcb83` | 写死 | AI 行程解析用的 Claude 型号 | 文字 | [audit-display.ts:67](../../apps/web/src/lib/audit-display.ts#L67) |
| `audit-display.5d4cf727` | 写死 | 法律文案的待补项 | 文字 | [audit-display.ts:68](../../apps/web/src/lib/audit-display.ts#L68) |
| `audit-display.177b5620` | 写死 | 登录 | 文字 | [audit-display.ts:72](../../apps/web/src/lib/audit-display.ts#L72) |
| `audit-display.a63f1e5a` | 写死 | 登录失败 | 提示 | [audit-display.ts:73](../../apps/web/src/lib/audit-display.ts#L73) |
| `audit-display.8de02aa0` | 写死 | 请求邮箱验证码 | 文字 | [audit-display.ts:74](../../apps/web/src/lib/audit-display.ts#L74) |
| `audit-display.88c6408b` | 写死 | 邮箱验证码校验失败 | 提示 | [audit-display.ts:75](../../apps/web/src/lib/audit-display.ts#L75) |
| `audit-display.bb62bf47` | 写死 | 标记调整中 | 文字 | [audit-display.ts:76](../../apps/web/src/lib/audit-display.ts#L76) |
| `audit-display.dd3648e4` | 写死 | 发官网订单链接 | 文字 | [audit-display.ts:77](../../apps/web/src/lib/audit-display.ts#L77) |
| `audit-display.e27292a6` | 写死 | 退出登录 | 文字 | [audit-display.ts:78](../../apps/web/src/lib/audit-display.ts#L78) |
| `audit-display.71212c6c` | 写死 | 新建 | 文字 | [audit-display.ts:79](../../apps/web/src/lib/audit-display.ts#L79) |
| `audit-display.6f170221` | 写死 | 修改 | 文字 | [audit-display.ts:80](../../apps/web/src/lib/audit-display.ts#L80) |
| `audit-display.b2546e54` | 写死 | 删除 | 文字 | [audit-display.ts:81](../../apps/web/src/lib/audit-display.ts#L81) |
| `audit-display.404f2800` | 写死 | 邀请 | 文字 | [audit-display.ts:82](../../apps/web/src/lib/audit-display.ts#L82) |
| `audit-display.306d35cb` | 写死 | 接受邀请 | 文字 | [audit-display.ts:83](../../apps/web/src/lib/audit-display.ts#L83) |
| `audit-display.301420fc` | 写死 | 停用 | 文字 | [audit-display.ts:84](../../apps/web/src/lib/audit-display.ts#L84) |
| `audit-display.cac7fee2` | 写死 | 启用 | 文字 | [audit-display.ts:85](../../apps/web/src/lib/audit-display.ts#L85)、106、315 行 |
| `audit-display.b42c25fd` | 写死 | 暂停 | 文字 | [audit-display.ts:86](../../apps/web/src/lib/audit-display.ts#L86)、107 行 |
| `audit-display.b1160ec4` | 写死 | 恢复 | 文字 | [audit-display.ts:87](../../apps/web/src/lib/audit-display.ts#L87) |
| `audit-display.c37ec56e` | 写死 | 上架 | 文字 | [audit-display.ts:88](../../apps/web/src/lib/audit-display.ts#L88) |
| `audit-display.0cf8841f` | 写死 | 下架 | 文字 | [audit-display.ts:89](../../apps/web/src/lib/audit-display.ts#L89) |
| `audit-display.6323336d` | 写死 | 改角色 | 文字 | [audit-display.ts:90](../../apps/web/src/lib/audit-display.ts#L90) |
| `audit-display.cf498891` | 写死 | 修改密码 | 文字 | [audit-display.ts:91](../../apps/web/src/lib/audit-display.ts#L91) |
| `audit-display.a3bb4b22` | 写死 | 发出密码重置 | 文字 | [audit-display.ts:92](../../apps/web/src/lib/audit-display.ts#L92) |
| `audit-display.d8a13953` | 写死 | 重设密码 | 文字 | [audit-display.ts:93](../../apps/web/src/lib/audit-display.ts#L93) |
| `audit-display.204726c9` | 写死 | 查看 | 文字 | [audit-display.ts:94](../../apps/web/src/lib/audit-display.ts#L94) |
| `audit-display.037576f2` | 写死 | 立即拉取 | 文字 | [audit-display.ts:95](../../apps/web/src/lib/audit-display.ts#L95) |
| `audit-display.a8d11589` | 写死 | 挂起待确认 | 文字 | [audit-display.ts:96](../../apps/web/src/lib/audit-display.ts#L96) |
| `audit-display.4851ccc6` | 写死 | 确认生效 | 按钮 | [audit-display.ts:97](../../apps/web/src/lib/audit-display.ts#L97) |
| `audit-display.8558d385` | 写死 | 放弃 | 文字 | [audit-display.ts:98](../../apps/web/src/lib/audit-display.ts#L98) |
| `audit-display.328e99dc` | 写死 | 过期告警 | 文字 | [audit-display.ts:99](../../apps/web/src/lib/audit-display.ts#L99) |
| `audit-display.c7e19059` | 写死 | 发起复核 | 文字 | [audit-display.ts:100](../../apps/web/src/lib/audit-display.ts#L100) |
| `audit-display.8536450a` | 写死 | 批准 | 文字 | [audit-display.ts:101](../../apps/web/src/lib/audit-display.ts#L101) |
| `audit-display.da58b902` | 写死 | 驳回 | 文字 | [audit-display.ts:102](../../apps/web/src/lib/audit-display.ts#L102) |
| `audit-display.5f8bebde` | 写死 | 撤回 | 文字 | [audit-display.ts:103](../../apps/web/src/lib/audit-display.ts#L103) |
| `audit-display.543d1d54` | 写死 | 轮换密钥 | 文字 | [audit-display.ts:104](../../apps/web/src/lib/audit-display.ts#L104) |
| `audit-display.ecf8e37a` | 写死 | 吊销 | 文字 | [audit-display.ts:105](../../apps/web/src/lib/audit-display.ts#L105) |
| `audit-display.b16bb27c` | 写死 | 锁定生效 | 文字 | [audit-display.ts:108](../../apps/web/src/lib/audit-display.ts#L108) |
| `audit-display.473f2b7a` | 写死 | 解除锁定 | 文字 | [audit-display.ts:109](../../apps/web/src/lib/audit-display.ts#L109) |
| `audit-display.1a75fcba` | 写死 | 到期失效 | 文字 | [audit-display.ts:110](../../apps/web/src/lib/audit-display.ts#L110) |
| `audit-display.f6d7abb3` | 写死 | 开始绑定两步验证 | 文字 | [audit-display.ts:111](../../apps/web/src/lib/audit-display.ts#L111) |
| `audit-display.8bb3400b` | 写死 | 绑定两步验证 | 文字 | [audit-display.ts:112](../../apps/web/src/lib/audit-display.ts#L112) |
| `audit-display.78bcf7b9` | 写死 | 通过两步验证 | 文字 | [audit-display.ts:113](../../apps/web/src/lib/audit-display.ts#L113) |
| `audit-display.4b2174bc` | 写死 | 两步验证失败 | 提示 | [audit-display.ts:114](../../apps/web/src/lib/audit-display.ts#L114) |
| `audit-display.bf0fde0e` | 写死 | 重新生成恢复码 | 文字 | [audit-display.ts:115](../../apps/web/src/lib/audit-display.ts#L115) |
| `audit-display.f37831c5` | 写死 | 重置两步验证 | 文字 | [audit-display.ts:116](../../apps/web/src/lib/audit-display.ts#L116) |
| `audit-display.8d466b6d` | 写死 | 清空 IP 白名单 | 文字 | [audit-display.ts:117](../../apps/web/src/lib/audit-display.ts#L117) |
| `audit-display.92147179` | 写死 | 提交审核 | 按钮 | [audit-display.ts:118](../../apps/web/src/lib/audit-display.ts#L118) |
| `audit-display.1ffa2876` | 写死 | 退回补充 | 文字 | [audit-display.ts:119](../../apps/web/src/lib/audit-display.ts#L119) |
| `audit-display.4ed6ad64` | 写死 | 签约 | 文字 | [audit-display.ts:120](../../apps/web/src/lib/audit-display.ts#L120) |
| `audit-display.cdbf924d` | 写死 | 开始试运营 | 文字 | [audit-display.ts:121](../../apps/web/src/lib/audit-display.ts#L121) |
| `audit-display.8ec34d71` | 写死 | 转为正式 | 文字 | [audit-display.ts:122](../../apps/web/src/lib/audit-display.ts#L122) |
| `audit-display.252b87d5` | 写死 | 清退 | 文字 | [audit-display.ts:123](../../apps/web/src/lib/audit-display.ts#L123) |
| `audit-display.2b050025` | 写死 | 观察期变化 | 文字 | [audit-display.ts:124](../../apps/web/src/lib/audit-display.ts#L124) |
| `audit-display.24483231` | 写死 | 上传 | 文字 | [audit-display.ts:125](../../apps/web/src/lib/audit-display.ts#L125) |
| `audit-display.cd6fd131` | 写死 | 要求补充 | 文字 | [audit-display.ts:126](../../apps/web/src/lib/audit-display.ts#L126) |
| `audit-display.53151807` | 写死 | 填写 | 文字 | [audit-display.ts:127](../../apps/web/src/lib/audit-display.ts#L127) |
| `audit-display.cda247ca` | 写死 | 更换 | 文字 | [audit-display.ts:128](../../apps/web/src/lib/audit-display.ts#L128) |
| `audit-display.efea8daa` | 写死 | 清空 | 文字 | [audit-display.ts:129](../../apps/web/src/lib/audit-display.ts#L129) |
| `audit-display.6a350d6f` | 写死 | 数据迁移 | 文字 | [audit-display.ts:130](../../apps/web/src/lib/audit-display.ts#L130) |
| `audit-display.8c60aeb0` | 写死 | 指派 | 文字 | [audit-display.ts:131](../../apps/web/src/lib/audit-display.ts#L131) |
| `audit-display.52766a1f` | 写死 | 改派 | 文字 | [audit-display.ts:132](../../apps/web/src/lib/audit-display.ts#L132)、183 行 |
| `audit-display.77da2201` | 写死 | 生成 | 文字 | [audit-display.ts:133](../../apps/web/src/lib/audit-display.ts#L133)、191 行 |
| `audit-display.55bfea07` | 写死 | 重试 | 文字 | [audit-display.ts:134](../../apps/web/src/lib/audit-display.ts#L134) |
| `audit-display.a8c875da` | 写死 | 发送测试 | 文字 | [audit-display.ts:135](../../apps/web/src/lib/audit-display.ts#L135) |
| `audit-display.e47d3344` | 写死 | 取消 | 按钮 | [audit-display.ts:136](../../apps/web/src/lib/audit-display.ts#L136) |
| `audit-display.3acc7ad4` | 写死 | 查看乘客联系方式 | 文字 | [audit-display.ts:137](../../apps/web/src/lib/audit-display.ts#L137) |
| `audit-display.73eac52b` | 写死 | 查看工单文字原文 | 文字 | [audit-display.ts:138](../../apps/web/src/lib/audit-display.ts#L138) |
| `audit-display.539f059f` | 写死 | 乘客信息自动脱敏 | 文字 | [audit-display.ts:139](../../apps/web/src/lib/audit-display.ts#L139) |
| `audit-display.b90aa3a9` | 写死 | 查看证据照片 | 文字 | [audit-display.ts:140](../../apps/web/src/lib/audit-display.ts#L140) |
| `audit-display.8990c6c6` | 写死 | 审核 | 文字 | [audit-display.ts:142](../../apps/web/src/lib/audit-display.ts#L142) |
| `audit-display.280a235e` | 写死 | 扣款 | 文字 | [audit-display.ts:143](../../apps/web/src/lib/audit-display.ts#L143) |
| `audit-display.86c98993` | 写死 | 发起 | 文字 | [audit-display.ts:144](../../apps/web/src/lib/audit-display.ts#L144) |
| `audit-display.f335dfc5` | 写死 | 发救援单 | 文字 | [audit-display.ts:145](../../apps/web/src/lib/audit-display.ts#L145) |
| `audit-display.d4601620` | 写死 | 接单 | 文字 | [audit-display.ts:146](../../apps/web/src/lib/audit-display.ts#L146) |
| `audit-display.8cfd1d99` | 写死 | 免除 | 文字 | [audit-display.ts:147](../../apps/web/src/lib/audit-display.ts#L147) |
| `audit-display.19eeb7ce` | 写死 | 认领 | 文字 | [audit-display.ts:148](../../apps/web/src/lib/audit-display.ts#L148) |
| `audit-display.cc92630a` | 写死 | 关闭 | 文字 | [audit-display.ts:149](../../apps/web/src/lib/audit-display.ts#L149) |
| `audit-display.cd9d84ae` | 写死 | 回复 | 文字 | [audit-display.ts:150](../../apps/web/src/lib/audit-display.ts#L150) |
| `audit-display.f42328fa` | 写死 | 备注 | 说明 | [audit-display.ts:151](../../apps/web/src/lib/audit-display.ts#L151) |
| `audit-display.9403b428` | 写死 | 征求供应商意见 | 文字 | [audit-display.ts:152](../../apps/web/src/lib/audit-display.ts#L152)、187 行 |
| `audit-display.2b1d4f1e` | 写死 | 登记已付 | 文字 | [audit-display.ts:153](../../apps/web/src/lib/audit-display.ts#L153) |
| `audit-display.53010792` | 写死 | 提异议 | 文字 | [audit-display.ts:154](../../apps/web/src/lib/audit-display.ts#L154)、189 行 |
| `audit-display.8814e735` | 写死 | 作废 | 文字 | [audit-display.ts:155](../../apps/web/src/lib/audit-display.ts#L155) |
| `audit-display.6d0f821c` | 写死 | 下载 | 文字 | [audit-display.ts:156](../../apps/web/src/lib/audit-display.ts#L156)、191 行 |
| `audit-display.00ac42d8` | 写死 | 下载前核对不通过 | 提示 | [audit-display.ts:157](../../apps/web/src/lib/audit-display.ts#L157) |
| `audit-display.04105d87` | 写死 | 派车 | 文字 | [audit-display.ts:183](../../apps/web/src/lib/audit-display.ts#L183) |
| `audit-display.3aa18aff` | 写死 | 取消订单 | 按钮 | [audit-display.ts:183](../../apps/web/src/lib/audit-display.ts#L183) |
| `audit-display.b2a73198` | 写死 | 重发司机链接邮件 | 文字 | [audit-display.ts:184](../../apps/web/src/lib/audit-display.ts#L184) |
| `audit-display.d2e242c9` | 写死 | 生成司机链接 | 文字 | [audit-display.ts:184](../../apps/web/src/lib/audit-display.ts#L184) |
| `audit-display.7e1b1a5d` | 写死 | 发起救援 | 文字 | [audit-display.ts:185](../../apps/web/src/lib/audit-display.ts#L185) |
| `audit-display.9f7f59e4` | 写死 | 认定不可抗力 | 文字 | [audit-display.ts:185](../../apps/web/src/lib/audit-display.ts#L185) |
| `audit-display.d2bee7d0` | 写死 | 接救援单 | 文字 | [audit-display.ts:186](../../apps/web/src/lib/audit-display.ts#L186) |
| `audit-display.f3d66422` | 写死 | 拒绝救援单 | 文字 | [audit-display.ts:186](../../apps/web/src/lib/audit-display.ts#L186) |
| `audit-display.37485970` | 写死 | 登记另付已付 | 文字 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187) |
| `audit-display.5615d566` | 写死 | 内部备注 | 说明 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187)、274 行 |
| `audit-display.5a03c24c` | 写死 | 判定 | 文字 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187) |
| `audit-display.72c79316` | 写死 | 关闭工单 | 文字 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187) |
| `audit-display.87462764` | 写死 | 认领 / 转交 | 文字 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187)、188 行 |
| `audit-display.a82f7415` | 写死 | 留言（供应商看得到） | 文字 | [audit-display.ts:187](../../apps/web/src/lib/audit-display.ts#L187) |
| `audit-display.483401b5` | 写死 | 写说明关闭 | 文字 | [audit-display.ts:188](../../apps/web/src/lib/audit-display.ts#L188) |
| `audit-display.3a19c862` | 写死 | 答复异议 | 文字 | [audit-display.ts:189](../../apps/web/src/lib/audit-display.ts#L189) |
| `audit-display.6bf5a05e` | 写死 | 确认账单 | 按钮 | [audit-display.ts:189](../../apps/web/src/lib/audit-display.ts#L189) |
| `audit-display.7cbf93b3` | 写死 | 出账 | 文字 | [audit-display.ts:189](../../apps/web/src/lib/audit-display.ts#L189) |
| `audit-display.9feb10bb` | 写死 | 作废并重出 | 文字 | [audit-display.ts:189](../../apps/web/src/lib/audit-display.ts#L189) |
| `audit-display.6d43262c` | 写死 | 锁定 | 文字 | [audit-display.ts:190](../../apps/web/src/lib/audit-display.ts#L190) |
| `audit-display.b07a101d` | 写死 | 全部付完 | 文字 | [audit-display.ts:190](../../apps/web/src/lib/audit-display.ts#L190) |
| `audit-display.e713bf2b` | 写死 | 收尾（已付款） | 文字 | [audit-display.ts:191](../../apps/web/src/lib/audit-display.ts#L191) |
| `audit-display.6428b1eb` | 写死 | 审核加收 | 文字 | [audit-display.ts:192](../../apps/web/src/lib/audit-display.ts#L192) |
| `audit-display.e43d90c8` | 写死 | 测试一下 | 文字 | [audit-display.ts:193](../../apps/web/src/lib/audit-display.ts#L193) |
| `audit-display.53755ba4` | 写死 | 查看客人的联系方式 | 文字 | [audit-display.ts:194](../../apps/web/src/lib/audit-display.ts#L194) |
| `audit-display.b7bab14b` | 写死 | 到期清除联系方式 | 文字 | [audit-display.ts:194](../../apps/web/src/lib/audit-display.ts#L194) |
| `audit-display.e1aa761e` | 写死 | 改状态 | 文字 | [audit-display.ts:194](../../apps/web/src/lib/audit-display.ts#L194) |
| `audit-display.4a954a42` | 写死 | 结束验收会话 | 文字 | [audit-display.ts:196](../../apps/web/src/lib/audit-display.ts#L196) |
| `audit-display.5397ff8e` | 写死 | 解锁验收会话 | 文字 | [audit-display.ts:196](../../apps/web/src/lib/audit-display.ts#L196) |
| `audit-display.aa87ec10` | 写死 | 验收口令不对 | 提示 | [audit-display.ts:196](../../apps/web/src/lib/audit-display.ts#L196) |
| `audit-display.78b0dd70` | 写死 | 撤销重复标记 | 文字 | [audit-display.ts:198](../../apps/web/src/lib/audit-display.ts#L198) |
| `audit-display.82ceaaff` | 写死 | 标为重复（在共享库里隐藏） | 文字 | [audit-display.ts:198](../../apps/web/src/lib/audit-display.ts#L198) |
| `audit-display.64273db0` | 写死 | 修改嵌入码（名称、允许的网站、默认值、启用 / 停用） | 文字 | [audit-display.ts:199](../../apps/web/src/lib/audit-display.ts#L199) |
| `audit-display.91ed024d` | 写死 | 生成嵌入码 | 文字 | [audit-display.ts:199](../../apps/web/src/lib/audit-display.ts#L199) |
| `audit-display.f68d0b52` | 写死 | 切换 AI 行程解析用的 Claude 型号 | 文字 | [audit-display.ts:200](../../apps/web/src/lib/audit-display.ts#L200) |
| `audit-display.9e2b8627` | 写死 | 修改法律文案的待补项 | 文字 | [audit-display.ts:201](../../apps/web/src/lib/audit-display.ts#L201) |
| `audit-display.38eab86e` | 写死 | 没有登录的访问者 | 文字 | [audit-display.ts:204](../../apps/web/src/lib/audit-display.ts#L204) |
| `audit-display.76761ff3` | 写死 | 系统（命令行或定时任务） | 文字 | [audit-display.ts:204](../../apps/web/src/lib/audit-display.ts#L204) |
| `audit-display.6c7b80e6` | 写死 | 定时任务 | 文字 | [audit-display.ts:205](../../apps/web/src/lib/audit-display.ts#L205) |
| `audit-display.6ff3303e` | 写死 | 接口 | 文字 | [audit-display.ts:205](../../apps/web/src/lib/audit-display.ts#L205) |
| `audit-display.7739d49e` | 写死 | 命令行 | 文字 | [audit-display.ts:205](../../apps/web/src/lib/audit-display.ts#L205) |
| `audit-display.a51bb046` | 写死 | 后台 | 文字 | [audit-display.ts:205](../../apps/web/src/lib/audit-display.ts#L205) |
| `audit-display.0385caeb` | 写死 | 回复客人（客人和渠道看得到，供应商看不到） | 文字 | [audit-display.ts:217](../../apps/web/src/lib/audit-display.ts#L217) |
| `audit-display.a5a3955f` | 写死 | 名称 | 名称 | [audit-display.ts:246](../../apps/web/src/lib/audit-display.ts#L246) |
| `audit-display.7654c510` | 写死 | 邮箱 | 文字 | [audit-display.ts:247](../../apps/web/src/lib/audit-display.ts#L247) |
| `audit-display.fe0e8128` | 写死 | 状态 | 文字 | [audit-display.ts:249](../../apps/web/src/lib/audit-display.ts#L249) |
| `audit-display.66e955db` | 写死 | 原因 | 提示 | [audit-display.ts:250](../../apps/web/src/lib/audit-display.ts#L250) |
| `audit-display.bc800439` | 写死 | 用了临时密码 | 文字 | [audit-display.ts:251](../../apps/web/src/lib/audit-display.ts#L251) |
| `audit-display.b94489da` | 写死 | 必须先改密码 | 文字 | [audit-display.ts:252](../../apps/web/src/lib/audit-display.ts#L252) |
| `audit-display.0d64471f` | 写死 | 编码 | 文字 | [audit-display.ts:253](../../apps/web/src/lib/audit-display.ts#L253) |
| `audit-display.ae6057f4` | 写死 | 标题 | 标题 | [audit-display.ts:254](../../apps/web/src/lib/audit-display.ts#L254) |
| `audit-display.11a6ac4d` | 写死 | 打码后的密钥（只有末 4 位） | 说明 | [audit-display.ts:255](../../apps/web/src/lib/audit-display.ts#L255) |
| `audit-display.21793ab7` | 写死 | 币种 | 文字 | [audit-display.ts:256](../../apps/web/src/lib/audit-display.ts#L256) |
| `audit-display.0b7ae9a1` | 写死 | 品类 | 文字 | [audit-display.ts:259](../../apps/web/src/lib/audit-display.ts#L259) |
| `audit-display.6dbfcd99` | 写死 | 库存模式 | 文字 | [audit-display.ts:260](../../apps/web/src/lib/audit-display.ts#L260) |
| `audit-display.09023dff` | 写死 | 取整单位 | 文字 | [audit-display.ts:261](../../apps/web/src/lib/audit-display.ts#L261) |
| `audit-display.30625e85` | 写死 | 版本号 | 文字 | [audit-display.ts:262](../../apps/web/src/lib/audit-display.ts#L262) |
| `audit-display.27006714` | 写死 | 项目 | 文字 | [audit-display.ts:263](../../apps/web/src/lib/audit-display.ts#L263) |
| `audit-display.907b478b` | 写死 | 数量 | 文字 | [audit-display.ts:264](../../apps/web/src/lib/audit-display.ts#L264) |
| `audit-display.d78d54c0` | 写死 | 类型 | 文字 | [audit-display.ts:265](../../apps/web/src/lib/audit-display.ts#L265) |
| `audit-display.05c4d8f5` | 写死 | 优先级 | 文字 | [audit-display.ts:267](../../apps/web/src/lib/audit-display.ts#L267) |
| `audit-display.73ed7a37` | 写死 | 处理人 | 文字 | [audit-display.ts:268](../../apps/web/src/lib/audit-display.ts#L268) |
| `audit-display.b3ca5121` | 写死 | 工单号 | 文字 | [audit-display.ts:269](../../apps/web/src/lib/audit-display.ts#L269) |
| `audit-display.3f8c1a6d` | 写死 | 结论 | 文字 | [audit-display.ts:270](../../apps/web/src/lib/audit-display.ts#L270) |
| `audit-display.4212a593` | 写死 | 责任方 | 文字 | [audit-display.ts:271](../../apps/web/src/lib/audit-display.ts#L271) |
| `audit-display.5d695f19` | 写死 | 说明 | 说明 | [audit-display.ts:272](../../apps/web/src/lib/audit-display.ts#L272) |
| `audit-display.061aec17` | 写死 | 内容 | 邮件正文 | [audit-display.ts:273](../../apps/web/src/lib/audit-display.ts#L273) |
| `audit-display.d2aebff7` | 写死 | 处理说明 | 文字 | [audit-display.ts:275](../../apps/web/src/lib/audit-display.ts#L275) |
| `audit-display.07023b32` | 写死 | 凭证号 | 文字 | [audit-display.ts:276](../../apps/web/src/lib/audit-display.ts#L276) |
| `audit-display.5e857c21` | 写死 | 账单号 | 文字 | [audit-display.ts:277](../../apps/web/src/lib/audit-display.ts#L277) |
| `audit-display.baaa1549` | 写死 | 周期 | 文字 | [audit-display.ts:278](../../apps/web/src/lib/audit-display.ts#L278) |
| `audit-display.9b33c777` | 写死 | 所在国家 | 文字 | [audit-display.ts:279](../../apps/web/src/lib/audit-display.ts#L279) |
| `audit-display.204c0248` | 写死 | 法定名称 | 名称 | [audit-display.ts:280](../../apps/web/src/lib/audit-display.ts#L280) |
| `audit-display.3a8f8444` | 写死 | 登记号 | 文字 | [audit-display.ts:281](../../apps/web/src/lib/audit-display.ts#L281) |
| `audit-display.26a20d93` | 写死 | 注册地址 | 文字 | [audit-display.ts:282](../../apps/web/src/lib/audit-display.ts#L282) |
| `audit-display.621e18d0` | 写死 | 联系人 | 名称 | [audit-display.ts:283](../../apps/web/src/lib/audit-display.ts#L283) |
| `audit-display.c97c3b35` | 写死 | 联系电话 | 文字 | [audit-display.ts:284](../../apps/web/src/lib/audit-display.ts#L284) |
| `audit-display.91ded7b3` | 写死 | 联系邮箱 | 文字 | [audit-display.ts:285](../../apps/web/src/lib/audit-display.ts#L285) |
| `audit-display.2985fdb1` | 写死 | 摘要 | 说明 | [audit-display.ts:290](../../apps/web/src/lib/audit-display.ts#L290) |
| `audit-display.39fa7361` | 写死 | 申请的内容 | 文字 | [audit-display.ts:290](../../apps/web/src/lib/audit-display.ts#L290) |
| `audit-display.49fc9441` | 写死 | 复核对象的编号 | 文字 | [audit-display.ts:290](../../apps/web/src/lib/audit-display.ts#L290) |
| `audit-display.9ad78f24` | 写死 | 复核类别 | 文字 | [audit-display.ts:290](../../apps/web/src/lib/audit-display.ts#L290) |
| `audit-display.9dfb9974` | 写死 | 复核对象的类型 | 文字 | [audit-display.ts:290](../../apps/web/src/lib/audit-display.ts#L290) |
| `audit-display.e4574c4f` | 写死 | 用途 | 文字 | [audit-display.ts:292](../../apps/web/src/lib/audit-display.ts#L292) |
| `audit-display.55f22837` | 写死 | 已暂停 | 文字 | [audit-display.ts:303](../../apps/web/src/lib/audit-display.ts#L303) |
| `audit-display.f97c1f14` | 写死 | 正常 | 文字 | [audit-display.ts:303](../../apps/web/src/lib/audit-display.ts#L303) |
| `audit-display.5ac0c429` | 写死 | 租户 | 文字 | [audit-display.ts:304](../../apps/web/src/lib/audit-display.ts#L304) |
| `audit-display.1dc5c234` | 写死 | 已付款 | 文字 | [audit-display.ts:307](../../apps/web/src/lib/audit-display.ts#L307)、308 行 |
| `audit-display.2db8c76d` | 写死 | 收账单中 | 文字 | [audit-display.ts:307](../../apps/web/src/lib/audit-display.ts#L307) |
| `audit-display.5780a037` | 写死 | 已锁定 | 文字 | [audit-display.ts:307](../../apps/web/src/lib/audit-display.ts#L307) |
| `audit-display.8afc30ca` | 写死 | 已生成 | 文字 | [audit-display.ts:308](../../apps/web/src/lib/audit-display.ts#L308) |
| `audit-display.e073142c` | 写死 | 已下载 | 文字 | [audit-display.ts:308](../../apps/web/src/lib/audit-display.ts#L308) |
| `audit-display.eb664e60` | 写死 | 已作废 | 文字 | [audit-display.ts:308](../../apps/web/src/lib/audit-display.ts#L308) |
| `audit-display.39c73f95` | 写死 | 已撤回 | 文字 | [audit-display.ts:309](../../apps/web/src/lib/audit-display.ts#L309)、310 行 |
| `audit-display.8403a542` | 写死 | 已被替换 | 文字 | [audit-display.ts:309](../../apps/web/src/lib/audit-display.ts#L309) |
| `audit-display.de970ffa` | 写死 | 待审核 | 文字 | [audit-display.ts:309](../../apps/web/src/lib/audit-display.ts#L309)、310 行 |
| `audit-display.e3f14ea8` | 写死 | 已驳回 | 文字 | [audit-display.ts:309](../../apps/web/src/lib/audit-display.ts#L309)、310 行 |
| `audit-display.f7c85404` | 写死 | 生效中 | 文字 | [audit-display.ts:309](../../apps/web/src/lib/audit-display.ts#L309) |
| `audit-display.083532ee` | 写死 | 已生效 | 文字 | [audit-display.ts:310](../../apps/web/src/lib/audit-display.ts#L310) |
| `audit-display.204d212c` | 写死 | 待激活 | 文字 | [audit-display.ts:313](../../apps/web/src/lib/audit-display.ts#L313) |
| `audit-display.4141fe64` | 写死 | 已停用 | 文字 | [audit-display.ts:313](../../apps/web/src/lib/audit-display.ts#L313)、315 行 |
| `audit-display.8c876645` | 写死 | 在用 | 文字 | [audit-display.ts:313](../../apps/web/src/lib/audit-display.ts#L313) |
| `audit-display.9fdae6c7` | 写死 | 限量 | 文字 | [audit-display.ts:321](../../apps/web/src/lib/audit-display.ts#L321) |
| `audit-display.de32caea` | 写死 | 不限量 | 文字 | [audit-display.ts:321](../../apps/web/src/lib/audit-display.ts#L321) |
| `audit-display.b16aae97` | 写死 | （空） | 文字 | [audit-display.ts:339](../../apps/web/src/lib/audit-display.ts#L339) |
| `audit-display.84df4d8a` | 写死 | 是 | 文字 | [audit-display.ts:340](../../apps/web/src/lib/audit-display.ts#L340) |
| `audit-display.b331610c` | 写死 | 否 | 文字 | [audit-display.ts:340](../../apps/web/src/lib/audit-display.ts#L340) |

## 多个页面共用：运营后台「人工报价」「官网设置」的地址、状态徽标和文字（manual-quote-display.ts）

用在：运营后台 · 人工报价；运营后台 · 官网设置

文件：`apps/web/src/lib/manual-quote-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `manual-quote-display.42dba88e` | 写死 | 已清除联系方式 | 名称 | [manual-quote-display.ts:26](../../apps/web/src/lib/manual-quote-display.ts#L26) |
| `manual-quote-display.3dba82e6` | 写死 | 验收 | 名称 | [manual-quote-display.ts:29](../../apps/web/src/lib/manual-quote-display.ts#L29) |
| `manual-quote-display.e64eb918` | 写死 | 包车 {package\_hours} 小时 | 文字 | [manual-quote-display.ts:43](../../apps/web/src/lib/manual-quote-display.ts#L43) |
| `manual-quote-display.3dea2612` | 写死 | 城市未识别 | 文字 | [manual-quote-display.ts:44](../../apps/web/src/lib/manual-quote-display.ts#L44) |
| `manual-quote-display.56226edf` | 写死 | {category} · {city} · {…}（当地）· {passengers} 人 {luggage} 件行李 | 文字 | [manual-quote-display.ts:45](../../apps/web/src/lib/manual-quote-display.ts#L45) |
| `manual-quote-display.d3ecf153` | 写死 | 邮箱 | 文字 | [manual-quote-display.ts:50](../../apps/web/src/lib/manual-quote-display.ts#L50) |
| `manual-quote-display.f13a69c2` | 写死 | 客人提交 | 文字 | [manual-quote-display.ts:56](../../apps/web/src/lib/manual-quote-display.ts#L56) |
| `manual-quote-display.ad952a5b` | 写死 | 状态：{…} → {…} | 文字 | [manual-quote-display.ts:57](../../apps/web/src/lib/manual-quote-display.ts#L57) |
| `manual-quote-display.01b6ad7d` | 写死 | 取消指派 | 文字 | [manual-quote-display.ts:58](../../apps/web/src/lib/manual-quote-display.ts#L58) |
| `manual-quote-display.685ddf66` | 写死 | 指派给「{name}」 | 文字 | [manual-quote-display.ts:58](../../apps/web/src/lib/manual-quote-display.ts#L58) |
| `manual-quote-display.8cbf7513` | 写死 | 备注 | 文字 | [manual-quote-display.ts:59](../../apps/web/src/lib/manual-quote-display.ts#L59) |
| `manual-quote-display.2377dc5c` | 写死 | 您好，这里是 NOZOMI 用车的客服，关于您的用车报价申请（{requestNo}）： | 文字 | [manual-quote-display.ts:69](../../apps/web/src/lib/manual-quote-display.ts#L69) |
| `manual-quote-display.3e171a17` | 写死 | 填带国家码的号码，如 +81 开头的日本号码；可以有空格、连字符。保存后官网报不出价时显示「通过 WhatsApp 联系我们」，清空就不显示。 | 说明 | [manual-quote-display.ts:77](../../apps/web/src/lib/manual-quote-display.ts#L77) |
| `manual-quote-display.4664d98e` | 写死 | 号码的格式不对：要带国家码（不以 0 开头），共 8 到 15 位数字，如 +81 开头的日本号码 | 提示 | [manual-quote-display.ts:78](../../apps/web/src/lib/manual-quote-display.ts#L78) |
| `manual-quote-display.328b1c38` | 写死 | 一车到底 | 文字 | [manual-quote-display.ts:81](../../apps/web/src/lib/manual-quote-display.ts#L81) |
| `manual-quote-display.ffd67ff7` | 写死 | 每天各自最优 | 文字 | [manual-quote-display.ts:81](../../apps/web/src/lib/manual-quote-display.ts#L81) |
| `manual-quote-display.04373986` | 写死 | 送机 | 文字 | [manual-quote-display.ts:84](../../apps/web/src/lib/manual-quote-display.ts#L84) |
| `manual-quote-display.31ca2464` | 写死 | 接机 | 文字 | [manual-quote-display.ts:84](../../apps/web/src/lib/manual-quote-display.ts#L84) |
| `manual-quote-display.94c9e204` | 写死 | 出发 | 文字 | [manual-quote-display.ts:84](../../apps/web/src/lib/manual-quote-display.ts#L84) |
| `manual-quote-display.a4b56dab` | 写死 | 结束 | 文字 | [manual-quote-display.ts:84](../../apps/web/src/lib/manual-quote-display.ts#L84) |
| `manual-quote-display.ccb58a99` | 写死 | 经停 | 文字 | [manual-quote-display.ts:84](../../apps/web/src/lib/manual-quote-display.ts#L84) |
| `manual-quote-display.d94c8372` | 写死 | 没有供应商能报这一段 | 文字 | [manual-quote-display.ts:88](../../apps/web/src/lib/manual-quote-display.ts#L88) |
| `manual-quote-display.d32d4933` | 写死 | 地点不在任何供应商的服务区域里 | 文字 | [manual-quote-display.ts:89](../../apps/web/src/lib/manual-quote-display.ts#L89) |
| `manual-quote-display.0e1e9b02` | 写死 | 行程跨城市，一车到底报不了 | 文字 | [manual-quote-display.ts:90](../../apps/web/src/lib/manual-quote-display.ts#L90) |
| `manual-quote-display.817a466a` | 写死 | 没有一家供应商能用同一辆车跑完全程 | 文字 | [manual-quote-display.ts:91](../../apps/web/src/lib/manual-quote-display.ts#L91) |
| `manual-quote-display.08757c33` | 写死 | 查不到路线 | 文字 | [manual-quote-display.ts:92](../../apps/web/src/lib/manual-quote-display.ts#L92) |
| `manual-quote-display.fc647b9b` | 写死 | 供应商没设司机住宿费 | 文字 | [manual-quote-display.ts:93](../../apps/web/src/lib/manual-quote-display.ts#L93) |
| `manual-quote-display.21602e52` | 写死 | 供应商没设第二司机费 | 文字 | [manual-quote-display.ts:94](../../apps/web/src/lib/manual-quote-display.ts#L94) |
| `manual-quote-display.791a7de8` | 写死 | 供应商没设跨段费用 | 文字 | [manual-quote-display.ts:95](../../apps/web/src/lib/manual-quote-display.ts#L95) |
| `manual-quote-display.99b7bea4` | 写死 | 超过司机工时上限 | 文字 | [manual-quote-display.ts:96](../../apps/web/src/lib/manual-quote-display.ts#L96) |
| `manual-quote-display.792e5d14` | 写死 | 第 {…} 天：{reason} | 文字 | [manual-quote-display.ts:101](../../apps/web/src/lib/manual-quote-display.ts#L101) |

## 多个页面共用：一次性链接（one-time-link.ts）

用在：运营后台 · 供应商（列表、新建、详情）；运营后台 · 平台员工

文件：`apps/web/src/lib/one-time-link.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `one-time-link.27f8696d` | 写死 | 7 天 | 文字 | [one-time-link.ts:27](../../apps/web/src/lib/one-time-link.ts#L27) |
| `one-time-link.574784cf` | 写死 | 24 小时 | 文字 | [one-time-link.ts:27](../../apps/web/src/lib/one-time-link.ts#L27) |
| `one-time-link.2e9ca1c0` | 写死 | 有效期到 {at}（{span}），只能用一次。 | 文字 | [one-time-link.ts:29](../../apps/web/src/lib/one-time-link.ts#L29) |
| `one-time-link.58cf96fc` | 写死 | 重置 | 文字 | [one-time-link.ts:29](../../apps/web/src/lib/one-time-link.ts#L29) |
| `one-time-link.c2350f1d` | 写死 | 有效期：{…} {span}，只能用一次。 | 文字 | [one-time-link.ts:29](../../apps/web/src/lib/one-time-link.ts#L29) |
| `one-time-link.cce9259c` | 写死 | 邀请 | 文字 | [one-time-link.ts:29](../../apps/web/src/lib/one-time-link.ts#L29) |
| `one-time-link.0bc0f7b9` | 写死 | {name}，你好： | 提示 | [one-time-link.ts:36](../../apps/web/src/lib/one-time-link.ts#L36) |
| `one-time-link.41fbaf2d` | 写死 | 这是 NOZOMI {name}的{…}链接，请在 {…}{…}打开，设置你自己的密码： | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.5721ff88` | 写死 | 账号开通 | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.6b400471` | 写死 |  前 | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.c5b82803` | 写死 | 密码重置 | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.c88718f3` | 写死 | 7 天内 | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.d1b2c8ad` | 写死 | 24 小时内 | 提示 | [one-time-link.ts:37](../../apps/web/src/lib/one-time-link.ts#L37) |
| `one-time-link.72326a10` | 写死 | 链接只能用一次，请不要转发给别人。登录邮箱：{email} | 提示 | [one-time-link.ts:39](../../apps/web/src/lib/one-time-link.ts#L39) |

## 多个页面共用：路线预估（route-display.ts）

用在：运营后台 · 报价试算；运营后台 · 系统设置（审计日志、系统状态）

文件：`apps/web/src/lib/route-display.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `route-display.29199a0e` | 写死 | 谷歌地图的密钥没有配置。请超级管理员在「系统设置 → 系统状态 → 第三方密钥」填写。 | 文字 | [route-display.ts:11](../../apps/web/src/lib/route-display.ts#L11) |
| `route-display.28b64016` | 写死 | 今天调用谷歌地图的次数到了每日上限。今天的里程计价暂停，明天自动恢复；可在服务器配置 GOOGLE\_ROUTES\_DAILY\_LIMIT 调整。 | 文字 | [route-display.ts:12](../../apps/web/src/lib/route-display.ts#L12) |
| `route-display.dc0b922f` | 写死 | 谷歌地图的密钥无效。请在「系统设置 → 系统状态 → 第三方密钥」核对或更换。 | 提示 | [route-display.ts:13](../../apps/web/src/lib/route-display.ts#L13) |
| `route-display.c78d3ad5` | 写死 | 谷歌云项目没有启用 Routes API。请在谷歌云控制台给这个项目启用 Routes API。 | 文字 | [route-display.ts:14](../../apps/web/src/lib/route-display.ts#L14) |
| `route-display.3c796870` | 写死 | 谷歌地图的密钥设了限制，不允许这台服务器调用 Routes API。请在谷歌云控制台放开这把密钥对 Routes API 和服务器地址的限制。 | 文字 | [route-display.ts:15](../../apps/web/src/lib/route-display.ts#L15) |
| `route-display.8867b5a0` | 写死 | 谷歌云项目没有绑定付款方式。请在谷歌云控制台给项目绑定结算账号。 | 文字 | [route-display.ts:16](../../apps/web/src/lib/route-display.ts#L16) |
| `route-display.d9c8fddd` | 写死 | 谷歌拒绝了这次调用（权限不够）。请在谷歌云控制台检查这把密钥和项目的权限。 | 文字 | [route-display.ts:17](../../apps/web/src/lib/route-display.ts#L17) |
| `route-display.84e71514` | 写死 | 谷歌地图的用量超过了谷歌云项目的配额，或被限流。稍后会自动重试；经常出现请在谷歌云控制台调高配额。 | 文字 | [route-display.ts:18](../../apps/web/src/lib/route-display.ts#L18) |
| `route-display.af4190b9` | 写死 | 谷歌地图在时限内没有应答。通常过一会儿自己恢复；一直这样请检查服务器的网络。 | 文字 | [route-display.ts:19](../../apps/web/src/lib/route-display.ts#L19) |
| `route-display.fe5519f1` | 写死 | 服务器连不上谷歌地图（网络不通）。请检查服务器的网络和防火墙。 | 文字 | [route-display.ts:20](../../apps/web/src/lib/route-display.ts#L20) |
| `route-display.22daccd6` | 写死 | 谷歌地图暂时出错，或今天的调用次数没有记上。通常过一会儿自己恢复，请稍后再试。 | 文字 | [route-display.ts:21](../../apps/web/src/lib/route-display.ts#L21) |
| `route-display.a497aa1b` | 写死 | 谷歌地图的应答看不懂。偶尔一次可以不管；一直这样请联系技术查看服务器日志。 | 文字 | [route-display.ts:22](../../apps/web/src/lib/route-display.ts#L22) |
| `route-display.3fb553c0` | 写死 | 谷歌地图认为起点或终点无效。请检查坐标（纬度在前、经度在后）是不是填反了或不在陆地上。 | 提示 | [route-display.ts:23](../../apps/web/src/lib/route-display.ts#L23) |
| `route-display.b4d2e6f3` | 写死 | 这两个地点之间没有可行驶的路线（例如隔着海）。请换一组地点。 | 文字 | [route-display.ts:24](../../apps/web/src/lib/route-display.ts#L24) |
| `route-display.266df0ea` | 写死 | 谷歌地图没有给出路线。请稍后再试。 | 提示 | [route-display.ts:29](../../apps/web/src/lib/route-display.ts#L29) |
| `route-display.d9c42940` | 写死 | 来自缓存，这次没有调用谷歌地图 | 文字 | [route-display.ts:33](../../apps/web/src/lib/route-display.ts#L33) |
| `route-display.62abf3ab` | 写死 | 刚调用谷歌地图查到的 | 文字 | [route-display.ts:34](../../apps/web/src/lib/route-display.ts#L34) |
| `route-display.9087ce51` | 写死 | 起点和终点几乎重合，按 0 计算，没有调用谷歌地图 | 文字 | [route-display.ts:35](../../apps/web/src/lib/route-display.ts#L35) |
| `route-display.03d22173` | 写死 | 已到每日上限 | 名称 | [route-display.ts:51](../../apps/web/src/lib/route-display.ts#L51) |
| `route-display.1fcd4c6c` | 写死 | 最近一次失败 | 名称 | [route-display.ts:54](../../apps/web/src/lib/route-display.ts#L54) |
| `route-display.800765dc` | 写死 | 还没有调用过 | 名称 | [route-display.ts:55](../../apps/web/src/lib/route-display.ts#L55) |
| `route-display.cde39fac` | 写死 | 正常 | 名称 | [route-display.ts:56](../../apps/web/src/lib/route-display.ts#L56) |

## 多个页面共用：use-city-options.ts

用在：运营后台 · 商品（只读查看）；运营后台 · 待审核；运营后台 · 报价试算；运营后台 · 渠道；运营后台 · 订单（列表、详情）；运营后台 · 账号安全和角色

文件：`apps/web/src/lib/use-city-options.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `use-city-options.fbae43c2` | 写死 | 你的角色不能查看城市，请联系管理员调整角色的权限。 | 空状态 | [use-city-options.ts:24](../../apps/web/src/lib/use-city-options.ts#L24) |
| `use-city-options.ae9a9c00` | 写死 | 你的数据范围里没有城市。需要的话，请联系管理员调整你的角色的数据范围。 | 空状态 | [use-city-options.ts:25](../../apps/web/src/lib/use-city-options.ts#L25) |
| `use-city-options.bf824357` | 写死 | 你的数据范围里没有启用中的城市。需要的话，请联系管理员调整你的角色的数据范围。 | 空状态 | [use-city-options.ts:25](../../apps/web/src/lib/use-city-options.ts#L25) |
| `use-city-options.a897cd33` | 写死 | 平台还没有启用中的城市 | 空状态 | [use-city-options.ts:26](../../apps/web/src/lib/use-city-options.ts#L26) |
| `use-city-options.e21f7080` | 写死 | 平台还没有城市 | 空状态 | [use-city-options.ts:26](../../apps/web/src/lib/use-city-options.ts#L26) |
| `use-city-options.a4c1eeb7` | 写死 | {name}（已停用） | 名称 | [use-city-options.ts:62](../../apps/web/src/lib/use-city-options.ts#L62) |
| `use-city-options.7af37850` | 写死 | 已停用 | 提示 | [use-city-options.ts:67](../../apps/web/src/lib/use-city-options.ts#L67) |
| `use-city-options.c222af8d` | 写死 | 不在你的数据范围里 | 提示 | [use-city-options.ts:67](../../apps/web/src/lib/use-city-options.ts#L67) |
| `use-city-options.cee53ff7` | 写死 | （名称没有取到） | 名称 | [use-city-options.ts:68](../../apps/web/src/lib/use-city-options.ts#L68) |

## 多个页面共用：use-colleagues.ts

用在：运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 财务结算（账单、付款批次）

文件：`apps/web/src/lib/use-colleagues.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `use-colleagues.887ce466` | 写死 | {name}（已停用） | 文字 | [use-colleagues.ts:16](../../apps/web/src/lib/use-colleagues.ts#L16) |

## 多个页面共用：四个表单共用的校验和小部件（forms-common.tsx）

用在：运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据 · 车型组和附加服务；运营后台 · 处理导入的机场

文件：`apps/web/src/pages/master/forms-common.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `forms-common.a5c002e7` | 写死 | 至少填一种语言 | 文字 | [forms-common.tsx:19](../../apps/web/src/pages/master/forms-common.tsx#L19) |
| `forms-common.6e549508` | 写死 | {language}{label}最多 {maxLength} 个字 | 文字 | [forms-common.tsx:21](../../apps/web/src/pages/master/forms-common.tsx#L21) |
| `forms-common.7ec95816` | 写死 | 删除第 {…} 个{itemName} | 读屏说明 | [forms-common.tsx:120](../../apps/web/src/pages/master/forms-common.tsx#L120) |
| `forms-common.eea20215` | 写死 | 至少保留一个 | 标题 | [forms-common.tsx:121](../../apps/web/src/pages/master/forms-common.tsx#L121) |
| `forms-common.b05c00c6` | 写死 | 添加{itemName} | 按钮 | [forms-common.tsx:151](../../apps/web/src/pages/master/forms-common.tsx#L151) |
| `forms-common.4ffeeee1` | 写死 | 最多 {max} 个 | 正文 | [forms-common.tsx:153](../../apps/web/src/pages/master/forms-common.tsx#L153) |

## 多个页面共用：四类主数据的列表页、表单页共用的小部件和取数（shared.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域编辑；供应商后台 · 商品列表；供应商后台 · 商品编辑；供应商后台 · 工单；运营后台 · 主数据 · 地点；运营后台 · 主数据 · 城市；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）；运营后台 · 人工报价；运营后台 · 商品（只读查看）；运营后台 · 处理导入的机场；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 未覆盖需求；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）

文件：`apps/web/src/pages/master/shared.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `shared.52ca5318` | 写死 | 系统暂时无法{action}，请稍后再试。 | 提示 | [shared.tsx:100](../../apps/web/src/pages/master/shared.tsx#L100) |
| `shared.64db2e93` | 写死 | 网络连接失败，请检查网络后重试。 | 提示 | [shared.tsx:100](../../apps/web/src/pages/master/shared.tsx#L100) |
| `shared.c9512daf` | 写死 | 你没有权限修改主数据。需要的话，请联系管理员开通。 | 文字 | [shared.tsx:107](../../apps/web/src/pages/master/shared.tsx#L107) |

## 多个页面共用：停用（useStatusToggle.tsx）

用在：运营后台 · 主数据 · 地点；运营后台 · 主数据列表（城市、地点、车型组、附加服务）；运营后台 · 主数据编辑（共用表单）

文件：`apps/web/src/pages/master/useStatusToggle.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `useStatusToggle.5e760df0` | 写死 | 已停用「{…}」 | 提示 | [useStatusToggle.tsx:69](../../apps/web/src/pages/master/useStatusToggle.tsx#L69) |
| `useStatusToggle.dd957b09` | 写死 | 还有 {count} 个启用中的下级在用它，请先停用它们。 | 文字 | [useStatusToggle.tsx:74](../../apps/web/src/pages/master/useStatusToggle.tsx#L74) |
| `useStatusToggle.c381cf9c` | 写死 | 停用 | 文字 | [useStatusToggle.tsx:78](../../apps/web/src/pages/master/useStatusToggle.tsx#L78)、126 行 |
| `useStatusToggle.7786e564` | 写死 | 已启用「{…}」 | 提示 | [useStatusToggle.tsx:90](../../apps/web/src/pages/master/useStatusToggle.tsx#L90) |
| `useStatusToggle.3e7c625a` | 写死 | 「{code} {text}」现在还不能启用。 | 文字 | [useStatusToggle.tsx:94](../../apps/web/src/pages/master/useStatusToggle.tsx#L94) |
| `useStatusToggle.107ae8de` | 写死 | 启用 | 文字 | [useStatusToggle.tsx:98](../../apps/web/src/pages/master/useStatusToggle.tsx#L98) |
| `useStatusToggle.b3a671e4` | 写死 | 启用「{text}」没有成功。{…} | 文字 | [useStatusToggle.tsx:98](../../apps/web/src/pages/master/useStatusToggle.tsx#L98) |
| `useStatusToggle.07f01cf7` | 写死 | 停用{…}「{text}」？ | 标题 | [useStatusToggle.tsx:110](../../apps/web/src/pages/master/useStatusToggle.tsx#L110) |
| `useStatusToggle.98de4919` | 写死 | 知道了 | 按钮 | [useStatusToggle.tsx:118](../../apps/web/src/pages/master/useStatusToggle.tsx#L118)、165 行 |
| `useStatusToggle.caabaaa6` | 写死 | 取消 | 按钮 | [useStatusToggle.tsx:123](../../apps/web/src/pages/master/useStatusToggle.tsx#L123) |
| `useStatusToggle.652d859b` | 写死 | 停用中… | 文字 | [useStatusToggle.tsx:124](../../apps/web/src/pages/master/useStatusToggle.tsx#L124) |
| `useStatusToggle.6ef88152` | 写死 | 现在不能停用。 | 正文 | [useStatusToggle.tsx:134](../../apps/web/src/pages/master/useStatusToggle.tsx#L134) |
| `useStatusToggle.52fce540` | 写死 | 停用没有成功。{…} | 提示 | [useStatusToggle.tsx:145](../../apps/web/src/pages/master/useStatusToggle.tsx#L145) |
| `useStatusToggle.8ae9150e` | 写死 | 停用后，供应商的选项里不再出现{…}；已经引用它的内容仍然查得到。之后可以重新启用。 | 正文 | [useStatusToggle.tsx:148](../../apps/web/src/pages/master/useStatusToggle.tsx#L148) |

## 多个页面共用：渠道详情的各个分区（ChannelSections.tsx）

用在：运营后台 · 待审核；运营后台 · 渠道

文件：`apps/web/src/pages/platform/ChannelSections.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ChannelSections.148dd996` | 写死 | 已提交审核：另一位有审核权限的同事批准后才生效。可以在「待审核」里看进度。 | 文字 | [ChannelSections.tsx:58](../../apps/web/src/pages/platform/ChannelSections.tsx#L58) |
| `ChannelSections.348d9b2d` | 写死 | 提交的内容不符合要求，请检查后重试。 | 提示 | [ChannelSections.tsx:65](../../apps/web/src/pages/platform/ChannelSections.tsx#L65) |
| `ChannelSections.e65042d7` | 写死 | 同一组维度上已经有一条规则：不带日期的只能有一条，带日期的日期范围不能重叠。请改那一条，或换个日期范围。 | 提示 | [ChannelSections.tsx:67](../../apps/web/src/pages/platform/ChannelSections.tsx#L67) |
| `ChannelSections.f70fc239` | 写死 | 这条记录刚被别人改过。请关掉对话框、刷新页面后再试。 | 提示 | [ChannelSections.tsx:69](../../apps/web/src/pages/platform/ChannelSections.tsx#L69) |
| `ChannelSections.b0ef2a30` | 写死 | 你没有权限做这个操作。需要的话，请联系管理员开通。 | 提示 | [ChannelSections.tsx:71](../../apps/web/src/pages/platform/ChannelSections.tsx#L71) |
| `ChannelSections.89ca0055` | 写死 | 这个渠道已经有 {length} 条待审核的定价改动： | 正文 | [ChannelSections.tsx:104](../../apps/web/src/pages/platform/ChannelSections.tsx#L104) |
| `ChannelSections.8c396f91` | 写死 | {…}（{name}，{…} 发起） | 正文 | [ChannelSections.tsx:107](../../apps/web/src/pages/platform/ChannelSections.tsx#L107) |
| `ChannelSections.b3db82fd` | 写死 | 它们和这次的改动谁先被批准，另外的就会过时，只能驳回后按现在的数重新发起。要改的是同一处的话，建议先到「待审核」撤回旧的，或等它处理完再发起。 | 正文 | [ChannelSections.tsx:110](../../apps/web/src/pages/platform/ChannelSections.tsx#L110) |
| `ChannelSections.647397ec` | 写死 | 请选择供应商 | 文字 | [ChannelSections.tsx:146](../../apps/web/src/pages/platform/ChannelSections.tsx#L146) |
| `ChannelSections.d32ed71d` | 写死 | 请选择城市 | 文字 | [ChannelSections.tsx:147](../../apps/web/src/pages/platform/ChannelSections.tsx#L147) |
| `ChannelSections.494b17f3` | 写死 | 请选择品类 | 文字 | [ChannelSections.tsx:148](../../apps/web/src/pages/platform/ChannelSections.tsx#L148) |
| `ChannelSections.fa8177ee` | 写死 | 请选择车型组 | 文字 | [ChannelSections.tsx:149](../../apps/web/src/pages/platform/ChannelSections.tsx#L149) |
| `ChannelSections.fb38ef70` | 写死 | 请填百分比，最多两位小数，例如 12.5 | 文字 | [ChannelSections.tsx:151](../../apps/web/src/pages/platform/ChannelSections.tsx#L151) |
| `ChannelSections.846876bf` | 写死 | 不能低于这个渠道的加价下限 {…} | 文字 | [ChannelSections.tsx:152](../../apps/web/src/pages/platform/ChannelSections.tsx#L152) |
| `ChannelSections.5fb9c092` | 写死 | 日期写成 2026-10-01 | 文字 | [ChannelSections.tsx:154](../../apps/web/src/pages/platform/ChannelSections.tsx#L154) |
| `ChannelSections.54b07bd5` | 写死 | 日期写成 2026-10-07 | 文字 | [ChannelSections.tsx:155](../../apps/web/src/pages/platform/ChannelSections.tsx#L155) |
| `ChannelSections.e7c39a24` | 写死 | 结束日期不能早于开始日期 | 文字 | [ChannelSections.tsx:156](../../apps/web/src/pages/platform/ChannelSections.tsx#L156) |
| `ChannelSections.52949f1d` | 写死 | 全渠道的规则要带日期范围（不带日期的全渠道比例就是默认加价比例） | 文字 | [ChannelSections.tsx:157](../../apps/web/src/pages/platform/ChannelSections.tsx#L157) |
| `ChannelSections.bcb8ff49` | 写死 | {label}（渠道没有授权） | 名称 | [ChannelSections.tsx:185](../../apps/web/src/pages/platform/ChannelSections.tsx#L185) |
| `ChannelSections.1cbfb6ae` | 写死 | 请选择 | 文字 | [ChannelSections.tsx:208](../../apps/web/src/pages/platform/ChannelSections.tsx#L208)、214、265 行 |
| `ChannelSections.7c99ce9a` | 写死 | （名称没有取到） | 文字 | [ChannelSections.tsx:216](../../apps/web/src/pages/platform/ChannelSections.tsx#L216)、953、957 行 |
| `ChannelSections.9e7f60e9` | 写死 | {…}（已停用） | 文字 | [ChannelSections.tsx:216](../../apps/web/src/pages/platform/ChannelSections.tsx#L216) |
| `ChannelSections.72f32583` | 写死 | 提交 | 文字 | [ChannelSections.tsx:231](../../apps/web/src/pages/platform/ChannelSections.tsx#L231)、332、864、884 行 |
| `ChannelSections.eb218299` | 写死 | 新增加价规则 | 标题 | [ChannelSections.tsx:237](../../apps/web/src/pages/platform/ChannelSections.tsx#L237)、788 行 |
| `ChannelSections.edc7161f` | 写死 | 修改加价规则 | 标题 | [ChannelSections.tsx:237](../../apps/web/src/pages/platform/ChannelSections.tsx#L237) |
| `ChannelSections.fdeba778` | 写死 | 取消 | 按钮 | [ChannelSections.tsx:239](../../apps/web/src/pages/platform/ChannelSections.tsx#L239)、342、394、574、587 行 |
| `ChannelSections.79c204b3` | 写死 | 提交审核 | 按钮 | [ChannelSections.tsx:240](../../apps/web/src/pages/platform/ChannelSections.tsx#L240)、343、853、873 行 |
| `ChannelSections.d3911e93` | 写死 | 提交中… | 文字 | [ChannelSections.tsx:240](../../apps/web/src/pages/platform/ChannelSections.tsx#L240)、343 行 |
| `ChannelSections.ecc56317` | 写死 | 从具体到通用匹配，命中第一级就停。提交后要另一位同事批准才生效。 | 正文 | [ChannelSections.tsx:246](../../apps/web/src/pages/platform/ChannelSections.tsx#L246) |
| `ChannelSections.73221951` | 写死 | 第 {level} 级：{…} | 名称 | [ChannelSections.tsx:247](../../apps/web/src/pages/platform/ChannelSections.tsx#L247) |
| `ChannelSections.9682e39f` | 写死 | 按什么设 | 标题 | [ChannelSections.tsx:247](../../apps/web/src/pages/platform/ChannelSections.tsx#L247) |
| `ChannelSections.c3df2297` | 写死 | 供应商 | 名称 | [ChannelSections.tsx:248](../../apps/web/src/pages/platform/ChannelSections.tsx#L248) |
| `ChannelSections.76e83eb6` | 写死 | 城市 | 名称 | [ChannelSections.tsx:252](../../apps/web/src/pages/platform/ChannelSections.tsx#L252) |
| `ChannelSections.c24014fd` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [ChannelSections.tsx:256](../../apps/web/src/pages/platform/ChannelSections.tsx#L256) |
| `ChannelSections.b66658f3` | 写死 | 这个渠道授权的城市都已停用 | 空状态 | [ChannelSections.tsx:257](../../apps/web/src/pages/platform/ChannelSections.tsx#L257) |
| `ChannelSections.f05d901b` | 写死 | 这个渠道授权的城市都已停用，或不在你的数据范围里 | 空状态 | [ChannelSections.tsx:257](../../apps/web/src/pages/platform/ChannelSections.tsx#L257) |
| `ChannelSections.66cd56d7` | 写死 | 这个渠道可以卖全部城市，这里列出你的数据范围里启用中的城市。 | 说明 | [ChannelSections.tsx:261](../../apps/web/src/pages/platform/ChannelSections.tsx#L261) |
| `ChannelSections.d2160787` | 写死 | 里你的数据范围内的 | 说明 | [ChannelSections.tsx:261](../../apps/web/src/pages/platform/ChannelSections.tsx#L261) |
| `ChannelSections.d8a7a66e` | 写死 | 只列这个渠道授权卖的 {length} 个城市{…}。要加别的城市，先在「编辑基本信息和授权范围」里授权。 | 说明 | [ChannelSections.tsx:261](../../apps/web/src/pages/platform/ChannelSections.tsx#L261) |
| `ChannelSections.eab3d102` | 写死 | 这个渠道可以卖全部城市，这里列出平台启用中的城市。 | 说明 | [ChannelSections.tsx:261](../../apps/web/src/pages/platform/ChannelSections.tsx#L261) |
| `ChannelSections.f834ba78` | 写死 | 品类 | 名称 | [ChannelSections.tsx:265](../../apps/web/src/pages/platform/ChannelSections.tsx#L265)、689 行 |
| `ChannelSections.bf3d351b` | 写死 | 车型组 | 名称 | [ChannelSections.tsx:267](../../apps/web/src/pages/platform/ChannelSections.tsx#L267) |
| `ChannelSections.7661b21d` | 写死 | 加价比例（%） | 名称 | [ChannelSections.tsx:269](../../apps/web/src/pages/platform/ChannelSections.tsx#L269) |
| `ChannelSections.7f4e86e0` | 写死 | 不能低于这个渠道的加价下限 {…}（平台下限 {PLATFORM\_FLOOR\_TEXT}）。 | 说明 | [ChannelSections.tsx:269](../../apps/web/src/pages/platform/ChannelSections.tsx#L269) |
| `ChannelSections.699ba095` | 写死 | 用车日期从（选填） | 名称 | [ChannelSections.tsx:271](../../apps/web/src/pages/platform/ChannelSections.tsx#L271) |
| `ChannelSections.829611f3` | 写死 | 年-月-日 | 输入框占位 | [ChannelSections.tsx:271](../../apps/web/src/pages/platform/ChannelSections.tsx#L271)、272 行 |
| `ChannelSections.f615bb8b` | 写死 | 到（选填） | 名称 | [ChannelSections.tsx:272](../../apps/web/src/pages/platform/ChannelSections.tsx#L272) |
| `ChannelSections.9b99f3cf` | 写死 | 促销期用：按用车日期（城市当地），两端都含，写成 2026-12-01 这样。同一级里，在日期范围内的规则优先于不带日期的。 | 正文 | [ChannelSections.tsx:274](../../apps/web/src/pages/platform/ChannelSections.tsx#L274) |
| `ChannelSections.93dc7a1c` | 写死 | 备注（选填） | 名称 | [ChannelSections.tsx:275](../../apps/web/src/pages/platform/ChannelSections.tsx#L275) |
| `ChannelSections.99e40cb1` | 写死 | 给审核人的说明（选填） | 名称 | [ChannelSections.tsx:276](../../apps/web/src/pages/platform/ChannelSections.tsx#L276)、368 行 |
| `ChannelSections.0683406e` | 写死 | 不能低于平台下限 {PLATFORM\_FLOOR\_TEXT} | 文字 | [ChannelSections.tsx:304](../../apps/web/src/pages/platform/ChannelSections.tsx#L304) |
| `ChannelSections.65c51c4b` | 写死 | 请填百分比，例如 10 | 文字 | [ChannelSections.tsx:304](../../apps/web/src/pages/platform/ChannelSections.tsx#L304)、305 行 |
| `ChannelSections.c8835853` | 写死 | 不能低于加价下限 | 文字 | [ChannelSections.tsx:305](../../apps/web/src/pages/platform/ChannelSections.tsx#L305) |
| `ChannelSections.2db799ef` | 写死 | 要在 0% 到 5% 之间 | 文字 | [ChannelSections.tsx:306](../../apps/web/src/pages/platform/ChannelSections.tsx#L306) |
| `ChannelSections.baa8fb89` | 写死 | 取整单位要填正数 | 文字 | [ChannelSections.tsx:308](../../apps/web/src/pages/platform/ChannelSections.tsx#L308) |
| `ChannelSections.8eec2ed1` | 写死 | 在「加价规则」里把这几条「修改」到新的下限以上（同样要同事批准），批准后再来调高下限；或者把下限改低一点。 | 文字 | [ChannelSections.tsx:330](../../apps/web/src/pages/platform/ChannelSections.tsx#L330) |
| `ChannelSections.c950d579` | 写死 | 申请修改定价参数 | 标题 | [ChannelSections.tsx:340](../../apps/web/src/pages/platform/ChannelSections.tsx#L340)、768 行 |
| `ChannelSections.60c5bc35` | 写死 | 改加价比例是敏感操作：提交后要另一位同事批准才生效。调高下限时，还在用的加价规则不能低于新的下限。 | 正文 | [ChannelSections.tsx:349](../../apps/web/src/pages/platform/ChannelSections.tsx#L349) |
| `ChannelSections.f88dfba3` | 写死 | 默认加价比例（%） | 名称 | [ChannelSections.tsx:350](../../apps/web/src/pages/platform/ChannelSections.tsx#L350) |
| `ChannelSections.3221aa5b` | 写死 | 不能低于平台下限 {PLATFORM\_FLOOR\_TEXT}。 | 说明 | [ChannelSections.tsx:351](../../apps/web/src/pages/platform/ChannelSections.tsx#L351) |
| `ChannelSections.b1cd53f1` | 写死 | 加价下限（%） | 名称 | [ChannelSections.tsx:351](../../apps/web/src/pages/platform/ChannelSections.tsx#L351) |
| `ChannelSections.7588c763` | 写死 | 价格带 δ（%） | 名称 | [ChannelSections.tsx:352](../../apps/web/src/pages/platform/ChannelSections.tsx#L352) |
| `ChannelSections.ab60e9c4` | 写死 | 0% 到 5%。 | 说明 | [ChannelSections.tsx:352](../../apps/web/src/pages/platform/ChannelSections.tsx#L352) |
| `ChannelSections.0108f813` | 写死 | 最低毛利（{settle\_currency}，选填） | 名称 | [ChannelSections.tsx:353](../../apps/web/src/pages/platform/ChannelSections.tsx#L353) |
| `ChannelSections.478a2402` | 写死 | 对外价取整（选填） | 表单标签 | [ChannelSections.tsx:355](../../apps/web/src/pages/platform/ChannelSections.tsx#L355) |
| `ChannelSections.ddfa9982` | 写死 | 客人用这个币种付款时，对外价向上取整到这个单位，例如日元填 100。不填就是不取整。 | 正文 | [ChannelSections.tsx:356](../../apps/web/src/pages/platform/ChannelSections.tsx#L356) |
| `ChannelSections.e5a5fdf0` | 写死 | 处理中… | 文字 | [ChannelSections.tsx:395](../../apps/web/src/pages/platform/ChannelSections.tsx#L395) |
| `ChannelSections.0812f675` | 写死 | 说明（选填） | 名称 | [ChannelSections.tsx:400](../../apps/web/src/pages/platform/ChannelSections.tsx#L400) |
| `ChannelSections.27208072` | 写死 | API 密钥（只显示这一次） | 标题 | [ChannelSections.tsx:418](../../apps/web/src/pages/platform/ChannelSections.tsx#L418) |
| `ChannelSections.ff044595` | 写死 | 回去复制 | 按钮 | [ChannelSections.tsx:421](../../apps/web/src/pages/platform/ChannelSections.tsx#L421) |
| `ChannelSections.0a20dd77` | 写死 | 不复制，关闭 | 按钮 | [ChannelSections.tsx:422](../../apps/web/src/pages/platform/ChannelSections.tsx#L422) |
| `ChannelSections.632d884d` | 写死 | 我已保存好，关闭 | 按钮 | [ChannelSections.tsx:425](../../apps/web/src/pages/platform/ChannelSections.tsx#L425) |
| `ChannelSections.33b4e266` | 写死 | 密钥只在这里显示一次。 | 正文 | [ChannelSections.tsx:429](../../apps/web/src/pages/platform/ChannelSections.tsx#L429) |
| `ChannelSections.844a6136` | 写死 | 平台只存它的指纹，关掉以后谁都看不到原文；丢了只能轮换。请当场复制，交给渠道的技术人员保管，不要发在群聊里。 | 正文 | [ChannelSections.tsx:430](../../apps/web/src/pages/platform/ChannelSections.tsx#L430) |
| `ChannelSections.57e3b529` | 写死 | 还没有复制密钥。关掉以后就看不到了，确定要关吗？ | 提示 | [ChannelSections.tsx:432](../../apps/web/src/pages/platform/ChannelSections.tsx#L432) |
| `ChannelSections.70d0bd32` | 写死 | client\_id | 正文 | [ChannelSections.tsx:435](../../apps/web/src/pages/platform/ChannelSections.tsx#L435)、530 行 |
| `ChannelSections.5e92c391` | 写死 | 复制 client\_id | 名称 | [ChannelSections.tsx:438](../../apps/web/src/pages/platform/ChannelSections.tsx#L438) |
| `ChannelSections.30168861` | 写死 | client\_secret | 正文 | [ChannelSections.tsx:442](../../apps/web/src/pages/platform/ChannelSections.tsx#L442)、444 行 |
| `ChannelSections.30fd56f6` | 写死 | 已复制 | 按钮 | [ChannelSections.tsx:447](../../apps/web/src/pages/platform/ChannelSections.tsx#L447) |
| `ChannelSections.e7b95e9b` | 写死 | 复制密钥 | 按钮 | [ChannelSections.tsx:447](../../apps/web/src/pages/platform/ChannelSections.tsx#L447) |
| `ChannelSections.49b26c16` | 写死 | 渠道用它们调用 POST /sales/v1/oauth/token 换访问令牌（2 小时有效）。 | 正文 | [ChannelSections.tsx:452](../../apps/web/src/pages/platform/ChannelSections.tsx#L452) |
| `ChannelSections.f2be7425` | 写死 | 请填一个名字，例如「官网正式环境」 | 文字 | [ChannelSections.tsx:471](../../apps/web/src/pages/platform/ChannelSections.tsx#L471) |
| `ChannelSections.064339a2` | 写死 | 新建 | 文字 | [ChannelSections.tsx:483](../../apps/web/src/pages/platform/ChannelSections.tsx#L483) |
| `ChannelSections.793e3310` | 写死 | 轮换 | 文字 | [ChannelSections.tsx:499](../../apps/web/src/pages/platform/ChannelSections.tsx#L499) |
| `ChannelSections.43337c34` | 写死 | API 客户端与密钥 | 标题 | [ChannelSections.tsx:510](../../apps/web/src/pages/platform/ChannelSections.tsx#L510) |
| `ChannelSections.ab20cc16` | 写死 | 新建 API 客户端 | 按钮 | [ChannelSections.tsx:515](../../apps/web/src/pages/platform/ChannelSections.tsx#L515)、572 行 |
| `ChannelSections.a33a99f5` | 写死 | 渠道调用销售端接口（/sales/v1）的凭据。密钥只在新建、轮换时显示一次；这里只显示后 4 位。 | 正文 | [ChannelSections.tsx:518](../../apps/web/src/pages/platform/ChannelSections.tsx#L518) |
| `ChannelSections.50e8d6b8` | 写死 | 重试 | 按钮 | [ChannelSections.tsx:520](../../apps/web/src/pages/platform/ChannelSections.tsx#L520)、652、679 行 |
| `ChannelSections.6b168e83` | 写死 | 请检查网络后重试。 | 说明 | [ChannelSections.tsx:520](../../apps/web/src/pages/platform/ChannelSections.tsx#L520)、652、679 行 |
| `ChannelSections.786f60a5` | 写死 | 加载失败 | 标题 | [ChannelSections.tsx:520](../../apps/web/src/pages/platform/ChannelSections.tsx#L520)、652、679 行 |
| `ChannelSections.36d7d4c4` | 写死 | 还没有 API 客户端。 | 正文 | [ChannelSections.tsx:522](../../apps/web/src/pages/platform/ChannelSections.tsx#L522) |
| `ChannelSections.b242ab72` | 写死 | API 客户端 | 读屏说明 | [ChannelSections.tsx:525](../../apps/web/src/pages/platform/ChannelSections.tsx#L525) |
| `ChannelSections.f5e6e71f` | 写死 | 名称 | 表头 | [ChannelSections.tsx:529](../../apps/web/src/pages/platform/ChannelSections.tsx#L529)、580 行 |
| `ChannelSections.ab3a943a` | 写死 | 密钥 | 表头 | [ChannelSections.tsx:531](../../apps/web/src/pages/platform/ChannelSections.tsx#L531) |
| `ChannelSections.1844212a` | 写死 | 状态 | 表头 | [ChannelSections.tsx:532](../../apps/web/src/pages/platform/ChannelSections.tsx#L532)、917 行 |
| `ChannelSections.2f347457` | 写死 | 最近使用 | 表头 | [ChannelSections.tsx:533](../../apps/web/src/pages/platform/ChannelSections.tsx#L533) |
| `ChannelSections.7cbff3a6` | 写死 | 操作 | 表头 | [ChannelSections.tsx:534](../../apps/web/src/pages/platform/ChannelSections.tsx#L534)、805 行 |
| `ChannelSections.16d2b1d6` | 写死 | ••••{secret\_last4}（第 {secret\_generation} 代） | 正文 | [ChannelSections.tsx:545](../../apps/web/src/pages/platform/ChannelSections.tsx#L545) |
| `ChannelSections.fb4a131c` | 写死 |  旧密钥到 {…} 前仍可用 | 正文 | [ChannelSections.tsx:546](../../apps/web/src/pages/platform/ChannelSections.tsx#L546) |
| `ChannelSections.395b50bc` | 写死 | 已吊销 | 名称 | [ChannelSections.tsx:548](../../apps/web/src/pages/platform/ChannelSections.tsx#L548) |
| `ChannelSections.ba6d1904` | 写死 | 在用 | 名称 | [ChannelSections.tsx:548](../../apps/web/src/pages/platform/ChannelSections.tsx#L548) |
| `ChannelSections.a208e9f4` | 写死 | 没用过 | 正文 | [ChannelSections.tsx:549](../../apps/web/src/pages/platform/ChannelSections.tsx#L549) |
| `ChannelSections.08616c8c` | 写死 | 轮换密钥 | 按钮 | [ChannelSections.tsx:556](../../apps/web/src/pages/platform/ChannelSections.tsx#L556) |
| `ChannelSections.b5a02493` | 写死 | 吊销 | 按钮 | [ChannelSections.tsx:559](../../apps/web/src/pages/platform/ChannelSections.tsx#L559)、603、615 行 |
| `ChannelSections.ad64d897` | 写死 | 新建并显示密钥 | 按钮 | [ChannelSections.tsx:575](../../apps/web/src/pages/platform/ChannelSections.tsx#L575) |
| `ChannelSections.d4062afa` | 写死 | 新建中… | 文字 | [ChannelSections.tsx:575](../../apps/web/src/pages/platform/ChannelSections.tsx#L575) |
| `ChannelSections.c2302eb8` | 写死 | 给人看的名字，例如「官网正式环境」。 | 说明 | [ChannelSections.tsx:580](../../apps/web/src/pages/platform/ChannelSections.tsx#L580) |
| `ChannelSections.11111dbc` | 写死 | 轮换「{name}」的密钥 | 标题 | [ChannelSections.tsx:585](../../apps/web/src/pages/platform/ChannelSections.tsx#L585) |
| `ChannelSections.1fc1b51f` | 写死 | 轮换并显示新密钥 | 按钮 | [ChannelSections.tsx:588](../../apps/web/src/pages/platform/ChannelSections.tsx#L588) |
| `ChannelSections.89f2675b` | 写死 | 轮换中… | 文字 | [ChannelSections.tsx:588](../../apps/web/src/pages/platform/ChannelSections.tsx#L588) |
| `ChannelSections.82074105` | 写死 | 会发一个新密钥（只显示一次）。旧密钥默认还能用 24 小时，让渠道有时间换上。 | 正文 | [ChannelSections.tsx:592](../../apps/web/src/pages/platform/ChannelSections.tsx#L592) |
| `ChannelSections.b643b2db` | 写死 | 旧密钥立即作废（密钥泄露时选这个；用旧密钥换的令牌也会马上失效） | 正文 | [ChannelSections.tsx:595](../../apps/web/src/pages/platform/ChannelSections.tsx#L595) |
| `ChannelSections.cef0b80c` | 写死 | 吊销「{name}」 | 标题 | [ChannelSections.tsx:601](../../apps/web/src/pages/platform/ChannelSections.tsx#L601) |
| `ChannelSections.232a5f61` | 写死 | 吊销后这个客户端和它换来的令牌立即失效，不能恢复；要用就新建一个。 | 正文 | [ChannelSections.tsx:602](../../apps/web/src/pages/platform/ChannelSections.tsx#L602) |
| `ChannelSections.41d3661a` | 写死 | 已吊销「{name}」 | 提示 | [ChannelSections.tsx:610](../../apps/web/src/pages/platform/ChannelSections.tsx#L610) |
| `ChannelSections.9faff460` | 写死 | （{pending} 条待审核） | 标题 | [ChannelSections.tsx:638](../../apps/web/src/pages/platform/ChannelSections.tsx#L638) |
| `ChannelSections.c6db5a64` | 写死 | 复核记录{…} | 标题 | [ChannelSections.tsx:638](../../apps/web/src/pages/platform/ChannelSections.tsx#L638) |
| `ChannelSections.9d3fec8a` | 写死 | 去待审核 | 链接 | [ChannelSections.tsx:643](../../apps/web/src/pages/platform/ChannelSections.tsx#L643) |
| `ChannelSections.ae581553` | 写死 | 你的角色没有「看待审核的改动」这项权限，看不到这个渠道的复核记录。需要的话，请联系管理员调整角色。 | 正文 | [ChannelSections.tsx:650](../../apps/web/src/pages/platform/ChannelSections.tsx#L650) |
| `ChannelSections.caee2144` | 写死 | 还没有发起过复核。 | 正文 | [ChannelSections.tsx:654](../../apps/web/src/pages/platform/ChannelSections.tsx#L654) |
| `ChannelSections.22e8deac` | 写死 |  · 审核：{name} | 正文 | [ChannelSections.tsx:661](../../apps/web/src/pages/platform/ChannelSections.tsx#L661) |
| `ChannelSections.8b99d8f9` | 写死 | 最近的询价 | 标题 | [ChannelSections.tsx:677](../../apps/web/src/pages/platform/ChannelSections.tsx#L677) |
| `ChannelSections.ef76d87a` | 写死 | 这个渠道还没有通过销售端接口询过价。 | 正文 | [ChannelSections.tsx:681](../../apps/web/src/pages/platform/ChannelSections.tsx#L681) |
| `ChannelSections.e0000260` | 写死 | 最近的询价列表 | 读屏说明 | [ChannelSections.tsx:684](../../apps/web/src/pages/platform/ChannelSections.tsx#L684) |
| `ChannelSections.03a0a832` | 写死 | 时间 | 表头 | [ChannelSections.tsx:688](../../apps/web/src/pages/platform/ChannelSections.tsx#L688) |
| `ChannelSections.12af69f8` | 写死 | 候选商品 | 表头 | [ChannelSections.tsx:690](../../apps/web/src/pages/platform/ChannelSections.tsx#L690) |
| `ChannelSections.7d640eb8` | 写死 | 报出 | 表头 | [ChannelSections.tsx:691](../../apps/web/src/pages/platform/ChannelSections.tsx#L691) |
| `ChannelSections.3d34f766` | 写死 | 没报出 | 表头 | [ChannelSections.tsx:692](../../apps/web/src/pages/platform/ChannelSections.tsx#L692) |
| `ChannelSections.e42923b6` | 写死 | 耗时 | 表头 | [ChannelSections.tsx:693](../../apps/web/src/pages/platform/ChannelSections.tsx#L693) |
| `ChannelSections.822f1b01` | 写死 | 你可以查看这个渠道，但不能修改。 | 提示 | [ChannelSections.tsx:733](../../apps/web/src/pages/platform/ChannelSections.tsx#L733) |
| `ChannelSections.923fd386` | 写死 | 这个渠道已暂停：它调用销售端接口一律被拒绝。重新启用后恢复。 | 提示 | [ChannelSections.tsx:734](../../apps/web/src/pages/platform/ChannelSections.tsx#L734) |
| `ChannelSections.5b7a2ddb` | 写死 | 这个渠道在「测试」状态：可以发 API 密钥联调、可以询价。准备好正式卖了，点「启用」。 | 提示 | [ChannelSections.tsx:735](../../apps/web/src/pages/platform/ChannelSections.tsx#L735) |
| `ChannelSections.77dda026` | 写死 | 编辑基本信息和授权范围 | 按钮 | [ChannelSections.tsx:738](../../apps/web/src/pages/platform/ChannelSections.tsx#L738) |
| `ChannelSections.a8e7e95a` | 写死 | 启用 | 按钮 | [ChannelSections.tsx:742](../../apps/web/src/pages/platform/ChannelSections.tsx#L742)、893、904 行 |
| `ChannelSections.e3980164` | 写死 | 申请暂停 | 按钮 | [ChannelSections.tsx:747](../../apps/web/src/pages/platform/ChannelSections.tsx#L747) |
| `ChannelSections.3dab08a8` | 写死 | 基本配置 | 标题 | [ChannelSections.tsx:754](../../apps/web/src/pages/platform/ChannelSections.tsx#L754) |
| `ChannelSections.36ded1c0` | 写死 | 授权范围 | 标题 | [ChannelSections.tsx:760](../../apps/web/src/pages/platform/ChannelSections.tsx#L760) |
| `ChannelSections.3f5abab6` | 写死 | 定价参数 | 标题 | [ChannelSections.tsx:767](../../apps/web/src/pages/platform/ChannelSections.tsx#L767) |
| `ChannelSections.8b09ddd3` | 写死 | 加价规则 | 标题 | [ChannelSections.tsx:783](../../apps/web/src/pages/platform/ChannelSections.tsx#L783)、796 行 |
| `ChannelSections.ca82cefa` | 写死 | 从具体到通用匹配，命中第一级就停；都没命中用默认加价比例 {…}。新增、修改、删除都要另一位同事批准才生效。 | 正文 | [ChannelSections.tsx:791](../../apps/web/src/pages/platform/ChannelSections.tsx#L791) |
| `ChannelSections.3f319381` | 写死 | 还没有加价规则：全部按默认加价比例。 | 正文 | [ChannelSections.tsx:793](../../apps/web/src/pages/platform/ChannelSections.tsx#L793) |
| `ChannelSections.298d1f62` | 写死 | 级别 | 表头 | [ChannelSections.tsx:800](../../apps/web/src/pages/platform/ChannelSections.tsx#L800) |
| `ChannelSections.7c340881` | 写死 | 适用于 | 表头 | [ChannelSections.tsx:801](../../apps/web/src/pages/platform/ChannelSections.tsx#L801) |
| `ChannelSections.f3e4fcf4` | 写死 | 加价比例 | 表头 | [ChannelSections.tsx:802](../../apps/web/src/pages/platform/ChannelSections.tsx#L802) |
| `ChannelSections.52063bb2` | 写死 | 用车日期 | 表头 | [ChannelSections.tsx:803](../../apps/web/src/pages/platform/ChannelSections.tsx#L803) |
| `ChannelSections.888d7b92` | 写死 | 备注 | 表头 | [ChannelSections.tsx:804](../../apps/web/src/pages/platform/ChannelSections.tsx#L804) |
| `ChannelSections.437c72dc` | 写死 | 第 {level} 级 | 正文 | [ChannelSections.tsx:811](../../apps/web/src/pages/platform/ChannelSections.tsx#L811) |
| `ChannelSections.fe5a5b25` | 写死 | 修改 {…} 的规则 | 读屏说明 | [ChannelSections.tsx:821](../../apps/web/src/pages/platform/ChannelSections.tsx#L821) |
| `ChannelSections.10fc1ab9` | 写死 | 修改 | 按钮 | [ChannelSections.tsx:823](../../apps/web/src/pages/platform/ChannelSections.tsx#L823) |
| `ChannelSections.45ae5012` | 写死 | 删除 {…} 的规则 | 读屏说明 | [ChannelSections.tsx:824](../../apps/web/src/pages/platform/ChannelSections.tsx#L824) |
| `ChannelSections.ae0a1454` | 写死 | 删除 | 按钮 | [ChannelSections.tsx:826](../../apps/web/src/pages/platform/ChannelSections.tsx#L826) |
| `ChannelSections.10107e14` | 写死 | 申请删除加价规则 | 标题 | [ChannelSections.tsx:845](../../apps/web/src/pages/platform/ChannelSections.tsx#L845) |
| `ChannelSections.d0ff1069` | 写死 | 「{…} = {…}」。提交后要另一位同事批准才删除；删除后这些情况改按下一级的规则或默认加价比例。 | 正文 | [ChannelSections.tsx:849](../../apps/web/src/pages/platform/ChannelSections.tsx#L849) |
| `ChannelSections.d17cd87f` | 写死 | 申请暂停「{name}」 | 标题 | [ChannelSections.tsx:871](../../apps/web/src/pages/platform/ChannelSections.tsx#L871) |
| `ChannelSections.7e5a1f17` | 写死 | 暂停后这个渠道调用销售端接口一律被拒绝。停用渠道是敏感操作：提交后要另一位同事批准才生效。 | 正文 | [ChannelSections.tsx:872](../../apps/web/src/pages/platform/ChannelSections.tsx#L872) |
| `ChannelSections.1b8cda3b` | 写死 | 启用「{name}」 | 标题 | [ChannelSections.tsx:891](../../apps/web/src/pages/platform/ChannelSections.tsx#L891) |
| `ChannelSections.215b3f91` | 写死 | 启用后这个渠道就是正式在卖的状态。启用直接生效，不用审核。 | 正文 | [ChannelSections.tsx:892](../../apps/web/src/pages/platform/ChannelSections.tsx#L892) |
| `ChannelSections.89ef4ac4` | 写死 | 「{name}」已启用 | 提示 | [ChannelSections.tsx:900](../../apps/web/src/pages/platform/ChannelSections.tsx#L900) |
| `ChannelSections.74944ace` | 写死 | 类型 | 名称 | [ChannelSections.tsx:916](../../apps/web/src/pages/platform/ChannelSections.tsx#L916) |
| `ChannelSections.ba14ce82` | 写死 | 结算币种 | 名称 | [ChannelSections.tsx:918](../../apps/web/src/pages/platform/ChannelSections.tsx#L918) |
| `ChannelSections.b8d91361` | 写死 | 公司 | 名称 | [ChannelSections.tsx:919](../../apps/web/src/pages/platform/ChannelSections.tsx#L919) |
| `ChannelSections.7eb3db32` | 写死 | 联系人 | 名称 | [ChannelSections.tsx:920](../../apps/web/src/pages/platform/ChannelSections.tsx#L920) |
| `ChannelSections.154f0c69` | 写死 | 合同编号 | 名称 | [ChannelSections.tsx:921](../../apps/web/src/pages/platform/ChannelSections.tsx#L921) |
| `ChannelSections.01ec313f` | 写死 | {…}{…}（只记录，下单上线后才生效） | 文字 | [ChannelSections.tsx:922](../../apps/web/src/pages/platform/ChannelSections.tsx#L922) |
| `ChannelSections.6b43b2fd` | 写死 | ，额度 {…} | 文字 | [ChannelSections.tsx:922](../../apps/web/src/pages/platform/ChannelSections.tsx#L922) |
| `ChannelSections.6cda6af1` | 写死 | 预付款 | 文字 | [ChannelSections.tsx:922](../../apps/web/src/pages/platform/ChannelSections.tsx#L922) |
| `ChannelSections.7c5872b8` | 写死 | 信用额度 | 文字 | [ChannelSections.tsx:922](../../apps/web/src/pages/platform/ChannelSections.tsx#L922) |
| `ChannelSections.a4488e58` | 写死 | 付款方式 | 名称 | [ChannelSections.tsx:922](../../apps/web/src/pages/platform/ChannelSections.tsx#L922) |
| `ChannelSections.079b289b` | 写死 | 付款后展示中标供应商 | 名称 | [ChannelSections.tsx:923](../../apps/web/src/pages/platform/ChannelSections.tsx#L923) |
| `ChannelSections.2ec05fef` | 写死 | 展示 | 文字 | [ChannelSections.tsx:923](../../apps/web/src/pages/platform/ChannelSections.tsx#L923) |
| `ChannelSections.91f0fcc5` | 写死 | 不展示 | 文字 | [ChannelSections.tsx:923](../../apps/web/src/pages/platform/ChannelSections.tsx#L923) |
| `ChannelSections.0a078d9d` | 写死 | 渠道编号 | 名称 | [ChannelSections.tsx:925](../../apps/web/src/pages/platform/ChannelSections.tsx#L925) |
| `ChannelSections.b805fe65` | 写死 | 复制渠道编号 | 名称 | [ChannelSections.tsx:929](../../apps/web/src/pages/platform/ChannelSections.tsx#L929) |
| `ChannelSections.45e8ba24` | 写死 | 最近修改 | 名称 | [ChannelSections.tsx:933](../../apps/web/src/pages/platform/ChannelSections.tsx#L933) |
| `ChannelSections.84eafd48` | 写死 | 可卖的供应商 | 正文 | [ChannelSections.tsx:952](../../apps/web/src/pages/platform/ChannelSections.tsx#L952) |
| `ChannelSections.f25dfc5f` | 写死 | 可卖的城市 | 正文 | [ChannelSections.tsx:956](../../apps/web/src/pages/platform/ChannelSections.tsx#L956) |
| `ChannelSections.38013e88` | 写死 | 全部城市 | 正文 | [ChannelSections.tsx:957](../../apps/web/src/pages/platform/ChannelSections.tsx#L957) |
| `ChannelSections.8dfafb05` | 写死 | 可卖的品类 | 正文 | [ChannelSections.tsx:960](../../apps/web/src/pages/platform/ChannelSections.tsx#L960) |

## 多个页面共用：no-show 证据（NoShowEvidence.tsx）

用在：运营后台 · 工单详情；运营后台 · 订单（列表、详情）

文件：`apps/web/src/pages/platform/NoShowEvidence.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `NoShowEvidence.07de9cb3` | 写死 | 提交 no-show | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.402e74a1` | 写死 | 途中 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.86409fbb` | 写死 | 到达 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.86ad3741` | 写死 | 完成 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.af5775c8` | 写死 | 申请离开 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.b400cf1a` | 写死 | 接到客人 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.d9a69dbe` | 写死 | 出发 | 文字 | [NoShowEvidence.tsx:26](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L26) |
| `NoShowEvidence.b1788a44` | 写死 | 5 项证据 | 读屏说明 | [NoShowEvidence.tsx:31](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L31) |
| `NoShowEvidence.932c03d9` | 写死 | 照片和联系记录在工单页的「no-show 证据」里，关掉对话框可以看。 | 正文 | [NoShowEvidence.tsx:39](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L39) |
| `NoShowEvidence.61adb6ad` | 写死 | no-show 证据（当地时间，{zone}） | 标题 | [NoShowEvidence.tsx:67](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L67) |
| `NoShowEvidence.5b228600` | 写死 | 这一单没有提交 no-show，也没有到达记录、照片和联系记录。 | 正文 | [NoShowEvidence.tsx:69](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L69) |
| `NoShowEvidence.185dac52` | 写死 | 还没有提交 no-show，没有 5 项核对结果。下面是目前的记录。 | 正文 | [NoShowEvidence.tsx:72](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L72) |
| `NoShowEvidence.262ef85f` | 写死 | {…} 提交，{…}。「满足」是提交那一刻核对的结果。 | 正文 | [NoShowEvidence.tsx:72](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L72) |
| `NoShowEvidence.8e577678` | 写死 | 有 {size} 张照片没有显示出来，判定前请在下面重新取或下载原图看过。 | 正文 | [NoShowEvidence.tsx:83](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L83) |
| `NoShowEvidence.8e22a69f` | 写死 | 到达时间和距离 | 正文 | [NoShowEvidence.tsx:87](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L87) |
| `NoShowEvidence.71160f41` | 写死 | 免费等待时段 | 正文 | [NoShowEvidence.tsx:91](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L91) |
| `NoShowEvidence.18cd0a8a` | 写死 | 落地时间和来源 | 正文 | [NoShowEvidence.tsx:95](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L95) |
| `NoShowEvidence.466d5364` | 写死 | 联系记录（{length} 条） | 标题 | [NoShowEvidence.tsx:100](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L100) |
| `NoShowEvidence.52d488eb` | 写死 | 司机没有记录联系客人。 | 正文 | [NoShowEvidence.tsx:102](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L102) |
| `NoShowEvidence.99e7d1f2` | 写死 | 照片 | 标题 | [NoShowEvidence.tsx:114](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L114) |
| `NoShowEvidence.43809c8c` | 写死 | 没有举牌照片。 | 正文 | [NoShowEvidence.tsx:115](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L115) |
| `NoShowEvidence.78692e22` | 写死 | 查看照片会记入操作记录。截图可能带着客人的联系方式，点了才显示。 | 正文 | [NoShowEvidence.tsx:121](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L121) |
| `NoShowEvidence.62a6fc7c` | 写死 | 司机定位记录（{length} 条） | 正文 | [NoShowEvidence.tsx:125](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L125) |
| `NoShowEvidence.6d86d372` | 写死 |  ±{accuracy\_m} 米 | 正文 | [NoShowEvidence.tsx:128](../../apps/web/src/pages/platform/NoShowEvidence.tsx#L128) |

## 多个页面共用：运营看手写内容的原文（PassengerReveal.tsx）

用在：运营后台 · 工单详情；运营后台 · 订单（列表、详情）

文件：`apps/web/src/pages/platform/PassengerReveal.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PassengerReveal.a2400fac` | 写死 | 取消说明 | 说明 | [PassengerReveal.tsx:14](../../apps/web/src/pages/platform/PassengerReveal.tsx#L14) |
| `PassengerReveal.86ff6021` | 写死 | 司机的联系记录 | 说明 | [PassengerReveal.tsx:15](../../apps/web/src/pages/platform/PassengerReveal.tsx#L15) |
| `PassengerReveal.2685618e` | 写死 | 代传原因 | 提示 | [PassengerReveal.tsx:16](../../apps/web/src/pages/platform/PassengerReveal.tsx#L16) |
| `PassengerReveal.3ea3dabb` | 写死 | 改单前 | 文字 | [PassengerReveal.tsx:17](../../apps/web/src/pages/platform/PassengerReveal.tsx#L17) |
| `PassengerReveal.fb29768e` | 写死 | 改单后 | 文字 | [PassengerReveal.tsx:18](../../apps/web/src/pages/platform/PassengerReveal.tsx#L18) |
| `PassengerReveal.c0771ab0` | 写死 | 改单确认说明 | 说明 | [PassengerReveal.tsx:19](../../apps/web/src/pages/platform/PassengerReveal.tsx#L19) |
| `PassengerReveal.7324d687` | 写死 | 加收说明 | 说明 | [PassengerReveal.tsx:20](../../apps/web/src/pages/platform/PassengerReveal.tsx#L20) |
| `PassengerReveal.f69cd4bc` | 写死 | 客人的异议 | 提示 | [PassengerReveal.tsx:21](../../apps/web/src/pages/platform/PassengerReveal.tsx#L21) |
| `PassengerReveal.c209cca1` | 写死 | 加收审核说明 | 说明 | [PassengerReveal.tsx:22](../../apps/web/src/pages/platform/PassengerReveal.tsx#L22) |
| `PassengerReveal.444a82e2` | 写死 | 救援原因 | 提示 | [PassengerReveal.tsx:23](../../apps/web/src/pages/platform/PassengerReveal.tsx#L23) |
| `PassengerReveal.981da633` | 写死 | 不可抗力说明 | 说明 | [PassengerReveal.tsx:24](../../apps/web/src/pages/platform/PassengerReveal.tsx#L24) |
| `PassengerReveal.7c1b0716` | 写死 | 供应商拒绝救援的原因 | 提示 | [PassengerReveal.tsx:25](../../apps/web/src/pages/platform/PassengerReveal.tsx#L25) |
| `PassengerReveal.b23efb05` | 写死 | 异常处理说明 | 文字 | [PassengerReveal.tsx:26](../../apps/web/src/pages/platform/PassengerReveal.tsx#L26) |
| `PassengerReveal.6db1a99c` | 写死 | 工单标题 | 文字 | [PassengerReveal.tsx:27](../../apps/web/src/pages/platform/PassengerReveal.tsx#L27) |
| `PassengerReveal.d40f5535` | 写死 | 工单经过 | 说明 | [PassengerReveal.tsx:28](../../apps/web/src/pages/platform/PassengerReveal.tsx#L28) |
| `PassengerReveal.d1e51a8e` | 写死 | 工单判定说明 | 说明 | [PassengerReveal.tsx:29](../../apps/web/src/pages/platform/PassengerReveal.tsx#L29) |
| `PassengerReveal.0652b330` | 写死 | 工单关闭说明 | 说明 | [PassengerReveal.tsx:30](../../apps/web/src/pages/platform/PassengerReveal.tsx#L30) |
| `PassengerReveal.c7b73749` | 写死 | 工单对话 | 提示 | [PassengerReveal.tsx:31](../../apps/web/src/pages/platform/PassengerReveal.tsx#L31) |
| `PassengerReveal.c1a082df` | 写死 | 工单内部备注 | 说明 | [PassengerReveal.tsx:32](../../apps/web/src/pages/platform/PassengerReveal.tsx#L32) |
| `PassengerReveal.e7318934` | 写死 | 复核说明 | 说明 | [PassengerReveal.tsx:33](../../apps/web/src/pages/platform/PassengerReveal.tsx#L33) |
| `PassengerReveal.5dc845ed` | 写死 | 复核决定说明 | 说明 | [PassengerReveal.tsx:34](../../apps/web/src/pages/platform/PassengerReveal.tsx#L34) |
| `PassengerReveal.77dddbff` | 写死 | 复核内容 | 文字 | [PassengerReveal.tsx:35](../../apps/web/src/pages/platform/PassengerReveal.tsx#L35) |
| `PassengerReveal.0fa361d9` | 写死 | 查看 | 文字 | [PassengerReveal.tsx:62](../../apps/web/src/pages/platform/PassengerReveal.tsx#L62) |
| `PassengerReveal.d07daf37` | 写死 | 手写内容里的联系方式已打码。 | 正文 | [PassengerReveal.tsx:70](../../apps/web/src/pages/platform/PassengerReveal.tsx#L70) |
| `PassengerReveal.1bcedb1b` | 写死 | 查看会记进审计日志。 | 正文 | [PassengerReveal.tsx:73](../../apps/web/src/pages/platform/PassengerReveal.tsx#L73) |
| `PassengerReveal.bb86f857` | 写死 | 查看原文 | 按钮 | [PassengerReveal.tsx:73](../../apps/web/src/pages/platform/PassengerReveal.tsx#L73) |
| `PassengerReveal.1e9827d5` | 写死 | 这张工单没有被打码的内容。 | 正文 | [PassengerReveal.tsx:78](../../apps/web/src/pages/platform/PassengerReveal.tsx#L78) |

## 多个页面共用：加价规则 / 定价参数生效前的「近 30 天毛利试算」（PricingImpactPanel.tsx）

用在：运营后台 · 待审核；运营后台 · 渠道

文件：`apps/web/src/pages/platform/PricingImpactPanel.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PricingImpactPanel.f6162a1d` | 写死 | 这是估算：假定近 30 天的询价和订单照旧发生、按新价格重新比价；客人面对新的价格还会不会下单，无法知道。金额按报价时的汇率换成渠道结算币种。 | 说明 | [PricingImpactPanel.tsx:19](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L19) |
| `PricingImpactPanel.95524331` | 写死 | 填的内容不符合要求 | 提示 | [PricingImpactPanel.tsx:31](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L31) |
| `PricingImpactPanel.caf52ca3` | 写死 | 没法试算：{…}。 | 提示 | [PricingImpactPanel.tsx:31](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L31) |
| `PricingImpactPanel.41107d86` | 写死 | 没法试算：同一组维度上已经有一条规则（不带日期的只能有一条，带日期的日期范围不能重叠）。 | 提示 | [PricingImpactPanel.tsx:33](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L33) |
| `PricingImpactPanel.d921d5c1` | 写死 | 没法试算：{message}。 | 提示 | [PricingImpactPanel.tsx:34](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L34) |
| `PricingImpactPanel.cb3390ca` | 写死 | 你没有权限做毛利试算。 | 提示 | [PricingImpactPanel.tsx:35](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L35) |
| `PricingImpactPanel.25ab7fdd` | 写死 | 试算 | 文字 | [PricingImpactPanel.tsx:37](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L37) |
| `PricingImpactPanel.2f6add60` | 写死 | 对外价合计（客人付） | 文字 | [PricingImpactPanel.tsx:42](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L42) |
| `PricingImpactPanel.a8a880bd` | 写死 | 结算价合计（付给供应商） | 文字 | [PricingImpactPanel.tsx:43](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L43) |
| `PricingImpactPanel.7e9cb8ad` | 写死 | 毛利 | 文字 | [PricingImpactPanel.tsx:44](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L44) |
| `PricingImpactPanel.065a7c75` | 写死 | （共 {total} {unit}，只算了最近的这些） | 正文 | [PricingImpactPanel.tsx:50](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L50) |
| `PricingImpactPanel.f3d1ae44` | 写死 | 项目 | 表头 | [PricingImpactPanel.tsx:53](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L53) |
| `PricingImpactPanel.fda1ae03` | 写死 | 改前 | 表头 | [PricingImpactPanel.tsx:54](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L54) |
| `PricingImpactPanel.d988f20c` | 写死 | 改后 | 表头 | [PricingImpactPanel.tsx:55](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L55) |
| `PricingImpactPanel.7053dc66` | 写死 | 差额 | 表头 | [PricingImpactPanel.tsx:56](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L56) |
| `PricingImpactPanel.1359a02e` | 写死 | 中标会换人：{winner\_changed} {unit} | 文字 | [PricingImpactPanel.tsx:79](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L79) |
| `PricingImpactPanel.f80a34c0` | 写死 | 要按最低毛利补价：改前 {min\_margin\_raised\_before} {unit}，改后 {min\_margin\_raised\_after} {unit} | 文字 | [PricingImpactPanel.tsx:80](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L80) |
| `PricingImpactPanel.f94cc6fe` | 写死 | 改后报不出价：{became\_unquotable} {unit} | 文字 | [PricingImpactPanel.tsx:81](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L81) |
| `PricingImpactPanel.8b350edb` | 写死 | 改后能报出价（改前报不出）：{became\_quotable} {unit} | 文字 | [PricingImpactPanel.tsx:82](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L82) |
| `PricingImpactPanel.0b04a12b` | 写死 | 缺报价时的汇率、没法重算（没计入）：{skipped} {unit} | 文字 | [PricingImpactPanel.tsx:83](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L83) |
| `PricingImpactPanel.ed85bb5a` | 写死 | {…} 至 {…}（近 {window\_days} 天），{…} 算的。改前按现在生效的规则重算，改后按这次的改动重算，都重新比价选中标。 | 正文 | [PricingImpactPanel.tsx:94](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L94) |
| `PricingImpactPanel.1ca4321a` | 写死 | 单 | 文字 | [PricingImpactPanel.tsx:95](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L95)、97 行 |
| `PricingImpactPanel.b7501f9a` | 写死 | 付过款的订单 | 标题 | [PricingImpactPanel.tsx:95](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L95) |
| `PricingImpactPanel.2d8d3ee1` | 写死 | 其中付款后有偿取消、按扣款比例计入：{cancelled\_with\_fee} 单 | 正文 | [PricingImpactPanel.tsx:97](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L97) |
| `PricingImpactPanel.809095d5` | 写死 | 免费取消（毛利为 0，没计入）：{cancelled\_free} 单 | 正文 | [PricingImpactPanel.tsx:97](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L97) |
| `PricingImpactPanel.5dd834fe` | 写死 | 询价（每个车型组一个报价） | 标题 | [PricingImpactPanel.tsx:101](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L101) |
| `PricingImpactPanel.92f2ea75` | 写死 | 个 | 文字 | [PricingImpactPanel.tsx:101](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L101)、103 行 |
| `PricingImpactPanel.6067f219` | 写死 | 试算中… | 文字 | [PricingImpactPanel.tsx:151](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L151)、190 行 |
| `PricingImpactPanel.2796a1cb` | 写死 | 试算近 30 天毛利影响 | 按钮 | [PricingImpactPanel.tsx:152](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L152) |
| `PricingImpactPanel.7bb025fb` | 写死 | 重新试算 | 按钮 | [PricingImpactPanel.tsx:152](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L152) |
| `PricingImpactPanel.559a33a5` | 写死 | 先把内容填完整再试算。 | 正文 | [PricingImpactPanel.tsx:154](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L154) |
| `PricingImpactPanel.4e012536` | 写死 | 内容改过了，上次的结果不再适用，请重新试算。 | 正文 | [PricingImpactPanel.tsx:155](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L155) |
| `PricingImpactPanel.655283c4` | 写死 | 近 30 天毛利试算 | 标题 | [PricingImpactPanel.tsx:158](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L158) |
| `PricingImpactPanel.0a8ea67e` | 写死 | 发起时的毛利试算（近 30 天） | 标题 | [PricingImpactPanel.tsx:187](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L187) |
| `PricingImpactPanel.7862e705` | 写死 | 这条复核发起时没有保存毛利试算（M3-07 之前发起的）。 | 正文 | [PricingImpactPanel.tsx:187](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L187) |
| `PricingImpactPanel.3cc33afe` | 写死 | 按现在的数据再算一次：{summary} | 读屏说明 | [PricingImpactPanel.tsx:190](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L190) |
| `PricingImpactPanel.fecd2a87` | 写死 | 按现在的数据再算一次 | 按钮 | [PricingImpactPanel.tsx:192](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L192) |
| `PricingImpactPanel.e7b2022e` | 写死 | 按现在的数据再算的结果 | 标题 | [PricingImpactPanel.tsx:196](../../apps/web/src/pages/platform/PricingImpactPanel.tsx#L196) |

## 多个页面共用：运营后台供应商详情里的入驻部分（TenantOnboardingSections.tsx）

用在：供应商后台 · 公司；运营后台 · 供应商（列表、新建、详情）

文件：`apps/web/src/pages/platform/TenantOnboardingSections.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantOnboardingSections.5c973115` | 写死 | 加载失败 | 标题 | [TenantOnboardingSections.tsx:67](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L67) |
| `TenantOnboardingSections.eaeaa0cb` | 写死 | 请检查网络后重试。 | 说明 | [TenantOnboardingSections.tsx:68](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L68) |
| `TenantOnboardingSections.527d7bfd` | 写死 | 重试 | 按钮 | [TenantOnboardingSections.tsx:72](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L72) |
| `TenantOnboardingSections.0e4d1024` | 写死 | 条件还不满足：{…}。 | 文字 | [TenantOnboardingSections.tsx:103](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L103) |
| `TenantOnboardingSections.ef58746b` | 写死 | 还有 {…} 张没履约完的订单，全部完成或取消以后才能清退。 | 文字 | [TenantOnboardingSections.tsx:105](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L105) |
| `TenantOnboardingSections.9f6775d4` | 写死 | 这是测试供应商，只用于验收，不能开始试运营、转为正式或上架（ADR 0077）。它停在已签约就可以做验收要用的所有设置。 | 文字 | [TenantOnboardingSections.tsx:106](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L106) |
| `TenantOnboardingSections.e5322b20` | 写死 | 供应商现在的状态不能做这一步。请刷新页面看最新的状态。 | 文字 | [TenantOnboardingSections.tsx:107](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L107) |
| `TenantOnboardingSections.6fabd2e2` | 写死 | 供应商之后又交了一份同类型的资质，请审核最新的那份。 | 文字 | [TenantOnboardingSections.tsx:108](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L108) |
| `TenantOnboardingSections.9ebfab25` | 写死 | 这份资质已经审核过了。请刷新页面。 | 文字 | [TenantOnboardingSections.tsx:109](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L109) |
| `TenantOnboardingSections.6fbdfbf8` | 写死 | 填写的内容不对。 | 文字 | [TenantOnboardingSections.tsx:112](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L112) |
| `TenantOnboardingSections.9ea89adf` | 写死 | 你没有权限做这个操作。 | 文字 | [TenantOnboardingSections.tsx:114](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L114) |
| `TenantOnboardingSections.892317f0` | 写死 | 「{name}」已签约 | 提示 | [TenantOnboardingSections.tsx:150](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L150) |
| `TenantOnboardingSections.3d637eca` | 写死 | 「{name}」已开始试运营 | 提示 | [TenantOnboardingSections.tsx:153](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L153) |
| `TenantOnboardingSections.fd3c76ad` | 写死 | 已提交清退「{name}」的申请，等另一位同事审核后生效 | 提示 | [TenantOnboardingSections.tsx:156](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L156) |
| `TenantOnboardingSections.25a0a04e` | 写死 | 签约 | 文字 | [TenantOnboardingSections.tsx:161](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L161)、179、199、238 行 |
| `TenantOnboardingSections.5e409852` | 写死 | 开始试运营 | 文字 | [TenantOnboardingSections.tsx:161](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L161)、184、200、238 行 |
| `TenantOnboardingSections.9dd4afe4` | 写死 | 提交 | 文字 | [TenantOnboardingSections.tsx:161](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L161)、309、489 行 |
| `TenantOnboardingSections.257ef13a` | 写死 | 申请清退「{name}」 | 文字 | [TenantOnboardingSections.tsx:167](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L167) |
| `TenantOnboardingSections.85b48083` | 写死 | 「{name}」开始试运营 | 文字 | [TenantOnboardingSections.tsx:167](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L167) |
| `TenantOnboardingSections.d6b11735` | 写死 | 和「{name}」签约 | 文字 | [TenantOnboardingSections.tsx:167](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L167) |
| `TenantOnboardingSections.7d0580b2` | 写死 | 入驻进度 | 标题 | [TenantOnboardingSections.tsx:173](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L173) |
| `TenantOnboardingSections.4de9a189` | 写死 | 申请清退 | 按钮 | [TenantOnboardingSections.tsx:189](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L189) |
| `TenantOnboardingSections.834c9cd1` | 写死 | 测试供应商不能开始试运营（ADR 0077），所以这里没有「开始试运营」。 | 正文 | [TenantOnboardingSections.tsx:195](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L195) |
| `TenantOnboardingSections.5ce3842f` | 写死 | 转为正式 | 正文 | [TenantOnboardingSections.tsx:201](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L201) |
| `TenantOnboardingSections.864106ac` | 写死 | 暂停 | 正文 | [TenantOnboardingSections.tsx:202](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L202) |
| `TenantOnboardingSections.71e54940` | 写死 | 清退 | 正文 | [TenantOnboardingSections.tsx:203](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L203) |
| `TenantOnboardingSections.a4595239` | 写死 | 签约前还缺： | 正文 | [TenantOnboardingSections.tsx:216](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L216) |
| `TenantOnboardingSections.fa0d42d8` | 写死 | 供应商提交审核前还缺： | 正文 | [TenantOnboardingSections.tsx:216](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L216) |
| `TenantOnboardingSections.9c28b819` | 写死 | 取消 | 按钮 | [TenantOnboardingSections.tsx:236](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L236)、414、565 行 |
| `TenantOnboardingSections.a671181b` | 写死 | 提交中… | 文字 | [TenantOnboardingSections.tsx:237](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L237)、415、566 行 |
| `TenantOnboardingSections.1c049c83` | 写死 | 提交申请 | 按钮 | [TenantOnboardingSections.tsx:238](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L238) |
| `TenantOnboardingSections.969bbfee` | 写死 | 签约要求必交资质全部审核通过、有一份已生效的合同。签约以后供应商可以建区域和商品，还不能上架。 | 正文 | [TenantOnboardingSections.tsx:244](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L244) |
| `TenantOnboardingSections.c267bf04` | 写死 | 开始试运营要求至少 1 个商品通过上架校验，并且已经完成了一次测试单。试运营可以上架、参与比价，每天最多接 10 单。 | 正文 | [TenantOnboardingSections.tsx:245](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L245) |
| `TenantOnboardingSections.59ddd8ea` | 写死 | 清退要另一位同事审核：提交以后在「待审核」里批准了才生效。 | 提示 | [TenantOnboardingSections.tsx:248](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L248) |
| `TenantOnboardingSections.959f6c29` | 写死 | 清退以后供应商只能查看历史，不能再修改任何东西，商品不再参与比价。要求已有订单全部履约完毕。清退不能撤销。 | 正文 | [TenantOnboardingSections.tsx:249](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L249) |
| `TenantOnboardingSections.72e9bc42` | 写死 | 清退原因 | 名称 | [TenantOnboardingSections.tsx:254](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L254) |
| `TenantOnboardingSections.7abf4aab` | 写死 | 说明 | 名称 | [TenantOnboardingSections.tsx:254](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L254)、521、597、618 行 |
| `TenantOnboardingSections.aabef354` | 写死 | 测试单的情况 | 名称 | [TenantOnboardingSections.tsx:254](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L254) |
| `TenantOnboardingSections.de4337aa` | 写死 | 必填 | 提示 | [TenantOnboardingSections.tsx:258](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L258) |
| `TenantOnboardingSections.13972215` | 写死 | 写清楚测试单的订单号、是谁跑的、结果怎样。会记入状态记录（供应商看不到这段文字）。 | 说明 | [TenantOnboardingSections.tsx:259](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L259) |
| `TenantOnboardingSections.c2a9ca53` | 写死 | 会记入状态记录和审计日志，供应商看不到这段文字。 | 说明 | [TenantOnboardingSections.tsx:259](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L259) |
| `TenantOnboardingSections.966eb44c` | 写死 | 下载 | 文字 | [TenantOnboardingSections.tsx:285](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L285)、363、498、541 行 |
| `TenantOnboardingSections.81667fd5` | 写死 | 已通过 | 提示 | [TenantOnboardingSections.tsx:304](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L304) |
| `TenantOnboardingSections.9c4d787c` | 写死 | 已要求补充 | 提示 | [TenantOnboardingSections.tsx:304](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L304) |
| `TenantOnboardingSections.ad33b8c6` | 写死 | 已驳回 | 提示 | [TenantOnboardingSections.tsx:304](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L304) |
| `TenantOnboardingSections.283f134f` | 写死 | 资质 | 标题 | [TenantOnboardingSections.tsx:319](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L319) |
| `TenantOnboardingSections.68f02b1a` | 写死 | 按{…}的必交清单。营运许可、保险到期前 30 天、7 天各提醒供应商一次，到期当天自动暂停。 | 正文 | [TenantOnboardingSections.tsx:320](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L320) |
| `TenantOnboardingSections.9d49ca34` | 写死 | 国家（{country\_code}） | 正文 | [TenantOnboardingSections.tsx:320](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L320) |
| `TenantOnboardingSections.d13058ca` | 写死 | 通用 | 正文 | [TenantOnboardingSections.tsx:320](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L320) |
| `TenantOnboardingSections.2745c232` | 写死 | 资质清单 | 读屏说明 | [TenantOnboardingSections.tsx:322](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L322) |
| `TenantOnboardingSections.8d6bc032` | 写死 | 证件 | 表头 | [TenantOnboardingSections.tsx:326](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L326) |
| `TenantOnboardingSections.9f61f789` | 写死 | 状态 | 表头 | [TenantOnboardingSections.tsx:327](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L327) |
| `TenantOnboardingSections.1f5c30e6` | 写死 | 到期日 | 表头 | [TenantOnboardingSections.tsx:328](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L328)、428 行 |
| `TenantOnboardingSections.13a53c6f` | 写死 | 最近一次提交 | 表头 | [TenantOnboardingSections.tsx:329](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L329) |
| `TenantOnboardingSections.d9c6f069` | 写死 | 操作 | 表头 | [TenantOnboardingSections.tsx:330](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L330)、617 行 |
| `TenantOnboardingSections.192c6b40` | 写死 | （补充材料） | 正文 | [TenantOnboardingSections.tsx:341](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L341) |
| `TenantOnboardingSections.88a8421a` | 写死 | （新的一份审核中） | 正文 | [TenantOnboardingSections.tsx:345](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L345) |
| `TenantOnboardingSections.882b6ce0` | 写死 | 原因：{review\_reason} | 正文 | [TenantOnboardingSections.tsx:354](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L354) |
| `TenantOnboardingSections.7bb1fef5` | 写死 | 下载 {type\_name} | 读屏说明 | [TenantOnboardingSections.tsx:361](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L361) |
| `TenantOnboardingSections.1c36a3d6` | 写死 | 通过 {type\_name} | 读屏说明 | [TenantOnboardingSections.tsx:367](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L367) |
| `TenantOnboardingSections.242df82d` | 写死 | 通过 | 按钮 | [TenantOnboardingSections.tsx:369](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L369)、406、416 行 |
| `TenantOnboardingSections.a92fd1b7` | 写死 | 要求补充 {type\_name} | 读屏说明 | [TenantOnboardingSections.tsx:370](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L370) |
| `TenantOnboardingSections.31880df0` | 写死 | 要求补充 | 按钮 | [TenantOnboardingSections.tsx:372](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L372)、406、416 行 |
| `TenantOnboardingSections.7e4446b2` | 写死 | 驳回 {type\_name} | 读屏说明 | [TenantOnboardingSections.tsx:373](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L373) |
| `TenantOnboardingSections.57a4ac23` | 写死 | 驳回 | 按钮 | [TenantOnboardingSections.tsx:375](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L375)、406、416 行 |
| `TenantOnboardingSections.c0f569be` | 写死 | 全部提交记录（{length} 份） | 正文 | [TenantOnboardingSections.tsx:389](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L389) |
| `TenantOnboardingSections.94acbf7b` | 写死 |  · 审核：{name} | 正文 | [TenantOnboardingSections.tsx:395](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L395) |
| `TenantOnboardingSections.275e8be1` | 写死 | 文件：{file\_name}。请先下载核对证件上的内容。 | 正文 | [TenantOnboardingSections.tsx:422](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L422) |
| `TenantOnboardingSections.5a5c1783` | 写死 | 供应商填的是 {…}；和证件上的不一样时照证件改正。到期当天起不算有效。 | 正文 | [TenantOnboardingSections.tsx:431](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L431) |
| `TenantOnboardingSections.b2a14eba` | 写死 | （没填） | 正文 | [TenantOnboardingSections.tsx:431](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L431) |
| `TenantOnboardingSections.73c42aff` | 写死 | 要补充什么 | 名称 | [TenantOnboardingSections.tsx:438](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L438) |
| `TenantOnboardingSections.9a2f6541` | 写死 | 驳回原因 | 名称 | [TenantOnboardingSections.tsx:438](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L438) |
| `TenantOnboardingSections.484928f6` | 写死 | 必填：供应商会看到这段文字 | 提示 | [TenantOnboardingSections.tsx:441](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L441) |
| `TenantOnboardingSections.3073a5a5` | 写死 | 供应商会在提醒里看到这段文字。审核中被驳回或要求补充一项必交资质，供应商会退回「申请中」，改好再提交。 | 说明 | [TenantOnboardingSections.tsx:442](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L442) |
| `TenantOnboardingSections.121eee17` | 写死 | 文件太大了：最大 10 MB | 错误提示 | [TenantOnboardingSections.tsx:477](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L477)、488 行 |
| `TenantOnboardingSections.3332e2bf` | 写死 | 已提交合同新版本，等另一位同事审核后写入 | 提示 | [TenantOnboardingSections.tsx:483](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L483) |
| `TenantOnboardingSections.39dd629a` | 写死 | 只收 PDF、JPEG、PNG 文件 | 错误提示 | [TenantOnboardingSections.tsx:488](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L488) |
| `TenantOnboardingSections.807e6dd5` | 写死 | 合同 | 文字 | [TenantOnboardingSections.tsx:496](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L496)、506 行 |
| `TenantOnboardingSections.a6498df8` | 写死 | 发起新版本 | 按钮 | [TenantOnboardingSections.tsx:507](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L507) |
| `TenantOnboardingSections.3fd44a46` | 写死 | 月结、次月 20 日付款；平台不收服务费和保证金。改结算条款（新版本）要另一位同事审核。 | 正文 | [TenantOnboardingSections.tsx:509](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L509) |
| `TenantOnboardingSections.4f25b84a` | 写死 | 还没有合同。 | 正文 | [TenantOnboardingSections.tsx:511](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L511) |
| `TenantOnboardingSections.85bcb035` | 写死 | 合同版本 | 读屏说明 | [TenantOnboardingSections.tsx:514](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L514) |
| `TenantOnboardingSections.baf57085` | 写死 | 版本 | 表头 | [TenantOnboardingSections.tsx:518](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L518) |
| `TenantOnboardingSections.357d5b2d` | 写死 | 生效日期 | 表头 | [TenantOnboardingSections.tsx:519](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L519)、577 行 |
| `TenantOnboardingSections.a26b3591` | 写死 | 结算币种 | 表头 | [TenantOnboardingSections.tsx:520](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L520)、583 行 |
| `TenantOnboardingSections.36530749` | 写死 | 扫描件 | 表头 | [TenantOnboardingSections.tsx:522](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L522) |
| `TenantOnboardingSections.99141676` | 写死 | 第 {version} 版 | 表头 | [TenantOnboardingSections.tsx:529](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L529) |
| `TenantOnboardingSections.7e9f79e6` | 写死 | 现在生效 | 名称 | [TenantOnboardingSections.tsx:530](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L530) |
| `TenantOnboardingSections.1d6e1f90` | 写死 | 下载第 {version} 版合同 | 读屏说明 | [TenantOnboardingSections.tsx:539](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L539) |
| `TenantOnboardingSections.0763c5ea` | 写死 | 有 | 正文 | [TenantOnboardingSections.tsx:543](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L543) |
| `TenantOnboardingSections.dc5ad1eb` | 写死 | 发起合同新版本 | 标题 | [TenantOnboardingSections.tsx:557](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L557) |
| `TenantOnboardingSections.8d17964d` | 写死 | 提交审核 | 按钮 | [TenantOnboardingSections.tsx:568](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L568) |
| `TenantOnboardingSections.1f7cb6fd` | 写死 | 修改结算条款要另一位同事审核：提交以后在「待审核」里批准了才写入。 | 提示 | [TenantOnboardingSections.tsx:573](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L573) |
| `TenantOnboardingSections.c98029fd` | 写死 | 不早于今天（{today}），并且晚于已有的最后一个版本。 | 正文 | [TenantOnboardingSections.tsx:580](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L580) |
| `TenantOnboardingSections.ce51c5b4` | 写死 | 合同扫描件（可选） | 表单标签 | [TenantOnboardingSections.tsx:587](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L587) |
| `TenantOnboardingSections.142e3701` | 写死 | PDF、JPEG、PNG，最大 10 MB。 | 正文 | [TenantOnboardingSections.tsx:594](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L594) |
| `TenantOnboardingSections.26c0b3de` | 写死 | 例如合同编号、改了什么。 | 说明 | [TenantOnboardingSections.tsx:597](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L597) |
| `TenantOnboardingSections.8aa30a58` | 写死 | 还没有状态变化。 | 正文 | [TenantOnboardingSections.tsx:607](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L607) |
| `TenantOnboardingSections.e0064b50` | 写死 | 状态变更记录列表 | 读屏说明 | [TenantOnboardingSections.tsx:610](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L610) |
| `TenantOnboardingSections.13320442` | 写死 | 时间 | 表头 | [TenantOnboardingSections.tsx:614](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L614) |
| `TenantOnboardingSections.5b38f1ca` | 写死 | 动作 | 表头 | [TenantOnboardingSections.tsx:615](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L615) |
| `TenantOnboardingSections.6ecac0e1` | 写死 | 变化 | 表头 | [TenantOnboardingSections.tsx:616](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L616) |
| `TenantOnboardingSections.04e37349` | 写死 | 复核记录 | 链接 | [TenantOnboardingSections.tsx:636](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L636) |
| `TenantOnboardingSections.303851dc` | 写死 | 入驻资料加载中 | 读屏说明 | [TenantOnboardingSections.tsx:666](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L666) |
| `TenantOnboardingSections.c71dbda0` | 写死 | 履约评分 | 标题 | [TenantOnboardingSections.tsx:679](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L679) |
| `TenantOnboardingSections.eef74ddc` | 写死 | 状态变更记录 | 标题 | [TenantOnboardingSections.tsx:685](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx#L685) |

## 多个页面共用：运营后台供应商详情的「企业信息」（TenantProfileSection.tsx）

用在：供应商后台 · 企业信息；运营后台 · 供应商（列表、新建、详情）

文件：`apps/web/src/pages/platform/TenantProfileSection.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantProfileSection.2df2f64c` | 写死 | 最多 {name} 个字 | 提示 | [TenantProfileSection.tsx:38](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L38) |
| `TenantProfileSection.89f42249` | 写死 | 请填对外显示名称 | 提示 | [TenantProfileSection.tsx:38](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L38) |
| `TenantProfileSection.0e361a91` | 写死 | 两位字母的国家代码，如 JP | 提示 | [TenantProfileSection.tsx:39](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L39) |
| `TenantProfileSection.d01def97` | 写死 | 企业信息已保存 | 提示 | [TenantProfileSection.tsx:54](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L54) |
| `TenantProfileSection.2bc2f8f8` | 写死 | 名称已经改好了，但企业信息没有保存： | 文字 | [TenantProfileSection.tsx:58](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L58) |
| `TenantProfileSection.64093185` | 写死 | {prefix}刚被别人改过。请关闭对话框，刷新页面看最新的内容，再改。 | 文字 | [TenantProfileSection.tsx:59](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L59) |
| `TenantProfileSection.170680e4` | 写死 | 保存 | 文字 | [TenantProfileSection.tsx:60](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L60)、81 行 |
| `TenantProfileSection.635a7fbe` | 写死 | 编辑企业信息 | 标题 | [TenantProfileSection.tsx:70](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L70)、305 行 |
| `TenantProfileSection.9a351120` | 写死 | 取消 | 按钮 | [TenantProfileSection.tsx:78](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L78)、148 行 |
| `TenantProfileSection.303687d1` | 写死 | 保存中… | 文字 | [TenantProfileSection.tsx:79](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L79) |
| `TenantProfileSection.e8484fed` | 写死 | 保存后直接生效，记进审计日志。对外显示名称是客人和渠道看到的名字；银行信息在「收款账户」里改。 | 正文 | [TenantProfileSection.tsx:87](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L87) |
| `TenantProfileSection.3da1f8f1` | 写死 | 请写驳回的原因（供应商看得到） | 提示 | [TenantProfileSection.tsx:119](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L119) |
| `TenantProfileSection.67e7ca79` | 写死 | 已驳回修改申请 | 提示 | [TenantProfileSection.tsx:128](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L128) |
| `TenantProfileSection.9ec3fd15` | 写死 | 驳回 | 文字 | [TenantProfileSection.tsx:131](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L131)、151、255 行 |
| `TenantProfileSection.2f251815` | 写死 | 驳回修改申请 | 标题 | [TenantProfileSection.tsx:140](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L140) |
| `TenantProfileSection.88522db7` | 写死 | 驳回中… | 文字 | [TenantProfileSection.tsx:149](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L149) |
| `TenantProfileSection.dfdd4c63` | 写死 | 驳回后原来的内容不变，供应商会收到邮件，可以改好后重新提交。 | 正文 | [TenantProfileSection.tsx:156](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L156) |
| `TenantProfileSection.d814e4ce` | 写死 | 原因 | 表单标签 | [TenantProfileSection.tsx:160](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L160) |
| `TenantProfileSection.9b3da7e1` | 写死 | 申请修改的内容 | 读屏说明 | [TenantProfileSection.tsx:176](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L176) |
| `TenantProfileSection.085bcde7` | 写死 | 项目 | 表头 | [TenantProfileSection.tsx:180](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L180) |
| `TenantProfileSection.fca4a2aa` | 写死 | 现在 | 表头 | [TenantProfileSection.tsx:181](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L181) |
| `TenantProfileSection.1ace79e2` | 写死 | 改成 | 表头 | [TenantProfileSection.tsx:182](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L182) |
| `TenantProfileSection.c531bc6b` | 写死 | 已发起复核，等另一位同事审核后生效 | 提示 | [TenantProfileSection.tsx:216](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L216) |
| `TenantProfileSection.61ddcd7c` | 写死 | 发起复核 | 文字 | [TenantProfileSection.tsx:219](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L219) |
| `TenantProfileSection.908b36ca` | 写死 | 资料修改申请 | 标题 | [TenantProfileSection.tsx:228](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L228) |
| `TenantProfileSection.8b06c63d` | 写死 | 现在没有等处理的申请。 | 正文 | [TenantProfileSection.tsx:230](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L230) |
| `TenantProfileSection.4a99b0bf` | 写死 | 供应商 | 正文 | [TenantProfileSection.tsx:235](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L235) |
| `TenantProfileSection.926a5fc0` | 写死 | {…}（{…}）在 {…} 提交。审核期间客人仍看到原来的内容。 | 正文 | [TenantProfileSection.tsx:235](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L235) |
| `TenantProfileSection.55109435` | 写死 | 说明：{note} | 正文 | [TenantProfileSection.tsx:237](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L237) |
| `TenantProfileSection.db5c216b` | 写死 | 已发起复核，等另一位同事在 | 正文 | [TenantProfileSection.tsx:242](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L242) |
| `TenantProfileSection.2d95a51d` | 写死 | 「待审核」 | 链接 | [TenantProfileSection.tsx:244](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L244) |
| `TenantProfileSection.43bfe0b9` | 写死 | 里批准后生效。 | 正文 | [TenantProfileSection.tsx:246](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L246) |
| `TenantProfileSection.2be3de68` | 写死 | 发起中… | 文字 | [TenantProfileSection.tsx:250](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L250) |
| `TenantProfileSection.8361d1c7` | 写死 | 核对无误，发起复核 | 按钮 | [TenantProfileSection.tsx:252](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L252) |
| `TenantProfileSection.65dd6e10` | 写死 | 最近处理过的 | 标题 | [TenantProfileSection.tsx:263](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L263) |
| `TenantProfileSection.0593ff66` | 写死 | ；驳回原因：{reject\_reason} | 正文 | [TenantProfileSection.tsx:268](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L268) |
| `TenantProfileSection.4c745b68` | 写死 | {…}：{…}（{…} 提交{…}） | 正文 | [TenantProfileSection.tsx:268](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L268) |
| `TenantProfileSection.f8fb79bb` | 写死 | 企业信息 | 标题 | [TenantProfileSection.tsx:304](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L304) |
| `TenantProfileSection.062cc565` | 写死 | 加载失败 | 标题 | [TenantProfileSection.tsx:310](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L310) |
| `TenantProfileSection.cb10fe01` | 写死 | 请检查网络后重试。 | 说明 | [TenantProfileSection.tsx:311](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L311) |
| `TenantProfileSection.cdb4a6f4` | 写死 | 重试 | 按钮 | [TenantProfileSection.tsx:315](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L315) |
| `TenantProfileSection.88971821` | 写死 | 供应商还没有填企业信息。 | 正文 | [TenantProfileSection.tsx:335](../../apps/web/src/pages/platform/TenantProfileSection.tsx#L335) |

## 多个页面共用：订单中心、财务结算几个页面共用的小部件（order-center-parts.tsx）

用在：供应商后台 · 工单；供应商后台 · 收款账户；供应商后台 · 账单；运营后台 · 人工报价；运营后台 · 官网设置；运营后台 · 嵌入组件；运营后台 · 工单详情；运营后台 · 工单（列表、新建）；运营后台 · 异常队列；运营后台 · 收款账户审核和银行文件；运营后台 · 订单（列表、详情）；运营后台 · 财务结算（账单、付款批次）；运营后台 · 赔付表

文件：`apps/web/src/pages/platform/order-center-parts.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `order-center-parts.7dcd7993` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [order-center-parts.tsx:6](../../apps/web/src/pages/platform/order-center-parts.tsx#L6) |
| `order-center-parts.b9989141` | 写死 | 你没有权限查看这里 | 标题 | [order-center-parts.tsx:6](../../apps/web/src/pages/platform/order-center-parts.tsx#L6) |
