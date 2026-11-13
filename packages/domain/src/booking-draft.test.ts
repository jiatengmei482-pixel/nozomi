import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_DRAFT_LIMITS, type BookingDraft, bookingDraftPath, cleanPlaceName, encodeBookingDraft, parseBookingDraft, truncateLinkName } from "./booking-draft.ts";
import { ROUTE_CHARTER_LIMITS, stayMinutesIssue } from "./route-charter.ts";

const base64url = (text: string): string => Buffer.from(text, "utf8").toString("base64url");
const encodeJson = (value: unknown): string => base64url(JSON.stringify(value));

function transferDraft(): BookingDraft {
  return {
    v: 1,
    tab: "transfer",
    charter_mode: null,
    package_hours: null,
    service_local: "2026-12-01T09:00",
    stops: [
      { name: "成田国際空港", lat: 35.772, lng: 140.3929, stay_minutes: null },
      { name: "東京駅", lat: 35.6812, lng: 139.7671, stay_minutes: null },
    ],
    passengers: 2,
    luggage: 1,
    route_template: null,
    ref: null,
    lang: "ja",
  };
}

/** 最坏情况的来源凭证：载荷 {k: 36 位编号, o: https:// + 253 字符主机名 + :65535, r: 1,000 字符的返回地址, e: 10 位}，base64url + 「.」+ 43 字符签名（ADR 0087 第三节第 1 小节）。 */
function worstRef(): string {
  const host = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  assert.equal(host.length, 253);
  const origin = `https://${host}:65535`;
  const returnUrl = `${origin}/${"r".repeat(1_000 - origin.length - 1)}`;
  assert.equal(returnUrl.length, 1_000);
  const payload = base64url(JSON.stringify({ k: "0b6f3c1e-8d2a-4f7b-9c3e-5a1d2e3f4a5b", o: origin, r: returnUrl, e: 1_798_000_000 }));
  return `${payload}.${"s".repeat(43)}`;
}

test("往返：10 个地点、名称各 30 个 4 字节字符、停留 480、模型线路编码 40 字符、来源凭证带 1,000 字符的返回地址 → d ≤ 7,000、网址 ≤ 7,200，解码逐项相同", () => {
  const name = "😀".repeat(30);
  assert.equal(Buffer.byteLength(name, "utf8"), 120);
  const stops = Array.from({ length: ROUTE_CHARTER_LIMITS.maxStops }, (_, index) => ({
    name,
    lat: -89.123456,
    lng: -179.123456,
    stay_minutes: index === 0 || index === ROUTE_CHARTER_LIMITS.maxStops - 1 ? null : ROUTE_CHARTER_LIMITS.maxStayMinutes,
  }));
  const draft: BookingDraft = { v: 1, tab: "charter", charter_mode: "route", package_hours: null, service_local: "2026-12-31T23:30", stops, passengers: 60, luggage: 60, route_template: `t${"x".repeat(39)}`, ref: worstRef(), lang: "en" };
  const d = encodeBookingDraft(draft);
  const url = bookingDraftPath(draft);
  assert.ok(d.length <= BOOKING_DRAFT_LIMITS.maxParamChars, `d 有 ${d.length} 字符`);
  assert.equal(url, `/book?d=${d}`, "第一次编码就在上限内，不再截短名称");
  assert.ok((url as string).length <= BOOKING_DRAFT_LIMITS.maxUrlChars, `网址有 ${(url as string).length} 字符`);
  // ADR 0087 的估算：约 5,256 字符；留了约 1,700 字符余量
  assert.ok(d.length < 5_600, `d 有 ${d.length} 字符，比估算的多出太多`);
  const parsed = parseBookingDraft(d);
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.issues, []);
  const { v: _v, ...expected } = draft;
  assert.deepEqual(parsed.draft, expected);
});

test("区间往返：2 个地点、停留都为空", () => {
  const parsed = parseBookingDraft(encodeBookingDraft(transferDraft()));
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.draft.stops, transferDraft().stops);
  assert.equal(parsed.draft.tab, "transfer");
  assert.equal(parsed.draft.passengers, 2);
  assert.equal(parsed.draft.luggage, 1);
});

test("按时长包车往返：带套餐时长", () => {
  const draft: BookingDraft = { ...transferDraft(), tab: "charter", charter_mode: "package", package_hours: 8 };
  const parsed = parseBookingDraft(encodeBookingDraft(draft));
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.draft.charter_mode, "package");
  assert.equal(parsed.draft.package_hours, 8);
});

test("链接里的地点名称超过 30 字截断加「…」（总长 30 字），坐标留 6 位小数，控制字符清掉", () => {
  assert.equal(truncateLinkName("一".repeat(30)), "一".repeat(30));
  assert.equal(truncateLinkName("一".repeat(31)), `${"一".repeat(29)}…`);
  assert.equal([...truncateLinkName("😀".repeat(40))].length, 30);
  assert.equal(cleanPlaceName("  東京\u0000駅​ \n "), "東京 駅");
  assert.equal(cleanPlaceName("\u0007 \t"), null);
  const draft = transferDraft();
  draft.stops[0] = { name: `${"長".repeat(50)}\u0001`, lat: 35.123456789, lng: 139.987654321, stay_minutes: null };
  const parsed = parseBookingDraft(encodeBookingDraft(draft));
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.draft.stops?.[0], { name: `${"長".repeat(29)}…`, lat: 35.123457, lng: 139.987654, stay_minutes: null });
});

test("名称太长、编码后超过上限时先截到 20 字再编；仍超过返回 null", () => {
  const draft: BookingDraft = { ...transferDraft(), tab: "charter", charter_mode: "route", stops: Array.from({ length: 10 }, (_, index) => ({ name: "😀".repeat(30), lat: 1, lng: 1, stay_minutes: index === 0 || index === 9 ? null : 30 })) };
  assert.ok(bookingDraftPath(draft) !== null);
  const huge = { ...draft, ref: "a".repeat(6_000) };
  assert.equal(bookingDraftPath(huge), null);
  // 让 30 字的名称正好放不下、20 字的放得下：按 base64 每 3 字节 4 字符估算凭证长度
  const room = BOOKING_DRAFT_LIMITS.maxParamChars - encodeBookingDraft({ ...draft, ref: "" }).length;
  const near = { ...draft, ref: "a".repeat(Math.floor((room * 3) / 4) + 30) };
  assert.ok(encodeBookingDraft(near).length > BOOKING_DRAFT_LIMITS.maxParamChars);
  const url = bookingDraftPath(near);
  assert.ok(url !== null && url.length <= BOOKING_DRAFT_LIMITS.maxUrlChars);
  assert.notEqual(url, `/book?d=${encodeBookingDraft(near)}`, "30 字放不下，用了 20 字");
  assert.equal(url, `/book?d=${encodeBookingDraft(near, { nameMax: 20 })}`);
});

test("整份忽略：不是 base64url、不是 JSON、不是对象、超过 7,000 字符、v 不是 1、空", () => {
  const good = encodeBookingDraft(transferDraft());
  assert.ok(parseBookingDraft(good) !== null);
  for (const bad of [undefined, null, "", "abc+/=", "a", "%%%", base64url("not json"), base64url("[1,2]"), base64url("null"), base64url("\"text\"")]) assert.equal(parseBookingDraft(bad), null, String(bad));
  assert.equal(parseBookingDraft(Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")), null, "不是 UTF-8");
  assert.equal(parseBookingDraft(encodeJson({ ...transferDraft(), v: 2 })), null, "v = 2");
  assert.equal(parseBookingDraft(encodeJson({ ...transferDraft(), v: "1" })), null, "v 是字符串");
  const { v: _v, ...noVersion } = transferDraft();
  assert.equal(parseBookingDraft(encodeJson(noVersion)), null, "没有 v");
  const long = encodeJson({ ...transferDraft(), pad: "x".repeat(6_000) });
  assert.ok(long.length > BOOKING_DRAFT_LIMITS.maxParamChars);
  assert.equal(parseBookingDraft(long), null, "超过 7,000 字符");
  const exactly = encodeJson({ ...transferDraft(), pad: "" });
  const padded = encodeJson({ ...transferDraft(), pad: "x".repeat(Math.floor(((BOOKING_DRAFT_LIMITS.maxParamChars - exactly.length) * 3) / 4)) });
  assert.ok(padded.length <= BOOKING_DRAFT_LIMITS.maxParamChars);
  assert.ok(parseBookingDraft(padded) !== null, "7,000 以内（未知的键忽略）");
});

test("逐项校验：途经点停留 45 分钟只这一项为 null 并给出原因，其余照常", () => {
  const draft = { ...transferDraft(), tab: "charter", charter_mode: "route", stops: [transferDraft().stops[0], { name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 45 }, transferDraft().stops[1]] };
  const parsed = parseBookingDraft(encodeJson(draft));
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.issues, [{ path: "/stops/1/stay_minutes", reason: "NOT_A_STEP" }]);
  assert.deepEqual(parsed.draft.stops?.[1], { name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: null });
  assert.equal(parsed.draft.service_local, "2026-12-01T09:00");
  assert.equal(parsed.draft.passengers, 2);
});

test("停留时长：必填、30 分钟一档、30–480", () => {
  assert.equal(stayMinutesIssue(null), "REQUIRED");
  assert.equal(stayMinutesIssue(undefined), "REQUIRED");
  assert.equal(stayMinutesIssue(0), "OUT_OF_RANGE");
  assert.equal(stayMinutesIssue(510), "OUT_OF_RANGE");
  assert.equal(stayMinutesIssue(45), "NOT_A_STEP");
  assert.equal(stayMinutesIssue(30.5), "NOT_A_STEP");
  assert.equal(stayMinutesIssue("60"), "NOT_A_STEP");
  for (const ok of [30, 60, 90, 480]) assert.equal(stayMinutesIssue(ok), null);
});

test("逐项校验：各项不合格时为 null、列出原因，页面不报错", () => {
  const parsed = parseBookingDraft(
    encodeJson({
      v: 1,
      tab: "transfer",
      charter_mode: "route",
      package_hours: 8,
      service_local: "2026-02-30T09:00",
      stops: [
        { name: "  ", lat: 35, lng: 139, stay_minutes: null },
        { name: "B", lat: 91, lng: 139, stay_minutes: 30 },
      ],
      passengers: 0,
      luggage: 61,
      route_template: "Bad_Code",
      ref: "<script>",
      lang: "ko",
    }),
  );
  assert.ok(parsed !== null);
  assert.deepEqual(parsed.draft, { tab: "transfer", charter_mode: null, package_hours: null, service_local: null, stops: [null, null], passengers: null, luggage: null, route_template: null, ref: null, lang: null });
  assert.deepEqual(
    parsed.issues.map((issue) => `${issue.path}:${issue.reason}`),
    ["/charter_mode:NOT_APPLICABLE", "/package_hours:NOT_APPLICABLE", "/service_local:INVALID_FORMAT", "/stops/0/name:REQUIRED", "/stops/1/lat:OUT_OF_RANGE", "/passengers:OUT_OF_RANGE", "/luggage:OUT_OF_RANGE", "/route_template:INVALID_FORMAT", "/ref:INVALID_FORMAT", "/lang:INVALID_FORMAT"],
  );
});

test("地点个数：区间、按时长正好 2 个；按行程 2–10 个；首尾不带停留、途经点必填停留", () => {
  const stop = (stay: number | null = null) => ({ name: "P", lat: 35, lng: 139, stay_minutes: stay });
  const transferThree = parseBookingDraft(encodeJson({ ...transferDraft(), stops: [stop(), stop(60), stop()] }));
  assert.equal(transferThree?.draft.stops, null);
  assert.deepEqual(transferThree?.issues, [{ path: "/stops", reason: "OUT_OF_RANGE" }]);
  const route = { ...transferDraft(), tab: "charter", charter_mode: "route" };
  assert.equal(parseBookingDraft(encodeJson({ ...route, stops: Array.from({ length: 11 }, () => stop(60)) }))?.draft.stops, null);
  const routeParsed = parseBookingDraft(encodeJson({ ...route, stops: [stop(30), stop(null), stop(60), stop()] }));
  assert.ok(routeParsed !== null);
  assert.deepEqual(routeParsed.issues, [{ path: "/stops/0/stay_minutes", reason: "NOT_APPLICABLE" }, { path: "/stops/1/stay_minutes", reason: "REQUIRED" }]);
  assert.deepEqual(routeParsed.draft.stops?.map((entry) => entry?.stay_minutes), [null, null, 60, null]);
  assert.equal(parseBookingDraft(encodeJson({ ...route, stops: "x" }))?.draft.stops, null);
  assert.equal(parseBookingDraft(encodeJson({ ...route, stops: [stop(), 5] }))?.draft.stops?.[1], null);
});

test("注入字符：名称里的引号、尖括号原样当文字（不是 HTML），控制字符清掉；坐标不是数字的地点为 null", () => {
  const parsed = parseBookingDraft(encodeJson({ ...transferDraft(), stops: [{ name: "\"><img src=x onerror=alert(1)>", lat: 35, lng: 139 }, { name: "B‮", lat: "35", lng: 139 }] }));
  assert.ok(parsed !== null);
  assert.equal(parsed.draft.stops?.[0]?.name, "\"><img src=x onerror=alert(1)>");
  assert.equal(parsed.draft.stops?.[1], null);
});

test("预订条件里没有价格、报价编号：编码只带固定的这些键", () => {
  const withExtra = { ...transferDraft(), price: 1000, quote_id: "q" } as unknown as BookingDraft;
  const json = JSON.parse(Buffer.from(encodeBookingDraft(withExtra), "base64url").toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json).sort(), ["charter_mode", "lang", "luggage", "package_hours", "passengers", "ref", "route_template", "service_local", "stops", "tab", "v"]);
});
