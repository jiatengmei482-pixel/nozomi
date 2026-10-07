/** 车型组、附加服务的新增 / 编辑表单（docs/design/pages/master-data.md 6.4、6.5）。 */
import {
  ADDON_CHARGE_UNITS,
  type AddonChargeUnit,
  type LocalizedText,
  MAX_LUGGAGE,
  MAX_VEHICLE_COMBOS,
  MAX_VEHICLE_SEATS,
  SERVICE_CATEGORIES,
  type ServiceCategory,
  VEHICLE_GRADES,
  VEHICLE_GRADE_ABBREVIATIONS,
  VEHICLE_GRADE_NAMES,
  VEHICLE_POWERS,
  type VehicleGrade,
  type VehiclePower,
  addonCodeIssue,
  vehicleGroupCodeIssue,
} from "@nozomi/domain";
import type { AddonPatch, VehicleGroupPatch } from "../../api/master.ts";
import { CheckboxGroup, CodeField, LocalizedInput, RadioGroup, StaticField } from "../../components/FormFields.tsx";
import { TextField } from "../../components/TextField.tsx";
import { CHARGE_UNIT_HINTS, CHARGE_UNIT_NAMES, SERVICE_CATEGORY_NAMES, VEHICLE_POWER_NAMES, cleanLocalized, sameLocalized } from "../../lib/master-display.ts";
import { masterListPath } from "../../lib/master-paths.ts";
import { type FieldErrors, FieldSlot, FormGroup, type FormModel } from "./MasterForm.tsx";
import { COMMON_PATHS, NAME_MAX_LENGTH, Rows, languageErrors, localizedErrors, pathMapper } from "./forms-common.tsx";

const MAX_SAMPLE_MODELS = 10;
const SAMPLE_MODEL_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 2000;
const INTEGER = /^\d+$/;

interface ComboText {
  passengers: string;
  luggage: string;
}

interface VehicleGroupValues {
  grade: VehicleGrade | null;
  seats: string;
  code: string;
  /** 用户手工改过编码：之后不再跟着等级和座位数自动变 */
  codeEdited: boolean;
  name: LocalizedText;
  power: VehiclePower | null;
  combos: ComboText[];
  models: string[];
}

const EMPTY_GROUP: VehicleGroupValues = { grade: null, seats: "", code: "", codeEdited: false, name: {}, power: null, combos: [{ passengers: "", luggage: "" }], models: [] };

function seatsOf(text: string): number | null {
  const value = INTEGER.test(text.trim()) ? Number(text) : Number.NaN;
  return Number.isInteger(value) && value >= 1 && value <= MAX_VEHICLE_SEATS ? value : null;
}

function suggestedCode(grade: VehicleGrade | null, seats: string): string {
  const count = seatsOf(seats);
  return grade !== null && count !== null ? `VG-${VEHICLE_GRADE_ABBREVIATIONS[grade]}-${count}` : "";
}

function filledCombos(combos: readonly ComboText[]): ComboText[] {
  return combos.filter((combo) => combo.passengers.trim() !== "" || combo.luggage.trim() !== "");
}

function validateGroup(values: VehicleGroupValues, mode: "new" | "edit", lockedSeats: number | null): FieldErrors {
  const errors: FieldErrors = localizedErrors("name", "名称", values.name, NAME_MAX_LENGTH, true);
  const seats = lockedSeats ?? seatsOf(values.seats);
  if (mode === "new") {
    if (values.grade === null) errors["grade"] = ["请选择等级"];
    if (seats === null) errors["seats"] = [`座位数要填 1 到 ${MAX_VEHICLE_SEATS} 的整数`];
    if (values.code === "") errors["code"] = ["请输入编码"];
    else if (seats !== null) {
      const written = /^VG-([A-Z0-9]{2,8})-([1-9][0-9]?)$/.exec(values.code);
      if (!written) errors["code"] = ["编码格式应为 VG-等级-座位数，等级是 2 到 8 位大写字母或数字，例如 VG-BIZ-7"];
      else if (Number(written[2]) !== seats) errors["code"] = [`编码末尾的数字 ${written[2]} 和座位数 ${seats} 不一致`];
      else if (values.grade !== null && vehicleGroupCodeIssue(values.code, seats, values.grade) !== null) {
        const implied = VEHICLE_GRADES.find((grade) => (written[1] ?? "").startsWith(VEHICLE_GRADE_ABBREVIATIONS[grade]));
        errors["code"] = implied
          ? [`编码里的 ${VEHICLE_GRADE_ABBREVIATIONS[implied]} 是「${VEHICLE_GRADE_NAMES[implied]}」的缩写，和所选等级「${VEHICLE_GRADE_NAMES[values.grade]}」不一致。「${VEHICLE_GRADE_NAMES[values.grade]}」的缩写是 ${VEHICLE_GRADE_ABBREVIATIONS[values.grade]}`]
          : ["编码格式应为 VG-等级-座位数，等级是 2 到 8 位大写字母或数字，例如 VG-BIZ-7"];
      }
    }
  }
  if (values.power === null) errors["power"] = ["请选择动力"];
  if (filledCombos(values.combos).length === 0) errors["combos"] = ["至少要有一个组合"];
  const seen = new Map<string, number>();
  values.combos.forEach((combo, index) => {
    if (combo.passengers.trim() === "" && combo.luggage.trim() === "") return;
    const messages: string[] = [];
    const passengers = INTEGER.test(combo.passengers.trim()) ? Number(combo.passengers) : Number.NaN;
    const luggage = INTEGER.test(combo.luggage.trim()) ? Number(combo.luggage) : Number.NaN;
    if (!Number.isInteger(passengers) || passengers < 1) messages.push("人数要填不小于 1 的整数");
    else if (seats !== null && passengers > seats) messages.push(`人数不能超过座位数（${seats} 座）`);
    if (!Number.isInteger(luggage) || luggage > MAX_LUGGAGE) messages.push(`行李数要填 0 到 ${MAX_LUGGAGE} 的整数`);
    const key = `${passengers}/${luggage}`;
    const earlier = seen.get(key);
    if (messages.length === 0 && earlier !== undefined) messages.push(`和第 ${earlier + 1} 个组合重复`);
    if (messages.length === 0) seen.set(key, index);
    if (messages.length > 0) errors[`combos.${index}`] = messages;
  });
  values.models.forEach((model, index) => {
    if ([...model.trim()].length > SAMPLE_MODEL_MAX_LENGTH) errors[`models.${index}`] = [`代表车型最多 ${SAMPLE_MODEL_MAX_LENGTH} 个字`];
  });
  return errors;
}

const comboNumbers = (combos: readonly ComboText[]) => filledCombos(combos).map((combo) => ({ passengers: Number(combo.passengers), luggage: Number(combo.luggage) }));
const modelList = (models: readonly string[]) => models.map((model) => model.trim()).filter((model) => model !== "");

export const vehicleGroupFormModel: FormModel<"vehicle-groups", VehicleGroupValues> = {
  kind: "vehicle-groups",
  moduleName: "车型组",
  objectName: () => "车型组",
  listPath: () => masterListPath("vehicle-groups"),
  useExtra: () => undefined,
  empty: () => EMPTY_GROUP,
  fromRecord: (group) => ({
    grade: group.grade,
    seats: String(group.seats),
    code: group.code,
    codeEdited: true,
    name: group.name,
    power: group.power,
    combos: group.combos.map((combo) => ({ passengers: String(combo.passengers), luggage: String(combo.luggage) })),
    models: [...group.sample_models],
  }),
  validate: (values, context) => validateGroup(values, context.mode, context.record?.seats ?? null),
  labels: { grade: "等级", seats: "座位数", code: "编码", name: "名称", power: "动力", combos: "人数 / 行李数组合", models: "代表车型" },
  fieldOfPath: pathMapper([...COMMON_PATHS, [/^\/grade$/, "grade"], [/^\/seats$/, "seats"], [/^\/power$/, "power"], [/^\/combos\/(\d+)/, (match) => `combos.${match[1]}`], [/^\/combos$/, "combos"], [/^\/sample_models/, "models"]]),
  toCreate: (values) => ({
    code: values.code,
    grade: values.grade ?? "economy",
    seats: Number(values.seats),
    name: cleanLocalized(values.name),
    sample_models: modelList(values.models),
    power: values.power ?? "fuel",
    combos: comboNumbers(values.combos),
  }),
  toPatch: (values, group) => {
    const patch: VehicleGroupPatch = {};
    if (!sameLocalized(values.name, group.name)) patch.name = cleanLocalized(values.name);
    if (values.power !== null && values.power !== group.power) patch.power = values.power;
    if (JSON.stringify(comboNumbers(values.combos)) !== JSON.stringify(group.combos.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })))) patch.combos = comboNumbers(values.combos);
    if (JSON.stringify(modelList(values.models)) !== JSON.stringify(group.sample_models)) patch.sample_models = modelList(values.models);
    return patch;
  },
  continueWith: (values) => ({ ...EMPTY_GROUP, grade: values.grade, power: values.power }),
  Fields: ({ form, context }) => {
    const { values } = form;
    const locked = context.mode === "edit";
    const { readOnly, busy } = context;
    const lockedHint = (what: string): string => `创建后不能修改。要换${what}，请新增一个车型组，再停用这个。`;
    const follow = (next: Partial<VehicleGroupValues>): void => {
      const merged = { ...values, ...next };
      form.set({ ...next, ...(values.codeEdited ? {} : { code: suggestedCode(merged.grade, merged.seats) }) });
    };
    const setCombo = (index: number, part: Partial<ComboText>): void => form.set({ combos: values.combos.map((combo, position) => (position === index ? { ...combo, ...part } : combo)) });
    return (
      <>
        <FormGroup title="基本信息">
          <FieldSlot name="grade">
            <RadioGroup
              legend="等级"
              name="grade"
              required
              readOnly={locked || readOnly}
              disabled={busy}
              options={VEHICLE_GRADES.map((grade) => ({ value: grade, label: VEHICLE_GRADE_NAMES[grade] }))}
              value={values.grade}
              errors={form.errors("grade")}
              {...(locked ? { hint: lockedHint("等级") } : {})}
              onChange={(grade) => follow({ grade })}
              onBlur={() => form.touch("grade")}
            />
          </FieldSlot>
          <FieldSlot name="seats">
            {locked || readOnly ? (
              <StaticField label="座位数" {...(locked ? { hint: lockedHint("座位数") } : {})}>{`${values.seats} 座`}</StaticField>
            ) : (
              <TextField label="座位数（座）" inputMode="numeric" autoComplete="off" required readOnly={busy} value={values.seats} errors={form.errors("seats")} onChange={(event) => follow({ seats: event.target.value })} onBlur={() => form.touch("seats")} />
            )}
          </FieldSlot>
          <FieldSlot name="code" wide>
            <CodeField
              value={values.code}
              locked={locked}
              busy={busy}
              placeholder="VG-BIZ-7"
              hint="格式：VG-等级-座位数。等级缩写：经济 ECO、舒适 CMF、商务 BIZ、豪华 LUX；同等级有多个车型组时可以在缩写后加字母或数字区分，例如 VG-BIZEV-7。创建后不能修改。"
              errors={form.errors("code")}
              onChange={(code) => form.set({ code, codeEdited: code !== "" })}
              onBlur={() => form.touch("code")}
            />
          </FieldSlot>
          <FieldSlot name="name" wide>
            <LocalizedInput legend="名称" required readOnly={readOnly} busy={busy} value={values.name} errors={form.errors("name")} languageErrors={languageErrors(form.errors, "name")} hint="至少填一种语言。" onChange={(name) => form.set({ name })} onBlur={() => form.touch("name")} />
          </FieldSlot>
          <FieldSlot name="power" wide>
            <RadioGroup legend="动力" name="power" required readOnly={readOnly} disabled={busy} options={VEHICLE_POWERS.map((power) => ({ value: power, label: VEHICLE_POWER_NAMES[power] }))} value={values.power} errors={form.errors("power")} onChange={(power) => form.set({ power })} onBlur={() => form.touch("power")} />
          </FieldSlot>
        </FormGroup>
        <FormGroup title="载客">
          <FieldSlot name="combos" wide>
            <Rows
              legend="人数 / 行李数组合"
              itemName="组合"
              pair
              required
              readOnly={readOnly}
              busy={busy}
              count={values.combos.length}
              min={1}
              max={MAX_VEHICLE_COMBOS}
              errors={form.errors("combos")}
              rowErrors={(index) => form.errors(`combos.${index}`)}
              hint="供应商给商品选车型组时，要从这里选一个组合。人数不能超过座位数。"
              onAdd={() => form.set({ combos: [...values.combos, { passengers: "", luggage: "" }] })}
              onRemove={(index) => form.set({ combos: values.combos.filter((_, position) => position !== index) })}
              renderRow={(index) => {
                const combo = values.combos[index] ?? { passengers: "", luggage: "" };
                const invalid = form.errors(`combos.${index}`).length > 0 || undefined;
                return readOnly ? (
                  <p className="field__static">{`${combo.passengers} 人 ${combo.luggage} 件`}</p>
                ) : (
                  <>
                    <span className="rows__cell">
                      <input className="input" inputMode="numeric" autoComplete="off" aria-label={`第 ${index + 1} 个组合的人数`} aria-invalid={invalid} readOnly={busy} value={combo.passengers} onChange={(event) => setCombo(index, { passengers: event.target.value })} onBlur={() => form.touch("combos")} />
                      <span className="rows__unit">人</span>
                    </span>
                    <span className="rows__cell">
                      <input className="input" inputMode="numeric" autoComplete="off" aria-label={`第 ${index + 1} 个组合的行李数`} aria-invalid={invalid} readOnly={busy} value={combo.luggage} onChange={(event) => setCombo(index, { luggage: event.target.value })} onBlur={() => form.touch("combos")} />
                      <span className="rows__unit">件</span>
                    </span>
                  </>
                );
              }}
            />
          </FieldSlot>
          <FieldSlot name="models" wide>
            <Rows
              legend="代表车型（选填）"
              itemName="代表车型"
              readOnly={readOnly}
              busy={busy}
              count={values.models.length}
              max={MAX_SAMPLE_MODELS}
              errors={[]}
              rowErrors={(index) => form.errors(`models.${index}`)}
              hint="让人知道这个车型组大概是什么车，写具体的品牌车型。"
              onAdd={() => form.set({ models: [...values.models, ""] })}
              onRemove={(index) => form.set({ models: values.models.filter((_, position) => position !== index) })}
              renderRow={(index) =>
                readOnly ? (
                  <p className="field__static">{values.models[index]}</p>
                ) : (
                  <span className="rows__cell">
                    <input className="input" autoComplete="off" aria-label={`第 ${index + 1} 个代表车型`} readOnly={busy} value={values.models[index] ?? ""} onChange={(event) => form.set({ models: values.models.map((model, position) => (position === index ? event.target.value : model)) })} onBlur={() => form.touch("models")} />
                  </span>
                )
              }
            />
          </FieldSlot>
        </FormGroup>
      </>
    );
  },
  toggle: { objectName: () => "车型组", objectPhrase: () => "这个车型组" },
};

interface AddonValues {
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  categories: ServiceCategory[];
  chargeUnit: AddonChargeUnit | null;
}

const ADDON_PREFIX = "ADD-";
const EMPTY_ADDON: AddonValues = { code: ADDON_PREFIX, name: {}, description: {}, categories: [], chargeUnit: null };
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value) => b.includes(value));

export const addonFormModel: FormModel<"addons", AddonValues> = {
  kind: "addons",
  moduleName: "附加服务",
  objectName: () => "附加服务",
  listPath: () => masterListPath("addons"),
  useExtra: () => undefined,
  empty: () => EMPTY_ADDON,
  fromRecord: (addon) => ({ code: addon.code, name: addon.name, description: addon.description, categories: [...addon.categories], chargeUnit: addon.charge_unit }),
  validate: (values, context) => {
    const errors: FieldErrors = { ...localizedErrors("name", "名称", values.name, NAME_MAX_LENGTH, true), ...localizedErrors("description", "说明", values.description, DESCRIPTION_MAX_LENGTH, false) };
    if (context.mode === "new") {
      if (values.code === "" || values.code === ADDON_PREFIX) errors["code"] = ["请输入编码"];
      else if (addonCodeIssue(values.code) !== null) errors["code"] = ["编码格式应为 ADD-代码，代码以大写字母开头，只用大写字母、数字、下划线，例如 ADD-CHILD_SEAT"];
    }
    if (values.categories.length === 0) errors["categories"] = ["请至少选择一个品类"];
    if (values.chargeUnit === null) errors["chargeUnit"] = ["请选择计费方式"];
    return errors;
  },
  labels: { code: "编码", name: "名称", description: "说明", categories: "适用品类", chargeUnit: "计费方式" },
  fieldOfPath: pathMapper([...COMMON_PATHS, [/^\/description\/(zh|ja|en|ko)$/, (match) => `description.${match[1]}`], [/^\/description$/, "description"], [/^\/categories/, "categories"], [/^\/charge_unit$/, "chargeUnit"]]),
  toCreate: (values) => ({ code: values.code, name: cleanLocalized(values.name), description: cleanLocalized(values.description), categories: SERVICE_CATEGORIES.filter((category) => values.categories.includes(category)), charge_unit: values.chargeUnit ?? "per_order" }),
  toPatch: (values, addon) => {
    const patch: AddonPatch = {};
    if (!sameLocalized(values.name, addon.name)) patch.name = cleanLocalized(values.name);
    if (!sameLocalized(values.description, addon.description)) patch.description = cleanLocalized(values.description);
    if (!sameSet(values.categories, addon.categories)) patch.categories = SERVICE_CATEGORIES.filter((category) => values.categories.includes(category));
    if (values.chargeUnit !== null && values.chargeUnit !== addon.charge_unit) patch.charge_unit = values.chargeUnit;
    return patch;
  },
  continueWith: (values) => ({ ...EMPTY_ADDON, categories: values.categories, chargeUnit: values.chargeUnit }),
  Fields: ({ form, context }) => {
    const { values } = form;
    const { readOnly, busy } = context;
    return (
      <>
        <FormGroup title="基本信息">
          <FieldSlot name="code" wide>
            <CodeField
              value={values.code}
              locked={context.mode === "edit"}
              busy={busy}
              placeholder="ADD-CHILD_SEAT"
              hint="格式：ADD-代码。代码以大写字母开头，只用大写字母、数字和下划线，最多 40 位。创建后不能修改。"
              errors={form.errors("code")}
              onChange={(code) => form.set({ code })}
              onBlur={() => form.touch("code")}
            />
          </FieldSlot>
          <FieldSlot name="name" wide>
            <LocalizedInput legend="名称" required readOnly={readOnly} busy={busy} value={values.name} errors={form.errors("name")} languageErrors={languageErrors(form.errors, "name")} hint="至少填一种语言。" onChange={(name) => form.set({ name })} onBlur={() => form.touch("name")} />
          </FieldSlot>
          <FieldSlot name="description" wide>
            <LocalizedInput legend="说明（选填）" multiline maxLength={DESCRIPTION_MAX_LENGTH} readOnly={readOnly} busy={busy} value={values.description} languageErrors={languageErrors(form.errors, "description")} hint="给客人看的说明：这项服务包含什么、有什么限制。" onChange={(description) => form.set({ description })} onBlur={() => form.touch("description")} />
          </FieldSlot>
        </FormGroup>
        <FormGroup title="适用范围与计费">
          <FieldSlot name="categories" wide>
            <CheckboxGroup legend="适用品类" name="categories" required readOnly={readOnly} disabled={busy} options={SERVICE_CATEGORIES.map((category) => ({ value: category, label: SERVICE_CATEGORY_NAMES[category] }))} value={values.categories} errors={form.errors("categories")} hint="只有勾选的品类的商品可以提供这项服务。" onChange={(categories) => form.set({ categories })} onBlur={() => form.touch("categories")} />
          </FieldSlot>
          <FieldSlot name="chargeUnit" wide>
            <RadioGroup
              legend="计费方式"
              name="charge-unit"
              required
              readOnly={readOnly}
              disabled={busy}
              options={ADDON_CHARGE_UNITS.map((unit) => ({ value: unit, label: CHARGE_UNIT_NAMES[unit], hint: CHARGE_UNIT_HINTS[unit] }))}
              value={values.chargeUnit}
              errors={form.errors("chargeUnit")}
              hint="单价不在这里设置，由各供应商在自己的商品里定价。"
              onChange={(chargeUnit) => form.set({ chargeUnit })}
              onBlur={() => form.touch("chargeUnit")}
            />
          </FieldSlot>
        </FormGroup>
      </>
    );
  },
  toggle: { objectName: () => "附加服务", objectPhrase: () => "这项附加服务" },
};
