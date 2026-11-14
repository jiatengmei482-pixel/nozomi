/**
 * M9E-16（ADR 0095 第十节「端到端用的 preview」）：vite preview 的安全响应头（build/preview-headers.ts）和正式环境 Caddy 的片段（renderEdgeConfig）规则一致：
 * 三条策略逐字相同；嵌入预订页只把 key、host 转给 frame-check，放行时用 API 回的宿主，拒绝时把 API 的应答原样回给浏览器。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEdgeConfig } from "../../build/edge-config.ts";
import { frameCheckUrl, previewDecision } from "../../build/preview-headers.ts";

const HTML = "<!doctype html><html><head><script>1</script></head></html>";
const HASHES = ["sha256-a4ayc/80/OGda4BO/1o/V0etpOqiLx1JwB5S3beHW0s="];
const MAP = "{$MAP_TILE_CSP_SOURCES}";
const API = "http://127.0.0.1:8080";
const HOST = "http://localhost:4174";

/** Caddy 片段里三条策略的原文 */
function caddyPolicies(): { site: string; other: string; embed: string } {
  const lines = renderEdgeConfig(HTML).split("\n");
  const value = (prefix: string): string => {
    const line = lines.find((item) => item.startsWith(prefix)) ?? "";
    return line.slice(prefix.length + 2, -1);
  };
  return { site: value('header @site_pages Content-Security-Policy'), other: value('header @other_pages Content-Security-Policy'), embed: value("\t\theader Content-Security-Policy") };
}

function fakeFetch(status: number, headers: Record<string, string> = {}, body = "") {
  const calls: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    calls.push(url);
    return new Response(status === 204 ? null : body, { status, headers });
  };
  return { calls, fetchImpl };
}

test("官网页面、其余页面：和 Caddy 片段逐字同一条策略，不问 API；都带 X-Frame-Options: DENY", async () => {
  const caddy = caddyPolicies();
  const api = fakeFetch(204);
  for (const [path, expected] of [["/book/order", caddy.site], ["/Book", caddy.site], ["/login", caddy.other], ["/embed/booking", caddy.other], ["/embed/book/x", caddy.other], ["/platform/..%2Fembed/book", caddy.other], ["/embed/book%2F..", caddy.other]] as const) {
    const decision = await previewDecision(path, HASHES, [MAP], API, api.fetchImpl);
    assert.equal(decision.kind, "page", path);
    assert.equal(decision.headers["content-security-policy"], expected, path);
    assert.equal(decision.headers["x-frame-options"], "DENY", path);
  }
  assert.deepEqual(api.calls, [], "只有嵌入预订页问 frame-check");
});

test("嵌入预订页放行：和 Caddy 片段同一条策略（frame-ancestors 换成 API 回的宿主）、不缓存；只转 key、host", async () => {
  const api = fakeFetch(204, { "x-nozomi-frame-ancestor": HOST });
  const decision = await previewDecision(`/embed/book/order?key=nze_k&host=${encodeURIComponent(HOST)}&payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=succeeded`, HASHES, [MAP], API, api.fetchImpl);
  assert.equal(decision.kind, "page");
  assert.equal(decision.headers["content-security-policy"], caddyPolicies().embed.replace("{http.request.header.X-Nozomi-Frame-Ancestor}", HOST));
  assert.equal(decision.headers["cache-control"], "no-store");
  assert.equal(api.calls.length, 1);
  const url = new URL(api.calls[0] as string);
  assert.equal(url.origin + url.pathname, `${API}/embed/v1/frame-check`);
  assert.deepEqual([...url.searchParams.entries()], [["key", "nze_k"], ["host", HOST]]);
  assert.equal(frameCheckUrl(API, "/embed/book?key=a&key=b&host=x&host=y"), `${API}/embed/v1/frame-check?key=a&host=x`, "重复参数只取第一个");
  assert.equal(frameCheckUrl(API, "/embed/book"), `${API}/embed/v1/frame-check?key=&host=`);
});

test("frame-check 带上浏览器请求的 X-Forwarded-For（同 Caddy forward_auth 按客人地址限速）；没有就不带；别的请求头一概不转", async () => {
  const seen: Record<string, string>[] = [];
  const fetchImpl = async (_url: string, init: { headers: Record<string, string> }): Promise<Response> => {
    seen.push(init.headers);
    return new Response(null, { status: 204, headers: { "x-nozomi-frame-ancestor": HOST } });
  };
  await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, fetchImpl, "198.51.100.7");
  await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, fetchImpl);
  assert.deepEqual(seen, [{ "x-forwarded-for": "198.51.100.7" }, {}]);
});

test("嵌入预订页拒绝：API 的 403 / 429 原样回给浏览器（状态码、frame-ancestors 'none'、正文）；API 放行却回了写不进 frame-ancestors 的值、连不上，都按 403", async () => {
  const refusal = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "x-frame-options": "DENY", "cache-control": "no-store" };
  for (const status of [403, 429]) {
    const decision = await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, fakeFetch(status, { ...refusal, ...(status === 429 ? { "retry-after": "30" } : {}) }, "<p>no</p>").fetchImpl);
    assert.equal(decision.kind, "refused");
    if (decision.kind !== "refused") continue;
    assert.equal(decision.status, status);
    assert.equal(decision.body, "<p>no</p>");
    assert.equal(decision.headers["content-security-policy"], refusal["content-security-policy"]);
    if (status === 429) assert.equal(decision.headers["retry-after"], "30");
  }
  for (const ancestor of [`${HOST}; script-src *`, "'self'", "*", "https://a.example/path"]) {
    const decision = await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, fakeFetch(204, { "x-nozomi-frame-ancestor": ancestor }).fetchImpl);
    assert.equal(decision.kind === "refused" && decision.status, 403, ancestor);
    assert.match(decision.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/, ancestor);
  }
  assert.equal((await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, fakeFetch(204).fetchImpl)).kind, "refused", "放行却没给宿主");
  const down = await previewDecision("/embed/book?key=k&host=h", HASHES, [], API, async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.equal(down.kind === "refused" && down.status, 403);
});
