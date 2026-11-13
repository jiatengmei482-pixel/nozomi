/** 测试环境只读核对的脚本（见 staging-readonly-check.mjs，M8-34，ADR 0086）。 */
export interface RolePreviewReport {
  replay: { days: number; since: string; logs: number; replayed: number; skipped: number; evaluations: number; externalDiffCount: number; priority: { changedCount: number; keptOffers: number; newOffers: Record<string, number>; [key: string]: unknown }; until?: string; resultDigest?: string; resultLines?: number; stateDigest?: string; [key: string]: unknown };
}
export interface CheckIo {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  writeOutput: (text: string) => Promise<void>;
  writeSummary?: (text: string) => Promise<void>;
}
export class CheckError extends Error {}
export const SECRET_NAMES: readonly string[];
export const DEFAULT_DAYS: number;
export const MAX_DAYS: number;
export function missingSecrets(env: Record<string, string | undefined>): string[];
export function parseDays(raw: string | undefined): number;
export function parseUntil(raw: string | undefined): string | null;
export function parseBaseUrl(raw: string | undefined): string;
export function totp(secret: string, nowMs: number): string;
export function hasChanges(report: RolePreviewReport): boolean;
export interface ReplayCounts {
  checkedAt: string;
  days: number;
  since: string | null;
  until: string | null;
  logs: number;
  replayed: number;
  skipped: number;
  evaluations: number;
  externalDiffCount: number;
  priority: { changedCount: number; keptOffers: number; newOffers: Record<string, number> };
  /** 报价结果摘要值（SHA-256，十六进制）；接口没给或写法不对时是 null */
  resultDigest: string | null;
  resultLines: number;
  /** 回放用到的数据的状态摘要；接口没给或写法不对时是 null */
  stateDigest: string | null;
  passed: boolean;
}
export function countsOf(report: RolePreviewReport, checkedAt: string): ReplayCounts;
export function summarize(counts: ReplayCounts): string[];
export function runCheck(env: Record<string, string | undefined>, io: CheckIo): Promise<number>;
