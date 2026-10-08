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

/** 库自带的网址：XML 命名空间、React 的报错说明页、react-router 的说明页、解析相对路径用的占位站点。都不会被请求。 */
const KNOWN_URLS = [/^http:\/\/www\.w3\.org\//, /^https:\/\/react\.dev\/errors\//, /^https:\/\/reactrouter\.com\//, /^https:\/\/github\.com\/ungap\/url-search-params\.$/, /^http:\/\/localhost$/, /^https:\/\/www\.geonames\.org\/$/, /^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/$/, /^https:\/\/ourairports\.com\/data\/$/];

test("产物只有 index.html 和带哈希的 JS / CSS，没有 source map", () => {
  const names = files.map(relative).sort();
  expect(names.filter((name) => name.endsWith(".map"))).toEqual([]);
  expect(names).toContain("index.html");
  for (const name of names) expect(name, "出现了预期之外的产物").toMatch(/^(index\.html|assets\/index-[\w-]{8,}\.(js|css))$/);
  for (const { name, text } of textFiles) expect(text.includes("sourceMappingURL"), `${name} 指向了 source map`).toBe(false);
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

test("产物不引用任何站外资源：index.html 只引用本站的 /assets/，JS 和 CSS 里没有站外网址", () => {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? "");
  expect(references.length).toBe(2);
  for (const reference of references) expect(reference).toMatch(/^\/assets\/index-[\w-]+\.(js|css)$/);
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
  const expected = files.map(relative).filter((name) => name.startsWith("assets/")).map((name) => `/${name}`).sort();
  expect(loaded.filter((path) => path.startsWith("/assets/")).sort()).toEqual(expected);
});
