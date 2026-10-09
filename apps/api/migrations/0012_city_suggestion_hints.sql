-- M1-11：给机场建议城市时用的两项数据源信息。只改结构，不写任何数据：
-- 两列都由导入命令填（`pnpm masterdata:import-airports` / `import-cities`，重新运行一次即回填已有的记录）。

-- OurAirports 的 municipality 列：这个机场所属 / 服务的城市名（如羽田是 Tokyo、关西是 Osaka）。手工录入的地点为空。
alter table places
  add column municipality text,
  add constraint places_municipality_length check (municipality is null or char_length(municipality) between 1 and 200);

-- GeoNames 的人口：同样距离内优先建议大城市。手工录入的城市为空。
alter table cities
  add column population integer,
  add constraint cities_population_range check (population is null or population >= 0);
