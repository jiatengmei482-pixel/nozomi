/**
 * 新预订页 `/book/new`（M8-03 起；M8-27 改成四步，ADR 0079；规范 docs/design/pages/site-booking-v2.md）。
 *
 * 四步，每一步有自己的网址（`?step=2`），浏览器前进后退可用，换步不丢已填的内容；还没走到的步骤从网址打开时停在能到的最后一步：
 * 1. 行程：顶部「接送机 / 点对点 / 包车」三个标签；出发地、目的地（包车：上车地点、下车地点、套餐时长）、日期时间（接机是航班落地时间）、乘客和行李。
 *    接送机、点对点都按两个坐标报价（`POST /site/v1/quotes/by-points`，服务端认机场），标签只决定说法：选了接送机但两端都不是机场、
 *    选了点对点但有一端是机场时，一句提示 + 一键切到对的标签，不挡下一步。包车沿用现有询价（城市按上车点找最近的可订城市）。
 *    填齐了就在后台报价（停顿一下再查），到第 2 步时价格多半已经出来了。
 * 2. 车型和价格：现有车型列表、车内示意图、附加服务、「一口价包含」。报不出价时只有人工报价那一块（M8-21b）。
 * 3. 乘客信息：乘车人、邮箱、手机、接机的航班号（必填）和举牌姓名（选填，M8-32 起是订单的正式字段）、即时通讯、备注。字段和校验同旧下单页（`lib/site-order-form.ts`）。
 * 4. 核对并付款：前三步的内容各带「修改」回到那一步，车费合计和参考价、取消规则、同意保存银行卡、去付款（`POST /site/v1/orders`，下单后进现有订单页付款）。
 * 右侧栏（≥ 1024px）四步一直在：最上面路线图（M8-10 静态图，Leaflet 兜底），下面按步骤追加已确认的内容：行程 → 车型和一个价格 → 乘客信息。
 * 手机、平板（< 1024px）单栏，右侧栏变成顶部可展开的摘要条。
 * 链接参数 from / to / date / time / pax / bags / mode（parseBookingLink）：打开就预填并报价，齐了直接到第 2 步；不合法的只是不预填。
 * 四种状态：加载中（骨架）、官网没开 / 没有可订城市（空）、出错（说明 + 重试）、正常。页面上没有供应商、结算价、加价比例。
 */
import { type CityCandidate, type CurrencyCode, ORDER_FIELD_LIMITS, fixedPriceIncludes, fixedPriceIncludesTitle, fixedPriceLabel, isInternationalPhone, serviceCityOf } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  BOOK_STEPS,
  BOOK_TABS,
  BOOK_TAB_NAMES,
  type BookStep,
  type BookTab,
  type BookingLink,
  type LinkEnd,
  SIGN_NAME_MAX,
  type TripPoint,
  VISIBLE_VEHICLES,
  arrivalFreeWaitMinutes,
  bookStepOf,
  guestCurrencyOf,
  moneyDifference,
  notesWithExtras,
  parseBookingLink,
  pointName,
  rejectionTexts,
  searchWithStep,
  suggestionNames,
  travellersText,
} from "../../../lib/book-new.ts";
import { formatInZone, moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { CHARTER_OVERAGE_NOTE, UNAVAILABLE_REASON_TEXT, addressEnds, defaultServiceDate, guestCancelPolicyText, guestLocalText, newIdempotencyKey, quotesByTotal, siteDistanceNote, siteOrderUrl, sitePriceBasisNote } from "../../../lib/site-display.ts";
import { FIELD_HINTS, MESSAGING_NAMES, type OrderErrors, type OrderForm, type OrderTrip, orderFailureOf, orderRequestOf, validateOrderForm } from "../../../lib/site-order-form.ts";
import { useDocumentTitle } from "../../../lib/use-document-title.ts";
import { MANUAL_QUOTE_CHARTER_HOURS, type ManualQuoteTripDraft } from "../../../lib/manual-quote-form.ts";
import { ITINERARY_NOTE, type WaypointDraft, breakdownLines, durationText, itineraryPackageHours, itineraryRouteFailureText, itineraryText, scheduleRows, waypointErrors, waypointUnavailableTexts, waypointsBody } from "../../../lib/charter-itinerary.ts";
import { TripStops } from "../../../components/TripStops.tsx";
import { ManualQuoteBlock } from "../ManualQuote.tsx";
import { SiteLayout, siteFailureText, useSiteConfig } from "../SiteLayout.tsx";
import { SitePrice } from "../SitePrice.tsx";
import { AddonsBlock, CONTACT_FORM_ID, ConsentField, type ContactForm, ContactSection, PayBlock, PriceBlock, type PricedState, RouteBlock, emptyContact } from "./CheckoutParts.tsx";
import { PlaceField } from "./PlaceField.tsx";
import { PriceBreakdown } from "./PriceBreakdown.tsx";
import { WaypointsField } from "./WaypointsField.tsx";
import { PickerTextField } from "./full-screen.tsx";
import { TravellersField } from "./TravellersField.tsx";
import { VehicleList } from "./VehicleList.tsx";

/** 填齐后停顿多久再报价（毫秒）：连点 − + 时只报最后一次。 */
export const QUOTE_DEBOUNCE_MS = 400;

const WIDE_QUERY = "(min-width: 1024px)";

/** 电脑（≥ 1024px）两栏、右侧栏；手机和平板单栏、顶部摘要条。 */
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
  /** 第 1 步顶部的标签（M8-33：区间 / 包车）；`mode` 跟着它 */
  tab: BookTab;
  mode: BookMode;
  /** 接送：出发地；包车：上车地点 */
  from: TripPoint | null;
  /** 接送：目的地；包车：下车地点（M8-19 起必填） */
  to: TripPoint | null;
  date: string;
  time: string;
  passengers: number;
  luggage: number;
  /** 包车：套餐时长（小时）；有经停点时不用（按行程由服务端选） */
  packageHours: string;
  /** 包车：经停点（M9W-02），按顺序；有至少一个时按行程计价 */
  waypoints: WaypointDraft[];
  /** 接机：航班号（第 3 步填；下单时接机必填，和旧下单页同一条规则） */
  flightNo: string;
}

type Outcome = { mode: "transfer"; result: SiteByPointsResult } | { mode: "charter"; result: SiteQuoteResult; city: SiteCity };
type QuoteState = { kind: "idle" } | { kind: "loading"; key: string } | { kind: "ready"; key: string; outcome: Outcome } | { kind: "failed"; key: string; message: string; scope: boolean };
/** 加了附加服务的那次报价：所选车型的报价（没报出来为 null） */
type AddonQuoteState = { kind: "loading"; key: string } | { kind: "ready"; key: string; quote: SiteQuote | null } | { kind: "failed"; key: string; message: string };
type Load<T> = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; items: T };
type Errors = Partial<Record<"from" | "to" | "date" | "time" | "packageHours" | "waypoints", string>>;

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
    // 经停点（M9W-02）：有没填好的不报价；至少一个时按行程计价（服务端选套餐，不给 package_hours）；一个都没有时请求和以前完全一样
    const stops = waypointsBody(draft.waypoints);
    if (stops === null) return null;
    const itinerary = stops.length > 0;
    if (charterCity === null || (!itinerary && draft.packageHours === "") || draft.to === null) return null;
    const body: SiteQuoteRequest = { category: "charter", city_id: charterCity.id, pickup: { lat: draft.from.lat, lng: draft.from.lng }, dropoff: { lat: draft.to.lat, lng: draft.to.lng }, ...(itinerary ? { itinerary_pricing: true, waypoints: stops } : { package_hours: Number(draft.packageHours) }), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage, ...(addons.length > 0 ? { addons: [...addons] } : {}), ...suggestionNames(draft.from, draft.to) };
    return { key: JSON.stringify(body), run: async () => ({ mode: "charter", result: await createSiteQuotes(body), city: charterCity }) };
  }
  if (draft.to === null) return null;
  const body: SiteByPointsRequest = { pickup: end(draft.from), dropoff: end(draft.to), service_local: serviceLocal, passengers: draft.passengers, luggage: draft.luggage, ...(addons.length > 0 ? { addons: [...addons] } : {}), ...suggestionNames(draft.from, draft.to) };
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
  const tab = link.mode ?? "transfer";
  return { tab, mode: tab === "charter" ? "charter" : "transfer", from: null, to: null, date: link.date ?? "", time: link.time ?? "", passengers: link.passengers ?? 2, luggage: link.luggage ?? link.passengers ?? 2, packageHours: "", waypoints: [], flightNo: "" };
}

/** 第 1 步「下一步」前的检查（航班号在第 3 步查）。 */
function validate(draft: TripDraft, charterCity: SiteCity | null): Errors {
  const errors: Errors = {};
  if (draft.from === null) errors.from = draft.mode === "charter" ? "请从候选里选上车地点" : "请从候选里选出发地";
  else if (draft.mode === "charter" && charterCity === null) errors.from = "这个地址暂时没有在线报价，请联系客服";
  if (draft.to === null) errors.to = draft.mode === "charter" ? "请选择下车地点" : "请从候选里选目的地";
  if (draft.mode === "charter" && charterCity !== null && draft.waypoints.length === 0 && draft.packageHours === "") errors.packageHours = "请选择包车时长";
  if (draft.mode === "charter" && Object.keys(waypointErrors(draft.waypoints)).length > 0) errors.waypoints = "请把经停点填完整";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "请选择日期";
  if (!/^\d{2}:\d{2}$/.test(draft.time)) errors.time = "请选择时间";
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
  /** 点过「下一步」而经停点没填完整：之后每一行的问题随改随显示 */
  const [waypointCheck, setWaypointCheck] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
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
  const [riderErrors, setRiderErrors] = useState<Partial<Record<"riderName" | "riderPhone", string>>>({});
  const [contactNotice, setContactNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const orderKey = useRef<string | null>(null);
  const navigate = useNavigate();
  const vehiclesHeading = useRef<HTMLHeadingElement>(null);
  const contactHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const tripHeading = useRef<HTMLHeadingElement>(null);
  const urlStep = bookStepOf(location.search);
  const latestSearch = useRef(location.search);
  latestSearch.current = location.search;
  /** 链接里的地点还在读：读完以前不按「能到哪一步」改网址 */
  const [linkPending, setLinkPending] = useState(link.from !== null || link.to !== null);
  /** 换步：网址加一条历史记录（浏览器后退回到上一步），其余参数原样保留 */
  const goStep = useCallback(
    (next: BookStep, replace = false): void => {
      void navigate({ pathname: location.pathname, search: searchWithStep(location.search, next) }, { replace });
    },
    [location.pathname, location.search, navigate],
  );

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

  // 链接预填（只在打开时一次）：两端都有、日期时间也有时直接报价并到第 2 步（网址里已经写了第几步的不动）
  const linkDone = useRef(false);
  useEffect(() => {
    if (cities.kind !== "ready" || linkDone.current) return;
    linkDone.current = true;
    if (link.from === null && link.to === null) return;
    let alive = true;
    void Promise.all([resolveLinkEnd(link.from), resolveLinkEnd(link.to)]).then(([fromEnd, toEnd]) => {
      if (!alive) return;
      setLinkPending(false);
      const from = fromEnd?.kind === "point" ? fromEnd.point : null;
      const to = toEnd?.kind === "point" ? toEnd.point : null;
      setDraft((current) => ({ ...current, from: current.from ?? from, to: current.to ?? to }));
      const text = linkNotice([fromEnd, toEnd], link.mode === "charter" ? "charter" : "transfer");
      if (text !== null) setNotice({ kind: "warning", text });
      else if (from !== null && to !== null && link.date !== null && link.time !== null && new URLSearchParams(latestSearch.current).get("step") === null) goStep(2, true);
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
          // 按行程计价有一段路线算不出来（M9W-01）：和报不出价一样转人工，说清是哪一段
          const routeFailed = err instanceof ApiError && err.code === "ITINERARY_ROUTE_UNAVAILABLE";
          const points = [draft.from?.name ?? "上车地点", ...draft.waypoints.map((entry, index) => entry.point?.name ?? `第 ${index + 1} 个经停点`), draft.to?.name ?? "下车地点"];
          setQuote({ kind: "failed", key: current.key, scope: scope || routeFailed, message: scope ? "这个地址暂时没有在线报价，请联系客服" : routeFailed ? itineraryRouteFailureText(err.details["leg"], points) : siteFailureText(err, "查询价格") });
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
  // 免费等待（M8-33）：有报价按所选商品自己设的；接机还没有报价时按机场国际 90 / 国内 60 分钟
  const quotedForWait = selected ?? quotes[0] ?? null;
  const flightScope = outcome?.mode === "transfer" ? (outcome.result.airport?.flight_scope ?? null) : null;
  const freeWait = arrival ? arrivalFreeWaitMinutes(quotedForWait, flightScope) : (quotedForWait?.free_wait_minutes ?? null);
  const timezone = outcome?.mode === "charter" ? outcome.city.timezone : (outcome?.result.city?.timezone ?? firstCity?.timezone ?? "Asia/Tokyo");
  const cityName = outcome?.mode === "charter" ? displayName(outcome.city.name).text : outcome?.result.city ? displayName(outcome.result.city.name).text : null;
  // 包车按行程计价（M9W-02）：有经停点时套餐由服务端按行程选，明细、时间表按这一次报价
  const itinerary = draft.mode === "charter" && draft.waypoints.length > 0;
  const stops = itinerary ? (waypointsBody(draft.waypoints) ?? []) : [];
  const charterResult = outcome?.mode === "charter" ? outcome.result : null;
  const itineraryPackage = itinerary && charterResult !== null ? itineraryPackageHours(selected ?? quotes[0] ?? null) : null;
  const itinerarySummary = itinerary && charterResult !== null ? itineraryText(charterResult.itinerary_route, itineraryPackage) : null;
  const schedule = itinerary && draft.from !== null ? scheduleRows(draft.from.name, draft.to?.name ?? null, stops, charterResult?.itinerary_route?.legs ?? null) : null;

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

  // 换了行程后新报价里没有原来选的车型：清掉选择（不能带着看不见的车型走到第 3、4 步）
  useEffect(() => {
    if (outcome !== null && selectedId !== null && !quotes.some((entry) => entry.vehicle_group.id === selectedId)) setSelectedId(null);
  }, [outcome, selectedId]);

  const tripCategory = draft.mode === "charter" ? "charter" : tripType === "point_to_point" ? "point_to_point" : "airport_transfer";
  const tripDirection = tripCategory === "airport_transfer" && (tripType === "pickup" || tripType === "dropoff") ? tripType : null;
  // 认出机场但用点对点商品报的价（M8-33，ADR 0081）：页面照样按接送机（航班号、免费等待、举牌），
  // 下单按点对点：两端地址都要，航班号写进备注（点对点订单不收 flight_no）
  const p2pFallback = tripCategory === "airport_transfer" && outcome?.mode === "transfer" && outcome.result.fallback_category === "point_to_point";
  const orderTrip: OrderTrip = p2pFallback
    ? { transfer: true, arrival, ends: addressEnds("point_to_point", null), flightInNotes: true }
    : { transfer: tripCategory === "airport_transfer", arrival, ends: addressEnds(tripCategory, tripDirection) };

  /** 举牌姓名：客人没改过时跟着乘车人（为自己是预订人，为他人是乘车人）的名字 */
  const signName = contact.signEdited ? contact.signName : contact.forOther ? contact.riderName : contact.name;
  /** 下单用的表单：举牌姓名（接机）、乘车人（为他人）是正式字段（M8-32）；地址取行程里的名称 */
  const orderForm = (): OrderForm => ({
    ...contact,
    rider: { signName: arrival ? signName : "", name: contact.forOther ? contact.riderName : "", phone: contact.forOther ? contact.riderPhone : "" },
    notes: notesWithExtras(p2pFallback ? { flightNo: draft.flightNo } : {}, contact.notes),
    flightNo: draft.flightNo,
    pickupAddress: draft.from?.name ?? "",
    dropoffAddress: draft.to?.name ?? "",
  });

  /** 第 3 步的检查（不含第 4 步的「同意保存银行卡」） */
  const contactIssues = (): OrderErrors => {
    const found = validateOrderForm(orderForm(), orderTrip);
    delete found.consent;
    if (found.notes === undefined && orderForm().notes.length > ORDER_FIELD_LIMITS.notesMax) found.notes = `${p2pFallback ? "航班号和备注加起来" : "备注"}最多 ${ORDER_FIELD_LIMITS.notesMax} 个字，请删短一些。`;
    return found;
  };

  /** 为他人预订：乘车人姓名、电话 / WhatsApp 都要填 */
  const riderIssues = (): Partial<Record<"riderName" | "riderPhone", string>> => {
    if (!contact.forOther) return {};
    return {
      ...(contact.riderName.trim() === "" ? { riderName: "请填写乘车人姓名" } : {}),
      // 和后端同一条规则（isInternationalPhone）：本地号码在这一步就拦下，不要到付款时才被退回
      ...(!isInternationalPhone(contact.riderPhone) ? { riderPhone: "请填写乘车人的电话或 WhatsApp 号码，以 + 和国家码开头，如 +81 90-1234-5678" } : {}),
    };
  };

  const confirmContact = (event: FormEvent): void => {
    event.preventDefault();
    const found = contactIssues();
    const riders = riderIssues();
    setContactErrors(found);
    setRiderErrors(riders);
    if (Object.keys(found).length > 0 || Object.keys(riders).length > 0) {
      setContactNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      return;
    }
    setContactNotice(null);
    setContactConfirmed(true);
    goStep(4);
  };

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
    const issues = contactIssues();
    if (Object.keys(issues).length > 0 || Object.keys(riderIssues()).length > 0) {
      setContactErrors(issues);
      setRiderErrors(riderIssues());
      setContactConfirmed(false);
      setContactNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      goStep(3);
      return;
    }
    if (!contact.consent) {
      setContactErrors({ consent: "需要同意保存支付方式才能下单" });
      setContactNotice({ kind: "danger", text: "请先勾选同意保存银行卡，再点「去付款」。" });
      return;
    }
    setContactErrors({});
    setContactNotice(null);
    orderKey.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const created = await createSiteOrder(orderRequestOf(priced.quote_id, orderForm(), orderTrip), orderKey.current);
      navigate(siteOrderUrl(created.link.token), { state: { placed: true, payment: created.payment } });
    } catch (err) {
      const failure = orderFailureOf(err);
      if (failure.kind === "expired") {
        setExpired(true);
        setContactNotice({ kind: "warning", text: failure.text });
      } else if (failure.kind === "fields") {
        setContactErrors(failure.errors);
        setRiderErrors(failure.riderErrors);
        setContactNotice({ kind: "danger", text: failure.text });
        // 乘客信息或乘车人那几栏被后端退回：回到第 3 步标红（只有「同意保存」时留在这一步）
        if (Object.keys(failure.errors).some((key) => key !== "consent") || Object.keys(failure.riderErrors).length > 0) {
          setContactConfirmed(false);
          goStep(3);
        }
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
    setRiderErrors((value) => {
      const next = { ...value };
      if ("riderName" in changes) delete next.riderName;
      if ("riderPhone" in changes) delete next.riderPhone;
      return next;
    });
    setContactErrors((value) => {
      const next = { ...value };
      for (const key of Object.keys(changes)) delete next[key as keyof OrderErrors];
      if ("signName" in changes || "riderName" in changes || "riderPhone" in changes) delete next.notes;
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

  /** 换标签（区间 ↔ 包车）：套餐时长清空 */
  const chooseTab = (tab: BookTab): void => {
    const mode: BookMode = tab === "charter" ? "charter" : "transfer";
    update(mode === draft.mode ? { tab } : { tab, mode, packageHours: "" });
  };

  // 第 1 步「下一步」有没填好的：焦点移到第一个标红的框（规范 10.1）
  const tripSectionRef = useRef<HTMLElement>(null);
  const [focusInvalid, setFocusInvalid] = useState(0);
  useEffect(() => {
    if (focusInvalid === 0) return;
    tripSectionRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusInvalid]);

  const showVehicles = (): void => {
    const found = validate(draft, charterCity);
    setErrors(found);
    if (found.waypoints !== undefined) setWaypointCheck(true);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      setFocusInvalid((value) => value + 1);
      return;
    }
    setNotice(null);
    goStep(2);
  };

  const supportPhone = config.kind === "ready" ? config.config.support_phone : null;
  const supportWhatsapp = config.kind === "ready" ? config.config.support_whatsapp : null;
  // 报不出价时「请客服人工报价」带上的行程（M8-21）：用车类型按识别结果，认不出时看两端有没有机场
  // 包车的经停点（M9W-04）：都填好了才带上（有没填完的一个都不带，和询价一样），按页面上的顺序
  const manualStops = draft.mode === "charter" ? (waypointsBody(draft.waypoints) ?? []).map((stop) => ({ name: stop.name, lat: stop.lat, lng: stop.lng, stayMinutes: stop.stay_minutes })) : [];
  const manualTrip: ManualQuoteTripDraft = {
    category: draft.mode === "charter" ? "charter" : tripType === "point_to_point" ? "point_to_point" : tripType !== null || draft.from?.kind === "airport" || draft.to?.kind === "airport" ? "airport_transfer" : "point_to_point",
    cityId: draft.mode === "charter" ? (charterCity?.id ?? null) : outcome?.mode === "transfer" ? (outcome.result.city?.id ?? null) : null,
    pickup: draft.from === null ? null : { name: draft.from.name, lat: draft.from.lat, lng: draft.from.lng },
    dropoff: draft.to === null ? null : { name: draft.to.name, lat: draft.to.lat, lng: draft.to.lng },
    serviceLocal: /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && /^\d{2}:\d{2}$/.test(draft.time) ? `${draft.date}T${draft.time}` : null,
    passengers: draft.passengers,
    luggage: draft.luggage,
    // 有经停点时按行程计价，页面不用包车时长（下拉换成「按行程自动选套餐」），也就不带上（M9W-04）
    packageHours: draft.mode === "charter" && manualStops.length === 0 && /^\d+$/.test(draft.packageHours) ? Number(draft.packageHours) : null,
    waypoints: manualStops,
  };
  const manualKey = JSON.stringify(manualTrip);
  /** 包车报不出价（上车地点不在任何能订包车的城市、或城市没有套餐）：时长用通用的几档，给人工报价用 */
  const charterNoOnline = draft.mode === "charter" && draft.from !== null && (charterCity === null || (packageLoad?.kind === "ready" && packageLoad.items.length === 0));
  /**
   * 报不出价（任何一种：包车没有在线报价、渠道不卖这一段、报价列表为空）时只给人工报价那一块，
   * 不能往第 3、4 步走（M8-21b，规范 site-booking-v2.md 11.1）；有报价时照旧。
   */
  const manualOnly = charterNoOnline || (current?.kind === "failed" && current.scope) || (current?.kind === "ready" && quotes.length === 0);

  // 现在显示第几步：网址要的那一步，但不超过已经能到的那一步（还没填好的步骤从网址、前进键打开时停在能到的最后一步）
  const tripReady = cities.kind === "ready" && Object.keys(validate(draft, charterCity)).length === 0;
  const reachable: BookStep = !tripReady ? 1 : selectedId === null || manualOnly ? 2 : !contactConfirmed ? 3 : 4;
  const step = Math.min(urlStep, reachable) as BookStep;
  // 网址要的步骤还到不了（从网址、前进键打开；或报价变了车型没了）：网址改成能到的那一步，不在后面自己跳过去
  useEffect(() => {
    // 包车时长还在读（只有一种时会替客人选上）：读完再算能到哪一步
    const packagesPending = draft.mode === "charter" && charterCity !== null && packageLoad?.kind !== "ready" && packageLoad?.kind !== "failed";
    if (cities.kind === "ready" && !linkPending && !packagesPending && urlStep > reachable) goStep(reachable, true);
  }, [cities.kind, linkPending, urlStep, reachable, packageLoad?.kind]);

  // 换步：焦点移到那一步的标题（第一次打开不动）
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const target = [tripHeading, vehiclesHeading, contactHeading, reviewHeading][step - 1]?.current ?? null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [step]);

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
    // 区间：城市能订接送机或点对点就有；包车：能订包车
    const tabs = BOOK_TABS.filter((tab) => cityList.some((city) => (tab === "charter" ? city.categories.includes("charter") : city.categories.includes("airport_transfer") || city.categories.includes("point_to_point"))));
    const charter = draft.mode === "charter";
    const timeLabel = arrival ? "航班落地时间（当地）" : charter ? "上车时间（当地）" : "用车时间（当地）";
    const tripName = charter ? (itinerary ? (itineraryPackage !== null ? `包车 ${itineraryPackage} 小时（按行程）` : "包车（按行程）") : draft.packageHours !== "" ? `包车 ${draft.packageHours} 小时` : "包车") : tripType !== null ? TRIP_TYPE_NAMES[tripType] : BOOK_TAB_NAMES[draft.tab];
    const whenText = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && /^\d{2}:\d{2}$/.test(draft.time) ? `${guestLocalText(`${draft.date}T${draft.time}`, timezone, new Date())}${arrival ? " 落地" : ""}` : null;
    const vehicleName = selected === null ? null : displayName(selected.vehicle_group.name);
    const kmNote = selected === null ? null : siteDistanceNote(selected.distance);

    const stepper = (
      <ol className="book-steps" aria-label="预订步骤">
        {BOOK_STEPS.map((name, index) => {
          const number = (index + 1) as BookStep;
          const label = (
            <>
              <span className="book-steps__number" aria-hidden="true">
                {number < step ? <Icon name="check" /> : number}
              </span>
              <span className="book-steps__name">{name}</span>
            </>
          );
          return (
            <li key={name} className={number === step ? "book-steps__item book-steps__item--current" : number < step ? "book-steps__item book-steps__item--done" : "book-steps__item"} aria-current={number === step ? "step" : undefined}>
              {number < step ? (
                <button type="button" className="book-steps__link" aria-label={`第 ${number} 步：${name}（已完成，回到这一步）`} onClick={() => goStep(number)}>
                  {label}
                </button>
              ) : (
                <span className="book-steps__link" aria-label={`第 ${number} 步：${name}${number === step ? "（当前）" : ""}`}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    );

    const tripSection = (
      <section aria-labelledby="book-trip-title" className="site-section book-new__trip" ref={tripSectionRef}>
        <h2 id="book-trip-title" ref={tripHeading} tabIndex={-1} className="site-section__title">
          你的行程
        </h2>
        <AlertSlot notice={notice} />
        {tabs.length > 1 && (
          <fieldset className={`book-mode book-mode--${tabs.length}`}>
            <legend className="visually-hidden">用车类型</legend>
            {tabs.map((tab) => (
              <label key={tab} className={draft.tab === tab ? "book-mode__option book-mode__option--checked" : "book-mode__option"}>
                <input type="radio" name="book-mode" className="book-mode__input" checked={draft.tab === tab} onChange={() => chooseTab(tab)} />
                {BOOK_TAB_NAMES[tab]}
              </label>
            ))}
          </fieldset>
        )}
        <PlaceField
          key={`from-${draft.mode}`}
          label={charter ? "上车地点" : "出发地"}
          value={draft.from}
          onChange={(from) => update({ from })}
          {...(errors.from !== undefined ? { error: errors.from } : {})}
          tiles={tiles}
          mapCenter={centerOf(draft.to)}
          cities={centers}
        />
        {charter && (
          <WaypointsField
            value={draft.waypoints}
            onChange={(waypoints) => update({ waypoints })}
            errors={waypointCheck ? waypointErrors(draft.waypoints) : {}}
            tiles={tiles}
            mapCenter={centerOf(draft.from)}
            cities={centers}
          />
        )}
        <PlaceField
          key={`to-${draft.mode}`}
          label={charter ? "下车地点" : "目的地"}
          value={draft.to}
          onChange={(to) => update({ to })}
          {...(errors.to !== undefined ? { error: errors.to } : {})}
          {...(charter ? { hint: "包车结束时在哪里下车，价格按上车和下车地点算。" } : {})}
          {...(charter && legacyCharterLink && draft.to === null ? { info: "请选择下车地点，包车现在按上车和下车地点报价。" } : {})}
          tiles={tiles}
          mapCenter={centerOf(draft.from)}
          cities={centers}
        />
        {charter && draft.from !== null && charterCity === null && (
          <div className="book-new__notice" role="status">
            <p>这个地址暂时没有在线报价，请联系客服</p>
            <SupportPhone phone={supportPhone} />
          </div>
        )}
        {charter && charterCity !== null && packageLoad?.kind === "ready" && packageLoad.items.length === 0 && (
          <div className="book-new__notice" role="status">
            <p>这个城市的包车还没有可以在线预订的套餐，请联系客服</p>
            <SupportPhone phone={supportPhone} />
          </div>
        )}
        {charterNoOnline && (
          <SelectField
            label="包车时长"
            placeholder="请选择大概的时长"
            value={draft.packageHours}
            options={MANUAL_QUOTE_CHARTER_HOURS.map((hours) => ({ value: String(hours), label: `${hours} 小时` }))}
            hint="没有在线报价时，选一个大概的时长，客服报价时会和您确认"
            onChange={(packageHours) => update({ packageHours })}
          />
        )}
        {charter && charterCity !== null && !charterNoOnline && itinerary && (
          <div className="book-itinerary" role="status">
            <p>
              <strong>包车时长：按行程自动选套餐</strong>
            </p>
            <p className="site-muted">{itinerarySummary ?? "有经停点时，按各段行驶时间和停留时长算出总时长，自动选合适的套餐。"}</p>
          </div>
        )}
        {charter &&
          charterCity !== null &&
          !charterNoOnline &&
          !itinerary &&
          (packageLoad?.kind === "failed" ? (
            <StateBlock headingLevel="h3" title="包车时长没有读出来" description={packageLoad.message} action={<Button size="lg" onClick={() => setPackages(null)}>重试</Button>} />
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
          {/* 手机触屏上日期、时间也是全屏选择页（M8-37），电脑上是输入框 */}
          <PickerTextField label="日期（当地）" type="date" value={draft.date} errors={errors.date ? [errors.date] : []} onValue={(date) => update({ date })} />
          <PickerTextField label={timeLabel} type="time" value={draft.time} errors={errors.time ? [errors.time] : []} {...(cityName !== null ? { hint: `${cityName}的当地时间` } : {})} onValue={(time) => update({ time })} />
        </div>
        {arrival && (
          <p className="book-new__arrival" role="status">
            <Icon name="info" />
            <span>{freeWait !== null && freeWait > 0 ? `已识别为接机：司机按航班落地时间等候，落地后免费等待 ${freeWait} 分钟` : "已识别为接机：司机按航班落地时间等候"}</span>
          </p>
        )}
        <TravellersField passengers={draft.passengers} luggage={draft.luggage} onChange={(value) => update(value)} />
        {charterNoOnline && <ManualQuoteBlock key={manualKey} trip={manualTrip} supportWhatsapp={supportWhatsapp} />}
        {!charterNoOnline && (
          <div className="book-new__actions">
            <Button variant="primary" size="lg" block={!wide} onClick={showVehicles}>
              下一步：选择车型
            </Button>
          </div>
        )}
      </section>
    );

    let vehicles;
    if (current === null) {
      vehicles = <p className="site-muted">{charter ? "选好上车地点、下车地点、包车时长、日期和时间后，这里会列出能坐下的车型和价格。" : "填好出发地、目的地、日期和时间后，这里会列出能坐下的车型和一口价。"}</p>;
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
      if (current.scope) {
        vehicles = (
          <>
            {vehicles}
            <ManualQuoteBlock key={manualKey} trip={manualTrip} supportWhatsapp={supportWhatsapp} />
          </>
        );
      }
    } else if (quotes.length === 0) {
      const unavailable = outcome?.result.unavailable ?? [];
      const rejected = rejectionTexts(unavailable.flatMap((entry) => entry.reasons));
      // 经停点报不出价（M9W-02）：指出是第几个经停点，代替笼统的那一句
      const stopTexts = itinerary ? waypointUnavailableTexts(unavailable, stops) : [];
      const texts = stopTexts.length > 0 ? [...stopTexts, ...rejected.texts.filter((text) => text !== UNAVAILABLE_REASON_TEXT.WAYPOINT_NOT_PRICED)] : rejected.texts;
      const support = rejected.support || stopTexts.length > 0;
      vehicles = (
        <>
          <div className="book-new__rejected" role="status">
            <h3 className="book-new__subtitle">没有可预订的车</h3>
            <ul className="site-reasons">
              {texts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {support && <SupportPhone phone={supportPhone} />}
          </div>
          <ManualQuoteBlock key={manualKey} trip={manualTrip} supportWhatsapp={supportWhatsapp} />
        </>
      );
    } else {
      const expires = quotes.map((entry) => entry.expires_at).sort()[0] ?? null;
      // M8-40：按里程计价的不是一口价——选中的车是按里程计价的，或还没选、列表里有按里程计价的，就换说法（这句对一口价也成立）
      const basis = (selected === null ? quotes.some((entry) => entry.pricing_basis === "distance_only") : selected.pricing_basis === "distance_only") ? "distance_only" : null;
      const includes = fixedPriceIncludes({ service: charter ? "charter" : "transfer", arrival, freeWaitMinutes: freeWait, meetAndGreet: false, pricingBasis: basis });
      vehicles = (
        <>
          <p className="site-muted">
            按价格从低到高 · 坐不下的已隐藏。报价 30 分钟内有效（到当地时间 {formatInZone(expires, timezone).slice(11)}），过了请重新查询。
          </p>
          {itinerary && schedule !== null && (
            <section aria-labelledby="book-itinerary-title" className="book-itinerary">
              <h3 id="book-itinerary-title" className="book-new__subtitle">
                行程时间表
              </h3>
              {itinerarySummary !== null && <p>{itinerarySummary}</p>}
              <TripStops rows={schedule} />
              <p className="price-breakdown__note">{ITINERARY_NOTE}</p>
            </section>
          )}
          <VehicleList
            {...(itinerary ? { breakdownOf: (entry: SiteQuote) => breakdownLines(entry, itineraryPackageHours(entry)) } : {})}
            key={current.key}
            quotes={quotes}
            limit={wide ? VISIBLE_VEHICLES.wide : VISIBLE_VEHICLES.narrow}
            selectedId={selected?.vehicle_group.id ?? null}
            onSelect={(entry) => {
              if (entry.vehicle_group.id !== selectedId) setAddonQuantities({});
              setSelectedId(entry.vehicle_group.id);
            }}
          />
          {selected !== null && <AddonsBlock options={selected.available_addons} quantities={addonQuantities} onChange={(id, quantity) => setAddonQuantities((value) => ({ ...value, [id]: quantity }))} />}
          <section aria-labelledby="book-includes-title" className="book-includes">
            <h3 id="book-includes-title" className="book-new__subtitle">
              {fixedPriceIncludesTitle(basis)}
            </h3>
            <ul className="book-includes__list">
              {includes.map((item) => (
                <li key={item.key} className="book-includes__item">
                  <Icon name="check" className="book-includes__icon" />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
            {charter && <p className="site-muted">{CHARTER_OVERAGE_NOTE}</p>}
          </section>
        </>
      );
    }

    const vehicleSection = (
      <section aria-labelledby="book-vehicles-title" className="site-section book-new__vehicles">
        <h2 id="book-vehicles-title" ref={vehiclesHeading} tabIndex={-1} className="site-section__title">
          选择车型
        </h2>
        {vehicles}
        <div className="book-new__actions">
          <Button size="lg" onClick={() => goStep(1)}>
            上一步
          </Button>
          {wide && !manualOnly && (
            <Button variant="primary" size="lg" disabled={selected === null} onClick={() => goStep(3)}>
              下一步：填写乘客信息
            </Button>
          )}
        </div>
      </section>
    );

    const flightFields = arrival && (
      <div className="site-form__row">
        <TextField
          label="航班号"
          size="lg"
          required
          autoCapitalize="characters"
          value={draft.flightNo}
          errors={contactErrors.flightNo ? [contactErrors.flightNo] : []}
          hint={FIELD_HINTS.arrivalFlight}
          onChange={(event) => {
            setDraft((value) => ({ ...value, flightNo: event.target.value }));
            orderKey.current = null;
            setContactErrors(({ flightNo: _, ...rest }) => rest);
          }}
        />
        <TextField label="举牌姓名（选填）" size="lg" maxLength={SIGN_NAME_MAX} value={signName} hint="司机在到达口举的牌子上写的名字，如 ZHANG SAN" onChange={(event) => updateContact({ signName: event.target.value, signEdited: true })} />
      </div>
    );

    const contactSection = (
      <ContactSection
        form={contact}
        errors={contactErrors}
        notice={contactNotice}
        onChange={(changes) => {
          updateContact(changes);
          setContactConfirmed(false);
        }}
        onSubmit={confirmContact}
        headingRef={contactHeading}
        riderErrors={riderErrors}
        {...(flightFields ? { extra: flightFields } : {})}
        actions={
          <div className="book-new__actions">
            <Button size="lg" onClick={() => goStep(2)}>
              上一步
            </Button>
            <Button type="submit" variant="primary" size="lg">
              下一步：核对订单
            </Button>
          </div>
        }
      />
    );

    const tripFacts = (
      <dl className="book-summary__facts">
        <div className="site-facts__item">
          <dt>用车类型</dt>
          <dd>{tripName}</dd>
        </div>
        <div className="site-facts__item">
          <dt>{charter ? "上车地点" : "出发地"}</dt>
          <dd>{draft.from?.name ?? "—"}</dd>
        </div>
        {charter && schedule !== null && (
          <div className="site-facts__item">
            <dt>经停点</dt>
            <dd>
              <ol className="book-summary__stops">
                {stops.map((stop, index) => (
                  <li key={`${index}-${stop.name}`}>
                    {stop.name}（停留 {durationText(stop.stay_minutes)}）
                  </li>
                ))}
              </ol>
            </dd>
          </div>
        )}
        <div className="site-facts__item">
          <dt>{charter ? "下车地点" : "目的地"}</dt>
          <dd>{draft.to?.name ?? "—"}</dd>
        </div>
        {charter && itinerarySummary !== null && (
          <div className="site-facts__item">
            <dt>行程时长</dt>
            <dd>{itinerarySummary}</dd>
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
      </dl>
    );

    const passengerFacts = (
      <dl className="book-summary__facts">
        <div className="site-facts__item">
          <dt>{contact.forOther ? "预订人" : "乘车人"}</dt>
          <dd>{contact.name.trim()}</dd>
        </div>
        <div className="site-facts__item">
          <dt>邮箱</dt>
          <dd className="book-summary__wrap">{contact.email.trim()}</dd>
        </div>
        <div className="site-facts__item">
          <dt>手机号</dt>
          <dd>{contact.phone.trim()}</dd>
        </div>
        {arrival && (
          <div className="site-facts__item">
            <dt>航班号</dt>
            <dd>{draft.flightNo.trim().toUpperCase()}</dd>
          </div>
        )}
        {contact.forOther && (
          <>
            <div className="site-facts__item">
              <dt>乘车人</dt>
              <dd>{contact.riderName.trim()}</dd>
            </div>
            <div className="site-facts__item">
              <dt>乘车人电话/WhatsApp</dt>
              <dd>{contact.riderPhone.trim()}</dd>
            </div>
          </>
        )}
        {arrival && signName.trim() !== "" && (
          <div className="site-facts__item">
            <dt>举牌姓名</dt>
            <dd>{signName.trim()}</dd>
          </div>
        )}
        {contact.messagingApp !== "" && (
          <div className="site-facts__item">
            <dt>{MESSAGING_NAMES[contact.messagingApp]}</dt>
            <dd>{contact.messagingHandle.trim()}</dd>
          </div>
        )}
        {contact.notes.trim() !== "" && (
          <div className="site-facts__item">
            <dt>给司机的备注</dt>
            <dd className="book-summary__wrap">{contact.notes.trim()}</dd>
          </div>
        )}
      </dl>
    );

    /** 包车按行程计价（M9W-02）：下单用的那一次报价的对外价明细 + 提示；明细对不上总价时只有提示 */
    const pricedForBreakdown = priced ?? (addonList.length === 0 ? selected : null);
    const itineraryPrice = itinerary && pricedForBreakdown !== null && <PriceBreakdown lines={breakdownLines(pricedForBreakdown, itineraryPackageHours(pricedForBreakdown))} total={moneyText(pricedForBreakdown.price.total)} />;

    /** 侧栏里的车型和一个价格（第 2 步选了车型就出现）：合计（加了附加服务是带附加服务的那一次），下面含公里数、计价说明（含区域加价 / 含里程费 / 按里程计价） */
    const sidePrice = selected !== null && vehicleName !== null && (
      <div className="book-summary__block">
        <h3 className="book-new__subtitle">车型和价格</h3>
        <p className="book-summary__vehicle-name" lang={vehicleName.lang}>
          {vehicleName.text}
        </p>
        <p className="book-summary__price">
          {pricedState.kind === "ready" && <SitePrice text={moneyText(pricedState.total)} size="lg" />}
          {pricedState.kind === "loading" && <span className="site-muted">正在重新计算…</span>}
          {pricedState.kind === "unavailable" && <span>这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。</span>}
          {pricedState.kind === "failed" && <span>{pricedState.message}</span>}
        </p>
        {sitePriceBasisNote(selected) !== null && <p className="book-summary__note">{sitePriceBasisNote(selected)}</p>}
        {kmNote !== null && <p className="book-summary__note">{kmNote}</p>}
        {itineraryPrice}
      </div>
    );

    const routeResult = outcome?.mode === "transfer" ? outcome.result.route : null;
    const routeBlock = draft.mode === "transfer" && draft.from !== null && draft.to !== null ? <RouteBlock route={routeResult} tiles={tiles} from={draft.from} to={draft.to} lockedMeters={selected?.distance?.route_meters ?? null} /> : null;
    /** 右侧栏 / 摘要条的内容：路线图在最上面，下面按步骤追加已经确认的内容 */
    const summaryContent = (
      <>
        {routeBlock}
        {step === 1 && <p className="site-muted">每确认一步，这里会加上那一步的内容。</p>}
        {step > 1 && (
          <div className="book-summary__block">
            <h3 className="book-new__subtitle">行程</h3>
            {tripFacts}
          </div>
        )}
        {step > 1 && sidePrice}
        {step > 3 && (
          <div className="book-summary__block">
            <h3 className="book-new__subtitle">乘客信息</h3>
            {passengerFacts}
          </div>
        )}
      </>
    );

    const editLink = (to: BookStep, what: string): ReactNode => (
      <Button variant="text" className="book-review__edit" aria-label={`修改${what}`} onClick={() => goStep(to)}>
        修改
      </Button>
    );

    const reviewSection = (
      <section aria-labelledby="book-review-title" className="site-section book-new__review">
        <h2 id="book-review-title" ref={reviewHeading} tabIndex={-1} className="site-section__title">
          核对订单
        </h2>
        <section className="book-review__block" aria-labelledby="book-review-trip">
          <div className="book-review__head">
            <h3 id="book-review-trip" className="book-new__subtitle">
              行程
            </h3>
            {editLink(1, "行程")}
          </div>
          {tripFacts}
        </section>
        <section className="book-review__block" aria-labelledby="book-review-vehicle">
          <div className="book-review__head">
            <h3 id="book-review-vehicle" className="book-new__subtitle">
              车型和价格
            </h3>
            {editLink(2, "车型和价格")}
          </div>
          {selected === null || vehicleName === null ? (
            <p>{current?.kind === "loading" ? "正在重新查询价格…" : "选的车型现在报不出价了，请点「修改」重新选择车型。"}</p>
          ) : (
            <>
              <p className="book-review__vehicle" lang={vehicleName.lang}>
                {vehicleName.text}
              </p>
              <PriceBlock fare={selected.price.total} basisNote={sitePriceBasisNote(selected)} kmNote={kmNote} priced={pricedState} currency={guestCurrency} onCurrency={(code) => setGuestCurrency(code as CurrencyCode)} reference={reference !== null && reference.to === guestCurrency ? reference : null} />
              {itineraryPrice}
            </>
          )}
        </section>
        <section className="book-review__block" aria-labelledby="book-review-passenger">
          <div className="book-review__head">
            <h3 id="book-review-passenger" className="book-new__subtitle">
              乘客信息
            </h3>
            {editLink(3, "乘客信息")}
          </div>
          {passengerFacts}
        </section>
        {selected !== null && (
          <section className="book-review__block" aria-labelledby="book-review-cancel">
            <h3 id="book-review-cancel" className="book-new__subtitle">
              取消规则
            </h3>
            <p>{guestCancelPolicyText((priced ?? selected).cancel_policy.tiers)}</p>
          </section>
        )}
        <form id={CONTACT_FORM_ID} className="site-form book-review__pay" noValidate onSubmit={(event) => void submitOrder(event)}>
          <AlertSlot notice={contactNotice} />
          <ConsentField checked={contact.consent} error={contactErrors.consent} onChange={(consent) => updateContact({ consent })} />
          <PayBlock busy={busy} expired={expired} onRequote={requote} />
        </form>
        <div className="book-new__actions">
          <Button size="lg" onClick={() => goStep(3)}>
            上一步
          </Button>
        </div>
      </section>
    );

    const bar = !wide && step === 2 && selected !== null && vehicleName !== null && (
      <div className="book-bar">
        <p className="book-bar__text">
          <span lang={vehicleName.lang}>{vehicleName.text}</span> · {fixedPriceLabel(selected.pricing_basis)} <SitePrice text={moneyText(selected.price.total)} size="sm" />
        </p>
        <Button variant="primary" size="lg" onClick={() => goStep(3)}>
          下一步
        </Button>
      </div>
    );

    /** 手机、平板：右侧栏变成顶部可展开的摘要条，收起时写行程和价格（手机上两端各占一行） */
    const summaryBar = !wide && (
      <div className="book-summary-bar">
        <button type="button" className="book-summary-bar__toggle" aria-expanded={summaryOpen} aria-controls="book-summary-panel" onClick={() => setSummaryOpen((value) => !value)}>
          <span className="book-summary-bar__head">
            <span className="book-summary-bar__title" id="book-summary-title">
              行程摘要
            </span>
            {step > 1 && selected !== null && pricedState.kind === "ready" && <span className="book-summary-bar__price">{moneyText(pricedState.total)}</span>}
          </span>
          {/* site-booking-v2 第 0 节：地点名各自单行省略（价格在上面一行），行程类型总是看得到；< 768 两端各占一行（M8-37b）；完整的地点名照样在按钮的读屏名里 */}
          <span className="book-summary-bar__text">
            {draft.from !== null && step > 1 ? (
              <>
                <span className="book-summary-bar__end">
                  <span className="book-summary-bar__fixed">{`${tripName} · `}</span>
                  <span className="book-summary-bar__place">{draft.from.name}</span>
                </span>
                {draft.to !== null && (
                  <span className="book-summary-bar__end">
                    <span className="book-summary-bar__fixed book-summary-bar__to">{" → "}</span>
                    <span className="book-summary-bar__place">{draft.to.name}</span>
                  </span>
                )}
              </>
            ) : (
              "还没有确认的内容"
            )}
          </span>
          <Icon name="chevron-down" className={summaryOpen ? "book-summary-bar__arrow book-summary-bar__arrow--open" : "book-summary-bar__arrow"} />
        </button>
        {summaryOpen && (
          <div id="book-summary-panel" className="book-summary-bar__panel book-summary" role="region" aria-label="行程摘要" tabIndex={0}>
            {summaryContent}
          </div>
        )}
      </div>
    );

    body = (
      <div className={bar ? "book-new book-new--with-bar" : "book-new"}>
        <div className="book-new__main">
          {stepper}
          {summaryBar}
          {step === 1 && tripSection}
          {step === 2 && vehicleSection}
          {step === 3 && contactSection}
          {step === 4 && reviewSection}
        </div>
        {wide && (
          <aside className="book-new__aside" aria-labelledby="book-summary-title">
            <section className="site-section book-summary">
              <h2 id="book-summary-title" className="site-section__title">
                行程摘要
              </h2>
              {summaryContent}
            </section>
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
