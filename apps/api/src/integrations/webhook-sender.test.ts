/**
 * 推送的发送（防 SSRF、超时、不跟随重定向、限制应答大小）和签名、密钥加密。本机起一个 HTTP 服务当接收方；域名解析用替身，不访问外网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpsWebhookSender } from "./webhook-sender.ts";
import { verifyWebhookSignature, webhookSignature } from "./webhook-signature.ts";
import { SecretBox, SecretBoxError } from "./secret-box.ts";

interface Received {
  path: string;
  host: string | undefined;
  body: string;
}

let server: Server;
let port = 0;
const received: Received[] = [];
let behaviour: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("ok");

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      received.push({ path: req.url ?? "", host: req.headers.host, body });
      behaviour(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const local = (options: ConstructorParameters<typeof HttpsWebhookSender>[0] = {}): HttpsWebhookSender => new HttpsWebhookSender({ allowLocalTargets: true, ...options });
const request = (url: string): { url: string; body: string; headers: Record<string, string> } => ({ url, body: '{"hello":"世界"}', headers: { "content-type": "application/json" } });

test("2xx 算成功：带上请求体，记录目标主机和耗时", async () => {
  behaviour = (_req, res) => res.writeHead(204).end();
  received.length = 0;
  const result = await local().send(request(`http://127.0.0.1:${port}/hook?x=1`));
  assert.deepEqual({ statusCode: result.statusCode, errorCode: result.errorCode, targetHost: result.targetHost }, { statusCode: 204, errorCode: null, targetHost: `127.0.0.1:${port}` });
  assert.ok(result.durationMs >= 0);
  assert.equal(received[0]?.path, "/hook?x=1");
  assert.equal(received[0]?.body, '{"hello":"世界"}');
});

test("非 2xx：记状态码和 WEBHOOK_HTTP_STATUS", async () => {
  behaviour = (_req, res) => res.writeHead(503).end("busy");
  const result = await local().send(request(`http://127.0.0.1:${port}/hook`));
  assert.deepEqual([result.statusCode, result.errorCode], [503, "WEBHOOK_HTTP_STATUS"]);
});

test("重定向不跟随：3xx 算失败，重定向的目标一次都没被访问", async () => {
  behaviour = (req, res) => (req.url === "/hook" ? res.writeHead(302, { location: `http://127.0.0.1:${port}/elsewhere` }).end() : res.end("should not be here"));
  received.length = 0;
  const result = await local().send(request(`http://127.0.0.1:${port}/hook`));
  assert.deepEqual([result.statusCode, result.errorCode], [302, "WEBHOOK_REDIRECT_NOT_FOLLOWED"]);
  assert.deepEqual(received.map((entry) => entry.path), ["/hook"]);
});

test("超时：对方不应答，到时限就放弃（WEBHOOK_TIMEOUT）", async () => {
  behaviour = () => undefined;
  const started = Date.now();
  const result = await local({ timeoutMs: 200 }).send(request(`http://127.0.0.1:${port}/slow`));
  assert.equal(result.errorCode, "WEBHOOK_TIMEOUT");
  assert.equal(result.statusCode, null);
  assert.ok(Date.now() - started < 2_000);
});

test("应答很大：只读到上限就停，按状态码算结果", async () => {
  behaviour = (_req, res) => {
    res.writeHead(200);
    const chunk = "x".repeat(16 * 1024);
    let sent = 0;
    const pump = (): void => {
      while (sent < 10 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) {
          res.once("drain", pump);
          return;
        }
      }
      res.end();
    };
    pump();
    res.on("close", () => undefined);
  };
  const started = Date.now();
  const result = await local({ maxResponseBytes: 32 * 1024 }).send(request(`http://127.0.0.1:${port}/big`));
  assert.deepEqual([result.statusCode, result.errorCode], [200, null]);
  assert.ok(Date.now() - started < 3_000);
});

test("连不上：WEBHOOK_CONNECT_FAILED；域名解析不了：WEBHOOK_DNS_FAILED", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  assert.equal((await local().send(request(`http://127.0.0.1:${closedPort}/hook`))).errorCode, "WEBHOOK_CONNECT_FAILED");
  const failing = local({ resolve: () => Promise.reject(Object.assign(new Error("nope"), { code: "ENOTFOUND" })) });
  assert.equal((await failing.send(request("https://hooks.example.com/hook"))).errorCode, "WEBHOOK_DNS_FAILED");
  assert.equal((await local({ resolve: async () => [] }).send(request("https://hooks.example.com/hook"))).errorCode, "WEBHOOK_DNS_FAILED");
});

test("防 SSRF：不打开测试开关时，http、回环、内网、元数据地址一律拒绝，一个请求都不发出去", async () => {
  behaviour = (_req, res) => res.end("ok");
  received.length = 0;
  const strict = new HttpsWebhookSender({ resolve: async () => ["127.0.0.1"] });
  for (const url of [`http://127.0.0.1:${port}/hook`, `https://127.0.0.1:${port}/hook`, "https://10.0.0.8/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/hook", "https://localhost/hook", "http://hooks.example.com/hook"]) {
    const result = await strict.send(request(url));
    assert.equal(result.errorCode, "WEBHOOK_TARGET_FORBIDDEN", url);
    assert.equal(result.statusCode, null);
  }
  assert.deepEqual(received, []);
});

test("防 SSRF：域名解析到内网地址（含只有一个是内网）整体拒绝；只解析一次，连接用的就是检查过的地址（防 DNS 重绑定）", async () => {
  for (const addresses of [["10.0.0.5"], ["93.184.216.34", "192.168.1.2"], ["::ffff:127.0.0.1"], ["fd00:ec2::254"], ["169.254.169.254"]]) {
    const result = await new HttpsWebhookSender({ resolve: async () => addresses }).send(request("https://hooks.example.com/hook"));
    assert.equal(result.errorCode, "WEBHOOK_TARGET_FORBIDDEN", addresses.join(","));
  }
  let lookups = 0;
  received.length = 0;
  behaviour = (_req, res) => res.end("ok");
  const pinned = local({
    resolve: async () => {
      lookups += 1;
      return lookups === 1 ? ["127.0.0.1"] : ["10.0.0.1"];
    },
  });
  const result = await pinned.send(request(`http://hooks.example.com:${port}/pinned`));
  assert.equal(result.errorCode, null, JSON.stringify(result));
  assert.equal(lookups, 1, "只解析了一次");
  assert.equal(received[0]?.host, `hooks.example.com:${port}`, "Host 仍是原来的域名");
  assert.equal(result.targetHost, `hooks.example.com:${port}`);
});

test("地址写得不对、带账号密码：WEBHOOK_URL_INVALID", async () => {
  assert.equal((await local().send(request("not a url"))).errorCode, "WEBHOOK_URL_INVALID");
  assert.equal((await local().send(request("https://u:p@hooks.example.com/hook"))).errorCode, "WEBHOOK_URL_INVALID");
});

test("签名：v1=HMAC-SHA256(密钥, 时间戳.请求体)；接收方参考实现能验过，改了内容、换了密钥、过了 5 分钟都不过", () => {
  const secret = "nzwh_test_secret_value";
  const now = new Date("2026-10-20T01:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"event_id":"evt_x"}';
  const signature = webhookSignature(secret, ts, body);
  assert.match(signature, /^v1=[0-9a-f]{64}$/);
  assert.equal(signature, webhookSignature(secret, ts, body), "同样的输入同样的签名");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts), signature }, body, now), null);
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts), signature }, `${body} `, now), "MISMATCH");
  assert.equal(verifyWebhookSignature("another", { timestamp: String(ts), signature }, body, now), "MISMATCH");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts + 1), signature }, body, now), "MISMATCH", "时间戳也在签名里");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts), signature }, body, new Date(now.getTime() + 301_000)), "TIMESTAMP_OUT_OF_TOLERANCE");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts), signature }, body, new Date(now.getTime() + 300_000)), null);
  assert.equal(verifyWebhookSignature(secret, { timestamp: undefined, signature }, body, now), "MISSING");
  assert.equal(verifyWebhookSignature(secret, { timestamp: "abc", signature }, body, now), "MALFORMED");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(ts), signature: `${signature}0` }, body, now), "MALFORMED");
});

test("密钥加密：能还原；每次密文不同；换了主密钥、换了归属、改了一个字都解不开；密文里没有原文", () => {
  const box = new SecretBox("k".repeat(40));
  const sealed = box.seal("tenant-webhook-secret", "tenant-a", "nzwh_secret");
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!sealed.includes("nzwh_secret"));
  assert.notEqual(sealed, box.seal("tenant-webhook-secret", "tenant-a", "nzwh_secret"));
  assert.equal(box.open("tenant-webhook-secret", "tenant-a", sealed), "nzwh_secret");
  assert.throws(() => new SecretBox("j".repeat(40)).open("tenant-webhook-secret", "tenant-a", sealed), SecretBoxError);
  assert.throws(() => box.open("tenant-webhook-secret", "tenant-b", sealed), SecretBoxError, "搬到别的租户的行里解不开");
  const parts = sealed.split(".");
  const last = parts[3] as string;
  const tampered = [...parts.slice(0, 3), `${last[0] === "A" ? "B" : "A"}${last.slice(1)}`].join(".");
  assert.throws(() => box.open("tenant-webhook-secret", "tenant-a", tampered), SecretBoxError);
  assert.throws(() => box.open("tenant-webhook-secret", "tenant-a", "v2.a.b.c"), SecretBoxError);
  assert.throws(() => box.open("tenant-webhook-secret", "tenant-a", "garbage"), SecretBoxError);
  assert.throws(() => new SecretBox("short"), RangeError);
});
