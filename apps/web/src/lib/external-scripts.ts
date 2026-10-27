/**
 * 允许页面加载的站外脚本，只有这里登记的（M3-08，ADR 0046）。别处的代码不能写站外网址，也不能自己插 `<script>`。
 *
 * - Stripe.js：Stripe 要求从 js.stripe.com 加载，不能打包进本站、不能自托管（PCI 合规：卡号只进 Stripe 的 iframe）。
 *   只有官网的订单页（`/book/…`）在要付款时加载它，内容安全策略也只在 `/book` 下放行 Stripe（apps/web/build/edge-config.ts）。
 *   不加 SRI（integrity）：Stripe 会在同一个地址上更新这个文件，官方明确不支持 SRI。
 */
export const EXTERNAL_SCRIPTS = {
  stripe: "https://js.stripe.com/v3/",
} as const;
