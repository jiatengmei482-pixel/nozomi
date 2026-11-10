/**
 * 409 `PRICING_AREA_OUTSIDE_OPERATING`（M8-20，ADR 0075 第一部分第 2 节）：停用、删除、改小运营区域、把「运营 + 报价」改成报价区域之后，
 * 已上架商品勾选的报价区域会有一部分不在任何运营区域里——列出是哪些商品、哪个报价区域、超出多少，商品可以点进去。
 * 接口只给区域编号：名字从区域地图（本供应商全部区域）里找；找不到时只写「报价区域」。
 */
import { fetchTenantAreaMap } from "../../api/area-map.ts";
import { Link } from "react-router";
import { type OutsideImpact, outsideImpactText } from "../../lib/area-roles.ts";
import { displayName } from "../../lib/master-display.ts";
import { productPath } from "../../lib/product-paths.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";

export function OutsideImpacts({ impacts, knownNames }: { impacts: readonly OutsideImpact[]; knownNames?: ReadonlyMap<string, string> }) {
  const canSeeProducts = useTenantCan("product.read");
  const missing = impacts.some((impact) => !knownNames?.has(impact.areaId));
  const names = useLoad(`outside-impact-names:${impacts.map((impact) => impact.areaId).join(",")}`, missing && impacts.length > 0 ? (token) => fetchTenantAreaMap(token) : null);
  const nameOf = (id: string): string | null => {
    const known = knownNames?.get(id);
    if (known !== undefined) return known;
    const found = names.state.data?.items.find((item) => item.id === id);
    return found ? displayName(found.name).text : null;
  };
  if (impacts.length === 0) return null;
  return (
    <ul className="outside-impacts">
      {impacts.map((impact) => (
        <li key={`${impact.productId}:${impact.areaId}`}>
          {canSeeProducts ? (
            <Link className="link" to={productPath(impact.productId, "basic", "areas")}>
              {outsideImpactText(impact, nameOf(impact.areaId))}
            </Link>
          ) : (
            <span>{outsideImpactText(impact, nameOf(impact.areaId))}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
