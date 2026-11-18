import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_AIRPORT_COPY, charterAirportText, quoteScenario, scenarioPackageLabel } from "./charter-airport-copy.ts";
import { breakdownLines } from "./charter-itinerary.ts";

const yen = (amount: number) => ({ amount: String(amount), currency: "JPY" });
const NARITA = { kind: "airport_start" as const, airport_id: "nrt", airport_name: "成田机场" };

test("机场套餐文案（ADR 0098 第三节第 5 小节）：key 表只有中文，变量替换", () => {
  assert.equal(charterAirportText("book.notes.flightHint"), "如需司机知道航班号，请填在这里");
  assert.equal(scenarioPackageLabel(NARITA, 5), "成田机场接机 + 5 小时包车");
  assert.equal(scenarioPackageLabel({ kind: "airport_end", airport_name: "羽田机场" }, 5), "5 小时包车 + 羽田机场送机");
  for (const text of Object.values(CHARTER_AIRPORT_COPY)) assert.match(text, /[一-鿿]/);
});

test("明细套餐行显示场景名；单独定价时没有上车加价那一行（接口本来就不给）；没有场景时照旧", () => {
  const own = { price: { total: yen(49_500), fx: null }, price_breakdown: [{ kind: "base" as const, amount: yen(49_500), area_name: null, stop_seqs: null, scenario: NARITA }] };
  assert.deepEqual(breakdownLines(own, 5)?.map((line) => [line.label, line.amount]), [["成田机场接机 + 5 小时包车", "49,500 JPY"]]);
  assert.deepEqual(quoteScenario(own), NARITA);
  const plain = { price: { total: yen(36_300), fx: null }, price_breakdown: [{ kind: "base" as const, amount: yen(36_300), area_name: null, stop_seqs: null }] };
  assert.equal(breakdownLines(plain, 5)?.[0]?.label, "包车套餐 5 小时");
  assert.equal(quoteScenario(plain), null);
});
