/**
 * 嵌入预订页 `/embed/book`（M9E-16，ADR 0095 第四、六节）的组件测试：只挂 /embed/book* 路由树（别的路径只显示「请在新窗口打开」）；
 * 被嵌着时读草稿、按宿主 origin 发 ready / error（从不用 "*"，消息里没有草稿内容）；只认父窗口、宿主 origin、同频道的 viewport；
 * 顶层打开不显示预订内容。读到草稿以后的四步、订单页在 embed-flow.test.tsx（M9E-17）。接口用替身。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, useNavigate } from "react-router";
import { useEffect } from "react";
import { apiError, json, stubApiWith } from "../../testing/harness.tsx";
import { EMBED_BOOK_PREFIX, isEmbedBookPagePath } from "../../../build/edge-config.ts";
import { EMBED_BOOK_ORDER_PATH, EMBED_BOOK_PATH } from "../../embed/booking-protocol.ts";
import { isApiPath } from "../../lib/api-prefixes.ts";
import { EmbedApp, isEmbedBookDocument } from "./EmbedApp.tsx";
import { DRAFT_TIMEOUT } from "./EmbedBookPage.tsx";
import { EMBED_FRAME } from "./EmbedFrame.tsx";
import { EMBED_TEXTS } from "./embed-texts.ts";

const DRAFT = "D".repeat(43);
const KEY = `nze_${"A".repeat(32)}`;
const HOST = "https://partner.example";
const CH = "0123456789abcdef0123456789abcdef";
const DRAFT_BODY = {
  v: 1,
  tab: "transfer",
  service_local: "2030-11-20T10:00",
  pickup: { name: "成田国際空港", lat: 35.772, lng: 140.3929 },
  dropoff: { name: "東京駅", lat: 35.6812, lng: 139.7671 },
  waypoints: [],
  package_hours: null,
  passengers: 2,
  luggage: 1,
  lang: "ja",
};

let posted: [unknown, string][] = [];
const parent = { postMessage: (message: unknown, targetOrigin: string) => posted.push([message, targetOrigin]) } as unknown as Window;
const originalParent = EMBED_FRAME.parent;

beforeEach(() => {
  posted = [];
  EMBED_FRAME.parent = () => parent;
});
afterEach(() => {
  cleanup();
  EMBED_FRAME.parent = originalParent;
  DRAFT_TIMEOUT.ms = 10_000;
  history.replaceState(null, "", "/");
});

function open(path: string): void {
  history.replaceState(null, "", path);
  render(
    <BrowserRouter>
      <EmbedApp />
    </BrowserRouter>,
  );
}
const url = (extra = "") => `/embed/book?draft=${DRAFT}&key=${KEY}&host=${encodeURIComponent(HOST)}${extra}#ch=${CH}`;
const types = () => posted.map(([message]) => (message as { type: string }).type);

test("哪些路径挂嵌入页的路由树：/embed/book 和它下面（不分大小写）；/embed/booking、/embed/widget-v1.js、/book 不算", () => {
  for (const path of ["/embed/book", "/embed/book/", "/embed/book/order", "/Embed/Book", "/embed/book/x"]) assert.equal(isEmbedBookDocument(path), true, path);
  for (const path of ["/embed/booking", "/embed/widget-v1.js", "/embed", "/book", "/platform/embed/book", "/"]) assert.equal(isEmbedBookDocument(path), false, path);
});

test("前端的两个嵌入页路径、Caddy 给 frame-ancestors 的匹配规则（edge-config.ts）对得上；都不落在 API 前缀下", () => {
  assert.equal(EMBED_BOOK_PREFIX, EMBED_BOOK_PATH);
  for (const path of [EMBED_BOOK_PATH, EMBED_BOOK_ORDER_PATH]) {
    assert.equal(isEmbedBookPagePath(path), true, path);
    assert.equal(isEmbedBookPagePath(`${path}?key=${KEY}&host=${encodeURIComponent(HOST)}`), true, path);
    assert.equal(isEmbedBookDocument(path), true, path);
    assert.equal(isApiPath(path), false, path);
  }
  // 嵌入页文档里的其他路径：前端只显示「请在新窗口打开」，Caddy 那边也不放行嵌入
  for (const path of ["/embed/book/x", "/embed/book/order/x"]) {
    assert.equal(isEmbedBookPagePath(path), false, path);
    assert.equal(isEmbedBookDocument(path), true, path);
  }
});

test("被嵌着：带上 key、host 读草稿，按宿主 origin 发 ready（语言跟草稿），消息里没有草稿内容；顶部写明「本预订由 NOZOMI 提供并收款」", async () => {
  const calls = stubApiWith((call) => (call.url.pathname === `/site/v1/booking-drafts/${DRAFT}` ? json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z", source_matches: true }) : apiError(503, "SITE_NOT_OPEN", "x")));
  open(url());
  await screen.findByText(EMBED_TEXTS.ja.seller);
  await waitFor(() => assert.ok(types().includes("ready")));
  assert.equal(calls[0]?.path, `/site/v1/booking-drafts/${DRAFT}?key=${KEY}&host=${encodeURIComponent(HOST)}`, "读草稿带 key、host");
  assert.deepEqual(posted[0], [{ ns: "nozomi-booking", v: 1, ch: CH, type: "ready", lang: "ja" }, HOST]);
  assert.ok(posted.every(([, origin]) => origin === HOST), "targetOrigin 一律是宿主 origin，从不用 *");
  assert.doesNotMatch(JSON.stringify(posted), /成田|東京|35\.7|nze_|D{43}/, "消息里没有草稿内容、嵌入码、草稿号");
});

test("地址带 lang 时按它显示（不看草稿的语言）", async () => {
  stubApiWith((call) => (call.url.pathname.startsWith("/site/v1/booking-drafts/") ? json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z" }) : apiError(503, "SITE_NOT_OPEN", "x")));
  open(url("&lang=en"));
  await screen.findByText(EMBED_TEXTS.en.seller);
  await waitFor(() => assert.deepEqual(posted[0]?.[0], { ns: "nozomi-booking", v: 1, ch: CH, type: "ready", lang: "en" }));
});

test("草稿过期（404）：发 ready 再发 error DRAFT_NOT_FOUND，提示在上方重新查询；读不出（500）发 LOAD_FAILED、给主站链接", async () => {
  stubApiWith(() => apiError(404, "BOOKING_DRAFT_NOT_FOUND", "链接已过期"));
  open(url());
  await screen.findByText(EMBED_TEXTS.ja.expired);
  await waitFor(() => assert.deepEqual(types(), ["ready", "error"]));
  assert.deepEqual(posted[1]?.[0], { ns: "nozomi-booking", v: 1, ch: CH, type: "error", code: "DRAFT_NOT_FOUND" });
  cleanup();
  posted = [];
  stubApiWith(() => apiError(500, "INTERNAL_ERROR", "x"));
  open(url());
  await screen.findByText(EMBED_TEXTS.ja.failed);
  await waitFor(() => assert.deepEqual(posted.map(([message]) => message), [{ ns: "nozomi-booking", v: 1, ch: CH, type: "ready", lang: "ja" }, { ns: "nozomi-booking", v: 1, ch: CH, type: "error", code: "LOAD_FAILED" }]));
  assert.equal(screen.getByRole("link", { name: new RegExp(EMBED_TEXTS.ja.goToSite) }).getAttribute("target"), "_blank");
});

test("读草稿一直不回：到时限按读不出处理（宿主不会一直等 ready）", async () => {
  DRAFT_TIMEOUT.ms = 30;
  stubApiWith(() => new Promise<Response>(() => undefined) as unknown as Response);
  open(url());
  await waitFor(() => assert.deepEqual(types(), ["ready", "error"]));
  assert.equal((posted[1]?.[0] as { code: string }).code, "LOAD_FAILED");
});

test("地址没有草稿号：不调接口，直接 ready + error DRAFT_NOT_FOUND（部署冒烟就是这样确认嵌进去了）", async () => {
  const calls = stubApiWith(() => null);
  open(`/embed/book?key=${KEY}&host=${encodeURIComponent(HOST)}&lang=ja#ch=smoke`);
  await waitFor(() => assert.deepEqual(types(), ["ready", "error"]));
  assert.deepEqual(posted[0], [{ ns: "nozomi-booking", v: 1, ch: "smoke", type: "ready", lang: "ja" }, HOST]);
  assert.equal(calls.length, 0);
});

test("宿主 origin 写法不对（带路径、大写、不是 http(s)）：一条消息都不发，只说地址不完整", async () => {
  stubApiWith(() => json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z" }));
  open(`/embed/book?draft=${DRAFT}&key=${KEY}&host=${encodeURIComponent(`${HOST}/booking/`)}#ch=${CH}`);
  await screen.findByText(EMBED_TEXTS.ja.badAddress);
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  assert.deepEqual(posted, []);
});

test("viewport：只认父窗口、宿主 origin、同一个频道的；只记下高度，不改预订内容", async () => {
  stubApiWith((call) => (call.url.pathname.startsWith("/site/v1/booking-drafts/") ? json(200, { draft: DRAFT_BODY, expires_at: "2030-11-20T00:00:00Z" }) : apiError(503, "SITE_NOT_OPEN", "x")));
  open(url());
  await screen.findByText(EMBED_TEXTS.ja.seller);
  const send = (data: unknown, origin: string, source: unknown) => act(() => void window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as MessageEventSource })));
  const viewport = (height: number, ch = CH) => ({ ns: "nozomi-booking", v: 1, ch, type: "viewport", height });
  await send(viewport(500), "https://evil.example", parent);
  await send(viewport(600), HOST, window);
  await send(viewport(700, "other"), HOST, parent);
  await send({ ...viewport(800), type: "step", step: "paid" }, HOST, parent);
  const main = document.querySelector("main") as HTMLElement;
  assert.equal(main.hasAttribute("data-host-viewport"), false);
  await send(viewport(900), HOST, parent);
  assert.equal(main.getAttribute("data-host-viewport"), "900");
  assert.ok(screen.getByText(EMBED_TEXTS.ja.seller), "页面内容不变");
});

test("顶层打开（没被嵌）：不读草稿、不显示预订内容、不发消息，只说请在合作网站上预订并给主站链接", async () => {
  EMBED_FRAME.parent = () => null;
  const calls = stubApiWith(() => null);
  open(url());
  await screen.findByText(EMBED_TEXTS.ja.topLevel);
  assert.equal(screen.getByRole("link", { name: EMBED_TEXTS.ja.goToSite }).getAttribute("href"), `/book/new?draft=${DRAFT}`);
  assert.equal(calls.length, 0);
  assert.deepEqual(posted, []);
  assert.equal(screen.queryByText("成田国際空港"), null);
});

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
}

for (const target of ["/login", "/platform", "/platform/orders", "/tenant", "/book/new", "/book/order", "/embed/booking"]) {
  test(`路由隔离：在嵌入页的文档里换到 ${target} 只显示「请在新窗口打开」，不渲染登录、后台、主站页面`, async () => {
    stubApiWith(() => null);
    history.replaceState(null, "", url());
    render(
      <BrowserRouter>
        <EmbedApp />
        <Go to={target} />
      </BrowserRouter>,
    );
    await screen.findByText("这个页面不能在合作网站里显示，请在新窗口打开。");
    const link = screen.getByRole("link", { name: /在新窗口打开/ });
    assert.equal(link.getAttribute("href"), target);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(screen.queryByLabelText(/密码|邮箱/), null, "没有登录表单");
    assert.equal(document.querySelectorAll("main").length, 1);
  });
}
