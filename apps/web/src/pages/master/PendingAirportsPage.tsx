/**
 * 处理导入的机场（docs/design/pages/master-data.md 第 4 节）：
 * 把导入进来、还没有城市的机场一个接一个地指定城市并启用——同一个位置，选城市，按 Enter，自动换下一个。
 */
import { FLIGHT_SCOPES, type FlightScope, type LocalizedText } from "@nozomi/domain";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type City, type CitySuggestion, type MasterPage, type Place, type PlaceCitySuggestion, type PlacePatch, createMaster, enableMaster, getMaster, listMaster, patchMaster } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Attributions } from "../../components/Attribution.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CopyButton, LocalizedInput, RadioGroup } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { FLIGHT_SCOPE_NAMES, MASTER_STATUS_BADGES, cleanLocalized, countryLabel, countryName, displayName, formatCount, formatPoint, sameLocalized, shortName } from "../../lib/master-display.ts";
import { formatDistance } from "../../lib/distance.ts";
import { masterEditPath, placeListPath } from "../../lib/master-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { CITY_LABELS, CityFields, type CityValues, EMPTY_CITY, cityCodePrefix, cityCreateBody, cityFieldOfPath, validateCity } from "./CityForm.tsx";
import type { FieldErrors, FormApi } from "./MasterForm.tsx";
import { NAME_MAX_LENGTH, languageErrors, localizedErrors, toCoordinateValue } from "./forms-common.tsx";
import { FORBIDDEN_TEXT, cityOption, isForbidden, useAllCities, useCountryOptions } from "./shared.tsx";

const BATCH = 200;
const REFILL_BELOW = 20;
const DONE_LIMIT = 10;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CITIES: readonly CitySuggestion[] = [];
const SCOPE_OPTIONS = [{ value: "none" as const, label: "不填" }, ...FLIGHT_SCOPES.map((scope) => ({ value: scope, label: FLIGHT_SCOPE_NAMES[scope] }))];

interface Draft {
  cityId: string | null;
  name: LocalizedText;
  scope: FlightScope | "none";
}

interface Done {
  place: Place;
  cityName: string;
}

interface CardNotice {
  kind: AlertKind;
  text: string;
  /** 保存成功、启用没成功：可以再试一次启用，或先处理下一个 */
  retryEnable?: boolean;
}

const draftOf = (place: Place, cityId: string | null = null): Draft => ({ cityId, name: place.name, scope: place.flight_scope ?? "none" });
const label = (place: Place): string => `${place.code} ${displayName(place.name).text}`;

/** 在这个页面里直接新增城市（4.4）。国家已经定了；可以一键填入这个机场的坐标。 */
function NewCityDialog({ airport, cities, onClose, onCreated }: { airport: Place; cities: readonly City[]; onClose(): void; onCreated(city: City): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const country = airport.country_code;
  const latest = [...cities].filter((city) => city.country_code === country).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const [values, setValues] = useState<CityValues>({ ...EMPTY_CITY, country, code: cityCodePrefix(country), timezone: latest?.timezone ?? null });
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const clientErrors = validateCity(values, "new");

  useEffect(() => {
    const code = formRef.current?.querySelector<HTMLInputElement>('[data-field="code"] input');
    code?.focus();
    code?.setSelectionRange(code.value.length, code.value.length);
  }, []);

  const form: FormApi<CityValues> = {
    values,
    set: (patch) => {
      setValues({ ...values, ...patch });
      setServerErrors(Object.fromEntries(Object.entries(serverErrors).filter(([field]) => !(field.split(".")[0]! in patch))));
    },
    touch: (field) => setTouched(new Set([...touched, field])),
    errors: (field) => [...(serverErrors[field] ?? []), ...(attempted || touched.has(field) || touched.has(field.split(".")[0] ?? field) ? (clientErrors[field] ?? []) : [])],
  };

  const focusFirst = (field: string): void => formRef.current?.querySelector<HTMLElement>(`[data-field="${field.split(".")[0]}"] input`)?.focus();

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setAttempted(true);
    const invalid = Object.keys(clientErrors)[0];
    if (invalid !== undefined) return focusFirst(invalid);
    setFailure(null);
    setBusy(true);
    try {
      onCreated(await createMaster("cities", token, cityCreateBody(values)));
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "CODE_TAKEN") {
        setServerErrors({ code: ["这个编码已经被使用，请换一个"] });
        focusFirst("code");
      } else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: unknown; message?: unknown }[]) : [];
        const mapped: FieldErrors = {};
        for (const issue of issues) {
          const field = typeof issue.path === "string" ? cityFieldOfPath(issue.path) : null;
          if (field !== null && field in { ...CITY_LABELS, "center.lat": 1, "center.lng": 1 }) mapped[field] = [typeof issue.message === "string" && /[一-鿿]/.test(issue.message) ? issue.message : "这一项不符合要求，请检查后重试"];
        }
        if (Object.keys(mapped).length === 0) setFailure("提交的内容不符合要求，请检查后重试。");
        else {
          setServerErrors(mapped);
          focusFirst(Object.keys(mapped)[0] ?? "code");
        }
      } else if (isForbidden(err)) setFailure(FORBIDDEN_TEXT);
      else if (err instanceof NetworkError) setFailure("网络连接失败，请检查网络后重试。你填写的内容还在。");
      else setFailure("系统暂时无法保存，请稍后再试。你填写的内容还在。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      size="form"
      title="新增城市"
      busy={busy}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={busy} loadingText="新增中…" onClick={() => formRef.current?.requestSubmit()}>
            新增城市
          </Button>
        </>
      }
    >
      <form ref={formRef} className="form-card" noValidate onSubmit={(event) => void submit(event)}>
        <div role="alert">{failure !== null && <Alert kind="danger">{failure}</Alert>}</div>
        {/* 表单里要有一个提交按钮，在输入框里按 Enter 才会提交；看得见的那个按钮在对话框底部 */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
        <CityFields
          form={form}
          mode="new"
          readOnly={false}
          busy={busy}
          fixedCountry
          cities={cities}
          centerNote={
            <span>
              <Button variant="text" size="sm" disabled={busy} onClick={() => form.set({ center: toCoordinateValue(airport.location) })}>
                填入这个机场的坐标
              </Button>
            </span>
          }
        />
      </form>
    </Dialog>
  );
}

export function PendingAirportsPage() {
  const { portal, token, account, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`处理导入的机场 · NOZOMI ${portal.name}`);
  const canManage = usePlatformCan("master_data.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const countryParam = params.get("country");
  const country = countryParam !== null && COUNTRY_PATTERN.test(countryParam) ? countryParam : null;
  const startParam = params.get("start");
  const startId = startParam !== null && UUID_PATTERN.test(startParam) ? startParam : null;

  const cities = useAllCities();
  const countryOptions = useCountryOptions(cities.state.data);
  const [batchCursor, setBatchCursor] = useState<string | null>(null);
  const [batchFailed, setBatchFailed] = useState(false);
  const first = useLoad<{ page: MasterPage<Place>; start: Place | null }>(`pending:${country ?? ""}:${startId ?? ""}`, canManage
    ? async (authToken) => {
        const [page, start] = await Promise.all([
          listMaster("places", authToken, { type: "airport", city_id: "none", status: "all", sort: "code", limit: BATCH, ...(country ? { country_code: country } : {}) }),
          startId !== null ? getMaster("places", authToken, startId).catch(() => null) : Promise.resolve(null),
        ]);
        // 指定从某一个机场开始、而它不在第一批里：单独问一次它的城市建议（建议只随列表给）
        const known = (page.city_suggestions ?? []).some((entry) => entry.place_id === start?.id);
        const extra =
          start !== null && start.city_id === null && !known
            ? await listMaster("places", authToken, { type: "airport", city_id: "none", status: "all", code: start.code, limit: 1 }).then(
                (single) => single.city_suggestions ?? [],
                () => [],
              )
            : [];
        return { page: { ...page, city_suggestions: [...(page.city_suggestions ?? []), ...extra] }, start };
      }
    : null);

  const [queue, setQueue] = useState<Place[] | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState<Done[]>([]);
  const [recentCities, setRecentCities] = useState<string[]>([]);
  // 后端给的城市建议（按机场编号记；机场资料里的所属城市名对得上的优先，其余按人口和距离综合）；只是建议，预填以后仍要人看一眼再确认
  const [suggestions, setSuggestions] = useState<ReadonlyMap<string, PlaceCitySuggestion>>(new Map());
  const prefilledFor = useRef<string | null>(null);
  const remember = (entries: readonly PlaceCitySuggestion[] | undefined): void => {
    if (!entries || entries.length === 0) return;
    setSuggestions((known) => new Map([...known, ...entries.map((entry) => [entry.place_id, entry] as const)]));
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);
  const [notice, setNotice] = useState<CardNotice | null>(null);
  const [working, setWorking] = useState<"enable" | "save" | null>(null);
  const [saved, setSaved] = useState<Place | null>(null);
  const [addingCity, setAddingCity] = useState(false);
  const [announce, setAnnounce] = useState("");
  const cityRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  // 第一批取回来：排好队（带 start 进来的那一个排到队首）
  const firstData = first.state.status === "ready" ? first.state.data : null;
  useEffect(() => {
    if (firstData === null) return;
    const { page, start } = firstData;
    const head = start !== null && start.type === "airport" && start.city_id === null ? [start] : [];
    const next = [...head, ...page.items.filter((place) => place.id !== head[0]?.id)];
    setQueue(next);
    setSuggestions(new Map((page.city_suggestions ?? []).map((entry) => [entry.place_id, entry])));
    prefilledFor.current = null;
    setRemaining(Math.max(page.total, next.length));
    setBatchCursor(page.next_cursor);
    setBatchFailed(false);
    setSkipped(new Set());
    setDraft(next[0] ? draftOf(next[0]) : null);
    setNotice(null);
    setSaved(null);
    setAttempted(false);
    setCityError(null);
  }, [firstData]);

  // 队列快见底、后面还有：在后台取下一批
  useEffect(() => {
    if (queue === null || batchCursor === null || batchFailed || queue.length >= REFILL_BELOW) return;
    let cancelled = false;
    const cursor = batchCursor;
    listMaster("places", token, { type: "airport", city_id: "none", status: "all", sort: "code", limit: BATCH, cursor, ...(country ? { country_code: country } : {}) }).then(
      (page) => {
        if (cancelled) return;
        setBatchCursor(page.next_cursor);
        remember(page.city_suggestions);
        // 每取一批新的，就按接口此刻给的总数校正「还剩」（别人可能同时处理掉了一些）
        setRemaining(page.total);
        const known = new Set(queue.map((place) => place.id));
        const merged = [...queue, ...page.items.filter((place) => !known.has(place.id))];
        setQueue(merged);
        if (queue.length === 0 && merged[0]) setDraft(draftOf(merged[0]));
      },
      (err: unknown) => {
        // 没取到：不能当成「后面没有了」，留着游标，让人重试
        if (!cancelled && !handleAuthFailure(err)) setBatchFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [queue, batchCursor, batchFailed, token, country, handleAuthFailure]);

  // 新增城市后焦点交给「保存并启用」：要等新城市进了选项、按钮可用之后
  const [focusSubmit, setFocusSubmit] = useState(false);
  useEffect(() => {
    if (!focusSubmit || addingCity) return;
    if (submitRef.current && !submitRef.current.disabled) {
      submitRef.current.focus();
      setFocusSubmit(false);
    }
  });

  const current = queue?.[0] ?? null;
  const cityList = cities.state.data;
  const suggestion = current ? (suggestions.get(current.id) ?? null) : null;
  const suggested: readonly CitySuggestion[] = suggestion?.nearby_cities ?? NO_CITIES;
  // 建议是取列表那一刻算的：之后被停用的城市不再当候选
  const nearby = useMemo(() => suggested.filter((city) => !(cityList ?? []).some((known) => known.id === city.id && known.status !== "active")), [suggested, cityList]);

  // 轮到一个机场、而「所属城市」还空着：把建议的城市预先填进去（每个机场只填一次，用户清掉后不再填回去）
  const currentId = current?.id ?? null;
  const suggestedId = nearby[0]?.id ?? null;
  // 每轮到一个机场（包括刚进页面的第一个），焦点都在「所属城市」：这一页就是用来连续按键盘处理的
  useEffect(() => {
    if (currentId !== null) cityRef.current?.focus();
  }, [currentId]);
  useEffect(() => {
    if (currentId === null || suggestion === null || prefilledFor.current === currentId) return;
    prefilledFor.current = currentId;
    if (suggestedId !== null) setDraft((value) => (value !== null && value.cityId === null ? { ...value, cityId: suggestedId } : value));
  }, [currentId, suggestion, suggestedId]);
  const choices = useMemo<ComboboxOption[]>(() => {
    if (current === null || cityList === null) return [];
    const eligible = cityList.filter((city) => city.country_code === current.country_code && city.status === "active");
    const recent = recentCities.flatMap((id) => eligible.filter((city) => city.id === id));
    const listed = [...recent.map((city) => ({ ...cityOption(city), group: "最近用过" })), ...eligible.filter((city) => !recentCities.includes(city.id)).map((city) => ({ ...cityOption(city), ...(recent.length > 0 ? { group: "全部" } : {}) }))];
    // 建议里的城市万一不在清单里（清单取回之后才新增的），也要选得上、显示得出名字
    const missing = nearby.filter((city) => !cityList.some((known) => known.id === city.id)).map((city) => ({ value: city.id, label: displayName(city.name).text, detail: city.code }));
    return [...listed, ...missing];
  }, [current, cityList, recentCities, nearby]);

  /** 换下一个。`left` 是换完以后还剩多少个（跳过的不减）。 */
  const advance = (rest: Place[], left: number, message?: CardNotice): void => {
    setQueue(rest);
    prefilledFor.current = null;
    const next = rest[0] ?? null;
    setDraft(next ? draftOf(next) : null);
    setAttempted(false);
    setCityError(null);
    setSaved(null);
    setNotice(message ?? null);
    setRemaining(left);
    if (next) setAnnounce(`下一个：${label(next)}，还剩 ${formatCount(Math.max(left, rest.length))} 个`);
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView?.({ block: "nearest" });
      cityRef.current?.focus();
    });
  };

  const finish = (place: Place, cityId: string): void => {
    const cityName = displayName(cityList?.find((city) => city.id === cityId)?.name).text;
    setDone((list) => [{ place, cityName }, ...list].slice(0, DONE_LIMIT));
    setRecentCities((list) => [cityId, ...list.filter((id) => id !== cityId)].slice(0, 5));
    advance((queue ?? []).slice(1), Math.max(0, remaining - 1));
  };

  const nameErrors = draft ? localizedErrors("name", "名称", draft.name, NAME_MAX_LENGTH, true) : {};
  const changes = (place: Place, values: Draft): PlacePatch => ({
    ...(sameLocalized(values.name, place.name) ? {} : { name: cleanLocalized(values.name) }),
    ...((values.scope === "none" ? null : values.scope) === place.flight_scope ? {} : { flight_scope: values.scope === "none" ? null : values.scope }),
  });

  const fail = async (err: unknown, place: Place): Promise<void> => {
    if (handleAuthFailure(err)) return;
    if (err instanceof NetworkError) return setNotice({ kind: "danger", text: "网络连接失败，请检查网络后重试。你填写的内容还在。" });
    if (!(err instanceof ApiError)) return setNotice({ kind: "danger", text: "系统暂时无法保存，请稍后再试。你填写的内容还在。" });
    if (err.code === "VERSION_CONFLICT") {
      try {
        const fresh = await getMaster("places", token, place.id);
        if (fresh.city_id !== null) {
          return advance((queue ?? []).slice(1), Math.max(0, remaining - 1), { kind: "info", text: `「${label(place)}」刚被别人处理过了，已为你换到下一个。` });
        }
        setQueue([fresh, ...(queue ?? []).slice(1)]);
        setDraft(draftOf(fresh, draft?.cityId ?? null));
        return setNotice({ kind: "warning", text: "这个机场刚被别人修改过，已载入最新内容，请再确认一次。" });
      } catch (reloadError) {
        if (handleAuthFailure(reloadError)) return;
        return setNotice({ kind: "danger", text: "系统暂时无法保存，请稍后再试。你填写的内容还在。" });
      }
    }
    if (err.code === "CONCURRENT_UPDATE") return setNotice({ kind: "warning", text: "同时有其他人在修改相关数据，这次没有保存成功。请再点一次。" });
    if (err.code === "MASTER_DATA_NOT_READY" || err.code === "VALIDATION_FAILED") {
      // 「指定城市并启用」被拒，先看是不是别人已经给它指定了城市：是的话它不用我处理了
      try {
        const fresh = await getMaster("places", token, place.id);
        if (fresh.city_id !== null) return advance((queue ?? []).slice(1), Math.max(0, remaining - 1), { kind: "info", text: `「${label(place)}」刚被别人处理过了，已为你换到下一个。` });
      } catch (reloadError) {
        if (handleAuthFailure(reloadError)) return;
      }
      if (err.code === "VALIDATION_FAILED" && !JSON.stringify(err.details).includes("city_id")) return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      cities.reload();
      setCityError("这个城市已经停用或不能用于这个机场。请换一个城市。");
      return cityRef.current?.focus();
    }
    if (err.status === 403) return setNotice({ kind: "danger", text: FORBIDDEN_TEXT });
    if (err.status === 404) return advance((queue ?? []).slice(1), Math.max(0, remaining - 1), { kind: "info", text: `找不到「${label(place)}」，它可能已经不存在，已为你换到下一个。` });
    return setNotice({ kind: "danger", text: "系统暂时无法保存，请稍后再试。你填写的内容还在。" });
  };

  const tryEnable = async (place: Place, cityId: string): Promise<void> => {
    setWorking("enable");
    try {
      const enabled = await enableMaster("places", token, place.id);
      toast(`已启用「${shortName(label(enabled))}」`);
      finish(enabled, cityId);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const reason = err instanceof ApiError && err.code === "MASTER_DATA_NOT_READY" ? "所属城市已停用，请先启用城市" : err instanceof NetworkError ? "网络连接失败" : "系统暂时无法启用";
      setSaved(place);
      setNotice({ kind: "warning", text: `城市已经指定好了，但还没有启用：${reason}`, retryEnable: true });
    } finally {
      setWorking(null);
    }
  };

  const submit = async (intent: "enable" | "save"): Promise<void> => {
    if (current === null || draft === null || working !== null || saved !== null) return;
    setAttempted(true);
    const cityId = draft.cityId;
    if (cityId === null) return cityRef.current?.focus();
    if (Object.keys(nameErrors).length > 0) return cardRef.current?.querySelector<HTMLElement>('[data-field="name"] input')?.focus();
    setNotice(null);
    setCityError(null);
    const extra = changes(current, draft);
    setWorking(intent);
    try {
      if (intent === "enable" && Object.keys(extra).length === 0) {
        // 只指定城市：指定和启用在后端是同一个事务，一次完成
        const enabled = await enableMaster("places", token, current.id, cityId);
        toast(`已启用「${shortName(label(enabled))}」`);
        return finish(enabled, cityId);
      }
      const patched = await patchMaster("places", token, current.id, current.version, { city_id: cityId, ...extra });
      if (intent === "save") {
        toast(`已保存「${shortName(label(patched))}」，还没有启用`);
        return finish(patched, cityId);
      }
      setWorking(null);
      await tryEnable(patched, cityId);
    } catch (err) {
      await fail(err, current);
    } finally {
      setWorking(null);
    }
  };

  const skip = (): void => {
    if (current === null || queue === null || working !== null) return;
    setSkipped(new Set([...skipped, current.id]));
    advance([...queue.slice(1), current], remaining);
  };

  const setCountry = (value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete("country");
    else next.set("country", value);
    next.delete("start");
    setParams(next, { replace: true });
  };

  const shell = (content: React.ReactNode): React.ReactNode => (
    <AppShell pageName="处理导入的机场" trail={[{ label: "主数据" }, { label: "地点", to: placeListPath("airport") }]}>
      <Page title="处理导入的机场" width="form" action={<LinkButton to={placeListPath("airport")}>回到地点列表</LinkButton>}>
        {content}
      </Page>
    </AppShell>
  );

  if (account.status === "ready" && !canManage) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />);

  const chosenSuggestion = draft ? (nearby.find((city) => city.id === draft.cityId) ?? null) : null;
  const loading = queue === null && first.state.status !== "error" && first.state.status !== "forbidden" && first.state.status !== "not-found";
  const failed = queue === null && !loading;
  const noCities = current !== null && cityList !== null && choices.length === 0;
  const locked = working !== null || saved !== null;
  const shown = current ? displayName(current.name) : null;
  const imported = current?.source != null && !current.source.overridden;
  const englishChanged = imported && draft !== null && (draft.name.en ?? "").trim() !== (current.name.en ?? "");

  return shell(
    <>
      <p className="page__lead">这些机场是从 OurAirports 导入的，还没有所属城市，所以是停用的。逐个指定城市并启用后，供应商才能选到它们。</p>
      <div className="pending__toolbar">
        <Combobox inline label="国家" clearLabel="全部" placeholder="全部" options={countryOptions} value={country} onChange={setCountry} />
        {queue !== null && <span>{`还剩 ${formatCount(Math.max(remaining, queue.length))} 个`}</span>}
      </div>
      <span className="visually-hidden" role="status">
        {announce}
      </span>
      {loading && (
        <section className="card">
          <Skeleton lines={["short", "long", "medium", "control", "control", "control"]} />
        </section>
      )}
      {failed && (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={first.reload}>
                重试
              </Button>
            }
          />
        </section>
      )}
      {queue !== null && current === null && batchCursor !== null && (
        <section className="card">
          {batchFailed ? (
            <StateBlock
              title="后面的机场没有取到"
              description="还有待指定城市的机场，但这一批没有加载出来。请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={() => setBatchFailed(false)}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton lines={["short", "long", "medium", "control", "control", "control"]} />
          )}
        </section>
      )}
      {queue !== null && current === null && batchCursor === null && (
        <section className="card">
          {country !== null && done.length === 0 ? (
            <StateBlock
              tone="success"
              title={`${countryName(country) ?? country}没有待指定城市的机场`}
              description="导入新的机场后，会出现在这里。"
              action={
                <Button variant="secondary" onClick={() => setCountry(null)}>
                  看全部国家
                </Button>
              }
            />
          ) : (
            <StateBlock
              tone="success"
              title="没有待指定城市的机场了"
              description={done.length > 0 ? "这一批都处理完了。" : "导入新的机场后，会出现在这里。"}
              action={
                <LinkButton variant="primary" to={placeListPath("airport")}>
                  回到地点列表
                </LinkButton>
              }
            />
          )}
        </section>
      )}
      {current !== null && draft !== null && shown !== null && (
        <section className="card" ref={cardRef} aria-labelledby="pending-airport-name">
          <form
            className="form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit("enable");
            }}
          >
            <div role="alert">
              {notice && notice.kind !== "info" && (
                <Alert kind={notice.kind}>
                  <span>{notice.text}</span>
                  {notice.retryEnable && saved && draft.cityId !== null && (
                    <span className="alert__actions">
                      <Button size="sm" loading={working === "enable"} loadingText="启用中…" onClick={() => void tryEnable(saved, draft.cityId ?? "")}>
                        再试一次启用
                      </Button>
                      <Button variant="text" size="sm" disabled={working !== null} onClick={() => finish(saved, draft.cityId ?? "")}>
                        先处理下一个
                      </Button>
                    </span>
                  )}
                </Alert>
              )}
            </div>
            <div role="status">
              {notice && notice.kind === "info" && (
                <Alert kind="info">
                  <span>{notice.text}</span>
                  <span className="alert__actions">
                    <Button variant="text" size="sm" onClick={() => setNotice(null)}>
                      知道了
                    </Button>
                  </span>
                </Alert>
              )}
            </div>
            <div className="pending__head">
              <span className="table__inline">
                <span className="pending__code">{current.code}</span>
                {skipped.has(current.id) && <span className="tag">跳过过</span>}
              </span>
              <StatusBadge {...MASTER_STATUS_BADGES[current.status]} />
            </div>
            <h2 className="pending__name" id="pending-airport-name" lang={shown.lang}>
              {shown.text}
            </h2>
            <p className="pending__facts">
              <span>{countryLabel(current.country_code)}</span>
              <span aria-hidden="true">·</span>
              <span className="table__inline">
                <span className="mono nowrap">{formatPoint(current.location)}</span>
                <CopyButton text={formatPoint(current.location)} label="复制坐标" />
              </span>
              <span aria-hidden="true">·</span>
              <span>{`来源 ${current.source ? "OurAirports" : "手工录入"}`}</span>
            </p>
            <hr className="pending__divider" />
            <div className="pending__city">
              <Combobox
                ref={cityRef}
                label="所属城市"
                required
                options={choices}
                value={draft.cityId}
                placeholder="输入城市名称或编码查找"
                emptyText={`还没有${countryName(current.country_code) ?? current.country_code}的城市`}
                loading={cityList === null && cities.state.status === "loading"}
                loadFailed={cityList === null && cities.state.status === "error"}
                errors={[...(cityError !== null ? [cityError] : []), ...(attempted && draft.cityId === null ? ["请选择所属城市"] : [])]}
                hint={
                  noCities
                    ? `还没有${countryLabel(current.country_code)}的启用中的城市。请先新增城市。`
                    : chosenSuggestion
                      ? `建议：${displayName(chosenSuggestion.name).text}（${formatDistance(chosenSuggestion.distance_km)}）。按机场资料里的所属城市和周边的大城市给出的建议，请核对后再保存。`
                      : `只能选${countryLabel(current.country_code)}的启用中的城市。`
                }
                onChange={(cityId) => {
                  if (locked) return;
                  setDraft({ ...draft, cityId });
                  setCityError(null);
                }}
              />
              <Button variant={noCities ? "primary" : "secondary"} disabled={locked || cityList === null} onClick={() => setAddingCity(true)}>
                新增城市
              </Button>
            </div>
            {nearby.length > 0 && (
              <div className="suggestions" role="group" aria-labelledby="pending-suggestions-lead">
                <p className="suggestions__lead" id="pending-suggestions-lead">
                  <strong>建议的城市</strong>
                  （按机场资料里的所属城市和周边的大城市给出，括号里是到城市中心的直线距离）。建议不一定对，请核对：
                </p>
                <div className="suggestions__list">
                  {nearby.map((city) => (
                    <Button
                      key={city.id}
                      className="suggestions__option"
                      aria-pressed={draft.cityId === city.id}
                      disabled={locked}
                      onClick={() => {
                        setDraft({ ...draft, cityId: city.id });
                        setCityError(null);
                        submitRef.current?.focus();
                      }}
                    >
                      <span lang={displayName(city.name).lang}>{displayName(city.name).text}</span>
                      <span className="suggestions__distance">{formatDistance(city.distance_km)}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div data-field="name">
              <LocalizedInput
                legend="名称"
                required
                busy={locked}
                value={draft.name}
                errors={attempted ? (nameErrors["name"] ?? []) : []}
                languageErrors={languageErrors((field) => (attempted ? (nameErrors[field] ?? []) : []), "name")}
                hint={imported ? (englishChanged ? "保存后，这个机场的英语名和坐标不再随 OurAirports 更新。" : "英语名来自 OurAirports。在这里改过以后，再导入时不再更新它。") : "至少填一种语言。"}
                onChange={(name) => setDraft({ ...draft, name })}
              />
            </div>
            <RadioGroup legend="国际 / 国内（选填）" name="pending-flight-scope" disabled={locked} options={SCOPE_OPTIONS} value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })} />
            <div className="pending__actions">
              <Button ref={submitRef} type="submit" variant="primary" disabled={noCities || saved !== null || working === "save"} loading={working === "enable" && saved === null} loadingText="保存中…">
                保存并启用
              </Button>
              <Button disabled={noCities || saved !== null || working === "enable"} loading={working === "save"} loadingText="保存中…" onClick={() => void submit("save")}>
                只保存，先不启用
              </Button>
              <Button variant="text" disabled={locked} onClick={skip}>
                跳过
              </Button>
              {noCities && <span className="field__hint">请先选择所属城市</span>}
            </div>
          </form>
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="pending-done-title">
          <h2 className="form-group__title" id="pending-done-title">
            本次已处理
          </h2>
          <ul className="done-list">
            {done.map(({ place, cityName }) => (
              <li key={place.id} className="done-list__item">
                <span className="mono">{place.code}</span>
                <span lang={displayName(place.name).lang}>{displayName(place.name).text}</span>
                <span>{`→ ${cityName}`}</span>
                <StatusBadge {...MASTER_STATUS_BADGES[place.status]} />
                <LinkButton variant="text" size="sm" to={masterEditPath("places", place.id)} aria-label={`编辑 ${place.code}`}>
                  编辑
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Attributions sources={["ourairports", "geonames"]} />
      {addingCity && current !== null && cityList !== null && (
        <NewCityDialog
          airport={current}
          cities={cityList}
          onClose={() => setAddingCity(false)}
          onCreated={(city) => {
            setAddingCity(false);
            cities.set([...cityList, city]);
            if (draft) setDraft({ ...draft, cityId: city.id });
            setCityError(null);
            toast(`已新增城市「${shortName(displayName(city.name).text)}」`);
            setFocusSubmit(true);
          }}
        />
      )}
    </>,
  );
}
