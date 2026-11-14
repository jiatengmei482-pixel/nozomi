/**
 * 嵌入预订页的外观（M9E-17，ADR 0095 第四节第 1 小节、Q15）：和嵌入组件共用 --nzb-* 这套变量（命名同 widget-style.ts，默认值取自主站令牌、
 * 颜色和组件写死的默认值一样）；复用的主站组件在嵌入页里取 --nzb-*；embed.css 的规则不直接写颜色、字体、圆角；
 * 传给 Stripe appearance 的取值在嵌入页只读 --nzb-*，主站那一套不变。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WIDGET_CSS } from "../embed/widget-style.ts";
import { EMBED_APPEARANCE_TOKENS, SITE_APPEARANCE_TOKENS } from "../lib/payment-driver.ts";

const css = (await readFile(new URL("./embed.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = await readFile(new URL("../../../../docs/design/tokens.css", import.meta.url), "utf8");
const lightTokens = /:root \{([^}]*)\}/.exec(tokens)?.[1] ?? "";

const declarationsOf = (block: string): Map<string, string> => new Map([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]));
const root = declarationsOf(/:root\[data-embed-book\] \{([^}]*)\}/.exec(css)?.[1] ?? "");
const widget = declarationsOf(/\.nzb-shell \{([^}]*)\}/.exec(WIDGET_CSS)?.[1] ?? "");
const light = declarationsOf(lightTokens);

/** 沿着 var() 一路解到底（按给的几张表依次找） */
function resolve(value: string, maps: readonly Map<string, string>[], depth = 0): string {
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
  const next = ref === undefined ? undefined : maps.map((map) => map.get(ref)).find((found) => found !== undefined);
  return next === undefined || depth > 5 ? value : resolve(next, maps, depth + 1);
}

test("--nzb-* 的命名都是组件里有的；颜色的默认值（取自主站令牌）和组件写死的一样", () => {
  const names = [...root.keys()].filter((name) => name.startsWith("--nzb-"));
  assert.ok(names.length >= 6);
  for (const name of names) assert.ok(widget.has(name), `组件里没有 ${name}`);
  for (const name of ["--nzb-light", "--nzb-dark", "--nzb-primary", "--nzb-on-primary", "--nzb-ink"]) {
    assert.equal(resolve(root.get(name) ?? "", [root, light]).toLowerCase(), resolve(widget.get(name) ?? "", [widget]).toLowerCase(), name);
  }
});

test("复用的主站组件在嵌入页里取 --nzb-*：主色、主色上的文字、控件圆角", () => {
  assert.equal(root.get("--color-primary"), "var(--nzb-primary)");
  assert.equal(root.get("--color-on-primary"), "var(--nzb-on-primary)");
  assert.equal(root.get("--radius-md"), "var(--nzb-radius-control)");
});

test("embed.css 的规则不直接写颜色、字体、圆角（从改过的令牌继承）；一直单栏", () => {
  const rules = css.replace(/:root\[data-embed-book\] \{[^}]*\}/, "");
  assert.doesNotMatch(rules, /(^|[;{\s])(color|background(-color)?|border-color|font-family|border-radius)\s*:/);
  assert.match(rules, /\.embed-book \.book-new \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/);
});

test("Stripe appearance：嵌入页只读 --nzb-*，而且读的都在嵌入页定义了；主站仍读设计令牌（ADR 0046，逐项不变）", () => {
  const embedNames = [...EMBED_APPEARANCE_TOKENS.variables, ...Object.values(EMBED_APPEARANCE_TOKENS.rules).flat()].map(([, name]) => name);
  for (const name of embedNames) {
    assert.match(name, /^--nzb-/, name);
    assert.ok(root.has(name), `${name} 在嵌入页没有定义`);
  }
  assert.deepEqual(
    SITE_APPEARANCE_TOKENS.variables.map(([key, name]) => `${key}=${name}`),
    ["colorPrimary=--color-primary", "colorBackground=--color-bg-surface", "colorText=--color-text-primary", "colorTextSecondary=--color-text-secondary", "colorTextPlaceholder=--color-text-tertiary", "colorDanger=--color-danger-text", "fontFamily=--font-family-sans", "fontSizeBase=--font-size-lg", "borderRadius=--radius-md"],
  );
});
