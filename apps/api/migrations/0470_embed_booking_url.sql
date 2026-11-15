-- M9E-26（0450 由 M9P-05 使用，0460 留给 M9P-06）：嵌入码的「预订页地址」（ADR 0095 附录 A，两段代码交付）。只加列，不回填，不含任何数据。
--
-- booking_url：合作网站自己的预订页（选填）。填了并且开了「允许整页嵌入」时，运营后台生成两段代码：
--   ①入口小程序的 init 带 bookingUrl、②预订程序 mountBooking。没填时只有①，和以前逐字一样。
--   写法和「必须落在这个嵌入码白名单的某个网站下」由应用校验（packages/domain/src/embed.ts 的 embedKeyIssues），这里只兜长度。
--   已有的嵌入码为空（按没填），不用做任何迁移操作。授权不变（0400 已给 nozomi_platform 读、写 embed_keys）。
alter table embed_keys add column booking_url text;
alter table embed_keys add constraint embed_keys_booking_url_check check (booking_url is null or char_length(booking_url) between 1 and 2000);
