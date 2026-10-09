/**
 * 地图底图的部署配置（M1-02，ADR 0015）：接口下发的瓦片地址和内容安全策略 img-src 放行的来源必须是同一个值。
 *
 * - API 从环境变量 MAP_TILE_URL_TEMPLATE 读瓦片地址（packages/config）；
 * - 反向代理的 img-src 来源由 deploy/bin/compose.sh 从**同一个变量**算出，经 MAP_TILE_CSP_SOURCES 填进
 *   构建前端镜像时生成的策略里留的占位（apps/web/build/edge-config.ts）。
 * 这里真的执行 compose.sh（把 docker 换成一个只打印环境变量的替身），核对它算出的来源和 packages/config 的规则一致。
 * 真实容器里的效果由 deploy/ci/smoke.sh 覆盖。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { mapTileOrigin } from "@nozomi/config";
import { MAP_TILE_CSP_SOURCES_ENV, contentSecurityPolicy, renderEdgeConfig } from "../../web/build/edge-config.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
let sandbox: string;

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "nozomi-map-tiles-"));
  await mkdir(join(sandbox, "root/releases/v1/bin"), { recursive: true });
  await mkdir(join(sandbox, "stub"), { recursive: true });
  await cp(join(repoRoot, "deploy/bin/compose.sh"), join(sandbox, "root/releases/v1/bin/compose.sh"));
  await writeFile(join(sandbox, "root/releases/v1/release.env"), "APP_ENV=staging\nEDGE_MODE=standalone\n");
  // docker 的替身：只把 compose.sh 交给它的那个变量打印出来
  await writeFile(join(sandbox, "stub/docker"), `#!/usr/bin/env bash\nprintf 'SOURCES=[%s]\\n' "\${${MAP_TILE_CSP_SOURCES_ENV}-unset}"\n`);
  await chmod(join(sandbox, "stub/docker"), 0o755);
});
after(() => rm(sandbox, { recursive: true, force: true }));

async function composeWith(envLines: string[], processEnv: Record<string, string> = {}): Promise<{ status: number | null; output: string }> {
  await writeFile(join(sandbox, "root/.env"), `${["POSTGRES_PASSWORD=x", ...envLines].join("\n")}\n`);
  const result = spawnSync("bash", [join(sandbox, "root/releases/v1/bin/compose.sh"), "config"], {
    env: { PATH: `${join(sandbox, "stub")}:${process.env["PATH"] ?? ""}`, ...processEnv },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("compose.sh：没配地图底图时来源为空；配了就取瓦片地址的「协议 + 主机 + 端口」，和 packages/config 的规则得到同一个值", async () => {
  assert.deepEqual(await composeWith([]), { status: 0, output: "SOURCES=[]\n" });
  assert.deepEqual(await composeWith(["MAP_TILE_URL_TEMPLATE="]), { status: 0, output: "SOURCES=[]\n" });
  for (const template of [
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://api.example-tiles.com:8443/maps/streets/{z}/{x}/{y}@2x.png?key=pk_public_123&lang=ja",
    "https://a.b-c.example.co.jp/{z}/{x}/{y}",
  ]) {
    const result = await composeWith([`MAP_TILE_URL_TEMPLATE=${template}`, "MAP_TILE_ATTRIBUTION=x"]);
    assert.deepEqual(result, { status: 0, output: `SOURCES=[${mapTileOrigin(template)}]\n` }, template);
    assert.notEqual(mapTileOrigin(template), null);
  }
});

test("compose.sh：暗色底图是另一个主机时两个来源都放行；同一个主机只列一次；调用方环境里的同名变量不起作用", async () => {
  const light = "MAP_TILE_URL_TEMPLATE=https://tiles.example.com/light/{z}/{x}/{y}.png";
  assert.equal((await composeWith([light, "MAP_TILE_DARK_URL_TEMPLATE=https://dark.example.com/{z}/{x}/{y}.png"])).output, "SOURCES=[https://tiles.example.com https://dark.example.com]\n");
  assert.equal((await composeWith([light, "MAP_TILE_DARK_URL_TEMPLATE=https://tiles.example.com/dark/{z}/{x}/{y}.png"])).output, "SOURCES=[https://tiles.example.com]\n");
  assert.equal((await composeWith([light], { MAP_TILE_CSP_SOURCES: "https://evil.example *" })).output, "SOURCES=[https://tiles.example.com]\n");
  assert.equal((await composeWith([], { MAP_TILE_CSP_SOURCES: "*", MAP_TILE_URL_TEMPLATE: "https://from-process-env.example/{z}/{x}/{y}" })).output, "SOURCES=[]\n", "只认 .env 文件里的值");
});

test("compose.sh：瓦片地址写错了（不是 https、带引号空格分号、通配符）就停下并说明，不把奇怪的字符拼进策略", async () => {
  for (const bad of [
    "http://tiles.example.com/{z}/{x}/{y}.png",
    "https://tiles.example.com/{z}/{x}/{y}.png; script-src *",
    "'https://tiles.example.com/{z}/{x}/{y}.png'",
    '"https://tiles.example.com/{z}/{x}/{y}.png"',
    "https://*.example.com/{z}/{x}/{y}.png",
    "https://tiles.example.com",
    "tiles.example.com/{z}/{x}/{y}.png",
  ]) {
    const result = await composeWith([`MAP_TILE_URL_TEMPLATE=${bad}`]);
    assert.equal(result.status, 1, bad);
    assert.match(result.output, /MAP_TILE_URL_TEMPLATE 不是合法的瓦片地址/);
    assert.ok(!result.output.includes("SOURCES="), "出错时不应继续执行 docker compose");
    assert.equal(mapTileOrigin(bad), null, `packages/config 同样不接受：${bad}`);
  }
});

test("内容安全策略：地图底图只多放行 img-src 里的那一个来源，别的指令不动；不合规的来源写不进去", () => {
  const base = contentSecurityPolicy([]);
  const withTiles = contentSecurityPolicy([], ["https://tile.openstreetmap.org"]);
  assert.equal(withTiles, base.replace("img-src 'self'", "img-src 'self' https://tile.openstreetmap.org"));
  assert.match(contentSecurityPolicy([], ["https://a.example", "https://b.example:8443"]), /; img-src 'self' https:\/\/a\.example https:\/\/b\.example:8443; /);
  assert.match(contentSecurityPolicy([], ["http://127.0.0.1:4999"]), /img-src 'self' http:\/\/127\.0\.0\.1:4999;/, "端到端测试的本机假瓦片服务");
  for (const bad of ["*", "https:", "data:", "blob:", "https://*.example.com", "https://a.example/path", "http://a.example", "https://a.example; script-src *", 'https://a.example"', "'unsafe-inline'", ""]) {
    assert.throws(() => contentSecurityPolicy([], [bad]), /不能放进 img-src/, bad);
  }
});

test("生成的 Caddy 片段和 compose.yml：占位的变量名、反向代理和 API 拿到的变量对得上", async () => {
  const fragment = renderEdgeConfig("<html><head></head><body></body></html>");
  assert.ok(fragment.includes(`img-src 'self' {$${MAP_TILE_CSP_SOURCES_ENV}};`));
  const compose = parse(await readFile(join(repoRoot, "deploy/compose.yml"), "utf8")) as { services: Record<string, { environment?: Record<string, string> }> };
  assert.equal(compose.services["caddy"]?.environment?.[MAP_TILE_CSP_SOURCES_ENV], `\${${MAP_TILE_CSP_SOURCES_ENV}:-}`);
  const api = compose.services["api"]?.environment ?? {};
  for (const name of ["MAP_TILE_URL_TEMPLATE", "MAP_TILE_DARK_URL_TEMPLATE", "MAP_TILE_ATTRIBUTION", "MAP_TILE_REFERRER_POLICY", "MAP_TILE_MIN_ZOOM", "MAP_TILE_MAX_ZOOM", "MAP_TILE_SIZE"]) {
    assert.equal(api[name], `\${${name}:-}`, name);
  }
  assert.equal(compose.services["api"]?.environment?.[MAP_TILE_CSP_SOURCES_ENV], undefined);
  const script = await readFile(join(repoRoot, "deploy/bin/compose.sh"), "utf8");
  assert.match(script, new RegExp(`export ${MAP_TILE_CSP_SOURCES_ENV}="\\$map_tile_csp_sources"`));
  // 全站的来源页策略不动：瓦片图片的来源页由前端按 map/config 里的策略单独设
  assert.match(await readFile(join(repoRoot, "deploy/Caddyfile"), "utf8"), /Referrer-Policy "no-referrer"/);
});
