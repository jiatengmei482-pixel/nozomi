/**
 * 司机 H5（M3-02，ADR 0027；需求「14. 补充功能 · 司机 H5」）：司机不需要账号，打开派车时生成的链接（`/driver#<令牌>`）看这一单、回传履约。
 *
 * - 令牌在 `#` 后面：不会发给服务器、不进访问日志；页面把它放进 `Authorization` 调 `/driver/v1/trip…`，不存进任何存储。
 * - 页面上**没有任何价格**（接口里本来就没有）。有乘客、电话、航班、上下车点（一键导航）、时间、附加服务、备注、调度电话。
 * - 按钮按顺序出现：出发 → 已到达上车点 → 接到客人 → 完成；点的时候带上手机的定位（不给定位也能点，只是到达时算不出距离）。出发后每分钟自动上报一次定位。
 * - 接机：先拍到达屏再填实际落地时间（按城市当地时间填），提交后不能改。
 * - 客人没出现：记联系记录、拍举牌照片、免等结束后申请离开；5 项证据齐了才能提交（页面实时显示还差什么）。
 */
import { EVIDENCE_FILE_RULES, localDateTimeToInstant } from "@nozomi/domain";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type DriverTrip,
  type FulfilmentEventType,
  type OrderFileKind,
  type ReportedLocation,
  driverContact,
  driverEvent,
  driverLanding,
  driverNoShow,
  driverPing,
  driverRequestLeave,
  getDriverTrip,
  uploadDriverFile,
} from "../../api/dispatch.ts";
import { Alert } from "../../components/Alert.tsx";
import { AuthLayout } from "../../components/AuthLayout.tsx";
import { Button } from "../../components/Button.tsx";
import { ORDER_STATUS_BADGES, StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { directionName, formatInZone, landingSourceName } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";

const PING_INTERVAL_MS = 60_000;
const NEXT_ACTION: Partial<Record<DriverTrip["order"]["status"], { type: FulfilmentEventType; label: string }>> = {
  assigned: { type: "departed", label: "我出发了" },
  departed: { type: "arrived", label: "已到达上车点" },
  arrived: { type: "picked_up", label: "接到客人了" },
  in_service: { type: "completed", label: "服务完成" },
};

/** 链接里 `#` 后面的令牌。 */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, "").trim();
  return /^nzd_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** 手机的定位：8 秒内拿不到、或司机不给，就是 null（照样可以点按钮）。 */
function currentLocation(): Promise<ReportedLocation | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lng: Math.round(position.coords.longitude * 1e6) / 1e6, lat: Math.round(position.coords.latitude * 1e6) / 1e6, accuracy_m: Math.round(position.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}

/** 导航：`geo:` 链接交给手机自带的地图应用（不链到站外网页：本站只允许 lib/external-links.ts 里登记的外链）。 */
export function mapLink(point: { lng: number; lat: number }): string {
  return `geo:${point.lat},${point.lng}?q=${point.lat},${point.lng}`;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "DRIVER_LINK_INVALID") return "链接无效或已过期，请联系调度重新发送。";
    if (err.code === "ORDER_STATE_INVALID") return "这一步现在不能做（可能已经有人点过了），页面已刷新。";
    if (err.code === "NO_SHOW_EVIDENCE_INCOMPLETE") return "证据还不齐，请看下面还差哪几项。";
    if (err.code === "FREE_WAIT_NOT_ENDED") return "免费等待还没结束，结束后才能申请离开。";
    if (err.code === "LANDING_ALREADY_REPORTED") return "落地时间已经提交过，不能修改。";
    if (err.code === "UNSUPPORTED_MEDIA_TYPE") return "只能上传 JPEG、PNG、WebP 或 HEIC 照片。";
    if (err.status === 413) return "照片太大了（最大 5 MB）。";
    if (err.message) return err.message;
  }
  return "网络连接失败，请检查网络后重试。";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="driver-section">
      <h2 className="driver-section__title">{title}</h2>
      {children}
    </section>
  );
}

function PhotoButton({ label, kind, disabled, onPicked }: { label: string; kind: OrderFileKind; disabled: boolean; onPicked(kind: OrderFileKind, file: File): void }) {
  return (
    <label className={`button button--secondary button--block${disabled ? " button--disabled" : ""}`}>
      {label}
      <input
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPicked(kind, file);
        }}
      />
    </label>
  );
}

export function DriverTripPage() {
  useDocumentTitle("司机 · NOZOMI");
  const location = useLocation();
  const token = tokenFromHash(location.hash);
  const [trip, setTrip] = useState<DriverTrip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [landedAt, setLandedAt] = useState("");
  const [screenId, setScreenId] = useState<string | null>(null);
  const [actual, setActual] = useState({ minutes: "", km: "" });

  const load = useCallback(async (): Promise<void> => {
    if (token === null) return;
    try {
      setTrip(await getDriverTrip(token));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const status = trip?.order.status;
  useEffect(() => {
    if (token === null || (status !== "departed" && status !== "arrived" && status !== "in_service")) return;
    const timer = setInterval(() => {
      void currentLocation().then((location) => (location === null ? undefined : driverPing(token, location).catch(() => undefined)));
    }, PING_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [token, status]);

  if (token === null) {
    return (
      <AuthLayout>
        <h1 className="auth-card__title">链接不完整</h1>
        <p>请从调度发给你的消息里重新打开完整的链接。</p>
      </AuthLayout>
    );
  }
  if (trip === null) {
    return (
      <AuthLayout>
        <h1 className="auth-card__title">这一单</h1>
        {loadError === null ? <p>加载中…</p> : <Alert kind="danger">{loadError}</Alert>}
      </AuthLayout>
    );
  }

  const run = async (work: () => Promise<DriverTrip | void>): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const next = await work();
      if (next) setTrip(next);
    } catch (err) {
      setProblem(errorText(err));
      await load();
    } finally {
      setWorking(false);
    }
  };
  const { order } = trip;
  const zone = order.timezone;
  const next = NEXT_ACTION[order.status];
  const charterCompleting = next?.type === "completed" && order.category === "charter";
  const placeName = order.place === null ? null : displayName(order.place.name).text;
  const landingOpen = trip.landing !== null && trip.landing.driver_reported_at === null && ["assigned", "departed", "arrived", "in_service"].includes(order.status);

  const upload = (kind: OrderFileKind, file: File): void => {
    if (file.size > EVIDENCE_FILE_RULES.maxBytes) {
      setProblem("照片太大了（最大 5 MB），请换一张或降低相机的分辨率。");
      return;
    }
    void run(async () => {
      const saved = await uploadDriverFile(token, kind, file);
      if (kind === "arrival_screen") setScreenId(saved.file.id);
      return getDriverTrip(token);
    });
  };
  const act = (type: FulfilmentEventType): void =>
    void run(async () => {
      const location = await currentLocation();
      const body = type === "completed" && order.category === "charter" ? { type, location, actual: { minutes: Number(actual.minutes), km: Number(actual.km) } } : { type, location };
      return driverEvent(token, body);
    });
  const submitLanding = (): void => {
    const at = localDateTimeToInstant(landedAt, zone);
    if (at === null || screenId === null) {
      setProblem(screenId === null ? "请先拍一张到达屏的照片。" : "请填写落地时间。");
      return;
    }
    void run(() => driverLanding(token, { landed_at: at.toISOString(), file_id: screenId }));
  };

  return (
    <AuthLayout>
      <h1 className="auth-card__title">{`${directionName(order)} · ${order.service_local.replace("T", " ")}`}</h1>
      <p className="driver-meta">
        <StatusBadge {...ORDER_STATUS_BADGES[order.status]} /> <span className="mono">{order.order_no}</span>
      </p>
      {problem !== null && <Alert kind="danger">{problem}</Alert>}

      <Section title="客人">
        <p>{`${order.passenger.name} · ${order.passengers} 人 ${order.luggage} 件行李`}</p>
        <p>
          <a className="link" href={`tel:${order.passenger.phone}`}>
            {order.passenger.phone}
          </a>
          {order.messaging && ` · ${order.messaging.app}：${order.messaging.handle}`}
        </p>
        {order.flight_no && <p>{`航班 ${order.flight_no}`}</p>}
        {order.notes && <p>{`备注：${order.notes}`}</p>}
        {order.addons.length > 0 && <p>{`附加服务：${order.addons.map((addon) => `${addon.name === null ? "—" : displayName(addon.name).text} × ${addon.quantity}`).join("、")}`}</p>}
        {order.driver_language && <p>{`客人要求的司机语言：${order.driver_language}`}</p>}
      </Section>

      <Section title="行程">
        <p>{`上车：${order.pickup?.address ?? placeName ?? "—"}`}</p>
        <p>{`下车：${order.dropoff?.address ?? placeName ?? "—"}`}</p>
        {order.pickup_point !== null && (
          <>
            <a className="button button--secondary button--block" href={mapLink(order.pickup_point)}>
              导航到上车点
            </a>
            <p className="field__hint">{`上车点坐标：${order.pickup_point.lat.toFixed(6)}, ${order.pickup_point.lng.toFixed(6)}`}</p>
          </>
        )}
        <p>{`免费等待：${order.free_wait_minutes === null ? "不限" : `${order.free_wait_minutes} 分钟`}，从 ${formatInZone(trip.free_wait.start, zone)} 起${trip.free_wait.end ? `，到 ${formatInZone(trip.free_wait.end, zone)}` : ""}`}</p>
        {trip.vehicle && <p>{`车辆：${trip.vehicle.plate} · ${trip.vehicle.model}`}</p>}
        {trip.dispatchers.map((dispatcher) => (
          <p key={dispatcher.phone}>
            {`调度 ${dispatcher.name}：`}
            <a className="link" href={`tel:${dispatcher.phone}`}>
              {dispatcher.phone}
            </a>
          </p>
        ))}
      </Section>

      {next !== undefined && (
        <Section title="下一步">
          {charterCompleting && (
            <>
              <TextField label="实际用了多少分钟" inputMode="numeric" value={actual.minutes} onChange={(event) => setActual((current) => ({ ...current, minutes: event.target.value.trim() }))} />
              <TextField label="实际跑了多少公里" inputMode="numeric" value={actual.km} onChange={(event) => setActual((current) => ({ ...current, km: event.target.value.trim() }))} />
            </>
          )}
          <Button variant="primary" size="lg" block loading={working} loadingText="提交中…" disabled={charterCompleting && (!/^\d+$/.test(actual.minutes) || !/^\d+$/.test(actual.km))} onClick={() => act(next.type)}>
            {next.label}
          </Button>
          <p className="field__hint">点按钮时会带上手机的定位（到达时用来核对是否在上车点 300 米内）。</p>
        </Section>
      )}

      {trip.landing !== null && (
        <Section title="航班落地">
          <p>{`现在按「${landingSourceName(trip.landing.source)}」算：${formatInZone(trip.landing.landed_at, zone)}`}</p>
          {landingOpen && (
            <>
              <PhotoButton label={screenId === null ? "① 拍到达屏（必须）" : "① 已拍到达屏，可以重拍"} kind="arrival_screen" disabled={working} onPicked={upload} />
              <TextField label={`② 实际落地时间（${zone} 当地时间）`} type="datetime-local" value={landedAt} onChange={(event) => setLandedAt(event.target.value)} />
              <Button variant="secondary" block loading={working} onClick={submitLanding} disabled={screenId === null || landedAt === ""}>
                提交落地时间（提交后不能改）
              </Button>
            </>
          )}
        </Section>
      )}

      {order.status === "arrived" && (
        <Section title="客人没出现时">
          <p className="field__hint">免费等待内至少联系客人 3 次，在上车点举牌拍照；免费等待结束后申请离开，客服 10 分钟内没有反对就可以提交。</p>
          <Button variant="secondary" block disabled={working} onClick={() => void run(() => driverContact(token, { method: "phone", note: null, file_id: null }))}>
            记一次：打了电话
          </Button>
          <PhotoButton label="记一次：即时通讯（拍截图）" kind="contact_screenshot" disabled={working} onPicked={(kind, file) => void run(async () => { const saved = await uploadDriverFile(token, kind, file); return driverContact(token, { method: "messaging", note: null, file_id: saved.file.id }); })} />
          <PhotoButton label="拍举牌照片" kind="signboard" disabled={working} onPicked={upload} />
          <Button variant="secondary" block disabled={working || !trip.free_wait.ended || trip.fulfilment.leave_requested_at !== null} onClick={() => void run(async () => driverRequestLeave(token, await currentLocation()))}>
            {trip.fulfilment.leave_requested_at === null ? "申请离开" : `已申请离开（${formatInZone(trip.fulfilment.leave_requested_at, zone)}）`}
          </Button>
          <ul className="plain-list">
            {trip.no_show.checklist.map((entry) => (
              <li key={entry.item}>{`${entry.ok ? "✓" : "✗"} ${entry.name ?? entry.item}`}</li>
            ))}
          </ul>
          <Button variant="danger" block disabled={working || !trip.no_show.complete} onClick={() => void run(async () => driverNoShow(token, await currentLocation()))}>
            提交「客人未出现」
          </Button>
        </Section>
      )}

      {trip.no_show.submitted_at !== null && <Alert kind="info">{`已提交「客人未出现」（${formatInZone(trip.no_show.submitted_at, zone)}），等平台审核。`}</Alert>}
      {(trip.contacts.length > 0 || trip.files.length > 0) && (
        <Section title="已记录">
          <ul className="plain-list">
            {trip.contacts.map((contact) => (
              <li key={contact.id}>{`${formatInZone(contact.occurred_at, zone)} ${contact.method === "phone" ? "打了电话" : "即时通讯"}`}</li>
            ))}
            {trip.files.map((file) => (
              <li key={file.id}>{`${formatInZone(file.uploaded_at, zone)} ${file.kind === "arrival_screen" ? "到达屏照片" : file.kind === "signboard" ? "举牌照片" : "联系截图"}`}</li>
            ))}
          </ul>
        </Section>
      )}
      <p className="field__hint">{`链接有效期到 ${formatInZone(trip.link.expires_at, zone)}（${zone}）。`}</p>
    </AuthLayout>
  );
}
