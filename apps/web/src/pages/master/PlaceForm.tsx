/**
 * 地点的新增 / 编辑表单：机场、车站、地标，以及挂在机场 / 车站下面的航站楼、出口
 * （docs/design/pages/master-data.md 6.2、6.3、第 7 节）。
 */
import { FLIGHT_SCOPES, type FlightScope, type LocalizedText, PLACE_CATEGORY_NAMES, POI_CATEGORIES, type PlaceCategory, type PlaceType, STATION_CATEGORIES, placeCodeIssue, requiredParentType } from "@nozomi/domain";
import { useEffect } from "react";
import { Link } from "react-router";
import { type City, type Place, type PlacePatch, getMaster, listAllMaster } from "../../api/master.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DataTable } from "../../components/DataTable.tsx";
import { ExternalLink } from "../../components/ExternalLink.tsx";
import { CodeField, CoordinateInput, type CoordinateValue, LocalizedInput, RadioGroup, StaticField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { FLIGHT_SCOPE_NAMES, MASTER_STATUS_BADGES, PLACE_TYPE_NAMES, cleanLocalized, countryLabel, displayName, flightScopeName, formatLocalDateTime, formatPoint, sameLocalized } from "../../lib/master-display.ts";
import { type PlaceTab, masterEditPath, masterNewPath, placeListPath } from "../../lib/master-paths.ts";
import { type LoadState, useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { type FieldErrors, FieldSlot, FormGroup, type FormModel } from "./MasterForm.tsx";
import { COMMON_PATHS, NAME_MAX_LENGTH, coordinateErrors, languageErrors, localizedErrors, pathMapper, samePoint, toCoordinateValue, toPoint } from "./forms-common.tsx";
import { CodeLink, NameCell, cityOption, useAllCities, useReturnState } from "./shared.tsx";
import { useStatusToggle } from "./useStatusToggle.tsx";

const ADDRESS_MAX_LENGTH = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PlaceValues {
  cityId: string | null;
  code: string;
  name: LocalizedText;
  category: PlaceCategory | null;
  flightScope: FlightScope | "none";
  location: CoordinateValue;
  address: string;
}

interface PlaceExtra {
  type: PlaceType;
  cities: City[] | null;
  citiesState: LoadState<City[]>["status"];
  parent: Place | null;
  parentState: LoadState<Place>["status"] | "none";
}

const SCOPE_OPTIONS = [{ value: "none" as const, label: "不填" }, ...FLIGHT_SCOPES.map((scope) => ({ value: scope, label: FLIGHT_SCOPE_NAMES[scope] }))];

function typeOf(search: URLSearchParams, record: Place | null): PlaceType {
  if (record) return record.type;
  const type = search.get("type");
  return type === "station" || type === "poi" || type === "terminal" || type === "exit" ? type : "airport";
}

const isChild = (type: PlaceType): boolean => requiredParentType(type) !== null;
const childName = (type: PlaceType): string => (type === "station" || type === "exit" ? "出口" : "航站楼");
const parentName = (type: PlaceType): string => PLACE_TYPE_NAMES[requiredParentType(type) ?? "airport"];

function codePrefix(type: PlaceType, country: string | null, parentCode: string | null): string {
  if (type === "station") return country === null ? "" : `STN-${country}-`;
  if (type === "poi") return "POI-";
  if (isChild(type)) return parentCode === null ? "" : `${parentCode}-`;
  return "";
}

function countryOf(values: PlaceValues, extra: PlaceExtra, record: Place | null): string | null {
  return record?.country_code ?? extra.parent?.country_code ?? extra.cities?.find((city) => city.id === values.cityId)?.country_code ?? null;
}

function validatePlace(values: PlaceValues, mode: "new" | "edit", extra: PlaceExtra, record: Place | null): FieldErrors {
  const { type } = extra;
  const errors: FieldErrors = { ...localizedErrors("name", "名称", values.name, NAME_MAX_LENGTH, true), ...coordinateErrors("location", values.location) };
  if (!isChild(type) && values.cityId === null && !(mode === "edit" && record?.city_id === null)) errors["cityId"] = ["请选择所属城市"];
  if (type === "station" && values.category === null) errors["category"] = ["请选择车站类型"];
  if (type === "poi" && values.category === null) errors["category"] = ["请选择地标类型"];
  if (type === "poi" && values.address.trim().length > ADDRESS_MAX_LENGTH) errors["address"] = [`地址最多 ${ADDRESS_MAX_LENGTH} 个字`];
  if (mode === "edit") return errors;
  const country = countryOf(values, extra, record);
  const parentCode = extra.parent?.code ?? null;
  if (values.code === "" || values.code === codePrefix(type, country, parentCode)) errors["code"] = ["请输入编码"];
  else if (placeCodeIssue(type, values.code, { countryCode: country ?? "", parentCode }) !== null) {
    const station = /^STN-([A-Z]{2})-[A-Z0-9]{1,10}$/.exec(values.code);
    errors["code"] = [
      type === "airport"
        ? "机场编码是 IATA 三字码，3 个大写字母，例如 HND"
        : type === "station"
          ? station && country !== null
            ? `编码里的国家码 ${station[1]} 和所属城市的国家 ${countryLabel(country)} 不一致`
            : "编码格式应为 STN-国家码-序号，序号是 1 到 10 位大写字母或数字，例如 STN-JP-TOKYO"
          : type === "poi"
            ? "编码格式应为 POI-序号，序号是 1 到 12 位大写字母或数字，例如 POI-000123"
            : `编码格式应为 ${parentCode ?? "上级编码"}-后缀，后缀是 1 到 6 位大写字母或数字，例如 ${parentCode ?? "HND"}-${type === "terminal" ? "T1" : "E1"}`,
    ];
  }
  return errors;
}

const scopeValue = (scope: FlightScope | "none"): FlightScope | null => (scope === "none" ? null : scope);
const tabOf = (type: PlaceType): PlaceTab => (type === "station" || type === "exit" ? "station" : type === "poi" ? "poi" : "airport");

/** 上级是机场 / 车站的编辑页里那张「航站楼」/「出口」小表格。 */
function ChildrenCard({ parent, readOnly }: { parent: Place; readOnly: boolean }) {
  const child: PlaceType = parent.type === "station" ? "exit" : "terminal";
  const name = PLACE_TYPE_NAMES[child];
  const returnState = useReturnState();
  const children = useLoad<Place[]>(`children:${parent.id}`, (token) => listAllMaster("places", token, { parent_id: parent.id, status: "all" }));
  const rows = children.state.data ?? [];
  const toggle = useStatusToggle<"places">({
    kind: "places",
    objectName: () => name,
    objectPhrase: () => `这个${name}`,
    onChanged: (row) => children.set(rows.map((entry) => (entry.id === row.id ? row : entry))),
    notReady: (row, reason) => (reason === "PARENT_DISABLED" ? { text: `「${row.code} ${displayName(row.name).text}」的上级「${parent.code} ${displayName(parent.name).text}」已停用，不能启用。请先启用上级。` } : null),
  });
  const addPath = `${masterNewPath("places")}?type=${child}&parent=${parent.id}`;
  const addButton =
    parent.status === "active" ? (
      <LinkButton size="sm" to={addPath} state={returnState}>
        <Icon name="plus" />
        {`新增${name}`}
      </LinkButton>
    ) : (
      <Button size="sm" disabled>{`新增${name}`}</Button>
    );
  const tableState = children.state.status === "ready" ? "ready" : children.state.status === "loading" ? "loading" : children.state.status === "forbidden" ? "forbidden" : "error";
  return (
    <section className="card" id="children" aria-labelledby="children-title">
      <div className="card__header">
        <h2 className="card__title" id="children-title">
          {name}
        </h2>
        {!readOnly && (
          <span className="table__inline">
            {parent.status !== "active" && <span className="field__hint">{`${PLACE_TYPE_NAMES[parent.type]}启用后才能新增${name}。`}</span>}
            {addButton}
          </span>
        )}
      </div>
      {toggle.notice}
      <DataTable
        label={`${name}列表`}
        skeletonRows={2}
        rows={rows}
        rowKey={(row) => row.id}
        state={tableState}
        refreshing={children.state.status === "loading" && children.state.data !== null}
        onRetry={children.reload}
        columns={[
          { key: "code", header: "编码", cell: (row) => <CodeLink kind="places" id={row.id} code={row.code} /> },
          { key: "name", header: "名称", cell: (row) => <NameCell name={row.name} /> },
          ...(child === "terminal" ? [{ key: "scope", header: "国际 / 国内", cell: (row: Place) => flightScopeName(row.flight_scope) }] : []),
          { key: "location", header: "坐标", cell: (row) => <span className="mono nowrap">{formatPoint(row.location)}</span> },
          { key: "status", header: "状态", cell: (row) => <StatusBadge {...MASTER_STATUS_BADGES[row.status]} /> },
          ...(readOnly
            ? []
            : [
                {
                  key: "actions",
                  header: "操作",
                  cell: (row: Place) => (
                    <span className="table__actions">
                      <LinkButton variant="text" size="sm" to={masterEditPath("places", row.id)} state={returnState} aria-label={`编辑 ${row.code}`}>
                        编辑
                      </LinkButton>
                      {row.status === "active" ? (
                        <Button variant="text" size="sm" className="button--danger-text" aria-label={`停用 ${row.code}`} onClick={() => toggle.requestDisable(row)}>
                          停用
                        </Button>
                      ) : (
                        <Button variant="text" size="sm" aria-label={`启用 ${row.code}`} loading={toggle.enablingId === row.id} loadingText="启用中…" onClick={() => void toggle.enable(row)}>
                          启用
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]),
        ]}
        empty={
          <StateBlock
            tone="neutral"
            headingLevel="h3"
            title={`还没有${name}`}
            description={child === "terminal" ? "有多个航站楼的机场，把每个航站楼单独录入，各自有编码和坐标。" : "把车站的每个出口单独录入，各自有编码和坐标。"}
            {...(readOnly || parent.status !== "active" ? {} : { action: addButton })}
          />
        }
      />
      {toggle.dialog}
    </section>
  );
}

/** 导入的机场的「数据来源」。 */
function SourceCard({ place }: { place: Place }) {
  const source = place.source;
  if (source === null) return null;
  return (
    <section className="card" aria-labelledby="source-title">
      <h2 className="card__title" id="source-title">
        数据来源
      </h2>
      <Alert kind="info">
        {source.overridden ? (
          <>
            <strong className="alert__title">平台改过这个机场的英语名或坐标，再次导入时不会覆盖。</strong>
            <span>现在以这里填的为准。</span>
          </>
        ) : (
          <>
            <strong className="alert__title">英语名和坐标来自 OurAirports，再次导入时会随数据源更新。</strong>
            <span>你在这里改过其中任何一项之后，这个机场的英语名和坐标就不再随导入更新，以这里填的为准。所属城市、其他语言的名称等不受导入影响。</span>
          </>
        )}
      </Alert>
      <dl className="definition">
        <div>
          <dt>来源</dt>
          <dd>
            <ExternalLink to="ourairports">OurAirports</ExternalLink>
            （公开数据）
          </dd>
        </div>
        <div>
          <dt>数据源里的编号</dt>
          <dd className="mono">{source.ref}</dd>
        </div>
        <div>
          <dt>最近核对</dt>
          <dd>{formatLocalDateTime(source.synced_at)}</dd>
        </div>
        <div>
          <dt>随导入更新</dt>
          <dd>{source.overridden ? "否" : "是"}</dd>
        </div>
      </dl>
    </section>
  );
}

function SourceNote({ changed }: { changed: boolean }) {
  return changed ? (
    <p className="field__hint field__hint--warning">
      <Icon name="alert-triangle" />
      <span>保存后，这个机场的英语名和坐标不再随 OurAirports 更新。</span>
    </p>
  ) : (
    <p className="field__hint">来自 OurAirports。</p>
  );
}

export const placeFormModel: FormModel<"places", PlaceValues, PlaceExtra> = {
  kind: "places",
  moduleName: "地点",
  objectName: ({ search, record }) => PLACE_TYPE_NAMES[typeOf(search, record)],
  listPath: ({ search, record }) => {
    const type = typeOf(search, record);
    const parentId = record?.parent_id ?? search.get("parent");
    return isChild(type) && parentId !== null && UUID_PATTERN.test(parentId) ? masterEditPath("places", parentId) : placeListPath(tabOf(type));
  },
  trail: ({ record, extra }) => {
    const parent = record?.parent ?? extra.parent;
    return isChild(extra.type) && parent ? [{ label: displayName(parent.name).text, to: masterEditPath("places", parent.id) }] : [];
  },
  useExtra: (search, record) => {
    const type = typeOf(search, record);
    const cities = useAllCities();
    const parentId = isChild(type) ? (record?.parent_id ?? search.get("parent")) : null;
    const parent = useLoad<Place>(`parent:${parentId ?? ""}`, parentId !== null && UUID_PATTERN.test(parentId) ? (token) => getMaster("places", token, parentId) : null);
    const parentState = !isChild(type) ? "none" : parentId === null || !UUID_PATTERN.test(parentId) ? "not-found" : parent.state.status;
    return { type, cities: cities.state.data, citiesState: cities.state.status, parent: isChild(type) ? parent.state.data : null, parentState };
  },
  missing: (extra) => {
    if (!isChild(extra.type)) return null;
    const mismatch = extra.parent !== null && extra.parent.type !== requiredParentType(extra.type);
    return extra.parentState === "not-found" || mismatch ? `找不到所属的${parentName(extra.type)}` : null;
  },
  empty: (search) => ({ cityId: null, code: codePrefix(typeOf(search, null), null, null), name: {}, category: null, flightScope: "none", location: { lat: "", lng: "" }, address: "" }),
  fromRecord: (place) => ({ cityId: place.city_id, code: place.code, name: place.name, category: place.category, flightScope: place.flight_scope ?? "none", location: toCoordinateValue(place.location), address: place.address ?? "" }),
  validate: (values, context) => validatePlace(values, context.mode, context.extra, context.record),
  labels: { cityId: "所属城市", code: "编码", name: "名称", category: "类型", flightScope: "国际 / 国内", location: "坐标", address: "地址" },
  fieldOfPath: pathMapper([...COMMON_PATHS, [/^\/city_id$/, "cityId"], [/^\/category$/, "category"], [/^\/flight_scope$/, "flightScope"], [/^\/address$/, "address"], [/^\/location\/lat$/, "location.lat"], [/^\/location\/lng$/, "location.lng"], [/^\/location$/, "location.lat"]]),
  toCreate: (values, { extra }) => {
    const { type } = extra;
    return {
      type,
      code: values.code,
      name: cleanLocalized(values.name),
      location: toPoint(values.location),
      ...(isChild(type) ? { parent_id: extra.parent?.id ?? "" } : { city_id: values.cityId ?? "" }),
      ...(type === "station" || type === "poi" ? { category: values.category ?? "rail" } : {}),
      ...(type === "airport" || type === "terminal" ? { flight_scope: scopeValue(values.flightScope) } : {}),
      ...(type === "poi" && values.address.trim() !== "" ? { address: values.address.trim() } : {}),
    };
  },
  toPatch: (values, place) => {
    const patch: PlacePatch = {};
    if (!isChild(place.type) && values.cityId !== null && values.cityId !== place.city_id) patch.city_id = values.cityId;
    if (!sameLocalized(values.name, place.name)) patch.name = cleanLocalized(values.name);
    if (!samePoint(values.location, place.location)) patch.location = toPoint(values.location);
    if ((place.type === "station" || place.type === "poi") && values.category !== null && values.category !== place.category) patch.category = values.category;
    if ((place.type === "airport" || place.type === "terminal") && scopeValue(values.flightScope) !== place.flight_scope) patch.flight_scope = scopeValue(values.flightScope);
    if (place.type === "poi" && values.address.trim() !== (place.address ?? "")) patch.address = values.address.trim() === "" ? null : values.address.trim();
    return patch;
  },
  continueWith: (values, search, extra) => {
    const type = typeOf(search, null);
    const country = extra.cities?.find((city) => city.id === values.cityId)?.country_code ?? null;
    return { cityId: values.cityId, code: codePrefix(type, country, extra.parent?.code ?? null), name: {}, category: values.category, flightScope: "none", location: { lat: "", lng: "" }, address: "" };
  },
  footnotes: ({ record }) => (record?.source ? ["ourairports", "geonames"] : ["geonames"]),
  returnAnchor: ({ extra }) => (isChild(extra.type) ? "children" : null),
  intro: ({ mode, extra }) => (mode === "new" && extra.type === "airport" ? "机场一般不用手工新增：技术人员用导入命令从 OurAirports 批量导入。只有数据源里没有的机场才需要在这里录入。" : null),
  notReady: (reason, { extra }) =>
    reason === "CITY_DISABLED"
      ? { field: "cityId", text: "这个城市已经停用。请换一个城市，或先去启用它。" }
      : { text: extra.parent ? `所属${parentName(extra.type)}「${extra.parent.code} ${displayName(extra.parent.name).text}」已停用，不能在它下面新增${childName(extra.type)}。请先启用它。` : "上级已停用，这次没有保存成功。请先启用它。" },
  toggle: {
    objectName: (place) => PLACE_TYPE_NAMES[place.type],
    objectPhrase: (place) => `这个${PLACE_TYPE_NAMES[place.type]}`,
    inUse: (place, count) => ({ text: `这个${PLACE_TYPE_NAMES[place.type]}下还有 ${count} 个启用中的${childName(place.type)}，请先停用它们。` }),
    notReady: (place, reason) => {
      const label = `「${place.code} ${displayName(place.name).text}」`;
      if (reason === "CITY_MISSING") return { text: `${label}还没有指定所属城市，不能启用。请先在下面选择所属城市并保存。` };
      if (reason === "CITY_DISABLED" && place.city) return { text: `${label}所属的城市「${displayName(place.city.name).text}」已停用，不能启用。请先启用这个城市。`, link: { label: "去看这个城市", to: masterEditPath("cities", place.city.id) } };
      if (reason === "PARENT_DISABLED" && place.parent) return { text: `${label}的上级「${place.parent.code} ${displayName(place.parent.name).text}」已停用，不能启用。请先启用上级。`, link: { label: "去看上级", to: masterEditPath("places", place.parent.id) } };
      return null;
    },
  },
  Extra: ({ record, readOnly }) => (
    <>
      {(record.type === "airport" || record.type === "station") && <ChildrenCard parent={record} readOnly={readOnly} />}
      <SourceCard place={record} />
    </>
  ),
  Fields: ({ form, context }) => {
    const { values } = form;
    const { mode, record, readOnly, busy, extra } = context;
    const { type, parent } = extra;
    const locked = mode === "edit";
    const child = isChild(type);
    const canManage = usePlatformCan("master_data.manage");
    const country = countryOf(values, extra, record);
    const parentCode = parent?.code ?? null;

    // 上级取回来以后，把编码的前缀填好
    useEffect(() => {
      if (mode === "new" && child && parentCode !== null && values.code === "") form.set({ code: `${parentCode}-` });
    }, [mode, child, parentCode, values.code]);

    const cityChoices = (extra.cities ?? []).filter((city) => {
      if (city.id === values.cityId) return true;
      if (mode === "new") return city.status === "active";
      return city.country_code === record?.country_code && (record.status !== "active" || city.status === "active");
    });
    const imported = record?.source != null && !record.source.overridden;
    const englishChanged = imported && (values.name.en ?? "").trim() !== (record.name.en ?? "");
    const locationChanged = imported && !samePoint(values.location, record.location);
    const parentRef = record?.parent ?? parent;
    const cityRef = record?.city ?? parent?.city ?? null;
    const noCities = extra.cities !== null && cityChoices.length === 0;

    return (
      <>
        <FormGroup title="基本信息">
          <FieldSlot name="type">
            <StaticField label="类型">{PLACE_TYPE_NAMES[type]}</StaticField>
          </FieldSlot>
          {child ? (
            <>
              <FieldSlot name="parent">
                <StaticField label={`所属${parentName(type)}`} hint="创建后不能修改。">
                  {parentRef ? (
                    <Link className="link" to={masterEditPath("places", parentRef.id)}>{`${parentRef.code} ${displayName(parentRef.name).text}`}</Link>
                  ) : (
                    "…"
                  )}
                </StaticField>
              </FieldSlot>
              <FieldSlot name="cityId">
                <StaticField label="所属城市" hint={`跟随所属${parentName(type)}，不能单独指定。`}>
                  {cityRef ? displayName(cityRef.name).text : "—"}
                </StaticField>
              </FieldSlot>
            </>
          ) : (
            <FieldSlot name="cityId">
              <Combobox
                label="所属城市"
                required
                readOnly={readOnly}
                options={cityChoices.map(cityOption)}
                value={values.cityId}
                placeholder="输入城市名称或编码查找"
                emptyText="还没有启用中的城市"
                loading={extra.cities === null && extra.citiesState === "loading"}
                loadFailed={extra.cities === null && extra.citiesState === "error"}
                errors={form.errors("cityId")}
                hint={noCities ? "请先新增城市。" : mode === "new" ? "国家跟随所属城市。" : `只能换到同一个国家的城市。${type === "airport" ? "它下面的航站楼会跟着一起换。" : type === "station" ? "它下面的出口会跟着一起换。" : ""}`}
                onBlur={() => form.touch("cityId")}
                onChange={(cityId) => {
                  if (mode === "edit" || type !== "station") return form.set({ cityId });
                  const next = extra.cities?.find((city) => city.id === cityId)?.country_code ?? null;
                  const oldPrefix = codePrefix(type, country, null);
                  const follows = values.code === "" || (oldPrefix !== "" && values.code.startsWith(oldPrefix));
                  form.set({ cityId, ...(follows ? { code: `${codePrefix(type, next, null)}${values.code.slice(oldPrefix.length)}` } : {}) });
                }}
              />
            </FieldSlot>
          )}
          <FieldSlot name="code">
            <CodeField
              value={values.code}
              locked={locked}
              busy={busy}
              {...(type === "airport" ? { maxLength: 3 } : {})}
              placeholder={type === "airport" ? "HND" : type === "station" ? "STN-JP-TOKYO" : type === "poi" ? "POI-000123" : type === "terminal" ? "HND-T3" : "STN-JP-TOKYO-E1"}
              hint={
                type === "airport"
                  ? "IATA 三字码，3 个大写字母。创建后不能修改。"
                  : type === "station"
                    ? "格式：STN-国家码-序号。序号是 1 到 10 位大写字母或数字。创建后不能修改。"
                    : type === "poi"
                      ? "格式：POI-序号。序号是 1 到 12 位大写字母或数字。创建后不能修改。"
                      : "格式：上级编码加后缀。后缀是 1 到 6 位大写字母或数字。创建后不能修改。"
              }
              errors={form.errors("code")}
              onChange={(code) => form.set({ code })}
              onBlur={() => form.touch("code")}
            />
          </FieldSlot>
          <FieldSlot name="name" wide>
            <LocalizedInput
              legend="名称"
              required
              readOnly={readOnly}
              busy={busy}
              value={values.name}
              errors={form.errors("name")}
              languageErrors={languageErrors(form.errors, "name")}
              languageNotes={imported && !readOnly ? { en: <SourceNote changed={englishChanged} /> } : {}}
              hint="至少填一种语言。"
              onChange={(name) => form.set({ name })}
              onBlur={() => form.touch("name")}
            />
          </FieldSlot>
          {(type === "station" || type === "poi") && (
            <FieldSlot name="category" wide>
              <RadioGroup
                legend={type === "station" ? "车站类型" : "地标类型"}
                name="category"
                required
                readOnly={readOnly}
                disabled={busy}
                options={(type === "station" ? STATION_CATEGORIES : POI_CATEGORIES).map((category) => ({ value: category, label: PLACE_CATEGORY_NAMES[category] }))}
                value={values.category}
                errors={form.errors("category")}
                onChange={(category) => form.set({ category })}
                onBlur={() => form.touch("category")}
              />
            </FieldSlot>
          )}
          {(type === "airport" || type === "terminal") && (
            <FieldSlot name="flightScope" wide>
              <RadioGroup legend="国际 / 国内（选填）" name="flight-scope" readOnly={readOnly} disabled={busy} options={SCOPE_OPTIONS} value={values.flightScope} {...(type === "airport" ? { hint: "这个机场起降的是国际航班、国内航班，还是都有。" } : {})} onChange={(flightScope) => form.set({ flightScope })} />
            </FieldSlot>
          )}
        </FormGroup>
        <FormGroup title="位置">
          <FieldSlot name="location" wide>
            <CoordinateInput
              legend="坐标"
              readOnly={readOnly}
              busy={busy}
              value={values.location}
              errors={{ lat: form.errors("location.lat")[0] ?? null, lng: form.errors("location.lng")[0] ?? null }}
              hint={child ? `这个${PLACE_TYPE_NAMES[type]}自己的坐标，保留 6 位小数。` : "WGS84 坐标，保留 6 位小数。这是司机到达判定用的位置，请尽量准确。"}
              note={
                <>
                  {imported && !readOnly && <SourceNote changed={locationChanged} />}
                  {child && parent && !readOnly && canManage && (
                    <span>
                      <Button variant="text" size="sm" disabled={busy} onClick={() => form.set({ location: toCoordinateValue(parent.location) })}>{`填入${parentName(type)}的坐标`}</Button>
                    </span>
                  )}
                </>
              }
              onChange={(location) => form.set({ location })}
              onBlur={() => form.touch("location")}
            />
          </FieldSlot>
          {type === "poi" && (
            <FieldSlot name="address" wide>
              {readOnly ? <StaticField label="地址">{values.address === "" ? "—" : values.address}</StaticField> : <TextField label="地址（选填）" autoComplete="off" readOnly={busy} value={values.address} errors={form.errors("address")} onChange={(event) => form.set({ address: event.target.value })} onBlur={() => form.touch("address")} />}
            </FieldSlot>
          )}
        </FormGroup>
      </>
    );
  },
};
