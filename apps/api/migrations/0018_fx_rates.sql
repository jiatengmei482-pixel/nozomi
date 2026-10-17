-- M2-03：汇率中心（ADR 0022）。需求：《用车报价服务平台》「汇率中心」、《平台运营端与渠道对接》「汇率中心运维」。
-- 两张平台表（不带 tenant_id，不开行级安全）。不含任何数据：汇率由服务进程从免费数据源拉取。

-- 每一次拉取（定时的、手动的）：结果、原因、数据源的时间。保留全部记录，看板的「数据源状态」和排查都看它。
create table fx_fetches (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  -- schedule = 定时任务，manual = 平台员工点了「立即拉取」
  trigger text not null,
  -- 手动拉取的人；定时任务为 null
  triggered_by uuid references platform_users (id),
  -- 数据源（地址的主机名，不含路径和查询串）
  source text not null,
  -- running / accepted / unchanged / held / confirmed / dismissed / rejected / failed（domain 的 FxFetchStatus）
  status text not null,
  -- 失败、拒收的原因：错误码和给人看的说明
  error_code text,
  error_detail text,
  -- 数据源说的这批汇率的时间、下次更新时间
  source_as_of timestamptz,
  source_next_update_at timestamptz,
  -- 挂起（变动超过 3%）的那一批：{ 币种: 十进制字符串 }，确认后才写进 fx_rates；以及超限的币种和幅度
  held_rates jsonb,
  jumps jsonb,
  -- 确认 / 放弃挂起的那一批的人和时间
  decided_by uuid references platform_users (id),
  decided_at timestamptz,
  constraint fx_fetches_trigger_check check (trigger in ('schedule', 'manual')),
  constraint fx_fetches_status_check check (status in ('running', 'accepted', 'unchanged', 'held', 'confirmed', 'dismissed', 'rejected', 'failed')),
  constraint fx_fetches_finished check ((status = 'running') = (finished_at is null)),
  constraint fx_fetches_held_rates check ((held_rates is null) or jsonb_typeof(held_rates) = 'object')
);

create index fx_fetches_started_idx on fx_fetches (started_at desc, id desc);
create index fx_fetches_held_idx on fx_fetches (source_as_of desc) where status = 'held';

-- 汇率：1 个 base = rate 个 quote（主单位）。rate 用不限精度的 numeric 存数据源给的十进制原值，不用浮点列。
-- 同一批（同一个 as_of）的各币种一起写入；保留全部历史，用于对账和曲线。
create table fx_rates (
  id bigint generated always as identity primary key,
  base text not null,
  quote text not null,
  rate numeric not null,
  -- 这批汇率的时间（数据源的更新时间）：报价快照里的「取数时间」，48 小时过期也按它算
  as_of timestamptz not null,
  -- 我们拉到它的时间
  fetched_at timestamptz not null,
  source text not null,
  fetch_id bigint not null references fx_fetches (id),
  constraint fx_rates_rate_positive check (rate > 0),
  constraint fx_rates_codes check (base ~ '^[A-Z]{3}$' and quote ~ '^[A-Z]{3}$' and base <> quote),
  constraint fx_rates_unique unique (base, quote, as_of)
);

create index fx_rates_as_of_idx on fx_rates (as_of desc);

-- 平台：拉取、确认要写；只追加，不删。拉取记录要改状态（结束、确认、放弃）。
grant select, insert, update on fx_fetches to nozomi_platform;
grant select, insert on fx_rates to nozomi_platform;
-- 租户：汇率是主数据，只读（`GET /tenant/v1/fx-rates`）。拉取记录不给。
grant select on fx_rates to nozomi_app;

-- 审计日志多一种入口：job = 服务进程里的定时任务（汇率过期告警、定时拉取到的变动过大的一批）。只放宽检查约束，不动已有的行。
alter table audit_logs drop constraint audit_logs_source_check;
alter table audit_logs add constraint audit_logs_source_check check (source in ('console', 'api', 'cli', 'job'));
