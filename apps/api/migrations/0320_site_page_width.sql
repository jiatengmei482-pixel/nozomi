-- 官网页面宽度（M8-28，ADR 0079 第 5 节）：官网设置加 page_width，三档 standard / wide / full，没设过是 standard。只加列，不含任何数据。
alter table site_settings add column page_width text not null default 'standard';
alter table site_settings add constraint site_settings_page_width_check check (page_width in ('standard', 'wide', 'full'));
