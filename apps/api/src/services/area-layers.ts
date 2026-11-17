/**
 * 区域在哪些商品里当哪一层用（M9P-13，ADR 0093 第一节、第七节「后续」；规格第四节第 3 小节）：
 * ① 基础价区域 = 商品的服务区域（`product_areas`）；② 行程区域 = `charter_itinerary_surcharge` 规则的区域；③ 上下车加价区域 = `charter_area_surcharge` 规则的区域。
 * 接送机、点对点商品只有①（服务区域）。规则不分启用停用都算（和保存时的三层重叠校验 `assertNoCharterLayerOverlap` 同一个口径）。
 *
 * 另：区域页改了图形之后，用到这个区域的包车商品里有没有三层重叠（#247 审查建议）——只提醒、不拦保存（运营改区域时不应被已有的价格卡住；
 * 新的重叠在上架检查里同样列出，见 products.ts `charter_layer_overlap`）。
 * 租户编号只来自令牌：全部查询带 `tenant_id`，在租户事务里执行（行级安全）。
 */
import { type CharterLayerOverlap, type LocalizedText, type ServiceCategory, charterLayerOverlaps } from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import { type Db, withTenantTx } from "../db/context.ts";
import { areaShapeInput, listTenantAreaShapes } from "../repos/areas.ts";

type Row = Record<string, any>;

export interface ProductAreaLayers {
  productId: string;
  code: string;
  /** 商品详情里各语言的标题（没填的语言不在里面） */
  title: LocalizedText;
  category: ServiceCategory;
  status: string;
  /** 包车商品迁移过三层区域没有（ADR 0093 第一节）；不是包车时为 null */
  charterLayout: string | null;
  base: string[];
  itinerary: string[];
  updown: string[];
}

/** 本供应商每个商品的三层区域（没有选任何区域的商品不列）。按商品编码排。 */
export async function listProductAreaLayers(db: Db, tenantId: string): Promise<ProductAreaLayers[]> {
  const result = await db.query<Row>(
    `select p.id, p.code, p.category, p.status, p.charter_layout, p.content,
            array(select pa.area_id::text from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id order by pa.priority, pa.area_id) as base,
            array(select distinct r.area_id::text from price_rules r where r.tenant_id = p.tenant_id and r.product_id = p.id and r.area_id is not null and r.pricing_model = 'charter_itinerary_surcharge') as itinerary,
            array(select distinct r.area_id::text from price_rules r where r.tenant_id = p.tenant_id and r.product_id = p.id and r.area_id is not null and r.pricing_model = 'charter_area_surcharge') as updown
       from products p
      where p.tenant_id = $1
      order by p.code, p.id`,
    [tenantId],
  );
  return result.rows
    .map((row) => {
      const content = (row["content"] ?? {}) as Record<string, { title?: unknown } | undefined>;
      const title: LocalizedText = {};
      for (const [language, text] of Object.entries(content)) if (typeof text?.title === "string" && text.title.trim() !== "") (title as Record<string, string>)[language] = text.title;
      return {
        productId: row["id"] as string,
        code: row["code"] as string,
        title,
        category: row["category"] as ServiceCategory,
        status: row["status"] as string,
        charterLayout: row["category"] === "charter" ? ((row["charter_layout"] as string | null) ?? null) : null,
        base: row["base"] as string[],
        itinerary: row["itinerary"] as string[],
        updown: row["updown"] as string[],
      };
    })
    .filter((product) => product.base.length + product.itinerary.length + product.updown.length > 0);
}

export function tenantAreaLayers(ctx: DbContext, tenantId: string): Promise<ProductAreaLayers[]> {
  return withTenantTx(ctx.pool, tenantId, (db) => listProductAreaLayers(db, tenantId), { snapshot: true });
}

export interface AreaCharterOverlap {
  productId: string;
  code: string;
  title: LocalizedText;
  overlapCode: CharterLayerOverlap["code"];
  layer: CharterLayerOverlap["layer"];
  /** 和这个区域重叠的那个区域（①∩③时它在哪一层，看这个区域在这个商品里是①还是③） */
  otherAreaId: string;
  otherAreaName: LocalizedText;
  areaM2: number;
}

/**
 * 用到 `areaId` 的包车商品里，这个区域和同商品别的区域的三层重叠（同层、①∩③），按商品编码、区域排。
 * 口径和保存价格、服务区域时的校验一样（`charterLayerOverlaps`，把这个区域当作「新加的」），只是不拦，返回给页面提醒。
 */
export async function charterOverlapsOfArea(db: Db, tenantId: string, areaId: string): Promise<AreaCharterOverlap[]> {
  const products = (await listProductAreaLayers(db, tenantId)).filter((product) => product.category === "charter" && [...product.base, ...product.itinerary, ...product.updown].includes(areaId));
  if (products.length === 0) return [];
  const shapes = (await listTenantAreaShapes(db, tenantId)).map(areaShapeInput);
  const found: AreaCharterOverlap[] = [];
  for (const product of products) {
    const layers = { base: product.base, itinerary: product.itinerary, updown: product.updown };
    const mine = (ids: readonly string[]): string[] => (ids.includes(areaId) ? [areaId] : []);
    for (const entry of charterLayerOverlaps(shapes, layers, { base: mine(product.base), itinerary: mine(product.itinerary), updown: mine(product.updown) })) {
      if (entry.a !== areaId && entry.b !== areaId) continue;
      found.push({ productId: product.productId, code: product.code, title: product.title, overlapCode: entry.code, layer: entry.layer, otherAreaId: entry.a === areaId ? entry.b : entry.a, otherAreaName: {}, areaM2: entry.areaM2 });
    }
  }
  if (found.length === 0) return found;
  const names = await db.query<Row>("select id, name from areas where tenant_id = $1 and id = any($2::uuid[])", [tenantId, [...new Set(found.map((entry) => entry.otherAreaId))]]);
  const nameOf = new Map(names.rows.map((row) => [row["id"] as string, row["name"] as LocalizedText]));
  return found.map((entry) => ({ ...entry, otherAreaName: nameOf.get(entry.otherAreaId) ?? {} }));
}
