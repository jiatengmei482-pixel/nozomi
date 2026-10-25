import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../api/client.ts";
import { approvalChanges } from "./channel-display.ts";
import { LOCK_DURATION_HOURS, LOCK_HOURS_MESSAGE, LOCK_RATE_FORMAT_MESSAGE, LOCK_REASON_MESSAGE, LOCK_TOO_FAR_MESSAGE, checkLockDraft, lockExpiresAt, lockHoursOf, lockServerErrors } from "./fx-lock-form.ts";

test("锁定值：没填时不报错（填过才报「请填」）；写法不对报格式；和后端同一套解析（字符串上，不经过浮点数）", () => {
  assert.deepEqual(checkLockDraft({ rate: "", reason: "" }, "150", false).errors, { rate: [], reason: [] });
  assert.deepEqual(checkLockDraft({ rate: "  ", reason: "" }, "150", true).errors.rate, ["请填锁定值"]);
  for (const text of ["1.5e2", "-151", "1,512", "0", "abc", "151."]) assert.deepEqual(checkLockDraft({ rate: text, reason: "" }, "150", true).errors.rate, [LOCK_RATE_FORMAT_MESSAGE], text);
  assert.equal(checkLockDraft({ rate: " 151.20 ", reason: "" }, "150", true).rate, "151.2");
});

test("偏离：正好 3% 不用原因，超过就要；超过 20% 不允许；还没取到中央汇率时不判断偏离", () => {
  assert.deepEqual(checkLockDraft({ rate: "154.5", reason: "" }, "150", true).errors, { rate: [], reason: [] });
  assert.deepEqual(checkLockDraft({ rate: "154.51", reason: "" }, "150", true).errors, { rate: [], reason: [LOCK_REASON_MESSAGE] });
  assert.deepEqual(checkLockDraft({ rate: "154.51", reason: "按银行牌价" }, "150", true).errors, { rate: [], reason: [] });
  assert.deepEqual(checkLockDraft({ rate: "180.01", reason: "按银行牌价" }, "150", true).errors, { rate: [LOCK_TOO_FAR_MESSAGE], reason: [] });
  assert.equal(checkLockDraft({ rate: "160", reason: "" }, "150", true).deviation?.changeBp, 667);
  assert.deepEqual(checkLockDraft({ rate: "1600", reason: "" }, null, true), { rate: "1600", deviation: null, errors: { rate: [], reason: [] } });
});

test("锁定多久：选项最长 72 小时；到期时刻从现在算", () => {
  assert.equal(Math.max(...LOCK_DURATION_HOURS), 72);
  assert.equal(lockExpiresAt(new Date("2026-10-18T00:00:00.000Z"), 24), "2026-10-19T00:00:00.000Z");
});

test("服务器拒收的原因放回字段；认识的错误码给人话；不认识的交给调用方", () => {
  const validation = new ApiError(400, "VALIDATION_FAILED", "x", { issues: [{ path: "/rate", reason: "INVALID_RATE", message: "x" }, { path: "/reason", reason: "REASON_REQUIRED", message: "x" }, { path: "/", reason: "UNCHANGED", message: "和现在的锁定一样" }, { path: "/expires_at", reason: "EXPIRES_TOO_LATE", message: "锁定最长 72 小时" }] }, null);
  assert.deepEqual(lockServerErrors(validation), { rate: [LOCK_RATE_FORMAT_MESSAGE], reason: [LOCK_REASON_MESSAGE], form: ["和现在的锁定一样，不用发起", "锁定最长 72 小时"] });
  assert.deepEqual(lockServerErrors(new ApiError(409, "FX_RATE_UNAVAILABLE", "x", {}, null))?.form, ["还没有汇率，无法和中央汇率比对；请先拉取汇率"]);
  assert.deepEqual(lockServerErrors(new ApiError(409, "FX_LOCK_NOT_ACTIVE", "x", {}, null))?.form, ["这条锁定已经结束（到期、解除或被取代），不用再解锁"]);
  assert.equal(lockServerErrors(new ApiError(500, "INTERNAL", "x", {}, null)), null);
  assert.equal(lockServerErrors(new Error("x")), null);
});

test("复核记录里汇率锁定改了什么：锁定值、到期时间、偏离；解锁写明恢复用中央汇率", () => {
  const created = approvalChanges("fx_lock.create", { currency: "JPY", rate: null, central_rate: "150" }, { currency: "JPY", rate: "151.2", expires_at: "2026-10-19T00:00:00.000Z", central_rate: "150", deviation_bp: 80 }, null);
  assert.deepEqual(created.map((line) => [line.label, line.before]), [["锁定值", "未锁定（中央汇率 1 USD = 150 JPY）"], ["到期时间", "—"], ["和发起时中央汇率的偏离", "—"]]);
  assert.deepEqual([created[0]?.after, created[2]?.after], ["1 USD = 151.2 JPY", "+0.80%"]);
  const replaced = approvalChanges("fx_lock.create", { lock_id: "x", currency: "JPY", rate: "151.2", expires_at: "2026-10-19T00:00:00.000Z" }, { currency: "JPY", rate: "152", expires_at: "2026-10-20T00:00:00.000Z", central_rate: "150", deviation_bp: 133 }, null);
  assert.deepEqual([replaced[0]?.before, replaced[0]?.after], ["1 USD = 151.2 JPY", "1 USD = 152 JPY"]);
  const released = approvalChanges("fx_lock.release", { lock_id: "x", currency: "JPY", rate: "151.2", expires_at: "2026-10-19T00:00:00.000Z" }, { lock_id: "x", currency: "JPY", rate: null, central_rate: "149" }, null);
  assert.deepEqual(released.map((line) => [line.label, line.before.startsWith("1 USD") || line.before !== "—", line.after]), [["锁定值", true, "解除，恢复用中央汇率（发起时 149）"], ["到期时间", true, "—"]]);
});

test("锁定多久不预选（M1-18）：空值和不在选项里的都算没选；选了的换成小时数", () => {
  assert.equal(lockHoursOf(""), null);
  assert.equal(lockHoursOf("5"), null);
  assert.equal(lockHoursOf("abc"), null);
  assert.equal(lockHoursOf("24"), 24);
  assert.equal(lockHoursOf("72"), 72);
  assert.equal(LOCK_HOURS_MESSAGE, "请选择锁定多久");
});
