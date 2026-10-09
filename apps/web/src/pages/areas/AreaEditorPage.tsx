/**
 * 新增 / 编辑区域（docs/design/pages/tenant-areas.md 第 3–10 节）：选城市、起名字，画出营运区和禁行区，自测，保存。
 * DOM 顺序固定：基本信息 → 绘制工具条 → 地图 → 图形列表与坐标表 → 自测 → 操作区；没有地图也能完成全部操作。
 */
import { AREA_BIZ_TYPES, AREA_BIZ_TYPE_NAMES, AREA_LIMITS, type AreaBizType, type AreaPolygonKind, type LocalizedText, hasVisibleText } from "@nozomi/domain";
import { Component, type FormEvent, type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type Area, type MapConfig, createArea, fetchMapConfig, getArea, listTenantCities, updateArea } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FieldErrors, LocalizedInput, RadioGroup, StaticField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { EMPTY_EDITOR, type EditorShape, areaProblems, editorReducer, hasBlockingProblems, sameShapes, shapeName, shapeProblems, shapeWarnings, shapesToGeoJson, toPolygonInputs } from "../../lib/area-editor.ts";
import { areaProblemText, ringProblemText, shapeProblemText } from "../../lib/area-messages.ts";
import { AREA_LIST_PATH } from "../../lib/area-paths.ts";
import { PRODUCT_LIST_PATH } from "../../lib/product-paths.ts";
import { INPUT_LANGUAGES, MASTER_STATUS_BADGES, cleanLocalized, countryLabel, displayName, formatLocalDateTime, sameLocalized, shortName } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLeaveGuard } from "../../lib/use-leave-guard.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { readListPage } from "../master/shared.tsx";
import { AreaMap, type MapTool, Swatch } from "./AreaMap.tsx";
import { PasteDialog, type PasteRequest } from "./PasteDialog.tsx";
import { type ProbeResult, SelfTest } from "./SelfTest.tsx";
import { ShapeList } from "./ShapeList.tsx";
import { AREA_FORBIDDEN_TEXT, AreaMoreItems, useAreaActions } from "./useAreaActions.tsx";

const BIZ_HINTS: Readonly<Record<AreaBizType, string>> = {
  general: "三类商品都可以用。",
  airport_transfer: "只给接送机商品用。只看不是机场（或车站）的那一头在不在营运区。",
  point_to_point: "只给点对点商品用。上车点和下车点都要在营运区。",
  charter: "只给包车商品用。只看上车点在不在营运区。",
};
const BIZ_OPTIONS = AREA_BIZ_TYPES.map((value) => ({ value, label: AREA_BIZ_TYPE_NAMES[value], hint: BIZ_HINTS[value] }));
const KIND_OPTIONS: readonly { value: AreaPolygonKind; label: string }[] = [
  { value: "operate", label: "营运区" },
  { value: "forbid", label: "禁行区" },
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESERVED = "你画的图形和填的内容都还在。";

interface TopNotice {
  kind: AlertKind;
  title?: string;
  text: string;
  action?: ReactNode;
}

interface Problem {
  /** 点了跳到哪：字段名，或图形的 key */
  target: { field: string } | { shape: string };
  text: string;
}

function returnTo(state: unknown): string {
  const from = typeof state === "object" && state !== null ? (state as { from?: unknown }).from : undefined;
  return typeof from === "string" && (from === AREA_LIST_PATH || from.startsWith(`${AREA_LIST_PATH}?`)) ? from : AREA_LIST_PATH;
}

export function AreaEditorPage() {
  const { id } = useParams();
  const mode = id === undefined ? "new" : "edit";
  const validId = id === undefined || UUID_PATTERN.test(id);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { portal, token, account, handleAuthFailure } = usePortalSession();
  const canRead = useTenantCan("area.read");
  const canManage = useTenantCan("area.manage");
  const canSeeProducts = useTenantCan("product.read");

  const loaded = useLoad<Area>(`area:${id ?? "new"}`, id !== undefined && validId && canRead ? (authToken) => getArea(authToken, id) : null);
  const area = mode === "edit" ? loaded.state.data : null;
  const cities = useLoad<City[]>("tenant-cities-active", mode === "new" && canManage ? (authToken) => listTenantCities(authToken) : null);
  const mapConfig = useLoad<MapConfig>("map-config", canRead ? fetchMapConfig : null);

  const [cityId, setCityId] = useState<string | null>(null);
  const [name, setName] = useState<LocalizedText>({});
  const [bizType, setBizType] = useState<AreaBizType>("general");
  const [bizLocked, setBizLocked] = useState(false);
  const [confirmingShapes, setConfirmingShapes] = useState(false);
  // 从商品页面的「新增区域」过来：/areas/new?city=&biz= 预先选好；参数不认识就当没带。预先选上的不算「有修改」
  const [search] = useSearchParams();
  const [prefilledCity, setPrefilledCity] = useState<string | null>(null);
  const [editor, dispatch] = useReducer(editorReducer, EMPTY_EDITOR);
  const [initial, setInitial] = useState<{ name: LocalizedText; bizType: AreaBizType; shapes: readonly EditorShape[] }>({ name: {}, bizType: "general", shapes: [] });
  const [adopted, setAdopted] = useState<string | null>(null);
  const [tool, setTool] = useState<MapTool>("select");
  const [newKind, setNewKind] = useState<AreaPolygonKind>("operate");
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<TopNotice | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [serverShapeProblems, setServerShapeProblems] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [paste, setPaste] = useState<PasteRequest | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [mapBroken, setMapBroken] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const rootRef = useRef<HTMLDivElement>(null);

  // 取到区域（第一次，或「载入最新内容」之后）就换到页面上
  const areaKey = area ? `${area.id}:${area.version}` : null;
  useEffect(() => {
    if (area === null || areaKey === adopted || (adopted !== null && !conflict)) return;
    dispatch({ type: "load", polygons: area.polygons });
    // 载入后的那一份就是「打开时的样子」，之后拿它判断有没有改过
    setInitial({ name: area.name, bizType: area.biz_type, shapes: editorReducer(EMPTY_EDITOR, { type: "load", polygons: area.polygons }).shapes });
    setCityId(area.city_id);
    setName(area.name);
    setBizType(area.biz_type);
    setAdopted(areaKey);
    setAttempted(false);
    setFieldErrors({});
    setServerShapeProblems({});
    setProbe(null);
    setFitSignal((value) => value + 1);
    if (conflict) {
      setConflict(false);
      setNotice({ kind: "info", text: "已载入最新内容。" });
    }
  }, [area, areaKey, adopted, conflict]);
  const wantedCity = mode === "new" ? search.get("city") : null;
  const wantedBiz = mode === "new" ? search.get("biz") : null;
  const cityList = cities.state.data;
  useEffect(() => {
    if (wantedBiz !== null && (AREA_BIZ_TYPES as readonly string[]).includes(wantedBiz)) {
      setBizType(wantedBiz as AreaBizType);
      setInitial((current) => ({ ...current, bizType: wantedBiz as AreaBizType }));
    }
  }, [wantedBiz]);
  useEffect(() => {
    if (wantedCity === null || cityList === null || cityId !== null || prefilledCity !== null) return;
    if (cityList.some((entry) => entry.id === wantedCity)) {
      setCityId(wantedCity);
      setPrefilledCity(wantedCity);
    }
  }, [wantedCity, cityList]);

  const readOnly = mode === "edit" && !canManage;
  const city = area?.city ?? cities.state.data?.find((entry) => entry.id === cityId) ?? null;
  const cityName = city ? displayName(city.name).text : "";
  const shown = area ? displayName(area.name) : null;
  const pageTitle = mode === "new" ? "新增区域" : (shown?.text ?? "区域");
  useDocumentTitle(mode === "new" ? `新增区域 · NOZOMI ${portal.name}` : `${pageTitle} · 区域 · NOZOMI ${portal.name}`);

  const shapesDirty = !sameShapes(editor.shapes, initial.shapes);
  const dirty = !readOnly && (shapesDirty || !sameLocalized(name, initial.name) || bizType !== initial.bizType || (mode === "new" && cityId !== prefilledCity));
  const usedBy = area?.usage?.product_count ?? 0;
  const publishedUsers = area?.usage?.published_product_count ?? 0;
  useLeaveGuard(dirty && !submitting && !discarded, setLeaving);

  const backTo = returnTo(location.state);
  const goBack = (): void => {
    const listPage = readListPage(location.state);
    void navigate(backTo, listPage ? { state: { listPage } } : {});
  };

  const actions = useAreaActions({
    onChanged: (next) => loaded.set({ ...(area as Area), ...next }),
    onDeleted: () => {
      setDiscarded(true);
      void navigate(AREA_LIST_PATH);
    },
  });

  const warnings = useMemo(() => shapeWarnings(editor.shapes, city ? { lat: city.center.lat, lng: city.center.lng } : null), [editor.shapes, city]);
  const overall = useMemo(() => areaProblems(editor.shapes), [editor.shapes]);

  // 提交时要改的地方：城市 → 名称 → 图形（按列表从上到下）
  const problems: Problem[] = [];
  if (mode === "new" && cityId === null) problems.push({ target: { field: "city" }, text: "城市：请选择城市" });
  if (!INPUT_LANGUAGES.some(({ key }) => hasVisibleText(name[key] ?? ""))) problems.push({ target: { field: "name" }, text: "名称：请至少填一种语言的名称" });
  const longNames = INPUT_LANGUAGES.filter(({ key }) => (name[key] ?? "").trim().length > AREA_LIMITS.maxNameLength);
  for (const language of longNames) problems.push({ target: { field: "name" }, text: `名称：${language.label}名称最多 ${AREA_LIMITS.maxNameLength} 个字` });
  for (const problem of overall) problems.push({ target: { field: "polygons" }, text: areaProblemText(problem.reason, problem as Record<string, unknown>) ?? "" });
  for (const shape of editor.shapes) for (const problem of shapeProblems(shape)) problems.push({ target: { shape: shape.key }, text: `${shapeName(shape)}：${shapeProblemText(problem)}` });

  const jump = (target: Problem["target"]): void => {
    if ("shape" in target) {
      dispatch({ type: "select", key: target.shape });
      requestAnimationFrame(() => {
        const node = rootRef.current?.querySelector<HTMLElement>(`[data-shape="${target.shape}"]`);
        (node?.querySelector<HTMLElement>("input") ?? node?.querySelector<HTMLElement>("button"))?.focus();
        node?.scrollIntoView?.({ block: "center" });
      });
      return;
    }
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-field="${target.field}"]`);
    (node?.querySelector<HTMLElement>("input") ?? node?.querySelector<HTMLElement>("button"))?.focus();
    node?.scrollIntoView?.({ block: "center" });
  };

  const fail = (err: unknown): void => {
    if (handleAuthFailure(err)) return;
    if (err instanceof NetworkError) return setNotice({ kind: "danger", text: `网络连接失败，请检查网络后重试。${PRESERVED}` });
    if (!(err instanceof ApiError)) return setNotice({ kind: "danger", text: `系统暂时无法保存，请稍后再试。${PRESERVED}` });
    switch (err.code) {
      case "VALIDATION_FAILED": {
        const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: unknown; message?: unknown; reason?: unknown; detail?: unknown }[]) : [];
        const fields: Record<string, string[]> = {};
        const byShape: Record<string, string[]> = {};
        let unplaced = 0;
        for (const issue of issues) {
          const path = typeof issue.path === "string" ? issue.path : "";
          const reason = typeof issue.reason === "string" ? issue.reason : "";
          const detail = typeof issue.detail === "object" && issue.detail !== null ? (issue.detail as Record<string, unknown>) : {};
          const fallback = typeof issue.message === "string" && /[一-鿿]/.test(issue.message) ? issue.message : "这一项不符合要求，请检查后重试";
          const polygon = /^\/polygons\/(\d+)/.exec(path);
          const shape = polygon ? editor.shapes[Number(polygon[1])] : undefined;
          if (shape) byShape[shape.key] = [...(byShape[shape.key] ?? []), ringProblemText(reason, detail) ?? fallback];
          else if (path === "/polygons") fields["polygons"] = [...(fields["polygons"] ?? []), areaProblemText(reason, detail) ?? fallback];
          else if (path.startsWith("/name")) fields["name"] = [...(fields["name"] ?? []), fallback];
          else if (path === "/city_id") fields["city"] = [...(fields["city"] ?? []), fallback];
          else if (path === "/biz_type") fields["bizType"] = [...(fields["bizType"] ?? []), fallback];
          else unplaced += 1;
        }
        setFieldErrors(fields);
        setServerShapeProblems(byShape);
        const firstShape = Object.keys(byShape)[0];
        const firstField = Object.keys(fields)[0];
        if (firstField !== undefined) jump({ field: firstField });
        else if (firstShape !== undefined) jump({ shape: firstShape });
        if (unplaced > 0 || (firstField === undefined && firstShape === undefined)) setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
        return;
      }
      case "BAD_REQUEST":
        return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      case "AREA_NAME_TAKEN":
        setFieldErrors({ name: [`${cityName === "" ? "这个城市" : cityName}已经有同名的区域了，请换一个名称。`] });
        return jump({ field: "name" });
      case "VERSION_CONFLICT":
        setConflict(true);
        return setNotice({
          kind: "warning",
          title: "这个区域刚被别人修改过，你的修改还没有保存。",
          text: "两边的修改不能自动合并。你可以先把自己画的图形复制出来，再载入最新内容，然后把要保留的部分粘贴回去。",
          action: (
            <>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(shapesToGeoJson(editor.shapes)).then(
                    () => toast("已复制"),
                    () => undefined,
                  );
                }}
              >
                复制我画的图形
              </Button>
              <Button size="sm" onClick={loaded.reload}>
                载入最新内容
              </Button>
            </>
          ),
        });
      case "CONCURRENT_UPDATE":
        return setNotice({ kind: "warning", text: "同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。" });
      case "IDEMPOTENCY_KEY_REUSED":
        return setNotice({ kind: "warning", text: "这次保存和刚才那一次撞在了一起。请刷新页面后重试。" });
      case "MASTER_DATA_NOT_READY":
        cities.reload();
        setFieldErrors({ city: ["这个城市已经被平台停用，不能在它下面新增区域。请换一个城市。"] });
        return jump({ field: "city" });
      case "FIELD_LOCKED":
        if (Array.isArray(err.details["fields"]) && (err.details["fields"] as unknown[]).includes("biz_type")) {
          setBizType(initial.bizType);
          setBizLocked(true);
          setFieldErrors({ bizType: ["已有商品在用这个区域，不能改业务类型。"] });
          return jump({ field: "bizType" });
        }
        return setNotice({ kind: "danger", text: "城市创建后不能修改。请刷新页面后重试。" });
      default:
        if (err.status === 403) {
          setBlocked("没有修改权限");
          return setNotice({ kind: "danger", text: AREA_FORBIDDEN_TEXT });
        }
        if (err.status === 404) {
          setBlocked("这个区域已经不存在");
          return setNotice({ kind: "danger", text: "找不到这个区域，它可能已被别人删除。你画的图形还在：可以在每一块的「更多」里复制坐标，再新增一个区域粘贴进去。" });
        }
        return setNotice({ kind: "danger", text: `系统暂时无法保存，请稍后再试。${PRESERVED}` });
    }
  };

  const save = async (event?: FormEvent, confirmed = false): Promise<void> => {
    event?.preventDefault();
    if (submitting || conflict || blocked !== null) return;
    setAttempted(true);
    setFieldErrors({});
    setServerShapeProblems({});
    const first = problems[0];
    if (first) return jump(first.target);
    if (mode === "edit" && !dirty) return goBack();
    // 改了图形、而这个区域正被已上架的商品使用：先确认（报价范围会跟着变）
    if (!confirmed && shapesDirty && publishedUsers > 0) return setConfirmingShapes(true);
    setConfirmingShapes(false);
    setNotice(null);
    setSubmitting(true);
    try {
      const body = { name: cleanLocalized(name), biz_type: bizType, polygons: toPolygonInputs(editor.shapes) };
      const saved = mode === "edit" && area ? await updateArea(token, area.id, area.version, body) : await createArea(token, { city_id: cityId ?? "", ...body }, idempotencyKey);
      toast(mode === "edit" ? `已保存「${shortName(displayName(saved.name).text)}」` : `已新增区域「${shortName(displayName(saved.name).text)}」`);
      setDiscarded(true);
      goBack();
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const trail = [{ label: "商品配置" }, { label: "区域", to: AREA_LIST_PATH }];
  const shell = (content: ReactNode, header: { action?: ReactNode; meta?: ReactNode } = {}): ReactNode => (
    <AppShell pageName={pageTitle} trail={trail}>
      <Page title={pageTitle} {...(shown ? { titleLang: shown.lang } : {})} width="content" {...header}>
        {content}
      </Page>
    </AppShell>
  );
  const forbidden = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;
  const backButton = (
    <LinkButton variant="primary" to={AREA_LIST_PATH}>
      回到区域列表
    </LinkButton>
  );
  if (account.status === "ready" && (!canRead || (mode === "new" && !canManage))) return shell(forbidden);
  if (!validId || loaded.state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这个区域" description="它可能已被删除，或链接有误。" action={backButton} />);
  if (loaded.state.status === "forbidden") return shell(forbidden);
  if (mode === "edit" && area === null && loaded.state.status === "error") {
    return shell(
      <section className="card">
        <StateBlock
          title="加载失败"
          description="请检查网络后重试。"
          action={
            <Button variant="secondary" onClick={loaded.reload}>
              重试
            </Button>
          }
        />
      </section>,
    );
  }
  if (account.status !== "ready" || (mode === "edit" && (area === null || adopted === null))) {
    return shell(
      <section className="card">
        <Skeleton lines={["control", "control", "long", "medium"]} />
      </section>,
    );
  }

  const tiles = mapConfig.state.data?.tiles ?? null;
  const mapUsable = tiles !== null && !mapBroken;
  const full = editor.shapes.length >= AREA_LIMITS.maxPolygons;
  const canDraw = !readOnly && !submitting && city !== null && !full;
  const nameErrors = [...(fieldErrors["name"] ?? []), ...(attempted ? problems.filter((problem) => "field" in problem.target && problem.target.field === "name").map((problem) => problem.text.replace(/^名称：/, "")) : [])];
  const blockingCount = problems.length;
  const header =
    mode === "edit" && area
      ? {
          meta: (
            <>
              <StatusBadge {...MASTER_STATUS_BADGES[area.status]} />
              <span>{displayName(area.city.name).text}</span>
              <span>{`最近修改 ${formatLocalDateTime(area.updated_at)}`}</span>
            </>
          ),
          ...(canManage
            ? {
                action: (
                  <Dropdown buttonClassName="button button--secondary button--md" buttonContent="更多" label={`${pageTitle} 的更多操作`} align="end">
                    <AreaMoreItems area={area} actions={actions} />
                  </Dropdown>
                ),
              }
            : {}),
        }
      : {};

  return shell(
    <div ref={rootRef} className="area-editor">
      {actions.notice}
      {readOnly && <Alert kind="info">你可以查看区域，但不能修改。需要修改的话，请联系你们的管理员开通。</Alert>}
      <div role="alert">
        {attempted && blockingCount > 0 && (
          <Alert kind="danger">
            <strong className="alert__title">{`有 ${blockingCount} 处需要修改`}</strong>
            <span className="error-summary__list">
              {problems.map((problem, index) => (
                <button key={index} type="button" className="link error-summary__item" onClick={() => jump(problem.target)}>
                  {problem.text}
                </button>
              ))}
            </span>
          </Alert>
        )}
        {notice && (notice.kind === "danger" || notice.kind === "warning") && (
          <Alert kind={notice.kind}>
            {notice.title && <strong className="alert__title">{notice.title}</strong>}
            <span>{notice.text}</span>
            {notice.action && <span className="alert__actions">{notice.action}</span>}
          </Alert>
        )}
      </div>
      <div role="status">{notice && notice.kind === "info" && <Alert kind="info">{notice.text}</Alert>}</div>
      <div className="area-editor__layout">
        <section className="card area-editor__basic" aria-labelledby="area-basic-title">
          <h2 className="card__title" id="area-basic-title">
            基本信息
          </h2>
          <form className="form" noValidate onSubmit={(event) => void save(event)}>
            <div data-field="city">
              {mode === "edit" || readOnly ? (
                <StaticField label="城市" hint="创建后不能修改。要换城市，请新增一个区域。">
                  {city ? `${cityName}（${city.code}）` : "—"}
                </StaticField>
              ) : (
                <Combobox
                  label="城市"
                  required
                  options={(cities.state.data ?? []).map((entry) => ({ value: entry.id, label: displayName(entry.name).text, detail: entry.code, keywords: `${Object.values(entry.name).join(" ")} ${countryLabel(entry.country_code)}` }))}
                  value={cityId}
                  placeholder="输入城市名称或编码查找"
                  emptyText="平台还没有启用中的城市"
                  loading={cities.state.data === null && cities.state.status === "loading"}
                  loadFailed={cities.state.data === null && cities.state.status === "error"}
                  errors={[...(fieldErrors["city"] ?? []), ...(attempted && cityId === null ? ["请选择城市"] : [])]}
                  hint="区域属于一个城市，创建后不能修改。"
                  onChange={(next) => {
                    setCityId(next);
                    setFieldErrors(({ city: _city, ...rest }) => rest);
                  }}
                />
              )}
            </div>
            <div data-field="name">
              <LocalizedInput
                legend="名称"
                required
                readOnly={readOnly}
                busy={submitting}
                value={name}
                errors={nameErrors}
                hint="给自己人看的名字，建商品时按它来选区域。例如「东京 23 区」「成田机场周边」。"
                onChange={(next) => {
                  setName(next);
                  setFieldErrors(({ name: _name, ...rest }) => rest);
                }}
              />
            </div>
            <div data-field="bizType">
{usedBy > 0 || bizLocked ? (
                <div className="field">
                  <span className="field__label">业务类型</span>
                  <p className="field__static">{AREA_BIZ_TYPE_NAMES[bizType]}</p>
                  <FieldErrors id="biz-type-error" errors={fieldErrors["bizType"] ?? []} />
                  <p className="field__hint">
                    {usedBy > 0 ? `已有 ${usedBy} 个商品在用这个区域，不能改业务类型。` : "已有商品在用这个区域，不能改业务类型。"}
                    {area && canSeeProducts && (
                      <>
                        {" "}
                        <Link className="link" to={`${PRODUCT_LIST_PATH}?area=${area.id}`}>
                          查看这些商品
                        </Link>
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <RadioGroup<AreaBizType> legend="业务类型" name="biz-type" required readOnly={readOnly} disabled={submitting} options={BIZ_OPTIONS} value={bizType} errors={fieldErrors["bizType"] ?? []} hint="建商品时，只能选到业务类型和商品品类相同的区域，或「通用」的区域。不管哪一类，上车点或下车点只要落在禁行区，就不报价。" onChange={setBizType} />
              )}
            </div>
          </form>
        </section>

        <div className="area-editor__map">
          {!readOnly && (
            <div className="draw-bar" role="toolbar" aria-label="绘制工具">
              <div className="draw-bar__tools">
                <Button size="sm" aria-pressed={tool === "select"} onClick={() => setTool("select")}>
                  选择
                </Button>
                <Button size="sm" aria-pressed={tool === "polygon"} disabled={!canDraw || !mapUsable} onClick={() => setTool("polygon")}>
                  画多边形
                </Button>
                <Button size="sm" aria-pressed={tool === "circle"} disabled={!canDraw || !mapUsable} onClick={() => setTool("circle")}>
                  画圆
                </Button>
                <Button size="sm" disabled={readOnly || submitting || full} onClick={() => setPaste({ kind: newKind })}>
                  粘贴坐标
                </Button>
              </div>
              <fieldset className="draw-bar__kind">
                <legend className="visually-hidden">新图形是</legend>
                <span aria-hidden="true">新图形是</span>
                {KIND_OPTIONS.map((option) => (
                  <label key={option.value} className="choice">
                    <input type="radio" name="new-kind" value={option.value} checked={newKind === option.value} onChange={() => setNewKind(option.value)} />
                    <Swatch kind={option.value} />
                    <span className="choice__text">{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <div className="draw-bar__tools">
                <Button size="sm" disabled={editor.past.length === 0 || submitting} onClick={() => dispatch({ type: "undo" })}>
                  <Icon name="undo" />
                  撤销
                </Button>
                <Button size="sm" disabled={editor.future.length === 0 || submitting} onClick={() => dispatch({ type: "redo" })}>
                  <Icon name="redo" />
                  重做
                </Button>
              </div>
              {city === null && <p className="field__hint">请先选择城市</p>}
              {full && <p className="field__hint">{`一个区域最多 ${AREA_LIMITS.maxPolygons} 块图形`}</p>}
            </div>
          )}
          {city === null ? (
            <p className="area-map-placeholder">先选城市，地图会移到那里。</p>
          ) : mapConfig.state.status === "loading" && mapConfig.state.data === null ? (
            <p className="area-map-placeholder" role="status">
              正在加载地图…
            </p>
          ) : mapUsable && tiles ? (
            <MapBoundary onBroken={() => setMapBroken(true)}>
              <AreaMap
                tiles={tiles}
                shapes={editor.shapes}
                selected={editor.selected}
                dispatch={dispatch}
                readOnly={readOnly || submitting}
                tool={tool}
                newKind={newKind}
                onToolDone={() => setTool("select")}
                onProbe={(point) => setPicked({ ...point, at: Date.now() })}
                probe={probe}
                cityCenter={{ lat: city.center.lat, lng: city.center.lng }}
                fitSignal={fitSignal}
              />
            </MapBoundary>
          ) : (
            <p className="area-map-placeholder">{tiles === null && mapConfig.state.status === "ready" ? "这个环境没有配置地图底图。" : "地图没有加载出来。"}用「图形」里的坐标表、粘贴坐标和自测，可以完成全部操作。</p>
          )}
        </div>

        <section className="card area-editor__shapes" aria-labelledby="area-shapes-title">
          <h2 className="card__title" id="area-shapes-title">
            图形
          </h2>
          <ShapeList
            state={editor}
            dispatch={dispatch}
            readOnly={readOnly}
            busy={submitting}
            attempted={attempted || (fieldErrors["polygons"]?.length ?? 0) > 0}
            cityName={cityName}
            warnings={warnings}
            serverProblems={serverShapeProblems}
            areaProblems={overall}
            onPaste={(kind, replaceKey) => {
              const target = editor.shapes.find((shape) => shape.key === replaceKey);
              setPaste(target ? { kind, replace: { key: target.key, name: shapeName(target) } } : { kind });
            }}
          />
          {(fieldErrors["polygons"] ?? []).map((message) => (
            <p key={message} className="field__error">
              {message}
            </p>
          ))}
        </section>

        <section className="card area-editor__probe" aria-labelledby="area-probe-title">
          <h2 className="card__title" id="area-probe-title">
            自测
          </h2>
          <SelfTest
            shapes={editor.shapes}
            areaId={area?.id ?? null}
            shapesDirty={shapesDirty || hasBlockingProblems(editor.shapes)}
            disabledArea={area?.status === "disabled"}
            mapAvailable={mapUsable && city !== null}
            picking={tool === "probe"}
            onTogglePick={() => setTool(tool === "probe" ? "select" : "probe")}
            picked={picked}
            result={probe}
            onResult={setProbe}
            onSelectShape={(key) => dispatch({ type: "select", key })}
          />
        </section>

        {!readOnly && (
          <div className="form-bar area-editor__bar">
            <span className="form-bar__note area-editor__summary">
              {`营运区 ${editor.shapes.filter((shape) => shape.kind === "operate").length} 块 · 禁行区 ${editor.shapes.filter((shape) => shape.kind === "forbid").length} 块`}
              {dirty ? " · 有未保存的修改" : ""}
              {conflict ? " · 请先载入最新内容" : ""}
              {blocked !== null ? ` · ${blocked}` : ""}
            </span>
            <Button variant="text" disabled={submitting} onClick={() => (dirty ? setLeaving("") : goBack())}>
              取消
            </Button>
            <Button variant="primary" disabled={conflict || blocked !== null} loading={submitting} loadingText="保存中…" onClick={() => void save()}>
              保存
            </Button>
          </div>
        )}
      </div>

      {readOnly && (
        <div>
          <LinkButton to={backTo}>回到列表</LinkButton>
        </div>
      )}
      {actions.dialog}
      {paste && (
        <PasteDialog
          request={paste}
          existingCount={editor.shapes.length}
          onClose={() => setPaste(null)}
          onSubmit={(kind, parsed, replaceKey) => {
            setPaste(null);
            if (replaceKey !== undefined) {
              const ring = parsed.polygons[0]?.outer ?? [];
              dispatch({ type: "replaceRing", key: replaceKey, ring });
              toast("已替换");
            } else {
              dispatch({ type: "addParsed", kind, parsed });
              const count = parsed.polygons.length + (kind === "operate" ? parsed.polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0) : 0);
              toast(`已添加 ${count} 块图形`);
            }
            setFitSignal((value) => value + 1);
          }}
        />
      )}
      <Dialog
        open={confirmingShapes}
        title="保存对图形的修改？"
        onClose={() => setConfirmingShapes(false)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setConfirmingShapes(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void save(undefined, true)}>
              保存
            </Button>
          </>
        }
      >
        <p>
          有 <strong>{`${publishedUsers} 个已上架的商品`}</strong>在用这个区域。保存后，这些商品的报价范围会跟着变，大约 1 分钟内生效。
        </p>
        {area && canSeeProducts && (
          <p>
            <Link className="link" to={`${PRODUCT_LIST_PATH}?area=${area.id}&status=published`}>
              查看这些商品
            </Link>
          </p>
        )}
      </Dialog>
      <Dialog
        open={leaving !== null}
        title="有未保存的修改，确定离开吗？"
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setLeaving(null)}>
              继续编辑
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                setDiscarded(true);
                if (to === null || to === "") goBack();
                else void navigate(to);
              }}
            >
              离开
            </Button>
          </>
        }
      >
        <p>离开后，这次画的图形和改的内容不会保存。</p>
      </Dialog>
    </div>,
    header,
  );
}

/** 地图库自己出了错（初始化失败等）：换成没有地图的页面，别的部分照常可用。 */

class MapBoundary extends Component<{ children: ReactNode; onBroken(): void }, { broken: boolean }> {
  override state = { broken: false };

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  override componentDidCatch(): void {
    this.props.onBroken();
  }

  override render(): ReactNode {
    return this.state.broken ? null : this.props.children;
  }
}
