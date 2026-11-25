# ADR 0109：M11 之前客人界面一律中文（嵌入入口小程序、嵌入页外层不按 lang 出日文、英文）

- 状态：已采纳（2026-11-25，M12-01）
- 依据：业主 2026-11-25（#288）：先不做翻译、按中文版上线，M11 多语言整体延后。
- **暂停** ADR 0095 第四节第 3 小节「多语言」里「嵌入页按 `lang` 参数选语言」的显示部分，直到 M11；该节其余决定（语言类型、`resolveLang`、按语言分的文案表、`lang` 参数的写法和校验、postMessage 协议）不变。
- 补充 ADR 0108：嵌入组件的地址提示、取坐标带 `lang`（页面语言）时，带的是实际显示的语言。

## 问题

嵌入入口小程序（`widget-ui.ts`、`widget-booking.ts`）和嵌入预订页外层（`EmbedFrame.tsx`、`embed-texts.ts`）按 `lang` 显示中 / 日 / 英，没传时默认日文；中间复用的 `/book` 四步、订单页、付款只有中文。日文宿主页上会中日混排。

## 决定

1. **一个开关**：`packages/domain/src/guest-ui-language.ts` 的 `GUEST_UI.languages`（默认 `GUEST_UI_LANGUAGES = ["zh"]`）和 `guestUiLanguage(请求的语言)`——请求的语言开放了就用它，没开放退回 `zh`。嵌入组件脚本单独引这个文件（`@nozomi/domain/guest-ui-language`，不依赖别的模块）。
2. **经过开关的地方**：查价表单（`widget-ui.ts`，含取配置被拒时的「暂时无法使用」、日期时间和人数的格式、建草稿时草稿里的 `lang`）、宿主页上 iframe 外层（`widget-booking.ts` 的 iframe 标题、打不开 / 已过期的提示）、嵌入页外层（`EmbedFrame.tsx` 的文案、`<main lang>`、Stripe 付款表单的 `locale`、`ready` 消息里的 `lang`）。
3. **不变的**：`init` / `mountBooking` 的 `lang` 照常接收、照常按 `zh` / `ja` / `en` 校验；iframe 地址照传合作网站给的 `lang`（嵌入页自己过开关）；嵌入码的「默认语言」照常保存；日文、英文文案原样保留。
4. **`ready` 的 `lang` = 实际显示的语言**（M11 之前总是 `zh`）。理由：ADR 0095 第六节把它定义为嵌入页的语言；字段、取值范围（两个小写字母，`zh` / `ja` / `en` 之一）都不变，宿主那边的 `widget-v1.js` 只用 `ready` 取消 15 秒后备、不读 `lang`，`ready` 也不转给合作网站的 `onEvent`（只转 `step`、`completed`、`error`），所以不会破坏任何宿主；报实际显示的语言，以后谁读它都不会被误导。
5. **地址搜索的页面语言**：嵌入组件的 `/embed/v1/places/autocomplete`、`/details` 带 `lang=<实际显示的语言>`（M11 之前是 `zh`）。不带时服务端会用嵌入码的默认语言（常是 `ja`），判断不出输入语言的关键字（「新宿」）就会返回日文，和中文界面不一致。主站 `/site/v1/places/*` 不带 `lang`，服务端按 `zh`，和客人界面语言一致，不改。
6. **邮件 / 通知**：模板本来只有中文（`NOTIFICATION_LOCALES = ["zh-CN"]`，发送时固定 `zh-CN`），不经过这个开关。
7. **页面上的语言切换**：主站、嵌入页都没有语言切换；运营后台嵌入码的「默认语言」照旧可选（存着给 M11 用）。

## M11 时怎么恢复

把 `GUEST_UI_LANGUAGES` 改成 `["zh", "ja", "en"]`，并把 `/book` 四步、订单页、付款的文案按 ADR 0095 第四节第 3 小节补上日文、英文。组件测试里已经用 `GUEST_UI.languages` 临时放开三种语言，继续覆盖日文、英文界面。
