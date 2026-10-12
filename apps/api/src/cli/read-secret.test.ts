/**
 * `pnpm admin:create` 在终端里交互输入密码的那一段（验收标准 1）：输入两遍并核对、全程不回显。
 * admin-create.itest.ts 走的是「从标准输入管道读」这条路，这里用一个假的终端补上交互这条路。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { SecretInputAborted, readNewPassword } from "./read-secret.ts";

const PROMPTS = { first: "设置密码：", confirm: "再输入一遍：", mismatch: "两次输入的密码不一致" };
const PASSWORD = "Typed-In-Passw0rd";

interface FakeTerminal {
  input: NodeJS.ReadStream;
  output: PassThrough;
  written: () => string;
  rawModes: boolean[];
  /** 等到出现第 n 个提示之后再「按键」，模拟人看到提示才输入 */
  typeAfterPrompt(prompt: string, keys: string): Promise<void>;
}

function fakeTerminal(isTTY: boolean): FakeTerminal {
  const stream = new PassThrough();
  const rawModes: boolean[] = [];
  const input = Object.assign(stream, {
    isTTY,
    setRawMode(mode: boolean) {
      rawModes.push(mode);
      return input;
    },
  }) as unknown as NodeJS.ReadStream;
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => (written += chunk.toString("utf8")));
  return {
    input,
    output,
    written: () => written,
    rawModes,
    async typeAfterPrompt(prompt, keys) {
      const deadline = Date.now() + 5_000;
      while (!written.includes(prompt)) {
        assert.ok(Date.now() < deadline, `一直没有出现提示「${prompt}」`);
        await new Promise((resolve) => setImmediate(resolve));
      }
      await new Promise((resolve) => setImmediate(resolve));
      stream.write(keys);
    },
  };
}

test("终端里：输入两遍一致才返回密码；提示之外什么都不回显（没有密码、没有星号）；结束后退出原始模式", async () => {
  const terminal = fakeTerminal(true);
  const reading = readNewPassword(terminal.input, terminal.output, PROMPTS);
  await terminal.typeAfterPrompt(PROMPTS.first, `${PASSWORD}\r`);
  await terminal.typeAfterPrompt(PROMPTS.confirm, `${PASSWORD}\r`);
  assert.equal(await reading, PASSWORD);
  assert.equal(terminal.written(), `${PROMPTS.first}\n${PROMPTS.confirm}\n`);
  assert.deepEqual(terminal.rawModes, [true, false, true, false]);
});

test("终端里：两遍不一致（差一个字符、大小写不同、多一个空格）就报错，不返回任何一遍的内容，报错里也没有密码", async () => {
  for (const second of [`${PASSWORD}x`, PASSWORD.toLowerCase(), `${PASSWORD} `, ""]) {
    const terminal = fakeTerminal(true);
    const reading = readNewPassword(terminal.input, terminal.output, PROMPTS);
    await terminal.typeAfterPrompt(PROMPTS.first, `${PASSWORD}\r`);
    await terminal.typeAfterPrompt(PROMPTS.confirm, `${second}\r`);
    await assert.rejects(reading, (err: Error) => {
      assert.equal(err.message, PROMPTS.mismatch);
      assert.ok(!String(err.stack).includes(PASSWORD));
      return true;
    });
    assert.ok(!terminal.written().includes(PASSWORD));
    assert.equal(terminal.rawModes.at(-1), false, "报错后终端应当退出原始模式");
  }
});

test("终端里：退格能删掉上一个字符（包括汉字和表情这类多字节字符），控制字符不进密码", async () => {
  const terminal = fakeTerminal(true);
  const reading = readNewPassword(terminal.input, terminal.output, PROMPTS);
  await terminal.typeAfterPrompt(PROMPTS.first, `Typed-In-Passw0rX\u007fd密\b🙂\u007f\u001b\r`);
  await terminal.typeAfterPrompt(PROMPTS.confirm, `${PASSWORD}\r`);
  assert.equal(await reading, PASSWORD);
  assert.ok(!terminal.written().includes("Typed"));
});

test("终端里：Ctrl+C / Ctrl+D 放弃，不返回已经输入的内容，终端退出原始模式", async () => {
  for (const key of ["\u0003", "\u0004"]) {
    const terminal = fakeTerminal(true);
    const reading = readNewPassword(terminal.input, terminal.output, PROMPTS);
    await terminal.typeAfterPrompt(PROMPTS.first, `${PASSWORD.slice(0, 5)}${key}`);
    await assert.rejects(reading, SecretInputAborted);
    assert.equal(terminal.rawModes.at(-1), false);
    assert.ok(!terminal.written().includes(PASSWORD.slice(0, 5)));
  }
});

test("不是终端（管道 / 重定向）：读完整个输入，只去掉末尾的一个换行，不输出任何提示；密码中间和开头的空白原样保留", async () => {
  for (const [piped, expected] of [
    [`${PASSWORD}\n`, PASSWORD],
    [`${PASSWORD}\r\n`, PASSWORD],
    [PASSWORD, PASSWORD],
    [`${PASSWORD}\n\n`, `${PASSWORD}\n`],
    [`  with spaces ${PASSWORD}  \n`, `  with spaces ${PASSWORD}  `],
    ["", ""],
  ] as const) {
    const terminal = fakeTerminal(false);
    const reading = readNewPassword(terminal.input, terminal.output, PROMPTS);
    (terminal.input as unknown as PassThrough).end(piped);
    assert.equal(await reading, expected);
    assert.equal(terminal.written(), "");
    assert.deepEqual(terminal.rawModes, []);
  }
});
