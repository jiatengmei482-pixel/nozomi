-- M1-05：库存。字段来自 docs/requirements/01-tenant-and-quote-engine.md「5. 商品 · ④ 库存」和「数据模型」的 inventory_day；
-- 落地时定下的事见 ADR 0019。只建结构，不写任何数据。

-- 库存模式：unlimited 不限量（默认）/ limited 限量（按下面的每日库存）
alter table products
  add column inventory_mode text not null default 'unlimited',
  add constraint products_inventory_mode_check check (inventory_mode in ('unlimited', 'limited'));

-- 每日库存：商品 × 日期（城市当地的用车日期）一行。限量模式下没有行的日期不可售。
-- total 可售总数（0 = 停售）、held 已预占（下单未支付）、sold 已售（支付确认）。
-- held + sold 永远不超过 total：下单时用「条件更新」预占（update … set held = held + n where total - held - sold >= n），
-- 一条语句里判断和扣减，并发下单不会超卖；这条检查约束是最后一道防线（ADR 0019）。
create table inventory_days (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  day date not null,
  -- 预留：按车型组的库存二期开放，现在恒为空（需求文档）
  vehicle_group_id uuid references vehicle_groups (id),
  total integer not null,
  held integer not null default 0,
  sold integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, product_id) references products (tenant_id, id) on delete cascade,
  constraint inventory_days_total_range check (total between 0 and 9999),
  constraint inventory_days_counts_non_negative check (held >= 0 and sold >= 0),
  constraint inventory_days_not_oversold check (held + sold <= total)
);

-- 一个商品一天只有一行（按车型组的库存开放之后，这里换成含车型组的唯一索引）
create unique index inventory_days_product_day_key on inventory_days (tenant_id, product_id, day) where vehicle_group_id is null;

alter table inventory_days enable row level security;
create policy inventory_days_same_tenant on inventory_days to nozomi_app
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert, update, delete on inventory_days to nozomi_app;
