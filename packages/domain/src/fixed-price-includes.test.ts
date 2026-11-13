import { test } from "node:test";
import assert from "node:assert/strict";
import { DISTANCE_ONLY_FEE_NOTES } from "./distance-price.ts";
import { CHARTER_SUPPLIER_PRICE_NOTE, FIXED_PRICE_INCLUDES_TEXTS, FIXED_PRICE_RULES, fixedPriceFeeNote, fixedPriceIncludes, fixedPriceIncludesTitle, fixedPriceLabel } from "./fixed-price-includes.ts";

const texts = (items: { text: string }[]): string[] => items.map((item) => item.text);

test("接机：含所有费用、专车、航班落地后免费等待 N 分钟（N 取报价）；没有举牌时不写举牌", () => {
  assert.deepEqual(texts(fixedPriceIncludes({ service: "transfer", arrival: true, freeWaitMinutes: 60, meetAndGreet: false })), [
    "一口价已含所有费用（高速费、停车费等），无需另付",
    "专车专用，不拼车",
    "航班落地后免费等待 60 分钟",
  ]);
});

test("送机、点对点：免费等待不说航班落地；中标商品包含举牌时写举牌", () => {
  assert.deepEqual(texts(fixedPriceIncludes({ service: "transfer", arrival: false, freeWaitMinutes: 15, meetAndGreet: true })), [
    "一口价已含所有费用（高速费、停车费等），无需另付",
    "专车专用，不拼车",
    "举牌接机",
    "免费等待 15 分钟",
  ]);
});

test("包车：一口价全含（M8-09 起默认写「含所有费用」）；传 false 时不写；免费等待是 0 或不限时都不写", () => {
  assert.equal(FIXED_PRICE_RULES.charterAllInclusive, true);
  assert.deepEqual(texts(fixedPriceIncludes({ service: "charter", arrival: false, freeWaitMinutes: 0, meetAndGreet: false })), ["一口价已含所有费用（高速费、停车费等），无需另付", "专车专用，不拼车"]);
  assert.deepEqual(texts(fixedPriceIncludes({ service: "charter", arrival: false, freeWaitMinutes: null, meetAndGreet: false, charterAllInclusive: false })), ["专车专用，不拼车"]);
});

test("费用说明：接送机只写含所有费用；包车再接「超出套餐的时长和公里服务后按实际收取」；供应商侧写明报价须含高速、停车", () => {
  assert.equal(fixedPriceFeeNote("transfer"), "一口价已含所有费用（高速费、停车费等），无需另付");
  assert.equal(fixedPriceFeeNote("charter"), "一口价已含所有费用（高速费、停车费等），无需另付；超出套餐的时长和公里服务后按实际收取");
  assert.match(fixedPriceFeeNote("charter", "en"), /^All-inclusive fixed price .*; Time and distance beyond the package/);
  assert.match(CHARTER_SUPPLIER_PRICE_NOTE, /包车报价须包含高速费、停车费/);
});

test("费用说明（M9W-05）：按行程计价的包车写超公里、超时已算进价格、只有当天超出预计的另收；不按行程计价和接送机完全不变", () => {
  assert.equal(fixedPriceFeeNote("charter", "zh", { itinerary: true }), "一口价已含所有费用（高速费、停车费等），无需另付；超公里、超时已按预计行程算进价格，只有当天超出预计的部分服务后按实际收取");
  assert.match(fixedPriceFeeNote("charter", "en", { itinerary: true }), /; Extra distance and time for the planned itinerary are already included; only usage beyond the plan/);
  assert.match(fixedPriceFeeNote("charter", "ja", { itinerary: true }), /予定の行程で料金に含まれています/);
  for (const language of ["zh", "ja", "en"] as const) {
    assert.equal(fixedPriceFeeNote("charter", language, { itinerary: false }), fixedPriceFeeNote("charter", language));
    assert.equal(fixedPriceFeeNote("transfer", language, { itinerary: true }), fixedPriceFeeNote("transfer", language));
    assert.doesNotMatch(fixedPriceFeeNote("charter", language, { itinerary: true }), /超出套餐|beyond the package|パッケージを超えた/);
  }
});

test("三语原文（ADR 0069）；任何语言都没有「跟踪航班」", () => {
  const ja = texts(fixedPriceIncludes({ service: "transfer", arrival: true, freeWaitMinutes: 90, meetAndGreet: true }, "ja"));
  assert.deepEqual(ja, ["高速料金・駐車料金などすべて込みの定額料金で、追加のお支払いはありません", "専用車（相乗りなし）", "ネームボードでお出迎え", "着陸後 90 分間の無料待機"]);
  const en = texts(fixedPriceIncludes({ service: "transfer", arrival: false, freeWaitMinutes: 30, meetAndGreet: false }, "en"));
  assert.deepEqual(en, ["All-inclusive fixed price — tolls, parking and other fees included, nothing extra to pay", "Private car, no sharing", "30 minutes of free waiting"]);
  for (const language of ["zh", "ja", "en"] as const) {
    const all = JSON.stringify(FIXED_PRICE_INCLUDES_TEXTS[language]) + texts(fixedPriceIncludes({ service: "transfer", arrival: true, freeWaitMinutes: 60, meetAndGreet: true }, language)).join();
    assert.doesNotMatch(all, /跟踪航班|航班跟踪|フライト追跡|flight track/i);
  }
});

test("按里程计价（M8-40）：标题和「含所有费用」那一条都换成不带「一口价」的说法，其余条目不变；一口价、含里程费、不传照旧", () => {
  const input = { service: "transfer", arrival: true, freeWaitMinutes: 60, meetAndGreet: false } as const;
  const plain = texts(fixedPriceIncludes(input));
  for (const basis of [undefined, null, "one_price", "one_price_outside_km"] as const) {
    assert.deepEqual(texts(fixedPriceIncludes({ ...input, pricingBasis: basis })), plain);
    assert.equal(fixedPriceIncludesTitle(basis), "一口价包含");
    assert.equal(fixedPriceLabel(basis), "一口价");
  }
  assert.equal(fixedPriceLabel("distance_only"), "车费");
  assert.deepEqual(texts(fixedPriceIncludes({ ...input, pricingBasis: "distance_only" })), ["车费已含高速费、停车费等，无需另付", ...plain.slice(1)]);
  assert.equal(fixedPriceIncludesTitle("distance_only"), "车费包含");
  for (const language of ["zh", "ja", "en"] as const) {
    const items = fixedPriceIncludes({ ...input, pricingBasis: "distance_only" }, language);
    assert.deepEqual(items[0], { key: "all_inclusive", text: DISTANCE_ONLY_FEE_NOTES[language] });
    assert.doesNotMatch(`${fixedPriceIncludesTitle("distance_only", language)} ${fixedPriceLabel("distance_only", language)} ${items[0]?.text}`, /一口价|定額|fixed price/i);
  }
});
