/**
 * M3-08 测试角色补充：在真实的 Caddy 上（deploy/Caddyfile + 生成的片段，和正式环境同一个镜像 caddy:2）逐路径核对内容安全策略（ADR 0046）。
 * Caddy 的 path 匹配器不分大小写、会先解码再把路径规整（`..%2F` 算上一级），而前端路由不这样看路径，所以只看片段的文字核对不出这里的差异。
 * 本机或 CI 上没有 docker、没有 caddy:2 镜像时跳过（不主动拉镜像）；容器在测试结束时删掉，用完不留。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEdgeConfig } from "../../web/build/edge-config.ts";

const IMAGE = "caddy:2";
const available = spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;
const skip = available ? false : `本机没有 docker 或 ${IMAGE} 镜像`;
const CADDYFILE = new URL("../../../deploy/Caddyfile", import.meta.url).pathname;
const INDEX = "<!doctype html><html><head><title>x</title><script>1</script></head><body></body></html>";
const NAME = `nozomi-qa-caddy-${process.pid}`;

let port = 0;
let workDir = "";

/** 原样发出路径（fetch 会把 `..` 规整掉，这里要的是服务器看到的原始路径）。 */
function policyOf(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sent = request({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      response.resume();
      resolve(String(response.headers["content-security-policy"] ?? ""));
    });
    sent.on("error", reject);
    sent.end();
  });
}

const allowsStripe = async (path: string): Promise<boolean> => {
  const policy = await policyOf(path);
  assert.notEqual(policy, "", `${path} 没有内容安全策略`);
  return policy.includes("stripe");
};

before(async () => {
  if (!available) return;
  workDir = mkdtempSync(join(tmpdir(), "nozomi-qa-caddy-"));
  mkdirSync(join(workDir, "etc/nozomi"), { recursive: true });
  mkdirSync(join(workDir, "etc/caddy"), { recursive: true });
  mkdirSync(join(workDir, "srv/web"), { recursive: true });
  writeFileSync(join(workDir, "etc/nozomi/web.caddy"), renderEdgeConfig(INDEX));
  writeFileSync(join(workDir, "srv/web/index.html"), INDEX);
  execFileSync("cp", [CADDYFILE, join(workDir, "etc/caddy/Caddyfile")]);
  execFileSync("docker", ["create", "--name", NAME, "-p", "127.0.0.1::8080", "-e", "EDGE_MODE=behind-proxy", "-e", "CADDY_SITE_ADDRESS=http://:8080", "-e", "CADDY_TLS_MODE=off", IMAGE], { stdio: "ignore" });
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
  if (workDir !== "") rmSync(workDir, { recursive: true, force: true });
});

test("官网页面放行 Stripe：/book、结尾斜杠、下面的页面、带回跳参数、大小写不同（前端路由同样渲染官网页面）", { skip }, async () => {
  for (const path of ["/book", "/book/", "/book/order", "/book/order/", "/book/checkout", "/book/order?payment_intent=pi_1&payment_intent_client_secret=pi_1_secret_2&redirect_status=failed", "/Book/order", "/BOOK"]) assert.equal(await allowsStripe(path), true, path);
});

test("后台、登录、司机页和长得像的路径不放行 Stripe", { skip }, async () => {
  for (const path of ["/", "/login", "/platform", "/platform/login", "/platform/orders", "/orders", "/accept-invite", "/platform/reset-password", "/driver", "/bookx", "/books/order", "/book.html", "/book%20", "/platform/book", "/login?next=/book", "/assets/book.js"]) assert.equal(await allowsStripe(path), false, path);
});

test("每个响应恰好一条策略：不会两条叠加，也不会一条都没有（路径怪异时也一样）", { skip }, async () => {
  for (const path of ["/book/order", "/login", "/platform/..%2Fbook", "/Book"]) {
    const headers = await new Promise<string[]>((resolve, reject) => {
      const sent = request({ host: "127.0.0.1", port, path }, (response) => {
        response.resume();
        resolve(response.rawHeaders.filter((_, index, all) => index % 2 === 1 && (all[index - 1] ?? "").toLowerCase() === "content-security-policy"));
      });
      sent.on("error", reject);
      sent.end();
    });
    assert.equal(headers.length, 1, path);
  }
});

test("编码绕过：打开这些地址时前端渲染的是后台或登录页（运营后台 /platform/login、供应商 /login），策略不能放行 Stripe（ADR 0046：直接打开后台的任何地址都是不放行的那一条）", { skip }, async () => {
  const allowed: string[] = [];
  for (const path of ["/platform/..%2Fbook", "/platform/..%2fbook/order", "/platform/orders/..%2F..%2Fbook", "/platform/login/..%2F..%2Fbook", "/login/..%2Fbook", "/platform%2F..%2Fbook", "/book%2Forder", "//book/order"]) {
    if (await allowsStripe(path)) allowed.push(path);
  }
  assert.deepEqual(allowed, []);
});
