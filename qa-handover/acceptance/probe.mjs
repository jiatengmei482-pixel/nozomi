import { open, P } from "./pw.mjs";
const { browser, context } = await open();
const day = "2026-11-20";
const cases = { A: ["nrt", "shinjuku"], B: ["shinjuku", "kawasaki"], C: ["shibuya", "kawasaki"], E: ["karuizawa", "shinjuku"], F: ["shinjuku", "naritaSta"] };
for (const [k, [a, b]] of Object.entries(cases)) {
  const r = await context.request.post("/site/v1/quotes/by-points", { data: { pickup: P[a], dropoff: P[b], service_local: `${day}T10:00`, passengers: 2, luggage: 1 } });
  const j = await r.json();
  console.log(k, r.status(), j.trip_type, j.fallback_category, j.currency, j.route?.meters, JSON.stringify((j.quotes ?? []).map((q) => ({ vg: q.vehicle_group?.code, total: q.price?.total, basis: q.pricing_basis, km: q.km ?? q.mileage ?? q.distance ?? undefined, fx: q.price?.fx }))), JSON.stringify(j.unavailable ?? j.error ?? null)?.slice(0, 300));
}
const cities = await (await context.request.get("/site/v1/cities")).json();
const tokyo = cities.items.find((c) => c.name.zh === "东京");
const ll=(x)=>({lat:x.lat,lng:x.lng});
const r = await context.request.post("/site/v1/quotes", { data: { category: "charter", city_id: tokyo.id, pickup: ll(P.chiba), dropoff: ll(P.hachioji), package_hours: 8, service_local: `${day}T09:00`, passengers: 2, luggage: 1 } });
const j = await r.json();
console.log("D", r.status(), JSON.stringify((j.quotes ?? []).map((q) => ({ vg: q.vehicle_group?.code, total: q.price?.total, sur: q.includes_area_surcharge, basis: q.pricing_basis }))), JSON.stringify(j.unavailable ?? j.error ?? null)?.slice(0, 200));
await browser.close();
