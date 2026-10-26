/** 本分支新增、但编号不大于基准上最大编号的迁移文件名（见 check-migration-order.mjs）。 */
export function outOfOrderMigrations(baseNames: readonly string[], headNames: readonly string[]): string[];
