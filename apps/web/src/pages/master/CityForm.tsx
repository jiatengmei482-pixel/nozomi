/** 城市的新增 / 编辑表单（docs/design/pages/master-data.md 6.1）。新增城市对话框用的是同一套字段。 */
import { type LocalizedText, cityCodeIssue, isIanaTimeZone } from "@nozomi/domain";
import { useMemo } from "react";
import type { City, CityCreate, CityPatch } from "../../api/master.ts";
import { Combobox, type ComboboxOption } from "../../components/Combobox.tsx";
import { CodeField, CoordinateInput, type CoordinateValue, LocalizedInput, StaticField } from "../../components/FormFields.tsx";
import { cleanLocalized, countryLabel, sameLocalized, timeZoneLabel, timeZoneOffset } from "../../lib/master-display.ts";
import { masterListPath } from "../../lib/master-paths.ts";
import { type FieldErrors, FieldSlot, type FormApi, FormGroup, type FormModel } from "./MasterForm.tsx";
import { COMMON_PATHS, NAME_MAX_LENGTH, coordinateErrors, languageErrors, localizedErrors, pathMapper, samePoint, toCoordinateValue, toPoint } from "./forms-common.tsx";
import { useAllCities, useCountryOptions } from "./shared.tsx";

export interface CityValues {
  country: string | null;
  code: string;
  name: LocalizedText;
  timezone: string | null;
  center: CoordinateValue;
}

export const EMPTY_CITY: CityValues = { country: null, code: "", name: {}, timezone: null, center: { lat: "", lng: "" } };

export function cityCodePrefix(country: string | null): string {
  return country === null ? "" : `CTY-${country}-`;
}

let timeZoneOptions: ComboboxOption[] | null = null;
/** 浏览器的时区清单里「大洲/城市」写法的那些，显示成「Asia/Tokyo（UTC+9）」。 */
export function allTimeZoneOptions(): ComboboxOption[] {
  timeZoneOptions ??= Intl.supportedValuesOf("timeZone")
    .filter((zone) => zone.includes("/") && !zone.startsWith("Etc/"))
    .map((zone) => ({ value: zone, label: timeZoneLabel(zone), keywords: `${zone.replaceAll("_", " ")} ${(timeZoneOffset(zone) ?? "").replace("UTC", "")}` }));
  return timeZoneOptions;
}

export function validateCity(values: CityValues, mode: "new" | "edit"): FieldErrors {
  const errors: FieldErrors = { ...localizedErrors("name", "名称", values.name, NAME_MAX_LENGTH, true), ...coordinateErrors("center", values.center) };
  if (values.timezone === null || !isIanaTimeZone(values.timezone)) errors["timezone"] = ["请选择时区"];
  if (mode === "edit") return errors;
  if (values.country === null) errors["country"] = ["请选择国家"];
  if (values.code === "" || values.code === cityCodePrefix(values.country)) errors["code"] = ["请输入编码"];
  else if (cityCodeIssue(values.code, values.country ?? "") !== null) {
    const written = /^CTY-([A-Z]{2})-[A-Z0-9]{2,8}$/.exec(values.code);
    errors["code"] =
      written && values.country !== null
        ? [`编码里的国家码 ${written[1]} 和所选国家 ${countryLabel(values.country)} 不一致`]
        : ["编码格式应为 CTY-国家码-序号，序号是 2 到 8 位大写字母或数字，例如 CTY-JP-TYO"];
  }
  return errors;
}

export function cityCreateBody(values: CityValues): CityCreate {
  return { code: values.code, country_code: values.country ?? "", name: cleanLocalized(values.name), timezone: values.timezone ?? "", center: toPoint(values.center) };
}

export const CITY_LABELS = { country: "国家", code: "编码", name: "名称", timezone: "时区", center: "中心坐标" } as const;

export const cityFieldOfPath = pathMapper([
  ...COMMON_PATHS,
  [/^\/country_code$/, "country"],
  [/^\/timezone$/, "timezone"],
  [/^\/center\/lat$/, "center.lat"],
  [/^\/center\/lng$/, "center.lng"],
  [/^\/center$/, "center.lat"],
]);

export interface CityFieldsProps {
  form: FormApi<CityValues>;
  mode: "new" | "edit";
  readOnly: boolean;
  busy: boolean;
  /** 国家已经定了、不能选（在处理机场的页面里新增城市） */
  fixedCountry?: boolean;
  cities: readonly City[] | null;
  boundarySet?: boolean;
  /** 坐标下面另外的内容（「填入这个机场的坐标」） */
  centerNote?: React.ReactNode;
}

export function CityFields({ form, mode, readOnly, busy, fixedCountry = false, cities, boundarySet = false, centerNote }: CityFieldsProps) {
  const { values } = form;
  const countryOptions = useCountryOptions(cities);
  // 已有的时区即使不在浏览器的清单里（同一个时区的旧写法）也要照常显示、能原样保存
  const current = values.timezone;
  const zones = useMemo(() => {
    const listed = allTimeZoneOptions();
    return current === null || listed.some((zone) => zone.value === current) ? listed : [{ value: current, label: timeZoneLabel(current), keywords: current.replaceAll("_", " ") }, ...listed];
  }, [current]);
  const locked = mode === "edit";
  return (
    <>
      <FormGroup title="基本信息">
        <FieldSlot name="country">
          {locked || fixedCountry || readOnly ? (
            <StaticField label="国家" {...(locked ? { hint: "创建后不能修改。" } : {})}>
              {values.country === null ? "—" : countryLabel(values.country)}
            </StaticField>
          ) : (
            <Combobox
              label="国家"
              required
              options={countryOptions}
              value={values.country}
              placeholder="输入国名或两位代码查找"
              errors={form.errors("country")}
              onBlur={() => form.touch("country")}
              onChange={(country) => {
                const oldPrefix = cityCodePrefix(values.country);
                const followsPrefix = values.code === "" || (oldPrefix !== "" && values.code.startsWith(oldPrefix));
                form.set({ country, ...(followsPrefix ? { code: `${cityCodePrefix(country)}${values.code.slice(oldPrefix.length)}` } : {}) });
              }}
            />
          )}
        </FieldSlot>
        <FieldSlot name="code">
          <CodeField
            value={values.code}
            locked={locked}
            busy={busy}
            placeholder="CTY-JP-TYO"
            hint="格式：CTY-国家码-序号。序号是 2 到 8 位大写字母或数字，建议用城市的通用缩写。创建后不能修改。"
            errors={form.errors("code")}
            onChange={(code) => form.set({ code })}
            onBlur={() => form.touch("code")}
          />
        </FieldSlot>
        <FieldSlot name="name" wide>
          <LocalizedInput legend="名称" required readOnly={readOnly} busy={busy} value={values.name} errors={form.errors("name")} languageErrors={languageErrors(form.errors, "name")} hint="至少填一种语言。" onChange={(name) => form.set({ name })} onBlur={() => form.touch("name")} />
        </FieldSlot>
      </FormGroup>
      <FormGroup title="位置与时区">
        <FieldSlot name="timezone" wide>
          <Combobox
            label="时区"
            required
            readOnly={readOnly}
            options={zones}
            value={values.timezone}
            placeholder="输入城市名或偏移查找，例如 tokyo、+9"
            hint="这个城市的服务时间、夜间时段、派车截止时间都按这个时区算。"
            errors={form.errors("timezone")}
            onChange={(timezone) => form.set({ timezone })}
            onBlur={() => form.touch("timezone")}
          />
        </FieldSlot>
        <FieldSlot name="center" wide>
          <CoordinateInput
            legend="中心坐标"
            readOnly={readOnly}
            busy={busy}
            value={values.center}
            errors={{ lat: form.errors("center.lat")[0] ?? null, lng: form.errors("center.lng")[0] ?? null }}
            hint="WGS84 坐标，保留 6 位小数。可以从地图软件里复制「纬度, 经度」直接粘贴。"
            note={centerNote}
            onChange={(center) => form.set({ center })}
            onBlur={() => form.touch("center")}
          />
        </FieldSlot>
        {mode === "edit" && (
          <FieldSlot name="boundary" wide>
            <StaticField label="边界" hint="城市边界暂时不能在这里编辑。">
              {boundarySet ? "已设置" : "未设置"}
            </StaticField>
          </FieldSlot>
        )}
      </FormGroup>
    </>
  );
}

export const cityFormModel: FormModel<"cities", CityValues, { cities: City[] | null }> = {
  kind: "cities",
  moduleName: "城市",
  objectName: () => "城市",
  listPath: () => masterListPath("cities"),
  useExtra: () => ({ cities: useAllCities().state.data }),
  empty: () => EMPTY_CITY,
  fromRecord: (city) => ({ country: city.country_code, code: city.code, name: city.name, timezone: city.timezone, center: toCoordinateValue(city.center) }),
  validate: (values, context) => validateCity(values, context.mode),
  labels: CITY_LABELS,
  fieldOfPath: cityFieldOfPath,
  toCreate: cityCreateBody,
  toPatch: (values, city) => {
    const patch: CityPatch = {};
    if (!sameLocalized(values.name, city.name)) patch.name = cleanLocalized(values.name);
    if (values.timezone !== null && values.timezone !== city.timezone) patch.timezone = values.timezone;
    if (!samePoint(values.center, city.center)) patch.center = toPoint(values.center);
    return patch;
  },
  continueWith: (values) => ({ ...EMPTY_CITY, country: values.country, code: cityCodePrefix(values.country), timezone: values.timezone }),
  Fields: ({ form, context }) => <CityFields form={form} mode={context.mode} readOnly={context.readOnly} busy={context.busy} cities={context.extra.cities} boundarySet={context.record?.boundary != null} />,
  toggle: {
    objectName: () => "城市",
    objectPhrase: () => "这个城市",
    inUse: (_city, count) => ({ text: `这个城市下还有 ${count} 个启用中的地点，请先停用它们，再回来停用城市。` }),
  },
};
