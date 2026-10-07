/**
 * 密码最小强度规则（M0-06）。平台员工和租户用户用同一套。
 *
 * - 长度 12 ~ 128 个字符（上限是为了不让超长输入拖慢哈希计算）。
 * - 小写字母、大写字母、数字、其他字符四类里至少占三类。
 * - 至少 6 个不同的字符（挡住 `Aa1Aa1Aa1Aa1` 这类重复串）。
 * - 不能包含自己邮箱 @ 前面的部分（4 个字符以上时才检查）。
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
const MIN_CHARACTER_CLASSES = 3;
const MIN_DISTINCT_CHARACTERS = 6;
const MIN_EMAIL_PART_LENGTH = 4;

export type PasswordIssue =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_TOO_FEW_CHARACTER_CLASSES"
  | "PASSWORD_TOO_REPETITIVE"
  | "PASSWORD_CONTAINS_EMAIL";

export const PASSWORD_ISSUE_MESSAGES: Readonly<Record<PasswordIssue, string>> = {
  PASSWORD_TOO_SHORT: `密码至少 ${PASSWORD_MIN_LENGTH} 个字符`,
  PASSWORD_TOO_LONG: `密码最多 ${PASSWORD_MAX_LENGTH} 个字符`,
  PASSWORD_TOO_FEW_CHARACTER_CLASSES: "密码要包含小写字母、大写字母、数字、符号中的至少三类",
  PASSWORD_TOO_REPETITIVE: `密码里至少要有 ${MIN_DISTINCT_CHARACTERS} 个不同的字符`,
  PASSWORD_CONTAINS_EMAIL: "密码不能包含邮箱名",
};

function characterClassCount(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  return classes.filter((pattern) => pattern.test(password)).length;
}

/** 检查密码强度；返回全部不满足的规则，空数组表示通过。 */
export function checkPasswordStrength(password: string, email: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const characters = [...password];
  if (characters.length < PASSWORD_MIN_LENGTH) issues.push("PASSWORD_TOO_SHORT");
  if (characters.length > PASSWORD_MAX_LENGTH) issues.push("PASSWORD_TOO_LONG");
  if (characterClassCount(password) < MIN_CHARACTER_CLASSES) issues.push("PASSWORD_TOO_FEW_CHARACTER_CLASSES");
  if (new Set(characters).size < MIN_DISTINCT_CHARACTERS) issues.push("PASSWORD_TOO_REPETITIVE");
  const emailPart = (email.split("@")[0] ?? "").toLowerCase();
  if (emailPart.length >= MIN_EMAIL_PART_LENGTH && password.toLowerCase().includes(emailPart)) {
    issues.push("PASSWORD_CONTAINS_EMAIL");
  }
  return issues;
}
