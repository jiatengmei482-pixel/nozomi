/**
 * 银行转账批量文件和供应商收款账户的纯规则（M5-02，ADR 0051）。不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「财务结算」（生成付款批次 → 双人复核 → 银行转账：导出批量付款文件，付款后回填银行流水号；结算账户变更要审核）；
 * 负责人决定（2026-10-27）：按国际汇款惯例自定范例格式，字段参考 SWIFT 汇款，以后可按银行模板调整。
 *
 * - 校验（IBAN、SWIFT/BIC、账号、SWIFT 字符集）只返回原因代码，不回显输入：完整账号不能进错误信息和日志。
 * - 文件的列定义都在 `BANK_FILE_TEMPLATES`：对接某家银行的模板就加一项，流程不用动。
 * - 金额从最小单位整数按字符换算成字符串（`formatMajor`），合计用整数相加（`sumMinor`），全程不用浮点。
 */
import { sumMinor } from "./billing.ts";
import { type CurrencyCode, formatMajor, isCurrencyCode } from "./money.ts";

export const CHARGE_BEARERS = ["OUR", "SHA", "BEN"] as const;
export type ChargeBearer = (typeof CHARGE_BEARERS)[number];

/** 账号的种类：IBAN 按校验位校验；其他账号只查字符和长度 */
export const PAYOUT_ACCOUNT_KINDS = ["iban", "account"] as const;
export type PayoutAccountKind = (typeof PAYOUT_ACCOUNT_KINDS)[number];

/** pending 待审核、active 生效、superseded 已被替换、rejected 已驳回、withdrawn 已撤回 */
export const PAYOUT_ACCOUNT_STATUSES = ["pending", "active", "superseded", "rejected", "withdrawn"] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

/** generated 已生成、downloaded 已下载、paid 已付款（全部回填）、void 已作废 */
export const BANK_FILE_STATUSES = ["generated", "downloaded", "paid", "void"] as const;
export type BankFileStatus = (typeof BANK_FILE_STATUSES)[number];

export const BANK_FILE_FORMATS = ["csv", "xlsx"] as const;
export type BankFileFormat = (typeof BANK_FILE_FORMATS)[number];

export const BANK_TRANSFER_RULES = {
  /** 名称最长：SWIFT 每行 35 个字符，两行 */
  nameMaxLength: 70,
  /** 地址最长：三行 */
  addressMaxLength: 105,
  /** 其他账号规范化后的长度（SWIFT 59 栏上限 34；至少要有末 4 位） */
  accountMinLength: 4,
  accountMaxLength: 34,
  /** 付款参考最长：SWIFT 70 栏四行 */
  referenceMaxLength: 140,
  bankReferenceMaxLength: 64,
  /** 替换了旧账户、批准不到这么多天的账户，预览里提醒财务核实（待负责人确认） */
  recentChangeDays: 7,
  defaultChargeBearer: "SHA" as ChargeBearer,
  /** 一次回填最多多少笔 */
  maxPaymentsPerRequest: 500,
} as const;

// ---- 账号、IBAN、SWIFT/BIC ----

/** 规范化账号：去掉空格和连字符，转大写（人常常按 4 位一组抄写）。 */
export function normalizeAccountNumber(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/** ISO 13616 IBAN 登记表：国家 → 总长度。 */
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27,
  JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
  NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

/** IBAN 的 mod-97：前 4 位挪到末尾，字母换成两位数字，逐位取余（不用大整数、不用浮点）。 */
function ibanMod97(rearranged: string): number {
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const digits = code >= 65 ? String(code - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/** 给定国家和 BBAN 算两位校验位（ISO 7064 MOD 97-10）。给测试现算虚构的 IBAN 用。 */
export function ibanCheckDigits(country: string, bban: string): string {
  return String(98 - ibanMod97(`${bban}${country}00`)).padStart(2, "0");
}

/** 规范化之后的 IBAN 是否合格：国家在登记表里、长度对、校验位对。 */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length) return false;
  return ibanMod97(`${iban.slice(4)}${iban.slice(0, 4)}`) === 1;
}

/** ISO 9362：4 位机构（字母数字）+ 2 位国家（字母）+ 2 位地区 + 可选 3 位分行，共 8 或 11 位。大写。 */
export function isValidSwiftBic(bic: string): boolean {
  return /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic);
}

export type AccountNumberIssue = "REQUIRED" | "IBAN_INVALID" | "ACCOUNT_FORMAT";

/** 规范化之后的账号是否合格。 */
export function accountNumberIssue(kind: PayoutAccountKind, normalized: string): AccountNumberIssue | null {
  if (normalized === "") return "REQUIRED";
  if (kind === "iban") return isValidIban(normalized) ? null : "IBAN_INVALID";
  const { accountMinLength, accountMaxLength } = BANK_TRANSFER_RULES;
  return normalized.length >= accountMinLength && normalized.length <= accountMaxLength && /^[A-Z0-9]+$/.test(normalized) ? null : "ACCOUNT_FORMAT";
}

export function accountLast4(normalized: string): string {
  return normalized.slice(-4);
}

/** 列表、复核、审计里显示的样子：只有末 4 位。 */
export function maskAccount(last4: string): string {
  return `•••• ${last4}`;
}

// ---- 名称、地址：SWIFT X 字符集 ----

export type SwiftTextIssue = "REQUIRED" | "TOO_LONG" | "CHARSET" | "LEADING";

/** 把人填的文字整理一下：去首尾空白、连续空白合成一个。 */
export function normalizeSwiftText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * 一段写进 SWIFT 报文的文字是否合格：只能是 X 字符集（`A-Za-z0-9 /-?:().,'+`），不能以 `-`、`:` 开头。
 * 中文、`&` 银行传不了，提前拦住比转账时被退回好（待负责人确认）。
 */
export function swiftTextIssue(text: string, maxLength: number): SwiftTextIssue | null {
  if (text === "") return "REQUIRED";
  if (text.length > maxLength) return "TOO_LONG";
  if (!/^[A-Za-z0-9 /\-?:().,'+]+$/.test(text)) return "CHARSET";
  return /^[-:]/.test(text) ? "LEADING" : null;
}

export interface PayoutAccountFields {
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
}

export type PayoutAccountIssueReason = SwiftTextIssue | AccountNumberIssue | "SWIFT_BIC_INVALID" | "UNSUPPORTED_CURRENCY";

export interface PayoutAccountIssue {
  path: string;
  reason: PayoutAccountIssueReason;
}

export const PAYOUT_ACCOUNT_ISSUE_MESSAGES: Readonly<Record<PayoutAccountIssueReason, string>> = {
  REQUIRED: "必填",
  TOO_LONG: "太长了",
  CHARSET: "只能用英文字母、数字和 / - ? : ( ) . , ' +（中文、& 银行传不了，请写英文）",
  LEADING: "不能以 - 或 : 开头",
  IBAN_INVALID: "IBAN 不对（国家、长度或校验位），请核对",
  ACCOUNT_FORMAT: "账号要 4–34 位英文字母和数字",
  SWIFT_BIC_INVALID: "SWIFT/BIC 要 8 或 11 位，如 ABCDJPJT 或 ABCDJPJTXXX",
  UNSUPPORTED_CURRENCY: "平台不支持这种币种",
};

/** 账户除账号以外的字段（提交时、生成文件时都查一遍；生成时账号是密文，另外查）。 */
export function payoutAccountFieldIssues(fields: PayoutAccountFields): PayoutAccountIssue[] {
  const issues: PayoutAccountIssue[] = [];
  const { nameMaxLength, addressMaxLength } = BANK_TRANSFER_RULES;
  const text = (path: string, value: string, max: number): void => {
    const reason = swiftTextIssue(value, max);
    if (reason !== null) issues.push({ path, reason });
  };
  text("/beneficiary_name", fields.beneficiaryName, nameMaxLength);
  text("/beneficiary_address", fields.beneficiaryAddress, addressMaxLength);
  text("/bank_name", fields.bankName, nameMaxLength);
  text("/bank_address", fields.bankAddress, addressMaxLength);
  if (!isValidSwiftBic(fields.swiftBic)) issues.push({ path: "/swift_bic", reason: "SWIFT_BIC_INVALID" });
  return issues;
}

/** 提交账户时的整体校验（字段都已规范化）。 */
export function payoutAccountIssues(input: PayoutAccountFields & { currency: string; accountKind: PayoutAccountKind; accountNumber: string }): PayoutAccountIssue[] {
  const issues = payoutAccountFieldIssues(input);
  if (!isCurrencyCode(input.currency)) issues.push({ path: "/currency", reason: "UNSUPPORTED_CURRENCY" });
  const number = accountNumberIssue(input.accountKind, input.accountNumber);
  if (number !== null) issues.push({ path: "/account_number", reason: number });
  return issues;
}

/** 这个账户算不算「最近变更」：替换了旧账户、批准不到 `recentChangeDays` 天。第一次填的账户不算。 */
export function accountRecentlyChanged(account: { activatedAt: Date | null; replacedPrevious: boolean }, now: Date): boolean {
  if (account.activatedAt === null || !account.replacedPrevious) return false;
  return now.getTime() - account.activatedAt.getTime() < BANK_TRANSFER_RULES.recentChangeDays * 24 * 3_600_000;
}

// ---- 账单能不能进文件 ----

export const STATEMENT_FILE_ISSUES = ["NOT_APPROVED", "NON_POSITIVE_AMOUNT", "CURRENCY_UNSUPPORTED", "ACCOUNT_MISSING", "ACCOUNT_PENDING", "ACCOUNT_INVALID", "ACCOUNT_UNREADABLE"] as const;
export type StatementFileIssue = (typeof STATEMENT_FILE_ISSUES)[number];

export const STATEMENT_FILE_ISSUE_MESSAGES: Readonly<Record<StatementFileIssue, string>> = {
  NOT_APPROVED: "这张账单不是「已复核通过、待付款」",
  NON_POSITIVE_AMOUNT: "金额不是正数，不需要转账",
  CURRENCY_UNSUPPORTED: "平台不支持这种币种",
  ACCOUNT_MISSING: "供应商还没有这种币种的收款账户",
  ACCOUNT_PENDING: "供应商的收款账户还在审核，没有生效",
  ACCOUNT_INVALID: "收款账户的内容不合规则，请供应商重新提交",
  ACCOUNT_UNREADABLE: "收款账号解不开（数据加密密钥可能换过），请供应商重新提交",
};

/** 一张账单现在能不能进转账文件；能返回 null。账号本身是密文，不在这里查（发起生成时另外解开查）。 */
export function statementFileIssue(
  statement: { status: string; approvalId: string | null; totalMinor: number; currency: string },
  accounts: { active: PayoutAccountFields | null; hasPending: boolean },
): StatementFileIssue | null {
  if (statement.status !== "in_payout" || statement.approvalId === null) return "NOT_APPROVED";
  if (statement.totalMinor <= 0) return "NON_POSITIVE_AMOUNT";
  if (!isCurrencyCode(statement.currency)) return "CURRENCY_UNSUPPORTED";
  if (accounts.active === null) return accounts.hasPending ? "ACCOUNT_PENDING" : "ACCOUNT_MISSING";
  return payoutAccountFieldIssues(accounts.active).length > 0 ? "ACCOUNT_INVALID" : null;
}

// ---- 付款参考、流水号 ----

/** 付款参考 / 用途：对得回账单的英文写法（SWIFT 字符集内）。 */
export function paymentReference(statementNo: string, period: string): string {
  return `NOZOMI ${statementNo} SETTLEMENT ${period}`;
}

/** 银行流水号：1–64 个可见 ASCII 字符（不含引号、尖括号），可以有空格之外的常见分隔符。 */
export function isBankReference(text: string): boolean {
  return text.length >= 1 && text.length <= BANK_TRANSFER_RULES.bankReferenceMaxLength && /^[A-Za-z0-9][A-Za-z0-9/_.:-]*$/.test(text);
}

// ---- 文件内容 ----

export interface BankFileItem {
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  bankAddress: string;
  swiftBic: string;
  /** 完整账号：只在生成文件时解密得到，用完即弃 */
  accountNumber: string;
  amountMinor: number;
  reference: string;
}

export interface BankFileContent {
  fileNo: string;
  payDate: string;
  currency: CurrencyCode;
  chargeBearer: ChargeBearer;
  /** 文件生成时间（ISO 8601）：写进 Excel 的汇总，不用当前时间，同一个文件每次下载内容相同 */
  generatedAt: string;
  items: readonly BankFileItem[];
}

interface BankFileColumn {
  header: string;
  /** 一笔付款在这一列的内容 */
  value(item: BankFileItem, seq: number, file: BankFileContent): string;
  /** 合计行在这一列的内容；不给是空 */
  total?(file: BankFileContent, totalMinor: number): string;
  /** Excel 里的列宽 */
  width: number;
}

export interface BankFileTemplate {
  key: string;
  columns: readonly BankFileColumn[];
  /** CSV 开头带 UTF-8 BOM（Excel 打开不乱码） */
  csvBom: boolean;
  csvLineEnding: "\r\n" | "\n";
  /** 最后加一行合计 */
  trailer: boolean;
}

/**
 * 转账文件的模板：**列定义只在这里**。以后对接某家银行就加一项（ADR 0051），文件记下用的哪个模板。
 * 现在只有一个按国际汇款惯例的范例格式（负责人决定 2026-10-27），未按任何具体银行验证过。
 */
export const BANK_FILE_TEMPLATES = {
  "swift-generic-v1": {
    key: "swift-generic-v1",
    csvBom: true,
    csvLineEnding: "\r\n",
    trailer: true,
    columns: [
      { header: "Seq", width: 8, value: (_item, seq) => String(seq), total: () => "TOTAL" },
      { header: "Beneficiary Name", width: 36, value: (item) => item.beneficiaryName },
      { header: "Beneficiary Address", width: 44, value: (item) => item.beneficiaryAddress },
      { header: "Bank Name", width: 36, value: (item) => item.bankName },
      { header: "Bank Address", width: 44, value: (item) => item.bankAddress },
      { header: "SWIFT/BIC", width: 14, value: (item) => item.swiftBic },
      { header: "Account No/IBAN", width: 36, value: (item) => item.accountNumber },
      { header: "Currency", width: 10, value: (_item, _seq, file) => file.currency, total: (file) => file.currency },
      { header: "Amount", width: 16, value: (item, _seq, file) => formatMajor(item.amountMinor, file.currency), total: (file, totalMinor) => formatMajor(totalMinor, file.currency) },
      { header: "Value Date", width: 12, value: (_item, _seq, file) => file.payDate },
      { header: "Payment Reference", width: 48, value: (item) => item.reference, total: (file) => `${file.items.length} PAYMENTS` },
      { header: "Charges", width: 9, value: (_item, _seq, file) => file.chargeBearer },
    ],
  },
} as const satisfies Record<string, BankFileTemplate>;

export type BankFileTemplateKey = keyof typeof BANK_FILE_TEMPLATES;
export const DEFAULT_BANK_FILE_TEMPLATE: BankFileTemplateKey = "swift-generic-v1";

export function isBankFileTemplate(key: string): key is BankFileTemplateKey {
  return Object.hasOwn(BANK_FILE_TEMPLATES, key);
}

/** 按模板排出文件的表格：第一行列头、中间每笔一行、（模板要的话）最后一行合计。CSV 和 Excel 用同一份。 */
export function bankFileRows(templateKey: BankFileTemplateKey, file: BankFileContent): string[][] {
  const template: BankFileTemplate = BANK_FILE_TEMPLATES[templateKey];
  const rows: string[][] = [template.columns.map((column) => column.header)];
  file.items.forEach((item, index) => rows.push(template.columns.map((column) => column.value(item, index + 1, file))));
  if (template.trailer) {
    const totalMinor = bankFileTotal(file.items);
    rows.push(template.columns.map((column) => column.total?.(file, totalMinor) ?? ""));
  }
  return rows;
}

export function bankFileTotal(items: readonly { amountMinor: number }[]): number {
  return sumMinor(items.map((item) => item.amountMinor));
}

const FORMULA_LEAD = /^[=+\-@\t\r＝＋－＠]/;

/** 公式注入防护：表格软件会当成公式执行的开头前面加一个单引号。 */
export function guardCsvFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

function csvField(text: string): string {
  const guarded = guardCsvFormula(text);
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** 文件的 CSV 文本（RFC 4180；BOM、换行按模板）。 */
export function bankFileCsv(templateKey: BankFileTemplateKey, file: BankFileContent): string {
  const template: BankFileTemplate = BANK_FILE_TEMPLATES[templateKey];
  const lines = bankFileRows(templateKey, file).map((row) => row.map(csvField).join(","));
  return `${template.csvBom ? "﻿" : ""}${lines.join(template.csvLineEnding)}${template.csvLineEnding}`;
}

/** Excel 的「Summary」工作表：方便核对。 */
export function bankFileSummaryRows(templateKey: BankFileTemplateKey, file: BankFileContent): string[][] {
  return [
    ["File No", file.fileNo],
    ["Value Date", file.payDate],
    ["Currency", file.currency],
    ["Payments", String(file.items.length)],
    ["Total Amount", formatMajor(bankFileTotal(file.items), file.currency)],
    ["Charges", file.chargeBearer],
    ["Template", templateKey],
    ["Generated At", file.generatedAt],
  ];
}

export function bankFileColumnWidths(templateKey: BankFileTemplateKey): number[] {
  const template: BankFileTemplate = BANK_FILE_TEMPLATES[templateKey];
  return template.columns.map((column) => column.width);
}

/** 文件名只有日期、币种、文件号，没有供应商名和账号。 */
export function bankFileName(file: { payDate: string; currency: string; fileNo: string }, format: BankFileFormat): string {
  return `nozomi-bank-transfer-${file.payDate}-${file.currency}-${file.fileNo}.${format}`;
}
