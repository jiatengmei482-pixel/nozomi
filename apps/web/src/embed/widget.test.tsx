/**
 * 嵌入组件（M9E-03，ADR 0090 第四节）在浏览器环境（happy-dom）里的行为：界面在 Shadow DOM 里；取配置被拒只显示「暂时无法使用」，
 * 超时、连不上、5xx 按 init 的参数显示表单（M9E-22）；
 * 两个标签；地址提示经 `/embed/v1/places`、带嵌入码、不带 Cookie，谷歌候选有「Powered by Google」；
 * 点「查看价格」先建草稿再跳转；400 / 429 / 网络错误各一句、不跳转。接口用替身（不连主站）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_TIMEOUT, LOCATE_TIMEOUT, initFrom, initWithBase, scriptOriginOf } from "./widget-ui.ts";
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES } from "../lib/google-attribution.ts";
import { readFile } from "node:fs/promises";
import { WIDGET_CSS } from "./widget-style.ts";
import { luminance } from "./widget-core.ts";

const BASE = "https://nozomi.example";
const KEY = `nze_${"A".repeat(32)}`;
/** "network" 是连不上；"blocked" 是主站应答了但不带 CORS 头（浏览器里被拒的 403）：跨域请求读不出、no-cors 请求成功 */
type Reply = { status: number; body: unknown } | "network" | "blocked";
type Handler = (url: URL, init: RequestInit | undefined) => Reply | Promise<Reply>;
let calls: { url: URL; init: RequestInit | undefined }[] = [];
let handler: Handler = () => "network";
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  document.body.innerHTML = '<div id="nozomi-booking"></div>';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const result = await handler(url, init);
    if (result === "network" || (result === "blocked" && init?.mode !== "no-cors")) throw new TypeError("Failed to fetch");
    if (result === "blocked") return new Response(null, { status: 200 });
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

test("取配置被拒（浏览器里 403 不带 CORS 头读不出，主站有应答）：只显示「暂时无法使用」和主站链接，不显示表单（M9E-22）", async () => {
  handler = () => "blocked";
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
  assert.match($('[role="status"]').textContent ?? "", /预订组件暂时无法使用/);
  assert.equal($<HTMLAnchorElement>("a").getAttribute("href"), `${BASE}/book/new`);
  assert.equal(shadow().querySelector("form"), null);
  assert.equal(calls[0]?.url.href, `${BASE}/embed/v1/config?key=${KEY}`);
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(calls[0]?.init?.mode, "cors");
  assert.deepEqual(
    calls.slice(1).map((call) => [call.url.href, call.init?.mode, call.init?.credentials]),
    [[`${BASE}/embed/v1/config?key=${KEY}`, "no-cors", "omit"]],
    "读不出时再发一个 no-cors 请求看主站有没有应答",
  );
});

test("界面在 Shadow DOM 里，合作网站的样式进不来；两个标签按 services 排，语言用 init 给的", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en", services: ["charter", "transfer", "bus"] });
  assert.equal(document.querySelector("#nozomi-booking")?.children.length, 0, "页面里没有组件的元素，全在 Shadow DOM 里");
  const tabs = [...shadow().querySelectorAll('[role="tab"]')].map((tab) => [tab.querySelector(".nzb-tab-title")?.textContent, tab.getAttribute("aria-selected")]);
  assert.deepEqual(tabs, [["Hourly", "true"], ["Point to Point", "false"]]);
  assert.ok($(".nzb-primary").textContent === "See prices");
  assert.ok(shadow().textContent?.includes("Enter a place only"));
});

test("区间：地址提示经主站（带嵌入码和会话令牌、不带 Cookie），谷歌候选有标识；查看价格先建草稿再跳转", async () => {
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
  assert.equal($('[data-field="dropoff"] .nzb-google').textContent, "Google Maps", "谷歌候选按谷歌地图平台的要求署名");
  // 和主站同一份写法（M9E-06，lib/google-attribution.ts）：文字、英文、不翻译；不是候选
  assert.equal($('[data-field="dropoff"] .nzb-google').textContent, GOOGLE_MAPS_ATTRIBUTION);
  for (const [name, value] of Object.entries(GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES)) assert.equal($('[data-field="dropoff"] .nzb-google').getAttribute(name), value);
  assert.equal($<HTMLElement>('[data-field="dropoff"] .nzb-google').hidden, false);
  // 署名在候选列表（listbox）外面、同一个弹出面板里（M9E-06 审查）：listbox 里只有候选，读屏能读到署名
  const dropoffList = $('[data-field="dropoff"] [role="listbox"]');
  assert.equal(dropoffList.querySelector(".nzb-google"), null, "署名不在 listbox 里");
  assert.ok([...dropoffList.children].every((child) => child.getAttribute("role") === "option"), "listbox 里只有候选");
  assert.equal($('[data-field="dropoff"] .nzb-google').parentElement, dropoffList.parentElement, "和候选列表在同一个面板里");
  assert.ok(dropoffList.parentElement?.classList.contains("nzb-panel"));
  assert.equal($('[data-field="dropoff"] .nzb-google').getAttribute("aria-hidden"), null);
  assert.equal(shadow().querySelectorAll('[data-field="dropoff"] .nzb-google').length, 1, "整个列表只署一次");
  assert.equal($<HTMLElement>('[data-field="pickup"] .nzb-google').hidden, true, "只有平台地点（出发地的成田机场）时不署名");
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
  assert.equal(await submit(), "暂时连不上，请稍后再试或直接到主站预订。 到主站预订", "读不出的失败后面跟主站链接（M9E-22）");
  assert.equal($<HTMLAnchorElement>('[data-role="message"] a').getAttribute("href"), `${BASE}/book/new`);
  reply = { status: 429, body: { error: { code: "RATE_LIMITED" } } };
  assert.equal(await submit(), "操作太频繁，请稍等一分钟再试。", "下一次失败换掉上一次的链接");
  assert.equal(shadow().querySelector('[data-role="message"] a'), null);
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

test("建草稿 400 标出的那一项：客人改了就去掉 aria-invalid（输入框、下拉都算）；再提交时以服务端新的结论为准（M9E-07）", async () => {
  let issue = "/draft/waypoints/0/stay_minutes";
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") return { status: 400, body: { error: { code: "VALIDATION_FAILED", details: { location: "body", issues: [{ path: issue, reason: "OUT_OF_RANGE" }] } } } };
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter"] }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  await pick("waypoint-0", "東京", "東京駅");
  await pick("dropoff", "東京", "東京駅");
  const stay = $<HTMLSelectElement>('[data-focus="stay-0"]');
  stay.value = "60";
  stay.dispatchEvent(new Event("change"));
  const submit = async (): Promise<void> => {
    $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(30);
  };
  await submit();
  assert.equal(stay.getAttribute("aria-invalid"), "true");
  assert.equal(shadow().activeElement, stay);
  // 下拉：改了停留时长（浏览器里的 change 会冒泡）就去掉
  stay.value = "90";
  stay.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(stay.hasAttribute("aria-invalid"), false, "改了停留时长就不再标出错");
  assert.equal(shadow().querySelectorAll("[aria-invalid]").length, 0);

  // 地址框：重新打字就去掉；没动的项不受影响
  issue = "/draft/dropoff/name";
  await submit();
  const dropoff = $<HTMLInputElement>('[data-field="dropoff"] input');
  assert.equal(dropoff.getAttribute("aria-invalid"), "true");
  const pickup = $<HTMLInputElement>('[data-field="pickup"] input');
  pickup.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(dropoff.getAttribute("aria-invalid"), "true", "改的是别的项，出错的那一项照旧标着");
  dropoff.value = "東京駅 ";
  dropoff.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(dropoff.hasAttribute("aria-invalid"), false, "改了地址就不再标出错");

  // 再提交：上一次标的那一项不留，只标这次服务端说的那一项
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "東京", "東京駅");
  await submit();
  assert.equal(dropoff.getAttribute("aria-invalid"), "true");
  issue = "/draft/pickup/name";
  await submit();
  assert.equal(dropoff.hasAttribute("aria-invalid"), false, "上一次标的那一项去掉了");
  assert.equal(pickup.getAttribute("aria-invalid"), "true");
  assert.deepEqual([...shadow().querySelectorAll("[aria-invalid]")], [pickup]);
});


test("谷歌署名的样式（M9E-06 审查）：和主站同一个灰色（tokens.css 亮色 --color-text-secondary），12px、字重 400、不折行、不改大小写；固定在面板底部（滚动的是候选列表）", async () => {
  const tokens = await readFile(new URL("../../../../docs/design/tokens.css", import.meta.url), "utf8");
  const secondary = /--color-text-secondary:\s*(#[0-9a-fA-F]{6})/.exec(tokens)?.[1];
  assert.ok(secondary, "tokens.css 里有亮色的 --color-text-secondary（第一个就是亮色）");
  const rule = /\.nzb-google \{([^}]*)\}/.exec(WIDGET_CSS)?.[1] ?? "";
  const value = (name: string): string | undefined => new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`).exec(rule)?.[1]?.trim();
  assert.equal(value("color")?.toLowerCase(), secondary.toLowerCase());
  assert.equal(value("font-size"), "12px");
  assert.equal(value("font-weight"), "400");
  assert.equal(value("white-space"), "nowrap");
  assert.equal(value("text-transform"), "none");
  assert.equal(value("letter-spacing"), "normal");
  assert.equal(value("flex"), "none", "不跟着候选滚动");
  assert.match(WIDGET_CSS, /\.nzb-panel \{[^}]*max-height: 260px; overflow: hidden;/, "面板高度不变");
  assert.match(WIDGET_CSS, /\.nzb-list \{[^}]*overflow-y: auto;/, "滚动的是候选列表，署名在列表下面");
});

/** M9E-08：慢的取坐标替身。谷歌候选按 q 给（東京駅 / 新宿駅），取坐标要等测试放行（不放行就一直不回）；放行时可以指定成功或失败；组件超时取消时按浏览器那样失败 */
function slowDetails(): { handler: Handler; release: (id: string, reply?: Reply) => void; drafts: unknown[] } {
  const waiting = new Map<string, (reply: Reply) => void>();
  const drafts: unknown[] = [];
  const coords: Record<string, { lat: number; lng: number }> = { ChIJtokyo: { lat: 35.6812, lng: 139.7671 }, ChIJshinjuku: { lat: 35.6896, lng: 139.7006 } };
  const handler: Handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafts.push(JSON.parse(String(init?.body)));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "x", url: "x" } };
    }
    if (url.pathname === "/embed/v1/places/autocomplete" && (url.searchParams.get("q") ?? "").includes("新宿")) return { status: 200, body: { available: true, items: [{ source: "google", id: "ChIJshinjuku", name: "新宿駅", address: "東京都新宿区", location: null, kind: "other" }] } };
    if (url.pathname === "/embed/v1/places/details") {
      const id = url.searchParams.get("id") ?? "";
      return new Promise<Reply>((resolve, reject) => {
        waiting.set(id, resolve);
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "TimeoutError")));
      });
    }
    return places(url, init);
  };
  const release = (id: string, reply?: Reply): void => {
    const resolve = waiting.get(id);
    assert.ok(resolve, `${id} 正在取坐标`);
    waiting.delete(id);
    resolve(reply ?? { status: 200, body: { available: true, place: { id, address: "x", location: coords[id], kind: "other" } } });
  };
  return { handler, release, drafts };
}

async function type(field: string, query: string): Promise<void> {
  const input = $<HTMLInputElement>(`[data-field="${field}"] input`);
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await wait(400);
}
const clickOption = (field: string): void => ($(`[data-field="${field}"] [role="option"]`) as HTMLElement).click();
const submitForm = (): void => void $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));

test("M9E-08 ①：点了谷歌候选马上点「查看价格」——按钮显示「正在取位置…」、重复点不重复提交，坐标回来后自动接着建草稿，不提示「请从候选里选」", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  const went: string[] = [];
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, (url) => went.push(url));
  await pick("pickup", "成田", "成田国際空港");
  await type("dropoff", "東京");
  clickOption("dropoff");
  assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "正在取位置…");
  submitForm();
  await wait(20);
  assert.equal($(".nzb-primary").textContent, "正在取位置…");
  assert.equal($(".nzb-primary").getAttribute("aria-disabled"), "true");
  assert.equal($('[data-role="message"]').textContent, "", "不提示「请从候选里选一个地点」");
  submitForm();
  await wait(20);
  slow.release("ChIJtokyo");
  await wait(30);
  assert.equal(slow.drafts.length, 1, "只建一次草稿");
  assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "東京駅", lat: 35.6812, lng: 139.7671 });
  assert.deepEqual(went, [`${BASE}/book/new?draft=${"D".repeat(43)}`]);
  assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "");
});

test("M9E-08 ②：取坐标期间客人接着打字，旧坐标回来不写回；期间改选了别的候选，旧坐标晚回来也不覆盖", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  // 打字：框里是新字，草稿里不能是旧地点
  await type("dropoff", "東京");
  clickOption("dropoff");
  $<HTMLInputElement>('[data-field="dropoff"] input').value = "東京タワ";
  $<HTMLInputElement>('[data-field="dropoff"] input').dispatchEvent(new Event("input"));
  slow.release("ChIJtokyo");
  await wait(30);
  submitForm();
  await wait(30);
  assert.equal($<HTMLInputElement>('[data-field="dropoff"] input').value, "東京タワ");
  assert.equal($('[data-role="message"]').textContent, "请从候选里选一个地点", "框里是没选过的新字，按没选地点提示");
  assert.equal(slow.drafts.length, 0, "旧坐标没有写回，不建草稿");
  // 改选：先选東京駅（慢），再选新宿駅（先回来），東京駅后回来
  await type("dropoff", "東京");
  clickOption("dropoff");
  await type("dropoff", "新宿");
  clickOption("dropoff");
  submitForm();
  slow.release("ChIJshinjuku");
  await wait(20);
  slow.release("ChIJtokyo");
  await wait(30);
  assert.equal($<HTMLInputElement>('[data-field="dropoff"] input').value, "新宿駅");
  assert.equal(slow.drafts.length, 1);
  assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "新宿駅", lat: 35.6896, lng: 139.7006 });
});

test("M9E-08 ②：经停点取坐标期间删掉前面的经停点（整个表单重画），框里仍是选中的候选，坐标回来写进原来那一行", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter"] }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  await pick("waypoint-0", "成田", "成田国際空港");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  await type("waypoint-1", "新宿");
  clickOption("waypoint-1");
  ($('[aria-label="删除经停点 1"]') as HTMLButtonElement).click();
  assert.equal($<HTMLInputElement>('[data-field="waypoint-0"] input').value, "新宿駅", "重画后框里仍是选中的候选");
  assert.equal($('[data-field="waypoint-0"] [aria-live]').textContent, "正在取位置…");
  slow.release("ChIJshinjuku");
  await wait(20);
  assert.equal($('[data-field="waypoint-0"] [aria-live]').textContent, "");
  const stay = $<HTMLSelectElement>('[data-focus="stay-0"]');
  stay.value = "60";
  stay.dispatchEvent(new Event("change"));
  await pick("dropoff", "成田", "成田国際空港");
  submitForm();
  await wait(30);
  assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["waypoints"], [{ name: "新宿駅", lat: 35.6896, lng: 139.7006, stay_minutes: 60 }]);
});

test("M9E-08 ③：取坐标失败如实提示、不建草稿，客人重选后可以提交", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  await type("dropoff", "東京");
  clickOption("dropoff");
  submitForm();
  await wait(20);
  slow.release("ChIJtokyo", { status: 503, body: { error: { code: "PLACES_UNAVAILABLE" } } });
  await wait(30);
  assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "取不到这个地点的位置，请重新选一个");
  assert.equal($('[data-role="message"]').textContent, "取不到这个地点的位置，请重新选一个");
  assert.equal(shadow().activeElement, $('[data-field="dropoff"] input'), "焦点移到要重选的地址框");
  assert.equal($(".nzb-primary").textContent, "查看价格");
  assert.equal($(".nzb-primary").getAttribute("aria-disabled"), null);
  assert.equal(slow.drafts.length, 0);
  await type("dropoff", "新宿");
  assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "", "重新打字后提示消失");
  clickOption("dropoff");
  slow.release("ChIJshinjuku");
  await wait(20);
  submitForm();
  await wait(30);
  assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "新宿駅", lat: 35.6896, lng: 139.7006 });
});

test("M9E-08 审查：取位置一直不回时，客人改选自带坐标的候选后能正常提交（被换掉的旧请求不再挡提交）", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  const went: string[] = [];
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, (url) => went.push(url));
  await pick("pickup", "成田", "成田国際空港");
  await type("dropoff", "東京");
  clickOption("dropoff");
  submitForm();
  await wait(20);
  assert.equal($(".nzb-primary").textContent, "正在取位置…");
  await type("dropoff", "成田");
  assert.equal($(".nzb-primary").textContent, "查看价格", "改字后不再等那次取位置");
  assert.equal($(".nzb-primary").getAttribute("aria-disabled"), null);
  clickOption("dropoff");
  submitForm();
  await wait(30);
  assert.equal(slow.drafts.length, 1);
  assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "成田国際空港", lat: 35.772, lng: 140.3929 });
  assert.equal(went.length, 1);
});

test("M9E-08 审查：取位置超时按「取不到这个地点的位置」提示、按钮恢复，重选后可以提交", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  const original = LOCATE_TIMEOUT.ms;
  LOCATE_TIMEOUT.ms = 80;
  try {
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
    await pick("pickup", "成田", "成田国際空港");
    await type("dropoff", "東京");
    clickOption("dropoff");
    submitForm();
    await wait(20);
    assert.equal($(".nzb-primary").textContent, "正在取位置…");
    await wait(150);
    assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "取不到这个地点的位置，请重新选一个");
    assert.equal($('[data-role="message"]').textContent, "取不到这个地点的位置，请重新选一个");
    assert.equal($(".nzb-primary").textContent, "查看价格");
    assert.equal($(".nzb-primary").getAttribute("aria-disabled"), null);
    assert.equal(slow.drafts.length, 0);
    await type("dropoff", "新宿");
    clickOption("dropoff");
    slow.release("ChIJshinjuku");
    await wait(20);
    submitForm();
    await wait(30);
    assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "新宿駅", lat: 35.6896, lng: 139.7006 });
  } finally {
    LOCATE_TIMEOUT.ms = original;
  }
});

test("M9E-08 审查：包车经停点在取位置时切到「区间」，提交不再等经停点", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter", "transfer"] }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "成田", "成田国際空港");
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  await type("waypoint-0", "新宿");
  clickOption("waypoint-0");
  submitForm();
  await wait(20);
  assert.equal($(".nzb-primary").textContent, "正在取位置…", "包车时等经停点");
  ($('[data-tab="transfer"]') as HTMLButtonElement).click();
  await wait(30);
  assert.equal(slow.drafts.length, 1, "切到区间后不再等经停点，接着建草稿");
  assert.equal((slow.drafts[0] as { draft: Record<string, unknown> }).draft["tab"], "transfer");
});

test("M9E-08 复审：老浏览器（Safari 15 / iOS 15）没有 AbortSignal.timeout 时，选谷歌候选仍能取到位置", async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true, writable: true });
  try {
    const slow = slowDetails();
    handler = slow.handler;
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
    await pick("pickup", "成田", "成田国際空港");
    await type("dropoff", "東京");
    clickOption("dropoff");
    const details = calls.find((call) => call.url.pathname === "/embed/v1/places/details");
    assert.ok(details?.init?.signal instanceof AbortSignal, "取位置仍带超时用的取消信号");
    slow.release("ChIJtokyo");
    await wait(20);
    assert.equal($('[data-field="dropoff"] [aria-live]').textContent, "", "不提示取不到位置");
    submitForm();
    await wait(30);
    assert.deepEqual((slow.drafts[0] as { draft: Record<string, unknown> }).draft["dropoff"], { name: "東京駅", lat: 35.6812, lng: 139.7671 });
  } finally {
    if (original !== undefined) Object.defineProperty(AbortSignal, "timeout", original);
  }
});

/** M9E-10：替身 ResizeObserver，测试里手动给出容器宽度 */
async function withResize(run: (resize: (width: number) => void) => Promise<void>): Promise<void> {
  const original = globalThis.ResizeObserver;
  let callback: ResizeObserverCallback | null = null;
  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      callback = cb;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  try {
    await run((width) => callback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
  } finally {
    globalThis.ResizeObserver = original;
  }
}
const layout = (): string | null => $(".nzb-shell").getAttribute("data-layout");

test("M9E-10 外观：layout: \"bar\" 只在组件容器不窄于 768 px 时用，容器变窄自动换成 card（按容器宽度，不按视口），不重画、已填的不丢", async () => {
  handler = places;
  await withResize(async (resize) => {
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", layout: "bar" });
    assert.equal(layout(), "card", "量不到宽度时按 card");
    resize(1200);
    assert.equal(layout(), "bar");
    await pick("pickup", "成田", "成田国際空港");
    resize(767);
    assert.equal(layout(), "card");
    resize(768);
    assert.equal(layout(), "bar");
    assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港", "换外观不重画");
  });
  await withResize(async (resize) => {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", layout: "grid" });
    resize(1440);
    assert.equal(layout(), "bar", "不认识的 layout 按没传：配置里也没有，用 auto（≥ 900 px 横条）");
    resize(800);
    assert.equal(layout(), "card");
  });
});

/** M9E-14：配置里带上嵌入码后台设的外观 */
const configWith = (layout: unknown): Handler => (url, init) => (url.pathname === "/embed/v1/config" ? { status: 200, body: { ...config.body, layout } } : places(url, init));

test("M9E-14 优先级：init 没传 layout 时用配置里的（后台设的 bar）；init 传了 card 以 init 为准；配置里不认识或没有时用 auto", async () => {
  handler = configWith("bar");
  await withResize(async (resize) => {
    const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    resize(800);
    await starting;
    assert.equal(layout(), "bar", "后台设的 bar：800 px（768–899）也是横条");
    resize(767);
    assert.equal(layout(), "card", "bar 窄于 768 px 仍退成卡片");
  });
  await withResize(async (resize) => {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", layout: "card" });
    resize(1440);
    await starting;
    assert.equal(layout(), "card", "init 传了 card，后台设 bar 也不管");
  });
  await withResize(async (resize) => {
    handler = configWith("card");
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", layout: "auto" });
    resize(1440);
    await starting;
    assert.equal(layout(), "bar", "init 传了 auto，后台设 card 也不管");
  });
  for (const configured of ["banner", undefined, "auto"]) {
    await withResize(async (resize) => {
      handler = configWith(configured);
      document.body.innerHTML = '<div id="nozomi-booking"></div>';
      const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
      resize(1440);
      await starting;
      assert.equal(layout(), "bar", `配置里是 ${String(configured)}：按 auto`);
      resize(899);
      assert.equal(layout(), "card", `配置里是 ${String(configured)}：按 auto`);
    });
  }
});

test("M9E-14 auto：容器 900 px 横条、899 px 卡片（按容器宽度，不按视口）；autoBreakpoint 能改门槛，写错用 900", async () => {
  handler = configWith("auto");
  await withResize(async (resize) => {
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    assert.equal(layout(), "card", "量不到宽度时按 card");
    for (const [width, expected] of [[900, "bar"], [899, "card"], [1440, "bar"], [390, "card"], [768, "card"], [900, "bar"]] as const) {
      resize(width);
      assert.equal(layout(), expected, `${width} px`);
    }
  });
  await withResize(async (resize) => {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", autoBreakpoint: 1100 });
    resize(1099);
    assert.equal(layout(), "card");
    resize(1100);
    assert.equal(layout(), "bar");
  });
  await withResize(async (resize) => {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", autoBreakpoint: 300 });
    resize(899);
    assert.equal(layout(), "card", "门槛低于 768 不认，用 900");
    resize(900);
    assert.equal(layout(), "bar");
  });
});

test("M9E-14 不闪：配置回来之前不画表单，配置回来后第一次画出来就是后台设的外观（不会先卡片再变横条）", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  handler = async (url, init) => {
    if (url.pathname === "/embed/v1/config") await gate;
    return configWith("bar")(url, init);
  };
  await withResize(async (resize) => {
    const seen: (string | null)[] = [];
    const host = document.querySelector("#nozomi-booking") as HTMLElement;
    const starting = initWithBase(BASE, { key: KEY, root: host, lang: "zh" });
    resize(1200);
    await wait(20);
    assert.equal(shadow().querySelector(".nzb-shell"), null, "配置回来之前什么都不画");
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains("nzb-shell")) seen.push(node.getAttribute("data-layout"));
        if (record.type === "attributes" && record.attributeName === "data-layout") seen.push((record.target as HTMLElement).getAttribute("data-layout"));
      }
    });
    observer.observe(shadow(), { childList: true, subtree: true, attributes: true, attributeFilter: ["data-layout"] });
    release();
    await starting;
    await wait(0);
    observer.disconnect();
    assert.deepEqual(seen, ["bar"], "只出现过横条");
  });
});

test("M9E-14 auto 下来回换外观（窗口变宽变窄）：已填的地点、打了一半的字、人数、日期、选中的标签和焦点都不丢，不重画", async () => {
  handler = configWith("auto");
  await withResize(async (resize) => {
    const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    resize(1280);
    await starting;
    assert.equal(layout(), "bar");
    await pick("pickup", "成田", "成田国際空港");
    const dropoff = $<HTMLInputElement>('[data-field="dropoff"] input');
    dropoff.value = "東京";
    $<HTMLButtonElement>('[aria-label="增加乘客"]').click();
    const date = $<HTMLInputElement>('input[type="date"]');
    date.value = "2030-05-06";
    date.dispatchEvent(new Event("input", { bubbles: true }));
    date.dispatchEvent(new Event("change", { bubbles: true }));
    dropoff.focus();
    const shell = $(".nzb-shell");
    for (const width of [899, 900, 390, 1440, 899]) {
      resize(width);
      assert.equal(layout(), width >= 900 ? "bar" : "card", `${width} px`);
      assert.equal($(".nzb-shell"), shell, "同一个元素，没有重画");
      assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港");
      assert.equal($<HTMLInputElement>('[data-field="dropoff"] input').value, "東京", "打了一半的字还在");
      assert.equal($<HTMLInputElement>('input[type="date"]').value, "2030-05-06");
      assert.match($(".nzb-trigger-text").textContent ?? "", /3 位乘客/);
      assert.equal(shadow().activeElement, dropoff, "焦点还在原来的框里");
    }
  });
});

test("M9E-10 主题：init 的 theme 变成 Shadow DOM 样式表里的 CSS 变量（不写内联样式）；写错的项不写、用默认值", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", theme: { primary: "#ff6b35", accent: "nope", radius: 12, fontFamily: "Georgia, serif" } });
  const css = [...shadow().adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n") + [...shadow().querySelectorAll("style")].map((node) => node.textContent).join("\n");
  assert.match(css, /--nzb-primary: #FF6B35/);
  assert.match(css, /--nzb-on-primary: var\(--nzb-dark\)/, "橙色上白字不够 4.5:1");
  assert.match(css, /--nzb-radius: 12px/);
  assert.match(css, /--nzb-font: Georgia, serif/);
  assert.doesNotMatch(css, /nope/);
  assert.equal($(".nzb-shell").getAttribute("style"), null);
  assert.match(WIDGET_CSS, /\.nzb-primary \{[^}]*background: var\(--nzb-primary\); color: var\(--nzb-on-primary\);/);
});

test("M9E-10 隐私提示只在底部写一次，每个地址框（含经停点）用 aria-describedby 关联到它；占位提示三语", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["charter"] });
  ($('[data-action="add-waypoint"]') as HTMLButtonElement).click();
  const boxes = [...shadow().querySelectorAll<HTMLInputElement>('[role="combobox"]')];
  assert.equal(boxes.length, 3);
  const notes = [...shadow().querySelectorAll("p")].filter((node) => node.textContent === "只填地点，不要填姓名、电话。");
  assert.equal(notes.length, 1, "只写一次");
  for (const box of boxes) {
    const id = box.getAttribute("aria-describedby") ?? "";
    assert.ok(id !== "");
    assert.equal(shadow().getElementById(id), notes[0], "aria-describedby 指向底部那一行");
    assert.equal(box.placeholder, "地址、机场、酒店等");
  }
  document.body.innerHTML = '<div id="nozomi-booking"></div>';
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "ja" });
  assert.equal($<HTMLInputElement>('[data-field="pickup"] input').placeholder, "住所・空港・ホテルなど");
  assert.equal($(".nzb-primary").textContent, "料金を見る");
});

test("M9E-10 人数和行李的加减器：键盘能开关，到头的按钮 aria-disabled，摘要和读屏的数字跟着变，草稿里是选的数", async () => {
  let drafted: { draft: Record<string, unknown> } | null = null;
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "x", url: "x" } };
    }
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
  const trigger = $<HTMLButtonElement>('[data-action="guests"]');
  const pop = shadow().getElementById(trigger.getAttribute("aria-controls") ?? "") as HTMLElement;
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(pop.hidden, true);
  const name = (trigger.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => shadow().getElementById(id)?.textContent).join(" ");
  assert.equal(name, "人数和行李 2 位乘客 · 1 件行李", "按钮的名字是标签 + 摘要");
  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(pop.hidden, false);
  assert.equal(shadow().activeElement, $('[aria-label="减少乘客"]'), "打开后焦点进弹层");
  const step = (label: string, times = 1): void => {
    for (let index = 0; index < times; index += 1) ($(`[aria-label="${label}"]`) as HTMLButtonElement).click();
  };
  step("增加乘客", 30);
  assert.equal($('[data-value="passengers"]').textContent, "20");
  assert.equal($('[aria-label="增加乘客"]').getAttribute("aria-disabled"), "true");
  step("减少乘客", 30);
  assert.equal($('[data-value="passengers"]').textContent, "1");
  assert.equal($('[aria-label="减少乘客"]').getAttribute("aria-disabled"), "true");
  assert.equal($('[aria-label="增加乘客"]').getAttribute("aria-disabled"), null);
  step("增加乘客", 2);
  step("增加行李", 2);
  step("减少行李", 5);
  assert.equal($('[data-value="luggage"]').textContent, "0");
  assert.equal($('[data-value="passengers"]').getAttribute("aria-live"), "polite");
  assert.equal(shadow().getElementById(`${trigger.id}-summary`)?.textContent, "3 位乘客 · 0 件行李");
  pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(pop.hidden, true, "Esc 关上");
  assert.equal(shadow().activeElement, trigger, "焦点回到按钮");
  trigger.click();
  ($(".nzb-done") as HTMLButtonElement).click();
  assert.equal(pop.hidden, true, "「完成」关上");
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "成田", "成田国際空港");
  submitForm();
  await wait(30);
  const sent = drafted as { draft: Record<string, unknown> } | null;
  assert.deepEqual([sent?.draft["passengers"], sent?.draft["luggage"]], [3, 0]);
});

test("M9E-10 交换起点和终点；横条的搜索按钮填好前 data-ready=false，填好后 true（按钮的读屏名字始终是「查看价格」）", async () => {
  let drafted: { draft: Record<string, unknown> } | null = null;
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "x", url: "x" } };
    }
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", layout: "bar" }, () => undefined);
  assert.equal($(".nzb-primary").getAttribute("data-ready"), "false");
  assert.equal($(".nzb-primary").textContent, "查看价格");
  await pick("pickup", "成田", "成田国際空港");
  assert.equal($(".nzb-primary").getAttribute("data-ready"), "false");
  await pick("dropoff", "東京", "東京駅");
  assert.equal($(".nzb-primary").getAttribute("data-ready"), "true");
  ($('[data-action="swap"]') as HTMLButtonElement).click();
  assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "東京駅");
  assert.equal($<HTMLInputElement>('[data-field="dropoff"] input').value, "成田国際空港");
  assert.equal(shadow().activeElement, $('[data-action="swap"]'), "交换后焦点留在交换按钮");
  assert.equal($('[data-action="swap"]').getAttribute("aria-label"), "交换起点和终点");
  submitForm();
  await wait(30);
  const sent = drafted as { draft: Record<string, unknown> } | null;
  assert.deepEqual([(sent?.draft["pickup"] as { name: string }).name, (sent?.draft["dropoff"] as { name: string }).name], ["東京駅", "成田国際空港"]);
});

test("M9E-10 日期、时间合成一个控件：两个原生输入框各有 label，控件有小标题", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en" });
  const box = $(".nzb-when-box");
  const inputs = [...box.querySelectorAll<HTMLInputElement>("input")];
  assert.deepEqual(inputs.map((input) => input.type), ["date", "time"]);
  for (const [input, text] of [[inputs[0], "Date"], [inputs[1], "Time"]] as const) assert.equal(shadow().querySelector(`label[for="${input?.id}"]`)?.textContent, text);
  assert.equal($(".nzb-when .nzb-label").textContent, "Pickup date & time");
});

test("M9E-10 日期、时间按组件的语言显示（不按访客浏览器的语言）；改了跟着变，草稿里仍是 YYYY-MM-DD / HH:MM", async () => {
  let drafted: { draft: Record<string, unknown> } | null = null;
  handler = (url, init) => {
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return { status: 201, body: { id: "D".repeat(43), expires_at: "x", url: "x" } };
    }
    return places(url, init);
  };
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "ja" }, () => undefined);
  const shown = (): string[] => [...shadow().querySelectorAll(".nzb-shown")].map((node) => (node.textContent ?? "").replace(/\s/g, " "));
  const date = $<HTMLInputElement>('[data-focus="date"]');
  const time = $<HTMLInputElement>('[data-focus="time"]');
  const year = new Date().getFullYear() + 1;
  date.value = `${year}-12-24`;
  date.dispatchEvent(new Event("input", { bubbles: true }));
  time.value = "18:30";
  time.dispatchEvent(new Event("input", { bubbles: true }));
  const weekday = (lang: string): string => new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(year, 11, 24));
  assert.deepEqual(shown(), [`${year}年12月24日(${weekday("ja-JP")})`, "18:30"]);
  assert.ok(shadow().querySelectorAll(".nzb-shown[aria-hidden=\"true\"]").length === 2, "显示的文字不给读屏（读屏读输入框本身）");
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "成田", "成田国際空港");
  submitForm();
  await wait(30);
  assert.equal((drafted as { draft: Record<string, unknown> } | null)?.draft["service_local"], `${year}-12-24T18:30`);
  document.body.innerHTML = '<div id="nozomi-booking"></div>';
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en" });
  $<HTMLInputElement>('[data-focus="date"]').value = `${year}-12-24`;
  $<HTMLInputElement>('[data-focus="date"]').dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(shown()[0], `${weekday("en-US")}, Dec 24, ${year}`);
});

test("M9E-10 横条的格子：浅灰底加一条细边框，边框和白色长条、和格子底色都够 3:1（WCAG 1.4.11）", () => {
  const rule = /\.nzb-shell\[data-layout="bar"\] \.nzb-form > \.nzb-field \{([^}]*)\}/.exec(WIDGET_CSS)?.[1] ?? "";
  const border = /border: 1px solid (#[0-9a-f]{6})/.exec(rule)?.[1]?.toUpperCase() ?? "";
  const fill = /background: (#[0-9a-f]{6})/.exec(rule)?.[1]?.toUpperCase() ?? "";
  const strip = /\.nzb-shell\[data-layout="bar"\] \.nzb-form \{[^}]*background: (#[0-9a-f]{6})/.exec(WIDGET_CSS)?.[1]?.toUpperCase() ?? "";
  assert.ok(border !== "" && fill !== "" && strip === "#FFFFFF", rule);
  const ratio = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.ok(ratio(border, strip) >= 3, `边框 ${border} 对白色长条 ${ratio(border, strip).toFixed(2)}:1`);
  assert.ok(ratio(border, fill) >= 3, `边框 ${border} 对格子底色 ${fill} ${ratio(border, fill).toFixed(2)}:1`);
});

/** 样式表里 .nzb-shell 上定义的默认 CSS 变量值（#rrggbb） */
const cssDefault = (name: string): string => new RegExp(`${name}: (#[0-9a-f]{6})`).exec(/\.nzb-shell \{[^}]*\}/.exec(WIDGET_CSS)?.[0] ?? "")?.[1]?.toUpperCase() ?? "";
const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("#233 审查：横条选中的标签除了米色底，还有一条主色顶条（不只靠颜色区分）；顶条对白、对米色底、对没选中的灰底都够 3:1", () => {
  const selected = /\.nzb-shell\[data-layout="bar"\] \.nzb-tab\[aria-selected="true"\] \{([^}]*)\}/.exec(WIDGET_CSS)?.[1] ?? "";
  assert.match(selected, /box-shadow: inset 0 3px 0 var\(--nzb-mark\);/);
  assert.match(selected, /background: var\(--nzb-accent\);/, "米色底保留");
  const unselected = /\.nzb-shell\[data-layout="bar"\] \.nzb-tab \{[^}]*background: (#[0-9a-f]{6})/.exec(WIDGET_CSS)?.[1]?.toUpperCase() ?? "";
  assert.match(/\.nzb-shell \{[^}]*\}/.exec(WIDGET_CSS)?.[0] ?? "", /--nzb-mark: var\(--nzb-primary\);/, "默认标记条是主色");
  const mark = cssDefault("--nzb-primary");
  for (const [name, background] of [["白", "#FFFFFF"], ["米色底", cssDefault("--nzb-accent")], ["没选中的灰底", unselected]] as const) assert.ok(contrast(mark, background) >= 3, `标记条对${name} ${contrast(mark, background).toFixed(2)}:1`);
  // 卡片的选中底条用同一个兜底过的变量（浅主色时是深色）
  assert.match(WIDGET_CSS, /\.nzb-tab\[aria-selected="true"\] \{ background: #ffffff; color: var\(--nzb-ink\); border-bottom-color: var\(--nzb-mark\); \}/);
});

test("#233 审查：日期时间——键盘编辑时显示原生分段（:focus-visible 不透明），清空某一段时显示「请选择日期 / 时间」而不是空白；小标题读屏读得到（fieldset + legend）", async () => {
  handler = places;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
  assert.match(WIDGET_CSS, /\.nzb-bare:focus-visible \{ opacity: 1; \}/);
  const group = $(".nzb-when");
  assert.equal(group.tagName, "FIELDSET");
  assert.equal(group.querySelector(":scope > legend")?.textContent, "用车日期和时间");
  assert.equal(group.querySelector("legend")?.getAttribute("aria-hidden"), null);
  const date = $<HTMLInputElement>('[data-focus="date"]');
  const time = $<HTMLInputElement>('[data-focus="time"]');
  date.value = "";
  date.dispatchEvent(new Event("input", { bubbles: true }));
  time.value = "";
  time.dispatchEvent(new Event("input", { bubbles: true }));
  const shown = [...shadow().querySelectorAll(".nzb-shown")];
  assert.deepEqual(shown.map((node) => node.textContent), ["请选择日期", "请选择时间"]);
  assert.ok(shown.every((node) => node.hasAttribute("data-empty")));
  submitForm();
  await wait(20);
  assert.equal($('[data-role="message"]').textContent, "请从候选里选一个地点", "没选地点的提示仍排在前面");
  date.value = "2030-01-02";
  date.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(shown[0]?.hasAttribute("data-empty"), false);
  assert.equal(shown[0]?.textContent, "2030年1月2日周三");
});

test("#233 审查：出发地 / 目的地正在取位置时交换按钮标成不可用、点了不换；取完恢复", async () => {
  const slow = slowDetails();
  handler = slow.handler;
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, () => undefined);
  await pick("pickup", "成田", "成田国際空港");
  await type("dropoff", "東京");
  clickOption("dropoff");
  const swap = $<HTMLButtonElement>('[data-action="swap"]');
  assert.equal(swap.getAttribute("aria-disabled"), "true");
  swap.click();
  assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港", "取位置时不换");
  slow.release("ChIJtokyo");
  await wait(20);
  assert.equal($('[data-action="swap"]').getAttribute("aria-disabled"), null);
  ($('[data-action="swap"]') as HTMLButtonElement).click();
  assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "東京駅");
});

test("#233 审查：同一个容器再 init 时，旧组件的 ResizeObserver 和页面上的监听都解除，不越积越多", async () => {
  handler = places;
  const original = globalThis.ResizeObserver;
  const live = new Set<object>();
  globalThis.ResizeObserver = class {
    observe(): void {
      live.add(this);
    }
    unobserve(): void {}
    disconnect(): void {
      live.delete(this);
    }
  } as unknown as typeof ResizeObserver;
  const added: string[] = [];
  const removed: string[] = [];
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = ((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]) => {
    added.push(type);
    add(type, ...rest);
  }) as typeof document.addEventListener;
  document.removeEventListener = ((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | EventListenerOptions)?]) => {
    removed.push(type);
    remove(type, ...rest);
  }) as typeof document.removeEventListener;
  try {
    for (let index = 0; index < 3; index += 1) await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    assert.equal(live.size, 1, "只剩最后一个组件在量容器宽度");
    assert.equal(added.filter((type) => type === "pointerdown").length - removed.filter((type) => type === "pointerdown").length, 1, "页面上只挂着一个 pointerdown");
    assert.equal(shadow().querySelectorAll(".nzb-shell").length, 1);
  } finally {
    globalThis.ResizeObserver = original;
    document.addEventListener = add;
    document.removeEventListener = remove;
  }
});

/** M9E-22：取配置的应答由测试放行（release 之前一直挂着） */
function heldConfig(answer: Reply): { handler: Handler; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    handler: async (url, init) => {
      if (url.pathname !== "/embed/v1/config") return places(url, init);
      await gate;
      return answer;
    },
  };
}
async function withConfigTimeout(ms: number, run: () => Promise<void>): Promise<void> {
  const original = CONFIG_TIMEOUT.ms;
  CONFIG_TIMEOUT.ms = ms;
  try {
    await run();
  } finally {
    CONFIG_TIMEOUT.ms = original;
  }
}
const tabTitles = (): (string | null | undefined)[] => [...shadow().querySelectorAll('[role="tab"] .nzb-tab-title')].map((tab) => tab.textContent);
const noCorsCalls = (): number => calls.filter((call) => call.init?.mode === "no-cors").length;

test("M9E-22 取配置 8 秒没回：之前不画，到时按 init 的 layout / lang / services 显示表单；没传的用 auto、日文、两个标签", async () => {
  assert.equal(CONFIG_TIMEOUT.ms, 8_000, "默认等 8 秒");
  await withConfigTimeout(80, async () => {
    handler = heldConfig(config).handler;
    await withResize(async (resize) => {
      const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en", services: ["charter"], layout: "bar" });
      resize(800);
      await wait(30);
      assert.equal(shadow().querySelector(".nzb-shell"), null, "没到 8 秒（测试里调成 80 毫秒）什么都不画");
      await starting;
      assert.ok(shadow().querySelector("form"), "超时后显示表单");
      assert.equal(layout(), "bar", "init 的 layout");
      assert.equal($(".nzb-primary").textContent, "See prices", "init 的 lang");
      assert.deepEqual(tabTitles(), [], "init 只给了包车：没有标签");
      assert.match(shadow().textContent ?? "", /Add a stop/, "包车表单");
    });
    await withResize(async (resize) => {
      document.body.innerHTML = '<div id="nozomi-booking"></div>';
      const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking" });
      resize(1200);
      await starting;
      assert.equal($(".nzb-primary").textContent, "料金を見る", "没传 lang 用日文");
      assert.deepEqual(tabTitles(), ["片道送迎", "時間貸し"], "没传 services 两个都显示");
      assert.equal(layout(), "bar", "没传 layout 按 auto：1200 px 横条");
      resize(899);
      assert.equal(layout(), "card", "auto：899 px 卡片");
    });
  });
});

test("M9E-22 取配置连不上（no-cors 也失败）、5xx：马上按 init 的参数显示表单，不等 8 秒", async () => {
  for (const reply of ["network", { status: 500, body: null }, { status: 503, body: { error: { code: "UNAVAILABLE" } } }] as Reply[]) {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    calls = [];
    handler = (url, init) => (url.pathname === "/embed/v1/config" ? reply : places(url, init));
    const started = Date.now();
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh", services: ["transfer"] });
    assert.ok(Date.now() - started < 2_000, `${JSON.stringify(reply)}：不等 8 秒`);
    assert.ok(shadow().querySelector("form"), `${JSON.stringify(reply)}：显示表单`);
    assert.equal(shadow().querySelector('[role="status"]'), null, "不显示「暂时无法使用」");
    assert.equal($(".nzb-primary").textContent, "查看价格");
    assert.deepEqual(tabTitles(), []);
    assert.equal(noCorsCalls(), reply === "network" ? 1 : 0, "读得到状态的不再试 no-cors");
  }
});

test("M9E-22 取配置读得到的 4xx（嵌入码无效 / 停用、不在白名单）：仍只显示「暂时无法使用」和主站链接，不显示表单", async () => {
  for (const status of [401, 403, 404]) {
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    calls = [];
    handler = (url, init) => (url.pathname === "/embed/v1/config" ? { status, body: { error: { code: "EMBED_ORIGIN_NOT_ALLOWED" } } } : places(url, init));
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "en" });
    assert.match($('[role="status"]').textContent ?? "", /The booking form is unavailable right now/, `${status}`);
    assert.equal($<HTMLAnchorElement>("a").getAttribute("href"), `${BASE}/book/new`);
    assert.equal(shadow().querySelector("form"), null, `${status}：不显示表单`);
    assert.equal(noCorsCalls(), 0);
  }
});

test("M9E-22 表单已显示后配置才回来（正常）：init 没传 layout 时换成后台设的外观，不重画，已填的、焦点不丢；语言和标签不变", async () => {
  const late = { status: 200, body: { lang: "en", services: ["charter"], layout: "bar", site_origin: BASE } };
  await withConfigTimeout(50, async () => {
    const held = heldConfig(late);
    handler = held.handler;
    await withResize(async (resize) => {
      const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking" });
      resize(800);
      await starting;
      assert.equal(layout(), "card", "先按 auto：800 px 卡片");
      await pick("pickup", "成田", "成田国際空港");
      const dropoff = $<HTMLInputElement>('[data-field="dropoff"] input');
      dropoff.value = "東京";
      $<HTMLButtonElement>('[aria-label="人数を増やす"]').click();
      dropoff.focus();
      const shell = $(".nzb-shell");
      held.release();
      await wait(20);
      assert.equal(layout(), "bar", "换成后台设的横条（800 px 够横条）");
      assert.equal($(".nzb-shell"), shell, "同一个元素，没有重画");
      assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港");
      assert.equal($<HTMLInputElement>('[data-field="dropoff"] input').value, "東京", "打了一半的字还在");
      assert.match($(".nzb-trigger-text").textContent ?? "", /3/);
      assert.equal(shadow().activeElement, dropoff, "焦点还在");
      assert.equal($(".nzb-primary").textContent, "料金を見る", "语言不变");
      assert.deepEqual(tabTitles(), ["片道送迎", "時間貸し"], "标签不变");
      assert.equal($('[data-role="message"]').textContent, "");
      resize(767);
      assert.equal(layout(), "card", "之后按后台设的 bar 的规则：窄于 768 退成卡片");
    });
  });
  await withConfigTimeout(50, async () => {
    const held = heldConfig(late);
    handler = held.handler;
    await withResize(async (resize) => {
      document.body.innerHTML = '<div id="nozomi-booking"></div>';
      const starting = initWithBase(BASE, { key: KEY, root: "#nozomi-booking", layout: "card" });
      resize(1200);
      await starting;
      held.release();
      await wait(20);
      assert.equal(layout(), "card", "init 传了 card，晚回来的 bar 也不管");
    });
  });
  await withConfigTimeout(50, async () => {
    const held = heldConfig(late);
    handler = held.handler;
    await withResize(async (resize) => {
      document.body.innerHTML = '<div id="nozomi-booking"></div>';
      const host = document.querySelector("#nozomi-booking") as HTMLElement;
      const starting = initWithBase(BASE, { key: KEY, root: host });
      resize(1200);
      await starting;
      handler = places;
      await initWithBase(BASE, { key: KEY, root: host, layout: "card" });
      resize(1200);
      held.release();
      await wait(20);
      assert.equal(layout(), "card", "同一容器再 init 后，旧组件晚回来的配置不再动外观");
    });
  });
});

test("M9E-22 表单已显示后配置才回来（被拒）：表单和已填的都保留，提示行说明并给主站链接，切标签重画后仍在；晚回来的 5xx 不管", async () => {
  await withConfigTimeout(50, async () => {
    const held = heldConfig("blocked");
    handler = held.handler;
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    await pick("pickup", "成田", "成田国際空港");
    const dropoff = $<HTMLInputElement>('[data-field="dropoff"] input');
    dropoff.value = "東京";
    assert.equal($('[data-role="message"]').textContent, "");
    held.release();
    await wait(20);
    assert.ok(shadow().querySelector("form"), "表单还在");
    assert.equal(shadow().querySelector('[role="status"]'), null, "不换成「暂时无法使用」");
    assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港");
    assert.equal($<HTMLInputElement>('[data-field="dropoff"] input'), dropoff, "没有重画");
    assert.equal(dropoff.value, "東京");
    assert.equal($('[data-role="message"]').textContent, "这个网站暂时不能直接预订，请到主站预订。 到主站预订");
    assert.equal($<HTMLAnchorElement>('[data-role="message"] a').getAttribute("href"), `${BASE}/book/new`);
    $<HTMLButtonElement>('[data-tab="charter"]').click();
    assert.equal($('[data-role="message"]').textContent, "这个网站暂时不能直接预订，请到主站预订。 到主站预订", "切标签重画后仍在");
    assert.equal($<HTMLInputElement>('[data-field="pickup"] input').value, "成田国際空港");
  });
  await withConfigTimeout(50, async () => {
    const held = heldConfig({ status: 503, body: null });
    handler = held.handler;
    document.body.innerHTML = '<div id="nozomi-booking"></div>';
    await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" });
    const shell = $(".nzb-shell");
    held.release();
    await wait(20);
    assert.equal($(".nzb-shell"), shell);
    assert.equal($('[data-role="message"]').textContent, "", "晚回来的 5xx 不提示");
  });
});

test("M9E-22 配置没回来先显示的表单，提交时被拒（401 / 403 / 404）：说明这个网站暂时不能直接预订并给主站链接，不跳转；读不出的失败也给链接", async () => {
  const went: string[] = [];
  let reply: Reply = { status: 403, body: { error: { code: "EMBED_ORIGIN_NOT_ALLOWED" } } };
  handler = (url, init) => (url.pathname === "/embed/v1/config" ? "network" : url.pathname === "/embed/v1/booking-drafts" ? reply : places(url, init));
  await initWithBase(BASE, { key: KEY, root: "#nozomi-booking", lang: "zh" }, (url) => went.push(url));
  await pick("pickup", "成田", "成田国際空港");
  await pick("dropoff", "東京", "東京駅");
  const submit = async (): Promise<string> => {
    $<HTMLFormElement>("form").dispatchEvent(new Event("submit", { cancelable: true }));
    await wait(30);
    return $('[data-role="message"]').textContent ?? "";
  };
  for (const status of [403, 401, 404]) {
    reply = { status, body: { error: { code: "EMBED_ORIGIN_NOT_ALLOWED" } } };
    assert.equal(await submit(), "这个网站暂时不能直接预订，请到主站预订。 到主站预订", `${status}`);
    assert.equal($<HTMLAnchorElement>('[data-role="message"] a').getAttribute("href"), `${BASE}/book/new`);
    assert.equal($(".nzb-primary").textContent, "查看价格", "按钮恢复");
  }
  reply = "blocked";
  assert.equal(await submit(), "暂时连不上，请稍后再试或直接到主站预订。 到主站预订", "浏览器里被拒读不出：按连不上说，也给链接");
  assert.equal($<HTMLAnchorElement>('[data-role="message"] a').getAttribute("href"), `${BASE}/book/new`);
  assert.equal(calls.filter((call) => call.url.pathname === "/embed/v1/booking-drafts").length, 4, "每次都发给服务端核对");
  assert.deepEqual(went, []);
});
