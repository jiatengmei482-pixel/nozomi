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
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  networks?: Record<string, { internal?: boolean } | null>;
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

const SERVER_SCRIPTS = [
  "deploy/bootstrap.sh",
  "deploy/bin/compose.sh",
  "deploy/bin/deploy.sh",
  "deploy/bin/backup.sh",
  "deploy/bin/restore.sh",
  "deploy/ci/smoke.sh",
  "deploy/ci/bootstrap-check.sh",
];

test("compose：三个服务都自动重启、都有健康检查", () => {
  assert.deepEqual(Object.keys(compose.services).sort(), ["api", "caddy", "db"]);
  for (const [name, service] of Object.entries(compose.services)) {
    assert.equal(service.restart, "unless-stopped", `${name} 没有设置自动重启`);
    assert.ok((service.healthcheck?.test.length ?? 0) > 1, `${name} 没有健康检查`);
  }
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
  assert.match(environment["DATABASE_URL"] ?? "", /^postgres:\/\/nozomi:\$\{POSTGRES_PASSWORD\}@db:5432\/nozomi$/);
  assert.match(compose.services["db"]?.environment?.["POSTGRES_PASSWORD"] ?? "", /^\$\{POSTGRES_PASSWORD:\?/);
  assert.equal(api?.image?.startsWith("${API_IMAGE:?"), true);
  assert.equal(api?.read_only, true);
  assert.deepEqual(api?.cap_drop, ["ALL"]);
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

test("镜像仓库令牌：runner 和服务器上都只经标准输入传给 docker login，用完登出", () => {
  const build = deployWorkflow.jobs["build"]?.steps ?? [];
  const buildRun = build.map((step) => step.run ?? "").join("\n");
  assert.match(buildRun, /printf '%s' "\$REGISTRY_TOKEN" \| docker login "\$REGISTRY" --username "\$REGISTRY_USER" --password-stdin/);
  assert.ok(!/docker login[^\n]*(--password|-p)\s+[^-]/.test(buildRun.replace("--password-stdin", "")));
  assert.equal(build.at(-1)?.if, "always()");
  assert.match(build.at(-1)?.run ?? "", /docker logout/);

  const deploy = deployWorkflow.jobs["deploy"]?.steps ?? [];
  const remote = deploy.find((step) => (step.run ?? "").includes("deploy.sh' deploy"))?.run ?? "";
  assert.match(remote, /printf '%s' "\$REGISTRY_TOKEN" \| ssh /);
  assert.ok(!/REGISTRY_TOKEN='?\$REGISTRY_TOKEN/.test(remote), "令牌不能拼进远程命令行");
  assert.match(deploy.at(-1)?.run ?? "", /docker logout/);
});

test("部署 workflow 上传到服务器的文件，和 CI 冒烟装进版本目录的文件是同一组", async () => {
  const pattern = /tar -C \S*deploy"? -cf - ([\w. ]+?) \|/;
  const upload = deploySteps.map((step) => step.run ?? "").join("\n").match(pattern)?.[1];
  const smoke = (await readText("deploy/ci/smoke.sh")).match(pattern)?.[1];
  assert.equal(upload, "compose.yml Caddyfile bin");
  assert.equal(smoke, upload);
  const shipped = (await readdir(new URL("deploy/bin/", ROOT))).sort();
  assert.deepEqual(shipped, ["backup.sh", "compose.sh", "deploy.sh", "restore.sh"]);
});

test("部署失败时 job 失败：没有 continue-on-error，退出码原样传出", () => {
  for (const step of deploySteps) assert.ok(!("continue-on-error" in step));
  const remote = deployWorkflow.jobs["deploy"]?.steps.find((step) => (step.run ?? "").includes("deploy.sh' deploy"))?.run ?? "";
  assert.match(remote, /exit "\$status"/);
  const verify = deployWorkflow.jobs["deploy"]?.steps.find((step) => step.id === "verify")?.run ?? "";
  assert.match(verify, /deploy\.sh' rollback/);
  assert.match(verify, /exit 1\s*$/);
});

test("CI：每次都跑 shellcheck、部署冒烟和初始化脚本检查；冒烟用的是占位值和 APP_ENV=ci", async () => {
  const runs = (ciWorkflow.jobs["deploy-smoke"]?.steps ?? []).map((step) => step.run ?? "");
  assert.ok(runs.some((run) => /^shellcheck -x deploy\/bootstrap\.sh deploy\/bin\/\*\.sh deploy\/ci\/\*\.sh$/.test(run)));
  assert.ok(runs.includes("deploy/ci/smoke.sh"));
  assert.ok(runs.includes("deploy/ci/bootstrap-check.sh"));
  for (const step of ciWorkflow.jobs["deploy-smoke"]?.steps ?? []) assert.ok(!("continue-on-error" in step));

  const smoke = await readText("deploy/ci/smoke.sh");
  assert.match(smoke, /^export APP_ENV=ci$/m);
  const assigned = [...smoke.matchAll(/^(POSTGRES_PASSWORD|AUTH_JWT_SECRET)=(.*)$/gm)].map((match) => match[2] ?? "");
  assert.equal(assigned.length, 2);
  for (const value of assigned) assert.match(value, /^ci-placeholder-not-a-real-/);
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

test("部署相关的文件和文档里没有密钥原文，也没有写死的服务器 IP", async () => {
  const files = [
    ...SERVER_SCRIPTS,
    "deploy/compose.yml",
    "deploy/ci/compose.ci.yml",
    "deploy/Caddyfile",
    "apps/api/Dockerfile",
    ".github/workflows/deploy.yml",
    ".github/workflows/server-init.yml",
    ".github/actions/ssh-setup/action.yml",
    "docs/deploy.md",
    "docs/secrets.md",
    "docs/adr/0007-vps-deployment.md",
  ];
  /** 回环地址、通配地址，以及文档示例专用网段（RFC 5737）。 */
  const allowedAddress = /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;
  for (const path of files) {
    const text = await readText(path);
    assert.ok(!/sk_(live|test)_[0-9A-Za-z]{8,}|pk_(live|test)_[0-9A-Za-z]{8,}|whsec_[0-9A-Za-z]{8,}|AIza[0-9A-Za-z_-]{20,}/.test(text), `${path} 里有像密钥的内容`);
    assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `${path} 里有私钥`);
    assert.ok(!/ssh-(ed25519|rsa) AAAA[0-9A-Za-z+/]{20,}/.test(text), `${path} 里有公钥原文`);
    for (const match of text.matchAll(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)) {
      assert.match(match[0], allowedAddress, `${path} 里有写死的 IP：${match[0]}`);
    }
  }
});
