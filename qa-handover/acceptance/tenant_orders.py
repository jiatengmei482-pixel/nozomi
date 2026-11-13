from setup import *
ids=json.load(open("ids.json"))
nos={l.split("\t")[0]:l.split("\t")[1].replace("订单 ","") for l in open(".orders").read().strip().split("\n")}
st,lst=req("GET","/tenant/v1/orders?limit=50")
byno={o.get("order_no") or o.get("number"):o for o in lst.get("items",[])}
res={}
for k,no in sorted(nos.items()):
    o=byno.get(no)
    if not o: print(k,no,"NOT IN TENANT LIST",list(byno)[:3]); continue
    st,d=req("GET",f"/tenant/v1/orders/{o['id']}")
    od=d["order"]
    keys=set(json.dumps(d))
    print(k,no,od["status"],"basis=",d["pricing_basis"],"mileage=",json.dumps(d["mileage"],ensure_ascii=False),"route=",json.dumps(d["pricing_route"],ensure_ascii=False)[:250],"surcharge=",json.dumps(d["area_surcharge"],ensure_ascii=False)[:300])
    print("   settle/sign:",{x:od.get(x) for x in ("settlement_price","settle_amount","price","sign_name","rider_name","flight_no","is_acceptance") if x in od})
    dump=json.dumps(d)
    print("   leak check sell/markup:",[w for w in ("sell","markup","sell_minor","markup_bp") if w in dump])
    res[k]={"id":o["id"],"version":od.get("version")}
json.dump(res,open("tenant_orders.json","w"))
