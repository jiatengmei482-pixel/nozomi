/**
 * 「只引用令牌」的补充静态检查：styles.test.ts 只看了几种属性的整条声明，这里补上它看不到的写法——
 * 简写属性里夹带的颜色（border / outline / box-shadow / background 简写里的颜色名）、
 * 颜色关键字、font 简写、calc() 里的字号、组件代码里的内联样式和 SVG 颜色、
 * 以及 index.html 的内联脚本和对外部资源的引用。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const STYLES_DIR = new URL("./", import.meta.url);
const SRC_DIR = new URL("../", import.meta.url);

async function styleSheets(): Promise<{ name: string; css: string }[]> {
  const names = (await readdir(STYLES_DIR)).filter((name) => name.endsWith(".css"));
  return Promise.all(names.map(async (name) => ({ name, css: (await readFile(new URL(name, STYLES_DIR), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "") })));
}

async function sourceFiles(dir: URL): Promise<{ name: string; text: string }[]> {
  const found: { name: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir);
    if (entry.isDirectory()) {
      if (entry.name !== "testing") found.push(...(await sourceFiles(url)));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push({ name: url.pathname.slice(SRC_DIR.pathname.length), text: await readFile(url, "utf8") });
    }
  }
  return found;
}

const sheets = await styleSheets();
const sources = await sourceFiles(SRC_DIR);
const indexHtml = await readFile(new URL("../../index.html", import.meta.url), "utf8");

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function allDeclarations(css: string): { property: string; value: string }[] {
  return [...css.matchAll(/(?<![\w-])([a-z-]+)\s*:\s*([^;{}]+);/g)].map((match) => ({ property: match[1] ?? "", value: (match[2] ?? "").trim() }));
}

/** CSS 的颜色关键字（常用的全部 + 系统色）。transparent / currentColor / inherit 是规范允许的。 */
const COLOR_KEYWORDS =
  /(?<![\w-])(black|white|red|green|blue|yellow|orange|purple|pink|brown|gray|grey|silver|gold|navy|teal|aqua|cyan|magenta|fuchsia|lime|maroon|olive|indigo|violet|coral|crimson|salmon|tomato|khaki|beige|ivory|lavender|turquoise|tan|orchid|plum|snow|azure|linen|wheat|peru|sienna|chocolate|firebrick|darkred|darkblue|darkgreen|darkgray|darkgrey|lightgray|lightgrey|lightblue|lightgreen|dimgray|dimgrey|gainsboro|whitesmoke|slategray|slategrey|royalblue|steelblue|skyblue|dodgerblue|midnightblue|rebeccapurple|canvas|canvastext|linktext|visitedtext|buttonface|buttontext|field|fieldtext|highlight|highlighttext|graytext|accentcolor|accentcolortext)(?![\w-])/i;

test("确认检查读到了东西：样式文件和组件文件都在", () => {
  assert.ok(sheets.length >= 5, `只找到 ${sheets.length} 个样式文件`);
  assert.ok(sources.length >= 20, `只找到 ${sources.length} 个源文件`);
  assert.ok(sources.some((file) => file.name === "components/Icon.tsx"));
  assert.ok(sheets.reduce((count, sheet) => count + allDeclarations(sheet.css).length, 0) > 500);
});

test("任何属性的值里都没有颜色关键字、十六进制颜色、颜色函数（包括 border / outline / box-shadow / background 这些简写）", () => {
  for (const { name, css } of sheets) {
    if (name === "tokens.css") continue;
    for (const { property, value } of allDeclarations(css)) {
      if (property === "white-space" || property === "content" || property === "font-family") continue;
      assert.doesNotMatch(value, COLOR_KEYWORDS, `${name}：${property}: ${value} 里有颜色关键字`);
      assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}(?![\w-])/, `${name}：${property}: ${value} 里有十六进制颜色`);
      assert.doesNotMatch(value, /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\(/i, `${name}：${property}: ${value} 里有颜色函数`);
    }
  }
});

test("所有带颜色的属性（含各边的 border-*-color、caret / accent / 文字装饰 / 列分隔线颜色、SVG 的 stop / flood）只用颜色令牌", () => {
  const colorProperty = /(^|-)color$|^(fill|stroke)$/;
  let checked = 0;
  for (const { name, css } of sheets) {
    if (name === "tokens.css") continue;
    for (const { property, value } of allDeclarations(css)) {
      if (!colorProperty.test(property) || property.startsWith("--")) continue;
      assert.match(value, /^(var\(--color-[a-z-]+\)|transparent|currentColor|inherit)$/, `${name}：${property}: ${value} 不是颜色令牌`);
      checked += 1;
    }
  }
  assert.ok(checked > 50);
});

test("简写属性里的边框宽度、阴影、时长也只用令牌", () => {
  for (const { name, css } of sheets) {
    if (name === "tokens.css") continue;
    for (const { property, value } of allDeclarations(css)) {
      if (/^(border|border-(top|right|bottom|left|block|inline)(-(start|end))?|outline)$/.test(property)) {
        assert.match(
          value,
          /^(0|none|var\(--(border-width|focus-ring-width)\) solid( (var\(--color-[a-z-]+\)|transparent|currentColor))?)$/,
          `${name}：${property}: ${value} 应写成「令牌宽度 solid 颜色令牌」`,
        );
      }
      if (property === "transition" || property === "transition-duration") {
        assert.doesNotMatch(value, /(?<![\w-])\d*\.?\d+m?s(?![\w-])/, `${name}：${property}: ${value} 里写死了时长，应使用 --duration-* 令牌`);
      }
      if (property === "font") assert.equal(value, "inherit", `${name}：font 简写只能是 inherit，否则会绕过字号、字重、行高令牌`);
      if (property === "font-size") assert.doesNotMatch(value, /calc\(|\d(px|rem|em|%|pt|vw)/, `${name}：font-size: ${value} 写死了字号`);
      if (property === "z-index") assert.doesNotMatch(value, /\d/, `${name}：z-index: ${value} 写死了层级`);
    }
  }
});

test("组件代码里没有内联样式、没有写死的颜色，SVG 图标的颜色跟随文字（currentColor）", () => {
  for (const { name, text } of sources) {
    assert.doesNotMatch(text, /\bstyle=\{/, `${name} 用了内联样式`);
    assert.doesNotMatch(text, /\.style\.[a-zA-Z]+\s*=|\.style\.setProperty\(|cssText/, `${name} 用脚本改样式`);
    assert.doesNotMatch(text, /["'`]#[0-9a-fA-F]{3,8}["'`]/, `${name} 里有十六进制颜色`);
    assert.doesNotMatch(text, /(?<![\w-])(rgba?|hsla?|oklch)\(/, `${name} 里有颜色函数`);
    for (const match of text.matchAll(/\b(fill|stroke|stopColor|floodColor|color)=(?:"([^"]*)"|\{"([^"]*)"\})/g)) {
      const value = match[2] ?? match[3] ?? "";
      assert.match(value, /^(none|currentColor)$/, `${name}：${match[1]}="${value}" 写死了颜色`);
    }
  }
});

test("组件代码不把字符串当 HTML 用，不用 eval，不留调试输出和没有任务编号的 TODO", () => {
  for (const { name, text } of sources) {
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\(/, `${name} 把字符串当 HTML 插入页面`);
    assert.doesNotMatch(text, /\beval\(|new Function\(/, `${name} 用了 eval`);
    assert.doesNotMatch(text, /\bconsole\.(log|debug|info|warn|error|trace)\(|\bdebugger\b/, `${name} 留了调试输出`);
    for (const match of text.matchAll(/\b(TODO|FIXME|XXX|HACK)\b(.*)/g)) {
      assert.match(match[2] ?? "", /M\d+-\d+/, `${name}：${match[0].trim()} 没有跟任务编号`);
    }
  }
});

const EXTERNAL_LINK_REGISTRY = "lib/external-links.ts";
const EXTERNAL_LINK_COMPONENT = "components/ExternalLink.tsx";
const AREA_DRAFT_STORE = "lib/area-draft.ts";

test("令牌不进 localStorage、不进 Cookie、不进网址：只有主题用 localStorage，登录状态只用 sessionStorage", () => {
  for (const { name, text: withComments } of sources) {
    const text = stripComments(withComments);
    if (/\blocalStorage\b/.test(text)) assert.equal(name, "theme/theme.ts", `${name} 用了 localStorage`);
    // 例外只有一个：区域编辑页的草稿（lib/area-draft.ts，负责人批准的最小放行；下面另有一条核对它只碰自己的键）
    if (/\bsessionStorage\b/.test(text)) assert.ok(name === "auth/session-store.ts" || name === AREA_DRAFT_STORE, `${name} 用了 sessionStorage`);
    assert.doesNotMatch(text, /document\.cookie|indexedDB|BroadcastChannel|postMessage\(/, `${name} 用了别的存放或传递途径`);
    assert.doesNotMatch(text, /[?&](token|access_token|password)=/, `${name} 把令牌或密码拼进了查询串`);
    assert.doesNotMatch(text, /window\.open\(/, `${name} 打开新窗口（会带出 opener / Referer）`);
    // 新标签页打开的链接只允许出现在专用的站外链接组件里
    if (name !== EXTERNAL_LINK_COMPONENT) assert.doesNotMatch(text, /target="_blank"/, `${name} 打开新窗口（会带出 opener / Referer）`);
  }
});

test("区域草稿只用自己的键前缀：不读写登录状态的键，草稿里没有令牌", () => {
  const store = sources.find((source) => source.name === AREA_DRAFT_STORE);
  assert.ok(store, `找不到 ${AREA_DRAFT_STORE}`);
  const text = stripComments(store.text);
  const prefixes = [...text.matchAll(/["'`](nozomi\.[^"'`$]*)/g)].map((match) => match[1]);
  assert.deepEqual(prefixes, ["nozomi.area-draft."], "这个文件里只能有草稿自己的键前缀");
  assert.doesNotMatch(text, /session-store|accessToken|access_token|token/i, "草稿不碰登录状态和令牌");
  // 每一次读、写、删都经过 draftKey（它只生成这个前缀下的键）或先按前缀筛过
  assert.equal((text.match(/\.(getItem|setItem|removeItem)\(/g) ?? []).length, 4);
  assert.match(text, /getItem\(key\)/);
  assert.match(text, /setItem\(key, raw\)/);
  assert.match(text, /removeItem\(key\)/);
  assert.match(text, /key\.startsWith\(DRAFT_PREFIX\)/);
  assert.match(text, /return `\$\{DRAFT_PREFIX\}\$\{owner\.tenantId\}\.\$\{owner\.userId\}\.\$\{area\}`;/);
});

test("站外链接组件写死了 noopener noreferrer：对方页面拿不到本站窗口，也看不到来源地址", () => {
  const component = sources.find((source) => source.name === EXTERNAL_LINK_COMPONENT);
  assert.ok(component, `找不到 ${EXTERNAL_LINK_COMPONENT}`);
  const text = stripComments(component.text);
  const opens = text.match(/target="_blank"/g) ?? [];
  assert.equal(opens.length, 1);
  assert.match(text, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(text, /rel=\{/, "rel 不能由调用方传入");
  assert.match(text, /href=\{EXTERNAL_LINKS\[to\]\}/, "地址只能来自登记的清单");
});

test("站外地址只登记在 lib/external-links.ts：恰好是预期的三个，都是 https", () => {
  const registry = sources.find((source) => source.name === EXTERNAL_LINK_REGISTRY);
  assert.ok(registry, `找不到 ${EXTERNAL_LINK_REGISTRY}`);
  const urls = [...stripComments(registry.text).matchAll(/["'](https?:\/\/[^"']+)["']/g)].map((match) => match[1]).sort();
  assert.deepEqual(urls, ["https://creativecommons.org/licenses/by/4.0/", "https://ourairports.com/data/", "https://www.geonames.org/"]);
});

test("前端只用相对路径调接口：代码里没有写死的站点地址、没有环境变量", () => {
  for (const { name, text } of sources) {
    const withoutComments = stripComments(text);
    // 站外地址只允许集中登记在这一个文件里（下面另有一条核对它的内容）
    if (name !== EXTERNAL_LINK_REGISTRY) assert.doesNotMatch(withoutComments, /https?:\/\//, `${name} 里有写死的网址`);
    assert.doesNotMatch(withoutComments, /import\.meta\.env|process\.env/, `${name} 读了环境变量；密钥和配置不能进前端产物`);
  }
});

test("index.html：不加载任何外部资源，不限制缩放，全站不带 Referer", () => {
  assert.doesNotMatch(indexHtml, /(src|href)\s*=\s*["'](https?:)?\/\//i, "index.html 引用了外部地址");
  assert.doesNotMatch(indexHtml, /<link[^>]+rel=["'](preconnect|dns-prefetch|stylesheet)["'][^>]+https?:/i);
  assert.doesNotMatch(indexHtml, /maximum-scale|user-scalable\s*=\s*(no|0)/i, "不能禁止用户放大");
  assert.match(indexHtml, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(indexHtml, /<meta name="color-scheme" content="light dark" \/>/);
  assert.equal([...indexHtml.matchAll(/<script\b/g)].length, 2, "只有一段主题内联脚本和一个应用入口");
});

function inlineThemeScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  assert.ok(match?.[1], "index.html 里没有找到内联脚本");
  return match[1];
}

/** 在一个假的页面环境里跑内联脚本，返回 <html> 上最后的 data-theme。 */
function runThemeScript(storage: unknown): { theme: unknown; attributes: string[] } {
  const dataset: Record<string, unknown> = {};
  const documentElement = { dataset };
  runInNewContext(inlineThemeScript(), { localStorage: storage, document: { documentElement } });
  return { theme: dataset["theme"], attributes: Object.keys(dataset) };
}

test("index.html 的内联主题脚本：存的是 light / dark 才生效", () => {
  assert.equal(runThemeScript({ getItem: () => "dark" }).theme, "dark");
  assert.equal(runThemeScript({ getItem: () => "light" }).theme, "light");
  assert.deepEqual(runThemeScript({ getItem: () => null }).attributes, []);
});

test("index.html 的内联主题脚本：本地存储里的值被改成别的东西时不设任何属性，也不抛错", () => {
  const tampered: unknown[] = [
    "",
    "system",
    "DARK",
    " dark",
    "dark ",
    "dark\n",
    '"dark"',
    "dark light",
    '"><script>alert(1)</script>',
    "dark\" onload=\"alert(1)",
    "javascript:alert(1)",
    "__proto__",
    "constructor",
    "x".repeat(1_000_000),
    0,
    1,
    true,
    {},
    [],
    ["dark"],
    { toString: () => "dark" },
    undefined,
  ];
  for (const value of tampered) {
    const result = runThemeScript({ getItem: () => value });
    assert.deepEqual(result.attributes, [], `存的是 ${typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : String(value)} 时不应设置 data-theme`);
  }
});

test("index.html 的内联主题脚本：本地存储不可用（抛错、不存在、是 null）时安静地跳过，不影响后面的应用脚本", () => {
  const broken: unknown[] = [
    {
      getItem: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    },
    null,
    undefined,
    {},
    { getItem: "not a function" },
  ];
  for (const storage of broken) assert.doesNotThrow(() => runThemeScript(storage));
  const throwingGetter = Object.defineProperty({}, "localStorage", {
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
  assert.doesNotThrow(() => runInNewContext(`with (host) { ${inlineThemeScript()} }`, { host: throwingGetter, document: { documentElement: { dataset: {} } } }));
});

test("index.html 的内联主题脚本：只读一个键、只写 data-theme，不碰别的", () => {
  const read: string[] = [];
  const script = inlineThemeScript();
  runThemeScript({
    getItem: (key: string) => {
      read.push(key);
      return "dark";
    },
  });
  assert.deepEqual(read, ["nozomi.theme"]);
  assert.doesNotMatch(script, /innerHTML|document\.write|eval|setAttribute|className|sessionStorage|cookie|fetch|location/);
});
