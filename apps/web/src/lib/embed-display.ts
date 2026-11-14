/** 嵌入组件相关的说法（M9E-02，ADR 0090）。 */
import type { OrderEntrySource } from "../api/embed.ts";

/** 订单来源：主站，或「嵌入组件 · 网站（嵌入码名称）」；在合作网站页面里下单的是「嵌入组件（宿主页内）· …」（M9E-16，ADR 0095 第九节第 1 小节）。只做统计 */
export function entrySourceText(source: OrderEntrySource): string {
  if (source.kind !== "embed" || source.embed_origin === null) return "主站";
  let host = source.embed_origin;
  try {
    host = new URL(source.embed_origin).host;
  } catch {
    // 服务端存的都是规范化的 origin，解析不了就原样显示
  }
  return `嵌入组件${source.delivery === "host_page" ? "（宿主页内）" : ""} · ${host}${source.embed_key_name === null ? "" : `（${source.embed_key_name}）`}`;
}
