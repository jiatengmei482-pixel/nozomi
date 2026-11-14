/**
 * `vite preview`（端到端测试用它提供构建好的前端）的安全响应头，和正式环境 Caddy 的规则一致（ADR 0046、ADR 0095 第十节「端到端用的 preview」）：
 *
 * - 三条内容安全策略用 edge-config.ts 的同一个函数、同一份构建产物算（`edgePolicies`）：官网页面、嵌入预订页、其余页面；
 * - 嵌入预订页（`/embed/book`、`/embed/book/order`）照 Caddy 的 `forward_auth` 先问 API 的 `/embed/v1/frame-check`，**只转 key、host 两个参数**：
 *   2xx 时用 API 回的宿主写进 `frame-ancestors`、不缓存；非 2xx 时把 API 的应答（状态码、`frame-ancestors 'none'` 的极简页面）原样回给浏览器；
 *   API 连不上按拒绝（403）处理。这样端到端里「白名单内能嵌、白名单外被拒」是真的在测；
 * - 所有响应带 `X-Frame-Options: DENY`（Caddy 全局加的那一条）：嵌入页同时带 frame-ancestors 时浏览器忽略它，端到端照样核对得到。
 *
 * 纯逻辑，不依赖 vite；`preview-headers.test.ts` 核对它和 `renderEdgeConfig` 给出的策略逐字一致。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { FRAME_ANCESTOR_HEADER, FRAME_CHECK_PATH, edgePolicies, isEmbedBookPagePath, isFrameAncestorSource, isSitePagePath } from "./edge-config.ts";

type Fetch = (url: string, init: { redirect: "manual"; headers: Record<string, string> }) => Promise<Response>;

/** 嵌入页地址 → frame-check 的地址：只带 key、host（各取第一个；银行回跳带的 payment_intent_client_secret 等一概不转） */
export function frameCheckUrl(apiOrigin: string, requestUrl: string): string {
  const query = new URL(requestUrl, "http://preview.invalid").searchParams;
  const target = new URL(FRAME_CHECK_PATH, apiOrigin);
  for (const name of ["key", "host"]) target.searchParams.set(name, query.get(name) ?? "");
  return target.href;
}

/** 浏览器看到的拒绝：同 API 的 frame-check 403 */
const REFUSED = { status: 403, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "cache-control": "no-store" }, body: "<!doctype html><p>refused</p>" };

export type PreviewDecision =
  | { kind: "page"; headers: Record<string, string> }
  | { kind: "refused"; status: number; headers: Record<string, string>; body: string };

/** 一个请求该带哪些头（嵌入预订页要先问 API） */
export async function previewDecision(requestUrl: string, scriptHashes: readonly string[], imageSources: readonly string[], apiOrigin: string, fetchImpl: Fetch = fetch): Promise<PreviewDecision> {
  const policies = edgePolicies(scriptHashes, imageSources);
  const base = { "x-frame-options": "DENY" };
  if (!isEmbedBookPagePath(requestUrl)) return { kind: "page", headers: { ...base, "content-security-policy": isSitePagePath(requestUrl) ? policies.site : policies.other } };
  let response: Response;
  try {
    response = await fetchImpl(frameCheckUrl(apiOrigin, requestUrl), { redirect: "manual", headers: {} });
  } catch {
    return { kind: "refused", ...REFUSED, headers: { ...base, ...REFUSED.headers } };
  }
  const ancestor = response.headers.get(FRAME_ANCESTOR_HEADER);
  if (response.status >= 200 && response.status < 300 && ancestor !== null && isFrameAncestorSource(ancestor)) {
    return { kind: "page", headers: { ...base, "content-security-policy": policies.embedBook(ancestor), "cache-control": "no-store" } };
  }
  if (response.status >= 200 && response.status < 300) return { kind: "refused", ...REFUSED, headers: { ...base, ...REFUSED.headers } };
  const headers: Record<string, string> = { ...base };
  for (const name of ["content-type", "content-security-policy", "x-frame-options", "cache-control", "retry-after"]) {
    const value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { kind: "refused", status: response.status, headers, body: await response.text() };
}

/** vite preview 给 index.html 加 `Cache-Control: no-cache`：嵌入页要的是 no-store（同 Caddy），后面的中间件改不掉这一项 */
function keepCacheControl(response: ServerResponse): void {
  const setHeader = response.setHeader.bind(response);
  response.setHeader = ((name: string, value: number | string | readonly string[]) => (name.toLowerCase() === "cache-control" ? response : setHeader(name, value))) as typeof response.setHeader;
  const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
  response.writeHead = ((...args: unknown[]) => {
    const headers = args.find((arg, index) => index > 0 && typeof arg === "object" && arg !== null && !Array.isArray(arg)) as Record<string, unknown> | undefined;
    if (headers !== undefined) for (const name of Object.keys(headers)) if (name.toLowerCase() === "cache-control") delete headers[name];
    return writeHead(...args);
  }) as typeof response.writeHead;
}

/** 挂到 vite preview 上的中间件 */
export function previewHeadersMiddleware(scriptHashes: readonly string[], imageSources: readonly string[], apiOrigin: string, fetchImpl: Fetch = fetch) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    void previewDecision(request.url ?? "", scriptHashes, imageSources, apiOrigin, fetchImpl).then(
      (decision) => {
        for (const [name, value] of Object.entries(decision.headers)) response.setHeader(name, value);
        if (decision.kind === "page") {
          if (decision.headers["cache-control"] !== undefined) keepCacheControl(response);
          next();
          return;
        }
        response.statusCode = decision.status;
        response.end(decision.body);
      },
      () => {
        // 读 API 应答时出错：按拒绝处理，不返回页面
        for (const [name, value] of Object.entries(REFUSED.headers)) response.setHeader(name, value);
        response.statusCode = REFUSED.status;
        response.end(REFUSED.body);
      },
    );
  };
}
