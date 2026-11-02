/**
 * QA（M4-27，ADR 0058）：所有发送状态的提示文案。SMTP 只能确认邮件服务器接收，任何状态都不能说司机已经收到；地址只能用接口给的打码地址。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DRIVER_LINK_EMAIL_STATES, driverLinkEmailErrorText } from "@nozomi/domain";
import { driverLinkEmailNotice } from "./dispatch-display.ts";

const CODES = [null, "NOT_CONFIGURED", "RECIPIENT_REJECTED", "MESSAGE_INVALID", "OUTCOME_UNKNOWN", "ORDER_STATE_CHANGED", "DRIVER_LINK_REVOKED", "DRIVER_LINK_SUPERSEDED", "DRIVER_LINK_MANUAL", "DRIVER_EMAIL_MISSING", "DRIVER_DISABLED", "EXPIRED", "AUTH_FAILED", "UNEXPECTED"];

test("每种状态、每种错误：都不说司机已收到、已读；发送成功只说邮件服务器已接收", () => {
  for (const state of DRIVER_LINK_EMAIL_STATES) {
    for (const code of CODES) {
      for (const addressChanged of [false, true]) {
        const notice = driverLinkEmailNotice({ state, recipient_masked: "fi***@example.test", error_code: code, error_message: driverLinkEmailErrorText(code), address_changed: addressChanged });
        assert.doesNotMatch(notice.text, /司机已收到|已送达|司机已读|投递成功/, `${state} / ${code}`);
        if (state === "sent") assert.match(notice.text, /邮件服务器已接收/);
      }
    }
  }
});

test("配置类问题的原因不暴露给调度员（密码、发件人、SMTP）", () => {
  for (const code of ["AUTH_FAILED", "SENDER_REJECTED", "TLS_FAILED", "CONNECTION_FAILED"]) {
    assert.doesNotMatch(driverLinkEmailErrorText(code) as string, /密码|发件人|SMTP|TLS|认证/i, code);
  }
});

test("地址未知时不出现 null、undefined；有地址时只用打码后的", () => {
  for (const state of DRIVER_LINK_EMAIL_STATES) {
    const notice = driverLinkEmailNotice({ state, recipient_masked: null, error_code: null, error_message: null, address_changed: false });
    assert.doesNotMatch(notice.text, /null|undefined/, state);
  }
});
