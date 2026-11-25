/**
 * 客人界面语言的总开关（M12-01，ADR 0109）。
 *
 * 管的是嵌入入口（合作网站上的查价框、预订页外层的标题和提示）和嵌入预订页外层（卖方说明、状态、订单页说明）：
 * 这些地方的语言先按「init / mountBooking 的 lang → 宿主页 <html lang> → 浏览器语言 → 英文」定下来
 * （`apps/web/src/embed/widget-core.ts` 的 `pickLang`），再经这里——开放了就用它，没开放退回中文。
 * 业主 2026-11-25 定：这几处跟随宿主页语言，三种语言都开放。
 *
 * 主站 `/book` 和嵌入页里面复用的四步、订单页、付款现在只有中文，不经过这里（要不要翻译待业主决定）；
 * 邮件 / 通知模板也只有中文（`notifications.ts` 的 `NOTIFICATION_LOCALES`）。
 * 这个文件不依赖别的模块：嵌入组件脚本单独引它（`@nozomi/domain/guest-ui-language`），不把整个 domain 打进组件。
 * `GUEST_UI` 写成对象（同 `EMBED_FRAME`、`READY_TIMEOUT` 的写法）：业务代码只读，测试里可以临时收窄。
 */

export type GuestLang = "zh" | "ja" | "en";

/** 现在开放给客人的界面语言（业主 2026-11-25：嵌入入口和嵌入页外层跟随宿主页，三种都开放） */
export const GUEST_UI_LANGUAGES: readonly GuestLang[] = ["zh", "ja", "en"];

/** 开关本身：业务代码只读；测试里可以临时换掉，测完换回 GUEST_UI_LANGUAGES */
export const GUEST_UI: { languages: readonly GuestLang[] } = { languages: GUEST_UI_LANGUAGES };

/** 定下的语言 → 实际显示的语言：开放了就用它，没开放退回中文 */
export function guestUiLanguage(requested: GuestLang): GuestLang {
  return GUEST_UI.languages.includes(requested) ? requested : "zh";
}
