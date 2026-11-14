import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalFreeWaitMinutes, bookTabOf, decodePolyline, guestCurrencyOf, moneyDifference, parseBookingLink, pointName, referenceMoney, rejectionTexts, routeMapSize, routeSummaryText, seatPlan, suggestionNames, travellersText } from "./book-new.ts";

test("链接参数：编码、「纬度,经度」加名称、日期、时间、人数、行李都合法时全部读出", () => {
  assert.deepEqual(parseBookingLink("?from=NRT&to=35.6895,139.6917&to_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&date=2030-11-20&time=14:30&pax=2&bags=3"), {
    from: { kind: "code", code: "NRT" },
    to: { kind: "point", lat: 35.6895, lng: 139.6917, name: "京王广场酒店" },
    date: "2030-11-20",
    time: "14:30",
    passengers: 2,
    luggage: 3,
    mode: null,
    draft: null,
  });
  // 旧 /book 的包车跳过来（M8-15）
  assert.equal(parseBookingLink("?mode=charter").mode, "charter");
});

test("链接参数：不合法的那一项为 null（不预填、不报错），其余照常", () => {
  const link = parseBookingLink("?from=91,10&to=%3Cscript%3E&date=2030-02-30&time=25:00&pax=0&bags=61");
  assert.deepEqual(link, { from: null, to: null, date: null, time: null, passengers: null, luggage: null, mode: null, draft: null });
  assert.deepEqual(parseBookingLink(""), { from: null, to: null, date: null, time: null, passengers: null, luggage: null, mode: null, draft: null });
  assert.equal(parseBookingLink("?mode=bus").mode, null);
  assert.deepEqual(parseBookingLink("?from=35.1,139.2&from_name=%20%20&pax=60&bags=0").from, { kind: "point", lat: 35.1, lng: 139.2, name: null });
  assert.equal(parseBookingLink("?pax=60&bags=0").passengers, 60);
  assert.equal(parseBookingLink("?pax=2.5").passengers, null);
});

test("链接里的预订草稿编号（M9E-01）：43 个 base64url 字符才认，认了之后其余参数一律不看；写法不对按没带", () => {
  const id = "aZ09_-".repeat(7) + "x";
  assert.deepEqual(parseBookingLink(`?draft=${id}&from=NRT&date=2030-11-20&mode=charter&pax=3`), { from: null, to: null, date: null, time: null, passengers: null, luggage: null, mode: null, draft: id });
  for (const bad of ["short", `${id}A`, `${id.slice(0, 42)}=`, ""]) {
    const link = parseBookingLink(`?draft=${encodeURIComponent(bad)}&from=NRT&pax=3`);
    assert.equal(link.draft, null, bad);
    assert.deepEqual(link.from, { kind: "code", code: "NRT" }, "编号不对时旧参数照旧");
    assert.equal(link.passengers, 3);
  }
});

test("链接里的 mode（M8-33）：区间 transfer 和 M8-27 的旧值 airport、p2p 都落到区间；charter 包车；别的值为 null", () => {
  assert.deepEqual(["transfer", "airport", "p2p", "charter", "bus", null].map((value) => bookTabOf(value)), ["transfer", "transfer", "transfer", "charter", null, null]);
  assert.equal(parseBookingLink("?mode=airport").mode, "transfer");
  assert.equal(parseBookingLink("?mode=p2p").mode, "transfer");
  assert.deepEqual(["?type=airport", "?type=p2p", "?type=charter", "?mode=charter&type=airport"].map((search) => parseBookingLink(search).mode), ["transfer", "transfer", "charter", "charter"], "参数名 type 也认，mode 优先");
});

test("接机提示的免费等待（M8-33）：有报价按所选商品自己设的（无限为 null）；没有报价时国际线 90、国内线 / 都有 / 没标明 60", () => {
  assert.equal(arrivalFreeWaitMinutes({ free_wait_minutes: 120 }, "international"), 120);
  assert.equal(arrivalFreeWaitMinutes({ free_wait_minutes: 45 }, "domestic"), 45);
  assert.equal(arrivalFreeWaitMinutes({ free_wait_minutes: null }, "international"), null);
  assert.deepEqual((["international", "domestic", "mixed", null] as const).map((scope) => arrivalFreeWaitMinutes(null, scope)), [90, 60, 60, 60]);
});

test("乘客 / 行李栏的写法", () => {
  assert.equal(travellersText(2, 2), "2 人 · 2 件");
});

test("报不出价：三种原因按方案的说法，「没有商品」也说没有在线报价；去重；提到客服时给客服电话；不显示内部代码", () => {
  assert.deepEqual(rejectionTexts(["LEAD_TIME_TOO_SHORT"]), { texts: ["时间太近，请选更晚的时间或联系客服"], support: true });
  assert.deepEqual(rejectionTexts(["CAPACITY_EXCEEDED", "CAPACITY_EXCEEDED"]), { texts: ["人数或行李超过所有车型，可以分两辆车预订或联系客服"], support: true });
  assert.deepEqual(rejectionTexts(["OUT_OF_SERVICE_AREA", "NO_PRODUCT"]), { texts: ["这个地址暂时没有在线报价，请联系客服"], support: true });
  assert.deepEqual(rejectionTexts(["SOLD_OUT"]), { texts: ["这一天已经订满了，请换一天。"], support: false });
  assert.equal(rejectionTexts([]).texts.length, 1);
  // M9W-10：其他原因不再让客人「换一个时间」，转人工报价（给客服电话）；没有原因时同样
  assert.deepEqual(rejectionTexts(["NOT_AVAILABLE"]), { texts: ["这个行程暂时无法在线报价，请联系客服人工报价，或调整行程后再试。"], support: true });
  assert.deepEqual(rejectionTexts([]), rejectionTexts(["NOT_AVAILABLE"]));
  assert.doesNotMatch(JSON.stringify(rejectionTexts(["NOT_AVAILABLE"])), /换一个时间/);
  assert.doesNotMatch(JSON.stringify(rejectionTexts(["LEAD_TIME_TOO_SHORT", "OUT_OF_SERVICE_AREA", "CAPACITY_EXCEEDED", "NO_ROUTE"])), /[A-Z]{2,}_[A-Z]/);
});

test("座位示意图：乘客座位编号 1–N、行李位编号 1–M，个数和最多乘客、最多行李一致；都在车身里、互不重叠", () => {
  for (const [passengers, luggage] of [[1, 0], [3, 2], [4, 2], [6, 4], [9, 9], [13, 13], [20, 0]] as const) {
    const plan = seatPlan(passengers, luggage);
    assert.deepEqual(plan.seats.map((seat) => seat.number), Array.from({ length: passengers }, (_, index) => index + 1));
    assert.deepEqual(plan.bags.map((bag) => bag.number), Array.from({ length: luggage }, (_, index) => index + 1));
    assert.equal(plan.trunkY === null, luggage === 0);
    const boxes = [plan.driver, ...plan.seats, ...plan.bags];
    for (const box of boxes) {
      assert.ok(box.x >= plan.body.x && box.y >= plan.body.y && box.x + box.width <= plan.body.x + plan.body.width && box.y + box.height <= plan.body.y + plan.body.height, `${passengers} 人 ${luggage} 件：有一格出了车身`);
    }
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${passengers} 人 ${luggage} 件：有两格重叠`);
    }
    assert.ok(plan.width <= 320, "手机上不超过一屏宽");
  }
});

test("座位示意图：前排是 1 号座位和司机；后排 2 或 3 列（7 座车 3 + 2，轿车后排 3 个）；行李在座位后面", () => {
  const minivan = seatPlan(6, 4);
  const rows = [...new Set(minivan.seats.map((seat) => seat.y))].map((y) => minivan.seats.filter((seat) => seat.y === y).length);
  assert.deepEqual(rows, [1, 3, 2]);
  assert.equal(minivan.seats[0]?.y, minivan.driver.y);
  assert.ok(minivan.driver.x > (minivan.seats[0]?.x ?? 0));
  assert.ok(Math.min(...minivan.bags.map((bag) => bag.y)) > Math.max(...minivan.seats.map((seat) => seat.y)));
  const sedan = seatPlan(4, 2);
  assert.deepEqual([...new Set(sedan.seats.map((seat) => seat.y))].map((y) => sedan.seats.filter((seat) => seat.y === y).length), [1, 3]);
});

test("路线折线：谷歌的写法解码成坐标；写法不对时为空；时间距离的说法", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
  assert.deepEqual(decodePolyline("_p~iF"), []);
  assert.deepEqual(decodePolyline(""), []);
  assert.equal(routeSummaryText(52.4, 63_420), "约 52 分钟 · 63.4 公里");
  assert.equal(routeSummaryText(10, 8_000), "约 10 分钟 · 8 公里");
});

test("合计差额：同币种整数相减；币种不同为 null", () => {
  assert.deepEqual(moneyDifference({ amount: "23500", currency: "JPY" }, { amount: "22000", currency: "JPY" }), { amount: "1500", currency: "JPY" });
  assert.deepEqual(moneyDifference({ amount: "10.05", currency: "USD" }, { amount: "9.10", currency: "USD" }), { amount: "0.95", currency: "USD" });
  assert.equal(moneyDifference({ amount: "1", currency: "JPY" }, { amount: "1", currency: "USD" }), null);
});

test("参考价：按汇率换到客人币种的最小单位，四舍五入；不可用、币种对不上为 null", () => {
  const ref = (rate: string | null, to = "CNY", available = true) => ({ available, from: "JPY", to, rate });
  assert.deepEqual(referenceMoney({ amount: "22000", currency: "JPY" }, ref("0.047351")), { amount: "1041.72", currency: "CNY" });
  assert.deepEqual(referenceMoney({ amount: "22000", currency: "JPY" }, ref("9.12", "KRW")), { amount: "200640", currency: "KRW" });
  assert.equal(referenceMoney({ amount: "22000", currency: "JPY" }, ref(null, "CNY", false)), null);
  assert.equal(referenceMoney({ amount: "22000", currency: "USD" }, ref("0.05")), null);
});

test("客人币种：先看地区再看语言，认不出来用美元", () => {
  assert.equal(guestCurrencyOf(["zh-CN", "en"]), "CNY");
  assert.equal(guestCurrencyOf(["zh-HK"]), "HKD");
  assert.equal(guestCurrencyOf(["zh-Hant"]), "TWD");
  assert.equal(guestCurrencyOf(["ko"]), "KRW");
  assert.equal(guestCurrencyOf(["en-SG"]), "SGD");
  assert.equal(guestCurrencyOf(["fr-FR", "de"]), "USD");
});

test("路线图要多大的图（M8-10）：按框的实际宽高取整、收进接口范围（宽 200–640、高 150–640）；像素比大于 1 要 2 倍", () => {
  assert.deepEqual(routeMapSize(318.6, 198, 1), { width: 319, height: 198, scale: 1 });
  assert.deepEqual(routeMapSize(120, 90, 2), { width: 200, height: 150, scale: 2 });
  assert.deepEqual(routeMapSize(900, 800, 1.5), { width: 640, height: 640, scale: 2 });
  assert.deepEqual(routeMapSize(0, 0, 3), { width: 200, height: 150, scale: 2 });
  assert.deepEqual(routeMapSize(Number.NaN, Number.POSITIVE_INFINITY, 0.9), { width: 200, height: 150, scale: 1 });
});

test("M8-20 询价带的地点名称：只有从地址联想选的那一端才有，名称最多 200 字，空白的不带", () => {
  const picked = { name: "京王广场酒店（东京都新宿区）", lat: 35.69, lng: 139.69, kind: "other" as const, suggestionName: "京王广场酒店" };
  const typed = { name: pointName(35.6, 139.7), lat: 35.6, lng: 139.7, kind: null };
  assert.deepEqual(suggestionNames(picked, typed), { pickup_name: "京王广场酒店" });
  assert.deepEqual(suggestionNames(typed, picked), { dropoff_name: "京王广场酒店" });
  assert.deepEqual(suggestionNames(null, { ...picked, suggestionName: "  " }), {});
  assert.equal(suggestionNames({ ...picked, suggestionName: "长".repeat(250) }, null).pickup_name?.length, 200);
});
