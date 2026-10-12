/**
 * 对账的补充：contract.test.ts 核对了字段名、必填、枚举，但没有核对字段的类型。
 * 后端把 `expires_at` 改成数字、把 `access_token` 改成对象、把 `token_type` 改成别的方案时，
 * 字段名都没变，原来的对账不会失败，而前端会在运行时出错（过期时间解析不出来、令牌存不进去）。
 * 这里把前端实际依赖的每个字段的类型写下来，逐项与 openapi.yaml 核对。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { PORTALS, type Portal } from "../lib/portal.ts";
import { AUTH_ENDPOINTS, type AuthEndpoint } from "./client.ts";
import { SCHEMA_FIELDS } from "./types.ts";

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: string[];
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  additionalProperties?: boolean;
}
interface Body {
  content?: Record<string, { schema?: Schema }>;
}
interface Operation {
  security?: Record<string, unknown[]>[];
  requestBody?: Body;
  responses: Record<string, Body & { $ref?: string }>;
}
interface OpenApi {
  security?: Record<string, unknown[]>[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; securitySchemes: Record<string, { type: string; scheme?: string }> };
}

const spec = parse(await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8")) as OpenApi;

/** 把 $ref 解开一层，得到「类型」的简短写法：string、string(date-time)、enum(a|b)、array<…>、object。 */
function shape(schema: Schema | undefined): string {
  if (!schema) return "（没有）";
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const target = spec.components.schemas[name];
    return target?.type === "object" ? `ref(${name})` : shape(target);
  }
  if (schema.enum) return `enum(${schema.enum.join("|")})`;
  if (schema.type === "array") return `array<${shape(schema.items)}>`;
  if (schema.type === "string" && schema.format === "date-time") return "string(date-time)";
  return schema.type ?? "（没有 type）";
}

function operation(portal: Portal, endpoint: AuthEndpoint): Operation {
  const { method, path } = AUTH_ENDPOINTS[endpoint];
  const found = spec.paths[`${PORTALS[portal].apiBase}${path}`]?.[method.toLowerCase()];
  assert.ok(found, `openapi.yaml 里没有 ${method} ${PORTALS[portal].apiBase}${path}`);
  return found;
}

const PORTAL_KEYS: readonly Portal[] = ["tenant", "platform"];

/** 前端手写类型里每个字段的类型（apps/web/src/api/types.ts）。枚举的取值由 contract.test.ts 核对，这里只认「是枚举」。 */
const EXPECTED_SHAPES: Record<keyof typeof SCHEMA_FIELDS, Record<string, string | RegExp>> = {
  PlatformUser: { id: "string", email: "string", name: "string", role: /^enum\(/, status: /^enum\(/, created_at: "string(date-time)", updated_at: "string(date-time)" },
  TenantUser: { id: "string", email: "string", name: "string", role: /^enum\(/, status: /^enum\(/, created_at: "string(date-time)", updated_at: "string(date-time)" },
  Tenant: { id: "string", name: "string", status: "enum(active|suspended)", created_at: "string(date-time)", updated_at: "string(date-time)" },
  LoginRequest: { email: "string", password: "string" },
  PlatformLoginResponse: { access_token: "string", token_type: "enum(Bearer)", expires_at: "string(date-time)", user: "ref(PlatformUser)", must_change_password: "boolean" },
  TenantLoginResponse: { access_token: "string", token_type: "enum(Bearer)", expires_at: "string(date-time)", user: "ref(TenantUser)", tenant: "ref(Tenant)", must_change_password: "boolean" },
  AcceptInviteRequest: { token: "string", password: "string" },
  ResetPasswordRequest: { token: "string", password: "string" },
  ChangePasswordRequest: { current_password: "string", new_password: "string" },
};

test("前端依赖的每个字段，类型与 openapi.yaml 一致（令牌是字符串、过期时间是 ISO 时间字符串、令牌方案是 Bearer）", () => {
  for (const [name, fields] of Object.entries(EXPECTED_SHAPES)) {
    const schema = spec.components.schemas[name];
    assert.ok(schema, `openapi.yaml 里没有 schema ${name}`);
    assert.deepEqual(Object.keys(fields).sort(), [...SCHEMA_FIELDS[name as keyof typeof SCHEMA_FIELDS]].sort(), `${name}：这张类型表要和 types.ts 的字段清单一起改`);
    for (const [field, expected] of Object.entries(fields)) {
      const actual = shape(schema.properties?.[field]);
      if (typeof expected === "string") assert.equal(actual, expected, `${name}.${field} 的类型`);
      else assert.match(actual, expected, `${name}.${field} 的类型`);
    }
  }
});

test("auth/me 的 permissions 是字符串枚举的数组；错误体的 code、message 是字符串，details 是对象", () => {
  for (const portal of PORTAL_KEYS) {
    const me = operation(portal, "me").responses["200"]?.content?.["application/json"]?.schema;
    assert.match(shape(me?.properties?.["permissions"]), /^array<enum\(.+\)>$/, `${portal} auth/me 的 permissions`);
  }
  const error = spec.components.schemas["ErrorResponse"]?.properties?.["error"];
  assert.equal(shape(error?.properties?.["code"]), "string");
  assert.equal(shape(error?.properties?.["message"]), "string");
  assert.equal(shape(error?.properties?.["details"]), "object");
  assert.deepEqual(spec.components.schemas["ErrorResponse"]?.required, ["error"]);
});

test("请求体和响应体都是 application/json；登录、接受邀请、重设密码不需要令牌，其余三个接口需要本后台的 Bearer 令牌", () => {
  const publicEndpoints: readonly AuthEndpoint[] = ["login", "acceptInvite", "resetPassword"];
  for (const portal of PORTAL_KEYS) {
    for (const endpoint of Object.keys(AUTH_ENDPOINTS) as AuthEndpoint[]) {
      const op = operation(portal, endpoint);
      if (op.requestBody) assert.deepEqual(Object.keys(op.requestBody.content ?? {}), ["application/json"], `${portal} ${endpoint} 的请求体`);
      const ok = op.responses["200"];
      if (ok) assert.deepEqual(Object.keys(ok.content ?? {}), ["application/json"], `${portal} ${endpoint} 的响应体`);

      const security = op.security ?? spec.security ?? [];
      if (publicEndpoints.includes(endpoint)) {
        assert.deepEqual(security, [], `${portal} ${endpoint} 不应要求登录`);
      } else {
        const schemes = security.flatMap((entry) => Object.keys(entry));
        assert.equal(schemes.length, 1, `${portal} ${endpoint} 应要求恰好一种令牌`);
        const scheme = spec.components.securitySchemes[schemes[0] ?? ""];
        assert.equal(scheme?.type, "http", `${portal} ${endpoint}`);
        assert.equal(scheme?.scheme, "bearer", `${portal} ${endpoint}：前端发的是 Authorization: Bearer`);
        assert.match(schemes[0] ?? "", new RegExp(`^${portal}`), `${portal} ${endpoint} 用的应是本后台的令牌`);
      }
    }
  }
});

test("401 是所有需要登录的接口共有的应答（写在文档总说明里）；设置密码和修改密码声明了 400，登录声明了 401 和 429", async () => {
  const text = await readFile(new URL("../../../api/openapi.yaml", import.meta.url), "utf8");
  assert.match(text, /401 `UNAUTHENTICATED`：没带令牌、令牌无效或已过期、会话已失效/, "前端靠 401 判断登录失效并回登录页");
  for (const portal of PORTAL_KEYS) {
    for (const endpoint of ["acceptInvite", "resetPassword", "changePassword"] as const) {
      assert.ok(operation(portal, endpoint).responses["400"], `${portal} ${endpoint} 没有声明 400`);
    }
    const login = operation(portal, "login").responses;
    assert.ok(login["401"] && login["429"], `${portal} login 应声明 401 和 429`);
  }
});

test("前端没有调用 openapi.yaml 之外的接口：源码里出现的接口路径只有 AUTH_ENDPOINTS 这一张表", async () => {
  const client = await readFile(new URL("./client.ts", import.meta.url), "utf8");
  const literalPaths = [...client.matchAll(/["'`](\/[a-z0-9/_-]*)["'`]/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(literalPaths)].sort(), Object.values(AUTH_ENDPOINTS).map((endpoint) => endpoint.path).sort());
  assert.equal([...client.matchAll(/\bfetch\(/g)].length, 1, "client.ts 里只有一处发请求的地方");
});
