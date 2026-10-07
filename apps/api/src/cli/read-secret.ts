/**
 * 从标准输入读一个不能回显的值（密码）。
 * - 终端里：逐键读取，不回显任何字符，回车结束；Ctrl+C / Ctrl+D 放弃。
 * - 不是终端（管道、重定向）：读完整个标准输入，去掉末尾的一个换行。
 * 值不会出现在命令行参数、shell 历史和任何输出里。
 */
import type { ReadStream } from "node:tty";

export class SecretInputAborted extends Error {
  constructor() {
    super("已取消");
    this.name = "SecretInputAborted";
  }
}

const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACES = new Set(["\u007f", "\b"]);

function readHidden(input: ReadStream, output: NodeJS.WritableStream, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    output.write(prompt);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    const finish = (settle: () => void): void => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      output.write("\n");
      settle();
    };
    const onData = (chunk: string): void => {
      for (const key of chunk) {
        if (key === "\r" || key === "\n") return finish(() => resolve(value));
        if (key === CTRL_C || key === CTRL_D) return finish(() => reject(new SecretInputAborted()));
        if (BACKSPACES.has(key)) value = [...value].slice(0, -1).join("");
        else if (key >= " ") value += key;
      }
    };
    input.on("data", onData);
  });
}

async function readAll(input: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

export interface SecretPrompts {
  first: string;
  confirm: string;
  mismatch: string;
}

/**
 * 读一个密码。终端里要求输入两遍并核对；管道输入只读一遍。
 * 两遍不一致时抛出带 `mismatch` 说明的错误。
 */
export async function readNewPassword(
  input: NodeJS.ReadStream,
  output: NodeJS.WritableStream,
  prompts: SecretPrompts,
): Promise<string> {
  if (!input.isTTY) return readAll(input);
  const first = await readHidden(input, output, prompts.first);
  const second = await readHidden(input, output, prompts.confirm);
  if (first !== second) throw new Error(prompts.mismatch);
  return first;
}
