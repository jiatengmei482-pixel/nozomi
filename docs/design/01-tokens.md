# 设计令牌

数值以 [`tokens.css`](./tokens.css) 为准，本文解释每个令牌用在哪里。令牌名省略了 `--` 前缀时，指的就是同名的 CSS 自定义属性（如 `color-bg-page` = `var(--color-bg-page)`）。

## 1. 颜色

### 1.1 背景

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `color-bg-page` | `#F4F5F7` | `#0F1217` | 页面底色 |
| `color-bg-surface` | `#FFFFFF` | `#171B22` | 卡片、表格、对话框、输入框、侧边栏、顶栏 |
| `color-bg-subtle` | `#ECEEF2` | `#1E232C` | 表头、分组标题条、只读字段、骨架屏 |
| `color-bg-hover` | `#E3E6EB` | `#272D38` | 行、菜单项、次要按钮的悬停 |
| `color-bg-selected` | `#E6EDFD` | `#1B2B52` | 选中的行、选中的导航项 |
| `color-bg-disabled` | `#ECEEF2` | `#1E232C` | 禁用的控件 |
| `color-bg-inverse` | `#1A1F29` | `#E6E9EE` | Toast、气泡提示 |
| `color-bg-overlay` | `rgb(15 18 23 / 0.5)` | `rgb(0 0 0 / 0.6)` | 对话框、手机侧边栏后面的遮罩 |

### 1.2 文字

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `color-text-primary` | `#1A1F29` | `#E6E9EE` | 正文、标题、表格内容 |
| `color-text-secondary` | `#4A5361` | `#B3BAC6` | 字段标签、表头、次要信息 |
| `color-text-tertiary` | `#5C6574` | `#929BAA` | 辅助说明、占位文字、时间戳 |
| `color-text-disabled` | `#9AA3B1` | `#5F6877` | 禁用控件的文字（只用于禁用态） |
| `color-text-inverse` | `#FFFFFF` | `#1A1F29` | `color-bg-inverse` 上的文字 |
| `color-text-link` | `#1B4FD0` | `#8FB2FF` | 链接、文字按钮、选中导航项的文字 |

### 1.3 边框

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `color-border-default` | `#D6DAE1` | `#2D3440` | 分隔线、卡片和表格的边线（装饰性） |
| `color-border-strong` | `#7C8696` | `#768092` | 输入框、选择器、复选框、次要按钮的边框（要让人看得出「这是个控件」） |
| `color-border-focus` | `#1B4FD0` | `#8FB2FF` | 聚焦环 |

### 1.4 主色

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `color-primary` | `#1B4FD0` | `#2F62DE` | 主按钮底色、选中的复选框和开关、进度条 |
| `color-primary-hover` | `#173FA8` | `#3868E0` | 主按钮悬停 |
| `color-primary-active` | `#123287` | `#2752C0` | 主按钮按下 |
| `color-on-primary` | `#FFFFFF` | `#FFFFFF` | 主色底上的文字和图标 |
| `color-primary-subtle` | `#E6EDFD` | `#1B2B52` | 主色浅底（选中导航项、文字按钮悬停） |

暗色下不能把 `color-primary` 当文字颜色用，文字一律用 `color-text-link`。

### 1.5 状态色

每种状态三个令牌：`-text`（文字和图标）、`-bg`（浅底）、`-border`（浅底的描边，装饰性）。

| 状态 | 含义 | `-text` 亮 / 暗 | `-bg` 亮 / 暗 | `-border` 亮 / 暗 |
| --- | --- | --- | --- | --- |
| `success` | 已完成、已通过、正常 | `#146C3A` / `#6FD397` | `#E2F4E8` / `#12301F` | `#9AD1AE` / `#245C3C` |
| `warning` | 快到期、需要留意、待处理且有时限 | `#8A4B00` / `#F0BD5E` | `#FCEFD2` / `#38290B` | `#E5BE6A` / `#6B4E14` |
| `danger` | 超时、失败、已拒绝、不可恢复的操作 | `#B42318` / `#FF9C91` | `#FDE8E6` / `#401815` | `#F0A9A2` / `#7A2D27` |
| `info` | 进行中、提示说明 | `#0A5F86` / `#6EC5EE` | `#E0F0F9` / `#0E2C3D` | `#93C8E6` / `#1D5673` |
| `neutral` | 草稿、未开始、已停用、已取消 | `#4A5361` / `#B3BAC6` | `#ECEEF2` / `#272D38` | `#D6DAE1` / `#3A4250` |

危险色另有实底一组，用于危险按钮和出错输入框的边框：

| 令牌 | 亮色 | 暗色 |
| --- | --- | --- |
| `color-danger-solid` | `#C4281C` | `#C9352A` |
| `color-danger-solid-hover` | `#A32015` | `#CE3B30` |
| `color-danger-solid-active` | `#861A11` | `#A82A20` |
| `color-on-danger` | `#FFFFFF` | `#FFFFFF` |

### 1.6 允许的搭配与对比度

要求：正文和控件文字 ≥ 4.5:1，控件边框、聚焦环、图形 ≥ 3:1（WCAG 2.1 AA）。下表的数值由 `contrast-check.mjs` 从 `tokens.css` 算出，全部达标。

**文字放在五种通用背景上**（`bg-page`、`bg-surface`、`bg-subtle`、`bg-hover`、`bg-selected` 任意一种都可以）。表中是五种背景里最低的那个值，都出现在 `bg-hover` 上：

| 文字令牌 | 亮色最低 | 暗色最低 | 在 `bg-surface` 上（亮 / 暗） |
| --- | --- | --- | --- |
| `text-primary` | 13.20 | 11.36 | 16.51 / 14.19 |
| `text-secondary` | 6.21 | 7.08 | 7.77 / 8.84 |
| `text-tertiary` | 4.70 | 4.93 | 5.88 / 6.16 |
| `text-link` | 5.46 | 6.57 | 6.83 / 8.21 |
| `success-text` | 5.19 | 7.53 | 6.49 / 9.41 |
| `warning-text` | 5.44 | 8.00 | 6.80 / 9.99 |
| `danger-text` | 5.25 | 6.86 | 6.57 / 8.56 |
| `info-text` | 5.61 | 7.17 | 7.01 / 8.95 |

**固定搭配**：

| 前景 | 背景 | 用途 | 要求 | 亮色 | 暗色 |
| --- | --- | --- | --- | --- | --- |
| `on-primary` | `primary` | 主按钮文字 | 4.5 | 6.83 | 5.35 |
| `on-primary` | `primary-hover` | 主按钮文字（悬停） | 4.5 | 9.08 | 4.97 |
| `on-primary` | `primary-active` | 主按钮文字（按下） | 4.5 | 11.46 | 6.88 |
| `on-danger` | `danger-solid` | 危险按钮文字 | 4.5 | 5.73 | 5.22 |
| `on-danger` | `danger-solid-hover` | 危险按钮文字（悬停） | 4.5 | 7.57 | 4.89 |
| `on-danger` | `danger-solid-active` | 危险按钮文字（按下） | 4.5 | 9.68 | 6.96 |
| `text-link` | `primary-subtle` | 选中导航项 | 4.5 | 5.82 | 6.59 |
| `success-text` | `success-bg` | 状态徽标、提示条 | 4.5 | 5.67 | 7.79 |
| `warning-text` | `warning-bg` | 状态徽标、提示条 | 4.5 | 5.97 | 8.15 |
| `danger-text` | `danger-bg` | 状态徽标、提示条 | 4.5 | 5.59 | 7.66 |
| `info-text` | `info-bg` | 状态徽标、提示条 | 4.5 | 6.01 | 7.53 |
| `neutral-text` | `neutral-bg` | 状态徽标 | 4.5 | 6.69 | 7.08 |
| `text-primary` | `success-bg` | 提示条正文 | 4.5 | 14.42 | 11.75 |
| `text-primary` | `warning-bg` | 提示条正文 | 4.5 | 14.48 | 11.58 |
| `text-primary` | `danger-bg` | 提示条正文 | 4.5 | 14.04 | 12.69 |
| `text-primary` | `info-bg` | 提示条正文 | 4.5 | 14.15 | 11.93 |
| `text-inverse` | `bg-inverse` | Toast、气泡提示 | 4.5 | 16.51 | 13.57 |
| `border-strong` | `bg-surface` | 输入框边框 | 3 | 3.68 | 4.34 |
| `border-strong` | `bg-page` | 输入框边框 | 3 | 3.37 | 4.71 |
| `border-focus` | `bg-surface` | 聚焦环 | 3 | 6.83 | 8.21 |
| `border-focus` | `bg-page` | 聚焦环 | 3 | 6.26 | 8.92 |
| `border-focus` | `bg-subtle` | 聚焦环 | 3 | 5.88 | 7.49 |
| `danger-solid` | `bg-surface` | 出错输入框边框 | 3 | 5.73 | 3.31 |
| `danger-solid` | `bg-page` | 出错输入框边框 | 3 | 5.25 | 3.60 |
| `primary` | `bg-surface` | 选中的复选框、开关、进度条 | 3 | 6.83 | 3.23 |
| `primary` | `bg-page` | 选中的复选框、开关、进度条 | 3 | 6.26 | 3.50 |

**不在表里的组合不要用。** 特别是：

- 状态文字（`success-text` 等）只能放在通用背景或**同一种状态**的 `-bg` 上，不能放到别的状态底色上。
- `text-secondary`、`text-tertiary` 不放在状态底色上；提示条里的正文用 `text-primary`。
- `text-disabled` 只用于禁用态（WCAG 对禁用控件不设对比度要求）。禁用的控件不能承载用户必须读到的信息；必须读到的内容用只读样式（`bg-subtle` + `text-primary`）。
- `border-default` 和各状态的 `-border` 是装饰线，不能作为控件的唯一边界。

## 2. 字体

界面语言现在是简体中文，将来有日文和英文。只用系统自带字体，不加载任何网络字体。

| 令牌 | 用途 |
| --- | --- |
| `font-family-sans` | 默认（简体中文、英文） |
| `font-family-sans-ja` | 日文内容 |
| `font-family-mono` | 订单号、商品 ID、密钥、代码、坐标 |

必须做的事：

- `<html lang="zh-Hans">`，全局 `font-family: var(--font-family-sans)`。
- 全局加一条 `:lang(ja) { font-family: var(--font-family-sans-ja); }`。中日文共用一批汉字编码，但字形不同；不标语言，日文会被显示成中文字形。
- 中文界面里出现的日文内容（日文地址、日文商品标题、司机姓名等）在所在元素上加 `lang="ja"`；界面整体切到日文时改 `<html lang="ja">`。
- 数字列、金额、时间加 `font-variant-numeric: tabular-nums`，让数字等宽对齐。
- 不用斜体（中文没有真斜体）；强调用 `font-weight-bold`。

## 3. 字号、行高、字重

| 令牌 | 大小 | 用途 |
| --- | --- | --- |
| `font-size-xs` | 12px | 状态徽标、表格里的辅助行。**最小字号，不能更小** |
| `font-size-sm` | 13px | 辅助说明、校验提示、表头、面包屑 |
| `font-size-md` | 14px | 正文、表格内容、桌面端控件。默认字号 |
| `font-size-lg` | 16px | 卡片标题、触屏下的控件文字、官网和司机 H5 的正文 |
| `font-size-xl` | 18px | 对话框标题、司机 H5 的主按钮 |
| `font-size-2xl` | 20px | 页面标题 |
| `font-size-3xl` | 24px | 登录页品牌名、看板上的大数字 |
| `font-size-4xl` | 30px | 官网首屏标题 |

字号用 rem，跟随用户在浏览器里设置的字体大小。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `line-height-tight` | 1.25 | 标题、单行控件、徽标 |
| `line-height-normal` | 1.5 | 正文、表格、表单 |
| `line-height-loose` | 1.7 | 大段说明文字（条款、接机指引） |
| `font-weight-regular` | 400 | 正文 |
| `font-weight-medium` | 500 | 字段标签、表头、按钮、选中的导航项 |
| `font-weight-bold` | 600 | 标题、需要强调的数字 |

## 4. 间距

4px 基准，只用下面这些值：

| 令牌 | 值 | 典型用途 |
| --- | --- | --- |
| `space-0-5` | 2px | 徽标的上下内边距 |
| `space-1` | 4px | 图标和文字之间；标签和输入框之间 |
| `space-2` | 8px | 并排按钮之间；徽标的左右内边距；紧凑单元格内边距 |
| `space-3` | 12px | 控件的左右内边距；表格单元格的左右内边距 |
| `space-4` | 16px | 表单字段之间；卡片内边距（手机）；手机页面边距 |
| `space-5` | 20px | 对话框内边距 |
| `space-6` | 24px | 卡片内边距（桌面）；桌面页面边距；卡片之间 |
| `space-8` | 32px | 页面里的大分区之间 |
| `space-10` | 40px | 空状态的上下留白 |
| `space-12` | 48px | 登录页卡片上方留白（手机） |
| `space-16` | 64px | 官网分区之间 |

## 5. 圆角、阴影、边框

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `radius-sm` | 4px | 状态徽标、复选框、表格里的小控件 |
| `radius-md` | 6px | 按钮、输入框、选择器、提示条 |
| `radius-lg` | 8px | 卡片、表格容器、下拉面板 |
| `radius-xl` | 12px | 对话框、登录卡片 |
| `radius-full` | 9999px | 头像、圆点、开关 |
| `shadow-sm` | — | 吸顶的表头和顶栏滚动后 |
| `shadow-md` | — | 下拉面板、气泡、Toast |
| `shadow-lg` | — | 对话框、手机上滑出的侧边栏 |
| `border-width` | 1px | 所有边框 |
| `focus-ring-width` / `focus-ring-offset` | 2px / 2px | 聚焦环 |

卡片和表格不用阴影，用 `border-default` 描边。暗色下阴影几乎看不见，浮层必须同时有 `border-default` 描边。

聚焦环统一写法（所有可聚焦元素）：

```css
:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-border-focus);
  outline-offset: var(--focus-ring-offset);
}
```

输入框例外：`outline-offset: -1px`，让聚焦环压在边框上，不撑出容器。不允许写 `outline: none` 而不给替代样式。

## 6. 控件尺寸

| 令牌 | 鼠标 | 触屏（`pointer: coarse`） | 用途 |
| --- | --- | --- | --- |
| `control-height-sm` | 28px | 36px | 表格行内的按钮、筛选条 |
| `control-height-md` | 32px | 44px | 默认 |
| `control-height-lg` | 40px | 48px | 登录页、官网、司机 H5、页面主操作 |
| `control-font-size` | 14px | 16px | 输入框、选择器的文字 |
| `table-row-height` | 40px | 48px | 表格行最小高度 |

触屏下的取值由 `tokens.css` 自动切换，组件里只引用令牌，不自己判断设备。

## 7. 断点

| 名称 | 宽度 | 含义 |
| --- | --- | --- |
| （默认） | < 480px | 手机竖屏。**样式从这里写起**（移动优先），最窄按 360px 验证 |
| `sm` | ≥ 480px | 大手机、手机横屏 |
| `md` | ≥ 768px | 平板竖屏；表单开始两栏；页面边距变 24px |
| `lg` | ≥ 1024px | 侧边栏常驻显示 |
| `xl` | ≥ 1280px | 常见笔记本 |
| `2xl` | ≥ 1536px | 大屏；内容区到达最大宽度后两侧留白 |

媒体查询只用 `min-width` 加上表中的数值，不用其他数值，不用 `max-width` 反着写。

## 8. 层级

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `z-base` | 0 | 普通内容 |
| `z-sticky` | 100 | 吸顶表头、固定的首列、底部操作条 |
| `z-topbar` | 200 | 顶栏 |
| `z-sidebar` | 300 | 侧边栏（手机上滑出时盖住顶栏） |
| `z-dropdown` | 400 | 下拉面板、日期面板 |
| `z-overlay` | 500 | 遮罩 |
| `z-dialog` | 510 | 对话框 |
| `z-toast` | 600 | Toast |
| `z-tooltip` | 700 | 气泡提示 |

组件里不写其他 `z-index` 数字。

## 9. 动效

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `duration-fast` | 100ms | 悬停、按下的颜色变化 |
| `duration-base` | 160ms | 下拉面板、Toast、气泡出现 |
| `duration-slow` | 240ms | 对话框、侧边栏滑入 |
| `easing-standard` | — | 出现、移动 |
| `easing-exit` | — | 消失 |

只对 `opacity`、`transform`、颜色做过渡，不对宽高做过渡。用户系统设置了「减少动态效果」时三个时长自动变为 0（`tokens.css` 已处理）；加载转圈在这种情况下改为静止图标加文字「加载中」。
