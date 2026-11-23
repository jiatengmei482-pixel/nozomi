/**
 * 法律页面（M9E-24，ADR 0107）：三页能从主站打开，正文照定稿、留空的几项来自后台设置（没填写「未設定」）；
 * 取消费表按后台的取消政策生成；主站页脚有三个链接。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import { App } from "../../App.tsx";
import type { SiteLegalPages } from "../../api/legal-pages.ts";
import { type ApiCall, apiError, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const config = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: false, page_width: "standard", maps_browser_key: null, map_tiles: null };
const policy = {
  version: 0,
  effective_at: null,
  rules: DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) })),
};
const unset: SiteLegalPages = {
  seller: null,
  japan_contact: null,
  email: null,
  mail_provider: { name: null, country: null },
  map_provider: { name: null, country: null },
  server_provider: { name: null, country: null },
  published_on: null,
  complete: false,
  cancellation_policy: policy,
};
const filled: SiteLegalPages = {
  ...unset,
  seller: "RELAX CAR SERVICE CO. LIMITED（営業名：Relax Airport Taxi）",
  japan_contact: "請求があった場合は遅滞なく開示します",
  email: "support@example.com",
  mail_provider: { name: "Example Mail", country: "米国" },
  map_provider: { name: "Example Maps", country: "米国" },
  server_provider: { name: "Example Cloud", country: "日本" },
  published_on: "2026-12-01",
  complete: true,
};

function open(path: string, pages: SiteLegalPages | "fail"): ApiCall[] {
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, config);
    if (call.url.pathname === "/site/v1/legal-pages") return pages === "fail" ? apiError(503, "SERVICE_UNAVAILABLE", "暂时不可用") : json(200, pages);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

test("特定商取引法に基づく表記：留空的几项没填写「未設定」；填了照填写显示；正文照定稿；页面是日文；页脚有三个链接", async () => {
  open("/legal/tokushoho", unset);
  assert.ok(await screen.findByRole("heading", { level: 1, name: "特定商取引法に基づく表記" }));
  const table = await screen.findByRole("table");
  const row = (label: string) => within(within(table).getByRole("rowheader", { name: label }).closest("tr") as HTMLElement);
  assert.ok(row("販売事業者").getByText("未設定"));
  assert.ok(row("日本国内の連絡先").getByText("未設定"));
  assert.ok(row("メールアドレス").getByText("未設定"));
  assert.ok(row("運営統括責任者").getByText("Lucas"));
  assert.ok(row("電話番号").getByText("+852 5809 0316"));
  assert.equal(screen.getByRole("article").getAttribute("lang"), "ja");
  const footer = within(document.querySelector(".site__footer") as HTMLElement);
  assert.deepEqual(
    footer.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/legal/")).map((link) => link.getAttribute("href")),
    ["/legal/tokushoho", "/legal/cancellation", "/legal/privacy"],
  );
  resetBrowser();
  open("/legal/tokushoho", filled);
  const again = await screen.findByRole("table");
  assert.ok(within(again).getByText("RELAX CAR SERVICE CO. LIMITED（営業名：Relax Airport Taxi）"));
  assert.ok(within(again).getByText("support@example.com"));
  assert.equal(within(again).queryByText("未設定"), null);
});

test("キャンセルポリシー：取消费表按后台政策生成（默认政策下和定稿相同）；「ちょうど…」那句跟着政策", async () => {
  open("/legal/cancellation", unset);
  const table = await screen.findByRole("table");
  assert.deepEqual(
    within(table).getAllByRole("columnheader").map((cell) => cell.textContent),
    ["サービス", "車種", "無料", "50%", "100%"],
  );
  const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
  assert.deepEqual(rows[0], ["空港送迎・地点間送迎", "エコノミー・コンフォート", "24 時間前まで", "24 時間前〜6 時間前", "6 時間前以降"]);
  assert.deepEqual(rows[2], ["貸切（チャーター）", "全車種", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降"]);
  assert.ok(screen.getByText(/ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします。ご予約画面に/));
  assert.ok(screen.getByText(/キャンセル扱いとせず、全額をいただきます/));
});

test("プライバシーポリシー：「当社」、外部服务表里的三家、联系邮箱、制定日来自后台；没填写「未設定」；Anthropic 那一行照定稿", async () => {
  open("/legal/privacy", filled);
  assert.ok(await screen.findByText(/RELAX CAR SERVICE CO\. LIMITED（営業名：Relax Airport Taxi）（以下「当社」）/));
  const table = screen.getByRole("table");
  assert.ok(within(table).getByText("Anthropic, PBC"));
  assert.ok(within(table).getByText("Example Mail"));
  assert.ok(within(table).getByText("日本"));
  assert.ok(screen.getByText(/2026 年 12 月 1 日/));
  resetBrowser();
  open("/legal/privacy", unset);
  assert.ok((await screen.findAllByText("未設定")).length >= 8);
});

test("读不出来：说读不出来，可以再读一次", async () => {
  open("/legal/privacy", "fail");
  assert.ok(await screen.findByText("読み込めませんでした"));
  assert.ok(screen.getByRole("button", { name: "再読み込み" }));
});
