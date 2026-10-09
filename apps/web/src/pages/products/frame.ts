/** 商品分步编辑各步骤和外层框架之间的约定。 */
import type { Product, PublishCheckResult } from "../../api/products.ts";
import type { CheckContext } from "../../lib/product-display.ts";

export interface ProductFrame {
  /** 新建页上（还没保存过）是 null */
  product: Product | null;
  /** 整个商品只有一个版本号，各步共用；每次保存成功后更新 */
  version: number;
  readOnly: boolean;
  /** 上架检查的结果；没取到是 null */
  check: PublishCheckResult | null;
  checkContext: CheckContext | null;
  /** 一步保存成功：记下新的版本号（带了商品就一并换上），并重新取检查结果 */
  saved(version: number, product?: Product): void;
  /** 只同步版本号（进入一步、取到它自己的内容时） */
  syncVersion(version: number): void;
  /** 重新取商品和检查结果 */
  refresh(): void;
  /** 回列表的地址（带着来时的筛选条件）和要带回去的翻页位置 */
  listPath: string;
  listState: unknown;
}

/** 一处要改的地方：`target` 是页面上元素的 id，点了把焦点带过去。 */
export interface StepProblem {
  text: string;
  target: string;
}

/** 把焦点带到某个锚点：它自己能聚焦就聚焦它，否则聚焦里面第一个能操作的控件。 */
export function focusAnchor(id: string): boolean {
  const node = document.getElementById(id);
  if (!node) return false;
  const target = node.matches("input, select, textarea, button, a[href], [tabindex]") ? node : (node.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])") ?? node);
  target.scrollIntoView?.({ block: "center" });
  target.focus();
  return true;
}
