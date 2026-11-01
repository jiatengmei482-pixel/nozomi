/** 收款账户和银行转账文件的手写类型与 `apps/api/openapi.yaml` 对账（M5-02）：后端改了路径、字段或枚举，这里就失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { BANK_FILE_STATUSES, CHARGE_BEARERS, PAYOUT_ACCOUNT_KINDS, PAYOUT_ACCOUNT_STATUSES, STATEMENT_FILE_ISSUES } from "@nozomi/domain";
import { BANK_FILES_PATH, BANK_FILE_SCHEMA_FIELDS, PLATFORM_PAYOUT_ACCOUNTS_PATH, TENANT_PAYOUT_ACCOUNTS_PATH } from "./bank-files.ts";
import { PAYOUT_BATCHES_PATH } from "./billing.ts";

interface Schema {
  enum?: string[];
  properties?: Record<string, Schema>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, Schema> } };
const schemas = spec.components.schemas;
const sorted = (values: readonly string[]): string[] => [...values].sort();

test("前端用到的接口都在 openapi.yaml 里", () => {
  const expected: [string, string][] = [
    [TENANT_PAYOUT_ACCOUNTS_PATH, "get"],
    [TENANT_PAYOUT_ACCOUNTS_PATH, "post"],
    [`${TENANT_PAYOUT_ACCOUNTS_PATH}/{id}/withdraw`, "post"],
    [PLATFORM_PAYOUT_ACCOUNTS_PATH, "get"],
    [`${PLATFORM_PAYOUT_ACCOUNTS_PATH}/{id}/approval`, "post"],
    [`${PLATFORM_PAYOUT_ACCOUNTS_PATH}/{id}/reject`, "post"],
    [`${PAYOUT_BATCHES_PATH}/{id}/bank-file-preview`, "get"],
    [`${PAYOUT_BATCHES_PATH}/{id}/bank-files`, "post"],
    [BANK_FILES_PATH, "get"],
    [`${BANK_FILES_PATH}/{id}`, "get"],
    [`${BANK_FILES_PATH}/{id}/download`, "post"],
    [`${BANK_FILES_PATH}/{id}/payments`, "post"],
    [`${BANK_FILES_PATH}/{id}/void`, "post"],
  ];
  for (const [path, method] of expected) assert.ok(spec.paths[path]?.[method], `${method} ${path}`);
});

test("字段和 openapi.yaml 一模一样；接口里没有完整账号", () => {
  for (const [name, fields] of Object.entries(BANK_FILE_SCHEMA_FIELDS)) {
    assert.deepEqual(sorted(Object.keys(schemas[name]?.properties ?? {})), sorted(fields), name);
    assert.ok(!(fields as readonly string[]).includes("account_number"), name);
  }
});

test("枚举和 @nozomi/domain 一致", () => {
  assert.deepEqual(schemas["BankFileStatus"]?.enum, [...BANK_FILE_STATUSES]);
  assert.deepEqual(schemas["PayoutAccountStatus"]?.enum, [...PAYOUT_ACCOUNT_STATUSES]);
  assert.deepEqual(schemas["StatementFileIssue"]?.enum, [...STATEMENT_FILE_ISSUES]);
  assert.deepEqual(schemas["BankFile"]?.properties?.["charge_bearer"]?.enum, [...CHARGE_BEARERS]);
  assert.deepEqual(schemas["TenantPayoutAccount"]?.properties?.["account_kind"]?.enum, [...PAYOUT_ACCOUNT_KINDS]);
});
