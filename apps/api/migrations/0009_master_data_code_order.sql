-- M1-08：主数据列表可以按编码排序（`sort=code`）。只加索引，不改表结构，不写任何数据。
--
-- 按编码排序用的是逐字节比较（collate "C"）：结果和数据库的语言环境无关，HND 一定排在 HND-T1 前面。
-- 编码的唯一索引用的是数据库默认的排序规则，帮不上这种排序，所以各建一个。
create index cities_code_order_idx on cities (code collate "C", id);
create index places_code_order_idx on places (code collate "C", id);
create index vehicle_groups_code_order_idx on vehicle_groups (code collate "C", id);
create index addons_code_order_idx on addons (code collate "C", id);
