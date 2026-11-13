# 测试环境 QA 测试供应商（ADR 0077）登录 + 调用。邮箱、密码只从 ~/.ssh/nozomi 下的文件读，不打印。
import json, os, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.expanduser("~/nozomi-wt/tools"))
from qa_api import call, B
def _read(name): return open(os.path.expanduser("~/.ssh/nozomi/" + name)).read().strip()
def login():
    st, b = call("POST", "/tenant/v1/auth/login", {"email": _read("qa-staging-tenant-email"), "password": _read("qa-staging-tenant-password")})
    if st != 200: raise SystemExit(f"QA 供应商登录失败：{st} {b.get('error', {}).get('code')} {sorted(b.keys())}")
    if "access_token" not in b: raise SystemExit(f"登录需要下一步：{sorted(b.keys())}")
    return b["access_token"]
