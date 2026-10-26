/**
 * 按文件开头的字节判断格式（不信上传时声明的类型）。资质文件（ADR 0028）和履约照片（ADR 0027）共用这一份判断，
 * 各自再按自己收的格式过滤：资质收 PDF / JPEG / PNG（`detectDocumentFileType`），照片收 JPEG / PNG / WebP / HEIC（`detectEvidenceType`）。
 */

export const DETECTABLE_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export type DetectableFileType = (typeof DETECTABLE_FILE_TYPES)[number];

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/**
 * PDF：`%PDF-`；JPEG：FF D8 FF；PNG：89 50 4E 47 0D 0A 1A 0A；WebP：RIFF....WEBP；HEIC：第 4–8 字节是 ftyp、品牌是 heic / mif1 等。
 * 别的（GIF、SVG、HTML、MP4……）都不认，返回 null。
 */
export function detectFileType(bytes: Uint8Array): DetectableFileType | null {
  const starts = (signature: readonly number[]): boolean => bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12))) return "image/heic";
  return null;
}

/** 认出来的格式在不在 `accepted` 里；不在（或认不出）返回 null。 */
export function detectFileTypeAmong<T extends DetectableFileType>(bytes: Uint8Array, accepted: readonly T[]): T | null {
  const detected = detectFileType(bytes);
  return detected !== null && (accepted as readonly DetectableFileType[]).includes(detected) ? (detected as T) : null;
}
