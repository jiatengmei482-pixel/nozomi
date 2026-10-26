-- M3-07：毛利试算取数用的索引和精简列（ADR 0033「性能」）。只改结构，不含任何数据。
--
-- 1. 索引：试算按（时间、编号）的游标倒序分批取一个渠道近 30 天的报价和订单。原来的索引只有（渠道、时间），
--    统计信息过期时（刚写进大量报价）计划会选成「取出剩下的全部行、算完字段再排序」，10 万个报价时单批几秒、会撞上 10 秒的语句时限。
--    换成带编号的索引，每批直接按索引顺序取。新索引覆盖原来按（渠道、时间）查的用法，原来的删掉。
create index quotes_channel_page_idx on quotes (channel_id, created_at desc, id desc);
drop index quotes_channel_idx;
create index order_sales_channel_page_idx on order_sales (channel_id, created_at desc, order_id desc);
drop index order_sales_channel_idx;

-- 2. `quotes.impact_inputs`：快照里试算要用的那几项（用车日期、全部候选、渠道结算币种的汇率、中标者的汇率 / 最低毛利换币种的汇率 / 缓冲），
--    由数据库从快照算出（生成列，写报价的代码不用改，已有的报价在加列时一并算好）。整份快照约 2.5 KB、是压缩存的，
--    试算每行都要解压一次；这一列约 0.5 KB，读它比从快照里取字段快一倍左右。
--    jsonb_build_object 不是 immutable，不能用在生成列里，所以用 jsonb_set 逐项放进空对象；缺的项是 JSON null。
alter table quotes add column impact_inputs jsonb generated always as (
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set('{}'::jsonb,
    '{serviceDate}', coalesce(snapshot->'serviceDate', 'null'::jsonb)),
    '{serviceLocal}', coalesce(snapshot->'request'->'serviceLocal', 'null'::jsonb)),
    '{candidates}', coalesce(snapshot->'candidates', 'null'::jsonb)),
    '{settleFx}', coalesce(snapshot->'channel'->'settleFx', 'null'::jsonb)),
    '{winnerFx}', coalesce(snapshot->'winner'->'sell'->'fx', 'null'::jsonb)),
    '{minMarginFx}', coalesce(snapshot->'winner'->'sell'->'channel'->'minMarginFx', 'null'::jsonb)),
    '{winnerBufferBp}', coalesce(snapshot->'winner'->'sell'->'fxBufferBp', 'null'::jsonb))
) stored;
