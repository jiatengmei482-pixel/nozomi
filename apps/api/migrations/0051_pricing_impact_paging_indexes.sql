-- M3-07：毛利试算分批取数用的索引（ADR 0033「性能」）。
-- 试算按（时间、编号）的游标倒序分批取一个渠道近 30 天的报价和订单。原来的索引只有（渠道、时间），每批要把剩下的行全排一次序；
-- 统计信息过期时（刚写进大量报价）还会选成「取出剩下的全部行、算完字段再排序」，10 万个报价时单批几秒。
-- 换成带编号的索引：每批直接按索引顺序取 5,000 个，和统计信息无关。新索引覆盖原来按（渠道、时间）查的用法，原来的删掉。只改索引，不含任何数据。
create index quotes_channel_page_idx on quotes (channel_id, created_at desc, id desc);
drop index quotes_channel_idx;
create index order_sales_channel_page_idx on order_sales (channel_id, created_at desc, order_id desc);
drop index order_sales_channel_idx;
