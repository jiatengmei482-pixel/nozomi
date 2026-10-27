/**
 * 报价试算（docs/design/pages/platform-products.md 第 5 节，ADR 0020「两个试算接口」）：
 * 运营人员填一次用车请求，看所有供应商一起比价的结果——每个车型组谁中标、全部候选的结算价 / 对外价 / 加价比例 / 排序价、
 * 每个报不出价的商品和原因。只读：不生成可以下单的报价。
 */
import { CURRENCIES, PRODUCT_CATEGORY_NAMES, SERVICE_CATEGORIES, type ServiceCategory } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Channel, listAllChannels } from "../../api/channels.ts";
import { ApiError } from "../../api/client.ts";
import { type Place, type VehicleGroup, listAllMaster } from "../../api/master.ts";
import { type PlatformQuotePreview, type QuoteCandidate, type QuoteGroup, type QuoteSettlement, listQuotePlaces, previewPlatformQuote } from "../../api/quotes.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Attributions, placeSources } from "../../components/Attribution.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { CoordinateInput, FieldErrors, RadioGroup } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { basisPointsText, stepText } from "../../lib/adjust-form.ts";
import { kmText } from "../../lib/distance.ts";
import { displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { exactTextMoney, isWholeText } from "../../lib/price-calendar.ts";
import { CURRENCY_NAMES, moneyText } from "../../lib/product-display.ts";
import { saveFailureText, serverIssues } from "../../lib/product-failure.ts";
import { platformProductListPath } from "../../lib/platform-paths.ts";
import { ROUTE_SOURCE_TEXT, routeFailureText } from "../../lib/route-display.ts";
import { type QuoteField, type QuoteForm, emptyQuoteForm, fieldOfPath, pointsNeeded, readQuoteForm } from "../../lib/quote-form.ts";
import { tidyDate, tidyTime } from "../../lib/time-input.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useCityOptions } from "../../lib/use-city-options.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
/** 页面上从上到下的顺序：提交有错时焦点落在第一处。 */
const FIELD_ORDER: readonly QuoteField[] = ["city", "category", "place", "direction", "pickup.lat", "pickup.lng", "dropoff.lat", "dropoff.lng", "packageHours", "date", "time", "passengers", "luggage", "currency", "routeKm", "routeMinutes"];
const FIELD_IDS: Readonly<Record<QuoteField, string>> = {
  city: "quote-city",
  category: "quote-category",
  place: "quote-place",
  direction: "quote-direction",
  "pickup.lat": "quote-pickup",
  "pickup.lng": "quote-pickup",
  "dropoff.lat": "quote-dropoff",
  "dropoff.lng": "quote-dropoff",
  packageHours: "quote-package",
  date: "quote-time",
  time: "quote-time",
  passengers: "quote-passengers",
  luggage: "quote-luggage",
  currency: "quote-currency",
  routeKm: "quote-route",
  routeMinutes: "quote-route",
};
const FIELD_NAMES: Readonly<Record<QuoteField, string>> = {
  city: "城市",
  category: "品类",
  place: "机场或车站",
  direction: "方向",
  "pickup.lat": "上车点",
  "pickup.lng": "上车点",
  "dropoff.lat": "下车点",
  "dropoff.lng": "下车点",
  packageHours: "套餐时长",
  date: "用车时间",
  time: "用车时间",
  passengers: "人数",
  luggage: "行李数",
  currency: "客人支付的币种",
  routeKm: "假定的里程和时长",
  routeMinutes: "假定的里程和时长",
};
const CURRENCY_CHOICES = Object.keys(CURRENCIES).map((code) => ({ value: code, label: `${code} ${CURRENCY_NAMES[code] ?? ""}`.trim() }));

function focusField(field: QuoteField): void {
  const node = document.getElementById(FIELD_IDS[field]);
  const target = node?.matches("input, select") ? node : node?.querySelector<HTMLElement>("input, select");
  (target ?? node)?.scrollIntoView?.({ block: "center" });
  (target ?? node)?.focus();
}

const durationText = (minutes: number): string => (minutes < 60 ? `${minutes} 分钟` : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`);

// ───────────── 结果 ─────────────

/** 一个候选的结算价是怎么来的。 */
function SettlementDetail({ candidate, currency }: { candidate: QuoteCandidate; currency: string }) {
  const settlement: QuoteSettlement = candidate.offer.settlement;
  const own = settlement.currency;
  const lines: { label: string; value: ReactNode }[] = [{ label: "基础价", value: moneyText(settlement.base, own) }];
  if (settlement.adjusts.length > 0 || settlement.adjust !== 0) {
    lines.push({
      label: "调价",
      value: (
        <span className="quote-detail__lines">
          {settlement.adjusts.map((rule) => (
            <span key={rule.rule_id}>{`「${rule.name}」${rule.steps.map((step, index) => `${index === 0 ? "" : "，再"}${stepText(step, own)}（${exactTextMoney(step.delta, own, true)}）`).join("")}`}</span>
          ))}
          <span>{`合计 ${settlement.adjust >= 0 ? "+" : "−"}${moneyText(Math.abs(settlement.adjust), own)}（含取整的尾差）`}</span>
        </span>
      ),
    });
  }
  if (settlement.urgent !== 0 || settlement.urgent_tier !== null) lines.push({ label: "加急费", value: `${moneyText(settlement.urgent, own)}${settlement.urgent_tier ? `（离用车不足 ${settlement.urgent_tier.within_hours} 小时）` : ""}` });
  if (settlement.night !== 0 || settlement.night_detail !== null) {
    const detail = settlement.night_detail;
    lines.push({ label: "夜间费", value: `${moneyText(settlement.night, own)}${detail === null ? "" : detail.charge_unit === "per_order" ? "（按次）" : `（按小时，和夜间时段重叠 ${detail.overlap_minutes ?? 0} 分钟）`}` });
  }
  if (settlement.addons !== 0 || settlement.addon_items.length > 0) lines.push({ label: "附加服务", value: `${moneyText(settlement.addons, own)}（${settlement.addon_items.length} 项）` });
  if (settlement.driver_language !== 0 || settlement.driver_language_code !== null) lines.push({ label: "司机语言", value: moneyText(settlement.driver_language, own) });
  lines.push({ label: "取整前", value: `${exactTextMoney(settlement.exact.total, own)}${isWholeText(settlement.exact.total) ? "" : "（还没取整）"}` });
  lines.push({ label: "取整", value: settlement.rounding_unit > 1 ? `取整到 ${moneyText(settlement.rounding_unit, own)}` : "四舍五入" });
  lines.push({ label: "结算价", value: <strong>{moneyText(settlement.total, own)}</strong> });
  if (settlement.usage) lines.push({ label: "按多少路程算", value: `${kmText(settlement.usage.meters)} 公里、${durationText(settlement.usage.minutes)}` });
  const fx = candidate.fx;
  const lockText = fx?.lock ? `；用了人工锁定的汇率：${fx.lock.legs.map((leg) => `1 USD = ${leg.rate} ${leg.currency}（锁定到 ${formatLocalDateTime(leg.expires_at)}）`).join("，")}` : "";
  lines.push({ label: "换算成客人支付的币种", value: fx === null ? `同币种（${own}），不用换算` : `1 ${fx.from} = ${fx.rate} ${fx.to}（汇率时间 ${formatLocalDateTime(fx.as_of)}${lockText}），汇率缓冲 ${basisPointsText(candidate.fx_buffer_bp)}%` });
  lines.push({ label: "对外价", value: `${moneyText(candidate.sell, currency)}（结算价${candidate.fx === null ? "" : "换算后"}加 ${basisPointsText(candidate.markup_bp)}%${candidate.min_margin_applied ? "，加价不足渠道的最低毛利、补到了最低毛利" : ""}，取整前 ${exactTextMoney(candidate.sell_exact, currency)}）` });
  const wait = settlement.free_wait;
  lines.push({ label: "免费等待", value: wait.mode === "unlimited" ? "不限时" : wait.mode === "limited" ? `${wait.minutes ?? 0} 分钟（平台规定最少 ${wait.platform_minimum_minutes} 分钟）` : "没有设" });
  return (
    <dl className="quote-detail">
      {lines.map((line) => (
        <div key={line.label} className="quote-detail__item">
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CandidateRows({ candidate, currency, showLevel }: { candidate: QuoteCandidate; currency: string; showLevel: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = `quote-detail-${candidate.product_id}-${candidate.offer.vehicle_group_id}-${candidate.offer.package_hours ?? 0}`;
  const who = candidate.tenant_name ?? "（供应商名称没有取到）";
  return (
    <>
      <tr className={candidate.position === 1 ? "quote-table__winner" : undefined}>
        <td className="table__cell--end">
          {candidate.position === 1 ? (
            <span className="table__inline">
              1<StatusBadge tone="success" label="中标" />
            </span>
          ) : (
            candidate.position
          )}
        </td>
        <th scope="row" className="table__cell--wrap">
          <span className="table__names">
            <span>{who}</span>
            <span className="product-code">{candidate.product_code ?? "—"}</span>
            {candidate.observation && <span className="tag">观察期（排序价按对外价加 5%）</span>}
          </span>
        </th>
        <td className="table__cell--end">{moneyText(candidate.offer.settlement.total, candidate.offer.settlement.currency)}</td>
        <td className="table__cell--end">{moneyText(candidate.sell, currency)}</td>
        <td className="table__cell--end">{`${basisPointsText(candidate.markup_bp)}%`}</td>
        {showLevel && <td>{candidate.markup_level === null ? "—" : `第 ${candidate.markup_level} 级${candidate.markup_rule_id === null ? "（默认）" : ""}`}</td>}
        <td className="table__cell--end">{exactTextMoney(candidate.rank_price, currency)}</td>
        <td>{candidate.in_band ? "在" : "不在"}</td>
        <td>
          <Button variant="text" size="sm" aria-expanded={open} aria-controls={detailId} aria-label={`${open ? "收起" : "看"} ${who} 的结算价明细`} onClick={() => setOpen(!open)}>
            {open ? "收起明细" : "看明细"}
          </Button>
        </td>
      </tr>
      <tr id={detailId} className="quote-table__detail" hidden={!open}>
        <td colSpan={showLevel ? 9 : 8}>{open && <SettlementDetail candidate={candidate} currency={currency} />}</td>
      </tr>
    </>
  );
}

function GroupCard({ group, groupName, currency, bandBp, showLevel }: { group: QuoteGroup; groupName: string; currency: string; bandBp: number; showLevel: boolean }) {
  const title = `${groupName}${group.package_hours !== null ? ` · ${group.package_hours} 小时套餐` : ""}`;
  const headingId = `quote-group-${group.vehicle_group_id}-${group.package_hours ?? 0}`;
  return (
    <section className="card quote-group" aria-labelledby={headingId}>
      <h3 className="card__title" id={headingId}>
        {title}
      </h3>
      <p className="quote-group__winner">
        <Icon name="check-circle" />
        <span>
          中标：<strong>{group.winner.tenant_name ?? "（供应商名称没有取到）"}</strong>
          {group.winner.product_code ? `（${group.winner.product_code}）` : ""} · 对外价 <strong>{moneyText(group.winner.sell, currency)}</strong> · 结算价 {moneyText(group.winner.settlement, group.winner.settlement_currency)}
        </span>
      </p>
      <div className="table-wrap">
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title} 的全部候选`}>
          <table className="table quote-table">
            <thead>
              <tr>
                <th scope="col" className="table__cell--end">
                  名次
                </th>
                <th scope="col">供应商 / 商品</th>
                <th scope="col" className="table__cell--end">
                  结算价
                </th>
                <th scope="col" className="table__cell--end">{`对外价（${currency}）`}</th>
                <th scope="col" className="table__cell--end">
                  加价比例
                </th>
                {showLevel && <th scope="col">命中的加价规则</th>}
                <th scope="col" className="table__cell--end">
                  排序价
                </th>
                <th scope="col">在同价区间</th>
                <th scope="col">明细</th>
              </tr>
            </thead>
            <tbody>
              {group.candidates.map((candidate) => (
                <CandidateRows key={`${candidate.product_id}-${candidate.position}`} candidate={candidate} currency={currency} showLevel={showLevel} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="field__hint">{`排序价不超过最低排序价 ${basisPointsText(bandBp)}% 的都在同价区间里；区间里评分高的中标，评分一样看已完成订单数，再一样看排序价。客人付的是中标者自己的对外价。`}</p>
    </section>
  );
}

/** 概况里「用的路程」一句：后面写明路程从哪里来（缓存、刚查谷歌地图、起终点重合、你填的假定值）。 */
function routeSentence(result: PlatformQuotePreview): string {
  if (result.route === null) return "";
  const { status, source } = result.route_status;
  const from = status === "assumed" ? "你填写的假定值" : source !== null ? ROUTE_SOURCE_TEXT[source] : null;
  return ` 用的路程：${kmText(result.route.meters)} 公里、${durationText(result.route.minutes)}${from === null ? "" : `（${from}）`}。`;
}

/** 没取到路线（M2-02）：按「里程 + 时长」计价的商品报不出价，原因码和怎么办都写出来；一口价、包车照常。 */
function RouteUnavailable({ code, message }: { code: string | null; message: string | null }) {
  const reason = code === null ? (message ?? "谷歌地图没有给出路线。请稍后再试。") : routeFailureText(code, message);
  return (
    <Alert kind="warning">
      <strong className="alert__title">这次没有取到路线，按「里程 + 时长」计价的商品报不出价。</strong>
      <span>
        {code !== null && (
          <>
            {"原因码 "}
            <span className="route-code">{code}</span>
            {"："}
          </>
        )}
        {`${reason}一口价和包车套餐不受影响。想看这些商品的价格，可以在上面「假定的里程和时长」里填一组数再试算。`}
      </span>
    </Alert>
  );
}

function QuoteResult({ result, groupNames, form, cityName }: { result: PlatformQuotePreview; groupNames: ReadonlyMap<string, string>; form: QuoteForm; cityName: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [result]);
  const groupName = (id: string | null): string => (id === null ? "整个商品" : (groupNames.get(id) ?? "车型组（名称没有加载出来）"));
  const refusedProducts = new Set(result.refused.map((entry) => entry.product_id)).size;
  const listLink = platformProductListPath({ ...(form.cityId ? { city: form.cityId } : {}), ...(form.category ? { category: form.category } : {}), status: "published" });
  return (
    <section className="quote-result" aria-labelledby="quote-result-title">
      <h2 className="quote-result__title" id="quote-result-title" ref={heading} tabIndex={-1}>
        试算结果
      </h2>
      {result.candidate_count === 0 ? (
        <section className="card">
          <StateBlock
            tone="neutral"
            title="没有可以比价的商品"
            description={`「${cityName}」的${form.category ? PRODUCT_CATEGORY_NAMES[form.category] : ""}${form.category === "airport_transfer" ? "（这个接送点）" : ""}还没有已上架的商品。`}
            action={
              <Link className="link" to={listLink}>
                去商品列表看看
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <p className="quote-result__summary">
            {`找到 ${result.candidate_count} 个已上架的商品，${result.groups.length} 个车型组报出了价。${refusedProducts > 0 ? `${refusedProducts} 个商品有没报出价的，原因见最下面。` : ""}`}
            {routeSentence(result)}
            {` 加价比例不低于 ${basisPointsText(result.markup_floor_bp)}%。`}
          </p>
          <p className="quote-result__summary">
            {result.channel === null
              ? "按平台默认参数试算（没有选渠道）：默认加价比例、10% 下限、3% 价格带，没有最低毛利和对外价取整。"
              : `按渠道「${result.channel.name}」的规则试算：加价比例按它的加价规则匹配，价格带 ${basisPointsText(result.band_bp)}%${result.channel.min_margin > 0 ? `，最低毛利 ${moneyText(result.channel.min_margin, result.channel.settle_currency)}` : ""}${result.channel.rounding_unit > 1 ? `，对外价向上取整到 ${moneyText(result.channel.rounding_unit, result.currency)}` : ""}。`}
            {result.excluded.length > 0 ? ` 渠道不卖的 ${result.excluded.length} 个商品没参加比价（见最下面）。` : ""}
          </p>
          {result.route_status.status === "unavailable" && <RouteUnavailable code={result.route_status.code} message={result.route_status.message} />}
          {result.groups.length === 0 && (
            <Alert kind="warning">
              <strong className="alert__title">一个车型组都没有报出价。</strong>
              <span>原因见下面「没报出价的」。</span>
            </Alert>
          )}
          {result.groups.map((group) => (
            <GroupCard key={`${group.vehicle_group_id}-${group.package_hours ?? 0}`} group={group} groupName={groupName(group.vehicle_group_id)} currency={result.currency} bandBp={result.band_bp} showLevel={result.channel !== null} />
          ))}
        </>
      )}
      {result.excluded.length > 0 && (
        <section className="card" aria-labelledby="quote-excluded-title">
          <h3 className="card__title" id="quote-excluded-title">{`渠道不卖的（${result.excluded.length}）`}</h3>
          <ul className="channel-approvals">
            {result.excluded.map((entry) => (
              <li key={entry.product_id}>
                <span>{entry.tenant_name ?? "（供应商名称没有取到）"}</span>
                <span className="product-code">{entry.product_code ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.refused.length > 0 && (
        <section className="card" aria-labelledby="quote-refused-title">
          <h3 className="card__title" id="quote-refused-title">{`没报出价的（${result.refused.length}）`}</h3>
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="没报出价的商品和原因">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">供应商 / 商品</th>
                    <th scope="col">车型组</th>
                    <th scope="col">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {result.refused.map((entry, index) => (
                    <tr key={`${entry.product_id}-${entry.vehicle_group_id ?? "all"}-${index}`}>
                      <th scope="row" className="table__cell--wrap">
                        <span className="table__names">
                          <span>{entry.tenant_name ?? "（供应商名称没有取到）"}</span>
                          <span className="product-code">{entry.product_code ?? "—"}</span>
                        </span>
                      </th>
                      <td>{groupName(entry.vehicle_group_id)}</td>
                      <td className="table__cell--wrap">{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}

// ───────────── 页面 ─────────────

export function QuotePreviewPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`报价试算 · NOZOMI ${portal.name}`);
  const canPreview = usePlatformCan("quote.preview");
  const canSeeChannels = usePlatformCan("channel.read");
  const channels = useLoad<{ items: Channel[]; truncated: boolean }>("quote-channels", canPreview && canSeeChannels ? listAllChannels : null);
  const cities = useCityOptions(canPreview);
  const groups = useLoad<VehicleGroup[]>("quote-vehicle-groups", canPreview ? (session) => listAllMaster("vehicle-groups", session, { status: "all", sort: "code" }) : null);
  const [form, setForm] = useState<QuoteForm>(emptyQuoteForm);
  const places = useLoad<Place[]>(`quote-places:${form.cityId ?? ""}`, canPreview && form.cityId !== null && form.category === "airport_transfer" ? (session) => listQuotePlaces(session, form.cityId as string) : null);
  const [attempted, setAttempted] = useState(false);
  const [server, setServer] = useState<Partial<Record<QuoteField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ data: PlatformQuotePreview; form: QuoteForm } | null>(null);

  const reading = readQuoteForm(form);
  const errors: Partial<Record<QuoteField, string>> = { ...(attempted ? reading.errors : {}), ...server };
  const errorOf = (field: QuoteField): string[] => (errors[field] ? [errors[field] as string] : []);
  const change = (changes: Partial<QuoteForm>): void => {
    setForm((current) => ({ ...current, ...changes }));
    setServer({});
  };

  const city = (cities.state.data ?? []).find((entry) => entry.id === form.cityId) ?? null;
  const cityName = city ? displayName(city.name).text : "";
  const cityOptions = useMemo(() => (cities.state.data ?? []).map((entry) => ({ value: entry.id, label: displayName(entry.name).text, detail: `${entry.code} · ${entry.timezone}`, keywords: Object.values(entry.name).join(" ") })), [cities.state.data]);
  const placeOptions = useMemo(() => (places.state.data ?? []).map((entry) => ({ value: entry.id, label: displayName(entry.name).text, detail: entry.code, keywords: `${Object.values(entry.name).join(" ")} ${entry.code}` })), [places.state.data]);
  const station = (places.state.data ?? []).find((entry) => entry.id === form.placeId)?.type === "station";
  const groupNames = useMemo(() => new Map((groups.state.data ?? []).map((group) => [group.id, displayName(group.name).text])), [groups.state.data]);
  const needed = pointsNeeded(form);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setAttempted(true);
    setNotice(null);
    setServer({});
    if (reading.body === null) {
      const first = FIELD_ORDER.find((field) => reading.errors[field] !== undefined);
      if (first) requestAnimationFrame(() => focusField(first));
      return;
    }
    setBusy(true);
    try {
      const data = await previewPlatformQuote(token, reading.body);
      setResult({ data, form });
      setAttempted(false);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const placed: Partial<Record<QuoteField, string>> = {};
        for (const issue of serverIssues(err)) {
          const field = fieldOfPath(issue.path);
          if (field !== null && placed[field] === undefined) placed[field] = issue.message;
        }
        setServer(placed);
        const first = FIELD_ORDER.find((field) => placed[field] !== undefined);
        if (first) requestAnimationFrame(() => focusField(first));
        else setNotice("提交的内容不符合要求，请检查后重试。");
      } else if (err instanceof ApiError && err.code === "MASTER_DATA_NOT_READY") {
        const placeDisabled = err.details["reason"] === "PLACE_DISABLED";
        setServer(placeDisabled ? { place: "这个机场或车站已被平台停用，现在不报价。请换一个，或先到主数据里启用它。" } : { city: "这个城市已被平台停用，现在不报价。请换一个，或先到主数据里启用它。" });
        requestAnimationFrame(() => focusField(placeDisabled ? "place" : "city"));
      } else if (err instanceof ApiError && err.code === "CHANNEL_SCOPE_DENIED") {
        setNotice(err.details["reason"] === "CITY_NOT_AUTHORIZED" ? "选的渠道没有被授权卖这个城市。换一个渠道，或先在渠道的授权范围里加上这个城市。" : "选的渠道没有被授权卖这个品类。换一个渠道，或先在渠道的授权范围里加上这个品类。");
      } else if (err instanceof ApiError && err.status === 403) setNotice("你没有权限做报价试算。需要的话，请联系管理员开通。");
      else setNotice(`试算没有成功。${saveFailureText(err, "试算", true)}`);
    } finally {
      setBusy(false);
    }
  };

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="报价试算">
      <Page title="报价试算">{content}</Page>
    </AppShell>
  );
  if (account.status !== "ready") return shell(<Skeleton lines={["control", "control", "control"]} />);
  if (!canPreview) return shell(NO_ACCESS);

  const listedProblems = FIELD_ORDER.filter((field) => errors[field] !== undefined).filter((field, index, all) => all.findIndex((other) => FIELD_IDS[other] === FIELD_IDS[field]) === index);
  const directionNames = station ? { pickup: "接站", dropoff: "送站" } : { pickup: "接机", dropoff: "送机" };
  const timeZoneText = city ? `${cityName}当地时间（${city.timezone}）` : "城市当地时间";

  return shell(
    <>
      <p className="page__lead">填一次用车请求，看所有供应商一起比价的结果：每个车型组谁中标、各家的结算价和对外价、哪些商品报不出价以及原因。只是试算，不会生成可以下单的报价，也不占库存。</p>
      <form className="card quote-form" noValidate onSubmit={(event) => void submit(event)} aria-labelledby="quote-form-title">
        <h2 className="card__title" id="quote-form-title">
          用车请求
        </h2>
        <div role="alert">
          {notice && <Alert kind="danger">{notice}</Alert>}
          {attempted && listedProblems.length > 1 && (
            <Alert kind="danger">
              <strong className="alert__title">{`有 ${listedProblems.length} 处需要修改`}</strong>
              <span className="error-summary__list">
                {listedProblems.map((field) => (
                  <button key={field} type="button" className="link error-summary__item" onClick={() => focusField(field)}>
                    {`${FIELD_NAMES[field]}：${errors[field]}`}
                  </button>
                ))}
              </span>
            </Alert>
          )}
        </div>
        <div className="form-grid">
          <div id="quote-city">
            <Combobox
              label="城市"
              required
              options={cityOptions}
              value={form.cityId}
              onChange={(value) => change({ cityId: value, placeId: null })}
              placeholder="输入城市名或编码"
              errors={errorOf("city")}
              loading={cities.loading}
              loadFailed={cities.loadFailed}
              emptyText={cities.emptyText}
            />
          </div>
          <div id="quote-category">
            <RadioGroup
              legend="品类"
              name="quote-category"
              required
              options={SERVICE_CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_NAMES[value] }))}
              value={form.category}
              errors={errorOf("category")}
              onChange={(value: ServiceCategory) => change({ category: value, placeId: value === "airport_transfer" ? form.placeId : null, direction: value === "airport_transfer" ? form.direction : null })}
            />
          </div>
          {form.category === "airport_transfer" && (
            <>
              <div id="quote-place">
                <Combobox
                  label="机场或车站"
                  required
                  options={placeOptions}
                  value={form.placeId}
                  onChange={(value) => change({ placeId: value })}
                  placeholder={form.cityId === null ? "先选城市" : "输入名称或编码"}
                  errors={errorOf("place")}
                  loading={places.state.status === "loading" && form.cityId !== null}
                  loadFailed={places.state.status === "error"}
                  emptyText={form.cityId === null ? "先选城市" : "这个城市没有启用中的机场或车站"}
                />
              </div>
              <div id="quote-direction">
                <RadioGroup
                  legend="方向"
                  name="quote-direction"
                  required
                  options={[
                    { value: "pickup", label: directionNames.pickup, hint: "从机场或车站出发：要填下车点" },
                    { value: "dropoff", label: directionNames.dropoff, hint: "去机场或车站：要填上车点" },
                  ]}
                  value={form.direction}
                  errors={errorOf("direction")}
                  onChange={(value: "pickup" | "dropoff") => change({ direction: value })}
                />
              </div>
            </>
          )}
          {needed.includes("pickup") && (
            <div id="quote-pickup" className="form-grid__wide">
              <CoordinateInput legend="上车点" value={form.pickup} onChange={(value) => change({ pickup: value })} errors={{ lat: errors["pickup.lat"] ?? null, lng: errors["pickup.lng"] ?? null }} hint="可以把地图软件里复制的「纬度, 经度」直接粘贴进来。" />
            </div>
          )}
          {needed.includes("dropoff") && (
            <div id="quote-dropoff" className="form-grid__wide">
              <CoordinateInput legend="下车点" value={form.dropoff} onChange={(value) => change({ dropoff: value })} errors={{ lat: errors["dropoff.lat"] ?? null, lng: errors["dropoff.lng"] ?? null }} hint="可以把地图软件里复制的「纬度, 经度」直接粘贴进来。" />
            </div>
          )}
          {form.category === "charter" && (
            <div id="quote-package">
              <TextField label="套餐时长（小时）" inputMode="numeric" autoComplete="off" value={form.packageHours} errors={errorOf("packageHours")} onChange={(event) => change({ packageHours: event.target.value })} hint="例如 10，按供应商设的同样时长的套餐报价。" />
            </div>
          )}
          <fieldset className="field fieldset form-grid__wide" id="quote-time">
            <legend className="field__label">用车时间</legend>
            <div className="quote-form__time">
              <TextField label="日期" inputMode="numeric" autoComplete="off" placeholder="年-月-日" className="quote-form__date" value={form.date} errors={errorOf("date")} onChange={(event) => change({ date: event.target.value })} onBlur={() => change({ date: tidyDate(form.date) ?? form.date })} />
              <TextField label="时刻" inputMode="numeric" autoComplete="off" placeholder="08:00" className="quote-form__clock" value={form.time} errors={errorOf("time")} onChange={(event) => change({ time: event.target.value })} onBlur={() => change({ time: tidyTime(form.time) ?? form.time })} />
            </div>
            <p className="field__hint">{`按${timeZoneText}填写；日期写成 2026-01-31 这样。`}</p>
          </fieldset>
          <div id="quote-passengers">
            <TextField label="人数" inputMode="numeric" autoComplete="off" value={form.passengers} errors={errorOf("passengers")} onChange={(event) => change({ passengers: event.target.value })} />
          </div>
          <div id="quote-luggage">
            <TextField label="行李数（选填）" inputMode="numeric" autoComplete="off" value={form.luggage} errors={errorOf("luggage")} onChange={(event) => change({ luggage: event.target.value })} hint="不填按 0 件。" />
          </div>
          <div className="field" id="quote-currency">
            <label className="field__label" htmlFor="quote-currency-select">
              客人支付的币种
            </label>
            <select id="quote-currency-select" className="input select" value={form.currency} aria-invalid={errorOf("currency").length > 0 || undefined} aria-describedby={errorOf("currency").length > 0 ? "quote-currency-error quote-currency-hint" : "quote-currency-hint"} onChange={(event) => change({ currency: event.target.value })}>
              <option value="">请选择</option>
              {CURRENCY_CHOICES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldErrors id="quote-currency-error" errors={errorOf("currency")} />
            <p className="field__hint" id="quote-currency-hint">
              对外价和比价都换算到这个币种；和商品的结算币种不同时要有汇率。
            </p>
          </div>
          {canSeeChannels && (
            <div className="field" id="quote-channel">
              <label className="field__label" htmlFor="quote-channel-select">
                按哪个渠道的规则（选填）
              </label>
              <select id="quote-channel-select" className="input select" value={form.channelId ?? ""} aria-describedby="quote-channel-hint" onChange={(event) => change({ channelId: event.target.value === "" ? null : event.target.value })}>
                <option value="">不选：平台默认参数</option>
                {(channels.state.data?.items ?? []).map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
              <p className="field__hint" id="quote-channel-hint">
                选了渠道：只比它授权卖的供应商，加价比例按它的加价规则，价格带、最低毛利、对外价取整也用它的。
              </p>
            </div>
          )}
          <fieldset className="field fieldset form-grid__wide" id="quote-route">
            <legend className="field__label">假定的里程和时长（选填）</legend>
            <div className="quote-form__time">
              <TextField label="里程（公里）" inputMode="decimal" autoComplete="off" value={form.routeKm} errors={errorOf("routeKm")} onChange={(event) => change({ routeKm: event.target.value })} />
              <TextField label="时长（分钟）" inputMode="numeric" autoComplete="off" value={form.routeMinutes} errors={errorOf("routeMinutes")} onChange={(event) => change({ routeMinutes: event.target.value })} />
            </div>
            <p className="field__hint">不填时按谷歌地图预估的路程计价；填了就按这两项算、不调用谷歌地图（谷歌地图取不到路线时，或想看某个路程下的价格时用）。只有按「里程 + 时长」计价的商品用得到。</p>
          </fieldset>
        </div>
        <div className="form__actions">
          <Button type="submit" variant="primary" loading={busy} loadingText="试算中…">
            试算
          </Button>
          <Button
            variant="text"
            disabled={busy}
            onClick={() => {
              setForm(emptyQuoteForm());
              setAttempted(false);
              setServer({});
              setNotice(null);
              setResult(null);
            }}
          >
            清空重填
          </Button>
        </div>
      </form>
      {result && <QuoteResult result={result.data} groupNames={groupNames} form={result.form} cityName={displayName((cities.state.data ?? []).find((entry) => entry.id === result.form.cityId)?.name).text} />}
      <Attributions sources={placeSources(true)} />
    </>,
  );
}
