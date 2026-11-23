/**
 * 官网三份法律文案页面（M9E-24，ADR 0107）的组件测试：待补项有值显示值（多行保留换行、邮箱是 mailto、制定日写成日文日期），没值显示「未設定」；
 * キャンセルポリシー第 2 条的表按接口返回的取消政策生成（默认政策和改过的政策各一次，确认不是写死的）；读取中、读失败重试；页脚的三个链接。
 * 接口用测试替身；真实后端由 e2e/legal-pages.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { type CancellationPolicy, DEFAULT_CANCELLATION_POLICY, LEGAL_FIELD_KEYS } from "@nozomi/domain";
import { App } from "../../App.tsx";
import type { LegalFieldValues, SiteLegal, SiteLegalPolicyRule } from "../../api/legal.ts";
import { apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const EMPTY = Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, null])) as LegalFieldValues;
const FILLED: LegalFieldValues = {
  seller_name: "テスト販売株式会社",
  japan_contact: "東京都千代田区テスト1-2-3\n03-0000-0000",
  contact_email: "legal@example.com",
  mail_provider: "テストメール社",
  mail_provider_country: "テスト国A",
  map_provider: "テスト地図社",
  map_provider_country: "テスト国B",
  server_provider: "テストサーバー社",
  server_provider_country: "テスト国C",
  published_on: "2026-12-01",
};

const rulesOf = (policy: CancellationPolicy): SiteLegalPolicyRule[] => policy.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) }));
const legalOf = (fields: LegalFieldValues, policy: CancellationPolicy = DEFAULT_CANCELLATION_POLICY): SiteLegal => ({
  fields,
  complete: Object.values(fields).every((value) => value !== null),
  cancellation_policy: { version: 3, effective_at: null, rules: rulesOf(policy) },
});

function open(path: string, legal: () => Response): void {
  stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return apiError(503, "SITE_NOT_OPEN", "官网暂未开放");
    if (call.method === "GET" && call.url.pathname === "/site/v1/legal") return legal();
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const unsetCount = (scope: HTMLElement = document.body): number => within(scope).queryAllByText("未設定").length;
const rowOf = (table: HTMLElement, header: string): HTMLElement => within(table).getByRole("rowheader", { name: header }).closest("tr") as HTMLElement;
const cellsOf = (row: HTMLElement): string[] => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent ?? "");

test("特定商取引法に基づく表記：待补项有值时显示值（日本国内の連絡先保留换行、メールアドレス是 mailto）；正文 lang=ja，标题是日文；官网没开放也能看", async () => {
  open("/legal/tokushoho", () => json(200, legalOf(FILLED)));
  const table = await screen.findByRole("region", { name: "特定商取引法に基づく表記" });
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "特定商取引法に基づく表記");
  assert.equal(document.title, "特定商取引法に基づく表記｜NOZOMI");
  assert.equal(screen.getByRole("article").getAttribute("lang"), "ja");
  assert.deepEqual(cellsOf(rowOf(table, "販売事業者")), ["販売事業者", "テスト販売株式会社"]);
  assert.equal(within(rowOf(table, "日本国内の連絡先")).getByText(/東京都千代田区/).textContent, "東京都千代田区テスト1-2-3\n03-0000-0000");
  assert.equal(within(rowOf(table, "メールアドレス")).getByRole("link", { name: "legal@example.com" }).getAttribute("href"), "mailto:legal@example.com");
  assert.deepEqual(cellsOf(rowOf(table, "運営統括責任者")), ["運営統括責任者", "Lucas"]);
  assert.deepEqual(cellsOf(rowOf(table, "電話番号")), ["電話番号", "+852 5809 0316"]);
  assert.equal(unsetCount(), 0);
  assert.doesNotMatch(document.body.textContent ?? "", /【|RELAX CAR SERVICE/, "不出现稿子里的【 】和待确认的事业者名");
});

test("特定商取引法に基づく表記：没填的三项显示「未設定」，不出现链接", async () => {
  open("/legal/tokushoho", () => json(200, legalOf(EMPTY)));
  const table = await screen.findByRole("region", { name: "特定商取引法に基づく表記" });
  for (const item of ["販売事業者", "日本国内の連絡先", "メールアドレス"]) assert.deepEqual(cellsOf(rowOf(table, item)), [item, "未設定"]);
  assert.equal(unsetCount(table), 3);
  assertAbsent(within(table).queryByRole("link"));
});

test("プライバシーポリシー：开头的事业者名、第 4 条表格最后三行的事业者和所在国、第 7 条的邮箱、制定日都用待补项", async () => {
  open("/legal/privacy", () => json(200, legalOf(FILLED)));
  const table = await screen.findByRole("region", { name: "業務委託先・外部サービス" });
  assert.equal(document.title, "プライバシーポリシー｜NOZOMI");
  assert.ok(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "テスト販売株式会社（以下「当社」）は、お客様の個人情報を以下のとおり取り扱います。"));
  assert.deepEqual(cellsOf(rowOf(table, "テストメール社")), ["テストメール社", "テスト国A", "予約確認等のメール送信", "メールアドレス、氏名、予約内容"]);
  assert.deepEqual(cellsOf(rowOf(table, "テスト地図社")), ["テスト地図社", "テスト国B", "画面上の地図表示", "お客様のブラウザから直接通信するため IP アドレス"]);
  assert.deepEqual(cellsOf(rowOf(table, "テストサーバー社")), ["テストサーバー社", "テスト国C", "システム・データの保管", "保存するすべての情報"]);
  assert.deepEqual(cellsOf(rowOf(table, "Anthropic, PBC")).slice(1, 2), ["米国"]);
  const contact = screen.getByRole("region", { name: "7. 開示・訂正・削除のご請求・お問い合わせ" });
  assert.equal(within(contact).getByRole("link", { name: "legal@example.com" }).getAttribute("href"), "mailto:legal@example.com");
  assert.match(screen.getByRole("region", { name: "8. 改定" }).textContent ?? "", /（制定日：2026年12月1日）$/);
  assert.equal(unsetCount(), 0);
});

test("プライバシーポリシー：都没填时 9 处显示「未設定」（开头、表格六格、第 7 条、制定日）", async () => {
  open("/legal/privacy", () => json(200, legalOf(EMPTY)));
  const table = await screen.findByRole("region", { name: "業務委託先・外部サービス" });
  assert.equal(unsetCount(table), 6);
  assert.equal(unsetCount(screen.getByRole("region", { name: "7. 開示・訂正・削除のご請求・お問い合わせ" })), 1);
  assert.equal(unsetCount(screen.getByRole("region", { name: "8. 改定" })), 1);
  assert.equal(unsetCount(), 9);
});

test("キャンセルポリシー（默认政策）：第 2 条的表正好是稿子里的三行，列是「無料 / 50% / 100%」；按行写「ちょうど…とします」；不显示开发用的标注", async () => {
  open("/legal/cancellation", () => json(200, legalOf(EMPTY)));
  const region = await screen.findByRole("region", { name: "キャンセル料" });
  const table = within(region).getByRole("table");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((cell) => cell.textContent), ["サービス", "車種", "無料", "50%", "100%"]);
  assert.deepEqual(
    [...table.querySelectorAll("tbody tr")].map((row) => cellsOf(row as HTMLElement)),
    [
      ["空港送迎・地点間送迎", "エコノミー・コンフォート", "24 時間前まで", "24 時間前〜6 時間前", "6 時間前以降"],
      ["空港送迎・地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降"],
      ["貸切（チャーター）", "全車種", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降"],
    ],
  );
  const section = screen.getByRole("region", { name: "2. キャンセル料" });
  assert.deepEqual(
    within(section).getAllByRole("listitem").map((item) => item.textContent),
    [
      "空港送迎・地点間送迎（エコノミー・コンフォート）：ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします。",
      "空港送迎・地点間送迎（ビジネス・ラグジュアリー・マイクロバス（10 名以上））：ちょうど 48 時間前は無料、ちょうど 24 時間前は 50% とします。",
      "貸切（チャーター）（全車種）：ちょうど 48 時間前は無料、ちょうど 24 時間前は 50% とします。",
    ],
  );
  assert.ok(within(section).getByText("ご予約画面に、そのご予約に適用されるキャンセル料を表示します。"));
  assert.ok(within(section).getByText("（ご利用日時までの時間に応じ、ご予約総額に対する割合）"));
  assert.doesNotMatch(document.body.textContent ?? "", /後台|【/);
  assert.equal(document.title, "キャンセルポリシー｜NOZOMI");
  for (const heading of ["1. キャンセル方法", "3. ノーショー（無断不乗車）", "4. 無料でキャンセルできる場合", "5. 返金", "6. 日時変更", "7. サービス後の追加請求"]) assert.ok(screen.getByRole("heading", { name: heading }));
});

test("キャンセルポリシー（改过的政策）：列、行、格子、「ちょうど」那几句都跟着接口返回的政策变；这一行没有的档显示「—」", async () => {
  const changed: CancellationPolicy = DEFAULT_CANCELLATION_POLICY.map((rule) => {
    if (rule.category === "charter") return { ...rule, tiers: [{ minHoursBefore: 72, feeBp: 0 }, { minHoursBefore: 12, feeBp: 2500 }, { minHoursBefore: 0, feeBp: 10000 }] };
    if (rule.level === "economy" || rule.level === "comfort") return { ...rule, tiers: [{ minHoursBefore: 24, feeBp: 0 }, { minHoursBefore: 0, feeBp: 10000 }] };
    return rule;
  });
  open("/legal/cancellation", () => json(200, legalOf(FILLED, changed)));
  const table = within(await screen.findByRole("region", { name: "キャンセル料" })).getByRole("table");
  assert.deepEqual([...table.querySelectorAll("thead th")].map((cell) => cell.textContent), ["サービス", "車種", "無料", "25%", "50%", "100%"]);
  assert.deepEqual(
    [...table.querySelectorAll("tbody tr")].map((row) => cellsOf(row as HTMLElement)),
    [
      ["空港送迎・地点間送迎", "エコノミー・コンフォート", "24 時間前まで", "—", "—", "24 時間前以降"],
      ["空港送迎・地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）", "48 時間前まで", "—", "48 時間前〜24 時間前", "24 時間前以降"],
      ["貸切（チャーター）", "全車種", "72 時間前まで", "72 時間前〜12 時間前", "—", "12 時間前以降"],
    ],
  );
  const notes = within(screen.getByRole("region", { name: "2. キャンセル料" })).getAllByRole("listitem").map((item) => item.textContent);
  assert.deepEqual(notes, [
    "空港送迎・地点間送迎（エコノミー・コンフォート）：ちょうど 24 時間前は無料とします。",
    "空港送迎・地点間送迎（ビジネス・ラグジュアリー・マイクロバス（10 名以上））：ちょうど 48 時間前は無料、ちょうど 24 時間前は 50% とします。",
    "貸切（チャーター）（全車種）：ちょうど 72 時間前は無料、ちょうど 12 時間前は 25% とします。",
  ]);
});

test("读取中有「読み込み中」；读不出来说怎么办、点「再読み込み」重新读，读到后显示正文", async () => {
  let attempts = 0;
  open("/legal/tokushoho", () => {
    attempts += 1;
    return attempts === 1 ? apiError(500, "INTERNAL_ERROR", "x") : json(200, legalOf(FILLED));
  });
  assert.ok(screen.getByText("読み込み中"));
  assert.ok(await screen.findByRole("heading", { name: "内容を読み込めませんでした" }));
  assert.ok(screen.getByText(/通信環境をご確認のうえ/));
  await userEvent.setup().click(screen.getByRole("button", { name: "再読み込み" }));
  assert.ok(await screen.findByRole("region", { name: "特定商取引法に基づく表記" }));
  assert.equal(attempts, 2);
});

test("主站页脚：三份法律文案的链接（站内地址，日文名称）", async () => {
  open("/legal/privacy", () => json(200, legalOf(FILLED)));
  await screen.findByRole("region", { name: "業務委託先・外部サービス" });
  const footer = within(screen.getByRole("navigation", { name: "法律文案" }));
  assert.deepEqual(
    footer.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]),
    [
      ["特定商取引法に基づく表記", "/legal/tokushoho"],
      ["キャンセルポリシー", "/legal/cancellation"],
      ["プライバシーポリシー", "/legal/privacy"],
    ],
  );
  assert.equal(screen.getByRole("navigation", { name: "法律文案" }).closest("footer")?.className, "site__footer");
});
