/**
 * 取不到账号信息（`auth/me` 失败）时，报价试算和编辑渠道不能一直停在骨架屏（M4-15 的 `AccountLoadFailed`）：给重试，重试后正常打开。
 * 接口是替身，数据都是测试里构造的虚构值。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CHANNEL_ID = "55555555-5555-4555-8555-555555555555";
const user = { id: "66666666-6666-4666-8666-666666666666", email: "qa@platform.test", name: "虚构员工", role: "super_admin", role_name: "超级管理员", status: "active" };

function open(path: string, respond: (call: ApiCall & { url: URL }) => Response | null): void {
  signIn("platform", "platform-token");
  let attempts = 0;
  stubApiWith((call) => {
    if (call.url.pathname === "/platform/v1/auth/me") {
      attempts += 1;
      return attempts === 1 ? json(500, { error: { code: "INTERNAL_ERROR", message: "出错了", details: {} } }) : json(200, { user, permissions: [], must_change_password: false });
    }
    return respond(call);
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const assertRetryOffered = async (): Promise<void> => {
  await screen.findByRole("heading", { name: "加载失败" });
  assert.equal(document.querySelector(".skeleton"), null, "还停在骨架屏");
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
};

test("报价试算：取不到账号信息给重试，不停在骨架屏；重试后打开页面", async () => {
  open("/platform/quote-preview", (call) => (call.method === "GET" ? json(200, { items: [], next_cursor: null, truncated: false }) : null));
  await assertRetryOffered();
  assert.ok(await screen.findByRole("heading", { level: 1, name: "报价试算" }));
});

test("编辑渠道：取不到账号信息给重试，不停在骨架屏；重试后不再是加载失败", async () => {
  open(`/platform/channels/${CHANNEL_ID}/edit`, (call) => (call.url.pathname === `/platform/v1/channels/${CHANNEL_ID}` ? json(404, { error: { code: "CHANNEL_NOT_FOUND", message: "没有", details: {} } }) : call.method === "GET" ? json(200, { items: [], next_cursor: null }) : null));
  await assertRetryOffered();
  assert.ok(await screen.findByText("找不到这个渠道"), "账号读回来后页面才去读渠道");
});
