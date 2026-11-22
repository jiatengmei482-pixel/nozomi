-- 机场的搜索别名（M8-47）。只加列，不含任何数据。
-- 编号：main 上最大是 0670（M9T-32），这里用 0680。
--
-- places.search_names：数据源里这个机场的其他日文、中文写法（如羽田机场在 GeoNames 里的「羽田空港」，正式日文名是「東京国際空港」），
-- 只给官网地址搜索、输入即提示按名称找平台的机场用（@nozomi/domain platformPlaceSuggestions），不显示、不参与报价。
-- 由 `pnpm masterdata:import-airport-names` 填（每次按数据源整份替换，和 municipality 一样不算修改：版本号、更新时间、审计日志都不动）；
-- 手工录入、还没有运行过这个导入的地点为空数组。上线后运行一次这个导入，已有的机场就补上。
-- 授权不变（places 已授权给 nozomi_platform 读、增、改，nozomi_app 只读，迁移 0007）。

alter table places add column search_names text[] not null default '{}';
alter table places add constraint places_search_names_limit check (cardinality(search_names) <= 20 and char_length(array_to_string(search_names, '')) <= 4000);
