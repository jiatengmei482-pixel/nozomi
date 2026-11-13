# M8-14 验收数据准备：只写 QA 测试供应商（is_test_tenant）。每一步记 UTC 时间到 writes.log。
import sys, os, json, uuid, datetime
sys.path.insert(0, os.path.expanduser("~/nozomi-wt/tools"))
from qa_tenant import login
import urllib.request, urllib.error
B = "https://nozomi.moveglobal.io"
T = login()
LOG = open(os.path.expanduser("~/nozomi-wt/m814acc/writes.log"), "a")
def req(method, path, body=None, headers=None):
    h = {"authorization": "Bearer " + T, **(headers or {})}
    data = None
    if body is not None:
        h["content-type"] = "application/json"; data = json.dumps(body).encode()
    r = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as x: st, b = x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e: st, b = e.code, json.loads(e.read() or b"{}")
    if method != "GET":
        LOG.write(f"{datetime.datetime.utcnow().isoformat()[:19]}Z {method} {path} -> {st}\n"); LOG.flush()
    return st, b
def ok(st, b, what):
    if st >= 300: raise SystemExit(f"{what}: {st} {json.dumps(b, ensure_ascii=False)[:600]}")
    return b
