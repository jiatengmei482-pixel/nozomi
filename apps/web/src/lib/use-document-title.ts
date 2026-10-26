import { useLayoutEffect } from "react";

/** 设置浏览器标签页的标题。在提交页面内容的同一时刻设置（布局副作用），不会出现「内容已经换了、标题还是上一页的」一瞬间。 */
export function useDocumentTitle(title: string): void {
  useLayoutEffect(() => {
    document.title = title;
  }, [title]);
}
