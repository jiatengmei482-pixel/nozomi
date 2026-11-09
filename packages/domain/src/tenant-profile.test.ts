import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILE_CHANGE_FIELDS, PROFILE_KEYS, TENANT_DIRECT_PROFILE_KEYS, type ProfileValues, changedProfileKeys, profileChangeDrift, profileChangeIssues, profileFieldsText, tenantLockedProfileKeys } from "./tenant-profile.ts";

const profile: ProfileValues = {
  country_code: "JP",
  legal_name: "株式会社テスト",
  registration_no: "0100-01-000001",
  address: "東京都千代田区1-1",
  contact_name: "山田",
  contact_phone: "+81 3-0000-0000",
  contact_email: "ops@example.test",
};

test("改了哪几项：按固定顺序；没有旧值时每个非空项都算改了", () => {
  assert.deepEqual(changedProfileKeys(profile, { ...profile, contact_phone: "+81 3-1111-1111", legal_name: "新名称" }), ["legal_name", "contact_phone"]);
  assert.deepEqual(changedProfileKeys(profile, profile), []);
  assert.deepEqual(changedProfileKeys(null, { ...profile, address: null }), ["country_code", "legal_name", "registration_no", "contact_name", "contact_phone", "contact_email"]);
});

test("申请中什么都能直接改；审核通过以后只能直接改联系信息和注册地址", () => {
  const changedAll: ProfileValues = Object.fromEntries(PROFILE_KEYS.map((key) => [key, `${profile[key] ?? ""}x`])) as ProfileValues;
  assert.deepEqual(tenantLockedProfileKeys("applying", profile, changedAll), []);
  for (const status of ["reviewing", "signed", "trial", "active", "suspended"]) {
    assert.deepEqual(tenantLockedProfileKeys(status, profile, changedAll), ["country_code", "legal_name", "registration_no"], status);
    assert.deepEqual(tenantLockedProfileKeys(status, profile, { ...profile, address: "新地址", contact_name: "佐藤", contact_phone: "+81 3", contact_email: "new@example.test" }), [], status);
  }
  // 没改的锁定项不算（整体替换时原样带回来）
  assert.deepEqual(tenantLockedProfileKeys("active", profile, { ...profile, contact_name: "佐藤" }), []);
  // 以前没有企业信息（M4-01 之前的正式供应商）：能补联系信息，不能顺手填法定名称
  assert.deepEqual(tenantLockedProfileKeys("active", null, { ...profile, country_code: null, legal_name: null, registration_no: null }), []);
  assert.deepEqual(tenantLockedProfileKeys("active", null, profile), ["country_code", "legal_name", "registration_no"]);
  assert.deepEqual([...TENANT_DIRECT_PROFILE_KEYS].sort(), ["address", "contact_email", "contact_name", "contact_phone"]);
});

test("修改申请：至少一项；不能为空、不超长、不能和现在一样", () => {
  const current = { name: "NOZOMI 测试车队", legal_name: "株式会社テスト", registration_no: null };
  assert.deepEqual(profileChangeIssues({}, current), [{ path: "/", reason: "REQUIRED" }]);
  assert.deepEqual(profileChangeIssues({ name: "新名字" }, current), []);
  assert.deepEqual(profileChangeIssues({ registration_no: "0100-01" }, current), []);
  assert.deepEqual(profileChangeIssues({ name: "", legal_name: "株式会社テスト", registration_no: "x".repeat(101) }, current), [
    { path: "/name", reason: "EMPTY" },
    { path: "/legal_name", reason: "UNCHANGED" },
    { path: "/registration_no", reason: "TOO_LONG" },
  ]);
  // 长度按字符数（日文、中文、表情各算一个）
  assert.deepEqual(profileChangeIssues({ name: "車".repeat(100) }, current), []);
  assert.deepEqual(profileChangeIssues({ name: "😀".repeat(100) }, current), []);
  assert.deepEqual(profileChangeIssues({ name: "車".repeat(101) }, current), [{ path: "/name", reason: "TOO_LONG" }]);
});

test("批准时核对：提交时的旧值被平台改过的项要报出来，没在申请里的项不管", () => {
  const current = { name: "A", legal_name: "B", registration_no: null };
  assert.deepEqual(profileChangeDrift({ name: "A" }, current), []);
  assert.deepEqual(profileChangeDrift({ name: "旧", registration_no: null }, current), ["name"]);
  assert.deepEqual(profileChangeDrift({ registration_no: "1" }, current), ["registration_no"]);
  assert.deepEqual(profileChangeDrift({}, { ...current, legal_name: "改过" }), []);
});

test("改了哪几项的中文；三项要审核的字段都有名字", () => {
  assert.equal(profileFieldsText(["name", "legal_name", "contact_phone"]), "对外显示名称、法定名称、联系电话");
  for (const field of PROFILE_CHANGE_FIELDS) assert.notEqual(profileFieldsText([field]), field);
});
