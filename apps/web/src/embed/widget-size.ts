/**
 * 嵌入组件脚本的大小预算（M9E-03，ADR 0090 第四节）：gzip 后不超过 60 KB。构建时由 vite.widget.config.ts 调用，超了构建失败。
 * 只在构建（Node）里用，不打进组件脚本。
 */
import { gzipSync } from "node:zlib";
import { WIDGET_GZIP_BUDGET } from "./widget-core.ts";

export function widgetSizeProblem(source: string | Uint8Array, budget = WIDGET_GZIP_BUDGET): string | null {
  const size = gzipSync(source).length;
  return size > budget ? `嵌入组件脚本 gzip 后 ${size} 字节，超过预算 ${budget} 字节` : null;
}
