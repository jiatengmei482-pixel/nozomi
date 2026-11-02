/**
 * 价格表导入（ADR 0062）要读的东西。全是读：写一律走现有的服务函数（子品牌、区域、商品、价格规则），不在这里拼写入的 SQL。
 */
import type { LocalizedText } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

/**
 * 目标环境的只读导出：租户、官网渠道的定价参数和没删除的加价规则、一个国家的城市和机场、全部车型组。
 * 参数：$1 租户编号、$2 渠道编号、$3 国家码。结果是一行一列的 JSON，字段名和表的列名一致，由 domain 的 `parsePriceImportTarget` 解析。
 * 命令行连数据库时直接执行它；不能连的环境（staging）由有权限的人用 `--print-target-sql` 打印出来、只读执行、把结果存成文件交给 `--target`。
 */
export const PRICE_IMPORT_TARGET_SQL = `select json_build_object(
  'tenant', (select json_build_object('id', t.id, 'name', t.name, 'status', t.status) from tenants t where t.id = $1::uuid),
  'channel', (select json_build_object('id', c.id, 'name', c.name, 'settle_currency', c.settle_currency, 'default_markup_bp', c.default_markup_bp,
                'markup_floor_bp', c.markup_floor_bp, 'min_margin_minor', c.min_margin_minor, 'sell_rounding', c.sell_rounding)
              from channels c where c.id = $2::uuid),
  'markup_rules', coalesce((select json_agg(json_build_object('id', r.id, 'level', r.level, 'supplier_tenant_id', r.supplier_tenant_id, 'city_id', r.city_id,
                'category', r.category, 'vehicle_group_id', r.vehicle_group_id, 'markup_bp', r.markup_bp, 'valid_from', r.valid_from, 'valid_to', r.valid_to) order by r.id)
              from markup_rules r where r.channel_id = $2::uuid and r.deleted_at is null), '[]'::json),
  'cities', coalesce((select json_agg(json_build_object('id', ci.id, 'code', ci.code, 'status', ci.status, 'name', ci.name) order by ci.code)
              from cities ci where ci.country_code = $3::text), '[]'::json),
  'places', coalesce((select json_agg(json_build_object('id', p.id, 'code', p.code, 'type', p.type, 'status', p.status, 'city_id', p.city_id, 'name', p.name) order by p.code)
              from places p where p.country_code = $3::text and p.type = 'airport'), '[]'::json),
  'vehicle_groups', coalesce((select json_agg(json_build_object('id', v.id, 'code', v.code, 'status', v.status, 'combos', v.combos) order by v.code)
              from vehicle_groups v), '[]'::json)
) as target`;

/** 在平台事务里执行上面的导出（只读）。 */
export async function loadPriceImportTarget(db: Db, tenantId: string, channelId: string, countryCode: string): Promise<unknown> {
  const result = await db.query<{ target: unknown }>(PRICE_IMPORT_TARGET_SQL, [tenantId, channelId, countryCode]);
  return result.rows[0]?.target ?? null;
}

export interface TenantAreaKey {
  id: string;
  cityId: string;
  name: LocalizedText;
  nameKeys: string[];
  /** 这个区域有营运区图形的备注名是这一批的标记（这一批建的） */
  inBatch: boolean;
  /** 选了它的商品 */
  usedBy: string[];
}

/** 本租户在这些城市里的全部区域（名称和是不是这一批建的），用来认出这一批的区域、事先发现重名。在租户事务里调用。 */
export async function findTenantAreaKeys(db: Db, tenantId: string, label: string, cityIds: readonly string[] | null): Promise<TenantAreaKey[]> {
  const result = await db.query<{ id: string; city_id: string; name: LocalizedText; name_keys: string[]; in_batch: boolean; used_by: string[] }>(
    `select a.id, a.city_id, a.name, a.name_keys,
            exists (select 1 from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id and p.kind = 'operate' and p.label = $2) as in_batch,
            coalesce((select array_agg(pa.product_id::text order by pa.product_id) from product_areas pa where pa.tenant_id = a.tenant_id and pa.area_id = a.id), '{}') as used_by
       from areas a
      where a.tenant_id = $1 and ($3::uuid[] is null or a.city_id = any($3::uuid[]))
      order by a.created_at, a.id`,
    [tenantId, label, cityIds],
  );
  return result.rows.map((row) => ({ id: row.id, cityId: row.city_id, name: row.name, nameKeys: row.name_keys, inBatch: row.in_batch, usedBy: row.used_by }));
}
