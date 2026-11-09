-- 供应商名称和企业信息的维护（M4-34，ADR 0071）。不含任何业务数据。
--
-- 1. 平台能改企业信息（运营后台「编辑企业信息」，任何状态都能改）：平台角色对 tenant_profiles 多了 insert、update。
-- 2. 供应商审核通过以后改对外显示名称、法定名称、登记号要提交申请（tenant_profile_changes），
--    平台一位同事发起复核（approvals，kind = tenant.profile_change）、另一位批准后才写进 tenants.name / tenant_profiles。

-- ---- 1. 平台改企业信息 ----

drop policy tenant_profiles_platform_read on tenant_profiles;
create policy tenant_profiles_platform on tenant_profiles to nozomi_platform using (true) with check (true);
grant insert, update on tenant_profiles to nozomi_platform;

-- ---- 2. 改名称、法定名称、登记号的申请 ----

create table tenant_profile_changes (
  tenant_id uuid not null references tenants (id),
  id uuid not null default gen_random_uuid(),
  -- 改哪几项（name / legal_name / registration_no，至少一项）；proposed、previous 的键和它一致
  fields text[] not null,
  -- 要改成什么
  proposed jsonb not null,
  -- 提交时的值：批准时和现在的值核对，审核期间平台直接改过的不能被旧申请盖掉
  previous jsonb not null,
  note text,
  -- pending：等平台处理；approved：已生效；rejected：平台驳回；withdrawn：供应商撤回
  status text not null default 'pending',
  submitted_by uuid not null,
  submitted_at timestamptz not null,
  -- 批准生效的那条复核
  approval_id uuid references approvals (id),
  decided_at timestamptz,
  rejected_by uuid references platform_users (id),
  reject_reason text,
  version integer not null default 1,
  updated_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, submitted_by) references tenant_users (tenant_id, id),
  constraint tenant_profile_changes_fields_check check (cardinality(fields) between 1 and 3 and fields <@ array['name', 'legal_name', 'registration_no']::text[]),
  constraint tenant_profile_changes_json_check check (jsonb_typeof(proposed) = 'object' and jsonb_typeof(previous) = 'object'),
  constraint tenant_profile_changes_status_check check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint tenant_profile_changes_decided check ((status = 'pending') = (decided_at is null)),
  constraint tenant_profile_changes_approved check ((status = 'approved') = (approval_id is not null)),
  constraint tenant_profile_changes_rejected check ((status = 'rejected') = (reject_reason is not null) and (reject_reason is null) = (rejected_by is null)),
  constraint tenant_profile_changes_lengths check ((note is null or char_length(note) <= 500) and (reject_reason is null or char_length(reject_reason) between 1 and 500)),
  constraint tenant_profile_changes_version_positive check (version >= 1)
);

-- 一家同时最多一条等处理的申请（要改先撤回）
create unique index tenant_profile_changes_pending_key on tenant_profile_changes (tenant_id) where status = 'pending';
create index tenant_profile_changes_tenant_idx on tenant_profile_changes (tenant_id, submitted_at desc, id);
-- 运营后台跨供应商的待处理列表（不以 tenant_id 开头的例外，和收款账户一样）
create index tenant_profile_changes_platform_idx on tenant_profile_changes (status, submitted_at desc, id);

alter table tenant_profile_changes enable row level security;
-- 供应商只读自己的；提交、撤回在平台事务里做（租户编号只来自令牌），和收款账户同一做法（ADR 0051）
create policy tenant_profile_changes_same_tenant on tenant_profile_changes for select to nozomi_app using (tenant_id = app_tenant_id());
create policy tenant_profile_changes_platform on tenant_profile_changes to nozomi_platform using (true) with check (true);
grant select on tenant_profile_changes to nozomi_app;
grant select, insert, update on tenant_profile_changes to nozomi_platform;

-- 申请内容不可变：平台只能改状态和审核字段
create trigger tenant_profile_changes_platform_columns
  before update of tenant_id, id, fields, proposed, previous, note, submitted_by, submitted_at
  on tenant_profile_changes
  for each statement execute function reject_platform_column_update();

-- 状态机（纵深防御）：新申请只能是等处理；等处理 → 已生效 / 驳回 / 撤回；有结论以后不能再变
create function tenant_profile_changes_guard_status() returns trigger
  language plpgsql
  as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.approval_id is not null then
      raise exception '新的资料修改申请只能是等处理' using errcode = 'check_violation';
    end if;
  elsif new.status is distinct from old.status and not (old.status = 'pending' and new.status in ('approved', 'rejected', 'withdrawn')) then
    raise exception '资料修改申请不能从 % 变成 %', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger tenant_profile_changes_status_machine
  before insert or update on tenant_profile_changes
  for each row execute function tenant_profile_changes_guard_status();

-- 已生效的申请必须有属于它的已批准复核（批准的事务里先生效、后写复核结论，所以提交时才查）
create function tenant_profile_changes_check_approval() returns trigger
  language plpgsql
  as $$
begin
  if new.status = 'approved' and not exists (
    select 1 from approvals a where a.id = new.approval_id and a.kind = 'tenant.profile_change' and a.resource_id = new.id::text and a.status = 'approved'
  ) then
    raise exception '生效的资料修改必须有属于它的已批准复核' using errcode = 'check_violation';
  end if;
  return null;
end
$$;

create constraint trigger tenant_profile_changes_approved_check
  after insert or update on tenant_profile_changes
  deferrable initially deferred
  for each row execute function tenant_profile_changes_check_approval();
