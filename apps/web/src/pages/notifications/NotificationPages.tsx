/**
 * 通知中心（M4-08，ADR 0049）。
 * - 运营后台「通知记录」：状态、失败原因、手动重试（`notification.retry`：运营、客服）；邮件没配置时页面顶上说清楚。收件人打码，没有正文和令牌。
 * - 运营后台「通知模板」：按事件 × 接收方 × 语言 × 通道只读展示（模板是代码常量）。
 * - 供应商后台「设置 → 通知」：发给自己这家的记录、免打扰时段（改：`notification.manage`，管理员）。
 */
import { NOTIFICATION_AUDIENCES, NOTIFICATION_EVENTS, NOTIFICATION_STATUSES, type NotificationAudience, type NotificationEvent, type NotificationStatus, NOTIFICATION_STATUS_NAMES, quietHoursIssue } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type NotificationRow,
  type NotificationSettings,
  type NotificationTemplateRow,
  getNotificationSettings,
  listNotificationTemplates,
  listPlatformNotifications,
  listTenantNotifications,
  retryNotification,
  saveNotificationSettings,
} from "../../api/notifications.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { type BadgeSpec, StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { orderPath } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { PLATFORM_NOTIFICATIONS_PATH, PLATFORM_NOTIFICATION_TEMPLATES_PATH, notificationAudienceName, notificationErrorText, notificationEventName } from "../../lib/notification-display.ts";
import { platformOrderPath } from "../../lib/order-money-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan, useTenantCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;
const PAGE_SIZE = 100;

const STATUS_BADGES: Readonly<Record<NotificationStatus, BadgeSpec>> = {
  pending: { tone: "info", label: NOTIFICATION_STATUS_NAMES.pending },
  sending: { tone: "info", label: NOTIFICATION_STATUS_NAMES.sending },
  sent: { tone: "success", label: NOTIFICATION_STATUS_NAMES.sent },
  failed: { tone: "danger", label: NOTIFICATION_STATUS_NAMES.failed },
  expired: { tone: "neutral", label: NOTIFICATION_STATUS_NAMES.expired },
};

function tableState(status: string): "ready" | "forbidden" | "error" | "loading" {
  return status === "ready" ? "ready" : status === "forbidden" ? "forbidden" : status === "error" ? "error" : "loading";
}

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | null => (values as readonly string[]).includes(value ?? "") ? (value as T) : null;

function columns(extra: { orderLink: (id: string) => string; audience: boolean; retry?: (row: NotificationRow) => ReactNode }): Column<NotificationRow>[] {
  return [
    { key: "time", header: "时间", cell: (row) => <time dateTime={row.created_at}>{formatLocalDateTime(row.created_at)}</time> },
    { key: "event", header: "事件", wrap: true, cell: (row) => notificationEventName(row.event) },
    ...(extra.audience ? [{ key: "audience", header: "接收方", cell: (row: NotificationRow) => notificationAudienceName(row.audience) }] : []),
    { key: "recipient", header: "收件人", wrap: true, cell: (row) => <span className="mono">{row.recipient}</span> },
    { key: "order", header: "订单", cell: (row) => (row.order === null ? <span className="table__muted">—</span> : <Link className="link mono" to={extra.orderLink(row.order.id)}>{row.order.order_no ?? row.order.id.slice(0, 8)}</Link>) },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...STATUS_BADGES[row.status]} /> },
    { key: "attempts", header: "尝试", align: "end", cell: (row) => row.attempts },
    {
      key: "detail",
      header: "说明",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <span>{row.status === "sent" && row.sent_at !== null ? `${formatLocalDateTime(row.sent_at)} 邮件服务器已接收` : (notificationErrorText(row.last_error) ?? "—")}</span>
          {row.status === "pending" && row.next_attempt_at !== null && row.last_error !== null && row.last_error.code !== "NOT_CONFIGURED" && <span className="table__other-names">{`下次发送 ${formatLocalDateTime(row.next_attempt_at)}`}</span>}
          {row.status === "pending" && <span className="table__other-names">{`过了 ${formatLocalDateTime(row.expires_at)} 不再发送`}</span>}
        </span>
      ),
    },
    ...(extra.retry ? [{ key: "actions", header: "操作", cell: (row: NotificationRow) => extra.retry?.(row) }] : []),
  ];
}

export function PlatformNotificationsPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`通知记录 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("notification.read");
  const canRetry = usePlatformCan("notification.retry");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status: NotificationStatus | "all" = statusParam === "all" || statusParam === null ? "all" : (oneOf(NOTIFICATION_STATUSES, statusParam) ?? "all");
  const event = oneOf(NOTIFICATION_EVENTS, params.get("event"));
  const audience = oneOf(NOTIFICATION_AUDIENCES, params.get("audience"));
  const orderId = params.get("order");
  const orderNo = params.get("order_no") ?? "";
  const [orderNoDraft, setOrderNoDraft] = useState(orderNo);
  useEffect(() => setOrderNoDraft(orderNo), [orderNo]);
  const key = `platform-notifications|${status}|${event}|${audience}|${orderId}|${orderNo}`;
  const { state, reload } = useLoad(key, canRead ? (t) => listPlatformNotifications(t, { limit: PAGE_SIZE, ...(status === "all" ? {} : { status }), ...(event === null ? {} : { event }), ...(audience === null ? {} : { audience }), ...(orderId === null ? {} : { order_id: orderId }), ...(orderNo === "" ? {} : { order_no: orderNo }) }) : null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="通知记录" trail={[{ label: "通知中心" }]}>
      <Page title="通知记录">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const change = (name: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };
  const retry = async (row: NotificationRow): Promise<void> => {
    setRetrying(row.id);
    try {
      const { notification } = await retryNotification(token, row.id);
      toast(notification.status === "sent" ? "已发送：邮件服务器已接收" : `还是没有发出去：${notificationErrorText(notification.last_error) ?? "请稍后再试"}`);
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "重试"));
    } finally {
      setRetrying(null);
    }
  };
  const summary = state.data?.summary;
  return shell(
    <>
      <p className="page-intro">
        每一条通知的发送情况。「已发送」表示邮件服务器已接收，不等于已进收件箱。收件人已打码，这里不显示邮件内容。<Link className="link" to={PLATFORM_NOTIFICATION_TEMPLATES_PATH}>看通知模板</Link>
      </p>
      {summary !== undefined && !summary.mail_configured && (
        <Alert kind="warning">{`邮件发送还没有配置，所以现在一封都发不出去。下单、付款、派车不受影响；${summary.waiting > 0 ? `${summary.waiting} 条通知在等待，` : "通知会先留着，"}配好后自动发送，过了有效期的不再发送。请超级管理员在「系统设置 → 系统状态」填写。`}</Alert>
      )}
      {summary !== undefined && (summary.failed_events ?? 0) > 0 && <Alert kind="danger">{`有 ${summary.failed_events} 个通知事件内容有问题，没能生成发送记录，这些通知发不出去。请把这句话转给技术查服务日志（notification.expand_failed）。`}</Alert>}
      {orderId !== null && (
        <Alert kind="info">
          只看这一单的通知。<Button variant="text" size="sm" onClick={() => change("order", null)}>看全部</Button>
        </Alert>
      )}
      <div className="filter-bar">
        <SelectField inline label="状态" value={status} options={[{ value: "all", label: "全部" }, ...NOTIFICATION_STATUSES.map((value) => ({ value, label: NOTIFICATION_STATUS_NAMES[value] }))]} onChange={(value) => change("status", value === "all" ? null : value)} />
        <SelectField inline label="接收方" value={audience ?? ""} options={[{ value: "", label: "全部" }, ...NOTIFICATION_AUDIENCES.map((value: NotificationAudience) => ({ value, label: notificationAudienceName(value) }))]} onChange={(value) => change("audience", value)} />
        <SelectField inline label="事件" value={event ?? ""} options={[{ value: "", label: "全部" }, ...NOTIFICATION_EVENTS.map((value: NotificationEvent) => ({ value, label: notificationEventName(value) }))]} onChange={(value) => change("event", value)} />
        <form
          className="action-row"
          noValidate
          onSubmit={(submitted: FormEvent) => {
            submitted.preventDefault();
            change("order_no", orderNoDraft.trim());
          }}
        >
          <TextField label="订单号" value={orderNoDraft} onChange={(changed) => setOrderNoDraft(changed.target.value)} />
          <Button type="submit" variant="secondary">查找</Button>
        </form>
      </div>
      <DataTable
        label="通知记录"
        columns={columns({ orderLink: platformOrderPath, audience: true, ...(canRetry ? { retry: (row: NotificationRow) => (row.retryable ? <Button variant="text" size="sm" loading={retrying === row.id} loadingText="发送中…" onClick={() => void retry(row)}>重试</Button> : null) } : {}) })}
        rows={state.data?.items ?? []}
        rowKey={(row) => row.id}
        state={tableState(state.status)}
        onRetry={reload}
        empty={<StateBlock tone="neutral" title="没有通知记录" description="下单、派车等事情发生后，通知记录会显示在这里。" />}
      />
      {state.data !== null && state.data.total > state.data.items.length && <p className="field__hint">{`共 ${state.data.total} 条，这里显示最新的 ${state.data.items.length} 条；按订单号或状态筛选可以找到更早的。`}</p>}
    </>,
  );
}

export function NotificationTemplatesPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`通知模板 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("notification.read");
  const { state, reload } = useLoad("notification-templates", canRead ? (t) => listNotificationTemplates(t) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="通知模板" trail={[{ label: "通知中心", to: PLATFORM_NOTIFICATIONS_PATH }]}>
      <Page title="通知模板">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const table: Column<NotificationTemplateRow>[] = [
    { key: "event", header: "事件", wrap: true, cell: (row) => notificationEventName(row.event) },
    { key: "audience", header: "接收方", cell: (row) => notificationAudienceName(row.audience) },
    { key: "locale", header: "语言", cell: (row) => (row.locale === "zh-CN" ? "简体中文" : row.locale) },
    { key: "channel", header: "通道", cell: () => "邮件" },
    { key: "subject", header: "主题", wrap: true, cell: (row) => row.subject },
    { key: "body", header: "正文", wrap: true, cell: (row) => <span style={{ whiteSpace: "pre-wrap" }}>{row.body}</span> },
  ];
  return shell(
    <>
      <p className="page-intro">{"按事件、接收方、语言、通道各一份。{{order_no}} 这样的写法是发送时才填的内容。模板现在由开发维护，这里只能看，要改文案请告诉开发。"}</p>
      <DataTable label="通知模板" columns={table} rows={state.data?.items ?? []} rowKey={(row) => `${row.event}|${row.audience}|${row.locale}|${row.channel}`} state={tableState(state.status)} onRetry={reload} empty={<StateBlock tone="neutral" title="没有模板" description="" />} />
    </>,
  );
}

function QuietHoursCard({ settings, canManage, onSaved }: { settings: NotificationSettings; canManage: boolean; onSaved(next: NotificationSettings): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [start, setStart] = useState(settings.quiet_hours?.start ?? "");
  const [end, setEnd] = useState(settings.quiet_hours?.end ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const save = async (submitted: FormEvent): Promise<void> => {
    submitted.preventDefault();
    if ((start === "") !== (end === "")) {
      setProblem("开始和结束要一起填；都留空就是不设免打扰");
      return;
    }
    const hours = start === "" ? null : { start, end };
    const issue = hours === null ? null : quietHoursIssue(hours);
    if (issue !== null) {
      setProblem(issue === "SAME_TIME" ? "开始和结束不能是同一个时间" : "时间要写成 22:00 这样");
      return;
    }
    setProblem(null);
    setWorking(true);
    try {
      onSaved(await saveNotificationSettings(token, settings.version, hours));
      toast("已保存");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setProblem(err instanceof ApiError && err.code === "VERSION_CONFLICT" ? "别人刚改过，请刷新页面后再改" : failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="card">
      <h2 className="card__title">免打扰时段</h2>
      <p>这个时段里的通知邮件等时段结束后再发。用车当天的订单通知不受限制，照常马上发。时间是东京时间，可以跨午夜（如 22:00 到 07:00）。</p>
      <form className="form" noValidate onSubmit={(submitted) => void save(submitted)}>
        {problem !== null && <Alert kind="danger">{problem}</Alert>}
        <TextField label="开始" type="time" value={start} readOnly={!canManage} onChange={(changed) => setStart(changed.target.value)} />
        <TextField label="结束" type="time" value={end} readOnly={!canManage} onChange={(changed) => setEnd(changed.target.value)} />
        {canManage ? (
          <div className="form__actions">
            <Button variant="primary" type="submit" loading={working} loadingText="保存中…">保存</Button>
          </div>
        ) : (
          <p className="field__hint">只有管理员能改。</p>
        )}
      </form>
    </section>
  );
}

export function TenantNotificationsPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`通知 · NOZOMI ${portal.name}`);
  const canRead = useTenantCan("notification.read");
  const canManage = useTenantCan("notification.manage");
  const [params, setParams] = useSearchParams();
  const orderId = params.get("order");
  const status = oneOf(NOTIFICATION_STATUSES, params.get("status"));
  const records = useLoad(`tenant-notifications|${orderId}|${status}`, canRead ? (t) => listTenantNotifications(t, { limit: PAGE_SIZE, ...(orderId === null ? {} : { order_id: orderId }), ...(status === null ? {} : { status }) }) : null);
  const settings = useLoad("tenant-notification-settings", canRead ? (t) => getNotificationSettings(t) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="通知" trail={[{ label: "设置" }]}>
      <Page title="通知">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  return shell(
    <>
      <p className="page-intro">新订单、修改、取消、派车提醒等通知会发邮件给你们的管理员和调度。</p>
      {settings.state.status === "error" && <Alert kind="danger">免打扰设置没有读出来，请刷新页面再试。</Alert>}
      {settings.state.data !== null && <QuietHoursCard key={settings.state.data.version} settings={settings.state.data} canManage={canManage} onSaved={settings.set} />}
      <section className="card">
        <div className="card__title-row">
          <h2 className="card__title">发送记录</h2>
        </div>
        <p>「已发送」表示邮件服务器已接收，不等于已进收件箱；没收到的话先看看垃圾邮件。</p>
        {orderId !== null && (
          <Alert kind="info">
            只看这一单的通知。<Button variant="text" size="sm" onClick={() => setParams({}, { replace: true })}>看全部</Button>
          </Alert>
        )}
        <div className="filter-bar">
          <SelectField
            inline
            label="状态"
            value={status ?? "all"}
            options={[{ value: "all", label: "全部" }, ...NOTIFICATION_STATUSES.map((value) => ({ value, label: NOTIFICATION_STATUS_NAMES[value] }))]}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              if (value === "all") next.delete("status");
              else next.set("status", value);
              setParams(next, { replace: true });
            }}
          />
        </div>
        <DataTable
          label="发送记录"
          columns={columns({ orderLink: orderPath, audience: false })}
          rows={records.state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={tableState(records.state.status)}
          onRetry={records.reload}
          empty={<StateBlock tone="neutral" title="还没有发给你们的通知" description="有新订单等事情时，发送记录会显示在这里。" />}
        />
        {records.state.data !== null && records.state.data.total > records.state.data.items.length && <p className="field__hint">{`共 ${records.state.data.total} 条，这里显示最新的 ${records.state.data.items.length} 条；按状态筛选或从订单进来可以找到更早的。`}</p>}
      </section>
    </>,
  );
}
