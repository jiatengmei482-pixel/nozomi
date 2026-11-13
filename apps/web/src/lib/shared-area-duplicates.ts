/** 「共享区域去重」页（M8-31b）的说法和「保留哪一份」的选项。 */
import type { SharedAreaSimilarity } from "@nozomi/domain";
import type { PlatformSharedArea } from "../api/shared-area-duplicates.ts";
import { displayName } from "./master-display.ts";

export const SIMILARITY_TEXT: Readonly<Record<SharedAreaSimilarity, string>> = { name: "同名", overlap: "营运区重叠" };

/** 标记、撤销被拒绝时给运营看的话（不在这里的用后端的中文说明）。 */
export const DUPLICATE_ERROR_TEXT: Readonly<Record<string, string>> = {
  SHARED_AREA_ALREADY_HIDDEN: "这一份已经被别人标为重复了。刷新列表看看现在的状态。",
  SHARED_AREA_IS_KEEP_TARGET: "有别的区域被标成了这一份的重复（它是保留的那份），不能再把它隐藏。先撤销那些标记。",
  DUPLICATE_KEEP_UNAVAILABLE: "选的那份已经不在共享库里，或者刚被标为重复。刷新列表后换一份。",
  DUPLICATE_CITY_MISMATCH: "两个区域不在同一个城市。",
  DUPLICATE_SAME_AREA: "不能把区域标成它自己的重复。",
  SHARED_AREA_NOT_HIDDEN: "这一份已经不是重复了（可能别人刚撤销过）。刷新列表看看现在的状态。",
  NOT_FOUND: "这一份已经不在共享库里了（供应商停用或删除了它）。刷新列表看看现在的状态。",
};

/**
 * 把 `area` 标为重复时可以选的保留那份：同城、没有被隐藏的其他区域。疑似重复的（同名、营运区重叠）排在前面并注明理由，其余按名称。
 * 选项文字是名称，加上图形块数，好分辨同名的几份。
 */
export function keepOptions(area: PlatformSharedArea, all: readonly PlatformSharedArea[]): { id: string; label: string }[] {
  const reasons = new Map(area.similar.map((entry) => [entry.id, entry.reasons]));
  const label = (other: PlatformSharedArea): string => {
    const why = reasons.get(other.id);
    const shape = `营运区 ${other.operate_polygon_count} 块，被引用 ${other.copy_count} 份`;
    return `${displayName(other.name).text}（${why === undefined ? shape : `${why.map((reason) => SIMILARITY_TEXT[reason]).join("、")}；${shape}`}）`;
  };
  const candidates = all.filter((other) => other.id !== area.id && other.duplicate === null && other.city_id === area.city_id);
  const similar = candidates.filter((other) => reasons.has(other.id)).sort((a, b) => area.similar.findIndex((entry) => entry.id === a.id) - area.similar.findIndex((entry) => entry.id === b.id));
  const rest = candidates.filter((other) => !reasons.has(other.id)).sort((a, b) => displayName(a.name).text.localeCompare(displayName(b.name).text, "zh"));
  return [...similar, ...rest].map((other) => ({ id: other.id, label: label(other) }));
}
