-- M9E-16（0430 由 M9E-14 使用）：预订流程整体嵌在合作网站页面里的第一期（ADR 0095 第五节、第九节第 1 小节、Q6、Q13）。只加列，不回填，不含任何数据。
--
-- delivery：草稿交给谁接着走——redirect 整页跳主站 /book/new、host_page 跳合作网站自己的预订页（组件传了 bookingUrl）。
--   建草稿时由服务端按请求记在 booking_drafts 上，询价、下单时随来源抄到 quote_embed_sources、order_embed_sources；
--   旧行为空，按 redirect 算。只做统计。
-- allow_host_page：嵌入码的「允许整页嵌入」开关（Q13），默认关；只有打开了，/embed/v1/frame-check 才放行 /embed/book 被这个嵌入码白名单里的网站嵌入。
--   已有的嵌入码都按关（加列时的默认值），不受影响。授权不变（0400 已给 nozomi_platform 读、写 embed_keys，读、增两张来源表）。
alter table booking_drafts add column delivery text;
alter table booking_drafts add constraint booking_drafts_delivery_check check (delivery is null or delivery in ('redirect', 'host_page'));
alter table quote_embed_sources add column delivery text;
alter table quote_embed_sources add constraint quote_embed_sources_delivery_check check (delivery is null or delivery in ('redirect', 'host_page'));
alter table order_embed_sources add column delivery text;
alter table order_embed_sources add constraint order_embed_sources_delivery_check check (delivery is null or delivery in ('redirect', 'host_page'));
alter table embed_keys add column allow_host_page boolean not null default false;
