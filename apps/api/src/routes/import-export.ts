/**
 * 价格规则和库存的 Excel 导入导出接口（M1-05）。这里只做鉴权、取上传的文件、调用、返回；流程在 services/import-export.ts。
 * 上传：请求体就是 .xlsx 文件本身（`Content-Type` 用 xlsx 的类型或 `application/octet-stream`），最大 1 MB；不用表单。
 * 租户编号只来自令牌。导出和预览里只有供应商自己的结算价和库存，没有对外价和加价比例。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { TenantAction } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { XLSX_CONTENT_TYPE, XLSX_LIMITS } from "../integrations/xlsx.ts";
import {
  type CellIssue,
  type ExportedFile,
  type ImportSummary,
  type InventoryImportPreview,
  type PriceImportPreview,
  exportInventory,
  exportPriceRules,
  importInventory,
  importPriceRules,
  previewInventoryImport,
  previewPriceImport,
} from "../services/import-export.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { idempotencyKey, ifMatchVersion, parseInput, resourceId } from "../validation.ts";
import { priceRulesJson } from "./prices.ts";

type Json = Record<string, unknown>;

const shaQuerySchema = z.object({ file_sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "要给预览返回的文件指纹（64 位十六进制）") });
const exportQuerySchema = z.object({ rows: z.enum(["all", "none"]).default("all") });
const rangeQuerySchema = z.object({ from: z.string().max(10), to: z.string().max(10) });

function uploaded(request: FastifyRequest): Buffer {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", `请把 .xlsx 文件本身作为请求体上传，Content-Type 用 ${XLSX_CONTENT_TYPE}`);
  }
  return request.body;
}

const issueJson = (issue: CellIssue): Json => ({ cell: issue.cell, column: issue.column, reason: issue.reason, message: issue.message });
const summaryJson = (summary: ImportSummary): Json => ({ rows: summary.rows, create: summary.create, update: summary.update, unchanged: summary.unchanged, error: summary.error, conflict: summary.conflict });

function pricePreviewJson(preview: PriceImportPreview): Json {
  return {
    version: preview.version,
    file_sha256: preview.fileSha256,
    currency: preview.currency,
    can_import: preview.canImport,
    summary: summaryJson(preview.summary),
    rows: preview.rows.map((row) => ({
      row: row.row,
      action: row.action,
      price_rule_id: row.priceRuleId,
      issues: row.issues.map(issueJson),
      conflicts_with: row.conflictsWith.map((other) => ({ row: other.row, price_rule_id: other.id, valid_from: other.validFrom, valid_to: other.validTo })),
    })),
  };
}

function inventoryPreviewJson(preview: InventoryImportPreview): Json {
  return {
    version: preview.version,
    file_sha256: preview.fileSha256,
    can_import: preview.canImport,
    summary: preview.summary,
    rows: preview.rows.map((row) => ({ row: row.row, date: row.date, action: row.action, total: row.total, occupied: row.occupied, issues: row.issues.map(issueJson) })),
  };
}

export function registerImportExportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });
  // 上传的文件原样拿到（不解析成 JSON、不当文字）
  for (const type of [XLSX_CONTENT_TYPE, "application/octet-stream"]) app.addContentTypeParser(type, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const upload = { bodyLimit: XLSX_LIMITS.maxFileBytes };
  const download = (reply: { header(name: string, value: string): unknown; send(body: Buffer): unknown }, file: ExportedFile): unknown => {
    reply.header("content-type", XLSX_CONTENT_TYPE);
    reply.header("content-disposition", `attachment; filename="${file.fileName}"`);
    return reply.send(file.content);
  };

  app.get("/tenant/v1/products/:id/price-rules/export", async (request, reply) => {
    const principal = await authenticate(request, "product.read");
    const productId = resourceId(request.params, "商品");
    const query = parseInput(exportQuerySchema, request.query, "querystring");
    return download(reply, await exportPriceRules(ctx, principal.tenantId, productId, query.rows === "all"));
  });

  app.post("/tenant/v1/products/:id/price-rules/import/preview", upload, async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    return pricePreviewJson(await previewPriceImport(ctx, principal.tenantId, productId, uploaded(request)));
  });

  app.post("/tenant/v1/products/:id/price-rules/import", upload, async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const version = ifMatchVersion(request.headers["if-match"]);
    const query = parseInput(shaQuerySchema, request.query, "querystring");
    const result = await importPriceRules(ctx, { principal, ip: request.ip }, productId, version, uploaded(request), query.file_sha256, { scope: "POST /tenant/v1/products/:id/price-rules/import", key }, (saved) => ({
      ...priceRulesJson(saved.view),
      summary: summaryJson(saved.summary),
    }));
    return reply.code(result.status).send(result.body);
  });

  app.get("/tenant/v1/products/:id/inventory/export", async (request, reply) => {
    const principal = await authenticate(request, "product.read");
    const productId = resourceId(request.params, "商品");
    const query = parseInput(rangeQuerySchema, request.query, "querystring");
    return download(reply, await exportInventory(ctx, principal.tenantId, productId, query.from, query.to));
  });

  app.post("/tenant/v1/products/:id/inventory/import/preview", upload, async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    return inventoryPreviewJson(await previewInventoryImport(ctx, principal.tenantId, productId, uploaded(request)));
  });

  app.post("/tenant/v1/products/:id/inventory/import", upload, async (request, reply) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const key = idempotencyKey(request.headers["idempotency-key"]);
    const version = ifMatchVersion(request.headers["if-match"]);
    const query = parseInput(shaQuerySchema, request.query, "querystring");
    const result = await importInventory(ctx, { principal, ip: request.ip }, productId, version, uploaded(request), query.file_sha256, { scope: "POST /tenant/v1/products/:id/inventory/import", key });
    return reply.code(result.status).send(result.body);
  });
}
