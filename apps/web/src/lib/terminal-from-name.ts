/**
 * 从客人在地址搜索里选的地点名称里认出航站楼（包车机场快捷入口，ADR 0098 第三节第 7 小节；监工 2026-11-20）：
 * 地点名本身带航站楼（「羽田空港第3ターミナル」「Narita Airport Terminal 1」「浦东机场第1航站楼」「Incheon T2」），
 * 而机场没登记航站楼、或坐标没落在登记的航站楼 500 米以内时，用它预填「航站楼（选填）」，客人可以改。
 * 只认带编号的写法；认不出返回 null（航站楼照旧空着，不卡住）。
 */

/** 认出的航站楼：`text` 是名称里那一段原文（用来预填、替换），`number` 是编号（用来和登记的航站楼对上） */
export type NameTerminal = { text: string; number: number };

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const NUM = "(\\d{1,2}|[一二三四五六七八九])";
const NOT_ALNUM_BEFORE = "(?<![A-Za-z0-9])";
const NOT_ALNUM_AFTER = "(?![A-Za-z0-9])";

/** 依次试：第 3 ターミナル / 第 1 航站楼 / 第 2 旅客ターミナル、2 号航站楼、ターミナル 1、제 1 터미널、Terminal 1、T2 */
const PATTERNS: RegExp[] = [
  new RegExp(`第\\s*${NUM}\\s*(?:旅客)?\\s*(?:ターミナル|航站楼|航站樓|航廈|航厦)`, "u"),
  new RegExp(`${NUM}\\s*号\\s*航站楼`, "u"),
  new RegExp(`(?:ターミナル|航站楼|航站樓|航廈|航厦)\\s*${NUM}${NOT_ALNUM_AFTER}`, "u"),
  new RegExp(`제\\s*(\\d{1,2})\\s*(?:여객)?\\s*터미널`, "u"),
  new RegExp(`${NOT_ALNUM_BEFORE}terminal\\s*(\\d{1,2})${NOT_ALNUM_AFTER}`, "iu"),
  new RegExp(`${NOT_ALNUM_BEFORE}T(\\d{1,2})${NOT_ALNUM_AFTER}`, "u"),
];

/** 地点名称里的航站楼；全角数字、全角字母按半角认，交出的原文是名称里的原样 */
export function terminalFromName(name: string): NameTerminal | null {
  // NFKC 把全角数字 / 字母换成半角，长度不变的才用它定位原文（否则直接认原文）
  const normalized = name.normalize("NFKC");
  const source = normalized.length === name.length ? normalized : name;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(source);
    if (match === null) continue;
    const digits = match[1]!;
    const number = KANJI_DIGITS[digits] ?? Number(digits);
    if (!Number.isInteger(number) || number < 1) continue;
    return { text: name.slice(match.index, match.index + match[0].length).trim(), number };
  }
  return null;
}

/** 登记的航站楼（编码如 NRT-T1，或任一语言的名称如「第 1 航站楼」）带的编号；认不出返回 null */
export function registeredTerminalNumber(terminal: { code: string; name: Partial<Record<string, string>> | null }): number | null {
  for (const text of [terminal.code, ...Object.values(terminal.name ?? {})]) {
    const found = typeof text === "string" ? terminalFromName(text) : null;
    if (found !== null) return found.number;
  }
  return null;
}

/**
 * 客人改了预填的航站楼后的地点名称：把名称里原来那段航站楼换成客人填的；客人清空就去掉那段
 * （去掉后什么都不剩时保留原名称）。
 */
export function replaceTerminalInName(name: string, found: NameTerminal, text: string): string {
  const at = name.indexOf(found.text);
  if (at < 0) return text === "" ? name : `${name} ${text}`;
  const replaced = `${name.slice(0, at)}${text}${name.slice(at + found.text.length)}`.replace(/\s{2,}/gu, " ").trim();
  return replaced === "" ? name : replaced;
}
