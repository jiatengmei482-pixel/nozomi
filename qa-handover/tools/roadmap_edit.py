# 按行修改 roadmap.json，保留原来的排版。用法见各函数。
import json, re
P = "docs/progress/roadmap.json"
L = open(P, encoding="utf-8").read().split("\n")
def block(tid):
    s = next(i for i, l in enumerate(L) if l.strip() == f'"id": "{tid}",')
    e = s
    while not L[e].strip().startswith("}"): e += 1
    return s, e
def setf(tid, key, value):
    s, e = block(tid)
    for i in range(s, e):
        if L[i].strip().startswith(f'"{key}":'):
            ind = L[i][: len(L[i]) - len(L[i].lstrip())]
            comma = "," if L[i].rstrip().endswith(",") or key != "updated" else ""
            L[i] = f'{ind}"{key}": {json.dumps(value, ensure_ascii=False)}' + ("," if key != "updated" else "")
            return
    raise KeyError(key)
def getf(tid, key):
    s, e = block(tid)
    txt = "{" + "\n".join(L[s:e]).rstrip().rstrip(",") + "}"
    return json.loads(txt)[key]
def setacc(tid, items):
    s, e = block(tid)
    a = next(i for i in range(s, e) if L[i].strip().startswith('"acceptance":'))
    b = next(i for i in range(a, e) if L[i].strip().startswith('"evidence":'))
    ind = L[a][: len(L[a]) - len(L[a].lstrip())]
    L[a:b] = [f'{ind}"acceptance": {json.dumps(items, ensure_ascii=False)},']
def add_task_after(tid, task):
    s, e = block(tid)
    ind = L[s][: len(L[s]) - len(L[s].lstrip())]
    o = ind[:-2]
    body = [f'{ind}"{k}": {json.dumps(v, ensure_ascii=False)}' + ("," if k != "updated" else "") for k, v in task.items()]
    had_comma = L[e].rstrip().endswith(",")
    if not had_comma: L[e] = L[e].rstrip() + ","
    L[e+1:e+1] = [o + "{"] + body + [o + ("}," if had_comma else "}")]
def add_log(entry):
    i = len(L) - 1
    while L[i].strip() != "]": i -= 1
    L[i-1] = L[i-1].rstrip() + ","
    L[i:i] = ["    {", f'      "date": {json.dumps(entry["date"])},', f'      "by": {json.dumps(entry["by"])},', f'      "summary": {json.dumps(entry["summary"], ensure_ascii=False)}', "    }"]
def set_updated(d):
    for i, l in enumerate(L):
        if l.startswith('  "updated":'): L[i] = f'  "updated": "{d}",'; return
def save(): open(P, "w", encoding="utf-8").write("\n".join(L))
