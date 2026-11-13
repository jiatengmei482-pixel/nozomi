from setup import *
ids=json.load(open("ids.json"))
CITY="a6c1d2e6-37cf-4b84-b8b6-bb35e4266ba3"; VG="a8aab36e-f711-4ff6-b0fc-906db43bfef2"
SJ="454c6572-5251-41cd-ba40-eb4596291d92"; NA="c7cce821-ee16-4878-ac64-f7f3a9c260eb"
def ver(pid): return req("GET",f"/tenant/v1/products/{pid}")[1]["version"]
if "usd_brand" not in ids:
    st,b=req("POST","/tenant/v1/brands",{"name":"QA验收品牌USD（M8-14）","currency":"USD"},{"idempotency-key":str(uuid.uuid4())})
    ids["usd_brand"]=ok(st,b,"子品牌")["id"]; json.dump(ids,open("ids.json","w"))
if "usd_product" not in ids:
    st,b=req("POST","/tenant/v1/products",{"brand_id":ids["usd_brand"],"city_id":CITY,"category":"point_to_point","areas":[{"area_id":SJ},{"area_id":NA}],"vehicle_groups":[{"vehicle_group_id":VG,"passengers":3,"luggage":2}],"dispatchers":[{"name":"QA 调度（验收专用）","phone":"+81 90-0000-0000"}]},{"idempotency-key":str(uuid.uuid4())})
    ids["usd_product"]=ok(st,b,"美元商品")["id"]; json.dump(ids,open("ids.json","w")); print("usd product",b.get("code"))
P=ids["usd_product"]
RULES={"booking":{"sale_from":None,"sale_to":None,"service_time":{"start":"00:00","end":"24:00"},"lead_time_hours":0,"note":None},"urgent":{"enabled":False,"daily_quota":None,"tiers":[]},"night":{"enabled":False,"window":None,"amount":None,"charge_unit":None},"free_wait":{"pickup":None,"dropoff":None,"general":{"mode":"limited","minutes":30}},"addons":[],"driver_languages":[]}
st,b=req("PUT",f"/tenant/v1/products/{P}/service-rules",RULES,{"if-match":f'"{ver(P)}"'}); ok(st,b,"服务规则")
st,b=req("PUT",f"/tenant/v1/products/{P}/content",{"zh":{"title":"QA 验收测试点对点 USD（M8-14 跨币种，验收专用）"}},{"if-match":f'"{ver(P)}"'}); ok(st,b,"内容")
st,pr=req("GET",f"/tenant/v1/products/{P}/price-rules")
if not pr["items"]:
    E0={"package_hours":None,"start_price":None,"start_meters":None,"start_minutes":None,"per_km":None,"per_minute":None,"min_price":None,"package_km":None,"package_price":None,"overtime_per_hour":None,"over_km_per_km":None}
    cr=[{**E0,"ref":"r1","area_id":SJ,"to_area_id":NA,"vehicle_group_id":VG,"direction":None,"pricing_model":"fixed","base_price":13000,"included_km":30,"over_km_per_km":200,"valid_from":pr["today"],"valid_to":None,"status":"enabled"},
        {**E0,"ref":"r2","area_id":SJ,"vehicle_group_id":VG,"direction":None,"pricing_model":"fixed","base_price":4000,"valid_from":pr["today"],"valid_to":None,"status":"enabled"},
        {**E0,"ref":"r3","area_id":NA,"vehicle_group_id":VG,"direction":None,"pricing_model":"fixed","base_price":4000,"valid_from":pr["today"],"valid_to":None,"status":"enabled"}]
    st,b=req("POST",f"/tenant/v1/products/{P}/price-rules/batch",{"create":cr,"update":[],"delete":[]},{"if-match":f'"{ver(P)}"',"idempotency-key":str(uuid.uuid4())}); ok(st,b,"美元价格")
st,b=req("POST",f"/tenant/v1/products/{P}/qa-list",{}); print("qa-list",st,b.get("status") if st<300 else b)
if "vehicle_cmf" not in ids:
    st,b=req("POST","/tenant/v1/vehicles",{"plate":"品川 500 あ 14-15","vehicle_group_id":VG,"model":"Toyota Crown","color":"黑","seats":5,"mileage_km":30000,"plate_type":"business","insurance_expires_on":"2030-12-31","inspection_expires_on":"2030-12-31"},{"idempotency-key":str(uuid.uuid4())})
    ids["vehicle_cmf"]=ok(st,b,"车辆")["id"]
json.dump(ids,open("ids.json","w")); print(ids)
