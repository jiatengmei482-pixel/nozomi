import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BOUNDARY_POINTS,
  COUNTRY_CODES,
  PLACE_TYPES,
  VEHICLE_GRADES,
  VEHICLE_GRADE_ABBREVIATIONS,
  addonCodeIssue,
  hasVisibleText,
  boundaryIssues,
  cityCodeIssue,
  isCountryCode,
  isIanaTimeZone,
  isIataCode,
  isLatitude,
  isLongitude,
  placeAttributeIssues,
  placeCodeIssue,
  placeEnableBlocker,
  requiredParentType,
  roundCoordinate,
  vehicleComboIssues,
  vehicleGroupCodeIssue,
} from "./master-data.ts";

test("国家码：只认 ISO 3166-1 的两位大写代码（外加科索沃 XK）", () => {
  for (const code of ["JP", "KR", "CN", "US", "GB", "XK"]) assert.equal(isCountryCode(code), true, code);
  for (const code of ["jp", "JPN", "UK", "EU", "ZZ", "XX", "", "J", " JP"]) assert.equal(isCountryCode(code), false, code);
});

test("时区：只认「大洲/城市」写法的 IANA 时区名", () => {
  for (const zone of ["Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "America/New_York", "America/Argentina/Buenos_Aires", "Asia/Kolkata", "Asia/Ho_Chi_Minh"]) {
    assert.equal(isIanaTimeZone(zone), true, zone);
  }
  for (const zone of ["JST", "UTC", "+09:00", "GMT+9", "Etc/GMT-9", "asia/tokyo", "ASIA/TOKYO", "Asia/Nowhere", "Asia/", "Tokyo", "", "Asia/Tokyo ", "Asia/Tokyo; drop table"]) {
    assert.equal(isIanaTimeZone(zone), false, zone);
  }
});

test("坐标：范围检查和保留 6 位小数", () => {
  assert.equal(isLongitude(180), true);
  assert.equal(isLongitude(-180), true);
  assert.equal(isLongitude(180.000001), false);
  assert.equal(isLongitude(Number.NaN), false);
  assert.equal(isLatitude(90), true);
  assert.equal(isLatitude(-90.1), false);
  assert.equal(isLatitude(Number.POSITIVE_INFINITY), false);
  assert.equal(roundCoordinate(139.78695849999), 139.786958);
  assert.equal(roundCoordinate(35.5496785), 35.549679);
  assert.ok(Object.is(roundCoordinate(-0.0000004), 0), "取整得到的负零归一成 0");
  assert.ok(Object.is(roundCoordinate(-0), 0));
  assert.equal(roundCoordinate(139.786958), 139.786958);
});

test("城市边界：沿用多边形校验，并限制顶点总数", () => {
  const square: [number, number][] = [[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]];
  assert.deepEqual(boundaryIssues({ type: "Polygon", coordinates: [square] }), []);
  assert.deepEqual(boundaryIssues({ type: "MultiPolygon", coordinates: [[square], [square]] }), []);
  assert.notDeepEqual(boundaryIssues({ type: "Polygon", coordinates: [square.slice(0, 4)] }), []);
  assert.notDeepEqual(boundaryIssues({ type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 95], [139, 35]]] }), []);
  assert.notDeepEqual(boundaryIssues({ type: "Polygon", coordinates: [] }), []);
  const huge: [number, number][] = Array.from({ length: MAX_BOUNDARY_POINTS + 1 }, (_, i) => [100 + i / 1e5, 30]);
  huge.push(huge[0] as [number, number]);
  assert.match(boundaryIssues({ type: "Polygon", coordinates: [huge] })[0] ?? "", /顶点太多/);
});

test("城市编码：CTY-国家码-序号，国家码要和所属国家一致", () => {
  assert.equal(cityCodeIssue("CTY-JP-TYO", "JP"), null);
  assert.equal(cityCodeIssue("CTY-KR-01", "KR"), null);
  assert.match(cityCodeIssue("CTY-JP-TYO", "KR") ?? "", /不一致/);
  for (const code of ["TYO", "CTY-JP", "CTY-JP-", "CTY-jp-TYO", "CTY-JP-tyo", "CTY-JP-T", "CTY-JP-TOOLONGCODE", "cty-JP-TYO", "CTY-JPN-TYO", " CTY-JP-TYO"]) {
    assert.match(cityCodeIssue(code, "JP") ?? "", /格式/, code);
  }
});

test("地点编码：各类型各有格式", () => {
  const jp = { countryCode: "JP", parentCode: null };
  assert.equal(placeCodeIssue("airport", "HND", jp), null);
  for (const code of ["hnd", "HN", "HNDA", "H1D", "RJTT"]) assert.notEqual(placeCodeIssue("airport", code, jp), null, code);
  assert.equal(isIataCode("NRT"), true);
  assert.equal(isIataCode("nrt"), false);

  assert.equal(placeCodeIssue("station", "STN-JP-TOKYO", jp), null);
  assert.equal(placeCodeIssue("station", "STN-JP-001", jp), null);
  assert.match(placeCodeIssue("station", "STN-KR-SEOUL", jp) ?? "", /不一致/);
  for (const code of ["TOKYO", "STN-JP-", "STN-JP-tokyo", "STN-JP-TOKYOSTATION"]) assert.notEqual(placeCodeIssue("station", code, jp), null, code);

  assert.equal(placeCodeIssue("poi", "POI-000123", jp), null);
  for (const code of ["POI-", "POI-abc", "000123", "POI-0000000000001"]) assert.notEqual(placeCodeIssue("poi", code, jp), null, code);

  assert.equal(placeCodeIssue("terminal", "HND-T3", { countryCode: "JP", parentCode: "HND" }), null);
  assert.equal(placeCodeIssue("exit", "STN-JP-TOKYO-E1", { countryCode: "JP", parentCode: "STN-JP-TOKYO" }), null);
  assert.notEqual(placeCodeIssue("terminal", "NRT-T3", { countryCode: "JP", parentCode: "HND" }), null, "前缀必须是上级的编码");
  assert.notEqual(placeCodeIssue("terminal", "HND-", { countryCode: "JP", parentCode: "HND" }), null);
  assert.notEqual(placeCodeIssue("terminal", "HND-t3", { countryCode: "JP", parentCode: "HND" }), null);
  assert.notEqual(placeCodeIssue("terminal", "HND-TERMINAL3", { countryCode: "JP", parentCode: "HND" }), null);
  assert.notEqual(placeCodeIssue("terminal", "HND-T3", { countryCode: "JP", parentCode: null }), null, "没有上级就没有合法的编码");
});

test("上级：航站楼挂机场，出口挂车站，其余没有上级", () => {
  assert.deepEqual(PLACE_TYPES.map((type) => requiredParentType(type)), [null, null, null, "airport", "station"]);
});

test("地点的属性：车站 / 地标必须有各自的类型，地址只属于地标，国际国内属性只属于机场和航站楼", () => {
  const none = { category: null, flightScope: null, address: null };
  assert.deepEqual(placeAttributeIssues("airport", none), []);
  assert.deepEqual(placeAttributeIssues("airport", { ...none, flightScope: "international" }), []);
  assert.deepEqual(placeAttributeIssues("terminal", { ...none, flightScope: "domestic" }), []);
  assert.deepEqual(placeAttributeIssues("station", { ...none, category: "shinkansen" }), []);
  assert.deepEqual(placeAttributeIssues("poi", { category: "hotel", flightScope: null, address: "东京都千代田区丸之内 1-1" }), []);
  assert.deepEqual(placeAttributeIssues("exit", none), []);

  assert.deepEqual(placeAttributeIssues("station", none).map(([field]) => field), ["category"]);
  assert.deepEqual(placeAttributeIssues("poi", none).map(([field]) => field), ["category"]);
  assert.deepEqual(placeAttributeIssues("station", { ...none, category: "hotel" }), [["category", "车站的类型只能是：新干线、铁路、地铁"]]);
  assert.deepEqual(placeAttributeIssues("poi", { ...none, category: "rail" }), [["category", "地标的类型只能是：酒店、景点、港口、商场"]]);
  assert.deepEqual(placeAttributeIssues("poi", { ...none, category: "metro" }).map(([field]) => field), ["category"]);
  assert.deepEqual(placeAttributeIssues("airport", { ...none, category: "hotel" }).map(([field]) => field), ["category"]);
  assert.deepEqual(placeAttributeIssues("station", { category: "rail", flightScope: "mixed", address: "x" }).map(([field]) => field), ["flightScope", "address"]);
  assert.deepEqual(placeAttributeIssues("exit", { ...none, flightScope: "mixed" }).map(([field]) => field), ["flightScope"]);
});

test("地点能否启用：要有城市、城市启用、上级启用", () => {
  assert.equal(placeEnableBlocker({ cityStatus: "active", parentStatus: null }), null);
  assert.equal(placeEnableBlocker({ cityStatus: "active", parentStatus: "active" }), null);
  assert.equal(placeEnableBlocker({ cityStatus: null, parentStatus: null }), "CITY_MISSING");
  assert.equal(placeEnableBlocker({ cityStatus: "disabled", parentStatus: "active" }), "CITY_DISABLED");
  assert.equal(placeEnableBlocker({ cityStatus: "active", parentStatus: "disabled" }), "PARENT_DISABLED");
});

test("车型组编码：VG-等级-座位数，末尾数字等于座位数", () => {
  assert.equal(vehicleGroupCodeIssue("VG-BIZ-7", 7), null);
  assert.equal(vehicleGroupCodeIssue("VG-ECO-4", 4), null);
  assert.equal(vehicleGroupCodeIssue("VG-BIZEV-13", 13), null);
  assert.match(vehicleGroupCodeIssue("VG-BIZ-7", 5) ?? "", /不一致/);
  for (const code of ["BIZ-7", "VG-BIZ", "VG-BIZ-", "VG-biz-7", "VG-B-7", "VG-BIZ-07", "VG-BIZ-0", "VG-BIZ-100", "VG-BIZ-7 "]) {
    assert.match(vehicleGroupCodeIssue(code, 7) ?? "", /格式/, code);
  }
});

test("车型组编码的等级段：以某个等级的缩写开头时，等级必须就是它；不以任何缩写开头的不限", () => {
  assert.equal(vehicleGroupCodeIssue("VG-BIZ-7", 7, "business"), null);
  assert.equal(vehicleGroupCodeIssue("VG-BIZEV-7", 7, "business"), null);
  assert.equal(vehicleGroupCodeIssue("VG-ECO-4", 4, "economy"), null);
  assert.equal(vehicleGroupCodeIssue("VG-CMF-5", 5, "comfort"), null);
  assert.equal(vehicleGroupCodeIssue("VG-LUX-4", 4, "luxury"), null);
  assert.match(vehicleGroupCodeIssue("VG-ECO-4", 4, "luxury") ?? "", /ECO 是「经济」的缩写，和所选的等级「豪华」不一致（豪华的缩写是 LUX）/);
  assert.doesNotMatch(vehicleGroupCodeIssue("VG-ECO-4", 4, "luxury") ?? "", /luxury|economy/, "说明里不夹接口的英文取值");
  assert.match(vehicleGroupCodeIssue("VG-LUXEV-4", 4, "business") ?? "", /不一致/);
  assert.equal(vehicleGroupCodeIssue("VG-VAN-9", 9, "comfort"), null);
  assert.deepEqual(Object.keys(VEHICLE_GRADE_ABBREVIATIONS), [...VEHICLE_GRADES]);
});

test("看得见的文字：只有空白、零宽空格、方向控制符的不算", () => {
  for (const text of ["东京", " a ", "\u200b东", "🚗"]) assert.equal(hasVisibleText(text), true, JSON.stringify(text));
  for (const text of ["", " ", "\u3000", "\u200b", "\u200b\u200d\ufeff", "\u202e", "\t\n", "\u00a0"]) assert.equal(hasVisibleText(text), false, JSON.stringify(text));
});

test("人数 / 行李数组合：至少一个，人数不超过座位数，不能重复", () => {
  assert.deepEqual(vehicleComboIssues(7, [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }, { passengers: 7, luggage: 0 }]), []);
  assert.match(vehicleComboIssues(7, [])[0] ?? "", /至少/);
  assert.match(vehicleComboIssues(7, [{ passengers: 8, luggage: 0 }])[0] ?? "", /超过了座位数/);
  assert.match(vehicleComboIssues(7, [{ passengers: 0, luggage: 0 }])[0] ?? "", /人数/);
  assert.match(vehicleComboIssues(7, [{ passengers: 2.5, luggage: 0 }])[0] ?? "", /人数/);
  assert.match(vehicleComboIssues(7, [{ passengers: 2, luggage: -1 }])[0] ?? "", /行李数/);
  assert.match(vehicleComboIssues(7, [{ passengers: 2, luggage: 100 }])[0] ?? "", /行李数/);
  assert.match(vehicleComboIssues(7, [{ passengers: 2, luggage: 1 }, { passengers: 2, luggage: 1 }])[0] ?? "", /重复/);
  const many = Array.from({ length: 21 }, (_, i) => ({ passengers: 1, luggage: i }));
  assert.match(vehicleComboIssues(7, many)[0] ?? "", /最多/);
});

test("附加服务编码：ADD-代码", () => {
  for (const code of ["ADD-CHILD_SEAT", "ADD-WIFI", "ADD-DRIVER_LANG_2"]) assert.equal(addonCodeIssue(code), null, code);
  for (const code of ["CHILD_SEAT", "ADD-", "ADD-child_seat", "ADD-1SEAT", "ADD-A", "ADD-CHILD SEAT", "ADD-CHILD-SEAT", `ADD-${"A".repeat(41)}`]) {
    assert.match(addonCodeIssue(code) ?? "", /格式/, code);
  }
});

test("国家代码清单：250 个（ISO 的 249 个加 XK），按字母排序、不重复，和 isCountryCode 一致", () => {
  assert.equal(COUNTRY_CODES.length, 250);
  assert.equal(new Set(COUNTRY_CODES).size, 250);
  assert.deepEqual([...COUNTRY_CODES], [...COUNTRY_CODES].sort());
  assert.ok(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code) && isCountryCode(code)));
  for (const code of ["JP", "KR", "CN", "XK"]) assert.ok(COUNTRY_CODES.includes(code), code);
});
