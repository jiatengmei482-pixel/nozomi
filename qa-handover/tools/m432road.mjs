import { readFileSync, writeFileSync } from "node:fs";
const p = "docs/progress/roadmap.json";
const lines = readFileSync(p, "utf8").split("\n");
const at = (id) => { const i = lines.findIndex((l) => l.includes(`"id": "${id}"`)); if (i < 0) throw new Error(id); return i; };
let i = at("M4-32");
const ev = "PR #110；开发新增单元 7、集成 5、端到端 1 条；测试角色新增 43 条（边界、夏令时、改单联动、并发、什么都不写入、其他入口不受影响），发现的 2 个缺陷（读屏播报、夏令时）已修；全量见 PR 的 CI";
lines[i] = lines[i].replace(/"status": "[a-z]+"/, '"status": "review"').replace(/"evidence": "[^"]*"/, `"evidence": "${ev}"`).replace(/"updated": "[^"]*"/, '"updated": "2026-11-02"');
if (!lines.some((l) => l.includes('"id": "M4-33"'))) {
  const row = lines[i].replace(/"id": "M4-32"/, '"id": "M4-33"').replace(/"title": "[^"]*"/, '"title": "供应商后台和调度接口的回传也加时间窗口"').replace(/"status": "[^"]*"/, '"status": "todo"')
    .replace(/"acceptance": \[.*?\], "evidence"/, `"acceptance": ${JSON.stringify(["M4-32 只拦了司机链接；供应商后台和 /tenant/v1/orders/{id}/events 仍可在用车前很久点完成", "用同一份规则（ADR 0064）；这是对外接口，先排期并通知对接方，再上线", "加限制后对接方收到的错误码、说明和 OpenAPI 一致"])}, "evidence"`).replace(/"evidence": "[^"]*"/, '"evidence": ""');
  lines.splice(i + 1, 0, row);
}
let s = lines.join("\n");
if (!s.includes("M4-32 待验收")) {
  const entry = `{\n      "date": "2026-11-02",\n      "by": "Claude",\n      "summary": "M4-32 待验收：司机链接回传加时间窗口（出发、到达用车前 24 小时起，接到客人、完成用车前 3 小时起）。新增 M4-33：供应商一侧也要加，先排期通知对接方。"\n    }\n  ]\n}`;
  const tail = /\}\n  \]\n\}\s*$/;
  if (!tail.test(s)) throw new Error("tail");
  s = s.replace(tail, `},\n    ${entry}\n`);
}
JSON.parse(s); writeFileSync(p, s);
