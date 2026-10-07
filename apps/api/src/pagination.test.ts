import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "./errors.ts";
import { decodeCodeCursor, decodeSequenceCursor, decodeTimeCursor, encodeCursor, isUuid, toPage } from "./pagination.ts";

const ID = "11111111-1111-4111-8111-111111111111";

test("游标编码后能原样解码；没有游标时返回 null", () => {
  const time = { t: "2026-10-07 01:00:00.123456+00", id: ID };
  assert.deepEqual(decodeTimeCursor(encodeCursor(time)), time);
  assert.deepEqual(decodeSequenceCursor(encodeCursor({ id: "42" })), { id: "42" });
  assert.equal(decodeTimeCursor(null), null);
  assert.equal(decodeSequenceCursor(null), null);
});

test("无效的游标：400 VALIDATION_FAILED，指出是 cursor 参数", () => {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const bad = [
    "not-base64-json",
    encode("text"),
    encode(null),
    encode({ t: "2026-10-07", id: ID }),
    encode({ t: "2026-10-07 01:00:00+00", id: "1; drop table tenants" }),
    encode({ t: "now()", id: ID }),
    encode({ id: "42" }),
  ];
  for (const cursor of bad) {
    assert.throws(
      () => decodeTimeCursor(cursor),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 400 &&
        err.code === "VALIDATION_FAILED" &&
        JSON.stringify(err.details).includes("/cursor"),
      cursor,
    );
  }
  for (const cursor of [encode({ id: "0" }), encode({ id: "-1" }), encode({ id: 5 }), encode({ id: "1 or 1=1" })]) {
    assert.throws(() => decodeSequenceCursor(cursor), AppError, cursor);
  }
});

test("游标形状对但值不合法（不存在的日期、越界的时分秒和时区、超过 bigint 的编号）：同样是 400", () => {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const badTimes = [
    "2026-13-01 00:00:00+00",
    "2026-00-10 00:00:00+00",
    "2026-02-30 00:00:00+00",
    "2025-02-29 00:00:00+00",
    "0000-01-01 00:00:00+00",
    "2026-01-01 24:00:00+00",
    "2026-01-01 23:60:00+00",
    "2026-01-01 23:59:60+00",
    "2026-01-01 00:00:00+16",
    "2026-01-01 00:00:00+99",
    "2026-01-01 00:00:00-15:60",
  ];
  for (const t of badTimes) assert.throws(() => decodeTimeCursor(encode({ t, id: ID })), AppError, t);
  for (const id of ["9223372036854775808", "9999999999999999999"]) {
    assert.throws(() => decodeSequenceCursor(encode({ id })), AppError, id);
  }
});

test("合法的边界值照常接受：闰日、一天的最后一秒、±15:59 的时区、bigint 的最大值", () => {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const goodTimes = [
    "2024-02-29 00:00:00+00",
    "2026-12-31 23:59:59.999999+00",
    "2026-01-01 00:00:00+15:59",
    "2026-01-01 00:00:00-15",
    "0001-01-01 00:00:00+00",
    "9999-12-31 00:00:00+09",
  ];
  for (const t of goodTimes) assert.deepEqual(decodeTimeCursor(encode({ t, id: ID })), { t, id: ID }, t);
  assert.deepEqual(decodeSequenceCursor(encode({ id: "9223372036854775807" })), { id: "9223372036854775807" });
});

test("toPage：多取到一行说明还有下一页，游标指向本页最后一行", () => {
  const rows = [{ id: "3" }, { id: "2" }, { id: "1" }];
  const page = toPage(rows, 2, (row) => row.id, (row) => ({ id: row.id }));
  assert.deepEqual(page.items, ["3", "2"]);
  assert.deepEqual(decodeSequenceCursor(page.nextCursor), { id: "2" });
});

test("toPage：刚好取满或不满一页时没有下一页；空结果也没有", () => {
  const toCursor = (row: { id: string }): { id: string } => ({ id: row.id });
  assert.equal(toPage([{ id: "2" }, { id: "1" }], 2, (row) => row.id, toCursor).nextCursor, null);
  assert.equal(toPage([{ id: "1" }], 2, (row) => row.id, toCursor).nextCursor, null);
  assert.deepEqual(toPage([], 2, (row: { id: string }) => row.id, toCursor), { items: [], nextCursor: null });
});

test("isUuid", () => {
  assert.equal(isUuid(ID), true);
  assert.equal(isUuid(ID.toUpperCase()), true);
  for (const value of ["", "1", `${ID}0`, ID.replaceAll("-", ""), `${ID.slice(0, -1)}g`]) assert.equal(isUuid(value), false, value);
});

test("按编码排序的游标：能原样解回来；按创建时间排序的游标、畸形的编码、缺字段的都拒绝，反过来也一样", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(decodeCodeCursor(encodeCursor({ c: "STN-JP-TOKYO-E1", id })), { c: "STN-JP-TOKYO-E1", id });
  assert.deepEqual(decodeCodeCursor(encodeCursor({ c: "ADD-CHILD_SEAT", id })), { c: "ADD-CHILD_SEAT", id });
  assert.equal(decodeCodeCursor(null), null);
  const timeCursor = encodeCursor({ t: "2026-10-07 01:00:00+00", id });
  assert.throws(() => decodeCodeCursor(timeCursor), /请求参数校验未通过/);
  assert.throws(() => decodeTimeCursor(encodeCursor({ c: "HND", id })), /请求参数校验未通过/);
  for (const bad of [{ c: "hnd", id }, { c: "", id }, { c: "HND'; --", id }, { c: "X".repeat(51), id }, { c: 1, id }, { c: "HND" }, { c: "HND", id: "nope" }]) {
    assert.throws(() => decodeCodeCursor(Buffer.from(JSON.stringify(bad)).toString("base64url")), /请求参数校验未通过/, JSON.stringify(bad));
  }
});
