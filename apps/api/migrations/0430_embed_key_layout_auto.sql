-- M9E-14：嵌入码的外观加「自动」auto（按组件容器宽度：≥ 900 px 横条、窄了卡片），并改为默认值。
-- 公开的 `/embed/v1/config` 从这次起返回 layout，合作网站 init 没传 layout 时用它。
-- 已有的 card 一律改成 auto：0420（M9E-10，2026-11-14 部署）加列时已有的嵌入码都按默认值填了 card，
-- 后台新建时也默认选卡片，存下来的 card 分不出是不是运营特意选的；业主要的是「不用选、自动适配」，所以按没选处理。
-- bar 只能是运营特意选的，保持不变。只改外观这一列，不动版本号和其他字段；不新增任何数据。
alter table embed_keys drop constraint embed_keys_layout;
alter table embed_keys add constraint embed_keys_layout check (layout in ('auto', 'card', 'bar'));
alter table embed_keys alter column layout set default 'auto';
update embed_keys set layout = 'auto' where layout = 'card';
