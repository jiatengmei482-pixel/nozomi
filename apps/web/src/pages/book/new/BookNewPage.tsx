/**
 * 新预订页 `/book/new`（M8-03，ADR 0069 A3 和「修正版 v2」；规范 docs/design/pages/site-booking-v2.md）。旧的 `/book` 不动，M8-05 验收后再切换。
 *
 * - 「你的行程」：接送 | 按小时包车；接送是出发地、目的地两个地址框（输入即提示），日期、时间、乘客 / 行李、接机才有的航班号（选填）。
 *   接送按两个坐标报价（`POST /site/v1/quotes/by-points`，服务端认机场、接机 / 送机 / 点对点）；包车沿用现有询价（上车点 + 下车点 + 套餐时长，城市按上车点找最近的可订城市）。
 *   包车的下车地点必填（M8-19，ADR 0073，规范 10.1）：和上车地点同一个地址框；报价含区域加价时只说「含区域加价，已算在这个价格里」，不写金额（10.2）。
 *   填齐了就自动报价（停顿一下再查），改了任何一项旧结果立刻收起。
 * - 「选择车型」：价格从低到高，坐不下的接口不返回；默认电脑 4 个、手机 3 个；选中的展开车内俯视示意图；下面「一口价包含」。
 * - 「怎么联系你」（M8-04）：字段、校验、下单（`POST /site/v1/orders`）和旧下单页同一套（`lib/site-order-form.ts`），下单后进现有订单页付款。
 * - 电脑（≥ 1024px）单页：左列三块，右侧栏跟着滚动：行程摘要、路线图、附加服务（改数量带 `addons` 重新报价，显示合计差额）、车费、合计、
 *   参考价（≈ 客人币种）、取消规则、去付款、支付方式。
 *   手机分步：第 1 步行程 →「查看车型和价格」→ 第 2 步车型（底部固定「车型 · 一口价 [下一步]」）→ 第 3 步：右侧栏的内容在顶部，下面「怎么联系你」。
 * - 链接参数 from / to / date / time / pax / bags（parseBookingLink）：打开就预填并报价；不合法的只是不预填。`mode=charter` 打开就是包车（旧 `/book` 的包车跳过来，M8-15），
 *   包车也用 `to` 当下车地点；旧链接只有 `from` 时下车地点空着，框下面请客人补选（10.1）。
 * 四种状态：加载中（骨架）、官网没开 / 没有可订城市（空）、出错（说明 + 重试）、正常。页面上没有供应商、结算价、加价比例。
 */
import { type CityCandidate, type CurrencyCode, fixedPriceIncludes, isFlightNo, serviceCityOf } from "@nozomi/domain";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../../api/client.ts";
import {
  type SiteAddonRequest,
  type SiteByPointsRequest,
  type SiteByPointsResult,
  type SiteCity,
  type SiteFxReference,
  type SiteQuote,
  type SiteQuoteRequest,
  type SiteQuoteResult,
  createSiteOrder,
  createSiteQuotes,
  createSiteQuotesByPoints,
  getSiteFxReference,
  listSiteCharterPackages,
  getSitePlaceByCode,
  listSiteCities,
} from "../../../api/site.ts";
import { AlertSlot, type Notice } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { type BookingLink, type LinkEnd, type TripPoint, VISIBLE_VEHICLES, guestCurrencyOf, moneyDifference, parseBookingLink, pointName, rejectionTexts, travellersText } from "../../../lib/book-new.ts";
import { formatInZone, moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { CHARTER_OVERAGE_NOTE, addressEnds, defaultServiceDate, guestCancelPolicyText, guestLocalText, newIdempotencyKey, quotesByTotal, siteOrderUrl } from "../../../lib/site-display.ts";
import { FIELD_HINTS, type OrderErrors, type OrderTrip, orderFailureOf, orderRequestOf, validateOrderForm } from "../../../lib/site-order-form.ts";
import { useDocumentTitle } from "../../../lib/use-document-title.ts";
import { SiteLayout, siteFailureText, useSiteConfig } from "../SiteLayout.tsx";
import { SitePrice } from "../SitePrice.tsx";
import { AddonsBlock, type ContactForm, ContactSection, PayBlock, PriceBlock, type PricedState, RouteBlock, emptyContact } from "./CheckoutParts.tsx";
import { PlaceField } from "./PlaceField.tsx";
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
  /** 接送：目的地；包车：下车地点（M8-19 起必填） */
  to: TripPoint | null;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  /** 包车：套餐时长（小时） */
  packageHours: string;
  /** 接机：航班号（下单时接机必填，和旧下单页同一条规则） */
  flightNo: string;
}

type Outcome = { mode: "transfer"; result: SiteByPointsResult } | { mode: "charter"; result: SiteQuoteResult; city: SiteCity };
type QuoteState = { kind: "idle" } | { kind: "loading"; key: string } | { kind: "ready"; key: string; outcome: Outcome } | { kind: "failed"; key: string; message: string; scope: boolean };
/** 加了附加服务的那次报价：所选车型的报价（没报出来为 null） */
type AddonQuoteState = { kind: "loading"; key: string } | { kind: "ready"; key: string; quote: SiteQuote | null } | { kind: "failed"; key: string; message: string };
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
function requestOf(draft: TripDraft, charterCity: SiteCity | null, addons: readonly SiteAddonRequest[] = []): { key: string; run(): Promise<Outcome> } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^\d{2}:\d{2}$/.test(draft.time) || draft.from === null) return null;
  const serviceLocal = `${draft.date}T${draft.time}`;
  if (draft.mode === "charter") {
    if (charterCity === null || draft.packageHours === "" || draft.to === null) return null;
    const body: SiteQuoteRequest = { category: "charter", city_id: charterCity.id, pickup: { lat: draft.from.lat, lng: draft.from.lng }, dropoff: { lat: draft.to.lat, lng: draft.to.lng }, package_hours: Number(draft.packageHours), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage, ...(addons.length > 0 ? { addons: [...addons] } : {}) };
    return { key: JSON.stringify(body), run: async () => ({ mode: "charter", result: await createSiteQuotes(body), city: charterCity }) };
  }
  if (draft.to === null) return null;
  const body: SiteByPointsRequest = { pickup: end(draft.from), dropoff: end(draft.to), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage, ...(addons.length > 0 ? { addons: [...addons] } : {}) };
  return { key: JSON.stringify(body), run: async () => ({ mode: "transfer", result: await createSiteQuotesByPoints(body) }) };
}

/** 链接里的一端读出来的结果：地点；或者没找到 / 没读出来（页面要说一句，不能静默不预填）。 */
type LinkResolution = { kind: "point"; point: TripPoint } | { kind: "missing"; code: string } | { kind: "failed"; code: string } | null;

/**
 * 链接里的一端 → 地点：坐标直接用；编码按编码取一次平台地点（`GET /site/v1/places/by-code`，只在渠道授权的城市里、不调谷歌），
 * 每个编码只调一次（M8-04 验收问题 1：原来逐城市读常用地点，一次打开几十上百个请求，触发官网限速）。
 */
async function resolveLinkEnd(link: LinkEnd | null): Promise<LinkResolution> {
  if (link === null) return null;
  if (link.kind === "point") return { kind: "point", point: { name: link.name ?? pointName(link.lat, link.lng), lat: link.lat, lng: link.lng, kind: null } };
  try {
    const place = await getSitePlaceByCode(link.code);
    return { kind: "point", point: { name: displayName(place.name).text, lat: place.location.lat, lng: place.location.lng, kind: place.type === "airport" ? "airport" : "other" } };
  } catch (err) {
    return err instanceof ApiError && err.status === 404 ? { kind: "missing", code: link.code } : { kind: "failed", code: link.code };
  }
}

/** 链接里的地点没有预填时的说法（包车的两端叫上车地点、下车地点）。 */
function linkNotice(ends: LinkResolution[], mode: BookMode): string | null {
  const missing = ends.filter((end) => end?.kind === "missing").map((end) => `「${(end as { code: string }).code}」`);
  const failed = ends.filter((end) => end?.kind === "failed").map((end) => `「${(end as { code: string }).code}」`);
  if (missing.length > 0) {
    // 只提没找到的那一端（[出发地, 目的地]）
    const which = (mode === "charter" ? ["上车地点", "下车地点"] : ["出发地", "目的地"]).filter((_, index) => ends[index]?.kind === "missing").join("和");
    return `链接里的地点${missing.join("、")}没有找到，请在下面重新选择${which}。`;
  }
  if (failed.length > 0) return `链接里的地点${failed.join("、")}暂时没有读出来，请稍后刷新页面，或在下面直接选择。`;
  return null;
}

function initialDraft(link: BookingLink): TripDraft {
  return { mode: link.mode ?? "transfer", from: null, to: null, date: link.date ?? "", time: link.time ?? "", passengers: link.passengers ?? 2, luggage: link.luggage ?? link.passengers ?? 2, packageHours: "", flightNo: "" };
}

function validate(draft: TripDraft, charterCity: SiteCity | null, arrival: boolean): Errors {
  const errors: Errors = {};
  if (draft.from === null) errors.from = draft.mode === "charter" ? "请从候选里选上车地点" : "请从候选里选出发地";
  else if (draft.mode === "charter" && charterCity === null) errors.from = "这个地址暂时没有在线报价，请联系客服";
  if (draft.to === null) errors.to = draft.mode === "charter" ? "请选择下车地点" : "请从候选里选目的地";
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
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [quote, setQuote] = useState<QuoteState>({ kind: "idle" });
  const [quoteRound, setQuoteRound] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<{ ends: string; tripType: SiteByPointsResult["trip_type"] } | null>(null);
  const [packages, setPackages] = useState<{ cityId: string; load: Load<number[]> } | null>(null);
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({});
  const [addonQuote, setAddonQuote] = useState<AddonQuoteState | null>(null);
  const [guestCurrency, setGuestCurrency] = useState<CurrencyCode>(() => guestCurrencyOf(navigator.languages?.length ? navigator.languages : [navigator.language]));
  const [reference, setReference] = useState<SiteFxReference | null>(null);
  const [contact, setContact] = useState<ContactForm>(emptyContact);
  const [contactErrors, setContactErrors] = useState<OrderErrors>({});
  const [contactNotice, setContactNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const orderKey = useRef<string | null>(null);
  const navigate = useNavigate();
  const vehiclesHeading = useRef<HTMLHeadingElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
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
    void Promise.all([resolveLinkEnd(link.from), resolveLinkEnd(link.to)]).then(([fromEnd, toEnd]) => {
      if (!alive) return;
      const from = fromEnd?.kind === "point" ? fromEnd.point : null;
      const to = toEnd?.kind === "point" ? toEnd.point : null;
      setDraft((current) => ({ ...current, from: current.from ?? from, to: current.to ?? to }));
      const text = linkNotice([fromEnd, toEnd], link.mode ?? "transfer");
      if (text !== null) setNotice({ kind: "warning", text });
      else if (from !== null && to !== null && link.date !== null && link.time !== null) setStep(2);
    });
    return () => {
      alive = false;
    };
  }, [cities.kind, link]);

  const charterCity = draft.mode === "charter" ? charterCityOf(draft.from, cityList) : null;
  /** 旧的包车链接：只有上车地点（`from`）没有下车地点（`to`），下车地点框下面请客人补选（规范 10.1） */
  const legacyCharterLink = link.mode === "charter" && link.from !== null && link.to === null;

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

  // 附加服务：所选车型带上客人选的数量再报一次价，合计用这一次的；车型列表仍是不带附加服务的那一次（带了以后不提供的车型会被筛掉）
  const addonList = useMemo<SiteAddonRequest[]>(
    () =>
      Object.entries(addonQuantities)
        .filter(([, quantity]) => quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([addon_id, quantity]) => ({ addon_id, quantity })),
    [addonQuantities],
  );
  const addonRequest = selected !== null && addonList.length > 0 ? requestOf(draft, charterCity, addonList) : null;
  const addonKey = addonRequest?.key ?? null;
  const latestAddonRequest = useRef(addonRequest);
  latestAddonRequest.current = addonRequest;
  const selectedGroupId = selected?.vehicle_group.id ?? null;
  useEffect(() => {
    const run = latestAddonRequest.current;
    if (run === null || selectedGroupId === null) {
      setAddonQuote(null);
      return;
    }
    let alive = true;
    setAddonQuote({ kind: "loading", key: run.key });
    const timer = setTimeout(() => {
      run.run().then(
        (found) => alive && setAddonQuote({ kind: "ready", key: run.key, quote: found.result.quotes.find((entry) => entry.vehicle_group.id === selectedGroupId) ?? null }),
        (err: unknown) => alive && setAddonQuote({ kind: "failed", key: run.key, message: siteFailureText(err, "计算附加服务") }),
      );
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [addonKey, selectedGroupId]);
  const addonCurrent = addonQuote !== null && addonQuote.key === addonKey ? addonQuote : null;
  /** 下单用的报价：没加附加服务就是所选车型的报价；加了就是带附加服务的那一次（还在算、报不出来为 null） */
  const priced: SiteQuote | null = selected === null ? null : addonList.length === 0 ? selected : addonCurrent?.kind === "ready" ? addonCurrent.quote : null;
  let pricedState: PricedState = { kind: "loading" };
  if (priced !== null && selected !== null) pricedState = { kind: "ready", total: priced.price.total, difference: addonList.length > 0 ? moneyDifference(priced.price.total, selected.price.total) : null };
  else if (addonCurrent?.kind === "ready") pricedState = { kind: "unavailable" };
  else if (addonCurrent?.kind === "failed") pricedState = { kind: "failed", message: addonCurrent.message };

  // 参考价：客人币种的参考汇率（汇率中心「现在生效」的）；取不到就不显示
  useEffect(() => {
    if (selectedGroupId === null) return;
    let alive = true;
    getSiteFxReference(guestCurrency).then(
      (found) => alive && setReference(found),
      () => alive && setReference(null),
    );
    return () => {
      alive = false;
    };
  }, [guestCurrency, selectedGroupId !== null]);

  // 换了报价（重新查价、改了附加服务）：下单的幂等键作废，报价过期的提示收起
  const pricedId = priced?.quote_id ?? null;
  useEffect(() => {
    orderKey.current = null;
    setExpired(false);
  }, [pricedId]);

  const tripCategory = draft.mode === "charter" ? "charter" : tripType === "point_to_point" ? "point_to_point" : "airport_transfer";
  const tripDirection = tripCategory === "airport_transfer" && (tripType === "pickup" || tripType === "dropoff") ? tripType : null;
  const orderTrip: OrderTrip = { transfer: tripCategory === "airport_transfer", arrival, ends: addressEnds(tripCategory, tripDirection) };

  const submitOrder = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (priced === null) {
      setContactNotice({
        kind: "danger",
        text:
          selected === null
            ? "请先选择车型。"
            : pricedState.kind === "unavailable"
              ? "这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。"
              : pricedState.kind === "failed"
                ? pricedState.message
                : "价格还在计算，请稍等再点「去付款」。",
      });
      return;
    }
    const form = { ...contact, flightNo: draft.flightNo, pickupAddress: draft.from?.name ?? "", dropoffAddress: draft.to?.name ?? "" };
    const found = validateOrderForm(form, orderTrip);
    setContactErrors(found);
    setErrors((value) => (found.flightNo !== undefined ? { ...value, flightNo: found.flightNo } : value));
    if (Object.keys(found).length > 0) {
      setContactNotice({ kind: "danger", text: found.flightNo !== undefined && Object.keys(found).length === 1 && wide ? "接机要填航班号，请在上面「你的行程」里填写。" : "有几项没有填好，请看标红的地方。" });
      return;
    }
    setContactNotice(null);
    orderKey.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const created = await createSiteOrder(orderRequestOf(priced.quote_id, form, orderTrip), orderKey.current);
      navigate(siteOrderUrl(created.link.token), { state: { placed: true, payment: created.payment } });
    } catch (err) {
      const failure = orderFailureOf(err);
      if (failure.kind === "expired") {
        setExpired(true);
        setContactNotice({ kind: "warning", text: failure.text });
      } else if (failure.kind === "fields") {
        setContactErrors(failure.errors);
        if (failure.errors.flightNo !== undefined) setErrors((value) => ({ ...value, flightNo: failure.errors.flightNo as string }));
        setContactNotice({ kind: "danger", text: failure.text });
      } else {
        setContactNotice({ kind: "danger", text: `${siteFailureText(err, "提交订单")}${failure.retrySafe ? "再点一次「去付款」不会重复下单。" : ""}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const requote = (): void => {
    setExpired(false);
    setContactNotice(null);
    setQuoteRound((value) => value + 1);
  };

  const updateContact = (changes: Partial<ContactForm>): void => {
    setContact((value) => ({ ...value, ...changes }));
    orderKey.current = null;
    setContactErrors((value) => {
      const next = { ...value };
      for (const key of Object.keys(changes)) delete next[key as keyof OrderErrors];
      return next;
    });
  };

  const update = useCallback((changes: Partial<TripDraft>): void => {
    setDraft((value) => ({ ...value, ...changes }));
    setNotice(null);
    orderKey.current = null;
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
      setFocusInvalid((value) => value + 1);
      return;
    }
    setNotice(null);
    setStep(2);
  };

  // 点「查看车型和价格」时有没填好的：焦点移到第一个标红的框（规范 10.1）
  const tripSectionRef = useRef<HTMLElement>(null);
  const [focusInvalid, setFocusInvalid] = useState(0);
  useEffect(() => {
    if (focusInvalid === 0) return;
    tripSectionRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusInvalid]);

  // 手机换步：到第 2 步把焦点放到「选择车型」，回第 1 步放到「你的行程」
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    if (wide) return;
    const target = step === 3 ? summaryHeading.current : step === 2 ? vehiclesHeading.current : tripHeading.current;
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
    const showStep3 = wide || step === 3;
    const timeLabel = arrival ? "航班落地时间（当地）" : draft.mode === "charter" ? "上车时间（当地）" : "用车时间（当地）";
    const tripName = draft.mode === "charter" ? "包车" : tripType !== null ? TRIP_TYPE_NAMES[tripType] : null;
    const whenText = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && /^\d{2}:\d{2}$/.test(draft.time) ? `${guestLocalText(`${draft.date}T${draft.time}`, timezone, new Date())}${arrival ? " 落地" : ""}` : null;

    const flightField = (
      <TextField
        label="航班号"
        size="lg"
        autoCapitalize="characters"
        value={draft.flightNo}
        errors={errors.flightNo ? [errors.flightNo] : []}
        hint={FIELD_HINTS.arrivalFlight}
        onChange={(event) => update({ flightNo: event.target.value })}
        onBlur={() => {
          const issue = validate(draft, charterCity, arrival).flightNo;
          if (issue !== undefined) setErrors((value) => ({ ...value, flightNo: issue }));
        }}
      />
    );

    const tripSection = (
      <section aria-labelledby="book-trip-title" className="site-section book-new__trip" ref={tripSectionRef}>
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
        <PlaceField
          key={`to-${draft.mode}`}
          label={draft.mode === "charter" ? "下车地点" : "目的地"}
          value={draft.to}
          onChange={(to) => update({ to })}
          {...(errors.to !== undefined ? { error: errors.to } : {})}
          {...(draft.mode === "charter" ? { hint: "包车结束时在哪里下车，价格按上车和下车地点算。" } : {})}
          {...(draft.mode === "charter" && legacyCharterLink && draft.to === null ? { info: "请选择下车地点，包车现在按上车和下车地点报价。" } : {})}
          tiles={tiles}
          mapCenter={centerOf(draft.from)}
          cities={centers}
        />
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
          {arrival && flightField}
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
      vehicles = <p className="site-muted">{draft.mode === "charter" ? "选好上车地点、下车地点、包车时长、日期和时间后，这里会列出能坐下的车型和价格。" : "填好出发地、目的地、日期和时间后，这里会列出能坐下的车型和一口价。"}</p>;
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
          <VehicleList
            key={current.key}
            quotes={quotes}
            limit={wide ? VISIBLE_VEHICLES.wide : VISIBLE_VEHICLES.narrow}
            selectedId={selected?.vehicle_group.id ?? null}
            onSelect={(entry) => {
              if (entry.vehicle_group.id !== selectedId) setAddonQuantities({});
              setSelectedId(entry.vehicle_group.id);
            }}
          />
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
          {tripName !== null && <span className="book-new__strip-type">{draft.mode === "charter" && draft.packageHours !== "" ? `包车 ${draft.packageHours} 小时` : tripName}</span>} {draft.from.name}
          {draft.to !== null ? ` → ${draft.to.name}` : ""}
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

    const routeResult = outcome?.mode === "transfer" ? outcome.result.route : null;
    const summaryInner = (
      <section className="site-section book-summary" aria-labelledby="book-summary-title">
        <h2 id="book-summary-title" ref={summaryHeading} tabIndex={-1} className="site-section__title">
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
          <div className="site-facts__item">
            <dt>{draft.mode === "charter" ? "下车地点" : "目的地"}</dt>
            <dd>{draft.to?.name ?? "—"}</dd>
          </div>
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
          {selected !== null && (
            <div className="site-facts__item">
              <dt>车型</dt>
              <dd lang={displayName(selected.vehicle_group.name).lang}>{displayName(selected.vehicle_group.name).text}</dd>
            </div>
          )}
        </dl>
        {draft.mode === "transfer" && draft.from !== null && draft.to !== null && <RouteBlock route={routeResult} tiles={tiles} from={draft.from} to={draft.to} />}
        {selected === null ? (
          <p className="site-muted">还没有选择车型</p>
        ) : (
          <>
            <AddonsBlock options={selected.available_addons} quantities={addonQuantities} onChange={(id, quantity) => setAddonQuantities((value) => ({ ...value, [id]: quantity }))} />
            <PriceBlock fare={selected.price.total} areaSurcharge={selected.includes_area_surcharge === true} priced={pricedState} currency={guestCurrency} onCurrency={(code) => setGuestCurrency(code as CurrencyCode)} reference={reference !== null && reference.to === guestCurrency ? reference : null} />
            <div className="book-summary__block">
              <h3 className="book-new__subtitle">取消规则</h3>
              <p>{guestCancelPolicyText((priced ?? selected).cancel_policy.tiers)}</p>
            </div>
            {wide && <PayBlock busy={busy} expired={expired} onRequote={requote} />}
          </>
        )}
      </section>
    );

    const contactSection = (
      <ContactSection
        form={contact}
        errors={contactErrors}
        notice={contactNotice}
        onChange={updateContact}
        onSubmit={(event) => void submitOrder(event)}
        {...(!wide && arrival ? { extra: flightField } : {})}
        {...(!wide ? { actions: <div className="site-actions"><PayBlock busy={busy} expired={expired} onRequote={requote} /></div> } : {})}
      />
    );

    const bar = !wide && step === 2 && selected !== null && (
      <div className="book-bar">
        <p className="book-bar__text">
          <span lang={displayName(selected.vehicle_group.name).lang}>{displayName(selected.vehicle_group.name).text}</span> · 一口价 <SitePrice text={moneyText(selected.price.total)} size="sm" />
        </p>
        <Button variant="primary" size="lg" onClick={() => setStep(3)}>
          下一步
        </Button>
      </div>
    );

    body = (
      <div className={bar ? "book-new book-new--with-bar" : "book-new"}>
        <div className="book-new__main">
          {showStep1 && tripSection}
          {showStep2 && vehicleSection}
          {!wide && step === 3 && (
            <>
              <Button variant="text" className="book-new__back" onClick={() => setStep(2)}>
                ← 返回选车型
              </Button>
              {summaryInner}
            </>
          )}
          {showStep3 && contactSection}
        </div>
        {wide && (
          <aside className="book-new__aside" aria-labelledby="book-summary-title">
            {summaryInner}
          </aside>
        )}
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

