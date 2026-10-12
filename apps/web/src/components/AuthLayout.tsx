/**
 * 登录、设置密码这类不需要登录的页面共用的版式（docs/design/pages/login.md 2.2）：
 * 一张居中的卡片 + 右上角的主题切换。主题切换在文档顺序上排在卡片之后，Tab 最后才到它。
 */
import type { ReactNode } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.tsx";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <main className="auth-card">
        <p className="auth-card__brand">NOZOMI</p>
        {children}
      </main>
      <div className="auth-page__theme">
        <ThemeSwitcher />
      </div>
    </div>
  );
}
