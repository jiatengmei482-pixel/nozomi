# 供应商后台（第 1 / 2 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 3295 条：写死 3295 条，已走 key 0 条。列的意思见 [README](README.md)。

本区域分 2 份：第 1 份 · [第 2 份](tenant-2.md)

## 页面

- [首页](#首页)（47 条）
- [区域列表](#区域列表)（38 条）
- [区域编辑](#区域编辑)（239 条）
- [区域地图（运营后台也用）](#区域地图运营后台也用)（73 条）
- [商品列表](#商品列表)（43 条）
- [商品编辑](#商品编辑)（27 条）
- [价格规则总览](#价格规则总览)（48 条）
- [订单（列表、详情）](#订单列表详情)（189 条）
- [救援单和扣款](#救援单和扣款)（68 条）
- [司机和车辆](#司机和车辆)（85 条）
- [Webhook 设置（运营后台的推送记录也在这里）](#webhook-设置运营后台的推送记录也在这里)（65 条）
- [通知（运营后台的通知中心、通知模板也在这里）](#通知运营后台的通知中心通知模板也在这里)（73 条）
- [公司](#公司)（80 条）
- [企业信息](#企业信息)（41 条）
- [服务表现](#服务表现)（8 条）
- [工单](#工单)（83 条）
- [账单](#账单)（61 条）
- [收款账户](#收款账户)（46 条）
- [多个页面共用：区域在商品里当哪一层（area-layers.ts）](#多个页面共用区域在商品里当哪一层area-layersts)（23 条）
- [多个页面共用：区域编辑器的地图画布（AreaMap.tsx）](#多个页面共用区域编辑器的地图画布areamaptsx)（27 条）
- [多个页面共用：「在地图上查看」（AreaMapDialog.tsx）](#多个页面共用在地图上查看areamapdialogtsx)（18 条）
- [多个页面共用：区域地图的画布（AreaOverviewMap.tsx）](#多个页面共用区域地图的画布areaoverviewmaptsx)（21 条）
- [多个页面共用：自测（SelfTest.tsx）](#多个页面共用自测selftesttsx)（22 条）
- [多个页面共用：从区域共享库引用（SharedAreaDialog.tsx）](#多个页面共用从区域共享库引用sharedareadialogtsx)（35 条）
- [多个页面共用：共享库里一个区域的形状预览（SharedAreaPreview.tsx）](#多个页面共用共享库里一个区域的形状预览sharedareapreviewtsx)（10 条）
- [多个页面共用：区域的停用（useAreaActions.tsx）](#多个页面共用区域的停用useareaactionstsx)（26 条）
- [多个页面共用：履约评分（PerformanceView.tsx）](#多个页面共用履约评分performanceviewtsx)（30 条）
- [多个页面共用：订单的一张证据照片（EvidencePhoto.tsx）](#多个页面共用订单的一张证据照片evidencephototsx)（9 条）
- [多个页面共用：① 基础信息（BasicStep.tsx）](#多个页面共用①-基础信息basicsteptsx)（141 条）
- [多个页面共用：新建子品牌（BrandDialog.tsx）](#多个页面共用新建子品牌branddialogtsx)（17 条）

## 首页

文件：`apps/web/src/pages/HomePage.tsx`、`apps/web/src/pages/orders/OrderTodos.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `HomePage.e5cff651` | 写死 | 首页 · NOZOMI {name} | 浏览器标题 | [HomePage.tsx:32](../../apps/web/src/pages/HomePage.tsx#L32) |
| `HomePage.3693faae` | 写死 | 已上架 | 名称 | [HomePage.tsx:44](../../apps/web/src/pages/HomePage.tsx#L44) |
| `HomePage.7f0319bc` | 写死 | 草稿 | 名称 | [HomePage.tsx:44](../../apps/web/src/pages/HomePage.tsx#L44) |
| `HomePage.f564902d` | 写死 | 已下架 | 名称 | [HomePage.tsx:44](../../apps/web/src/pages/HomePage.tsx#L44) |
| `HomePage.0f26baf5` | 写死 | 已设价格 | 名称 | [HomePage.tsx:53](../../apps/web/src/pages/HomePage.tsx#L53) |
| `HomePage.1c13044a` | 写死 | 还没有设 | 名称 | [HomePage.tsx:53](../../apps/web/src/pages/HomePage.tsx#L53) |
| `HomePage.3b55f5b2` | 写死 | 已停用 | 名称 | [HomePage.tsx:63](../../apps/web/src/pages/HomePage.tsx#L63) |
| `HomePage.e1b4b06e` | 写死 | 启用 | 名称 | [HomePage.tsx:63](../../apps/web/src/pages/HomePage.tsx#L63) |
| `HomePage.9fd2d7b7` | 写死 | 首页 | 名称 | [HomePage.tsx:82](../../apps/web/src/pages/HomePage.tsx#L82)、84 行 |
| `HomePage.2c3e61bc` | 写死 | 数量没有加载出来 | 正文 | [HomePage.tsx:101](../../apps/web/src/pages/HomePage.tsx#L101) |
| `HomePage.1cb92910` | 写死 | 入口可以照常使用。请检查网络后重试。 | 正文 | [HomePage.tsx:102](../../apps/web/src/pages/HomePage.tsx#L102) |
| `HomePage.4ac4ccbc` | 写死 | 重试 | 按钮 | [HomePage.tsx:105](../../apps/web/src/pages/HomePage.tsx#L105)、171 行 |
| `HomePage.7ae0e9a2` | 写死 | 商品配置 | 标题 | [HomePage.tsx:120](../../apps/web/src/pages/HomePage.tsx#L120) |
| `HomePage.65226616` | 写死 | 区域 | 标题 | [HomePage.tsx:122](../../apps/web/src/pages/HomePage.tsx#L122) |
| `HomePage.cf58a908` | 写死 | 还没有区域，先建一个 | 文字 | [HomePage.tsx:122](../../apps/web/src/pages/HomePage.tsx#L122) |
| `HomePage.18ad69fd` | 写死 | {…} 个商品还没有上架 | 文字 | [HomePage.tsx:123](../../apps/web/src/pages/HomePage.tsx#L123) |
| `HomePage.a4adceac` | 写死 | 还没有商品，先建一个 | 文字 | [HomePage.tsx:123](../../apps/web/src/pages/HomePage.tsx#L123) |
| `HomePage.b69bbe7e` | 写死 | {…} 个已上架的商品从今天起没有库存 | 文字 | [HomePage.tsx:123](../../apps/web/src/pages/HomePage.tsx#L123) |
| `HomePage.d697415b` | 写死 | 商品 | 标题 | [HomePage.tsx:123](../../apps/web/src/pages/HomePage.tsx#L123) |
| `HomePage.22d98e05` | 写死 | {…} 个商品还没有设价格 | 文字 | [HomePage.tsx:124](../../apps/web/src/pages/HomePage.tsx#L124) |
| `HomePage.4a7b40d6` | 写死 | {…} 个已上架的商品已经没有可用的价格 | 文字 | [HomePage.tsx:124](../../apps/web/src/pages/HomePage.tsx#L124) |
| `HomePage.978c182b` | 写死 | 价格规则 | 标题 | [HomePage.tsx:124](../../apps/web/src/pages/HomePage.tsx#L124) |
| `HomePage.5c204b96` | 写死 | 入驻和评分 | 标题 | [HomePage.tsx:132](../../apps/web/src/pages/HomePage.tsx#L132) |
| `HomePage.28efbe69` | 写死 | 企业资质 | 标题 | [HomePage.tsx:136](../../apps/web/src/pages/HomePage.tsx#L136) |
| `HomePage.f2a5a557` | 写死 | 填企业信息、上传资质，交齐后提交审核 | 文字 | [HomePage.tsx:139](../../apps/web/src/pages/HomePage.tsx#L139) |
| `HomePage.202e5ecb` | 写死 | 比价用的分 {…}（近 90 天完成 {completed\_orders} 单） | 文字 | [HomePage.tsx:142](../../apps/web/src/pages/HomePage.tsx#L142) |
| `HomePage.9423b18f` | 写死 | 履约评分 | 标题 | [HomePage.tsx:142](../../apps/web/src/pages/HomePage.tsx#L142) |
| `HomePage.fc82d748` | 写死 | 还没有评分：完成不足 20 单时按默认 4.50 参与比价 | 文字 | [HomePage.tsx:142](../../apps/web/src/pages/HomePage.tsx#L142) |
| `HomePage.8dd66062` | 写死 | 工单和账单 | 标题 | [HomePage.tsx:150](../../apps/web/src/pages/HomePage.tsx#L150) |
| `HomePage.01851cab` | 写死 | 工单 | 标题 | [HomePage.tsx:152](../../apps/web/src/pages/HomePage.tsx#L152) |
| `HomePage.2e5d1ac1` | 写死 | {awaiting} 张工单等你们回复（24 小时内，超时视为认可） | 文字 | [HomePage.tsx:152](../../apps/web/src/pages/HomePage.tsx#L152) |
| `HomePage.520783e9` | 写死 | 没有结论 | 名称 | [HomePage.tsx:152](../../apps/web/src/pages/HomePage.tsx#L152) |
| `HomePage.c4b24455` | 写死 | 等你们回复 | 名称 | [HomePage.tsx:152](../../apps/web/src/pages/HomePage.tsx#L152) |
| `HomePage.26890cbb` | 写死 | 待确认 | 名称 | [HomePage.tsx:153](../../apps/web/src/pages/HomePage.tsx#L153) |
| `HomePage.6c7d90c9` | 写死 | 账单 | 标题 | [HomePage.tsx:153](../../apps/web/src/pages/HomePage.tsx#L153) |
| `HomePage.bc16b6a1` | 写死 | 待付款 | 名称 | [HomePage.tsx:153](../../apps/web/src/pages/HomePage.tsx#L153) |
| `HomePage.f9dc6a94` | 写死 | {toConfirm} 张账单待你们确认 | 文字 | [HomePage.tsx:153](../../apps/web/src/pages/HomePage.tsx#L153) |
| `HomePage.8d1a4077` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [HomePage.tsx:157](../../apps/web/src/pages/HomePage.tsx#L157) |
| `HomePage.9b0e5b6c` | 写死 | 这里暂时没有你可以使用的模块 | 标题 | [HomePage.tsx:157](../../apps/web/src/pages/HomePage.tsx#L157) |
| `HomePage.8dbd4ef9` | 写死 | 加载失败 | 标题 | [HomePage.tsx:166](../../apps/web/src/pages/HomePage.tsx#L166) |
| `HomePage.17b829cf` | 写死 | 请检查网络后重试。 | 说明 | [HomePage.tsx:167](../../apps/web/src/pages/HomePage.tsx#L167) |
| `OrderTodos.a060b407` | 写死 | 标记 | 文字 | [OrderTodos.tsx:28](../../apps/web/src/pages/orders/OrderTodos.tsx#L28) |
| `OrderTodos.ad565aa9` | 写死 | 订单待办（{total}） | 标题 | [OrderTodos.tsx:35](../../apps/web/src/pages/orders/OrderTodos.tsx#L35) |
| `OrderTodos.653bf49a` | 写死 | 有 {change\_requests} 张单的客人申请了修改，等你处理。确认前原预约仍然有效。 | 提示 | [OrderTodos.tsx:38](../../apps/web/src/pages/orders/OrderTodos.tsx#L38) |
| `OrderTodos.60e1a180` | 写死 |  {…}{…}，用车时间 {…} | 正文 | [OrderTodos.tsx:48](../../apps/web/src/pages/orders/OrderTodos.tsx#L48) |
| `OrderTodos.9d536c9d` | 写死 | ，请在 {…} 之前处理 | 正文 | [OrderTodos.tsx:49](../../apps/web/src/pages/orders/OrderTodos.tsx#L49) |
| `OrderTodos.0ba7b0ca` | 写死 | 知道了 | 按钮 | [OrderTodos.tsx:54](../../apps/web/src/pages/orders/OrderTodos.tsx#L54) |

## 区域列表

文件：`apps/web/src/pages/areas/AreaListPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaListPage.d6e8bb52` | 写死 | （已停用） | 名称 | [AreaListPage.tsx:36](../../apps/web/src/pages/areas/AreaListPage.tsx#L36) |
| `AreaListPage.2abf561d` | 写死 | 城市 | 名称 | [AreaListPage.tsx:47](../../apps/web/src/pages/areas/AreaListPage.tsx#L47)、194 行 |
| `AreaListPage.6c4eb318` | 写死 | 全部 | 名称 | [AreaListPage.tsx:47](../../apps/web/src/pages/areas/AreaListPage.tsx#L47)、52、59、67 行 |
| `AreaListPage.47b1c78d` | 写死 | 业务类型 | 名称 | [AreaListPage.tsx:50](../../apps/web/src/pages/areas/AreaListPage.tsx#L50)、202 行 |
| `AreaListPage.8fcc45ec` | 写死 | 用途 | 名称 | [AreaListPage.tsx:57](../../apps/web/src/pages/areas/AreaListPage.tsx#L57)、203 行 |
| `AreaListPage.d4683fa6` | 写死 | 状态 | 名称 | [AreaListPage.tsx:64](../../apps/web/src/pages/areas/AreaListPage.tsx#L64)、230 行 |
| `AreaListPage.81b7ac2b` | 写死 | 启用 | 名称 | [AreaListPage.tsx:68](../../apps/web/src/pages/areas/AreaListPage.tsx#L68) |
| `AreaListPage.04a67d69` | 写死 | 已停用 | 名称 | [AreaListPage.tsx:69](../../apps/web/src/pages/areas/AreaListPage.tsx#L69) |
| `AreaListPage.c07198a2` | 写死 | 区域 · NOZOMI {name} | 浏览器标题 | [AreaListPage.tsx:79](../../apps/web/src/pages/areas/AreaListPage.tsx#L79) |
| `AreaListPage.d6880ddb` | 写死 | 从共享库引用 | 按钮 | [AreaListPage.tsx:154](../../apps/web/src/pages/areas/AreaListPage.tsx#L154) |
| `AreaListPage.4bfa42e5` | 写死 | 新增区域 | 按钮 | [AreaListPage.tsx:160](../../apps/web/src/pages/areas/AreaListPage.tsx#L160) |
| `AreaListPage.25066a89` | 写死 | 商品配置 | 名称 | [AreaListPage.tsx:165](../../apps/web/src/pages/areas/AreaListPage.tsx#L165)、270 行 |
| `AreaListPage.ad06e625` | 写死 | 区域 | 名称 | [AreaListPage.tsx:165](../../apps/web/src/pages/areas/AreaListPage.tsx#L165)、166、270、272 行 |
| `AreaListPage.02d45780` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [AreaListPage.tsx:167](../../apps/web/src/pages/areas/AreaListPage.tsx#L167) |
| `AreaListPage.9cf0eedc` | 写死 | 你没有权限查看这里 | 标题 | [AreaListPage.tsx:167](../../apps/web/src/pages/areas/AreaListPage.tsx#L167) |
| `AreaListPage.e299c023` | 写死 | 名称 | 文字 | [AreaListPage.tsx:177](../../apps/web/src/pages/areas/AreaListPage.tsx#L177) |
| `AreaListPage.9abef5e6` | 写死 | 城市已停用 | 名称 | [AreaListPage.tsx:198](../../apps/web/src/pages/areas/AreaListPage.tsx#L198) |
| `AreaListPage.31c2e239` | 写死 | 分类 | 文字 | [AreaListPage.tsx:205](../../apps/web/src/pages/areas/AreaListPage.tsx#L205) |
| `AreaListPage.e04e63cd` | 写死 | 营运区 | 文字 | [AreaListPage.tsx:206](../../apps/web/src/pages/areas/AreaListPage.tsx#L206) |
| `AreaListPage.e2a76ac7` | 写死 | 禁行区 | 文字 | [AreaListPage.tsx:207](../../apps/web/src/pages/areas/AreaListPage.tsx#L207) |
| `AreaListPage.dd192bb4` | 写死 | 使用它的商品 | 文字 | [AreaListPage.tsx:210](../../apps/web/src/pages/areas/AreaListPage.tsx#L210) |
| `AreaListPage.7563be7a` | 写死 | 查看使用 {text} 的 {used} 个商品 | 读屏说明 | [AreaListPage.tsx:219](../../apps/web/src/pages/areas/AreaListPage.tsx#L219) |
| `AreaListPage.f2a7c17b` | 写死 | {used} 个商品在用 | 链接 | [AreaListPage.tsx:220](../../apps/web/src/pages/areas/AreaListPage.tsx#L220)、223 行 |
| `AreaListPage.85a43fc7` | 写死 | {published} 个已上架 | 正文 | [AreaListPage.tsx:225](../../apps/web/src/pages/areas/AreaListPage.tsx#L225) |
| `AreaListPage.7b692cd8` | 写死 | 最近修改 | 文字 | [AreaListPage.tsx:231](../../apps/web/src/pages/areas/AreaListPage.tsx#L231) |
| `AreaListPage.1c662b96` | 写死 | 操作 | 文字 | [AreaListPage.tsx:236](../../apps/web/src/pages/areas/AreaListPage.tsx#L236) |
| `AreaListPage.1eb144b3` | 写死 | 编辑 {name} | 读屏说明 | [AreaListPage.tsx:241](../../apps/web/src/pages/areas/AreaListPage.tsx#L241) |
| `AreaListPage.b5e0d6ee` | 写死 | 编辑 | 按钮 | [AreaListPage.tsx:243](../../apps/web/src/pages/areas/AreaListPage.tsx#L243) |
| `AreaListPage.47b91f29` | 写死 | 更多 | 文字 | [AreaListPage.tsx:244](../../apps/web/src/pages/areas/AreaListPage.tsx#L244) |
| `AreaListPage.e0386ff2` | 写死 | {name} 的更多操作 | 名称 | [AreaListPage.tsx:244](../../apps/web/src/pages/areas/AreaListPage.tsx#L244) |
| `AreaListPage.c9823fde` | 写死 | 没有符合条件的区域 | 标题 | [AreaListPage.tsx:257](../../apps/web/src/pages/areas/AreaListPage.tsx#L257) |
| `AreaListPage.8368a139` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [AreaListPage.tsx:258](../../apps/web/src/pages/areas/AreaListPage.tsx#L258) |
| `AreaListPage.609d3f28` | 写死 | 清空筛选 | 按钮 | [AreaListPage.tsx:262](../../apps/web/src/pages/areas/AreaListPage.tsx#L262) |
| `AreaListPage.22e5cbfe` | 写死 | 还没有区域 | 标题 | [AreaListPage.tsx:266](../../apps/web/src/pages/areas/AreaListPage.tsx#L266) |
| `AreaListPage.754bad68` | 写死 | 区域就是你提供服务的范围：在地图上画出去的地方（营运区）和不去的地方（禁行区）。运营区域决定能不能接单；报价区域给商品勾选、设价格。有了报价区域，才能建商品、设价格。 | 说明 | [AreaListPage.tsx:266](../../apps/web/src/pages/areas/AreaListPage.tsx#L266) |
| `AreaListPage.daa12443` | 写死 | 在地图上看全部 | 按钮 | [AreaListPage.tsx:278](../../apps/web/src/pages/areas/AreaListPage.tsx#L278) |
| `AreaListPage.800a3db0` | 写死 | 按名称搜索 | 名称 | [AreaListPage.tsx:284](../../apps/web/src/pages/areas/AreaListPage.tsx#L284) |
| `AreaListPage.09b15379` | 写死 | 区域列表 | 名称 | [AreaListPage.tsx:288](../../apps/web/src/pages/areas/AreaListPage.tsx#L288) |

## 区域编辑

文件：`apps/web/src/lib/area-messages.ts`、`apps/web/src/pages/areas/AreaEditorPage.tsx`、`apps/web/src/pages/areas/AreaUsage.tsx`、`apps/web/src/pages/areas/PasteDialog.tsx`、`apps/web/src/pages/areas/ShapeList.tsx`、`apps/web/src/pages/areas/SubtractDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-messages.e2faeae0` | 写死 | 第 {…} 个点的坐标没填或不合法（纬度要在 -90 到 90、经度要在 -180 到 180 之间）。 | 文字 | [area-messages.ts:16](../../apps/web/src/lib/area-messages.ts#L16) |
| `area-messages.076b9ebf` | 写死 | 至少要 {minRingVertices} 个点才能围成一个范围，现在只有 {…} 个。 | 文字 | [area-messages.ts:18](../../apps/web/src/lib/area-messages.ts#L18) |
| `area-messages.1c507661` | 写死 | 这一块有 {…} 个点，一个多边形最多 {…} 个点。 | 文字 | [area-messages.ts:20](../../apps/web/src/lib/area-messages.ts#L20) |
| `area-messages.3eca8e9b` | 写死 | 第 {…} 个点和第 {…} 个点在同一个位置，请删掉其中一个。 | 文字 | [area-messages.ts:22](../../apps/web/src/lib/area-messages.ts#L22) |
| `area-messages.723602ac` | 写死 | 不支持跨过 180° 经线的图形。 | 文字 | [area-messages.ts:24](../../apps/web/src/lib/area-messages.ts#L24) |
| `area-messages.33f78a2d` | 写死 | 这些点在一条直线上，围不成一个范围。 | 文字 | [area-messages.ts:26](../../apps/web/src/lib/area-messages.ts#L26) |
| `area-messages.01727a38` | 写死 | 第 {a}–{…} 个点之间的边，和第 {b}–{…} 个点之间的边交叉了。挪动这几个点，让边不再交叉。 | 文字 | [area-messages.ts:30](../../apps/web/src/lib/area-messages.ts#L30) |
| `area-messages.b09aac5c` | 写死 | 图形不能带洞。要在营运区中间挖掉一块，请在那里画一块禁行区。 | 文字 | [area-messages.ts:33](../../apps/web/src/lib/area-messages.ts#L33) |
| `area-messages.1d2c0aeb` | 写死 | 这个圆跨过了 180° 经线，或盖住了南北极，不支持。请把半径改小，或把圆心挪开。 | 文字 | [area-messages.ts:35](../../apps/web/src/lib/area-messages.ts#L35) |
| `area-messages.cd293c74` | 写死 | 半径要在 {…} 到 {…} 公里之间 | 文字 | [area-messages.ts:37](../../apps/web/src/lib/area-messages.ts#L37) |
| `area-messages.1dc2d5d7` | 写死 | 这一块图形不符合要求，请检查后重试。 | 文字 | [area-messages.ts:44](../../apps/web/src/lib/area-messages.ts#L44) |
| `area-messages.dd020a56` | 写死 | 至少要有一块营运区。在地图上画一块，或点「添加营运区」。 | 文字 | [area-messages.ts:51](../../apps/web/src/lib/area-messages.ts#L51) |
| `area-messages.e363e16d` | 写死 | 一个区域最多 {maxPolygons} 块图形，现在有 {…} 块。 | 文字 | [area-messages.ts:53](../../apps/web/src/lib/area-messages.ts#L53) |
| `area-messages.0159998a` | 写死 | 这个区域一共有 {…} 个点，最多 {…} 个。请删掉一些点或一些图形。 | 文字 | [area-messages.ts:55](../../apps/web/src/lib/area-messages.ts#L55) |
| `area-messages.c3e10ffa` | 写死 | 这块禁行区完全在营运区外面。点落在它里面时，用到这个区域的商品一律不报价；如果这是用途为「运营」的区域，这家供应商相容品类的商品在那里都不报价（即使别的区域盖住这个点）。请确认这是想要的。 | 提示 | [area-messages.ts:65](../../apps/web/src/lib/area-messages.ts#L65) |
| `area-messages.43c380ae` | 写死 | 这块营运区整个在「{forbidName}」里。禁行区优先，所以这一块实际上不会报价。 | 提示 | [area-messages.ts:67](../../apps/web/src/lib/area-messages.ts#L67) |
| `area-messages.c6ec7c5c` | 写死 | 有 {count} 个点离{cityName}中心超过 {farFromCityKm} 公里，请确认坐标没有填错（例如纬度和经度填反了）。 | 提示 | [area-messages.ts:69](../../apps/web/src/lib/area-messages.ts#L69) |
| `area-messages.39e10e82` | 写死 | 坐标行 | 文字 | [area-messages.ts:73](../../apps/web/src/lib/area-messages.ts#L73) |
| `area-messages.009be124` | 写死 | 请粘贴坐标 | 提示 | [area-messages.ts:79](../../apps/web/src/lib/area-messages.ts#L79) |
| `area-messages.968fb62f` | 写死 | 认不出这段内容。请粘贴 GeoJSON、WKT，或每行一对「纬度, 经度」。 | 提示 | [area-messages.ts:81](../../apps/web/src/lib/area-messages.ts#L81) |
| `area-messages.8b25fe78` | 写死 | 这段 GeoJSON 不完整或有语法错误（第 {line} 行附近）。请重新复制一次。 | 提示 | [area-messages.ts:83](../../apps/web/src/lib/area-messages.ts#L83) |
| `area-messages.cbab70fc` | 写死 | 这段 GeoJSON 不完整或有语法错误。请重新复制一次。 | 提示 | [area-messages.ts:83](../../apps/web/src/lib/area-messages.ts#L83) |
| `area-messages.05b1f56f` | 写死 | 这段 WKT 的写法不对。应该像这样：POLYGON((139.69 35.68, 139.75 35.68, 139.75 35.72, 139.69 35.68)) | 提示 | [area-messages.ts:85](../../apps/web/src/lib/area-messages.ts#L85) |
| `area-messages.51ff23dd` | 写死 | 这段内容里没有多边形（只有点、线，或多边形里一个点都没有）。区域需要的是多边形。 | 提示 | [area-messages.ts:87](../../apps/web/src/lib/area-messages.ts#L87) |
| `area-messages.06b9eefb` | 写死 | 第 {polygon} 个多边形里有超出范围的坐标（纬度要在 -90 到 90、经度要在 -180 到 180 之间）。 | 提示 | [area-messages.ts:89](../../apps/web/src/lib/area-messages.ts#L89) |
| `area-messages.21d09837` | 写死 | 只支持 WGS84（EPSG:4326）的坐标。 | 提示 | [area-messages.ts:91](../../apps/web/src/lib/area-messages.ts#L91) |
| `AreaEditorPage.78c8e6a5` | 写死 | 三类商品都可以用。 | 文字 | [AreaEditorPage.tsx:54](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L54) |
| `AreaEditorPage.0c0e828f` | 写死 | 只给接送机商品用。只看不是机场（或车站）的那一头在不在营运区。 | 文字 | [AreaEditorPage.tsx:55](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L55) |
| `AreaEditorPage.a51d61ee` | 写死 | 只给点对点商品用。上车点和下车点都要在营运区。 | 文字 | [AreaEditorPage.tsx:56](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L56) |
| `AreaEditorPage.c22ba05e` | 写死 | 只给包车商品用。只看上车点在不在营运区。 | 文字 | [AreaEditorPage.tsx:57](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L57) |
| `AreaEditorPage.842ffc87` | 写死 | 营运区 | 名称 | [AreaEditorPage.tsx:61](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L61) |
| `AreaEditorPage.6c538bed` | 写死 | 禁行区 | 名称 | [AreaEditorPage.tsx:62](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L62) |
| `AreaEditorPage.006efbe8` | 写死 | 你画的图形和填的内容都还在。 | 文字 | [AreaEditorPage.tsx:65](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L65) |
| `AreaEditorPage.21d19f34` | 写死 | 已载入最新内容。 | 文字 | [AreaEditorPage.tsx:186](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L186) |
| `AreaEditorPage.9df22b4d` | 写死 | 来源区域已经不在共享库里了，你的区域保持现在的形状。 | 文字 | [AreaEditorPage.tsx:244](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L244) |
| `AreaEditorPage.164d818d` | 写死 | 这个区域刚被改过，请先刷新页面再切换。 | 文字 | [AreaEditorPage.tsx:246](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L246) |
| `AreaEditorPage.9d7eac51` | 写死 | 切换后会让已上架商品的报价区域超出运营区域，没有切换。请先调整运营区域。 | 文字 | [AreaEditorPage.tsx:248](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L248) |
| `AreaEditorPage.44540264` | 写死 | 网络连接失败，请检查网络后重试。 | 文字 | [AreaEditorPage.tsx:250](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L250) |
| `AreaEditorPage.d24c9d1e` | 写死 | 系统暂时无法切换，请稍后再试。 | 文字 | [AreaEditorPage.tsx:251](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L251) |
| `AreaEditorPage.0b438f51` | 写死 | 新增区域 | 标题 | [AreaEditorPage.tsx:284](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L284) |
| `AreaEditorPage.3cd67e0e` | 写死 | 区域 | 标题 | [AreaEditorPage.tsx:284](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L284)、560 行 |
| `AreaEditorPage.020ec792` | 写死 | {pageTitle} · 区域 · NOZOMI {name} | 浏览器标题 | [AreaEditorPage.tsx:285](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L285) |
| `AreaEditorPage.43cda66e` | 写死 | 新增区域 · NOZOMI {name} | 浏览器标题 | [AreaEditorPage.tsx:285](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L285) |
| `AreaEditorPage.90eae1d9` | 写死 | 城市：请选择城市 | 文字 | [AreaEditorPage.tsx:372](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L372) |
| `AreaEditorPage.fb37dcdc` | 写死 | 名称：请至少填一种语言的名称 | 文字 | [AreaEditorPage.tsx:373](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L373) |
| `AreaEditorPage.6d9812b4` | 写死 | 名称：{label}名称最多 {maxNameLength} 个字 | 文字 | [AreaEditorPage.tsx:375](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L375) |
| `AreaEditorPage.4ebe8a97` | 写死 | 网络连接失败，请检查网络后重试。{PRESERVED} | 文字 | [AreaEditorPage.tsx:396](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L396) |
| `AreaEditorPage.e30ab854` | 写死 | 系统暂时无法保存，请稍后再试。{PRESERVED} | 文字 | [AreaEditorPage.tsx:397](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L397)、486 行 |
| `AreaEditorPage.18e502a1` | 写死 | 这一项不符合要求，请检查后重试 | 文字 | [AreaEditorPage.tsx:408](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L408) |
| `AreaEditorPage.57195095` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [AreaEditorPage.tsx:425](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L425)、429 行 |
| `AreaEditorPage.617f6f9e` | 写死 | {…}已经有同名的区域了，请换一个名称。 | 名称 | [AreaEditorPage.tsx:431](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L431) |
| `AreaEditorPage.868e7a6b` | 写死 | 这个城市 | 名称 | [AreaEditorPage.tsx:431](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L431) |
| `AreaEditorPage.804740b0` | 写死 | 这个区域刚被别人修改过，你的修改还没有保存。 | 标题 | [AreaEditorPage.tsx:437](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L437) |
| `AreaEditorPage.b9add607` | 写死 | 两边的修改不能自动合并。你可以先把自己画的图形复制出来，再载入最新内容，然后把要保留的部分粘贴回去。 | 文字 | [AreaEditorPage.tsx:438](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L438) |
| `AreaEditorPage.b66137ed` | 写死 | 复制我画的图形 | 按钮 | [AreaEditorPage.tsx:446](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L446) |
| `AreaEditorPage.55551975` | 写死 | 载入最新内容 | 按钮 | [AreaEditorPage.tsx:449](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L449) |
| `AreaEditorPage.087094b1` | 写死 | 同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。 | 文字 | [AreaEditorPage.tsx:454](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L454) |
| `AreaEditorPage.e4ae2754` | 写死 | 这次保存和刚才那一次撞在了一起。请刷新页面后重试。 | 文字 | [AreaEditorPage.tsx:464](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L464) |
| `AreaEditorPage.ba5f819e` | 写死 | 这个城市已经被平台停用，不能在它下面新增区域。请换一个城市。 | 文字 | [AreaEditorPage.tsx:467](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L467) |
| `AreaEditorPage.c8be6d94` | 写死 | 已有商品在用这个区域，不能改业务类型。 | 文字 | [AreaEditorPage.tsx:473](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L473)、788 行 |
| `AreaEditorPage.d751867a` | 写死 | 城市创建后不能修改。请刷新页面后重试。 | 文字 | [AreaEditorPage.tsx:476](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L476) |
| `AreaEditorPage.74981797` | 写死 | 没有修改权限 | 文字 | [AreaEditorPage.tsx:479](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L479) |
| `AreaEditorPage.38292f16` | 写死 | 这个区域已经不存在 | 文字 | [AreaEditorPage.tsx:483](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L483) |
| `AreaEditorPage.e6f6b92c` | 写死 | 找不到这个区域，它可能已被别人删除。你画的图形还在：可以在每一块的「更多」里复制坐标，再新增一个区域粘贴进去。 | 文字 | [AreaEditorPage.tsx:484](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L484) |
| `AreaEditorPage.1985a043` | 写死 | 已保存「{…}」 | 提示 | [AreaEditorPage.tsx:533](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L533) |
| `AreaEditorPage.2aed992b` | 写死 | 已新增区域「{…}」 | 提示 | [AreaEditorPage.tsx:533](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L533) |
| `AreaEditorPage.a346e1d2` | 写死 | 已保存。用到这个区域的包车商品里有 {length} 处三层区域重叠 | 标题 | [AreaEditorPage.tsx:545](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L545) |
| `AreaEditorPage.1ec9f974` | 写死 | 报价时一个点只能有一个答案：同一层的区域、基础价区域和上下车加价区域都不能重叠。可以用「从本区域减去另一个区域」切掉重叠的部分，再保存一次。 | 文字 | [AreaEditorPage.tsx:546](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L546) |
| `AreaEditorPage.5d28ab1e` | 写死 | 商品配置 | 名称 | [AreaEditorPage.tsx:560](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L560) |
| `AreaEditorPage.097131a1` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [AreaEditorPage.tsx:568](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L568) |
| `AreaEditorPage.f2ae8d47` | 写死 | 你没有权限查看这里 | 标题 | [AreaEditorPage.tsx:568](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L568) |
| `AreaEditorPage.f5cc55a8` | 写死 | 回到区域列表 | 按钮 | [AreaEditorPage.tsx:572](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L572) |
| `AreaEditorPage.525c9ff0` | 写死 | 找不到这个区域 | 标题 | [AreaEditorPage.tsx:575](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L575) |
| `AreaEditorPage.f232868c` | 写死 | 它可能已被删除，或链接有误。 | 说明 | [AreaEditorPage.tsx:575](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L575) |
| `AreaEditorPage.1972545b` | 写死 | 加载失败 | 标题 | [AreaEditorPage.tsx:581](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L581) |
| `AreaEditorPage.c4c09f1e` | 写死 | 请检查网络后重试。 | 说明 | [AreaEditorPage.tsx:582](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L582) |
| `AreaEditorPage.b3805247` | 写死 | 重试 | 按钮 | [AreaEditorPage.tsx:586](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L586) |
| `AreaEditorPage.e974550c` | 写死 | 最近修改 {…} | 正文 | [AreaEditorPage.tsx:615](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L615) |
| `AreaEditorPage.307c8841` | 写死 | {pageTitle} 的更多操作 | 名称 | [AreaEditorPage.tsx:621](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L621) |
| `AreaEditorPage.6e362c04` | 写死 | 更多 | 文字 | [AreaEditorPage.tsx:621](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L621) |
| `AreaEditorPage.50861bbc` | 写死 | 你可以查看区域，但不能修改。需要修改的话，请联系你们的管理员开通。 | 提示 | [AreaEditorPage.tsx:633](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L633) |
| `AreaEditorPage.9f4f3ce0` | 写死 | 有 {blockingCount} 处需要修改 | 正文 | [AreaEditorPage.tsx:637](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L637) |
| `AreaEditorPage.6aac80d4` | 写死 | 共享库里这个区域有新版本的形状 | 正文 | [AreaEditorPage.tsx:667](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L667) |
| `AreaEditorPage.8a69b8a9` | 写死 | 你引用的是第 {shape\_version} 版，库里现在是第 {latest\_shape\_version} 版。切换后你的形状换成新的（名称、业务类型、用途不变，会做和保存一样的检查）；不切换就保持现在的形状。 | 正文 | [AreaEditorPage.tsx:668](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L668) |
| `AreaEditorPage.8838e199` | 写死 | 切换中… | 文字 | [AreaEditorPage.tsx:671](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L671) |
| `AreaEditorPage.3c698499` | 写死 | 切换到新版本 | 按钮 | [AreaEditorPage.tsx:673](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L673) |
| `AreaEditorPage.cc60e1cd` | 写死 | 这个区域引用自共享库；来源已不在库里，你的区域照常可用。 | 正文 | [AreaEditorPage.tsx:680](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L680) |
| `AreaEditorPage.cc8e3dfe` | 写死 | 共享库里已有相似的区域 | 正文 | [AreaEditorPage.tsx:685](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L685) |
| `AreaEditorPage.58f1835a` | 写死 | 可以直接引用，不用自己画；引用后是你自己的区域，还能再改。 | 正文 | [AreaEditorPage.tsx:686](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L686) |
| `AreaEditorPage.62ea9cee` | 写死 | （范围重叠） | 按钮 | [AreaEditorPage.tsx:690](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L690) |
| `AreaEditorPage.9f4dc4fb` | 写死 | （同名） | 按钮 | [AreaEditorPage.tsx:690](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L690) |
| `AreaEditorPage.b09eabf6` | 写死 | 引用「{text}」{…} | 按钮 | [AreaEditorPage.tsx:690](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L690) |
| `AreaEditorPage.b3acfc96` | 写死 | 有一份上次没保存的修改（{…}）。 | 正文 | [AreaEditorPage.tsx:716](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L716) |
| `AreaEditorPage.6736d985` | 写死 | 恢复后可以接着改、再保存；不要了就丢弃。决定之前，现在的修改不会另存草稿。 | 正文 | [AreaEditorPage.tsx:717](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L717) |
| `AreaEditorPage.b8787e61` | 写死 | 恢复 | 按钮 | [AreaEditorPage.tsx:721](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L721) |
| `AreaEditorPage.9c8d02a8` | 写死 | 丢弃 | 按钮 | [AreaEditorPage.tsx:731](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L731) |
| `AreaEditorPage.b7d84bd2` | 写死 | 基本信息 | 标题 | [AreaEditorPage.tsx:740](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L740) |
| `AreaEditorPage.20315b27` | 写死 | 城市 | 名称 | [AreaEditorPage.tsx:744](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L744)、749 行 |
| `AreaEditorPage.aab80925` | 写死 | 创建后不能修改。要换城市，请新增一个区域。 | 说明 | [AreaEditorPage.tsx:744](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L744) |
| `AreaEditorPage.841fc3d4` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [AreaEditorPage.tsx:753](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L753) |
| `AreaEditorPage.f60e3bb2` | 写死 | 平台还没有启用中的城市 | 空状态 | [AreaEditorPage.tsx:754](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L754) |
| `AreaEditorPage.36bad54a` | 写死 | 请选择城市 | 提示 | [AreaEditorPage.tsx:757](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L757) |
| `AreaEditorPage.7d63a53b` | 写死 | 区域属于一个城市，创建后不能修改。 | 说明 | [AreaEditorPage.tsx:758](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L758) |
| `AreaEditorPage.46857203` | 写死 | 名称 | 标题 | [AreaEditorPage.tsx:768](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L768) |
| `AreaEditorPage.295449cc` | 写死 | 给自己人看的名字，建商品时按它来选区域。例如「东京 23 区」「成田机场周边」。 | 说明 | [AreaEditorPage.tsx:774](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L774) |
| `AreaEditorPage.a5a6a478` | 写死 | 业务类型 | 正文 | [AreaEditorPage.tsx:784](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L784)、800 行 |
| `AreaEditorPage.4119a4cc` | 写死 | 已有 {usedBy} 个商品在用这个区域，不能改业务类型。 | 正文 | [AreaEditorPage.tsx:788](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L788) |
| `AreaEditorPage.a7bf5056` | 写死 | 查看这些商品 | 链接 | [AreaEditorPage.tsx:794](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L794)、827、1064 行 |
| `AreaEditorPage.d8c5cc89` | 写死 | 建商品时，只能选到业务类型和商品品类相同的区域，或「通用」的区域。不管哪一类，上车点或下车点只要落在禁行区，就不报价。 | 说明 | [AreaEditorPage.tsx:800](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L800) |
| `AreaEditorPage.8a2e3815` | 写死 | 用途 | 标题 | [AreaEditorPage.tsx:805](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L805) |
| `AreaEditorPage.0e7c8b72` | 写死 | 已有 {usedBy} 个商品勾选了这个区域。运营区域不带价格，改成运营区域前要先在这些商品里换掉它，否则保存不了。 | 正文 | [AreaEditorPage.tsx:821](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L821) |
| `AreaEditorPage.1b0d8139` | 写死 | {…}只是提醒，可以保存。要在那里报价，请把运营区域画大一些，或新增一个覆盖它的运营区域。 | 正文 | [AreaEditorPage.tsx:836](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L836) |
| `AreaEditorPage.2fbc9f32` | 写死 | 地图上用警告色斜线标出了这部分。 | 正文 | [AreaEditorPage.tsx:836](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L836) |
| `AreaEditorPage.b78436f4` | 写死 | 绘制工具 | 读屏说明 | [AreaEditorPage.tsx:860](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L860) |
| `AreaEditorPage.cb480237` | 写死 | 选择 | 按钮 | [AreaEditorPage.tsx:864](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L864) |
| `AreaEditorPage.074ede50` | 写死 | 画多边形 | 按钮 | [AreaEditorPage.tsx:867](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L867) |
| `AreaEditorPage.61c98034` | 写死 | 画圆 | 按钮 | [AreaEditorPage.tsx:870](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L870) |
| `AreaEditorPage.15f12765` | 写死 | 粘贴坐标 | 按钮 | [AreaEditorPage.tsx:873](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L873) |
| `AreaEditorPage.53fd2e2c` | 写死 | 从本区域减去另一个区域 | 按钮 | [AreaEditorPage.tsx:876](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L876) |
| `AreaEditorPage.72e7b305` | 写死 | 新图形是 | 表单标签 | [AreaEditorPage.tsx:879](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L879)、880 行 |
| `AreaEditorPage.f44e7325` | 写死 | 撤销 | 按钮 | [AreaEditorPage.tsx:893](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L893) |
| `AreaEditorPage.cedc524f` | 写死 | 重做 | 按钮 | [AreaEditorPage.tsx:897](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L897) |
| `AreaEditorPage.cd284757` | 写死 | 请先选择城市 | 正文 | [AreaEditorPage.tsx:899](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L899) |
| `AreaEditorPage.5395a72b` | 写死 | 一个区域最多 {maxPolygons} 块图形 | 正文 | [AreaEditorPage.tsx:900](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L900) |
| `AreaEditorPage.c08bd836` | 写死 | 先选城市，地图会移到那里。 | 正文 | [AreaEditorPage.tsx:904](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L904) |
| `AreaEditorPage.45cf78e6` | 写死 | 正在加载地图… | 正文 | [AreaEditorPage.tsx:908](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L908) |
| `AreaEditorPage.2d9391dc` | 写死 | 这个环境没有配置地图底图。 | 正文 | [AreaEditorPage.tsx:931](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L931) |
| `AreaEditorPage.402455d9` | 写死 | 地图没有加载出来。 | 正文 | [AreaEditorPage.tsx:931](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L931) |
| `AreaEditorPage.518df773` | 写死 | {…}用「图形」里的坐标表、粘贴坐标和自测，可以完成全部操作。 | 正文 | [AreaEditorPage.tsx:931](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L931) |
| `AreaEditorPage.4c119c6f` | 写死 | 图形 | 标题 | [AreaEditorPage.tsx:938](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L938) |
| `AreaEditorPage.99c86c84` | 写死 | 自测 | 标题 | [AreaEditorPage.tsx:964](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L964) |
| `AreaEditorPage.3c2a084b` | 写死 | 营运区 {length} 块 · 禁行区 {length} 块 | 正文 | [AreaEditorPage.tsx:983](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L983) |
| `AreaEditorPage.5bbd382f` | 写死 |  · 有未保存的修改 | 正文 | [AreaEditorPage.tsx:984](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L984) |
| `AreaEditorPage.19399d1b` | 写死 |  · 请先载入最新内容 | 正文 | [AreaEditorPage.tsx:985](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L985) |
| `AreaEditorPage.8b966a31` | 写死 | 取消 | 按钮 | [AreaEditorPage.tsx:990](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L990)、1050 行 |
| `AreaEditorPage.39c22958` | 写死 | 保存中… | 文字 | [AreaEditorPage.tsx:991](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L991) |
| `AreaEditorPage.52578477` | 写死 | 保存 | 按钮 | [AreaEditorPage.tsx:993](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L993)、1053 行 |
| `AreaEditorPage.69c09c1c` | 写死 | 回到列表 | 按钮 | [AreaEditorPage.tsx:1002](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1002) |
| `AreaEditorPage.02bf6489` | 写死 | 已从本区域减去「{…}」，切掉{…}。保存后生效 | 提示 | [AreaEditorPage.tsx:1018](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1018) |
| `AreaEditorPage.9d46a362` | 写死 | 已替换 | 提示 | [AreaEditorPage.tsx:1032](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1032) |
| `AreaEditorPage.af38d151` | 写死 | 已添加 {count} 块图形 | 提示 | [AreaEditorPage.tsx:1036](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1036) |
| `AreaEditorPage.857eff66` | 写死 | 保存对图形的修改？ | 标题 | [AreaEditorPage.tsx:1044](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1044) |
| `AreaEditorPage.0192cedc` | 写死 | {publishedUsers} 个已上架的商品 | 正文 | [AreaEditorPage.tsx:1058](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1058) |
| `AreaEditorPage.07034a55` | 写死 | 在用这个区域。保存后，这些商品的报价范围会跟着变，大约 1 分钟内生效。 | 正文 | [AreaEditorPage.tsx:1058](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1058) |
| `AreaEditorPage.5a41a264` | 写死 | 有 | 正文 | [AreaEditorPage.tsx:1058](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1058) |
| `AreaEditorPage.d55c176d` | 写死 | 有未保存的修改，确定离开吗？ | 标题 | [AreaEditorPage.tsx:1070](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1070) |
| `AreaEditorPage.30676c82` | 写死 | 继续编辑 | 按钮 | [AreaEditorPage.tsx:1076](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1076) |
| `AreaEditorPage.14be7112` | 写死 | 离开 | 按钮 | [AreaEditorPage.tsx:1089](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1089) |
| `AreaEditorPage.57c80ddc` | 写死 | 离开后，这次画的图形和改的内容不会保存。 | 正文 | [AreaEditorPage.tsx:1093](../../apps/web/src/pages/areas/AreaEditorPage.tsx#L1093) |
| `AreaUsage.1e3fe6b1` | 写死 | 在地图上看「{label}」的全部区域 | 读屏说明 | [AreaUsage.tsx:50](../../apps/web/src/pages/areas/AreaUsage.tsx#L50) |
| `AreaUsage.f7f421d2` | 写死 | 在地图上看全部 | 链接 | [AreaUsage.tsx:52](../../apps/web/src/pages/areas/AreaUsage.tsx#L52) |
| `AreaUsage.de5c5bfb` | 写死 | 在哪些商品里用 | 标题 | [AreaUsage.tsx:64](../../apps/web/src/pages/areas/AreaUsage.tsx#L64) |
| `AreaUsage.001950ff` | 写死 | 没有加载出来。 | 正文 | [AreaUsage.tsx:69](../../apps/web/src/pages/areas/AreaUsage.tsx#L69) |
| `AreaUsage.cbbe57b0` | 写死 | 重试 | 按钮 | [AreaUsage.tsx:71](../../apps/web/src/pages/areas/AreaUsage.tsx#L71) |
| `AreaUsage.f7991a86` | 写死 | 正在加载… | 正文 | [AreaUsage.tsx:76](../../apps/web/src/pages/areas/AreaUsage.tsx#L76) |
| `AreaUsage.553efa84` | 写死 | 还没有商品用到这个区域。 | 正文 | [AreaUsage.tsx:79](../../apps/web/src/pages/areas/AreaUsage.tsx#L79) |
| `AreaUsage.400c05c4` | 写死 | 用到这个区域的商品 | 读屏说明 | [AreaUsage.tsx:82](../../apps/web/src/pages/areas/AreaUsage.tsx#L82) |
| `AreaUsage.39a46957` | 写死 | ① 基础价区域：商品的服务区域，在这里上下车按套餐价、不加价；② 行程区域：经停在这里收行程加价；③ 上下车加价区域：在这里上下车收上下车加价。 | 正文 | [AreaUsage.tsx:87](../../apps/web/src/pages/areas/AreaUsage.tsx#L87) |
| `AreaUsage.4b8b48f5` | 写死 | 有 {length} 处三层区域重叠 | 正文 | [AreaUsage.tsx:93](../../apps/web/src/pages/areas/AreaUsage.tsx#L93) |
| `AreaUsage.5d29ffb9` | 写死 | 同一个包车商品里，同一层的区域、基础价区域和上下车加价区域都不能重叠（一个点只能有一个答案）。只是提醒，可以保存；上架检查也会列出来。可以用「从本区域减去另一个区域」切掉重叠的部分。 | 正文 | [AreaUsage.tsx:94](../../apps/web/src/pages/areas/AreaUsage.tsx#L94) |
| `PasteDialog.75c247fa` | 写死 | 营运区 | 名称 | [PasteDialog.tsx:16](../../apps/web/src/pages/areas/PasteDialog.tsx#L16) |
| `PasteDialog.0a570b09` | 写死 | 禁行区 | 名称 | [PasteDialog.tsx:17](../../apps/web/src/pages/areas/PasteDialog.tsx#L17) |
| `PasteDialog.e9c1dfd0` | 写死 | 第 {…} 个多边形有 {…} 个点，一个多边形最多 {…} 个点。请先把它简化，再粘贴。 | 提示 | [PasteDialog.tsx:39](../../apps/web/src/pages/areas/PasteDialog.tsx#L39) |
| `PasteDialog.3cf3d55e` | 写死 | 这里要的是一个多边形，这段内容里有 {…} 个。要一次加多块，请用工具条上的「粘贴坐标」。 | 提示 | [PasteDialog.tsx:42](../../apps/web/src/pages/areas/PasteDialog.tsx#L42) |
| `PasteDialog.e837c87f` | 写死 | 禁行区不能带洞。请把它拆成几块不带洞的多边形，或改为「加为营运区」（洞会变成禁行区）。 | 提示 | [PasteDialog.tsx:46](../../apps/web/src/pages/areas/PasteDialog.tsx#L46) |
| `PasteDialog.2b3ad12a` | 写死 | 这段内容里有 {adding} 个多边形，加上已有的 {existing} 块会超过上限（最多 {maxPolygons} 块）。 | 提示 | [PasteDialog.tsx:48](../../apps/web/src/pages/areas/PasteDialog.tsx#L48) |
| `PasteDialog.c8c54d7e` | 写死 | 识别为 {…}：{length} 个多边形，共 {…} 个点。 | 文字 | [PasteDialog.tsx:58](../../apps/web/src/pages/areas/PasteDialog.tsx#L58) |
| `PasteDialog.8a8a0580` | 写死 | 这是从这里复制出去的图形：{…} 块营运区、{forbidden} 块禁行区，类型和备注名会原样带回，不看上面选的「加为」。 | 文字 | [PasteDialog.tsx:59](../../apps/web/src/pages/areas/PasteDialog.tsx#L59) |
| `PasteDialog.996b2f32` | 写死 | 其中 {holes} 个洞会加为禁行区。 | 文字 | [PasteDialog.tsx:60](../../apps/web/src/pages/areas/PasteDialog.tsx#L60) |
| `PasteDialog.68d3d886` | 写死 | 另有 {ignored} 个不是多边形的要素，已忽略。 | 文字 | [PasteDialog.tsx:61](../../apps/web/src/pages/areas/PasteDialog.tsx#L61) |
| `PasteDialog.7fcc250d` | 写死 | 粘贴坐标 | 标题 | [PasteDialog.tsx:102](../../apps/web/src/pages/areas/PasteDialog.tsx#L102) |
| `PasteDialog.82e80c85` | 写死 | 粘贴坐标替换「{name}」 | 标题 | [PasteDialog.tsx:102](../../apps/web/src/pages/areas/PasteDialog.tsx#L102) |
| `PasteDialog.ba6ec1f2` | 写死 | 取消 | 按钮 | [PasteDialog.tsx:109](../../apps/web/src/pages/areas/PasteDialog.tsx#L109) |
| `PasteDialog.8e7af53b` | 写死 | 添加到地图 | 按钮 | [PasteDialog.tsx:111](../../apps/web/src/pages/areas/PasteDialog.tsx#L111) |
| `PasteDialog.decfdd87` | 写死 | 替换 | 按钮 | [PasteDialog.tsx:111](../../apps/web/src/pages/areas/PasteDialog.tsx#L111) |
| `PasteDialog.226aa156` | 写死 | 加为 | 标题 | [PasteDialog.tsx:118](../../apps/web/src/pages/areas/PasteDialog.tsx#L118) |
| `PasteDialog.32884866` | 写死 | 内容 | 表单标签 | [PasteDialog.tsx:128](../../apps/web/src/pages/areas/PasteDialog.tsx#L128) |
| `PasteDialog.f1478d30` | 写死 | 从文件读取… | 按钮 | [PasteDialog.tsx:151](../../apps/web/src/pages/areas/PasteDialog.tsx#L151) |
| `PasteDialog.1b738e29` | 写死 | 选择坐标文件 | 读屏说明 | [PasteDialog.tsx:157](../../apps/web/src/pages/areas/PasteDialog.tsx#L157) |
| `PasteDialog.07de0c02` | 写死 | 文件超过 2 MB，读不了。 | 错误提示 | [PasteDialog.tsx:163](../../apps/web/src/pages/areas/PasteDialog.tsx#L163) |
| `PasteDialog.782f7dbf` | 写死 | 这个文件读不出文字内容。 | 错误提示 | [PasteDialog.tsx:169](../../apps/web/src/pages/areas/PasteDialog.tsx#L169) |
| `PasteDialog.c7b0971a` | 写死 | 支持三种写法：GeoJSON（Polygon、MultiPolygon、Feature、FeatureCollection）；WKT（POLYGON、MULTIPOLYGON）；或每行一对「纬度, 经度」。GeoJSON 和 WKT 按它们的标准是经度在前，照原样粘贴就行。 | 正文 | [PasteDialog.tsx:176](../../apps/web/src/pages/areas/PasteDialog.tsx#L176) |
| `ShapeList.a24e3490` | 写死 | 请填 -{MOVE\_LIMIT\_M} 到 {MOVE\_LIMIT\_M} 之间的整数（米） | 文字 | [ShapeList.tsx:24](../../apps/web/src/pages/areas/ShapeList.tsx#L24) |
| `ShapeList.15c7aca1` | 写死 | 多边形 · {length} 个点 | 说明 | [ShapeList.tsx:70](../../apps/web/src/pages/areas/ShapeList.tsx#L70) |
| `ShapeList.837da4cf` | 写死 | 圆 · 半径 {…} 公里 | 说明 | [ShapeList.tsx:70](../../apps/web/src/pages/areas/ShapeList.tsx#L70) |
| `ShapeList.671bb736` | 写死 | {…}区 | 名称 | [ShapeList.tsx:120](../../apps/web/src/pages/areas/ShapeList.tsx#L120) |
| `ShapeList.8a6e4ff4` | 写死 | 添加{kindName} | 文字 | [ShapeList.tsx:127](../../apps/web/src/pages/areas/ShapeList.tsx#L127) |
| `ShapeList.a439aeaf` | 写死 | 逐点输入坐标 | 正文 | [ShapeList.tsx:129](../../apps/web/src/pages/areas/ShapeList.tsx#L129) |
| `ShapeList.e1a81a2f` | 写死 | 输入圆心和半径 | 正文 | [ShapeList.tsx:132](../../apps/web/src/pages/areas/ShapeList.tsx#L132) |
| `ShapeList.eb753b4f` | 写死 | 粘贴坐标（WKT / GeoJSON） | 正文 | [ShapeList.tsx:135](../../apps/web/src/pages/areas/ShapeList.tsx#L135) |
| `ShapeList.dfcd2e26` | 写死 | 还没有营运区。在地图上画一块，或点「添加营运区」。 | 正文 | [ShapeList.tsx:141](../../apps/web/src/pages/areas/ShapeList.tsx#L141) |
| `ShapeList.f03b9e40` | 写死 | 没有禁行区。需要排除某块地方时再加。 | 正文 | [ShapeList.tsx:141](../../apps/web/src/pages/areas/ShapeList.tsx#L141) |
| `ShapeList.94112077` | 写死 | 有 {length} 处需要修改 | 正文 | [ShapeList.tsx:167](../../apps/web/src/pages/areas/ShapeList.tsx#L167) |
| `ShapeList.55e4ab8c` | 写死 | 有提醒 | 正文 | [ShapeList.tsx:168](../../apps/web/src/pages/areas/ShapeList.tsx#L168) |
| `ShapeList.31e31c10` | 写死 | {name} 的更多操作 | 名称 | [ShapeList.tsx:169](../../apps/web/src/pages/areas/ShapeList.tsx#L169) |
| `ShapeList.a7a4786c` | 写死 | 改备注名 | 正文 | [ShapeList.tsx:172](../../apps/web/src/pages/areas/ShapeList.tsx#L172)、309 行 |
| `ShapeList.79d96d0f` | 写死 | 复制坐标（GeoJSON） | 正文 | [ShapeList.tsx:176](../../apps/web/src/pages/areas/ShapeList.tsx#L176) |
| `ShapeList.622df61d` | 写死 | 粘贴坐标替换 | 正文 | [ShapeList.tsx:181](../../apps/web/src/pages/areas/ShapeList.tsx#L181) |
| `ShapeList.3bc631c6` | 写死 | 转成多边形 | 正文 | [ShapeList.tsx:185](../../apps/web/src/pages/areas/ShapeList.tsx#L185) |
| `ShapeList.336dc6ff` | 写死 | 改成禁行区 | 正文 | [ShapeList.tsx:189](../../apps/web/src/pages/areas/ShapeList.tsx#L189) |
| `ShapeList.451b522d` | 写死 | 改成营运区 | 正文 | [ShapeList.tsx:189](../../apps/web/src/pages/areas/ShapeList.tsx#L189) |
| `ShapeList.b049a689` | 写死 | 整体移动… | 正文 | [ShapeList.tsx:192](../../apps/web/src/pages/areas/ShapeList.tsx#L192) |
| `ShapeList.92de11cb` | 写死 | 恢复 | 名称 | [ShapeList.tsx:200](../../apps/web/src/pages/areas/ShapeList.tsx#L200) |
| `ShapeList.98ad790e` | 写死 | 已删除{name} | 提示 | [ShapeList.tsx:200](../../apps/web/src/pages/areas/ShapeList.tsx#L200) |
| `ShapeList.bac7b1a3` | 写死 | 删除这一块 | 正文 | [ShapeList.tsx:203](../../apps/web/src/pages/areas/ShapeList.tsx#L203) |
| `ShapeList.4624019c` | 写死 | 圆心纬度 | 表单标签 | [ShapeList.tsx:215](../../apps/web/src/pages/areas/ShapeList.tsx#L215) |
| `ShapeList.64c00a2d` | 写死 | {name} 圆心纬度 | 名称 | [ShapeList.tsx:215](../../apps/web/src/pages/areas/ShapeList.tsx#L215) |
| `ShapeList.00f7f435` | 写死 | 圆心经度 | 表单标签 | [ShapeList.tsx:219](../../apps/web/src/pages/areas/ShapeList.tsx#L219) |
| `ShapeList.ff409364` | 写死 | {name} 圆心经度 | 名称 | [ShapeList.tsx:219](../../apps/web/src/pages/areas/ShapeList.tsx#L219) |
| `ShapeList.d0aeadbe` | 写死 | 在「更多」里可以转成多边形：转了以后可以逐点修改，但不能再按圆心和半径来改。 | 正文 | [ShapeList.tsx:222](../../apps/web/src/pages/areas/ShapeList.tsx#L222) |
| `ShapeList.cd760506` | 写死 | 纬度 | 表头 | [ShapeList.tsx:229](../../apps/web/src/pages/areas/ShapeList.tsx#L229) |
| `ShapeList.371d3709` | 写死 | 经度 | 表头 | [ShapeList.tsx:230](../../apps/web/src/pages/areas/ShapeList.tsx#L230) |
| `ShapeList.bb6c94e7` | 写死 | 操作 | 正文 | [ShapeList.tsx:231](../../apps/web/src/pages/areas/ShapeList.tsx#L231) |
| `ShapeList.cee4121b` | 写死 | {name} 第 {…} 个点的纬度 | 名称 | [ShapeList.tsx:241](../../apps/web/src/pages/areas/ShapeList.tsx#L241) |
| `ShapeList.8de76372` | 写死 | {name} 第 {…} 个点的经度 | 名称 | [ShapeList.tsx:244](../../apps/web/src/pages/areas/ShapeList.tsx#L244) |
| `ShapeList.3a179c3e` | 写死 | 在 {name} 第 {…} 个点后面加一个点 | 读屏说明 | [ShapeList.tsx:248](../../apps/web/src/pages/areas/ShapeList.tsx#L248) |
| `ShapeList.811eac31` | 写死 | 删除 {name} 第 {…} 个点 | 读屏说明 | [ShapeList.tsx:251](../../apps/web/src/pages/areas/ShapeList.tsx#L251) |
| `ShapeList.886786b2` | 写死 | 至少保留 {minRingVertices} 个点 | 标题 | [ShapeList.tsx:251](../../apps/web/src/pages/areas/ShapeList.tsx#L251) |
| `ShapeList.17d88ef2` | 写死 | 一个区域最多 {maxPolygons} 块图形 | 正文 | [ShapeList.tsx:283](../../apps/web/src/pages/areas/ShapeList.tsx#L283) |
| `ShapeList.ae8157b1` | 写死 | 整体移动「{name}」 | 标题 | [ShapeList.tsx:289](../../apps/web/src/pages/areas/ShapeList.tsx#L289) |
| `ShapeList.f4b56e0c` | 写死 | 取消 | 按钮 | [ShapeList.tsx:295](../../apps/web/src/pages/areas/ShapeList.tsx#L295)、315 行 |
| `ShapeList.9d22de46` | 写死 | 移动 | 按钮 | [ShapeList.tsx:298](../../apps/web/src/pages/areas/ShapeList.tsx#L298) |
| `ShapeList.53fe9ddf` | 写死 | 向北移动（米） | 名称 | [ShapeList.tsx:303](../../apps/web/src/pages/areas/ShapeList.tsx#L303) |
| `ShapeList.976d678b` | 写死 | 往南移填负数，例如 -200。不动就留空。 | 说明 | [ShapeList.tsx:303](../../apps/web/src/pages/areas/ShapeList.tsx#L303) |
| `ShapeList.1ab970ff` | 写死 | 往西移填负数。 | 说明 | [ShapeList.tsx:304](../../apps/web/src/pages/areas/ShapeList.tsx#L304) |
| `ShapeList.34062586` | 写死 | 向东移动（米） | 名称 | [ShapeList.tsx:304](../../apps/web/src/pages/areas/ShapeList.tsx#L304) |
| `ShapeList.994f2a85` | 写死 | 确定 | 按钮 | [ShapeList.tsx:325](../../apps/web/src/pages/areas/ShapeList.tsx#L325) |
| `ShapeList.de0e3289` | 写死 | 备注名（选填） | 名称 | [ShapeList.tsx:330](../../apps/web/src/pages/areas/ShapeList.tsx#L330) |
| `ShapeList.b1b2dd37` | 写死 | 例如「皇居周边」。会接在自动编号后面显示。 | 说明 | [ShapeList.tsx:334](../../apps/web/src/pages/areas/ShapeList.tsx#L334) |
| `ShapeList.389bfa56` | 写死 | 备注名最多 {maxLabelLength} 个字 | 提示 | [ShapeList.tsx:335](../../apps/web/src/pages/areas/ShapeList.tsx#L335) |
| `ShapeList.ae925b4a` | 写死 | 半径（公里） | 表单标签 | [ShapeList.tsx:353](../../apps/web/src/pages/areas/ShapeList.tsx#L353) |
| `ShapeList.37772706` | 写死 | {name} 半径（公里） | 读屏说明 | [ShapeList.tsx:358](../../apps/web/src/pages/areas/ShapeList.tsx#L358) |
| `SubtractDialog.7b3aa0d3` | 写死 | 从本区域减去另一个区域 | 标题 | [SubtractDialog.tsx:39](../../apps/web/src/pages/areas/SubtractDialog.tsx#L39) |
| `SubtractDialog.53edb1e7` | 写死 | 取消 | 按钮 | [SubtractDialog.tsx:45](../../apps/web/src/pages/areas/SubtractDialog.tsx#L45) |
| `SubtractDialog.733dbd76` | 写死 | 减去 | 按钮 | [SubtractDialog.tsx:56](../../apps/web/src/pages/areas/SubtractDialog.tsx#L56) |
| `SubtractDialog.0f609c4d` | 写死 | 选一个和本区域重叠的区域，把重叠的部分从本区域的营运区里切掉（那个区域的禁行区不算它的范围）。本区域的禁行区、没碰到的图形不变。 | 正文 | [SubtractDialog.tsx:60](../../apps/web/src/pages/areas/SubtractDialog.tsx#L60) |
| `SubtractDialog.01aee344` | 写死 | 要减去的区域 | 名称 | [SubtractDialog.tsx:62](../../apps/web/src/pages/areas/SubtractDialog.tsx#L62) |
| `SubtractDialog.fd78d6e4` | 写死 | 输入区域名称查找 | 输入框占位 | [SubtractDialog.tsx:65](../../apps/web/src/pages/areas/SubtractDialog.tsx#L65) |
| `SubtractDialog.1a13a8de` | 写死 | 还没有别的区域 | 空状态 | [SubtractDialog.tsx:66](../../apps/web/src/pages/areas/SubtractDialog.tsx#L66) |

## 区域地图（运营后台也用）

文件：`apps/web/src/pages/areas/AreaOverviewPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaOverviewPage.32351836` | 写死 | 区域地图 · NOZOMI {name} | 浏览器标题 | [AreaOverviewPage.tsx:72](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L72) |
| `AreaOverviewPage.08538b58` | 写死 | 已导出 {length} 个区域（{name}） | 提示 | [AreaOverviewPage.tsx:152](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L152) |
| `AreaOverviewPage.490cc580` | 写死 | 商品 | 名称 | [AreaOverviewPage.tsx:155](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L155)、257 行 |
| `AreaOverviewPage.bf871b83` | 写死 | 区域 | 名称 | [AreaOverviewPage.tsx:155](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L155)、236 行 |
| `AreaOverviewPage.e05fea8f` | 写死 | 商品配置 | 名称 | [AreaOverviewPage.tsx:155](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L155) |
| `AreaOverviewPage.a226d9f8` | 写死 | 区域地图 | 名称 | [AreaOverviewPage.tsx:157](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L157)、158 行 |
| `AreaOverviewPage.0f75232c` | 写死 | 你没有权限查看这里 | 标题 | [AreaOverviewPage.tsx:163](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L163) |
| `AreaOverviewPage.1089ba5c` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [AreaOverviewPage.tsx:163](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L163) |
| `AreaOverviewPage.3abbd056` | 写死 | 导出 GeoJSON | 按钮 | [AreaOverviewPage.tsx:169](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L169) |
| `AreaOverviewPage.4869a786` | 写死 | 列表 | 按钮 | [AreaOverviewPage.tsx:171](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L171) |
| `AreaOverviewPage.4a89dceb` | 写死 | 添加区域 | 按钮 | [AreaOverviewPage.tsx:176](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L176)、297 行 |
| `AreaOverviewPage.43765163` | 写死 | 筛选 | 读屏说明 | [AreaOverviewPage.tsx:189](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L189) |
| `AreaOverviewPage.8b9c7427` | 写死 | 供应商 | 名称 | [AreaOverviewPage.tsx:193](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L193) |
| `AreaOverviewPage.3970f42a` | 写死 | 全部 | 名称 | [AreaOverviewPage.tsx:194](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L194)、195、206、207、248 行 |
| `AreaOverviewPage.ed7903a2` | 写死 | 城市 | 名称 | [AreaOverviewPage.tsx:205](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L205) |
| `AreaOverviewPage.9aa733e4` | 写死 | （已停用） | 名称 | [AreaOverviewPage.tsx:208](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L208) |
| `AreaOverviewPage.e8fe59fe` | 写死 | 这里只能查看。区域由供应商在自己的后台维护。 | 提示 | [AreaOverviewPage.tsx:216](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L216) |
| `AreaOverviewPage.29a086d2` | 写死 | 区域太多，只显示了最近修改的 300 个。{…} | 提示 | [AreaOverviewPage.tsx:217](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L217) |
| `AreaOverviewPage.4f02d2f1` | 写死 | 请按供应商或城市筛选。 | 提示 | [AreaOverviewPage.tsx:217](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L217) |
| `AreaOverviewPage.eb39826c` | 写死 | 请到列表里按城市查找。 | 提示 | [AreaOverviewPage.tsx:217](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L217) |
| `AreaOverviewPage.8da9c094` | 写死 | 加载失败 | 标题 | [AreaOverviewPage.tsx:223](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L223) |
| `AreaOverviewPage.3a4fbd45` | 写死 | 请检查网络后重试。 | 说明 | [AreaOverviewPage.tsx:224](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L224) |
| `AreaOverviewPage.309a04d8` | 写死 | 重试 | 按钮 | [AreaOverviewPage.tsx:228](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L228) |
| `AreaOverviewPage.5d1e1799` | 写死 | 共 {total} 个区域，显示 {length} 个 | 标题 | [AreaOverviewPage.tsx:236](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L236) |
| `AreaOverviewPage.6ebb005c` | 写死 | 共 {total} 个区域 | 标题 | [AreaOverviewPage.tsx:236](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L236) |
| `AreaOverviewPage.cbb132da` | 写死 | 按名称搜索 | 表单标签 | [AreaOverviewPage.tsx:241](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L241)、242 行 |
| `AreaOverviewPage.4cbbd806` | 写死 | 用途 | 名称 | [AreaOverviewPage.tsx:245](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L245) |
| `AreaOverviewPage.44bb5df7` | 写死 | 运营区域 | 名称 | [AreaOverviewPage.tsx:249](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L249)、303 行 |
| `AreaOverviewPage.77a584b7` | 写死 | 报价区域 | 名称 | [AreaOverviewPage.tsx:250](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L250)、303 行 |
| `AreaOverviewPage.a886e79f` | 写死 | 全部区域（不按商品） | 名称 | [AreaOverviewPage.tsx:260](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L260) |
| `AreaOverviewPage.3b2bf00b` | 写死 | 全部包车商品 | 名称 | [AreaOverviewPage.tsx:261](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L261) |
| `AreaOverviewPage.bac8800e` | 写死 | （加载中） | 名称 | [AreaOverviewPage.tsx:263](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L263) |
| `AreaOverviewPage.53a9e3aa` | 写死 | 按层筛选 | 表单标签 | [AreaOverviewPage.tsx:270](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L270) |
| `AreaOverviewPage.b243cf77` | 写死 | 只看有三层重叠的（{size}） | 正文 | [AreaOverviewPage.tsx:281](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L281) |
| `AreaOverviewPage.eda59348` | 写死 | 只看有重叠的{…} | 正文 | [AreaOverviewPage.tsx:281](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L281) |
| `AreaOverviewPage.d6b48b9c` | 写死 | 商品没有加载出来，请刷新页面重试。 | 正文 | [AreaOverviewPage.tsx:284](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L284) |
| `AreaOverviewPage.d416dba4` | 写死 | 区域加载中 | 名称 | [AreaOverviewPage.tsx:286](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L286) |
| `AreaOverviewPage.c5f256e4` | 写死 | 还没有区域 | 标题 | [AreaOverviewPage.tsx:290](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L290) |
| `AreaOverviewPage.6dc9fbea` | 写死 | 符合条件的供应商还没有建区域。 | 说明 | [AreaOverviewPage.tsx:291](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L291) |
| `AreaOverviewPage.cc04e37a` | 写死 | 区域就是你提供服务的范围。添加一个区域，在地图上画出去的地方（营运区）和不去的地方（禁行区）。 | 说明 | [AreaOverviewPage.tsx:291](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L291) |
| `AreaOverviewPage.1987aeaf` | 写死 | 换个名称试试，或清空搜索。 | 说明 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.1a4e42d5` | 写死 | 选中的商品在选中的层里没有区域。 | 说明 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.3d2ecfe6` | 写死 | 没有符合条件的区域 | 标题 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.3d5edda3` | 写死 | 没有和别的区域重叠的区域。 | 说明 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.445a6ddb` | 写死 | 还没有{…}。 | 说明 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.af6f3161` | 写死 | 选中的商品在选中的层里没有三层重叠。 | 说明 | [AreaOverviewPage.tsx:303](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L303) |
| `AreaOverviewPage.120fa241` | 写死 | 区域列表 | 读屏说明 | [AreaOverviewPage.tsx:305](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L305)、407 行 |
| `AreaOverviewPage.2f4e2ea2` | 写死 | （供应商已不存在） | 正文 | [AreaOverviewPage.tsx:322](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L322) |
| `AreaOverviewPage.44398995` | 写死 | 报价区域超出运营区域：{…}。 | 正文 | [AreaOverviewPage.tsx:357](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L357) |
| `AreaOverviewPage.c4fe9226` | 写死 | {…}最近修改 {…} | 正文 | [AreaOverviewPage.tsx:360](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L360) |
| `AreaOverviewPage.8233c7eb` | 写死 | 编辑 {…} | 读屏说明 | [AreaOverviewPage.tsx:363](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L363) |
| `AreaOverviewPage.8ad2ef37` | 写死 | 查看 {…} | 读屏说明 | [AreaOverviewPage.tsx:363](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L363) |
| `AreaOverviewPage.490aa967` | 写死 | 编辑 | 按钮 | [AreaOverviewPage.tsx:364](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L364) |
| `AreaOverviewPage.5d8faea0` | 写死 | 查看 | 按钮 | [AreaOverviewPage.tsx:364](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L364) |
| `AreaOverviewPage.93142d7c` | 写死 | 导出这个区域 | 按钮 | [AreaOverviewPage.tsx:368](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L368)、380 行 |
| `AreaOverviewPage.0655843e` | 写死 | 更多 | 文字 | [AreaOverviewPage.tsx:370](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L370) |
| `AreaOverviewPage.7784cf5b` | 写死 | {…} 的更多操作 | 名称 | [AreaOverviewPage.tsx:370](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L370) |
| `AreaOverviewPage.2f7da99d` | 写死 | 正在加载地图… | 正文 | [AreaOverviewPage.tsx:394](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L394) |
| `AreaOverviewPage.782fab25` | 写死 | 地图没有加载出来。 | 正文 | [AreaOverviewPage.tsx:396](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L396) |
| `AreaOverviewPage.a13f42bb` | 写死 | {…}区域的名称、形状和重叠照常列在左边。 | 正文 | [AreaOverviewPage.tsx:396](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L396) |
| `AreaOverviewPage.dc0feaad` | 写死 | 这个环境没有配置地图底图。 | 正文 | [AreaOverviewPage.tsx:396](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L396) |
| `AreaOverviewPage.ef62a74e` | 写死 | 重叠只在报价区域之间算，只是提醒，不影响保存：同一个位置落在几个报价区域里时，报价取最低。区域的禁行区压在别的区域上不算重叠，但同时选了这两个区域的商品在禁行区里不报价；运营区域之间、运营区域和报价区域之间也不算。报价区域超出运营区域的部分不会报价。详见 | 正文 | [AreaOverviewPage.tsx:407](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L407) |
| `AreaOverviewPage.3889f87a` | 写死 | 在地图上定位 | 读屏说明 | [AreaOverviewPage.tsx:452](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L452) |
| `AreaOverviewPage.32a88d8d` | 写死 | 搜索机场、车站、地标，或输入坐标 | 表单标签 | [AreaOverviewPage.tsx:454](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L454) |
| `AreaOverviewPage.492a9314` | 写死 | 搜索机场、车站、地标，或输入坐标（纬度, 经度） | 输入框占位 | [AreaOverviewPage.tsx:456](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L456) |
| `AreaOverviewPage.d126d4e5` | 写死 | 查找中… | 文字 | [AreaOverviewPage.tsx:457](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L457) |
| `AreaOverviewPage.8dac0651` | 写死 | 定位 | 按钮 | [AreaOverviewPage.tsx:460](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L460) |
| `AreaOverviewPage.3371d969` | 写死 | 没有查到。请检查网络后重试。 | 正文 | [AreaOverviewPage.tsx:462](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L462) |
| `AreaOverviewPage.ccab7b66` | 写死 | 没有匹配的地点。可以输入坐标（纬度, 经度）来定位。暂时不能按地址搜索。 | 正文 | [AreaOverviewPage.tsx:463](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L463) |
| `AreaOverviewPage.e32d2fac` | 写死 | 匹配的地点 | 读屏说明 | [AreaOverviewPage.tsx:465](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L465) |
| `AreaOverviewPage.9637b55a` | 写死 | 导入 | 读屏说明 | [AreaOverviewPage.tsx:501](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L501) |
| `AreaOverviewPage.5eccd295` | 写死 | 拖放 .geojson 文件到这里，或点击导入 | 正文 | [AreaOverviewPage.tsx:518](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L518) |
| `AreaOverviewPage.be31fdd7` | 写死 | 导入为一个新区域：在新增区域页核对图形、选城市、起名字后保存。文件只在浏览器里读，不上传。 | 正文 | [AreaOverviewPage.tsx:519](../../apps/web/src/pages/areas/AreaOverviewPage.tsx#L519) |

## 商品列表

文件：`apps/web/src/pages/products/ProductListPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ProductListPage.b279a17f` | 写死 | （已停用） | 名称 | [ProductListPage.tsx:41](../../apps/web/src/pages/products/ProductListPage.tsx#L41) |
| `ProductListPage.ebb3617d` | 写死 | 品类 | 名称 | [ProductListPage.tsx:46](../../apps/web/src/pages/products/ProductListPage.tsx#L46)、197 行 |
| `ProductListPage.68a8b54d` | 写死 | 全部 | 名称 | [ProductListPage.tsx:48](../../apps/web/src/pages/products/ProductListPage.tsx#L48)、51、56、64 行 |
| `ProductListPage.60b13a06` | 写死 | 城市 | 名称 | [ProductListPage.tsx:51](../../apps/web/src/pages/products/ProductListPage.tsx#L51)、200 行 |
| `ProductListPage.f8888993` | 写死 | 状态 | 名称 | [ProductListPage.tsx:54](../../apps/web/src/pages/products/ProductListPage.tsx#L54)、240 行 |
| `ProductListPage.095088bc` | 写死 | 子品牌 | 名称 | [ProductListPage.tsx:62](../../apps/web/src/pages/products/ProductListPage.tsx#L62)、224 行 |
| `ProductListPage.39382849` | 写死 | 还差 {failed\_required} 项 | 文字 | [ProductListPage.tsx:74](../../apps/web/src/pages/products/ProductListPage.tsx#L74) |
| `ProductListPage.e82c6c25` | 写死 | 等待开放 {unavailable\_required} 步 | 文字 | [ProductListPage.tsx:75](../../apps/web/src/pages/products/ProductListPage.tsx#L75) |
| `ProductListPage.1eb759ae` | 写死 | 可以上架 | 文字 | [ProductListPage.tsx:76](../../apps/web/src/pages/products/ProductListPage.tsx#L76) |
| `ProductListPage.edc29570` | 写死 | 已满足 | 文字 | [ProductListPage.tsx:76](../../apps/web/src/pages/products/ProductListPage.tsx#L76) |
| `ProductListPage.b67a4154` | 写死 | 商品 · NOZOMI {name} | 浏览器标题 | [ProductListPage.tsx:81](../../apps/web/src/pages/products/ProductListPage.tsx#L81) |
| `ProductListPage.e09e8248` | 写死 | 商品配置 | 名称 | [ProductListPage.tsx:165](../../apps/web/src/pages/products/ProductListPage.tsx#L165) |
| `ProductListPage.ec39522b` | 写死 | 商品 | 名称 | [ProductListPage.tsx:165](../../apps/web/src/pages/products/ProductListPage.tsx#L165)、166、183 行 |
| `ProductListPage.07a30520` | 写死 | 你没有权限查看这里 | 标题 | [ProductListPage.tsx:171](../../apps/web/src/pages/products/ProductListPage.tsx#L171) |
| `ProductListPage.1be97e81` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [ProductListPage.tsx:171](../../apps/web/src/pages/products/ProductListPage.tsx#L171) |
| `ProductListPage.cd60ff97` | 写死 | 新建商品 | 按钮 | [ProductListPage.tsx:177](../../apps/web/src/pages/products/ProductListPage.tsx#L177) |
| `ProductListPage.0f4318c0` | 写死 | 城市已停用 | 名称 | [ProductListPage.tsx:204](../../apps/web/src/pages/products/ProductListPage.tsx#L204) |
| `ProductListPage.05491c45` | 写死 | 接送点 | 文字 | [ProductListPage.tsx:210](../../apps/web/src/pages/products/ProductListPage.tsx#L210) |
| `ProductListPage.5c7e402f` | 写死 | 已停用 | 名称 | [ProductListPage.tsx:216](../../apps/web/src/pages/products/ProductListPage.tsx#L216) |
| `ProductListPage.3812923e` | 写死 | 区域 | 文字 | [ProductListPage.tsx:225](../../apps/web/src/pages/products/ProductListPage.tsx#L225) |
| `ProductListPage.a72cd5ad` | 写死 | 车型组 | 文字 | [ProductListPage.tsx:226](../../apps/web/src/pages/products/ProductListPage.tsx#L226) |
| `ProductListPage.0fd93768` | 写死 | 上架准备 | 文字 | [ProductListPage.tsx:229](../../apps/web/src/pages/products/ProductListPage.tsx#L229) |
| `ProductListPage.c0dc8d82` | 写死 | {text} 的上架检查：{text} | 读屏说明 | [ProductListPage.tsx:233](../../apps/web/src/pages/products/ProductListPage.tsx#L233) |
| `ProductListPage.3788f9cb` | 写死 | 最近修改 | 文字 | [ProductListPage.tsx:241](../../apps/web/src/pages/products/ProductListPage.tsx#L241) |
| `ProductListPage.3bf56f84` | 写死 | 操作 | 文字 | [ProductListPage.tsx:246](../../apps/web/src/pages/products/ProductListPage.tsx#L246) |
| `ProductListPage.36e11392` | 写死 | 编辑 {name} | 读屏说明 | [ProductListPage.tsx:251](../../apps/web/src/pages/products/ProductListPage.tsx#L251) |
| `ProductListPage.b94ca0f0` | 写死 | 编辑 | 按钮 | [ProductListPage.tsx:253](../../apps/web/src/pages/products/ProductListPage.tsx#L253) |
| `ProductListPage.1f8092ec` | 写死 | {name} 的更多操作 | 名称 | [ProductListPage.tsx:254](../../apps/web/src/pages/products/ProductListPage.tsx#L254) |
| `ProductListPage.eb60e3e6` | 写死 | 更多 | 文字 | [ProductListPage.tsx:254](../../apps/web/src/pages/products/ProductListPage.tsx#L254) |
| `ProductListPage.4dd2b596` | 写死 | 没有符合条件的商品 | 标题 | [ProductListPage.tsx:267](../../apps/web/src/pages/products/ProductListPage.tsx#L267) |
| `ProductListPage.519d92e2` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [ProductListPage.tsx:268](../../apps/web/src/pages/products/ProductListPage.tsx#L268) |
| `ProductListPage.8f9b62eb` | 写死 | 清空筛选 | 按钮 | [ProductListPage.tsx:272](../../apps/web/src/pages/products/ProductListPage.tsx#L272) |
| `ProductListPage.b9009131` | 写死 | 先建区域，再建商品 | 标题 | [ProductListPage.tsx:278](../../apps/web/src/pages/products/ProductListPage.tsx#L278) |
| `ProductListPage.8c2baa5d` | 写死 | 商品要选它在哪些区域里接单。你们还没有区域，请先去画一个。{…} | 说明 | [ProductListPage.tsx:279](../../apps/web/src/pages/products/ProductListPage.tsx#L279) |
| `ProductListPage.9d5585fa` | 写死 | 请联系你们的管理员。 | 说明 | [ProductListPage.tsx:279](../../apps/web/src/pages/products/ProductListPage.tsx#L279) |
| `ProductListPage.ff94c193` | 写死 | 新增区域 | 按钮 | [ProductListPage.tsx:285](../../apps/web/src/pages/products/ProductListPage.tsx#L285) |
| `ProductListPage.6435f40f` | 写死 | 还没有商品 | 标题 | [ProductListPage.tsx:291](../../apps/web/src/pages/products/ProductListPage.tsx#L291) |
| `ProductListPage.b314fbc9` | 写死 | 商品就是你在一个城市卖的一类服务，例如「羽田机场接送」「东京包车」。建好商品，再给它设价格。 | 说明 | [ProductListPage.tsx:291](../../apps/web/src/pages/products/ProductListPage.tsx#L291) |
| `ProductListPage.2f2255ac` | 写死 | 已删除的区域 | 名称 | [ProductListPage.tsx:293](../../apps/web/src/pages/products/ProductListPage.tsx#L293) |
| `ProductListPage.edb9afad` | 写死 | 按标题或商品编号搜索 | 名称 | [ProductListPage.tsx:298](../../apps/web/src/pages/products/ProductListPage.tsx#L298) |
| `ProductListPage.ab18b6de` | 写死 | 区域：{areaLabel} | 标题 | [ProductListPage.tsx:303](../../apps/web/src/pages/products/ProductListPage.tsx#L303)、304 行 |
| `ProductListPage.2a9fa6ee` | 写死 | 去掉条件「区域：{areaLabel}」 | 读屏说明 | [ProductListPage.tsx:305](../../apps/web/src/pages/products/ProductListPage.tsx#L305) |
| `ProductListPage.c73c9318` | 写死 | 商品列表 | 名称 | [ProductListPage.tsx:311](../../apps/web/src/pages/products/ProductListPage.tsx#L311) |

## 商品编辑

文件：`apps/web/src/pages/products/ProductEditorPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ProductEditorPage.8fc78af2` | 写死 | 商品 | 标题 | [ProductEditorPage.tsx:70](../../apps/web/src/pages/products/ProductEditorPage.tsx#L70)、107 行 |
| `ProductEditorPage.e70493a1` | 写死 | 新建商品 | 标题 | [ProductEditorPage.tsx:70](../../apps/web/src/pages/products/ProductEditorPage.tsx#L70) |
| `ProductEditorPage.604cdaf4` | 写死 | 导入库存 | 浏览器标题 | [ProductEditorPage.tsx:71](../../apps/web/src/pages/products/ProductEditorPage.tsx#L71) |
| `ProductEditorPage.6c09ca6c` | 写死 | 商品 · NOZOMI {name} | 浏览器标题 | [ProductEditorPage.tsx:71](../../apps/web/src/pages/products/ProductEditorPage.tsx#L71) |
| `ProductEditorPage.8ee10ef8` | 写死 | 新建商品 · NOZOMI {name} | 浏览器标题 | [ProductEditorPage.tsx:71](../../apps/web/src/pages/products/ProductEditorPage.tsx#L71) |
| `ProductEditorPage.ef449867` | 写死 | 导入价格 | 浏览器标题 | [ProductEditorPage.tsx:71](../../apps/web/src/pages/products/ProductEditorPage.tsx#L71) |
| `ProductEditorPage.38a6f419` | 写死 | 商品配置 | 名称 | [ProductEditorPage.tsx:107](../../apps/web/src/pages/products/ProductEditorPage.tsx#L107) |
| `ProductEditorPage.ab8eb7dc` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [ProductEditorPage.tsx:115](../../apps/web/src/pages/products/ProductEditorPage.tsx#L115) |
| `ProductEditorPage.aea86765` | 写死 | 你没有权限查看这里 | 标题 | [ProductEditorPage.tsx:115](../../apps/web/src/pages/products/ProductEditorPage.tsx#L115) |
| `ProductEditorPage.747f42aa` | 写死 | 找不到这个商品 | 标题 | [ProductEditorPage.tsx:122](../../apps/web/src/pages/products/ProductEditorPage.tsx#L122) |
| `ProductEditorPage.03e124d7` | 写死 | 它可能已被删除，或链接有误。 | 说明 | [ProductEditorPage.tsx:123](../../apps/web/src/pages/products/ProductEditorPage.tsx#L123) |
| `ProductEditorPage.085e049b` | 写死 | 回到商品列表 | 按钮 | [ProductEditorPage.tsx:127](../../apps/web/src/pages/products/ProductEditorPage.tsx#L127) |
| `ProductEditorPage.64c5f3b7` | 写死 | 加载失败 | 标题 | [ProductEditorPage.tsx:149](../../apps/web/src/pages/products/ProductEditorPage.tsx#L149) |
| `ProductEditorPage.dc60b5c8` | 写死 | 请检查网络后重试。 | 说明 | [ProductEditorPage.tsx:150](../../apps/web/src/pages/products/ProductEditorPage.tsx#L150) |
| `ProductEditorPage.5e6a9662` | 写死 | 重试 | 按钮 | [ProductEditorPage.tsx:154](../../apps/web/src/pages/products/ProductEditorPage.tsx#L154)、217 行 |
| `ProductEditorPage.789bd22e` | 写死 | 城市 | 文字 | [ProductEditorPage.tsx:171](../../apps/web/src/pages/products/ProductEditorPage.tsx#L171) |
| `ProductEditorPage.bbb6fb6f` | 写死 | 接送点 | 文字 | [ProductEditorPage.tsx:172](../../apps/web/src/pages/products/ProductEditorPage.tsx#L172) |
| `ProductEditorPage.5e25e5cf` | 写死 | 子品牌 | 文字 | [ProductEditorPage.tsx:173](../../apps/web/src/pages/products/ProductEditorPage.tsx#L173) |
| `ProductEditorPage.df95979a` | 写死 | 复制商品编号 | 名称 | [ProductEditorPage.tsx:184](../../apps/web/src/pages/products/ProductEditorPage.tsx#L184) |
| `ProductEditorPage.61cdebb7` | 写死 | 最近修改 {…} | 正文 | [ProductEditorPage.tsx:187](../../apps/web/src/pages/products/ProductEditorPage.tsx#L187) |
| `ProductEditorPage.6696061b` | 写死 | {…} 的更多操作 | 名称 | [ProductEditorPage.tsx:193](../../apps/web/src/pages/products/ProductEditorPage.tsx#L193) |
| `ProductEditorPage.a0c24004` | 写死 | 更多 | 文字 | [ProductEditorPage.tsx:193](../../apps/web/src/pages/products/ProductEditorPage.tsx#L193) |
| `ProductEditorPage.f11bd005` | 写死 | 你可以查看商品，但不能修改。需要修改的话，请联系你们的管理员开通。 | 提示 | [ProductEditorPage.tsx:205](../../apps/web/src/pages/products/ProductEditorPage.tsx#L205) |
| `ProductEditorPage.573bd2bc` | 写死 | 这个商品的{kind}「{name}」已停用。 | 正文 | [ProductEditorPage.tsx:208](../../apps/web/src/pages/products/ProductEditorPage.tsx#L208) |
| `ProductEditorPage.3a8f5f08` | 写死 | 请联系平台运营确认。 | 正文 | [ProductEditorPage.tsx:209](../../apps/web/src/pages/products/ProductEditorPage.tsx#L209) |
| `ProductEditorPage.fa9ffe05` | 写死 | 配置可以照常修改，但商品不能上架、不会参与报价。{…} | 正文 | [ProductEditorPage.tsx:209](../../apps/web/src/pages/products/ProductEditorPage.tsx#L209) |
| `ProductEditorPage.caccb3d1` | 写死 | 配置进度没有加载出来，不影响填写和保存。 | 正文 | [ProductEditorPage.tsx:214](../../apps/web/src/pages/products/ProductEditorPage.tsx#L214) |

## 价格规则总览

文件：`apps/web/src/pages/prices/PriceOverviewPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PriceOverviewPage.589204af` | 写死 | 品类 | 名称 | [PriceOverviewPage.tsx:44](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L44)、142 行 |
| `PriceOverviewPage.a47a39ec` | 写死 | 全部 | 名称 | [PriceOverviewPage.tsx:46](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L46)、53 行 |
| `PriceOverviewPage.30e7ad32` | 写死 | 状态 | 名称 | [PriceOverviewPage.tsx:51](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L51)、144 行 |
| `PriceOverviewPage.74b971de` | 写死 | 价格规则 · NOZOMI {name} | 浏览器标题 | [PriceOverviewPage.tsx:67](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L67) |
| `PriceOverviewPage.429204b7` | 写死 | 价格规则 | 名称 | [PriceOverviewPage.tsx:96](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L96)、97 行 |
| `PriceOverviewPage.b1fae935` | 写死 | 商品配置 | 名称 | [PriceOverviewPage.tsx:96](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L96) |
| `PriceOverviewPage.029ca69b` | 写死 | 价格是按商品设的。选一个商品，进去设它的价格、调价规则，或看价格日历。 | 正文 | [PriceOverviewPage.tsx:98](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L98) |
| `PriceOverviewPage.a24dc9d8` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [PriceOverviewPage.tsx:103](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L103) |
| `PriceOverviewPage.f69cde47` | 写死 | 你没有权限查看这里 | 标题 | [PriceOverviewPage.tsx:103](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L103) |
| `PriceOverviewPage.bf771400` | 写死 | 商品 | 文字 | [PriceOverviewPage.tsx:128](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L128) |
| `PriceOverviewPage.0313cd1c` | 写死 | 城市 | 文字 | [PriceOverviewPage.tsx:143](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L143) |
| `PriceOverviewPage.19eaf244` | 写死 | 价格 | 文字 | [PriceOverviewPage.tsx:147](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L147) |
| `PriceOverviewPage.5498bbf4` | 写死 | 已上架，但没有可用的价格 | 文字 | [PriceOverviewPage.tsx:153](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L153) |
| `PriceOverviewPage.6586afa8` | 写死 | 有 {price\_rule\_count} 条，都停用、过期，或不在现在选的区域和车型组里 | 说明 | [PriceOverviewPage.tsx:153](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L153) |
| `PriceOverviewPage.9e73182b` | 写死 | 客人现在询不到价 | 说明 | [PriceOverviewPage.tsx:153](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L153) |
| `PriceOverviewPage.c1ebb673` | 写死 | 还没有设价格 | 文字 | [PriceOverviewPage.tsx:155](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L155) |
| `PriceOverviewPage.c2d8774d` | 写死 | 有 {price\_rule\_count} 条，都停用或过期了 | 说明 | [PriceOverviewPage.tsx:157](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L157) |
| `PriceOverviewPage.e46b128d` | 写死 | 没有可用的价格 | 文字 | [PriceOverviewPage.tsx:157](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L157) |
| `PriceOverviewPage.a248aa7b` | 写死 | {total} 个组合里 {missing} 个没有价格 | 文字 | [PriceOverviewPage.tsx:159](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L159) |
| `PriceOverviewPage.e1b8201e` | 写死 | {active\_price\_rule\_count} 条生效中的价格 | 文字 | [PriceOverviewPage.tsx:160](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L160) |
| `PriceOverviewPage.3ddadeb9` | 写死 | {name} 的价格：{text}{…} | 读屏说明 | [PriceOverviewPage.tsx:162](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L162) |
| `PriceOverviewPage.420ebd9f` | 写死 | 库存 | 文字 | [PriceOverviewPage.tsx:174](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L174)、205 行 |
| `PriceOverviewPage.7c15d2cd` | 写死 | {…} 的库存：限量，从今天起没有库存 | 读屏说明 | [PriceOverviewPage.tsx:178](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L178) |
| `PriceOverviewPage.a1fd81f5` | 写死 | 从今天起没有库存 | 正文 | [PriceOverviewPage.tsx:180](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L180) |
| `PriceOverviewPage.1f11e726` | 写死 | 调价规则 | 文字 | [PriceOverviewPage.tsx:186](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L186)、199 行 |
| `PriceOverviewPage.c2ae1d68` | 写死 | {enabled\_adjust\_rule\_count} 条启用 | 正文 | [PriceOverviewPage.tsx:186](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L186) |
| `PriceOverviewPage.2af30ea0` | 写死 | 操作 | 文字 | [PriceOverviewPage.tsx:189](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L189) |
| `PriceOverviewPage.5f468a19` | 写死 | 看价格 | 读屏说明 | [PriceOverviewPage.tsx:194](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L194)、195 行 |
| `PriceOverviewPage.e7cda9d3` | 写死 | 设价格 | 读屏说明 | [PriceOverviewPage.tsx:194](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L194)、195 行 |
| `PriceOverviewPage.77da3eb0` | 写死 | {name} 的更多操作 | 名称 | [PriceOverviewPage.tsx:197](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L197) |
| `PriceOverviewPage.96dc985b` | 写死 | 更多 | 文字 | [PriceOverviewPage.tsx:197](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L197) |
| `PriceOverviewPage.ae6353b9` | 写死 | 价格日历 | 正文 | [PriceOverviewPage.tsx:202](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L202) |
| `PriceOverviewPage.a6018f0c` | 写死 | 所有商品都设了价格 | 标题 | [PriceOverviewPage.tsx:220](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L220) |
| `PriceOverviewPage.8281b50f` | 写死 | 看全部商品 | 按钮 | [PriceOverviewPage.tsx:224](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L224) |
| `PriceOverviewPage.3df57b5b` | 写死 | 没有符合条件的商品 | 标题 | [PriceOverviewPage.tsx:230](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L230) |
| `PriceOverviewPage.380b8256` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [PriceOverviewPage.tsx:231](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L231) |
| `PriceOverviewPage.809f4a79` | 写死 | 清空筛选 | 按钮 | [PriceOverviewPage.tsx:235](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L235) |
| `PriceOverviewPage.4e1576ed` | 写死 | 先建商品，再设价格 | 标题 | [PriceOverviewPage.tsx:241](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L241) |
| `PriceOverviewPage.186bda0d` | 写死 | 价格是按商品设的。你们还没有商品，请先建一个。 | 说明 | [PriceOverviewPage.tsx:242](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L242) |
| `PriceOverviewPage.571e9586` | 写死 | 新建商品 | 按钮 | [PriceOverviewPage.tsx:248](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L248) |
| `PriceOverviewPage.987a7fab` | 写死 | 按标题或商品编号搜索 | 名称 | [PriceOverviewPage.tsx:257](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L257) |
| `PriceOverviewPage.d7cb67d5` | 写死 | 只看还没有设价格的 | 正文 | [PriceOverviewPage.tsx:262](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L262) |
| `PriceOverviewPage.c5841029` | 写死 | 已上架、没有可用的价格 | 标题 | [PriceOverviewPage.tsx:266](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L266)、267 行 |
| `PriceOverviewPage.07bb1f9b` | 写死 | 去掉条件「已上架、没有可用的价格」 | 读屏说明 | [PriceOverviewPage.tsx:268](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L268) |
| `PriceOverviewPage.4b3edf6c` | 写死 | 已上架、从今天起没有库存 | 标题 | [PriceOverviewPage.tsx:276](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L276)、277 行 |
| `PriceOverviewPage.0b40840a` | 写死 | 去掉条件「已上架、从今天起没有库存」 | 读屏说明 | [PriceOverviewPage.tsx:278](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L278) |
| `PriceOverviewPage.487670d7` | 写死 | 各商品的价格情况 | 名称 | [PriceOverviewPage.tsx:285](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L285) |
| `PriceOverviewPage.a49eca4a` | 写死 | 只列出最近改过的 1,000 个商品。 | 正文 | [PriceOverviewPage.tsx:296](../../apps/web/src/pages/prices/PriceOverviewPage.tsx#L296) |

## 订单（列表、详情）

文件：`apps/web/src/pages/orders/OrderMoneySections.tsx`、`apps/web/src/pages/orders/OrderPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `OrderMoneySections.dc7a4274` | 写死 | 取消规则 | 标题 | [OrderMoneySections.tsx:29](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L29) |
| `OrderMoneySections.cb58b21f` | 写死 | 这一单的取消阶梯 | 正文 | [OrderMoneySections.tsx:32](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L32) |
| `OrderMoneySections.89d38111` | 写死 | 按平台现在的取消政策 | 正文 | [OrderMoneySections.tsx:33](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L33) |
| `OrderMoneySections.dcf19295` | 写死 | 取消原因 | 正文 | [OrderMoneySections.tsx:38](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L38) |
| `OrderMoneySections.be784f3c` | 写死 | 你应得 | 正文 | [OrderMoneySections.tsx:42](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L42) |
| `OrderMoneySections.b9ce4e09` | 写死 | {…}（结算价 × {…}%） | 正文 | [OrderMoneySections.tsx:43](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L43) |
| `OrderMoneySections.7d93bece` | 写死 | 取消政策由平台按品类和车型级别统一规定；客人取消时按上面的阶梯扣款，你得结算价 × 同一比例。航班取消（有证明）、不可抗力、平台或供应商原因的取消不扣款。 | 正文 | [OrderMoneySections.tsx:48](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L48) |
| `OrderMoneySections.f4e224f3` | 写死 | 拒绝这次修改 | 标题 | [OrderMoneySections.tsx:60](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L60) |
| `OrderMoneySections.c9c84651` | 写死 | 返回 | 按钮 | [OrderMoneySections.tsx:68](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L68) |
| `OrderMoneySections.08b23656` | 写死 | 确认拒绝 | 按钮 | [OrderMoneySections.tsx:78](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L78) |
| `OrderMoneySections.17d812aa` | 写死 | 拒绝后原预约不变，客人补过的差价退回，客人会收到结果邮件，可能免费取消。 | 正文 | [OrderMoneySections.tsx:83](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L83) |
| `OrderMoneySections.4f2b15ad` | 写死 | 请写拒绝原因 | 提示 | [OrderMoneySections.tsx:84](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L84) |
| `OrderMoneySections.56a0bf8c` | 写死 | 拒绝原因 | 名称 | [OrderMoneySections.tsx:84](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L84) |
| `OrderMoneySections.6a303f2d` | 写死 | 只留在后台和操作记录里，不会给客人看。 | 说明 | [OrderMoneySections.tsx:84](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L84) |
| `OrderMoneySections.3e433547` | 写死 | 已拒绝：原预约不变，已告诉客人 | 文字 | [OrderMoneySections.tsx:98](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L98) |
| `OrderMoneySections.547ab7f3` | 写死 | 已同意，订单已更新 | 按钮 | [OrderMoneySections.tsx:98](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L98) |
| `OrderMoneySections.83c74c41` | 写死 | 已标记调整中 | 文字 | [OrderMoneySections.tsx:98](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L98) |
| `OrderMoneySections.a909f788` | 写死 | 拒绝 | 文字 | [OrderMoneySections.tsx:99](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L99)、159 行 |
| `OrderMoneySections.c947e8ae` | 写死 | 同意 | 按钮 | [OrderMoneySections.tsx:99](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L99)、143 行 |
| `OrderMoneySections.d8ea15cd` | 写死 | 标记调整中 | 文字 | [OrderMoneySections.tsx:99](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L99) |
| `OrderMoneySections.2d700798` | 写死 | 新的那一天已经订满了：可以加库存后再同意，或者拒绝。修改申请还留着。 | 提示 | [OrderMoneySections.tsx:109](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L109) |
| `OrderMoneySections.15fdf091` | 写死 | 这位司机没有邮箱，系统通知不到，请电话联系。 | 提示 | [OrderMoneySections.tsx:118](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L118) |
| `OrderMoneySections.8246949d` | 写死 | 系统已发邮件告诉司机，确认前按原任务执行。 | 提示 | [OrderMoneySections.tsx:118](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L118) |
| `OrderMoneySections.8d38481e` | 写死 | 你们设置了手动发送，系统不会给司机发邮件，请自己通知司机。 | 提示 | [OrderMoneySections.tsx:118](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L118) |
| `OrderMoneySections.e99de946` | 写死 | 修改记录 | 标题 | [OrderMoneySections.tsx:121](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L121) |
| `OrderMoneySections.b8dc4e38` | 写死 | ；结算价 {…} → {…} | 正文 | [OrderMoneySections.tsx:130](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L130) |
| `OrderMoneySections.7c5ad491` | 写死 | ；说明：{decision\_note} | 正文 | [OrderMoneySections.tsx:131](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L131) |
| `OrderMoneySections.760ae6e5` | 写死 | （平台代为处理） | 正文 | [OrderMoneySections.tsx:132](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L132) |
| `OrderMoneySections.97126e97` | 写死 | 原来派的司机或车辆在新的时段有别的单，请改派。 | 提示 | [OrderMoneySections.tsx:133](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L133) |
| `OrderMoneySections.1ef97499` | 写死 | 需调整司机：{driverWarning} | 提示 | [OrderMoneySections.tsx:134](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L134) |
| `OrderMoneySections.92322d56` | 写死 | 请在 {…} 之前处理。确认前原预约仍然有效；超时按没确认处理，客人可能免费取消。 | 正文 | [OrderMoneySections.tsx:138](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L138) |
| `OrderMoneySections.d68ba74b` | 写死 | 调整中 | 按钮 | [OrderMoneySections.tsx:147](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L147) |
| `OrderMoneySections.6261224a` | 写死 | 上传票据 | 文字 | [OrderMoneySections.tsx:195](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L195) |
| `OrderMoneySections.577f687c` | 写死 | 金额写成大于 0 的数（{currency}），如 2000 | 文字 | [OrderMoneySections.tsx:203](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L203) |
| `OrderMoneySections.e46e6327` | 写死 | 高速费、停车费要附票据照片 | 文字 | [OrderMoneySections.tsx:207](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L207) |
| `OrderMoneySections.a1520571` | 写死 | 提交 | 文字 | [OrderMoneySections.tsx:216](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L216)、235 行 |
| `OrderMoneySections.3bcc8932` | 写死 | 提交事后加收 | 标题 | [OrderMoneySections.tsx:224](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L224) |
| `OrderMoneySections.cd669386` | 写死 | 取消 | 按钮 | [OrderMoneySections.tsx:232](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L232) |
| `OrderMoneySections.8f4b4870` | 写死 | 类型 | 名称 | [OrderMoneySections.tsx:240](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L240) |
| `OrderMoneySections.1d11de41` | 写死 | 包车一口价已含高速费、停车费，不能另收 | 说明 | [OrderMoneySections.tsx:243](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L243) |
| `OrderMoneySections.c81a33f7` | 写死 | 不能超过这一单的结算价；超过客人付的 50% 会转平台审核 | 说明 | [OrderMoneySections.tsx:246](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L246) |
| `OrderMoneySections.d4f05569` | 写死 | 金额（结算价，{currency}） | 名称 | [OrderMoneySections.tsx:246](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L246) |
| `OrderMoneySections.85aab26b` | 写死 | 如「等了 40 分钟」「多去了一个地方」 | 说明 | [OrderMoneySections.tsx:247](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L247) |
| `OrderMoneySections.f5bdbb35` | 写死 | 说明 | 名称 | [OrderMoneySections.tsx:247](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L247) |
| `OrderMoneySections.f584b8c6` | 写死 | 票据照片 | 表单标签 | [OrderMoneySections.tsx:251](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L251) |
| `OrderMoneySections.6c160962` | 写死 | 高速费、停车费必须附；其他类型没有凭证会转平台审核。 | 正文 | [OrderMoneySections.tsx:253](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L253) |
| `OrderMoneySections.88894f93` | 写死 | 已上传：{…} | 正文 | [OrderMoneySections.tsx:253](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L253) |
| `OrderMoneySections.bfbd77f9` | 写死 | 没有凭证会转平台审核。 | 正文 | [OrderMoneySections.tsx:253](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L253) |
| `OrderMoneySections.9a331f96` | 写死 | 已撤回 | 提示 | [OrderMoneySections.tsx:269](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L269) |
| `OrderMoneySections.f15592d0` | 写死 | 撤回 | 文字 | [OrderMoneySections.tsx:271](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L271)、301 行 |
| `OrderMoneySections.b26b27cf` | 写死 | 事后加收 | 标题 | [OrderMoneySections.tsx:278](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L278) |
| `OrderMoneySections.08ff63a8` | 写死 | 提交加收 | 按钮 | [OrderMoneySections.tsx:282](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L282) |
| `OrderMoneySections.10445c8c` | 写死 | 没有加收。服务结束 24 小时内可以提交超时、等待、加停靠点等费用（平台订单不收现金）。 | 正文 | [OrderMoneySections.tsx:286](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L286) |
| `OrderMoneySections.6dfd0444` | 写死 | （你报的 {…}，平台通过了这么多） | 正文 | [OrderMoneySections.tsx:293](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L293) |
| `OrderMoneySections.5880f95b` | 写死 |  · 客人可以在 {…} 之前提异议，之后自动扣款 | 正文 | [OrderMoneySections.tsx:295](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L295) |
| `OrderMoneySections.09342037` | 写死 |  · 客人的异议：{dispute\_reason} | 正文 | [OrderMoneySections.tsx:297](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L297) |
| `OrderMoneySections.0507feae` | 写死 | 已提交：客人有 48 小时异议期，之后自动扣款 | 提示 | [OrderMoneySections.tsx:313](../../apps/web/src/pages/orders/OrderMoneySections.tsx#L313) |
| `OrderPages.a03332c7` | 写死 | 订单 | 名称 | [OrderPages.tsx:56](../../apps/web/src/pages/orders/OrderPages.tsx#L56)、99、100、138、139、169、391 行 |
| `OrderPages.4843065a` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [OrderPages.tsx:57](../../apps/web/src/pages/orders/OrderPages.tsx#L57) |
| `OrderPages.7afa9257` | 写死 | 你没有权限查看这里 | 标题 | [OrderPages.tsx:57](../../apps/web/src/pages/orders/OrderPages.tsx#L57) |
| `OrderPages.7142b751` | 写死 | 超时未派车 | 名称 | [OrderPages.tsx:76](../../apps/web/src/pages/orders/OrderPages.tsx#L76)、166 行 |
| `OrderPages.d4158406` | 写死 | 未派车 | 名称 | [OrderPages.tsx:76](../../apps/web/src/pages/orders/OrderPages.tsx#L76)、166 行 |
| `OrderPages.b4e5f924` | 写死 | 截止 {…} | 正文 | [OrderPages.tsx:77](../../apps/web/src/pages/orders/OrderPages.tsx#L77) |
| `OrderPages.341ec97d` | 写死 | 订单 · NOZOMI {name} | 浏览器标题 | [OrderPages.tsx:84](../../apps/web/src/pages/orders/OrderPages.tsx#L84) |
| `OrderPages.12eeab5e` | 写死 | 订单号 | 文字 | [OrderPages.tsx:115](../../apps/web/src/pages/orders/OrderPages.tsx#L115)、439 行 |
| `OrderPages.c02b8536` | 写死 | 用车时间（当地） | 文字 | [OrderPages.tsx:122](../../apps/web/src/pages/orders/OrderPages.tsx#L122) |
| `OrderPages.b13f1a78` | 写死 | 行程 | 文字 | [OrderPages.tsx:123](../../apps/web/src/pages/orders/OrderPages.tsx#L123)、435、442 行 |
| `OrderPages.315eb0f3` | 写死 | 乘客 | 文字 | [OrderPages.tsx:124](../../apps/web/src/pages/orders/OrderPages.tsx#L124)、448 行 |
| `OrderPages.d0b4d99f` | 写死 | {name}（{passengers} 人） | 文字 | [OrderPages.tsx:124](../../apps/web/src/pages/orders/OrderPages.tsx#L124) |
| `OrderPages.bda3fe8f` | 写死 | 派车 | 文字 | [OrderPages.tsx:125](../../apps/web/src/pages/orders/OrderPages.tsx#L125)、166、323、335、467、470 行 |
| `OrderPages.612bcb30` | 写死 | 状态 | 文字 | [OrderPages.tsx:126](../../apps/web/src/pages/orders/OrderPages.tsx#L126)、167 行 |
| `OrderPages.82e7ed2a` | 写死 | 修改待确认 | 名称 | [OrderPages.tsx:129](../../apps/web/src/pages/orders/OrderPages.tsx#L129) |
| `OrderPages.956b9f40` | 写死 | 结算价 | 文字 | [OrderPages.tsx:132](../../apps/web/src/pages/orders/OrderPages.tsx#L132)、454 行 |
| `OrderPages.90628b3f` | 写死 | 有 {overdueCount} 张单过了派车截止时间还没派车。 | 正文 | [OrderPages.tsx:142](../../apps/web/src/pages/orders/OrderPages.tsx#L142) |
| `OrderPages.24dbecd4` | 写死 | 只看这些 | 按钮 | [OrderPages.tsx:145](../../apps/web/src/pages/orders/OrderPages.tsx#L145)、153 行 |
| `OrderPages.d619d28f` | 写死 | 有 {pendingCount} 张单的客人申请了修改，等你处理。确认前原预约仍然有效。 | 正文 | [OrderPages.tsx:150](../../apps/web/src/pages/orders/OrderPages.tsx#L150) |
| `OrderPages.c01decf0` | 写死 | 只看有修改申请的单。 | 正文 | [OrderPages.tsx:158](../../apps/web/src/pages/orders/OrderPages.tsx#L158) |
| `OrderPages.d526d356` | 写死 | 看全部 | 按钮 | [OrderPages.tsx:161](../../apps/web/src/pages/orders/OrderPages.tsx#L161) |
| `OrderPages.32671f8c` | 写死 | 付款后的订单都在这里，按用车时间排列；过了派车截止时间（用车前 24 小时，付款时已不足 24 小时的是付款后 2 小时）还没派车的排在最前面、标红。 | 正文 | [OrderPages.tsx:164](../../apps/web/src/pages/orders/OrderPages.tsx#L164) |
| `OrderPages.4668ff3b` | 写死 | 全部 | 名称 | [OrderPages.tsx:166](../../apps/web/src/pages/orders/OrderPages.tsx#L166)、167 行 |
| `OrderPages.593539df` | 写死 | 没有符合条件的订单 | 标题 | [OrderPages.tsx:169](../../apps/web/src/pages/orders/OrderPages.tsx#L169) |
| `OrderPages.f4722d25` | 写死 | 客人付款后，订单会自动出现在这里。 | 说明 | [OrderPages.tsx:169](../../apps/web/src/pages/orders/OrderPages.tsx#L169) |
| `OrderPages.a6d46667` | 写死 | 司机链接 | 标题 | [OrderPages.tsx:227](../../apps/web/src/pages/orders/OrderPages.tsx#L227)、478 行 |
| `OrderPages.3e3cf8ee` | 写死 | 知道了 | 按钮 | [OrderPages.tsx:231](../../apps/web/src/pages/orders/OrderPages.tsx#L231) |
| `OrderPages.caad723e` | 写死 | 我已发给司机 | 按钮 | [OrderPages.tsx:231](../../apps/web/src/pages/orders/OrderPages.tsx#L231) |
| `OrderPages.2f6219c1` | 写死 | 把这个链接发给司机（LINE、短信都可以）。 | 正文 | [OrderPages.tsx:236](../../apps/web/src/pages/orders/OrderPages.tsx#L236) |
| `OrderPages.5a2e9d7c` | 写死 | 需要的话也可以把下面的链接发给司机（LINE、短信都可以），两条链接都能用。 | 正文 | [OrderPages.tsx:236](../../apps/web/src/pages/orders/OrderPages.tsx#L236) |
| `OrderPages.d4870141` | 写死 | {…}司机不需要账号，在手机上打开就能看这一单、回传出发 / 到达 / 接到 / 完成。 | 正文 | [OrderPages.tsx:236](../../apps/web/src/pages/orders/OrderPages.tsx#L236) |
| `OrderPages.98332b13` | 写死 | 链接只在这里显示这一次；关掉后看不到了，需要时重新生成（旧的和邮件里的都会作废）。 | 提示 | [OrderPages.tsx:237](../../apps/web/src/pages/orders/OrderPages.tsx#L237) |
| `OrderPages.ebe06679` | 写死 | 链接 | 表单标签 | [OrderPages.tsx:241](../../apps/web/src/pages/orders/OrderPages.tsx#L241) |
| `OrderPages.66a193c8` | 写死 | 复制链接 | 名称 | [OrderPages.tsx:244](../../apps/web/src/pages/orders/OrderPages.tsx#L244) |
| `OrderPages.a10e8c63` | 写死 | 有效期到 {…}（用车结束后 24 小时） | 正文 | [OrderPages.tsx:246](../../apps/web/src/pages/orders/OrderPages.tsx#L246) |
| `OrderPages.96fa8955` | 写死 | 已排队重发，现有的链接不受影响 | 提示 | [OrderPages.tsx:264](../../apps/web/src/pages/orders/OrderPages.tsx#L264) |
| `OrderPages.a81cdb22` | 写死 | 发得太频繁了，请过 {…} 秒再试 | 提示 | [OrderPages.tsx:270](../../apps/web/src/pages/orders/OrderPages.tsx#L270) |
| `OrderPages.dcb46b15` | 写死 | 一会儿 | 提示 | [OrderPages.tsx:270](../../apps/web/src/pages/orders/OrderPages.tsx#L270) |
| `OrderPages.a9604ccf` | 写死 | 重发邮件 | 文字 | [OrderPages.tsx:271](../../apps/web/src/pages/orders/OrderPages.tsx#L271)、283 行 |
| `OrderPages.ba0a3f05` | 写死 | 排队中… | 文字 | [OrderPages.tsx:281](../../apps/web/src/pages/orders/OrderPages.tsx#L281) |
| `OrderPages.0d1ce7db` | 写死 | {…}在 {order\_no} 那一单 | 文字 | [OrderPages.tsx:291](../../apps/web/src/pages/orders/OrderPages.tsx#L291) |
| `OrderPages.4096763a` | 写死 | 司机 | 文字 | [OrderPages.tsx:291](../../apps/web/src/pages/orders/OrderPages.tsx#L291)、366、476 行 |
| `OrderPages.eb7ba877` | 写死 | 车辆 | 文字 | [OrderPages.tsx:291](../../apps/web/src/pages/orders/OrderPages.tsx#L291)、367、477 行 |
| `OrderPages.289a23fd` | 写死 | 请选择司机和车辆 | 文字 | [OrderPages.tsx:309](../../apps/web/src/pages/orders/OrderPages.tsx#L309) |
| `OrderPages.5fd6e04f` | 写死 | 这张单刚被别人派过或改过，请关掉后刷新再派。 | 文字 | [OrderPages.tsx:321](../../apps/web/src/pages/orders/OrderPages.tsx#L321) |
| `OrderPages.e6ce92f2` | 写死 | 这张单现在的状态不能派车或改派（司机已到达上车点之后不能改派）。 | 文字 | [OrderPages.tsx:322](../../apps/web/src/pages/orders/OrderPages.tsx#L322) |
| `OrderPages.1a8a36b3` | 写死 | （同一时段有别的单） | 名称 | [OrderPages.tsx:330](../../apps/web/src/pages/orders/OrderPages.tsx#L330) |
| `OrderPages.ba3493f2` | 写死 | （不能派：{…}） | 名称 | [OrderPages.tsx:330](../../apps/web/src/pages/orders/OrderPages.tsx#L330) |
| `OrderPages.bd24551d` | 写死 | 改派 | 标题 | [OrderPages.tsx:335](../../apps/web/src/pages/orders/OrderPages.tsx#L335)、470 行 |
| `OrderPages.4c1ef447` | 写死 | 取消 | 按钮 | [OrderPages.tsx:345](../../apps/web/src/pages/orders/OrderPages.tsx#L345) |
| `OrderPages.e9569153` | 写死 | 派车中… | 文字 | [OrderPages.tsx:347](../../apps/web/src/pages/orders/OrderPages.tsx#L347)、351 行 |
| `OrderPages.336523b8` | 写死 | 确定派车 | 按钮 | [OrderPages.tsx:349](../../apps/web/src/pages/orders/OrderPages.tsx#L349) |
| `OrderPages.f9bebe02` | 写死 | 仍然派车 | 按钮 | [OrderPages.tsx:353](../../apps/web/src/pages/orders/OrderPages.tsx#L353) |
| `OrderPages.7a26bb67` | 写死 | 正在取可派的司机和车辆… | 正文 | [OrderPages.tsx:358](../../apps/web/src/pages/orders/OrderPages.tsx#L358) |
| `OrderPages.7a04f2cf` | 写死 | 可派的司机和车辆没取到，请关掉后重试。 | 提示 | [OrderPages.tsx:359](../../apps/web/src/pages/orders/OrderPages.tsx#L359) |
| `OrderPages.73418af8` | 写死 | 同一时段已有别的单：{…}。确认没问题就点「仍然派车」。 | 提示 | [OrderPages.tsx:361](../../apps/web/src/pages/orders/OrderPages.tsx#L361) |
| `OrderPages.9aae235d` | 写死 | 还没有在职的司机，请先到「车队 → 司机」登记。 | 提示 | [OrderPages.tsx:364](../../apps/web/src/pages/orders/OrderPages.tsx#L364) |
| `OrderPages.3d1c1fad` | 写死 | 还没有可用的车辆，请先到「车队 → 车辆」登记。 | 提示 | [OrderPages.tsx:365](../../apps/web/src/pages/orders/OrderPages.tsx#L365) |
| `OrderPages.c19f0314` | 写死 | 请选择 | 名称 | [OrderPages.tsx:366](../../apps/web/src/pages/orders/OrderPages.tsx#L366)、367 行 |
| `OrderPages.7619c345` | 写死 | 提示：{…}，时间有重叠。 | 正文 | [OrderPages.tsx:368](../../apps/web/src/pages/orders/OrderPages.tsx#L368) |
| `OrderPages.42df1b2e` | 写死 | 只能派同级或更高级的车型组（升级不加价）；派车后旧的司机链接（包括邮件里的）作废，会给新司机生成一个。 | 正文 | [OrderPages.tsx:369](../../apps/web/src/pages/orders/OrderPages.tsx#L369) |
| `OrderPages.a99d00fe` | 写死 | 订单详情 | 文字 | [OrderPages.tsx:395](../../apps/web/src/pages/orders/OrderPages.tsx#L395) |
| `OrderPages.3d27dfe8` | 写死 | 可能是链接写错了，或这张单不属于你们。 | 说明 | [OrderPages.tsx:401](../../apps/web/src/pages/orders/OrderPages.tsx#L401) |
| `OrderPages.a8d12965` | 写死 | 订单不存在 | 标题 | [OrderPages.tsx:401](../../apps/web/src/pages/orders/OrderPages.tsx#L401) |
| `OrderPages.81ddf2a7` | 写死 | 订单没取到 | 标题 | [OrderPages.tsx:402](../../apps/web/src/pages/orders/OrderPages.tsx#L402) |
| `OrderPages.d41fc828` | 写死 | 请检查网络后刷新。 | 说明 | [OrderPages.tsx:402](../../apps/web/src/pages/orders/OrderPages.tsx#L402) |
| `OrderPages.bcdce718` | 写死 | 加载中… | 正文 | [OrderPages.tsx:403](../../apps/web/src/pages/orders/OrderPages.tsx#L403) |
| `OrderPages.68799c4f` | 写死 | 生成链接 | 文字 | [OrderPages.tsx:414](../../apps/web/src/pages/orders/OrderPages.tsx#L414) |
| `OrderPages.7e417072` | 写死 | 已吊销司机链接 | 提示 | [OrderPages.tsx:420](../../apps/web/src/pages/orders/OrderPages.tsx#L420) |
| `OrderPages.9f131bb4` | 写死 | 吊销 | 文字 | [OrderPages.tsx:423](../../apps/web/src/pages/orders/OrderPages.tsx#L423) |
| `OrderPages.8eb61b76` | 写死 | 这一单已进入救援改派：平台正在安排别的供应商，你们不能再派车或回传。 | 提示 | [OrderPages.tsx:430](../../apps/web/src/pages/orders/OrderPages.tsx#L430) |
| `OrderPages.693ed4b4` | 写死 | 这一单已转给救援供应商，只能查看。违约金和差价见下面的「救援改派」。 | 提示 | [OrderPages.tsx:431](../../apps/web/src/pages/orders/OrderPages.tsx#L431) |
| `OrderPages.1b3847d3` | 写死 | 已过派车截止时间（{…}）还没派车。用车前 6 小时（{…}）仍未派车会进入救援改派。 | 提示 | [OrderPages.tsx:432](../../apps/web/src/pages/orders/OrderPages.tsx#L432) |
| `OrderPages.2ceaded4` | 写死 | 用车时间（当地，{timezone}） | 名称 | [OrderPages.tsx:440](../../apps/web/src/pages/orders/OrderPages.tsx#L440) |
| `OrderPages.9bb16421` | 写死 | 品类 | 名称 | [OrderPages.tsx:441](../../apps/web/src/pages/orders/OrderPages.tsx#L441) |
| `OrderPages.08adba45` | 写死 | 航班号 | 名称 | [OrderPages.tsx:444](../../apps/web/src/pages/orders/OrderPages.tsx#L444) |
| `OrderPages.9a713f2a` | 写死 | {name} · {phone} · {passengers} 人 {luggage} 件行李 | 正文 | [OrderPages.tsx:448](../../apps/web/src/pages/orders/OrderPages.tsx#L448) |
| `OrderPages.a677dec6` | 写死 | 联系人（预订人） | 名称 | [OrderPages.tsx:448](../../apps/web/src/pages/orders/OrderPages.tsx#L448) |
| `OrderPages.cda17cb1` | 写死 | 乘车人 | 名称 | [OrderPages.tsx:449](../../apps/web/src/pages/orders/OrderPages.tsx#L449) |
| `OrderPages.de787c4b` | 写死 | 举牌姓名 | 名称 | [OrderPages.tsx:450](../../apps/web/src/pages/orders/OrderPages.tsx#L450) |
| `OrderPages.1fef660c` | 写死 | 即时通讯 | 名称 | [OrderPages.tsx:451](../../apps/web/src/pages/orders/OrderPages.tsx#L451)、542 行 |
| `OrderPages.5399e1fe` | 写死 | 备注 | 名称 | [OrderPages.tsx:452](../../apps/web/src/pages/orders/OrderPages.tsx#L452) |
| `OrderPages.f6d13e3c` | 写死 | 免费等待 | 名称 | [OrderPages.tsx:453](../../apps/web/src/pages/orders/OrderPages.tsx#L453) |
| `OrderPages.c06b8fcc` | 写死 | 声明无法履约 | 按钮 | [OrderPages.tsx:460](../../apps/web/src/pages/orders/OrderPages.tsx#L460) |
| `OrderPages.5bfec8fd` | 写死 | 派车截止 | 名称 | [OrderPages.tsx:475](../../apps/web/src/pages/orders/OrderPages.tsx#L475) |
| `OrderPages.14dca43d` | 写死 | 未派 | 正文 | [OrderPages.tsx:476](../../apps/web/src/pages/orders/OrderPages.tsx#L476)、477 行 |
| `OrderPages.016f100b` | 写死 | （新车） | 正文 | [OrderPages.tsx:477](../../apps/web/src/pages/orders/OrderPages.tsx#L477) |
| `OrderPages.79e976de` | 写死 | 没有有效的链接 | 正文 | [OrderPages.tsx:480](../../apps/web/src/pages/orders/OrderPages.tsx#L480) |
| `OrderPages.115c2a99` | 写死 | ；司机还没打开过 | 正文 | [OrderPages.tsx:482](../../apps/web/src/pages/orders/OrderPages.tsx#L482) |
| `OrderPages.74dd4598` | 写死 | ；司机最近打开 {…} | 正文 | [OrderPages.tsx:482](../../apps/web/src/pages/orders/OrderPages.tsx#L482) |
| `OrderPages.a34b81fe` | 写死 | 已过期 | 正文 | [OrderPages.tsx:482](../../apps/web/src/pages/orders/OrderPages.tsx#L482) |
| `OrderPages.c29af024` | 写死 | 有效 | 正文 | [OrderPages.tsx:482](../../apps/web/src/pages/orders/OrderPages.tsx#L482) |
| `OrderPages.ef88523c` | 写死 | {…}，到 {…}{…} | 正文 | [OrderPages.tsx:482](../../apps/web/src/pages/orders/OrderPages.tsx#L482) |
| `OrderPages.467a810e` | 写死 | 重新生成司机链接 | 按钮 | [OrderPages.tsx:491](../../apps/web/src/pages/orders/OrderPages.tsx#L491) |
| `OrderPages.1d30d55d` | 写死 | 吊销链接 | 按钮 | [OrderPages.tsx:495](../../apps/web/src/pages/orders/OrderPages.tsx#L495) |
| `OrderPages.eb829b34` | 写死 | 履约（当地时间） | 标题 | [OrderPages.tsx:502](../../apps/web/src/pages/orders/OrderPages.tsx#L502) |
| `OrderPages.8b430c61` | 写死 | 司机出发 | 名称 | [OrderPages.tsx:504](../../apps/web/src/pages/orders/OrderPages.tsx#L504) |
| `OrderPages.444cb4a1` | 写死 | 到达上车点 | 名称 | [OrderPages.tsx:505](../../apps/web/src/pages/orders/OrderPages.tsx#L505) |
| `OrderPages.553fadbd` | 写死 | （距上车点 {arrival\_distance\_m} 米{…}） | 正文 | [OrderPages.tsx:507](../../apps/web/src/pages/orders/OrderPages.tsx#L507) |
| `OrderPages.bfe496c3` | 写死 | ，超过 300 米 | 正文 | [OrderPages.tsx:507](../../apps/web/src/pages/orders/OrderPages.tsx#L507) |
| `OrderPages.78386874` | 写死 | 接到客人 | 名称 | [OrderPages.tsx:509](../../apps/web/src/pages/orders/OrderPages.tsx#L509) |
| `OrderPages.112823e5` | 写死 | 完成 | 名称 | [OrderPages.tsx:510](../../apps/web/src/pages/orders/OrderPages.tsx#L510) |
| `OrderPages.281f2b43` | 写死 | （实际 {actual\_minutes} 分钟、{…} 公里） | 正文 | [OrderPages.tsx:510](../../apps/web/src/pages/orders/OrderPages.tsx#L510) |
| `OrderPages.900e9959` | 写死 | 申请离开 | 名称 | [OrderPages.tsx:511](../../apps/web/src/pages/orders/OrderPages.tsx#L511) |
| `OrderPages.53f02e09` | 写死 | 落地时间（当地时间） | 标题 | [OrderPages.tsx:517](../../apps/web/src/pages/orders/OrderPages.tsx#L517) |
| `OrderPages.531f3227` | 写死 | 实际落地 | 名称 | [OrderPages.tsx:519](../../apps/web/src/pages/orders/OrderPages.tsx#L519) |
| `OrderPages.1e6c0847` | 写死 | 计划到达 | 名称 | [OrderPages.tsx:520](../../apps/web/src/pages/orders/OrderPages.tsx#L520) |
| `OrderPages.f870fcd7` | 写死 | 客人确认 | 名称 | [OrderPages.tsx:521](../../apps/web/src/pages/orders/OrderPages.tsx#L521) |
| `OrderPages.7f260272` | 写死 | 司机填写 | 名称 | [OrderPages.tsx:522](../../apps/web/src/pages/orders/OrderPages.tsx#L522) |
| `OrderPages.14d65524` | 写死 | （6 小时内，顺延接机、不加收） | 正文 | [OrderPages.tsx:523](../../apps/web/src/pages/orders/OrderPages.tsx#L523) |
| `OrderPages.6efe2550` | 写死 | 没有延误 | 正文 | [OrderPages.tsx:523](../../apps/web/src/pages/orders/OrderPages.tsx#L523) |
| `OrderPages.b793216b` | 写死 | {delay\_minutes} 分钟{…} | 正文 | [OrderPages.tsx:523](../../apps/web/src/pages/orders/OrderPages.tsx#L523) |
| `OrderPages.cb14ffbe` | 写死 | （超过 6 小时） | 正文 | [OrderPages.tsx:523](../../apps/web/src/pages/orders/OrderPages.tsx#L523) |
| `OrderPages.d5fb2c23` | 写死 | 延误 | 名称 | [OrderPages.tsx:523](../../apps/web/src/pages/orders/OrderPages.tsx#L523) |
| `OrderPages.45aa6827` | 写死 | 取证规则：客人点「我已落地」优先；没有则取司机填写的（必须拍到达屏）；都没有取计划到达时间。两边都有、不一致时取较晚者。提交后不能改。 | 正文 | [OrderPages.tsx:525](../../apps/web/src/pages/orders/OrderPages.tsx#L525) |
| `OrderPages.4d3d6192` | 写死 | 证据 | 标题 | [OrderPages.tsx:531](../../apps/web/src/pages/orders/OrderPages.tsx#L531) |
| `OrderPages.4c37bd62` | 写死 | 打电话 | 正文 | [OrderPages.tsx:542](../../apps/web/src/pages/orders/OrderPages.tsx#L542) |
| `OrderPages.d6031f0d` | 写死 | 客人未出现：{…} 提交，等平台审核 | 标题 | [OrderPages.tsx:548](../../apps/web/src/pages/orders/OrderPages.tsx#L548) |
| `OrderPages.32bce644` | 写死 | 修改待确认：客人申请了修改，确认前原预约仍然有效。请到下面的「修改记录」处理。 | 提示 | [OrderPages.tsx:559](../../apps/web/src/pages/orders/OrderPages.tsx#L559) |
| `OrderPages.e12fbed0` | 写死 | 通知 | 标题 | [OrderPages.tsx:569](../../apps/web/src/pages/orders/OrderPages.tsx#L569) |
| `OrderPages.e91dbea4` | 写死 | 看这一单发给我们的通知 | 链接 | [OrderPages.tsx:573](../../apps/web/src/pages/orders/OrderPages.tsx#L573) |
| `OrderPages.efac036c` | 写死 | 工单 | 标题 | [OrderPages.tsx:582](../../apps/web/src/pages/orders/OrderPages.tsx#L582) |
| `OrderPages.4315b3d2` | 写死 | 客人投诉、no-show 审核等和这一单有关的工单；平台征求你们意见时要在 24 小时内回复。 | 正文 | [OrderPages.tsx:583](../../apps/web/src/pages/orders/OrderPages.tsx#L583) |
| `OrderPages.8dcf3570` | 写死 | 看这一单的工单 | 链接 | [OrderPages.tsx:587](../../apps/web/src/pages/orders/OrderPages.tsx#L587) |
| `OrderPages.c0791b5f` | 写死 | 就这一单发起工单（失物招领、其他） | 链接 | [OrderPages.tsx:590](../../apps/web/src/pages/orders/OrderPages.tsx#L590) |
| `OrderPages.cec89e3e` | 写死 | 状态流水 | 标题 | [OrderPages.tsx:598](../../apps/web/src/pages/orders/OrderPages.tsx#L598) |
| `OrderPages.4c802d83` | 写死 | 平台代传 | 正文 | [OrderPages.tsx:608](../../apps/web/src/pages/orders/OrderPages.tsx#L608) |
| `OrderPages.4ded6e9c` | 写死 |  系统记录 {…} | 正文 | [OrderPages.tsx:609](../../apps/web/src/pages/orders/OrderPages.tsx#L609) |
| `OrderPages.cbb50872` | 写死 | 这一栏的时间按你的本地时区显示。 | 正文 | [OrderPages.tsx:615](../../apps/web/src/pages/orders/OrderPages.tsx#L615) |
| `OrderPages.ed31e339` | 写死 | 已派车 | 提示 | [OrderPages.tsx:624](../../apps/web/src/pages/orders/OrderPages.tsx#L624) |
| `OrderPages.f74209ac` | 写死 | 已改派 | 提示 | [OrderPages.tsx:624](../../apps/web/src/pages/orders/OrderPages.tsx#L624) |
| `OrderPages.bbbae7c7` | 写死 | 订单 {order\_no} | 文字 | [OrderPages.tsx:643](../../apps/web/src/pages/orders/OrderPages.tsx#L643) |

## 救援单和扣款

文件：`apps/web/src/pages/rescues/TenantRescuePages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantRescuePages.1f49de07` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [TenantRescuePages.tsx:30](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L30) |
| `TenantRescuePages.90bf2ee9` | 写死 | 你没有权限查看这里 | 标题 | [TenantRescuePages.tsx:30](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L30) |
| `TenantRescuePages.961b73d4` | 写死 | 请写明为什么接不了（平台会据此安排救援） | 文字 | [TenantRescuePages.tsx:63](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L63) |
| `TenantRescuePages.d4b33ef1` | 写死 | 已声明无法履约：平台正在安排救援，违约金 {…}% | 文字 | [TenantRescuePages.tsx:70](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L70) |
| `TenantRescuePages.2e19956f` | 写死 | 声明 | 文字 | [TenantRescuePages.tsx:72](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L72) |
| `TenantRescuePages.0e11c4a7` | 写死 | 确认声明 | 按钮 | [TenantRescuePages.tsx:78](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L78) |
| `TenantRescuePages.a55047f0` | 写死 | 声明无法履约 | 标题 | [TenantRescuePages.tsx:78](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L78) |
| `TenantRescuePages.b2d0696e` | 写死 | 再想想 | 按钮 | [TenantRescuePages.tsx:78](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L78) |
| `TenantRescuePages.2bf013f4` | 写死 | 声明后这一单交给平台找别的供应商救援，你们不能再派车、回传，原来的司机链接立即作废。 | 正文 | [TenantRescuePages.tsx:79](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L79) |
| `TenantRescuePages.074f1a15` | 写死 | 按现在声明的违约金 | 名称 | [TenantRescuePages.tsx:82](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L82) |
| `TenantRescuePages.6cef48db` | 写死 | 另外承担 | 名称 | [TenantRescuePages.tsx:83](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L83) |
| `TenantRescuePages.aec38ce1` | 写死 | 救援差价：救援供应商的结算价比这一单的结算价高出的部分（低了记 0） | 正文 | [TenantRescuePages.tsx:83](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L83) |
| `TenantRescuePages.f8995827` | 写死 | 违约金阶梯（按声明时离用车多久）：用车前 24 小时以上 0；2–24 小时 30%；不到 2 小时 100%。不可抗力经平台认定可以免除。现在只记账，结算时从账单里扣。 | 正文 | [TenantRescuePages.tsx:86](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L86) |
| `TenantRescuePages.1afded76` | 写死 | 如「车辆故障，当天没有备用车」 | 说明 | [TenantRescuePages.tsx:87](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L87) |
| `TenantRescuePages.612c36fc` | 写死 | 原因 | 名称 | [TenantRescuePages.tsx:87](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L87)、124 行 |
| `TenantRescuePages.cdd9b856` | 写死 | 应扣款项 | 读屏说明 | [TenantRescuePages.tsx:95](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L95)、276 行 |
| `TenantRescuePages.080b370b` | 写死 | ；免除说明：{waive\_reason} | 正文 | [TenantRescuePages.tsx:100](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L100)、300 行 |
| `TenantRescuePages.65cca457` | 写死 | 救援单 | 标题 | [TenantRescuePages.tsx:113](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L113)、208、209 行 |
| `TenantRescuePages.22364c67` | 写死 | {…} 接单 | 正文 | [TenantRescuePages.tsx:114](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L114) |
| `TenantRescuePages.5ddfd706` | 写死 | 这一单是你们接的救援单（{…}），按普通订单履约，结算价是救援单上的价。 | 正文 | [TenantRescuePages.tsx:114](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L114) |
| `TenantRescuePages.812c701c` | 写死 | 救援改派 | 标题 | [TenantRescuePages.tsx:120](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L120) |
| `TenantRescuePages.2976de42` | 写死 | 情形 | 名称 | [TenantRescuePages.tsx:122](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L122) |
| `TenantRescuePages.40730c86` | 写死 | 时间 | 名称 | [TenantRescuePages.tsx:123](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L123) |
| `TenantRescuePages.bbbd6eef` | 写死 | 违约金 | 名称 | [TenantRescuePages.tsx:125](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L125) |
| `TenantRescuePages.03ee1a0f` | 写死 | 订单已取消 | 正文 | [TenantRescuePages.tsx:126](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L126) |
| `TenantRescuePages.2e46e61b` | 写死 | 平台正在安排救援 | 正文 | [TenantRescuePages.tsx:126](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L126) |
| `TenantRescuePages.39f9fa69` | 写死 | 进展 | 名称 | [TenantRescuePages.tsx:126](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L126) |
| `TenantRescuePages.cf14ba91` | 写死 | 已改派给别的供应商 | 正文 | [TenantRescuePages.tsx:126](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L126) |
| `TenantRescuePages.036d30fa` | 写死 | 平台已认定，应扣款项全部免除 | 正文 | [TenantRescuePages.tsx:127](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L127) |
| `TenantRescuePages.0be1c468` | 写死 | 不可抗力 | 名称 | [TenantRescuePages.tsx:127](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L127) |
| `TenantRescuePages.ee1c5c7e` | 写死 | 应扣款项现在只记账，结算时从你们的账单里扣。 | 正文 | [TenantRescuePages.tsx:131](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L131) |
| `TenantRescuePages.4ea1dfb5` | 写死 | 看全部违约金与扣款 | 链接 | [TenantRescuePages.tsx:134](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L134) |
| `TenantRescuePages.588b767e` | 写死 | 行程 | 名称 | [TenantRescuePages.tsx:168](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L168) |
| `TenantRescuePages.d82fcb29` | 写死 | 人数行李 | 名称 | [TenantRescuePages.tsx:169](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L169) |
| `TenantRescuePages.dc7cb3a7` | 写死 | {passengers} 人 {luggage} 件行李 | 正文 | [TenantRescuePages.tsx:169](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L169) |
| `TenantRescuePages.aa053df0` | 写死 | 结算价 | 名称 | [TenantRescuePages.tsx:170](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L170) |
| `TenantRescuePages.7704bf27` | 写死 | 接单期限 | 名称 | [TenantRescuePages.tsx:171](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L171) |
| `TenantRescuePages.64bc09fa` | 写死 | 拒绝原因 | 名称 | [TenantRescuePages.tsx:172](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L172) |
| `TenantRescuePages.7f8ce0a8` | 写死 | 去订单派车 | 链接 | [TenantRescuePages.tsx:177](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L177) |
| `TenantRescuePages.232d8910` | 写死 | 接单 | 文字 | [TenantRescuePages.tsx:181](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L181)、183 行 |
| `TenantRescuePages.93827ed1` | 写死 | 已接单：去订单里派车 | 文字 | [TenantRescuePages.tsx:181](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L181) |
| `TenantRescuePages.3e3ea81b` | 写死 | 拒绝 | 按钮 | [TenantRescuePages.tsx:186](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L186)、191 行 |
| `TenantRescuePages.7a7484a7` | 写死 | 不拒绝 | 按钮 | [TenantRescuePages.tsx:191](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L191) |
| `TenantRescuePages.e954bbab` | 写死 | 已拒绝 | 文字 | [TenantRescuePages.tsx:191](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L191) |
| `TenantRescuePages.f241c66f` | 写死 | 拒绝救援单 | 标题 | [TenantRescuePages.tsx:191](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L191) |
| `TenantRescuePages.77a544b1` | 写死 | 拒绝不计入你们的履约失败，平台会顺延给下一家。 | 正文 | [TenantRescuePages.tsx:192](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L192) |
| `TenantRescuePages.b502e8dc` | 写死 | 原因（选填） | 名称 | [TenantRescuePages.tsx:193](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L193) |
| `TenantRescuePages.7b167304` | 写死 | 救援单 · NOZOMI {name} | 浏览器标题 | [TenantRescuePages.tsx:202](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L202) |
| `TenantRescuePages.afa90533` | 写死 | 别的供应商接不了的单，平台按报价排序发给你们。救援单是唯一要主动接的订单：15 分钟内（用车前 2 小时内 5 分钟）不接就顺延给下一家。接单前看不到乘客信息，接了在订单里看。 | 正文 | [TenantRescuePages.tsx:218](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L218) |
| `TenantRescuePages.b7e5128c` | 写死 | 救援单没取到 | 标题 | [TenantRescuePages.tsx:219](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L219) |
| `TenantRescuePages.f70571b5` | 写死 | 请检查网络后刷新。 | 说明 | [TenantRescuePages.tsx:219](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L219)、270 行 |
| `TenantRescuePages.664b4032` | 写死 | 还没有救援单 | 标题 | [TenantRescuePages.tsx:220](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L220) |
| `TenantRescuePages.a64dd2ff` | 写死 | 平台发来时这里会出现（订阅了 Webhook 的也会收到 rescue.offered）。 | 说明 | [TenantRescuePages.tsx:220](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L220) |
| `TenantRescuePages.6b2dd44e` | 写死 | 以前的救援单 | 标题 | [TenantRescuePages.tsx:235](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L235) |
| `TenantRescuePages.c13b9a25` | 写死 | 看订单 | 链接 | [TenantRescuePages.tsx:244](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L244) |
| `TenantRescuePages.a2d1f98b` | 写死 | 违约金与扣款 · NOZOMI {name} | 浏览器标题 | [TenantRescuePages.tsx:257](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L257) |
| `TenantRescuePages.c4a67bf2` | 写死 | 违约金与扣款 | 名称 | [TenantRescuePages.tsx:261](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L261)、262 行 |
| `TenantRescuePages.fc5538bc` | 写死 | 你们没有履约、由平台救援改派的订单要承担违约金和救援差价；客人投诉成立、责任在你们的，按统一赔付表承担客人赔付（结算价 × 同一比例），司机未到另承担客人的替代交通报销（工单里能看到判定）。这些在账单里扣；不可抗力经平台认定的、申诉成立的已免除。 | 正文 | [TenantRescuePages.tsx:269](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L269) |
| `TenantRescuePages.a8bb0c9d` | 写死 | 没取到 | 标题 | [TenantRescuePages.tsx:270](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L270) |
| `TenantRescuePages.6229b1da` | 写死 | 没有被救援改派过、也没有判定由你们承担赔付的订单。 | 说明 | [TenantRescuePages.tsx:271](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L271) |
| `TenantRescuePages.e8ca80a4` | 写死 | 没有应扣款项 | 标题 | [TenantRescuePages.tsx:271](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L271) |
| `TenantRescuePages.52548e13` | 写死 | 应扣款项表 | 读屏说明 | [TenantRescuePages.tsx:274](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L274) |
| `TenantRescuePages.02194c8e` | 写死 | 订单号 | 表头 | [TenantRescuePages.tsx:279](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L279) |
| `TenantRescuePages.f6061d25` | 写死 | 款项 | 表头 | [TenantRescuePages.tsx:280](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L280) |
| `TenantRescuePages.06cba45f` | 写死 | 金额 | 表头 | [TenantRescuePages.tsx:281](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L281) |
| `TenantRescuePages.432fe6f0` | 写死 | 状态 | 表头 | [TenantRescuePages.tsx:282](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L282) |
| `TenantRescuePages.4f36c522` | 写死 | 怎么算的 | 表头 | [TenantRescuePages.tsx:283](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L283) |
| `TenantRescuePages.767b45b1` | 写死 | 记账时间 | 表头 | [TenantRescuePages.tsx:284](../../apps/web/src/pages/rescues/TenantRescuePages.tsx#L284) |

## 司机和车辆

文件：`apps/web/src/pages/fleet/FleetPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `FleetPages.1cc67be4` | 写死 | 车队 | 名称 | [FleetPages.tsx:31](../../apps/web/src/pages/fleet/FleetPages.tsx#L31) |
| `FleetPages.1a5b7836` | 写死 | 中文 | 文字 | [FleetPages.tsx:32](../../apps/web/src/pages/fleet/FleetPages.tsx#L32) |
| `FleetPages.13b44268` | 写死 | 30 天内到期 | 名称 | [FleetPages.tsx:36](../../apps/web/src/pages/fleet/FleetPages.tsx#L36) |
| `FleetPages.a763e906` | 写死 | 已过期 | 名称 | [FleetPages.tsx:37](../../apps/web/src/pages/fleet/FleetPages.tsx#L37) |
| `FleetPages.60efe36c` | 写死 | 格式不对 | 文字 | [FleetPages.tsx:57](../../apps/web/src/pages/fleet/FleetPages.tsx#L57) |
| `FleetPages.3f8b8a31` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [FleetPages.tsx:62](../../apps/web/src/pages/fleet/FleetPages.tsx#L62) |
| `FleetPages.cd92d564` | 写死 | 你没有权限查看这里 | 标题 | [FleetPages.tsx:62](../../apps/web/src/pages/fleet/FleetPages.tsx#L62) |
| `FleetPages.fd0c28af` | 写死 | 请填写姓名 | 文字 | [FleetPages.tsx:95](../../apps/web/src/pages/fleet/FleetPages.tsx#L95) |
| `FleetPages.9eac9be2` | 写死 | 请填写电话 | 文字 | [FleetPages.tsx:96](../../apps/web/src/pages/fleet/FleetPages.tsx#L96) |
| `FleetPages.f3d62a3d` | 写死 | 至少选一种语言 | 文字 | [FleetPages.tsx:97](../../apps/web/src/pages/fleet/FleetPages.tsx#L97) |
| `FleetPages.dfb516ba` | 写死 | 请填写驾照到期日 | 文字 | [FleetPages.tsx:98](../../apps/web/src/pages/fleet/FleetPages.tsx#L98) |
| `FleetPages.d4c8b266` | 写死 | 驾龄写整数年 | 文字 | [FleetPages.tsx:99](../../apps/web/src/pages/fleet/FleetPages.tsx#L99) |
| `FleetPages.3f6f5340` | 写死 | 已经有一位司机登记了这个电话 | 文字 | [FleetPages.tsx:111](../../apps/web/src/pages/fleet/FleetPages.tsx#L111) |
| `FleetPages.9e0fe476` | 写死 | 这位司机的资料刚被别人改过，请关掉后刷新再改。 | 文字 | [FleetPages.tsx:112](../../apps/web/src/pages/fleet/FleetPages.tsx#L112) |
| `FleetPages.e7b39079` | 写死 | 保存 | 文字 | [FleetPages.tsx:113](../../apps/web/src/pages/fleet/FleetPages.tsx#L113)、128、324、339 行 |
| `FleetPages.39cb9fdf` | 写死 | 新增司机 | 标题 | [FleetPages.tsx:120](../../apps/web/src/pages/fleet/FleetPages.tsx#L120)、214 行 |
| `FleetPages.d8421408` | 写死 | 修改司机：{name} | 标题 | [FleetPages.tsx:120](../../apps/web/src/pages/fleet/FleetPages.tsx#L120) |
| `FleetPages.eb0b8150` | 写死 | 取消 | 按钮 | [FleetPages.tsx:125](../../apps/web/src/pages/fleet/FleetPages.tsx#L125)、336 行 |
| `FleetPages.c521532d` | 写死 | 保存中… | 文字 | [FleetPages.tsx:126](../../apps/web/src/pages/fleet/FleetPages.tsx#L126)、337 行 |
| `FleetPages.880a754d` | 写死 | 姓名 | 名称 | [FleetPages.tsx:134](../../apps/web/src/pages/fleet/FleetPages.tsx#L134)、177 行 |
| `FleetPages.5f09ef52` | 写死 | 手机 | 名称 | [FleetPages.tsx:135](../../apps/web/src/pages/fleet/FleetPages.tsx#L135)、178 行 |
| `FleetPages.bc7bbee8` | 写死 | 写国际格式，带国家码，如 +81 90-1234-5678（客人来自不同国家） | 说明 | [FleetPages.tsx:135](../../apps/web/src/pages/fleet/FleetPages.tsx#L135) |
| `FleetPages.6f14a491` | 写死 | 自动发送司机链接用。链接能看到客人信息，请填司机本人的邮箱；改了地址，之前发出去的邮件链接会作废 | 说明 | [FleetPages.tsx:136](../../apps/web/src/pages/fleet/FleetPages.tsx#L136) |
| `FleetPages.d83a5c24` | 写死 | 邮箱（选填） | 名称 | [FleetPages.tsx:136](../../apps/web/src/pages/fleet/FleetPages.tsx#L136) |
| `FleetPages.7071389a` | 写死 | 会说的语言 | 标题 | [FleetPages.tsx:137](../../apps/web/src/pages/fleet/FleetPages.tsx#L137) |
| `FleetPages.25eb997b` | 写死 | 驾照到期日 | 名称 | [FleetPages.tsx:138](../../apps/web/src/pages/fleet/FleetPages.tsx#L138) |
| `FleetPages.e4f3d1f9` | 写死 | 到期后不能被派单；到期前 30 天会提示 | 说明 | [FleetPages.tsx:138](../../apps/web/src/pages/fleet/FleetPages.tsx#L138) |
| `FleetPages.15803a9d` | 写死 | 驾龄（年，选填） | 名称 | [FleetPages.tsx:139](../../apps/web/src/pages/fleet/FleetPages.tsx#L139) |
| `FleetPages.4ec45110` | 写死 | 金牌司机 | 标题 | [FleetPages.tsx:140](../../apps/web/src/pages/fleet/FleetPages.tsx#L140) |
| `FleetPages.ca2a6a3f` | 写死 | 是金牌司机（驾龄 10 年以上、从业 5 年以上、连续 3 年无主动责任事故） | 名称 | [FleetPages.tsx:140](../../apps/web/src/pages/fleet/FleetPages.tsx#L140) |
| `FleetPages.8ff40f3e` | 写死 | 状态 | 名称 | [FleetPages.tsx:141](../../apps/web/src/pages/fleet/FleetPages.tsx#L141)、182、220、355、402、440 行 |
| `FleetPages.1455bb0b` | 写死 | 司机 · NOZOMI {name} | 浏览器标题 | [FleetPages.tsx:149](../../apps/web/src/pages/fleet/FleetPages.tsx#L149) |
| `FleetPages.3b4f56f4` | 写死 | 司机 | 名称 | [FleetPages.tsx:160](../../apps/web/src/pages/fleet/FleetPages.tsx#L160)、161、206、208、223 行 |
| `FleetPages.b371773e` | 写死 | 已停用 {name} | 提示 | [FleetPages.tsx:169](../../apps/web/src/pages/fleet/FleetPages.tsx#L169) |
| `FleetPages.79a03c0c` | 写死 | 停用 | 文字 | [FleetPages.tsx:172](../../apps/web/src/pages/fleet/FleetPages.tsx#L172)、196、220、390、416 行 |
| `FleetPages.c59c43f9` | 写死 | 金牌 | 正文 | [FleetPages.tsx:177](../../apps/web/src/pages/fleet/FleetPages.tsx#L177) |
| `FleetPages.157438af` | 写死 | 邮箱 | 文字 | [FleetPages.tsx:179](../../apps/web/src/pages/fleet/FleetPages.tsx#L179) |
| `FleetPages.391e8424` | 写死 | 语言 | 文字 | [FleetPages.tsx:180](../../apps/web/src/pages/fleet/FleetPages.tsx#L180) |
| `FleetPages.c2fd2e39` | 写死 | 驾照到期 | 文字 | [FleetPages.tsx:181](../../apps/web/src/pages/fleet/FleetPages.tsx#L181) |
| `FleetPages.91166087` | 写死 | 操作 | 文字 | [FleetPages.tsx:187](../../apps/web/src/pages/fleet/FleetPages.tsx#L187)、407 行 |
| `FleetPages.4473eabe` | 写死 | 修改 | 按钮 | [FleetPages.tsx:192](../../apps/web/src/pages/fleet/FleetPages.tsx#L192)、412 行 |
| `FleetPages.54c7e400` | 写死 | 派车时只能选在职、驾照在用车日有效、会说客人要求的语言的司机。司机不需要账号：派车后系统给他生成一个专用链接。 | 正文 | [FleetPages.tsx:218](../../apps/web/src/pages/fleet/FleetPages.tsx#L218) |
| `FleetPages.6545bb48` | 写死 | 全部 | 名称 | [FleetPages.tsx:220](../../apps/web/src/pages/fleet/FleetPages.tsx#L220)、440 行 |
| `FleetPages.c754b340` | 写死 | 在职 | 名称 | [FleetPages.tsx:220](../../apps/web/src/pages/fleet/FleetPages.tsx#L220) |
| `FleetPages.49bf47c7` | 写死 | 点右上角「新增司机」登记第一位司机。 | 说明 | [FleetPages.tsx:229](../../apps/web/src/pages/fleet/FleetPages.tsx#L229) |
| `FleetPages.eb4bb359` | 写死 | 管理员或调度登记司机后会显示在这里。 | 说明 | [FleetPages.tsx:229](../../apps/web/src/pages/fleet/FleetPages.tsx#L229) |
| `FleetPages.f8ebe6a9` | 写死 | 还没有司机 | 标题 | [FleetPages.tsx:229](../../apps/web/src/pages/fleet/FleetPages.tsx#L229) |
| `FleetPages.bdb82d7b` | 写死 | 已保存 {name} | 提示 | [FleetPages.tsx:238](../../apps/web/src/pages/fleet/FleetPages.tsx#L238) |
| `FleetPages.cd58dd6b` | 写死 | 请填写车牌 | 文字 | [FleetPages.tsx:292](../../apps/web/src/pages/fleet/FleetPages.tsx#L292) |
| `FleetPages.606df3de` | 写死 | 请选择车型组 | 文字 | [FleetPages.tsx:293](../../apps/web/src/pages/fleet/FleetPages.tsx#L293) |
| `FleetPages.b4de4544` | 写死 | 请填写品牌车型 | 文字 | [FleetPages.tsx:294](../../apps/web/src/pages/fleet/FleetPages.tsx#L294) |
| `FleetPages.031ff78d` | 写死 | 座位数写整数 | 文字 | [FleetPages.tsx:295](../../apps/web/src/pages/fleet/FleetPages.tsx#L295) |
| `FleetPages.71e8809f` | 写死 | 里程写整数公里 | 文字 | [FleetPages.tsx:296](../../apps/web/src/pages/fleet/FleetPages.tsx#L296) |
| `FleetPages.93adaadc` | 写死 | 请填写保险到期日 | 文字 | [FleetPages.tsx:297](../../apps/web/src/pages/fleet/FleetPages.tsx#L297) |
| `FleetPages.9edef4ba` | 写死 | 请填写车检到期日 | 文字 | [FleetPages.tsx:298](../../apps/web/src/pages/fleet/FleetPages.tsx#L298) |
| `FleetPages.e8a31e2e` | 写死 | 非营业牌照的车不能设为「可用」（不能收费载客） | 文字 | [FleetPages.tsx:299](../../apps/web/src/pages/fleet/FleetPages.tsx#L299) |
| `FleetPages.a747af13` | 写死 | 已经登记过这个车牌 | 文字 | [FleetPages.tsx:322](../../apps/web/src/pages/fleet/FleetPages.tsx#L322) |
| `FleetPages.faf07107` | 写死 | 这辆车的资料刚被别人改过，请关掉后刷新再改。 | 文字 | [FleetPages.tsx:323](../../apps/web/src/pages/fleet/FleetPages.tsx#L323) |
| `FleetPages.3e9bfe89` | 写死 | 新增车辆 | 标题 | [FleetPages.tsx:331](../../apps/web/src/pages/fleet/FleetPages.tsx#L331)、434 行 |
| `FleetPages.d3e9488a` | 写死 | 修改车辆：{plate} | 标题 | [FleetPages.tsx:331](../../apps/web/src/pages/fleet/FleetPages.tsx#L331) |
| `FleetPages.2c83f377` | 写死 | 车牌 | 名称 | [FleetPages.tsx:345](../../apps/web/src/pages/fleet/FleetPages.tsx#L345)、395 行 |
| `FleetPages.562ce15a` | 写死 | 请选择 | 名称 | [FleetPages.tsx:346](../../apps/web/src/pages/fleet/FleetPages.tsx#L346) |
| `FleetPages.664fb876` | 写死 | 车型组 | 名称 | [FleetPages.tsx:346](../../apps/web/src/pages/fleet/FleetPages.tsx#L346)、396 行 |
| `FleetPages.a8041c51` | 写死 | 如：丰田埃尔法 | 输入框占位 | [FleetPages.tsx:348](../../apps/web/src/pages/fleet/FleetPages.tsx#L348) |
| `FleetPages.e9375824` | 写死 | 品牌车型 | 名称 | [FleetPages.tsx:348](../../apps/web/src/pages/fleet/FleetPages.tsx#L348) |
| `FleetPages.04c829aa` | 写死 | 颜色（选填） | 名称 | [FleetPages.tsx:349](../../apps/web/src/pages/fleet/FleetPages.tsx#L349) |
| `FleetPages.f526aecc` | 写死 | 座位数（含司机） | 名称 | [FleetPages.tsx:350](../../apps/web/src/pages/fleet/FleetPages.tsx#L350) |
| `FleetPages.a2a1d802` | 写死 | 累计里程（公里） | 名称 | [FleetPages.tsx:351](../../apps/web/src/pages/fleet/FleetPages.tsx#L351) |
| `FleetPages.be492c79` | 写死 | 小于 5 万公里自动算新车 | 说明 | [FleetPages.tsx:351](../../apps/web/src/pages/fleet/FleetPages.tsx#L351) |
| `FleetPages.51f93d1d` | 写死 | 牌照 | 名称 | [FleetPages.tsx:352](../../apps/web/src/pages/fleet/FleetPages.tsx#L352)、399 行 |
| `FleetPages.5f88cc88` | 写死 | 保险到期日 | 名称 | [FleetPages.tsx:353](../../apps/web/src/pages/fleet/FleetPages.tsx#L353) |
| `FleetPages.3aef2a53` | 写死 | 车检到期日 | 名称 | [FleetPages.tsx:354](../../apps/web/src/pages/fleet/FleetPages.tsx#L354) |
| `FleetPages.55610ee6` | 写死 | 车辆 · NOZOMI {name} | 浏览器标题 | [FleetPages.tsx:364](../../apps/web/src/pages/fleet/FleetPages.tsx#L364) |
| `FleetPages.6d0306b3` | 写死 | 车辆 | 名称 | [FleetPages.tsx:378](../../apps/web/src/pages/fleet/FleetPages.tsx#L378)、379、426、428、443 行 |
| `FleetPages.15a6535b` | 写死 | 已停用 {plate} | 提示 | [FleetPages.tsx:387](../../apps/web/src/pages/fleet/FleetPages.tsx#L387) |
| `FleetPages.ada5e32e` | 写死 | 新车 | 正文 | [FleetPages.tsx:395](../../apps/web/src/pages/fleet/FleetPages.tsx#L395) |
| `FleetPages.ab61b2c3` | 写死 | 车型 | 文字 | [FleetPages.tsx:397](../../apps/web/src/pages/fleet/FleetPages.tsx#L397) |
| `FleetPages.5d5bc13c` | 写死 | 座位 | 文字 | [FleetPages.tsx:398](../../apps/web/src/pages/fleet/FleetPages.tsx#L398) |
| `FleetPages.afdff01a` | 写死 | 保险到期 | 文字 | [FleetPages.tsx:400](../../apps/web/src/pages/fleet/FleetPages.tsx#L400) |
| `FleetPages.2dbfc8fc` | 写死 | 车检到期 | 文字 | [FleetPages.tsx:401](../../apps/web/src/pages/fleet/FleetPages.tsx#L401) |
| `FleetPages.8ca0e9e0` | 写死 | 派车时只能选可用、营业牌照、保险和车检在用车日有效、车型组不低于订单的车辆。 | 正文 | [FleetPages.tsx:438](../../apps/web/src/pages/fleet/FleetPages.tsx#L438) |
| `FleetPages.13f0b78d` | 写死 | 管理员或调度登记车辆后会显示在这里。 | 说明 | [FleetPages.tsx:449](../../apps/web/src/pages/fleet/FleetPages.tsx#L449) |
| `FleetPages.1e985a1f` | 写死 | 还没有车辆 | 标题 | [FleetPages.tsx:449](../../apps/web/src/pages/fleet/FleetPages.tsx#L449) |
| `FleetPages.f617c93f` | 写死 | 点右上角「新增车辆」登记第一辆车。 | 说明 | [FleetPages.tsx:449](../../apps/web/src/pages/fleet/FleetPages.tsx#L449) |
| `FleetPages.2c4587f8` | 写死 | 已保存 {plate} | 提示 | [FleetPages.tsx:459](../../apps/web/src/pages/fleet/FleetPages.tsx#L459) |

## Webhook 设置（运营后台的推送记录也在这里）

文件：`apps/web/src/pages/webhooks/WebhookPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `WebhookPages.46ec86ec` | 写死 | 不是合法的网址 | 提示 | [WebhookPages.tsx:49](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L49) |
| `WebhookPages.014efbec` | 写死 | 网址太长了（最多 2048 个字符） | 文字 | [WebhookPages.tsx:50](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L50) |
| `WebhookPages.b0013c07` | 写死 | 只接受 https 开头的地址 | 文字 | [WebhookPages.tsx:51](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L51) |
| `WebhookPages.33189a25` | 写死 | 网址里不能带账号和密码 | 文字 | [WebhookPages.tsx:52](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L52) |
| `WebhookPages.cae73ba5` | 写死 | 网址里不能带 \# | 文字 | [WebhookPages.tsx:53](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L53) |
| `WebhookPages.f000cc29` | 写死 | 不能推送到内网、本机或云服务器的元数据地址，请填公网可以访问的地址 | 文字 | [WebhookPages.tsx:54](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L54) |
| `WebhookPages.b0560e14` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [WebhookPages.tsx:57](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L57) |
| `WebhookPages.e592f518` | 写死 | 你没有权限查看这里 | 标题 | [WebhookPages.tsx:57](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L57) |
| `WebhookPages.f6fbfda9` | 写死 | 签名密钥 | 标题 | [WebhookPages.tsx:69](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L69)、81 行 |
| `WebhookPages.acc1fb7e` | 写死 | 我已保存 | 按钮 | [WebhookPages.tsx:74](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L74) |
| `WebhookPages.88ab8b3a` | 写死 | 签名密钥只在这里显示这一次。请马上复制到你们调度系统的设置里；关掉后只能换一把新的。 | 提示 | [WebhookPages.tsx:77](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L77) |
| `WebhookPages.e5134f5f` | 写死 | 复制签名密钥 | 名称 | [WebhookPages.tsx:84](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L84) |
| `WebhookPages.2cf1cb05` | 写死 | 验签：HMAC-SHA256(签名密钥, "&lt;X-Timestamp&gt;.&lt;请求体原文&gt;") 的十六进制，和请求头 X-Signature 里 v1= 后面的比较；时间戳相差超过 5 分钟的拒绝；同一个 X-Event-Id 只处理一次。 | 正文 | [WebhookPages.tsx:86](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L86) |
| `WebhookPages.7ece147b` | 写死 | 排队时间 | 文字 | [WebhookPages.tsx:94](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L94) |
| `WebhookPages.2c5a1074` | 写死 | 供应商 | 文字 | [WebhookPages.tsx:95](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L95) |
| `WebhookPages.40be5b3e` | 写死 | 事件 | 文字 | [WebhookPages.tsx:96](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L96) |
| `WebhookPages.795045bf` | 写死 | 查看 | 链接 | [WebhookPages.tsx:97](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L97) |
| `WebhookPages.faed7cc0` | 写死 | 订单 | 文字 | [WebhookPages.tsx:97](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L97)、264 行 |
| `WebhookPages.29de3c7c` | 写死 | 状态 | 文字 | [WebhookPages.tsx:98](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L98)、225、281 行 |
| `WebhookPages.d8b0282a` | 写死 | 尝试 | 文字 | [WebhookPages.tsx:99](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L99) |
| `WebhookPages.b800e587` | 写死 | 最近一次 | 文字 | [WebhookPages.tsx:102](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L102) |
| `WebhookPages.bab1a53a` | 写死 | 下次重试 {…} | 正文 | [WebhookPages.tsx:107](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L107) |
| `WebhookPages.38167130` | 写死 | 操作 | 文字 | [WebhookPages.tsx:111](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L111) |
| `WebhookPages.6767a255` | 写死 | 调度对接（Webhook）· NOZOMI {name} | 浏览器标题 | [WebhookPages.tsx:117](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L117) |
| `WebhookPages.2e5d5194` | 写死 | 设置 | 名称 | [WebhookPages.tsx:146](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L146) |
| `WebhookPages.4791ca93` | 写死 | 调度对接（Webhook） | 名称 | [WebhookPages.tsx:146](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L146)、147 行 |
| `WebhookPages.aa3a8ef7` | 写死 | 至少订阅一个事件 | 文字 | [WebhookPages.tsx:157](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L157) |
| `WebhookPages.b8656d5a` | 写死 | 已保存 Webhook 设置 | 提示 | [WebhookPages.tsx:164](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L164) |
| `WebhookPages.4594ed01` | 写死 | 平台还没有配置数据加密密钥，现在不能设置 Webhook。请联系平台。 | 文字 | [WebhookPages.tsx:169](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L169) |
| `WebhookPages.f5723d5c` | 写死 | 设置刚被别人改过，请刷新后再改。 | 文字 | [WebhookPages.tsx:170](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L170) |
| `WebhookPages.9ccba557` | 写死 | 保存 | 文字 | [WebhookPages.tsx:171](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L171)、202 行 |
| `WebhookPages.6ba465ab` | 写死 | 有自己调度系统的话，在这里填接收地址：新订单、派车、履约状态变化会签名后推送过去。没有调度系统的不用设置，在「订单」里派车即可。 | 正文 | [WebhookPages.tsx:186](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L186) |
| `WebhookPages.78d84ddc` | 写死 | 平台还没有配置数据加密密钥，暂时不能设置 Webhook。 | 提示 | [WebhookPages.tsx:187](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L187) |
| `WebhookPages.4ce34adf` | 写死 | 接收地址 | 标题 | [WebhookPages.tsx:189](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L189)、192 行 |
| `WebhookPages.c40d6b5f` | 写死 | 你们调度系统接收推送的地址：只接受公网可以访问的 https 地址；不跟随重定向；5 秒内要回 2xx。 | 说明 | [WebhookPages.tsx:192](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L192) |
| `WebhookPages.0aa75018` | 写死 | 订阅的事件 | 标题 | [WebhookPages.tsx:193](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L193) |
| `WebhookPages.450b5d5d` | 写死 | 暂停推送（暂停期间新事件不排队） | 名称 | [WebhookPages.tsx:194](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L194) |
| `WebhookPages.bf3b1f26` | 写死 | 暂停 | 标题 | [WebhookPages.tsx:194](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L194) |
| `WebhookPages.a944587f` | 写死 | 签名密钥末 4 位：{secret\_hint}（{…} 生成） | 正文 | [WebhookPages.tsx:195](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L195) |
| `WebhookPages.6de8276b` | 写死 | 失败后按 {…} 重试，共 {max\_attempts} 次；仍失败的在下面的推送记录里标为「失败」，可以手动重推。 | 正文 | [WebhookPages.tsx:197](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L197) |
| `WebhookPages.7fc2c1b4` | 写死 | 保存中… | 文字 | [WebhookPages.tsx:201](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L201) |
| `WebhookPages.a927e9d2` | 写死 | 保存并生成签名密钥 | 按钮 | [WebhookPages.tsx:202](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L202) |
| `WebhookPages.a5647d09` | 写死 | 测试事件已送达 | 提示 | [WebhookPages.tsx:206](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L206) |
| `WebhookPages.d1a0a1d7` | 写死 | 测试事件没送到：{…} | 提示 | [WebhookPages.tsx:206](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L206) |
| `WebhookPages.e2933ff3` | 写死 | 发送 | 文字 | [WebhookPages.tsx:206](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L206) |
| `WebhookPages.5ed21ce4` | 写死 | 发送测试事件 | 按钮 | [WebhookPages.tsx:208](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L208) |
| `WebhookPages.f84fa633` | 写死 | 换密钥 | 文字 | [WebhookPages.tsx:209](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L209) |
| `WebhookPages.329d3b4e` | 写死 | 换签名密钥 | 按钮 | [WebhookPages.tsx:211](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L211) |
| `WebhookPages.427ecf4d` | 写死 | 删除 | 文字 | [WebhookPages.tsx:212](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L212) |
| `WebhookPages.be3889f5` | 写死 | 已删除 Webhook 设置 | 提示 | [WebhookPages.tsx:212](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L212) |
| `WebhookPages.2d17bb01` | 写死 | 删除设置 | 按钮 | [WebhookPages.tsx:214](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L214) |
| `WebhookPages.3a5a0e95` | 写死 | 推送记录 | 标题 | [WebhookPages.tsx:224](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L224)、228、264、284 行 |
| `WebhookPages.413fdbc4` | 写死 | 全部 | 名称 | [WebhookPages.tsx:225](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L225)、281 行 |
| `WebhookPages.9e86de26` | 写死 | 等待投递 | 名称 | [WebhookPages.tsx:225](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L225)、281 行 |
| `WebhookPages.d687483d` | 写死 | 失败（等人工重推） | 名称 | [WebhookPages.tsx:225](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L225)、281 行 |
| `WebhookPages.e22638e2` | 写死 | 成功 | 名称 | [WebhookPages.tsx:225](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L225)、281 行 |
| `WebhookPages.d3fc4b70` | 写死 | 重推 | 文字 | [WebhookPages.tsx:234](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L234)、236、274、285 行 |
| `WebhookPages.164dd284` | 写死 | 设置好接收地址后，新订单、派车、履约状态变化会推送过去。 | 说明 | [WebhookPages.tsx:245](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L245) |
| `WebhookPages.8fe82648` | 写死 | 还没有推送记录 | 标题 | [WebhookPages.tsx:245](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L245) |
| `WebhookPages.cad820df` | 写死 | 推送记录 · NOZOMI {name} | 浏览器标题 | [WebhookPages.tsx:255](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L255) |
| `WebhookPages.b87304c6` | 写死 | 推送给供应商的 Webhook | 标题 | [WebhookPages.tsx:265](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L265) |
| `WebhookPages.74e0ad65` | 写死 | 重试 7 次（约 32 小时）仍然失败的推送是异常，默认只看这些。联系供应商确认接收地址恢复后，可以手动重推（同一个事件编号，对方按它去重）。 | 正文 | [WebhookPages.tsx:279](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L279) |
| `WebhookPages.68904c40` | 写死 | 供应商设置了 Webhook 后，推送记录会显示在这里。 | 说明 | [WebhookPages.tsx:290](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L290) |
| `WebhookPages.7cb170b8` | 写死 | 没有失败的推送 | 标题 | [WebhookPages.tsx:290](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L290) |
| `WebhookPages.bee63e45` | 写死 | 没有推送记录 | 标题 | [WebhookPages.tsx:290](../../apps/web/src/pages/webhooks/WebhookPages.tsx#L290) |

## 通知（运营后台的通知中心、通知模板也在这里）

文件：`apps/web/src/pages/notifications/NotificationPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `NotificationPages.829ac61e` | 写死 | 你没有权限查看这里 | 标题 | [NotificationPages.tsx:41](../../apps/web/src/pages/notifications/NotificationPages.tsx#L41) |
| `NotificationPages.c733bc03` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [NotificationPages.tsx:41](../../apps/web/src/pages/notifications/NotificationPages.tsx#L41) |
| `NotificationPages.48d71ded` | 写死 | 时间 | 文字 | [NotificationPages.tsx:60](../../apps/web/src/pages/notifications/NotificationPages.tsx#L60) |
| `NotificationPages.43a76c4e` | 写死 | 事件 | 文字 | [NotificationPages.tsx:61](../../apps/web/src/pages/notifications/NotificationPages.tsx#L61)、143、182 行 |
| `NotificationPages.615461b6` | 写死 | 接收方 | 文字 | [NotificationPages.tsx:62](../../apps/web/src/pages/notifications/NotificationPages.tsx#L62)、142、183 行 |
| `NotificationPages.83fa310f` | 写死 | 收件人 | 文字 | [NotificationPages.tsx:63](../../apps/web/src/pages/notifications/NotificationPages.tsx#L63) |
| `NotificationPages.7baf818e` | 写死 | 订单 | 文字 | [NotificationPages.tsx:64](../../apps/web/src/pages/notifications/NotificationPages.tsx#L64) |
| `NotificationPages.2fe04dbe` | 写死 | 状态 | 文字 | [NotificationPages.tsx:65](../../apps/web/src/pages/notifications/NotificationPages.tsx#L65)、141、322 行 |
| `NotificationPages.62513ed4` | 写死 | 尝试 | 文字 | [NotificationPages.tsx:66](../../apps/web/src/pages/notifications/NotificationPages.tsx#L66) |
| `NotificationPages.aad911c0` | 写死 | 说明 | 文字 | [NotificationPages.tsx:69](../../apps/web/src/pages/notifications/NotificationPages.tsx#L69) |
| `NotificationPages.cacfdd2f` | 写死 | {…} 邮件服务器已接收 | 正文 | [NotificationPages.tsx:73](../../apps/web/src/pages/notifications/NotificationPages.tsx#L73) |
| `NotificationPages.05e7200a` | 写死 | 下次发送 {…} | 正文 | [NotificationPages.tsx:74](../../apps/web/src/pages/notifications/NotificationPages.tsx#L74) |
| `NotificationPages.5311d2d1` | 写死 | 过了 {…} 不再发送 | 正文 | [NotificationPages.tsx:75](../../apps/web/src/pages/notifications/NotificationPages.tsx#L75) |
| `NotificationPages.6642f9f9` | 写死 | 操作 | 文字 | [NotificationPages.tsx:79](../../apps/web/src/pages/notifications/NotificationPages.tsx#L79) |
| `NotificationPages.5856372b` | 写死 | 通知记录 · NOZOMI {name} | 浏览器标题 | [NotificationPages.tsx:85](../../apps/web/src/pages/notifications/NotificationPages.tsx#L85) |
| `NotificationPages.48ebd2e4` | 写死 | 通知记录 | 名称 | [NotificationPages.tsx:102](../../apps/web/src/pages/notifications/NotificationPages.tsx#L102)、103、157 行 |
| `NotificationPages.bbac638b` | 写死 | 通知中心 | 名称 | [NotificationPages.tsx:102](../../apps/web/src/pages/notifications/NotificationPages.tsx#L102)、176 行 |
| `NotificationPages.66eb95be` | 写死 | 还是没有发出去：{…} | 提示 | [NotificationPages.tsx:117](../../apps/web/src/pages/notifications/NotificationPages.tsx#L117) |
| `NotificationPages.9d4b7dd2` | 写死 | 请稍后再试 | 提示 | [NotificationPages.tsx:117](../../apps/web/src/pages/notifications/NotificationPages.tsx#L117) |
| `NotificationPages.f95d5d0c` | 写死 | 已发送：邮件服务器已接收 | 提示 | [NotificationPages.tsx:117](../../apps/web/src/pages/notifications/NotificationPages.tsx#L117) |
| `NotificationPages.1f678b0d` | 写死 | 重试 | 文字 | [NotificationPages.tsx:120](../../apps/web/src/pages/notifications/NotificationPages.tsx#L120)、158 行 |
| `NotificationPages.39750b72` | 写死 | 每一条通知的发送情况。「已发送」表示邮件服务器已接收，不等于已进收件箱。收件人已打码，这里不显示邮件内容。 | 正文 | [NotificationPages.tsx:129](../../apps/web/src/pages/notifications/NotificationPages.tsx#L129) |
| `NotificationPages.74662400` | 写死 | 看通知模板 | 链接 | [NotificationPages.tsx:129](../../apps/web/src/pages/notifications/NotificationPages.tsx#L129) |
| `NotificationPages.05fe71a2` | 写死 | {waiting} 条通知在等待， | 提示 | [NotificationPages.tsx:132](../../apps/web/src/pages/notifications/NotificationPages.tsx#L132) |
| `NotificationPages.1dc2058f` | 写死 | 通知会先留着， | 提示 | [NotificationPages.tsx:132](../../apps/web/src/pages/notifications/NotificationPages.tsx#L132) |
| `NotificationPages.28b970a6` | 写死 | 邮件发送还没有配置，所以现在一封都发不出去。下单、付款、派车不受影响；{…}配好后自动发送，过了有效期的不再发送。请超级管理员在「系统设置 → 系统状态」填写。 | 提示 | [NotificationPages.tsx:132](../../apps/web/src/pages/notifications/NotificationPages.tsx#L132) |
| `NotificationPages.b1a06fe5` | 写死 | 有 {failed\_events} 个通知事件内容有问题，没能生成发送记录，这些通知发不出去。请把这句话转给技术查服务日志（notification.expand\_failed）。 | 提示 | [NotificationPages.tsx:134](../../apps/web/src/pages/notifications/NotificationPages.tsx#L134) |
| `NotificationPages.36a54944` | 写死 | 看全部 | 按钮 | [NotificationPages.tsx:137](../../apps/web/src/pages/notifications/NotificationPages.tsx#L137)、316 行 |
| `NotificationPages.d6684571` | 写死 | 只看这一单的通知。 | 提示 | [NotificationPages.tsx:137](../../apps/web/src/pages/notifications/NotificationPages.tsx#L137)、316 行 |
| `NotificationPages.05cd9e12` | 写死 | 全部 | 名称 | [NotificationPages.tsx:141](../../apps/web/src/pages/notifications/NotificationPages.tsx#L141)、142、143、324 行 |
| `NotificationPages.2aae0c0c` | 写死 | 订单号 | 名称 | [NotificationPages.tsx:152](../../apps/web/src/pages/notifications/NotificationPages.tsx#L152) |
| `NotificationPages.854f11f6` | 写死 | 查找 | 按钮 | [NotificationPages.tsx:153](../../apps/web/src/pages/notifications/NotificationPages.tsx#L153) |
| `NotificationPages.363073d7` | 写死 | 发送中… | 文字 | [NotificationPages.tsx:158](../../apps/web/src/pages/notifications/NotificationPages.tsx#L158) |
| `NotificationPages.081b7659` | 写死 | 没有通知记录 | 标题 | [NotificationPages.tsx:163](../../apps/web/src/pages/notifications/NotificationPages.tsx#L163) |
| `NotificationPages.9d5efbd1` | 写死 | 下单、派车等事情发生后，通知记录会显示在这里。 | 说明 | [NotificationPages.tsx:163](../../apps/web/src/pages/notifications/NotificationPages.tsx#L163) |
| `NotificationPages.e7c5d5d0` | 写死 | 共 {total} 条，这里显示最新的 {length} 条；按订单号或状态筛选可以找到更早的。 | 正文 | [NotificationPages.tsx:165](../../apps/web/src/pages/notifications/NotificationPages.tsx#L165) |
| `NotificationPages.47544321` | 写死 | 通知模板 · NOZOMI {name} | 浏览器标题 | [NotificationPages.tsx:172](../../apps/web/src/pages/notifications/NotificationPages.tsx#L172) |
| `NotificationPages.c506be38` | 写死 | 通知模板 | 名称 | [NotificationPages.tsx:176](../../apps/web/src/pages/notifications/NotificationPages.tsx#L176)、177、192 行 |
| `NotificationPages.62f59b1d` | 写死 | 语言 | 文字 | [NotificationPages.tsx:184](../../apps/web/src/pages/notifications/NotificationPages.tsx#L184) |
| `NotificationPages.8236e2fc` | 写死 | 简体中文 | 文字 | [NotificationPages.tsx:184](../../apps/web/src/pages/notifications/NotificationPages.tsx#L184) |
| `NotificationPages.1dc3aea4` | 写死 | 通道 | 文字 | [NotificationPages.tsx:185](../../apps/web/src/pages/notifications/NotificationPages.tsx#L185) |
| `NotificationPages.9efd0922` | 写死 | 邮件 | 文字 | [NotificationPages.tsx:185](../../apps/web/src/pages/notifications/NotificationPages.tsx#L185) |
| `NotificationPages.b55879f7` | 写死 | 主题 | 文字 | [NotificationPages.tsx:186](../../apps/web/src/pages/notifications/NotificationPages.tsx#L186) |
| `NotificationPages.a28a882e` | 写死 | 正文 | 文字 | [NotificationPages.tsx:187](../../apps/web/src/pages/notifications/NotificationPages.tsx#L187) |
| `NotificationPages.b2868d33` | 写死 | 按事件、接收方、语言、通道各一份。{{order\_no}} 这样的写法是发送时才填的内容。模板现在由开发维护，这里只能看，要改文案请告诉开发。 | 正文 | [NotificationPages.tsx:191](../../apps/web/src/pages/notifications/NotificationPages.tsx#L191) |
| `NotificationPages.909f5069` | 写死 | 没有模板 | 标题 | [NotificationPages.tsx:192](../../apps/web/src/pages/notifications/NotificationPages.tsx#L192) |
| `NotificationPages.684e6ef4` | 写死 | 开始和结束要一起填；都留空就是不设免打扰 | 文字 | [NotificationPages.tsx:207](../../apps/web/src/pages/notifications/NotificationPages.tsx#L207) |
| `NotificationPages.52bc6c56` | 写死 | 开始和结束不能是同一个时间 | 文字 | [NotificationPages.tsx:213](../../apps/web/src/pages/notifications/NotificationPages.tsx#L213) |
| `NotificationPages.8a4bcbec` | 写死 | 时间要写成 22:00 这样 | 文字 | [NotificationPages.tsx:213](../../apps/web/src/pages/notifications/NotificationPages.tsx#L213) |
| `NotificationPages.feeddaba` | 写死 | 已保存 | 提示 | [NotificationPages.tsx:220](../../apps/web/src/pages/notifications/NotificationPages.tsx#L220)、260 行 |
| `NotificationPages.1a7f7b54` | 写死 | 别人刚改过，请刷新页面后再改 | 文字 | [NotificationPages.tsx:223](../../apps/web/src/pages/notifications/NotificationPages.tsx#L223)、263 行 |
| `NotificationPages.2e235988` | 写死 | 保存 | 文字 | [NotificationPages.tsx:223](../../apps/web/src/pages/notifications/NotificationPages.tsx#L223)、238、263 行 |
| `NotificationPages.989c1d6e` | 写死 | 免打扰时段 | 标题 | [NotificationPages.tsx:230](../../apps/web/src/pages/notifications/NotificationPages.tsx#L230) |
| `NotificationPages.d70ec45c` | 写死 | 这个时段里的通知邮件等时段结束后再发。用车当天的订单通知不受限制，照常马上发。时间是东京时间，可以跨午夜（如 22:00 到 07:00）。 | 正文 | [NotificationPages.tsx:231](../../apps/web/src/pages/notifications/NotificationPages.tsx#L231) |
| `NotificationPages.2a0d5f88` | 写死 | 开始 | 名称 | [NotificationPages.tsx:234](../../apps/web/src/pages/notifications/NotificationPages.tsx#L234) |
| `NotificationPages.38ff9979` | 写死 | 结束 | 名称 | [NotificationPages.tsx:235](../../apps/web/src/pages/notifications/NotificationPages.tsx#L235) |
| `NotificationPages.edb594aa` | 写死 | 保存中… | 文字 | [NotificationPages.tsx:238](../../apps/web/src/pages/notifications/NotificationPages.tsx#L238)、277 行 |
| `NotificationPages.055b5636` | 写死 | 只有管理员能改。 | 正文 | [NotificationPages.tsx:241](../../apps/web/src/pages/notifications/NotificationPages.tsx#L241) |
| `NotificationPages.cc43a412` | 写死 | 司机链接发送方式 | 标题 | [NotificationPages.tsx:270](../../apps/web/src/pages/notifications/NotificationPages.tsx#L270) |
| `NotificationPages.a4294089` | 写死 | 选「系统自动发送」时，派车或改派后系统把司机链接发到司机档案里的邮箱；司机没有邮箱时提示调度员手动发。不管选哪一种，调度员都能复制链接。 | 正文 | [NotificationPages.tsx:271](../../apps/web/src/pages/notifications/NotificationPages.tsx#L271) |
| `NotificationPages.56634f21` | 写死 | 发送方式 | 名称 | [NotificationPages.tsx:275](../../apps/web/src/pages/notifications/NotificationPages.tsx#L275) |
| `NotificationPages.ce76c9b7` | 写死 | 更新发送方式 | 按钮 | [NotificationPages.tsx:277](../../apps/web/src/pages/notifications/NotificationPages.tsx#L277) |
| `NotificationPages.12f31d55` | 写死 | 现在是「{…}」。只有管理员能改。 | 正文 | [NotificationPages.tsx:281](../../apps/web/src/pages/notifications/NotificationPages.tsx#L281) |
| `NotificationPages.d300f25b` | 写死 | 通知 · NOZOMI {name} | 浏览器标题 | [NotificationPages.tsx:289](../../apps/web/src/pages/notifications/NotificationPages.tsx#L289) |
| `NotificationPages.3afd4c49` | 写死 | 设置 | 名称 | [NotificationPages.tsx:298](../../apps/web/src/pages/notifications/NotificationPages.tsx#L298) |
| `NotificationPages.c802bc5f` | 写死 | 通知 | 名称 | [NotificationPages.tsx:298](../../apps/web/src/pages/notifications/NotificationPages.tsx#L298)、299 行 |
| `NotificationPages.cc3cabb3` | 写死 | 新订单、修改、取消、派车提醒等通知会发邮件给你们的管理员和调度。 | 正文 | [NotificationPages.tsx:305](../../apps/web/src/pages/notifications/NotificationPages.tsx#L305) |
| `NotificationPages.2d57c9d4` | 写死 | 免打扰设置没有读出来，请刷新页面再试。 | 提示 | [NotificationPages.tsx:306](../../apps/web/src/pages/notifications/NotificationPages.tsx#L306) |
| `NotificationPages.bbcb09ab` | 写死 | 发送记录 | 标题 | [NotificationPages.tsx:311](../../apps/web/src/pages/notifications/NotificationPages.tsx#L311)、334 行 |
| `NotificationPages.f30977e7` | 写死 | 「已发送」表示邮件服务器已接收，不等于已进收件箱；没收到的话先看看垃圾邮件。 | 正文 | [NotificationPages.tsx:313](../../apps/web/src/pages/notifications/NotificationPages.tsx#L313) |
| `NotificationPages.4957ff8f` | 写死 | 有新订单等事情时，发送记录会显示在这里。 | 说明 | [NotificationPages.tsx:340](../../apps/web/src/pages/notifications/NotificationPages.tsx#L340) |
| `NotificationPages.ff7c33d4` | 写死 | 还没有发给你们的通知 | 标题 | [NotificationPages.tsx:340](../../apps/web/src/pages/notifications/NotificationPages.tsx#L340) |
| `NotificationPages.1c72a798` | 写死 | 共 {total} 条，这里显示最新的 {length} 条；按状态筛选或从订单进来可以找到更早的。 | 正文 | [NotificationPages.tsx:342](../../apps/web/src/pages/notifications/NotificationPages.tsx#L342) |

## 公司

文件：`apps/web/src/pages/company/CompanyPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CompanyPage.11137b14` | 写死 | 所在国家（两位代码） | 名称 | [CompanyPage.tsx:48](../../apps/web/src/pages/company/CompanyPage.tsx#L48) |
| `CompanyPage.7b355912` | 写死 | 如 JP、KR。决定要交哪些资质。 | 说明 | [CompanyPage.tsx:48](../../apps/web/src/pages/company/CompanyPage.tsx#L48) |
| `CompanyPage.894dd651` | 写死 | 和营业执照、登记簿上的一致。 | 说明 | [CompanyPage.tsx:49](../../apps/web/src/pages/company/CompanyPage.tsx#L49) |
| `CompanyPage.c931a5ad` | 写死 | 法定名称 | 名称 | [CompanyPage.tsx:49](../../apps/web/src/pages/company/CompanyPage.tsx#L49) |
| `CompanyPage.8167bc08` | 写死 | 登记号 / 统一社会信用代码 | 名称 | [CompanyPage.tsx:50](../../apps/web/src/pages/company/CompanyPage.tsx#L50) |
| `CompanyPage.7abd529d` | 写死 | 地址 | 名称 | [CompanyPage.tsx:51](../../apps/web/src/pages/company/CompanyPage.tsx#L51) |
| `CompanyPage.953555fa` | 写死 | 联系人 | 名称 | [CompanyPage.tsx:52](../../apps/web/src/pages/company/CompanyPage.tsx#L52) |
| `CompanyPage.7c3ca991` | 写死 | 带国家码，如 +81 3-1234-5678。 | 说明 | [CompanyPage.tsx:53](../../apps/web/src/pages/company/CompanyPage.tsx#L53) |
| `CompanyPage.a328bde9` | 写死 | 联系电话 | 名称 | [CompanyPage.tsx:53](../../apps/web/src/pages/company/CompanyPage.tsx#L53) |
| `CompanyPage.0d8185a5` | 写死 | 联系邮箱 | 名称 | [CompanyPage.tsx:54](../../apps/web/src/pages/company/CompanyPage.tsx#L54) |
| `CompanyPage.c6f26fbe` | 写死 | 企业信息已保存 | 提示 | [CompanyPage.tsx:73](../../apps/web/src/pages/company/CompanyPage.tsx#L73) |
| `CompanyPage.d96aadd1` | 写死 | 企业信息刚被别人改过。请刷新页面看最新的内容，再改。 | 文字 | [CompanyPage.tsx:77](../../apps/web/src/pages/company/CompanyPage.tsx#L77) |
| `CompanyPage.26e85500` | 写死 | 有填写不对的地方：国家要两位字母代码，邮箱要是邮箱的格式。 | 文字 | [CompanyPage.tsx:78](../../apps/web/src/pages/company/CompanyPage.tsx#L78) |
| `CompanyPage.bb8c0f84` | 写死 | 已经提交审核了，现在不能改企业信息。需要改的话请联系平台退回。 | 文字 | [CompanyPage.tsx:79](../../apps/web/src/pages/company/CompanyPage.tsx#L79) |
| `CompanyPage.08b0fda3` | 写死 | 保存 | 文字 | [CompanyPage.tsx:80](../../apps/web/src/pages/company/CompanyPage.tsx#L80)、108 行 |
| `CompanyPage.5cdecc53` | 写死 | 企业信息 | 标题 | [CompanyPage.tsx:89](../../apps/web/src/pages/company/CompanyPage.tsx#L89) |
| `CompanyPage.3e8c2f8f` | 写死 | 保存中… | 文字 | [CompanyPage.tsx:106](../../apps/web/src/pages/company/CompanyPage.tsx#L106) |
| `CompanyPage.461c1733` | 写死 | 注册地址和联系方式在 | 正文 | [CompanyPage.tsx:116](../../apps/web/src/pages/company/CompanyPage.tsx#L116) |
| `CompanyPage.15f704cd` | 写死 | 「设置 › 企业信息」 | 链接 | [CompanyPage.tsx:118](../../apps/web/src/pages/company/CompanyPage.tsx#L118) |
| `CompanyPage.2815edc7` | 写死 | 里直接改；名称、法定名称、登记号也在那里提交修改申请，平台审核通过后生效。 | 正文 | [CompanyPage.tsx:119](../../apps/web/src/pages/company/CompanyPage.tsx#L119) |
| `CompanyPage.05057180` | 写死 | 请选择文件 | 提示 | [CompanyPage.tsx:147](../../apps/web/src/pages/company/CompanyPage.tsx#L147) |
| `CompanyPage.3cabd547` | 写死 | 文件太大了：最大 10 MB | 提示 | [CompanyPage.tsx:147](../../apps/web/src/pages/company/CompanyPage.tsx#L147) |
| `CompanyPage.b882026d` | 写死 | 文件是空的 | 提示 | [CompanyPage.tsx:147](../../apps/web/src/pages/company/CompanyPage.tsx#L147) |
| `CompanyPage.76751f5f` | 写死 | 到期日已经到了或过了：请上传还在有效期内的证件 | 提示 | [CompanyPage.tsx:148](../../apps/web/src/pages/company/CompanyPage.tsx#L148) |
| `CompanyPage.c3c7a4e2` | 写死 | 请填证件上的到期日 | 提示 | [CompanyPage.tsx:148](../../apps/web/src/pages/company/CompanyPage.tsx#L148) |
| `CompanyPage.cf680f57` | 写死 | 已提交「{type\_name}」，等平台审核 | 提示 | [CompanyPage.tsx:161](../../apps/web/src/pages/company/CompanyPage.tsx#L161) |
| `CompanyPage.1cef65fc` | 写死 | 只收 PDF、JPEG、PNG 文件。请换一个文件（照片请存成 JPEG 或 PNG）。 | 文字 | [CompanyPage.tsx:165](../../apps/web/src/pages/company/CompanyPage.tsx#L165) |
| `CompanyPage.c3c226f3` | 写死 | 文件太大了：最大 10 MB。 | 文字 | [CompanyPage.tsx:166](../../apps/web/src/pages/company/CompanyPage.tsx#L166) |
| `CompanyPage.df554e7b` | 写死 | 已清退，不能再提交。 | 文字 | [CompanyPage.tsx:167](../../apps/web/src/pages/company/CompanyPage.tsx#L167) |
| `CompanyPage.fab02828` | 写死 | 提交 | 文字 | [CompanyPage.tsx:168](../../apps/web/src/pages/company/CompanyPage.tsx#L168)、188、386 行 |
| `CompanyPage.8f61fa18` | 写死 | 换证 | 标题 | [CompanyPage.tsx:177](../../apps/web/src/pages/company/CompanyPage.tsx#L177)、300 行 |
| `CompanyPage.adb85ae9` | 写死 | 上传 | 标题 | [CompanyPage.tsx:177](../../apps/web/src/pages/company/CompanyPage.tsx#L177)、299、300 行 |
| `CompanyPage.bcd54c50` | 写死 | 取消 | 按钮 | [CompanyPage.tsx:185](../../apps/web/src/pages/company/CompanyPage.tsx#L185) |
| `CompanyPage.b761f60c` | 写死 | 上传中… | 文字 | [CompanyPage.tsx:186](../../apps/web/src/pages/company/CompanyPage.tsx#L186) |
| `CompanyPage.c5f77158` | 写死 | 新的一份审核通过之前，原来的照常有效。 | 正文 | [CompanyPage.tsx:193](../../apps/web/src/pages/company/CompanyPage.tsx#L193) |
| `CompanyPage.10e2c1fc` | 写死 | 文件 | 表单标签 | [CompanyPage.tsx:197](../../apps/web/src/pages/company/CompanyPage.tsx#L197) |
| `CompanyPage.0e80b813` | 写死 | PDF、JPEG、PNG，最大 10 MB。{…} | 正文 | [CompanyPage.tsx:204](../../apps/web/src/pages/company/CompanyPage.tsx#L204) |
| `CompanyPage.aaabf8fa` | 写死 | 已选：{name}（{…}） | 正文 | [CompanyPage.tsx:204](../../apps/web/src/pages/company/CompanyPage.tsx#L204) |
| `CompanyPage.e2576201` | 写死 | 到期日 {…} | 表单标签 | [CompanyPage.tsx:211](../../apps/web/src/pages/company/CompanyPage.tsx#L211) |
| `CompanyPage.4a38d930` | 写死 | 照证件上写。到期前 30 天、7 天会提醒你换证；到期当天起不算有效，必交资质到期会被暂停。 | 正文 | [CompanyPage.tsx:220](../../apps/web/src/pages/company/CompanyPage.tsx#L220) |
| `CompanyPage.46c4c48e` | 写死 | 说明（可选） | 表单标签 | [CompanyPage.tsx:227](../../apps/web/src/pages/company/CompanyPage.tsx#L227) |
| `CompanyPage.5bed77e7` | 写死 | 下载 | 文字 | [CompanyPage.tsx:245](../../apps/web/src/pages/company/CompanyPage.tsx#L245)、296 行 |
| `CompanyPage.33c7a249` | 写死 | 其他补充材料 | 名称 | [CompanyPage.tsx:248](../../apps/web/src/pages/company/CompanyPage.tsx#L248) |
| `CompanyPage.f9aa8c75` | 写死 | 资质 | 标题 | [CompanyPage.tsx:254](../../apps/web/src/pages/company/CompanyPage.tsx#L254) |
| `CompanyPage.ed48341f` | 写死 | 上传补充材料 | 按钮 | [CompanyPage.tsx:258](../../apps/web/src/pages/company/CompanyPage.tsx#L258) |
| `CompanyPage.606a3020` | 写死 | 按 {country\_code} 的必交清单。 | 正文 | [CompanyPage.tsx:261](../../apps/web/src/pages/company/CompanyPage.tsx#L261) |
| `CompanyPage.cb5c031d` | 写死 | {…}营运许可和保险要填到期日；到期前 30 天、7 天各提醒一次。 | 正文 | [CompanyPage.tsx:261](../../apps/web/src/pages/company/CompanyPage.tsx#L261) |
| `CompanyPage.d017896c` | 写死 | 先在上面填所在国家，清单会按国家调整。 | 正文 | [CompanyPage.tsx:261](../../apps/web/src/pages/company/CompanyPage.tsx#L261) |
| `CompanyPage.3c89dd99` | 写死 | 资质清单 | 读屏说明 | [CompanyPage.tsx:263](../../apps/web/src/pages/company/CompanyPage.tsx#L263) |
| `CompanyPage.4093e1f9` | 写死 | 证件 | 表头 | [CompanyPage.tsx:267](../../apps/web/src/pages/company/CompanyPage.tsx#L267) |
| `CompanyPage.faa32ec7` | 写死 | 状态 | 表头 | [CompanyPage.tsx:268](../../apps/web/src/pages/company/CompanyPage.tsx#L268) |
| `CompanyPage.3d3eb7b6` | 写死 | 到期日 | 表头 | [CompanyPage.tsx:269](../../apps/web/src/pages/company/CompanyPage.tsx#L269) |
| `CompanyPage.05381030` | 写死 | 平台的意见 | 表头 | [CompanyPage.tsx:270](../../apps/web/src/pages/company/CompanyPage.tsx#L270) |
| `CompanyPage.26efeb3a` | 写死 | 操作 | 表头 | [CompanyPage.tsx:271](../../apps/web/src/pages/company/CompanyPage.tsx#L271) |
| `CompanyPage.38b937d8` | 写死 | （补充） | 正文 | [CompanyPage.tsx:283](../../apps/web/src/pages/company/CompanyPage.tsx#L283) |
| `CompanyPage.a3843bf6` | 写死 | （新的一份审核中） | 正文 | [CompanyPage.tsx:287](../../apps/web/src/pages/company/CompanyPage.tsx#L287) |
| `CompanyPage.0f867bee` | 写死 | 下载 {type\_name} | 读屏说明 | [CompanyPage.tsx:294](../../apps/web/src/pages/company/CompanyPage.tsx#L294) |
| `CompanyPage.0b25a5df` | 写死 | 重新上传 | 读屏说明 | [CompanyPage.tsx:299](../../apps/web/src/pages/company/CompanyPage.tsx#L299)、300 行 |
| `CompanyPage.f9c2794f` | 写死 | 企业资质 · NOZOMI {name} | 浏览器标题 | [CompanyPage.tsx:331](../../apps/web/src/pages/company/CompanyPage.tsx#L331) |
| `CompanyPage.933ca4f3` | 写死 | 企业资质 | 名称 | [CompanyPage.tsx:342](../../apps/web/src/pages/company/CompanyPage.tsx#L342)、343 行 |
| `CompanyPage.0ce4a151` | 写死 | 企业资质由管理员维护。需要的话，请联系你们的管理员。 | 说明 | [CompanyPage.tsx:348](../../apps/web/src/pages/company/CompanyPage.tsx#L348) |
| `CompanyPage.868cd08b` | 写死 | 你没有权限查看这里 | 标题 | [CompanyPage.tsx:348](../../apps/web/src/pages/company/CompanyPage.tsx#L348) |
| `CompanyPage.4429bfa9` | 写死 | 加载失败 | 标题 | [CompanyPage.tsx:355](../../apps/web/src/pages/company/CompanyPage.tsx#L355) |
| `CompanyPage.a596cdc6` | 写死 | 请检查网络后重试。 | 说明 | [CompanyPage.tsx:356](../../apps/web/src/pages/company/CompanyPage.tsx#L356) |
| `CompanyPage.059c9d6c` | 写死 | 重试 | 按钮 | [CompanyPage.tsx:360](../../apps/web/src/pages/company/CompanyPage.tsx#L360) |
| `CompanyPage.5500af90` | 写死 | 已提交审核 | 提示 | [CompanyPage.tsx:379](../../apps/web/src/pages/company/CompanyPage.tsx#L379) |
| `CompanyPage.4539ccee` | 写死 | 还不能提交：{…}。 | 提示 | [CompanyPage.tsx:385](../../apps/web/src/pages/company/CompanyPage.tsx#L385) |
| `CompanyPage.3b7052fe` | 写死 | 企业信息和资质由管理员维护，你可以查看。 | 提示 | [CompanyPage.tsx:399](../../apps/web/src/pages/company/CompanyPage.tsx#L399) |
| `CompanyPage.fd308b3a` | 写死 | 入驻进度 | 标题 | [CompanyPage.tsx:403](../../apps/web/src/pages/company/CompanyPage.tsx#L403) |
| `CompanyPage.2cbbd357` | 写死 | 提交审核前还缺： | 正文 | [CompanyPage.tsx:407](../../apps/web/src/pages/company/CompanyPage.tsx#L407) |
| `CompanyPage.d2b9915f` | 写死 | 平台审核通过、合同生效后会和你们签约。签约以后可以建商品，开始试运营以后才能上架。 | 正文 | [CompanyPage.tsx:415](../../apps/web/src/pages/company/CompanyPage.tsx#L415) |
| `CompanyPage.c0f00946` | 写死 | 提交中… | 文字 | [CompanyPage.tsx:419](../../apps/web/src/pages/company/CompanyPage.tsx#L419) |
| `CompanyPage.8b5d9f48` | 写死 | 提交审核 | 按钮 | [CompanyPage.tsx:421](../../apps/web/src/pages/company/CompanyPage.tsx#L421) |
| `CompanyPage.8e5c19d2` | 写死 | 最近的提醒 | 标题 | [CompanyPage.tsx:429](../../apps/web/src/pages/company/CompanyPage.tsx#L429) |
| `CompanyPage.e80aa607` | 写死 | 合同 | 标题 | [CompanyPage.tsx:445](../../apps/web/src/pages/company/CompanyPage.tsx#L445) |
| `CompanyPage.b90bd13a` | 写死 | 还没有合同。资质审核通过后，平台会和你们签合同。 | 正文 | [CompanyPage.tsx:447](../../apps/web/src/pages/company/CompanyPage.tsx#L447) |
| `CompanyPage.133f95db` | 写死 | （现在生效） | 正文 | [CompanyPage.tsx:452](../../apps/web/src/pages/company/CompanyPage.tsx#L452) |
| `CompanyPage.1d81e640` | 写死 | 第 {version} 版{…} | 正文 | [CompanyPage.tsx:452](../../apps/web/src/pages/company/CompanyPage.tsx#L452) |
| `CompanyPage.4d7d3763` | 写死 | {valid\_from} 起；结算币种 {settle\_currency}；月结，次月 {payment\_day} 日付款；平台不收服务费和保证金 | 正文 | [CompanyPage.tsx:453](../../apps/web/src/pages/company/CompanyPage.tsx#L453) |
| `CompanyPage.8a7efeca` | 写死 | 状态变更记录 | 标题 | [CompanyPage.tsx:462](../../apps/web/src/pages/company/CompanyPage.tsx#L462) |

## 企业信息

文件：`apps/web/src/pages/company/CompanyInfoPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CompanyInfoPage.0e26e7f4` | 写死 | 企业信息已保存 | 提示 | [CompanyInfoPage.tsx:50](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L50) |
| `CompanyInfoPage.448ae45b` | 写死 | 保存 | 文字 | [CompanyInfoPage.tsx:53](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L53)、77 行 |
| `CompanyInfoPage.25aad050` | 写死 | 保存中… | 文字 | [CompanyInfoPage.tsx:75](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L75) |
| `CompanyInfoPage.eab47e1d` | 写死 | 没有改动：请先改要改的那一项。 | 文字 | [CompanyInfoPage.tsx:99](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L99) |
| `CompanyInfoPage.ccb00946` | 写死 | 要改的项不能留空。 | 文字 | [CompanyInfoPage.tsx:100](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L100) |
| `CompanyInfoPage.5b548c7c` | 写死 | 已提交，等平台审核 | 提示 | [CompanyInfoPage.tsx:105](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L105) |
| `CompanyInfoPage.dcf7c708` | 写死 | 提交 | 文字 | [CompanyInfoPage.tsx:109](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L109) |
| `CompanyInfoPage.80f2d63d` | 写死 | 已撤回申请 | 提示 | [CompanyInfoPage.tsx:120](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L120) |
| `CompanyInfoPage.c8906fc0` | 写死 | 撤回 | 文字 | [CompanyInfoPage.tsx:123](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L123) |
| `CompanyInfoPage.a2edb76b` | 写死 | 申请修改名称、法定名称、登记号 | 标题 | [CompanyInfoPage.tsx:131](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L131) |
| `CompanyInfoPage.079c8089` | 写死 | 这三项要平台核对营业执照或登记簿：提交后由平台审核，通过后才生效，审核期间客人和渠道看到的仍是原来的内容。 | 正文 | [CompanyInfoPage.tsx:133](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L133) |
| `CompanyInfoPage.3b1cf162` | 写死 |  {…} 提交{…} | 正文 | [CompanyInfoPage.tsx:139](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L139) |
| `CompanyInfoPage.6538af76` | 写死 | ，说明：{note} | 正文 | [CompanyInfoPage.tsx:139](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L139) |
| `CompanyInfoPage.2af3d0ab` | 写死 | 撤回中… | 文字 | [CompanyInfoPage.tsx:144](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L144) |
| `CompanyInfoPage.e585b292` | 写死 | 撤回申请 | 按钮 | [CompanyInfoPage.tsx:146](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L146) |
| `CompanyInfoPage.72c8de89` | 写死 | 说明（可选） | 表单标签 | [CompanyInfoPage.tsx:158](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L158) |
| `CompanyInfoPage.59a145a9` | 写死 | 提交中… | 文字 | [CompanyInfoPage.tsx:162](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L162) |
| `CompanyInfoPage.c68ed170` | 写死 | 提交申请 | 按钮 | [CompanyInfoPage.tsx:164](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L164) |
| `CompanyInfoPage.2f078a56` | 写死 | 现在没有等审核的申请。 | 正文 | [CompanyInfoPage.tsx:168](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L168) |
| `CompanyInfoPage.669f1314` | 写死 | 以前的申请 | 标题 | [CompanyInfoPage.tsx:172](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L172) |
| `CompanyInfoPage.5857c12f` | 写死 | ；平台的意见：{reject\_reason} | 正文 | [CompanyInfoPage.tsx:177](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L177) |
| `CompanyInfoPage.5d4245d2` | 写死 | {…}改成「{…}」 | 文字 | [CompanyInfoPage.tsx:177](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L177) |
| `CompanyInfoPage.f0460ad8` | 写死 | {…}（{…} 提交{…}） | 正文 | [CompanyInfoPage.tsx:177](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L177) |
| `CompanyInfoPage.0c675eca` | 写死 | 企业信息 · NOZOMI {name} | 浏览器标题 | [CompanyInfoPage.tsx:191](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L191) |
| `CompanyInfoPage.31f07389` | 写死 | 设置 | 名称 | [CompanyInfoPage.tsx:197](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L197) |
| `CompanyInfoPage.90c36c59` | 写死 | 企业信息 | 名称 | [CompanyInfoPage.tsx:197](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L197)、198 行 |
| `CompanyInfoPage.17cdec9f` | 写死 | 企业信息由管理员维护。需要的话，请联系你们的管理员。 | 说明 | [CompanyInfoPage.tsx:203](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L203) |
| `CompanyInfoPage.5b320398` | 写死 | 你没有权限查看这里 | 标题 | [CompanyInfoPage.tsx:203](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L203) |
| `CompanyInfoPage.acf0d486` | 写死 | 加载失败 | 标题 | [CompanyInfoPage.tsx:210](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L210) |
| `CompanyInfoPage.88328848` | 写死 | 请检查网络后重试。 | 说明 | [CompanyInfoPage.tsx:211](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L211) |
| `CompanyInfoPage.115fcf20` | 写死 | 重试 | 按钮 | [CompanyInfoPage.tsx:215](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L215) |
| `CompanyInfoPage.f58a221f` | 写死 | 企业信息由管理员维护，你可以查看。 | 提示 | [CompanyInfoPage.tsx:233](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L233) |
| `CompanyInfoPage.97347d7a` | 写死 | 已清退，只能查看。 | 提示 | [CompanyInfoPage.tsx:234](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L234) |
| `CompanyInfoPage.560d66f0` | 写死 | 现在的企业信息 | 标题 | [CompanyInfoPage.tsx:238](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L238) |
| `CompanyInfoPage.dbb53c36` | 写死 | 银行信息在「账单」的「收款账户」里维护。 | 正文 | [CompanyInfoPage.tsx:251](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L251) |
| `CompanyInfoPage.09cc774b` | 写死 | 修改注册地址和联系方式 | 标题 | [CompanyInfoPage.tsx:256](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L256) |
| `CompanyInfoPage.c396137b` | 写死 | 修改企业信息 | 标题 | [CompanyInfoPage.tsx:256](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L256) |
| `CompanyInfoPage.7738dbc5` | 写死 | 入驻申请中，每一项都可以直接改；也可以在 | 正文 | [CompanyInfoPage.tsx:261](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L261) |
| `CompanyInfoPage.095f1a2d` | 写死 | 「企业资质」 | 链接 | [CompanyInfoPage.tsx:264](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L264) |
| `CompanyInfoPage.d29ef0a1` | 写死 | 里改。所在国家决定要交哪些资质。 | 正文 | [CompanyInfoPage.tsx:266](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L266) |
| `CompanyInfoPage.d99093a2` | 写死 | 保存后直接生效，平台运营会收到通知。所在国家要改的话请联系平台。 | 正文 | [CompanyInfoPage.tsx:268](../../apps/web/src/pages/company/CompanyInfoPage.tsx#L268) |

## 服务表现

文件：`apps/web/src/pages/company/PerformancePage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PerformancePage.319f49c8` | 写死 | 履约评分 · NOZOMI {name} | 浏览器标题 | [PerformancePage.tsx:19](../../apps/web/src/pages/company/PerformancePage.tsx#L19) |
| `PerformancePage.869c29c1` | 写死 | 履约评分 | 名称 | [PerformancePage.tsx:23](../../apps/web/src/pages/company/PerformancePage.tsx#L23)、24、32 行 |
| `PerformancePage.e7f884d7` | 写死 | 需要的话，请联系你们的管理员。 | 说明 | [PerformancePage.tsx:29](../../apps/web/src/pages/company/PerformancePage.tsx#L29) |
| `PerformancePage.ecb2442d` | 写死 | 你没有权限查看这里 | 标题 | [PerformancePage.tsx:29](../../apps/web/src/pages/company/PerformancePage.tsx#L29) |
| `PerformancePage.8df47475` | 写死 | 评分用于比价：和最低价相差 3% 以内时，评分高的中标。下面是最近一次每日评分的各项指标。 | 正文 | [PerformancePage.tsx:35](../../apps/web/src/pages/company/PerformancePage.tsx#L35) |
| `PerformancePage.26349321` | 写死 | 加载失败 | 标题 | [PerformancePage.tsx:40](../../apps/web/src/pages/company/PerformancePage.tsx#L40) |
| `PerformancePage.65e7ea65` | 写死 | 请检查网络后重试。 | 说明 | [PerformancePage.tsx:41](../../apps/web/src/pages/company/PerformancePage.tsx#L41) |
| `PerformancePage.402ce02d` | 写死 | 重试 | 按钮 | [PerformancePage.tsx:45](../../apps/web/src/pages/company/PerformancePage.tsx#L45) |

## 工单

文件：`apps/web/src/pages/tickets/TenantTicketPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantTicketPages.18f0bdee` | 写死 | 工单 · NOZOMI {name} | 浏览器标题 | [TenantTicketPages.tsx:51](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L51) |
| `TenantTicketPages.8eb5785e` | 写死 | 工单 | 名称 | [TenantTicketPages.tsx:61](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L61)、62、79、137、228、231、437 行 |
| `TenantTicketPages.0698bea5` | 写死 | 类型 | 文字 | [TenantTicketPages.tsx:92](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L92)、286、475 行 |
| `TenantTicketPages.78e76a3c` | 写死 | 状态 | 文字 | [TenantTicketPages.tsx:95](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L95)、121 行 |
| `TenantTicketPages.c06a1a62` | 写死 | 等你们回复 | 名称 | [TenantTicketPages.tsx:101](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L101)、282 行 |
| `TenantTicketPages.885d8cb3` | 写死 | 订单号 | 文字 | [TenantTicketPages.tsx:107](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L107) |
| `TenantTicketPages.41aadfd9` | 写死 | 回复期限 | 文字 | [TenantTicketPages.tsx:108](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L108) |
| `TenantTicketPages.8fb92f93` | 写死 | 创建时间 | 文字 | [TenantTicketPages.tsx:109](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L109)、289 行 |
| `TenantTicketPages.2325deb8` | 写死 | 没有符合条件的工单 | 标题 | [TenantTicketPages.tsx:112](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L112) |
| `TenantTicketPages.c2854f2b` | 写死 | 清空筛选 | 按钮 | [TenantTicketPages.tsx:112](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L112)、133 行 |
| `TenantTicketPages.da53d52a` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [TenantTicketPages.tsx:112](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L112) |
| `TenantTicketPages.7ea5ee0a` | 写死 | 客人投诉、no-show 审核、履约问题会以工单的形式出现在这里；平台征求你们意见时要在 24 小时内回复。失物招领可以在订单详情里发起。 | 说明 | [TenantTicketPages.tsx:114](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L114) |
| `TenantTicketPages.d732b31a` | 写死 | 还没有工单 | 标题 | [TenantTicketPages.tsx:114](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L114) |
| `TenantTicketPages.e1f65206` | 写死 | 平台征求你们意见的工单要在 24 小时内回复并说明情况，超时视为认可。对你们不利的判定，判定后 7 天内可以申诉一次，由另一位平台员工复核。 | 正文 | [TenantTicketPages.tsx:119](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L119) |
| `TenantTicketPages.007cf7c7` | 写死 | 全部 | 名称 | [TenantTicketPages.tsx:121](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L121) |
| `TenantTicketPages.b15d3011` | 写死 | 没有结论的 | 名称 | [TenantTicketPages.tsx:121](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L121) |
| `TenantTicketPages.ef81e1b2` | 写死 | 只看一张订单的 | 正文 | [TenantTicketPages.tsx:124](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L124) |
| `TenantTicketPages.b47200da` | 写死 | 去掉条件「只看一张订单的」 | 读屏说明 | [TenantTicketPages.tsx:125](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L125) |
| `TenantTicketPages.3b79fc45` | 写死 | 请写为什么不同意这个判定，附上能说明情况的事实 | 错误提示 | [TenantTicketPages.tsx:166](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L166) |
| `TenantTicketPages.054d1183` | 写死 | 对工单 {ticket\_no} 的判定申诉 | 邮件主题 | [TenantTicketPages.tsx:173](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L173) |
| `TenantTicketPages.002d72b3` | 写死 | 申诉 | 文字 | [TenantTicketPages.tsx:177](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L177)、370 行 |
| `TenantTicketPages.09c8c93d` | 写死 | {…}你写的内容还在。 | 文字 | [TenantTicketPages.tsx:177](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L177)、256 行 |
| `TenantTicketPages.533c90bd` | 写死 | 对这个判定申诉 | 标题 | [TenantTicketPages.tsx:185](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L185) |
| `TenantTicketPages.6c2141b3` | 写死 | 取消 | 按钮 | [TenantTicketPages.tsx:193](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L193)、491 行 |
| `TenantTicketPages.9ad29769` | 写死 | 知道了 | 按钮 | [TenantTicketPages.tsx:193](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L193) |
| `TenantTicketPages.ecc17607` | 写死 | 提交中… | 文字 | [TenantTicketPages.tsx:196](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L196)、492 行 |
| `TenantTicketPages.ada468bc` | 写死 | 提交申诉 | 按钮 | [TenantTicketPages.tsx:198](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L198) |
| `TenantTicketPages.a925841c` | 写死 | 每张判定只能申诉一次（判定后 7 天内，到 {…}）。由另一位平台员工复核；申诉成立的，这张工单记下的应扣款项全部免除、评分里的记录撤销。 | 正文 | [TenantTicketPages.tsx:206](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L206) |
| `TenantTicketPages.139ea8fb` | 写死 | 如「司机 10:02 已到达，见到达屏照片和定位；客人 10:40 才出现」 | 说明 | [TenantTicketPages.tsx:207](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L207) |
| `TenantTicketPages.fe9a3caa` | 写死 | 为什么不同意 | 名称 | [TenantTicketPages.tsx:207](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L207) |
| `TenantTicketPages.e57e5375` | 写死 | 工单 {ticket\_no} | 标题 | [TenantTicketPages.tsx:228](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L228) |
| `TenantTicketPages.14784a57` | 写死 | 找不到这张工单 | 标题 | [TenantTicketPages.tsx:236](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L236) |
| `TenantTicketPages.b5fa970f` | 写死 | 可能是链接写错了，或这张工单和你们无关。 | 说明 | [TenantTicketPages.tsx:236](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L236) |
| `TenantTicketPages.2f15e3e7` | 写死 | 加载失败 | 标题 | [TenantTicketPages.tsx:238](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L238) |
| `TenantTicketPages.42a0a6fe` | 写死 | 请检查网络后重试。 | 说明 | [TenantTicketPages.tsx:238](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L238) |
| `TenantTicketPages.acc7ad08` | 写死 | 重试 | 按钮 | [TenantTicketPages.tsx:238](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L238) |
| `TenantTicketPages.9ba470bf` | 写死 | 请写回复的内容 | 错误提示 | [TenantTicketPages.tsx:246](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L246) |
| `TenantTicketPages.dff18e9a` | 写死 | 已回复平台 | 提示 | [TenantTicketPages.tsx:254](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L254) |
| `TenantTicketPages.05876a0e` | 写死 | 回复 | 文字 | [TenantTicketPages.tsx:256](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L256)、326 行 |
| `TenantTicketPages.8199597a` | 写死 | 平台在等你们回复 | 正文 | [TenantTicketPages.tsx:265](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L265) |
| `TenantTicketPages.ad163dd7` | 写死 | 请在 {…} 之前回复并说明情况；超时视为认可。 | 正文 | [TenantTicketPages.tsx:266](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L266) |
| `TenantTicketPages.37f069af` | 写死 | 这个判定对你们不利，可以申诉一次 | 正文 | [TenantTicketPages.tsx:271](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L271) |
| `TenantTicketPages.84ae2810` | 写死 | 判定后 7 天内（到 {…}）。 | 正文 | [TenantTicketPages.tsx:272](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L272) |
| `TenantTicketPages.cea5b7e0` | 写死 | 谁提出的 | 名称 | [TenantTicketPages.tsx:287](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L287) |
| `TenantTicketPages.b9b61e8e` | 写死 | 订单 | 名称 | [TenantTicketPages.tsx:288](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L288) |
| `TenantTicketPages.84a9b188` | 写死 | 申诉的是 | 名称 | [TenantTicketPages.tsx:293](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L293) |
| `TenantTicketPages.923e07e6` | 写死 | 原来的工单 | 链接 | [TenantTicketPages.tsx:296](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L296) |
| `TenantTicketPages.51c773a9` | 写死 | 和平台的对话 | 标题 | [TenantTicketPages.tsx:304](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L304) |
| `TenantTicketPages.8d55dcf2` | 写死 | 还没有对话。 | 正文 | [TenantTicketPages.tsx:306](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L306) |
| `TenantTicketPages.1b75ce31` | 写死 | 说明当时的情况；司机的到达屏、举牌、联系记录照片在订单详情的「证据」里，平台看得到。 | 说明 | [TenantTicketPages.tsx:322](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L322) |
| `TenantTicketPages.827400f1` | 写死 | 回复平台 | 名称 | [TenantTicketPages.tsx:322](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L322) |
| `TenantTicketPages.9cef28b1` | 写死 | 发送中… | 文字 | [TenantTicketPages.tsx:324](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L324) |
| `TenantTicketPages.c845b8be` | 写死 | 你可以查看，但没有回复工单的权限。 | 正文 | [TenantTicketPages.tsx:330](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L330) |
| `TenantTicketPages.11bbe359` | 写死 | 判定 | 读屏说明 | [TenantTicketPages.tsx:333](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L333)、337 行 |
| `TenantTicketPages.35a4eb4d` | 写死 | 还没有判定。 | 正文 | [TenantTicketPages.tsx:339](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L339) |
| `TenantTicketPages.e611ead1` | 写死 | 结论 | 名称 | [TenantTicketPages.tsx:342](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L342) |
| `TenantTicketPages.afbe0f83` | 写死 | 责任方 | 名称 | [TenantTicketPages.tsx:343](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L343) |
| `TenantTicketPages.b2eb3948` | 写死 | 你们 | 正文 | [TenantTicketPages.tsx:343](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L343) |
| `TenantTicketPages.24119fc7` | 写死 | 判定时间 | 名称 | [TenantTicketPages.tsx:344](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L344) |
| `TenantTicketPages.2c8aa19f` | 写死 | 说明 | 名称 | [TenantTicketPages.tsx:348](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L348)、487 行 |
| `TenantTicketPages.c14268ff` | 写死 | 可以申诉到 | 名称 | [TenantTicketPages.tsx:353](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L353) |
| `TenantTicketPages.f43a7e52` | 写死 | 已申诉： | 正文 | [TenantTicketPages.tsx:361](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L361) |
| `TenantTicketPages.6697f200` | 写死 | 你们承担的款项 | 标题 | [TenantTicketPages.tsx:378](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L378) |
| `TenantTicketPages.17c2199f` | 写死 | ；免除说明：{waive\_reason} | 正文 | [TenantTicketPages.tsx:386](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L386) |
| `TenantTicketPages.e55fbc99` | 写死 | 在账单里扣。全部款项见 | 正文 | [TenantTicketPages.tsx:392](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L392) |
| `TenantTicketPages.7c516de5` | 写死 | 违约金与扣款 | 链接 | [TenantTicketPages.tsx:394](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L394) |
| `TenantTicketPages.187bcc9c` | 写死 | 已提交申诉「{ticket\_no}」 | 提示 | [TenantTicketPages.tsx:410](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L410) |
| `TenantTicketPages.6fd1963f` | 写死 | 发起工单 · NOZOMI {name} | 浏览器标题 | [TenantTicketPages.tsx:424](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L424) |
| `TenantTicketPages.500a6603` | 写死 | 发起工单 | 名称 | [TenantTicketPages.tsx:437](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L437)、438、460、494 行 |
| `TenantTicketPages.4e1ef02f` | 写死 | 请从订单详情发起 | 标题 | [TenantTicketPages.tsx:444](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L444) |
| `TenantTicketPages.7665fdc4` | 写死 | 去订单 | 按钮 | [TenantTicketPages.tsx:444](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L444) |
| `TenantTicketPages.c34e1569` | 写死 | 工单要绑定一张订单：在订单详情里点「就这一单发起工单」。要对平台的判定申诉，在那张工单里点「申诉」。 | 说明 | [TenantTicketPages.tsx:444](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L444) |
| `TenantTicketPages.2772f587` | 写死 | 请选择类型 | 文字 | [TenantTicketPages.tsx:448](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L448) |
| `TenantTicketPages.8a1cab95` | 写死 | 请写标题 | 文字 | [TenantTicketPages.tsx:449](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L449) |
| `TenantTicketPages.dbda70b4` | 写死 | 请写清楚是什么事 | 文字 | [TenantTicketPages.tsx:450](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L450) |
| `TenantTicketPages.b769aee2` | 写死 | 已发起工单「{ticket\_no}」 | 提示 | [TenantTicketPages.tsx:457](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L457) |
| `TenantTicketPages.7e40d99f` | 写死 | {…}你填写的内容还在。 | 文字 | [TenantTicketPages.tsx:460](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L460) |
| `TenantTicketPages.9423fb69` | 写死 | 找不到这张订单，或它不是你们的。 | 文字 | [TenantTicketPages.tsx:460](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L460) |
| `TenantTicketPages.84893982` | 写死 | 订单： | 正文 | [TenantTicketPages.tsx:469](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L469) |
| `TenantTicketPages.3ada1af2` | 写死 | 回到订单详情 | 链接 | [TenantTicketPages.tsx:472](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L472) |
| `TenantTicketPages.80decde9` | 写死 | 客人把东西落在车上：写清楚是什么、现在在哪、怎么归还 | 说明 | [TenantTicketPages.tsx:480](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L480) |
| `TenantTicketPages.b3a6f568` | 写死 | 需要平台跟进的其他事 | 说明 | [TenantTicketPages.tsx:481](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L481) |
| `TenantTicketPages.b6ffb369` | 写死 | 标题 | 名称 | [TenantTicketPages.tsx:486](../../apps/web/src/pages/tickets/TenantTicketPages.tsx#L486) |

## 账单

文件：`apps/web/src/pages/statements/TenantStatementPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantStatementPages.5ba28b31` | 写死 | 系统 | 文字 | [TenantStatementPages.tsx:35](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L35) |
| `TenantStatementPages.6f2966e9` | 写死 | 你们 | 文字 | [TenantStatementPages.tsx:35](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L35) |
| `TenantStatementPages.a2f61cd6` | 写死 | 平台 | 文字 | [TenantStatementPages.tsx:35](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L35) |
| `TenantStatementPages.3d7e948f` | 写死 | 确认期已经过了，账单已视为确认，不能再提异议。有问题请联系平台的财务。 | 提示 | [TenantStatementPages.tsx:38](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L38) |
| `TenantStatementPages.832ef1ef` | 写死 | 账单的状态刚变了（平台可能刚答复或作废了它）。关掉对话框后页面会刷新。 | 提示 | [TenantStatementPages.tsx:39](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L39) |
| `TenantStatementPages.54837b60` | 写死 | 账单 · NOZOMI {name} | 浏览器标题 | [TenantStatementPages.tsx:45](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L45) |
| `TenantStatementPages.74a583a6` | 写死 | 账单 | 名称 | [TenantStatementPages.tsx:52](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L52)、53、79、146、149 行 |
| `TenantStatementPages.7f950b7a` | 写死 | 账单号 | 文字 | [TenantStatementPages.tsx:58](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L58) |
| `TenantStatementPages.102f10c8` | 写死 | 周期 | 文字 | [TenantStatementPages.tsx:59](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L59) |
| `TenantStatementPages.cc9829b2` | 写死 | 状态 | 文字 | [TenantStatementPages.tsx:60](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L60)、75 行 |
| `TenantStatementPages.b2d6908e` | 写死 | 合计（平台应付你们） | 文字 | [TenantStatementPages.tsx:61](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L61)、183 行 |
| `TenantStatementPages.a9f798da` | 写死 | 确认期截止 | 文字 | [TenantStatementPages.tsx:62](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L62) |
| `TenantStatementPages.d8f9398b` | 写死 | 付款日 | 文字 | [TenantStatementPages.tsx:63](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L63)、192 行 |
| `TenantStatementPages.ae24f331` | 写死 | 每月 1 日起平台给你们出上个月的账（按订单的服务日期，城市当地日期）：已完成订单的结算价、客人未出现、有偿取消的应得、事后加收，减去违约金、救援差价、客人赔付等应扣款项。出账后 7 天内请核对并确认，有问题提异议；到期不处理视为确认。次月 20 日付款。 | 正文 | [TenantStatementPages.tsx:67](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L67) |
| `TenantStatementPages.00a37829` | 写死 | 收款账户 | 链接 | [TenantStatementPages.tsx:71](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L71) |
| `TenantStatementPages.66728402` | 写死 | ：平台把钱付到这里，换账户也在这里提交。 | 正文 | [TenantStatementPages.tsx:72](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L72) |
| `TenantStatementPages.b204dbed` | 写死 | 全部 | 名称 | [TenantStatementPages.tsx:75](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L75) |
| `TenantStatementPages.b327c5e5` | 写死 | 没有符合条件的账单 | 标题 | [TenantStatementPages.tsx:85](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L85) |
| `TenantStatementPages.d71b75ec` | 写死 | 有结案的订单（已完成、客人未出现、有偿取消）后，下个月 1 日起会出现这一期的账单。 | 说明 | [TenantStatementPages.tsx:85](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L85) |
| `TenantStatementPages.f64377ad` | 写死 | 还没有账单 | 标题 | [TenantStatementPages.tsx:85](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L85) |
| `TenantStatementPages.f20a2dc6` | 写死 | 确认 | 文字 | [TenantStatementPages.tsx:105](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L105)、190 行 |
| `TenantStatementPages.25f678eb` | 写死 | 确认这张账单？ | 标题 | [TenantStatementPages.tsx:113](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L113) |
| `TenantStatementPages.8fafbc21` | 写死 | 知道了 | 按钮 | [TenantStatementPages.tsx:119](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L119) |
| `TenantStatementPages.99245530` | 写死 | 取消 | 按钮 | [TenantStatementPages.tsx:119](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L119) |
| `TenantStatementPages.0061e58c` | 写死 | 确认中… | 文字 | [TenantStatementPages.tsx:122](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L122) |
| `TenantStatementPages.519b530f` | 写死 | 确认账单 | 按钮 | [TenantStatementPages.tsx:124](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L124)、200 行 |
| `TenantStatementPages.07516196` | 写死 | {…}：合计 {…}，{line\_count} 条明细。 | 正文 | [TenantStatementPages.tsx:130](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L130) |
| `TenantStatementPages.01f6533b` | 写死 | 确认后平台的财务做付款复核，按付款日付款；确认后不能再提异议。 | 正文 | [TenantStatementPages.tsx:131](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L131) |
| `TenantStatementPages.4d559f6e` | 写死 | 账单 {statement\_no} | 标题 | [TenantStatementPages.tsx:146](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L146) |
| `TenantStatementPages.20c406da` | 写死 | 找不到这张账单 | 标题 | [TenantStatementPages.tsx:154](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L154) |
| `TenantStatementPages.ee215a9c` | 写死 | 可能是链接写错了。 | 说明 | [TenantStatementPages.tsx:154](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L154) |
| `TenantStatementPages.755e3c17` | 写死 | 请检查网络后重试。 | 说明 | [TenantStatementPages.tsx:156](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L156) |
| `TenantStatementPages.bc2a7ad5` | 写死 | 重试 | 按钮 | [TenantStatementPages.tsx:156](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L156) |
| `TenantStatementPages.ea3fa1f6` | 写死 | 加载失败 | 标题 | [TenantStatementPages.tsx:156](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L156) |
| `TenantStatementPages.06e61b31` | 写死 | 请核对并确认 | 正文 | [TenantStatementPages.tsx:164](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L164) |
| `TenantStatementPages.928c26df` | 写死 | {…} 之前确认或提异议；到期不处理视为确认。 | 正文 | [TenantStatementPages.tsx:165](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L165) |
| `TenantStatementPages.6a250da1` | 写死 | 你们提了异议，等平台答复 | 正文 | [TenantStatementPages.tsx:170](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L170) |
| `TenantStatementPages.ccfff3ff` | 写死 | 这张账单已作废：{…}。平台按现在的数据重出了这一期的账单，请看账单列表。 | 提示 | [TenantStatementPages.tsx:174](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L174) |
| `TenantStatementPages.01fdf7fe` | 写死 | 币种 | 名称 | [TenantStatementPages.tsx:186](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L186) |
| `TenantStatementPages.e9992ac7` | 写死 | 出账时间 | 名称 | [TenantStatementPages.tsx:187](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L187) |
| `TenantStatementPages.33093d26` | 写死 | 你们确认 ·  | 正文 | [TenantStatementPages.tsx:190](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L190) |
| `TenantStatementPages.b897da31` | 写死 | 确认期满，视为确认 ·  | 正文 | [TenantStatementPages.tsx:190](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L190) |
| `TenantStatementPages.22c26ed8` | 写死 | 应付日 | 名称 | [TenantStatementPages.tsx:191](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L191) |
| `TenantStatementPages.aa551643` | 写死 | 银行流水号 | 名称 | [TenantStatementPages.tsx:193](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L193) |
| `TenantStatementPages.072758b7` | 写死 | 提异议 | 按钮 | [TenantStatementPages.tsx:202](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L202) |
| `TenantStatementPages.bac1b8b6` | 写死 | 你可以查看，但没有确认账单的权限（管理员、财务可以）。 | 正文 | [TenantStatementPages.tsx:205](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L205) |
| `TenantStatementPages.4ad0e9fc` | 写死 | 小计 | 标题 | [TenantStatementPages.tsx:211](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L211) |
| `TenantStatementPages.a6a69b21` | 写死 | {…}（{count} 条） | 名称 | [TenantStatementPages.tsx:214](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L214) |
| `TenantStatementPages.0ae3dd94` | 写死 | 明细 | 标题 | [TenantStatementPages.tsx:224](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L224) |
| `TenantStatementPages.6efc0343` | 写死 | 正数是平台付给你们的，负数是从应付里扣的。服务日期是城市当地日期；「往期调整」是上一期出账时还没结案、这一期补上的。 | 正文 | [TenantStatementPages.tsx:225](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L225) |
| `TenantStatementPages.77ceb44f` | 写死 | 经过 | 标题 | [TenantStatementPages.tsx:232](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L232) |
| `TenantStatementPages.494d6b97` | 写死 | 已确认账单 | 提示 | [TenantStatementPages.tsx:256](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L256) |
| `TenantStatementPages.4b5fcfaa` | 写死 | 对这张账单提异议 | 标题 | [TenantStatementPages.tsx:262](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L262) |
| `TenantStatementPages.640e9853` | 写死 | 平台的财务会核对并答复；答复后账单回到「待确认」，再给 7 天确认。有异议的账单不会到期自动确认。 | 正文 | [TenantStatementPages.tsx:263](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L263) |
| `TenantStatementPages.060db991` | 写死 | 哪里不对 | 名称 | [TenantStatementPages.tsx:264](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L264) |
| `TenantStatementPages.ae29f27a` | 写死 | 请写清楚哪一条不对、应该是多少 | 文字 | [TenantStatementPages.tsx:265](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L265) |
| `TenantStatementPages.59e88c92` | 写死 | 如「订单 NZ… 的停车费 JPY 1,500 没有算进来」 | 说明 | [TenantStatementPages.tsx:266](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L266) |
| `TenantStatementPages.d51d57df` | 写死 | 提交异议 | 按钮 | [TenantStatementPages.tsx:268](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L268) |
| `TenantStatementPages.501b993e` | 写死 | 提交中… | 文字 | [TenantStatementPages.tsx:269](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L269) |
| `TenantStatementPages.6e9f5058` | 写死 | 提交 | 按钮 | [TenantStatementPages.tsx:270](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L270) |
| `TenantStatementPages.01bbae25` | 写死 | 已提交异议，等平台答复 | 提示 | [TenantStatementPages.tsx:279](../../apps/web/src/pages/statements/TenantStatementPages.tsx#L279) |

## 收款账户

文件：`apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantPayoutAccountsPage.feb25b3c` | 写死 | 必填 | 文字 | [TenantPayoutAccountsPage.tsx:51](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L51) |
| `TenantPayoutAccountsPage.a22c5e0e` | 写死 | 请选币种 | 错误提示 | [TenantPayoutAccountsPage.tsx:67](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L67) |
| `TenantPayoutAccountsPage.ec867159` | 写死 | 提交 | 文字 | [TenantPayoutAccountsPage.tsx:90](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L90) |
| `TenantPayoutAccountsPage.86b2fab9` | 写死 | 提交收款账户 | 标题 | [TenantPayoutAccountsPage.tsx:98](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L98)、188 行 |
| `TenantPayoutAccountsPage.0335c27e` | 写死 | 取消 | 按钮 | [TenantPayoutAccountsPage.tsx:107](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L107)、164 行 |
| `TenantPayoutAccountsPage.907131b2` | 写死 | 提交中… | 文字 | [TenantPayoutAccountsPage.tsx:108](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L108) |
| `TenantPayoutAccountsPage.43c047fc` | 写死 | 提交审核 | 按钮 | [TenantPayoutAccountsPage.tsx:110](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L110) |
| `TenantPayoutAccountsPage.916be445` | 写死 | 平台审核通过后生效，批准之前现在的账户继续有效。名称和地址请按银行开户资料写英文（国际汇款只能传英文字母、数字和少数符号）。 | 正文 | [TenantPayoutAccountsPage.tsx:115](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L115) |
| `TenantPayoutAccountsPage.8201edeb` | 写死 | 币种 | 名称 | [TenantPayoutAccountsPage.tsx:116](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L116)、195 行 |
| `TenantPayoutAccountsPage.dc2c155b` | 写死 | 请选择 | 输入框占位 | [TenantPayoutAccountsPage.tsx:116](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L116) |
| `TenantPayoutAccountsPage.16b69702` | 写死 | 收款人名称（英文） | 名称 | [TenantPayoutAccountsPage.tsx:117](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L117) |
| `TenantPayoutAccountsPage.a18c0633` | 写死 | 和银行开户名一致 | 说明 | [TenantPayoutAccountsPage.tsx:117](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L117) |
| `TenantPayoutAccountsPage.14166419` | 写死 | 收款人地址（英文） | 名称 | [TenantPayoutAccountsPage.tsx:118](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L118) |
| `TenantPayoutAccountsPage.9d4beeae` | 写死 | 银行名称（英文） | 名称 | [TenantPayoutAccountsPage.tsx:119](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L119) |
| `TenantPayoutAccountsPage.64604710` | 写死 | 银行地址（英文） | 名称 | [TenantPayoutAccountsPage.tsx:120](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L120) |
| `TenantPayoutAccountsPage.486ab81f` | 写死 | 8 或 11 位，向开户行查询 | 说明 | [TenantPayoutAccountsPage.tsx:121](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L121) |
| `TenantPayoutAccountsPage.c73bc69a` | 写死 | SWIFT/BIC | 名称 | [TenantPayoutAccountsPage.tsx:121](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L121) |
| `TenantPayoutAccountsPage.21b1bace` | 写死 | 账号类型 | 标题 | [TenantPayoutAccountsPage.tsx:123](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L123) |
| `TenantPayoutAccountsPage.3a043210` | 写死 | 银行账号 | 名称 | [TenantPayoutAccountsPage.tsx:126](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L126)、132 行 |
| `TenantPayoutAccountsPage.1a2730ad` | 写死 | 保存后只显示末 4 位，请仔细核对 | 说明 | [TenantPayoutAccountsPage.tsx:132](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L132) |
| `TenantPayoutAccountsPage.701de308` | 写死 | 改收款账户要再确认一次是你本人 | 说明 | [TenantPayoutAccountsPage.tsx:133](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L133) |
| `TenantPayoutAccountsPage.72510eb5` | 写死 | 当前登录密码 | 名称 | [TenantPayoutAccountsPage.tsx:133](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L133) |
| `TenantPayoutAccountsPage.4879ea6e` | 写死 | 撤回 | 文字 | [TenantPayoutAccountsPage.tsx:149](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L149)、167 行 |
| `TenantPayoutAccountsPage.de6d7640` | 写死 | 撤回 {currency} 账户 {account\_masked}？ | 标题 | [TenantPayoutAccountsPage.tsx:157](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L157) |
| `TenantPayoutAccountsPage.ec7074be` | 写死 | 撤回中… | 文字 | [TenantPayoutAccountsPage.tsx:165](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L165) |
| `TenantPayoutAccountsPage.4b42bd7e` | 写死 | 撤回后平台不再审核它；要改就重新提交。 | 正文 | [TenantPayoutAccountsPage.tsx:172](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L172) |
| `TenantPayoutAccountsPage.f78f40c0` | 写死 | 收款账户 · NOZOMI {name} | 浏览器标题 | [TenantPayoutAccountsPage.tsx:179](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L179) |
| `TenantPayoutAccountsPage.37ced6c9` | 写死 | 收款账户 | 名称 | [TenantPayoutAccountsPage.tsx:187](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L187)、188、219 行 |
| `TenantPayoutAccountsPage.b98dadd4` | 写死 | 账单 | 名称 | [TenantPayoutAccountsPage.tsx:187](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L187) |
| `TenantPayoutAccountsPage.8c5c3acc` | 写死 | 状态 | 文字 | [TenantPayoutAccountsPage.tsx:196](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L196) |
| `TenantPayoutAccountsPage.6ea08a48` | 写死 | 收款人 | 文字 | [TenantPayoutAccountsPage.tsx:197](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L197) |
| `TenantPayoutAccountsPage.e19f257e` | 写死 | 银行 | 文字 | [TenantPayoutAccountsPage.tsx:198](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L198) |
| `TenantPayoutAccountsPage.3db69c41` | 写死 | 账号 | 文字 | [TenantPayoutAccountsPage.tsx:199](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L199) |
| `TenantPayoutAccountsPage.e185e34e` | 写死 | 提交时间 | 文字 | [TenantPayoutAccountsPage.tsx:200](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L200) |
| `TenantPayoutAccountsPage.6de1a927` | 写死 | 说明 | 文字 | [TenantPayoutAccountsPage.tsx:201](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L201) |
| `TenantPayoutAccountsPage.ebbdd724` | 写死 | 平台审核中 | 文字 | [TenantPayoutAccountsPage.tsx:201](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L201) |
| `TenantPayoutAccountsPage.8618c90d` | 写死 | 操作 | 文字 | [TenantPayoutAccountsPage.tsx:206](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L206) |
| `TenantPayoutAccountsPage.c636842f` | 写死 | 撤回 {currency} 账户 | 按钮 | [TenantPayoutAccountsPage.tsx:207](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L207) |
| `TenantPayoutAccountsPage.0aa8dd2c` | 写死 | 平台按账单的币种把钱付到这种币种生效中的账户。没有生效账户的账单付不了款。 | 正文 | [TenantPayoutAccountsPage.tsx:215](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L215) |
| `TenantPayoutAccountsPage.459ae9d9` | 写死 | 回到账单 | 链接 | [TenantPayoutAccountsPage.tsx:215](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L215) |
| `TenantPayoutAccountsPage.91da3820` | 写死 | 记录太多，这里只显示最新的 200 条。 | 提示 | [TenantPayoutAccountsPage.tsx:217](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L217) |
| `TenantPayoutAccountsPage.6d46efc9` | 写死 | 请让管理员提交。 | 说明 | [TenantPayoutAccountsPage.tsx:219](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L219) |
| `TenantPayoutAccountsPage.8482937a` | 写死 | 还没有收款账户 | 标题 | [TenantPayoutAccountsPage.tsx:219](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L219) |
| `TenantPayoutAccountsPage.ad9741e7` | 写死 | 点右上角提交，平台审核通过后生效。 | 说明 | [TenantPayoutAccountsPage.tsx:219](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L219) |
| `TenantPayoutAccountsPage.2683fd80` | 写死 | 已提交，平台审核通过后生效 | 提示 | [TenantPayoutAccountsPage.tsx:226](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L226) |
| `TenantPayoutAccountsPage.50393734` | 写死 | 已撤回 | 提示 | [TenantPayoutAccountsPage.tsx:237](../../apps/web/src/pages/statements/TenantPayoutAccountsPage.tsx#L237) |

## 多个页面共用：区域在商品里当哪一层（area-layers.ts）

用在：供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑

文件：`apps/web/src/lib/area-layers.ts`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `area-layers.2d5bbcb5` | 写死 | ② 行程区域 | 文字 | [area-layers.ts:14](../../apps/web/src/lib/area-layers.ts#L14) |
| `area-layers.b80cbcd8` | 写死 | ③ 上下车加价区域 | 文字 | [area-layers.ts:14](../../apps/web/src/lib/area-layers.ts#L14) |
| `area-layers.c83a71f3` | 写死 | ① 基础价区域 | 文字 | [area-layers.ts:14](../../apps/web/src/lib/area-layers.ts#L14) |
| `area-layers.401ca4fe` | 写死 | ①基础价 | 文字 | [area-layers.ts:16](../../apps/web/src/lib/area-layers.ts#L16) |
| `area-layers.9fd4ae77` | 写死 | ③上下车加价 | 文字 | [area-layers.ts:16](../../apps/web/src/lib/area-layers.ts#L16) |
| `area-layers.ce5b6de1` | 写死 | ②行程 | 文字 | [area-layers.ts:16](../../apps/web/src/lib/area-layers.ts#L16) |
| `area-layers.000ebbd5` | 写死 | 服务区域 | 文字 | [area-layers.ts:40](../../apps/web/src/lib/area-layers.ts#L40) |
| `area-layers.ea837d77` | 写死 | 同为 ① 基础价区域 | 文字 | [area-layers.ts:45](../../apps/web/src/lib/area-layers.ts#L45) |
| `area-layers.36374411` | 写死 | 同为 ② 行程区域 | 文字 | [area-layers.ts:46](../../apps/web/src/lib/area-layers.ts#L46) |
| `area-layers.22dfbbb9` | 写死 | 同为 ③ 上下车加价区域 | 文字 | [area-layers.ts:47](../../apps/web/src/lib/area-layers.ts#L47) |
| `area-layers.fd536743` | 写死 | ① 基础价区域和 ③ 上下车加价区域 | 文字 | [area-layers.ts:48](../../apps/web/src/lib/area-layers.ts#L48) |
| `area-layers.89d6e705` | 写死 | 不到 0.01 平方公里 | 文字 | [area-layers.ts:54](../../apps/web/src/lib/area-layers.ts#L54) |
| `area-layers.bfc7bfe7` | 写死 | 约 {…} 平方公里 | 文字 | [area-layers.ts:54](../../apps/web/src/lib/area-layers.ts#L54) |
| `area-layers.f5ec1bf8` | 写死 | 「{productLabel}」里和「{otherName}」{…}，重叠{…} | 文字 | [area-layers.ts:59](../../apps/web/src/lib/area-layers.ts#L59) |
| `area-layers.e1063645` | 写死 | 注意：用到它的包车商品里有 {length} 处三层区域重叠，报价时一个点只能有一个答案。请打开这个区域看重叠在哪，用「从本区域减去另一个区域」切掉。 | 文字 | [area-layers.ts:89](../../apps/web/src/lib/area-layers.ts#L89) |
| `area-layers.87b64adb` | 写死 | 这两个区域没有重叠，不用减。 | 提示 | [area-layers.ts:143](../../apps/web/src/lib/area-layers.ts#L143) |
| `area-layers.f27fd0d6` | 写死 | 本区域的营运区整个都在那个区域里，减完什么都不剩。不需要这个区域的话，可以停用或删除它。 | 提示 | [area-layers.ts:145](../../apps/web/src/lib/area-layers.ts#L145) |
| `area-layers.95761d62` | 写死 | 减完的图形太复杂（块数或点数超过上限，或有极细的缝），没法自动切。请手工调整图形。 | 提示 | [area-layers.ts:147](../../apps/web/src/lib/area-layers.ts#L147) |
| `area-layers.ba3e6255` | 写死 | 现在的图形还有要修改的地方，请先改好再减。 | 提示 | [area-layers.ts:149](../../apps/web/src/lib/area-layers.ts#L149) |
| `area-layers.20689ee0` | 写死 | 会切掉{…} | 文字 | [area-layers.ts:155](../../apps/web/src/lib/area-layers.ts#L155) |
| `area-layers.f0fb6914` | 写死 | 碰到的 {length} 块营运区换成减完的 {length} 块 | 文字 | [area-layers.ts:155](../../apps/web/src/lib/area-layers.ts#L155) |
| `area-layers.d6faddcc` | 写死 | 那个区域在本区域中间，区域的图形不能带洞，所以竖着切成了几块 | 文字 | [area-layers.ts:156](../../apps/web/src/lib/area-layers.ts#L156) |
| `area-layers.805fbb5c` | 写死 | {…}。确认后图形换到画面上，保存后才生效；不满意可以撤销。 | 文字 | [area-layers.ts:157](../../apps/web/src/lib/area-layers.ts#L157) |

## 多个页面共用：区域编辑器的地图画布（AreaMap.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/areas/AreaMap.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaMap.51a7eda8` | 写死 | 在禁行区内 | 文字 | [AreaMap.tsx:52](../../apps/web/src/pages/areas/AreaMap.tsx#L52) |
| `AreaMap.6517ae96` | 写死 | 在营运区内 | 文字 | [AreaMap.tsx:52](../../apps/web/src/pages/areas/AreaMap.tsx#L52) |
| `AreaMap.8c3f8ec0` | 写死 | 不在营运区内 | 文字 | [AreaMap.tsx:52](../../apps/web/src/pages/areas/AreaMap.tsx#L52) |
| `AreaMap.55a6573b` | 写死 | 半径 {…} 公里 | 文字 | [AreaMap.tsx:262](../../apps/web/src/pages/areas/AreaMap.tsx#L262)、399 行 |
| `AreaMap.14e129c3` | 写死 | 点地图加点；双击、按 Enter 或点第一个点完成；Backspace 去掉上一个点；Esc 取消。 | 说明 | [AreaMap.tsx:293](../../apps/web/src/pages/areas/AreaMap.tsx#L293) |
| `AreaMap.8251cb1e` | 写死 | 点一下定圆心；Esc 取消。 | 说明 | [AreaMap.tsx:296](../../apps/web/src/pages/areas/AreaMap.tsx#L296) |
| `AreaMap.dda4cac3` | 写死 | 再点一下定半径；Esc 取消。 | 说明 | [AreaMap.tsx:297](../../apps/web/src/pages/areas/AreaMap.tsx#L297) |
| `AreaMap.3484ba73` | 写死 | 点一个位置来自测；Esc 取消。 | 说明 | [AreaMap.tsx:299](../../apps/web/src/pages/areas/AreaMap.tsx#L299) |
| `AreaMap.542fad7e` | 写死 | 地图：拖动平移，滚轮或加减号缩放 | 读屏说明 | [AreaMap.tsx:304](../../apps/web/src/pages/areas/AreaMap.tsx#L304) |
| `AreaMap.a1166660` | 写死 | 在第 {…} 个点后面加一个点 | 读屏说明 | [AreaMap.tsx:363](../../apps/web/src/pages/areas/AreaMap.tsx#L363) |
| `AreaMap.b38785f5` | 写死 | 第 {…} 个点 | 文字 | [AreaMap.tsx:378](../../apps/web/src/pages/areas/AreaMap.tsx#L378) |
| `AreaMap.4de42381` | 写死 | 圆心 | 文字 | [AreaMap.tsx:383](../../apps/web/src/pages/areas/AreaMap.tsx#L383) |
| `AreaMap.75d924cb` | 写死 | 半径 | 文字 | [AreaMap.tsx:384](../../apps/web/src/pages/areas/AreaMap.tsx#L384) |
| `AreaMap.616ca5b2` | 写死 | 放大 | 读屏说明 | [AreaMap.tsx:414](../../apps/web/src/pages/areas/AreaMap.tsx#L414) |
| `AreaMap.93c94c37` | 写死 | 缩小 | 读屏说明 | [AreaMap.tsx:417](../../apps/web/src/pages/areas/AreaMap.tsx#L417) |
| `AreaMap.6fb175f8` | 写死 | 看全部图形 | 读屏说明 | [AreaMap.tsx:420](../../apps/web/src/pages/areas/AreaMap.tsx#L420) |
| `AreaMap.6e7fc724` | 写死 | 回到城市中心 | 读屏说明 | [AreaMap.tsx:423](../../apps/web/src/pages/areas/AreaMap.tsx#L423) |
| `AreaMap.41c78e18` | 写死 | 底图没有加载出来。图形照常显示，也可以用左边的坐标表完成全部操作。 | 正文 | [AreaMap.tsx:432](../../apps/web/src/pages/areas/AreaMap.tsx#L432) |
| `AreaMap.1dba7da7` | 写死 | 图例 | 读屏说明 | [AreaMap.tsx:434](../../apps/web/src/pages/areas/AreaMap.tsx#L434) |
| `AreaMap.40541944` | 写死 | 营运区 | 正文 | [AreaMap.tsx:437](../../apps/web/src/pages/areas/AreaMap.tsx#L437) |
| `AreaMap.1257ec7d` | 写死 | 禁行区 | 正文 | [AreaMap.tsx:441](../../apps/web/src/pages/areas/AreaMap.tsx#L441) |
| `AreaMap.5db79bd6` | 写死 | 不报价，优先于营运区 | 正文 | [AreaMap.tsx:441](../../apps/web/src/pages/areas/AreaMap.tsx#L441) |
| `AreaMap.35fe36ac` | 写死 | 按禁行区算 | 正文 | [AreaMap.tsx:445](../../apps/web/src/pages/areas/AreaMap.tsx#L445) |
| `AreaMap.6237f42c` | 写死 | 重叠的地方 | 正文 | [AreaMap.tsx:445](../../apps/web/src/pages/areas/AreaMap.tsx#L445) |
| `AreaMap.86716adb` | 写死 | 这部分不会报价 | 正文 | [AreaMap.tsx:453](../../apps/web/src/pages/areas/AreaMap.tsx#L453) |
| `AreaMap.92e70ade` | 写死 | 超出运营区域 | 正文 | [AreaMap.tsx:453](../../apps/web/src/pages/areas/AreaMap.tsx#L453) |
| `AreaMap.52b9c974` | 写死 | 自测的位置 | 正文 | [AreaMap.tsx:460](../../apps/web/src/pages/areas/AreaMap.tsx#L460) |

## 多个页面共用：「在地图上查看」（AreaMapDialog.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/areas/AreaMapDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaMapDialog.cb7caf6c` | 写死 | 在地图上查看 | 文字 | [AreaMapDialog.tsx:40](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L40)、141 行 |
| `AreaMapDialog.9f58c9ee` | 写死 | 加载失败 | 标题 | [AreaMapDialog.tsx:72](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L72) |
| `AreaMapDialog.a8e35063` | 写死 | 请检查网络后重试。 | 说明 | [AreaMapDialog.tsx:73](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L73) |
| `AreaMapDialog.9a7bff15` | 写死 | 重试 | 按钮 | [AreaMapDialog.tsx:77](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L77) |
| `AreaMapDialog.b36c5821` | 写死 | 区域加载中 | 名称 | [AreaMapDialog.tsx:81](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L81) |
| `AreaMapDialog.1389a2be` | 写死 | 还没有选区域。 | 说明 | [AreaMapDialog.tsx:83](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L83) |
| `AreaMapDialog.6d0d0025` | 写死 | 选的区域已经被删除了。 | 说明 | [AreaMapDialog.tsx:83](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L83) |
| `AreaMapDialog.becaed28` | 写死 | 没有可以显示的区域 | 标题 | [AreaMapDialog.tsx:83](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L83) |
| `AreaMapDialog.75a8f772` | 写死 | 区域 | 读屏说明 | [AreaMapDialog.tsx:86](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L86) |
| `AreaMapDialog.cb35eed5` | 写死 | 已停用 | 正文 | [AreaMapDialog.tsx:103](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L103) |
| `AreaMapDialog.2638558c` | 写死 | 报价区域超出运营区域：{…}。 | 正文 | [AreaMapDialog.tsx:108](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L108) |
| `AreaMapDialog.ca9ea6dc` | 写死 | 另有 {missing} 个区域已经被删除，不显示。 | 正文 | [AreaMapDialog.tsx:121](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L121) |
| `AreaMapDialog.96a87caf` | 写死 | 重叠只是提醒：同一个位置落在几个区域里时，报价取最低。 | 正文 | [AreaMapDialog.tsx:122](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L122) |
| `AreaMapDialog.2e77510b` | 写死 | 正在加载地图… | 正文 | [AreaMapDialog.tsx:127](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L127) |
| `AreaMapDialog.4437c1b1` | 写死 | 地图没有加载出来。 | 正文 | [AreaMapDialog.tsx:129](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L129) |
| `AreaMapDialog.550800dc` | 写死 | 这个环境没有配置地图底图。 | 正文 | [AreaMapDialog.tsx:129](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L129) |
| `AreaMapDialog.63fa77a6` | 写死 | {…}区域和重叠照常列在上面。 | 正文 | [AreaMapDialog.tsx:129](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L129) |
| `AreaMapDialog.43ad7790` | 写死 | 选中区域的地图 | 名称 | [AreaMapDialog.tsx:131](../../apps/web/src/pages/areas/AreaMapDialog.tsx#L131) |

## 多个页面共用：区域地图的画布（AreaOverviewMap.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/areas/AreaOverviewMap.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaOverviewMap.b95daefe` | 写死 | 区域地图 | 文字 | [AreaOverviewMap.tsx:87](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L87) |
| `AreaOverviewMap.68194dba` | 写死 | {label}：拖动平移，滚轮或加减号缩放；区域的名称、形状和重叠在旁边的列表里 | 读屏说明 | [AreaOverviewMap.tsx:174](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L174) |
| `AreaOverviewMap.dccf5094` | 写死 | 放大 | 读屏说明 | [AreaOverviewMap.tsx:259](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L259) |
| `AreaOverviewMap.397ba796` | 写死 | 缩小 | 读屏说明 | [AreaOverviewMap.tsx:262](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L262) |
| `AreaOverviewMap.7aa6b282` | 写死 | 看全部区域 | 读屏说明 | [AreaOverviewMap.tsx:265](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L265) |
| `AreaOverviewMap.a28b2469` | 写死 | 底图没有加载出来。区域照常显示，名称和重叠见旁边的列表。 | 正文 | [AreaOverviewMap.tsx:269](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L269) |
| `AreaOverviewMap.3a0b4f6b` | 写死 | 图例 | 读屏说明 | [AreaOverviewMap.tsx:271](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L271) |
| `AreaOverviewMap.bd1f95dd` | 写死 | 虚线：只决定能不能接单 | 正文 | [AreaOverviewMap.tsx:279](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L279) |
| `AreaOverviewMap.c38ec266` | 写死 | 运营区域 | 正文 | [AreaOverviewMap.tsx:279](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L279) |
| `AreaOverviewMap.0e2e0c90` | 写死 | 实线：颜色同列表圆点 | 正文 | [AreaOverviewMap.tsx:290](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L290) |
| `AreaOverviewMap.10908dfd` | 写死 | 报价区域 / 运营 + 报价 | 正文 | [AreaOverviewMap.tsx:290](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L290) |
| `AreaOverviewMap.55e46818` | 写死 | 区域 | 正文 | [AreaOverviewMap.tsx:294](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L294) |
| `AreaOverviewMap.e03a4576` | 写死 | 颜色和列表的圆点一致 | 正文 | [AreaOverviewMap.tsx:294](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L294) |
| `AreaOverviewMap.39e14c37` | 写死 | 点落在里面，用到这个区域的商品一律不报价 | 正文 | [AreaOverviewMap.tsx:301](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L301) |
| `AreaOverviewMap.53189cd0` | 写死 | 报价区域的禁行区 | 正文 | [AreaOverviewMap.tsx:301](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L301) |
| `AreaOverviewMap.179fae4f` | 写死 | 报价区域之间，取最低价 | 正文 | [AreaOverviewMap.tsx:310](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L310) |
| `AreaOverviewMap.6cfea9d0` | 写死 | 重叠的地方 | 正文 | [AreaOverviewMap.tsx:310](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L310) |
| `AreaOverviewMap.4a6611c7` | 写死 | 三层区域重叠 | 正文 | [AreaOverviewMap.tsx:320](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L320) |
| `AreaOverviewMap.c720cf02` | 写死 | 同一个包车商品里同一层、或基础价和上下车加价区域重叠，不允许 | 正文 | [AreaOverviewMap.tsx:320](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L320) |
| `AreaOverviewMap.14d43c40` | 写死 | 超出运营区域 | 正文 | [AreaOverviewMap.tsx:331](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L331) |
| `AreaOverviewMap.87208f9b` | 写死 | 报价区域的这部分不会报价 | 正文 | [AreaOverviewMap.tsx:331](../../apps/web/src/pages/areas/AreaOverviewMap.tsx#L331) |

## 多个页面共用：自测（SelfTest.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/areas/SelfTest.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SelfTest.7d1b1d5b` | 写死 | 这里只判断这个区域的范围。实际能不能报价，还要看商品、价格规则和服务时间。 | 说明 | [SelfTest.tsx:42](../../apps/web/src/pages/areas/SelfTest.tsx#L42) |
| `SelfTest.9db3d25c` | 写死 | 找不到这个区域，它可能已被删除。 | 文字 | [SelfTest.tsx:89](../../apps/web/src/pages/areas/SelfTest.tsx#L89) |
| `SelfTest.4105c139` | 写死 | 没有检查成功。请检查网络后重试。 | 文字 | [SelfTest.tsx:90](../../apps/web/src/pages/areas/SelfTest.tsx#L90) |
| `SelfTest.f02ab89f` | 写死 | 没有检查成功。请稍后再试。 | 文字 | [SelfTest.tsx:90](../../apps/web/src/pages/areas/SelfTest.tsx#L90) |
| `SelfTest.ff3c6011` | 写死 | 等 {length} 块 | 正文 | [SelfTest.tsx:125](../../apps/web/src/pages/areas/SelfTest.tsx#L125) |
| `SelfTest.c426bc2f` | 写死 | 输入一个坐标，或在地图上点一个位置，看它会不会被报价。 | 正文 | [SelfTest.tsx:133](../../apps/web/src/pages/areas/SelfTest.tsx#L133) |
| `SelfTest.6a0c5cb6` | 写死 | 自测的位置 | 标题 | [SelfTest.tsx:134](../../apps/web/src/pages/areas/SelfTest.tsx#L134) |
| `SelfTest.d408c575` | 写死 | 检查中… | 文字 | [SelfTest.tsx:136](../../apps/web/src/pages/areas/SelfTest.tsx#L136) |
| `SelfTest.cb682ba2` | 写死 | 检查 | 按钮 | [SelfTest.tsx:138](../../apps/web/src/pages/areas/SelfTest.tsx#L138) |
| `SelfTest.50f56ce3` | 写死 | 在地图上点 | 按钮 | [SelfTest.tsx:142](../../apps/web/src/pages/areas/SelfTest.tsx#L142) |
| `SelfTest.9cbf0f8d` | 写死 | 重试 | 按钮 | [SelfTest.tsx:151](../../apps/web/src/pages/areas/SelfTest.tsx#L151) |
| `SelfTest.5eaa5e9c` | 写死 | 有图形还需要修改（边交叉了等），修好以后再自测。 | 正文 | [SelfTest.tsx:159](../../apps/web/src/pages/areas/SelfTest.tsx#L159) |
| `SelfTest.4581f91f` | 写死 | 图形改过了，请重新检查。 | 正文 | [SelfTest.tsx:162](../../apps/web/src/pages/areas/SelfTest.tsx#L162) |
| `SelfTest.6e7e98ed` | 写死 | 不在营运区内 | 名称 | [SelfTest.tsx:165](../../apps/web/src/pages/areas/SelfTest.tsx#L165) |
| `SelfTest.8b8ac9f8` | 写死 | 在营运区内 | 名称 | [SelfTest.tsx:165](../../apps/web/src/pages/areas/SelfTest.tsx#L165) |
| `SelfTest.e4ad3423` | 写死 | 在禁行区内 | 名称 | [SelfTest.tsx:165](../../apps/web/src/pages/areas/SelfTest.tsx#L165) |
| `SelfTest.0c6e3877` | 写死 | 按画面上还没保存的图形判断。 | 正文 | [SelfTest.tsx:166](../../apps/web/src/pages/areas/SelfTest.tsx#L166) |
| `SelfTest.6b56b18a` | 写死 | 这个位置可以报价。它在{…}里。 | 正文 | [SelfTest.tsx:168](../../apps/web/src/pages/areas/SelfTest.tsx#L168) |
| `SelfTest.a12229f2` | 写死 | 这个位置不报价。它在{…}里。 {…} | 正文 | [SelfTest.tsx:171](../../apps/web/src/pages/areas/SelfTest.tsx#L171) |
| `SelfTest.c639e45b` | 写死 | 它同时也在{…}里，但禁行区优先。 | 正文 | [SelfTest.tsx:172](../../apps/web/src/pages/areas/SelfTest.tsx#L172) |
| `SelfTest.fd3bfe41` | 写死 | 这个位置不报价。它不在任何一块营运区里。 | 正文 | [SelfTest.tsx:175](../../apps/web/src/pages/areas/SelfTest.tsx#L175) |
| `SelfTest.a6ea14ac` | 写死 | 这个区域已停用，启用后才会用于报价。 | 正文 | [SelfTest.tsx:177](../../apps/web/src/pages/areas/SelfTest.tsx#L177) |

## 多个页面共用：从区域共享库引用（SharedAreaDialog.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域编辑

文件：`apps/web/src/pages/areas/SharedAreaDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SharedAreaDialog.d928460a` | 写死 | 这个城市里你已经有同名的区域了，请改个名字再引用。 | 提示 | [SharedAreaDialog.tsx:73](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L73) |
| `SharedAreaDialog.3b33c067` | 写死 | 这块区域你名下已经有了（共享库里保留的就是你自己建的那份），直接用它即可，不用再引用。 | 提示 | [SharedAreaDialog.tsx:74](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L74) |
| `SharedAreaDialog.559b2989` | 写死 | 这个区域已经不在共享库里了（可能被停用），请换一个。 | 提示 | [SharedAreaDialog.tsx:75](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L75) |
| `SharedAreaDialog.7eea8aa3` | 写死 | 这个城市已被平台停用，不能在它下面新增区域。 | 提示 | [SharedAreaDialog.tsx:76](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L76) |
| `SharedAreaDialog.4b1f17da` | 写死 | 系统暂时无法{action}，请稍后再试。 | 提示 | [SharedAreaDialog.tsx:77](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L77) |
| `SharedAreaDialog.cc3650e9` | 写死 | 查询共享库 | 文字 | [SharedAreaDialog.tsx:89](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L89)、162 行 |
| `SharedAreaDialog.a9c24ccb` | 写死 | 请填写区域名称。 | 错误提示 | [SharedAreaDialog.tsx:99](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L99) |
| `SharedAreaDialog.637f3df0` | 写死 | 你选的那份已被平台合并，已改为引用共享库里保留的同一块区域 | 提示 | [SharedAreaDialog.tsx:109](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L109) |
| `SharedAreaDialog.bfeef622` | 写死 | 你选的那份已被平台合并，已改为引用「{redirectedTo}」 | 提示 | [SharedAreaDialog.tsx:109](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L109) |
| `SharedAreaDialog.b0ab3d54` | 写死 | 引用这个区域 | 文字 | [SharedAreaDialog.tsx:112](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L112) |
| `SharedAreaDialog.af52535c` | 写死 | 从共享库引用区域 | 标题 | [SharedAreaDialog.tsx:122](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L122) |
| `SharedAreaDialog.998a8127` | 写死 | 换一个 | 按钮 | [SharedAreaDialog.tsx:130](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L130) |
| `SharedAreaDialog.7f58d4b3` | 写死 | 引用中… | 文字 | [SharedAreaDialog.tsx:131](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L131) |
| `SharedAreaDialog.16a359cb` | 写死 | 引用到我的区域 | 按钮 | [SharedAreaDialog.tsx:133](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L133) |
| `SharedAreaDialog.7731808a` | 写死 | 取消 | 按钮 | [SharedAreaDialog.tsx:138](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L138) |
| `SharedAreaDialog.aff809af` | 写死 | 共享库里是各家供应商画好的区域，只有名称和形状，不显示是谁建的，也不带价格。引用 = 复制一份到你名下；来源以后改了形状，你的区域不会跟着变，会提示你是否切换。 | 正文 | [SharedAreaDialog.tsx:142](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L142) |
| `SharedAreaDialog.d4d75801` | 写死 | 城市 | 名称 | [SharedAreaDialog.tsx:147](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L147) |
| `SharedAreaDialog.5f560187` | 写死 | 请选择城市 | 输入框占位 | [SharedAreaDialog.tsx:148](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L148) |
| `SharedAreaDialog.a955b56e` | 写死 | 平台还没有启用中的城市 | 空状态 | [SharedAreaDialog.tsx:154](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L154) |
| `SharedAreaDialog.201892f7` | 写死 | 名称（选填） | 表单标签 | [SharedAreaDialog.tsx:157](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L157) |
| `SharedAreaDialog.3623480d` | 写死 | 查询中… | 文字 | [SharedAreaDialog.tsx:160](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L160) |
| `SharedAreaDialog.5f86a27e` | 写死 | 这个城市的共享库里还没有符合条件的区域，可以自己新建（新建的会自动进共享库）。 | 正文 | [SharedAreaDialog.tsx:166](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L166) |
| `SharedAreaDialog.e778c8e8` | 写死 | 共享区域 | 读屏说明 | [SharedAreaDialog.tsx:168](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L168) |
| `SharedAreaDialog.d35d7d3b` | 写死 | {…}「{text}」的形状 | 读屏说明 | [SharedAreaDialog.tsx:181](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L181) |
| `SharedAreaDialog.dad73f20` | 写死 | 收起 | 读屏说明 | [SharedAreaDialog.tsx:181](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L181) |
| `SharedAreaDialog.e8d98362` | 写死 | 看 | 读屏说明 | [SharedAreaDialog.tsx:181](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L181) |
| `SharedAreaDialog.4164376a` | 写死 | 看形状 | 按钮 | [SharedAreaDialog.tsx:182](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L182) |
| `SharedAreaDialog.a51fa1c5` | 写死 | 收起形状 | 按钮 | [SharedAreaDialog.tsx:182](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L182) |
| `SharedAreaDialog.0b855ef0` | 写死 | 引用「{text}」 | 读屏说明 | [SharedAreaDialog.tsx:186](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L186) |
| `SharedAreaDialog.98930575` | 写死 | 引用 | 按钮 | [SharedAreaDialog.tsx:193](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L193) |
| `SharedAreaDialog.bde56059` | 写死 | 只显示了最近修改的 50 个，请输入名称缩小范围。 | 正文 | [SharedAreaDialog.tsx:205](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L205) |
| `SharedAreaDialog.385a0200` | 写死 | 引用「 | 正文 | [SharedAreaDialog.tsx:214](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L214) |
| `SharedAreaDialog.630e3a1c` | 写死 | 在你这里叫什么 | 表单标签 | [SharedAreaDialog.tsx:221](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L221) |
| `SharedAreaDialog.c24cbe16` | 写死 | 业务类型 | 表单标签 | [SharedAreaDialog.tsx:225](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L225) |
| `SharedAreaDialog.1f027841` | 写死 | 用途 | 表单标签 | [SharedAreaDialog.tsx:233](../../apps/web/src/pages/areas/SharedAreaDialog.tsx#L233) |

## 多个页面共用：共享库里一个区域的形状预览（SharedAreaPreview.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域编辑

文件：`apps/web/src/pages/areas/SharedAreaPreview.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `SharedAreaPreview.102b6084` | 写死 |  · 禁行区 {forbid\_polygon\_count} 块 | 文字 | [SharedAreaPreview.tsx:26](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L26) |
| `SharedAreaPreview.6c6fcfd8` | 写死 | 营运区 {operate\_polygon\_count} 块{…} | 文字 | [SharedAreaPreview.tsx:26](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L26) |
| `SharedAreaPreview.40bcfb8e` | 写死 | 这个区域已经不在共享库里了（可能被停用），请换一个。 | 正文 | [SharedAreaPreview.tsx:49](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L49) |
| `SharedAreaPreview.66d11531` | 写死 | 「{name}」的形状没有加载出来。请检查网络后重试。 | 正文 | [SharedAreaPreview.tsx:54](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L54) |
| `SharedAreaPreview.72c95bfc` | 写死 | 重试 | 按钮 | [SharedAreaPreview.tsx:57](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L57) |
| `SharedAreaPreview.41757cc8` | 写死 | 正在加载「{name}」的形状 | 名称 | [SharedAreaPreview.tsx:62](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L62) |
| `SharedAreaPreview.036c730f` | 写死 | 地图没有加载出来，看不到形状。 | 正文 | [SharedAreaPreview.tsx:67](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L67) |
| `SharedAreaPreview.2ea44a43` | 写死 | 这个环境没有配置地图底图，看不到形状。 | 正文 | [SharedAreaPreview.tsx:67](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L67) |
| `SharedAreaPreview.b0b119d5` | 写死 | 正在加载地图 | 名称 | [SharedAreaPreview.tsx:74](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L74) |
| `SharedAreaPreview.53e06879` | 写死 | 「{name}」的形状 | 名称 | [SharedAreaPreview.tsx:85](../../apps/web/src/pages/areas/SharedAreaPreview.tsx#L85) |

## 多个页面共用：区域的停用（useAreaActions.tsx）

用在：供应商后台 · 区域列表；供应商后台 · 区域地图（运营后台也用）；供应商后台 · 区域编辑

文件：`apps/web/src/pages/areas/useAreaActions.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `useAreaActions.600784be` | 写死 | 你没有权限修改区域。需要的话，请联系你们的管理员开通。 | 文字 | [useAreaActions.tsx:22](../../apps/web/src/pages/areas/useAreaActions.tsx#L22) |
| `useAreaActions.56838b86` | 写死 | 系统暂时无法{action}，请稍后再试。 | 提示 | [useAreaActions.tsx:47](../../apps/web/src/pages/areas/useAreaActions.tsx#L47) |
| `useAreaActions.576a47d9` | 写死 | 已停用「{…}」 | 提示 | [useAreaActions.tsx:67](../../apps/web/src/pages/areas/useAreaActions.tsx#L67) |
| `useAreaActions.7182238d` | 写死 | 已删除区域「{…}」 | 提示 | [useAreaActions.tsx:72](../../apps/web/src/pages/areas/useAreaActions.tsx#L72) |
| `useAreaActions.d09c7db6` | 写死 | 停用 | 文字 | [useAreaActions.tsx:76](../../apps/web/src/pages/areas/useAreaActions.tsx#L76)、121、213 行 |
| `useAreaActions.f6748df3` | 写死 | 删除 | 文字 | [useAreaActions.tsx:76](../../apps/web/src/pages/areas/useAreaActions.tsx#L76)、121、221 行 |
| `useAreaActions.eb92f7e4` | 写死 | 「{name}」已经被别人删除了。 | 文字 | [useAreaActions.tsx:80](../../apps/web/src/pages/areas/useAreaActions.tsx#L80) |
| `useAreaActions.6b1dedbc` | 写死 | 有已上架的商品在用这个区域。 | 文字 | [useAreaActions.tsx:86](../../apps/web/src/pages/areas/useAreaActions.tsx#L86) |
| `useAreaActions.8c66a829` | 写死 | 有 {count} 个已上架的商品在用这个区域。 | 文字 | [useAreaActions.tsx:86](../../apps/web/src/pages/areas/useAreaActions.tsx#L86) |
| `useAreaActions.4a263352` | 写死 | ，再回来删除 | 文字 | [useAreaActions.tsx:87](../../apps/web/src/pages/areas/useAreaActions.tsx#L87) |
| `useAreaActions.4dfaa589` | 写死 | {who}请先把这些商品下架，或在商品里去掉这个区域{…}。 | 文字 | [useAreaActions.tsx:87](../../apps/web/src/pages/areas/useAreaActions.tsx#L87) |
| `useAreaActions.81dc6297` | 写死 | {verb}没有成功。{…} | 文字 | [useAreaActions.tsx:91](../../apps/web/src/pages/areas/useAreaActions.tsx#L91) |
| `useAreaActions.1bf13f75` | 写死 | 已启用「{…}」 | 提示 | [useAreaActions.tsx:104](../../apps/web/src/pages/areas/useAreaActions.tsx#L104) |
| `useAreaActions.d7dfec8d` | 写死 | 「{name}」所属的城市「{text}」已被平台停用，不能启用。 | 文字 | [useAreaActions.tsx:108](../../apps/web/src/pages/areas/useAreaActions.tsx#L108) |
| `useAreaActions.73b92b30` | 写死 | 找不到「{name}」，它可能已被删除。 | 文字 | [useAreaActions.tsx:110](../../apps/web/src/pages/areas/useAreaActions.tsx#L110) |
| `useAreaActions.964bc399` | 写死 | 启用「{name}」没有成功。{…} | 文字 | [useAreaActions.tsx:111](../../apps/web/src/pages/areas/useAreaActions.tsx#L111) |
| `useAreaActions.c4995b4f` | 写死 | 启用 | 文字 | [useAreaActions.tsx:111](../../apps/web/src/pages/areas/useAreaActions.tsx#L111)、217 行 |
| `useAreaActions.4dfb1547` | 写死 | {verb}区域「{name}」？ | 标题 | [useAreaActions.tsx:126](../../apps/web/src/pages/areas/useAreaActions.tsx#L126) |
| `useAreaActions.4f077d94` | 写死 | 知道了 | 按钮 | [useAreaActions.tsx:134](../../apps/web/src/pages/areas/useAreaActions.tsx#L134)、190 行 |
| `useAreaActions.be2c0d59` | 写死 | 取消 | 按钮 | [useAreaActions.tsx:139](../../apps/web/src/pages/areas/useAreaActions.tsx#L139) |
| `useAreaActions.3ce68164` | 写死 | {verb}中… | 文字 | [useAreaActions.tsx:140](../../apps/web/src/pages/areas/useAreaActions.tsx#L140) |
| `useAreaActions.2d3218c3` | 写死 | 现在不能{verb}。 | 正文 | [useAreaActions.tsx:150](../../apps/web/src/pages/areas/useAreaActions.tsx#L150) |
| `useAreaActions.f56529c3` | 写死 | 查看这些商品 | 链接 | [useAreaActions.tsx:157](../../apps/web/src/pages/areas/useAreaActions.tsx#L157)、176 行 |
| `useAreaActions.0dbd7183` | 写死 | 删除后不能恢复。这个区域的 {operate\_polygon\_count} 块营运区、{forbid\_polygon\_count} 块禁行区会一起删除。只是暂时不用的话，可以改为停用。 | 正文 | [useAreaActions.tsx:167](../../apps/web/src/pages/areas/useAreaActions.tsx#L167) |
| `useAreaActions.92ec47c0` | 写死 | 停用后，建商品时不能再选这个区域，报价时也不再使用它。区域和它的图形都保留，之后可以重新启用。 | 正文 | [useAreaActions.tsx:168](../../apps/web/src/pages/areas/useAreaActions.tsx#L168) |
| `useAreaActions.43c9a610` | 写死 | 有 {unpublishedUsers} 个没上架的商品选了这个区域，删除后它们会少掉这个区域。 | 正文 | [useAreaActions.tsx:173](../../apps/web/src/pages/areas/useAreaActions.tsx#L173) |

## 多个页面共用：履约评分（PerformanceView.tsx）

用在：供应商后台 · 公司；供应商后台 · 服务表现；运营后台 · 供应商（列表、新建、详情）

文件：`apps/web/src/pages/company/PerformanceView.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PerformanceView.a6825299` | 写死 | 已暂停。 | 正文 | [PerformanceView.tsx:36](../../apps/web/src/pages/company/PerformanceView.tsx#L36) |
| `PerformanceView.3729a744` | 写死 | 原因：{…}。 | 正文 | [PerformanceView.tsx:37](../../apps/web/src/pages/company/PerformanceView.tsx#L37) |
| `PerformanceView.ad69810a` | 写死 | 在观察期。 | 正文 | [PerformanceView.tsx:42](../../apps/web/src/pages/company/PerformanceView.tsx#L42) |
| `PerformanceView.a7d6017c` | 写死 | 原因：{…}。观察期里比价时排序价按对外价 ×1.05 计算；原因消除后自动退出。 | 正文 | [PerformanceView.tsx:43](../../apps/web/src/pages/company/PerformanceView.tsx#L43) |
| `PerformanceView.64977809` | 写死 | 还没有评分：每天会按最近 {window\_days} 天的数据算一次。完成不足 {min\_completed\_orders} 单时按默认 {…} 分参与比价。 | 正文 | [PerformanceView.tsx:47](../../apps/web/src/pages/company/PerformanceView.tsx#L47) |
| `PerformanceView.cbfa14cc` | 写死 | 比价用的分 | 正文 | [PerformanceView.tsx:52](../../apps/web/src/pages/company/PerformanceView.tsx#L52)、117 行 |
| `PerformanceView.cbc4969c` | 写死 | 按数据算出的分 | 正文 | [PerformanceView.tsx:56](../../apps/web/src/pages/company/PerformanceView.tsx#L56) |
| `PerformanceView.c090692f` | 写死 | 还没有数据 | 正文 | [PerformanceView.tsx:57](../../apps/web/src/pages/company/PerformanceView.tsx#L57) |
| `PerformanceView.155ed271` | 写死 | 近 {window\_days} 天完成订单 | 正文 | [PerformanceView.tsx:60](../../apps/web/src/pages/company/PerformanceView.tsx#L60) |
| `PerformanceView.224d946e` | 写死 | {completed\_orders} 单 | 正文 | [PerformanceView.tsx:61](../../apps/web/src/pages/company/PerformanceView.tsx#L61) |
| `PerformanceView.ace92c1a` | 写死 | 近 {no\_show\_window\_days} 天司机未到 | 正文 | [PerformanceView.tsx:64](../../apps/web/src/pages/company/PerformanceView.tsx#L64) |
| `PerformanceView.3e101e29` | 写死 | {no\_shows} 次 | 正文 | [PerformanceView.tsx:65](../../apps/web/src/pages/company/PerformanceView.tsx#L65) |
| `PerformanceView.edc5b1ff` | 写死 | 算的是哪一天 | 正文 | [PerformanceView.tsx:68](../../apps/web/src/pages/company/PerformanceView.tsx#L68) |
| `PerformanceView.c5850cf2` | 写死 | {date}（{window\_from} 起） | 正文 | [PerformanceView.tsx:69](../../apps/web/src/pages/company/PerformanceView.tsx#L69) |
| `PerformanceView.264af206` | 写死 | 完成不足 {min\_completed\_orders} 单：比价时按默认 {…} 分算。下面是按现有数据算出的各项，供参考。 | 正文 | [PerformanceView.tsx:72](../../apps/web/src/pages/company/PerformanceView.tsx#L72) |
| `PerformanceView.3c2a3e20` | 写死 | 评分的各项指标 | 读屏说明 | [PerformanceView.tsx:74](../../apps/web/src/pages/company/PerformanceView.tsx#L74) |
| `PerformanceView.99d1f93b` | 写死 | 指标 | 表头 | [PerformanceView.tsx:78](../../apps/web/src/pages/company/PerformanceView.tsx#L78) |
| `PerformanceView.16ea54c5` | 写死 | 近 90 天 | 表头 | [PerformanceView.tsx:79](../../apps/web/src/pages/company/PerformanceView.tsx#L79) |
| `PerformanceView.556408e1` | 写死 | 得分（5 分制） | 表头 | [PerformanceView.tsx:80](../../apps/web/src/pages/company/PerformanceView.tsx#L80) |
| `PerformanceView.e9fee82f` | 写死 | 权重 | 表头 | [PerformanceView.tsx:81](../../apps/web/src/pages/company/PerformanceView.tsx#L81) |
| `PerformanceView.1411bdda` | 写死 | 不计（没有数据） | 正文 | [PerformanceView.tsx:92](../../apps/web/src/pages/company/PerformanceView.tsx#L92) |
| `PerformanceView.3b34f81a` | 写死 | 规则：评分按最近 {window\_days} 天滚动、每天重算；低于 {…} 进入观察期，低于 {…} 自动暂停{…}；近 {no\_show\_window\_days} 天司机未到 {no\_show\_observation} 次进入观察期、{no\_show\_suspend} 次自动暂停。某一项没有数据时不计入，其余按比例。 | 正文 | [PerformanceView.tsx:103](../../apps/web/src/pages/company/PerformanceView.tsx#L103) |
| `PerformanceView.aa69f09a` | 写死 | ，由运营人工恢复 | 正文 | [PerformanceView.tsx:103](../../apps/web/src/pages/company/PerformanceView.tsx#L103) |
| `PerformanceView.bfbb307f` | 写死 | ，需要平台人工恢复 | 正文 | [PerformanceView.tsx:103](../../apps/web/src/pages/company/PerformanceView.tsx#L103) |
| `PerformanceView.033e593e` | 写死 | 评分趋势 | 标题 | [PerformanceView.tsx:109](../../apps/web/src/pages/company/PerformanceView.tsx#L109) |
| `PerformanceView.22f82b1b` | 写死 | 评分趋势（最近 14 天） | 读屏说明 | [PerformanceView.tsx:112](../../apps/web/src/pages/company/PerformanceView.tsx#L112) |
| `PerformanceView.7a1b7641` | 写死 | 日期 | 表头 | [PerformanceView.tsx:116](../../apps/web/src/pages/company/PerformanceView.tsx#L116) |
| `PerformanceView.d8470d27` | 写死 | 按数据的分 | 表头 | [PerformanceView.tsx:118](../../apps/web/src/pages/company/PerformanceView.tsx#L118) |
| `PerformanceView.45e8839c` | 写死 | 完成订单 | 表头 | [PerformanceView.tsx:119](../../apps/web/src/pages/company/PerformanceView.tsx#L119) |
| `PerformanceView.f2b9c90e` | 写死 | （默认） | 正文 | [PerformanceView.tsx:126](../../apps/web/src/pages/company/PerformanceView.tsx#L126) |

## 多个页面共用：订单的一张证据照片（EvidencePhoto.tsx）

用在：供应商后台 · 订单（列表、详情）；运营后台 · 工单详情；运营后台 · 订单（列表、详情）

文件：`apps/web/src/pages/orders/EvidencePhoto.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `EvidencePhoto.678f30bf` | 写死 | （第 {ordinal} 张） | 文字 | [EvidencePhoto.tsx:126](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L126) |
| `EvidencePhoto.6b361b0a` | 写死 | 查看{kind}{which} | 按钮 | [EvidencePhoto.tsx:137](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L137) |
| `EvidencePhoto.99390709` | 写死 | 照片读不出来 | 正文 | [EvidencePhoto.tsx:141](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L141) |
| `EvidencePhoto.641c74f0` | 写死 | 重新取{kind}{which} | 按钮 | [EvidencePhoto.tsx:142](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L142) |
| `EvidencePhoto.f7935ce3` | 写死 | 加载中… | 正文 | [EvidencePhoto.tsx:146](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L146) |
| `EvidencePhoto.d4c5f00c` | 写死 | {kind}，系统时间 {time} | 名称 | [EvidencePhoto.tsx:149](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L149) |
| `EvidencePhoto.e6326eec` | 写死 | 浏览器显示不了这种格式，请下载后查看。 | 正文 | [EvidencePhoto.tsx:149](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L149) |
| `EvidencePhoto.48a3e009` | 写死 | 下载{kind}原图{which} | 链接 | [EvidencePhoto.tsx:151](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L151) |
| `EvidencePhoto.83dfde65` | 写死 | {kind} · 系统时间 | 正文 | [EvidencePhoto.tsx:160](../../apps/web/src/pages/orders/EvidencePhoto.tsx#L160) |

## 多个页面共用：① 基础信息（BasicStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/BasicStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `BasicStep.57c95b12` | 写死 | 机场或车站 ↔ 市内，分接和送。一个商品对应一个机场或车站。 | 说明 | [BasicStep.tsx:37](../../apps/web/src/pages/products/BasicStep.tsx#L37) |
| `BasicStep.0c15419e` | 写死 | 市内任意两点之间，上车点和下车点都要在服务区域里。 | 说明 | [BasicStep.tsx:38](../../apps/web/src/pages/products/BasicStep.tsx#L38) |
| `BasicStep.778c2f60` | 写死 | 按小时包一辆车，卖的是套餐（如 5 小时、10 小时）。 | 说明 | [BasicStep.tsx:39](../../apps/web/src/pages/products/BasicStep.tsx#L39) |
| `BasicStep.393736db` | 写死 | 现在有 {usableCount} 个可以选的区域 | 提示 | [BasicStep.tsx:155](../../apps/web/src/pages/products/BasicStep.tsx#L155) |
| `BasicStep.6cd34035` | 写死 | 已清空：换了城市，原来选的接送点不能用了。 | 文字 | [BasicStep.tsx:172](../../apps/web/src/pages/products/BasicStep.tsx#L172) |
| `BasicStep.2a9a4a83` | 写死 | 已清空：换了城市，原来选的区域不能用了。 | 文字 | [BasicStep.tsx:173](../../apps/web/src/pages/products/BasicStep.tsx#L173) |
| `BasicStep.043fd808` | 写死 | 已去掉 {dropped} 个不适用于{…}的区域。 | 文字 | [BasicStep.tsx:184](../../apps/web/src/pages/products/BasicStep.tsx#L184) |
| `BasicStep.419c1389` | 写死 | {text} 现在排第 {…}，共 {length} 个 | 提示 | [BasicStep.tsx:195](../../apps/web/src/pages/products/BasicStep.tsx#L195) |
| `BasicStep.947daf90` | 写死 | 调度人：第 {…} 个调度人 | 名称 | [BasicStep.tsx:219](../../apps/web/src/pages/products/BasicStep.tsx#L219) |
| `BasicStep.4c1601c0` | 写死 | {label}请填写姓名 | 文字 | [BasicStep.tsx:220](../../apps/web/src/pages/products/BasicStep.tsx#L220) |
| `BasicStep.3b003157` | 写死 | {label}的姓名最多 {maxDispatcherNameLength} 个字 | 文字 | [BasicStep.tsx:221](../../apps/web/src/pages/products/BasicStep.tsx#L221) |
| `BasicStep.aa2c5067` | 写死 | {label}请填写电话 | 文字 | [BasicStep.tsx:222](../../apps/web/src/pages/products/BasicStep.tsx#L222) |
| `BasicStep.1e074582` | 写死 | {label}的电话只能是数字，可以带开头的 + 和中间的空格、短横线，例如 +81 90 1234 5678 | 文字 | [BasicStep.tsx:223](../../apps/web/src/pages/products/BasicStep.tsx#L223) |
| `BasicStep.bb19f61e` | 写死 | 子品牌：请选择子品牌 | 文字 | [BasicStep.tsx:230](../../apps/web/src/pages/products/BasicStep.tsx#L230) |
| `BasicStep.6e10848d` | 写死 | 城市：请选择城市 | 文字 | [BasicStep.tsx:231](../../apps/web/src/pages/products/BasicStep.tsx#L231) |
| `BasicStep.1426817a` | 写死 | 品类：请选择品类 | 文字 | [BasicStep.tsx:232](../../apps/web/src/pages/products/BasicStep.tsx#L232) |
| `BasicStep.14f655a0` | 写死 | 接送点：请选择机场或车站 | 文字 | [BasicStep.tsx:233](../../apps/web/src/pages/products/BasicStep.tsx#L233) |
| `BasicStep.3189084d` | 写死 | 车型组：请给「{text}」选一个「人数 / 行李数」组合 | 文字 | [BasicStep.tsx:236](../../apps/web/src/pages/products/BasicStep.tsx#L236) |
| `BasicStep.65cc1950` | 写死 | 「{name}」是运营区域，不能给商品勾选：运营区域只决定能不能接单，不带价格。请换一个报价区域。 | 文字 | [BasicStep.tsx:295](../../apps/web/src/pages/products/BasicStep.tsx#L295) |
| `BasicStep.a778d46f` | 写死 | 「{name}」不能给这个商品用（业务类型或城市不对）。 | 文字 | [BasicStep.tsx:295](../../apps/web/src/pages/products/BasicStep.tsx#L295) |
| `BasicStep.b94f01f6` | 写死 | 「{name}」已经被删除。 | 文字 | [BasicStep.tsx:295](../../apps/web/src/pages/products/BasicStep.tsx#L295) |
| `BasicStep.dcf86453` | 写死 | 「{name}」已经停用，不能新选。 | 文字 | [BasicStep.tsx:295](../../apps/web/src/pages/products/BasicStep.tsx#L295) |
| `BasicStep.8d07874f` | 写死 | 服务区域 | 文字 | [BasicStep.tsx:296](../../apps/web/src/pages/products/BasicStep.tsx#L296)、568 行 |
| `BasicStep.3ff22348` | 写死 | 「{name}」已被平台停用，不能新选。 | 文字 | [BasicStep.tsx:299](../../apps/web/src/pages/products/BasicStep.tsx#L299) |
| `BasicStep.49ffc66a` | 写死 | 「{name}」选的「人数 / 行李数」平台已经取消，请重新选择。 | 文字 | [BasicStep.tsx:299](../../apps/web/src/pages/products/BasicStep.tsx#L299) |
| `BasicStep.ac309d25` | 写死 | 车型组 | 文字 | [BasicStep.tsx:300](../../apps/web/src/pages/products/BasicStep.tsx#L300)、744 行 |
| `BasicStep.87f1806c` | 写死 | 第 {…} 个调度人的电话只能是数字，可以带开头的 + 和中间的空格、短横线 | 文字 | [BasicStep.tsx:301](../../apps/web/src/pages/products/BasicStep.tsx#L301) |
| `BasicStep.abbcfdd7` | 写死 | 调度人 | 文字 | [BasicStep.tsx:301](../../apps/web/src/pages/products/BasicStep.tsx#L301)、872 行 |
| `BasicStep.b95fc26d` | 写死 | 城市 | 文字 | [BasicStep.tsx:302](../../apps/web/src/pages/products/BasicStep.tsx#L302)、405、502 行 |
| `BasicStep.d1b60758` | 写死 | 这个城市已经被平台停用，请换一个。 | 文字 | [BasicStep.tsx:302](../../apps/web/src/pages/products/BasicStep.tsx#L302) |
| `BasicStep.3a98c779` | 写死 | 这个接送点已经被平台停用，请换一个。 | 文字 | [BasicStep.tsx:303](../../apps/web/src/pages/products/BasicStep.tsx#L303) |
| `BasicStep.840fe502` | 写死 | 这个接送点已经不在选的城市里了，请重新选。 | 文字 | [BasicStep.tsx:303](../../apps/web/src/pages/products/BasicStep.tsx#L303) |
| `BasicStep.bc2388ca` | 写死 | 接送点 | 文字 | [BasicStep.tsx:303](../../apps/web/src/pages/products/BasicStep.tsx#L303)、410、528、533 行 |
| `BasicStep.474ae44a` | 写死 | 这个子品牌已停用，请换一个。 | 文字 | [BasicStep.tsx:304](../../apps/web/src/pages/products/BasicStep.tsx#L304) |
| `BasicStep.491f2ce7` | 写死 | 子品牌 | 文字 | [BasicStep.tsx:304](../../apps/web/src/pages/products/BasicStep.tsx#L304)、397、461 行 |
| `BasicStep.0c279cad` | 写死 | 还没有子品牌 | 文字 | [BasicStep.tsx:354](../../apps/web/src/pages/products/BasicStep.tsx#L354) |
| `BasicStep.144ee8b6` | 写死 | 四 | 文字 | [BasicStep.tsx:361](../../apps/web/src/pages/products/BasicStep.tsx#L361) |
| `BasicStep.eea64b35` | 写死 | 三 | 文字 | [BasicStep.tsx:361](../../apps/web/src/pages/products/BasicStep.tsx#L361) |
| `BasicStep.39121ddb` | 写死 | 保存并下一步 | 名称 | [BasicStep.tsx:365](../../apps/web/src/pages/products/BasicStep.tsx#L365) |
| `BasicStep.4fd337ed` | 写死 | ① 基础信息 | 标题 | [BasicStep.tsx:365](../../apps/web/src/pages/products/BasicStep.tsx#L365) |
| `BasicStep.96440d75` | 写死 | 上架前要填这一项。 | 正文 | [BasicStep.tsx:368](../../apps/web/src/pages/products/BasicStep.tsx#L368) |
| `BasicStep.996196c1` | 写死 | 这个商品还没有名字。名字在第 ⑤ 步「商品详情」里填，现在列表里先显示成「未命名的{…}商品」。 | 正文 | [BasicStep.tsx:377](../../apps/web/src/pages/products/BasicStep.tsx#L377) |
| `BasicStep.0fadd86d` | 写死 | 去填标题 | 按钮 | [BasicStep.tsx:381](../../apps/web/src/pages/products/BasicStep.tsx#L381) |
| `BasicStep.039aa4d9` | 写死 | 知道了 | 按钮 | [BasicStep.tsx:384](../../apps/web/src/pages/products/BasicStep.tsx#L384) |
| `BasicStep.6619af1f` | 写死 | 创建后不能修改的内容 | 标题 | [BasicStep.tsx:391](../../apps/web/src/pages/products/BasicStep.tsx#L391) |
| `BasicStep.2370959a` | 写死 | 这几项创建后不能修改。要换，请新建一个商品。 | 正文 | [BasicStep.tsx:394](../../apps/web/src/pages/products/BasicStep.tsx#L394) |
| `BasicStep.6072d551` | 写死 | 这几项是供应商创建商品时选定的，创建后不能修改。 | 正文 | [BasicStep.tsx:394](../../apps/web/src/pages/products/BasicStep.tsx#L394) |
| `BasicStep.5586ba2a` | 写死 | 品类 | 正文 | [BasicStep.tsx:401](../../apps/web/src/pages/products/BasicStep.tsx#L401)、523 行 |
| `BasicStep.2ae12c53` | 写死 | 这{lockedCount}项创建后不能修改。 | 正文 | [BasicStep.tsx:419](../../apps/web/src/pages/products/BasicStep.tsx#L419) |
| `BasicStep.91fc2a0f` | 写死 | 选错了只能删掉这个草稿重新建，请先确认。 | 正文 | [BasicStep.tsx:420](../../apps/web/src/pages/products/BasicStep.tsx#L420) |
| `BasicStep.12c5a147` | 写死 | 子品牌没有加载出来。 | 正文 | [BasicStep.tsx:427](../../apps/web/src/pages/products/BasicStep.tsx#L427) |
| `BasicStep.a157c08a` | 写死 | 重试 | 按钮 | [BasicStep.tsx:429](../../apps/web/src/pages/products/BasicStep.tsx#L429)、585、757 行 |
| `BasicStep.f1e9cd98` | 写死 | 正在加载子品牌… | 正文 | [BasicStep.tsx:432](../../apps/web/src/pages/products/BasicStep.tsx#L432) |
| `BasicStep.1242889f` | 写死 | 还没有子品牌。 | 正文 | [BasicStep.tsx:441](../../apps/web/src/pages/products/BasicStep.tsx#L441) |
| `BasicStep.58ac90a0` | 写死 | 商品要挂在一个子品牌下面，子品牌决定金额用哪种币种。请先建一个。 | 正文 | [BasicStep.tsx:441](../../apps/web/src/pages/products/BasicStep.tsx#L441) |
| `BasicStep.6975751c` | 写死 | 新建子品牌 | 按钮 | [BasicStep.tsx:446](../../apps/web/src/pages/products/BasicStep.tsx#L446)、468 行 |
| `BasicStep.8081d4ea` | 写死 | 还没有子品牌，暂时不能新建商品。 | 正文 | [BasicStep.tsx:451](../../apps/web/src/pages/products/BasicStep.tsx#L451) |
| `BasicStep.dadec296` | 写死 | 请联系你们的管理员新建子品牌。 | 正文 | [BasicStep.tsx:451](../../apps/web/src/pages/products/BasicStep.tsx#L451) |
| `BasicStep.3f7a59d0` | 写死 | 请选择 | 选项 | [BasicStep.tsx:487](../../apps/web/src/pages/products/BasicStep.tsx#L487)、841 行 |
| `BasicStep.93a1cd20` | 写死 | 请选择子品牌 | 提示 | [BasicStep.tsx:493](../../apps/web/src/pages/products/BasicStep.tsx#L493) |
| `BasicStep.046f24a8` | 写死 | 这个商品的金额都用 {currency} 填写，创建后不能修改。 | 正文 | [BasicStep.tsx:495](../../apps/web/src/pages/products/BasicStep.tsx#L495) |
| `BasicStep.6806abeb` | 写死 | 子品牌决定这个商品所有金额的币种，创建后不能修改。 | 正文 | [BasicStep.tsx:495](../../apps/web/src/pages/products/BasicStep.tsx#L495) |
| `BasicStep.b28c1cbf` | 写死 | 有区域的城市 | 文字 | [BasicStep.tsx:509](../../apps/web/src/pages/products/BasicStep.tsx#L509) |
| `BasicStep.f0de2a0a` | 写死 | 其他城市 | 文字 | [BasicStep.tsx:509](../../apps/web/src/pages/products/BasicStep.tsx#L509) |
| `BasicStep.fe502194` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [BasicStep.tsx:512](../../apps/web/src/pages/products/BasicStep.tsx#L512) |
| `BasicStep.b8192995` | 写死 | 平台还没有启用中的城市 | 空状态 | [BasicStep.tsx:513](../../apps/web/src/pages/products/BasicStep.tsx#L513) |
| `BasicStep.070248c3` | 写死 | 请选择城市 | 提示 | [BasicStep.tsx:516](../../apps/web/src/pages/products/BasicStep.tsx#L516) |
| `BasicStep.7727afb4` | 写死 | 商品属于一个城市，时间规则都按这个城市的当地时间算。 | 说明 | [BasicStep.tsx:517](../../apps/web/src/pages/products/BasicStep.tsx#L517) |
| `BasicStep.ccbf19fc` | 写死 | 国家：{…} | 正文 | [BasicStep.tsx:520](../../apps/web/src/pages/products/BasicStep.tsx#L520) |
| `BasicStep.600ae126` | 写死 | 请选择品类 | 提示 | [BasicStep.tsx:523](../../apps/web/src/pages/products/BasicStep.tsx#L523) |
| `BasicStep.0496f7fd` | 写死 | 请先选择城市 | 说明 | [BasicStep.tsx:528](../../apps/web/src/pages/products/BasicStep.tsx#L528) |
| `BasicStep.a0062ba9` | 写死 | 输入名称或三字代码查找 | 输入框占位 | [BasicStep.tsx:538](../../apps/web/src/pages/products/BasicStep.tsx#L538) |
| `BasicStep.9189023d` | 写死 | 这个城市还没有可选的机场或车站 | 空状态 | [BasicStep.tsx:539](../../apps/web/src/pages/products/BasicStep.tsx#L539) |
| `BasicStep.7f7c7145` | 写死 | 请选择机场或车站 | 提示 | [BasicStep.tsx:543](../../apps/web/src/pages/products/BasicStep.tsx#L543) |
| `BasicStep.623a5434` | 写死 | 一个商品对应一个机场或车站。要做多个机场，请每个机场建一个商品。 | 说明 | [BasicStep.tsx:544](../../apps/web/src/pages/products/BasicStep.tsx#L544) |
| `BasicStep.c21a8056` | 写死 | 平台还没有在「{cityName}」下启用机场或车站，暂时不能建接送机商品。请联系平台运营。 | 正文 | [BasicStep.tsx:553](../../apps/web/src/pages/products/BasicStep.tsx#L553) |
| `BasicStep.6b38f594` | 写死 | 服务范围与联系人 | 标题 | [BasicStep.tsx:563](../../apps/web/src/pages/products/BasicStep.tsx#L563) |
| `BasicStep.0c09b167` | 写死 | 先选城市和品类，这里会列出可以用的区域。 | 正文 | [BasicStep.tsx:573](../../apps/web/src/pages/products/BasicStep.tsx#L573) |
| `BasicStep.20b0cc27` | 写死 | 正在加载区域… | 正文 | [BasicStep.tsx:579](../../apps/web/src/pages/products/BasicStep.tsx#L579) |
| `BasicStep.a446be82` | 写死 | 区域没有加载出来。 | 正文 | [BasicStep.tsx:583](../../apps/web/src/pages/products/BasicStep.tsx#L583) |
| `BasicStep.6660825a` | 写死 | 商品要选它在哪些区域里接单，请先去画一个。 | 正文 | [BasicStep.tsx:595](../../apps/web/src/pages/products/BasicStep.tsx#L595) |
| `BasicStep.c99c4018` | 写死 | 你们还没有区域。 | 正文 | [BasicStep.tsx:595](../../apps/web/src/pages/products/BasicStep.tsx#L595) |
| `BasicStep.adf744df` | 写死 | 请先在这个城市画一个区域。 | 正文 | [BasicStep.tsx:599](../../apps/web/src/pages/products/BasicStep.tsx#L599) |
| `BasicStep.cbc75d8a` | 写死 | 「{cityName}」下还没有区域。 | 正文 | [BasicStep.tsx:599](../../apps/web/src/pages/products/BasicStep.tsx#L599) |
| `BasicStep.fa72bc0b` | 写死 | 「{cityName}」下只有运营区域，还没有能给{categoryName}商品勾选的报价区域。 | 正文 | [BasicStep.tsx:603](../../apps/web/src/pages/products/BasicStep.tsx#L603) |
| `BasicStep.68ab2980` | 写死 | 运营区域只决定能不能接单，不带价格。请在运营区域里面画一个报价区域（或把运营区域改成「运营 + 报价」），再回来勾选、设价格。 | 正文 | [BasicStep.tsx:604](../../apps/web/src/pages/products/BasicStep.tsx#L604) |
| `BasicStep.033ffcf3` | 写死 | 「{cityName}」下有 {length} 个区域，但没有一个能给{categoryName}商品用。 | 正文 | [BasicStep.tsx:608](../../apps/web/src/pages/products/BasicStep.tsx#L608) |
| `BasicStep.576cbdb7` | 写死 | 区域的业务类型要是「{categoryName}」或「通用」。可以新增一个，或把已有区域的业务类型改成「通用」。 | 正文 | [BasicStep.tsx:609](../../apps/web/src/pages/products/BasicStep.tsx#L609) |
| `BasicStep.31084b80` | 写死 | 「{cityName}」下能用的 {length} 个区域都已停用。 | 正文 | [BasicStep.tsx:613](../../apps/web/src/pages/products/BasicStep.tsx#L613) |
| `BasicStep.41ab13ed` | 写死 | 请先启用，或新增一个。 | 正文 | [BasicStep.tsx:613](../../apps/web/src/pages/products/BasicStep.tsx#L613) |
| `BasicStep.efcfac1a` | 写死 | 请联系你们的管理员。 | 正文 | [BasicStep.tsx:616](../../apps/web/src/pages/products/BasicStep.tsx#L616) |
| `BasicStep.9f7be5fd` | 写死 | 新增区域 | 按钮 | [BasicStep.tsx:622](../../apps/web/src/pages/products/BasicStep.tsx#L622) |
| `BasicStep.1ca6ff75` | 写死 | 去区域列表 | 按钮 | [BasicStep.tsx:627](../../apps/web/src/pages/products/BasicStep.tsx#L627) |
| `BasicStep.b100611d` | 写死 | 重新读取 | 按钮 | [BasicStep.tsx:638](../../apps/web/src/pages/products/BasicStep.tsx#L638) |
| `BasicStep.d01a675f` | 写死 | 添加区域 | 按钮 | [BasicStep.tsx:645](../../apps/web/src/pages/products/BasicStep.tsx#L645) |
| `BasicStep.c4e131ac` | 写死 | 按名称搜索 | 名称 | [BasicStep.tsx:646](../../apps/web/src/pages/products/BasicStep.tsx#L646) |
| `BasicStep.c420a810` | 写死 | 营运区 {operate\_polygon\_count} 块 · 禁行区 {forbid\_polygon\_count} 块 | 说明 | [BasicStep.tsx:653](../../apps/web/src/pages/products/BasicStep.tsx#L653) |
| `BasicStep.2a783055` | 写死 | 最多 {maxAreas} 个 | 文字 | [BasicStep.tsx:657](../../apps/web/src/pages/products/BasicStep.tsx#L657) |
| `BasicStep.3133441d` | 写死 | 没有可以选的区域 | 空状态 | [BasicStep.tsx:658](../../apps/web/src/pages/products/BasicStep.tsx#L658) |
| `BasicStep.64eeae8f` | 写死 | 去新增区域 | 链接 | [BasicStep.tsx:663](../../apps/web/src/pages/products/BasicStep.tsx#L663) |
| `BasicStep.a918fcb1` | 写死 | 还没有选区域 | 正文 | [BasicStep.tsx:675](../../apps/web/src/pages/products/BasicStep.tsx#L675) |
| `BasicStep.ac9f31fc` | 写死 | 已停用 | 名称 | [BasicStep.tsx:701](../../apps/web/src/pages/products/BasicStep.tsx#L701) |
| `BasicStep.60dddc9d` | 写死 | 把 {name} 上移 | 名称 | [BasicStep.tsx:705](../../apps/web/src/pages/products/BasicStep.tsx#L705) |
| `BasicStep.a1d49a91` | 写死 | 把 {name} 下移 | 名称 | [BasicStep.tsx:706](../../apps/web/src/pages/products/BasicStep.tsx#L706) |
| `BasicStep.a42c7d35` | 写死 | 移除 {name} | 名称 | [BasicStep.tsx:707](../../apps/web/src/pages/products/BasicStep.tsx#L707)、814 行 |
| `BasicStep.295e8631` | 写死 | 有 {disabledAreas} 个区域已停用。 | 正文 | [BasicStep.tsx:728](../../apps/web/src/pages/products/BasicStep.tsx#L728) |
| `BasicStep.8125ff9c` | 写死 | 上架前要把它们重新启用，或在这里移除。 | 正文 | [BasicStep.tsx:729](../../apps/web/src/pages/products/BasicStep.tsx#L729) |
| `BasicStep.715235ad` | 写死 | 只能选「{cityName}」下、业务类型是「{categoryName}」或「通用」的启用中的报价区域（或「运营 + 报价」）。上下移动可以调整顺序，排在前面的优先。 | 正文 | [BasicStep.tsx:735](../../apps/web/src/pages/products/BasicStep.tsx#L735) |
| `BasicStep.87efc489` | 写死 | 供应商给这个商品选的区域，排在前面的优先。 | 正文 | [BasicStep.tsx:735](../../apps/web/src/pages/products/BasicStep.tsx#L735) |
| `BasicStep.0211f1dd` | 写死 | 现在报价时，一个位置落在好几个区域里的话，每个区域都会算一遍价，取最低的；顺序目前只影响价格规则等页面里区域的排列顺序。 | 正文 | [BasicStep.tsx:736](../../apps/web/src/pages/products/BasicStep.tsx#L736) |
| `BasicStep.5beed051` | 写死 | 正在加载车型组… | 正文 | [BasicStep.tsx:751](../../apps/web/src/pages/products/BasicStep.tsx#L751) |
| `BasicStep.75ad0be1` | 写死 | 车型组没有加载出来。 | 正文 | [BasicStep.tsx:755](../../apps/web/src/pages/products/BasicStep.tsx#L755) |
| `BasicStep.5d7d1a64` | 写死 | 平台还没有启用的车型组，暂时不能选。请联系平台运营。 | 正文 | [BasicStep.tsx:761](../../apps/web/src/pages/products/BasicStep.tsx#L761) |
| `BasicStep.debd7722` | 写死 | 添加车型组 | 按钮 | [BasicStep.tsx:765](../../apps/web/src/pages/products/BasicStep.tsx#L765) |
| `BasicStep.20785d06` | 写死 | 按名称或编码搜索 | 名称 | [BasicStep.tsx:766](../../apps/web/src/pages/products/BasicStep.tsx#L766) |
| `BasicStep.7d3aa045` | 写死 | {…} · {seats} 座 | 正文 | [BasicStep.tsx:775](../../apps/web/src/pages/products/BasicStep.tsx#L775)、809 行 |
| `BasicStep.d5a11772` | 写死 | 最多 {maxVehicleGroups} 个 | 文字 | [BasicStep.tsx:782](../../apps/web/src/pages/products/BasicStep.tsx#L782) |
| `BasicStep.89fb57ec` | 写死 | 没有可以选的车型组 | 空状态 | [BasicStep.tsx:783](../../apps/web/src/pages/products/BasicStep.tsx#L783) |
| `BasicStep.66e350c1` | 写死 | 还没有选车型组 | 正文 | [BasicStep.tsx:794](../../apps/web/src/pages/products/BasicStep.tsx#L794) |
| `BasicStep.a22776a0` | 写死 | 平台已停用 | 名称 | [BasicStep.tsx:810](../../apps/web/src/pages/products/BasicStep.tsx#L810) |
| `BasicStep.20f07ed5` | 写死 | 人数 / 行李数：{…} | 正文 | [BasicStep.tsx:820](../../apps/web/src/pages/products/BasicStep.tsx#L820) |
| `BasicStep.abd09a01` | 写死 | 人数 / 行李数 | 正文 | [BasicStep.tsx:825](../../apps/web/src/pages/products/BasicStep.tsx#L825) |
| `BasicStep.34122b24` | 写死 | {name} 的人数 / 行李数 | 读屏说明 | [BasicStep.tsx:831](../../apps/web/src/pages/products/BasicStep.tsx#L831) |
| `BasicStep.e4e5ef99` | 写死 | {…}（平台已取消） | 选项 | [BasicStep.tsx:840](../../apps/web/src/pages/products/BasicStep.tsx#L840) |
| `BasicStep.727d5da8` | 写死 | 请给「{name}」选一个「人数 / 行李数」组合 | 提示 | [BasicStep.tsx:850](../../apps/web/src/pages/products/BasicStep.tsx#L850) |
| `BasicStep.6e2be048` | 写死 | 原来选的组合平台已经取消，上架前请重新选择。 | 正文 | [BasicStep.tsx:851](../../apps/web/src/pages/products/BasicStep.tsx#L851) |
| `BasicStep.e3a1da35` | 写死 | 有 {disabledGroups} 个车型组已被平台停用。 | 正文 | [BasicStep.tsx:862](../../apps/web/src/pages/products/BasicStep.tsx#L862) |
| `BasicStep.9fbcd182` | 写死 | 上架前要在这里移除。 | 正文 | [BasicStep.tsx:863](../../apps/web/src/pages/products/BasicStep.tsx#L863) |
| `BasicStep.9e98922e` | 写死 | 供应商能提供的车型，每个车型组带一个「人数 / 行李数」组合：客人的人数或行李数超过这个组合时，这个车型不报价。 | 正文 | [BasicStep.tsx:866](../../apps/web/src/pages/products/BasicStep.tsx#L866) |
| `BasicStep.b7944ce8` | 写死 | 选你能提供的车型。每个车型组选一个「人数 / 行李数」组合：客人的人数或行李数超过这个组合时，这个车型不报价。 | 正文 | [BasicStep.tsx:866](../../apps/web/src/pages/products/BasicStep.tsx#L866) |
| `BasicStep.7b11c9ea` | 写死 | 还没有调度人 | 正文 | [BasicStep.tsx:876](../../apps/web/src/pages/products/BasicStep.tsx#L876) |
| `BasicStep.807c0bb4` | 写死 | 姓名 | 正文 | [BasicStep.tsx:899](../../apps/web/src/pages/products/BasicStep.tsx#L899) |
| `BasicStep.3b758901` | 写死 | 第 {…} 个调度人的姓名 | 读屏说明 | [BasicStep.tsx:900](../../apps/web/src/pages/products/BasicStep.tsx#L900) |
| `BasicStep.7d8ca2a5` | 写死 | 电话 | 正文 | [BasicStep.tsx:903](../../apps/web/src/pages/products/BasicStep.tsx#L903) |
| `BasicStep.365305ed` | 写死 | 第 {…} 个调度人的电话 | 读屏说明 | [BasicStep.tsx:904](../../apps/web/src/pages/products/BasicStep.tsx#L904) |
| `BasicStep.d3bb1d31` | 写死 | 删除第 {…} 个调度人 | 名称 | [BasicStep.tsx:906](../../apps/web/src/pages/products/BasicStep.tsx#L906) |
| `BasicStep.934b398f` | 写死 | 添加调度人 | 按钮 | [BasicStep.tsx:915](../../apps/web/src/pages/products/BasicStep.tsx#L915) |
| `BasicStep.ddb7d05a` | 写死 |  最多 {maxDispatchers} 个 | 正文 | [BasicStep.tsx:916](../../apps/web/src/pages/products/BasicStep.tsx#L916) |
| `BasicStep.784ba285` | 写死 | 第 {…} 个调度人的电话和第 {…} 个相同。 | 正文 | [BasicStep.tsx:922](../../apps/web/src/pages/products/BasicStep.tsx#L922) |
| `BasicStep.2de9d87d` | 写死 | 接到订单后联系谁。姓名和电话会随订单一起发给平台客服和你们的调度系统。电话建议带国家区号。 | 正文 | [BasicStep.tsx:923](../../apps/web/src/pages/products/BasicStep.tsx#L923) |
| `BasicStep.40ab3df1` | 写死 | 接到订单后联系谁。姓名和电话会随订单一起发给平台客服和供应商的调度系统。 | 正文 | [BasicStep.tsx:923](../../apps/web/src/pages/products/BasicStep.tsx#L923) |

## 多个页面共用：新建子品牌（BrandDialog.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/BrandDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `BrandDialog.93f397f4` | 写死 | 请填写名称 | 提示 | [BrandDialog.tsx:29](../../apps/web/src/pages/products/BrandDialog.tsx#L29) |
| `BrandDialog.f0737711` | 写死 | 名称最多 {maxBrandNameLength} 个字 | 提示 | [BrandDialog.tsx:30](../../apps/web/src/pages/products/BrandDialog.tsx#L30) |
| `BrandDialog.a9a40c56` | 写死 | 已经有同名的子品牌，请换一个名字 | 提示 | [BrandDialog.tsx:31](../../apps/web/src/pages/products/BrandDialog.tsx#L31) |
| `BrandDialog.98275106` | 写死 | 请选择结算币种 | 提示 | [BrandDialog.tsx:33](../../apps/web/src/pages/products/BrandDialog.tsx#L33) |
| `BrandDialog.1e385f3e` | 写死 | 已新建子品牌「{name}」 | 提示 | [BrandDialog.tsx:64](../../apps/web/src/pages/products/BrandDialog.tsx#L64) |
| `BrandDialog.c41f5ae1` | 写死 | 你没有权限新建子品牌。请联系你们的管理员。 | 文字 | [BrandDialog.tsx:71](../../apps/web/src/pages/products/BrandDialog.tsx#L71) |
| `BrandDialog.e758ef99` | 写死 | 新建 | 文字 | [BrandDialog.tsx:72](../../apps/web/src/pages/products/BrandDialog.tsx#L72)、93 行 |
| `BrandDialog.834c07b6` | 写死 | 新建子品牌 | 标题 | [BrandDialog.tsx:82](../../apps/web/src/pages/products/BrandDialog.tsx#L82) |
| `BrandDialog.5e6f59cd` | 写死 | 取消 | 按钮 | [BrandDialog.tsx:90](../../apps/web/src/pages/products/BrandDialog.tsx#L90) |
| `BrandDialog.c2ccfd74` | 写死 | 新建中… | 文字 | [BrandDialog.tsx:91](../../apps/web/src/pages/products/BrandDialog.tsx#L91) |
| `BrandDialog.03977e6e` | 写死 | 名称 | 表单标签 | [BrandDialog.tsx:102](../../apps/web/src/pages/products/BrandDialog.tsx#L102) |
| `BrandDialog.d6cb39c9` | 写死 | 你们对外用的品牌名。只有一个品牌的话，填公司或车队的名字就行。 | 正文 | [BrandDialog.tsx:123](../../apps/web/src/pages/products/BrandDialog.tsx#L123) |
| `BrandDialog.2eadf784` | 写死 | 结算币种 | 表单标签 | [BrandDialog.tsx:129](../../apps/web/src/pages/products/BrandDialog.tsx#L129) |
| `BrandDialog.a97099dd` | 写死 | 请选择 | 选项 | [BrandDialog.tsx:134](../../apps/web/src/pages/products/BrandDialog.tsx#L134) |
| `BrandDialog.6319145b` | 写死 | 这个子品牌下所有商品的价格都用这种币种填写，平台也按它跟你们结算。 | 正文 | [BrandDialog.tsx:143](../../apps/web/src/pages/products/BrandDialog.tsx#L143) |
| `BrandDialog.5b267f9b` | 写死 | 币种创建后不能修改。 | 正文 | [BrandDialog.tsx:147](../../apps/web/src/pages/products/BrandDialog.tsx#L147) |
| `BrandDialog.d717ca52` | 写死 | 选错了只能另建一个子品牌。 | 正文 | [BrandDialog.tsx:148](../../apps/web/src/pages/products/BrandDialog.tsx#L148) |
