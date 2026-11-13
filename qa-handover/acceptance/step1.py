from setup import *
CITY="a6c1d2e6-37cf-4b84-b8b6-bb35e4266ba3"; NRT="38a2a0f7-702c-4559-96e5-e1c6a6ce75c5"; VG="546a3098-6dd5-470f-ac60-039eb8be83da"; BRAND="f4e7dca8-7404-4ffa-88b7-ebb4f92a0f2a"
P2P="dae3db20-5df8-4e99-86e3-02b2978a5cf9"; CH="b621e14e-558a-4bd9-9532-98b695bc5ea7"
ids={}
# 1 启用旧区域（千叶市不用）
for a in ["a2fef668-74b1-47cd-9763-b81631dde50e","fbe96e58-2e19-489a-9360-837806d50e7e","16ed44a9-8318-4d56-850e-8a7092c2c4d8","454c6572-5251-41cd-ba40-eb4596291d92","c7cce821-ee16-4878-ac64-f7f3a9c260eb","bf94606a-53db-4d4a-b3c3-9f1b35dd8896"]:
    st,b=req("POST",f"/tenant/v1/areas/{a}/enable",{}); ok(st,b,"启用区域"); print("enabled",b["name"]["zh"],b["status"])
# 2 接送机区域（运营 + 报价，新宿同一块）
st,b=req("POST","/tenant/v1/areas",{"city_id":CITY,"name":{"zh":"QA-新宿接送机（M8-14 验收）"},"biz_type":"airport_transfer","role":"both","polygons":[{"kind":"operate","geometry":{"type":"Polygon","coordinates":[[[139.675,35.67],[139.725,35.67],[139.725,35.71],[139.675,35.71],[139.675,35.67]]]}}]},{"idempotency-key":str(uuid.uuid4())})
ids["airport_area"]=ok(st,b,"新建区域")["id"]; print("area",ids["airport_area"])
json.dump(ids,open("ids.json","w"))
