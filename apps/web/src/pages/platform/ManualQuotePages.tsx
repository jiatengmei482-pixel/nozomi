/**
 * 运营后台「人工报价」的列表和详情（M8-21，ADR 0076；规范 docs/design/pages/platform-tickets.md 第 9 节）。
 * - 列表（`manual_quote.read`）：没有个人信息——只写客人留了邮箱还是 WhatsApp；按状态、跟进人、联系方式（完整的邮箱或号码）筛；上面是各状态的数量。
 * - 详情：打开才解密联系方式、两端地点、备注，每次打开都记审计（页面上写明）；邮箱点开发信，WhatsApp 点开去 wa.me。
 *   改状态、指派带版本号（If-Match），被别人改过时刷新再说；写备注（加密保存，到期和联系方式一起清除）。`manual_quote.manage` 才有这些操作。
 */
import { MANUAL_QUOTE_RULES, MANUAL_QUOTE_STATUSES, type ManualQuoteStatus, manualQuoteStatusChangeAllowed } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type ManualQuoteDetail, type ManualQuoteEvent, type ManualQuotePage, type ManualQuotePerson, type ManualQuoteSummary, addManualQuoteNote, getManualQuote, listManualQuoteAssignees, listManualQuotes, updateManualQuote } from "../../api/manual-quotes.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { type Column, CursorPagination, DataTable } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox, useFilterParam } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextAreaField } from "../../components/TextAreaField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { WhatsappLink } from "../../components/WhatsappLink.tsx";
import { localOffsetLabel } from "../../lib/audit-display.ts";
import { failureText } from "../../lib/failure.ts";
import { MANUAL_QUOTES_PAGE, MANUAL_QUOTE_STATUS_BADGES, PURGED_BADGE, contactKindsText, contactQueryValid, guestWhatsappDigits, guestWhatsappGreeting, manualQuoteEventText, manualQuotePath, manualQuoteStatusOf, manualQuoteTripText } from "../../lib/manual-quote-display.ts";
import { auditLogPath } from "../../lib/platform-paths.ts";
import { pageSizeOf, useCursorPages } from "../../lib/use-cursor-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";
import { Detail, LocalTime, NO_ACCESS, tableStateOf, uuidOrNull } from "./order-center-parts.tsx";

const TRAIL = [{ label: "人工报价", to: MANUAL_QUOTES_PAGE }];

/** 能指派给谁：只有能跟进（`manual_quote.manage`）的人才取得到。 */
function useAssignees(enabled: boolean): readonly ManualQuotePerson[] {
  const { state } = useLoad<{ items: ManualQuotePerson[] }>("manual-quote-assignees", enabled ? listManualQuoteAssignees : null);
  return state.data?.items ?? [];
}

function assigneeText(person: ManualQuotePerson | null, me: string | null): string {
  if (person === null) return "还没人跟进";
  return person.id === me ? `${person.name}（我）` : person.name;
}

function Filters({ assignees }: { assignees: readonly ManualQuotePerson[] }) {
  const [status, setStatus] = useFilterParam("status");
  const [assignee, setAssignee] = useFilterParam("assignee");
  const known = assignee === "me" || assignee === "unassigned" || uuidOrNull(assignee) !== null;
  return (
    <>
      <SelectField inline label="状态" value={manualQuoteStatusOf(status) ?? "all"} options={[{ value: "all", label: "全部" }, ...MANUAL_QUOTE_STATUSES.map((value) => ({ value, label: MANUAL_QUOTE_STATUS_BADGES[value].label }))]} onChange={(value) => setStatus(value === "all" ? null : value)} />
      <SelectField
        inline
        label="跟进人"
        value={known ? (assignee as string) : "all"}
        options={[{ value: "all", label: "全部" }, { value: "me", label: "我" }, { value: "unassigned", label: "还没人跟进" }, ...assignees.map((person) => ({ value: person.id, label: person.name }))]}
        onChange={(value) => setAssignee(value === "all" ? null : value)}
      />
    </>
  );
}

/** 各状态的数量（范围内、不受其他筛选影响）：点一个就只看这个状态。 */
function StatusCounts({ counts, current, onPick }: { counts: ManualQuotePage["counts"]; current: ManualQuoteStatus | null; onPick(status: ManualQuoteStatus | null): void }) {
  return (
    <ul className="status-counts" aria-label="各状态的数量">
      {MANUAL_QUOTE_STATUSES.map((status) => (
        <li key={status}>
          <button type="button" className="status-counts__item" aria-label={`${MANUAL_QUOTE_STATUS_BADGES[status].label} ${counts[status]} 条`} aria-pressed={current === status} onClick={() => onPick(current === status ? null : status)}>
            <span>{MANUAL_QUOTE_STATUS_BADGES[status].label}</span>
            <strong className="status-counts__value">{counts[status]}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ManualQuoteListPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`人工报价 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("manual_quote.read");
  const canManage = usePlatformCan("manual_quote.manage");
  const me = account.status === "ready" ? account.account.id : null;
  const assignees = useAssignees(canManage);
  const [params, setParams] = useSearchParams();
  const status = manualQuoteStatusOf(params.get("status"));
  const assigneeParam = params.get("assignee");
  const assignee = assigneeParam === "me" || assigneeParam === "unassigned" ? assigneeParam : uuidOrNull(assigneeParam);
  const contact = (params.get("contact") ?? "").trim().slice(0, 400);
  const contactValid = contact === "" || contactQueryValid(contact);
  const pageSize = pageSizeOf(params.get("size"));
  const filterKey = JSON.stringify(["manual-quotes", status, assignee, contact, pageSize]);
  const pages = useCursorPages(filterKey);
  const { state, reload } = useLoad<ManualQuotePage>(`${filterKey}|${pages.cursor ?? ""}`, canRead && contactValid
    ? (token) => listManualQuotes(token, { limit: pageSize, ...(status === null ? {} : { status }), ...(assignee === null ? {} : { assignee }), ...(contact === "" ? {} : { contact }), ...(pages.cursor === null ? {} : { cursor: pages.cursor }) })
    : null);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="人工报价">
      <Page title="人工报价">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const filterNames = ["status", "assignee", "contact"];
  const filtered = filterNames.some((name) => params.has(name));
  const clear = (): void => setParam(Object.fromEntries(filterNames.map((name) => [name, null])));
  const columns: Column<ManualQuoteSummary>[] = [
    {
      key: "no",
      header: "申请",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <Link className="link mono" to={manualQuotePath(row.id)}>
            {row.request_no}
          </Link>
          <span className="table__muted manual-quote-trip">{manualQuoteTripText(row)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "状态",
      cell: (row) => (
        <span className="badge-row">
          <StatusBadge {...MANUAL_QUOTE_STATUS_BADGES[row.status]} />
          {row.purged_at !== null && <StatusBadge {...PURGED_BADGE} />}
        </span>
      ),
    },
    { key: "contact", header: "留了", cardLabel: true, cell: (row) => contactKindsText(row) },
    { key: "assignee", header: "跟进人", cardLabel: true, cell: (row) => assigneeText(row.assignee, me) },
    { key: "created", header: "提交时间", cardLabel: true, cell: (row) => <span className="table__muted"><LocalTime iso={row.created_at} /></span> },
  ];
  const empty = filtered ? (
    <StateBlock tone="neutral" title="没有符合条件的申请" description="换个条件试试，或清空筛选。" action={<Button variant="secondary" onClick={clear}>清空筛选</Button>} />
  ) : (
    <StateBlock tone="success" title="现在没有人工报价申请" description="官网一家供应商都报不出价时，客人可以留下邮箱或 WhatsApp 请客服报价，申请会出现在这里。" />
  );
  const data = state.data;
  const exactTotal = data === null || assignee !== null || contact !== "" ? null : status === null ? MANUAL_QUOTE_STATUSES.reduce((sum, key) => sum + data.counts[key], 0) : data.counts[status];
  return shell(
    <>
      <p className="page__lead">{`官网报不出价时客人留下的联系方式。列表里没有联系方式和地点，打开一条才看得到（每次打开都记入审计日志）。时间按你的本地时区（${localOffsetLabel()}）显示。`}</p>
      {account.status === "ready" && !canManage && <Alert kind="info">你可以查看人工报价申请，但不能跟进。</Alert>}
      {data !== null && <StatusCounts counts={data.counts} current={status} onPick={(value) => setParam({ status: value })} />}
      <FilterBar search={<SearchBox label="按联系方式查找（完整的邮箱或带国家码的号码）" value={contact} onSearch={(value) => setParam({ contact: value })} />} paramNames={["status", "assignee"]} active={filtered} onClear={clear}>
        <Filters assignees={assignees} />
      </FilterBar>
      {!contactValid ? (
        <StateBlock tone="neutral" title="请输入完整的联系方式" description="按联系方式只能精确查找：写完整的邮箱（如 name@example.com），或带国家码的 WhatsApp 号码（如 +81 开头）。" action={<Button variant="secondary" onClick={() => setParam({ contact: null })}>清空查找</Button>} />
      ) : (
        <>
          <div className="card-table">
            <DataTable label="人工报价申请" columns={columns} rows={data?.items ?? []} rowKey={(row) => row.id} state={tableStateOf(state.status, data !== null)} refreshing={state.status === "loading" && data !== null} onRetry={reload} empty={empty} />
          </div>
          <CursorPagination
            total={exactTotal}
            pageSize={pageSize}
            onPageSizeChange={(size) => setParam({ size: size === 20 ? null : String(size) })}
            hasPrevious={pages.hasPrevious}
            hasNext={state.status === "ready" && state.data.next_cursor !== null}
            busy={state.status === "loading"}
            onPrevious={pages.previous}
            onNext={() => {
              const next = data?.next_cursor;
              if (next) pages.next(next);
            }}
          />
        </>
      )}
    </>,
  );
}

// ───────────── 详情 ─────────────

/** 改状态、指派被拒时给人看的话。 */
function changeFailure(err: unknown): { text: string; reload: boolean } {
  if (err instanceof ApiError && err.code === "VERSION_CONFLICT") return { text: "这条申请刚被别人改过，页面已刷新成最新的样子。请看过再改。", reload: true };
  if (err instanceof ApiError && err.code === "MANUAL_QUOTE_PURGED") return { text: "这条申请已过保留期，联系方式已清除，不能再改。页面已刷新。", reload: true };
  if (err instanceof ApiError && err.code === "MANUAL_QUOTE_STATUS_INVALID") return { text: "不能改回「新」。「新」只表示还没人看过。", reload: false };
  if (err instanceof ApiError && err.code === "VALIDATION_FAILED") return { text: "这位同事不能跟进这一条（没有权限，或这一条不在他的数据范围里）。请换一位。", reload: false };
  return { text: failureText(err, "保存"), reload: false };
}

function ContactSection({ detail }: { detail: ManualQuoteDetail }) {
  const { contact, pickup, dropoff } = detail;
  if (contact === null) {
    return (
      <section className="card" aria-labelledby="mq-contact">
        <h2 className="card__title" id="mq-contact">
          客人留下的内容
        </h2>
        <p>{`已过保留期（结束后 ${MANUAL_QUOTE_RULES.retentionDaysAfterFinish} 天、最长 ${MANUAL_QUOTE_RULES.retentionDaysMax} 天），联系方式、地点和备注已清除。`}</p>
      </section>
    );
  }
  const whatsappDigits = contact.whatsapp === null ? null : guestWhatsappDigits(contact.whatsapp);
  return (
    <section className="card" aria-labelledby="mq-contact">
      <h2 className="card__title" id="mq-contact">
        客人留下的内容
      </h2>
      <p className="table__muted">
        <Icon name="lock" /> 你打开这一页已记入审计日志。联系方式只用来给这位客人报价，不要抄到别处。
      </p>
      <dl className="details">
        <Detail label="邮箱">
          {contact.email === null ? null : (
            <a className="link" href={`mailto:${contact.email}`}>
              {contact.email}
            </a>
          )}
        </Detail>
        <Detail label="WhatsApp">
          {contact.whatsapp === null ? null : whatsappDigits === null ? (
            contact.whatsapp
          ) : (
            <WhatsappLink digits={whatsappDigits} text={guestWhatsappGreeting(detail.request.request_no)}>
              {contact.whatsapp}
            </WhatsappLink>
          )}
        </Detail>
        <Detail label={detail.request.category === "charter" ? "上车地点" : "出发地"}>{pickup === null ? null : <PlaceText place={pickup} />}</Detail>
        <Detail label={detail.request.category === "charter" ? "下车地点" : "目的地"}>{dropoff === null ? null : <PlaceText place={dropoff} />}</Detail>
      </dl>
    </section>
  );
}

function PlaceText({ place }: { place: { name: string; lat: number; lng: number } }) {
  return (
    <span className="table__names">
      <span>{place.name}</span>
      <span className="table__muted mono">{`${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`}</span>
    </span>
  );
}

function FollowUp({ detail, me, onChanged, onReload }: { detail: ManualQuoteDetail; me: string | null; onChanged(request: ManualQuoteSummary): void; onReload(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const assignees = useAssignees(true);
  const request = detail.request;
  const [status, setStatus] = useState<ManualQuoteStatus>(request.status);
  const [assigneeId, setAssigneeId] = useState<string>(request.assignee?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const purged = request.purged_at !== null;
  const changes = { ...(status !== request.status ? { status } : {}), ...(assigneeId !== (request.assignee?.id ?? "") ? { assignee_id: assigneeId === "" ? null : assigneeId } : {}) };
  const dirty = Object.keys(changes).length > 0;
  const options = [...assignees];
  if (request.assignee !== null && !options.some((person) => person.id === request.assignee?.id)) options.unshift(request.assignee);
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setProblem(null);
    try {
      const { request: updated } = await updateManualQuote(token, request.id, request.version, changes);
      onChanged(updated);
      toast("已保存");
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const failure = changeFailure(err);
      setProblem(failure.text);
      if (failure.reload) onReload();
    } finally {
      setBusy(false);
    }
  };
  const claim = (): void => {
    if (me !== null) setAssigneeId(me);
  };
  return (
    <section className="card" aria-labelledby="mq-follow">
      <h2 className="card__title" id="mq-follow">
        跟进
      </h2>
      {purged ? (
        <p className="table__muted">已过保留期，不能再改状态、指派或写备注。</p>
      ) : (
        <form className="form" noValidate onSubmit={(event) => void save(event)}>
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <SelectField
            label="状态"
            value={status}
            options={MANUAL_QUOTE_STATUSES.filter((value) => value === request.status || manualQuoteStatusChangeAllowed(request.status, value)).map((value) => ({ value, label: MANUAL_QUOTE_STATUS_BADGES[value].label }))}
            hint="已转订单、关闭之后满 180 天清除联系方式；关闭后也能改回跟进中。"
            onChange={(value) => setStatus(value as ManualQuoteStatus)}
          />
          <SelectField label="跟进人" value={assigneeId} options={[{ value: "", label: "还没人跟进" }, ...options.map((person) => ({ value: person.id, label: assigneeText(person, me) }))]} onChange={setAssigneeId} />
          <div className="action-row">
            <Button type="submit" variant="primary" loading={busy} loadingText="保存中…" disabled={!dirty}>
              保存
            </Button>
            {me !== null && assigneeId !== me && (
              <Button variant="text" onClick={claim}>
                指派给我
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function NoteForm({ requestId, onAdded }: { requestId: string; onAdded(event: ManualQuoteEvent): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (note.trim() === "") {
      setError("请写备注内容");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { event: added } = await addManualQuoteNote(token, requestId, note.trim());
      setNote("");
      toast("已添加备注");
      onAdded(added);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setError(err instanceof ApiError && err.code === "MANUAL_QUOTE_PURGED" ? "这条申请已过保留期，不能再写备注。" : `${failureText(err, "保存备注")}写的内容还在。`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" noValidate onSubmit={(event) => void submit(event)}>
      <TextAreaField label="写备注" rows={3} maxLength={MANUAL_QUOTE_RULES.maxNoteLength} value={note} errors={error === null ? [] : [error]} hint="只有平台同事看得到，加密保存，到期和联系方式一起清除。报给客人的价格、客人的回复都可以记在这里。" onChange={(event) => setNote(event.target.value)} />
      <div className="action-row">
        <Button type="submit" loading={busy} loadingText="保存中…">
          添加备注
        </Button>
      </div>
    </form>
  );
}

export function ManualQuoteDetailPage() {
  const { id = "" } = useParams();
  const { portal, account } = usePortalSession();
  const canRead = usePlatformCan("manual_quote.read");
  const canManage = usePlatformCan("manual_quote.manage");
  const canAudit = usePlatformCan("audit_log.read");
  const me = account.status === "ready" ? account.account.id : null;
  const { state, reload, set } = useLoad<ManualQuoteDetail>(`manual-quote|${id}`, canRead ? (t) => getManualQuote(t, id) : null);
  const detail = state.data;
  const title = detail === null ? "人工报价申请" : `申请 ${detail.request.request_no}`;
  useDocumentTitle(`${title} · 人工报价 · NOZOMI ${portal.name}`);
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName={title} trail={TRAIL}>
      <Page title={title}>{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);
  if (state.status === "not-found") return shell(<StateBlock tone="neutral" title="找不到这条申请" description="它可能不在你的数据范围里，或链接有误。" />);
  if (detail === null) {
    return shell(
      state.status === "error" ? (
        <StateBlock title="申请没有加载出来" description="请检查网络后重试。如果一直打不开，可能是服务器的数据加密没有配置好，请联系技术同事。" action={<Button variant="secondary" onClick={reload}>重试</Button>} />
      ) : (
        <Skeleton lines={["medium", "long", "long", "short"]} />
      ),
    );
  }
  const request = detail.request;
  return shell(
    <div className="detail-layout">
      <div className="detail-layout__main">
        <section className="card" aria-labelledby="mq-summary">
          <div className="card__title-row">
            <h2 className="card__title" id="mq-summary">
              行程
            </h2>
            <span className="badge-row">
              <StatusBadge {...MANUAL_QUOTE_STATUS_BADGES[request.status]} />
              {request.purged_at !== null && <StatusBadge {...PURGED_BADGE} />}
            </span>
          </div>
          <p>{manualQuoteTripText(request)}</p>
          <dl className="details">
            <Detail label="提交时间">
              <LocalTime iso={request.created_at} />
            </Detail>
            <Detail label="跟进人">{assigneeText(request.assignee, me)}</Detail>
            {request.finished_at !== null && (
              <Detail label="结束时间">
                <LocalTime iso={request.finished_at} />
              </Detail>
            )}
          </dl>
          <p className="table__muted">{`时间按你的本地时区（${localOffsetLabel()}）显示；用车时间是当地时间。`}</p>
          {canAudit && (
            <div className="action-row">
              <Link className="link" to={auditLogPath({ resource: "manual_quote_request", rid: request.id })}>
                看这条申请的操作记录
              </Link>
            </div>
          )}
        </section>
        <ContactSection detail={detail} />
        <section className="card" aria-labelledby="mq-events">
          <h2 className="card__title" id="mq-events">
            跟进记录
          </h2>
          <ol className="thread">
            {detail.events.map((event) => (
              <li key={event.id} className={event.kind === "note" ? "thread__item thread__item--internal" : "thread__item"}>
                <p className="thread__meta">
                  <strong>{manualQuoteEventText(event)}</strong>
                  <span>{event.actor === null ? "客人" : assigneeText(event.actor, me)}</span>
                  <LocalTime iso={event.created_at} />
                </p>
                {event.kind === "note" && <p className="prewrap">{event.note ?? "（已清除）"}</p>}
              </li>
            ))}
          </ol>
          {canManage && request.purged_at === null && <NoteForm requestId={request.id} onAdded={(event) => set({ ...detail, events: [...detail.events, event] })} />}
        </section>
      </div>
      <aside className="detail-layout__aside" aria-label="跟进">
        {canManage ? (
          <FollowUp key={`${request.version}`} detail={detail} me={me} onChanged={(updated) => {
              // 跟进记录要重新读（改状态、指派各记一条）；重新打开也记一次审计
              set({ ...detail, request: updated });
              reload();
            }} onReload={reload} />
        ) : (
          <section className="card" aria-labelledby="mq-follow">
            <h2 className="card__title" id="mq-follow">
              跟进
            </h2>
            <p className="table__muted">你可以查看，但没有跟进人工报价的权限。</p>
          </section>
        )}
      </aside>
    </div>,
  );
}
