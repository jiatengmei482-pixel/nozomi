/**
 * 区域共享库的规则（M8-31、M8-31b，ADR 0083 及其补充）：怎样算「相似」，平台把一份标成另一份的重复时要满足什么。
 * 纯函数，不碰数据库；数据由调用方查好传进来。
 */
import { type Ring, ringsOverlap } from "./areas.ts";

/** name：名称归一后任意一种语言相同（`areaNameKeys`）；overlap：营运区有重叠 */
export type SharedAreaSimilarity = "name" | "overlap";

export interface SimilarityInput {
  nameKeys: readonly string[];
  operateRings: readonly Ring[];
}

/** 两个同城区域相似的理由（没有理由 = 不相似）：名称在前、重叠在后。 */
export function sharedAreaSimilarity(a: SimilarityInput, b: SimilarityInput): SharedAreaSimilarity[] {
  const reasons: SharedAreaSimilarity[] = [];
  if (a.nameKeys.some((key) => b.nameKeys.includes(key))) reasons.push("name");
  if (a.operateRings.some((ring) => b.operateRings.some((other) => ringsOverlap(ring, other)))) reasons.push("overlap");
  return reasons;
}

/** 标记重复时填写的原因最长多少字。 */
export const SHARED_DUPLICATE_REASON_MAX = 500;

/** 平台标记时看到的一个区域在共享库里的情况。 */
export interface DuplicateCandidate {
  id: string;
  cityId: string;
  /** 在共享库里：启用中、原创（不是引用来的副本）、供应商不是测试供应商、没有清退 */
  inLibrary: boolean;
  /** 已经被标成别的区域的重复（隐藏中） */
  hidden: boolean;
  /** 有别的区域被标成它的重复（它是保留的那份） */
  keptFor: number;
}

export type DuplicateMarkProblem =
  /** 被隐藏的那份不在共享库里（停用、删除、是副本、属于测试 / 已清退供应商）：没有可隐藏的 */
  | "SHARED_AREA_NOT_FOUND"
  /** 已经隐藏了 */
  | "SHARED_AREA_ALREADY_HIDDEN"
  /** 它是别的区域的保留那份：先撤销指向它的标记，否则以后的引用会落空 */
  | "SHARED_AREA_IS_KEEP_TARGET"
  /** 保留的那份不在共享库里，或者自己也被隐藏了（不形成链） */
  | "DUPLICATE_KEEP_UNAVAILABLE"
  /** 两个区域不在同一个城市 */
  | "DUPLICATE_CITY_MISMATCH"
  /** 自己标成自己的重复 */
  | "DUPLICATE_SAME_AREA";

/**
 * 把 `hide` 标成 `keep` 的重复（隐藏 hide、以后的引用指向 keep）能不能做；能做返回 null。
 * 规则保证任何时候都没有链：被隐藏的不能当保留的，保留的不能被隐藏，所以「以后的引用」最多转一次。
 * `keep` 为 null 表示保留的那份根本不存在。
 */
export function duplicateMarkProblem(hide: DuplicateCandidate | null, keep: DuplicateCandidate | null): DuplicateMarkProblem | null {
  if (hide === null || !hide.inLibrary) return "SHARED_AREA_NOT_FOUND";
  if (keep !== null && keep.id === hide.id) return "DUPLICATE_SAME_AREA";
  if (hide.hidden) return "SHARED_AREA_ALREADY_HIDDEN";
  if (hide.keptFor > 0) return "SHARED_AREA_IS_KEEP_TARGET";
  if (keep === null || !keep.inLibrary || keep.hidden) return "DUPLICATE_KEEP_UNAVAILABLE";
  if (keep.cityId !== hide.cityId) return "DUPLICATE_CITY_MISMATCH";
  return null;
}
