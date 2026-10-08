/**
 * 后台框架（docs/design/03-layout.md 第 1 节、02-components.md 第 10 节）：侧边栏 + 顶栏 + 内容区。
 *
 * - ≥ 1024px 侧边栏常驻；更窄时点顶栏的菜单按钮从左侧滑入（原生 <dialog>：焦点限制在内部、Esc 关闭）。
 * - 菜单只列真实存在的页面。
 * - 账号正在用临时密码、必须先改密码时：不显示侧边栏和菜单按钮，账号菜单里只留「退出登录」。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isPlatformRole, isTenantRole, platformRoleCan, tenantRoleCan } from "@nozomi/domain";
import { Link, useLocation } from "react-router";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { type Portal, roleName } from "../lib/portal.ts";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.tsx";
import { IconButton } from "./Button.tsx";
import { Dropdown } from "./Dropdown.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Skeleton } from "./States.tsx";

/** 侧边栏常驻显示的最小宽度：tokens.css 的 --breakpoint-lg。 */
const SIDEBAR_PINNED_QUERY = "(min-width: 1024px)";

interface NavLeaf {
  to: string;
  label: string;
  icon?: IconName;
  /** 当前地址以它开头就算当前页（列表页的菜单项也管它的新增页、编辑页）；不给则要求完全相同 */
  prefix?: boolean;
}

interface NavGroup {
  key: string;
  label: string;
  icon: IconName;
  children: readonly NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

/** 菜单只列已经做出来、当前角色有权限看的页面（docs/design/pages/platform-home.md 第 2 节）。 */
function navEntries(portal: Portal, home: string, role: string | null): NavEntry[] {
  const entries: NavEntry[] = [{ to: home, label: "首页", icon: "home" }];
  if (portal === "platform" && role !== null && isPlatformRole(role) && platformRoleCan(role, "master_data.read")) {
    entries.push({
      key: "master",
      label: "主数据",
      icon: "database",
      children: [
        { to: "/platform/master/cities", label: "城市", prefix: true },
        { to: "/platform/master/places", label: "地点", prefix: true },
        { to: "/platform/master/vehicle-groups", label: "车型组", prefix: true },
        { to: "/platform/master/addons", label: "附加服务", prefix: true },
      ],
    });
  }
  if (portal === "tenant" && role !== null && isTenantRole(role) && tenantRoleCan(role, "area.read")) {
    entries.push({ key: "catalog", label: "商品配置", icon: "map", children: [{ to: "/areas", label: "区域", prefix: true }] });
  }
  return entries;
}

function isCurrent(leaf: NavLeaf, pathname: string): boolean {
  return leaf.prefix ? pathname === leaf.to || pathname.startsWith(`${leaf.to}/`) : pathname === leaf.to;
}

/** 用户收起了哪些分组：只记在内存里（本次打开期间有效）。 */
const collapsedGroups = new Set<string>();

function NavLeafLink({ leaf, onNavigate }: { leaf: NavLeaf; onNavigate?: (() => void) | undefined }) {
  const { pathname } = useLocation();
  return (
    <Link to={leaf.to} className={leaf.icon ? "nav-item" : "nav-item nav-item--child"} aria-current={isCurrent(leaf, pathname) ? "page" : undefined} {...(onNavigate ? { onClick: onNavigate } : {})}>
      {leaf.icon && <Icon name={leaf.icon} />}
      <span>{leaf.label}</span>
    </Link>
  );
}

function NavGroupItem({ group, onNavigate }: { group: NavGroup; onNavigate?: (() => void) | undefined }) {
  const { pathname } = useLocation();
  const containsCurrent = group.children.some((leaf) => isCurrent(leaf, pathname));
  const [collapsed, setCollapsed] = useState(() => collapsedGroups.has(group.key) && !containsCurrent);
  const toggle = (): void => {
    if (collapsed) collapsedGroups.delete(group.key);
    else collapsedGroups.add(group.key);
    setCollapsed(!collapsed);
  };
  return (
    <>
      <button type="button" className={collapsed && containsCurrent ? "nav-item nav-item--group nav-item--within" : "nav-item nav-item--group"} aria-expanded={!collapsed} onClick={toggle}>
        <Icon name={group.icon} />
        <span className="nav-item__label">{group.label}</span>
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
      </button>
      {!collapsed && (
        <ul className="sidebar__list sidebar__list--children">
          {group.children.map((leaf) => (
            <li key={leaf.to}>
              <NavLeafLink leaf={leaf} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { portal, account, navigationAllowed } = usePortalSession();
  const brand = (
    <div className="sidebar__brand">
      <span className="sidebar__brand-name">NOZOMI</span>
      <span className="sidebar__portal">{portal.name}</span>
    </div>
  );
  if (!navigationAllowed) {
    // 还不知道这个账号能不能用别的页面（auth/me 没回来）：先不画菜单，免得画出来又收回去
    return (
      <>
        {brand}
        {account.status === "loading" && (
          <div className="sidebar__nav">
            <Skeleton lines={["long"]} label="正在加载菜单" />
          </div>
        )}
      </>
    );
  }
  const entries = navEntries(portal.key, portal.paths.home, account.status === "ready" ? account.account.role : null);
  return (
    <>
      {brand}
      <nav aria-label="主菜单" className="sidebar__nav">
        <ul className="sidebar__list">
          {entries.map((entry) => (
            <li key={"key" in entry ? entry.key : entry.to}>{"key" in entry ? <NavGroupItem group={entry} onNavigate={onNavigate} /> : <NavLeafLink leaf={entry} onNavigate={onNavigate} />}</li>
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

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * `pageName` 是面包屑的最后一级（当前页）；`trail` 是它前面的几级（有地址的是链接）。
 * < 768px 只显示最后一级。
 */
export function AppShell({ pageName, trail = [], children }: { pageName: string; trail?: readonly Crumb[]; children: ReactNode }) {
  const { portal, lastShellPath, mustChangePassword } = usePortalSession();
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
            <SidebarContent />
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
              <SidebarContent onNavigate={closeDrawer} />
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
          {mustChangePassword ? (
            <span className="breadcrumb" />
          ) : (
            <nav aria-label="当前位置" className="breadcrumb">
              {trail.map((crumb) => (
                <span key={crumb.label} className="breadcrumb__ancestor">
                  {crumb.to !== undefined ? (
                    <Link className="link" to={crumb.to}>
                      {crumb.label}
                    </Link>
                  ) : (
                    crumb.label
                  )}
                  <span aria-hidden="true"> / </span>
                </span>
              ))}
              <span aria-current="page">{pageName}</span>
            </nav>
          )}
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
export function Page({ title, titleLang, width = "content", action, meta, children }: { title: ReactNode; titleLang?: string; width?: "content" | "form" | "centered"; action?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className={`page page--${width}`}>
      <div className="page__header">
        <h1 className="page__title" lang={titleLang}>
          {title}
        </h1>
        {action && <div className="page__action">{action}</div>}
      </div>
      {meta && <div className="page__meta">{meta}</div>}
      {children}
    </div>
  );
}
