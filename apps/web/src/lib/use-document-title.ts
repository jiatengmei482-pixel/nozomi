import { useEffect } from "react";

/** 设置浏览器标签页的标题。 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
