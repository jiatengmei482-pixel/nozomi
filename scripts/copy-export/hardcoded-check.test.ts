import { test } from "node:test";
import assert from "node:assert/strict";
import { type CopyEntry, hardcodedKey } from "./collect.ts";
import { renderCsv } from "./render.ts";
import { compareHardcoded, hardcodedFromCsv } from "./hardcoded-check.ts";

const entry = (overrides: Partial<CopyEntry>): CopyEntry => {
  const file = overrides.file ?? "apps/web/src/pages/areas/AreaListPage.tsx";
  const text = overrides.text ?? "新增区域";
  return {
    area: "tenant",
    page: "区域列表",
    key: hardcodedKey(file, text),
    status: "写死",
    text,
    role: "按钮",
    context: "<Button>",
    file,
    lines: [12],
    usedIn: [],
    ...overrides,
  };
};

const keyed = (overrides: Partial<CopyEntry>): CopyEntry =>
  entry({ key: "checkout.tripTitle", status: "已走 key", file: "apps/web/src/lib/checkout-texts.ts", text: "行程", ...overrides });

test("从 copy.csv 只取「写死」的行：已走 key 的不算，BOM 和表头不算", () => {
  const csv = renderCsv([keyed({}), entry({ text: "保存" }), keyed({ key: "checkout.vehicle", text: "车型" }), entry({ text: "取消" })]);
  const items = hardcodedFromCsv(csv);
  assert.deepEqual(
    items.map((item) => item.text),
    ["保存", "取消"],
  );
  assert.equal(items[0]?.key, hardcodedKey("apps/web/src/pages/areas/AreaListPage.tsx", "保存"));
  assert.equal(items[0]?.file, "apps/web/src/pages/areas/AreaListPage.tsx");
});

test("从 copy.csv 读回带逗号、引号、换行的文案，不错列、不多出行", () => {
  const texts = ["名称, 简称", '点「"保存"」', "第一行\n第二行", "写死"];
  const csv = renderCsv(texts.map((text) => entry({ text })));
  const items = hardcodedFromCsv(csv);
  assert.equal(items.length, texts.length);
  assert.deepEqual(
    items.map((item) => item.key),
    texts.map((text) => hardcodedKey("apps/web/src/pages/areas/AreaListPage.tsx", text)),
  );
  assert.deepEqual(
    items.map((item) => item.text),
    texts,
  );
});

test("文案正好是「写死」两个字、但状态是已走 key 的，不算写死（按「状态」列判断，不按整行搜索）", () => {
  const csv = renderCsv([keyed({ text: "写死" })]);
  assert.deepEqual(hardcodedFromCsv(csv), []);
});

test("条数持平、内容不变：通过，没有新增", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), entry({ text: "取消" })]));
  const result = compareHardcoded(base, base);
  assert.equal(result.pass, true);
  assert.equal(result.baseCount, 2);
  assert.equal(result.headCount, 2);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
});

test("新增一条写死：失败，并列出新增条目的文件和文案", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存" })]));
  const head = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), entry({ file: "apps/web/src/pages/orders/OrderPage.tsx", text: "确认下单" })]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, false);
  assert.equal(result.baseCount, 1);
  assert.equal(result.headCount, 2);
  assert.deepEqual(
    result.added.map((item) => [item.file, item.text]),
    [["apps/web/src/pages/orders/OrderPage.tsx", "确认下单"]],
  );
});

test("减少写死（改成走表）：通过", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), entry({ text: "取消" })]));
  const head = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), keyed({})]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, true);
  assert.equal(result.headCount, 1);
  assert.deepEqual(result.added, []);
  assert.deepEqual(
    result.removed.map((item) => item.text),
    ["取消"],
  );
});

test("删一条加一条（条数不变）：按「条数不增加」放行，但新增条目照样列出来提醒", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), entry({ text: "取消" })]));
  const head = hardcodedFromCsv(renderCsv([entry({ text: "保存" }), entry({ text: "提交" })]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, true);
  assert.equal(result.baseCount, result.headCount);
  assert.deepEqual(
    result.added.map((item) => item.text),
    ["提交"],
  );
  assert.deepEqual(
    result.removed.map((item) => item.text),
    ["取消"],
  );
});

test("同一句文案搬到另一个文件：算新增一条、删掉一条（身份是文件 + 文字），条数不变放行", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存" })]));
  const head = hardcodedFromCsv(renderCsv([entry({ file: "apps/web/src/pages/areas/AreaEditPage.tsx", text: "保存" })]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, true);
  assert.deepEqual(
    result.added.map((item) => item.file),
    ["apps/web/src/pages/areas/AreaEditPage.tsx"],
  );
  assert.equal(result.removed.length, 1);
});

test("只改行号（上面插了几行代码）：不算新增也不算删除", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "保存", lines: [12] })]));
  const head = hardcodedFromCsv(renderCsv([entry({ text: "保存", lines: [40, 52] })]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, true);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
});

test("删两条加三条：总数多一条就失败，三条新增都列出来", () => {
  const base = hardcodedFromCsv(renderCsv([entry({ text: "a1" }), entry({ text: "a2" }), entry({ text: "keep" })]));
  const head = hardcodedFromCsv(renderCsv([entry({ text: "keep" }), entry({ text: "b1" }), entry({ text: "b2" }), entry({ text: "b3" })]));
  const result = compareHardcoded(base, head);
  assert.equal(result.pass, false);
  assert.equal(result.headCount - result.baseCount, 1);
  assert.deepEqual(
    result.added.map((item) => item.text),
    ["b1", "b2", "b3"],
  );
});

test("main 上还没有写死条目（空清单）时，新增任何一条都失败", () => {
  const result = compareHardcoded([], hardcodedFromCsv(renderCsv([entry({ text: "保存" })])));
  assert.equal(result.pass, false);
  assert.equal(result.added.length, 1);
});

test("比较不依赖顺序：同一批条目打乱顺序结果一样", () => {
  const items = hardcodedFromCsv(renderCsv([entry({ text: "x" }), entry({ text: "y" }), entry({ text: "z" })]));
  const result = compareHardcoded(items, [...items].reverse());
  assert.equal(result.pass, true);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
});
