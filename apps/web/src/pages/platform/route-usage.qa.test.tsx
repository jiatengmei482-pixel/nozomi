/**
 * 系统状态页「路线预估（谷歌地图）」卡片（M2-02，测试角色补充）：服务器把每日上限调低到今天已用的次数以下时，
 * 「还剩」不出现负数、顶部照样警示；14 个原因码作为最近一次失败时都显示原因码和「怎么办」，不显示接口给的原文。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ROUTE_FAILURE_CODES } from "@nozomi/domain";
import { App } from "../../App.tsx";
import type { RouteUsageStatus } from "../../api/platform.ts";
import type { PlatformUser } from "../../api/types.ts";
import { roleName } from "../../lib/portal.ts";
import { ROUTE_FAILURE_TEXT } from "../../lib/route-display.ts";
import { json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const me: PlatformUser = { id: "99999999-9999-4999-8999-999999999999", email: "tech@example.com", name: "技术 一郎", role: "tech", role_name: roleName("platform", "tech") ?? "tech", status: "active", ...stamps };
const FX = { state: "fresh", as_of: "2026-10-26T00:02:32.000Z", auto_fetch: true, last_attempt_status: "accepted", last_attempt_at: "2026-10-26T01:00:00.000Z", last_error_code: null };
const IDLE: RouteUsageStatus = { day: "2026-10-26", calls: 0, daily_limit: 1000, daily_limit_reached: false, failures: 0, refused: 0, last_success_at: null, last_failure: null };

function open(routes: RouteUsageStatus): void {
  signIn("platform", "platform-token");
  stubApiWith((call) => {
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: me, permissions: [], must_change_password: false });
    if (at === "/platform/v1/dashboard/summary") return json(200, { tenants: null, master_data: null });
    if (at === "/platform/v1/integration-secrets") return json(200, { precedence_note: "运营后台填写的优先。", can_manage: false, encryption_configured: true, items: [] });
    if (at === "/platform/v1/integrations") return json(200, { items: [{ key: "googleMaps", label: "谷歌地图", state: "configured", detail: "后台设置（••••1234）" }], fx_center: FX, routes });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/platform/settings/integrations"]}>
      <App />
    </MemoryRouter>,
  );
}
const card = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { level: 2, name: "路线预估（谷歌地图）" })).closest("section") as HTMLElement;

test("每日上限被调低到今天已用的次数以下：「还剩 0 次」而不是负数，顶部照样警示已到上限", async () => {
  open({ ...IDLE, calls: 1_200, daily_limit: 1_000, daily_limit_reached: true, refused: 3 });
  const text = (await card()).textContent ?? "";
  assert.match(text, /1200 \/ 1000 次（含重试）每日上限1000 次，今天还剩 0 次/);
  assert.doesNotMatch(text, /还剩 -/);
  assert.ok(screen.getByText("今天调用谷歌地图的次数已到每日上限（1000 次）"));
});

test("14 个原因码作为最近一次失败：都显示原因码和我们自己写的「怎么办」，不显示接口给的原文", async () => {
  for (const code of ROUTE_FAILURE_CODES) {
    open({ ...IDLE, failures: 1, last_failure: { code, message: "upstream raw text", at: "2026-10-26T02:00:00.000Z" } });
    const text = (await card()).textContent ?? "";
    assert.ok(text.includes(code), code);
    assert.ok(text.includes(ROUTE_FAILURE_TEXT[code]), code);
    assert.ok(!text.includes("upstream raw text"), code);
    resetBrowser();
  }
});
