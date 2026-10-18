/**
 * 汇率页、首页的显示规则（ADR 0022）。汇率是十进制字符串：显示时在字符串上四舍五入，不经过浮点数；
 * 只有曲线的坐标（点画在哪）用数字，那不是算钱。
 */
import { type CurrencyCode, type FxFetchStatus, type FxTableState, formatRate, rateToFraction } from "@nozomi/domain";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import type { FxFetch } from "../api/fx.ts";

export const FX_PATH = "/platform/master/fx-rates";

/** 币种的中文名（页面上和代码一起显示）。 */
export const CURRENCY_NAMES: Readonly<Record<CurrencyCode, string>> = {
  JPY: "日元",
  KRW: "韩元",
  CNY: "人民币",
  USD: "美元",
  HKD: "港币",
  TWD: "新台币",
  THB: "泰铢",
};

/** 汇率表、互换表里的币种顺序：常用的在前。 */
export const FX_DISPLAY_ORDER: readonly CurrencyCode[] = ["JPY", "CNY", "USD", "KRW", "HKD", "TWD", "THB"];

export const FX_STATE_BADGES: Readonly<Record<FxTableState, BadgeSpec>> = {
  fresh: { tone: "success", label: "正常" },
  stale: { tone: "danger", label: "已过期" },
  none: { tone: "warning", label: "还没有汇率" },
};

export const FX_FETCH_BADGES: Readonly<Record<FxFetchStatus, BadgeSpec>> = {
  running: { tone: "info", label: "正在拉取" },
  accepted: { tone: "success", label: "已更新" },
  unchanged: { tone: "neutral", label: "数据源未更新" },
  held: { tone: "warning", label: "变动过大，待确认" },
  confirmed: { tone: "success", label: "已确认生效" },
  dismissed: { tone: "neutral", label: "已放弃" },
  rejected: { tone: "danger", label: "内容不对，未采用" },
  failed: { tone: "danger", label: "没有拉到" },
};

/** 拉取的方式：定时 / 手动（谁） */
export function fetchTriggerText(fetch: Pick<FxFetch, "trigger" | "triggered_by">): string {
  if (fetch.trigger === "schedule") return "定时";
  return fetch.triggered_by === null ? "手动" : `手动（${fetch.triggered_by.name}）`;
}

/**
 * 汇率的显示写法：≥ 1 的四舍五入到 4 位小数；< 1 的四舍五入到 6 位有效数字；末尾的 0 去掉（M1-14：原来是截短，最后一位可能小 1）。
 * 在十进制字符串上算（@nozomi/domain 的 formatRate，0.5 远离零），不经过浮点数。完整的值在悬停提示里，页面上也可以切成「显示完整数值」。
 * 例：`20.833333333333` → `20.8333`，`1334.892169` → `1334.8922`，`0.000714030703` → `0.000714031`，`150` → `150`。
 */
export function rateText(rate: string | null): string {
  if (rate === null) return "—";
  let fraction: ReturnType<typeof rateToFraction>;
  try {
    fraction = rateToFraction(rate);
  } catch {
    return rate;
  }
  const [whole = "0", decimals = ""] = rate.split(".");
  const places = whole !== "0" ? 4 : (/^0*/.exec(decimals)?.[0].length ?? 0) + 6;
  return formatRate(fraction, places) ?? rate;
}

/** 变动幅度（基点，带正负号）→ `+4.00%`、`−3.01%`。 */
export function changeText(bp: number): string {
  const sign = bp > 0 ? "+" : bp < 0 ? "−" : "";
  const abs = Math.abs(bp);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartModel {
  points: ChartPoint[];
  /** 纵轴的最低、最高（原样的十进制字符串） */
  min: string;
  max: string;
  first: string;
  last: string;
}

/**
 * 曲线的坐标：横轴按时间等比例，纵轴按汇率在最低、最高之间的位置；画布是 `width` × `height`，上下留 `padding`。
 * 只有一个点、或全都一样时画在中间一条水平线上。没有点返回 null。
 */
export function chartModel(points: readonly { as_of: string; rate: string }[], width: number, height: number, padding = 8): ChartModel | null {
  if (points.length === 0) return null;
  const times = points.map((point) => new Date(point.as_of).getTime());
  const values = points.map((point) => Number(point.rate));
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const span = (value: number, low: number, high: number): number => (high === low ? 0.5 : (value - low) / (high - low));
  const minIndex = values.indexOf(v0);
  const maxIndex = values.indexOf(v1);
  return {
    points: points.map((_, index) => ({
      x: Math.round((padding + span(times[index] as number, t0, t1) * (width - padding * 2)) * 10) / 10,
      y: Math.round((height - padding - span(values[index] as number, v0, v1) * (height - padding * 2)) * 10) / 10,
    })),
    min: (points[minIndex] as { rate: string }).rate,
    max: (points[maxIndex] as { rate: string }).rate,
    first: (points[0] as { as_of: string }).as_of,
    last: (points[points.length - 1] as { as_of: string }).as_of,
  };
}

/** 最近一次拉取失败的原因（接口的错误码 → 人话；系统状态页用，M1-14）。不认识的码不显示原文。 */
export function fxErrorText(code: string | null): string | null {
  if (code === null) return null;
  const known: Readonly<Record<string, string>> = {
    FX_SOURCE_TIMEOUT: "数据源在时限内没有应答",
    FX_SOURCE_UNAVAILABLE: "连不上数据源，或数据源暂时出错",
    FX_SOURCE_BAD_RESPONSE: "数据源返回的内容不对，没有采用",
    FX_SOURCE_OLDER: "数据源给的汇率比现在这批还旧，没有采用",
    FX_RATE_JUMP: "这批汇率变动超过 3%，已挂起，等人确认",
    FX_FETCH_ABANDONED: "上一次拉取中途断了",
  };
  return known[code] ?? "原因见汇率页的「最近的拉取记录」";
}
