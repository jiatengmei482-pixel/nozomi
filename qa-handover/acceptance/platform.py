import sys,os,json; sys.path.insert(0,os.path.expanduser("~/nozomi-wt/tools"))
from qa_api import login, call
t=login()
nos={l.split("\t")[0]:l.split("\t")[1].replace("订单 ","") for l in open(".orders").read().strip().split("\n")}
st,lst=call("GET","/platform/v1/orders?limit=50&tenant_id=0d8d8c1a-779c-4689-8429-36be3fa58070",token=t)
print("list",st,len(lst.get("items",[])))
byno={o["order_no"]:o for o in lst.get("items",[])}
out={}
for k,no in sorted(nos.items()):
    o=byno.get(no)
    if not o: print(k,"not found"); continue
    st,d=call("GET",f"/platform/v1/orders/{o['id']}",token=t)
    od=d.get("order",d)
    print(k,no,"is_acceptance=",od.get("is_acceptance",d.get("is_acceptance")),"basis=",d.get("pricing_basis"),"status=",od.get("status"))
    print("   km=",json.dumps(d.get("km") or od.get("km"),ensure_ascii=False), "mileage=",json.dumps(d.get("mileage"),ensure_ascii=False)[:200])
    print("   sell=",json.dumps(od.get("sell") or od.get("price"),ensure_ascii=False)[:300])
    out[k]=o["id"]
json.dump(out,open("platform_ids.json","w"))
