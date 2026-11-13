import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Ring } from "./areas.ts";
import { type DuplicateCandidate, duplicateMarkProblem, sharedAreaSimilarity } from "./shared-areas.ts";

const square = (lng: number, lat: number, size: number): Ring => [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size]];

describe("sharedAreaSimilarity：同名、营运区重叠", () => {
  it("名称键有一个相同就算同名；营运区相交、包含都算重叠；名称在前", () => {
    assert.deepEqual(sharedAreaSimilarity({ nameKeys: ["银座"], operateRings: [square(0, 0, 1)] }, { nameKeys: ["ginza", "银座"], operateRings: [square(0.5, 0.5, 1)] }), ["name", "overlap"]);
    assert.deepEqual(sharedAreaSimilarity({ nameKeys: ["a"], operateRings: [square(0, 0, 4)] }, { nameKeys: ["b"], operateRings: [square(1, 1, 1)] }), ["overlap"]);
    assert.deepEqual(sharedAreaSimilarity({ nameKeys: ["a"], operateRings: [] }, { nameKeys: ["a"], operateRings: [square(1, 1, 1)] }), ["name"]);
  });

  it("不同名、不重叠：没有理由", () => {
    assert.deepEqual(sharedAreaSimilarity({ nameKeys: ["a"], operateRings: [square(0, 0, 1)] }, { nameKeys: ["b"], operateRings: [square(5, 5, 1)] }), []);
  });
});

describe("duplicateMarkProblem：标记重复的条件（不形成链）", () => {
  const area = (id: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({ id, cityId: "tokyo", inLibrary: true, hidden: false, keptFor: 0, ...extra });

  it("两份都在库里、同城、都没有标记：可以", () => {
    assert.equal(duplicateMarkProblem(area("a"), area("b")), null);
    assert.equal(duplicateMarkProblem(area("a"), area("b", { keptFor: 2 })), null, "保留的那份可以同时是几份的保留");
  });

  it("被隐藏的那份不存在或不在库里 → SHARED_AREA_NOT_FOUND", () => {
    assert.equal(duplicateMarkProblem(null, area("b")), "SHARED_AREA_NOT_FOUND");
    assert.equal(duplicateMarkProblem(area("a", { inLibrary: false }), area("b")), "SHARED_AREA_NOT_FOUND");
  });

  it("自己标成自己 → DUPLICATE_SAME_AREA", () => {
    assert.equal(duplicateMarkProblem(area("a"), area("a")), "DUPLICATE_SAME_AREA");
  });

  it("已隐藏 → SHARED_AREA_ALREADY_HIDDEN；是别人的保留那份 → SHARED_AREA_IS_KEEP_TARGET", () => {
    assert.equal(duplicateMarkProblem(area("a", { hidden: true }), area("b")), "SHARED_AREA_ALREADY_HIDDEN");
    assert.equal(duplicateMarkProblem(area("a", { keptFor: 1 }), area("b")), "SHARED_AREA_IS_KEEP_TARGET");
  });

  it("保留的那份不存在、不在库里、自己也被隐藏 → DUPLICATE_KEEP_UNAVAILABLE；不同城 → DUPLICATE_CITY_MISMATCH", () => {
    assert.equal(duplicateMarkProblem(area("a"), null), "DUPLICATE_KEEP_UNAVAILABLE");
    assert.equal(duplicateMarkProblem(area("a"), area("b", { inLibrary: false })), "DUPLICATE_KEEP_UNAVAILABLE");
    assert.equal(duplicateMarkProblem(area("a"), area("b", { hidden: true })), "DUPLICATE_KEEP_UNAVAILABLE");
    assert.equal(duplicateMarkProblem(area("a"), area("b", { cityId: "osaka" })), "DUPLICATE_CITY_MISMATCH");
  });
});
