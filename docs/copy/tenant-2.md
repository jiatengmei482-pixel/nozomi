# 供应商后台（第 2 / 2 份）

由 `pnpm copy:export` 从代码生成，不要手改。本区域共 3295 条：写死 3295 条，已走 key 0 条。列的意思见 [README](README.md)。

本区域分 2 份：[第 1 份](tenant.md) · 第 2 份

## 页面

- [多个页面共用：⑤ 商品详情（ContentStep.tsx）](#多个页面共用⑤-商品详情contentsteptsx)（44 条）
- [多个页面共用：商品「服务规则」里的取消规则（PlatformPolicyLines.tsx）](#多个页面共用商品服务规则里的取消规则platformpolicylinestsx)（5 条）
- [多个页面共用：商品的步骤导航和当前步骤（ProductSteps.tsx）](#多个页面共用商品的步骤导航和当前步骤productstepstsx)（20 条）
- [多个页面共用：上架检查（PublishStep.tsx）](#多个页面共用上架检查publishsteptsx)（75 条）
- [多个页面共用：② 服务规则（ServiceRulesStep.tsx）](#多个页面共用②-服务规则servicerulessteptsx)（173 条）
- [多个页面共用：商品配置各步骤「内容还没到手」时显示什么（StepLoadState.tsx）](#多个页面共用商品配置各步骤内容还没到手时显示什么steploadstatetsx)（7 条）
- [多个页面共用：一步的外壳（StepShell.tsx）](#多个页面共用一步的外壳stepshelltsx)（41 条）
- [多个页面共用：导入价格 / 导入库存（ImportPage.tsx）](#多个页面共用导入价格--导入库存importpagetsx)（130 条）
- [多个页面共用：④ 库存（InventoryStep.tsx）](#多个页面共用④-库存inventorysteptsx)（132 条）
- [多个页面共用：导出 / 下载模版（useDownload.tsx）](#多个页面共用导出--下载模版usedownloadtsx)（3 条）
- [多个页面共用：新建 / 编辑一条调价规则（AdjustRuleForm.tsx）](#多个页面共用新建--编辑一条调价规则adjustruleformtsx)（182 条）
- [多个页面共用：「调价规则」页签的列表（AdjustRulesTab.tsx）](#多个页面共用调价规则页签的列表adjustrulestabtsx)（93 条）
- [多个页面共用：包车「区域加价」块（AreaSurchargeBlock.tsx）](#多个页面共用包车区域加价块areasurchargeblocktsx)（136 条）
- [多个页面共用：「价格日历」页签（CalendarTab.tsx）](#多个页面共用价格日历页签calendartabtsx)（96 条）
- [多个页面共用：「价格规则」页签里的「计程价」小块（DistancePriceBlock.tsx）](#多个页面共用价格规则页签里的计程价小块distancepriceblocktsx)（76 条）
- [多个页面共用：包车三层区域的价格页（LayerTables.tsx）](#多个页面共用包车三层区域的价格页layertablestsx)（67 条）
- [多个页面共用：「价格规则」页签（PriceRulesTab.tsx）](#多个页面共用价格规则页签pricerulestabtsx)（203 条）
- [多个页面共用：③ 价格规则（PricesStep.tsx）](#多个页面共用③-价格规则pricessteptsx)（24 条）
- [多个页面共用：修改取整单位（RoundingUnitDialog.tsx）](#多个页面共用修改取整单位roundingunitdialogtsx)（22 条）
- [多个页面共用：点对点「线路价」的选线路和两个对话框（RouteDialogs.tsx）](#多个页面共用点对点线路价的选线路和两个对话框routedialogstsx)（55 条）
- [多个页面共用：商品的下架（useProductActions.tsx）](#多个页面共用商品的下架useproductactionstsx)（18 条）

## 多个页面共用：⑤ 商品详情（ContentStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/ContentStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ContentStep.0b81ccea` | 写死 | 接机指引 | 名称 | [ContentStep.tsx:66](../../apps/web/src/pages/products/ContentStep.tsx#L66) |
| `ContentStep.c91e682f` | 写死 | 接站指引 | 名称 | [ContentStep.tsx:66](../../apps/web/src/pages/products/ContentStep.tsx#L66) |
| `ContentStep.1b9ee26d` | 写死 | 简介 | 说明 | [ContentStep.tsx:67](../../apps/web/src/pages/products/ContentStep.tsx#L67) |
| `ContentStep.83acfc64` | 写死 | 不含 | 文字 | [ContentStep.tsx:67](../../apps/web/src/pages/products/ContentStep.tsx#L67)、257 行 |
| `ContentStep.8c5d04d8` | 写死 | 包含 | 文字 | [ContentStep.tsx:67](../../apps/web/src/pages/products/ContentStep.tsx#L67)、256 行 |
| `ContentStep.d492f3b0` | 写死 | 标题 | 标题 | [ContentStep.tsx:67](../../apps/web/src/pages/products/ContentStep.tsx#L67)、241 行 |
| `ContentStep.f55d418d` | 写死 | 行程路线 | 文字 | [ContentStep.tsx:67](../../apps/web/src/pages/products/ContentStep.tsx#L67) |
| `ContentStep.e1654b13` | 写死 | ⑤ 商品详情 | 标题 | [ContentStep.tsx:92](../../apps/web/src/pages/products/ContentStep.tsx#L92)、145 行 |
| `ContentStep.168d8874` | 写死 | {…}的{…} | 名称 | [ContentStep.tsx:103](../../apps/web/src/pages/products/ContentStep.tsx#L103) |
| `ContentStep.8064a7e5` | 写死 | 内容 | 名称 | [ContentStep.tsx:103](../../apps/web/src/pages/products/ContentStep.tsx#L103) |
| `ContentStep.4a83b914` | 写死 | {name}第 {…} 条 | 名称 | [ContentStep.tsx:105](../../apps/web/src/pages/products/ContentStep.tsx#L105) |
| `ContentStep.1fc95f81` | 写死 | {label}最多 {max} 条 | 文字 | [ContentStep.tsx:112](../../apps/web/src/pages/products/ContentStep.tsx#L112) |
| `ContentStep.635d02c8` | 写死 | {label}最多 {max} 个字 | 文字 | [ContentStep.tsx:112](../../apps/web/src/pages/products/ContentStep.tsx#L112) |
| `ContentStep.293adaa2` | 写死 | 这里的内容会显示给客人。至少要有一种语言填了标题；客人用哪种语言看这个商品，就看到哪种语言的内容。使用条款、取消政策、附加费用这些文字以后由平台的模版按你设的规则自动生成，不用在这里写。 | 正文 | [ContentStep.tsx:145](../../apps/web/src/pages/products/ContentStep.tsx#L145) |
| `ContentStep.627b3809` | 写死 | 保存并看上架检查 | 名称 | [ContentStep.tsx:145](../../apps/web/src/pages/products/ContentStep.tsx#L145) |
| `ContentStep.f7fe81d3` | 写死 | 这里的内容会显示给客人：客人用哪种语言看这个商品，就看到哪种语言的内容。使用条款、取消政策、附加费用这些文字以后由平台的模版按服务规则自动生成。 | 正文 | [ContentStep.tsx:145](../../apps/web/src/pages/products/ContentStep.tsx#L145) |
| `ContentStep.1316b6a4` | 写死 | 没有填 | 文字 | [ContentStep.tsx:162](../../apps/web/src/pages/products/ContentStep.tsx#L162) |
| `ContentStep.6a278691` | 写死 | 还没有标题，这种语言不会显示给客人 | 文字 | [ContentStep.tsx:164](../../apps/web/src/pages/products/ContentStep.tsx#L164) |
| `ContentStep.d2c27798` | 写死 | 还差{guideName} | 文字 | [ContentStep.tsx:166](../../apps/web/src/pages/products/ContentStep.tsx#L166) |
| `ContentStep.267bd9b2` | 写死 | 已填 | 文字 | [ContentStep.tsx:167](../../apps/web/src/pages/products/ContentStep.tsx#L167) |
| `ContentStep.db7c396e` | 写死 | 上架前要填这一项。 | 正文 | [ContentStep.tsx:184](../../apps/web/src/pages/products/ContentStep.tsx#L184) |
| `ContentStep.e815388c` | 写死 | {label}（选填） | 表单标签 | [ContentStep.tsx:192](../../apps/web/src/pages/products/ContentStep.tsx#L192) |
| `ContentStep.ba409369` | 写死 | {name}{label}第 {…} 条 | 读屏说明 | [ContentStep.tsx:195](../../apps/web/src/pages/products/ContentStep.tsx#L195) |
| `ContentStep.66fa85e3` | 写死 | 删除{name}{label}第 {…} 条 | 名称 | [ContentStep.tsx:196](../../apps/web/src/pages/products/ContentStep.tsx#L196) |
| `ContentStep.cd303575` | 写死 | 添加一条 | 按钮 | [ContentStep.tsx:205](../../apps/web/src/pages/products/ContentStep.tsx#L205) |
| `ContentStep.a9792a2a` | 写死 |  最多 {maxListItems} 条 | 正文 | [ContentStep.tsx:206](../../apps/web/src/pages/products/ContentStep.tsx#L206) |
| `ContentStep.d9aa3e7d` | 写死 | 填写{name} | 按钮 | [ContentStep.tsx:233](../../apps/web/src/pages/products/ContentStep.tsx#L233) |
| `ContentStep.b3cb5633` | 写死 | 上架前至少一种语言要填标题。 | 正文 | [ContentStep.tsx:250](../../apps/web/src/pages/products/ContentStep.tsx#L250) |
| `ContentStep.14d1d034` | 写死 | 商品的名字，也是你们在后台列表里看到的名字。例如「羽田机场接送」「东京市内包车」。 | 正文 | [ContentStep.tsx:253](../../apps/web/src/pages/products/ContentStep.tsx#L253) |
| `ContentStep.3ffc8623` | 写死 | 商品的名字，客人和后台列表里看到的都是它。 | 正文 | [ContentStep.tsx:253](../../apps/web/src/pages/products/ContentStep.tsx#L253) |
| `ContentStep.fccd9a8c` | 写死 | 简介（选填） | 文字 | [ContentStep.tsx:255](../../apps/web/src/pages/products/ContentStep.tsx#L255) |
| `ContentStep.87d1e1d2` | 写死 | 价格里已经包含的。 | 文字 | [ContentStep.tsx:256](../../apps/web/src/pages/products/ContentStep.tsx#L256) |
| `ContentStep.a366c35a` | 写死 | 价格里已经包含的，一条写一项。例如「高速费」「停车费」「举牌接机」。 | 文字 | [ContentStep.tsx:256](../../apps/web/src/pages/products/ContentStep.tsx#L256) |
| `ContentStep.5f5b05d2` | 写死 | 价格里不包含、可能另收的。 | 文字 | [ContentStep.tsx:257](../../apps/web/src/pages/products/ContentStep.tsx#L257) |
| `ContentStep.77c8d59d` | 写死 | 价格里不包含、可能另收的，一条写一项。 | 文字 | [ContentStep.tsx:257](../../apps/web/src/pages/products/ContentStep.tsx#L257) |
| `ContentStep.b94db300` | 写死 | 推荐的行程或可以去的范围。 | 文字 | [ContentStep.tsx:258](../../apps/web/src/pages/products/ContentStep.tsx#L258) |
| `ContentStep.dfdcc21b` | 写死 | 行程路线（选填） | 文字 | [ContentStep.tsx:258](../../apps/web/src/pages/products/ContentStep.tsx#L258) |
| `ContentStep.48875ca6` | 写死 | 客人到达后怎么找到司机：在哪个出口、司机举什么牌、找不到时打哪个电话。 | 文字 | [ContentStep.tsx:259](../../apps/web/src/pages/products/ContentStep.tsx#L259) |
| `ContentStep.ab2b6819` | 写死 | 清空{name} | 按钮 | [ContentStep.tsx:263](../../apps/web/src/pages/products/ContentStep.tsx#L263) |
| `ContentStep.34062b1b` | 写死 | 还没有填任何一种语言的商品详情。 | 正文 | [ContentStep.tsx:274](../../apps/web/src/pages/products/ContentStep.tsx#L274) |
| `ContentStep.62b3ae19` | 写死 | 清空{…}的全部内容？ | 标题 | [ContentStep.tsx:279](../../apps/web/src/pages/products/ContentStep.tsx#L279) |
| `ContentStep.cc62144c` | 写死 | 取消 | 按钮 | [ContentStep.tsx:285](../../apps/web/src/pages/products/ContentStep.tsx#L285) |
| `ContentStep.411cea84` | 写死 | 清空 | 按钮 | [ContentStep.tsx:296](../../apps/web/src/pages/products/ContentStep.tsx#L296) |
| `ContentStep.d9121770` | 写死 | 保存后生效。 | 正文 | [ContentStep.tsx:300](../../apps/web/src/pages/products/ContentStep.tsx#L300) |

## 多个页面共用：商品「服务规则」里的取消规则（PlatformPolicyLines.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/PlatformPolicyLines.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PlatformPolicyLines.f0867a08` | 写死 | 正在取平台的取消政策… | 正文 | [PlatformPolicyLines.tsx:15](../../apps/web/src/pages/products/PlatformPolicyLines.tsx#L15) |
| `PlatformPolicyLines.4df724ee` | 写死 | 你的角色不能查看平台的取消政策。需要的话，请联系管理员调整角色的权限。 | 正文 | [PlatformPolicyLines.tsx:16](../../apps/web/src/pages/products/PlatformPolicyLines.tsx#L16) |
| `PlatformPolicyLines.4c1a6b77` | 写死 | 平台的取消政策没有加载出来。 | 正文 | [PlatformPolicyLines.tsx:19](../../apps/web/src/pages/products/PlatformPolicyLines.tsx#L19) |
| `PlatformPolicyLines.bfbffb97` | 写死 | 重试 | 按钮 | [PlatformPolicyLines.tsx:22](../../apps/web/src/pages/products/PlatformPolicyLines.tsx#L22) |
| `PlatformPolicyLines.3ac5770e` | 写死 | 平台的取消政策 | 读屏说明 | [PlatformPolicyLines.tsx:27](../../apps/web/src/pages/products/PlatformPolicyLines.tsx#L27) |

## 多个页面共用：商品的步骤导航和当前步骤（ProductSteps.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/ProductSteps.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ProductSteps.2097dfc6` | 写死 | 基础信息 | 名称 | [ProductSteps.tsx:24](../../apps/web/src/pages/products/ProductSteps.tsx#L24)、30 行 |
| `ProductSteps.8eb29a70` | 写死 | 服务规则 | 名称 | [ProductSteps.tsx:25](../../apps/web/src/pages/products/ProductSteps.tsx#L25)、30 行 |
| `ProductSteps.910ca964` | 写死 | 价格规则 | 名称 | [ProductSteps.tsx:26](../../apps/web/src/pages/products/ProductSteps.tsx#L26)、30 行 |
| `ProductSteps.755ef754` | 写死 | 库存 | 名称 | [ProductSteps.tsx:27](../../apps/web/src/pages/products/ProductSteps.tsx#L27)、30 行 |
| `ProductSteps.c56ee831` | 写死 | 商品详情 | 名称 | [ProductSteps.tsx:28](../../apps/web/src/pages/products/ProductSteps.tsx#L28)、30 行 |
| `ProductSteps.12b22a93` | 写死 | 上架检查 | 文字 | [ProductSteps.tsx:30](../../apps/web/src/pages/products/ProductSteps.tsx#L30)、101 行 |
| `ProductSteps.d1461154` | 写死 | 即将开放 | 文字 | [ProductSteps.tsx:31](../../apps/web/src/pages/products/ProductSteps.tsx#L31) |
| `ProductSteps.607424c5` | 写死 | 未保存 | 文字 | [ProductSteps.tsx:71](../../apps/web/src/pages/products/ProductSteps.tsx#L71) |
| `ProductSteps.788c3b3d` | 写死 | 先保存第 1 步 | 文字 | [ProductSteps.tsx:71](../../apps/web/src/pages/products/ProductSteps.tsx#L71)、83 行 |
| `ProductSteps.d640601a` | 写死 | 从今天起没有库存 | 文字 | [ProductSteps.tsx:77](../../apps/web/src/pages/products/ProductSteps.tsx#L77) |
| `ProductSteps.2d5b7860` | 写死 | 已完成 · {…} | 文字 | [ProductSteps.tsx:78](../../apps/web/src/pages/products/ProductSteps.tsx#L78) |
| `ProductSteps.4280b144` | 写死 | 已完成 | 文字 | [ProductSteps.tsx:78](../../apps/web/src/pages/products/ProductSteps.tsx#L78)、80 行 |
| `ProductSteps.01260917` | 写死 | 还差 {…} 项 | 文字 | [ProductSteps.tsx:80](../../apps/web/src/pages/products/ProductSteps.tsx#L80) |
| `ProductSteps.b383c84a` | 写死 | 已上架 | 文字 | [ProductSteps.tsx:84](../../apps/web/src/pages/products/ProductSteps.tsx#L84) |
| `ProductSteps.567156b8` | 写死 | 可以上架 | 文字 | [ProductSteps.tsx:87](../../apps/web/src/pages/products/ProductSteps.tsx#L87) |
| `ProductSteps.a368322b` | 写死 | 还差 {length} 项 | 文字 | [ProductSteps.tsx:88](../../apps/web/src/pages/products/ProductSteps.tsx#L88) |
| `ProductSteps.44418137` | 写死 | 等待开放 {length} 步 | 文字 | [ProductSteps.tsx:89](../../apps/web/src/pages/products/ProductSteps.tsx#L89) |
| `ProductSteps.689573cf` | 写死 | 已完成 {done} / {length} | 文字 | [ProductSteps.tsx:103](../../apps/web/src/pages/products/ProductSteps.tsx#L103) |
| `ProductSteps.be047df2` | 写死 | 配置步骤 | 标题 | [ProductSteps.tsx:103](../../apps/web/src/pages/products/ProductSteps.tsx#L103) |
| `ProductSteps.cf571fec` | 写死 | {…}正在开发，开放后会出现在这里。现在可以先把其他几步配好。 | 说明 | [ProductSteps.tsx:103](../../apps/web/src/pages/products/ProductSteps.tsx#L103) |

## 多个页面共用：上架检查（PublishStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/PublishStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PublishStep.949b8c5d` | 写死 | 不是出错：设价格的页面还在开发。开放后在那里设好至少 1 条启用的价格规则，这一项就会满足。 | 文字 | [PublishStep.tsx:32](../../apps/web/src/pages/products/PublishStep.tsx#L32) |
| `PublishStep.17de6293` | 写死 | 只是提醒：城市热门地标清单里不在这个商品任何区域里的地标，客人在那里报不出价。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.445d8f9e` | 写死 | 不设就是不限量；想限制每天接多少单时才用。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.67322a8a` | 写死 | 节假日、旺季想调价时才用。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.d5a9c961` | 写死 | 只是提醒：最低套餐比所有启用的套餐都长时，这个商品报不出价。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.d6d2f06a` | 写死 | 只是提醒：勾选的报价区域超出运营区域的部分不会报价。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.ea934888` | 写死 | 只是提醒：同一层的区域互相重叠，或基础价区域和上下车加价区域重叠，重叠处按哪一个收不确定。 | 文字 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.ed6efabb` | 写死 | 只是提醒：加价表里有没填的格子，那个区域 × 车型组 × 套餐报不出价。 | 空状态 | [PublishStep.tsx:33](../../apps/web/src/pages/products/PublishStep.tsx#L33) |
| `PublishStep.153e0308` | 写死 | 已上架「{…}」 | 提示 | [PublishStep.tsx:84](../../apps/web/src/pages/products/PublishStep.tsx#L84) |
| `PublishStep.ae9f93f8` | 写死 | 上架没有成功。{…} | 文字 | [PublishStep.tsx:93](../../apps/web/src/pages/products/PublishStep.tsx#L93) |
| `PublishStep.f98c63cd` | 写死 | 上架 | 文字 | [PublishStep.tsx:93](../../apps/web/src/pages/products/PublishStep.tsx#L93)、293、321 行 |
| `PublishStep.d90ea805` | 写死 | 上架检查 | 标题 | [PublishStep.tsx:103](../../apps/web/src/pages/products/PublishStep.tsx#L103) |
| `PublishStep.4d2945e1` | 写死 | 重新检查 | 按钮 | [PublishStep.tsx:107](../../apps/web/src/pages/products/PublishStep.tsx#L107) |
| `PublishStep.510b778e` | 写死 | 正在检查 | 名称 | [PublishStep.tsx:116](../../apps/web/src/pages/products/PublishStep.tsx#L116) |
| `PublishStep.008d059e` | 写死 | 检查结果没有加载出来 | 标题 | [PublishStep.tsx:119](../../apps/web/src/pages/products/PublishStep.tsx#L119) |
| `PublishStep.67e440c0` | 写死 | 请检查网络后重试。 | 说明 | [PublishStep.tsx:120](../../apps/web/src/pages/products/PublishStep.tsx#L120) |
| `PublishStep.460eb7ee` | 写死 | 重试 | 按钮 | [PublishStep.tsx:124](../../apps/web/src/pages/products/PublishStep.tsx#L124) |
| `PublishStep.957a550e` | 写死 | 这些问题会让这个商品报不出价，请联系供应商尽快修改。 | 邮件正文 | [PublishStep.tsx:143](../../apps/web/src/pages/products/PublishStep.tsx#L143) |
| `PublishStep.c8d6ff6d` | 写死 | 这些问题会让这个商品报不出价，请尽快修改。 | 邮件正文 | [PublishStep.tsx:143](../../apps/web/src/pages/products/PublishStep.tsx#L143) |
| `PublishStep.e810c595` | 写死 | 已上架，但有 {failedCount} 项需要处理 | 标题 | [PublishStep.tsx:143](../../apps/web/src/pages/products/PublishStep.tsx#L143) |
| `PublishStep.57f4d082` | 写死 | 这个商品正在参与报价和接单。供应商修改后大约 1 分钟生效。 | 邮件正文 | [PublishStep.tsx:144](../../apps/web/src/pages/products/PublishStep.tsx#L144) |
| `PublishStep.799e65e4` | 写死 | 这个商品正在参与报价和接单。修改任何一步，保存后大约 1 分钟生效。 | 邮件正文 | [PublishStep.tsx:144](../../apps/web/src/pages/products/PublishStep.tsx#L144) |
| `PublishStep.d3295a84` | 写死 | 已上架 | 标题 | [PublishStep.tsx:144](../../apps/web/src/pages/products/PublishStep.tsx#L144) |
| `PublishStep.469da57c` | 写死 | 还不能上架：还有 {failedCount} 项要补 | 标题 | [PublishStep.tsx:146](../../apps/web/src/pages/products/PublishStep.tsx#L146) |
| `PublishStep.4e3e5cd1` | 写死 | 去修改 | 邮件正文 | [PublishStep.tsx:146](../../apps/web/src/pages/products/PublishStep.tsx#L146)、186、187 行 |
| `PublishStep.8817f64b` | 写死 | 去查看 | 邮件正文 | [PublishStep.tsx:146](../../apps/web/src/pages/products/PublishStep.tsx#L146)、186、187、208、209、215、266 行 |
| `PublishStep.e7d862f8` | 写死 | 另外，{waiting}功能还没有开放，见下面的说明。 | 邮件正文 | [PublishStep.tsx:146](../../apps/web/src/pages/products/PublishStep.tsx#L146) |
| `PublishStep.f0aa3ab3` | 写死 | 下面标了「{…}」的就是要补的。{…} | 邮件正文 | [PublishStep.tsx:146](../../apps/web/src/pages/products/PublishStep.tsx#L146) |
| `PublishStep.a94ec65f` | 写死 | 你能配的都配好了，现在还不能上架 | 标题 | [PublishStep.tsx:150](../../apps/web/src/pages/products/PublishStep.tsx#L150) |
| `PublishStep.61e41447` | 写死 | 这不是出错。 | 正文 | [PublishStep.tsx:153](../../apps/web/src/pages/products/PublishStep.tsx#L153) |
| `PublishStep.6ffaebee` | 写死 | 上架还需要{waiting}，这个功能正在开发，还没有开放。开放后把它配好，就可以回到这里上架。已经配好的内容都保存着，不用重做。 | 正文 | [PublishStep.tsx:154](../../apps/web/src/pages/products/PublishStep.tsx#L154) |
| `PublishStep.3dfee8b1` | 写死 | 可以上架了 | 标题 | [PublishStep.tsx:158](../../apps/web/src/pages/products/PublishStep.tsx#L158) |
| `PublishStep.ad843703` | 写死 | 必须的检查都通过了。 | 邮件正文 | [PublishStep.tsx:158](../../apps/web/src/pages/products/PublishStep.tsx#L158) |
| `PublishStep.d7968ec8` | 写死 | 必须的检查都通过了。点下面的「上架」，这个商品就开始参与报价和接单。 | 邮件正文 | [PublishStep.tsx:158](../../apps/web/src/pages/products/PublishStep.tsx#L158) |
| `PublishStep.32b7e46d` | 写死 | 有 {length} 处要留意 | 文字 | [PublishStep.tsx:172](../../apps/web/src/pages/products/PublishStep.tsx#L172) |
| `PublishStep.915f871d` | 写死 | 已满足 | 文字 | [PublishStep.tsx:172](../../apps/web/src/pages/products/PublishStep.tsx#L172) |
| `PublishStep.b6cb2fd4` | 写死 | 不是必须 | 文字 | [PublishStep.tsx:172](../../apps/web/src/pages/products/PublishStep.tsx#L172) |
| `PublishStep.ce64edb0` | 写死 | 功能即将开放 | 文字 | [PublishStep.tsx:172](../../apps/web/src/pages/products/PublishStep.tsx#L172) |
| `PublishStep.f7a016eb` | 写死 | 还差 {…} 项 | 文字 | [PublishStep.tsx:172](../../apps/web/src/pages/products/PublishStep.tsx#L172) |
| `PublishStep.485d77e5` | 写死 | 现在是不限量，每天接多少单都可以。想限制每天接多少单时才用设。 | 说明 | [PublishStep.tsx:173](../../apps/web/src/pages/products/PublishStep.tsx#L173) |
| `PublishStep.87d64bdf` | 写死 | 现在是限量，按每天设的库存接单。 | 说明 | [PublishStep.tsx:173](../../apps/web/src/pages/products/PublishStep.tsx#L173) |
| `PublishStep.02d10ba4` | 写死 | 供应商需要补画覆盖它的运营区域 | 正文 | [PublishStep.tsx:198](../../apps/web/src/pages/products/PublishStep.tsx#L198) |
| `PublishStep.60e2d6a9` | 写死 | 去看区域：{text} | 读屏说明 | [PublishStep.tsx:201](../../apps/web/src/pages/products/PublishStep.tsx#L201) |
| `PublishStep.1c7fc3e2` | 写死 | 去看区域 | 链接 | [PublishStep.tsx:203](../../apps/web/src/pages/products/PublishStep.tsx#L203) |
| `PublishStep.d87b03b8` | 写死 | 去设 | 读屏说明 | [PublishStep.tsx:208](../../apps/web/src/pages/products/PublishStep.tsx#L208)、209 行 |
| `PublishStep.f650ae7a` | 写死 | 去填 | 读屏说明 | [PublishStep.tsx:208](../../apps/web/src/pages/products/PublishStep.tsx#L208)、209 行 |
| `PublishStep.8fc0bf77` | 写死 | {…}调价规则「{label}」 | 读屏说明 | [PublishStep.tsx:215](../../apps/web/src/pages/products/PublishStep.tsx#L215) |
| `PublishStep.bc9b7a62` | 写死 | 去改 | 读屏说明 | [PublishStep.tsx:215](../../apps/web/src/pages/products/PublishStep.tsx#L215)、266 行 |
| `PublishStep.16df8d03` | 写死 | 看 | 链接 | [PublishStep.tsx:216](../../apps/web/src/pages/products/PublishStep.tsx#L216) |
| `PublishStep.f02b44d5` | 写死 | 改 | 链接 | [PublishStep.tsx:216](../../apps/web/src/pages/products/PublishStep.tsx#L216) |
| `PublishStep.59318ed7` | 写死 | 不是出错：这个功能还在开发。开放后在那里配好，这一项就会满足。 | 正文 | [PublishStep.tsx:228](../../apps/web/src/pages/products/PublishStep.tsx#L228) |
| `PublishStep.f6be0a46` | 写死 | 功能还在开发。 | 正文 | [PublishStep.tsx:229](../../apps/web/src/pages/products/PublishStep.tsx#L229) |
| `PublishStep.1aa1ba28` | 写死 | 还不能上架：还有 {failedCount} 项要补{…}。 | 说明 | [PublishStep.tsx:236](../../apps/web/src/pages/products/PublishStep.tsx#L236) |
| `PublishStep.a4cffa8e` | 写死 | ，另有{waiting}功能未开放 | 说明 | [PublishStep.tsx:236](../../apps/web/src/pages/products/PublishStep.tsx#L236) |
| `PublishStep.afd818fc` | 写死 | 还不能上架：{waiting}开放并配好以后才能上架。 | 说明 | [PublishStep.tsx:236](../../apps/web/src/pages/products/PublishStep.tsx#L236) |
| `PublishStep.40d87709` | 写死 | 没有上架。 | 正文 | [PublishStep.tsx:246](../../apps/web/src/pages/products/PublishStep.tsx#L246) |
| `PublishStep.c83da2d0` | 写死 | 检查结果和刚才不一样了，请看下面最新的结果。 | 正文 | [PublishStep.tsx:247](../../apps/web/src/pages/products/PublishStep.tsx#L247) |
| `PublishStep.92c30842` | 写死 |  另外，库存是限量的，但从今天起没有一天有库存，这个商品现在卖不出去（见下面「库存」一项）。 | 正文 | [PublishStep.tsx:256](../../apps/web/src/pages/products/PublishStep.tsx#L256) |
| `PublishStep.7a732259` | 写死 | 下单有效期已经过了（到 {saleTo} 为止），客人现在下不了单。它不影响上架。 | 正文 | [PublishStep.tsx:264](../../apps/web/src/pages/products/PublishStep.tsx#L264) |
| `PublishStep.da21fb19` | 写死 | 上架前必须满足 | 标题 | [PublishStep.tsx:272](../../apps/web/src/pages/products/PublishStep.tsx#L272) |
| `PublishStep.dc073515` | 写死 | 可以不设 | 标题 | [PublishStep.tsx:276](../../apps/web/src/pages/products/PublishStep.tsx#L276) |
| `PublishStep.6760e675` | 写死 | 下架 | 按钮 | [PublishStep.tsx:286](../../apps/web/src/pages/products/PublishStep.tsx#L286) |
| `PublishStep.afde856b` | 写死 | 下架后不再参与报价，已经接到的订单不受影响。 | 正文 | [PublishStep.tsx:287](../../apps/web/src/pages/products/PublishStep.tsx#L287) |
| `PublishStep.43f9eb7c` | 写死 | 上架后开始参与报价和接单。 | 正文 | [PublishStep.tsx:295](../../apps/web/src/pages/products/PublishStep.tsx#L295) |
| `PublishStep.d5f323d5` | 写死 | 回到列表 | 按钮 | [PublishStep.tsx:306](../../apps/web/src/pages/products/PublishStep.tsx#L306) |
| `PublishStep.11161993` | 写死 | 上架「{name}」？ | 标题 | [PublishStep.tsx:311](../../apps/web/src/pages/products/PublishStep.tsx#L311) |
| `PublishStep.290a4c18` | 写死 | 取消 | 按钮 | [PublishStep.tsx:318](../../apps/web/src/pages/products/PublishStep.tsx#L318) |
| `PublishStep.953002f0` | 写死 | 上架中… | 文字 | [PublishStep.tsx:319](../../apps/web/src/pages/products/PublishStep.tsx#L319) |
| `PublishStep.79c21c66` | 写死 | 上架后，这个商品开始参与报价和接单： | 正文 | [PublishStep.tsx:326](../../apps/web/src/pages/products/PublishStep.tsx#L326) |
| `PublishStep.e21162a5` | 写死 | 销售端询价时，会按你设的价格报出结算价； | 正文 | [PublishStep.tsx:328](../../apps/web/src/pages/products/PublishStep.tsx#L328) |
| `PublishStep.65249afe` | 写死 | 客人下单并付款后，订单直接派给你们， | 正文 | [PublishStep.tsx:330](../../apps/web/src/pages/products/PublishStep.tsx#L330) |
| `PublishStep.73ce2578` | 写死 | 不能拒单 | 正文 | [PublishStep.tsx:330](../../apps/web/src/pages/products/PublishStep.tsx#L330) |
| `PublishStep.7cbd9b27` | 写死 | 之后修改任何规则，保存后大约 1 分钟生效。 | 正文 | [PublishStep.tsx:332](../../apps/web/src/pages/products/PublishStep.tsx#L332) |
| `PublishStep.1a4d4901` | 写死 | 现在上架也卖不出去 | 正文 | [PublishStep.tsx:338](../../apps/web/src/pages/products/PublishStep.tsx#L338) |
| `PublishStep.23d3b062` | 写死 | ：库存是限量的，从今天起没有一天有库存。可以先去设库存，也可以先上架、之后再设。 | 正文 | [PublishStep.tsx:338](../../apps/web/src/pages/products/PublishStep.tsx#L338) |

## 多个页面共用：② 服务规则（ServiceRulesStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/ServiceRulesStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ServiceRulesStep.b5bf86c3` | 写死 | 按次 | 名称 | [ServiceRulesStep.tsx:30](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L30) |
| `ServiceRulesStep.ce66f14a` | 写死 | 用车时间在夜间时段里，就加收一次这个金额。接送机一般用这种。 | 说明 | [ServiceRulesStep.tsx:30](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L30) |
| `ServiceRulesStep.712c5279` | 写死 | 按用车时间和夜间时段重叠的小时数加收。包车一般用这种。 | 说明 | [ServiceRulesStep.tsx:31](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L31) |
| `ServiceRulesStep.eeb3cd7c` | 写死 | 按小时 | 名称 | [ServiceRulesStep.tsx:31](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L31) |
| `ServiceRulesStep.5a274e6b` | 写死 |  / 个 | 文字 | [ServiceRulesStep.tsx:33](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L33) |
| `ServiceRulesStep.5c64e323` | 写死 |  / 小时 | 文字 | [ServiceRulesStep.tsx:33](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L33) |
| `ServiceRulesStep.fd070ba6` | 写死 |  / 人 | 文字 | [ServiceRulesStep.tsx:33](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L33) |
| `ServiceRulesStep.23ccc731` | 写死 | 包车按行程计价 | 标题 | [ServiceRulesStep.tsx:80](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L80) |
| `ServiceRulesStep.1c1ae6d2` | 写死 | 客人填了经停点时，平台按「行驶时间 + 各经停停留 + 经停数 × 每站默认占用 + 整单缓冲」算预计用时，自动选够用的套餐。预计用时只用来选套餐，不直接算钱。 | 正文 | [ServiceRulesStep.tsx:82](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L82) |
| `ServiceRulesStep.7cdd44da` | 写死 | 经停点默认占用 | 表单标签 | [ServiceRulesStep.tsx:86](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L86) |
| `ServiceRulesStep.1e8f7ddb` | 写死 | 建议 {stopOccupancyMinutes} | 文字 | [ServiceRulesStep.tsx:88](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L88) |
| `ServiceRulesStep.6a8fad47` | 写死 | 经停点默认占用（分钟） | 文字 | [ServiceRulesStep.tsx:88](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L88) |
| `ServiceRulesStep.b9bbdde3` | 写死 | 分钟 | 正文 | [ServiceRulesStep.tsx:89](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L89)、101、126、635 行 |
| `ServiceRulesStep.9cee619c` | 写死 | 每个经停点额外算的时间（停车、步行、上下车），和客人填的停留分开算。0 到 {maxStopOccupancyMinutes} 分钟，空着 = 0（不加）。 | 正文 | [ServiceRulesStep.tsx:92](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L92) |
| `ServiceRulesStep.c0acf465` | 写死 | 建议 {stopOccupancyMinutes} 分钟 | 正文 | [ServiceRulesStep.tsx:93](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L93) |
| `ServiceRulesStep.8522adb1` | 写死 | 整单缓冲 | 表单标签 | [ServiceRulesStep.tsx:98](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L98) |
| `ServiceRulesStep.2ed07703` | 写死 | 建议 {bufferMinutes} | 文字 | [ServiceRulesStep.tsx:100](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L100) |
| `ServiceRulesStep.800ee02f` | 写死 | 整单缓冲（分钟） | 文字 | [ServiceRulesStep.tsx:100](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L100) |
| `ServiceRulesStep.5d422754` | 写死 | 整单额外加的时间，给路上耽搁留余量。0 到 {maxBufferMinutes} 分钟，填 0 = 关闭。 | 正文 | [ServiceRulesStep.tsx:104](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L104) |
| `ServiceRulesStep.ecd4b3b0` | 写死 | 建议 {bufferMinutes} 分钟，填 0 关闭 | 正文 | [ServiceRulesStep.tsx:105](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L105) |
| `ServiceRulesStep.a0deeb95` | 写死 | 最低套餐（选填） | 表单标签 | [ServiceRulesStep.tsx:110](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L110) |
| `ServiceRulesStep.69340154` | 写死 | 最低套餐（小时） | 文字 | [ServiceRulesStep.tsx:112](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L112) |
| `ServiceRulesStep.cb78c51b` | 写死 | 不限 | 文字 | [ServiceRulesStep.tsx:112](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L112)、357、445 行 |
| `ServiceRulesStep.23dafa03` | 写死 | 小时 | 正文 | [ServiceRulesStep.tsx:113](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L113)、406 行 |
| `ServiceRulesStep.ad469f10` | 写死 | 这个商品最短卖几小时，空着 = 不限。设了以后比它短的套餐不再报价，客人自选时长也选不到。 | 正文 | [ServiceRulesStep.tsx:116](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L116) |
| `ServiceRulesStep.e913cf59` | 写死 | 这个商品最短卖几小时，留空 = 不限。设了以后比它短的套餐不再报价，客人自选时长也选不到。 | 正文 | [ServiceRulesStep.tsx:116](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L116) |
| `ServiceRulesStep.fb95190e` | 写死 | 可设为 {minPackageHours} 小时 | 正文 | [ServiceRulesStep.tsx:117](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L117) |
| `ServiceRulesStep.96a64d59` | 写死 | 最低套餐 {min\_package\_hours} 小时比这个商品所有启用的套餐都长（最长 {longest\_package\_hours} 小时），这个商品将报不出价。 | 正文 | [ServiceRulesStep.tsx:118](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L118) |
| `ServiceRulesStep.47edbc44` | 写死 | 超限提醒：预计用时 | 表单标签 | [ServiceRulesStep.tsx:123](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L123) |
| `ServiceRulesStep.6e6f5669` | 写死 | 超限提醒：预计用时（分钟） | 文字 | [ServiceRulesStep.tsx:125](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L125) |
| `ServiceRulesStep.cfdd7e72` | 写死 | 预计用时超过它时，在客人的行程时间表下方提醒缩减行程，客人仍可下单。{minWarnMinutes} 到 {maxWarnMinutes} 分钟，默认 {warnMinutes}（12 小时）。 | 正文 | [ServiceRulesStep.tsx:129](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L129) |
| `ServiceRulesStep.1685a7a8` | 写死 | 超限提醒：全程 | 表单标签 | [ServiceRulesStep.tsx:134](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L134) |
| `ServiceRulesStep.513bcae6` | 写死 | 超限提醒：全程（公里） | 文字 | [ServiceRulesStep.tsx:136](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L136) |
| `ServiceRulesStep.54958d21` | 写死 | 公里 | 正文 | [ServiceRulesStep.tsx:137](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L137) |
| `ServiceRulesStep.5bd74f7d` | 写死 | 全程超过它时提醒（会产生较多超公里费），客人仍可下单。{minWarnKm} 到 {maxWarnKm} 公里，默认 {warnKm}。 | 正文 | [ServiceRulesStep.tsx:140](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L140) |
| `ServiceRulesStep.03db8be0` | 写死 | 下车点行程加价 | 表单标签 | [ServiceRulesStep.tsx:143](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L143) |
| `ServiceRulesStep.f256f234` | 写死 | 收下车点行程加价 | 正文 | [ServiceRulesStep.tsx:146](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L146) |
| `ServiceRulesStep.4d5dbdc0` | 写死 | 没有市外经停时，下车点所在行程区域收一次行程加价。默认开。 | 正文 | [ServiceRulesStep.tsx:149](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L149) |
| `ServiceRulesStep.e4abfb7d` | 写死 | ② 服务规则 | 标题 | [ServiceRulesStep.tsx:211](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L211)、287 行 |
| `ServiceRulesStep.12f57427` | 写死 | {minutes} 分钟 | 文字 | [ServiceRulesStep.tsx:228](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L228) |
| `ServiceRulesStep.e88f4bb1` | 写死 | 不限时 | 文字 | [ServiceRulesStep.tsx:228](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L228)、641 行 |
| `ServiceRulesStep.39418d25` | 写死 | 「{…}」平台已停用或不再适用，请取消勾选。 | 文字 | [ServiceRulesStep.tsx:251](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L251) |
| `ServiceRulesStep.17b097d2` | 写死 | 不能少于平台规定的 {…} 分钟 | 文字 | [ServiceRulesStep.tsx:253](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L253) |
| `ServiceRulesStep.f38fa50f` | 写死 | 全天 24 小时 | 文字 | [ServiceRulesStep.tsx:266](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L266)、389 行 |
| `ServiceRulesStep.1439af1e` | 写死 | 上车点 | 文字 | [ServiceRulesStep.tsx:275](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L275) |
| `ServiceRulesStep.39ac9195` | 写死 | 送机 | 文字 | [ServiceRulesStep.tsx:275](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L275) |
| `ServiceRulesStep.432dbbd0` | 写死 | 送站 | 文字 | [ServiceRulesStep.tsx:275](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L275) |
| `ServiceRulesStep.7a21dd3d` | 写死 | 接站 | 文字 | [ServiceRulesStep.tsx:275](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L275) |
| `ServiceRulesStep.e74551f3` | 写死 | 接机 | 文字 | [ServiceRulesStep.tsx:275](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L275) |
| `ServiceRulesStep.af4d6ca6` | 写死 | 平台规定最少 {minimum} 分钟 | 文字 | [ServiceRulesStep.tsx:278](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L278) |
| `ServiceRulesStep.1700095b` | 写死 | 从航班实际落地起算。 | 文字 | [ServiceRulesStep.tsx:279](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L279) |
| `ServiceRulesStep.339bebd1` | 写死 | 从约定的上车时间起算。 | 文字 | [ServiceRulesStep.tsx:279](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L279) |
| `ServiceRulesStep.925affa0` | 写死 | 从列车计划到达时间起算。 | 文字 | [ServiceRulesStep.tsx:279](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L279) |
| `ServiceRulesStep.e32ceda2` | 写死 | 保存并下一步 | 名称 | [ServiceRulesStep.tsx:288](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L288) |
| `ServiceRulesStep.01f72f1f` | 写死 | 这一页的时间都按 | 正文 | [ServiceRulesStep.tsx:293](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L293) |
| `ServiceRulesStep.b457721f` | 写死 | {…}当地时间 | 正文 | [ServiceRulesStep.tsx:293](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L293) |
| `ServiceRulesStep.8ba4094b` | 写死 | 填写和计算 | 正文 | [ServiceRulesStep.tsx:294](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L294) |
| `ServiceRulesStep.a305c44b` | 写死 | {…}{…}。金额都是结算价，币种 | 正文 | [ServiceRulesStep.tsx:294](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L294) |
| `ServiceRulesStep.f1df7f6f` | 写死 | 显示和计算 | 正文 | [ServiceRulesStep.tsx:294](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L294) |
| `ServiceRulesStep.c61696b7` | 写死 | 上架前要填这一项。 | 正文 | [ServiceRulesStep.tsx:303](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L303) |
| `ServiceRulesStep.97aac394` | 写死 | 从 | 正文 | [ServiceRulesStep.tsx:332](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L332)、364 行 |
| `ServiceRulesStep.8f3146d7` | 写死 | {name}从 | 名称 | [ServiceRulesStep.tsx:333](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L333) |
| `ServiceRulesStep.5e32bdd7` | 写死 | 到 | 正文 | [ServiceRulesStep.tsx:336](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L336)、368 行 |
| `ServiceRulesStep.e98cfc57` | 写死 | 次日 | 正文 | [ServiceRulesStep.tsx:338](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L338) |
| `ServiceRulesStep.d7cf0fb0` | 写死 | {name}到 | 名称 | [ServiceRulesStep.tsx:339](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L339) |
| `ServiceRulesStep.84c54d2f` | 写死 | 预订规则 | 标题 | [ServiceRulesStep.tsx:349](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L349) |
| `ServiceRulesStep.8c83eedd` | 写死 | 下单有效期 | 表单标签 | [ServiceRulesStep.tsx:352](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L352) |
| `ServiceRulesStep.76d2667c` | 写死 | 指定日期 | 正文 | [ServiceRulesStep.tsx:357](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L357) |
| `ServiceRulesStep.0f5cede4` | 写死 | 下单有效期从 | 名称 | [ServiceRulesStep.tsx:365](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L365) |
| `ServiceRulesStep.ba6d1455` | 写死 | 年-月-日 | 输入框占位 | [ServiceRulesStep.tsx:365](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L365)、369 行 |
| `ServiceRulesStep.0aa51bb0` | 写死 | 下单有效期到 | 名称 | [ServiceRulesStep.tsx:369](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L369) |
| `ServiceRulesStep.1c0e0f62` | 写死 | 下单有效期已经过了（到 {…} 为止），客人现在下不了单。要继续卖，请把结束日期改晚，或改成不限。 | 正文 | [ServiceRulesStep.tsx:374](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L374) |
| `ServiceRulesStep.6e31addb` | 写死 | 日期写成 2026-01-31 这样；两格都留空 = 不限。 | 正文 | [ServiceRulesStep.tsx:376](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L376) |
| `ServiceRulesStep.7b871514` | 写死 | 在这段日期里下的单才接（看的是客人下单那一天，不是用车那一天，两端都含）。不限 = 一直可以下单。 | 正文 | [ServiceRulesStep.tsx:378](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L378) |
| `ServiceRulesStep.74c556b5` | 写死 | 服务时间 | 表单标签 | [ServiceRulesStep.tsx:384](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L384)、386 行 |
| `ServiceRulesStep.02715b1d` | 写死 | 每天几点到几点可以用车。用车时间在这个时段里才报价，两端都算在内。结束比开始早就是到第二天。 | 正文 | [ServiceRulesStep.tsx:396](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L396) |
| `ServiceRulesStep.e1eca463` | 写死 | 提前预订时长 | 表单标签 | [ServiceRulesStep.tsx:402](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L402) |
| `ServiceRulesStep.3b7f12e0` | 写死 | 提前预订时长（小时） | 名称 | [ServiceRulesStep.tsx:405](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L405) |
| `ServiceRulesStep.5294faa9` | 写死 | {…}用车前 24 小时以内就不能订了（开了加急预订的除外）。0 = 随时可以订。 | 正文 | [ServiceRulesStep.tsx:411](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L411) |
| `ServiceRulesStep.a3e14d6e` | 写死 | 至少提前多久下单。例如 24： | 正文 | [ServiceRulesStep.tsx:411](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L411) |
| `ServiceRulesStep.f91974b8` | 写死 | 至少提前多久下单。例如填 24： | 正文 | [ServiceRulesStep.tsx:411](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L411) |
| `ServiceRulesStep.84d7ffdc` | 写死 | 备注（选填） | 表单标签 | [ServiceRulesStep.tsx:417](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L417) |
| `ServiceRulesStep.13d2dd49` | 写死 | 预订规则的补充说明，是供应商给自己人写的备忘。 | 正文 | [ServiceRulesStep.tsx:420](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L420) |
| `ServiceRulesStep.da736412` | 写死 | 预订规则的补充说明，给自己人看的备忘。 | 正文 | [ServiceRulesStep.tsx:420](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L420) |
| `ServiceRulesStep.a77d9630` | 写死 | 加急预订 | 标题 | [ServiceRulesStep.tsx:428](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L428) |
| `ServiceRulesStep.a7c3f2dd` | 写死 | 允许加急预订 | 正文 | [ServiceRulesStep.tsx:432](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L432) |
| `ServiceRulesStep.a4c7d00d` | 写死 | 提前预订时长以内下单 = 加急。例如提前预订时长填 24：用车前 24 小时以内下的单都算加急，按下面的阶梯加收加急费。不开启：不足提前预订时长的一律不报价。 | 正文 | [ServiceRulesStep.tsx:434](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L434) |
| `ServiceRulesStep.0e05c49f` | 写死 | 提前预订时长是 0，客人随时可以订，用不到加急预订。 | 正文 | [ServiceRulesStep.tsx:435](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L435) |
| `ServiceRulesStep.9f89c152` | 写死 | 保存后，这里填的内容会清除。 | 正文 | [ServiceRulesStep.tsx:436](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L436)、542 行 |
| `ServiceRulesStep.347a6818` | 写死 | 每日加急库存 | 表单标签 | [ServiceRulesStep.tsx:443](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L443)、445 行 |
| `ServiceRulesStep.0cc9a50b` | 写死 | 单 / 天 | 正文 | [ServiceRulesStep.tsx:446](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L446) |
| `ServiceRulesStep.95a3a039` | 写死 | 空着 = 不限。 | 正文 | [ServiceRulesStep.tsx:449](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L449) |
| `ServiceRulesStep.a3b78613` | 写死 | 留空 = 不限。加急单最容易来不及派车，建议填一个你们一天接得住的数。 | 正文 | [ServiceRulesStep.tsx:449](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L449) |
| `ServiceRulesStep.927b857b` | 写死 | 加急阶梯 | 表单标签 | [ServiceRulesStep.tsx:454](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L454) |
| `ServiceRulesStep.ab924b58` | 写死 | 提前不足（小时） | 正文 | [ServiceRulesStep.tsx:461](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L461) |
| `ServiceRulesStep.a0a54d91` | 写死 | 第 {…} 档：提前不足多少小时 | 名称 | [ServiceRulesStep.tsx:462](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L462) |
| `ServiceRulesStep.6b561e7e` | 写死 | 加收（{currency}） | 正文 | [ServiceRulesStep.tsx:465](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L465) |
| `ServiceRulesStep.f4668fb5` | 写死 | 第 {…} 档：加收的金额 | 名称 | [ServiceRulesStep.tsx:466](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L466) |
| `ServiceRulesStep.79683841` | 写死 | 删除第 {…} 档 | 名称 | [ServiceRulesStep.tsx:468](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L468) |
| `ServiceRulesStep.df4984ed` | 写死 | 加急阶梯的小时数不能超过提前预订时长（现在是 {lead} 小时）。想让用车前更早下的单也算加急，请先把提前预订时长改大。 | 正文 | [ServiceRulesStep.tsx:475](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L475) |
| `ServiceRulesStep.0d6105f0` | 写死 | 去修改提前预订时长 | 链接 | [ServiceRulesStep.tsx:487](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L487) |
| `ServiceRulesStep.59be3aa7` | 写死 | 添加一档 | 按钮 | [ServiceRulesStep.tsx:495](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L495) |
| `ServiceRulesStep.4415e6b0` | 写死 | 先填上面的提前预订时长，这里会算出每一段怎么收。 | 正文 | [ServiceRulesStep.tsx:500](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L500) |
| `ServiceRulesStep.01a65be3` | 写死 | 提前预订时长是 {lead} 小时。 | 正文 | [ServiceRulesStep.tsx:504](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L504) |
| `ServiceRulesStep.de8dee79` | 写死 | 提前不足 {to} 小时下单 | 文字 | [ServiceRulesStep.tsx:507](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L507) |
| `ServiceRulesStep.eb5eca24` | 写死 | 提前 {from} 到 {to} 小时下单 | 文字 | [ServiceRulesStep.tsx:507](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L507) |
| `ServiceRulesStep.954086ef` | 写死 | {range}：加收 {…} | 正文 | [ServiceRulesStep.tsx:509](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L509) |
| `ServiceRulesStep.c29916c1` | 写死 | 不接 | 正文 | [ServiceRulesStep.tsx:515](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L515) |
| `ServiceRulesStep.1005a17b` | 写死 | （不在任何一档里）。 | 正文 | [ServiceRulesStep.tsx:516](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L516) |
| `ServiceRulesStep.1217568a` | 写死 | （不在任何一档里）。要接这一段，请加一档「提前不足 {lead} 小时」 | 正文 | [ServiceRulesStep.tsx:516](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L516) |
| `ServiceRulesStep.2860e78e` | 写死 | 夜间加价 | 标题 | [ServiceRulesStep.tsx:535](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L535) |
| `ServiceRulesStep.64deb9fd` | 写死 | 收夜间加价 | 正文 | [ServiceRulesStep.tsx:539](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L539) |
| `ServiceRulesStep.81e710da` | 写死 | 用车时间落在夜间时段里时，在结算价上另加一笔。不勾 = 不收。 | 正文 | [ServiceRulesStep.tsx:541](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L541) |
| `ServiceRulesStep.a535071b` | 写死 | 用车时间落在夜间时段里时，在结算价上另加一笔。 | 正文 | [ServiceRulesStep.tsx:541](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L541) |
| `ServiceRulesStep.d18e3aad` | 写死 | 夜间时段 | 表单标签 | [ServiceRulesStep.tsx:549](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L549)、551 行 |
| `ServiceRulesStep.472ea585` | 写死 | 计费方式 | 表单标签 | [ServiceRulesStep.tsx:560](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L560) |
| `ServiceRulesStep.8cd9f219` | 写死 | 金额 | 表单标签 | [ServiceRulesStep.tsx:577](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L577) |
| `ServiceRulesStep.79d8c338` | 写死 | {currency} / 小时 | 文字 | [ServiceRulesStep.tsx:579](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L579) |
| `ServiceRulesStep.916d7474` | 写死 | 夜间加价的金额 | 文字 | [ServiceRulesStep.tsx:579](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L579) |
| `ServiceRulesStep.e5bb8ed4` | 写死 | 免费等待 | 标题 | [ServiceRulesStep.tsx:590](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L590) |
| `ServiceRulesStep.5f03d5d7` | 写死 | {fixedWait} 分钟 | 正文 | [ServiceRulesStep.tsx:596](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L596) |
| `ServiceRulesStep.61f87eca` | 写死 | 平台统一 · 不能修改 | 正文 | [ServiceRulesStep.tsx:597](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L597)、676、802 行 |
| `ServiceRulesStep.96533967` | 写死 | 所有供应商相同 | 正文 | [ServiceRulesStep.tsx:599](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L599) |
| `ServiceRulesStep.99e30109` | 写死 | 这里不用设置 | 正文 | [ServiceRulesStep.tsx:599](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L599) |
| `ServiceRulesStep.b96ffeb1` | 写死 | 包车不另外免费等待：从约定的开始时间起就计入套餐时长（平台规定，{…}）。 | 正文 | [ServiceRulesStep.tsx:599](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L599) |
| `ServiceRulesStep.443724a5` | 写死 | 供应商下次保存这一步时会改成 0。 | 正文 | [ServiceRulesStep.tsx:600](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L600) |
| `ServiceRulesStep.a5c4e8fc` | 写死 | 保存这一步时会改成 0。 | 正文 | [ServiceRulesStep.tsx:600](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L600) |
| `ServiceRulesStep.d5202458` | 写死 | 以前存的是「{legacyWait}」，报价时已经按 {fixedWait} 分钟算；{…} | 正文 | [ServiceRulesStep.tsx:600](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L600) |
| `ServiceRulesStep.1fe04c9c` | 写死 | 平台规定了最少要等多久，你可以设得更长，不能更短。 | 正文 | [ServiceRulesStep.tsx:604](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L604) |
| `ServiceRulesStep.303d9d12` | 写死 | 司机到了以后免费等客人多久。{…} | 正文 | [ServiceRulesStep.tsx:604](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L604) |
| `ServiceRulesStep.7b50c46a` | 写死 | 平台规定了最少要等多久，供应商可以设得更长，不能更短。 | 正文 | [ServiceRulesStep.tsx:604](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L604) |
| `ServiceRulesStep.2e0d85dc` | 写死 | 下面是按平台规定的最少时间替你填好的，确认后点保存才会存下来。 | 正文 | [ServiceRulesStep.tsx:605](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L605) |
| `ServiceRulesStep.c11bc265` | 写死 | {…}：等若干分钟 | 读屏说明 | [ServiceRulesStep.tsx:630](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L630) |
| `ServiceRulesStep.2fb06f7b` | 写死 | {…}免费等待的分钟数 | 名称 | [ServiceRulesStep.tsx:633](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L633) |
| `ServiceRulesStep.782b1428` | 写死 | 等 | 正文 | [ServiceRulesStep.tsx:633](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L633) |
| `ServiceRulesStep.92721587` | 写死 | 一直等到客人出现，不收等待费。 | 正文 | [ServiceRulesStep.tsx:641](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L641) |
| `ServiceRulesStep.c67b59ab` | 写死 | 取消规则 | 标题 | [ServiceRulesStep.tsx:675](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L675) |
| `ServiceRulesStep.a16099c8` | 写死 | 所有供应商相同，这里不用设置。 | 正文 | [ServiceRulesStep.tsx:678](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L678) |
| `ServiceRulesStep.b2d2b9ed` | 写死 | 客人付款前不知道订单会给哪家供应商，所以取消规则由平台按品类和车型级别统一规定，{…} | 正文 | [ServiceRulesStep.tsx:678](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L678) |
| `ServiceRulesStep.e41a8a35` | 写死 | 所有供应商相同。 | 正文 | [ServiceRulesStep.tsx:678](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L678) |
| `ServiceRulesStep.68cf5665` | 写死 | 附加服务 | 标题 | [ServiceRulesStep.tsx:685](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L685) |
| `ServiceRulesStep.2c1b1a53` | 写死 | 客人下单时可以加选的服务，从平台的目录里选你能提供的。单价是结算价；填 0 = 免费提供。 | 正文 | [ServiceRulesStep.tsx:687](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L687) |
| `ServiceRulesStep.c8a7c30b` | 写死 | 客人下单时可以加选的服务，是供应商从平台的目录里选的。单价是结算价；0 = 免费提供。 | 正文 | [ServiceRulesStep.tsx:687](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L687) |
| `ServiceRulesStep.79052a95` | 写死 | 正在加载附加服务… | 正文 | [ServiceRulesStep.tsx:690](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L690) |
| `ServiceRulesStep.fb757e0d` | 写死 | 附加服务没有加载出来。 | 正文 | [ServiceRulesStep.tsx:694](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L694) |
| `ServiceRulesStep.072ed2fd` | 写死 | 重试 | 按钮 | [ServiceRulesStep.tsx:696](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L696) |
| `ServiceRulesStep.f6951474` | 写死 | 平台还没有适用于{…}的附加服务。 | 正文 | [ServiceRulesStep.tsx:700](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L700) |
| `ServiceRulesStep.5d7b86e7` | 写死 | 平台已停用 | 文字 | [ServiceRulesStep.tsx:707](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L707) |
| `ServiceRulesStep.7efa3fba` | 写死 | 不再适用 | 文字 | [ServiceRulesStep.tsx:707](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L707) |
| `ServiceRulesStep.1f19d990` | 写死 | 单价 | 正文 | [ServiceRulesStep.tsx:724](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L724) |
| `ServiceRulesStep.88c52105` | 写死 | {name}的单价 | 文字 | [ServiceRulesStep.tsx:725](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L725) |
| `ServiceRulesStep.c375a825` | 写死 | 免费提供 | 正文 | [ServiceRulesStep.tsx:726](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L726) |
| `ServiceRulesStep.1bf5abfa` | 写死 | 客人加选的第一个不收钱，从第二个起按单价收。 | 正文 | [ServiceRulesStep.tsx:734](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L734) |
| `ServiceRulesStep.f723c822` | 写死 | 第一个免费 | 正文 | [ServiceRulesStep.tsx:734](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L734) |
| `ServiceRulesStep.b052b814` | 写死 | 上架前请取消勾选。 | 正文 | [ServiceRulesStep.tsx:740](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L740) |
| `ServiceRulesStep.e5b7340f` | 写死 | 包车的超时费、超公里费在「价格规则」里设置。{CHARTER\_SUPPLIER\_PRICE\_NOTE} | 正文 | [ServiceRulesStep.tsx:748](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L748) |
| `ServiceRulesStep.89bd26f9` | 写死 | 司机语言 | 表单标签 | [ServiceRulesStep.tsx:751](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L751) |
| `ServiceRulesStep.b1b08b17` | 写死 | 客人可以指定司机会说的语言。单价 0 = 这种语言免费提供；一行都没有 = 不提供指定语言。 | 正文 | [ServiceRulesStep.tsx:752](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L752) |
| `ServiceRulesStep.c8a560fb` | 写死 | 客人可以指定司机会说的语言。把你们能提供的语言加上并填单价；填 0 = 这种语言免费提供。一行都不加 = 不提供指定语言。 | 正文 | [ServiceRulesStep.tsx:752](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L752) |
| `ServiceRulesStep.0838d32c` | 写死 | 语言 | 正文 | [ServiceRulesStep.tsx:759](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L759)、764 行 |
| `ServiceRulesStep.366df042` | 写死 | 第 {…} 行：语言 | 读屏说明 | [ServiceRulesStep.tsx:765](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L765) |
| `ServiceRulesStep.d634f1ac` | 写死 | 请选择 | 选项 | [ServiceRulesStep.tsx:766](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L766) |
| `ServiceRulesStep.f8f9b0d6` | 写死 | 单价（{currency}） | 正文 | [ServiceRulesStep.tsx:776](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L776) |
| `ServiceRulesStep.93fcf88d` | 写死 | 第 {…} 行：单价 | 名称 | [ServiceRulesStep.tsx:777](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L777) |
| `ServiceRulesStep.5aa681fa` | 写死 | 删除第 {…} 行语言 | 名称 | [ServiceRulesStep.tsx:779](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L779) |
| `ServiceRulesStep.dc4d8654` | 写死 | 添加语言 | 按钮 | [ServiceRulesStep.tsx:789](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L789) |
| `ServiceRulesStep.5b1a5fd2` | 写死 | 都加上了 | 正文 | [ServiceRulesStep.tsx:790](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L790) |
| `ServiceRulesStep.34c8c412` | 写死 | 服务后加收的费用 | 标题 | [ServiceRulesStep.tsx:801](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L801) |
| `ServiceRulesStep.28e4b5df` | 写死 | 平台的订单不收现金。 | 正文 | [ServiceRulesStep.tsx:805](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L805) |
| `ServiceRulesStep.adae9f27` | 写死 | {…} 24 小时内在订单里提交，平台从客人下单时保存的支付方式里线上补款；客人有 48 小时可以提出异议。 | 正文 | [ServiceRulesStep.tsx:805](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L805) |
| `ServiceRulesStep.af0f5e86` | 写死 | 供应商 | 正文 | [ServiceRulesStep.tsx:805](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L805) |
| `ServiceRulesStep.bcd1e61c` | 写死 | 超时、超公里等服务后才知道的费用，由{…}在服务结束后 | 正文 | [ServiceRulesStep.tsx:805](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L805) |
| `ServiceRulesStep.e38087aa` | 写死 | 你们 | 正文 | [ServiceRulesStep.tsx:805](../../apps/web/src/pages/products/ServiceRulesStep.tsx#L805) |

## 多个页面共用：商品配置各步骤「内容还没到手」时显示什么（StepLoadState.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/StepLoadState.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `StepLoadState.13371c83` | 写死 | 需要的话，请联系管理员开通。 | 说明 | [StepLoadState.tsx:9](../../apps/web/src/pages/products/StepLoadState.tsx#L9) |
| `StepLoadState.d1c7a815` | 写死 | 你没有权限查看这里 | 标题 | [StepLoadState.tsx:9](../../apps/web/src/pages/products/StepLoadState.tsx#L9) |
| `StepLoadState.21ff2da3` | 写死 | 找不到这部分内容 | 标题 | [StepLoadState.tsx:10](../../apps/web/src/pages/products/StepLoadState.tsx#L10) |
| `StepLoadState.a8a0764b` | 写死 | 这个商品可能已被删除，或链接有误。请回到商品列表再看。 | 说明 | [StepLoadState.tsx:10](../../apps/web/src/pages/products/StepLoadState.tsx#L10) |
| `StepLoadState.87e86e52` | 写死 | 加载失败 | 标题 | [StepLoadState.tsx:14](../../apps/web/src/pages/products/StepLoadState.tsx#L14) |
| `StepLoadState.e28c01d9` | 写死 | 请检查网络后重试。 | 说明 | [StepLoadState.tsx:15](../../apps/web/src/pages/products/StepLoadState.tsx#L15) |
| `StepLoadState.39b7f1a9` | 写死 | 重试 | 按钮 | [StepLoadState.tsx:19](../../apps/web/src/pages/products/StepLoadState.tsx#L19) |

## 多个页面共用：一步的外壳（StepShell.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/StepShell.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `StepShell.0d461f5a` | 写死 | 品类 | 文字 | [StepShell.tsx:22](../../apps/web/src/pages/products/StepShell.tsx#L22) |
| `StepShell.bdaa3061` | 写死 | 接送点 | 文字 | [StepShell.tsx:22](../../apps/web/src/pages/products/StepShell.tsx#L22) |
| `StepShell.d56b7ecd` | 写死 | 子品牌 | 文字 | [StepShell.tsx:22](../../apps/web/src/pages/products/StepShell.tsx#L22) |
| `StepShell.dd023105` | 写死 | 城市 | 文字 | [StepShell.tsx:22](../../apps/web/src/pages/products/StepShell.tsx#L22) |
| `StepShell.ef959434` | 写死 | 保存 | 文字 | [StepShell.tsx:130](../../apps/web/src/pages/products/StepShell.tsx#L130)、167、215 行 |
| `StepShell.b5a93c33` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [StepShell.tsx:135](../../apps/web/src/pages/products/StepShell.tsx#L135)、138 行 |
| `StepShell.f0ee6f27` | 写死 | 选的城市或接送点已经被平台停用，请换一个。 | 文字 | [StepShell.tsx:142](../../apps/web/src/pages/products/StepShell.tsx#L142) |
| `StepShell.4e8bc9eb` | 写死 | 这个商品已上架，改成这样就不满足上架的条件了。请补齐后再保存；要大改，请先下架。 | 文字 | [StepShell.tsx:148](../../apps/web/src/pages/products/StepShell.tsx#L148) |
| `StepShell.cac2b62a` | 写死 | 没有保存。 | 标题 | [StepShell.tsx:148](../../apps/web/src/pages/products/StepShell.tsx#L148) |
| `StepShell.da8fcd76` | 写死 | 同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。 | 文字 | [StepShell.tsx:153](../../apps/web/src/pages/products/StepShell.tsx#L153) |
| `StepShell.7bc82e3e` | 写死 | 有些内容 | 文字 | [StepShell.tsx:156](../../apps/web/src/pages/products/StepShell.tsx#L156) |
| `StepShell.e4afd941` | 写死 | {…}创建后不能修改。请刷新页面后重试。 | 文字 | [StepShell.tsx:156](../../apps/web/src/pages/products/StepShell.tsx#L156) |
| `StepShell.56492848` | 写死 | 没有修改权限 | 文字 | [StepShell.tsx:160](../../apps/web/src/pages/products/StepShell.tsx#L160) |
| `StepShell.110cc7b0` | 写死 | 这个商品已经不存在 | 文字 | [StepShell.tsx:164](../../apps/web/src/pages/products/StepShell.tsx#L164) |
| `StepShell.15d1d379` | 写死 | 找不到这个商品，它可能已被别人删除。 | 文字 | [StepShell.tsx:165](../../apps/web/src/pages/products/StepShell.tsx#L165) |
| `StepShell.8646a441` | 写死 | 回到商品列表 | 链接 | [StepShell.tsx:165](../../apps/web/src/pages/products/StepShell.tsx#L165) |
| `StepShell.e9436333` | 写死 | 已保存 | 文字 | [StepShell.tsx:194](../../apps/web/src/pages/products/StepShell.tsx#L194) |
| `StepShell.866bde98` | 写死 | 已创建商品，现在是草稿 | 提示 | [StepShell.tsx:196](../../apps/web/src/pages/products/StepShell.tsx#L196) |
| `StepShell.36225920` | 写死 | 请先载入最新内容 | 提示 | [StepShell.tsx:214](../../apps/web/src/pages/products/StepShell.tsx#L214) |
| `StepShell.ba5d52a6` | 写死 | 保存草稿 | 名称 | [StepShell.tsx:215](../../apps/web/src/pages/products/StepShell.tsx#L215) |
| `StepShell.1000b233` | 写死 | 有 {length} 处需要修改 | 正文 | [StepShell.tsx:228](../../apps/web/src/pages/products/StepShell.tsx#L228) |
| `StepShell.359d9a3d` | 写死 | 这个商品刚被别人修改过，你在这一步的修改还没有保存。 | 正文 | [StepShell.tsx:240](../../apps/web/src/pages/products/StepShell.tsx#L240) |
| `StepShell.802d026f` | 写死 | 这个商品刚被别人修改过，你的修改还没有保存。 | 正文 | [StepShell.tsx:240](../../apps/web/src/pages/products/StepShell.tsx#L240) |
| `StepShell.22188611` | 写死 | 点下面的按钮载入最新的内容，你没保存的修改会留着。 | 正文 | [StepShell.tsx:241](../../apps/web/src/pages/products/StepShell.tsx#L241) |
| `StepShell.b652f8cd` | 写死 | 请先载入最新内容，再重新修改。载入后，你在这一步还没保存的修改会丢失。 | 正文 | [StepShell.tsx:241](../../apps/web/src/pages/products/StepShell.tsx#L241) |
| `StepShell.614adee3` | 写死 | 已载入最新内容。 | 文字 | [StepShell.tsx:251](../../apps/web/src/pages/products/StepShell.tsx#L251) |
| `StepShell.a2385c07` | 写死 | 已载入最新内容，你的修改还在，检查后再点保存。 | 文字 | [StepShell.tsx:251](../../apps/web/src/pages/products/StepShell.tsx#L251) |
| `StepShell.b1c55bd9` | 写死 | 载入最新内容 | 按钮 | [StepShell.tsx:255](../../apps/web/src/pages/products/StepShell.tsx#L255) |
| `StepShell.f124ec15` | 写死 | 载入最新内容，保留我的修改 | 按钮 | [StepShell.tsx:255](../../apps/web/src/pages/products/StepShell.tsx#L255) |
| `StepShell.424f72b7` | 写死 | 回到列表 | 按钮 | [StepShell.tsx:290](../../apps/web/src/pages/products/StepShell.tsx#L290) |
| `StepShell.74e80b26` | 写死 | 这一步已完成 | 正文 | [StepShell.tsx:298](../../apps/web/src/pages/products/StepShell.tsx#L298) |
| `StepShell.9ee9df8e` | 写死 | 这一步还差 {count} 项 | 按钮 | [StepShell.tsx:309](../../apps/web/src/pages/products/StepShell.tsx#L309) |
| `StepShell.b4f3ae8d` | 写死 |  · 有未保存的修改 | 正文 | [StepShell.tsx:312](../../apps/web/src/pages/products/StepShell.tsx#L312) |
| `StepShell.cd87304e` | 写死 |  · 已上架，保存后约 1 分钟生效 | 正文 | [StepShell.tsx:313](../../apps/web/src/pages/products/StepShell.tsx#L313) |
| `StepShell.356a64e9` | 写死 | 取消 | 按钮 | [StepShell.tsx:318](../../apps/web/src/pages/products/StepShell.tsx#L318) |
| `StepShell.e0db4b91` | 写死 | 保存中… | 文字 | [StepShell.tsx:319](../../apps/web/src/pages/products/StepShell.tsx#L319)、322、361 行 |
| `StepShell.d02b898c` | 写死 | 这一步有未保存的修改 | 标题 | [StepShell.tsx:329](../../apps/web/src/pages/products/StepShell.tsx#L329) |
| `StepShell.a57e8cf8` | 写死 | 继续编辑 | 按钮 | [StepShell.tsx:343](../../apps/web/src/pages/products/StepShell.tsx#L343) |
| `StepShell.7cb5d632` | 写死 | 不保存 | 按钮 | [StepShell.tsx:357](../../apps/web/src/pages/products/StepShell.tsx#L357) |
| `StepShell.472343af` | 写死 | 保存并继续 | 按钮 | [StepShell.tsx:372](../../apps/web/src/pages/products/StepShell.tsx#L372) |
| `StepShell.07a82f87` | 写死 | 要先保存吗？ | 正文 | [StepShell.tsx:376](../../apps/web/src/pages/products/StepShell.tsx#L376) |

## 多个页面共用：导入价格 / 导入库存（ImportPage.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/inventory/ImportPage.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `ImportPage.4beef6bf` | 写死 | 冲突 | 文字 | [ImportPage.tsx:61](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L61)、62 行 |
| `ImportPage.5f118a35` | 写死 | 新增 | 文字 | [ImportPage.tsx:61](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L61) |
| `ImportPage.75ab44b2` | 写死 | 没变 | 文字 | [ImportPage.tsx:61](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L61)、62 行 |
| `ImportPage.c7dc43ba` | 写死 | 出错 | 提示 | [ImportPage.tsx:61](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L61)、62 行 |
| `ImportPage.e0cad3a0` | 写死 | 修改 | 文字 | [ImportPage.tsx:61](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L61) |
| `ImportPage.4554f6c5` | 写死 | 设库存 | 文字 | [ImportPage.tsx:62](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L62) |
| `ImportPage.dfa1bb39` | 写死 | 清除 | 文字 | [ImportPage.tsx:62](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L62) |
| `ImportPage.d5536696` | 写死 | {…} 行出错 | 文字 | [ImportPage.tsx:97](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L97) |
| `ImportPage.dc35076a` | 写死 | {…} 行冲突 | 文字 | [ImportPage.tsx:97](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L97) |
| `ImportPage.3f234974` | 写死 | 库存 | 名称 | [ImportPage.tsx:108](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L108) |
| `ImportPage.4d363a8a` | 写死 | 价格规则 | 名称 | [ImportPage.tsx:108](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L108) |
| `ImportPage.f7e5a709` | 写死 | 正在检查 {name} | 提示 | [ImportPage.tsx:147](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L147) |
| `ImportPage.469eb33d` | 写死 | 检查完成：{…} | 提示 | [ImportPage.tsx:157](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L157) |
| `ImportPage.4b726857` | 写死 | 检查完成，没有问题 | 提示 | [ImportPage.tsx:157](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L157) |
| `ImportPage.61ef62d8` | 写死 | 已取消，没有改动任何东西。 | 文字 | [ImportPage.tsx:161](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L161) |
| `ImportPage.6c9d9afc` | 写死 | 找不到这个商品，它可能已被别人删除。 | 文字 | [ImportPage.tsx:165](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L165)、257 行 |
| `ImportPage.8fb12387` | 写死 | 没有检查成功，请检查网络后重试。 | 文字 | [ImportPage.tsx:166](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L166) |
| `ImportPage.be478f49` | 写死 | 上一次检查：{name}，{…}。 | 文字 | [ImportPage.tsx:186](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L186) |
| `ImportPage.303fc69b` | 写死 | 这个文件在检查之后被改动或移走了。请重新选择文件，再检查一次。 | 文字 | [ImportPage.tsx:209](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L209) |
| `ImportPage.699714a0` | 写死 | 没有导入。 | 文字 | [ImportPage.tsx:209](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L209)、231、236、245、251、259 行 |
| `ImportPage.fb406cc1` | 写死 | 新增了 {…} 条、修改了 {…} 条价格。 | 文字 | [ImportPage.tsx:216](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L216) |
| `ImportPage.23280e12` | 写死 | 已给 {…} 天设了库存、清除了 {…} 天，共变了 {…} 天。 | 文字 | [ImportPage.tsx:221](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L221) |
| `ImportPage.2f31949c` | 写死 | 请检查网络后再点一次「确认导入」——重复点不会导入两次。 | 文字 | [ImportPage.tsx:228](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L228)、258 行 |
| `ImportPage.32f11aba` | 写死 | 不确定有没有导入成功。 | 标题 | [ImportPage.tsx:228](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L228)、258 行 |
| `ImportPage.999dc5ad` | 写死 | 这次传上去的文件和刚才检查的不是同一份。请重新选择文件，再检查一次。 | 文字 | [ImportPage.tsx:231](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L231) |
| `ImportPage.865aa2d7` | 写死 | 检查之后，这个商品被别人修改过。请重新检查这份文件。 | 文字 | [ImportPage.tsx:236](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L236) |
| `ImportPage.23399b76` | 写死 | 再检查时发现有问题（检查之后情况有变化）。下面是最新的检查结果。 | 文字 | [ImportPage.tsx:245](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L245) |
| `ImportPage.8b6150b1` | 写死 | 这个商品已上架，导入之后就不满足上架的条件了。请改文件，或先下架。 | 文字 | [ImportPage.tsx:251](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L251) |
| `ImportPage.7792de8a` | 写死 | 同时有其他人在修改，这次没有导入。请再点一次「确认导入」。 | 文字 | [ImportPage.tsx:254](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L254) |
| `ImportPage.45773aa6` | 写死 | 系统暂时无法导入，请稍后再试。 | 文字 | [ImportPage.tsx:259](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L259) |
| `ImportPage.3a36a86b` | 写死 | 导入需要修改商品的权限。需要的话，请联系你们的管理员开通。 | 说明 | [ImportPage.tsx:269](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L269) |
| `ImportPage.a067ce22` | 写死 | 你没有权限查看这里 | 标题 | [ImportPage.tsx:269](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L269) |
| `ImportPage.a5278572` | 写死 | 运营后台只能查看供应商的商品，不能修改。要改的话，请联系供应商在供应商后台导入。 | 说明 | [ImportPage.tsx:269](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L269) |
| `ImportPage.c1e35aa5` | 写死 | 运营后台不能导入 | 标题 | [ImportPage.tsx:269](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L269) |
| `ImportPage.d6108dcd` | 写死 | 回到{backName} | 按钮 | [ImportPage.tsx:269](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L269)、330 行 |
| `ImportPage.4dfbe80a` | 写死 | 选文件 | 正文 | [ImportPage.tsx:284](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L284) |
| `ImportPage.8b583816` | 写死 | 完成 | 正文 | [ImportPage.tsx:284](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L284) |
| `ImportPage.8b9a3637` | 写死 | 看检查结果 | 正文 | [ImportPage.tsx:284](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L284) |
| `ImportPage.9fe447da` | 写死 | ‹ 回到{backName} | 链接 | [ImportPage.tsx:297](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L297) |
| `ImportPage.8029ffc3` | 写死 | 导入价格 | 标题 | [ImportPage.tsx:299](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L299) |
| `ImportPage.9b2e1c43` | 写死 | 导入库存 | 标题 | [ImportPage.tsx:299](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L299) |
| `ImportPage.6475acc3` | 写死 | 已导入 | 正文 | [ImportPage.tsx:317](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L317) |
| `ImportPage.2b167dd4` | 写死 | 再导入一份 | 按钮 | [ImportPage.tsx:342](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L342) |
| `ImportPage.c0d32c2e` | 写死 | 新增 {…} 条、修改 {…} 条价格 | 文字 | [ImportPage.tsx:351](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L351) |
| `ImportPage.d365ba25` | 写死 | 给 {…} 天设库存、清除 {…} 天 | 文字 | [ImportPage.tsx:351](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L351) |
| `ImportPage.6cdd3bbb` | 写死 | 先把有问题的行改好 | 提示 | [ImportPage.tsx:353](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L353) |
| `ImportPage.9cc08434` | 写死 | 没有要导入的内容 | 提示 | [ImportPage.tsx:353](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L353)、383 行 |
| `ImportPage.3b4989ab` | 写死 | 重新检查 | 按钮 | [ImportPage.tsx:370](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L370) |
| `ImportPage.12ac1e89` | 写死 | 现在不能导入：有 {…} | 正文 | [ImportPage.tsx:376](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L376) |
| `ImportPage.1f48975b` | 写死 | 只要有一行有问题，整份都不会写入。 | 正文 | [ImportPage.tsx:378](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L378) |
| `ImportPage.a75da9c0` | 写死 | 请在 Excel 里改好（下面写了是哪一格），保存后点「换一个文件」重新上传。没问题的行不用动。 | 正文 | [ImportPage.tsx:378](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L378) |
| `ImportPage.7bdfd44a` | 写死 | 文件里没有填任何一行。 | 正文 | [ImportPage.tsx:384](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L384)、469 行 |
| `ImportPage.ba808585` | 写死 | 文件里的 {…} 行都和现在的一样。 | 正文 | [ImportPage.tsx:384](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L384) |
| `ImportPage.bde7ad6a` | 写死 | 检查通过，可以导入 | 正文 | [ImportPage.tsx:388](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L388) |
| `ImportPage.bea00ff0` | 写死 | 会 | 正文 | [ImportPage.tsx:390](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L390) |
| `ImportPage.32b665e0` | 写死 | {…}。点「确认导入」才会写入。 | 正文 | [ImportPage.tsx:391](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L391) |
| `ImportPage.3b63450b` | 写死 | ，另有 {…} {…}和现在一样，不动 | 正文 | [ImportPage.tsx:391](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L391) |
| `ImportPage.505ed1f9` | 写死 | 行 | 正文 | [ImportPage.tsx:391](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L391)、441 行 |
| `ImportPage.a78a0844` | 写死 | 天 | 正文 | [ImportPage.tsx:391](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L391) |
| `ImportPage.5deeb1be` | 写死 | {name} · {…} · {checkedAt} 检查 | 正文 | [ImportPage.tsx:400](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L400) |
| `ImportPage.d6d211e8` | 写死 | 换一个文件 | 按钮 | [ImportPage.tsx:403](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L403)、492 行 |
| `ImportPage.24fc989c` | 写死 | 各类行数 | 读屏说明 | [ImportPage.tsx:408](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L408) |
| `ImportPage.8e265e88` | 写死 | 共 {…} 行： | 正文 | [ImportPage.tsx:409](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L409) |
| `ImportPage.0505b9e1` | 写死 | 只看有问题的 | 正文 | [ImportPage.tsx:419](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L419) |
| `ImportPage.8ff1303a` | 写死 | 检查结果 | 读屏说明 | [ImportPage.tsx:422](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L422) |
| `ImportPage.bea4539a` | 写死 | 检查结果，共 {…} 行 | 正文 | [ImportPage.tsx:424](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L424) |
| `ImportPage.8035e464` | 写死 | Excel 行号 | 表头 | [ImportPage.tsx:427](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L427)、438 行 |
| `ImportPage.418a4846` | 写死 | 结果 | 表头 | [ImportPage.tsx:428](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L428)、443 行 |
| `ImportPage.f7d295f8` | 写死 | 这一行是什么 | 表头 | [ImportPage.tsx:429](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L429)、449 行 |
| `ImportPage.0446fda7` | 写死 | 说明 | 表头 | [ImportPage.tsx:430](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L430)、452 行 |
| `ImportPage.c3523efd` | 写死 | 第 | 正文 | [ImportPage.tsx:439](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L439) |
| `ImportPage.fa5de1fd` | 写死 | 这一格的内容不对 | 正文 | [ImportPage.tsx:455](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L455) |
| `ImportPage.25330d2d` | 写死 | 没有这一类的行。 | 正文 | [ImportPage.tsx:469](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L469) |
| `ImportPage.5734c078` | 写死 | 另有 {…} 行没有问题，没有列出。 | 正文 | [ImportPage.tsx:475](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L475) |
| `ImportPage.aa0a91e1` | 写死 | 另有 {…} 行没有列出。 | 正文 | [ImportPage.tsx:475](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L475) |
| `ImportPage.5327806a` | 写死 | ；有变化就不会写入，会请你重新检查。写入是整份一起成功或一起不写。 | 正文 | [ImportPage.tsx:477](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L477) |
| `ImportPage.cefeb357` | 写死 | 再检查一遍文件和商品有没有变 | 正文 | [ImportPage.tsx:477](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L477) |
| `ImportPage.d63155da` | 写死 | 检查不会改动任何东西。点「确认导入」时，系统会把这份文件再传一次，并 | 正文 | [ImportPage.tsx:477](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L477) |
| `ImportPage.78b34f39` | 写死 | 确认导入 | 按钮 | [ImportPage.tsx:489](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L489)、512 行 |
| `ImportPage.29872403` | 写死 | 确认导入？ | 标题 | [ImportPage.tsx:501](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L501) |
| `ImportPage.b460e999` | 写死 | 取消 | 按钮 | [ImportPage.tsx:509](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L509)、611 行 |
| `ImportPage.ff270788` | 写死 | 正在导入… | 文字 | [ImportPage.tsx:510](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L510) |
| `ImportPage.580b3419` | 写死 | 这个商品已上架，导入后大约 1 分钟生效。 | 正文 | [ImportPage.tsx:516](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L516) |
| `ImportPage.63984a85` | 写死 | 会{willDo}。{…} | 正文 | [ImportPage.tsx:516](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L516) |
| `ImportPage.28e3c93e` | 写死 | ；要改回去，只能再导入一次或在页面上改。 | 正文 | [ImportPage.tsx:518](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L518) |
| `ImportPage.4a8c0ab1` | 写死 | 写入后不能一键撤销 | 正文 | [ImportPage.tsx:518](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L518) |
| `ImportPage.06f8ff3c` | 写死 | 第一行是表头，不要改；每一行是一条价格， | 正文 | [ImportPage.tsx:529](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L529) |
| `ImportPage.240bdc89` | 写死 | 一次最多 {maxBatchChanges} 行 | 正文 | [ImportPage.tsx:529](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L529) |
| `ImportPage.2ceff7d7` | 写死 | 「价格编号」：导出的行带着它， | 正文 | [ImportPage.tsx:532](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L532) |
| `ImportPage.7605ea4f` | 写死 | 。导入不会删除价格，要删请在页面上删。 | 正文 | [ImportPage.tsx:532](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L532) |
| `ImportPage.8835e2db` | 写死 | 留着 = 修改这一条；新增的行留空 | 正文 | [ImportPage.tsx:532](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L532) |
| `ImportPage.84eee31e` | 写死 | 「区域」填区域的名称，「车型组」填车型组的编码——只能用文件第二张表「填写说明」里列出的。 | 正文 | [ImportPage.tsx:534](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L534) |
| `ImportPage.05e0b162` | 写死 | 。上车、下车不能是同一个区域。 | 正文 | [ImportPage.tsx:538](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L538) |
| `ImportPage.44698ada` | 写死 | 「下车区域」：线路价才填（这个商品的另一个服务区域，只管「区域」上车、「下车区域」下车这一个方向）； | 正文 | [ImportPage.tsx:538](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L538) |
| `ImportPage.fac6965f` | 写死 | 区域价留空 | 正文 | [ImportPage.tsx:538](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L538) |
| `ImportPage.067598f2` | 写死 | 「含公里数」「超出每公里」：一口价选填，两格要一起填或都空着。含公里数是 1 到 2,000 的整数；超出的部分不足 1 公里按 1 公里算。 | 正文 | [ImportPage.tsx:540](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L540) |
| `ImportPage.4abc49b3` | 写死 | 「上车加价」「下车加价」：只有「计价方式」填「区域加价」的行填，不加钱填 0；这时「区域」填加价区域。 | 正文 | [ImportPage.tsx:543](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L543) |
| `ImportPage.0ae88593` | 写死 | 最多 {digits} 位小数 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.823ff823` | 写死 | 只能填整数 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.887a49d8` | 写死 | 结算价 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.8ad0f771` | 写死 | 小数位多了会报错，不会自动四舍五入。 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.bce4b823` | 写死 | 金额是 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.e043b346` | 写死 | ，币种 {currency}，{…}。 | 正文 | [ImportPage.tsx:545](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L545) |
| `ImportPage.a7983b4f` | 写死 | 日期写成 2026-10-01。「生效结束」留空 = 一直有效。 | 正文 | [ImportPage.tsx:547](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L547) |
| `ImportPage.11cddc31` | 写死 | 不要用公式 | 正文 | [ImportPage.tsx:549](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L549) |
| `ImportPage.b4846857` | 写死 | ：带公式的格子会报错，请填算好的数。 | 正文 | [ImportPage.tsx:549](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L549) |
| `ImportPage.7a4b0e43` | 写死 | 一次最多 {maxRangeDays} 行 | 正文 | [ImportPage.tsx:555](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L555) |
| `ImportPage.7ec327b1` | 写死 | 第一行是表头，不要改；每一行是一天， | 正文 | [ImportPage.tsx:555](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L555) |
| `ImportPage.0dc5416e` | 写死 | （限量时没设的日子卖不出去）。 | 正文 | [ImportPage.tsx:558](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L558) |
| `ImportPage.a9c5ac34` | 写死 | 填 0 = 停售；留空 = 清除 | 正文 | [ImportPage.tsx:558](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L558) |
| `ImportPage.c9e0a005` | 写死 | 「可售单数」填 0 到 {…} 的整数。 | 正文 | [ImportPage.tsx:558](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L558) |
| `ImportPage.574e55ea` | 写死 | 只能改今天和以后的日子。文件里没有的日子不会动。 | 正文 | [ImportPage.tsx:560](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L560) |
| `ImportPage.576f955b` | 写死 | 不要用公式。 | 正文 | [ImportPage.tsx:562](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L562) |
| `ImportPage.0e335403` | 写死 | {…}传上来以后先检查， | 正文 | [ImportPage.tsx:575](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L575) |
| `ImportPage.2b0109b1` | 写死 | 检查不会改动任何东西 | 正文 | [ImportPage.tsx:575](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L575) |
| `ImportPage.6057a324` | 写死 | 先导出一段日期的库存，在 Excel 里填好，再传到这里。 | 正文 | [ImportPage.tsx:575](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L575) |
| `ImportPage.a6e25a52` | 写死 | 先下载模版或导出现有的价格，在 Excel 里填好，再传到这里。 | 正文 | [ImportPage.tsx:575](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L575) |
| `ImportPage.b68da193` | 写死 | ；你看过结果、点了确认才会写入。 | 正文 | [ImportPage.tsx:575](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L575) |
| `ImportPage.5702aa27` | 写死 | 下载空白模版 | 按钮 | [ImportPage.tsx:582](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L582) |
| `ImportPage.9235a7fc` | 写死 | 导出现有的价格 | 按钮 | [ImportPage.tsx:585](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L585) |
| `ImportPage.5648ee3c` | 写死 | 导出今后 90 天的库存 | 按钮 | [ImportPage.tsx:590](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L590) |
| `ImportPage.c08eb1dd` | 写死 | 正在准备文件… | 正文 | [ImportPage.tsx:592](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L592) |
| `ImportPage.b03d330e` | 写死 | 怎么填 | 正文 | [ImportPage.tsx:595](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L595) |
| `ImportPage.d621e82f` | 写死 | {…}没有小数。 | 正文 | [ImportPage.tsx:597](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L597) |
| `ImportPage.4c67ccc6` | 写死 | 正在检查 | 读屏说明 | [ImportPage.tsx:607](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L607) |
| `ImportPage.7e0fcd57` | 写死 | 正在检查… | 正文 | [ImportPage.tsx:608](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L608) |
| `ImportPage.f27473dd` | 写死 | 把 .xlsx 文件拖到这里，或 | 正文 | [ImportPage.tsx:623](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L623) |
| `ImportPage.72d25a50` | 写死 | 选择文件 | 表单标签 | [ImportPage.tsx:627](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L627) |
| `ImportPage.1821e40b` | 写死 | 只收 .xlsx，最大 1 MB | 正文 | [ImportPage.tsx:628](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L628) |
| `ImportPage.b90ee5ce` | 写死 | 重试 | 按钮 | [ImportPage.tsx:639](../../apps/web/src/pages/products/inventory/ImportPage.tsx#L639) |

## 多个页面共用：④ 库存（InventoryStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/inventory/InventoryStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `InventoryStep.33017a56` | 写死 | 这个商品刚被别人修改过，已经载入最新的库存。请核对后再点一次。 | 文字 | [InventoryStep.tsx:152](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L152) |
| `InventoryStep.7783dbfa` | 写死 | 同时有其他人在修改，这次没有{action}成功。请再点一次。 | 文字 | [InventoryStep.tsx:157](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L157) |
| `InventoryStep.b7c038b4` | 写死 | 这个商品已上架，改成这样就不满足上架的条件了。 | 文字 | [InventoryStep.tsx:158](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L158) |
| `InventoryStep.ddb9d1ff` | 写死 | 找不到这个商品，它可能已被别人删除。 | 文字 | [InventoryStep.tsx:160](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L160) |
| `InventoryStep.694871cc` | 写死 | 库存按{cityName}当地的用车日期算。一天一个数，不分时段，也不分车型组。 | 正文 | [InventoryStep.tsx:167](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L167) |
| `InventoryStep.bbcdd5e4` | 写死 | ④ 库存 | 标题 | [InventoryStep.tsx:172](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L172) |
| `InventoryStep.0f0d7560` | 写死 | 已上架，改完大约 1 分钟生效 | 正文 | [InventoryStep.tsx:176](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L176) |
| `InventoryStep.e8d222d4` | 写死 | 下一步 | 按钮 | [InventoryStep.tsx:179](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L179) |
| `InventoryStep.bf9179ae` | 写死 | 已经过去，只能看 | 文字 | [InventoryStep.tsx:197](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L197) |
| `InventoryStep.cab6a71c` | 写死 | 超出可以设库存的范围 | 文字 | [InventoryStep.tsx:197](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L197)、540 行 |
| `InventoryStep.6ec0cafd` | 写死 | 加载中 | 文字 | [InventoryStep.tsx:207](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L207) |
| `InventoryStep.ac960dba` | 写死 | 没有加载出来 | 文字 | [InventoryStep.tsx:207](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L207) |
| `InventoryStep.554c04b8` | 写死 | 已保存 {…} 的库存 | 提示 | [InventoryStep.tsx:233](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L233) |
| `InventoryStep.510af151` | 写死 | 保存 | 文字 | [InventoryStep.tsx:236](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L236)、406、438、584、778 行 |
| `InventoryStep.eada68d0` | 写死 | 库存模式 | 标题 | [InventoryStep.tsx:253](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L253) |
| `InventoryStep.8f9efed0` | 写死 | 现在是： | 正文 | [InventoryStep.tsx:256](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L256) |
| `InventoryStep.0d83bd13` | 写死 | 下面日历里设的数现在不起作用，改成限量后才生效。 | 正文 | [InventoryStep.tsx:260](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L260) |
| `InventoryStep.9d3621bc` | 写死 | 每天接多少单都可以，不用设库存。{…} | 正文 | [InventoryStep.tsx:260](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L260) |
| `InventoryStep.067994ce` | 写死 | 没有设库存的日子卖不出去。 | 正文 | [InventoryStep.tsx:263](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L263) |
| `InventoryStep.cb6ed4ca` | 写死 | 每天最多接你设的单数。 | 正文 | [InventoryStep.tsx:263](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L263) |
| `InventoryStep.16d2c181` | 写死 |  已上架，改完大约 1 分钟生效。 | 正文 | [InventoryStep.tsx:266](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L266) |
| `InventoryStep.8becb910` | 写死 | 改成限量 | 按钮 | [InventoryStep.tsx:271](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L271)、633 行 |
| `InventoryStep.91906ec4` | 写死 | 改成不限量 | 按钮 | [InventoryStep.tsx:271](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L271)、633 行 |
| `InventoryStep.84d87d31` | 写死 | 从今天起没有一天有库存，这个商品现在卖不出去。 | 正文 | [InventoryStep.tsx:278](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L278) |
| `InventoryStep.33093ea5` | 写死 | 限量时，没有设库存的日子不接单。请给要卖的日子设上库存，或改成不限量。 | 正文 | [InventoryStep.tsx:279](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L279) |
| `InventoryStep.85f000f4` | 写死 | 批量设置 | 按钮 | [InventoryStep.tsx:284](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L284)、310、352 行 |
| `InventoryStep.c7ea020e` | 写死 | 这个月有 {length} 天没设库存，这些天卖不出去。 | 正文 | [InventoryStep.tsx:292](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L292) |
| `InventoryStep.f437afef` | 写死 | 给这些天设库存 | 按钮 | [InventoryStep.tsx:298](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L298) |
| `InventoryStep.91607c04` | 写死 | 库存日历 | 标题 | [InventoryStep.tsx:308](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L308) |
| `InventoryStep.98762d78` | 写死 | 导入 / 导出 | 正文 | [InventoryStep.tsx:311](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L311) |
| `InventoryStep.a54f47fd` | 写死 | 正在准备文件… | 文字 | [InventoryStep.tsx:311](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L311) |
| `InventoryStep.2588f9c5` | 写死 | 导出库存… | 正文 | [InventoryStep.tsx:313](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L313) |
| `InventoryStep.98a006c7` | 写死 | 导入库存… | 正文 | [InventoryStep.tsx:319](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L319) |
| `InventoryStep.b75525d2` | 写死 | 上个月 | 名称 | [InventoryStep.tsx:327](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L327) |
| `InventoryStep.2d00106b` | 写死 | 下个月 | 名称 | [InventoryStep.tsx:331](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L331) |
| `InventoryStep.071c332b` | 写死 | 回到本月 | 按钮 | [InventoryStep.tsx:335](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L335) |
| `InventoryStep.9d201ba5` | 写死 | 选一段日期 | 按钮 | [InventoryStep.tsx:339](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L339) |
| `InventoryStep.b04adf0b` | 写死 | 点一天直接改；拖动或用键盘选一段日期批量设置 | 正文 | [InventoryStep.tsx:340](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L340) |
| `InventoryStep.74e97652` | 写死 | 再点结束的那一天 | 正文 | [InventoryStep.tsx:342](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L342) |
| `InventoryStep.824ad41f` | 写死 | 点开始的那一天 | 正文 | [InventoryStep.tsx:342](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L342) |
| `InventoryStep.76db51da` | 写死 | {from} 至 {to} | 正文 | [InventoryStep.tsx:347](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L347) |
| `InventoryStep.8d632d03` | 写死 | 已选 | 正文 | [InventoryStep.tsx:347](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L347) |
| `InventoryStep.da06fa0e` | 写死 | ，共 {…} 天 | 正文 | [InventoryStep.tsx:347](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L347) |
| `InventoryStep.41ed9d9f` | 写死 | 取消选择 | 按钮 | [InventoryStep.tsx:356](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L356) |
| `InventoryStep.2232f998` | 写死 | {…}每一天的库存 | 名称 | [InventoryStep.tsx:363](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L363) |
| `InventoryStep.38ab94e7` | 写死 | 日期是{cityName}当地的用车日期。没设 = 限量时这一天卖不出去；停售 = 你把这一天设成了 0。 | 正文 | [InventoryStep.tsx:381](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L381) |
| `InventoryStep.5716beb5` | 写死 | {shownDate} 的库存 | 标题 | [InventoryStep.tsx:384](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L384) |
| `InventoryStep.f5486b45` | 写死 | 关闭 | 按钮 | [InventoryStep.tsx:384](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L384) |
| `InventoryStep.2890dc3d` | 写死 | 已改成限量 | 提示 | [InventoryStep.tsx:402](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L402) |
| `InventoryStep.a1fd7d38` | 写死 | 已改成不限量 | 提示 | [InventoryStep.tsx:402](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L402) |
| `InventoryStep.697fbe0a` | 写死 | 系统暂时无法保存，请稍后再试。 | 文字 | [InventoryStep.tsx:408](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L408) |
| `InventoryStep.2d7b0ff0` | 写死 | 这些天本来就是这样，没有变化 | 提示 | [InventoryStep.tsx:431](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L431) |
| `InventoryStep.2e1571fa` | 写死 | 已设置 {…} 天的库存 | 提示 | [InventoryStep.tsx:431](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L431) |
| `InventoryStep.a8925f45` | 写死 | 可售 | 正文 | [InventoryStep.tsx:467](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L467) |
| `InventoryStep.4e13100d` | 写死 | 可售单数 | 读屏说明 | [InventoryStep.tsx:473](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L473) |
| `InventoryStep.4ed988b2` | 写死 | 单 | 正文 | [InventoryStep.tsx:480](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L480) |
| `InventoryStep.800755e4` | 写死 | 停售 | 正文 | [InventoryStep.tsx:486](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L486)、856 行 |
| `InventoryStep.903a17d3` | 写死 | 这一天不接单。日历上写「停售」。 | 正文 | [InventoryStep.tsx:486](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L486) |
| `InventoryStep.586b4371` | 写死 | 清除 | 正文 | [InventoryStep.tsx:493](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L493)、856 行 |
| `InventoryStep.a9ffcc6a` | 写死 | 改回「没设」。{…} | 正文 | [InventoryStep.tsx:493](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L493) |
| `InventoryStep.bd6f440f` | 写死 | 这一天同样卖不出去，日历上会一直标着提醒你。 | 正文 | [InventoryStep.tsx:493](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L493) |
| `InventoryStep.f2030dbf` | 写死 | 不限量时没有影响。 | 正文 | [InventoryStep.tsx:493](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L493) |
| `InventoryStep.5296e9a2` | 写死 | 这一天已经有 {…} 单，不能停售，也不能清除。最少可以改成 {…}（改成 {…} 就是不再接新单）。 | 正文 | [InventoryStep.tsx:496](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L496) |
| `InventoryStep.d68100f3` | 写死 | 这一天已经有 {…} 单，可售单数不能少于 {…}。 | 文字 | [InventoryStep.tsx:524](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L524) |
| `InventoryStep.ac581263` | 写死 | 加载中… | 正文 | [InventoryStep.tsx:535](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L535) |
| `InventoryStep.64306ce4` | 写死 | 没设，卖不出去 | 正文 | [InventoryStep.tsx:540](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L540) |
| `InventoryStep.890ced0a` | 写死 | 没设 | 正文 | [InventoryStep.tsx:540](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L540) |
| `InventoryStep.c03c1474` | 写死 | 还剩 {…} 单 | 正文 | [InventoryStep.tsx:540](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L540) |
| `InventoryStep.3f3004bc` | 写死 | 。现在是不限量，这个数不起作用 | 正文 | [InventoryStep.tsx:543](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L543) |
| `InventoryStep.59b26d10` | 写死 | 现在是不限量，这一天没有预先设数。 | 正文 | [InventoryStep.tsx:543](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L543) |
| `InventoryStep.9b4bcbfe` | 写死 |  单 | 文字 | [InventoryStep.tsx:543](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L543) |
| `InventoryStep.d3e7c693` | 写死 |  · 已售 0 单 · 待付款 0 单 | 正文 | [InventoryStep.tsx:543](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L543) |
| `InventoryStep.ee37664e` | 写死 | 限量时，没有设库存的日子不接单。 | 正文 | [InventoryStep.tsx:543](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L543) |
| `InventoryStep.1c964926` | 写死 | 过去的日子只能看。 | 正文 | [InventoryStep.tsx:546](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L546) |
| `InventoryStep.e314f58d` | 写死 | 最远只能设到 {last}（今天之后 {maxDaysAhead} 天）。 | 正文 | [InventoryStep.tsx:548](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L548) |
| `InventoryStep.dab00631` | 写死 | 这一天改成： | 正文 | [InventoryStep.tsx:564](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L564) |
| `InventoryStep.3b8999b0` | 写死 | 这一天改成 | 标题 | [InventoryStep.tsx:567](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L567) |
| `InventoryStep.70b8b66e` | 写死 | 保存中… | 文字 | [InventoryStep.tsx:582](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L582)、632、764、776 行 |
| `InventoryStep.67b73742` | 写死 | 改成限量？ | 标题 | [InventoryStep.tsx:619](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L619) |
| `InventoryStep.9029c8d8` | 写死 | 改成不限量？ | 标题 | [InventoryStep.tsx:619](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L619) |
| `InventoryStep.1b10d6a4` | 写死 | 取消 | 按钮 | [InventoryStep.tsx:626](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L626)、775、935 行 |
| `InventoryStep.07f48f20` | 写死 | 先去设库存 | 按钮 | [InventoryStep.tsx:630](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L630) |
| `InventoryStep.6654afd2` | 写死 | ，下多少单都会接。你设好的每日库存会留着，但不起作用；以后改回限量时还在。 | 正文 | [InventoryStep.tsx:641](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L641) |
| `InventoryStep.b994cad0` | 写死 | 每天不再限制接单的数量 | 正文 | [InventoryStep.tsx:641](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L641) |
| `InventoryStep.e87b931b` | 写死 | 改成不限量后， | 正文 | [InventoryStep.tsx:641](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L641) |
| `InventoryStep.030e743d` | 写死 | 每天最多接你设的单数；没有设库存的日子卖不出去 | 正文 | [InventoryStep.tsx:646](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L646) |
| `InventoryStep.3e29473c` | 写死 | 改成限量后， | 正文 | [InventoryStep.tsx:646](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L646) |
| `InventoryStep.1ae8a56d` | 写死 | 现在改成限量，这个商品每一天都卖不出去，直到你设上。建议先点「先去设库存」，设好再改。 | 正文 | [InventoryStep.tsx:653](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L653) |
| `InventoryStep.2950045d` | 写死 | 你还没有给任何一天设库存。 | 正文 | [InventoryStep.tsx:653](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L653) |
| `InventoryStep.71deaae5` | 写死 | 今后一年里，你已经给 {…} 天设了库存（其中 {…} 天有库存可卖），最晚设到 {…}。其余的日子卖不出去。 | 正文 | [InventoryStep.tsx:657](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L657) |
| `InventoryStep.be1889ce` | 写死 | 这个商品已上架，改完大约 1 分钟生效。 | 正文 | [InventoryStep.tsx:662](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L662) |
| `InventoryStep.416096cb` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [InventoryStep.tsx:721](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L721) |
| `InventoryStep.81b6b62e` | 写死 | 到 | 正文 | [InventoryStep.tsx:728](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L728)、921 行 |
| `InventoryStep.c513fb2f` | 写死 | 从 | 正文 | [InventoryStep.tsx:728](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L728)、921 行 |
| `InventoryStep.23d34544` | 写死 | 年-月-日 | 输入框占位 | [InventoryStep.tsx:737](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L737) |
| `InventoryStep.86f65417` | 写死 | 批量设置库存 | 标题 | [InventoryStep.tsx:756](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L756) |
| `InventoryStep.c237acf4` | 写死 | 要改 {…} 天，确定吗？ | 正文 | [InventoryStep.tsx:763](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L763) |
| `InventoryStep.7b79abbf` | 写死 | 确定 | 按钮 | [InventoryStep.tsx:766](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L766) |
| `InventoryStep.42d87b64` | 写死 | 再看看 | 按钮 | [InventoryStep.tsx:769](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L769) |
| `InventoryStep.943c6b1d` | 写死 | 日期 | 表单标签 | [InventoryStep.tsx:797](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L797)、951 行 |
| `InventoryStep.17416d96` | 写死 | 日期从 | 文字 | [InventoryStep.tsx:802](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L802) |
| `InventoryStep.ce0f4d61` | 写死 | 日期到 | 文字 | [InventoryStep.tsx:803](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L803) |
| `InventoryStep.40652e2d` | 写死 | 用车日期，两头都算；写成 2026-01-31 这样。 | 正文 | [InventoryStep.tsx:806](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L806) |
| `InventoryStep.41b2bd91` | 写死 | 哪几天 | 表单标签 | [InventoryStep.tsx:811](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L811)、815 行 |
| `InventoryStep.b6d1a511` | 写死 | 每天 | 正文 | [InventoryStep.tsx:818](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L818) |
| `InventoryStep.8ab3b601` | 写死 | 只设每周的某几天 | 正文 | [InventoryStep.tsx:822](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L822) |
| `InventoryStep.013bace2` | 写死 | 每周的哪几天 | 读屏说明 | [InventoryStep.tsx:826](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L826) |
| `InventoryStep.1905578e` | 写死 | 工作日 | 按钮 | [InventoryStep.tsx:838](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L838) |
| `InventoryStep.f9001f18` | 写死 | 周末 | 按钮 | [InventoryStep.tsx:841](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L841) |
| `InventoryStep.ba761e8d` | 写死 | 设成 | 表单标签 | [InventoryStep.tsx:849](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L849)、853 行 |
| `InventoryStep.2062769c` | 写死 | 和 | 正文 | [InventoryStep.tsx:856](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L856) |
| `InventoryStep.4903acb8` | 写死 | ，现在的效果一样：这些天都不接单。区别是—— | 正文 | [InventoryStep.tsx:856](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L856) |
| `InventoryStep.96e8fef2` | 写死 | 是「还没定」，日历上写「没设」，限量时会一直用警告色提醒你。不确定就用停售。 | 正文 | [InventoryStep.tsx:856](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L856) |
| `InventoryStep.e3faae75` | 写死 | 是你定下来的「这几天不卖」，日历上写「停售」，不再提醒； | 正文 | [InventoryStep.tsx:856](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L856) |
| `InventoryStep.513494c6` | 写死 | 没有保存，一天都没有改。 | 正文 | [InventoryStep.tsx:862](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L862) |
| `InventoryStep.cd236f87` | 写死 | 这样保存不了。 | 正文 | [InventoryStep.tsx:862](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L862) |
| `InventoryStep.458422d4` | 写死 | 不能停售，也不能清除： | 正文 | [InventoryStep.tsx:863](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L863) |
| `InventoryStep.cf533770` | 写死 | 这 {…} 天已经有订单占着库存，{…} | 正文 | [InventoryStep.tsx:863](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L863) |
| `InventoryStep.d4383bd8` | 写死 | 可售单数不能少于已占用的单数： | 正文 | [InventoryStep.tsx:863](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L863) |
| `InventoryStep.9b01502e` | 写死 | 还有 {…} 天 | 正文 | [InventoryStep.tsx:870](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L870) |
| `InventoryStep.a1c37512` | 写死 | ，或改日期避开这几天。 | 正文 | [InventoryStep.tsx:875](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L875) |
| `InventoryStep.dfe5f31d` | 写死 | 把数量改成不少于 | 正文 | [InventoryStep.tsx:875](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L875) |
| `InventoryStep.8e4be60d` | 写死 | 请改日期避开这几天。 | 正文 | [InventoryStep.tsx:878](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L878) |
| `InventoryStep.8b702b94` | 写死 | 请填开始日期 | 文字 | [InventoryStep.tsx:913](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L913) |
| `InventoryStep.f5340fbb` | 写死 | 请填结束日期 | 文字 | [InventoryStep.tsx:914](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L914) |
| `InventoryStep.f7962180` | 写死 | 结束日期不能早于开始日期 | 文字 | [InventoryStep.tsx:915](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L915) |
| `InventoryStep.6fdcb160` | 写死 | 一次最多导出 {maxRangeDays} 天 | 文字 | [InventoryStep.tsx:916](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L916) |
| `InventoryStep.5e0cb5a4` | 写死 | 导出库存 | 标题 | [InventoryStep.tsx:929](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L929) |
| `InventoryStep.36c14b17` | 写死 | 导出 | 按钮 | [InventoryStep.tsx:938](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L938) |
| `InventoryStep.30e99ea7` | 写死 | 导出日期从 | 文字 | [InventoryStep.tsx:953](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L953) |
| `InventoryStep.41221a20` | 写死 | 导出日期到 | 文字 | [InventoryStep.tsx:954](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L954) |
| `InventoryStep.2a4bb145` | 写死 | 每天一行。没设的日子那一格是空的——填上数再导入就是设置，所以它也是导入用的模版。 | 正文 | [InventoryStep.tsx:959](../../apps/web/src/pages/products/inventory/InventoryStep.tsx#L959) |

## 多个页面共用：导出 / 下载模版（useDownload.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/inventory/useDownload.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `useDownload.cae8b3aa` | 写死 | 已开始下载「{name}」 | 提示 | [useDownload.tsx:31](../../apps/web/src/pages/products/inventory/useDownload.tsx#L31) |
| `useDownload.76b78876` | 写死 | 文件没有准备好，请稍后再试。 | 正文 | [useDownload.tsx:43](../../apps/web/src/pages/products/inventory/useDownload.tsx#L43) |
| `useDownload.f3c5d269` | 写死 | 重试 | 按钮 | [useDownload.tsx:47](../../apps/web/src/pages/products/inventory/useDownload.tsx#L47) |

## 多个页面共用：新建 / 编辑一条调价规则（AdjustRuleForm.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/AdjustRuleForm.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AdjustRuleForm.35c03763` | 写死 | 出行日期里的每一天。 | 说明 | [AdjustRuleForm.tsx:53](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L53) |
| `AdjustRuleForm.db0382e5` | 写死 | 每天 | 名称 | [AdjustRuleForm.tsx:53](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L53)、361 行 |
| `AdjustRuleForm.308c9c2b` | 写死 | 出行日期里的每个周几。 | 说明 | [AdjustRuleForm.tsx:54](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L54) |
| `AdjustRuleForm.5dad33a4` | 写死 | 每周的某几天 | 名称 | [AdjustRuleForm.tsx:54](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L54) |
| `AdjustRuleForm.13e19698` | 写死 | 一天一天挑，不连续也行。 | 说明 | [AdjustRuleForm.tsx:55](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L55) |
| `AdjustRuleForm.e1de2297` | 写死 | 指定日期 | 名称 | [AdjustRuleForm.tsx:55](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L55) |
| `AdjustRuleForm.15147943` | 写死 | 节假日 | 名称 | [AdjustRuleForm.tsx:56](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L56) |
| `AdjustRuleForm.2b24aee6` | 写死 | 平台登记的节假日，出行日期里遇到就算。 | 说明 | [AdjustRuleForm.tsx:56](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L56) |
| `AdjustRuleForm.0babdf2c` | 写死 | {name}（复制） | 名称 | [AdjustRuleForm.tsx:130](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L130) |
| `AdjustRuleForm.25a235a4` | 写死 | ‹ 回到调价规则 | 链接 | [AdjustRuleForm.tsx:162](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L162) |
| `AdjustRuleForm.6d0a0913` | 写死 | ‹ 回到价格日历 | 链接 | [AdjustRuleForm.tsx:162](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L162) |
| `AdjustRuleForm.b46e65c3` | 写死 | 回到调价规则 | 按钮 | [AdjustRuleForm.tsx:169](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L169)、183、602、642 行 |
| `AdjustRuleForm.c757579d` | 写死 | 运营后台不能新建调价规则 | 标题 | [AdjustRuleForm.tsx:169](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L169) |
| `AdjustRuleForm.dc5eaf82` | 写死 | 运营后台只能查看供应商的商品，不能修改。要改的话，请联系供应商在供应商后台新建。 | 说明 | [AdjustRuleForm.tsx:169](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L169) |
| `AdjustRuleForm.fcd0f2e7` | 写死 | 新建调价规则需要修改商品的权限。需要的话，请联系你们的管理员开通。 | 说明 | [AdjustRuleForm.tsx:169](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L169) |
| `AdjustRuleForm.feded428` | 写死 | 你没有权限查看这里 | 标题 | [AdjustRuleForm.tsx:169](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L169) |
| `AdjustRuleForm.20cc64f7` | 写死 | 找不到这条调价规则 | 标题 | [AdjustRuleForm.tsx:183](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L183) |
| `AdjustRuleForm.af9e4ef9` | 写死 | 它可能已被别人删除。 | 说明 | [AdjustRuleForm.tsx:183](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L183) |
| `AdjustRuleForm.223a3391` | 写死 | 一个旧的区域 | 名称 | [AdjustRuleForm.tsx:191](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L191) |
| `AdjustRuleForm.981cc8fb` | 写死 | 一个旧的车型组 | 名称 | [AdjustRuleForm.tsx:195](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L195) |
| `AdjustRuleForm.2c4f36ac` | 写死 | {packageHours} 小时 | 文字 | [AdjustRuleForm.tsx:216](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L216)、677 行 |
| `AdjustRuleForm.bd8355de` | 写死 | 整个商品 | 文字 | [AdjustRuleForm.tsx:217](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L217) |
| `AdjustRuleForm.0d7857a3` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [AdjustRuleForm.tsx:247](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L247) |
| `AdjustRuleForm.7724bbb0` | 写死 | {date} 已经在里面了 | 文字 | [AdjustRuleForm.tsx:248](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L248) |
| `AdjustRuleForm.7b7531fd` | 写死 | 最多 {maxAdjustDates} 个日期 | 文字 | [AdjustRuleForm.tsx:249](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L249) |
| `AdjustRuleForm.4fa0111a` | 写死 | 已保存「{name}」 | 提示 | [AdjustRuleForm.tsx:278](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L278) |
| `AdjustRuleForm.8a21c46d` | 写死 | 已新建调价规则「{name}」 | 提示 | [AdjustRuleForm.tsx:278](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L278) |
| `AdjustRuleForm.455f514d` | 写死 | 不能保存。 | 标题 | [AdjustRuleForm.tsx:285](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L285)、286、327 行 |
| `AdjustRuleForm.77a3fe6e` | 写死 |  {count} 条 | 文字 | [AdjustRuleForm.tsx:285](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L285) |
| `AdjustRuleForm.e8e544ea` | 写死 | 按适用范围内的{…}价格算，调完不大于 0。请把下调改小、缩小适用范围，或先不勾「启用」。 | 文字 | [AdjustRuleForm.tsx:285](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L285) |
| `AdjustRuleForm.10bcf8b2` | 写死 | 保存 | 文字 | [AdjustRuleForm.tsx:287](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L287)、303、1002 行 |
| `AdjustRuleForm.042da7e3` | 写死 | 车型组：有的车型组已经不在这个商品里，请重新选 | 文字 | [AdjustRuleForm.tsx:291](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L291) |
| `AdjustRuleForm.a7af24ea` | 写死 | 区域：有的区域已经不在这个商品里，请重新选 | 文字 | [AdjustRuleForm.tsx:291](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L291) |
| `AdjustRuleForm.9fba8b5a` | 写死 | 提交的内容不符合要求，请检查后重试。 | 文字 | [AdjustRuleForm.tsx:297](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L297) |
| `AdjustRuleForm.4752e919` | 写死 | 同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。 | 文字 | [AdjustRuleForm.tsx:299](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L299) |
| `AdjustRuleForm.50f70cd8` | 写死 | 这个商品已上架，改成这样就不满足上架的条件了。 | 文字 | [AdjustRuleForm.tsx:300](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L300) |
| `AdjustRuleForm.b0369a14` | 写死 | 没有保存。 | 标题 | [AdjustRuleForm.tsx:300](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L300) |
| `AdjustRuleForm.9a6c25aa` | 写死 | ；另有 {…} 条价格也是这样 | 文字 | [AdjustRuleForm.tsx:328](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L328) |
| `AdjustRuleForm.f3d0c548` | 写死 | 按「{…}」的价格 {…} 算，调完不大于 0{…}。请把下调改小、缩小适用范围，或先不勾「启用」。 | 文字 | [AdjustRuleForm.tsx:328](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L328) |
| `AdjustRuleForm.80dc506c` | 写死 | 试算里填的那个数 | 名称 | [AdjustRuleForm.tsx:332](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L332) |
| `AdjustRuleForm.bc8e6a0d` | 写死 | 「{…}」的价格 | 名称 | [AdjustRuleForm.tsx:332](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L332) |
| `AdjustRuleForm.113dc4cd` | 写死 | 上调 | 文字 | [AdjustRuleForm.tsx:339](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L339)、961 行 |
| `AdjustRuleForm.cd23b77f` | 写死 | 下调 | 文字 | [AdjustRuleForm.tsx:339](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L339)、962 行 |
| `AdjustRuleForm.d3391dea` | 写死 | {…}了约 {…} | 文字 | [AdjustRuleForm.tsx:339](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L339) |
| `AdjustRuleForm.432c418f` | 写死 | （还没有填{what}） | 正文 | [AdjustRuleForm.tsx:350](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L350) |
| `AdjustRuleForm.5e335587` | 写死 | 日期 | 文字 | [AdjustRuleForm.tsx:356](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L356) |
| `AdjustRuleForm.aaf536e1` | 写死 | 周几 | 文字 | [AdjustRuleForm.tsx:359](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L359) |
| `AdjustRuleForm.221b9006` | 写死 | 哪国的节假日 | 文字 | [AdjustRuleForm.tsx:360](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L360) |
| `AdjustRuleForm.2b7a621f` | 写死 | 全天 | 文字 | [AdjustRuleForm.tsx:365](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L365)、875 行 |
| `AdjustRuleForm.b3a45341` | 写死 | 时段 | 文字 | [AdjustRuleForm.tsx:365](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L365)、574、871、875 行 |
| `AdjustRuleForm.4d68ff20` | 写死 | 车型组 | 文字 | [AdjustRuleForm.tsx:366](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L366)、578、917、918 行 |
| `AdjustRuleForm.a20c6ff4` | 写死 | 全部车型组 | 文字 | [AdjustRuleForm.tsx:366](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L366)、579、918 行 |
| `AdjustRuleForm.d7a41872` | 写死 | 全部区域 | 文字 | [AdjustRuleForm.tsx:366](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L366)、577、907 行 |
| `AdjustRuleForm.f89aa471` | 写死 | 区域 | 文字 | [AdjustRuleForm.tsx:366](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L366)、576、906、907 行 |
| `AdjustRuleForm.4ae02834` | 写死 | 套餐 | 文字 | [AdjustRuleForm.tsx:368](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L368)、588、936、937 行 |
| `AdjustRuleForm.6fcd226d` | 写死 | 全部套餐 | 文字 | [AdjustRuleForm.tsx:368](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L368)、589、937 行 |
| `AdjustRuleForm.c9a9e306` | 写死 | {hours} 小时 | 文字 | [AdjustRuleForm.tsx:368](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L368)、589、940 行 |
| `AdjustRuleForm.4c437c9e` | 写死 | {…} 、{slot}； {…} ：在基础价上 {…} 。 | 正文 | [AdjustRuleForm.tsx:371](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L371) |
| `AdjustRuleForm.904b8333` | 写死 | ，再 | 正文 | [AdjustRuleForm.tsx:382](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L382) |
| `AdjustRuleForm.cb308f62` | 写死 | 怎么调 | 文字 | [AdjustRuleForm.tsx:386](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L386)、592、952 行 |
| `AdjustRuleForm.2f301140` | 写死 | 平台还没有登记节假日，暂时不能选。可以先用「指定日期」。 | 正文 | [AdjustRuleForm.tsx:426](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L426) |
| `AdjustRuleForm.2348b198` | 写死 | 新建调价规则 | 标题 | [AdjustRuleForm.tsx:452](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L452) |
| `AdjustRuleForm.00a925ed` | 写死 | 这条规则的意思 | 标题 | [AdjustRuleForm.tsx:459](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L459) |
| `AdjustRuleForm.777d31d9` | 写死 | 用哪个价来算 | 表单标签 | [AdjustRuleForm.tsx:465](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L465) |
| `AdjustRuleForm.a8d092d4` | 写死 | （不超出起步时） | 选项 | [AdjustRuleForm.tsx:471](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L471) |
| `AdjustRuleForm.9f7628b9` | 写死 | 自己填一个数 | 选项 | [AdjustRuleForm.tsx:475](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L475) |
| `AdjustRuleForm.ebdae38b` | 写死 | 用来试算的基础价 | 读屏说明 | [AdjustRuleForm.tsx:479](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L479) |
| `AdjustRuleForm.7031ddf7` | 写死 | 填一个基础价，这里会一步一步算给你看。 | 正文 | [AdjustRuleForm.tsx:485](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L485) |
| `AdjustRuleForm.ff0a55f7` | 写死 | 把「怎么调」的每一步填好，这里会一步一步算给你看。 | 正文 | [AdjustRuleForm.tsx:487](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L487) |
| `AdjustRuleForm.aed5f91e` | 写死 | 试算 | 读屏说明 | [AdjustRuleForm.tsx:490](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L490) |
| `AdjustRuleForm.af3eb2a3` | 写死 | 步骤 | 正文 | [AdjustRuleForm.tsx:495](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L495) |
| `AdjustRuleForm.9e62a4e6` | 写死 | 变化 | 表头 | [AdjustRuleForm.tsx:499](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L499) |
| `AdjustRuleForm.aea57740` | 写死 | 算完是 | 表头 | [AdjustRuleForm.tsx:502](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L502) |
| `AdjustRuleForm.a3587ca6` | 写死 | 基础价 | 表头 | [AdjustRuleForm.tsx:507](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L507) |
| `AdjustRuleForm.bf759ef8` | 写死 | 第 {…} 步　{…} | 表头 | [AdjustRuleForm.tsx:513](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L513) |
| `AdjustRuleForm.5d7f7b7c` | 写死 | （还没取整） | 正文 | [AdjustRuleForm.tsx:517](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L517) |
| `AdjustRuleForm.0cfbb037` | 写死 | 四舍五入、取整到 {…} | 表头 | [AdjustRuleForm.tsx:522](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L522) |
| `AdjustRuleForm.cb42d3ba` | 写死 | 四舍五入 | 表头 | [AdjustRuleForm.tsx:522](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L522) |
| `AdjustRuleForm.5a5302ea` | 写死 | 不大于 0 | 正文 | [AdjustRuleForm.tsx:529](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L529) |
| `AdjustRuleForm.3e78b778` | 写死 | 按这个价算下来不大于 0，这样的规则保存不了。请把下调改小。 | 正文 | [AdjustRuleForm.tsx:539](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L539) |
| `AdjustRuleForm.366bea08` | 写死 | 和基础价一样 | 正文 | [AdjustRuleForm.tsx:542](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L542) |
| `AdjustRuleForm.7ddd40ce` | 写死 | 比基础价{…} {…} | 正文 | [AdjustRuleForm.tsx:542](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L542) |
| `AdjustRuleForm.7dfa3589` | 写死 | 低 | 正文 | [AdjustRuleForm.tsx:542](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L542) |
| `AdjustRuleForm.940925a1` | 写死 | 这条规则单独生效时：{…} → {…}，{…}。 | 正文 | [AdjustRuleForm.tsx:542](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L542) |
| `AdjustRuleForm.cfb37bad` | 写死 | 高 | 正文 | [AdjustRuleForm.tsx:542](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L542) |
| `AdjustRuleForm.10abf6a5` | 写死 | 同一天还命中别的调价规则的话，会接着往下算，最后才取整。 | 正文 | [AdjustRuleForm.tsx:544](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L544) |
| `AdjustRuleForm.4702b3d6` | 写死 | 名称 | 正文 | [AdjustRuleForm.tsx:566](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L566)、690、695、699 行 |
| `AdjustRuleForm.583260e0` | 写死 | 启用 | 正文 | [AdjustRuleForm.tsx:568](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L568) |
| `AdjustRuleForm.1aa12f0e` | 写死 | 已停用 | 正文 | [AdjustRuleForm.tsx:569](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L569) |
| `AdjustRuleForm.e2c9584f` | 写死 | 已启用 | 正文 | [AdjustRuleForm.tsx:569](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L569) |
| `AdjustRuleForm.1684e06a` | 写死 | 出行日期 | 正文 | [AdjustRuleForm.tsx:570](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L570)、725 行 |
| `AdjustRuleForm.f06a389c` | 写死 | 周期 | 正文 | [AdjustRuleForm.tsx:572](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L572)、743、747 行 |
| `AdjustRuleForm.8357bb5a` | 写死 | 方向 | 正文 | [AdjustRuleForm.tsx:582](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L582)、929、930 行 |
| `AdjustRuleForm.4ce5cb31` | 写死 | 第 {…} 步：{…} | 正文 | [AdjustRuleForm.tsx:595](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L595) |
| `AdjustRuleForm.1570377d` | 写死 | 有 {length} 处需要修改 | 正文 | [AdjustRuleForm.tsx:626](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L626) |
| `AdjustRuleForm.8c5d8171` | 写死 | 找不到这条调价规则，它可能已被别人删除。 | 正文 | [AdjustRuleForm.tsx:638](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L638) |
| `AdjustRuleForm.1904ab16` | 写死 | 这个商品刚被别人修改过，你的修改还没有保存。 | 正文 | [AdjustRuleForm.tsx:648](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L648) |
| `AdjustRuleForm.7d9edd9a` | 写死 | 点下面的按钮载入最新的内容，你在这里填的会留着。 | 正文 | [AdjustRuleForm.tsx:649](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L649) |
| `AdjustRuleForm.804cf117` | 写死 | 载入最新内容，保留我的修改 | 按钮 | [AdjustRuleForm.tsx:662](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L662) |
| `AdjustRuleForm.488a7ac0` | 写死 | 已按你在日历上选的填好了日期和适用范围（{…}）。想对全部区域或车型组都调，把下面的「对哪些」改成「全部」。 | 正文 | [AdjustRuleForm.tsx:677](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L677) |
| `AdjustRuleForm.6361102e` | 写死 | 知道了 | 按钮 | [AdjustRuleForm.tsx:681](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L681) |
| `AdjustRuleForm.a98f9884` | 写死 | 给自己人看的名字，会显示在价格日历上。例如「国庆旺季」「周末夜间」。 | 正文 | [AdjustRuleForm.tsx:702](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L702) |
| `AdjustRuleForm.9515f9e1` | 写死 | 保存后启用 | 正文 | [AdjustRuleForm.tsx:709](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L709) |
| `AdjustRuleForm.e22b3665` | 写死 | 启用这条规则 | 正文 | [AdjustRuleForm.tsx:709](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L709) |
| `AdjustRuleForm.0a2b355c` | 写死 | 不勾 = 先存着，不参与报价。 | 正文 | [AdjustRuleForm.tsx:710](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L710) |
| `AdjustRuleForm.55da111f` | 写死 | 什么时候 | 标题 | [AdjustRuleForm.tsx:720](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L720) |
| `AdjustRuleForm.87ace222` | 写死 | 下面三项同时满足的用车时间，才会被这条规则调价。都按{cityName}当地时间。 | 正文 | [AdjustRuleForm.tsx:721](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L721) |
| `AdjustRuleForm.58321eba` | 写死 | 从 | 正文 | [AdjustRuleForm.tsx:728](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L728)、880 行 |
| `AdjustRuleForm.92933e78` | 写死 | 不限 | 输入框占位 | [AdjustRuleForm.tsx:729](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L729) |
| `AdjustRuleForm.da21fd61` | 写死 | 出行日期从 | 名称 | [AdjustRuleForm.tsx:729](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L729) |
| `AdjustRuleForm.00e7368a` | 写死 | 到 | 正文 | [AdjustRuleForm.tsx:732](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L732)、884 行 |
| `AdjustRuleForm.37d4d7a6` | 写死 | 一直有效 | 输入框占位 | [AdjustRuleForm.tsx:733](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L733) |
| `AdjustRuleForm.45bf1ef6` | 写死 | 出行日期到 | 名称 | [AdjustRuleForm.tsx:733](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L733) |
| `AdjustRuleForm.8ea27f86` | 写死 | 看的是用车日期，两头都算在内。「从」留空 = 不限开始；「到」留空 = 一直有效。 | 正文 | [AdjustRuleForm.tsx:737](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L737) |
| `AdjustRuleForm.70d6dd1f` | 写死 | 每周的哪几天 | 读屏说明 | [AdjustRuleForm.tsx:750](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L750) |
| `AdjustRuleForm.1ab15f6f` | 写死 | 工作日 | 按钮 | [AdjustRuleForm.tsx:762](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L762) |
| `AdjustRuleForm.a1c289fe` | 写死 | 周末 | 按钮 | [AdjustRuleForm.tsx:765](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L765) |
| `AdjustRuleForm.d7a04757` | 写死 | 要添加的日期 | 读屏说明 | [AdjustRuleForm.tsx:779](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L779) |
| `AdjustRuleForm.687f3b53` | 写死 | 年-月-日 | 输入框占位 | [AdjustRuleForm.tsx:782](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L782) |
| `AdjustRuleForm.492acf19` | 写死 | 添加 | 按钮 | [AdjustRuleForm.tsx:797](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L797) |
| `AdjustRuleForm.7dd3f76c` | 写死 | 写成 2026-01-31 这样，一次加一天。 | 正文 | [AdjustRuleForm.tsx:800](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L800) |
| `AdjustRuleForm.dd5b409f` | 写死 | 已选的日期 | 读屏说明 | [AdjustRuleForm.tsx:807](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L807) |
| `AdjustRuleForm.700ceba9` | 写死 | 去掉 {date} | 读屏说明 | [AdjustRuleForm.tsx:811](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L811) |
| `AdjustRuleForm.6ab56def` | 写死 | 节假日没有取到，请检查网络。 | 正文 | [AdjustRuleForm.tsx:827](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L827) |
| `AdjustRuleForm.6ebe234c` | 写死 | 重试 | 按钮 | [AdjustRuleForm.tsx:829](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L829) |
| `AdjustRuleForm.a68c1c5b` | 写死 | 平台还没有登记{…}的节假日，暂时不能按{…}的节假日调价。可以先用「指定日期」，或联系平台运营。 | 文字 | [AdjustRuleForm.tsx:836](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L836) |
| `AdjustRuleForm.38831307` | 写死 | 哪些国家的节假日 | 文字 | [AdjustRuleForm.tsx:839](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L839) |
| `AdjustRuleForm.2a8d5998` | 写死 | {…}的节假日 | 名称 | [AdjustRuleForm.tsx:840](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L840) |
| `AdjustRuleForm.cba84031` | 写死 | 没有数据 | 文字 | [AdjustRuleForm.tsx:840](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L840) |
| `AdjustRuleForm.dc679aaa` | 写死 | {…}现在没有登记节假日，这一部分不会生效。 | 正文 | [AdjustRuleForm.tsx:848](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L848) |
| `AdjustRuleForm.132bacc3` | 写死 | 出行日期里没有平台登记的假日，这条规则不会生效。 | 文字 | [AdjustRuleForm.tsx:853](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L853) |
| `AdjustRuleForm.206c0c55` | 写死 | 今后 12 个月里 | 正文 | [AdjustRuleForm.tsx:856](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L856) |
| `AdjustRuleForm.3b57e94f` | 写死 | {…}有 {length} 个假日：{…}{…} | 正文 | [AdjustRuleForm.tsx:856](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L856) |
| `AdjustRuleForm.6576fc80` | 写死 | 出行日期里 | 正文 | [AdjustRuleForm.tsx:856](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L856) |
| `AdjustRuleForm.92f7e5db` | 写死 |  等 {length} 个 | 正文 | [AdjustRuleForm.tsx:859](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L859) |
| `AdjustRuleForm.a9cda8d9` | 写死 | 节假日以平台登记的为准；平台之后补登或改动，这条规则会跟着变。 | 正文 | [AdjustRuleForm.tsx:862](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L862) |
| `AdjustRuleForm.e9c65a93` | 写死 | 指定时段 | 名称 | [AdjustRuleForm.tsx:875](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L875) |
| `AdjustRuleForm.6143f3ab` | 写死 | 时段从 | 名称 | [AdjustRuleForm.tsx:881](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L881) |
| `AdjustRuleForm.530585da` | 写死 | 时段到 | 名称 | [AdjustRuleForm.tsx:885](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L885) |
| `AdjustRuleForm.4c7cb5d2` | 写死 | 从开始的时间起算，到结束的时间之前为止：填 22:00 到 06:00，06:00 整用车的不算在内。（第 ② 步的服务时间是两头都算。）跨午夜的算在开始的那一天头上。 | 正文 | [AdjustRuleForm.tsx:892](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L892) |
| `AdjustRuleForm.d4aa8047` | 写死 | 对哪些 | 标题 | [AdjustRuleForm.tsx:902](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L902) |
| `AdjustRuleForm.6e2e1568` | 写死 | 不选就是全部。以后这个商品新加的区域、车型组也算在「全部」里。 | 正文 | [AdjustRuleForm.tsx:903](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L903) |
| `AdjustRuleForm.16cfc12c` | 写死 | 指定区域 | 名称 | [AdjustRuleForm.tsx:907](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L907)、910 行 |
| `AdjustRuleForm.71328940` | 写死 | 已不在这个商品里 | 文字 | [AdjustRuleForm.tsx:910](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L910)、921 行 |
| `AdjustRuleForm.fd292799` | 写死 | 有 {length} 个已经不在这个商品里，保存时会一起去掉。 | 文字 | [AdjustRuleForm.tsx:912](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L912)、923 行 |
| `AdjustRuleForm.e7e339d7` | 写死 | 指定车型组 | 名称 | [AdjustRuleForm.tsx:918](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L918)、921 行 |
| `AdjustRuleForm.6dacda34` | 写死 | 接站和送站 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.994003d0` | 写死 | 接机和送机 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.b2cbc66e` | 写死 | 只接机 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.de2c803f` | 写死 | 只接站 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.e4505987` | 写死 | 只送站 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.e81dbb75` | 写死 | 只送机 | 名称 | [AdjustRuleForm.tsx:930](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L930) |
| `AdjustRuleForm.295e06f7` | 写死 | 看的是客人这一单是接还是送，和价格规则里用的是「接送通用」还是单独的那一条无关。 | 正文 | [AdjustRuleForm.tsx:931](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L931) |
| `AdjustRuleForm.851c7beb` | 写死 | 指定套餐 | 名称 | [AdjustRuleForm.tsx:937](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L937)、940 行 |
| `AdjustRuleForm.9927879b` | 写死 | 第 {…} 步 | 正文 | [AdjustRuleForm.tsx:959](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L959) |
| `AdjustRuleForm.fb88e79f` | 写死 | 第 {…} 步的方向 | 读屏说明 | [AdjustRuleForm.tsx:960](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L960) |
| `AdjustRuleForm.c23b204d` | 写死 | 第 {…} 步的方式 | 读屏说明 | [AdjustRuleForm.tsx:964](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L964) |
| `AdjustRuleForm.8bfa73ce` | 写死 | 按比例 | 选项 | [AdjustRuleForm.tsx:965](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L965) |
| `AdjustRuleForm.8465e46b` | 写死 | 按金额 | 选项 | [AdjustRuleForm.tsx:966](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L966) |
| `AdjustRuleForm.a98a965b` | 写死 | 第 {…} 步的数值 | 名称 | [AdjustRuleForm.tsx:969](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L969) |
| `AdjustRuleForm.41c22666` | 写死 | 第 {…} 步上移 | 名称 | [AdjustRuleForm.tsx:973](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L973) |
| `AdjustRuleForm.0fa2005f` | 写死 | 第 {…} 步下移 | 名称 | [AdjustRuleForm.tsx:974](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L974) |
| `AdjustRuleForm.24d475a9` | 写死 | 至少保留一步 | 名称 | [AdjustRuleForm.tsx:975](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L975) |
| `AdjustRuleForm.aa4969b1` | 写死 | 删除第 {…} 步 | 名称 | [AdjustRuleForm.tsx:975](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L975) |
| `AdjustRuleForm.472e4822` | 写死 | 加一步 | 按钮 | [AdjustRuleForm.tsx:987](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L987) |
| `AdjustRuleForm.9efcd9cd` | 写死 | 最多 {maxAdjustSteps} 步 | 正文 | [AdjustRuleForm.tsx:988](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L988) |
| `AdjustRuleForm.a14807c8` | 写死 | 几步从上到下依次算：后一步在前一步算完的结果上接着算。 | 正文 | [AdjustRuleForm.tsx:990](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L990) |
| `AdjustRuleForm.17e25fb1` | 写死 | 有未保存的修改 | 正文 | [AdjustRuleForm.tsx:996](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L996) |
| `AdjustRuleForm.3a5a4472` | 写死 | 已上架，保存后约 1 分钟生效 | 正文 | [AdjustRuleForm.tsx:996](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L996) |
| `AdjustRuleForm.5d378cdb` | 写死 | 请先载入最新内容 | 正文 | [AdjustRuleForm.tsx:996](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L996) |
| `AdjustRuleForm.c26a8080` | 写死 | 这条规则已经不存在 | 正文 | [AdjustRuleForm.tsx:996](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L996) |
| `AdjustRuleForm.34c07a3e` | 写死 | 取消 | 按钮 | [AdjustRuleForm.tsx:999](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L999) |
| `AdjustRuleForm.154d2f9f` | 写死 | 保存中… | 文字 | [AdjustRuleForm.tsx:1000](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1000)、1015 行 |
| `AdjustRuleForm.8bfd7017` | 写死 | 这条规则调得很多，确认保存？ | 标题 | [AdjustRuleForm.tsx:1007](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1007) |
| `AdjustRuleForm.65affb96` | 写死 | 回去检查 | 按钮 | [AdjustRuleForm.tsx:1014](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1014) |
| `AdjustRuleForm.e6ec0241` | 写死 | 确认保存 | 按钮 | [AdjustRuleForm.tsx:1017](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1017) |
| `AdjustRuleForm.46fcdf11` | 写死 | 按{label}算，{from} 会变成  | 正文 | [AdjustRuleForm.tsx:1023](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1023) |
| `AdjustRuleForm.977e9a20` | 写死 | {…}。如果是多敲了一个 0，请回去改。 | 正文 | [AdjustRuleForm.tsx:1025](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1025) |
| `AdjustRuleForm.a49897e5` | 写死 | 这条调价规则有未保存的修改 | 标题 | [AdjustRuleForm.tsx:1031](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1031) |
| `AdjustRuleForm.45470ee6` | 写死 | 继续编辑 | 按钮 | [AdjustRuleForm.tsx:1044](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1044) |
| `AdjustRuleForm.c3d6e3a1` | 写死 | 不保存，离开 | 按钮 | [AdjustRuleForm.tsx:1058](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1058) |
| `AdjustRuleForm.a64888b1` | 写死 | 离开后，这里填的内容不会保留。 | 正文 | [AdjustRuleForm.tsx:1062](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx#L1062) |

## 多个页面共用：「调价规则」页签的列表（AdjustRulesTab.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/AdjustRulesTab.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AdjustRulesTab.611ed1cb` | 写死 | 按适用范围内的价格算，调完超过了结算价的上限。请检查是不是多打了几个零。 | 文字 | [AdjustRulesTab.tsx:55](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L55) |
| `AdjustRulesTab.9b96b45f` | 写死 | 已不在这个商品里的区域 | 名称 | [AdjustRulesTab.tsx:105](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L105) |
| `AdjustRulesTab.e0149f5e` | 写死 | 已不在这个商品里的车型组 | 名称 | [AdjustRulesTab.tsx:109](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L109) |
| `AdjustRulesTab.57f32ca2` | 写死 | 没有启用。 | 标题 | [AdjustRulesTab.tsx:136](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L136) |
| `AdjustRulesTab.29e2cd53` | 写死 | 按现在的价格算，这条规则有 {count} 条价格调完不大于 0。请先改这条规则。 | 文字 | [AdjustRulesTab.tsx:137](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L137) |
| `AdjustRulesTab.5bfa7887` | 写死 | 按现在的价格算，这条规则有价格调完不大于 0。请先改这条规则。 | 文字 | [AdjustRulesTab.tsx:137](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L137) |
| `AdjustRulesTab.3693519f` | 写死 | 去修改 | 链接 | [AdjustRulesTab.tsx:141](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L141) |
| `AdjustRulesTab.3cc7cd38` | 写死 | 已经载入最新的内容，请再试一次。 | 文字 | [AdjustRulesTab.tsx:149](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L149) |
| `AdjustRulesTab.9c982859` | 写死 | 这个商品刚被别人修改过，{what}。 | 标题 | [AdjustRulesTab.tsx:149](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L149) |
| `AdjustRulesTab.3acd3605` | 写死 | 同时有其他人在修改相关的数据，{what}。请再试一次。 | 文字 | [AdjustRulesTab.tsx:151](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L151) |
| `AdjustRulesTab.ca974ca6` | 写死 | 这个商品已上架，改成这样就不满足上架的条件了。 | 文字 | [AdjustRulesTab.tsx:152](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L152) |
| `AdjustRulesTab.8ce9d637` | 写死 | 找不到这条调价规则，它可能已被别人删除。 | 标题 | [AdjustRulesTab.tsx:156](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L156) |
| `AdjustRulesTab.d6f174ef` | 写死 | 已经载入最新的列表。 | 文字 | [AdjustRulesTab.tsx:156](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L156) |
| `AdjustRulesTab.562b98d2` | 写死 | 已启用「{name}」 | 提示 | [AdjustRulesTab.tsx:169](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L169) |
| `AdjustRulesTab.8aef20d4` | 写死 | 已停用「{name}」 | 提示 | [AdjustRulesTab.tsx:169](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L169) |
| `AdjustRulesTab.e94e2a05` | 写死 | 没有启用 | 错误提示 | [AdjustRulesTab.tsx:173](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L173) |
| `AdjustRulesTab.fc0870f7` | 写死 | 没有停用 | 错误提示 | [AdjustRulesTab.tsx:173](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L173) |
| `AdjustRulesTab.aff482cb` | 写死 | {packageHours} 小时 | 文字 | [AdjustRulesTab.tsx:189](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L189) |
| `AdjustRulesTab.9d554b92` | 写死 | 整个商品 | 名称 | [AdjustRulesTab.tsx:193](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L193) |
| `AdjustRulesTab.08f69064` | 写死 | {…}了约 {…} | 文字 | [AdjustRulesTab.tsx:196](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L196) |
| `AdjustRulesTab.c462d102` | 写死 | 下调 | 文字 | [AdjustRulesTab.tsx:196](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L196) |
| `AdjustRulesTab.dbba5fea` | 写死 | 上调 | 文字 | [AdjustRulesTab.tsx:196](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L196) |
| `AdjustRulesTab.ef1bc568` | 写死 | 已删除调价规则「{name}」 | 提示 | [AdjustRulesTab.tsx:215](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L215) |
| `AdjustRulesTab.61bced1d` | 写死 | 没有删除 | 错误提示 | [AdjustRulesTab.tsx:220](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L220) |
| `AdjustRulesTab.08332f0b` | 写死 | {name} 现在排第 {…}，共 {length} 条 | 提示 | [AdjustRulesTab.tsx:233](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L233) |
| `AdjustRulesTab.875e59fd` | 写死 | 已保存顺序 | 提示 | [AdjustRulesTab.tsx:254](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L254) |
| `AdjustRulesTab.4c75858a` | 写死 | 调价规则刚被别人改过，顺序没有保存。 | 标题 | [AdjustRulesTab.tsx:264](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L264) |
| `AdjustRulesTab.9d8f3199` | 写死 | 已经载入最新的列表，请重新排一下。 | 文字 | [AdjustRulesTab.tsx:264](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L264) |
| `AdjustRulesTab.f46b0498` | 写死 | 顺序没有保存 | 错误提示 | [AdjustRulesTab.tsx:265](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L265) |
| `AdjustRulesTab.095bfe3a` | 写死 | 调价规则不是必须的。命中的日子会在基础价上再调一次。 | 正文 | [AdjustRulesTab.tsx:280](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L280) |
| `AdjustRulesTab.1edba09e` | 写死 | 调价规则可以不设。设了以后，命中的日子会在基础价上再调一次。 | 正文 | [AdjustRulesTab.tsx:280](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L280) |
| `AdjustRulesTab.86a9f3f2` | 写死 | 同一天命中好几条时，从上到下依次算：后一条在前一条算完的结果上接着算。 | 正文 | [AdjustRulesTab.tsx:282](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L282) |
| `AdjustRulesTab.82884757` | 写死 | 新建调价规则 | 按钮 | [AdjustRulesTab.tsx:288](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L288)、417 行 |
| `AdjustRulesTab.a3a10a7e` | 写死 | {hours} 小时 | 文字 | [AdjustRulesTab.tsx:310](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L310) |
| `AdjustRulesTab.f2191f36` | 写死 | 全部套餐 | 文字 | [AdjustRulesTab.tsx:310](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L310) |
| `AdjustRulesTab.a37ff14b` | 写死 | 顺序 | 名称 | [AdjustRulesTab.tsx:313](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L313)、437 行 |
| `AdjustRulesTab.27c3596c` | 写死 | 上移 {name} | 名称 | [AdjustRulesTab.tsx:321](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L321) |
| `AdjustRulesTab.43b45926` | 写死 | 下移 {name} | 名称 | [AdjustRulesTab.tsx:322](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L322) |
| `AdjustRulesTab.88911a95` | 写死 | 已结束 | 名称 | [AdjustRulesTab.tsx:332](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L332)、459 行 |
| `AdjustRulesTab.2dd0c52d` | 写死 | 什么时候 | 名称 | [AdjustRulesTab.tsx:340](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L340)、439 行 |
| `AdjustRulesTab.b0ab495a` | 写死 | 对哪些 | 名称 | [AdjustRulesTab.tsx:344](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L344)、440 行 |
| `AdjustRulesTab.4e985275` | 写死 | 全部车型组 | 正文 | [AdjustRulesTab.tsx:345](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L345) |
| `AdjustRulesTab.b332bf5c` | 写死 | 全部区域 | 正文 | [AdjustRulesTab.tsx:345](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L345) |
| `AdjustRulesTab.4afa65c0` | 写死 | 怎么调 | 名称 | [AdjustRulesTab.tsx:348](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L348)、441 行 |
| `AdjustRulesTab.5b7bf2dd` | 写死 | 启用 | 名称 | [AdjustRulesTab.tsx:355](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L355)、442、494、509、517 行 |
| `AdjustRulesTab.0f72a9ce` | 写死 | 已停用 | 正文 | [AdjustRulesTab.tsx:357](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L357)、362 行 |
| `AdjustRulesTab.3ba432af` | 写死 | 已启用 | 正文 | [AdjustRulesTab.tsx:357](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L357)、362 行 |
| `AdjustRulesTab.58fd06a5` | 写死 | 启用 {name} | 读屏说明 | [AdjustRulesTab.tsx:360](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L360) |
| `AdjustRulesTab.508b0499` | 写死 | 查看 | 读屏说明 | [AdjustRulesTab.tsx:367](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L367)、368 行 |
| `AdjustRulesTab.d443a3d9` | 写死 | 编辑 | 读屏说明 | [AdjustRulesTab.tsx:367](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L367)、368 行 |
| `AdjustRulesTab.ed220c7c` | 写死 | {name} 的更多操作 | 名称 | [AdjustRulesTab.tsx:371](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L371) |
| `AdjustRulesTab.2f54404b` | 写死 | 在价格日历里看 | 正文 | [AdjustRulesTab.tsx:373](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L373) |
| `AdjustRulesTab.42eb0aa2` | 写死 | 复制一条 | 正文 | [AdjustRulesTab.tsx:376](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L376) |
| `AdjustRulesTab.878c65ff` | 写死 | 删除 | 正文 | [AdjustRulesTab.tsx:379](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L379)、506 行 |
| `AdjustRulesTab.17dd1d87` | 写死 | 这个商品还没有价格。调价规则是在基础价上调的，先到「价格规则」页签把价格填上。 | 提示 | [AdjustRulesTab.tsx:404](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L404) |
| `AdjustRulesTab.ebe161a4` | 写死 | 顺序改了，还没有保存。 | 提示 | [AdjustRulesTab.tsx:405](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L405) |
| `AdjustRulesTab.f50c9624` | 写死 | 还没有调价规则 | 标题 | [AdjustRulesTab.tsx:410](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L410) |
| `AdjustRulesTab.137ab3b3` | 写死 | 这个商品没有调价规则，每天都按价格规则里的基础价报价。 | 说明 | [AdjustRulesTab.tsx:411](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L411) |
| `AdjustRulesTab.f6d339d9` | 写死 | 调价规则可以不设：不设的话，每天都按价格规则里的基础价报价。节假日、旺季、周末、夜里想调高或调低时再来建。 | 说明 | [AdjustRulesTab.tsx:411](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L411) |
| `AdjustRulesTab.015a57a2` | 写死 | 去价格日历上选日期 | 按钮 | [AdjustRulesTab.tsx:421](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L421) |
| `AdjustRulesTab.8eeefe14` | 写死 | 调价规则 | 读屏说明 | [AdjustRulesTab.tsx:429](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L429) |
| `AdjustRulesTab.c0e68da5` | 写死 | 现在没有生效或将要生效的调价规则。 | 正文 | [AdjustRulesTab.tsx:431](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L431)、449 行 |
| `AdjustRulesTab.6ccc20d4` | 写死 | 调价规则列表 | 读屏说明 | [AdjustRulesTab.tsx:433](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L433) |
| `AdjustRulesTab.9b80b448` | 写死 | 规则 | 表头 | [AdjustRulesTab.tsx:438](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L438) |
| `AdjustRulesTab.ad89c973` | 写死 | 操作 | 表头 | [AdjustRulesTab.tsx:443](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L443) |
| `AdjustRulesTab.ff823af9` | 写死 | 显示已结束的（{length} 条） | 正文 | [AdjustRulesTab.tsx:470](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L470) |
| `AdjustRulesTab.70cdd853` | 写死 | 已上架，启用、停用和删除约 1 分钟生效 | 正文 | [AdjustRulesTab.tsx:476](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L476) |
| `AdjustRulesTab.f778d784` | 写死 | 顺序有未保存的修改 | 正文 | [AdjustRulesTab.tsx:476](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L476) |
| `AdjustRulesTab.f1a39868` | 写死 | 还原顺序 | 按钮 | [AdjustRulesTab.tsx:481](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L481) |
| `AdjustRulesTab.4fea9af7` | 写死 | 保存中… | 文字 | [AdjustRulesTab.tsx:482](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L482)、508、561 行 |
| `AdjustRulesTab.27557ade` | 写死 | 保存顺序 | 按钮 | [AdjustRulesTab.tsx:484](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L484) |
| `AdjustRulesTab.12d9bbe4` | 写死 | 下一步 | 按钮 | [AdjustRulesTab.tsx:489](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L489) |
| `AdjustRulesTab.07222c47` | 写死 | 停用 | 标题 | [AdjustRulesTab.tsx:494](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L494)、509、517 行 |
| `AdjustRulesTab.c6911ed7` | 写死 | 这条规则调得很多，确认保存？ | 标题 | [AdjustRulesTab.tsx:494](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L494) |
| `AdjustRulesTab.ea4cd835` | 写死 | 删除调价规则「{name}」？ | 标题 | [AdjustRulesTab.tsx:494](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L494) |
| `AdjustRulesTab.057fe0cb` | 写死 | 回去检查 | 按钮 | [AdjustRulesTab.tsx:501](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L501) |
| `AdjustRulesTab.64edc526` | 写死 | 取消 | 按钮 | [AdjustRulesTab.tsx:501](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L501) |
| `AdjustRulesTab.7c8df60a` | 写死 | 删除中… | 文字 | [AdjustRulesTab.tsx:504](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L504) |
| `AdjustRulesTab.31e36fc0` | 写死 | 停用中… | 文字 | [AdjustRulesTab.tsx:508](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L508) |
| `AdjustRulesTab.b5101f67` | 写死 | 启用中… | 文字 | [AdjustRulesTab.tsx:508](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L508) |
| `AdjustRulesTab.ff9f1f2e` | 写死 | 确认保存 | 按钮 | [AdjustRulesTab.tsx:509](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L509) |
| `AdjustRulesTab.33f6bca6` | 写死 | 这个商品已上架，删除后大约 1 分钟生效。 | 正文 | [AdjustRulesTab.tsx:516](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L516) |
| `AdjustRulesTab.ca38fa98` | 写死 | 删除后不能恢复。{…}只是暂时不用的话，可以停用。 | 正文 | [AdjustRulesTab.tsx:516](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L516) |
| `AdjustRulesTab.54f9eac3` | 写死 | 按这条规则调价 | 正文 | [AdjustRulesTab.tsx:517](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L517) |
| `AdjustRulesTab.726275d7` | 写死 | 不再按这条规则调价 | 正文 | [AdjustRulesTab.tsx:517](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L517) |
| `AdjustRulesTab.f3339d39` | 写死 | 这个商品已上架，{…}后大约 1 分钟生效，之后的报价就会{…}。已经下的订单不受影响。 | 正文 | [AdjustRulesTab.tsx:517](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L517) |
| `AdjustRulesTab.ac4dcd51` | 写死 | 按「{label}」的价格算，{from} 会变成  | 正文 | [AdjustRulesTab.tsx:520](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L520) |
| `AdjustRulesTab.d311fce4` | 写死 | {…}。如果是多敲了一个 0，请回去改。 | 正文 | [AdjustRulesTab.tsx:522](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L522) |
| `AdjustRulesTab.c970c880` | 写死 | 顺序改了，还没有保存 | 标题 | [AdjustRulesTab.tsx:528](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L528) |
| `AdjustRulesTab.06a59451` | 写死 | 继续编辑 | 按钮 | [AdjustRulesTab.tsx:542](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L542) |
| `AdjustRulesTab.4a47ec84` | 写死 | 不保存 | 按钮 | [AdjustRulesTab.tsx:557](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L557) |
| `AdjustRulesTab.6b192fb4` | 写死 | 保存并继续 | 按钮 | [AdjustRulesTab.tsx:571](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L571) |
| `AdjustRulesTab.0ccd0d17` | 写死 | 要先保存吗？ | 正文 | [AdjustRulesTab.tsx:575](../../apps/web/src/pages/products/prices/AdjustRulesTab.tsx#L575) |

## 多个页面共用：包车「区域加价」块（AreaSurchargeBlock.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `AreaSurchargeBlock.151e120a` | 写死 | 这个地址暂时没有在线报价，请联系客服 | 文字 | [AreaSurchargeBlock.tsx:53](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L53) |
| `AreaSurchargeBlock.e75d3b99` | 写死 | 新增的区域默认是「报价区域」：还要落在你的某个运营区域里才会报价。那里还没有运营区域时，在区域页面把用途选成「运营 + 报价」。 | 说明 | [AreaSurchargeBlock.tsx:55](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L55) |
| `AreaSurchargeBlock.506de4af` | 写死 | （区域） | 文字 | [AreaSurchargeBlock.tsx:220](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L220) |
| `AreaSurchargeBlock.c0db4e34` | 写死 | （已删除的区域） | 文字 | [AreaSurchargeBlock.tsx:220](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L220) |
| `AreaSurchargeBlock.2aaa6aad` | 写死 | 已移除的车型组 | 名称 | [AreaSurchargeBlock.tsx:226](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L226) |
| `AreaSurchargeBlock.64ec5d0b` | 写死 | 区域加价 · {…} · {…} · {packageHours} 小时 | 名称 | [AreaSurchargeBlock.tsx:227](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L227) |
| `AreaSurchargeBlock.4d29b6b5` | 写死 | 已删除，选了会恢复原来的加价 | 说明 | [AreaSurchargeBlock.tsx:264](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L264) |
| `AreaSurchargeBlock.c5130dd9` | 写死 | 已添加 | 说明 | [AreaSurchargeBlock.tsx:264](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L264) |
| `AreaSurchargeBlock.eaadfda0` | 写死 | 商品的服务区域，不加价 | 说明 | [AreaSurchargeBlock.tsx:264](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L264)、731 行 |
| `AreaSurchargeBlock.98671862` | 写死 | 「{…}」将恢复，还没有保存 | 提示 | [AreaSurchargeBlock.tsx:281](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L281) |
| `AreaSurchargeBlock.ace786ad` | 写死 | 请先选一个区域 | 错误提示 | [AreaSurchargeBlock.tsx:298](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L298) |
| `AreaSurchargeBlock.0457bad7` | 写死 | 请填开始日期 | 文字 | [AreaSurchargeBlock.tsx:327](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L327) |
| `AreaSurchargeBlock.0049c1d4` | 写死 | 这不是一个日期，请按 2026-10-08 的格式填写 | 文字 | [AreaSurchargeBlock.tsx:328](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L328)、330 行 |
| `AreaSurchargeBlock.d4c812fc` | 写死 | 结束日期不能早于开始日期 | 文字 | [AreaSurchargeBlock.tsx:331](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L331) |
| `AreaSurchargeBlock.bce85319` | 写死 | 至少选一个车型组 | 文字 | [AreaSurchargeBlock.tsx:332](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L332) |
| `AreaSurchargeBlock.199934b5` | 写死 | 至少选一个套餐 | 文字 | [AreaSurchargeBlock.tsx:333](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L333) |
| `AreaSurchargeBlock.3e278c1f` | 写死 | 已添加「{…}」，填了 {count} 个组合，还没有保存 | 提示 | [AreaSurchargeBlock.tsx:355](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L355) |
| `AreaSurchargeBlock.db18106a` | 写死 | 已给「{…}」填了 {count} 个组合，还没有保存 | 提示 | [AreaSurchargeBlock.tsx:355](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L355) |
| `AreaSurchargeBlock.1d87d366` | 写死 | 已去掉「{…}」 | 提示 | [AreaSurchargeBlock.tsx:363](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L363) |
| `AreaSurchargeBlock.c22898c8` | 写死 | 没设 | 正文 | [AreaSurchargeBlock.tsx:393](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L393)、456、465、840、919 行 |
| `AreaSurchargeBlock.5ebe7fae` | 写死 | 各组合不同 | 正文 | [AreaSurchargeBlock.tsx:394](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L394)、893 行 |
| `AreaSurchargeBlock.485dd5fc` | 写死 | {waypointUnset} 个组合没设 | 正文 | [AreaSurchargeBlock.tsx:395](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L395) |
| `AreaSurchargeBlock.1466f2d2` | 写死 | {missing} 个组合没填 | 正文 | [AreaSurchargeBlock.tsx:407](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L407) |
| `AreaSurchargeBlock.6b3c8a65` | 写死 | 未保存 | 正文 | [AreaSurchargeBlock.tsx:410](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L410) |
| `AreaSurchargeBlock.bda28a1b` | 写死 | 点开一个区域、点明细里的任何一行，这里会用一句话说明这一行的区域加价。 | 文字 | [AreaSurchargeBlock.tsx:417](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L417) |
| `AreaSurchargeBlock.0aa2c185` | 写死 | {name} · {…} · {packageHours} 小时 | 名称 | [AreaSurchargeBlock.tsx:419](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L419) |
| `AreaSurchargeBlock.187e9d20` | 写死 | {label}——还没填区域加价。上车点或下车点只在{name}、坐{…}、订 {packageHours} 小时的单不报价。 | 文字 | [AreaSurchargeBlock.tsx:421](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L421) |
| `AreaSurchargeBlock.c4620211` | 写死 | 这个车型组和套餐还没有套餐价。 | 文字 | [AreaSurchargeBlock.tsx:432](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L432) |
| `AreaSurchargeBlock.11923e10` | 写死 | 例：{text}上车、{name}下车 = 套餐价 {…} + 0 + {…} = {…}（调价规则前）。 | 文字 | [AreaSurchargeBlock.tsx:433](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L433) |
| `AreaSurchargeBlock.a677e90a` | 写死 | {text}出发、途经{name}再回来 = 套餐价 {…} + {…} = {…}。 | 文字 | [AreaSurchargeBlock.tsx:435](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L435) |
| `AreaSurchargeBlock.2da6359d` | 写死 | {label}——{…}{example}{wayExample}{…}调价规则（节假日、旺季等）会按合计再调。 | 文字 | [AreaSurchargeBlock.tsx:436](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L436) |
| `AreaSurchargeBlock.752613cb` | 写死 | {…}等 {length} 个 | 文字 | [AreaSurchargeBlock.tsx:440](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L440) |
| `AreaSurchargeBlock.d5dc501e` | 写死 | 区域加价 | 标题 | [AreaSurchargeBlock.tsx:448](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L448) |
| `AreaSurchargeBlock.2ff11651` | 写死 | 先在上面「基础定价」里加一个套餐，再设区域加价。（区域加价按「车型组 × 套餐」填） | 正文 | [AreaSurchargeBlock.tsx:449](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L449) |
| `AreaSurchargeBlock.265c8f09` | 写死 | 下车加价 | 读屏说明 | [AreaSurchargeBlock.tsx:464](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L464)、725、769、879 行 |
| `AreaSurchargeBlock.83de65b6` | 写死 | {label} 的{…} | 读屏说明 | [AreaSurchargeBlock.tsx:464](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L464) |
| `AreaSurchargeBlock.c60e0be8` | 写死 | 途经加价 | 读屏说明 | [AreaSurchargeBlock.tsx:464](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L464)、728、772、912 行 |
| `AreaSurchargeBlock.f28cf070` | 写死 | 上车加价 | 读屏说明 | [AreaSurchargeBlock.tsx:464](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L464)、722、766、879 行 |
| `AreaSurchargeBlock.7b3ece47` | 写死 | 一直有效 | 正文 | [AreaSurchargeBlock.tsx:485](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L485)、495、941 行 |
| `AreaSurchargeBlock.1bef9bd9` | 写死 | 从 | 读屏说明 | [AreaSurchargeBlock.tsx:493](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L493)、936 行 |
| `AreaSurchargeBlock.5e42a869` | 写死 | {label} 的生效日期{…} | 读屏说明 | [AreaSurchargeBlock.tsx:493](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L493) |
| `AreaSurchargeBlock.a7dfa8c1` | 写死 | 到 | 读屏说明 | [AreaSurchargeBlock.tsx:493](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L493)、521、940 行 |
| `AreaSurchargeBlock.54920910` | 写死 | 年-月-日 | 输入框占位 | [AreaSurchargeBlock.tsx:495](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L495)、937 行 |
| `AreaSurchargeBlock.c562e5fa` | 写死 | 「{…}」的各车型组和套餐 | 读屏说明 | [AreaSurchargeBlock.tsx:510](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L510) |
| `AreaSurchargeBlock.8ce57ea5` | 写死 | 「{…}」的区域加价，每个车型组和套餐一行，没填的空着等填 | 正文 | [AreaSurchargeBlock.tsx:512](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L512) |
| `AreaSurchargeBlock.ceaff2f4` | 写死 | 车型组 | 表头 | [AreaSurchargeBlock.tsx:515](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L515)、679 行 |
| `AreaSurchargeBlock.93ef68ef` | 写死 | 套餐 | 表头 | [AreaSurchargeBlock.tsx:516](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L516)、690 行 |
| `AreaSurchargeBlock.e33ad6af` | 写死 | 上车加价（{currency}） | 表头 | [AreaSurchargeBlock.tsx:517](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L517)、710 行 |
| `AreaSurchargeBlock.ee0237b6` | 写死 | 下车加价（{currency}） | 表头 | [AreaSurchargeBlock.tsx:518](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L518)、711 行 |
| `AreaSurchargeBlock.01761bfb` | 写死 | 途经加价（{currency}） | 表头 | [AreaSurchargeBlock.tsx:519](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L519)、712 行 |
| `AreaSurchargeBlock.e7a3eb20` | 写死 | 生效日期 从 | 表头 | [AreaSurchargeBlock.tsx:520](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L520) |
| `AreaSurchargeBlock.924efbfd` | 写死 | 启用 | 表头 | [AreaSurchargeBlock.tsx:522](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L522)、555 行 |
| `AreaSurchargeBlock.83bafa37` | 写死 | 状态 | 表头 | [AreaSurchargeBlock.tsx:523](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L523) |
| `AreaSurchargeBlock.e9385e7f` | 写死 | 操作 | 正文 | [AreaSurchargeBlock.tsx:526](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L526)、713 行 |
| `AreaSurchargeBlock.ccb36a19` | 写死 | 别人也改过这一条，请核对 | 文字 | [AreaSurchargeBlock.tsx:536](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L536) |
| `AreaSurchargeBlock.47edd0c4` | 写死 | {packageHours} 小时 | 正文 | [AreaSurchargeBlock.tsx:549](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L549) |
| `AreaSurchargeBlock.0028524d` | 写死 | 启用这条区域加价：{label} | 读屏说明 | [AreaSurchargeBlock.tsx:555](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L555) |
| `AreaSurchargeBlock.09c3163f` | 写死 | 已停用 | 正文 | [AreaSurchargeBlock.tsx:555](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L555) |
| `AreaSurchargeBlock.46f45315` | 写死 | 删除 | 读屏说明 | [AreaSurchargeBlock.tsx:565](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L565)、566、792、1004 行 |
| `AreaSurchargeBlock.dc0155e9` | 写死 | {…}这一条：{label} | 读屏说明 | [AreaSurchargeBlock.tsx:565](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L565) |
| `AreaSurchargeBlock.efecac27` | 写死 | 撤销删除 | 读屏说明 | [AreaSurchargeBlock.tsx:565](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L565)、566 行 |
| `AreaSurchargeBlock.046a4854` | 写死 | 清空这一行：{label} | 读屏说明 | [AreaSurchargeBlock.tsx:569](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L569) |
| `AreaSurchargeBlock.85d24ea0` | 写死 | 清空 | 按钮 | [AreaSurchargeBlock.tsx:571](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L571) |
| `AreaSurchargeBlock.6c936e0c` | 写死 | 区域加价 {…} | 标题 | [AreaSurchargeBlock.tsx:593](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L593) |
| `AreaSurchargeBlock.f9030304` | 写死 | {missingTotal} 个组合没填 | 正文 | [AreaSurchargeBlock.tsx:596](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L596) |
| `AreaSurchargeBlock.647b28cc` | 写死 | 上车点、下车点或客人填的途经景点不在商品的服务区域里时，按所在区域加钱：包车价 = 套餐价 + 上车加价 + 途经加价 + 下车加价。 | 正文 | [AreaSurchargeBlock.tsx:601](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L601) |
| `AreaSurchargeBlock.d78397b3` | 写死 | 途经加价同一区域一单只加一次，上车或下车已经在这个区域的不再加；途经加价空着 = 途经景点落在这个区域时不报价（不加钱请填 0）。 | 正文 | [AreaSurchargeBlock.tsx:603](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L603) |
| `AreaSurchargeBlock.4c324f56` | 写死 | 上车点或下车点哪个区域都不在的单不报价，客人会看到「{NO\_ONLINE\_QUOTE}」。 | 正文 | [AreaSurchargeBlock.tsx:605](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L605) |
| `AreaSurchargeBlock.82d08677` | 写死 | 有 {size} 条区域加价别人也改过同一项。 | 正文 | [AreaSurchargeBlock.tsx:610](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L610) |
| `AreaSurchargeBlock.444bea10` | 写死 | 已经载入最新内容：你没动过的格子换成了别人改的；你和别人都改了的格子现在是你的修改（行上标着「别人也改过这一条，请核对」）。请核对后再保存。 | 正文 | [AreaSurchargeBlock.tsx:611](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L611) |
| `AreaSurchargeBlock.82ce1022` | 写死 | 区域没有加载出来。 | 正文 | [AreaSurchargeBlock.tsx:619](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L619) |
| `AreaSurchargeBlock.f4fcd675` | 写死 | 重试 | 按钮 | [AreaSurchargeBlock.tsx:621](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L621) |
| `AreaSurchargeBlock.5393b832` | 写死 | 选择要加价的区域 | 表单标签 | [AreaSurchargeBlock.tsx:628](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L628) |
| `AreaSurchargeBlock.206bc7e3` | 写死 | 选择区域 | 选项 | [AreaSurchargeBlock.tsx:642](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L642) |
| `AreaSurchargeBlock.9bd86518` | 写死 | 加载中… | 选项 | [AreaSurchargeBlock.tsx:642](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L642) |
| `AreaSurchargeBlock.f91ff963` | 写死 | 确认添加 | 按钮 | [AreaSurchargeBlock.tsx:653](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L653) |
| `AreaSurchargeBlock.5e961e7e` | 写死 | 没有其他区域可选。先到区域页面画出要加价的区域（如富士山、千叶），再回来添加。 | 正文 | [AreaSurchargeBlock.tsx:660](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L660) |
| `AreaSurchargeBlock.cd7e19e6` | 写死 | 新增自定义区域 | 链接 | [AreaSurchargeBlock.tsx:666](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L666) |
| `AreaSurchargeBlock.b097a590` | 写死 | 全部 | 选项 | [AreaSurchargeBlock.tsx:681](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L681)、692 行 |
| `AreaSurchargeBlock.3f6a8793` | 写死 | {hours} 小时 | 选项 | [AreaSurchargeBlock.tsx:694](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L694)、959 行 |
| `AreaSurchargeBlock.45fc598a` | 写死 | {hours} 小时（基础定价里没有这个套餐） | 选项 | [AreaSurchargeBlock.tsx:694](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L694) |
| `AreaSurchargeBlock.19df5653` | 写死 | 全部收起 | 按钮 | [AreaSurchargeBlock.tsx:700](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L700) |
| `AreaSurchargeBlock.30a250b0` | 写死 | 全部展开 | 按钮 | [AreaSurchargeBlock.tsx:700](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L700) |
| `AreaSurchargeBlock.dcaa137d` | 写死 | 区域加价（{currency}，结算价）：商品的服务区域不加价，每个加价区域一行 | 正文 | [AreaSurchargeBlock.tsx:706](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L706) |
| `AreaSurchargeBlock.306d128e` | 写死 | 区域（上车点、下车点或途经景点所在） | 表头 | [AreaSurchargeBlock.tsx:709](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L709) |
| `AreaSurchargeBlock.7dae0e79` | 写死 | 区域 | 名称 | [AreaSurchargeBlock.tsx:719](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L719)、742 行 |
| `AreaSurchargeBlock.09ac5ff6` | 写死 | {…}「{name}」的各车型组和套餐 | 读屏说明 | [AreaSurchargeBlock.tsx:744](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L744) |
| `AreaSurchargeBlock.959c5d6b` | 写死 | 展开 | 读屏说明 | [AreaSurchargeBlock.tsx:744](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L744) |
| `AreaSurchargeBlock.d185f6b3` | 写死 | 收起 | 读屏说明 | [AreaSurchargeBlock.tsx:744](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L744) |
| `AreaSurchargeBlock.ae040ce0` | 写死 | 区域已停用 | 名称 | [AreaSurchargeBlock.tsx:752](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L752)、836 行 |
| `AreaSurchargeBlock.63ad2775` | 写死 | 区域停用后这里的区域加价不再用到 | 正文 | [AreaSurchargeBlock.tsx:753](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L753) |
| `AreaSurchargeBlock.01c79352` | 写死 | {…}：在区域页面补画运营区域，或把它的用途改成「运营 + 报价」 | 正文 | [AreaSurchargeBlock.tsx:759](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L759) |
| `AreaSurchargeBlock.6f0c0ff4` | 写死 | 将删除 | 正文 | [AreaSurchargeBlock.tsx:762](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L762) |
| `AreaSurchargeBlock.03a6259a` | 写死 | 将恢复 | 正文 | [AreaSurchargeBlock.tsx:763](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L763) |
| `AreaSurchargeBlock.59362e0f` | 写死 | 撤销删除「{name}」 | 读屏说明 | [AreaSurchargeBlock.tsx:777](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L777) |
| `AreaSurchargeBlock.930a70ee` | 写死 | 撤销 | 按钮 | [AreaSurchargeBlock.tsx:779](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L779)、785 行 |
| `AreaSurchargeBlock.e6b3b7b3` | 写死 | 撤销恢复「{name}」 | 读屏说明 | [AreaSurchargeBlock.tsx:783](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L783) |
| `AreaSurchargeBlock.f2e532db` | 写死 | 编辑「{name}」的区域加价 | 读屏说明 | [AreaSurchargeBlock.tsx:787](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L787) |
| `AreaSurchargeBlock.fc02ae5c` | 写死 | 编辑 | 按钮 | [AreaSurchargeBlock.tsx:789](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L789) |
| `AreaSurchargeBlock.4dec4e9c` | 写死 | 删除加价区域「{name}」 | 读屏说明 | [AreaSurchargeBlock.tsx:790](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L790) |
| `AreaSurchargeBlock.344fe4cf` | 写死 | 包车现在要看下车地点。 | 正文 | [AreaSurchargeBlock.tsx:809](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L809) |
| `AreaSurchargeBlock.7abd4c46` | 写死 | 上车点、下车点都要在商品的服务区域（{productAreaText}）或加价区域里，否则不报价。这个商品还没有加价区域，所以下车地点在服务区域以外的包车单现在都不报价。{…} | 正文 | [AreaSurchargeBlock.tsx:810](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L810) |
| `AreaSurchargeBlock.f2e1b913` | 写死 | 要接这样的单，在上面选一个区域添加区域加价。 | 正文 | [AreaSurchargeBlock.tsx:810](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L810) |
| `AreaSurchargeBlock.aee0b3c4` | 写死 | 这一行的意思： | 正文 | [AreaSurchargeBlock.tsx:816](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L816) |
| `AreaSurchargeBlock.37954831` | 写死 | 已删除的加价区域（{length}） | 正文 | [AreaSurchargeBlock.tsx:823](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L823) |
| `AreaSurchargeBlock.c26072f7` | 写死 | 恢复以后也用不到，要先到区域页面启用这个区域 | 正文 | [AreaSurchargeBlock.tsx:837](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L837) |
| `AreaSurchargeBlock.2a5e5306` | 写死 | 删除前：上车加价 {…} · 下车加价 {…} · 途经加价 {…}（{currency}） | 正文 | [AreaSurchargeBlock.tsx:840](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L840) |
| `AreaSurchargeBlock.a2809405` | 写死 | 恢复加价区域「{…}」 | 读屏说明 | [AreaSurchargeBlock.tsx:842](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L842) |
| `AreaSurchargeBlock.668524db` | 写死 | 恢复 | 按钮 | [AreaSurchargeBlock.tsx:844](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L844) |
| `AreaSurchargeBlock.34893dc2` | 写死 | 改「{draftName}」的区域加价 | 标题 | [AreaSurchargeBlock.tsx:856](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L856) |
| `AreaSurchargeBlock.80fae9ef` | 写死 | 给「{draftName}」设区域加价 | 标题 | [AreaSurchargeBlock.tsx:856](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L856) |
| `AreaSurchargeBlock.f528d088` | 写死 | 取消 | 按钮 | [AreaSurchargeBlock.tsx:863](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L863)、993 行 |
| `AreaSurchargeBlock.cc033bdf` | 写死 | 填进去 | 按钮 | [AreaSurchargeBlock.tsx:865](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L865) |
| `AreaSurchargeBlock.ed22d306` | 写死 | 添加 | 按钮 | [AreaSurchargeBlock.tsx:865](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L865) |
| `AreaSurchargeBlock.8d8e18f3` | 写死 | 一次给下面勾选的车型组和套餐填同一个区域加价。之后可以展开这个区域，一行一行改。 | 正文 | [AreaSurchargeBlock.tsx:872](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L872) |
| `AreaSurchargeBlock.5f89bb89` | 写死 | 上车点 | 文字 | [AreaSurchargeBlock.tsx:875](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L875) |
| `AreaSurchargeBlock.6c072502` | 写死 | 下车点 | 文字 | [AreaSurchargeBlock.tsx:875](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L875) |
| `AreaSurchargeBlock.0cba29de` | 写死 | 留空 = 不改这一项 | 正文 | [AreaSurchargeBlock.tsx:904](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L904) |
| `AreaSurchargeBlock.1a9d3d81` | 写死 | {end}在{draftName}时加多少，不加钱填 0 | 正文 | [AreaSurchargeBlock.tsx:904](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L904) |
| `AreaSurchargeBlock.3e5ac3c8` | 写死 | 客人的途经景点在{draftName}时加多少（同一区域一单只加一次）。选填：留空 = 途经景点落在这里时不报价，不加钱填 0 | 正文 | [AreaSurchargeBlock.tsx:930](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L930) |
| `AreaSurchargeBlock.babfde25` | 写死 | 客人的途经景点在{draftName}时加多少（同一区域一单只加一次）。留空 = 已经填了的组合不改这一项、新填的组合不设 | 正文 | [AreaSurchargeBlock.tsx:930](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L930) |
| `AreaSurchargeBlock.dcdc3805` | 写死 | 生效日期 | 表单标签 | [AreaSurchargeBlock.tsx:934](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L934) |
| `AreaSurchargeBlock.d149539b` | 写死 | 生效日期只用于这次新填的空组合；已经填了的组合保留原来的日期。 | 正文 | [AreaSurchargeBlock.tsx:945](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L945) |
| `AreaSurchargeBlock.de466331` | 写死 | 用在哪些车型组 | 标题 | [AreaSurchargeBlock.tsx:948](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L948) |
| `AreaSurchargeBlock.65f5db04` | 写死 | 用在哪些套餐 | 标题 | [AreaSurchargeBlock.tsx:956](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L956) |
| `AreaSurchargeBlock.e516c4f0` | 写死 | 已经填了的组合 | 表单标签 | [AreaSurchargeBlock.tsx:965](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L965) |
| `AreaSurchargeBlock.5e7d46ef` | 写死 | 改成这次填的 | 正文 | [AreaSurchargeBlock.tsx:968](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L968) |
| `AreaSurchargeBlock.dab47293` | 写死 | 跳过，只填空着的 | 正文 | [AreaSurchargeBlock.tsx:972](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L972) |
| `AreaSurchargeBlock.613cdb23` | 写死 | 有 {multiSegment} 个组合有不止一段日期，只改每个组合最后一段，其余的请展开后逐条改。 | 正文 | [AreaSurchargeBlock.tsx:974](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L974) |
| `AreaSurchargeBlock.2cfcd6be` | 写死 | 会填 {…} 个空着的组合，改 {…} 个已经填了的。 | 正文 | [AreaSurchargeBlock.tsx:978](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L978) |
| `AreaSurchargeBlock.710b7317` | 写死 | 会填 {…} 个组合。 | 正文 | [AreaSurchargeBlock.tsx:978](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L978) |
| `AreaSurchargeBlock.830c872a` | 写死 | 这次会展开成 {expandCount} 条，加上还没保存的 {pendingOther} 条超过了一次最多保存的 {maxBatchChanges} 条。请先保存，或少勾几个车型组和套餐。 | 正文 | [AreaSurchargeBlock.tsx:980](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L980) |
| `AreaSurchargeBlock.5b892ca8` | 写死 | 删除加价区域「{…}」？ | 标题 | [AreaSurchargeBlock.tsx:987](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L987) |
| `AreaSurchargeBlock.ba86c251` | 写死 | 「{…}」将删除，点保存后生效 | 提示 | [AreaSurchargeBlock.tsx:1000](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L1000) |
| `AreaSurchargeBlock.2316b56f` | 写死 | 这个区域的 {removeCount} 条区域加价会停用，记录保留，以后可以在「已删除的加价区域」里恢复。保存以后，上车点或下车点只在「{…}」里的包车单不再报价，客人会看到「{NO\_ONLINE\_QUOTE}」。 | 正文 | [AreaSurchargeBlock.tsx:1008](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L1008) |
| `AreaSurchargeBlock.9c30d7fe` | 写死 | 全部（{length} 个） | 正文 | [AreaSurchargeBlock.tsx:1027](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx#L1027) |

## 多个页面共用：「价格日历」页签（CalendarTab.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/CalendarTab.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `CalendarTab.4df5a265` | 写死 | {packageHours} 小时 | 文字 | [CalendarTab.tsx:91](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L91) |
| `CalendarTab.0a4b2b33` | 写死 | 还没有价格，日历上没有东西可看 | 标题 | [CalendarTab.tsx:221](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L221) |
| `CalendarTab.210bcbe5` | 写死 | 去填价格 | 按钮 | [CalendarTab.tsx:221](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L221)、295、535 行 |
| `CalendarTab.3845d771` | 写死 | 去看价格 | 按钮 | [CalendarTab.tsx:221](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L221)、295、535 行 |
| `CalendarTab.e46f516c` | 写死 | 先到「价格规则」页签把价格填上，这里就会显示每一天的结算价。 | 说明 | [CalendarTab.tsx:221](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L221) |
| `CalendarTab.9b7be2f6` | 写死 | 没有加载出来。 | 正文 | [CalendarTab.tsx:254](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L254) |
| `CalendarTab.cb00de1c` | 写死 | 加载中… | 正文 | [CalendarTab.tsx:254](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L254) |
| `CalendarTab.7d6982cd` | 写死 | {valid\_from} 至 {valid\_to} | 文字 | [CalendarTab.tsx:258](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L258)、320 行 |
| `CalendarTab.cd450cfa` | 写死 | {valid\_from} 起 | 文字 | [CalendarTab.tsx:258](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L258) |
| `CalendarTab.3daed201` | 写死 | 这一天算不出价 | 正文 | [CalendarTab.tsx:267](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L267)、273 行 |
| `CalendarTab.bf555f4d` | 写死 | 这一天没有价格 | 正文 | [CalendarTab.tsx:267](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L267)、273 行 |
| `CalendarTab.844773e1` | 写死 | {time} 用车 · {comboName} | 正文 | [CalendarTab.tsx:268](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L268)、274、306 行 |
| `CalendarTab.9448ecbd` | 写死 | 这一天已经过去了，不会再有客人订这一天，不用补价格。 | 正文 | [CalendarTab.tsx:269](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L269) |
| `CalendarTab.196941b2` | 写死 | 调价之后的结算价超过了上限，客人询价时报不出价。请检查价格或调价规则是不是多打了几个零。 | 正文 | [CalendarTab.tsx:276](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L276) |
| `CalendarTab.cda51fa9` | 写死 | 调价规则把这一天的价调到了不大于 0，客人询价时报不出价。请把下调改小。 | 正文 | [CalendarTab.tsx:278](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L278) |
| `CalendarTab.a9c96a13` | 写死 | 这一天的价格现在是停用的。 | 正文 | [CalendarTab.tsx:280](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L280) |
| `CalendarTab.0a8adbe5` | 写死 |  等 | 正文 | [CalendarTab.tsx:282](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L282) |
| `CalendarTab.2f2d96bf` | 写死 | ：现有的价格是 {…}{…} | 正文 | [CalendarTab.tsx:282](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L282) |
| `CalendarTab.fe84e814` | 写死 | 这个组合的价格在这一天不生效{…}。 | 正文 | [CalendarTab.tsx:282](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L282) |
| `CalendarTab.9e4248f1` | 写死 | 这个组合还没有价格，客人询价时报不出价。 | 正文 | [CalendarTab.tsx:284](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L284) |
| `CalendarTab.a5cf5dc8` | 写死 | 改这条规则 | 链接 | [CalendarTab.tsx:290](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L290)、335、336 行 |
| `CalendarTab.c9fc088e` | 写死 | 看这条规则 | 链接 | [CalendarTab.tsx:290](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L290)、335、336 行 |
| `CalendarTab.6c0dec5e` | 写死 | 去改生效日期 | 链接 | [CalendarTab.tsx:295](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L295) |
| `CalendarTab.78dd7cf1` | 写死 | 去启用 | 链接 | [CalendarTab.tsx:295](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L295) |
| `CalendarTab.a61b6de3` | 写死 | 结算价 | 正文 | [CalendarTab.tsx:303](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L303) |
| `CalendarTab.e4664512` | 写死 |  起 | 正文 | [CalendarTab.tsx:304](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L304)、387 行 |
| `CalendarTab.0b61bd4b` | 写死 | 基础价 | 正文 | [CalendarTab.tsx:309](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L309) |
| `CalendarTab.5277dd4e` | 写死 | 区域价（这条线路这个车型组没有线路价） | 正文 | [CalendarTab.tsx:314](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L314) |
| `CalendarTab.61ad97b0` | 写死 | 线路价 · {…} → {…} | 正文 | [CalendarTab.tsx:314](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L314) |
| `CalendarTab.fd472491` | 写死 | {valid\_from} 起一直有效 | 正文 | [CalendarTab.tsx:320](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L320) |
| `CalendarTab.12f75ee8` | 写死 | 看这条价格 | 链接 | [CalendarTab.tsx:324](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L324) |
| `CalendarTab.e43af6f9` | 写死 | 改这条价格 | 链接 | [CalendarTab.tsx:324](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L324) |
| `CalendarTab.7a382e01` | 写死 | （还没取整） | 正文 | [CalendarTab.tsx:346](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L346) |
| `CalendarTab.5e9d0abc` | 写死 | 取整到 {…} | 正文 | [CalendarTab.tsx:353](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L353) |
| `CalendarTab.68ab1bb7` | 写死 | 四舍五入 | 正文 | [CalendarTab.tsx:353](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L353) |
| `CalendarTab.7bc922ab` | 写死 | 这一天不同时段的价 | 标题 | [CalendarTab.tsx:361](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L361) |
| `CalendarTab.0d8ddec2` | 写死 | 现在看的 | 正文 | [CalendarTab.tsx:365](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L365) |
| `CalendarTab.dd802a48` | 写死 | 没有价格 | 正文 | [CalendarTab.tsx:367](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L367)、436、440 行 |
| `CalendarTab.c5933e50` | 写死 | 命中{…} | 正文 | [CalendarTab.tsx:368](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L368) |
| `CalendarTab.59d542a3` | 写死 | 没有加载出来 | 文字 | [CalendarTab.tsx:390](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L390) |
| `CalendarTab.b18f1032` | 写死 | 加载中 | 文字 | [CalendarTab.tsx:390](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L390) |
| `CalendarTab.5544dd86` | 写死 | 今天， | 文字 | [CalendarTab.tsx:391](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L391) |
| `CalendarTab.0093c4d7` | 写死 | 等 {length} 条规则 | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.4128a7e2` | 写死 | ，命中{…}{…} | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.6b83536c` | 写死 | 没有价格{…} | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.6d6890b0` | 写死 | 算不出价 | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392)、436、440 行 |
| `CalendarTab.7a1a7f25` | 写死 | ，已停用 | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.8ba04304` | 写死 | ，分时段 | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.9d0ab570` | 写死 | 结算价 {…}{from}{…}{…}{…} | 文字 | [CalendarTab.tsx:392](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L392) |
| `CalendarTab.64b2c2de` | 写死 | 起点 | 文字 | [CalendarTab.tsx:393](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L393) |
| `CalendarTab.858393b1` | 写死 | ，已选 | 文字 | [CalendarTab.tsx:393](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L393) |
| `CalendarTab.b43323ad` | 写死 | 终点 | 文字 | [CalendarTab.tsx:393](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L393) |
| `CalendarTab.d59b2620` | 写死 | ，选中的{…} | 文字 | [CalendarTab.tsx:393](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L393) |
| `CalendarTab.3be824d0` | 写死 | 今天 | 正文 | [CalendarTab.tsx:422](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L422) |
| `CalendarTab.656f2537` | 写死 | 已停用 | 正文 | [CalendarTab.tsx:445](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L445) |
| `CalendarTab.155af623` | 写死 | 分时段 | 正文 | [CalendarTab.tsx:453](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L453) |
| `CalendarTab.3f4e47c1` | 写死 | {…} 月 {…} 日 – {…} 日 | 标题 | [CalendarTab.tsx:463](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L463) |
| `CalendarTab.f495b6b9` | 写死 | {…} 月 {…} 日 | 标题 | [CalendarTab.tsx:463](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L463) |
| `CalendarTab.ce94b84e` | 写死 | 原来看的那个组合已经不在这个商品里了，现在显示的是「{comboName}」。 | 提示 | [CalendarTab.tsx:469](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L469) |
| `CalendarTab.62abc046` | 写死 | 看哪个组合 | 读屏说明 | [CalendarTab.tsx:471](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L471) |
| `CalendarTab.0e451124` | 写死 | 区域 | 文字 | [CalendarTab.tsx:472](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L472) |
| `CalendarTab.5a91a4b0` | 写死 | 同一区域（区域价） | 名称 | [CalendarTab.tsx:473](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L473) |
| `CalendarTab.707d754d` | 写死 | 到 {…} | 名称 | [CalendarTab.tsx:473](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L473) |
| `CalendarTab.878ec3f2` | 写死 | 下车区域 | 文字 | [CalendarTab.tsx:473](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L473) |
| `CalendarTab.41cf3ac8` | 写死 | 车型组 | 文字 | [CalendarTab.tsx:474](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L474) |
| `CalendarTab.6cd1d22f` | 写死 | 方向 | 文字 | [CalendarTab.tsx:475](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L475) |
| `CalendarTab.38278a4a` | 写死 | {hours} 小时 | 名称 | [CalendarTab.tsx:476](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L476) |
| `CalendarTab.51d18174` | 写死 | 套餐 | 文字 | [CalendarTab.tsx:476](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L476) |
| `CalendarTab.b6c95459` | 写死 | 用车时间 | 正文 | [CalendarTab.tsx:479](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L479) |
| `CalendarTab.bee7fa28` | 写死 | 有的调价规则只在某个时段生效。这里填几点，日历就显示几点用车的价。 | 正文 | [CalendarTab.tsx:501](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L501) |
| `CalendarTab.ef5cc114` | 写死 | 上个月 | 名称 | [CalendarTab.tsx:505](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L505) |
| `CalendarTab.04d94d77` | 写死 | 下个月 | 名称 | [CalendarTab.tsx:509](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L509) |
| `CalendarTab.4203602f` | 写死 | 回到本月 | 按钮 | [CalendarTab.tsx:513](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L513) |
| `CalendarTab.8f822661` | 写死 | 选一段日期 | 按钮 | [CalendarTab.tsx:526](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L526) |
| `CalendarTab.8db5d68e` | 写死 | 拖动或用键盘选一段日期，可以直接新建调价规则 | 正文 | [CalendarTab.tsx:527](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L527) |
| `CalendarTab.87690ff6` | 写死 | 再点结束的那一天 | 正文 | [CalendarTab.tsx:529](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L529) |
| `CalendarTab.d0e2b66c` | 写死 | 点开始的那一天 | 正文 | [CalendarTab.tsx:529](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L529) |
| `CalendarTab.2233099d` | 写死 | 「{comboName}」这个月没有价格。 | 正文 | [CalendarTab.tsx:532](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L532) |
| `CalendarTab.181374d1` | 写死 | ，共 {…} 天 | 正文 | [CalendarTab.tsx:544](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L544) |
| `CalendarTab.4f18da38` | 写死 | 已选 | 正文 | [CalendarTab.tsx:544](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L544) |
| `CalendarTab.9b4304bd` | 写死 | {from} 至 {to} | 正文 | [CalendarTab.tsx:544](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L544) |
| `CalendarTab.e1990dfa` | 写死 | 新建调价规则 | 按钮 | [CalendarTab.tsx:549](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L549) |
| `CalendarTab.b0ff11e6` | 写死 | 取消选择 | 按钮 | [CalendarTab.tsx:553](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L553) |
| `CalendarTab.763ccdc1` | 写死 | {…}每一天的结算价 | 读屏说明 | [CalendarTab.tsx:563](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L563) |
| `CalendarTab.168dfd49` | 写死 | 周三 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.2e07fc9f` | 写死 | 周五 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.62145fe7` | 写死 | 周四 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.62c618bd` | 写死 | 周一 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.869c5d47` | 写死 | 周二 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.c18a89ac` | 写死 | 周六 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.e23c10bf` | 写死 | 周日 | 正文 | [CalendarTab.tsx:565](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L565) |
| `CalendarTab.4f17354a` | 写死 | 这个组合设了含公里数，日历上是不超出时的价。超出的公里数按每一单的路线算，加进一口价。 | 正文 | [CalendarTab.tsx:585](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L585) |
| `CalendarTab.2210b182` | 写死 | 这个组合按里程和时长计价，日历上是不超出起步里程和起步时长时的价（起步价或最低消费）调完以后的数。按客人实际路线报价要等路线预估功能上线。 | 正文 | [CalendarTab.tsx:586](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L586) |
| `CalendarTab.950fb45f` | 写死 | 日历上是按价格规则和调价规则算出来的结算价，不含加急费、夜间加价和附加服务。日期是{…}当地的用车日期。 | 正文 | [CalendarTab.tsx:587](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L587) |
| `CalendarTab.59148838` | 写死 | {shownDate} 的价 | 标题 | [CalendarTab.tsx:588](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L588) |
| `CalendarTab.c9fc31eb` | 写死 | 关闭 | 按钮 | [CalendarTab.tsx:588](../../apps/web/src/pages/products/prices/CalendarTab.tsx#L588) |

## 多个页面共用：「价格规则」页签里的「计程价」小块（DistancePriceBlock.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/DistancePriceBlock.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `DistancePriceBlock.99c0280d` | 写死 | 两端都不在报价区域时按计程价报价；只有一端在区域内时，区域外那段按这里的每公里单价收里程费；不设则这些情况不报价。 | 说明 | [DistancePriceBlock.tsx:25](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L25) |
| `DistancePriceBlock.f11fe67b` | 写死 | 起步价和每公里不能都是 0 | 文字 | [DistancePriceBlock.tsx:41](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L41) |
| `DistancePriceBlock.692d62a5` | 写死 | 请填整数金额（按币种的最小单位） | 文字 | [DistancePriceBlock.tsx:45](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L45) |
| `DistancePriceBlock.9e690462` | 写死 | 金额太大了，请检查是不是多打了几个零 | 文字 | [DistancePriceBlock.tsx:46](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L46) |
| `DistancePriceBlock.c69aca08` | 写死 | 日期写法不对，例如 2026-12-01 | 文字 | [DistancePriceBlock.tsx:47](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L47) |
| `DistancePriceBlock.70d8f165` | 写死 | 结束日期不能早于开始日期 | 文字 | [DistancePriceBlock.tsx:48](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L48)、135 行 |
| `DistancePriceBlock.8c1f3158` | 写死 | 只能选这个商品选了的车型组；车型组在第 ① 步改 | 文字 | [DistancePriceBlock.tsx:49](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L49) |
| `DistancePriceBlock.becc8547` | 写死 | 一直有效 | 文字 | [DistancePriceBlock.tsx:56](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L56) |
| `DistancePriceBlock.cbf248f3` | 写死 | {…} 至 {…} | 文字 | [DistancePriceBlock.tsx:56](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L56) |
| `DistancePriceBlock.0484b236` | 写死 | 这个车型组已经有计程价的生效日期和这段重叠{…}，停用的也算。请改生效日期，或者先把那一条的结束日期改早。 | 文字 | [DistancePriceBlock.tsx:57](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L57) |
| `DistancePriceBlock.d4f7bfe4` | 写死 | {valid\_from} 起，一直有效 | 文字 | [DistancePriceBlock.tsx:60](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L60) |
| `DistancePriceBlock.fd5a8391` | 写死 | {valid\_from} 至 {valid\_to} | 文字 | [DistancePriceBlock.tsx:60](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L60) |
| `DistancePriceBlock.8df1b6be` | 写死 | 已不在这个商品里的车型组 | 名称 | [DistancePriceBlock.tsx:75](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L75) |
| `DistancePriceBlock.68ff03ac` | 写死 | {what}：只有接送机、点对点商品能设计程价。 | 提示 | [DistancePriceBlock.tsx:84](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L84) |
| `DistancePriceBlock.165488a6` | 写死 | 这个商品刚被别人修改过，{what}。已经载入最新的内容，请再试一次。 | 提示 | [DistancePriceBlock.tsx:88](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L88) |
| `DistancePriceBlock.bee4c638` | 写死 | 同时有其他人在修改这个商品，{what}。请再试一次。 | 提示 | [DistancePriceBlock.tsx:90](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L90) |
| `DistancePriceBlock.92e7f640` | 写死 | 找不到这条计程价，它可能已被别人删除，{what}。已经载入最新的列表。 | 提示 | [DistancePriceBlock.tsx:94](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L94) |
| `DistancePriceBlock.8054e54f` | 写死 | 请选车型组 | 文字 | [DistancePriceBlock.tsx:115](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L115) |
| `DistancePriceBlock.bca46228` | 写死 | 请填每公里单价 | 文字 | [DistancePriceBlock.tsx:118](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L118) |
| `DistancePriceBlock.c8fe112e` | 写死 | 请填起步价，不收起步价填 0 | 文字 | [DistancePriceBlock.tsx:118](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L118) |
| `DistancePriceBlock.68c8c355` | 写死 | 请填生效日期，例如 2026-12-01 | 文字 | [DistancePriceBlock.tsx:132](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L132) |
| `DistancePriceBlock.5d8c4ae9` | 写死 | 日期写法不对，例如 2026-12-31；一直有效就空着 | 文字 | [DistancePriceBlock.tsx:134](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L134) |
| `DistancePriceBlock.280053d0` | 写死 | 已新增 | 提示 | [DistancePriceBlock.tsx:160](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L160) |
| `DistancePriceBlock.8c13045d` | 写死 | 已保存 | 提示 | [DistancePriceBlock.tsx:160](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L160) |
| `DistancePriceBlock.a3675794` | 写死 | {…}「{…}」的计程价 | 提示 | [DistancePriceBlock.tsx:160](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L160)、189 行 |
| `DistancePriceBlock.54b7a818` | 写死 | 没有保存 | 文字 | [DistancePriceBlock.tsx:172](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L172) |
| `DistancePriceBlock.ef516db6` | 写死 | 没有新增 | 文字 | [DistancePriceBlock.tsx:172](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L172) |
| `DistancePriceBlock.57771f3b` | 写死 | 已启用 | 提示 | [DistancePriceBlock.tsx:189](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L189)、275、280 行 |
| `DistancePriceBlock.93295c87` | 写死 | 已停用 | 提示 | [DistancePriceBlock.tsx:189](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L189)、275、280 行 |
| `DistancePriceBlock.2282ffec` | 写死 | 没有停用 | 文字 | [DistancePriceBlock.tsx:191](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L191) |
| `DistancePriceBlock.ce3e7d14` | 写死 | 没有启用 | 文字 | [DistancePriceBlock.tsx:191](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L191) |
| `DistancePriceBlock.f2af3d22` | 写死 | 已删除「{…}」的一条计程价 | 提示 | [DistancePriceBlock.tsx:204](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L204) |
| `DistancePriceBlock.df080ea7` | 写死 | 没有删除 | 文字 | [DistancePriceBlock.tsx:209](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L209) |
| `DistancePriceBlock.7be511b5` | 写死 | 计程价加载中 | 名称 | [DistancePriceBlock.tsx:219](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L219) |
| `DistancePriceBlock.245b1d68` | 写死 | 需要的话，请联系你们的管理员开通。 | 说明 | [DistancePriceBlock.tsx:220](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L220) |
| `DistancePriceBlock.74b66875` | 写死 | 你没有权限查看计程价 | 标题 | [DistancePriceBlock.tsx:220](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L220) |
| `DistancePriceBlock.956a2633` | 写死 | 计程价没有加载出来 | 标题 | [DistancePriceBlock.tsx:225](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L225) |
| `DistancePriceBlock.7eb671d8` | 写死 | 请检查网络后重试。 | 说明 | [DistancePriceBlock.tsx:226](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L226) |
| `DistancePriceBlock.b35e5e2f` | 写死 | 重试 | 按钮 | [DistancePriceBlock.tsx:230](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L230) |
| `DistancePriceBlock.3d24a607` | 写死 | 还没有设计程价。不设的话，两端都不在报价区域、或只有一端在的请求，这个商品不报价。 | 正文 | [DistancePriceBlock.tsx:235](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L235) |
| `DistancePriceBlock.aa823600` | 写死 | 这个商品没有设计程价。 | 正文 | [DistancePriceBlock.tsx:235](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L235) |
| `DistancePriceBlock.92d96da4` | 写死 | 计程价列表 | 读屏说明 | [DistancePriceBlock.tsx:238](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L238) |
| `DistancePriceBlock.b6e6386e` | 写死 | 车型组 | 表头 | [DistancePriceBlock.tsx:242](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L242)、349 行 |
| `DistancePriceBlock.94197a16` | 写死 | 起步价（{currency}） | 表头 | [DistancePriceBlock.tsx:243](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L243)、350 行 |
| `DistancePriceBlock.2d2f85a8` | 写死 | 每公里（{currency}） | 表头 | [DistancePriceBlock.tsx:244](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L244)、351 行 |
| `DistancePriceBlock.e7e54fef` | 写死 | 生效日期 | 表头 | [DistancePriceBlock.tsx:245](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L245)、269 行 |
| `DistancePriceBlock.b2029671` | 写死 | 启用 | 表头 | [DistancePriceBlock.tsx:246](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L246)、273 行 |
| `DistancePriceBlock.7cb1d135` | 写死 | 操作 | 正文 | [DistancePriceBlock.tsx:249](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L249) |
| `DistancePriceBlock.8a8231fc` | 写死 | 起步价 | 名称 | [DistancePriceBlock.tsx:263](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L263) |
| `DistancePriceBlock.7b18735e` | 写死 | 每公里 | 名称 | [DistancePriceBlock.tsx:266](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L266) |
| `DistancePriceBlock.e811083b` | 写死 | 已过期 | 正文 | [DistancePriceBlock.tsx:271](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L271) |
| `DistancePriceBlock.89090351` | 写死 | 启用 {name} 的计程价（{…}） | 读屏说明 | [DistancePriceBlock.tsx:278](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L278) |
| `DistancePriceBlock.ca0d78ee` | 写死 | 编辑 {name} 的计程价（{…}） | 读屏说明 | [DistancePriceBlock.tsx:286](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L286) |
| `DistancePriceBlock.56395678` | 写死 | 编辑 | 按钮 | [DistancePriceBlock.tsx:288](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L288) |
| `DistancePriceBlock.50151293` | 写死 | 删除 {name} 的计程价（{…}） | 读屏说明 | [DistancePriceBlock.tsx:289](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L289) |
| `DistancePriceBlock.56015890` | 写死 | 删除 | 按钮 | [DistancePriceBlock.tsx:291](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L291)、369 行 |
| `DistancePriceBlock.1fa6e2d8` | 写死 | 计程价 | 标题 | [DistancePriceBlock.tsx:308](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L308) |
| `DistancePriceBlock.c5fc5c39` | 写死 | 按车型组设起步价和每公里单价（结算价，{currency}）：计程价 = 起步价 + 路线公里数 × 每公里，不足 1 公里按 1 公里。这一块的修改立即保存，不用点下面的「保存」。 | 正文 | [DistancePriceBlock.tsx:312](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L312) |
| `DistancePriceBlock.caf66ab2` | 写死 | 新增计程价 | 按钮 | [DistancePriceBlock.tsx:322](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L322)、328 行 |
| `DistancePriceBlock.2e240921` | 写死 | 编辑计程价 | 标题 | [DistancePriceBlock.tsx:328](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L328) |
| `DistancePriceBlock.56089036` | 写死 | 取消 | 按钮 | [DistancePriceBlock.tsx:335](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L335)、366 行 |
| `DistancePriceBlock.748a6988` | 写死 | 保存中… | 文字 | [DistancePriceBlock.tsx:336](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L336) |
| `DistancePriceBlock.5d2de57a` | 写死 | 保存 | 按钮 | [DistancePriceBlock.tsx:337](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L337) |
| `DistancePriceBlock.aaf115cc` | 写死 | 新增 | 按钮 | [DistancePriceBlock.tsx:337](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L337) |
| `DistancePriceBlock.9e4aa5a2` | 写死 | 请选择 | 输入框占位 | [DistancePriceBlock.tsx:349](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L349) |
| `DistancePriceBlock.15917f7f` | 写死 | 不收起步价填 0 | 说明 | [DistancePriceBlock.tsx:350](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L350) |
| `DistancePriceBlock.e901e2bc` | 写死 | 区域外里程费也按这个单价收 | 说明 | [DistancePriceBlock.tsx:351](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L351) |
| `DistancePriceBlock.c01493ed` | 写死 | 年-月-日 | 输入框占位 | [DistancePriceBlock.tsx:352](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L352) |
| `DistancePriceBlock.e7111051` | 写死 | 商品所在城市的当地日期，当天也算，例如 2026-12-01 | 说明 | [DistancePriceBlock.tsx:352](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L352) |
| `DistancePriceBlock.f792a1d5` | 写死 | 生效日期 从 | 名称 | [DistancePriceBlock.tsx:352](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L352) |
| `DistancePriceBlock.52450b5c` | 写死 | 到（含这一天） | 名称 | [DistancePriceBlock.tsx:353](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L353) |
| `DistancePriceBlock.71da25a8` | 写死 | 同一个车型组的生效日期不能重叠 | 说明 | [DistancePriceBlock.tsx:353](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L353) |
| `DistancePriceBlock.da0c3e8f` | 写死 | 空着 = 一直有效 | 输入框占位 | [DistancePriceBlock.tsx:353](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L353) |
| `DistancePriceBlock.994bb53d` | 写死 | 删除这条计程价？ | 标题 | [DistancePriceBlock.tsx:359](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L359) |
| `DistancePriceBlock.3ea02cff` | 写死 | 删除中… | 文字 | [DistancePriceBlock.tsx:367](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L367) |
| `DistancePriceBlock.6ef73742` | 写死 | 「{…}」起步价 {…}、每公里 {…}（{…}）。删除后立即生效：这段日期里两端都不在报价区域、或只有一端在的请求，这个车型组不再报价。 | 正文 | [DistancePriceBlock.tsx:373](../../apps/web/src/pages/products/prices/DistancePriceBlock.tsx#L373) |

## 多个页面共用：包车三层区域的价格页（LayerTables.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/LayerTables.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `LayerTables.0ee91476` | 写死 | （已删除的区域） | 文字 | [LayerTables.tsx:149](../../apps/web/src/pages/products/prices/LayerTables.tsx#L149) |
| `LayerTables.605df69c` | 写死 | （区域） | 文字 | [LayerTables.tsx:149](../../apps/web/src/pages/products/prices/LayerTables.tsx#L149) |
| `LayerTables.b3733b06` | 写死 | 已移除的车型组 | 名称 | [LayerTables.tsx:151](../../apps/web/src/pages/products/prices/LayerTables.tsx#L151) |
| `LayerTables.2fc65375` | 写死 | {hours} 小时 | 文字 | [LayerTables.tsx:152](../../apps/web/src/pages/products/prices/LayerTables.tsx#L152) |
| `LayerTables.c5c9f96c` | 写死 |  · {packageHours} 小时 | 名称 | [LayerTables.tsx:153](../../apps/web/src/pages/products/prices/LayerTables.tsx#L153) |
| `LayerTables.6a49f608` | 写死 | 已添加 | 说明 | [LayerTables.tsx:161](../../apps/web/src/pages/products/prices/LayerTables.tsx#L161) |
| `LayerTables.73a7628c` | 写死 | 请先选一个区域 | 错误提示 | [LayerTables.tsx:166](../../apps/web/src/pages/products/prices/LayerTables.tsx#L166) |
| `LayerTables.7220769d` | 写死 | 已添加「{…}」，在下面按车型组填{title}，还没有保存 | 提示 | [LayerTables.tsx:172](../../apps/web/src/pages/products/prices/LayerTables.tsx#L172) |
| `LayerTables.52bf57d4` | 写死 | 已去掉「{…}」 | 提示 | [LayerTables.tsx:181](../../apps/web/src/pages/products/prices/LayerTables.tsx#L181) |
| `LayerTables.388b07a2` | 写死 | {…} 的{…} | 读屏说明 | [LayerTables.tsx:209](../../apps/web/src/pages/products/prices/LayerTables.tsx#L209) |
| `LayerTables.062d90ce` | 写死 | 一直有效 | 正文 | [LayerTables.tsx:229](../../apps/web/src/pages/products/prices/LayerTables.tsx#L229)、239 行 |
| `LayerTables.13c1d048` | 写死 | {…} 的生效日期{…} | 读屏说明 | [LayerTables.tsx:237](../../apps/web/src/pages/products/prices/LayerTables.tsx#L237) |
| `LayerTables.4b89fcd6` | 写死 | 到 | 读屏说明 | [LayerTables.tsx:237](../../apps/web/src/pages/products/prices/LayerTables.tsx#L237)、395 行 |
| `LayerTables.91230f6b` | 写死 | 从 | 读屏说明 | [LayerTables.tsx:237](../../apps/web/src/pages/products/prices/LayerTables.tsx#L237) |
| `LayerTables.ae117545` | 写死 | 年-月-日 | 输入框占位 | [LayerTables.tsx:239](../../apps/web/src/pages/products/prices/LayerTables.tsx#L239) |
| `LayerTables.1129172b` | 写死 | 已停用 | 正文 | [LayerTables.tsx:276](../../apps/web/src/pages/products/prices/LayerTables.tsx#L276)、536 行 |
| `LayerTables.251cc187` | 写死 | 启用这一条：{label} | 读屏说明 | [LayerTables.tsx:276](../../apps/web/src/pages/products/prices/LayerTables.tsx#L276) |
| `LayerTables.d42e70d6` | 写死 | 启用 | 正文 | [LayerTables.tsx:276](../../apps/web/src/pages/products/prices/LayerTables.tsx#L276)、396、522、536 行 |
| `LayerTables.2877f366` | 写死 | 撤销删除 | 读屏说明 | [LayerTables.tsx:286](../../apps/web/src/pages/products/prices/LayerTables.tsx#L286)、287 行 |
| `LayerTables.482e9367` | 写死 | 删除 | 读屏说明 | [LayerTables.tsx:286](../../apps/web/src/pages/products/prices/LayerTables.tsx#L286)、287 行 |
| `LayerTables.86ebb14c` | 写死 | 清空这一行：{label} | 读屏说明 | [LayerTables.tsx:290](../../apps/web/src/pages/products/prices/LayerTables.tsx#L290) |
| `LayerTables.f2891f06` | 写死 | 清空 | 按钮 | [LayerTables.tsx:292](../../apps/web/src/pages/products/prices/LayerTables.tsx#L292) |
| `LayerTables.b9b31ed9` | 写死 | {missing} 格没填 | 正文 | [LayerTables.tsx:308](../../apps/web/src/pages/products/prices/LayerTables.tsx#L308) |
| `LayerTables.527c9ab0` | 写死 | 没有保存：区域重叠。 | 正文 | [LayerTables.tsx:315](../../apps/web/src/pages/products/prices/LayerTables.tsx#L315) |
| `LayerTables.a09893f8` | 写死 | 区域没有加载出来。 | 正文 | [LayerTables.tsx:328](../../apps/web/src/pages/products/prices/LayerTables.tsx#L328) |
| `LayerTables.6f9334a3` | 写死 | 重试 | 按钮 | [LayerTables.tsx:330](../../apps/web/src/pages/products/prices/LayerTables.tsx#L330) |
| `LayerTables.ec669495` | 写死 | 选择要设{title}的区域 | 表单标签 | [LayerTables.tsx:336](../../apps/web/src/pages/products/prices/LayerTables.tsx#L336) |
| `LayerTables.3b9ebd09` | 写死 | 加载中… | 选项 | [LayerTables.tsx:350](../../apps/web/src/pages/products/prices/LayerTables.tsx#L350) |
| `LayerTables.ea4518a3` | 写死 | 选择区域 | 选项 | [LayerTables.tsx:350](../../apps/web/src/pages/products/prices/LayerTables.tsx#L350) |
| `LayerTables.fdff0e14` | 写死 | 确认添加 | 按钮 | [LayerTables.tsx:362](../../apps/web/src/pages/products/prices/LayerTables.tsx#L362) |
| `LayerTables.f4fde097` | 写死 | 没有其他区域可选。先到区域页面画出要加价的区域，再回来添加。 | 正文 | [LayerTables.tsx:369](../../apps/web/src/pages/products/prices/LayerTables.tsx#L369) |
| `LayerTables.f67bb299` | 写死 | 新增自定义区域 | 链接 | [LayerTables.tsx:374](../../apps/web/src/pages/products/prices/LayerTables.tsx#L374) |
| `LayerTables.2169daee` | 写死 | 在上面选一个区域添加。 | 正文 | [LayerTables.tsx:382](../../apps/web/src/pages/products/prices/LayerTables.tsx#L382) |
| `LayerTables.5b53499e` | 写死 | 还没有{title}的区域。{…} | 正文 | [LayerTables.tsx:382](../../apps/web/src/pages/products/prices/LayerTables.tsx#L382) |
| `LayerTables.c88d50c1` | 写死 | {title}（{currency}，结算价）：每个区域 × 车型组一行，{emptyCell} | 正文 | [LayerTables.tsx:386](../../apps/web/src/pages/products/prices/LayerTables.tsx#L386) |
| `LayerTables.466069cf` | 写死 | 车型组 | 表头 | [LayerTables.tsx:389](../../apps/web/src/pages/products/prices/LayerTables.tsx#L389)、477、515 行 |
| `LayerTables.c2ad3fea` | 写死 | 套餐 | 表头 | [LayerTables.tsx:390](../../apps/web/src/pages/products/prices/LayerTables.tsx#L390)、478、516 行 |
| `LayerTables.8ccaea8f` | 写死 | 生效日期 从 | 表头 | [LayerTables.tsx:394](../../apps/web/src/pages/products/prices/LayerTables.tsx#L394) |
| `LayerTables.8fe96664` | 写死 | 状态 | 表头 | [LayerTables.tsx:397](../../apps/web/src/pages/products/prices/LayerTables.tsx#L397) |
| `LayerTables.050cd09c` | 写死 | 操作 | 正文 | [LayerTables.tsx:400](../../apps/web/src/pages/products/prices/LayerTables.tsx#L400) |
| `LayerTables.f52252b3` | 写死 | {areaMissing} 格没填 | 正文 | [LayerTables.tsx:419](../../apps/web/src/pages/products/prices/LayerTables.tsx#L419) |
| `LayerTables.d117ac30` | 写死 | 和别的区域重叠，见上面 | 正文 | [LayerTables.tsx:426](../../apps/web/src/pages/products/prices/LayerTables.tsx#L426) |
| `LayerTables.61ca7431` | 写死 | 去掉「{…}」 | 读屏说明 | [LayerTables.tsx:429](../../apps/web/src/pages/products/prices/LayerTables.tsx#L429) |
| `LayerTables.eb5a004b` | 写死 | 去掉 | 按钮 | [LayerTables.tsx:431](../../apps/web/src/pages/products/prices/LayerTables.tsx#L431) |
| `LayerTables.8149ad98` | 写死 | {…} · {package\_km} 公里 · 超时 {…} / 小时 · 超公里 {…} / 公里{…}{…} | 文字 | [LayerTables.tsx:448](../../apps/web/src/pages/products/prices/LayerTables.tsx#L448) |
| `LayerTables.be2cd80d` | 写死 |  · 已停用 | 文字 | [LayerTables.tsx:448](../../apps/web/src/pages/products/prices/LayerTables.tsx#L448) |
| `LayerTables.f980ea00` | 写死 |  · 到 {valid\_to} | 文字 | [LayerTables.tsx:448](../../apps/web/src/pages/products/prices/LayerTables.tsx#L448) |
| `LayerTables.189a59ff` | 写死 | 收起明细 | 按钮 | [LayerTables.tsx:466](../../apps/web/src/pages/products/prices/LayerTables.tsx#L466) |
| `LayerTables.e54a20c9` | 写死 | 看明细 | 按钮 | [LayerTables.tsx:466](../../apps/web/src/pages/products/prices/LayerTables.tsx#L466) |
| `LayerTables.99fd3b7f` | 写死 | 迁移时整商品套餐价取自一个服务区域；下面这些服务区域原来的套餐价和它不一样。现在报价都用整商品套餐价，要改请在下面「套餐价」里改。 | 正文 | [LayerTables.tsx:469](../../apps/web/src/pages/products/prices/LayerTables.tsx#L469) |
| `LayerTables.7ee7d175` | 写死 | 迁移差异明细 | 读屏说明 | [LayerTables.tsx:471](../../apps/web/src/pages/products/prices/LayerTables.tsx#L471) |
| `LayerTables.1ae57186` | 写死 | 迁移差异（{currency}，结算价）：区域、车型组、套餐、旧值、整商品值 | 正文 | [LayerTables.tsx:473](../../apps/web/src/pages/products/prices/LayerTables.tsx#L473) |
| `LayerTables.6406369b` | 写死 | 区域 | 表头 | [LayerTables.tsx:476](../../apps/web/src/pages/products/prices/LayerTables.tsx#L476)、514 行 |
| `LayerTables.36e4b3af` | 写死 | 旧值 | 表头 | [LayerTables.tsx:479](../../apps/web/src/pages/products/prices/LayerTables.tsx#L479) |
| `LayerTables.73e47afa` | 写死 | 整商品值 | 表头 | [LayerTables.tsx:480](../../apps/web/src/pages/products/prices/LayerTables.tsx#L480) |
| `LayerTables.9e73e2ac` | 写死 | {package\_hours} 小时 | 正文 | [LayerTables.tsx:488](../../apps/web/src/pages/products/prices/LayerTables.tsx#L488)、530 行 |
| `LayerTables.1539b896` | 写死 | {…}（{valid\_from} 起） | 正文 | [LayerTables.tsx:489](../../apps/web/src/pages/products/prices/LayerTables.tsx#L489) |
| `LayerTables.4153b6ac` | 写死 | 没有整商品套餐价 | 正文 | [LayerTables.tsx:490](../../apps/web/src/pages/products/prices/LayerTables.tsx#L490) |
| `LayerTables.ae06aaad` | 写死 | {legacyTitle}（{length} 条） | 正文 | [LayerTables.tsx:507](../../apps/web/src/pages/products/prices/LayerTables.tsx#L507) |
| `LayerTables.83e39251` | 写死 | 迁移到三层区域以后，报价只用上面按车型组 × 套餐填的整商品套餐价；这些是迁移前按服务区域填的，留着对照，不能修改。 | 正文 | [LayerTables.tsx:508](../../apps/web/src/pages/products/prices/LayerTables.tsx#L508) |
| `LayerTables.056e0a48` | 写死 | 套餐公里 | 表头 | [LayerTables.tsx:517](../../apps/web/src/pages/products/prices/LayerTables.tsx#L517) |
| `LayerTables.313ed4a8` | 写死 | 套餐价（{currency}） | 表头 | [LayerTables.tsx:518](../../apps/web/src/pages/products/prices/LayerTables.tsx#L518) |
| `LayerTables.60a84923` | 写死 | 超时每小时（{currency}） | 表头 | [LayerTables.tsx:519](../../apps/web/src/pages/products/prices/LayerTables.tsx#L519) |
| `LayerTables.5b2ee110` | 写死 | 超公里每公里（{currency}） | 表头 | [LayerTables.tsx:520](../../apps/web/src/pages/products/prices/LayerTables.tsx#L520) |
| `LayerTables.90e16d5c` | 写死 | 生效日期 | 表头 | [LayerTables.tsx:521](../../apps/web/src/pages/products/prices/LayerTables.tsx#L521) |
| `LayerTables.6c73f8cd` | 写死 | {valid\_from} 起 | 正文 | [LayerTables.tsx:535](../../apps/web/src/pages/products/prices/LayerTables.tsx#L535) |
| `LayerTables.cc94f3b0` | 写死 | {valid\_from} 至 {valid\_to} | 正文 | [LayerTables.tsx:535](../../apps/web/src/pages/products/prices/LayerTables.tsx#L535) |

## 多个页面共用：「价格规则」页签（PriceRulesTab.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/PriceRulesTab.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PriceRulesTab.88095fcc` | 写死 | 分钟 | 文字 | [PriceRulesTab.tsx:92](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L92) |
| `PriceRulesTab.f192cd57` | 写死 | 公里 | 文字 | [PriceRulesTab.tsx:92](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L92) |
| `PriceRulesTab.15689e20` | 写死 |  / 公里 | 文字 | [PriceRulesTab.tsx:93](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L93) |
| `PriceRulesTab.32e71665` | 写死 |  / 小时 | 文字 | [PriceRulesTab.tsx:93](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L93) |
| `PriceRulesTab.a2deebe1` | 写死 |  / 分钟 | 文字 | [PriceRulesTab.tsx:93](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L93) |
| `PriceRulesTab.f97ea334` | 写死 | 已移除的区域 | 名称 | [PriceRulesTab.tsx:239](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L239) |
| `PriceRulesTab.abd081b4` | 写死 | 已移除的车型组 | 名称 | [PriceRulesTab.tsx:240](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L240) |
| `PriceRulesTab.da192fa2` | 写死 | {packageHours} 小时 | 名称 | [PriceRulesTab.tsx:244](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L244) |
| `PriceRulesTab.70b2dacb` | 写死 | （第 {…} 段，共 {length} 段） | 文字 | [PriceRulesTab.tsx:256](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L256) |
| `PriceRulesTab.a021ed40` | 写死 | {from} 起{…} | 文字 | [PriceRulesTab.tsx:262](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L262) |
| `PriceRulesTab.fade3acd` | 写死 | ，到 {to} | 文字 | [PriceRulesTab.tsx:262](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L262) |
| `PriceRulesTab.fd763190` | 写死 | 未填开始日期 | 文字 | [PriceRulesTab.tsx:262](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L262) |
| `PriceRulesTab.b601a842` | 写死 | （第 {…} 段，共 {length} 段，{dates}） | 文字 | [PriceRulesTab.tsx:263](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L263) |
| `PriceRulesTab.10962a1a` | 写死 | 别人也改过这一条，请核对 | 文字 | [PriceRulesTab.tsx:282](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L282) |
| `PriceRulesTab.2da4130d` | 写死 | 和 {…} 条价格的日期重叠 | 文字 | [PriceRulesTab.tsx:283](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L283) |
| `PriceRulesTab.3545441a` | 写死 | {validFrom} 至 {validTo} | 文字 | [PriceRulesTab.tsx:314](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L314)、711 行 |
| `PriceRulesTab.87ef5e54` | 写死 | {validFrom} 起一直有效 | 文字 | [PriceRulesTab.tsx:314](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L314)、711 行 |
| `PriceRulesTab.21472b34` | 写死 | （已删除的区域） | 名称 | [PriceRulesTab.tsx:322](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L322) |
| `PriceRulesTab.ec06f3aa` | 写死 | （区域） | 名称 | [PriceRulesTab.tsx:322](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L322) |
| `PriceRulesTab.f25ab924` | 写死 | 区域加价 · {…} · {…} · {packageHours} 小时 | 名称 | [PriceRulesTab.tsx:324](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L324) |
| `PriceRulesTab.9b5c2e3a` | 写死 | 生效日期重叠——{…} | 文字 | [PriceRulesTab.tsx:338](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L338)、362 行 |
| `PriceRulesTab.b15db510` | 写死 |  · {packageHours} 小时 | 名称 | [PriceRulesTab.tsx:346](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L346) |
| `PriceRulesTab.272a9c86` | 写死 | 生效日期重叠——{text} | 文字 | [PriceRulesTab.tsx:392](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L392) |
| `PriceRulesTab.5208d51e` | 写死 | 一次最多保存 {maxBatchChanges} 条。请先取消一部分修改，或分两次保存。 | 文字 | [PriceRulesTab.tsx:394](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L394) |
| `PriceRulesTab.12963d9e` | 写死 | 这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。 | 文字 | [PriceRulesTab.tsx:396](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L396)、535 行 |
| `PriceRulesTab.4d207932` | 写死 | 「{name}」是商品的服务区域，上车、下车在那里都不加价，不能再设区域加价。请换一个商品服务区域以外的区域。 | 文字 | [PriceRulesTab.tsx:469](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L469) |
| `PriceRulesTab.0c15dbc8` | 写死 | 「{name}」的业务类型不是包车或通用，不能做包车的加价区域。请换一个区域，或到区域页面改它的业务类型。 | 文字 | [PriceRulesTab.tsx:470](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L470) |
| `PriceRulesTab.d39da4a6` | 写死 | 「{name}」已经停用，不能新加区域加价。请先到区域页面启用它，或换一个区域。 | 文字 | [PriceRulesTab.tsx:471](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L471) |
| `PriceRulesTab.0281da96` | 写死 | 「{name}」是运营区域，不能做加价区域：运营区域只决定能不能接单，不带价格。请换一个报价区域（或到区域页面把它改成「运营 + 报价」）。 | 文字 | [PriceRulesTab.tsx:472](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L472) |
| `PriceRulesTab.4faa6cc8` | 写死 | 有 {count} 条价格已经被别人删除了。请点「重新读取价格」后再保存。 | 文字 | [PriceRulesTab.tsx:478](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L478) |
| `PriceRulesTab.5bf4e667` | 写死 | 一个商品最多 {maxPriceRulesPerProduct} 条价格。请先删掉用不到的（例如已过期的）。 | 文字 | [PriceRulesTab.tsx:478](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L478) |
| `PriceRulesTab.eeeafd11` | 写死 | 没有保存。 | 标题 | [PriceRulesTab.tsx:478](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L478)、530、535、545、551、590 行 |
| `PriceRulesTab.48865b5d` | 写死 | 「{…}」已经不在这个商品里，这条价格保存不了。 | 文字 | [PriceRulesTab.tsx:515](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L515) |
| `PriceRulesTab.7260efc9` | 写死 | 有 {…} 条价格用到的区域已经不在了（可能刚被删除）。请点「重新读取价格」后再保存。 | 文字 | [PriceRulesTab.tsx:530](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L530) |
| `PriceRulesTab.6228aa66` | 写死 | 有区域重叠，所以这一批都没有保存。 | 文字 | [PriceRulesTab.tsx:545](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L545) |
| `PriceRulesTab.c45935a6` | 写死 | 迁移前的旧数据是只读的，请点「重新读取价格」后再保存。 | 文字 | [PriceRulesTab.tsx:551](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L551) |
| `PriceRulesTab.1a46299e` | 写死 | {valid\_from} 起一直有效 | 文字 | [PriceRulesTab.tsx:568](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L568) |
| `PriceRulesTab.d78bfeb1` | 写死 | {valid\_from} 至 {valid\_to} | 文字 | [PriceRulesTab.tsx:568](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L568) |
| `PriceRulesTab.46d6261b` | 写死 | （别人刚加的） | 文字 | [PriceRulesTab.tsx:585](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L585) |
| `PriceRulesTab.54bcaf76` | 写死 | 有 {…} 条价格的生效日期和已有的价格重叠，所以这一批都没有保存。改好以后再点保存。{…} | 文字 | [PriceRulesTab.tsx:590](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L590) |
| `PriceRulesTab.7d967cef` | 写死 | 请点「重新读取价格」后再检查。 | 文字 | [PriceRulesTab.tsx:590](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L590) |
| `PriceRulesTab.98246f5e` | 写死 | 已删除 {deleted} 条价格 | 文字 | [PriceRulesTab.tsx:610](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L610) |
| `PriceRulesTab.a70024c1` | 写死 | 已保存 {…} 条价格 | 文字 | [PriceRulesTab.tsx:610](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L610) |
| `PriceRulesTab.0064349d` | 写死 | 有 {changeTotal} 条未保存的修改 | 正文 | [PriceRulesTab.tsx:614](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L614) |
| `PriceRulesTab.7a51a46a` | 写死 | 未保存的修改已经有 {changeTotal} 条，一次最多保存 {maxBatchChanges} 条，请先保存。 | 正文 | [PriceRulesTab.tsx:614](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L614) |
| `PriceRulesTab.97f2eabc` | 写死 | {total} 个组合里 {priced} 个有价格 | 说明 | [PriceRulesTab.tsx:616](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L616) |
| `PriceRulesTab.17114024` | 写死 | 请填 1 到 {maxPackageHours} 之间的整数 | 文字 | [PriceRulesTab.tsx:625](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L625) |
| `PriceRulesTab.213d4602` | 写死 | 已经有 {hours} 小时的套餐了 | 文字 | [PriceRulesTab.tsx:625](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L625) |
| `PriceRulesTab.d28a60ca` | 写死 | 请填 1 到 {maxPackageKm} 之间的整数 | 文字 | [PriceRulesTab.tsx:626](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L626) |
| `PriceRulesTab.64a26a96` | 写死 | 点表格里的任何一行，这里会用一句话说明这一行的价格。 | 文字 | [PriceRulesTab.tsx:657](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L657) |
| `PriceRulesTab.868afa68` | 写死 | 点线路价表里的任何一行，这里会用一句话说明这一行的价格。 | 文字 | [PriceRulesTab.tsx:657](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L657) |
| `PriceRulesTab.bba82ad7` | 写死 | 取整单位是 {…}，报价时会取整成 {…}。 | 正文 | [PriceRulesTab.tsx:668](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L668) |
| `PriceRulesTab.847e88bd` | 写死 | {label}——还没有价格。客人询价这个组合时报不出价。 | 文字 | [PriceRulesTab.tsx:672](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L672) |
| `PriceRulesTab.683ad020` | 写死 | {label}——新加的一段，请填从哪天开始。上一段「{validFrom} 起一直有效」没有结束日期：填好开始日期后，这里会出现按钮，一键把上一段的结束日期改成前一天。 | 文字 | [PriceRulesTab.tsx:675](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L675) |
| `PriceRulesTab.27faf9e0` | 写死 | 这条线路有了线路价，就不再用区域价，即使区域价更低。 | 正文 | [PriceRulesTab.tsx:679](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L679) |
| `PriceRulesTab.4a3db00d` | 写死 | 只管在{…}上车、在{…}下车的单，反方向不算。 | 正文 | [PriceRulesTab.tsx:679](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L679) |
| `PriceRulesTab.d8866526` | 写死 |  反方向（{…}）还没有线路价，用的是区域价。 | 正文 | [PriceRulesTab.tsx:695](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L695) |
| `PriceRulesTab.523e6b11` | 写死 | 建返程 | 按钮 | [PriceRulesTab.tsx:699](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L699)、855 行 |
| `PriceRulesTab.8df6484d` | 写死 | 和这个组合的另一条价格日期重叠： | 正文 | [PriceRulesTab.tsx:710](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L710) |
| `PriceRulesTab.cd2f071e` | 写死 | 已把「{validFrom} 起」那一条的结束日期改成 {until} | 提示 | [PriceRulesTab.tsx:717](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L717) |
| `PriceRulesTab.94828ab7` | 写死 | 把那一条的结束日期改成 {until} | 按钮 | [PriceRulesTab.tsx:719](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L719) |
| `PriceRulesTab.5a8e946a` | 写死 | 到那一行 | 按钮 | [PriceRulesTab.tsx:723](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L723) |
| `PriceRulesTab.24fa75e3` | 写死 | {hours} 小时 | 名称 | [PriceRulesTab.tsx:732](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L732)、1207 行 |
| `PriceRulesTab.9d1acb23` | 写死 | 请选上车区域和下车区域 | 错误提示 | [PriceRulesTab.tsx:762](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L762) |
| `PriceRulesTab.b007cba2` | 写死 | 和 {length} 条返程 | 提示 | [PriceRulesTab.tsx:776](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L776) |
| `PriceRulesTab.b3ee56c2` | 写死 | 已添加 {length} 条线路价{…}，还没有保存 | 提示 | [PriceRulesTab.tsx:776](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L776) |
| `PriceRulesTab.c34e9352` | 写死 | 已填 {length} 条线路价（{…}），还没有保存 | 提示 | [PriceRulesTab.tsx:785](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L785) |
| `PriceRulesTab.8ce6617e` | 写死 | 整个商品 | 文字 | [PriceRulesTab.tsx:792](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L792) |
| `PriceRulesTab.4286d40f` | 写死 | 超出含公里数后每公里 | 文字 | [PriceRulesTab.tsx:820](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L820) |
| `PriceRulesTab.6ae2ea8c` | 写死 | 超出每公里 | 文字 | [PriceRulesTab.tsx:820](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L820) |
| `PriceRulesTab.98929b57` | 写死 | {…}（{currency} / 公里） | 文字 | [PriceRulesTab.tsx:820](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L820) |
| `PriceRulesTab.1281d4e0` | 写死 | 基础价 | 名称 | [PriceRulesTab.tsx:821](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L821) |
| `PriceRulesTab.b7d08fc1` | 写死 | 基础价 / 起步价 | 名称 | [PriceRulesTab.tsx:821](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L821) |
| `PriceRulesTab.5216ca45` | 写死 | ③ 价格规则 | 标题 | [PriceRulesTab.tsx:826](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L826) |
| `PriceRulesTab.db70abb8` | 写死 | 保存并下一步 | 名称 | [PriceRulesTab.tsx:826](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L826) |
| `PriceRulesTab.927a521c` | 写死 | 返程： | 正文 | [PriceRulesTab.tsx:841](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L841) |
| `PriceRulesTab.4c02b628` | 写死 | 两个方向是两组独立的价格 | 标题 | [PriceRulesTab.tsx:843](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L843) |
| `PriceRulesTab.f4427b8f` | 写死 | 返程：有，到「{…}」那一组 | 读屏说明 | [PriceRulesTab.tsx:843](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L843) |
| `PriceRulesTab.44682fdb` | 写死 | 有 | 按钮 | [PriceRulesTab.tsx:848](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L848) |
| `PriceRulesTab.27a6980b` | 写死 | 没有 | 正文 | [PriceRulesTab.tsx:850](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L850) |
| `PriceRulesTab.aacc9d92` | 写死 | 给「{name}」建返程 | 读屏说明 | [PriceRulesTab.tsx:853](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L853) |
| `PriceRulesTab.749276a4` | 写死 | 复制线路「{name}」 | 读屏说明 | [PriceRulesTab.tsx:858](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L858) |
| `PriceRulesTab.ca085499` | 写死 | 复制 | 按钮 | [PriceRulesTab.tsx:860](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L860) |
| `PriceRulesTab.dcdf5e75` | 写死 | {label}{ordinal} 的{…} | 读屏说明 | [PriceRulesTab.tsx:897](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L897) |
| `PriceRulesTab.0e0576bd` | 写死 | 不设 | 输入框占位 | [PriceRulesTab.tsx:900](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L900) |
| `PriceRulesTab.34c8dc6e` | 写死 | {label}{ordinal} 的生效日期{…} | 读屏说明 | [PriceRulesTab.tsx:930](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L930) |
| `PriceRulesTab.48c64806` | 写死 | 从 | 读屏说明 | [PriceRulesTab.tsx:930](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L930) |
| `PriceRulesTab.8936f164` | 写死 | 到 | 读屏说明 | [PriceRulesTab.tsx:930](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L930)、1430、1554 行 |
| `PriceRulesTab.6678ef90` | 写死 | 年-月-日 | 输入框占位 | [PriceRulesTab.tsx:932](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L932) |
| `PriceRulesTab.ae5e925e` | 写死 | 一直有效 | 输入框占位 | [PriceRulesTab.tsx:932](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L932) |
| `PriceRulesTab.234c9c57` | 写死 | 已经不在这个商品里的线路或车型组的线路价（{length} 条） | 表头 | [PriceRulesTab.tsx:948](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L948) |
| `PriceRulesTab.33c2caa5` | 写死 | 已经不在这个商品里的区域或车型组的价格（{length} 条） | 表头 | [PriceRulesTab.tsx:948](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L948) |
| `PriceRulesTab.4699cf77` | 写死 | 这些价格现在不算数；把区域 / 车型组选回来会重新生效。用不到的可以删掉。 | 正文 | [PriceRulesTab.tsx:949](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L949) |
| `PriceRulesTab.74a6cdbd` | 写死 | 这些线路价现在不算数；把区域 / 车型组选回来会重新生效。用不到的可以删掉。 | 正文 | [PriceRulesTab.tsx:949](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L949) |
| `PriceRulesTab.f6738fa3` | 写死 | 已停用 | 名称 | [PriceRulesTab.tsx:970](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L970)、1016 行 |
| `PriceRulesTab.4eb4cd3c` | 写死 | {label}{ordinal} 的方向 | 读屏说明 | [PriceRulesTab.tsx:983](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L983) |
| `PriceRulesTab.27cc719f` | 写死 | {…} 小时 | 正文 | [PriceRulesTab.tsx:993](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L993) |
| `PriceRulesTab.29927ca2` | 写死 | 一口价 | 正文 | [PriceRulesTab.tsx:997](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L997)、1002 行 |
| `PriceRulesTab.100a8230` | 写死 | {label}{ordinal} 的计价方式 | 读屏说明 | [PriceRulesTab.tsx:999](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L999) |
| `PriceRulesTab.9a501092` | 写死 | 启用这条价格：{label}{ordinal} | 读屏说明 | [PriceRulesTab.tsx:1016](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1016) |
| `PriceRulesTab.f8c892af` | 写死 | 启用 | 正文 | [PriceRulesTab.tsx:1016](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1016)、1431、1555 行 |
| `PriceRulesTab.d88bc4d2` | 写死 | 撤销 | 按钮 | [PriceRulesTab.tsx:1025](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1025) |
| `PriceRulesTab.7ea5a14f` | 写死 | {label}{…} 的更多操作 | 名称 | [PriceRulesTab.tsx:1030](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1030) |
| `PriceRulesTab.a456447e` | 写死 | 已在下面加了一行。上一段没有结束日期，请填这一段从哪天开始。 | 提示 | [PriceRulesTab.tsx:1043](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1043) |
| `PriceRulesTab.c992636b` | 写死 | 已在下面加了一行，从 {from} 开始 | 提示 | [PriceRulesTab.tsx:1043](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1043) |
| `PriceRulesTab.a8a3d474` | 写死 | 再加一段日期 | 正文 | [PriceRulesTab.tsx:1047](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1047) |
| `PriceRulesTab.b0ae222f` | 写死 | 复制这条线路… | 正文 | [PriceRulesTab.tsx:1051](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1051) |
| `PriceRulesTab.8ced270a` | 写死 | 已删除这一行：{label} | 提示 | [PriceRulesTab.tsx:1064](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1064) |
| `PriceRulesTab.9a170820` | 写死 | 删除这一行 | 正文 | [PriceRulesTab.tsx:1068](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1068) |
| `PriceRulesTab.b024e4a4` | 写死 | 清空这一行 | 正文 | [PriceRulesTab.tsx:1072](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1072) |
| `PriceRulesTab.5d02c0e7` | 写死 | 删除 | 正文 | [PriceRulesTab.tsx:1076](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1076) |
| `PriceRulesTab.98fac92e` | 写死 | 撤销删除 | 正文 | [PriceRulesTab.tsx:1076](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1076) |
| `PriceRulesTab.13211ccd` | 写死 | 重新读取价格 | 按钮 | [PriceRulesTab.tsx:1111](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1111) |
| `PriceRulesTab.9cd6a2ed` | 写死 | 有 {size} 条价格别人也改过同一项。 | 正文 | [PriceRulesTab.tsx:1119](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1119) |
| `PriceRulesTab.7c18fed5` | 写死 | 已经载入最新内容：你没动过的格子换成了别人改的；你和别人都改了的格子现在是你的修改（行上标着「别人也改过这一条，请核对」）。请核对后再保存。 | 正文 | [PriceRulesTab.tsx:1120](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1120) |
| `PriceRulesTab.bcd150fd` | 写死 | 有 {size} 条价格的生效日期重叠，保存前要改。 | 正文 | [PriceRulesTab.tsx:1125](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1125) |
| `PriceRulesTab.784d25b2` | 写死 | 还有 {…} 组 | 正文 | [PriceRulesTab.tsx:1132](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1132) |
| `PriceRulesTab.c1ba1f47` | 写死 | 按里程和时长计价的价格现在可以先设好。 | 正文 | [PriceRulesTab.tsx:1139](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1139) |
| `PriceRulesTab.4432b64d` | 写死 | 按客人实际路线的里程和时长报价，要等路线预估功能上线；在那之前，价格日历上显示的是不超出起步里程和起步时长时的价。 | 正文 | [PriceRulesTab.tsx:1140](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1140) |
| `PriceRulesTab.8ef5bc50` | 写死 | 迁移差异（迁移前后套餐价不一致的地方）没有读出来。 | 正文 | [PriceRulesTab.tsx:1148](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1148) |
| `PriceRulesTab.dfded61a` | 写死 | 重试 | 按钮 | [PriceRulesTab.tsx:1151](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1151) |
| `PriceRulesTab.bcb3d8f7` | 写死 | 本页的分块 | 读屏说明 | [PriceRulesTab.tsx:1155](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1155)、1181 行 |
| `PriceRulesTab.d50139f9` | 写死 | {itineraryTitle}（{…} 个区域） | 正文 | [PriceRulesTab.tsx:1159](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1159) |
| `PriceRulesTab.100c0968` | 写死 | {updownTitle}（{…} 个区域） | 正文 | [PriceRulesTab.tsx:1160](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1160) |
| `PriceRulesTab.3cde523c` | 写死 | 基础定价 | 链接 | [PriceRulesTab.tsx:1187](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1187)、1199 行 |
| `PriceRulesTab.659351b0` | 写死 | 区域加价（{surchargeAreaCount} 个区域） | 链接 | [PriceRulesTab.tsx:1193](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1193) |
| `PriceRulesTab.11adf206` | 写死 | {packageTitle}（按车型组 × 套餐填一次，整个商品通用） | 标题 | [PriceRulesTab.tsx:1199](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1199) |
| `PriceRulesTab.d19cb1b0` | 写死 | 套餐： | 正文 | [PriceRulesTab.tsx:1204](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1204) |
| `PriceRulesTab.b0eaffd2` | 写死 | 删除 {hours} 小时套餐 | 读屏说明 | [PriceRulesTab.tsx:1209](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1209) |
| `PriceRulesTab.e9d931d6` | 写死 | 新增套餐 | 按钮 | [PriceRulesTab.tsx:1219](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1219)、1231、1676 行 |
| `PriceRulesTab.88fe3fde` | 写死 | 先加一个套餐 | 标题 | [PriceRulesTab.tsx:1226](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1226) |
| `PriceRulesTab.8daeea8c` | 写死 | 包车卖的是套餐，例如「10 小时 / 300 公里」。加了套餐，下面会列出每个区域和车型组，等你填套餐价。 | 正文 | [PriceRulesTab.tsx:1227](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1227) |
| `PriceRulesTab.c16a2d5d` | 写死 | 包车卖的是套餐，例如「10 小时 / 300 公里」。加了套餐，下面会列出每个车型组，等你填套餐价（整个商品只填一次）。 | 正文 | [PriceRulesTab.tsx:1227](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1227) |
| `PriceRulesTab.5042ac0f` | 写死 | 还没有设价格 | 标题 | [PriceRulesTab.tsx:1241](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1241) |
| `PriceRulesTab.4e6b1e6d` | 写死 | {total} 个组合都有价格 | 正文 | [PriceRulesTab.tsx:1245](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1245) |
| `PriceRulesTab.ed9261ef` | 写死 | {total} 个组合里 {priced} 个有价格， | 正文 | [PriceRulesTab.tsx:1249](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1249) |
| `PriceRulesTab.168b66f4` | 写死 | {missing} 个没有价格 | 正文 | [PriceRulesTab.tsx:1252](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1252) |
| `PriceRulesTab.2456402a` | 写死 | 收起覆盖表 | 按钮 | [PriceRulesTab.tsx:1258](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1258) |
| `PriceRulesTab.5b95b0d3` | 写死 | 展开覆盖表 | 按钮 | [PriceRulesTab.tsx:1258](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1258) |
| `PriceRulesTab.a3a3f7f1` | 写死 | 没有价格的组合，客人询价时报不出价。 | 正文 | [PriceRulesTab.tsx:1261](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1261) |
| `PriceRulesTab.d2cd1826` | 写死 | 在下面的表格里填。每一行是一个组合，填上价格、点保存就行。 | 正文 | [PriceRulesTab.tsx:1261](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1261) |
| `PriceRulesTab.da2df149` | 写死 | 供应商还没有给任何组合设价格。 | 正文 | [PriceRulesTab.tsx:1261](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1261) |
| `PriceRulesTab.f2f49b0d` | 写死 | 看哪个 | 表单标签 | [PriceRulesTab.tsx:1266](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1266) |
| `PriceRulesTab.3509cc13` | 写死 | 看： | 正文 | [PriceRulesTab.tsx:1267](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1267) |
| `PriceRulesTab.914193c5` | 写死 | （缺 {…}） | 正文 | [PriceRulesTab.tsx:1271](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1271) |
| `PriceRulesTab.c59b0640` | 写死 | 覆盖表 | 读屏说明 | [PriceRulesTab.tsx:1276](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1276) |
| `PriceRulesTab.b3a4b7f0` | 写死 | 各区域、各车型组的价格（{currency}） | 正文 | [PriceRulesTab.tsx:1278](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1278) |
| `PriceRulesTab.6d58ec6f` | 写死 | 没有价格 | 名称 | [PriceRulesTab.tsx:1299](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1299)、1307 行 |
| `PriceRulesTab.bd2e493d` | 写死 | {text}，{text}{…}：{…}。到价格表里看这一行 | 名称 | [PriceRulesTab.tsx:1299](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1299) |
| `PriceRulesTab.bd1bc848` | 写死 | 通用价 | 正文 | [PriceRulesTab.tsx:1311](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1311) |
| `PriceRulesTab.38032d00` | 写死 | {from} 起 | 正文 | [PriceRulesTab.tsx:1312](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1312) |
| `PriceRulesTab.3051f870` | 写死 | 未保存 | 正文 | [PriceRulesTab.tsx:1313](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1313) |
| `PriceRulesTab.a74ed95c` | 写死 | 区域 | 正文 | [PriceRulesTab.tsx:1330](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1330)、1419 行 |
| `PriceRulesTab.f05829ff` | 写死 | 全部 | 选项 | [PriceRulesTab.tsx:1332](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1332)、1344、1515 行 |
| `PriceRulesTab.d8da1389` | 写死 | 车型组 | 正文 | [PriceRulesTab.tsx:1342](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1342)、1420、1513、1546 行 |
| `PriceRulesTab.d60b3e22` | 写死 | 只看没有价格的 | 正文 | [PriceRulesTab.tsx:1354](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1354) |
| `PriceRulesTab.8b84ddd7` | 写死 | 显示已过期的{…} | 正文 | [PriceRulesTab.tsx:1358](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1358) |
| `PriceRulesTab.a40c232d` | 写死 | （{hiddenExpired} 条） | 正文 | [PriceRulesTab.tsx:1358](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1358) |
| `PriceRulesTab.4b078964` | 写死 | 正在准备文件… | 文字 | [PriceRulesTab.tsx:1366](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1366) |
| `PriceRulesTab.fd8e06d2` | 写死 | 导入 / 导出 | 正文 | [PriceRulesTab.tsx:1370](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1370) |
| `PriceRulesTab.9aa67748` | 写死 | 下载空白模版 | 正文 | [PriceRulesTab.tsx:1377](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1377) |
| `PriceRulesTab.09caf6b0` | 写死 | 导出现有的价格（还没有价格） | 正文 | [PriceRulesTab.tsx:1381](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1381) |
| `PriceRulesTab.dfe57f8d` | 写死 | 导出现有的价格（{length} 条） | 正文 | [PriceRulesTab.tsx:1381](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1381) |
| `PriceRulesTab.b0ed5922` | 写死 | 不含你没保存的修改 | 正文 | [PriceRulesTab.tsx:1382](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1382) |
| `PriceRulesTab.f88b14fd` | 写死 | 导入价格… | 正文 | [PriceRulesTab.tsx:1389](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1389) |
| `PriceRulesTab.95086b33` | 写死 | 「含公里数」「超出每公里」选填，只有一口价能填，两格要一起填。报价时按客人这一单的路线距离算，超出的部分不足 1 公里按 1 公里，加进一口价（和「里程 + 时长」的按比例不同）。 | 正文 | [PriceRulesTab.tsx:1398](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1398) |
| `PriceRulesTab.b1ce542a` | 写死 | 没有符合条件的价格 | 标题 | [PriceRulesTab.tsx:1402](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1402) |
| `PriceRulesTab.06d203a0` | 写死 | 换个条件试试。 | 正文 | [PriceRulesTab.tsx:1403](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1403) |
| `PriceRulesTab.5007cc14` | 写死 | 清空筛选 | 按钮 | [PriceRulesTab.tsx:1412](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1412)、1539 行 |
| `PriceRulesTab.d7298ecf` | 写死 | 套餐价：按车型组 × 套餐填一次，整个商品通用，没有价格的组合空着等填 | 正文 | [PriceRulesTab.tsx:1416](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1416) |
| `PriceRulesTab.f3e6c541` | 写死 | 价格表：每一行是一条价格，没有价格的组合空着等填 | 正文 | [PriceRulesTab.tsx:1416](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1416) |
| `PriceRulesTab.7adf40d6` | 写死 | 方向 | 表头 | [PriceRulesTab.tsx:1421](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1421) |
| `PriceRulesTab.d805905d` | 写死 | 套餐 | 表头 | [PriceRulesTab.tsx:1422](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1422) |
| `PriceRulesTab.233dde13` | 写死 | 计价方式 | 表头 | [PriceRulesTab.tsx:1423](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1423)、1547 行 |
| `PriceRulesTab.4524cf08` | 写死 | 生效日期 从 | 表头 | [PriceRulesTab.tsx:1429](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1429)、1553 行 |
| `PriceRulesTab.a8e514f4` | 写死 | 现在怎么样 | 表头 | [PriceRulesTab.tsx:1432](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1432)、1556 行 |
| `PriceRulesTab.c6a837c5` | 写死 | 操作 | 正文 | [PriceRulesTab.tsx:1435](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1435)、1559 行 |
| `PriceRulesTab.c25cf868` | 写死 | 这一行的意思： | 正文 | [PriceRulesTab.tsx:1447](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1447)、1569 行 |
| `PriceRulesTab.38fe3740` | 写死 | 线路价 | 标题 | [PriceRulesTab.tsx:1457](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1457) |
| `PriceRulesTab.e02737e4` | 写死 | 这个商品只有一个服务区域，没有跨区域的线路。要设线路价，先在第 ① 步多选一个服务区域。 | 正文 | [PriceRulesTab.tsx:1466](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1466) |
| `PriceRulesTab.b0221207` | 写死 | 去第 ① 步选 | 链接 | [PriceRulesTab.tsx:1469](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1469) |
| `PriceRulesTab.31eb029c` | 写死 | 服务线路 | 正文 | [PriceRulesTab.tsx:1474](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1474) |
| `PriceRulesTab.a64f8e21` | 写死 | 确认添加 | 按钮 | [PriceRulesTab.tsx:1489](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1489) |
| `PriceRulesTab.3680999a` | 写死 | 新增自定义区域 | 链接 | [PriceRulesTab.tsx:1500](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1500) |
| `PriceRulesTab.a406b22b` | 写死 | 新区域要先在第 ① 步加进这个商品。 | 正文 | [PriceRulesTab.tsx:1504](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1504) |
| `PriceRulesTab.1718eb53` | 写死 | 还没有线路价，每条线路都用上面的区域价。 | 正文 | [PriceRulesTab.tsx:1508](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1508) |
| `PriceRulesTab.1c931c9d` | 写死 | 还没有线路价，每条线路都用上面的区域价。某条线路要单独定价（例如市区到机场，去和回不一样的价），在上面选上车区域和下车区域，点「确认添加」。 | 正文 | [PriceRulesTab.tsx:1508](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1508) |
| `PriceRulesTab.3a3c945c` | 写死 | 线路价的车型组 | 读屏说明 | [PriceRulesTab.tsx:1514](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1514) |
| `PriceRulesTab.5aed0ef7` | 写死 | （{routeExpiredCount} 条） | 正文 | [PriceRulesTab.tsx:1525](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1525) |
| `PriceRulesTab.8cb3871d` | 写死 | 显示已过期的线路价{…} | 正文 | [PriceRulesTab.tsx:1525](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1525) |
| `PriceRulesTab.c5b440aa` | 写死 | 没有符合条件的线路价 | 标题 | [PriceRulesTab.tsx:1531](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1531) |
| `PriceRulesTab.1fb599ea` | 写死 | 线路价：按线路分组，每一行是一条线路价（只管这一个方向） | 正文 | [PriceRulesTab.tsx:1543](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1543) |
| `PriceRulesTab.1af02f66` | 写死 | 价格（{currency}） | 表头 | [PriceRulesTab.tsx:1550](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1550) |
| `PriceRulesTab.40b325aa` | 写死 | 经停点落在这些区域时加钱：每个区域一单只收一次，不同区域叠加；上车或下车在同一区域也照收。按车型组填一个金额，{emptyCell}（经停在这里时这个车型组不报价，不加钱请填 0）。商品的基础价区域也可以设。 | 说明 | [PriceRulesTab.tsx:1582](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1582) |
| `PriceRulesTab.41e4e566` | 写死 | 上车点、下车点落在这些区域时加钱（离市区远、要空驶的范围）：上车、下车各收一次，同一区域也各收一次。在商品的基础价区域里上下车不加价，所以基础价区域不能设上下车加价。{emptyCell}（不加钱请填 0）。迁移前的途经加价已经搬到「行程加价」。 | 说明 | [PriceRulesTab.tsx:1601](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1601) |
| `PriceRulesTab.a813f19d` | 写死 | 取消 | 按钮 | [PriceRulesTab.tsx:1682](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1682)、1718 行 |
| `PriceRulesTab.fdd2b35a` | 写死 | 新增 | 按钮 | [PriceRulesTab.tsx:1685](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1685) |
| `PriceRulesTab.5fd30a61` | 写死 | 套餐时长（小时） | 表单标签 | [PriceRulesTab.tsx:1696](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1696) |
| `PriceRulesTab.831a3e71` | 写死 | 套餐公里（公里） | 表单标签 | [PriceRulesTab.tsx:1696](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1696) |
| `PriceRulesTab.725f10d6` | 写死 | 先给这个套餐的每一行都填上这个公里数，之后可以在表格里一行一行改。 | 正文 | [PriceRulesTab.tsx:1703](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1703) |
| `PriceRulesTab.dabd73c8` | 写死 | 删除 {…} 小时套餐？ | 标题 | [PriceRulesTab.tsx:1712](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1712) |
| `PriceRulesTab.c7480c25` | 写死 | 标成将删除 | 按钮 | [PriceRulesTab.tsx:1721](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1721) |
| `PriceRulesTab.01d092b5` | 写死 | 这个套餐下的 {length} 条价格会标成「将删除」，点保存后才真的删除。 | 正文 | [PriceRulesTab.tsx:1725](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx#L1725) |

## 多个页面共用：③ 价格规则（PricesStep.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/PricesStep.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `PricesStep.ce3bca73` | 写死 | 价格规则 | 名称 | [PricesStep.tsx:76](../../apps/web/src/pages/products/prices/PricesStep.tsx#L76) |
| `PricesStep.bedc3436` | 写死 | 缺 {missing} | 正文 | [PricesStep.tsx:82](../../apps/web/src/pages/products/prices/PricesStep.tsx#L82) |
| `PricesStep.d0836094` | 写死 | 调价规则 | 名称 | [PricesStep.tsx:88](../../apps/web/src/pages/products/prices/PricesStep.tsx#L88) |
| `PricesStep.3de9c15f` | 写死 | 价格日历 | 名称 | [PricesStep.tsx:89](../../apps/web/src/pages/products/prices/PricesStep.tsx#L89) |
| `PricesStep.4ffa2f7e` | 写死 | 服务区域和车型组 | 文字 | [PricesStep.tsx:101](../../apps/web/src/pages/products/prices/PricesStep.tsx#L101) |
| `PricesStep.b4bae3e0` | 写死 | 车型组 | 文字 | [PricesStep.tsx:101](../../apps/web/src/pages/products/prices/PricesStep.tsx#L101) |
| `PricesStep.f72eedd0` | 写死 | 服务区域 | 文字 | [PricesStep.tsx:101](../../apps/web/src/pages/products/prices/PricesStep.tsx#L101) |
| `PricesStep.b846be17` | 写死 | 先选服务区域和车型组 | 标题 | [PricesStep.tsx:106](../../apps/web/src/pages/products/prices/PricesStep.tsx#L106) |
| `PricesStep.64874b2d` | 写死 | 价格是按「区域 × 车型组」一格一格设的。这个商品还没有选{lacks}。 | 说明 | [PricesStep.tsx:107](../../apps/web/src/pages/products/prices/PricesStep.tsx#L107) |
| `PricesStep.24a03a47` | 写死 | 去第 ① 步看 | 按钮 | [PricesStep.tsx:110](../../apps/web/src/pages/products/prices/PricesStep.tsx#L110) |
| `PricesStep.72f44bd5` | 写死 | 去第 ① 步选 | 按钮 | [PricesStep.tsx:110](../../apps/web/src/pages/products/prices/PricesStep.tsx#L110) |
| `PricesStep.6268594d` | 写死 | ③ 价格规则 | 标题 | [PricesStep.tsx:128](../../apps/web/src/pages/products/prices/PricesStep.tsx#L128) |
| `PricesStep.6a13030f` | 写死 | 金额都是 | 正文 | [PricesStep.tsx:135](../../apps/web/src/pages/products/prices/PricesStep.tsx#L135) |
| `PricesStep.d5e52214` | 写死 | 结算价 | 正文 | [PricesStep.tsx:135](../../apps/web/src/pages/products/prices/PricesStep.tsx#L135) |
| `PricesStep.f95d3c6f` | 写死 | ，币种 | 正文 | [PricesStep.tsx:135](../../apps/web/src/pages/products/prices/PricesStep.tsx#L135) |
| `PricesStep.32ea06a6` | 写死 | 调价后的结算价取整到  | 正文 | [PricesStep.tsx:136](../../apps/web/src/pages/products/prices/PricesStep.tsx#L136) |
| `PricesStep.436193d8` | 写死 | （最多 {digits} 位小数） | 正文 | [PricesStep.tsx:136](../../apps/web/src/pages/products/prices/PricesStep.tsx#L136) |
| `PricesStep.5627a29f` | 写死 | 调价后的结算价四舍五入到  | 正文 | [PricesStep.tsx:136](../../apps/web/src/pages/products/prices/PricesStep.tsx#L136) |
| `PricesStep.cb5270ba` | 写死 | （{…}没有小数） | 正文 | [PricesStep.tsx:136](../../apps/web/src/pages/products/prices/PricesStep.tsx#L136) |
| `PricesStep.6c63c8c6` | 写死 | 修改取整单位 | 读屏说明 | [PricesStep.tsx:140](../../apps/web/src/pages/products/prices/PricesStep.tsx#L140) |
| `PricesStep.ac369ab9` | 写死 | 修改 | 按钮 | [PricesStep.tsx:142](../../apps/web/src/pages/products/prices/PricesStep.tsx#L142) |
| `PricesStep.c4efbc28` | 写死 | · 日期按 | 正文 | [PricesStep.tsx:144](../../apps/web/src/pages/products/prices/PricesStep.tsx#L144) |
| `PricesStep.322148b1` | 写死 | {…}当地时间 | 正文 | [PricesStep.tsx:145](../../apps/web/src/pages/products/prices/PricesStep.tsx#L145) |
| `PricesStep.5bff6ed4` | 写死 | 价格规则的分区 | 读屏说明 | [PricesStep.tsx:148](../../apps/web/src/pages/products/prices/PricesStep.tsx#L148) |

## 多个页面共用：修改取整单位（RoundingUnitDialog.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/RoundingUnitDialog.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `RoundingUnitDialog.9e063bfd` | 写死 | 子品牌的设置没有加载出来，请关闭后重试。 | 文字 | [RoundingUnitDialog.tsx:44](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L44) |
| `RoundingUnitDialog.5d0b165a` | 写死 | 已保存取整单位，有 {…} 条价格取整后的数变了 | 提示 | [RoundingUnitDialog.tsx:57](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L57) |
| `RoundingUnitDialog.6c42cabb` | 写死 | 已保存取整单位 | 提示 | [RoundingUnitDialog.tsx:57](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L57) |
| `RoundingUnitDialog.ff2b7076` | 写死 | 这个子品牌刚被别人修改过。已经载入最新的设置，请确认后再保存。 | 文字 | [RoundingUnitDialog.tsx:68](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L68) |
| `RoundingUnitDialog.e6c15c05` | 写死 | 这个子品牌刚被别人修改过，最新的设置没有加载出来。请关闭后重试。 | 文字 | [RoundingUnitDialog.tsx:70](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L70) |
| `RoundingUnitDialog.173cce70` | 写死 | 不能改成 {…}：这个子品牌下有{…}价格取整后会变成 0，报不出价{…}。请选小一点的取整单位，或先把这些价格改大。 | 文字 | [RoundingUnitDialog.tsx:85](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L85) |
| `RoundingUnitDialog.2583362d` | 写死 |  {…} 条 | 文字 | [RoundingUnitDialog.tsx:85](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L85) |
| `RoundingUnitDialog.c5b0d599` | 写死 | （其中 {…} 个商品已上架） | 文字 | [RoundingUnitDialog.tsx:85](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L85) |
| `RoundingUnitDialog.db2ee582` | 写死 | 你没有权限修改取整单位。 | 文字 | [RoundingUnitDialog.tsx:86](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L86) |
| `RoundingUnitDialog.3fa9958f` | 写死 | 保存 | 文字 | [RoundingUnitDialog.tsx:87](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L87)、111 行 |
| `RoundingUnitDialog.b9883295` | 写死 | 不另外取整（{…}） | 名称 | [RoundingUnitDialog.tsx:93](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L93) |
| `RoundingUnitDialog.59b67fb1` | 写死 | 修改取整单位 | 标题 | [RoundingUnitDialog.tsx:100](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L100) |
| `RoundingUnitDialog.b220b72e` | 写死 | 取消 | 按钮 | [RoundingUnitDialog.tsx:108](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L108) |
| `RoundingUnitDialog.b04bf365` | 写死 | 保存中… | 文字 | [RoundingUnitDialog.tsx:109](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L109) |
| `RoundingUnitDialog.752f2d08` | 写死 | 商品 | 链接 | [RoundingUnitDialog.tsx:124](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L124) |
| `RoundingUnitDialog.829d90db` | 写死 | {code}（{…}）：{…} 条价格 | 链接 | [RoundingUnitDialog.tsx:124](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L124) |
| `RoundingUnitDialog.2ccecb6b` | 写死 | 还有 {…} 个商品 | 正文 | [RoundingUnitDialog.tsx:127](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L127) |
| `RoundingUnitDialog.ad045bfb` | 写死 | 这是子品牌「{brandName}」的设置。 | 正文 | [RoundingUnitDialog.tsx:134](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L134) |
| `RoundingUnitDialog.001fa72c` | 写死 | 这个子品牌下的所有商品都会跟着变，已上架的商品也一样。 | 正文 | [RoundingUnitDialog.tsx:135](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L135) |
| `RoundingUnitDialog.14500740` | 写死 | 取整到 | 表单标签 | [RoundingUnitDialog.tsx:140](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L140) |
| `RoundingUnitDialog.3e8bb210` | 写死 | 调价后的结算价只按币种的最小单位四舍五入，不另外取整。 | 正文 | [RoundingUnitDialog.tsx:152](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L152) |
| `RoundingUnitDialog.7f2882e4` | 写死 | 例：{…} → {…}；{…} → {…}。四舍五入，正好一半时往大的取。 | 正文 | [RoundingUnitDialog.tsx:152](../../apps/web/src/pages/products/prices/RoundingUnitDialog.tsx#L152) |

## 多个页面共用：点对点「线路价」的选线路和两个对话框（RouteDialogs.tsx）

用在：供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/prices/RouteDialogs.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `RouteDialogs.999beef7` | 写死 | 上车区域 | 正文 | [RouteDialogs.tsx:43](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L43) |
| `RouteDialogs.e03e39a6` | 写死 | 选择区域 | 选项 | [RouteDialogs.tsx:45](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L45)、60 行 |
| `RouteDialogs.c126106b` | 写死 | 下车区域 | 正文 | [RouteDialogs.tsx:58](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L58) |
| `RouteDialogs.ef1a7665` | 写死 | {name}（同一个区域用区域价） | 选项 | [RouteDialogs.tsx:63](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L63) |
| `RouteDialogs.04e680f4` | 写死 | 分钟 | 文字 | [RouteDialogs.tsx:114](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L114) |
| `RouteDialogs.1e6664d9` | 写死 | 公里 | 文字 | [RouteDialogs.tsx:114](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L114)、189 行 |
| `RouteDialogs.aa5bb970` | 写死 |  / 公里 | 文字 | [RouteDialogs.tsx:114](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L114) |
| `RouteDialogs.e969b250` | 写死 |  / 分钟 | 文字 | [RouteDialogs.tsx:114](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L114) |
| `RouteDialogs.39cff38c` | 写死 | 新增线路价：{name} | 标题 | [RouteDialogs.tsx:150](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L150) |
| `RouteDialogs.128be64c` | 写死 | 取消 | 按钮 | [RouteDialogs.tsx:157](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L157)、288 行 |
| `RouteDialogs.3326288b` | 写死 | 添加到表里 | 按钮 | [RouteDialogs.tsx:160](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L160) |
| `RouteDialogs.52534087` | 写死 | 车型组 | 标题 | [RouteDialogs.tsx:167](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L167) |
| `RouteDialogs.3ddd48c7` | 写死 | （已有线路价） | 文字 | [RouteDialogs.tsx:170](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L170) |
| `RouteDialogs.f701a3e7` | 写死 | 计价方式 | 表单标签 | [RouteDialogs.tsx:176](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L176) |
| `RouteDialogs.6c0962ab` | 写死 | 一口价 | 正文 | [RouteDialogs.tsx:180](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L180) |
| `RouteDialogs.6f4936d9` | 写死 | {…}上车、{…}下车，每单收多少 | 说明 | [RouteDialogs.tsx:187](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L187) |
| `RouteDialogs.972a1d93` | 写死 | 价格 | 名称 | [RouteDialogs.tsx:187](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L187)、313 行 |
| `RouteDialogs.6df9beb8` | 写死 | 返程价格（{back}） | 名称 | [RouteDialogs.tsx:188](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L188) |
| `RouteDialogs.8e139b87` | 写死 | 选填。{RETURN\_HELP} | 说明 | [RouteDialogs.tsx:188](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L188) |
| `RouteDialogs.4adc0f61` | 写死 | 含公里数 | 名称 | [RouteDialogs.tsx:189](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L189) |
| `RouteDialogs.a7beac20` | 写死 | 选填，和「超出每公里」一起填。{INCLUDED\_KM\_HELP} | 说明 | [RouteDialogs.tsx:189](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L189) |
| `RouteDialogs.1a1f272a` | 写死 | {currency} / 公里 | 文字 | [RouteDialogs.tsx:190](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L190) |
| `RouteDialogs.85ed340c` | 写死 | 超出每公里 | 名称 | [RouteDialogs.tsx:190](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L190) |
| `RouteDialogs.31f3bd22` | 写死 | 选填 | 说明 | [RouteDialogs.tsx:204](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L204) |
| `RouteDialogs.f2bd55a8` | 写死 | 不足 1 公里按比例 | 说明 | [RouteDialogs.tsx:204](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L204) |
| `RouteDialogs.57cab1ab` | 写死 | 里程 + 时长的线路价没有返程价格和含公里数。要反方向，添加后在这条线路上点「建返程」（复制成反方向）。 | 正文 | [RouteDialogs.tsx:209](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L209) |
| `RouteDialogs.90fd5992` | 写死 | 生效日期 | 表单标签 | [RouteDialogs.tsx:213](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L213) |
| `RouteDialogs.b89cef07` | 写死 | 从 | 表单标签 | [RouteDialogs.tsx:215](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L215) |
| `RouteDialogs.ecea91db` | 写死 | 年-月-日 | 输入框占位 | [RouteDialogs.tsx:216](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L216) |
| `RouteDialogs.017c0732` | 写死 | 到 | 表单标签 | [RouteDialogs.tsx:219](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L219) |
| `RouteDialogs.790516ed` | 写死 | 一直有效 | 输入框占位 | [RouteDialogs.tsx:220](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L220) |
| `RouteDialogs.d0892a61` | 写死 | 启用 | 正文 | [RouteDialogs.tsx:227](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L227) |
| `RouteDialogs.32230e46` | 写死 | {…} 会和已有的线路价日期重叠。仍然可以添加，到表里再改日期。 | 正文 | [RouteDialogs.tsx:231](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L231) |
| `RouteDialogs.8d60d881` | 写死 | 去程里有 {overlapOut} 条 | 正文 | [RouteDialogs.tsx:231](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L231) |
| `RouteDialogs.8fbdfbcc` | 写死 | 返程里有 {overlapBack} 条 | 正文 | [RouteDialogs.tsx:231](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L231) |
| `RouteDialogs.15998097` | 写死 | 这次会加 {total} 条，加上还没保存的 {pending} 条超过了一次最多保存的 {maxBatchChanges} 条。请先保存，或少勾几个车型组。 | 正文 | [RouteDialogs.tsx:238](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L238) |
| `RouteDialogs.5980d2f0` | 写死 | 复制线路：{…} → {…} | 标题 | [RouteDialogs.tsx:281](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L281) |
| `RouteDialogs.c5ad1fb4` | 写死 | 复制线路 | 标题 | [RouteDialogs.tsx:281](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L281) |
| `RouteDialogs.7ca5a063` | 写死 | 复制 | 按钮 | [RouteDialogs.tsx:291](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L291) |
| `RouteDialogs.1687c298` | 写死 | 复制到 | 表单标签 | [RouteDialogs.tsx:298](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L298) |
| `RouteDialogs.cb7d0834` | 写死 | 换成反方向 | 按钮 | [RouteDialogs.tsx:303](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L303) |
| `RouteDialogs.11c0d45a` | 写死 | 复制哪些车型组 | 标题 | [RouteDialogs.tsx:311](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L311) |
| `RouteDialogs.be18f981` | 写死 | 原样复制 | 正文 | [RouteDialogs.tsx:316](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L316) |
| `RouteDialogs.4bc565c5` | 写死 | 复制时上调 | 正文 | [RouteDialogs.tsx:317](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L317) |
| `RouteDialogs.2bca9499` | 写死 | 复制时下调 | 正文 | [RouteDialogs.tsx:318](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L318) |
| `RouteDialogs.0665205e` | 写死 | 按比例 | 正文 | [RouteDialogs.tsx:330](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L330) |
| `RouteDialogs.194e6fef` | 写死 | 按金额 | 正文 | [RouteDialogs.tsx:334](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L334) |
| `RouteDialogs.8ded26be` | 写死 | 调整的金额（{currency}） | 读屏说明 | [RouteDialogs.tsx:337](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L337) |
| `RouteDialogs.f0380641` | 写死 | 调整的百分比 | 读屏说明 | [RouteDialogs.tsx:337](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L337) |
| `RouteDialogs.415771ad` | 写死 | 只调价格（起步价）；含公里数、超出每公里和其他的数原样复制。生效日期、启用也原样。 | 正文 | [RouteDialogs.tsx:345](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L345) |
| `RouteDialogs.f090b1ad` | 写死 | 目标线路已经有价格时 | 表单标签 | [RouteDialogs.tsx:348](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L348) |
| `RouteDialogs.e428b830` | 写死 | 跳过 | 正文 | [RouteDialogs.tsx:351](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L351) |
| `RouteDialogs.e12c92f6` | 写死 | 换成复制过去的 | 正文 | [RouteDialogs.tsx:355](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L355) |
| `RouteDialogs.9a4bf374` | 写死 | 没有可以填的线路价。 | 正文 | [RouteDialogs.tsx:360](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L360) |
| `RouteDialogs.5245dd5a` | 写死 | 加上还没保存的 {pending} 条超过了一次最多保存的 {maxBatchChanges} 条。请先保存。 | 正文 | [RouteDialogs.tsx:362](../../apps/web/src/pages/products/prices/RouteDialogs.tsx#L362) |

## 多个页面共用：商品的下架（useProductActions.tsx）

用在：供应商后台 · 商品列表；供应商后台 · 商品编辑；运营后台 · 商品（只读查看）

文件：`apps/web/src/pages/products/useProductActions.tsx`

| key | 状态 | 中文 | 类型 | 位置 |
| --- | --- | --- | --- | --- |
| `useProductActions.6bfa43b5` | 写死 | 已下架「{…}」 | 提示 | [useProductActions.tsx:53](../../apps/web/src/pages/products/useProductActions.tsx#L53) |
| `useProductActions.b9c083d6` | 写死 | 已删除草稿「{…}」 | 提示 | [useProductActions.tsx:58](../../apps/web/src/pages/products/useProductActions.tsx#L58) |
| `useProductActions.25e2d7ac` | 写死 | 删除 | 文字 | [useProductActions.tsx:62](../../apps/web/src/pages/products/useProductActions.tsx#L62)、90、154 行 |
| `useProductActions.90e63c68` | 写死 | 下架 | 文字 | [useProductActions.tsx:62](../../apps/web/src/pages/products/useProductActions.tsx#L62)、90、159 行 |
| `useProductActions.aa55468f` | 写死 | 「{name}」已经被别人删除了。 | 文字 | [useProductActions.tsx:66](../../apps/web/src/pages/products/useProductActions.tsx#L66) |
| `useProductActions.b75a82fa` | 写死 | 这个商品已经上过架，不再是草稿。不想卖的话可以下架。 | 文字 | [useProductActions.tsx:68](../../apps/web/src/pages/products/useProductActions.tsx#L68) |
| `useProductActions.0e5f12ca` | 写死 | {verb}没有成功。{…} | 文字 | [useProductActions.tsx:75](../../apps/web/src/pages/products/useProductActions.tsx#L75) |
| `useProductActions.4e3419f9` | 写死 | 删除草稿「{name}」？ | 标题 | [useProductActions.tsx:94](../../apps/web/src/pages/products/useProductActions.tsx#L94) |
| `useProductActions.744fb7fb` | 写死 | 下架「{name}」？ | 标题 | [useProductActions.tsx:94](../../apps/web/src/pages/products/useProductActions.tsx#L94) |
| `useProductActions.0bea47ee` | 写死 | 知道了 | 按钮 | [useProductActions.tsx:102](../../apps/web/src/pages/products/useProductActions.tsx#L102) |
| `useProductActions.785a720a` | 写死 | 取消 | 按钮 | [useProductActions.tsx:107](../../apps/web/src/pages/products/useProductActions.tsx#L107) |
| `useProductActions.2a8ce401` | 写死 | {verb}中… | 文字 | [useProductActions.tsx:108](../../apps/web/src/pages/products/useProductActions.tsx#L108) |
| `useProductActions.21f602a6` | 写死 | 现在不能{verb}。 | 正文 | [useProductActions.tsx:118](../../apps/web/src/pages/products/useProductActions.tsx#L118) |
| `useProductActions.88d4aab6` | 写死 | 删除后不能恢复。这个商品已经填好的基础信息、服务规则和商品详情会一起删除。 | 正文 | [useProductActions.tsx:126](../../apps/web/src/pages/products/useProductActions.tsx#L126) |
| `useProductActions.1d7fa69f` | 写死 | 下架后，这个商品不再参与报价，不会再有新订单。 | 正文 | [useProductActions.tsx:129](../../apps/web/src/pages/products/useProductActions.tsx#L129) |
| `useProductActions.2d8bc7a7` | 写死 | 之后可以重新上架，重新上架时会再检查一遍。 | 正文 | [useProductActions.tsx:129](../../apps/web/src/pages/products/useProductActions.tsx#L129) |
| `useProductActions.f75497ce` | 写死 | 已经接到的订单不受影响，仍然要照常履约。 | 正文 | [useProductActions.tsx:129](../../apps/web/src/pages/products/useProductActions.tsx#L129) |
| `useProductActions.caefd175` | 写死 | 上架检查 | 正文 | [useProductActions.tsx:149](../../apps/web/src/pages/products/useProductActions.tsx#L149) |
