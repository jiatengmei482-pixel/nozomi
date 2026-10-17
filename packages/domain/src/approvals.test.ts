import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_STATUSES, approvalDecisionRefusal, approvalStatusAfter } from "./approvals.ts";

const pending = { status: "pending" as const, requestedBy: "alice" };

test("双人复核：发起人不能批准、驳回自己发起的；另一个人可以", () => {
  assert.equal(approvalDecisionRefusal(pending, "alice", "approve"), "APPROVAL_SELF_REVIEW");
  assert.equal(approvalDecisionRefusal(pending, "alice", "reject"), "APPROVAL_SELF_REVIEW");
  assert.equal(approvalDecisionRefusal(pending, "bob", "approve"), null);
  assert.equal(approvalDecisionRefusal(pending, "bob", "reject"), null);
});

test("撤回：只有发起人自己能撤回", () => {
  assert.equal(approvalDecisionRefusal(pending, "alice", "withdraw"), null);
  assert.equal(approvalDecisionRefusal(pending, "bob", "withdraw"), "APPROVAL_NOT_REQUESTER");
});

test("已经有结论的不能再改", () => {
  for (const status of APPROVAL_STATUSES.filter((s) => s !== "pending")) {
    for (const decision of ["approve", "reject", "withdraw"] as const) {
      assert.equal(approvalDecisionRefusal({ status, requestedBy: "alice" }, "bob", decision), "APPROVAL_NOT_PENDING");
    }
  }
  assert.deepEqual((["approve", "reject", "withdraw"] as const).map(approvalStatusAfter), ["approved", "rejected", "withdrawn"]);
});
