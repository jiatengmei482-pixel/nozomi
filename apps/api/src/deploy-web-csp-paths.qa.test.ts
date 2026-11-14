/**
 * M3-08 测试角色补充：在真实的 Caddy 上（deploy/Caddyfile + 生成的片段，和正式环境同一个镜像——apps/web/Dockerfile 里固定的那个版本）逐路径核对内容安全策略（ADR 0046）。
 * Caddy 的 path 匹配器不分大小写、会先解码再把路径规整（`..%2F` 算上一级），而前端路由不这样看路径，所以只看片段的文字核对不出这里的差异。
 *
 * M9E-16（ADR 0095 第五节第 1 小节、第十节「Caddy 层」）：嵌入预订页 `/embed/book` 的 `frame-ancestors` 由 Caddy 用 `forward_auth` 问 API 后加。
 * 端到端走的是 vite preview，测不到这一层，所以在这里用真实容器 + 替身 API（本进程里的 HTTP 服务，容器里按 `api` 访问）核对：
 * route 里的顺序生效、只转 key 和 host、伪造请求头无效、其余页面照旧 `'none'` + `X-Frame-Options: DENY`。
 *
 * 本机没有 docker、没有这个镜像时跳过（不主动拉镜像）。CI 上绝不跳过：缺镜像就拉，没有 docker 或拉不下来直接失败。容器在测试结束时删掉，用完不留。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingHttpHeaders, type Server, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_UPSTREAM, FRAME_CHECK_PATH, renderEdgeConfig } from "../../web/build/edge-config.ts";

/** 和前端镜像同一个 Caddy（apps/web/Dockerfile 最后一个 FROM），两处不会各写各的 */
const IMAGE = /^FROM (caddy:\S+)$/m.exec(readFileSync(new URL("../../web/Dockerfile", import.meta.url), "utf8"))?.[1] ?? "";
const hasImage = (): boolean => IMAGE !== "" && spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;
if (process.env["CI"] !== undefined && !hasImage()) execFileSync("docker", ["pull", IMAGE], { stdio: "ignore" });
const available = hasImage();
const skip = available ? false : `本机没有 docker 或 ${IMAGE} 镜像`;
const CADDYFILE = new URL("../../../deploy/Caddyfile", import.meta.url).pathname;
const INDEX = "<!doctype html><html><head><title>x</title><script>1</script></head><body></body></html>";
const NAME = `nozomi-qa-caddy-${process.pid}`;

/** 替身 API 的 frame-check：只有这个嵌入码 + 这个宿主放行（真实规则在 embed-host-page.itest.ts 里测） */
const KEY = `nze_${"K".repeat(32)}`;
const PARTNER = "https://partner.example";

let port = 0;
let workDir = "";
let stub: Server | null = null;
/** 替身 API 收到的请求（路径 + 查询串、请求头） */
const received: { url: string; headers: IncomingHttpHeaders }[] = [];

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  raw: string[];
  body: string;
}

/** 原样发出路径（fetch 会把 `..` 规整掉，这里要的是服务器看到的原始路径）。 */
function get(path: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sent = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, raw: response.rawHeaders, body }));
    });
    sent.on("error", reject);
    sent.end();
  });
}

const policyOf = async (path: string): Promise<string> => String((await get(path)).headers["content-security-policy"] ?? "");
const policiesOf = (reply: Reply): string[] => reply.raw.filter((_, index, all) => index % 2 === 1 && (all[index - 1] ?? "").toLowerCase() === "content-security-policy");
const ancestorsOf = (policy: string): string => /(?:^|; )frame-ancestors ([^;]*)/.exec(policy)?.[1] ?? "";

const allowsStripe = async (path: string): Promise<boolean> => {
  const policy = await policyOf(path);
  assert.notEqual(policy, "", `${path} 没有内容安全策略`);
  return policy.includes("stripe");
};

const embedUrl = (key: string, host: string, extra = ""): string => `/embed/book?key=${encodeURIComponent(key)}&host=${encodeURIComponent(host)}${extra}`;

before(async () => {
  if (!available) return;
  // 替身 API：frame-check 按上面的固定白名单回答（同真实接口的应答形状），其余一律 404；记下收到的每个请求
  stub = createServer((req, res) => {
    received.push({ url: req.url ?? "", headers: req.headers });
    const url = new URL(req.url ?? "/", "http://stub");
    if (url.pathname === FRAME_CHECK_PATH) {
      const host = url.searchParams.get("host");
      if (url.searchParams.getAll("key").length === 1 && url.searchParams.get("key") === KEY && url.searchParams.getAll("host").length === 1 && host === PARTNER) {
        res.writeHead(204, { "x-nozomi-frame-ancestor": host, "cache-control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(403, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "x-frame-options": "DENY", "cache-control": "no-store" });
      res.end("<p>refused</p>");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":{"code":"NOT_FOUND"}}');
  });
  await new Promise<void>((resolve) => stub?.listen(0, "0.0.0.0", resolve));
  const stubPort = (stub.address() as AddressInfo).port;
  // 只换上游的端口（容器里 api 指向本机，见下面的 --add-host）；Caddyfile 和片段的其余内容原样
  const upstream = (text: string): string => text.replaceAll(API_UPSTREAM, `api:${stubPort}`);
  workDir = mkdtempSync(join(tmpdir(), "nozomi-qa-caddy-"));
  mkdirSync(join(workDir, "etc/nozomi"), { recursive: true });
  mkdirSync(join(workDir, "etc/caddy"), { recursive: true });
  mkdirSync(join(workDir, "srv/web/embed"), { recursive: true });
  writeFileSync(join(workDir, "etc/nozomi/web.caddy"), upstream(renderEdgeConfig(INDEX)));
  writeFileSync(join(workDir, "srv/web/index.html"), INDEX);
  writeFileSync(join(workDir, "srv/web/embed/widget-v1.js"), "void 0;\n");
  writeFileSync(join(workDir, "etc/caddy/Caddyfile"), upstream(readFileSync(CADDYFILE, "utf8")));
  execFileSync("docker", ["create", "--name", NAME, "--add-host", "api:host-gateway", "-p", "127.0.0.1::8080", "-e", "EDGE_MODE=behind-proxy", "-e", "CADDY_SITE_ADDRESS=http://:8080", "-e", "CADDY_TLS_MODE=off", IMAGE], { stdio: "ignore" });
  // docker cp 而不是挂载：不要求 docker 服务端能看到本机的临时目录
  execFileSync("docker", ["cp", "-q", `${workDir}/.`, `${NAME}:/`], { stdio: "ignore" });
  execFileSync("docker", ["start", NAME], { stdio: "ignore" });
  port = Number(/:(\d+)\s*$/.exec(execFileSync("docker", ["port", NAME, "8080"], { encoding: "utf8" }).split("\n")[0] ?? "")?.[1]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await policyOf("/login");
      return;
    } catch (err) {
      if (attempt > 100) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

after(() => {
  if (!available) return;
  spawnSync("docker", ["rm", "-f", NAME], { stdio: "ignore" });
  stub?.close();
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

test("前端镜像的 Caddy 固定到具体版本和摘要，不低于 2.11.4（forward_auth 的 copy_headers 伪造请求头漏洞 CVE-2026-30851、CVE-2026-52845 在 2.11.4 修完）", () => {
  const match = /^caddy:(\d+)\.(\d+)\.(\d+)@sha256:[0-9a-f]{64}$/.exec(IMAGE);
  assert.ok(match, `应写成 caddy:<版本>@sha256:<摘要>，实际是 ${IMAGE}`);
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  assert.ok(major > 2 || (major === 2 && (minor > 11 || (minor === 11 && patch >= 4))), IMAGE);
});

test("官网页面放行 Stripe：/book、结尾斜杠、下面的页面、带回跳参数、大小写不同（前端路由同样渲染官网页面）", { skip }, async () => {
  for (const path of ["/book", "/book/", "/book/order", "/book/order/", "/book/checkout", "/book/order?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=failed", "/Book/order", "/BOOK"]) assert.equal(await allowsStripe(path), true, path);
});

test("后台、登录、司机页和长得像的路径不放行 Stripe", { skip }, async () => {
  for (const path of ["/", "/login", "/platform", "/platform/login", "/platform/orders", "/orders", "/accept-invite", "/platform/reset-password", "/driver", "/bookx", "/books/order", "/book.html", "/book%20", "/platform/book", "/login?next=/book", "/assets/book.js"]) assert.equal(await allowsStripe(path), false, path);
});

test("每个响应恰好一条策略：不会两条叠加，也不会一条都没有（路径怪异时也一样；含嵌入预订页放行和拒绝两种）", { skip }, async () => {
  for (const path of ["/book/order", "/login", "/platform/..%2Fbook", "/Book", embedUrl(KEY, PARTNER), embedUrl(KEY, "https://evil.example"), "/embed/book", "/embed/booking", "/embed/book%2F..", "/platform/..%2Fembed/book"]) {
    assert.equal(policiesOf(await get(path)).length, 1, path);
  }
});

test("编码绕过：打开这些地址时前端渲染的是后台或登录页（运营后台 /platform/login、供应商 /login），策略不能放行 Stripe（ADR 0046：直接打开后台的任何地址都是不放行的那一条）", { skip }, async () => {
  const allowed: string[] = [];
  for (const path of ["/platform/..%2Fbook", "/platform/..%2fbook/order", "/platform/orders/..%2F..%2Fbook", "/platform/login/..%2F..%2Fbook", "/login/..%2Fbook", "/platform%2F..%2Fbook", "/book%2Forder", "//book/order", "/book/nonsense", "/book/..%2Fplatform/login"]) {
    if (await allowsStripe(path)) allowed.push(path);
  }
  assert.deepEqual(allowed, []);
});

test("嵌入预订页（M9E-16）：白名单里的宿主拿到 frame-ancestors <宿主>、不缓存、返回 index.html；/embed/book/order、结尾斜杠、大小写不同同样", { skip }, async () => {
  for (const path of [embedUrl(KEY, PARTNER), embedUrl(KEY, PARTNER).replace("/embed/book?", "/embed/book/?"), embedUrl(KEY, PARTNER).replace("/embed/book?", "/embed/book/order?"), embedUrl(KEY, PARTNER).replace("/embed/book?", "/Embed/Book/Order/?")]) {
    const reply = await get(path);
    assert.equal(reply.status, 200, path);
    assert.equal(reply.body, INDEX, path);
    const policy = String(reply.headers["content-security-policy"]);
    assert.equal(ancestorsOf(policy), PARTNER, `${path}：${policy}`);
    assert.ok(!policy.includes("'none'; frame-ancestors") && !/frame-ancestors[^;]*'none'/.test(policy), path);
    assert.ok(policy.includes("https://js.stripe.com"), "嵌入页同官网页面放行 Stripe（第三期在里面付款）");
    assert.equal(reply.headers["cache-control"], "no-store", path);
  }
});

test("嵌入预订页：不在白名单、嵌入码不对、缺 key、缺 host、什么都不带，都拿到 API 的 403 + frame-ancestors 'none'，不返回页面", { skip }, async () => {
  for (const path of [embedUrl(KEY, "https://evil.example"), embedUrl(`nze_${"Z".repeat(32)}`, PARTNER), `/embed/book?host=${encodeURIComponent(PARTNER)}`, `/embed/book?key=${KEY}`, "/embed/book", "/embed/book/order"]) {
    const reply = await get(path);
    assert.equal(reply.status, 403, path);
    assert.notEqual(reply.body, INDEX, path);
    assert.equal(ancestorsOf(String(reply.headers["content-security-policy"])), "'none'", path);
    assert.equal(reply.headers["x-frame-options"], "DENY", path);
  }
});

test("嵌入预订页：客户端伪造的 X-Nozomi-Frame-Ancestor（含 _ 写法）无效——API 拒绝时仍是 403；API 放行时 frame-ancestors 仍是 API 回的那个宿主", { skip }, async () => {
  const forged = { "x-nozomi-frame-ancestor": "https://evil.example", "X_Nozomi_Frame_Ancestor": "https://evil.example" };
  const denied = await get(embedUrl(KEY, "https://evil.example"), forged);
  assert.equal(denied.status, 403);
  assert.equal(ancestorsOf(String(denied.headers["content-security-policy"])), "'none'");
  assert.equal((await get("/embed/book", forged)).status, 403);
  const allowed = await get(embedUrl(KEY, PARTNER), forged);
  assert.equal(allowed.status, 200);
  assert.equal(ancestorsOf(String(allowed.headers["content-security-policy"])), PARTNER);
  assert.ok(!String(allowed.headers["content-security-policy"]).includes("evil"));
  received.length = 0;
  await get(embedUrl(KEY, PARTNER), forged);
  for (const { headers } of received) {
    assert.equal(headers["x-nozomi-frame-ancestor"], undefined, "伪造的头在问 API 之前就删掉了");
  }
});

test("嵌入预订页：frame-check 只收到 key、host 两个参数（银行回跳带的 payment_intent_client_secret 不进 API）；参数值被转义，不能借 & # 夹带别的参数；X-Forwarded-Uri 不带原地址；不转 Cookie、Authorization", { skip }, async () => {
  received.length = 0;
  const reply = await get(embedUrl(KEY, PARTNER, "&payment_intent=pi_123&payment_intent_client_secret=pi_123_secret_456&redirect_status=succeeded"), { cookie: "nozomi_qa=secret-cookie", authorization: "Bearer nzo_secret" });
  assert.equal(reply.status, 200);
  assert.equal(received.length, 1);
  const call = received[0] as { url: string; headers: IncomingHttpHeaders };
  const url = new URL(call.url, "http://stub");
  assert.equal(url.pathname, FRAME_CHECK_PATH);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["host", "key"]);
  assert.equal(url.searchParams.get("host"), PARTNER);
  assert.ok(!JSON.stringify(call).includes("secret"), `API 收到的请求里不能有 client_secret、Cookie、令牌：${JSON.stringify(call)}`);
  assert.equal(call.headers["x-forwarded-uri"], FRAME_CHECK_PATH);
  assert.equal(call.headers["cookie"], undefined);
  assert.equal(call.headers["authorization"], undefined);

  received.length = 0;
  const injected = await get(`/embed/book?key=${KEY}&host=${encodeURIComponent(`https://evil.example&host=${PARTNER}#x`)}`);
  assert.equal(injected.status, 403, "host 里的 & # 原样转义交给 API，夹带不进第二个 host");
  const injectedUrl = new URL((received[0] as { url: string }).url, "http://stub");
  assert.deepEqual(injectedUrl.searchParams.getAll("host"), [`https://evil.example&host=${PARTNER}#x`]);
  assert.deepEqual(injectedUrl.searchParams.getAll("key"), [KEY]);
});

test("长得像嵌入页的路径（/embed/booking、/embed/book/x、编码绕过）不问 API、拿到 'none' 那一条；其余页面照旧 'none' + X-Frame-Options: DENY；组件脚本、/embed/v1 不受影响", { skip }, async () => {
  received.length = 0;
  for (const path of ["/embed/booking", "/embed/book/x", "/embed/book%2F..", "/embed/book%2Forder", "/platform/..%2Fembed/book", "/embed//book", "/embed/book/order/x", "/login", "/", "/platform/orders", "/book/order"]) {
    const reply = await get(path);
    assert.equal(ancestorsOf(String(reply.headers["content-security-policy"])), "'none'", path);
    assert.equal(reply.headers["x-frame-options"], "DENY", path);
  }
  assert.deepEqual(received.filter((call) => call.url.startsWith(FRAME_CHECK_PATH)), [], "只有嵌入预订页才问 frame-check");
  const widget = await get("/embed/widget-v1.js");
  assert.equal(widget.status, 200);
  assert.equal(widget.headers["cross-origin-resource-policy"], "cross-origin");
  assert.equal(ancestorsOf(String(widget.headers["content-security-policy"])), "'none'");
  received.length = 0;
  const api = await get("/embed/v1/config?key=x");
  assert.equal(api.status, 404, "替身 API 回答了：/embed/v1 仍整个归 API");
  assert.equal(received[0]?.url, "/embed/v1/config?key=x");
});

test("X-Frame-Options（ADR 0095 第五节第 1 小节的结论）：嵌入预订页放行时仍带全局的 DENY——带强制 frame-ancestors 时浏览器忽略它（M9E-16 在 Chromium 153、WebKit 26.6、Firefox 155 实测：同时带 frame-ancestors <宿主> 和 DENY 时三者都能嵌，只带 DENY 时都拦），老到不认 CSP 的浏览器按 DENY 拒绝", { skip }, async () => {
  assert.equal((await get(embedUrl(KEY, PARTNER))).headers["x-frame-options"], "DENY");
});
