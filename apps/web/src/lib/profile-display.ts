/**
 * 企业信息和资料修改申请（M4-34，ADR 0071）在两个后台共用的显示：字段的叫法和提示、申请状态的徽标、出错时说什么。
 */
import { PROFILE_FIELD_NAMES } from "@nozomi/domain";
import { ApiError } from "../api/client.ts";
import type { ProfileChangeStatus, ProfileInput } from "../api/onboarding.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const PROFILE_DISPLAY_FIELDS: readonly { key: keyof ProfileInput; label: string; hint?: string; type?: string }[] = [
  { key: "country_code", label: `${PROFILE_FIELD_NAMES.country_code}（两位代码）`, hint: "如 JP、KR。决定要交哪些资质。" },
  { key: "legal_name", label: PROFILE_FIELD_NAMES.legal_name, hint: "和营业执照、登记簿上的一致。" },
  { key: "registration_no", label: PROFILE_FIELD_NAMES.registration_no, hint: "营业执照号、法人登记号或统一社会信用代码。" },
  { key: "address", label: PROFILE_FIELD_NAMES.address },
  { key: "contact_name", label: PROFILE_FIELD_NAMES.contact_name },
  { key: "contact_phone", label: PROFILE_FIELD_NAMES.contact_phone, hint: "带国家码，如 +81 3-1234-5678。", type: "tel" },
  { key: "contact_email", label: PROFILE_FIELD_NAMES.contact_email, type: "email" },
];

export function emptyProfile(): ProfileInput {
  return { country_code: null, legal_name: null, registration_no: null, address: null, contact_name: null, contact_phone: null, contact_email: null };
}

/** 去掉首尾空白，空的写成 null，国家代码转大写（和接口的规整一致）。 */
export function cleanProfile(profile: ProfileInput): ProfileInput {
  const out = emptyProfile();
  for (const key of Object.keys(out) as (keyof ProfileInput)[]) {
    const value = profile[key];
    out[key] = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }
  out.country_code = out.country_code?.toUpperCase() ?? null;
  out.contact_email = out.contact_email?.toLowerCase() ?? null;
  return out;
}

export const PROFILE_CHANGE_BADGES: Readonly<Record<ProfileChangeStatus, BadgeSpec>> = {
  pending: { tone: "warning", label: "等平台审核" },
  approved: { tone: "success", label: "已生效" },
  rejected: { tone: "danger", label: "已驳回" },
  withdrawn: { tone: "neutral", label: "已撤回" },
};

/** 企业信息、资料修改相关的错误码说成人话；不认识的返回 null（由调用方按通用的说）。 */
export function profileProblem(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case "VERSION_CONFLICT":
      return "刚被别人改过。请刷新页面看最新的内容，再改。";
    case "VALIDATION_FAILED":
      return "有填写不对的地方：国家要两位字母代码，邮箱要是邮箱的格式，名称不能为空、不能和现在一样。";
    case "PROFILE_FIELDS_LOCKED":
      return "法定名称、登记号、所在国家不能直接改：法定名称和登记号请用下面的「申请修改」，国家请联系平台。";
    case "PROFILE_CHANGE_PENDING_EXISTS":
      return "已经有一条等平台审核的申请。要改内容，请先撤回那一条再提交。";
    case "PROFILE_CHANGE_REVIEW_PENDING":
      return "这条申请已经发起了复核：请在「待审核」里批准、驳回或撤回那条复核。";
    case "PROFILE_CHANGE_STATE_INVALID":
      return "这条申请已经有结论了。请刷新页面。";
    case "TENANT_TERMINATED":
      return "已清退，不能再修改。";
    default:
      return err.status === 403 ? "你没有权限做这个操作。" : null;
  }
}
