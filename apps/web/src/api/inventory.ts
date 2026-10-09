/**
 * 供应商后台「库存」和价格、库存的导入导出（`/tenant/v1/products/{id}/inventory…`、`…/price-rules/export|import…`）。
 * 字段与 `apps/api/openapi.yaml` 对齐，由 inventory.contract.test.ts 保证。
 * 上传的请求体就是 .xlsx 文件本身；确认导入时再传一次同一个文件，并带检查时返回的文件指纹。
 */
import type { InventoryDayStatus, InventoryMode, PriceDirection, PriceRuleStatus, PricingModel } from "@nozomi/domain";
import { query } from "./areas.ts";
import { type DownloadedFile, apiDownload, apiRequest, apiUpload } from "./client.ts";
import type { PriceRules } from "./prices.ts";
import { PRODUCTS_PATH } from "./products.ts";

export interface InventoryDayBody {
  date: string;
  weekday: number;
  /** 这一天一共最多接几单；没设是 null，0 = 停售 */
  total: number | null;
  held: number;
  sold: number;
  /** 还能再接几单；不限量、没设时是 null */
  remaining: number | null;
  status: InventoryDayStatus;
}

export interface InventoryAhead {
  /** 从今天起有几天还有可售库存 */
  sellable_days: number;
  /** 最晚设到哪一天；一天都没设是 null */
  last_set_date: string | null;
}

export interface Inventory {
  /** 商品的版本号：库存的每次修改都用它做 If-Match */
  version: number;
  mode: InventoryMode;
  /** 商品所在城市当地的今天 */
  today: string;
  ahead: InventoryAhead;
  days: InventoryDayBody[];
}

export interface InventoryBatchInput {
  from: string;
  to: string;
  /** 1 = 周一 … 7 = 周日；空数组 = 每天 */
  weekdays: number[];
  /** null = 清除，0 = 停售 */
  total: number | null;
}

export interface ImportCellIssue {
  /** 单元格的位置，如 F7 */
  cell: string;
  column: string;
  reason: string;
  message: string;
}

export type InventoryImportAction = "set" | "clear" | "unchanged" | "error" | "conflict";
export interface InventoryImportSummary {
  rows: number;
  set: number;
  clear: number;
  unchanged: number;
  error: number;
  conflict: number;
}
export interface InventoryImportRow {
  row: number;
  date: string | null;
  action: InventoryImportAction;
  total: number | null;
  occupied: number;
  issues: ImportCellIssue[];
}
export interface InventoryImportPreview {
  version: number;
  file_sha256: string;
  can_import: boolean;
  summary: InventoryImportSummary;
  rows: InventoryImportRow[];
}

export type PriceImportAction = "create" | "update" | "unchanged" | "error" | "conflict";
export interface PriceImportSummary {
  rows: number;
  create: number;
  update: number;
  unchanged: number;
  error: number;
  conflict: number;
}
export interface PriceImportContent {
  area: string | null;
  vehicle_group: string | null;
  direction: PriceDirection | null;
  package_hours: number | null;
  pricing_model: PricingModel | null;
  main_price: number | null;
  valid_from: string | null;
  valid_to: string | null;
  status: PriceRuleStatus;
}
export interface PriceImportConflict {
  /** 和文件里的哪一行冲突；和已有的价格冲突时是 null */
  row: number | null;
  price_rule_id: string | null;
  area: string | null;
  vehicle_group: string | null;
  direction: PriceDirection | null;
  package_hours: number | null;
  valid_from: string | null;
  valid_to: string | null;
}
export interface PriceImportRow {
  row: number;
  action: PriceImportAction;
  price_rule_id: string | null;
  content: PriceImportContent;
  issues: ImportCellIssue[];
  conflicts_with: PriceImportConflict[];
}
export interface PriceImportPreview {
  version: number;
  file_sha256: string;
  currency: string | null;
  can_import: boolean;
  summary: PriceImportSummary;
  rows: PriceImportRow[];
}

const product = (id: string): string => `${PRODUCTS_PATH}/${encodeURIComponent(id)}`;
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

export const INVENTORY_QUERY_KEYS = ["from", "to"] as const;

export function getInventory(token: string, productId: string, range: { from: string; to: string }): Promise<Inventory> {
  return apiRequest("GET", query(`${product(productId)}/inventory`, range), { token });
}

export function setInventoryMode(token: string, productId: string, version: number, mode: InventoryMode): Promise<{ version: number; mode: InventoryMode }> {
  return apiRequest("PUT", `${product(productId)}/inventory`, { token, body: { mode }, headers: ifMatch(version) });
}

export function batchSetInventory(token: string, productId: string, version: number, batch: InventoryBatchInput): Promise<Inventory & { changed_days: number }> {
  return apiRequest("POST", `${product(productId)}/inventory/batch-set`, { token, body: batch, headers: ifMatch(version) });
}

export function exportInventory(token: string, productId: string, range: { from: string; to: string }): Promise<DownloadedFile> {
  return apiDownload(query(`${product(productId)}/inventory/export`, range), { token });
}

export function exportPrices(token: string, productId: string, rows: "all" | "none"): Promise<DownloadedFile> {
  return apiDownload(`${product(productId)}/price-rules/export?rows=${rows}`, { token });
}

export function previewInventoryImport(token: string, productId: string, file: Blob, signal?: AbortSignal): Promise<InventoryImportPreview> {
  return apiUpload(`${product(productId)}/inventory/import/preview`, file, { token, ...(signal ? { signal } : {}) });
}

export function previewPriceImport(token: string, productId: string, file: Blob, signal?: AbortSignal): Promise<PriceImportPreview> {
  return apiUpload(`${product(productId)}/price-rules/import/preview`, file, { token, ...(signal ? { signal } : {}) });
}

export interface ImportConfirm {
  file: Blob;
  fileSha256: string;
  version: number;
  idempotencyKey: string;
}
const confirmHeaders = (confirm: ImportConfirm): Record<string, string> => ({ ...ifMatch(confirm.version), "idempotency-key": confirm.idempotencyKey });

export function importInventory(token: string, productId: string, confirm: ImportConfirm): Promise<{ version: number; changed_days: number; summary: InventoryImportSummary }> {
  return apiUpload(`${product(productId)}/inventory/import?file_sha256=${encodeURIComponent(confirm.fileSha256)}`, confirm.file, { token, headers: confirmHeaders(confirm) });
}

export function importPrices(token: string, productId: string, confirm: ImportConfirm): Promise<PriceRules & { summary: PriceImportSummary }> {
  return apiUpload(`${product(productId)}/price-rules/import?file_sha256=${encodeURIComponent(confirm.fileSha256)}`, confirm.file, { token, headers: confirmHeaders(confirm) });
}

/** 对账用：每个类型的字段名清单。 */
export const INVENTORY_SCHEMA_FIELDS = {
  Inventory: ["version", "mode", "today", "ahead", "days"],
  InventoryMode: ["version", "mode"],
  InventoryBatch: ["from", "to", "weekdays", "total"],
  ImportCellIssue: ["cell", "column", "reason", "message"],
  InventoryImportSummary: ["rows", "set", "clear", "unchanged", "error", "conflict"],
  ImportSummary: ["rows", "create", "update", "unchanged", "error", "conflict"],
  InventoryImportPreview: ["version", "file_sha256", "can_import", "summary", "rows"],
  PriceImportPreview: ["version", "file_sha256", "currency", "can_import", "summary", "rows"],
  InventoryImportResult: ["version", "changed_days", "summary"],
} as const satisfies {
  Inventory: readonly (keyof Inventory)[];
  InventoryMode: readonly ("version" | "mode")[];
  InventoryBatch: readonly (keyof InventoryBatchInput)[];
  ImportCellIssue: readonly (keyof ImportCellIssue)[];
  InventoryImportSummary: readonly (keyof InventoryImportSummary)[];
  ImportSummary: readonly (keyof PriceImportSummary)[];
  InventoryImportPreview: readonly (keyof InventoryImportPreview)[];
  PriceImportPreview: readonly (keyof PriceImportPreview)[];
  InventoryImportResult: readonly ("version" | "changed_days" | "summary")[];
};
export const INVENTORY_NESTED_FIELDS = {
  day: ["date", "weekday", "total", "held", "sold", "remaining", "status"],
  ahead: ["sellable_days", "last_set_date"],
  inventoryRow: ["row", "date", "action", "total", "occupied", "issues"],
  priceRow: ["row", "action", "price_rule_id", "content", "issues", "conflicts_with"],
  priceContent: ["area", "vehicle_group", "direction", "package_hours", "pricing_model", "main_price", "valid_from", "valid_to", "status"],
  priceConflict: ["row", "price_rule_id", "area", "vehicle_group", "direction", "package_hours", "valid_from", "valid_to"],
} as const satisfies {
  day: readonly (keyof InventoryDayBody)[];
  ahead: readonly (keyof InventoryAhead)[];
  inventoryRow: readonly (keyof InventoryImportRow)[];
  priceRow: readonly (keyof PriceImportRow)[];
  priceContent: readonly (keyof PriceImportContent)[];
  priceConflict: readonly (keyof PriceImportConflict)[];
};
/** 读不了的文件的原因（`IMPORT_FILE_INVALID` 的 `details.reason`）。 */
export const IMPORT_FILE_REASONS = ["NOT_XLSX", "CORRUPT", "TOO_LARGE", "UNSAFE", "EMPTY", "MISSING_COLUMNS", "TOO_MANY_ROWS"] as const;
/** 页面专门处理的错误码和原因。 */
export const INVENTORY_ERROR_CODES = ["INVENTORY_BELOW_OCCUPIED", "IMPORT_FILE_INVALID", "IMPORT_FILE_CHANGED", "IMPORT_NOT_CLEAN", "VERSION_CONFLICT", "CONCURRENT_UPDATE", "PUBLISH_CHECK_FAILED", "NO_INVENTORY_AHEAD", "DATE_IN_PAST", "TOO_FAR_AHEAD", "TOO_MANY", "DATE_RANGE_REVERSED", "NO_DAY_SELECTED", "OUT_OF_RANGE", "NOT_INTEGER", ...IMPORT_FILE_REASONS] as const;
/** 上传的文件最大多少字节（和后端的上限一致，页面先拦）。 */
export const IMPORT_MAX_BYTES = 1_048_576;
