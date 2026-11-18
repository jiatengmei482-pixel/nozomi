-- 区域重叠清理（ADR 0102 第五节第 3 步）的备份和记录。只建结构，不含任何数据。
-- 清理脚本用迁移账号（表的所有者）执行，读写这两张表；服务进程的三个权限角色都不给权限（跨全部供应商的原始数据，只给事后核对、恢复用）。
--
-- area_cleanup_backups：执行前（area_tenant_id 是区域所属的供应商；平台表不叫 tenant_id，ADR 0003）每个区域的整行、图形和全部关联（商品服务区域、价格行、调价规则、机场绑定），一个批次（run_id）一份。
-- area_cleanup_runs：每次执行的计数和改动（只有编号和动作）。试跑在回滚的事务里写，所以不留。
create table area_cleanup_backups (
  run_id uuid not null,
  area_tenant_id uuid not null,
  area_id uuid not null,
  area jsonb not null,
  polygons jsonb not null,
  refs jsonb not null,
  created_at timestamptz not null,
  primary key (run_id, area_tenant_id, area_id)
);

create table area_cleanup_runs (
  id uuid primary key,
  mode text not null,
  counts jsonb not null,
  changes jsonb not null,
  created_at timestamptz not null,
  constraint area_cleanup_runs_mode_check check (mode in ('dry-run', 'apply'))
);
