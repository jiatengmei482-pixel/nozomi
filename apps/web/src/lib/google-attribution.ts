/**
 * 地址候选的谷歌署名（M9E-06，ADR 0090 第四节）：主站 `/book/new`、旧询价页 `/book` 和嵌入组件共用这一份写法。
 * 依据谷歌地图平台的署名要求（Places API Policies「Google Maps attribution」，2026-11-13 查）：
 * - 内容不在谷歌地图上显示时要自己署名；地方小时可以用文字「Google Maps」代替标志；
 * - 文字不翻译、不改大小写、不折行，`translate="no"`；字号 12–16，字重 400，和背景对比 ≥ 4.5:1；
 * - 放在内容的上方或下方、同一个容器里。
 * 只有候选里有谷歌来源的一项才署名，只有平台自己的机场、车站时不显示。
 * 读屏：署名是候选列表里的最后一项、不是候选。组合框的候选列表（`role="listbox"`）里它是 `role="presentation"`，
 * 不进 ↑↓ 的顺序、不改「找到 N 个地点」的数，逐个听候选时不会读到它；浏览整页时在列表末尾读到一次。
 * 普通列表（旧询价页的搜索结果）里它是普通的一项，在列表末尾读到一次。
 */

/** 署名文字：谷歌要求原样显示，不翻译、不改写 */
export const GOOGLE_MAPS_ATTRIBUTION = "Google Maps";

/** 署名元素的属性：英文、不让浏览器翻译 */
export const GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES = { lang: "en", translate: "no" } as const;

/** 候选里有没有谷歌来源的一项（有才署名） */
export function hasGoogleSource(items: readonly { source?: unknown }[]): boolean {
  return items.some((item) => item.source === "google");
}
