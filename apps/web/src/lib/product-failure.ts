/** 商品各页面共用的出错文字（docs/design/pages/tenant-products.md 8.1）。不向用户显示错误码。 */
import { ApiError, NetworkError } from "../api/client.ts";

export const PRODUCT_FORBIDDEN_TEXT = "你没有权限修改商品。需要的话，请联系你们的管理员开通。";

/** 网络不通、服务器出错时的一句话。`action` 是「保存」「上架」这样的动词。 */
export function saveFailureText(err: unknown, action: string, kept = false): string {
  const tail = kept ? "你填写的内容还在。" : "";
  if (err instanceof NetworkError) return `网络连接失败，请检查网络后重试。${tail}`;
  return `系统暂时无法${action}，请稍后再试。${tail}`;
}

/** 后端在 400 里按原因代码说的事（`details.issues[]`）。 */
export interface ServerIssue {
  path: string;
  reason: string;
  message: string;
  detail: Record<string, unknown>;
}

export function serverIssues(err: unknown): ServerIssue[] {
  if (!(err instanceof ApiError) || !Array.isArray(err.details["issues"])) return [];
  return (err.details["issues"] as unknown[]).map((entry) => {
    const issue = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    return {
      path: typeof issue["path"] === "string" ? issue["path"] : "",
      reason: typeof issue["reason"] === "string" ? issue["reason"] : "",
      message: typeof issue["message"] === "string" && /[一-鿿]/.test(issue["message"]) ? issue["message"] : "这一项不符合要求，请检查后重试",
      detail: typeof issue["detail"] === "object" && issue["detail"] !== null ? (issue["detail"] as Record<string, unknown>) : {},
    };
  });
}
