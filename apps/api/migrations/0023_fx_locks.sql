-- M2-06：汇率人工锁定（双人复核，ADR 0025）。需求：《平台运营端与渠道对接》「汇率中心运维」——人工锁定：极端行情时可临时锁定某个汇率（双人复核）。
-- 一张平台表（不带 tenant_id，不开行级安全）。不含任何数据：锁定由运营在后台发起、另一个人批准后才写入。
-- 编号说明：0022 留给同时在开发的另一个分支。

-- 每一条锁定：按币种锁「1 USD = rate 个该币种」，交叉汇率照常由两边算出。批准的那一刻写入（status = active），
-- 解锁批准后（released）、被新的锁定取代（replaced）、到期（expired）结束。保留全部记录，不删。
create table fx_locks (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  -- 锁定值：不限精度的 numeric，存运营填的十进制原值（规范后），不用浮点列
  rate numeric not null,
  reason text,
  -- 到这一刻起不再用（不含这一刻）。必填：锁定一定会自动失效
  expires_at timestamptz not null,
  -- 生效的时刻（批准的那一刻）
  locked_at timestamptz not null,
  -- 批准那一刻的中央汇率（现在用的那批里这个币种的值）、那批的时间、锁定值相对它的偏离（基点，四舍五入，只给人看）
  central_rate numeric not null,
  central_as_of timestamptz not null,
  deviation_bp integer not null,
  -- 哪一条复核让它生效；发起人、批准人
  lock_approval_id uuid not null references approvals (id),
  requested_by uuid not null references platform_users (id),
  approved_by uuid not null references platform_users (id),
  -- active = 生效中（到期时间之后即使还没被定时任务改成 expired，也不再用）；released = 解锁；replaced = 被新的锁定取代；expired = 到期
  status text not null default 'active',
  ended_at timestamptz,
  -- 解锁、取代：哪一条复核、谁批准的；到期没有
  end_approval_id uuid references approvals (id),
  ended_by uuid references platform_users (id),
  constraint fx_locks_currency_check check (currency ~ '^[A-Z]{3}$' and currency <> 'USD'),
  constraint fx_locks_rate_positive check (rate > 0 and central_rate > 0),
  constraint fx_locks_status_check check (status in ('active', 'released', 'replaced', 'expired')),
  constraint fx_locks_ended check ((status = 'active') = (ended_at is null) and (status in ('released', 'replaced')) = (end_approval_id is not null and ended_by is not null)),
  -- 双人复核：批准人不能是发起人（复核记录上也有同样的约束）
  constraint fx_locks_two_people check (approved_by <> requested_by),
  -- 最长 72 小时（从发起算；生效在发起之后，所以从生效算也不会超过）
  constraint fx_locks_expiry check (expires_at > locked_at and expires_at <= locked_at + interval '72 hours'),
  constraint fx_locks_reason_length check (reason is null or char_length(reason) <= 500)
);

-- 同一个币种同时最多一条生效中的锁定
create unique index fx_locks_one_active on fx_locks (currency) where status = 'active';
create index fx_locks_locked_idx on fx_locks (locked_at desc, id desc);

-- 平台：批准时写入，解锁、取代、到期时改状态；不删。
-- 租户：没有任何权限——租户的汇率接口给的是数据源的中央汇率，锁定是平台的风控手段（ADR 0025）。
grant select, insert, update on fx_locks to nozomi_platform;
