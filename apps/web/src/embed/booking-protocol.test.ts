/** 嵌入预订流程的公用规则（M9E-16，ADR 0095 第三、六节）：postMessage 白名单取值、bookingUrl 合格条件、草稿号存储、iframe 地址。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_ERROR_CODES,
  BOOKING_STEPS,
  HOST_DRAFT_TTL_MS,
  bookingUrlOf,
  clampHeight,
  embedFrameUrl,
  envelope,
  frameParamsOf,
  hostDraftRecord,
  hostEventOf,
  hostOriginOf,
  parseFrameMessage,
  parseHostMessage,
  readHostDraftRecord,
  withDraft,
  withoutDraft,
} from "./booking-protocol.ts";

const CH = "0123456789abcdef0123456789abcdef";
const DRAFT = "D".repeat(43);
const KEY = `nze_${"A".repeat(32)}`;
const msg = (fields: Record<string, unknown>) => ({ ns: "nozomi-booking", v: 1, ch: CH, ...fields });

test("iframe → 宿主：每种消息的键集合固定，多出来的键（姓名、电话、令牌、价格）一律丢掉", () => {
  const extra = { name: "陈小红", phone: "+81 90-1111-2222", email: "a@example.com", token: "nzo_x", price: 12000, draft: { pickup: "x" } };
  const cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ type: "ready", lang: "ja" }, { type: "ready", lang: "ja" }],
    [{ type: "resize", height: 812.4 }, { type: "resize", height: 812 }],
    [{ type: "step", step: "vehicle" }, { type: "step", step: "vehicle" }],
    [{ type: "modal", open: true }, { type: "modal", open: true }],
    [{ type: "completed", orderNo: "NZ2026111400AB12CD", status: "submitted" }, { type: "completed", orderNo: "NZ2026111400AB12CD", status: "submitted" }],
    [{ type: "error", code: "DRAFT_NOT_FOUND" }, { type: "error", code: "DRAFT_NOT_FOUND" }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseFrameMessage(msg({ ...input, ...extra }), CH), expected, String(input["type"]));
  for (const step of BOOKING_STEPS) assert.deepEqual(parseFrameMessage(msg({ type: "step", step }), CH), { type: "step", step });
  for (const code of BOOKING_ERROR_CODES) assert.deepEqual(parseFrameMessage(msg({ type: "error", code }), CH), { type: "error", code });
});

test("iframe → 宿主：频道号、命名空间、版本不对，type 不认识，字段取值不对，都丢弃", () => {
  for (const data of [
    null,
    "ready",
    [],
    { ...msg({ type: "ready" }), ch: "other-channel-0000000000" },
    { ...msg({ type: "ready" }), ns: "other" },
    { ...msg({ type: "ready" }), v: 2 },
    msg({ type: "navigate", url: "https://evil.example" }),
    msg({ type: "resize", height: "800" }),
    msg({ type: "resize", height: Number.NaN }),
    msg({ type: "step", step: "admin" }),
    msg({ type: "modal", open: "yes" }),
    msg({ type: "completed", orderNo: "<script>", status: "submitted" }),
    msg({ type: "completed", orderNo: "NZ2026111400AB12CD", status: "paid" }),
    msg({ type: "error", code: "SOMETHING" }),
  ]) {
    assert.equal(parseFrameMessage(data, CH), null, JSON.stringify(data));
  }
  assert.deepEqual(parseFrameMessage(msg({ type: "ready", lang: "<b>" }), CH), { type: "ready", lang: "" }, "语言写法不对只是不带");
});

test("高度截到 1–20000 的整数；宿主 → iframe 只认 viewport", () => {
  assert.equal(clampHeight(0), 1);
  assert.equal(clampHeight(-5), 1);
  assert.equal(clampHeight(99_999), 20_000);
  assert.equal(clampHeight(Infinity), null);
  assert.deepEqual(parseHostMessage(msg({ type: "viewport", height: 900, name: "x" }), CH), { type: "viewport", height: 900 });
  assert.equal(parseHostMessage(msg({ type: "step", step: "trip" }), CH), null, "宿主不能冒充 iframe 的消息");
  assert.equal(parseHostMessage({ ...msg({ type: "viewport", height: 900 }), ch: "x" }, CH), null);
  assert.deepEqual(envelope(CH, { type: "viewport", height: 900 }), { ns: "nozomi-booking", v: 1, ch: CH, type: "viewport", height: 900 });
});

test("交给合作网站的事件只有 step、completed、error", () => {
  assert.equal(hostEventOf({ type: "ready", lang: "ja" }), null);
  assert.equal(hostEventOf({ type: "resize", height: 10 }), null);
  assert.equal(hostEventOf({ type: "modal", open: true }), null);
  assert.deepEqual(hostEventOf({ type: "step", step: "trip" }), { type: "step", step: "trip" });
});

test("bookingUrl：https 且和当前页同一个 origin 才合格；本机另收 http://localhost、127.0.0.1；带用户名密码、别的域名、www 差一点、端口不同都不合格", () => {
  const page = "https://partner.example";
  assert.equal(bookingUrlOf("https://partner.example/booking/?a=1#top", page)?.href, "https://partner.example/booking/?a=1#top");
  assert.equal(bookingUrlOf("http://localhost:4174/booking/", "http://localhost:4174")?.href, "http://localhost:4174/booking/");
  assert.equal(bookingUrlOf("http://127.0.0.1:4174/booking/", "http://127.0.0.1:4174")?.pathname, "/booking/");
  for (const given of [
    "https://www.partner.example/booking/",
    "https://partner.example:8443/booking/",
    "http://partner.example/booking/",
    "https://user:pass@partner.example/booking/",
    "/booking/",
    "javascript:alert(1)",
    "",
    "  ",
    42,
    null,
    `https://partner.example/${"a".repeat(2_000)}`,
  ]) {
    assert.equal(bookingUrlOf(given, page), null, String(given).slice(0, 60));
  }
  assert.equal(bookingUrlOf("http://partner.example/booking/", "http://partner.example"), null, "非本机的 http 不收");
});

test("跳回宿主：保留原有查询参数和 #，已有的 nzdraft 覆盖；去掉 nzdraft 时其余原样", () => {
  const url = new URL("https://partner.example/booking/?utm=x&nzdraft=old#top");
  assert.equal(withDraft(url, DRAFT), `https://partner.example/booking/?utm=x&nzdraft=${DRAFT}#top`);
  assert.equal(withoutDraft(`https://partner.example/booking/?utm=x&nzdraft=${DRAFT}#top`), "https://partner.example/booking/?utm=x#top");
  assert.equal(withoutDraft(`https://partner.example/booking/?nzdraft=${DRAFT}`), "https://partner.example/booking/");
});

test("宿主页存的草稿号：只有草稿号和时间；2 小时内有效，过期、写坏、时间在未来、草稿号格式不对都算过期（调用方删掉）", () => {
  const now = Date.UTC(2026, 10, 14, 3);
  const record = hostDraftRecord(DRAFT, now);
  assert.deepEqual(Object.keys(JSON.parse(record)).sort(), ["at", "id"]);
  assert.equal(readHostDraftRecord(record, now + HOST_DRAFT_TTL_MS - 1), DRAFT);
  assert.equal(readHostDraftRecord(record, now + HOST_DRAFT_TTL_MS), "stale");
  assert.equal(readHostDraftRecord(null, now), null);
  for (const raw of ["{", "null", JSON.stringify({ id: "short", at: now }), JSON.stringify({ id: DRAFT }), JSON.stringify({ id: DRAFT, at: now + 3_600_000 })]) assert.equal(readHostDraftRecord(raw, now), "stale", raw);
});

test("iframe 地址：draft、key、lang、host 在查询串，频道号在 # 后；嵌入页读回来的各项按格式核对，宿主 origin 只认规范写法", () => {
  const src = embedFrameUrl("https://nozomi.example", { draft: DRAFT, key: KEY, host: "https://partner.example", lang: "ja", ch: CH });
  const url = new URL(src);
  assert.equal(url.origin + url.pathname, "https://nozomi.example/embed/book");
  assert.deepEqual([...url.searchParams.keys()], ["draft", "key", "lang", "host"]);
  assert.equal(url.hash, `#ch=${CH}`);
  assert.deepEqual(frameParamsOf(url.search, url.hash), { draft: DRAFT, key: KEY, host: "https://partner.example", lang: "ja", ch: CH });
  assert.equal(new URL(embedFrameUrl("https://nozomi.example", { draft: DRAFT, key: KEY, host: "https://partner.example", lang: null, ch: CH })).searchParams.has("lang"), false, "没传语言不带，嵌入页按草稿的语言");
  assert.deepEqual(frameParamsOf("?draft=x&key=y&host=https%3A%2F%2Fpartner.example%2F&lang=fr", "#ch=a%3Cb"), { draft: null, key: null, host: null, lang: null, ch: null });
  for (const host of ["https://partner.example/", "https://Partner.example", "http://partner.example", "https://partner.example:443", "null", "", "javascript:alert(1)"]) assert.equal(hostOriginOf(host), null, host);
  assert.equal(hostOriginOf("http://localhost:4174"), "http://localhost:4174");
});
