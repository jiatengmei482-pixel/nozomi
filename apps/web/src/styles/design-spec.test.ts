/**
 * 设计规范自身的一致性（验收标准 1：docs/design 写明颜色、字体、间距、组件规范，亮色和暗色）：
 * - 规范文件齐全，各自写了该写的内容；
 * - 01-tokens.md 里抄的每个数值与 tokens.css 相同；对比度表与 contrast-check.mjs 现算的结果相同；
 * - contrast-check.mjs 能通过，并且颜色被改坏时确实会失败；
 * - 亮、暗两套颜色令牌齐全，手动指定亮色能盖过系统暗色。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const DESIGN_DIR = fileURLToPath(new URL("../../../../docs/design/", import.meta.url));
const read = (name: string): Promise<string> => readFile(join(DESIGN_DIR, name), "utf8");

const tokensCss = await read("tokens.css");
const tokensDoc = await read("01-tokens.md");

function declarations(block: string): Map<string, string> {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map([...withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]));
}

function blockAfter(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `tokens.css 里找不到 ${selector}`);
  const open = css.indexOf("{", start);
  return declarations(css.slice(open + 1, css.indexOf("}", open)));
}

const light = blockAfter(tokensCss, ":root {");
const darkSystem = blockAfter(tokensCss, ':root:not([data-theme="light"])');
const darkManual = blockAfter(tokensCss, ':root[data-theme="dark"]');

/** 把令牌值换算成文档里的写法：rem 换成 px（1rem = 16px），其余原样。 */
function asDocumented(value: string): string {
  const rem = /^([\d.]+)rem$/.exec(value);
  return rem ? `${Number(rem[1]) * 16}px` : value;
}

async function contrastCheck(dir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(dir, "contrast-check.mjs")]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = err as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

test("规范文件齐全：令牌、组件、布局、数据显示、登录页说明、校验脚本", async () => {
  const expectations: [string, RegExp[]][] = [
    ["README.md", [/硬性规则/, /只引用令牌/, /360px 宽不横向滚动/, /键盘可用/]],
    ["01-tokens.md", [/## 1\. 颜色/, /亮色/, /暗色/, /## 2\. 字体/, /## 3\. 字号、行高、字重/, /## 4\. 间距/, /## 5\. 圆角、阴影、边框/, /## 7\. 断点/, /对比度/]],
    ["02-components.md", [/按钮/, /输入框|表单/, /表格/, /状态徽标/, /提示条/, /对话框/, /空状态|加载/]],
    ["03-layout.md", [/后台框架/, /响应式规则/, /手机宽度不横向滚动/, /360px/]],
    ["04-data-display.md", [/金额/, /时区/]],
    ["pages/login.md", [/登录页/, /接受邀请并设置密码页/, /不暴露邮箱是否存在/, /无障碍检查清单/]],
  ];
  for (const [name, patterns] of expectations) {
    const text = await read(name);
    for (const pattern of patterns) assert.match(text, pattern, `${name} 里没有写 ${pattern.source}`);
  }
});

test("亮、暗两套：每个颜色和阴影令牌在暗色里都有对应值；两段暗色（跟随系统、手动指定）逐项相同", () => {
  const themed = [...light.keys()].filter((name) => name.startsWith("--color-") || name.startsWith("--shadow-"));
  assert.ok(themed.length >= 40, `颜色和阴影令牌只有 ${themed.length} 个，疑似没读到`);
  for (const name of themed) assert.ok(darkManual.has(name), `暗色缺少 ${name}`);
  assert.deepEqual([...darkSystem.entries()], [...darkManual.entries()]);
  for (const name of darkManual.keys()) assert.ok(light.has(name), `亮色缺少 ${name}`);
  assert.match(tokensCss, /:root\s*\{\s*color-scheme:\s*light;/);
  assert.match(tokensCss, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{\s*color-scheme:\s*dark;/);
  assert.match(tokensCss, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
});

test("01-tokens.md 的颜色表与 tokens.css 逐项相同（亮、暗）", () => {
  let checked = 0;
  for (const match of tokensDoc.matchAll(/^\| `(color-[a-z-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)) {
    const [, name, lightValue, darkValue] = match;
    assert.equal(light.get(`--${name}`), lightValue, `${name} 亮色：文档写的是 ${lightValue}`);
    assert.equal(darkManual.get(`--${name}`), darkValue, `${name} 暗色：文档写的是 ${darkValue}`);
    checked += 1;
  }
  for (const match of tokensDoc.matchAll(/^\| `(success|warning|danger|info|neutral)` \| [^|]+ \| `(#\w+)` \/ `(#\w+)` \| `(#\w+)` \/ `(#\w+)` \| `(#\w+)` \/ `(#\w+)` \|/gm)) {
    const [, state, ...values] = match;
    for (const [index, part] of ["text", "bg", "border"].entries()) {
      assert.equal(light.get(`--color-${state}-${part}`), values[index * 2], `${state}-${part} 亮色`);
      assert.equal(darkManual.get(`--color-${state}-${part}`), values[index * 2 + 1], `${state}-${part} 暗色`);
      checked += 2;
    }
  }
  assert.ok(checked >= 55, `只核对到 ${checked} 项，文档的表格格式可能变了`);

  const documented = new Set([...tokensDoc.matchAll(/`(color-[a-z-]+)`/g)].map((match) => `--${match[1]}`));
  for (const state of ["success", "warning", "danger", "info", "neutral"]) for (const part of ["text", "bg", "border"]) documented.add(`--color-${state}-${part}`);
  for (const name of light.keys()) {
    if (name.startsWith("--color-")) assert.ok(documented.has(name), `tokens.css 的 ${name} 在 01-tokens.md 里没有说明`);
  }
});

test("01-tokens.md 的字号、行高、字重、间距、圆角、控件尺寸、层级、动效与 tokens.css 逐项相同", () => {
  let checked = 0;
  for (const match of tokensDoc.matchAll(/^\| `((?:font-size|line-height|font-weight|space|radius|z|duration|border)-[a-z0-9-]+)` \| ([\d.]+(?:px|ms)?) \|/gm)) {
    const [, name, documented] = match;
    const actual = light.get(`--${name}`);
    assert.ok(actual !== undefined, `文档里的 ${name} 在 tokens.css 里不存在`);
    assert.equal(asDocumented(actual), documented, `${name}：tokens.css 是 ${actual}，文档写的是 ${documented}`);
    checked += 1;
  }
  assert.ok(checked >= 40, `只核对到 ${checked} 项，文档的表格格式可能变了`);

  const coarse = declarations(tokensCss.slice(tokensCss.indexOf("@media (pointer: coarse)")));
  for (const match of tokensDoc.matchAll(/^\| `((?:control-height|table-row-height)[a-z-]*)` \| (\d+px) \| (\d+px) \|/gm)) {
    const [, name, mouse, touch] = match;
    assert.equal(light.get(`--${name}`), mouse, `${name} 鼠标`);
    assert.equal(coarse.get(`--${name}`), touch, `${name} 触屏`);
  }
  assert.equal(light.get("--control-font-size"), "var(--font-size-md)");
  assert.equal(coarse.get("--control-font-size"), "var(--font-size-lg)");

  for (const [name, width] of [["sm", "480px"], ["md", "768px"], ["lg", "1024px"], ["xl", "1280px"], ["2xl", "1536px"]] as const) {
    assert.equal(light.get(`--breakpoint-${name}`), width);
    assert.match(tokensDoc, new RegExp(`\\| \`${name}\` \\| ≥ ${width} \\|`), `断点 ${name} 文档与令牌不一致`);
  }
});

test("减少动态效果：三个时长令牌都变成 0", () => {
  const reduced = declarations(tokensCss.slice(tokensCss.indexOf("@media (prefers-reduced-motion: reduce)")));
  for (const name of ["--duration-fast", "--duration-base", "--duration-slow"]) assert.equal(reduced.get(name), "0ms", name);
});

test("contrast-check.mjs 通过；01-tokens.md 的对比度表与它现算的结果逐行相同", async () => {
  const result = await contrastCheck(DESIGN_DIR);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /全部通过：\d+ 组 × 2 套主题。/);

  const computed = new Map<string, string[]>();
  for (const match of result.stdout.matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| [^|]+ \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|/gm)) {
    computed.set(`${match[1]} / ${match[2]}`, [match[3] ?? "", match[4] ?? "", match[5] ?? ""]);
  }
  assert.ok(computed.size >= 60);

  let fixed = 0;
  for (const match of tokensDoc.matchAll(/^\| `([a-z-]+)` \| `([a-z-]+)` \| [^|]+ \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \|/gm)) {
    const pair = `${match[1]} / ${match[2]}`;
    assert.deepEqual([match[3], match[4], match[5]], computed.get(pair), `固定搭配 ${pair}：文档里的数值与脚本现算的不同`);
    fixed += 1;
  }
  assert.ok(fixed >= 26, `文档的固定搭配表只核对到 ${fixed} 行`);

  const surfaces = ["bg-page", "bg-surface", "bg-subtle", "bg-hover", "bg-selected"];
  let onSurfaces = 0;
  for (const match of tokensDoc.matchAll(/^\| `([a-z-]+)` \| ([\d.]+) \| ([\d.]+) \| ([\d.]+) \/ ([\d.]+) \|/gm)) {
    const rows = surfaces.map((surface) => computed.get(`${match[1]} / ${surface}`));
    assert.ok(rows.every(Boolean), `${match[1]} 没有在五种通用背景上都校验`);
    const lowest = (column: number): string => Math.min(...rows.map((row) => Number(row?.[column]))).toFixed(2);
    assert.deepEqual([match[2], match[3]], [lowest(1), lowest(2)], `${match[1]} 的最低对比度`);
    assert.deepEqual([match[4], match[5]], computed.get(`${match[1]} / bg-surface`)?.slice(1), `${match[1]} 在 bg-surface 上`);
    onSurfaces += 1;
  }
  assert.equal(onSurfaces, 8);
});

test("contrast-check.mjs 真的会拦：把颜色改到对比度不够、让两段暗色不一致、删掉一个暗色令牌，都以非 0 退出", async () => {
  const sabotages: [string, (css: string) => string, RegExp][] = [
    ["亮色正文改成浅灰", (css) => css.replace("--color-text-primary: #1A1F29;", "--color-text-primary: #C0C4CC;"), /亮色 text-primary/],
    ["只改手动暗色那一段的主色", (css) => css.replace(/(:root\[data-theme="dark"\][\s\S]*?--color-primary: )#2F62DE;/, "$1#2F62DF;"), /两段暗色不一致：--color-primary/],
    ["手动暗色少一个令牌", (css) => css.replace(/(:root\[data-theme="dark"\][\s\S]*?)\s*--color-info-bg: #0E2C3D;/, "$1"), /--color-info-bg/],
    ["暗色的出错边框改暗", (css) => css.replaceAll("--color-danger-solid: #C9352A;", "--color-danger-solid: #3A1512;"), /暗色 danger-solid/],
  ];
  const dir = await mkdtemp(join(tmpdir(), "nozomi-contrast-"));
  try {
    await cp(join(DESIGN_DIR, "contrast-check.mjs"), join(dir, "contrast-check.mjs"));
    for (const [what, sabotage, expected] of sabotages) {
      const broken = sabotage(tokensCss);
      assert.notEqual(broken, tokensCss, `「${what}」没有改到任何内容，测试需要跟着 tokens.css 调整`);
      await writeFile(join(dir, "tokens.css"), broken);
      const result = await contrastCheck(dir);
      assert.notEqual(result.code, 0, `${what}：脚本没有拦住`);
      assert.match(result.stderr, expected, what);
    }
    await writeFile(join(dir, "tokens.css"), tokensCss);
    assert.equal((await contrastCheck(dir)).code, 0, "原样的 tokens.css 在临时目录里应当通过");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
