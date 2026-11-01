/**
 * 收款账户和银行转账文件在页面上的说法（M5-02，ADR 0051）。
 */
import type { BankFileStatus, ChargeBearer, PayoutAccountStatus } from "@nozomi/domain";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const BANK_FILES_PAGE = "/platform/finance/bank-files";
export const PLATFORM_PAYOUT_ACCOUNTS_PAGE = "/platform/finance/payout-accounts";
export const TENANT_PAYOUT_ACCOUNTS_PAGE = "/statements/payout-accounts";

export function bankFilePath(id: string): string {
  return `${BANK_FILES_PAGE}/${encodeURIComponent(id)}`;
}

export const BANK_FILE_STATUS_BADGES: Readonly<Record<BankFileStatus, BadgeSpec>> = {
  generated: { tone: "info", label: "已生成，待下载" },
  downloaded: { tone: "warning", label: "已下载，待回填" },
  paid: { tone: "success", label: "已付款" },
  void: { tone: "neutral", label: "已作废" },
};

export const PAYOUT_ACCOUNT_STATUS_BADGES: Readonly<Record<PayoutAccountStatus, BadgeSpec>> = {
  pending: { tone: "warning", label: "待审核" },
  active: { tone: "success", label: "生效中" },
  superseded: { tone: "neutral", label: "已被替换" },
  rejected: { tone: "danger", label: "已驳回" },
  withdrawn: { tone: "neutral", label: "已撤回" },
};

export const CHARGE_BEARER_NAMES: Readonly<Record<ChargeBearer, string>> = {
  SHA: "SHA：各付各的（常用）",
  OUR: "OUR：手续费都由平台付",
  BEN: "BEN：手续费都由收款人付",
};
