-- M1-15：机场的中文名、日文名从 GeoNames 导入（ADR 0024）。只加一列，不写任何数据。
--
-- 记下每种语言的名称是哪次导入填进去的：{"ja": {"source": "geonames", "ref": "<GeoNames 编号>", "text": "<当时填的文字>"}}。
-- 由 `pnpm masterdata:import-airport-names` 写；平台在后台改名称时不动它。
-- 再次导入时拿它和现在的名称比：以前填过、现在空了 = 平台删掉了，不再补回去；和现在的不一样 = 平台改过，不覆盖。
-- 地点原有的 source / source_ref / source_overridden 记的是 OurAirports（英文名和坐标），和这一列互不影响。
alter table places
  add column name_sources jsonb not null default '{}'::jsonb,
  add constraint places_name_sources_is_object check (jsonb_typeof(name_sources) = 'object');
