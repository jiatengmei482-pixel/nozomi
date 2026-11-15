/**
 * 所有文案本的登记处（M11-01）：新加一本就在这里加一行。`t()` 的 key 类型、`pnpm copy:export` 的清单都从这里来。
 * 用法见 docs/dev/i18n.md。
 */
import { freeWait } from "./free-wait.ts";

export const MESSAGE_BOOKS = {
  freeWait,
} as const;
