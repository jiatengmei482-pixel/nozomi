/** 登录和账号相关的业务错误。集中在这里，保证同一种情况在平台和租户两边的错误码、说明完全一致。 */
import { PASSWORD_ISSUE_MESSAGES, type PasswordIssue, type StatusChangeError } from "@nozomi/domain";
import { AppError } from "../errors.ts";
import { validationFailed } from "../validation.ts";

/** 邮箱不存在、密码错误、账号未激活共用这一个错误：从响应上分辨不出邮箱是否存在。 */
export function invalidCredentials(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
}

export function accountDisabled(): AppError {
  return new AppError(403, "ACCOUNT_DISABLED", "账号已停用，请联系管理员");
}

export function unauthenticated(): AppError {
  return new AppError(401, "UNAUTHENTICATED", "请先登录");
}

export function forbidden(required: string): AppError {
  return new AppError(403, "FORBIDDEN", "当前角色没有这个操作的权限", { required });
}

/** 接口允许几种操作中的任一种（如选项接口，ADR 0046）而当前角色一种都没有：`details.required_any` 列出这几种。 */
export function forbiddenAny(requiredAny: readonly string[]): AppError {
  return new AppError(403, "FORBIDDEN", "当前角色没有这个操作的权限", { required_any: [...requiredAny] });
}

/** 账号正在用临时密码：除了查看自己、修改密码、退出，其余接口都先返回这个错误（ADR 0013）。 */
export function passwordChangeRequired(): AppError {
  return new AppError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码，再继续使用");
}

export function notFound(what: string): AppError {
  return new AppError(404, "NOT_FOUND", `${what}不存在`);
}

/** 令牌不存在、已用过、已过期共用这一个错误。 */
export function inviteInvalid(): AppError {
  return new AppError(400, "INVITE_INVALID", "邀请无效或已过期，请联系邀请人重新发出邀请");
}

export function weakPassword(issues: readonly PasswordIssue[]): AppError {
  return new AppError(400, "WEAK_PASSWORD", "密码强度不够", {
    issues: issues.map((code) => ({ code, message: PASSWORD_ISSUE_MESSAGES[code] })),
  });
}

export function emailTaken(): AppError {
  return new AppError(409, "EMAIL_TAKEN", "这个邮箱已被使用");
}

export function lastAdminRequired(roleName: string): AppError {
  return new AppError(409, "LAST_ADMIN_REQUIRED", `至少要保留一个在用的${roleName}`);
}

const STATUS_CHANGE_MESSAGES: Readonly<Record<StatusChangeError, string>> = {
  STATUS_INVITED_IS_NOT_SETTABLE: "不能把账号改回待激活",
  ACCOUNT_NOT_ACTIVATED: "账号从未激活，不能直接启用，请重新邀请",
};

export function statusChangeRejected(code: StatusChangeError): AppError {
  return new AppError(409, code, STATUS_CHANGE_MESSAGES[code]);
}

export function tooManyLoginAttempts(retryAfterSeconds: number): AppError {
  return new AppError(429, "TOO_MANY_LOGIN_ATTEMPTS", "尝试次数过多，请稍后再试", {
    retry_after_seconds: retryAfterSeconds,
  });
}

export function currentPasswordIncorrect(): AppError {
  return new AppError(400, "CURRENT_PASSWORD_INCORRECT", "当前密码不正确");
}

/** 命令行重设密码时，这个账号的密码刚被别的操作改过：不覆盖，请确认后重试。只出现在命令行里。 */
export function passwordChangedMeanwhile(): AppError {
  return new AppError(409, "PASSWORD_CHANGED_MEANWHILE", "这个账号的密码刚刚被别的操作改过，本次没有重设；确认后请再运行一次");
}

export function passwordUnchanged(): AppError {
  return new AppError(400, "PASSWORD_UNCHANGED", "新密码不能和当前密码相同");
}

/** 重置令牌不存在、已用过、已过期、账号已停用，共用这一个错误。 */
export function resetTokenInvalid(): AppError {
  return new AppError(400, "RESET_TOKEN_INVALID", "重置链接无效或已过期，请联系管理员重新发起");
}

/** 只有在用的账号才能发重置令牌：待激活的请重新邀请，已停用的请先启用。 */
export function accountNotActive(): AppError {
  return new AppError(409, "ACCOUNT_NOT_ACTIVE", "账号不是在用状态：待激活的账号请重新邀请，已停用的账号请先启用");
}

/** 同一个城市里已经有同名的区域（本供应商自己的）。 */
export function areaNameTaken(): AppError {
  return new AppError(409, "AREA_NAME_TAKEN", "这个城市已经有同名的区域，请换一个名字");
}

/**
 * 同一个幂等键配了不同的请求内容。这个键上一次已经建成了东西时，把那条的编号和当时的版本号放进 `details.created`：
 * 调用方多半是「第一次其实成功了但没收到应答，改了内容又存一次」，凭它可以改成对那一条的修改，而不是让人刷新后重填。
 */
export function idempotencyKeyReused(created: { id: string; version: number } | null = null): AppError {
  return new AppError(
    422,
    "IDEMPOTENCY_KEY_REUSED",
    created === null
      ? "这个 Idempotency-Key 已经用于另一个内容不同的请求，请换一个新的键"
      : "这个 Idempotency-Key 上一次已经创建成功（见 details.created），这次的内容和上一次不同。要改内容请修改已经建好的那一条，或换一个新的键另建",
    created === null ? {} : { created },
  );
}

/** 编码（城市、地点、车型组、附加服务各自全平台唯一）已经被别的记录使用。 */
export function codeTaken(): AppError {
  return new AppError(409, "CODE_TAKEN", "这个编码已被使用");
}

/** 修改了创建后不能改的字段（需求文档「API 通用约定」的 FIELD_LOCKED）。 */
export function fieldLocked(fields: readonly string[]): AppError {
  return new AppError(409, "FIELD_LOCKED", "这些字段创建后不能修改", { fields });
}

/** 修改时带来的版本号不是最新的：别人已经先改过了。 */
export function versionConflict(currentVersion: number): AppError {
  return new AppError(409, "VERSION_CONFLICT", "这条记录已被别人修改，请刷新后重试", { current_version: currentVersion });
}

/** 修改接口必须用请求头 If-Match 带上版本号。 */
export function versionRequired(): AppError {
  return new AppError(428, "PRECONDITION_REQUIRED", "修改时必须用请求头 If-Match 带上当前的版本号");
}

/** 还有启用中的下级记录在用它，不能停用。 */
export function masterDataInUse(message: string, activeCount: number): AppError {
  return new AppError(409, "MASTER_DATA_IN_USE", message, { active_count: activeCount });
}

/** 它依赖的记录还没准备好（没指定城市、城市或上级已停用），不能启用或挂到它下面。 */
export function masterDataNotReady(reason: string, message: string): AppError {
  return new AppError(409, "MASTER_DATA_NOT_READY", message, { reason });
}

// ---- 两步验证、IP 白名单、角色（M4-05，ADR 0030） ----

/** 会话还没完成两步验证：除了查看自己、退出、两步验证本身，其余接口都先返回这个错误。`status` 告诉前端是去绑定还是去输入动态码。 */
export function mfaRequired(status: "verify_required" | "enrollment_required"): AppError {
  return new AppError(
    403,
    "MFA_REQUIRED",
    status === "enrollment_required" ? "请先绑定两步验证，再继续使用" : "请先输入两步验证的动态码，再继续使用",
    { status },
  );
}

export function mfaCodeInvalid(): AppError {
  return new AppError(400, "MFA_CODE_INVALID", "动态码或恢复码不正确");
}

export function mfaCodeReused(): AppError {
  return new AppError(400, "MFA_CODE_REUSED", "这个动态码已经用过了，请等验证器上出现下一个再输入");
}

export function mfaCodeRequired(): AppError {
  return new AppError(400, "MFA_CODE_REQUIRED", "要先输入现在的动态码（或一个恢复码）确认是本人");
}

export function mfaNotEnrolled(): AppError {
  return new AppError(409, "MFA_NOT_ENROLLED", "这个账号还没有绑定两步验证，请先绑定");
}

export function mfaAlreadyEnrolled(): AppError {
  return new AppError(409, "MFA_ALREADY_ENROLLED", "这个账号已经绑定了两步验证，请输入动态码登录；要换手机请登录后在个人页更换");
}

export function mfaAlreadyVerified(): AppError {
  return new AppError(409, "MFA_ALREADY_VERIFIED", "这次登录已经通过了两步验证");
}

export function mfaEnrollmentNotStarted(): AppError {
  return new AppError(409, "MFA_ENROLLMENT_NOT_STARTED", "绑定已过期或还没开始，请重新生成二维码");
}

export function mfaEncryptionNotConfigured(): AppError {
  return new AppError(503, "MFA_ENCRYPTION_NOT_CONFIGURED", "平台还没有配置数据加密密钥（DATA_ENCRYPTION_KEY），现在不能绑定或验证两步验证。请联系技术人员");
}

/** 库里的密钥解不开（数据加密密钥被换过）：只能由管理员重置两步验证后重新绑定。 */
export function mfaSecretUnavailable(): AppError {
  return new AppError(503, "MFA_SECRET_UNAVAILABLE", "两步验证的密钥读取失败，请联系超级管理员重置你的两步验证后重新绑定");
}

export function mfaResetSelf(): AppError {
  return new AppError(409, "MFA_RESET_SELF", "不能重置自己的两步验证：换手机请在个人页更换；手机和恢复码都丢了，请另一位超级管理员处理");
}

export function ipNotAllowed(): AppError {
  return new AppError(403, "IP_NOT_ALLOWED", "当前网络地址不在这个账号允许的范围内，请在公司网络或指定的网络下登录，或联系超级管理员");
}

export function ipAllowlistInvalid(issues: readonly { index: number; value: string; reason: string; suggestion?: string }[]): AppError {
  return new AppError(400, "IP_ALLOWLIST_INVALID", "IP 白名单里有写错的地址段", { issues });
}

/** 改了之后自己当前的地址就不在名单里了：不保存，免得把自己锁在门外。 */
export function ipAllowlistExcludesCurrent(ip: string): AppError {
  return new AppError(409, "IP_ALLOWLIST_EXCLUDES_CURRENT", "改了之后，你现在的网络地址就不在名单里了，保存后你会立即无法使用。请先把当前地址加进去", { current_ip: ip });
}

export function roleBuiltinReadonly(): AppError {
  return new AppError(409, "ROLE_BUILTIN_READONLY", "内置角色是只读模板，不能修改或删除；可以复制它新建一个角色再改");
}

export function roleInUse(staffCount: number): AppError {
  return new AppError(409, "ROLE_IN_USE", "还有账号在用这个角色，先把它们改成别的角色再删除", { staff_count: staffCount });
}

export function roleNameTaken(): AppError {
  return new AppError(409, "ROLE_NAME_TAKEN", "已经有同名的角色");
}

export function roleGrantsInvalid(issues: readonly { grant: string; reason: string }[]): AppError {
  return new AppError(400, "ROLE_GRANTS_INVALID", "勾选的权限有问题", { issues });
}

export function roleScopeInvalid(missing: { cityIds: readonly string[]; channelIds: readonly string[] }): AppError {
  return new AppError(400, "ROLE_SCOPE_INVALID", "数据范围里有不存在的城市或渠道", { missing_city_ids: missing.cityIds, missing_channel_ids: missing.channelIds });
}

/** 给员工设的角色不存在：按参数校验错误返回（和渠道里「租户不存在」同一种写法）。 */
export function roleNotFound(): AppError {
  return validationFailed("body", [{ path: "/role", reason: "UNKNOWN_ROLE", message: "没有这个角色" }]);
}

export function ownRoleUnchangeable(): AppError {
  return new AppError(409, "OWN_ROLE_UNCHANGEABLE", "不能修改自己的角色，请另一位超级管理员处理");
}

/** 限定了数据范围的人不能做的事（如新建渠道：新渠道不在他的范围里）。 */
export function dataScopeDenied(): AppError {
  return new AppError(403, "DATA_SCOPE_DENIED", "当前角色限定了数据范围，不能做这个操作");
}
