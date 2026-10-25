/**
 * 推送给供应商的 Webhook（M3-02，ADR 0027）。
 * - 供应商后台「设置 → 调度对接（Webhook）」：接收地址、订阅的事件、推送 / 暂停；签名密钥只在新建和换密钥时显示一次；发送测试事件；投递记录（失败的可以手动重推）。
 *   看：`webhook.read`（管理员、调度、只读）；改、重推、测试：`webhook.manage`（管理员）。
 * - 运营后台「推送记录」：跨供应商看投递（默认只看最终失败的），手动重推（`order.resend`：运营、客服）。
 */
import type { TenantWebhookEvent } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import {
  type DeliveryStatus,
  type ListPage,
  type PlatformWebhookDelivery,
  type WebhookDelivery,
  type WebhookSettings,
  deleteWebhook,
  getWebhookSettings,
  listDeliveries,
  listPlatformDeliveries,
  retryDelivery,
  retryPlatformDelivery,
  rotateWebhookSecret,
  saveWebhook,
  sendWebhookTest,
} from "../../api/dispatch.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, DataTable } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { CheckboxGroup, CopyButton, SelectField } from "../../components/FormFields.tsx";
import { StateBlock } from "../../components/States.tsx";
import { DELIVERY_STATUS_BADGES, StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { durationText, orderPath, webhookErrorText, webhookEventName } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan, useTenantCan } from "../../lib/use-master-access.ts";

const DEFAULT_EVENTS: readonly TenantWebhookEvent[] = ["order.confirmed", "order.assigned", "order.status_changed", "order.changed", "order.cancelled"];

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;

function tableState(status: string): "ready" | "forbidden" | "error" | "loading" {
  return status === "ready" ? "ready" : status === "forbidden" ? "forbidden" : status === "error" ? "error" : "loading";
}

/** 签名密钥：只显示这一次。 */
function SecretDialog({ secret, onClose }: { secret: string; onClose(): void }) {
  return (
    <Dialog
      open
      sealed
      title="签名密钥"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          我已保存
        </Button>
      }
    >
      <Alert kind="warning">签名密钥只在这里显示这一次。请马上复制到你们调度系统的设置里；关掉后只能换一把新的。</Alert>
      <div className="field">
        <label className="field__label" htmlFor="webhook-secret">
          签名密钥
        </label>
        <div className="field__control field__control--copy">
          <input className="input mono" id="webhook-secret" readOnly value={secret} onFocus={(event) => event.target.select()} />
          <CopyButton text={secret} label="复制签名密钥" />
        </div>
        <p className="field__hint">{"验签：HMAC-SHA256(签名密钥, \"<X-Timestamp>.<请求体原文>\") 的十六进制，和请求头 X-Signature 里 v1= 后面的比较；时间戳相差超过 5 分钟的拒绝；同一个 X-Event-Id 只处理一次。"}</p>
      </div>
    </Dialog>
  );
}

function deliveryColumns(extra: { tenant?: boolean; retry?: (row: WebhookDelivery) => ReactNode }): Column<WebhookDelivery>[] {
  return [
    { key: "time", header: "排队时间", cell: (row) => <time dateTime={row.created_at}>{formatLocalDateTime(row.created_at)}</time> },
    ...(extra.tenant ? [{ key: "tenant", header: "供应商", cell: (row: WebhookDelivery) => (row as PlatformWebhookDelivery).tenant.name }] : []),
    { key: "event", header: "事件", wrap: true, cell: (row) => <span className="table__names"><span>{webhookEventName(row.event_type)}</span><span className="table__other-names mono">{row.event_id}</span></span> },
    { key: "order", header: "订单", cell: (row) => (row.order_id === null ? <span className="table__muted">—</span> : extra.tenant ? <span className="mono">{row.order_id.slice(0, 8)}</span> : <Link className="link" to={orderPath(row.order_id)}>查看</Link>) },
    { key: "status", header: "状态", cell: (row) => <StatusBadge {...DELIVERY_STATUS_BADGES[row.status]} /> },
    { key: "attempts", header: "尝试", align: "end", cell: (row) => row.attempts },
    {
      key: "last",
      header: "最近一次",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <span>{row.status === "succeeded" ? `HTTP ${row.last_status_code ?? "—"}` : webhookErrorText(row.last_error_code, row.last_status_code)}</span>
          {row.status === "pending" && row.next_attempt_at !== null && <span className="table__other-names">{`下次重试 ${formatLocalDateTime(row.next_attempt_at)}`}</span>}
        </span>
      ),
    },
    ...(extra.retry ? [{ key: "actions", header: "操作", cell: (row: WebhookDelivery) => extra.retry?.(row) }] : []),
  ];
}

export function WebhookSettingsPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`调度对接（Webhook）· NOZOMI ${portal.name}`);
  const canRead = useTenantCan("webhook.read");
  const canManage = useTenantCan("webhook.manage");
  const toast = useToast();
  const settings = useLoad<WebhookSettings>("webhook-settings", canRead ? (t) => getWebhookSettings(t) : null);
  const [filter, setFilter] = useState<DeliveryStatus | "all">("all");
  const deliveries = useLoad<ListPage<WebhookDelivery>>(`webhook-deliveries|${filter}`, canRead ? (t) => listDeliveries(t, { limit: 100, ...(filter === "all" ? {} : { status: filter }) }) : null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<TenantWebhookEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const current = settings.state.data?.webhook ?? null;

  const catalogue = settings.state.data?.events;
  useEffect(() => {
    if (current === null) {
      // 还没设置：默认订阅订单的事件（救援的两个等用上了再勾）
      if (catalogue !== undefined) setEvents(catalogue.map((entry) => entry.event).filter((event) => DEFAULT_EVENTS.includes(event)));
      return;
    }
    setUrl(current.url);
    setEvents(current.events);
    setPaused(current.status === "paused");
  }, [current, catalogue]);

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="调度对接（Webhook）" trail={[{ label: "设置" }]}>
      <Page title="调度对接（Webhook）">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const data = settings.state.data;

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!/^https:\/\//.test(url.trim())) return setErrors(["只接受 https:// 开头的地址"]);
    if (events.length === 0) return setProblem("至少订阅一个事件");
    setErrors([]);
    setProblem(null);
    setWorking(true);
    try {
      const saved = await saveWebhook(token, current?.version ?? null, { url: url.trim(), events, status: paused ? "paused" : "active" });
      if (saved.secret !== null) setSecret(saved.secret);
      toast("已保存 Webhook 设置");
      settings.reload();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setErrors(((err.details["issues"] as { message: string }[] | undefined) ?? []).map((issue) => issue.message));
      else if (err instanceof ApiError && err.code === "WEBHOOK_ENCRYPTION_NOT_CONFIGURED") setProblem("平台还没有配置数据加密密钥，现在不能设置 Webhook。请联系平台。");
      else if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setProblem("设置刚被别人改过，请刷新后再改。");
      else setProblem(failureText(err, "保存"));
    } finally {
      setWorking(false);
    }
  };
  const action = async (run: () => Promise<void>, verb: string): Promise<void> => {
    try {
      await run();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, verb));
    }
  };

  return shell(
    <>
      <p className="page-intro">有自己调度系统的话，在这里填接收地址：新订单、派车、履约状态变化会签名后推送过去。没有调度系统的不用设置，在「订单」里派车即可。</p>
      {data !== null && data !== undefined && !data.encryption_configured && <Alert kind="warning">平台还没有配置数据加密密钥，暂时不能设置 Webhook。</Alert>}
      <section className="card">
        <h2 className="card__title">接收地址</h2>
        <form className="form" noValidate onSubmit={(event) => void save(event)}>
          {problem !== null && <Alert kind="danger">{problem}</Alert>}
          <TextField label="接收地址" type="url" value={url} placeholder="https://dispatch.example.com/nozomi" readOnly={!canManage} errors={errors} hint="只接受公网可以访问的 https 地址；不跟随重定向；5 秒内要回 2xx。" onChange={(event) => setUrl(event.target.value)} />
          <CheckboxGroup legend="订阅的事件" name="webhook-events" readOnly={!canManage} options={(data?.events ?? []).map((entry) => ({ value: entry.event, label: entry.name }))} value={events} onChange={setEvents} />
          <CheckboxGroup legend="暂停" name="webhook-paused" readOnly={!canManage} options={[{ value: "paused", label: "暂停推送（暂停期间新事件不排队）" }]} value={paused ? ["paused"] : []} onChange={(value) => setPaused(value.includes("paused"))} />
          {current !== null && <p className="field__hint">{`签名密钥末 4 位：${current.secret_hint}（${formatLocalDateTime(current.secret_created_at)} 生成）`}</p>}
          {data !== null && data !== undefined && (
            <p className="field__hint">{`失败后按 ${data.rules.retry_delays_seconds.map(durationText).join("、")} 重试，共 ${data.rules.max_attempts} 次；仍失败的在下面的推送记录里标为「失败」，可以手动重推。`}</p>
          )}
          {canManage && (
            <div className="form__actions">
              <Button variant="primary" type="submit" loading={working} loadingText="保存中…" disabled={data?.encryption_configured === false}>
                {current === null ? "保存并生成签名密钥" : "保存"}
              </Button>
              {current !== null && (
                <>
                  <Button variant="secondary" onClick={() => void action(async () => { const result = await sendWebhookTest(token); toast(result.delivery.status === "succeeded" ? "测试事件已送达" : `测试事件没送到：${webhookErrorText(result.attempt.error_code, result.attempt.status_code)}`); deliveries.reload(); }, "发送")}>
                    发送测试事件
                  </Button>
                  <Button variant="secondary" onClick={() => void action(async () => { const result = await rotateWebhookSecret(token); if (result.secret !== null) setSecret(result.secret); settings.reload(); }, "换密钥")}>
                    换签名密钥
                  </Button>
                  <Button variant="text" onClick={() => void action(async () => { await deleteWebhook(token); toast("已删除 Webhook 设置"); setUrl(""); settings.reload(); }, "删除")}>
                    删除设置
                  </Button>
                </>
              )}
            </div>
          )}
        </form>
      </section>

      <section className="card">
        <div className="card__title-row">
          <h2 className="card__title">推送记录</h2>
          <SelectField<DeliveryStatus | "all"> inline label="状态" value={filter} options={[{ value: "all", label: "全部" }, { value: "failed", label: "失败（等人工重推）" }, { value: "pending", label: "等待投递" }, { value: "succeeded", label: "成功" }]} onChange={(value) => setFilter(value)} />
        </div>
        <DataTable
          label="推送记录"
          columns={deliveryColumns({
            ...(canManage
              ? {
                  retry: (row: WebhookDelivery) =>
                    row.status !== "succeeded" && row.event_type !== "webhook.test" ? (
                      <Button variant="text" size="sm" onClick={() => void action(async () => { const result = await retryDelivery(token, row.id); toast(result.delivery.status === "succeeded" ? "已重推成功" : "重推了，对方还是没收到"); deliveries.reload(); }, "重推")}>
                        重推
                      </Button>
                    ) : null,
                }
              : {}),
          })}
          rows={deliveries.state.data?.items ?? []}
          rowKey={(row) => row.id}
          state={tableState(deliveries.state.status)}
          onRetry={deliveries.reload}
          empty={<StateBlock tone="neutral" title="还没有推送记录" description="设置好接收地址后，新订单、派车、履约状态变化会推送过去。" />}
        />
      </section>
      {secret !== null && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>,
  );
}

export function PlatformDeliveriesPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`推送记录 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("order.read");
  const canResend = usePlatformCan("order.resend");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status");
  const status: DeliveryStatus | "all" = statusParam === "pending" || statusParam === "succeeded" || statusParam === "all" ? statusParam : "failed";
  const { state, reload } = useLoad<ListPage<PlatformWebhookDelivery>>(`platform-deliveries|${status}`, canRead ? (t) => listPlatformDeliveries(t, { limit: 100, ...(status === "all" ? {} : { status }) }) : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="推送记录" trail={[{ label: "订单" }]}>
      <Page title="推送给供应商的 Webhook">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const retry = async (row: WebhookDelivery): Promise<void> => {
    try {
      const result = await retryPlatformDelivery(token, row.id);
      toast(result.delivery.status === "succeeded" ? "已重推成功" : "重推了，对方还是没收到");
      reload();
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "重推"));
    }
  };
  return shell(
    <>
      <p className="page-intro">重试 7 次（约 32 小时）仍然失败的推送是异常，默认只看这些。联系供应商确认接收地址恢复后，可以手动重推（同一个事件编号，对方按它去重）。</p>
      <div className="filter-bar">
        <SelectField inline label="状态" value={status} options={[{ value: "failed", label: "失败（等人工重推）" }, { value: "pending", label: "等待投递" }, { value: "succeeded", label: "成功" }, { value: "all", label: "全部" }]} onChange={(value) => setParams(value === "failed" ? {} : { status: value }, { replace: true })} />
      </div>
      <DataTable
        label="推送记录"
        columns={deliveryColumns({ tenant: true, ...(canResend ? { retry: (row: WebhookDelivery) => (row.status !== "succeeded" && row.event_type !== "webhook.test" ? <Button variant="text" size="sm" onClick={() => void retry(row)}>重推</Button> : null) } : {}) })}
        rows={state.data?.items ?? []}
        rowKey={(row) => row.id}
        state={tableState(state.status)}
        onRetry={reload}
        empty={<StateBlock tone="neutral" title={status === "failed" ? "没有失败的推送" : "没有推送记录"} description="供应商设置了 Webhook 后，推送记录会显示在这里。" />}
      />
    </>,
  );
}
