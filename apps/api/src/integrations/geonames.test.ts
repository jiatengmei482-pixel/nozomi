/** GeoNames 下载模块的单元测试：用替身 fetch 和测试里现场拼的压缩包，不联网。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GEONAMES } from "@nozomi/domain";
import { buildZip } from "../testing/zip.ts";
import { GeoNamesError, downloadCities, downloadCityNames, geonamesText } from "./geonames.ts";

function fakeFetch(steps: (Response | Error)[]): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const step = steps[calls.length - 1];
    if (step === undefined) throw new Error("替身 fetch 被多调用了一次");
    if (step instanceof Error) throw step;
    return step;
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const fast = { retryDelayMs: 1, timeoutMs: 500 };
const cities = "1850147\tTokyo\n";

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof GeoNamesError, String(err));
    return err.code;
  }
  throw new Error("应当失败");
}

test("下载城市文件：请求登记的公开地址，解出压缩包里的 cities15000.txt", async () => {
  const { fetch, calls } = fakeFetch([new Response(buildZip([{ name: "cities15000.txt", content: Buffer.from(cities) }]))]);
  assert.equal(await downloadCities({ fetch, ...fast }), cities);
  assert.deepEqual(calls, [GEONAMES.citiesUrl]);
  assert.match(GEONAMES.citiesUrl, /^https:\/\/download\.geonames\.org\/export\/dump\/cities15000\.zip$/);
});

test("下载某个国家的名称文件：地址和压缩包里的文件名都按国家码来", async () => {
  const names = "1\t1850147\tja\t東京\n";
  const { fetch, calls } = fakeFetch([new Response(buildZip([{ name: "readme.txt", content: Buffer.from("x") }, { name: "JP.txt", content: Buffer.from(names) }]))]);
  assert.equal(await downloadCityNames("JP", { fetch, ...fast }), names);
  assert.deepEqual(calls, ["https://download.geonames.org/export/dump/alternatenames/JP.zip"]);
});

test("暂时不可用会重试；一直不可用、被拒绝、超时各有错误码", async () => {
  const zip = buildZip([{ name: "cities15000.txt", content: Buffer.from(cities) }]);
  const flaky = fakeFetch([new Response("busy", { status: 503 }), new TypeError("fetch failed"), new Response(zip)]);
  assert.equal(await downloadCities({ fetch: flaky.fetch, ...fast }), cities);
  assert.equal(flaky.calls.length, 3);
  const down = fakeFetch([new Response("", { status: 500 }), new Response("", { status: 500 })]);
  assert.equal(await codeOf(downloadCities({ fetch: down.fetch, ...fast, attempts: 2 })), "GEONAMES_UNAVAILABLE");
  const gone = fakeFetch([new Response("nope", { status: 404 })]);
  assert.equal(await codeOf(downloadCityNames("JP", { fetch: gone.fetch, ...fast })), "GEONAMES_BAD_RESPONSE");
  assert.equal(gone.calls.length, 1, "明确拒绝不重试");
  const slow = fakeFetch([Object.assign(new Error("timed out"), { name: "TimeoutError" })]);
  assert.equal(await codeOf(downloadCities({ fetch: slow.fetch, ...fast, attempts: 1 })), "GEONAMES_TIMEOUT");
});

test("下载到的不是预期的内容：压缩包里没有要的文件、压缩包损坏、里面不是 UTF-8、文件太大——都是 GEONAMES_BAD_RESPONSE，说明原因", async () => {
  const wrongEntry = fakeFetch([new Response(buildZip([{ name: "other.txt", content: Buffer.from(cities) }]))]);
  await assert.rejects(downloadCities({ fetch: wrongEntry.fetch, ...fast }), (err: unknown) => err instanceof GeoNamesError && err.code === "GEONAMES_BAD_RESPONSE" && /压缩包里没有 cities15000\.txt/.test(err.message));
  const zip = buildZip([{ name: "cities15000.txt", content: Buffer.from(cities.repeat(100)) }]);
  const truncated = fakeFetch([new Response(zip.subarray(0, zip.length - 30))]);
  assert.equal(await codeOf(downloadCities({ fetch: truncated.fetch, ...fast })), "GEONAMES_BAD_RESPONSE");
  const latin1 = fakeFetch([new Response(buildZip([{ name: "cities15000.txt", content: Buffer.from("1\tSão Paulo\n", "latin1") }]))]);
  await assert.rejects(downloadCities({ fetch: latin1.fetch, ...fast }), (err: unknown) => err instanceof GeoNamesError && /不是 UTF-8/.test(err.message));
  const huge = fakeFetch([new Response(zip)]);
  assert.equal(await codeOf(downloadCities({ fetch: huge.fetch, ...fast, maxBytes: 50 })), "GEONAMES_BAD_RESPONSE");
});

test("本地文件和下载走同一个入口：压缩包取出里面的文件，解压好的文本原样用", () => {
  assert.equal(geonamesText(buildZip([{ name: "KR.txt", content: Buffer.from("서울\n") }]), "KR.txt"), "서울\n");
  assert.equal(geonamesText(Buffer.from("서울\n"), "KR.txt"), "서울\n");
});
