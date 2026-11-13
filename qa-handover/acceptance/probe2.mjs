import { open, P } from "./pw.mjs";
const { browser, context } = await open();
const day = "2026-11-20";
const yoyogi = { lat: 35.683, lng: 139.702, name: "代々木駅" };
const q = async (label, a, b) => {
  const r = await context.request.post("/site/v1/quotes/by-points", { data: { pickup: a, dropoff: b, service_local: `${day}T10:00`, passengers: 2, luggage: 1 } });
  const j = await r.json();
  console.log(label, r.status(), j.trip_type, j.route?.meters, JSON.stringify((j.quotes ?? []).map((x) => [x.vehicle_group?.code, x.price?.total?.amount, x.pricing_basis, x.km ? `${x.km.included_km}/${x.km.over_km}x${x.km.over_km_per_km.amount}` : null])), JSON.stringify(j.unavailable ?? j.error)?.slice(0, 200));
};
await q("同区域 新宿→代々木", P.shinjuku, yoyogi);
await q("线路 新宿→成田駅", P.shinjuku, P.naritaSta);
await q("返程 成田駅→新宿", P.naritaSta, P.shinjuku);
await q("送机 新宿→NRT", P.shinjuku, P.nrt);
const cities = await (await context.request.get("/site/v1/cities")).json();
const tokyo = cities.items.find((c) => c.name.zh === "东京");
const ll = (x) => ({ lat: x.lat, lng: x.lng });
const c = async (label, a, b) => {
  const r = await context.request.post("/site/v1/quotes", { data: { category: "charter", city_id: tokyo.id, pickup: ll(a), ...(b ? { dropoff: ll(b) } : {}), package_hours: 8, service_local: `${day}T09:00`, passengers: 2, luggage: 1 } });
  const j = await r.json();
  console.log(label, r.status(), JSON.stringify((j.quotes ?? []).map((x) => [x.vehicle_group?.code, x.price?.total?.amount, x.includes_area_surcharge])), JSON.stringify(j.unavailable ?? j.error)?.slice(0, 250));
};
await c("包车 新宿→渋谷", P.shinjuku, P.shibuya);
await c("包车 千葉→新宿", P.chiba, P.shinjuku);
await c("包车 新宿→八王子", P.shinjuku, P.hachioji);
await c("包车 千葉→軽井沢", P.chiba, P.karuizawa);
await c("包车 不给下车点", P.shinjuku, null);
await browser.close();
