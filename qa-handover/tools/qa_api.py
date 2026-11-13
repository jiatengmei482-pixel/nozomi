# 测试环境的 QA 平台账号登录（两步验证）和只读调用。密码、TOTP 密钥只从 ~/.ssh/nozomi 下 600 权限的文件读，不打印。
import json, os, time, hmac, hashlib, base64, struct, urllib.request, urllib.error
B = "https://nozomi.moveglobal.io"
def _read(name): return open(os.path.expanduser("~/.ssh/nozomi/" + name)).read().strip()
def call(method, path, body=None, token=None):
    req = urllib.request.Request(B + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"content-type": "application/json", **({"authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def totp(secret, t=None):
    key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
    c = int((t or time.time()) // 30); h = hmac.new(key, struct.pack(">Q", c), hashlib.sha1).digest(); o = h[-1] & 15
    return "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7fffffff) % 1000000)
def login():
    st, b = call("POST", "/platform/v1/auth/login", {"email": "qa-acceptance@nozomi.moveglobal.io", "password": _read("qa-password")})
    assert st == 200, (st, b.get("error", {}).get("code"))
    tok = b["access_token"]
    for _ in range(2):
        st, v = call("POST", "/platform/v1/auth/mfa/verify", {"code": totp(_read("qa-totp"))}, tok)
        if st == 200: return v.get("access_token", tok)
        time.sleep(31 - time.time() % 30)  # 同一时间窗的码只能用一次，换下一个窗口
    raise SystemExit(f"两步验证失败：{st} {v.get('error', {}).get('code')}")
