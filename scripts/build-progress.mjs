// 由 docs/progress/roadmap.json 生成开发进度页 site/index.html。只用 Node 内置模块，CI 和本地都能直接运行。
// 用法：node scripts/build-progress.mjs [--fragment]
//   --fragment  只输出页面主体（不含 <html>/<head>），用于发布为 claude.ai Artifact
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const data = JSON.parse(readFileSync(new URL("docs/progress/roadmap.json", root), "utf8"));
const fragment = process.argv.includes("--fragment");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const tasks = data.milestones.flatMap((m) => m.tasks.map((t) => ({ ...t, milestone: m.id })));
const count = (st) => tasks.filter((t) => t.status === st).length;
const done = count("done");
const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
const attention = tasks.filter((t) => t.status === "blocked" || t.status === "review");
const current = data.milestones.find((m) => m.tasks.some((t) => t.status !== "done")) ?? data.milestones.at(-1);

const pill = (st) => `<span class="pill s-${esc(st)}">${esc(data.statuses[st] ?? st)}</span>`;
const role = (r) => `<span class="role">${esc(data.roles[r] ?? r)}</span>`;

function station(m) {
  const n = m.tasks.length;
  const d = m.tasks.filter((t) => t.status === "done").length;
  const state = d === n ? "passed" : m === current ? "current" : "ahead";
  const label = state === "passed" ? "已完成" : state === "current" ? "进行中" : "未开始";
  return `<li class="stop ${state}">
    <span class="dot" aria-hidden="true"></span>
    <span class="code">${esc(m.id)}</span>
    <span class="stop-name">${esc(m.name)}</span>
    <span class="stop-meta">${d}/${n} · ${label}</span>
  </li>`;
}

function taskRow(t) {
  const extra = t.status === "blocked" && t.blockedBy ? `<p class="blocked-by">受阻原因：${esc(t.blockedBy)}</p>` : "";
  return `<tr>
    <td class="tid">${esc(t.id)}</td>
    <td class="ttl"><details><summary>${esc(t.title)}</summary>
      <ul class="acc">${t.acceptance.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
      ${t.evidence ? `<p class="evidence">依据：${esc(t.evidence)}</p>` : ""}</details>${extra}</td>
    <td>${role(t.role)}</td>
    <td>${pill(t.status)}</td>
    <td class="num">${esc(t.updated)}</td>
  </tr>`;
}

function milestone(m) {
  const n = m.tasks.length;
  const d = m.tasks.filter((t) => t.status === "done").length;
  return `<section class="ms" id="${esc(m.id)}">
    <header class="ms-head">
      <h2><span class="code">${esc(m.id)}</span> ${esc(m.name)}</h2>
      <span class="ms-count num">${d} / ${n}</span>
    </header>
    <p class="goal">${esc(m.goal)}</p>
    <div class="bar" role="img" aria-label="${d} / ${n} 已验收"><i style="width:${n ? (d / n) * 100 : 0}%"></i></div>
    <div class="tbl"><table>
      <thead><tr><th>编号</th><th>任务（点开看验收标准）</th><th>角色</th><th>状态</th><th>更新</th></tr></thead>
      <tbody>${m.tasks.map(taskRow).join("")}</tbody>
    </table></div>
  </section>`;
}

const css = `
/* 版式：顶部总览 → 里程碑路线（像接送路线的站点）→ 需要你处理 → 各里程碑任务表 → 开发日志 */
:root{
  --bg:#f5f6f8; --surface:#ffffff; --ink:#18202b; --muted:#5d6878; --line:#d9dee6;
  --signal:#e0a800; --signal-ink:#3a2c00; --route:#1f3a5f;
  --ok:#1d7a46; --ok-bg:#e3f3e9; --warn:#9a5b00; --warn-bg:#fdf0d8; --bad:#b4232f; --bad-bg:#fbe4e6; --idle-bg:#eceff3;
  --f-display:"Barlow Condensed","Noto Sans SC",system-ui,sans-serif;
  --f-body:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#0f141b; --surface:#161d27; --ink:#e7ebf1; --muted:#9aa6b6; --line:#2a3443;
  --signal:#f2bf2a; --signal-ink:#1d1600; --route:#8fb3e0;
  --ok:#6fd39a; --ok-bg:#15301f; --warn:#f2bf2a; --warn-bg:#352a0c; --bad:#ff8a93; --bad-bg:#3a1519; --idle-bg:#1e2632; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#0f141b; --surface:#161d27; --ink:#e7ebf1; --muted:#9aa6b6; --line:#2a3443;
  --signal:#f2bf2a; --signal-ink:#1d1600; --route:#8fb3e0;
  --ok:#6fd39a; --ok-bg:#15301f; --warn:#f2bf2a; --warn-bg:#352a0c; --bad:#ff8a93; --bad-bg:#3a1519; --idle-bg:#1e2632; color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.6 var(--f-body);margin:0}
.wrap{max-width:1080px;margin:0 auto;padding-inline:16px;padding-block:28px 56px;display:grid;gap:28px}
h1,h2{font-family:var(--f-display);font-weight:600;letter-spacing:.01em;text-wrap:balance;margin:0}
h1{font-size:clamp(28px,5vw,40px);line-height:1.1}
h2{font-size:22px}
.num,.code,.tid{font-family:var(--f-mono);font-variant-numeric:tabular-nums}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.top{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end;justify-content:space-between}
.top p{margin:6px 0 0;color:var(--muted)}
.score{display:flex;gap:10px;align-items:baseline}
.score b{font-family:var(--f-display);font-size:56px;line-height:1}
.score span{color:var(--muted)}
.counts{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.counts li{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted)}
.route{list-style:none;margin:0;padding:18px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;
  display:grid;grid-template-columns:repeat(${data.milestones.length},minmax(0,1fr));gap:0;position:relative}
.stop{position:relative;display:grid;gap:2px;justify-items:center;text-align:center;padding:0 4px}
.stop::before{content:"";position:absolute;top:9px;left:0;right:0;height:4px;background:var(--line)}
.stop:first-child::before{left:50%}.stop:last-child::before{right:50%}
.stop.passed::before,.stop.current::before{background:var(--route)}
.stop.current::before{background:linear-gradient(90deg,var(--route) 50%,var(--line) 50%)}
.dot{position:relative;width:22px;height:22px;border-radius:50%;background:var(--surface);border:4px solid var(--line);z-index:1}
.passed .dot{background:var(--route);border-color:var(--route)}
.current .dot{background:var(--signal);border-color:var(--route)}
.stop .code{font-size:12px;color:var(--muted);margin-top:4px}
.stop-name{font-weight:600;font-size:14px;line-height:1.3}
.stop-meta{font-size:12px;color:var(--muted)}
.attn{background:var(--surface);border:1px solid var(--line);border-left:6px solid var(--signal);border-radius:10px;padding:16px 18px;display:grid;gap:10px}
.attn h2{font-size:20px}
.attn ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.attn li{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:start}
.attn li p{grid-column:2;margin:0;color:var(--muted);font-size:14px}
.ms{display:grid;gap:10px}
.ms-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.ms-head .code{color:var(--muted);font-size:16px;margin-right:4px}
.ms-count{color:var(--muted)}
.goal{margin:0;color:var(--muted);max-width:65ch}
.bar{height:6px;background:var(--idle-bg);border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--route)}
.tbl{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:10px}
table{width:100%;border-collapse:collapse;min-width:640px}
th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.04em}
.tid{white-space:nowrap;color:var(--muted);font-size:13px}
.ttl{min-width:0}
summary{cursor:pointer;font-weight:500}
summary:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
.acc{margin:8px 0 0;padding-left:18px;color:var(--muted);font-size:14px}
.evidence,.blocked-by{margin:6px 0 0;font-size:13px;color:var(--muted)}
.blocked-by{color:var(--bad)}
.role{font-size:13px;white-space:nowrap}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;white-space:nowrap;background:var(--idle-bg);color:var(--muted)}
.s-done{background:var(--ok-bg);color:var(--ok)}
.s-doing{background:var(--signal);color:var(--signal-ink)}
.s-review{background:var(--warn-bg);color:var(--warn)}
.s-blocked{background:var(--bad-bg);color:var(--bad)}
.log{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.log li{display:grid;grid-template-columns:110px 1fr;gap:12px}
.log time{font-family:var(--f-mono);color:var(--muted);font-size:13px}
.log p{margin:0;max-width:70ch}
footer{color:var(--muted);font-size:13px}
@media (max-width:640px){
  .route{grid-template-columns:1fr;gap:14px;padding:16px}
  .stop{grid-template-columns:22px 1fr;justify-items:start;text-align:left;column-gap:12px}
  .stop::before{top:22px;bottom:-18px;left:9px;right:auto;width:4px;height:auto}
  .stop:first-child::before{left:9px}.stop:last-child::before{display:none}
  .stop.current::before{background:var(--line)}
  .stop .dot{grid-row:1/4}
  .stop .code{margin-top:0}
  .log li{grid-template-columns:1fr;gap:2px}
}
@media (prefers-reduced-motion:no-preference){.bar i{transition:width .4s ease}}
`;

const body = `<div class="wrap">
  <header class="top">
    <div>
      <div class="eyebrow">开发进度</div>
      <h1>${esc(data.project)}</h1>
      <p>数据更新于 <span class="num">${esc(data.updated)}</span> · 当前阶段 ${esc(current.id)} ${esc(current.name)}</p>
    </div>
    <div>
      <div class="score"><b class="num">${pct}%</b><span>${done} / ${tasks.length} 个任务已验收</span></div>
      <ul class="counts">${Object.keys(data.statuses).map((s) => `<li>${pill(s)} <span class="num">${count(s)}</span></li>`).join("")}</ul>
    </div>
  </header>

  <ol class="route" aria-label="里程碑路线">${data.milestones.map(station).join("")}</ol>

  ${attention.length ? `<section class="attn" aria-labelledby="attn-h">
    <h2 id="attn-h">需要你处理</h2>
    <ul>${attention.map((t) => `<li>${pill(t.status)}<b>${esc(t.id)} ${esc(t.title)}</b>
      <p>${t.status === "blocked" ? esc(t.blockedBy) : `请检查并确认验收：${esc(t.evidence || t.acceptance.join("；"))}`}</p></li>`).join("")}</ul>
  </section>` : ""}

  ${data.milestones.map(milestone).join("")}

  <section class="ms" aria-labelledby="log-h">
    <h2 id="log-h">开发日志</h2>
    <ul class="log">${[...data.log].reverse().map((l) => `<li><time>${esc(l.date)}</time><p>${esc(l.summary)}${l.by ? ` <span class="role">· ${esc(l.by)}</span>` : ""}</p></li>`).join("")}</ul>
  </section>

  <footer>本页由仓库里的 docs/progress/roadmap.json 自动生成。每个开发任务完成后，由负责的 AI 角色更新该文件。</footer>
</div>`;

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600&display=swap">`;

const title = `${data.project} 开发进度`;
const html = fragment
  ? `<title>${esc(title)}</title>\n${fonts}\n<style>${css}</style>\n${body}\n`
  : `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>${esc(title)}</title>\n${fonts}\n<style>${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

const outDir = new URL(fragment ? "site/fragment/" : "site/", root);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("index.html", outDir), html);
console.log(`已生成 ${new URL("index.html", outDir).pathname}（${tasks.length} 个任务，完成 ${pct}%）`);
