-- 推送的租约（M3-02，ADR 0027「排队和投递」）：推送任务租下一条投递时写一个租约令牌，记结果时核对令牌，
-- 租约被别人接手（到期后另一个实例取走、手动重推）的那一方记不上结果，也不会多记一次尝试。
-- 每条投递的尝试编号唯一：同一条推送不会出现两个「第 1 次」。不含任何数据。

alter table webhook_deliveries add column lease_token uuid;
alter table webhook_deliveries add constraint webhook_deliveries_lease check (lease_token is null or status = 'pending');

drop index webhook_attempts_delivery_idx;
create unique index webhook_attempts_delivery_idx on webhook_attempts (tenant_id, delivery_id, attempt_no);
