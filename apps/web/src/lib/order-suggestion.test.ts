import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestionRequestKey } from "@nozomi/domain";
import type { SiteOrderSuggestion, SiteQuote, SiteQuoteRequest, SiteQuoteResult } from "../api/site.ts";
import { draftRequestKey, liveSuggestion, orderChain, stopSetKey, suggestionTitle } from "./order-suggestion.ts";

const P = { lat: 35.69, lng: 139.7 };
const A = { name: "河口湖", lat: 35.5, lng: 138.77, stay_minutes: 60 };
const B = { name: "横滨", lat: 35.45, lng: 139.63, stay_minutes: 60 };
const C = { name: "箱根", lat: 35.23, lng: 139.1, stay_minutes: 60 };
const body = (waypoints = [A, B, C], extra: Partial<SiteQuoteRequest> = {}): SiteQuoteRequest => ({ category: "charter", itinerary_pricing: true, pickup: P, dropoff: P, waypoints, service_local: "2030-11-20T08:00", passengers: 2, luggage: 1, ...extra });
const route = (meters: number, drive: number) => ({ legs: [], drive_minutes: drive, stay_minutes: 180, total_minutes: drive + 180, total_meters: meters });
const quote = (group: string, amount: number): SiteQuote => ({ vehicle_group: { id: group }, price: { total: { amount: String(amount), currency: "JPY" } } }) as unknown as SiteQuote;
const result = (quotes: SiteQuote[], meters = 300_000, drive = 300, extra: Partial<SiteQuoteResult> = {}): SiteQuoteResult => ({ currency: "JPY", quotes, unavailable: [], itinerary_route: route(meters, drive), ...extra });
const suggestion = (quotes: SiteQuote[] = [quote("g1", 70_000), quote("g2", 90_000)]): SiteOrderSuggestion => ({
  order: ["b", "c", "a"],
  saved_meters: 60_000,
  saved_minutes: 60,
  current_itinerary_route: route(300_000, 300),
  itinerary_route: route(240_000, 240),
  request_key: "rk1:x",
  thresholds: { min_saved_meters: 5_000, min_saved_minutes: 10 },
  current_too_long: false,
  quote_result: result(quotes, 240_000, 240),
});

test("什么时候调接口：经停点集合的键不看顺序；请求键和服务器同一个函数（不看顺序、看停留）", () => {
  assert.equal(stopSetKey(body([A, B, C])), stopSetKey(body([C, A, B])));
  assert.notEqual(stopSetKey(body([A, B])), stopSetKey(body([A, B, C])));
  assert.equal(stopSetKey(body([A, B, C])), stopSetKey(body([A, B, C], { passengers: 5 })), "人数不影响要不要问谷歌");
  assert.equal(draftRequestKey(body([A, B, C])), draftRequestKey(body([B, C, A])));
  assert.notEqual(draftRequestKey(body([A, B, C])), draftRequestKey(body([{ ...A, stay_minutes: 90 }, B, C])));
  assert.equal(draftRequestKey(body()), suggestionRequestKey({ pickup: P, dropoff: P, waypoints: [A, B, C], service_local: "2030-11-20T08:00", passengers: 2, luggage: 1, addons: [], package_hours: null }));
});

test("拖动后建议块：按新的当前路线重算省多少、按车型对应比价；排成建议顺序、省得不够、更贵、报不出都收起；还在询价时「计算中」", () => {
  const s = suggestion();
  const current = result([quote("g1", 75_000), quote("g2", 90_000)]);
  const live = liveSuggestion({ suggestion: s, currentRefs: ["a", "b", "c"], current, currentLoading: false, selectedGroupId: null });
  assert.deepEqual(live, { visible: true, pending: false, savedMeters: 60_000, savedMinutes: 60, yen: { kind: "saved", amount: { amount: "5000", currency: "JPY" } }, tooLong: false });
  assert.equal(suggestionTitle(live as never, s), "建议顺序，可省 60 公里、1 小时、5,000 JPY");
  const selected = liveSuggestion({ suggestion: s, currentRefs: ["a", "b", "c"], current, currentLoading: false, selectedGroupId: "g2" });
  assert.equal(selected.visible && selected.yen.kind, "same", "选中的车型价格不变");
  assert.equal(suggestionTitle(selected as never, s), "建议顺序，可省 60 公里、1 小时，价格不变");
  assert.deepEqual(liveSuggestion({ suggestion: s, currentRefs: ["b", "c", "a"], current, currentLoading: false, selectedGroupId: null }), { visible: false }, "排成了建议顺序");
  const pending = liveSuggestion({ suggestion: s, currentRefs: ["c", "a", "b"], current: null, currentLoading: true, selectedGroupId: null });
  assert.equal(pending.visible && pending.pending, true);
  assert.equal(suggestionTitle(pending as never, s), "建议顺序：计算中…");
  // 拖成只比建议多 4 公里、9 分钟：收起
  assert.deepEqual(liveSuggestion({ suggestion: s, currentRefs: ["c", "a", "b"], current: result([quote("g1", 75_000)], 244_000, 249), currentLoading: false, selectedGroupId: null }), { visible: false });
  // 刚好 5 公里：成立
  assert.equal(liveSuggestion({ suggestion: s, currentRefs: ["c", "a", "b"], current: result([quote("g1", 75_000)], 245_000, 241), currentLoading: false, selectedGroupId: null }).visible, true);
  // 建议价更贵：收起
  assert.deepEqual(liveSuggestion({ suggestion: s, currentRefs: ["a", "b", "c"], current: result([quote("g1", 69_000)]), currentLoading: false, selectedGroupId: null }), { visible: false });
  // 选中的车型按建议顺序报不出：收起
  assert.deepEqual(liveSuggestion({ suggestion: suggestion([quote("g2", 80_000)]), currentRefs: ["a", "b", "c"], current, currentLoading: false, selectedGroupId: "g1" }), { visible: false });
  // 路线取不到（没有 itinerary_route）：收起
  assert.deepEqual(liveSuggestion({ suggestion: s, currentRefs: ["a", "b", "c"], current: { currency: "JPY", quotes: [], unavailable: [] }, currentLoading: false, selectedGroupId: null }), { visible: false });
});

test("当前顺序超长：照常显示，不看阈值、不写钱；文案说按建议顺序可以在线下单", () => {
  const s = { ...suggestion(), current_too_long: true };
  const current = result([], 300_000, 300, { unavailable: [{ vehicle_group_id: null, reasons: ["ITINERARY_TOO_LONG"] }] });
  const live = liveSuggestion({ suggestion: s, currentRefs: ["a", "b", "c"], current, currentLoading: false, selectedGroupId: null });
  assert.deepEqual(live, { visible: true, pending: false, savedMeters: 60_000, savedMinutes: 60, yen: { kind: "none" }, tooLong: true });
  assert.equal(suggestionTitle(live as never, s), "当前顺序超过在线下单时长，按建议顺序约 7 小时，可以在线下单");
  assert.equal(orderChain(["新宿", "横滨", "箱根", "新宿"]), "1 新宿 → 2 横滨 → 3 箱根 → 4 新宿");
});
