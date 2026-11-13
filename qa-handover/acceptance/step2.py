from setup import *
ids=json.load(open("ids.json"))
CITY="a6c1d2e6-37cf-4b84-b8b6-bb35e4266ba3"; NRT="38a2a0f7-702c-4559-96e5-e1c6a6ce75c5"; VG="546a3098-6dd5-470f-ac60-039eb8be83da"; BRAND="f4e7dca8-7404-4ffa-88b7-ebb4f92a0f2a"
P2P="dae3db20-5df8-4e99-86e3-02b2978a5cf9"; CH="b621e14e-558a-4bd9-9532-98b695bc5ea7"
def ver(pid): return req("GET",f"/tenant/v1/products/{pid}")[1]["version"]
def enable_rules(pid):
    st,pr=req("GET",f"/tenant/v1/products/{pid}/price-rules")
    upd=[]
    for r in pr["items"]:
        x={k:v for k,v in r.items() if k not in ("base","created_at","updated_at")}; x["status"]="enabled"; upd.append(x)
    st,b=req("POST",f"/tenant/v1/products/{pid}/price-rules/batch",{"create":[],"update":upd,"delete":[]},{"if-match":f'"{ver(pid)}"',"idempotency-key":str(uuid.uuid4())})
    ok(st,b,"启用价格规则"); print("rules enabled",pid[:4],len(upd))
if "airport_product" not in ids:
    st,b=req("POST","/tenant/v1/products",{"brand_id":BRAND,"city_id":CITY,"category":"airport_transfer","poi_id":NRT,"areas":[{"area_id":ids["airport_area"]}],"vehicle_groups":[{"vehicle_group_id":VG,"passengers":3,"luggage":2}],"dispatchers":[{"name":"QA 调度（验收专用）","phone":"+81 90-0000-0000"}]},{"idempotency-key":str(uuid.uuid4())})
    ids["airport_product"]=ok(st,b,"新建接送机商品")["id"]; json.dump(ids,open("ids.json","w")); print("airport product",ids["airport_product"],b.get("code"))
AP=ids["airport_product"]
RULES={"booking":{"sale_from":None,"sale_to":None,"service_time":{"start":"00:00","end":"24:00"},"lead_time_hours":0,"note":None},"urgent":{"enabled":False,"daily_quota":None,"tiers":[]},"night":{"enabled":False,"window":None,"amount":None,"charge_unit":None},"free_wait":{"pickup":{"mode":"limited","minutes":90},"dropoff":{"mode":"limited","minutes":15},"general":None},"addons":[],"driver_languages":[]}
st,b=req("PUT",f"/tenant/v1/products/{AP}/service-rules",RULES,{"if-match":f'"{ver(AP)}"'}); ok(st,b,"服务规则")
st,b=req("PUT",f"/tenant/v1/products/{AP}/content",{"zh":{"title":"QA 验收测试接送机（M8-14，验收专用）","pickup_guide":"到达大厅出口举牌等候（验收专用）"}},{"if-match":f'"{ver(AP)}"'}); ok(st,b,"内容")
st,pr=req("GET",f"/tenant/v1/products/{AP}/price-rules")
if not pr["items"]:
    EMPTY={"package_hours":None,"start_price":None,"start_meters":None,"start_minutes":None,"per_km":None,"per_minute":None,"min_price":None,"package_km":None,"package_price":None,"overtime_per_hour":None,"over_km_per_km":None}
    st,b=req("POST",f"/tenant/v1/products/{AP}/price-rules/batch",{"create":[{**EMPTY,"ref":"a","area_id":ids["airport_area"],"vehicle_group_id":VG,"direction":"both","pricing_model":"fixed","base_price":15000,"valid_from":pr["today"],"valid_to":None,"status":"enabled"}],"update":[],"delete":[]},{"if-match":f'"{ver(AP)}"',"idempotency-key":str(uuid.uuid4())}); ok(st,b,"接送机价格")
enable_rules(P2P); enable_rules(CH)
st,dp=req("GET",f"/tenant/v1/products/{P2P}/distance-prices")
if not dp["items"]:
    st,b=req("POST",f"/tenant/v1/products/{P2P}/distance-prices",{"vehicle_group_id":VG,"start_price":3000,"per_km":250,"valid_from":dp["today"],"valid_to":None,"status":"enabled"},{"if-match":f'"{ver(P2P)}"',"idempotency-key":str(uuid.uuid4())}); ok(st,b,"计程价"); print("distance price",b.get("item",b).get("id") if isinstance(b,dict) else b)
for pid in (AP,P2P,CH):
    st,b=req("POST",f"/tenant/v1/products/{pid}/qa-list",{}); print("qa-list",pid[:4],st,b.get("status") if st<300 else b)
