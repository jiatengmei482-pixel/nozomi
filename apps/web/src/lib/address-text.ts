import { ORDER_FIELD_LIMITS } from "@nozomi/domain";

/**
 * 地址栏里写什么：名称，有地址时带上地址「名称（地址）」。
 * 不超过下单允许的地址长度（`ORDER_FIELD_LIMITS.addressMax`，按字符数，和后端同口径）：放不下时截短地址、末尾加「…」，名称总是留着。
 */
export function addressText(nameText: string, detail: string | null): string {
  const max = ORDER_FIELD_LIMITS.addressMax;
  const name = [...nameText.trim()];
  if (name.length >= max) return name.slice(0, max).join("");
  const address = [...(detail ?? "").trim()];
  if (address.length === 0 || address.join("") === name.join("")) return name.join("");
  // 名称 +「（」+ 地址 +「）」
  const room = max - name.length - 2;
  if (room < 2) return name.join("");
  const shown = address.length <= room ? address.join("") : `${address.slice(0, room - 1).join("")}…`;
  return `${name.join("")}（${shown}）`;
}
