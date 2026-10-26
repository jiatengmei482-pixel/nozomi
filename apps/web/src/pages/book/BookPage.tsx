/**
 * 官网首页：询价（M3-05 接送机；M3-10 加上点对点、包车，ADR 0032 及其补充）。
 * 客人选城市、服务（这个城市能订的那几种）、各服务自己的行程（接送机：接机 / 送机、机场、地址；点对点：上车点、下车点；包车：上车点、套餐时长）、
 * 城市当地的日期时间、人数、行李，看到各车型组的对外价、免费等待、取消政策摘要（包车还有套餐时长和公里），选一个去下单。
 * 地址可以从城市的常用地点（机场、车站、地标，主数据）里选，也可以自己写地址和坐标——不调用外部地图服务。
 * 页面上没有供应商、结算价、加价比例（接口里本来就没有）。
 * 四种状态：加载中（骨架）、官网没开 / 没有可预订的城市（空）、出错（说明怎么办 + 重试）、正常。
 */
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type SiteAirport,
  type SiteCategory,
  type SiteCity,
  type SiteDirection,
  type SiteQuote,
  type SiteQuoteRequest,
  type SiteQuoteResult,
  createSiteQuotes,
  listSiteAirports,
  listSiteCharterPackages,
  listSiteCities,
  listSitePlaces,
} from "../../api/site.ts";
import { AlertSlot, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { RadioGroup, SelectField, coordinateIssue } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { formatInZone, moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import {
  ADDRESS_LABELS,
  SITE_CATEGORY_HINTS,
  SITE_CATEGORY_NAMES,
  SITE_CHECKOUT_PATH,
  UNAVAILABLE_REASON_TEXT,
  defaultServiceDate,
  freeWaitText,
  guestCancelPolicyText,
  localDateTimeIn,
  packageText,
  priceNote,
  quotesByTotal,
  serviceTimeLabels,
} from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { AddressFields, type PlacesState, type PointDraft, type PointErrors, emptyPoint } from "./AddressFields.tsx";
import { SiteLayout, siteFailureText, useSiteConfig } from "./SiteLayout.tsx";

/** 询价时客人填的内容：带到下单页，返回修改时再带回来。 */
export interface BookingDraft {
  cityId: string;
  category: SiteCategory;
  /** 接送机：机场、方向、地址那一端 */
  airportId: string;
  direction: SiteDirection;
  address: PointDraft;
  /** 点对点：上车点、下车点；包车：上车点 */
  from: PointDraft;
  to: PointDraft;
  /** 包车：套餐时长（小时） */
  packageHours: string;
  date: string;
  time: string;
  passengers: string;
  luggage: string;
}

/** 下单页要的东西：选中的报价和询价时的内容（名称用来显示，不再查一次）。接送机才有机场。 */
export interface CheckoutState {
  quote: SiteQuote;
  draft: BookingDraft;
  city: SiteCity;
  airport: SiteAirport | null;
}

type PointKey = "address" | "from" | "to";
type Errors = Partial<Record<"city" | "airport" | "packageHours" | "date" | "time" | "passengers" | "luggage", string>> & Partial<Record<PointKey, PointErrors>>;

const CATEGORY_ORDER: readonly SiteCategory[] = ["airport_transfer", "point_to_point", "charter"];

const emptyDraft = (): BookingDraft => ({
  cityId: "",
  category: "airport_transfer",
  airportId: "",
  direction: "pickup",
  address: emptyPoint(),
  from: emptyPoint(),
  to: emptyPoint(),
  packageHours: "",
  date: "",
  time: "",
  passengers: "2",
  luggage: "1",
});

/** 这一单要填的地点：接送机是地址那一端，点对点两端，包车上车点。 */
function pointsOf(draft: BookingDraft): { key: PointKey; end: "pickup" | "dropoff" }[] {
  if (draft.category === "point_to_point") return [{ key: "from", end: "pickup" }, { key: "to", end: "dropoff" }];
  if (draft.category === "charter") return [{ key: "from", end: "pickup" }];
  return [{ key: "address", end: draft.direction === "pickup" ? "dropoff" : "pickup" }];
}

function pointErrors(point: PointDraft, end: "pickup" | "dropoff"): PointErrors | null {
  const errors: PointErrors = {};
  if (point.address.trim() === "") errors.address = end === "pickup" ? "请填写上车的地址或酒店名" : "请填写下车的地址或酒店名";
  const lat = coordinateIssue("lat", point.coordinates.lat);
  const lng = coordinateIssue("lng", point.coordinates.lng);
  if (lat) errors.lat = lat;
  if (lng) errors.lng = lng;
  return Object.keys(errors).length > 0 ? errors : null;
}

function validate(draft: BookingDraft, city: SiteCity | undefined, now: Date): Errors {
  const errors: Errors = {};
  if (city === undefined) errors.city = "请选择城市";
  if (draft.category === "airport_transfer" && draft.airportId === "") errors.airport = "请选择机场";
  if (draft.category === "charter" && draft.packageHours === "") errors.packageHours = "请选择包车时长";
  for (const { key, end } of pointsOf(draft)) {
    const found = pointErrors(draft[key], end);
    if (found !== null) errors[key] = found;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "请选择日期";
  if (!/^\d{2}:\d{2}$/.test(draft.time)) errors.time = "请选择时间";
  if (city !== undefined && errors.date === undefined && errors.time === undefined && `${draft.date}T${draft.time}` <= localDateTimeIn(city.timezone, now)) errors.time = "这个时间已经过了，请选一个以后的时间";
  const passengers = Number(draft.passengers);
  if (!/^\d+$/.test(draft.passengers.trim()) || passengers < 1 || passengers > 60) errors.passengers = "人数填 1 到 60 之间的整数";
  const luggage = Number(draft.luggage);
  if (!/^\d+$/.test(draft.luggage.trim()) || luggage > 60) errors.luggage = "行李填 0 到 60 之间的整数";
  return errors;
}

/** 从下单页「返回修改」带回来的询价内容；形状不对（例如旧版页面留在浏览器历史里的）就不用。 */
function draftFrom(state: unknown): BookingDraft | null {
  const draft = (state as { draft?: Partial<BookingDraft> } | null)?.draft;
  if (draft === undefined || draft === null || typeof draft !== "object") return null;
  const point = (value: unknown): boolean => typeof value === "object" && value !== null && typeof (value as PointDraft).address === "string";
  return CATEGORY_ORDER.includes(draft.category as SiteCategory) && point(draft.address) && point(draft.from) && point(draft.to) ? (draft as BookingDraft) : null;
}

const pointOf = (point: PointDraft): { lat: number; lng: number } => ({ lat: Number(point.coordinates.lat), lng: Number(point.coordinates.lng) });

/** 按服务拼询价请求：只给这个服务要的字段。 */
export function quoteRequestOf(draft: BookingDraft, cityId: string): SiteQuoteRequest {
  const common = { city_id: cityId, service_local: `${draft.date}T${draft.time}`, passengers: Number(draft.passengers), luggage: Number(draft.luggage) };
  if (draft.category === "point_to_point") return { category: "point_to_point", ...common, pickup: pointOf(draft.from), dropoff: pointOf(draft.to) };
  if (draft.category === "charter") return { category: "charter", ...common, pickup: pointOf(draft.from), package_hours: Number(draft.packageHours) };
  return { category: "airport_transfer", ...common, airport_id: draft.airportId, direction: draft.direction, address: pointOf(draft.address) };
}

function QuoteCard({ quote, draft, onChoose }: { quote: SiteQuote; draft: BookingDraft; onChoose(): void }) {
  const group = quote.vehicle_group;
  const name = displayName(group.name);
  const capacity = group.combos.map((combo) => `${combo.passengers} 人 + ${combo.luggage} 件行李`).join(" 或 ");
  return (
    <li className="site-quote">
      <div className="site-quote__head">
        <h3 className="site-quote__name" lang={name.lang}>
          {name.text}
        </h3>
        <p className="site-quote__price">{moneyText(quote.price.total)}</p>
      </div>
      <dl className="site-facts">
        {quote.package !== null && (
          <div className="site-facts__item">
            <dt>包车套餐</dt>
            <dd>{packageText(quote.package.hours, quote.package.km)}</dd>
          </div>
        )}
        <div className="site-facts__item">
          <dt>座位</dt>
          <dd>{group.seats} 座{capacity !== "" ? `（最多 ${capacity}）` : ""}</dd>
        </div>
        {group.sample_models.length > 0 && (
          <div className="site-facts__item">
            <dt>参考车型</dt>
            <dd>{group.sample_models.join("、")} 或同级</dd>
          </div>
        )}
        <div className="site-facts__item">
          <dt>免费等待</dt>
          <dd>{freeWaitText(quote.free_wait_minutes, draft.category, draft.direction)}</dd>
        </div>
        <div className="site-facts__item">
          <dt>取消政策</dt>
          <dd>{guestCancelPolicyText(quote.cancel_policy.tiers)}</dd>
        </div>
      </dl>
      <Button variant="primary" size="lg" block onClick={onChoose}>
        预订{name.text}
      </Button>
    </li>
  );
}

/**
 * 询价结果（报不出价时同样）：出来后把焦点移到结果标题并滚到那里（F4）——手机上结果在长表单下面，不这样客人看不到任何变化。
 * 报价按总价从低到高（F6）。
 */
function Results({ result, city, draft, onChoose }: { result: SiteQuoteResult; city: SiteCity; draft: BookingDraft; onChoose(quote: SiteQuote): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const node = heading.current;
    if (node === null) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    node.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [result]);
  if (result.quotes.length === 0) {
    const reasons = [...new Set(result.unavailable.flatMap((entry) => entry.reasons))];
    return (
      <section aria-labelledby="site-results-title" className="site-section">
        <h2 id="site-results-title" ref={heading} tabIndex={-1} className="site-section__title">
          没有可预订的车
        </h2>
        <ul className="site-reasons">
          {(reasons.length > 0 ? reasons : (["NOT_AVAILABLE"] as const)).map((reason) => (
            <li key={reason}>{UNAVAILABLE_REASON_TEXT[reason]}</li>
          ))}
        </ul>
        {draft.category === "charter" && <p className="site-muted">也可以换一个包车时长试试。</p>}
      </section>
    );
  }
  const expires = result.quotes.map((quote) => quote.expires_at).sort()[0] ?? null;
  return (
    <section aria-labelledby="site-results-title" className="site-section">
      <h2 id="site-results-title" ref={heading} tabIndex={-1} className="site-section__title">
        可预订的车（{result.quotes.length} 种）
      </h2>
      <p className="site-muted">
        {priceNote(draft.category)}报价 30 分钟内有效（到当地时间 {formatInZone(expires, city.timezone).slice(11)}），过了请重新查询。
      </p>
      <ul className="site-quotes">
        {quotesByTotal(result.quotes).map((quote) => (
          <QuoteCard key={quote.quote_id} quote={quote} draft={draft} onChoose={() => onChoose(quote)} />
        ))}
      </ul>
    </section>
  );
}

type ListState<T> = { cityId: string; kind: "ready"; items: T[] } | { cityId: string; kind: "failed"; message: string };

/** 按城市读一份列表（机场、包车时长、常用地点）：换城市重新读；`enabled` 为 false 时不读。 */
function useCityList<T>(cityId: string, enabled: boolean, load: (cityId: string) => Promise<{ items: T[] }>, what: string): { state: ListState<T> | null; retry(): void } {
  const [state, setState] = useState<ListState<T> | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (cityId === "" || !enabled) return;
    let alive = true;
    load(cityId).then(
      ({ items }) => alive && setState({ cityId, kind: "ready", items }),
      (err: unknown) => alive && setState({ cityId, kind: "failed", message: siteFailureText(err, what) }),
    );
    return () => {
      alive = false;
    };
  }, [cityId, enabled, round, load, what]);
  return { state: state !== null && state.cityId === cityId ? state : null, retry: () => setRound((value) => value + 1) };
}

export function BookPage() {
  useDocumentTitle("预订用车 · NOZOMI 用车");
  const navigate = useNavigate();
  const location = useLocation();
  const back = draftFrom(location.state);
  const { state: config, reload: reloadConfig } = useSiteConfig();
  const [cities, setCities] = useState<{ kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; items: SiteCity[] }>({ kind: "loading" });
  const [draft, setDraft] = useState<BookingDraft>(back ?? emptyDraft());
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SiteQuoteResult | null>(null);
  const [round, setRound] = useState(0);

  const open = config.kind === "ready" && config.config.open;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCities({ kind: "loading" });
    listSiteCities().then(
      ({ items }) => {
        if (!alive) return;
        setCities({ kind: "ready", items });
        const only = items.length === 1 ? (items[0] as SiteCity) : null;
        setDraft((current) => {
          if (current.cityId !== "" || only === null) return current;
          return { ...current, cityId: only.id, category: only.categories.includes(current.category) ? current.category : (only.categories[0] ?? current.category), date: current.date || defaultServiceDate(only.timezone, new Date()) };
        });
      },
      (err: unknown) => alive && setCities({ kind: "failed", message: siteFailureText(err, "读取城市") }),
    );
    return () => {
      alive = false;
    };
  }, [open, round]);

  const cityList = cities.kind === "ready" ? cities.items : [];
  const city = cityList.find((entry) => entry.id === draft.cityId);
  const categories = city !== undefined ? city.categories : CATEGORY_ORDER.filter((category) => cityList.some((entry) => entry.categories.includes(category)));
  const categoryKey = categories.join(",");
  // 没选城市时列的是各城市服务的合集：现在这种服务不在里面就换成第一种
  useEffect(() => {
    const first = categoryKey === "" ? undefined : (categoryKey.split(",")[0] as SiteCategory);
    if (first !== undefined && !categoryKey.split(",").includes(draft.category)) setDraft((current) => ({ ...current, category: first }));
  }, [categoryKey, draft.category]);
  const airports = useCityList(draft.cityId, draft.category === "airport_transfer", listSiteAirports, "读取机场");
  const packages = useCityList(draft.cityId, draft.category === "charter", listSiteCharterPackages, "读取包车时长");
  const placeList = useCityList(draft.cityId, true, listSitePlaces, "读取常用地点");
  const places: PlacesState = placeList.state === null ? { kind: "loading" } : placeList.state.kind === "failed" ? { kind: "failed" } : { kind: "ready", items: placeList.state.items };

  const airportList = useMemo(() => (airports.state?.kind === "ready" ? airports.state.items : []), [airports.state]);
  const airport = airportList.find((entry) => entry.id === draft.airportId);
  const packageList = useMemo(() => (packages.state?.kind === "ready" ? packages.state.items : []), [packages.state]);
  // 城市里只有一个机场 / 一种包车时长、客人还没选（或换了城市被清空）时替客人选上
  useEffect(() => {
    const only = airportList.length === 1 ? (airportList[0] as SiteAirport).id : null;
    if (only !== null && draft.airportId === "") setDraft((current) => (current.airportId === "" ? { ...current, airportId: only } : current));
  }, [airportList, draft.airportId]);
  useEffect(() => {
    const only = packageList.length === 1 ? String((packageList[0] as { hours: number }).hours) : null;
    if (only !== null && draft.packageHours === "") setDraft((current) => (current.packageHours === "" ? { ...current, packageHours: only } : current));
  }, [packageList, draft.packageHours]);

  const update = (changes: Partial<BookingDraft>): void => {
    setDraft((current) => ({ ...current, ...changes }));
    setResult(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validate(draft, city, new Date());
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length > 0 || city === undefined) {
      setNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      return;
    }
    setBusy(true);
    try {
      setResult(await createSiteQuotes(quoteRequestOf(draft, city.id)));
    } catch (err) {
      if (err instanceof ApiError && err.code === "CHANNEL_SCOPE_DENIED") setNotice({ kind: "danger", text: `这个城市的${SITE_CATEGORY_NAMES[draft.category]}暂不开放预订，请换一种服务或换一个城市。` });
      else setNotice({ kind: "danger", text: siteFailureText(err, "查询价格") });
    } finally {
      setBusy(false);
    }
  };

  const choose = (quote: SiteQuote): void => {
    if (city === undefined) return;
    if (draft.category === "airport_transfer" && airport === undefined) return;
    const state: CheckoutState = { quote, draft, city, airport: draft.category === "airport_transfer" ? (airport ?? null) : null };
    navigate(SITE_CHECKOUT_PATH, { state });
  };

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
    const transfer = draft.category === "airport_transfer";
    const labels = serviceTimeLabels(draft.category, draft.direction);
    const pointFields = pointsOf(draft).map(({ key, end }) => (
      <AddressFields key={key} end={end} label={ADDRESS_LABELS[end]} value={draft[key]} errors={errors[key] ?? {}} places={places} onChange={(point) => update({ [key]: point })} />
    ));
    body = (
      <>
        <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
          <AlertSlot notice={notice} />
          <SelectField
            label="城市"
            required
            placeholder="请选择城市"
            value={draft.cityId}
            options={cityList.map((entry) => ({ value: entry.id, label: displayName(entry.name).text }))}
            errors={errors.city ? [errors.city] : []}
            onChange={(cityId) => {
              if (cityId === draft.cityId) return;
              const next = cityList.find((entry) => entry.id === cityId);
              // 换城市：机场、包车时长、选中的常用地点都是那个城市的，清掉；新城市没有现在这种服务时换成它有的第一种
              update({
                cityId,
                airportId: "",
                packageHours: "",
                address: { ...draft.address, placeId: null },
                from: { ...draft.from, placeId: null },
                to: { ...draft.to, placeId: null },
                ...(next !== undefined && !next.categories.includes(draft.category) && next.categories[0] !== undefined ? { category: next.categories[0] } : {}),
                ...(next !== undefined && draft.date === "" ? { date: defaultServiceDate(next.timezone, new Date()) } : {}),
              });
            }}
          />
          {categories.length > 1 && (
            <RadioGroup<SiteCategory>
              legend="服务"
              name="category"
              value={draft.category}
              options={categories.map((category) => ({ value: category, label: SITE_CATEGORY_NAMES[category], hint: SITE_CATEGORY_HINTS[category] }))}
              onChange={(category) => update({ category })}
            />
          )}
          {transfer && (
            <>
              <RadioGroup<SiteDirection>
                legend="接机还是送机"
                name="direction"
                value={draft.direction}
                options={[
                  { value: "pickup", label: "接机", hint: "从机场到酒店或地址" },
                  { value: "dropoff", label: "送机", hint: "从酒店或地址到机场" },
                ]}
                onChange={(direction) => update({ direction })}
              />
              {airports.state?.kind === "failed" ? (
                <StateBlock headingLevel="h3" title="机场列表没有读出来" description={airports.state.message} action={<Button size="lg" onClick={airports.retry}>重试</Button>} />
              ) : (
                <SelectField
                  label="机场"
                  required
                  placeholder={draft.cityId === "" ? "先选城市" : "请选择机场"}
                  value={draft.airportId}
                  options={airportList.map((entry) => ({ value: entry.id, label: `${displayName(entry.name).text}（${entry.code}）` }))}
                  errors={errors.airport ? [errors.airport] : []}
                  onChange={(airportId) => update({ airportId })}
                />
              )}
            </>
          )}
          {draft.category === "charter" &&
            (packages.state?.kind === "failed" ? (
              <StateBlock headingLevel="h3" title="包车时长没有读出来" description={packages.state.message} action={<Button size="lg" onClick={packages.retry}>重试</Button>} />
            ) : packages.state?.kind === "ready" && packageList.length === 0 ? (
              <StateBlock headingLevel="h3" tone="neutral" title="暂时没有可选的包车时长" description="这个城市的包车还没有可以预订的套餐，请换一种服务或换一个城市。" />
            ) : (
              <SelectField
                label="包车时长"
                required
                placeholder={draft.cityId === "" ? "先选城市" : packages.state === null ? "正在读取" : "请选择时长"}
                value={draft.packageHours}
                options={packageList.map((entry) => ({ value: String(entry.hours), label: `${entry.hours} 小时` }))}
                errors={errors.packageHours ? [errors.packageHours] : []}
                hint="超出套餐的时长和公里服务后按实际收取"
                onChange={(packageHours) => update({ packageHours })}
              />
            ))}
          {pointFields}
          <div className="site-form__row">
            <TextField label={labels.date} size="lg" type="date" required value={draft.date} errors={errors.date ? [errors.date] : []} onChange={(event) => update({ date: event.target.value })} />
            <TextField
              label={labels.time}
              size="lg"
              type="time"
              required
              value={draft.time}
              errors={errors.time ? [errors.time] : []}
              {...(city !== undefined ? { hint: `${displayName(city.name).text}的当地时间` } : {})}
              onChange={(event) => update({ time: event.target.value })}
            />
          </div>
          <div className="site-form__row">
            <TextField label="人数" size="lg" type="number" inputMode="numeric" min={1} max={60} required value={draft.passengers} errors={errors.passengers ? [errors.passengers] : []} onChange={(event) => update({ passengers: event.target.value })} />
            <TextField label="行李（件）" size="lg" type="number" inputMode="numeric" min={0} max={60} value={draft.luggage} errors={errors.luggage ? [errors.luggage] : []} onChange={(event) => update({ luggage: event.target.value })} />
          </div>
          <div className="site-actions">
            <Button type="submit" variant="primary" size="lg" block loading={busy} loadingText="正在查询">
              查询价格
            </Button>
          </div>
        </form>
        {result !== null && city !== undefined && <Results result={result} city={city} draft={draft} onChoose={choose} />}
      </>
    );
  }

  return (
    <SiteLayout>
      <h1 className="site__title">预订用车</h1>
      <p className="site-muted">接送机、点对点、包车，按车计价；接机的司机按航班实际落地时间等候。</p>
      {body}
    </SiteLayout>
  );
}
