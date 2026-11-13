/**
 * 嵌入组件脚本的构建入口（M9E-03）：打包成 IIFE，全局名 NozomiBooking（vite.widget.config.ts），合作网站调 `NozomiBooking.init({...})`。
 * 这里只导出对外的两项；界面和逻辑在 widget-ui.ts、widget-core.ts。
 */
export { init } from "./widget-ui.ts";
export const version = "1";
