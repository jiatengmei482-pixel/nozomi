/**
 * 加价规则 / 定价参数生效前的「近 30 天毛利试算」（M3-07，ADR 0033）。
 * - `PricingImpactView`：一份试算结果（付过款的订单、询价各一张表：改前 / 改后 / 差额，以及中标换人、要按最低毛利补价、改后报不出的个数）。
 * - `ImpactPreview`：发起修改的对话框里用——按现在填的内容试算；内容改了以后旧的结果作废，要重新算。
 * - `ApprovalImpact`：待审核里用——发起时存下的结果，和「按现在的数据再算一次」。
 * 结果是估算：客人面对新价格还会不会下单无法知道，界面上写明。
 */
import { useEffect, useRef, useState } from "react";
import { type Approval, type PricingImpact, type PricingImpactRequest, type PricingImpactSection, previewPricingImpact, recomputeApprovalImpact } from "../../api/channels.ts";
import { ApiError } from "../../api/client.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { moneyText } from "../../lib/product-display.ts";
import { serverIssues } from "../../lib/product-failure.ts";

export const IMPACT_ESTIMATE_NOTE = "这是估算：假定近 30 天的询价和订单照旧发生、按新价格重新比价；客人面对新的价格还会不会下单，无法知道。金额按报价时的汇率换成渠道结算币种。";

/** 有正负号的金额：「+JPY 1,100」「−JPY 100」「JPY 0」。 */
export function signedMoney(minor: number, currency: string): string {
  if (minor === 0) return moneyText(0, currency);
  return `${minor > 0 ? "+" : "−"}${moneyText(Math.abs(minor), currency)}`;
}

function impactFailure(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_FAILED") {
      const issues = serverIssues(err);
      return `没法试算：${issues.length > 0 ? issues.map((issue) => issue.message).join("；") : "填的内容不符合要求"}。`;
    }
    if (err.code === "MARKUP_RULE_CONFLICT") return "没法试算：同一组维度上已经有一条规则（不带日期的只能有一条，带日期的日期范围不能重叠）。";
    if (err.code === "RULES_BELOW_FLOOR" || err.code === "APPROVAL_STALE" || err.code === "APPROVAL_NOT_PENDING") return `没法试算：${err.message}。`;
    if (err.status === 403) return "你没有权限做毛利试算。";
  }
  return failureText(err, "试算");
}

function SectionTable({ title, unit, section, currency }: { title: string; unit: string; section: PricingImpactSection; currency: string }) {
  const rows: [string, keyof PricingImpactSection["before"]][] = [
    ["对外价合计（客人付）", "sell_minor"],
    ["结算价合计（付给供应商）", "settlement_minor"],
    ["毛利", "margin_minor"],
  ];
  return (
    <div className="table-wrap">
      <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
        <table className="table">
          <caption className="impact__caption">{`${title}：${section.count} ${unit}${section.truncated ? `（共 ${section.total} ${unit}，只算了最近的这些）` : ""}`}</caption>
          <thead>
            <tr>
              <th scope="col">项目</th>
              <th scope="col">改前</th>
              <th scope="col">改后</th>
              <th scope="col">差额</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{moneyText(section.before[key], currency)}</td>
                <td>{moneyText(section.after[key], currency)}</td>
                <td>
                  <strong>{signedMoney(section.diff[key], currency)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sectionFacts(section: PricingImpactSection, unit: string): string[] {
  return [
    `中标会换人：${section.winner_changed} ${unit}`,
    `要按最低毛利补价：改前 ${section.min_margin_raised_before} ${unit}，改后 ${section.min_margin_raised_after} ${unit}`,
    ...(section.became_unquotable > 0 ? [`改后报不出价：${section.became_unquotable} ${unit}`] : []),
    ...(section.became_quotable > 0 ? [`改后能报出价（改前报不出）：${section.became_quotable} ${unit}`] : []),
    ...(section.skipped > 0 ? [`缺报价时的汇率、没法重算（没计入）：${section.skipped} ${unit}`] : []),
  ];
}

/** 一份试算结果。 */
export function PricingImpactView({ impact, title }: { impact: PricingImpact; title: string }) {
  const currency = impact.settle_currency;
  const { orders, quotes } = impact;
  return (
    <section className="impact" aria-label={title}>
      <h3 className="impact__title">{title}</h3>
      <p className="field__hint">{`${formatLocalDateTime(impact.from)} 至 ${formatLocalDateTime(impact.to)}（近 ${impact.window_days} 天），${formatLocalDateTime(impact.computed_at)} 算的。改前按现在生效的规则重算，改后按这次的改动重算，都重新比价选中标。`}</p>
      <SectionTable title="付过款的订单" unit="单" section={orders} currency={currency} />
      <ul className="impact__facts">
        {[...sectionFacts(orders, "单"), ...(orders.cancelled_with_fee > 0 ? [`其中付款后有偿取消、按扣款比例计入：${orders.cancelled_with_fee} 单`] : []), ...(orders.cancelled_free > 0 ? [`免费取消（毛利为 0，没计入）：${orders.cancelled_free} 单`] : [])].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <SectionTable title="询价（每个车型组一个报价）" unit="个" section={quotes} currency={currency} />
      <ul className="impact__facts">
        {sectionFacts(quotes, "个").map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="field__hint">{IMPACT_ESTIMATE_NOTE}</p>
    </section>
  );
}

/**
 * 发起修改的对话框里的试算。`request` 是按现在填的内容组出来的改动（填得不对时为 null，按钮不可用）。
 * 算过之后内容又改了：旧结果作废（不显示过时的数），提示重新试算。`auto`：打开就算一次（删除规则没有要填的内容）。
 */
export function ImpactPreview({ channelId, request, auto = false }: { channelId: string; request: PricingImpactRequest | null; auto?: boolean }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [result, setResult] = useState<{ key: string; impact: PricingImpact } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = request === null ? null : JSON.stringify(request);
  const run = async (): Promise<void> => {
    if (request === null || key === null || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { impact } = await previewPricingImpact(token, channelId, request);
      setResult({ key, impact });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setResult(null);
      setProblem(impactFailure(err));
    } finally {
      setBusy(false);
    }
  };
  // 打开就算一次（只在第一次渲染之后；React 严格模式下重复执行的副作用由 started 挡住）
  const started = useRef(false);
  useEffect(() => {
    if (auto && !started.current) {
      started.current = true;
      void run();
    }
  }, []);
  const fresh = result !== null && result.key === key;
  return (
    <div className="impact-preview">
      <div className="impact-preview__bar">
        <Button size="sm" disabled={request === null} loading={busy} loadingText="试算中…" onClick={() => void run()}>
          {result === null ? "试算近 30 天毛利影响" : "重新试算"}
        </Button>
        {request === null && <span className="table__muted">先把内容填完整再试算。</span>}
        {result !== null && !fresh && <span className="table__muted">内容改过了，上次的结果不再适用，请重新试算。</span>}
      </div>
      <div role="status">{problem !== null && <Alert kind="warning">{problem}</Alert>}</div>
      {fresh && <PricingImpactView impact={result.impact} title="近 30 天毛利试算" />}
    </div>
  );
}

const IMPACT_KINDS = new Set(["channel.pricing", "markup_rule.create", "markup_rule.update", "markup_rule.delete"]);

/** 待审核里：发起时存下的试算，以及「按现在的数据再算一次」（只读，不改存下的那一份）。 */
export function ApprovalImpact({ approval }: { approval: Approval }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [current, setCurrent] = useState<PricingImpact | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!IMPACT_KINDS.has(approval.kind)) return null;
  const canRecompute = approval.status === "pending" && (approval.can.approve || approval.can.reject || approval.can.withdraw);
  const recompute = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      setCurrent((await recomputeApprovalImpact(token, approval.id)).impact);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(impactFailure(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="impact-preview">
      {approval.impact === null ? <p className="table__muted">这条复核发起时没有保存毛利试算（M3-07 之前发起的）。</p> : <PricingImpactView impact={approval.impact} title="发起时的毛利试算（近 30 天）" />}
      {canRecompute && (
        <div className="impact-preview__bar">
          <Button size="sm" loading={busy} loadingText="试算中…" aria-label={`按现在的数据再算一次：${approval.summary}`} onClick={() => void recompute()}>
            按现在的数据再算一次
          </Button>
        </div>
      )}
      <div role="status">{problem !== null && <Alert kind="warning">{problem}</Alert>}</div>
      {current !== null && <PricingImpactView impact={current} title="按现在的数据再算的结果" />}
    </div>
  );
}
