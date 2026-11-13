from setup import *
ids=json.load(open("ids.json"))
P2P="dae3db20-5df8-4e99-86e3-02b2978a5cf9"; CH="b621e14e-558a-4bd9-9532-98b695bc5ea7"
prods=[ids["airport_product"],P2P,CH,ids["usd_product"]]
def ver(pid): return req("GET",f"/tenant/v1/products/{pid}")[1]["version"]
for pid in prods:
    st,b=req("POST",f"/tenant/v1/products/{pid}/unpublish",{}); print("unpublish",pid[:4],st,b.get("status") if st<300 else b)
    st,pr=req("GET",f"/tenant/v1/products/{pid}/price-rules")
    upd=[]
    for r in pr["items"]:
        if r["status"]!="disabled":
            x={k:v for k,v in r.items() if k not in ("base","created_at","updated_at")}; x["status"]="disabled"; upd.append(x)
    if upd:
        st,b=req("POST",f"/tenant/v1/products/{pid}/price-rules/batch",{"create":[],"update":upd,"delete":[]},{"if-match":f'"{ver(pid)}"',"idempotency-key":str(uuid.uuid4())}); print("rules off",pid[:4],st,len(upd))
    st,dp=req("GET",f"/tenant/v1/products/{pid}/distance-prices")
    for d in dp.get("items",[]):
        if d["status"]!="disabled":
            st,b=req("POST",f"/tenant/v1/products/{pid}/distance-prices/{d['id']}/disable",{},{"if-match":f'"{ver(pid)}"'}); print("distance off",st)
st,a=req("GET","/tenant/v1/areas?page_size=100")
for x in a["items"]:
    if x["status"]!="disabled":
        st,b=req("POST",f"/tenant/v1/areas/{x['id']}/disable",{}); print("area off",x["name"]["zh"],st)
for kind,key,status in (("drivers","driver","disabled"),("vehicles","vehicle","disabled"),("vehicles","vehicle_cmf","disabled")):
    st,d=req("GET",f"/tenant/v1/{kind}/{ids[key]}")
    body={k:v for k,v in d.items() if k not in ("id","version","created_at","updated_at","email_masked","license_state","is_new","insurance_state","inspection_state")}
    body["status"]=status
    st,b=req("PUT",f"/tenant/v1/{kind}/{ids[key]}",body,{"if-match":f'"{d["version"]}"'}); print(kind,"off",st,b.get("status") if st<300 else json.dumps(b,ensure_ascii=False)[:300])
