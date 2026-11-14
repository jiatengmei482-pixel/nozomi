/**
 * 地址候选的谷歌署名（M9E-06，ADR 0090 第四节）：主站 `/book/new`、旧询价页 `/book` 和嵌入组件共用这一份写法。
 * 依据谷歌地图平台的署名要求（Places API Policies「Google Maps attribution」，2026-11-13 查）：
 * - 内容不在谷歌地图上显示时要自己署名；地方小时可以用文字「Google Maps」代替标志；
 * - 文字不翻译、不改大小写、不折行，`translate="no"`；字号 12–16，字重 400，和背景对比 ≥ 4.5:1；
 * - 放在内容的上方或下方、同一个容器里。
 * 只有候选里有谷歌来源的一项才署名，只有平台自己的机场、车站时不显示。
 * 位置：候选列表后面、同一个弹出面板（或容器）里，不放进列表；滚动的是候选列表、署名在列表下面不跟着滚（手机全屏选择页贴在可视区底部），始终看得见（谷歌要求署名始终可见）。
 * 读屏：listbox 里只有候选，署名是列表后面一段普通文字「Google Maps」——不进 ↑↓ 的顺序、不改「找到 N 个地点」的数，
 * 逐个听候选时不会每项都读到它；浏览时在列表后面读到一次。
 */

/** 署名文字：谷歌要求原样显示，不翻译、不改写 */
export const GOOGLE_MAPS_ATTRIBUTION = "Google Maps";

/** 署名元素的属性：英文、不让浏览器翻译 */
export const GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES = { lang: "en", translate: "no" } as const;

/** 候选里有没有谷歌来源的一项（有才署名） */
export function hasGoogleSource(items: readonly { source?: unknown }[]): boolean {
  return items.some((item) => item.source === "google");
}
