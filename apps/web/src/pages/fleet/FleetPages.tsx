/**
 * 供应商后台「车队」：司机、车辆（M3-02，ADR 0027）。列表、新增、修改、停用（需求「删除 = 停用」）。
 * 看：`fleet.read`（管理员、调度、只读）；新增、修改、停用：`fleet.manage`（管理员、调度）。
 * 资料的规则在后端（@nozomi/domain 的 dispatch.ts）：电话要国际格式、语言来自主数据、非营业牌照不能设为可用；出错时按字段显示后端给的说明。
 */
import { DRIVER_LANGUAGES, DRIVER_STATUSES, PLATE_TYPES, PLATE_TYPE_NAMES, VEHICLE_STATUSES, VEHICLE_STATUS_NAMES, DRIVER_STATUS_NAMES, type DriverStatus, type PlateType, type VehicleStatus } from "@nozomi/domain";
import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type Driver, type DriverInput, type ExpiryState, type ListPage, type Vehicle, type VehicleInput, createDriver, createVehicle, disableDriver, disableVehicle, listDrivers, listVehicles, updateDriver, updateVehicle } from "../../api/dispatch.ts";
import type { VehicleGroup } from "../../api/master.ts";
import { listTenantVehicleGroups } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CheckboxGroup, SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { DRIVER_STATUS_BADGES, StatusBadge, VEHICLE_STATUS_BADGES } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { displayName } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";

const TRAIL = [{ label: "车队" }];
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { ja: "日语", zh: "中文", en: "英语", ko: "韩语" };

const EXPIRY_BADGE: Readonly<Record<ExpiryState, { tone: "warning" | "danger"; label: string } | null>> = {
  valid: null,
  expiring: { tone: "warning", label: "30 天内到期" },
  expired: { tone: "danger", label: "已过期" },
};

function ExpiryCell({ date, state }: { date: string; state: ExpiryState }) {
  const badge = EXPIRY_BADGE[state];
  return (
    <span className="table__inline">
      <span>{date}</span>
      {badge !== null && <StatusBadge tone={badge.tone} label={badge.label} />}
    </span>
  );
}

/** 后端校验不过时按字段给出的说明（`details.issues[].path` → 说明）。 */
function fieldErrors(err: unknown): Record<string, string[]> {
  if (!(err instanceof ApiError) || err.code !== "VALIDATION_FAILED") return {};
  const issues = (err.details["issues"] as { path?: string; message?: string }[] | undefined) ?? [];
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = (issue.path ?? "/").split("/")[1] ?? "";
    (out[key] ??= []).push(issue.message ?? "格式不对");
  }
  return out;
}

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;

// ---- 司机 ----

interface DriverForm {
  name: string;
  phone: string;
  languages: string[];
  licenseExpiresOn: string;
  drivingYears: string;
  gold: boolean;
  status: DriverStatus;
}

const emptyDriver: DriverForm = { name: "", phone: "", languages: ["ja"], licenseExpiresOn: "", drivingYears: "", gold: false, status: "active" };

function driverForm(driver: Driver): DriverForm {
  return { name: driver.name, phone: driver.phone, languages: driver.languages, licenseExpiresOn: driver.license_expires_on, drivingYears: driver.driving_years === null ? "" : String(driver.driving_years), gold: driver.gold, status: driver.status };
}

function DriverDialog({ editing, onClose, onSaved }: { editing: Driver | null; onClose(): void; onSaved(driver: Driver): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [form, setForm] = useState<DriverForm>(editing === null ? emptyDriver : driverForm(editing));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const set = <K extends keyof DriverForm>(field: K, value: DriverForm[K]): void => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const missing: Record<string, string[]> = {};
    if (form.name.trim() === "") missing["name"] = ["请填写姓名"];
    if (form.phone.trim() === "") missing["phone"] = ["请填写电话"];
    if (form.languages.length === 0) missing["languages"] = ["至少选一种语言"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.licenseExpiresOn)) missing["license_expires_on"] = ["请填写驾照到期日"];
    if (form.drivingYears !== "" && !/^\d{1,2}$/.test(form.drivingYears)) missing["driving_years"] = ["驾龄写整数年"];
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const body: DriverInput = { name: form.name.trim(), phone: form.phone.trim(), languages: form.languages, license_expires_on: form.licenseExpiresOn, driving_years: form.drivingYears === "" ? null : Number(form.drivingYears), gold: form.gold, status: form.status };
    setWorking(true);
    setProblem(null);
    try {
      onSaved(editing === null ? await createDriver(token, body, key) : await updateDriver(token, editing.id, editing.version, body));
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const byField = fieldErrors(err);
      if (Object.keys(byField).length > 0) setErrors(byField);
      else if (err instanceof ApiError && err.code === "DRIVER_PHONE_TAKEN") setErrors({ phone: ["已经有一位司机登记了这个电话"] });
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("这位司机的资料刚被别人改过，请关掉后刷新再改。");
      else setProblem(failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open title={editing === null ? "新增司机" : `修改司机：${editing.name}`} size="form" busy={working} dismissOnBackdrop={false} onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={working}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="driver-form" loading={working} loadingText="保存中…">
            保存
          </Button>
        </>
      }
    >
      <form id="driver-form" className="form" noValidate onSubmit={(event) => void submit(event)}>
        {problem !== null && <Alert kind="danger">{problem}</Alert>}
        <TextField label="姓名" value={form.name} maxLength={100} errors={errors["name"] ?? []} onChange={(event) => set("name", event.target.value)} data-autofocus />
        <TextField label="手机" type="tel" value={form.phone} hint="写国际格式，带国家码，如 +81 90-1234-5678（客人来自不同国家）" errors={errors["phone"] ?? []} onChange={(event) => set("phone", event.target.value)} />
        <CheckboxGroup legend="会说的语言" name="driver-languages" options={DRIVER_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] ?? code }))} value={form.languages} errors={errors["languages"] ?? []} required onChange={(value) => set("languages", value)} />
        <TextField label="驾照到期日" type="date" value={form.licenseExpiresOn} hint="到期后不能被派单；到期前 30 天会提示" errors={errors["license_expires_on"] ?? []} onChange={(event) => set("licenseExpiresOn", event.target.value)} />
        <TextField label="驾龄（年，选填）" inputMode="numeric" value={form.drivingYears} errors={errors["driving_years"] ?? []} onChange={(event) => set("drivingYears", event.target.value.trim())} />
        <CheckboxGroup legend="金牌司机" name="driver-gold" options={[{ value: "gold", label: "是金牌司机（驾龄 10 年以上、从业 5 年以上、连续 3 年无主动责任事故）" }]} value={form.gold ? ["gold"] : []} onChange={(value) => set("gold", value.includes("gold"))} />
        {editing !== null && <SelectField label="状态" value={form.status} options={DRIVER_STATUSES.map((value) => ({ value, label: DRIVER_STATUS_NAMES[value] }))} onChange={(value) => set("status", value)} />}
      </form>
    </Dialog>
  );
}

export function DriverListPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`司机 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("fleet.read");
  const canManage = useTenantCan("fleet.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") === "active" || params.get("status") === "disabled" ? (params.get("status") as DriverStatus) : null;
  const { state, reload } = useLoad<ListPage<Driver>>(`drivers|${status ?? ""}`, canRead ? (t) => listDrivers(t, { limit: 200, ...(status ? { status } : {}) }) : null);
  const [dialog, setDialog] = useState<{ editing: Driver | null } | null>(null);

  if (account.status === "ready" && !canRead) {
    return (
      <AppShell pageName="司机" trail={TRAIL}>
        <Page title="司机">{NO_ACCESS}</Page>
      </AppShell>
    );
  }

  const disable = async (driver: Driver): Promise<void> => {
    try {
      await disableDriver(token, driver.id);
      toast(`已停用 ${driver.name}`);
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "停用"));
    }
  };

  const columns: Column<Driver>[] = [
    { key: "name", header: "姓名", cell: (row) => <span className="table__inline">{row.name}{row.gold && <span className="tag">金牌</span>}</span> },
    { key: "phone", header: "手机", cell: (row) => <span className="mono">{row.phone}</span> },
    { key: "languages", header: "语言", cell: (row) => row.languages.map((code) => LANGUAGE_NAMES[code] ?? code).join("、") },
    { key: "license", header: "驾照到期", cell: (row) => <ExpiryCell date={row.license_expires_on} state={row.license_state} /> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...DRIVER_STATUS_BADGES[row.status]} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: Driver) => (
              <span className="table__actions">
                <Button variant="text" size="sm" onClick={() => setDialog({ editing: row })}>
                  修改
                </Button>
                {row.status === "active" && (
                  <Button variant="text" size="sm" onClick={() => void disable(row)}>
                    停用
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppShell pageName="司机" trail={TRAIL}>
      <Page
        title="司机"
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setDialog({ editing: null })}>
              <Icon name="plus" />
              新增司机
            </Button>
          ) : undefined
        }
      >
        <p className="page-intro">派车时只能选在职、驾照在用车日有效、会说客人要求的语言的司机。司机不需要账号：派车后系统给他生成一个专用链接。</p>
        <div className="filter-bar">
          <SelectField inline label="状态" value={status ?? "all"} options={[{ value: "all", label: "全部" }, { value: "active", label: "在职" }, { value: "disabled", label: "停用" }]} onChange={(value) => setParams(value === "all" ? {} : { status: value }, { replace: true })} />
        </div>
        <DataTable
          label="司机"
          columns={columns}
          rows={state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "error" ? "error" : "loading"}
          onRetry={reload}
          empty={<StateBlock tone="neutral" title="还没有司机" description={canManage ? "点右上角「新增司机」登记第一位司机。" : "管理员或调度登记司机后会显示在这里。"} />}
        />
      </Page>
      {dialog !== null && (
        <DriverDialog
          editing={dialog.editing}
          onClose={() => setDialog(null)}
          onSaved={(driver) => {
            setDialog(null);
            toast(`已保存 ${driver.name}`);
            reload();
          }}
        />
      )}
    </AppShell>
  );
}

// ---- 车辆 ----

interface VehicleForm {
  plate: string;
  vehicleGroupId: string;
  model: string;
  color: string;
  seats: string;
  mileageKm: string;
  plateType: PlateType;
  insuranceExpiresOn: string;
  inspectionExpiresOn: string;
  status: VehicleStatus;
}

const emptyVehicle: VehicleForm = { plate: "", vehicleGroupId: "", model: "", color: "", seats: "", mileageKm: "", plateType: "business", insuranceExpiresOn: "", inspectionExpiresOn: "", status: "available" };

function vehicleForm(vehicle: Vehicle): VehicleForm {
  return {
    plate: vehicle.plate,
    vehicleGroupId: vehicle.vehicle_group_id,
    model: vehicle.model,
    color: vehicle.color,
    seats: String(vehicle.seats),
    mileageKm: String(vehicle.mileage_km),
    plateType: vehicle.plate_type,
    insuranceExpiresOn: vehicle.insurance_expires_on,
    inspectionExpiresOn: vehicle.inspection_expires_on,
    status: vehicle.status,
  };
}

function VehicleDialog({ editing, groups, onClose, onSaved }: { editing: Vehicle | null; groups: readonly VehicleGroup[]; onClose(): void; onSaved(vehicle: Vehicle): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const [form, setForm] = useState<VehicleForm>(editing === null ? { ...emptyVehicle, vehicleGroupId: groups.find((group) => group.status === "active")?.id ?? "" } : vehicleForm(editing));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const set = <K extends keyof VehicleForm>(field: K, value: VehicleForm[K]): void => setForm((current) => ({ ...current, [field]: value }));
  const groupOptions = groups.filter((group) => group.status === "active" || group.id === form.vehicleGroupId).map((group) => ({ value: group.id, label: `${displayName(group.name).text}（${group.code}）` }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const missing: Record<string, string[]> = {};
    if (form.plate.trim() === "") missing["plate"] = ["请填写车牌"];
    if (form.vehicleGroupId === "") missing["vehicle_group_id"] = ["请选择车型组"];
    if (form.model.trim() === "") missing["model"] = ["请填写品牌车型"];
    if (!/^\d{1,2}$/.test(form.seats)) missing["seats"] = ["座位数写整数"];
    if (!/^\d{1,7}$/.test(form.mileageKm)) missing["mileage_km"] = ["里程写整数公里"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.insuranceExpiresOn)) missing["insurance_expires_on"] = ["请填写保险到期日"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.inspectionExpiresOn)) missing["inspection_expires_on"] = ["请填写车检到期日"];
    if (form.plateType === "private" && form.status === "available") missing["status"] = ["非营业牌照的车不能设为「可用」（不能收费载客）"];
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    const body: VehicleInput = {
      plate: form.plate.trim(),
      vehicle_group_id: form.vehicleGroupId,
      model: form.model.trim(),
      color: form.color.trim(),
      seats: Number(form.seats),
      mileage_km: Number(form.mileageKm),
      plate_type: form.plateType,
      insurance_expires_on: form.insuranceExpiresOn,
      inspection_expires_on: form.inspectionExpiresOn,
      status: form.status,
    };
    setWorking(true);
    setProblem(null);
    try {
      onSaved(editing === null ? await createVehicle(token, body, key) : await updateVehicle(token, editing.id, editing.version, body));
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const byField = fieldErrors(err);
      if (Object.keys(byField).length > 0) setErrors(byField);
      else if (err instanceof ApiError && err.code === "VEHICLE_PLATE_TAKEN") setErrors({ plate: ["已经登记过这个车牌"] });
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("这辆车的资料刚被别人改过，请关掉后刷新再改。");
      else setProblem(failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open title={editing === null ? "新增车辆" : `修改车辆：${editing.plate}`} size="form" busy={working} dismissOnBackdrop={false} onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={working}>
            取消
          </Button>
          <Button variant="primary" type="submit" form="vehicle-form" loading={working} loadingText="保存中…">
            保存
          </Button>
        </>
      }
    >
      <form id="vehicle-form" className="form" noValidate onSubmit={(event) => void submit(event)}>
        {problem !== null && <Alert kind="danger">{problem}</Alert>}
        <TextField label="车牌" value={form.plate} maxLength={20} errors={errors["plate"] ?? []} onChange={(event) => set("plate", event.target.value)} data-autofocus />
        <SelectField label="车型组" value={form.vehicleGroupId} options={[{ value: "", label: "请选择" }, ...groupOptions]} onChange={(value) => set("vehicleGroupId", value)} />
        {(errors["vehicle_group_id"] ?? []).map((message) => <p key={message} className="field__hint field__hint--warning">{message}</p>)}
        <TextField label="品牌车型" value={form.model} placeholder="如：丰田埃尔法" errors={errors["model"] ?? []} onChange={(event) => set("model", event.target.value)} />
        <TextField label="颜色（选填）" value={form.color} maxLength={30} errors={errors["color"] ?? []} onChange={(event) => set("color", event.target.value)} />
        <TextField label="座位数（含司机）" inputMode="numeric" value={form.seats} errors={errors["seats"] ?? []} onChange={(event) => set("seats", event.target.value.trim())} />
        <TextField label="累计里程（公里）" inputMode="numeric" value={form.mileageKm} hint="小于 5 万公里自动算新车" errors={errors["mileage_km"] ?? []} onChange={(event) => set("mileageKm", event.target.value.trim())} />
        <SelectField label="牌照" value={form.plateType} options={PLATE_TYPES.map((value) => ({ value, label: PLATE_TYPE_NAMES[value] }))} onChange={(value) => set("plateType", value)} />
        <TextField label="保险到期日" type="date" value={form.insuranceExpiresOn} errors={errors["insurance_expires_on"] ?? []} onChange={(event) => set("insuranceExpiresOn", event.target.value)} />
        <TextField label="车检到期日" type="date" value={form.inspectionExpiresOn} errors={errors["inspection_expires_on"] ?? []} onChange={(event) => set("inspectionExpiresOn", event.target.value)} />
        <SelectField label="状态" value={form.status} options={VEHICLE_STATUSES.map((value) => ({ value, label: VEHICLE_STATUS_NAMES[value] }))} onChange={(value) => set("status", value)} />
        {(errors["status"] ?? []).map((message) => <p key={message} className="field__hint field__hint--warning">{message}</p>)}
      </form>
    </Dialog>
  );
}

export function VehicleListPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`车辆 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("fleet.read");
  const canManage = useTenantCan("fleet.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status = (VEHICLE_STATUSES as readonly string[]).includes(statusParam ?? "") ? (statusParam as VehicleStatus) : null;
  const { state, reload } = useLoad<ListPage<Vehicle>>(`vehicles|${status ?? ""}`, canRead ? (t) => listVehicles(t, { limit: 200, ...(status ? { status } : {}) }) : null);
  const groups = useLoad<VehicleGroup[]>("tenant-vehicle-groups", canRead ? (t) => listTenantVehicleGroups(t) : null);
  const groupName = useMemo(() => new Map((groups.state.data ?? []).map((group) => [group.id, displayName(group.name).text])), [groups.state.data]);
  const [dialog, setDialog] = useState<{ editing: Vehicle | null } | null>(null);

  if (account.status === "ready" && !canRead) {
    return (
      <AppShell pageName="车辆" trail={TRAIL}>
        <Page title="车辆">{NO_ACCESS}</Page>
      </AppShell>
    );
  }

  const disable = async (vehicle: Vehicle): Promise<void> => {
    try {
      await disableVehicle(token, vehicle.id);
      toast(`已停用 ${vehicle.plate}`);
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "停用"));
    }
  };

  const columns: Column<Vehicle>[] = [
    { key: "plate", header: "车牌", cell: (row) => <span className="table__inline"><span className="mono">{row.plate}</span>{row.is_new && <span className="tag">新车</span>}</span> },
    { key: "group", header: "车型组", cell: (row) => groupName.get(row.vehicle_group_id) ?? "—" },
    { key: "model", header: "车型", cell: (row) => `${row.model}${row.color ? ` · ${row.color}` : ""}` },
    { key: "seats", header: "座位", align: "end", cell: (row) => row.seats },
    { key: "plateType", header: "牌照", cell: (row) => PLATE_TYPE_NAMES[row.plate_type] },
    { key: "insurance", header: "保险到期", cell: (row) => <ExpiryCell date={row.insurance_expires_on} state={row.insurance_state} /> },
    { key: "inspection", header: "车检到期", cell: (row) => <ExpiryCell date={row.inspection_expires_on} state={row.inspection_state} /> },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...VEHICLE_STATUS_BADGES[row.status]} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: Vehicle) => (
              <span className="table__actions">
                <Button variant="text" size="sm" onClick={() => setDialog({ editing: row })}>
                  修改
                </Button>
                {row.status !== "disabled" && (
                  <Button variant="text" size="sm" onClick={() => void disable(row)}>
                    停用
                  </Button>
                )}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <AppShell pageName="车辆" trail={TRAIL}>
      <Page
        title="车辆"
        action={
          canManage ? (
            <Button variant="primary" onClick={() => setDialog({ editing: null })} disabled={groups.state.status !== "ready"}>
              <Icon name="plus" />
              新增车辆
            </Button>
          ) : undefined
        }
      >
        <p className="page-intro">派车时只能选可用、营业牌照、保险和车检在用车日有效、车型组不低于订单的车辆。</p>
        <div className="filter-bar">
          <SelectField inline label="状态" value={status ?? "all"} options={[{ value: "all", label: "全部" }, ...VEHICLE_STATUSES.map((value) => ({ value, label: VEHICLE_STATUS_NAMES[value] }))]} onChange={(value) => setParams(value === "all" ? {} : { status: value }, { replace: true })} />
        </div>
        <DataTable
          label="车辆"
          columns={columns}
          rows={state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "error" ? "error" : "loading"}
          onRetry={reload}
          empty={<StateBlock tone="neutral" title="还没有车辆" description={canManage ? "点右上角「新增车辆」登记第一辆车。" : "管理员或调度登记车辆后会显示在这里。"} />}
        />
      </Page>
      {dialog !== null && (
        <VehicleDialog
          editing={dialog.editing}
          groups={groups.state.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={(vehicle) => {
            setDialog(null);
            toast(`已保存 ${vehicle.plate}`);
            reload();
          }}
        />
      )}
    </AppShell>
  );
}
