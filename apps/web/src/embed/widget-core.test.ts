import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingDraftIssues } from "@nozomi/domain";
import { WIDGET_CSS, themeCss } from "./widget-style.ts";
import { BAR_MIN_WIDTH, GUEST_LIMITS, formatDate, formatTime, toneContrast, toneOn, STAY_OPTIONS, TEXTS, type WidgetForm, contrastWithWhite, guestsSummary, hexOf, luminance, layoutFor, resolveLayout, resolveTheme, draftFailureOf,draftOf, formProblems, problemOfIssuePath, resolveLang, resolveServices, tomorrow, trimName } from "./widget-core.ts";

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

test("M9E-10 主题：没给或写错的项为 null（用样式表的默认值）；主色、点缀色上的字自动挑够 4.5:1 的；白底上主色不够 4.5:1 时文字改用深色", () => {
  assert.deepEqual(resolveTheme(undefined), { primary: null, accent: null, radius: null, fontFamily: null });
  const navy = resolveTheme({ primary: "#1b2a5c" });
  assert.deepEqual(navy.primary, { color: "#1B2A5C", text: "light", inkOnWhite: true, markOnWhite: true });
  const orange = resolveTheme({ primary: "#ff6b35", accent: "#ffb54d", radius: "14px", fontFamily: '"Noto Sans SC", sans-serif' });
  assert.deepEqual(orange.primary, { color: "#FF6B35", text: "dark", inkOnWhite: false, markOnWhite: false }, "橙色上白字不到 4.5:1 改深色字；橙色在白底上当文字也不够");
  assert.ok(contrastWithWhite("#FF6B35") < 4.5);
  assert.deepEqual(orange.accent, { color: "#FFB54D", text: "dark" });
  assert.equal(orange.radius, 14);
  assert.equal(orange.fontFamily, '"Noto Sans SC", sans-serif');
  const bad = resolveTheme({ primary: "red; background: url(x)", accent: "rgba(0, 0, 0, 0.5)", radius: 99, fontFamily: "x; } .evil {" });
  assert.deepEqual(bad, { primary: null, accent: null, radius: null, fontFamily: null });
  assert.equal(hexOf("#abc"), "#AABBCC");
  assert.equal(hexOf(" #0080ff "), "#0080FF");
  assert.equal(hexOf("red"), null, "颜色名、rgb() 等写法不认");
  assert.equal(hexOf("#12345"), null);
});

test("M9E-10 主题兜底（#233 审查）：字色在白、深色里取对比度高的，都不到 4.5:1 退到纯黑 / 纯白；浅主色的标记条改用深色", () => {
  // #777777：白 4.48、深色 3.69，都不到 4.5:1 → 纯黑 4.69
  const gray = resolveTheme({ primary: "#777777" });
  assert.equal(gray.primary?.text, "black");
  assert.ok(toneContrast("#777777") >= 4.5, `#777777 上的字 ${toneContrast("#777777").toFixed(2)}:1`);
  assert.equal(themeCss(gray).includes("--nzb-on-primary: var(--nzb-black)"), true);
  // #FFCC00：白只有 1.51 → 深色字；当白底上的标记条（选中标签的条）不到 3:1 → 改用深色
  const yellow = resolveTheme({ primary: "#FFCC00", accent: "#FFCC00" });
  assert.deepEqual(yellow.primary, { color: "#FFCC00", text: "dark", inkOnWhite: false, markOnWhite: false });
  assert.ok(contrastWithWhite("#FFCC00") < 3);
  assert.match(themeCss(yellow), /--nzb-mark: var\(--nzb-dark\)/);
  assert.equal(yellow.accent?.text, "dark");
  // 扫一遍灰阶和几种彩色：挑出来的字都够 4.5:1
  const samples = [...Array.from({ length: 52 }, (_, index) => `#${(index * 5).toString(16).padStart(2, "0").repeat(3)}`), "#FF6B35", "#0B6577", "#FFB54D", "#E53935", "#00A3A3", "#8E44AD"].map((hex) => hex.toUpperCase());
  for (const hex of samples) assert.ok(toneContrast(hex) >= 4.5, `${hex} 上的字 ${toneContrast(hex).toFixed(2)}:1`);
  // 样式表里三种字色的取值和 core 里算亮度用的一致
  const defaults = /\.nzb-shell \{[^}]*\}/.exec(WIDGET_CSS)?.[0] ?? "";
  assert.match(defaults, /--nzb-light: #ffffff; --nzb-dark: #1a1f29; --nzb-black: #000000;/);
  assert.equal(toneOn("#1A1F29"), "light");
});

test("M9E-10 主题变成 CSS 变量：themeCss 只写给了的项；默认值（样式表）的主色是 tokens.css 的 --color-brand，两组前景 / 背景都够 4.5:1", async () => {
  assert.equal(themeCss(resolveTheme(undefined)), "");
  assert.equal(
    themeCss(resolveTheme({ primary: "#ff6b35", radius: 12, fontFamily: "Georgia, serif" })),
    ".nzb-shell { --nzb-primary: #FF6B35; --nzb-on-primary: var(--nzb-dark); --nzb-ink: var(--nzb-dark); --nzb-mark: var(--nzb-dark); --nzb-radius: 12px; --nzb-font: Georgia, serif; }\n",
  );
  const defaults = /\.nzb-shell \{[^}]*\}/.exec(WIDGET_CSS)?.[0] ?? "";
  const value = (name: string): string => new RegExp(`${name}: (#[0-9a-f]{6})`).exec(defaults)?.[1]?.toUpperCase() ?? "";
  const tokens = await readFile(new URL("../../../../docs/design/tokens.css", import.meta.url), "utf8");
  assert.equal(value("--nzb-primary"), /--color-brand:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)?.[1]?.toUpperCase());
  assert.equal(value("--nzb-dark"), /--color-text-primary:\s*(#[0-9A-Fa-f]{6})/.exec(tokens)?.[1]?.toUpperCase());
  const ratio = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.ok(ratio(value("--nzb-primary"), value("--nzb-light")) >= 4.5, "默认主色上的白字");
  assert.ok(ratio(value("--nzb-accent"), value("--nzb-dark")) >= 4.5, "默认点缀色上的深色字");
  assert.match(defaults, /--nzb-on-primary: var\(--nzb-light\); --nzb-ink: var\(--nzb-primary\); --nzb-mark: var\(--nzb-primary\); --nzb-accent: #[0-9a-f]{6}; --nzb-on-accent: var\(--nzb-dark\); --nzb-radius: 24px;/);
});

test("M9E-10 日期、时间按组件的语言格式化（不看访客浏览器）；写法不对或日期不存在就原样显示", () => {
  const plain = (text: string): string => text.replace(/\s/g, " ");
  const now = new Date(2026, 10, 14, 12, 0);
  assert.equal(formatDate("zh", "2026-11-15", now), "11月15日周日", "今年的不写年份");
  assert.equal(formatDate("ja", "2026-11-15", now), "11月15日(日)");
  assert.equal(formatDate("en", "2026-11-15", now), "Sun, Nov 15");
  assert.equal(formatDate("zh", "2027-01-02", now), "2027年1月2日周六", "跨年的写上年份");
  assert.equal(formatDate("ja", "2027-01-02", now), "2027年1月2日(土)");
  assert.equal(formatDate("en", "2027-01-02", now), "Sat, Jan 2, 2027");
  assert.equal(formatTime("zh", "09:05"), "09:05");
  assert.equal(formatTime("ja", "23:30"), "23:30");
  assert.equal(plain(formatTime("en", "09:05")), "9:05 AM");
  assert.equal(plain(formatTime("en", "23:30")), "11:30 PM");
  assert.equal(formatDate("ja", "2027-02-30"), "2027-02-30");
  assert.equal(formatDate("en", ""), "");
  assert.equal(formatTime("zh", "25:00"), "25:00");
});

test("M9E-10 人数行李的摘要（长、短两种，三种语言）和加减范围", () => {
  assert.equal(guestsSummary("zh", 2, 1), "2 位乘客 · 1 件行李");
  assert.equal(guestsSummary("ja", 3, 0), "3名 · 荷物0個");
  assert.equal(guestsSummary("en", 1, 1), "1 passenger · 1 bag");
  assert.equal(guestsSummary("en", 2, 3, true), "2 pax · 3 bags");
  assert.equal(guestsSummary("en", 1, 1, true), "1 pax · 1 bag", "单数不写成 1 bags（#233 审查）");
  assert.deepEqual(GUEST_LIMITS, { passengers: { min: 1, max: 20 }, luggage: { min: 0, max: 20 } });
});

