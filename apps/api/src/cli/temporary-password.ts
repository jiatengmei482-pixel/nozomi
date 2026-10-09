/**
 * 命令行的临时密码（ADR 0013）：`--temporary-password` 开关用。
 *
 * - 生成：规则在 @nozomi/domain，随机数用 `crypto.randomInt`（密码学安全、无取模偏差）。
 * - 显示：只往标准输出写一次，单独占一行，行首是固定的 `TEMPORARY_PASSWORD_LABEL`，便于人眼和脚本识别。
 *   不写标准错误、不进任何日志、不进审计详情；数据库只存哈希。之后没有任何办法再看到它。
 */
import { randomInt } from "node:crypto";
import { generateTemporaryPassword } from "@nozomi/domain";

export const TEMPORARY_PASSWORD_LABEL = "临时密码：";

export function newTemporaryPassword(email: string): string {
  return generateTemporaryPassword(email, (exclusiveMax) => randomInt(exclusiveMax));
}

/** 往标准输出写「怎么用」的说明和临时密码那一行。只在账号已经写进数据库之后调用。 */
export function printTemporaryPassword(output: NodeJS.WritableStream, password: string): void {
  output.write(
    [
      "下面这一行是临时密码，只显示这一次，请现在就交给本人：",
      `${TEMPORARY_PASSWORD_LABEL}${password}`,
      "用它登录后必须先修改密码，改完之前不能使用其他功能；改完后这个临时密码作废。",
      "",
    ].join("\n"),
  );
}
