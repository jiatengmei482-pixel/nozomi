/**
 * 样式的静态检查：只用设计令牌，不写死颜色、字号、层级；媒体查询只用规范允许的写法；
 * 不用 100vw / 100vh，不在 html / body 上藏横向溢出。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const STYLES_DIR = new URL("./", import.meta.url);
const TOKENS_URL = new URL("../../../../docs/design/tokens.css", import.meta.url);

async function styleSheets(): Promise<{ name: string; css: string }[]> {
  const names = (await readdir(STYLES_DIR)).filter((name) => name.endsWith(".css"));
  return Promise.all(
    names.map(async (name) => ({
      name,
      css: (await readFile(new URL(name, STYLES_DIR), "utf8")).replace(/\/\*[\s\S]*?\*\//g, ""),
    })),
  );
}

const sheets = await styleSheets();
const tokens = await readFile(TOKENS_URL, "utf8");

function declarations(css: string, property: RegExp): string[] {
  return [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].filter((match) => property.test(match[1] ?? "")).map((match) => (match[2] ?? "").trim());
}

test("令牌文件只引入不复制：apps/web 里的 tokens.css 只有一行 @import", () => {
  const entry = sheets.find((sheet) => sheet.name === "tokens.css");
  assert.equal(entry?.css.trim(), '@import "../../../../docs/design/tokens.css";');
  assert.ok(sheets.find((sheet) => sheet.name === "index.css")?.css.trim().startsWith('@import "./tokens.css";'));
});

test("样式里没有写死的颜色", () => {
  for (const { name, css } of sheets) {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${name} 里有十六进制颜色`);
    assert.doesNotMatch(css, /\b(rgba?|hsla?|oklch|oklab|color-mix)\(/, `${name} 里有颜色函数`);
    for (const value of declarations(css, /^(color|background|background-color|border-color|outline-color|fill|stroke)$/)) {
      assert.match(value, /^(var\(--color-[a-z-]+\)|transparent|currentColor|inherit)$/, `${name}：颜色值 ${value} 不是令牌`);
    }
  }
});

test("字号、字重、行高、层级、圆角、阴影只引用令牌", () => {
  const rules: [RegExp, RegExp][] = [
    [/^font-size$/, /^var\(--(font-size-[a-z0-9]+|control-font-size)\)$/],
    [/^font-weight$/, /^var\(--font-weight-[a-z]+\)$/],
    [/^line-height$/, /^var\(--line-height-[a-z]+\)$/],
    [/^z-index$/, /^var\(--z-[a-z]+\)$/],
    [/^border-radius$/, /^var\(--radius-[a-z]+\)$/],
    [/^box-shadow$/, /^var\(--shadow-[a-z]+\)$/],
    [/^font-family$/, /^var\(--font-family-[a-z-]+\)$/],
  ];
  for (const { name, css } of sheets) {
    for (const [property, allowed] of rules) {
      for (const value of declarations(css, property)) assert.match(value, allowed, `${name}：${property.source} 的值 ${value} 不是令牌`);
    }
  }
});

/**
 * 不是设计令牌、由页面脚本量出来的尺寸变量（只能是长度，不能是颜色、字号）。每加一个都要在对应页面规范里写明：
 * --driver-bar-height：司机页吸底按钮条的实际高度（docs/design/pages/driver.md 3b，M6-08）。
 */
const MEASURED_VARIABLES = new Set(["--driver-bar-height"]);

test("引用的每个令牌都在 docs/design/tokens.css 里定义过", () => {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]).concat([...MEASURED_VARIABLES]));
  for (const { name, css } of sheets) {
    for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      assert.ok(defined.has(match[1]), `${name} 引用了不存在的令牌 ${match[1]}`);
    }
  }
});

test("媒体查询只用 min-width 加令牌里的断点，或 hover / pointer / reduced-motion", () => {
  const breakpoints = [...tokens.matchAll(/--breakpoint-[a-z0-9]+:\s*(\d+px)/g)].map((match) => match[1]);
  assert.ok(breakpoints.length >= 5);
  const allowed = new Set([
    ...breakpoints.map((value) => `(min-width: ${value})`),
    "(hover: hover)",
    "(pointer: coarse)",
    "(prefers-reduced-motion: reduce)",
  ]);
  for (const { name, css } of sheets) {
    for (const match of css.matchAll(/@media\s+([^{]+)\{/g)) {
      const condition = (match[1] ?? "").trim();
      assert.ok(allowed.has(condition), `${name}：不允许的媒体查询 ${condition}`);
    }
  }
});

test("不用 100vw / 100vh，不去掉聚焦环，不在 html / body 上藏横向溢出", () => {
  for (const { name, css } of sheets) {
    assert.doesNotMatch(css, /\b100vw\b|\b100vh\b/, `${name} 用了 100vw 或 100vh`);
    assert.doesNotMatch(css, /overflow-x\s*:\s*hidden/, `${name} 用了 overflow-x: hidden`);
    assert.doesNotMatch(css, /(^|\})\s*(html|body)[^{]*\{[^}]*overflow\s*:\s*hidden/, `${name} 在 html / body 上藏溢出`);
    for (const hidden of hiddenFocusRings(css)) assert.fail(`${name}：${hidden.selector} 用 ${hidden.declaration} 藏了聚焦环`);
  }
});

/**
 * 藏聚焦环的写法（docs/design/01-tokens.md 第 5 节）：outline: none / 0 / … transparent、outline-style: none、outline-width: 0、outline-color: transparent。
 * 只有两个选择器可以（整串相等）：换页后的正文区，和分步配置里鼠标 / 触屏换步后的步骤标题（M6-10）。
 */
const FOCUS_RING_EXCEPTIONS = new Set(["main:focus", '.step__title[tabindex="-1"][data-focus-source="pointer"]:focus']);
const ZERO_LENGTH = /^[+-]?0*\.?0+[a-z%]*$/i;

function hidesFocusRing(property: string, value: string): boolean {
  const words = value.replace(/!important$/i, "").trim().toLowerCase().split(/\s+(?![^(]*\))/);
  switch (property) {
    case "outline":
      return words.some((word) => word === "none" || word === "hidden" || word === "transparent" || ZERO_LENGTH.test(word));
    case "outline-style":
      return words.some((word) => word === "none" || word === "hidden");
    case "outline-width":
      return words.some((word) => ZERO_LENGTH.test(word));
    case "outline-color":
      return words.includes("transparent");
    default:
      return false;
  }
}

function hiddenFocusRings(css: string): { selector: string; declaration: string }[] {
  const found: { selector: string; declaration: string }[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] ?? "").trim().replace(/\s+/g, " ");
    if (FOCUS_RING_EXCEPTIONS.has(selector)) continue;
    for (const match of (rule[2] ?? "").matchAll(/([a-z-]+)\s*:\s*([^;]+)/gi)) {
      const property = (match[1] ?? "").toLowerCase();
      const value = (match[2] ?? "").trim();
      if (hidesFocusRing(property, value)) found.push({ selector, declaration: `${property}: ${value}` });
    }
  }
  return found;
}

test("藏聚焦环的检查：两个例外整串放行，别的选择器用任何写法藏环都拦下", () => {
  assert.deepEqual(hiddenFocusRings("main:focus { outline: none; }"), []);
  assert.deepEqual(hiddenFocusRings('.step__title[tabindex="-1"][data-focus-source="pointer"]:focus {\n  outline: none;\n}'), []);
  for (const declaration of ["outline: none", "outline: 0", "outline: 0px", "outline-style: none", "outline-style: hidden", "outline-width: 0", "outline-width: 0px", "outline-color: transparent", "outline: 2px solid transparent", "outline: var(--focus-ring-width) solid transparent", "outline: none !important"]) {
    assert.equal(hiddenFocusRings(`.button:focus-visible { color: inherit; ${declaration}; }`).length, 1, `${declaration} 应当被拦下`);
  }
  // 例外只认整串：前缀、多一个选择器、换成键盘 / 不知道的标记、去掉 tabindex 都不行
  for (const selector of ["main:focus-visible", "main:focus, .button:focus", ".step__title:focus", '.step__title[data-focus-source="pointer"]:focus', '.step__title[tabindex="-1"][data-focus-source="keyboard"]:focus', '.step__title[tabindex="-1"][data-focus-source="pointer"]:focus, .link:focus', '.page .step__title[tabindex="-1"][data-focus-source="pointer"]:focus']) {
    assert.equal(hiddenFocusRings(`${selector} { outline: none; }`).length, 1, `${selector} 不在例外里`);
  }
  // 媒体查询里面的规则一样检查；画环的写法不算藏
  assert.equal(hiddenFocusRings("@media (min-width: 1024px) {\n  .x:focus { outline-width: 0; }\n}").length, 1);
  assert.deepEqual(hiddenFocusRings(".x:focus-visible { outline: var(--focus-ring-width) solid var(--color-border-focus); outline-offset: var(--focus-ring-offset); outline-color: var(--color-on-brand); }"), []);
});

test("分步配置的步骤标题：鼠标的不画框，键盘和拿不准的强制画 2px 环（M6-10）", () => {
  const css = sheets.find((sheet) => sheet.name === "products.css")?.css ?? "";
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({ selector: (rule[1] ?? "").trim().replace(/\s+/g, " "), body: (rule[2] ?? "").replace(/\s+/g, " ").trim() }));
  assert.ok(rules.some((rule) => rule.selector === '.step__title[tabindex="-1"][data-focus-source="pointer"]:focus' && rule.body === "outline: none;"));
  assert.ok(rules.some((rule) => rule.selector === '.step__title[tabindex="-1"][data-focus-source="keyboard"]:focus, .step__title[tabindex="-1"][data-focus-source="unknown"]:focus' && rule.body === "outline: var(--focus-ring-width) solid var(--color-border-focus); outline-offset: var(--focus-ring-offset);"));
  const others = rules.filter((rule) => rule.selector.includes("data-focus-source"));
  assert.equal(others.length, 2, "data-focus-source 只用在规范给的这两条规则里");
});
