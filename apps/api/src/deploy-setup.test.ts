/**
 * 部署配置的静态检查（ADR 0007）：compose.yml、Dockerfile、部署相关的 workflow 和服务器脚本里
 * 那些「改错了不会立刻报错、但会出安全或可用性问题」的约定。只读仓库里的文件，不联网、不需要 Docker。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";

const ROOT = new URL("../../../", import.meta.url);

async function readText(path: string): Promise<string> {
  return readFile(new URL(path, ROOT), "utf8");
}

interface ComposeService {
  image?: string;
  restart?: string;
  ports?: string[];
  networks?: string[];
  healthcheck?: { test: string[] };
  environment?: Record<string, string>;
  volumes?: string[];
  cap_drop?: string[];
  read_only?: boolean;
  profiles?: string[];
}

interface ComposeFile {
  name?: string;
  services: Record<string, ComposeService>;
  networks?: Record<string, { internal?: boolean; name?: string; external?: unknown } | null>;
  volumes?: Record<string, { name?: string; external?: unknown } | null>;
}

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}

interface Job {
  if?: string;
  needs?: string | string[];
  environment?: string | { name: string };
  concurrency?: { group: string; "cancel-in-progress": boolean };
  permissions?: Record<string, string>;
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, Job>;
}

const compose = parse(await readText("deploy/compose.yml")) as ComposeFile;
const behindProxyCompose = parse(await readText("deploy/compose.behind-proxy.yml")) as ComposeFile;
const deployWorkflow = parse(await readText(".github/workflows/deploy.yml")) as Workflow;
const initWorkflow = parse(await readText(".github/workflows/server-init.yml")) as Workflow;
const ciWorkflow = parse(await readText(".github/workflows/ci.yml")) as Workflow;
const sshAction = parse(await readText(".github/actions/ssh-setup/action.yml")) as { runs: { steps: Step[] } };

/** 部署相关的全部步骤（两个 workflow + 公用的 SSH 步骤）。 */
const deploySteps: Step[] = [
  ...Object.values(deployWorkflow.jobs).flatMap((job) => job.steps),
  ...Object.values(initWorkflow.jobs).flatMap((job) => job.steps),
  ...sshAction.runs.steps,
];

/** 在真实服务器上执行的脚本，以及从流水线 / 开发机对服务器发起操作的脚本。 */
const PRODUCTION_SCRIPTS = [
  "deploy/bootstrap.sh",
  "deploy/bin/compose.sh",
  "deploy/bin/deploy.sh",
  "deploy/bin/backup.sh",
  "deploy/bin/restore.sh",
  "deploy/client/remote.sh",
  "deploy/client/push-local.sh",
];

const SERVER_SCRIPTS = [
  ...PRODUCTION_SCRIPTS,
  "deploy/ci/smoke.sh",
  "deploy/ci/bootstrap-check.sh",
  "deploy/ci/push-local-check.sh",
];

/** 去掉注释行，只留下会被执行的内容。 */
function codeOf(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

/** workflow 里某个 job 的全部脚本。 */
function runsOf(job: Job | undefined): string {
  return (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
}

test("compose：三个服务都自动重启、都有健康检查", () => {
  // migrate 不是常驻服务（带 profile，只在部署 / 恢复时临时运行一次），所以不自动重启、没有健康检查
  const longRunning = Object.entries(compose.services).filter(([, service]) => service.profiles === undefined);
  assert.deepEqual(longRunning.map(([name]) => name).sort(), ["api", "caddy", "db"]);
  for (const [name, service] of longRunning) {
    assert.equal(service.restart, "unless-stopped", `${name} 没有设置自动重启`);
    assert.ok((service.healthcheck?.test.length ?? 0) > 1, `${name} 没有健康检查`);
  }
  assert.deepEqual(Object.keys(compose.services).sort(), ["api", "caddy", "db", "migrate"]);
  assert.equal(compose.services["migrate"]?.restart, "no");
});

test("compose：数据库和 API 不映射任何端口到主机，只有反向代理对外开 80 和 443", () => {
  assert.equal(compose.services["db"]?.ports, undefined);
  assert.equal(compose.services["api"]?.ports, undefined);
  assert.deepEqual(compose.services["caddy"]?.ports, ["80:80", "443:443"]);
});

test("compose：数据库只在没有外网出口的内部网络里，反向代理碰不到数据库", () => {
  assert.deepEqual(compose.services["db"]?.networks, ["backend"]);
  assert.equal(compose.networks?.["backend"]?.internal, true);
  assert.ok(!compose.services["caddy"]?.networks?.includes("backend"));
  assert.deepEqual([...(compose.services["api"]?.networks ?? [])].sort(), ["backend", "edge"]);
});

test("compose：数据库版本与本地开发、CI 一致；数据放在命名卷里", async () => {
  const local = parse(await readText("docker-compose.yml")) as ComposeFile;
  assert.equal(compose.services["db"]?.image, local.services["db"]?.image);
  assert.ok(compose.services["db"]?.volumes?.some((volume) => volume.startsWith("db-data:")));
});

test("compose：API 的密钥全部来自变量替换，文件里没有写死的值；API 文件系统只读、去掉全部特权", () => {
  const api = compose.services["api"];
  const environment = api?.environment ?? {};
  for (const key of [
    "AUTH_JWT_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "GOOGLE_MAPS_API_KEY",
  ]) {
    assert.match(environment[key] ?? "", /^\$\{[A-Z_]+:[-?].*\}$/, `${key} 必须整体来自变量`);
  }
  assert.match(environment["DATABASE_URL"] ?? "", /^postgres:\/\/nozomi_api:\$\{POSTGRES_APP_PASSWORD:\?[^}]*\}@db:5432\/nozomi$/);
  assert.match(compose.services["db"]?.environment?.["POSTGRES_PASSWORD"] ?? "", /^\$\{POSTGRES_PASSWORD:\?/);
  assert.equal(api?.image?.startsWith("${API_IMAGE:?"), true);
  // 反向代理用的是和 API 配对的前端镜像（Caddy + 前端静态文件），同样没有默认值、不写死
  assert.match(compose.services["caddy"]?.image ?? "", /^\$\{WEB_IMAGE:\?[^}]*\}$/);
  assert.equal(api?.read_only, true);
  assert.deepEqual(api?.cap_drop, ["ALL"]);
});

test("compose：迁移账号的密码只给数据库容器和临时的 migrate 服务；api 容器的环境里没有它，也没有迁移用的连接串（ADR 0010）", () => {
  const apiEnvironment = compose.services["api"]?.environment ?? {};
  assert.ok(!("DATABASE_MIGRATION_URL" in apiEnvironment));
  for (const [key, value] of Object.entries(apiEnvironment)) {
    assert.ok(!/\$\{POSTGRES_PASSWORD\b/.test(value), `api 的 ${key} 用到了迁移账号的密码`);
  }

  const migrate = compose.services["migrate"];
  assert.ok(migrate, "缺少 migrate 服务");
  assert.deepEqual(migrate.profiles, ["tools"], "migrate 必须带 profile：`up` 不启动它，只在部署 / 恢复时临时运行");
  assert.equal(migrate.image, "${API_IMAGE}");
  assert.deepEqual(Object.keys(migrate.environment ?? {}).sort(), ["DATABASE_MIGRATION_URL", "DATABASE_URL"], "migrate 不需要登录签名密钥和第三方密钥");
  assert.equal(migrate.environment?.["DATABASE_MIGRATION_URL"], "postgres://nozomi:${POSTGRES_PASSWORD}@db:5432/nozomi");
  // 建应用账号时用的账号名和密码必须和 api 实际连接用的一致
  assert.equal(
    migrate.environment?.["DATABASE_URL"],
    (apiEnvironment["DATABASE_URL"] ?? "").replace(/\$\{POSTGRES_APP_PASSWORD:\?[^}]*\}/, "${POSTGRES_APP_PASSWORD}"),
  );
  assert.deepEqual(migrate.networks, ["backend"]);
  assert.equal(migrate.read_only, true);
  assert.deepEqual(migrate.cap_drop, ["ALL"]);
  assert.ok(!("ports" in migrate));
});

test("初始化脚本生成两个不同用途的数据库密码；部署、恢复脚本的数据库管理任务都走 migrate 服务；备份用迁移账号", async () => {
  const bootstrap = await readText("deploy/bootstrap.sh");
  assert.match(bootstrap, /^\s*ensure_generated_secret "\$file" POSTGRES_PASSWORD 24$/m);
  assert.match(bootstrap, /^\s*ensure_generated_secret "\$file" POSTGRES_APP_PASSWORD 24$/m);
  for (const script of ["deploy/bin/deploy.sh", "deploy/bin/restore.sh"]) {
    const text = await readText(script);
    const tasks = [...text.matchAll(/run --rm --no-deps -T (\S+) node (\S+)/g)].map((match) => `${match[1]} ${match[2]}`);
    // 部署时在建账号之前多一步：在同一个临时容器里确认按服务名解析得到数据库（只解析，不连接）
    const expected = ["migrate apps/api/src/db/provision-cli.ts", "migrate apps/api/src/db/migrate-cli.ts"];
    assert.deepEqual(tasks, script === "deploy/bin/deploy.sh" ? ["migrate -e", ...expected] : expected, script);
  }
  const backup = await readText("deploy/bin/backup.sh");
  assert.match(backup, /exec -T db pg_dump -U nozomi -d nozomi /);
  const restore = await readText("deploy/bin/restore.sh");
  assert.match(restore, /pg_restore -U nozomi -d nozomi --no-owner --exit-on-error/);
  assert.ok(!/--no-acl|--no-privileges|\s-x\s/.test(restore), "恢复时不能丢掉授权：权限角色对各表的权限记在备份里");
});

test("CI 用的覆盖文件只改反向代理的证书方式和端口，不改别的服务", async () => {
  const override = parse(await readText("deploy/ci/compose.ci.yml")) as ComposeFile;
  assert.deepEqual(Object.keys(override.services), ["caddy"]);
  assert.deepEqual(Object.keys(override.services["caddy"] ?? {}).sort(), ["environment", "ports"]);
  assert.deepEqual(override.services["caddy"]?.environment, { CADDY_TLS_MODE: "internal" });
  for (const port of override.services["caddy"]?.ports ?? []) assert.match(port, /^127\.0\.0\.1:/);
});

test("镜像：以非 root 用户运行；.dockerignore 是白名单，.env 和测试文件进不了镜像", async () => {
  const dockerfile = await readText("apps/api/Dockerfile");
  const users = [...dockerfile.matchAll(/^USER\s+(\S+)$/gm)].map((match) => match[1]);
  assert.equal(users.at(-1), "node");
  assert.ok(!/^\s*(ENV|ARG)\s+\S*(SECRET|PASSWORD|KEY|TOKEN)/im.test(dockerfile), "Dockerfile 里不应出现密钥类变量");

  const ignore = (await readText(".dockerignore")).split("\n").filter((line) => line && !line.startsWith("#"));
  assert.equal(ignore[0], "*", ".dockerignore 第一条规则必须是排除全部");
  for (const rule of ["**/.env", "**/.env.*", "**/*.test.ts", "**/*.itest.ts", "**/node_modules"]) {
    assert.ok(ignore.includes(rule), `.dockerignore 缺少 ${rule}`);
  }
  const allowed = ignore.filter((line) => line.startsWith("!"));
  assert.deepEqual(allowed.sort(), ["!apps/", "!apps/api/", "!package.json", "!packages/", "!pnpm-lock.yaml", "!pnpm-workspace.yaml"]);
});

test("Caddyfile：安全响应头齐全，访问日志去掉查询串和来源页", async () => {
  const caddyfile = await readText("deploy/Caddyfile");
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]) {
    assert.ok(caddyfile.includes(header), `缺少响应头 ${header}`);
  }
  assert.match(caddyfile, /request>uri regexp "\\\?\.\*" ""/);
  assert.match(caddyfile, /request>headers>Referer delete/);
});

test("部署 workflow：只在 main 的 CI 成功后自动触发，或手动触发；没有 push / pull_request 触发", () => {
  assert.deepEqual(Object.keys(deployWorkflow.on).sort(), ["workflow_dispatch", "workflow_run"]);
  const trigger = deployWorkflow.on["workflow_run"] as { workflows: string[]; types: string[]; branches: string[] };
  assert.deepEqual(trigger.workflows, ["CI"]);
  assert.deepEqual(trigger.types, ["completed"]);
  assert.deepEqual(trigger.branches, ["main"]);
  const condition = deployWorkflow.jobs["plan"]?.if ?? "";
  for (const required of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    "github.event.workflow_run.head_repository.full_name == github.repository",
  ]) {
    assert.ok(condition.includes(required), `自动触发的条件缺少：${required}`);
  }
});

test("部署 workflow：自动触发只会部署 staging；production 只能来自手动触发的输入，且只能从 main、CI 通过后部署", () => {
  const plan = deployWorkflow.jobs["plan"]?.steps[0]?.run ?? "";
  const automatic = plan.slice(plan.indexOf("else"));
  assert.match(automatic, /environment=staging/);
  assert.ok(!automatic.includes("production"));
  const manual = plan.slice(0, plan.indexOf("else"));
  assert.match(manual, /environment="\$INPUT_ENVIRONMENT"/);
  assert.match(manual, /"\$DISPATCH_REF" != "refs\/heads\/main"/);
  assert.match(manual, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$sha&event=push&status=success/);
  const dispatch = deployWorkflow.on["workflow_dispatch"] as { inputs: { environment: { options: string[] } } };
  assert.deepEqual(dispatch.inputs.environment.options, ["staging", "production"]);
});

test("部署 workflow：权限最小——默认只读；只有构建能写镜像仓库；部署只能读", () => {
  assert.deepEqual(deployWorkflow.permissions, { contents: "read" });
  assert.deepEqual(deployWorkflow.jobs["build"]?.permissions, { contents: "read", packages: "write" });
  assert.deepEqual(deployWorkflow.jobs["deploy"]?.permissions, { contents: "read", packages: "read" });
  assert.deepEqual(initWorkflow.permissions, { contents: "read" });
});

test("部署 workflow：同一环境的部署和初始化串行，不中途取消", () => {
  const deploy = deployWorkflow.jobs["deploy"];
  assert.equal(deploy?.concurrency?.group, "deploy-${{ needs.plan.outputs.environment }}");
  assert.equal(deploy?.concurrency?.["cancel-in-progress"], false);
  assert.equal(initWorkflow.concurrency?.group, "deploy-${{ inputs.environment }}");
  assert.equal(initWorkflow.concurrency?.["cancel-in-progress"], false);
  assert.deepEqual(deploy?.environment, {
    name: "${{ needs.plan.outputs.environment }}",
    url: "${{ steps.verify.outputs.url }}",
  });
});

test("部署 workflow：staging 的服务器信息没填时给出警告并跳过构建和部署，而不是失败，也不是悄悄成功", () => {
  const preflight = deployWorkflow.jobs["preflight"];
  assert.equal(preflight?.environment, "staging");
  assert.match(preflight?.if ?? "", /needs\.plan\.outputs\.environment == 'staging'/);
  const check = preflight?.steps[0];
  for (const secret of ["VPS_HOST", "VPS_SSH_PORT", "VPS_SSH_USER", "VPS_SSH_PRIVATE_KEY", "VPS_SSH_KNOWN_HOSTS"]) {
    assert.ok(Object.values(check?.env ?? {}).includes(`\${{ secrets.${secret} != '' }}`), `没有检查 ${secret}`);
  }
  assert.ok(Object.values(check?.env ?? {}).includes("${{ vars.APP_DOMAIN != '' }}"));
  assert.match(check?.run ?? "", /::warning title=测试环境没有部署::/);
  assert.match(check?.run ?? "", /GITHUB_STEP_SUMMARY/);
  assert.ok(!/exit 1/.test(check?.run ?? ""), "缺配置时不应让流水线失败");

  const build = deployWorkflow.jobs["build"];
  assert.match(build?.if ?? "", /needs\.plan\.outputs\.environment == 'production' \|\| needs\.preflight\.outputs\.configured == 'true'/);
  assert.match(deployWorkflow.jobs["deploy"]?.if ?? "", /needs\.build\.result == 'success'/);
});

test("部署 workflow：只用 GitHub 官方 action 和仓库内的 action，且固定到主版本；SSH 不用第三方 action", () => {
  const workflows = [deployWorkflow, initWorkflow, ciWorkflow];
  const uses = [
    ...workflows.flatMap((workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps)),
    ...sshAction.runs.steps,
  ]
    .map((step) => step.uses)
    .filter((value): value is string => value !== undefined);
  assert.ok(uses.length > 0);
  for (const action of uses) {
    assert.match(action, /^(\.\/\.github\/actions\/[a-z-]+|(actions|pnpm)\/[a-z-]+@v\d+)$/, `不允许的 action：${action}`);
  }
  const deployUses = deploySteps.map((step) => step.uses).filter((value): value is string => value !== undefined);
  for (const action of deployUses) assert.match(action, /^(\.\/\.github\/actions\/ssh-setup|actions\/checkout@v\d+)$/);
});

test("SSH：严格校验主机身份，没有任何地方关闭或放宽校验；私钥文件权限 600，job 结束时删除", () => {
  const setup = sshAction.runs.steps[0]?.run ?? "";
  assert.match(setup, /StrictHostKeyChecking yes/);
  assert.match(setup, /UserKnownHostsFile \$dir\/known_hosts/);
  assert.match(setup, /BatchMode yes/);
  assert.match(setup, /umask 077/);
  assert.match(setup, /chmod 600 "\$dir\/key"/);
  const allRuns = deploySteps.map((step) => step.run ?? "").join("\n");
  assert.ok(!/StrictHostKeyChecking[= ](no|accept-new|off)/i.test(allRuns));
  assert.ok(!/UserKnownHostsFile[= ]\/dev\/null/.test(allRuns));
  assert.ok(!allRuns.includes("ssh-keyscan"), "不能在部署时现取主机密钥（那等于不校验）");

  for (const [name, job] of [
    ["deploy", deployWorkflow.jobs["deploy"]],
    ["init", initWorkflow.jobs["init"]],
  ] as const) {
    const cleanup = job?.steps.at(-1);
    assert.equal(cleanup?.if, "always()", `${name} 的最后一步必须无条件执行清理`);
    assert.match(cleanup?.run ?? "", /rm -rf "\$RUNNER_TEMP\/nozomi-ssh"/);
  }
});

test("密钥不进脚本文本：run 里没有任何 ${{ }} 表达式（全部经 env 传入），没有 set -x，没有打印密钥变量", () => {
  for (const step of deploySteps) {
    const run = step.run ?? "";
    const label = step.name ?? step.id ?? "";
    assert.ok(!run.includes("${{"), `步骤「${label}」的脚本里直接写了表达式`);
    assert.ok(!/set\s+-[a-wyz]*x|set\s+-o\s+xtrace|bash\s+-x/.test(run), `步骤「${label}」开启了命令回显`);
    assert.ok(!/echo[^\n]*\$\{?(SSH_PRIVATE_KEY|REGISTRY_TOKEN|GH_TOKEN|SSH_KNOWN_HOSTS)\b/.test(run), `步骤「${label}」打印了密钥变量`);
  }
});

test("镜像仓库令牌：runner 和服务器上都只经标准输入传给 docker login，用完登出", async () => {
  const build = deployWorkflow.jobs["build"]?.steps ?? [];
  const buildRun = build.map((step) => step.run ?? "").join("\n");
  assert.match(buildRun, /printf '%s' "\$REGISTRY_TOKEN" \| docker login "\$REGISTRY" --username "\$REGISTRY_USER" --password-stdin/);
  assert.ok(!/docker login[^\n]*(--password|-p)\s+[^-]/.test(buildRun.replace("--password-stdin", "")));
  assert.equal(build.at(-1)?.if, "always()");
  assert.match(build.at(-1)?.run ?? "", /docker logout/);

  const deploy = deployWorkflow.jobs["deploy"]?.steps ?? [];
  const remote = deploy.find((step) => (step.run ?? "").includes("remote.sh deploy"))?.run ?? "";
  // 令牌从流水线的标准输入进 remote.sh，再由它里面的 ssh 原样接到服务器上 deploy.sh 的标准输入
  assert.match(remote, /printf '%s' "\$REGISTRY_TOKEN" \| REGISTRY_HOST="\$REGISTRY" deploy\/client\/remote\.sh deploy /);
  assert.ok(!/REGISTRY_TOKEN='?\$REGISTRY_TOKEN/.test(remote), "令牌不能拼进远程命令行");
  assert.match(deploy.at(-1)?.run ?? "", /docker logout/);

  const client = await readText("deploy/client/remote.sh");
  assert.ok(!/REGISTRY_TOKEN|GH_TOKEN|PASSWORD/.test(codeOf(client)), "remote.sh 不应接触任何令牌或密码变量");
  const remoteDeploy = client.slice(client.indexOf("cmd_deploy() {"), client.indexOf("cmd_rollback() {"));
  assert.ok(!/<(?=["$/<&])|\bcat\b|\bread\b/.test(codeOf(remoteDeploy)), "remote.sh deploy 不能读取或改接标准输入：令牌要原样到达服务器");
  assert.match(remoteDeploy, /REGISTRY_HOST=\$\(quoted "\$\{REGISTRY_HOST:-\}"\) REGISTRY_USER=\$\(quoted "\$\{REGISTRY_USER:-\}"\)/);
});

test("上传到服务器的文件（流水线和手工部署共用的 remote.sh），和 CI 冒烟装进版本目录的文件是同一组", async () => {
  const pattern = /tar -C \S*deploy(?:_dir)?"? -cf - ([\w. -]+?) \|/;
  const upload = (await readText("deploy/client/remote.sh")).match(pattern)?.[1];
  const smoke = (await readText("deploy/ci/smoke.sh")).match(pattern)?.[1];
  assert.equal(upload, "compose.yml compose.behind-proxy.yml Caddyfile bin");
  assert.equal(smoke, upload);
  const shipped = (await readdir(new URL("deploy/bin/", ROOT))).sort();
  assert.deepEqual(shipped, ["backup.sh", "compose.sh", "deploy.sh", "restore.sh"]);
  // deploy/ 下除了上传的这几样，只有不上服务器的东西：初始化脚本（经标准输入执行）、CI 脚本、发起端脚本
  const top = (await readdir(new URL("deploy/", ROOT))).sort();
  assert.deepEqual(top, ["Caddyfile", "bin", "bootstrap.sh", "ci", "client", "compose.behind-proxy.yml", "compose.yml"]);
  // 流水线自己不再直接 tar / 直接调用服务器上的脚本，全部经 remote.sh
  const workflowRuns = deploySteps.map((step) => step.run ?? "").join("\n");
  assert.ok(!/\btar\b|bootstrap\.sh|bin\/deploy\.sh/.test(workflowRuns), "流水线应只通过 deploy/client/remote.sh 操作服务器");
});

test("部署失败时 job 失败：没有 continue-on-error，退出码原样传出", async () => {
  for (const step of deploySteps) assert.ok(!("continue-on-error" in step));
  const remote = deployWorkflow.jobs["deploy"]?.steps.find((step) => (step.run ?? "").includes("remote.sh deploy"))?.run ?? "";
  assert.match(remote, /remote\.sh deploy "\$APP_ENV" "\$SHA" "\$IMAGE" \|\|\s+status=\$\?/);
  assert.match(remote, /exit "\$status"/);
  const verify = deployWorkflow.jobs["deploy"]?.steps.find((step) => step.id === "verify")?.run ?? "";
  assert.match(verify, /remote\.sh rollback "\$APP_ENV"/);
  assert.match(verify, /exit 1\s*$/);
  // remote.sh 把服务器上 deploy.sh 的退出码原样传回：deploy 那一段的最后一条命令就是 ssh，没有任何吞掉退出码的写法
  const client = await readText("deploy/client/remote.sh");
  const remoteDeploy = codeOf(client.slice(client.indexOf("cmd_deploy() {"), client.indexOf("cmd_rollback() {")));
  assert.match(remoteDeploy, /\n {2}remote "APP_ENV=[^\n]*bin\/deploy\.sh"\) deploy"\n\}\s*$/);
  assert.ok(!/\|\| true|\|\| :|set \+e/.test(remoteDeploy));
});

test("CI：每次都跑 shellcheck、部署冒烟和初始化脚本检查；冒烟用的是占位值和 APP_ENV=ci", async () => {
  const runs = (ciWorkflow.jobs["deploy-smoke"]?.steps ?? []).map((step) => step.run ?? "");
  assert.ok(runs.some((run) => /^shellcheck -x deploy\/bootstrap\.sh deploy\/bin\/\*\.sh deploy\/ci\/\*\.sh deploy\/client\/\*\.sh$/.test(run)));
  // 两种入口模式各跑一遍完整的冒烟
  assert.ok(runs.includes("deploy/ci/smoke.sh"));
  assert.ok(runs.includes("deploy/ci/smoke.sh behind-proxy"));
  assert.ok(runs.includes("deploy/ci/bootstrap-check.sh"));
  assert.ok(runs.includes("deploy/ci/push-local-check.sh"));
  for (const step of ciWorkflow.jobs["deploy-smoke"]?.steps ?? []) assert.ok(!("continue-on-error" in step));

  const smoke = await readText("deploy/ci/smoke.sh");
  assert.match(smoke, /^export APP_ENV=ci$/m);
  const assigned = [...smoke.matchAll(/^(POSTGRES_PASSWORD|AUTH_JWT_SECRET)=(.*)$/gm)].map((match) => match[2] ?? "");
  assert.equal(assigned.length, 2);
  for (const value of assigned) assert.match(value, /^ci-placeholder-not-a-real-/);
  // 应用账号的密码不写在冒烟脚本里：故意留空，验证部署时会自动生成（早先初始化的服务器就是这种情况）
  assert.ok(!/^POSTGRES_APP_PASSWORD=/m.test(smoke));
  assert.match(smoke, /check_db_accounts "首次部署后"/);
  assert.match(smoke, /check_db_accounts "恢复后"/);
  assert.match(smoke, /恢复后：同一个管理员登录应返回 200/);
});

test("初始化脚本：先放行 SSH 再启用防火墙；不改 SSH 服务的登录设置；密钥只生成不打印", async () => {
  const script = await readText("deploy/bootstrap.sh");
  const firewall = script.slice(script.indexOf("configure_firewall() {"), script.indexOf("install_backup_cron() {"));
  const allowSsh = firewall.indexOf('ufw allow "$port/tcp"');
  const enable = firewall.indexOf("ufw --force enable");
  assert.ok(allowSsh >= 0 && enable > allowSsh, "必须先放行 SSH 端口再启用防火墙");
  assert.match(firewall, /没有启用防火墙/, "确定不了 SSH 端口时必须中止，而不是照常启用");
  for (const forbidden of ["sshd_config", "PermitRootLogin", "PasswordAuthentication", "systemctl restart ssh", "passwd -d"]) {
    const code = script.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    assert.ok(!code.includes(forbidden), `初始化脚本不应包含 ${forbidden}`);
  }
  assert.ok(!/(echo|printf|log)[^\n]*\$\{?value\b/.test(script.replace(/printf '%s=%s\\n' "\$key" "\$value" >>"\$file"/, "")), "生成的密钥不能打印");
  assert.match(script, /把 VPS_SSH_USER 的值改成 \$DEPLOY_USER/);
});

test("服务器脚本：都有 set -euo pipefail，没有命令回显，仓库里的文件带可执行权限的 shebang", async () => {
  for (const path of SERVER_SCRIPTS) {
    const script = await readText(path);
    assert.match(script, /^#!\/usr\/bin\/env bash\n/, `${path} 缺少 shebang`);
    assert.match(script, /^set -E?euo pipefail$/m, `${path} 缺少 set -euo pipefail`);
    assert.ok(!/^\s*set\s+-[a-wyz]*x/m.test(script), `${path} 开启了命令回显`);
  }
});

/** 文档和脚本里允许出现的真实主机名：本项目用到的公开服务（镜像仓库、软件源、第三方平台的网址）。 */
const ALLOWED_HOSTNAME =
  /^((.*\.)?example\.(com|net|org)|ghcr\.io|quay\.io|download\.docker\.com|containerd\.io|(.*\.)?github\.com|stripe\.com|console\.cloud\.google\.com|claude\.ai|open\.er-api\.com|(tile|www)\.openstreetmap\.org)$/;

test("部署相关的文件和文档里没有密钥原文，也没有写死的服务器 IP 和真实域名", async () => {
  const files = [
    ...SERVER_SCRIPTS,
    "deploy/compose.yml",
    "deploy/compose.behind-proxy.yml",
    "deploy/ci/compose.ci.yml",
    "deploy/Caddyfile",
    "apps/api/Dockerfile",
    "apps/web/Dockerfile",
    "apps/web/Dockerfile.dockerignore",
    ".github/workflows/deploy.yml",
    ".github/workflows/server-init.yml",
    ".github/workflows/ci.yml",
    ".github/actions/ssh-setup/action.yml",
    "docs/deploy.md",
    "docs/secrets.md",
    "docs/adr/0007-vps-deployment.md",
  ];
  /** 回环网段、通配地址，以及文档示例专用网段（RFC 5737）。 */
  const allowedAddress = /^(127\.\d+\.\d+\.\d+|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
  for (const path of files) {
    const text = await readText(path);
    assert.ok(!/sk_(live|test)_[0-9A-Za-z]{8,}|pk_(live|test)_[0-9A-Za-z]{8,}|whsec_[0-9A-Za-z]{8,}|AIza[0-9A-Za-z_-]{20,}/.test(text), `${path} 里有像密钥的内容`);
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `${path} 里有私钥`);
    assert.ok(!/ssh-(ed25519|rsa) AAAA[0-9A-Za-z+/]{20,}/.test(text), `${path} 里有公钥原文`);
    for (const match of text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)) {
      assert.match(match[0], allowedAddress, `${path} 里有写死的 IP：${match[0]}`);
    }
    // 域名只能是示例专用的（RFC 2606 / 6761）、本项目用到的公开服务，或文件名、代码里的属性名
    for (const match of text.matchAll(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:io|com|net|org|cn|jp|dev|app|co)\b/g)) {
      assert.match(match[0], ALLOWED_HOSTNAME, `${path} 里有不是示例的域名：${match[0]}`);
    }
  }
});

test("入口模式：behind-proxy 的 compose 文件只改反向代理对主机发布的端口——只发布回环地址上的一个端口，不占 80/443", async () => {
  assert.deepEqual(Object.keys(behindProxyCompose), ["services"]);
  assert.deepEqual(Object.keys(behindProxyCompose.services), ["caddy"]);
  assert.deepEqual(Object.keys(behindProxyCompose.services["caddy"] ?? {}), ["ports"]);
  const ports = behindProxyCompose.services["caddy"]?.ports ?? [];
  assert.equal(ports.length, 1);
  assert.match(ports[0] ?? "", /^\$\{EDGE_LISTEN:\?[^}]*\}:8080$/, "主机一侧的地址必须整体来自 EDGE_LISTEN，没有默认值");
  // 必须是整体替换（!override）：compose 默认会把两个文件的端口列表合并，那样 80 和 443 仍会被占用
  assert.match(await readText("deploy/compose.behind-proxy.yml"), /^ {4}ports: !override$/m);

  const composeScript = await readText("deploy/bin/compose.sh");
  assert.match(composeScript, /edge_mode="\$\(sed -n 's\/\^EDGE_MODE=\/\/p' "\$release_env" \| tail -n 1\)"/);
  assert.match(composeScript, /if \[\[ "\$edge_mode" == "behind-proxy" \]\]; then\n {2}files\+=\(-f "\$release_dir\/compose\.behind-proxy\.yml"\)/);

  // EDGE_LISTEN 只接受 IPv4 回环地址；校验在服务器上的 deploy.sh 里（流水线和手工部署都会经过）
  const deployScript = await readText("deploy/bin/deploy.sh");
  assert.match(deployScript, /\[\[ "\$EDGE_LISTEN" =~ \^127\\\.\$octet\\\.\$octet\\\.\$octet:\(\[1-9\]\[0-9\]\{0,4\}\)\$ \]\]/);
});

test("入口模式：API 信任几层代理由模式推导（standalone 1、behind-proxy 2），不是任何人手填的变量", async () => {
  assert.match(compose.services["api"]?.environment?.["TRUST_PROXY_HOPS"] ?? "", /^\$\{TRUST_PROXY_HOPS:\?[^}]*\}$/);
  const deployScript = await readText("deploy/bin/deploy.sh");
  const writer = deployScript.slice(deployScript.indexOf("write_release_env() {"), deployScript.indexOf("registry_logout() {"));
  assert.match(writer, /local tls_mode=auto site_address="\$APP_DOMAIN" proxy_hops=1\n/);
  assert.match(writer, /if \[\[ "\$EDGE_MODE" == "behind-proxy" \]\]; then\n {4}tls_mode=off\n {4}site_address="http:\/\/:\$EDGE_CONTAINER_PORT"\n {4}proxy_hops=2\n {2}fi/);
  assert.match(writer, /^TRUST_PROXY_HOPS=\$proxy_hops$/m);
  assert.match(deployScript, /^EDGE_CONTAINER_PORT=8080$/m);
  // 调用方（流水线、手工部署、remote.sh）都不传这一项；负责人要填的变量表里也没有它
  for (const path of [".github/workflows/deploy.yml", ".github/workflows/server-init.yml", "deploy/client/remote.sh", "deploy/client/push-local.sh", "docs/secrets.md"]) {
    assert.ok(!(await readText(path)).includes("TRUST_PROXY_HOPS"), `${path} 不应出现 TRUST_PROXY_HOPS`);
  }
  assert.ok(!/\$\{?TRUST_PROXY_HOPS/.test(deployScript), "deploy.sh 不应从环境里读 TRUST_PROXY_HOPS");
});

test("Caddyfile：只有 behind-proxy 才信任上一跳带来的 X-Forwarded-For，而且只信回环 / 私有网段；该模式不监听 80/443、不用证书", async () => {
  const caddyfile = await readText("deploy/Caddyfile");
  assert.match(caddyfile, /^\(trust_standalone\) \{\n\}$/m, "standalone 不能信任任何上一跳");
  assert.match(caddyfile, /^\(trust_behind-proxy\) \{\n\ttrusted_proxies static private_ranges\n\ttrusted_proxies_strict\n\}$/m);
  assert.equal(caddyfile.match(/trusted_proxies /g)?.length, 1, "trusted_proxies 只能出现在 behind-proxy 那一段");
  assert.ok(!/0\.0\.0\.0\/0|::\/0/.test(caddyfile));
  assert.match(caddyfile, /^\t\timport trust_\{\$EDGE_MODE\}$/m);
  assert.match(caddyfile, /^\{\$CADDY_SITE_ADDRESS\} \{$/m);
  assert.match(caddyfile, /^\(tls_off\) \{\n\}$/m);
  const caddyEnvironment = compose.services["caddy"]?.environment ?? {};
  assert.deepEqual(Object.keys(caddyEnvironment).sort(), ["ACME_EMAIL", "CADDY_SITE_ADDRESS", "CADDY_TLS_MODE", "EDGE_MODE", "MAP_TILE_CSP_SOURCES"]);
  for (const key of ["CADDY_SITE_ADDRESS", "CADDY_TLS_MODE", "EDGE_MODE"]) {
    assert.match(caddyEnvironment[key] ?? "", /^\$\{[A-Z_]+:\?[^}]*\}$/, `${key} 必须由 deploy.sh 写入，没有默认值`);
  }
});

test("与同一台机器上别的 Compose 项目隔离：项目名明确且带环境名，所有 compose 调用都经 compose.sh；名字、网络、数据卷都不和别人共用", async () => {
  const composeScript = await readText("deploy/bin/compose.sh");
  assert.match(composeScript, /^exec docker compose \\\n {2}--project-name "nozomi-\$app_env" \\$/m);
  assert.match(await readText("deploy/bin/deploy.sh"), /\[\[ "\$\{APP_ENV:-\}" =~ \^\(staging\|production\|ci\)\$ \]\]/, "环境名只有固定的几个，项目名不会是目录名 deploy");
  for (const path of PRODUCTION_SCRIPTS.filter((name) => name !== "deploy/bin/compose.sh")) {
    // 初始化脚本查询 Compose 的版本（docker compose version）不算
    assert.ok(!/docker compose(?! version)|docker-compose(?!-plugin)/.test(codeOf(await readText(path))), `${path} 不应绕过 compose.sh 直接调用 docker compose`);
  }

  for (const [path, file] of [
    ["deploy/compose.yml", compose],
    ["deploy/compose.behind-proxy.yml", behindProxyCompose],
    ["deploy/ci/compose.ci.yml", parse(await readText("deploy/ci/compose.ci.yml")) as ComposeFile],
  ] as const) {
    assert.equal(file.name, undefined, `${path} 不应自己指定项目名`);
    const text = codeOf(await readText(path));
    for (const forbidden of ["container_name", "network_mode", "external", "volumes_from", "extra_hosts", "docker.sock", "privileged", "pid:", "ipc:", "host.docker.internal", "3306"]) {
      assert.ok(!text.includes(forbidden), `${path} 不应出现 ${forbidden}`);
    }
    for (const [name, definition] of Object.entries({ ...file.networks, ...file.volumes })) {
      assert.equal(definition?.name, undefined, `${path} 的 ${name} 不应另起名字（名字要带项目名前缀）`);
    }
  }
  assert.deepEqual(Object.keys(compose.networks ?? {}).sort(), ["backend", "edge"]);
  assert.deepEqual(Object.keys(compose.volumes ?? {}).sort(), ["caddy-config", "caddy-data", "db-data"]);
  // 挂进容器的只有本项目自己的命名卷，和版本目录里的 Caddyfile
  const mounts = Object.values(compose.services).flatMap((service) => service.volumes ?? []);
  assert.deepEqual(mounts.sort(), ["./Caddyfile:/etc/caddy/Caddyfile:ro,z", "caddy-config:/config", "caddy-data:/data", "db-data:/var/lib/postgresql/data"]);
  // 数据库不发布任何主机端口（两种模式都是）
  for (const file of [compose, behindProxyCompose]) {
    for (const [name, service] of Object.entries(file.services)) {
      if (name !== "caddy") assert.equal(service.ports, undefined, `${name} 不应发布端口`);
    }
  }
});

test("与别的项目隔离：任何脚本和流水线里都没有会波及全机的 docker 命令；清理旧镜像只在本项目的镜像仓库名下按标签删", async () => {
  const everywhere = [
    ...SERVER_SCRIPTS,
    ".github/workflows/deploy.yml",
    ".github/workflows/server-init.yml",
    ".github/workflows/ci.yml",
    ".github/actions/ssh-setup/action.yml",
  ];
  const machineWide = [
    /\bprune\b/,
    /docker\s+(ps|container\s+ls)[^\n|]*\|\s*xargs/,
    /docker\s+(rm|stop|kill|restart|rmi)\b[^\n]*\$\(\s*docker\s+(ps|images|container|image)\b/,
    /docker\s+(images|image\s+ls)\s+(-a\s+)?-q\b/,
    /systemctl\s+(restart|stop|reload|disable)\s+(docker|containerd)/,
  ];
  /** 真实服务器上运行的脚本和流水线还不能碰 Docker 的配置和内核的包过滤规则（CI 脚本里只有「检查它们没被动过」）。 */
  const hostWide = [/daemon\.json/, /\biptables\b|\bnft\b/];
  for (const path of everywhere) {
    const code = codeOf(await readText(path));
    const patterns = path.startsWith("deploy/ci/") ? machineWide : [...machineWide, ...hostWide];
    for (const pattern of patterns) assert.ok(!pattern.test(code), `${path} 里有会波及别的项目的命令：${pattern}`);
  }
  // 真实服务器上运行的脚本：除了经 compose.sh 的调用，直接用到的 docker 子命令只有这几个
  const allowedDirect = new Set(["compose", "image", "login", "logout", "info", "save", "load", "build", "--version"]);
  for (const path of PRODUCTION_SCRIPTS) {
    const code = codeOf(await readText(path));
    for (const match of code.matchAll(/(?:^|[\s(|;&"])docker[ \t]+([a-z-]+)/gm)) {
      assert.ok(allowedDirect.has(match[1] ?? ""), `${path} 直接调用了 docker ${match[1]}`);
    }
    for (const match of code.matchAll(/docker\s+image\s+([a-z]+)/g)) {
      assert.ok(["ls", "rm", "inspect"].includes(match[1] ?? ""), `${path} 调用了 docker image ${match[1]}`);
    }
  }
  const deployScript = await readText("deploy/bin/deploy.sh");
  const cleanup = deployScript.slice(deployScript.indexOf("cleanup_old() {"), deployScript.indexOf("roll_back_to() {"));
  assert.match(cleanup, /for image in "\$\{API_IMAGE%:\*\}" "\$\{WEB_IMAGE%:\*\}"; do\n {4}docker image ls --format '\{\{\.Repository\}\}:\{\{\.Tag\}\}' "\$image" \|/);
  assert.equal(cleanup.match(/docker image ls/g)?.length, 1, "列镜像只有这一处，而且总是带着仓库名");
  assert.match(cleanup, /docker image rm "\$ref"/);
  assert.match(deployScript, /\[\[ "\$\{API_IMAGE%:\*\}" =~ \(\^\|\/\)nozomi-api\$ \]\]/, "只接受本项目自己的镜像名");
  // 前端镜像的名字不是调用方给的：校验过 API_IMAGE 之后由它推出，镜像名固定是 nozomi-web
  const validated = deployScript.indexOf('[[ "${API_IMAGE%:*}" =~ (^|/)nozomi-api$ ]]');
  const derived = deployScript.indexOf('WEB_IMAGE="$(web_image_for "$API_IMAGE")"');
  assert.ok(validated >= 0 && derived > validated && derived < deployScript.indexOf("check_layout\n"), "WEB_IMAGE 必须在校验 API_IMAGE 之后、动任何东西之前推出");
  assert.match(deployScript, /printf '%snozomi-web:%s' "\$\{repository%nozomi-api\}" "\$tag"/);
  assert.equal(deployScript.match(/\bWEB_IMAGE=/g)?.length, 2, "WEB_IMAGE 只在两处被赋值：从 API_IMAGE 推出、写进 release.env");
  assert.ok(!/\$\{WEB_IMAGE:-/.test(deployScript), "deploy.sh 不应从环境里读 WEB_IMAGE");
});

test("初始化脚本：支持 Ubuntu 和 RHEL 系；已有的 Docker 不重装不升级；不升级系统、不改 SELinux 模式、不改任何密码和 SSH 服务", async () => {
  const script = await readText("deploy/bootstrap.sh");
  // 「passwd」只允许以这两种无害的形式出现：查询账号信息（getent passwd）、提供 useradd 的软件包名
  const code = codeOf(script).replaceAll("getent passwd ", "getent-account ").replace("ensure_command useradd passwd shadow-utils", "");
  assert.match(script, /^SUPPORTED_UBUNTU=\("22\.04" "24\.04"\)$/m);
  assert.match(script, /^SUPPORTED_RHEL_IDS=\("centos" "rhel" "rocky" "almalinux"\)$/m);
  assert.match(script, /^SUPPORTED_RHEL_MAJOR=\("9" "10"\)$/m);

  const docker = script.slice(script.indexOf("\ninstall_docker() {"), script.indexOf("selinux_state() {"));
  // 已经有 docker 命令时：版本不够用就报错停下，够用就原样使用——两条路都不会走到安装
  assert.match(docker, /if command -v docker >\/dev\/null 2>&1; then\n[\s\S]*compose_version_ok "\$compose_version" \|\|\n\s+die "[^"]*不会重装或升级已有的 Docker/);
  assert.match(docker, /docker info >\/dev\/null 2>&1 && return 0\n {2}else\n {4}install_docker_from_official_repo\n {2}fi/);
  assert.match(script, /https:\/\/download\.docker\.com\/linux\/\$repo_os\/docker-ce\.repo/);
  assert.match(script, /https:\/\/download\.docker\.com\/linux\/ubuntu\/gpg/);

  for (const forbidden of [
    /\b(dnf|yum)\s+(-\S+\s+)*(upgrade|update|distro-sync|remove|erase|autoremove)\b/,
    /apt(-get)?\s+(-\S+\s+)*(upgrade|dist-upgrade|full-upgrade|remove|purge|autoremove)\b/,
    /--allowerasing|--nobest/,
    /\bsetenforce\b|\bsemanage\b|\bsetsebool\b|\/etc\/selinux|\bchcon\b/,
    /\bchpasswd\b|\bpasswd\s|usermod[^\n]*(-p|--password)\b|\/etc\/shadow/,
    /systemctl\s+(restart|reload|stop|disable|mask)\b/,
    /firewall-(offline-)?cmd[^\n]*--(remove|set-default-zone|panic|lockdown)|ufw\s+(delete|reset|disable|deny\s+\d)/,
  ]) {
    assert.ok(!forbidden.test(code), `初始化脚本不应包含 ${forbidden}`);
  }
  // 软件包只在命令缺失时安装
  assert.match(script, /command -v "\$command_name" >\/dev\/null 2>&1 && return 0/);
  // SELinux：只读取状态；只有 Enforcing 时才恢复自己新建文件的默认标签
  assert.match(script, /\[\[ "\$\(selinux_state\)" == "Enforcing" \]\] \|\| return 0\n[^\n]*\n {2}restorecon -R "\$@"/);
  assert.match(script, /Permissive \| Disabled\)\n\s+log "SELinux：\$\(selinux_state\)。不做任何改动"/);
  // 定时任务服务：两类系统各用各的名字，没在运行才启动
  assert.match(script, /ensure_command crond cron cronie/);
  assert.match(script, /systemctl enable --now "\$cron_service"/);
});

test("初始化脚本的防火墙开关：由入口模式推导（behind-proxy 不管、standalone 管），可用 MANAGE_FIREWALL 明确指定；不管时一条防火墙命令都不执行；RHEL 系同样先放行 SSH 再启用", async () => {
  const script = await readText("deploy/bootstrap.sh");
  assert.match(script, /if \[\[ "\$EDGE_MODE" == "behind-proxy" \]\]; then manage_firewall=0; else manage_firewall=1; fi/);
  assert.match(script, /manage_firewall="\$\{MANAGE_FIREWALL:-\}"\n {2}if \[\[ -z "\$manage_firewall" \]\]; then/);
  assert.match(script, /\[\[ "\$manage_firewall" =~ \^\[01\]\$ \]\] \|\| die/);

  const firewall = script.slice(script.indexOf("configure_firewall() {"), script.indexOf("install_backup_cron() {"));
  const firewallCommand = /\b(ufw|firewall-cmd|firewall-offline-cmd|firewalld)\b/;
  const optOut = firewall.indexOf('if [[ "$manage" != "1" ]]; then');
  const optOutEnd = firewall.indexOf("return 0", optOut);
  assert.ok(optOut >= 0 && optOutEnd > optOut);
  const before = codeOf(firewall.slice(0, optOutEnd)).replace(/log "[^"]*"/g, "");
  assert.ok(!firewallCommand.test(before), "「不管理」这条路在返回之前不能执行任何防火墙命令，也不能安装防火墙");
  const outside = codeOf(script.replace(firewall, "")).replace(/(log|die) "[^"]*"/g, "");
  assert.ok(!firewallCommand.test(outside), "防火墙命令只能出现在 configure_firewall 里");
  assert.match(firewall, /没有增删任何规则/);

  const allowPorts = firewall.indexOf('firewall-offline-cmd --add-port="$port/tcp"');
  const enable = firewall.indexOf("systemctl enable --now firewalld");
  const reload = firewall.indexOf("firewall-cmd --reload");
  assert.ok(allowPorts >= 0 && enable > allowPorts && reload > enable, "RHEL 系必须先把 SSH 端口写进规则，再启动 firewalld");
  assert.match(firewall, /for port in \$ports 80 443; do\n\s+firewall-offline-cmd/);

  // 流水线和手工部署把同样的两个变量传给初始化脚本
  const init = initWorkflow.jobs["init"]?.steps.find((step) => (step.run ?? "").includes("remote.sh init"));
  assert.equal(init?.env?.["EDGE_MODE"], "${{ vars.EDGE_MODE }}");
  assert.equal(init?.env?.["MANAGE_FIREWALL"], "${{ vars.MANAGE_FIREWALL }}");
  assert.match(await readText("deploy/client/remote.sh"), /remote "EDGE_MODE=\$\(quoted "\$\{EDGE_MODE:-\}"\) MANAGE_FIREWALL=\$\(quoted "\$\{MANAGE_FIREWALL:-\}"\) bash -s -- /);
});

test("流水线和手工部署是同一条路：都只通过 remote.sh 操作服务器，传给服务器的变量在 remote.sh 里一处拼装", async () => {
  const client = await readText("deploy/client/remote.sh");
  const pushLocal = await readText("deploy/client/push-local.sh");
  // 入口模式相关的变量：流水线来自 Environment variables，手工部署来自同名的环境变量
  const deployJob = deployWorkflow.jobs["deploy"] as (Job & { env?: Record<string, string> }) | undefined;
  assert.equal(deployJob?.env?.["EDGE_MODE"], "${{ vars.EDGE_MODE }}");
  assert.equal(deployJob?.env?.["EDGE_LISTEN"], "${{ vars.EDGE_LISTEN }}");
  assert.equal(deployJob?.env?.["APP_DOMAIN"], "${{ vars.APP_DOMAIN }}");
  for (const name of ["APP_ENV", "API_IMAGE", "APP_DOMAIN", "ACME_EMAIL", "EDGE_MODE", "EDGE_LISTEN", "DEPLOY_SKIP_PULL", "REGISTRY_HOST", "REGISTRY_USER"]) {
    assert.ok(client.includes(`${name}=$(quoted "`), `remote.sh deploy 没有把 ${name} 传给服务器`);
  }
  assert.ok(!/'\$[A-Z_]+'/.test(codeOf(client)), "传给服务器的值必须经过 quoted 转义，不能直接套单引号");

  const workflowRuns = runsOf(deployWorkflow.jobs["deploy"]) + runsOf(initWorkflow.jobs["init"]);
  for (const command of ["init", "upload", "deploy", "rollback", "public-health"]) {
    assert.ok(workflowRuns.includes(`deploy/client/remote.sh ${command} `), `流水线没有用到 remote.sh ${command}`);
    assert.ok(pushLocal.includes(`"$remote" ${command} `), `push-local.sh 没有用到 remote.sh ${command}`);
  }
  // 两条路径除了准备 SSH 连接时的连通性测试、流水线最后的登出，不再自己拼远程命令
  const pushLocalCode = codeOf(pushLocal);
  assert.deepEqual(pushLocalCode.match(/\bssh\s-[^\n]*/g), ['ssh -F "$ssh_dir/config" -o LogLevel=INFO vps true 2>&1)"; then']);
  assert.deepEqual(workflowRuns.match(/\bssh\s[^\n]*/g), [`ssh -F "$NOZOMI_SSH_DIR/config" vps "docker logout '$REGISTRY'" >/dev/null 2>&1 || true`]);
  // 手工部署：镜像不经过镜像仓库，服务器上不拉取
  assert.match(pushLocal, /"\$remote" load-image "\$image" "\$web_image"\n[\s\S]*DEPLOY_SKIP_PULL=1 "\$remote" deploy "\$app_env" "\$sha" "\$image" <\/dev\/null/);
  assert.match(client, /docker save "\$@" \| gzip -c \| remote "gzip -dc \| docker load"/);
  assert.match(pushLocal, /status --porcelain/, "手工部署必须是干净的工作区：版本号就是提交");
});

test("手工部署的 SSH：连接信息只从环境变量读、不打印；和流水线一样严格校验主机身份", async () => {
  const pushLocal = await readText("deploy/client/push-local.sh");
  for (const option of ["StrictHostKeyChecking yes", 'UserKnownHostsFile "$known_hosts_file"', "GlobalKnownHostsFile /dev/null", "IdentitiesOnly yes", "BatchMode yes"]) {
    assert.ok(pushLocal.includes(option), `push-local.sh 的 SSH 配置缺少 ${option}`);
  }
  for (const path of ["deploy/client/push-local.sh", "deploy/client/remote.sh", "deploy/ci/push-local-check.sh"]) {
    const code = codeOf(await readText(path));
    if (path !== "deploy/ci/push-local-check.sh") {
      assert.ok(!/StrictHostKeyChecking[= ](no|accept-new|off)/i.test(code), path);
      assert.ok(!/UserKnownHostsFile[= ]"?\/dev\/null/.test(code), path);
      assert.ok(!code.includes("ssh-keyscan"), `${path} 不能现取主机密钥（那等于不校验）`);
    }
    assert.ok(!/-o\s+StrictHostKeyChecking/.test(code), path);
  }
  const code = codeOf(pushLocal);
  for (const name of ["NOZOMI_SSH_HOST", "NOZOMI_SSH_USER", "NOZOMI_SSH_KEY_FILE", "NOZOMI_SSH_KNOWN_HOSTS_FILE", "NOZOMI_SSH_PORT"]) {
    assert.ok(pushLocal.includes(`\${${name}:-`), `push-local.sh 没有读取 ${name}`);
  }
  assert.ok(!/(log|die|echo|printf)[^\n]*\$\{?(host|key_file|known_hosts_file|NOZOMI_SSH_HOST)\b/.test(code), "不能打印服务器地址和密钥文件路径");
  assert.match(pushLocal, /rm -rf -- "\$ssh_dir"/, "临时的 SSH 配置要在结束时删除");
  // 私钥不复制：只在临时目录里放一个指向它的链接
  assert.match(pushLocal, /ln -s "\$key_file" "\$ssh_dir\/key"/);
  assert.ok(!/\bcp\b|cat "\$key_file"/.test(code));
});

test("入口模式 behind-proxy 的成败判定：服务器本机访问 EDGE_LISTEN 决定成败和回退；从外网访问不通只是警告", async () => {
  const deployScript = await readText("deploy/bin/deploy.sh");
  assert.match(deployScript, /activate\(\) \{\n {2}"\$1\/bin\/compose\.sh" up -d --wait --wait-timeout "\$HEALTH_TIMEOUT_SECONDS" --remove-orphans &&\n {4}check_edge "\$1"\n\}/);
  assert.match(deployScript, /"http:\/\/\$listen\/health"/);

  const verify = deployWorkflow.jobs["deploy"]?.steps.find((step) => step.id === "verify")?.run ?? "";
  const warning = verify.indexOf("::warning title=部署成功，但从外网还访问不到::");
  const leave = verify.indexOf("exit 0", warning);
  const rollback = verify.indexOf("remote.sh rollback");
  assert.ok(warning >= 0 && leave > warning && rollback > leave, "behind-proxy 必须在回退之前以警告结束");
  assert.match(verify.slice(0, leave), /if \[\[ "\$EDGE_MODE" == "behind-proxy" \]\]; then\n[^\n]*\n\s+echo "::warning /);
  assert.match(verify, /外层代理：它还没有把这个域名转发到 \$EDGE_LISTEN，或证书还没有配置/);
  // standalone 不变：外网不通是错误，并回退
  assert.match(verify.slice(leave), /::error title=外网访问不到新版本::[\s\S]*remote\.sh rollback "\$APP_ENV"[\s\S]*exit 1\s*$/);

  const check = deployWorkflow.jobs["deploy"]?.steps.find((step) => step.name === "检查这个环境的非密钥配置")?.run ?? "";
  assert.match(check, /case "\$\{EDGE_MODE:-standalone\}" in/);
  assert.match(check, /::error title=EDGE_LISTEN 没填或格式不对::/);
  assert.match(check, /::error title=EDGE_MODE 不对::/);
});

test("文档：给外层 nginx 的示例配置和 CI 冒烟里模拟外层代理用的转发头一致；ADR 和手册说明了共用机器的做法", async () => {
  const guide = await readText("docs/deploy.md");
  const smoke = await readText("deploy/ci/smoke.sh");
  for (const directive of ["proxy_set_header Host $host;", "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", "proxy_http_version 1.1;"]) {
    assert.ok(guide.includes(directive), `docs/deploy.md 的示例缺少 ${directive}`);
    assert.ok(smoke.replaceAll("\\$", "$").includes(directive), `冒烟里的外层代理缺少 ${directive}`);
  }
  assert.match(guide, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(guide, /proxy_pass http:\/\/127\.0\.0\.1:18080;/);
  assert.match(guide, /## .*服务器上已有别的网站时/);
  assert.ok(!guide.includes("add_header Strict-Transport-Security"), "HSTS 由 Caddy 加，示例里不要再加一遍");
  const adr = await readText("docs/adr/0007-vps-deployment.md");
  assert.match(adr, /## 补充.*与其他服务共用一台机器（behind-proxy 模式）/);
  for (const limit of ["docker 组", "证书", "重载"]) assert.ok(adr.includes(limit), `ADR 0007 的已知限制缺少：${limit}`);
  const secrets = await readText("docs/secrets.md");
  for (const name of ["`EDGE_MODE`", "`EDGE_LISTEN`"]) assert.ok(secrets.includes(name), `docs/secrets.md 的变量表缺少 ${name}`);
});

test("RHEL 系的内核模块预检：只检查不修改；缺模块时初始化报错停下，部署在建应用账号之前单独查出「容器里解析不了服务名」", async () => {
  const script = await readText("deploy/bootstrap.sh");
  assert.match(script, /^REQUIRED_KERNEL_MODULES=\("xt_nat" "nft_compat" "xt_addrtype"\)$/m);
  const check = script.slice(script.indexOf("kernel_module_available() {"), script.indexOf("# 安装软件包。"));
  assert.match(check, /\[\[ "\$OS_FAMILY" == "rhel" \]\] \|\| return 0/);
  assert.match(check, /dnf install kernel-modules-extra-\$release/);
  assert.match(check, /升级内核和 kernel-modules-extra 并重启服务器/);
  // 只检查：这一段里不安装、不加载、不升级任何东西（报错文字里给负责人看的命令不算）
  const executed = codeOf(check).replace(/(log|die) "[^"]*"/g, "");
  assert.ok(!/install_packages|ensure_command|\bdnf\b|\binsmod\b|\bgrubby\b|\breboot\b/.test(executed));
  assert.deepEqual(executed.match(/modprobe[^\n]*/g), ['modprobe --dry-run --quiet "$1" 2>/dev/null', "modprobe >/dev/null 2>&1; then"]);
  // 在安装任何软件、创建用户之前就检查
  const main = script.slice(script.indexOf("\nmain() {"));
  assert.ok(main.indexOf("check_kernel_modules") > main.indexOf("detect_os"));
  assert.ok(main.indexOf("check_kernel_modules") < main.indexOf("install_base_packages"));

  const deployScript = await readText("deploy/bin/deploy.sh");
  const probe = deployScript.indexOf('run --rm --no-deps -T migrate node -e "$DNS_PROBE"');
  assert.ok(probe > deployScript.indexOf("pre-deploy") && probe < deployScript.indexOf("provision-cli.ts"), "自检要在备份之后、建应用账号之前");
  assert.match(deployScript, /^DNS_PROBE='require\("node:dns"\)\.lookup\("db", \(err\) => process\.exit\(err \? 1 : 0\)\)'$/m);
  assert.match(deployScript.slice(probe, probe + 600), /die "\$EXIT_NOT_SWITCHED" "容器里解析不了数据库的服务名 db[^"]*kernel-modules-extra[^"]*升级内核并重启服务器/);
  assert.match(await readText("docs/deploy.md"), /kernel-modules-extra-\$\(uname -r\)/);
});
