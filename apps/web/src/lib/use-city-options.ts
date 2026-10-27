import { usePortalSession } from "../auth/PortalSession.tsx";
import { type SelectableCity, listCityOptions } from "../api/city-options.ts";
import { type LoadState, useLoad } from "./use-load.ts";

export interface CityOptions {
  state: LoadState<SelectableCity[]>;
  /** 列表为空时下拉里写的话：说清是平台没有、数据范围里没有，还是角色看不到 */
  emptyText: string;
  loading: boolean;
  loadFailed: boolean;
  reload(): void;
}

/** 当前员工的数据范围限定了城市时，城市编号的集合；不限时为 null。账号信息还没取回来按不限。 */
export function useScopeCityIds(): ReadonlySet<string> | null {
  const { portal, account } = usePortalSession();
  if (portal.key !== "platform" || account.status !== "ready") return null;
  const ids = account.account.dataScope.cityIds;
  return ids === null ? null : new Set(ids);
}

/**
 * 「选城市」下拉的选项（M4-13）：只有启用中的、调用人数据范围里的城市。`enabled` 为 false 时不发请求。
 * 页面上已经选着、却不在选项里的城市（停用了，或不在数据范围里），名字从页面自己的数据里取，用 `unlistedCityLabel` 标出原因。
 */
export function useCityOptions(enabled = true): CityOptions {
  const scopeCities = useScopeCityIds();
  const loaded = useLoad<SelectableCity[]>("city-options", enabled ? (token) => listCityOptions(token).then((page) => page.items) : null);
  const emptyText =
    loaded.state.status === "forbidden"
      ? "你的角色不能查看城市，请联系管理员调整角色的权限。"
      : scopeCities !== null
        ? "你的数据范围里没有启用中的城市。需要的话，请联系管理员调整你的角色的数据范围。"
        : "平台还没有启用中的城市";
  return {
    state: loaded.state,
    emptyText,
    loading: loaded.state.data === null && loaded.state.status === "loading",
    loadFailed: loaded.state.data === null && loaded.state.status === "error",
    reload: loaded.reload,
  };
}

/** 已选着、却不在可选城市里的城市怎么写：限定了城市而它不在范围里写「不在你的数据范围里」，否则就是停用了。 */
export function unlistedCityLabel(id: string, name: string | null, scopeCities: ReadonlySet<string> | null): string {
  const reason = scopeCities !== null && !scopeCities.has(id) ? "不在你的数据范围里" : "已停用";
  return `${name ?? "（名称没有取到）"}（${reason}）`;
}
