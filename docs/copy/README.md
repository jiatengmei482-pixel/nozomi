# 固定文案清单

由 `pnpm copy:export` 从代码自动生成（M11-02），**不要手改**；代码里的文案改了，重新运行一次即可。
用 `pnpm copy:export --check` 可以检查这里是不是最新的。

共 12662 条：**写死 12194 条**（直接写在页面代码里，没走 i18n key），已走 key 468 条。

- 用 Excel 看：下载 [copy.csv](copy.csv)，可以按「区域」「页面」「状态」筛选。
- 在 GitHub 上看：点下面的区域，按页面分组，位置可以点开直接看代码。

## 各区域

| 区域 | 条数 | 写死 | 已走 key |
| --- | ---: | ---: | ---: |
| [官网（客人预订）](site.md) | 861 | 635 | 226 |
| [嵌入预订（合作网站上的组件和嵌入页）](embed.md) | 92 | 64 | 28 |
| [司机页](driver.md) | 69 | 69 | 0 |
| [登录和账号（两个后台共用）](account.md) | 98 | 98 | 0 |
| [供应商后台](tenant.md) | 3321 | 3321 | 0 |
| [运营后台](platform.md) | 3935 | 3929 | 6 |
| [前端公共组件和共用文案](shared.md) | 1817 | 1635 | 182 |
| [邮件和通知模板](mail.md) | 197 | 186 | 11 |
| [后端返回的提示（接口错误等）](api.md) | 1450 | 1450 | 0 |
| [前后端共用的业务说法（domain 包）](domain.md) | 822 | 807 | 15 |

## 每一列的意思

| 列 | 意思 |
| --- | --- |
| 区域 | 官网、供应商后台、运营后台、邮件等 |
| 页面 | 文案出现在哪个页面；几个页面共用的写「…共用」，并在「用在」里列出页面 |
| key | 文案的编号。已走 key 的是代码里的 key；写死的是自动生成的编号（文件名 + 短哈希），文字和文件不变编号就不变 |
| 状态 | 「写死」= 直接写在页面代码里；「已走 key」= 放在文案表里按 key 取，以后翻译只改表 |
| 中文 | 文案原文。`{名字}` 是运行时填进去的内容（订单号、金额等），`{…}` 是比较复杂的一段；`{{名字}}` 是邮件模板的变量 |
| 类型 | 标题、按钮、说明、提示、错误提示、邮件主题 / 正文等（按代码推断，仅供参考） |
| 代码线索 | 给开发看的：属性名、变量名、调用的函数或所在标签（只在 CSV 里有） |
| 位置 | 文件和行号；同一个文件里同一句话出现几次，只列一条，行号都写上 |

## 收录范围

- 前端 `apps/web/src`：所有页面、组件、共用文案，嵌入组件脚本（`embed/`）也在内。
- 邮件和通知模板：`packages/domain/src` 里的通知中心模板、登录验证码邮件、司机链接邮件、HTML 邮件外框。
- 后端 `apps/api/src`：接口返回给用户看的说明（错误提示等，前端会直接显示后端给的中文说明）。
- `packages/domain/src`：前后端共用的说法（状态名、原因说明等）。

抽取规则：页面里的文字；`aria-label`、`title`、`placeholder`、`alt`、`label` 等给人看的属性；代码里含中文（以及日文假名、韩文）的字符串和模板字符串。

不收录：测试代码；注释；日志和 `console` 输出；`new Error(...)` 这类给开发看的异常；数据库迁移；命令行工具的输出；
发给外部服务（Google、Stripe、Claude）的内容和 AI 提示词；评测用例；类型里的字符串；`===` 比较的另一边；主站已有的日文、英文译文（只收中文）；
CSS 类名、网址、错误码这类不含中文的字符串（页面文字和上面那些属性除外）。

## 怎么算「已走 key」

符合下面约定的文案表里的条目算「已走 key」，其余都算「写死」。以后的 i18n 公用模块照这个约定写，就能自动认出来：

1. 文件名以 `-copy.ts` / `-texts.ts` 结尾，或放在 `i18n/` 目录下：文件里所有顶层 `const X = { ... }` 都是文案表；
2. 别的文件里名字以 `_COPY` / `_TEXTS` 结尾的顶层常量也是文案表；
3. 按语言分的表（属性名 `zh`、`ja`、`en`…）只取 `zh`；
4. 表的属性名全都带点（如 `tenant.charterAirport.title`）就是全局 key，原样使用；否则 key = 文件名（去掉 `-copy` / `-texts`）+ 常量名 + 属性名。

## 写死文案最多的文件

| 文件 | 写死条数 |
| --- | ---: |
| [apps/web/src/lib/audit-display.ts](../../apps/web/src/lib/audit-display.ts) | 248 |
| [packages/domain/src/price-sheet.ts](../../packages/domain/src/price-sheet.ts) | 229 |
| [apps/web/src/pages/products/prices/PriceRulesTab.tsx](../../apps/web/src/pages/products/prices/PriceRulesTab.tsx) | 203 |
| [apps/web/src/pages/products/prices/AdjustRuleForm.tsx](../../apps/web/src/pages/products/prices/AdjustRuleForm.tsx) | 182 |
| [apps/web/src/pages/book/OrderSections.tsx](../../apps/web/src/pages/book/OrderSections.tsx) | 181 |
| [apps/web/src/pages/platform/ChannelSections.tsx](../../apps/web/src/pages/platform/ChannelSections.tsx) | 178 |
| [apps/web/src/pages/platform/PlatformOrderPages.tsx](../../apps/web/src/pages/platform/PlatformOrderPages.tsx) | 178 |
| [apps/web/src/pages/platform/TicketDetailPage.tsx](../../apps/web/src/pages/platform/TicketDetailPage.tsx) | 176 |
| [apps/web/src/pages/products/ServiceRulesStep.tsx](../../apps/web/src/pages/products/ServiceRulesStep.tsx) | 173 |
| [packages/domain/src/notifications.ts](../../packages/domain/src/notifications.ts) | 172 |
| [apps/web/src/pages/platform/QuotePreviewPage.tsx](../../apps/web/src/pages/platform/QuotePreviewPage.tsx) | 163 |
| [apps/web/src/lib/channel-display.ts](../../apps/web/src/lib/channel-display.ts) | 160 |
| [apps/web/src/pages/products/BasicStep.tsx](../../apps/web/src/pages/products/BasicStep.tsx) | 141 |
| [apps/api/src/services/import-export.ts](../../apps/api/src/services/import-export.ts) | 136 |
| [apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx](../../apps/web/src/pages/products/prices/AreaSurchargeBlock.tsx) | 136 |
| [apps/web/src/pages/platform/SecurityPages.tsx](../../apps/web/src/pages/platform/SecurityPages.tsx) | 134 |
| [apps/web/src/pages/orders/OrderPages.tsx](../../apps/web/src/pages/orders/OrderPages.tsx) | 132 |
| [apps/web/src/pages/products/inventory/InventoryStep.tsx](../../apps/web/src/pages/products/inventory/InventoryStep.tsx) | 132 |
| [apps/web/src/pages/products/inventory/ImportPage.tsx](../../apps/web/src/pages/products/inventory/ImportPage.tsx) | 130 |
| [apps/web/src/pages/book/new/BookNewPage.tsx](../../apps/web/src/pages/book/new/BookNewPage.tsx) | 124 |
| [apps/web/src/pages/areas/AreaEditorPage.tsx](../../apps/web/src/pages/areas/AreaEditorPage.tsx) | 123 |
| [apps/web/src/pages/platform/SettingsPages.tsx](../../apps/web/src/pages/platform/SettingsPages.tsx) | 122 |
| [apps/web/src/pages/platform/FinancePages.tsx](../../apps/web/src/pages/platform/FinancePages.tsx) | 121 |
| [apps/web/src/pages/platform/BankFilePages.tsx](../../apps/web/src/pages/platform/BankFilePages.tsx) | 114 |
| [apps/web/src/pages/platform/RescuePages.tsx](../../apps/web/src/pages/platform/RescuePages.tsx) | 113 |
| [apps/web/src/lib/site-display.ts](../../apps/web/src/lib/site-display.ts) | 108 |
| [apps/web/src/pages/platform/TenantOnboardingSections.tsx](../../apps/web/src/pages/platform/TenantOnboardingSections.tsx) | 106 |
| [apps/web/src/pages/platform/ChannelPages.tsx](../../apps/web/src/pages/platform/ChannelPages.tsx) | 102 |
| [apps/web/src/pages/master/PlaceForm.tsx](../../apps/web/src/pages/master/PlaceForm.tsx) | 101 |
| [apps/api/src/services/products.ts](../../apps/api/src/services/products.ts) | 100 |
