// 以 main 的 openapi 为底，把本分支新增的 path、schema、response、tag 逐条补进去；两边都有的保持 main 的（再按需人工核对）
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.argv[5]);
const YAML = require("yaml");
const ours = YAML.parseDocument(readFileSync(process.argv[2], "utf8"));
const main = YAML.parseDocument(readFileSync(process.argv[3], "utf8"));
const added = [];
for (const path of [["paths"], ["components", "schemas"], ["components", "responses"], ["components", "parameters"]]) {
  const o = ours.getIn(path), m = main.getIn(path);
  if (!o) continue;
  for (const item of o.items) {
    const key = item.key.value;
    if (!m.has(key)) { m.add(item); added.push(path.join(".") + "." + key); }
  }
}
const otags = ours.get("tags"), mtags = main.get("tags");
for (const t of otags.items) if (!mtags.items.some((x) => x.get("name") === t.get("name"))) { mtags.items.push(t); added.push("tag." + t.get("name")); }
writeFileSync(process.argv[4], main.toString({ lineWidth: 0 }));
console.log(added.length, "added;", added.filter((a) => !a.includes("/site/") && !a.includes("Site")).join(", "));
