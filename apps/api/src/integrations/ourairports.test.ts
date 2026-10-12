/** 下载模块的单元测试：用替身 fetch，不联网。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OURAIRPORTS } from "@nozomi/domain";
import { OurAirportsError, downloadAirportsCsv } from "./ourairports.ts";

type Step = Response | Error | "hang";

/** 按顺序给出预设应答的替身 fetch；记下每次请求的地址。 */
function fakeFetch(steps: Step[]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(String(input));
    const step = steps[calls.length - 1];
    if (step === undefined) throw new Error("替身 fetch 被多调用了一次");
    if (step === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const fast = { retryDelayMs: 1, timeoutMs: 200 };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof OurAirportsError, String(err));
    return err.code;
  }
  throw new Error("应当失败");
}

test("下载成功：返回文件内容，请求的是登记的公开地址", async () => {
  const { fetch, calls } = fakeFetch([new Response("id,name\n1,a\n")]);
  assert.equal(await downloadAirportsCsv({ fetch, ...fast }), "id,name\n1,a\n");
  assert.deepEqual(calls, [OURAIRPORTS.downloadUrl]);
});

test("对方暂时出错（5xx、429）或连不上：重试，之后成功就用成功的结果", async () => {
  const { fetch, calls } = fakeFetch([new Response("busy", { status: 503 }), new TypeError("fetch failed"), new Response("ok-body")]);
  assert.equal(await downloadAirportsCsv({ fetch, ...fast }), "ok-body");
  assert.equal(calls.length, 3);
  const limited = fakeFetch([new Response("slow down", { status: 429 }), new Response("ok-body")]);
  assert.equal(await downloadAirportsCsv({ fetch: limited.fetch, ...fast }), "ok-body");
});

test("一直不可用：重试到次数用完，报 OURAIRPORTS_UNAVAILABLE", async () => {
  const { fetch, calls } = fakeFetch([new Response("", { status: 500 }), new Response("", { status: 502 }), new Response("", { status: 503 })]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch, ...fast })), "OURAIRPORTS_UNAVAILABLE");
  assert.equal(calls.length, 3);
  const down = fakeFetch([new TypeError("fetch failed"), new TypeError("fetch failed")]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch: down.fetch, ...fast, attempts: 2 })), "OURAIRPORTS_UNAVAILABLE");
  assert.equal(down.calls.length, 2);
});

test("对方明确拒绝（404 等）：不重试，报 OURAIRPORTS_BAD_RESPONSE", async () => {
  const { fetch, calls } = fakeFetch([new Response("not found", { status: 404 })]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch, ...fast })), "OURAIRPORTS_BAD_RESPONSE");
  assert.equal(calls.length, 1);
});

test("超时：到时限就放弃这次尝试，重试后仍超时报 OURAIRPORTS_TIMEOUT", async () => {
  const { fetch, calls } = fakeFetch(["hang", "hang"]);
  const started = Date.now();
  assert.equal(await codeOf(downloadAirportsCsv({ fetch, retryDelayMs: 1, timeoutMs: 50, attempts: 2 })), "OURAIRPORTS_TIMEOUT");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started < 2_000);
});

test("文件大得不正常：不使用，报 OURAIRPORTS_BAD_RESPONSE", async () => {
  const declared = fakeFetch([new Response("x", { headers: { "content-length": "999999" } })]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch: declared.fetch, ...fast, maxBytes: 100 })), "OURAIRPORTS_BAD_RESPONSE");
  const actual = fakeFetch([new Response("x".repeat(200))]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch: actual.fetch, ...fast, maxBytes: 100 })), "OURAIRPORTS_BAD_RESPONSE");
});

test("错误信息里只有状态码和说明，没有对方返回的内容", async () => {
  const { fetch } = fakeFetch([new Response("<html>secret-ish body</html>", { status: 403 })]);
  await assert.rejects(downloadAirportsCsv({ fetch, ...fast }), (err: Error) => !err.message.includes("secret-ish") && /HTTP 403/.test(err.message));
});

test("大小上限是边读边查的：一超过就中止，不会把剩下的内容读完", async () => {
  let pulled = 0;
  let cancelled = false;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(40));
    },
    cancel() {
      cancelled = true;
    },
  });
  const { fetch } = fakeFetch([new Response(endless)]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch, ...fast, maxBytes: 100 })), "OURAIRPORTS_BAD_RESPONSE");
  assert.ok(cancelled, "应当中止下载");
  assert.ok(pulled <= 5, `只读到超限为止，实际读了 ${pulled} 块`);
});

test("下载到的内容不是 UTF-8：不使用，报 OURAIRPORTS_BAD_RESPONSE，而不是带着乱码往下走", async () => {
  const { fetch, calls } = fakeFetch([new Response(Buffer.from("id,name\n1,Aéroport\n", "latin1"))]);
  assert.equal(await codeOf(downloadAirportsCsv({ fetch, ...fast })), "OURAIRPORTS_BAD_RESPONSE");
  assert.equal(calls.length, 1, "内容不对重试没有意义");
  const ok = fakeFetch([new Response(Buffer.from("id,name\n1,Aéroport 東京\n", "utf8"))]);
  assert.equal(await downloadAirportsCsv({ fetch: ok.fetch, ...fast }), "id,name\n1,Aéroport 東京\n");
});
