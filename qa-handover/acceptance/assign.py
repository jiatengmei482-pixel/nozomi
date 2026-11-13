from setup import *
import stat
ids=json.load(open("ids.json")); o=json.load(open("tenant_orders.json"))
links={}
for k,v in sorted(o.items()):
    st,d=req("GET",f"/tenant/v1/orders/{v['id']}"); ver=d["order"]["version"]
    veh=ids["vehicle_cmf"] if k=="F" else ids["vehicle"]
    st,b=req("POST",f"/tenant/v1/orders/{v['id']}/assign",{"driver_id":ids["driver"],"vehicle_id":veh,"confirm_conflicts":True},{"if-match":f'"{ver}"'})
    if st>=300: print(k,st,json.dumps(b,ensure_ascii=False)[:500]); continue
    dl=b.get("driver_link") or {}
    print(k,st,b.get("order",{}).get("status"),"path_prefix=",(dl.get("path") or "")[:12])
    links[k]=dl.get("path")
open(".driverlinks","w").write(json.dumps(links)); os.chmod(".driverlinks",0o600)
