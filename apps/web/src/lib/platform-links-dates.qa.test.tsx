/**
 * M1-10 测试角色补的单元测试：一次性链接的拼法（对方打开后页面要能原样取回令牌）、有效期的写法，
 * 审计日志的日期筛选在各个时区、夏令时切换日、跨月跨年时的边界，长内容折叠的边界，页面和后端校验口径的对照。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tokenFromHash } from "../pages/SetPasswordPage.tsx";
import { FOLD_CHARS, FOLD_LINES, auditDiff, foldable, localDayInstant, localOffsetLabel, objectName, shortId, shownValue } from "./audit-display.ts";
import { expiryText, linkMessage, localMinute, oneTimeLink } from "./one-time-link.ts";
import { NAME_MAX, REASON_MAX, emailProblem, isUnsure, nameProblem, reasonProblem } from "./platform-display.ts";
import { PORTALS } from "./portal.ts";
import { ApiError, NetworkError } from "../api/client.ts";

test("一次性链接：四种入口的路径都对；令牌在 # 后面（不是查询参数），对方的页面能原样取回——哪怕令牌里有 + / = & # ? % 空格", () => {
  const origin = "https://ops.example.com";
  assert.equal(oneTimeLink(origin, "tenant", "invite", "abc"), "https://ops.example.com/accept-invite#token=abc");
  assert.equal(oneTimeLink(origin, "tenant", "reset", "abc"), "https://ops.example.com/reset-password#token=abc");
  assert.equal(oneTimeLink(origin, "platform", "invite", "abc"), "https://ops.example.com/platform/accept-invite#token=abc");
  assert.equal(oneTimeLink(origin, "platform", "reset", "abc"), "https://ops.example.com/platform/reset-password#token=abc");
  for (const token of ["nzi_AbC-123_xyz", "a+b/c==", "x&token=y", "a#b", "a?b=c", "100%", "有 空格", "a%2Fb"]) {
    for (const portal of ["tenant", "platform"] as const) {
      for (const kind of ["invite", "reset"] as const) {
        const url = new URL(oneTimeLink(origin, portal, kind, token));
        assert.equal(url.search, "", "令牌不在查询串里（查询串会发给服务器、进访问日志）");
        assert.equal(url.origin, origin);
        assert.equal(url.pathname, kind === "invite" ? PORTALS[portal].paths.acceptInvite : PORTALS[portal].paths.resetPassword);
        assert.equal(tokenFromHash(url.hash), token, `对方的页面取回的令牌要和发出的一样：${token}`);
      }
    }
  }
});

test("有效期和「复制链接和说明」：给了时间写本地的绝对时间，没给或不是时间只写时长，不出现 Invalid Date；说明里只有姓名、后台、用途、时间、链接、邮箱", () => {
  const at = new Date(2026, 9, 16, 14, 30).toISOString();
  assert.equal(localMinute(at), "2026-10-16 14:30");
  assert.equal(localMinute(new Date(2027, 0, 1, 0, 0).toISOString()), "2027-01-01 00:00", "跨年的零点");
  assert.equal(localMinute(null), null);
  assert.equal(localMinute("很快"), null);
  assert.equal(expiryText("invite", at), "有效期到 2026-10-16 14:30（7 天），只能用一次。");
  assert.equal(expiryText("reset", at), "有效期到 2026-10-16 14:30（24 小时），只能用一次。");
  assert.equal(expiryText("invite", null), "有效期：邀请 7 天，只能用一次。");
  assert.equal(expiryText("reset", "x"), "有效期：重置 24 小时，只能用一次。");
  const link = "https://ops.example.com/accept-invite#token=abc";
  assert.equal(linkMessage({ portal: "tenant", kind: "invite", name: "山田太郎", email: "yamada@example.com", link, expiresAt: at }), `山田太郎，你好：\n这是 NOZOMI 供应商后台的账号开通链接，请在 2026-10-16 14:30 前打开，设置你自己的密码：\n${link}\n链接只能用一次，请不要转发给别人。登录邮箱：yamada@example.com`);
  assert.equal(linkMessage({ portal: "platform", kind: "reset", name: "佐藤", email: "sato@example.com", link, expiresAt: null }).split("\n")[1], "这是 NOZOMI 运营后台的密码重置链接，请在 24 小时内打开，设置你自己的密码：");
  assert.equal(linkMessage({ portal: "platform", kind: "invite", name: "佐藤", email: "sato@example.com", link, expiresAt: "x" }).split("\n")[1], "这是 NOZOMI 运营后台的账号开通链接，请在 7 天内打开，设置你自己的密码：");
});

test("页面的校验和后端同口径：名称 / 姓名 1–100、原因 1–500（都先去掉首尾空白）、邮箱最长 254；只有空白等于没填", () => {
  assert.deepEqual([NAME_MAX, REASON_MAX], [100, 500]);
  assert.equal(nameProblem("", "名称"), "请填写名称");
  assert.equal(nameProblem(" \t\n　", "姓名"), "请填写姓名");
  assert.equal(nameProblem(` ${"名".repeat(100)} `, "名称"), null);
  assert.equal(nameProblem("名".repeat(101), "名称"), "名称最多 100 个字");
  assert.equal(reasonProblem(" \n "), "请填写暂停原因");
  assert.equal(reasonProblem(`\n${"因".repeat(500)}\n`), null);
  assert.equal(reasonProblem("因".repeat(501)), "原因最多 500 个字");
  assert.equal(emailProblem(""), "请填写邮箱");
  assert.equal(emailProblem("   "), "请填写邮箱");
  for (const bad of ["不是邮箱", "a@b", "a b@example.com", "a@@example.com", "@example.com", "a@", `${"a".repeat(250)}@example.com`]) assert.equal(emailProblem(bad), "这不是一个邮箱地址", bad);
  for (const good of ["yamada@example.com", "  Yamada.Taro+ops@Example.co.jp  "]) assert.equal(emailProblem(good), null, good);
});

test("「不确定有没有成功」只用在没拿到明确答复的时候：断网、超时、5xx、应答不是约定的样子；4xx 的明确拒绝不算", () => {
  assert.equal(isUnsure(new NetworkError()), true);
  for (const status of [500, 502, 503, 504]) assert.equal(isUnsure(new ApiError(status, "INTERNAL_ERROR", "", {}, null)), true, String(status));
  assert.equal(isUnsure(new ApiError(404, "UNKNOWN", "", {}, null)), true, "代理返回的网页（不是后端的错误格式）");
  for (const [status, code] of [[400, "VALIDATION_FAILED"], [401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "EMAIL_TAKEN"], [429, "RATE_LIMITED"]] as const) assert.equal(isUnsure(new ApiError(status, code, "", {}, null)), false, code);
  assert.equal(isUnsure(new TypeError("x")), false);
});

test("审计日志的值：各种类型怎么显示；长内容折叠的边界（6 行、300 个字）；对象名称遇到奇怪的形状不崩", () => {
  assert.deepEqual(shownValue("x", null), { text: "（空）", block: false, empty: true });
  assert.deepEqual(shownValue("x", undefined), { text: "（空）", block: false, empty: true });
  assert.deepEqual(shownValue("x", ""), { text: "（空）", block: false, empty: true });
  assert.equal(shownValue("x", 0).text, "0");
  assert.equal(shownValue("x", false).text, "否");
  assert.equal(shownValue("x", -1.5).text, "-1.5");
  assert.deepEqual(shownValue("x", []), { text: "[]", block: true, empty: false });
  assert.deepEqual(shownValue("x", {}), { text: "{}", block: true, empty: false });
  assert.equal(shownValue("x", { a: [1, { b: null }] }).text, JSON.stringify({ a: [1, { b: null }] }, null, 2));
  assert.equal(shownValue("x", "<b>x</b>").text, "<b>x</b>");
  assert.deepEqual(shownValue("status", "suspended", "tenant"), { text: "已暂停", raw: "suspended", block: false, empty: false });
  assert.deepEqual(shownValue("status", "archived", "tenant"), { text: "archived", block: false, empty: false }, "不认识的枚举值原样显示");
  assert.equal(shownValue("role", "super_admin", "platform_user").text, "超级管理员");
  assert.equal(shownValue("status", "invited", "platform_user").text, "待激活");

  assert.equal(foldable(Array.from({ length: FOLD_LINES }, () => "x").join("\n")), null, "正好 6 行不折");
  assert.equal(foldable(Array.from({ length: FOLD_LINES + 1 }, () => "x").join("\n"))?.lines, 7);
  assert.equal(foldable("字".repeat(FOLD_CHARS)), null, "正好 300 个字不折");
  const longLine = foldable("字".repeat(FOLD_CHARS + 1));
  assert.deepEqual([longLine?.folded.length, longLine?.lines], [FOLD_CHARS + 1, 1], "一行很长：留 300 个字加省略号");
  const many = foldable(JSON.stringify(Array.from({ length: 5000 }, (_, index) => [139 + index / 1e4, 35]), null, 2));
  assert.ok(many !== null && many.folded.split("\n").length === FOLD_LINES && many.lines > 20000);

  for (const odd of [{ name: 42 }, { name: [] }, { name: {} }, { name: { zh: 1 } }, { name: { zh: null } }, { name: null, email: false }, { name: "   ", code: "" }, {}]) {
    assert.doesNotThrow(() => objectName({ before: odd as Record<string, unknown>, after: odd as Record<string, unknown> }), JSON.stringify(odd));
  }
  assert.equal(objectName({ before: { name: "旧名" }, after: { status: "x" } }), "旧名", "改后没有就看改前");
  assert.equal(objectName({ before: null, after: { email: "a@example.com", name: "" } }), "a@example.com");
  assert.equal(shortId("12345678"), "12345678");
  assert.equal(shortId("123456789"), "12345678…");
  assert.deepEqual(auditDiff({ before: {}, after: {} }), { kind: "none", rows: [], unchanged: 0 });
  assert.equal(auditDiff({ before: { a: { x: [1, 2] } }, after: { a: { x: [1, 2] } } }).unchanged, 1, "嵌套的值按内容比");
  assert.equal(auditDiff({ before: { a: 1 }, after: { b: 2 } }).rows.every((row) => row.changed), true, "一边没有的项算变了");
});

/** 在指定时区里另起一个进程算（时区只能在进程启动时定）。 */
function inZone(zone: string, expression: string): unknown {
  const module = fileURLToPath(new URL("./audit-display.ts", import.meta.url));
  const script = `import * as m from ${JSON.stringify(module)}; console.log(JSON.stringify(${expression}));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: zone }, encoding: "utf8" }));
}

test("审计日志的日期筛选按查看者本地的整天算：东京、纽约（夏令时开始和结束的那两天）、UTC+14、UTC-3:30、尼泊尔（+5:45）都对；跨月、跨年、闰日；不存在的日期不认", () => {
  const range = (zone: string, from: string, to: string): [string | null, string | null] => inZone(zone, `[m.localDayInstant(${JSON.stringify(from)}, false), m.localDayInstant(${JSON.stringify(to)}, true)]`) as [string | null, string | null];
  // 东京（UTC+9，没有夏令时）：10-09 的整天 = 10-08T15:00Z 到 10-09T15:00Z
  assert.deepEqual(range("Asia/Tokyo", "2026-10-09", "2026-10-09"), ["2026-10-08T15:00:00.000Z", "2026-10-09T15:00:00.000Z"]);
  // 跨月、跨年、闰日
  assert.deepEqual(range("Asia/Tokyo", "2026-01-31", "2026-01-31"), ["2026-01-30T15:00:00.000Z", "2026-01-31T15:00:00.000Z"]);
  assert.deepEqual(range("Asia/Tokyo", "2026-12-31", "2026-12-31"), ["2026-12-30T15:00:00.000Z", "2026-12-31T15:00:00.000Z"]);
  assert.deepEqual(range("Asia/Tokyo", "2028-02-29", "2028-02-29"), ["2028-02-28T15:00:00.000Z", "2028-02-29T15:00:00.000Z"]);
  // 纽约：2026-03-08 只有 23 小时，2026-11-01 有 25 小时
  assert.deepEqual(range("America/New_York", "2026-03-08", "2026-03-08"), ["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
  assert.deepEqual(range("America/New_York", "2026-11-01", "2026-11-01"), ["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]);
  assert.deepEqual(range("Pacific/Kiritimati", "2026-10-09", "2026-10-09"), ["2026-10-08T10:00:00.000Z", "2026-10-09T10:00:00.000Z"]);
  assert.deepEqual(range("America/St_Johns", "2026-01-15", "2026-01-15"), ["2026-01-15T03:30:00.000Z", "2026-01-16T03:30:00.000Z"]);
  assert.deepEqual(range("Asia/Kathmandu", "2026-10-09", "2026-10-09"), ["2026-10-08T18:15:00.000Z", "2026-10-09T18:15:00.000Z"]);
  assert.deepEqual(range("UTC", "2026-10-09", "2026-10-09"), ["2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z"]);

  assert.deepEqual(inZone("Asia/Tokyo", `["2026-02-29","2026-02-30","2026-13-01","2026-00-10","2026-1-1","20260101","2026-10-09T00:00","abc",""].map((d) => m.localDayInstant(d, false))`), [null, null, null, null, null, null, null, null, null]);
  assert.deepEqual(inZone("Asia/Tokyo", `[m.localOffsetLabel(new Date("2026-10-09T00:00:00Z"))]`), ["UTC+9"]);
  assert.deepEqual(inZone("America/St_Johns", `[m.localOffsetLabel(new Date("2026-01-15T00:00:00Z")), m.localOffsetLabel(new Date("2026-07-15T00:00:00Z"))]`), ["UTC-3:30", "UTC-2:30"]);
  assert.deepEqual(inZone("Asia/Kathmandu", `[m.localOffsetLabel(new Date("2026-01-15T00:00:00Z"))]`), ["UTC+5:45"]);
  assert.deepEqual(inZone("UTC", `[m.localOffsetLabel(new Date("2026-01-15T00:00:00Z"))]`), ["UTC+0"]);
  // 一条记录跨午夜：东京 10-09 23:59:59 和 10-10 00:00:00 显示成各自那一天
  assert.deepEqual(inZone("Asia/Tokyo", `[m.localSecond("2026-10-09T14:59:59.000Z"), m.localSecond("2026-10-09T15:00:00.000Z"), m.utcSecond("2026-10-09T15:00:00.000Z")]`), ["2026-10-09 23:59:59", "2026-10-10 00:00:00", "2026-10-09 15:00:00 UTC"]);
  assert.equal(localOffsetLabel(new Date()).startsWith("UTC"), true);
  assert.equal(localDayInstant("2026-10-09", false) !== null, true);
});

test("「到」这一头不存在的日期（2026-02-30、2026-13-01、2026-04-31）应当和「从」一样不认，不能悄悄挪到后面的某一天", () => {
  for (const bad of ["2026-02-30", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-10", "2026-12-32"]) assert.equal(localDayInstant(bad, true), null, `到 ${bad} 被算成了 ${localDayInstant(bad, true)}`);
});
