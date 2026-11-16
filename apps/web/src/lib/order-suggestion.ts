/**
 * 包车经停顺序建议在页面上的纯逻辑（M9P-20 P2，ADR 0096 第三节第 4、5 小节、第四节）：
 * - 什么时候调接口：经停点集合（不看顺序）或其他询价字段（请求键）变了才调；只换顺序不调；
 * - 拖动后建议块跟着重算（不调接口）：用新的当前路线和建议路线比省多少（和服务器同一个判断函数）、按车型对应比价格；
 *   排成了建议顺序、省得不够、建议价更贵、当前报价还没回来（显示「计算中」）、路线取不到时各自怎么显示；
 * - 标题文案（新文案走键，M11-01）。
 */
import { type CurrencyCode, formatMajor, isCurrencyCode, judgeSuggestion, parseMajor, routeCoordinateText, suggestionRequestKey } from "@nozomi/domain";
import type { SiteMoney, SiteOrderSuggestion, SiteQuote, SiteQuoteRequest, SiteQuoteResult } from "../api/site.ts";
import { durationText, kmText } from "./charter-itinerary.ts";
import { moneyText } from "./dispatch-display.ts";
import { itineraryCopy } from "./itinerary-texts.ts";

const pointText = (point: { lat: number; lng: number }): string => `${routeCoordinateText(point.lat)},${routeCoordinateText(point.lng)}`;

/**
 * 经停点集合的键（上下车点 + 经停点坐标排序后）：变了才可能要问谷歌；只换可动经停的顺序不变。
 * 有指定到达时间的经停（固定点，M9P-20 P3）时再加上固定点在第几个：固定点换了位置会重新切段（ADR 0096 第三节第 1、6 小节），要重新申请；
 * 没有固定点时和以前一样。
 */
export function stopSetKey(body: SiteQuoteRequest): string {
  const waypoints = body.waypoints ?? [];
  const stops = waypoints.map(pointText).sort();
  const fixed = waypoints.flatMap((stop, index) => (stop.arrive_by === undefined ? [] : [`${index}@${pointText(stop)}`]));
  return [pointText(body.pickup ?? { lat: 0, lng: 0 }), pointText(body.dropoff ?? { lat: 0, lng: 0 }), stops.join(";"), ...(fixed.length === 0 ? [] : [fixed.join(";")])].join("|");
}

/** 当前草稿的请求键（和服务器 `request_key` 同一个函数）：除经停顺序外全部询价字段。 */
export function draftRequestKey(body: SiteQuoteRequest): string {
  return suggestionRequestKey({
    pickup: body.pickup ?? { lat: 0, lng: 0 },
    dropoff: body.dropoff ?? { lat: 0, lng: 0 },
    waypoints: body.waypoints ?? [],
    service_local: body.service_local,
    passengers: body.passengers,
    luggage: body.luggage,
    // 和服务器一样：没写数量按 1（site.ts 的 addons 校验 default(1)），请求键才对得上
    addons: (body.addons ?? []).map((addon) => ({ addon_id: addon.addon_id, quantity: addon.quantity ?? 1 })),
    package_hours: body.package_hours ?? null,
  });
}

/** 建议块要显示的：省的公里、分钟、钱（或价格不变 / 不写钱），数字是不是还在算。 */
export type LiveSuggestion =
  | { visible: false }
  | {
      visible: true;
      /** 当前报价还没回来：数字显示「计算中」，「采用」不可用 */
      pending: boolean;
      savedMeters: number;
      savedMinutes: number;
      /** saved：可省这么多；same：价格不变（或建议更便宜到 0）；none：不写钱（当前顺序超长没有价） */
      yen: { kind: "saved"; amount: SiteMoney } | { kind: "same" } | { kind: "none" };
      tooLong: boolean;
    };

function minorOf(money: SiteMoney): number | null {
  if (!isCurrencyCode(money.currency)) return null;
  try {
    return parseMajor(money.amount, money.currency);
  } catch {
    return null;
  }
}

/** 某个车型组在一组报价里的对客价（同一车型组只有一张卡片） */
const priceOf = (quotes: readonly SiteQuote[], groupId: string): SiteMoney | null => quotes.find((quote) => quote.vehicle_group.id === groupId)?.price.total ?? null;

export interface LiveInput {
  suggestion: SiteOrderSuggestion;
  /** 现在页面上的经停顺序（标识） */
  currentRefs: readonly string[];
  /** 现在这个顺序的报价应答；还在询价时为 null */
  current: SiteQuoteResult | null;
  currentLoading: boolean;
  /** 客人选中的车型组；没选时按当前最便宜的那张卡片 */
  selectedGroupId: string | null;
}

/**
 * 拖动以后建议块的样子（不调接口、不调谷歌）：
 * - 排成了建议顺序 → 收起；
 * - 当前报价还在路上 → 显示、数字「计算中」；
 * - 当前顺序超长（没有报价、但有路线）→ 显示，不看阈值、不写钱；
 * - 当前顺序路线取不到或别的原因报不出 → 收起；
 * - 省得不够（同服务器的判断）→ 收起；
 * - 按车型对应比价：建议价更贵 → 收起；选中的车型按建议顺序报不出 → 收起。
 */
export function liveSuggestion(input: LiveInput): LiveSuggestion {
  const { suggestion } = input;
  if (input.currentRefs.length === suggestion.order.length && input.currentRefs.every((ref, index) => ref === suggestion.order[index])) return { visible: false };
  if (input.currentLoading || input.current === null) return { visible: true, pending: true, savedMeters: suggestion.saved_meters, savedMinutes: suggestion.saved_minutes, yen: { kind: "none" }, tooLong: suggestion.current_too_long };
  const route = input.current.itinerary_route;
  if (route === undefined) return { visible: false };
  const savedMeters = route.total_meters - suggestion.itinerary_route.total_meters;
  const savedMinutes = route.drive_minutes - suggestion.itinerary_route.drive_minutes;
  const tooLong = input.current.quotes.length === 0 && input.current.unavailable.some((entry) => entry.reasons.includes("ITINERARY_TOO_LONG"));
  if (tooLong) return { visible: true, pending: false, savedMeters, savedMinutes, yen: { kind: "none" }, tooLong: true };
  if (input.current.quotes.length === 0) return { visible: false };
  const verdict = judgeSuggestion({ meters: route.total_meters, minutes: route.drive_minutes }, { meters: suggestion.itinerary_route.total_meters, minutes: suggestion.itinerary_route.drive_minutes }, { minSavedMeters: suggestion.thresholds.min_saved_meters, minSavedMinutes: suggestion.thresholds.min_saved_minutes });
  if (!verdict.ok) return { visible: false };
  const groupId = input.selectedGroupId ?? [...input.current.quotes].sort((a, b) => (minorOf(a.price.total) ?? 0) - (minorOf(b.price.total) ?? 0))[0]?.vehicle_group.id ?? null;
  if (groupId === null) return { visible: false };
  const now = priceOf(input.current.quotes, groupId);
  const then = priceOf(suggestion.quote_result.quotes, groupId);
  if (now === null || then === null || now.currency !== then.currency) return { visible: false };
  const nowMinor = minorOf(now);
  const thenMinor = minorOf(then);
  if (nowMinor === null || thenMinor === null || thenMinor > nowMinor) return { visible: false };
  const yen = thenMinor === nowMinor ? ({ kind: "same" } as const) : ({ kind: "saved", amount: { amount: formatMajor(nowMinor - thenMinor, now.currency as CurrencyCode), currency: now.currency } } as const);
  return { visible: true, pending: false, savedMeters: verdict.savedMeters, savedMinutes: verdict.savedMinutes, yen, tooLong: false };
}

/** 建议块的标题：「建议顺序，可省 12.3 公里、18 分钟、2,200 JPY」/「……，价格不变」/ 当前顺序超长时「……按建议顺序约 X，可以在线下单」/「计算中」。 */
export function suggestionTitle(live: Extract<LiveSuggestion, { visible: true }>, suggestion: SiteOrderSuggestion): string {
  if (live.pending) return itineraryCopy("suggestPending");
  if (live.tooLong) return itineraryCopy("suggestTooLong", { duration: durationText(suggestion.itinerary_route.total_minutes) });
  const parts = [...(live.savedMeters > 0 ? [kmText(live.savedMeters)] : []), ...(live.savedMinutes > 0 ? [durationText(live.savedMinutes)] : [])];
  if (live.yen.kind === "saved") parts.push(moneyText(live.yen.amount));
  const saved = parts.join("、");
  return live.yen.kind === "same" ? itineraryCopy("suggestTitleSame", { saved }) : itineraryCopy("suggestTitle", { saved });
}

/** 一种顺序写成一行：「1 新宿 → 2 横滨 → 3 箱根 → 4 新宿」 */
export function orderChain(names: readonly string[]): string {
  return names.map((name, index) => `${index + 1} ${name}`).join(" → ");
}

/** 建议报价过期了没有（按最早的那张卡片的 `expires_at`）：过期的不直接采用，按新顺序正常重新询价。 */
export function suggestionQuoteExpired(result: SiteQuoteResult, now: Date = new Date()): boolean {
  const first = result.quotes.map((quote) => Date.parse(quote.expires_at)).sort((a, b) => a - b)[0];
  return first === undefined || !(first > now.getTime());
}
