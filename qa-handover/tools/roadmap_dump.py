"""按 roadmap.json 原有格式写回：缩进 2，字符串数组写在一行。用法：from roadmap_dump import dump"""
import json
def _d(v, ind):
    pad = "  " * ind
    if isinstance(v, dict):
        if not v: return "{}"
        items = [f'{pad}  {json.dumps(k, ensure_ascii=False)}: {_d(x, ind + 1)}' for k, x in v.items()]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(v, list):
        if all(isinstance(x, str) for x in v):
            return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
        items = [f"{pad}  {_d(x, ind + 1)}" for x in v]
        return "[\n" + ",\n".join(items) + f"\n{pad}]"
    return json.dumps(v, ensure_ascii=False)
def dump(obj, path):
    open(path, "w").write(_d(obj, 0) + "\n")
