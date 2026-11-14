/**
 * 宿主页（合作网站自己的预订页）本标签页 sessionStorage 里的草稿号（M9E-16，ADR 0095 第三节第 2 小节第 0 步、第八节第 2 小节）。
 * 组件脚本 mountBooking 用：nzdraft 从地址栏移到这里，刷新时从这里取；收到 completed、草稿过期时删。
 * 只有一个键 `nozomi.host-draft`，值只有草稿号和时间（booking-protocol.ts 的 hostDraftRecord），2 小时。
 * Safari「阻止所有 Cookie」等情况下访问存储会抛错：一律当作没有、存不了，客人这一次照样能用，刷新后回到查价表单。
 * `styles.edge.test.ts` 核对这个文件只碰这一个键。
 */
export const HOST_DRAFT_KEY = "nozomi.host-draft";

export function readHostDraft(): string | null {
  try {
    return sessionStorage.getItem(HOST_DRAFT_KEY);
  } catch {
    return null;
  }
}

export function writeHostDraft(value: string): void {
  try {
    sessionStorage.setItem(HOST_DRAFT_KEY, value);
  } catch {
    // 存不了：见文件头
  }
}

export function forgetHostDraft(): void {
  try {
    sessionStorage.removeItem(HOST_DRAFT_KEY);
  } catch {
    // 同上
  }
}
