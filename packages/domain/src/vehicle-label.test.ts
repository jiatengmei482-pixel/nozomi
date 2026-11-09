import { test } from "node:test";
import assert from "node:assert/strict";
import { VEHICLE_LABEL_TEXTS, vehicleLabel, vehicleLabelLines } from "./vehicle-label.ts";

const alphard = { sample_models: ["Toyota Alphard", "Toyota Vellfire"], combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] };

test("4 项：代表车型取第一个；同级说明是「X, Y or similar」；最多乘客、最多行李各取组合里的最大值", () => {
  assert.deepEqual(vehicleLabel(alphard), { representative: "Toyota Alphard", similar: "Toyota Alphard, Toyota Vellfire or similar", maxPassengers: 6, maxLuggage: 5 });
});

test("只有一个代表车型：同级说明「X or similar」；首尾空白和空项去掉", () => {
  assert.deepEqual(vehicleLabel({ sample_models: ["  Toyota Camry ", ""], combos: [{ passengers: 4, luggage: 2 }] }), { representative: "Toyota Camry", similar: "Toyota Camry or similar", maxPassengers: 4, maxLuggage: 2 });
});

test("没填代表车型：①② 为空、不编造；组合为空（数据异常）时 ③④ 也为空", () => {
  assert.deepEqual(vehicleLabel({ sample_models: [], combos: [] }), { representative: null, similar: null, maxPassengers: null, maxLuggage: null });
});

test("显示行：中文、日文、英文三套标签；空的项不出现；顺序固定", () => {
  assert.deepEqual(vehicleLabelLines(alphard), [
    { label: "代表车型", value: "Toyota Alphard" },
    { label: "同级车型", value: "Toyota Alphard, Toyota Vellfire or similar" },
    { label: "最多乘客", value: "6 人" },
    { label: "最多行李", value: "5 件" },
  ]);
  assert.deepEqual(vehicleLabelLines(alphard, "ja").map((line) => `${line.label}:${line.value}`), ["代表車種:Toyota Alphard", "同等クラスの車種:Toyota Alphard, Toyota Vellfire or similar", "最大乗車人数:6名", "最大荷物数:5個"]);
  assert.deepEqual(vehicleLabelLines({ sample_models: [], combos: [{ passengers: 1, luggage: 1 }] }, "en"), [
    { label: "Max passengers", value: "1 passenger" },
    { label: "Max luggage", value: "1 bag" },
  ]);
  for (const language of ["zh", "ja", "en"] as const) assert.equal(Object.keys(VEHICLE_LABEL_TEXTS[language]).length, 7);
});

test("行李尺寸（ADR 0069 B13）：三语原文，只是说明文字，不进 4 项显示行", () => {
  assert.deepEqual([VEHICLE_LABEL_TEXTS.zh.luggageBasis, VEHICLE_LABEL_TEXTS.ja.luggageBasis, VEHICLE_LABEL_TEXTS.en.luggageBasis], ["行李按 28 寸行李箱计", "28インチのスーツケース換算", "based on 28-inch suitcases"]);
  assert.ok(vehicleLabelLines(alphard).every((line) => !line.value.includes("28")));
});
