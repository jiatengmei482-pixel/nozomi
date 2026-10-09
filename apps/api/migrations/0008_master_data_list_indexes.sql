-- M1-08：运营后台的主数据列表和首页统计。只加索引，不改表结构，不写任何数据。
--
-- 地点是四张主数据表里唯一会长大的（全世界有定期航班的大中型机场三千多个，地标以后会更多）：
-- 列表按类型、状态筛选后按创建时间翻页并数总数，首页按「类型 × 状态」数数量，都走这个索引。
create index places_type_status_created_idx on places (type, status, created_at, id);
-- 按国家筛选（导入之后按国家找还没指定城市的机场）。
create index places_country_idx on places (country_code, created_at, id);
-- 名称 / 编码的关键字搜索是「包含」匹配，普通索引帮不上；目前的数据量（千到万行）顺序扫描是毫秒级。
-- 数据量上去之后再引入 pg_trgm 的索引，届时新增 ADR（数据库扩展是新的依赖）。
