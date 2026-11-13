import sys,os,json; sys.path.insert(0,os.path.expanduser("~/nozomi-wt/tools"))
from qa_api import login, call
t=login()
for q in ("", "?acceptance=only", "?acceptance=include"):
    st,b=call("GET",f"/platform/v1/manual-quote-requests{q}&limit=5".replace("{q}&","") if False else f"/platform/v1/manual-quote-requests{q}{'&' if q else '?'}limit=5",token=t)
    items=b.get("items",[])
    print(q or "(默认)", st, "条数",len(items), "验收:",sum(1 for x in items if x.get("is_acceptance")), "最新:", items[0]["request_no"] if items else None, items[0].get("is_acceptance") if items else None, "counts:",json.dumps(b.get("counts"),ensure_ascii=False)[:120])
call("POST","/platform/v1/auth/logout",token=t)
