import { test } from "node:test";
import assert from "node:assert/strict";
import { FX_LOCKABLE_CURRENCIES, FX_LOCK_RULES, type FxLock, fxLockActive, fxLockApplyIssues, fxLockRequestIssues, fxQuoteWithLocks, lockDeviation, parseLockRate } from "./fx-lock.ts";
import { type FxTable, fxQuoteFromTable } from "./fx.ts";
import { fxQuoteUsable, sellPrice } from "./quote.ts";

// 测试用的汇率表和锁定（只用于单元测试，不是业务数据）
const NOW = new Date("2026-10-07T12:00:00.000Z");
const table: FxTable = { base: "USD", asOf: "2026-10-07T00:00:00.000Z", rates: { JPY: "150", CNY: "7.2", KRW: "1400" } };
const hours = (n: number): number => n * 3_600_000;
const at = (ms: number): Date => new Date(NOW.getTime() + ms);
const lock = (currency: FxLock["currency"], rate: string, expiresAt: Date = at(hours(24)), id = `lock-${currency}`): FxLock => ({ id, currency, rate, expiresAt: expiresAt.toISOString() });

test("锁定值的解析：只认普通十进制写法，在字符串上规范，不经过浮点数", () => {
  const cases: [string, string | null][] = [
    ["151.2", "151.2"],
    ["151.20", "151.2"],
    ["0151.200", "151.2"],
    ["7", "7"],
    ["0.0071", "0.0071"],
    ["0.100000000000", "0.1"],
    ["0.000000000001", "0.000000000001"],
    ["999999999999", "999999999999"],
    ["0.1000000000000000055", null],
    ["1000000000000", null],
    ["0.0000000000001", null],
    ["0", null],
    ["0.000", null],
    ["-151.2", null],
    ["+151.2", null],
    ["1.5e2", null],
    ["1,512.0", null],
    [" 151.2", null],
    ["151.", null],
    [".5", null],
    ["", null],
    ["NaN", null],
    ["Infinity", null],
  ];
  for (const [text, expected] of cases) assert.equal(parseLockRate(text), expected, text);
});

test("能锁定的币种：平台币种里除了基准 USD", () => {
  assert.ok(!FX_LOCKABLE_CURRENCIES.includes("USD"));
  assert.deepEqual([...FX_LOCKABLE_CURRENCIES].sort(), ["CNY", "HKD", "JPY", "KRW", "THB", "TWD"]);
});

test("到期边界：到期那一刻起不再算数（不含这一刻）", () => {
  const expiresAt = at(hours(1));
  assert.equal(fxLockActive({ expiresAt: expiresAt.toISOString() }, new Date(expiresAt.getTime() - 1)), true);
  assert.equal(fxLockActive({ expiresAt: expiresAt.toISOString() }, expiresAt), false);
  assert.equal(fxLockActive({ expiresAt: "不是时间" }, NOW), false);
  // 报价引擎的判断和它一致
  const quote = fxQuoteWithLocks(table, [lock("JPY", "151.2", expiresAt)], "USD", "JPY", NOW);
  assert.ok(quote !== null);
  assert.equal(fxQuoteUsable(quote, new Date(expiresAt.getTime() - 1)), true);
  assert.equal(fxQuoteUsable(quote, expiresAt), false);
  // 引擎拿到的时候锁定已经到期：没有锁定的那份才会被用（这里是锁定的那份，所以不能用）
  assert.equal(fxQuoteWithLocks(table, [lock("JPY", "151.2", expiresAt)], "USD", "JPY", expiresAt)?.lock, undefined, "到期后算出来的就是数据源的汇率");
});

test("发起时的到期时间：离现在至少 30 分钟、最多 72 小时，两端都含", () => {
  const issues = (expiresAt: Date): string[] => fxLockRequestIssues({ currency: "JPY", rate: "150", expiresAt, reason: null }, "150", NOW).issues.map((issue) => issue.reason);
  assert.deepEqual(issues(at(FX_LOCK_RULES.minMinutes * 60_000)), []);
  assert.deepEqual(issues(at(FX_LOCK_RULES.minMinutes * 60_000 - 1)), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(issues(at(-1)), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(issues(at(hours(FX_LOCK_RULES.maxHours))), []);
  // 容许 5 分钟钟差：浏览器按本机时钟算的「72 小时后」比服务器快一点也收
  const skew = FX_LOCK_RULES.maxHoursClockSkewMinutes * 60_000;
  assert.deepEqual(issues(at(hours(FX_LOCK_RULES.maxHours) + skew)), []);
  assert.deepEqual(issues(at(hours(FX_LOCK_RULES.maxHours) + skew + 1)), ["EXPIRES_TOO_LATE"]);
  assert.deepEqual(issues(new Date(Number.NaN)), ["EXPIRES_TOO_SOON"]);
});

test("和中央汇率的偏离：精确比较，正好 3% 不用写原因、正好 20% 还允许", () => {
  assert.deepEqual(lockDeviation("150", "154.5"), { changeBp: 300, needsReason: false, tooLarge: false });
  assert.deepEqual(lockDeviation("150", "154.500000000001"), { changeBp: 300, needsReason: true, tooLarge: false });
  assert.deepEqual(lockDeviation("150", "145.5"), { changeBp: -300, needsReason: false, tooLarge: false });
  assert.deepEqual(lockDeviation("150", "180"), { changeBp: 2000, needsReason: true, tooLarge: false });
  assert.deepEqual(lockDeviation("150", "180.000000000001"), { changeBp: 2000, needsReason: true, tooLarge: true });
  assert.deepEqual(lockDeviation("150", "120"), { changeBp: -2000, needsReason: true, tooLarge: false });
  assert.deepEqual(lockDeviation("150", "119.999999999999"), { changeBp: -2000, needsReason: true, tooLarge: true });
  assert.deepEqual(lockDeviation("7.2", "7.2"), { changeBp: 0, needsReason: false, tooLarge: false });
  // 0.1 + 0.2 这类浮点数会出错的值：精确
  assert.deepEqual(lockDeviation("0.3", "0.309"), { changeBp: 300, needsReason: false, tooLarge: false });
});

test("发起时的校验：偏离超过 3% 要写原因，超过 20% 拦截；USD 和不支持的币种不能锁；写法不对的锁定值", () => {
  const check = (input: Partial<{ currency: string; rate: string; reason: string | null }>) =>
    fxLockRequestIssues({ currency: "JPY", rate: "150", expiresAt: at(hours(24)), reason: null, ...input }, "150", NOW);
  assert.deepEqual(check({ rate: "151.20" }), { issues: [], rate: "151.2", deviation: { changeBp: 80, needsReason: false, tooLarge: false } });
  const needsReason = check({ rate: "160" });
  assert.deepEqual(needsReason.issues, [{ path: "/reason", reason: "REASON_REQUIRED", detail: { change_bp: 667, central_rate: "150", reason_above_bp: 300 } }]);
  assert.deepEqual(check({ rate: "160", reason: "   " }).issues.map((issue) => issue.reason), ["REASON_REQUIRED"], "只有空格不算原因");
  assert.deepEqual(check({ rate: "160", reason: "数据源停更，按银行牌价" }).issues, []);
  assert.deepEqual(check({ rate: "1500", reason: "写错了数量级" }).issues.map((issue) => [issue.reason, issue.detail?.["change_bp"]]), [["DEVIATION_TOO_LARGE", 90000]]);
  assert.deepEqual(check({ currency: "USD" }).issues.map((issue) => issue.reason), ["BASE_CURRENCY"]);
  assert.deepEqual(check({ currency: "EUR" }).issues.map((issue) => issue.reason), ["UNSUPPORTED_CURRENCY"]);
  assert.deepEqual(check({ rate: "1.5e2" }), { issues: [{ path: "/rate", reason: "INVALID_RATE", detail: { max_integer_digits: 12, max_fraction_digits: 12 } }], rate: null, deviation: null });
});

test("批准时按那一刻的数据再查：已经到期的不能生效；中央汇率变了以后偏离变大的，按新的偏离要求原因或拦截", () => {
  const input = { currency: "JPY" as const, rate: "154", expiresAt: at(hours(1)), reason: null };
  assert.deepEqual(fxLockApplyIssues(input, "150", NOW), []);
  assert.deepEqual(fxLockApplyIssues(input, "150", at(hours(1))).map((issue) => issue.reason), ["EXPIRES_TOO_SOON"]);
  assert.deepEqual(fxLockApplyIssues(input, "140", NOW).map((issue) => issue.reason), ["REASON_REQUIRED"]);
  assert.deepEqual(fxLockApplyIssues({ ...input, reason: "按银行牌价" }, "120", NOW).map((issue) => issue.reason), ["DEVIATION_TOO_LARGE"]);
});

test("交叉汇率在一边锁定时：锁定的一边用锁定值、另一边用数据源的值，精确分数后四舍五入到 12 位小数", () => {
  const locks = [lock("JPY", "151.2")];
  // 1 CNY = 151.2 / 7.2 = 21 JPY（整除）
  assert.deepEqual(fxQuoteWithLocks(table, locks, "CNY", "JPY", NOW), {
    from: "CNY",
    to: "JPY",
    rate: "21",
    asOf: table.asOf,
    lock: { legs: [{ currency: "JPY", rate: "151.2", lockId: "lock-JPY", expiresAt: at(hours(24)).toISOString() }], usesSource: true },
  });
  // 1 JPY = 7.2 / 151.2 = 0.047619047619047… CNY
  assert.equal(fxQuoteWithLocks(table, locks, "JPY", "CNY", NOW)?.rate, "0.047619047619");
  // 和基准之间：只用锁定值，不再依赖数据源
  assert.deepEqual(fxQuoteWithLocks(table, locks, "USD", "JPY", NOW)?.lock?.usesSource, false);
  assert.equal(fxQuoteWithLocks(table, locks, "JPY", "USD", NOW)?.rate, "0.006613756614");
  // 两边都锁定：151.2 / 7.56 = 20
  const both = fxQuoteWithLocks(table, [...locks, lock("CNY", "7.56")], "CNY", "JPY", NOW);
  assert.deepEqual([both?.rate, both?.lock?.legs.map((leg) => leg.currency), both?.lock?.usesSource], ["20", ["CNY", "JPY"], false]);
  // 和这对币种无关的锁定不影响结果：和 fxQuoteFromTable 完全一样，不带 lock
  assert.deepEqual(fxQuoteWithLocks(table, [lock("KRW", "1500")], "CNY", "JPY", NOW), fxQuoteFromTable(table, "CNY", "JPY"));
  // 已经到期的锁定不用
  assert.deepEqual(fxQuoteWithLocks(table, [lock("JPY", "151.2", NOW)], "CNY", "JPY", NOW), fxQuoteFromTable(table, "CNY", "JPY"));
  // 同币种：1，不带锁定
  assert.deepEqual(fxQuoteWithLocks(table, locks, "JPY", "JPY", NOW), { from: "JPY", to: "JPY", rate: "1", asOf: table.asOf });
  // 第 13 位是 5：远离零进位（0.1 / 200000000000 = 0.0000000000005 → 0.000000000001）
  assert.equal(fxQuoteWithLocks({ ...table, rates: { ...table.rates, KRW: "0.1" } }, [lock("JPY", "200000000000")], "JPY", "KRW", NOW)?.rate, "0.000000000001");
});

test("锁定期间不因数据源停更而暂停：只涉及锁定币种和基准的照常可用；另一边还用数据源的，过了 48 小时照样停", () => {
  const stale = at(hours(48) + hours(12) + 1);
  const locks = [lock("JPY", "151.2", at(hours(72)))];
  const usdJpy = fxQuoteWithLocks(table, locks, "USD", "JPY", stale);
  const cnyJpy = fxQuoteWithLocks(table, locks, "CNY", "JPY", stale);
  assert.ok(usdJpy !== null && cnyJpy !== null);
  assert.equal(fxQuoteUsable(usdJpy, stale), true);
  assert.equal(fxQuoteUsable(cnyJpy, stale), false);
  assert.equal(fxQuoteUsable(fxQuoteWithLocks(table, [...locks, lock("CNY", "7.2", at(hours(72)))], "CNY", "JPY", stale) as NonNullable<typeof cnyJpy>, stale), true, "两边都锁定");
});

test("锁定的汇率进报价：对外价按锁定值算，快照里的 fx 带着 lock", () => {
  const fx = fxQuoteWithLocks(table, [lock("JPY", "151.2")], "CNY", "JPY", NOW);
  const sell = sellPrice({ settlementMinor: 90_000, settlementCurrency: "CNY", currency: "JPY", markupBp: 1_000, fx });
  assert.ok("sellMinor" in sell);
  // 900.00 CNY × 21 × 1.015 × 1.1 = 21,101.85 → 21,102 JPY
  assert.equal(sell.sellMinor, 21_102);
  assert.equal(sell.fx?.lock?.legs[0]?.rate, "151.2");
});
