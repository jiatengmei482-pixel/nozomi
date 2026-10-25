/**
 * 渠道、加价规则、双人复核在页面上的写法（ADR 0023）：类型和状态的名字、徽标、五级的说明、复核的类别和改了什么。
 * 百分比一律以基点整数进出接口；页面上写成「12.5%」。
 */
import { CHANNEL_RULES, type ServiceCategory } from "@nozomi/domain";
import type { ApprovalKind, ApprovalStatus, ChannelPricing, ChannelStatus, ChannelType, MarkupRule, TenantScope } from "../api/channels.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { basisPointsText, percentTextToBasisPoints } from "./adjust-form.ts";
import { changeText } from "./fx-display.ts";
import { SERVICE_CATEGORY_NAMES, formatLocalDateTime } from "./master-display.ts";
import { moneyText } from "./product-display.ts";

export const CHANNELS_PAGE_PATH = "/platform/channels";
export const CHANNEL_NEW_PATH = `${CHANNELS_PAGE_PATH}/new`;
export const APPROVALS_PAGE_PATH = "/platform/approvals";
export function channelPath(id: string): string {
  return `${CHANNELS_PAGE_PATH}/${encodeURIComponent(id)}`;
}

export const CHANNEL_TYPE_NAMES: Readonly<Record<ChannelType, string>> = { own: "自营", api: "API 分销商", ota: "OTA（连接器）", offline: "线下代理" };
export const CHANNEL_TYPE_HINTS: Readonly<Record<ChannelType, string>> = {
  own: "自己的官网、App，直接调用销售端接口",
  api: "旅行社、企业差旅平台，按我们的销售端接口对接",
  ota: "Klook、Trip.com 等，由我们开发连接器适配对方的规范",
  offline: "实体旅行社、酒店前台，在后台手工下单",
};

export const CHANNEL_STATUS_BADGES: Readonly<Record<ChannelStatus, BadgeSpec>> = {
  testing: { tone: "info", label: "测试" },
  active: { tone: "success", label: "启用" },
  paused: { tone: "warning", label: "暂停" },
};

export const TENANT_SCOPE_NAMES: Readonly<Record<TenantScope, string>> = { all: "全部供应商", allow: "只卖名单里的", deny: "名单里的不卖" };

export const APPROVAL_KIND_NAMES: Readonly<Record<ApprovalKind, string>> = {
  "channel.pricing": "改定价参数",
  "channel.pause": "暂停渠道",
  "markup_rule.create": "新增加价规则",
  "markup_rule.update": "修改加价规则",
  "markup_rule.delete": "删除加价规则",
  "fx_lock.create": "锁定汇率",
  "fx_lock.release": "解除汇率锁定",
};

/** 汇率锁定的复核（M2-06）：对象是币种，页面链接去汇率页。 */
export function isFxApproval(kind: ApprovalKind): boolean {
  return kind === "fx_lock.create" || kind === "fx_lock.release";
}

export const APPROVAL_STATUS_BADGES: Readonly<Record<ApprovalStatus, BadgeSpec>> = {
  pending: { tone: "warning", label: "待审核" },
  approved: { tone: "success", label: "已批准" },
  rejected: { tone: "danger", label: "已驳回" },
  withdrawn: { tone: "neutral", label: "已撤回" },
};

export const MARKUP_LEVEL_NAMES: Readonly<Record<MarkupRule["level"], string>> = {
  1: "供应商 × 城市 × 品类 × 车型组",
  2: "供应商",
  3: "城市 × 品类 × 车型组",
  4: "城市 × 品类",
  5: "全渠道（促销期）",
};

/** 「12.5%」 */
export function percentText(bp: number): string {
  return `${basisPointsText(bp)}%`;
}

/** 输入框里的百分比（最多两位小数）→ 基点；读不出来返回 null。 */
export function readPercent(text: string): number | null {
  return percentTextToBasisPoints(text);
}

export const PLATFORM_FLOOR_TEXT = percentText(CHANNEL_RULES.platformMarkupFloorBp);

/** 一条加价规则的维度写成一句话：「NOZOMI 车队 · 东京 · 接送机 · 商务 7 座」。 */
export function ruleScopeText(rule: Pick<MarkupRule, "tenant" | "city" | "category" | "vehicle_group">): string {
  const parts = [rule.tenant?.name ?? (rule.tenant ? "（供应商）" : null), rule.city?.name ?? (rule.city ? "（城市）" : null), rule.category === null ? null : SERVICE_CATEGORY_NAMES[rule.category], rule.vehicle_group?.name ?? (rule.vehicle_group ? "（车型组）" : null)].filter((part): part is string => part !== null);
  return parts.length === 0 ? "全渠道" : parts.join(" · ");
}

export function ruleDatesText(rule: Pick<MarkupRule, "valid_from" | "valid_to">): string {
  if (rule.valid_from === null && rule.valid_to === null) return "不限";
  if (rule.valid_from !== null && rule.valid_from === rule.valid_to) return rule.valid_from;
  return `${rule.valid_from ?? "不限"} 至 ${rule.valid_to ?? "不限"}`;
}

/** 一组维度是五级里的哪一级；不是五种组合之一返回 null（和 @nozomi/domain 的 markupLevelOf 同一个规则）。 */
export function levelOf(dims: { tenant: boolean; city: boolean; category: boolean; vehicleGroup: boolean }): MarkupRule["level"] | null {
  const { tenant: t, city: c, category: k, vehicleGroup: v } = dims;
  if (t && c && k && v) return 1;
  if (t && !c && !k && !v) return 2;
  if (!t && c && k && v) return 3;
  if (!t && c && k && !v) return 4;
  if (!t && !c && !k && !v) return 5;
  return null;
}

export function pricingLines(pricing: ChannelPricing, settleCurrency: string): { label: string; value: string }[] {
  const rounding = Object.entries(pricing.sell_rounding);
  return [
    { label: "默认加价比例", value: percentText(pricing.default_markup_bp) },
    { label: "加价下限", value: percentText(pricing.markup_floor_bp) },
    { label: "价格带 δ", value: percentText(pricing.band_bp) },
    { label: "最低毛利", value: pricing.min_margin === 0 ? "不设" : moneyText(pricing.min_margin, settleCurrency) },
    { label: "对外价取整", value: rounding.length === 0 ? "不取整（四舍五入到最小单位）" : rounding.map(([currency, unit]) => `${currency} 向上取整到 ${moneyText(unit, currency)}`).join("；") },
  ];
}

/** 汇率锁定的复核里「改了什么」：锁定值、到期时间、和发起时中央汇率的偏离。 */
function fxLockChanges(kind: ApprovalKind, before: Record<string, unknown> | null, after: Record<string, unknown>): { label: string; before: string; after: string }[] {
  const currency = typeof after["currency"] === "string" ? after["currency"] : "";
  const central = typeof after["central_rate"] === "string" ? after["central_rate"] : null;
  const rate = (value: unknown): string | null => (typeof value === "string" ? `1 USD = ${value} ${currency}` : null);
  const time = (value: unknown): string => (typeof value === "string" ? formatLocalDateTime(value) : "—");
  const notLocked = `未锁定（中央汇率 ${central === null ? "—" : `1 USD = ${central} ${currency}`}）`;
  if (kind === "fx_lock.release") {
    return [
      { label: "锁定值", before: rate(before?.["rate"]) ?? "—", after: `解除，恢复用中央汇率（发起时 ${central ?? "—"}）` },
      { label: "到期时间", before: time(before?.["expires_at"]), after: "—" },
    ];
  }
  return [
    { label: "锁定值", before: rate(before?.["rate"]) ?? notLocked, after: rate(after["rate"]) ?? "—" },
    { label: "到期时间", before: time(before?.["expires_at"]), after: time(after["expires_at"]) },
    { label: "和发起时中央汇率的偏离", before: "—", after: typeof after["deviation_bp"] === "number" ? changeText(after["deviation_bp"]) : "—" },
  ];
}

/** 复核记录里「改了什么」：逐项列出改之前和改之后（只列变了的）。 */
export function approvalChanges(kind: ApprovalKind, before: Record<string, unknown> | null, after: Record<string, unknown>, settleCurrency: string | null): { label: string; before: string; after: string }[] {
  if (isFxApproval(kind)) return fxLockChanges(kind, before, after);
  const pct = (value: unknown): string => (typeof value === "number" ? percentText(value) : "—");
  const money = (value: unknown): string => (typeof value === "number" ? (value === 0 ? "不设" : moneyText(value, settleCurrency)) : "—");
  const rounding = (value: unknown): string => {
    const entries = typeof value === "object" && value !== null ? Object.entries(value as Record<string, number>) : [];
    return entries.length === 0 ? "不取整" : entries.map(([currency, unit]) => `${currency} ${moneyText(unit, currency)}`).join("；");
  };
  const text = (value: unknown): string => (value === null || value === undefined || value === "" ? "不限" : String(value));
  const fields: { key: string; label: string; format: (value: unknown) => string }[] =
    kind === "channel.pricing"
      ? [
          { key: "default_markup_bp", label: "默认加价比例", format: pct },
          { key: "markup_floor_bp", label: "加价下限", format: pct },
          { key: "band_bp", label: "价格带 δ", format: pct },
          { key: "min_margin_minor", label: "最低毛利", format: money },
          { key: "sell_rounding", label: "对外价取整", format: rounding },
        ]
      : kind === "channel.pause"
        ? [{ key: "status", label: "状态", format: (value) => (value === "paused" ? "暂停" : value === "active" ? "启用" : value === "testing" ? "测试" : "—") }]
        : [
            { key: "markup_bp", label: "加价比例", format: pct },
            { key: "valid_from", label: "开始日期", format: text },
            { key: "valid_to", label: "结束日期", format: text },
            { key: "note", label: "备注", format: (value) => (value === null || value === undefined || value === "" ? "—" : String(value)) },
          ];
  return fields
    .map((field) => ({ label: field.label, before: before === null ? "—" : field.format(before[field.key]), after: kind === "markup_rule.delete" ? "（删除）" : field.format(after[field.key]) }))
    .filter((line) => before === null || kind === "markup_rule.delete" || line.before !== line.after);
}

export function categoriesText(categories: readonly ServiceCategory[]): string {
  return categories.length === 3 ? "全部品类" : categories.map((category) => SERVICE_CATEGORY_NAMES[category]).join("、");
}
