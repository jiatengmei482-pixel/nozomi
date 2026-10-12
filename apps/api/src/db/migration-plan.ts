/**
 * 数据库迁移的纯计算部分：文件名规则、校验和、「哪些要执行」的判断。不碰数据库和文件系统。
 *
 * 规则（见 ADR 0006）：
 * - 迁移文件名 `NNNN_snake_case.sql`，按编号从小到大执行，编号不能重复。
 * - 已执行的迁移文件不能再改：内容的校验和与记录不一致就报错，要改结构只能新增迁移。
 * - 已执行的迁移文件不能删；新迁移的编号必须大于所有已执行的编号。
 * - 迁移文件里不能自己写 begin / commit / rollback：执行器已经把每个迁移包在一个事务里，
 *   文件里提前 commit 会让「失败整体回滚」失效，所以在执行前就拒绝。
 */
import { createHash } from "node:crypto";

export type MigrationErrorCode =
  | "MIGRATION_BAD_FILE_NAME"
  | "MIGRATION_DUPLICATE_VERSION"
  | "MIGRATION_TRANSACTION_CONTROL"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_FILE_MISSING"
  | "MIGRATION_OUT_OF_ORDER"
  | "MIGRATION_LOCK_TIMEOUT"
  | "MIGRATION_FAILED";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  constructor(code: MigrationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
  }
}

export interface MigrationFile {
  version: number;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

const FILE_NAME_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/** 解析迁移文件名；不符合 `NNNN_snake_case.sql` 时抛 MIGRATION_BAD_FILE_NAME。 */
export function parseMigrationFileName(fileName: string): { version: number; name: string } {
  const match = FILE_NAME_PATTERN.exec(fileName);
  const version = match ? Number(match[1]) : 0;
  if (!match || version === 0) {
    throw new MigrationError(
      "MIGRATION_BAD_FILE_NAME",
      `迁移文件名不合规：${fileName}（应为 0001_snake_case.sql 这样的 4 位编号 + 小写下划线名称，编号从 0001 开始）`,
    );
  }
  return { version, name: match[2] as string };
}

/** 内容校验和（SHA-256）。换行统一成 LF 再算，避免不同系统检出后校验和不同。 */
export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/** 把 SQL 里的注释、字符串、带引号的标识符、`$$…$$` 函数体换成空格，只留下语句骨架和分号。 */
function sqlSkeleton(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (rest.startsWith("/*")) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += " ";
    } else if (sql[i] === "'") {
      const backslashEscapes = /(^|[^a-z0-9_$])e$/i.test(sql.slice(Math.max(0, i - 2), i));
      i++;
      while (i < sql.length) {
        if (backslashEscapes && sql[i] === "\\") {
          i += 2;
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
        } else if (sql[i] === "'") {
          break;
        } else {
          i++;
        }
      }
      i++;
      out += " ";
    } else if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1);
      i = end === -1 ? sql.length : end + 1;
      out += " x ";
    } else {
      const dollar = /^\$(?:[a-z_][a-z0-9_]*)?\$/i.exec(rest);
      const afterIdentifier = i > 0 && /[a-z0-9_$]/i.test(sql[i - 1] as string);
      if (dollar && !afterIdentifier) {
        const end = sql.indexOf(dollar[0], i + dollar[0].length);
        i = end === -1 ? sql.length : end + dollar[0].length;
        out += " ";
      } else {
        out += sql[i];
        i++;
      }
    }
  }
  return out;
}

const TRANSACTION_CONTROL =
  /^(begin|start\s+transaction|commit|end|abort|prepare\s+transaction|rollback(?!\s+(?:(?:work|transaction)\s+)?to\b))\b/;

/**
 * 找出迁移 SQL 里顶层的事务控制语句（begin / start transaction / commit / end / abort / rollback /
 * prepare transaction），返回第一个的关键字；没有则返回 null。
 * 注释、字符串和 `$$…$$` 函数体里的不算；`savepoint` 和 `rollback to savepoint` 允许。
 * `begin atomic … end` 形式的函数体也不算。
 */
export function findTransactionControl(sql: string): string | null {
  let inAtomicBody = false;
  for (const raw of sqlSkeleton(sql).split(";")) {
    const statement = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (inAtomicBody) {
      if (statement === "end") inAtomicBody = false;
      continue;
    }
    const match = TRANSACTION_CONTROL.exec(statement);
    if (match) return match[1] as string;
    if (/\bbegin atomic\b/.test(statement)) inAtomicBody = true;
  }
  return null;
}

/** 由「文件名 + 内容」构建迁移列表：按编号排序；编号重复或文件里有事务控制语句时报错。 */
export function buildMigrationFiles(inputs: readonly { fileName: string; sql: string }[]): MigrationFile[] {
  const files = inputs
    .map(({ fileName, sql }) => ({ ...parseMigrationFileName(fileName), fileName, sql, checksum: migrationChecksum(sql) }))
    .sort((a, b) => a.version - b.version);
  for (const file of files) {
    const keyword = findTransactionControl(file.sql);
    if (keyword) {
      throw new MigrationError(
        "MIGRATION_TRANSACTION_CONTROL",
        `迁移文件 ${file.fileName} 里有事务控制语句（${keyword}）。每个迁移已经包在一个事务里执行，文件里不能自己写 begin / commit / rollback。`,
      );
    }
  }
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1] as MigrationFile;
    const curr = files[i] as MigrationFile;
    if (prev.version === curr.version) {
      throw new MigrationError(
        "MIGRATION_DUPLICATE_VERSION",
        `迁移编号重复：${prev.fileName} 和 ${curr.fileName}`,
      );
    }
  }
  return files;
}

/**
 * 对照已执行记录，算出还要执行哪些迁移（按编号从小到大）。
 * 记录和文件对不上时抛 MigrationError，不做任何猜测性的修复。
 */
export function planMigrations(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationFile[] {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  let lastApplied = 0;
  for (const record of applied) {
    const file = byVersion.get(record.version);
    const label = `${String(record.version).padStart(4, "0")}_${record.name}`;
    if (!file) {
      throw new MigrationError(
        "MIGRATION_FILE_MISSING",
        `数据库里已执行的迁移 ${label} 找不到对应文件。已执行的迁移文件不能删除或改编号。`,
      );
    }
    if (file.checksum !== record.checksum) {
      throw new MigrationError(
        "MIGRATION_CHECKSUM_MISMATCH",
        `迁移文件 ${file.fileName} 在执行后被改动过（校验和不一致）。已执行的迁移不能修改，请还原该文件并新增一个迁移。`,
      );
    }
    lastApplied = Math.max(lastApplied, record.version);
  }
  const appliedVersions = new Set(applied.map((a) => a.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  const outOfOrder = pending.find((f) => f.version < lastApplied);
  if (outOfOrder) {
    throw new MigrationError(
      "MIGRATION_OUT_OF_ORDER",
      `迁移文件 ${outOfOrder.fileName} 的编号小于已执行的最新迁移（${String(lastApplied).padStart(4, "0")}）。请把它改成更大的编号。`,
    );
  }
  return pending;
}
