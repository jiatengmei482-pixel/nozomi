from setup import *
ids=json.load(open("ids.json"))
VG="546a3098-6dd5-470f-ac60-039eb8be83da"
st,d=req("GET","/tenant/v1/drivers?limit=50"); print("drivers",[(x["name"],x["status"]) for x in d.get("items",[])])
st,v=req("GET","/tenant/v1/vehicles?limit=50"); print("vehicles",[(x["plate"],x["status"]) for x in v.get("items",[])])
if "driver" not in ids:
    st,b=req("POST","/tenant/v1/drivers",{"name":"QA 司机（M8-14 验收专用）","phone":"+81 90-0000-1414","email":None,"languages":["ja","zh","en"],"license_expires_on":"2030-12-31","driving_years":12,"gold":False},{"idempotency-key":str(uuid.uuid4())})
    ids["driver"]=ok(st,b,"司机")["id"]
if "vehicle" not in ids:
    st,b=req("POST","/tenant/v1/vehicles",{"plate":"品川 500 あ 14-14","vehicle_group_id":VG,"model":"Toyota Prius","color":"白","seats":5,"mileage_km":30000,"plate_type":"business","insurance_expires_on":"2030-12-31","inspection_expires_on":"2030-12-31"},{"idempotency-key":str(uuid.uuid4())})
    ids["vehicle"]=ok(st,b,"车辆")["id"]
json.dump(ids,open("ids.json","w")); print(ids)
