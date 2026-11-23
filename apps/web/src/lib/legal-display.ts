/**
 * 官网的三份法律文案页面（M9E-24，ADR 0107）的地址和名称。名称是日文（先只有日文，其他语言随 M11），
 * 主站页脚、预订第 4 步「核对订单」、嵌入页顶部都用这一份。
 */
export const LEGAL_TOKUSHOHO_PATH = "/legal/tokushoho";
export const LEGAL_CANCELLATION_PATH = "/legal/cancellation";
export const LEGAL_PRIVACY_PATH = "/legal/privacy";

export interface LegalPageLink {
  path: string;
  /** 页面标题，也是链接文字 */
  title: string;
}

export const LEGAL_PAGE_LINKS: readonly LegalPageLink[] = [
  { path: LEGAL_TOKUSHOHO_PATH, title: "特定商取引法に基づく表記" },
  { path: LEGAL_CANCELLATION_PATH, title: "キャンセルポリシー" },
  { path: LEGAL_PRIVACY_PATH, title: "プライバシーポリシー" },
];
