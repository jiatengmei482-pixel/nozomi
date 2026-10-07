// 组件测试的预加载脚本（node --import）：
// 1. Node 只会擦除 .ts 的类型，不认识 JSX；这里用仓库已有的 TypeScript 把 .tsx 转成 JS 再交给 Node。
// 2. 注册一个最小的浏览器环境（happy-dom），必须早于 React 和测试库被加载。
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
