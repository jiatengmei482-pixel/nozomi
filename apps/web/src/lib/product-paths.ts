/** 供应商后台「商品」各页面的地址（docs/design/pages/tenant-products.md 第 1 节）。 */
export const PRODUCT_LIST_PATH = "/products";
export const PRODUCT_NEW_PATH = "/products/new";

/** 有页面的步骤（「开放」的步骤）在地址里的写法。 */
export const PRODUCT_STEP_SLUGS = ["basic", "service-rules", "prices", "inventory", "content", "publish"] as const;
export type ProductStepSlug = (typeof PRODUCT_STEP_SLUGS)[number];

/** 商品各步骤的地址，放在 `base` 下：供应商后台是 `/products`，运营后台只读查看是 `/platform/products`。 */
export interface ProductPaths {
  /** 商品某一步的地址；`anchor` 是那一步里某个字段的锚点 */
  step(id: string, step?: ProductStepSlug, anchor?: string): string;
  /** 第 ③ 步的页签；`rest` 是后面的分区（某一条调价规则） */
  price(id: string, tab?: PriceTab, rest?: string): string;
}

export function productPathsUnder(base: string): ProductPaths {
  const step = (id: string, slug?: ProductStepSlug, anchor?: string): string => `${base}/${id}${slug ? `/${slug}` : ""}${anchor ? `#${anchor}` : ""}`;
  return { step, price: (id, tab = "rules", rest = "") => `${step(id, "prices")}${tab === "rules" ? "" : `/${tab}`}${rest}` };
}

const TENANT_PATHS = productPathsUnder(PRODUCT_LIST_PATH);

export function productPath(id: string, step?: ProductStepSlug, anchor?: string): string {
  return TENANT_PATHS.step(id, step, anchor);
}

/** 第 ③ 步的三个页签；调价规则的新建 / 编辑页在「调价规则」页签下面。 */
export const PRICE_TABS = ["rules", "adjust", "calendar"] as const;
export type PriceTab = (typeof PRICE_TABS)[number];

export function pricePath(id: string, tab: PriceTab = "rules", rest = ""): string {
  return TENANT_PATHS.price(id, tab, rest);
}

/** 第 ④ 步库存；`rest` 是后面的分区（导入库存是 `/import`）。 */
export function inventoryPath(id: string, rest = ""): string {
  return `${productPath(id, "inventory")}${rest}`;
}

/** 导入页：价格的在第 ③ 步下面，库存的在第 ④ 步下面。 */
export function importPath(id: string, kind: "prices" | "inventory"): string {
  return `${productPath(id, kind)}/import`;
}
