/**
 * 四个列表页各自的列、筛选条件和文案（docs/design/pages/master-data.md 第 3 节）。
 */
import { VEHICLE_GRADES, type VehicleGrade } from "@nozomi/domain";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { type City, type DashboardSummary, type Place, fetchDashboardSummary } from "../../api/master.ts";
import { Alert } from "../../components/Alert.tsx";
import { LinkButton } from "../../components/Button.tsx";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import {
  CHARGE_UNIT_NAMES,
  SERVICE_CATEGORY_NAMES,
  VEHICLE_POWER_NAMES,
  countryLabel,
  displayName,
  flightScopeName,
  formatCount,
  placeCategoryName,
  timeZoneLabel,
  vehicleGradeName,
} from "../../lib/master-display.ts";
import { PLACE_TABS, type PlaceTab, masterEditPath, masterNewPath, pendingAirportsPath, placeListPath } from "../../lib/master-paths.ts";
import { PLACE_TYPE_NAMES } from "../../lib/master-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { type ListDefinition, MasterList } from "./MasterList.tsx";
import { cityOption, useAllCities, useCountryOptions } from "./shared.tsx";

const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 页面自己读网址里的条件（决定查什么）。 */
function useUrlParam(name: string): string | null {
  return useSearchParams()[0].get(name);
}

function CountryFilter({ cities }: { cities: readonly City[] | null }) {
  const [country, setCountry] = useFilterParam("country");
  const options = useCountryOptions(cities);
  return <Combobox inline label="国家" clearLabel="全部" placeholder="全部" options={options} value={country !== null && COUNTRY_PATTERN.test(country) ? country : null} onChange={setCountry} />;
}

export function CityListPage() {
  const cities = useAllCities();
  const country = useUrlParam("country");
  const validCountry = country !== null && COUNTRY_PATTERN.test(country) ? country : null;
  const definition: ListDefinition<"cities"> = {
    kind: "cities",
    title: "城市",
    objectName: "城市",
    objectPhrase: "这个城市",
    newPath: masterNewPath("cities"),
    columns: [
      { key: "country", header: "国家", cell: (row) => countryLabel(row.country_code) },
      { key: "timezone", header: "时区", cell: (row) => <span className="mono">{timeZoneLabel(row.timezone)}</span> },
    ],
    filters: <CountryFilter cities={cities.state.data} />,
    query: validCountry ? { country_code: validCountry } : {},
    filterParams: ["country"],
    empty: { title: "还没有城市", description: "先新增城市，才能新增地点、给导入的机场指定城市。" },
    footnotes: ["geonames"],
    inUse: (row, count) => ({
      text: `这个城市下还有 ${formatCount(count)} 个启用中的地点，请先停用它们，再回来停用城市。`,
      link: { label: "查看这些地点", to: placeListPath("airport", { city: row.id, status: "active" }) },
    }),
  };
  return <MasterList definition={definition} />;
}

const TAB_COPY: Readonly<Record<PlaceTab, { empty: { title: string; description: string } }>> = {
  airport: { empty: { title: "还没有机场", description: "机场由技术人员用导入命令从 OurAirports 批量导入；数据源里没有的，可以在这里手工新增。" } },
  station: { empty: { title: "还没有车站", description: "新增车站后，可以在车站的编辑页里给它添加出口。" } },
  poi: { empty: { title: "还没有地标", description: "地标是酒店、景点、港口、商场这类常用的上下车地点。" } },
};

/** 刚用 ← → 切了页签：新页面画出来以后把焦点放回选中的页签上（列表随页签整个重画，焦点会丢）。 */
let refocusSelectedTab = false;

function PlaceTabs({ current }: { current: PlaceTab }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!refocusSelectedTab) return;
    refocusSelectedTab = false;
    listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [current]);
  const [params] = useSearchParams();
  const keep: Record<string, string> = {};
  for (const key of ["q", "status"]) {
    const value = params.get(key);
    if (value) keep[key] = value;
  }
  return (
    <div
      ref={listRef}
      className="tabs"
      role="tablist"
      aria-label="地点类型"
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
        const index = tabs.indexOf(document.activeElement as HTMLElement);
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        refocusSelectedTab = true;
        next?.click();
      }}
    >
      {PLACE_TABS.map((tab) => (
        <Link key={tab} role="tab" className="tab" aria-selected={tab === current} tabIndex={tab === current ? 0 : -1} to={placeListPath(tab, keep)} replace>
          {PLACE_TYPE_NAMES[tab]}
        </Link>
      ))}
    </div>
  );
}

function CityFilter({ options, loading, loadFailed }: { options: ComboboxOption[]; loading: boolean; loadFailed: boolean }) {
  const [city, setCity] = useFilterParam("city");
  const value = city !== null && options.some((option) => option.value === city) ? city : null;
  return <Combobox inline label="所属城市" clearLabel="全部" placeholder="全部" options={options} value={value} onChange={setCity} loading={loading} loadFailed={loadFailed} />;
}

function GradeFilter() {
  const [grade, setGrade] = useFilterParam("grade");
  const value = (VEHICLE_GRADES as readonly string[]).includes(grade ?? "") ? (grade as VehicleGrade) : "all";
  return <SelectField inline label="等级" value={value} options={[{ value: "all", label: "全部" }, ...VEHICLE_GRADES.map((entry) => ({ value: entry, label: vehicleGradeName(entry) }))]} onChange={(next) => setGrade(next === "all" ? null : next)} />;
}

function CityCell({ place, cities }: { place: Place; cities: readonly City[] | null }) {
  if (place.city === null) return <StatusBadge tone="warning" label="待指定城市" />;
  const shown = displayName(place.city.name);
  const disabled = cities?.find((city) => city.id === place.city_id)?.status === "disabled";
  return (
    <span className="table__inline">
      <span lang={shown.lang}>{shown.text}</span>
      {disabled && <StatusBadge tone="neutral" label="城市已停用" />}
    </span>
  );
}

export function PlaceListPage() {
  const [params] = useSearchParams();
  const typeParam = params.get("type");
  const tab: PlaceTab = typeParam === "station" || typeParam === "poi" ? typeParam : "airport";
  const canManage = usePlatformCan("master_data.manage");
  const cities = useAllCities();
  const summary = useLoad<DashboardSummary>("summary", tab === "airport" ? fetchDashboardSummary : null);
  const cityParam = useUrlParam("city");
  const countryParam = useUrlParam("country");
  const city = cityParam === "none" && tab === "airport" ? "none" : cityParam !== null && UUID_PATTERN.test(cityParam) ? cityParam : null;
  const country = countryParam !== null && COUNTRY_PATTERN.test(countryParam) ? countryParam : null;
  const waiting = tab === "airport" ? (summary.state.data?.master_data?.places.airports_without_city ?? 0) : 0;
  const viewedCity = city !== null && city !== "none" ? (cities.state.data?.find((entry) => entry.id === city) ?? null) : null;
  const objectName = PLACE_TYPE_NAMES[tab];

  const cityOptions = [...(tab === "airport" ? [{ value: "none", label: "待指定城市" }] : []), ...(cities.state.data ?? []).map(cityOption)];
  const middle: ListDefinition<"places">["columns"] =
    tab === "airport"
      ? [
          { key: "city", header: "所属城市", cell: (row) => <CityCell place={row} cities={cities.state.data} /> },
          { key: "country", header: "国家", cell: (row) => countryLabel(row.country_code) },
          { key: "scope", header: "国际 / 国内", cell: (row) => flightScopeName(row.flight_scope) },
          {
            key: "source",
            header: "来源",
            cell: (row) => (
              <span className="table__inline">
                {row.source ? "OurAirports" : "手工录入"}
                {row.source?.overridden && <span className="tag">已改过</span>}
              </span>
            ),
          },
        ]
      : tab === "station"
        ? [
            { key: "category", header: "车站类型", cell: (row) => placeCategoryName(row.category) },
            { key: "city", header: "所属城市", cell: (row) => <CityCell place={row} cities={cities.state.data} /> },
            { key: "country", header: "国家", cell: (row) => countryLabel(row.country_code) },
          ]
        : [
            { key: "category", header: "地标类型", cell: (row) => placeCategoryName(row.category) },
            { key: "city", header: "所属城市", cell: (row) => <CityCell place={row} cities={cities.state.data} /> },
            { key: "address", header: "地址", wrap: true, cell: (row) => row.address ?? "—" },
          ];

  const definition: ListDefinition<"places"> = {
    kind: "places",
    title: "地点",
    objectName,
    objectPhrase: `这个${objectName}`,
    newPath: `${masterNewPath("places")}?type=${tab}`,
    columns: middle,
    query: { type: tab, ...(city !== null ? { city_id: city } : {}), ...(country !== null ? { country_code: country } : {}) },
    filterParams: ["city", "country"],
    filters: (
      <>
        <CityFilter options={cityOptions} loading={cities.state.status === "loading" && cities.state.data === null} loadFailed={cities.state.status === "error"} />
        <CountryFilter cities={cities.state.data} />
      </>
    ),
    empty: TAB_COPY[tab].empty,
    footnotes: tab === "airport" ? ["ourairports", "geonames"] : ["geonames"],
    header: (
      <>
        <PlaceTabs current={tab} />
        {waiting > 0 && (
          <Alert kind="warning">
            <strong className="alert__title">{`有 ${formatCount(waiting)} 个导入的机场还没有指定城市。`}</strong>
            <span>指定城市后才能启用，供应商才能选到它们。</span>
            <span className="alert__actions">
              {canManage ? (
                <LinkButton variant="text" size="sm" to={pendingAirportsPath()}>
                  去处理
                </LinkButton>
              ) : (
                <LinkButton variant="text" size="sm" to={placeListPath("airport", { city: "none" })}>
                  只看这些
                </LinkButton>
              )}
            </span>
          </Alert>
        )}
        {viewedCity && params.get("status") === "active" && (
          <Alert kind="info">{`正在查看城市「${displayName(viewedCity.name).text}」下启用中的地点。车站、地标请切换页签查看。`}</Alert>
        )}
      </>
    ),
    blockedAction: (row) => (row.type === "airport" && row.city_id === null ? { label: "指定城市", to: pendingAirportsPath(row.id) } : null),
    inUse: (row, count) => {
      const child = row.type === "station" ? "出口" : "航站楼";
      return { text: `这个${PLACE_TYPE_NAMES[row.type]}下还有 ${formatCount(count)} 个启用中的${child}，请先停用它们。`, link: { label: `去看${child}`, to: masterEditPath("places", row.id) } };
    },
    notReady: (row, reason) => {
      const label = `「${row.code} ${displayName(row.name).text}」`;
      if (reason === "CITY_MISSING") return { text: `${label}还没有指定所属城市，不能启用。`, link: { label: "去指定城市", to: pendingAirportsPath(row.id) } };
      if (reason === "CITY_DISABLED" && row.city) return { text: `${label}所属的城市「${displayName(row.city.name).text}」已停用，不能启用。请先启用这个城市。`, link: { label: "去看这个城市", to: masterEditPath("cities", row.city.id) } };
      if (reason === "PARENT_DISABLED" && row.parent) return { text: `${label}的上级「${row.parent.code} ${displayName(row.parent.name).text}」已停用，不能启用。请先启用上级。`, link: { label: "去看上级", to: masterEditPath("places", row.parent.id) } };
      return null;
    },
  };
  return <MasterList key={tab} definition={definition} />;
}

export function VehicleGroupListPage() {
  const gradeParam = useUrlParam("grade");
  const grade = (VEHICLE_GRADES as readonly string[]).includes(gradeParam ?? "") ? (gradeParam as VehicleGrade) : null;
  const definition: ListDefinition<"vehicle-groups"> = {
    kind: "vehicle-groups",
    title: "车型组",
    objectName: "车型组",
    objectPhrase: "这个车型组",
    newPath: masterNewPath("vehicle-groups"),
    columns: [
      { key: "grade", header: "等级", cell: (row) => vehicleGradeName(row.grade) },
      { key: "seats", header: "座位数", align: "end", cell: (row) => row.seats },
      { key: "power", header: "动力", cell: (row) => VEHICLE_POWER_NAMES[row.power] },
      {
        key: "combos",
        header: "人数 / 行李数",
        cell: (row) => (
          <span className="tags">
            {row.combos.slice(0, 3).map((combo) => (
              <span key={`${combo.passengers}-${combo.luggage}`} className="tag">{`${combo.passengers} 人 ${combo.luggage} 件`}</span>
            ))}
            {row.combos.length > 3 && <span className="tag">{`+${row.combos.length - 3}`}</span>}
          </span>
        ),
      },
    ],
    filters: <GradeFilter />,
    query: grade ? { grade } : {},
    filterParams: ["grade"],
    empty: { title: "还没有车型组", description: "报价、库存和订单都按车型组来，不按具体的车。" },
  };
  return <MasterList definition={definition} />;
}

export function AddonListPage() {
  const definition: ListDefinition<"addons"> = {
    kind: "addons",
    title: "附加服务",
    objectName: "附加服务",
    objectPhrase: "这项附加服务",
    newPath: masterNewPath("addons"),
    columns: [
      {
        key: "categories",
        header: "适用品类",
        cell: (row) => (
          <span className="tags">
            {(["airport_transfer", "point_to_point", "charter"] as const)
              .filter((category) => row.categories.includes(category))
              .map((category) => (
                <span key={category} className="tag">
                  {SERVICE_CATEGORY_NAMES[category]}
                </span>
              ))}
          </span>
        ),
      },
      { key: "unit", header: "计费方式", cell: (row) => CHARGE_UNIT_NAMES[row.charge_unit] },
    ],
    empty: { title: "还没有附加服务", description: "这里维护附加服务的目录。单价不在这里，由各供应商在自己的商品里设置。" },
  };
  return <MasterList definition={definition} />;
}
