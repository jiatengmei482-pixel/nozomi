/** 供应商后台「商品」各页面的地址（docs/design/pages/tenant-products.md 第 1 节）。 */
export const PRODUCT_LIST_PATH = "/products";
export const PRODUCT_NEW_PATH = "/products/new";

/** 有页面的步骤（「开放」的步骤）在地址里的写法。 */
export const PRODUCT_STEP_SLUGS = ["basic", "service-rules", "prices", "inventory", "content", "publish"] as const;
export type ProductStepSlug = (typeof PRODUCT_STEP_SLUGS)[number];

export function productPath(id: string, step?: ProductStepSlug, anchor?: string): string {
  return `${PRODUCT_LIST_PATH}/${id}${step ? `/${step}` : ""}${anchor ? `#${anchor}` : ""}`;
}

/** 第 ③ 步的三个页签；调价规则的新建 / 编辑页在「调价规则」页签下面。 */
export const PRICE_TABS = ["rules", "adjust", "calendar"] as const;
export type PriceTab = (typeof PRICE_TABS)[number];

export function pricePath(id: string, tab: PriceTab = "rules", rest = ""): string {
  return `${productPath(id, "prices")}${tab === "rules" ? "" : `/${tab}`}${rest}`;
}

/** 第 ④ 步库存；`rest` 是后面的分区（导入库存是 `/import`）。 */
export function inventoryPath(id: string, rest = ""): string {
  return `${productPath(id, "inventory")}${rest}`;
}

/** 导入页：价格的在第 ③ 步下面，库存的在第 ④ 步下面。 */
export function importPath(id: string, kind: "prices" | "inventory"): string {
  return `${productPath(id, kind)}/import`;
}
