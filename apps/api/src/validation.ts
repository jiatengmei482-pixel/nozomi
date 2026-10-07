/**
 * 请求参数校验：用 zod 定义结构，校验不过时抛出与 M0-05 相同形状的 400 VALIDATION_FAILED
 * （`details.location` 是出问题的位置，`details.issues` 逐项列出字段路径和原因）。
 *
 * 结构里没有声明的字段会被丢掉而不是报错——租户接口靠这一点忽略请求体里的 `tenant_id`（需求文档「API 通用约定」）。
 */
import { z } from "zod";
import { AppError } from "./errors.ts";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, isUuid } from "./pagination.ts";
import { notFound } from "./services/errors.ts";

export type InputLocation = "body" | "querystring";

const errorMap: z.ZodErrorMap = (issue, context) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "必填" : "类型不正确" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `只能是：${issue.options.join("、")}` };
    case z.ZodIssueCode.too_small:
      return { message: issue.type === "string" ? `至少 ${issue.minimum} 个字符` : `不能小于 ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      return { message: issue.type === "string" ? `最多 ${issue.maximum} 个字符` : `不能大于 ${issue.maximum}` };
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === "email" ? "不是合法的邮箱" : "格式不正确" };
    default:
      return { message: context.defaultError };
  }
};

/** 找出值里第一个带 NUL 字符的字符串的路径；没有则返回 null。 */
function findNulCharacter(value: unknown, path: string): string | null {
  if (typeof value === "string") return value.includes("\u0000") ? path : null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findNulCharacter(item, `${path}/${index}`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const found = findNulCharacter(item, `${path}/${key.replaceAll("\u0000", "")}`);
      if (found !== null) return found;
      if (key.includes("\u0000")) return path === "" ? "/" : path;
    }
  }
  return null;
}

function validationFailed(location: InputLocation, issues: { path: string; message: string }[]): AppError {
  return new AppError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location, issues });
}

/**
 * 校验一份输入（请求体或查询参数）。所有接口的输入都从这里进来，所以对「所有字符串」的统一要求也放在这里：
 * 任何位置的字符串都不能带 NUL 字符（数据库的文本和 JSON 类型不接受它，带进去会变成 500）。
 */
export function parseInput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  location: InputLocation,
): z.output<Schema> {
  const nulAt = findNulCharacter(value, "");
  if (nulAt !== null) throw validationFailed(location, [{ path: nulAt === "" ? "/" : nulAt, message: "不能包含空字符（NUL）" }]);
  const parsed = schema.safeParse(value ?? {}, { errorMap });
  if (parsed.success) return parsed.data as z.output<Schema>;
  throw validationFailed(
    location,
    parsed.error.issues.map((issue) => ({ path: `/${issue.path.join("/")}`, message: issue.message })),
  );
}

/** 路径里的资源编号。格式不对的编号不可能对应任何资源，直接按「不存在」处理。 */
export function resourceId(params: unknown, what: string): string {
  const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !isUuid(id)) throw notFound(what);
  return id.toLowerCase();
}

export const emailSchema = z.string().trim().toLowerCase().max(254).email();
export const personNameSchema = z.string().trim().min(1).max(100);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

/** 每页条数：只接受十进制整数的写法（`0x10`、`1e2`、`1.0`、带空格的都不行）。 */
const limitSchema = z
  .string()
  .regex(/^\d{1,4}$/, "必须是十进制整数")
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_PAGE_LIMIT))
  .default(String(DEFAULT_PAGE_LIMIT));

export const pageQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().min(1).max(500).optional(),
});

/** 带时区的 ISO 8601 时间；格式对但换算不出时刻的（时区偏移越界等）也拒绝。 */
export const dateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "不是带时区的 ISO 8601 时间" })
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), "不是合法的时间");

export const uuidSchema = z.string().refine(isUuid, "不是合法的编号");

/** 审计日志查询的筛选条件（平台和租户共用；平台另有 tenant_id）。 */
export const auditFilterSchema = pageQuerySchema.extend({
  actor_id: uuidSchema.optional(),
  resource: z.string().min(1).max(50).optional(),
  resource_id: z.string().min(1).max(100).optional(),
  action: z.string().min(1).max(50).optional(),
  from: dateTimeSchema.optional(),
  to: dateTimeSchema.optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(1024),
  new_password: z.string().min(1).max(1024),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});
