/**
 * 登录、设置密码这类不需要登录的页面共用的版式（docs/design/pages/login.md 2.2；M6 改版见 ADR 0066）：
 * 顶部一条品牌色带，品牌标识在色带上；下面一张卡片压住色带的下沿，表单都在卡片里。
 * 品牌不是标题（页面的 h1 是卡片里的「运营后台」等），所以放在 <p> 里。
 * 主题切换在文档顺序上排在卡片之后，Tab 最后才到它；它放在 bg-surface 的小底板上，不直接放在深色色带上。
 */
import type { ReactNode } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.tsx";
import { Brand } from "./Brand.tsx";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <header className="auth-page__header">
        <p className="auth-page__brand">
          <Brand tone="on-brand" />
        </p>
      </header>
      <main className="auth-card">{children}</main>
      <div className="auth-page__theme">
        <ThemeSwitcher />
      </div>
    </div>
  );
}
