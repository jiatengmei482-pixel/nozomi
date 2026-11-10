import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_ENVS } from "@nozomi/config";
import { QA_TENANT_ENVS, QA_TENANT_NAME, QA_TENANT_NAME_MARK, qaTenantAllowed } from "./qa-tenant.ts";

test("QA 测试供应商（ADR 0077）只允许 staging、local、ci；production 永远不允许", () => {
  assert.deepEqual(APP_ENVS.filter(qaTenantAllowed), ["local", "ci", "staging"]);
  assert.equal(qaTenantAllowed("production"), false);
  assert.ok(!QA_TENANT_ENVS.includes("production"));
});

test("QA 测试供应商的名称带「QA 测试」字样", () => {
  assert.ok(QA_TENANT_NAME.includes(QA_TENANT_NAME_MARK));
  assert.equal(QA_TENANT_NAME_MARK, "QA 测试");
});
