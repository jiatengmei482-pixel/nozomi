"""在当前分支合并 origin/main；roadmap.json 冲突时以 main 为底，再把本分支对指定任务的 status/evidence 和本分支新增的日志补回。
用法：python3 merge-main-roadmap.py M6-06 [M6-03 ...]"""
import json, subprocess, sys, re
def sh(*a, check=True): return subprocess.run(a, capture_output=True, text=True, check=check).stdout
P = "docs/progress/roadmap.json"
ours = json.loads(sh("git", "show", f"HEAD:{P}"))
r = subprocess.run(["git", "merge", "--no-edit", "origin/main"], capture_output=True, text=True)
if r.returncode != 0:
    conflicted = sh("git", "diff", "--name-only", "--diff-filter=U").split()
    if set(conflicted) - {P}: sys.exit(f"roadmap 以外有冲突：{conflicted}")
    sh("git", "checkout", "--theirs", P)
s = open(P).read()
tasks = {t["id"]: t for m in ours["milestones"] for t in m["tasks"]}
for tid in sys.argv[1:]:
    t = tasks[tid]
    i = s.index(f'"id": "{tid}"'); j = s.index('"updated":', i); seg = s[i:j]
    seg = re.sub(r'"status": "\w+"', f'"status": "{t["status"]}"', seg, count=1)
    seg = re.sub(r'"evidence": "(?:[^"\\]|\\.)*"', lambda m: '"evidence": ' + json.dumps(t["evidence"], ensure_ascii=False), seg, count=1)
    s = s[:i] + seg + s[j:]
have = {l["summary"] for l in json.loads(s)["log"]}
for l in ours["log"]:
    if l["summary"] not in have:
        end = s.rindex("\n  ]\n}")
        s = s[:end] + ",\n    {\n      \"date\": " + json.dumps(l["date"]) + ",\n      \"by\": " + json.dumps(l["by"]) + ",\n      \"summary\": " + json.dumps(l["summary"], ensure_ascii=False) + "\n    }" + s[end:]
open(P, "w").write(s)
json.loads(s)
if "<<<<<<<" in s: sys.exit("还有冲突标记")
sh("git", "add", P)
if r.returncode != 0: sh("git", "commit", "--no-edit")
print("ok", sh("git", "log", "--oneline", "-1").strip())
