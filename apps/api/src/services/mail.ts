/**
 * 内部发信接口（M4-14，ADR 0048）：通知中心（M4-08）、邮箱验证码登录（M4-06）都从这里发。
 * 每次现取生效的 SMTP 配置（运营后台填写的优先），保存后下一封就用新的。失败是返回值，不抛异常：调用方按失败记录。
 */
import type { SmtpSettings } from "@nozomi/config";
import { type MailMessage, mailMessageIssues } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { MailSendResult } from "../integrations/smtp.ts";

export type MailResult = MailSendResult | { ok: false; code: "NOT_CONFIGURED" | "MESSAGE_INVALID"; message: string };

const MESSAGE_INVALID = { ok: false, code: "MESSAGE_INVALID", message: "邮件内容不合格：收件人只能是一个邮箱地址，主题不能有换行，主题和正文都要有内容" } as const;

/** 校验内容再发。不合格一个字节都不发（防邮件头注入）。 */
export async function sendMailWith(ctx: AppContext, settings: SmtpSettings, message: MailMessage): Promise<MailSendResult | typeof MESSAGE_INVALID> {
  if (mailMessageIssues(message).length > 0) return MESSAGE_INVALID;
  return ctx.mailer.send(settings, message);
}

export async function sendMail(ctx: AppContext, message: MailMessage): Promise<MailResult> {
  await ctx.integrations.ensureFresh();
  const settings = ctx.integrations.effective.email.config;
  if (settings === null) return { ok: false, code: "NOT_CONFIGURED", message: "邮件发送还没有配置，请超级管理员在运营后台「系统设置 → 系统状态 → 第三方密钥」填写" };
  return sendMailWith(ctx, settings, message);
}
