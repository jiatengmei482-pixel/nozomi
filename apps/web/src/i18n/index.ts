/**
 * 页面里取文案：`t("freeWait.previewChange", { from: "60", to: "90 分钟" })`。key 写错了类型检查就报错。
 * 机制见 `i18n.ts`，用法见 docs/dev/i18n.md（M11-01）。
 */
import { type MessageParams, currentLang, formatMessage, lookup } from "./i18n.ts";
import { MESSAGE_BOOKS } from "./messages/index.ts";

type Books = typeof MESSAGE_BOOKS;

/** 全部 key：`模块名.key` */
export type MessageKey = { [N in keyof Books]: `${N & string}.${keyof Books[N]["zh"] & string}` }[keyof Books];

export function t(key: MessageKey, params?: MessageParams): string {
  const dot = key.indexOf(".");
  const book = MESSAGE_BOOKS[key.slice(0, dot) as keyof Books] as { zh: Record<string, string>; ja: Partial<Record<string, string>>; en: Partial<Record<string, string>>; ns: string };
  return formatMessage(lookup(book, key.slice(dot + 1), currentLang()), params);
}

export { type Lang, LANGS, currentLang, setLang } from "./i18n.ts";
