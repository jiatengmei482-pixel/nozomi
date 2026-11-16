-- 订单经停点个数的上限从 10 放到 25（M9P-10，ADR 0099；规格 docs/requirements/charter-pricing-spec-2026-11-14.md 步骤 2「经停数量不设业务上限，只受路径接口技术上限」）。
-- 编号：0470 由 M9E-26、0480 由 M9E-28、0490 由 M9P-20 占用，0500 起留给 B 线，这里用 0510。
--
-- 25 = 谷歌 Routes API computeRoutes 一次最多 25 个中间点（报价逐段两两估，不受它限制；行程地图的折线、顺序建议一次带全部经停，受它限制）。
-- 和 domain 的 CHARTER_ITINERARY_LIMITS.maxWaypoints 同一个数；报价、草稿、人工报价在接口层先拦，这条约束兜底。
-- 只放宽检查约束，不改已有的行（已有订单最多 10 个，都满足新约束），不含任何数据。

alter table orders drop constraint orders_waypoints_shape;
alter table orders add constraint orders_waypoints_shape check (waypoints is null or (jsonb_typeof(waypoints) = 'array' and jsonb_array_length(waypoints) between 1 and 25));
