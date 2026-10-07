/**
 * 进程级测试的公共辅助：启动子进程并收集输出、找空闲端口、等服务就绪、发原始 HTTP 请求。
 * 子进程只拿到测试传入的环境变量（外加 PATH），不受本机 .env 和 shell 环境影响。
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { Agent, request } from "node:http";
import { createServer } from "node:net";

export interface Running {
  child: ChildProcess;
  /** 进程的全部输出（标准输出 + 标准错误） */
  output: () => string;
  /** 退出码；被信号杀死时为 null */
  exited: Promise<number | null>;
}

export interface StartOptions {
  cwd?: string;
  /** 让子进程自成一个进程组，便于连同它的子孙一起清理（见 killGroup） */
  detached?: boolean;
}

export function startProcess(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
  options: StartOptions = {},
): Running {
  const child = spawn(command, [...args], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    detached: options.detached ?? false,
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  const exited = once(child, "exit").then(([code]) => code as number | null);
  return { child, output: () => output, exited };
}

/** 用当前的 node 直接运行一个 .ts 入口文件。 */
export function startNode(entry: string, env: Record<string, string>, args: readonly string[] = []): Running {
  return startProcess(process.execPath, [entry, ...args], env);
}

/** 强制结束整个进程组（子进程必须是用 `detached: true` 启动的）。进程组已不存在时不报错。 */
export function killGroup(running: Running): void {
  const pid = running.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // 进程组已经全部退出
  }
}

/** 向系统要一个空闲端口。 */
export async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  await once(probe, "close");
  assert.ok(typeof address === "object" && address !== null);
  return address.port;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等一个进程退出，最多等 `ms` 毫秒。超时返回 "timeout"（不抛错，由调用方断言）。
 */
export async function exitWithin(running: Running, ms: number): Promise<number | null | "timeout"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([running.exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * 发一个 GET 请求。用 node:http 而不是 fetch，是为了能明确控制连接是否保持（keep-alive）
 * 以及自带请求头，并且每次调用都是一条新连接。
 */
export function httpGet(
  port: number,
  path: string,
  options: { agent?: Agent; headers?: Record<string, string> } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        agent: options.agent ?? new Agent({ keepAlive: false }),
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** 等服务能应答 /health（任何状态码都算就绪）。进程提前退出或超时都抛错并带上进程输出。 */
export async function waitForHealth(port: number, running: Running, timeoutMs = 15_000): Promise<HttpResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) break;
    try {
      return await httpGet(port, "/health");
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`API 进程没有在限时内就绪。输出：\n${running.output()}`);
}

/** 轮询直到条件成立；超时返回 false。 */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs: number, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(stepMs);
  }
  return condition();
}
