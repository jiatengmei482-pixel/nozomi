/**
 * 商品各步骤的数据从哪来、页面里的链接指向哪。
 *
 * 同一组步骤组件有两个用处：供应商后台里配置自己的商品（数据来自 `/tenant/v1`），
 * 运营后台里只读查看某个供应商的商品（数据来自 `GET /platform/v1/products/{id}` 一次取回的详情，ADR 0021）。
 * 步骤组件不直接调接口、不直接拼地址，都经由这里。
 */
import { fetchPlatformAreaMap } from "../../api/area-map.ts";
import type { AreaSummary } from "../../api/areas.ts";
import type { VehicleGroup } from "../../api/master.ts";
import { type AddonOption, listAddonOptions } from "../../api/master-options.ts";
import { getPlatformHolidays } from "../../api/platform-products.ts";
import { type AdjustRules, type Holidays, type PriceRules, getAdjustRules, getHolidays, getPriceRules } from "../../api/prices.ts";
import { type ProductContentResponse, type ProductServiceRules, getProductContent, getServiceRules, listAllAreas, listTenantAddons, listTenantVehicleGroups } from "../../api/products.ts";
import { PRODUCT_LIST_PATH, type PriceTab, type ProductPaths, productPathsUnder } from "../../lib/product-paths.ts";

export interface ProductSource {
  /** `tenant`：供应商自己；`platform`：运营后台只读查看 */
  portal: "tenant" | "platform";
  paths: ProductPaths;
  /** 第 ③ 步有哪些页签（运营后台还没有价格日历的接口） */
  priceTabs: readonly PriceTab[];
  /** 能不能下载价格的 Excel（导出接口只在供应商后台） */
  canExportPrices: boolean;
  serviceRules(token: string, id: string): Promise<ProductServiceRules>;
  content(token: string, id: string): Promise<ProductContentResponse>;
  priceRules(token: string, id: string): Promise<PriceRules>;
  adjustRules(token: string, id: string): Promise<AdjustRules>;
  /** 平台的车型组（连已停用的）；不需要时为 null（只读查看时商品里已经带着所选车型组的全部信息） */
  vehicleGroups: ((token: string) => Promise<VehicleGroup[]>) | null;
  /** 平台的附加服务目录（连已停用的）：供应商后台走租户的主数据，运营后台走附加服务选项接口（ADR 0047） */
  addons(token: string): Promise<AddonOption[]>;
  holidays(token: string, values: { from: string; to: string }): Promise<Holidays>;
  /**
   * 供应商的全部区域（连已停用的）：包车「区域加价」块取加价区域的名字、城市、状态，供应商后台还用来列「选择区域」的选项（M8-12a）。
   * 供应商后台走 `/tenant/v1/areas`（要能看区域）；运营后台走区域地图接口（看商品的权限就能看，ADR 0074）。
   */
  areas(token: string): Promise<AreaSummary[]>;
  /** 运营后台查看时商品属于哪个供应商（区域地图按它取）；供应商后台是 null */
  tenantId: string | null;
}

/** 供应商后台：每一步各自取自己的内容。 */
export const TENANT_PRODUCT_SOURCE: ProductSource = {
  portal: "tenant",
  paths: productPathsUnder(PRODUCT_LIST_PATH),
  priceTabs: ["rules", "adjust", "calendar"],
  canExportPrices: true,
  serviceRules: getServiceRules,
  content: getProductContent,
  priceRules: getPriceRules,
  adjustRules: getAdjustRules,
  vehicleGroups: listTenantVehicleGroups,
  addons: listTenantAddons,
  holidays: getHolidays,
  areas: (token) => listAllAreas(token),
  tenantId: null,
};

/** 运营后台只读查看的详情：各部分已经一次取回，步骤组件拿到的就是这一份。 */
export interface PlatformProductParts {
  serviceRules: ProductServiceRules;
  content: ProductContentResponse;
  priceRules: PriceRules;
  adjustRules: AdjustRules;
  /** 商品属于哪个供应商（区域加价的区域名字按它取） */
  tenantId: string;
}

/** 运营后台：商品的各部分来自同一份详情；主数据目录和节假日走平台自己的接口。 */
export function platformProductSource(base: string, parts: PlatformProductParts): ProductSource {
  return {
    portal: "platform",
    paths: productPathsUnder(base),
    priceTabs: ["rules", "adjust"],
    canExportPrices: false,
    serviceRules: () => Promise.resolve(parts.serviceRules),
    content: () => Promise.resolve(parts.content),
    priceRules: () => Promise.resolve(parts.priceRules),
    adjustRules: () => Promise.resolve(parts.adjustRules),
    vehicleGroups: null,
    addons: listAddonOptions,
    holidays: getPlatformHolidays,
    areas: async (token) => (await fetchPlatformAreaMap(token, { tenant_id: parts.tenantId, status: "all" })).items,
    tenantId: parts.tenantId,
  };
}
