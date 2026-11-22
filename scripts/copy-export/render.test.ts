import { test } from "node:test";
import assert from "node:assert/strict";
import { type CopyEntry, collectEntries, hardcodedKey, isExcludedFile } from "./collect.ts";
import { anchor, csvCell, isGeneratedFileName, mdCell, renderAll, renderArea, renderCsv, usedInSummary } from "./render.ts";

const entry = (overrides: Partial<CopyEntry>): CopyEntry => ({
  area: "tenant",
  page: "区域列表",
  key: "AreaListPage.0000abcd",
  status: "写死",
  text: "新增区域",
  role: "按钮",
  context: "<Button>",
  file: "apps/web/src/pages/areas/AreaListPage.tsx",
  lines: [12],
  usedIn: [],
  ...overrides,
});

test("CSV 一格：逗号、引号、换行加引号；引号写两遍；= + - @ 开头的加单引号防止 Excel 当公式", () => {
  assert.equal(csvCell("保存"), "保存");
  assert.equal(csvCell("上车，下车"), "上车，下车");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('点「"保存"」'), '"点「""保存""」"');
  assert.equal(csvCell("第一行\n第二行"), '"第一行\n第二行"');
  assert.equal(csvCell("+ 添加机场"), "'+ 添加机场");
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("-"), "'-");
});

test("CSV：开头有 BOM，第一行是表头，每条一行", () => {
  const csv = renderCsv([entry({}), entry({ text: "名称, 简称", lines: [3, 9], usedIn: ["a", "b"] })]);
  assert.ok(csv.startsWith("﻿区域,页面,key,状态,中文,类型,代码线索,文件,行号,用在\n"));
  const lines = csv.slice(1).trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "供应商后台,区域列表,AreaListPage.0000abcd,写死,新增区域,按钮,<Button>,apps/web/src/pages/areas/AreaListPage.tsx,12,");
  assert.equal(lines[2], '供应商后台,区域列表,AreaListPage.0000abcd,写死,"名称, 简称",按钮,<Button>,apps/web/src/pages/areas/AreaListPage.tsx,3 9,a；b');
});

test("「用在」在 CSV 里只写前几个", () => {
  assert.equal(usedInSummary(["a", "b"]), "a；b");
  assert.equal(usedInSummary(["a", "b", "c", "d"], 2), "a；b 等 4 个页面");
});

test("Markdown 一格：竖线、尖括号、格式符号转义，换行写成 <br>", () => {
  assert.equal(mdCell("A | B"), "A \\| B");
  assert.equal(mdCell("<Button>"), "&lt;Button&gt;");
  assert.equal(mdCell("*粗* _斜_ `码`"), "\\*粗\\* \\_斜\\_ \\`码\\`");
  assert.equal(mdCell("第一行\n第二行"), "第一行<br>第二行");
});

test("锚点：转小写、去掉标点、空格换成 -", () => {
  assert.equal(anchor("Webhook 设置（运营后台也用）"), "webhook-设置运营后台也用");
  assert.equal(anchor("主数据 · 城市"), "主数据--城市");
});

test("区域 Markdown：按页面分节，带目录、文件和可点的位置；太大时按页面切成几份", () => {
  const entries = [entry({}), entry({ page: "区域编辑", key: "AreaEditorPage.1", text: "保存", file: "apps/web/src/pages/areas/AreaEditorPage.tsx", lines: [5, 8] })];
  const one = renderArea("tenant", entries);
  assert.deepEqual([...one.keys()], ["tenant.md"]);
  const md = one.get("tenant.md") ?? "";
  assert.match(md, /^# 供应商后台\n/);
  assert.match(md, /- \[区域列表\]\(#区域列表\)（1 条）/);
  assert.match(md, /\| `AreaEditorPage\.1` \| 写死 \| 保存 \| 按钮 \| \[AreaEditorPage\.tsx:5\]\(\.\.\/\.\.\/apps\/web\/src\/pages\/areas\/AreaEditorPage\.tsx#L5\)、8 行 \|/);
  const split = renderArea("tenant", entries, 10);
  assert.deepEqual([...split.keys()], ["tenant.md", "tenant-2.md"]);
  assert.match(split.get("tenant-2.md") ?? "", /^# 供应商后台（第 2 \/ 2 份）\n[\s\S]*\[第 1 份\]\(tenant\.md\) · 第 2 份/);
});

test("全部输出：README、CSV、有内容的区域各一份；README 有各区域条数", () => {
  const files = renderAll([entry({}), entry({ area: "mail", page: "通知中心", status: "已走 key", key: "mail.x" })]);
  assert.deepEqual([...files.keys()].sort(), ["README.md", "copy.csv", "mail.md", "tenant.md"]);
  const readme = files.get("README.md") ?? "";
  assert.match(readme, /共 2 条：\*\*写死 1 条\*\*/);
  assert.match(readme, /\| \[供应商后台\]\(tenant\.md\) \| 1 \| 1 \| 0 \|/);
  assert.match(readme, /\| \[邮件和通知模板\]\(mail\.md\) \| 1 \| 0 \| 1 \|/);
});

test("重新导出时只认自己生成的文件名，输出目录里别的文件不动", () => {
  for (const name of ["README.md", "copy.csv", "tenant.md", "platform-3.md", "mail.md"]) assert.equal(isGeneratedFileName(name), true, name);
  for (const name of ["notes.md", "workflow.md", "tenant-final.md", "other.csv"]) assert.equal(isGeneratedFileName(name), false, name);
});

test("写死文案的 key：文件名 + 短哈希，同一文件同一句话不变，换文件或改字就变", () => {
  const key = hardcodedKey("apps/web/src/pages/areas/AreaListPage.tsx", "新增区域");
  assert.match(key, /^AreaListPage\.[0-9a-f]{8}$/);
  assert.equal(hardcodedKey("apps/web/src/pages/areas/AreaListPage.tsx", "新增区域"), key);
  assert.notEqual(hardcodedKey("apps/web/src/pages/areas/AreaListPage.tsx", "新增区域 "), key);
  assert.notEqual(hardcodedKey("apps/web/src/pages/areas/Other.tsx", "新增区域"), key.replace("AreaListPage", "Other"));
});

test("汇总：同一文件里同一句话只留一条、行号合并；key 表的条目单列；按区域顺序排", () => {
  const entries = collectEntries([
    { path: "packages/domain/src/orders.ts", text: `/** 订单与付款 */\nexport const a = "已取消";` },
    { path: "apps/web/src/pages/areas/AreaListPage.tsx", text: `export const P = () => (\n  <div>\n    <button>重试</button>\n    <button>重试</button>\n  </div>\n);` },
    { path: "apps/web/src/lib/step-bar-texts.ts", text: `const ZH = { label: "本步操作" };` },
  ]);
  assert.deepEqual(
    entries.map((item) => [item.area, item.status, item.text, item.lines.join(" "), item.key.startsWith("AreaListPage.") ? "hash" : item.key]),
    [
      ["tenant", "写死", "重试", "3 4", "hash"],
      ["shared", "已走 key", "本步操作", "1", "step-bar.label"],
      ["domain", "写死", "已取消", "2", entries[2]?.key ?? ""],
    ],
  );
});

test("不扫的文件：测试、测试工具、命令行工具、迁移、外部对接", () => {
  for (const file of ["apps/web/src/lib/a.test.ts", "apps/web/src/components/B.test.tsx", "apps/api/src/x.itest.ts", "apps/api/src/x.qa.itest.ts", "apps/web/src/testing/fake.ts", "apps/api/src/cli/admin-create.ts", "apps/api/src/db/migrate.ts", "apps/api/src/integrations/stripe.ts", "apps/api/src/logging.ts", "packages/domain/src/quote-compat.samples.ts", "apps/api/src/services/trip-parse.ts"]) {
    assert.equal(isExcludedFile(file), true, file);
  }
  for (const file of ["apps/web/src/pages/LoginPage.tsx", "apps/api/src/services/orders.ts", "packages/domain/src/notifications.ts"]) assert.equal(isExcludedFile(file), false, file);
});
