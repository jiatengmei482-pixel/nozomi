/**
 * 嵌入组件脚本的构建入口（M9E-03）：打包成 IIFE，全局名 NozomiBooking（vite.widget.config.ts），合作网站调 `NozomiBooking.init({...})`；
 * M9E-16（ADR 0095）起另有 `NozomiBooking.mountBooking({...})`，在合作网站自己的预订页里挂整个预订流程。
 * 这里只导出对外的几项；界面和逻辑在 widget-ui.ts、widget-booking.ts、widget-core.ts、booking-protocol.ts。
 */
export { init } from "./widget-ui.ts";
export { mountBooking } from "./widget-booking.ts";
export const version = "1";
