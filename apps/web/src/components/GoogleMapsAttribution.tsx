/**
 * 地址候选列表末尾的谷歌署名（M9E-06）：写法见 `lib/google-attribution.ts`，和嵌入组件同一份。
 * 放在候选列表（`<ul>`）里当最后一项；候选里没有谷歌来源时什么都不画。
 * `listbox`：列表是组合框的候选列表（`role="listbox"`），署名标成 `role="presentation"`，不当作候选。
 */
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hasGoogleSource } from "../lib/google-attribution.ts";

export function GoogleMapsAttribution({ items, listbox = false }: { items: readonly { source?: unknown }[]; listbox?: boolean }) {
  if (!hasGoogleSource(items)) return null;
  return (
    <li className="google-attribution" {...GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES} {...(listbox ? { role: "presentation" } : {})}>
      {GOOGLE_MAPS_ATTRIBUTION}
    </li>
  );
}
