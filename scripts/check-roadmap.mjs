// 校验 docs/progress/roadmap.json 的结构，防止进度页因格式错误发布失败。只用 Node 内置模块。
import { readFileSync } from "node:fs";

const file = new URL("../docs/progress/roadmap.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const date = /^\d{4}-\d{2}-\d{2}$/;

if (!date.test(data.updated ?? "")) errors.push("updated 必须是 YYYY-MM-DD");
const statuses = Object.keys(data.statuses ?? {});
const roles = Object.keys(data.roles ?? {});
const ids = new Set();

for (const m of data.milestones ?? []) {
  if (!m.id || !m.name) errors.push(`里程碑缺少 id 或 name：${JSON.stringify(m).slice(0, 60)}`);
  for (const t of m.tasks ?? []) {
    const where = `${m.id}/${t.id}`;
    if (!t.id?.startsWith(`${m.id}-`)) errors.push(`${where}：任务编号应以 ${m.id}- 开头`);
    if (ids.has(t.id)) errors.push(`${where}：任务编号重复`);
    ids.add(t.id);
    if (!t.title) errors.push(`${where}：缺少 title`);
    if (!statuses.includes(t.status)) errors.push(`${where}：未知状态 ${t.status}`);
    if (!roles.includes(t.role)) errors.push(`${where}：未知角色 ${t.role}`);
    if (!Array.isArray(t.acceptance) || t.acceptance.length === 0) errors.push(`${where}：至少一条验收标准`);
    if (!date.test(t.updated ?? "")) errors.push(`${where}：updated 必须是 YYYY-MM-DD`);
    if (t.status === "blocked" && !t.blockedBy) errors.push(`${where}：受阻任务必须写 blockedBy`);
    if (t.status === "done" && !t.evidence) errors.push(`${where}：已验收任务必须写 evidence（PR、测试或验收报告）`);
  }
}
for (const l of data.log ?? []) {
  if (!date.test(l.date ?? "") || !l.summary) errors.push(`日志条目格式不对：${JSON.stringify(l).slice(0, 60)}`);
}

if (errors.length) {
  console.error(`roadmap.json 有 ${errors.length} 个问题：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`roadmap.json 通过：${data.milestones.length} 个里程碑，${ids.size} 个任务`);
