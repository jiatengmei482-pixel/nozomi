"""合并冲突时：roadmap 以 main（theirs）为底，把本分支（HEAD）新增或改过的任务（参数给任务号）放回去，再补本分支的日志。
用法：在冲突状态下 python3 merge-roadmap-new.py M4-34 [M6-09 …]；任务在 main 里已有就替换整个任务对象，没有就插到同里程碑末尾。"""
import json, subprocess, sys
sys.path.insert(0, "/home/codespace/nozomi-wt/tools")
from roadmap_dump import _d
P = "docs/progress/roadmap.json"
ours = json.loads(subprocess.check_output(["git", "show", f"HEAD:{P}"]))
subprocess.run(["git", "checkout", "--theirs", P], check=True)
s = open(P).read()
def task_span(text, tid):
    i = text.index(f'"id": "{tid}"'); start = text.rindex("{", 0, i); depth = 0
    for k in range(start, len(text)):
        if text[k] == "{": depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0: return start, k + 1
for tid in sys.argv[1:]:
    mid = tid.split("-")[0]
    t = [t for m in ours["milestones"] for t in m["tasks"] if t["id"] == tid][0]
    block = _d(t, 4)
    if f'"id": "{tid}"' in s:
        a, b = task_span(s, tid); s = s[:a] + block + s[b:]
    else:
        m = json.loads(s); last = [x for x in m["milestones"] if x["id"] == mid][0]["tasks"][-1]["id"]
        a, b = task_span(s, last); s = s[:b] + ",\n        " + block + s[b:]
have = {l["summary"] for l in json.loads(s)["log"]}
for l in ours["log"]:
    if l["summary"] not in have:
        end = s.rindex("\n  ]\n}")
        s = s[:end] + ",\n    " + _d(l, 2) + s[end:]
json.loads(s); assert "<<<<<<<" not in s
open(P, "w").write(s); subprocess.run(["git", "add", P], check=True); print("ok")
