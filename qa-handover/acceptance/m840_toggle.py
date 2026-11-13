# M8-40 验收：临时启用 / 停用 QA 测试供应商的点对点商品（计程价）。只写 QA 测试供应商。用法：python3 m840_toggle.py on|off
import sys
from setup import *
P2P="dae3db20-5df8-4e99-86e3-02b2978a5cf9"
AREAS=["454c6572-5251-41cd-ba40-eb4596291d92","c7cce821-ee16-4878-ac64-f7f3a9c260eb","bf94606a-53db-4d4a-b3c3-9f1b35dd8896"]
on=sys.argv[1]=="on"
def ver(pid): return req("GET",f"/tenant/v1/products/{pid}")[1]["version"]
if on:
    for a in AREAS: st,b=req("POST",f"/tenant/v1/areas/{a}/enable",{}); print("area on",st)
st,pr=req("GET",f"/tenant/v1/products/{P2P}/price-rules")
upd=[]
for r in pr["items"]:
    want="enabled" if on else "disabled"
    if r["status"]!=want:
        x={k:v for k,v in r.items() if k not in ("base","created_at","updated_at")}; x["status"]=want; upd.append(x)
if upd: st,b=req("POST",f"/tenant/v1/products/{P2P}/price-rules/batch",{"create":[],"update":upd,"delete":[]},{"if-match":f'"{ver(P2P)}"',"idempotency-key":str(uuid.uuid4())}); print("rules",st,len(upd))
st,dp=req("GET",f"/tenant/v1/products/{P2P}/distance-prices")
for d in dp["items"]:
    act="enable" if on else "disable"
    st,b=req("POST",f"/tenant/v1/products/{P2P}/distance-prices/{d['id']}/{act}",{},{"if-match":f'"{ver(P2P)}"'}); print("distance",act,st)
if on:
    st,b=req("POST",f"/tenant/v1/products/{P2P}/qa-list",{}); print("qa-list",st,b.get("status"))
else:
    st,b=req("POST",f"/tenant/v1/products/{P2P}/unpublish",{}); print("unpublish",st,b.get("status"))
    for a in AREAS: st,b=req("POST",f"/tenant/v1/areas/{a}/disable",{}); print("area off",st)
