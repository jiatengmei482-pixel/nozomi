/**
 * 运营后台「待审核」（敏感操作双人复核，ADR 0023）：待审核队列和历史。
 * 每条写清楚改什么、改之前和之后、谁发起的、为什么；按接口给的 `can` 显示批准 / 驳回 / 撤回——发起人看不到批准和驳回（不能审核自己发起的）。
 * 批准时按那一刻的数据再校验：不能生效的（发起后被别人改过、低于现在的下限、和别的规则冲突）把原因写出来，记录仍是待审核，可以驳回。
 */
import { type ReactNode, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type Approval, type ApprovalKind, type Channel, decideApproval, getChannel, listAllChannels, listApprovals } from "../../api/channels.ts";
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
import { rolePath, staffPath, tenantPath } from "../../lib/platform-paths.ts";
import { APPROVAL_KIND_NAMES, APPROVAL_STATUS_BADGES, approvalChanges, approvalSummaryText, belowFloorRuleLines, channelPath, isFxApproval, isTenantApproval } from "../../lib/channel-display.ts";
import { CURRENCY_NAMES, FX_PATH } from "../../lib/fx-display.ts";
import { failureText } from "../../lib/failure.ts";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { BelowFloorAlert } from "./ChannelSections.tsx";
import { ApprovalImpact } from "./PricingImpactPanel.tsx";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
type Decision = "approve" | "reject" | "withdraw";
const DECISION_NAMES: Readonly<Record<Decision, string>> = { approve: "批准", reject: "驳回", withdraw: "撤回" };

export function decisionFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "APPROVAL_SELF_REVIEW") return "发起人不能审核自己发起的改动，请让另一位有审核权限的同事处理。";
    if (err.code === "APPROVAL_NOT_PENDING") return "这条已经有结论了（可能刚被别人处理），刷新看看。";
    if (err.code === "APPROVAL_STALE") return "发起之后，要改的对象已经被别的改动改过了，不能照旧生效。请驳回，让发起人按现在的内容重新发起。";
    if (err.code === "CONTRACT_VALID_FROM_PASSED") return "这份合同的生效日期已经过了，批准会让结算条款追溯生效。请驳回，让发起人按新的生效日期重新发起。";
    if (err.code === "VALIDATION_FAILED") return `按现在的数据，这个改动不合规则了：${serverIssues(err).map((issue) => issue.message).join("；") || err.message}。请驳回。`;
    if (["MARKUP_RULE_CONFLICT", "RULES_BELOW_FLOOR", "CHANNEL_STATUS_UNCHANGED", "FX_RATE_UNAVAILABLE", "TENANT_STATE_INVALID", "TENANT_HAS_OPEN_ORDERS"].includes(err.code)) return `按现在的数据不能生效：${err.message}。请驳回。`;
    if (err.status === 403) return "你没有审核这一类改动的权限。";
  }
  return failureText(err, "提交");
}

/** 批准的确认框里「批准后会怎样」，按改动的类别写（M1-17：暂停渠道不是「按新的规则算」）。 */
const APPROVE_EFFECTS: Readonly<Record<ApprovalKind, string>> = {
  "channel.pricing": "批准后立即生效：之后的询价按新的定价参数算。这个渠道上其他还在等审核的改动会过时，只能驳回后重新发起。",
  "channel.pause": "批准后渠道立即暂停：它调用销售端接口（询价等）一律被拒绝。要恢复，到渠道详情点「启用」。",
  "markup_rule.create": "批准后立即生效：之后的询价按新加的这条规则算。",
  "markup_rule.update": "批准后立即生效：之后的询价按改过的这条规则算。",
  "markup_rule.delete": "批准后这条规则立即删除：之后的询价改按下一级的规则或默认加价比例算。",
  "fx_lock.create": "批准后立即生效：之后的报价就按新的汇率算，已经生成的报价快照不受影响。",
  "fx_lock.release": "批准后立即生效：之后的报价就按新的汇率算，已经生成的报价快照不受影响。",
  "tenant.suspend": "批准后供应商立即暂停：商品不参与比价、不能下单；已经接下的订单照常履约；它的账号仍然可以登录。要恢复，到供应商详情点「恢复」。",
  "tenant.terminate": "批准后供应商立即清退：后台只能查看历史，不能再修改任何东西，商品不再参与比价。清退不能撤销。",
  "tenant.contract": "批准后这一版合同写入；到了生效日期就是这家供应商现在的结算条款。",
  "cancellation_policy.update": "批准后立即生效：之后下的单按新的取消政策；已经下了的单仍按下单时的那一版。",
  "order.cancel_refund": "批准后这张单立即取消，按上面的金额退给客人（走 Stripe 退款）。",
  "rescue.manual_assign": "批准后这张单立即转给指定的供应商（按上面的结算价，不用它再接单），客人付的钱不变；差价记到原供应商的应扣款项。",
  "platform_role.update": "批准后立即生效：用这个角色的员工的权限、数据范围、IP 白名单马上按新的来，不用重新登录。",
  "staff.mfa_reset": "批准后他的两步验证立即清掉，已经登录着的也会退出；下次用密码登录时要重新绑定验证器。请先确认提出要求的就是他本人。",
  "statement.payout": "批准后这张账单进付款日的付款批次（合计为 0 记为无需付款，为负转入下一期）；请先核对账单明细和供应商的确认。",
};

/** 每条复核的按钮名字带上是哪一条（「批准：{摘要}（{发起时间} 发起）」），读屏在一页好几条里分得清（M1-17）。 */
function decisionLabel(decision: Decision, approval: Approval): string {
  return `${DECISION_NAMES[decision]}：${approvalSummaryText(approval.summary)}（${formatLocalDateTime(approval.requested_at)} 发起）`;
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
      <p>{approvalSummaryText(approval.summary)}</p>
      {isFxApproval(approval.kind) && (
        <p>
          币种：
          <Link className="link" to={FX_PATH}>
            {`${approval.resource_id} ${CURRENCY_NAMES[approval.resource_id as keyof typeof CURRENCY_NAMES] ?? ""}`.trim()}（去汇率页）
          </Link>
        </p>
      )}
      {approval.kind === "platform_role.update" && (
        <p>
          角色：
          <Link className="link" to={rolePath(approval.resource_id)}>
            {typeof approval.before?.["name"] === "string" ? approval.before["name"] : "查看角色"}
          </Link>
        </p>
      )}
      {approval.kind === "staff.mfa_reset" && (
        <p>
          员工：
          <Link className="link" to={staffPath(approval.resource_id)}>
            {typeof approval.payload["email"] === "string" ? approval.payload["email"] : "查看员工"}
          </Link>
        </p>
      )}
      {isTenantApproval(approval.kind) && (
        <p>
          供应商：
          <Link className="link" to={tenantPath(approval.resource_id)}>
            {typeof approval.payload["tenant_name"] === "string" ? approval.payload["tenant_name"] : "去供应商详情"}
          </Link>
        </p>
      )}
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
      <ApprovalImpact approval={approval} />
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
            <Button variant="primary" aria-label={decisionLabel("approve", approval)} onClick={() => onDecide(approval, "approve")}>
              批准
            </Button>
          )}
          {approval.can.reject && (
            <Button variant="secondary" className="button--danger-text" aria-label={decisionLabel("reject", approval)} onClick={() => onDecide(approval, "reject")}>
              驳回
            </Button>
          )}
          {approval.can.withdraw && (
            <Button aria-label={decisionLabel("withdraw", approval)} onClick={() => onDecide(approval, "withdraw")}>
              撤回
            </Button>
          )}
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
  const [problem, setProblem] = useState<ReactNode>(null);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="待审核">
      <Page title="待审核">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  /** 调高下限批不了：取一次渠道现在的规则，写出是哪几条挡住了；取不到就只写接口的原话 */
  const belowFloorProblem = async (err: ApiError, approval: Approval): Promise<ReactNode> => {
    const rules = await getChannel(token, approval.resource_id).then(
      (detail) => detail.markup_rules,
      () => null,
    );
    return <BelowFloorAlert message={`按现在的数据不能生效：${err.message}`} lines={rules === null ? [] : belowFloorRuleLines(err.details, rules)} then="请驳回；等这几条规则改到新的下限以上之后，让发起人重新发起。" />;
  };
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
      setProblem(err instanceof ApiError && err.code === "RULES_BELOW_FLOOR" ? await belowFloorProblem(err, deciding.approval) : decisionFailure(err));
    } finally {
      setBusy(false);
    }
  };

  const items = loaded.state.data?.items ?? [];
  return shell(
    <>
      <p className="page__lead">修改渠道的加价比例和加价规则、停用渠道、人工锁定或解锁汇率、修改角色、重置别人的两步验证，都要一个人发起、另一个人批准后才生效；发起人不能审核自己发起的。每一步都记在审计日志里。{`时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
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
        <StateBlock tone="neutral" title={status === "pending" ? "没有待审核的改动" : "还没有复核记录"} description="渠道经理发起修改加价、加价规则或暂停渠道，主数据运营发起锁定或解锁汇率后，会出现在这里。" />
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
          <div role="alert">{typeof problem === "string" ? <Alert kind="danger">{problem}</Alert> : problem}</div>
          <p>{approvalSummaryText(deciding.approval.summary)}</p>
          {deciding.decision === "approve" && <p>{APPROVE_EFFECTS[deciding.approval.kind]}</p>}
          <TextField label="说明（选填）" autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </Dialog>
      )}
    </>,
  );
}
