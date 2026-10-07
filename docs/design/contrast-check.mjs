/**
 * 设计令牌校验：读取同目录的 tokens.css，检查
 *   1. 两段暗色令牌（跟随系统 / 手动指定）逐项相同；
 *   2. 亮色、暗色定义的颜色令牌名称完全一致；
 *   3. 下方列出的每一组前景-背景达到要求的对比度（WCAG 2.x 相对亮度算法）。
 *
 * 用法：node docs/design/contrast-check.mjs
 * 全部通过时退出码为 0，并打印可直接贴进 01-tokens.md 的对比度表格；否则退出码为 1。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

function declarations(block) {
  const map = new Map();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

function blockAfter(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`tokens.css 里找不到 ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return declarations(css.slice(open + 1, close));
}

const light = blockAfter(":root {");
const darkSystem = blockAfter(':root:not([data-theme="light"])');
const darkManual = blockAfter(':root[data-theme="dark"]');

const failures = [];

for (const [name, value] of darkSystem) {
  if (darkManual.get(name) !== value) failures.push(`两段暗色不一致：${name}`);
}
for (const name of darkManual.keys()) {
  if (!darkSystem.has(name)) failures.push(`两段暗色不一致：${name}`);
}
for (const name of light.keys()) {
  const themed = name.startsWith("--color-") || name.startsWith("--shadow-");
  if (themed && !darkManual.has(name)) failures.push(`暗色缺少：${name}`);
}
for (const name of darkManual.keys()) {
  if (!light.has(name)) failures.push(`亮色缺少：${name}`);
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

const surfaces = ["bg-page", "bg-surface", "bg-subtle", "bg-hover", "bg-selected"];
const textOnSurfaces = [
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "text-link",
  "success-text",
  "warning-text",
  "danger-text",
  "info-text",
];

/** [前景, 背景, 最低对比度, 用途] */
const pairs = [
  ...textOnSurfaces.flatMap((fg) => surfaces.map((bg) => [fg, bg, TEXT, "文字"])),
  ["on-primary", "primary", TEXT, "主按钮文字"],
  ["on-primary", "primary-hover", TEXT, "主按钮文字（悬停）"],
  ["on-primary", "primary-active", TEXT, "主按钮文字（按下）"],
  ["on-danger", "danger-solid", TEXT, "危险按钮文字"],
  ["on-danger", "danger-solid-hover", TEXT, "危险按钮文字（悬停）"],
  ["on-danger", "danger-solid-active", TEXT, "危险按钮文字（按下）"],
  ["text-link", "primary-subtle", TEXT, "选中导航项、主色浅底上的文字"],
  ["success-text", "success-bg", TEXT, "状态徽标、提示条"],
  ["warning-text", "warning-bg", TEXT, "状态徽标、提示条"],
  ["danger-text", "danger-bg", TEXT, "状态徽标、提示条"],
  ["info-text", "info-bg", TEXT, "状态徽标、提示条"],
  ["neutral-text", "neutral-bg", TEXT, "状态徽标"],
  ["text-primary", "success-bg", TEXT, "提示条正文"],
  ["text-primary", "warning-bg", TEXT, "提示条正文"],
  ["text-primary", "danger-bg", TEXT, "提示条正文"],
  ["text-primary", "info-bg", TEXT, "提示条正文"],
  ["text-inverse", "bg-inverse", TEXT, "Toast、气泡提示"],
  ["border-strong", "bg-surface", NON_TEXT, "输入框边框"],
  ["border-strong", "bg-page", NON_TEXT, "输入框边框"],
  ["border-focus", "bg-surface", NON_TEXT, "聚焦环"],
  ["border-focus", "bg-page", NON_TEXT, "聚焦环"],
  ["border-focus", "bg-subtle", NON_TEXT, "聚焦环"],
  ["danger-solid", "bg-surface", NON_TEXT, "出错输入框边框"],
  ["danger-solid", "bg-page", NON_TEXT, "出错输入框边框"],
  ["primary", "bg-surface", NON_TEXT, "选中的复选框、开关、进度条"],
  ["primary", "bg-page", NON_TEXT, "选中的复选框、开关、进度条"],
];

const themes = [
  ["亮色", light],
  ["暗色", darkManual],
];

function color(tokens, name, themeName) {
  const value = tokens.get(`--color-${name}`);
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${themeName} --color-${name} 不是 6 位十六进制颜色：${value}`);
  }
  return value;
}

const rows = pairs.map(([fg, bg, min, usage]) => {
  const ratios = themes.map(([themeName, tokens]) => {
    const ratio = contrast(color(tokens, fg, themeName), color(tokens, bg, themeName));
    if (ratio < min) {
      failures.push(`${themeName} ${fg} / ${bg} = ${ratio.toFixed(2)}，低于 ${min}`);
    }
    return ratio;
  });
  return `| \`${fg}\` | \`${bg}\` | ${usage} | ${min} | ${ratios[0].toFixed(2)} | ${ratios[1].toFixed(2)} |`;
});

console.log("| 前景 | 背景 | 用途 | 要求 | 亮色 | 暗色 |");
console.log("| --- | --- | --- | --- | --- | --- |");
console.log(rows.join("\n"));

if (failures.length > 0) {
  console.error(`\n未通过 ${failures.length} 项：\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\n全部通过：${pairs.length} 组 × 2 套主题。`);
