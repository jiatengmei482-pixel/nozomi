# ADR 0100：手机上每一步的按钮固定在屏幕底部（主站 position: fixed；嵌入页按宿主发来的 iframe 位置摆放）

- 状态：已采纳（2026-11-16，M9E-32）。待独立审查。
- 依据：业主验收意见（2026-11-16，iPhone Safari 真机）：
  1. 手机宽度（≤ 768px）下，每一步的主按钮（「下一步：选择车型」「下一步：填写乘客信息」「下一步：核对订单」「去付款 →」）和「上一步」固定悬浮在屏幕底部，不用每步拉到最下面；
  2. 主站 `/book/new` 和嵌入页 `/embed/book` 都要改；嵌入页在 iframe 里，客人在宿主页滚动时按钮也要一直看得见；
  3. 不能挡住表单最后一项和页脚：页面底部留出同样高度，处理 iPhone 安全区 `env(safe-area-inset-bottom)`；
  4. 按钮不能点时保持灰色并显示原因（文字，`aria-describedby` 关联），不要隐藏；
  5. 电脑版（宽屏两栏）布局不变。
- **修改**：ADR 0095 第六节协议表 `viewport` 一行加可选字段 `top`、宿主页滚动时也发（原文已加注）；`docs/design/pages/site-booking-v2.md` 第 0 节、第 3.1 节的手机底部固定条改为本篇的按钮条。M9E-30 定的第 4 步顺序（行程 → 价格明细 → 取消政策 → 最下面同意保存银行卡 + 去付款）不变，只是手机上「去付款」和「上一步」进了底部条。

## 一、背景（2026-11-16 main）

- 断点：`/book/new` 的 `useWideScreen` 是 `(min-width: 1024px)`——≥ 1024 两栏带右侧栏，< 1024 单栏、顶部摘要条。嵌入页量的是 iframe 自己的视口（M9E-27）。
- 按钮：第 1、2、3 步的按钮在各自区块末尾的 `.book-new__actions`；第 2 步 < 1024 时只有「上一步」，「下一步」在另一条 `position: fixed` 的 `book-bar`（「车型 · 一口价 [下一步]」，选了车型才出现）里；第 4 步「去付款」在页面最下面的 `PayBlock`，「上一步」在核对页标题旁（M9E-30）。
- 嵌入页：iframe 被宿主按 `resize` 撑到内容全高，iframe 里的 fixed / sticky 只会贴在内容最末尾，所以 `embed.css` 把 `book-bar` 改成了 `position: static`（放回正文末尾）。宿主 → iframe 只有 `viewport{height}`（ready 后和窗口大小变化时发）。
- 全站 `index.html` 的 viewport meta 是 `width=device-width, initial-scale=1`，没有 `viewport-fit=cover`，所以现有样式里的 `env(safe-area-inset-*)` 在 iPhone 上都是 0。

## 二、决定：一个公用的按钮条组件 `StepActionBar`

`apps/web/src/pages/book/new/StepActionBar.tsx`，四步都用它代替 `.book-new__actions`（第 3 步仍放在表单里，主按钮仍是 `type="submit"`）：

1. **什么时候是底部条**：`useCompactScreen()` = `(max-width: 768px)`，且不是两栏。769–1023px 的平板单栏、按钮照旧在正文末尾（原来平板第 2 步的固定 `book-bar` 一并取消，「下一步：填写乘客信息」在正文末尾，和电脑一样）。断点只在脚本里判断：`styles.test.ts` 只允许 `min-width` 的媒体查询，CSS 按组件给的类名写，不另写 `max-width`。
2. **条的内容**：左边次要按钮「上一步」（第 1 步没有），右边主按钮（撑满剩余宽度）；第 2 步选了车型后上面多一行「车型 · 一口价 价格」——原来的 `book-bar` 合并进来，页面上只有一条。
3. **第 4 步**：手机上「去付款 →」（报价过期时「重新查询价格」）和「上一步」进底部条；条在表单外面，「去付款」照旧用 `form="book-contact-form"` 提交。同意保存银行卡、支付方式仍在页面最下面（条上方）；没勾时按钮照样可点、点了提示「需要同意保存支付方式才能下单」（现有行为不变）。核对页标题旁的「上一步」在手机上不再出现（不放两个）。`PayBlock` 拆出 `PayButton`，电脑和平板照旧。
4. **点不了的按钮**：现有的 disabled 只有第 2 步「下一步」（`selected === null`）；第 1、3 步点了再校验、标红，第 4 步提交中是 `loading`（不是 disabled）。第 2 步点不了时按钮灰着，条里（电脑、平板在按钮下面）写一行原因，按钮 `aria-describedby="book-step-reason"`：正在报价「正在查询价格，查好后请选择车型」、报价失败「价格没有查出来，请先点「重试」」、其余「请先选择车型」；只能人工报价时没有「下一步」（同现在）。文案按键放在 `lib/step-bar-texts.ts`（写法同 `checkout-texts.ts`，日文、英文以后补）。
5. **主站：`position: fixed`**：条贴屏幕底部，`padding-bottom: calc(space-3 + env(safe-area-inset-bottom))`，左右也加 `env(safe-area-inset-left/right)`。
   - 页面底部留空：条的实际高度用 `ResizeObserver` 量出来写到 `<html>` 的 `--book-actionbar-h`，`<html data-book-actionbar>` 时 **body** 的 `padding-bottom` 和 `<html>` 的 `scroll-padding-bottom` 都用它（没量到时退回「控件高 + 上下内边距 + 安全区」）。放在 body 上而不是页面容器上，是因为页脚（谷歌署名）在 `.site__main` 后面，只在页面容器底部留空会被条挡住页脚。`scroll-padding-bottom` 让键盘聚焦、`scrollIntoView` 的输入框不落在条后面。离开这一页或换到宽屏时属性和变量都去掉。
   - 不用 `position: sticky`：sticky 只在父区块里有效，摘要条展开得很长时区块上沿可能在屏幕下面，条就看不见；fixed 没有这个问题。
   - 写长度变量是脚本改样式，`styles.edge.test.ts` 原来只放行司机页的 `--driver-bar-height`，现在同样只放行 `StepActionBar.tsx` 里写 `--book-actionbar-h`、`--book-actionbar-shift` 的 `setProperty`；`styles.test.ts` 的 `MEASURED_VARIABLES` 加这两个。
6. **`viewport-fit=cover`**：只在主站这一页、手机宽度下加（`useViewportFitCover`：给 `<meta name="viewport">` 的 content 追加 `, viewport-fit=cover`，离开页面还原原文）。全站的 `index.html` 不改：其他页面的固定元素、横屏刘海都没按 cover 处理过，全站加会让它们在横屏时进刘海。加了 cover 后这一页 `<html data-viewport-fit="cover">`，body 左右留 `env(safe-area-inset-left/right)`，横屏时正文不进刘海。嵌入页不加（iframe 里的 meta 不起作用，安全区由宿主页决定）。

## 三、嵌入页：按宿主发来的 iframe 位置摆放

iframe 被撑到内容全高，iframe 里 fixed / sticky 都贴在 iframe 的底边（= 内容最末尾）。iframe 自己不知道宿主页滚到了哪里（跨站，读不了 `window.top`），只能靠宿主告诉它。

1. **宿主（组件脚本 `widget-booking.ts`）**：`viewport` 消息加 `top` = `iframe.getBoundingClientRect().top`（iframe 上沿相对宿主可视区上沿，整数 px，可为负，截到 ±20000）。发的时机：ready 后、宿主窗口 resize 时（原有），以及**宿主页滚动时**（新增）——`scroll` 在 window 上以 `{ passive: true, capture: true }` 听（页面里可滚动的容器滚动也收得到），`requestAnimationFrame` 节流，同一帧只发一次，`top` 没变不发。拆掉 iframe 时一并移除监听、取消待发的帧。体积：只多十几行，远在 gzip 60 KB 预算内（`widget-size.ts` 构建时检查）。
2. **iframe（`EmbedFrame`）**：收到的 viewport 照旧只认父窗口、宿主 origin、同频道；`height`、`top` 放进一个可订阅的小仓库（`embed/frame-bar.ts` 的 `createHostViewportStore`），经 `BookingShell.hostViewport` 交给四步。滚动时消息很频繁，按钮条订阅后直接改自己的位置，不让整页重新渲染。
3. **按钮条（frame 模式）**：条留在文档流里自己的位置（区块末尾）。收到带 `top` 的 viewport 后：
   - iframe 露在宿主屏幕上的那一截的底边 `visibleBottom = min(iframe 视口高度, 宿主可视高度 − top)`；
   - 条往上挪 `shift = min(0, max(0, visibleBottom − 条高) − 条原位置的上沿)`（`frameBarShift`，纯函数，单测），写到条的 `--book-actionbar-shift`，CSS `transform: translateY(...)`；
   - **不低于原位置**（shift ≤ 0）：宿主滚到底时条回到区块末尾，不越过后面的内容；**不高过 iframe 上沿**：iframe 只露出一点或整个在屏幕下方时条停在 iframe 顶部，不跑到 iframe 外面；
   - 坐标都用 iframe 自己视口里的坐标（`getBoundingClientRect`），iframe 内部滚动时（3D 验证时宿主把 iframe 设成可视高度）也照样对；
   - transform 不影响布局，`resize` 报的高度不变（M9E-27 的「iframe 高度等于内容高度」照旧成立）。
   - iframe 自己变高变窄（`resize` 事件）、条或页面内容变高（`ResizeObserver`）时下一帧重算；换步后新条挂上就按最近一次收到的位置摆。
4. **退回**：没收到带 `top` 的 viewport（旧缓存的组件脚本只发 height、直接打开 `/embed/book`）时条是 `position: sticky; bottom: 0`（直接打开、iframe 没被撑高时有效；被撑高时等于原位置，和改之前一样在正文末尾）。
5. **3D 验证弹窗（`modal{open:true}`）**：发生在嵌入订单页，那里没有四步的按钮条，不需要特别处理；万一以后有，iframe 内部滚动时上面的算法等价于 sticky。
6. **消息仍然只影响显示位置**：`parseHostMessage` 白名单只多一个 `top`；不是有限数时只是不带（height 照旧有效），旧消息（无 top）照旧解析。不往宿主发任何新东西。
7. 嵌入页不给 `<html>` 加底部空白（条在文档流里，本来就占着自己的位置），不改 viewport meta。

## 四、协议

宿主 → iframe（ADR 0095 第六节，协议版本仍是 v1，只加可选字段）：

| type | 字段 | 说明 |
| --- | --- | --- |
| `viewport` | `height`（1–20000 整数）；`top`（可选，−20000–20000 整数） | ready 后、宿主窗口 resize、宿主页滚动（rAF 节流、top 变了才发）时发；只影响弹窗和手机底部按钮条的显示位置 |

## 五、兼容

- 旧缓存的组件脚本（只发 height）+ 新嵌入页：条退回 sticky，按钮在正文末尾，和改之前一样能用，只是不悬浮。
- 新组件脚本 + 旧嵌入页：旧 `parseHostMessage` 按白名单丢掉 `top`，不受影响；滚动时多发的 viewport 只更新弹窗用的高度。
- 主站其他页面：viewport meta 不变；只有 `/book/new` 手机宽度下加 `viewport-fit=cover`，离开还原。
- 电脑（≥ 1024）两栏布局不变；第 2 步没选车时按钮下面多一行原因（同一句话，读屏关联）。平板（769–1023）第 2 步原来的固定 `book-bar` 改为正文末尾的按钮。

## 六、测试

- 单元（`node --test`）：`booking-protocol.test.ts` 加 `top` 的解析（有 / 无 / 越界截断 / 非数字只是不带 / height 不对整条丢）；`frame-bar.test.ts`（露出的底边、条往上挪多少、不低于原位置、不高过 iframe 上沿、取整、订阅）；`step-bar-texts.test.ts`（文案、第 2 步原因）。`styles.test.ts`、`styles.edge.test.ts` 放行两个长度变量。
- 组件：`book-new.test.tsx`——手机分步按新条改断言（没选车时灰着、写原因、`aria-describedby`；只有一条条；第 3 步条在表单里）；新增「手机底部按钮条」（每步的按钮、`--book-actionbar-h`、viewport-fit 加上和还原、第 4 步「去付款」在条里、同意保存在条上方、没勾照旧提示）、「电脑、平板没有底部条」（1280、900）。`embed-flow.test.tsx` 新增 390 宽（sticky 退回、收到 top 后的位移、旧消息退回、换步后马上摆好、不给 `<html>` 留空）。`widget-booking.test.tsx`：viewport 带 top；滚动时 rAF 节流、没变不发、捕获阶段听得到容器滚动、拆掉后不再听。
- 端到端：`site-booking-action-bar.spec.ts`（主站 390：四步的按钮滚到顶也在屏幕里、没被盖住；没选车时灰着写原因；滚到底不挡最后一项、同意保存银行卡和页脚；1280 没有条；axe）；`site-embed-booking.spec.ts` 的「M9E-32 跨站」（宿主 390：iframe 比屏幕高，宿主滚到顶、中间、底时按钮都在屏幕里；第 1、3、4 步截图）。原有用例里 `.book-bar` 的「下一步」改成 `.step-bar` 的「下一步：填写乘客信息」，`site-booking-new.spec.ts` 第 4 步按钮位置的断言改为按条核对。
- 合并部署后：手机 390 宽截图，主站和演示站各第 1、3、4 步（roadmap M9E-32）。

## 七、未做的

- 宿主页自己的安全区：嵌入页的条停在宿主可视区的下沿，宿主页如果用了 `viewport-fit=cover`，iPhone 底部横条可能压住条的下边一点；iframe 读不到宿主的 `env()`，要宿主另发，以后有需要再加。
- 宿主页有自己的底部固定栏（客服按钮、Cookie 提示）时会和条叠在一起：宿主可视区里哪些被盖住 iframe 不知道；可以在 `mountBooking` 加一个底部留白参数，等合作网站提出再做。
- 宿主滚动时条的位置靠 postMessage 更新，比滚动晚一帧左右，快速滑动时条会轻微跟随；没有加过渡动画（加了更滞后）。
- iOS Safari 动态改 viewport meta 的 `viewport-fit` 依赖 WebKit 重新读取 meta（本机测不了真机），合并后在 iPhone 上确认安全区生效；不生效时安全区按 0 处理，条仍贴底可用。
- 文案只有中文（M11-04 补译）。
