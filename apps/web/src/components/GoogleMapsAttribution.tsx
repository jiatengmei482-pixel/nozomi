/**
 * 地址候选的谷歌署名（M9E-06）：写法见 `lib/google-attribution.ts`，和嵌入组件同一份。
 * 放在候选列表（`<ul>`）后面、同一个容器里，不放进列表：组合框的 listbox 里只留候选，普通列表的项数也不含署名；
 * 读屏在列表后面读到一次「Google Maps」。在弹出面板里时固定在面板底部（滚动的是候选列表，样式见 data.css），候选多了也不会被滚出可视区。
 * 候选里没有谷歌来源时什么都不画。
 */
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hasGoogleSource } from "../lib/google-attribution.ts";

export function GoogleMapsAttribution({ items }: { items: readonly { source?: unknown }[] }) {
  if (!hasGoogleSource(items)) return null;
  return (
    <p className="google-attribution" {...GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES}>
      {GOOGLE_MAPS_ATTRIBUTION}
    </p>
  );
}
