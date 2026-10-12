/**
 * 区域编辑页的草稿（docs/design/pages/tenant-areas.md 10.7）：登录过期、误点后退、浏览器崩溃，都不该让人把一个区域重画一遍。
 *
 * - 放在 sessionStorage：只在这个标签页里有效，关掉就没有了（ADR 0011：公用电脑上不留东西）。
 * - 键按「供应商 + 账号 + 区域编号（新增页是 new）」区分，全部以 DRAFT_PREFIX 开头——这个文件只碰这个前缀下的键，不碰登录状态。
 * - 里面只有区域的名称、业务类型、城市和图形坐标，没有令牌和个人信息。
 * - 主动退出登录时全部清掉；登录过期被送去登录页时不清（那正是要靠它找回来的时候）。
 * - 读出来的内容逐项校验，不合规的当作没有；太大的不存。
 */
import { AREA_BIZ_TYPES, type AreaBizType, type LocalizedText, MASTER_DATA_LANGUAGES, type Position } from "@nozomi/domain";
import type { EditorShape } from "./area-editor.ts";

export const DRAFT_PREFIX = "nozomi.area-draft.";
/** 一份草稿最多这么多个字符（上限附近的区域约 50 块 × 1000 点，远小于它）。 */
const MAX_DRAFT_LENGTH = 2_000_000;
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface DraftOwner {
  tenantId: string;
  userId: string;
}

export interface AreaDraft {
  /** 存下来的时刻（ISO 8601） */
  savedAt: string;
  /** 草稿是基于哪个版本改的；新增页是 null */
  baseVersion: number | null;
  cityId: string | null;
  name: LocalizedText;
  bizType: AreaBizType;
  shapes: EditorShape[];
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** 这份草稿的键；编号里有不认识的字符时返回 null（不存、不读）。 */
export function draftKey(owner: DraftOwner, areaId: string | null): string | null {
  const area = areaId ?? "new";
  if (![owner.tenantId, owner.userId, area].every((part) => SAFE_ID.test(part))) return null;
  return `${DRAFT_PREFIX}${owner.tenantId}.${owner.userId}.${area}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** 坐标表里没填完的格子是 NaN，存成 JSON 是 null：读回来还是 NaN。 */
const toNumber = (value: unknown): number | null => (value === null ? Number.NaN : typeof value === "number" ? value : null);

function readShape(value: unknown): EditorShape | null {
  if (!isRecord(value)) return null;
  const { key, id, kind, seq, label, source, ring, circle } = value;
  if (typeof key !== "string" || !/^s\d{1,6}$/.test(key)) return null;
  if (id !== null && (typeof id !== "string" || !SAFE_ID.test(id))) return null;
  if (kind !== "operate" && kind !== "forbid") return null;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return null;
  if (typeof label !== "string" || label.length > 200) return null;
  if (source !== "drawn" && source !== "pasted" && source !== "circle") return null;
  if (!Array.isArray(ring)) return null;
  const points: Position[] = [];
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const [lng, lat] = [toNumber(point[0]), toNumber(point[1])];
    if (lng === null || lat === null) return null;
    points.push([lng, lat]);
  }
  let round: EditorShape["circle"] = null;
  if (circle !== null) {
    if (!isRecord(circle)) return null;
    const [lat, lng, radiusM] = [toNumber(circle["lat"]), toNumber(circle["lng"]), toNumber(circle["radiusM"])];
    if (lat === null || lng === null || radiusM === null) return null;
    round = { lat, lng, radiusM };
  }
  return { key, id, kind, seq, label, source, ring: points, circle: round };
}

function parseDraft(raw: string | null): AreaDraft | null {
  if (raw === null || raw.length > MAX_DRAFT_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { savedAt, baseVersion, cityId, name, bizType, shapes } = value;
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  if (baseVersion !== null && (typeof baseVersion !== "number" || !Number.isInteger(baseVersion))) return null;
  if (cityId !== null && (typeof cityId !== "string" || !SAFE_ID.test(cityId))) return null;
  if (!isRecord(name) || !(AREA_BIZ_TYPES as readonly unknown[]).includes(bizType) || !Array.isArray(shapes)) return null;
  const cleanName: LocalizedText = {};
  for (const language of MASTER_DATA_LANGUAGES) {
    const text = name[language];
    if (typeof text === "string" && text.length <= 500) cleanName[language] = text;
  }
  const cleanShapes: EditorShape[] = [];
  for (const shape of shapes) {
    const read = readShape(shape);
    if (read === null) return null;
    cleanShapes.push(read);
  }
  if (new Set(cleanShapes.map((shape) => shape.key)).size !== cleanShapes.length) return null;
  return { savedAt, baseVersion: baseVersion as number | null, cityId: cityId as string | null, name: cleanName, bizType: bizType as AreaBizType, shapes: cleanShapes };
}

export function readAreaDraft(owner: DraftOwner, areaId: string | null): AreaDraft | null {
  const key = draftKey(owner, areaId);
  if (key === null) return null;
  try {
    return parseDraft(storage()?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

/** 存一份草稿。存不下（太大、浏览器不让存）时返回 false，页面照常可用。 */
export function writeAreaDraft(owner: DraftOwner, areaId: string | null, draft: AreaDraft): boolean {
  const key = draftKey(owner, areaId);
  if (key === null) return false;
  try {
    const raw = JSON.stringify(draft);
    if (raw.length > MAX_DRAFT_LENGTH) return false;
    const store = storage();
    if (!store) return false;
    store.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearAreaDraft(owner: DraftOwner, areaId: string | null): void {
  const key = draftKey(owner, areaId);
  if (key === null) return;
  try {
    storage()?.removeItem(key);
  } catch {
    // 存储不可用时本来也没有草稿
  }
}

/** 主动退出登录时：这个标签页里的草稿全部清掉。只删自己前缀下的键。 */
export function clearAllAreaDrafts(): void {
  try {
    const store = storage();
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => key !== null && key.startsWith(DRAFT_PREFIX));
    for (const key of keys) store.removeItem(key);
  } catch {
    // 同上
  }
}

/** 草稿存下来的时刻，写成「MM-DD HH:mm」（查看者本地时区）。 */
export function draftTimeText(savedAt: string): string {
  const at = new Date(savedAt);
  const two = (value: number): string => String(value).padStart(2, "0");
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
