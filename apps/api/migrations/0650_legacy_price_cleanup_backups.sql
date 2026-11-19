-- 包车三层旧价格数据清理（M9P-12，ADR 0093 第五节、第十三节「验证通过后清理」）的备份和记录。只建结构，不含任何数据。
-- 清理脚本用迁移账号（表的所有者）执行，读写这两张表；服务进程的三个权限角色都不给权限（跨全部供应商的原始价格，只给事后核对、恢复用）。
--
-- legacy_price_cleanup_backups：执行前（product_tenant_id 是商品所属的供应商；平台表不叫 tenant_id，ADR 0003）每条要删 / 要改的价格规则的整行（to_jsonb），一个批次（run_id）一份；
--   action：delete_area_package（迁移过三层的商品上按服务区域的旧套餐价，删掉）、strip_waypoint（③上下车加价行里的途经加价，去掉这一项）。
-- legacy_price_cleanup_runs：每次执行的计数和改动（只有编号和动作）。试跑在回滚的事务里写，所以不留。
create table legacy_price_cleanup_backups (
  run_id uuid not null,
  product_tenant_id uuid not null,
  product_id uuid not null,
  price_rule_id uuid not null,
  action text not null,
  price_rule jsonb not null,
  created_at timestamptz not null,
  primary key (run_id, product_tenant_id, price_rule_id),
  constraint legacy_price_cleanup_backups_action_check check (action in ('delete_area_package', 'strip_waypoint'))
);

create table legacy_price_cleanup_runs (
  id uuid primary key,
  mode text not null,
  counts jsonb not null,
  changes jsonb not null,
  created_at timestamptz not null,
  constraint legacy_price_cleanup_runs_mode_check check (mode in ('dry-run', 'apply'))
);
