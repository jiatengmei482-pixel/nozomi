/**
 * 运营后台「资质审核」（M4-01，ADR 0028）：待审核的资质（每个供应商每个类型只列最新提交的那份，提交得早的在前），
 * 和 30 天内到期（含已过期）的资质。审核在供应商详情页做（要对照这家供应商的其他资质和企业信息）。
 */
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { type QueuedDocument, listDocumentQueue } from "../../api/onboarding.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { type Column, DataTable, type TableState } from "../../components/DataTable.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge, TENANT_STATUS_BADGES } from "../../components/StatusBadge.tsx";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { DOCUMENT_STATUS_BADGES } from "../../lib/onboarding-display.ts";
import { tenantPath } from "../../lib/platform-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

type Kind = "pending" | "expiring";

export function DocumentQueuePage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`资质审核 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("tenant.read");
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get("kind") === "expiring" ? "expiring" : "pending";
  const loaded = useLoad<{ items: QueuedDocument[]; next_cursor: string | null; total: number }>(`document-queue:${kind}`, canRead ? (token) => listDocumentQueue(token, { kind, withinDays: 30 }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="资质审核">
      <Page title="资质审核">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />);
  const columns: Column<QueuedDocument>[] = [
    {
      key: "tenant",
      header: "供应商",
      wrap: true,
      cell: (row) => (
        <Link className="link" to={tenantPath(row.tenant.id)}>
          {row.tenant.name}
        </Link>
      ),
    },
    { key: "status", header: "供应商状态", cell: (row) => <StatusBadge {...TENANT_STATUS_BADGES[row.tenant.status]} /> },
    { key: "type", header: "证件", wrap: true, cell: (row) => row.document.type_name },
    kind === "pending"
      ? { key: "submitted", header: "提交时间", cardLabel: true, cell: (row) => <span className="table__muted">{formatLocalDateTime(row.document.submitted_at)}</span> }
      : { key: "expires", header: "到期日", cardLabel: true, cell: (row) => row.document.expires_on ?? "—" },
    { key: "doc", header: "资质状态", cell: (row) => <StatusBadge {...DOCUMENT_STATUS_BADGES[row.document.status]} /> },
    {
      key: "actions",
      header: "操作",
      cell: (row) => (
        <Link className="link" to={tenantPath(row.tenant.id)} aria-label={`${kind === "pending" ? "去审核" : "去查看"} ${row.tenant.name} 的 ${row.document.type_name}`}>
          {kind === "pending" ? "去审核" : "去查看"}
        </Link>
      ),
    },
  ];
  const state = loaded.state;
  const tableState: TableState = state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.data !== null ? "ready" : state.status === "loading" ? "loading" : "error";
  return shell(
    <>
      <p className="page-intro">供应商交的资质在这里排队。审核在供应商详情页的「资质」里做：下载核对、通过（可改正到期日）、驳回或要求补充（都要写原因，供应商看得到）。</p>
      <div className="filter-bar">
        <SelectField<Kind>
          inline
          label="看哪些"
          value={kind}
          options={[
            { value: "pending", label: "待审核" },
            { value: "expiring", label: "30 天内到期" },
          ]}
          onChange={(value) => setParams(value === "pending" ? {} : { kind: value }, { replace: true })}
        />
      </div>
      <div className="card-table">
        <DataTable
          label={kind === "pending" ? "待审核的资质" : "30 天内到期的资质"}
          columns={columns}
          rows={state.data?.items ?? []}
          rowKey={(row) => row.document.id}
          state={tableState}
          onRetry={loaded.reload}
          empty={<StateBlock tone="neutral" title={kind === "pending" ? "没有待审核的资质" : "30 天内没有到期的资质"} description={kind === "pending" ? "供应商提交了新的资质会出现在这里。" : "到期前 30 天、7 天会提醒供应商换证。"} />}
        />
      </div>
      {state.data !== null && <p className="table__muted">{`共 ${state.data.total} 份${state.data.next_cursor !== null ? "（只显示最早的 50 份）" : ""}`}</p>}
    </>,
  );
}
