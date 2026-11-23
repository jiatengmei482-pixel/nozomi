import { test } from "node:test";
import assert from "node:assert/strict";
import { type CancellationRule, DEFAULT_CANCELLATION_POLICY, cancellationPolicyIssues } from "./cancellation.ts";
import {
  EMPTY_LEGAL_FIELDS,
  LEGAL_FIELDS,
  LEGAL_FIELD_KEYS,
  cancellationTableColumns,
  cancellationTableRows,
  feeLabelJa,
  legalDateJa,
  legalFieldIssues,
  legalFieldsComplete,
  legalFieldsOf,
  missingLegalFields,
  normalizeLegalValue,
  tierRangeJa,
} from "./legal-pages.ts";

const filled = (): Record<string, string> => ({
  seller_name: "販売事業者名",
  japan_contact: "請求があった場合は遅滞なく開示します",
  contact_email: "support@example.com",
  mail_provider: "メール事業者",
  mail_provider_country: "米国",
  map_provider: "地図事業者",
  map_provider_country: "英国",
  server_provider: "サーバー事業者",
  server_provider_country: "日本",
  published_on: "2026-12-01",
});

test("待补项：每个键都有说明，键不重复", () => {
  assert.deepEqual(
    LEGAL_FIELDS.map((field) => field.key),
    [...LEGAL_FIELD_KEYS],
  );
  assert.equal(new Set(LEGAL_FIELD_KEYS).size, LEGAL_FIELD_KEYS.length);
});

test("待补项：一项不缺才算填齐，缺的按顺序列出", () => {
  assert.equal(legalFieldsComplete(EMPTY_LEGAL_FIELDS), false);
  assert.deepEqual(missingLegalFields(EMPTY_LEGAL_FIELDS), [...LEGAL_FIELD_KEYS]);
  const all = legalFieldsOf(filled());
  assert.equal(legalFieldsComplete(all), true);
  const partial = legalFieldsOf({ ...filled(), japan_contact: "  ", published_on: null });
  assert.equal(legalFieldsComplete(partial), false);
  assert.deepEqual(missingLegalFields(partial), ["japan_contact", "published_on"]);
});

test("待补项：存着的整理成完整一份——缺的为 null，不认识的键、不是字符串的值丢掉，首尾空白去掉", () => {
  const fields = legalFieldsOf({ seller_name: "  A 社 ", old_key: "x", contact_email: 3 });
  assert.equal(fields.seller_name, "A 社");
  assert.equal(fields.contact_email, null);
  assert.equal(Object.hasOwn(fields, "old_key"), false);
  assert.deepEqual(Object.keys(legalFieldsOf(null)).sort(), [...LEGAL_FIELD_KEYS].sort());
});

test("待补项：空白算没填，换行统一成 \\n", () => {
  assert.equal(normalizeLegalValue("   "), null);
  assert.equal(normalizeLegalValue(null), null);
  assert.equal(normalizeLegalValue(" 東京都\r\n03-0000-0000\r"), "東京都\n03-0000-0000");
});

test("校验：没填不算错；不认识的键、非字符串、超长、邮箱、日期", () => {
  assert.deepEqual(legalFieldIssues(filled()), []);
  assert.deepEqual(legalFieldIssues({ seller_name: null, contact_email: "" }), []);
  assert.deepEqual(legalFieldIssues({ nope: "x" }), [{ key: "nope", reason: "UNKNOWN_FIELD" }]);
  assert.deepEqual(legalFieldIssues({ seller_name: 1 }), [{ key: "seller_name", reason: "NOT_TEXT" }]);
  assert.deepEqual(legalFieldIssues({ seller_name: "あ".repeat(201) }), [{ key: "seller_name", reason: "TOO_LONG" }]);
  assert.deepEqual(legalFieldIssues({ seller_name: "あ".repeat(200) }), []);
  assert.deepEqual(legalFieldIssues({ contact_email: "not-an-email" }), [{ key: "contact_email", reason: "EMAIL_INVALID" }]);
  assert.deepEqual(legalFieldIssues({ published_on: "2026-02-30" }), [{ key: "published_on", reason: "DATE_INVALID" }]);
  assert.deepEqual(legalFieldIssues({ published_on: "2026/12/01" }), [{ key: "published_on", reason: "DATE_INVALID" }]);
  assert.deepEqual(legalFieldIssues({ published_on: "2028-02-29" }), []);
});

test("制定日：YYYY-MM-DD 写成「YYYY年M月D日」", () => {
  assert.equal(legalDateJa("2026-12-01"), "2026年12月1日");
  assert.equal(legalDateJa("bad"), "bad");
});

test("扣款比例的列名：0 是無料，基点转百分比不用浮点", () => {
  assert.equal(feeLabelJa(0), "無料");
  assert.equal(feeLabelJa(5_000), "50%");
  assert.equal(feeLabelJa(10_000), "100%");
  assert.equal(feeLabelJa(1_250), "12.5%");
  assert.equal(feeLabelJa(1_205), "12.05%");
  assert.equal(feeLabelJa(1), "0.01%");
});

test("时间段：第一档「まで」、中间「〜」、最后「以降」、只有一档", () => {
  const tiers = [
    { minHoursBefore: 24, feeBp: 0 },
    { minHoursBefore: 6, feeBp: 5_000 },
    { minHoursBefore: 0, feeBp: 10_000 },
  ];
  assert.equal(tierRangeJa(tiers, 0), "24 時間前まで");
  assert.equal(tierRangeJa(tiers, 1), "24 時間前〜6 時間前");
  assert.equal(tierRangeJa(tiers, 2), "6 時間前以降");
  assert.equal(tierRangeJa([{ minHoursBefore: 0, feeBp: 10_000 }], 0), "ご利用時間にかかわらず");
});

test("默认政策正好是业主稿子里的三行", () => {
  assert.deepEqual(cancellationTableColumns(DEFAULT_CANCELLATION_POLICY), [0, 5_000, 10_000]);
  const rows = cancellationTableRows(DEFAULT_CANCELLATION_POLICY);
  assert.deepEqual(
    rows.map((row) => [row.serviceLabel, row.vehicleLabel, ...row.cells, row.boundaryNote]),
    [
      ["空港送迎・地点間送迎", "エコノミー・コンフォート", "24 時間前まで", "24 時間前〜6 時間前", "6 時間前以降", "ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします"],
      ["空港送迎・地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降", "ちょうど 48 時間前は無料、ちょうど 24 時間前は 50% とします"],
      ["貸切（チャーター）", "全車種", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降", "ちょうど 48 時間前は無料、ちょうど 24 時間前は 50% とします"],
    ],
  );
});

test("政策改了表跟着变：新的比例多一列，没有这一档的格子为 null，品类不再合并", () => {
  const policy: CancellationRule[] = DEFAULT_CANCELLATION_POLICY.map((rule) =>
    rule.category === "point_to_point" && rule.level === "economy"
      ? {
          ...rule,
          tiers: [
            { minHoursBefore: 72, feeBp: 0 },
            { minHoursBefore: 12, feeBp: 3_000 },
            { minHoursBefore: 0, feeBp: 10_000 },
          ],
        }
      : { ...rule, tiers: [...rule.tiers] },
  );
  assert.deepEqual(cancellationPolicyIssues(policy), []);
  assert.deepEqual(cancellationTableColumns(policy), [0, 3_000, 5_000, 10_000]);
  const rows = cancellationTableRows(policy);
  assert.deepEqual(
    rows.map((row) => [row.serviceLabel, row.vehicleLabel]),
    [
      ["空港送迎", "エコノミー・コンフォート"],
      ["空港送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）"],
      ["地点間送迎", "エコノミー"],
      ["地点間送迎", "コンフォート"],
      ["地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）"],
      ["貸切（チャーター）", "全車種"],
    ],
  );
  assert.deepEqual(rows[2]?.cells, ["72 時間前まで", "72 時間前〜12 時間前", null, "12 時間前以降"]);
  assert.deepEqual(rows[0]?.cells, ["24 時間前まで", null, "24 時間前〜6 時間前", "6 時間前以降"]);
});

test("相邻两档比例相同：同一格里两段用「、」连起来；只有一档的没有境目说明", () => {
  const policy: CancellationRule[] = DEFAULT_CANCELLATION_POLICY.map((rule) =>
    rule.category === "charter"
      ? {
          ...rule,
          tiers: [
            { minHoursBefore: 48, feeBp: 5_000 },
            { minHoursBefore: 24, feeBp: 5_000 },
            { minHoursBefore: 0, feeBp: 10_000 },
          ],
        }
      : rule.category === "airport_transfer"
        ? { ...rule, tiers: [{ minHoursBefore: 0, feeBp: 10_000 }] }
        : { ...rule, tiers: [...rule.tiers] },
  );
  assert.deepEqual(cancellationPolicyIssues(policy), []);
  const rows = cancellationTableRows(policy);
  const charter = rows.find((row) => row.categories.includes("charter"));
  assert.deepEqual(charter?.cells, [null, "48 時間前まで、48 時間前〜24 時間前", "24 時間前以降"]);
  const airport = rows.find((row) => row.categories.includes("airport_transfer"));
  assert.equal(airport?.vehicleLabel, "全車種");
  assert.deepEqual(airport?.cells, [null, null, "ご利用時間にかかわらず"]);
  assert.equal(airport?.boundaryNote, null);
});
