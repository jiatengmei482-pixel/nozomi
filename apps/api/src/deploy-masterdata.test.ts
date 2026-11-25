/**
 * 主数据导入工作流（M8-47b）：只开放测试环境、默认试运行、输出存产物；remote.sh masterdata 先校验参数再连服务器，
 * 在当前运行版本的 API 容器里执行对应的导入程序。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = new URL("../../../", import.meta.url);
const REMOTE = fileURLToPath(new URL("deploy/client/remote.sh", ROOT));
const linuxOnly = { skip: process.platform === "win32" ? "需要 bash" : false };

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Input {
  type: string;
  default?: unknown;
  options?: string[];
}
interface Workflow {
  on: { workflow_dispatch?: { inputs: Record<string, Input> } } & Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { environment: string; env: Record<string, string>; steps: Step[] }>;
}

const workflow = parse(await readFile(new URL(".github/workflows/masterdata.yml", ROOT), "utf8")) as Workflow;
const job = workflow.jobs["import"];
assert.ok(job, "masterdata.yml 要有 import 这个 job");
const steps = job.steps;

test("工作流只能手动触发，环境只有 staging，默认试运行", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const inputs = workflow.on.workflow_dispatch?.inputs ?? {};
  assert.deepEqual(inputs["environment"]?.options, ["staging"]);
  assert.equal(inputs["apply"]?.type, "boolean");
  assert.equal(inputs["apply"]?.default, false);
  assert.deepEqual(inputs["dataset"]?.options?.slice().sort(), ["airport-names", "airport-names-reviewed", "airports", "cities"]);
  assert.equal(job.env["MODE"], "${{ inputs.apply && 'apply' || 'dry-run' }}");
  // 第一步就拦：不是 main、不是 staging、国家码不对都直接失败，还没准备 SSH
  const check = steps[0]?.run ?? "";
  assert.match(check, /refs\/heads\/main/);
  assert.match(check, /"\$APP_ENV" != "staging"/);
  assert.match(check, /\^\[A-Z\]\{2\}\(,\[A-Z\]\{2\}\)\{0,19\}\$/);
  assert.ok(steps.findIndex((step) => step.uses === "./.github/actions/ssh-setup") > 0);
});

test("和部署同一个并发组；只经 remote.sh 操作服务器；输出存产物、SSH 密钥最后删掉", () => {
  assert.equal(workflow.concurrency.group, "deploy-${{ inputs.environment }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const runs = steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /deploy\/client\/remote\.sh masterdata "\$APP_ENV" "\$DATASET" "\$COUNTRIES" "\$MODE"/);
  assert.ok(!/(^|\s)ssh\s|compose\.sh/m.test(runs), "流水线应只通过 remote.sh 操作服务器");
  assert.match(runs, /exit "\$status"/, "导入失败时 job 失败");
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload?.if, "always()");
  assert.equal(upload?.with?.["retention-days"], 30);
  const last = steps.at(-1);
  assert.equal(last?.if, "always()");
  assert.match(last?.run ?? "", /rm -rf "\$RUNNER_TEMP\/nozomi-ssh"/);
});

test("每个可选的数据都有对应的导入程序", () => {
  for (const dataset of workflow.on.workflow_dispatch?.inputs["dataset"]?.options ?? []) {
    assert.ok(existsSync(new URL(`apps/api/src/cli/masterdata-import-${dataset}.ts`, ROOT)), dataset);
  }
});

/** 用一个假的 ssh 跑 remote.sh masterdata：假 ssh 把收到的远程命令写进文件，返回退出码和那条命令。 */
async function runRemote(args: string[], sshExit = 0): Promise<{ status: number | null; stderr: string; command: string | null }> {
  const dir = await mkdtemp(join(tmpdir(), "nozomi-masterdata-"));
  try {
    const sshDir = join(dir, "ssh");
    const binDir = join(dir, "bin");
    const record = join(dir, "remote-command");
    await mkdir(sshDir);
    await mkdir(binDir);
    await writeFile(join(sshDir, "config"), "Host vps\n  HostName 127.0.0.1\n");
    await writeFile(join(binDir, "ssh"), `#!/usr/bin/env bash\nprintf '%s' "\${@: -1}" >${JSON.stringify(record)}\nexit ${sshExit}\n`);
    await chmod(join(binDir, "ssh"), 0o755);
    const result = spawnSync("bash", [REMOTE, "masterdata", ...args], {
      encoding: "utf8",
      env: { PATH: `${binDir}:${process.env["PATH"] ?? ""}`, NOZOMI_SSH_DIR: sshDir },
    });
    const command = existsSync(record) ? await readFile(record, "utf8") : null;
    return { status: result.status, stderr: result.stderr, command };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("remote.sh masterdata：试运行带 --dry-run，写入不带；在当前版本的 API 容器里执行对应的导入程序", linuxOnly, async () => {
  const dry = await runRemote(["staging", "airport-names", "JP,KR", "dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.command, "/opt/nozomi/staging/current/bin/compose.sh exec -T api node apps/api/src/cli/masterdata-import-airport-names.ts --country JP\\,KR --dry-run");
  // 远程命令里的值经 printf %q 转义，服务器上的 shell 读回来就是 JP,KR
  assert.equal(spawnSync("bash", ["-c", `printf '%s' ${dry.command?.split(" --country ")[1]?.split(" ")[0] ?? ""}`], { encoding: "utf8" }).stdout, "JP,KR");
  assert.match(dry.stderr, /试运行（不写数据库）/);

  const apply = await runRemote(["staging", "cities", "JP", "apply"]);
  assert.equal(apply.status, 0, apply.stderr);
  assert.equal(apply.command, "/opt/nozomi/staging/current/bin/compose.sh exec -T api node apps/api/src/cli/masterdata-import-cities.ts --country JP");
  assert.match(apply.stderr, /写入数据库/);
});

test("remote.sh masterdata：服务器上导入失败时退出码原样传回", linuxOnly, async () => {
  const failed = await runRemote(["staging", "airports", "JP", "dry-run"], 1);
  assert.equal(failed.status, 1);
});

test("remote.sh masterdata：参数不对时不连服务器，退出码 2", linuxOnly, async () => {
  const bad: string[][] = [
    ["qa", "airports", "JP", "dry-run"],
    ["staging", "places", "JP", "dry-run"],
    ["staging", "airports", "jp", "dry-run"],
    ["staging", "airports", "JP;rm -rf /", "dry-run"],
    ["staging", "airports", "JP KR", "dry-run"],
    ["staging", "airports", "", "dry-run"],
    ["staging", "airports", Array.from({ length: 21 }, () => "JP").join(","), "dry-run"],
    ["staging", "airports", "JP", "write"],
    ["staging", "airports", "JP"],
  ];
  for (const args of bad) {
    const result = await runRemote(args);
    assert.equal(result.status, 2, `${args.join(" ")}：${result.stderr}`);
    assert.equal(result.command, null, `${args.join(" ")} 不应连服务器`);
  }
});
