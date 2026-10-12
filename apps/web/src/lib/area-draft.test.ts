import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { type AreaDraft, DRAFT_PREFIX, clearAllAreaDrafts, clearAreaDraft, draftKey, draftTimeText, readAreaDraft, writeAreaDraft } from "./area-draft.ts";

class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const store = new MemoryStorage();
Object.defineProperty(globalThis, "sessionStorage", { value: store, configurable: true });
afterEach(() => {
  for (let index = store.length - 1; index >= 0; index -= 1) store.removeItem(store.key(index) ?? "");
});

const owner = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
const AREA = "33333333-3333-4333-8333-333333333333";
const draft: AreaDraft = {
  savedAt: "2026-10-08T05:30:00.000Z",
  baseVersion: 4,
  cityId: null,
  name: { zh: "东京 23 区" },
  bizType: "general",
  shapes: [
    { key: "s1", id: AREA, kind: "operate", seq: 1, label: "", source: "drawn", ring: [[139.6, 35.6], [139.8, 35.6], [Number.NaN, 35.8]], circle: null },
    { key: "s2", id: null, kind: "forbid", seq: 1, label: "皇居", source: "circle", ring: [], circle: { lat: 35.7, lng: 139.7, radiusM: 500 } },
  ],
};

test("草稿：存进去读出来一样（没填完的格子还是没填完）；键按供应商、账号、区域区分，新增页是 new；互不串", () => {
  assert.equal(writeAreaDraft(owner, AREA, draft), true);
  assert.deepEqual(readAreaDraft(owner, AREA), draft);
  assert.equal(draftKey(owner, null), `${DRAFT_PREFIX}${owner.tenantId}.${owner.userId}.new`);
  assert.equal(readAreaDraft(owner, null), null);
  assert.equal(readAreaDraft({ ...owner, userId: "another-user" }, AREA), null);
  assert.equal(readAreaDraft({ ...owner, tenantId: "another-tenant" }, AREA), null);
  for (let index = 0; index < store.length; index += 1) assert.ok(store.key(index)?.startsWith(DRAFT_PREFIX));
  assert.doesNotMatch(store.getItem(draftKey(owner, AREA) ?? "") ?? "", /token|password|Bearer/i);
});

test("草稿：读出来的内容被改坏了、不是这个结构、太大，都当作没有；编号里有奇怪的字符不存不读", () => {
  const key = draftKey(owner, AREA) ?? "";
  const stored = (value: unknown): AreaDraft | null => {
    store.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    return readAreaDraft(owner, AREA);
  };
  assert.equal(stored("{不是 JSON"), null);
  assert.equal(stored([]), null);
  assert.equal(stored({ ...draft, savedAt: "昨天" }), null);
  assert.equal(stored({ ...draft, bizType: "everything" }), null);
  assert.equal(stored({ ...draft, shapes: [{ ...draft.shapes[0], kind: "other" }] }), null);
  assert.equal(stored({ ...draft, shapes: [{ ...draft.shapes[0], ring: [["139", "35"]] }] }), null);
  assert.equal(stored({ ...draft, shapes: [draft.shapes[0], draft.shapes[0]] }), null, "图形的本地编号不能重复");
  assert.equal(stored({ ...draft, shapes: [{ ...draft.shapes[0], key: "<script>" }] }), null);
  assert.deepEqual(stored({ ...draft, name: { zh: "名字", xx: "不认识的语言", ja: 5 } })?.name, { zh: "名字" });
  assert.equal(stored(`{"pad":"${"x".repeat(2_000_001)}"}`), null);
  assert.equal(draftKey({ tenantId: "a.b", userId: "u" }, AREA), null);
  assert.equal(writeAreaDraft({ tenantId: "t", userId: "u" }, "../x", draft), false);
  const huge: AreaDraft = { ...draft, shapes: [{ ...(draft.shapes[0] as AreaDraft["shapes"][number]), label: "x".repeat(2_000_001) }] };
  assert.equal(writeAreaDraft(owner, AREA, huge), false, "太大的不存");
});

test("草稿：清一份只清那一份；退出登录时清掉全部草稿，但不碰别的键（登录状态）", () => {
  writeAreaDraft(owner, AREA, draft);
  writeAreaDraft(owner, null, draft);
  store.setItem("nozomi.session.tenant", "保留");
  clearAreaDraft(owner, AREA);
  assert.equal(readAreaDraft(owner, AREA), null);
  assert.deepEqual(readAreaDraft(owner, null), draft);
  clearAllAreaDrafts();
  assert.equal(readAreaDraft(owner, null), null);
  assert.equal(store.getItem("nozomi.session.tenant"), "保留");
});

test("草稿的时间写成本地的 MM-DD HH:mm", () => {
  const at = new Date(2026, 9, 8, 14, 5);
  assert.equal(draftTimeText(at.toISOString()), "10-08 14:05");
});
