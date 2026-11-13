/**
 * 嵌入组件（M9E-03，ADR 0090 第四节）在浏览器环境（happy-dom）里的行为：界面在 Shadow DOM 里；取配置失败只显示「暂时无法使用」；
 * 两个标签；地址提示经 `/embed/v1/places`、带嵌入码、不带 Cookie，谷歌候选有「Powered by Google」；
 * 点「查询价格」先建草稿再跳转；400 / 429 / 网络错误各一句、不跳转。接口用替身（不连主站）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initFrom, initWithBase, scriptOriginOf } from "./widget-ui.ts";

const BASE = "https://nozomi.example";
const KEY = `nze_${"A".repeat(32)}`;
type Handler = (url: URL, init: RequestInit | undefined) => { status: number; body: unknown } | "network";
let calls: { url: URL; init: RequestInit | undefined }[] = [];
let handler: Handler = () => "network";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  document.body.innerHTML = '<div id="nozomi-booking"></div>';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const result = handler(url, init);
    if (result === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
});

const shadow = (): ShadowRoot => document.querySelector("#nozomi-booking")?.shadowRoot as ShadowRoot;
const $ = <T extends Element = HTMLElement>(selector: string): T => shadow().querySelector(selector) as T;
const config = { status: 200, body: { lang: "ja", services: ["transfer", "charter"], site_origin: BASE } };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pick(field: string, query: string, option: string): Promise<void> {
  const input = $<HTMLInputElement>(`[data-field="${field}"] input`);
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await wait(400);
  const target = [...shadow().querySelectorAll(`[data-field="${field}"] [role="option"]`)].find((node) => node.textContent?.includes(option)) as HTMLElement;
  assert.ok(target, `${field} 的候选里有 ${option}`);
  target.click();
  await wait(20);
}

const places: Handler = (url) => {
  if (url.pathname === "/embed/v1/config") return config;
  if (url.pathname === "/embed/v1/places/autocomplete") {
    const q = url.searchParams.get("q") ?? "";
    return { status: 200, body: { available: true, items: q.includes("成田") ? [{ source: "platform", id: "p1", name: "成田国際空港", address: null, location: { lat: 35.772, lng: 140.3929 }, kind: "airport" }] : [{ source: "google", id: "ChIJtokyo", name: "東京駅", address: "東京都千代田区", location: null, kind: "other" }] } };
  }
  if (url.pathname === "/embed/v1/places/details") return { status: 200, body: { available: true, place: { id: "ChIJtokyo", address: "東京都千代田区", location: { lat: 35.6812, lng: 139.7671 }, kind: "other" } } };
  return "network";
};

test("取配置失败（未授权和连不上分不出）：只显示「暂时无法使用」和主站链接，不显示表单", async () => {
  handler = () => "network";
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
  assert.match($('[role="status"]').textContent ?? "", /预订组件暂时无法使用/);
  assert.equal($<HTMLAnchorElement>("a").getAttribute("href"), `${BASE}/book/new`);
  assert.equal(shadow().querySelector("form"), null);
  assert.equal(calls[0]?.url.href, `${BASE}/embed/v1/config?key=${KEY}`);
  assert.equal(calls[0]?.init?.credentials, "omit");
});

test("界面在 Shadow DOM 里，合作网站的样式进不来；两个标签按 services 排，语言用 init 给的", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en", services: ["charter", "transfer", "bus"] });
  assert.equal(document.querySelector("#nozomi-booking")?.children.length, 0, "页面里没有组件的元素，全在 Shadow DOM 里");
  const tabs = [...shadow().querySelectorAll('[role="tab"]')].map((tab) => [tab.textContent, tab.getAttribute("aria-selected")]);
  assert.deepEqual(tabs, [["Charter", "true"], ["Transfer", "false"]]);
  assert.ok($(".nzb-primary").textContent === "See prices");
  assert.ok(shadow().textContent?.includes("Enter a place only"));
});

test("区间：地址提示经主站（带嵌入码和会话令牌、不带 Cookie），谷歌候选有标识；查询价格先建草稿再跳转", async () => {
  let drafted: unknown = null;
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "2030-01-01T00:00:00Z", url: `${BASE}/book/new?draft=${"D".repeat(43)}` } };
    }
    return places(url, init);
  };
  const went: string[] = [];
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", redirectUrl: "https://partner.example/thanks" }, (url) => went.push(url));
  await pick("pickup", "成田", "成田国際空港");
  const toInput = $<HTMLInputElement>('[data-field="dropoff"] input');
  toInput.value = "東京";
  toInput.dispatchEvent(new Event("input"));
  await wait(400);
  assert.equal($(".nzb-google").textContent, "Google Maps", "谷歌候选按谷歌地图平台的要求署名");
  ($('[data-field="dropoff"] [role="option"]') as HTMLElement).click();
  await wait(20);
  const auto = calls.find((call) => call.url.pathname === "/embed/v1/places/autocomplete");
  assert.equal(auto?.url.searchParams.get("key"), KEY);
  assert.ok((auto?.url.searchParams.get("session") ?? "").length >= 16);
  assert.ok(calls.some((call) => call.url.pathname === "/embed/v1/places/details"), "谷歌候选选中后再取坐标");
  $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(30);
  assert.deepEqual(went, [`${BASE}/book/new?draft=${"D".repeat(43)}`]);
  const body = drafted as { draft: Record<string, unknown>; return_url: string };
  assert.equal(body.return_url, "https://partner.example/thanks");
  assert.deepEqual(body.draft["pickup"], { name: "成田国際空港", lat: 35.772, lng: 140.3929 });
  assert.deepEqual(body.draft["dropoff"], { name: "東京駅", lat: 35.6812, lng: 139.7671 });
  assert.equal(body.draft["tab"], "transfer");
  const post = calls.find((call) => call.url.pathname === "/embed/v1/booking-drafts");
  assert.equal(post?.init?.credentials, "omit");
  assert.equal(post?.url.searchParams.get("key"), KEY);
});

test("建草稿失败：400、429 两种、网络错误各显示一句，不跳转；没选地点先提示", async () => {
  const went: string[] = [];
  let reply: { status: number; body: unknown } | "network" = { status: 400, body: { error: { code: "VALIDATION_FAILED" } } };
  handler = (url, init) => (url.pathname === "/embed/v1/booking-drafts" ? reply : places(url, init));
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, (url) => went.push(url));
  const submit = async (): Promise<string> => {
    $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(30);
    return $('[data-role="message"]').textContent ?? "";
  };
  assert.equal(await submit(), "请从候选里选一个地点");
  assert.equal(calls.filter((call) => call.url.pathname === "/embed/v1/booking-drafts").length, 0);
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "東京", "東京駅");
  assert.equal(await submit(), "有几项填得不对，请检查后再试。");
  reply = { status: 429, body: { error: { code: "RATE_LIMITED" } } };
  assert.equal(await submit(), "操作太频繁，请稍等一分钟再试。");
  reply = { status: 429, body: { error: { code: "EMBED_DRAFT_LIMIT" } } };
  assert.equal(await submit(), "暂时无法查询，请稍后再试或直接到主站预订。");
  reply = "network";
  assert.equal(await submit(), "暂时连不上，请稍后再试或直接到主站预订。");
  assert.deepEqual(went, []);
});

test("包车：添加经停点、选停留，草稿里带经停点和停留；停留没选先提示", async () => {
  let drafted: { draft: Record<string, unknown> } | null = null;
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "x", url: `${BASE}/book/new?draft=x` } };
    }
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter"] }, () => undefined);
  assert.equal(shadow().querySelectorAll('[role="tab"]').length, 0, "只有一种时不显示标签");
  await pick("pickup", "成田", "成田国際空港");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  await pick("waypoint-0", "東京", "東京駅");
  await pick("dropoff", "成田", "成田国際空港");
  $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(20);
  assert.equal($('[data-role="message"]').textContent, "请选择停留时长");
  const stay = $<HTMLSelectElement>('[data-focus="stay-0"]');
  stay.value = "60";
  stay.dispatchEvent(new Event("change"));
  $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(30);
  assert.deepEqual((drafted as { draft: Record<string, unknown> } | null)?.draft["waypoints"], [{ name: "東京駅", lat: 35.6812, lng: 139.7671, stay_minutes: 60 }]);
  assert.equal((drafted as { draft: Record<string, unknown> } | null)?.draft["package_hours"], null);
});

test("主站地址只认从 /embed/widget-v1.js 加载的 <script>：宿主页用 <img name=\"currentScript\"> 冒充时拿不到，组件报错、不渲染、不请求任何地址", async () => {
  document.body.innerHTML = '<img name="currentScript" src="https://evil.example/x.png"><div id="nozomi-booking"></div>';
  const img = document.querySelector("img");
  assert.equal(scriptOriginOf(img), null, "冒充的 <img> 不算");
  assert.equal(scriptOriginOf((document as unknown as { currentScript: unknown }).currentScript), null);
  const script = (src: string): HTMLScriptElement => {
    const node = document.createElement("script");
    node.src = src;
    return node;
  };
  assert.equal(scriptOriginOf(script("https://evil.example/x.js")), null, "别的路径的脚本也不算");
  assert.equal(scriptOriginOf(script("https://evil.example/embed/widget-v1.js.png")), null);
  assert.equal(scriptOriginOf(script("javascript:alert(1)")), null);
  assert.equal(scriptOriginOf(script(`${BASE}/embed/widget-v1.js`)), BASE);
  assert.equal(scriptOriginOf(script(`${BASE}/embed/widget-v1.js?v=2`)), BASE);
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => errors.push(message);
  try {
    handler = () => {
      throw new Error("不应请求任何地址");
    };
    initFrom(null, { key: KEY, root: "#nozomi-booking" });
    await wait(20);
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 0);
  assert.equal(document.querySelector("#nozomi-booking")?.shadowRoot ?? null, null, "不渲染");
  assert.ok((errors[0] ?? "").startsWith("NozomiBooking：请直接从主站的 /embed/widget-v1.js 加载"), errors[0]);
});

test("建草稿 400：标出服务端说的那一项并把焦点移过去；删除经停点后焦点回到「添加经停点」", async () => {
  const invalid = { status: 400, body: { error: { code: "VALIDATION_FAILED", details: { location: "body", issues: [{ path: "/draft/dropoff/name", reason: "OUT_OF_RANGE" }] } } } };
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") return invalid;
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter"] }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "東京", "東京駅");
  $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(30);
  const dropoff = $<HTMLInputElement>('[data-field="dropoff"] input');
  assert.equal(dropoff.getAttribute("aria-invalid"), "true");
  assert.equal(shadow().activeElement, dropoff);
  assert.equal($('[data-role="message"]').textContent, "有几项填得不对，请检查后再试。");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  ($('[aria-label="删除经停点 1"]') as HTMLButtonElement).click();
  assert.equal(shadow().activeElement, $('[data-action="add-waypoint"]'), "删除后焦点回到「添加经停点」");
});

