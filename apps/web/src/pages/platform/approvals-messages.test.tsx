/** 待审核页「批准不了」时的说明：合同生效日期已过（M4-01）给出专门的说法，而不是通用的错误提示。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../../api/client.ts";
import { decisionFailure } from "./ApprovalsPage.tsx";

test("合同生效日期已过（CONTRACT_VALID_FROM_PASSED）：说明不能追溯生效、请驳回后按新日期重新发起", () => {
  const text = decisionFailure(new ApiError(409, "CONTRACT_VALID_FROM_PASSED", "valid_from passed", { valid_from: "2026-10-18", today: "2026-10-19" }, null));
  assert.match(text, /生效日期已经过了/);
  assert.match(text, /追溯/);
  assert.match(text, /驳回/);
});
