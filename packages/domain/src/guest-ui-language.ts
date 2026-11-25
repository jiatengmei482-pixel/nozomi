/**
 * 客人界面语言的总开关（M12-01，ADR 0109）。
 *
 * 业主 2026-11-25 决定：先不做翻译、按中文版上线，M11 多语言整体延后。所以 M11 之前客人看到的界面一律中文——
 * 嵌入入口小程序、嵌入预订页外层（标题、状态、订单页说明）、Stripe 付款表单、地址搜索的页面语言都按这里定的语言，
 * 不论合作网站 init / mountBooking 的 `lang`、嵌入码的默认语言、草稿里记的语言是什么。
 *
 * 日文、英文文案和 `lang` 参数的读取、校验都保留不删；M11 时把 `GUEST_UI_LANGUAGES` 改成 ["zh", "ja", "en"] 即可恢复。
 * `GUEST_UI` 写成对象（同 `EMBED_FRAME`、`READY_TIMEOUT` 的写法）：组件测试临时放开三种语言，继续覆盖 M11 要恢复的日文、英文界面。
 * 这个文件不依赖别的模块：嵌入组件脚本单独引它（`@nozomi/domain/guest-ui-language`），不把整个 domain 打进组件。
 * 邮件 / 通知模板本来就只有中文（`notifications.ts` 的 `NOTIFICATION_LOCALES`），不经过这里。
 */

export type GuestLang = "zh" | "ja" | "en";

/** 现在开放给客人的界面语言的默认值。M11 之前只有中文（业主 2026-11-25） */
export const GUEST_UI_LANGUAGES: readonly GuestLang[] = ["zh"];

/** 开关本身：业务代码只读；测试里可以临时换成三种语言，测完换回 GUEST_UI_LANGUAGES */
export const GUEST_UI: { languages: readonly GuestLang[] } = { languages: GUEST_UI_LANGUAGES };

/** 请求的语言 → 实际显示的语言：开放了就用它，没开放退回中文 */
export function guestUiLanguage(requested: GuestLang): GuestLang {
  return GUEST_UI.languages.includes(requested) ? requested : "zh";
}
