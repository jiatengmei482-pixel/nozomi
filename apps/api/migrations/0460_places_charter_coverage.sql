-- 包车上架的「覆盖检查」清单（M9P-06，ADR 0093 第七节第 4 条；规格第四节第 2 小节第 4 条）。只加列，不含任何数据。
-- 编号：main 上最大是 0440（M9E-16），0450 由 M9P-05 使用，这里用 0460。
--
-- places.charter_coverage：运营在运营后台地点页勾选「包车覆盖检查」的地标（只有 type = 'poi' 能勾）。
-- 包车商品上架检查多一项提醒：商品所在城市里勾了这一项、启用中的地标，不在这个商品任何①基础价、②行程、③上下车加价区域里的，列出来（不拦上架）。
-- 默认 false：已有的地点都不在清单里，清单为空时这一项不出现。不预置任何地标（规则 1），由运营在后台勾选。
-- 授权不变（places 已授权给 nozomi_platform 读、增、改，nozomi_app 只读，迁移 0007）。

alter table places add column charter_coverage boolean not null default false;
alter table places add constraint places_charter_coverage_poi check (not charter_coverage or type = 'poi');
