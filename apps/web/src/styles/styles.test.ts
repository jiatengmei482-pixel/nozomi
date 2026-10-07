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

test("引用的每个令牌都在 docs/design/tokens.css 里定义过", () => {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
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
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*outline\s*:\s*none[^{}]*)\}/g)) {
      assert.match((rule[1] ?? "").trim(), /^main:focus$/, `${name}：${(rule[1] ?? "").trim()} 去掉了聚焦环`);
    }
  }
});
