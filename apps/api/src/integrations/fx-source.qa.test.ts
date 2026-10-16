/**
 * 汇率源下载模块的测试角色补充（M2-03）：用本机真实的 HTTP 服务器（不联网、不用替身 fetch），
 * 覆盖响应头到了但响应体迟迟不来、重定向（同主机、循环、到 404）、没有声明长度的超大响应、声明了超大长度、
 * 定时拉取 3 次重试的次数，以及错误说明里不出现完整地址。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type Server, createServer } from "node:http";
import { FxSourceError, MANUAL_FETCH, SCHEDULED_FETCH, downloadFxSource } from "./fx-source.ts";

let server: Server;
let origin = "";
const hits = new Map<string, number>();

before(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    request.resume();
    switch (path) {
      case "/ok":
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"result":"success"}');
        return;
      case "/stall-body":
        // 响应头立即到，响应体写一半就停住
        response.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
        response.write('{"result":');
        return;
      case "/redirect-same":
        response.writeHead(302, { location: "/ok" });
        response.end();
        return;
      case "/redirect-loop":
        response.writeHead(302, { location: "/redirect-loop" });
        response.end();
        return;
      case "/redirect-404":
        response.writeHead(301, { location: "/missing" });
        response.end();
        return;
      case "/huge-chunked": {
        response.writeHead(200, { "content-type": "application/json" });
        const chunk = "x".repeat(64 * 1024);
        let sent = 0;
        const pump = (): void => {
          while (sent < 40 && !response.destroyed) {
            sent += 1;
            if (!response.write(chunk)) {
              response.once("drain", pump);
              return;
            }
          }
          response.end();
        };
        pump();
        return;
      }
      case "/huge-declared":
        response.writeHead(200, { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) });
        response.write("{");
        return;
      case "/always-503":
        response.writeHead(503);
        response.end();
        return;
      case "/html":
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><title>维护中</title>");
        return;
      default:
        response.writeHead(404);
        response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function outcome(path: string, options: Parameters<typeof downloadFxSource>[1]): Promise<string> {
  const url = `${origin}${path}?apikey=qa-placeholder-not-a-key`;
  try {
    return `ok:${await downloadFxSource(url, options)}`;
  } catch (err) {
    assert.ok(err instanceof FxSourceError, String(err));
    assert.doesNotMatch(err.message, /qa-placeholder|apikey|127\.0\.0\.1/, "错误说明里不带地址");
    return err.code;
  }
}

test("响应头到了、响应体停住：按总时限算超时（FX_SOURCE_TIMEOUT），不会一直挂着", async () => {
  const started = Date.now();
  assert.equal(await outcome("/stall-body", { attempts: 1, timeoutMs: 300 }), "FX_SOURCE_TIMEOUT");
  assert.ok(Date.now() - started < 3_000, "在时限附近结束");
});

test("重定向：同主机跳一次照常取回；循环重定向是不可用；跳到 404 是对方拒绝", async () => {
  assert.equal(await outcome("/redirect-same", { attempts: 1, timeoutMs: 2_000 }), 'ok:{"result":"success"}');
  assert.equal(await outcome("/redirect-loop", { attempts: 1, timeoutMs: 2_000 }), "FX_SOURCE_UNAVAILABLE");
  assert.equal(await outcome("/redirect-404", { attempts: 1, timeoutMs: 2_000 }), "FX_SOURCE_BAD_RESPONSE");
});

test("超大响应：没声明长度的边读边数，超过 1MB 中止；声明了 2MB 的不读", async () => {
  assert.equal(await outcome("/huge-chunked", { attempts: 1, timeoutMs: 5_000 }), "FX_SOURCE_BAD_RESPONSE");
  assert.equal(await outcome("/huge-declared", { attempts: 1, timeoutMs: 5_000 }), "FX_SOURCE_BAD_RESPONSE");
});

test("HTML 页面照样取回原文（是否 JSON 由解析那一步判定、记成内容不对），状态码 200 不算下载失败", async () => {
  assert.match(await outcome("/html", { attempts: 1, timeoutMs: 2_000 }), /^ok:<!doctype html>/);
});

test("定时拉取的配置是 3 次、每次 10 秒；立即拉取 1 次、8 秒；一直 503 时恰好请求 3 次", async () => {
  assert.deepEqual([SCHEDULED_FETCH.attempts, SCHEDULED_FETCH.timeoutMs, MANUAL_FETCH.attempts, MANUAL_FETCH.timeoutMs], [3, 10_000, 1, 8_000]);
  hits.set("/always-503", 0);
  assert.equal(await outcome("/always-503", { ...SCHEDULED_FETCH, retryDelayMs: 1 }), "FX_SOURCE_UNAVAILABLE");
  assert.equal(hits.get("/always-503"), 3);
  hits.set("/always-503", 0);
  assert.equal(await outcome("/always-503", MANUAL_FETCH), "FX_SOURCE_UNAVAILABLE");
  assert.equal(hits.get("/always-503"), 1);
});
