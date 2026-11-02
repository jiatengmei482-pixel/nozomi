/**
 * `pnpm price-sheet:report`（ADR 0059）：校验 sha256、拒绝畸形文件、只写报告。表格全是测试里构造的虚构数据。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICE_SHEET_COUNTRIES, PRICE_SHEET_MILEAGE, PRICE_SHEET_NOTES, PRICE_SHEET_VEHICLES } from "@nozomi/domain";
import { type XlsxWriteCell, type XlsxWriteSheet, writeXlsx } from "../integrations/xlsx.ts";
import { createZip, unzipEntry } from "../integrations/zip.ts";
import { declaredSheets, insideGitRepository, readPriceWorkbook, readReportOptions, runPriceSheetReport } from "./price-sheet-report.ts";

const CLI = fileURLToPath(new URL("./price-sheet-report.ts", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const NOW = new Date("2026-01-02T03:04:05Z");
const work = mkdtempSync(join(realpathSync(tmpdir()), "price-sheet-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
const freshDir = (): string => {
  counter += 1;
  return join(work, `d${counter}`);
};
const num = (value: number): XlsxWriteCell => ({ number: String(value) });
const SECRET_PRICE = 73519;

function sheets(extra: XlsxWriteSheet[] = []): XlsxWriteSheet[] {
  const routes = new Map<string, XlsxWriteCell[][]>([
    ["日本", [["甲城机场", "甲城市", num(SECRET_PRICE), num(2000)], ["甲城市", "甲城机场", num(1100), null]]],
  ]);
  return [
    { name: PRICE_SHEET_NOTES, rows: [["• 若未单独列出反向线路，反向同价。"], ...PRICE_SHEET_COUNTRIES.map((country): XlsxWriteCell[] => [`  ${country.sheet}：${routes.get(country.sheet)?.length ?? 0} 条`])] },
    { name: PRICE_SHEET_VEHICLES, rows: [["国家/地区", "车型", "代表车型（或同级）", "最多乘客", "最多行李"], ["日本", "Economy 5 Seater", "虚构车", num(4), num(2)], ["日本", "Economy 7 Seater", "虚构车", num(6), num(4)]] },
    ...PRICE_SHEET_COUNTRIES.map((country): XlsxWriteSheet => ({ name: country.sheet, rows: [["出发地", "目的地", "Economy 5 Seater", "Economy 7 Seater"], [null, null, "最多4人/2件", "最多6人/4件"], ...(routes.get(country.sheet) ?? [])] })),
    { name: PRICE_SHEET_MILEAGE, rows: [["国家/地区", "车型", "价格包", "起步价（日元）", "最低消费（日元）", "超出后每公里（日元）", "来源"], ["日本", "Economy 5 Seater", "虚构包", num(5000), num(3000), num(100), "虚构来源"]] },
    ...extra,
  ];
}

/** 把 .xlsx 里的几份 XML 换掉（用来构造公式、DTD、隐藏的表）。 */
function patched(bytes: Buffer, count: number, changes: (name: string, content: string) => string): Buffer {
  const names = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", ...Array.from({ length: count }, (_, index) => `xl/worksheets/sheet${index + 1}.xml`)];
  return createZip(names.map((name) => ({ name, content: Buffer.from(changes(name, unzipEntry(bytes, name).toString("utf8")), "utf8") })));
}

const SHEET_COUNT = sheets().length;
const JAPAN_PART = `xl/worksheets/sheet${sheets().findIndex((sheet) => sheet.name === "日本") + 1}.xml`;

function writeFixture(bytes: Buffer, name = "虚构价格表.xlsx"): string {
  const dir = freshDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

const good = (): Buffer => writeXlsx(sheets());
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function runCli(args: string[], nodeFlags: string[] = []): { status: number | null; stdout: string; stderr: string } {
  // 没有任何配置和密钥的环境：这个命令用不到它们
  const result = spawnSync(process.execPath, [...nodeFlags, CLI, ...args], { encoding: "utf8", cwd: REPO, env: { PATH: process.env.PATH ?? "" }, timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("正常运行：写出 Markdown 和 JSON，只有这两个文件，权限只给自己，输入文件不变", () => {
  const bytes = good();
  const file = writeFixture(bytes);
  const out = freshDir();
  const result = runCli(["--file", file, "--expect-sha256", sha(bytes), "--out", out]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["report.json", "report.md"]);
  assert.equal(statSync(join(out, "report.md")).mode & 0o777, 0o600);
  assert.equal(statSync(join(out, "report.json")).mode & 0o777, 0o600);
  assert.equal(sha(readFileSync(file)), sha(bytes));
  const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(json.mode, "dry_run");
  assert.equal(json.file.sha256, sha(bytes));
  assert.equal(json.totals.routes, 2);
  assert.equal(json.totals.pricedCells, 3);
  assert.equal(json.totals.emptyCells, 1);
  assert.match(readFileSync(join(out, "report.md"), "utf8"), /只读 dry-run/);
  assert.ok(!result.stdout.includes(String(SECRET_PRICE)), "终端不打印价格");
  assert.match(result.stdout, /路线 2，有价的格 3/);
});

test("文件系统权限限制下也能跑完：除了 --out 目录，它写不了别的地方", () => {
  const bytes = good();
  const file = writeFixture(bytes);
  const out = freshDir();
  mkdirSync(out);
  const allowed = runCli(["--file", file, "--out", out], ["--permission", "--allow-fs-read=*", `--allow-fs-write=${out}`]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["report.json", "report.md"]);
});

test("这个命令不依赖数据库、配置和网络", () => {
  const source = readFileSync(CLI, "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  for (const name of imports) assert.ok(!/db\/|pool|@nozomi\/config|^pg$|node:net|node:http|node:https|node:tls|services\//.test(name as string), `不该引入 ${name}`);
  for (const transitive of ["../integrations/xlsx.ts", "../integrations/zip.ts"]) {
    for (const match of readFileSync(fileURLToPath(new URL(transitive, import.meta.url)), "utf8").matchAll(/from "([^"]+)"/g)) assert.ok(!/db\/|@nozomi\/config|node:net|node:http/.test(match[1] as string), `${transitive} 不该引入 ${match[1]}`);
  }
});

test("sha256 不符就退出，什么也不写", () => {
  const bytes = good();
  const file = writeFixture(bytes);
  const out = freshDir();
  const result = runCli(["--file", file, "--expect-sha256", "0".repeat(64), "--out", out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sha256 不符/);
  assert.throws(() => statSync(out), "没有创建输出目录");
});

test("大写的 sha256 也认；写法不对的 sha256 直接拒绝", () => {
  const bytes = good();
  const file = writeFixture(bytes);
  const out = freshDir();
  assert.equal(runCli(["--file", file, "--expect-sha256", sha(bytes).toUpperCase(), "--out", out]).status, 0);
  const bad = runCli(["--file", file, "--expect-sha256", "abc", "--out", freshDir()]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /64 位十六进制/);
});

test("畸形文件报错退出，什么也不写：不是 xlsx、截断的、DTD、缺表、表头不对", () => {
  const whole = good();
  const dtd = patched(whole, SHEET_COUNT, (name, content) => (name === JAPAN_PART ? content.replace("<worksheet", '<!DOCTYPE x [<!ENTITY y "z">]><worksheet') : content));
  const noSheet = writeXlsx(sheets().filter((sheet) => sheet.name !== "越南"));
  const badHeader = writeXlsx(sheets().map((sheet) => (sheet.name === "日本" ? { ...sheet, rows: [["起点", "终点"]] } : sheet)));
  const cases: [string, Buffer, RegExp][] = [
    ["不是 xlsx", Buffer.from("这不是压缩包，只是一段文字。".repeat(10)), /NOT_XLSX/],
    ["截断的", whole.subarray(0, Math.floor(whole.length / 2)), /没有生成报告/],
    ["DTD", dtd, /UNSAFE/],
    ["缺表", noSheet, /MISSING_SHEET/],
    ["表头不对", badHeader, /BAD_HEADER/],
    ["空文件", Buffer.alloc(0), /NOT_XLSX/],
  ];
  for (const [label, bytes, expected] of cases) {
    const out = freshDir();
    const result = runCli(["--file", writeFixture(bytes), "--out", out]);
    assert.equal(result.status, 1, label);
    assert.match(result.stderr, expected, label);
    assert.throws(() => statSync(out), `${label}：没有创建输出目录`);
  }
});

test("超大文件不读取就拒绝", () => {
  const out = freshDir();
  const result = runCli(["--file", writeFixture(Buffer.alloc(1024 * 1024 + 1)), "--out", out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /文件太大/);
  assert.throws(() => statSync(out));
});

test("解压后超大的压缩包（zip 炸弹）被拒绝", () => {
  const bomb = patched(good(), SHEET_COUNT, (name, content) => (name === JAPAN_PART ? content.replace("<sheetData>", `<sheetData>${" ".repeat(5 * 1024 * 1024)}`) : content));
  assert.ok(bomb.length < 1024 * 1024, "压缩后很小");
  const out = freshDir();
  const result = runCli(["--file", writeFixture(bomb), "--out", out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TOO_LARGE/);
  assert.throws(() => statSync(out));
});

test("公式不取值：带缓存值的公式算问题，缓存值不进价格", async () => {
  const bytes = patched(good(), SHEET_COUNT, (name, content) => (name === JAPAN_PART ? content.replace(`<v>${SECRET_PRICE}</v>`, "<f>HYPERLINK(&quot;http://example.invalid&quot;)</f><v>424242</v>") : content));
  const out = freshDir();
  const { report } = await runPriceSheetReport({ file: writeFixture(bytes), expectSha256: null, master: null, out }, NOW);
  assert.deepEqual(report.issues.map((issue) => [issue.code, issue.where]), [["FORMULA_CELL", "日本!C3"]]);
  assert.equal(report.totals.pricedCells, 2);
  assert.equal(report.totals.invalidCells, 1);
  assert.ok(!readFileSync(join(out, "report.json"), "utf8").includes("424242"));
  assert.ok(!readFileSync(join(out, "report.md"), "utf8").includes("example.invalid"));
});

test("多余的表、隐藏的表报出来，多余的表不读", () => {
  const withExtra = writeXlsx(sheets([{ name: "火星", rows: [["出发地", "目的地"]] }]));
  const hidden = patched(withExtra, SHEET_COUNT + 1, (name, content) => (name === "xl/workbook.xml" ? content.replace('<sheet name="越南"', '<sheet state="hidden" name="越南"') : content));
  assert.deepEqual(declaredSheets(hidden)?.filter((sheet) => sheet.hidden).map((sheet) => sheet.name), ["越南"]);
  const { sheets: read, issues } = readPriceWorkbook(hidden);
  assert.equal(read.length, SHEET_COUNT);
  assert.ok(!read.some((sheet) => sheet.name === "火星"));
  assert.deepEqual(issues.map((issue) => [issue.code, issue.where]), [["HIDDEN_SHEET", "越南"], ["UNEXPECTED_SHEET", "火星"]]);
});

test("读取层找不到指定的表时不会把第一张当成它", () => {
  const { sheets: read } = readPriceWorkbook(writeXlsx(sheets().filter((sheet) => sheet.name !== "里程价")));
  assert.ok(!read.some((sheet) => sheet.name === PRICE_SHEET_MILEAGE));
  assert.equal(read.length, SHEET_COUNT - 1);
});

test("--master：匹配结果进报告；写法不对就退出", () => {
  const bytes = good();
  const file = writeFixture(bytes);
  const masterDir = freshDir();
  mkdirSync(masterDir);
  const master = join(masterDir, "master.json");
  writeFileSync(master, JSON.stringify({ cities: [{ code: "CTY-JP-AA", country_code: "JP", name: { zh: "甲城市" }, status: "active" }] }));
  const out = freshDir();
  assert.equal(runCli(["--file", file, "--master", master, "--out", out]).status, 0);
  const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(json.cities.matched, 1);
  assert.equal(json.file.masterProvided, true);

  writeFileSync(master, "{ 坏的 JSON");
  const bad = runCli(["--file", file, "--master", master, "--out", freshDir()]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /不是合法的 JSON/);
  writeFileSync(master, JSON.stringify({ cities: [{}] }));
  const wrong = runCli(["--file", file, "--master", master, "--out", freshDir()]);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /BAD_MASTER/);
});

test("报告不能写进 git 仓库", () => {
  const file = writeFixture(good());
  const inside = join(REPO, "price-sheet-report-should-not-exist");
  const result = runCli(["--file", file, "--out", inside]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git 仓库/);
  assert.throws(() => statSync(inside));
  assert.equal(insideGitRepository(join(REPO, "a", "b", "c")), true);
  assert.equal(insideGitRepository(dirname(CLI)), true);
  assert.equal(insideGitRepository(join(work, "a", "b")), false);
});

test("不给 --out 时写到系统临时目录，不进仓库", async () => {
  const bytes = good();
  const previous = process.env.TMPDIR;
  const temp = freshDir();
  mkdirSync(temp);
  process.env.TMPDIR = temp;
  try {
    const { outDir } = await runPriceSheetReport({ file: writeFixture(bytes), expectSha256: null, master: null, out: null }, NOW);
    assert.equal(outDir, join(temp, `nozomi-price-sheet-report-${sha(bytes).slice(0, 12)}`));
    assert.equal(insideGitRepository(outDir), false);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
});

test("参数不对就退出", () => {
  assert.throws(() => readReportOptions([]));
  assert.throws(() => readReportOptions(["--file"]));
  assert.throws(() => readReportOptions(["--file", "a", "--write"]), "没有写入模式");
  assert.throws(() => readReportOptions(["--file", "a", "extra"]));
  assert.deepEqual(readReportOptions(["--file", "a"]), { file: "a", expectSha256: null, master: null, out: null });
  const missing = runCli(["--file", join(work, "没有这个文件.xlsx"), "--out", freshDir()]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
});
