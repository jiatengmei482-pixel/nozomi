import { test } from "node:test";
import assert from "node:assert/strict";
import { outOfOrderMigrations } from "../../../scripts/check-migration-order.mjs";

test("新增的迁移编号必须大于基准上的最大编号：插在已有编号之前的被拦下，已有的和更大的放行", () => {
  const base = ["0051_pricing_impact_inputs.sql", "0070_billing.sql", "README.md"];
  assert.deepEqual(outOfOrderMigrations(base, [...base, "0060_order_center_tickets.sql", "0080_integration_secrets.sql"]), ["0060_order_center_tickets.sql"]);
  assert.deepEqual(outOfOrderMigrations(base, [...base, "0070_other.sql"]), ["0070_other.sql"], "和已有最大编号相同也不行");
  assert.deepEqual(outOfOrderMigrations(base, [...base, "0075_order_center_tickets.sql"]), []);
  assert.deepEqual(outOfOrderMigrations([], ["0001_init.sql"]), [], "基准上还没有迁移");
  assert.deepEqual(outOfOrderMigrations(base, [...base, "notes.txt"]), [], "不是迁移文件的不管");
});

test("CI 的 PR 检查里跑迁移编号核对（和 main 比）", async () => {
  const { readFile } = await import("node:fs/promises");
  const ci = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /git fetch --no-tags --depth=1 origin main/);
  assert.match(ci, /run: node scripts\/check-migration-order\.mjs origin\/main/);
});
