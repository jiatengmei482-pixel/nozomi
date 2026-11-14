/**
 * `NozomiBooking.mountBooking`（M9E-16，ADR 0095 第三节第 2 小节、第六节）在浏览器环境（happy-dom）里的行为：
 * nzdraft 读出后进 sessionStorage、从地址栏去掉；建 iframe（地址、标题、allow、referrerpolicy、不加 sandbox）；
 * postMessage 只认这个 iframe、主站 origin、频道号对得上的，发出时 targetOrigin 是主站 origin；高度、换步、弹窗；
 * completed / 草稿过期删存储，过期给「重新查询」；15 秒没 ready 显示后备链接；不带 nzdraft 画查价表单、提交后跳回本页带 nzdraft。接口用替身。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { HOST_DRAFT_TTL_MS } from "./booking-protocol.ts";
import { HOST_DRAFT_KEY } from "./host-draft-store.ts";
import { BOOKING_TEXTS, READY_TIMEOUT, mountBookingFrom } from "./widget-booking.ts";
import { initFrom } from "./widget-ui.ts";

const BASE = "https://nozomi.example";
const KEY = `nze_${"A".repeat(32)}`;
const DRAFT = "D".repeat(43);
const originalFetch = globalThis.fetch;
const originalError = console.error;
let consoleErrors: string[] = [];
let fetched: { url: URL; init: RequestInit | undefined }[] = [];

beforeEach(() => {
  fetched = [];
  consoleErrors = [];
  console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));
  sessionStorage.clear();
  document.body.innerHTML = '<p>宿主页</p><div id="flow"></div>';
  history.replaceState(null, "", "/booking/");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    fetched.push({ url, init });
    if (url.pathname === "/embed/v1/config") return new Response(JSON.stringify({ lang: "ja", services: ["transfer", "charter"], site_origin: BASE }), { status: 200 });
    if (url.pathname === "/embed/v1/booking-drafts") return new Response(JSON.stringify({ id: "E".repeat(43), expires_at: "2030-01-01T00:00:00Z", url: "x" }), { status: 201 });
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  READY_TIMEOUT.ms = 15_000;
  document.body.innerHTML = "";
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = (): HTMLElement => document.querySelector("#flow") as HTMLElement;
const frameHost = (): HTMLElement | null => root().querySelector('[data-nozomi-booking="frame"]');
const iframe = (): HTMLIFrameElement => frameHost()?.shadowRoot?.querySelector("iframe") as HTMLIFrameElement;
const channelOf = (frame: HTMLIFrameElement): string => new URLSearchParams(new URL(frame.src).hash.slice(1)).get("ch") ?? "";

/** 模拟 iframe 发来的消息（source、origin 可以换成别的来测拒收） */
function fromFrame(data: Record<string, unknown>, options: { origin?: string; source?: MessageEventSource | null; ch?: string } = {}): void {
  const frame = iframe();
  const message = { ns: "nozomi-booking", v: 1, ch: options.ch ?? channelOf(frame), ...data };
  window.dispatchEvent(new MessageEvent("message", { data: message, origin: options.origin ?? BASE, source: options.source === undefined ? frame.contentWindow : options.source }));
}

function mountWithDraft(extra: Record<string, unknown> = {}) {
  history.replaceState(null, "", `/booking/?utm=a&nzdraft=${DRAFT}#top`);
  const events: unknown[] = [];
  const domEvents: unknown[] = [];
  root().addEventListener("nozomi:booking", (event) => domEvents.push((event as CustomEvent).detail));
  mountBookingFrom(BASE, { key: KEY, root: "#flow", onEvent: (event) => events.push(event), ...extra });
  return { events, domEvents };
}

test("带 nzdraft：草稿号进本标签页 sessionStorage、从地址栏去掉（其余参数和 # 原样）；建 iframe：地址、标题、allow、referrerpolicy，不加 sandbox，初始高 720px", () => {
  mountWithDraft({ lang: "en" });
  assert.equal(location.href, `${location.origin}/booking/?utm=a#top`, "nzdraft 从地址栏去掉");
  const stored = JSON.parse(sessionStorage.getItem(HOST_DRAFT_KEY) ?? "{}");
  assert.deepEqual(Object.keys(stored).sort(), ["at", "id"], "只存草稿号和时间");
  assert.equal(stored.id, DRAFT);
  const frame = iframe();
  const src = new URL(frame.src);
  assert.equal(src.origin + src.pathname, `${BASE}/embed/book`);
  assert.equal(src.searchParams.get("draft"), DRAFT);
  assert.equal(src.searchParams.get("key"), KEY);
  assert.equal(src.searchParams.get("lang"), "en");
  assert.equal(src.searchParams.get("host"), location.origin);
  assert.match(channelOf(frame), /^[0-9a-f]{32}$/, "频道号 16 字节随机数，放在 # 后面");
  assert.equal(frame.getAttribute("title"), BOOKING_TEXTS.en.title);
  assert.equal(frame.getAttribute("allow"), "payment");
  assert.equal(frame.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(frame.hasAttribute("sandbox"), false, "不加 sandbox：会传给 Stripe 的付款和 3D 验证框架");
  assert.equal(frame.getAttribute("height"), "720");
  assert.equal(fetched.length, 0, "宿主页这边不调接口");
});

test("刷新（地址上没有 nzdraft）：从 sessionStorage 取草稿号接着用；超过 2 小时的读到即删、画查价表单；存储写坏了同样删", async () => {
  sessionStorage.setItem(HOST_DRAFT_KEY, JSON.stringify({ id: DRAFT, at: Date.now() - 60_000 }));
  mountBookingFrom(BASE, { key: KEY, root: "#flow" });
  assert.equal(new URL(iframe().src).searchParams.get("draft"), DRAFT);
  assert.equal(new URL(iframe().src).searchParams.has("lang"), false, "没传语言不带，嵌入页按草稿的语言");

  sessionStorage.setItem(HOST_DRAFT_KEY, JSON.stringify({ id: DRAFT, at: Date.now() - HOST_DRAFT_TTL_MS - 1 }));
  mountBookingFrom(BASE, { key: KEY, root: "#flow" });
  assert.equal(sessionStorage.getItem(HOST_DRAFT_KEY), null);
  assert.equal(frameHost(), null, "重复调用先拆掉旧的 iframe");
  assert.ok(root().querySelector('[data-nozomi-booking="form"]'), "过期了画查价表单");
  await wait(20);

  sessionStorage.setItem(HOST_DRAFT_KEY, "{oops");
  mountBookingFrom(BASE, { key: KEY, root: "#flow" });
  assert.equal(sessionStorage.getItem(HOST_DRAFT_KEY), null);
  assert.equal(root().querySelectorAll("[data-nozomi-booking]").length, 1, "同一个容器里始终只有一份");
});

test("nzdraft 格式不对：照样从地址栏去掉，按没带处理（画查价表单）", async () => {
  history.replaceState(null, "", "/booking/?nzdraft=short");
  mountBookingFrom(BASE, { key: KEY, root: "#flow" });
  assert.equal(location.search, "");
  assert.equal(frameHost(), null);
  assert.ok(root().querySelector('[data-nozomi-booking="form"]'));
  assert.equal(sessionStorage.getItem(HOST_DRAFT_KEY), null);
  await wait(20);
});

test("sessionStorage 不可用（Safari 阻止所有 Cookie 时访问抛错）：这一次照样嵌入，不报错", () => {
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new DOMException("denied", "SecurityError"); } });
  try {
    mountWithDraft();
    assert.equal(new URL(iframe().src).searchParams.get("draft"), DRAFT);
  } finally {
    if (original) Object.defineProperty(window, "sessionStorage", original);
  }
});

test("postMessage：只认这个 iframe、主站 origin、频道号对得上的；ready 后按主站 origin 发 viewport（不用 \"*\"）；resize 调高度", () => {
  mountWithDraft();
  const frame = iframe();
  const sent: [unknown, string][] = [];
  const target = frame.contentWindow as Window;
  target.postMessage = ((message: unknown, targetOrigin: string) => sent.push([message, targetOrigin])) as typeof target.postMessage;

  fromFrame({ type: "resize", height: 900 }, { origin: "https://evil.example" });
  fromFrame({ type: "resize", height: 900 }, { source: window });
  fromFrame({ type: "resize", height: 900 }, { source: null });
  fromFrame({ type: "resize", height: 900 }, { ch: "f".repeat(32) });
  assert.equal(frame.getAttribute("height"), "720", "别的来源、别的频道一律不理");

  fromFrame({ type: "ready", lang: "ja" });
  assert.deepEqual(sent, [[{ ns: "nozomi-booking", v: 1, ch: channelOf(frame), type: "viewport", height: Math.round(window.innerHeight) }, BASE]]);
  window.dispatchEvent(new Event("resize"));
  assert.equal(sent.length, 2, "宿主窗口大小变了再发一次");
  assert.ok(sent.every(([, origin]) => origin === BASE), "targetOrigin 一律是主站 origin");

  fromFrame({ type: "resize", height: 1234 });
  assert.equal(frame.getAttribute("height"), "1234");
  fromFrame({ type: "resize", height: 999_999 });
  assert.equal(frame.getAttribute("height"), "20000", "截到 20000");
});

test("3D 验证弹窗：modal open 时 iframe 滚到顶、高度设成可视高度（至少 480）；关掉后恢复按 resize 的高度", () => {
  mountWithDraft();
  const frame = iframe();
  let scrolled = 0;
  frame.scrollIntoView = () => {
    scrolled += 1;
  };
  fromFrame({ type: "ready", lang: "ja" });
  fromFrame({ type: "resize", height: 1800 });
  fromFrame({ type: "modal", open: true });
  assert.equal(scrolled, 1);
  assert.equal(frame.getAttribute("height"), `${Math.max(Math.round(window.innerHeight), 480)}`);
  fromFrame({ type: "resize", height: 1900 });
  assert.equal(frame.getAttribute("height"), `${Math.max(Math.round(window.innerHeight), 480)}`, "弹窗开着时不跟着 resize 变");
  fromFrame({ type: "modal", open: false });
  assert.equal(frame.getAttribute("height"), "1900");
});

test("事件：step、completed、error 交给 onEvent 并在容器上派发 nozomi:booking；ready、resize、modal 不转；字段只有白名单里的", () => {
  const { events, domEvents } = mountWithDraft();
  fromFrame({ type: "ready", lang: "ja" });
  fromFrame({ type: "resize", height: 900 });
  fromFrame({ type: "step", step: "vehicle", name: "陈小红" });
  fromFrame({ type: "completed", orderNo: "NZ2026111400AB12CD", status: "submitted", token: "nzo_secret", email: "a@example.com" });
  const expected = [
    { type: "step", step: "vehicle" },
    { type: "completed", orderNo: "NZ2026111400AB12CD", status: "submitted" },
  ];
  assert.deepEqual(events, expected);
  assert.deepEqual(domEvents, expected);
});

test("换步时 iframe 顶部在视口上方就滚回来", () => {
  mountWithDraft();
  const frame = iframe();
  let scrolled = 0;
  frame.scrollIntoView = () => {
    scrolled += 1;
  };
  frame.getBoundingClientRect = () => ({ top: -300, bottom: 400, left: 0, right: 0, width: 0, height: 700, x: 0, y: -300, toJSON: () => ({}) });
  fromFrame({ type: "step", step: "passenger" });
  assert.equal(scrolled, 1);
  frame.getBoundingClientRect = () => ({ top: 40, bottom: 400, left: 0, right: 0, width: 0, height: 360, x: 0, y: 40, toJSON: () => ({}) });
  fromFrame({ type: "step", step: "review" });
  assert.equal(scrolled, 1, "看得见就不动");
});

test("completed：删掉存储里的草稿号（同一标签页下次打开预订页不会拿到旧草稿）", () => {
  mountWithDraft();
  assert.ok(sessionStorage.getItem(HOST_DRAFT_KEY));
  fromFrame({ type: "completed", orderNo: "NZ2026111400AB12CD", status: "submitted" });
  assert.equal(sessionStorage.getItem(HOST_DRAFT_KEY), null);
});

test("草稿过期（error DRAFT_NOT_FOUND）：删存储，iframe 上方显示「重新查询」，点了拆掉 iframe、画查价表单；提交后跳回本页带新的 nzdraft", async () => {
  const { events } = mountWithDraft({ lang: "zh" });
  fromFrame({ type: "ready", lang: "zh" });
  fromFrame({ type: "error", code: "LOAD_FAILED" });
  assert.ok(sessionStorage.getItem(HOST_DRAFT_KEY), "别的错误不删");
  fromFrame({ type: "error", code: "DRAFT_NOT_FOUND" });
  assert.equal(sessionStorage.getItem(HOST_DRAFT_KEY), null);
  assert.deepEqual(events, [{ type: "error", code: "LOAD_FAILED" }, { type: "error", code: "DRAFT_NOT_FOUND" }]);
  const notice = frameHost()?.shadowRoot?.querySelector('[role="status"]') as HTMLElement;
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent ?? "", /这次查询已过期/);
  (notice.querySelector("button") as HTMLButtonElement).click();
  assert.equal(frameHost(), null, "iframe 拆掉了");
  const form = root().querySelector('[data-nozomi-booking="form"]') as HTMLElement;
  assert.ok(form);
  await wait(20);
  assert.ok(form.shadowRoot?.querySelector("form"), "查价表单画出来了");
  assert.equal(fetched[0]?.url.pathname, "/embed/v1/config");
});

test("15 秒没收到 ready：拿掉 iframe，显示一句话和「到主站继续预订」（新标签页，主站 /book/new?draft=），控制台提示开发者", async () => {
  READY_TIMEOUT.ms = 30;
  mountWithDraft({ lang: "ja" });
  await wait(60);
  assert.equal(frameHost(), null);
  const fallback = root().querySelector('[data-nozomi-booking="fallback"]')?.shadowRoot as ShadowRoot;
  assert.match(fallback.textContent ?? "", new RegExp(BOOKING_TEXTS.ja.failed));
  const link = fallback.querySelector("a") as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), `${BASE}/book/new?draft=${DRAFT}`);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.ok(consoleErrors.some((line) => line.startsWith("NozomiBooking：") && line.includes("白名单") && line.includes("允许整页嵌入")));
});

test("ready 按时到了就不显示后备；拆掉以后（重复调用）旧的计时器和监听不再动作", async () => {
  READY_TIMEOUT.ms = 30;
  const { events } = mountWithDraft();
  fromFrame({ type: "ready", lang: "ja" });
  await wait(60);
  assert.ok(frameHost(), "收到 ready 后不超时");
  const old = iframe();
  history.replaceState(null, "", `/booking/?nzdraft=${"F".repeat(43)}`);
  mountBookingFrom(BASE, { key: KEY, root: "#flow" });
  window.dispatchEvent(new MessageEvent("message", { data: { ns: "nozomi-booking", v: 1, ch: channelOf(old), type: "step", step: "trip" }, origin: BASE, source: old.contentWindow }));
  assert.deepEqual(events, [], "旧 iframe 的监听已解除");
  assert.equal(new URL(iframe().src).searchParams.get("draft"), "F".repeat(43));
});

test("不带 nzdraft：画查价表单（= init，bookingUrl 是本页）；提交后建草稿带 delivery: host_page，整页跳回本页带 nzdraft（保留其余参数）", async () => {
  history.replaceState(null, "", "/booking/?utm=a");
  let drafted: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    fetched.push({ url, init });
    if (url.pathname === "/embed/v1/config") return new Response(JSON.stringify({ lang: "ja", services: ["transfer"], site_origin: BASE }), { status: 200 });
    if (url.pathname === "/embed/v1/places/autocomplete") return new Response(JSON.stringify({ available: true, items: [{ source: "platform", id: "p1", name: "成田国際空港", address: null, location: { lat: 35.772, lng: 140.3929 }, kind: "airport" }] }), { status: 200 });
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "E".repeat(43), expires_at: "2030-01-01T00:00:00Z", url: "x" }), { status: 201 });
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const went: string[] = [];
  mountBookingFrom(BASE, { key: KEY, root: "#flow", redirectUrl: `${location.origin}/thanks`, onEvent: () => undefined }, (url) => went.push(url));
  await wait(20);
  const form = root().querySelector('[data-nozomi-booking="form"]')?.shadowRoot as ShadowRoot;
  for (const field of ["pickup", "dropoff"]) {
    const input = form.querySelector(`[data-field="${field}"] input`) as HTMLInputElement;
    input.value = "成田";
    input.dispatchEvent(new Event("input"));
    await wait(400);
    (form.querySelector(`[data-field="${field}"] [role="option"]`) as HTMLElement).click();
    await wait(20);
  }
  (form.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(30);
  assert.deepEqual(went, [`${location.origin}/booking/?utm=a&nzdraft=${"E".repeat(43)}`]);
  const body = drafted as unknown as Record<string, unknown>;
  assert.equal(body["delivery"], "host_page");
  assert.equal(body["return_url"], `${location.origin}/thanks`);
  assert.deepEqual(Object.keys(body).sort(), ["delivery", "draft", "return_url"], "onEvent、title 不转给表单");
});

/** 组件（init）填好两个地点后点「查看价格」：返回建草稿的请求体和跳去的地址 */
async function submitInit(options: Record<string, unknown>): Promise<{ body: Record<string, unknown>; went: string[] }> {
  let drafted: Record<string, unknown> = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/embed/v1/config") return new Response(JSON.stringify({ lang: "ja", services: ["transfer"], site_origin: BASE }), { status: 200 });
    if (url.pathname === "/embed/v1/places/autocomplete") return new Response(JSON.stringify({ available: true, items: [{ source: "platform", id: "p1", name: "成田国際空港", address: null, location: { lat: 35.772, lng: 140.3929 }, kind: "airport" }] }), { status: 200 });
    if (url.pathname === "/embed/v1/booking-drafts") {
      drafted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "E".repeat(43), expires_at: "2030-01-01T00:00:00Z", url: "x" }), { status: 201 });
    }
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const went: string[] = [];
  initFrom(BASE, { key: KEY, root: "#flow", ...options }, (url) => went.push(url));
  await wait(20);
  const shadow = root().shadowRoot as ShadowRoot;
  for (const field of ["pickup", "dropoff"]) {
    const input = shadow.querySelector(`[data-field="${field}"] input`) as HTMLInputElement;
    input.value = "成田";
    input.dispatchEvent(new Event("input"));
    await wait(400);
    (shadow.querySelector(`[data-field="${field}"] [role="option"]`) as HTMLElement).click();
    await wait(20);
  }
  (shadow.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
  await wait(30);
  return { body: drafted, went };
}

test("init 不传 bookingUrl：行为逐字不变——跳主站 /book/new?draft=，建草稿不带 delivery，控制台不说话", async () => {
  const { body, went } = await submitInit({});
  assert.deepEqual(went, [`${BASE}/book/new?draft=${"E".repeat(43)}`]);
  assert.deepEqual(Object.keys(body), ["draft"]);
  assert.deepEqual(consoleErrors, []);
});

test("init 传合格的 bookingUrl（同一个 origin）：草稿建好后跳 bookingUrl?nzdraft=（保留原有参数和 #），建草稿带 delivery: host_page", async () => {
  const { body, went } = await submitInit({ bookingUrl: `${location.origin}/booking/?from=top#flow` });
  assert.deepEqual(went, [`${location.origin}/booking/?from=top&nzdraft=${"E".repeat(43)}#flow`]);
  assert.equal(body["delivery"], "host_page");
  assert.deepEqual(consoleErrors, []);
});

for (const bad of ["https://other.example/booking/", "/booking/", "http://partner.example/booking/", "https://user:pw@localhost/booking/"]) {
  test(`init 传不合格的 bookingUrl（${bad}）：按没传处理（跳主站、不带 delivery），控制台报一句`, async () => {
    const { body, went } = await submitInit({ bookingUrl: bad });
    assert.deepEqual(went, [`${BASE}/book/new?draft=${"E".repeat(43)}`]);
    assert.equal("delivery" in body, false);
    assert.equal(consoleErrors.length, 1);
    assert.match(consoleErrors[0] ?? "", /^NozomiBooking：bookingUrl 不合格/);
  });
}

test("参数不对：没有主站地址、没有 key、找不到容器都只在控制台说一句，不渲染", () => {
  mountBookingFrom(null, { key: KEY, root: "#flow" });
  mountBookingFrom(BASE, { root: "#flow" } as never);
  mountBookingFrom(BASE, { key: KEY, root: "#nowhere" });
  assert.equal(root().children.length, 0);
  assert.equal(consoleErrors.length, 3);
  assert.ok(consoleErrors.every((line) => line.startsWith("NozomiBooking：")));
});
