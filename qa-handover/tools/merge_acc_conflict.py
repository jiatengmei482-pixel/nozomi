# 解决 roadmap.json 里「acceptance 单行数组」的冲突：保留 HEAD 的，补上对方新增、HEAD 没有的条目。用法：python3 merge_acc_conflict.py <roadmap.json>
import sys, json
p = sys.argv[1]; L = open(p, encoding="utf-8").read().split("\n")
while "<<<<<<< HEAD" in [l.strip()[:12] for l in L] or any(l.startswith("<<<<<<<") for l in L):
    i = next(k for k, l in enumerate(L) if l.startswith("<<<<<<<"))
    j = next(k for k in range(i, len(L)) if L[k].startswith("======="))
    k = next(k for k in range(j, len(L)) if L[k].startswith(">>>>>>>"))
    ours, theirs = L[i+1:j], L[j+1:k]
    if len(ours) != 1 or len(theirs) != 1 or '"acceptance":' not in ours[0]:
        raise SystemExit(f"不是单行 acceptance 冲突（第 {i+1} 行），请手工处理")
    ind = ours[0][: len(ours[0]) - len(ours[0].lstrip())]
    a = json.loads(ours[0].strip()[len('"acceptance": '):].rstrip(","))
    b = json.loads(theirs[0].strip()[len('"acceptance": '):].rstrip(","))
    merged = a + [x for x in b if x not in a]
    L[i:k+1] = [f'{ind}"acceptance": {json.dumps(merged, ensure_ascii=False)},']
open(p, "w", encoding="utf-8").write("\n".join(L))
