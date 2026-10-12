/**
 * 临时密码与「必须先修改密码」（M0-12，ADR 0013）。
 *
 * 临时密码由服务器上的命令行生成并只显示一次，交给本人后第一次登录必须改掉。
 * 这里只有规则：密码长什么样、强制改密期间哪些请求放行。随机数由调用方传入（命令行传 `crypto.randomInt`），
 * 所以这个模块没有 IO，测试里可以用确定的序列。
 */
import { checkPasswordStrength } from "./password-policy.ts";

/** 去掉了容易看错的字符（0 O o、1 l I i）：临时密码要靠人抄写、口述。 */
const LOWERCASE = "abcdefghjkmnpqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = `${LOWERCASE}${UPPERCASE}${DIGITS}`;

export const TEMPORARY_PASSWORD_GROUPS = 4;
export const TEMPORARY_PASSWORD_GROUP_LENGTH = 5;
const SEPARATOR = "-";
const MAX_ATTEMPTS = 100;

/** 临时密码的固定形状：4 组、每组 5 个字符、用连字符隔开（共 23 个字符，约 115 比特）。 */
export const TEMPORARY_PASSWORD_PATTERN = new RegExp(
  `^[${ALPHABET}]{${TEMPORARY_PASSWORD_GROUP_LENGTH}}(?:${SEPARATOR}[${ALPHABET}]{${TEMPORARY_PASSWORD_GROUP_LENGTH}}){${TEMPORARY_PASSWORD_GROUPS - 1}}$`,
);

/** 返回 [0, exclusiveMax) 内均匀分布的整数。生产环境必须是密码学安全的随机源。 */
export type RandomInt = (exclusiveMax: number) => number;

function candidate(randomInt: RandomInt): string {
  const groups: string[] = [];
  for (let group = 0; group < TEMPORARY_PASSWORD_GROUPS; group += 1) {
    let text = "";
    for (let position = 0; position < TEMPORARY_PASSWORD_GROUP_LENGTH; position += 1) {
      const index = randomInt(ALPHABET.length);
      if (!Number.isInteger(index) || index < 0 || index >= ALPHABET.length) {
        throw new RangeError("随机源返回了范围之外的值");
      }
      text += ALPHABET[index];
    }
    groups.push(text);
  }
  return groups.join(SEPARATOR);
}

function hasEveryCharacterClass(password: string): boolean {
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

/**
 * 生成一个临时密码：同时含小写、大写、数字（连字符算第四类），并且通过给这个邮箱的全部密码强度规则。
 * 不满足的候选整个丢弃重抽（不做「补一个字符」之类会让分布不均匀的修补）。
 * 随机源一直给不出合格的候选时抛错，不会无限循环。
 */
export function generateTemporaryPassword(email: string, randomInt: RandomInt): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const password = candidate(randomInt);
    if (hasEveryCharacterClass(password) && checkPasswordStrength(password, email).length === 0) return password;
  }
  throw new Error("随机源没有给出合格的临时密码");
}

/**
 * 一次已登录的请求想做什么：
 * - `self_service`：查看自己、修改自己的密码、退出登录；
 * - `general`：其余一切（接口没有特别声明时就是它）。
 */
export type SessionPurpose = "general" | "self_service";

/** 账号被标记为「必须先修改密码」时，只放行 `self_service`；其余请求都要先改密码。 */
export function passwordChangeRequiredFirst(mustChangePassword: boolean, purpose: SessionPurpose): boolean {
  return mustChangePassword && purpose !== "self_service";
}
