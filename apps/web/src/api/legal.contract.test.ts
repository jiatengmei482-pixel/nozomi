/** 法律文案（M9E-24）的手写类型与 `apps/api/openapi.yaml` 对账：后端改了路径、字段，这里会失败。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { LEGAL_FIELD_KEYS } from "@nozomi/domain";
import { LEGAL_SETTINGS_FIELDS, LEGAL_SETTINGS_PATH, SITE_LEGAL_FIELDS, SITE_LEGAL_PATH } from "./legal.ts";

interface Schema {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Schema>;
}
interface Operation {
  security?: unknown;
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses?: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
}
const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, Schema> } };
const resolve = (schema: Schema | undefined): Schema | undefined => (schema?.$ref === undefined ? schema : spec.components.schemas[schema.$ref.replace("#/components/schemas/", "")]);
const sorted = (values: readonly string[]): string[] => [...values].sort();
const ok = (method: string, path: string): Schema | undefined => resolve(spec.paths[path]?.[method]?.responses?.["200"]?.content?.["application/json"]?.schema);

test("官网读法律文案的接口不要登录；运营后台读、改待补项要运营后台的令牌", () => {
  assert.ok(spec.paths[SITE_LEGAL_PATH]?.["get"], `GET ${SITE_LEGAL_PATH}`);
  assert.equal(spec.paths[SITE_LEGAL_PATH]?.["get"]?.security, undefined);
  for (const method of ["get", "put"]) assert.deepEqual(spec.paths[LEGAL_SETTINGS_PATH]?.[method]?.security, [{ platformToken: [] }], `${method} ${LEGAL_SETTINGS_PATH}`);
});

test("应答的字段与 openapi.yaml 一致，都是必有的；待补项的键就是 domain 的 LEGAL_FIELD_KEYS", () => {
  const site = ok("get", SITE_LEGAL_PATH);
  assert.deepEqual(sorted(Object.keys(site?.properties ?? {})), sorted(SITE_LEGAL_FIELDS));
  assert.deepEqual(sorted(site?.required ?? []), sorted(SITE_LEGAL_FIELDS));
  for (const method of ["get", "put"]) {
    const settings = ok(method, LEGAL_SETTINGS_PATH);
    assert.deepEqual(sorted(Object.keys(settings?.properties ?? {})), sorted(LEGAL_SETTINGS_FIELDS), method);
    assert.deepEqual(sorted(settings?.required ?? []), sorted(LEGAL_SETTINGS_FIELDS), method);
  }
  const fields = resolve(site?.properties?.["fields"]);
  assert.deepEqual(sorted(Object.keys(fields?.properties ?? {})), sorted(LEGAL_FIELD_KEYS));
  assert.deepEqual(sorted(fields?.required ?? []), sorted(LEGAL_FIELD_KEYS));
  const body = resolve(spec.paths[LEGAL_SETTINGS_PATH]?.["put"]?.requestBody?.content["application/json"]?.schema);
  assert.deepEqual(Object.keys(body?.properties ?? {}), ["fields"]);
  const policy = resolve(site?.properties?.["cancellation_policy"]);
  for (const key of ["version", "rules"]) assert.ok(policy?.properties?.[key], `cancellation_policy.${key}`);
});
