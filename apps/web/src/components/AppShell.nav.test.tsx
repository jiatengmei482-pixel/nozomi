/**
 * 菜单的可见条件和页面自己的查看权限一致（M4-10）：菜单里出现的每一项，点进去都不能是「你没有权限查看这里」。
 * 下面两张表是各页面检查的查看权限（和页面里 `usePlatformCan` / `useTenantCan` 的读权限、后端接口的权限同一个口径）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ACTIONS, type PlatformAction, PLATFORM_ROLES, TENANT_ROLES, type TenantAction, actionsOfGrants, allMenuGrants, platformPermissions, tenantRoleCan } from "@nozomi/domain";
import { type NavEntry, type NavLeaf, navEntries } from "./AppShell.tsx";

const PLATFORM_PAGE_VIEW: Readonly<Record<string, PlatformAction>> = {
  "/platform/tenants": "tenant.read",
  "/platform/tenant-documents": "tenant.read",
  "/platform/products": "product.read",
  "/platform/quote-preview": "quote.preview",
  "/platform/channels": "channel.read",
  "/platform/approvals": "approval.read",
  "/platform/orders": "order.read",
  "/platform/rescues": "order.read",
  "/platform/cancellation-policy": "master_data.read",
  "/platform/webhook-deliveries": "order.read",
  "/platform/master/cities": "master_data.read",
  "/platform/master/places": "master_data.read",
  "/platform/master/vehicle-groups": "master_data.read",
  "/platform/master/addons": "master_data.read",
  "/platform/master/fx-rates": "master_data.read",
  "/platform/settings/staff": "staff.read",
  "/platform/settings/roles": "role.read",
  "/platform/settings/audit-logs": "audit_log.read",
  "/platform/settings/integrations": "integration.read",
};

const TENANT_PAGE_VIEW: Readonly<Record<string, TenantAction>> = {
  "/areas": "area.read",
  "/products": "product.read",
  "/price-rules": "product.read",
  "/orders": "order.read",
  "/rescue-offers": "order.dispatch",
  "/deductions": "order.read",
  "/fleet/drivers": "fleet.read",
  "/fleet/vehicles": "fleet.read",
  "/company": "company.read",
  "/performance": "performance.read",
  "/settings/webhook": "webhook.read",
};

function leaves(entries: readonly NavEntry[]): NavLeaf[] {
  return entries.flatMap((entry) => ("children" in entry ? [...entry.children] : [entry]));
}

function platformMenu(actions: ReadonlySet<PlatformAction>): NavLeaf[] {
  return leaves(navEntries("platform", "/platform", "custom_test", (action) => actions.has(action))).filter((leaf) => leaf.to !== "/platform");
}

function unauthorized(actions: ReadonlySet<PlatformAction>): string[] {
  return platformMenu(actions)
    .filter((leaf) => {
      const needed = PLATFORM_PAGE_VIEW[leaf.to];
      return needed === undefined || !actions.has(needed);
    })
    .map((leaf) => `${leaf.label}（${leaf.to}）`);
}

test("运营后台菜单：每一项都登记了页面的查看权限（新加菜单项要在这里登记）", () => {
  const all = platformMenu(new Set(PLATFORM_ACTIONS));
  assert.deepEqual(all.map((leaf) => leaf.to).filter((to) => PLATFORM_PAGE_VIEW[to] === undefined), []);
  assert.deepEqual(Object.keys(PLATFORM_PAGE_VIEW).filter((to) => !all.some((leaf) => leaf.to === to)), [], "表里登记的页面超级管理员都看得到");
});

test("运营后台菜单：菜单条件用到的权限的所有组合下，菜单里没有点进去没权限的项", () => {
  // 菜单条件里会用到的权限：各页面的查看权限，加上「取消政策」看是不是用得到的发起 / 审核权限
  const relevant = [...new Set<PlatformAction>([...Object.values(PLATFORM_PAGE_VIEW), "cancellation_policy.manage", "cancellation_policy.review"])];
  assert.ok(relevant.length <= 16, "组合数不超过 65,536");
  for (let mask = 0; mask < 1 << relevant.length; mask += 1) {
    const actions = new Set(relevant.filter((_, index) => (mask & (1 << index)) !== 0));
    const bad = unauthorized(actions);
    if (bad.length > 0) assert.fail(`权限 ${[...actions].join("、") || "（无）"} 时菜单出现了看不了的：${bad.join("、")}`);
  }
});

test("运营后台菜单：内置角色、每一项勾选、任意两项勾选的自建角色，菜单里都没有点进去没权限的项", () => {
  for (const role of PLATFORM_ROLES) assert.deepEqual(unauthorized(new Set(platformPermissions(role.key))), [], role.name);
  const grants = allMenuGrants();
  for (const first of grants) {
    for (const second of grants) assert.deepEqual(unauthorized(new Set(actionsOfGrants([first, second]))), [], `${first} + ${second}`);
  }
});

test("运营后台菜单：只勾了「订单 · 查看」的自建角色看不到「取消政策」；能看主数据又管订单或审核取消政策的看得到", () => {
  const labels = (grants: string[]) => platformMenu(new Set(actionsOfGrants(grants))).map((leaf) => leaf.label);
  assert.ok(!labels(["orders:view"]).includes("取消政策"));
  assert.ok(labels(["orders:view"]).includes("订单"));
  assert.ok(labels(["orders:view", "cancellation_policy:view"]).includes("取消政策"));
  assert.ok(labels(["cancellation_policy:view", "cancellation_policy:review"]).includes("取消政策"));
  assert.ok(labels(["cancellation_policy:view", "cancellation_policy:edit"]).includes("取消政策"));
  assert.ok(!labels(["master_data:view"]).includes("取消政策"), "只看主数据的（主数据运营）菜单里不放");
});

test("供应商后台菜单：每个角色的菜单里都没有点进去没权限的项，每一项都登记了页面的查看权限", () => {
  for (const role of TENANT_ROLES) {
    const menu = leaves(navEntries("tenant", "/", role.key, () => false)).filter((leaf) => leaf.to !== "/");
    const bad = menu.filter((leaf) => {
      const needed = TENANT_PAGE_VIEW[leaf.to];
      return needed === undefined || !tenantRoleCan(role.key, needed);
    });
    assert.deepEqual(bad.map((leaf) => leaf.to), [], role.name);
  }
});
