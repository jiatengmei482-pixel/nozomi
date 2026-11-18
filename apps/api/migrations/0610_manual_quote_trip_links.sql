-- 人工报价申请关联行程单（M9T-08，ADR 0101 第十三节第 2 小节）。只新建表，不给 manual_quote_requests 加列。
--
-- 官网行程报价页全部报不出、或客人选「提交预订，客服确认」时，申请带上行程单编号和所选方案。
-- trip_id 不加外键到 trips：行程单 30 天后由清理任务删除（M9T-05），申请的保留期更长（ADR 0076），关联行留着、只是查不到行程。
-- 地点名称不在这里：放在申请的加密联系信息里（contact_enc 的 trip_labels），保留期、清除方式和联系方式相同。
-- 平台表（同 manual_quote_requests：无租户列、不开行级安全）。只追加，不改不删。

create table manual_quote_trip_links (
  request_id uuid primary key references manual_quote_requests (id) on delete cascade,
  trip_id text not null,
  -- 客人选的方案；全部报不出时转人工没有方案，为空
  plan_kind text,
  created_at timestamptz not null,
  constraint manual_quote_trip_links_trip_id_check check (trip_id ~ '^[A-Za-z0-9_-]{43}$'),
  constraint manual_quote_trip_links_plan_kind_check check (plan_kind is null or plan_kind in ('one_car', 'daily_best'))
);

create index manual_quote_trip_links_trip_idx on manual_quote_trip_links (trip_id);

grant select, insert on manual_quote_trip_links to nozomi_platform;
