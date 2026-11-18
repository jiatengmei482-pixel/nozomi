/**
 * 构建产物检查（pnpm test:e2e 会先执行 vite build，这里检查的就是那份 dist）：
 * 没有 source map、没有环境变量和密钥、没有本机路径、不引用站外资源、测试代码没被打进去。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST);
const relative = (path: string): string => path.slice(DIST.length);
const textFiles = files.filter((path) => /\.(js|css|html|json|txt|svg)$/.test(path)).map((path) => ({ name: relative(path), text: readFileSync(path, "utf8") }));

/**
 * 「通过 WhatsApp 联系我们」的链接模板（M8-21，ADR 0076）：@nozomi/domain 的 `whatsappChatUrl` 拼的 `https://wa.me/<号码>?text=<编码的一句话>`。
 * 这是客人自己点开的站外链接（新标签页、noopener noreferrer），不是页面加载的资源；只放行这一个模板的原样（号码、文字都是变量），wa.me 的其他写法和任何别的站点照旧不许。
 */
const WHATSAPP_CHAT_URL = /^https:\/\/wa\.me\/\$\{[A-Za-z_$][\w$]*\}\?text=\$\{encodeURIComponent\([A-Za-z_$][\w$]*$/;

/** 库自带的网址：XML 命名空间、React 的报错说明页、react-router 的说明页、解析相对路径用的占位站点、地图库 Leaflet 的官网（它的署名控件用，我们没用那个控件，ADR 0017）。都不会被请求。 */
const KNOWN_URLS = [/^http:\/\/www\.w3\.org\//, /^https:\/\/react\.dev\/errors\//, /^https:\/\/reactrouter\.com\//, /^https:\/\/github\.com\/ungap\/url-search-params\.$/, /^http:\/\/localhost$/, /^https:\/\/www\.geonames\.org\/$/, /^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/$/, /^https:\/\/ourairports\.com\/data\/$/, /^https:\/\/leafletjs\.com$/, /^https:\/\/js\.stripe\.com\/v3\/$/, WHATSAPP_CHAT_URL];

test("产物只有 index.html、带哈希的 JS / CSS、组件脚本和标记图标（10–12 号、上下车合并的 1·N），没有 source map", () => {
  const names = files.map(relative).sort();
  expect(names.filter((name) => name.endsWith(".map"))).toEqual([]);
  expect(names).toContain("index.html");
  // 嵌入组件脚本（M9E-03，ADR 0090）：固定文件名，合作网站页面直接引用；包车行程地图 10–12 号标记的图标（M9P-20，ADR 0096）：谷歌出图时来取
  for (const name of names) expect(name, "出现了预期之外的产物").toMatch(/^(index\.html|assets\/[\w-]+-[\w-]{8,}\.(js|css)|embed\/widget-v1\.js|map-markers\/(1[0-2]|1-([3-9]|1[0-2]))\.png)$/);
  expect(names.filter((name) => name.startsWith("map-markers/")).sort()).toEqual(["10", "11", "12", ...Array.from({ length: 10 }, (_, i) => `1-${i + 3}`)].map((n) => `map-markers/${n}.png`).sort());
  for (const { name, text } of textFiles) expect(text.includes("sourceMappingURL"), `${name} 指向了 source map`).toBe(false);
});

test("嵌入组件脚本只含 ASCII：中日英文案都转成 \\uXXXX，合作网站是 Shift_JIS 等非 UTF-8 页面时也不会乱码（M9E-07）", () => {
  const bytes = readFileSync(join(DIST, "embed/widget-v1.js"));
  const offending = bytes.findIndex((byte) => byte > 0x7f);
  expect(offending, `第 ${offending} 个字节不是 ASCII`).toBe(-1);
  const text = bytes.toString("latin1");
  // 文案还在，只是换了写法：「预订组件暂时无法使用」的转义原样出现，运行时由 JS 还原成中文。
  const escaped = [..."预订组件暂时无法使用"].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
  expect(text.toLowerCase()).toContain(escaped);
});

test("产物里没有环境变量、密钥、数据库地址、本机路径、测试代码", () => {
  const secretValues = ["AUTH_JWT_SECRET", "DATABASE_URL", "E2E_ADMIN_PASSWORD", "E2E_ADMIN_EMAIL"].map((name) => process.env[name]).filter((value): value is string => typeof value === "string" && value.length >= 8);
  expect(process.env["E2E_ADMIN_PASSWORD"], "前提：global-setup 已经把管理员密码放进环境变量").toBeTruthy();
  for (const { name, text } of textFiles) {
    for (const value of secretValues) expect(text.includes(value), `${name} 里出现了环境变量的值`).toBe(false);
    for (const marker of ["AUTH_JWT_SECRET", "DATABASE_URL", "postgres://", "postgresql://", "ci-placeholder", "NOZOMI_API_ORIGIN", "BEGIN PRIVATE KEY", "/workspaces/", "/home/", "node_modules/", "测试没有登记接口", "@testing-library", "happy-dom"]) {
      expect(text.includes(marker), `${name} 里出现了 ${marker}`).toBe(false);
    }
  }
});

test("产物不引用任何站外资源：index.html 只引用本站的 /assets/，JS 和 CSS 里没有站外网址（Stripe.js 的地址是唯一的站外脚本，只在官网要付款时加载，ADR 0046）", () => {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? "");
  // 入口的 JS、CSS，加上 Vite 给首包依赖的小分包写的 modulepreload（M9E-25 按需加载以后才有）；都在本站 /assets/ 下
  expect(references.filter((reference) => /^\/assets\/index-[\w-]+\.(js|css)$/.test(reference)).length).toBe(2);
  for (const reference of references) expect(reference).toMatch(/^\/assets\/[\w-]+-[\w-]{8,}\.(js|css)$/);
  expect(html).toContain('<meta name="referrer" content="no-referrer" />');

  for (const { name, text } of textFiles) {
    const urls = [...text.matchAll(/\bhttps?:\/\/[^\s"'`)<>\\]+/g)].map((match) => match[0]);
    const unexpected = urls.filter((url) => !KNOWN_URLS.some((known) => known.test(url)));
    expect(unexpected, `${name} 里有站外网址`).toEqual([]);
    if (name.endsWith(".css")) {
      expect(text, `${name} 不应加载外部字体、图片或样式`).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//);
      expect(text).not.toContain("@font-face");
    }
  }
});

test("设计令牌已并入产物的 CSS（亮色、暗色、手动覆盖三段都在），页面实际加载的就是这份文件", async ({ page }) => {
  const css = textFiles.find((file) => file.name.endsWith(".css"))?.text ?? "";
  expect(css).toContain("--color-bg-page:");
  expect(css).toMatch(/prefers-color-scheme:\s*dark/);
  expect(css).toMatch(/\[data-theme="?dark"?\]/);
  expect(css).toMatch(/:not\(\[data-theme="?light"?\]\)/);

  const loaded: string[] = [];
  page.on("response", (response) => loaded.push(new URL(response.url()).pathname));
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
  // 首页只加载 index.html 引用的那几个文件；地图（Leaflet）的分包按需加载，这里不加载（M9E-25）
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const expected = [...html.matchAll(/\b(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1] ?? "").sort();
  expect(loaded.filter((path) => path.startsWith("/assets/")).sort()).toEqual(expected);
});

test("首包里没有 Leaflet（M9E-25）：Leaflet 只在按需加载的地图分包里，index.html 引用的文件都不含它", () => {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const initial = [...html.matchAll(/\b(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1] ?? "");
  expect(initial.length).toBeGreaterThan(0);
  for (const name of initial) expect(readFileSync(join(DIST, name), "utf8").includes("_leaflet_id"), `${name} 里有 Leaflet`).toBe(false);
  expect(textFiles.some(({ name, text }) => name.endsWith(".js") && text.includes("_leaflet_id")), "Leaflet 还在产物里（地图分包）").toBe(true);
});
