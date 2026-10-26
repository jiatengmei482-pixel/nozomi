/**
 * 运营后台填写的第三方密钥（M4-09，ADR 0041）的读写。只在平台事务（withPlatformTx）里调用。
 * 库里只有密文（`sealed`）和打码后的样子（`hints`）；解密在 services/integration-secrets.ts。
 */
import type { IntegrationSecretKey } from "@nozomi/config";
import type { Db } from "../db/context.ts";

export interface IntegrationSecretRow {
  integration: IntegrationSecretKey;
  sealed: string;
  /** 每一项打码后的样子：字段名 → `••••1234` */
  hints: Record<string, string>;
  version: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string };
}

interface Row {
  integration: IntegrationSecretKey;
  sealed: string;
  hints: Record<string, string>;
  version: number;
  updated_at: Date;
  updated_by: string;
  updated_by_name: string;
}

const SELECT = `select s.integration, s.sealed, s.hints, s.version, s.updated_at, s.updated_by, u.name as updated_by_name
  from integration_secrets s join platform_users u on u.id = s.updated_by`;

function toRow(row: Row): IntegrationSecretRow {
  return { integration: row.integration, sealed: row.sealed, hints: row.hints, version: row.version, updatedAt: row.updated_at, updatedBy: { id: row.updated_by, name: row.updated_by_name } };
}

export async function listIntegrationSecrets(db: Db): Promise<IntegrationSecretRow[]> {
  const result = await db.query<Row>(`${SELECT} order by s.integration`);
  return result.rows.map(toRow);
}

/** 锁住这一项（改之前），没有时返回 null。两个人同时改同一项时排好先后，审计里的「填写 / 更换」不会记错。 */
export async function lockIntegrationSecret(db: Db, integration: IntegrationSecretKey): Promise<IntegrationSecretRow | null> {
  const result = await db.query<Row>(`${SELECT} where s.integration = $1 for update of s`, [integration]);
  return result.rows[0] === undefined ? null : toRow(result.rows[0]);
}

/** 填写或更换：没有就插入，有就覆盖并把版本加一。 */
export async function saveIntegrationSecret(db: Db, input: { integration: IntegrationSecretKey; sealed: string; hints: Record<string, string>; updatedAt: Date; updatedBy: string }): Promise<void> {
  await db.query(
    `insert into integration_secrets (integration, sealed, hints, updated_at, updated_by) values ($1, $2, $3, $4, $5)
     on conflict (integration) do update set sealed = excluded.sealed, hints = excluded.hints, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
       version = integration_secrets.version + 1`,
    [input.integration, input.sealed, JSON.stringify(input.hints), input.updatedAt, input.updatedBy],
  );
}

/** 清空：删掉这一行（回落到服务器配置文件）。返回删掉了没有。 */
export async function deleteIntegrationSecret(db: Db, integration: IntegrationSecretKey): Promise<boolean> {
  const result = await db.query("delete from integration_secrets where integration = $1", [integration]);
  return (result.rowCount ?? 0) > 0;
}
