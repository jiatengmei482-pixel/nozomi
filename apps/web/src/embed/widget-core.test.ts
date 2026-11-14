import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingDraftIssues } from "@nozomi/domain";
import { BAR_MIN_WIDTH, DEFAULT_THEME, GUEST_LIMITS, INK_DARK, STAY_OPTIONS, TEXTS, type WidgetForm, contrastRatio, guestsSummary, hexOf, layoutFor, resolveLayout, resolveTheme, draftFailureOf,draftOf, formProblems, problemOfIssuePath, resolveLang, resolveServices, tomorrow, trimName } from "./widget-core.ts";

const form = (changes: Partial<WidgetForm> = {}): WidgetForm => ({
  tab: "transfer",
  pickup: { name: "成田国際空港", lat: 35.772, lng: 140.3929 },
  dropoff: { name: "東京駅", lat: 35.6812, lng: 139.7671 },
  waypoints: [],
  date: "2026-12-01",
  time: "10:00",
  passengers: 2,
  luggage: 2,
  ...changes,
});

test("init 的 lang、services：不认识的忽略，忽略后为空用后台默认值；重复的只算一次", () => {
  assert.equal(resolveLang("en", "ja"), "en");
  assert.equal(resolveLang("ko", "ja"), "ja");
  assert.equal(resolveLang(undefined, "zh"), "zh");
  assert.deepEqual(resolveServices(["charter", "transfer"], ["transfer"]), ["charter", "transfer"], "顺序即标签顺序");
  assert.deepEqual(resolveServices(["bus", "charter", "charter"], ["transfer"]), ["charter"]);
  assert.deepEqual(resolveServices(["bus"], ["transfer", "charter"]), ["transfer", "charter"]);
  assert.deepEqual(resolveServices("charter", ["transfer"]), ["transfer"]);
});

test("区间、包车带经停点生成的草稿都通过主站的同一套校验（不含价格和个人信息）", () => {
  const transfer = draftOf(form(), "ja");
  assert.deepEqual(bookingDraftIssues(transfer), []);
  assert.deepEqual(Object.keys(transfer).sort(), ["dropoff", "lang", "luggage", "package_hours", "passengers", "pickup", "service_local", "tab", "v", "waypoints"]);
  const charter = draftOf(form({ tab: "charter", pickup: { name: "銀座", lat: 35.6717, lng: 139.765 }, dropoff: { name: "新宿駅", lat: 35.6896, lng: 139.7006 }, waypoints: [{ point: { name: "浅草寺", lat: 35.7148, lng: 139.7967 }, stay: 60 }] }), "zh");
  assert.deepEqual(bookingDraftIssues(charter), []);
  assert.deepEqual(charter["waypoints"], [{ name: "浅草寺", lat: 35.7148, lng: 139.7967, stay_minutes: 60 }]);
  assert.equal(charter["package_hours"], null);
  assert.deepEqual(draftOf(form({ waypoints: [{ point: { name: "x", lat: 35, lng: 139 }, stay: 60 }] }), "en")["waypoints"], [], "区间不带经停点");
  const long = draftOf(form({ pickup: { name: ` ${"地".repeat(250)} `, lat: 35, lng: 139 } }), "ja");
  assert.equal([...(long["pickup"] as { name: string }).name].length, 200, "名称超过 200 字截断");
  assert.deepEqual(bookingDraftIssues(long), []);
  const emoji = draftOf(form({ pickup: { name: "🚕".repeat(150), lat: 35.681234567891, lng: 139.767123456789 } }), "ja");
  assert.equal((emoji["pickup"] as { name: string }).name, "🚕".repeat(100), "按 UTF-16 单元截到 200，不切开 emoji");
  assert.deepEqual([(emoji["pickup"] as { lat: number }).lat, (emoji["pickup"] as { lng: number }).lng], [35.6812346, 139.7671235], "坐标保留 7 位小数");
  assert.deepEqual(bookingDraftIssues(emoji), []);
});

test("查询前的检查：地点、经停点和停留、日期、时间", () => {
  assert.deepEqual(formProblems(form()), []);
  assert.deepEqual(formProblems(form({ pickup: null, dropoff: null, date: "", time: "" })), ["pickup", "dropoff", "date", "time"]);
  assert.deepEqual(formProblems(form({ tab: "charter", waypoints: [{ point: null, stay: null }, { point: { name: "x", lat: 35, lng: 139 }, stay: 45 }] })), ["waypoint-0", "stay-0", "stay-1"]);
  assert.deepEqual(STAY_OPTIONS.slice(0, 2), [30, 60]);
  assert.equal(STAY_OPTIONS.at(-1), 480);
});

test("建草稿失败的说法：400、429 两种、读不出的失败", () => {
  assert.equal(draftFailureOf(400, "VALIDATION_FAILED"), "invalid");
  assert.equal(draftFailureOf(429, "RATE_LIMITED"), "too_fast");
  assert.equal(draftFailureOf(429, "EMBED_DRAFT_LIMIT"), "busy");
  assert.equal(draftFailureOf(413, "PAYLOAD_TOO_LARGE"), "unreachable");
  assert.equal(draftFailureOf(null, null), "unreachable", "网络错误、被拒的 403 读不出来");
});

test("三种语言的文案键一样；默认日期是明天", () => {
  assert.deepEqual(Object.keys(TEXTS.ja).sort(), Object.keys(TEXTS.zh).sort());
  assert.deepEqual(Object.keys(TEXTS.en).sort(), Object.keys(TEXTS.zh).sort());
  assert.equal(tomorrow(new Date(2026, 11, 31, 23, 0)), "2027-01-01");
});

test("名称截到 200 个 UTF-16 单元后再去掉结尾空格：截断点落在空格上也不会被主站拒；截完是空的按没选地点", () => {
  const cut = trimName(`${"地".repeat(199)} 東京`);
  assert.equal(cut, "地".repeat(199));
  assert.deepEqual(bookingDraftIssues(draftOf(form({ pickup: { name: `${"地".repeat(199)} 東京`, lat: 35, lng: 139 } }), "ja")), []);
  assert.equal(trimName("   "), "");
  assert.deepEqual(formProblems(form({ pickup: { name: "   ", lat: 35, lng: 139 } })), ["pickup"]);
});

test("服务端 400 的问题路径对到组件里的那一项", () => {
  assert.equal(problemOfIssuePath("/draft/pickup/name"), "pickup");
  assert.equal(problemOfIssuePath("/draft/dropoff/lat"), "dropoff");
  assert.equal(problemOfIssuePath("/draft/waypoints/2/name"), "waypoint-2");
  assert.equal(problemOfIssuePath("/draft/waypoints/0/stay_minutes"), "stay-0");
  assert.equal(problemOfIssuePath("/draft/service_local"), "date");
  assert.equal(problemOfIssuePath("/draft/passengers"), "passengers");
  assert.equal(problemOfIssuePath("/draft/waypoints"), null);
  assert.equal(problemOfIssuePath("/return_url"), null);
});

test("M9E-10 外观：layout 不认识用 card；bar 只在容器不窄于 768 px 时用（按容器宽度，不按视口），量不到宽度按 card", () => {
  assert.equal(resolveLayout(undefined), "card");
  assert.equal(resolveLayout("bar"), "bar");
  assert.equal(resolveLayout("grid"), "card");
  assert.equal(BAR_MIN_WIDTH, 768);
  assert.equal(layoutFor("bar", 768), "bar");
  assert.equal(layoutFor("bar", 767), "card");
  assert.equal(layoutFor("bar", 0), "card");
  assert.equal(layoutFor("card", 1440), "card");
});

test("M9E-10 主题：写错的项用默认值；主色、点缀色上的字自动挑够 4.5:1 的；白底上主色不够 4.5:1 时文字改用深色", () => {
  const plain = resolveTheme(undefined);
  assert.deepEqual([plain.primary, plain.accent, plain.radius], [DEFAULT_THEME.primary, DEFAULT_THEME.accent, DEFAULT_THEME.radius]);
  assert.equal(plain.onPrimary, "#FFFFFF");
  assert.equal(plain.ink, DEFAULT_THEME.primary);
  assert.ok(contrastRatio(plain.accent, plain.onAccent) >= 4.5);
  const orange = resolveTheme({ primary: "#ff6b35", accent: "rgb(255, 181, 77)", radius: "14px", fontFamily: '"Noto Sans SC", sans-serif' });
  assert.equal(orange.primary, "#FF6B35");
  assert.equal(orange.onPrimary, INK_DARK, "橙色上白字不到 4.5:1，改用深色字");
  assert.ok(contrastRatio(orange.primary, orange.onPrimary) >= 4.5);
  assert.equal(orange.ink, INK_DARK, "橙色在白底上当文字不够 4.5:1");
  assert.equal(orange.accent, "#FFB54D");
  assert.equal(orange.radius, 14);
  assert.equal(orange.fontFamily, '"Noto Sans SC", sans-serif');
  const bad = resolveTheme({ primary: "red; background: url(x)", accent: "rgba(0, 0, 0, 0.5)", radius: 99, fontFamily: "x; } .evil {" });
  assert.deepEqual([bad.primary, bad.accent, bad.radius, bad.fontFamily], [DEFAULT_THEME.primary, DEFAULT_THEME.accent, DEFAULT_THEME.radius, DEFAULT_THEME.fontFamily]);
  assert.equal(hexOf("#abc"), "#AABBCC");
  assert.equal(hexOf("rgb(0 128 255)"), "#0080FF");
  assert.equal(hexOf("rgb(300, 0, 0)"), null);
});

test("M9E-10 人数行李的摘要（长、短两种，三种语言）和加减范围", () => {
  assert.equal(guestsSummary("zh", 2, 1), "2 位乘客 · 1 件行李");
  assert.equal(guestsSummary("ja", 3, 0), "3名 · 荷物0個");
  assert.equal(guestsSummary("en", 1, 1), "1 passenger · 1 bag");
  assert.equal(guestsSummary("en", 2, 3, true), "2 pax · 3 bags");
  assert.deepEqual(GUEST_LIMITS, { passengers: { min: 1, max: 20 }, luggage: { min: 0, max: 20 } });
});

