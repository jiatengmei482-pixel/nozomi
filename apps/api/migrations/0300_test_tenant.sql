-- 测试环境专用的 QA 测试供应商（M8-16，ADR 0077）。只加列、约束和索引，不含任何数据：
-- 这一行只由运维显式运行 `pnpm qa:tenant-ensure` 建出来（只允许 staging / local / ci），部署和迁移不会建。
-- 编号：main 上最大是 0280；M8-20（ADR 0075）占用 0290。
--
-- is_test_tenant：验收用的测试供应商。它能登录、建区域、商品、价格、加价、导入、试算，但永远不参与比价：
-- 检查约束保证它只能停在「申请中 / 审核中 / 已签约 / 已清退」——这几种状态的商品不能上架（`tenantCanPublish`），
-- 也不参与官网和销售端的比价、下单（`tenantBids`）。无论哪段代码出错把它改成试运营、正式、暂停，数据库都拒绝。
alter table tenants add column is_test_tenant boolean not null default false;

alter table tenants
  add constraint tenants_test_tenant_never_sells check (not is_test_tenant or status in ('applying', 'reviewing', 'signed', 'terminated'));

-- 全平台最多一家测试供应商（清退了也占着这个位置：不再建第二家）
create unique index tenants_one_test_tenant on tenants ((true)) where is_test_tenant;
