/**
 * 固定文案清单（M11-02）的输出：一份 CSV（Excel 直接打开）、一份总览 README.md、每个区域一份 Markdown（GitHub 上直接看）。
 * 输出里没有日期、没有本机路径：代码不变，导出的文件一字不变。
 */
import { AREAS, type AreaId, areaTitle } from "./classify.ts";
import type { CopyEntry } from "./collect.ts";

export const CSV_FILE = "copy.csv";
export const INDEX_FILE = "README.md";

/** 一个区域的第 part 份（从 1 起）：第一份是 `<区域>.md`，之后是 `<区域>-2.md`… */
export function areaFile(id: AreaId, part = 1): string {
  return part === 1 ? `${id}.md` : `${id}-${part}.md`;
}

/** 是不是本命令生成的文件名：重新导出时只删这些，输出目录里别的文件不动 */
export function isGeneratedFileName(name: string): boolean {
  if (name === INDEX_FILE || name === CSV_FILE) return true;
  const match = /^([a-z]+)(-\d+)?\.md$/.exec(name);
  return match !== null && AREAS.some((area) => area.id === match[1]);
}

/** 一份 Markdown 的上限：太大的文件 GitHub 不渲染，按页面切成几份 */
export const MAX_MARKDOWN_BYTES = 300_000;

/**
 * CSV 的一格：有逗号、引号、换行的加引号，引号写两遍（RFC 4180）。
 * 以 = + - @ 开头的前面加一个单引号，免得 Excel 当成公式（如「+ 添加机场」）。
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_HEADER = ["区域", "页面", "key", "状态", "中文", "类型", "代码线索", "文件", "行号", "用在"] as const;

/** CSV 里每行都有「用在」，只写前几个，全部的见 Markdown */
export function usedInSummary(usedIn: readonly string[], limit = 5): string {
  if (usedIn.length <= limit) return usedIn.join("；");
  return `${usedIn.slice(0, limit).join("；")} 等 ${usedIn.length} 个页面`;
}

/** 开头带 BOM：Excel 才认得出是 UTF-8，中文不乱码 */
export function renderCsv(entries: readonly CopyEntry[]): string {
  const rows = [CSV_HEADER.join(",")];
  for (const entry of entries) {
    rows.push([areaTitle(entry.area), entry.page, entry.key, entry.status, entry.text, entry.role, entry.context, entry.file, entry.lines.join(" "), usedInSummary(entry.usedIn)].map(csvCell).join(","));
  }
  return `\uFEFF${rows.join("\n")}\n`;
}

/** Markdown 表格的一格：竖线、反斜杠、尖括号和会变成格式的符号都转义，换行写成 <br> */
export function mdCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([|*_`[\]~#])/g, "\\$1")
    .replace(/\r?\n/g, "<br>");
}

function locationCell(entry: CopyEntry): string {
  const [first, ...rest] = entry.lines;
  const link = `[${mdCell(entry.file.split("/").pop() ?? entry.file)}:${first}](../../${entry.file}#L${first})`;
  return rest.length === 0 ? link : `${link}、${rest.join("、")} 行`;
}

interface Counts {
  total: number;
  hardcoded: number;
  keyed: number;
}

export function countEntries(entries: readonly CopyEntry[]): Counts {
  const hardcoded = entries.filter((entry) => entry.status === "写死").length;
  return { total: entries.length, hardcoded, keyed: entries.length - hardcoded };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function renderPage(page: string, list: readonly CopyEntry[]): string {
  const out = [`## ${mdCell(page)}`, ""];
  const usedIn = list[0]?.usedIn ?? [];
  if (usedIn.length > 0) out.push(`用在：${usedIn.map(mdCell).join("；")}`, "");
  const files = [...new Set(list.map((entry) => entry.file))];
  out.push(`文件：${files.map((file) => `\`${file}\``).join("、")}`, "");
  out.push("| key | 状态 | 中文 | 类型 | 位置 |", "| --- | --- | --- | --- | --- |");
  for (const entry of list) out.push(`| \`${entry.key}\` | ${entry.status} | ${mdCell(entry.text)} | ${mdCell(entry.role)} | ${locationCell(entry)} |`);
  return `${out.join("\n")}\n`;
}

/** 一个区域的 Markdown：文件名 → 内容。按页面分节；超过 maxBytes 的按页面切成几份（一个页面不拆开） */
export function renderArea(id: AreaId, entries: readonly CopyEntry[], maxBytes = MAX_MARKDOWN_BYTES): Map<string, string> {
  const pages = [...groupBy(entries, (entry) => entry.page)].map(([page, list]) => ({ page, count: list.length, text: renderPage(page, list) }));
  const parts: Array<typeof pages> = [];
  let size = 0;
  for (const page of pages) {
    const bytes = Buffer.byteLength(page.text);
    const current = parts[parts.length - 1];
    if (current === undefined || (current.length > 0 && size + bytes > maxBytes)) {
      parts.push([page]);
      size = bytes;
    } else {
      current.push(page);
      size += bytes;
    }
  }
  const counts = countEntries(entries);
  const files = new Map<string, string>();
  parts.forEach((part, index) => {
    const title = parts.length === 1 ? areaTitle(id) : `${areaTitle(id)}（第 ${index + 1} / ${parts.length} 份）`;
    const out = [`# ${title}`, "", `由 \`pnpm copy:export\` 从代码生成，不要手改。本区域共 ${counts.total} 条：写死 ${counts.hardcoded} 条，已走 key ${counts.keyed} 条。列的意思见 [README](README.md)。`, ""];
    if (parts.length > 1) out.push(`本区域分 ${parts.length} 份：${parts.map((_part, n) => (n === index ? `第 ${n + 1} 份` : `[第 ${n + 1} 份](${areaFile(id, n + 1)})`)).join(" · ")}`, "");
    out.push("## 页面", "");
    for (const page of part) out.push(`- [${mdCell(page.page)}](#${anchor(page.page)})（${page.count} 条）`);
    out.push("", ...part.map((page) => page.text));
    files.set(areaFile(id, index + 1), `${out.join("\n").trimEnd()}\n`);
  });
  return files;
}

/** GitHub 给标题生成的锚点：转小写，去掉标点（中文保留），空格换成 - */
export function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function renderIndex(entries: readonly CopyEntry[]): string {
  const all = countEntries(entries);
  const out = [
    "# 固定文案清单",
    "",
    "由 `pnpm copy:export` 从代码自动生成（M11-02），**不要手改**；代码里的文案改了，重新运行一次即可。",
    "用 `pnpm copy:export --check` 可以检查这里是不是最新的。",
    "",
    `共 ${all.total} 条：**写死 ${all.hardcoded} 条**（直接写在页面代码里，没走 i18n key），已走 key ${all.keyed} 条。`,
    "",
    "- 用 Excel 看：下载 [copy.csv](copy.csv)，可以按「区域」「页面」「状态」筛选。",
    "- 在 GitHub 上看：点下面的区域，按页面分组，位置可以点开直接看代码。",
    "",
    "## 各区域",
    "",
    "| 区域 | 条数 | 写死 | 已走 key |",
    "| --- | ---: | ---: | ---: |",
  ];
  const byArea = groupBy(entries, (entry) => entry.area);
  for (const area of AREAS) {
    const list = byArea.get(area.id) ?? [];
    if (list.length === 0) continue;
    const counts = countEntries(list);
    out.push(`| [${area.title}](${areaFile(area.id)}) | ${counts.total} | ${counts.hardcoded} | ${counts.keyed} |`);
  }
  out.push(
    "",
    "## 每一列的意思",
    "",
    "| 列 | 意思 |",
    "| --- | --- |",
    "| 区域 | 官网、供应商后台、运营后台、邮件等 |",
    "| 页面 | 文案出现在哪个页面；几个页面共用的写「…共用」，并在「用在」里列出页面 |",
    "| key | 文案的编号。已走 key 的是代码里的 key；写死的是自动生成的编号（文件名 + 短哈希），文字和文件不变编号就不变 |",
    "| 状态 | 「写死」= 直接写在页面代码里；「已走 key」= 放在文案表里按 key 取，以后翻译只改表 |",
    "| 中文 | 文案原文。`{名字}` 是运行时填进去的内容（订单号、金额等），`{…}` 是比较复杂的一段；`{{名字}}` 是邮件模板的变量 |",
    "| 类型 | 标题、按钮、说明、提示、错误提示、邮件主题 / 正文等（按代码推断，仅供参考） |",
    "| 代码线索 | 给开发看的：属性名、变量名、调用的函数或所在标签（只在 CSV 里有） |",
    "| 位置 | 文件和行号；同一个文件里同一句话出现几次，只列一条，行号都写上 |",
    "",
    "## 收录范围",
    "",
    "- 前端 `apps/web/src`：所有页面、组件、共用文案，嵌入组件脚本（`embed/`）也在内。",
    "- 邮件和通知模板：`packages/domain/src` 里的通知中心模板、登录验证码邮件、司机链接邮件、HTML 邮件外框。",
    "- 后端 `apps/api/src`：接口返回给用户看的说明（错误提示等，前端会直接显示后端给的中文说明）。",
    "- `packages/domain/src`：前后端共用的说法（状态名、原因说明等）。",
    "",
    "抽取规则：页面里的文字；`aria-label`、`title`、`placeholder`、`alt`、`label` 等给人看的属性；代码里含中文（以及日文假名、韩文）的字符串和模板字符串。",
    "",
    "不收录：测试代码；注释；日志和 `console` 输出；`new Error(...)` 这类给开发看的异常；数据库迁移；命令行工具的输出；",
    "发给外部服务（Google、Stripe、Claude）的内容和 AI 提示词；评测用例；类型里的字符串；`===` 比较的另一边；主站已有的日文、英文译文（只收中文）；",
    "CSS 类名、网址、错误码这类不含中文的字符串（页面文字和上面那些属性除外）。",
    "",
    "## 怎么算「已走 key」",
    "",
    "符合下面约定的文案表里的条目算「已走 key」，其余都算「写死」。以后的 i18n 公用模块照这个约定写，就能自动认出来：",
    "",
    "1. 文件名以 `-copy.ts` / `-texts.ts` 结尾，或放在 `i18n/` 目录下：文件里所有顶层 `const X = { ... }` 都是文案表；",
    "2. 别的文件里名字以 `_COPY` / `_TEXTS` 结尾的顶层常量也是文案表；",
    "3. 按语言分的表（属性名 `zh`、`ja`、`en`…）只取 `zh`；",
    "4. 表的属性名全都带点（如 `tenant.charterAirport.title`）就是全局 key，原样使用；否则 key = 文件名（去掉 `-copy` / `-texts`）+ 常量名 + 属性名。",
    "",
    "## 写死文案最多的文件",
    "",
    "| 文件 | 写死条数 |",
    "| --- | ---: |",
  );
  const hardcodedByFile = [...groupBy(entries.filter((entry) => entry.status === "写死"), (entry) => entry.file)].map(([file, list]) => [file, list.length] as const);
  hardcodedByFile.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [file, count] of hardcodedByFile.slice(0, 30)) out.push(`| [${mdCell(file)}](../../${file}) | ${count} |`);
  return `${out.join("\n")}\n`;
}

/** 全部输出文件：文件名 → 内容 */
export function renderAll(entries: readonly CopyEntry[]): Map<string, string> {
  const files = new Map<string, string>();
  files.set(INDEX_FILE, renderIndex(entries));
  files.set(CSV_FILE, renderCsv(entries));
  const byArea = groupBy(entries, (entry) => entry.area);
  for (const area of AREAS) {
    const list = byArea.get(area.id);
    if (list !== undefined) for (const [name, content] of renderArea(area.id, list)) files.set(name, content);
  }
  return files;
}
