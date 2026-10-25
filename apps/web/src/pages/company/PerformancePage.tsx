/**
 * 供应商后台「履约评分」（M4-01，ADR 0028）：需求「租户可在自己后台看到各项指标」。每个角色都能看；只有自己的分，没有别的供应商的。
 */
import type { ReactNode } from "react";
import { type TenantPerformance, getOwnPerformance } from "../../api/onboarding.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { PerformanceView } from "./PerformanceView.tsx";

export const PERFORMANCE_PATH = "/performance";

export function PerformancePage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`履约评分 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("performance.read");
  const loaded = useLoad<TenantPerformance>("tenant-performance", canRead ? getOwnPerformance : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="履约评分">
      <Page title="履约评分" width="form">
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员。" />);
  const data = loaded.state.data;
  return shell(
    <section className="card" aria-label="履约评分">
      {data !== null ? (
        <>
          <p className="page-intro">评分用于比价：和最低价相差 3% 以内时，评分高的中标。下面是最近一次每日评分的各项指标。</p>
          <PerformanceView performance={data} audience="tenant" />
        </>
      ) : loaded.state.status === "error" ? (
        <StateBlock
          title="加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="secondary" onClick={loaded.reload}>
              重试
            </Button>
          }
        />
      ) : (
        <Skeleton lines={["medium", "long", "long"]} />
      )}
    </section>,
  );
}
