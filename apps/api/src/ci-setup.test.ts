/**
 * 验收标准 3、4 的静态检查：锁文件已就绪且与各 package.json 一致、CI 用 --frozen-lockfile 安装、
 * CI 带 PostgreSQL 服务并真的跑迁移和集成测试。只读仓库里的配置文件，不联网、不需要数据库。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";

const ROOT = new URL("../../../", import.meta.url);

async function readText(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), "utf8");
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Lockfile {
  lockfileVersion: string;
  importers: Record<
    string,
    { dependencies?: Record<string, { specifier: string }>; devDependencies?: Record<string, { specifier: string }> }
  >;
}

interface Workflow {
  jobs: Record<
    string,
    {
      services?: Record<string, { image: string; env?: Record<string, string>; ports?: string[]; options?: string }>;
      env?: Record<string, string>;
      steps: { name?: string; run?: string; uses?: string }[];
    }
  >;
}

/** 工作区里全部包的目录（锁文件 importers 的键），含根目录 "."。 */
async function workspaceDirs(): Promise<string[]> {
  const dirs = ["."];
  for (const group of ["packages", "apps"]) {
    for (const entry of await readdir(new URL(`${group}/`, ROOT), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${group}/${entry.name}`);
    }
  }
  return dirs;
}

function specifiers(group: Record<string, { specifier: string }> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(group ?? {}).map(([name, value]) => [name, value.specifier]));
}

const workflow = parse(await readText(".github/workflows/ci.yml")) as Workflow;
const job = workflow.jobs["check"];
const runs = (job?.steps ?? []).map((step) => step.run ?? "");
const rootPackage = JSON.parse(await readText("package.json")) as PackageJson;

test("pnpm-lock.yaml 存在、没有被 .gitignore 排除，且与每个 package.json 声明的依赖完全一致（否则 --frozen-lockfile 会失败）", async () => {
  const lock = parse(await readText("pnpm-lock.yaml")) as Lockfile;
  assert.ok(lock.lockfileVersion, "pnpm-lock.yaml 不是有效的锁文件");
  const ignored = (await readText(".gitignore")).split("\n").map((line) => line.trim());
  assert.ok(!ignored.some((line) => /pnpm-lock|^\*\.yaml$|^\*\.ya?ml$/.test(line)), ".gitignore 排除了锁文件");

  const dirs = await workspaceDirs();
  assert.deepEqual(Object.keys(lock.importers).sort(), [...dirs].sort(), "锁文件里的包列表与工作区不一致");
  for (const dir of dirs) {
    const pkg = JSON.parse(await readText(`${dir}/package.json`)) as PackageJson;
    const importer = lock.importers[dir];
    assert.deepEqual(specifiers(importer?.dependencies), pkg.dependencies ?? {}, `${dir} 的 dependencies 与锁文件不一致`);
    assert.deepEqual(
      specifiers(importer?.devDependencies),
      pkg.devDependencies ?? {},
      `${dir} 的 devDependencies 与锁文件不一致`,
    );
  }
});

test("CI 安装依赖时用 --frozen-lockfile，没有不带它的 pnpm install", () => {
  const installs = runs.filter((run) => /\bpnpm\s+(install|i)\b/.test(run));
  assert.ok(installs.length >= 1, "CI 里没有安装依赖的步骤");
  for (const run of installs) assert.match(run, /--frozen-lockfile\b/);
  assert.ok(!runs.some((run) => run.includes("--no-frozen-lockfile")), "CI 里有 --no-frozen-lockfile");
  assert.ok(!runs.some((run) => /(^|[^p])npm (install|ci)\b/.test(run)), "CI 里混用了 npm 安装");
});

test("CI 起了 PostgreSQL 服务：版本与本地 docker-compose 一致，带健康检查，DATABASE_URL 指向它", async () => {
  const postgres = job?.services?.["postgres"];
  assert.ok(postgres, "CI 没有 postgres 服务");
  const compose = parse(await readText("docker-compose.yml")) as { services: { db: { image: string } } };
  assert.equal(postgres.image, compose.services.db.image, "CI 与本地开发用的 PostgreSQL 版本不一致");
  assert.match(postgres.options ?? "", /--health-cmd/);
  assert.ok((postgres.ports ?? []).some((port) => String(port).endsWith(":5432")));

  const url = new URL(job?.env?.["DATABASE_URL"] ?? "");
  assert.equal(url.username, postgres.env?.["POSTGRES_USER"]);
  assert.equal(url.password, postgres.env?.["POSTGRES_PASSWORD"]);
  assert.equal(url.pathname, `/${postgres.env?.["POSTGRES_DB"]}`);
  assert.equal(url.port, "5432");
});

test("CI 在安装之后依次跑：类型检查、单元测试、迁移两次（验证可重复执行）、集成测试", () => {
  const indexOf = (pattern: RegExp, from = 0): number => runs.findIndex((run, i) => i >= from && pattern.test(run));
  const install = indexOf(/pnpm install/);
  const typecheck = indexOf(/^pnpm typecheck$/);
  const unit = indexOf(/^pnpm test$/);
  const firstMigrate = indexOf(/^pnpm db:migrate$/);
  const secondMigrate = indexOf(/^pnpm db:migrate$/, firstMigrate + 1);
  const integration = indexOf(/^pnpm test:integration$/);
  for (const [name, index] of Object.entries({ install, typecheck, unit, firstMigrate, secondMigrate, integration })) {
    assert.ok(index >= 0, `CI 缺少步骤：${name}`);
  }
  assert.ok(install < typecheck && install < unit && install < firstMigrate && install < integration);
  assert.ok(firstMigrate < secondMigrate);
});

test("CI 的集成测试步骤没有被设成「失败也继续」", () => {
  const raw = job?.steps ?? [];
  for (const step of raw) {
    assert.ok(!("continue-on-error" in step), `步骤 ${step.name ?? step.run} 设置了 continue-on-error`);
    assert.ok(!/\|\|\s*true\b/.test(step.run ?? ""), `步骤 ${step.name ?? step.run} 用 || true 吞掉了失败`);
  }
});

test("CI 配置里的环境值都是占位值：APP_ENV 是 ci，没有 Stripe 或谷歌地图的密钥", async () => {
  const text = await readText(".github/workflows/ci.yml");
  assert.equal(job?.env?.["APP_ENV"], "ci");
  assert.ok(!/sk_(live|test)_|pk_(live|test)_|whsec_|AIza[0-9A-Za-z_-]{20,}/.test(text));
});

test("根目录的脚本：pnpm check 包含集成测试；两类测试的文件名互不重叠", () => {
  const scripts = rootPackage.scripts ?? {};
  assert.match(scripts["check"] ?? "", /pnpm test:integration/);
  assert.match(scripts["check"] ?? "", /pnpm test\b(?!:)/);
  assert.match(scripts["test:integration"] ?? "", /\*\.itest\.ts/);
  assert.match(scripts["test"] ?? "", /\*\.test\.ts/);
  assert.ok(!(scripts["test"] ?? "").includes("itest"), "单元测试命令不应包含集成测试（它不需要数据库）");
});
