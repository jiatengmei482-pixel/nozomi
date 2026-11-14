/**
 * 嵌入组件（M9E-03，ADR 0090 第四节）在浏览器环境（happy-dom）里的行为：界面在 Shadow DOM 里；取配置失败只显示「暂时无法使用」；
 * 两个标签；地址提示经 `/embed/v1/places`、带嵌入码、不带 Cookie，谷歌候选有「Powered by Google」；
 * 点「查询价格」先建草稿再跳转；400 / 429 / 网络错误各一句、不跳转。接口用替身（不连主站）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { LOCATE_TIMEOUT, initFrom, initWithBase, scriptOriginOf } from "./widget-ui.ts";
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES } from "../lib/google-attribution.ts";
import { readFile } from "node:fs/promises";
import { WIDGET_CSS } from "./widget-style.ts";

const BASE = "https://nozomi.example";
const KEY = `nze_${"A".repeat(32)}`;
type Reply = { status: number; body: unknown } | "network";
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
  const tabs = [...shadow().querySelectorAll('[role="tab"]')].map((tab) => [tab.querySelector(".nzb-tab-title")?.textContent, tab.getAttribute("aria-selected")]);
  assert.deepEqual(tabs, [["Hourly", "true"], ["Point to Point", "false"]]);
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

test("M9E-08 ①：点了谷歌候选马上点「查询价格」——按钮显示「正在取位置…」、重复点不重复提交，坐标回来后自动接着建草稿，不提示「请从候选里选」", async () => {
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

test("M9E-10 外观：默认 card；layout: \"bar\" 只在组件容器不窄于 768 px 时用，容器变窄自动换成 card（按容器宽度，不按视口），不重画、已填的不丢", async () => {
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
    assert.equal(layout(), "card", "不认识的 layout 用 card");
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
