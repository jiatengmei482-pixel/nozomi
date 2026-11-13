# 只读回放：用平台 QA 账号调 area-role-preview，记下 until / 摘要。用法：python3 replay.py <label> [until]
import sys,os,json,datetime; sys.path.insert(0,os.path.expanduser("~/nozomi-wt/tools"))
from qa_api import login, call
label=sys.argv[1]; until=sys.argv[2] if len(sys.argv)>2 else None
t=login()
q=f"?days=30"+(f"&until={until}" if until else "")
st,b=call("GET","/platform/v1/reports/area-role-preview"+q,token=t)
call("POST","/platform/v1/auth/logout",token=t)
r=b.get("replay",{}) if st==200 else {}
out={"label":label,"status":st,"until":r.get("until"),"logs":r.get("logs"),"replayed":r.get("replayed"),"resultLines":r.get("resultLines"),"resultDigest":r.get("resultDigest"),"stateDigest":r.get("stateDigest"),"error":b.get("error",{}).get("code") if st!=200 else None}
print(json.dumps(out,ensure_ascii=False))
json.dump({"summary":out,"lines":r.get("resultLineDigests")},open(os.path.expanduser(f"~/nozomi-wt/m814acc/replay-{label}.json"),"w"))
