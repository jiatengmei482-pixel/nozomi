/**
 * 运营后台「待审核」（敏感操作双人复核，ADR 0023）：待审核队列和历史。
 * 每条写清楚改什么、改之前和之后、谁发起的、为什么；按接口给的 `can` 显示批准 / 驳回 / 撤回——发起人看不到批准和驳回（不能审核自己发起的）。
 * 批准时按那一刻的数据再校验：不能生效的（发起后被别人改过、低于现在的下限、和别的规则冲突）把原因写出来，记录仍是待审核，可以驳回。
 */
import { type ReactNode, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type Approval, type Channel, decideApproval, listAllChannels, listApprovals } from "../../api/channels.ts";
import { ApiError } from "../../api/client.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { APPROVAL_KIND_NAMES, APPROVAL_STATUS_BADGES, approvalChanges, channelPath } from "../../lib/channel-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
type Decision = "approve" | "reject" | "withdraw";
const DECISION_NAMES: Readonly<Record<Decision, string>> = { approve: "批准", reject: "驳回", withdraw: "撤回" };

function decisionFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "APPROVAL_SELF_REVIEW") return "发起人不能审核自己发起的改动，请让另一位有审核权限的同事处理。";
    if (err.code === "APPROVAL_NOT_PENDING") return "这条已经有结论了（可能刚被别人处理），刷新看看。";
    if (err.code === "APPROVAL_STALE") return "发起之后，要改的对象已经被别的改动改过了，不能照旧生效。请驳回，让发起人按现在的内容重新发起。";
    if (err.code === "VALIDATION_FAILED") return `按现在的数据，这个改动不合规则了：${serverIssues(err).map((issue) => issue.message).join("；") || err.message}。请驳回。`;
    if (["MARKUP_RULE_CONFLICT", "RULES_BELOW_FLOOR", "CHANNEL_STATUS_UNCHANGED"].includes(err.code)) return `按现在的数据不能生效：${err.message}。请驳回。`;
    if (err.status === 403) return "你没有审核这一类改动的权限。";
  }
  return failureText(err, "提交");
}

function ApprovalCard({ approval, channel, onDecide }: { approval: Approval; channel: Channel | null; onDecide(approval: Approval, decision: Decision): void }) {
  const changes = approvalChanges(approval.kind, approval.before, approval.payload, channel?.settle_currency ?? null);
  const headingId = `approval-${approval.id}`;
  return (
    <section className="card approval-card" aria-labelledby={headingId}>
      <div className="card__title-row">
        <h2 className="card__title" id={headingId}>
          {APPROVAL_KIND_NAMES[approval.kind]}
        </h2>
        <StatusBadge {...APPROVAL_STATUS_BADGES[approval.status]} />
      </div>
      <p>{approval.summary}</p>
      {channel !== null && (
        <p>
          渠道：
          <Link className="link" to={channelPath(channel.id)}>
            {channel.name}
          </Link>
        </p>
      )}
      {changes.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll" tabIndex={0} role="region" aria-label="改了什么">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">项目</th>
                  <th scope="col">改之前</th>
                  <th scope="col">改之后</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((line) => (
                  <tr key={line.label}>
                    <th scope="row">{line.label}</th>
                    <td>{line.before}</td>
                    <td>
                      <strong>{line.after}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <dl className="details">
        <div>
          <dt>发起</dt>
          <dd>{`${approval.requested_by.name}（${approval.requested_by.email}）· ${formatLocalDateTime(approval.requested_at)}`}</dd>
        </div>
        {approval.request_note && (
          <div>
            <dt>发起说明</dt>
            <dd>{approval.request_note}</dd>
          </div>
        )}
        {approval.decided_at && (
          <div>
            <dt>{approval.status === "withdrawn" ? "撤回" : "审核"}</dt>
            <dd>{`${approval.decided_by ? `${approval.decided_by.name}（${approval.decided_by.email}）· ` : ""}${formatLocalDateTime(approval.decided_at)}${approval.decision_note ? ` · ${approval.decision_note}` : ""}`}</dd>
          </div>
        )}
      </dl>
      {approval.status === "pending" && (
        <div className="approval-card__actions">
          {approval.can.approve && (
            <Button variant="primary" onClick={() => onDecide(approval, "approve")}>
              批准
            </Button>
          )}
          {approval.can.reject && (
            <Button variant="secondary" className="button--danger-text" onClick={() => onDecide(approval, "reject")}>
              驳回
            </Button>
          )}
          {approval.can.withdraw && <Button onClick={() => onDecide(approval, "withdraw")}>撤回</Button>}
          {!approval.can.approve && approval.can.withdraw && <span className="table__muted">这是你发起的，要等另一位有审核权限的同事处理。</span>}
          {!approval.can.approve && !approval.can.withdraw && <span className="table__muted">你可以查看，但没有审核这一类改动的权限。</span>}
        </div>
      )}
    </section>
  );
}

export function ApprovalsPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`待审核 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("approval.read");
  const canSeeChannels = usePlatformCan("channel.read");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") === "all" ? "all" : "pending";
  const [round, setRound] = useState(0);
  const loaded = useLoad(`approvals:${status}:${round}`, canRead ? (session) => listApprovals(session, { status, limit: 100 }) : null);
  const channels = useLoad("approvals-channels", canSeeChannels ? listAllChannels : null);
  const channelById = useMemo(() => new Map((channels.state.data?.items ?? []).map((channel) => [channel.id, channel])), [channels.state.data]);
  const [deciding, setDeciding] = useState<{ approval: Approval; decision: Decision } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="待审核">
      <Page title="待审核">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  const confirm = async (): Promise<void> => {
    if (deciding === null) return;
    setBusy(true);
    setProblem(null);
    try {
      await decideApproval(token, deciding.approval.id, deciding.decision, note.trim() === "" ? null : note.trim());
      toast(deciding.decision === "approve" ? "已批准，改动已生效" : deciding.decision === "reject" ? "已驳回" : "已撤回");
      setDeciding(null);
      setRound(round + 1);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(decisionFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const items = loaded.state.data?.items ?? [];
  return shell(
    <>
      <p className="page__lead">修改渠道的加价比例和加价规则、停用渠道，都要一个人发起、另一个人批准后才生效；发起人不能审核自己发起的。每一步都记在审计日志里。</p>
      <div className="filter-bar" role="search">
        <SelectField inline label="显示" value={status} options={[{ value: "pending", label: "待审核" }, { value: "all", label: "全部（含历史）" }]} onChange={(value) => setParams(value === "all" ? { status: "all" } : {}, { replace: true })} />
      </div>
      {loaded.state.data === null ? (
        loaded.state.status === "error" || loaded.state.status === "forbidden" ? (
          <StateBlock title="加载失败" description="请检查网络后重试。" action={<Button variant="secondary" onClick={loaded.reload}>重试</Button>} />
        ) : (
          <Skeleton lines={["long", "long", "long"]} />
        )
      ) : items.length === 0 ? (
        <StateBlock tone="neutral" title={status === "pending" ? "没有待审核的改动" : "还没有复核记录"} description="渠道经理发起修改加价、加价规则或暂停渠道后，会出现在这里。" />
      ) : (
        <>
          <p className="table__muted">{`共 ${loaded.state.data.total} 条${loaded.state.data.total > items.length ? `，这里显示最近的 ${items.length} 条` : ""}`}</p>
          {items.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              channel={approval.resource === "channel" ? (channelById.get(approval.resource_id) ?? null) : null}
              onDecide={(target, decision) => {
                setDeciding({ approval: target, decision });
                setNote("");
                setProblem(null);
              }}
            />
          ))}
        </>
      )}
      {deciding !== null && (
        <Dialog
          open
          title={`${DECISION_NAMES[deciding.decision]}：${APPROVAL_KIND_NAMES[deciding.approval.kind]}`}
          busy={busy}
          onClose={() => setDeciding(null)}
          footer={
            <>
              <Button variant="text" data-autofocus disabled={busy} onClick={() => setDeciding(null)}>
                取消
              </Button>
              <Button variant={deciding.decision === "reject" ? "secondary" : "primary"} className={deciding.decision === "reject" ? "button--danger-text" : undefined} loading={busy} loadingText="提交中…" onClick={() => void confirm()}>
                {DECISION_NAMES[deciding.decision]}
              </Button>
            </>
          }
        >
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <p>{deciding.approval.summary}</p>
          {deciding.decision === "approve" && <p>批准后改动立即生效：之后的询价就按新的规则算。</p>}
          <TextField label="说明（选填）" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </Dialog>
      )}
    </>,
  );
}
