import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("pnpm copy:export（M11-02）：导出每条 key 的页面、中文、出现位置，加上邮件模板；另列写死的中文（只报告）", () => {
  const out = mkdtempSync(join(tmpdir(), "nozomi-copy-export-"));
  try {
    const printed = execFileSync(process.execPath, [join(ROOT, "scripts/copy-export.ts"), "--out", out], { encoding: "utf8" });
    assert.match(printed, /keys\.csv、keys\.md（\d+ 条）、hardcoded\.csv（写死的中文 \d+ 行/);
    const keys = readFileSync(join(out, "keys.csv"), "utf8");
    assert.ok(keys.startsWith("﻿页面,key,中文,出现位置\n"), "带 BOM，Excel 打开不乱码");
    const row = keys.split("\n").find((line) => line.includes(",freeWait.flightKindLegend,"));
    assert.ok(row, "前端文案本里的 key 都在");
    assert.match(row, /,航班类型,apps\/web\/src\/pages\/book\/FlightKindField\.tsx:\d+/, "中文和出现位置（文件:行）");
    assert.match(row, /^官网（询价、下单、订单页）/, "按页面分组");
    assert.match(keys, /邮件 \/ 通知（tenant）,mail\.order\.changed\.tenant,/, "邮件 / 通知模板也在清单里");
    const md = readFileSync(join(out, "keys.md"), "utf8");
    assert.match(md, /^# 固定文案清单/);
    assert.match(md, /\| `freeWait\.previewChange` \| 同意后免费等待 \{from\} → \{to\} \|/);
    const hardcoded = readFileSync(join(out, "hardcoded.csv"), "utf8");
    assert.ok(hardcoded.startsWith("﻿页面,文件,行,内容\n"));
    assert.doesNotMatch(hardcoded, /apps\/web\/src\/i18n\//, "文案本自己不算写死");
    assert.doesNotMatch(hardcoded, /\.test\.tsx?,/, "测试不算");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
