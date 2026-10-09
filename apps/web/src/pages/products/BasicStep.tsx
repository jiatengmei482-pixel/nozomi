/**
 * ① 基础信息（docs/design/pages/tenant-products.md 第 4 节）：
 * 创建后不能修改的四项（子品牌、城市、品类、接送点），服务区域（顺序就是优先级）、车型组（各选一个「人数 / 行李数」）、调度人。
 * 新建页第一次保存 = 创建商品；之后每次保存只带区域、车型组、调度人。
 */
import { AREA_BIZ_TYPE_NAMES, type AreaBizType, type LocalizedText, type MasterDataStatus, PRODUCT_CATEGORY_NAMES, PRODUCT_LIMITS, type ServiceCategory, VEHICLE_GRADES, areaUsableByCategory, emptyServiceRules, isPhoneNumber, publishCheck } from "@nozomi/domain";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { type AreaSummary, listTenantCities } from "../../api/areas.ts";
import type { City, Place, VehicleGroup } from "../../api/master.ts";
import { type Brand, type Product, type ProductPatch, createProduct, listAllAreas, listBrands, listPickupPlaces, listTenantVehicleGroups, patchProduct } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button, IconButton, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FieldErrors, RadioGroup, StaticField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PickerPanel } from "../../components/PickerPanel.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { AREA_LIST_PATH, AREA_NEW_PATH, areaEditPath } from "../../lib/area-paths.ts";
import { PLACE_TYPE_NAMES, countryLabel, displayName, vehicleGradeName } from "../../lib/master-display.ts";
import { checkReasons, comboText } from "../../lib/product-display.ts";
import type { ServerIssue } from "../../lib/product-failure.ts";
import { productPath } from "../../lib/product-paths.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { BrandDialog } from "./BrandDialog.tsx";
import { type StepController, StepShell } from "./StepShell.tsx";
import type { ProductFrame, StepProblem } from "./frame.ts";

const CATEGORY_OPTIONS: readonly { value: ServiceCategory; label: string; hint: string }[] = [
  { value: "airport_transfer", label: PRODUCT_CATEGORY_NAMES.airport_transfer, hint: "机场或车站 ↔ 市内，分接和送。一个商品对应一个机场或车站。" },
  { value: "point_to_point", label: PRODUCT_CATEGORY_NAMES.point_to_point, hint: "市内任意两点之间，上车点和下车点都要在服务区域里。" },
  { value: "charter", label: PRODUCT_CATEGORY_NAMES.charter, hint: "按小时包一辆车，卖的是套餐（如 5 小时、10 小时）。" },
];

interface AreaPick {
  id: string;
  name: LocalizedText;
  biz: AreaBizType;
  status: MasterDataStatus;
}
interface GroupPick {
  id: string;
  /** 选的组合，写成「人数-行李数」；还没选是空的 */
  combo: string;
}
interface DispatcherRow {
  name: string;
  phone: string;
}
type GroupInfo = Pick<VehicleGroup, "id" | "code" | "name" | "grade" | "seats" | "sample_models" | "combos" | "status">;

const comboKey = (passengers: number, luggage: number): string => `${passengers}-${luggage}`;
const cleanDispatchers = (rows: readonly DispatcherRow[]): DispatcherRow[] => rows.map((row) => ({ name: row.name.trim(), phone: row.phone.trim() })).filter((row) => row.name !== "" || row.phone !== "");
const gradeOrder = (group: GroupInfo): string => `${VEHICLE_GRADES.indexOf(group.grade)}|${String(group.seats).padStart(3, "0")}|${group.code}`;

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="field__hint field__hint--warning">
      <Icon name="alert-triangle" />
      <span>{children}</span>
    </p>
  );
}

export function BasicStep({ frame }: { frame: ProductFrame }) {
  const { product, readOnly } = frame;
  const creating = product === null;
  const { token } = usePortalSession();
  const location = useLocation();
  const canManageBrands = useTenantCan("brand.manage");
  const canManageAreas = useTenantCan("area.manage");
  const canReadAreas = useTenantCan("area.read");

  const brands = useLoad<Brand[]>("tenant-brands", creating ? listBrands : null);
  const cities = useLoad<City[]>("tenant-cities-active", creating ? (authToken) => listTenantCities(authToken) : null);
  const allAreas = useLoad<AreaSummary[]>("tenant-areas-all", canReadAreas ? (authToken) => listAllAreas(authToken) : null);
  const groups = useLoad<VehicleGroup[]>("tenant-vehicle-groups", listTenantVehicleGroups);

  const [brandId, setBrandId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(product?.city_id ?? null);
  const [category, setCategory] = useState<ServiceCategory | null>(product?.category ?? null);
  const [poiId, setPoiId] = useState<string | null>(null);
  const places = useLoad<Place[]>(`pickup-places:${cityId ?? ""}`, creating && cityId !== null && category === "airport_transfer" ? (authToken) => listPickupPlaces(authToken, cityId) : null);

  const fromProduct = (source: Product | null): { areas: AreaPick[]; groups: GroupPick[]; dispatchers: DispatcherRow[] } => ({
    areas: (source?.areas ?? []).map((area) => ({ id: area.area_id, name: area.name, biz: area.biz_type, status: area.status })),
    groups: (source?.vehicle_groups ?? []).map((group) => ({ id: group.vehicle_group_id, combo: comboKey(group.passengers, group.luggage) })),
    dispatchers: source ? source.dispatchers.map((row) => ({ ...row })) : [{ name: "", phone: "" }],
  });
  const [initial, setInitial] = useState(() => fromProduct(product));
  const [areas, setAreas] = useState<AreaPick[]>(initial.areas);
  const [picked, setPicked] = useState<GroupPick[]>(initial.groups);
  const [dispatchers, setDispatchers] = useState<DispatcherRow[]>(initial.dispatchers);
  const [cleared, setCleared] = useState<Record<string, string>>({});
  const [server, setServer] = useState<Record<string, string[]>>({});
  const [announce, setAnnounce] = useState("");
  const [addingBrand, setAddingBrand] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [createdNotice, setCreatedNotice] = useState((location.state as { created?: boolean } | null)?.created === true);

  // 别处把商品换了（载入最新内容、下架）而这一步没有未保存的修改：跟着换
  const signature = (value: { areas: AreaPick[]; groups: GroupPick[]; dispatchers: DispatcherRow[] }): string => JSON.stringify([value.areas.map((area) => area.id), value.groups, cleanDispatchers(value.dispatchers)]);
  const dirtyFields = signature({ areas, groups: picked, dispatchers }) !== signature(initial);
  const productKey = product ? `${product.id}:${product.version}` : "";
  useEffect(() => {
    if (product === null || dirtyFields) return;
    const next = fromProduct(product);
    setInitial(next);
    setAreas(next.areas);
    setPicked(next.groups);
    setDispatchers(next.dispatchers);
  }, [productKey]);

  const activeBrands = (brands.state.data ?? []).filter((brand) => brand.status === "active");
  const onlyBrand = activeBrands.length === 1 ? (activeBrands[0] as Brand) : null;
  const chosenBrandId = onlyBrand?.id ?? brandId;
  const chosenBrand = activeBrands.find((brand) => brand.id === chosenBrandId) ?? null;
  const city = creating ? ((cities.state.data ?? []).find((entry) => entry.id === cityId) ?? null) : null;
  const cityName = creating ? (city ? displayName(city.name).text : "") : product.city ? displayName(product.city.name).text : "";
  const categoryName = category ? PRODUCT_CATEGORY_NAMES[category] : "";

  // 区域：这个城市下的全部；能选的是启用中、业务类型匹配的
  const cityAreas = useMemo(() => (allAreas.state.data ?? []).filter((area) => area.city_id === cityId), [allAreas.state.data, cityId]);
  const matching = category ? cityAreas.filter((area) => areaUsableByCategory(category, area.biz_type)) : [];
  const usable = matching.filter((area) => area.status === "active");
  const reloadAreas = allAreas.reload;
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") reloadAreas();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadAreas]);
  const usableCount = usable.length;
  const [waitingForAreas, setWaitingForAreas] = useState(false);
  useEffect(() => {
    if (waitingForAreas && allAreas.state.status === "ready") {
      setWaitingForAreas(false);
      if (usableCount > 0) setAnnounce(`现在有 ${usableCount} 个可以选的区域`);
    }
  }, [waitingForAreas, allAreas.state.status, usableCount]);

  // 车型组：清单（连已停用的）按编号对；清单没取到时用商品里带的
  const groupInfo = (id: string): GroupInfo | null => groups.state.data?.find((group) => group.id === id) ?? (product?.vehicle_groups ?? []).map((group) => ({ ...group, id: group.vehicle_group_id })).find((group) => group.id === id) ?? null;
  const pickedSorted = [...picked].sort((x, y) => {
    const [a, b] = [groupInfo(x.id), groupInfo(y.id)];
    return a && b ? gradeOrder(a).localeCompare(gradeOrder(b)) : 0;
  });
  const activeGroups = useMemo(() => [...(groups.state.data ?? [])].filter((group) => group.status === "active").sort((x, y) => gradeOrder(x).localeCompare(gradeOrder(y))), [groups.state.data]);

  const clearServer = (key: string): void => setServer(({ [key]: _gone, ...rest }) => rest);
  const changeCity = (next: string | null): void => {
    setCityId(next);
    clearServer("city");
    const notes: Record<string, string> = {};
    if (poiId !== null) notes["poi"] = "已清空：换了城市，原来选的接送点不能用了。";
    if (areas.length > 0) notes["areas"] = "已清空：换了城市，原来选的区域不能用了。";
    setPoiId(null);
    setAreas([]);
    setCleared(notes);
  };
  const changeCategory = (next: ServiceCategory): void => {
    setCategory(next);
    const kept = areas.filter((area) => areaUsableByCategory(next, area.biz));
    const dropped = areas.length - kept.length;
    setAreas(kept);
    if (next !== "airport_transfer") setPoiId(null);
    setCleared(dropped > 0 ? { areas: `已去掉 ${dropped} 个不适用于${PRODUCT_CATEGORY_NAMES[next]}的区域。` } : {});
  };

  const moveArea = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= areas.length) return;
    const next = [...areas];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setAreas(next);
    setAnnounce(`${displayName(moved.name).text} 现在排第 ${target + 1}，共 ${next.length} 个`);
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-area-pick="${moved.id}"]`);
      const wanted = row?.querySelector<HTMLButtonElement>(delta === -1 ? '[data-move="up"]' : '[data-move="down"]');
      (wanted && !wanted.disabled ? wanted : row?.querySelector<HTMLButtonElement>(delta === -1 ? '[data-move="down"]' : '[data-move="up"]'))?.focus();
    });
  };
  const removeFrom = (kind: "area" | "group", id: string, index: number, total: number): void => {
    if (kind === "area") setAreas(areas.filter((area) => area.id !== id));
    else setPicked(picked.filter((group) => group.id !== id));
    clearServer(kind === "area" ? "areas" : "vehicle-groups");
    requestAnimationFrame(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(kind === "area" ? "[data-area-pick]" : "[data-group-pick]")];
      const row = rows[Math.min(index, total - 2)];
      (row?.querySelector<HTMLElement>('[data-remove="true"]') ?? document.getElementById(kind === "area" ? "areas-add" : "vehicle-groups-add"))?.focus();
    });
  };

  // 「写错了的」
  const dispatcherProblems = (rows: readonly DispatcherRow[]): (StepProblem & { index: number; field: "name" | "phone" })[] => {
    const found: (StepProblem & { index: number; field: "name" | "phone" })[] = [];
    rows.forEach((row, index) => {
      const [name, phone] = [row.name.trim(), row.phone.trim()];
      if (name === "" && phone === "") return;
      const label = `调度人：第 ${index + 1} 个调度人`;
      if (name === "") found.push({ text: `${label}请填写姓名`, target: `dispatcher-${index}-name`, index, field: "name" });
      else if (name.length > PRODUCT_LIMITS.maxDispatcherNameLength) found.push({ text: `${label}的姓名最多 ${PRODUCT_LIMITS.maxDispatcherNameLength} 个字`, target: `dispatcher-${index}-name`, index, field: "name" });
      if (phone === "") found.push({ text: `${label}请填写电话`, target: `dispatcher-${index}-phone`, index, field: "phone" });
      else if (!isPhoneNumber(phone)) found.push({ text: `${label}的电话只能是数字，可以带开头的 + 和中间的空格、短横线，例如 +81 90 1234 5678`, target: `dispatcher-${index}-phone`, index, field: "phone" });
    });
    return found;
  };
  const validate = (): StepProblem[] => {
    const found: StepProblem[] = [];
    if (creating) {
      if (chosenBrandId === null) found.push({ text: "子品牌：请选择子品牌", target: "brand" });
      if (cityId === null) found.push({ text: "城市：请选择城市", target: "city" });
      if (category === null) found.push({ text: "品类：请选择品类", target: "category" });
      if (category === "airport_transfer" && poiId === null) found.push({ text: "接送点：请选择机场或车站", target: "poi" });
    }
    for (const group of pickedSorted) {
      if (group.combo === "") found.push({ text: `车型组：请给「${displayName(groupInfo(group.id)?.name).text}」选一个「人数 / 行李数」组合`, target: `vehicle-group-${group.id}` });
    }
    return [...found, ...dispatcherProblems(dispatchers)];
  };

  const body = (): ProductPatch => ({
    areas: areas.map((area) => ({ area_id: area.id })),
    vehicle_groups: pickedSorted.map((group) => {
      const [passengers, luggage] = group.combo.split("-").map(Number);
      return { vehicle_group_id: group.id, passengers: passengers ?? 0, luggage: luggage ?? 0 };
    }),
    dispatchers: cleanDispatchers(dispatchers),
  });
  const submit = async (): Promise<string> => {
    setServer({});
    const saved = creating
      ? await createProduct(token, { brand_id: chosenBrandId ?? "", city_id: cityId ?? "", category: category ?? "airport_transfer", ...(category === "airport_transfer" ? { poi_id: poiId } : {}), ...body() }, idempotencyKey)
      : await patchProduct(token, product.id, frame.version, body());
    const next = fromProduct(saved);
    setInitial(next);
    setAreas(next.areas);
    setPicked(next.groups);
    setDispatchers(next.dispatchers);
    if (!creating) frame.saved(saved.version, saved);
    return saved.id;
  };

  const placeServerIssues = (issues: ServerIssue[]): StepProblem[] => {
    const errors: Record<string, string[]> = {};
    const found: StepProblem[] = [];
    const put = (key: string, label: string, text: string): void => {
      errors[key] = [...(errors[key] ?? []), text];
      found.push({ text: `${label}：${text}`, target: key });
    };
    for (const issue of issues) {
      const index = Number(/\/(\d+)/.exec(issue.path)?.[1] ?? -1);
      if (issue.path.startsWith("/areas")) {
        const name = areas[index] ? displayName(areas[index].name).text : "";
        const text =
          issue.reason === "AREA_DISABLED" ? `「${name}」已经停用，不能新选。` : issue.reason === "UNKNOWN_AREA" ? `「${name}」已经被删除。` : issue.reason === "AREA_NOT_USABLE" || issue.reason === "AREA_OTHER_CITY" ? `「${name}」不能给这个商品用（业务类型或城市不对）。` : issue.message;
        put("areas", "服务区域", text);
      } else if (issue.path.startsWith("/vehicle_groups")) {
        const name = displayName(groupInfo(pickedSorted[index]?.id ?? "")?.name).text;
        const text = issue.reason === "VEHICLE_GROUP_DISABLED" ? `「${name}」已被平台停用，不能新选。` : issue.reason === "VEHICLE_COMBO_NOT_OFFERED" ? `「${name}」选的「人数 / 行李数」平台已经取消，请重新选择。` : issue.message;
        put("vehicle-groups", "车型组", text);
      } else if (issue.path.startsWith("/dispatchers")) put("dispatchers", "调度人", issue.reason === "INVALID_PHONE" ? `第 ${index + 1} 个调度人的电话只能是数字，可以带开头的 + 和中间的空格、短横线` : issue.message);
      else if (issue.path.startsWith("/city_id")) put("city", "城市", issue.reason === "CITY_DISABLED" ? "这个城市已经被平台停用，请换一个。" : issue.message);
      else if (issue.path.startsWith("/poi_id")) put("poi", "接送点", issue.reason === "PICKUP_PLACE_DISABLED" ? "这个接送点已经被平台停用，请换一个。" : issue.message);
      else if (issue.path.startsWith("/brand_id")) put("brand", "子品牌", issue.reason === "BRAND_DISABLED" || issue.reason === "UNKNOWN_BRAND" ? "这个子品牌已停用，请换一个。" : issue.message);
    }
    setServer(errors);
    if (errors["areas"]) reloadAreas();
    if (errors["vehicle-groups"]) groups.reload();
    if (errors["city"]) cities.reload();
    if (errors["poi"]) places.reload();
    if (errors["brand"]) brands.reload();
    return found;
  };

  // 上架前这一步还差几项：和上架检查用同一份规则，按页面上现在的内容算
  const checkItem = publishCheck({
    category: category ?? "point_to_point",
    brandActive: true,
    cityActive: true,
    pickupPlace: null,
    areas: areas.map((area) => ({ status: area.status, bizType: area.biz, cityActive: true })),
    vehicleGroups: pickedSorted.map((group) => {
      const info = groupInfo(group.id);
      return { active: info?.status !== "disabled", comboOffered: group.combo === "" || !info || info.combos.some((combo) => comboKey(combo.passengers, combo.luggage) === group.combo) };
    }),
    dispatcherCount: cleanDispatchers(dispatchers).length,
    serviceRules: emptyServiceRules(),
    addons: [],
    content: {},
    activePriceRuleCount: null,
  }).find((item) => item.key === "basic_info");
  const gaps = checkReasons(
    { key: "basic_info", required: true, passed: false, issues: (checkItem?.issues ?? []).filter((issue) => issue.reason !== "PICKUP_PLACE_MISSING").map((issue) => ({ ...issue, message: "" })) },
    { category: category ?? "point_to_point", brandName: "", cityName, placeName: null, station: false },
  );

  const noBrands = creating && brands.state.status === "ready" && activeBrands.length === 0;
  const controller: StepController = {
    dirty: dirtyFields || (creating && (brandId !== null || cityId !== null || category !== null || poiId !== null)),
    missing: { count: gaps.length, anchor: gaps[0]?.anchor ?? null },
    validate,
    submit,
    placeServerIssues,
    reload: () => {
      // 先回到手上这一份；框架重新取到商品后（版本号变了）上面的 effect 会换成最新的
      const current = fromProduct(product);
      setInitial(current);
      setAreas(current.areas);
      setPicked(current.groups);
      setDispatchers(current.dispatchers);
      setServer({});
    },
    blocked: noBrands ? "还没有子品牌" : null,
  };

  const disabledAreas = areas.filter((area) => area.status === "disabled").length;
  const disabledGroups = picked.filter((group) => groupInfo(group.id)?.status === "disabled").length;
  const phones = cleanDispatchers(dispatchers).map((row) => row.phone.replace(/[^0-9+]/g, ""));
  const duplicate = phones.findIndex((phone, index) => phone !== "" && phones.indexOf(phone) < index);
  const lockedCount = category === "airport_transfer" ? "四" : "三";
  const newAreaPath = `${AREA_NEW_PATH}${cityId && category ? `?city=${cityId}&biz=${category}` : ""}`;

  return (
    <StepShell frame={frame} slug="basic" title="① 基础信息" next={{ slug: "service-rules", label: "保存并下一步" }} controller={controller}>
      {({ busy, attempted, hint }) => {
        const locked = busy || readOnly;
        const missingHint = (anchor: string, filled: boolean): ReactNode => (hint === anchor && !filled ? <Warning>上架前要填这一项。</Warning> : null);
        const dispatcherIssues = attempted ? dispatcherProblems(dispatchers) : [];
        return (
          <>
            <div role="status" className="visually-hidden">
              {announce}
            </div>
            {createdNotice && product && Object.keys(product.title).length === 0 && (
              <Alert kind="info">
                <span>{`这个商品还没有名字。名字在第 ⑤ 步「商品详情」里填，现在列表里先显示成「未命名的${PRODUCT_CATEGORY_NAMES[product.category]}商品」。`}</span>
                <span className="alert__actions">
                  <LinkButton variant="text" size="sm" to={productPath(product.id, "content", "title")}>
                    去填标题
                  </LinkButton>
                  <Button variant="text" size="sm" onClick={() => setCreatedNotice(false)}>
                    知道了
                  </Button>
                </span>
              </Alert>
            )}
            <section className="card" aria-labelledby="basic-locked-title">
              <h3 className="card__title" id="basic-locked-title">
                创建后不能修改的内容
              </h3>
              {!creating ? (
                <>
                  <p className="field__hint">这几项创建后不能修改。要换，请新建一个商品。</p>
                  <dl className="details">
                    <div className="details__item">
                      <dt>子品牌</dt>
                      <dd>{product.brand ? `${product.brand.name}（${product.brand.currency}）` : "—"}</dd>
                    </div>
                    <div className="details__item">
                      <dt>品类</dt>
                      <dd>{PRODUCT_CATEGORY_NAMES[product.category]}</dd>
                    </div>
                    <div className="details__item">
                      <dt>城市</dt>
                      <dd>{product.city ? `${displayName(product.city.name).text}（${countryLabel(product.city.country_code)}）` : "—"}</dd>
                    </div>
                    {product.category === "airport_transfer" && (
                      <div className="details__item">
                        <dt>接送点</dt>
                        <dd>{product.poi ? `${displayName(product.poi.name).text}（${product.poi.code}）` : "—"}</dd>
                      </div>
                    )}
                  </dl>
                </>
              ) : (
                <div className="form">
                  <Alert kind="info">
                    <strong className="alert__title">{`这${lockedCount}项创建后不能修改。`}</strong>
                    <span>选错了只能删掉这个草稿重新建，请先确认。</span>
                  </Alert>
                  <div id="brand">
                    {brands.state.data === null ? (
                      brands.state.status === "error" ? (
                        <p className="field__hint">
                          子品牌没有加载出来。
                          <Button variant="text" size="sm" onClick={brands.reload}>
                            重试
                          </Button>
                        </p>
                      ) : (
                        <p className="field__hint">正在加载子品牌…</p>
                      )
                    ) : noBrands ? (
                      <div className="guide-block">
                        <Icon name="alert-triangle" />
                        <div className="guide-block__body">
                          {canManageBrands ? (
                            <>
                              <p>
                                <strong>还没有子品牌。</strong>商品要挂在一个子品牌下面，子品牌决定金额用哪种币种。请先建一个。
                              </p>
                              <div className="guide-block__actions">
                                <Button variant="primary" size="sm" onClick={() => setAddingBrand(true)}>
                                  新建子品牌
                                </Button>
                              </div>
                            </>
                          ) : (
                            <p>
                              <strong>还没有子品牌，暂时不能新建商品。</strong>请联系你们的管理员新建子品牌。
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="field">
                        <div className="field__label-row">
                          <label className="field__label" htmlFor="brand-select">
                            子品牌
                            <span className="field__required" aria-hidden="true">
                              {" *"}
                            </span>
                          </label>
                          {canManageBrands && (
                            <Button variant="text" size="sm" disabled={busy} onClick={() => setAddingBrand(true)}>
                              新建子品牌
                            </Button>
                          )}
                        </div>
                        {onlyBrand ? (
                          <p className="field__static" id="brand-select">{`${onlyBrand.name}（${onlyBrand.currency}）`}</p>
                        ) : (
                          <select
                            className="input select"
                            id="brand-select"
                            required
                            disabled={busy}
                            aria-invalid={(attempted && brandId === null) || undefined}
                            aria-describedby="brand-error brand-hint"
                            value={brandId ?? ""}
                            onChange={(event) => {
                              setBrandId(event.target.value === "" ? null : event.target.value);
                              clearServer("brand");
                            }}
                          >
                            <option value="">请选择</option>
                            {activeBrands.map((brand) => (
                              <option key={brand.id} value={brand.id}>{`${brand.name}（${brand.currency}）`}</option>
                            ))}
                          </select>
                        )}
                        <FieldErrors id="brand-error" errors={[...(server["brand"] ?? []), ...(attempted && chosenBrandId === null ? ["请选择子品牌"] : [])]} />
                        <p className="field__hint" id="brand-hint">
                          {onlyBrand ? `这个商品的金额都用 ${onlyBrand.currency} 填写，创建后不能修改。` : "子品牌决定这个商品所有金额的币种，创建后不能修改。"}
                        </p>
                      </div>
                    )}
                  </div>
                  <div id="city">
                    <Combobox
                      label="城市"
                      required
                      options={(() => {
                        const withAreas = new Set((allAreas.state.data ?? []).map((area) => area.city_id));
                        const grouped = allAreas.state.data !== null && withAreas.size > 0;
                        const option = (entry: City, group?: string) => ({ value: entry.id, label: displayName(entry.name).text, detail: `${entry.code} · ${countryLabel(entry.country_code)}`, keywords: `${Object.values(entry.name).join(" ")} ${entry.code}`, ...(group ? { group } : {}) });
                        const list = cities.state.data ?? [];
                        return grouped ? [...list.filter((entry) => withAreas.has(entry.id)).map((entry) => option(entry, "有区域的城市")), ...list.filter((entry) => !withAreas.has(entry.id)).map((entry) => option(entry, "其他城市"))] : list.map((entry) => option(entry));
                      })()}
                      value={cityId}
                      placeholder="输入城市名称或编码查找"
                      emptyText="平台还没有启用中的城市"
                      loading={cities.state.data === null && cities.state.status === "loading"}
                      loadFailed={cities.state.data === null && cities.state.status === "error"}
                      errors={[...(server["city"] ?? []), ...(attempted && cityId === null ? ["请选择城市"] : [])]}
                      hint="商品属于一个城市，时间规则都按这个城市的当地时间算。"
                      onChange={changeCity}
                    />
                    {city && <p className="field__hint">{`国家：${countryLabel(city.country_code)}`}</p>}
                  </div>
                  <div id="category">
                    <RadioGroup<ServiceCategory> legend="品类" name="product-category" required disabled={busy} options={CATEGORY_OPTIONS} value={category} errors={attempted && category === null ? ["请选择品类"] : []} onChange={changeCategory} />
                  </div>
                  {category === "airport_transfer" && (
                    <div id="poi">
                      {cityId === null ? (
                        <StaticField label="接送点" hint="请先选择城市">
                          —
                        </StaticField>
                      ) : (
                        <Combobox
                          label="接送点"
                          required
                          options={(places.state.data ?? []).filter((place) => place.status === "active").map((place) => ({ value: place.id, label: displayName(place.name).text, detail: `${place.code} · ${PLACE_TYPE_NAMES[place.type]}`, keywords: `${Object.values(place.name).join(" ")} ${place.code}` }))}
                          value={poiId}
                          placeholder="输入名称或编码查找"
                          emptyText="这个城市还没有可选的机场或车站"
                          loading={places.state.data === null && places.state.status === "loading"}
                          loadFailed={places.state.data === null && places.state.status === "error"}
                          errors={[...(server["poi"] ?? []), ...(attempted && poiId === null ? ["请选择机场或车站"] : [])]}
                          hint="一个商品对应一个机场或车站。要做多个机场，请每个机场建一个商品。"
                          onChange={(next) => {
                            setPoiId(next);
                            clearServer("poi");
                            setCleared(({ poi: _poi, ...rest }) => rest);
                          }}
                        />
                      )}
                      {cleared["poi"] && <p className="field__hint field__hint--info">{cleared["poi"]}</p>}
                      {places.state.status === "ready" && places.state.data.filter((place) => place.status === "active").length === 0 && <Warning>{`平台还没有在「${cityName}」下启用机场或车站，暂时不能建接送机商品。请联系平台运营。`}</Warning>}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="card" aria-labelledby="basic-scope-title">
              <h3 className="card__title" id="basic-scope-title">
                服务范围与联系人
              </h3>
              <div className="form">
                <fieldset className="field fieldset picked" id="areas">
                  <legend className="field__label">
                    服务区域
                    <span className="field__required" aria-hidden="true">
                      {" *"}
                    </span>
                  </legend>
                  {cityId === null || category === null ? (
                    <p className="field__hint">先选城市和品类，这里会列出可以用的区域。</p>
                  ) : (
                    <>
                      {!readOnly &&
                        (allAreas.state.data === null ? (
                          allAreas.state.status === "loading" ? (
                            <p className="field__hint">正在加载区域…</p>
                          ) : (
                            <p className="field__hint">
                              区域没有加载出来。
                              <Button variant="text" size="sm" onClick={reloadAreas}>
                                重试
                              </Button>
                            </p>
                          )
                        ) : usable.length === 0 && areas.length === 0 ? (
                          <div className="guide-block">
                            <Icon name="alert-triangle" />
                            <div className="guide-block__body">
                              <p>
                                {allAreas.state.data.length === 0 ? (
                                  <>
                                    <strong>你们还没有区域。</strong>商品要选它在哪些区域里接单，请先去画一个。
                                  </>
                                ) : cityAreas.length === 0 ? (
                                  <>
                                    <strong>{`「${cityName}」下还没有区域。`}</strong>请先在这个城市画一个区域。
                                  </>
                                ) : matching.length === 0 ? (
                                  <>
                                    <strong>{`「${cityName}」下有 ${cityAreas.length} 个区域，但没有一个能给${categoryName}商品用。`}</strong>
                                    {`区域的业务类型要是「${categoryName}」或「通用」。可以新增一个，或把已有区域的业务类型改成「通用」。`}
                                  </>
                                ) : (
                                  <>
                                    <strong>{`「${cityName}」下能用的 ${matching.length} 个区域都已停用。`}</strong>请先启用，或新增一个。
                                  </>
                                )}
                                {!canManageAreas && "请联系你们的管理员。"}
                              </p>
                              <div className="guide-block__actions">
                                {canManageAreas && !(matching.length > 0 && usable.length === 0) && (
                                  <LinkButton size="sm" to={newAreaPath}>
                                    新增区域
                                  </LinkButton>
                                )}
                                {cityAreas.length > 0 && (
                                  <LinkButton size="sm" to={`${AREA_LIST_PATH}?city=${cityId}`}>
                                    去区域列表
                                  </LinkButton>
                                )}
                                <Button
                                  variant="text"
                                  size="sm"
                                  onClick={() => {
                                    setWaitingForAreas(true);
                                    reloadAreas();
                                  }}
                                >
                                  重新读取
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <PickerPanel
                            buttonId="areas-add"
                            buttonLabel="添加区域"
                            searchLabel="按名称搜索"
                            disabled={busy}
                            options={usable.map((area) => ({
                              value: area.id,
                              label: displayName(area.name).text,
                              keywords: Object.values(area.name).join(" "),
                              detail: <span className="tag">{AREA_BIZ_TYPE_NAMES[area.biz_type]}</span>,
                              note: `营运区 ${area.operate_polygon_count} 块 · 禁行区 ${area.forbid_polygon_count} 块`,
                            }))}
                            selected={areas.map((area) => area.id)}
                            full={areas.length >= PRODUCT_LIMITS.maxAreas}
                            fullText={`最多 ${PRODUCT_LIMITS.maxAreas} 个`}
                            emptyText="没有可以选的区域"
                            footer={
                              canManageAreas ? (
                                <Link className="link" to={newAreaPath}>
                                  去新增区域
                                </Link>
                              ) : undefined
                            }
                            onToggle={(id, checked) => {
                              clearServer("areas");
                              const area = usable.find((entry) => entry.id === id);
                              if (checked && area) setAreas([...areas, { id, name: area.name, biz: area.biz_type, status: area.status }]);
                              else setAreas(areas.filter((entry) => entry.id !== id));
                            }}
                          />
                        ))}
                      {areas.length === 0 ? (
                        (readOnly || usable.length > 0) && <p className="field__hint">还没有选区域</p>
                      ) : (
                        <ol className="picked__list">
                          {areas.map((area, index) => {
                            const name = displayName(area.name).text;
                            return (
                              <li
                                key={area.id}
                                className="picked__row"
                                data-area-pick={area.id}
                                onKeyDown={(event) => {
                                  if (!event.altKey || locked || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                                  event.preventDefault();
                                  moveArea(index, event.key === "ArrowUp" ? -1 : 1);
                                }}
                              >
                                <span className="picked__number">{index + 1}</span>
                                <span className="picked__main">
                                  {canReadAreas ? (
                                    <Link className="link picked__name" to={areaEditPath(area.id)}>
                                      {name}
                                    </Link>
                                  ) : (
                                    <span className="picked__name">{name}</span>
                                  )}
                                  <span className="tag">{AREA_BIZ_TYPE_NAMES[area.biz]}</span>
                                  {area.status === "disabled" && <StatusBadge tone="neutral" label="已停用" />}
                                </span>
                                {!readOnly && (
                                  <span className="picked__actions">
                                    <IconButton icon="arrow-up" label={`把 ${name} 上移`} data-move="up" disabled={locked || index === 0} onClick={() => moveArea(index, -1)} />
                                    <IconButton icon="arrow-down" label={`把 ${name} 下移`} data-move="down" disabled={locked || index === areas.length - 1} onClick={() => moveArea(index, 1)} />
                                    <IconButton icon="x" label={`移除 ${name}`} data-remove="true" disabled={locked} onClick={() => removeFrom("area", area.id, index, areas.length)} />
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </>
                  )}
                  <FieldErrors id="areas-error" errors={server["areas"] ?? []} />
                  {cleared["areas"] && <p className="field__hint field__hint--info">{cleared["areas"]}</p>}
                  {missingHint("areas", areas.length > 0)}
                  {disabledAreas > 0 && (
                    <Warning>
                      {`有 ${disabledAreas} 个区域已停用。`}
                      <strong>上架前要把它们重新启用，或在这里移除。</strong>
                    </Warning>
                  )}
                  {cityId !== null && category !== null && (
                    <p className="field__hint">
                      {`只能选「${cityName}」下、业务类型是「${categoryName}」或「通用」的启用中的区域。上下移动可以调整顺序，排在前面的优先。`}
                      <strong>现在报价时，一个位置落在好几个区域里的话，每个区域都会算一遍价，取最低的；顺序目前只影响价格规则等页面里区域的排列顺序。</strong>
                    </p>
                  )}
                </fieldset>

                <fieldset className="field fieldset picked" id="vehicle-groups">
                  <legend className="field__label">
                    车型组
                    <span className="field__required" aria-hidden="true">
                      {" *"}
                    </span>
                  </legend>
                  {!readOnly &&
                    (groups.state.data === null ? (
                      groups.state.status === "loading" ? (
                        <p className="field__hint">正在加载车型组…</p>
                      ) : (
                        <p className="field__hint">
                          车型组没有加载出来。
                          <Button variant="text" size="sm" onClick={groups.reload}>
                            重试
                          </Button>
                        </p>
                      )
                    ) : activeGroups.length === 0 ? (
                      <Warning>平台还没有启用的车型组，暂时不能选。请联系平台运营。</Warning>
                    ) : (
                      <PickerPanel
                        buttonId="vehicle-groups-add"
                        buttonLabel="添加车型组"
                        searchLabel="按名称或编码搜索"
                        disabled={busy}
                        options={activeGroups.map((group) => ({
                          value: group.id,
                          label: displayName(group.name).text,
                          keywords: `${Object.values(group.name).join(" ")} ${group.code}`,
                          detail: (
                            <>
                              <span className="product-code">{group.code}</span>
                              <span className="tag">{`${vehicleGradeName(group.grade)} · ${group.seats} 座`}</span>
                            </>
                          ),
                          ...(group.sample_models.length > 0 ? { note: group.sample_models.join("、") } : {}),
                        }))}
                        selected={picked.map((group) => group.id)}
                        full={picked.length >= PRODUCT_LIMITS.maxVehicleGroups}
                        fullText={`最多 ${PRODUCT_LIMITS.maxVehicleGroups} 个`}
                        emptyText="没有可以选的车型组"
                        onToggle={(id, checked) => {
                          clearServer("vehicle-groups");
                          const info = activeGroups.find((group) => group.id === id);
                          const only = info && info.combos.length === 1 ? info.combos[0] : undefined;
                          if (checked) setPicked([...picked, { id, combo: only ? comboKey(only.passengers, only.luggage) : "" }]);
                          else setPicked(picked.filter((group) => group.id !== id));
                        }}
                      />
                    ))}
                  {picked.length === 0 ? (
                    <p className="field__hint">还没有选车型组</p>
                  ) : (
                    <ul className="picked__list">
                      {pickedSorted.map((group, index) => {
                        const info = groupInfo(group.id);
                        const name = displayName(info?.name).text;
                        const combos = [...(info?.combos ?? [])].sort((x, y) => y.passengers - x.passengers || y.luggage - x.luggage);
                        const offered = group.combo === "" || combos.some((combo) => comboKey(combo.passengers, combo.luggage) === group.combo);
                        const [passengers, luggage] = group.combo.split("-").map(Number);
                        const comboMissing = attempted && group.combo === "";
                        return (
                          <li key={group.id} className="picked__row picked__row--stacked" data-group-pick={group.id} id={`vehicle-group-${group.id}`}>
                            <span className="picked__main">
                              <span className="picked__name">{name}</span>
                              {info && <span className="product-code">{info.code}</span>}
                              {info && <span className="tag">{`${vehicleGradeName(info.grade)} · ${info.seats} 座`}</span>}
                              {info?.status === "disabled" && <StatusBadge tone="neutral" label="平台已停用" />}
                            </span>
                            {!readOnly && (
                              <span className="picked__actions">
                                <IconButton icon="x" label={`移除 ${name}`} data-remove="true" disabled={locked} onClick={() => removeFrom("group", group.id, index, picked.length)} />
                              </span>
                            )}
                            {info && info.sample_models.length > 0 && <span className="picked__note">{info.sample_models.join("、")}</span>}
                            <span className="picked__extra">
                              {readOnly || (combos.length === 1 && offered && group.combo !== "") ? (
                                <span>{`人数 / 行李数：${group.combo === "" ? "—" : comboText(passengers ?? 0, luggage ?? 0)}`}</span>
                              ) : (
                                <label className="picked__combo">
                                  <span>
                                    人数 / 行李数
                                    <span className="field__required" aria-hidden="true">
                                      {" *"}
                                    </span>
                                  </span>
                                  <select
                                    className="input select"
                                    aria-label={`${name} 的人数 / 行李数`}
                                    aria-invalid={comboMissing || undefined}
                                    disabled={locked}
                                    value={group.combo}
                                    onChange={(event) => {
                                      setPicked(picked.map((entry) => (entry.id === group.id ? { ...entry, combo: event.target.value } : entry)));
                                      clearServer("vehicle-groups");
                                    }}
                                  >
                                    {!offered && <option value={group.combo}>{`${comboText(passengers ?? 0, luggage ?? 0)}（平台已取消）`}</option>}
                                    <option value="">请选择</option>
                                    {combos.map((combo) => (
                                      <option key={comboKey(combo.passengers, combo.luggage)} value={comboKey(combo.passengers, combo.luggage)}>
                                        {comboText(combo.passengers, combo.luggage)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {comboMissing && <FieldErrors id={`vehicle-group-${group.id}-error`} errors={[`请给「${name}」选一个「人数 / 行李数」组合`]} />}
                              {!offered && <Warning>原来选的组合平台已经取消，上架前请重新选择。</Warning>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <FieldErrors id="vehicle-groups-error" errors={server["vehicle-groups"] ?? []} />
                  {missingHint("vehicle-groups", picked.length > 0)}
                  {disabledGroups > 0 && (
                    <Warning>
                      {`有 ${disabledGroups} 个车型组已被平台停用。`}
                      <strong>上架前要在这里移除。</strong>
                    </Warning>
                  )}
                  <p className="field__hint">选你能提供的车型。每个车型组选一个「人数 / 行李数」组合：客人的人数或行李数超过这个组合时，这个车型不报价。</p>
                </fieldset>

                <fieldset className="field fieldset" id="dispatchers">
                  <legend className="field__label">
                    调度人
                    <span className="field__required" aria-hidden="true">
                      {" *"}
                    </span>
                  </legend>
                  {dispatchers.length === 0 && <p className="field__hint">还没有调度人</p>}
                  {readOnly ? (
                    <ul className="picked__list">
                      {dispatchers.map((row, index) => (
                        <li key={index} className="picked__row">
                          <span className="picked__main">
                            <span className="picked__name">{row.name}</span>
                            <span className="product-code">{row.phone}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      {dispatchers.map((row, index) => {
                        const issues = dispatcherIssues.filter((issue) => issue.index === index);
                        const set = (changes: Partial<DispatcherRow>): void => {
                          setDispatchers(dispatchers.map((entry, at) => (at === index ? { ...entry, ...changes } : entry)));
                          clearServer("dispatchers");
                        };
                        return (
                          <div key={index} className="prow prow--pair">
                            <label className="prow__cell">
                              <span className="prow__label">姓名</span>
                              <input className="input" id={`dispatcher-${index}-name`} autoComplete="off" readOnly={busy} aria-label={`第 ${index + 1} 个调度人的姓名`} aria-invalid={issues.some((issue) => issue.field === "name") || undefined} value={row.name} onChange={(event) => set({ name: event.target.value })} />
                            </label>
                            <label className="prow__cell">
                              <span className="prow__label">电话</span>
                              <input className="input" id={`dispatcher-${index}-phone`} type="tel" autoComplete="off" placeholder="+81 90 1234 5678" readOnly={busy} aria-label={`第 ${index + 1} 个调度人的电话`} aria-invalid={issues.some((issue) => issue.field === "phone") || undefined} value={row.phone} onChange={(event) => set({ phone: event.target.value })} />
                            </label>
                            <IconButton icon="x" label={`删除第 ${index + 1} 个调度人`} disabled={busy} onClick={() => setDispatchers(dispatchers.filter((_, at) => at !== index))} />
                            {issues.length > 0 && <FieldErrors id={`dispatcher-${index}-error`} errors={issues.map((issue) => issue.text.replace(/^调度人：/, ""))} />}
                          </div>
                        );
                      })}
                      <div>
                        <Button size="sm" id="dispatchers-add" disabled={busy || dispatchers.length >= PRODUCT_LIMITS.maxDispatchers} onClick={() => setDispatchers([...dispatchers, { name: "", phone: "" }])}>
                          <Icon name="plus" />
                          添加调度人
                        </Button>
                        {dispatchers.length >= PRODUCT_LIMITS.maxDispatchers && <span className="field__hint">{` 最多 ${PRODUCT_LIMITS.maxDispatchers} 个`}</span>}
                      </div>
                    </>
                  )}
                  <FieldErrors id="dispatchers-error" errors={server["dispatchers"] ?? []} />
                  {missingHint("dispatchers", cleanDispatchers(dispatchers).length > 0)}
                  {duplicate > 0 && <Warning>{`第 ${duplicate + 1} 个调度人的电话和第 ${phones.indexOf(phones[duplicate] ?? "") + 1} 个相同。`}</Warning>}
                  <p className="field__hint">接到订单后联系谁。姓名和电话会随订单一起发给平台客服和你们的调度系统。电话建议带国家区号。</p>
                </fieldset>
              </div>
            </section>
            {addingBrand && (
              <BrandDialog
                onClose={() => setAddingBrand(false)}
                onCreated={(brand) => {
                  setAddingBrand(false);
                  brands.set([...(brands.state.data ?? []), brand]);
                  setBrandId(brand.id);
                  requestAnimationFrame(() => document.getElementById("brand-select")?.focus());
                }}
              />
            )}
          </>
        );
      }}
    </StepShell>
  );
}
