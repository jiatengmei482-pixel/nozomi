/**
 * 供应商名称和企业信息的维护（M4-34，ADR 0071）。纯函数，没有数据库和网络。
 *
 * 字段分三类：
 * - 联系信息（注册地址、联系人、电话、邮箱）：审核通过以后供应商管理员可以直接改，记审计、通知平台；
 * - 要平台审核的（对外显示名称、法定名称、登记号）：供应商提交修改申请，平台一位同事发起复核、另一位批准后才生效，审核期间旧值照常用；
 * - 国家：决定必交资质清单，审核通过以后只有平台能改。
 * 「申请中」的供应商仍按 ADR 0028 直接改企业信息的全部字段（名称不在企业信息里，也走申请）。
 */

/** 企业信息（`tenant_profiles`）的各项。 */
export const PROFILE_KEYS = ["country_code", "legal_name", "registration_no", "address", "contact_name", "contact_phone", "contact_email"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export type ProfileValues = Readonly<Record<ProfileKey, string | null>>;

/** 审核通过以后供应商可以直接改的。 */
export const TENANT_DIRECT_PROFILE_KEYS = ["address", "contact_name", "contact_phone", "contact_email"] as const satisfies readonly ProfileKey[];

/** 要提交平台审核的三项：对外显示名称（`tenants.name`）、法定名称、登记号。 */
export const PROFILE_CHANGE_FIELDS = ["name", "legal_name", "registration_no"] as const;
export type ProfileChangeField = (typeof PROFILE_CHANGE_FIELDS)[number];

export const PROFILE_CHANGE_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ProfileChangeStatus = (typeof PROFILE_CHANGE_STATUSES)[number];

/** 界面、通知里的叫法。 */
export const PROFILE_FIELD_NAMES: Readonly<Record<ProfileKey | ProfileChangeField, string>> = {
  name: "对外显示名称",
  country_code: "所在国家",
  legal_name: "法定名称",
  registration_no: "登记号",
  address: "注册地址",
  contact_name: "联系人",
  contact_phone: "联系电话",
  contact_email: "联系邮箱",
};

/** 长度上限（和迁移 0033 的约束、0240 的约束一致）。 */
export const PROFILE_LIMITS: Readonly<Record<ProfileKey | ProfileChangeField, number>> = {
  name: 100,
  country_code: 2,
  legal_name: 200,
  registration_no: 100,
  address: 300,
  contact_name: 100,
  contact_phone: 40,
  contact_email: 254,
};

export const PROFILE_CHANGE_NOTE_MAX = 500;

/** 两份企业信息哪几项不一样（按 `PROFILE_KEYS` 的顺序）。`before` 为空当作每项都是空。 */
export function changedProfileKeys(before: ProfileValues | null, after: ProfileValues): ProfileKey[] {
  return PROFILE_KEYS.filter((key) => (before?.[key] ?? null) !== after[key]);
}

/**
 * 供应商自己改企业信息时，哪几项改不了（要走申请或只有平台能改）。「申请中」的什么都能改，返回空。
 * 返回的是这次实际改动了、但不允许直接改的那几项。
 */
export function tenantLockedProfileKeys(status: string, before: ProfileValues | null, after: ProfileValues): ProfileKey[] {
  if (status === "applying") return [];
  const direct: readonly string[] = TENANT_DIRECT_PROFILE_KEYS;
  return changedProfileKeys(before, after).filter((key) => !direct.includes(key));
}

export type ProfileChangeIssueReason = "EMPTY" | "REQUIRED" | "TOO_LONG" | "UNCHANGED";

export interface ProfileChangeIssue {
  path: string;
  reason: ProfileChangeIssueReason;
}

export type ProfileChangeInput = Partial<Record<ProfileChangeField, string>>;
export type ProfileChangeCurrent = Readonly<Record<ProfileChangeField, string | null>>;

/**
 * 供应商提交的修改申请：至少改一项；给了的每一项不能为空、不超长、和现在不一样（一样的没有必要审核）。
 * 值由调用方先去掉首尾空白。
 */
export function profileChangeIssues(input: ProfileChangeInput, current: ProfileChangeCurrent): ProfileChangeIssue[] {
  const issues: ProfileChangeIssue[] = [];
  const given = PROFILE_CHANGE_FIELDS.filter((field) => input[field] !== undefined);
  if (given.length === 0) return [{ path: "/", reason: "REQUIRED" }];
  for (const field of given) {
    const value = input[field] as string;
    if (value === "") issues.push({ path: `/${field}`, reason: "EMPTY" });
    else if ([...value].length > PROFILE_LIMITS[field]) issues.push({ path: `/${field}`, reason: "TOO_LONG" });
    else if (value === current[field]) issues.push({ path: `/${field}`, reason: "UNCHANGED" });
  }
  return issues;
}

/**
 * 批准时还能不能照申请生效：申请里每一项「提交时的旧值」都要和现在的一样。
 * 审核期间平台直接改过这几项的，按旧值发起的申请不能盖掉平台的改动（返回改过的那几项）。
 */
export function profileChangeDrift(previous: Partial<Record<ProfileChangeField, string | null>>, current: ProfileChangeCurrent): ProfileChangeField[] {
  return PROFILE_CHANGE_FIELDS.filter((field) => field in previous && (previous[field] ?? null) !== current[field]);
}

/** 通知、摘要里「改了哪几项」的中文。 */
export function profileFieldsText(fields: readonly string[]): string {
  return fields.map((field) => PROFILE_FIELD_NAMES[field as ProfileKey] ?? field).join("、");
}
