/** 应用账号自检的判定规则（ADR 0010）：什么样的数据库账号可以用来运行服务。纯函数，不需要数据库。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type DbIdentity, DbIdentityError, identityProblems } from "./identity.ts";
import { DB_ROLES } from "./roles.ts";

const LEAST_PRIVILEGE: DbIdentity = {
  login: "nozomi_api",
  superuser: false,
  createRole: false,
  createDb: false,
  bypassRls: false,
  replication: false,
  memberOf: [...DB_ROLES],
  inherits: [],
  canSetRoleTo: [...DB_ROLES],
  ownedRelations: 0,
  ownsDatabase: false,
  unsafeRoles: [],
};

test("最小权限的应用账号：只是三个权限角色的成员、不自动继承、没有任何特殊属性——合格", () => {
  assert.deepEqual(identityProblems(LEAST_PRIVILEGE), []);
});

test("每一种权限过大的情况都单独被指出", () => {
  const cases: [Partial<DbIdentity>, RegExp][] = [
    [{ bypassRls: true }, /BYPASSRLS/],
    [{ createRole: true }, /CREATEROLE/],
    [{ createDb: true }, /CREATEDB/],
    [{ replication: true }, /REPLICATION/],
    [{ ownsDatabase: true }, /数据库的所有者/],
    [{ ownedRelations: 3 }, /拥有或可以接管 3 张表/],
    [{ memberOf: [...DB_ROLES, "pg_read_all_data"] }, /属于不该属于的角色：pg_read_all_data/],
    [{ canSetRoleTo: ["nozomi_app"] }, /不能切换到角色：nozomi_platform、nozomi_preauth/],
    [{ inherits: ["nozomi_platform"] }, /NOINHERIT.*nozomi_platform/],
    [{ unsafeRoles: ["nozomi_app"] }, /权限角色本身带着危险属性.*nozomi_app/],
  ];
  for (const [override, expected] of cases) {
    const problems = identityProblems({ ...LEAST_PRIVILEGE, ...override });
    assert.equal(problems.length, 1, JSON.stringify(override));
    assert.match(problems[0] as string, expected);
  }
});

test("超级用户：只报「是超级用户」（以及它带的属性），不再罗列对超级用户恒为真的其他项", () => {
  const superuser: DbIdentity = {
    ...LEAST_PRIVILEGE,
    login: "nozomi",
    superuser: true,
    createRole: true,
    createDb: true,
    bypassRls: true,
    replication: true,
    memberOf: ["a", "b"],
    inherits: ["a", "b"],
    ownedRelations: 99,
    ownsDatabase: true,
  };
  const problems = identityProblems(superuser);
  assert.equal(problems.length, 5);
  assert.match(problems[0] as string, /超级用户/);
});

test("报错信息里有账号名、全部原因和处理办法，没有连接串", () => {
  const err = new DbIdentityError("nozomi", ["是超级用户", "带有 BYPASSRLS"]);
  assert.equal(err.code, "DB_ROLE_UNSAFE");
  assert.match(err.message, /数据库账号 nozomi 不能用来运行服务/);
  assert.match(err.message, /是超级用户[\s\S]*带有 BYPASSRLS/);
  assert.match(err.message, /pnpm db:provision/);
  assert.ok(!err.message.includes("postgres://"));
});
