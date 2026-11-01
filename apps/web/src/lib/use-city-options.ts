import { usePortalSession } from "../auth/PortalSession.tsx";
import { type FilterableCity, type SelectableCity, listCityOptions, listFilterCityOptions } from "../api/city-options.ts";
import { displayName } from "./master-display.ts";
import { type LoadState, useLoad } from "./use-load.ts";

export interface CityOptions<City extends SelectableCity = SelectableCity> {
  state: LoadState<City[]>;
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

function emptyTextOf(status: LoadState<unknown>["status"], scopeCities: ReadonlySet<string> | null, includeDisabled: boolean): string {
  if (status === "forbidden") return "你的角色不能查看城市，请联系管理员调整角色的权限。";
  if (scopeCities !== null) return includeDisabled ? "你的数据范围里没有城市。需要的话，请联系管理员调整你的角色的数据范围。" : "你的数据范围里没有启用中的城市。需要的话，请联系管理员调整你的角色的数据范围。";
  return includeDisabled ? "平台还没有城市" : "平台还没有启用中的城市";
}

function optionsOf<City extends SelectableCity>(loaded: { state: LoadState<City[]>; reload(): void }, scopeCities: ReadonlySet<string> | null, includeDisabled: boolean): CityOptions<City> {
  return {
    state: loaded.state,
    emptyText: emptyTextOf(loaded.state.status, scopeCities, includeDisabled),
    loading: loaded.state.data === null && loaded.state.status === "loading",
    loadFailed: loaded.state.data === null && loaded.state.status === "error",
    reload: loaded.reload,
  };
}

/**
 * 「选城市」下拉的选项（M4-13）：只有启用中的、调用人数据范围里的城市。`enabled` 为 false 时不发请求。
 * 页面上已经选着、却不在选项里的城市（停用了，或不在数据范围里），名字从页面自己的数据里取，用 `unlistedCityLabel` 标出原因。
 */
export function useCityOptions(enabled = true): CityOptions {
  const scopeCities = useScopeCityIds();
  const loaded = useLoad<SelectableCity[]>("city-options", enabled ? (token) => listCityOptions(token).then((page) => page.items) : null);
  return optionsOf(loaded, scopeCities, false);
}

/**
 * 列表「按城市筛选」的选项（订单、商品）：连已停用的城市也列（筛历史数据），标签用 `filterCityLabel` 在已停用的后面标「（已停用）」。
 * 同样只有调用人数据范围里的城市。
 */
export function useFilterCityOptions(enabled = true): CityOptions<FilterableCity> {
  const scopeCities = useScopeCityIds();
  const loaded = useLoad<FilterableCity[]>("city-options:all", enabled ? (token) => listFilterCityOptions(token).then((page) => page.items) : null);
  return optionsOf(loaded, scopeCities, true);
}

/** 筛选下拉里的一个城市：名称，已停用的后面标「（已停用）」。 */
export function filterCityLabel(city: FilterableCity): string {
  const name = displayName(city.name).text;
  return city.status === "disabled" ? `${name}（已停用）` : name;
}

/** 已选着、却不在可选城市里的城市怎么写：限定了城市而它不在范围里写「不在你的数据范围里」，否则就是停用了。 */
export function unlistedCityLabel(id: string, name: string | null, scopeCities: ReadonlySet<string> | null): string {
  const reason = scopeCities !== null && !scopeCities.has(id) ? "不在你的数据范围里" : "已停用";
  return `${name ?? "（名称没有取到）"}（${reason}）`;
}
