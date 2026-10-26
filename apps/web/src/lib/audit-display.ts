/**
 * 审计日志的显示（docs/design/pages/platform-settings.md 第 3 节）：对象类型和操作的中文名、从改前改后的值里找名称、
 * 「改了什么」的对照。审计日志是后台里唯一允许出现字段原名的地方——排查问题时要拿它去对接口和数据库。
 */
import { EXCEPTION_STATUS_NAMES, ORDER_STATUS_NAMES, PLATFORM_ROLES, PRODUCT_STATUS_NAMES, STATEMENT_STATUS_NAMES, TENANT_ROLES, TICKET_STATUS_NAMES } from "@nozomi/domain";
import type { AuditActorType, AuditLog, AuditSource } from "../api/platform.ts";
import { APPROVAL_KIND_NAMES } from "./channel-display.ts";
import { displayName } from "./master-display.ts";

export const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  platform_user: "平台员工",
  tenant: "供应商",
  tenant_user: "供应商的账号",
  integration: "系统状态",
  integration_secret: "第三方密钥",
  city: "城市",
  place: "地点",
  vehicle_group: "车型组",
  addon: "附加服务",
  area: "区域",
  brand: "子品牌",
  product: "商品",
  price_rule: "价格规则",
  adjust_rule: "调价规则",
  holiday: "节假日",
  inventory: "库存",
  fx_fetch: "汇率拉取",
  fx_rate: "汇率",
  fx_lock: "汇率人工锁定",
  channel: "渠道",
  markup_rule: "加价规则",
  api_client: "API 客户端",
  approval: "双人复核",
  platform_role: "角色",
  tenant_profile: "供应商的企业信息",
  tenant_file: "供应商的文件",
  tenant_document: "供应商的资质",
  tenant_contract: "供应商的合同",
  driver: "司机",
  vehicle: "车辆",
  order: "订单",
  driver_link: "司机链接",
  tenant_webhook: "供应商的 Webhook 设置",
  webhook_delivery: "Webhook 推送",
  cancellation_policy: "平台取消政策",
  order_change: "改单",
  extra_charge: "事后加收",
  refund: "退款",
  rescue: "救援改派",
  rescue_offer: "救援单",
  compensation_table: "客人赔付表",
  order_exception: "订单异常",
  ticket: "工单",
  statement: "账单",
  payout_batch: "付款批次",
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
  fetch: "立即拉取",
  hold: "挂起待确认",
  confirm: "确认生效",
  dismiss: "放弃",
  stale: "过期告警",
  request: "发起复核",
  approve: "批准",
  reject: "驳回",
  withdraw: "撤回",
  rotate: "轮换密钥",
  revoke: "吊销",
  activate: "启用",
  pause: "暂停",
  lock: "锁定生效",
  unlock: "解除锁定",
  expire: "到期失效",
  mfa_enroll_start: "开始绑定两步验证",
  mfa_enroll: "绑定两步验证",
  mfa_verify: "通过两步验证",
  mfa_failed: "两步验证失败",
  mfa_recovery_codes: "重新生成恢复码",
  mfa_reset: "重置两步验证",
  clear_ip_allowlist: "清空 IP 白名单",
  submit: "提交审核",
  return: "退回补充",
  sign: "签约",
  start_trial: "开始试运营",
  promote: "转为正式",
  terminate: "清退",
  observe: "观察期变化",
  upload: "上传",
  request_supplement: "要求补充",
  set: "填写",
  replace: "更换",
  clear: "清空",
  assign: "指派",
  reassign: "改派",
  issue: "生成",
  retry: "重试",
  test: "发送测试",
  cancel: "取消",
  change: "改单",
  decide: "审核",
  charge: "扣款",
  trigger: "发起",
  offer: "发救援单",
  accept: "接单",
  waive: "免除",
  claim: "认领",
  close: "关闭",
  reply: "回复",
  note: "备注",
  request_reply: "征求供应商意见",
  pay: "登记已付",
  dispute: "提异议",
  void: "作废",
};

/**
 * 「操作」筛选的选项：同名的几个动作合成一项（「启用」= enable、activate；「暂停」= suspend、pause），
 * 选项的值是这几个动作用逗号连起来（接口按任一个查）。按名称排在第一次出现的位置。
 */
export const ACTION_FILTER_OPTIONS: readonly { value: string; label: string }[] = (() => {
  const groups = new Map<string, string[]>();
  for (const [action, label] of Object.entries(ACTION_NAMES)) groups.set(label, [...(groups.get(label) ?? []), action]);
  return [...groups].map(([label, actions]) => ({ value: actions.join(","), label }));
})();

/** 网址里的「操作」：一个或几个动作，逗号分隔；只认小写字母和下划线，最多 10 个。 */
export function isActionFilter(value: string): boolean {
  const parts = value.split(",");
  return parts.length <= 10 && parts.every((part) => /^[a-z_]{1,40}$/.test(part));
}

/** 网址里只有一个动作（以前的链接）而它属于某个同名的组：选项里对应那一组。 */
export function actionFilterOption(value: string): string {
  return ACTION_FILTER_OPTIONS.find((option) => option.value === value || option.value.split(",").includes(value))?.value ?? value;
}

/** 同一个操作在不同对象上的说法（「关闭」付款批次是锁定，「出」账单是出账）。没列的用上面的通用说法。 */
export const ACTION_NAMES_BY_RESOURCE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  order: { assign: "派车", reassign: "改派", cancel: "取消订单" },
  driver_link: { issue: "生成司机链接" },
  rescue: { trigger: "发起救援", waive: "认定不可抗力" },
  rescue_offer: { accept: "接救援单", reject: "拒绝救援单" },
  ticket: { assign: "认领 / 转交", reply: "留言（供应商看得到）", note: "内部备注", decide: "判定", close: "关闭工单", pay: "登记另付已付", request_reply: "征求供应商意见" },
  order_exception: { claim: "认领 / 转交", close: "写说明关闭" },
  statement: { issue: "出账", confirm: "确认账单", dispute: "提异议", reply: "答复异议", void: "作废并重出" },
  payout_batch: { close: "锁定" },
  extra_charge: { decide: "审核加收" },
  integration_secret: { test: "测试一下" },
};

export const ACTOR_TYPE_NAMES: Readonly<Record<AuditActorType, string>> = { platform_user: "平台员工", tenant_user: "供应商的账号", system: "系统（命令行或定时任务）", anonymous: "没有登录的访问者" };
export const SOURCE_NAMES: Readonly<Record<AuditSource, string>> = { console: "后台", api: "接口", cli: "命令行", job: "定时任务" };

/** 认识的写中文；不认识的原样返回（由页面用等宽字体显示）。 */
export function resourceName(resource: string): { text: string; known: boolean } {
  const name = RESOURCE_NAMES[resource];
  return name ? { text: name, known: true } : { text: resource, known: false };
}
/**
 * 操作的中文名。同一个对象上的同一个操作有时要看改后值里的标记才分得清：工单的 `reply` 带 `to_guest: true` 是回复客人
 * （客人和渠道看得到、供应商看不到），否则是给供应商的留言。
 */
export function actionName(action: string, resource?: string, after?: Readonly<Record<string, unknown>> | null): { text: string; known: boolean } {
  if (resource === "ticket" && action === "reply" && after?.["to_guest"] === true) return { text: "回复客人（客人和渠道看得到，供应商看不到）", known: true };
  const name = (resource === undefined ? undefined : ACTION_NAMES_BY_RESOURCE[resource]?.[action]) ?? ACTION_NAMES[action];
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
  hints: "打码后的密钥（只有末 4 位）",
  currency: "币种",
  city_id: "城市",
  tenant_id: "供应商",
  category: "品类",
  mode: "库存模式",
  rounding_unit: "取整单位",
  version: "版本号",
  key: "项目",
  count: "数量",
  type: "类型",
  order_id: "订单",
  priority: "优先级",
  assignee_id: "处理人",
  ticket_no: "工单号",
  outcome: "结论",
  liable_party: "责任方",
  note: "说明",
  body: "内容",
  internal: "内部备注",
  resolution: "处理说明",
  reference: "凭证号",
  statement_no: "账单号",
  period: "周期",
};

/** 只在某一类对象上才这样叫的字段（同名字段在别处意思不同）：双人复核的 `kind` 是复核类别，`resource_id` 是要改的对象。 */
export const FIELD_NAMES_BY_RESOURCE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  approval: { kind: "复核类别", resource: "复核对象的类型", resource_id: "复核对象的编号", summary: "摘要", payload: "申请的内容" },
};

/** 字段的中文名：先看这一类对象专有的，再看通用的；不认识的返回 undefined（页面上只显示原名）。 */
export function fieldName(field: string, resource = ""): string | undefined {
  return FIELD_NAMES_BY_RESOURCE[resource]?.[field] ?? FIELD_NAMES[field];
}

const ROLE_NAMES: Readonly<Record<string, string>> = Object.fromEntries([...PLATFORM_ROLES, ...TENANT_ROLES].map((role) => [role.key, role.name]));
/** 「状态」在各种对象上的说法不一样：供应商是正常 / 已暂停，账号是待激活 / 在用 / 已停用，商品是草稿 / 已上架 / 已下架，主数据是启用 / 已停用。 */
function statusNames(resource: string): Readonly<Record<string, string>> {
  if (resource === "tenant") return { active: "正常", suspended: "已暂停" };
  if (resource === "ticket") return Object.fromEntries(Object.entries(TICKET_STATUS_NAMES).map(([key, name]) => [key, name.replace("租户", "供应商")]));
  if (resource === "order_exception") return EXCEPTION_STATUS_NAMES;
  if (resource === "statement") return STATEMENT_STATUS_NAMES;
  if (resource === "payout_batch") return { open: "收账单中", closed: "已锁定", paid: "已付款" };
  if (resource === "order") return ORDER_STATUS_NAMES;
  if (resource === "platform_user" || resource === "tenant_user") return { invited: "待激活", active: "在用", disabled: "已停用" };
  if (resource === "product") return PRODUCT_STATUS_NAMES;
  return { active: "启用", disabled: "已停用" };
}
function enumName(key: string, value: string, resource: string): string | undefined {
  if (key === "status") return statusNames(resource)[value];
  if (key === "role") return ROLE_NAMES[value];
  if (key === "mode") return ({ unlimited: "不限量", limited: "限量" } as Record<string, string>)[value];
  if (resource === "approval" && key === "kind") return (APPROVAL_KIND_NAMES as Readonly<Record<string, string>>)[value];
  if (resource === "approval" && key === "resource") return RESOURCE_NAMES[value];
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
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(year, month - 1, day);
  // 2026-02-31 这样的日期会被挪到下个月：不认（「到」这一头也先按当天核对，再往后挪一天）
  if (Number.isNaN(start.getTime()) || start.getMonth() !== month - 1 || start.getDate() !== day) return null;
  return (endExclusive ? new Date(year, month - 1, day + 1) : start).toISOString();
}

export function localDate(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
