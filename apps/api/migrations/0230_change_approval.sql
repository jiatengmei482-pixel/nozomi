-- 客户改单要供应商确认（M4-29，ADR 0060）。不含任何数据。

-- 改单新增状态「调整中」：供应商在换司机或协调。还没有结论，和等确认一样占着「一张单同时只能有一个」。
alter table order_changes drop constraint order_changes_status_check;
alter table order_changes add constraint order_changes_status_check check (status in ('awaiting_payment', 'pending_confirmation', 'adjusting', 'applied', 'rejected', 'expired', 'failed', 'cancelled'));
alter table order_changes drop constraint order_changes_confirm;
alter table order_changes add constraint order_changes_confirm check ((status in ('pending_confirmation', 'adjusting')) <= (confirm_due_at is not null));
drop index order_changes_open_key;
create unique index order_changes_open_key on order_changes (tenant_id, order_id) where status in ('awaiting_payment', 'pending_confirmation', 'adjusting');
drop index order_changes_confirm_due_idx;
create index order_changes_confirm_due_idx on order_changes (confirm_due_at) where status in ('pending_confirmation', 'adjusting');

-- 原用车时间和新用车时间里早的那个：期限和超时提醒都按它。旧数据为空，按订单现在的用车时间算。
alter table order_changes add column earliest_service_at timestamptz;
-- 什么时候、谁标的调整中（只能标一次）；供应商的人或代处理的平台员工
alter table order_changes add column adjusting_at timestamptz;
alter table order_changes add column adjusting_by uuid;
alter table order_changes add column adjusting_by_platform uuid references platform_users (id);
-- 平台员工代供应商处理（`decided_by` 只能是供应商的人）
alter table order_changes add column decided_by_platform uuid references platform_users (id);
alter table order_changes add constraint order_changes_adjusting_by_fkey foreign key (tenant_id, adjusting_by) references tenant_users (tenant_id, id);
alter table order_changes add constraint order_changes_adjusting check ((status <> 'adjusting') or adjusting_at is not null);

-- 异常队列：改单超时没有结论，提醒运营
alter table order_exceptions drop constraint order_exceptions_type_check;
alter table order_exceptions add constraint order_exceptions_type_check check (type in ('dispatch_overdue', 'departure_overdue', 'arrival_overdue', 'push_failed', 'no_show_review', 'extra_charge_review', 'fulfilment_unfinished', 'payment_issue', 'rescue', 'change_unconfirmed'));

-- 供应商后台的待办（首页和订单菜单的角标）。没有客人信息，只有编号和字段名。
-- 业务都在平台事务里写；供应商只读，点「知道了」也在平台事务里做（查询带令牌里的租户编号）。
create table order_todos (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  order_id uuid not null,
  -- @nozomi/domain 的 ORDER_TODO_KINDS
  kind text not null,
  change_id uuid,
  -- 改了哪些字段（字段名，不是值）
  fields text[] not null default '{}',
  -- 当时已经派了司机：页面突出「需调整司机」
  needs_driver_adjustment boolean not null default false,
  created_at timestamptz not null,
  resolved_at timestamptz,
  -- 点「知道了」的人；要决定的那种有结论时由系统关，这里为空
  resolved_by uuid,
  primary key (tenant_id, id),
  foreign key (tenant_id, order_id) references orders (tenant_id, id),
  foreign key (tenant_id, change_id) references order_changes (tenant_id, id),
  foreign key (tenant_id, resolved_by) references tenant_users (tenant_id, id),
  constraint order_todos_kind_check check (kind in ('change_request', 'contact_changed', 'change_applied', 'change_expired', 'order_cancelled', 'rescue_started')),
  constraint order_todos_change check ((kind in ('change_request', 'contact_changed', 'change_applied', 'change_expired')) = (change_id is not null))
);

create index order_todos_open_idx on order_todos (tenant_id, seq desc) where resolved_at is null;
create index order_todos_order_idx on order_todos (tenant_id, order_id, seq);
-- 同一件事只有一条（重复执行、并发都不会多）
create unique index order_todos_change_key on order_todos (tenant_id, change_id, kind) where change_id is not null;
create unique index order_todos_order_key on order_todos (tenant_id, order_id, kind) where change_id is null;

alter table order_todos enable row level security;
create policy order_todos_same_tenant on order_todos for select to nozomi_app using (tenant_id = app_tenant_id());
create policy order_todos_platform on order_todos to nozomi_platform using (true) with check (true);
grant select on order_todos to nozomi_app;
grant select, insert, update on order_todos to nozomi_platform;
