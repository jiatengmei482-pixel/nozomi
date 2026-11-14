/**
 * 嵌入组件的样式（M9E-03；M9E-10 重做外观：card 竖向卡片、bar 横向搜索条）：放进 Shadow DOM，合作网站的样式进不来、组件的也出不去。
 * `:host { all: initial }` 优先级低于宿主页写在容器上的规则（会继承的 font-weight、letter-spacing、text-transform、font-style 等加 !important 就能穿进来），
 * 所以最外层 `.nzb-shell`、`.nzb` 再 `all: initial` 一次、写回需要的值，里面的元素只从它们继承；合作网站页面上不加载我们的 tokens.css，所以这里的取值抄自 docs/design/tokens.css 的浅色主题
 * （文字 --color-text-primary / secondary / tertiary、边框 --color-border-default / strong、背景 --color-bg-page / subtle、悬停 --color-bg-selected、成功 / 危险、阴影）。
 * 主题只有 CSS 变量（组件按 init 的 theme 写在 .nzb-shell 上）：--nzb-primary、--nzb-on-primary、--nzb-ink、--nzb-accent、--nzb-on-accent、--nzb-radius、--nzb-radius-control、--nzb-font。
 * 外观看 `.nzb-shell[data-layout]`（card / bar；bar 在容器窄于 768 px 时由组件换成 card）。容器 320 px 起不横向滚动；焦点环清楚可见；输入框字号 16px（iOS 小于 16px 聚焦时会放大页面）。
 */
export const WIDGET_CSS = `
:host { all: initial; display: block; }
.nzb-shell { all: initial; display: block; box-sizing: border-box; font-family: var(--nzb-font); container-type: inline-size; --nzb-pad: 24px; }
.nzb-shell[data-layout="card"] { max-width: 600px; margin: 0 auto; padding: 12px; background: rgb(236 238 242 / 0.72); border-radius: calc(var(--nzb-radius) + 12px); }
.nzb { all: initial; direction: ltr; display: block; text-align: start; box-sizing: border-box; font-family: var(--nzb-font); font-size: 15px; line-height: 1.5; color: #1a1f29; background: #ffffff; border-radius: var(--nzb-radius); box-shadow: 0 1px 2px rgb(20 30 70 / 0.06), 0 8px 24px rgb(20 30 70 / 0.08); padding: var(--nzb-pad); max-width: 100%; overflow-wrap: anywhere; }
.nzb *, .nzb *::before, .nzb *::after { box-sizing: border-box; }
:where(.nzb) :where(button, input, select) { font: inherit; letter-spacing: inherit; text-transform: none; color: inherit; margin: 0; }
.nzb-icon { width: 20px; height: 20px; flex: none; color: var(--nzb-ink); }
.nzb-tabs { display: flex; margin: calc(var(--nzb-pad) * -1) calc(var(--nzb-pad) * -1) 20px; border-radius: var(--nzb-radius) var(--nzb-radius) 0 0; overflow: hidden; }
.nzb-tab { flex: 1 1 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 64px; padding: 12px 20px; border: 0; border-bottom: 3px solid #e3e6eb; background: #f4f5f7; color: #1a1f29; text-align: start; cursor: pointer; }
.nzb-tab:hover { background: #eceef2; }
.nzb-tab[aria-selected="true"] { background: #ffffff; color: var(--nzb-ink); border-bottom-color: var(--nzb-primary); }
.nzb-tab-title { font-size: 16px; font-weight: 700; line-height: 1.3; }
.nzb-tab-sub { font-size: 13px; font-weight: 400; line-height: 1.3; color: #4a5361; }
.nzb-form { display: flex; flex-direction: column; gap: 14px; margin: 0; }
.nzb-field { display: block; min-width: 0; position: relative; }
.nzb-label { display: block; margin: 0 0 6px; padding: 0; font-size: 13px; line-height: 18px; font-weight: 600; color: #4a5361; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nzb-control { position: relative; }
.nzb-box { display: flex; align-items: center; gap: 10px; width: 100%; height: 56px; padding: 0 16px; border: 1px solid #7c8696; border-radius: var(--nzb-radius-control); background: #ffffff; color: #1a1f29; font-size: 16px; line-height: 24px; -webkit-appearance: none; appearance: none; text-align: start; }
.nzb-box:hover { border-color: #4a5361; }
.nzb-box:focus, .nzb-box:focus-within { outline: none; border-color: var(--nzb-ink); box-shadow: 0 0 0 1px var(--nzb-ink); }
.nzb-place-input { padding-left: 38px; }
.nzb-place-input::placeholder { color: #5c6574; opacity: 1; }
.nzb-box[aria-invalid="true"], .nzb-bare[aria-invalid="true"] { border-color: #b42318; box-shadow: 0 0 0 1px #b42318; }
.nzb-dot { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; color: #146c3a; pointer-events: none; }
.nzb-dot-end { color: #c4281c; }
.nzb-bare { position: relative; min-width: 0; height: 100%; padding: 0; border: 0; background: #ffffff; color: inherit; font-size: 16px; -webkit-appearance: none; appearance: none; }
.nzb-date { flex: 1.4 1 0; }
.nzb-time { flex: 1 1 0; }
.nzb-bare::-webkit-calendar-picker-indicator { position: absolute; inset: 0; width: auto; height: auto; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.nzb-bare::-webkit-date-and-time-value { text-align: start; }
.nzb-bare::-webkit-datetime-edit { padding: 0; }
.nzb-sep { flex: none; width: 1px; height: 24px; background: #d6dae1; }
.nzb-trigger { height: 48px; cursor: pointer; }
.nzb-trigger-text { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nzb-chevron { width: 20px; height: 20px; flex: none; color: #4a5361; pointer-events: none; }
.nzb-select { padding-right: 44px; cursor: pointer; }
.nzb-control > .nzb-chevron { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); }
.nzb-swap { display: inline-flex; align-items: center; justify-content: center; align-self: flex-end; position: relative; z-index: 1; width: 40px; height: 40px; margin: -32px 16px -32px 0; padding: 0; border: 1px solid #d6dae1; border-radius: 999px; background: #ffffff; color: var(--nzb-ink); cursor: pointer; box-shadow: 0 1px 2px rgb(20 30 70 / 0.08); }
.nzb-swap:hover { border-color: #7c8696; background: #f4f5f7; }
.nzb-swap-icon { width: 20px; height: 20px; transform: rotate(90deg); }
.nzb-pop { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; width: min(320px, 100%); padding: 16px; background: #ffffff; border: 1px solid #d6dae1; border-radius: var(--nzb-radius-control); box-shadow: 0 16px 40px rgb(20 30 70 / 0.18); }
.nzb-pop[hidden] { display: none; }
.nzb-step-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; }
.nzb-step-label { font-weight: 600; }
.nzb-stepper { display: flex; align-items: center; gap: 4px; }
.nzb-step { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 1px solid #7c8696; border-radius: 999px; background: #ffffff; color: var(--nzb-ink); cursor: pointer; }
.nzb-step:hover { background: #f4f5f7; }
.nzb-step[aria-disabled="true"] { border-color: #d6dae1; color: #9aa3b1; cursor: not-allowed; background: #ffffff; }
.nzb-step-icon { width: 20px; height: 20px; }
.nzb-step-value { min-width: 32px; text-align: center; font-size: 17px; font-weight: 600; }
.nzb-done { display: block; width: 100%; min-height: 44px; margin-top: 10px; border: 0; border-radius: var(--nzb-radius-control); background: #eceef2; color: #1a1f29; font-weight: 600; cursor: pointer; }
.nzb-done:hover { background: #e3e6eb; }
.nzb-extra { display: grid; gap: 12px; min-width: 0; }
.nzb-extra-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.nzb-add { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--nzb-ink); font-weight: 600; cursor: pointer; }
.nzb-add-icon { width: 18px; height: 18px; }
.nzb-add:hover { text-decoration: underline; text-underline-offset: 3px; }
.nzb-waypoint { display: grid; grid-template-columns: minmax(0, 1fr) 44px; gap: 8px; align-items: center; margin: 0; padding: 0; border: 0; min-width: 0; }
.nzb-waypoint .nzb-place { grid-column: 1 / -1; }
.nzb-waypoint .nzb-box { height: 48px; }
.nzb-remove { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 999px; background: transparent; color: #4a5361; cursor: pointer; }
.nzb-remove:hover { background: #eceef2; color: #1a1f29; }
.nzb-remove-icon { width: 20px; height: 20px; }
.nzb-hint { margin: 0; font-size: 13px; color: #4a5361; }
.nzb-status:not(:empty) { margin-top: 6px; }
.nzb-note { font-size: 12px; }
.nzb-error { margin: 0; color: #b42318; font-weight: 600; min-height: 0; }
.nzb-error:empty { display: none; }
.nzb-panel { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; width: 100%; display: flex; flex-direction: column; margin: 0; border: 1px solid #d6dae1; border-radius: var(--nzb-radius-control); background: #ffffff; box-shadow: 0 16px 40px rgb(20 30 70 / 0.18); max-height: 260px; overflow: hidden; }
.nzb-panel[hidden], .nzb-google[hidden] { display: none; }
.nzb-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 4px 0; }
.nzb-option { display: grid; padding: 10px 14px; cursor: pointer; }
.nzb-option:hover, .nzb-option:focus { background: #e8ecfa; }
.nzb-option-name { font-weight: 500; }
.nzb-option-address { font-size: 13px; color: #4a5361; }
.nzb-google { flex: none; margin: 0; background: #ffffff; border-top: 1px solid #d5dae1; padding: 4px 12px; font-size: 12px; font-weight: 400; font-style: normal; letter-spacing: normal; text-transform: none; white-space: nowrap; color: #4a5361; text-align: right; }
.nzb-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 56px; padding: 0 24px; border: 0; border-radius: var(--nzb-radius-control); background: var(--nzb-primary); color: var(--nzb-on-primary); font-size: 17px; font-weight: 700; cursor: pointer; }
.nzb-primary:hover { filter: brightness(0.92); }
.nzb-primary[aria-disabled="true"] { opacity: 0.75; cursor: progress; filter: none; }
.nzb-search-icon { display: none; width: 24px; height: 24px; }
.nzb-link { color: var(--nzb-ink); font-weight: 600; }
.nzb-message { margin: 0 0 8px; }
.nzb button:focus-visible, .nzb input:focus-visible, .nzb select:focus-visible, .nzb a:focus-visible, .nzb-option:focus-visible { outline: 2px solid var(--nzb-ink); outline-offset: 2px; }
.nzb-option:focus-visible { outline-offset: -2px; }
.nzb-visually-hidden { position: absolute; width: 1px; height: 1px; margin: 0; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.nzb-shell[data-layout="bar"] .nzb[data-view="form"] { background: transparent; box-shadow: none; padding: 0; border-radius: 0; }
.nzb-shell[data-layout="bar"] .nzb-tabs { display: inline-flex; gap: 4px; margin: 0; border-radius: 0; overflow: visible; vertical-align: bottom; }
.nzb-shell[data-layout="bar"] .nzb-tab { flex: none; min-height: 0; padding: 10px 22px 8px; border: 0; border-radius: 14px 14px 0 0; background: #eceef2; }
.nzb-shell[data-layout="bar"] .nzb-tab[aria-selected="true"] { background: var(--nzb-accent); color: var(--nzb-on-accent); }
.nzb-shell[data-layout="bar"] .nzb-tab[aria-selected="true"] .nzb-tab-sub { color: inherit; }
.nzb-shell[data-layout="bar"] .nzb-tab-title { font-size: 15px; }
.nzb-shell[data-layout="bar"] .nzb-tab-sub { font-size: 12px; }
.nzb-shell[data-layout="bar"] .nzb-form { display: grid; grid-template-columns: minmax(256px, 1.3fr) minmax(0, 1.5fr) 40px minmax(0, 1.5fr) minmax(132px, 0.8fr) 56px; gap: 10px 8px; align-items: center; padding: 10px; background: #ffffff; border-radius: 0 var(--nzb-radius) var(--nzb-radius) var(--nzb-radius); box-shadow: 0 2px 6px rgb(20 30 70 / 0.08), 0 14px 32px rgb(20 30 70 / 0.12); }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field { height: 64px; padding: 8px 14px; border-radius: var(--nzb-radius-control); background: #f4f5f7; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field:focus-within { box-shadow: 0 0 0 2px var(--nzb-ink); }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field > .nzb-label { margin: 0 0 2px; font-size: 12px; line-height: 16px; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-box { height: 28px; padding: 0; gap: 8px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-place-input { padding-left: 22px; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-dot { left: 2px; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-bare { background: transparent; }
.nzb-shell[data-layout="bar"] .nzb-date { flex: none; width: 112px; color: #146c3a; font-weight: 600; }
.nzb-shell[data-layout="bar"] .nzb-time { min-width: 72px; }
.nzb-shell[data-layout="bar"] .nzb-trigger .nzb-chevron { display: none; }
.nzb-trigger-short, .nzb-shell[data-layout="bar"] .nzb-trigger-text { display: none; }
.nzb-shell[data-layout="bar"] .nzb-trigger-short { display: block; flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-icon { width: 18px; height: 18px; }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-status { position: absolute; left: 14px; top: calc(100% + 2px); }
.nzb-shell[data-layout="bar"] .nzb-form > .nzb-field .nzb-panel, .nzb-shell[data-layout="bar"] .nzb-pop { top: calc(100% + 14px); left: -14px; width: max(100% + 28px, 340px); }
.nzb-shell[data-layout="bar"] .nzb-pop { left: auto; right: -14px; width: 300px; }
.nzb-shell[data-layout="bar"] .nzb-swap { align-self: center; margin: 0; }
.nzb-shell[data-layout="bar"] .nzb-swap-icon { transform: none; }
.nzb-shell[data-layout="bar"] .nzb-primary { grid-row: 1; grid-column: -2; width: 56px; min-height: 56px; height: 56px; padding: 0; border-radius: 999px; background: #7c8696; color: #ffffff; }
.nzb-shell[data-layout="bar"] .nzb-primary[data-ready="true"] { background: var(--nzb-primary); color: var(--nzb-on-primary); }
.nzb-shell[data-layout="bar"] .nzb-search-icon { display: block; }
.nzb-shell[data-layout="bar"] .nzb-submit-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.nzb-shell[data-layout="bar"] .nzb-extra, .nzb-shell[data-layout="bar"] .nzb-error, .nzb-shell[data-layout="bar"] .nzb-note { grid-column: 1 / -1; padding: 0 6px; }
.nzb-shell[data-layout="bar"] .nzb-extra { padding-top: 6px; border-top: 1px solid #e3e6eb; }
.nzb-shell[data-layout="bar"] .nzb-waypoint { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) 44px; max-width: 820px; align-items: end; }
.nzb-shell[data-layout="bar"] .nzb-waypoint .nzb-place { grid-column: auto; }
@container (max-width: 440px) { .nzb { --nzb-pad: 16px; } .nzb-tab { padding: 10px 14px; } }
`;
