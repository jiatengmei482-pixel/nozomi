/**
 * QA（M3-02）：推送发送器的防 SSRF、超时、重定向、应答大小，补 webhook-sender.test.ts 没覆盖到的写法和边界。
 * 本机起 HTTP / TCP 服务当接收方；域名解析一律用替身，不访问外网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type Server as NetServer, type Socket, createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { WEBHOOK_RULES } from "@nozomi/domain";
import { HttpsWebhookSender } from "./webhook-sender.ts";

let server: Server;
let port = 0;
let hits = 0;
let behaviour: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("ok");

before(async () => {
  server = createServer((req, res) => {
    hits += 1;
    req.resume();
    req.on("end", () => behaviour(req, res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
after(() => new Promise<void>((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
}));

const req = (url: string): { url: string; body: string; headers: Record<string, string> } => ({ url, body: "{}", headers: { "content-type": "application/json" } });

/** 正式配置的发送器（不打开测试开关）；解析结果固定为 `addresses`，并数一数解析了几次。 */
function strict(addresses: string[] = ["93.184.216.34"]): { sender: HttpsWebhookSender; lookups: () => number } {
  let count = 0;
  const sender = new HttpsWebhookSender({
    timeoutMs: 1_000,
    resolve: async () => {
      count += 1;
      return addresses;
    },
  });
  return { sender, lookups: () => count };
}

test("SSRF：各种写法的内网 / 回环 / 元数据 IP（十进制、八进制、十六进制、短写、全角、尾点、带端口、IPv4 映射 IPv6）一律拒绝，且根本不去解析域名", async () => {
  const urls = [
    "https://2130706433/hook",
    "https://017700000001/hook",
    "https://0x7f.0x0.0x0.0x1/hook",
    "https://0x7f000001:8443/hook",
    "https://127.1/hook",
    "https://127.0.0.1./hook",
    "https://0/hook",
    "https://0.0.0.0:443/hook",
    "https://２５４.１６９.２５４.１６９/hook",
    "https://169.254.169.254:80/latest/meta-data/",
    "https://0xa9fea9fe/latest/meta-data/",
    "https://2852039166/latest/meta-data/",
    "https://100.100.100.200/latest/meta-data/",
    "https://[::ffff:169.254.169.254]/latest",
    "https://[::ffff:7f00:1]/hook",
    "https://[::ffff:10.0.0.1]/hook",
    "https://[0:0:0:0:0:ffff:127.0.0.1]/hook",
    "https://[::127.0.0.1]/hook",
    "https://[64:ff9b::a9fe:a9fe]/hook",
    "https://[2002:a9fe:a9fe::1]/hook",
    "https://[2002:7f00:1::]/hook",
    "https://[fd00:ec2::254]/latest/meta-data/",
    "https://[fd00::1]/hook",
    "https://[fc00::1]/hook",
    "https://[fe80::1]/hook",
    "https://[::]/hook",
    "https://[::1]:8443/hook",
    "https://[ff02::1]/hook",
    "https://10.0.0.1/hook",
    "https://192.168.0.1/hook",
    "https://172.31.255.255/hook",
    "https://100.64.0.1/hook",
    "https://198.18.0.1/hook",
    "https://224.0.0.1/hook",
    "https://255.255.255.255/hook",
  ];
  const { sender, lookups } = strict();
  hits = 0;
  for (const url of urls) {
    const result = await sender.send(req(url));
    assert.equal(result.errorCode, "WEBHOOK_TARGET_FORBIDDEN", url);
    assert.equal(result.statusCode, null, url);
  }
  assert.equal(lookups(), 0, "IP 写法不需要解析");
  assert.equal(hits, 0);
});

test("SSRF：只在内网解析的名字（含全角、IDN 写法、尾点、大写、带端口）拒绝；不去解析", async () => {
  const urls = [
    "https://localhost/hook",
    "https://LOCALHOST:8443/hook",
    "https://localhost./hook",
    "https://ｌｏｃａｌｈｏｓｔ/hook",
    "https://api.localhost./hook",
    "https://metadata.google.internal./computeMetadata/v1/",
    "https://METADATA.GOOGLE.INTERNAL/computeMetadata/v1/",
    "https://instance-data.ec2.internal/latest",
    "https://printer.local./hook",
    "https://router.lan/hook",
    "https://metadata/computeMetadata/v1/",
    "https://localhost%2e/hook",
  ];
  const { sender, lookups } = strict();
  for (const url of urls) {
    const result = await sender.send(req(url));
    assert.ok(result.errorCode === "WEBHOOK_TARGET_FORBIDDEN" || result.errorCode === "WEBHOOK_URL_INVALID", `${url} → ${result.errorCode}`);
  }
  assert.equal(lookups(), 0);
});

test("SSRF：带账号或只带口令、带 #、不是 https（http、ftp、file、gopher）一律不发", async () => {
  const { sender, lookups } = strict();
  for (const url of ["https://user@hooks.example.com/hook", "https://:secret@hooks.example.com/hook", "https://u:p@hooks.example.com/hook", "https://hooks.example.com/hook#frag"]) {
    assert.equal((await sender.send(req(url))).errorCode, "WEBHOOK_URL_INVALID", url);
  }
  for (const url of ["http://hooks.example.com/hook", "ftp://hooks.example.com/hook", "file:///etc/passwd", "gopher://hooks.example.com/_x", "ws://hooks.example.com/hook"]) {
    assert.equal((await sender.send(req(url))).errorCode, "WEBHOOK_TARGET_FORBIDDEN", url);
  }
  assert.equal(lookups(), 0);
});

test("SSRF：域名解析到的地址里有一个不是公网（含 IPv4 映射、NAT64、6to4、带区域标识的链路本地、乱写的地址）就整体拒绝", async () => {
  const sets = [
    ["93.184.216.34", "127.0.0.1"],
    ["2606:4700:4700::1111", "::ffff:169.254.169.254"],
    ["93.184.216.34", "64:ff9b::a00:1"],
    ["2002:c0a8:0101::1"],
    ["fe80::1%eth0"],
    ["93.184.216.34", "not-an-ip"],
    ["0.0.0.0"],
    ["::"],
    ["100.64.1.1"],
    ["fd00:ec2::254"],
  ];
  for (const addresses of sets) {
    const { sender } = strict(addresses);
    hits = 0;
    const result = await sender.send(req(`https://hooks.example.com:${port}/hook`));
    assert.equal(result.errorCode, "WEBHOOK_TARGET_FORBIDDEN", addresses.join(","));
    assert.equal(hits, 0);
  }
});

test("测试开关只放行回环：解析到「回环 + 内网」仍然拒绝", async () => {
  const sender = new HttpsWebhookSender({ allowLocalTargets: true, resolve: async () => ["127.0.0.1", "10.0.0.1"] });
  hits = 0;
  assert.equal((await sender.send(req(`http://hooks.example.com:${port}/hook`))).errorCode, "WEBHOOK_TARGET_FORBIDDEN");
  assert.equal((await sender.send(req(`http://10.0.0.1:${port}/hook`))).errorCode, "WEBHOOK_TARGET_FORBIDDEN");
  assert.equal(hits, 0);
});

/** 一个只收 TCP 的服务：记下第一段数据（TLS 的 ClientHello）就断开。 */
async function tcpSink(): Promise<{ port: number; first: () => Buffer | null; connections: () => number; close: () => Promise<void> }> {
  let first: Buffer | null = null;
  let connections = 0;
  const sockets = new Set<Socket>();
  const sink: NetServer = createNetServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.once("data", (chunk: Buffer) => {
      first ??= chunk;
      socket.destroy();
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  return {
    port: (sink.address() as AddressInfo).port,
    first: () => first,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        sink.close(() => resolve());
      }),
  };
}

test("DNS 重绑定（https）：只解析一次，TLS 连的就是检查过的地址，SNI 仍是原来的域名", async () => {
  const sink = await tcpSink();
  let lookups = 0;
  const sender = new HttpsWebhookSender({
    allowLocalTargets: true,
    timeoutMs: 2_000,
    resolve: async () => {
      lookups += 1;
      return lookups === 1 ? ["127.0.0.1"] : ["169.254.169.254"];
    },
  });
  const result = await sender.send(req(`https://rebind.example.com:${sink.port}/hook`));
  await sink.close();
  assert.equal(lookups, 1);
  assert.equal(sink.connections(), 1, "连到了检查过的 127.0.0.1");
  const hello = sink.first();
  assert.ok(hello !== null && hello[0] === 0x16, "收到的是 TLS 握手");
  assert.ok(hello.includes(Buffer.from("rebind.example.com", "ascii")), "SNI 是原来的域名");
  assert.ok(result.errorCode === "WEBHOOK_CONNECT_FAILED" || result.errorCode === "WEBHOOK_TLS_FAILED", String(result.errorCode));
  assert.equal(result.statusCode, null);
});

test("重定向：301 / 303 / 307 / 308 都不跟随，目标一次都不访问", async () => {
  for (const status of [301, 303, 307, 308]) {
    hits = 0;
    behaviour = (r, res) => (r.url === "/hook" ? res.writeHead(status, { location: "http://169.254.169.254/latest/meta-data/" }).end() : res.end("no"));
    const result = await new HttpsWebhookSender({ allowLocalTargets: true }).send(req(`http://127.0.0.1:${port}/hook`));
    assert.deepEqual([result.statusCode, result.errorCode], [status, "WEBHOOK_REDIRECT_NOT_FOLLOWED"]);
    assert.equal(hits, 1);
  }
  behaviour = (_r, res) => res.end("ok");
});

test("1xx 之外的非 2xx：199 以下不可能，400 / 429 / 599 都记 WEBHOOK_HTTP_STATUS", async () => {
  for (const status of [400, 429, 599]) {
    behaviour = (_r, res) => res.writeHead(status).end();
    const result = await new HttpsWebhookSender({ allowLocalTargets: true }).send(req(`http://127.0.0.1:${port}/hook`));
    assert.deepEqual([result.statusCode, result.errorCode], [status, "WEBHOOK_HTTP_STATUS"]);
  }
  behaviour = (_r, res) => res.end("ok");
});

test("默认时限就是 5 秒：对方不应答，约 5 秒放弃（不早于 4.9 秒、不晚于 6.5 秒）", async () => {
  assert.equal(WEBHOOK_RULES.timeoutMs, 5_000);
  behaviour = () => undefined;
  const started = Date.now();
  const result = await new HttpsWebhookSender({ allowLocalTargets: true }).send(req(`http://127.0.0.1:${port}/slow`));
  const elapsed = Date.now() - started;
  behaviour = (_r, res) => res.end("ok");
  server.closeAllConnections();
  assert.equal(result.errorCode, "WEBHOOK_TIMEOUT");
  assert.ok(elapsed >= 4_900 && elapsed < 6_500, String(elapsed));
});

test("域名解析本身卡住也算在时限里（WEBHOOK_TIMEOUT）", async () => {
  const sender = new HttpsWebhookSender({ timeoutMs: 300, resolve: () => new Promise<string[]>(() => undefined) });
  const started = Date.now();
  const result = await sender.send(req("https://hooks.example.com/hook"));
  assert.equal(result.errorCode, "WEBHOOK_TIMEOUT");
  assert.ok(Date.now() - started < 1_500);
});

test("应答很大：默认上限 64 KB，只读到上限就断开，不把 10 MB 都读完", async () => {
  assert.equal(WEBHOOK_RULES.maxResponseBytes, 64 * 1024);
  let written = 0;
  let closedEarly = false;
  behaviour = (_r, res) => {
    res.writeHead(200);
    const chunk = Buffer.alloc(16 * 1024, 120);
    const pump = (): void => {
      while (written < 10 * 1024 * 1024) {
        written += chunk.length;
        if (!res.write(chunk)) {
          res.once("drain", pump);
          return;
        }
      }
      res.end();
    };
    res.on("close", () => {
      if (written < 10 * 1024 * 1024) closedEarly = true;
    });
    pump();
  };
  const result = await new HttpsWebhookSender({ allowLocalTargets: true }).send(req(`http://127.0.0.1:${port}/big`));
  await new Promise((resolve) => setTimeout(resolve, 100));
  behaviour = (_r, res) => res.end("ok");
  assert.deepEqual([result.statusCode, result.errorCode], [200, null]);
  assert.ok(closedEarly, `发送方在读完之前就断开了（对方写了 ${written} 字节）`);
});
