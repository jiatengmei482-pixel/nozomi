# 司机、车辆临时启用 / 停用（只写 QA 测试供应商）。用法：python3 fleet_toggle.py on|off
import sys
from setup import *
ids=json.load(open("ids.json")); on=sys.argv[1]=="on"
for kind,key,st_on in (("drivers","driver","active"),("vehicles","vehicle","available")):
    st,d=req("GET",f"/tenant/v1/{kind}/{ids[key]}")
    body={k:v for k,v in d.items() if k not in ("id","version","created_at","updated_at","email_masked","license_state","is_new","insurance_state","inspection_state")}
    body["status"]=st_on if on else "disabled"
    st,b=req("PUT",f"/tenant/v1/{kind}/{ids[key]}",body,{"if-match":f'"{d["version"]}"'}); print(kind,st,b.get("status") if st<300 else b)
