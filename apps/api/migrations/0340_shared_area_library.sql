-- M8-31：区域共享库（ADR 0083）。只加列、约束和索引，不含任何数据，不改任何已有的行的内容。
--
-- 共享库不是一张新表：它就是各供应商自己建的、启用中的「原创」区域（不是从库里引用来的副本），
-- 测试供应商（tenants.is_test_tenant）和已清退供应商的区域不算。平台事务读它（0016 已给 nozomi_platform 读 areas / area_polygons），
-- 对外只给名称和形状，不给创建者、价格、加价。
--
-- shape_version：图形的版本。只有图形变了才加一（改名、改业务类型、改用途、停用启用都不加），
-- 共享库里看到的「版本」就是它。已有区域按 1 开始（列默认值），以后改图形时加一。
alter table areas add column shape_version integer not null default 1;
alter table areas add constraint areas_shape_version_positive check (shape_version >= 1);

-- 引用来源：从共享库引用的副本记住来源区域和当时的图形版本；自己画的为空。
-- 来源区域属于别的租户，所以不加外键（跨租户的外键会让行级安全之外多一条泄露存在与否的路）；来源被删、停用后副本照旧可用。
alter table areas add column shared_source_area_id uuid;
alter table areas add column shared_source_shape_version integer;
alter table areas add constraint areas_shared_source_pair check ((shared_source_area_id is null) = (shared_source_shape_version is null) and (shared_source_shape_version is null or shared_source_shape_version >= 1));

-- 共享库按城市列出、查相似：只看启用中的原创区域
create index areas_shared_library_idx on areas (city_id, updated_at desc) where status = 'active' and shared_source_area_id is null;
