# 测试环境：第三方密钥的生效状态（只读，只显示来源，不显示末 4 位）
import sys, os; sys.path.insert(0, os.path.expanduser("~/nozomi-wt/tools")); from qa_api import call, login
tok = login(); st, r = call("GET", "/platform/v1/integration-secrets", token=tok)
for it in r.get("items", []): print(it.get("key"), it.get("state"), it.get("source"))
