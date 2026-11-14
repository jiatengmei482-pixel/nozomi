-- M9E-10（0410 由 M9P-01 使用）：嵌入码加「外观」（组件的版式）：card 卡片（默认）、bar 横条。
-- 运营后台生成的嵌入代码按它写 `layout`；公开的 `/embed/v1/config` 不返回它（合作网站以代码里写的为准）。
-- 只加列，已有的嵌入码按默认值算卡片；授权不变（0400 已给 nozomi_platform 读、写），不含任何数据。
alter table embed_keys add column layout text not null default 'card';
alter table embed_keys add constraint embed_keys_layout check (layout in ('card', 'bar'));
