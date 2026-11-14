/**
 * 嵌入预订页本标签页 sessionStorage 里的订单（M9E-17，ADR 0095 第八节第 2 小节；修订 ADR 0046「令牌只进 Web 存储一次」）。
 *
 * 只在 iframe 里的嵌入页（主站域名下的文档）读写，**从不发给宿主**（postMessage 只有订单号）。iframe 的存储按顶层网站分区，
 * 所以只在这个合作网站、这个标签页里看得到。用途只有一个：宿主页刷新后，用同一个草稿号打开时续接还没付完的单。
 * - 下单成功时写入 `{ draft, token, at }`，最长 1 小时；读的时候草稿号要对得上、没过期才给，过期或写坏了的读到即删；
 * - 续接前嵌入页先读一次订单：只有还是「待付款」才续接，否则立即删掉（共用电脑上下一个人不会看到上一张单）；付款提交以后也删。
 * - Safari「阻止所有 Cookie」等情况下访问存储会抛错：一律当作没有、存不了，客人仍可以用邮件里的链接或「查订单」找回。
 * `styles.edge.test.ts` 核对这个文件只碰这一个键。
 */
import { siteTokenFromHash } from "../lib/site-display.ts";
import { isDraftId } from "./booking-protocol.ts";

export const EMBED_ORDER_KEY = "nozomi.embed-order";
export const EMBED_ORDER_TTL_MS = 60 * 60_000;

/** 读出来的记录：草稿号对得上、没过期才给令牌；不是这个草稿的为 null（不删：可能是同一标签页里另一次预订）；过期、写坏了的为 "stale"（调用方删掉） */
export function readEmbedOrderRecord(raw: string | null, draft: string, now: number): string | null | "stale" {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { draft?: unknown; token?: unknown; at?: unknown };
    if (!isDraftId(parsed.draft) || typeof parsed.token !== "string" || siteTokenFromHash(parsed.token) !== parsed.token || typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return "stale";
    if (parsed.at > now + 60_000 || now - parsed.at >= EMBED_ORDER_TTL_MS) return "stale";
    return parsed.draft === draft ? parsed.token : null;
  } catch {
    return "stale";
  }
}

export function rememberEmbedOrder(draft: string, token: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(EMBED_ORDER_KEY, JSON.stringify({ draft, token, at: now }));
  } catch {
    // 存不了：见文件头
  }
}

/** 这个草稿下过、还在有效期里的单的令牌；没有为 null。过期、写坏的顺手删掉 */
export function embedOrderFor(draft: string, now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(EMBED_ORDER_KEY);
  } catch {
    return null;
  }
  const found = readEmbedOrderRecord(raw, draft, now);
  if (found === "stale") {
    forgetEmbedOrder();
    return null;
  }
  return found;
}

export function forgetEmbedOrder(): void {
  try {
    sessionStorage.removeItem(EMBED_ORDER_KEY);
  } catch {
    // 同上
  }
}
