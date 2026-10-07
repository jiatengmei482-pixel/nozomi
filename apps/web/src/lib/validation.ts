/**
 * 表单字段的前端校验。返回出错文字；没有问题返回 null（密码规则可能同时有多条，返回数组）。
 * 密码强度规则只有一份：@nozomi/domain 的 password-policy，前后端共用。
 */
import { PASSWORD_ISSUE_MESSAGES, PASSWORD_MIN_LENGTH, checkPasswordStrength } from "@nozomi/domain";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLoginEmail(value: string): string | null {
  const email = value.trim();
  if (email === "") return "请输入邮箱";
  if (!EMAIL_PATTERN.test(email)) return "邮箱格式不正确";
  return null;
}

export function validateLoginPassword(value: string): string | null {
  return value === "" ? "请输入密码" : null;
}

/** 新密码：空，或逐条列出没满足的规则。不知道邮箱时（凭令牌设密码）传空串，「不含邮箱名」由后端把关。 */
export function validateNewPassword(value: string, email: string): string[] {
  if (value === "") return ["请输入新密码"];
  return checkPasswordStrength(value, email).map((issue) => PASSWORD_ISSUE_MESSAGES[issue]);
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (confirmation === "") return "请再输入一次新密码";
  if (confirmation !== password) return "两次输入的密码不一致";
  return null;
}

/** 一直显示在「新密码」下方的规则说明；数字取自 password-policy 的常量。 */
export const PASSWORD_RULES_HINT = `至少 ${PASSWORD_MIN_LENGTH} 个字符，包含小写字母、大写字母、数字、符号中的至少三类，不能包含邮箱名。`;
