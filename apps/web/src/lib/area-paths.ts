/** 供应商后台「区域」各页面的地址。 */
export const AREA_LIST_PATH = "/areas";
export const AREA_NEW_PATH = "/areas/new";
export function areaEditPath(id: string): string {
  return `${AREA_LIST_PATH}/${id}`;
}
