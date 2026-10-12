/**
 * M1-01 测试角色补充：机场数据下载在「对方很慢、中途断开、内容不对」时的表现。
 * ourairports.test.ts 用替身 fetch；这里用真的 fetch 连本机临时起的 HTTP 服务（127.0.0.1，随机端口），
 * 这样超时是否真的覆盖到「读响应体」、大小上限对没有 Content-Length 的应答是否有效，都是实测。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CsvError, selectAirports } from "@nozomi/domain";
import { OurAirportsError, downloadAirportsCsv } from "./ourairports.ts";

type Handler = (request: IncomingMessage, response: ServerResponse, attempt: number) => void;

let server: Server;
let base: string;
let handler: Handler = (_request, response) => response.end();
let hits = 0;

before(async () => {
  server = createServer((request, response) => {
    hits += 1;
    handler(request, response, hits);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function serve(next: Handler): void {
  hits = 0;
  handler = next;
}

async function failure(pending: Promise<string>): Promise<OurAirportsError> {
  try {
    await pending;
  } catch (err) {
    assert.ok(err instanceof OurAirportsError, `应当是 OurAirportsError，实际是 ${String(err)}`);
    return err;
  }
  throw new Error("应当失败，却成功了");
}

const HEADER = "id,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
const GOOD = `${HEADER}\n960001,large_airport,QA Download Airport,35.5,139.5,JP,yes,QDL\n`;
const quick = { timeoutMs: 300, attempts: 2, retryDelayMs: 5 };

test("下载：正常应答原样返回；跟随跳转；内容能直接交给挑选机场的规则", async () => {
  serve((request, response) => {
    if (request.url === "/moved") {
      response.writeHead(302, { location: "/airports.csv" }).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/csv" }).end(GOOD);
  });
  const text = await downloadAirportsCsv({ url: `${base}/moved`, ...quick });
  assert.equal(text, GOOD);
  assert.deepEqual(selectAirports(text, ["JP"]).airports.map((airport) => airport.iata), ["QDL"]);
});

test("超时：对方连上之后一直不应答——每次尝试到时限就放弃，重试用完后报 OURAIRPORTS_TIMEOUT，不会一直挂着", async () => {
  serve(() => undefined);
  const started = Date.now();
  const err = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick }));
  const elapsed = Date.now() - started;
  assert.equal(err.code, "OURAIRPORTS_TIMEOUT");
  assert.equal(hits, 2, "试了两次");
  assert.ok(elapsed >= 550 && elapsed < 3_000, `两次各 300 毫秒的时限，实际用了 ${elapsed} 毫秒`);
});

test("超时：对方发了响应头和一部分内容之后卡住——时限覆盖到读内容的阶段，同样报 OURAIRPORTS_TIMEOUT，不返回半份文件", async () => {
  serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/csv" });
    response.write(GOOD.slice(0, 40));
  });
  const started = Date.now();
  const err = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick }));
  assert.equal(err.code, "OURAIRPORTS_TIMEOUT");
  assert.equal(hits, 2);
  assert.ok(Date.now() - started < 3_000);
});

test("超时：对方一直慢慢地发（每次间隔都不长，但总时间超了）——按总时限算，不会被「一直有数据」拖住", async () => {
  const timers: NodeJS.Timeout[] = [];
  serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/csv" });
    const timer = setInterval(() => response.write("970001,slow\n"), 50);
    timers.push(timer);
    response.on("close", () => clearInterval(timer));
  });
  try {
    const started = Date.now();
    const err = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, timeoutMs: 400, attempts: 1 }));
    assert.equal(err.code, "OURAIRPORTS_TIMEOUT");
    assert.ok(Date.now() - started < 2_000);
  } finally {
    for (const timer of timers) clearInterval(timer);
  }
});

test("中途断开：内容发到一半连接被掐断——算暂时不可用，重试；第二次成功就用完整的结果，不把半份文件当成功", async () => {
  serve((_request, response, attempt) => {
    if (attempt === 1) {
      response.writeHead(200, { "content-type": "text/csv", "content-length": String(Buffer.byteLength(GOOD)) });
      response.write(GOOD.slice(0, 40));
      setTimeout(() => response.destroy(), 20);
      return;
    }
    response.writeHead(200).end(GOOD);
  });
  assert.equal(await downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, timeoutMs: 2_000 }), GOOD);
  assert.equal(hits, 2);
  // 每次都断：重试用完后报错
  serve((_request, response) => {
    response.writeHead(200, { "content-length": "9999" });
    response.write("partial");
    setTimeout(() => response.destroy(), 20);
  });
  const err = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, timeoutMs: 2_000, attempts: 3 }));
  assert.equal(err.code, "OURAIRPORTS_UNAVAILABLE");
  assert.equal(hits, 3);
});

test("连不上：端口没人听——重试用完后报 OURAIRPORTS_UNAVAILABLE；错误信息里没有地址、端口这些内部细节", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise((resolve) => closed.close(resolve));
  const err = await failure(downloadAirportsCsv({ url: `http://127.0.0.1:${port}/airports.csv`, ...quick }));
  assert.equal(err.code, "OURAIRPORTS_UNAVAILABLE");
  assert.doesNotMatch(err.message, /127\.0\.0\.1|ECONNREFUSED|\d{4,5}/);
});

test("对方暂时出错再恢复：503、429 之后成功；一直 500 报不可用；403、404、410 不重试", async () => {
  serve((_request, response, attempt) => {
    if (attempt === 1) response.writeHead(503).end("busy");
    else if (attempt === 2) response.writeHead(429, { "retry-after": "3600" }).end("slow down");
    else response.writeHead(200).end(GOOD);
  });
  assert.equal(await downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, attempts: 3 }), GOOD);
  assert.equal(hits, 3);

  serve((_request, response) => response.writeHead(500).end("<html>secret-internal-detail</html>"));
  const unavailable = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, attempts: 3 }));
  assert.equal(unavailable.code, "OURAIRPORTS_UNAVAILABLE");
  assert.equal(hits, 3);
  assert.doesNotMatch(unavailable.message, /secret-internal-detail/);

  for (const status of [403, 404, 410]) {
    serve((_request, response) => response.writeHead(status).end("nope"));
    const rejected = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, attempts: 3 }));
    assert.equal(rejected.code, "OURAIRPORTS_BAD_RESPONSE", String(status));
    assert.equal(hits, 1, `${status} 不重试`);
  }
});

test("大小上限：对方不报 Content-Length、分块发来超过上限的内容——不使用，报 OURAIRPORTS_BAD_RESPONSE，不重试", async () => {
  serve((_request, response) => {
    response.writeHead(200, { "content-type": "text/csv" });
    for (let i = 0; i < 20; i += 1) response.write("x".repeat(1_000));
    response.end();
  });
  const err = await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, timeoutMs: 2_000, maxBytes: 10_000 }));
  assert.equal(err.code, "OURAIRPORTS_BAD_RESPONSE");
  assert.equal(hits, 1);
  // 正好等于上限：可以
  serve((_request, response) => response.writeHead(200).end("y".repeat(10_000)));
  assert.equal((await downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, maxBytes: 10_000 })).length, 10_000);
  // 报了 Content-Length 且超限：不用读内容就拒绝
  serve((_request, response) => response.writeHead(200, { "content-length": "10001" }).end("z".repeat(10_001)));
  assert.equal((await failure(downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick, maxBytes: 10_000 }))).code, "OURAIRPORTS_BAD_RESPONSE");
});

test("内容不对：对方返回 200 但内容是网页、是空的——下载本身成功，交给挑选机场的规则时被明确拒绝，不会当成「0 个机场」悄悄通过", async () => {
  for (const body of ["<!doctype html><html><body>Sign in to continue</body></html>", "", '{"error":"rate limited"}', "Not Found"]) {
    serve((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(body));
    const text = await downloadAirportsCsv({ url: `${base}/airports.csv`, ...quick });
    assert.equal(text, body);
    assert.throws(() => selectAirports(text, ["JP"]), CsvError, JSON.stringify(body));
  }
});
