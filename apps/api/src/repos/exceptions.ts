/**
 * 订单异常队列的数据访问（M4-02，ADR 0034）。`order_exceptions` 是平台表（跨供应商）。
 *
 * 生成：每一轮按需求表的触发条件从已有数据里找出「现在成立的」异常（`DETECTORS`，每条一个来源编号），没有生成过的新建；
 * 同一类、同一个来源只生成一次（唯一约束 `order_exceptions_source_key`），人工关了不会再生成。
 * 已经生成、还没关的，如果条件已经不成立（已经派车、退款重试成功了……），系统关闭（`cleared`）。
 * 整个「找出 + 新建 + 关闭」是一条语句，多个实例同时跑也不会建重复的。
 */
import { EXCEPTION_DUE_MINUTES, EXCEPTION_RULES, type ExceptionCloseKind, type ExceptionStatus, type ExceptionType } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

/**
 * 每一种异常「现在成立」的条件，各选出 (type, source_key, order_id, tenant_id, detail)。$1 是现在。
 * 订单类的来源编号带上供应商（救援改派后同一个订单编号有两行，各算各的）。
 */
const DETECTORS: readonly string[] = [
  // 超时未派车：过了派车截止时间（定时任务记下了提醒），还没派车
  `select 'dispatch_overdue', 'order:' || o.tenant_id || ':' || o.id, o.id, o.tenant_id, jsonb_build_object('dispatch_due_at', o.dispatch_due_at, 'service_at', o.service_at)
     from orders o where o.status = 'confirmed' and o.dispatch_overdue_at is not null`,
  // 司机未出发：用车前 1 小时仍未「已出发」
  `select 'departure_overdue', 'order:' || o.tenant_id || ':' || o.id, o.id, o.tenant_id, jsonb_build_object('service_at', o.service_at)
     from orders o where o.status = 'assigned' and o.departure_overdue_at is not null`,
  // 司机未到达：到点 15 分钟仍未「已到达」（定时任务的提醒），或客人报告司机没到
  `select 'arrival_overdue', 'order:' || o.tenant_id || ':' || o.id, o.id, o.tenant_id,
          jsonb_build_object('service_at', o.service_at, 'arrival_overdue_at', o.arrival_overdue_at, 'driver_missing_reported_at', o.driver_missing_reported_at)
     from orders o where o.status in ('confirmed', 'assigned', 'departed') and (o.arrival_overdue_at is not null or o.driver_missing_reported_at is not null)`,
  // 状态推送失败：推给供应商的 Webhook 重试耗尽（推给渠道的回传接入第一个外部分销商时加进来）
  `select 'push_failed', 'delivery:' || d.id, d.order_id, d.tenant_id, jsonb_build_object('target', 'tenant', 'delivery_id', d.id, 'event_type', d.event_type, 'failed_at', d.failed_at, 'last_status_code', d.last_status_code, 'last_error_code', d.last_error_code)
     from webhook_deliveries d where d.status = 'failed' and d.order_id is not null`,
  // no-show 待审核
  `select 'no_show_review', 'order:' || o.tenant_id || ':' || o.id, o.id, o.tenant_id, jsonb_build_object('submitted_at', c.submitted_at)
     from orders o join order_no_show_claims c on c.tenant_id = o.tenant_id and c.order_id = o.id where o.status = 'no_show_claimed' and c.status = 'pending_review'`,
  // 附加费用待审核：转人工的（超过 50%、没有凭证），和客人有异议、异议期已经结束的（期内平台不能先批，ADR 0029）
  `select 'extra_charge_review', 'extra_charge:' || x.id, x.order_id, x.tenant_id, jsonb_build_object('extra_charge_id', x.id, 'type', x.type, 'review_reasons', x.review_reasons, 'dispute_until', x.dispute_until)
     from order_extra_charges x where x.status = 'review' or (x.status = 'disputed' and x.dispute_until <= $1)`,
  // 履约未结束：服务结束（包车按套餐时长）24 小时后仍未「已完成」
  `select 'fulfilment_unfinished', 'order:' || o.tenant_id || ':' || o.id, o.id, o.tenant_id, jsonb_build_object('status', o.status, 'service_at', o.service_at)
     from orders o where o.status in ('assigned', 'departed', 'arrived', 'in_service')
      and o.service_at + make_interval(hours => coalesce(o.package_hours, 0) + ${EXCEPTION_RULES.unfinishedHoursAfterService}) <= $1`,
  // 支付异常：退款失败（重试耗尽或被拒；作废的、已经重试过的不算）
  `select 'payment_issue', 'refund:' || r.id, r.order_id, r.supplier_tenant_id, jsonb_build_object('reason', 'refund_failed', 'refund_id', r.id, 'purpose', r.purpose, 'amount_minor', r.amount_minor, 'currency', r.currency, 'last_error', r.last_error)
     from order_refunds r where r.status = 'failed' and r.superseded_at is null and not exists (select 1 from order_refunds retry where retry.retry_of = r.id)`,
  // 支付异常：事后加收扣款失败
  `select 'payment_issue', 'charge:' || x.id, x.order_id, x.tenant_id, jsonb_build_object('reason', 'charge_failed', 'extra_charge_id', x.id, 'last_charge_error', x.last_charge_error)
     from order_extra_charges x where x.status = 'charge_failed'`,
  // 支付异常：拒付
  `select 'payment_issue', 'chargeback:' || p.id, p.order_id, p.supplier_tenant_id, jsonb_build_object('reason', 'chargeback', 'payment_id', p.id, 'kind', p.kind, 'amount_minor', p.amount_minor, 'currency', p.currency)
     from order_payments p where p.disputed`,
  // 支付异常：订单取消后才付到钱、还没退完
  `select 'payment_issue', 'paid_after_cancel:' || p.id, p.order_id, p.supplier_tenant_id, jsonb_build_object('reason', 'paid_after_cancel', 'payment_id', p.id, 'amount_minor', p.amount_minor, 'refunded_minor', p.refunded_minor, 'currency', p.currency)
     from order_payments p where p.paid_after_cancel and p.refunded_minor < p.amount_minor`,
  // 救援中：还没有结论的救援改派（ADR 0031）
  `select 'rescue', 'rescue:' || r.id, r.order_id, r.original_tenant_id, jsonb_build_object('rescue_id', r.id, 'trigger', r.trigger, 'rescue_status', r.status, 'service_at', r.service_at)
     from order_rescues r where r.status in ('open', 'offering', 'exhausted')`,
];

export interface SweepRow {
  id: string;
  type: ExceptionType;
  orderId: string;
  tenantId: string;
}

/** 一轮生成 + 关闭。返回新建的和系统关闭的。 */
export async function syncExceptions(db: Db, now: Date): Promise<{ opened: SweepRow[]; cleared: SweepRow[] }> {
  const detected = DETECTORS.map((sql) => `(${sql})`).join("\nunion all\n");
  const result = await db.query<Row>(
    `with detected (type, source_key, order_id, tenant_id, detail) as (${detected}),
     opened as (
       insert into order_exceptions (type, source_key, order_id, supplier_tenant_id, detail, status, opened_at, due_at, created_at, updated_at)
       select d.type, d.source_key, d.order_id, d.tenant_id, d.detail, 'open', $1, $1 + make_interval(mins => ($2::jsonb ->> d.type)::int), $1, $1 from detected d
       on conflict (type, source_key) do nothing
       returning id, type, order_id, supplier_tenant_id
     ),
     cleared as (
       update order_exceptions e set status = 'closed', close_kind = 'cleared', closed_at = $1, updated_at = $1, version = e.version + 1
        where e.status <> 'closed' and not exists (select 1 from detected d where d.type = e.type and d.source_key = e.source_key)
       returning id, type, order_id, supplier_tenant_id
     )
     select 'opened' as change, * from opened union all select 'cleared' as change, * from cleared`,
    [now, JSON.stringify(EXCEPTION_DUE_MINUTES)],
  );
  const pick = (change: string): SweepRow[] => result.rows.filter((row) => row["change"] === change).map((row) => ({ id: row["id"], type: row["type"], orderId: row["order_id"], tenantId: row["supplier_tenant_id"] }));
  return { opened: pick("opened"), cleared: pick("cleared") };
}

export interface OrderException {
  id: string;
  type: ExceptionType;
  sourceKey: string;
  orderId: string;
  tenantId: string;
  detail: Record<string, unknown>;
  status: ExceptionStatus;
  openedAt: Date;
  dueAt: Date;
  assigneeId: string | null;
  claimedAt: Date | null;
  closeKind: ExceptionCloseKind | null;
  closedAt: Date | null;
  closedBy: string | null;
  resolution: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const COLUMNS = "e.id, e.type, e.source_key, e.order_id, e.supplier_tenant_id, e.detail, e.status, e.opened_at, e.due_at, e.assignee_id, e.claimed_at, e.close_kind, e.closed_at, e.closed_by, e.resolution, e.version, e.created_at, e.updated_at";

function toException(row: Row): OrderException {
  return {
    id: row["id"],
    type: row["type"],
    sourceKey: row["source_key"],
    orderId: row["order_id"],
    tenantId: row["supplier_tenant_id"],
    detail: row["detail"],
    status: row["status"],
    openedAt: row["opened_at"],
    dueAt: row["due_at"],
    assigneeId: row["assignee_id"],
    claimedAt: row["claimed_at"],
    closeKind: row["close_kind"],
    closedAt: row["closed_at"],
    closedBy: row["closed_by"],
    resolution: row["resolution"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function findException(db: Db, id: string, options: { lock?: boolean } = {}): Promise<OrderException | null> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_exceptions e where e.id = $1 ${options.lock ? "for update" : ""}`, [id]);
  const row = result.rows[0];
  return row === undefined ? null : toException(row);
}

export async function updateException(db: Db, exception: Pick<OrderException, "id" | "version">, change: Partial<Pick<OrderException, "status" | "assigneeId" | "claimedAt" | "closeKind" | "closedAt" | "closedBy" | "resolution">>, now: Date): Promise<OrderException | null> {
  const columns: Record<string, string> = { status: "status", assigneeId: "assignee_id", claimedAt: "claimed_at", closeKind: "close_kind", closedAt: "closed_at", closedBy: "closed_by", resolution: "resolution" };
  const sets: string[] = [];
  const values: unknown[] = [exception.id, exception.version, now];
  for (const [key, column] of Object.entries(columns)) {
    const value = (change as Record<string, unknown>)[key];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  const result = await db.query<Row>(`update order_exceptions e set ${[...sets, "version = e.version + 1", "updated_at = $3"].join(", ")} where e.id = $1 and e.version = $2 returning ${COLUMNS}`, values);
  const row = result.rows[0];
  return row === undefined ? null : toException(row);
}

export interface ExceptionFilter {
  /** `active` = 没关的（待处理、处理中） */
  status: ExceptionStatus | "active";
  type: ExceptionType | null;
  assigneeId: string | null;
  orderId: string | null;
  tenantId: string | null;
  /** 只看过了时限的 */
  overdue: boolean;
  now: Date;
}

export interface ExceptionRow extends OrderException {
  orderNo: string;
  tenantName: string;
  serviceAt: Date;
  assigneeName: string | null;
}

/**
 * 运营后台的异常队列：没关的按时限（最急的在前），关了的按关闭时间从新到旧。游标是 (排序时间, 编号)。
 */
export async function listExceptions(db: Db, filter: ExceptionFilter, limit: number, after: TimeCursor | null): Promise<Page<ExceptionRow> & { total: number }> {
  const where = `(case when $1 = 'active' then e.status <> 'closed' else e.status = $1 end) and ($2::text is null or e.type = $2) and ($3::uuid is null or e.assignee_id = $3)
    and ($4::uuid is null or e.order_id = $4) and ($5::uuid is null or e.supplier_tenant_id = $5) and (not $6::boolean or (e.status <> 'closed' and e.due_at < $7))`;
  const params = [filter.status, filter.type, filter.assigneeId, filter.orderId, filter.tenantId, filter.overdue, filter.now];
  const closed = filter.status === "closed";
  const sortKey = closed ? "e.closed_at" : "e.due_at";
  const from = "from order_exceptions e join orders o on o.tenant_id = e.supplier_tenant_id and o.id = e.order_id join tenants t on t.id = e.supplier_tenant_id left join platform_users u on u.id = e.assignee_id";
  const cursorCondition = closed ? `(${sortKey}, e.id) < ($8::timestamptz, $9::uuid)` : `(${sortKey}, e.id) > ($8::timestamptz, $9::uuid)`;
  const result = await db.query<Row>(
    `select ${COLUMNS}, o.order_no, o.service_at, t.name as tenant_name, u.name as assignee_name, ${sortKey}::text as cursor_time ${from}
      where ${where} and ($8::timestamptz is null or ${cursorCondition})
      order by ${sortKey} ${closed ? "desc" : "asc"}, e.id ${closed ? "desc" : "asc"} limit $10`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, params);
  const page = toPage(
    result.rows,
    limit,
    (row) => ({ ...toException(row), orderNo: row["order_no"], serviceAt: row["service_at"], tenantName: row["tenant_name"], assigneeName: row["assignee_name"] }),
    (row) => ({ t: row["cursor_time"], id: row["id"] }),
  );
  return { ...page, total: (total.rows[0] as { n: number }).n };
}

/** 一条异常和它的订单号、供应商名、处理人（详情）。 */
export async function findExceptionRow(db: Db, id: string): Promise<ExceptionRow | null> {
  const result = await db.query<Row>(
    `select ${COLUMNS}, o.order_no, o.service_at, t.name as tenant_name, u.name as assignee_name
       from order_exceptions e join orders o on o.tenant_id = e.supplier_tenant_id and o.id = e.order_id join tenants t on t.id = e.supplier_tenant_id left join platform_users u on u.id = e.assignee_id
      where e.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row === undefined ? null : { ...toException(row), orderNo: row["order_no"], serviceAt: row["service_at"], tenantName: row["tenant_name"], assigneeName: row["assignee_name"] };
}

/** 一个订单编号的全部异常（订单详情）。 */
export async function listOrderExceptions(db: Db, orderId: string): Promise<OrderException[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from order_exceptions e where e.order_id = $1 order by e.opened_at, e.id`, [orderId]);
  return result.rows.map(toException);
}

/** 这些订单各有几条没关的异常（订单列表的「是否异常」）。 */
export async function countOpenExceptions(db: Db, orderIds: readonly string[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const result = await db.query<Row>("select order_id, count(*)::int as n from order_exceptions where order_id = any($1::uuid[]) and status <> 'closed' group by order_id", [[...orderIds]]);
  return new Map(result.rows.map((row) => [row["order_id"] as string, row["n"] as number]));
}
