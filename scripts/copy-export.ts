/**
 * 固定文案清单导出（M11-02，业主 2026-11-15）：`pnpm copy:export [--out <目录>]`，默认写到 copy-export/（不提交）。
 *
 * - keys.csv / keys.md：前端文案本（apps/web/src/i18n/messages）里的每一条——页面、key、中文、出现位置（文件:行）；
 *   加上邮件 / 通知模板（packages/domain/src/notifications.ts 的中文模板），按页面分组，给业主定稿用；
 * - hardcoded.csv：组件里还写死、没走 key 的中文（只报告，不拦）。粗略扫描：去掉注释后含中文的行；测试、文案本本身不算。
 *
 * 用法见 docs/dev/i18n.md。
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MESSAGE_BOOKS } from "../apps/web/src/i18n/messages/index.ts";
import { NOTIFICATION_TEMPLATES } from "../packages/domain/src/notifications.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_SRC = join(ROOT, "apps/web/src");
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 按目录分页面（第一条命中的为准） */
const PAGE_GROUPS: readonly [string, string][] = [
  ["pages/book/new/", "官网预订页（/book/new，嵌入页同一份）"],
  ["pages/book/", "官网（询价、下单、订单页）"],
  ["pages/embed/", "嵌入预订页"],
  ["embed/", "嵌入组件（合作网站上的查价框）"],
  ["pages/orders/", "供应商后台 · 订单"],
  ["pages/products/", "供应商后台 · 商品"],
  ["pages/driver/", "司机页"],
  ["pages/platform/", "运营后台"],
  ["pages/", "其他页面"],
  ["components/", "公用组件"],
];

function pageOf(file: string): string {
  return PAGE_GROUPS.find(([prefix]) => file.startsWith(prefix))?.[1] ?? "公用（见位置）";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(WEB_SRC).map((full) => ({ rel: relative(WEB_SRC, full).replaceAll("\\", "/"), lines: readFileSync(full, "utf8").split("\n") }));

/** lib 里的文件不是页面：再往上找一层引用它的文件，用它们的页面 */
function pagesOf(file: string): string[] {
  if (!file.startsWith("lib/")) return [pageOf(file)];
  const name = file.slice("lib/".length);
  const importers = files.filter((other) => other.lines.some((line) => line.includes(`lib/${name}"`) || (other.rel.startsWith("lib/") && line.includes(`./${name}"`))));
  const pages = [...new Set(importers.filter((other) => !other.rel.startsWith("lib/")).map((other) => pageOf(other.rel)))];
  return pages.length === 0 ? ["公用（见位置）"] : pages;
}

interface Row {
  page: string;
  key: string;
  zh: string;
  where: string;
}

const rows: Row[] = [];
for (const [ns, book] of Object.entries(MESSAGE_BOOKS)) {
  for (const [key, zh] of Object.entries(book.zh as Record<string, string>)) {
    const full = `${ns}.${key}`;
    const hits = files.filter((file) => !file.rel.startsWith("i18n/")).flatMap((file) => file.lines.flatMap((line, index) => (line.includes(`"${full}"`) ? [{ file: file.rel, line: index + 1 }] : [])));
    const found = [...new Set(hits.flatMap((hit) => pagesOf(hit.file)))];
    // 有具体页面时不再列「公用」
    const pages = found.length > 1 ? found.filter((page) => page !== "公用（见位置）") : found;
    rows.push({ page: pages.length === 0 ? "（没有用到）" : pages.join("；"), key: full, zh, where: hits.map((hit) => `apps/web/src/${hit.file}:${hit.line}`).join(" ") });
  }
}
for (const template of NOTIFICATION_TEMPLATES.filter((entry) => entry.locale === "zh-CN")) {
  rows.push({ page: `邮件 / 通知（${template.audience}）`, key: `mail.${template.event}.${template.audience}`, zh: `${template.subject}\n${template.body}`, where: "packages/domain/src/notifications.ts" });
}
/** 按第一个页面分组：一条文案用在几个页面时，归到第一个，其余写在「用在哪些页面」里 */
const groupOf = (row: Row): string => row.page.split("；")[0] as string;
rows.sort((a, b) => groupOf(a).localeCompare(groupOf(b), "zh") || a.key.localeCompare(b.key));

/** 写死的中文：去掉注释后还含中文的行 */
interface Hardcoded {
  page: string;
  file: string;
  line: number;
  text: string;
}
const hardcoded: Hardcoded[] = [];
for (const file of files) {
  if (file.rel.startsWith("i18n/")) continue;
  let inBlock = false;
  file.lines.forEach((raw, index) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    line = line.replace(/(^|[^:"'`])\/\/.*$/, "$1").replace(/\{\s*\/\*.*?\*\/\s*\}/g, "");
    if (CJK.test(line)) hardcoded.push({ page: pageOf(file.rel), file: `apps/web/src/${file.rel}`, line: index + 1, text: line.trim().slice(0, 160) });
  });
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (header: string[], data: (string | number)[][]): string => `\uFEFF${[header, ...data].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
const mdCell = (text: string): string => text.replaceAll("|", "\\|").replaceAll("\n", "<br>");

const outArg = process.argv.indexOf("--out");
const outDir = resolve(ROOT, outArg === -1 ? "copy-export" : (process.argv[outArg + 1] ?? "copy-export"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "keys.csv"), csv(["页面", "key", "中文", "出现位置"], rows.map((row) => [row.page, row.key, row.zh, row.where])));
const groups = [...new Set(rows.map(groupOf))];
const md = [
  "# 固定文案清单（M11-02，自动导出）",
  "",
  `前端文案本 ${Object.keys(MESSAGE_BOOKS).length} 本、邮件 / 通知模板一共 ${rows.length} 条；组件里还写死的中文 ${hardcoded.length} 行（见 hardcoded.csv，只报告）。`,
  "",
  ...groups.flatMap((group) => [`## ${group}`, "", "| key | 中文 | 用在哪些页面 | 出现位置 |", "| --- | --- | --- | --- |", ...rows.filter((row) => groupOf(row) === group).map((row) => `| \`${row.key}\` | ${mdCell(row.zh)} | ${mdCell(row.page)} | ${mdCell(row.where)} |`), ""]),
].join("\n");
writeFileSync(join(outDir, "keys.md"), md);
writeFileSync(join(outDir, "hardcoded.csv"), csv(["页面", "文件", "行", "内容"], hardcoded.map((item) => [item.page, item.file, item.line, item.text])));

const byFile = new Map<string, number>();
for (const item of hardcoded) byFile.set(item.file, (byFile.get(item.file) ?? 0) + 1);
console.log(`已导出到 ${relative(ROOT, outDir) || "."}/：keys.csv、keys.md（${rows.length} 条）、hardcoded.csv（写死的中文 ${hardcoded.length} 行，${byFile.size} 个文件）`);
for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${count}\t${file}`);
