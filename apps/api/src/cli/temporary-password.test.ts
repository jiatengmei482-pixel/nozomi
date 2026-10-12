/**
 * 命令行临时密码的生成与显示（M0-12，ADR 0013）：不连数据库的部分。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TEMPORARY_PASSWORD_PATTERN, checkPasswordStrength } from "@nozomi/domain";
import { TEMPORARY_PASSWORD_LABEL, newTemporaryPassword, printTemporaryPassword } from "./temporary-password.ts";

function fakeStream(): { stream: NodeJS.WritableStream; writes: string[] } {
  const writes: string[] = [];
  const stream = { write: (chunk: string) => (writes.push(chunk), true) } as unknown as NodeJS.WritableStream;
  return { stream, writes };
}

test("显示：只往给定的流写一次；密码单独一行、行首是固定前缀、后面没有别的内容；密码在整段输出里只出现一次", () => {
  const { stream, writes } = fakeStream();
  printTemporaryPassword(stream, "aB3de-Fg4hJ-k5LmN-6pQrS");
  assert.equal(writes.length, 1);
  const lines = (writes[0] as string).split("\n");
  assert.equal(lines.filter((line) => line.startsWith(TEMPORARY_PASSWORD_LABEL)).length, 1);
  assert.ok(lines.includes(`${TEMPORARY_PASSWORD_LABEL}aB3de-Fg4hJ-k5LmN-6pQrS`));
  assert.equal((writes[0] as string).split("aB3de-Fg4hJ-k5LmN-6pQrS").length - 1, 1);
  assert.ok((writes[0] as string).endsWith("\n"));
  assert.equal(TEMPORARY_PASSWORD_LABEL, "临时密码：", "前缀是文档和脚本约定的写法，改它等于改接口");
});

test("生成：每次不同、固定形状、通过这个邮箱的强度规则", () => {
  const seen = new Set<string>();
  for (let round = 0; round < 300; round += 1) {
    const password = newTemporaryPassword("owner@example.com");
    assert.match(password, TEMPORARY_PASSWORD_PATTERN);
    assert.deepEqual(checkPasswordStrength(password, "owner@example.com"), []);
    seen.add(password);
  }
  assert.equal(seen.size, 300);
});

test("随机性来源：命令行的生成路径只用 node:crypto 的 randomInt；规则模块和命令行入口里都没有 Math.random、Date.now 之类可预测的来源", async () => {
  const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");
  const cli = await read("./temporary-password.ts");
  assert.match(cli, /import \{ randomInt \} from "node:crypto";/);
  assert.match(cli, /generateTemporaryPassword\(email, \(exclusiveMax\) => randomInt\(exclusiveMax\)\)/);
  const sources = [cli, await read("../../../../packages/domain/src/temporary-password.ts"), await read("./admin-create.ts"), await read("./admin-reset-password.ts")];
  for (const source of sources) {
    assert.doesNotMatch(source, /Math\.random|Date\.now|performance\.now|process\.hrtime|process\.pid/);
  }
  // 两个入口都从同一个地方拿密码、用同一个函数显示，没有第二条生成或打印的路径
  for (const entry of [sources[2] as string, sources[3] as string]) {
    assert.equal(entry.split("newTemporaryPassword(").length - 1, 1);
    assert.equal(entry.split("printTemporaryPassword(process.stdout, password)").length - 1, 1);
    assert.doesNotMatch(entry, /console\.(log|error|warn|info|debug)\([^)]*password/, "没有任何一句输出带着 password 变量");
  }
});
