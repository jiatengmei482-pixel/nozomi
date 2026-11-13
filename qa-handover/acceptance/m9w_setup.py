# M9W 验收数据（只写 QA 测试供应商）：新建「QA-富士山（M9W 验收）」包车区域 + 途经加价；启用 QA 包车商品和东京中心区域，qa-list。用法：python3 m9w_setup.py on|off
import sys
from setup import *
ids=json.load(open("ids.json"))
CITY="a6c1d2e6-37cf-4b84-b8b6-bb35e4266ba3"; CH="b621e14e-558a-4bd9-9532-98b695bc5ea7"; VG="546a3098-6dd5-470f-ac60-039eb8be83da"
TOKYO="a2fef668-74b1-47cd-9763-b81631dde50e"
on=sys.argv[1]=="on"
def ver(pid): return req("GET",f"/tenant/v1/products/{pid}")[1]["version"]
if on:
    if "fuji_area" not in ids:
        st,b=req("POST","/tenant/v1/areas",{"city_id":CITY,"name":{"zh":"QA-富士山（M9W 验收）"},"biz_type":"charter","role":"both","polygons":[{"kind":"operate","geometry":{"type":"Polygon","coordinates":[[[138.65,35.33],[138.85,35.33],[138.85,35.55],[138.65,35.55],[138.65,35.33]]]}}]},{"idempotency-key":str(uuid.uuid4())})
        ids["fuji_area"]=ok(st,b,"新建富士山区域")["id"]; json.dump(ids,open("ids.json","w"))
    for a in (TOKYO, ids["fuji_area"]):
        st,b=req("POST",f"/tenant/v1/areas/{a}/enable",{}); print("area on",st)
    st,pr=req("GET",f"/tenant/v1/products/{CH}/price-rules")
    upd=[]; has_fuji=False
    for r in pr["items"]:
        if r["area_id"]==ids["fuji_area"]: has_fuji=True
        if r["area_id"] in (TOKYO, ids["fuji_area"]) and r["status"]!="enabled":
            x={k:v for k,v in r.items() if k not in ("base","created_at","updated_at")}; x["status"]="enabled"; upd.append(x)
    create=[]
    if not has_fuji:
        E0={"package_hours":8,"start_price":None,"start_meters":None,"start_minutes":None,"per_km":None,"per_minute":None,"min_price":None,"package_km":None,"package_price":None,"overtime_per_hour":None,"over_km_per_km":None,"base_price":None,"included_km":None}
        create=[{**E0,"ref":"fuji","area_id":ids["fuji_area"],"vehicle_group_id":VG,"direction":None,"pricing_model":"charter_area_surcharge","pickup_surcharge":10000,"dropoff_surcharge":10000,"waypoint_surcharge":10000,"valid_from":pr["today"],"valid_to":None,"status":"enabled"}]
    if upd or create:
        st,b=req("POST",f"/tenant/v1/products/{CH}/price-rules/batch",{"create":create,"update":upd,"delete":[]},{"if-match":f'"{ver(CH)}"',"idempotency-key":str(uuid.uuid4())}); ok(st,b,"价格规则"); print("rules",st,len(upd),len(create))
    st,b=req("POST",f"/tenant/v1/products/{CH}/qa-list",{}); print("qa-list",st,b.get("status"))
    st,pr=req("GET",f"/tenant/v1/products/{CH}/price-rules")
    for r in pr["items"]: print(" rule",r["pricing_model"],r.get("package_hours"),r.get("package_price"),r.get("package_km"),r.get("over_km_per_km"),r.get("overtime_per_hour"),r.get("pickup_surcharge"),r.get("dropoff_surcharge"),r.get("waypoint_surcharge"),r["status"],r["area_id"][:8])
else:
    st,b=req("POST",f"/tenant/v1/products/{CH}/unpublish",{}); print("unpublish",st,b.get("status"))
    st,pr=req("GET",f"/tenant/v1/products/{CH}/price-rules")
    upd=[]
    for r in pr["items"]:
        if r["status"]!="disabled":
            x={k:v for k,v in r.items() if k not in ("base","created_at","updated_at")}; x["status"]="disabled"; upd.append(x)
    if upd: st,b=req("POST",f"/tenant/v1/products/{CH}/price-rules/batch",{"create":[],"update":upd,"delete":[]},{"if-match":f'"{ver(CH)}"',"idempotency-key":str(uuid.uuid4())}); print("rules off",st)
    for a in (TOKYO, ids.get("fuji_area")):
        if a: st,b=req("POST",f"/tenant/v1/areas/{a}/disable",{}); print("area off",st)
