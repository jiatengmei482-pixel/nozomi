/**
 * 嵌入组件的样式（M9E-03）：放进 Shadow DOM，合作网站的样式进不来、组件的也出不去。
 * `:host { all: initial }` 优先级低于宿主页写在容器上的规则（会继承的 font-weight、letter-spacing、text-transform、font-style 等加 !important 就能穿进来），
 * 所以最外层 `.nzb` 再 `all: initial` 一次、写回需要的值，里面的元素只从 `.nzb` 继承；合作网站页面上不加载我们的 tokens.css，所以这里的取值抄自 docs/design/tokens.css 的浅色主题。
 * 容器 320 px 起不横向滚动；焦点环清楚可见。
 */
export const WIDGET_CSS = `
:host { all: initial; display: block; }
.nzb { all: initial; direction: ltr; display: block; text-align: start; box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "PingFang SC", sans-serif; font-size: 15px; line-height: 1.5; color: #1f2933; background: #ffffff; border: 1px solid #d5dae1; border-radius: 12px; padding: 16px; max-width: 100%; overflow-wrap: anywhere; }
.nzb *, .nzb *::before, .nzb *::after { box-sizing: border-box; }
.nzb-tabs { display: flex; gap: 4px; margin: 0 0 12px; border-bottom: 1px solid #d5dae1; }
.nzb-tab { flex: 1 1 0; min-height: 44px; padding: 8px 12px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: #52606d; font: inherit; font-weight: 600; cursor: pointer; }
.nzb-tab[aria-selected="true"] { color: #0b5cad; border-bottom-color: #0b5cad; }
.nzb-form { display: grid; gap: 12px; margin: 0; }
.nzb-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.nzb-field { display: grid; gap: 4px; min-width: 0; position: relative; }
.nzb-label { font-weight: 600; font-size: 14px; }
.nzb-input { width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid #9aa5b1; border-radius: 8px; background: #ffffff; color: #1f2933; font: inherit; }
.nzb-hint { margin: 0; font-size: 13px; color: #52606d; }
.nzb-error { margin: 0; color: #b42318; font-weight: 600; min-height: 0; }
.nzb-error:empty { display: none; }
.nzb-panel { display: flex; flex-direction: column; margin: 0; border: 1px solid #d5dae1; border-radius: 8px; background: #ffffff; max-height: 260px; overflow: hidden; }
.nzb-panel[hidden], .nzb-google[hidden] { display: none; }
.nzb-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; list-style: none; margin: 0; padding: 4px 0; }
.nzb-option { display: grid; padding: 8px 12px; cursor: pointer; }
.nzb-option:hover, .nzb-option:focus { background: #e8f1fb; }
.nzb-option-address { font-size: 13px; color: #52606d; }
.nzb-google { flex: none; margin: 0; background: #ffffff; border-top: 1px solid #d5dae1; padding: 4px 12px; font-size: 12px; font-weight: 400; font-style: normal; letter-spacing: normal; text-transform: none; white-space: nowrap; color: #4a5361; text-align: right; }
.nzb-waypoint { display: grid; gap: 8px; margin: 0; padding: 12px; border: 1px dashed #9aa5b1; border-radius: 8px; min-width: 0; }
.nzb-primary, .nzb-secondary { min-height: 44px; padding: 8px 16px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; }
.nzb-primary { border: 0; background: #0b5cad; color: #ffffff; }
.nzb-primary[aria-disabled="true"] { opacity: 0.7; cursor: progress; }
.nzb-secondary { border: 1px solid #9aa5b1; background: #ffffff; color: #1f2933; justify-self: start; }
.nzb-link { color: #0b5cad; font-weight: 600; }
.nzb-message { margin: 0 0 8px; }
.nzb button:focus-visible, .nzb input:focus-visible, .nzb select:focus-visible, .nzb a:focus-visible, .nzb-option:focus-visible { outline: 3px solid #0b5cad; outline-offset: 2px; }
.nzb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;
