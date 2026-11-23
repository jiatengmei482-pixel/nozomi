/**
 * 测试用：把法律文案的待补项填齐（M9E-24，ADR 0107）。正式环境（APP_ENV=production）没填齐时官网不开放预订，
 * 按 production 起应用测官网的用例先调这个。值只在测试里构造，随测试 schema 一起删除。
 */
import type { TestApi } from "./api.ts";
import { ok } from "./market.ts";

export const FILLED_LEGAL_FIELDS: Readonly<Record<string, string>> = {
  seller_name: "テスト販売事業者",
  japan_contact: "請求があった場合は遅滞なく開示します",
  contact_email: "legal@example.test",
  mail_provider: "テストメール事業者",
  mail_provider_country: "米国",
  map_provider: "テスト地図事業者",
  map_provider_country: "英国",
  server_provider: "テストサーバー事業者",
  server_provider_country: "日本",
  published_on: "2026-12-01",
};

/** 用超级管理员的令牌填齐（已经保存过的带上当前版本号） */
export async function fillLegalSettings(api: TestApi, rootToken: string): Promise<void> {
  const current = await ok(api.call("GET", "/platform/v1/legal-settings", { token: rootToken }));
  await ok(api.call("PUT", "/platform/v1/legal-settings", { token: rootToken, body: { fields: FILLED_LEGAL_FIELDS }, ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }) }));
}
