/**
 * 归 API 的路径前缀。正式环境的反向代理、开发和端到端测试用的 Vite 代理都按这张表转发；
 * 其余路径归前端。前端路由不能落在这些前缀下（`portal.test.ts` 有检查）。
 */
export const API_PATH_PREFIXES = ["/health", "/platform/v1", "/tenant/v1", "/sales/v1", "/webhooks"] as const;

export function isApiPath(path: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
