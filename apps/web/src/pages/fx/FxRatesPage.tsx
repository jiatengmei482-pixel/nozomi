/**
 * 运营后台「汇率」页（M2-03，ADR 0022）：数据源状态、当前汇率、常用币种互换、近 30 天走势、拉取记录；
 * 有 `fx.manage` 的角色（主数据运营、超级管理员）可以立即拉取、确认 / 放弃变动过大而挂起的一批。
 * 人工锁定（M2-06）：锁定状态、待审核的锁定 / 解锁申请、发起锁定 / 解锁、锁定记录（FxLockSection.tsx）；汇率表里锁定的值有标记，另列数据源的中央汇率。
 * 汇率是十进制字符串，页面四舍五入显示（完整值在悬停提示里，也可以切成「显示完整数值」——手机上没有悬停），不拿它算钱。
 */
import { useState } from "react";
import type { CurrencyCode } from "@nozomi/domain";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type FxFetch, type FxHistory, type FxLock, type FxOverview, decideFxFetch, fetchFxFetches, fetchFxHistory, fetchFxLocks, fetchFxNow, fetchFxOverview } from "../../api/fx.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, AlertSlot, type Notice } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock, Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { CURRENCY_NAMES, FX_DISPLAY_ORDER, FX_FETCH_BADGES, FX_STATE_BADGES, changeText, chartModel, fetchTriggerText, rateText } from "../../lib/fx-display.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { FxLockCard, FxLockHistory } from "./FxLockSection.tsx";

const CURRENCY_OPTIONS = FX_DISPLAY_ORDER.map((code) => ({ value: code, label: `${code} ${CURRENCY_NAMES[code]}` }));
const when = (iso: string | null): string => (iso === null ? "—" : formatLocalDateTime(iso));

/** 立即拉取之后给人看的一句话。 */
function fetchNotice(fetch: FxFetch): Notice {
  switch (fetch.status) {
    case "accepted":
      return { kind: "success", text: "汇率已更新" };
    case "unchanged":
      return { kind: "info", text: "数据源还没有更新，汇率不变" };
    case "held":
      return { kind: "warning", text: "这批汇率变动超过 3%，已挂起，确认后才生效" };
    default:
      return { kind: "danger", text: `没有拉到汇率：${fetch.error_detail ?? fetch.error_code ?? "原因不明"}。继续用最近一次的汇率` };
  }
}

function RateCell({ rate, full, locked = false }: { rate: string | null; full: boolean; locked?: boolean }) {
  return (
    <>
      <span title={rate ?? undefined}>{full ? (rate ?? "—") : rateText(rate)}</span>
      {locked && (
        <span className="fx-locked-mark">
          <span aria-hidden="true">*</span>
          <span className="visually-hidden">（用了人工锁定的汇率）</span>
        </span>
      )}
    </>
  );
}

/** 表格上方的一句「怎么显示的」+ 切换完整数值（两张表共用一个开关）。 */
function RoundingNote({ full, onToggle }: { full: boolean; onToggle(): void }) {
  return (
    <div className="fx-rounding">
      <p className="fx-hint fx-rounding__text">{full ? "现在显示的是完整数值（报价用的就是它）。" : "表里是四舍五入后的值：1 以上保留 4 位小数，不到 1 保留 6 位有效数字。"}</p>
      <Button size="sm" aria-pressed={full} onClick={onToggle}>
        {full ? "显示四舍五入后的" : "显示完整数值"}
      </Button>
    </div>
  );
}

export function FxRatesPage() {
  const { token, handleAuthFailure } = usePortalSession();
  useDocumentTitle("汇率 · NOZOMI 运营后台");
  const canManage = usePlatformCan("fx.manage");
  const [base, setBase] = useState<CurrencyCode>("USD");
  const [chartCurrency, setChartCurrency] = useState<CurrencyCode>("JPY");
  const [full, setFull] = useState(false);
  const overview = useLoad<FxOverview>(`fx-${base}`, (current) => fetchFxOverview(current, base));
  const history = useLoad<FxHistory>(`fx-history-${base}`, (current) => fetchFxHistory(current, base));
  const fetches = useLoad<{ items: FxFetch[] }>("fx-fetches", (current) => fetchFxFetches(current));
  const lockHistory = useLoad<{ items: FxLock[] }>("fx-locks", (current) => fetchFxLocks(current));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<"fetch" | "confirm" | "dismiss" | null>(null);
  const [deciding, setDeciding] = useState<"confirm" | "dismiss" | null>(null);

  const reloadAll = (): void => {
    overview.reload();
    history.reload();
    fetches.reload();
    lockHistory.reload();
  };
  const failed = (err: unknown): void => {
    if (handleAuthFailure(err)) return;
    if (err instanceof ApiError && err.code === "FX_FETCH_IN_PROGRESS") setNotice({ kind: "info", text: "正在拉取汇率（定时任务或其他同事），稍后刷新看结果" });
    else if (err instanceof ApiError && (err.code === "FX_FETCH_NOT_HELD" || err.code === "FX_HELD_OUTDATED")) setNotice({ kind: "warning", text: "这批汇率已经处理过，或已被更新的一批取代。页面已刷新" });
    else if (err instanceof ApiError && err.status === 403) setNotice({ kind: "danger", text: "当前角色没有这个操作的权限" });
    else setNotice({ kind: "danger", text: err instanceof NetworkError ? "网络连接失败，请重试" : "操作没有成功，请稍后重试" });
    reloadAll();
  };
  const fetchNow = async (): Promise<void> => {
    setBusy("fetch");
    setNotice(null);
    try {
      setNotice(fetchNotice((await fetchFxNow(token)).fetch));
      reloadAll();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(null);
    }
  };
  const decide = async (id: string, decision: "confirm" | "dismiss"): Promise<void> => {
    setBusy(decision);
    setNotice(null);
    try {
      await decideFxFetch(token, id, decision);
      setNotice(decision === "confirm" ? { kind: "success", text: "这批汇率已确认生效" } : { kind: "info", text: "已放弃这批汇率，继续用现在的汇率" });
      reloadAll();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(null);
      setDeciding(null);
    }
  };

  const data = overview.state.data;
  const held = data?.held ?? null;
  const chartOptions = CURRENCY_OPTIONS.filter((option) => option.value !== base);
  // 基准币种换成了正在看的币种：改看第一个
  const chartTarget = chartOptions.some((option) => option.value === chartCurrency) ? chartCurrency : (chartOptions[0]?.value ?? "JPY");
  const series = history.state.data?.series.find((item) => item.currency === chartTarget) ?? null;

  return (
    <AppShell pageName="汇率" trail={[{ label: "主数据" }]}>
      <Page
        title="汇率"
        action={
          canManage ? (
            <Button variant="primary" loading={busy === "fetch"} loadingText="正在拉取…" onClick={() => void fetchNow()}>
              立即拉取
            </Button>
          ) : undefined
        }
      >
        <AlertSlot notice={notice} />
        {data === null && overview.state.status === "loading" && (
          <section className="card">
            <Skeleton lines={["medium", "long", "long"]} />
          </section>
        )}
        {data === null && overview.state.status !== "loading" && (
          <section className="card">
            <StateBlock
              title={overview.state.status === "forbidden" ? "你没有权限查看这里" : "加载失败"}
              description={overview.state.status === "forbidden" ? "需要的话，请联系管理员开通。" : "请检查网络后重试。"}
              action={
                overview.state.status === "forbidden" ? undefined : (
                  <Button variant="secondary" onClick={reloadAll}>
                    重试
                  </Button>
                )
              }
            />
          </section>
        )}
        {data !== null && (
          <div className="fx-page">
            {data.state === "stale" && (
              <Alert kind="danger">
                <strong className="alert__title">汇率超过 {data.max_age_hours} 小时没有更新，跨币种报价已暂停</strong>
                <span>
                  现在这批是 {when(data.as_of)} 的。{canManage ? "请检查数据源，或点「立即拉取」。" : "请联系主数据运营处理。"}
                  {data.locks.length > 0 ? `人工锁定的币种（${data.locks.map((lock) => lock.currency).join("、")}）和美元之间照常报价。` : ""}
                </span>
              </Alert>
            )}
            {data.state === "none" && (
              <Alert kind="warning">
                <strong className="alert__title">还没有汇率：跨币种的报价都报不出</strong>
                <span>{data.source_status.auto_fetch ? "系统会按数据源的更新频率自动拉取。" : "定时拉取没有打开。"}{canManage ? "也可以点「立即拉取」。" : ""}</span>
              </Alert>
            )}
            {held !== null && (
              <section className="card fx-held" aria-labelledby="fx-held-title">
                <div className="card__header">
                  <h2 className="card__title" id="fx-held-title">
                    有一批汇率变动超过 {data.jump_threshold_bp / 100}%，等待确认
                  </h2>
                  <StatusBadge {...FX_FETCH_BADGES.held} />
                </div>
                <p className="fx-held__note">数据源 {when(held.source_as_of)} 的这批没有生效，报价还在用 {when(data.as_of)} 的汇率。请核对后确认或放弃。</p>
                <ul className="fx-held__jumps">
                  {(held.jumps ?? []).map((jump) => (
                    <li key={jump.currency}>
                      <span className="fx-held__currency">
                        {jump.currency} {CURRENCY_NAMES[jump.currency]}
                      </span>
                      <span>
                        1 USD = {rateText(jump.previous)} → {rateText(jump.next)}（{changeText(jump.change_bp)}）
                      </span>
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <div className="fx-held__actions">
                    <Button variant="primary" onClick={() => setDeciding("confirm")}>
                      确认生效
                    </Button>
                    <Button variant="secondary" onClick={() => setDeciding("dismiss")}>
                      放弃这批
                    </Button>
                  </div>
                )}
                <Dialog
                  open={deciding !== null}
                  title={deciding === "confirm" ? "确认这批汇率生效？" : "放弃这批汇率？"}
                  busy={busy === "confirm" || busy === "dismiss"}
                  onClose={() => setDeciding(null)}
                  footer={
                    <>
                      <Button variant="secondary" data-autofocus onClick={() => setDeciding(null)}>
                        取消
                      </Button>
                      <Button variant="primary" loading={busy === deciding} loadingText="正在提交…" onClick={() => void decide(held.id, deciding ?? "dismiss")}>
                        {deciding === "confirm" ? "确认生效" : "放弃"}
                      </Button>
                    </>
                  }
                >
                  <p>{deciding === "confirm" ? "确认后立即用于新的报价；已经生成的报价快照不受影响。" : "放弃后继续用现在的汇率；它照常会在没有更新 48 小时后过期。"}</p>
                </Dialog>
              </section>
            )}

            <FxLockCard
              data={data}
              canManage={canManage}
              onSubmitted={(next) => {
                setNotice(next);
                reloadAll();
              }}
            />

            <section className="card" aria-labelledby="fx-source-title">
              <div className="card__header">
                <h2 className="card__title" id="fx-source-title">
                  数据源
                </h2>
                <StatusBadge {...FX_STATE_BADGES[data.state]} />
              </div>
              <dl className="details">
                <div className="details__item">
                  <dt>这批汇率的时间</dt>
                  <dd>{when(data.as_of)}</dd>
                </div>
                <div className="details__item">
                  <dt>拉到的时间</dt>
                  <dd>{when(data.fetched_at)}</dd>
                </div>
                <div className="details__item">
                  <dt>过期时间（之后暂停跨币种报价）</dt>
                  <dd>{when(data.stale_at)}</dd>
                </div>
                <div className="details__item">
                  <dt>数据源</dt>
                  <dd className="fx-mono">{data.source_status.host}</dd>
                </div>
                <div className="details__item">
                  <dt>最近一次拉取</dt>
                  <dd>
                    {data.source_status.last_attempt === null ? (
                      "还没有拉过"
                    ) : (
                      <span className="fx-attempt">
                        <span>{when(data.source_status.last_attempt.started_at)}</span>
                        <StatusBadge {...FX_FETCH_BADGES[data.source_status.last_attempt.status]} />
                        {data.source_status.last_attempt.error_detail !== null && <span className="fx-attempt__detail">{data.source_status.last_attempt.error_detail}</span>}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="details__item">
                  <dt>下次自动拉取</dt>
                  <dd>{data.source_status.auto_fetch ? when(data.source_status.next_fetch_at) : "没有打开定时拉取"}</dd>
                </div>
              </dl>
            </section>

            <section className="card" aria-labelledby="fx-rates-title">
              <div className="card__header">
                <h2 className="card__title" id="fx-rates-title">
                  当前汇率
                </h2>
                <SelectField label="基准币种" inline value={base} options={CURRENCY_OPTIONS} onChange={(value) => setBase(value)} />
              </div>
              <RoundingNote full={full} onToggle={() => setFull(!full)} />
              {data.locks.length > 0 && <p className="fx-hint">标 * 的是人工锁定的值，报价用的就是它；右边一列是数据源的中央汇率（照常更新，锁定期间不用于这个币种）。</p>}
              <div className="table-wrap">
                <div className="table-scroll" tabIndex={0} role="region" aria-label="当前汇率表">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">币种</th>
                        <th scope="col" className="table__cell--end">
                          1 {base} =
                        </th>
                        {data.locks.length > 0 && (
                          <th scope="col" className="table__cell--end">
                            数据源（中央汇率）
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {FX_DISPLAY_ORDER.filter((code) => code !== base).map((code) => {
                        const item = data.rates.find((entry) => entry.currency === code);
                        return (
                          <tr key={code}>
                            <th scope="row">
                              {code} {CURRENCY_NAMES[code]}
                            </th>
                            <td className="table__cell--end fx-mono">
                              <RateCell full={full} rate={item?.rate ?? null} locked={item?.locked ?? false} />
                            </td>
                            {data.locks.length > 0 && (
                              <td className="table__cell--end fx-mono">
                                <RateCell full={full} rate={item?.central_rate ?? null} />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="card" aria-labelledby="fx-cross-title">
              <h2 className="card__title" id="fx-cross-title">
                常用币种互换
              </h2>
              <p className="fx-hint">
                每行是「1 个该行币种 = 多少个该列币种」。这里是报价用的汇率{data.locks.length > 0 ? "（标 * 的用到了人工锁定的值）" : "（中央汇率）"}，不含缓冲；报价时跨币种另加汇率缓冲（比例见「系统状态」里的汇率数据源）。
              </p>
              <RoundingNote full={full} onToggle={() => setFull(!full)} />
              <div className="table-wrap">
                <div className="table-scroll" tabIndex={0} role="region" aria-label="币种互换表">
                  <table className="table fx-matrix">
                    <thead>
                      <tr>
                        <th scope="col">1 个</th>
                        {FX_DISPLAY_ORDER.map((code) => (
                          <th key={code} scope="col" className="table__cell--end">
                            {code}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {FX_DISPLAY_ORDER.map((from) => (
                        <tr key={from}>
                          <th scope="row">{from}</th>
                          {FX_DISPLAY_ORDER.map((to) => (
                            <td key={to} className="table__cell--end fx-mono">
                              {from === to ? "1" : <RateCell full={full} rate={data.cross.find((item) => item.from === from && item.to === to)?.rate ?? null} locked={data.cross.find((item) => item.from === from && item.to === to)?.locked ?? false} />}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="card" aria-labelledby="fx-chart-title">
              <div className="card__header">
                <h2 className="card__title" id="fx-chart-title">
                  近 30 天走势
                </h2>
                <SelectField label="币种" inline value={chartTarget} options={chartOptions} onChange={(value) => setChartCurrency(value)} />
              </div>
              <FxChart base={base} currency={chartTarget} points={series?.points ?? []} state={history.state.status} onRetry={history.reload} />
            </section>

            <section className="card" aria-labelledby="fx-log-title">
              <h2 className="card__title" id="fx-log-title">
                最近的拉取记录
              </h2>
              <DataTable
                label="拉取记录表"
                columns={FETCH_COLUMNS}
                rows={fetches.state.data?.items ?? []}
                rowKey={(row) => row.id}
                state={fetches.state.status === "ready" ? "ready" : fetches.state.status === "forbidden" ? "forbidden" : fetches.state.status === "loading" ? "loading" : "error"}
                refreshing={fetches.state.status === "loading" && fetches.state.data !== null}
                onRetry={fetches.reload}
                empty={<StateBlock tone="neutral" title="还没有拉过汇率" />}
              />
            </section>

            <section className="card" aria-labelledby="fx-lock-log-title">
              <h2 className="card__title" id="fx-lock-log-title">
                锁定记录
              </h2>
              <FxLockHistory
                items={lockHistory.state.data?.items ?? []}
                state={lockHistory.state.status === "ready" ? "ready" : lockHistory.state.status === "forbidden" ? "forbidden" : lockHistory.state.status === "loading" ? "loading" : "error"}
                onRetry={lockHistory.reload}
              />
            </section>
          </div>
        )}
      </Page>
    </AppShell>
  );
}

const FETCH_COLUMNS: readonly Column<FxFetch>[] = [
  { key: "started", header: "时间", cell: (row) => when(row.started_at) },
  { key: "trigger", header: "方式", cell: (row) => fetchTriggerText(row) },
  { key: "status", header: "结果", cell: (row) => <StatusBadge {...FX_FETCH_BADGES[row.status]} /> },
  { key: "as_of", header: "数据源的时间", cell: (row) => when(row.source_as_of) },
  { key: "detail", header: "说明", wrap: true, cell: (row) => row.error_detail ?? (row.decided_by ? `${row.status === "confirmed" ? "确认" : "放弃"}：${row.decided_by.name}` : "—") },
];

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;

/** 近 30 天的曲线（简单 SVG，不引图表库）。读屏读到的是一句概述：最低、最高、最新。 */
function FxChart({ base, currency, points, state, onRetry }: { base: CurrencyCode; currency: CurrencyCode; points: readonly { as_of: string; rate: string }[]; state: string; onRetry(): void }) {
  if (points.length === 0 && state === "loading") return <Skeleton lines={["long", "long"]} />;
  if (points.length === 0 && state === "error")
    return (
      <StateBlock
        title="走势没有加载出来"
        action={
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        }
      />
    );
  const model = chartModel(points, CHART_WIDTH, CHART_HEIGHT, 12);
  if (model === null) return <StateBlock tone="neutral" title="近 30 天还没有汇率" />;
  const latest = points[points.length - 1]?.rate ?? null;
  const summary = `近 30 天 1 ${base} 兑 ${CURRENCY_NAMES[currency]}：最低 ${rateText(model.min)}，最高 ${rateText(model.max)}，最新 ${rateText(latest)}（${points.length} 个点）`;
  return (
    <figure className="fx-chart">
      <svg className="fx-chart__svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={summary} preserveAspectRatio="none">
        <line className="fx-chart__axis" x1="0" y1={CHART_HEIGHT - 1} x2={CHART_WIDTH} y2={CHART_HEIGHT - 1} />
        <polyline className="fx-chart__line" points={model.points.map((point) => `${point.x},${point.y}`).join(" ")} />
        {model.points.map((point, index) => (
          <circle key={index} className="fx-chart__dot" cx={point.x} cy={point.y} r="3" />
        ))}
      </svg>
      <figcaption className="fx-chart__caption">
        <span>
          {when(model.first)} — {when(model.last)}
        </span>
        <span className="fx-mono">
          最低 {rateText(model.min)} · 最高 {rateText(model.max)} · 最新 {rateText(latest)}
        </span>
      </figcaption>
    </figure>
  );
}
