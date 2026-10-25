import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlatformSessionPurpose, type SecondFactorState, platformSessionRefusal, secondFactorState } from "./second-factor.ts";

test("会话的两步验证状态", () => {
  assert.equal(secondFactorState(true, true), "verified");
  assert.equal(secondFactorState(true, false), "verified");
  assert.equal(secondFactorState(false, true), "verify_required");
  assert.equal(secondFactorState(false, false), "enrollment_required");
});

test("先两步验证、后改密码：每种状态 × 用途的放行表", () => {
  const purposes: PlatformSessionPurpose[] = ["self_service", "second_factor", "password_change", "general"];
  const table: Record<string, (string | null)[]> = {
    // [self_service, second_factor, password_change, general]
    "verify_required/false": [null, null, "MFA_REQUIRED", "MFA_REQUIRED"],
    "verify_required/true": [null, null, "MFA_REQUIRED", "MFA_REQUIRED"],
    "enrollment_required/false": [null, null, "MFA_REQUIRED", "MFA_REQUIRED"],
    "enrollment_required/true": [null, null, "MFA_REQUIRED", "MFA_REQUIRED"],
    "verified/false": [null, null, null, null],
    "verified/true": [null, "PASSWORD_CHANGE_REQUIRED", null, "PASSWORD_CHANGE_REQUIRED"],
  };
  for (const [key, expected] of Object.entries(table)) {
    const [state, must] = key.split("/") as [SecondFactorState, string];
    purposes.forEach((purpose, i) => assert.equal(platformSessionRefusal(state, must === "true", purpose), expected[i], `${key} ${purpose}`));
  }
});
