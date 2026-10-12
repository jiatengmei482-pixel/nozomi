/**
 * 请求参数校验：用 zod 定义结构，校验不过时抛出与 M0-05 相同形状的 400 VALIDATION_FAILED
 * （`details.location` 是出问题的位置，`details.issues` 逐项列出字段路径和原因）。
 *
 * 结构里没有声明的字段会被丢掉而不是报错——租户接口靠这一点忽略请求体里的 `tenant_id`（需求文档「API 通用约定」）。
 */
import { z } from "zod";
import { AppError } from "./errors.ts";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, isUuid } from "./pagination.ts";
import { notFound, versionRequired } from "./services/errors.ts";

export type InputLocation = "body" | "querystring" | "headers";

const errorMap: z.ZodErrorMap = (issue, context) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "必填" : "类型不正确" };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `只能是：${issue.options.join("、")}` };
    case z.ZodIssueCode.too_small:
      if (issue.type === "array") return { message: `至少 ${issue.minimum} 项` };
      return { message: issue.type === "string" ? `至少 ${issue.minimum} 个字符` : `不能小于 ${issue.minimum}` };
    case z.ZodIssueCode.too_big:
      if (issue.type === "array") return { message: `最多 ${issue.maximum} 项` };
      return { message: issue.type === "string" ? `最多 ${issue.maximum} 个字符` : `不能大于 ${issue.maximum}` };
    case z.ZodIssueCode.not_finite:
      return { message: "必须是有限的数字" };
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `只能是：${issue.options.join("、")}` };
    case z.ZodIssueCode.invalid_literal:
      return { message: `只能是：${String(issue.expected)}` };
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === "email" ? "不是合法的邮箱" : "格式不正确" };
    default:
      return { message: context.defaultError };
  }
};

/** 孤立的代理字符：前半个后面没有后半个，或后半个前面没有前半个。 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const NUL_MESSAGE = "不能包含空字符（NUL）";
const SURROGATE_MESSAGE = "包含不完整的字符（多半是被截断的表情符号），请删掉后重试";

/** 数据库的文本和 JSON 类型存不了的字符串：带 NUL 的、带孤立代理字符（半个表情符号）的。没有问题返回 null。 */
function unstorableReason(text: string): string | null {
  if (text.includes("\u0000")) return NUL_MESSAGE;
  return LONE_SURROGATE.test(text) ? SURROGATE_MESSAGE : null;
}

/** 找出值里第一个数据库存不了的字符串（对象的键也算）：返回它的路径和原因；没有则返回 null。 */
function findUnstorableString(value: unknown, path: string): { path: string; message: string } | null {
  if (typeof value === "string") {
    const message = unstorableReason(value);
    return message === null ? null : { path, message };
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findUnstorableString(item, `${path}/${index}`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const keyProblem = unstorableReason(key);
      const found = findUnstorableString(item, `${path}/${keyProblem === null ? key : key.replaceAll("\u0000", "").replace(new RegExp(LONE_SURROGATE, "g"), "\uFFFD")}`);
      if (found !== null) return found;
      if (keyProblem !== null) return { path: path === "" ? "/" : path, message: keyProblem };
    }
  }
  return null;
}

export interface InputIssue {
  /** 出问题的字段，如 `/city_id` */
  path: string;
  message: string;
  /** 机器可读的原因代码（图形的问题用它，前端按代码显示自己的定稿文字） */
  reason?: string;
  /** 原因的补充信息：数字（交叉的两条边的点号、上限），或指明是哪一条的编号、名称 */
  detail?: Record<string, number | string>;
}

/** 字段的格式都对、但内容不合业务规则（编码格式、时区、引用的记录不存在等）时，用同一种错误返回。 */
export function validationFailed(location: InputLocation, issues: InputIssue[]): AppError {
  return new AppError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location, issues });
}

/**
 * 校验一份输入（请求体或查询参数）。所有接口的输入都从这里进来，所以对「所有字符串」的统一要求也放在这里：
 * 任何位置的字符串都不能带 NUL 字符或孤立的代理字符（数据库的文本和 JSON 类型不接受它们，带进去会变成 500）。
 */
export function parseInput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  location: InputLocation,
): z.output<Schema> {
  const unstorable = findUnstorableString(value, "");
  if (unstorable !== null) throw validationFailed(location, [{ path: unstorable.path === "" ? "/" : unstorable.path, message: unstorable.message }]);
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

/**
 * 请求头 `If-Match` 里的版本号（需求文档「并发修改」）。接受 `"3"` 和 `3` 两种写法；
 * 没带是 428，写的不是正整数是 400。
 */
export function ifMatchVersion(header: unknown): number {
  if (header === undefined) throw versionRequired();
  const match = typeof header === "string" ? /^\s*(?:"([1-9]\d{0,8})"|([1-9]\d{0,8}))\s*$/.exec(header) : null;
  if (!match) {
    throw validationFailed("headers", [{ path: "/if-match", message: "必须是版本号（正整数），例如 \"3\"" }]);
  }
  return Number(match[1] ?? match[2]);
}

/**
 * 请求头 `Idempotency-Key`（需求文档「幂等」：创建类 POST 必须带）。8 到 128 位的字母、数字、`_ . : -`（UUID 就行）。
 * 没带、格式不对都是 400。
 */
export function idempotencyKey(header: unknown): string {
  if (typeof header !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(header.trim())) {
    throw validationFailed("headers", [
      { path: "/idempotency-key", message: header === undefined ? "必填：新增时要带请求头 Idempotency-Key（例如一个 UUID）" : "必须是 8 到 128 位的字母、数字或 _ . : -" },
    ]);
  }
  return header.trim();
}
