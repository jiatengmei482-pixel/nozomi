/**
 * 供应商后台登录后的首页（运营后台的首页是 PlatformHomePage）：只显示当前登录人、角色，以及（供应商后台）所属供应商的名称与状态。
 * 数据全部来自 `auth/me`，没有任何预置内容。
 */
import { usePortalSession } from "../auth/PortalSession.tsx";
import { AppShell, Page } from "../components/AppShell.tsx";
import { Button } from "../components/Button.tsx";
import { Skeleton, StateBlock } from "../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../components/StatusBadge.tsx";
import { roleName } from "../lib/portal.ts";
import { useDocumentTitle } from "../lib/use-document-title.ts";

export function HomePage() {
  const { portal, account, reloadAccount } = usePortalSession();
  useDocumentTitle(`首页 · NOZOMI ${portal.name}`);

  return (
    <AppShell pageName="首页">
      <Page title="首页">
        <section className="card" aria-labelledby="current-account-title">
          <h2 className="card__title" id="current-account-title">
            当前登录
          </h2>
          {account.status === "loading" && <Skeleton lines={["medium", "long", "short"]} />}
          {account.status === "error" && (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={reloadAccount}>
                  重试
                </Button>
              }
            />
          )}
          {account.status === "ready" && (
            <dl className="details">
              <div className="details__item">
                <dt>姓名</dt>
                <dd>{account.account.name}</dd>
              </div>
              <div className="details__item">
                <dt>邮箱</dt>
                <dd>{account.account.email}</dd>
              </div>
              <div className="details__item">
                <dt>角色</dt>
                <dd>{roleName(portal.key, account.account.role) ?? "—"}</dd>
              </div>
              {account.account.tenant && (
                <>
                  <div className="details__item">
                    <dt>供应商名称</dt>
                    <dd>{account.account.tenant.name}</dd>
                  </div>
                  <div className="details__item">
                    <dt>供应商状态</dt>
                    <dd>
                      <StatusBadge {...TENANT_STATUS_BADGES[account.account.tenant.status]} />
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </section>
      </Page>
    </AppShell>
  );
}
