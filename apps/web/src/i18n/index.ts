/**
 * 页面里取文案：`t("freeWait.previewChange", { from: 60, to: "90 分钟" })`。
 * key 写错、参数漏传或多传（参数表从文案里的 `{name}` 推出来），类型检查都报错。key 必须写成字面量，导出清单按原文搜。
 * 机制见 `i18n.ts`，用法见 docs/dev/i18n.md（M11-01）。
 */
import { type MessageParams, type ParamsArg, currentLang, formatMessage, lookup } from "./i18n.ts";
import { MESSAGE_BOOKS } from "./messages/index.ts";

type Books = typeof MESSAGE_BOOKS;

/** 全部 key：`模块名.key` */
export type MessageKey = { [N in keyof Books]: `${N & string}.${keyof Books[N]["zh"] & string}` }[keyof Books];

/** 一个 key 的中文原文（字面量类型） */
type TemplateOf<K extends MessageKey> = K extends `${infer N}.${infer Key}` ? (N extends keyof Books ? (Key extends keyof Books[N]["zh"] ? Books[N]["zh"][Key] & string : never) : never) : never;

export function t<K extends MessageKey>(key: K, ...params: ParamsArg<TemplateOf<K>>): string {
  const dot = key.indexOf(".");
  const book = MESSAGE_BOOKS[key.slice(0, dot) as keyof Books];
  return formatMessage(lookup(book, key.slice(dot + 1) as keyof typeof book.zh & string, currentLang()), params[0] as MessageParams | undefined);
}

export { type Lang, LANGS, currentLang, setLang } from "./i18n.ts";
