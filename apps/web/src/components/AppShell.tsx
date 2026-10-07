/**
 * 后台框架（docs/design/03-layout.md 第 1 节、02-components.md 第 10 节）：侧边栏 + 顶栏 + 内容区。
 *
 * - ≥ 1024px 侧边栏常驻；更窄时点顶栏的菜单按钮从左侧滑入（原生 <dialog>：焦点限制在内部、Esc 关闭）。
 * - 菜单只列真实存在的页面。
 * - 账号正在用临时密码、必须先改密码时：不显示侧边栏和菜单按钮，账号菜单里只留「退出登录」。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { roleName } from "../lib/portal.ts";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.tsx";
import { IconButton } from "./Button.tsx";
import { Dropdown } from "./Dropdown.tsx";
import { Icon, type IconName } from "./Icon.tsx";

/** 侧边栏常驻显示的最小宽度：tokens.css 的 --breakpoint-lg。 */
const SIDEBAR_PINNED_QUERY = "(min-width: 1024px)";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

function SidebarContent({ items, onNavigate }: { items: readonly NavItem[]; onNavigate?: () => void }) {
  const { portal } = usePortalSession();
  return (
    <>
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">NOZOMI</span>
        <span className="sidebar__portal">{portal.name}</span>
      </div>
      <nav aria-label="主菜单" className="sidebar__nav">
        <ul className="sidebar__list">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end className="nav-item" {...(onNavigate ? { onClick: onNavigate } : {})}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function AccountMenu() {
  const { portal, account, signOut, mustChangePassword } = usePortalSession();
  const [signingOut, setSigningOut] = useState(false);
  const ready = account.status === "ready" ? account.account : null;
  const role = ready ? (roleName(portal.key, ready.role) ?? "—") : null;

  return (
    <Dropdown
      buttonClassName="account-button"
      align="end"
      buttonContent={
        <>
          <span className="account-button__avatar" aria-hidden="true">
            {ready ? [...ready.name][0] : ""}
          </span>
          <span className="visually-hidden">账号菜单：</span>
          <span className="account-button__name">{ready ? ready.name : "账号"}</span>
          {role && <span className="account-button__role">{role}</span>}
          <Icon name="chevron-down" />
        </>
      }
    >
      {ready && (
        <div className="menu-header">
          <span className="menu-header__name">{ready.name}</span>
          <span className="menu-header__detail">{role}</span>
          <span className="menu-header__detail menu-header__email">{ready.email}</span>
        </div>
      )}
      {!mustChangePassword && (
        <Link role="menuitem" className="menu-item" to={portal.paths.changePassword}>
          <span className="menu-item__text">修改密码</span>
        </Link>
      )}
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        aria-busy={signingOut || undefined}
        onClick={() => {
          if (signingOut) return;
          setSigningOut(true);
          void signOut();
        }}
      >
        <span className="menu-item__text">退出登录</span>
      </button>
    </Dropdown>
  );
}

export function AppShell({ pageName, children }: { pageName: string; children: ReactNode }) {
  const { portal, lastShellPath, mustChangePassword } = usePortalSession();
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items: readonly NavItem[] = [{ to: portal.paths.home, label: "首页", icon: "home" }];

  const openDrawer = (): void => {
    drawerRef.current?.showModal();
    setDrawerOpen(true);
  };
  const closeDrawer = (): void => drawerRef.current?.close();

  // 窗口变宽到侧边栏常驻时，滑出的那一份没有意义了，关掉
  useEffect(() => {
    const pinned = window.matchMedia(SIDEBAR_PINNED_QUERY);
    const onChange = (): void => {
      if (pinned.matches) drawerRef.current?.close();
    };
    pinned.addEventListener("change", onChange);
    return () => pinned.removeEventListener("change", onChange);
  }, []);

  // 换页后把焦点交给正文，读屏会读出新页面的标题；第一次进入后台（刚登录、刷新）不抢焦点
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = lastShellPath.current;
    lastShellPath.current = location.pathname;
    if (previous !== null && previous !== location.pathname) mainRef.current?.focus();
  }, [location.pathname, lastShellPath]);

  return (
    <div className={mustChangePassword ? "shell shell--restricted" : "shell"}>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      {!mustChangePassword && (
        <>
          <aside className="sidebar sidebar--pinned">
            <SidebarContent items={items} />
          </aside>
          <dialog
            ref={drawerRef}
            className="sidebar sidebar--drawer"
            aria-label="主菜单"
            onClose={() => {
              setDrawerOpen(false);
              menuButtonRef.current?.focus();
            }}
            onClick={(event) => {
              if (event.target === drawerRef.current) closeDrawer();
            }}
          >
            <div className="sidebar__drawer-body">
              <SidebarContent items={items} onNavigate={closeDrawer} />
            </div>
          </dialog>
        </>
      )}
      <div className="shell__column">
        <header className="topbar">
          {mustChangePassword ? (
            <span className="topbar__brand">
              <span className="topbar__brand-name">NOZOMI</span>
              <span className="topbar__portal">{portal.name}</span>
            </span>
          ) : (
            <IconButton
              ref={menuButtonRef}
              icon="menu"
              label="打开菜单"
              tooltipAlign="start"
              className="topbar__menu-button"
              aria-expanded={drawerOpen}
              onClick={openDrawer}
            />
          )}
          <nav aria-label="当前位置" className="breadcrumb">
            <span aria-current="page">{pageName}</span>
          </nav>
          <div className="topbar__actions">
            <ThemeSwitcher />
            <AccountMenu />
          </div>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="shell__main">
          {children}
        </main>
      </div>
    </div>
  );
}

/** 内容区的页面标题行 + 内容。每页只有这一个 <h1>。 */
export function Page({ title, width = "content", children }: { title: string; width?: "content" | "form"; children: ReactNode }) {
  return (
    <div className={`page page--${width}`}>
      <div className="page__header">
        <h1 className="page__title">{title}</h1>
      </div>
      {children}
    </div>
  );
}
