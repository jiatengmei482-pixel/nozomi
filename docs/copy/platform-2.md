# 运营后台（第 2 / 3 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 3978 条：写死 3963 条，已走 key 15 条。列的意思见 [README](README.md)。

本区域分 3 份：[第 1 份](platform.md) · 第 2 份 · [第 3 份](platform-3.md)

## 页面

- [救援](#救援)（113 条）
- [异常队列](#异常队列)（79 条）
- [工单（列表、新建）](#工单列表新建)（76 条）
- [工单详情](#工单详情)（176 条）
- [人工报价](#人工报价)（87 条）
- [官网设置](#官网设置)（76 条）
- [嵌入组件](#嵌入组件)（90 条）
- [赔付表](#赔付表)（53 条）
- [财务结算（账单、付款批次）](#财务结算账单付款批次)（121 条）
- [收款账户审核和银行文件](#收款账户审核和银行文件)（114 条）
- [主数据列表（城市、地点、车型组、附加服务）](#主数据列表城市地点车型组附加服务)（82 条）
- [主数据编辑（共用表单）](#主数据编辑共用表单)（55 条）
- [主数据 · 城市](#主数据--城市)（27 条）
- [主数据 · 地点](#主数据--地点)（110 条）
- [主数据 · 车型组和附加服务](#主数据--车型组和附加服务)（57 条）
- [处理导入的机场](#处理导入的机场)（75 条）
- [共享区域去重](#共享区域去重)（59 条）
- [汇率](#汇率)（142 条）
- [多个页面共用：组合框的多选（MultiCombobox.tsx）](#多个页面共用组合框的多选multicomboboxtsx)（8 条）
- [多个页面共用：一次性链接（OneTimeLinkDialog.tsx）](#多个页面共用一次性链接onetimelinkdialogtsx)（22 条）

## 救援

文件：`apps/web/src/pages/platform/RescuePages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `RescuePages.76458a20` | 写死 | 你没有权限查看这里 | 标题 | [RescuePages.tsx:45](../../apps/web/src/pages/platform/RescuePages.tsx#L45) |
| `RescuePages.aff1f8c3` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [RescuePages.tsx:45](../../apps/web/src/pages/platform/RescuePages.tsx#L45) |
| `RescuePages.0f91c5ea` | 写死 | 运营 | 文字 | [RescuePages.tsx:48](../../apps/web/src/pages/platform/RescuePages.tsx#L48) |
| `RescuePages.39956ee0` | 写死 | 供应商 | 文字 | [RescuePages.tsx:48](../../apps/web/src/pages/platform/RescuePages.tsx#L48)、307 行 |
| `RescuePages.6833f0b2` | 写死 | 系统 | 文字 | [RescuePages.tsx:48](../../apps/web/src/pages/platform/RescuePages.tsx#L48) |
| `RescuePages.b9308f51` | 写死 | 救援单待「{name}」接，到 {…} | 说明 | [RescuePages.tsx:61](../../apps/web/src/pages/platform/RescuePages.tsx#L61) |
| `RescuePages.2f13b818` | 写死 | 改派给「{name}」{…} | 说明 | [RescuePages.tsx:62](../../apps/web/src/pages/platform/RescuePages.tsx#L62) |
| `RescuePages.683d7af8` | 写死 | （人工指定） | 说明 | [RescuePages.tsx:62](../../apps/web/src/pages/platform/RescuePages.tsx#L62) |
| `RescuePages.1daf49f3` | 写死 | 发过 {length} 张，都没接 | 说明 | [RescuePages.tsx:63](../../apps/web/src/pages/platform/RescuePages.tsx#L63) |
| `RescuePages.f1ae85d4` | 写死 | 还没发救援单 | 说明 | [RescuePages.tsx:63](../../apps/web/src/pages/platform/RescuePages.tsx#L63) |
| `RescuePages.4e00f537` | 写死 | 救援 · NOZOMI {name} | 浏览器标题 | [RescuePages.tsx:68](../../apps/web/src/pages/platform/RescuePages.tsx#L68) |
| `RescuePages.669203e1` | 写死 | 救援 | 名称 | [RescuePages.tsx:81](../../apps/web/src/pages/platform/RescuePages.tsx#L81)、119 行 |
| `RescuePages.b377a342` | 写死 | 救援改派 | 标题 | [RescuePages.tsx:82](../../apps/web/src/pages/platform/RescuePages.tsx#L82)、446 行 |
| `RescuePages.5ec08693` | 写死 | 已发起 {length} 张{…} | 提示 | [RescuePages.tsx:92](../../apps/web/src/pages/platform/RescuePages.tsx#L92) |
| `RescuePages.d7aac770` | 写死 | ，{length} 张没发起（已在救援中或状态变了） | 提示 | [RescuePages.tsx:92](../../apps/web/src/pages/platform/RescuePages.tsx#L92) |
| `RescuePages.8913bef1` | 写死 | 批量发起 | 文字 | [RescuePages.tsx:97](../../apps/web/src/pages/platform/RescuePages.tsx#L97) |
| `RescuePages.533ccd3e` | 写死 | 只有 4 种情形启动救援改派：供应商声明无法履约、用车前 6 小时仍未派车（系统自动）、司机未到（到点 15 分钟、联系不上）、供应商被暂停。客人付的钱不变；违约金和救援差价记到原供应商的应扣款项，结算时扣。 | 正文 | [RescuePages.tsx:104](../../apps/web/src/pages/platform/RescuePages.tsx#L104) |
| `RescuePages.234a93da` | 写死 | 待处理 | 名称 | [RescuePages.tsx:106](../../apps/web/src/pages/platform/RescuePages.tsx#L106) |
| `RescuePages.3095e29e` | 写死 | 已有结论 | 名称 | [RescuePages.tsx:106](../../apps/web/src/pages/platform/RescuePages.tsx#L106) |
| `RescuePages.ed6cd36a` | 写死 | 看哪些 | 名称 | [RescuePages.tsx:106](../../apps/web/src/pages/platform/RescuePages.tsx#L106) |
| `RescuePages.83242ac7` | 写死 | 请检查网络后刷新。 | 说明 | [RescuePages.tsx:108](../../apps/web/src/pages/platform/RescuePages.tsx#L108) |
| `RescuePages.e3cc5c9d` | 写死 | 救援队列没取到 | 标题 | [RescuePages.tsx:108](../../apps/web/src/pages/platform/RescuePages.tsx#L108) |
| `RescuePages.0e2ca39f` | 写死 | 最近有结论的救援（{length}） | 标题 | [RescuePages.tsx:112](../../apps/web/src/pages/platform/RescuePages.tsx#L112) |
| `RescuePages.a9d79ee3` | 写死 | 待处理的救援（{length}） | 标题 | [RescuePages.tsx:112](../../apps/web/src/pages/platform/RescuePages.tsx#L112) |
| `RescuePages.5943bb5a` | 写死 | 还没有。 | 正文 | [RescuePages.tsx:114](../../apps/web/src/pages/platform/RescuePages.tsx#L114) |
| `RescuePages.6db4f5cb` | 写死 | 现在没有要处理的救援。 | 正文 | [RescuePages.tsx:114](../../apps/web/src/pages/platform/RescuePages.tsx#L114) |
| `RescuePages.b8c02d21` | 写死 | 救援表 | 读屏说明 | [RescuePages.tsx:117](../../apps/web/src/pages/platform/RescuePages.tsx#L117) |
| `RescuePages.ba298da3` | 写死 | 订单号 | 表头 | [RescuePages.tsx:122](../../apps/web/src/pages/platform/RescuePages.tsx#L122) |
| `RescuePages.b56545d3` | 写死 | 用车时间（当地） | 表头 | [RescuePages.tsx:123](../../apps/web/src/pages/platform/RescuePages.tsx#L123) |
| `RescuePages.60bfc4ef` | 写死 | 情形 | 表头 | [RescuePages.tsx:124](../../apps/web/src/pages/platform/RescuePages.tsx#L124)、263、452 行 |
| `RescuePages.043bd6c1` | 写死 | 原供应商 | 表头 | [RescuePages.tsx:125](../../apps/web/src/pages/platform/RescuePages.tsx#L125)、454 行 |
| `RescuePages.46d01105` | 写死 | 违约金 | 表头 | [RescuePages.tsx:126](../../apps/web/src/pages/platform/RescuePages.tsx#L126)、456 行 |
| `RescuePages.5dae544c` | 写死 | 状态 | 表头 | [RescuePages.tsx:127](../../apps/web/src/pages/platform/RescuePages.tsx#L127)、457 行 |
| `RescuePages.4ede6da9` | 写死 | 进展 | 表头 | [RescuePages.tsx:128](../../apps/web/src/pages/platform/RescuePages.tsx#L128) |
| `RescuePages.8ca109aa` | 写死 |  · 不可抗力已免除 | 正文 | [RescuePages.tsx:144](../../apps/web/src/pages/platform/RescuePages.tsx#L144) |
| `RescuePages.258ba23e` | 写死 | 司机未到的提醒（{length}） | 标题 | [RescuePages.tsx:160](../../apps/web/src/pages/platform/RescuePages.tsx#L160) |
| `RescuePages.6586ee1c` | 写死 | 到点 15 分钟司机仍未「已到达」，或客人报告司机没到。先联系司机和供应商；联系不上就在订单详情里按「司机未到」发起救援，或取消订单、请客人自行打车凭票报销。 | 正文 | [RescuePages.tsx:161](../../apps/web/src/pages/platform/RescuePages.tsx#L161) |
| `RescuePages.a47f0d70` | 写死 |  · {…} 发现到点 15 分钟未到 | 正文 | [RescuePages.tsx:171](../../apps/web/src/pages/platform/RescuePages.tsx#L171) |
| `RescuePages.e01fb31f` | 写死 |  · {…} 客人报告司机没到 | 正文 | [RescuePages.tsx:172](../../apps/web/src/pages/platform/RescuePages.tsx#L172) |
| `RescuePages.695b934b` | 写死 | 你的角色限定了数据范围：暂停中供应商的批量救援不在这里（会动到这家供应商在各城市、各渠道的全部订单）。单张订单可以在订单详情里发起救援；需要批量发起时，请不限数据范围的同事处理。 | 正文 | [RescuePages.tsx:181](../../apps/web/src/pages/platform/RescuePages.tsx#L181) |
| `RescuePages.411d5ad6` | 写死 | 暂停中、还有未来订单的供应商 | 标题 | [RescuePages.tsx:185](../../apps/web/src/pages/platform/RescuePages.tsx#L185) |
| `RescuePages.7841d31c` | 写死 | 暂停后已有订单照常履约；要改派给别的供应商时在这里批量发起（违约金按距用车时间 0 / 30% / 100%）。 | 正文 | [RescuePages.tsx:186](../../apps/web/src/pages/platform/RescuePages.tsx#L186) |
| `RescuePages.03828c14` | 写死 | {name}：{future\_orders} 张未来订单  | 正文 | [RescuePages.tsx:190](../../apps/web/src/pages/platform/RescuePages.tsx#L190) |
| `RescuePages.1a2b1c20` | 写死 | 批量发起救援：{name} | 按钮 | [RescuePages.tsx:193](../../apps/web/src/pages/platform/RescuePages.tsx#L193)、206 行 |
| `RescuePages.323211bc` | 写死 | 先不发 | 按钮 | [RescuePages.tsx:214](../../apps/web/src/pages/platform/RescuePages.tsx#L214) |
| `RescuePages.f5990b87` | 写死 | 发起 {orders} 张 | 按钮 | [RescuePages.tsx:216](../../apps/web/src/pages/platform/RescuePages.tsx#L216) |
| `RescuePages.0ecc6512` | 写死 | {name}名下 {orders} 张还没开始的订单会进入救援改派，供应商不能再操作这些单。 | 正文 | [RescuePages.tsx:221](../../apps/web/src/pages/platform/RescuePages.tsx#L221) |
| `RescuePages.788e42d1` | 写死 | 说明（选填） | 名称 | [RescuePages.tsx:222](../../apps/web/src/pages/platform/RescuePages.tsx#L222) |
| `RescuePages.0f13c98e` | 写死 | 这张订单还没付款：付款完成、订单确认后才能发起救援改派。请刷新页面看订单现在的状态。 | 提示 | [RescuePages.tsx:235](../../apps/web/src/pages/platform/RescuePages.tsx#L235) |
| `RescuePages.7da9e98b` | 写死 | 发起救援 | 文字 | [RescuePages.tsx:236](../../apps/web/src/pages/platform/RescuePages.tsx#L236) |
| `RescuePages.6d9b4004` | 写死 | 请写明情况（会记进审计日志） | 文字 | [RescuePages.tsx:247](../../apps/web/src/pages/platform/RescuePages.tsx#L247) |
| `RescuePages.42c800d4` | 写死 | 已进入救援改派，违约金 {…}%：请看候选、发救援单 | 文字 | [RescuePages.tsx:254](../../apps/web/src/pages/platform/RescuePages.tsx#L254) |
| `RescuePages.60f8cf65` | 写死 | 发起救援改派 | 标题 | [RescuePages.tsx:262](../../apps/web/src/pages/platform/RescuePages.tsx#L262)、493 行 |
| `RescuePages.75ae5817` | 写死 | 发起 | 按钮 | [RescuePages.tsx:262](../../apps/web/src/pages/platform/RescuePages.tsx#L262) |
| `RescuePages.c7399331` | 写死 | 先不发起 | 按钮 | [RescuePages.tsx:262](../../apps/web/src/pages/platform/RescuePages.tsx#L262) |
| `RescuePages.c9de3e4d` | 写死 | 情况说明 | 名称 | [RescuePages.tsx:265](../../apps/web/src/pages/platform/RescuePages.tsx#L265) |
| `RescuePages.51ba09f6` | 写死 | 发起后原供应商不能再操作这一单（司机链接立即作废），违约金按情形和距用车时间记账。 | 提示 | [RescuePages.tsx:266](../../apps/web/src/pages/platform/RescuePages.tsx#L266) |
| `RescuePages.57a66734` | 写死 | 已给「{name}」发救援单：15 分钟（用车前 2 小时内 5 分钟）不接会自动顺延下一家 | 文字 | [RescuePages.tsx:282](../../apps/web/src/pages/platform/RescuePages.tsx#L282) |
| `RescuePages.de29d20d` | 写死 | 发救援单 | 文字 | [RescuePages.tsx:284](../../apps/web/src/pages/platform/RescuePages.tsx#L284) |
| `RescuePages.61f6d5a7` | 写死 | 救援候选 | 标题 | [RescuePages.tsx:291](../../apps/web/src/pages/platform/RescuePages.tsx#L291) |
| `RescuePages.e592b23a` | 写死 | 关闭 | 按钮 | [RescuePages.tsx:291](../../apps/web/src/pages/platform/RescuePages.tsx#L291) |
| `RescuePages.b26ab41c` | 写死 | 按原报价条件（同一个渠道、这一单的车型组、现在的用车时间）重新比价，排除以前接过这一单的和已经发过的，按中标排序。差价是改派给它时原供应商要承担的（为负记 0）。 | 正文 | [RescuePages.tsx:292](../../apps/web/src/pages/platform/RescuePages.tsx#L292) |
| `RescuePages.bf8fe890` | 写死 | 差价 = 结算价 − 救援差价基准：{…} | 正文 | [RescuePages.tsx:293](../../apps/web/src/pages/platform/RescuePages.tsx#L293) |
| `RescuePages.73a394f4` | 写死 | 候选没取到，请稍后再试。 | 提示 | [RescuePages.tsx:294](../../apps/web/src/pages/platform/RescuePages.tsx#L294) |
| `RescuePages.765b9a4d` | 写死 | 现在没有能接这一单的候选。可以人工指定（双人复核），或取消订单全额退款（原因选「供应商原因」）。 | 提示 | [RescuePages.tsx:298](../../apps/web/src/pages/platform/RescuePages.tsx#L298) |
| `RescuePages.05ccc908` | 写死 | 候选表 | 读屏说明 | [RescuePages.tsx:301](../../apps/web/src/pages/platform/RescuePages.tsx#L301) |
| `RescuePages.0978fd59` | 写死 | 候选 | 正文 | [RescuePages.tsx:303](../../apps/web/src/pages/platform/RescuePages.tsx#L303) |
| `RescuePages.29f0c4da` | 写死 | 名次 | 表头 | [RescuePages.tsx:306](../../apps/web/src/pages/platform/RescuePages.tsx#L306) |
| `RescuePages.a03b6178` | 写死 | 结算价 | 表头 | [RescuePages.tsx:308](../../apps/web/src/pages/platform/RescuePages.tsx#L308) |
| `RescuePages.8687f99a` | 写死 | 对外价 | 表头 | [RescuePages.tsx:309](../../apps/web/src/pages/platform/RescuePages.tsx#L309) |
| `RescuePages.afc078e2` | 写死 | 原供应商承担的差价 | 表头 | [RescuePages.tsx:310](../../apps/web/src/pages/platform/RescuePages.tsx#L310) |
| `RescuePages.94d574d3` | 写死 | 操作 | 表头 | [RescuePages.tsx:311](../../apps/web/src/pages/platform/RescuePages.tsx#L311) |
| `RescuePages.c0187383` | 写死 | （加急价） | 表头 | [RescuePages.tsx:318](../../apps/web/src/pages/platform/RescuePages.tsx#L318) |
| `RescuePages.6e9bd1a1` | 写死 | 换算不了 | 正文 | [RescuePages.tsx:321](../../apps/web/src/pages/platform/RescuePages.tsx#L321) |
| `RescuePages.eb77ebfc` | 写死 | 发救援单给 {name} | 按钮 | [RescuePages.tsx:324](../../apps/web/src/pages/platform/RescuePages.tsx#L324) |
| `RescuePages.b6376861` | 写死 | 没能当候选的 | 标题 | [RescuePages.tsx:336](../../apps/web/src/pages/platform/RescuePages.tsx#L336) |
| `RescuePages.f27956b7` | 写死 | 没有可以指定的供应商商品 | 文字 | [RescuePages.tsx:364](../../apps/web/src/pages/platform/RescuePages.tsx#L364) |
| `RescuePages.bb2e6458` | 写死 | 结算价写成大于 0 的数，如 22000 | 文字 | [RescuePages.tsx:368](../../apps/web/src/pages/platform/RescuePages.tsx#L368) |
| `RescuePages.527fc3dd` | 写死 | 请写明和供应商谈好的情况 | 文字 | [RescuePages.tsx:372](../../apps/web/src/pages/platform/RescuePages.tsx#L372) |
| `RescuePages.fe8f13a9` | 写死 | 已提交人工指定：要另一位同事在「待审核」里批准才会改派 | 文字 | [RescuePages.tsx:379](../../apps/web/src/pages/platform/RescuePages.tsx#L379) |
| `RescuePages.7985438f` | 写死 | 人工指定 | 文字 | [RescuePages.tsx:381](../../apps/web/src/pages/platform/RescuePages.tsx#L381) |
| `RescuePages.11d028d3` | 写死 | 先不指定 | 按钮 | [RescuePages.tsx:387](../../apps/web/src/pages/platform/RescuePages.tsx#L387) |
| `RescuePages.96fe2e73` | 写死 | 提交审核 | 按钮 | [RescuePages.tsx:387](../../apps/web/src/pages/platform/RescuePages.tsx#L387) |
| `RescuePages.aa809bfc` | 写死 | 人工指定救援供应商 | 标题 | [RescuePages.tsx:387](../../apps/web/src/pages/platform/RescuePages.tsx#L387) |
| `RescuePages.3b01792c` | 写死 | 候选都不接、或电话联系好的供应商报不出价时用。提交后要另一位有审核权限的同事批准才生效；批准后直接改派，不用它再接单。 | 正文 | [RescuePages.tsx:388](../../apps/web/src/pages/platform/RescuePages.tsx#L388) |
| `RescuePages.8d56f552` | 写死 | 供应商和商品 | 名称 | [RescuePages.tsx:389](../../apps/web/src/pages/platform/RescuePages.tsx#L389) |
| `RescuePages.0dd1ec9b` | 写死 | 谈好的结算价（这家的结算币种，现在按 {currency}） | 名称 | [RescuePages.tsx:390](../../apps/web/src/pages/platform/RescuePages.tsx#L390) |
| `RescuePages.eec8b4cf` | 写死 | 如「电话联系，对方同意 22,000 接」 | 说明 | [RescuePages.tsx:391](../../apps/web/src/pages/platform/RescuePages.tsx#L391) |
| `RescuePages.fcd14af8` | 写死 | 说明 | 名称 | [RescuePages.tsx:391](../../apps/web/src/pages/platform/RescuePages.tsx#L391)、421 行 |
| `RescuePages.84a549ba` | 写死 | 请写明是什么不可抗力（会给供应商看、记进审计日志） | 文字 | [RescuePages.tsx:404](../../apps/web/src/pages/platform/RescuePages.tsx#L404) |
| `RescuePages.8ff85004` | 写死 | 已认定不可抗力，免除了 {waived} 条应扣款项 | 文字 | [RescuePages.tsx:411](../../apps/web/src/pages/platform/RescuePages.tsx#L411) |
| `RescuePages.69af59c8` | 写死 | 认定不可抗力 | 文字 | [RescuePages.tsx:413](../../apps/web/src/pages/platform/RescuePages.tsx#L413)、419、508 行 |
| `RescuePages.cbb4c9da` | 写死 | 不认定 | 按钮 | [RescuePages.tsx:419](../../apps/web/src/pages/platform/RescuePages.tsx#L419) |
| `RescuePages.ce4e50a9` | 写死 | 认定 | 按钮 | [RescuePages.tsx:419](../../apps/web/src/pages/platform/RescuePages.tsx#L419) |
| `RescuePages.4a085e5f` | 写死 | 大雪封路、机场关闭、政府管制等：原供应商这次救援的违约金和救援差价全部免除。客人全额退款请另外「代客人取消」，原因选「不可抗力」。 | 正文 | [RescuePages.tsx:420](../../apps/web/src/pages/platform/RescuePages.tsx#L420) |
| `RescuePages.309a6a27` | 写死 | 如「大雪，东关东自动车道封闭」 | 说明 | [RescuePages.tsx:421](../../apps/web/src/pages/platform/RescuePages.tsx#L421) |
| `RescuePages.bb732976` | 写死 | 原因 / 说明 | 名称 | [RescuePages.tsx:453](../../apps/web/src/pages/platform/RescuePages.tsx#L453) |
| `RescuePages.1fb61805` | 写死 | {name} · 原结算价 {…} | 正文 | [RescuePages.tsx:454](../../apps/web/src/pages/platform/RescuePages.tsx#L454) |
| `RescuePages.b10468fe` | 写死 | 救援差价基准 | 名称 | [RescuePages.tsx:455](../../apps/web/src/pages/platform/RescuePages.tsx#L455) |
| `RescuePages.cf545025` | 写死 | 救援结算价 | 名称 | [RescuePages.tsx:461](../../apps/web/src/pages/platform/RescuePages.tsx#L461) |
| `RescuePages.23f167a8` | 写死 | {…} 认定：{note} | 正文 | [RescuePages.tsx:462](../../apps/web/src/pages/platform/RescuePages.tsx#L462) |
| `RescuePages.d170e969` | 写死 | 不可抗力 | 名称 | [RescuePages.tsx:462](../../apps/web/src/pages/platform/RescuePages.tsx#L462) |
| `RescuePages.e38b7975` | 写死 | 救援单 | 读屏说明 | [RescuePages.tsx:465](../../apps/web/src/pages/platform/RescuePages.tsx#L465) |
| `RescuePages.5ba95404` | 写死 |  · 对外价 {…} | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.860538e4` | 写死 | 运营发出 | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.ab484c40` | 写死 |  · 第 {position} 名 | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.cb436e94` | 写死 |  · 拒绝原因：{decline\_reason} | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.cd3993a3` | 写死 |  {name} · 结算价 {…}{…}{…} · {…} {…}，期限 {…}{…} | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.fc515309` | 写死 | 自动顺延 | 正文 | [RescuePages.tsx:469](../../apps/web/src/pages/platform/RescuePages.tsx#L469) |
| `RescuePages.9bb0cf4f` | 写死 | 应扣款项 | 读屏说明 | [RescuePages.tsx:475](../../apps/web/src/pages/platform/RescuePages.tsx#L475) |
| `RescuePages.8619eef9` | 写死 | 违约金和救援差价现在只记账，结算时从原供应商的账单里扣。客人付的钱不变。 | 正文 | [RescuePages.tsx:487](../../apps/web/src/pages/platform/RescuePages.tsx#L487) |
| `RescuePages.e8c89ad6` | 写死 | 看候选并发救援单 | 按钮 | [RescuePages.tsx:498](../../apps/web/src/pages/platform/RescuePages.tsx#L498) |
| `RescuePages.9648693e` | 写死 | 人工指定（双人复核） | 按钮 | [RescuePages.tsx:503](../../apps/web/src/pages/platform/RescuePages.tsx#L503) |

## 异常队列

文件：`apps/web/src/pages/platform/ExceptionPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ExceptionPages.5d23ab19` | 写死 | 异常队列 | 名称 | [ExceptionPages.tsx:39](../../apps/web/src/pages/platform/ExceptionPages.tsx#L39)、94、95、159 行 |
| `ExceptionPages.3bb496a7` | 写死 | 待处理和处理中 | 文字 | [ExceptionPages.tsx:40](../../apps/web/src/pages/platform/ExceptionPages.tsx#L40) |
| `ExceptionPages.490afa7e` | 写死 | 待处理 | 文字 | [ExceptionPages.tsx:40](../../apps/web/src/pages/platform/ExceptionPages.tsx#L40) |
| `ExceptionPages.5e371904` | 写死 | 处理中 | 文字 | [ExceptionPages.tsx:40](../../apps/web/src/pages/platform/ExceptionPages.tsx#L40) |
| `ExceptionPages.8201d561` | 写死 | 已关闭 | 文字 | [ExceptionPages.tsx:40](../../apps/web/src/pages/platform/ExceptionPages.tsx#L40) |
| `ExceptionPages.73780e49` | 写死 | 状态 | 名称 | [ExceptionPages.tsx:55](../../apps/web/src/pages/platform/ExceptionPages.tsx#L55)、123 行 |
| `ExceptionPages.b5553df2` | 写死 | 类型 | 名称 | [ExceptionPages.tsx:58](../../apps/web/src/pages/platform/ExceptionPages.tsx#L58) |
| `ExceptionPages.bd407eba` | 写死 | 全部 | 名称 | [ExceptionPages.tsx:60](../../apps/web/src/pages/platform/ExceptionPages.tsx#L60)、67、70 行 |
| `ExceptionPages.20ad1eb1` | 写死 | 处理人 | 名称 | [ExceptionPages.tsx:65](../../apps/web/src/pages/platform/ExceptionPages.tsx#L65)、134、339 行 |
| `ExceptionPages.d8f16b66` | 写死 | 我 | 名称 | [ExceptionPages.tsx:67](../../apps/web/src/pages/platform/ExceptionPages.tsx#L67) |
| `ExceptionPages.79274dee` | 写死 | 时限 | 名称 | [ExceptionPages.tsx:70](../../apps/web/src/pages/platform/ExceptionPages.tsx#L70) |
| `ExceptionPages.e94863a0` | 写死 | 只看已超时 | 名称 | [ExceptionPages.tsx:70](../../apps/web/src/pages/platform/ExceptionPages.tsx#L70) |
| `ExceptionPages.46d54968` | 写死 | 异常队列 · NOZOMI {name} | 浏览器标题 | [ExceptionPages.tsx:77](../../apps/web/src/pages/platform/ExceptionPages.tsx#L77) |
| `ExceptionPages.e7385159` | 写死 | 异常 | 文字 | [ExceptionPages.tsx:114](../../apps/web/src/pages/platform/ExceptionPages.tsx#L114)、241 行 |
| `ExceptionPages.615cc134` | 写死 | 订单号 | 文字 | [ExceptionPages.tsx:131](../../apps/web/src/pages/platform/ExceptionPages.tsx#L131) |
| `ExceptionPages.a680ef20` | 写死 | 供应商 | 文字 | [ExceptionPages.tsx:132](../../apps/web/src/pages/platform/ExceptionPages.tsx#L132)、305 行 |
| `ExceptionPages.15430a2a` | 写死 | 处理时限 | 文字 | [ExceptionPages.tsx:133](../../apps/web/src/pages/platform/ExceptionPages.tsx#L133)、309 行 |
| `ExceptionPages.4bd21ed1` | 写死 | 发现时间 | 文字 | [ExceptionPages.tsx:135](../../apps/web/src/pages/platform/ExceptionPages.tsx#L135)、306 行 |
| `ExceptionPages.4f160cd4` | 写死 | 清空筛选 | 按钮 | [ExceptionPages.tsx:138](../../apps/web/src/pages/platform/ExceptionPages.tsx#L138) |
| `ExceptionPages.5be458a5` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [ExceptionPages.tsx:138](../../apps/web/src/pages/platform/ExceptionPages.tsx#L138) |
| `ExceptionPages.fe4ef4a7` | 写死 | 没有符合条件的异常 | 标题 | [ExceptionPages.tsx:138](../../apps/web/src/pages/platform/ExceptionPages.tsx#L138) |
| `ExceptionPages.b32fd0f0` | 写死 | 系统每分钟检查一次订单：超时未派车、司机未出发或未到达、推送失败、待审核、支付异常等会自动出现在这里，条件解除后自动关闭。 | 说明 | [ExceptionPages.tsx:140](../../apps/web/src/pages/platform/ExceptionPages.tsx#L140) |
| `ExceptionPages.bdbd7907` | 写死 | 现在没有要处理的异常 | 标题 | [ExceptionPages.tsx:140](../../apps/web/src/pages/platform/ExceptionPages.tsx#L140) |
| `ExceptionPages.b5b2e829` | 写死 | 运营每天从这里开始：系统自动发现要人处理的订单，按处理时限从早到晚排。处理本身在订单详情里做（催供应商、救援、重推、重试退款、审核加收）；这里记谁在处理、写什么结论。时间按你的本地时区（{…}）显示。 | 正文 | [ExceptionPages.tsx:144](../../apps/web/src/pages/platform/ExceptionPages.tsx#L144) |
| `ExceptionPages.c87e39d5` | 写死 | 订单：{…} | 正文 | [ExceptionPages.tsx:151](../../apps/web/src/pages/platform/ExceptionPages.tsx#L151) |
| `ExceptionPages.d0830d0b` | 写死 | 指定的订单 | 正文 | [ExceptionPages.tsx:151](../../apps/web/src/pages/platform/ExceptionPages.tsx#L151) |
| `ExceptionPages.c1dd3c87` | 写死 | 去掉条件「只看这一单」 | 读屏说明 | [ExceptionPages.tsx:152](../../apps/web/src/pages/platform/ExceptionPages.tsx#L152) |
| `ExceptionPages.1eaecd06` | 写死 | 请选择交给谁 | 文字 | [ExceptionPages.tsx:188](../../apps/web/src/pages/platform/ExceptionPages.tsx#L188) |
| `ExceptionPages.7d80e685` | 写死 | 已交给「{…}」 | 文字 | [ExceptionPages.tsx:195](../../apps/web/src/pages/platform/ExceptionPages.tsx#L195) |
| `ExceptionPages.e232c829` | 写死 | 同事 | 文字 | [ExceptionPages.tsx:195](../../apps/web/src/pages/platform/ExceptionPages.tsx#L195) |
| `ExceptionPages.33eb37a4` | 写死 | 转交 | 文字 | [ExceptionPages.tsx:197](../../apps/web/src/pages/platform/ExceptionPages.tsx#L197)、216 行 |
| `ExceptionPages.50710ca2` | 写死 | 这条异常已经有别人在处理了，只有他能转交。关掉对话框后页面会刷新。 | 文字 | [ExceptionPages.tsx:197](../../apps/web/src/pages/platform/ExceptionPages.tsx#L197) |
| `ExceptionPages.4de21b5b` | 写死 | 指派给同事 | 标题 | [ExceptionPages.tsx:205](../../apps/web/src/pages/platform/ExceptionPages.tsx#L205)、369 行 |
| `ExceptionPages.c1119a09` | 写死 | 转交给同事 | 标题 | [ExceptionPages.tsx:205](../../apps/web/src/pages/platform/ExceptionPages.tsx#L205)、370 行 |
| `ExceptionPages.2b547758` | 写死 | 取消 | 按钮 | [ExceptionPages.tsx:214](../../apps/web/src/pages/platform/ExceptionPages.tsx#L214) |
| `ExceptionPages.b231680f` | 写死 | 提交中… | 文字 | [ExceptionPages.tsx:215](../../apps/web/src/pages/platform/ExceptionPages.tsx#L215) |
| `ExceptionPages.0ce10e63` | 写死 | 指派 | 按钮 | [ExceptionPages.tsx:216](../../apps/web/src/pages/platform/ExceptionPages.tsx#L216) |
| `ExceptionPages.44030d7a` | 写死 | 转交以后由他处理，你不再是处理人。 | 正文 | [ExceptionPages.tsx:222](../../apps/web/src/pages/platform/ExceptionPages.tsx#L222) |
| `ExceptionPages.be45bffb` | 写死 | 指派以后这条异常算「处理中」，由他处理。 | 正文 | [ExceptionPages.tsx:222](../../apps/web/src/pages/platform/ExceptionPages.tsx#L222) |
| `ExceptionPages.3137c6df` | 写死 | 只列在用的平台员工；对方要有处理异常的权限才能关闭它。 | 说明 | [ExceptionPages.tsx:223](../../apps/web/src/pages/platform/ExceptionPages.tsx#L223) |
| `ExceptionPages.589bf191` | 写死 | 交给谁 | 名称 | [ExceptionPages.tsx:223](../../apps/web/src/pages/platform/ExceptionPages.tsx#L223) |
| `ExceptionPages.7a37d0e6` | 写死 | 请选择 | 输入框占位 | [ExceptionPages.tsx:223](../../apps/web/src/pages/platform/ExceptionPages.tsx#L223) |
| `ExceptionPages.79666ce2` | 写死 | {title} · 异常队列 · NOZOMI {name} | 浏览器标题 | [ExceptionPages.tsx:242](../../apps/web/src/pages/platform/ExceptionPages.tsx#L242) |
| `ExceptionPages.09dfe3c2` | 写死 | 它可能不在你的数据范围里，或链接有误。 | 说明 | [ExceptionPages.tsx:249](../../apps/web/src/pages/platform/ExceptionPages.tsx#L249) |
| `ExceptionPages.78c3e1ef` | 写死 | 找不到这条异常 | 标题 | [ExceptionPages.tsx:249](../../apps/web/src/pages/platform/ExceptionPages.tsx#L249) |
| `ExceptionPages.48b3e008` | 写死 | 重试 | 按钮 | [ExceptionPages.tsx:253](../../apps/web/src/pages/platform/ExceptionPages.tsx#L253) |
| `ExceptionPages.609aeebc` | 写死 | 加载失败 | 标题 | [ExceptionPages.tsx:253](../../apps/web/src/pages/platform/ExceptionPages.tsx#L253) |
| `ExceptionPages.91b3e922` | 写死 | 请检查网络后重试。 | 说明 | [ExceptionPages.tsx:253](../../apps/web/src/pages/platform/ExceptionPages.tsx#L253) |
| `ExceptionPages.db82ce04` | 写死 | 已认领，现在由你处理 | 提示 | [ExceptionPages.tsx:268](../../apps/web/src/pages/platform/ExceptionPages.tsx#L268) |
| `ExceptionPages.b6e99ba2` | 写死 | 别的同事 | 文字 | [ExceptionPages.tsx:272](../../apps/web/src/pages/platform/ExceptionPages.tsx#L272) |
| `ExceptionPages.56e1ef5f` | 写死 | 这条异常刚被「{other}」认领了。要转交请让他在这里点「转交给同事」；页面已刷新成最新的样子。 | 文字 | [ExceptionPages.tsx:273](../../apps/web/src/pages/platform/ExceptionPages.tsx#L273) |
| `ExceptionPages.02dc10d4` | 写死 | 这条异常已经关闭了（可能是条件解除，系统自动关的）。页面已刷新。 | 文字 | [ExceptionPages.tsx:276](../../apps/web/src/pages/platform/ExceptionPages.tsx#L276) |
| `ExceptionPages.bcee740c` | 写死 | 认领 | 文字 | [ExceptionPages.tsx:278](../../apps/web/src/pages/platform/ExceptionPages.tsx#L278)、367 行 |
| `ExceptionPages.42fa2a1d` | 写死 | 情况 | 标题 | [ExceptionPages.tsx:293](../../apps/web/src/pages/platform/ExceptionPages.tsx#L293) |
| `ExceptionPages.19bff88d` | 写死 | 订单 | 名称 | [ExceptionPages.tsx:300](../../apps/web/src/pages/platform/ExceptionPages.tsx#L300) |
| `ExceptionPages.fd2343ad` | 写死 | 处理方式 | 标题 | [ExceptionPages.tsx:318](../../apps/web/src/pages/platform/ExceptionPages.tsx#L318) |
| `ExceptionPages.0eac1cc6` | 写死 | 时间按你的本地时区（{…}）显示。 | 正文 | [ExceptionPages.tsx:320](../../apps/web/src/pages/platform/ExceptionPages.tsx#L320) |
| `ExceptionPages.85284173` | 写死 | 去订单详情处理 | 链接 | [ExceptionPages.tsx:324](../../apps/web/src/pages/platform/ExceptionPages.tsx#L324) |
| `ExceptionPages.f090e0f7` | 写死 | 看这条异常的操作记录 | 链接 | [ExceptionPages.tsx:328](../../apps/web/src/pages/platform/ExceptionPages.tsx#L328) |
| `ExceptionPages.7d9537ff` | 写死 | 处理 | 读屏说明 | [ExceptionPages.tsx:333](../../apps/web/src/pages/platform/ExceptionPages.tsx#L333)、337 行 |
| `ExceptionPages.1814e299` | 写死 | 认领时间 | 名称 | [ExceptionPages.tsx:341](../../apps/web/src/pages/platform/ExceptionPages.tsx#L341) |
| `ExceptionPages.e5264783` | 写死 | 关闭方式 | 名称 | [ExceptionPages.tsx:345](../../apps/web/src/pages/platform/ExceptionPages.tsx#L345) |
| `ExceptionPages.e1c763bf` | 写死 | 关闭时间 | 名称 | [ExceptionPages.tsx:347](../../apps/web/src/pages/platform/ExceptionPages.tsx#L347) |
| `ExceptionPages.16a1c253` | 写死 | 关闭人 | 名称 | [ExceptionPages.tsx:351](../../apps/web/src/pages/platform/ExceptionPages.tsx#L351) |
| `ExceptionPages.6a4afb67` | 写死 | 处理说明 | 名称 | [ExceptionPages.tsx:353](../../apps/web/src/pages/platform/ExceptionPages.tsx#L353)、384 行 |
| `ExceptionPages.1983194a` | 写死 | 已关闭，不能再认领或修改。 | 正文 | [ExceptionPages.tsx:358](../../apps/web/src/pages/platform/ExceptionPages.tsx#L358) |
| `ExceptionPages.87c450ca` | 写死 | 你可以查看，但没有处理异常的权限。 | 正文 | [ExceptionPages.tsx:359](../../apps/web/src/pages/platform/ExceptionPages.tsx#L359) |
| `ExceptionPages.a8287fbe` | 写死 | 「{…}」正在处理。要转交请让他操作；处理完了谁都可以写说明关闭。 | 正文 | [ExceptionPages.tsx:362](../../apps/web/src/pages/platform/ExceptionPages.tsx#L362) |
| `ExceptionPages.ca0e5910` | 写死 | 认领中… | 文字 | [ExceptionPages.tsx:365](../../apps/web/src/pages/platform/ExceptionPages.tsx#L365) |
| `ExceptionPages.4efe8b59` | 写死 | 写说明并关闭 | 按钮 | [ExceptionPages.tsx:373](../../apps/web/src/pages/platform/ExceptionPages.tsx#L373) |
| `ExceptionPages.acef82c4` | 写死 | 关闭这条异常？ | 标题 | [ExceptionPages.tsx:382](../../apps/web/src/pages/platform/ExceptionPages.tsx#L382) |
| `ExceptionPages.42269065` | 写死 | 关闭表示已经处理完了。处理说明会记进审计日志，订单详情里也看得到。关闭后不能重新打开；同样的问题再发生时系统会另外生成一条。 | 正文 | [ExceptionPages.tsx:383](../../apps/web/src/pages/platform/ExceptionPages.tsx#L383) |
| `ExceptionPages.27dc2a29` | 写死 | 请写处理说明：做了什么、结果怎样 | 文字 | [ExceptionPages.tsx:385](../../apps/web/src/pages/platform/ExceptionPages.tsx#L385) |
| `ExceptionPages.b05b9c1e` | 写死 | 如「已电话催供应商，14:20 派车」「退款已在 Stripe 后台核实成功」 | 说明 | [ExceptionPages.tsx:386](../../apps/web/src/pages/platform/ExceptionPages.tsx#L386) |
| `ExceptionPages.477b4408` | 写死 | 关闭异常 | 按钮 | [ExceptionPages.tsx:387](../../apps/web/src/pages/platform/ExceptionPages.tsx#L387) |
| `ExceptionPages.d911580d` | 写死 | 关闭中… | 文字 | [ExceptionPages.tsx:388](../../apps/web/src/pages/platform/ExceptionPages.tsx#L388) |
| `ExceptionPages.acd106f2` | 写死 | 关闭 | 按钮 | [ExceptionPages.tsx:389](../../apps/web/src/pages/platform/ExceptionPages.tsx#L389) |
| `ExceptionPages.74497399` | 写死 | 这条异常已经关闭了（可能是条件解除，系统自动关的）。 | 文字 | [ExceptionPages.tsx:390](../../apps/web/src/pages/platform/ExceptionPages.tsx#L390) |
| `ExceptionPages.88f30d57` | 写死 | 已关闭这条异常 | 提示 | [ExceptionPages.tsx:399](../../apps/web/src/pages/platform/ExceptionPages.tsx#L399) |

## 工单（列表、新建）

文件：`apps/web/src/pages/platform/TicketPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TicketPages.6e64514d` | 写死 | 没有结论的 | 文字 | [TicketPages.tsx:37](../../apps/web/src/pages/platform/TicketPages.tsx#L37) |
| `TicketPages.98d815e6` | 写死 | 全部 | 文字 | [TicketPages.tsx:37](../../apps/web/src/pages/platform/TicketPages.tsx#L37)、56、63、66 行 |
| `TicketPages.7beaa3b6` | 写死 | 状态 | 名称 | [TicketPages.tsx:51](../../apps/web/src/pages/platform/TicketPages.tsx#L51)、135 行 |
| `TicketPages.d4886ea9` | 写死 | 类型 | 名称 | [TicketPages.tsx:54](../../apps/web/src/pages/platform/TicketPages.tsx#L54)、132、349 行 |
| `TicketPages.4a8cd580` | 写死 | 处理人 | 名称 | [TicketPages.tsx:61](../../apps/web/src/pages/platform/TicketPages.tsx#L61)、149 行 |
| `TicketPages.a82e7123` | 写死 | 我 | 名称 | [TicketPages.tsx:63](../../apps/web/src/pages/platform/TicketPages.tsx#L63) |
| `TicketPages.1228479e` | 写死 | 时效 | 名称 | [TicketPages.tsx:66](../../apps/web/src/pages/platform/TicketPages.tsx#L66) |
| `TicketPages.53c3266c` | 写死 | 只看已超时 | 名称 | [TicketPages.tsx:66](../../apps/web/src/pages/platform/TicketPages.tsx#L66) |
| `TicketPages.abd8b180` | 写死 | 工单 · NOZOMI {name} | 浏览器标题 | [TicketPages.tsx:73](../../apps/web/src/pages/platform/TicketPages.tsx#L73) |
| `TicketPages.6df711aa` | 写死 | 新建工单 | 按钮 | [TicketPages.tsx:95](../../apps/web/src/pages/platform/TicketPages.tsx#L95)、281、282、329、363 行 |
| `TicketPages.a1ed10f8` | 写死 | 工单 | 名称 | [TicketPages.tsx:98](../../apps/web/src/pages/platform/TicketPages.tsx#L98)、99、119、167、281 行 |
| `TicketPages.c51d6465` | 写死 | 订单号 | 文字 | [TicketPages.tsx:147](../../apps/web/src/pages/platform/TicketPages.tsx#L147)、244 行 |
| `TicketPages.7a1095af` | 写死 | 供应商 | 文字 | [TicketPages.tsx:148](../../apps/web/src/pages/platform/TicketPages.tsx#L148) |
| `TicketPages.c817a17c` | 写死 | 结案期限 | 文字 | [TicketPages.tsx:150](../../apps/web/src/pages/platform/TicketPages.tsx#L150) |
| `TicketPages.704207d4` | 写死 | 创建时间 | 文字 | [TicketPages.tsx:151](../../apps/web/src/pages/platform/TicketPages.tsx#L151) |
| `TicketPages.04f13296` | 写死 | 清空筛选 | 按钮 | [TicketPages.tsx:154](../../apps/web/src/pages/platform/TicketPages.tsx#L154) |
| `TicketPages.86a14524` | 写死 | 没有符合条件的工单 | 标题 | [TicketPages.tsx:154](../../apps/web/src/pages/platform/TicketPages.tsx#L154) |
| `TicketPages.9b035036` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [TicketPages.tsx:154](../../apps/web/src/pages/platform/TicketPages.tsx#L154) |
| `TicketPages.11eeac0e` | 写死 | 现在没有待处理的工单 | 标题 | [TicketPages.tsx:156](../../apps/web/src/pages/platform/TicketPages.tsx#L156) |
| `TicketPages.20e025d2` | 写死 | 客人、渠道、供应商提的问题和系统生成的 no-show 审核都会出现在这里。客服也可以从订单详情代客人登记。 | 说明 | [TicketPages.tsx:156](../../apps/web/src/pages/platform/TicketPages.tsx#L156) |
| `TicketPages.fb72b632` | 写死 | 所有需要人来判断的事都走工单。时效：首次响应 2 小时（用车当天的紧急工单 15 分钟），3 个工作日内结案。时间按你的本地时区（{…}）显示。 | 正文 | [TicketPages.tsx:161](../../apps/web/src/pages/platform/TicketPages.tsx#L161) |
| `TicketPages.893050e6` | 写死 | 你可以查看工单，但不能处理。 | 提示 | [TicketPages.tsx:162](../../apps/web/src/pages/platform/TicketPages.tsx#L162) |
| `TicketPages.115ee2d4` | 写死 | 按工单号或订单号查找（完整的号） | 名称 | [TicketPages.tsx:163](../../apps/web/src/pages/platform/TicketPages.tsx#L163) |
| `TicketPages.f75e5f90` | 写死 | 迟到、未举牌、车况、司机态度等；成立时按统一赔付表赔客人 | 文字 | [TicketPages.tsx:190](../../apps/web/src/pages/platform/TicketPages.tsx#L190) |
| `TicketPages.a8515f94` | 写死 | 司机没到、没送到目的地等；成立时按赔付表处理，计入履约失败 | 提示 | [TicketPages.tsx:191](../../apps/web/src/pages/platform/TicketPages.tsx#L191) |
| `TicketPages.9a678374` | 写死 | 超出自助范围的改单（改单本身在订单详情里做） | 文字 | [TicketPages.tsx:192](../../apps/web/src/pages/platform/TicketPages.tsx#L192) |
| `TicketPages.8092238e` | 写死 | 客人把东西落在车上 | 文字 | [TicketPages.tsx:193](../../apps/web/src/pages/platform/TicketPages.tsx#L193) |
| `TicketPages.29a48059` | 写死 | 不属于以上任何一类、但要有人跟进的事 | 文字 | [TicketPages.tsx:194](../../apps/web/src/pages/platform/TicketPages.tsx#L194) |
| `TicketPages.4611dda7` | 写死 | 中文 | 名称 | [TicketPages.tsx:198](../../apps/web/src/pages/platform/TicketPages.tsx#L198) |
| `TicketPages.f601814a` | 写死 | 日语 | 名称 | [TicketPages.tsx:199](../../apps/web/src/pages/platform/TicketPages.tsx#L199) |
| `TicketPages.da68de6c` | 写死 | 英语 | 名称 | [TicketPages.tsx:200](../../apps/web/src/pages/platform/TicketPages.tsx#L200) |
| `TicketPages.2d6f464e` | 写死 | 韩语 | 名称 | [TicketPages.tsx:201](../../apps/web/src/pages/platform/TicketPages.tsx#L201) |
| `TicketPages.40d935bd` | 写死 | 这张订单没有付过款就取消了，不能建工单。 | 文字 | [TicketPages.tsx:207](../../apps/web/src/pages/platform/TicketPages.tsx#L207) |
| `TicketPages.b346a6a0` | 写死 | 这张订单还没付款，付款完成后才能建工单。 | 文字 | [TicketPages.tsx:207](../../apps/web/src/pages/platform/TicketPages.tsx#L207) |
| `TicketPages.fb035850` | 写死 | 请填订单号 | 文字 | [TicketPages.tsx:220](../../apps/web/src/pages/platform/TicketPages.tsx#L220) |
| `TicketPages.9948ec54` | 写死 | 没有找到这张订单。请核对订单号（平台订单号或渠道订单号，要完整）。 | 文字 | [TicketPages.tsx:228](../../apps/web/src/pages/platform/TicketPages.tsx#L228) |
| `TicketPages.98d41271` | 写死 | 查找订单 | 文字 | [TicketPages.tsx:232](../../apps/web/src/pages/platform/TicketPages.tsx#L232) |
| `TicketPages.b1aac584` | 写死 | 先找到订单 | 标题 | [TicketPages.tsx:241](../../apps/web/src/pages/platform/TicketPages.tsx#L241) |
| `TicketPages.5f8a5f99` | 写死 | 工单一定绑定一张订单。也可以从订单详情点「新建工单」，订单会自动带上。 | 正文 | [TicketPages.tsx:242](../../apps/web/src/pages/platform/TicketPages.tsx#L242) |
| `TicketPages.2ed09e40` | 写死 | 平台订单号（NZ 开头）或渠道订单号 | 说明 | [TicketPages.tsx:244](../../apps/web/src/pages/platform/TicketPages.tsx#L244) |
| `TicketPages.d2ae5806` | 写死 | 查找中… | 文字 | [TicketPages.tsx:245](../../apps/web/src/pages/platform/TicketPages.tsx#L245) |
| `TicketPages.75ff1ef9` | 写死 | 查找 | 按钮 | [TicketPages.tsx:247](../../apps/web/src/pages/platform/TicketPages.tsx#L247) |
| `TicketPages.52a66381` | 写死 | 新建工单 · NOZOMI {name} | 浏览器标题 | [TicketPages.tsx:265](../../apps/web/src/pages/platform/TicketPages.tsx#L265) |
| `TicketPages.132a0da5` | 写死 | 它可能不在你的数据范围里，或链接有误。 | 说明 | [TicketPages.tsx:289](../../apps/web/src/pages/platform/TicketPages.tsx#L289) |
| `TicketPages.2cccca9c` | 写死 | 找不到这张订单 | 标题 | [TicketPages.tsx:289](../../apps/web/src/pages/platform/TicketPages.tsx#L289) |
| `TicketPages.6c62107f` | 写死 | 按订单号查找 | 按钮 | [TicketPages.tsx:289](../../apps/web/src/pages/platform/TicketPages.tsx#L289) |
| `TicketPages.42123d12` | 写死 | 重试 | 按钮 | [TicketPages.tsx:292](../../apps/web/src/pages/platform/TicketPages.tsx#L292) |
| `TicketPages.d3d0030b` | 写死 | 请检查网络后重试。 | 说明 | [TicketPages.tsx:292](../../apps/web/src/pages/platform/TicketPages.tsx#L292) |
| `TicketPages.f765835c` | 写死 | 订单没有加载出来 | 标题 | [TicketPages.tsx:292](../../apps/web/src/pages/platform/TicketPages.tsx#L292) |
| `TicketPages.3adea2e4` | 写死 | 这张订单还不能建工单 | 标题 | [TicketPages.tsx:296](../../apps/web/src/pages/platform/TicketPages.tsx#L296) |
| `TicketPages.f7c74e38` | 写死 | 回到订单 | 按钮 | [TicketPages.tsx:296](../../apps/web/src/pages/platform/TicketPages.tsx#L296) |
| `TicketPages.38315665` | 写死 | 请选择工单类型 | 文字 | [TicketPages.tsx:303](../../apps/web/src/pages/platform/TicketPages.tsx#L303) |
| `TicketPages.16cf161d` | 写死 | 请写标题 | 文字 | [TicketPages.tsx:304](../../apps/web/src/pages/platform/TicketPages.tsx#L304) |
| `TicketPages.4e0f240e` | 写死 | 请写清楚发生了什么 | 文字 | [TicketPages.tsx:305](../../apps/web/src/pages/platform/TicketPages.tsx#L305) |
| `TicketPages.32177b3e` | 写死 | 已新建工单「{ticket\_no}」 | 提示 | [TicketPages.tsx:326](../../apps/web/src/pages/platform/TicketPages.tsx#L326) |
| `TicketPages.053c225d` | 写死 | {…}你填写的内容还在。 | 文字 | [TicketPages.tsx:329](../../apps/web/src/pages/platform/TicketPages.tsx#L329) |
| `TicketPages.adfdea03` | 写死 | 订单 | 标题 | [TicketPages.tsx:340](../../apps/web/src/pages/platform/TicketPages.tsx#L340) |
| `TicketPages.379d3108` | 写死 |  · {…}（当地）· {name} · {name} | 正文 | [TicketPages.tsx:345](../../apps/web/src/pages/platform/TicketPages.tsx#L345) |
| `TicketPages.01007859` | 写死 | {name}（现在的供应商） | 名称 | [TicketPages.tsx:351](../../apps/web/src/pages/platform/TicketPages.tsx#L351) |
| `TicketPages.0c4e9c04` | 写死 | 被投诉的供应商 | 名称 | [TicketPages.tsx:351](../../apps/web/src/pages/platform/TicketPages.tsx#L351) |
| `TicketPages.1dc0d3e7` | 写死 | {name}（救援改派前的供应商） | 名称 | [TicketPages.tsx:351](../../apps/web/src/pages/platform/TicketPages.tsx#L351) |
| `TicketPages.8c8132e8` | 写死 | 司机未到的投诉常常是对救援改派前的那一家。 | 说明 | [TicketPages.tsx:351](../../apps/web/src/pages/platform/TicketPages.tsx#L351) |
| `TicketPages.34a0283d` | 写死 | {…}（客服代登记） | 名称 | [TicketPages.tsx:352](../../apps/web/src/pages/platform/TicketPages.tsx#L352) |
| `TicketPages.c0b075d6` | 写死 | 谁提出的 | 名称 | [TicketPages.tsx:352](../../apps/web/src/pages/platform/TicketPages.tsx#L352) |
| `TicketPages.f46d29aa` | 写死 | 客服自己发现的 | 名称 | [TicketPages.tsx:352](../../apps/web/src/pages/platform/TicketPages.tsx#L352) |
| `TicketPages.5f04db55` | 写死 | 按规则（用车当天为紧急） | 名称 | [TicketPages.tsx:353](../../apps/web/src/pages/platform/TicketPages.tsx#L353) |
| `TicketPages.9a140411` | 写死 | 优先级 | 名称 | [TicketPages.tsx:353](../../apps/web/src/pages/platform/TicketPages.tsx#L353) |
| `TicketPages.0c67d989` | 写死 | 一句话说清楚，如「司机迟到 25 分钟」 | 说明 | [TicketPages.tsx:354](../../apps/web/src/pages/platform/TicketPages.tsx#L354) |
| `TicketPages.18199334` | 写死 | 标题 | 名称 | [TicketPages.tsx:354](../../apps/web/src/pages/platform/TicketPages.tsx#L354) |
| `TicketPages.53df8462` | 写死 | 客人怎么说的、什么时间、有什么证据。供应商能看到工单的描述。 | 说明 | [TicketPages.tsx:355](../../apps/web/src/pages/platform/TicketPages.tsx#L355) |
| `TicketPages.9d5b340d` | 写死 | 经过 | 名称 | [TicketPages.tsx:355](../../apps/web/src/pages/platform/TicketPages.tsx#L355) |
| `TicketPages.a0a9d114` | 写死 | 不填 | 名称 | [TicketPages.tsx:356](../../apps/web/src/pages/platform/TicketPages.tsx#L356) |
| `TicketPages.dfd34823` | 写死 | 客人用什么语言（选填） | 名称 | [TicketPages.tsx:356](../../apps/web/src/pages/platform/TicketPages.tsx#L356) |
| `TicketPages.a8e15d0f` | 写死 | 取消 | 按钮 | [TicketPages.tsx:360](../../apps/web/src/pages/platform/TicketPages.tsx#L360) |
| `TicketPages.1356d5a0` | 写死 | 新建中… | 文字 | [TicketPages.tsx:361](../../apps/web/src/pages/platform/TicketPages.tsx#L361) |
| `TicketPages.428e185b` | 写死 | 投诉要在服务结束后 14 天内；客人、渠道每张单最多提 10 张工单。 | 正文 | [TicketPages.tsx:365](../../apps/web/src/pages/platform/TicketPages.tsx#L365) |

## 工单详情

文件：`apps/web/src/pages/platform/TicketDetailPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TicketDetailPage.42ec65d8` | 写死 | 工单 | 名称 | [TicketDetailPage.tsx:74](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L74)、440 行 |
| `TicketDetailPage.573fbe2a` | 写死 | 这张工单刚被别人改过。关掉对话框后页面会刷新，请看过最新的情况再操作。 | 提示 | [TicketDetailPage.tsx:79](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L79) |
| `TicketDetailPage.ea8dcfa3` | 写死 | 还在等供应商回复（24 小时内）。期限到了没回复就视为认可，那时再判定。 | 提示 | [TicketDetailPage.tsx:80](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L80) |
| `TicketDetailPage.d86586c2` | 写死 | 你判定或复核过原来那张工单，不能判它的申诉。请交给另一位同事处理。 | 提示 | [TicketDetailPage.tsx:81](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L81) |
| `TicketDetailPage.4908dbc9` | 写死 | 汇率中心最近 48 小时没有客人支付币种对日元的汇率，算不出「至少等值 ¥500」。请先到汇率页处理，再判定。 | 提示 | [TicketDetailPage.tsx:82](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L82) |
| `TicketDetailPage.a52d1be4` | 写死 | 请写{label} | 错误提示 | [TicketDetailPage.tsx:111](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L111) |
| `TicketDetailPage.57d8117c` | 写死 | 发送 | 文字 | [TicketDetailPage.tsx:120](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L120)、715 行 |
| `TicketDetailPage.f31fe806` | 写死 | {…}你写的内容还在。 | 错误提示 | [TicketDetailPage.tsx:120](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L120) |
| `TicketDetailPage.d60894e1` | 写死 | 第 {table\_version} 版 · {scenario\_name} · 对外价的 {…} | 文字 | [TicketDetailPage.tsx:141](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L141) |
| `TicketDetailPage.f7c9cc12` | 写死 | 赔付表 | 文字 | [TicketDetailPage.tsx:141](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L141) |
| `TicketDetailPage.6d47a9e4` | 写死 | 按比例 | 文字 | [TicketDetailPage.tsx:142](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L142) |
| `TicketDetailPage.c3ac74d0` | 写死 | 车型差价 | 文字 | [TicketDetailPage.tsx:143](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L143) |
| `TicketDetailPage.1eca77f1` | 写死 | 每笔最低 | 文字 | [TicketDetailPage.tsx:144](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L144) |
| `TicketDetailPage.42e66cb0` | 写死 | （按比例不够，补足到最低额，补的部分平台承担） | 文字 | [TicketDetailPage.tsx:144](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L144) |
| `TicketDetailPage.cf8f7d7e` | 写死 | 赔客人合计 | 文字 | [TicketDetailPage.tsx:145](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L145)、653 行 |
| `TicketDetailPage.2d7bb5ff` | 写死 | 替代交通报销 | 文字 | [TicketDetailPage.tsx:146](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L146)、654 行 |
| `TicketDetailPage.c963b1a6` | 写死 | {…}（上限 {…}） | 文字 | [TicketDetailPage.tsx:146](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L146) |
| `TicketDetailPage.84030a82` | 写死 | 退回原卡 | 文字 | [TicketDetailPage.tsx:147](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L147)、655 行 |
| `TicketDetailPage.d4d3fac0` | 写死 | 财务另付 | 文字 | [TicketDetailPage.tsx:148](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L148)、656 行 |
| `TicketDetailPage.87fc92b1` | 写死 | 供应商承担 | 文字 | [TicketDetailPage.tsx:149](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L149)、657 行 |
| `TicketDetailPage.97e3057b` | 写死 |  + 差价 {…} | 文字 | [TicketDetailPage.tsx:149](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L149) |
| `TicketDetailPage.e940a6df` | 写死 | {…}（结算价 × 同一比例 {…}{…}{…}） | 文字 | [TicketDetailPage.tsx:149](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L149) |
| `TicketDetailPage.ecc71c69` | 写死 |  + 报销 {…} | 文字 | [TicketDetailPage.tsx:149](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L149) |
| `TicketDetailPage.ec5132e2` | 写死 | 你没有查看订单的权限，看不到证据。需要的话请联系管理员开通。 | 文字 | [TicketDetailPage.tsx:167](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L167) |
| `TicketDetailPage.2e522cd9` | 写死 | 这一单不在你的数据范围里，看不到证据。 | 文字 | [TicketDetailPage.tsx:168](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L168) |
| `TicketDetailPage.df5286d2` | 写死 | 证据没有加载出来，请检查网络后重试。 | 正文 | [TicketDetailPage.tsx:179](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L179) |
| `TicketDetailPage.1fcebb89` | 写死 | 重新加载 | 按钮 | [TicketDetailPage.tsx:182](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L182)、317 行 |
| `TicketDetailPage.7770363b` | 写死 | no-show 证据 | 标题 | [TicketDetailPage.tsx:191](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L191) |
| `TicketDetailPage.f46ef1a1` | 写死 | 请选择是哪种问题 | 文字 | [TicketDetailPage.tsx:228](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L228) |
| `TicketDetailPage.9b8ab51a` | 写死 | 请选择责任方 | 文字 | [TicketDetailPage.tsx:229](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L229) |
| `TicketDetailPage.413acdbc` | 写死 | 结算币种 | 文字 | [TicketDetailPage.tsx:234](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L234)、345 行 |
| `TicketDetailPage.62da2e64` | 写死 | 请填两个车型组的结算价之差（{…}，大于 0） | 文字 | [TicketDetailPage.tsx:234](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L234) |
| `TicketDetailPage.c6554b67` | 写死 | 客人支付币种 | 文字 | [TicketDetailPage.tsx:238](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L238)、346 行 |
| `TicketDetailPage.d88fdb0d` | 写死 | 报销金额写成大于 0 的数（{…}），没有票据就不填 | 文字 | [TicketDetailPage.tsx:238](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L238) |
| `TicketDetailPage.81a4f2ba` | 写死 | {…}你填写的内容还在。 | 文字 | [TicketDetailPage.tsx:247](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L247) |
| `TicketDetailPage.4db3cc17` | 写死 | 试算 | 文字 | [TicketDetailPage.tsx:257](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L257)、356 行 |
| `TicketDetailPage.3d7bc42e` | 写死 | 请选择结论 | 文字 | [TicketDetailPage.tsx:265](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L265) |
| `TicketDetailPage.5b75ddf4` | 写死 | 请写判定说明：依据是什么 | 文字 | [TicketDetailPage.tsx:266](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L266) |
| `TicketDetailPage.726149ff` | 写死 | 成立的要先点「试算」，看过赔多少再提交 | 文字 | [TicketDetailPage.tsx:271](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L271) |
| `TicketDetailPage.11212653` | 写死 | 判定 | 文字 | [TicketDetailPage.tsx:281](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L281)、591、610 行 |
| `TicketDetailPage.4c2faddf` | 写死 | 判定：{…} | 标题 | [TicketDetailPage.tsx:289](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L289) |
| `TicketDetailPage.36e0545c` | 写死 | 知道了 | 按钮 | [TicketDetailPage.tsx:297](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L297) |
| `TicketDetailPage.58f0ef13` | 写死 | 取消 | 按钮 | [TicketDetailPage.tsx:297](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L297)、399 行 |
| `TicketDetailPage.3cf97d4f` | 写死 | 提交中… | 文字 | [TicketDetailPage.tsx:300](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L300)、399 行 |
| `TicketDetailPage.2c414664` | 写死 | 确认判定 | 按钮 | [TicketDetailPage.tsx:301](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L301) |
| `TicketDetailPage.3e6de52f` | 写死 | 提交复核 | 按钮 | [TicketDetailPage.tsx:301](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L301) |
| `TicketDetailPage.3e67a284` | 写死 | 证据加载中…加载完才能判定。 | 正文 | [TicketDetailPage.tsx:311](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L311) |
| `TicketDetailPage.e3c3a618` | 写死 | 证据没有加载出来，看不到证据不能判定。 | 正文 | [TicketDetailPage.tsx:314](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L314) |
| `TicketDetailPage.5b17cf52` | 写死 | 结论 | 标题 | [TicketDetailPage.tsx:322](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L322)、612 行 |
| `TicketDetailPage.1302a3ab` | 写死 | 证据显示司机根本没到场（按「司机未到」计履约失败） | 正文 | [TicketDetailPage.tsx:326](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L326) |
| `TicketDetailPage.f24885b7` | 写死 | 订单没有加载出来，算不了赔付。请检查网络后关掉对话框重试。 | 提示 | [TicketDetailPage.tsx:331](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L331) |
| `TicketDetailPage.4b0f1027` | 写死 | 是哪种问题（统一赔付表） | 名称 | [TicketDetailPage.tsx:332](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L332) |
| `TicketDetailPage.aa9da283` | 写死 | 请选择 | 输入框占位 | [TicketDetailPage.tsx:332](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L332)、401 行 |
| `TicketDetailPage.efaa201e` | 写死 | 责任方 | 标题 | [TicketDetailPage.tsx:334](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L334)、613 行 |
| `TicketDetailPage.79311c78` | 写死 | 按结算价同一比例承担，记成它的应扣款项，计入评分 | 说明 | [TicketDetailPage.tsx:339](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L339) |
| `TicketDetailPage.94cfda09` | 写死 | 客人照样按表赔，供应商不承担、不计评分 | 说明 | [TicketDetailPage.tsx:340](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L340) |
| `TicketDetailPage.84155e5a` | 写死 | 两个车型组的结算价之差（{…}） | 名称 | [TicketDetailPage.tsx:345](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L345) |
| `TicketDetailPage.f4e40872` | 写死 | 从被投诉供应商的价格表看；客人那边的差价按订单报价时的汇率和加价换算 | 说明 | [TicketDetailPage.tsx:345](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L345) |
| `TicketDetailPage.b73a3207` | 写死 | 上限是对外价的 1.5 倍，超出的不给；退不回卡上，由财务另付 | 说明 | [TicketDetailPage.tsx:346](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L346) |
| `TicketDetailPage.c1986e2a` | 写死 | 客人凭票申请报销的替代交通（{…}，选填） | 名称 | [TicketDetailPage.tsx:346](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L346) |
| `TicketDetailPage.ca4190f1` | 写死 | 重大投诉（影响供应商转正式） | 正文 | [TicketDetailPage.tsx:350](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L350) |
| `TicketDetailPage.aa529770` | 写死 | 试算中… | 文字 | [TicketDetailPage.tsx:354](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L354) |
| `TicketDetailPage.5c68fc32` | 写死 | 试算结果 | 读屏说明 | [TicketDetailPage.tsx:360](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L360) |
| `TicketDetailPage.b9966011` | 写死 | 判定后这一单会按「供应商原因」取消：客人付的钱全额退回，供应商应得 0。 | 提示 | [TicketDetailPage.tsx:362](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L362) |
| `TicketDetailPage.e70e21cc` | 写死 | 赔给客人的钱达到了复核阈值：提交后要另一位有审核权限的同事在「待审核」里批准才执行。 | 提示 | [TicketDetailPage.tsx:363](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L363) |
| `TicketDetailPage.1a7bc1da` | 写死 | 依据是什么（司机定位、照片、双方说法）。供应商看得到这段说明。 | 说明 | [TicketDetailPage.tsx:368](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L368) |
| `TicketDetailPage.2833cfba` | 写死 | 判定说明 | 名称 | [TicketDetailPage.tsx:368](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L368) |
| `TicketDetailPage.a4de2de5` | 写死 | 请选择交给谁 | 文字 | [TicketDetailPage.tsx:385](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L385) |
| `TicketDetailPage.296833ee` | 写死 | 同事 | 文字 | [TicketDetailPage.tsx:391](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L391) |
| `TicketDetailPage.b0165ed7` | 写死 | 转交 | 文字 | [TicketDetailPage.tsx:393](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L393) |
| `TicketDetailPage.010ad055` | 写死 | 交给同事处理 | 标题 | [TicketDetailPage.tsx:399](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L399) |
| `TicketDetailPage.586b0695` | 写死 | 交给他 | 按钮 | [TicketDetailPage.tsx:399](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L399) |
| `TicketDetailPage.c50f4d13` | 写死 | 交给谁 | 名称 | [TicketDetailPage.tsx:401](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L401) |
| `TicketDetailPage.fa84e4d4` | 写死 | 只列在用的平台员工；对方要有处理工单的权限。 | 说明 | [TicketDetailPage.tsx:401](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L401) |
| `TicketDetailPage.5321fa9b` | 写死 | ；免除说明：{waive\_reason} | 正文 | [TicketDetailPage.tsx:415](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L415) |
| `TicketDetailPage.ff7c71e7` | 写死 | 工单 {ticket\_no} | 标题 | [TicketDetailPage.tsx:440](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L440) |
| `TicketDetailPage.1a4f4656` | 写死 | 它可能不在你的数据范围里，或链接有误。 | 说明 | [TicketDetailPage.tsx:448](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L448) |
| `TicketDetailPage.eac1782b` | 写死 | 找不到这张工单 | 标题 | [TicketDetailPage.tsx:448](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L448) |
| `TicketDetailPage.0d660ccc` | 写死 | 重试 | 按钮 | [TicketDetailPage.tsx:450](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L450) |
| `TicketDetailPage.751f69cc` | 写死 | 请检查网络后重试。 | 说明 | [TicketDetailPage.tsx:450](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L450) |
| `TicketDetailPage.dd3bc90d` | 写死 | 加载失败 | 标题 | [TicketDetailPage.tsx:450](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L450) |
| `TicketDetailPage.05a78700` | 写死 | 已认领，现在由你处理 | 提示 | [TicketDetailPage.tsx:465](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L465) |
| `TicketDetailPage.c578e71c` | 写死 | 认领 | 文字 | [TicketDetailPage.tsx:467](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L467)、583 行 |
| `TicketDetailPage.4282e5aa` | 写死 | 你 | 文字 | [TicketDetailPage.tsx:474](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L474)、475 行 |
| `TicketDetailPage.cc626521` | 写死 | {…}（客人看到的是「平台的回复」） | 文字 | [TicketDetailPage.tsx:475](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L475) |
| `TicketDetailPage.8d024c18` | 写死 | 判定待复核 | 正文 | [TicketDetailPage.tsx:486](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L486) |
| `TicketDetailPage.8a4ed711` | 写死 | 赔给客人的钱达到了复核阈值，要另一位有审核权限的同事批准后才执行；驳回、撤回后回到「处理中」，可以重新判定。 | 正文 | [TicketDetailPage.tsx:487](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L487) |
| `TicketDetailPage.deea660f` | 写死 | 去「待审核」 | 链接 | [TicketDetailPage.tsx:488](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L488) |
| `TicketDetailPage.85f3a843` | 写死 | 类型 | 名称 | [TicketDetailPage.tsx:507](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L507) |
| `TicketDetailPage.c742cea3` | 写死 | 谁提出的 | 名称 | [TicketDetailPage.tsx:508](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L508) |
| `TicketDetailPage.4189e092` | 写死 | 优先级 | 名称 | [TicketDetailPage.tsx:509](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L509) |
| `TicketDetailPage.3e076ecd` | 写死 | 订单 | 名称 | [TicketDetailPage.tsx:510](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L510)、658 行 |
| `TicketDetailPage.2d2d6300` | 写死 | 供应商 | 名称 | [TicketDetailPage.tsx:515](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L515) |
| `TicketDetailPage.82159150` | 写死 | 创建时间 | 名称 | [TicketDetailPage.tsx:516](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L516) |
| `TicketDetailPage.7465817f` | 写死 | 已响应（{…}） | 正文 | [TicketDetailPage.tsx:519](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L519) |
| `TicketDetailPage.860652d9` | 写死 | 首次响应期限 | 名称 | [TicketDetailPage.tsx:519](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L519) |
| `TicketDetailPage.7f36dab9` | 写死 | 结案期限 | 名称 | [TicketDetailPage.tsx:520](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L520) |
| `TicketDetailPage.70fbad2b` | 写死 | 已回复（{…}） | 正文 | [TicketDetailPage.tsx:521](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L521) |
| `TicketDetailPage.9d0e03ad` | 写死 | 等回复，期限 {…} | 正文 | [TicketDetailPage.tsx:521](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L521) |
| `TicketDetailPage.ecb370ef` | 写死 | 征求供应商意见 | 名称 | [TicketDetailPage.tsx:521](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L521)、587、709 行 |
| `TicketDetailPage.f6480d36` | 写死 | 申诉的是 | 名称 | [TicketDetailPage.tsx:523](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L523) |
| `TicketDetailPage.ab9ea5e3` | 写死 | 时间按你的本地时区（{…}）显示。 | 正文 | [TicketDetailPage.tsx:531](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L531) |
| `TicketDetailPage.ca106167` | 写死 | 看这张工单的操作记录 | 链接 | [TicketDetailPage.tsx:535](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L535) |
| `TicketDetailPage.1a68612b` | 写死 | 和供应商的对话 | 标题 | [TicketDetailPage.tsx:542](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L542) |
| `TicketDetailPage.26df9942` | 写死 | 这里的每一条供应商都看得到（看不到是哪位同事写的，只显示「平台」）。 | 正文 | [TicketDetailPage.tsx:543](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L543) |
| `TicketDetailPage.f574c7bc` | 写死 | 还没有对话。 | 空状态 | [TicketDetailPage.tsx:544](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L544) |
| `TicketDetailPage.823ae48b` | 写死 | 发送中… | 文字 | [TicketDetailPage.tsx:545](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L545)、555、714 行 |
| `TicketDetailPage.8c451b2d` | 写死 | 发给供应商 | 按钮 | [TicketDetailPage.tsx:545](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L545)、713 行 |
| `TicketDetailPage.961dea49` | 写死 | 已发给供应商 | 文字 | [TicketDetailPage.tsx:545](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L545) |
| `TicketDetailPage.b8c218b0` | 写死 | 发给供应商的话 | 名称 | [TicketDetailPage.tsx:545](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L545) |
| `TicketDetailPage.d19985ae` | 写死 | 要供应商在 24 小时内答复的，用右边的「征求供应商意见」。 | 说明 | [TicketDetailPage.tsx:545](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L545) |
| `TicketDetailPage.8be34bf8` | 写死 | 回复客人 | 标题 | [TicketDetailPage.tsx:552](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L552)、555 行 |
| `TicketDetailPage.629b1d80` | 写死 | 渠道查这张工单时看得到这里的回复（不显示是哪位同事）；供应商看不到。 | 正文 | [TicketDetailPage.tsx:553](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L553) |
| `TicketDetailPage.d656083d` | 写死 | 客人在官网订单页的「投诉和反馈」里看得到这里的回复（不显示是哪位同事）；供应商看不到。 | 正文 | [TicketDetailPage.tsx:553](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L553) |
| `TicketDetailPage.39b184a6` | 写死 | 还没有回复客人。 | 空状态 | [TicketDetailPage.tsx:554](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L554) |
| `TicketDetailPage.3c8d8160` | 写死 | 写给客人看的话：核实进度、结论、补偿怎么给。不要写供应商的结算价。 | 说明 | [TicketDetailPage.tsx:555](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L555) |
| `TicketDetailPage.da4c8d56` | 写死 | 给客人的回复 | 名称 | [TicketDetailPage.tsx:555](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L555) |
| `TicketDetailPage.ee9a6b8e` | 写死 | 已回复客人 | 文字 | [TicketDetailPage.tsx:555](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L555) |
| `TicketDetailPage.daed7269` | 写死 | 内部备注 | 标题 | [TicketDetailPage.tsx:562](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L562)、565 行 |
| `TicketDetailPage.d915d84b` | 写死 | 只有平台员工看得到，供应商看不到。 | 正文 | [TicketDetailPage.tsx:563](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L563) |
| `TicketDetailPage.5d87fd73` | 写死 | 还没有备注。 | 空状态 | [TicketDetailPage.tsx:564](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L564) |
| `TicketDetailPage.5b6fccd5` | 写死 | 已加备注 | 文字 | [TicketDetailPage.tsx:565](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L565) |
| `TicketDetailPage.791a656c` | 写死 | 同事之间的讨论、电话记录。 | 说明 | [TicketDetailPage.tsx:565](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L565) |
| `TicketDetailPage.83fadecb` | 写死 | 保存中… | 文字 | [TicketDetailPage.tsx:565](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L565) |
| `TicketDetailPage.bf13fa72` | 写死 | 加备注 | 按钮 | [TicketDetailPage.tsx:565](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L565) |
| `TicketDetailPage.1f8d4b0a` | 写死 | 处理和判定 | 读屏说明 | [TicketDetailPage.tsx:569](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L569) |
| `TicketDetailPage.69528736` | 写死 | 处理 | 标题 | [TicketDetailPage.tsx:573](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L573) |
| `TicketDetailPage.2c59b71e` | 写死 | 处理人 | 名称 | [TicketDetailPage.tsx:575](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L575) |
| `TicketDetailPage.e0037870` | 写死 | 你可以查看，但没有处理工单的权限。 | 正文 | [TicketDetailPage.tsx:577](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L577) |
| `TicketDetailPage.46bb6ec6` | 写死 | 已关闭，不能再处理。 | 正文 | [TicketDetailPage.tsx:578](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L578) |
| `TicketDetailPage.a412785b` | 写死 | 认领中… | 文字 | [TicketDetailPage.tsx:582](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L582) |
| `TicketDetailPage.cfc2281c` | 写死 | 改由我处理 | 按钮 | [TicketDetailPage.tsx:583](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L583) |
| `TicketDetailPage.93cb3f94` | 写死 | 交给同事 | 按钮 | [TicketDetailPage.tsx:586](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L586) |
| `TicketDetailPage.a4753109` | 写死 | 关闭工单 | 按钮 | [TicketDetailPage.tsx:596](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L596)、727 行 |
| `TicketDetailPage.f0dfdf77` | 写死 | 看不到这一单的证据，所以不能判定：判定要有查看订单的权限，订单也要在数据范围内。具体原因见下面的「no-show 证据」，也可以交给同事处理。 | 正文 | [TicketDetailPage.tsx:600](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L600) |
| `TicketDetailPage.0d9b444d` | 写死 | 在等供应商回复，{…} 之前不能判定（到期没回复视为认可）。 | 正文 | [TicketDetailPage.tsx:601](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L601) |
| `TicketDetailPage.63fdc510` | 写死 | 判定人 | 名称 | [TicketDetailPage.tsx:614](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L614) |
| `TicketDetailPage.cdc3d6df` | 写死 | 判定时间 | 名称 | [TicketDetailPage.tsx:615](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L615) |
| `TicketDetailPage.1bc42373` | 写死 | 说明 | 名称 | [TicketDetailPage.tsx:619](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L619) |
| `TicketDetailPage.f640ba3d` | 写死 | 供应商可以申诉到 | 名称 | [TicketDetailPage.tsx:624](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L624) |
| `TicketDetailPage.42abb257` | 写死 | 供应商的申诉 | 名称 | [TicketDetailPage.tsx:629](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L629) |
| `TicketDetailPage.377cf40f` | 写死 | 关闭说明 | 名称 | [TicketDetailPage.tsx:637](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L637)、725 行 |
| `TicketDetailPage.9c99c0d1` | 写死 | 赔付 | 标题 | [TicketDetailPage.tsx:649](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L649) |
| `TicketDetailPage.7dc4d1ba` | 写死 | 情形 | 名称 | [TicketDetailPage.tsx:651](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L651) |
| `TicketDetailPage.9e5296b1` | 写死 | {scenario\_name}（第 {table\_version} 版赔付表，对外价的 {…}） | 正文 | [TicketDetailPage.tsx:651](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L651) |
| `TicketDetailPage.ed6f8a26` | 写死 | 对外价 | 名称 | [TicketDetailPage.tsx:652](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L652) |
| `TicketDetailPage.0f2fd207` | 写死 | （补足到最低额 {…}） | 正文 | [TicketDetailPage.tsx:653](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L653) |
| `TicketDetailPage.17091b8d` | 写死 | 申请 {…}，给 {…}（上限 {…}） | 正文 | [TicketDetailPage.tsx:654](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L654) |
| `TicketDetailPage.9eaeadee` | 写死 | （凭证 {payout\_reference}） | 正文 | [TicketDetailPage.tsx:656](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L656) |
| `TicketDetailPage.433e6d21` | 写死 | 已按「供应商原因」取消 | 正文 | [TicketDetailPage.tsx:658](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L658) |
| `TicketDetailPage.b52b0d45` | 写死 | 排了 {length} 笔退款，状态在 | 正文 | [TicketDetailPage.tsx:662](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L662) |
| `TicketDetailPage.522bf21f` | 写死 | 订单详情 | 链接 | [TicketDetailPage.tsx:665](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L665) |
| `TicketDetailPage.de461aad` | 写死 | 里看。 | 正文 | [TicketDetailPage.tsx:667](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L667) |
| `TicketDetailPage.af735197` | 写死 | 登记另付已付 | 按钮 | [TicketDetailPage.tsx:673](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L673)、737 行 |
| `TicketDetailPage.d47598f8` | 写死 | 供应商应扣款项 | 标题 | [TicketDetailPage.tsx:683](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L683) |
| `TicketDetailPage.b2211c7b` | 写死 | 在供应商的账单里扣；申诉成立时全部免除。 | 正文 | [TicketDetailPage.tsx:685](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L685) |
| `TicketDetailPage.c163fd79` | 写死 | 已交给「{name}」 | 文字 | [TicketDetailPage.tsx:691](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L691) |
| `TicketDetailPage.43717dd3` | 写死 | 已判定 | 文字 | [TicketDetailPage.tsx:702](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L702) |
| `TicketDetailPage.cbeb8168` | 写死 | 判定已提交复核：另一位同事批准后才执行 | 文字 | [TicketDetailPage.tsx:702](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L702) |
| `TicketDetailPage.b1c811b3` | 写死 | 这段话会发给供应商。它要在 24 小时内回复并说明情况；期限内不能判定，到期没回复视为认可。 | 正文 | [TicketDetailPage.tsx:710](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L710) |
| `TicketDetailPage.131e99c4` | 写死 | 问供应商什么 | 名称 | [TicketDetailPage.tsx:711](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L711) |
| `TicketDetailPage.83a9efc4` | 写死 | 如「客人说司机迟到 25 分钟，请提供司机到达的定位截图」 | 说明 | [TicketDetailPage.tsx:712](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L712) |
| `TicketDetailPage.ede3a451` | 写死 | 已征求供应商意见，等它 24 小时内回复 | 文字 | [TicketDetailPage.tsx:718](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L718) |
| `TicketDetailPage.55ece067` | 写死 | 关闭这张工单？ | 标题 | [TicketDetailPage.tsx:723](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L723) |
| `TicketDetailPage.31637ecc` | 写死 | 还没有判定就关闭（重复的、客人撤回的）：订单和账都不会变。关闭后不能重新打开。 | 正文 | [TicketDetailPage.tsx:724](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L724) |
| `TicketDetailPage.cd94298a` | 写死 | 判定已经执行，关闭后不能再处理。供应商仍然可以在判定后 7 天内申诉。 | 正文 | [TicketDetailPage.tsx:724](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L724) |
| `TicketDetailPage.5b876c54` | 写死 | 请写关闭说明：为什么关闭 | 文字 | [TicketDetailPage.tsx:726](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L726) |
| `TicketDetailPage.be23f71c` | 写死 | 关闭中… | 文字 | [TicketDetailPage.tsx:728](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L728) |
| `TicketDetailPage.3dda956a` | 写死 | 关闭 | 按钮 | [TicketDetailPage.tsx:729](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L729) |
| `TicketDetailPage.44016835` | 写死 | 已关闭工单 | 文字 | [TicketDetailPage.tsx:732](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L732) |
| `TicketDetailPage.8c130aa4` | 写死 | 退不回卡上的 {…}（报销等）已经由财务另外付给客人（银行转账等）。登记后不能修改。 | 正文 | [TicketDetailPage.tsx:738](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L738) |
| `TicketDetailPage.e9ab80e7` | 写死 | 转账凭证号 | 名称 | [TicketDetailPage.tsx:739](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L739) |
| `TicketDetailPage.0b969d96` | 写死 | 请填银行转账的凭证号或流水号 | 文字 | [TicketDetailPage.tsx:742](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L742) |
| `TicketDetailPage.336b5489` | 写死 | 登记 | 按钮 | [TicketDetailPage.tsx:743](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L743)、745 行 |
| `TicketDetailPage.4ae535a4` | 写死 | 登记中… | 文字 | [TicketDetailPage.tsx:744](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L744) |
| `TicketDetailPage.cd934365` | 写死 | 已登记另付 | 文字 | [TicketDetailPage.tsx:748](../../apps/web/src/pages/platform/TicketDetailPage.tsx#L748) |

## 人工报价

文件：`apps/web/src/pages/platform/ManualQuotePages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ManualQuotePages.577d7bfa` | 写死 | 人工报价 | 名称 | [ManualQuotePages.tsx:38](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L38)、105、106 行 |
| `ManualQuotePages.7ba45b57` | 写死 | 还没人跟进 | 文字 | [ManualQuotePages.tsx:47](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L47)、62、396 行 |
| `ManualQuotePages.6657d36a` | 写死 | {name}（我） | 文字 | [ManualQuotePages.tsx:48](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L48) |
| `ManualQuotePages.5eec4b20` | 写死 | 状态 | 名称 | [ManualQuotePages.tsx:57](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L57)、137、390 行 |
| `ManualQuotePages.e2ae913f` | 写死 | 全部 | 名称 | [ManualQuotePages.tsx:57](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L57)、62 行 |
| `ManualQuotePages.ef84d752` | 写死 | 跟进人 | 名称 | [ManualQuotePages.tsx:60](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L60)、146、396、499 行 |
| `ManualQuotePages.cc152772` | 写死 | 我 | 名称 | [ManualQuotePages.tsx:62](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L62) |
| `ManualQuotePages.32eac04a` | 写死 | 各状态的数量 | 读屏说明 | [ManualQuotePages.tsx:72](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L72) |
| `ManualQuotePages.c5032afb` | 写死 | {label} {…} 条 | 读屏说明 | [ManualQuotePages.tsx:75](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L75) |
| `ManualQuotePages.78ea3b93` | 写死 | 人工报价 · NOZOMI {name} | 浏览器标题 | [ManualQuotePages.tsx:87](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L87) |
| `ManualQuotePages.e037f3f0` | 写死 | 申请 | 文字 | [ManualQuotePages.tsx:124](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L124) |
| `ManualQuotePages.d1b4cdd3` | 写死 | 留了 | 文字 | [ManualQuotePages.tsx:145](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L145) |
| `ManualQuotePages.0fca314a` | 写死 | 提交时间 | 文字 | [ManualQuotePages.tsx:147](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L147)、496 行 |
| `ManualQuotePages.57f26124` | 写死 | 清空筛选 | 按钮 | [ManualQuotePages.tsx:150](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L150) |
| `ManualQuotePages.c3eb4143` | 写死 | 没有符合条件的申请 | 标题 | [ManualQuotePages.tsx:150](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L150) |
| `ManualQuotePages.f3e6d945` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [ManualQuotePages.tsx:150](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L150) |
| `ManualQuotePages.35267056` | 写死 | 官网一家供应商都报不出价时，客人可以留下邮箱或 WhatsApp 请客服报价，申请会出现在这里。 | 说明 | [ManualQuotePages.tsx:152](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L152) |
| `ManualQuotePages.8bb17675` | 写死 | 现在没有人工报价申请 | 标题 | [ManualQuotePages.tsx:152](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L152) |
| `ManualQuotePages.0eaa1989` | 写死 | 官网报不出价时客人留下的联系方式。列表里没有联系方式和地点，打开一条才看得到（每次打开都记入审计日志）。时间按你的本地时区（{…}）显示。 | 正文 | [ManualQuotePages.tsx:158](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L158) |
| `ManualQuotePages.d7c5be16` | 写死 | 你可以查看人工报价申请，但不能跟进。 | 提示 | [ManualQuotePages.tsx:159](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L159) |
| `ManualQuotePages.5ab2fb08` | 写死 | 按联系方式查找（完整的邮箱或带国家码的号码） | 名称 | [ManualQuotePages.tsx:161](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L161) |
| `ManualQuotePages.87b86927` | 写死 | 请输入完整的联系方式 | 标题 | [ManualQuotePages.tsx:165](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L165) |
| `ManualQuotePages.90434799` | 写死 | 按联系方式只能精确查找：写完整的邮箱（如 name@example.com），或带国家码的 WhatsApp 号码（如 +81 开头）。 | 说明 | [ManualQuotePages.tsx:165](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L165) |
| `ManualQuotePages.e4903967` | 写死 | 清空查找 | 按钮 | [ManualQuotePages.tsx:165](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L165) |
| `ManualQuotePages.07e6595e` | 写死 | 人工报价申请 | 名称 | [ManualQuotePages.tsx:169](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L169)、461 行 |
| `ManualQuotePages.3ca2eb3b` | 写死 | 这条申请刚被别人改过，页面已刷新成最新的样子。请看过再改。 | 文字 | [ManualQuotePages.tsx:194](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L194) |
| `ManualQuotePages.6dd02da2` | 写死 | 这条申请已过保留期，联系方式已清除，不能再改。页面已刷新。 | 文字 | [ManualQuotePages.tsx:195](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L195) |
| `ManualQuotePages.8b3696e1` | 写死 | 不能改回「新」。「新」只表示还没人看过。 | 文字 | [ManualQuotePages.tsx:196](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L196) |
| `ManualQuotePages.2a5edc8b` | 写死 | 这位同事不能跟进这一条（没有权限，或这一条不在他的数据范围里）。请换一位。 | 文字 | [ManualQuotePages.tsx:197](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L197) |
| `ManualQuotePages.fd07ea91` | 写死 | 保存 | 文字 | [ManualQuotePages.tsx:198](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L198)、400 行 |
| `ManualQuotePages.09d558d4` | 写死 | 客人留下的内容 | 标题 | [ManualQuotePages.tsx:208](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L208)、218 行 |
| `ManualQuotePages.573beaa5` | 写死 | 已过保留期（结束后 {retentionDaysAfterFinish} 天、最长 {retentionDaysMax} 天），联系方式、地点和备注已清除。 | 正文 | [ManualQuotePages.tsx:209](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L209) |
| `ManualQuotePages.65736d14` | 写死 | 你打开这一页已记入审计日志。联系方式只用来给这位客人报价，不要抄到别处。 | 正文 | [ManualQuotePages.tsx:220](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L220) |
| `ManualQuotePages.9b69a902` | 写死 | 邮箱 | 名称 | [ManualQuotePages.tsx:223](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L223) |
| `ManualQuotePages.60a6a098` | 写死 | WhatsApp | 名称 | [ManualQuotePages.tsx:230](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L230) |
| `ManualQuotePages.240cfd7d` | 写死 | 上车地点 | 名称 | [ManualQuotePages.tsx:239](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L239) |
| `ManualQuotePages.e3636f48` | 写死 | 出发地 | 名称 | [ManualQuotePages.tsx:239](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L239) |
| `ManualQuotePages.61c58f91` | 写死 | 经停点 | 名称 | [ManualQuotePages.tsx:242](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L242)、243 行 |
| `ManualQuotePages.aeb00457` | 写死 | 经停 {…} · 停留 {…} | 正文 | [ManualQuotePages.tsx:246](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L246) |
| `ManualQuotePages.1d85037c` | 写死 | 下车地点 | 名称 | [ManualQuotePages.tsx:253](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L253) |
| `ManualQuotePages.93b27da8` | 写死 | 目的地 | 名称 | [ManualQuotePages.tsx:253](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L253) |
| `ManualQuotePages.79f86ddf` | 写死 | 没有选方案（全部报不出，转人工） | 文字 | [ManualQuotePages.tsx:261](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L261) |
| `ManualQuotePages.5a36cacd` | 写死 | 整张行程单 | 标题 | [ManualQuotePages.tsx:266](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L266) |
| `ManualQuotePages.21b397c2` | 写死 | 行程单编号 | 名称 | [ManualQuotePages.tsx:268](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L268) |
| `ManualQuotePages.00c438fd` | 写死 | 客人选的方案 | 名称 | [ManualQuotePages.tsx:271](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L271) |
| `ManualQuotePages.7f0f09f0` | 写死 | 行程单已清理（建单 30 天后清理），只剩客人提交时的地名，时间和报价看不到了。 | 正文 | [ManualQuotePages.tsx:273](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L273) |
| `ManualQuotePages.42d0183d` | 写死 | 每天的行程 | 读屏说明 | [ManualQuotePages.tsx:275](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L275)、298 行 |
| `ManualQuotePages.c50c4e3e` | 写死 | 第 {…} 天 · {date} | 正文 | [ManualQuotePages.tsx:278](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L278) |
| `ManualQuotePages.6ae70dfe` | 写死 | 空闲日（不用车） | 正文 | [ManualQuotePages.tsx:280](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L280)、302 行 |
| `ManualQuotePages.0da8c394` | 写死 | 停留 {…} | 正文 | [ManualQuotePages.tsx:285](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L285) |
| `ManualQuotePages.1ac7c287` | 写死 | （地名已清除） | 正文 | [ManualQuotePages.tsx:287](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L287) |
| `ManualQuotePages.88750363` | 写死 | 平台地点 | 正文 | [ManualQuotePages.tsx:288](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L288) |
| `ManualQuotePages.031bb013` | 写死 | 第 {…} 天 | 正文 | [ManualQuotePages.tsx:301](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L301) |
| `ManualQuotePages.d8920c32` | 写死 | 联系信息已过保留期，行程单的地名也已清除。 | 正文 | [ManualQuotePages.tsx:307](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L307) |
| `ManualQuotePages.8d9bc531` | 写死 | 报价方案 | 标题 | [ManualQuotePages.tsx:311](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L311)、315 行 |
| `ManualQuotePages.b69e256f` | 写死 | 还没有报过价。 | 正文 | [ManualQuotePages.tsx:313](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L313) |
| `ManualQuotePages.4aa0ed0b` | 写死 | （推荐） | 正文 | [ManualQuotePages.tsx:318](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L318) |
| `ManualQuotePages.219ada33` | 写死 | 报不出 | 正文 | [ManualQuotePages.tsx:319](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L319) |
| `ManualQuotePages.77fcd394` | 写死 | 已保存 | 提示 | [ManualQuotePages.tsx:366](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L366) |
| `ManualQuotePages.2fdc3619` | 写死 | 跟进 | 标题 | [ManualQuotePages.tsx:383](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L383)、536、547 行 |
| `ManualQuotePages.25f44d01` | 写死 | 已过保留期，不能再改状态、指派或写备注。 | 正文 | [ManualQuotePages.tsx:385](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L385) |
| `ManualQuotePages.8e6e9d3c` | 写死 | 已转订单、关闭之后满 180 天清除联系方式；关闭后也能改回跟进中。 | 说明 | [ManualQuotePages.tsx:393](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L393) |
| `ManualQuotePages.4570d756` | 写死 | 保存中… | 文字 | [ManualQuotePages.tsx:398](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L398)、444 行 |
| `ManualQuotePages.6b2f7e81` | 写死 | 指派给我 | 按钮 | [ManualQuotePages.tsx:404](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L404) |
| `ManualQuotePages.94dfa04e` | 写死 | 请写备注内容 | 错误提示 | [ManualQuotePages.tsx:423](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L423) |
| `ManualQuotePages.9d0f22e1` | 写死 | 已添加备注 | 提示 | [ManualQuotePages.tsx:431](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L431) |
| `ManualQuotePages.36862e79` | 写死 | 保存备注 | 文字 | [ManualQuotePages.tsx:435](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L435) |
| `ManualQuotePages.73f068c5` | 写死 | 这条申请已过保留期，不能再写备注。 | 错误提示 | [ManualQuotePages.tsx:435](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L435) |
| `ManualQuotePages.af5ce574` | 写死 | {…}写的内容还在。 | 错误提示 | [ManualQuotePages.tsx:435](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L435) |
| `ManualQuotePages.71a052fa` | 写死 | 写备注 | 名称 | [ManualQuotePages.tsx:442](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L442) |
| `ManualQuotePages.f10c51eb` | 写死 | 只有平台同事看得到，加密保存，到期和联系方式一起清除。报给客人的价格、客人的回复都可以记在这里。 | 说明 | [ManualQuotePages.tsx:442](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L442) |
| `ManualQuotePages.fd0d1243` | 写死 | 添加备注 | 按钮 | [ManualQuotePages.tsx:446](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L446) |
| `ManualQuotePages.42d7a6a0` | 写死 | 申请 {request\_no} | 标题 | [ManualQuotePages.tsx:461](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L461) |
| `ManualQuotePages.0613b22f` | 写死 | {title} · 人工报价 · NOZOMI {name} | 浏览器标题 | [ManualQuotePages.tsx:462](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L462) |
| `ManualQuotePages.e5a5b9bc` | 写死 | 它可能不在你的数据范围里，或链接有误。 | 说明 | [ManualQuotePages.tsx:469](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L469) |
| `ManualQuotePages.f2c2411b` | 写死 | 找不到这条申请 | 标题 | [ManualQuotePages.tsx:469](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L469) |
| `ManualQuotePages.1c13b93c` | 写死 | 重试 | 按钮 | [ManualQuotePages.tsx:473](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L473) |
| `ManualQuotePages.2960c69b` | 写死 | 请检查网络后重试。如果一直打不开，可能是服务器的数据加密没有配置好，请联系技术同事。 | 说明 | [ManualQuotePages.tsx:473](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L473) |
| `ManualQuotePages.65c238af` | 写死 | 申请没有加载出来 | 标题 | [ManualQuotePages.tsx:473](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L473) |
| `ManualQuotePages.1d9a7d88` | 写死 | 行程 | 标题 | [ManualQuotePages.tsx:487](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L487) |
| `ManualQuotePages.7a0656ce` | 写死 | 结束时间 | 名称 | [ManualQuotePages.tsx:501](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L501) |
| `ManualQuotePages.120c3a0c` | 写死 | 时间按你的本地时区（{…}）显示；用车时间是当地时间。 | 正文 | [ManualQuotePages.tsx:506](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L506) |
| `ManualQuotePages.b985c29c` | 写死 | 看这条申请的操作记录 | 链接 | [ManualQuotePages.tsx:511](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L511) |
| `ManualQuotePages.d0d714be` | 写死 | 跟进记录 | 标题 | [ManualQuotePages.tsx:520](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L520) |
| `ManualQuotePages.0607bae6` | 写死 | 客人 | 正文 | [ManualQuotePages.tsx:526](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L526) |
| `ManualQuotePages.473ed347` | 写死 | （已清除） | 正文 | [ManualQuotePages.tsx:529](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L529) |
| `ManualQuotePages.019d0d32` | 写死 | 你可以查看，但没有跟进人工报价的权限。 | 正文 | [ManualQuotePages.tsx:548](../../apps/web/src/pages/platform/ManualQuotePages.tsx#L548) |

## 官网设置

文件：`apps/web/src/pages/platform/LegalSettingsSection.tsx`、`apps/web/src/pages/platform/SiteSettingsPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `LegalSettingsSection.0e776885` | 写死 | 太长了：最多 {…} 个字，请删短一些 | 文字 | [LegalSettingsSection.tsx:31](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L31) |
| `LegalSettingsSection.5f3671b2` | 写死 | 邮箱的格式不对，请填完整的邮箱，如 support@example.com | 文字 | [LegalSettingsSection.tsx:33](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L33) |
| `LegalSettingsSection.cd1d6810` | 写死 | 日期不对，请用日期选择器选一天 | 文字 | [LegalSettingsSection.tsx:35](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L35) |
| `LegalSettingsSection.4bdd536f` | 写死 | 这一项的内容不对，请检查后重试 | 文字 | [LegalSettingsSection.tsx:37](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L37) |
| `LegalSettingsSection.9c824f25` | 写死 | 法律文案的待补项刚被别人改过，页面已刷新成最新的样子。请看过再改。 | 文字 | [LegalSettingsSection.tsx:56](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L56) |
| `LegalSettingsSection.6c3b67b6` | 写死 | 已保存，法律文案的待补项都填齐了 | 提示 | [LegalSettingsSection.tsx:79](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L79) |
| `LegalSettingsSection.efbb8a25` | 写死 | 已保存，还缺 {length} 项 | 提示 | [LegalSettingsSection.tsx:79](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L79) |
| `LegalSettingsSection.6d6609df` | 写死 | 保存 | 文字 | [LegalSettingsSection.tsx:93](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L93)、94、111 行 |
| `LegalSettingsSection.c61d9661` | 写死 | 有几项填得不对，请看各项下面的说明。填的内容还在。 | 文字 | [LegalSettingsSection.tsx:93](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L93) |
| `LegalSettingsSection.d006ac62` | 写死 | {…}填的内容还在。 | 文字 | [LegalSettingsSection.tsx:93](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L93)、94 行 |
| `LegalSettingsSection.503e649a` | 写死 | 用在：{usedIn} | 说明 | [LegalSettingsSection.tsx:104](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L104) |
| `LegalSettingsSection.b9dbbc64` | 写死 | 保存中… | 文字 | [LegalSettingsSection.tsx:109](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L109) |
| `LegalSettingsSection.4524c5e0` | 写死 | 还缺 {length} 项：{…} | 正文 | [LegalSettingsSection.tsx:121](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L121) |
| `LegalSettingsSection.59b38a68` | 写死 | {length} 项都已填写。 | 正文 | [LegalSettingsSection.tsx:121](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L121) |
| `LegalSettingsSection.ea709d6e` | 写死 | 正式环境：都已填齐，不影响官网开放预订。 | 正文 | [LegalSettingsSection.tsx:124](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L124) |
| `LegalSettingsSection.dc68de3e` | 写死 | 正式环境：没填齐前官网不开放预订。请超级管理员把缺的几项填好。 | 提示 | [LegalSettingsSection.tsx:126](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L126) |
| `LegalSettingsSection.b92a9cac` | 写死 | 测试站：没填的地方页面显示「未設定」，官网照常开放。 | 正文 | [LegalSettingsSection.tsx:129](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L129) |
| `LegalSettingsSection.8b1394ba` | 写死 | 法律文案的待补项 | 标题 | [LegalSettingsSection.tsx:143](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L143) |
| `LegalSettingsSection.822b0916` | 写死 | 官网的三份日文法律文案（特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー）里要填的几处。正文由业主定稿，这里只填空着的地方。 | 正文 | [LegalSettingsSection.tsx:144](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L144) |
| `LegalSettingsSection.46bf5e0c` | 写死 | 重试 | 按钮 | [LegalSettingsSection.tsx:147](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L147) |
| `LegalSettingsSection.c7774d09` | 写死 | 请检查网络后重试。 | 说明 | [LegalSettingsSection.tsx:147](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L147) |
| `LegalSettingsSection.c7aef7e3` | 写死 | 法律文案的待补项没有加载出来 | 标题 | [LegalSettingsSection.tsx:147](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L147) |
| `LegalSettingsSection.023cc72e` | 写死 | 还没有填 | 正文 | [LegalSettingsSection.tsx:175](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L175) |
| `LegalSettingsSection.28c17389` | 写死 | 只有超级管理员能改法律文案的待补项。 | 正文 | [LegalSettingsSection.tsx:179](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L179) |
| `LegalSettingsSection.cd6732e9` | 写死 | 看看页面 | 名称 | [LegalSettingsSection.tsx:183](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L183) |
| `LegalSettingsSection.16372d25` | 写死 | 最后修改 | 名称 | [LegalSettingsSection.tsx:192](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L192) |
| `LegalSettingsSection.3de17186` | 写死 | 还没有设置过 | 正文 | [LegalSettingsSection.tsx:194](../../apps/web/src/pages/platform/LegalSettingsSection.tsx#L194) |
| `SiteSettingsPage.d9203f3b` | 写死 | 系统设置 | 名称 | [SiteSettingsPage.tsx:31](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L31) |
| `SiteSettingsPage.64834174` | 写死 | 您好 | 文字 | [SiteSettingsPage.tsx:36](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L36) |
| `SiteSettingsPage.ba43eca1` | 写死 | 在 WhatsApp 里打开看看 | 链接 | [SiteSettingsPage.tsx:37](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L37) |
| `SiteSettingsPage.2babb6ef` | 写死 | 已清空，官网不再显示 WhatsApp 按钮 | 提示 | [SiteSettingsPage.tsx:64](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L64) |
| `SiteSettingsPage.c4cf1944` | 写死 | 已保存，官网的 WhatsApp 按钮用这个号码 | 提示 | [SiteSettingsPage.tsx:64](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L64) |
| `SiteSettingsPage.0f1818f3` | 写死 | 号码刚被别人改过，页面已刷新成最新的样子。请看过再改。 | 文字 | [SiteSettingsPage.tsx:68](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L68) |
| `SiteSettingsPage.d6aaf951` | 写死 | {…}填的内容还在。 | 文字 | [SiteSettingsPage.tsx:71](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L71)、181 行 |
| `SiteSettingsPage.f6fa2887` | 写死 | 保存 | 文字 | [SiteSettingsPage.tsx:71](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L71)、83、117、144、181、206 行 |
| `SiteSettingsPage.773faa5c` | 写死 | 客服 WhatsApp 号码 | 名称 | [SiteSettingsPage.tsx:79](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L79)、249 行 |
| `SiteSettingsPage.b3aa7d89` | 写死 | 保存中… | 文字 | [SiteSettingsPage.tsx:81](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L81)、142、204 行 |
| `SiteSettingsPage.0aa464ba` | 写死 | 标准 | 名称 | [SiteSettingsPage.tsx:91](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L91) |
| `SiteSettingsPage.51cfad22` | 写死 | 内容最宽约 1200 像素，适合多数电脑屏幕（默认） | 说明 | [SiteSettingsPage.tsx:91](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L91) |
| `SiteSettingsPage.00ce6cdd` | 写死 | 较宽 | 名称 | [SiteSettingsPage.tsx:92](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L92) |
| `SiteSettingsPage.5f1fb4ea` | 写死 | 内容最宽约 1440 像素，大屏幕上表单更宽 | 说明 | [SiteSettingsPage.tsx:92](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L92) |
| `SiteSettingsPage.9b471930` | 写死 | 最宽 | 名称 | [SiteSettingsPage.tsx:93](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L93) |
| `SiteSettingsPage.b2827324` | 写死 | 接近全屏，两侧留边，最宽约 1920 像素 | 说明 | [SiteSettingsPage.tsx:93](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L93) |
| `SiteSettingsPage.b94deed6` | 写死 | 已保存，官网页面宽度改为「{name}」，客人刷新页面后生效 | 提示 | [SiteSettingsPage.tsx:111](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L111) |
| `SiteSettingsPage.ffca0160` | 写死 | 官网设置刚被别人改过，页面已刷新成最新的样子。请看过再改。 | 文字 | [SiteSettingsPage.tsx:115](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L115)、178 行 |
| `SiteSettingsPage.070ce6fc` | 写死 | {…}选的宽度还在，可以再点一次「保存」。 | 文字 | [SiteSettingsPage.tsx:117](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L117) |
| `SiteSettingsPage.1dcf149d` | 写死 | 页面宽度 | 表单标签 | [SiteSettingsPage.tsx:126](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L126)、272、280 行 |
| `SiteSettingsPage.9d7f8f27` | 写死 | 谷歌地图密钥是 AIza 开头、共 39 位的一串字母数字，请从谷歌后台整串复制 | 提示 | [SiteSettingsPage.tsx:152](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L152) |
| `SiteSettingsPage.488f141e` | 写死 | {…}…（共 {length} 位） | 说明 | [SiteSettingsPage.tsx:156](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L156) |
| `SiteSettingsPage.42e34555` | 写死 | 已保存，客人刷新页面后可以在谷歌地图上选点 | 提示 | [SiteSettingsPage.tsx:174](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L174) |
| `SiteSettingsPage.97ab2075` | 写死 | 已清除，客人刷新页面后官网不再提供地图选点 | 提示 | [SiteSettingsPage.tsx:174](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L174) |
| `SiteSettingsPage.49e7658d` | 写死 | 请粘贴密钥 | 错误提示 | [SiteSettingsPage.tsx:191](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L191) |
| `SiteSettingsPage.11646786` | 写死 | 还没有填（官网不提供地图选点，客人用搜索找地址） | 正文 | [SiteSettingsPage.tsx:200](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L200) |
| `SiteSettingsPage.fb277682` | 写死 | 现在的密钥 | 名称 | [SiteSettingsPage.tsx:200](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L200) |
| `SiteSettingsPage.46207e43` | 写死 | 在谷歌后台新建的、限定了官网网址、只开 Maps JavaScript API 的那把；不是服务器用的密钥 | 说明 | [SiteSettingsPage.tsx:202](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L202) |
| `SiteSettingsPage.7e7453bf` | 写死 | 浏览器密钥 | 名称 | [SiteSettingsPage.tsx:202](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L202)、298 行 |
| `SiteSettingsPage.fdefdef9` | 写死 | 换一把密钥 | 名称 | [SiteSettingsPage.tsx:202](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L202) |
| `SiteSettingsPage.72ca3a09` | 写死 | 清除密钥 | 按钮 | [SiteSettingsPage.tsx:210](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L210) |
| `SiteSettingsPage.2ccecdae` | 写死 | 官网设置 · NOZOMI {name} | 浏览器标题 | [SiteSettingsPage.tsx:219](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L219) |
| `SiteSettingsPage.a765e835` | 写死 | 官网设置 | 名称 | [SiteSettingsPage.tsx:224](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L224)、225 行 |
| `SiteSettingsPage.107e278f` | 写死 | 重试 | 按钮 | [SiteSettingsPage.tsx:233](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L233) |
| `SiteSettingsPage.22b66813` | 写死 | 官网设置没有加载出来 | 标题 | [SiteSettingsPage.tsx:233](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L233) |
| `SiteSettingsPage.8b0757d6` | 写死 | 请检查网络后重试。 | 说明 | [SiteSettingsPage.tsx:233](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L233) |
| `SiteSettingsPage.f91b276d` | 写死 | 官网一家供应商都报不出价时，客人除了留下联系方式，还可以点「通过 WhatsApp 联系我们」，直接把行程发给这个号码。 | 正文 | [SiteSettingsPage.tsx:238](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L238) |
| `SiteSettingsPage.ce58f982` | 写死 | 客服 WhatsApp | 标题 | [SiteSettingsPage.tsx:241](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L241) |
| `SiteSettingsPage.f2e441fd` | 写死 | 还没有设置（官网不显示 WhatsApp 按钮） | 正文 | [SiteSettingsPage.tsx:249](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L249) |
| `SiteSettingsPage.1691cb36` | 写死 | 只有超级管理员能改这个号码：号码填错或被换掉，客人就会把行程发给别人。 | 正文 | [SiteSettingsPage.tsx:251](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L251) |
| `SiteSettingsPage.08ccadf3` | 写死 | 试一下 | 名称 | [SiteSettingsPage.tsx:255](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L255) |
| `SiteSettingsPage.6d15fb1b` | 写死 | 最后修改 | 名称 | [SiteSettingsPage.tsx:256](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L256) |
| `SiteSettingsPage.7a052034` | 写死 | 还没有设置过 | 正文 | [SiteSettingsPage.tsx:258](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L258) |
| `SiteSettingsPage.a3efece2` | 写死 | 官网所有页面（首页、预订、下单、订单页）的内容最宽多少。只影响电脑屏幕；手机和平板始终是单栏，不受这个设置影响。 | 正文 | [SiteSettingsPage.tsx:273](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L273) |
| `SiteSettingsPage.695e3cad` | 写死 | 只有超级管理员能改页面宽度。 | 正文 | [SiteSettingsPage.tsx:282](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L282) |
| `SiteSettingsPage.bcdbbd5c` | 写死 | 谷歌地图（浏览器密钥） | 标题 | [SiteSettingsPage.tsx:289](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L289) |
| `SiteSettingsPage.bd191882` | 写死 | 官网「在地图上选点」用谷歌地图显示时要的密钥。它会出现在官网网页里，所以要在谷歌后台限定网址、只开 Maps JavaScript API。没填时官网不提供地图选点，客人用搜索找地址。 | 正文 | [SiteSettingsPage.tsx:291](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L291) |
| `SiteSettingsPage.1a38d779` | 写死 | 还没有填 | 正文 | [SiteSettingsPage.tsx:298](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L298) |
| `SiteSettingsPage.f35df324` | 写死 | 只有超级管理员能改这把密钥。 | 正文 | [SiteSettingsPage.tsx:300](../../apps/web/src/pages/platform/SiteSettingsPage.tsx#L300) |

## 嵌入组件

文件：`apps/web/src/pages/platform/EmbedKeysPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `EmbedKeysPage.a803132f` | 写死 | 中文 | 文字 | [EmbedKeysPage.tsx:39](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L39) |
| `EmbedKeysPage.243532a6` | 写死 | 包车 | 文字 | [EmbedKeysPage.tsx:40](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L40) |
| `EmbedKeysPage.651ffe28` | 写死 | 区间 | 文字 | [EmbedKeysPage.tsx:40](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L40) |
| `EmbedKeysPage.19404ddb` | 写死 | 卡片 | 文字 | [EmbedKeysPage.tsx:41](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L41) |
| `EmbedKeysPage.a2609beb` | 写死 | 自动 | 文字 | [EmbedKeysPage.tsx:41](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L41) |
| `EmbedKeysPage.ac026290` | 写死 | 横条 | 文字 | [EmbedKeysPage.tsx:41](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L41) |
| `EmbedKeysPage.8e180588` | 写死 | 允许（预订流程嵌在合作网站页面里） | 文字 | [EmbedKeysPage.tsx:43](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L43) |
| `EmbedKeysPage.91223840` | 写死 | 不允许（客人跳到主站预订） | 文字 | [EmbedKeysPage.tsx:43](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L43) |
| `EmbedKeysPage.1e598850` | 写死 | 打开后，白名单里的网站可以用 NozomiBooking.mountBooking 把整个预订流程嵌在自己的页面里（ADR 0095）；关掉后下一次打开就嵌不进去。关掉时请合作网站同时换回旧代码（不带 bookingUrl 的①、预订页去掉②），否则客人会跳到嵌不进去的预订页。 | 说明 | [EmbedKeysPage.tsx:45](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L45) |
| `EmbedKeysPage.94b8e34b` | 写死 | 一行一个合作网站的地址，以 https 开头、只写到域名（可带端口），不带路径；不支持 \*。最多 20 个。 | 说明 | [EmbedKeysPage.tsx:48](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L48) |
| `EmbedKeysPage.2c4bec16` | 写死 | 合作网站如果设了内容安全策略（CSP），要在 script-src 和 connect-src 里放行主站域名，否则组件加载不出来。 | 说明 | [EmbedKeysPage.tsx:49](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L49) |
| `EmbedKeysPage.73b2815b` | 写死 | 合作网站如果设了内容安全策略（CSP），要在 script-src、connect-src 和 frame-src 里放行主站域名，否则组件和预订程序加载不出来。 | 说明 | [EmbedKeysPage.tsx:50](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L50) |
| `EmbedKeysPage.40eae6cd` | 写死 | 合作网站自己的预订页完整地址（如合作网站的 /booking/ 页）：要以 https 开头，并且是上面「允许的网站」里某个网站下的页面。填了并选「允许」整页嵌入后，会生成两段代码。 | 说明 | [EmbedKeysPage.tsx:51](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L51) |
| `EmbedKeysPage.580391ae` | 写死 | 放在任何页面（首页、文章页等），客人填好行程后会跳到你的预订页。 | 说明 | [EmbedKeysPage.tsx:53](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L53) |
| `EmbedKeysPage.294d4697` | 写死 | 放在任何页面（首页、文章页等），客人填好行程后跳到 NOZOMI 主站完成预订。 | 说明 | [EmbedKeysPage.tsx:54](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L54) |
| `EmbedKeysPage.21bd42aa` | 写死 | 预订页不要再放①（那一页只放②，②没收到行程时会自己显示查价表单）。 | 文字 | [EmbedKeysPage.tsx:56](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L56) |
| `EmbedKeysPage.1cea2c77` | 写死 | 只放在预订页，接收入口传来的行程，显示报价和下单流程。 | 说明 | [EmbedKeysPage.tsx:57](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L57) |
| `EmbedKeysPage.47b1b97f` | 写死 | 填写预订页地址并开启「允许整页嵌入」后，这里会出现第二段代码（预订程序）。 | 说明 | [EmbedKeysPage.tsx:60](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L60) |
| `EmbedKeysPage.8b607555` | 写死 | 填写预订页地址后，这里会出现第二段代码（预订程序）。 | 说明 | [EmbedKeysPage.tsx:60](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L60) |
| `EmbedKeysPage.653e1c91` | 写死 | 开启「允许整页嵌入」后，这里会出现第二段代码（预订程序）。 | 说明 | [EmbedKeysPage.tsx:61](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L61) |
| `EmbedKeysPage.c660dadc` | 写死 | 预订页地址的网站不在「允许的网站」里，改好预订页地址后，这里会出现第二段代码（预订程序）。 | 说明 | [EmbedKeysPage.tsx:62](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L62) |
| `EmbedKeysPage.d99427d9` | 写死 | 预订页地址最多 2,000 个字符 | 文字 | [EmbedKeysPage.tsx:96](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L96) |
| `EmbedKeysPage.02e66594` | 写死 | 写法不对：要写以 https 开头的完整地址（域名加路径，如 /booking/） | 提示 | [EmbedKeysPage.tsx:97](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L97) |
| `EmbedKeysPage.6aba4852` | 写死 | 这个地址的网站不在「允许的网站」里：协议、域名、端口要和其中一项完全一样。改了允许的网站时，请一起改这里或清空 | 文字 | [EmbedKeysPage.tsx:98](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L98) |
| `EmbedKeysPage.2e5c99b5` | 写死 | 请填名称，最多 60 个字 | 文字 | [EmbedKeysPage.tsx:107](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L107) |
| `EmbedKeysPage.2f8a0fd5` | 写死 | 请填 1–20 个网站地址 | 文字 | [EmbedKeysPage.tsx:110](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L110) |
| `EmbedKeysPage.83e80dfc` | 写死 | 写法不对：要以 https 开头、只写到域名，可带端口，不带路径 | 文字 | [EmbedKeysPage.tsx:110](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L110) |
| `EmbedKeysPage.88f391b0` | 写死 | 第 {…} 行{…} | 文字 | [EmbedKeysPage.tsx:110](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L110) |
| `EmbedKeysPage.fa79ea55` | 写死 | 和前面的重复了 | 文字 | [EmbedKeysPage.tsx:110](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L110) |
| `EmbedKeysPage.158dd35a` | 写死 | 至少选一个 | 文字 | [EmbedKeysPage.tsx:111](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L111)、131 行 |
| `EmbedKeysPage.8b3d8257` | 写死 | 写法不对：要写完整的 https 地址 | 文字 | [EmbedKeysPage.tsx:112](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L112) |
| `EmbedKeysPage.49f6a39c` | 写死 | 备注最多 500 个字 | 文字 | [EmbedKeysPage.tsx:113](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L113) |
| `EmbedKeysPage.48058185` | 写死 | 请填名称 | 文字 | [EmbedKeysPage.tsx:129](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L129) |
| `EmbedKeysPage.820b0c9b` | 写死 | 至少填一个网站地址 | 文字 | [EmbedKeysPage.tsx:130](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L130) |
| `EmbedKeysPage.500d2012` | 写死 | 这个嵌入码刚被别人改过。请刷新页面看过再改。 | 文字 | [EmbedKeysPage.tsx:142](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L142) |
| `EmbedKeysPage.005beba9` | 写死 | {…}填的内容还在。 | 文字 | [EmbedKeysPage.tsx:143](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L143) |
| `EmbedKeysPage.e1722ee8` | 写死 | 保存 | 文字 | [EmbedKeysPage.tsx:143](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L143)、237 行 |
| `EmbedKeysPage.bfe1bb4e` | 写死 | 名称 | 名称 | [EmbedKeysPage.tsx:151](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L151) |
| `EmbedKeysPage.f84f9529` | 写死 | 给自己看的，如「MoveGlobal 官网」 | 说明 | [EmbedKeysPage.tsx:151](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L151) |
| `EmbedKeysPage.074f0466` | 写死 | 允许的网站 | 名称 | [EmbedKeysPage.tsx:152](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L152)、252 行 |
| `EmbedKeysPage.7b6b8c22` | 写死 | 默认语言 | 标题 | [EmbedKeysPage.tsx:153](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L153)、253 行 |
| `EmbedKeysPage.9d3a0e48` | 写死 | 默认标签 | 标题 | [EmbedKeysPage.tsx:154](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L154)、254 行 |
| `EmbedKeysPage.b8f778f1` | 写死 | 合作网站放代码时可以另外指定 | 说明 | [EmbedKeysPage.tsx:154](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L154) |
| `EmbedKeysPage.3d4422e5` | 写死 | 外观 | 标题 | [EmbedKeysPage.tsx:155](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L155)、255 行 |
| `EmbedKeysPage.917069e1` | 写死 | 自动：组件所在区域宽 900 px 以上显示横条，窄了（侧栏、手机）显示卡片。保存后合作网站的页面最迟约 1 分钟生效；合作网站代码里写了 layout 的以代码为准 | 说明 | [EmbedKeysPage.tsx:155](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L155) |
| `EmbedKeysPage.a02ce44e` | 写死 | 整页嵌入 | 标题 | [EmbedKeysPage.tsx:156](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L156)、256 行 |
| `EmbedKeysPage.a9c71fab` | 写死 | 预订页地址（选填） | 名称 | [EmbedKeysPage.tsx:158](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L158) |
| `EmbedKeysPage.599359cb` | 写死 | 备注（选填） | 名称 | [EmbedKeysPage.tsx:169](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L169) |
| `EmbedKeysPage.17901b92` | 写死 | 保存中… | 文字 | [EmbedKeysPage.tsx:171](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L171) |
| `EmbedKeysPage.a68c73d3` | 写死 | 取消 | 按钮 | [EmbedKeysPage.tsx:176](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L176)、220 行 |
| `EmbedKeysPage.3425e901` | 写死 | 已启用「{name}」 | 提示 | [EmbedKeysPage.tsx:198](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L198) |
| `EmbedKeysPage.92652d09` | 写死 | 已停用「{name}」，合作网站上的组件最迟 60 秒后显示「暂时无法使用」 | 提示 | [EmbedKeysPage.tsx:198](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L198) |
| `EmbedKeysPage.51204e85` | 写死 | 停用 | 文字 | [EmbedKeysPage.tsx:202](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L202)、223、278 行 |
| `EmbedKeysPage.5a1bb0bc` | 写死 | 这个嵌入码刚被别人改过，页面已刷新。 | 文字 | [EmbedKeysPage.tsx:202](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L202) |
| `EmbedKeysPage.9c26ffd9` | 写死 | 启用 | 文字 | [EmbedKeysPage.tsx:202](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L202)、278 行 |
| `EmbedKeysPage.1230c4bf` | 写死 | 停用「{name}」？ | 标题 | [EmbedKeysPage.tsx:213](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L213) |
| `EmbedKeysPage.e45b696c` | 写死 | 停用中… | 文字 | [EmbedKeysPage.tsx:221](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L221) |
| `EmbedKeysPage.a3e9912b` | 写死 | 停用后，{…} 上的预订组件最迟 60 秒后显示「暂时无法使用」，客人不能再从那里查询价格。之后可以再启用。 | 正文 | [EmbedKeysPage.tsx:227](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L227) |
| `EmbedKeysPage.7170004d` | 写死 | 已停用 | 名称 | [EmbedKeysPage.tsx:231](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L231) |
| `EmbedKeysPage.febcc9b5` | 写死 | 启用中 | 名称 | [EmbedKeysPage.tsx:231](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L231) |
| `EmbedKeysPage.4599b732` | 写死 | 已保存，合作网站上最迟 60 秒后生效 | 提示 | [EmbedKeysPage.tsx:242](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L242) |
| `EmbedKeysPage.2fb0a1c8` | 写死 | 嵌入码 | 名称 | [EmbedKeysPage.tsx:249](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L249) |
| `EmbedKeysPage.b5b0784f` | 写死 | 预订页地址 | 名称 | [EmbedKeysPage.tsx:257](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L257) |
| `EmbedKeysPage.e78f85df` | 写死 | 未填写 | 正文 | [EmbedKeysPage.tsx:257](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L257) |
| `EmbedKeysPage.9f67ddfd` | 写死 | 带来的订单 | 名称 | [EmbedKeysPage.tsx:259](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L259) |
| `EmbedKeysPage.c7ffe5d1` | 写死 | 近 30 天 {paid\_30d} 单 · 累计 {paid\_total} 单（已付款、没取消；只做统计，不作为分佣、结算依据） | 正文 | [EmbedKeysPage.tsx:260](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L260) |
| `EmbedKeysPage.6e8b6cff` | 写死 | 查看这些订单 | 链接 | [EmbedKeysPage.tsx:263](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L263) |
| `EmbedKeysPage.7d02522b` | 写死 | 备注 | 名称 | [EmbedKeysPage.tsx:266](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L266) |
| `EmbedKeysPage.ef77102b` | 写死 | 最后修改 | 名称 | [EmbedKeysPage.tsx:267](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L267) |
| `EmbedKeysPage.0eedb910` | 写死 | 修改 | 按钮 | [EmbedKeysPage.tsx:276](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L276) |
| `EmbedKeysPage.9b23c28e` | 写死 | 启用中… | 文字 | [EmbedKeysPage.tsx:277](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L277) |
| `EmbedKeysPage.b1ee0187` | 写死 | 复制{owner}的{title}代码 | 名称 | [EmbedKeysPage.tsx:296](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L296) |
| `EmbedKeysPage.de7342f7` | 写死 | {owner}的{title}代码 | 读屏说明 | [EmbedKeysPage.tsx:300](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L300) |
| `EmbedKeysPage.8bac6450` | 写死 | 要放在和预订页同一个网站（{bookingOrigin}）的页面上；放在别的网站上时，客人会跳到 NOZOMI 主站。 | 正文 | [EmbedKeysPage.tsx:313](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L313) |
| `EmbedKeysPage.eac2fb32` | 写死 | 合作网站要放的代码 | 标题 | [EmbedKeysPage.tsx:322](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L322) |
| `EmbedKeysPage.b398fd9b` | 写死 | ① 入口小程序 | 标题 | [EmbedKeysPage.tsx:323](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L323) |
| `EmbedKeysPage.e535189a` | 写死 | ② 预订程序 | 标题 | [EmbedKeysPage.tsx:325](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L325) |
| `EmbedKeysPage.d6c23465` | 写死 | 复制后交给合作网站。{…} | 正文 | [EmbedKeysPage.tsx:329](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L329) |
| `EmbedKeysPage.780c3149` | 写死 | 嵌入组件 · NOZOMI {name} | 浏览器标题 | [EmbedKeysPage.tsx:336](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L336) |
| `EmbedKeysPage.8a42e721` | 写死 | 嵌入组件 | 名称 | [EmbedKeysPage.tsx:343](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L343)、344 行 |
| `EmbedKeysPage.61e96831` | 写死 | 新建嵌入码 | 按钮 | [EmbedKeysPage.tsx:344](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L344)、361 行 |
| `EmbedKeysPage.71b477cf` | 写死 | 重试 | 按钮 | [EmbedKeysPage.tsx:352](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L352) |
| `EmbedKeysPage.8e4b5e79` | 写死 | 嵌入码没有加载出来 | 标题 | [EmbedKeysPage.tsx:352](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L352) |
| `EmbedKeysPage.d380ae29` | 写死 | 请检查网络后重试。 | 说明 | [EmbedKeysPage.tsx:352](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L352) |
| `EmbedKeysPage.ba3fb21b` | 写死 | 合作网站放一段代码，就能在他们的页面上显示「区间 / 包车」预订表单；客人点「查询价格」后跳到主站完成预订和付款。填了预订页地址并允许整页嵌入的，再给第二段代码，客人在合作网站自己的预订页里完成预订。只有下面「允许的网站」里的网站能用。 | 正文 | [EmbedKeysPage.tsx:356](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L356) |
| `EmbedKeysPage.8b3b8d23` | 写死 | 生成嵌入码 | 按钮 | [EmbedKeysPage.tsx:364](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L364) |
| `EmbedKeysPage.a0944cb3` | 写死 | 已生成「{name}」的嵌入码，复制下面的代码交给合作网站 | 提示 | [EmbedKeysPage.tsx:369](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L369) |
| `EmbedKeysPage.2735bf03` | 写死 | 还没有人建过嵌入码。 | 说明 | [EmbedKeysPage.tsx:376](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L376) |
| `EmbedKeysPage.c568d75b` | 写死 | 点「新建嵌入码」，填合作网站的地址后生成。 | 说明 | [EmbedKeysPage.tsx:376](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L376) |
| `EmbedKeysPage.d7c00391` | 写死 | 还没有嵌入码 | 标题 | [EmbedKeysPage.tsx:376](../../apps/web/src/pages/platform/EmbedKeysPage.tsx#L376) |

## 赔付表

文件：`apps/web/src/pages/platform/CompensationTablePage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CompensationTablePage.faead3ce` | 写死 | 结算价 × 100%（违约金）+ 客人的替代交通报销 | 文字 | [CompensationTablePage.tsx:35](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L35) |
| `CompensationTablePage.2a1a9de0` | 写死 | 两个车型组的结算价之差 + 结算价 × {…} | 文字 | [CompensationTablePage.tsx:36](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L36) |
| `CompensationTablePage.0c73d9d5` | 写死 | 结算价 × {…} | 文字 | [CompensationTablePage.tsx:37](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L37) |
| `CompensationTablePage.c4ebed86` | 写死 | 全额退款 + 凭票报销替代交通（上限对外价的 {…}） | 文字 | [CompensationTablePage.tsx:41](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L41) |
| `CompensationTablePage.f1ea91eb` | 写死 | 差价 + 对外价的 {…} | 文字 | [CompensationTablePage.tsx:42](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L42) |
| `CompensationTablePage.2ebabbff` | 写死 | 对外价的 {…} | 文字 | [CompensationTablePage.tsx:43](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L43)、228 行 |
| `CompensationTablePage.cdc47b83` | 写死 | 填 0 到 100 之间的百分比，最多两位小数 | 文字 | [CompensationTablePage.tsx:81](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L81) |
| `CompensationTablePage.71acb2f9` | 写死 | 填 0 到 {…} 之间的整数（日元） | 文字 | [CompensationTablePage.tsx:85](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L85) |
| `CompensationTablePage.4d21d4d8` | 写死 | 填 0 到 {…} 之间的百分比 | 文字 | [CompensationTablePage.tsx:87](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L87) |
| `CompensationTablePage.5bd7e7e9` | 写死 | 填 0 到 100 之间的百分比（0 = 每一笔都复核） | 文字 | [CompensationTablePage.tsx:89](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L89) |
| `CompensationTablePage.7a3565b2` | 写死 | 有 {length} 处需要修改 | 文字 | [CompensationTablePage.tsx:92](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L92) |
| `CompensationTablePage.0d8b9afe` | 写死 | 按规则不能这样改：{…} | 文字 | [CompensationTablePage.tsx:102](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L102) |
| `CompensationTablePage.718b5221` | 写死 | 提交 | 文字 | [CompensationTablePage.tsx:103](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L103) |
| `CompensationTablePage.e669790c` | 写死 | {…}你填写的内容还在。 | 文字 | [CompensationTablePage.tsx:103](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L103) |
| `CompensationTablePage.ba3941f0` | 写死 | 修改赔付表 | 标题 | [CompensationTablePage.tsx:113](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L113)、153 行 |
| `CompensationTablePage.975ef71e` | 写死 | 提交后要另一位有审核权限的同事（运营或财务）在「待审核」里批准，才存成新的一版；之后判定的工单按新表，已经判定的不变。 | 正文 | [CompensationTablePage.tsx:115](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L115) |
| `CompensationTablePage.28ad2479` | 写死 | {…}（赔对外价的 %） | 名称 | [CompensationTablePage.tsx:119](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L119)、121 行 |
| `CompensationTablePage.88ddbcef` | 写死 | 全额退款，固定 100%，不能改 | 说明 | [CompensationTablePage.tsx:119](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L119) |
| `CompensationTablePage.18391472` | 写死 | 每笔至少等值（日元） | 名称 | [CompensationTablePage.tsx:124](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L124) |
| `CompensationTablePage.27e6588c` | 写死 | 客人付别的币种时按判定那一刻的汇率换算、向上取整；补足的部分平台承担 | 说明 | [CompensationTablePage.tsx:124](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L124) |
| `CompensationTablePage.17d3e896` | 写死 | 替代交通报销上限（对外价的 %） | 名称 | [CompensationTablePage.tsx:125](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L125) |
| `CompensationTablePage.46f06417` | 写死 | 150 = 对外价的 1.5 倍 | 说明 | [CompensationTablePage.tsx:125](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L125) |
| `CompensationTablePage.339652f5` | 写死 | 判定要复核的阈值（赔客人达到对外价的 %） | 名称 | [CompensationTablePage.tsx:126](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L126) |
| `CompensationTablePage.698b0f80` | 写死 | 达到时判定要另一位同事批准；0 = 每一笔都复核 | 说明 | [CompensationTablePage.tsx:126](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L126) |
| `CompensationTablePage.cdbc9720` | 写死 | 审核的同事看得到 | 说明 | [CompensationTablePage.tsx:128](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L128) |
| `CompensationTablePage.fbaae742` | 写死 | 为什么改（选填） | 名称 | [CompensationTablePage.tsx:128](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L128) |
| `CompensationTablePage.153c8f31` | 写死 | 取消 | 按钮 | [CompensationTablePage.tsx:132](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L132) |
| `CompensationTablePage.928b6804` | 写死 | 提交中… | 文字 | [CompensationTablePage.tsx:133](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L133) |
| `CompensationTablePage.de2c1eaa` | 写死 | 提交复核 | 按钮 | [CompensationTablePage.tsx:135](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L135) |
| `CompensationTablePage.097c6598` | 写死 | 赔付表 · NOZOMI {name} | 浏览器标题 | [CompensationTablePage.tsx:143](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L143) |
| `CompensationTablePage.61027753` | 写死 | 赔付表 | 名称 | [CompensationTablePage.tsx:152](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L152)、200 行 |
| `CompensationTablePage.7e8865ff` | 写死 | 客人赔付表 | 标题 | [CompensationTablePage.tsx:153](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L153) |
| `CompensationTablePage.52e863f3` | 写死 | 加载失败 | 标题 | [CompensationTablePage.tsx:161](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L161) |
| `CompensationTablePage.612bb2c7` | 写死 | 请检查网络后重试。 | 说明 | [CompensationTablePage.tsx:161](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L161) |
| `CompensationTablePage.ff762e81` | 写死 | 重试 | 按钮 | [CompensationTablePage.tsx:161](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L161) |
| `CompensationTablePage.e7625e9c` | 写死 | 客人投诉、履约失败成立时，按这张表赔客人（按对外价），责任在供应商的按同一比例乘以结算价承担，加价部分平台承担。每笔至少等值的最低额由平台先付。取消政策另在 | 正文 | [CompensationTablePage.tsx:166](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L166) |
| `CompensationTablePage.30660f46` | 写死 | 取消政策 | 链接 | [CompensationTablePage.tsx:169](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L169) |
| `CompensationTablePage.b6f7eea9` | 写死 | 里。 | 正文 | [CompensationTablePage.tsx:171](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L171) |
| `CompensationTablePage.95736fae` | 写死 | 已提交复核 | 正文 | [CompensationTablePage.tsx:174](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L174)、186 行 |
| `CompensationTablePage.5ffb78f8` | 写死 | 另一位有审核权限的同事批准后才生效；在那之前判定仍按下面这一版算。 | 正文 | [CompensationTablePage.tsx:175](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L175) |
| `CompensationTablePage.80caf312` | 写死 | 去「待审核」 | 链接 | [CompensationTablePage.tsx:176](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L176) |
| `CompensationTablePage.0e7c44fc` | 写死 | 现在用的：第 {version} 版 | 标题 | [CompensationTablePage.tsx:192](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L192) |
| `CompensationTablePage.4f6a67fe` | 写死 | 现在用的：默认表（需求原表，还没有人改过） | 标题 | [CompensationTablePage.tsx:192](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L192) |
| `CompensationTablePage.da51eb8f` | 写死 | 生效时间 | 正文 | [CompensationTablePage.tsx:196](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L196) |
| `CompensationTablePage.823a812a` | 写死 | 问题 | 表头 | [CompensationTablePage.tsx:204](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L204) |
| `CompensationTablePage.e9f89c4d` | 写死 | 赔客人 | 表头 | [CompensationTablePage.tsx:205](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L205) |
| `CompensationTablePage.4af130a8` | 写死 | 供应商承担（结算币种） | 表头 | [CompensationTablePage.tsx:206](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L206) |
| `CompensationTablePage.a427b103` | 写死 | 每笔至少等值 | 正文 | [CompensationTablePage.tsx:223](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L223) |
| `CompensationTablePage.30664b27` | 写死 | 替代交通报销上限 | 正文 | [CompensationTablePage.tsx:227](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L227) |
| `CompensationTablePage.4bc5f7ec` | 写死 | 判定要复核的阈值 | 正文 | [CompensationTablePage.tsx:231](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L231) |
| `CompensationTablePage.720f62dc` | 写死 | 每一笔都复核 | 正文 | [CompensationTablePage.tsx:232](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L232) |
| `CompensationTablePage.ea6cc0f0` | 写死 | 赔客人的钱达到对外价的 {…} | 正文 | [CompensationTablePage.tsx:232](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L232) |
| `CompensationTablePage.b834005d` | 写死 | 你可以查看，但没有修改赔付表的权限。 | 正文 | [CompensationTablePage.tsx:235](../../apps/web/src/pages/platform/CompensationTablePage.tsx#L235) |

## 财务结算（账单、付款批次）

文件：`apps/web/src/pages/platform/FinancePages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FinancePages.4006cc14` | 写死 | 你没有权限查看这里 | 标题 | [FinancePages.tsx:58](../../apps/web/src/pages/platform/FinancePages.tsx#L58) |
| `FinancePages.67f018c0` | 写死 | 财务结算只给不限数据范围的账号用（一张账单包含供应商在各城市、各渠道的订单）。需要的话，请联系管理员。 | 说明 | [FinancePages.tsx:58](../../apps/web/src/pages/platform/FinancePages.tsx#L58) |
| `FinancePages.427990d5` | 写死 | 这张账单有一条待审核的付款复核，不能作废。请先在「待审核」里驳回或撤回。 | 提示 | [FinancePages.tsx:67](../../apps/web/src/pages/platform/FinancePages.tsx#L67) |
| `FinancePages.1c519462` | 写死 | 账单的状态刚变了（可能供应商刚确认或提了异议）。关掉对话框后页面会刷新。 | 提示 | [FinancePages.tsx:68](../../apps/web/src/pages/platform/FinancePages.tsx#L68) |
| `FinancePages.dbb4887a` | 写死 | 限定了数据范围的账号不能做财务结算的操作。 | 提示 | [FinancePages.tsx:69](../../apps/web/src/pages/platform/FinancePages.tsx#L69) |
| `FinancePages.9691f63b` | 写死 | 状态 | 名称 | [FinancePages.tsx:82](../../apps/web/src/pages/platform/FinancePages.tsx#L82)、215、611、620、665 行 |
| `FinancePages.26fbb0f7` | 写死 | 全部 | 名称 | [FinancePages.tsx:84](../../apps/web/src/pages/platform/FinancePages.tsx#L84)、87、620 行 |
| `FinancePages.67a7ebf0` | 写死 | 周期 | 名称 | [FinancePages.tsx:87](../../apps/web/src/pages/platform/FinancePages.tsx#L87)、214、664 行 |
| `FinancePages.2fcb15cd` | 写死 | 周期写成 YYYY-MM，如 2026-09；不填就是上个月 | 错误提示 | [FinancePages.tsx:103](../../apps/web/src/pages/platform/FinancePages.tsx#L103) |
| `FinancePages.7a6b3847` | 写死 | 出账 | 文字 | [FinancePages.tsx:112](../../apps/web/src/pages/platform/FinancePages.tsx#L112)、133 行 |
| `FinancePages.877186a5` | 写死 | 手工出账 | 标题 | [FinancePages.tsx:120](../../apps/web/src/pages/platform/FinancePages.tsx#L120)、189 行 |
| `FinancePages.d0756373` | 写死 | 取消 | 按钮 | [FinancePages.tsx:130](../../apps/web/src/pages/platform/FinancePages.tsx#L130)、736 行 |
| `FinancePages.d694201f` | 写死 | 出账中… | 文字 | [FinancePages.tsx:131](../../apps/web/src/pages/platform/FinancePages.tsx#L131) |
| `FinancePages.80642fb4` | 写死 | 知道了 | 按钮 | [FinancePages.tsx:138](../../apps/web/src/pages/platform/FinancePages.tsx#L138)、736 行 |
| `FinancePages.35e1888e` | 写死 | 每月 1 日起系统每小时自动出上个月的账；这里可以马上出。已经出过的不会重复，期间结案的进下一期（往期调整）。出账后账单直接发给供应商，等它 7 天内确认。 | 正文 | [FinancePages.tsx:145](../../apps/web/src/pages/platform/FinancePages.tsx#L145) |
| `FinancePages.2af09926` | 写死 | 年-月 | 输入框占位 | [FinancePages.tsx:146](../../apps/web/src/pages/platform/FinancePages.tsx#L146) |
| `FinancePages.62baca04` | 写死 | 写成 2026-09 这样；不填就是上个月（按东京日期）；只能出已经结束的月份 | 说明 | [FinancePages.tsx:146](../../apps/web/src/pages/platform/FinancePages.tsx#L146) |
| `FinancePages.aa1bdf20` | 写死 | 周期（选填） | 名称 | [FinancePages.tsx:146](../../apps/web/src/pages/platform/FinancePages.tsx#L146) |
| `FinancePages.a36e00ed` | 写死 | {…}：新出了 {length} 张账单。 | 正文 | [FinancePages.tsx:150](../../apps/web/src/pages/platform/FinancePages.tsx#L150) |
| `FinancePages.c649727b` | 写死 | 没有新的应付：这一期该出的都出过了，或者没有结案的订单。 | 正文 | [FinancePages.tsx:151](../../apps/web/src/pages/platform/FinancePages.tsx#L151) |
| `FinancePages.600c15de` | 写死 | {length} 家供应商没有出成 | 正文 | [FinancePages.tsx:154](../../apps/web/src/pages/platform/FinancePages.tsx#L154) |
| `FinancePages.1150af6a` | 写死 | 别的供应商照常出了。处理好原因后再点一次「手工出账」会重试这几家。 | 正文 | [FinancePages.tsx:160](../../apps/web/src/pages/platform/FinancePages.tsx#L160) |
| `FinancePages.143026ca` | 写死 | 账单 · NOZOMI {name} | 浏览器标题 | [FinancePages.tsx:171](../../apps/web/src/pages/platform/FinancePages.tsx#L171) |
| `FinancePages.7c14aead` | 写死 | 财务结算 | 名称 | [FinancePages.tsx:193](../../apps/web/src/pages/platform/FinancePages.tsx#L193)、289、603、651 行 |
| `FinancePages.ae1e860f` | 写死 | 账单 | 名称 | [FinancePages.tsx:193](../../apps/web/src/pages/platform/FinancePages.tsx#L193)、194、238、286、289、612、678 行 |
| `FinancePages.8483e700` | 写死 | 账单号 | 文字 | [FinancePages.tsx:212](../../apps/web/src/pages/platform/FinancePages.tsx#L212)、662 行 |
| `FinancePages.a6147784` | 写死 | 供应商 | 文字 | [FinancePages.tsx:213](../../apps/web/src/pages/platform/FinancePages.tsx#L213)、663 行 |
| `FinancePages.82b55faa` | 写死 | 合计（应付供应商） | 文字 | [FinancePages.tsx:216](../../apps/web/src/pages/platform/FinancePages.tsx#L216)、342 行 |
| `FinancePages.68c6cb41` | 写死 | {line\_count} 条 | 文字 | [FinancePages.tsx:217](../../apps/web/src/pages/platform/FinancePages.tsx#L217)、346 行 |
| `FinancePages.f2b366c0` | 写死 | 明细 | 文字 | [FinancePages.tsx:217](../../apps/web/src/pages/platform/FinancePages.tsx#L217)、346、432 行 |
| `FinancePages.1cd097e3` | 写死 | 应付日 | 文字 | [FinancePages.tsx:218](../../apps/web/src/pages/platform/FinancePages.tsx#L218)、354 行 |
| `FinancePages.39247fc7` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [FinancePages.tsx:221](../../apps/web/src/pages/platform/FinancePages.tsx#L221) |
| `FinancePages.767099a5` | 写死 | 没有符合条件的账单 | 标题 | [FinancePages.tsx:221](../../apps/web/src/pages/platform/FinancePages.tsx#L221) |
| `FinancePages.9cf63104` | 写死 | 清空筛选 | 按钮 | [FinancePages.tsx:221](../../apps/web/src/pages/platform/FinancePages.tsx#L221) |
| `FinancePages.3a84992c` | 写死 | 还没有账单 | 标题 | [FinancePages.tsx:223](../../apps/web/src/pages/platform/FinancePages.tsx#L223) |
| `FinancePages.fa67d1cd` | 写死 | 每月 1 日起系统自动给有结案订单的供应商出上个月的账（已完成、no-show 审核通过、有偿取消、事后加收、应扣款项）。 | 说明 | [FinancePages.tsx:223](../../apps/web/src/pages/platform/FinancePages.tsx#L223) |
| `FinancePages.2bf4aba9` | 写死 | 供应商应付账单：月结，按订单的服务日期（城市当地）切月；供应商 7 天内确认（可提异议），财务发起付款复核、另一位批准后进次月 20 日的付款批次。金额是供应商的结算币种。 | 正文 | [FinancePages.tsx:228](../../apps/web/src/pages/platform/FinancePages.tsx#L228) |
| `FinancePages.58139cb5` | 写死 | 看付款批次 | 链接 | [FinancePages.tsx:232](../../apps/web/src/pages/platform/FinancePages.tsx#L232) |
| `FinancePages.d0f986c7` | 写死 | 出账完成 | 提示 | [FinancePages.tsx:258](../../apps/web/src/pages/platform/FinancePages.tsx#L258) |
| `FinancePages.94f76e26` | 写死 | 账单 {statement\_no} | 标题 | [FinancePages.tsx:286](../../apps/web/src/pages/platform/FinancePages.tsx#L286) |
| `FinancePages.4519f01a` | 写死 | 链接可能有误。 | 说明 | [FinancePages.tsx:295](../../apps/web/src/pages/platform/FinancePages.tsx#L295)、657 行 |
| `FinancePages.65d72c26` | 写死 | 找不到这张账单 | 标题 | [FinancePages.tsx:295](../../apps/web/src/pages/platform/FinancePages.tsx#L295) |
| `FinancePages.46b1ec7a` | 写死 | 重试 | 按钮 | [FinancePages.tsx:297](../../apps/web/src/pages/platform/FinancePages.tsx#L297)、659 行 |
| `FinancePages.88277d22` | 写死 | 加载失败 | 标题 | [FinancePages.tsx:297](../../apps/web/src/pages/platform/FinancePages.tsx#L297)、659 行 |
| `FinancePages.cc616d42` | 写死 | 请检查网络后重试。 | 说明 | [FinancePages.tsx:297](../../apps/web/src/pages/platform/FinancePages.tsx#L297)、659 行 |
| `FinancePages.ed524358` | 写死 | 已作废并重出 | 正文 | [FinancePages.tsx:311](../../apps/web/src/pages/platform/FinancePages.tsx#L311)、490 行 |
| `FinancePages.69446d87` | 写死 | 按现在的数据这一期没有应付，没有重出账单。 | 正文 | [FinancePages.tsx:312](../../apps/web/src/pages/platform/FinancePages.tsx#L312) |
| `FinancePages.ca621401` | 写死 | 按现在的数据重出了： | 正文 | [FinancePages.tsx:312](../../apps/web/src/pages/platform/FinancePages.tsx#L312) |
| `FinancePages.b3b46ba9` | 写死 | 付款复核待审核 | 正文 | [FinancePages.tsx:322](../../apps/web/src/pages/platform/FinancePages.tsx#L322) |
| `FinancePages.797bacff` | 写死 | 另一位有审核权限的同事批准后，这张账单进付款批次。 | 正文 | [FinancePages.tsx:323](../../apps/web/src/pages/platform/FinancePages.tsx#L323) |
| `FinancePages.8d3b1ff8` | 写死 | 去「待审核」 | 链接 | [FinancePages.tsx:324](../../apps/web/src/pages/platform/FinancePages.tsx#L324) |
| `FinancePages.a59ebe08` | 写死 | 供应商提了异议 | 正文 | [FinancePages.tsx:329](../../apps/web/src/pages/platform/FinancePages.tsx#L329) |
| `FinancePages.22c4e736` | 写死 | 账目有误的，先在源头改（审核加收、更正订单），再作废并重出；没有问题的，答复供应商，账单回到「待确认」，重新给 7 天确认。 | 正文 | [FinancePages.tsx:331](../../apps/web/src/pages/platform/FinancePages.tsx#L331) |
| `FinancePages.7b75ef0e` | 写死 | 币种 | 名称 | [FinancePages.tsx:345](../../apps/web/src/pages/platform/FinancePages.tsx#L345) |
| `FinancePages.a8e46ebe` | 写死 | 出账时间 | 名称 | [FinancePages.tsx:347](../../apps/web/src/pages/platform/FinancePages.tsx#L347) |
| `FinancePages.e95f3b87` | 写死 | 确认期截止 | 名称 | [FinancePages.tsx:350](../../apps/web/src/pages/platform/FinancePages.tsx#L350) |
| `FinancePages.0cd86012` | 写死 | 确认 | 名称 | [FinancePages.tsx:353](../../apps/web/src/pages/platform/FinancePages.tsx#L353) |
| `FinancePages.531cd404` | 写死 | 确认期满，视为确认 ·  | 正文 | [FinancePages.tsx:353](../../apps/web/src/pages/platform/FinancePages.tsx#L353) |
| `FinancePages.c75dc33b` | 写死 | 供应商确认 ·  | 正文 | [FinancePages.tsx:353](../../apps/web/src/pages/platform/FinancePages.tsx#L353) |
| `FinancePages.c0cd4804` | 写死 | 付款日 | 名称 | [FinancePages.tsx:355](../../apps/web/src/pages/platform/FinancePages.tsx#L355)、610 行 |
| `FinancePages.2d342928` | 写死 | 银行流水号 | 名称 | [FinancePages.tsx:356](../../apps/web/src/pages/platform/FinancePages.tsx#L356) |
| `FinancePages.c06f7ba3` | 写死 | 付款批次 | 名称 | [FinancePages.tsx:358](../../apps/web/src/pages/platform/FinancePages.tsx#L358)、603、604、624、648、651 行 |
| `FinancePages.abd1a354` | 写死 | 看批次 | 链接 | [FinancePages.tsx:360](../../apps/web/src/pages/platform/FinancePages.tsx#L360) |
| `FinancePages.d05b98da` | 写死 | 作废原因 | 名称 | [FinancePages.tsx:365](../../apps/web/src/pages/platform/FinancePages.tsx#L365)、476 行 |
| `FinancePages.ce95b2c2` | 写死 | 发起付款复核 | 按钮 | [FinancePages.tsx:375](../../apps/web/src/pages/platform/FinancePages.tsx#L375)、496 行 |
| `FinancePages.c90e3119` | 写死 | 答复异议 | 按钮 | [FinancePages.tsx:380](../../apps/web/src/pages/platform/FinancePages.tsx#L380) |
| `FinancePages.369fa904` | 写死 | 作废并重出 | 按钮 | [FinancePages.tsx:385](../../apps/web/src/pages/platform/FinancePages.tsx#L385)、479 行 |
| `FinancePages.64eefcba` | 写死 | 你可以查看，但没有处理账单的权限。 | 正文 | [FinancePages.tsx:389](../../apps/web/src/pages/platform/FinancePages.tsx#L389) |
| `FinancePages.77a7dcc0` | 写死 | 看这张账单的操作记录 | 链接 | [FinancePages.tsx:393](../../apps/web/src/pages/platform/FinancePages.tsx#L393) |
| `FinancePages.f9f89f0b` | 写死 | 小计 | 标题 | [FinancePages.tsx:400](../../apps/web/src/pages/platform/FinancePages.tsx#L400)、402 行 |
| `FinancePages.6e7ec078` | 写死 | 种类 | 表头 | [FinancePages.tsx:406](../../apps/web/src/pages/platform/FinancePages.tsx#L406)、536 行 |
| `FinancePages.6fdd6582` | 写死 | 条数 | 表头 | [FinancePages.tsx:409](../../apps/web/src/pages/platform/FinancePages.tsx#L409) |
| `FinancePages.7f131bd6` | 写死 | 金额 | 表头 | [FinancePages.tsx:412](../../apps/web/src/pages/platform/FinancePages.tsx#L412)、541 行 |
| `FinancePages.8cc5fe1f` | 写死 | 正数是平台付给供应商的，负数是从应付里扣的（违约金、救援差价、客人赔付、报销、上期结转）。服务日期是城市当地日期。 | 正文 | [FinancePages.tsx:433](../../apps/web/src/pages/platform/FinancePages.tsx#L433) |
| `FinancePages.36b4e1e4` | 写死 | 经过 | 标题 | [FinancePages.tsx:440](../../apps/web/src/pages/platform/FinancePages.tsx#L440) |
| `FinancePages.0c5bf3ef` | 写死 | 时间按你的本地时区（{…}）显示。供应商看得到异议、答复、作废原因，看不到付款复核的说明。 | 正文 | [FinancePages.tsx:452](../../apps/web/src/pages/platform/FinancePages.tsx#L452) |
| `FinancePages.3183db3d` | 写死 | 答复供应商的异议 | 标题 | [FinancePages.tsx:457](../../apps/web/src/pages/platform/FinancePages.tsx#L457) |
| `FinancePages.d22887d1` | 写死 | 答复后账单回到「待确认」，重新给供应商 7 天确认。供应商看得到这段答复。 | 正文 | [FinancePages.tsx:458](../../apps/web/src/pages/platform/FinancePages.tsx#L458) |
| `FinancePages.3a5d02cc` | 写死 | 答复 | 名称 | [FinancePages.tsx:459](../../apps/web/src/pages/platform/FinancePages.tsx#L459)、461、463 行 |
| `FinancePages.1373d543` | 写死 | 提交中… | 文字 | [FinancePages.tsx:462](../../apps/web/src/pages/platform/FinancePages.tsx#L462)、507 行 |
| `FinancePages.b3628d60` | 写死 | 已答复，等供应商确认 | 文字 | [FinancePages.tsx:469](../../apps/web/src/pages/platform/FinancePages.tsx#L469) |
| `FinancePages.83927844` | 写死 | 作废这张账单并重出？ | 标题 | [FinancePages.tsx:474](../../apps/web/src/pages/platform/FinancePages.tsx#L474) |
| `FinancePages.dfd50d8b` | 写死 | 账单和明细一起作废，按现在的数据马上重出这一期这家供应商的账单（新的账单号）。供应商看得到作废原因。作废不能撤销。 | 正文 | [FinancePages.tsx:475](../../apps/web/src/pages/platform/FinancePages.tsx#L475) |
| `FinancePages.8d27ce35` | 写死 | 作废中… | 文字 | [FinancePages.tsx:480](../../apps/web/src/pages/platform/FinancePages.tsx#L480) |
| `FinancePages.6f766a9f` | 写死 | 作废 | 按钮 | [FinancePages.tsx:481](../../apps/web/src/pages/platform/FinancePages.tsx#L481) |
| `FinancePages.1a44c414` | 写死 | 付款给「{name}」：{…} 合计 {…}，应付日 {pay\_due\_on}。 | 正文 | [FinancePages.tsx:499](../../apps/web/src/pages/platform/FinancePages.tsx#L499) |
| `FinancePages.a9e2e46d` | 写死 | 要另一位有审核权限的同事在「待审核」里批准：合计为正进付款批次，为 0 记为无需付款，为负转入下一期。 | 正文 | [FinancePages.tsx:500](../../apps/web/src/pages/platform/FinancePages.tsx#L500) |
| `FinancePages.d5821b5f` | 写死 | 给审核人的说明（选填） | 名称 | [FinancePages.tsx:503](../../apps/web/src/pages/platform/FinancePages.tsx#L503) |
| `FinancePages.85906266` | 写死 | 提交复核 | 按钮 | [FinancePages.tsx:506](../../apps/web/src/pages/platform/FinancePages.tsx#L506) |
| `FinancePages.16a27779` | 写死 | 提交 | 按钮 | [FinancePages.tsx:508](../../apps/web/src/pages/platform/FinancePages.tsx#L508) |
| `FinancePages.cd1a6907` | 写死 | 已提交付款复核，等另一位同事批准 | 提示 | [FinancePages.tsx:517](../../apps/web/src/pages/platform/FinancePages.tsx#L517) |
| `FinancePages.4a3309ce` | 写死 | 没有明细。 | 正文 | [FinancePages.tsx:528](../../apps/web/src/pages/platform/FinancePages.tsx#L528) |
| `FinancePages.ed93c41d` | 写死 | 账单明细 | 读屏说明 | [FinancePages.tsx:532](../../apps/web/src/pages/platform/FinancePages.tsx#L532) |
| `FinancePages.288add58` | 写死 | 订单号 | 表头 | [FinancePages.tsx:537](../../apps/web/src/pages/platform/FinancePages.tsx#L537) |
| `FinancePages.6a85ef1c` | 写死 | 服务日期 | 表头 | [FinancePages.tsx:538](../../apps/web/src/pages/platform/FinancePages.tsx#L538) |
| `FinancePages.68581ad5` | 写死 | 怎么来的 | 表头 | [FinancePages.tsx:542](../../apps/web/src/pages/platform/FinancePages.tsx#L542) |
| `FinancePages.f52bed78` | 写死 | 往期调整 | 正文 | [FinancePages.tsx:551](../../apps/web/src/pages/platform/FinancePages.tsx#L551) |
| `FinancePages.15f69aef` | 写死 | 已作废 | 正文 | [FinancePages.tsx:552](../../apps/web/src/pages/platform/FinancePages.tsx#L552) |
| `FinancePages.4de7836d` | 写死 | {…}（{count} 张） | 正文 | [FinancePages.tsx:587](../../apps/web/src/pages/platform/FinancePages.tsx#L587) |
| `FinancePages.9a935101` | 写死 | 付款批次 · NOZOMI {name} | 浏览器标题 | [FinancePages.tsx:595](../../apps/web/src/pages/platform/FinancePages.tsx#L595) |
| `FinancePages.a4b821d0` | 写死 | {statement\_count} 张 | 文字 | [FinancePages.tsx:612](../../apps/web/src/pages/platform/FinancePages.tsx#L612)、678 行 |
| `FinancePages.cc872d3b` | 写死 | 合计（按币种） | 文字 | [FinancePages.tsx:613](../../apps/web/src/pages/platform/FinancePages.tsx#L613) |
| `FinancePages.4e68db8a` | 写死 | 锁定时间 | 文字 | [FinancePages.tsx:614](../../apps/web/src/pages/platform/FinancePages.tsx#L614) |
| `FinancePages.6fbdc67f` | 写死 | 一个付款日一个批次（默认次月 20 日）。付款复核批准后账单自动进它的应付日的批次；批次锁定后，之后批准的进下个月同一天。锁定后在批次详情里生成银行转账文件，转账后回填银行流水号。 | 正文 | [FinancePages.tsx:618](../../apps/web/src/pages/platform/FinancePages.tsx#L618) |
| `FinancePages.01841455` | 写死 | 账单的付款复核批准后，会按付款日进批次。 | 说明 | [FinancePages.tsx:630](../../apps/web/src/pages/platform/FinancePages.tsx#L630) |
| `FinancePages.4cca5fba` | 写死 | 还没有付款批次 | 标题 | [FinancePages.tsx:630](../../apps/web/src/pages/platform/FinancePages.tsx#L630) |
| `FinancePages.8876fe32` | 写死 | 没有符合条件的付款批次 | 标题 | [FinancePages.tsx:630](../../apps/web/src/pages/platform/FinancePages.tsx#L630) |
| `FinancePages.b4a9b68a` | 写死 | 付款批次 {pay\_date} | 标题 | [FinancePages.tsx:648](../../apps/web/src/pages/platform/FinancePages.tsx#L648) |
| `FinancePages.a0aa1b1a` | 写死 | 找不到这个付款批次 | 标题 | [FinancePages.tsx:657](../../apps/web/src/pages/platform/FinancePages.tsx#L657) |
| `FinancePages.1cd00655` | 写死 | 合计 | 文字 | [FinancePages.tsx:666](../../apps/web/src/pages/platform/FinancePages.tsx#L666) |
| `FinancePages.13f234b8` | 写死 | {pay\_date} 付款 | 标题 | [FinancePages.tsx:673](../../apps/web/src/pages/platform/FinancePages.tsx#L673) |
| `FinancePages.e052e1ee` | 写死 | 合计（按币种，不相加） | 名称 | [FinancePages.tsx:679](../../apps/web/src/pages/platform/FinancePages.tsx#L679) |
| `FinancePages.af4302e4` | 写死 | 锁定 | 名称 | [FinancePages.tsx:680](../../apps/web/src/pages/platform/FinancePages.tsx#L680)、722、741 行 |
| `FinancePages.e1168155` | 写死 | 锁定批次 | 按钮 | [FinancePages.tsx:686](../../apps/web/src/pages/platform/FinancePages.tsx#L686) |
| `FinancePages.5d5b2a21` | 写死 | 批次里还没有账单 | 标题 | [FinancePages.tsx:691](../../apps/web/src/pages/platform/FinancePages.tsx#L691) |
| `FinancePages.8b9fbbcf` | 写死 | 批次里的账单 | 名称 | [FinancePages.tsx:691](../../apps/web/src/pages/platform/FinancePages.tsx#L691) |
| `FinancePages.dd3f4b43` | 写死 | 付款复核批准后的账单会进来。 | 说明 | [FinancePages.tsx:691](../../apps/web/src/pages/platform/FinancePages.tsx#L691) |
| `FinancePages.b5cf14c4` | 写死 | 已锁定付款批次 | 提示 | [FinancePages.tsx:701](../../apps/web/src/pages/platform/FinancePages.tsx#L701) |
| `FinancePages.93392d6e` | 写死 | 锁定 {pay\_date} 的付款批次？ | 标题 | [FinancePages.tsx:730](../../apps/web/src/pages/platform/FinancePages.tsx#L730) |
| `FinancePages.0046b112` | 写死 | 锁定中… | 文字 | [FinancePages.tsx:739](../../apps/web/src/pages/platform/FinancePages.tsx#L739) |
| `FinancePages.67048a65` | 写死 | 锁定后这一天不再收新的账单：之后批准的付款进下个月同一天。锁定后才能生成银行转账文件。锁定不能撤销。 | 正文 | [FinancePages.tsx:747](../../apps/web/src/pages/platform/FinancePages.tsx#L747) |

## 收款账户审核和银行文件

文件：`apps/web/src/pages/platform/BankFilePages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `BankFilePages.57719273` | 写死 | 你没有权限查看这里 | 标题 | [BankFilePages.tsx:56](../../apps/web/src/pages/platform/BankFilePages.tsx#L56) |
| `BankFilePages.66bdc500` | 写死 | 财务结算只给不限数据范围的账号用（转账文件和收款账户跨城市、跨渠道，切不开）。 | 说明 | [BankFilePages.tsx:56](../../apps/web/src/pages/platform/BankFilePages.tsx#L56) |
| `BankFilePages.ca6398b0` | 写死 | 账单号 | 文字 | [BankFilePages.tsx:65](../../apps/web/src/pages/platform/BankFilePages.tsx#L65)、74、356 行 |
| `BankFilePages.b09e257e` | 写死 | 供应商 | 文字 | [BankFilePages.tsx:66](../../apps/web/src/pages/platform/BankFilePages.tsx#L66)、75、357、507 行 |
| `BankFilePages.be5c8dbd` | 写死 | 收款人 | 文字 | [BankFilePages.tsx:67](../../apps/web/src/pages/platform/BankFilePages.tsx#L67)、358、510 行 |
| `BankFilePages.016b25d1` | 写死 | 银行 / SWIFT | 文字 | [BankFilePages.tsx:68](../../apps/web/src/pages/platform/BankFilePages.tsx#L68)、359 行 |
| `BankFilePages.64a61040` | 写死 | 账号 | 文字 | [BankFilePages.tsx:69](../../apps/web/src/pages/platform/BankFilePages.tsx#L69)、360、513 行 |
| `BankFilePages.fe48dc61` | 写死 | 账户最近变更 | 名称 | [BankFilePages.tsx:69](../../apps/web/src/pages/platform/BankFilePages.tsx#L69) |
| `BankFilePages.47f72f4a` | 写死 | 金额 | 文字 | [BankFilePages.tsx:70](../../apps/web/src/pages/platform/BankFilePages.tsx#L70)、76、361 行 |
| `BankFilePages.168b5136` | 写死 | 进不了文件的原因 | 文字 | [BankFilePages.tsx:77](../../apps/web/src/pages/platform/BankFilePages.tsx#L77) |
| `BankFilePages.6ed3c674` | 写死 | 文件号 | 文字 | [BankFilePages.tsx:81](../../apps/web/src/pages/platform/BankFilePages.tsx#L81) |
| `BankFilePages.16eddf35` | 写死 | 币种 | 文字 | [BankFilePages.tsx:82](../../apps/web/src/pages/platform/BankFilePages.tsx#L82)、508 行 |
| `BankFilePages.61eaceb4` | 写死 | 状态 | 文字 | [BankFilePages.tsx:83](../../apps/web/src/pages/platform/BankFilePages.tsx#L83)、509、539 行 |
| `BankFilePages.e03a2b21` | 写死 | 笔数 | 文字 | [BankFilePages.tsx:84](../../apps/web/src/pages/platform/BankFilePages.tsx#L84)、380 行 |
| `BankFilePages.eeccecc8` | 写死 | {item\_count} 笔 | 文字 | [BankFilePages.tsx:84](../../apps/web/src/pages/platform/BankFilePages.tsx#L84)、380 行 |
| `BankFilePages.547a76b9` | 写死 | 合计 | 文字 | [BankFilePages.tsx:85](../../apps/web/src/pages/platform/BankFilePages.tsx#L85)、377 行 |
| `BankFilePages.522e54f7` | 写死 | {currency} 的转账文件 | 读屏说明 | [BankFilePages.tsx:90](../../apps/web/src/pages/platform/BankFilePages.tsx#L90) |
| `BankFilePages.002e193f` | 写死 | 有一条待审核的生成复核，另一位同事批准后文件才生成。 | 提示 | [BankFilePages.tsx:96](../../apps/web/src/pages/platform/BankFilePages.tsx#L96) |
| `BankFilePages.7c6f41e7` | 写死 | 去「待审核」 | 链接 | [BankFilePages.tsx:96](../../apps/web/src/pages/platform/BankFilePages.tsx#L96) |
| `BankFilePages.090e329f` | 写死 | 有 {length} 张账单进不了文件。补好账户后可以再生成一个文件，只包含剩下的。 | 提示 | [BankFilePages.tsx:101](../../apps/web/src/pages/platform/BankFilePages.tsx#L101) |
| `BankFilePages.ce891c1c` | 写死 | {currency} 进不了文件的账单 | 名称 | [BankFilePages.tsx:103](../../apps/web/src/pages/platform/BankFilePages.tsx#L103) |
| `BankFilePages.ceccd7b8` | 写死 | {currency} 能进文件的账单 | 名称 | [BankFilePages.tsx:109](../../apps/web/src/pages/platform/BankFilePages.tsx#L109) |
| `BankFilePages.32684fe8` | 写死 | 这种币种的账单都已经在文件里了。 | 正文 | [BankFilePages.tsx:112](../../apps/web/src/pages/platform/BankFilePages.tsx#L112) |
| `BankFilePages.4c8f0988` | 写死 | 现在没有能进文件的账单。 | 正文 | [BankFilePages.tsx:112](../../apps/web/src/pages/platform/BankFilePages.tsx#L112) |
| `BankFilePages.2d68c061` | 写死 | 生成 {currency} 转账文件 | 按钮 | [BankFilePages.tsx:117](../../apps/web/src/pages/platform/BankFilePages.tsx#L117)、165 行 |
| `BankFilePages.eabd4882` | 写死 | 请确认后再继续 | 错误提示 | [BankFilePages.tsx:141](../../apps/web/src/pages/platform/BankFilePages.tsx#L141) |
| `BankFilePages.15f14d59` | 写死 | 发起 | 文字 | [BankFilePages.tsx:152](../../apps/web/src/pages/platform/BankFilePages.tsx#L152) |
| `BankFilePages.f76b0124` | 写死 | 取消 | 按钮 | [BankFilePages.tsx:174](../../apps/web/src/pages/platform/BankFilePages.tsx#L174)、282、441 行 |
| `BankFilePages.864e6d09` | 写死 | 提交中… | 文字 | [BankFilePages.tsx:176](../../apps/web/src/pages/platform/BankFilePages.tsx#L176)、283、557 行 |
| `BankFilePages.5204cf27` | 写死 | 提交复核 | 按钮 | [BankFilePages.tsx:178](../../apps/web/src/pages/platform/BankFilePages.tsx#L178)、556 行 |
| `BankFilePages.60f926ff` | 写死 | {length} 笔，合计 {…}。提交后要另一位同事在「待审核」批准，文件才生成。 | 正文 | [BankFilePages.tsx:184](../../apps/web/src/pages/platform/BankFilePages.tsx#L184) |
| `BankFilePages.c868fe4d` | 写死 | 手续费（Charges） | 名称 | [BankFilePages.tsx:185](../../apps/web/src/pages/platform/BankFilePages.tsx#L185) |
| `BankFilePages.010889c3` | 写死 | 排除 {length} 张账单 | 标题 | [BankFilePages.tsx:195](../../apps/web/src/pages/platform/BankFilePages.tsx#L195) |
| `BankFilePages.7d6433b7` | 写死 | 确认这次不付 {…} | 名称 | [BankFilePages.tsx:197](../../apps/web/src/pages/platform/BankFilePages.tsx#L197) |
| `BankFilePages.8d8352d4` | 写死 | 说明（选填） | 名称 | [BankFilePages.tsx:203](../../apps/web/src/pages/platform/BankFilePages.tsx#L203)、553 行 |
| `BankFilePages.d0ef6e7f` | 写死 | 银行转账文件 | 标题 | [BankFilePages.tsx:217](../../apps/web/src/pages/platform/BankFilePages.tsx#L217) |
| `BankFilePages.baab416b` | 写死 | 先锁定批次，再生成转账文件。一种币种一个文件，走双人复核。 | 正文 | [BankFilePages.tsx:218](../../apps/web/src/pages/platform/BankFilePages.tsx#L218) |
| `BankFilePages.3208c7ea` | 写死 | 加载失败 | 标题 | [BankFilePages.tsx:219](../../apps/web/src/pages/platform/BankFilePages.tsx#L219)、329 行 |
| `BankFilePages.5c2345ba` | 写死 | 重试 | 按钮 | [BankFilePages.tsx:219](../../apps/web/src/pages/platform/BankFilePages.tsx#L219)、329 行 |
| `BankFilePages.aa40e967` | 写死 | 请检查网络后重试。 | 说明 | [BankFilePages.tsx:219](../../apps/web/src/pages/platform/BankFilePages.tsx#L219)、329 行 |
| `BankFilePages.af681f8c` | 写死 | 文件太多，这里只显示最新的 200 个。 | 提示 | [BankFilePages.tsx:221](../../apps/web/src/pages/platform/BankFilePages.tsx#L221) |
| `BankFilePages.16e763d5` | 写死 | 这个批次的转账文件 | 名称 | [BankFilePages.tsx:224](../../apps/web/src/pages/platform/BankFilePages.tsx#L224) |
| `BankFilePages.83e344bb` | 写死 | 已提交复核，另一位同事批准后文件才生成 | 提示 | [BankFilePages.tsx:234](../../apps/web/src/pages/platform/BankFilePages.tsx#L234) |
| `BankFilePages.80f86432` | 写死 | 至少选一笔 | 文字 | [BankFilePages.tsx:257](../../apps/web/src/pages/platform/BankFilePages.tsx#L257) |
| `BankFilePages.ac3ad96b` | 写死 | 流水号是 1–64 位英文字母、数字和 / \_ . : -，要以字母或数字开头 | 文字 | [BankFilePages.tsx:257](../../apps/web/src/pages/platform/BankFilePages.tsx#L257) |
| `BankFilePages.ee76e9d0` | 写死 | 一次最多回填 {limit} 笔 | 文字 | [BankFilePages.tsx:257](../../apps/web/src/pages/platform/BankFilePages.tsx#L257) |
| `BankFilePages.8707a136` | 写死 | 回填 | 文字 | [BankFilePages.tsx:265](../../apps/web/src/pages/platform/BankFilePages.tsx#L265) |
| `BankFilePages.f7b31eab` | 写死 | 回填银行流水号 | 标题 | [BankFilePages.tsx:273](../../apps/web/src/pages/platform/BankFilePages.tsx#L273) |
| `BankFilePages.33e3f299` | 写死 | 记为已付款 | 按钮 | [BankFilePages.tsx:285](../../apps/web/src/pages/platform/BankFilePages.tsx#L285) |
| `BankFilePages.988fbcf9` | 写死 | 确认银行已经转出再回填。回填后账单记为已付款，供应商看得到流水号，不能改。 | 正文 | [BankFilePages.tsx:290](../../apps/web/src/pages/platform/BankFilePages.tsx#L290) |
| `BankFilePages.9d58248d` | 写死 | 还有 {length} 笔没回填，一次最多 {limit} 笔：已选好前 {limit} 笔，提交后再回填剩下的。 | 提示 | [BankFilePages.tsx:291](../../apps/web/src/pages/platform/BankFilePages.tsx#L291) |
| `BankFilePages.ca1b1aa3` | 写死 | 银行流水号 | 名称 | [BankFilePages.tsx:292](../../apps/web/src/pages/platform/BankFilePages.tsx#L292)、362 行 |
| `BankFilePages.79c679f3` | 写死 | 这个流水号对应哪几笔 | 标题 | [BankFilePages.tsx:294](../../apps/web/src/pages/platform/BankFilePages.tsx#L294) |
| `BankFilePages.c4de85b1` | 写死 | 转账文件 {file\_no} | 标题 | [BankFilePages.tsx:318](../../apps/web/src/pages/platform/BankFilePages.tsx#L318) |
| `BankFilePages.cdf787d9` | 写死 | 转账文件 | 标题 | [BankFilePages.tsx:318](../../apps/web/src/pages/platform/BankFilePages.tsx#L318) |
| `BankFilePages.596e1cf7` | 写死 | 付款批次 | 名称 | [BankFilePages.tsx:321](../../apps/web/src/pages/platform/BankFilePages.tsx#L321) |
| `BankFilePages.6152534d` | 写死 | 财务结算 | 名称 | [BankFilePages.tsx:321](../../apps/web/src/pages/platform/BankFilePages.tsx#L321)、501 行 |
| `BankFilePages.3b1906eb` | 写死 | 链接可能有误。 | 说明 | [BankFilePages.tsx:327](../../apps/web/src/pages/platform/BankFilePages.tsx#L327) |
| `BankFilePages.a64eb361` | 写死 | 找不到这个转账文件 | 标题 | [BankFilePages.tsx:327](../../apps/web/src/pages/platform/BankFilePages.tsx#L327) |
| `BankFilePages.810de240` | 写死 | 已下载 {name} | 提示 | [BankFilePages.tsx:342](../../apps/web/src/pages/platform/BankFilePages.tsx#L342) |
| `BankFilePages.87aa288c` | 写死 | 下载 | 文字 | [BankFilePages.tsx:347](../../apps/web/src/pages/platform/BankFilePages.tsx#L347)、386 行 |
| `BankFilePages.a3ba3075` | 写死 | 序号 | 文字 | [BankFilePages.tsx:355](../../apps/web/src/pages/platform/BankFilePages.tsx#L355) |
| `BankFilePages.c8467636` | 写死 | 账户已变更 | 名称 | [BankFilePages.tsx:360](../../apps/web/src/pages/platform/BankFilePages.tsx#L360) |
| `BankFilePages.4dfbe769` | 写死 | 已作废 | 名称 | [BankFilePages.tsx:362](../../apps/web/src/pages/platform/BankFilePages.tsx#L362)、478 行 |
| `BankFilePages.89fdcc89` | 写死 | {pay\_date} 付款 · {currency} | 标题 | [BankFilePages.tsx:369](../../apps/web/src/pages/platform/BankFilePages.tsx#L369) |
| `BankFilePages.954bf149` | 写死 | 合计和笔数是生成时的。其中 {length} 笔已作废、没有付款，实际付款看下面每一笔的流水号。 | 提示 | [BankFilePages.tsx:374](../../apps/web/src/pages/platform/BankFilePages.tsx#L374) |
| `BankFilePages.20a589a5` | 写死 | 交给银行用原始下载的 CSV，不要用 Excel 打开后另存（账号开头的 0 会丢）；要查看请下载 Excel 文件。 | 提示 | [BankFilePages.tsx:375](../../apps/web/src/pages/platform/BankFilePages.tsx#L375) |
| `BankFilePages.26511f73` | 写死 | 手续费 | 名称 | [BankFilePages.tsx:381](../../apps/web/src/pages/platform/BankFilePages.tsx#L381) |
| `BankFilePages.5b68d3f2` | 写死 | 模板 | 名称 | [BankFilePages.tsx:382](../../apps/web/src/pages/platform/BankFilePages.tsx#L382) |
| `BankFilePages.7f22951c` | 写死 | 生成时间 | 名称 | [BankFilePages.tsx:383](../../apps/web/src/pages/platform/BankFilePages.tsx#L383) |
| `BankFilePages.224d6e8e` | 写死 | {download\_count} 次 | 正文 | [BankFilePages.tsx:386](../../apps/web/src/pages/platform/BankFilePages.tsx#L386) |
| `BankFilePages.8a07bab6` | 写死 | 还没下载 | 正文 | [BankFilePages.tsx:386](../../apps/web/src/pages/platform/BankFilePages.tsx#L386) |
| `BankFilePages.477c7469` | 写死 | CSV 指纹（SHA-256） | 名称 | [BankFilePages.tsx:387](../../apps/web/src/pages/platform/BankFilePages.tsx#L387) |
| `BankFilePages.599a89cc` | 写死 | Excel 指纹（SHA-256） | 名称 | [BankFilePages.tsx:388](../../apps/web/src/pages/platform/BankFilePages.tsx#L388) |
| `BankFilePages.d5d8c6dd` | 写死 | 作废原因 | 名称 | [BankFilePages.tsx:389](../../apps/web/src/pages/platform/BankFilePages.tsx#L389)、466 行 |
| `BankFilePages.c9d1cb22` | 写死 | 下载中… | 文字 | [BankFilePages.tsx:395](../../apps/web/src/pages/platform/BankFilePages.tsx#L395)、398 行 |
| `BankFilePages.7df99a4c` | 写死 | 下载 CSV | 按钮 | [BankFilePages.tsx:397](../../apps/web/src/pages/platform/BankFilePages.tsx#L397) |
| `BankFilePages.3c5bc686` | 写死 | 下载 Excel | 按钮 | [BankFilePages.tsx:400](../../apps/web/src/pages/platform/BankFilePages.tsx#L400) |
| `BankFilePages.c180c989` | 写死 | 回填流水号 | 按钮 | [BankFilePages.tsx:403](../../apps/web/src/pages/platform/BankFilePages.tsx#L403) |
| `BankFilePages.439a6488` | 写死 | 作废 | 按钮 | [BankFilePages.tsx:407](../../apps/web/src/pages/platform/BankFilePages.tsx#L407)、470、473 行 |
| `BankFilePages.abd68584` | 写死 | 生成时排除的账单 | 标题 | [BankFilePages.tsx:416](../../apps/web/src/pages/platform/BankFilePages.tsx#L416) |
| `BankFilePages.cb877db4` | 写死 | 每一笔 | 名称 | [BankFilePages.tsx:430](../../apps/web/src/pages/platform/BankFilePages.tsx#L430) |
| `BankFilePages.f8b6e7d6` | 写死 | 收款账户换过，还要下载吗？ | 标题 | [BankFilePages.tsx:435](../../apps/web/src/pages/platform/BankFilePages.tsx#L435) |
| `BankFilePages.7198719d` | 写死 | 确认下载 | 按钮 | [BankFilePages.tsx:444](../../apps/web/src/pages/platform/BankFilePages.tsx#L444) |
| `BankFilePages.8764fbb5` | 写死 | 文件生成后，供应商换过收款账户，文件里还是批准时的旧账号。请先向供应商确认旧账号仍然可用；不确定就作废这个文件、重新生成。这次下载会记入审计。 | 正文 | [BankFilePages.tsx:448](../../apps/web/src/pages/platform/BankFilePages.tsx#L448) |
| `BankFilePages.54ed5280` | 写死 | 已回填流水号 | 提示 | [BankFilePages.tsx:458](../../apps/web/src/pages/platform/BankFilePages.tsx#L458) |
| `BankFilePages.6920d167` | 写死 | 作废这个转账文件？ | 标题 | [BankFilePages.tsx:464](../../apps/web/src/pages/platform/BankFilePages.tsx#L464) |
| `BankFilePages.d3ddd352` | 写死 | 未付款的账单释放，可以进新文件；已回填的不退回。文件如果已经交给银行，请先到银行撤销，否则重新生成会重复付款。 | 说明 | [BankFilePages.tsx:465](../../apps/web/src/pages/platform/BankFilePages.tsx#L465) |
| `BankFilePages.0edd64f1` | 写死 | 请写作废原因 | 文字 | [BankFilePages.tsx:468](../../apps/web/src/pages/platform/BankFilePages.tsx#L468) |
| `BankFilePages.fe248260` | 写死 | 作废中… | 文字 | [BankFilePages.tsx:471](../../apps/web/src/pages/platform/BankFilePages.tsx#L471) |
| `BankFilePages.3061c2c5` | 写死 | 收款账户 · NOZOMI {name} | 浏览器标题 | [BankFilePages.tsx:490](../../apps/web/src/pages/platform/BankFilePages.tsx#L490) |
| `BankFilePages.34439338` | 写死 | 收款账户 | 名称 | [BankFilePages.tsx:501](../../apps/web/src/pages/platform/BankFilePages.tsx#L501)、502、547 行 |
| `BankFilePages.896fdd14` | 写死 | 银行 | 文字 | [BankFilePages.tsx:511](../../apps/web/src/pages/platform/BankFilePages.tsx#L511) |
| `BankFilePages.4c6dd3fe` | 写死 | 提交时间 | 文字 | [BankFilePages.tsx:514](../../apps/web/src/pages/platform/BankFilePages.tsx#L514) |
| `BankFilePages.780f040b` | 写死 | 操作 | 文字 | [BankFilePages.tsx:519](../../apps/web/src/pages/platform/BankFilePages.tsx#L519) |
| `BankFilePages.796b4be2` | 写死 | 等复核 | 链接 | [BankFilePages.tsx:522](../../apps/web/src/pages/platform/BankFilePages.tsx#L522) |
| `BankFilePages.9e4a398f` | 写死 | 发起复核：{name} {currency} | 按钮 | [BankFilePages.tsx:525](../../apps/web/src/pages/platform/BankFilePages.tsx#L525) |
| `BankFilePages.b1834a86` | 写死 | 驳回：{name} {currency} | 按钮 | [BankFilePages.tsx:526](../../apps/web/src/pages/platform/BankFilePages.tsx#L526) |
| `BankFilePages.ed9ebf5e` | 写死 | 供应商的管理员提交账户。请按它的结算账户证明核对户名、银行、SWIFT 和账号末 4 位，再发起复核；另一位同事批准后生效。这里永远看不到完整账号。 | 正文 | [BankFilePages.tsx:535](../../apps/web/src/pages/platform/BankFilePages.tsx#L535) |
| `BankFilePages.7a2acee7` | 写死 | 全部 | 名称 | [BankFilePages.tsx:541](../../apps/web/src/pages/platform/BankFilePages.tsx#L541) |
| `BankFilePages.85515286` | 写死 | 记录太多，这里只显示最新的 200 条，可以按状态筛选。 | 提示 | [BankFilePages.tsx:545](../../apps/web/src/pages/platform/BankFilePages.tsx#L545) |
| `BankFilePages.ac8449c9` | 写死 | 供应商在自己的后台「账单 → 收款账户」提交后会出现在这里。 | 说明 | [BankFilePages.tsx:547](../../apps/web/src/pages/platform/BankFilePages.tsx#L547) |
| `BankFilePages.c2aeb17e` | 写死 | 没有符合的账户 | 标题 | [BankFilePages.tsx:547](../../apps/web/src/pages/platform/BankFilePages.tsx#L547) |
| `BankFilePages.1f328e0b` | 写死 | 发起复核：{name} 的 {currency} 账户 | 标题 | [BankFilePages.tsx:551](../../apps/web/src/pages/platform/BankFilePages.tsx#L551) |
| `BankFilePages.e3d921de` | 写死 | {beneficiary\_name} · {bank\_name} · {swift\_bic} · {account\_masked}。另一位同事批准后生效。 | 说明 | [BankFilePages.tsx:552](../../apps/web/src/pages/platform/BankFilePages.tsx#L552) |
| `BankFilePages.4fdff94f` | 写死 | 发起复核 | 按钮 | [BankFilePages.tsx:558](../../apps/web/src/pages/platform/BankFilePages.tsx#L558) |
| `BankFilePages.69d8ebf0` | 写死 | 已提交复核 | 提示 | [BankFilePages.tsx:563](../../apps/web/src/pages/platform/BankFilePages.tsx#L563) |
| `BankFilePages.80e0b6d6` | 写死 | 驳回 {name} 的 {currency} 账户？ | 标题 | [BankFilePages.tsx:570](../../apps/web/src/pages/platform/BankFilePages.tsx#L570) |
| `BankFilePages.4ace03f1` | 写死 | 供应商看得到原因，可以重新提交。 | 说明 | [BankFilePages.tsx:571](../../apps/web/src/pages/platform/BankFilePages.tsx#L571) |
| `BankFilePages.f569c3ca` | 写死 | 驳回原因 | 名称 | [BankFilePages.tsx:572](../../apps/web/src/pages/platform/BankFilePages.tsx#L572) |
| `BankFilePages.49b326db` | 写死 | 请写驳回原因 | 文字 | [BankFilePages.tsx:574](../../apps/web/src/pages/platform/BankFilePages.tsx#L574) |
| `BankFilePages.36c72bac` | 写死 | 驳回 | 按钮 | [BankFilePages.tsx:576](../../apps/web/src/pages/platform/BankFilePages.tsx#L576)、579 行 |
| `BankFilePages.199532ae` | 写死 | 驳回中… | 文字 | [BankFilePages.tsx:577](../../apps/web/src/pages/platform/BankFilePages.tsx#L577) |
| `BankFilePages.53926ac8` | 写死 | 已驳回 | 提示 | [BankFilePages.tsx:584](../../apps/web/src/pages/platform/BankFilePages.tsx#L584) |

## 主数据列表（城市、地点、车型组、附加服务）

文件：`apps/web/src/pages/master/MasterList.tsx`、`apps/web/src/pages/master/lists.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `MasterList.fbd42be1` | 写死 | 全部 | 名称 | [MasterList.tsx:65](../../apps/web/src/pages/master/MasterList.tsx#L65) |
| `MasterList.2ccf63a5` | 写死 | 启用 | 名称 | [MasterList.tsx:66](../../apps/web/src/pages/master/MasterList.tsx#L66)、197 行 |
| `MasterList.199736f9` | 写死 | 已停用 | 名称 | [MasterList.tsx:67](../../apps/web/src/pages/master/MasterList.tsx#L67) |
| `MasterList.c4ac75f9` | 写死 | 状态 | 名称 | [MasterList.tsx:72](../../apps/web/src/pages/master/MasterList.tsx#L72)、167 行 |
| `MasterList.70dcf0f2` | 写死 | 编码 | 文字 | [MasterList.tsx:164](../../apps/web/src/pages/master/MasterList.tsx#L164) |
| `MasterList.a71f638c` | 写死 | 名称 | 文字 | [MasterList.tsx:165](../../apps/web/src/pages/master/MasterList.tsx#L165) |
| `MasterList.0c0b698c` | 写死 | 操作 | 文字 | [MasterList.tsx:172](../../apps/web/src/pages/master/MasterList.tsx#L172) |
| `MasterList.a7593fd9` | 写死 | 编辑 {label} | 读屏说明 | [MasterList.tsx:177](../../apps/web/src/pages/master/MasterList.tsx#L177) |
| `MasterList.130fffe4` | 写死 | 编辑 | 按钮 | [MasterList.tsx:179](../../apps/web/src/pages/master/MasterList.tsx#L179) |
| `MasterList.3c35672f` | 写死 | 停用 {label} | 读屏说明 | [MasterList.tsx:190](../../apps/web/src/pages/master/MasterList.tsx#L190) |
| `MasterList.524548d6` | 写死 | 停用 | 按钮 | [MasterList.tsx:192](../../apps/web/src/pages/master/MasterList.tsx#L192) |
| `MasterList.0fd347b2` | 写死 | 启用中… | 文字 | [MasterList.tsx:195](../../apps/web/src/pages/master/MasterList.tsx#L195) |
| `MasterList.ecee0d20` | 写死 | 启用 {label} | 读屏说明 | [MasterList.tsx:195](../../apps/web/src/pages/master/MasterList.tsx#L195) |
| `MasterList.127605ed` | 写死 | 新增{objectName} | 按钮 | [MasterList.tsx:209](../../apps/web/src/pages/master/MasterList.tsx#L209) |
| `MasterList.7da8b9ab` | 写死 | 没有符合条件的{objectName} | 标题 | [MasterList.tsx:215](../../apps/web/src/pages/master/MasterList.tsx#L215) |
| `MasterList.c09f8dd7` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [MasterList.tsx:216](../../apps/web/src/pages/master/MasterList.tsx#L216) |
| `MasterList.1d51a768` | 写死 | 清空筛选 | 按钮 | [MasterList.tsx:220](../../apps/web/src/pages/master/MasterList.tsx#L220) |
| `MasterList.58f1e614` | 写死 | 主数据 | 名称 | [MasterList.tsx:228](../../apps/web/src/pages/master/MasterList.tsx#L228) |
| `MasterList.cb4498d6` | 写死 | 按编码或名称搜索 | 名称 | [MasterList.tsx:231](../../apps/web/src/pages/master/MasterList.tsx#L231) |
| `MasterList.0fea67fb` | 写死 | {title}列表 | 名称 | [MasterList.tsx:236](../../apps/web/src/pages/master/MasterList.tsx#L236) |
| `lists.86d5ab53` | 写死 | 国家 | 名称 | [lists.tsx:44](../../apps/web/src/pages/master/lists.tsx#L44)、58、164、181 行 |
| `lists.e9562345` | 写死 | 全部 | 名称 | [lists.tsx:44](../../apps/web/src/pages/master/lists.tsx#L44)、123、129 行 |
| `lists.4c471a33` | 写死 | 城市 | 标题 | [lists.tsx:53](../../apps/web/src/pages/master/lists.tsx#L53)、54 行 |
| `lists.2c7febf3` | 写死 | 这个城市 | 文字 | [lists.tsx:55](../../apps/web/src/pages/master/lists.tsx#L55) |
| `lists.d66e5e15` | 写死 | 时区 | 文字 | [lists.tsx:59](../../apps/web/src/pages/master/lists.tsx#L59) |
| `lists.7795bdda` | 写死 | 还没有城市 | 标题 | [lists.tsx:64](../../apps/web/src/pages/master/lists.tsx#L64) |
| `lists.8d87cfdd` | 写死 | 先新增城市，才能新增地点、给导入的机场指定城市。 | 说明 | [lists.tsx:64](../../apps/web/src/pages/master/lists.tsx#L64) |
| `lists.c4092d1d` | 写死 | 这个城市下还有 {…} 个启用中的地点，请先停用它们，再回来停用城市。 | 文字 | [lists.tsx:67](../../apps/web/src/pages/master/lists.tsx#L67) |
| `lists.2bd48b07` | 写死 | 查看这些地点 | 名称 | [lists.tsx:68](../../apps/web/src/pages/master/lists.tsx#L68) |
| `lists.tab.airport.empty.description` | 已走 key | 机场由技术人员用导入命令从 OurAirports 批量导入；数据源里没有的，可以在这里手工新增。 | 说明 | [lists.tsx:75](../../apps/web/src/pages/master/lists.tsx#L75) |
| `lists.tab.airport.empty.title` | 已走 key | 还没有机场 | 标题 | [lists.tsx:75](../../apps/web/src/pages/master/lists.tsx#L75) |
| `lists.tab.station.empty.description` | 已走 key | 新增车站后，可以在车站的编辑页里给它添加出口。 | 说明 | [lists.tsx:76](../../apps/web/src/pages/master/lists.tsx#L76) |
| `lists.tab.station.empty.title` | 已走 key | 还没有车站 | 标题 | [lists.tsx:76](../../apps/web/src/pages/master/lists.tsx#L76) |
| `lists.tab.poi.empty.description` | 已走 key | 地标是酒店、景点、港口、商场这类常用的上下车地点。 | 说明 | [lists.tsx:77](../../apps/web/src/pages/master/lists.tsx#L77) |
| `lists.tab.poi.empty.title` | 已走 key | 还没有地标 | 标题 | [lists.tsx:77](../../apps/web/src/pages/master/lists.tsx#L77) |
| `lists.60153e39` | 写死 | 地点类型 | 读屏说明 | [lists.tsx:101](../../apps/web/src/pages/master/lists.tsx#L101) |
| `lists.d7b71a2d` | 写死 | 所属城市 | 名称 | [lists.tsx:123](../../apps/web/src/pages/master/lists.tsx#L123)、163、180、185 行 |
| `lists.314a5f81` | 写死 | 等级 | 名称 | [lists.tsx:129](../../apps/web/src/pages/master/lists.tsx#L129)、258 行 |
| `lists.8df15315` | 写死 | 待指定城市 | 名称 | [lists.tsx:133](../../apps/web/src/pages/master/lists.tsx#L133)、159 行 |
| `lists.a079e1e4` | 写死 | 城市已停用 | 名称 | [lists.tsx:139](../../apps/web/src/pages/master/lists.tsx#L139) |
| `lists.db772fdb` | 写死 | 国际 / 国内 | 文字 | [lists.tsx:165](../../apps/web/src/pages/master/lists.tsx#L165) |
| `lists.a1fcb2a6` | 写死 | 来源 | 文字 | [lists.tsx:168](../../apps/web/src/pages/master/lists.tsx#L168) |
| `lists.ab1263ab` | 写死 | 手工录入 | 正文 | [lists.tsx:171](../../apps/web/src/pages/master/lists.tsx#L171) |
| `lists.b7fcbf67` | 写死 | 已改过 | 正文 | [lists.tsx:172](../../apps/web/src/pages/master/lists.tsx#L172) |
| `lists.bdd42b0b` | 写死 | 车站类型 | 文字 | [lists.tsx:179](../../apps/web/src/pages/master/lists.tsx#L179) |
| `lists.90f25504` | 写死 | 地标类型 | 文字 | [lists.tsx:184](../../apps/web/src/pages/master/lists.tsx#L184) |
| `lists.2329e309` | 写死 | 地址 | 文字 | [lists.tsx:186](../../apps/web/src/pages/master/lists.tsx#L186) |
| `lists.2de34cac` | 写死 | 包车覆盖检查 | 文字 | [lists.tsx:187](../../apps/web/src/pages/master/lists.tsx#L187) |
| `lists.c7dabe70` | 写死 | 已放进 | 正文 | [lists.tsx:187](../../apps/web/src/pages/master/lists.tsx#L187) |
| `lists.2d20a511` | 写死 | 地点 | 标题 | [lists.tsx:192](../../apps/web/src/pages/master/lists.tsx#L192) |
| `lists.fdec0461` | 写死 | 这个{objectName} | 文字 | [lists.tsx:194](../../apps/web/src/pages/master/lists.tsx#L194) |
| `lists.dc50647d` | 写死 | 有 {…} 个导入的机场还没有指定城市。 | 正文 | [lists.tsx:212](../../apps/web/src/pages/master/lists.tsx#L212) |
| `lists.ff31d85b` | 写死 | 指定城市后才能启用，供应商才能选到它们。 | 正文 | [lists.tsx:213](../../apps/web/src/pages/master/lists.tsx#L213) |
| `lists.a7545a49` | 写死 | 去处理 | 按钮 | [lists.tsx:218](../../apps/web/src/pages/master/lists.tsx#L218) |
| `lists.9cd99ca6` | 写死 | 只看这些 | 按钮 | [lists.tsx:222](../../apps/web/src/pages/master/lists.tsx#L222) |
| `lists.c120d1df` | 写死 | 正在查看城市「{text}」下启用中的地点。车站、地标请切换页签查看。 | 提示 | [lists.tsx:228](../../apps/web/src/pages/master/lists.tsx#L228) |
| `lists.3617324f` | 写死 | 指定城市 | 名称 | [lists.tsx:232](../../apps/web/src/pages/master/lists.tsx#L232) |
| `lists.41dcbf57` | 写死 | 航站楼 | 文字 | [lists.tsx:234](../../apps/web/src/pages/master/lists.tsx#L234) |
| `lists.6d9a2fd9` | 写死 | 出口 | 文字 | [lists.tsx:234](../../apps/web/src/pages/master/lists.tsx#L234) |
| `lists.5ed21dd9` | 写死 | 去看{child} | 名称 | [lists.tsx:235](../../apps/web/src/pages/master/lists.tsx#L235) |
| `lists.8fbb08a7` | 写死 | 这个{…}下还有 {…} 个启用中的{child}，请先停用它们。 | 文字 | [lists.tsx:235](../../apps/web/src/pages/master/lists.tsx#L235) |
| `lists.85ffd84b` | 写死 | {label}还没有指定所属城市，不能启用。 | 文字 | [lists.tsx:239](../../apps/web/src/pages/master/lists.tsx#L239) |
| `lists.b8ba7bee` | 写死 | 去指定城市 | 名称 | [lists.tsx:239](../../apps/web/src/pages/master/lists.tsx#L239) |
| `lists.b412e21b` | 写死 | 去看这个城市 | 名称 | [lists.tsx:240](../../apps/web/src/pages/master/lists.tsx#L240) |
| `lists.eff6545f` | 写死 | {label}所属的城市「{text}」已停用，不能启用。请先启用这个城市。 | 文字 | [lists.tsx:240](../../apps/web/src/pages/master/lists.tsx#L240) |
| `lists.12ed0db2` | 写死 | 去看上级 | 名称 | [lists.tsx:241](../../apps/web/src/pages/master/lists.tsx#L241) |
| `lists.e37f90e3` | 写死 | {label}的上级「{code} {text}」已停用，不能启用。请先启用上级。 | 文字 | [lists.tsx:241](../../apps/web/src/pages/master/lists.tsx#L241) |
| `lists.d5daeef7` | 写死 | 车型组 | 标题 | [lists.tsx:253](../../apps/web/src/pages/master/lists.tsx#L253)、254 行 |
| `lists.4a2aa8ee` | 写死 | 这个车型组 | 文字 | [lists.tsx:255](../../apps/web/src/pages/master/lists.tsx#L255) |
| `lists.217c244f` | 写死 | 座位数 | 文字 | [lists.tsx:259](../../apps/web/src/pages/master/lists.tsx#L259) |
| `lists.ee33fdef` | 写死 | 动力 | 文字 | [lists.tsx:260](../../apps/web/src/pages/master/lists.tsx#L260) |
| `lists.54604d83` | 写死 | 人数 / 行李数 | 文字 | [lists.tsx:263](../../apps/web/src/pages/master/lists.tsx#L263) |
| `lists.55e5d11a` | 写死 | {passengers} 人 {luggage} 件 | 正文 | [lists.tsx:267](../../apps/web/src/pages/master/lists.tsx#L267) |
| `lists.4a3991dd` | 写死 | 同级车型 | 文字 | [lists.tsx:273](../../apps/web/src/pages/master/lists.tsx#L273) |
| `lists.62832f2d` | 写死 | 还没有车型组 | 标题 | [lists.tsx:278](../../apps/web/src/pages/master/lists.tsx#L278) |
| `lists.c1f4821d` | 写死 | 报价、库存和订单都按车型组来，不按具体的车。 | 说明 | [lists.tsx:278](../../apps/web/src/pages/master/lists.tsx#L278) |
| `lists.1166db45` | 写死 | 附加服务 | 标题 | [lists.tsx:286](../../apps/web/src/pages/master/lists.tsx#L286)、287 行 |
| `lists.653c7bf8` | 写死 | 这项附加服务 | 文字 | [lists.tsx:288](../../apps/web/src/pages/master/lists.tsx#L288) |
| `lists.a82230c5` | 写死 | 适用品类 | 文字 | [lists.tsx:293](../../apps/web/src/pages/master/lists.tsx#L293) |
| `lists.a68b4b67` | 写死 | 计费方式 | 文字 | [lists.tsx:306](../../apps/web/src/pages/master/lists.tsx#L306) |
| `lists.d1bab397` | 写死 | 这里维护附加服务的目录。单价不在这里，由各供应商在自己的商品里设置。 | 说明 | [lists.tsx:308](../../apps/web/src/pages/master/lists.tsx#L308) |
| `lists.e07774cc` | 写死 | 还没有附加服务 | 标题 | [lists.tsx:308](../../apps/web/src/pages/master/lists.tsx#L308) |

## 主数据编辑（共用表单）

文件：`apps/web/src/pages/master/MasterForm.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `MasterForm.3a077f2d` | 写死 | 上级 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.7bc92c3d` | 写死 | 国家 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.8536661b` | 写死 | 编码 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.8dbc87eb` | 写死 | 类型 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.e5c70653` | 写死 | 等级 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.f0bceffd` | 写死 | 座位数 | 文字 | [MasterForm.tsx:94](../../apps/web/src/pages/master/MasterForm.tsx#L94) |
| `MasterForm.3dcd20b4` | 写死 | 已载入最新内容。 | 文字 | [MasterForm.tsx:163](../../apps/web/src/pages/master/MasterForm.tsx#L163) |
| `MasterForm.37f71ec2` | 写死 | 最新内容没有载入成功。 | 标题 | [MasterForm.tsx:182](../../apps/web/src/pages/master/MasterForm.tsx#L182) |
| `MasterForm.d7093fb4` | 写死 | 请检查网络后重试。你在这个页面上写的内容还在。 | 文字 | [MasterForm.tsx:183](../../apps/web/src/pages/master/MasterForm.tsx#L183) |
| `MasterForm.077c181c` | 写死 | 再试一次 | 按钮 | [MasterForm.tsx:187](../../apps/web/src/pages/master/MasterForm.tsx#L187) |
| `MasterForm.d8509f29` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [MasterForm.tsx:209](../../apps/web/src/pages/master/MasterForm.tsx#L209)、316、321 行 |
| `MasterForm.2d11854a` | 写死 | 新增{objectName} | 标题 | [MasterForm.tsx:225](../../apps/web/src/pages/master/MasterForm.tsx#L225) |
| `MasterForm.0568acc9` | 写死 | 主数据 | 名称 | [MasterForm.tsx:234](../../apps/web/src/pages/master/MasterForm.tsx#L234) |
| `MasterForm.c30e23d2` | 写死 | 回到{moduleName}列表 | 按钮 | [MasterForm.tsx:243](../../apps/web/src/pages/master/MasterForm.tsx#L243) |
| `MasterForm.09d165e6` | 写死 | 你没有权限查看这里 | 标题 | [MasterForm.tsx:246](../../apps/web/src/pages/master/MasterForm.tsx#L246)、250 行 |
| `MasterForm.3cac3837` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [MasterForm.tsx:246](../../apps/web/src/pages/master/MasterForm.tsx#L246)、250 行 |
| `MasterForm.35608469` | 写死 | 它可能不存在，或链接有误。 | 说明 | [MasterForm.tsx:248](../../apps/web/src/pages/master/MasterForm.tsx#L248)、249 行 |
| `MasterForm.3ec78729` | 写死 | 找不到这个{objectName} | 标题 | [MasterForm.tsx:249](../../apps/web/src/pages/master/MasterForm.tsx#L249) |
| `MasterForm.dcd81f5b` | 写死 | 加载失败 | 标题 | [MasterForm.tsx:255](../../apps/web/src/pages/master/MasterForm.tsx#L255) |
| `MasterForm.7721a8c3` | 写死 | 请检查网络后重试。 | 说明 | [MasterForm.tsx:256](../../apps/web/src/pages/master/MasterForm.tsx#L256) |
| `MasterForm.5e122657` | 写死 | 重试 | 按钮 | [MasterForm.tsx:260](../../apps/web/src/pages/master/MasterForm.tsx#L260) |
| `MasterForm.bffc8b35` | 写死 | 你填写的内容还在。 | 文字 | [MasterForm.tsx:302](../../apps/web/src/pages/master/MasterForm.tsx#L302) |
| `MasterForm.25560525` | 写死 | 网络连接失败，请检查网络后重试。{preserved} | 文字 | [MasterForm.tsx:303](../../apps/web/src/pages/master/MasterForm.tsx#L303) |
| `MasterForm.1d6905ca` | 写死 | 系统暂时无法保存，请稍后再试。{preserved} | 文字 | [MasterForm.tsx:304](../../apps/web/src/pages/master/MasterForm.tsx#L304)、364 行 |
| `MasterForm.9b131395` | 写死 | 这一项不符合要求，请检查后重试 | 提示 | [MasterForm.tsx:312](../../apps/web/src/pages/master/MasterForm.tsx#L312) |
| `MasterForm.7d10c9e7` | 写死 | 这个编码已经被使用，请换一个 | 文字 | [MasterForm.tsx:323](../../apps/web/src/pages/master/MasterForm.tsx#L323) |
| `MasterForm.a72aa19d` | 写死 | 这条记录刚被别人修改过，你的修改还没有保存。 | 标题 | [MasterForm.tsx:332](../../apps/web/src/pages/master/MasterForm.tsx#L332) |
| `MasterForm.6a0e94c6` | 写死 | 请先载入最新内容，再重新修改。载入后，你在这个页面上还没保存的修改会丢失。 | 文字 | [MasterForm.tsx:333](../../apps/web/src/pages/master/MasterForm.tsx#L333) |
| `MasterForm.6c13d0ed` | 写死 | 载入最新内容 | 按钮 | [MasterForm.tsx:337](../../apps/web/src/pages/master/MasterForm.tsx#L337) |
| `MasterForm.2e3f3abf` | 写死 | 有些内容 | 文字 | [MasterForm.tsx:343](../../apps/web/src/pages/master/MasterForm.tsx#L343) |
| `MasterForm.4988c509` | 写死 | {…}创建后不能修改。请刷新页面后重试。 | 文字 | [MasterForm.tsx:343](../../apps/web/src/pages/master/MasterForm.tsx#L343) |
| `MasterForm.6afac70d` | 写死 | 同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。 | 文字 | [MasterForm.tsx:346](../../apps/web/src/pages/master/MasterForm.tsx#L346) |
| `MasterForm.969e555a` | 写死 | 相关的数据已停用，这次没有保存成功。 | 文字 | [MasterForm.tsx:348](../../apps/web/src/pages/master/MasterForm.tsx#L348) |
| `MasterForm.60f87a13` | 写死 | 没有修改权限 | 文字 | [MasterForm.tsx:357](../../apps/web/src/pages/master/MasterForm.tsx#L357) |
| `MasterForm.c96a5c5f` | 写死 | 这条记录已经不存在 | 文字 | [MasterForm.tsx:361](../../apps/web/src/pages/master/MasterForm.tsx#L361) |
| `MasterForm.09c19136` | 写死 | 找不到这条记录，它可能已经不存在。请回到列表重新查找。 | 文字 | [MasterForm.tsx:362](../../apps/web/src/pages/master/MasterForm.tsx#L362) |
| `MasterForm.b4a0283c` | 写死 | 已保存「{…}」 | 提示 | [MasterForm.tsx:386](../../apps/web/src/pages/master/MasterForm.tsx#L386) |
| `MasterForm.da740ba2` | 写死 | 已新增{objectName}「{…}」 | 提示 | [MasterForm.tsx:399](../../apps/web/src/pages/master/MasterForm.tsx#L399) |
| `MasterForm.26754f2a` | 写死 | 最近修改 {…} | 正文 | [MasterForm.tsx:426](../../apps/web/src/pages/master/MasterForm.tsx#L426) |
| `MasterForm.4119eb67` | 写死 | 停用 | 按钮 | [MasterForm.tsx:435](../../apps/web/src/pages/master/MasterForm.tsx#L435) |
| `MasterForm.1dadaf2d` | 写死 | 启用中… | 文字 | [MasterForm.tsx:437](../../apps/web/src/pages/master/MasterForm.tsx#L437) |
| `MasterForm.3c1b1c47` | 写死 | 启用 | 按钮 | [MasterForm.tsx:439](../../apps/web/src/pages/master/MasterForm.tsx#L439) |
| `MasterForm.27149033` | 写死 | 请先载入最新内容 | 说明 | [MasterForm.tsx:446](../../apps/web/src/pages/master/MasterForm.tsx#L446) |
| `MasterForm.72f63ff7` | 写死 | 你可以查看主数据，但不能修改。需要修改的话，请联系管理员开通。 | 提示 | [MasterForm.tsx:452](../../apps/web/src/pages/master/MasterForm.tsx#L452) |
| `MasterForm.75fea64d` | 写死 | 有 {size} 处需要修改 | 正文 | [MasterForm.tsx:466](../../apps/web/src/pages/master/MasterForm.tsx#L466) |
| `MasterForm.512a9030` | 写死 | 保存后直接是启用状态，供应商马上可以选到。 | 正文 | [MasterForm.tsx:488](../../apps/web/src/pages/master/MasterForm.tsx#L488) |
| `MasterForm.62ff5e6f` | 写死 | 取消 | 按钮 | [MasterForm.tsx:492](../../apps/web/src/pages/master/MasterForm.tsx#L492) |
| `MasterForm.3548882b` | 写死 | 保存中… | 文字 | [MasterForm.tsx:494](../../apps/web/src/pages/master/MasterForm.tsx#L494)、498 行 |
| `MasterForm.ce50fe7c` | 写死 | 保存并继续新增 | 按钮 | [MasterForm.tsx:496](../../apps/web/src/pages/master/MasterForm.tsx#L496) |
| `MasterForm.36c6265d` | 写死 | 保存 | 按钮 | [MasterForm.tsx:500](../../apps/web/src/pages/master/MasterForm.tsx#L500) |
| `MasterForm.107192c7` | 写死 | 回到列表 | 按钮 | [MasterForm.tsx:507](../../apps/web/src/pages/master/MasterForm.tsx#L507) |
| `MasterForm.3a97d3e8` | 写死 | 有未保存的修改，确定离开吗？ | 标题 | [MasterForm.tsx:514](../../apps/web/src/pages/master/MasterForm.tsx#L514) |
| `MasterForm.491f8392` | 写死 | 继续编辑 | 按钮 | [MasterForm.tsx:520](../../apps/web/src/pages/master/MasterForm.tsx#L520) |
| `MasterForm.ccceee8e` | 写死 | 离开 | 按钮 | [MasterForm.tsx:532](../../apps/web/src/pages/master/MasterForm.tsx#L532) |
| `MasterForm.414aff54` | 写死 | 离开后，这个页面上还没保存的内容会丢失。 | 正文 | [MasterForm.tsx:536](../../apps/web/src/pages/master/MasterForm.tsx#L536) |

## 主数据 · 城市

文件：`apps/web/src/pages/master/CityForm.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CityForm.f6a9dc18` | 写死 | 名称 | 文字 | [CityForm.tsx:37](../../apps/web/src/pages/master/CityForm.tsx#L37)、56、128 行 |
| `CityForm.69db1ed5` | 写死 | 请选择时区 | 文字 | [CityForm.tsx:38](../../apps/web/src/pages/master/CityForm.tsx#L38) |
| `CityForm.500787db` | 写死 | 请选择国家 | 文字 | [CityForm.tsx:40](../../apps/web/src/pages/master/CityForm.tsx#L40) |
| `CityForm.249a46f9` | 写死 | 请输入编码 | 文字 | [CityForm.tsx:41](../../apps/web/src/pages/master/CityForm.tsx#L41) |
| `CityForm.72c68f10` | 写死 | 编码里的国家码 {…} 和所选国家 {…} 不一致 | 文字 | [CityForm.tsx:46](../../apps/web/src/pages/master/CityForm.tsx#L46) |
| `CityForm.863bca04` | 写死 | 编码格式应为 CTY-国家码-序号，序号是 2 到 8 位大写字母或数字，例如 CTY-JP-TYO | 文字 | [CityForm.tsx:47](../../apps/web/src/pages/master/CityForm.tsx#L47) |
| `CityForm.3b17c346` | 写死 | 国家 | 文字 | [CityForm.tsx:56](../../apps/web/src/pages/master/CityForm.tsx#L56)、95、100 行 |
| `CityForm.4d352268` | 写死 | 时区 | 文字 | [CityForm.tsx:56](../../apps/web/src/pages/master/CityForm.tsx#L56)、134 行 |
| `CityForm.d9e8b180` | 写死 | 中心坐标 | 文字 | [CityForm.tsx:56](../../apps/web/src/pages/master/CityForm.tsx#L56)、148 行 |
| `CityForm.fd775b33` | 写死 | 编码 | 文字 | [CityForm.tsx:56](../../apps/web/src/pages/master/CityForm.tsx#L56) |
| `CityForm.f6cec112` | 写死 | 基本信息 | 标题 | [CityForm.tsx:92](../../apps/web/src/pages/master/CityForm.tsx#L92) |
| `CityForm.42a9d4d7` | 写死 | 创建后不能修改。 | 说明 | [CityForm.tsx:95](../../apps/web/src/pages/master/CityForm.tsx#L95) |
| `CityForm.4ee4f3ea` | 写死 | 输入国名或两位代码查找 | 输入框占位 | [CityForm.tsx:104](../../apps/web/src/pages/master/CityForm.tsx#L104) |
| `CityForm.c228e7b8` | 写死 | CTY-JP-TYO | 输入框占位 | [CityForm.tsx:120](../../apps/web/src/pages/master/CityForm.tsx#L120) |
| `CityForm.a9621887` | 写死 | 格式：CTY-国家码-序号。序号是 2 到 8 位大写字母或数字，建议用城市的通用缩写。创建后不能修改。 | 说明 | [CityForm.tsx:121](../../apps/web/src/pages/master/CityForm.tsx#L121) |
| `CityForm.2cbacf87` | 写死 | 至少填一种语言。 | 说明 | [CityForm.tsx:128](../../apps/web/src/pages/master/CityForm.tsx#L128) |
| `CityForm.0398dc74` | 写死 | 位置与时区 | 标题 | [CityForm.tsx:131](../../apps/web/src/pages/master/CityForm.tsx#L131) |
| `CityForm.41e06b7a` | 写死 | 输入城市名或偏移查找，例如 tokyo、+9 | 输入框占位 | [CityForm.tsx:139](../../apps/web/src/pages/master/CityForm.tsx#L139) |
| `CityForm.54bf5a05` | 写死 | 这个城市的服务时间、夜间时段、派车截止时间都按这个时区算。 | 说明 | [CityForm.tsx:140](../../apps/web/src/pages/master/CityForm.tsx#L140) |
| `CityForm.f62c9d22` | 写死 | WGS84 坐标，保留 6 位小数。可以从地图软件里复制「纬度, 经度」直接粘贴。 | 说明 | [CityForm.tsx:153](../../apps/web/src/pages/master/CityForm.tsx#L153) |
| `CityForm.996be92d` | 写死 | 边界 | 名称 | [CityForm.tsx:161](../../apps/web/src/pages/master/CityForm.tsx#L161) |
| `CityForm.a09d9b52` | 写死 | 城市边界暂时不能在这里编辑。 | 说明 | [CityForm.tsx:161](../../apps/web/src/pages/master/CityForm.tsx#L161) |
| `CityForm.4e44b829` | 写死 | 未设置 | 正文 | [CityForm.tsx:162](../../apps/web/src/pages/master/CityForm.tsx#L162) |
| `CityForm.686eb405` | 写死 | 已设置 | 正文 | [CityForm.tsx:162](../../apps/web/src/pages/master/CityForm.tsx#L162) |
| `CityForm.8539ee02` | 写死 | 城市 | 名称 | [CityForm.tsx:173](../../apps/web/src/pages/master/CityForm.tsx#L173)、174、194 行 |
| `CityForm.b595effd` | 写死 | 这个城市 | 文字 | [CityForm.tsx:195](../../apps/web/src/pages/master/CityForm.tsx#L195) |
| `CityForm.86ee32d7` | 写死 | 这个城市下还有 {count} 个启用中的地点，请先停用它们，再回来停用城市。 | 文字 | [CityForm.tsx:196](../../apps/web/src/pages/master/CityForm.tsx#L196) |

## 主数据 · 地点

文件：`apps/web/src/pages/master/PlaceForm.tsx`、`apps/web/src/pages/master/place-texts.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PlaceForm.04e3aecb` | 写死 | 不填 | 名称 | [PlaceForm.tsx:107](../../apps/web/src/pages/master/PlaceForm.tsx#L107) |
| `PlaceForm.94df733e` | 写死 | 航站楼 | 名称 | [PlaceForm.tsx:116](../../apps/web/src/pages/master/PlaceForm.tsx#L116) |
| `PlaceForm.bf44629a` | 写死 | 出口 | 名称 | [PlaceForm.tsx:116](../../apps/web/src/pages/master/PlaceForm.tsx#L116) |
| `PlaceForm.f1dffacb` | 写死 | 名称 | 文字 | [PlaceForm.tsx:132](../../apps/web/src/pages/master/PlaceForm.tsx#L132)、211、358、514 行 |
| `PlaceForm.bd11099c` | 写死 | 请选择所属城市 | 文字 | [PlaceForm.tsx:133](../../apps/web/src/pages/master/PlaceForm.tsx#L133) |
| `PlaceForm.6b5a0a5b` | 写死 | 请选择车站类型 | 文字 | [PlaceForm.tsx:134](../../apps/web/src/pages/master/PlaceForm.tsx#L134) |
| `PlaceForm.338471cb` | 写死 | 请选择地标类型 | 文字 | [PlaceForm.tsx:135](../../apps/web/src/pages/master/PlaceForm.tsx#L135) |
| `PlaceForm.cf2bdb39` | 写死 | 地址最多 {ADDRESS\_MAX\_LENGTH} 个字 | 文字 | [PlaceForm.tsx:136](../../apps/web/src/pages/master/PlaceForm.tsx#L136) |
| `PlaceForm.987ea286` | 写死 | 请输入编码 | 文字 | [PlaceForm.tsx:141](../../apps/web/src/pages/master/PlaceForm.tsx#L141) |
| `PlaceForm.3e956d3d` | 写死 | 机场编码是 IATA 三字码，3 个大写字母，例如 HND | 文字 | [PlaceForm.tsx:146](../../apps/web/src/pages/master/PlaceForm.tsx#L146) |
| `PlaceForm.ef1dc779` | 写死 | 编码里的国家码 {…} 和所属城市的国家 {…} 不一致 | 文字 | [PlaceForm.tsx:149](../../apps/web/src/pages/master/PlaceForm.tsx#L149) |
| `PlaceForm.2ede925f` | 写死 | 编码格式应为 STN-国家码-序号，序号是 1 到 10 位大写字母或数字，例如 STN-JP-TOKYO | 文字 | [PlaceForm.tsx:150](../../apps/web/src/pages/master/PlaceForm.tsx#L150) |
| `PlaceForm.5ae3a6d2` | 写死 | 编码格式应为 POI-序号，序号是 1 到 12 位大写字母或数字，例如 POI-000123 | 文字 | [PlaceForm.tsx:152](../../apps/web/src/pages/master/PlaceForm.tsx#L152) |
| `PlaceForm.36f4f8ce` | 写死 | 上级编码 | 文字 | [PlaceForm.tsx:153](../../apps/web/src/pages/master/PlaceForm.tsx#L153) |
| `PlaceForm.415a9736` | 写死 | 编码格式应为 {…}-后缀，后缀是 1 到 6 位大写字母或数字，例如 {…}-{…} | 文字 | [PlaceForm.tsx:153](../../apps/web/src/pages/master/PlaceForm.tsx#L153) |
| `PlaceForm.b5a06ab7` | 写死 | 这个{name} | 文字 | [PlaceForm.tsx:172](../../apps/web/src/pages/master/PlaceForm.tsx#L172) |
| `PlaceForm.877aadef` | 写死 | 「{code} {text}」的上级「{code} {text}」已停用，不能启用。请先启用上级。 | 文字 | [PlaceForm.tsx:174](../../apps/web/src/pages/master/PlaceForm.tsx#L174) |
| `PlaceForm.4fa9f858` | 写死 | 新增{name} | 按钮 | [PlaceForm.tsx:181](../../apps/web/src/pages/master/PlaceForm.tsx#L181)、184 行 |
| `PlaceForm.701df25a` | 写死 | {…}启用后才能新增{name}。 | 正文 | [PlaceForm.tsx:195](../../apps/web/src/pages/master/PlaceForm.tsx#L195) |
| `PlaceForm.661c1197` | 写死 | {name}列表 | 名称 | [PlaceForm.tsx:202](../../apps/web/src/pages/master/PlaceForm.tsx#L202) |
| `PlaceForm.ebebddbe` | 写死 | 编码 | 文字 | [PlaceForm.tsx:210](../../apps/web/src/pages/master/PlaceForm.tsx#L210)、358 行 |
| `PlaceForm.13ba289b` | 写死 | 国际 / 国内 | 文字 | [PlaceForm.tsx:212](../../apps/web/src/pages/master/PlaceForm.tsx#L212)、358 行 |
| `PlaceForm.3a89ed5b` | 写死 | 坐标 | 文字 | [PlaceForm.tsx:213](../../apps/web/src/pages/master/PlaceForm.tsx#L213)、358、552 行 |
| `PlaceForm.7d9bd7bb` | 写死 | 状态 | 文字 | [PlaceForm.tsx:214](../../apps/web/src/pages/master/PlaceForm.tsx#L214) |
| `PlaceForm.8125f50a` | 写死 | 操作 | 文字 | [PlaceForm.tsx:220](../../apps/web/src/pages/master/PlaceForm.tsx#L220) |
| `PlaceForm.eead828c` | 写死 | 编辑 {code} | 读屏说明 | [PlaceForm.tsx:223](../../apps/web/src/pages/master/PlaceForm.tsx#L223) |
| `PlaceForm.1756ddcf` | 写死 | 编辑 | 按钮 | [PlaceForm.tsx:225](../../apps/web/src/pages/master/PlaceForm.tsx#L225) |
| `PlaceForm.9bf5b909` | 写死 | 停用 {code} | 读屏说明 | [PlaceForm.tsx:227](../../apps/web/src/pages/master/PlaceForm.tsx#L227) |
| `PlaceForm.94d469fe` | 写死 | 停用 | 按钮 | [PlaceForm.tsx:229](../../apps/web/src/pages/master/PlaceForm.tsx#L229) |
| `PlaceForm.47b214b1` | 写死 | 启用 {code} | 读屏说明 | [PlaceForm.tsx:231](../../apps/web/src/pages/master/PlaceForm.tsx#L231) |
| `PlaceForm.ee6fbda2` | 写死 | 启用中… | 文字 | [PlaceForm.tsx:231](../../apps/web/src/pages/master/PlaceForm.tsx#L231) |
| `PlaceForm.1340de7f` | 写死 | 启用 | 按钮 | [PlaceForm.tsx:233](../../apps/web/src/pages/master/PlaceForm.tsx#L233) |
| `PlaceForm.a85e376c` | 写死 | 还没有{name} | 标题 | [PlaceForm.tsx:244](../../apps/web/src/pages/master/PlaceForm.tsx#L244) |
| `PlaceForm.729d3bb2` | 写死 | 把车站的每个出口单独录入，各自有编码和坐标。 | 说明 | [PlaceForm.tsx:245](../../apps/web/src/pages/master/PlaceForm.tsx#L245) |
| `PlaceForm.8b354008` | 写死 | 有多个航站楼的机场，把每个航站楼单独录入，各自有编码和坐标。 | 说明 | [PlaceForm.tsx:245](../../apps/web/src/pages/master/PlaceForm.tsx#L245) |
| `PlaceForm.798c23b9` | 写死 | 数据来源 | 标题 | [PlaceForm.tsx:263](../../apps/web/src/pages/master/PlaceForm.tsx#L263) |
| `PlaceForm.5323f550` | 写死 | 平台改过这个机场的英语名或坐标，再次导入时不会覆盖。 | 正文 | [PlaceForm.tsx:267](../../apps/web/src/pages/master/PlaceForm.tsx#L267) |
| `PlaceForm.78a7f51a` | 写死 | 现在以这里填的为准。 | 正文 | [PlaceForm.tsx:268](../../apps/web/src/pages/master/PlaceForm.tsx#L268) |
| `PlaceForm.5cc2a24c` | 写死 | 英语名和坐标来自 OurAirports，再次导入时会随数据源更新。 | 正文 | [PlaceForm.tsx:272](../../apps/web/src/pages/master/PlaceForm.tsx#L272) |
| `PlaceForm.7b86b3fa` | 写死 | 你在这里改过其中任何一项之后，这个机场的英语名和坐标就不再随导入更新，以这里填的为准。所属城市、中文名、日文名等不受这项导入影响。 | 正文 | [PlaceForm.tsx:273](../../apps/web/src/pages/master/PlaceForm.tsx#L273) |
| `PlaceForm.984e3d00` | 写死 | 来源 | 正文 | [PlaceForm.tsx:279](../../apps/web/src/pages/master/PlaceForm.tsx#L279) |
| `PlaceForm.ef609861` | 写死 | OurAirports | 链接 | [PlaceForm.tsx:281](../../apps/web/src/pages/master/PlaceForm.tsx#L281) |
| `PlaceForm.f06b8bae` | 写死 | （公开数据） | 正文 | [PlaceForm.tsx:283](../../apps/web/src/pages/master/PlaceForm.tsx#L283) |
| `PlaceForm.4ba83aa0` | 写死 | 中文、日文名称 | 正文 | [PlaceForm.tsx:286](../../apps/web/src/pages/master/PlaceForm.tsx#L286) |
| `PlaceForm.24439e80` | 写死 | 来自 | 正文 | [PlaceForm.tsx:288](../../apps/web/src/pages/master/PlaceForm.tsx#L288) |
| `PlaceForm.4dd70d9c` | 写死 | GeoNames | 链接 | [PlaceForm.tsx:288](../../apps/web/src/pages/master/PlaceForm.tsx#L288) |
| `PlaceForm.e7a855a9` | 写死 | （CC BY 4.0）。导入时只填空着的语言；在这里改过或删掉的，再导入时不会覆盖、也不会补回。 | 正文 | [PlaceForm.tsx:288](../../apps/web/src/pages/master/PlaceForm.tsx#L288) |
| `PlaceForm.598beae8` | 写死 | 数据源里的编号 | 正文 | [PlaceForm.tsx:292](../../apps/web/src/pages/master/PlaceForm.tsx#L292) |
| `PlaceForm.8f849be3` | 写死 | 最近核对 | 正文 | [PlaceForm.tsx:296](../../apps/web/src/pages/master/PlaceForm.tsx#L296) |
| `PlaceForm.b488d422` | 写死 | 随导入更新 | 正文 | [PlaceForm.tsx:300](../../apps/web/src/pages/master/PlaceForm.tsx#L300) |
| `PlaceForm.1e22f5c8` | 写死 | 否 | 正文 | [PlaceForm.tsx:301](../../apps/web/src/pages/master/PlaceForm.tsx#L301) |
| `PlaceForm.80ffc153` | 写死 | 是 | 正文 | [PlaceForm.tsx:301](../../apps/web/src/pages/master/PlaceForm.tsx#L301) |
| `PlaceForm.c0f4056c` | 写死 | 保存后，这个机场的英语名和坐标不再随 OurAirports 更新。 | 正文 | [PlaceForm.tsx:312](../../apps/web/src/pages/master/PlaceForm.tsx#L312) |
| `PlaceForm.676d9fb4` | 写死 | 来自 OurAirports。 | 正文 | [PlaceForm.tsx:315](../../apps/web/src/pages/master/PlaceForm.tsx#L315) |
| `PlaceForm.7a416b60` | 写死 | 地点 | 名称 | [PlaceForm.tsx:321](../../apps/web/src/pages/master/PlaceForm.tsx#L321) |
| `PlaceForm.59862cc4` | 写死 | 找不到所属的{…} | 文字 | [PlaceForm.tsx:343](../../apps/web/src/pages/master/PlaceForm.tsx#L343) |
| `PlaceForm.2eb2de0c` | 写死 | 包车覆盖检查 | 文字 | [PlaceForm.tsx:358](../../apps/web/src/pages/master/PlaceForm.tsx#L358)、622 行 |
| `PlaceForm.4214e82e` | 写死 | 地址 | 文字 | [PlaceForm.tsx:358](../../apps/web/src/pages/master/PlaceForm.tsx#L358)、575 行 |
| `PlaceForm.5543cd15` | 写死 | 所属城市 | 文字 | [PlaceForm.tsx:358](../../apps/web/src/pages/master/PlaceForm.tsx#L358)、461、469 行 |
| `PlaceForm.ef25283b` | 写死 | 类型 | 文字 | [PlaceForm.tsx:358](../../apps/web/src/pages/master/PlaceForm.tsx#L358)、447 行 |
| `PlaceForm.80c1562d` | 写死 | 机场一般不用手工新增：技术人员用导入命令从 OurAirports 批量导入。只有数据源里没有的机场才需要在这里录入。 | 文字 | [PlaceForm.tsx:393](../../apps/web/src/pages/master/PlaceForm.tsx#L393) |
| `PlaceForm.31819873` | 写死 | 这个城市已经停用。请换一个城市，或先去启用它。 | 文字 | [PlaceForm.tsx:396](../../apps/web/src/pages/master/PlaceForm.tsx#L396) |
| `PlaceForm.aa895d52` | 写死 | 所属{…}「{code} {text}」已停用，不能在它下面新增{…}。请先启用它。 | 文字 | [PlaceForm.tsx:397](../../apps/web/src/pages/master/PlaceForm.tsx#L397) |
| `PlaceForm.e24b509f` | 写死 | 上级已停用，这次没有保存成功。请先启用它。 | 文字 | [PlaceForm.tsx:397](../../apps/web/src/pages/master/PlaceForm.tsx#L397) |
| `PlaceForm.8d48f224` | 写死 | 这个{…} | 文字 | [PlaceForm.tsx:400](../../apps/web/src/pages/master/PlaceForm.tsx#L400) |
| `PlaceForm.fcd6910b` | 写死 | 这个{…}下还有 {count} 个启用中的{…}，请先停用它们。 | 文字 | [PlaceForm.tsx:401](../../apps/web/src/pages/master/PlaceForm.tsx#L401) |
| `PlaceForm.e57216cd` | 写死 | {label}还没有指定所属城市，不能启用。请先在下面选择所属城市并保存。 | 文字 | [PlaceForm.tsx:404](../../apps/web/src/pages/master/PlaceForm.tsx#L404) |
| `PlaceForm.bf8f4803` | 写死 | {label}所属的城市「{text}」已停用，不能启用。请先启用这个城市。 | 文字 | [PlaceForm.tsx:405](../../apps/web/src/pages/master/PlaceForm.tsx#L405) |
| `PlaceForm.c09acefe` | 写死 | 去看这个城市 | 名称 | [PlaceForm.tsx:405](../../apps/web/src/pages/master/PlaceForm.tsx#L405) |
| `PlaceForm.462a91cf` | 写死 | {label}的上级「{code} {text}」已停用，不能启用。请先启用上级。 | 文字 | [PlaceForm.tsx:406](../../apps/web/src/pages/master/PlaceForm.tsx#L406) |
| `PlaceForm.70e26c23` | 写死 | 去看上级 | 名称 | [PlaceForm.tsx:406](../../apps/web/src/pages/master/PlaceForm.tsx#L406) |
| `PlaceForm.f4f23029` | 写死 | 基本信息 | 标题 | [PlaceForm.tsx:445](../../apps/web/src/pages/master/PlaceForm.tsx#L445) |
| `PlaceForm.0d04b8cf` | 写死 | 所属{…} | 名称 | [PlaceForm.tsx:452](../../apps/web/src/pages/master/PlaceForm.tsx#L452) |
| `PlaceForm.8620856d` | 写死 | 创建后不能修改。 | 说明 | [PlaceForm.tsx:452](../../apps/web/src/pages/master/PlaceForm.tsx#L452) |
| `PlaceForm.9f57fd58` | 写死 | 跟随所属{…}，不能单独指定。 | 说明 | [PlaceForm.tsx:461](../../apps/web/src/pages/master/PlaceForm.tsx#L461) |
| `PlaceForm.d126f477` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [PlaceForm.tsx:474](../../apps/web/src/pages/master/PlaceForm.tsx#L474) |
| `PlaceForm.d1e1d4ba` | 写死 | 还没有启用中的城市 | 空状态 | [PlaceForm.tsx:475](../../apps/web/src/pages/master/PlaceForm.tsx#L475) |
| `PlaceForm.1ed8a8f4` | 写死 | 国家跟随所属城市。 | 说明 | [PlaceForm.tsx:479](../../apps/web/src/pages/master/PlaceForm.tsx#L479) |
| `PlaceForm.23c6ada3` | 写死 | 只能换到同一个国家的城市。{…} | 说明 | [PlaceForm.tsx:479](../../apps/web/src/pages/master/PlaceForm.tsx#L479) |
| `PlaceForm.243690ba` | 写死 | 它下面的出口会跟着一起换。 | 说明 | [PlaceForm.tsx:479](../../apps/web/src/pages/master/PlaceForm.tsx#L479) |
| `PlaceForm.408b8511` | 写死 | 请先新增城市。 | 说明 | [PlaceForm.tsx:479](../../apps/web/src/pages/master/PlaceForm.tsx#L479) |
| `PlaceForm.bde0ea02` | 写死 | 它下面的航站楼会跟着一起换。 | 说明 | [PlaceForm.tsx:479](../../apps/web/src/pages/master/PlaceForm.tsx#L479) |
| `PlaceForm.a54dac01` | 写死 | IATA 三字码，3 个大写字母。创建后不能修改。 | 说明 | [PlaceForm.tsx:500](../../apps/web/src/pages/master/PlaceForm.tsx#L500) |
| `PlaceForm.be569d6d` | 写死 | 格式：STN-国家码-序号。序号是 1 到 10 位大写字母或数字。创建后不能修改。 | 说明 | [PlaceForm.tsx:502](../../apps/web/src/pages/master/PlaceForm.tsx#L502) |
| `PlaceForm.62a24565` | 写死 | 格式：POI-序号。序号是 1 到 12 位大写字母或数字。创建后不能修改。 | 说明 | [PlaceForm.tsx:504](../../apps/web/src/pages/master/PlaceForm.tsx#L504) |
| `PlaceForm.af1ae1af` | 写死 | 格式：上级编码加后缀。后缀是 1 到 6 位大写字母或数字。创建后不能修改。 | 说明 | [PlaceForm.tsx:505](../../apps/web/src/pages/master/PlaceForm.tsx#L505) |
| `PlaceForm.aec0ea6c` | 写死 | 至少填一种语言。 | 说明 | [PlaceForm.tsx:522](../../apps/web/src/pages/master/PlaceForm.tsx#L522) |
| `PlaceForm.978a3fed` | 写死 | 车站类型 | 标题 | [PlaceForm.tsx:530](../../apps/web/src/pages/master/PlaceForm.tsx#L530) |
| `PlaceForm.adbc700b` | 写死 | 地标类型 | 标题 | [PlaceForm.tsx:530](../../apps/web/src/pages/master/PlaceForm.tsx#L530) |
| `PlaceForm.8ba6781a` | 写死 | 国际 / 国内（选填） | 标题 | [PlaceForm.tsx:545](../../apps/web/src/pages/master/PlaceForm.tsx#L545) |
| `PlaceForm.8e1a4309` | 写死 | 这个机场起降的是国际航班、国内航班，还是都有。 | 说明 | [PlaceForm.tsx:545](../../apps/web/src/pages/master/PlaceForm.tsx#L545) |
| `PlaceForm.8c6e26c1` | 写死 | 位置 | 标题 | [PlaceForm.tsx:549](../../apps/web/src/pages/master/PlaceForm.tsx#L549) |
| `PlaceForm.385a6a89` | 写死 | WGS84 坐标，保留 6 位小数。这是司机到达判定用的位置，请尽量准确。 | 说明 | [PlaceForm.tsx:557](../../apps/web/src/pages/master/PlaceForm.tsx#L557) |
| `PlaceForm.7db6585a` | 写死 | 这个{…}自己的坐标，保留 6 位小数。 | 说明 | [PlaceForm.tsx:557](../../apps/web/src/pages/master/PlaceForm.tsx#L557) |
| `PlaceForm.907f6fa4` | 写死 | 填入{…}的坐标 | 按钮 | [PlaceForm.tsx:563](../../apps/web/src/pages/master/PlaceForm.tsx#L563) |
| `PlaceForm.46212d5d` | 写死 | 地址（选填） | 名称 | [PlaceForm.tsx:578](../../apps/web/src/pages/master/PlaceForm.tsx#L578) |
| `PlaceForm.35c782ef` | 写死 | 包车 | 标题 | [PlaceForm.tsx:619](../../apps/web/src/pages/master/PlaceForm.tsx#L619) |
| `PlaceForm.834a2fe5` | 写死 | 不在检查清单里 | 正文 | [PlaceForm.tsx:624](../../apps/web/src/pages/master/PlaceForm.tsx#L624) |
| `PlaceForm.a85ec1b8` | 写死 | 已放进检查清单 | 正文 | [PlaceForm.tsx:624](../../apps/web/src/pages/master/PlaceForm.tsx#L624) |
| `PlaceForm.37e603d1` | 写死 | 放进包车覆盖检查 | 正文 | [PlaceForm.tsx:628](../../apps/web/src/pages/master/PlaceForm.tsx#L628) |
| `PlaceForm.ba822768` | 写死 | 勾了以后，同一城市的包车商品上架时会检查这个地标在不在它的基础价、行程或上下车加价区域里；不在就提醒供应商（不拦上架）。 | 正文 | [PlaceForm.tsx:632](../../apps/web/src/pages/master/PlaceForm.tsx#L632) |
| `place.addressHintAirport` | 已走 key | 日文地址，含邮编，例如 〒144-0041 東京都大田区羽田空港 3-3-2。 | 说明 | [place-texts.ts:19](../../apps/web/src/pages/master/place-texts.ts#L19) |
| `place.meetingPointLegend` | 已走 key | 集合地点说明 | 标题 | [place-texts.ts:20](../../apps/web/src/pages/master/place-texts.ts#L20) |
| `place.meetingPointHintAirport` | 已走 key | 司机在哪里等客人、客人怎么找到司机。只有一个航站楼的机场写在这里；有多个航站楼的写在各航站楼上。选填；填的话中文必填，日文、英文选填。供应商也看得到。 | 说明 | [place-texts.ts:21](../../apps/web/src/pages/master/place-texts.ts#L21) |
| `place.meetingPointHintTerminal` | 已走 key | 司机在这个航站楼的哪里等客人、客人怎么找到司机。选填；填的话中文必填，日文、英文选填。供应商也看得到。 | 说明 | [place-texts.ts:22](../../apps/web/src/pages/master/place-texts.ts#L22) |
| `place.meetingPointZh` | 已走 key | 中文 | 文字 | [place-texts.ts:23](../../apps/web/src/pages/master/place-texts.ts#L23) |
| `place.meetingPointJa` | 已走 key | 日文（选填） | 文字 | [place-texts.ts:24](../../apps/web/src/pages/master/place-texts.ts#L24) |
| `place.meetingPointEn` | 已走 key | 英文（选填） | 文字 | [place-texts.ts:25](../../apps/web/src/pages/master/place-texts.ts#L25) |
| `place.meetingPointZhRequired` | 已走 key | 填了日文或英文时，中文必填 | 提示 | [place-texts.ts:26](../../apps/web/src/pages/master/place-texts.ts#L26) |
| `place.meetingPointTooLong` | 已走 key | 最多 {max} 个字 | 文字 | [place-texts.ts:27](../../apps/web/src/pages/master/place-texts.ts#L27) |

## 主数据 · 车型组和附加服务

文件：`apps/web/src/pages/master/OtherForms.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OtherForms.80a147dd` | 写死 | 名称 | 文字 | [OtherForms.tsx:69](../../apps/web/src/pages/master/OtherForms.tsx#L69)、140、208、308、317、348 行 |
| `OtherForms.53dcc9f2` | 写死 | 请选择等级 | 文字 | [OtherForms.tsx:72](../../apps/web/src/pages/master/OtherForms.tsx#L72) |
| `OtherForms.f3bd9bed` | 写死 | 座位数要填 1 到 {MAX\_VEHICLE\_SEATS} 的整数 | 文字 | [OtherForms.tsx:73](../../apps/web/src/pages/master/OtherForms.tsx#L73) |
| `OtherForms.6ccb7169` | 写死 | 请输入编码 | 文字 | [OtherForms.tsx:74](../../apps/web/src/pages/master/OtherForms.tsx#L74)、310 行 |
| `OtherForms.d338f2a4` | 写死 | 编码格式应为 VG-等级-座位数，等级是 2 到 8 位大写字母或数字，例如 VG-BIZ-7 | 文字 | [OtherForms.tsx:77](../../apps/web/src/pages/master/OtherForms.tsx#L77)、83 行 |
| `OtherForms.77840cf0` | 写死 | 编码末尾的数字 {…} 和座位数 {seats} 不一致 | 文字 | [OtherForms.tsx:78](../../apps/web/src/pages/master/OtherForms.tsx#L78) |
| `OtherForms.79f06a47` | 写死 | 编码里的 {…} 是「{…}」的缩写，和所选等级「{…}」不一致。「{…}」的缩写是 {…} | 文字 | [OtherForms.tsx:82](../../apps/web/src/pages/master/OtherForms.tsx#L82) |
| `OtherForms.9bb372ec` | 写死 | 请选择动力 | 文字 | [OtherForms.tsx:87](../../apps/web/src/pages/master/OtherForms.tsx#L87) |
| `OtherForms.53820751` | 写死 | 至少要有一个组合 | 文字 | [OtherForms.tsx:88](../../apps/web/src/pages/master/OtherForms.tsx#L88) |
| `OtherForms.ac5b7de5` | 写死 | 人数要填不小于 1 的整数 | 文字 | [OtherForms.tsx:95](../../apps/web/src/pages/master/OtherForms.tsx#L95) |
| `OtherForms.1fb9a83e` | 写死 | 人数不能超过座位数（{seats} 座） | 文字 | [OtherForms.tsx:96](../../apps/web/src/pages/master/OtherForms.tsx#L96) |
| `OtherForms.b9aa68d0` | 写死 | 行李数要填 0 到 {MAX\_LUGGAGE} 的整数 | 文字 | [OtherForms.tsx:97](../../apps/web/src/pages/master/OtherForms.tsx#L97) |
| `OtherForms.0e2952b7` | 写死 | 和第 {…} 个组合重复 | 文字 | [OtherForms.tsx:100](../../apps/web/src/pages/master/OtherForms.tsx#L100) |
| `OtherForms.50d80ced` | 写死 | 代表车型最多 {SAMPLE\_MODEL\_MAX\_LENGTH} 个字 | 文字 | [OtherForms.tsx:105](../../apps/web/src/pages/master/OtherForms.tsx#L105) |
| `OtherForms.2e2d1916` | 写死 | 车型组 | 名称 | [OtherForms.tsx:124](../../apps/web/src/pages/master/OtherForms.tsx#L124)、125、284 行 |
| `OtherForms.5e052d54` | 写死 | 人数 / 行李数组合 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、217 行 |
| `OtherForms.91f6f4e4` | 写死 | 等级 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、175、183 行 |
| `OtherForms.c0d25103` | 写死 | 编码 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、317 行 |
| `OtherForms.cc3ac7d4` | 写死 | 代表车型 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、254 行 |
| `OtherForms.edbeb516` | 写死 | 座位数 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、190 行 |
| `OtherForms.ee4f8d59` | 写死 | 动力 | 文字 | [OtherForms.tsx:140](../../apps/web/src/pages/master/OtherForms.tsx#L140)、211 行 |
| `OtherForms.440a4736` | 写死 | 创建后不能修改。要换{what}，请新增一个车型组，再停用这个。 | 说明 | [OtherForms.tsx:164](../../apps/web/src/pages/master/OtherForms.tsx#L164) |
| `OtherForms.41025075` | 写死 | 基本信息 | 标题 | [OtherForms.tsx:172](../../apps/web/src/pages/master/OtherForms.tsx#L172)、334 行 |
| `OtherForms.c388f0bb` | 写死 | {seats} 座 | 正文 | [OtherForms.tsx:190](../../apps/web/src/pages/master/OtherForms.tsx#L190) |
| `OtherForms.62ec73f6` | 写死 | 座位数（座） | 名称 | [OtherForms.tsx:192](../../apps/web/src/pages/master/OtherForms.tsx#L192) |
| `OtherForms.54d8249f` | 写死 | VG-BIZ-7 | 输入框占位 | [OtherForms.tsx:200](../../apps/web/src/pages/master/OtherForms.tsx#L200) |
| `OtherForms.a8333394` | 写死 | 格式：VG-等级-座位数。等级缩写：经济 ECO、舒适 CMF、商务 BIZ、豪华 LUX；同等级有多个车型组时可以在缩写后加字母或数字区分，例如 VG-BIZEV-7。创建后不能修改。 | 说明 | [OtherForms.tsx:201](../../apps/web/src/pages/master/OtherForms.tsx#L201) |
| `OtherForms.55bb730a` | 写死 | 至少填一种语言。 | 说明 | [OtherForms.tsx:208](../../apps/web/src/pages/master/OtherForms.tsx#L208)、348 行 |
| `OtherForms.ebe728a5` | 写死 | 载客 | 标题 | [OtherForms.tsx:214](../../apps/web/src/pages/master/OtherForms.tsx#L214) |
| `OtherForms.b8a0d440` | 写死 | 组合 | 名称 | [OtherForms.tsx:218](../../apps/web/src/pages/master/OtherForms.tsx#L218) |
| `OtherForms.a498501f` | 写死 | 供应商给商品选车型组时，要从这里选一个组合。人数不能超过座位数。 | 说明 | [OtherForms.tsx:228](../../apps/web/src/pages/master/OtherForms.tsx#L228) |
| `OtherForms.85f9146d` | 写死 | {passengers} 人 {luggage} 件 | 正文 | [OtherForms.tsx:235](../../apps/web/src/pages/master/OtherForms.tsx#L235) |
| `OtherForms.1a5fb8c5` | 写死 | 第 {…} 个组合的人数 | 读屏说明 | [OtherForms.tsx:239](../../apps/web/src/pages/master/OtherForms.tsx#L239) |
| `OtherForms.ce6d57cb` | 写死 | 人 | 正文 | [OtherForms.tsx:240](../../apps/web/src/pages/master/OtherForms.tsx#L240) |
| `OtherForms.73c468a4` | 写死 | 第 {…} 个组合的行李数 | 读屏说明 | [OtherForms.tsx:243](../../apps/web/src/pages/master/OtherForms.tsx#L243) |
| `OtherForms.cff584dd` | 写死 | 件 | 正文 | [OtherForms.tsx:244](../../apps/web/src/pages/master/OtherForms.tsx#L244) |
| `OtherForms.437f75ac` | 写死 | 代表车型（选填） | 标题 | [OtherForms.tsx:253](../../apps/web/src/pages/master/OtherForms.tsx#L253) |
| `OtherForms.bd085559` | 写死 | 写当地实际在跑的具体品牌车型。第一个是「代表车型」；全部连起来就是给客人看的「同级车型」说明（X, Y or similar），见下面的预览。 | 说明 | [OtherForms.tsx:261](../../apps/web/src/pages/master/OtherForms.tsx#L261) |
| `OtherForms.9d730a6a` | 写死 | 第 {…} 个代表车型 | 读屏说明 | [OtherForms.tsx:269](../../apps/web/src/pages/master/OtherForms.tsx#L269) |
| `OtherForms.ca0fb2dd` | 写死 | 客人看到的车型标识 | 标题 | [OtherForms.tsx:276](../../apps/web/src/pages/master/OtherForms.tsx#L276) |
| `OtherForms.ec5e4c2c` | 写死 | 填好组合和代表车型后，这里显示客人在官网、订单页、邮件里看到的 4 项。 | 正文 | [OtherForms.tsx:278](../../apps/web/src/pages/master/OtherForms.tsx#L278) |
| `OtherForms.2476594b` | 写死 | 这个车型组 | 文字 | [OtherForms.tsx:284](../../apps/web/src/pages/master/OtherForms.tsx#L284) |
| `OtherForms.300228cb` | 写死 | 附加服务 | 名称 | [OtherForms.tsx:301](../../apps/web/src/pages/master/OtherForms.tsx#L301)、302、377 行 |
| `OtherForms.08c1567e` | 写死 | 说明 | 文字 | [OtherForms.tsx:308](../../apps/web/src/pages/master/OtherForms.tsx#L308)、317 行 |
| `OtherForms.9b4deb79` | 写死 | 编码格式应为 ADD-代码，代码以大写字母开头，只用大写字母、数字、下划线，例如 ADD-CHILD\_SEAT | 文字 | [OtherForms.tsx:311](../../apps/web/src/pages/master/OtherForms.tsx#L311) |
| `OtherForms.27dcc0b8` | 写死 | 请至少选择一个品类 | 文字 | [OtherForms.tsx:313](../../apps/web/src/pages/master/OtherForms.tsx#L313) |
| `OtherForms.caaa6407` | 写死 | 请选择计费方式 | 文字 | [OtherForms.tsx:314](../../apps/web/src/pages/master/OtherForms.tsx#L314) |
| `OtherForms.2bf71375` | 写死 | 计费方式 | 文字 | [OtherForms.tsx:317](../../apps/web/src/pages/master/OtherForms.tsx#L317)、360 行 |
| `OtherForms.c5b4fe63` | 写死 | 适用品类 | 文字 | [OtherForms.tsx:317](../../apps/web/src/pages/master/OtherForms.tsx#L317)、356 行 |
| `OtherForms.1361683f` | 写死 | ADD-CHILD\_SEAT | 输入框占位 | [OtherForms.tsx:340](../../apps/web/src/pages/master/OtherForms.tsx#L340) |
| `OtherForms.4312e293` | 写死 | 格式：ADD-代码。代码以大写字母开头，只用大写字母、数字和下划线，最多 40 位。创建后不能修改。 | 说明 | [OtherForms.tsx:341](../../apps/web/src/pages/master/OtherForms.tsx#L341) |
| `OtherForms.2585a395` | 写死 | 说明（选填） | 标题 | [OtherForms.tsx:351](../../apps/web/src/pages/master/OtherForms.tsx#L351) |
| `OtherForms.a3aef680` | 写死 | 给客人看的说明：这项服务包含什么、有什么限制。 | 说明 | [OtherForms.tsx:351](../../apps/web/src/pages/master/OtherForms.tsx#L351) |
| `OtherForms.d0aa2bb9` | 写死 | 适用范围与计费 | 标题 | [OtherForms.tsx:354](../../apps/web/src/pages/master/OtherForms.tsx#L354) |
| `OtherForms.b2a214cc` | 写死 | 只有勾选的品类的商品可以提供这项服务。 | 说明 | [OtherForms.tsx:356](../../apps/web/src/pages/master/OtherForms.tsx#L356) |
| `OtherForms.2eb630d1` | 写死 | 单价不在这里设置，由各供应商在自己的商品里定价。 | 说明 | [OtherForms.tsx:368](../../apps/web/src/pages/master/OtherForms.tsx#L368) |
| `OtherForms.abde7ce1` | 写死 | 这项附加服务 | 文字 | [OtherForms.tsx:377](../../apps/web/src/pages/master/OtherForms.tsx#L377) |

## 处理导入的机场

文件：`apps/web/src/pages/master/PendingAirportsPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PendingAirportsPage.fed7309d` | 写死 | 不填 | 名称 | [PendingAirportsPage.tsx:38](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L38) |
| `PendingAirportsPage.46f5c1d8` | 写死 | 这个编码已经被使用，请换一个 | 文字 | [PendingAirportsPage.tsx:107](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L107) |
| `PendingAirportsPage.cd3c8b80` | 写死 | 这一项不符合要求，请检查后重试 | 文字 | [PendingAirportsPage.tsx:114](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L114) |
| `PendingAirportsPage.a9d0b606` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [PendingAirportsPage.tsx:116](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L116)、375 行 |
| `PendingAirportsPage.96ac0b9e` | 写死 | 网络连接失败，请检查网络后重试。你填写的内容还在。 | 文字 | [PendingAirportsPage.tsx:122](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L122)、350 行 |
| `PendingAirportsPage.a9d31f01` | 写死 | 系统暂时无法保存，请稍后再试。你填写的内容还在。 | 文字 | [PendingAirportsPage.tsx:123](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L123)、351、363、382 行 |
| `PendingAirportsPage.5e70efd8` | 写死 | 新增城市 | 标题 | [PendingAirportsPage.tsx:133](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L133)、144、624 行 |
| `PendingAirportsPage.a31dc5fd` | 写死 | 取消 | 按钮 | [PendingAirportsPage.tsx:141](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L141) |
| `PendingAirportsPage.b61ab550` | 写死 | 新增中… | 文字 | [PendingAirportsPage.tsx:142](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L142) |
| `PendingAirportsPage.06ed0935` | 写死 | 填入这个机场的坐标 | 按钮 | [PendingAirportsPage.tsx:163](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L163) |
| `PendingAirportsPage.dec6a53b` | 写死 | 处理导入的机场 · NOZOMI {name} | 浏览器标题 | [PendingAirportsPage.tsx:174](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L174) |
| `PendingAirportsPage.868c0d6d` | 写死 | 最近用过 | 文字 | [PendingAirportsPage.tsx:311](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L311) |
| `PendingAirportsPage.8833a547` | 写死 | 全部 | 文字 | [PendingAirportsPage.tsx:311](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L311)、469 行 |
| `PendingAirportsPage.c44de9a4` | 写死 | 下一个：{…}，还剩 {…} 个 | 提示 | [PendingAirportsPage.tsx:328](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L328) |
| `PendingAirportsPage.54f7cb83` | 写死 | 名称 | 文字 | [PendingAirportsPage.tsx:342](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L342)、654 行 |
| `PendingAirportsPage.5b67e973` | 写死 | 「{…}」刚被别人处理过了，已为你换到下一个。 | 文字 | [PendingAirportsPage.tsx:356](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L356)、371 行 |
| `PendingAirportsPage.6227307e` | 写死 | 这个机场刚被别人修改过，已载入最新内容，请再确认一次。 | 文字 | [PendingAirportsPage.tsx:360](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L360) |
| `PendingAirportsPage.8e5b5a0b` | 写死 | 同时有其他人在修改相关数据，这次没有保存成功。请再点一次。 | 文字 | [PendingAirportsPage.tsx:366](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L366) |
| `PendingAirportsPage.46b2037c` | 写死 | 这个城市已经停用或不能用于这个机场。请换一个城市。 | 错误提示 | [PendingAirportsPage.tsx:377](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L377) |
| `PendingAirportsPage.e00a2eeb` | 写死 | 找不到「{…}」，它可能已经不存在，已为你换到下一个。 | 文字 | [PendingAirportsPage.tsx:381](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L381) |
| `PendingAirportsPage.9aa8d528` | 写死 | 已启用「{…}」 | 提示 | [PendingAirportsPage.tsx:389](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L389)、415 行 |
| `PendingAirportsPage.243083b8` | 写死 | 所属城市已停用，请先启用城市 | 提示 | [PendingAirportsPage.tsx:393](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L393) |
| `PendingAirportsPage.97ab7b49` | 写死 | 系统暂时无法启用 | 提示 | [PendingAirportsPage.tsx:393](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L393) |
| `PendingAirportsPage.b8922f3f` | 写死 | 网络连接失败 | 提示 | [PendingAirportsPage.tsx:393](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L393) |
| `PendingAirportsPage.a58b1048` | 写死 | 城市已经指定好了，但还没有启用：{reason} | 文字 | [PendingAirportsPage.tsx:395](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L395) |
| `PendingAirportsPage.e03085e7` | 写死 | 已保存「{…}」，还没有启用 | 提示 | [PendingAirportsPage.tsx:420](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L420) |
| `PendingAirportsPage.aca4bc1d` | 写死 | 地点 | 名称 | [PendingAirportsPage.tsx:447](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L447) |
| `PendingAirportsPage.b5adfb68` | 写死 | 主数据 | 名称 | [PendingAirportsPage.tsx:447](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L447) |
| `PendingAirportsPage.bae974e6` | 写死 | 处理导入的机场 | 名称 | [PendingAirportsPage.tsx:447](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L447)、448 行 |
| `PendingAirportsPage.93045711` | 写死 | 回到地点列表 | 按钮 | [PendingAirportsPage.tsx:448](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L448)、531 行 |
| `PendingAirportsPage.46df3378` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [PendingAirportsPage.tsx:454](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L454) |
| `PendingAirportsPage.c17ed7d4` | 写死 | 你没有权限查看这里 | 标题 | [PendingAirportsPage.tsx:454](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L454) |
| `PendingAirportsPage.af04076d` | 写死 | 这些机场是从 OurAirports 导入的，还没有所属城市，所以是停用的。逐个指定城市并启用后，供应商才能选到它们。 | 正文 | [PendingAirportsPage.tsx:467](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L467) |
| `PendingAirportsPage.40876967` | 写死 | 国家 | 名称 | [PendingAirportsPage.tsx:469](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L469) |
| `PendingAirportsPage.36b9254a` | 写死 | 还剩 {…} 个 | 正文 | [PendingAirportsPage.tsx:470](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L470) |
| `PendingAirportsPage.7a6d02af` | 写死 | 加载失败 | 标题 | [PendingAirportsPage.tsx:483](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L483) |
| `PendingAirportsPage.90f2d474` | 写死 | 请检查网络后重试。 | 说明 | [PendingAirportsPage.tsx:484](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L484) |
| `PendingAirportsPage.a2eb73f9` | 写死 | 重试 | 按钮 | [PendingAirportsPage.tsx:488](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L488)、502 行 |
| `PendingAirportsPage.e92ba2d5` | 写死 | 后面的机场没有取到 | 标题 | [PendingAirportsPage.tsx:497](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L497) |
| `PendingAirportsPage.b50a0b0a` | 写死 | 还有待指定城市的机场，但这一批没有加载出来。请检查网络后重试。 | 说明 | [PendingAirportsPage.tsx:498](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L498) |
| `PendingAirportsPage.cc52c741` | 写死 | {…}没有待指定城市的机场 | 标题 | [PendingAirportsPage.tsx:515](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L515) |
| `PendingAirportsPage.671a2cdd` | 写死 | 导入新的机场后，会出现在这里。 | 说明 | [PendingAirportsPage.tsx:516](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L516)、527 行 |
| `PendingAirportsPage.23bb7a57` | 写死 | 看全部国家 | 按钮 | [PendingAirportsPage.tsx:520](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L520) |
| `PendingAirportsPage.8edf04d0` | 写死 | 没有待指定城市的机场了 | 标题 | [PendingAirportsPage.tsx:526](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L526) |
| `PendingAirportsPage.6f038e20` | 写死 | 这一批都处理完了。 | 说明 | [PendingAirportsPage.tsx:527](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L527) |
| `PendingAirportsPage.22a0012a` | 写死 | 启用中… | 文字 | [PendingAirportsPage.tsx:553](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L553) |
| `PendingAirportsPage.c7ccba7a` | 写死 | 再试一次启用 | 按钮 | [PendingAirportsPage.tsx:555](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L555) |
| `PendingAirportsPage.29b1ea0d` | 写死 | 先处理下一个 | 按钮 | [PendingAirportsPage.tsx:558](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L558) |
| `PendingAirportsPage.2363ec94` | 写死 | 知道了 | 按钮 | [PendingAirportsPage.tsx:571](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L571) |
| `PendingAirportsPage.0a995ce9` | 写死 | 跳过过 | 正文 | [PendingAirportsPage.tsx:579](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L579) |
| `PendingAirportsPage.4228f763` | 写死 | 复制坐标 | 名称 | [PendingAirportsPage.tsx:591](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L591) |
| `PendingAirportsPage.b50f994f` | 写死 | 手工录入 | 正文 | [PendingAirportsPage.tsx:594](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L594) |
| `PendingAirportsPage.c59f998e` | 写死 | 来源 {…} | 正文 | [PendingAirportsPage.tsx:594](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L594) |
| `PendingAirportsPage.f9146505` | 写死 | 所属城市 | 名称 | [PendingAirportsPage.tsx:600](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L600) |
| `PendingAirportsPage.ef32783a` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [PendingAirportsPage.tsx:604](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L604) |
| `PendingAirportsPage.2b51d569` | 写死 | 还没有{…}的城市 | 空状态 | [PendingAirportsPage.tsx:605](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L605) |
| `PendingAirportsPage.feacaafc` | 写死 | 请选择所属城市 | 提示 | [PendingAirportsPage.tsx:608](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L608) |
| `PendingAirportsPage.286e639c` | 写死 | 还没有{…}的启用中的城市。请先新增城市。 | 说明 | [PendingAirportsPage.tsx:611](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L611) |
| `PendingAirportsPage.e8775131` | 写死 | 建议：{text}（{…}）。按机场资料里的所属城市和周边的大城市给出的建议，请核对后再保存。 | 说明 | [PendingAirportsPage.tsx:613](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L613) |
| `PendingAirportsPage.6c185947` | 写死 | 只能选{…}的启用中的城市。 | 说明 | [PendingAirportsPage.tsx:614](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L614) |
| `PendingAirportsPage.02908f9c` | 写死 | 建议的城市 | 正文 | [PendingAirportsPage.tsx:629](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L629) |
| `PendingAirportsPage.4f4b7de5` | 写死 | （按机场资料里的所属城市和周边的大城市给出，括号里是到城市中心的直线距离）。建议不一定对，请核对： | 正文 | [PendingAirportsPage.tsx:630](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L630) |
| `PendingAirportsPage.4f8daca2` | 写死 | 至少填一种语言。 | 说明 | [PendingAirportsPage.tsx:660](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L660) |
| `PendingAirportsPage.84e38fc3` | 写死 | 英语名来自 OurAirports。在这里改过以后，再导入时不再更新它。 | 说明 | [PendingAirportsPage.tsx:660](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L660) |
| `PendingAirportsPage.bf18f1f1` | 写死 | 保存后，这个机场的英语名和坐标不再随 OurAirports 更新。 | 说明 | [PendingAirportsPage.tsx:660](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L660) |
| `PendingAirportsPage.d0aa9a2e` | 写死 | 国际 / 国内（选填） | 标题 | [PendingAirportsPage.tsx:664](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L664) |
| `PendingAirportsPage.63b25562` | 写死 | 保存中… | 文字 | [PendingAirportsPage.tsx:666](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L666)、669 行 |
| `PendingAirportsPage.bf2af1b9` | 写死 | 保存并启用 | 按钮 | [PendingAirportsPage.tsx:668](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L668) |
| `PendingAirportsPage.7a5aef9b` | 写死 | 只保存，先不启用 | 按钮 | [PendingAirportsPage.tsx:671](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L671) |
| `PendingAirportsPage.9d37f3ce` | 写死 | 跳过 | 按钮 | [PendingAirportsPage.tsx:674](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L674) |
| `PendingAirportsPage.ef344eb7` | 写死 | 请先选择所属城市 | 正文 | [PendingAirportsPage.tsx:675](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L675) |
| `PendingAirportsPage.9a7b32a2` | 写死 | 本次已处理 | 标题 | [PendingAirportsPage.tsx:684](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L684) |
| `PendingAirportsPage.6a66ad42` | 写死 | 编辑 {code} | 读屏说明 | [PendingAirportsPage.tsx:692](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L692) |
| `PendingAirportsPage.b73091b4` | 写死 | 编辑 | 按钮 | [PendingAirportsPage.tsx:694](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L694) |
| `PendingAirportsPage.f9fa8d6d` | 写死 | 已新增城市「{…}」 | 提示 | [PendingAirportsPage.tsx:711](../../apps/web/src/pages/master/PendingAirportsPage.tsx#L711) |

## 共享区域去重

文件：`apps/web/src/lib/shared-area-duplicates.ts`、`apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `shared-area-duplicates.a61345fe` | 写死 | 营运区重叠 | 文字 | [shared-area-duplicates.ts:6](../../apps/web/src/lib/shared-area-duplicates.ts#L6) |
| `shared-area-duplicates.e868457a` | 写死 | 同名 | 名称 | [shared-area-duplicates.ts:6](../../apps/web/src/lib/shared-area-duplicates.ts#L6) |
| `shared-area-duplicates.dfec4585` | 写死 | 这一份已经被别人标为重复了。刷新列表看看现在的状态。 | 文字 | [shared-area-duplicates.ts:10](../../apps/web/src/lib/shared-area-duplicates.ts#L10) |
| `shared-area-duplicates.202a9d34` | 写死 | 有别的区域被标成了这一份的重复（它是保留的那份），不能再把它隐藏。先撤销那些标记。 | 文字 | [shared-area-duplicates.ts:11](../../apps/web/src/lib/shared-area-duplicates.ts#L11) |
| `shared-area-duplicates.3d82e5c2` | 写死 | 选的那份已经不在共享库里，或者刚被标为重复。刷新列表后换一份。 | 文字 | [shared-area-duplicates.ts:12](../../apps/web/src/lib/shared-area-duplicates.ts#L12) |
| `shared-area-duplicates.de273192` | 写死 | 两个区域不在同一个城市。 | 文字 | [shared-area-duplicates.ts:13](../../apps/web/src/lib/shared-area-duplicates.ts#L13) |
| `shared-area-duplicates.dca5f7cd` | 写死 | 不能把区域标成它自己的重复。 | 文字 | [shared-area-duplicates.ts:14](../../apps/web/src/lib/shared-area-duplicates.ts#L14) |
| `shared-area-duplicates.eabed6b7` | 写死 | 这一份已经不是重复了（可能别人刚撤销过）。刷新列表看看现在的状态。 | 文字 | [shared-area-duplicates.ts:15](../../apps/web/src/lib/shared-area-duplicates.ts#L15) |
| `shared-area-duplicates.95551afd` | 写死 | 这一份已经不在共享库里了（供应商停用或删除了它）。刷新列表看看现在的状态。 | 文字 | [shared-area-duplicates.ts:16](../../apps/web/src/lib/shared-area-duplicates.ts#L16) |
| `shared-area-duplicates.e129b39e` | 写死 | 营运区 {operate\_polygon\_count} 块，被引用 {copy\_count} 份 | 文字 | [shared-area-duplicates.ts:27](../../apps/web/src/lib/shared-area-duplicates.ts#L27) |
| `SharedAreaDuplicatesPage.237bf895` | 写死 | 共享区域去重 · NOZOMI {name} | 浏览器标题 | [SharedAreaDuplicatesPage.tsx:36](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L36) |
| `SharedAreaDuplicatesPage.aa6774cf` | 写死 | （已停用） | 名称 | [SharedAreaDuplicatesPage.tsx:58](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L58) |
| `SharedAreaDuplicatesPage.fab3b00a` | 写死 | 区域 {…} | 文字 | [SharedAreaDuplicatesPage.tsx:62](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L62)、95 行 |
| `SharedAreaDuplicatesPage.585cf269` | 写死 | 主数据 | 名称 | [SharedAreaDuplicatesPage.tsx:66](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L66) |
| `SharedAreaDuplicatesPage.67cc85ac` | 写死 | 共享区域去重 | 名称 | [SharedAreaDuplicatesPage.tsx:66](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L66)、67 行 |
| `SharedAreaDuplicatesPage.a212b4f7` | 写死 | 需要的话，请联系管理员开通「主数据 · 查看」。 | 说明 | [SharedAreaDuplicatesPage.tsx:70](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L70) |
| `SharedAreaDuplicatesPage.cbdaed30` | 写死 | 你没有权限查看这里 | 标题 | [SharedAreaDuplicatesPage.tsx:70](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L70) |
| `SharedAreaDuplicatesPage.a19a33e8` | 写死 | 区域 | 文字 | [SharedAreaDuplicatesPage.tsx:75](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L75) |
| `SharedAreaDuplicatesPage.102fc6ee` | 写死 | 营运区 {operate\_polygon\_count} 块 · 禁行区 {forbid\_polygon\_count} 块 · 第 {shape\_version} 版 · {…} 修改 | 正文 | [SharedAreaDuplicatesPage.tsx:80](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L80) |
| `SharedAreaDuplicatesPage.457f871e` | 写死 | 被引用 | 文字 | [SharedAreaDuplicatesPage.tsx:84](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L84) |
| `SharedAreaDuplicatesPage.e52d48ed` | 写死 | {copy\_count} 份 | 文字 | [SharedAreaDuplicatesPage.tsx:84](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L84) |
| `SharedAreaDuplicatesPage.1e4be476` | 写死 | 状态 | 文字 | [SharedAreaDuplicatesPage.tsx:87](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L87) |
| `SharedAreaDuplicatesPage.c44b9d2e` | 写死 | 在库里 | 名称 | [SharedAreaDuplicatesPage.tsx:91](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L91) |
| `SharedAreaDuplicatesPage.0af468c0` | 写死 | 已隐藏 | 名称 | [SharedAreaDuplicatesPage.tsx:94](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L94) |
| `SharedAreaDuplicatesPage.5b2bd231` | 写死 | 以后的引用指向{…} | 正文 | [SharedAreaDuplicatesPage.tsx:95](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L95) |
| `SharedAreaDuplicatesPage.21f84650` | 写死 | 保留的那份已不在共享库里，现在引用这一份会失败，请撤销 | 正文 | [SharedAreaDuplicatesPage.tsx:97](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L97) |
| `SharedAreaDuplicatesPage.83a5e9b3` | 写死 | 疑似重复 | 文字 | [SharedAreaDuplicatesPage.tsx:103](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L103) |
| `SharedAreaDuplicatesPage.eddc4fd2` | 写死 | 没有 | 正文 | [SharedAreaDuplicatesPage.tsx:107](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L107) |
| `SharedAreaDuplicatesPage.68957135` | 写死 | 操作 | 文字 | [SharedAreaDuplicatesPage.tsx:116](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L116) |
| `SharedAreaDuplicatesPage.54ccb71b` | 写死 | 同城没有别的区域 | 正文 | [SharedAreaDuplicatesPage.tsx:122](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L122) |
| `SharedAreaDuplicatesPage.3342c8f1` | 写死 | 标为重复：{text} | 读屏说明 | [SharedAreaDuplicatesPage.tsx:127](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L127) |
| `SharedAreaDuplicatesPage.9ec37ab5` | 写死 | 标为重复 | 按钮 | [SharedAreaDuplicatesPage.tsx:134](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L134)、201 行 |
| `SharedAreaDuplicatesPage.9425110d` | 写死 | 撤销：{text} | 读屏说明 | [SharedAreaDuplicatesPage.tsx:138](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L138) |
| `SharedAreaDuplicatesPage.71a525ad` | 写死 | 撤销 | 按钮 | [SharedAreaDuplicatesPage.tsx:140](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L140)、228、230 行 |
| `SharedAreaDuplicatesPage.72bb298d` | 写死 | 共享库是各供应商启用中的原创区域，供应商新建区域时可以直接引用。同一块区域被几家各画了一份时，把多出来的一份「标为重复」：它从共享库里隐藏，以后引用它的改为引用你选的那份。 不改任何供应商自己的区域、已经引用的副本和报价；随时可以撤销。 | 正文 | [SharedAreaDuplicatesPage.tsx:160](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L160) |
| `SharedAreaDuplicatesPage.824d34a9` | 写死 | 按名称搜索 | 名称 | [SharedAreaDuplicatesPage.tsx:163](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L163) |
| `SharedAreaDuplicatesPage.112e565d` | 写死 | 城市 | 名称 | [SharedAreaDuplicatesPage.tsx:166](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L166) |
| `SharedAreaDuplicatesPage.0ff4734e` | 写死 | 先选城市 | 输入框占位 | [SharedAreaDuplicatesPage.tsx:167](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L167) |
| `SharedAreaDuplicatesPage.267a8ce8` | 写死 | 先选一个城市 | 标题 | [SharedAreaDuplicatesPage.tsx:176](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L176) |
| `SharedAreaDuplicatesPage.c8b5534f` | 写死 | 共享库按城市列出，疑似重复只在同一个城市里找。 | 说明 | [SharedAreaDuplicatesPage.tsx:176](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L176) |
| `SharedAreaDuplicatesPage.1ebd6710` | 写死 | 这个城市的共享区域超过 500 个，只列出了最近修改的 500 个。 | 提示 | [SharedAreaDuplicatesPage.tsx:179](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L179) |
| `SharedAreaDuplicatesPage.20d3c52a` | 写死 | 共享区域 | 名称 | [SharedAreaDuplicatesPage.tsx:182](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L182) |
| `SharedAreaDuplicatesPage.1a4ae92f` | 写死 | 没有名称符合的区域 | 标题 | [SharedAreaDuplicatesPage.tsx:189](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L189) |
| `SharedAreaDuplicatesPage.3c1fd452` | 写死 | 换个名称试试，或清空搜索。 | 说明 | [SharedAreaDuplicatesPage.tsx:189](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L189) |
| `SharedAreaDuplicatesPage.8a23f20c` | 写死 | 供应商在这个城市新建区域后会自动出现在这里。 | 说明 | [SharedAreaDuplicatesPage.tsx:189](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L189) |
| `SharedAreaDuplicatesPage.e823dd14` | 写死 | 这个城市的共享库里还没有区域 | 标题 | [SharedAreaDuplicatesPage.tsx:189](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L189) |
| `SharedAreaDuplicatesPage.3f6ac1f7` | 写死 | 把「{text}」标为重复 | 标题 | [SharedAreaDuplicatesPage.tsx:196](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L196) |
| `SharedAreaDuplicatesPage.e72e4976` | 写死 | 这一份会从共享库里隐藏，以后供应商引用它时改为引用下面选的那份。它在自己供应商那里照常可用；已经引用它的副本和所有报价都不变。 | 说明 | [SharedAreaDuplicatesPage.tsx:197](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L197) |
| `SharedAreaDuplicatesPage.83b8bc32` | 写死 | 原因 | 名称 | [SharedAreaDuplicatesPage.tsx:198](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L198)、225 行 |
| `SharedAreaDuplicatesPage.ca059e77` | 写死 | 写清为什么是重复，会记进审计日志 | 说明 | [SharedAreaDuplicatesPage.tsx:199](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L199) |
| `SharedAreaDuplicatesPage.c1c3b676` | 写死 | 正在标记… | 文字 | [SharedAreaDuplicatesPage.tsx:202](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L202) |
| `SharedAreaDuplicatesPage.fa34ef2c` | 写死 | 标记 | 按钮 | [SharedAreaDuplicatesPage.tsx:203](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L203) |
| `SharedAreaDuplicatesPage.e02769ff` | 写死 | 已把「{text}」标为重复，以后的引用指向{…} | 文字 | [SharedAreaDuplicatesPage.tsx:208](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L208) |
| `SharedAreaDuplicatesPage.e7d6a38a` | 写死 | 保留哪一份 | 名称 | [SharedAreaDuplicatesPage.tsx:212](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L212) |
| `SharedAreaDuplicatesPage.0b47dc1e` | 写死 | 疑似重复的排在前面 | 说明 | [SharedAreaDuplicatesPage.tsx:214](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L214) |
| `SharedAreaDuplicatesPage.e3648e16` | 写死 | 撤销「{text}」的重复标记 | 标题 | [SharedAreaDuplicatesPage.tsx:223](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L223) |
| `SharedAreaDuplicatesPage.e1676658` | 写死 | 撤销后它重新出现在共享库里，以后引用它的照常引用它。标记期间已经转去引用另一份的副本不变。 | 说明 | [SharedAreaDuplicatesPage.tsx:224](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L224) |
| `SharedAreaDuplicatesPage.f81fc77b` | 写死 | 正在撤销… | 文字 | [SharedAreaDuplicatesPage.tsx:229](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L229) |
| `SharedAreaDuplicatesPage.7aaae5a6` | 写死 | 已撤销，「{text}」重新出现在共享库里 | 文字 | [SharedAreaDuplicatesPage.tsx:235](../../apps/web/src/pages/master/SharedAreaDuplicatesPage.tsx#L235) |

## 汇率

文件：`apps/web/src/lib/fx-lock-form.ts`、`apps/web/src/pages/fx/FxLockSection.tsx`、`apps/web/src/pages/fx/FxRatesPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `fx-lock-form.3999960b` | 写死 | 请选择锁定多久 | 提示 | [fx-lock-form.ts:13](../../apps/web/src/lib/fx-lock-form.ts#L13) |
| `fx-lock-form.12ea4645` | 写死 | 写成大于 0 的十进制数，如 151.2；不带正负号、千分位、指数，整数、小数各最多 {maxIntegerDigits} 位 | 提示 | [fx-lock-form.ts:36](../../apps/web/src/lib/fx-lock-form.ts#L36) |
| `fx-lock-form.a7ac6b81` | 写死 | 和中央汇率相差超过 {…}%，请写明原因 | 提示 | [fx-lock-form.ts:37](../../apps/web/src/lib/fx-lock-form.ts#L37) |
| `fx-lock-form.5f4874e9` | 写死 | 和中央汇率相差超过 {…}%，系统不允许；请核对币种和数量级 | 提示 | [fx-lock-form.ts:38](../../apps/web/src/lib/fx-lock-form.ts#L38) |
| `fx-lock-form.466f352d` | 写死 | 请填锁定值 | 文字 | [fx-lock-form.ts:45](../../apps/web/src/lib/fx-lock-form.ts#L45) |
| `fx-lock-form.fa54b45e` | 写死 | 和现在的锁定一样，不用发起 | 文字 | [fx-lock-form.ts:67](../../apps/web/src/lib/fx-lock-form.ts#L67) |
| `fx-lock-form.4cf6973a` | 写死 | 还没有汇率，无法和中央汇率比对；请先拉取汇率 | 文字 | [fx-lock-form.ts:72](../../apps/web/src/lib/fx-lock-form.ts#L72) |
| `fx-lock-form.ce338d0a` | 写死 | 这条锁定已经结束（到期、解除或被取代），不用再解锁 | 文字 | [fx-lock-form.ts:73](../../apps/web/src/lib/fx-lock-form.ts#L73) |
| `FxLockSection.cc8036ad` | 写死 | 已提交，等另一位有审核权限的同事在「待审核」里批准后生效 | 文字 | [FxLockSection.tsx:27](../../apps/web/src/pages/fx/FxLockSection.tsx#L27) |
| `FxLockSection.8821dfac` | 写死 | 币种 | 文字 | [FxLockSection.tsx:34](../../apps/web/src/pages/fx/FxLockSection.tsx#L34)、193、288 行 |
| `FxLockSection.dec827ed` | 写死 | 锁定值（1 USD =） | 文字 | [FxLockSection.tsx:35](../../apps/web/src/pages/fx/FxLockSection.tsx#L35)、289 行 |
| `FxLockSection.098698ec` | 写死 | 批准时的中央汇率 | 文字 | [FxLockSection.tsx:36](../../apps/web/src/pages/fx/FxLockSection.tsx#L36) |
| `FxLockSection.38cda0fa` | 写死 | 到期时间 | 文字 | [FxLockSection.tsx:37](../../apps/web/src/pages/fx/FxLockSection.tsx#L37) |
| `FxLockSection.9bb1f4d2` | 写死 | {name} / {name}（{…} 生效） | 文字 | [FxLockSection.tsx:38](../../apps/web/src/pages/fx/FxLockSection.tsx#L38) |
| `FxLockSection.eee27b23` | 写死 | 发起 / 批准 | 文字 | [FxLockSection.tsx:38](../../apps/web/src/pages/fx/FxLockSection.tsx#L38) |
| `FxLockSection.c36b9270` | 写死 | 原因 | 文字 | [FxLockSection.tsx:39](../../apps/web/src/pages/fx/FxLockSection.tsx#L39)、228 行 |
| `FxLockSection.afba5fb3` | 写死 | 操作 | 文字 | [FxLockSection.tsx:44](../../apps/web/src/pages/fx/FxLockSection.tsx#L44) |
| `FxLockSection.f940da1f` | 写死 | 改锁定值 | 按钮 | [FxLockSection.tsx:49](../../apps/web/src/pages/fx/FxLockSection.tsx#L49) |
| `FxLockSection.bbb5bb16` | 写死 | 解锁 | 按钮 | [FxLockSection.tsx:52](../../apps/web/src/pages/fx/FxLockSection.tsx#L52)、296 行 |
| `FxLockSection.fb979750` | 写死 | 人工锁定 | 标题 | [FxLockSection.tsx:64](../../apps/web/src/pages/fx/FxLockSection.tsx#L64) |
| `FxLockSection.ad30bb80` | 写死 | 发起锁定 | 按钮 | [FxLockSection.tsx:68](../../apps/web/src/pages/fx/FxLockSection.tsx#L68) |
| `FxLockSection.c8357d2b` | 写死 | 极端行情时可以临时锁定某个币种相对美元的汇率，锁定期间报价用锁定值（报价快照里记明），交叉汇率照常由两边算出。一人发起、另一位有审核权限的同事批准后才生效，解锁也一样；最长 {max\_hours} 小时，到期自动恢复用数据源的汇率。 | 正文 | [FxLockSection.tsx:72](../../apps/web/src/pages/fx/FxLockSection.tsx#L72) |
| `FxLockSection.5751f2fb` | 写死 | 现在没有锁定的汇率。 | 正文 | [FxLockSection.tsx:75](../../apps/web/src/pages/fx/FxLockSection.tsx#L75) |
| `FxLockSection.ddb41ae3` | 写死 | 生效中的锁定 | 名称 | [FxLockSection.tsx:77](../../apps/web/src/pages/fx/FxLockSection.tsx#L77) |
| `FxLockSection.6757500b` | 写死 | 待审核 | 标题 | [FxLockSection.tsx:108](../../apps/web/src/pages/fx/FxLockSection.tsx#L108)、113 行 |
| `FxLockSection.ab13588e` | 写死 | {name} 发起 · {…}{…} | 正文 | [FxLockSection.tsx:117](../../apps/web/src/pages/fx/FxLockSection.tsx#L117) |
| `FxLockSection.9a773d5b` | 写死 | 去待审核处理 | 链接 | [FxLockSection.tsx:121](../../apps/web/src/pages/fx/FxLockSection.tsx#L121) |
| `FxLockSection.8b441125` | 写死 | 这是你发起的，要等另一位有审核权限的同事处理（可以在「待审核」里撤回）。 | 正文 | [FxLockSection.tsx:123](../../apps/web/src/pages/fx/FxLockSection.tsx#L123) |
| `FxLockSection.5036702b` | 写死 | 提交 | 文字 | [FxLockSection.tsx:166](../../apps/web/src/pages/fx/FxLockSection.tsx#L166)、256 行 |
| `FxLockSection.407a99a0` | 写死 | 改 {currency} 的锁定 | 标题 | [FxLockSection.tsx:176](../../apps/web/src/pages/fx/FxLockSection.tsx#L176) |
| `FxLockSection.ad4b7d25` | 写死 | 发起锁定汇率 | 标题 | [FxLockSection.tsx:176](../../apps/web/src/pages/fx/FxLockSection.tsx#L176) |
| `FxLockSection.394eb240` | 写死 | 取消 | 按钮 | [FxLockSection.tsx:183](../../apps/web/src/pages/fx/FxLockSection.tsx#L183)、271 行 |
| `FxLockSection.38015560` | 写死 | 提交中… | 文字 | [FxLockSection.tsx:184](../../apps/web/src/pages/fx/FxLockSection.tsx#L184)、272 行 |
| `FxLockSection.3a303c27` | 写死 | 提交审核 | 按钮 | [FxLockSection.tsx:186](../../apps/web/src/pages/fx/FxLockSection.tsx#L186)、274 行 |
| `FxLockSection.8758ad70` | 写死 | 提交后不会立即生效：要另一位有审核权限的同事在「待审核」里批准。 | 正文 | [FxLockSection.tsx:191](../../apps/web/src/pages/fx/FxLockSection.tsx#L191) |
| `FxLockSection.6995edb0` | 写死 | 正在取中央汇率… | 正文 | [FxLockSection.tsx:202](../../apps/web/src/pages/fx/FxLockSection.tsx#L202) |
| `FxLockSection.89884cf9` | 写死 | 现在的中央汇率：1 USD = {central} {currency} | 正文 | [FxLockSection.tsx:202](../../apps/web/src/pages/fx/FxLockSection.tsx#L202) |
| `FxLockSection.e354fb78` | 写死 | ；现在锁定在 {rate}，到 {…}，批准后新的取代它 | 正文 | [FxLockSection.tsx:203](../../apps/web/src/pages/fx/FxLockSection.tsx#L203) |
| `FxLockSection.a2c52624` | 写死 | 锁定值（1 USD = ? {currency}） | 名称 | [FxLockSection.tsx:206](../../apps/web/src/pages/fx/FxLockSection.tsx#L206) |
| `FxLockSection.4727fa09` | 写死 | 和中央汇率相差 {…} | 说明 | [FxLockSection.tsx:211](../../apps/web/src/pages/fx/FxLockSection.tsx#L211) |
| `FxLockSection.cc633fac` | 写死 | 十进制数，如 151.2 | 说明 | [FxLockSection.tsx:211](../../apps/web/src/pages/fx/FxLockSection.tsx#L211) |
| `FxLockSection.5af20eb6` | 写死 | 锁定多久 | 名称 | [FxLockSection.tsx:219](../../apps/web/src/pages/fx/FxLockSection.tsx#L219) |
| `FxLockSection.9196de19` | 写死 | 请选择 | 输入框占位 | [FxLockSection.tsx:220](../../apps/web/src/pages/fx/FxLockSection.tsx#L220) |
| `FxLockSection.6e8aeebd` | 写死 | {value} 小时 | 名称 | [FxLockSection.tsx:222](../../apps/web/src/pages/fx/FxLockSection.tsx#L222) |
| `FxLockSection.088ce658` | 写死 | 最长 {max\_hours} 小时。选好后这里显示到期时间。 | 正文 | [FxLockSection.tsx:226](../../apps/web/src/pages/fx/FxLockSection.tsx#L226) |
| `FxLockSection.773322c8` | 写死 | 到 {…} 自动失效（从提交时算起；批准得晚，剩下的时间就短）。 | 正文 | [FxLockSection.tsx:226](../../apps/web/src/pages/fx/FxLockSection.tsx#L226) |
| `FxLockSection.4258b10c` | 写死 | 原因（必填） | 名称 | [FxLockSection.tsx:228](../../apps/web/src/pages/fx/FxLockSection.tsx#L228) |
| `FxLockSection.15226ea9` | 写死 | 和中央汇率相差超过 {…}% 时必填；超过 {…}% 不允许 | 说明 | [FxLockSection.tsx:233](../../apps/web/src/pages/fx/FxLockSection.tsx#L233) |
| `FxLockSection.179ca623` | 写死 | 解除 {currency} 的锁定？ | 标题 | [FxLockSection.tsx:264](../../apps/web/src/pages/fx/FxLockSection.tsx#L264) |
| `FxLockSection.12a7fcd3` | 写死 | 现在锁定在 1 USD = {rate} {currency}，原定到 {…}。另一位同事批准后恢复用数据源的汇率。 | 正文 | [FxLockSection.tsx:279](../../apps/web/src/pages/fx/FxLockSection.tsx#L279) |
| `FxLockSection.ea59f5b7` | 写死 | 原因（选填） | 名称 | [FxLockSection.tsx:280](../../apps/web/src/pages/fx/FxLockSection.tsx#L280) |
| `FxLockSection.3c7095ab` | 写死 | 生效 — 到期 | 文字 | [FxLockSection.tsx:290](../../apps/web/src/pages/fx/FxLockSection.tsx#L290) |
| `FxLockSection.7270b1d5` | 写死 | 状态 | 文字 | [FxLockSection.tsx:291](../../apps/web/src/pages/fx/FxLockSection.tsx#L291) |
| `FxLockSection.0971ad19` | 写死 | 经手 | 文字 | [FxLockSection.tsx:294](../../apps/web/src/pages/fx/FxLockSection.tsx#L294) |
| `FxLockSection.31d7518d` | 写死 | ；{name} 批准{…} | 文字 | [FxLockSection.tsx:296](../../apps/web/src/pages/fx/FxLockSection.tsx#L296) |
| `FxLockSection.38a4fb52` | 写死 | 取代 | 文字 | [FxLockSection.tsx:296](../../apps/web/src/pages/fx/FxLockSection.tsx#L296) |
| `FxLockSection.c0524414` | 写死 | {name} 发起，{name} 批准{…}{…} | 文字 | [FxLockSection.tsx:296](../../apps/web/src/pages/fx/FxLockSection.tsx#L296) |
| `FxLockSection.c8ce5a20` | 写死 | 锁定记录表 | 名称 | [FxLockSection.tsx:299](../../apps/web/src/pages/fx/FxLockSection.tsx#L299) |
| `FxLockSection.f6d9530d` | 写死 | 还没有锁定过汇率 | 标题 | [FxLockSection.tsx:299](../../apps/web/src/pages/fx/FxLockSection.tsx#L299) |
| `FxRatesPage.60dc228b` | 写死 | 汇率已更新 | 文字 | [FxRatesPage.tsx:34](../../apps/web/src/pages/fx/FxRatesPage.tsx#L34) |
| `FxRatesPage.a9b8f047` | 写死 | 数据源还没有更新，汇率不变 | 文字 | [FxRatesPage.tsx:36](../../apps/web/src/pages/fx/FxRatesPage.tsx#L36) |
| `FxRatesPage.73e7f1fe` | 写死 | 这批汇率变动超过 3%，已挂起，确认后才生效 | 文字 | [FxRatesPage.tsx:38](../../apps/web/src/pages/fx/FxRatesPage.tsx#L38) |
| `FxRatesPage.310681cf` | 写死 | 原因不明 | 文字 | [FxRatesPage.tsx:40](../../apps/web/src/pages/fx/FxRatesPage.tsx#L40) |
| `FxRatesPage.34a54d97` | 写死 | 没有拉到汇率：{…}。继续用最近一次的汇率 | 文字 | [FxRatesPage.tsx:40](../../apps/web/src/pages/fx/FxRatesPage.tsx#L40) |
| `FxRatesPage.f6d5558e` | 写死 | （用了人工锁定的汇率） | 正文 | [FxRatesPage.tsx:51](../../apps/web/src/pages/fx/FxRatesPage.tsx#L51) |
| `FxRatesPage.607ab340` | 写死 | 现在显示的是完整数值（报价用的就是它）。 | 正文 | [FxRatesPage.tsx:62](../../apps/web/src/pages/fx/FxRatesPage.tsx#L62) |
| `FxRatesPage.8ec7c22b` | 写死 | 表里是四舍五入后的值：1 以上保留 4 位小数，不到 1 保留 6 位有效数字。 | 正文 | [FxRatesPage.tsx:62](../../apps/web/src/pages/fx/FxRatesPage.tsx#L62) |
| `FxRatesPage.64b2db1d` | 写死 | 显示四舍五入后的 | 按钮 | [FxRatesPage.tsx:64](../../apps/web/src/pages/fx/FxRatesPage.tsx#L64) |
| `FxRatesPage.ca3565a4` | 写死 | 显示完整数值 | 按钮 | [FxRatesPage.tsx:64](../../apps/web/src/pages/fx/FxRatesPage.tsx#L64) |
| `FxRatesPage.88c32811` | 写死 | 汇率 · NOZOMI 运营后台 | 浏览器标题 | [FxRatesPage.tsx:72](../../apps/web/src/pages/fx/FxRatesPage.tsx#L72) |
| `FxRatesPage.1de2050e` | 写死 | 正在拉取汇率（定时任务或其他同事），稍后刷新看结果 | 文字 | [FxRatesPage.tsx:93](../../apps/web/src/pages/fx/FxRatesPage.tsx#L93) |
| `FxRatesPage.de3c6b48` | 写死 | 这批汇率已经处理过，或已被更新的一批取代。页面已刷新 | 文字 | [FxRatesPage.tsx:94](../../apps/web/src/pages/fx/FxRatesPage.tsx#L94) |
| `FxRatesPage.2df69378` | 写死 | 当前角色没有这个操作的权限 | 文字 | [FxRatesPage.tsx:95](../../apps/web/src/pages/fx/FxRatesPage.tsx#L95) |
| `FxRatesPage.3d667707` | 写死 | 网络连接失败，请重试 | 文字 | [FxRatesPage.tsx:96](../../apps/web/src/pages/fx/FxRatesPage.tsx#L96) |
| `FxRatesPage.c0c07120` | 写死 | 操作没有成功，请稍后重试 | 文字 | [FxRatesPage.tsx:96](../../apps/web/src/pages/fx/FxRatesPage.tsx#L96) |
| `FxRatesPage.10746ddc` | 写死 | 这批汇率已确认生效 | 文字 | [FxRatesPage.tsx:116](../../apps/web/src/pages/fx/FxRatesPage.tsx#L116) |
| `FxRatesPage.775b861f` | 写死 | 已放弃这批汇率，继续用现在的汇率 | 文字 | [FxRatesPage.tsx:116](../../apps/web/src/pages/fx/FxRatesPage.tsx#L116) |
| `FxRatesPage.173dadab` | 写死 | 汇率 | 名称 | [FxRatesPage.tsx:135](../../apps/web/src/pages/fx/FxRatesPage.tsx#L135)、137 行 |
| `FxRatesPage.e296327a` | 写死 | 主数据 | 名称 | [FxRatesPage.tsx:135](../../apps/web/src/pages/fx/FxRatesPage.tsx#L135) |
| `FxRatesPage.44246544` | 写死 | 正在拉取… | 文字 | [FxRatesPage.tsx:140](../../apps/web/src/pages/fx/FxRatesPage.tsx#L140) |
| `FxRatesPage.c5dbd128` | 写死 | 立即拉取 | 按钮 | [FxRatesPage.tsx:142](../../apps/web/src/pages/fx/FxRatesPage.tsx#L142) |
| `FxRatesPage.06dc9f24` | 写死 | 你没有权限查看这里 | 标题 | [FxRatesPage.tsx:155](../../apps/web/src/pages/fx/FxRatesPage.tsx#L155) |
| `FxRatesPage.19349c30` | 写死 | 加载失败 | 标题 | [FxRatesPage.tsx:155](../../apps/web/src/pages/fx/FxRatesPage.tsx#L155) |
| `FxRatesPage.4b8e2b01` | 写死 | 请检查网络后重试。 | 说明 | [FxRatesPage.tsx:156](../../apps/web/src/pages/fx/FxRatesPage.tsx#L156) |
| `FxRatesPage.dd51c97b` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [FxRatesPage.tsx:156](../../apps/web/src/pages/fx/FxRatesPage.tsx#L156) |
| `FxRatesPage.54a4c19f` | 写死 | 重试 | 按钮 | [FxRatesPage.tsx:161](../../apps/web/src/pages/fx/FxRatesPage.tsx#L161)、443 行 |
| `FxRatesPage.a8f548d6` | 写死 | 汇率超过 {max\_age\_hours} 小时没有更新，跨币种报价已暂停 | 正文 | [FxRatesPage.tsx:171](../../apps/web/src/pages/fx/FxRatesPage.tsx#L171) |
| `FxRatesPage.20ff24fc` | 写死 | 请联系主数据运营处理。 | 正文 | [FxRatesPage.tsx:173](../../apps/web/src/pages/fx/FxRatesPage.tsx#L173) |
| `FxRatesPage.8d32b8e0` | 写死 | 现在这批是 {…} 的。{…}{…} | 正文 | [FxRatesPage.tsx:173](../../apps/web/src/pages/fx/FxRatesPage.tsx#L173) |
| `FxRatesPage.b92a482a` | 写死 | 请检查数据源，或点「立即拉取」。 | 正文 | [FxRatesPage.tsx:173](../../apps/web/src/pages/fx/FxRatesPage.tsx#L173) |
| `FxRatesPage.378316c6` | 写死 | 人工锁定的币种（{…}）和美元之间照常报价。 | 正文 | [FxRatesPage.tsx:174](../../apps/web/src/pages/fx/FxRatesPage.tsx#L174) |
| `FxRatesPage.da445d25` | 写死 | 还没有汇率：跨币种的报价都报不出 | 正文 | [FxRatesPage.tsx:180](../../apps/web/src/pages/fx/FxRatesPage.tsx#L180) |
| `FxRatesPage.2f5023c0` | 写死 | 系统会按数据源的更新频率自动拉取。 | 正文 | [FxRatesPage.tsx:181](../../apps/web/src/pages/fx/FxRatesPage.tsx#L181) |
| `FxRatesPage.5babfa71` | 写死 | 定时拉取没有打开。 | 正文 | [FxRatesPage.tsx:181](../../apps/web/src/pages/fx/FxRatesPage.tsx#L181) |
| `FxRatesPage.d498af8d` | 写死 | 也可以点「立即拉取」。 | 正文 | [FxRatesPage.tsx:181](../../apps/web/src/pages/fx/FxRatesPage.tsx#L181) |
| `FxRatesPage.8f3c2572` | 写死 | 有一批汇率变动超过 {…}%，等待确认 | 标题 | [FxRatesPage.tsx:188](../../apps/web/src/pages/fx/FxRatesPage.tsx#L188) |
| `FxRatesPage.0db3d2c9` | 写死 | 数据源 {…} 的这批没有生效，报价还在用 {…} 的汇率。请核对后确认或放弃。 | 正文 | [FxRatesPage.tsx:192](../../apps/web/src/pages/fx/FxRatesPage.tsx#L192) |
| `FxRatesPage.31d112fb` | 写死 | 1 USD = {…} → {…}（{…}） | 正文 | [FxRatesPage.tsx:200](../../apps/web/src/pages/fx/FxRatesPage.tsx#L200) |
| `FxRatesPage.a37691df` | 写死 | 确认生效 | 按钮 | [FxRatesPage.tsx:209](../../apps/web/src/pages/fx/FxRatesPage.tsx#L209)、226 行 |
| `FxRatesPage.e201fcfd` | 写死 | 放弃这批 | 按钮 | [FxRatesPage.tsx:212](../../apps/web/src/pages/fx/FxRatesPage.tsx#L212) |
| `FxRatesPage.4e55d9ee` | 写死 | 放弃这批汇率？ | 标题 | [FxRatesPage.tsx:217](../../apps/web/src/pages/fx/FxRatesPage.tsx#L217) |
| `FxRatesPage.56ca793f` | 写死 | 确认这批汇率生效？ | 标题 | [FxRatesPage.tsx:217](../../apps/web/src/pages/fx/FxRatesPage.tsx#L217) |
| `FxRatesPage.6b31b6ee` | 写死 | 取消 | 按钮 | [FxRatesPage.tsx:224](../../apps/web/src/pages/fx/FxRatesPage.tsx#L224) |
| `FxRatesPage.cb403382` | 写死 | 正在提交… | 文字 | [FxRatesPage.tsx:225](../../apps/web/src/pages/fx/FxRatesPage.tsx#L225) |
| `FxRatesPage.9ca9867d` | 写死 | 放弃 | 按钮 | [FxRatesPage.tsx:226](../../apps/web/src/pages/fx/FxRatesPage.tsx#L226)、427 行 |
| `FxRatesPage.015cca82` | 写死 | 放弃后继续用现在的汇率；它照常会在没有更新 48 小时后过期。 | 正文 | [FxRatesPage.tsx:231](../../apps/web/src/pages/fx/FxRatesPage.tsx#L231) |
| `FxRatesPage.6d5a5a5c` | 写死 | 确认后立即用于新的报价；已经生成的报价快照不受影响。 | 正文 | [FxRatesPage.tsx:231](../../apps/web/src/pages/fx/FxRatesPage.tsx#L231) |
| `FxRatesPage.9018f578` | 写死 | 数据源 | 标题 | [FxRatesPage.tsx:249](../../apps/web/src/pages/fx/FxRatesPage.tsx#L249)、266 行 |
| `FxRatesPage.38976a5c` | 写死 | 这批汇率的时间 | 正文 | [FxRatesPage.tsx:254](../../apps/web/src/pages/fx/FxRatesPage.tsx#L254) |
| `FxRatesPage.d798b4a8` | 写死 | 拉到的时间 | 正文 | [FxRatesPage.tsx:258](../../apps/web/src/pages/fx/FxRatesPage.tsx#L258) |
| `FxRatesPage.64a01aa5` | 写死 | 过期时间（之后暂停跨币种报价） | 正文 | [FxRatesPage.tsx:262](../../apps/web/src/pages/fx/FxRatesPage.tsx#L262) |
| `FxRatesPage.c477cfb8` | 写死 | 最近一次拉取 | 正文 | [FxRatesPage.tsx:270](../../apps/web/src/pages/fx/FxRatesPage.tsx#L270) |
| `FxRatesPage.f215b7c5` | 写死 | 还没有拉过 | 正文 | [FxRatesPage.tsx:273](../../apps/web/src/pages/fx/FxRatesPage.tsx#L273) |
| `FxRatesPage.f29b9c04` | 写死 | 下次自动拉取 | 正文 | [FxRatesPage.tsx:284](../../apps/web/src/pages/fx/FxRatesPage.tsx#L284) |
| `FxRatesPage.7d89b1b9` | 写死 | 没有打开定时拉取 | 正文 | [FxRatesPage.tsx:285](../../apps/web/src/pages/fx/FxRatesPage.tsx#L285) |
| `FxRatesPage.e73f28c8` | 写死 | 当前汇率 | 标题 | [FxRatesPage.tsx:294](../../apps/web/src/pages/fx/FxRatesPage.tsx#L294) |
| `FxRatesPage.f494fecc` | 写死 | 基准币种 | 名称 | [FxRatesPage.tsx:295](../../apps/web/src/pages/fx/FxRatesPage.tsx#L295) |
| `FxRatesPage.187ca5e8` | 写死 | 标 \* 的是人工锁定的值，报价用的就是它；右边一列是数据源的中央汇率（照常更新，锁定期间不用于这个币种）。 | 正文 | [FxRatesPage.tsx:299](../../apps/web/src/pages/fx/FxRatesPage.tsx#L299) |
| `FxRatesPage.ba470523` | 写死 | 当前汇率表 | 读屏说明 | [FxRatesPage.tsx:301](../../apps/web/src/pages/fx/FxRatesPage.tsx#L301) |
| `FxRatesPage.bada4ae4` | 写死 | 币种 | 表头 | [FxRatesPage.tsx:305](../../apps/web/src/pages/fx/FxRatesPage.tsx#L305)、384 行 |
| `FxRatesPage.e6d6c0c6` | 写死 | 数据源（中央汇率） | 表头 | [FxRatesPage.tsx:312](../../apps/web/src/pages/fx/FxRatesPage.tsx#L312) |
| `FxRatesPage.f478d717` | 写死 | 常用币种互换 | 标题 | [FxRatesPage.tsx:344](../../apps/web/src/pages/fx/FxRatesPage.tsx#L344) |
| `FxRatesPage.3edd3b80` | 写死 | （中央汇率） | 正文 | [FxRatesPage.tsx:346](../../apps/web/src/pages/fx/FxRatesPage.tsx#L346) |
| `FxRatesPage.7ceef6ae` | 写死 | 每行是「1 个该行币种 = 多少个该列币种」。这里是报价用的汇率{…}，不含缓冲；报价时跨币种另加汇率缓冲（比例见「系统状态」里的汇率数据源）。 | 正文 | [FxRatesPage.tsx:346](../../apps/web/src/pages/fx/FxRatesPage.tsx#L346) |
| `FxRatesPage.fdd0acb7` | 写死 | （标 \* 的用到了人工锁定的值） | 正文 | [FxRatesPage.tsx:346](../../apps/web/src/pages/fx/FxRatesPage.tsx#L346) |
| `FxRatesPage.bc4569fe` | 写死 | 币种互换表 | 读屏说明 | [FxRatesPage.tsx:350](../../apps/web/src/pages/fx/FxRatesPage.tsx#L350) |
| `FxRatesPage.b833a78f` | 写死 | 1 个 | 表头 | [FxRatesPage.tsx:354](../../apps/web/src/pages/fx/FxRatesPage.tsx#L354) |
| `FxRatesPage.66f00e18` | 写死 | 近 30 天走势 | 标题 | [FxRatesPage.tsx:383](../../apps/web/src/pages/fx/FxRatesPage.tsx#L383) |
| `FxRatesPage.fb7818ba` | 写死 | 最近的拉取记录 | 标题 | [FxRatesPage.tsx:392](../../apps/web/src/pages/fx/FxRatesPage.tsx#L392) |
| `FxRatesPage.841e84bb` | 写死 | 拉取记录表 | 名称 | [FxRatesPage.tsx:394](../../apps/web/src/pages/fx/FxRatesPage.tsx#L394) |
| `FxRatesPage.076d7379` | 写死 | 还没有拉过汇率 | 标题 | [FxRatesPage.tsx:401](../../apps/web/src/pages/fx/FxRatesPage.tsx#L401) |
| `FxRatesPage.ab513b1c` | 写死 | 锁定记录 | 标题 | [FxRatesPage.tsx:408](../../apps/web/src/pages/fx/FxRatesPage.tsx#L408) |
| `FxRatesPage.ada9659b` | 写死 | 时间 | 文字 | [FxRatesPage.tsx:423](../../apps/web/src/pages/fx/FxRatesPage.tsx#L423) |
| `FxRatesPage.a80f19f7` | 写死 | 方式 | 文字 | [FxRatesPage.tsx:424](../../apps/web/src/pages/fx/FxRatesPage.tsx#L424) |
| `FxRatesPage.da496b7b` | 写死 | 结果 | 文字 | [FxRatesPage.tsx:425](../../apps/web/src/pages/fx/FxRatesPage.tsx#L425) |
| `FxRatesPage.5ef2dfa6` | 写死 | 数据源的时间 | 文字 | [FxRatesPage.tsx:426](../../apps/web/src/pages/fx/FxRatesPage.tsx#L426) |
| `FxRatesPage.519663db` | 写死 | 确认 | 文字 | [FxRatesPage.tsx:427](../../apps/web/src/pages/fx/FxRatesPage.tsx#L427) |
| `FxRatesPage.fa64325a` | 写死 | 说明 | 文字 | [FxRatesPage.tsx:427](../../apps/web/src/pages/fx/FxRatesPage.tsx#L427) |
| `FxRatesPage.886cab0d` | 写死 | 走势没有加载出来 | 标题 | [FxRatesPage.tsx:439](../../apps/web/src/pages/fx/FxRatesPage.tsx#L439) |
| `FxRatesPage.97b11f07` | 写死 | 近 30 天还没有汇率 | 标题 | [FxRatesPage.tsx:448](../../apps/web/src/pages/fx/FxRatesPage.tsx#L448) |
| `FxRatesPage.608e751f` | 写死 | 近 30 天 1 {base} 兑 {…}：最低 {…}，最高 {…}，最新 {…}（{length} 个点） | 说明 | [FxRatesPage.tsx:450](../../apps/web/src/pages/fx/FxRatesPage.tsx#L450) |
| `FxRatesPage.7ba7316e` | 写死 | 最低 {…} · 最高 {…} · 最新 {…} | 正文 | [FxRatesPage.tsx:465](../../apps/web/src/pages/fx/FxRatesPage.tsx#L465) |

## 多个页面共用：组合框的多选（MultiCombobox.tsx）

用在：运营后台 · 渠道；运营后台 · 账号安全和角色

文件：`apps/web/src/components/MultiCombobox.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `MultiCombobox.55e3a181` | 写死 | （已不可选） | 文字 | [MultiCombobox.tsx:27](../../apps/web/src/components/MultiCombobox.tsx#L27) |
| `MultiCombobox.bf4d2c07` | 写死 | 都已经选上了 | 文字 | [MultiCombobox.tsx:27](../../apps/web/src/components/MultiCombobox.tsx#L27) |
| `MultiCombobox.ceeba76f` | 写死 | 已去掉「{…}」，还选着 {length} 个 | 提示 | [MultiCombobox.tsx:36](../../apps/web/src/components/MultiCombobox.tsx#L36) |
| `MultiCombobox.9e16a8ca` | 写死 | 没有可选的 | 空状态 | [MultiCombobox.tsx:55](../../apps/web/src/components/MultiCombobox.tsx#L55) |
| `MultiCombobox.a863282b` | 写死 | 已选上「{…}」，共 {…} 个 | 提示 | [MultiCombobox.tsx:59](../../apps/web/src/components/MultiCombobox.tsx#L59) |
| `MultiCombobox.816591e9` | 写死 | 还没有选{label} | 正文 | [MultiCombobox.tsx:63](../../apps/web/src/components/MultiCombobox.tsx#L63) |
| `MultiCombobox.5946180b` | 写死 | 已选的{label}（{length} 个） | 读屏说明 | [MultiCombobox.tsx:65](../../apps/web/src/components/MultiCombobox.tsx#L65) |
| `MultiCombobox.f9cd8d65` | 写死 | 去掉 {…} | 读屏说明 | [MultiCombobox.tsx:69](../../apps/web/src/components/MultiCombobox.tsx#L69) |

## 多个页面共用：一次性链接（OneTimeLinkDialog.tsx）

用在：运营后台 · 供应商（列表、新建、详情）；运营后台 · 平台员工

文件：`apps/web/src/components/OneTimeLinkDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OneTimeLinkDialog.3f7864fe` | 写死 | 邀请链接 | 名称 | [OneTimeLinkDialog.tsx:38](../../apps/web/src/components/OneTimeLinkDialog.tsx#L38) |
| `OneTimeLinkDialog.6324b87b` | 写死 | 密码重置链接 | 名称 | [OneTimeLinkDialog.tsx:38](../../apps/web/src/components/OneTimeLinkDialog.tsx#L38) |
| `OneTimeLinkDialog.4424ae27` | 写死 | 链接已复制 | 提示 | [OneTimeLinkDialog.tsx:59](../../apps/web/src/components/OneTimeLinkDialog.tsx#L59) |
| `OneTimeLinkDialog.d2510f24` | 写死 | 链接和说明已复制 | 提示 | [OneTimeLinkDialog.tsx:59](../../apps/web/src/components/OneTimeLinkDialog.tsx#L59) |
| `OneTimeLinkDialog.382d49c7` | 写死 | {label}（只显示这一次） | 标题 | [OneTimeLinkDialog.tsx:77](../../apps/web/src/components/OneTimeLinkDialog.tsx#L77) |
| `OneTimeLinkDialog.f72746ae` | 写死 | 还没有复制过这条链接。关闭以后无法再看到，只能重新发起。 | 正文 | [OneTimeLinkDialog.tsx:85](../../apps/web/src/components/OneTimeLinkDialog.tsx#L85) |
| `OneTimeLinkDialog.7f1b74de` | 写死 | 仍然关闭 | 按钮 | [OneTimeLinkDialog.tsx:89](../../apps/web/src/components/OneTimeLinkDialog.tsx#L89) |
| `OneTimeLinkDialog.6330e344` | 写死 | 回去复制 | 按钮 | [OneTimeLinkDialog.tsx:92](../../apps/web/src/components/OneTimeLinkDialog.tsx#L92) |
| `OneTimeLinkDialog.1758d01f` | 写死 | 我已经发给对方，关闭 | 按钮 | [OneTimeLinkDialog.tsx:104](../../apps/web/src/components/OneTimeLinkDialog.tsx#L104) |
| `OneTimeLinkDialog.6d045e11` | 写死 | 这个对话框只能用最下面的按钮关闭。 | 正文 | [OneTimeLinkDialog.tsx:108](../../apps/web/src/components/OneTimeLinkDialog.tsx#L108) |
| `OneTimeLinkDialog.65727068` | 写死 | 给 | 正文 | [OneTimeLinkDialog.tsx:110](../../apps/web/src/components/OneTimeLinkDialog.tsx#L110) |
| `OneTimeLinkDialog.d03ae2dc` | 写死 | 已复制 | 正文 | [OneTimeLinkDialog.tsx:132](../../apps/web/src/components/OneTimeLinkDialog.tsx#L132)、142 行 |
| `OneTimeLinkDialog.2f5cbb6b` | 写死 | 复制链接 | 按钮 | [OneTimeLinkDialog.tsx:134](../../apps/web/src/components/OneTimeLinkDialog.tsx#L134) |
| `OneTimeLinkDialog.9eb1591b` | 写死 | 复制链接和说明 | 按钮 | [OneTimeLinkDialog.tsx:144](../../apps/web/src/components/OneTimeLinkDialog.tsx#L144) |
| `OneTimeLinkDialog.ea604e97` | 写死 | 没有复制成功。链接已经选中，请按 Ctrl + C（Mac 上是 ⌘ + C）复制。 | 正文 | [OneTimeLinkDialog.tsx:151](../../apps/web/src/components/OneTimeLinkDialog.tsx#L151) |
| `OneTimeLinkDialog.acbabb12` | 写死 | 系统不会发邮件。 | 正文 | [OneTimeLinkDialog.tsx:154](../../apps/web/src/components/OneTimeLinkDialog.tsx#L154) |
| `OneTimeLinkDialog.dbb38593` | 写死 | 请你自己把链接发给对方本人（邮件、LINE、企业微信等你们平时用的方式）。 | 正文 | [OneTimeLinkDialog.tsx:155](../../apps/web/src/components/OneTimeLinkDialog.tsx#L155) |
| `OneTimeLinkDialog.ff841c1f` | 写死 | 拿到链接的人就能给这个账号设密码并登录{name}，不要发到群里。 | 正文 | [OneTimeLinkDialog.tsx:160](../../apps/web/src/components/OneTimeLinkDialog.tsx#L160) |
| `OneTimeLinkDialog.8ef0fe95` | 写死 | 关闭以后无法再看到这条链接。对方没收到或过期了，可以重新发起，旧链接会作废。 | 正文 | [OneTimeLinkDialog.tsx:161](../../apps/web/src/components/OneTimeLinkDialog.tsx#L161) |
| `OneTimeLinkDialog.d03937bb` | 写死 | 发出链接不会改掉对方现在的密码；对方用它设了新密码以后，旧密码才失效，他在所有设备上都要重新登录。 | 正文 | [OneTimeLinkDialog.tsx:164](../../apps/web/src/components/OneTimeLinkDialog.tsx#L164) |
| `OneTimeLinkDialog.35aaf306` | 写死 | 再发一次会让这条链接作废。 | 正文 | [OneTimeLinkDialog.tsx:165](../../apps/web/src/components/OneTimeLinkDialog.tsx#L165) |
| `OneTimeLinkDialog.59f91803` | 写死 | 请检查网络后再试一次。如果其实已经成功了，再试一次会发出一条新的链接，之前那条作废——没有影响，因为它还没有交到任何人手里。 | 文字 | [OneTimeLinkDialog.tsx:174](../../apps/web/src/components/OneTimeLinkDialog.tsx#L174) |
