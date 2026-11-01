/**
 * QA（M4-16 × M4-06，ADR 0049、0050）：验证码登录发信遇到新的拒收类型，发码接口的应答仍和不存在的邮箱一样；审计只有代码，服务器原文不进审计和日志。
 * 连真实的 PostgreSQL 和本机假 SMTP，账号都是测试里现场构造的虚构值。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_CODE_RESEND_INTERVAL_MS } from "@nozomi/domain";
import { SmtpMailer } from "./integrations/smtp.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";

type Portal = "platform" | "tenant";

let smtp: FakeSmtp;
let api: TestApi;
let root: string;
let ipCounter = 0;
const nextIp = (): string => `198.18.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-mailer@example.test", SMTP_PASSWORD: "qa-fake-smtp-password", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
    integrationSecretsTtlMs: 0,
    mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 500 }),
  });
  root = await api.superAdminToken("qa-rejection-root@platform.test");
});
after(async () => {
  await api.close();
  await smtp.close();
});

async function requestCode(portal: Portal, email: string): Promise<ApiResponse> {
  const res = await api.call("POST", `/${portal}/v1/auth/email-code/request`, { body: { email }, ip: nextIp() });
  await api.app.emailLoginIdle();
  return res;
}

function comparable(res: ApiResponse): { status: number; text: string; headers: Record<string, unknown> } {
  const { date: _date, "x-request-id": _requestId, ...headers } = res.headers;
  return { status: res.status, text: res.text, headers };
}

const BEHAVIORS: [string, NonNullable<Parameters<FakeSmtp["behave"]>[0]["rejectAt"]>, string][] = [
  ["MAIL 5xx", { stage: "MAIL", reply: "550 5.7.1 refused" }, "SENDER_REJECTED"],
  ["RCPT 5.1.1", { stage: "RCPT", reply: "550 5.1.1 refused" }, "RECIPIENT_REJECTED"],
  ["RCPT 无增强码", { stage: "RCPT", reply: "550 refused" }, "RECIPIENT_REJECTED"],
  ["RCPT 5.7.1", { stage: "RCPT", reply: "553 5.7.1 refused" }, "MESSAGE_REJECTED"],
  ["正文之后 5xx", { stage: "DOT", reply: "554 5.7.1 refused" }, "MESSAGE_REJECTED"],
  ["RCPT 4xx", { stage: "RCPT", reply: "450 4.2.1 later" }, "TEMPORARILY_REJECTED"],
  ["DATA 4xx", { stage: "DATA", reply: "451 later" }, "TEMPORARILY_REJECTED"],
];

for (const portal of ["platform", "tenant"] as const) {
  test(`${portal}：每一种拒收，发码的应答都和不存在的邮箱一样；审计只有代码；服务器原文、完整邮箱不进审计和日志`, async () => {
    const at = portal === "platform" ? "platform.test" : "fleet.test";
    const email = `qa-rejection-${portal}@${at}`;
    const echo = `qa-server-said-no-${email}`;
    if (portal === "platform") await createSuperAdmin(api.db.pool, { email, name: "员工", password: TEST_PASSWORD }, api.clock.now());
    else await api.tenantWithAdmin(root, "QA 拒收车队", email);
    smtp.reset();
    await api.db.owner.query("delete from login_throttles");
    const baseline = await requestCode(portal, `qa-rejection-nobody-${portal}@${at}`);
    assert.equal(baseline.status, 202, baseline.text);
    for (const [label, rejectAt, code] of BEHAVIORS) {
      smtp.reset();
      smtp.behave({ rejectAt, errorDetail: echo });
      await api.db.owner.query("delete from login_throttles");
      const mark = (await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id;
      api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
      const res = await requestCode(portal, email);
      assert.deepEqual(comparable(res), comparable(baseline), label);
      const rows = (await api.db.owner.query("select after from audit_logs where action = 'email_code_request' and id > $1", [mark])).rows;
      assert.equal(rows.length, 1, label);
      assert.deepEqual([rows[0].after.outcome, rows[0].after.error], ["send_failed", code], label);
      assert.ok(!JSON.stringify(rows[0].after).includes(echo), label);
      assert.ok(!JSON.stringify(rows[0].after).includes(email), label);
    }
    smtp.reset();
    assert.doesNotMatch(api.logs(), new RegExp(echo.replace(/[.]/g, "\\.")), "服务器原文进了日志");
    assert.ok(!api.logs().includes(email), "完整邮箱进了日志");
  });
}
