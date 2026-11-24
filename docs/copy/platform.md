# 运营后台（第 1 / 3 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 3969 条：写死 3963 条，已走 key 6 条。列的意思见 [README](README.md)。

本区域分 3 份：第 1 份 · [第 2 份](platform-2.md) · [第 3 份](platform-3.md)

## 页面

- [首页](#首页)（58 条）
- [供应商（列表、新建、详情）](#供应商列表新建详情)（137 条）
- [资质审核](#资质审核)（26 条）
- [商品（只读查看）](#商品只读查看)（67 条）
- [报价试算](#报价试算)（179 条）
- [未覆盖需求](#未覆盖需求)（97 条）
- [渠道](#渠道)（102 条）
- [待审核](#待审核)（88 条）
- [平台员工](#平台员工)（93 条）
- [账号安全和角色](#账号安全和角色)（141 条）
- [系统设置（审计日志、系统状态）](#系统设置审计日志系统状态)（258 条）
- [订单（列表、详情）](#订单列表详情)（306 条）
- [取消政策](#取消政策)（39 条）

## 首页

文件：`apps/web/src/pages/PlatformHomePage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PlatformHomePage.049df415` | 写死 | 启用 | 名称 | [PlatformHomePage.tsx:37](../../apps/web/src/pages/PlatformHomePage.tsx#L37)、144 行 |
| `PlatformHomePage.d2ddd7c2` | 写死 | 已停用 | 名称 | [PlatformHomePage.tsx:37](../../apps/web/src/pages/PlatformHomePage.tsx#L37) |
| `PlatformHomePage.13af72a8` | 写死 | 首页 · NOZOMI {name} | 浏览器标题 | [PlatformHomePage.tsx:74](../../apps/web/src/pages/PlatformHomePage.tsx#L74) |
| `PlatformHomePage.74bae8ab` | 写死 | 数量已更新 | 提示 | [PlatformHomePage.tsx:126](../../apps/web/src/pages/PlatformHomePage.tsx#L126) |
| `PlatformHomePage.5bea57e8` | 写死 | {…} 个已上架的商品报不出价 | 文字 | [PlatformHomePage.tsx:142](../../apps/web/src/pages/PlatformHomePage.tsx#L142) |
| `PlatformHomePage.247e01fc` | 写死 | 全部 | 名称 | [PlatformHomePage.tsx:144](../../apps/web/src/pages/PlatformHomePage.tsx#L144) |
| `PlatformHomePage.31d3a114` | 写死 | 待审核 | 名称 | [PlatformHomePage.tsx:145](../../apps/web/src/pages/PlatformHomePage.tsx#L145)、214 行 |
| `PlatformHomePage.c10ec145` | 写死 | {…} 条改动等你或同事审核 | 文字 | [PlatformHomePage.tsx:146](../../apps/web/src/pages/PlatformHomePage.tsx#L146) |
| `PlatformHomePage.5050a22f` | 写死 | 已超时 | 名称 | [PlatformHomePage.tsx:147](../../apps/web/src/pages/PlatformHomePage.tsx#L147)、149 行 |
| `PlatformHomePage.663351e8` | 写死 | 待处理和处理中 | 名称 | [PlatformHomePage.tsx:147](../../apps/web/src/pages/PlatformHomePage.tsx#L147) |
| `PlatformHomePage.79ac9f3f` | 写死 | {…} 条异常已超过处理时限 | 文字 | [PlatformHomePage.tsx:148](../../apps/web/src/pages/PlatformHomePage.tsx#L148) |
| `PlatformHomePage.6a77b7b6` | 写死 | 没有结论 | 名称 | [PlatformHomePage.tsx:149](../../apps/web/src/pages/PlatformHomePage.tsx#L149) |
| `PlatformHomePage.74c35003` | 写死 | {…} 张工单超过了响应或结案期限 | 文字 | [PlatformHomePage.tsx:150](../../apps/web/src/pages/PlatformHomePage.tsx#L150) |
| `PlatformHomePage.05e7cbef` | 写死 | 默认表（需求原表） | 文字 | [PlatformHomePage.tsx:151](../../apps/web/src/pages/PlatformHomePage.tsx#L151) |
| `PlatformHomePage.cff6df2f` | 写死 | 第 {version} 版 | 文字 | [PlatformHomePage.tsx:151](../../apps/web/src/pages/PlatformHomePage.tsx#L151) |
| `PlatformHomePage.13df0e54` | 写死 | 待复核 | 名称 | [PlatformHomePage.tsx:152](../../apps/web/src/pages/PlatformHomePage.tsx#L152) |
| `PlatformHomePage.3086d920` | 写死 | 有异议 | 名称 | [PlatformHomePage.tsx:152](../../apps/web/src/pages/PlatformHomePage.tsx#L152) |
| `PlatformHomePage.8eb1a509` | 写死 | 待确认 | 名称 | [PlatformHomePage.tsx:152](../../apps/web/src/pages/PlatformHomePage.tsx#L152) |
| `PlatformHomePage.5e83c62f` | 写死 | {…} 张账单有异议，等答复 | 文字 | [PlatformHomePage.tsx:154](../../apps/web/src/pages/PlatformHomePage.tsx#L154) |
| `PlatformHomePage.1eaa89d1` | 写死 | {…} 张账单已确认，等发起付款复核 | 文字 | [PlatformHomePage.tsx:155](../../apps/web/src/pages/PlatformHomePage.tsx#L155) |
| `PlatformHomePage.69ee750e` | 写死 | 收账单中 | 名称 | [PlatformHomePage.tsx:157](../../apps/web/src/pages/PlatformHomePage.tsx#L157) |
| `PlatformHomePage.a0396378` | 写死 | {…} 个机场待指定城市 | 文字 | [PlatformHomePage.tsx:165](../../apps/web/src/pages/PlatformHomePage.tsx#L165) |
| `PlatformHomePage.07f37f95` | 写死 | 先新增城市，才能给机场指定城市 | 文字 | [PlatformHomePage.tsx:166](../../apps/web/src/pages/PlatformHomePage.tsx#L166) |
| `PlatformHomePage.2d0ee085` | 写死 | 还没有汇率 | 文字 | [PlatformHomePage.tsx:169](../../apps/web/src/pages/PlatformHomePage.tsx#L169) |
| `PlatformHomePage.36663a48` | 写死 | 更新于 {…} | 文字 | [PlatformHomePage.tsx:169](../../apps/web/src/pages/PlatformHomePage.tsx#L169) |
| `PlatformHomePage.62f0f937` | 写死 | 还没有汇率，跨币种报价都报不出 | 文字 | [PlatformHomePage.tsx:171](../../apps/web/src/pages/PlatformHomePage.tsx#L171) |
| `PlatformHomePage.13cbc29e` | 写死 | 有一批汇率变动超过 3%，待确认 | 文字 | [PlatformHomePage.tsx:172](../../apps/web/src/pages/PlatformHomePage.tsx#L172) |
| `PlatformHomePage.8877d14a` | 写死 | {currency}（到 {…}） | 文字 | [PlatformHomePage.tsx:174](../../apps/web/src/pages/PlatformHomePage.tsx#L174) |
| `PlatformHomePage.c9e4152a` | 写死 | 人工锁定中：{…} | 文字 | [PlatformHomePage.tsx:174](../../apps/web/src/pages/PlatformHomePage.tsx#L174) |
| `PlatformHomePage.92f7385d` | 写死 | 首页 | 名称 | [PlatformHomePage.tsx:178](../../apps/web/src/pages/PlatformHomePage.tsx#L178)、179 行 |
| `PlatformHomePage.41e99269` | 写死 | 数量没有加载出来 | 正文 | [PlatformHomePage.tsx:186](../../apps/web/src/pages/PlatformHomePage.tsx#L186) |
| `PlatformHomePage.06a49210` | 写死 | 入口可以照常使用。请检查网络后重试。 | 正文 | [PlatformHomePage.tsx:187](../../apps/web/src/pages/PlatformHomePage.tsx#L187) |
| `PlatformHomePage.5978a58b` | 写死 | 重试 | 按钮 | [PlatformHomePage.tsx:190](../../apps/web/src/pages/PlatformHomePage.tsx#L190) |
| `PlatformHomePage.e17fa311` | 写死 | 汇率超过 48 小时没有更新，跨币种报价已暂停 | 正文 | [PlatformHomePage.tsx:196](../../apps/web/src/pages/PlatformHomePage.tsx#L196) |
| `PlatformHomePage.62d26811` | 写死 | 现在这批汇率是 {…} 的。 {…} | 正文 | [PlatformHomePage.tsx:198](../../apps/web/src/pages/PlatformHomePage.tsx#L198) |
| `PlatformHomePage.5ef4de36` | 写死 | 人工锁定的币种（{…}）和美元之间照常报价。 | 正文 | [PlatformHomePage.tsx:199](../../apps/web/src/pages/PlatformHomePage.tsx#L199) |
| `PlatformHomePage.89c92c4e` | 写死 | 去汇率页处理 | 链接 | [PlatformHomePage.tsx:201](../../apps/web/src/pages/PlatformHomePage.tsx#L201) |
| `PlatformHomePage.20659fc9` | 写死 | 这里暂时没有你可以使用的模块 | 标题 | [PlatformHomePage.tsx:204](../../apps/web/src/pages/PlatformHomePage.tsx#L204) |
| `PlatformHomePage.c1b1237d` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [PlatformHomePage.tsx:204](../../apps/web/src/pages/PlatformHomePage.tsx#L204) |
| `PlatformHomePage.b453887f` | 写死 | 运营 | 标题 | [PlatformHomePage.tsx:209](../../apps/web/src/pages/PlatformHomePage.tsx#L209) |
| `PlatformHomePage.0653cd54` | 写死 | 正常 | 名称 | [PlatformHomePage.tsx:211](../../apps/web/src/pages/PlatformHomePage.tsx#L211) |
| `PlatformHomePage.1b583e0c` | 写死 | 供应商 | 标题 | [PlatformHomePage.tsx:211](../../apps/web/src/pages/PlatformHomePage.tsx#L211) |
| `PlatformHomePage.94e0ba6d` | 写死 | 已暂停 | 名称 | [PlatformHomePage.tsx:211](../../apps/web/src/pages/PlatformHomePage.tsx#L211) |
| `PlatformHomePage.156f345f` | 写死 | 已上架 | 名称 | [PlatformHomePage.tsx:212](../../apps/web/src/pages/PlatformHomePage.tsx#L212) |
| `PlatformHomePage.aa1bc7d4` | 写死 | 商品 | 标题 | [PlatformHomePage.tsx:212](../../apps/web/src/pages/PlatformHomePage.tsx#L212) |
| `PlatformHomePage.931fdda1` | 写死 | 渠道 | 标题 | [PlatformHomePage.tsx:213](../../apps/web/src/pages/PlatformHomePage.tsx#L213) |
| `PlatformHomePage.cb5b29c7` | 写死 | 异常队列 | 标题 | [PlatformHomePage.tsx:215](../../apps/web/src/pages/PlatformHomePage.tsx#L215) |
| `PlatformHomePage.01cccd32` | 写死 | 工单 | 标题 | [PlatformHomePage.tsx:216](../../apps/web/src/pages/PlatformHomePage.tsx#L216) |
| `PlatformHomePage.6a909927` | 写死 | 赔付表 | 标题 | [PlatformHomePage.tsx:217](../../apps/web/src/pages/PlatformHomePage.tsx#L217) |
| `PlatformHomePage.17949d77` | 写死 | 财务结算 | 标题 | [PlatformHomePage.tsx:225](../../apps/web/src/pages/PlatformHomePage.tsx#L225) |
| `PlatformHomePage.b19ee921` | 写死 | 账单 | 标题 | [PlatformHomePage.tsx:227](../../apps/web/src/pages/PlatformHomePage.tsx#L227) |
| `PlatformHomePage.0eedaa68` | 写死 | 付款批次 | 标题 | [PlatformHomePage.tsx:228](../../apps/web/src/pages/PlatformHomePage.tsx#L228) |
| `PlatformHomePage.20325465` | 写死 | 主数据 | 标题 | [PlatformHomePage.tsx:236](../../apps/web/src/pages/PlatformHomePage.tsx#L236) |
| `PlatformHomePage.e1d85bd2` | 写死 | 城市 | 标题 | [PlatformHomePage.tsx:238](../../apps/web/src/pages/PlatformHomePage.tsx#L238) |
| `PlatformHomePage.1e644b93` | 写死 | 地点 | 标题 | [PlatformHomePage.tsx:239](../../apps/web/src/pages/PlatformHomePage.tsx#L239) |
| `PlatformHomePage.34f6c1f8` | 写死 | 车型组 | 标题 | [PlatformHomePage.tsx:240](../../apps/web/src/pages/PlatformHomePage.tsx#L240) |
| `PlatformHomePage.27fdc9b3` | 写死 | 附加服务 | 标题 | [PlatformHomePage.tsx:241](../../apps/web/src/pages/PlatformHomePage.tsx#L241) |
| `PlatformHomePage.7aedc92f` | 写死 | 汇率 | 标题 | [PlatformHomePage.tsx:242](../../apps/web/src/pages/PlatformHomePage.tsx#L242) |

## 供应商（列表、新建、详情）

文件：`apps/web/src/pages/platform/TenantPages.tsx`、`apps/web/src/pages/platform/useTenantActions.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `TenantPages.06726350` | 写死 | 你没有权限查看这里 | 标题 | [TenantPages.tsx:41](../../apps/web/src/pages/platform/TenantPages.tsx#L41) |
| `TenantPages.95603d5e` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [TenantPages.tsx:41](../../apps/web/src/pages/platform/TenantPages.tsx#L41) |
| `TenantPages.805c1357` | 写死 | 状态 | 名称 | [TenantPages.tsx:50](../../apps/web/src/pages/platform/TenantPages.tsx#L50)、128、545 行 |
| `TenantPages.4a610c78` | 写死 | 全部 | 名称 | [TenantPages.tsx:52](../../apps/web/src/pages/platform/TenantPages.tsx#L52) |
| `TenantPages.1c9db902` | 写死 | 供应商 · NOZOMI {name} | 浏览器标题 | [TenantPages.tsx:62](../../apps/web/src/pages/platform/TenantPages.tsx#L62)、448 行 |
| `TenantPages.0ff85ac9` | 写死 | 供应商 | 名称 | [TenantPages.tsx:88](../../apps/web/src/pages/platform/TenantPages.tsx#L88)、89、115、241、327、454、455 行 |
| `TenantPages.67b2c63d` | 写死 | 新建供应商 | 按钮 | [TenantPages.tsx:109](../../apps/web/src/pages/platform/TenantPages.tsx#L109)、241、242 行 |
| `TenantPages.c68a1b00` | 写死 | 观察期 | 名称 | [TenantPages.tsx:132](../../apps/web/src/pages/platform/TenantPages.tsx#L132) |
| `TenantPages.64558d76` | 写死 | 创建时间 | 文字 | [TenantPages.tsx:136](../../apps/web/src/pages/platform/TenantPages.tsx#L136)、556 行 |
| `TenantPages.17750871` | 写死 | 最近修改 | 文字 | [TenantPages.tsx:137](../../apps/web/src/pages/platform/TenantPages.tsx#L137)、560 行 |
| `TenantPages.9331b37c` | 写死 | 操作 | 文字 | [TenantPages.tsx:140](../../apps/web/src/pages/platform/TenantPages.tsx#L140) |
| `TenantPages.0bbed65c` | 写死 | 查看 {name} | 读屏说明 | [TenantPages.tsx:145](../../apps/web/src/pages/platform/TenantPages.tsx#L145) |
| `TenantPages.20a75ba0` | 写死 | 查看 | 按钮 | [TenantPages.tsx:147](../../apps/web/src/pages/platform/TenantPages.tsx#L147) |
| `TenantPages.eac0c01d` | 写死 | 更多 | 文字 | [TenantPages.tsx:149](../../apps/web/src/pages/platform/TenantPages.tsx#L149) |
| `TenantPages.faf624ed` | 写死 | {name} 的更多操作 | 名称 | [TenantPages.tsx:149](../../apps/web/src/pages/platform/TenantPages.tsx#L149) |
| `TenantPages.b2880a7c` | 写死 | 邀请管理员 | 正文 | [TenantPages.tsx:152](../../apps/web/src/pages/platform/TenantPages.tsx#L152)、580 行 |
| `TenantPages.7920cfa8` | 写死 | 申请暂停 | 正文 | [TenantPages.tsx:157](../../apps/web/src/pages/platform/TenantPages.tsx#L157)、496 行 |
| `TenantPages.aaee1b4a` | 写死 | 恢复 | 正文 | [TenantPages.tsx:162](../../apps/web/src/pages/platform/TenantPages.tsx#L162)、492 行 |
| `TenantPages.6f400573` | 写死 | 没有符合条件的供应商 | 标题 | [TenantPages.tsx:179](../../apps/web/src/pages/platform/TenantPages.tsx#L179) |
| `TenantPages.872d73a3` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [TenantPages.tsx:180](../../apps/web/src/pages/platform/TenantPages.tsx#L180) |
| `TenantPages.82f4e3b8` | 写死 | 清空筛选 | 按钮 | [TenantPages.tsx:184](../../apps/web/src/pages/platform/TenantPages.tsx#L184) |
| `TenantPages.982a5cc3` | 写死 | 供应商就是在平台上接单的车队。新建一家，同时给它的管理员开一个账号；对方用你发过去的链接设置密码后，就可以登录供应商后台配置区域、商品和价格。 | 说明 | [TenantPages.tsx:188](../../apps/web/src/pages/platform/TenantPages.tsx#L188) |
| `TenantPages.f31a91f7` | 写死 | 还没有供应商 | 标题 | [TenantPages.tsx:188](../../apps/web/src/pages/platform/TenantPages.tsx#L188) |
| `TenantPages.72cc0600` | 写死 | 你可以查看供应商，但不能修改。 | 提示 | [TenantPages.tsx:193](../../apps/web/src/pages/platform/TenantPages.tsx#L193)、501 行 |
| `TenantPages.9f3cdc74` | 写死 | 供应商太多，只载入了最早建的 2,000 家。请联系技术处理。 | 提示 | [TenantPages.tsx:194](../../apps/web/src/pages/platform/TenantPages.tsx#L194) |
| `TenantPages.fa7db5b6` | 写死 | 按名称搜索 | 名称 | [TenantPages.tsx:195](../../apps/web/src/pages/platform/TenantPages.tsx#L195) |
| `TenantPages.2c590268` | 写死 | 供应商列表 | 名称 | [TenantPages.tsx:199](../../apps/web/src/pages/platform/TenantPages.tsx#L199) |
| `TenantPages.bc4e8b39` | 写死 | 新建供应商 · NOZOMI {name} | 浏览器标题 | [TenantPages.tsx:220](../../apps/web/src/pages/platform/TenantPages.tsx#L220) |
| `TenantPages.2170e13d` | 写死 | 名称 | 文字 | [TenantPages.tsx:251](../../apps/web/src/pages/platform/TenantPages.tsx#L251)、264、330、536 行 |
| `TenantPages.48f39dfa` | 写死 | 这个邮箱已经是某家供应商的账号了，一个邮箱只能属于一家供应商。请换一个邮箱；如果他就是那家供应商的人，请到那家供应商的详情页处理。 | 文字 | [TenantPages.tsx:252](../../apps/web/src/pages/platform/TenantPages.tsx#L252) |
| `TenantPages.37bf13e0` | 写死 | 姓名 | 文字 | [TenantPages.tsx:253](../../apps/web/src/pages/platform/TenantPages.tsx#L253)、266、362 行 |
| `TenantPages.2fd40497` | 写死 | {name} 的管理员 | 文字 | [TenantPages.tsx:271](../../apps/web/src/pages/platform/TenantPages.tsx#L271) |
| `TenantPages.2cc78fd7` | 写死 | 不确定有没有建成。 | 标题 | [TenantPages.tsx:280](../../apps/web/src/pages/platform/TenantPages.tsx#L280) |
| `TenantPages.a4eebc8c` | 写死 | 请先回到供应商列表看一眼有没有「{…}」：有的话不要再建一次，到它的详情页点「邀请管理员」重新拿链接；没有再回来重试。 | 文字 | [TenantPages.tsx:280](../../apps/web/src/pages/platform/TenantPages.tsx#L280) |
| `TenantPages.b0f9bcab` | 写死 | 你没有权限新建供应商。需要的话，请联系管理员开通。 | 文字 | [TenantPages.tsx:281](../../apps/web/src/pages/platform/TenantPages.tsx#L281) |
| `TenantPages.aae1e4ad` | 写死 | 新建 | 文字 | [TenantPages.tsx:282](../../apps/web/src/pages/platform/TenantPages.tsx#L282)、381 行 |
| `TenantPages.1ffd7fd7` | 写死 | 去供应商列表看一眼 | 链接 | [TenantPages.tsx:318](../../apps/web/src/pages/platform/TenantPages.tsx#L318) |
| `TenantPages.34df5167` | 写死 | 车队或公司的名字。它的员工登录供应商后台时会看到这个名字。 | 文字 | [TenantPages.tsx:334](../../apps/web/src/pages/platform/TenantPages.tsx#L334) |
| `TenantPages.a24a8ee0` | 写死 | 已经有一家叫「{…}」的供应商了。确定要再建一家同名的吗？ | 正文 | [TenantPages.tsx:339](../../apps/web/src/pages/platform/TenantPages.tsx#L339) |
| `TenantPages.d67b6d75` | 写死 | 第一个管理员 | 标题 | [TenantPages.tsx:347](../../apps/web/src/pages/platform/TenantPages.tsx#L347) |
| `TenantPages.03f68c1b` | 写死 | 这家供应商的第一个账号，角色是管理员：他可以给自己的同事开账号。新建成功后你会得到一条邀请链接，由你发给他。 | 正文 | [TenantPages.tsx:348](../../apps/web/src/pages/platform/TenantPages.tsx#L348) |
| `TenantPages.85588304` | 写死 | 邮箱 | 文字 | [TenantPages.tsx:351](../../apps/web/src/pages/platform/TenantPages.tsx#L351) |
| `TenantPages.98dac8ff` | 写死 | 对方用这个邮箱登录。请填他本人在用的邮箱。 | 文字 | [TenantPages.tsx:359](../../apps/web/src/pages/platform/TenantPages.tsx#L359) |
| `TenantPages.c1fa0366` | 写死 | 系统不会给对方发邮件。 | 正文 | [TenantPages.tsx:364](../../apps/web/src/pages/platform/TenantPages.tsx#L364) |
| `TenantPages.843c80e7` | 写死 | 点「新建」后，这里会显示一条邀请链接，只显示一次，请当场复制并发给对方。 | 正文 | [TenantPages.tsx:365](../../apps/web/src/pages/platform/TenantPages.tsx#L365) |
| `TenantPages.17705b2d` | 写死 | 取消 | 按钮 | [TenantPages.tsx:378](../../apps/web/src/pages/platform/TenantPages.tsx#L378) |
| `TenantPages.00bd896f` | 写死 | 新建中… | 文字 | [TenantPages.tsx:379](../../apps/web/src/pages/platform/TenantPages.tsx#L379) |
| `TenantPages.85e57dfd` | 写死 | 已新建供应商「{name}」 | 提示 | [TenantPages.tsx:390](../../apps/web/src/pages/platform/TenantPages.tsx#L390) |
| `TenantPages.1208201e` | 写死 | 填的内容还没有提交 | 标题 | [TenantPages.tsx:397](../../apps/web/src/pages/platform/TenantPages.tsx#L397) |
| `TenantPages.77abb8b2` | 写死 | 继续填写 | 按钮 | [TenantPages.tsx:403](../../apps/web/src/pages/platform/TenantPages.tsx#L403) |
| `TenantPages.584b2e0a` | 写死 | 不保存，离开 | 按钮 | [TenantPages.tsx:417](../../apps/web/src/pages/platform/TenantPages.tsx#L417) |
| `TenantPages.a05e1e01` | 写死 | 离开后，这里填的内容不会保留。 | 正文 | [TenantPages.tsx:421](../../apps/web/src/pages/platform/TenantPages.tsx#L421) |
| `TenantPages.3b48eb2e` | 写死 | {name} · 供应商 · NOZOMI {name} | 浏览器标题 | [TenantPages.tsx:448](../../apps/web/src/pages/platform/TenantPages.tsx#L448) |
| `TenantPages.1ebfa750` | 写死 | 回到供应商列表 | 按钮 | [TenantPages.tsx:465](../../apps/web/src/pages/platform/TenantPages.tsx#L465) |
| `TenantPages.1f8b848e` | 写死 | 链接可能有误。 | 说明 | [TenantPages.tsx:465](../../apps/web/src/pages/platform/TenantPages.tsx#L465) |
| `TenantPages.eeb8802d` | 写死 | 找不到这家供应商 | 标题 | [TenantPages.tsx:465](../../apps/web/src/pages/platform/TenantPages.tsx#L465) |
| `TenantPages.c9c7b49d` | 写死 | 加载失败 | 标题 | [TenantPages.tsx:474](../../apps/web/src/pages/platform/TenantPages.tsx#L474) |
| `TenantPages.faa78291` | 写死 | 请检查网络后重试。 | 说明 | [TenantPages.tsx:475](../../apps/web/src/pages/platform/TenantPages.tsx#L475) |
| `TenantPages.73affbc8` | 写死 | 重试 | 按钮 | [TenantPages.tsx:479](../../apps/web/src/pages/platform/TenantPages.tsx#L479)、523 行 |
| `TenantPages.75f40e5c` | 写死 | 这家供应商已暂停。 | 正文 | [TenantPages.tsx:506](../../apps/web/src/pages/platform/TenantPages.tsx#L506) |
| `TenantPages.f27d4216` | 写死 | 暂停期间：它的商品不参与比价、不接新订单；已经接下的订单要照常履约；它的账号仍然可以登录供应商后台。 | 正文 | [TenantPages.tsx:507](../../apps/web/src/pages/platform/TenantPages.tsx#L507) |
| `TenantPages.81f21e3f` | 写死 | （换上新证件、审核通过后自动恢复） | 正文 | [TenantPages.tsx:508](../../apps/web/src/pages/platform/TenantPages.tsx#L508) |
| `TenantPages.9245ecb4` | 写死 | 暂停的原因：{…}{…}。 | 正文 | [TenantPages.tsx:508](../../apps/web/src/pages/platform/TenantPages.tsx#L508) |
| `TenantPages.91815da7` | 写死 | 暂停原因记在审计日志里，需要的话请问超级管理员。 | 正文 | [TenantPages.tsx:511](../../apps/web/src/pages/platform/TenantPages.tsx#L511) |
| `TenantPages.7638b0f5` | 写死 | 原因加载中… | 正文 | [TenantPages.tsx:513](../../apps/web/src/pages/platform/TenantPages.tsx#L513) |
| `TenantPages.38306a50` | 写死 | 原因：{…}（{…}，{…}） | 正文 | [TenantPages.tsx:515](../../apps/web/src/pages/platform/TenantPages.tsx#L515) |
| `TenantPages.4d22ac9a` | 写死 | 没有填原因 | 正文 | [TenantPages.tsx:515](../../apps/web/src/pages/platform/TenantPages.tsx#L515) |
| `TenantPages.a4191039` | 写死 | 原因：没有找到暂停的记录。 | 正文 | [TenantPages.tsx:517](../../apps/web/src/pages/platform/TenantPages.tsx#L517) |
| `TenantPages.30c3248b` | 写死 | 原因没有加载出来。 | 正文 | [TenantPages.tsx:521](../../apps/web/src/pages/platform/TenantPages.tsx#L521) |
| `TenantPages.15f35a3d` | 写死 | 基本信息 | 标题 | [TenantPages.tsx:533](../../apps/web/src/pages/platform/TenantPages.tsx#L533) |
| `TenantPages.79642ec1` | 写死 | 供应商编号 | 正文 | [TenantPages.tsx:549](../../apps/web/src/pages/platform/TenantPages.tsx#L549) |
| `TenantPages.070f6f24` | 写死 | 复制供应商编号 | 名称 | [TenantPages.tsx:552](../../apps/web/src/pages/platform/TenantPages.tsx#L552) |
| `TenantPages.c9832a6f` | 写死 | 在观察期。 | 正文 | [TenantPages.tsx:568](../../apps/web/src/pages/platform/TenantPages.tsx#L568) |
| `TenantPages.da9eaf0c` | 写死 | 原因：{…}。比价时排序价按对外价 ×1.05 计算；原因消除后自动退出。 | 正文 | [TenantPages.tsx:569](../../apps/web/src/pages/platform/TenantPages.tsx#L569) |
| `TenantPages.dbfb521f` | 写死 | 管理员账号 | 标题 | [TenantPages.tsx:577](../../apps/web/src/pages/platform/TenantPages.tsx#L577) |
| `TenantPages.8255a5ab` | 写死 | 发密码重置链接 | 按钮 | [TenantPages.tsx:581](../../apps/web/src/pages/platform/TenantPages.tsx#L581) |
| `TenantPages.56ed11a3` | 写死 | 这里可以给这家供应商再开一个管理员账号，或者在管理员忘了密码、他们自己又没有别的管理员能帮忙时，给他发一条密码重置链接。 | 正文 | [TenantPages.tsx:585](../../apps/web/src/pages/platform/TenantPages.tsx#L585) |
| `TenantPages.5349b500` | 写死 | 供应商自己的其他账号（调度、财务等）由他们的管理员在供应商后台里管理。 | 正文 | [TenantPages.tsx:586](../../apps/web/src/pages/platform/TenantPages.tsx#L586) |
| `TenantPages.a5547826` | 写死 | 之前的邀请链接没有交到对方手里、或已经过期：点「邀请管理员」，填同一个邮箱，会发出一条新的链接，旧的作废。 | 正文 | [TenantPages.tsx:587](../../apps/web/src/pages/platform/TenantPages.tsx#L587) |
| `TenantPages.8aed643a` | 写死 | 商品 | 标题 | [TenantPages.tsx:594](../../apps/web/src/pages/platform/TenantPages.tsx#L594) |
| `TenantPages.4af112b2` | 写死 | 在商品列表里看 | 链接 | [TenantPages.tsx:597](../../apps/web/src/pages/platform/TenantPages.tsx#L597) |
| `TenantPages.795c5fdb` | 写死 | 看这家供应商的操作记录 | 链接 | [TenantPages.tsx:607](../../apps/web/src/pages/platform/TenantPages.tsx#L607) |
| `useTenantActions.d4ed3eab` | 写死 | 你没有权限做这个操作。需要的话，请联系管理员开通。 | 文字 | [useTenantActions.tsx:27](../../apps/web/src/pages/platform/useTenantActions.tsx#L27) |
| `useTenantActions.548856b9` | 写死 | 不确定有没有成功。 | 标题 | [useTenantActions.tsx:62](../../apps/web/src/pages/platform/useTenantActions.tsx#L62) |
| `useTenantActions.df930ab6` | 写死 | 姓名 | 文字 | [useTenantActions.tsx:76](../../apps/web/src/pages/platform/useTenantActions.tsx#L76)、276、280、281 行 |
| `useTenantActions.c4e38e3e` | 写死 | 已提交暂停「{name}」的申请，等另一位同事审核后生效 | 提示 | [useTenantActions.tsx:82](../../apps/web/src/pages/platform/useTenantActions.tsx#L82) |
| `useTenantActions.102149fd` | 写死 | 已恢复「{name}」 | 提示 | [useTenantActions.tsx:87](../../apps/web/src/pages/platform/useTenantActions.tsx#L87) |
| `useTenantActions.7ca4a09e` | 写死 | {name} 的管理员 | 文字 | [useTenantActions.tsx:91](../../apps/web/src/pages/platform/useTenantActions.tsx#L91)、94 行 |
| `useTenantActions.059d4c2b` | 写死 | 这个邮箱已经有账号了（在这家或别的供应商，并且已经设过密码）。如果他是这家供应商的管理员、只是忘了密码，请用「发密码重置链接」。 | 错误提示 | [useTenantActions.tsx:98](../../apps/web/src/pages/platform/useTenantActions.tsx#L98) |
| `useTenantActions.7b7264b4` | 写死 | 这个账号现在不是在用的状态。还没设过密码的，请用「邀请管理员」重新发邀请；已经被停用的，要先由他们的管理员启用。 | 错误提示 | [useTenantActions.tsx:104](../../apps/web/src/pages/platform/useTenantActions.tsx#L104) |
| `useTenantActions.66c11455` | 写死 | 这家供应商没有用这个邮箱的管理员。请核对邮箱；如果他不是管理员，请让他们的管理员处理。 | 错误提示 | [useTenantActions.tsx:107](../../apps/web/src/pages/platform/useTenantActions.tsx#L107) |
| `useTenantActions.551754be` | 写死 | 这家供应商有必交资质已到期，不能人工恢复：请供应商上传新的证件，审核通过后会自动恢复。 | 文字 | [useTenantActions.tsx:110](../../apps/web/src/pages/platform/useTenantActions.tsx#L110) |
| `useTenantActions.56705c06` | 写死 | 这家供应商现在没有暂停，不用恢复。请刷新页面看最新的状态。 | 文字 | [useTenantActions.tsx:113](../../apps/web/src/pages/platform/useTenantActions.tsx#L113) |
| `useTenantActions.cca163cd` | 写死 | 这家供应商现在的状态不能暂停（可能已经被人工暂停，或还没开始试运营）。请刷新页面看最新的状态。 | 文字 | [useTenantActions.tsx:113](../../apps/web/src/pages/platform/useTenantActions.tsx#L113) |
| `useTenantActions.9bf36efe` | 写死 | 找不到这家供应商，它可能已被删除。 | 文字 | [useTenantActions.tsx:116](../../apps/web/src/pages/platform/useTenantActions.tsx#L116) |
| `useTenantActions.ac163528` | 写死 | 找不到这家供应商。 | 文字 | [useTenantActions.tsx:116](../../apps/web/src/pages/platform/useTenantActions.tsx#L116) |
| `useTenantActions.6bdabb93` | 写死 | 暂停 | 错误提示 | [useTenantActions.tsx:117](../../apps/web/src/pages/platform/useTenantActions.tsx#L117) |
| `useTenantActions.a53d26e5` | 写死 | 邀请 | 错误提示 | [useTenantActions.tsx:117](../../apps/web/src/pages/platform/useTenantActions.tsx#L117)、255 行 |
| `useTenantActions.acd2b26e` | 写死 | 发出 | 错误提示 | [useTenantActions.tsx:117](../../apps/web/src/pages/platform/useTenantActions.tsx#L117)、255 行 |
| `useTenantActions.b3d382d0` | 写死 | 恢复 | 错误提示 | [useTenantActions.tsx:117](../../apps/web/src/pages/platform/useTenantActions.tsx#L117)、230 行 |
| `useTenantActions.a2c0d867` | 写死 | 已邀请「{name}」 | 提示 | [useTenantActions.tsx:129](../../apps/web/src/pages/platform/useTenantActions.tsx#L129) |
| `useTenantActions.aa15c6a6` | 写死 | 已给「{name}」发出密码重置链接 | 提示 | [useTenantActions.tsx:129](../../apps/web/src/pages/platform/useTenantActions.tsx#L129) |
| `useTenantActions.07eb19c2` | 写死 | 取消 | 按钮 | [useTenantActions.tsx:139](../../apps/web/src/pages/platform/useTenantActions.tsx#L139) |
| `useTenantActions.ce460214` | 写死 | 知道了 | 按钮 | [useTenantActions.tsx:139](../../apps/web/src/pages/platform/useTenantActions.tsx#L139) |
| `useTenantActions.ba42c190` | 写死 | 申请暂停「{name}」 | 标题 | [useTenantActions.tsx:169](../../apps/web/src/pages/platform/useTenantActions.tsx#L169) |
| `useTenantActions.1948f2b8` | 写死 | 提交中… | 文字 | [useTenantActions.tsx:177](../../apps/web/src/pages/platform/useTenantActions.tsx#L177) |
| `useTenantActions.f21a6aa5` | 写死 | 提交申请 | 按钮 | [useTenantActions.tsx:179](../../apps/web/src/pages/platform/useTenantActions.tsx#L179) |
| `useTenantActions.0530a320` | 写死 | 暂停要另一位同事审核：提交以后在「待审核」里批准了才生效。 | 提示 | [useTenantActions.tsx:186](../../apps/web/src/pages/platform/useTenantActions.tsx#L186) |
| `useTenantActions.97616c3e` | 写死 | 暂停以后—— | 正文 | [useTenantActions.tsx:187](../../apps/web/src/pages/platform/useTenantActions.tsx#L187) |
| `useTenantActions.1c20c827` | 写死 | 它的 | 正文 | [useTenantActions.tsx:190](../../apps/web/src/pages/platform/useTenantActions.tsx#L190) |
| `useTenantActions.4ade668e` | 写死 | 商品不参与比价，不会再接到新订单 | 正文 | [useTenantActions.tsx:190](../../apps/web/src/pages/platform/useTenantActions.tsx#L190) |
| `useTenantActions.1b65e6e1` | 写死 | ，仍然要照常派车、履约； | 正文 | [useTenantActions.tsx:193](../../apps/web/src/pages/platform/useTenantActions.tsx#L193) |
| `useTenantActions.6994fe2e` | 写死 | 已经接下的订单不受影响 | 正文 | [useTenantActions.tsx:193](../../apps/web/src/pages/platform/useTenantActions.tsx#L193) |
| `useTenantActions.0636bcf7` | 写死 | 它的账号 | 正文 | [useTenantActions.tsx:196](../../apps/web/src/pages/platform/useTenantActions.tsx#L196) |
| `useTenantActions.69b756b0` | 写死 | 供应商后台，页面上会看到「已暂停」； | 正文 | [useTenantActions.tsx:196](../../apps/web/src/pages/platform/useTenantActions.tsx#L196) |
| `useTenantActions.9de8d690` | 写死 | 仍然可以登录 | 正文 | [useTenantActions.tsx:196](../../apps/web/src/pages/platform/useTenantActions.tsx#L196) |
| `useTenantActions.215fb310` | 写死 | 可以随时恢复（恢复不用审核）。 | 正文 | [useTenantActions.tsx:198](../../apps/web/src/pages/platform/useTenantActions.tsx#L198) |
| `useTenantActions.4c3f6781` | 写死 | 暂停原因 | 表单标签 | [useTenantActions.tsx:203](../../apps/web/src/pages/platform/useTenantActions.tsx#L203) |
| `useTenantActions.0b4c2015` | 写死 | 写给审核的同事和以后的自己看的：为什么暂停、谁要求的。会记入状态记录和审计日志，供应商只看到「人工暂停」，看不到这段文字。 | 正文 | [useTenantActions.tsx:211](../../apps/web/src/pages/platform/useTenantActions.tsx#L211) |
| `useTenantActions.9b395c75` | 写死 | 恢复「{name}」？ | 标题 | [useTenantActions.tsx:221](../../apps/web/src/pages/platform/useTenantActions.tsx#L221) |
| `useTenantActions.3894cb58` | 写死 | 恢复中… | 文字 | [useTenantActions.tsx:228](../../apps/web/src/pages/platform/useTenantActions.tsx#L228) |
| `useTenantActions.eefaddf9` | 写死 | 恢复以后，它的商品重新参与比价、可以接新订单。 | 正文 | [useTenantActions.tsx:236](../../apps/web/src/pages/platform/useTenantActions.tsx#L236) |
| `useTenantActions.04bf9408` | 写死 | 当初暂停的原因：{reason}。请确认问题已经解决。 | 正文 | [useTenantActions.tsx:237](../../apps/web/src/pages/platform/useTenantActions.tsx#L237) |
| `useTenantActions.58614654` | 写死 | 邀请管理员 | 标题 | [useTenantActions.tsx:246](../../apps/web/src/pages/platform/useTenantActions.tsx#L246) |
| `useTenantActions.ac673fef` | 写死 | 给管理员发密码重置链接 | 标题 | [useTenantActions.tsx:246](../../apps/web/src/pages/platform/useTenantActions.tsx#L246) |
| `useTenantActions.38ed3ce9` | 写死 | 发出中… | 文字 | [useTenantActions.tsx:254](../../apps/web/src/pages/platform/useTenantActions.tsx#L254) |
| `useTenantActions.6d7b52a3` | 写死 | 邀请中… | 文字 | [useTenantActions.tsx:254](../../apps/web/src/pages/platform/useTenantActions.tsx#L254) |
| `useTenantActions.24db1722` | 写死 | 这家供应商已暂停，仍然可以邀请。 | 正文 | [useTenantActions.tsx:265](../../apps/web/src/pages/platform/useTenantActions.tsx#L265) |
| `useTenantActions.2dd199f6` | 写死 | 给「{name}」开一个管理员账号。{…} | 正文 | [useTenantActions.tsx:265](../../apps/web/src/pages/platform/useTenantActions.tsx#L265) |
| `useTenantActions.3c05a101` | 写死 | 只能发给「{name}」里 | 正文 | [useTenantActions.tsx:268](../../apps/web/src/pages/platform/useTenantActions.tsx#L268) |
| `useTenantActions.71e5d309` | 写死 | 。别的角色（调度、财务等）忘了密码，请让他们自己的管理员在供应商后台里处理。 | 正文 | [useTenantActions.tsx:268](../../apps/web/src/pages/platform/useTenantActions.tsx#L268) |
| `useTenantActions.fbd9d447` | 写死 | 在用的管理员 | 正文 | [useTenantActions.tsx:268](../../apps/web/src/pages/platform/useTenantActions.tsx#L268) |
| `useTenantActions.a01eddd0` | 写死 | 管理员的邮箱 | 文字 | [useTenantActions.tsx:271](../../apps/web/src/pages/platform/useTenantActions.tsx#L271) |
| `useTenantActions.c973ff9d` | 写死 | 邮箱 | 文字 | [useTenantActions.tsx:271](../../apps/web/src/pages/platform/useTenantActions.tsx#L271) |
| `useTenantActions.fe3e776c` | 写死 | 之前邀请过、但对方还没设密码的邮箱也可以填：会发出一条新的链接，旧的作废。 | 文字 | [useTenantActions.tsx:271](../../apps/web/src/pages/platform/useTenantActions.tsx#L271) |
| `useTenantActions.7893203d` | 写死 | 发出链接不会改掉他现在的密码。请先确认提出要求的人就是他本人——例如打他留在合同上的电话。 | 正文 | [useTenantActions.tsx:284](../../apps/web/src/pages/platform/useTenantActions.tsx#L284) |
| `useTenantActions.c8b07ed9` | 写死 | 系统不会发邮件。点「邀请」后会显示一条邀请链接，只显示一次。 | 提示 | [useTenantActions.tsx:285](../../apps/web/src/pages/platform/useTenantActions.tsx#L285) |

## 资质审核

文件：`apps/web/src/pages/platform/DocumentQueuePage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `DocumentQueuePage.8cac8b2b` | 写死 | 资质审核 · NOZOMI {name} | 浏览器标题 | [DocumentQueuePage.tsx:25](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L25) |
| `DocumentQueuePage.298537cc` | 写死 | 资质审核 | 名称 | [DocumentQueuePage.tsx:31](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L31)、32 行 |
| `DocumentQueuePage.0273441f` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [DocumentQueuePage.tsx:35](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L35) |
| `DocumentQueuePage.6dbd0c83` | 写死 | 你没有权限查看这里 | 标题 | [DocumentQueuePage.tsx:35](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L35) |
| `DocumentQueuePage.9939c614` | 写死 | 供应商 | 文字 | [DocumentQueuePage.tsx:39](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L39) |
| `DocumentQueuePage.060b0cba` | 写死 | 供应商状态 | 文字 | [DocumentQueuePage.tsx:47](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L47) |
| `DocumentQueuePage.aee8a2dd` | 写死 | 证件 | 文字 | [DocumentQueuePage.tsx:48](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L48) |
| `DocumentQueuePage.fa80c530` | 写死 | 提交时间 | 文字 | [DocumentQueuePage.tsx:50](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L50) |
| `DocumentQueuePage.770bdd50` | 写死 | 到期日 | 文字 | [DocumentQueuePage.tsx:51](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L51) |
| `DocumentQueuePage.28025f11` | 写死 | 资质状态 | 文字 | [DocumentQueuePage.tsx:52](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L52) |
| `DocumentQueuePage.bcc814a0` | 写死 | 操作 | 文字 | [DocumentQueuePage.tsx:55](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L55) |
| `DocumentQueuePage.a17cba7f` | 写死 | {…} {name} 的 {type\_name} | 读屏说明 | [DocumentQueuePage.tsx:57](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L57) |
| `DocumentQueuePage.c8ea8b9e` | 写死 | 去查看 | 读屏说明 | [DocumentQueuePage.tsx:57](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L57)、58 行 |
| `DocumentQueuePage.d95d07a0` | 写死 | 去审核 | 读屏说明 | [DocumentQueuePage.tsx:57](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L57)、58 行 |
| `DocumentQueuePage.8906541f` | 写死 | 供应商交的资质在这里排队。审核在供应商详情页的「资质」里做：下载核对、通过（可改正到期日）、驳回或要求补充（都要写原因，供应商看得到）。 | 正文 | [DocumentQueuePage.tsx:67](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L67) |
| `DocumentQueuePage.41676f9a` | 写死 | 看哪些 | 名称 | [DocumentQueuePage.tsx:71](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L71) |
| `DocumentQueuePage.43eabf75` | 写死 | 待审核 | 名称 | [DocumentQueuePage.tsx:74](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L74) |
| `DocumentQueuePage.098bc6ae` | 写死 | 30 天内到期 | 名称 | [DocumentQueuePage.tsx:75](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L75) |
| `DocumentQueuePage.7a75fe15` | 写死 | 待审核的资质 | 名称 | [DocumentQueuePage.tsx:82](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L82) |
| `DocumentQueuePage.8a0cf707` | 写死 | 30 天内到期的资质 | 名称 | [DocumentQueuePage.tsx:82](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L82) |
| `DocumentQueuePage.36f6b05b` | 写死 | 供应商提交了新的资质会出现在这里。 | 说明 | [DocumentQueuePage.tsx:88](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L88) |
| `DocumentQueuePage.9f2a152a` | 写死 | 没有待审核的资质 | 标题 | [DocumentQueuePage.tsx:88](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L88) |
| `DocumentQueuePage.a5edf03c` | 写死 | 到期前 30 天、7 天会提醒供应商换证。 | 说明 | [DocumentQueuePage.tsx:88](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L88) |
| `DocumentQueuePage.d08631b2` | 写死 | 30 天内没有到期的资质 | 标题 | [DocumentQueuePage.tsx:88](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L88) |
| `DocumentQueuePage.340036b8` | 写死 | 共 {total} 份{…} | 正文 | [DocumentQueuePage.tsx:91](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L91) |
| `DocumentQueuePage.51410aac` | 写死 | （只显示最早的 50 份） | 正文 | [DocumentQueuePage.tsx:91](../../apps/web/src/pages/platform/DocumentQueuePage.tsx#L91) |

## 商品（只读查看）

文件：`apps/web/src/pages/platform/ProductPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ProductPages.8a918cc6` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [ProductPages.tsx:41](../../apps/web/src/pages/platform/ProductPages.tsx#L41) |
| `ProductPages.ddadff35` | 写死 | 你没有权限查看这里 | 标题 | [ProductPages.tsx:41](../../apps/web/src/pages/platform/ProductPages.tsx#L41) |
| `ProductPages.221f45a1` | 写死 | 有 {active\_price\_rule\_count} 条 | 正文 | [ProductPages.tsx:51](../../apps/web/src/pages/platform/ProductPages.tsx#L51) |
| `ProductPages.788c23be` | 写死 | 没有价格 | 正文 | [ProductPages.tsx:60](../../apps/web/src/pages/platform/ProductPages.tsx#L60) |
| `ProductPages.5eb57d74` | 写死 | 已上架，客人询价时报不出价 | 正文 | [ProductPages.tsx:61](../../apps/web/src/pages/platform/ProductPages.tsx#L61) |
| `ProductPages.bba34967` | 写死 | （已暂停） | 名称 | [ProductPages.tsx:87](../../apps/web/src/pages/platform/ProductPages.tsx#L87) |
| `ProductPages.4af57066` | 写死 | 全部 | 名称 | [ProductPages.tsx:91](../../apps/web/src/pages/platform/ProductPages.tsx#L91)、93、98、105、113 行 |
| `ProductPages.c660e937` | 写死 | 供应商 | 名称 | [ProductPages.tsx:91](../../apps/web/src/pages/platform/ProductPages.tsx#L91)、195 行 |
| `ProductPages.0591feca` | 写死 | 城市 | 名称 | [ProductPages.tsx:93](../../apps/web/src/pages/platform/ProductPages.tsx#L93)、230、475 行 |
| `ProductPages.9911217c` | 写死 | 品类 | 名称 | [ProductPages.tsx:96](../../apps/web/src/pages/platform/ProductPages.tsx#L96)、241 行 |
| `ProductPages.257327a9` | 写死 | 状态 | 名称 | [ProductPages.tsx:103](../../apps/web/src/pages/platform/ProductPages.tsx#L103)、242 行 |
| `ProductPages.27631a7f` | 写死 | 可用价格 | 名称 | [ProductPages.tsx:110](../../apps/web/src/pages/platform/ProductPages.tsx#L110)、243 行 |
| `ProductPages.4f6b28b4` | 写死 | 有 | 名称 | [ProductPages.tsx:114](../../apps/web/src/pages/platform/ProductPages.tsx#L114) |
| `ProductPages.55082820` | 写死 | 没有 | 名称 | [ProductPages.tsx:115](../../apps/web/src/pages/platform/ProductPages.tsx#L115) |
| `ProductPages.03ddba3a` | 写死 | 指定的子品牌 | 文字 | [ProductPages.tsx:187](../../apps/web/src/pages/platform/ProductPages.tsx#L187) |
| `ProductPages.7411a9b3` | 写死 | 子品牌 | 文字 | [ProductPages.tsx:198](../../apps/web/src/pages/platform/ProductPages.tsx#L198)、477 行 |
| `ProductPages.f839917d` | 写死 | 只看子品牌「{name}」的商品 | 标题 | [ProductPages.tsx:201](../../apps/web/src/pages/platform/ProductPages.tsx#L201) |
| `ProductPages.af9f9364` | 写死 | 上架时间 | 文字 | [ProductPages.tsx:208](../../apps/web/src/pages/platform/ProductPages.tsx#L208) |
| `ProductPages.74fd84c6` | 写死 | 商品 | 文字 | [ProductPages.tsx:212](../../apps/web/src/pages/platform/ProductPages.tsx#L212)、318、319、410、412 行 |
| `ProductPages.1cf7271c` | 写死 | 城市已停用 | 名称 | [ProductPages.tsx:235](../../apps/web/src/pages/platform/ProductPages.tsx#L235) |
| `ProductPages.19fb580a` | 写死 | 最近修改 | 文字 | [ProductPages.tsx:245](../../apps/web/src/pages/platform/ProductPages.tsx#L245) |
| `ProductPages.f76d9170` | 写死 | 没有符合条件的商品 | 标题 | [ProductPages.tsx:252](../../apps/web/src/pages/platform/ProductPages.tsx#L252) |
| `ProductPages.5d644770` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [ProductPages.tsx:253](../../apps/web/src/pages/platform/ProductPages.tsx#L253) |
| `ProductPages.31852600` | 写死 | 清空筛选 | 按钮 | [ProductPages.tsx:257](../../apps/web/src/pages/platform/ProductPages.tsx#L257) |
| `ProductPages.a0627b8d` | 写死 | 它的管理员在供应商后台建好商品后，会出现在这里。运营后台只能查看，不能替供应商建商品。 | 说明 | [ProductPages.tsx:261](../../apps/web/src/pages/platform/ProductPages.tsx#L261) |
| `ProductPages.fede6fe4` | 写死 | 这家供应商还没有商品 | 标题 | [ProductPages.tsx:261](../../apps/web/src/pages/platform/ProductPages.tsx#L261) |
| `ProductPages.674fd2f2` | 写死 | 供应商在供应商后台建好商品后，会出现在这里。运营后台只能查看，不能替供应商建商品。 | 说明 | [ProductPages.tsx:263](../../apps/web/src/pages/platform/ProductPages.tsx#L263) |
| `ProductPages.69c1a6fa` | 写死 | 还没有商品 | 标题 | [ProductPages.tsx:263](../../apps/web/src/pages/platform/ProductPages.tsx#L263) |
| `ProductPages.0c09a8f0` | 写死 | 指定的供应商 | 文字 | [ProductPages.tsx:265](../../apps/web/src/pages/platform/ProductPages.tsx#L265) |
| `ProductPages.1245e3aa` | 写死 | 按商品名或商品编号搜索 | 名称 | [ProductPages.tsx:269](../../apps/web/src/pages/platform/ProductPages.tsx#L269) |
| `ProductPages.ed187a8f` | 写死 | 供应商：{fixedTenantFilter} | 标题 | [ProductPages.tsx:275](../../apps/web/src/pages/platform/ProductPages.tsx#L275)、276 行 |
| `ProductPages.db9d1555` | 写死 | 去掉条件「供应商：{fixedTenantFilter}」 | 读屏说明 | [ProductPages.tsx:277](../../apps/web/src/pages/platform/ProductPages.tsx#L277) |
| `ProductPages.93ca4328` | 写死 | 子品牌：{brandChip} | 标题 | [ProductPages.tsx:283](../../apps/web/src/pages/platform/ProductPages.tsx#L283)、284 行 |
| `ProductPages.1d41b0d5` | 写死 | 去掉条件「子品牌：{brandChip}」 | 读屏说明 | [ProductPages.tsx:285](../../apps/web/src/pages/platform/ProductPages.tsx#L285) |
| `ProductPages.4dbcfed9` | 写死 | 商品列表 | 名称 | [ProductPages.tsx:292](../../apps/web/src/pages/platform/ProductPages.tsx#L292) |
| `ProductPages.99f6553e` | 写死 | {name} 的商品 | 名称 | [ProductPages.tsx:292](../../apps/web/src/pages/platform/ProductPages.tsx#L292) |
| `ProductPages.069d3432` | 写死 | 商品 · NOZOMI {name} | 浏览器标题 | [ProductPages.tsx:315](../../apps/web/src/pages/platform/ProductPages.tsx#L315)、400 行 |
| `ProductPages.0570f267` | 写死 | 所有供应商的商品，运营后台只能查看。「可用价格」是启用、没过期、区域和车型组都还选着的价格：已上架的商品没有可用价格时，客人询价报不出价。 | 正文 | [ProductPages.tsx:326](../../apps/web/src/pages/platform/ProductPages.tsx#L326) |
| `ProductPages.2889b5cb` | 写死 | ④ 库存 | 标题 | [ProductPages.tsx:350](../../apps/web/src/pages/platform/ProductPages.tsx#L350) |
| `ProductPages.09c6cc25` | 写死 | 库存模式 | 正文 | [ProductPages.tsx:354](../../apps/web/src/pages/platform/ProductPages.tsx#L354) |
| `ProductPages.230acbe5` | 写死 | 限量 | 正文 | [ProductPages.tsx:355](../../apps/web/src/pages/platform/ProductPages.tsx#L355) |
| `ProductPages.925dcc90` | 写死 | 不限量 | 正文 | [ProductPages.tsx:355](../../apps/web/src/pages/platform/ProductPages.tsx#L355) |
| `ProductPages.26fa99f6` | 写死 | 从今天起有库存的日子 | 正文 | [ProductPages.tsx:359](../../apps/web/src/pages/platform/ProductPages.tsx#L359) |
| `ProductPages.cbcc76cb` | 写死 | {days} 天 | 正文 | [ProductPages.tsx:362](../../apps/web/src/pages/platform/ProductPages.tsx#L362) |
| `ProductPages.7453341a` | 写死 | 从今天起没有库存，卖不出去 | 正文 | [ProductPages.tsx:367](../../apps/web/src/pages/platform/ProductPages.tsx#L367) |
| `ProductPages.af31e864` | 写死 | 不限量：每天接多少单都可以。 | 正文 | [ProductPages.tsx:373](../../apps/web/src/pages/platform/ProductPages.tsx#L373) |
| `ProductPages.bcacba16` | 写死 | {…}每一天设了多少、卖了多少在供应商后台的「库存」里看，运营后台现在只看得到模式和还有几天有库存。 | 正文 | [ProductPages.tsx:373](../../apps/web/src/pages/platform/ProductPages.tsx#L373) |
| `ProductPages.db18d8fd` | 写死 | 限量：按供应商每天设的库存接单。 | 正文 | [ProductPages.tsx:373](../../apps/web/src/pages/platform/ProductPages.tsx#L373) |
| `ProductPages.bfd1638d` | 写死 | 回到列表 | 按钮 | [ProductPages.tsx:378](../../apps/web/src/pages/platform/ProductPages.tsx#L378) |
| `ProductPages.47917af8` | 写死 | 找不到这个商品 | 标题 | [ProductPages.tsx:424](../../apps/web/src/pages/platform/ProductPages.tsx#L424) |
| `ProductPages.b40c41d2` | 写死 | 它可能已被供应商删除，或链接有误。 | 说明 | [ProductPages.tsx:425](../../apps/web/src/pages/platform/ProductPages.tsx#L425) |
| `ProductPages.db1bb1fe` | 写死 | 回到商品列表 | 按钮 | [ProductPages.tsx:429](../../apps/web/src/pages/platform/ProductPages.tsx#L429) |
| `ProductPages.e98589d3` | 写死 | 加载失败 | 标题 | [ProductPages.tsx:440](../../apps/web/src/pages/platform/ProductPages.tsx#L440) |
| `ProductPages.7d721732` | 写死 | 请检查网络后重试。 | 说明 | [ProductPages.tsx:441](../../apps/web/src/pages/platform/ProductPages.tsx#L441) |
| `ProductPages.919039f4` | 写死 | 重试 | 按钮 | [ProductPages.tsx:445](../../apps/web/src/pages/platform/ProductPages.tsx#L445) |
| `ProductPages.07aeebdb` | 写死 | 接送点 | 文字 | [ProductPages.tsx:476](../../apps/web/src/pages/platform/ProductPages.tsx#L476) |
| `ProductPages.7a1c364d` | 写死 | 复制商品编号 | 名称 | [ProductPages.tsx:484](../../apps/web/src/pages/platform/ProductPages.tsx#L484) |
| `ProductPages.ed7b46bc` | 写死 | 供应商 {…} | 正文 | [ProductPages.tsx:489](../../apps/web/src/pages/platform/ProductPages.tsx#L489) |
| `ProductPages.2de752f9` | 写死 | 子品牌 {…} | 正文 | [ProductPages.tsx:497](../../apps/web/src/pages/platform/ProductPages.tsx#L497) |
| `ProductPages.1a9684d8` | 写死 | 版本 {version} | 正文 | [ProductPages.tsx:498](../../apps/web/src/pages/platform/ProductPages.tsx#L498) |
| `ProductPages.dbdd6550` | 写死 | 上架时间 {…} | 正文 | [ProductPages.tsx:499](../../apps/web/src/pages/platform/ProductPages.tsx#L499) |
| `ProductPages.6c955652` | 写死 | 最近修改 {…} | 正文 | [ProductPages.tsx:500](../../apps/web/src/pages/platform/ProductPages.tsx#L500) |
| `ProductPages.845eea1b` | 写死 | 这是供应商「{name}」的商品，运营后台只能查看，不能修改。要改的话，请联系供应商在供应商后台修改。 | 提示 | [ProductPages.tsx:506](../../apps/web/src/pages/platform/ProductPages.tsx#L506) |
| `ProductPages.ff63e03a` | 写死 | 这家供应商已暂停。 | 正文 | [ProductPages.tsx:509](../../apps/web/src/pages/platform/ProductPages.tsx#L509) |
| `ProductPages.9b427f98` | 写死 | 暂停期间它的商品不参与比价、不接新订单。 | 正文 | [ProductPages.tsx:510](../../apps/web/src/pages/platform/ProductPages.tsx#L510) |
| `ProductPages.1f9fe776` | 写死 | 这个商品的{kind}「{name}」已停用。 | 正文 | [ProductPages.tsx:515](../../apps/web/src/pages/platform/ProductPages.tsx#L515) |
| `ProductPages.e47a2f91` | 写死 | 商品不能上架、不会参与报价。 | 正文 | [ProductPages.tsx:516](../../apps/web/src/pages/platform/ProductPages.tsx#L516) |

## 报价试算

文件：`apps/web/src/lib/quote-form.ts`、`apps/web/src/pages/platform/QuotePreviewPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `quote-form.17ce228e` | 写死 | 请选择城市 | 文字 | [quote-form.ts:69](../../apps/web/src/lib/quote-form.ts#L69) |
| `quote-form.04f4fa1c` | 写死 | 请选择品类 | 文字 | [quote-form.ts:70](../../apps/web/src/lib/quote-form.ts#L70) |
| `quote-form.4ef7a4e3` | 写死 | 请选择机场或车站 | 文字 | [quote-form.ts:72](../../apps/web/src/lib/quote-form.ts#L72) |
| `quote-form.c77b18bb` | 写死 | 请选择方向 | 文字 | [quote-form.ts:73](../../apps/web/src/lib/quote-form.ts#L73) |
| `quote-form.f13a035b` | 写死 | 套餐时长要填 1 到 {maxPackageHours} 之间的整数（小时） | 文字 | [quote-form.ts:87](../../apps/web/src/lib/quote-form.ts#L87) |
| `quote-form.c651dffc` | 写死 | 请填用车日期 | 文字 | [quote-form.ts:90](../../apps/web/src/lib/quote-form.ts#L90) |
| `quote-form.d6e26c96` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [quote-form.ts:91](../../apps/web/src/lib/quote-form.ts#L91) |
| `quote-form.b18c3242` | 写死 | 请填用车时间 | 文字 | [quote-form.ts:93](../../apps/web/src/lib/quote-form.ts#L93) |
| `quote-form.0c0f7045` | 写死 | 请填时间，例如 08:00 | 文字 | [quote-form.ts:94](../../apps/web/src/lib/quote-form.ts#L94) |
| `quote-form.79e4b8c5` | 写死 | 人数要填 1 到 {maxPassengers} 之间的整数 | 文字 | [quote-form.ts:97](../../apps/web/src/lib/quote-form.ts#L97) |
| `quote-form.b16eb055` | 写死 | 行李数要填 0 到 {maxLuggage} 之间的整数，没有行李可以不填 | 文字 | [quote-form.ts:99](../../apps/web/src/lib/quote-form.ts#L99) |
| `quote-form.011f4961` | 写死 | 请选择客人支付的币种 | 文字 | [quote-form.ts:100](../../apps/web/src/lib/quote-form.ts#L100) |
| `quote-form.774bcaa7` | 写死 | 里程要填 0 到 5,000 之间的数（公里），最多 1 位小数 | 文字 | [quote-form.ts:107](../../apps/web/src/lib/quote-form.ts#L107) |
| `quote-form.fc61877c` | 写死 | 填了时长，也要填里程 | 文字 | [quote-form.ts:108](../../apps/web/src/lib/quote-form.ts#L108) |
| `quote-form.d6fa9834` | 写死 | 时长要填 0 到 10,080 之间的整数（分钟） | 文字 | [quote-form.ts:109](../../apps/web/src/lib/quote-form.ts#L109) |
| `quote-form.6211fc30` | 写死 | 填了里程，也要填时长 | 文字 | [quote-form.ts:110](../../apps/web/src/lib/quote-form.ts#L110) |
| `QuotePreviewPage.1eb90116` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [QuotePreviewPage.tsx:41](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L41) |
| `QuotePreviewPage.a892528d` | 写死 | 你没有权限查看这里 | 标题 | [QuotePreviewPage.tsx:41](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L41) |
| `QuotePreviewPage.b61635dc` | 写死 | 城市 | 文字 | [QuotePreviewPage.tsx:63](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L63)、526 行 |
| `QuotePreviewPage.18c4bd52` | 写死 | 品类 | 文字 | [QuotePreviewPage.tsx:64](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L64)、540 行 |
| `QuotePreviewPage.ca837c10` | 写死 | 机场或车站 | 文字 | [QuotePreviewPage.tsx:65](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L65)、553 行 |
| `QuotePreviewPage.9c22bafe` | 写死 | 方向 | 文字 | [QuotePreviewPage.tsx:66](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L66)、567 行 |
| `QuotePreviewPage.074e8917` | 写死 | 上车点 | 文字 | [QuotePreviewPage.tsx:67](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L67)、68、101、583 行 |
| `QuotePreviewPage.9faf408a` | 写死 | 下车点 | 文字 | [QuotePreviewPage.tsx:69](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L69)、70、101、588 行 |
| `QuotePreviewPage.2f2f8b3b` | 写死 | 套餐时长 | 文字 | [QuotePreviewPage.tsx:71](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L71) |
| `QuotePreviewPage.ed8dfa14` | 写死 | 用车时间 | 文字 | [QuotePreviewPage.tsx:72](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L72)、73、608 行 |
| `QuotePreviewPage.7f229528` | 写死 | 人数 | 文字 | [QuotePreviewPage.tsx:74](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L74)、616 行 |
| `QuotePreviewPage.7ca70165` | 写死 | 行李数 | 文字 | [QuotePreviewPage.tsx:75](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L75) |
| `QuotePreviewPage.964bfcfc` | 写死 | 客人支付的币种 | 文字 | [QuotePreviewPage.tsx:76](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L76)、624 行 |
| `QuotePreviewPage.ec986913` | 写死 | 假定的里程和时长 | 文字 | [QuotePreviewPage.tsx:77](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L77)、78 行 |
| `QuotePreviewPage.4f314560` | 写死 | {…} 小时 {…} 分钟 | 文字 | [QuotePreviewPage.tsx:89](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L89) |
| `QuotePreviewPage.8b7268eb` | 写死 | {minutes} 分钟 | 文字 | [QuotePreviewPage.tsx:89](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L89) |
| `QuotePreviewPage.b6c7a368` | 写死 | {…} 小时 | 文字 | [QuotePreviewPage.tsx:89](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L89) |
| `QuotePreviewPage.1a9e34d8` | 写死 | 基础价 | 名称 | [QuotePreviewPage.tsx:97](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L97) |
| `QuotePreviewPage.ff62cbde` | 写死 | 区域加价 | 名称 | [QuotePreviewPage.tsx:104](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L104) |
| `QuotePreviewPage.7e3d6ded` | 写死 | 套餐价 {…} + 上车加价 {…} + 下车加价 {…}（已含在基础价里） | 正文 | [QuotePreviewPage.tsx:107](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L107) |
| `QuotePreviewPage.572df340` | 写死 | {…}在商品的服务区域里，不加价 | 正文 | [QuotePreviewPage.tsx:108](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L108) |
| `QuotePreviewPage.9b13de44` | 写死 | 对外价参考：上车加价 {…}，下车加价 {…}（单独换算、取整，已含在对外价里） | 正文 | [QuotePreviewPage.tsx:109](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L109) |
| `QuotePreviewPage.2ab6b1b0` | 写死 | 用的是这条线路（上车区域 → 下车区域，单向）的线路价，不和区域价比低 | 文字 | [QuotePreviewPage.tsx:115](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L115) |
| `QuotePreviewPage.43296ec9` | 写死 | 线路价 | 名称 | [QuotePreviewPage.tsx:115](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L115) |
| `QuotePreviewPage.77f5d130` | 写死 | 含公里数 | 名称 | [QuotePreviewPage.tsx:121](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L121) |
| `QuotePreviewPage.40a3a848` | 写死 | 一口价 {…} + 超出 {over\_km} 公里 × {…} = {…}（已含在基础价里） | 正文 | [QuotePreviewPage.tsx:124](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L124) |
| `QuotePreviewPage.f5ebdaac` | 写死 | 含 {included\_km} 公里，这次路线约 {…} 公里；超出的部分不足 1 公里按 1 公里 | 正文 | [QuotePreviewPage.tsx:125](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L125) |
| `QuotePreviewPage.2106e345` | 写死 | 对外价参考：超出每公里 {…}（单独换算、取整，已含在对外价里） | 正文 | [QuotePreviewPage.tsx:126](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L126) |
| `QuotePreviewPage.f3f81b81` | 写死 | 计价方式 | 名称 | [QuotePreviewPage.tsx:136](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L136) |
| `QuotePreviewPage.3de1b706` | 写死 | 调价 | 名称 | [QuotePreviewPage.tsx:148](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L148) |
| `QuotePreviewPage.12c2e3d6` | 写死 | ，再 | 文字 | [QuotePreviewPage.tsx:152](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L152) |
| `QuotePreviewPage.145f9327` | 写死 | 合计 {…}{…}（含取整的尾差） | 正文 | [QuotePreviewPage.tsx:154](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L154) |
| `QuotePreviewPage.5bd131de` | 写死 | （离用车不足 {within\_hours} 小时） | 文字 | [QuotePreviewPage.tsx:159](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L159) |
| `QuotePreviewPage.cb8bf85d` | 写死 | 加急费 | 名称 | [QuotePreviewPage.tsx:159](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L159) |
| `QuotePreviewPage.8425cdca` | 写死 | 夜间费 | 名称 | [QuotePreviewPage.tsx:162](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L162) |
| `QuotePreviewPage.ab0775fa` | 写死 | （按次） | 文字 | [QuotePreviewPage.tsx:162](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L162) |
| `QuotePreviewPage.c00cd402` | 写死 | （按小时，和夜间时段重叠 {…} 分钟） | 文字 | [QuotePreviewPage.tsx:162](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L162) |
| `QuotePreviewPage.20e8d1b2` | 写死 | 附加服务 | 名称 | [QuotePreviewPage.tsx:164](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L164) |
| `QuotePreviewPage.40452131` | 写死 | {…}（{length} 项） | 文字 | [QuotePreviewPage.tsx:164](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L164) |
| `QuotePreviewPage.9eb27e57` | 写死 | 司机语言 | 名称 | [QuotePreviewPage.tsx:165](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L165) |
| `QuotePreviewPage.3849d131` | 写死 | 取整前 | 名称 | [QuotePreviewPage.tsx:166](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L166) |
| `QuotePreviewPage.7ec862e3` | 写死 | （还没取整） | 文字 | [QuotePreviewPage.tsx:166](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L166) |
| `QuotePreviewPage.024855f8` | 写死 | 取整到 {…} | 文字 | [QuotePreviewPage.tsx:167](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L167) |
| `QuotePreviewPage.d182161b` | 写死 | 取整 | 名称 | [QuotePreviewPage.tsx:167](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L167) |
| `QuotePreviewPage.e1419837` | 写死 | 四舍五入 | 文字 | [QuotePreviewPage.tsx:167](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L167) |
| `QuotePreviewPage.da3b80c6` | 写死 | 结算价 | 名称 | [QuotePreviewPage.tsx:168](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L168)、256 行 |
| `QuotePreviewPage.49c7e662` | 写死 | {…} 公里、{…} | 文字 | [QuotePreviewPage.tsx:169](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L169) |
| `QuotePreviewPage.54255f78` | 写死 | 按多少路程算 | 名称 | [QuotePreviewPage.tsx:169](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L169) |
| `QuotePreviewPage.45390066` | 写死 | ；用了人工锁定的汇率：{…} | 文字 | [QuotePreviewPage.tsx:171](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L171) |
| `QuotePreviewPage.ef52735d` | 写死 | 1 USD = {rate} {currency}（锁定到 {…}） | 文字 | [QuotePreviewPage.tsx:171](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L171) |
| `QuotePreviewPage.2aaea636` | 写死 | 换算成客人支付的币种 | 名称 | [QuotePreviewPage.tsx:172](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L172) |
| `QuotePreviewPage.caaa5444` | 写死 | 1 {from} = {rate} {to}（汇率时间 {…}{lockText}），汇率缓冲 {…}% | 文字 | [QuotePreviewPage.tsx:172](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L172) |
| `QuotePreviewPage.d1571ddb` | 写死 | 同币种（{own}），不用换算 | 文字 | [QuotePreviewPage.tsx:172](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L172) |
| `QuotePreviewPage.3fa4b635` | 写死 | {…}（结算价{…}加 {…}%{…}，取整前 {…}） | 文字 | [QuotePreviewPage.tsx:173](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L173) |
| `QuotePreviewPage.73d00b26` | 写死 | ，加价不足渠道的最低毛利、补到了最低毛利 | 文字 | [QuotePreviewPage.tsx:173](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L173) |
| `QuotePreviewPage.7de65c9e` | 写死 | 换算后 | 文字 | [QuotePreviewPage.tsx:173](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L173) |
| `QuotePreviewPage.d07f2ae1` | 写死 | 对外价 | 名称 | [QuotePreviewPage.tsx:173](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L173) |
| `QuotePreviewPage.4dbc7d25` | 写死 | 免费等待 | 名称 | [QuotePreviewPage.tsx:175](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L175) |
| `QuotePreviewPage.5993650d` | 写死 | 不限时 | 文字 | [QuotePreviewPage.tsx:175](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L175) |
| `QuotePreviewPage.a9ac47a9` | 写死 | 没有设 | 文字 | [QuotePreviewPage.tsx:175](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L175) |
| `QuotePreviewPage.ee4e86d0` | 写死 | {…} 分钟（平台规定最少 {platform\_minimum\_minutes} 分钟） | 文字 | [QuotePreviewPage.tsx:175](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L175) |
| `QuotePreviewPage.58e3c056` | 写死 | （供应商名称没有取到） | 文字 | [QuotePreviewPage.tsx:191](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L191)、241、370、395 行 |
| `QuotePreviewPage.1a2bdbf2` | 写死 | 中标 | 名称 | [QuotePreviewPage.tsx:198](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L198) |
| `QuotePreviewPage.939cd2b2` | 写死 | 观察期（排序价按对外价加 5%） | 正文 | [QuotePreviewPage.tsx:208](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L208) |
| `QuotePreviewPage.9a438734` | 写死 | （默认） | 正文 | [QuotePreviewPage.tsx:214](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L214) |
| `QuotePreviewPage.ea77ce75` | 写死 | 第 {markup\_level} 级{…} | 正文 | [QuotePreviewPage.tsx:214](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L214) |
| `QuotePreviewPage.0edb5b69` | 写死 | 在 | 正文 | [QuotePreviewPage.tsx:216](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L216) |
| `QuotePreviewPage.aa6ea932` | 写死 | 不在 | 正文 | [QuotePreviewPage.tsx:216](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L216) |
| `QuotePreviewPage.2eac3ea5` | 写死 | {…} {who} 的结算价明细 | 读屏说明 | [QuotePreviewPage.tsx:218](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L218) |
| `QuotePreviewPage.338216e0` | 写死 | 收起 | 读屏说明 | [QuotePreviewPage.tsx:218](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L218) |
| `QuotePreviewPage.60b9a038` | 写死 | 看 | 读屏说明 | [QuotePreviewPage.tsx:218](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L218) |
| `QuotePreviewPage.3bdc3420` | 写死 | 收起明细 | 按钮 | [QuotePreviewPage.tsx:219](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L219) |
| `QuotePreviewPage.67352133` | 写死 | 看明细 | 按钮 | [QuotePreviewPage.tsx:219](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L219) |
| `QuotePreviewPage.55469200` | 写死 |  · {package\_hours} 小时套餐 | 标题 | [QuotePreviewPage.tsx:231](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L231) |
| `QuotePreviewPage.20cbab36` | 写死 | 中标： | 正文 | [QuotePreviewPage.tsx:241](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L241) |
| `QuotePreviewPage.0814def9` | 写死 | · 结算价 {…} | 正文 | [QuotePreviewPage.tsx:242](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L242) |
| `QuotePreviewPage.3c56e060` | 写死 | {…} · 对外价 | 正文 | [QuotePreviewPage.tsx:242](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L242) |
| `QuotePreviewPage.67034f28` | 写死 | {title} 的全部候选 | 读屏说明 | [QuotePreviewPage.tsx:246](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L246) |
| `QuotePreviewPage.1c57cf03` | 写死 | 名次 | 表头 | [QuotePreviewPage.tsx:252](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L252) |
| `QuotePreviewPage.f6a7ed2f` | 写死 | 供应商 / 商品 | 表头 | [QuotePreviewPage.tsx:253](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L253)、385 行 |
| `QuotePreviewPage.578b819c` | 写死 | 对外价（{currency}） | 表头 | [QuotePreviewPage.tsx:257](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L257) |
| `QuotePreviewPage.bce68aa7` | 写死 | 加价比例 | 表头 | [QuotePreviewPage.tsx:260](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L260) |
| `QuotePreviewPage.c1950892` | 写死 | 命中的加价规则 | 表头 | [QuotePreviewPage.tsx:261](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L261) |
| `QuotePreviewPage.2bebaab0` | 写死 | 排序价 | 表头 | [QuotePreviewPage.tsx:264](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L264) |
| `QuotePreviewPage.2021754b` | 写死 | 在同价区间 | 表头 | [QuotePreviewPage.tsx:265](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L265) |
| `QuotePreviewPage.626f52e7` | 写死 | 明细 | 表头 | [QuotePreviewPage.tsx:266](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L266) |
| `QuotePreviewPage.cd779b4f` | 写死 | 排序价不超过最低排序价 {…}% 的都在同价区间里；区间里评分高的中标，评分一样看已完成订单数，再一样看排序价。客人付的是中标者自己的对外价。 | 正文 | [QuotePreviewPage.tsx:277](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L277) |
| `QuotePreviewPage.c0ec097f` | 写死 | 你填写的假定值 | 文字 | [QuotePreviewPage.tsx:286](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L286) |
| `QuotePreviewPage.2aa89cec` | 写死 |  用的路程：{…} 公里、{…}{…}。 | 文字 | [QuotePreviewPage.tsx:287](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L287) |
| `QuotePreviewPage.bae77d59` | 写死 | 谷歌地图没有给出路线。请稍后再试。 | 提示 | [QuotePreviewPage.tsx:292](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L292) |
| `QuotePreviewPage.fe8df9fc` | 写死 | 这次没有取到路线，按「里程 + 时长」计价的商品报不出价。 | 正文 | [QuotePreviewPage.tsx:295](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L295) |
| `QuotePreviewPage.690b3b6d` | 写死 | 原因码 | 正文 | [QuotePreviewPage.tsx:299](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L299) |
| `QuotePreviewPage.46fde755` | 写死 | {reason}没设含公里数的一口价和包车套餐不受影响。想看这些商品的价格，可以在上面「假定的里程和时长」里填一组数再试算。 | 正文 | [QuotePreviewPage.tsx:304](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L304) |
| `QuotePreviewPage.763523fc` | 写死 | 已停用的车型组 | 名称 | [QuotePreviewPage.tsx:318](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L318) |
| `QuotePreviewPage.97671771` | 写死 | 车型组（名称没有加载出来） | 名称 | [QuotePreviewPage.tsx:318](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L318) |
| `QuotePreviewPage.bf159fcd` | 写死 | 整个商品 | 名称 | [QuotePreviewPage.tsx:318](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L318) |
| `QuotePreviewPage.f8e79292` | 写死 | 试算结果 | 标题 | [QuotePreviewPage.tsx:325](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L325) |
| `QuotePreviewPage.7caffcdd` | 写死 | 没有可以比价的商品 | 标题 | [QuotePreviewPage.tsx:330](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L330) |
| `QuotePreviewPage.4d74cc90` | 写死 | 「{cityName}」的{…}{…}还没有已上架的商品。 | 说明 | [QuotePreviewPage.tsx:331](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L331) |
| `QuotePreviewPage.eb2664f5` | 写死 | （这个接送点） | 说明 | [QuotePreviewPage.tsx:331](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L331) |
| `QuotePreviewPage.59b4c919` | 写死 | 去商品列表看看 | 链接 | [QuotePreviewPage.tsx:335](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L335) |
| `QuotePreviewPage.454c8cc0` | 写死 | 找到 {candidate\_count} 个已上架的商品，{length} 个车型组报出了价。{…} | 正文 | [QuotePreviewPage.tsx:342](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L342) |
| `QuotePreviewPage.cb3de6f5` | 写死 | {refusedProducts} 个商品有没报出价的，原因见最下面。 | 正文 | [QuotePreviewPage.tsx:342](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L342) |
| `QuotePreviewPage.4baa423d` | 写死 |  加价比例不低于 {…}%。 | 正文 | [QuotePreviewPage.tsx:344](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L344) |
| `QuotePreviewPage.33032c1b` | 写死 | 按平台默认参数试算（没有选渠道）：默认加价比例、10% 下限、3% 价格带，没有最低毛利和对外价取整。 | 正文 | [QuotePreviewPage.tsx:348](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L348) |
| `QuotePreviewPage.38f08865` | 写死 | ，最低毛利 {…} | 正文 | [QuotePreviewPage.tsx:349](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L349) |
| `QuotePreviewPage.67c090ce` | 写死 | ，对外价向上取整到 {…} | 正文 | [QuotePreviewPage.tsx:349](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L349) |
| `QuotePreviewPage.fa9a09b8` | 写死 | 按渠道「{name}」的规则试算：加价比例按它的加价规则匹配，价格带 {…}%{…}{…}。 | 正文 | [QuotePreviewPage.tsx:349](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L349) |
| `QuotePreviewPage.df7a65d3` | 写死 |  渠道不卖的 {length} 个商品没参加比价（见最下面）。 | 正文 | [QuotePreviewPage.tsx:350](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L350) |
| `QuotePreviewPage.3536d473` | 写死 | 一个车型组都没有报出价。 | 正文 | [QuotePreviewPage.tsx:355](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L355) |
| `QuotePreviewPage.3058f6cf` | 写死 | 原因见下面「没报出价的」。 | 正文 | [QuotePreviewPage.tsx:356](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L356) |
| `QuotePreviewPage.26053839` | 写死 | 渠道不卖的（{length}） | 标题 | [QuotePreviewPage.tsx:366](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L366) |
| `QuotePreviewPage.b7c7326d` | 写死 | 没报出价的（{length}） | 标题 | [QuotePreviewPage.tsx:379](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L379) |
| `QuotePreviewPage.cfb0687b` | 写死 | 没报出价的商品和原因 | 读屏说明 | [QuotePreviewPage.tsx:381](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L381) |
| `QuotePreviewPage.87648fc0` | 写死 | 车型组 | 表头 | [QuotePreviewPage.tsx:386](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L386) |
| `QuotePreviewPage.2c695039` | 写死 | 原因 | 表头 | [QuotePreviewPage.tsx:387](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L387) |
| `QuotePreviewPage.3e2621b9` | 写死 | 报价试算 · NOZOMI {name} | 浏览器标题 | [QuotePreviewPage.tsx:417](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L417) |
| `QuotePreviewPage.a673daf5` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [QuotePreviewPage.tsx:474](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L474) |
| `QuotePreviewPage.32321b12` | 写死 | 这个城市已被平台停用，现在不报价。请换一个，或先到主数据里启用它。 | 文字 | [QuotePreviewPage.tsx:477](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L477) |
| `QuotePreviewPage.be84c2e2` | 写死 | 这个机场或车站已被平台停用，现在不报价。请换一个，或先到主数据里启用它。 | 文字 | [QuotePreviewPage.tsx:477](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L477) |
| `QuotePreviewPage.05d923a8` | 写死 | 选的渠道没有被授权卖这个品类。换一个渠道，或先在渠道的授权范围里加上这个品类。 | 文字 | [QuotePreviewPage.tsx:480](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L480) |
| `QuotePreviewPage.a989240f` | 写死 | 选的渠道没有被授权卖这个城市。换一个渠道，或先在渠道的授权范围里加上这个城市。 | 文字 | [QuotePreviewPage.tsx:480](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L480) |
| `QuotePreviewPage.2a6a25cf` | 写死 | 你没有权限做报价试算。需要的话，请联系管理员开通。 | 文字 | [QuotePreviewPage.tsx:481](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L481) |
| `QuotePreviewPage.159f4303` | 写死 | 试算 | 文字 | [QuotePreviewPage.tsx:482](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L482)、668 行 |
| `QuotePreviewPage.f6ebaa42` | 写死 | 试算没有成功。{…} | 文字 | [QuotePreviewPage.tsx:482](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L482) |
| `QuotePreviewPage.a3c63409` | 写死 | 报价试算 | 名称 | [QuotePreviewPage.tsx:489](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L489)、490 行 |
| `QuotePreviewPage.0f9f4e2e` | 写死 | 送站 | 文字 | [QuotePreviewPage.tsx:498](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L498) |
| `QuotePreviewPage.32012c7e` | 写死 | 送机 | 文字 | [QuotePreviewPage.tsx:498](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L498) |
| `QuotePreviewPage.4e98fd72` | 写死 | 接站 | 文字 | [QuotePreviewPage.tsx:498](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L498) |
| `QuotePreviewPage.c4edcfe3` | 写死 | 接机 | 文字 | [QuotePreviewPage.tsx:498](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L498) |
| `QuotePreviewPage.94336e34` | 写死 | 城市当地时间 | 文字 | [QuotePreviewPage.tsx:499](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L499) |
| `QuotePreviewPage.a3a937fa` | 写死 | {cityName}当地时间（{timezone}） | 文字 | [QuotePreviewPage.tsx:499](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L499) |
| `QuotePreviewPage.420aa36b` | 写死 | 填一次用车请求，看所有供应商一起比价的结果：每个车型组谁中标、各家的结算价和对外价、哪些商品报不出价以及原因。只是试算，不会生成可以下单的报价，也不占库存。 | 正文 | [QuotePreviewPage.tsx:503](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L503) |
| `QuotePreviewPage.3a308e00` | 写死 | 用车请求 | 标题 | [QuotePreviewPage.tsx:507](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L507) |
| `QuotePreviewPage.edefeb7a` | 写死 | 有 {length} 处需要修改 | 正文 | [QuotePreviewPage.tsx:512](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L512) |
| `QuotePreviewPage.13b88e1a` | 写死 | 输入城市名或编码 | 输入框占位 | [QuotePreviewPage.tsx:531](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L531) |
| `QuotePreviewPage.4dec4419` | 写死 | 输入名称或编码 | 输入框占位 | [QuotePreviewPage.tsx:558](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L558) |
| `QuotePreviewPage.cafc3c24` | 写死 | 先选城市 | 输入框占位 | [QuotePreviewPage.tsx:558](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L558)、562 行 |
| `QuotePreviewPage.4cc2ef68` | 写死 | 这个城市没有启用中的机场或车站 | 空状态 | [QuotePreviewPage.tsx:562](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L562) |
| `QuotePreviewPage.2815d428` | 写死 | 从机场或车站出发：要填下车点 | 说明 | [QuotePreviewPage.tsx:571](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L571) |
| `QuotePreviewPage.9c0b2a57` | 写死 | 去机场或车站：要填上车点 | 说明 | [QuotePreviewPage.tsx:572](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L572) |
| `QuotePreviewPage.bf4ad2b2` | 写死 | 可以把地图软件里复制的「纬度, 经度」直接粘贴进来。 | 说明 | [QuotePreviewPage.tsx:583](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L583)、588 行 |
| `QuotePreviewPage.b029e191` | 写死 | 下车点（选填） | 标题 | [QuotePreviewPage.tsx:594](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L594) |
| `QuotePreviewPage.8268f91f` | 写死 | 包车填了下车点才按区域加价算：下车点在商品的服务区域里不加价，在加价区域里加这个区域的下车加价。不填只报没设区域加价的包车商品。 | 说明 | [QuotePreviewPage.tsx:598](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L598) |
| `QuotePreviewPage.07a860b6` | 写死 | 套餐时长（小时） | 名称 | [QuotePreviewPage.tsx:604](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L604) |
| `QuotePreviewPage.f9933ea5` | 写死 | 例如 10，按供应商设的同样时长的套餐报价。 | 说明 | [QuotePreviewPage.tsx:604](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L604) |
| `QuotePreviewPage.21c7699a` | 写死 | 日期 | 名称 | [QuotePreviewPage.tsx:610](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L610) |
| `QuotePreviewPage.22df5ca6` | 写死 | 年-月-日 | 输入框占位 | [QuotePreviewPage.tsx:610](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L610) |
| `QuotePreviewPage.7408c20f` | 写死 | 时刻 | 名称 | [QuotePreviewPage.tsx:611](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L611) |
| `QuotePreviewPage.a1d28b64` | 写死 | 按{timeZoneText}填写；日期写成 2026-01-31 这样。 | 正文 | [QuotePreviewPage.tsx:613](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L613) |
| `QuotePreviewPage.1f017115` | 写死 | 行李数（选填） | 名称 | [QuotePreviewPage.tsx:619](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L619) |
| `QuotePreviewPage.3f9d1db3` | 写死 | 不填按 0 件。 | 说明 | [QuotePreviewPage.tsx:619](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L619) |
| `QuotePreviewPage.bced08bb` | 写死 | 请选择 | 选项 | [QuotePreviewPage.tsx:626](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L626) |
| `QuotePreviewPage.1c228c53` | 写死 | 对外价和比价都换算到这个币种；和商品的结算币种不同时要有汇率。 | 正文 | [QuotePreviewPage.tsx:635](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L635) |
| `QuotePreviewPage.0e6fc0b8` | 写死 | 按哪个渠道的规则（选填） | 表单标签 | [QuotePreviewPage.tsx:642](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L642) |
| `QuotePreviewPage.79339dcd` | 写死 | 不选：平台默认参数 | 选项 | [QuotePreviewPage.tsx:644](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L644) |
| `QuotePreviewPage.d7d413c3` | 写死 | 选了渠道：只比它授权卖的供应商，加价比例按它的加价规则，价格带、最低毛利、对外价取整也用它的。 | 正文 | [QuotePreviewPage.tsx:652](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L652) |
| `QuotePreviewPage.3ccf8dd3` | 写死 | 假定的里程和时长（选填） | 表单标签 | [QuotePreviewPage.tsx:657](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L657) |
| `QuotePreviewPage.d36b6576` | 写死 | 里程（公里） | 名称 | [QuotePreviewPage.tsx:659](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L659) |
| `QuotePreviewPage.818fed81` | 写死 | 时长（分钟） | 名称 | [QuotePreviewPage.tsx:660](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L660) |
| `QuotePreviewPage.0e357add` | 写死 | 不填时按谷歌地图预估的路程计价；填了就按这两项算、不调用谷歌地图（谷歌地图取不到路线时，或想看某个路程下的价格时用）。只有按「里程 + 时长」计价的商品用得到。 | 正文 | [QuotePreviewPage.tsx:662](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L662) |
| `QuotePreviewPage.3206dde4` | 写死 | 试算中… | 文字 | [QuotePreviewPage.tsx:666](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L666) |
| `QuotePreviewPage.aa08b879` | 写死 | 清空重填 | 按钮 | [QuotePreviewPage.tsx:681](../../apps/web/src/pages/platform/QuotePreviewPage.tsx#L681) |

## 未覆盖需求

文件：`apps/web/src/lib/uncovered-demand-display.ts`、`apps/web/src/pages/platform/UncoveredDemandsPage.tsx`

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
| `uncovered-demand-display.4ac8dd74` | 写死 | 开始日期的写法不对，请写成「年-月-日」。 | 文字 | [uncovered-demand-display.ts:82](../../apps/web/src/lib/uncovered-demand-display.ts#L82) |
| `uncovered-demand-display.5303e910` | 写死 | 结束日期的写法不对，请写成「年-月-日」。 | 文字 | [uncovered-demand-display.ts:83](../../apps/web/src/lib/uncovered-demand-display.ts#L83) |
| `uncovered-demand-display.06298213` | 写死 | 开始日期不能晚于结束日期。 | 文字 | [uncovered-demand-display.ts:85](../../apps/web/src/lib/uncovered-demand-display.ts#L85) |
| `uncovered-demand-display.ba61899d` | 写死 | 日期范围最长 366 天，请缩短。 | 文字 | [uncovered-demand-display.ts:87](../../apps/web/src/lib/uncovered-demand-display.ts#L87) |
| `UncoveredDemandsPage.29f7d87c` | 写死 | （已停用） | 名称 | [UncoveredDemandsPage.tsx:50](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L50) |
| `UncoveredDemandsPage.7b0f659e` | 写死 | 城市 | 名称 | [UncoveredDemandsPage.tsx:53](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L53)、311 行 |
| `UncoveredDemandsPage.826a2233` | 写死 | 全部 | 名称 | [UncoveredDemandsPage.tsx:53](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L53)、58、59、73、80 行 |
| `UncoveredDemandsPage.46ab8eb4` | 写死 | 供应商 | 名称 | [UncoveredDemandsPage.tsx:57](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L57) |
| `UncoveredDemandsPage.21eaa81b` | 写死 | 从 | 名称 | [UncoveredDemandsPage.tsx:67](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L67) |
| `UncoveredDemandsPage.90afadf3` | 写死 | 到 | 名称 | [UncoveredDemandsPage.tsx:68](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L68) |
| `UncoveredDemandsPage.1e4100ce` | 写死 | 用车类型 | 名称 | [UncoveredDemandsPage.tsx:71](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L71) |
| `UncoveredDemandsPage.4a27a588` | 写死 | 原因 | 名称 | [UncoveredDemandsPage.tsx:78](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L78)、172、331 行 |
| `UncoveredDemandsPage.4f16ee6c` | 写死 | 未覆盖需求 · NOZOMI {name} | 浏览器标题 | [UncoveredDemandsPage.tsx:89](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L89) |
| `UncoveredDemandsPage.6f6ce6c8` | 写死 | 未覆盖需求 | 名称 | [UncoveredDemandsPage.tsx:134](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L134)、135、258 行 |
| `UncoveredDemandsPage.b8635a5d` | 写死 | 商品 | 名称 | [UncoveredDemandsPage.tsx:134](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L134) |
| `UncoveredDemandsPage.33012467` | 写死 | 需要的话，请联系管理员开通「未覆盖需求 · 查看」。 | 说明 | [UncoveredDemandsPage.tsx:138](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L138) |
| `UncoveredDemandsPage.40390a8d` | 写死 | 你没有权限查看这里 | 标题 | [UncoveredDemandsPage.tsx:138](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L138) |
| `UncoveredDemandsPage.68aefc9b` | 写死 | （供应商已不存在） | 名称 | [UncoveredDemandsPage.tsx:141](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L141) |
| `UncoveredDemandsPage.9c25477a` | 写死 | 不在任何能订的城市 | 名称 | [UncoveredDemandsPage.tsx:142](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L142) |
| `UncoveredDemandsPage.3e4a2c7a` | 写死 | （城市已不存在） | 名称 | [UncoveredDemandsPage.tsx:144](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L144) |
| `UncoveredDemandsPage.2722cc61` | 写死 | 最近出现 | 文字 | [UncoveredDemandsPage.tsx:148](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L148) |
| `UncoveredDemandsPage.7d462ce2` | 写死 | 用车 | 文字 | [UncoveredDemandsPage.tsx:151](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L151)、307 行 |
| `UncoveredDemandsPage.e0605a0b` | 写死 | {passengers} 人 {luggage} 件行李 | 正文 | [UncoveredDemandsPage.tsx:157](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L157) |
| `UncoveredDemandsPage.67fe3b9a` | 写死 | 上车 → 下车 | 文字 | [UncoveredDemandsPage.tsx:163](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L163) |
| `UncoveredDemandsPage.b4f3c9fc` | 写死 | 次数 | 文字 | [UncoveredDemandsPage.tsx:173](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L173) |
| `UncoveredDemandsPage.6a880455` | 写死 | 涉及的供应商 | 文字 | [UncoveredDemandsPage.tsx:176](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L176) |
| `UncoveredDemandsPage.1b8651ab` | 写死 | 没有 | 正文 | [UncoveredDemandsPage.tsx:179](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L179) |
| `UncoveredDemandsPage.760c59e1` | 写死 |  等 {length} 家 | 文字 | [UncoveredDemandsPage.tsx:179](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L179)、250 行 |
| `UncoveredDemandsPage.b74dbc74` | 写死 | 操作 | 文字 | [UncoveredDemandsPage.tsx:183](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L183) |
| `UncoveredDemandsPage.7edfcd3b` | 写死 | 详情：{…} {…} | 读屏说明 | [UncoveredDemandsPage.tsx:186](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L186) |
| `UncoveredDemandsPage.9dc997dc` | 写死 | 详情 | 按钮 | [UncoveredDemandsPage.tsx:188](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L188) |
| `UncoveredDemandsPage.439cd720` | 写死 | 没有符合条件的未覆盖需求 | 标题 | [UncoveredDemandsPage.tsx:198](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L198) |
| `UncoveredDemandsPage.17794297` | 写死 | 日期范围不对，改好后再查（见上面的说明）。 | 说明 | [UncoveredDemandsPage.tsx:199](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L199) |
| `UncoveredDemandsPage.7a080946` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [UncoveredDemandsPage.tsx:199](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L199) |
| `UncoveredDemandsPage.21b872c4` | 写死 | 清空筛选 | 按钮 | [UncoveredDemandsPage.tsx:203](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L203) |
| `UncoveredDemandsPage.04c0b575` | 写死 | 客人询价时只要有一家报得出价，就不会记在这里。 | 说明 | [UncoveredDemandsPage.tsx:207](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L207) |
| `UncoveredDemandsPage.277a6e64` | 写死 | 最近 30 天没有未覆盖需求 | 标题 | [UncoveredDemandsPage.tsx:207](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L207) |
| `UncoveredDemandsPage.04b3c5b9` | 写死 | 客人询价时一家供应商都报不出价，平台会自动记一条（不含客人的姓名、电话、邮箱等任何个人信息，坐标只到约 10 米）。同一天、同一个需求只记一行，再来只加次数。日期按东京时间，默认最近 30 天。 | 正文 | [UncoveredDemandsPage.tsx:213](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L213) |
| `UncoveredDemandsPage.ce585cd7` | 写死 | {from} 至 {to}：{rows} 条需求，合计 {repeats} 次 | 标题 | [UncoveredDemandsPage.tsx:225](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L225) |
| `UncoveredDemandsPage.2185da49` | 写死 | 按原因 | 读屏说明 | [UncoveredDemandsPage.tsx:228](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L228) |
| `UncoveredDemandsPage.844fe499` | 写死 | {rows} 条 · {repeats} 次 | 正文 | [UncoveredDemandsPage.tsx:232](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L232) |
| `UncoveredDemandsPage.3e6654e9` | 写死 | 按城市： | 正文 | [UncoveredDemandsPage.tsx:241](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L241) |
| `UncoveredDemandsPage.0386d709` | 写死 | {…} {rows} 条 | 文字 | [UncoveredDemandsPage.tsx:242](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L242)、249 行 |
| `UncoveredDemandsPage.30ad21f5` | 写死 |  等 {length} 个 | 正文 | [UncoveredDemandsPage.tsx:243](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L243) |
| `UncoveredDemandsPage.ac3a9ae4` | 写死 | 按运营区域涉及的供应商： | 正文 | [UncoveredDemandsPage.tsx:248](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L248) |
| `UncoveredDemandsPage.d34f1fde` | 写死 | 另有 {dropped} 条新需求因为防刷限流没有记下来（每个来源每小时最多 30 条、全站每天最多 5000 条），不分城市和供应商。 | 正文 | [UncoveredDemandsPage.tsx:254](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L254) |
| `UncoveredDemandsPage.c7ef66e5` | 写死 | 区域 {…} | 名称 | [UncoveredDemandsPage.tsx:289](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L289) |
| `UncoveredDemandsPage.2f22bdc3` | 写死 | 不在任何供应商的运营区域里 | 文字 | [UncoveredDemandsPage.tsx:291](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L291) |
| `UncoveredDemandsPage.dbc81130` | 写死 | 未覆盖需求的详情 | 标题 | [UncoveredDemandsPage.tsx:295](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L295) |
| `UncoveredDemandsPage.d2df5ca3` | 写死 | 关闭 | 按钮 | [UncoveredDemandsPage.tsx:301](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L301) |
| `UncoveredDemandsPage.3129f29d` | 写死 |  · 指定了车型组 | 正文 | [UncoveredDemandsPage.tsx:308](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L308) |
| `UncoveredDemandsPage.b1923770` | 写死 | {…} · {…}（当地时间） · {passengers} 人 {luggage} 件行李{…} | 正文 | [UncoveredDemandsPage.tsx:308](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L308) |
| `UncoveredDemandsPage.bd7c526e` | 写死 | 上车 | 正文 | [UncoveredDemandsPage.tsx:315](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L315) |
| `UncoveredDemandsPage.bf439a73` | 写死 | （没有地点名称） | 正文 | [UncoveredDemandsPage.tsx:316](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L316)、324 行 |
| `UncoveredDemandsPage.0d07976b` | 写死 | 上车点在哪些运营区域里 | 正文 | [UncoveredDemandsPage.tsx:319](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L319) |
| `UncoveredDemandsPage.22f50318` | 写死 | 下车 | 正文 | [UncoveredDemandsPage.tsx:323](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L323) |
| `UncoveredDemandsPage.3260d332` | 写死 | 渠道没有给下车地点 | 正文 | [UncoveredDemandsPage.tsx:324](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L324) |
| `UncoveredDemandsPage.a22db64e` | 写死 | 下车点在哪些运营区域里 | 正文 | [UncoveredDemandsPage.tsx:327](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L327) |
| `UncoveredDemandsPage.4a097315` | 写死 | 各商品报不出的原因 | 正文 | [UncoveredDemandsPage.tsx:335](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L335) |
| `UncoveredDemandsPage.eb23c6f8` | 写死 | 没有可以比价的商品（这一带没有供应商的商品） | 正文 | [UncoveredDemandsPage.tsx:336](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L336) |
| `UncoveredDemandsPage.1e063dc8` | 写死 | 来源 | 正文 | [UncoveredDemandsPage.tsx:339](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L339) |
| `UncoveredDemandsPage.35e3f0d4` | 写死 | 官网 | 正文 | [UncoveredDemandsPage.tsx:340](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L340) |
| `UncoveredDemandsPage.5256726a` | 写死 | 渠道接口 | 正文 | [UncoveredDemandsPage.tsx:340](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L340) |
| `UncoveredDemandsPage.b5c69094` | 写死 | 出现 | 正文 | [UncoveredDemandsPage.tsx:343](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L343) |
| `UncoveredDemandsPage.306bc43f` | 写死 | {repeat\_count} 次，第一次 {…}，最近 {…} | 正文 | [UncoveredDemandsPage.tsx:344](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L344) |
| `UncoveredDemandsPage.b48faa7e` | 写死 | 区域名称没有加载出来，先显示编号。 | 正文 | [UncoveredDemandsPage.tsx:348](../../apps/web/src/pages/platform/UncoveredDemandsPage.tsx#L348) |

## 渠道

文件：`apps/web/src/pages/platform/ChannelPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ChannelPages.800ebdf5` | 写死 | 你没有权限查看这里 | 标题 | [ChannelPages.tsx:39](../../apps/web/src/pages/platform/ChannelPages.tsx#L39) |
| `ChannelPages.e3d6c968` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [ChannelPages.tsx:39](../../apps/web/src/pages/platform/ChannelPages.tsx#L39) |
| `ChannelPages.8bbb8118` | 写死 | 状态 | 名称 | [ChannelPages.tsx:49](../../apps/web/src/pages/platform/ChannelPages.tsx#L49)、110 行 |
| `ChannelPages.c71a0c2f` | 写死 | 全部 | 名称 | [ChannelPages.tsx:51](../../apps/web/src/pages/platform/ChannelPages.tsx#L51) |
| `ChannelPages.11f0ac7b` | 写死 | 你的角色限定了渠道范围，不能新建渠道：新渠道不在你的范围里，建了也看不到。需要新渠道时，请不限渠道范围的同事来建，或请管理员调整你的角色。 | 文字 | [ChannelPages.tsx:57](../../apps/web/src/pages/platform/ChannelPages.tsx#L57) |
| `ChannelPages.9af818db` | 写死 | 渠道 · NOZOMI {name} | 浏览器标题 | [ChannelPages.tsx:61](../../apps/web/src/pages/platform/ChannelPages.tsx#L61)、486 行 |
| `ChannelPages.5a90dd7b` | 写死 | 渠道 | 名称 | [ChannelPages.tsx:82](../../apps/web/src/pages/platform/ChannelPages.tsx#L82)、83、101、392、440、487、488 行 |
| `ChannelPages.bfedd46f` | 写死 | 新建渠道 | 按钮 | [ChannelPages.tsx:94](../../apps/web/src/pages/platform/ChannelPages.tsx#L94)、392、393 行 |
| `ChannelPages.4e497f60` | 写死 | 类型 | 文字 | [ChannelPages.tsx:109](../../apps/web/src/pages/platform/ChannelPages.tsx#L109)、315 行 |
| `ChannelPages.dad0b894` | 写死 | 结算币种 | 文字 | [ChannelPages.tsx:111](../../apps/web/src/pages/platform/ChannelPages.tsx#L111)、316 行 |
| `ChannelPages.abb44066` | 写死 | 默认加价 | 文字 | [ChannelPages.tsx:112](../../apps/web/src/pages/platform/ChannelPages.tsx#L112) |
| `ChannelPages.d1a74af6` | 写死 | 加价下限 | 文字 | [ChannelPages.tsx:113](../../apps/web/src/pages/platform/ChannelPages.tsx#L113) |
| `ChannelPages.38869ada` | 写死 | {length} 个城市 | 文字 | [ChannelPages.tsx:114](../../apps/web/src/pages/platform/ChannelPages.tsx#L114) |
| `ChannelPages.5a4d37dc` | 写死 | 可卖 | 文字 | [ChannelPages.tsx:114](../../apps/web/src/pages/platform/ChannelPages.tsx#L114) |
| `ChannelPages.948d065a` | 写死 | （{length} 家） | 文字 | [ChannelPages.tsx:114](../../apps/web/src/pages/platform/ChannelPages.tsx#L114) |
| `ChannelPages.be99d296` | 写死 | 全部城市 | 文字 | [ChannelPages.tsx:114](../../apps/web/src/pages/platform/ChannelPages.tsx#L114)、338 行 |
| `ChannelPages.e57aac75` | 写死 | 没有符合条件的渠道 | 标题 | [ChannelPages.tsx:122](../../apps/web/src/pages/platform/ChannelPages.tsx#L122) |
| `ChannelPages.6d08fcf2` | 写死 | 换个条件试试。 | 说明 | [ChannelPages.tsx:123](../../apps/web/src/pages/platform/ChannelPages.tsx#L123) |
| `ChannelPages.c20f8c22` | 写死 | 清空筛选 | 按钮 | [ChannelPages.tsx:127](../../apps/web/src/pages/platform/ChannelPages.tsx#L127) |
| `ChannelPages.34798d4c` | 写死 | 还没有渠道 | 标题 | [ChannelPages.tsx:131](../../apps/web/src/pages/platform/ChannelPages.tsx#L131) |
| `ChannelPages.64db7317` | 写死 | 渠道是卖平台用车服务的一方：自己的官网、API 分销商、OTA。新建一个，设置它能卖哪些供应商和城市、加价多少，再给它发 API 密钥。第一个通常是自营官网。 | 说明 | [ChannelPages.tsx:131](../../apps/web/src/pages/platform/ChannelPages.tsx#L131) |
| `ChannelPages.769fbef1` | 写死 | 你可以查看渠道，但不能修改。 | 提示 | [ChannelPages.tsx:135](../../apps/web/src/pages/platform/ChannelPages.tsx#L135) |
| `ChannelPages.f6b83b4d` | 写死 | 按名称或公司搜索 | 名称 | [ChannelPages.tsx:137](../../apps/web/src/pages/platform/ChannelPages.tsx#L137) |
| `ChannelPages.d0bb671c` | 写死 | 渠道列表 | 名称 | [ChannelPages.tsx:141](../../apps/web/src/pages/platform/ChannelPages.tsx#L141) |
| `ChannelPages.1f22cf69` | 写死 | 请填渠道名称 | 文字 | [ChannelPages.tsx:205](../../apps/web/src/pages/platform/ChannelPages.tsx#L205) |
| `ChannelPages.ac90b3a6` | 写死 | 最多 100 个字 | 文字 | [ChannelPages.tsx:206](../../apps/web/src/pages/platform/ChannelPages.tsx#L206) |
| `ChannelPages.872bb594` | 写死 | 请选择渠道类型 | 文字 | [ChannelPages.tsx:207](../../apps/web/src/pages/platform/ChannelPages.tsx#L207) |
| `ChannelPages.72004550` | 写死 | 不是合法的邮箱 | 文字 | [ChannelPages.tsx:208](../../apps/web/src/pages/platform/ChannelPages.tsx#L208) |
| `ChannelPages.1fd673f8` | 写死 | 请至少选一家不卖的供应商 | 文字 | [ChannelPages.tsx:211](../../apps/web/src/pages/platform/ChannelPages.tsx#L211) |
| `ChannelPages.cc5b18ba` | 写死 | 请至少选一家要卖的供应商 | 文字 | [ChannelPages.tsx:211](../../apps/web/src/pages/platform/ChannelPages.tsx#L211) |
| `ChannelPages.b8aed55d` | 写死 | 请至少选一个城市；全部城市都卖请选「全部城市」 | 文字 | [ChannelPages.tsx:212](../../apps/web/src/pages/platform/ChannelPages.tsx#L212) |
| `ChannelPages.edc1cf1a` | 写死 | 请至少选一个品类 | 文字 | [ChannelPages.tsx:213](../../apps/web/src/pages/platform/ChannelPages.tsx#L213) |
| `ChannelPages.ad786584` | 写死 | 请填百分比，最多两位小数，例如 10 | 文字 | [ChannelPages.tsx:219](../../apps/web/src/pages/platform/ChannelPages.tsx#L219)、221 行 |
| `ChannelPages.db5595be` | 写死 | 加价下限不能低于平台下限 {PLATFORM\_FLOOR\_TEXT} | 文字 | [ChannelPages.tsx:220](../../apps/web/src/pages/platform/ChannelPages.tsx#L220) |
| `ChannelPages.87b29707` | 写死 | 默认加价比例不能低于加价下限 | 文字 | [ChannelPages.tsx:222](../../apps/web/src/pages/platform/ChannelPages.tsx#L222) |
| `ChannelPages.711bf101` | 写死 | 价格带要在 0% 到 5% 之间 | 文字 | [ChannelPages.tsx:223](../../apps/web/src/pages/platform/ChannelPages.tsx#L223) |
| `ChannelPages.61186545` | 写死 | {name}（已暂停） | 名称 | [ChannelPages.tsx:271](../../apps/web/src/pages/platform/ChannelPages.tsx#L271) |
| `ChannelPages.a52b2e1e` | 写死 | 已经有同名的渠道了，请换一个名字 | 名称 | [ChannelPages.tsx:286](../../apps/web/src/pages/platform/ChannelPages.tsx#L286) |
| `ChannelPages.4e6bb73f` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [ChannelPages.tsx:294](../../apps/web/src/pages/platform/ChannelPages.tsx#L294) |
| `ChannelPages.324f5eaf` | 写死 | 这个渠道刚被别人改过。请刷新页面，按最新的内容再改一次。 | 文字 | [ChannelPages.tsx:295](../../apps/web/src/pages/platform/ChannelPages.tsx#L295) |
| `ChannelPages.9de6c143` | 写死 | 你没有权限修改渠道。需要的话，请联系管理员开通。 | 文字 | [ChannelPages.tsx:296](../../apps/web/src/pages/platform/ChannelPages.tsx#L296) |
| `ChannelPages.a6fd7f27` | 写死 | 基本信息 | 标题 | [ChannelPages.tsx:313](../../apps/web/src/pages/platform/ChannelPages.tsx#L313) |
| `ChannelPages.de9b63c4` | 写死 | 例如「NOZOMI 官网」。只在运营后台显示。 | 文字 | [ChannelPages.tsx:314](../../apps/web/src/pages/platform/ChannelPages.tsx#L314) |
| `ChannelPages.e118fdc1` | 写死 | 名称 | 文字 | [ChannelPages.tsx:314](../../apps/web/src/pages/platform/ChannelPages.tsx#L314) |
| `ChannelPages.f030d275` | 写死 | 渠道和平台对账用的币种。客人下单的币种不受限，每次询价都可以指定。 | 正文 | [ChannelPages.tsx:317](../../apps/web/src/pages/platform/ChannelPages.tsx#L317) |
| `ChannelPages.bdcef975` | 写死 | 公司（选填） | 文字 | [ChannelPages.tsx:318](../../apps/web/src/pages/platform/ChannelPages.tsx#L318) |
| `ChannelPages.cb567e69` | 写死 | 联系人（选填） | 文字 | [ChannelPages.tsx:319](../../apps/web/src/pages/platform/ChannelPages.tsx#L319) |
| `ChannelPages.5361036c` | 写死 | 联系邮箱（选填） | 文字 | [ChannelPages.tsx:320](../../apps/web/src/pages/platform/ChannelPages.tsx#L320) |
| `ChannelPages.1b8c4ae2` | 写死 | 联系电话（选填） | 文字 | [ChannelPages.tsx:321](../../apps/web/src/pages/platform/ChannelPages.tsx#L321) |
| `ChannelPages.a6cfd6d4` | 写死 | 合同编号（选填） | 文字 | [ChannelPages.tsx:322](../../apps/web/src/pages/platform/ChannelPages.tsx#L322) |
| `ChannelPages.16bf01e2` | 写死 | 信用额度 | 名称 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.1ae3a2cb` | 写死 | 预付款 | 名称 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.65ba6882` | 写死 | 付款方式 | 标题 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.89af6656` | 写死 | 现在只记下来；下单功能上线后才按它扣款和拦单。 | 说明 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.95b1425e` | 写死 | 月结 | 说明 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.97a7b34e` | 写死 | 下单时扣余额 | 说明 | [ChannelPages.tsx:323](../../apps/web/src/pages/platform/ChannelPages.tsx#L323) |
| `ChannelPages.1598aa11` | 写死 | 额度（{settleCurrency}，选填） | 名称 | [ChannelPages.tsx:324](../../apps/web/src/pages/platform/ChannelPages.tsx#L324) |
| `ChannelPages.05910512` | 写死 | 展示（默认） | 名称 | [ChannelPages.tsx:325](../../apps/web/src/pages/platform/ChannelPages.tsx#L325) |
| `ChannelPages.23f2ee38` | 写死 | 付款之前一律不展示。 | 说明 | [ChannelPages.tsx:325](../../apps/web/src/pages/platform/ChannelPages.tsx#L325) |
| `ChannelPages.91ab60f7` | 写死 | 付款后展示中标供应商的名字 | 标题 | [ChannelPages.tsx:325](../../apps/web/src/pages/platform/ChannelPages.tsx#L325) |
| `ChannelPages.66c4bbf3` | 写死 | 授权范围 | 标题 | [ChannelPages.tsx:330](../../apps/web/src/pages/platform/ChannelPages.tsx#L330) |
| `ChannelPages.ea588ebf` | 写死 | 可卖的供应商 | 标题 | [ChannelPages.tsx:331](../../apps/web/src/pages/platform/ChannelPages.tsx#L331) |
| `ChannelPages.87c72c63` | 写死 | 供应商名单没有加载出来，请刷新页面重试。 | 提示 | [ChannelPages.tsx:334](../../apps/web/src/pages/platform/ChannelPages.tsx#L334) |
| `ChannelPages.adf473e6` | 写死 | 不卖这些供应商 | 标题 | [ChannelPages.tsx:336](../../apps/web/src/pages/platform/ChannelPages.tsx#L336) |
| `ChannelPages.e8c588e7` | 写死 | 只卖这些供应商 | 标题 | [ChannelPages.tsx:336](../../apps/web/src/pages/platform/ChannelPages.tsx#L336) |
| `ChannelPages.09c8a6eb` | 写死 | 可卖的城市 | 标题 | [ChannelPages.tsx:338](../../apps/web/src/pages/platform/ChannelPages.tsx#L338) |
| `ChannelPages.1cf8bd87` | 写死 | 只卖选中的城市 | 名称 | [ChannelPages.tsx:338](../../apps/web/src/pages/platform/ChannelPages.tsx#L338) |
| `ChannelPages.8ef9291d` | 写死 | 城市 | 名称 | [ChannelPages.tsx:341](../../apps/web/src/pages/platform/ChannelPages.tsx#L341) |
| `ChannelPages.2dc226da` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [ChannelPages.tsx:345](../../apps/web/src/pages/platform/ChannelPages.tsx#L345) |
| `ChannelPages.30c751ca` | 写死 | 可选的城市都已经选上了 | 文字 | [ChannelPages.tsx:347](../../apps/web/src/pages/platform/ChannelPages.tsx#L347) |
| `ChannelPages.6aa2a7c5` | 写死 | 按国家分组、按名称排。可以连着选几个；选错了点标签上的 × 去掉。 | 说明 | [ChannelPages.tsx:352](../../apps/web/src/pages/platform/ChannelPages.tsx#L352) |
| `ChannelPages.759ad832` | 写死 | 可卖的品类 | 标题 | [ChannelPages.tsx:356](../../apps/web/src/pages/platform/ChannelPages.tsx#L356) |
| `ChannelPages.05875368` | 写死 | 定价参数 | 标题 | [ChannelPages.tsx:362](../../apps/web/src/pages/platform/ChannelPages.tsx#L362) |
| `ChannelPages.08d11fcf` | 写死 | 对外价 = 结算价 ×（1 + 加价比例），加价比例不低于下限；平台下限是 {PLATFORM\_FLOOR\_TEXT}。建好以后再改这几项，要另一位同事审核批准才生效。更细的按供应商、城市、车型组的比例在详情页的「加价规则」里加。 | 正文 | [ChannelPages.tsx:363](../../apps/web/src/pages/platform/ChannelPages.tsx#L363) |
| `ChannelPages.0f21de84` | 写死 | 没有命中任何加价规则时用它。 | 说明 | [ChannelPages.tsx:364](../../apps/web/src/pages/platform/ChannelPages.tsx#L364) |
| `ChannelPages.e58f3848` | 写死 | 默认加价比例（%） | 名称 | [ChannelPages.tsx:364](../../apps/web/src/pages/platform/ChannelPages.tsx#L364) |
| `ChannelPages.52b689d7` | 写死 | 不能低于 {PLATFORM\_FLOOR\_TEXT}；低于下限的加价规则系统不允许保存。 | 说明 | [ChannelPages.tsx:365](../../apps/web/src/pages/platform/ChannelPages.tsx#L365) |
| `ChannelPages.7176e0e0` | 写死 | 加价下限（%） | 名称 | [ChannelPages.tsx:365](../../apps/web/src/pages/platform/ChannelPages.tsx#L365) |
| `ChannelPages.51e6603a` | 写死 | 价格带 δ（%） | 名称 | [ChannelPages.tsx:366](../../apps/web/src/pages/platform/ChannelPages.tsx#L366) |
| `ChannelPages.fe4f5db1` | 写死 | 0% 到 5%：和最低价相差这么多以内的，评分高的中标。 | 说明 | [ChannelPages.tsx:366](../../apps/web/src/pages/platform/ChannelPages.tsx#L366) |
| `ChannelPages.9b4d09e7` | 写死 | 最低毛利（{settleCurrency}，选填） | 名称 | [ChannelPages.tsx:367](../../apps/web/src/pages/platform/ChannelPages.tsx#L367) |
| `ChannelPages.a75f09a4` | 写死 | 每单加价部分不足这个数时补到这个数。不填就是不设。 | 说明 | [ChannelPages.tsx:367](../../apps/web/src/pages/platform/ChannelPages.tsx#L367) |
| `ChannelPages.14bb8642` | 写死 | 取消 | 按钮 | [ChannelPages.tsx:373](../../apps/web/src/pages/platform/ChannelPages.tsx#L373) |
| `ChannelPages.9b0598d4` | 写死 | {submitLabel}中… | 文字 | [ChannelPages.tsx:374](../../apps/web/src/pages/platform/ChannelPages.tsx#L374) |
| `ChannelPages.76552a0c` | 写死 | 新建渠道 · NOZOMI {name} | 浏览器标题 | [ChannelPages.tsx:386](../../apps/web/src/pages/platform/ChannelPages.tsx#L386) |
| `ChannelPages.7a6444cc` | 写死 | 不能新建渠道 | 标题 | [ChannelPages.tsx:402](../../apps/web/src/pages/platform/ChannelPages.tsx#L402) |
| `ChannelPages.f49fb574` | 写死 | 回渠道列表 | 按钮 | [ChannelPages.tsx:402](../../apps/web/src/pages/platform/ChannelPages.tsx#L402) |
| `ChannelPages.76b1c330` | 写死 | 新建 | 按钮 | [ChannelPages.tsx:408](../../apps/web/src/pages/platform/ChannelPages.tsx#L408) |
| `ChannelPages.8af81d69` | 写死 | 已新建渠道「{name}」，状态是「测试」 | 提示 | [ChannelPages.tsx:413](../../apps/web/src/pages/platform/ChannelPages.tsx#L413) |
| `ChannelPages.ea5e0434` | 写死 | 编辑渠道 · NOZOMI {name} | 浏览器标题 | [ChannelPages.tsx:438](../../apps/web/src/pages/platform/ChannelPages.tsx#L438) |
| `ChannelPages.ae35c0a1` | 写死 | 编辑渠道 | 名称 | [ChannelPages.tsx:440](../../apps/web/src/pages/platform/ChannelPages.tsx#L440) |
| `ChannelPages.174e0a9b` | 写死 | 编辑基本信息和授权范围 | 标题 | [ChannelPages.tsx:441](../../apps/web/src/pages/platform/ChannelPages.tsx#L441) |
| `ChannelPages.6fc84644` | 写死 | 找不到这个渠道 | 标题 | [ChannelPages.tsx:448](../../apps/web/src/pages/platform/ChannelPages.tsx#L448)、496 行 |
| `ChannelPages.ad86cf6f` | 写死 | 链接可能有误。 | 说明 | [ChannelPages.tsx:448](../../apps/web/src/pages/platform/ChannelPages.tsx#L448)、496 行 |
| `ChannelPages.bf20073a` | 写死 | 回到渠道列表 | 按钮 | [ChannelPages.tsx:448](../../apps/web/src/pages/platform/ChannelPages.tsx#L448)、496 行 |
| `ChannelPages.0a40b48f` | 写死 | 请检查网络后重试。 | 说明 | [ChannelPages.tsx:449](../../apps/web/src/pages/platform/ChannelPages.tsx#L449)、497 行 |
| `ChannelPages.6a263c56` | 写死 | 重试 | 按钮 | [ChannelPages.tsx:449](../../apps/web/src/pages/platform/ChannelPages.tsx#L449)、497 行 |
| `ChannelPages.ce8ed23a` | 写死 | 加载失败 | 标题 | [ChannelPages.tsx:449](../../apps/web/src/pages/platform/ChannelPages.tsx#L449)、497 行 |
| `ChannelPages.34705c4b` | 写死 | 定价参数和状态不在这里改：在详情页「申请修改定价参数」「申请暂停」，另一位同事批准后生效。 | 提示 | [ChannelPages.tsx:452](../../apps/web/src/pages/platform/ChannelPages.tsx#L452) |
| `ChannelPages.07ce2a4a` | 写死 | 保存 | 按钮 | [ChannelPages.tsx:457](../../apps/web/src/pages/platform/ChannelPages.tsx#L457) |
| `ChannelPages.620c9035` | 写死 | 已保存 | 提示 | [ChannelPages.tsx:463](../../apps/web/src/pages/platform/ChannelPages.tsx#L463) |
| `ChannelPages.56bd87ed` | 写死 | {name} · 渠道 · NOZOMI {name} | 浏览器标题 | [ChannelPages.tsx:486](../../apps/web/src/pages/platform/ChannelPages.tsx#L486) |

## 待审核

文件：`apps/web/src/pages/platform/ApprovalsPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ApprovalsPage.369eb715` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [ApprovalsPage.tsx:37](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L37) |
| `ApprovalsPage.e31333de` | 写死 | 你没有权限查看这里 | 标题 | [ApprovalsPage.tsx:37](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L37) |
| `ApprovalsPage.2a1071de` | 写死 | 批准 | 文字 | [ApprovalsPage.tsx:39](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L39)、247 行 |
| `ApprovalsPage.7390a981` | 写死 | 撤回 | 文字 | [ApprovalsPage.tsx:39](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L39)、237、257 行 |
| `ApprovalsPage.79224e7a` | 写死 | 驳回 | 文字 | [ApprovalsPage.tsx:39](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L39)、252 行 |
| `ApprovalsPage.e3f3b938` | 写死 | 发起人不能审核自己发起的改动，请让另一位有审核权限的同事处理。 | 提示 | [ApprovalsPage.tsx:43](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L43) |
| `ApprovalsPage.9a59e176` | 写死 | 这条已经有结论了（可能刚被别人处理），刷新看看。 | 提示 | [ApprovalsPage.tsx:44](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L44) |
| `ApprovalsPage.6d8e79c7` | 写死 | 发起之后，要改的对象已经被别的改动改过了，不能照旧生效。请驳回，让发起人按现在的内容重新发起。 | 提示 | [ApprovalsPage.tsx:45](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L45) |
| `ApprovalsPage.fab0f3b7` | 写死 | 这份合同的生效日期已经过了，批准会让结算条款追溯生效。请驳回，让发起人按新的生效日期重新发起。 | 提示 | [ApprovalsPage.tsx:46](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L46) |
| `ApprovalsPage.212d860c` | 写死 | 按现在的数据，这个改动不合规则了：{…}。请驳回。 | 提示 | [ApprovalsPage.tsx:47](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L47) |
| `ApprovalsPage.0fb37433` | 写死 | 按现在的数据不能生效：{message}。请驳回。 | 提示 | [ApprovalsPage.tsx:48](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L48) |
| `ApprovalsPage.04a4af1c` | 写死 | 你没有审核这一类改动的权限。 | 提示 | [ApprovalsPage.tsx:49](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L49) |
| `ApprovalsPage.9fcb63cf` | 写死 | 提交 | 文字 | [ApprovalsPage.tsx:51](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L51) |
| `ApprovalsPage.592ad4e5` | 写死 | 批准后立即生效：之后的询价按新的定价参数算。这个渠道上其他还在等审核的改动会过时，只能驳回后重新发起。 | 文字 | [ApprovalsPage.tsx:59](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L59) |
| `ApprovalsPage.2ab7bb2d` | 写死 | 批准后渠道立即暂停：它调用销售端接口（询价等）一律被拒绝。要恢复，到渠道详情点「启用」。 | 文字 | [ApprovalsPage.tsx:60](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L60) |
| `ApprovalsPage.8e68f0f5` | 写死 | 批准后立即生效：之后的询价按新加的这条规则算。 | 文字 | [ApprovalsPage.tsx:61](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L61) |
| `ApprovalsPage.2465ac1f` | 写死 | 批准后立即生效：之后的询价按改过的这条规则算。 | 文字 | [ApprovalsPage.tsx:62](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L62) |
| `ApprovalsPage.00089049` | 写死 | 批准后这条规则立即删除：之后的询价改按下一级的规则或默认加价比例算。 | 文字 | [ApprovalsPage.tsx:63](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L63) |
| `ApprovalsPage.6ad98351` | 写死 | 批准后立即生效：之后的报价就按新的汇率算，已经生成的报价快照不受影响。 | 文字 | [ApprovalsPage.tsx:64](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L64)、65 行 |
| `ApprovalsPage.d68d9eb9` | 写死 | 批准后供应商立即暂停：商品不参与比价、不能下单；已经接下的订单照常履约；它的账号仍然可以登录。要恢复，到供应商详情点「恢复」。 | 文字 | [ApprovalsPage.tsx:66](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L66) |
| `ApprovalsPage.4012f3b9` | 写死 | 批准后供应商立即清退：后台只能查看历史，不能再修改任何东西，商品不再参与比价。清退不能撤销。 | 文字 | [ApprovalsPage.tsx:67](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L67) |
| `ApprovalsPage.59197c62` | 写死 | 批准后这一版合同写入；到了生效日期就是这家供应商现在的结算条款。 | 文字 | [ApprovalsPage.tsx:68](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L68) |
| `ApprovalsPage.537296f3` | 写死 | 批准后立即生效：改了对外显示名称的，客人和渠道之后看到新名称；法定名称、登记号写进企业信息。请先按营业执照、登记簿核对。审核期间平台直接改过这几项、或供应商撤回了申请的，批准会失败，请驳回。 | 文字 | [ApprovalsPage.tsx:69](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L69) |
| `ApprovalsPage.94490149` | 写死 | 批准后立即生效：之后下的单按新的取消政策；已经下了的单仍按下单时的那一版。 | 文字 | [ApprovalsPage.tsx:70](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L70) |
| `ApprovalsPage.83b5b6b8` | 写死 | 批准后这张单立即取消，按上面的金额退给客人（走 Stripe 退款）。 | 文字 | [ApprovalsPage.tsx:71](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L71) |
| `ApprovalsPage.e322389d` | 写死 | 批准后这张单立即进入服务中（不能撤销）：客人和运营都不能再取消，也不能再提交客人未出现。请先和司机或客人确认客人确实上车了。 | 文字 | [ApprovalsPage.tsx:72](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L72) |
| `ApprovalsPage.a850f248` | 写死 | 批准后这张单立即变成已完成（不能撤销），按结算价进供应商账单，供应商也能开始提交事后加收。请先和司机或客人确认这一单确实跑完了。 | 文字 | [ApprovalsPage.tsx:73](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L73) |
| `ApprovalsPage.504171b0` | 写死 | 批准后立即把这张单的订单链接发到新邮箱：收到的人能查看、修改、取消这张单，等于把订单交给他。请先确认发起的同事核实过是客人本人（看发起说明里的核实方式和原因）。订单上的邮箱不改。 | 文字 | [ApprovalsPage.tsx:74](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L74) |
| `ApprovalsPage.8dcbeb9e` | 写死 | 批准后这张单的乘客邮箱立即改成新地址：之后带订单链接的通知（订单修改、取消、派车等）都发到新地址，等于把订单交给这个邮箱的主人。请先确认发起的同事核实过是客人本人（看发起说明里的核实方式和原因）。审核期间客人自己改过邮箱的，批准会失败，请驳回。 | 文字 | [ApprovalsPage.tsx:75](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L75) |
| `ApprovalsPage.1bb3c917` | 写死 | 批准后这张单立即转给指定的供应商（按上面的结算价，不用它再接单），客人付的钱不变；差价记到原供应商的应扣款项。 | 文字 | [ApprovalsPage.tsx:76](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L76) |
| `ApprovalsPage.f8ea3834` | 写死 | 批准后立即生效：用这个角色的员工的权限、数据范围、IP 白名单马上按新的来，不用重新登录。 | 文字 | [ApprovalsPage.tsx:77](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L77) |
| `ApprovalsPage.5c79d309` | 写死 | 批准后他的两步验证立即清掉，已经登录着的也会退出；下次用密码登录时要重新绑定验证器。请先确认提出要求的就是他本人。 | 文字 | [ApprovalsPage.tsx:78](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L78) |
| `ApprovalsPage.8f261912` | 写死 | 批准后这个账户立即生效，之后生成的转账文件付到这个账户，旧账户被替换。请先按供应商的结算账户证明核对户名、银行、SWIFT 和账号末 4 位。 | 文字 | [ApprovalsPage.tsx:79](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L79) |
| `ApprovalsPage.22880aac` | 写死 | 批准后生成转账文件，财务才能下载并到银行转账。请逐笔核对收款人、账号末 4 位和金额。 | 文字 | [ApprovalsPage.tsx:80](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L80) |
| `ApprovalsPage.80c02880` | 写死 | 批准后这张账单进付款日的付款批次（合计为 0 记为无需付款，为负转入下一期）；请先核对账单明细和供应商的确认。 | 文字 | [ApprovalsPage.tsx:81](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L81) |
| `ApprovalsPage.0f624cbb` | 写死 | 批准后存成新的一版赔付表，之后判定的工单按新表算；已经判定的不变。 | 文字 | [ApprovalsPage.tsx:82](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L82) |
| `ApprovalsPage.59f4e4b7` | 写死 | 批准后按发起时的判定执行：给客人退款（退不回卡上的记为待财务另付），责任在供应商的记成它的应扣款项并计入评分；判定人记为发起的同事。发起后这一单的收款、退款变了的，会提示已过时，只能驳回。 | 文字 | [ApprovalsPage.tsx:83](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L83) |
| `ApprovalsPage.d9c34737` | 写死 | {…}：{…}（{…} 发起） | 名称 | [ApprovalsPage.tsx:88](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L88) |
| `ApprovalsPage.bba75ea5` | 写死 | 币种： | 正文 | [ApprovalsPage.tsx:106](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L106) |
| `ApprovalsPage.5b0eb15b` | 写死 | {…}（去汇率页） | 链接 | [ApprovalsPage.tsx:107](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L107) |
| `ApprovalsPage.64b95778` | 写死 | 角色： | 正文 | [ApprovalsPage.tsx:114](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L114) |
| `ApprovalsPage.128c3ffa` | 写死 | 查看角色 | 链接 | [ApprovalsPage.tsx:115](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L115) |
| `ApprovalsPage.907ac095` | 写死 | 员工： | 正文 | [ApprovalsPage.tsx:122](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L122) |
| `ApprovalsPage.156854a4` | 写死 | 查看员工 | 链接 | [ApprovalsPage.tsx:123](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L123) |
| `ApprovalsPage.a5c1b81c` | 写死 | 供应商： | 正文 | [ApprovalsPage.tsx:130](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L130)、138 行 |
| `ApprovalsPage.9cc08f51` | 写死 | 去供应商详情 | 链接 | [ApprovalsPage.tsx:131](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L131)、139 行 |
| `ApprovalsPage.12d07a4d` | 写死 | 订单： | 正文 | [ApprovalsPage.tsx:146](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L146) |
| `ApprovalsPage.78533ccb` | 写死 | 去订单详情 | 链接 | [ApprovalsPage.tsx:147](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L147) |
| `ApprovalsPage.c7f94935` | 写死 | 看现在的赔付表 | 链接 | [ApprovalsPage.tsx:155](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L155) |
| `ApprovalsPage.c147a776` | 写死 | 工单： | 正文 | [ApprovalsPage.tsx:161](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L161) |
| `ApprovalsPage.6e03cbb2` | 写死 | 去工单详情 | 链接 | [ApprovalsPage.tsx:162](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L162) |
| `ApprovalsPage.37d829d0` | 写死 | 账单： | 正文 | [ApprovalsPage.tsx:169](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L169) |
| `ApprovalsPage.58e4f1f3` | 写死 | 去账单详情 | 链接 | [ApprovalsPage.tsx:170](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L170) |
| `ApprovalsPage.edcffdfd` | 写死 | 付款批次： | 正文 | [ApprovalsPage.tsx:177](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L177) |
| `ApprovalsPage.20c31caa` | 写死 | 去付款批次 | 链接 | [ApprovalsPage.tsx:178](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L178) |
| `ApprovalsPage.7f2a3ec2` | 写死 | 去收款账户 | 链接 | [ApprovalsPage.tsx:186](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L186) |
| `ApprovalsPage.69267b33` | 写死 | 渠道： | 正文 | [ApprovalsPage.tsx:192](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L192) |
| `ApprovalsPage.3b43938b` | 写死 | 改了什么 | 读屏说明 | [ApprovalsPage.tsx:199](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L199) |
| `ApprovalsPage.7baeb845` | 写死 | 项目 | 表头 | [ApprovalsPage.tsx:203](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L203) |
| `ApprovalsPage.46fd80e3` | 写死 | 改之前 | 表头 | [ApprovalsPage.tsx:204](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L204) |
| `ApprovalsPage.076b11b2` | 写死 | 改之后 | 表头 | [ApprovalsPage.tsx:205](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L205) |
| `ApprovalsPage.ccedd777` | 写死 | 发起 | 正文 | [ApprovalsPage.tsx:226](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L226) |
| `ApprovalsPage.dddd5640` | 写死 | 发起说明 | 正文 | [ApprovalsPage.tsx:231](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L231) |
| `ApprovalsPage.bc9d4dff` | 写死 | 审核 | 正文 | [ApprovalsPage.tsx:237](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L237) |
| `ApprovalsPage.1fd6b851` | 写死 | 这是你发起的，要等另一位有审核权限的同事处理。 | 正文 | [ApprovalsPage.tsx:259](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L259) |
| `ApprovalsPage.db4b0cfc` | 写死 | 你可以查看，但没有审核这一类改动的权限。 | 正文 | [ApprovalsPage.tsx:260](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L260) |
| `ApprovalsPage.935114bb` | 写死 | 待审核 · NOZOMI {name} | 浏览器标题 | [ApprovalsPage.tsx:269](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L269) |
| `ApprovalsPage.065f74e6` | 写死 | 待审核 | 名称 | [ApprovalsPage.tsx:285](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L285)、286、321 行 |
| `ApprovalsPage.76b4b8fc` | 写死 | 请驳回；等这几条规则改到新的下限以上之后，让发起人重新发起。 | 文字 | [ApprovalsPage.tsx:297](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L297) |
| `ApprovalsPage.eae2887e` | 写死 | 按现在的数据不能生效：{message} | 提示 | [ApprovalsPage.tsx:297](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L297) |
| `ApprovalsPage.40f4a213` | 写死 | 已撤回 | 提示 | [ApprovalsPage.tsx:305](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L305) |
| `ApprovalsPage.783460dd` | 写死 | 已驳回 | 提示 | [ApprovalsPage.tsx:305](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L305) |
| `ApprovalsPage.b53ff620` | 写死 | 已批准，改动已生效 | 提示 | [ApprovalsPage.tsx:305](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L305) |
| `ApprovalsPage.00661ec3` | 写死 | 时间按你的本地时区（{…}）显示。 | 正文 | [ApprovalsPage.tsx:319](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L319) |
| `ApprovalsPage.1215acc0` | 写死 | 修改渠道的加价比例和加价规则、停用渠道、人工锁定或解锁汇率、修改角色、重置别人的两步验证、修改赔付表、赔付达到阈值的工单判定、代供应商回传「已接到客人」「已完成」、付款给供应商、启用收款账户、生成转账文件，都要一个人发起、另一个人批准后才生效；发起人不能审核自己发起的。每一步都记在审计日志里。{…} | 正文 | [ApprovalsPage.tsx:319](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L319) |
| `ApprovalsPage.455cd666` | 写死 | 全部（含历史） | 名称 | [ApprovalsPage.tsx:321](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L321) |
| `ApprovalsPage.5adfec8a` | 写死 | 显示 | 名称 | [ApprovalsPage.tsx:321](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L321) |
| `ApprovalsPage.01857cc1` | 写死 | 重试 | 按钮 | [ApprovalsPage.tsx:325](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L325) |
| `ApprovalsPage.083aeac6` | 写死 | 请检查网络后重试。 | 说明 | [ApprovalsPage.tsx:325](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L325) |
| `ApprovalsPage.8ba4de74` | 写死 | 加载失败 | 标题 | [ApprovalsPage.tsx:325](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L325) |
| `ApprovalsPage.16d9e21d` | 写死 | 还没有复核记录 | 标题 | [ApprovalsPage.tsx:330](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L330) |
| `ApprovalsPage.b3df318b` | 写死 | 没有待审核的改动 | 标题 | [ApprovalsPage.tsx:330](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L330) |
| `ApprovalsPage.db6c1166` | 写死 | 同事发起需要双人复核的改动（加价、汇率锁定、赔付表、工单判定、付款给供应商、启用收款账户、生成转账文件等）后，会出现在这里。 | 说明 | [ApprovalsPage.tsx:330](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L330) |
| `ApprovalsPage.78c7ac17` | 写死 | 共 {total} 条{…} | 正文 | [ApprovalsPage.tsx:333](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L333) |
| `ApprovalsPage.9599641d` | 写死 | ，这里显示最近的 {length} 条 | 正文 | [ApprovalsPage.tsx:333](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L333) |
| `ApprovalsPage.b6c332d3` | 写死 | 取消 | 按钮 | [ApprovalsPage.tsx:358](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L358) |
| `ApprovalsPage.8d952837` | 写死 | 提交中… | 文字 | [ApprovalsPage.tsx:359](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L359) |
| `ApprovalsPage.8ca71776` | 写死 | 说明（选填） | 名称 | [ApprovalsPage.tsx:368](../../apps/web/src/pages/platform/ApprovalsPage.tsx#L368) |

## 平台员工

文件：`apps/web/src/pages/platform/StaffPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `StaffPages.33b5984b` | 写死 | 你没有权限查看这里 | 标题 | [StaffPages.tsx:43](../../apps/web/src/pages/platform/StaffPages.tsx#L43) |
| `StaffPages.c0f32340` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [StaffPages.tsx:43](../../apps/web/src/pages/platform/StaffPages.tsx#L43) |
| `StaffPages.118be580` | 写死 | 系统设置 | 名称 | [StaffPages.tsx:44](../../apps/web/src/pages/platform/StaffPages.tsx#L44) |
| `StaffPages.18e20454` | 写死 | 角色 | 名称 | [StaffPages.tsx:58](../../apps/web/src/pages/platform/StaffPages.tsx#L58)、207、512 行 |
| `StaffPages.a3cbe687` | 写死 | 全部 | 名称 | [StaffPages.tsx:58](../../apps/web/src/pages/platform/StaffPages.tsx#L58)、64 行 |
| `StaffPages.5e6c9b66` | 写死 | 状态 | 名称 | [StaffPages.tsx:61](../../apps/web/src/pages/platform/StaffPages.tsx#L61)、209 行 |
| `StaffPages.f50ee475` | 写死 | 待激活 | 名称 | [StaffPages.tsx:65](../../apps/web/src/pages/platform/StaffPages.tsx#L65) |
| `StaffPages.ab90dd49` | 写死 | 在用 | 名称 | [StaffPages.tsx:66](../../apps/web/src/pages/platform/StaffPages.tsx#L66) |
| `StaffPages.b0de6d1b` | 写死 | 已停用 | 名称 | [StaffPages.tsx:67](../../apps/web/src/pages/platform/StaffPages.tsx#L67) |
| `StaffPages.797beb29` | 写死 | 平台员工 · NOZOMI {name} | 浏览器标题 | [StaffPages.tsx:79](../../apps/web/src/pages/platform/StaffPages.tsx#L79) |
| `StaffPages.4b36c8f4` | 写死 | 平台员工 | 名称 | [StaffPages.tsx:120](../../apps/web/src/pages/platform/StaffPages.tsx#L120)、121、416 行 |
| `StaffPages.b56819f8` | 写死 | 平台员工，{…} | 文字 | [StaffPages.tsx:162](../../apps/web/src/pages/platform/StaffPages.tsx#L162)、443 行 |
| `StaffPages.cd7c89ea` | 写死 | 已停用「{name}」 | 提示 | [StaffPages.tsx:166](../../apps/web/src/pages/platform/StaffPages.tsx#L166) |
| `StaffPages.ef0a980c` | 写死 | 已启用「{name}」 | 提示 | [StaffPages.tsx:166](../../apps/web/src/pages/platform/StaffPages.tsx#L166) |
| `StaffPages.26b6fe54` | 写死 | 他是最后一个在用的超级管理员。请先给另一个人开一个超级管理员账号，等对方设好密码以后再停用他。 | 文字 | [StaffPages.tsx:173](../../apps/web/src/pages/platform/StaffPages.tsx#L173) |
| `StaffPages.56a740ce` | 写死 | 现在不能停用。 | 标题 | [StaffPages.tsx:173](../../apps/web/src/pages/platform/StaffPages.tsx#L173) |
| `StaffPages.821ab5f1` | 写死 | 这个账号还没有设过密码，不能直接启用。请重新邀请他。 | 文字 | [StaffPages.tsx:176](../../apps/web/src/pages/platform/StaffPages.tsx#L176) |
| `StaffPages.f95fac66` | 写死 | 这个账号现在不是在用的状态。待激活的请用「重新邀请」，已停用的请先「启用」。 | 文字 | [StaffPages.tsx:179](../../apps/web/src/pages/platform/StaffPages.tsx#L179) |
| `StaffPages.e333c4ab` | 写死 | 找不到这个账号，它可能已被删除。 | 文字 | [StaffPages.tsx:182](../../apps/web/src/pages/platform/StaffPages.tsx#L182) |
| `StaffPages.176b21c0` | 写死 | 不确定有没有成功。 | 标题 | [StaffPages.tsx:183](../../apps/web/src/pages/platform/StaffPages.tsx#L183)、452 行 |
| `StaffPages.33c00cfd` | 写死 | 你没有权限做这个操作。需要的话，请联系管理员开通。 | 文字 | [StaffPages.tsx:184](../../apps/web/src/pages/platform/StaffPages.tsx#L184) |
| `StaffPages.0cc6b040` | 写死 | 启用 | 文字 | [StaffPages.tsx:185](../../apps/web/src/pages/platform/StaffPages.tsx#L185)、242、310 行 |
| `StaffPages.92a6b364` | 写死 | 发出 | 文字 | [StaffPages.tsx:185](../../apps/web/src/pages/platform/StaffPages.tsx#L185)、310 行 |
| `StaffPages.d2ed8599` | 写死 | 停用 | 文字 | [StaffPages.tsx:185](../../apps/web/src/pages/platform/StaffPages.tsx#L185)、249、310 行 |
| `StaffPages.de8cc063` | 写死 | 姓名 | 文字 | [StaffPages.tsx:195](../../apps/web/src/pages/platform/StaffPages.tsx#L195)、426、437、502 行 |
| `StaffPages.5b7079f3` | 写死 | 你 | 正文 | [StaffPages.tsx:202](../../apps/web/src/pages/platform/StaffPages.tsx#L202) |
| `StaffPages.4c4b4335` | 写死 | 邮箱 | 文字 | [StaffPages.tsx:206](../../apps/web/src/pages/platform/StaffPages.tsx#L206)、475 行 |
| `StaffPages.25c88992` | 写死 | 两步验证 | 文字 | [StaffPages.tsx:208](../../apps/web/src/pages/platform/StaffPages.tsx#L208) |
| `StaffPages.8470ce72` | 写死 | 还没绑定 | 正文 | [StaffPages.tsx:208](../../apps/web/src/pages/platform/StaffPages.tsx#L208) |
| `StaffPages.f4fd1918` | 写死 | 已绑定 | 正文 | [StaffPages.tsx:208](../../apps/web/src/pages/platform/StaffPages.tsx#L208) |
| `StaffPages.0dfa1121` | 写死 | 创建时间 | 文字 | [StaffPages.tsx:210](../../apps/web/src/pages/platform/StaffPages.tsx#L210) |
| `StaffPages.b23ac233` | 写死 | 操作 | 文字 | [StaffPages.tsx:213](../../apps/web/src/pages/platform/StaffPages.tsx#L213) |
| `StaffPages.8f3d8b3f` | 写死 | 看他的操作记录 | 正文 | [StaffPages.tsx:219](../../apps/web/src/pages/platform/StaffPages.tsx#L219) |
| `StaffPages.9ebf83fa` | 写死 | 看这个账号的变更记录 | 正文 | [StaffPages.tsx:222](../../apps/web/src/pages/platform/StaffPages.tsx#L222) |
| `StaffPages.013f0efa` | 写死 | 更多 | 文字 | [StaffPages.tsx:228](../../apps/web/src/pages/platform/StaffPages.tsx#L228) |
| `StaffPages.4e14fb2f` | 写死 | {…} 的更多操作 | 名称 | [StaffPages.tsx:228](../../apps/web/src/pages/platform/StaffPages.tsx#L228) |
| `StaffPages.e77757ba` | 写死 | 这是你自己的账号。 | 正文 | [StaffPages.tsx:229](../../apps/web/src/pages/platform/StaffPages.tsx#L229) |
| `StaffPages.98374200` | 写死 | 重新邀请 | 正文 | [StaffPages.tsx:232](../../apps/web/src/pages/platform/StaffPages.tsx#L232)、400、416、559、574 行 |
| `StaffPages.12b90794` | 写死 | 发密码重置链接 | 正文 | [StaffPages.tsx:237](../../apps/web/src/pages/platform/StaffPages.tsx#L237) |
| `StaffPages.a4e5a674` | 写死 | 没有符合条件的员工 | 标题 | [StaffPages.tsx:267](../../apps/web/src/pages/platform/StaffPages.tsx#L267) |
| `StaffPages.ad406f04` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [StaffPages.tsx:268](../../apps/web/src/pages/platform/StaffPages.tsx#L268) |
| `StaffPages.e9b056f9` | 写死 | 清空筛选 | 按钮 | [StaffPages.tsx:272](../../apps/web/src/pages/platform/StaffPages.tsx#L272) |
| `StaffPages.e1aae74e` | 写死 | 新增员工 | 按钮 | [StaffPages.tsx:280](../../apps/web/src/pages/platform/StaffPages.tsx#L280)、399、400、416 行 |
| `StaffPages.92cab241` | 写死 | 已给「{name}」发出密码重置链接 | 提示 | [StaffPages.tsx:289](../../apps/web/src/pages/platform/StaffPages.tsx#L289) |
| `StaffPages.1e5744ed` | 写死 | 给「{name}」发密码重置链接？ | 标题 | [StaffPages.tsx:296](../../apps/web/src/pages/platform/StaffPages.tsx#L296) |
| `StaffPages.76014c79` | 写死 | 启用「{name}」？ | 标题 | [StaffPages.tsx:296](../../apps/web/src/pages/platform/StaffPages.tsx#L296) |
| `StaffPages.df0b067f` | 写死 | 停用「{name}」？ | 标题 | [StaffPages.tsx:296](../../apps/web/src/pages/platform/StaffPages.tsx#L296) |
| `StaffPages.1f34b081` | 写死 | 知道了 | 按钮 | [StaffPages.tsx:306](../../apps/web/src/pages/platform/StaffPages.tsx#L306) |
| `StaffPages.8a422043` | 写死 | 取消 | 按钮 | [StaffPages.tsx:306](../../apps/web/src/pages/platform/StaffPages.tsx#L306)、572 行 |
| `StaffPages.34506c5a` | 写死 | 停用中… | 文字 | [StaffPages.tsx:309](../../apps/web/src/pages/platform/StaffPages.tsx#L309) |
| `StaffPages.5e507972` | 写死 | 发出中… | 文字 | [StaffPages.tsx:309](../../apps/web/src/pages/platform/StaffPages.tsx#L309) |
| `StaffPages.b74c0d76` | 写死 | 启用中… | 文字 | [StaffPages.tsx:309](../../apps/web/src/pages/platform/StaffPages.tsx#L309) |
| `StaffPages.b62a7766` | 写死 | 去重新邀请 | 链接 | [StaffPages.tsx:325](../../apps/web/src/pages/platform/StaffPages.tsx#L325) |
| `StaffPages.0e502aeb` | 写死 | 他还没有设过密码，之前发给他的邀请链接会作废。之后可以重新邀请。 | 正文 | [StaffPages.tsx:333](../../apps/web/src/pages/platform/StaffPages.tsx#L333) |
| `StaffPages.4f285429` | 写死 | ，已经登录着的也会立刻退出。{…} | 正文 | [StaffPages.tsx:333](../../apps/web/src/pages/platform/StaffPages.tsx#L333) |
| `StaffPages.8b1d96f6` | 写死 | 马上不能登录 | 正文 | [StaffPages.tsx:333](../../apps/web/src/pages/platform/StaffPages.tsx#L333) |
| `StaffPages.9acfbd5f` | 写死 | 之后可以重新启用。 | 正文 | [StaffPages.tsx:333](../../apps/web/src/pages/platform/StaffPages.tsx#L333) |
| `StaffPages.c6e74215` | 写死 | 停用以后，他 | 正文 | [StaffPages.tsx:333](../../apps/web/src/pages/platform/StaffPages.tsx#L333) |
| `StaffPages.7b04089f` | 写死 | 启用以后，他可以用原来的密码登录，角色不变（{…}）。 | 正文 | [StaffPages.tsx:336](../../apps/web/src/pages/platform/StaffPages.tsx#L336) |
| `StaffPages.adef8e90` | 写死 | ，也不会让他退出登录；他用链接设了新密码以后，旧密码才失效。请先确认提出要求的就是他本人。 | 正文 | [StaffPages.tsx:340](../../apps/web/src/pages/platform/StaffPages.tsx#L340) |
| `StaffPages.b41f6d99` | 写死 | 发出链接不会改掉他现在的密码 | 正文 | [StaffPages.tsx:340](../../apps/web/src/pages/platform/StaffPages.tsx#L340) |
| `StaffPages.ec00d516` | 写死 | 会生成一条重置链接（24 小时有效，只显示一次），由你发给他本人。 | 正文 | [StaffPages.tsx:340](../../apps/web/src/pages/platform/StaffPages.tsx#L340) |
| `StaffPages.affbb733` | 写死 | 最后一个超级管理员自己忘了密码，页面上处理不了，要请技术在服务器上重设。 | 正文 | [StaffPages.tsx:342](../../apps/web/src/pages/platform/StaffPages.tsx#L342) |
| `StaffPages.ec2bd05b` | 写死 | 按姓名或邮箱搜索 | 名称 | [StaffPages.tsx:351](../../apps/web/src/pages/platform/StaffPages.tsx#L351) |
| `StaffPages.ba79711b` | 写死 | 加载失败 | 正文 | [StaffPages.tsx:357](../../apps/web/src/pages/platform/StaffPages.tsx#L357) |
| `StaffPages.cdb7b993` | 写死 | 下面是上一次取到的内容，可能已经过时。请检查网络后重试。 | 正文 | [StaffPages.tsx:358](../../apps/web/src/pages/platform/StaffPages.tsx#L358) |
| `StaffPages.3e2ad1e6` | 写死 | 重试 | 按钮 | [StaffPages.tsx:362](../../apps/web/src/pages/platform/StaffPages.tsx#L362) |
| `StaffPages.4c8751f2` | 写死 | 平台员工列表 | 名称 | [StaffPages.tsx:368](../../apps/web/src/pages/platform/StaffPages.tsx#L368) |
| `StaffPages.ba57e2f4` | 写死 | 现在只有你一个人。{…} | 正文 | [StaffPages.tsx:370](../../apps/web/src/pages/platform/StaffPages.tsx#L370) |
| `StaffPages.e13a9a9a` | 写死 | 点右上角的「新增员工」给同事开账号。 | 正文 | [StaffPages.tsx:370](../../apps/web/src/pages/platform/StaffPages.tsx#L370) |
| `StaffPages.b1ea46e5` | 写死 | 重新邀请 {name} | 标题 | [StaffPages.tsx:399](../../apps/web/src/pages/platform/StaffPages.tsx#L399) |
| `StaffPages.d21a02cf` | 写死 | 这个邮箱已经有一个设过密码的平台员工账号了。他忘了密码的话，请在列表里给他「发密码重置链接」；账号被停用了的话，请在列表里「启用」。 | 提示 | [StaffPages.tsx:425](../../apps/web/src/pages/platform/StaffPages.tsx#L425) |
| `StaffPages.2c4720e1` | 写死 | 请选择角色 | 提示 | [StaffPages.tsx:427](../../apps/web/src/pages/platform/StaffPages.tsx#L427) |
| `StaffPages.4703b9f5` | 写死 | 你没有权限新增员工。需要的话，请联系管理员开通。 | 文字 | [StaffPages.tsx:453](../../apps/web/src/pages/platform/StaffPages.tsx#L453) |
| `StaffPages.d4195d4d` | 写死 | 新增 | 文字 | [StaffPages.tsx:454](../../apps/web/src/pages/platform/StaffPages.tsx#L454)、559、574 行 |
| `StaffPages.5485c5ef` | 写死 | 会发出一条新的邀请链接，之前那条作废。姓名和角色按这次填的更新。 | 正文 | [StaffPages.tsx:471](../../apps/web/src/pages/platform/StaffPages.tsx#L471) |
| `StaffPages.cb246b6e` | 写死 | 以后用它登录运营后台。平台员工和供应商的账号是两套，同一个邮箱可以两边各有一个。 | 正文 | [StaffPages.tsx:496](../../apps/web/src/pages/platform/StaffPages.tsx#L496) |
| `StaffPages.f2a9bed2` | 写死 |  现在能做的：{…}。 | 正文 | [StaffPages.tsx:526](../../apps/web/src/pages/platform/StaffPages.tsx#L526)、540 行 |
| `StaffPages.f644979d` | 写死 | 他负责的模块还没有上线，现在登录后只能看主数据。 | 正文 | [StaffPages.tsx:527](../../apps/web/src/pages/platform/StaffPages.tsx#L527) |
| `StaffPages.65f60c0d` | 写死 | {name}（自建） | 正文 | [StaffPages.tsx:537](../../apps/web/src/pages/platform/StaffPages.tsx#L537) |
| `StaffPages.72c53689` | 写死 | 超级管理员自建的角色。 | 正文 | [StaffPages.tsx:539](../../apps/web/src/pages/platform/StaffPages.tsx#L539) |
| `StaffPages.8dfca22d` | 写死 | 超级管理员可以管理所有平台员工、看到全部审计日志。 | 正文 | [StaffPages.tsx:549](../../apps/web/src/pages/platform/StaffPages.tsx#L549) |
| `StaffPages.b719c562` | 写死 | 请只给确实需要的人。 | 正文 | [StaffPages.tsx:550](../../apps/web/src/pages/platform/StaffPages.tsx#L550) |
| `StaffPages.b9127a83` | 写死 | 角色决定他能看到哪些菜单、能做哪些操作。以后可以在他的员工详情里改。不确定时先给「只读」。 | 正文 | [StaffPages.tsx:554](../../apps/web/src/pages/platform/StaffPages.tsx#L554) |
| `StaffPages.e3b1eecb` | 写死 | 系统不会给对方发邮件。 | 正文 | [StaffPages.tsx:558](../../apps/web/src/pages/platform/StaffPages.tsx#L558) |
| `StaffPages.a5713e57` | 写死 | 点「{…}」后会显示一条邀请链接，只显示一次。 | 正文 | [StaffPages.tsx:559](../../apps/web/src/pages/platform/StaffPages.tsx#L559) |
| `StaffPages.65f69e80` | 写死 | 新增中… | 文字 | [StaffPages.tsx:573](../../apps/web/src/pages/platform/StaffPages.tsx#L573) |
| `StaffPages.7db9a299` | 写死 | 邀请中… | 文字 | [StaffPages.tsx:573](../../apps/web/src/pages/platform/StaffPages.tsx#L573) |
| `StaffPages.8a9458dc` | 写死 | 已邀请「{name}」 | 提示 | [StaffPages.tsx:584](../../apps/web/src/pages/platform/StaffPages.tsx#L584) |
| `StaffPages.aec8ca13` | 写死 | 填的内容还没有提交 | 标题 | [StaffPages.tsx:591](../../apps/web/src/pages/platform/StaffPages.tsx#L591) |
| `StaffPages.d33c48ce` | 写死 | 继续填写 | 按钮 | [StaffPages.tsx:597](../../apps/web/src/pages/platform/StaffPages.tsx#L597) |
| `StaffPages.01ad3c5d` | 写死 | 不保存，离开 | 按钮 | [StaffPages.tsx:611](../../apps/web/src/pages/platform/StaffPages.tsx#L611) |
| `StaffPages.4dac3e59` | 写死 | 离开后，这里填的内容不会保留。 | 正文 | [StaffPages.tsx:615](../../apps/web/src/pages/platform/StaffPages.tsx#L615) |

## 账号安全和角色

文件：`apps/web/src/lib/role-form.ts`、`apps/web/src/pages/platform/SecurityPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `role-form.70170782` | 写死 | 不是合法的 IP 地址或地址段 | 提示 | [role-form.ts:60](../../apps/web/src/lib/role-form.ts#L60) |
| `role-form.34122345` | 写死 | 地址段写得不对 | 文字 | [role-form.ts:61](../../apps/web/src/lib/role-form.ts#L61) |
| `role-form.13cb89da` | 写死 | 和前面的重复了 | 文字 | [role-form.ts:62](../../apps/web/src/lib/role-form.ts#L62) |
| `role-form.47407e9b` | 写死 | 不对 | 文字 | [role-form.ts:68](../../apps/web/src/lib/role-form.ts#L68) |
| `role-form.cc4d8bb1` | 写死 | ，应写成 {suggestion} | 文字 | [role-form.ts:68](../../apps/web/src/lib/role-form.ts#L68) |
| `role-form.f7e30bc0` | 写死 | 第 {…} 条「{value}」{…}{…} | 文字 | [role-form.ts:68](../../apps/web/src/lib/role-form.ts#L68) |
| `role-form.7813703d` | 写死 | 最多 50 条 | 文字 | [role-form.ts:69](../../apps/web/src/lib/role-form.ts#L69) |
| `SecurityPages.99aff891` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [SecurityPages.tsx:41](../../apps/web/src/pages/platform/SecurityPages.tsx#L41) |
| `SecurityPages.bcc001ea` | 写死 | 你没有权限查看这里 | 标题 | [SecurityPages.tsx:41](../../apps/web/src/pages/platform/SecurityPages.tsx#L41) |
| `SecurityPages.4b9124f2` | 写死 | 系统设置 | 名称 | [SecurityPages.tsx:42](../../apps/web/src/pages/platform/SecurityPages.tsx#L42) |
| `SecurityPages.336ce02f` | 写死 | 账号安全 · NOZOMI {name} | 浏览器标题 | [SecurityPages.tsx:50](../../apps/web/src/pages/platform/SecurityPages.tsx#L50) |
| `SecurityPages.3bb9d90c` | 写死 | 已换上新的验证器，其他设备上的登录都已退出 | 提示 | [SecurityPages.tsx:105](../../apps/web/src/pages/platform/SecurityPages.tsx#L105) |
| `SecurityPages.54fcb2de` | 写死 | 账号安全 | 名称 | [SecurityPages.tsx:117](../../apps/web/src/pages/platform/SecurityPages.tsx#L117)、118 行 |
| `SecurityPages.563a9c1f` | 写死 | 加载失败 | 标题 | [SecurityPages.tsx:123](../../apps/web/src/pages/platform/SecurityPages.tsx#L123)、249、454、609 行 |
| `SecurityPages.e1c15a96` | 写死 | 重试 | 按钮 | [SecurityPages.tsx:123](../../apps/web/src/pages/platform/SecurityPages.tsx#L123)、249、454、609 行 |
| `SecurityPages.e1dda561` | 写死 | 请检查网络后重试。 | 说明 | [SecurityPages.tsx:123](../../apps/web/src/pages/platform/SecurityPages.tsx#L123)、249、454、609 行 |
| `SecurityPages.b07d360a` | 写死 | 取消 | 按钮 | [SecurityPages.tsx:129](../../apps/web/src/pages/platform/SecurityPages.tsx#L129)、359、408、755、771 行 |
| `SecurityPages.b98b12f3` | 写死 | 换手机：先确认是你本人 | 标题 | [SecurityPages.tsx:129](../../apps/web/src/pages/platform/SecurityPages.tsx#L129) |
| `SecurityPages.da1a26e2` | 写死 | 重新生成恢复码：先确认是你本人 | 标题 | [SecurityPages.tsx:129](../../apps/web/src/pages/platform/SecurityPages.tsx#L129) |
| `SecurityPages.5d9562c5` | 写死 | 输入现在验证器上的动态码（或一个恢复码）。生成以后，旧的一组恢复码全部作废。 | 正文 | [SecurityPages.tsx:132](../../apps/web/src/pages/platform/SecurityPages.tsx#L132) |
| `SecurityPages.7db56596` | 写死 | 输入现在验证器上的动态码（旧手机丢了的话用一个恢复码）。新的验证器绑好之前，旧的照常可用。 | 正文 | [SecurityPages.tsx:132](../../apps/web/src/pages/platform/SecurityPages.tsx#L132) |
| `SecurityPages.ff72c2e6` | 写死 | 恢复码 | 名称 | [SecurityPages.tsx:134](../../apps/web/src/pages/platform/SecurityPages.tsx#L134) |
| `SecurityPages.00d6dc99` | 写死 | 用验证器的动态码 | 按钮 | [SecurityPages.tsx:140](../../apps/web/src/pages/platform/SecurityPages.tsx#L140) |
| `SecurityPages.416c7389` | 写死 | 用恢复码 | 按钮 | [SecurityPages.tsx:140](../../apps/web/src/pages/platform/SecurityPages.tsx#L140) |
| `SecurityPages.046607da` | 写死 | 正在确认… | 文字 | [SecurityPages.tsx:144](../../apps/web/src/pages/platform/SecurityPages.tsx#L144) |
| `SecurityPages.a8dd61bc` | 写死 | 确认 | 按钮 | [SecurityPages.tsx:146](../../apps/web/src/pages/platform/SecurityPages.tsx#L146) |
| `SecurityPages.394852eb` | 写死 | 绑定新的验证器 | 标题 | [SecurityPages.tsx:153](../../apps/web/src/pages/platform/SecurityPages.tsx#L153) |
| `SecurityPages.a46fffc5` | 写死 | 取消（继续用旧的） | 按钮 | [SecurityPages.tsx:153](../../apps/web/src/pages/platform/SecurityPages.tsx#L153) |
| `SecurityPages.cbc4f08b` | 写死 | 新的恢复码 | 标题 | [SecurityPages.tsx:159](../../apps/web/src/pages/platform/SecurityPages.tsx#L159) |
| `SecurityPages.998f6704` | 写死 | 完成 | 名称 | [SecurityPages.tsx:160](../../apps/web/src/pages/platform/SecurityPages.tsx#L160) |
| `SecurityPages.9afa0a43` | 写死 | 两步验证 | 标题 | [SecurityPages.tsx:170](../../apps/web/src/pages/platform/SecurityPages.tsx#L170)、370 行 |
| `SecurityPages.e7b66f05` | 写死 | 运营后台必须开启两步验证：每次登录，除了密码还要输入手机验证器上的动态码。 | 正文 | [SecurityPages.tsx:171](../../apps/web/src/pages/platform/SecurityPages.tsx#L171) |
| `SecurityPages.50da8025` | 写死 | 状态 | 正文 | [SecurityPages.tsx:174](../../apps/web/src/pages/platform/SecurityPages.tsx#L174)、317、373 行 |
| `SecurityPages.3624a962` | 写死 | 已开启 | 名称 | [SecurityPages.tsx:176](../../apps/web/src/pages/platform/SecurityPages.tsx#L176) |
| `SecurityPages.2f7e4cb9` | 写死 | 绑定时间 | 正文 | [SecurityPages.tsx:180](../../apps/web/src/pages/platform/SecurityPages.tsx#L180)、379 行 |
| `SecurityPages.fae43bf1` | 写死 | 剩余恢复码 | 正文 | [SecurityPages.tsx:184](../../apps/web/src/pages/platform/SecurityPages.tsx#L184)、383 行 |
| `SecurityPages.a53101ee` | 写死 | {remaining} 个 | 正文 | [SecurityPages.tsx:185](../../apps/web/src/pages/platform/SecurityPages.tsx#L185) |
| `SecurityPages.608b67fc` | 写死 | 恢复码只剩 {remaining} 个了，建议重新生成一组。 | 提示 | [SecurityPages.tsx:189](../../apps/web/src/pages/platform/SecurityPages.tsx#L189) |
| `SecurityPages.8f211cf8` | 写死 | 恢复码已经用完了。手机丢了的话就只能请超级管理员重置，请现在重新生成一组。 | 提示 | [SecurityPages.tsx:189](../../apps/web/src/pages/platform/SecurityPages.tsx#L189) |
| `SecurityPages.626eb79a` | 写死 | 换手机（重新绑定验证器） | 按钮 | [SecurityPages.tsx:194](../../apps/web/src/pages/platform/SecurityPages.tsx#L194) |
| `SecurityPages.a1c58ff5` | 写死 | 重新生成恢复码 | 按钮 | [SecurityPages.tsx:197](../../apps/web/src/pages/platform/SecurityPages.tsx#L197) |
| `SecurityPages.a45fe961` | 写死 | 手机和恢复码都找不到了：请另一位超级管理员在「平台员工」里重置你的两步验证。不能自己关掉两步验证。 | 正文 | [SecurityPages.tsx:199](../../apps/web/src/pages/platform/SecurityPages.tsx#L199) |
| `SecurityPages.f37475c0` | 写死 | {name}（自建） | 名称 | [SecurityPages.tsx:217](../../apps/web/src/pages/platform/SecurityPages.tsx#L217) |
| `SecurityPages.e375be54` | 写死 | 平台员工 | 浏览器标题 | [SecurityPages.tsx:236](../../apps/web/src/pages/platform/SecurityPages.tsx#L236)、240、241 行 |
| `SecurityPages.292abd2b` | 写死 | 找不到这个员工 | 标题 | [SecurityPages.tsx:248](../../apps/web/src/pages/platform/SecurityPages.tsx#L248) |
| `SecurityPages.2cb90ca6` | 写死 | 他可能已经被删除，或者链接不完整。 | 说明 | [SecurityPages.tsx:248](../../apps/web/src/pages/platform/SecurityPages.tsx#L248) |
| `SecurityPages.660bb8d2` | 写死 | 回到平台员工 | 按钮 | [SecurityPages.tsx:248](../../apps/web/src/pages/platform/SecurityPages.tsx#L248) |
| `SecurityPages.c4939658` | 写死 | 已保存 | 提示 | [SecurityPages.tsx:267](../../apps/web/src/pages/platform/SecurityPages.tsx#L267) |
| `SecurityPages.714a7f78` | 写死 | 这样保存以后，你现在的网络地址（{…}）就不在名单里了，你会马上用不了运营后台。请先把它加进去。 | 文字 | [SecurityPages.tsx:270](../../apps/web/src/pages/platform/SecurityPages.tsx#L270) |
| `SecurityPages.e8605b7d` | 写死 | 他是最后一个在用的超级管理员，不能改成别的角色。请先给另一个人开一个超级管理员账号。 | 文字 | [SecurityPages.tsx:271](../../apps/web/src/pages/platform/SecurityPages.tsx#L271) |
| `SecurityPages.7f03d12c` | 写死 | 不能修改自己的角色，请另一位超级管理员处理。 | 文字 | [SecurityPages.tsx:272](../../apps/web/src/pages/platform/SecurityPages.tsx#L272)、340 行 |
| `SecurityPages.62410c01` | 写死 | 保存 | 文字 | [SecurityPages.tsx:273](../../apps/web/src/pages/platform/SecurityPages.tsx#L273)、362 行 |
| `SecurityPages.0c36587e` | 写死 | 已提交，等另一位超级管理员审核后生效 | 提示 | [SecurityPages.tsx:284](../../apps/web/src/pages/platform/SecurityPages.tsx#L284)、631 行 |
| `SecurityPages.78eadd73` | 写死 | 提交 | 文字 | [SecurityPages.tsx:287](../../apps/web/src/pages/platform/SecurityPages.tsx#L287)、639 行 |
| `SecurityPages.22716a30` | 写死 | 账号 | 标题 | [SecurityPages.tsx:298](../../apps/web/src/pages/platform/SecurityPages.tsx#L298) |
| `SecurityPages.9b28ac21` | 写死 | 邮箱 | 正文 | [SecurityPages.tsx:303](../../apps/web/src/pages/platform/SecurityPages.tsx#L303) |
| `SecurityPages.be84406d` | 写死 | 姓名 | 正文 | [SecurityPages.tsx:307](../../apps/web/src/pages/platform/SecurityPages.tsx#L307)、338 行 |
| `SecurityPages.0a3a52b5` | 写死 | 角色 | 正文 | [SecurityPages.tsx:311](../../apps/web/src/pages/platform/SecurityPages.tsx#L311)、340、344、434、436、477、598、602 行 |
| `SecurityPages.664b2394` | 写死 | IP 白名单 | 正文 | [SecurityPages.tsx:323](../../apps/web/src/pages/platform/SecurityPages.tsx#L323)、349、480、729 行 |
| `SecurityPages.a4f675f1` | 写死 | 按角色的：{…} | 正文 | [SecurityPages.tsx:324](../../apps/web/src/pages/platform/SecurityPages.tsx#L324) |
| `SecurityPages.c8f19079` | 写死 | 不限制 | 正文 | [SecurityPages.tsx:324](../../apps/web/src/pages/platform/SecurityPages.tsx#L324)、742 行 |
| `SecurityPages.65a9bcd7` | 写死 | 修改 | 按钮 | [SecurityPages.tsx:331](../../apps/web/src/pages/platform/SecurityPages.tsx#L331) |
| `SecurityPages.2577a422` | 写死 | 请填写姓名 | 提示 | [SecurityPages.tsx:338](../../apps/web/src/pages/platform/SecurityPages.tsx#L338) |
| `SecurityPages.7c8da5ab` | 写死 | 改了立即生效，不用他重新登录。 | 说明 | [SecurityPages.tsx:344](../../apps/web/src/pages/platform/SecurityPages.tsx#L344) |
| `SecurityPages.e52e332b` | 写死 | 一行一个地址或地址段，如 203.0.113.0/24、2001:db8::/32。留空 = 按他的角色的名单；角色也没有名单就不限制。不在名单里的地址登录不了，已经登录的也会被挡住。 | 正文 | [SecurityPages.tsx:353](../../apps/web/src/pages/platform/SecurityPages.tsx#L353) |
| `SecurityPages.df96ab2f` | 写死 | 保存中… | 文字 | [SecurityPages.tsx:360](../../apps/web/src/pages/platform/SecurityPages.tsx#L360) |
| `SecurityPages.2c93f5c5` | 写死 | 已绑定 | 名称 | [SecurityPages.tsx:374](../../apps/web/src/pages/platform/SecurityPages.tsx#L374) |
| `SecurityPages.7847f08b` | 写死 | 还没绑定 | 名称 | [SecurityPages.tsx:374](../../apps/web/src/pages/platform/SecurityPages.tsx#L374) |
| `SecurityPages.edb00537` | 写死 | {…} 个 | 正文 | [SecurityPages.tsx:384](../../apps/web/src/pages/platform/SecurityPages.tsx#L384) |
| `SecurityPages.94269ab0` | 写死 | 他下次登录时，输完密码会被引导绑定。 | 正文 | [SecurityPages.tsx:389](../../apps/web/src/pages/platform/SecurityPages.tsx#L389) |
| `SecurityPages.3cf5f1f5` | 写死 | 重置两步验证… | 按钮 | [SecurityPages.tsx:394](../../apps/web/src/pages/platform/SecurityPages.tsx#L394) |
| `SecurityPages.bb46f184` | 写死 | 你自己的两步验证在右上角账号菜单的「账号安全」里管理。 | 正文 | [SecurityPages.tsx:397](../../apps/web/src/pages/platform/SecurityPages.tsx#L397) |
| `SecurityPages.84d366ad` | 写死 | 重置「{name}」的两步验证？ | 标题 | [SecurityPages.tsx:401](../../apps/web/src/pages/platform/SecurityPages.tsx#L401) |
| `SecurityPages.4c2dafb5` | 写死 | 提交中… | 文字 | [SecurityPages.tsx:409](../../apps/web/src/pages/platform/SecurityPages.tsx#L409)、757 行 |
| `SecurityPages.7c947520` | 写死 | 提交审核 | 按钮 | [SecurityPages.tsx:411](../../apps/web/src/pages/platform/SecurityPages.tsx#L411) |
| `SecurityPages.01549f12` | 写死 | 」里批准后才生效；生效后他马上退出登录，下次用密码登录时重新绑定。请先当面或电话确认提出要求的就是他本人。 | 正文 | [SecurityPages.tsx:417](../../apps/web/src/pages/platform/SecurityPages.tsx#L417) |
| `SecurityPages.67080546` | 写死 | 在「 | 正文 | [SecurityPages.tsx:417](../../apps/web/src/pages/platform/SecurityPages.tsx#L417) |
| `SecurityPages.92f47b29` | 写死 | 待审核 | 链接 | [SecurityPages.tsx:417](../../apps/web/src/pages/platform/SecurityPages.tsx#L417) |
| `SecurityPages.ea07b125` | 写死 | 用于他换了手机又没有恢复码。要 | 正文 | [SecurityPages.tsx:417](../../apps/web/src/pages/platform/SecurityPages.tsx#L417) |
| `SecurityPages.ff30335c` | 写死 | 另一位超级管理员 | 正文 | [SecurityPages.tsx:417](../../apps/web/src/pages/platform/SecurityPages.tsx#L417) |
| `SecurityPages.139319d2` | 写死 | 说明（选填） | 名称 | [SecurityPages.tsx:419](../../apps/web/src/pages/platform/SecurityPages.tsx#L419)、707 行 |
| `SecurityPages.799e4fee` | 写死 | 写给审核的同事看，如「手机丢了，已电话确认」。 | 说明 | [SecurityPages.tsx:419](../../apps/web/src/pages/platform/SecurityPages.tsx#L419) |
| `SecurityPages.c8de90a4` | 写死 | 角色 · NOZOMI {name} | 浏览器标题 | [SecurityPages.tsx:429](../../apps/web/src/pages/platform/SecurityPages.tsx#L429) |
| `SecurityPages.1ba1ed36` | 写死 | 新建角色 | 按钮 | [SecurityPages.tsx:443](../../apps/web/src/pages/platform/SecurityPages.tsx#L443)、598 行 |
| `SecurityPages.8f540162` | 写死 | 内置 | 正文 | [SecurityPages.tsx:461](../../apps/web/src/pages/platform/SecurityPages.tsx#L461) |
| `SecurityPages.ae14b096` | 写死 | 需求文档定义的岗位，只读模板 | 正文 | [SecurityPages.tsx:463](../../apps/web/src/pages/platform/SecurityPages.tsx#L463) |
| `SecurityPages.3dfda6ba` | 写死 | 有限定 | 正文 | [SecurityPages.tsx:464](../../apps/web/src/pages/platform/SecurityPages.tsx#L464) |
| `SecurityPages.bfcac69e` | 写死 | 不限 | 正文 | [SecurityPages.tsx:464](../../apps/web/src/pages/platform/SecurityPages.tsx#L464)、465、667、674 行 |
| `SecurityPages.66bf9095` | 写死 | {length} 条 | 正文 | [SecurityPages.tsx:465](../../apps/web/src/pages/platform/SecurityPages.tsx#L465) |
| `SecurityPages.c0b96d82` | 写死 | {staff\_count} 人 | 正文 | [SecurityPages.tsx:466](../../apps/web/src/pages/platform/SecurityPages.tsx#L466)、715 行 |
| `SecurityPages.1600d8a6` | 写死 | 内置角色是只读模板：要调整就「复制为新角色」再改。自建角色的修改要另一位超级管理员审核后才生效；新建和删除（没人用时）直接生效。 | 正文 | [SecurityPages.tsx:471](../../apps/web/src/pages/platform/SecurityPages.tsx#L471) |
| `SecurityPages.8081a3ee` | 写死 | 角色列表 | 读屏说明 | [SecurityPages.tsx:473](../../apps/web/src/pages/platform/SecurityPages.tsx#L473) |
| `SecurityPages.4531e0b0` | 写死 | 说明 | 表头 | [SecurityPages.tsx:478](../../apps/web/src/pages/platform/SecurityPages.tsx#L478)、712 行 |
| `SecurityPages.77aa71b5` | 写死 | 数据范围 | 表头 | [SecurityPages.tsx:479](../../apps/web/src/pages/platform/SecurityPages.tsx#L479)、665 行 |
| `SecurityPages.bbba15cf` | 写死 | 员工 | 表头 | [SecurityPages.tsx:481](../../apps/web/src/pages/platform/SecurityPages.tsx#L481) |
| `SecurityPages.5235d3a9` | 写死 | {name}（副本） | 名称 | [SecurityPages.tsx:506](../../apps/web/src/pages/platform/SecurityPages.tsx#L506) |
| `SecurityPages.1e839a49` | 写死 | 菜单 × 操作 | 读屏说明 | [SecurityPages.tsx:531](../../apps/web/src/pages/platform/SecurityPages.tsx#L531) |
| `SecurityPages.1e8a9315` | 写死 | 菜单 | 表头 | [SecurityPages.tsx:535](../../apps/web/src/pages/platform/SecurityPages.tsx#L535) |
| `SecurityPages.6707e835` | 写死 | 只归超级管理员 | 正文 | [SecurityPages.tsx:554](../../apps/web/src/pages/platform/SecurityPages.tsx#L554) |
| `SecurityPages.d1ca532e` | 写死 | 没有 | 正文 | [SecurityPages.tsx:554](../../apps/web/src/pages/platform/SecurityPages.tsx#L554) |
| `SecurityPages.0720a77f` | 写死 | 它可能已经被删除。 | 说明 | [SecurityPages.tsx:608](../../apps/web/src/pages/platform/SecurityPages.tsx#L608) |
| `SecurityPages.5c6cea01` | 写死 | 回到角色 | 按钮 | [SecurityPages.tsx:608](../../apps/web/src/pages/platform/SecurityPages.tsx#L608) |
| `SecurityPages.96d274c9` | 写死 | 找不到这个角色 | 标题 | [SecurityPages.tsx:608](../../apps/web/src/pages/platform/SecurityPages.tsx#L608) |
| `SecurityPages.01585370` | 写死 | 已新建角色「{name}」 | 提示 | [SecurityPages.tsx:627](../../apps/web/src/pages/platform/SecurityPages.tsx#L627) |
| `SecurityPages.16156a01` | 写死 | 已经有同名的角色了，换个名字。 | 文字 | [SecurityPages.tsx:637](../../apps/web/src/pages/platform/SecurityPages.tsx#L637) |
| `SecurityPages.893c4a16` | 写死 | 和现在的角色一样，没有要提交的改动。 | 文字 | [SecurityPages.tsx:638](../../apps/web/src/pages/platform/SecurityPages.tsx#L638) |
| `SecurityPages.45d3aad1` | 写死 | 已删除角色「{name}」 | 提示 | [SecurityPages.tsx:650](../../apps/web/src/pages/platform/SecurityPages.tsx#L650) |
| `SecurityPages.02718279` | 写死 | 还有 {…} 个账号在用这个角色，先在「平台员工」里把他们改成别的角色再删。 | 文字 | [SecurityPages.tsx:655](../../apps/web/src/pages/platform/SecurityPages.tsx#L655) |
| `SecurityPages.3b928e46` | 写死 | 删除 | 文字 | [SecurityPages.tsx:655](../../apps/web/src/pages/platform/SecurityPages.tsx#L655)、774 行 |
| `SecurityPages.9827226a` | 写死 | 限定之后，这个角色只看得到选中的城市、渠道的数据：城市管订单；渠道管渠道和它下面的一切、订单、渠道类的待审核、按渠道试算。限定了渠道的人不能新建渠道。 | 正文 | [SecurityPages.tsx:666](../../apps/web/src/pages/platform/SecurityPages.tsx#L666) |
| `SecurityPages.5e1813d2` | 写死 | 只看选中的城市 | 名称 | [SecurityPages.tsx:667](../../apps/web/src/pages/platform/SecurityPages.tsx#L667) |
| `SecurityPages.c90deb20` | 写死 | 城市 | 标题 | [SecurityPages.tsx:667](../../apps/web/src/pages/platform/SecurityPages.tsx#L667)、670 行 |
| `SecurityPages.4778b649` | 写死 | 输入城市名称或编码查找 | 输入框占位 | [SecurityPages.tsx:670](../../apps/web/src/pages/platform/SecurityPages.tsx#L670) |
| `SecurityPages.e0c6e035` | 写死 | 可选的城市都已经选上了 | 文字 | [SecurityPages.tsx:670](../../apps/web/src/pages/platform/SecurityPages.tsx#L670) |
| `SecurityPages.252427d2` | 写死 | 一个都不看 | 正文 | [SecurityPages.tsx:672](../../apps/web/src/pages/platform/SecurityPages.tsx#L672)、679 行 |
| `SecurityPages.d11d42d1` | 写死 | 选中的城市 | 名称 | [SecurityPages.tsx:672](../../apps/web/src/pages/platform/SecurityPages.tsx#L672) |
| `SecurityPages.8d11dab3` | 写死 | 渠道 | 标题 | [SecurityPages.tsx:674](../../apps/web/src/pages/platform/SecurityPages.tsx#L674)、677 行 |
| `SecurityPages.983f4b24` | 写死 | 只看选中的渠道 | 名称 | [SecurityPages.tsx:674](../../apps/web/src/pages/platform/SecurityPages.tsx#L674) |
| `SecurityPages.201296cd` | 写死 | 输入渠道名称查找 | 输入框占位 | [SecurityPages.tsx:677](../../apps/web/src/pages/platform/SecurityPages.tsx#L677) |
| `SecurityPages.301a19f9` | 写死 | 选中的渠道 | 名称 | [SecurityPages.tsx:679](../../apps/web/src/pages/platform/SecurityPages.tsx#L679) |
| `SecurityPages.bc47ce3d` | 写死 | 这是内置角色，只读。 | 正文 | [SecurityPages.tsx:689](../../apps/web/src/pages/platform/SecurityPages.tsx#L689) |
| `SecurityPages.78bc92b6` | 写死 | 要调整权限，复制它新建一个角色再改，然后把员工改成新角色。 | 正文 | [SecurityPages.tsx:690](../../apps/web/src/pages/platform/SecurityPages.tsx#L690) |
| `SecurityPages.0ed0770f` | 写死 | 复制为新角色 | 链接 | [SecurityPages.tsx:695](../../apps/web/src/pages/platform/SecurityPages.tsx#L695) |
| `SecurityPages.5584fb25` | 写死 | 基本信息 | 标题 | [SecurityPages.tsx:703](../../apps/web/src/pages/platform/SecurityPages.tsx#L703) |
| `SecurityPages.6b203d6c` | 写死 | 名字 | 名称 | [SecurityPages.tsx:706](../../apps/web/src/pages/platform/SecurityPages.tsx#L706)、711 行 |
| `SecurityPages.834ba594` | 写死 | 请填写名字 | 提示 | [SecurityPages.tsx:706](../../apps/web/src/pages/platform/SecurityPages.tsx#L706) |
| `SecurityPages.06b6d71a` | 写死 | 需求文档定义的岗位 | 正文 | [SecurityPages.tsx:712](../../apps/web/src/pages/platform/SecurityPages.tsx#L712) |
| `SecurityPages.82cca910` | 写死 | 用这个角色的员工 | 名称 | [SecurityPages.tsx:715](../../apps/web/src/pages/platform/SecurityPages.tsx#L715) |
| `SecurityPages.788436ea` | 写死 | 权限（菜单 × 操作） | 标题 | [SecurityPages.tsx:719](../../apps/web/src/pages/platform/SecurityPages.tsx#L719) |
| `SecurityPages.d80bb195` | 写死 | 勾编辑、审核会自动带上查看。平台账号的编辑、角色的编辑和审核、系统状态的编辑（第三方密钥）、官网设置的编辑（客服 WhatsApp 号码）只归超级管理员，自建角色勾不了。「导出」还没有对应的功能。 | 正文 | [SecurityPages.tsx:721](../../apps/web/src/pages/platform/SecurityPages.tsx#L721) |
| `SecurityPages.642e4043` | 写死 | 允许的地址 | 表单标签 | [SecurityPages.tsx:734](../../apps/web/src/pages/platform/SecurityPages.tsx#L734)、742 行 |
| `SecurityPages.723cdd6e` | 写死 | 一行一个，如 203.0.113.0/24。留空 = 不限制。员工自己设了名单的，按员工自己的。 | 正文 | [SecurityPages.tsx:738](../../apps/web/src/pages/platform/SecurityPages.tsx#L738) |
| `SecurityPages.d1ffa392` | 写死 | 给审核同事的说明（选填） | 名称 | [SecurityPages.tsx:746](../../apps/web/src/pages/platform/SecurityPages.tsx#L746) |
| `SecurityPages.f1fe49c2` | 写死 | 修改要另一位超级管理员审核后才生效。 | 说明 | [SecurityPages.tsx:746](../../apps/web/src/pages/platform/SecurityPages.tsx#L746) |
| `SecurityPages.1a673714` | 写死 | 删除角色 | 按钮 | [SecurityPages.tsx:752](../../apps/web/src/pages/platform/SecurityPages.tsx#L752) |
| `SecurityPages.5f1000bd` | 写死 | 撤销改动 | 按钮 | [SecurityPages.tsx:755](../../apps/web/src/pages/platform/SecurityPages.tsx#L755) |
| `SecurityPages.82f17a9c` | 写死 | 提交修改（需审核） | 按钮 | [SecurityPages.tsx:758](../../apps/web/src/pages/platform/SecurityPages.tsx#L758) |
| `SecurityPages.f9902506` | 写死 | 新建 | 按钮 | [SecurityPages.tsx:758](../../apps/web/src/pages/platform/SecurityPages.tsx#L758) |
| `SecurityPages.0e277765` | 写死 | 删除角色「{…}」？ | 标题 | [SecurityPages.tsx:764](../../apps/web/src/pages/platform/SecurityPages.tsx#L764) |
| `SecurityPages.4de311ad` | 写死 | 删除中… | 文字 | [SecurityPages.tsx:772](../../apps/web/src/pages/platform/SecurityPages.tsx#L772) |
| `SecurityPages.3cfbdac5` | 写死 | 只有没有任何账号（包括待激活、已停用的）在用它时才能删。删了不能恢复，操作会记在审计日志里。 | 正文 | [SecurityPages.tsx:778](../../apps/web/src/pages/platform/SecurityPages.tsx#L778) |

## 系统设置（审计日志、系统状态）

文件：`apps/web/src/lib/secret-form.ts`、`apps/web/src/pages/platform/AiTripModelCard.tsx`、`apps/web/src/pages/platform/IntegrationSecretsSection.tsx`、`apps/web/src/pages/platform/SettingsPages.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `secret-form.9767131a` | 写死 | 在谷歌云控制台「API 和服务 → 凭据」里复制，通常以 AIza 开头。 | 文字 | [secret-form.ts:13](../../apps/web/src/lib/secret-form.ts#L13) |
| `secret-form.7f14f7fe` | 写死 | 测试环境以 sk\_test\_ 开头（正式环境是 sk\_live\_）。在 Stripe 控制台「开发者 → API 密钥」里复制。 | 文字 | [secret-form.ts:14](../../apps/web/src/lib/secret-form.ts#L14) |
| `secret-form.b60e3aa7` | 写死 | 测试环境以 pk\_test\_ 开头（正式环境是 pk\_live\_），和 Secret key 在同一页。 | 文字 | [secret-form.ts:15](../../apps/web/src/lib/secret-form.ts#L15) |
| `secret-form.87c16e90` | 写死 | 以 whsec\_ 开头。在 Stripe 控制台「开发者 → Webhooks」里，点开给 NOZOMI 设的那个端点，复制「签名密钥」。 | 文字 | [secret-form.ts:16](../../apps/web/src/lib/secret-form.ts#L16) |
| `secret-form.d5c2830e` | 写死 | 发信服务器的地址，例如 smtp.example.com。一般在邮件服务商的 SMTP 设置页能找到。 | 文字 | [secret-form.ts:17](../../apps/web/src/lib/secret-form.ts#L17) |
| `secret-form.face6c8a` | 写死 | 一般和主机写在同一页。只能填 25、465、587、2525，常用 465 或 587；云服务器常常封了 25，不建议用。 | 文字 | [secret-form.ts:18](../../apps/web/src/lib/secret-form.ts#L18) |
| `secret-form.a69380ad` | 写死 | 发信时怎么加密，要和端口相配：465 选 TLS，587 选 STARTTLS。服务商写的是 SSL 时，选 TLS。 | 文字 | [secret-form.ts:19](../../apps/web/src/lib/secret-form.ts#L19) |
| `secret-form.dc25c2e5` | 写死 | 登录邮件服务器用的账号，通常是完整的邮箱地址，也可能是服务商给的一串字符。 | 名称 | [secret-form.ts:20](../../apps/web/src/lib/secret-form.ts#L20) |
| `secret-form.49e1749d` | 写死 | 不一定是邮箱的登录密码：很多服务商要用「应用专用密码」或「SMTP 密钥」，在服务商的设置页生成。至少 8 个字符。 | 文字 | [secret-form.ts:21](../../apps/web/src/lib/secret-form.ts#L21) |
| `secret-form.50aabc90` | 写死 | 收件人看到的发件人名字，例如「NOZOMI 用车」。 | 名称 | [secret-form.ts:22](../../apps/web/src/lib/secret-form.ts#L22) |
| `secret-form.194a1915` | 写死 | 收件人看到的发件地址，例如 noreply@example.com。要是这个账号有权使用的地址，否则邮件服务器会拒收。 | 文字 | [secret-form.ts:23](../../apps/web/src/lib/secret-form.ts#L23) |
| `secret-form.9f6c5c1a` | 写死 | 开头不对：Secret key 以 sk\_test\_ 开头（正式环境是 sk\_live\_）。请确认没有复制成别的那一项。 | 文字 | [secret-form.ts:27](../../apps/web/src/lib/secret-form.ts#L27) |
| `secret-form.da0bf424` | 写死 | 开头不对：Publishable key 以 pk\_test\_ 开头（正式环境是 pk\_live\_）。请确认没有复制成别的那一项。 | 文字 | [secret-form.ts:28](../../apps/web/src/lib/secret-form.ts#L28) |
| `secret-form.c157704a` | 写死 | 开头不对：Webhook signing secret 以 whsec\_ 开头。请确认没有复制成别的那一项。 | 文字 | [secret-form.ts:29](../../apps/web/src/lib/secret-form.ts#L29) |
| `secret-form.8ded88bd` | 写死 | 连不上邮件服务器。请检查主机和端口有没有填错；云服务器常常封了 25 端口，可以换 465 或 587。 | 文字 | [secret-form.ts:34](../../apps/web/src/lib/secret-form.ts#L34) |
| `secret-form.f1f560d3` | 写死 | 和邮件服务器建立加密连接失败。请检查加密方式和端口是否相配（465 配 TLS、587 配 STARTTLS）；都对的话，可能是服务器的证书有问题，请联系邮件服务商。 | 提示 | [secret-form.ts:35](../../apps/web/src/lib/secret-form.ts#L35) |
| `secret-form.d8c27bd8` | 写死 | 邮件服务器不接受这组用户名和密码。请重新填写；很多邮箱要用「应用专用密码」或 SMTP 专用密码，不是登录密码。 | 提示 | [secret-form.ts:36](../../apps/web/src/lib/secret-form.ts#L36) |
| `secret-form.c008fc1f` | 写死 | 邮件服务器拒绝了发件人地址。请确认这个账号可以用这个发件人地址发信，或换成在邮件服务商那里验证过的地址。 | 文字 | [secret-form.ts:37](../../apps/web/src/lib/secret-form.ts#L37) |
| `secret-form.8ce60e62` | 写死 | 邮件服务器拒绝了收件人（你的登录邮箱）。请确认这个邮箱能正常收信；有的试用账号只能发给验证过的地址，可以到邮件服务商那里添加它。 | 文字 | [secret-form.ts:38](../../apps/web/src/lib/secret-form.ts#L38) |
| `secret-form.f46bafab` | 写死 | 邮件服务器拒绝了这封邮件，分不清是发件人还是收件人的问题。请先确认这个账号可以用这个发件人地址发信，或换成在邮件服务商那里验证过的地址；再确认你的登录邮箱能正常收信。 | 提示 | [secret-form.ts:39](../../apps/web/src/lib/secret-form.ts#L39) |
| `secret-form.0102b6f0` | 写死 | 邮件服务器暂时不接收这封邮件（可能是限流或对方暂时不可用），配置不一定有问题。请过几分钟再试；一直这样请联系邮件服务商。 | 文字 | [secret-form.ts:40](../../apps/web/src/lib/secret-form.ts#L40) |
| `secret-form.872c4227` | 写死 | 主机是内网地址，或解析到了内网地址，不允许连接。请填写邮件服务商给的公网主机名。 | 文字 | [secret-form.ts:41](../../apps/web/src/lib/secret-form.ts#L41) |
| `secret-form.24f0b0ef` | 写死 | 邮件服务器在 15 秒内没有完成。请检查主机和端口，以及加密方式和端口是否相配（465 配 TLS、587 配 STARTTLS）；都对的话，过一会儿再试。 | 文字 | [secret-form.ts:42](../../apps/web/src/lib/secret-form.ts#L42) |
| `secret-form.92ebcf5b` | 写死 | 邮件服务器的应答看不懂。请确认主机和端口填的是 SMTP 服务。 | 文字 | [secret-form.ts:43](../../apps/web/src/lib/secret-form.ts#L43) |
| `secret-form.fd7d68e8` | 写死 | 你的登录邮箱不能用来收这封测试邮件（地址的写法不被接受），所以没有发出。请换一个超级管理员账号来测试，或联系技术人员。 | 提示 | [secret-form.ts:44](../../apps/web/src/lib/secret-form.ts#L44) |
| `secret-form.b30bf58d` | 写死 | 请填写这一项（七项要一起填） | 文字 | [secret-form.ts:54](../../apps/web/src/lib/secret-form.ts#L54) |
| `secret-form.e49aef68` | 写死 | 请重新填写密码（每次保存都要填） | 文字 | [secret-form.ts:54](../../apps/web/src/lib/secret-form.ts#L54) |
| `secret-form.381f3403` | 写死 | 端口是一个数字，例如 465 | 文字 | [secret-form.ts:57](../../apps/web/src/lib/secret-form.ts#L57) |
| `secret-form.7a169c43` | 写死 | 密码至少 {PASSWORD\_MIN\_LENGTH} 个字符 | 文字 | [secret-form.ts:59](../../apps/web/src/lib/secret-form.ts#L59) |
| `secret-form.fcec3366` | 写死 | 这不是一个邮箱地址，例如 noreply@example.com | 文字 | [secret-form.ts:61](../../apps/web/src/lib/secret-form.ts#L61) |
| `secret-form.878d8d95` | 写死 | 请粘贴密钥 | 文字 | [secret-form.ts:74](../../apps/web/src/lib/secret-form.ts#L74) |
| `secret-form.e054e946` | 写死 | 请粘贴这一项（Stripe 的三项要一起填） | 文字 | [secret-form.ts:74](../../apps/web/src/lib/secret-form.ts#L74) |
| `secret-form.98e7533c` | 写死 | Secret key 和 Publishable key 要同为测试（test）或同为正式（live） | 文字 | [secret-form.ts:83](../../apps/web/src/lib/secret-form.ts#L83) |
| `secret-form.829419e7` | 写死 | 这一项不符合要求，请检查是否复制完整 | 文字 | [secret-form.ts:102](../../apps/web/src/lib/secret-form.ts#L102) |
| `AiTripModelCard.820edb86` | 写死 | 测试集准确率和 Haiku 一样（99.6%），慢约 1 秒。一次约 ¥0.4。客人反馈填错多时可以切到这一项。 | 说明 | [AiTripModelCard.tsx:19](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L19) |
| `AiTripModelCard.c2f98533` | 写死 | 最便宜、最快，一次约 ¥0.03；出错时不重试，直接让客人手填。 | 说明 | [AiTripModelCard.tsx:20](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L20) |
| `AiTripModelCard.25b6aea8` | 写死 | 先 Haiku，出错再用 Sonnet（默认，推荐） | 名称 | [AiTripModelCard.tsx:21](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L21) |
| `AiTripModelCard.f4d0ac18` | 写死 | 多数时候是 Haiku 的价钱；Haiku 超时、出错、拒答时自动改用 Sonnet 重试一次。理解错了但格式对的情况它发现不了，靠客人在表单上看、改。 | 说明 | [AiTripModelCard.tsx:21](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L21) |
| `AiTripModelCard.c962439a` | 写死 | （其中改用 Sonnet 重试 {sonnet\_retries} 次） | 文字 | [AiTripModelCard.tsx:28](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L28) |
| `AiTripModelCard.0b1f66fd` | 写死 | 今天（东京时间 {date}）：Sonnet {sonnet} 次{retries} · Haiku {haiku} 次 · 全站已用 {used} / {limit} 次 | 文字 | [AiTripModelCard.tsx:29](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L29) |
| `AiTripModelCard.f3c3a5b9` | 写死 | AI 行程解析改为「{…}」，下一次解析起生效 | 提示 | [AiTripModelCard.tsx:52](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L52) |
| `AiTripModelCard.33c63c9b` | 写死 | 别人刚改过这里，已经换成最新的设置，请再确认一次。 | 错误提示 | [AiTripModelCard.tsx:56](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L56) |
| `AiTripModelCard.bb8ceaa3` | 写死 | 保存 | 文字 | [AiTripModelCard.tsx:59](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L59)、88 行 |
| `AiTripModelCard.57bb0db8` | 写死 | 使用的型号加载中 | 名称 | [AiTripModelCard.tsx:69](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L69) |
| `AiTripModelCard.a74fa016` | 写死 | 你没有权限查看使用的型号 | 标题 | [AiTripModelCard.tsx:71](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L71) |
| `AiTripModelCard.573a2401` | 写死 | 使用的型号加载失败 | 标题 | [AiTripModelCard.tsx:73](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L73) |
| `AiTripModelCard.6068d610` | 写死 | 重试 | 按钮 | [AiTripModelCard.tsx:73](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L73) |
| `AiTripModelCard.94e05b2b` | 写死 | 请检查网络后重试。 | 说明 | [AiTripModelCard.tsx:73](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L73) |
| `AiTripModelCard.0aa8d195` | 写死 | 保存后下一次解析起生效，不用重新部署。价格只由报价引擎算，和型号无关。 | 说明 | [AiTripModelCard.tsx:78](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L78) |
| `AiTripModelCard.484aaac5` | 写死 | AI 行程解析用哪个 Claude 型号 | 标题 | [AiTripModelCard.tsx:78](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L78) |
| `AiTripModelCard.9b2a55c2` | 写死 | 保存中… | 文字 | [AiTripModelCard.tsx:86](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L86) |
| `AiTripModelCard.9efd0b3f` | 写死 | Claude（AI 行程解析）· 使用的型号 | 标题 | [AiTripModelCard.tsx:100](../../apps/web/src/pages/platform/AiTripModelCard.tsx#L100) |
| `IntegrationSecretsSection.f07e6262` | 写死 | 服务器还没有配置数据加密密钥，现在不能在后台填写密钥。请联系技术人员在服务器上配置好以后再来填写。 | 文字 | [IntegrationSecretsSection.tsx:28](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L28) |
| `IntegrationSecretsSection.30cf8ca7` | 写死 | 只有超级管理员可以填写、更换、清空和测试密钥。需要的话，请联系超级管理员。 | 文字 | [IntegrationSecretsSection.tsx:29](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L29) |
| `IntegrationSecretsSection.869e8fbd` | 写死 | 「测试一下」会真的调用一次谷歌地图（查一条东京站到新宿站的路线），每次产生极少量费用，通常在谷歌每月的免费额度内。 | 文字 | [IntegrationSecretsSection.tsx:33](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L33) |
| `IntegrationSecretsSection.f46040b8` | 写死 | 「测试一下」只查一次账户余额，不收钱、不产生费用，也不改任何数据。 | 文字 | [IntegrationSecretsSection.tsx:34](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L34) |
| `IntegrationSecretsSection.4827da96` | 写死 | 「测试一下」会发一封测试邮件到你自己的登录邮箱，不能发给别人。邮件服务器接收以后，请去邮箱确认，也看看垃圾邮件。 | 文字 | [IntegrationSecretsSection.tsx:35](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L35) |
| `IntegrationSecretsSection.dc102836` | 写死 | 「测试一下」只查一次 Claude 的模型列表，不让 AI 生成任何内容，不产生费用。 | 文字 | [IntegrationSecretsSection.tsx:36](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L36) |
| `IntegrationSecretsSection.89c4d8fb` | 写死 | 密钥 | 文字 | [IntegrationSecretsSection.tsx:40](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L40)、237 行 |
| `IntegrationSecretsSection.c8d16eba` | 写死 | 设置 | 文字 | [IntegrationSecretsSection.tsx:40](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L40) |
| `IntegrationSecretsSection.4989e65e` | 写死 | 服务器配置文件里也有这一项，清空后马上改用那里的值。 | 文字 | [IntegrationSecretsSection.tsx:44](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L44) |
| `IntegrationSecretsSection.f0c242bf` | 写死 | 服务器配置文件里没有这一项，清空后邮件发送就是「未配置」，系统发不了邮件，直到重新填写。 | 文字 | [IntegrationSecretsSection.tsx:45](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L45) |
| `IntegrationSecretsSection.2263e234` | 写死 | 服务器配置文件里没有这一项，清空后 Claude 就是「未配置」，AI 行程解析会停下来（客人照常手填行程），直到重新填写。 | 文字 | [IntegrationSecretsSection.tsx:46](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L46) |
| `IntegrationSecretsSection.7c0462d8` | 写死 | 服务器配置文件里没有这一项，清空后谷歌地图就是「未配置」，用到它的功能会停下来，直到重新填写。 | 文字 | [IntegrationSecretsSection.tsx:47](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L47) |
| `IntegrationSecretsSection.f98ca981` | 写死 | 服务器配置文件里没有这一项，清空后 Stripe 支付就是「未配置」，客人将不能在线付款，直到重新填写。 | 文字 | [IntegrationSecretsSection.tsx:47](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L47) |
| `IntegrationSecretsSection.1c3b40a9` | 写死 | 正式密钥 | 文字 | [IntegrationSecretsSection.tsx:54](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L54) |
| `IntegrationSecretsSection.65d95025` | 写死 | 测试密钥 | 文字 | [IntegrationSecretsSection.tsx:54](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L54) |
| `IntegrationSecretsSection.2b219441` | 写死 | 后台填写的那一份读不出来（服务器的数据加密密钥可能换过），现在没有用它。请重新填写一次。 | 文字 | [IntegrationSecretsSection.tsx:58](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L58) |
| `IntegrationSecretsSection.0352b2f7` | 写死 | 后台填写的那一份不能在这个环境用（例如测试密钥到了正式环境），现在没有用它。请换成这个环境能用的密钥。 | 文字 | [IntegrationSecretsSection.tsx:59](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L59) |
| `IntegrationSecretsSection.203214c9` | 写死 | 后台填写的那一份不能在这个环境用（不加密发信，或主机是内网地址），现在没有用它。请重新填写。 | 文字 | [IntegrationSecretsSection.tsx:63](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L63) |
| `IntegrationSecretsSection.ad48a2b0` | 写死 | 不加密 | 文字 | [IntegrationSecretsSection.tsx:69](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L69) |
| `IntegrationSecretsSection.d2efbd14` | 写死 | TLS（推荐，常用端口 465） | 名称 | [IntegrationSecretsSection.tsx:74](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L74) |
| `IntegrationSecretsSection.0aeaac05` | 写死 | STARTTLS（常用端口 587） | 名称 | [IntegrationSecretsSection.tsx:75](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L75) |
| `IntegrationSecretsSection.45733f83` | 写死 | 不加密（只能用于本机调试） | 名称 | [IntegrationSecretsSection.tsx:76](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L76) |
| `IntegrationSecretsSection.75fb75e7` | 写死 | 没有填写 | 文字 | [IntegrationSecretsSection.tsx:88](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L88) |
| `IntegrationSecretsSection.6870f821` | 写死 | 已填写（{who}，{at}） | 文字 | [IntegrationSecretsSection.tsx:91](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L91) |
| `IntegrationSecretsSection.896a7a92` | 写死 | 测的是{source\_label}里的那一份。 | 文字 | [IntegrationSecretsSection.tsx:96](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L96) |
| `IntegrationSecretsSection.0581eb6a` | 写死 | 这一项现在没有配置，先填写{…}再测试。 | 提示 | [IntegrationSecretsSection.tsx:105](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L105) |
| `IntegrationSecretsSection.6d5a4138` | 写死 | 刚测过，请过几秒再试。 | 提示 | [IntegrationSecretsSection.tsx:107](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L107) |
| `IntegrationSecretsSection.ca5e8086` | 写死 | 没有等到测试结果（网络不通或对方太慢）。请检查网络后再点一次「测试一下」。 | 提示 | [IntegrationSecretsSection.tsx:109](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L109) |
| `IntegrationSecretsSection.60156c46` | 写死 | 测试 | 文字 | [IntegrationSecretsSection.tsx:110](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L110) |
| `IntegrationSecretsSection.48cce904` | 写死 | 填写 | 文字 | [IntegrationSecretsSection.tsx:131](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L131)、417、534 行 |
| `IntegrationSecretsSection.adb6fc87` | 写死 | 更换 | 文字 | [IntegrationSecretsSection.tsx:131](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L131)、417、534 行 |
| `IntegrationSecretsSection.a1be2727` | 写死 | 请按每一项下面的说明改好后再保存。 | 文字 | [IntegrationSecretsSection.tsx:167](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L167) |
| `IntegrationSecretsSection.e5ce671b` | 写死 | 有几项需要修改 | 标题 | [IntegrationSecretsSection.tsx:167](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L167) |
| `IntegrationSecretsSection.31f4248a` | 写死 | 现在不能在后台填写 | 标题 | [IntegrationSecretsSection.tsx:170](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L170)、494 行 |
| `IntegrationSecretsSection.9c141177` | 写死 | 没有保存 | 标题 | [IntegrationSecretsSection.tsx:173](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L173)、175 行 |
| `IntegrationSecretsSection.5192a459` | 写死 | 保存 | 文字 | [IntegrationSecretsSection.tsx:175](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L175)、197 行 |
| `IntegrationSecretsSection.ffd55698` | 写死 | {verb}「{label}」的{…} | 标题 | [IntegrationSecretsSection.tsx:186](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L186) |
| `IntegrationSecretsSection.d3da327c` | 写死 | 取消 | 按钮 | [IntegrationSecretsSection.tsx:194](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L194)、300 行 |
| `IntegrationSecretsSection.be8057aa` | 写死 | 保存中… | 文字 | [IntegrationSecretsSection.tsx:195](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L195) |
| `IntegrationSecretsSection.9bb0bd61` | 写死 | 七项要一起填，一般都在邮件服务商的 SMTP 设置页能找到。 | 正文 | [IntegrationSecretsSection.tsx:211](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L211) |
| `IntegrationSecretsSection.ba558d2e` | 写死 | 从谷歌云控制台复制密钥后粘贴到下面。 | 正文 | [IntegrationSecretsSection.tsx:211](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L211) |
| `IntegrationSecretsSection.fd481981` | 写死 | Stripe 的三项要一起填。从 Stripe 控制台复制后粘贴到下面。 | 正文 | [IntegrationSecretsSection.tsx:211](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L211) |
| `IntegrationSecretsSection.4299c0c7` | 写死 | 保存后马上生效，不用重启。 | 正文 | [IntegrationSecretsSection.tsx:212](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L212) |
| `IntegrationSecretsSection.dbfb4b9b` | 写死 | 保存后马上改用新的，原来在后台填写的那一份不再使用。 | 正文 | [IntegrationSecretsSection.tsx:212](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L212) |
| `IntegrationSecretsSection.fd707c5d` | 写死 | 每次保存都要重新填密码 | 正文 | [IntegrationSecretsSection.tsx:216](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L216) |
| `IntegrationSecretsSection.c16ef49f` | 写死 | 不能留空沿用旧密码：这样就算有人改了主机，旧密码也不会被发到别的服务器。 | 正文 | [IntegrationSecretsSection.tsx:217](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L217) |
| `IntegrationSecretsSection.4a499f58` | 写死 | 密钥会加密保存。保存后页面上只显示末 4 位，任何地方都看不到完整的密钥。 | 正文 | [IntegrationSecretsSection.tsx:260](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L260) |
| `IntegrationSecretsSection.50872191` | 写死 | 全部加密保存。保存后页面上最多只显示密码的末 4 位，任何地方都看不到完整的密码。 | 正文 | [IntegrationSecretsSection.tsx:260](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L260) |
| `IntegrationSecretsSection.0bf4ef58` | 写死 | 后台已经没有填写这一项了（可能刚被别人清空），不用再清空。关掉后页面会显示最新的情况。 | 文字 | [IntegrationSecretsSection.tsx:282](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L282) |
| `IntegrationSecretsSection.c44077f8` | 写死 | 清空 | 文字 | [IntegrationSecretsSection.tsx:284](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L284)、305、427 行 |
| `IntegrationSecretsSection.6b382558` | 写死 | 清空「{label}」在后台填写的{…}？ | 标题 | [IntegrationSecretsSection.tsx:293](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L293) |
| `IntegrationSecretsSection.63518509` | 写死 | 知道了 | 按钮 | [IntegrationSecretsSection.tsx:300](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L300) |
| `IntegrationSecretsSection.50dc8605` | 写死 | 清空中… | 文字 | [IntegrationSecretsSection.tsx:303](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L303) |
| `IntegrationSecretsSection.5536a517` | 写死 | 没有清空 | 正文 | [IntegrationSecretsSection.tsx:313](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L313) |
| `IntegrationSecretsSection.cfdb889d` | 写死 | 清空后改用服务器配置文件里的值（如果有）。 | 正文 | [IntegrationSecretsSection.tsx:320](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L320) |
| `IntegrationSecretsSection.f00e0b9c` | 写死 | 以后随时可以重新填写。 | 正文 | [IntegrationSecretsSection.tsx:323](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L323) |
| `IntegrationSecretsSection.2c2922a4` | 写死 | 已配置 | 名称 | [IntegrationSecretsSection.tsx:374](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L374) |
| `IntegrationSecretsSection.69d2f597` | 写死 | 未配置 | 名称 | [IntegrationSecretsSection.tsx:374](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L374) |
| `IntegrationSecretsSection.a05f87e6` | 写死 | 现在用的 | 正文 | [IntegrationSecretsSection.tsx:378](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L378) |
| `IntegrationSecretsSection.a5163ceb` | 写死 | 邮件服务器 | 正文 | [IntegrationSecretsSection.tsx:384](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L384) |
| `IntegrationSecretsSection.9cb1ea9b` | 写死 | 加密方式 | 正文 | [IntegrationSecretsSection.tsx:388](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L388) |
| `IntegrationSecretsSection.8c3c5966` | 写死 | 发件人 | 正文 | [IntegrationSecretsSection.tsx:392](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L392) |
| `IntegrationSecretsSection.e2392330` | 写死 | 后台填写的 | 正文 | [IntegrationSecretsSection.tsx:399](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L399) |
| `IntegrationSecretsSection.80e1981b` | 写死 | 服务器配置文件里 | 正文 | [IntegrationSecretsSection.tsx:404](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L404) |
| `IntegrationSecretsSection.0659c334` | 写死 | 没有 | 正文 | [IntegrationSecretsSection.tsx:405](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L405) |
| `IntegrationSecretsSection.254a3222` | 写死 | 有 | 正文 | [IntegrationSecretsSection.tsx:405](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L405) |
| `IntegrationSecretsSection.9490cb1a` | 写死 | 测试中… | 文字 | [IntegrationSecretsSection.tsx:420](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L420) |
| `IntegrationSecretsSection.db3ab89a` | 写死 | 测试一下 | 按钮 | [IntegrationSecretsSection.tsx:422](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L422) |
| `IntegrationSecretsSection.7208a616` | 写死 | 不可用 | 名称 | [IntegrationSecretsSection.tsx:434](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L434) |
| `IntegrationSecretsSection.d1ed647c` | 写死 | 可用 | 名称 | [IntegrationSecretsSection.tsx:434](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L434) |
| `IntegrationSecretsSection.6ecc4d48` | 写死 | 测试时间 {…} | 正文 | [IntegrationSecretsSection.tsx:436](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L436) |
| `IntegrationSecretsSection.11fff960` | 写死 | 没有测试成功 | 正文 | [IntegrationSecretsSection.tsx:441](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L441) |
| `IntegrationSecretsSection.1585da80` | 写死 | 第三方密钥加载中 | 名称 | [IntegrationSecretsSection.tsx:480](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L480) |
| `IntegrationSecretsSection.40f030de` | 写死 | 你没有权限查看第三方密钥 | 标题 | [IntegrationSecretsSection.tsx:482](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L482) |
| `IntegrationSecretsSection.a5f5a388` | 写死 | 需要的话，请联系超级管理员。 | 说明 | [IntegrationSecretsSection.tsx:482](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L482) |
| `IntegrationSecretsSection.02d5dcb8` | 写死 | 请检查网络后重试。 | 说明 | [IntegrationSecretsSection.tsx:484](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L484) |
| `IntegrationSecretsSection.6e066577` | 写死 | 第三方密钥加载失败 | 标题 | [IntegrationSecretsSection.tsx:484](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L484) |
| `IntegrationSecretsSection.fab976d5` | 写死 | 重试 | 按钮 | [IntegrationSecretsSection.tsx:484](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L484) |
| `IntegrationSecretsSection.c08599b5` | 写死 | 没有可以在后台填写的密钥 | 标题 | [IntegrationSecretsSection.tsx:487](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L487) |
| `IntegrationSecretsSection.a5f65e82` | 写死 | 第三方密钥 | 标题 | [IntegrationSecretsSection.tsx:516](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L516) |
| `IntegrationSecretsSection.227da7ed` | 写死 | {…} 谷歌地图、Stripe 支付的密钥和邮件发送的设置可以在这里直接填写，保存后马上生效，不用重启。密钥和密码在页面上最多只显示末 4 位。 | 正文 | [IntegrationSecretsSection.tsx:518](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L518) |
| `IntegrationSecretsSection.97e14b74` | 写死 | 哪一份生效：{precedence\_note} | 正文 | [IntegrationSecretsSection.tsx:520](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L520) |
| `IntegrationSecretsSection.0fa20fa3` | 写死 | 已{…}「{label}」的{…} | 提示 | [IntegrationSecretsSection.tsx:534](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L534) |
| `IntegrationSecretsSection.15db8c8c` | 写死 | 已清空「{label}」在后台填写的{…} | 提示 | [IntegrationSecretsSection.tsx:550](../../apps/web/src/pages/platform/IntegrationSecretsSection.tsx#L550) |
| `SettingsPages.a9c462ad` | 写死 | 你没有权限查看这里 | 标题 | [SettingsPages.tsx:37](../../apps/web/src/pages/platform/SettingsPages.tsx#L37) |
| `SettingsPages.ae1431eb` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [SettingsPages.tsx:37](../../apps/web/src/pages/platform/SettingsPages.tsx#L37) |
| `SettingsPages.9605fd4d` | 写死 | 系统设置 | 名称 | [SettingsPages.tsx:38](../../apps/web/src/pages/platform/SettingsPages.tsx#L38) |
| `SettingsPages.24b8aa7c` | 写死 | 展开（共 {lines} 行） | 按钮 | [SettingsPages.tsx:57](../../apps/web/src/pages/platform/SettingsPages.tsx#L57) |
| `SettingsPages.f9ed5415` | 写死 | 收起 | 按钮 | [SettingsPages.tsx:57](../../apps/web/src/pages/platform/SettingsPages.tsx#L57) |
| `SettingsPages.42fd64be` | 写死 | 这次操作没有记下更多内容。 | 正文 | [SettingsPages.tsx:83](../../apps/web/src/pages/platform/SettingsPages.tsx#L83) |
| `SettingsPages.348ca8bc` | 写死 | 记下的内容 | 正文 | [SettingsPages.tsx:90](../../apps/web/src/pages/platform/SettingsPages.tsx#L90)、652 行 |
| `SettingsPages.6c01a92d` | 写死 | 改了什么 | 正文 | [SettingsPages.tsx:90](../../apps/web/src/pages/platform/SettingsPages.tsx#L90)、652 行 |
| `SettingsPages.9560067b` | 写死 | 删除前的内容 | 正文 | [SettingsPages.tsx:90](../../apps/web/src/pages/platform/SettingsPages.tsx#L90)、100、652 行 |
| `SettingsPages.ef76ee55` | 写死 | 项目 | 表头 | [SettingsPages.tsx:93](../../apps/web/src/pages/platform/SettingsPages.tsx#L93)、853 行 |
| `SettingsPages.d9e05da9` | 写死 | 改前 | 表头 | [SettingsPages.tsx:96](../../apps/web/src/pages/platform/SettingsPages.tsx#L96)、112 行 |
| `SettingsPages.055181de` | 写死 | 改后 | 表头 | [SettingsPages.tsx:97](../../apps/web/src/pages/platform/SettingsPages.tsx#L97)、115 行 |
| `SettingsPages.2fe53243` | 写死 | 内容 | 表头 | [SettingsPages.tsx:100](../../apps/web/src/pages/platform/SettingsPages.tsx#L100) |
| `SettingsPages.b9aaf5da` | 写死 | 没有变 | 正文 | [SettingsPages.tsx:115](../../apps/web/src/pages/platform/SettingsPages.tsx#L115) |
| `SettingsPages.f05badda` | 写死 | 没有哪一项变了。 | 正文 | [SettingsPages.tsx:126](../../apps/web/src/pages/platform/SettingsPages.tsx#L126) |
| `SettingsPages.0cc2b7de` | 写死 | 另有 {unchanged} 项没有变 | 正文 | [SettingsPages.tsx:134](../../apps/web/src/pages/platform/SettingsPages.tsx#L134) |
| `SettingsPages.1e15ce70` | 写死 | 全部显示 | 按钮 | [SettingsPages.tsx:137](../../apps/web/src/pages/platform/SettingsPages.tsx#L137) |
| `SettingsPages.f5d038f5` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [SettingsPages.tsx:153](../../apps/web/src/pages/platform/SettingsPages.tsx#L153) |
| `SettingsPages.9208ff9d` | 写死 | 结束日期不能早于开始日期，请改一下「从」或「到」 | 文字 | [SettingsPages.tsx:154](../../apps/web/src/pages/platform/SettingsPages.tsx#L154) |
| `SettingsPages.1dff7bd2` | 写死 | 审计日志 · NOZOMI {name} | 浏览器标题 | [SettingsPages.tsx:165](../../apps/web/src/pages/platform/SettingsPages.tsx#L165) |
| `SettingsPages.31360e69` | 写死 | 审计日志 | 名称 | [SettingsPages.tsx:254](../../apps/web/src/pages/platform/SettingsPages.tsx#L254)、255、590 行 |
| `SettingsPages.0d6a14a3` | 写死 | 时间（你的本地时区，{…}） | 文字 | [SettingsPages.tsx:298](../../apps/web/src/pages/platform/SettingsPages.tsx#L298) |
| `SettingsPages.7cd229fb` | 写死 | 操作人 | 文字 | [SettingsPages.tsx:307](../../apps/web/src/pages/platform/SettingsPages.tsx#L307)、625 行 |
| `SettingsPages.94e7eb58` | 写死 | 操作人 {email} | 名称 | [SettingsPages.tsx:312](../../apps/web/src/pages/platform/SettingsPages.tsx#L312) |
| `SettingsPages.a9f58b60` | 写死 | 只看这个人 | 正文 | [SettingsPages.tsx:322](../../apps/web/src/pages/platform/SettingsPages.tsx#L322) |
| `SettingsPages.41e64e5c` | 写死 | 操作 | 文字 | [SettingsPages.tsx:334](../../apps/web/src/pages/platform/SettingsPages.tsx#L334)、506、630 行 |
| `SettingsPages.6bc97b6b` | 写死 | 对象 | 文字 | [SettingsPages.tsx:342](../../apps/web/src/pages/platform/SettingsPages.tsx#L342)、632 行 |
| `SettingsPages.f07318fd` | 写死 | 对象 {…} | 名称 | [SettingsPages.tsx:356](../../apps/web/src/pages/platform/SettingsPages.tsx#L356) |
| `SettingsPages.d1268191` | 写死 | 只看这个对象 | 正文 | [SettingsPages.tsx:366](../../apps/web/src/pages/platform/SettingsPages.tsx#L366) |
| `SettingsPages.629dc537` | 写死 | 来源 | 文字 | [SettingsPages.tsx:381](../../apps/web/src/pages/platform/SettingsPages.tsx#L381)、644 行 |
| `SettingsPages.a55e99c6` | 写死 | 详情 | 文字 | [SettingsPages.tsx:384](../../apps/web/src/pages/platform/SettingsPages.tsx#L384)、388 行 |
| `SettingsPages.657c9a93` | 写死 | 第 {id} 条记录的详情 | 读屏说明 | [SettingsPages.tsx:386](../../apps/web/src/pages/platform/SettingsPages.tsx#L386) |
| `SettingsPages.437e677b` | 写死 | 日期填反了 | 标题 | [SettingsPages.tsx:398](../../apps/web/src/pages/platform/SettingsPages.tsx#L398) |
| `SettingsPages.7ea10bef` | 写死 | 「从」{from} 晚于「到」{to}，这样一条记录也查不到。请改一下其中一个日期，或把两个日期对调。 | 说明 | [SettingsPages.tsx:399](../../apps/web/src/pages/platform/SettingsPages.tsx#L399) |
| `SettingsPages.eec916a6` | 写死 | 对调两个日期 | 按钮 | [SettingsPages.tsx:403](../../apps/web/src/pages/platform/SettingsPages.tsx#L403) |
| `SettingsPages.623e35fc` | 写死 | 没有符合条件的记录 | 标题 | [SettingsPages.tsx:409](../../apps/web/src/pages/platform/SettingsPages.tsx#L409) |
| `SettingsPages.129ae250` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [SettingsPages.tsx:410](../../apps/web/src/pages/platform/SettingsPages.tsx#L410) |
| `SettingsPages.0158a90c` | 写死 | 清空筛选 | 按钮 | [SettingsPages.tsx:414](../../apps/web/src/pages/platform/SettingsPages.tsx#L414)、548 行 |
| `SettingsPages.cc0d2f74` | 写死 | 还没有记录 | 标题 | [SettingsPages.tsx:418](../../apps/web/src/pages/platform/SettingsPages.tsx#L418) |
| `SettingsPages.2a20796f` | 写死 | 移除条件：{text} | 读屏说明 | [SettingsPages.tsx:423](../../apps/web/src/pages/platform/SettingsPages.tsx#L423) |
| `SettingsPages.524c7391` | 写死 | 不限 | 输入框占位 | [SettingsPages.tsx:455](../../apps/web/src/pages/platform/SettingsPages.tsx#L455) |
| `SettingsPages.d379ab93` | 写死 | 全部 | 选项 | [SettingsPages.tsx:478](../../apps/web/src/pages/platform/SettingsPages.tsx#L478)、511、512 行 |
| `SettingsPages.e0a3cae7` | 写死 | 从 | 文字 | [SettingsPages.tsx:490](../../apps/web/src/pages/platform/SettingsPages.tsx#L490) |
| `SettingsPages.6301a235` | 写死 | 到 | 文字 | [SettingsPages.tsx:491](../../apps/web/src/pages/platform/SettingsPages.tsx#L491) |
| `SettingsPages.0378987f` | 写死 | 今天 | 正文 | [SettingsPages.tsx:495](../../apps/web/src/pages/platform/SettingsPages.tsx#L495) |
| `SettingsPages.58b1df4f` | 写死 | 最近 7 天 | 正文 | [SettingsPages.tsx:496](../../apps/web/src/pages/platform/SettingsPages.tsx#L496) |
| `SettingsPages.8fed18c2` | 写死 | 最近 30 天 | 正文 | [SettingsPages.tsx:497](../../apps/web/src/pages/platform/SettingsPages.tsx#L497) |
| `SettingsPages.a251f23b` | 写死 | 对象类型 | 文字 | [SettingsPages.tsx:505](../../apps/web/src/pages/platform/SettingsPages.tsx#L505) |
| `SettingsPages.d8166a64` | 写死 | 供应商 | 名称 | [SettingsPages.tsx:510](../../apps/web/src/pages/platform/SettingsPages.tsx#L510) |
| `SettingsPages.19b80862` | 写死 | 平台和供应商后台里的每一次登录、新建、修改、停用都记在这里，只能查看，不能修改或删除。密码、链接里的令牌不会被记录。 | 正文 | [SettingsPages.tsx:528](../../apps/web/src/pages/platform/SettingsPages.tsx#L528) |
| `SettingsPages.73999e84` | 写死 | 网址里有一个筛选条件不对，已经忽略。 | 提示 | [SettingsPages.tsx:529](../../apps/web/src/pages/platform/SettingsPages.tsx#L529) |
| `SettingsPages.b20eb2ff` | 写死 | 筛选 | 按钮 | [SettingsPages.tsx:540](../../apps/web/src/pages/platform/SettingsPages.tsx#L540)、542、553 行 |
| `SettingsPages.d6a7fcf2` | 写死 | 筛选 · {panelCount} | 按钮 | [SettingsPages.tsx:540](../../apps/web/src/pages/platform/SettingsPages.tsx#L540) |
| `SettingsPages.308f656a` | 写死 | 清空 | 按钮 | [SettingsPages.tsx:565](../../apps/web/src/pages/platform/SettingsPages.tsx#L565) |
| `SettingsPages.c08b6e82` | 写死 | 查看结果 | 按钮 | [SettingsPages.tsx:568](../../apps/web/src/pages/platform/SettingsPages.tsx#L568) |
| `SettingsPages.807a8cd4` | 写死 | 操作人：{…} | 文字 | [SettingsPages.tsx:577](../../apps/web/src/pages/platform/SettingsPages.tsx#L577) |
| `SettingsPages.33c45a19` | 写死 | 对象：{text} {…} | 文字 | [SettingsPages.tsx:583](../../apps/web/src/pages/platform/SettingsPages.tsx#L583) |
| `SettingsPages.37fdc82a` | 写死 | 本页 {length} 条 | 正文 | [SettingsPages.tsx:605](../../apps/web/src/pages/platform/SettingsPages.tsx#L605) |
| `SettingsPages.98c20486` | 写死 | 关闭 | 按钮 | [SettingsPages.tsx:614](../../apps/web/src/pages/platform/SettingsPages.tsx#L614) |
| `SettingsPages.48f096c8` | 写死 | 时间 | 正文 | [SettingsPages.tsx:620](../../apps/web/src/pages/platform/SettingsPages.tsx#L620) |
| `SettingsPages.fa7a0d39` | 写死 | 复制对象编号 | 名称 | [SettingsPages.tsx:638](../../apps/web/src/pages/platform/SettingsPages.tsx#L638) |
| `SettingsPages.8ad452ce` | 写死 | 所属供应商 | 正文 | [SettingsPages.tsx:642](../../apps/web/src/pages/platform/SettingsPages.tsx#L642) |
| `SettingsPages.20824fff` | 写死 | 来源地址 | 正文 | [SettingsPages.tsx:646](../../apps/web/src/pages/platform/SettingsPages.tsx#L646) |
| `SettingsPages.88a57dd3` | 写死 | 记录编号 | 正文 | [SettingsPages.tsx:648](../../apps/web/src/pages/platform/SettingsPages.tsx#L648) |
| `SettingsPages.e1e788ee` | 写死 | 复制这条记录 | 按钮 | [SettingsPages.tsx:655](../../apps/web/src/pages/platform/SettingsPages.tsx#L655) |
| `SettingsPages.f3df13d9` | 写死 | 密码、密码的哈希、邀请和重置链接里的令牌不会被记录，所以这里看不到，不是被隐藏了。 | 正文 | [SettingsPages.tsx:658](../../apps/web/src/pages/platform/SettingsPages.tsx#L658) |
| `SettingsPages.8019e539` | 写死 | 汇率数据 | 标题 | [SettingsPages.tsx:679](../../apps/web/src/pages/platform/SettingsPages.tsx#L679) |
| `SettingsPages.5d814061` | 写死 | 是否过期 | 正文 | [SettingsPages.tsx:684](../../apps/web/src/pages/platform/SettingsPages.tsx#L684) |
| `SettingsPages.245a75d6` | 写死 | 已过期（超过 48 小时没有更新），跨币种报价已暂停 | 正文 | [SettingsPages.tsx:685](../../apps/web/src/pages/platform/SettingsPages.tsx#L685) |
| `SettingsPages.3aafaf0d` | 写死 | 还没有汇率，跨币种报价都报不出 | 正文 | [SettingsPages.tsx:685](../../apps/web/src/pages/platform/SettingsPages.tsx#L685) |
| `SettingsPages.8175e076` | 写死 | 没有过期，跨币种报价照常 | 正文 | [SettingsPages.tsx:685](../../apps/web/src/pages/platform/SettingsPages.tsx#L685) |
| `SettingsPages.937e4928` | 写死 | 这批汇率的时间（数据源给的） | 正文 | [SettingsPages.tsx:688](../../apps/web/src/pages/platform/SettingsPages.tsx#L688) |
| `SettingsPages.f6a87203` | 写死 | 最近一次拉取 | 正文 | [SettingsPages.tsx:692](../../apps/web/src/pages/platform/SettingsPages.tsx#L692) |
| `SettingsPages.bba87dd6` | 写死 | 还没有拉过 | 正文 | [SettingsPages.tsx:695](../../apps/web/src/pages/platform/SettingsPages.tsx#L695) |
| `SettingsPages.e8d5bed0` | 写死 | 定时拉取 | 正文 | [SettingsPages.tsx:706](../../apps/web/src/pages/platform/SettingsPages.tsx#L706) |
| `SettingsPages.a499521c` | 写死 | 没有打开，只能在汇率页手动拉取 | 正文 | [SettingsPages.tsx:707](../../apps/web/src/pages/platform/SettingsPages.tsx#L707) |
| `SettingsPages.f720365d` | 写死 | 已打开（每天自动拉取） | 正文 | [SettingsPages.tsx:707](../../apps/web/src/pages/platform/SettingsPages.tsx#L707) |
| `SettingsPages.6a22154a` | 写死 | 看汇率和拉取记录 | 链接 | [SettingsPages.tsx:713](../../apps/web/src/pages/platform/SettingsPages.tsx#L713) |
| `SettingsPages.44eb4380` | 写死 | 按「里程 + 时长」计价的商品现在都报不出价；一口价和包车套餐照常。可在服务器配置 GOOGLE\_ROUTES\_DAILY\_LIMIT 调整。 | 邮件正文 | [SettingsPages.tsx:721](../../apps/web/src/pages/platform/SettingsPages.tsx#L721) |
| `SettingsPages.8b732298` | 写死 | 路线预估的每日上限设为 0，不调用谷歌地图 | 标题 | [SettingsPages.tsx:721](../../apps/web/src/pages/platform/SettingsPages.tsx#L721) |
| `SettingsPages.11e7f5b9` | 写死 | 今天的里程计价暂停，明天自动恢复；可在服务器配置 GOOGLE\_ROUTES\_DAILY\_LIMIT 调整。一口价和包车套餐照常报价。 | 邮件正文 | [SettingsPages.tsx:722](../../apps/web/src/pages/platform/SettingsPages.tsx#L722) |
| `SettingsPages.a5336a0f` | 写死 | 今天调用谷歌地图的次数已到每日上限（{daily\_limit} 次） | 标题 | [SettingsPages.tsx:722](../../apps/web/src/pages/platform/SettingsPages.tsx#L722) |
| `SettingsPages.4fbf9535` | 写死 | 路线预估（谷歌地图） | 标题 | [SettingsPages.tsx:733](../../apps/web/src/pages/platform/SettingsPages.tsx#L733) |
| `SettingsPages.23eae4ed` | 写死 | 按「里程 + 时长」计价的商品，报价时用谷歌地图预估路程。同一段路查过以后 7 天内不再调用；次数按东京时间每天 0 点重新计。 | 正文 | [SettingsPages.tsx:736](../../apps/web/src/pages/platform/SettingsPages.tsx#L736) |
| `SettingsPages.1f3e50e9` | 写死 | 今天的调用（{day}） | 正文 | [SettingsPages.tsx:739](../../apps/web/src/pages/platform/SettingsPages.tsx#L739) |
| `SettingsPages.0e90dfe6` | 写死 | {calls} / {daily\_limit} 次（含重试） | 正文 | [SettingsPages.tsx:740](../../apps/web/src/pages/platform/SettingsPages.tsx#L740) |
| `SettingsPages.cb052f90` | 写死 | {calls} 次 | 正文 | [SettingsPages.tsx:740](../../apps/web/src/pages/platform/SettingsPages.tsx#L740) |
| `SettingsPages.7a8905f3` | 写死 | 每日上限 | 正文 | [SettingsPages.tsx:743](../../apps/web/src/pages/platform/SettingsPages.tsx#L743) |
| `SettingsPages.9deb431a` | 写死 | 0（不调用谷歌地图） | 正文 | [SettingsPages.tsx:744](../../apps/web/src/pages/platform/SettingsPages.tsx#L744) |
| `SettingsPages.e486968d` | 写死 | {daily\_limit} 次，今天还剩 {…} 次 | 正文 | [SettingsPages.tsx:744](../../apps/web/src/pages/platform/SettingsPages.tsx#L744) |
| `SettingsPages.e1a1aff9` | 写死 | 今天失败 | 正文 | [SettingsPages.tsx:747](../../apps/web/src/pages/platform/SettingsPages.tsx#L747)、799 行 |
| `SettingsPages.cc02fb85` | 写死 | {failures} 次 | 正文 | [SettingsPages.tsx:748](../../apps/web/src/pages/platform/SettingsPages.tsx#L748)、800 行 |
| `SettingsPages.39bdf8aa` | 写死 | 今天被上限挡下 | 正文 | [SettingsPages.tsx:751](../../apps/web/src/pages/platform/SettingsPages.tsx#L751) |
| `SettingsPages.8127b34a` | 写死 | 0 次 | 正文 | [SettingsPages.tsx:752](../../apps/web/src/pages/platform/SettingsPages.tsx#L752) |
| `SettingsPages.d591c0a0` | 写死 | {refused} 次（这些询价里按「里程 + 时长」计价的商品没有报出价） | 正文 | [SettingsPages.tsx:752](../../apps/web/src/pages/platform/SettingsPages.tsx#L752) |
| `SettingsPages.a6824032` | 写死 | 最近一次成功 | 正文 | [SettingsPages.tsx:755](../../apps/web/src/pages/platform/SettingsPages.tsx#L755) |
| `SettingsPages.9bbd54fe` | 写死 | 还没有成功过 | 正文 | [SettingsPages.tsx:756](../../apps/web/src/pages/platform/SettingsPages.tsx#L756) |
| `SettingsPages.75db1a18` | 写死 | 最近一次失败 | 正文 | [SettingsPages.tsx:759](../../apps/web/src/pages/platform/SettingsPages.tsx#L759)、803 行 |
| `SettingsPages.6a8cc3ca` | 写死 | 没有失败过 | 正文 | [SettingsPages.tsx:762](../../apps/web/src/pages/platform/SettingsPages.tsx#L762)、804 行 |
| `SettingsPages.6e342af1` | 写死 | 地址问题，不是服务故障： | 正文 | [SettingsPages.tsx:767](../../apps/web/src/pages/platform/SettingsPages.tsx#L767) |
| `SettingsPages.6d25ded0` | 写死 | {refused} 次 | 正文 | [SettingsPages.tsx:796](../../apps/web/src/pages/platform/SettingsPages.tsx#L796) |
| `SettingsPages.173f5bb1` | 写死 | 系统状态 · NOZOMI {name} | 浏览器标题 | [SettingsPages.tsx:813](../../apps/web/src/pages/platform/SettingsPages.tsx#L813) |
| `SettingsPages.db8ff075` | 写死 | 已重新检查，{length} 项未配置 | 提示 | [SettingsPages.tsx:834](../../apps/web/src/pages/platform/SettingsPages.tsx#L834) |
| `SettingsPages.7df0a8d4` | 写死 | 检查 | 文字 | [SettingsPages.tsx:837](../../apps/web/src/pages/platform/SettingsPages.tsx#L837) |
| `SettingsPages.afb5877b` | 写死 | 你没有权限查看系统状态。需要的话，请联系管理员开通。 | 错误提示 | [SettingsPages.tsx:837](../../apps/web/src/pages/platform/SettingsPages.tsx#L837) |
| `SettingsPages.c8ce8361` | 写死 | 系统状态 | 名称 | [SettingsPages.tsx:844](../../apps/web/src/pages/platform/SettingsPages.tsx#L844)、845、896 行 |
| `SettingsPages.09e0b7d5` | 写死 | 状态 | 文字 | [SettingsPages.tsx:854](../../apps/web/src/pages/platform/SettingsPages.tsx#L854) |
| `SettingsPages.b9da1ef8` | 写死 | 已配置 | 名称 | [SettingsPages.tsx:854](../../apps/web/src/pages/platform/SettingsPages.tsx#L854) |
| `SettingsPages.e5523e62` | 写死 | 未配置 | 名称 | [SettingsPages.tsx:854](../../apps/web/src/pages/platform/SettingsPages.tsx#L854) |
| `SettingsPages.a73e3bd5` | 写死 | 说明 | 文字 | [SettingsPages.tsx:855](../../apps/web/src/pages/platform/SettingsPages.tsx#L855) |
| `SettingsPages.b41439e0` | 写死 | 这里只显示各项配好了没有，以及打过码的信息；看不到密钥原文。每次打开这一页都会记入审计日志。 | 正文 | [SettingsPages.tsx:861](../../apps/web/src/pages/platform/SettingsPages.tsx#L861) |
| `SettingsPages.d987f342` | 写死 | 没有检查成功。 | 正文 | [SettingsPages.tsx:868](../../apps/web/src/pages/platform/SettingsPages.tsx#L868) |
| `SettingsPages.31e976e2` | 写死 | {recheckFailed}下面是上一次检查的结果。 | 正文 | [SettingsPages.tsx:869](../../apps/web/src/pages/platform/SettingsPages.tsx#L869) |
| `SettingsPages.3005cd4e` | 写死 | 有 {length} 项还没有配置： | 正文 | [SettingsPages.tsx:875](../../apps/web/src/pages/platform/SettingsPages.tsx#L875) |
| `SettingsPages.73aa307a` | 写死 | {…}。用到它们的功能现在不能用。配置要由技术在服务器上做；谷歌地图、Stripe 支付、邮件发送和 Claude（AI 行程解析）也可以由超级管理员在下面的「第三方密钥」里直接填写。 | 正文 | [SettingsPages.tsx:877](../../apps/web/src/pages/platform/SettingsPages.tsx#L877) |
| `SettingsPages.4ad599ab` | 写死 | 密钥只能由负责人本人填写，不要发在聊天里。 | 正文 | [SettingsPages.tsx:878](../../apps/web/src/pages/platform/SettingsPages.tsx#L878) |
| `SettingsPages.bcc5f58e` | 写死 | 汇率超过 48 小时没有更新，跨币种报价已暂停 | 正文 | [SettingsPages.tsx:884](../../apps/web/src/pages/platform/SettingsPages.tsx#L884) |
| `SettingsPages.409b60d0` | 写死 | 现在这批汇率是 {…} 的。请到汇率页检查数据源，或立即拉取一次。 | 正文 | [SettingsPages.tsx:885](../../apps/web/src/pages/platform/SettingsPages.tsx#L885) |
| `SettingsPages.2fd1efb9` | 写死 | 去汇率页处理 | 链接 | [SettingsPages.tsx:886](../../apps/web/src/pages/platform/SettingsPages.tsx#L886) |
| `SettingsPages.b900b400` | 写死 | 没有可以检查的项目 | 标题 | [SettingsPages.tsx:896](../../apps/web/src/pages/platform/SettingsPages.tsx#L896) |
| `SettingsPages.1810d2e8` | 写死 | 检查中… | 文字 | [SettingsPages.tsx:905](../../apps/web/src/pages/platform/SettingsPages.tsx#L905) |
| `SettingsPages.f42257b0` | 写死 | 重新检查 | 按钮 | [SettingsPages.tsx:910](../../apps/web/src/pages/platform/SettingsPages.tsx#L910) |

## 订单（列表、详情）

文件：`apps/web/src/lib/embed-display.ts`、`apps/web/src/pages/platform/OrderFulfilmentSections.tsx`、`apps/web/src/pages/platform/PlatformOrderPages.tsx`、`apps/web/src/pages/platform/ProxyFulfilment.tsx`、`apps/web/src/pages/platform/ViewLinkResend.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `embed-display.9f3fd69e` | 写死 | 主站 | 文字 | [embed-display.ts:6](../../apps/web/src/lib/embed-display.ts#L6) |
| `embed-display.97509abe` | 写死 | （宿主页内） | 文字 | [embed-display.ts:13](../../apps/web/src/lib/embed-display.ts#L13) |
| `embed-display.b182a778` | 写死 | 嵌入组件{…} · {host}{…} | 文字 | [embed-display.ts:13](../../apps/web/src/lib/embed-display.ts#L13) |
| `OrderFulfilmentSections.240be7db` | 写死 | 还没有记录 | 文字 | [OrderFulfilmentSections.tsx:19](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L19) |
| `OrderFulfilmentSections.890f0f84` | 写死 | 还没付款，不派车 | 文字 | [OrderFulfilmentSections.tsx:28](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L28) |
| `OrderFulfilmentSections.a54a46b7` | 写死 | 还没派车 | 文字 | [OrderFulfilmentSections.tsx:28](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L28) |
| `OrderFulfilmentSections.d09844ca` | 写死 | 平台代传 | 正文 | [OrderFulfilmentSections.tsx:33](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L33) |
| `OrderFulfilmentSections.5dab3162` | 写死 | 派车（当地时间，{zone}） | 标题 | [OrderFulfilmentSections.tsx:37](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L37) |
| `OrderFulfilmentSections.14552063` | 写死 | （已超时） | 正文 | [OrderFulfilmentSections.tsx:39](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L39) |
| `OrderFulfilmentSections.4daede7d` | 写死 | 派车截止 | 名称 | [OrderFulfilmentSections.tsx:39](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L39) |
| `OrderFulfilmentSections.da9b97c1` | 写死 | 没有（还没付款） | 文字 | [OrderFulfilmentSections.tsx:39](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L39) |
| `OrderFulfilmentSections.7b97e0d5` | 写死 | 派车时间 | 名称 | [OrderFulfilmentSections.tsx:40](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L40) |
| `OrderFulfilmentSections.1cf5f5bb` | 写死 | 查不到司机资料 | 正文 | [OrderFulfilmentSections.tsx:41](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L41) |
| `OrderFulfilmentSections.85827725` | 写死 | 司机 | 名称 | [OrderFulfilmentSections.tsx:41](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L41) |
| `OrderFulfilmentSections.6fd666a8` | 写死 | 车辆 | 名称 | [OrderFulfilmentSections.tsx:42](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L42) |
| `OrderFulfilmentSections.9004d3aa` | 写死 | 查不到车辆资料 | 正文 | [OrderFulfilmentSections.tsx:42](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L42) |
| `OrderFulfilmentSections.13460ea5` | 写死 | 司机最近打开 {…} | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.3862d84b` | 写死 | 没有有效的链接 | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.6bf7545d` | 写死 | 已过期 | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.75d374eb` | 写死 | {…}，到 {…}；{…} | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.8bd40df0` | 写死 | 司机链接 | 名称 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.acbcc8d0` | 写死 | 有效 | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.e092366d` | 写死 | 司机还没打开过 | 正文 | [OrderFulfilmentSections.tsx:43](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L43) |
| `OrderFulfilmentSections.e32c843e` | 写死 | 派车和改派记录 | 标题 | [OrderFulfilmentSections.tsx:47](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L47) |
| `OrderFulfilmentSections.8fb63caa` | 写死 | 派车 | 正文 | [OrderFulfilmentSections.tsx:50](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L50) |
| `OrderFulfilmentSections.b0a20bd1` | 写死 | 改派 | 正文 | [OrderFulfilmentSections.tsx:50](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L50) |
| `OrderFulfilmentSections.c60a0ee3` | 写死 | （调度确认过时段冲突） | 正文 | [OrderFulfilmentSections.tsx:50](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L50) |
| `OrderFulfilmentSections.7234d6f8` | 写死 | 履约（当地时间，{zone}） | 标题 | [OrderFulfilmentSections.tsx:58](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L58) |
| `OrderFulfilmentSections.652b81f2` | 写死 | 司机出发 | 名称 | [OrderFulfilmentSections.tsx:60](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L60) |
| `OrderFulfilmentSections.8cc6a3cd` | 写死 | 到达上车点 | 名称 | [OrderFulfilmentSections.tsx:61](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L61) |
| `OrderFulfilmentSections.219e2b02` | 写死 | （距上车点 {arrival\_distance\_m} 米{…}） | 正文 | [OrderFulfilmentSections.tsx:63](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L63) |
| `OrderFulfilmentSections.49b3a94f` | 写死 | （没有定位） | 正文 | [OrderFulfilmentSections.tsx:63](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L63) |
| `OrderFulfilmentSections.ef9f73a1` | 写死 | ，超过 300 米 | 正文 | [OrderFulfilmentSections.tsx:63](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L63) |
| `OrderFulfilmentSections.631cedbc` | 写死 | 接到客人 | 名称 | [OrderFulfilmentSections.tsx:66](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L66) |
| `OrderFulfilmentSections.9c62e8c4` | 写死 | 完成 | 名称 | [OrderFulfilmentSections.tsx:67](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L67) |
| `OrderFulfilmentSections.d95a5a7d` | 写死 | （实际 {actual\_minutes} 分钟、{…} 公里） | 正文 | [OrderFulfilmentSections.tsx:69](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L69) |
| `OrderFulfilmentSections.ec655053` | 写死 | 司机申请离开 | 名称 | [OrderFulfilmentSections.tsx:72](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L72) |
| `OrderFulfilmentSections.a95fa417` | 写死 | 落地（当地时间，{zone}） | 标题 | [OrderFulfilmentSections.tsx:77](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L77) |
| `OrderFulfilmentSections.a8af4e5e` | 写死 | 这一单不是接机，不记落地时间。 | 正文 | [OrderFulfilmentSections.tsx:79](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L79) |
| `OrderFulfilmentSections.2dd0518e` | 写死 | 航班号 | 名称 | [OrderFulfilmentSections.tsx:83](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L83) |
| `OrderFulfilmentSections.8e79b2cd` | 写死 | 没有填 | 正文 | [OrderFulfilmentSections.tsx:83](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L83) |
| `OrderFulfilmentSections.6a3a0d38` | 写死 | 计划到达 | 名称 | [OrderFulfilmentSections.tsx:84](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L84) |
| `OrderFulfilmentSections.4b25d49a` | 写死 | 实际落地（按规则取定） | 名称 | [OrderFulfilmentSections.tsx:85](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L85) |
| `OrderFulfilmentSections.d2383818` | 写死 | {…}（来源：{…}） | 正文 | [OrderFulfilmentSections.tsx:85](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L85) |
| `OrderFulfilmentSections.4a1a1539` | 写死 | 客人确认 | 名称 | [OrderFulfilmentSections.tsx:86](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L86) |
| `OrderFulfilmentSections.f9a1f25c` | 写死 | 客人没有确认 | 文字 | [OrderFulfilmentSections.tsx:86](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L86) |
| `OrderFulfilmentSections.38ec6860` | 写死 | （附到达屏照片） | 正文 | [OrderFulfilmentSections.tsx:87](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L87) |
| `OrderFulfilmentSections.4b72662e` | 写死 | 司机填写 | 名称 | [OrderFulfilmentSections.tsx:87](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L87) |
| `OrderFulfilmentSections.b893cae3` | 写死 | 司机没有填写 | 正文 | [OrderFulfilmentSections.tsx:87](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L87) |
| `OrderFulfilmentSections.0f92a517` | 写死 | {delay\_minutes} 分钟{…} | 正文 | [OrderFulfilmentSections.tsx:88](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L88) |
| `OrderFulfilmentSections.37c0f0c6` | 写死 | （超过 6 小时） | 正文 | [OrderFulfilmentSections.tsx:88](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L88) |
| `OrderFulfilmentSections.4c75211f` | 写死 | 没有延误 | 正文 | [OrderFulfilmentSections.tsx:88](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L88) |
| `OrderFulfilmentSections.be9ad49a` | 写死 | 延误 | 名称 | [OrderFulfilmentSections.tsx:88](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L88) |
| `OrderFulfilmentSections.cc994aa5` | 写死 | （6 小时内，顺延接机、不加收） | 正文 | [OrderFulfilmentSections.tsx:88](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L88) |
| `OrderFulfilmentSections.a99a83b2` | 写死 | 客人和司机都还没有报落地时间，现在按计划到达时间算。 | 正文 | [OrderFulfilmentSections.tsx:90](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L90) |
| `OrderFulfilmentSections.7bf2eca7` | 写死 | 客人和司机报的时间不一致，取较晚的那个。 | 正文 | [OrderFulfilmentSections.tsx:91](../../apps/web/src/pages/platform/OrderFulfilmentSections.tsx#L91) |
| `PlatformOrderPages.a26319d4` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [PlatformOrderPages.tsx:102](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L102) |
| `PlatformOrderPages.a653b6ad` | 写死 | 你没有权限查看这里 | 标题 | [PlatformOrderPages.tsx:102](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L102) |
| `PlatformOrderPages.4005ab2e` | 写死 | 订单 | 名称 | [PlatformOrderPages.tsx:103](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L103)、177、178、251、614 行 |
| `PlatformOrderPages.b39bbff0` | 写死 | 状态 | 名称 | [PlatformOrderPages.tsx:118](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L118)、184、730、808 行 |
| `PlatformOrderPages.f0b61e55` | 写死 | 全部 | 名称 | [PlatformOrderPages.tsx:118](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L118)、119、124、125 行 |
| `PlatformOrderPages.0ced049e` | 写死 | 没有异常 | 名称 | [PlatformOrderPages.tsx:119](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L119) |
| `PlatformOrderPages.bf3361d5` | 写死 | 异常 | 名称 | [PlatformOrderPages.tsx:119](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L119)、187、861 行 |
| `PlatformOrderPages.ce934648` | 写死 | 有没处理完的异常 | 名称 | [PlatformOrderPages.tsx:119](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L119) |
| `PlatformOrderPages.2d11e56b` | 写死 | 用车日期从 | 名称 | [PlatformOrderPages.tsx:120](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L120) |
| `PlatformOrderPages.3e38317b` | 写死 | 到 | 名称 | [PlatformOrderPages.tsx:121](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L121)、123 行 |
| `PlatformOrderPages.41d186c0` | 写死 | 下单日期从 | 名称 | [PlatformOrderPages.tsx:122](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L122) |
| `PlatformOrderPages.11e97f93` | 写死 | 城市 | 名称 | [PlatformOrderPages.tsx:124](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L124) |
| `PlatformOrderPages.21a3a54b` | 写死 | 品类 | 名称 | [PlatformOrderPages.tsx:125](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L125)、197 行 |
| `PlatformOrderPages.ab4eb487` | 写死 | 乘客 | 名称 | [PlatformOrderPages.tsx:126](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L126)、198、657 行 |
| `PlatformOrderPages.21a1c58d` | 写死 | 订单 · NOZOMI {name} | 浏览器标题 | [PlatformOrderPages.tsx:133](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L133) |
| `PlatformOrderPages.92c8180b` | 写死 | 订单号 | 文字 | [PlatformOrderPages.tsx:183](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L183)、649 行 |
| `PlatformOrderPages.650ce566` | 写死 | {open\_exceptions} 条没处理完 | 链接 | [PlatformOrderPages.tsx:193](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L193) |
| `PlatformOrderPages.c4cbe01b` | 写死 | 用车时间（当地） | 文字 | [PlatformOrderPages.tsx:196](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L196) |
| `PlatformOrderPages.77460039` | 写死 | 供应商 | 文字 | [PlatformOrderPages.tsx:199](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L199)、669 行 |
| `PlatformOrderPages.e1ebeb3c` | 写死 | 渠道 | 文字 | [PlatformOrderPages.tsx:200](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L200)、670 行 |
| `PlatformOrderPages.9efaf6c2` | 写死 | 对外价 | 文字 | [PlatformOrderPages.tsx:201](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L201) |
| `PlatformOrderPages.0910d4dc` | 写死 | 结算价 | 文字 | [PlatformOrderPages.tsx:202](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L202) |
| `PlatformOrderPages.6cd7b41b` | 写死 | 跨供应商、跨渠道的全部订单。用车日期按各城市当地的日期算；下单日期按你的本地时区算。要人处理的单在「异常队列」里。 | 正文 | [PlatformOrderPages.tsx:220](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L220) |
| `PlatformOrderPages.6fb218bd` | 写死 | 订单号或渠道订单号 | 名称 | [PlatformOrderPages.tsx:231](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L231) |
| `PlatformOrderPages.da162262` | 写死 | 查找 | 按钮 | [PlatformOrderPages.tsx:232](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L232) |
| `PlatformOrderPages.94f9fab7` | 写死 | 只看一个嵌入码带来的订单（从「嵌入组件」页进来）。 | 正文 | [PlatformOrderPages.tsx:242](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L242) |
| `PlatformOrderPages.c5b76516` | 写死 | 不限来源 | 按钮 | [PlatformOrderPages.tsx:245](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L245) |
| `PlatformOrderPages.3f7ada84` | 写死 | 换个条件试试，或清空筛选。 | 说明 | [PlatformOrderPages.tsx:258](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L258) |
| `PlatformOrderPages.4a1e3cfd` | 写死 | 渠道和官网下的单都会出现在这里。 | 说明 | [PlatformOrderPages.tsx:258](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L258) |
| `PlatformOrderPages.7398ce2a` | 写死 | 还没有订单 | 标题 | [PlatformOrderPages.tsx:258](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L258) |
| `PlatformOrderPages.aa445a54` | 写死 | 没有符合条件的订单 | 标题 | [PlatformOrderPages.tsx:258](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L258) |
| `PlatformOrderPages.c6fc156a` | 写死 | 清空筛选 | 按钮 | [PlatformOrderPages.tsx:258](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L258) |
| `PlatformOrderPages.3b46685e` | 写死 | 查看 | 文字 | [PlatformOrderPages.tsx:298](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L298) |
| `PlatformOrderPages.9aa7aea9` | 写死 | {ANONYMIZED\_TEXT} · {passengers} 人 {luggage} 件行李 | 正文 | [PlatformOrderPages.tsx:309](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L309) |
| `PlatformOrderPages.91cc0473` | 写死 | 订单结束超过保存期限，乘客姓名、电话、邮箱已按隐私规则清除，无法恢复。 | 正文 | [PlatformOrderPages.tsx:310](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L310) |
| `PlatformOrderPages.0bd9c7c0` | 写死 | {name} · {phone}{…} · {passengers} 人 {luggage} 件行李 | 正文 | [PlatformOrderPages.tsx:316](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L316) |
| `PlatformOrderPages.6a8132e8` | 写死 | 乘车人：{name}{…}（上面是联系人 / 预订人） | 正文 | [PlatformOrderPages.tsx:318](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L318) |
| `PlatformOrderPages.f12acab3` | 写死 | 举牌姓名：{sign\_name} | 正文 | [PlatformOrderPages.tsx:319](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L319) |
| `PlatformOrderPages.f0adeb8d` | 写死 | 即时通讯：{app} {handle} | 正文 | [PlatformOrderPages.tsx:322](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L322) |
| `PlatformOrderPages.e4d8766f` | 写死 | 备注原文：{notes} | 正文 | [PlatformOrderPages.tsx:323](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L323) |
| `PlatformOrderPages.6a2edca2` | 写死 | 查看联系方式 | 按钮 | [PlatformOrderPages.tsx:332](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L332) |
| `PlatformOrderPages.dc07c0de` | 写死 | 查看会记进审计日志。 | 正文 | [PlatformOrderPages.tsx:333](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L333) |
| `PlatformOrderPages.7c871815` | 写死 | 试算 | 文字 | [PlatformOrderPages.tsx:355](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L355) |
| `PlatformOrderPages.eb25b937` | 写死 | 请写明原因（会记进审计日志） | 文字 | [PlatformOrderPages.tsx:363](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L363) |
| `PlatformOrderPages.1e67ffad` | 写死 | 已取消，退款已经发出 | 文字 | [PlatformOrderPages.tsx:370](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L370) |
| `PlatformOrderPages.8f6e8f26` | 写死 | 多退给客人的取消要另一位同事批准：已提交到「待审核」 | 文字 | [PlatformOrderPages.tsx:370](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L370) |
| `PlatformOrderPages.cfd39072` | 写死 | 取消 | 文字 | [PlatformOrderPages.tsx:372](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L372)、702、737 行 |
| `PlatformOrderPages.841bc036` | 写死 | 代客人取消 | 标题 | [PlatformOrderPages.tsx:378](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L378)、685 行 |
| `PlatformOrderPages.89870dc9` | 写死 | 提交审核 | 按钮 | [PlatformOrderPages.tsx:378](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L378) |
| `PlatformOrderPages.9811a4c2` | 写死 | 确认取消 | 按钮 | [PlatformOrderPages.tsx:378](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L378) |
| `PlatformOrderPages.9c593aa8` | 写死 | 不取消了 | 按钮 | [PlatformOrderPages.tsx:378](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L378) |
| `PlatformOrderPages.38f56754` | 写死 | 取消原因 | 名称 | [PlatformOrderPages.tsx:379](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L379) |
| `PlatformOrderPages.4783f9c0` | 写死 | 免收取消费（要另一位同事批准） | 正文 | [PlatformOrderPages.tsx:383](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L383) |
| `PlatformOrderPages.bdc12a2d` | 写死 | 原因说明 | 名称 | [PlatformOrderPages.tsx:386](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L386) |
| `PlatformOrderPages.c7089500` | 写死 | 如「台风，机场关闭」「客人来电取消」 | 说明 | [PlatformOrderPages.tsx:386](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L386) |
| `PlatformOrderPages.16d45457` | 写死 | 离用车 | 名称 | [PlatformOrderPages.tsx:389](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L389) |
| `PlatformOrderPages.2a26ecea` | 写死 | {hours\_before\_service} 小时 | 正文 | [PlatformOrderPages.tsx:389](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L389) |
| `PlatformOrderPages.17c29663` | 写死 | {…}%（按取消政策 {…}%） | 正文 | [PlatformOrderPages.tsx:390](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L390) |
| `PlatformOrderPages.d5d44caa` | 写死 | 扣款比例 | 名称 | [PlatformOrderPages.tsx:390](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L390)、706 行 |
| `PlatformOrderPages.eafae36e` | 写死 | 退给客人 | 名称 | [PlatformOrderPages.tsx:391](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L391) |
| `PlatformOrderPages.d60bd8ad` | 写死 | 供应商应得 | 名称 | [PlatformOrderPages.tsx:392](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L392)、708 行 |
| `PlatformOrderPages.723e60f2` | 写死 | 这一单还没付款：取消后付款作废，不涉及退款。 | 正文 | [PlatformOrderPages.tsx:395](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L395) |
| `PlatformOrderPages.742a43de` | 写死 | 退给客人的比按取消政策算的多：提交后要另一位有权限的同事（财务或运营）在「待审核」里批准才会取消。 | 提示 | [PlatformOrderPages.tsx:396](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L396) |
| `PlatformOrderPages.50dd7541` | 写死 | 代供应商同意 | 按钮 | [PlatformOrderPages.tsx:403](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L403) |
| `PlatformOrderPages.71120538` | 写死 | 代供应商拒绝 | 文字 | [PlatformOrderPages.tsx:403](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L403) |
| `PlatformOrderPages.e45fa09a` | 写死 | 代供应商标记调整中 | 文字 | [PlatformOrderPages.tsx:403](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L403) |
| `PlatformOrderPages.7e4ecfc6` | 写死 | 请写原因：联系过谁、为什么由平台处理 | 文字 | [PlatformOrderPages.tsx:413](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L413) |
| `PlatformOrderPages.cbe2dd90` | 写死 | {…}：已记录 | 文字 | [PlatformOrderPages.tsx:420](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L420) |
| `PlatformOrderPages.5167546d` | 写死 | 返回 | 按钮 | [PlatformOrderPages.tsx:438](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L438) |
| `PlatformOrderPages.4abd53e9` | 写死 | 确认 | 按钮 | [PlatformOrderPages.tsx:441](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L441) |
| `PlatformOrderPages.e0389f93` | 写死 | 供应商联系不上或临近用车时才用。这次操作会写进审计，供应商看得到是平台代为处理的。 | 正文 | [PlatformOrderPages.tsx:446](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L446) |
| `PlatformOrderPages.5b47b294` | 写死 | 原因 | 名称 | [PlatformOrderPages.tsx:447](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L447)、534、704 行 |
| `PlatformOrderPages.0e84ca45` | 写死 | 修改已提交：要供应商同意才生效，确认前原预约有效 | 文字 | [PlatformOrderPages.tsx:456](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L456) |
| `PlatformOrderPages.73affc7d` | 写死 | 已改好，已通知供应商和司机 | 文字 | [PlatformOrderPages.tsx:456](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L456) |
| `PlatformOrderPages.369ee506` | 写死 | 没有要改的内容 | 文字 | [PlatformOrderPages.tsx:457](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L457)、504 行 |
| `PlatformOrderPages.04d8a91d` | 写死 | 乘客邮箱改成 {email\_masked} 需要另一位同事在「待审核」里批准，批准前订单上的邮箱不变 | 文字 | [PlatformOrderPages.tsx:458](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L458) |
| `PlatformOrderPages.81e59e38` | 写死 | 已提交：{email} | 文字 | [PlatformOrderPages.tsx:459](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L459) |
| `PlatformOrderPages.6aa16666` | 写死 | 用车时间写成 YYYY-MM-DDTHH:mm（当地时间） | 文字 | [PlatformOrderPages.tsx:485](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L485) |
| `PlatformOrderPages.45ee3a07` | 写死 | 新邮箱的格式不对 | 文字 | [PlatformOrderPages.tsx:493](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L493) |
| `PlatformOrderPages.9a996b59` | 写死 | 改乘客邮箱要另一位同事批准：请选怎么核实的客人身份，并写明原因 | 文字 | [PlatformOrderPages.tsx:497](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L497) |
| `PlatformOrderPages.e596723e` | 写死 | 改单 | 文字 | [PlatformOrderPages.tsx:513](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L513)、762 行 |
| `PlatformOrderPages.3432dc63` | 写死 | 代客人改单 | 标题 | [PlatformOrderPages.tsx:519](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L519)、680 行 |
| `PlatformOrderPages.707a8c2e` | 写死 | 保存 | 按钮 | [PlatformOrderPages.tsx:519](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L519) |
| `PlatformOrderPages.b4820c3b` | 写死 | 不改了 | 按钮 | [PlatformOrderPages.tsx:519](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L519) |
| `PlatformOrderPages.b4cdb1a2` | 写死 | 改时间会按新时间重新报价：贵了先从客人保存的卡上扣差价，便宜了退差价 | 说明 | [PlatformOrderPages.tsx:520](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L520) |
| `PlatformOrderPages.fa9add2a` | 写死 | 用车时间（当地，{timezone}） | 名称 | [PlatformOrderPages.tsx:520](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L520) |
| `PlatformOrderPages.25b8a3f8` | 写死 | 航班号 | 名称 | [PlatformOrderPages.tsx:521](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L521)、653 行 |
| `PlatformOrderPages.ed50e8ce` | 写死 | 人数 | 名称 | [PlatformOrderPages.tsx:522](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L522) |
| `PlatformOrderPages.e23d6cf3` | 写死 | 行李 | 名称 | [PlatformOrderPages.tsx:523](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L523) |
| `PlatformOrderPages.101425e2` | 写死 | 备注 | 名称 | [PlatformOrderPages.tsx:524](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L524)、668 行 |
| `PlatformOrderPages.6bbe1aa2` | 写死 | 现在的备注含联系方式，已打码。留空不改，填写则整条替换。 | 说明 | [PlatformOrderPages.tsx:524](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L524) |
| `PlatformOrderPages.9689cf86` | 写死 | 乘客邮箱已经有一次修改（改成 {email\_masked}）在等另一位同事批准，处理完之前不能再改邮箱。 | 正文 | [PlatformOrderPages.tsx:526](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L526) |
| `PlatformOrderPages.60121f6c` | 写死 | 留空不改。改邮箱需要另一位同事批准 | 说明 | [PlatformOrderPages.tsx:528](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L528) |
| `PlatformOrderPages.7f930dd2` | 写死 | 乘客的新邮箱 | 名称 | [PlatformOrderPages.tsx:528](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L528) |
| `PlatformOrderPages.882561c4` | 写死 | 改乘客邮箱需要另一位同事批准：之后带订单链接的通知都会发到新邮箱，等于把订单交给这个邮箱的主人。批准前订单上的邮箱不变，通知照旧发到原来的邮箱；同一次提交的其他内容照常处理。 | 提示 | [PlatformOrderPages.tsx:532](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L532) |
| `PlatformOrderPages.5a39dac9` | 写死 | 怎么核实的客人身份 | 名称 | [PlatformOrderPages.tsx:533](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L533) |
| `PlatformOrderPages.70651b90` | 写死 | 请选择 | 输入框占位 | [PlatformOrderPages.tsx:533](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L533) |
| `PlatformOrderPages.9d2e36cd` | 写死 | 如「客人来电说邮箱写错一个字母，回拨下单电话确认是本人」。审核的同事据此决定，记进审计日志。 | 说明 | [PlatformOrderPages.tsx:534](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L534) |
| `PlatformOrderPages.b726f0ad` | 写死 | 出了免费取消期只能改航班号和乘客信息；车型、品类、城市、上下车点的位置不能改（请取消后重新下单）。 | 正文 | [PlatformOrderPages.tsx:537](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L537) |
| `PlatformOrderPages.bdf56682` | 写死 | 部分通过的金额写成大于 0 的数，如 3000 | 文字 | [PlatformOrderPages.tsx:553](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L553) |
| `PlatformOrderPages.00e87392` | 写死 | 已驳回，不向客人收 | 文字 | [PlatformOrderPages.tsx:560](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L560) |
| `PlatformOrderPages.36872824` | 写死 | 已通过：{label} | 文字 | [PlatformOrderPages.tsx:560](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L560) |
| `PlatformOrderPages.85f46aab` | 写死 | 已通过，已从客人保存的卡上扣款 | 文字 | [PlatformOrderPages.tsx:560](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L560) |
| `PlatformOrderPages.2ed811f8` | 写死 | 审核 | 文字 | [PlatformOrderPages.tsx:562](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L562)、827 行 |
| `PlatformOrderPages.92fd081c` | 写死 | 审核加收：{…} | 标题 | [PlatformOrderPages.tsx:570](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L570) |
| `PlatformOrderPages.0f14a7de` | 写死 | 驳回 | 按钮 | [PlatformOrderPages.tsx:578](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L578) |
| `PlatformOrderPages.d6d93c32` | 写死 | 通过 | 按钮 | [PlatformOrderPages.tsx:581](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L581) |
| `PlatformOrderPages.f620d7ad` | 写死 | 供应商报的 | 名称 | [PlatformOrderPages.tsx:586](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L586) |
| `PlatformOrderPages.bcfd2bc6` | 写死 | 客人要付 | 名称 | [PlatformOrderPages.tsx:587](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L587) |
| `PlatformOrderPages.c4d3dcc3` | 写死 | 转人工的原因 | 名称 | [PlatformOrderPages.tsx:588](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L588) |
| `PlatformOrderPages.6054f590` | 写死 | 供应商的说明 | 名称 | [PlatformOrderPages.tsx:589](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L589) |
| `PlatformOrderPages.b16a6e22` | 写死 | 客人的异议 | 名称 | [PlatformOrderPages.tsx:590](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L590) |
| `PlatformOrderPages.004efec1` | 写死 | 部分通过的金额（{currency}，不填就是全额） | 名称 | [PlatformOrderPages.tsx:592](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L592) |
| `PlatformOrderPages.3c0d865c` | 写死 | 说明 | 名称 | [PlatformOrderPages.tsx:593](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L593)、705、731 行 |
| `PlatformOrderPages.ef68df53` | 写死 | 订单详情 | 文字 | [PlatformOrderPages.tsx:615](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L615) |
| `PlatformOrderPages.5470e4ab` | 写死 | 订单不存在 | 标题 | [PlatformOrderPages.tsx:621](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L621) |
| `PlatformOrderPages.64fad53b` | 写死 | 可能是链接写错了。 | 说明 | [PlatformOrderPages.tsx:621](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L621) |
| `PlatformOrderPages.d1d2b65e` | 写死 | 订单没取到 | 标题 | [PlatformOrderPages.tsx:622](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L622) |
| `PlatformOrderPages.e9ef5413` | 写死 | 加载中… | 正文 | [PlatformOrderPages.tsx:622](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L622) |
| `PlatformOrderPages.fbba91d0` | 写死 | 请检查网络后刷新。 | 说明 | [PlatformOrderPages.tsx:622](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L622) |
| `PlatformOrderPages.00a3a4a4` | 写死 | 行程 | 标题 | [PlatformOrderPages.tsx:645](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L645)、651 行 |
| `PlatformOrderPages.e6e60258` | 写死 | 用车时间（当地，{zone}） | 名称 | [PlatformOrderPages.tsx:650](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L650) |
| `PlatformOrderPages.ae0563c3` | 写死 | 乘客邮箱（等审核） | 名称 | [PlatformOrderPages.tsx:659](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L659) |
| `PlatformOrderPages.b38c5099` | 写死 | 改成 {email\_masked} 在等另一位同事批准（{name} 发起），批准前订单上的邮箱不变，通知照旧发到原来的邮箱。 | 提示 | [PlatformOrderPages.tsx:661](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L661) |
| `PlatformOrderPages.55b31783` | 写死 | 去待审核 | 链接 | [PlatformOrderPages.tsx:664](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L664) |
| `PlatformOrderPages.234fb2ce` | 写死 | 来源 | 名称 | [PlatformOrderPages.tsx:671](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L671) |
| `PlatformOrderPages.ba4ac2da` | 写死 | 对外价 / 结算价 | 名称 | [PlatformOrderPages.tsx:672](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L672) |
| `PlatformOrderPages.cf059980` | 写死 | {…} / {…}（加价 {…}%） | 正文 | [PlatformOrderPages.tsx:672](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L672) |
| `PlatformOrderPages.3578fe53` | 写死 | 第 {version} 版 · {…}：{…} | 正文 | [PlatformOrderPages.tsx:673](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L673) |
| `PlatformOrderPages.5beab1ce` | 写死 | 取消政策 | 名称 | [PlatformOrderPages.tsx:673](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L673) |
| `PlatformOrderPages.791bc6b3` | 写死 | 按现在的平台政策 | 正文 | [PlatformOrderPages.tsx:673](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L673) |
| `PlatformOrderPages.8c617199` | 写死 | 付款前取消，不涉及钱 | 正文 | [PlatformOrderPages.tsx:706](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L706) |
| `PlatformOrderPages.dc35610b` | 写死 | 客人被扣 | 名称 | [PlatformOrderPages.tsx:707](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L707) |
| `PlatformOrderPages.9a5bd8a2` | 写死 | 收款与退款 | 标题 | [PlatformOrderPages.tsx:714](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L714) |
| `PlatformOrderPages.536274b3` | 写死 |  · 已退 {…} | 正文 | [PlatformOrderPages.tsx:718](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L718) |
| `PlatformOrderPages.53ec196f` | 写死 | 事后加收 | 正文 | [PlatformOrderPages.tsx:718](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L718)、799、803 行 |
| `PlatformOrderPages.642231a3` | 写死 | 下单付款 | 正文 | [PlatformOrderPages.tsx:718](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L718) |
| `PlatformOrderPages.a0452c8c` | 写死 | 改期补差价 | 正文 | [PlatformOrderPages.tsx:718](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L718) |
| `PlatformOrderPages.f694c48f` | 写死 |  · 被拒：{decline\_code} | 正文 | [PlatformOrderPages.tsx:718](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L718) |
| `PlatformOrderPages.4e3db3fe` | 写死 | 退款表 | 读屏说明 | [PlatformOrderPages.tsx:723](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L723) |
| `PlatformOrderPages.8bf55359` | 写死 | 退款 | 正文 | [PlatformOrderPages.tsx:725](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L725)、728 行 |
| `PlatformOrderPages.c2b55342` | 写死 | 金额 | 表头 | [PlatformOrderPages.tsx:729](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L729) |
| `PlatformOrderPages.6d3b4a8c` | 写死 | （重试） | 表头 | [PlatformOrderPages.tsx:737](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L737) |
| `PlatformOrderPages.77088de2` | 写死 | 工单赔付 | 表头 | [PlatformOrderPages.tsx:737](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L737) |
| `PlatformOrderPages.a063b2f1` | 写死 | 改单差价 | 表头 | [PlatformOrderPages.tsx:737](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L737) |
| `PlatformOrderPages.7c12f747` | 写死 | 已并入取消退款，不再重试 | 正文 | [PlatformOrderPages.tsx:744](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L744) |
| `PlatformOrderPages.340ae243` | 写死 | 已重新发起退款 | 文字 | [PlatformOrderPages.tsx:746](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L746) |
| `PlatformOrderPages.354533e5` | 写死 | 重试退款 | 文字 | [PlatformOrderPages.tsx:746](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L746)、748 行 |
| `PlatformOrderPages.e2fea002` | 写死 | ；对外价 {…} → {…} | 正文 | [PlatformOrderPages.tsx:772](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L772) |
| `PlatformOrderPages.7adde571` | 写死 | （原来派的司机或车辆在新时段有别的单） | 正文 | [PlatformOrderPages.tsx:773](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L773) |
| `PlatformOrderPages.072e51a7` | 写死 | （平台代为处理） | 正文 | [PlatformOrderPages.tsx:774](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L774) |
| `PlatformOrderPages.22eb0f4c` | 写死 | ；说明：{decision\_note} | 正文 | [PlatformOrderPages.tsx:775](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L775) |
| `PlatformOrderPages.7d897af8` | 写死 | 代同意 | 按钮 | [PlatformOrderPages.tsx:780](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L780) |
| `PlatformOrderPages.476d5e9a` | 写死 | 代标调整中 | 按钮 | [PlatformOrderPages.tsx:784](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L784) |
| `PlatformOrderPages.0b7c01e0` | 写死 | 代拒绝 | 按钮 | [PlatformOrderPages.tsx:788](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L788) |
| `PlatformOrderPages.7b7c288d` | 写死 | 事后加收表 | 读屏说明 | [PlatformOrderPages.tsx:801](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L801) |
| `PlatformOrderPages.fc4dbd45` | 写死 | 类型 | 表头 | [PlatformOrderPages.tsx:806](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L806) |
| `PlatformOrderPages.2d7e9f31` | 写死 | 供应商报的 / 客人付 | 表头 | [PlatformOrderPages.tsx:807](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L807) |
| `PlatformOrderPages.d8b478ed` | 写死 | 异议期到 | 表头 | [PlatformOrderPages.tsx:809](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L809) |
| `PlatformOrderPages.bb9751c4` | 写死 | 操作 | 表头 | [PlatformOrderPages.tsx:810](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L810) |
| `PlatformOrderPages.2e54dc4d` | 写死 | 已重新扣款 | 文字 | [PlatformOrderPages.tsx:830](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L830) |
| `PlatformOrderPages.cfaca3bf` | 写死 | 重试扣款 | 文字 | [PlatformOrderPages.tsx:830](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L830)、832 行 |
| `PlatformOrderPages.8bb90c28` | 写死 | 提交后 48 小时是客人的异议期，期间不扣款；之后没有异议、不超过对外价 50%、有凭证的自动从客人保存的卡上扣，其余在这里审核。 | 正文 | [PlatformOrderPages.tsx:841](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L841) |
| `PlatformOrderPages.2e4204ae` | 写死 | 通知 | 标题 | [PlatformOrderPages.tsx:849](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L849) |
| `PlatformOrderPages.e93780f8` | 写死 | 看这一单发过哪些通知 | 链接 | [PlatformOrderPages.tsx:853](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L853) |
| `PlatformOrderPages.101a5762` | 写死 | 这一单没有异常。 | 正文 | [PlatformOrderPages.tsx:863](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L863) |
| `PlatformOrderPages.3587e5e6` | 写死 | 人工处理完 | 正文 | [PlatformOrderPages.tsx:875](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L875) |
| `PlatformOrderPages.8fc1fb9a` | 写死 | 发现 {…} · 时限 {…}{…} | 正文 | [PlatformOrderPages.tsx:875](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L875) |
| `PlatformOrderPages.e3237feb` | 写死 | 条件已解除 | 正文 | [PlatformOrderPages.tsx:875](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L875) |
| `PlatformOrderPages.e3cfe882` | 写死 |  · 关闭 {…}（{…}） | 正文 | [PlatformOrderPages.tsx:875](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L875) |
| `PlatformOrderPages.b45e5eb0` | 写死 | 工单 | 标题 | [PlatformOrderPages.tsx:886](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L886) |
| `PlatformOrderPages.34c8df0e` | 写死 | 新建工单 | 按钮 | [PlatformOrderPages.tsx:890](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L890) |
| `PlatformOrderPages.04d634ca` | 写死 | 这一单没有工单。 | 正文 | [PlatformOrderPages.tsx:894](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L894) |
| `PlatformOrderPages.683729f1` | 写死 | 状态流水 | 标题 | [PlatformOrderPages.tsx:919](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L919) |
| `PlatformOrderPages.56524082` | 写死 | 平台代传 | 正文 | [PlatformOrderPages.tsx:929](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L929) |
| `PlatformOrderPages.0d3c9286` | 写死 | ；原因：{reason} | 正文 | [PlatformOrderPages.tsx:930](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L930) |
| `PlatformOrderPages.28d3167f` | 写死 |  系统记录 {…}{…} | 正文 | [PlatformOrderPages.tsx:930](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L930) |
| `PlatformOrderPages.e461066b` | 写死 | 订单 {order\_no} | 文字 | [PlatformOrderPages.tsx:943](../../apps/web/src/pages/platform/PlatformOrderPages.tsx#L943) |
| `ProxyFulfilment.397c98fa` | 写死 | 这一单还没派车。履约不能跳过派车，要等供应商派车后才能代传。 | 文字 | [ProxyFulfilment.tsx:24](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L24) |
| `ProxyFulfilment.67efd742` | 写死 | 请填发生时间（当地时间） | 文字 | [ProxyFulfilment.tsx:48](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L48) |
| `ProxyFulfilment.222b512b` | 写死 | 请写明为什么要代传（会记进审计日志） | 文字 | [ProxyFulfilment.tsx:52](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L52) |
| `ProxyFulfilment.ef4fb34f` | 写死 | 包车完成要填实际用了多少分钟、跑了多少公里（整数） | 文字 | [ProxyFulfilment.tsx:58](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L58) |
| `ProxyFulfilment.b4883d49` | 写死 | 已提交：要另一位同事在「待审核」里批准，「{…}」才生效 | 文字 | [ProxyFulfilment.tsx:65](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L65) |
| `ProxyFulfilment.f48ba846` | 写死 | 已代传：{…} | 文字 | [ProxyFulfilment.tsx:65](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L65) |
| `ProxyFulfilment.21dd4b78` | 写死 | 这一单的状态已经变了（可能供应商或司机刚回传） | 文字 | [ProxyFulfilment.tsx:69](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L69) |
| `ProxyFulfilment.97c06b18` | 写死 | {…}，请看最新状态后再决定。 | 文字 | [ProxyFulfilment.tsx:69](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L69) |
| `ProxyFulfilment.34fb0532` | 写死 | 代传 | 文字 | [ProxyFulfilment.tsx:70](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L70)、71 行 |
| `ProxyFulfilment.31c5d9a1` | 写死 | 代供应商回传：{…} | 标题 | [ProxyFulfilment.tsx:79](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L79) |
| `ProxyFulfilment.5d0672ae` | 写死 | 不代传了 | 按钮 | [ProxyFulfilment.tsx:87](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L87) |
| `ProxyFulfilment.cef0a2e4` | 写死 | 确认代传 | 按钮 | [ProxyFulfilment.tsx:89](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L89) |
| `ProxyFulfilment.e9d47994` | 写死 | 提交审核 | 按钮 | [ProxyFulfilment.tsx:89](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L89) |
| `ProxyFulfilment.9ba62720` | 写死 | 只在供应商系统故障、无法自己回传时使用。 | 正文 | [ProxyFulfilment.tsx:94](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L94) |
| `ProxyFulfilment.4513cfd4` | 写死 | 实际发生的时间，不能晚于现在，不能早于上一步，也不能早于用车前 {…} 小时；{maxBackdateDays} 天以前的请走工单。 | 说明 | [ProxyFulfilment.tsx:95](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L95) |
| `ProxyFulfilment.52342c44` | 写死 | 发生时间（当地，{zone}） | 名称 | [ProxyFulfilment.tsx:95](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L95) |
| `ProxyFulfilment.26b39976` | 写死 | 如「供应商调度系统故障，已电话和司机确认」。只有平台能看到，记进审计日志。 | 说明 | [ProxyFulfilment.tsx:96](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L96) |
| `ProxyFulfilment.96715d18` | 写死 | 原因 | 名称 | [ProxyFulfilment.tsx:96](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L96) |
| `ProxyFulfilment.73d05a5c` | 写死 | 实际时长（分钟） | 名称 | [ProxyFulfilment.tsx:99](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L99) |
| `ProxyFulfilment.66fd1cb1` | 写死 | 实际里程（公里） | 名称 | [ProxyFulfilment.tsx:100](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L100) |
| `ProxyFulfilment.e6077f74` | 写死 | 供应商看得到这一步是平台代传的，以及发生时间和系统记录时间；看不到原因和操作人。 | 正文 | [ProxyFulfilment.tsx:103](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L103) |
| `ProxyFulfilment.d58beeff` | 写死 | 代传的「已到达」没有司机定位：这一单之后不能再提交客人未出现（no-show）。司机还能打开链接的话，请让司机自己点。 | 提示 | [ProxyFulfilment.tsx:104](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L104) |
| `ProxyFulfilment.50b963fc` | 写死 | 接到客人之后，这一单不能再取消，也不能再提交客人未出现（no-show），而且不能撤销：提交后要另一位有权限的同事（财务或运营）批准才生效。 | 提示 | [ProxyFulfilment.tsx:105](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L105) |
| `ProxyFulfilment.6b78dd66` | 写死 | 已完成的单会进供应商账单，而且不能撤销：提交后要另一位有权限的同事（财务或运营）批准才生效。事后加收和投诉的时限从批准时算起。 | 提示 | [ProxyFulfilment.tsx:106](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L106) |
| `ProxyFulfilment.99f7439e` | 写死 | 代供应商回传履约 | 标题 | [ProxyFulfilment.tsx:131](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L131) |
| `ProxyFulfilment.9301a091` | 写死 | 代传「{…}」在等另一位同事批准，批准后才生效。 | 提示 | [ProxyFulfilment.tsx:134](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L134) |
| `ProxyFulfilment.d1d8228e` | 写死 | 去待审核 | 链接 | [ProxyFulfilment.tsx:137](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L137) |
| `ProxyFulfilment.ad84d7f1` | 写死 | 下一步：{…} | 正文 | [ProxyFulfilment.tsx:143](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L143) |
| `ProxyFulfilment.c5c3964a` | 写死 | 代传「{…}」 | 按钮 | [ProxyFulfilment.tsx:145](../../apps/web/src/pages/platform/ProxyFulfilment.tsx#L145) |
| `ViewLinkResend.eb95d965` | 写死 | 这不是官网的订单：客人的通知由下单的渠道发，平台不发订单链接。 | 文字 | [ViewLinkResend.tsx:27](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L27) |
| `ViewLinkResend.e5637310` | 写死 | 这张单的乘客信息已按隐私规则清除，链接也已作废，不能再发。 | 文字 | [ViewLinkResend.tsx:28](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L28) |
| `ViewLinkResend.a7adf806` | 写死 | 这张单没有下单邮箱：核实客人身份后，可以发到核实后的新邮箱（要另一位同事审核）。 | 文字 | [ViewLinkResend.tsx:29](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L29) |
| `ViewLinkResend.13f78785` | 写死 | 等审核 | 文字 | [ViewLinkResend.tsx:32](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L32) |
| `ViewLinkResend.353b9150` | 写死 | 已排进通知中心 | 文字 | [ViewLinkResend.tsx:32](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L32) |
| `ViewLinkResend.c9f2df14` | 写死 | 已驳回或撤回 | 文字 | [ViewLinkResend.tsx:32](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L32) |
| `ViewLinkResend.2eb679bb` | 写死 | 新邮箱 | 文字 | [ViewLinkResend.tsx:33](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L33) |
| `ViewLinkResend.c6e230d2` | 写死 | 下单邮箱 | 文字 | [ViewLinkResend.tsx:33](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L33) |
| `ViewLinkResend.9ae94f2f` | 写死 | {…}（东京） | 文字 | [ViewLinkResend.tsx:35](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L35) |
| `ViewLinkResend.23727b59` | 写死 | 直接发出，不用审核 | 说明 | [ViewLinkResend.tsx:49](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L49) |
| `ViewLinkResend.9cd32ba5` | 写死 | 发到下单邮箱 {…} | 名称 | [ViewLinkResend.tsx:49](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L49) |
| `ViewLinkResend.578c3b71` | 写死 | 发到核实后的新邮箱 | 名称 | [ViewLinkResend.tsx:50](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L50) |
| `ViewLinkResend.8d389d71` | 写死 | 等于把订单交给这个邮箱的主人：要另一位同事在「待审核」里批准才发。订单上的邮箱不改，客人打开链接后可以自己改 | 说明 | [ViewLinkResend.tsx:50](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L50) |
| `ViewLinkResend.9b33cafc` | 写死 | 请填写核实过的新邮箱 | 文字 | [ViewLinkResend.tsx:55](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L55) |
| `ViewLinkResend.b3904edf` | 写死 | 请选怎么核实的客人身份 | 文字 | [ViewLinkResend.tsx:56](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L56) |
| `ViewLinkResend.8b847d76` | 写死 | 请写明为什么要重发、核实了什么（会记进审计日志） | 文字 | [ViewLinkResend.tsx:57](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L57) |
| `ViewLinkResend.35233f34` | 写死 | 已提交：要另一位同事在「待审核」里批准，才会发到 {email\_masked} | 文字 | [ViewLinkResend.tsx:64](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L64) |
| `ViewLinkResend.d52745de` | 写死 | 已排进通知中心，发到 {email\_masked} | 文字 | [ViewLinkResend.tsx:64](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L64) |
| `ViewLinkResend.87d4b42d` | 写死 | 重发订单链接 | 文字 | [ViewLinkResend.tsx:67](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L67)、69、147 行 |
| `ViewLinkResend.6e2c647e` | 写死 | 这张单这一小时已经重发了 5 次，请稍后再试。 | 文字 | [ViewLinkResend.tsx:68](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L68) |
| `ViewLinkResend.af7b287a` | 写死 | 重发官网订单链接 | 标题 | [ViewLinkResend.tsx:77](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L77) |
| `ViewLinkResend.6183627d` | 写死 | 不发了 | 按钮 | [ViewLinkResend.tsx:85](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L85) |
| `ViewLinkResend.90d01458` | 写死 | 发送 | 按钮 | [ViewLinkResend.tsx:87](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L87) |
| `ViewLinkResend.feb52a27` | 写死 | 提交审核 | 按钮 | [ViewLinkResend.tsx:87](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L87) |
| `ViewLinkResend.5dba5fa2` | 写死 | 先核实是客人本人（回拨下单电话、核对订单细节或付款信息），再发。链接在发信时新签发，客人以前收到的链接继续有效。 | 正文 | [ViewLinkResend.tsx:92](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L92) |
| `ViewLinkResend.d87ef9e9` | 写死 | 发到哪里 | 标题 | [ViewLinkResend.tsx:93](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L93) |
| `ViewLinkResend.f7db3385` | 写死 | 核实后的新邮箱 | 名称 | [ViewLinkResend.tsx:95](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L95) |
| `ViewLinkResend.2cf48564` | 写死 | 怎么核实的 | 名称 | [ViewLinkResend.tsx:97](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L97) |
| `ViewLinkResend.8442a9e3` | 写死 | 请选择 | 输入框占位 | [ViewLinkResend.tsx:97](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L97) |
| `ViewLinkResend.284b4865` | 写死 | 原因 | 名称 | [ViewLinkResend.tsx:98](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L98) |
| `ViewLinkResend.51e63075` | 写死 | 如「客人来电说邮箱写错一个字母，回拨下单电话确认是本人」。只有平台能看到，记进审计日志。 | 说明 | [ViewLinkResend.tsx:98](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L98) |
| `ViewLinkResend.adc239b9` | 写死 | 官网订单链接 | 标题 | [ViewLinkResend.tsx:127](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L127) |
| `ViewLinkResend.93880aff` | 写死 | 客人在官网「查订单」只能把链接发到下单邮箱。只留了手机号、邮箱填错的客人联系客服时，在这里核实后重发。 | 正文 | [ViewLinkResend.tsx:128](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L128) |
| `ViewLinkResend.740414c1` | 写死 | 下单邮箱： | 正文 | [ViewLinkResend.tsx:132](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L132) |
| `ViewLinkResend.3fbcf906` | 写死 | 发到新邮箱 {email\_masked} 在等另一位同事批准，批准后才发。 | 提示 | [ViewLinkResend.tsx:137](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L137) |
| `ViewLinkResend.6d5b5c47` | 写死 | 去待审核 | 链接 | [ViewLinkResend.tsx:140](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L140) |
| `ViewLinkResend.a2ea8515` | 写死 | 重发记录 | 读屏说明 | [ViewLinkResend.tsx:152](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L152)、154 行 |
| `ViewLinkResend.a9c3818f` | 写死 | 时间 | 表头 | [ViewLinkResend.tsx:157](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L157) |
| `ViewLinkResend.f92fdc76` | 写死 | 发到 | 表头 | [ViewLinkResend.tsx:158](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L158) |
| `ViewLinkResend.9ea54927` | 写死 | 核实方式 | 表头 | [ViewLinkResend.tsx:159](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L159) |
| `ViewLinkResend.824d292f` | 写死 | 发起人 | 表头 | [ViewLinkResend.tsx:160](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L160) |
| `ViewLinkResend.d2957624` | 写死 | 状态 | 表头 | [ViewLinkResend.tsx:161](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L161) |
| `ViewLinkResend.c924988c` | 写死 | 「已排进通知中心」之后发没发出去，看这张单的通知记录（邮件服务器已接收不代表客人已收到）。 | 正文 | [ViewLinkResend.tsx:181](../../apps/web/src/pages/platform/ViewLinkResend.tsx#L181) |

## 取消政策

文件：`apps/web/src/pages/platform/CancellationPolicyPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CancellationPolicyPage.6f1b6130` | 写死 | 你没有权限查看这里 | 标题 | [CancellationPolicyPage.tsx:28](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L28) |
| `CancellationPolicyPage.966aa5c4` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [CancellationPolicyPage.tsx:28](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L28) |
| `CancellationPolicyPage.b306d366` | 写死 | 每个品类 × 车型级别都要有阶梯 | 文字 | [CancellationPolicyPage.tsx:60](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L60) |
| `CancellationPolicyPage.a917e66c` | 写死 | 重复了 | 文字 | [CancellationPolicyPage.tsx:61](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L61) |
| `CancellationPolicyPage.6e551cbe` | 写死 | 没有这个品类或车型级别 | 文字 | [CancellationPolicyPage.tsx:62](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L62) |
| `CancellationPolicyPage.239b0f05` | 写死 | 每条 1 到 5 档 | 文字 | [CancellationPolicyPage.tsx:63](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L63) |
| `CancellationPolicyPage.078f0c87` | 写死 | 小时数要是 0 到 720 的整数 | 提示 | [CancellationPolicyPage.tsx:64](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L64) |
| `CancellationPolicyPage.05b4d4b5` | 写死 | 小时数要从上到下越来越小 | 文字 | [CancellationPolicyPage.tsx:65](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L65) |
| `CancellationPolicyPage.56bbe026` | 写死 | 最后一档要是 0 小时（到用车时间为止） | 文字 | [CancellationPolicyPage.tsx:66](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L66) |
| `CancellationPolicyPage.e8b948b0` | 写死 | 扣款比例要在 0% 到 100% 之间 | 提示 | [CancellationPolicyPage.tsx:67](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L67) |
| `CancellationPolicyPage.96cc735c` | 写死 | 越接近用车扣得越多：这一档不能比上一档扣得少 | 文字 | [CancellationPolicyPage.tsx:68](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L68) |
| `CancellationPolicyPage.15f23c32` | 写死 | 取消政策 · NOZOMI {name} | 浏览器标题 | [CancellationPolicyPage.tsx:73](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L73) |
| `CancellationPolicyPage.2730d207` | 写死 | 取消政策 | 名称 | [CancellationPolicyPage.tsx:83](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L83) |
| `CancellationPolicyPage.6747edb7` | 写死 | 订单 | 名称 | [CancellationPolicyPage.tsx:83](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L83) |
| `CancellationPolicyPage.940671d4` | 写死 | 平台统一取消政策 | 标题 | [CancellationPolicyPage.tsx:84](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L84) |
| `CancellationPolicyPage.0ba7185c` | 写死 | 加载中… | 正文 | [CancellationPolicyPage.tsx:91](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L91) |
| `CancellationPolicyPage.226dbd57` | 写死 | 请检查网络后刷新。 | 说明 | [CancellationPolicyPage.tsx:91](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L91) |
| `CancellationPolicyPage.9ec383e7` | 写死 | 取消政策没取到 | 标题 | [CancellationPolicyPage.tsx:91](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L91) |
| `CancellationPolicyPage.b9864bd2` | 写死 | 有格子写得不对：小时数写整数（如 24），扣款比例写百分比（如 50） | 文字 | [CancellationPolicyPage.tsx:97](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L97) |
| `CancellationPolicyPage.f6097164` | 写死 | 和现在的政策一样，不用提交 | 文字 | [CancellationPolicyPage.tsx:107](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L107) |
| `CancellationPolicyPage.f48c3516` | 写死 | 已提交，等另一位同事审核后生效 | 提示 | [CancellationPolicyPage.tsx:114](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L114) |
| `CancellationPolicyPage.5ce8082e` | 写死 | 提交 | 文字 | [CancellationPolicyPage.tsx:119](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L119) |
| `CancellationPolicyPage.fa4416e5` | 写死 | 客人付款前不知道订单会给哪家供应商，所以取消政策由平台按品类和车型级别统一规定，所有供应商相同（第五轮决策 ④）。取消时按距用车还有多久落在哪一档，扣对外价的这个比例；供应商得结算价 × 同一比例。航班取消（有证明）、不可抗力、平台或供应商原因的取消一律免费。 | 正文 | [CancellationPolicyPage.tsx:133](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L133) |
| `CancellationPolicyPage.0d87ba89` | 写死 | 现在是第 {version} 版，{…} 起生效。 | 正文 | [CancellationPolicyPage.tsx:135](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L135) |
| `CancellationPolicyPage.285f7b21` | 写死 | 现在用的是需求里的默认政策（还没有人改过）。 | 正文 | [CancellationPolicyPage.tsx:135](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L135) |
| `CancellationPolicyPage.d6f500d8` | 写死 | {…}只对之后下的单生效：已经下了的单按下单时的那一版。 | 正文 | [CancellationPolicyPage.tsx:135](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L135) |
| `CancellationPolicyPage.b367c621` | 写死 | 修改政策 | 按钮 | [CancellationPolicyPage.tsx:140](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L140) |
| `CancellationPolicyPage.6013b256` | 写死 | 改好后提交，不会立即生效：要另一位同事在「待审核」里批准。 | 提示 | [CancellationPolicyPage.tsx:143](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L143) |
| `CancellationPolicyPage.fbe7cdaa` | 写死 | {…} · {…} 的阶梯 | 表单标签 | [CancellationPolicyPage.tsx:169](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L169) |
| `CancellationPolicyPage.fe15bb0b` | 写死 | 第 {…} 档：距用车不少于（小时） | 名称 | [CancellationPolicyPage.tsx:172](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L172) |
| `CancellationPolicyPage.e1402794` | 写死 | 第 {…} 档：扣对外价（%） | 名称 | [CancellationPolicyPage.tsx:173](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L173) |
| `CancellationPolicyPage.d14991ce` | 写死 | 删掉第 {…} 档 | 按钮 | [CancellationPolicyPage.tsx:176](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L176) |
| `CancellationPolicyPage.534838d9` | 写死 | 加一档 | 按钮 | [CancellationPolicyPage.tsx:184](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L184) |
| `CancellationPolicyPage.5e713dd3` | 写死 | 修改原因（给审核的同事看） | 名称 | [CancellationPolicyPage.tsx:196](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L196) |
| `CancellationPolicyPage.3f23c4b9` | 写死 | 提交审核 | 按钮 | [CancellationPolicyPage.tsx:200](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L200) |
| `CancellationPolicyPage.3efc6604` | 写死 | 放弃修改 | 按钮 | [CancellationPolicyPage.tsx:209](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L209) |
| `CancellationPolicyPage.9c718b91` | 写死 | 待审核 | 链接 | [CancellationPolicyPage.tsx:212](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L212) |
| `CancellationPolicyPage.ea141c45` | 写死 | 提交后到 | 正文 | [CancellationPolicyPage.tsx:212](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L212) |
| `CancellationPolicyPage.f1ffbd3c` | 写死 | 看进度。 | 正文 | [CancellationPolicyPage.tsx:212](../../apps/web/src/pages/platform/CancellationPolicyPage.tsx#L212) |
