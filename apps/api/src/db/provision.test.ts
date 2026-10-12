/** 建应用账号时的输入检查和密码校验值的计算（ADR 0010）。不需要数据库；真的建账号并用密码登录在 provision.itest.ts。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProvisionError, appAccountFromUrl, scramSha256Verifier } from "./provision.ts";

test("SCRAM-SHA-256 校验值：格式是 PostgreSQL 认的那种，里面没有密码原文；同一个盐结果稳定，换盐、换密码结果不同", () => {
  const salt = Buffer.from("0123456789abcdef");
  const verifier = scramSha256Verifier("placeholder-Passw0rd", salt);
  assert.match(verifier, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/);
  assert.ok(verifier.startsWith(`SCRAM-SHA-256$4096:${salt.toString("base64")}$`));
  assert.ok(!verifier.includes("placeholder-Passw0rd"));
  assert.equal(scramSha256Verifier("placeholder-Passw0rd", salt), verifier);
  assert.notEqual(scramSha256Verifier("placeholder-Passw0rd"), verifier, "默认每次用新的随机盐");
  assert.notEqual(scramSha256Verifier("another-Passw0rd", salt), verifier);
});

test("SCRAM-SHA-256 校验值与公开的已知结果一致（RFC 7677 示例里的盐、迭代次数和密码 pencil）", () => {
  const verifier = scramSha256Verifier("pencil", Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64"));
  assert.equal(
    verifier,
    "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=",
  );
});

test("从连接串取应用账号：账号名和密码原样取出（百分号编码会被还原）", () => {
  assert.deepEqual(appAccountFromUrl("postgres://nozomi_api:placeholder-password@db:5432/nozomi"), {
    role: "nozomi_api",
    password: "placeholder-password",
  });
  assert.deepEqual(appAccountFromUrl("postgres://nozomi_api:p%40ss%2Fword-1@db:5432/nozomi").password, "p@ss/word-1");
});

test("不能用作应用账号的名字和密码：报错说明原因，报错里没有连接串和密码", () => {
  const cases: [string, string][] = [
    ["postgres://Nozomi-Api:placeholder-password@db/nozomi", "PROVISION_INVALID_ROLE_NAME"],
    ["postgres://pg_monitor:placeholder-password@db/nozomi", "PROVISION_INVALID_ROLE_NAME"],
    ["postgres://nozomi_app:placeholder-password@db/nozomi", "PROVISION_INVALID_ROLE_NAME"],
    ["postgres://nozomi_platform:placeholder-password@db/nozomi", "PROVISION_INVALID_ROLE_NAME"],
    ["postgres://:placeholder-password@db/nozomi", "PROVISION_INVALID_ROLE_NAME"],
    ["postgres://nozomi_api@db/nozomi", "PROVISION_INVALID_PASSWORD"],
    ["postgres://nozomi_api:short@db/nozomi", "PROVISION_INVALID_PASSWORD"],
    ["postgres://nozomi_api:has%20space-in-it@db/nozomi", "PROVISION_INVALID_PASSWORD"],
    ["postgres://nozomi_api:%E5%AF%86%E7%A0%81%E5%AF%86%E7%A0%81%E5%AF%86%E7%A0%81%E5%AF%86%E7%A0%81@db/nozomi", "PROVISION_INVALID_PASSWORD"],
  ];
  for (const [url, code] of cases) {
    assert.throws(
      () => appAccountFromUrl(url),
      (err: unknown) => {
        assert.ok(err instanceof ProvisionError, url);
        assert.equal(err.code, code, url);
        assert.ok(!err.message.includes("postgres://") && !err.message.includes("placeholder-password"));
        return true;
      },
    );
  }
});
