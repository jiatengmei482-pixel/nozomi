/**
 * 官网首页：接送机询价（M3-05，ADR 0032）。客人选城市、接机 / 送机、机场、地址（文字 + 坐标）、城市当地的日期时间、人数、行李，
 * 看到各车型组的对外价、免费等待和取消政策摘要，选一个去下单。页面上没有供应商、结算价、加价比例（接口里本来就没有）。
 * 四种状态：加载中（骨架）、官网没开 / 没有可预订的城市（空）、出错（说明怎么办 + 重试）、正常。
 */
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteAirport, type SiteCity, type SiteDirection, type SiteQuote, type SiteQuoteRequest, type SiteQuoteResult, createSiteQuotes, listSiteAirports, listSiteCities } from "../../api/site.ts";
import { AlertSlot, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { type CoordinateValue, CoordinateInput, RadioGroup, SelectField, coordinateIssue } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { formatInZone, moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { tiersText } from "../../lib/order-money-display.ts";
import { SITE_CHECKOUT_PATH, UNAVAILABLE_REASON_TEXT, defaultServiceDate, localDateTimeIn } from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { SiteLayout, siteFailureText, useSiteConfig } from "./SiteLayout.tsx";

/** 询价时客人填的内容：带到下单页，返回修改时再带回来。 */
export interface BookingDraft {
  cityId: string;
  airportId: string;
  direction: SiteDirection;
  address: string;
  coordinates: CoordinateValue;
  date: string;
  time: string;
  passengers: string;
  luggage: string;
}

/** 下单页要的东西：选中的报价和询价时的内容（名称用来显示，不再查一次）。 */
export interface CheckoutState {
  quote: SiteQuote;
  draft: BookingDraft;
  city: SiteCity;
  airport: SiteAirport;
}

type Errors = Partial<Record<"city" | "airport" | "address" | "lat" | "lng" | "date" | "time" | "passengers" | "luggage", string>>;

const emptyDraft = (): BookingDraft => ({ cityId: "", airportId: "", direction: "pickup", address: "", coordinates: { lat: "", lng: "" }, date: "", time: "", passengers: "2", luggage: "1" });

function validate(draft: BookingDraft, city: SiteCity | undefined, now: Date): Errors {
  const errors: Errors = {};
  if (city === undefined) errors.city = "请选择城市";
  if (draft.airportId === "") errors.airport = "请选择机场";
  if (draft.address.trim() === "") errors.address = draft.direction === "pickup" ? "请填写下车的地址或酒店名" : "请填写上车的地址或酒店名";
  const lat = coordinateIssue("lat", draft.coordinates.lat);
  const lng = coordinateIssue("lng", draft.coordinates.lng);
  if (lat) errors.lat = lat;
  if (lng) errors.lng = lng;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = "请选择日期";
  if (!/^\d{2}:\d{2}$/.test(draft.time)) errors.time = "请选择时间";
  if (city !== undefined && errors.date === undefined && errors.time === undefined && `${draft.date}T${draft.time}` <= localDateTimeIn(city.timezone, now)) errors.time = "这个时间已经过了，请选一个以后的时间";
  const passengers = Number(draft.passengers);
  if (!/^\d+$/.test(draft.passengers.trim()) || passengers < 1 || passengers > 60) errors.passengers = "人数填 1 到 60 之间的整数";
  const luggage = Number(draft.luggage);
  if (!/^\d+$/.test(draft.luggage.trim()) || luggage > 60) errors.luggage = "行李填 0 到 60 之间的整数";
  return errors;
}

function QuoteCard({ quote, pickup, onChoose }: { quote: SiteQuote; pickup: boolean; onChoose(): void }) {
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
          <dd>{quote.free_wait_minutes === null ? "不限时" : `${quote.free_wait_minutes} 分钟（${pickup ? "从航班落地起算" : "从约定的上车时间起算"}）`}</dd>
        </div>
        <div className="site-facts__item">
          <dt>取消政策</dt>
          <dd>{tiersText(quote.cancel_policy.tiers)}</dd>
        </div>
      </dl>
      <Button variant="primary" size="lg" block onClick={onChoose}>
        预订{name.text}
      </Button>
    </li>
  );
}

function Results({ result, city, pickup, onChoose }: { result: SiteQuoteResult; city: SiteCity; pickup: boolean; onChoose(quote: SiteQuote): void }) {
  if (result.quotes.length === 0) {
    const reasons = [...new Set(result.unavailable.flatMap((entry) => entry.reasons))];
    return (
      <section aria-labelledby="site-results-title" className="site-section">
        <h2 id="site-results-title" className="site-section__title">
          没有可预订的车
        </h2>
        <ul className="site-reasons">
          {(reasons.length > 0 ? reasons : (["NOT_AVAILABLE"] as const)).map((reason) => (
            <li key={reason}>{UNAVAILABLE_REASON_TEXT[reason]}</li>
          ))}
        </ul>
      </section>
    );
  }
  const expires = result.quotes.map((quote) => quote.expires_at).sort()[0] ?? null;
  return (
    <section aria-labelledby="site-results-title" className="site-section">
      <h2 id="site-results-title" className="site-section__title">
        可预订的车（{result.quotes.length} 种）
      </h2>
      <p className="site-muted">按车计价的一口价，已含高速费和停车费。报价 30 分钟内有效（到当地时间 {formatInZone(expires, city.timezone).slice(11)}），过了请重新查询。</p>
      <ul className="site-quotes">
        {result.quotes.map((quote) => (
          <QuoteCard key={quote.quote_id} quote={quote} pickup={pickup} onChoose={() => onChoose(quote)} />
        ))}
      </ul>
    </section>
  );
}

export function BookPage() {
  useDocumentTitle("预订接送机 · NOZOMI 用车");
  const navigate = useNavigate();
  const location = useLocation();
  const back = (location.state as { draft?: BookingDraft } | null)?.draft ?? null;
  const { state: config, reload: reloadConfig } = useSiteConfig();
  const [cities, setCities] = useState<{ kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; items: SiteCity[] }>({ kind: "loading" });
  const [airports, setAirports] = useState<{ cityId: string; items: SiteAirport[] } | null>(null);
  const [airportError, setAirportError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingDraft>(back ?? emptyDraft());
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SiteQuoteResult | null>(null);
  const [round, setRound] = useState(0);
  const [airportRound, setAirportRound] = useState(0);

  const open = config.kind === "ready" && config.config.open;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCities({ kind: "loading" });
    listSiteCities().then(
      ({ items }) => {
        if (!alive) return;
        setCities({ kind: "ready", items });
        setDraft((current) => (current.cityId === "" && items.length === 1 ? { ...current, cityId: (items[0] as SiteCity).id, date: current.date || defaultServiceDate((items[0] as SiteCity).timezone, new Date()) } : current));
      },
      (err: unknown) => alive && setCities({ kind: "failed", message: siteFailureText(err, "读取城市") }),
    );
    return () => {
      alive = false;
    };
  }, [open, round]);

  useEffect(() => {
    if (draft.cityId === "") return;
    let alive = true;
    setAirportError(null);
    listSiteAirports(draft.cityId).then(
      ({ items }) => {
        if (!alive) return;
        setAirports({ cityId: draft.cityId, items });
      },
      (err: unknown) => alive && setAirportError(siteFailureText(err, "读取机场")),
    );
    return () => {
      alive = false;
    };
  }, [draft.cityId, airportRound]);

  const cityList = cities.kind === "ready" ? cities.items : [];
  const city = cityList.find((entry) => entry.id === draft.cityId);
  const airportList = useMemo(() => (airports !== null && airports.cityId === draft.cityId ? airports.items : []), [airports, draft.cityId]);
  const airport = airportList.find((entry) => entry.id === draft.airportId);
  // 城市里只有一个机场、客人还没选（或换了城市被清空）时替客人选上
  useEffect(() => {
    const only = airportList.length === 1 ? (airportList[0] as SiteAirport).id : null;
    if (only !== null && draft.airportId === "") setDraft((current) => (current.airportId === "" ? { ...current, airportId: only } : current));
  }, [airportList, draft.airportId]);

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
    const body: SiteQuoteRequest = {
      city_id: city.id,
      airport_id: draft.airportId,
      direction: draft.direction,
      address: { lat: Number(draft.coordinates.lat), lng: Number(draft.coordinates.lng) },
      service_local: `${draft.date}T${draft.time}`,
      passengers: Number(draft.passengers),
      luggage: Number(draft.luggage),
    };
    setBusy(true);
    try {
      setResult(await createSiteQuotes(body));
    } catch (err) {
      if (err instanceof ApiError && err.code === "CHANNEL_SCOPE_DENIED") setNotice({ kind: "danger", text: "这个城市暂不开放预订，请换一个城市。" });
      else setNotice({ kind: "danger", text: siteFailureText(err, "查询价格") });
    } finally {
      setBusy(false);
    }
  };

  const choose = (quote: SiteQuote): void => {
    if (city === undefined || airport === undefined) return;
    const state: CheckoutState = { quote, draft, city, airport };
    navigate(SITE_CHECKOUT_PATH, { state });
  };

  let body;
  if (config.kind === "loading" || (open && cities.kind === "loading")) {
    body = <Skeleton lines={["long", "control", "control", "control", "control"]} label="正在打开预订页" />;
  } else if (config.kind === "failed") {
    body = <StateBlock title="页面没有打开" description={config.message} action={<Button onClick={reloadConfig}>重试</Button>} />;
  } else if (!config.config.open) {
    body = <StateBlock tone="neutral" title="暂未开放预订" description="官网的在线预订还没有开放，请稍后再来。已经下过单的客人可以点上方的「查订单」查看订单。" />;
  } else if (cities.kind === "failed") {
    body = <StateBlock title="城市列表没有读出来" description={cities.message} action={<Button onClick={() => setRound((value) => value + 1)}>重试</Button>} />;
  } else if (cityList.length === 0) {
    body = <StateBlock tone="neutral" title="暂时没有可预订的城市" description="现在还没有可以在线预订接送机的城市，请稍后再来。" />;
  } else {
    const pickup = draft.direction === "pickup";
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
              update({ cityId, airportId: "", ...(next !== undefined && draft.date === "" ? { date: defaultServiceDate(next.timezone, new Date()) } : {}) });
            }}
          />
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
          {airportError !== null ? (
            <StateBlock headingLevel="h3" title="机场列表没有读出来" description={airportError} action={<Button onClick={() => setAirportRound((value) => value + 1)}>重试</Button>} />
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
          <TextField
            label={pickup ? "下车地址或酒店名" : "上车地址或酒店名"}
            size="lg"
            required
            autoComplete="street-address"
            value={draft.address}
            errors={errors.address ? [errors.address] : []}
            onChange={(event) => update({ address: event.target.value })}
          />
          <CoordinateInput
            legend={pickup ? "下车地点的坐标" : "上车地点的坐标"}
            value={draft.coordinates}
            errors={{ lat: errors.lat ?? null, lng: errors.lng ?? null }}
            hint="在手机地图里长按这个地点就能看到坐标，可以整段粘贴「纬度, 经度」。用来确认地点在服务范围内。"
            onChange={(coordinates) => update({ coordinates })}
          />
          <div className="site-form__row">
            <TextField label={pickup ? "航班到达日期（当地）" : "用车日期（当地）"} size="lg" type="date" required value={draft.date} errors={errors.date ? [errors.date] : []} onChange={(event) => update({ date: event.target.value })} />
            <TextField
              label={pickup ? "航班计划到达时间（当地）" : "上车时间（当地）"}
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
        {result !== null && city !== undefined && <Results result={result} city={city} pickup={pickup} onChoose={choose} />}
      </>
    );
  }

  return (
    <SiteLayout>
      <h1 className="site__title">预订接送机</h1>
      <p className="site-muted">按车计价的一口价，已含高速费和停车费；接机的司机按航班实际落地时间等候。</p>
      {body}
    </SiteLayout>
  );
}
