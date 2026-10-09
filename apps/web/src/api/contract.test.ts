/**
 * 前端手写的接口类型与 `apps/api/openapi.yaml` 对账。
 * 后端改了路径、方法、字段名或枚举值，这里会失败，提醒前端跟着改。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { PLATFORM_ACTIONS, PLATFORM_ROLES, TENANT_ACTIONS, TENANT_ROLES } from "@nozomi/domain";
import { PORTALS, type Portal } from "../lib/portal.ts";
import { API_PATH_PREFIXES } from "../lib/api-prefixes.ts";
import { AUTH_ENDPOINTS, type AuthEndpoint } from "./client.ts";
import { ME_FIELDS, SCHEMA_FIELDS, SCHEMA_FIELDS_ARE_COMPLETE, TENANT_STATUSES } from "./types.ts";

interface Schema {
  $ref?: string;
  type?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}
interface Body {
  content?: { "application/json"?: { schema?: Schema } };
}
interface Operation {
  security?: Record<string, unknown[]>[];
  requestBody?: Body & { required?: boolean };
  responses: Record<string, Body & { $ref?: string; headers?: Record<string, unknown> }>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Schema>;
    responses: Record<string, Body & { headers?: Record<string, unknown> }>;
  };
}

const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as OpenApi;

function refName(schema: Schema | undefined): string | undefined {
  return schema?.$ref?.replace("#/components/schemas/", "");
}

function operation(portal: Portal, endpoint: AuthEndpoint): Operation {
  const { method, path } = AUTH_ENDPOINTS[endpoint];
  const fullPath = `${PORTALS[portal].apiBase}${path}`;
  const found = spec.paths[fullPath]?.[method.toLowerCase()];
  assert.ok(found, `openapi.yaml 里没有 ${method} ${fullPath}`);
  return found;
}

function schemaOf(body: Body | undefined): Schema | undefined {
  return body?.content?.["application/json"]?.schema;
}

const PORTAL_KEYS: readonly Portal[] = ["tenant", "platform"];

test("前端用到的每个接口，路径和方法都在 openapi.yaml 里", () => {
  for (const portal of PORTAL_KEYS) {
    for (const endpoint of Object.keys(AUTH_ENDPOINTS) as AuthEndpoint[]) operation(portal, endpoint);
  }
});

test("接口前缀都在转给 API 的前缀表里", () => {
  for (const path of Object.keys(spec.paths)) {
    assert.ok(
      API_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      `${path} 不在 API_PATH_PREFIXES 里，反向代理不会把它转给 API`,
    );
  }
});

test("手写类型的字段与 openapi.yaml 的同名 schema 完全一致，且都是必填", () => {
  assert.equal(SCHEMA_FIELDS_ARE_COMPLETE, true);
  for (const [name, fields] of Object.entries(SCHEMA_FIELDS)) {
    const schema = spec.components.schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...fields].sort(), `${name} 的字段不一致`);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...fields].sort(), `${name} 的必填字段不一致`);
  }
});

test("各接口的请求体和响应体就是前端以为的那个 schema", () => {
  const expectations: Record<Portal, { login: string; user: string }> = {
    tenant: { login: "TenantLoginResponse", user: "TenantUser" },
    platform: { login: "PlatformLoginResponse", user: "PlatformUser" },
  };
  for (const portal of PORTAL_KEYS) {
    const expected = expectations[portal];
    const loginOp = operation(portal, "login");
    assert.equal(refName(schemaOf(loginOp.requestBody)), "LoginRequest");
    assert.equal(refName(schemaOf(loginOp.responses["200"])), expected.login);
    assert.ok(loginOp.responses["401"], "登录失败应是 401");
    assert.equal(loginOp.responses["429"]?.$ref, "#/components/responses/TooManyLoginAttempts");

    assert.ok(operation(portal, "logout").responses["204"]);

    const me = schemaOf(operation(portal, "me").responses["200"]);
    assert.deepEqual(Object.keys(me?.properties ?? {}).sort(), [...ME_FIELDS[portal]].sort());
    assert.deepEqual([...(me?.required ?? [])].sort(), [...ME_FIELDS[portal]].sort());
    assert.equal(refName(me?.properties?.["user"]), expected.user);
    if (portal === "tenant") assert.equal(refName(me?.properties?.["tenant"]), "Tenant");

    for (const [endpoint, request] of [
      ["acceptInvite", "AcceptInviteRequest"],
      ["resetPassword", "ResetPasswordRequest"],
    ] as const) {
      const op = operation(portal, endpoint);
      assert.equal(refName(schemaOf(op.requestBody)), request);
      const ok = schemaOf(op.responses["200"]);
      assert.deepEqual(ok?.required, ["user"]);
      assert.equal(refName(ok?.properties?.["user"]), expected.user);
      assert.deepEqual(op.security, [], `${endpoint} 应该不需要登录`);
    }

    const change = operation(portal, "changePassword");
    assert.equal(refName(schemaOf(change.requestBody)), "ChangePasswordRequest");
    assert.ok(change.responses["204"]);
    assert.equal(change.responses["429"]?.$ref, "#/components/responses/TooManyLoginAttempts");
  }
});

test("限流应答带 Retry-After；错误体是 { error: { code, message, details } }", () => {
  assert.ok(spec.components.responses["TooManyLoginAttempts"]?.headers?.["Retry-After"]);
  const error = spec.components.schemas["ErrorResponse"]?.properties?.["error"];
  assert.deepEqual(error?.required, ["code", "message", "details"]);
});

test("角色、操作、租户状态的取值与 openapi.yaml 一致", () => {
  const { schemas } = spec.components;
  assert.deepEqual(schemas["PlatformRole"]?.enum, PLATFORM_ROLES.map((role) => role.key));
  assert.deepEqual(schemas["TenantRole"]?.enum, TENANT_ROLES.map((role) => role.key));
  assert.deepEqual(schemas["PlatformAction"]?.enum, [...PLATFORM_ACTIONS]);
  assert.deepEqual(schemas["TenantAction"]?.enum, [...TENANT_ACTIONS]);
  assert.deepEqual(schemas["Tenant"]?.properties?.["status"]?.enum, [...TENANT_STATUSES]);
});

test("前端依赖的错误码都写在 openapi.yaml 里", async () => {
  const text = await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8");
  for (const code of [
    "INVITE_INVALID",
    "RESET_TOKEN_INVALID",
    "WEAK_PASSWORD",
    "CURRENT_PASSWORD_INCORRECT",
    "PASSWORD_UNCHANGED",
    "TOO_MANY_LOGIN_ATTEMPTS",
    "UNAUTHENTICATED",
  ]) {
    assert.ok(text.includes(`\`${code}\``), `openapi.yaml 里找不到错误码 ${code}`);
  }
});
