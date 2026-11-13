import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlatformSharedArea } from "../api/shared-area-duplicates.ts";
import { keepOptions } from "./shared-area-duplicates.ts";

const area = (id: string, name: string, extra: Partial<PlatformSharedArea> = {}): PlatformSharedArea => ({
  id,
  city_id: "c1",
  name: { zh: name },
  shape_version: 1,
  operate_polygon_count: 1,
  forbid_polygon_count: 0,
  updated_at: "2026-11-13T00:00:00.000Z",
  copy_count: 0,
  duplicate: null,
  similar: [],
  ...extra,
});

test("保留哪一份：同城、没隐藏的其他区域；疑似重复按列表顺序在前并写理由，其余按名称", () => {
  const self = area("a", "银座", { similar: [{ id: "c", reasons: ["overlap"] }, { id: "b", reasons: ["name", "overlap"] }] });
  const options = keepOptions(self, [
    self,
    area("b", "银座", { copy_count: 2 }),
    area("c", "银座一带"),
    area("d", "新宿"),
    area("e", "上野", { duplicate: { id: "m", keep_area_id: "d", keep_area_name: { zh: "新宿" }, keep_area_listed: true, reason: "r", marked_by: { id: "u", name: "md" }, marked_at: "2026-11-13T00:00:00.000Z" } }),
    area("f", "梅田", { city_id: "c2" }),
  ]);
  assert.deepEqual(options, [
    { id: "c", label: "银座一带（营运区重叠；营运区 1 块，被引用 0 份）" },
    { id: "b", label: "银座（同名、营运区重叠；营运区 1 块，被引用 2 份）" },
    { id: "d", label: "新宿（营运区 1 块，被引用 0 份）" },
  ]);
});

test("同城没有别的：没有选项", () => {
  const only = area("a", "银座");
  assert.deepEqual(keepOptions(only, [only]), []);
});
