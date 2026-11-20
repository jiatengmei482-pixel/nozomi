-- AI 一句话行程（M9T-32，ADR 0104 第六、七节）。两张平台表，租户角色没有任何权限；不含任何数据。
--
-- ai_trip_settings：用哪个 Claude 型号（全站一行，同 site_settings 的单行写法）。没有行 = sonnet（默认）。
-- 运营后台超级管理员改，带版本号；改完下一次解析就用新的，不重新部署。
create table ai_trip_settings (
  id boolean primary key default true,
  -- sonnet：只用 Sonnet 5.5；haiku：只用 Haiku 5.5；haiku_then_sonnet：先 Haiku，技术失败时改用 Sonnet 重试一次
  model_mode text not null,
  version integer not null,
  updated_at timestamptz not null,
  updated_by uuid not null references platform_users (id),
  constraint ai_trip_settings_singleton check (id),
  constraint ai_trip_settings_mode_check check (model_mode in ('sonnet', 'haiku', 'haiku_then_sonnet'))
);

-- trip_parse_runs：每次调 Claude 一行（第三种用法改用 Sonnet 重试记第二行，attempt = 2）。
-- **不含任何文字**：没有客人的原话、没有地名、没有模型返回的内容，只有计数、型号、状态和耗时。
-- 全站每天的额度按「东京时间今天、attempt = 1 的行数」算（先插一行 pending 占名额，再调 Claude）。保留 90 天，由清理任务删。
create table trip_parse_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null,
  -- 实际调用的型号 ID（如 claude-sonnet-5-5）
  model text not null,
  -- 当时的用法
  mode text not null,
  attempt integer not null,
  status text not null,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  latency_ms integer,
  days integer,
  places integer,
  places_resolved integer,
  is_acceptance boolean not null default false,
  constraint trip_parse_runs_mode_check check (mode in ('sonnet', 'haiku', 'haiku_then_sonnet')),
  constraint trip_parse_runs_attempt_check check (attempt in (1, 2)),
  constraint trip_parse_runs_status_check check (status in ('pending', 'ok', 'not_a_trip', 'too_long', 'refused', 'invalid', 'timeout', 'error')),
  constraint trip_parse_runs_counts_check check (
    coalesce(input_tokens, 0) >= 0 and coalesce(output_tokens, 0) >= 0 and coalesce(cache_read_tokens, 0) >= 0
    and coalesce(latency_ms, 0) >= 0 and coalesce(days, 0) >= 0 and coalesce(places, 0) >= 0 and coalesce(places_resolved, 0) between 0 and coalesce(places, 0)
  )
);

create index trip_parse_runs_created_idx on trip_parse_runs (created_at);

grant select, insert, update on ai_trip_settings to nozomi_platform;
grant select, insert, update, delete on trip_parse_runs to nozomi_platform;
