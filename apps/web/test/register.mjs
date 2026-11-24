// 组件测试的预加载脚本（node --import）：
// 1. Node 只会擦除 .ts 的类型，不认识 JSX；这里用仓库已有的 TypeScript 把 .tsx 转成 JS 再交给 Node。
// 2. 注册一个最小的浏览器环境（happy-dom），必须早于 React 和测试库被加载。
// 3. 把测试库 findBy* / waitFor 的统一等待上限从默认 1 秒放宽到 5 秒（M8-29b）。
//    机器忙时（CI 并行、本机多个会话同时跑测试），「保存 → 跳页 → 渲染列表」这类一步要 450–900 ms 墙上时间，
//    默认 1 秒会被 CPU 抢占顶过而误报；条件一满足就立即返回，正常情况下不会变慢。这是全局上限，不给单条测试另加等待。
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import ts from "typescript";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
      fileName,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        verbatimModuleSyntax: true,
        inlineSourceMap: true,
        inlineSources: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});

GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { configure } = await import("@testing-library/dom");
configure({ asyncUtilTimeout: 5000 });
