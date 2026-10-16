-- 运营后台查看供应商的商品（M1-12，ADR 0021）：平台只读看到一个商品的全部内容，和供应商自己看到的一样。
-- 商品用到的租户表里，平台只剩调度人（product_dispatchers）读不到（0013、0016 已给了其余各张的只读）。
-- 上架校验要数调度人，客服处理订单时也要看调度人的电话，所以补上只读。不能写；只调整权限，不建表、不写任何数据。

grant select on product_dispatchers to nozomi_platform;

create policy product_dispatchers_platform_read on product_dispatchers for select to nozomi_platform using (true);
