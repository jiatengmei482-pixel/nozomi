-- M9W-04：人工报价申请带包车经停点（ADR 0088、0089）。只改约束，不含任何数据。
--
-- 包车有经停点时按行程计价，客人没有选套餐时长（由客服按行程定），所以包车可以没有 package_hours。
-- 经停点和两端地点一样只放在加密的 contact_enc 里（ADR 0057），不加明文列；「包车没有经停点时必须有套餐时长」由接口核对（manualQuoteTripIssues）。
-- 不变的部分：别的品类仍然不能有套餐时长，时长仍在 1–72 小时。已有的行都满足新约束。

alter table manual_quote_requests drop constraint manual_quote_requests_package_check;
alter table manual_quote_requests add constraint manual_quote_requests_package_check check ((category = 'charter' or package_hours is null) and (package_hours is null or package_hours between 1 and 72));
