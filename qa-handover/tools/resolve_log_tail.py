# 解决 roadmap.json 日志末尾的冲突：main 的条目在前，本分支的条目接在后面。用法：python3 resolve_log_tail.py <roadmap.json>
import sys
p = sys.argv[1]; L = open(p, encoding="utf-8").read().split("\n")
while any(l.startswith("<<<<<<<") for l in L):
    i = next(n for n, l in enumerate(L) if l.startswith("<<<<<<<")); j = next(n for n in range(i, len(L)) if L[n].startswith("=======")); k = next(n for n in range(j, len(L)) if L[n].startswith(">>>>>>>"))
    ours, theirs = L[i+1:j], L[j+1:k]
    keys = [l.strip().split('"')[1] for l in ours if l.strip().startswith('"')]
    if not all(x in ("date", "by", "summary") for x in keys): raise SystemExit(f"不是日志冲突（第 {i+1} 行），请手工处理")
    head = []
    if "date" not in keys: head.append('      "date": "2026-11-13",')
    if "by" not in keys and "date" not in keys: head.append('      "by": "Claude",')
    L[i:k+1] = theirs + ["    },", "    {"] + head + ours
open(p, "w", encoding="utf-8").write("\n".join(L))
# 收尾：任何紧跟在 "{" 后面、以 "by" 开头的日志条目补上 date（避免条目缺日期）
L = open(p, encoding="utf-8").read().split("\n"); i = 0
while i < len(L):
    if L[i].strip().startswith('"by":') and L[i-1].strip() == "{": L.insert(i, '      "date": "2026-11-13",'); i += 1
    i += 1
open(p, "w", encoding="utf-8").write("\n".join(L))
