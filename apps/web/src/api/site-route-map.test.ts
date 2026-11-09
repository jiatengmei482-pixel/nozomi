/** 官网路线小地图（M8-10）的地址和「没开通」的认法；组件的三种显示在 pages/book/new/book-new.test.tsx。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { isRouteMapNotEnabled, siteRouteMapNotEnabled, siteRouteMapUrl } from "./site.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("路线图地址：站内相对路径，两端坐标（6 位小数）、主题、尺寸、倍率", () => {
  const url = siteRouteMapUrl({ from: { lat: 35.772, lng: 140.3929 }, to: { lat: 35.6905123456, lng: 139.6948 }, theme: "dark", width: 319, height: 198, scale: 2 });
  assert.equal(url, "/site/v1/route-map?from_lat=35.772000&from_lng=140.392900&to_lat=35.690512&to_lng=139.694800&theme=dark&width=319&height=198&scale=2");
});

test("只有 503 + ROUTE_MAP_UNAVAILABLE + details.reason = NOT_ENABLED 算「没开通」；UNAVAILABLE、429、别的码、别的格式一律不算", () => {
  const body = (code: string, details: unknown) => ({ error: { code, message: "x", details } });
  assert.equal(isRouteMapNotEnabled(503, body("ROUTE_MAP_UNAVAILABLE", { reason: "NOT_ENABLED" })), true);
  assert.equal(isRouteMapNotEnabled(503, body("ROUTE_MAP_UNAVAILABLE", { reason: "UNAVAILABLE" })), false);
  assert.equal(isRouteMapNotEnabled(429, body("RATE_LIMITED", { retry_after_seconds: 30 })), false);
  assert.equal(isRouteMapNotEnabled(503, body("OTHER", { reason: "NOT_ENABLED" })), false);
  assert.equal(isRouteMapNotEnabled(500, body("ROUTE_MAP_UNAVAILABLE", { reason: "NOT_ENABLED" })), false);
  assert.equal(isRouteMapNotEnabled(503, body("ROUTE_MAP_UNAVAILABLE", null)), false);
  assert.equal(isRouteMapNotEnabled(503, { code: "ROUTE_MAP_UNAVAILABLE", reason: "NOT_ENABLED" }), false, "不是全站统一的错误格式");
  assert.equal(isRouteMapNotEnabled(503, null), false);
});

test("图片没出来以后问原因：读 503 的 JSON；连不上、不是 JSON 都当「不是没开通」", async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ error: { code: "ROUTE_MAP_UNAVAILABLE", message: "x", details: { reason: "NOT_ENABLED" } } }), { status: 503, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.equal(await siteRouteMapNotEnabled("/site/v1/route-map?x=1"), true);
  assert.deepEqual(seen, ["/site/v1/route-map?x=1"]);

  globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  assert.equal(await siteRouteMapNotEnabled("/site/v1/route-map?x=1"), false);
  globalThis.fetch = (async () => new Response("<html>", { status: 503, headers: { "content-type": "text/html" } })) as typeof fetch;
  assert.equal(await siteRouteMapNotEnabled("/site/v1/route-map?x=1"), false);
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  assert.equal(await siteRouteMapNotEnabled("/site/v1/route-map?x=1"), false);
});
