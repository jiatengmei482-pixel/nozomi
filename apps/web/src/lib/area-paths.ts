/** 供应商后台「区域」各页面的地址。 */
export const AREA_LIST_PATH = "/areas";
export const AREA_NEW_PATH = "/areas/new";
/** 区域地图（M8-18）：供应商后台看全部区域、重叠；运营后台只读看全部供应商的。 */
export const AREA_MAP_PATH = "/areas/map";
export const PLATFORM_AREA_MAP_PATH = "/platform/areas/map";
export function areaEditPath(id: string): string {
  return `${AREA_LIST_PATH}/${id}`;
}
