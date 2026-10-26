/**
 * M4-10 测试角色：菜单与页面权限的反方向——看得了的页面，菜单里都要有入口（没有被藏掉的）。
 * 正方向（菜单里每一项点进去都看得了）见 AppShell.nav.test.tsx；这里另外核对「页面要的查看权限」那张表本身是不是和页面代码一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLATFORM_MENUS, type PlatformAction, actionsOfGrants, allMenuGrants } from "@nozomi/domain";
import { type NavEntry, type NavLeaf, navEntries } from "./AppShell.tsx";

function leaves(entries: readonly NavEntry[]): NavLeaf[] {
  return entries.flatMap((entry) => ("children" in entry ? [...entry.children] : [entry]));
}

function menuOf(grants: readonly string[]): string[] {
  const actions = new Set<PlatformAction>(actionsOfGrants(grants));
  return leaves(navEntries("platform", "/platform", "custom_test", (action) => actions.has(action))).map((leaf) => leaf.to);
}

/** 角色页上每个「菜单」对应的页面（勾了这个菜单的「查看」，就该在左侧菜单里看到这些页面）。 */
const MENU_PAGES: Readonly<Record<string, readonly string[]>> = {
  tenants: ["/platform/tenants", "/platform/tenant-documents"],
  products: ["/platform/products"],
  quote_preview: ["/platform/quote-preview"],
  channels: ["/platform/channels"],
  orders: ["/platform/orders", "/platform/webhook-deliveries"],
  exceptions: ["/platform/exceptions"],
  rescues: ["/platform/rescues"],
  cancellation_policy: ["/platform/cancellation-policy"],
  tickets: ["/platform/tickets"],
  compensation_table: ["/platform/compensation-table"],
  approvals: ["/platform/approvals"],
  finance: ["/platform/finance/statements", "/platform/finance/payout-batches"],
  master_data: ["/platform/master/cities", "/platform/master/places", "/platform/master/vehicle-groups", "/platform/master/addons", "/platform/master/fx-rates"],
  staff: ["/platform/settings/staff"],
  roles: ["/platform/settings/roles"],
  audit_logs: ["/platform/settings/audit-logs"],
  integrations: ["/platform/settings/integrations"],
};

test("角色页的每个菜单都登记了对应页面（新加菜单要在这里登记）", () => {
  assert.deepEqual(PLATFORM_MENUS.map((menu) => menu.key).filter((key) => MENU_PAGES[key] === undefined), []);
});

test("自建角色只勾某个菜单的「查看」：左侧菜单里有这个菜单的页面（看得了却没有入口 = 被藏掉）", () => {
  const hidden: string[] = [];
  for (const menu of PLATFORM_MENUS) {
    const shown = menuOf([`${menu.key}:view`]);
    for (const page of MENU_PAGES[menu.key] ?? []) if (!shown.includes(page)) hidden.push(`只勾「${menu.name} · 查看」：菜单里没有 ${page}`);
  }
  assert.deepEqual(hidden, []);
});

test("自建角色勾了某个菜单的「查看」，再加任何一格别的勾选：这个菜单的页面仍在左侧菜单里", () => {
  const grants = allMenuGrants();
  const hidden = new Set<string>();
  for (const menu of PLATFORM_MENUS) {
    for (const other of grants) {
      const shown = menuOf([`${menu.key}:view`, other]);
      for (const page of MENU_PAGES[menu.key] ?? []) if (!shown.includes(page)) hidden.add(`「${menu.name} · 查看」：${page}`);
    }
  }
  assert.deepEqual([...hidden], []);
});

/** 页面文件里检查的查看权限（`usePlatformCan("xxx.read")` 那一行的 canRead）。 */
const PAGE_GUARDS: readonly [string, string, PlatformAction][] = [
  ["/platform/cancellation-policy", "../pages/platform/CancellationPolicyPage.tsx", "master_data.read"],
  ["/platform/compensation-table", "../pages/platform/CompensationTablePage.tsx", "master_data.read"],
  ["/platform/rescues", "../pages/platform/RescuePages.tsx", "order.read"],
  ["/platform/exceptions", "../pages/platform/ExceptionPages.tsx", "order.read"],
  ["/platform/webhook-deliveries", "../pages/webhooks/WebhookPages.tsx", "order.read"],
  ["/platform/tenant-documents", "../pages/platform/DocumentQueuePage.tsx", "tenant.read"],
  ["/platform/tickets", "../pages/platform/TicketPages.tsx", "ticket.read"],
];

test("页面代码里检查的查看权限，和菜单权限表（AppShell.nav.test.tsx）登记的一致；除了「主数据运营不放取消政策、赔付表」这条有意的例外，只有这项权限时菜单里就有这个页面", () => {
  for (const [path, file, action] of PAGE_GUARDS) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    assert.match(source, new RegExp(`canRead = usePlatformCan\\("${action.replace(".", "\\.")}"\\)`), `${file} 检查的是 ${action}`);
    if (action === "master_data.read") continue;
    const shown = leaves(navEntries("platform", "/platform", "custom_test", (candidate) => candidate === action)).map((leaf) => leaf.to);
    assert.ok(shown.includes(path), `只有 ${action} 时 ${path} 页面看得了，菜单里却没有`);
  }
});
