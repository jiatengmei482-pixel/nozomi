/**
 * M1-02 地图底图的部署配置：补充测试（测试工程师）。deploy-map-tiles.test.ts 是开发自己写的。
 *
 * 要守住的一件事（ADR 0015）：接口下发给浏览器的瓦片地址，和内容安全策略 img-src 放行的来源，必须出自同一个值——
 * 否则地图会悄悄变成一片灰。两边各有一段代码读同一个变量：
 * - API：packages/config 的 loadConfig / mapTileOrigin（值来自 docker compose 读 .env 后交给容器的环境变量）；
 * - 反向代理：deploy/bin/compose.sh 自己用 sed 从 .env 里取同名的那一行。
 * 这里用一批写法（http、带端口、带路径和密钥参数、通配符、非法字符、.env 的各种行写法）核对两边的结论一致。
 * 前半用 docker 的替身；后半真的执行 `docker compose config`（只解析配置，不拉镜像、不起容器、不联网），机器上没有 docker compose 时跳过。
 * 名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadConfig, mapTileOrigin } from "@nozomi/config";
import { MAP_TILE_CSP_SOURCES_ENV, contentSecurityPolicy } from "../../web/build/edge-config.ts";
import { testEnv } from "./testing/fixtures.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
let sandbox: string;
let releaseDir: string;
let stubPath: string;

const hasCompose = spawnSync("docker", ["compose", "version"], { encoding: "utf8" }).status === 0;

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "nozomi-map-tiles-qa-"));
  releaseDir = join(sandbox, "root/releases/v1");
  await mkdir(join(releaseDir, "bin"), { recursive: true });
  await mkdir(join(sandbox, "stub"), { recursive: true });
  await cp(join(repoRoot, "deploy/bin/compose.sh"), join(releaseDir, "bin/compose.sh"));
  for (const file of ["compose.yml", "compose.behind-proxy.yml", "Caddyfile"]) await cp(join(repoRoot, "deploy", file), join(releaseDir, file));
  // compose.yml 里写成「缺了就报错」的变量都给一个占位值：这里只关心地图底图那几项怎么传
  const compose = await readFile(join(repoRoot, "deploy/compose.yml"), "utf8");
  const required = [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((match) => match[1] as string))].filter((name) => name !== "POSTGRES_PASSWORD");
  await writeFile(join(releaseDir, "release.env"), `${["APP_ENV=staging", "EDGE_MODE=standalone", ...required.filter((name) => !["APP_ENV", "EDGE_MODE"].includes(name)).map((name) => `${name}=placeholder`)].join("\n")}\n`);
  await writeFile(join(sandbox, "stub/docker"), `#!/usr/bin/env bash\nprintf 'SOURCES=[%s]\\n' "\${${MAP_TILE_CSP_SOURCES_ENV}-unset}"\n`);
  await chmod(join(sandbox, "stub/docker"), 0o755);
  stubPath = `${join(sandbox, "stub")}:${process.env["PATH"] ?? ""}`;
});
after(() => rm(sandbox, { recursive: true, force: true }));

/** 用 docker 的替身执行 compose.sh：返回它算出的 img-src 来源；它拒绝这份配置时返回 null。 */
async function composeSources(envLines: string[]): Promise<string[] | null> {
  await writeFile(join(sandbox, "root/.env"), `${["POSTGRES_PASSWORD=x", ...envLines].join("\n")}\n`);
  const result = spawnSync("bash", [join(releaseDir, "bin/compose.sh"), "config"], { env: { PATH: stubPath }, encoding: "utf8" });
  const match = /^SOURCES=\[(.*)\]$/m.exec(result.stdout);
  if (result.status !== 0 || !match) {
    assert.match(`${result.stdout}${result.stderr}`, /不是合法的瓦片地址/, "拒绝时要说明原因");
    return null;
  }
  return (match[1] as string).split(" ").filter((source) => source !== "");
}

/** API 在测试环境（staging）拿到这份底图配置时：下发的瓦片地址的来源；启动报配置错误时返回 null。 */
function apiOrigins(env: Record<string, string>): string[] | null {
  try {
    const tiles = loadConfig({ ...testEnv("postgres://app:placeholder@127.0.0.1:5432/nozomi"), APP_ENV: "staging", ...env }).mapTiles;
    if (tiles === null) return [];
    return [...new Set([tiles.urlTemplate, tiles.darkUrlTemplate].filter((template): template is string => template !== null).map((template) => mapTileOrigin(template) as string))];
  } catch (err) {
    if (err instanceof ConfigError) return null;
    throw err;
  }
}

const ATTRIBUTION = "© 测试底图|https://tiles.example.com/copyright";

test("瓦片地址的各种写法：compose.sh 放进 img-src 的来源和 API 下发的地址的来源一致；一边拒绝时另一边也拒绝——合法的写法", async () => {
  const accepted: [string, string][] = [
    ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://tile.openstreetmap.org"],
    ["https://tiles.example.com:8443/{z}/{x}/{y}.png", "https://tiles.example.com:8443"],
    ["https://tiles.example.com:443/{z}/{x}/{y}.png", "https://tiles.example.com:443"],
    ["https://api.maptiler.example/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=pk_abc-DEF_123&lang=ja", "https://api.maptiler.example"],
    ["https://tiles.example.com/styles/v1/user/style/tiles/{z}/{x}/{y}?access_token=pk.eyJ1Ijoi~x.y_z", "https://tiles.example.com"],
    ["https://tiles.example.com/wmts?layer=base&TileMatrix={z}&TileCol={x}&TileRow={y}", "https://tiles.example.com"],
    ["https://tiles.example.com/{z}/{x}/{y}{r}.png", "https://tiles.example.com"],
    ["https://tiles.example.com/{z}/{x}/{y}.png?v=1%2C2", "https://tiles.example.com"],
    ["https://xn--zckzah.example.jp/{z}/{x}/{y}.png", "https://xn--zckzah.example.jp"],
    ["https://203.0.113.7/{z}/{x}/{y}.png", "https://203.0.113.7"],
  ];
  for (const [template, origin] of accepted) {
    assert.deepEqual(await composeSources([`MAP_TILE_URL_TEMPLATE=${template}`, `MAP_TILE_ATTRIBUTION=${ATTRIBUTION}`]), [origin], template);
    assert.deepEqual(apiOrigins({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION }), [origin], template);
    // 算出来的来源能原样放进策略，而且只动 img-src
    assert.equal(contentSecurityPolicy([], [origin]), contentSecurityPolicy([]).replace("img-src 'self'", `img-src 'self' ${origin}`));
  }
});

test("瓦片地址的各种写法——不合法的：http、协议大写、通配符、子域名占位 {s}、带账号密码、引号、空格、分号、换行拼接策略、反引号、尖括号、中文域名、IPv6、只有主机、别的协议；两边都拒绝，什么都不放行", async () => {
  const rejected = [
    "http://tiles.example.com/{z}/{x}/{y}.png",
    "http://127.0.0.1:8080/{z}/{x}/{y}.png",
    "http://localhost/{z}/{x}/{y}.png",
    "HTTPS://tiles.example.com/{z}/{x}/{y}.png",
    "https://*.example.com/{z}/{x}/{y}.png",
    "https://*/{z}/{x}/{y}.png",
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://user:secret@tiles.example.com/{z}/{x}/{y}.png",
    "https://tiles.example.com:443@evil.example/{z}/{x}/{y}.png",
    "https://tiles.example.com/{z}/{x}/{y}.png; script-src *",
    "https://tiles.example.com;script-src-elem/{z}/{x}/{y}.png",
    "https://tiles.example.com/{z}/{x}/{y}.png 'unsafe-inline'",
    "https://tiles.example.com /{z}/{x}/{y}.png",
    "'https://tiles.example.com/{z}/{x}/{y}.png'",
    '"https://tiles.example.com/{z}/{x}/{y}.png"',
    "https://tiles.example.com/{z}/{x}/{y}.png`id`",
    "https://tiles.example.com/{z}/{x}/{y}.png$(id)",
    "https://tiles.example.com/<z>/<x>/<y>.png{z}{x}{y}",
    "https://tiles.example.com/{z}/{x}/{y}.png#frag",
    "https://tiles.example.com/{z}/{x}/{y}.png|x",
    "https://tiles.example.com\\{z}\\{x}\\{y}.png",
    "https://地图.example.com/{z}/{x}/{y}.png",
    "https://tïles.example.com/{z}/{x}/{y}.png",
    "https://[2001:db8::1]/{z}/{x}/{y}.png",
    "https://tiles_internal.example.com/{z}/{x}/{y}.png",
    "https://tiles.example.com",
    "https:///{z}/{x}/{y}.png",
    "//tiles.example.com/{z}/{x}/{y}.png",
    "tiles.example.com/{z}/{x}/{y}.png",
    "data:image/png;base64,AAAA{z}{x}{y}",
    "javascript:alert(1)//{z}/{x}/{y}",
    "file:///etc/passwd{z}{x}{y}",
  ];
  for (const template of rejected) {
    assert.equal(await composeSources([`MAP_TILE_URL_TEMPLATE=${template}`, `MAP_TILE_ATTRIBUTION=${ATTRIBUTION}`]), null, `compose.sh 应当拒绝：${template}`);
    assert.equal(apiOrigins({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION }), null, `API 应当拒绝：${template}`);
    // 暗色地址同样处理
    const light = "https://tiles.example.com/{z}/{x}/{y}.png";
    assert.equal(await composeSources([`MAP_TILE_URL_TEMPLATE=${light}`, `MAP_TILE_DARK_URL_TEMPLATE=${template}`, `MAP_TILE_ATTRIBUTION=${ATTRIBUTION}`]), null, `暗色，compose.sh：${template}`);
    assert.equal(apiOrigins({ MAP_TILE_URL_TEMPLATE: light, MAP_TILE_DARK_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION }), null, `暗色，API：${template}`);
  }
});

test("【缺陷】瓦片地址里少了 {z}、{x}、{y} 中的某一个：API 启动报配置错误，compose.sh 应当同样停下并说明，实际照常放行并继续部署（两边的规则不是同一条）", async () => {
  // 最后一个是 TMS 的写法（{-y}，地图库支持）：API 不认，compose.sh 认
  for (const template of ["https://tiles.example.com/{z}/{x}.png", "https://tiles.example.com/tiles/", "https://tiles.example.com/{Z}/{X}/{Y}.png", "https://tiles.example.com/{z}/{x}/{-y}.png"]) {
    assert.equal(apiOrigins({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION }), null, `API 拒绝：${template}`);
    assert.equal(await composeSources([`MAP_TILE_URL_TEMPLATE=${template}`, `MAP_TILE_ATTRIBUTION=${ATTRIBUTION}`]), null, `compose.sh 也应当拒绝：${template}`);
  }
});

test("没配署名、署名写错、只配了暗色地址或署名：API 启动报配置错误并说明是哪一项（不会带着没有署名的地图上线）；没配底图时两边都是「没有」", async () => {
  const template = "https://tiles.example.com/{z}/{x}/{y}.png";
  const issuesOf = (env: Record<string, string>): string[] => {
    try {
      loadConfig({ ...testEnv("postgres://app:placeholder@127.0.0.1:5432/nozomi"), APP_ENV: "staging", ...env });
    } catch (err) {
      if (err instanceof ConfigError) return err.issues;
      throw err;
    }
    return [];
  };
  assert.match(issuesOf({ MAP_TILE_URL_TEMPLATE: template }).join("\n"), /MAP_TILE_ATTRIBUTION/);
  assert.match(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: "   " }).join("\n"), /MAP_TILE_ATTRIBUTION/);
  for (const bad of ["|https://x.example", "文字|http://not-https.example", "文字|javascript:alert(1)", "文字|https://a.example|多一段", `${"长".repeat(201)}`, "a;;|https://x.example", '文字|https://x.example/"onclick="x']) {
    assert.match(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: bad }).join("\n"), /MAP_TILE_ATTRIBUTION/, bad);
  }
  assert.match(issuesOf({ MAP_TILE_DARK_URL_TEMPLATE: template }).join("\n"), /没有 MAP_TILE_URL_TEMPLATE/);
  assert.match(issuesOf({ MAP_TILE_ATTRIBUTION: ATTRIBUTION }).join("\n"), /没有 MAP_TILE_URL_TEMPLATE/);
  assert.deepEqual(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: "© 甲|https://a.example/c ;; 乙" }), []);
  assert.deepEqual(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION, MAP_TILE_REFERRER_POLICY: "unsafe-url" }).length, 1, "不能把完整地址当来源页发给底图服务");
  assert.deepEqual(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION, MAP_TILE_MIN_ZOOM: "12", MAP_TILE_MAX_ZOOM: "5" }).length, 1);
  assert.deepEqual(issuesOf({ MAP_TILE_URL_TEMPLATE: template, MAP_TILE_ATTRIBUTION: ATTRIBUTION, MAP_TILE_SIZE: "300" }).length, 1);
  // 没配、配成空：两边都是没有底图
  for (const lines of [[], ["MAP_TILE_URL_TEMPLATE="], ["MAP_TILE_URL_TEMPLATE=", "MAP_TILE_DARK_URL_TEMPLATE=", "MAP_TILE_ATTRIBUTION="]]) assert.deepEqual(await composeSources(lines), []);
  assert.deepEqual(apiOrigins({}), []);
  assert.deepEqual(apiOrigins({ MAP_TILE_URL_TEMPLATE: "", MAP_TILE_DARK_URL_TEMPLATE: "", MAP_TILE_ATTRIBUTION: "" }), []);
});

test("【缺陷】只配了暗色地址、没配主地址：API 启动报配置错误，compose.sh 应当同样停下，实际照常把暗色地址的来源放进 img-src 并继续部署", async () => {
  const dark = "https://dark.example.com/{z}/{x}/{y}.png";
  assert.equal(apiOrigins({ MAP_TILE_DARK_URL_TEMPLATE: dark, MAP_TILE_ATTRIBUTION: ATTRIBUTION }), null);
  assert.equal(await composeSources([`MAP_TILE_DARK_URL_TEMPLATE=${dark}`, `MAP_TILE_ATTRIBUTION=${ATTRIBUTION}`]), null);
});

// ───────────── .env 的行写法：compose.sh 自己读一遍，docker compose 再读一遍 ─────────────

interface Resolved {
  /** API 容器拿到的 MAP_TILE_URL_TEMPLATE（没有或为空时是 ""） */
  apiTemplate: string;
  /** 反向代理拿到的 MAP_TILE_CSP_SOURCES */
  cspSources: string;
}

/** 真的执行 compose.sh → docker compose config，看两个容器各拿到什么。compose.sh 或 docker compose 拒绝这份 .env 时返回 null。 */
async function resolveWithDocker(envText: string): Promise<Resolved | null> {
  await writeFile(join(sandbox, "root/.env"), `POSTGRES_PASSWORD=x\n${envText}\n`);
  const result = spawnSync("bash", [join(releaseDir, "bin/compose.sh"), "config", "--format", "json"], { env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? sandbox }, encoding: "utf8" });
  if (result.status !== 0) return null;
  const config = JSON.parse(result.stdout) as { services: Record<string, { environment?: Record<string, string | null> }> };
  return { apiTemplate: config.services["api"]?.environment?.["MAP_TILE_URL_TEMPLATE"] ?? "", cspSources: config.services["caddy"]?.environment?.[MAP_TILE_CSP_SOURCES_ENV] ?? "" };
}

const TEMPLATE = "https://tiles.example.com/{z}/{x}/{y}.png";
const ORIGIN = "https://tiles.example.com";

test("真实的 docker compose：标准写法下，API 拿到的瓦片地址和反向代理放行的来源对得上；同一个变量写了两行时两边认的是同一行（最后一行）", { skip: hasCompose ? false : "这台机器没有 docker compose" }, async () => {
  assert.deepEqual(await resolveWithDocker(`MAP_TILE_URL_TEMPLATE=${TEMPLATE}\nMAP_TILE_ATTRIBUTION=${ATTRIBUTION}`), { apiTemplate: TEMPLATE, cspSources: ORIGIN });
  assert.deepEqual(await resolveWithDocker(""), { apiTemplate: "", cspSources: "" });
  assert.deepEqual(await resolveWithDocker("MAP_TILE_URL_TEMPLATE="), { apiTemplate: "", cspSources: "" });
  const twice = await resolveWithDocker(`MAP_TILE_URL_TEMPLATE=https://first.example.com/{z}/{x}/{y}.png\nMAP_TILE_URL_TEMPLATE=https://second.example.com/{z}/{x}/{y}.png`);
  assert.deepEqual(twice, { apiTemplate: "https://second.example.com/{z}/{x}/{y}.png", cspSources: "https://second.example.com" });
  const withKey = "https://tiles.example.com:8443/v1/{z}/{x}/{y}@2x.png?key=pk_abc-123&lang=ja";
  assert.deepEqual(await resolveWithDocker(`MAP_TILE_URL_TEMPLATE=${withKey}`), { apiTemplate: withKey, cspSources: "https://tiles.example.com:8443" });
});

/**
 * .env 里同一行的几种常见写法。docker compose 认它们（去掉引号、行首空白、`export `、行尾注释和空白），
 * compose.sh 自己用 sed 只认「行首就是 变量名=」并把等号后面的原样当值。两边读出来不一样时只允许一种结果：compose.sh 停下并说明。
 * 不允许的结果：API 拿到了瓦片地址而 img-src 没有放行它（地图悄悄变成一片灰），或者放行了一个和 API 下发的不一样的来源。
 */
async function assertConsistent(line: string): Promise<void> {
  const resolved = await resolveWithDocker(`${line}\nMAP_TILE_ATTRIBUTION=${ATTRIBUTION}`);
  if (resolved === null) return; // 停下了：可以接受
  const apiOrigin = resolved.apiTemplate === "" ? "" : (mapTileOrigin(resolved.apiTemplate) ?? `（API 会拒绝启动：${resolved.apiTemplate}）`);
  assert.equal(resolved.cspSources, apiOrigin, `API 拿到的地址是 ${JSON.stringify(resolved.apiTemplate)}，img-src 放行的是 ${JSON.stringify(resolved.cspSources)}`);
}

test("真实的 docker compose：.env 里瓦片地址那一行加了引号、行尾有空格或注释、Windows 换行、后面跟着一行注释掉的旧地址——compose.sh 停下并说明，或者两边读到的一致", { skip: hasCompose ? false : "这台机器没有 docker compose" }, async () => {
  for (const line of [
    `MAP_TILE_URL_TEMPLATE="${TEMPLATE}"`,
    `MAP_TILE_URL_TEMPLATE='${TEMPLATE}'`,
    `MAP_TILE_URL_TEMPLATE=${TEMPLATE}   `,
    `MAP_TILE_URL_TEMPLATE=${TEMPLATE} # 测试环境用 OSM`,
    `MAP_TILE_URL_TEMPLATE=${TEMPLATE}\r`,
    `MAP_TILE_URL_TEMPLATE=${TEMPLATE}\n#MAP_TILE_URL_TEMPLATE=https://old.example.com/{z}/{x}/{y}.png`,
    `#MAP_TILE_URL_TEMPLATE=${TEMPLATE}`,
  ]) {
    await assertConsistent(line);
  }
});

const DIVERGING_ENV_LINES: [string, string][] = [
  ["行首有 export", `export MAP_TILE_URL_TEMPLATE=${TEMPLATE}`],
  ["行首有空格", `  MAP_TILE_URL_TEMPLATE=${TEMPLATE}`],
  ["等号两边有空格", `MAP_TILE_URL_TEMPLATE = ${TEMPLATE}`],
  ["写成了「变量名: 值」", `MAP_TILE_URL_TEMPLATE: ${TEMPLATE}`],
  ["先有一行合规的、后面又有一行带 export 的别的地址", `MAP_TILE_URL_TEMPLATE=${TEMPLATE}\nexport MAP_TILE_URL_TEMPLATE=https://other.example.com/{z}/{x}/{y}.png`],
];

for (const [name, line] of DIVERGING_ENV_LINES) {
  test(`【缺陷】真实的 docker compose：.env 里瓦片地址那一行${name}——API 拿到了地址，img-src 应当放行同一个来源（或者 compose.sh 停下并说明），实际没有放行 / 放行的是另一个：地图悄悄变成一片灰`, { skip: hasCompose ? false : "这台机器没有 docker compose" }, () => assertConsistent(line));
}
