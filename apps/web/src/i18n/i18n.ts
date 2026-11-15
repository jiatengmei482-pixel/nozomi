/**
 * 前端固定文案的最小多语言机制（M11-01，业主 2026-11-15：新功能先只做中文，文案走 key；M11-02 能从代码导出清单）。
 *
 * - 每个模块一本文案（`messages/<模块>.ts`，`defineMessages("模块名", { key: "中文" })`），在 `messages/index.ts` 登记一行；
 * - 页面里用 `t("模块名.key", { 参数 })`，文案里的参数写成 `{name}`；
 * - 现在只有中文；以后补日文、英文时写进同一本的 `ja` / `en`，缺的那一条自动退回中文；
 * - 不引入第三方库。嵌入组件（`embed/widget-core.ts` 的 `TEXTS`）有自己的三语表和体积预算，不并进来；主站已有的日文、英文文案不动。
 */

export const LANGS = ["zh", "ja", "en"] as const;
export type Lang = (typeof LANGS)[number];

export type MessageParams = Readonly<Record<string, string | number>>;

/** 一本文案：模块名、中文（必有）、日文和英文（可缺，缺了退回中文） */
export interface MessageBook<K extends string> {
  readonly ns: string;
  readonly zh: Readonly<Record<K, string>>;
  readonly ja: Readonly<Partial<Record<K, string>>>;
  readonly en: Readonly<Partial<Record<K, string>>>;
}

/** 定义一本文案。模块名和 key 都用小驼峰（如 `freeWait`、`previewChange`），只含字母和数字。 */
export function defineMessages<K extends string>(ns: string, zh: Record<K, string>, translations: { ja?: Partial<Record<K, string>>; en?: Partial<Record<K, string>> } = {}): MessageBook<K> {
  const none: Partial<Record<K, string>> = {};
  return { ns, zh, ja: translations.ja ?? none, en: translations.en ?? none };
}

let current: Lang = "zh";

/** 现在用哪种语言（开发期一直是中文；多语言上线时由页面按访客选择设置） */
export function currentLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/** 把 `{name}` 换成参数；文案里有、参数里没给的原样留着，方便一眼看出漏传 */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** 从一本文案里按语言取一条：缺的语言退回中文 */
export function lookup<K extends string>(book: MessageBook<K>, key: K, lang: Lang = current): string {
  return (lang === "zh" ? undefined : book[lang][key]) ?? book.zh[key];
}
