/**
 * 把取回来的文件交给浏览器保存（docs/design/pages/tenant-inventory.md 7.2）。
 * 导出要带登录凭证，所以不是普通链接：页面用请求（令牌在请求头里）取回文件，再用一个临时的地址让浏览器存下来，用完立即收回。
 */
import type { DownloadedFile } from "../api/client.ts";

export function saveFile(file: DownloadedFile, fallbackName: string): string {
  const name = file.filename ?? fallbackName;
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // 留一点时间让浏览器开始保存，再把临时地址收回
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
