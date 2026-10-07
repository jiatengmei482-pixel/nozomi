-- M0-06：审计日志。字段来自 docs/requirements/02-platform-operations.md「平台账号、安全与审计」：
-- 谁、什么时间、从哪个 IP、通过后台还是 API、对什么对象做了什么、前后值。只能追加，不能改、不能删。

create table audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  -- 这条记录属于哪个租户；平台级的操作（平台登录、平台账号、查看集成详情等）为 null
  tenant_id uuid references tenants (id),
  -- 谁：平台员工 / 租户用户 / 系统（命令行）/ 未登录的访问者（登录失败时）
  actor_type text not null,
  actor_id uuid,
  actor_email text,
  ip text,
  -- 通过什么入口：console = 后台登录后的操作，api = 用 API 密钥的调用，cli = 服务器上的命令行
  source text not null,
  resource text not null,
  resource_id text,
  action text not null,
  before jsonb,
  after jsonb,
  constraint audit_logs_actor_type_check check (actor_type in ('platform_user', 'tenant_user', 'system', 'anonymous')),
  constraint audit_logs_source_check check (source in ('console', 'api', 'cli'))
);

-- 审计日志是平台和租户共用的表：按租户查的索引以 tenant_id 开头；
-- 平台按人、按对象跨租户查询用另外两个索引（ADR 0009）。
create index audit_logs_tenant_idx on audit_logs (tenant_id, id);
create index audit_logs_actor_idx on audit_logs (actor_id, id);
create index audit_logs_resource_idx on audit_logs (resource, resource_id, id);
create index audit_logs_occurred_idx on audit_logs (occurred_at, id);

create function audit_logs_reject_change() returns trigger
  language plpgsql
  as $$
begin
  raise exception '审计日志只能追加，不能修改或删除' using errcode = 'restrict_violation';
end
$$;

create trigger audit_logs_no_update_delete
  before update or delete on audit_logs
  for each row execute function audit_logs_reject_change();

create trigger audit_logs_no_truncate
  before truncate on audit_logs
  for each statement execute function audit_logs_reject_change();

-- 租户事务只能写入自己租户的记录，读也只读得到自己的。
alter table audit_logs enable row level security;
create policy audit_logs_same_tenant on audit_logs
  using (tenant_id = app_tenant_id())
  with check (tenant_id = app_tenant_id());
grant select, insert on audit_logs to nozomi_app;
