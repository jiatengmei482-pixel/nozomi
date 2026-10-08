/**
 * 前端接入部署（ADR 0007「前端接入部署」）的检查，只读仓库里的文件，不联网、不需要 Docker：
 *
 * - `apps/web/build/edge-config.ts`：构建前端镜像时生成给 Caddy 用的两样东西——归 API 的路径前缀、内容安全策略；
 * - `deploy/Caddyfile`、两个 Dockerfile、流水线、手工部署脚本之间那些「改错了不会立刻报错」的约定。
 *
 * 真实容器里的同一套行为（刷新不 404、接口前缀、缓存、策略里的哈希和页面对得上、经反向代理登录）
 * 由 deploy/ci/smoke.sh 覆盖；浏览器在这条策略下能不能正常工作由端到端测试覆盖（vite preview 带同一条策略）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  EDGE_CONFIG_PATH,
  WEB_ROOT_PATH,
  apiPathPatterns,
  contentSecurityPolicy,
  inlineScriptHashes,
  renderEdgeConfig,
} from "../../web/build/edge-config.ts";
import { API_PATH_PREFIXES, isApiPath } from "../../web/src/lib/api-prefixes.ts";

const ROOT = new URL("../../../", import.meta.url);

async function readText(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), "utf8");
}

/** 去掉注释行，只留下会生效的内容。 */
function codeOf(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const indexHtml = await readText("apps/web/index.html");
const caddyfile = await readText("deploy/Caddyfile");
const webDockerfile = await readText("apps/web/Dockerfile");

test("内联脚本的哈希：对 index.html 里那段主题脚本的原文逐字节计算；外部脚本不算；每段内联脚本各一个", () => {
  const start = indexHtml.indexOf("<script>") + "<script>".length;
  const content = indexHtml.slice(start, indexHtml.indexOf("</script>", start));
  assert.match(content, /nozomi\.theme/, "前提：index.html 里的内联脚本是设置主题的那一段");
  const expected = `sha256-${createHash("sha256").update(content).digest("base64")}`;
  assert.deepEqual(inlineScriptHashes(indexHtml), [expected]);

  // Vite 构建后的形态：内联脚本原样保留，入口脚本换成带 src 的外部脚本
  const built = indexHtml.replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" crossorigin src="/assets/index-abc.js"></script>');
  assert.deepEqual(inlineScriptHashes(built), [expected]);

  assert.deepEqual(inlineScriptHashes("<script>a()</script><p></p><script >b()</script >").length, 2);
  assert.notDeepEqual(inlineScriptHashes("<script>a()</script>"), inlineScriptHashes("<script>a() </script>"), "差一个空格哈希就不同");
  assert.deepEqual(inlineScriptHashes("<html><body></body></html>"), []);
});

test("内联脚本的哈希：页面里出现策略不放行的东西（内联样式、内联事件、style 属性、回车符）时构建直接失败", () => {
  assert.throws(() => inlineScriptHashes("<style>body{}</style>"), /内联 <style>/);
  assert.throws(() => inlineScriptHashes('<body onload="x()"></body>'), /内联事件处理或 style 属性/);
  assert.throws(() => inlineScriptHashes('<div style="color:red"></div>'), /内联事件处理或 style 属性/);
  assert.throws(() => inlineScriptHashes("<script>\r\na()</script>"), /回车符/);
  assert.throws(() => inlineScriptHashes('<script src="/a.js">a()</script>'), /既带 src 又有内容/);
  // 正常的属性不误报
  assert.doesNotThrow(() => inlineScriptHashes('<meta name="color-scheme" content="light dark" /><link rel="stylesheet" crossorigin href="/assets/a.css">'));
});

test("内容安全策略：只认同源，内联脚本只按哈希放行；没有 unsafe-inline / unsafe-eval / 通配 / 站外来源", () => {
  const hash = `sha256-${createHash("sha256").update("x").digest("base64")}`;
  const policy = contentSecurityPolicy([hash]);
  const directives = new Map(policy.split("; ").map((part) => [part.slice(0, part.indexOf(" ")), part.slice(part.indexOf(" ") + 1)]));
  assert.equal(directives.get("default-src"), "'self'");
  assert.equal(directives.get("script-src"), `'self' '${hash}'`);
  assert.equal(directives.get("style-src"), "'self'");
  assert.equal(directives.get("connect-src"), "'self'", "前端只调同源的接口（ADR 0011）");
  assert.equal(directives.get("object-src"), "'none'");
  assert.equal(directives.get("base-uri"), "'none'");
  assert.equal(directives.get("form-action"), "'self'");
  assert.equal(directives.get("frame-ancestors"), "'none'");
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:|data:|blob:/.test(policy), policy);
  assert.ok(!policy.includes('"'), "策略要放进 Caddy 配置的双引号里");
  assert.equal(contentSecurityPolicy([]).includes("script-src 'self';"), true);
  assert.throws(() => contentSecurityPolicy(["sha256-not-a-hash"]), /不是合法的 sha256 哈希/);
  assert.throws(() => contentSecurityPolicy(["'unsafe-inline'"]), /不是合法的 sha256 哈希/);
});

/** 按 Caddy `path` 匹配器的规则判断：整段相等，或以 `/*` 结尾的模式做前缀匹配。查询串不参与。 */
function caddyPathMatches(patterns: readonly string[], url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return patterns.some((pattern) => (pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern));
}

test("归 API 的路径：Caddy 的匹配器、前端的 isApiPath、Vite 代理的正则，对同一批地址的判断完全一致", async () => {
  const patterns = apiPathPatterns();
  assert.deepEqual(patterns, API_PATH_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/*`]));
  // Vite 代理的写法（apps/web/vite.config.ts）：改了那边的正则，这里要跟着核对
  assert.ok((await readText("apps/web/vite.config.ts")).includes("API_PATH_PREFIXES.map((prefix) => [`^${prefix}(/|\\\\?|$)`,"));
  const viteMatches = (url: string): boolean => API_PATH_PREFIXES.some((prefix) => new RegExp(`^${prefix}(/|\\?|$)`).test(url));

  const toApi = API_PATH_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/`, `${prefix}/anything/below`, `${prefix}?probe=1`, `${prefix}/x?token=1`]);
  const toWeb = ["/", "/login", "/platform", "/platform/login", "/accept-invite", "/platform/reset-password", "/assets/index-abc.js", "/healthz", "/platform/v1x", "/tenant/v10", "/webhooksx", "/api/health", "/login?next=/health"];
  for (const url of toApi) {
    assert.equal(caddyPathMatches(patterns, url), true, `${url} 应转给 API`);
    assert.equal(viteMatches(url), true, url);
    assert.equal(isApiPath(url.split("?")[0] ?? ""), true, url);
  }
  for (const url of toWeb) {
    assert.equal(caddyPathMatches(patterns, url), false, `${url} 应归前端`);
    assert.equal(viteMatches(url), false, url);
    assert.equal(isApiPath(url.split("?")[0] ?? ""), false, url);
  }
  assert.throws(() => apiPathPatterns(["/ok", "/has space"]), /不能直接写进 Caddy 配置/);
  assert.throws(() => apiPathPatterns(["/a {\n"]), /不能直接写进 Caddy 配置/);
  assert.throws(() => apiPathPatterns([]), /空的/);
});

test("生成的 Caddy 片段：只有 @api 匹配器和内容安全策略两条指令，策略里的哈希来自传入的页面", () => {
  const lines = codeOf(renderEdgeConfig(indexHtml)).split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `@api path ${apiPathPatterns().join(" ")}`);
  // 图片来源里有一个 Caddy 的环境变量占位：部署时由 MAP_TILE_CSP_SOURCES 填入（地图底图的来源，ADR 0015），没配就是空
  assert.equal(lines[1], `header Content-Security-Policy "${contentSecurityPolicy(inlineScriptHashes(indexHtml), ["{$MAP_TILE_CSP_SOURCES}"])}"`);
  assert.match(lines[1] ?? "", /; img-src 'self' \{\$MAP_TILE_CSP_SOURCES\}; font-src 'self';/);
  assert.equal((lines[1] ?? "").split("{$").length, 2, "整条策略里只有这一处按环境变化");
  assert.notEqual(renderEdgeConfig(indexHtml.replace("nozomi.theme", "nozomi.theme2")), renderEdgeConfig(indexHtml), "页面里的脚本变了，策略跟着变");
});

test("Caddyfile：前缀表和哈希都不手抄——从前端镜像里的片段 import；接口走 @api，其余归前端", () => {
  const code = codeOf(caddyfile);
  assert.equal(code.match(/^\timport (\/\S+)$/m)?.[1], EDGE_CONFIG_PATH, "Caddyfile 必须 import 前端镜像里生成的片段");
  for (const prefix of API_PATH_PREFIXES) {
    assert.ok(!code.includes(prefix), `Caddyfile 里不应手抄 API 前缀 ${prefix}（它来自 ${EDGE_CONFIG_PATH}）`);
  }
  assert.ok(!/sha256-|Content-Security-Policy/.test(code), "内容安全策略不写在 Caddyfile 里，由构建时生成");
  assert.match(code, /\n\thandle @api \{\n\t\timport proxy_api\n\t\}\n/);
  // 站点里只有这一处转给 API（另一处是容器内健康检查专用的 8081）
  assert.equal(code.match(/import proxy_api/g)?.length, 2);
  assert.match(code, new RegExp(`\\n\\thandle \\{\\n\\t\\troot \\* ${WEB_ROOT_PATH}\\n`));
  // 原有的安全响应头对前端和接口的响应一视同仁：写在站点一级，不在某个 handle 里
  assert.match(code, /\n\theader \{\n\t\tStrict-Transport-Security "max-age=31536000"\n\t\tX-Content-Type-Options "nosniff"\n\t\tX-Frame-Options "DENY"\n\t\tReferrer-Policy "no-referrer"\n\t\t-Server\n\t\t-Via\n\t\tdefer\n\t\}\n/);
});

test("Caddyfile：前端路由回退到 index.html 且不缓存；/assets/ 只有真实存在的文件才长缓存，不存在的不回退", () => {
  const code = codeOf(caddyfile);
  const assets = code.slice(code.indexOf("\t\t@asset path /assets/*"), code.indexOf("\t\thandle {\n\t\t\ttry_files"));
  assert.match(assets, /@asset path \/assets\/\*\n\t\thandle @asset \{\n\t\t\t@existing file\n\t\t\theader @existing Cache-Control "public, max-age=31536000, immutable"\n\t\t\tfile_server\n\t\t\}/);
  assert.ok(!assets.includes("try_files") && !assets.includes("index.html"), "/assets/ 下不存在的文件不能回退到 index.html");
  assert.match(code, /\n\t\thandle \{\n\t\t\ttry_files \{path\} \/index\.html\n\t\t\theader Cache-Control "no-cache"\n\t\t\tfile_server\n\t\t\}\n/);
  assert.equal(code.match(/immutable/g)?.length, 1, "长缓存只给 /assets/ 下真实存在的文件");
  assert.ok(!/file_server\s+browse/.test(code), "不列目录");
});

test("前端镜像：最终镜像只是官方 Caddy 加静态文件和生成的片段；片段从构建产物现算；构建上下文是白名单", async () => {
  const stages = [...webDockerfile.matchAll(/^FROM (\S+)(?: AS (\S+))?$/gm)].map((match) => `${match[1]}${match[2] ? ` as ${match[2]}` : ""}`);
  assert.deepEqual(stages, ["node:24-bookworm-slim as build", "caddy:2"]);
  const apiDockerfile = await readText("apps/api/Dockerfile");
  assert.ok(apiDockerfile.includes("FROM node:24-bookworm-slim AS build"), "两个镜像用同一个 Node 版本构建");
  const final = webDockerfile.slice(webDockerfile.lastIndexOf("\nFROM "));
  assert.deepEqual(final.trim().split("\n").slice(1), [
    `COPY --from=build /app/apps/web/dist ${WEB_ROOT_PATH}`,
    `COPY --from=build /out/web.caddy ${EDGE_CONFIG_PATH}`,
  ]);
  assert.match(webDockerfile, /pnpm install --frozen-lockfile /);
  assert.match(webDockerfile, /pnpm --filter @nozomi\/web build \\\n[\s\S]*node apps\/web\/build\/edge-config-cli\.ts apps\/web\/dist\/index\.html >\/out\/web\.caddy/);
  assert.match(webDockerfile, /chmod -R u=rwX,go=rX apps\/web\/dist \/out/, "反向代理容器没有无视文件权限的特权，静态文件必须所有人可读");
  assert.ok(!/^\s*(ENV|ARG)\s+\S*(SECRET|PASSWORD|KEY|TOKEN)/im.test(webDockerfile), "Dockerfile 里不应出现密钥类变量");
  // 构建脚本和 package.json 里的命令是同一个（pnpm web:build）
  const rootPackage = JSON.parse(await readText("package.json")) as { scripts: Record<string, string> };
  assert.equal(rootPackage.scripts["web:build"], "pnpm --filter @nozomi/web build");

  const ignore = (await readText("apps/web/Dockerfile.dockerignore")).split("\n").filter((line) => line && !line.startsWith("#"));
  assert.equal(ignore[0], "*", "第一条规则必须是排除全部");
  for (const rule of ["**/.env", "**/.env.*", "**/node_modules", "**/*.test.ts", "**/*.test.tsx", "apps/web/dist", "apps/web/e2e", "apps/api/*", "docs/*"]) {
    assert.ok(ignore.includes(rule), `apps/web/Dockerfile.dockerignore 缺少 ${rule}`);
  }
  const allowed = ignore.filter((line) => line.startsWith("!")).sort();
  assert.deepEqual(allowed, [
    "!apps/",
    "!apps/api/",
    "!apps/api/package.json",
    "!apps/web/",
    "!docs/",
    "!docs/design/",
    "!docs/design/tokens.css",
    "!package.json",
    "!packages/",
    "!packages/config/",
    "!packages/config/package.json",
    "!packages/domain/",
    "!pnpm-lock.yaml",
    "!pnpm-workspace.yaml",
    "!tsconfig.json",
  ]);
  // deploy/、.git、.github 都不在白名单里；白名单规则之后只有排除规则
  const lastAllow = ignore.findLastIndex((line) => line.startsWith("!"));
  assert.ok(ignore.indexOf("**/.env") > lastAllow && ignore.indexOf("**/node_modules") > lastAllow);
});

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  jobs: Record<string, { outputs?: Record<string, string>; steps: Step[] }>;
}

test("一个版本是一对同标签的镜像：流水线、手工部署、服务器脚本、冒烟用的是同一条命名规则", async () => {
  const workflow = parse(await readText(".github/workflows/deploy.yml")) as Workflow;
  const plan = workflow.jobs["plan"]?.steps[0]?.run ?? "";
  assert.match(plan, /echo "image=\$REGISTRY\/\$\{OWNER,,\}\/nozomi-api:\$sha"/);
  assert.match(plan, /echo "web_image=\$REGISTRY\/\$\{OWNER,,\}\/nozomi-web:\$sha"/);
  assert.equal(workflow.jobs["plan"]?.outputs?.["web_image"], "${{ steps.plan.outputs.web_image }}");
  const build = workflow.jobs["build"]?.steps.find((step) => (step.run ?? "").includes("docker build"));
  assert.equal(build?.env?.["WEB_IMAGE"], "${{ needs.plan.outputs.web_image }}");
  assert.match(build?.run ?? "", /\n {2}docker push "\$1"\n\}\nbuild_and_push "\$IMAGE" apps\/api\/Dockerfile\nbuild_and_push "\$WEB_IMAGE" apps\/web\/Dockerfile\n$/);
  assert.match(build?.run ?? "", /docker build --file "\$2" --tag "\$1" \\\n/);

  const pushLocal = await readText("deploy/client/push-local.sh");
  assert.match(pushLocal, /\n {2}image="nozomi-api:\$sha"\n[^\n]*\n {2}web_image="nozomi-web:\$sha"\n/);
  assert.match(pushLocal, /--file "\$repo_root\/apps\/api\/Dockerfile" --tag "\$image" \\\n/);
  assert.match(pushLocal, /--file "\$repo_root\/apps\/web\/Dockerfile" --tag "\$web_image" \\\n/);
  assert.equal(pushLocal.match(/docker build --quiet --platform "\$platform" /g)?.length, 2, "两个镜像都按服务器的架构构建");

  // 服务器上：pull / 确认在本机 / 清理 都同时覆盖两个镜像
  const deployScript = await readText("deploy/bin/deploy.sh");
  assert.match(deployScript, /"\$release_dir\/bin\/compose\.sh" pull --quiet api caddy \|\|/);
  assert.match(deployScript, /for image in "\$API_IMAGE" "\$WEB_IMAGE"; do\n {6}docker image inspect "\$image" >\/dev\/null 2>&1 \|\|/);
  assert.match(deployScript, /^WEB_IMAGE=\$WEB_IMAGE$/m, "前端镜像记在版本目录的 release.env 里：回退时和 API 镜像一起回到上一个版本");

  const smoke = await readText("deploy/ci/smoke.sh");
  for (const tag of ["good", "bad", "next"]) {
    assert.ok(smoke.includes(`_image="nozomi-api:smoke-${tag}"`) && smoke.includes(`_web_image="nozomi-web:smoke-${tag}"`), `冒烟的 ${tag} 版本应是一对同标签的镜像`);
  }
  assert.match(smoke, /docker build --quiet --file "\$repo_root\/apps\/web\/Dockerfile" --tag "\$good_web_image" "\$repo_root"/);
});

test("冒烟：两种入口模式都经反向代理检查前端、接口前缀、/assets/、内容安全策略、缓存，并真的登录一次", async () => {
  const smoke = await readText("deploy/ci/smoke.sh");
  assert.match(smoke, /\ncheck_frontend "首次部署后"\n/);
  assert.match(smoke, /\ncheck_frontend "手动回退后"\n/);
  const checkStart = smoke.indexOf("check_frontend() {");
  const check = smoke.slice(checkStart, smoke.indexOf("\n}\n", checkStart));
  // 全部经 request（standalone 到 Caddy 的 HTTPS；behind-proxy 先到外层代理），没有绕过反向代理的检查
  assert.ok(!/\bcurl\b|EDGE_LISTEN|compose exec/.test(codeOf(check)));
  for (const path of ["/login", "/platform/login", "/accept-invite"]) assert.ok(check.includes(` ${path} `), `没有检查刷新 ${path}`);
  // 接口前缀：表里的每一个都检查了「前缀本身带查询串」
  for (const prefix of API_PATH_PREFIXES) {
    assert.ok(check.includes(`"${prefix}?probe=1"`), `冒烟没有检查 ${prefix} 带查询串的情况`);
  }
  assert.match(check, /\/assets\/does-not-exist\.js/);
  assert.match(check, /openssl dgst -sha256 -binary \| base64/, "策略里的哈希要用另一套工具从实际拿到的页面重新算一遍");
  assert.match(check, /cache-control: public, max-age=31536000, immutable\$/);
  assert.match(check, /cache-control: no-cache\$/);
  // 登录：经反向代理拿到令牌，再带着令牌取自己的资料
  assert.match(smoke, /access_token="\$\(login_access_token\)"\n\[\[ -n "\$access_token" \]\] \|\| fail/);
  assert.match(smoke, /--header "authorization: Bearer \$access_token" "\$base_url\/platform\/v1\/auth\/me"/);
  // 前端跟着版本一起切换、一起回退
  assert.match(smoke, /\[\[ "\$\(running_images\)" == "\$good_image \$good_web_image" \]\] \|\| fail "手动回退后/);

  const rehearsal = await readText("deploy/ci/push-local-check.sh");
  assert.match(rehearsal, /for path in \/ \/login \/platform\/login; do\n/);
  assert.match(rehearsal, /经外层 nginx 按域名访问 \$path 应返回前端的登录页/);
  assert.match(rehearsal, /nozomi-api:\$sha_first nozomi-web:\$sha_first/);
});

test("端到端测试用的 vite preview 带同一条内容安全策略（同一个函数、同一份构建产物）；文档写明了做法", async () => {
  const viteConfig = await readText("apps/web/vite.config.ts");
  assert.match(viteConfig, /import \{ contentSecurityPolicy, inlineScriptHashes \} from "\.\/build\/edge-config\.ts";/);
  assert.match(viteConfig, /configurePreviewServer\(server\) \{[\s\S]*contentSecurityPolicy\(inlineScriptHashes\(indexHtml\)\)[\s\S]*response\.setHeader\("Content-Security-Policy", policy\)/);
  assert.match(viteConfig, /plugins: \[react\(\), previewContentSecurityPolicy\(\)\]/);

  const adr = await readText("docs/adr/0007-vps-deployment.md");
  assert.match(adr, /## 补充.*前端接入部署/);
  for (const term of ["nozomi-web", "Content-Security-Policy", "immutable", "index.html", "api-prefixes.ts"]) {
    assert.ok(adr.includes(term), `ADR 0007「前端接入部署」缺少：${term}`);
  }
  assert.match(await readText("docs/deploy.md"), /登录页/);
});
