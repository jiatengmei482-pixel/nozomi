/**
 * 新增平台员工时每个角色「现在能做的」：和 @nozomi/domain 的角色权限表一致，不多说、不漏说（M1-13）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ACTIONS, PLATFORM_ROLES, type PlatformAction, platformPermissions } from "@nozomi/domain";
import { PLATFORM_ACTION_PHRASES, roleAbilities } from "./platform-display.ts";

/** 每项权限在说明里一定会出现的字眼。 */
const MENTIONS: Readonly<Record<PlatformAction, string>> = {
  "tenant.read": "供应商",
  "tenant.create": "新建",
  "tenant.change_status": "暂停和恢复",
  "product.read": "商品和价格",
  "quote.preview": "报价试算",
  "master_data.read": "主数据",
  "master_data.manage": "维护主数据",
  "fx.manage": "管理汇率",
  "channel.read": "渠道",
  "channel.manage": "管理渠道",
  "channel.review": "审核渠道",
  "approval.read": "审核",
  "staff.read": "平台员工",
  "staff.manage": "管理平台员工",
  "audit_log.read": "审计日志",
  "integration.read": "系统状态",
};

/** 没有这项权限时，说明里绝不能出现的字眼（「供应商」「主数据」「平台员工」会出现在别的说法里，不在此列）。 */
const NEVER_WITHOUT: Readonly<Partial<Record<PlatformAction, string>>> = {
  "tenant.create": "新建",
  "tenant.change_status": "暂停",
  "product.read": "商品",
  "quote.preview": "报价试算",
  "master_data.manage": "维护",
  "fx.manage": "汇率",
  "channel.read": "渠道",
  "channel.manage": "管理渠道",
  "channel.review": "审核渠道",
  "approval.read": "审核",
  "staff.manage": "管理平台员工",
  "audit_log.read": "审计日志",
  "integration.read": "系统状态",
};

test("每个操作都有说法（表的键就是 domain 的全部 PlatformAction）", () => {
  assert.deepEqual(Object.keys(PLATFORM_ACTION_PHRASES).sort(), [...PLATFORM_ACTIONS].sort());
  assert.deepEqual(Object.keys(MENTIONS).sort(), [...PLATFORM_ACTIONS].sort());
});

for (const { key, name } of PLATFORM_ROLES) {
  test(`${name}：有的每项权限都说到了，没有的一项也不说`, () => {
    const text = roleAbilities(key).join("、");
    const can = new Set<PlatformAction>(platformPermissions(key));
    for (const action of PLATFORM_ACTIONS) {
      if (can.has(action)) assert.ok(text.includes(MENTIONS[action]), `${name} 有 ${action}，说明里没提到：${text}`);
      const forbidden = NEVER_WITHOUT[action];
      if (!can.has(action) && forbidden !== undefined) assert.ok(!text.includes(forbidden), `${name} 没有 ${action}，说明里却有「${forbidden}」：${text}`);
    }
  });
}

test("验收发现的遗漏：运营、招商、渠道经理、客服能报价试算；只读、风控能查看商品", () => {
  for (const role of ["operations", "tenant_onboarding", "channel_manager", "customer_service"] as const) {
    assert.ok(roleAbilities(role).includes("报价试算"), role);
  }
  for (const role of ["readonly", "risk"] as const) {
    assert.ok(roleAbilities(role).includes("查看供应商的商品和价格"), role);
  }
  assert.deepEqual(roleAbilities("readonly"), ["看供应商", "查看供应商的商品和价格", "看主数据", "看渠道", "看待审核的改动"]);
});
