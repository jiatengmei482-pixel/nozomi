/**
 * 嵌入组件脚本的单独构建（M9E-03，ADR 0090 第四节）：`src/embed/widget.ts` → `dist/embed/widget-v1.js`（一个 IIFE 文件，全局名 NozomiBooking）。
 * 在主前端构建之后跑（不清空 dist）。gzip 后超过预算就让构建失败。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";
import { widgetSizeProblem } from "./src/embed/widget-size.ts";

const outDir = fileURLToPath(new URL("./dist/embed", import.meta.url));

function sizeBudget(): Plugin {
  return {
    name: "nozomi:widget-size-budget",
    closeBundle() {
      const problem = widgetSizeProblem(readFileSync(`${outDir}/widget-v1.js`));
      if (problem !== null) throw new Error(problem);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [sizeBudget()],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    lib: { entry: fileURLToPath(new URL("./src/embed/widget.ts", import.meta.url)), name: "NozomiBooking", formats: ["iife"], fileName: () => "widget-v1.js" },
  },
});
