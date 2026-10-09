/**
 * 审计日志的显示（docs/design/pages/platform-settings.md 第 3 节）：对象类型和操作的中文名、从改前改后的值里找名称、
 * 「改了什么」的对照。审计日志是后台里唯一允许出现字段原名的地方——排查问题时要拿它去对接口和数据库。
 */
import { PLATFORM_ROLES, PRODUCT_STATUS_NAMES, TENANT_ROLES } from "@nozomi/domain";
import type { AuditActorType, AuditLog, AuditSource } from "../api/platform.ts";
import { displayName } from "./master-display.ts";

export const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  platform_user: "平台员工",
  tenant: "供应商",
  tenant_user: "供应商的账号",
  integration: "系统状态",
  city: "城市",
  place: "地点",
  vehicle_group: "车型组",
  addon: "附加服务",
  area: "区域",
  brand: "子品牌",
  product: "商品",
};

export const ACTION_NAMES: Readonly<Record<string, string>> = {
  login: "登录",
  login_failed: "登录失败",
  logout: "退出登录",
  create: "新建",
  update: "修改",
  delete: "删除",
  invite: "邀请",
  accept_invite: "接受邀请",
  disable: "停用",
  enable: "启用",
  suspend: "暂停",
  resume: "恢复",
  publish: "上架",
  unpublish: "下架",
  change_role: "改角色",
  change_password: "修改密码",
  request_password_reset: "发出密码重置",
  reset_password: "重设密码",
  view: "查看",
};

export const ACTOR_TYPE_NAMES: Readonly<Record<AuditActorType, string>> = { platform_user: "平台员工", tenant_user: "供应商的账号", system: "系统（服务器上的命令）", anonymous: "没有登录的访问者" };
export const SOURCE_NAMES: Readonly<Record<AuditSource, string>> = { console: "后台", api: "接口", cli: "命令行" };

/** 认识的写中文；不认识的原样返回（由页面用等宽字体显示）。 */
export function resourceName(resource: string): { text: string; known: boolean } {
  const name = RESOURCE_NAMES[resource];
  return name ? { text: name, known: true } : { text: resource, known: false };
}
export function actionName(action: string): { text: string; known: boolean } {
  const name = ACTION_NAMES[action];
  return name ? { text: name, known: true } : { text: action, known: false };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** 对象的名称：从这条记录的改后值、改前值里找（依次看 name、email、code、title；多语言的取显示名）。找不到返回 null。 */
export function objectName(log: Pick<AuditLog, "before" | "after">): string | null {
  for (const side of [log.after, log.before]) {
    if (side === null) continue;
    for (const key of ["name", "email", "code", "title"]) {
      const value = side[key];
      if (typeof value === "string" && value.trim() !== "") return value;
      if (isRecord(value)) {
        const shown = displayName(value as Record<string, string>).text;
        if (shown !== "") return shown;
      }
    }
  }
  return null;
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** 常见的字段名 → 中文（逐步补）；不认识的只显示原名。 */
export const FIELD_NAMES: Readonly<Record<string, string>> = {
  name: "名称",
  email: "邮箱",
  role: "角色",
  status: "状态",
  reason: "原因",
  temporary_password: "用了临时密码",
  must_change_password: "必须先改密码",
  code: "编码",
  title: "标题",
  currency: "币种",
  city_id: "城市",
  tenant_id: "供应商",
  category: "品类",
  mode: "库存模式",
  rounding_unit: "取整单位",
  version: "版本号",
  key: "项目",
  count: "数量",
};

const ROLE_NAMES: Readonly<Record<string, string>> = Object.fromEntries([...PLATFORM_ROLES, ...TENANT_ROLES].map((role) => [role.key, role.name]));
/** 「状态」在各种对象上的说法不一样：供应商是正常 / 已暂停，账号是待激活 / 在用 / 已停用，商品是草稿 / 已上架 / 已下架，主数据是启用 / 已停用。 */
function statusNames(resource: string): Readonly<Record<string, string>> {
  if (resource === "tenant") return { active: "正常", suspended: "已暂停" };
  if (resource === "platform_user" || resource === "tenant_user") return { invited: "待激活", active: "在用", disabled: "已停用" };
  if (resource === "product") return PRODUCT_STATUS_NAMES;
  return { active: "启用", disabled: "已停用" };
}
function enumName(key: string, value: string, resource: string): string | undefined {
  if (key === "status") return statusNames(resource)[value];
  if (key === "role") return ROLE_NAMES[value];
  if (key === "mode") return ({ unlimited: "不限量", limited: "限量" } as Record<string, string>)[value];
  return undefined;
}

export interface ShownValue {
  /** 一行里放得下的文字；是文本块时是缩进好的全文 */
  text: string;
  /** 认识的枚举：中文后面带的原值 */
  raw?: string;
  /** 一组东西（对象、数组）：显示成文本块 */
  block: boolean;
  empty: boolean;
}

/** 一个值怎么显示：文字原样；是 / 否；认识的枚举换成中文并带原值；空的写「（空）」；一组东西是缩进好的文本块。金额、日期不做换算。 */
export function shownValue(key: string, value: unknown, resource = ""): ShownValue {
  if (value === null || value === undefined || value === "") return { text: "（空）", block: false, empty: true };
  if (typeof value === "boolean") return { text: value ? "是" : "否", block: false, empty: false };
  if (typeof value === "string") {
    const known = enumName(key, value, resource);
    return known ? { text: known, raw: value, block: false, empty: false } : { text: value, block: value.includes("\n"), empty: false };
  }
  if (typeof value === "number" || typeof value === "bigint") return { text: String(value), block: false, empty: false };
  return { text: JSON.stringify(value, null, 2), block: true, empty: false };
}

export interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export interface Diff {
  /** both：改前改后都有；after：只有改后（新建、邀请、登录失败的原因）；before：只有改前（删除）；none：都没有 */
  kind: "both" | "after" | "before" | "none";
  rows: DiffRow[];
  unchanged: number;
}

/** 没有这一项和这一项是空的算一样。 */
const same = (x: unknown, y: unknown): boolean => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

/** 「改了什么」：改前改后都有时逐项比，变了的排前面。 */
export function auditDiff(log: Pick<AuditLog, "before" | "after">): Diff {
  const before = log.before !== null && Object.keys(log.before).length > 0 ? log.before : null;
  const after = log.after !== null && Object.keys(log.after).length > 0 ? log.after : null;
  if (before === null && after === null) return { kind: "none", rows: [], unchanged: 0 };
  if (before === null || after === null) {
    const side = (after ?? before) as Record<string, unknown>;
    return { kind: after !== null ? "after" : "before", rows: Object.keys(side).map((key) => ({ key, before: before?.[key], after: after?.[key], changed: true })), unchanged: 0 };
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const rows = keys.map((key) => ({ key, before: before[key], after: after[key], changed: !same(before[key], after[key]) }));
  return { kind: "both", rows: [...rows.filter((row) => row.changed), ...rows.filter((row) => !row.changed)], unchanged: rows.filter((row) => !row.changed).length };
}

/** 长内容：超过 6 行或 300 个字先折起来。 */
export const FOLD_LINES = 6;
export const FOLD_CHARS = 300;
export function foldable(text: string): { folded: string; lines: number } | null {
  const lines = text.split("\n");
  if (lines.length <= FOLD_LINES && text.length <= FOLD_CHARS) return null;
  const head = lines.slice(0, FOLD_LINES).join("\n");
  return { folded: head.length > FOLD_CHARS ? `${head.slice(0, FOLD_CHARS)}…` : head, lines: lines.length };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 到秒的时间，查看者本地时区。 */
export function localSecond(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
export function utcSecond(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : `${at.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** 查看者本地时区现在的偏移：「UTC+9」「UTC-3:30」。 */
export function localOffsetLabel(at: Date = new Date()): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.trunc(abs / 60)}${abs % 60 === 0 ? "" : `:${pad(abs % 60)}`}`;
}

/** 筛选用的日期（查看者本地的整天）→ 带时区的时刻。`endExclusive`：「到 10-09」= 10-10 00:00 之前。日期不对返回 null。 */
export function localDayInstant(date: string, endExclusive: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (endExclusive ? 1 : 0));
  if (Number.isNaN(at.getTime())) return null;
  // 2026-02-31 这样的日期会被挪到下个月：不认
  if (!endExclusive && (at.getMonth() !== Number(match[2]) - 1 || at.getDate() !== Number(match[3]))) return null;
  return at.toISOString();
}

export function localDate(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
