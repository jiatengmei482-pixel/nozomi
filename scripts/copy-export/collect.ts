/**
 * 固定文案清单（M11-02）：读源文件 → 抽文案 → 分组 → 给每条定 key。不碰输出格式（见 render.ts）。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { AREAS, type AreaId, PAGE_ENTRIES, type SourceFile, importedBy, placeFile } from "./classify.ts";
import { extractCopy, headerLabel } from "./extract.ts";

export type CopyStatus = "写死" | "已走 key";

export interface CopyEntry {
  area: AreaId;
  page: string;
  key: string;
  status: CopyStatus;
  text: string;
  role: string;
  context: string;
  file: string;
  lines: number[];
  usedIn: string[];
}

/** 扫这几个目录 */
export const SOURCE_ROOTS = ["apps/web/src", "apps/api/src", "packages/domain/src"] as const;

/**
 * 不扫的文件：测试和测试工具；后端的命令行工具（运维在终端里看）、数据库迁移、外部接口的对接代码（发给 Google、Stripe、Claude 的内容）、
 * 日志；评测用例和金样本（测试数据）；AI 解析的提示词（发给模型，不给人看）；地址搜索判断语言用的汉字表（Unihan 生成的数据，ADR 0108）。
 */
const EXCLUDED = [
  /\.(test|itest)\.tsx?$/,
  /\.qa\.(test|itest)\.tsx?$/,
  /\.d\.ts$/,
  /\.samples\.ts$/,
  /\/testing\//,
  /\/e2e\//,
  /^apps\/api\/src\/(cli|db|integrations)\//,
  /^apps\/api\/src\/logging\.ts$/,
  /^packages\/domain\/src\/place-language-tables\.ts$/,
  /^apps\/api\/src\/services\/(trip-eval|trip-eval-cases|trip-parse|replay-classify|replay-digest|qa-acceptance)\.ts$/,
];

export function isExcludedFile(file: string): boolean {
  return EXCLUDED.some((pattern) => pattern.test(file));
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(root, rel, out);
    else if (/\.tsx?$/.test(entry.name) && !isExcludedFile(rel)) out.push(rel);
  }
}

export function readSources(repoRoot: string): SourceFile[] {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) walk(repoRoot, root, files);
  return files.sort().map((file) => ({ path: file, text: readFileSync(path.join(repoRoot, file), "utf8") }));
}

/** 写死文案的 key：文件名 + 文件路径和文字的短哈希。文字和文件不变，key 就不变，两次导出能逐行比较 */
export function hardcodedKey(file: string, text: string): string {
  const stem = (file.split("/").pop() ?? file).replace(/\.tsx?$/, "");
  return `${stem}.${createHash("sha1").update(`${file}\n${text}`).digest("hex").slice(0, 8)}`;
}

const pageOrder = new Map<string, number>();
Object.values(PAGE_ENTRIES).forEach((entry, index) => {
  const id = `${entry.area}\u0000${entry.page}`;
  if (!pageOrder.has(id)) pageOrder.set(id, index);
});
const areaOrder = new Map<string, number>(AREAS.map((area, index) => [area.id, index]));

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function collectEntries(sources: readonly SourceFile[]): CopyEntry[] {
  const reverse = importedBy(sources.filter((file) => file.path.startsWith("apps/web/")));
  const entries: CopyEntry[] = [];
  for (const file of sources) {
    const raw = extractCopy(file.text, { fileName: file.path });
    if (raw.length === 0) continue;
    const placement = placeFile(file.path, headerLabel(file.text), reverse);
    const byText = new Map<string, CopyEntry>();
    for (const item of raw) {
      if (item.key !== null) {
        entries.push({ ...placement, key: item.key, status: "已走 key", text: item.text, role: item.role, context: item.context, file: file.path, lines: [item.line] });
        continue;
      }
      const existing = byText.get(item.text);
      if (existing !== undefined) {
        if (!existing.lines.includes(item.line)) existing.lines.push(item.line);
        continue;
      }
      const entry: CopyEntry = { ...placement, key: hardcodedKey(file.path, item.text), status: "写死", text: item.text, role: item.role, context: item.context, file: file.path, lines: [item.line] };
      byText.set(item.text, entry);
      entries.push(entry);
    }
  }
  return sortEntries(entries);
}

/** 区域按 AREAS 的顺序；页面先按路由表的顺序，再按文件；条目按文件、行号 */
export function sortEntries(entries: readonly CopyEntry[]): CopyEntry[] {
  const firstFile = new Map<string, string>();
  for (const entry of entries) {
    const id = `${entry.area}\u0000${entry.page}`;
    const current = firstFile.get(id);
    if (current === undefined || entry.file < current) firstFile.set(id, entry.file);
  }
  const rank = (entry: CopyEntry): [number, number, string] => {
    const id = `${entry.area}\u0000${entry.page}`;
    return [areaOrder.get(entry.area) ?? 99, pageOrder.get(id) ?? Number.MAX_SAFE_INTEGER, `${firstFile.get(id) ?? ""}\u0000${entry.page}`];
  };
  return [...entries].sort((a, b) => {
    const [aa, ap, af] = rank(a);
    const [ba, bp, bf] = rank(b);
    return aa - ba || ap - bp || compareText(af, bf) || compareText(a.file, b.file) || (a.lines[0] ?? 0) - (b.lines[0] ?? 0) || compareText(a.key, b.key);
  });
}
