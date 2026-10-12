-- M1-09：城市可以从公开数据源（GeoNames，CC BY 4.0）导入。给城市表加上和地点表一样的「来源」字段。
-- 只改结构，不写任何数据：城市用 `pnpm masterdata:import-cities` 导入，或由平台在后台录入。

alter table cities
  -- 数据源标识、这个城市在数据源里的编号、最近一次与数据源核对的时间；手工录入的城市三项都为空
  add column source text,
  add column source_ref text,
  add column source_synced_at timestamptz,
  -- 平台在后台改过导入城市的名称、时区或中心坐标：再次导入时不覆盖
  add column source_overridden boolean not null default false,
  add constraint cities_source_check check (source is null or source = 'geonames'),
  add constraint cities_source_complete check (
    (source is null) = (source_ref is null) and (source is null) = (source_synced_at is null)
  ),
  add constraint cities_override_needs_source check (not source_overridden or source is not null);

-- 同一个数据源里的同一条记录只对应一个城市：重复导入靠它去重
create unique index cities_source_key on cities (source, source_ref) where source is not null;
-- 机场的城市建议要按国家取启用中的城市
create index cities_country_status_idx on cities (country_code, status);
