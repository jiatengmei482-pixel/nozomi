/**
 * 新预订页 `/book/new`（M8-03，ADR 0069 A3 和「修正版 v2」；规范 docs/design/pages/site-booking-v2.md）。旧的 `/book` 不动，M8-05 验收后再切换。
 *
 * - 「你的行程」：接送 | 按小时包车；接送是出发地、目的地两个地址框（输入即提示），日期、时间、乘客 / 行李、接机才有的航班号（选填）。
 *   接送按两个坐标报价（`POST /site/v1/quotes/by-points`，服务端认机场、接机 / 送机 / 点对点）；包车沿用现有询价（上车点 + 套餐时长，城市按上车点找最近的可订城市）。
 *   填齐了就自动报价（停顿一下再查），改了任何一项旧结果立刻收起。
 * - 「选择车型」：价格从低到高，坐不下的接口不返回；默认电脑 4 个、手机 3 个；选中的展开车内俯视示意图；下面「一口价包含」。
 * - 电脑（≥ 1024px）单页：左列两块，右侧栏只有行程摘要和所选车型的一口价（路线图、合计、取消规则、付款是 M8-04）。
 *   手机分步：第 1 步行程 →「查看车型和价格」→ 第 2 步车型；第 2 步底部固定「车型 · 一口价 [下一步]」——「下一步」（填写乘客信息并付款）在 M8-04 接，现在只说明还没开放。
 * - 链接参数 from / to / date / time / pax / bags（parseBookingLink）：打开就预填并报价；不合法的只是不预填。
 * 四种状态：加载中（骨架）、官网没开 / 没有可订城市（空）、出错（说明 + 重试）、正常。页面上没有供应商、结算价、加价比例。
 */
import { type CityCandidate, fixedPriceIncludes, isFlightNo, serviceCityOf } from "@nozomi/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ApiError } from "../../../api/client.ts";
import {
  type SiteByPointsRequest,
  type SiteByPointsResult,
  type SiteCity,
  type SiteQuoteRequest,
  type SiteQuoteResult,
  autocompleteSitePlaces,
  createSiteQuotes,
  createSiteQuotesByPoints,
  listSiteCharterPackages,
  listSiteCities,
} from "../../../api/site.ts";
import { AlertSlot, type Notice } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { type BookingLink, type LinkEnd, type TripPoint, VISIBLE_VEHICLES, parseBookingLink, pointName, rejectionTexts, travellersText } from "../../../lib/book-new.ts";
import { formatInZone, moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { CHARTER_OVERAGE_NOTE, defaultServiceDate, guestLocalText, quotesByTotal } from "../../../lib/site-display.ts";
import { useDocumentTitle } from "../../../lib/use-document-title.ts";
import { SiteLayout, siteFailureText, useSiteConfig } from "../SiteLayout.tsx";
import { SitePrice } from "../SitePrice.tsx";
import { PlaceField, newSessionToken } from "./PlaceField.tsx";
import { TravellersField } from "./TravellersField.tsx";
import { VehicleList } from "./VehicleList.tsx";

/** 填齐后停顿多久再报价（毫秒）：连点 − + 时只报最后一次。 */
export const QUOTE_DEBOUNCE_MS = 400;

const WIDE_QUERY = "(min-width: 1024px)";

/** 电脑（≥ 1024px）单页、手机分步。 */
function useWideScreen(): boolean {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null;
  const [wide, setWide] = useState(query?.matches ?? true);
  useEffect(() => {
    if (query === null) return;
    const update = (): void => setWide(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [query?.media]);
  return wide;
}

export type BookMode = "transfer" | "charter";

/** 客人填的行程。M8-04 下单时从这里取乘客数、航班号、两端的地址文字。 */
export interface TripDraft {
  mode: BookMode;
  /** 接送：出发地；包车：上车地点 */
  from: TripPoint | null;
  /** 接送：目的地；包车不用 */
  to: TripPoint | null;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  /** 包车：套餐时长（小时） */
  packageHours: string;
  /** 接机：航班号（选填） */
  flightNo: string;
}

type Outcome = { mode: "transfer"; result: SiteByPointsResult } | { mode: "charter"; result: SiteQuoteResult; city: SiteCity };
type QuoteState = { kind: "idle" } | { kind: "loading"; key: string } | { kind: "ready"; key: string; outcome: Outcome } | { kind: "failed"; key: string; message: string; scope: boolean };
type Load<T> = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; items: T };
type Errors = Partial<Record<"from" | "to" | "date" | "time" | "packageHours" | "flightNo", string>>;

const TRIP_TYPE_NAMES = { pickup: "接机", dropoff: "送机", point_to_point: "点对点" } as const;

const sameEnds = (a: TripPoint | null, b: TripPoint | null): string => JSON.stringify([a?.lat, a?.lng, b?.lat, b?.lng]);

function end(point: TripPoint): SiteByPointsRequest["pickup"] {
  return { name: point.name, lat: point.lat, lng: point.lng, ...(point.kind === null ? {} : { kind: point.kind }) };
}

/** 包车按上车地点找城市：上车点在城市范围里、能订包车的城市里中心最近的。 */
function charterCityOf(point: TripPoint | null, cities: readonly SiteCity[]): SiteCity | null {
  if (point === null) return null;
  const found = serviceCityOf(point, cities.filter((city) => city.categories.includes("charter")));
  return found === null ? null : (cities.find((city) => city.id === found.id) ?? null);
}

/** 填齐了时的询价请求（和它的键）；没填齐为 null。 */
function requestOf(draft: TripDraft, charterCity: SiteCity | null): { key: string; run(): Promise<Outcome> } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^\d{2}:\d{2}$/.test(draft.time) || draft.from === null) return null;
  const serviceLocal = `${draft.date}T${draft.time}`;
  if (draft.mode === "charter") {
    if (charterCity === null || draft.packageHours === "") return null;
    const body: SiteQuoteRequest = { category: "charter", city_id: charterCity.id, pickup: { lat: draft.from.lat, lng: draft.from.lng }, package_hours: Number(draft.packageHours), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage };
    return { key: JSON.stringify(body), run: async () => ({ mode: "charter", result: await createSiteQuotes(body), city: charterCity }) };
  }
  if (draft.to === null) return null;
  const body: SiteByPointsRequest = { pickup: end(draft.from), dropoff: end(draft.to), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage };
  return { key: JSON.stringify(body), run: async () => ({ mode: "transfer", result: await createSiteQuotesByPoints(body) }) };
}

/** 链接里的一端 → 地点：坐标直接用；编码用输入即提示找平台的地点（排在最前的那个）。找不到为 null。 */
async function resolveLinkEnd(link: LinkEnd | null): Promise<TripPoint | null> {
  if (link === null) return null;
  if (link.kind === "point") return { name: link.name ?? pointName(link.lat, link.lng), lat: link.lat, lng: link.lng, kind: null };
  try {
    const found = await autocompleteSitePlaces(link.code, newSessionToken());
    const place = found.items.find((item) => item.source === "platform" && item.location !== null);
    return place === undefined || place.location === null ? null : { name: place.name, lat: place.location.lat, lng: place.location.lng, kind: place.kind };
  } catch {
    return null;
  }
}

function initialDraft(link: BookingLink): TripDraft {
  return { mode: "transfer", from: null, to: null, date: link.date ?? "", time: link.time ?? "", passengers: link.passengers ?? 2, luggage: link.luggage ?? link.passengers ?? 2, packageHours: "", flightNo: "" };
}

function validate(draft: TripDraft, charterCity: SiteCity | null, arrival: boolean): Errors {
  const errors: Errors = {};
  if (draft.from === null) errors.from = draft.mode === "charter" ? "请从候选里选上车地点" : "请从候选里选出发地";
  else if (draft.mode === "charter" && charterCity === null) errors.from = "这个地址暂时没有在线报价，请联系客服";
  if (draft.mode === "transfer" && draft.to === null) errors.to = "请从候选里选目的地";
  if (draft.mode === "charter" && charterCity !== null && draft.packageHours === "") errors.packageHours = "请选择包车时长";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "请选择日期";
  if (!/^\d{2}:\d{2}$/.test(draft.time)) errors.time = "请选择时间";
  if (arrival && draft.flightNo.trim() !== "" && !isFlightNo(draft.flightNo)) errors.flightNo = "航班号的格式不对，如 NH211、MU523";
  return errors;
}

function SupportPhone({ phone }: { phone: string | null }) {
  if (phone === null) return null;
  return (
    <p>
      客服电话：
      <a className="link" href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
        {phone}
      </a>
    </p>
  );
}

export function BookNewPage() {
  useDocumentTitle("预订用车 · NOZOMI 用车");
  const location = useLocation();
  const link = useMemo(() => parseBookingLink(location.search), []);
  const wide = useWideScreen();
  const { state: config, reload: reloadConfig } = useSiteConfig();
  const [cities, setCities] = useState<Load<SiteCity[]>>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<TripDraft>(() => initialDraft(link));
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [quote, setQuote] = useState<QuoteState>({ kind: "idle" });
  const [quoteRound, setQuoteRound] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<{ ends: string; tripType: SiteByPointsResult["trip_type"] } | null>(null);
  const [packages, setPackages] = useState<{ cityId: string; load: Load<number[]> } | null>(null);
  const [nextNote, setNextNote] = useState(false);
  const vehiclesHeading = useRef<HTMLHeadingElement>(null);
  const tripHeading = useRef<HTMLHeadingElement>(null);

  const open = config.kind === "ready" && config.config.open;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCities({ kind: "loading" });
    listSiteCities().then(
      ({ items }) => alive && setCities({ kind: "ready", items }),
      (err: unknown) => alive && setCities({ kind: "failed", message: siteFailureText(err, "读取城市") }),
    );
    return () => {
      alive = false;
    };
  }, [open, round]);

  const cityList = useMemo(() => (cities.kind === "ready" ? cities.items : []), [cities]);
  const firstCity = cityList[0] ?? null;

  // 默认日期：第一个可订城市当地的明天
  useEffect(() => {
    if (firstCity === null) return;
    setDraft((current) => (current.date === "" ? { ...current, date: defaultServiceDate(firstCity.timezone, new Date()) } : current));
  }, [firstCity]);

  // 链接预填（只在打开时一次）：两端都有、日期时间也有时直接报价；手机直接到第 2 步
  const linkDone = useRef(false);
  useEffect(() => {
    if (cities.kind !== "ready" || linkDone.current) return;
    linkDone.current = true;
    if (link.from === null && link.to === null) return;
    let alive = true;
    void Promise.all([resolveLinkEnd(link.from), resolveLinkEnd(link.to)]).then(([from, to]) => {
      if (!alive) return;
      setDraft((current) => ({ ...current, from: current.from ?? from, to: current.to ?? to }));
      if (from !== null && to !== null && link.date !== null && link.time !== null) setStep(2);
    });
    return () => {
      alive = false;
    };
  }, [cities.kind, link]);

  const charterCity = draft.mode === "charter" ? charterCityOf(draft.from, cityList) : null;

  // 包车时长：按上车地点所在的城市读；只有一种时替客人选上
  useEffect(() => {
    if (charterCity === null) return;
    if (packages !== null && packages.cityId === charterCity.id && packages.load.kind !== "failed") return;
    let alive = true;
    const cityId = charterCity.id;
    setPackages({ cityId, load: { kind: "loading" } });
    listSiteCharterPackages(cityId).then(
      ({ items }) => {
        if (!alive) return;
        const hours = items.map((item) => item.hours);
        setPackages({ cityId, load: { kind: "ready", items: hours } });
        setDraft((current) => (hours.length === 1 && current.packageHours === "" ? { ...current, packageHours: String(hours[0]) } : current));
      },
      (err: unknown) => alive && setPackages({ cityId, load: { kind: "failed", message: siteFailureText(err, "读取包车时长") } }),
    );
    return () => {
      alive = false;
    };
  }, [charterCity?.id]);
  const packageLoad = charterCity !== null && packages !== null && packages.cityId === charterCity.id ? packages.load : null;

  // 填齐了就报价：停顿一下再查；改了任何一项旧结果立刻收起（键对不上的结果不显示）
  const request = requestOf(draft, charterCity);
  const requestKey = request?.key ?? null;
  const latestRequest = useRef(request);
  latestRequest.current = request;
  useEffect(() => {
    const current = latestRequest.current;
    if (current === null) {
      setQuote({ kind: "idle" });
      return;
    }
    let alive = true;
    setQuote({ kind: "loading", key: current.key });
    const timer = setTimeout(() => {
      current.run().then(
        (outcome) => {
          if (!alive) return;
          setQuote({ kind: "ready", key: current.key, outcome });
          if (outcome.mode === "transfer") setRecognized({ ends: sameEnds(draft.from, draft.to), tripType: outcome.result.trip_type });
        },
        (err: unknown) => {
          if (!alive) return;
          const scope = err instanceof ApiError && err.code === "CHANNEL_SCOPE_DENIED";
          setQuote({ kind: "failed", key: current.key, scope, message: scope ? "这个地址暂时没有在线报价，请联系客服" : siteFailureText(err, "查询价格") });
        },
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [requestKey, quoteRound]);

  const current = quote.kind !== "idle" && quote.key === requestKey ? quote : null;
  const outcome = current?.kind === "ready" ? current.outcome : null;
  const quotes = useMemo(() => (outcome === null ? [] : quotesByTotal(outcome.result.quotes)), [outcome]);
  const selected = quotes.find((entry) => entry.vehicle_group.id === selectedId) ?? null;
  const tripType: SiteByPointsResult["trip_type"] | null = draft.mode === "charter" ? null : recognized !== null && recognized.ends === sameEnds(draft.from, draft.to) ? recognized.tripType : draft.from?.kind === "airport" ? "pickup" : null;
  const arrival = tripType === "pickup";
  const freeWait = (selected ?? quotes[0] ?? null)?.free_wait_minutes ?? null;
  const timezone = outcome?.mode === "charter" ? outcome.city.timezone : (outcome?.result.city?.timezone ?? firstCity?.timezone ?? "Asia/Tokyo");
  const cityName = outcome?.mode === "charter" ? displayName(outcome.city.name).text : outcome?.result.city ? displayName(outcome.result.city.name).text : null;

  const update = useCallback((changes: Partial<TripDraft>): void => {
    setDraft((value) => ({ ...value, ...changes }));
    setNotice(null);
    setNextNote(false);
    setErrors((value) => {
      const next = { ...value };
      for (const key of Object.keys(changes)) delete next[key as keyof Errors];
      return next;
    });
  }, []);

  const showVehicles = (): void => {
    const found = validate(draft, charterCity, arrival);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      return;
    }
    setNotice(null);
    setStep(2);
  };

  // 手机换步：到第 2 步把焦点放到「选择车型」，回第 1 步放到「你的行程」
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    if (wide) return;
    const target = step === 2 ? vehiclesHeading.current : tripHeading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [step]);

  const supportPhone = config.kind === "ready" ? config.config.support_phone : null;

  let body;
  if (config.kind === "loading" || (open && cities.kind === "loading")) {
    body = <Skeleton lines={["long", "control", "control", "control", "control"]} label="正在打开预订页" />;
  } else if (config.kind === "failed") {
    body = <StateBlock title="页面没有打开" description={config.message} action={<Button size="lg" onClick={reloadConfig}>重试</Button>} />;
  } else if (!config.config.open) {
    body = <StateBlock tone="neutral" title="暂未开放预订" description="官网的在线预订还没有开放，请稍后再来。已经下过单的客人可以点上方的「查订单」查看订单。" />;
  } else if (cities.kind === "failed") {
    body = <StateBlock title="城市列表没有读出来" description={cities.message} action={<Button size="lg" onClick={() => setRound((value) => value + 1)}>重试</Button>} />;
  } else if (cityList.length === 0) {
    body = <StateBlock tone="neutral" title="暂时没有可预订的城市" description="现在还没有可以在线预订用车的城市，请稍后再来。" />;
  } else {
    const tiles = config.config.map_tiles;
    const centers: CityCandidate[] = cityList.map((city) => ({ id: city.id, center: city.center }));
    const centerOf = (other: TripPoint | null) => (other !== null ? { lat: other.lat, lng: other.lng } : (firstCity?.center ?? null));
    const charterOnly = cityList.some((city) => city.categories.includes("charter"));
    const transferOnly = cityList.some((city) => city.categories.includes("airport_transfer") || city.categories.includes("point_to_point"));
    const showStep1 = wide || step === 1;
    const showStep2 = wide || step === 2;
    const timeLabel = arrival ? "航班落地时间（当地）" : draft.mode === "charter" ? "上车时间（当地）" : "用车时间（当地）";
    const tripName = draft.mode === "charter" ? "包车" : tripType !== null ? TRIP_TYPE_NAMES[tripType] : null;
    const whenText = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && /^\d{2}:\d{2}$/.test(draft.time) ? `${guestLocalText(`${draft.date}T${draft.time}`, timezone, new Date())}${arrival ? " 落地" : ""}` : null;

    const tripSection = (
      <section aria-labelledby="book-trip-title" className="site-section book-new__trip">
        <h2 id="book-trip-title" ref={tripHeading} tabIndex={-1} className="site-section__title">
          你的行程
        </h2>
        <AlertSlot notice={notice} />
        {charterOnly && transferOnly && (
          <fieldset className="book-mode">
            <legend className="visually-hidden">服务</legend>
            {(["transfer", "charter"] as const).map((mode) => (
              <label key={mode} className={draft.mode === mode ? "book-mode__option book-mode__option--checked" : "book-mode__option"}>
                <input type="radio" name="book-mode" className="book-mode__input" checked={draft.mode === mode} onChange={() => update({ mode, packageHours: "" })} />
                {mode === "transfer" ? "接送" : "按小时包车"}
              </label>
            ))}
          </fieldset>
        )}
        <PlaceField
          key={`from-${draft.mode}`}
          label={draft.mode === "charter" ? "上车地点" : "出发地"}
          value={draft.from}
          onChange={(from) => update({ from })}
          {...(errors.from !== undefined ? { error: errors.from } : {})}
          tiles={tiles}
          mapCenter={centerOf(draft.to)}
          cities={centers}
        />
        {draft.mode === "transfer" && <PlaceField label="目的地" value={draft.to} onChange={(to) => update({ to })} {...(errors.to !== undefined ? { error: errors.to } : {})} tiles={tiles} mapCenter={centerOf(draft.from)} cities={centers} />}
        {draft.mode === "charter" && draft.from !== null && charterCity === null && (
          <div className="book-new__notice" role="status">
            <p>这个地址暂时没有在线报价，请联系客服</p>
            <SupportPhone phone={supportPhone} />
          </div>
        )}
        {draft.mode === "charter" &&
          charterCity !== null &&
          (packageLoad?.kind === "failed" ? (
            <StateBlock headingLevel="h3" title="包车时长没有读出来" description={packageLoad.message} action={<Button size="lg" onClick={() => setPackages(null)}>重试</Button>} />
          ) : packageLoad?.kind === "ready" && packageLoad.items.length === 0 ? (
            <StateBlock headingLevel="h3" tone="neutral" title="暂时没有可选的包车时长" description="这个城市的包车还没有可以预订的套餐，请联系客服。" />
          ) : (
            <SelectField
              label="包车时长"
              required
              placeholder={packageLoad?.kind === "ready" ? "请选择时长" : "正在读取"}
              value={draft.packageHours}
              options={(packageLoad?.kind === "ready" ? packageLoad.items : []).map((hours) => ({ value: String(hours), label: `${hours} 小时` }))}
              errors={errors.packageHours ? [errors.packageHours] : []}
              hint="超出套餐的时长和公里服务后按实际收取"
              onChange={(packageHours) => update({ packageHours })}
            />
          ))}
        <div className="site-form__row">
          <TextField label="日期（当地）" size="lg" type="date" required value={draft.date} errors={errors.date ? [errors.date] : []} onChange={(event) => update({ date: event.target.value })} />
          <TextField label={timeLabel} size="lg" type="time" required value={draft.time} errors={errors.time ? [errors.time] : []} {...(cityName !== null ? { hint: `${cityName}的当地时间` } : {})} onChange={(event) => update({ time: event.target.value })} />
        </div>
        {arrival && (
          <p className="book-new__arrival" role="status">
            <Icon name="info" />
            <span>{freeWait !== null && freeWait > 0 ? `已识别为接机：司机按航班落地时间等候，落地后免费等待 ${freeWait} 分钟` : "已识别为接机：司机按航班落地时间等候"}</span>
          </p>
        )}
        <div className="site-form__row">
          <TravellersField passengers={draft.passengers} luggage={draft.luggage} onChange={(value) => update(value)} />
          {arrival && (
            <TextField label="航班号（选填）" size="lg" autoCapitalize="characters" value={draft.flightNo} errors={errors.flightNo ? [errors.flightNo] : []} hint="如 NH211" onChange={(event) => update({ flightNo: event.target.value })} onBlur={() => {
                const issue = validate(draft, charterCity, arrival).flightNo;
                if (issue !== undefined) setErrors((value) => ({ ...value, flightNo: issue }));
              }} />
          )}
        </div>
        {!wide && (
          <div className="site-actions">
            <Button variant="primary" size="lg" block onClick={showVehicles}>
              查看车型和价格
            </Button>
          </div>
        )}
      </section>
    );

    let vehicles;
    if (current === null) {
      vehicles = <p className="site-muted">{draft.mode === "charter" ? "选好上车地点、包车时长、日期和时间后，这里会列出能坐下的车型和一口价。" : "填好出发地、目的地、日期和时间后，这里会列出能坐下的车型和一口价。"}</p>;
    } else if (current.kind === "loading") {
      vehicles = <Skeleton lines={["long", "medium", "long", "medium"]} label="正在查询价格" />;
    } else if (current.kind === "failed") {
      vehicles = (
        <StateBlock
          headingLevel="h3"
          title={current.scope ? "没有在线报价" : "价格没有查出来"}
          description={current.message}
          action={current.scope ? <SupportPhone phone={supportPhone} /> : <Button size="lg" onClick={() => setQuoteRound((value) => value + 1)}>重试</Button>}
        />
      );
    } else if (quotes.length === 0) {
      const { texts, support } = rejectionTexts((outcome?.result.unavailable ?? []).flatMap((entry) => entry.reasons));
      vehicles = (
        <div className="book-new__rejected" role="status">
          <h3 className="book-new__subtitle">没有可预订的车</h3>
          <ul className="site-reasons">
            {texts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          {support && <SupportPhone phone={supportPhone} />}
        </div>
      );
    } else {
      const expires = quotes.map((entry) => entry.expires_at).sort()[0] ?? null;
      const includes = fixedPriceIncludes({ service: draft.mode === "charter" ? "charter" : "transfer", arrival, freeWaitMinutes: freeWait, meetAndGreet: false });
      vehicles = (
        <>
          <p className="site-muted">
            按价格从低到高 · 坐不下的已隐藏。报价 30 分钟内有效（到当地时间 {formatInZone(expires, timezone).slice(11)}），过了请重新查询。
          </p>
          <VehicleList key={current.key} quotes={quotes} limit={wide ? VISIBLE_VEHICLES.wide : VISIBLE_VEHICLES.narrow} selectedId={selected?.vehicle_group.id ?? null} onSelect={(entry) => setSelectedId(entry.vehicle_group.id)} />
          <section aria-labelledby="book-includes-title" className="book-includes">
            <h3 id="book-includes-title" className="book-new__subtitle">
              一口价包含
            </h3>
            <ul className="book-includes__list">
              {includes.map((item) => (
                <li key={item.key} className="book-includes__item">
                  <Icon name="check" className="book-includes__icon" />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            {draft.mode === "charter" && <p className="site-muted">{CHARTER_OVERAGE_NOTE}</p>}
          </section>
        </>
      );
    }

    const strip = draft.from !== null && (
      <div className="book-new__strip">
        <p className="book-new__strip-text">
          {tripName !== null && <span className="book-new__strip-type">{tripName}</span>} {draft.from.name}
          {draft.mode === "transfer" && draft.to !== null ? ` → ${draft.to.name}` : ""}
          {whenText !== null ? ` · ${whenText}` : ""} · {travellersText(draft.passengers, draft.luggage)}
        </p>
        <Button size="lg" onClick={() => setStep(1)}>
          修改
        </Button>
      </div>
    );

    const vehicleSection = (
      <section aria-labelledby="book-vehicles-title" className="site-section book-new__vehicles">
        <h2 id="book-vehicles-title" ref={vehiclesHeading} tabIndex={-1} className="site-section__title">
          选择车型
        </h2>
        {!wide && strip}
        {vehicles}
      </section>
    );

    const summary = (
      <aside className="book-new__aside" aria-labelledby="book-summary-title">
        <section className="site-section book-summary">
          <h2 id="book-summary-title" className="site-section__title">
            行程摘要
          </h2>
          <dl className="book-summary__facts">
            {tripName !== null && (
              <div className="site-facts__item">
                <dt>行程</dt>
                <dd>{draft.mode === "charter" && draft.packageHours !== "" ? `包车 ${draft.packageHours} 小时` : tripName}</dd>
              </div>
            )}
            <div className="site-facts__item">
              <dt>{draft.mode === "charter" ? "上车地点" : "出发地"}</dt>
              <dd>{draft.from?.name ?? "—"}</dd>
            </div>
            {draft.mode === "transfer" && (
              <div className="site-facts__item">
                <dt>目的地</dt>
                <dd>{draft.to?.name ?? "—"}</dd>
              </div>
            )}
            <div className="site-facts__item">
              <dt>{arrival ? "航班落地（当地时间）" : "用车时间（当地时间）"}</dt>
              <dd>{whenText ?? "—"}</dd>
            </div>
            <div className="site-facts__item">
              <dt>乘客 / 行李</dt>
              <dd>{travellersText(draft.passengers, draft.luggage)}</dd>
            </div>
            {arrival && draft.flightNo.trim() !== "" && (
              <div className="site-facts__item">
                <dt>航班号</dt>
                <dd>{draft.flightNo.trim().toUpperCase()}</dd>
              </div>
            )}
          </dl>
          {selected === null ? (
            <p className="site-muted">还没有选择车型</p>
          ) : (
            <div className="site-facts__item site-facts__item--total book-summary__total">
              <span className="book-summary__vehicle" lang={displayName(selected.vehicle_group.name).lang}>
                {displayName(selected.vehicle_group.name).text} · 一口价
              </span>
              <SitePrice text={moneyText(selected.price.total)} size="lg" />
            </div>
          )}
        </section>
      </aside>
    );

    const bar = !wide && step === 2 && selected !== null && (
      <div className="book-bar">
        <p className="book-bar__text">
          <span lang={displayName(selected.vehicle_group.name).lang}>{displayName(selected.vehicle_group.name).text}</span> · 一口价 <SitePrice text={moneyText(selected.price.total)} size="sm" />
        </p>
        <Button variant="primary" size="lg" onClick={() => setNextNote(true)}>
          下一步
        </Button>
        <p className="book-bar__note" role="status">
          {nextNote ? "填写乘客信息并付款的一步还没有开放，敬请稍候。" : ""}
        </p>
      </div>
    );

    body = (
      <div className={bar ? "book-new book-new--with-bar" : "book-new"}>
        <div className="book-new__main">
          {showStep1 && tripSection}
          {showStep2 && vehicleSection}
        </div>
        {wide && summary}
        {bar}
      </div>
    );
  }

  return (
    <SiteLayout>
      <h1 className="site__title">预订接送车</h1>
      <p className="site-muted">输入出发地和目的地，马上看到所有车型的一口价</p>
      {body}
    </SiteLayout>
  );
}

