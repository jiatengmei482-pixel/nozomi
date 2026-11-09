/**
 * 接送点（机场、车站）搜索的匹配规则（docs/design/pages/tenant-products.md 4.1「接送点」，M1-17）。
 * 规则本身在 `@nozomi/domain` 的 `place-match.ts`（M8-02 起官网的地址搜索在后端也用同一套）。
 */
export { placeQueryMatches } from "@nozomi/domain";
