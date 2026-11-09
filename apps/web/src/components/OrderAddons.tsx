/**
 * 订单详情里的「附加服务」一项（M8-04，ADR 0069「B15 → A」第 4 条）：名称 × 数量。
 * 订单只记附加服务的编号和数量，名称从平台的附加服务目录取（每个角色都能读主数据，`master_data.read`），连已停用的一起。
 * 供应商后台、运营后台的订单详情共用；只显示名称和数量，没有金额（规则 4 不受影响）。没有附加服务时什么都不出。
 */
import type { Addon } from "../api/master.ts";
import { displayName } from "../lib/master-display.ts";
import { useLoad } from "../lib/use-load.ts";

export interface OrderAddon {
  addon_id: string;
  quantity: number;
}

/** 「儿童座椅 × 2、举牌接机 × 1」；目录里找不到的写「已删除的附加服务」，目录没读出来时写编号的前 8 位。 */
export function orderAddonsText(addons: readonly OrderAddon[], catalog: readonly Pick<Addon, "id" | "name">[] | null): string {
  return addons
    .map((addon) => {
      const found = catalog?.find((entry) => entry.id === addon.addon_id);
      const name = found !== undefined ? displayName(found.name).text : catalog === null ? `附加服务 ${addon.addon_id.slice(0, 8)}` : "已删除的附加服务";
      return `${name} × ${addon.quantity}`;
    })
    .join("、");
}

export function OrderAddonsItem({ addons, cacheKey, load }: { addons: readonly OrderAddon[]; cacheKey: string; load(token: string): Promise<Addon[]> }) {
  const catalog = useLoad<Addon[]>(cacheKey, addons.length > 0 ? load : null);
  if (addons.length === 0) return null;
  const ready = catalog.state.status === "ready" ? catalog.state.data : null;
  return (
    <div className="details__item">
      <dt>附加服务</dt>
      <dd>{catalog.state.status === "loading" ? "正在读取附加服务…" : orderAddonsText(addons, ready)}</dd>
    </div>
  );
}
