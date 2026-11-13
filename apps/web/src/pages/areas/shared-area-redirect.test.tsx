/** 引用被平台转到保留的那份时（M8-31b）的提示：来源和选的不同才提示；没改名时说保留那份的名称，改了名只说「保留的同一块区域」。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Area } from "../../api/areas.ts";
import { redirectedName } from "./SharedAreaDialog.tsx";

const PICKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KEEP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const copy = (source: string | null, name = "银座一带"): Area => ({ name: { zh: name }, shared_source: source === null ? null : { shared_area_id: source, shape_version: 1, latest_shape_version: 1 } }) as unknown as Area;

test("来源就是选的那份：不提示", () => {
  assert.equal(redirectedName(copy(PICKED), PICKED, true), undefined);
  assert.equal(redirectedName(copy(PICKED.toUpperCase()), PICKED, true), undefined);
  assert.equal(redirectedName(copy(null), PICKED, true), undefined);
});

test("被转到保留的那份：没改名说名称，改了名说不出名称（null）", () => {
  assert.equal(redirectedName(copy(KEEP, "银座（保留）"), PICKED, true), "银座（保留）");
  assert.equal(redirectedName(copy(KEEP, "我的银座"), PICKED, false), null);
});
