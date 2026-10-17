/**
 * 运营后台「系统设置」的审计日志和系统状态（docs/design/pages/platform-settings.md 第 3、4 节）。
 * 审计日志只能看；筛选以接口实际支持的为准（操作人、某一个对象只能从别的页面带进来）。
 * 系统状态不自动刷新：每次请求都会写一条审计日志。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type AuditLog, type FxCenterStatus, type IntegrationStatus, type Page as ApiPage, listAllTenants, listAuditLogs, listIntegrations } from "../../api/platform.ts";
import type { Tenant } from "../../api/types.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, CursorPagination, DataTable, PAGE_SIZES, type TableState } from "../../components/DataTable.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { CopyButton } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { ACTION_NAMES, ACTOR_TYPE_NAMES, type DiffRow, FIELD_NAMES, RESOURCE_NAMES, SOURCE_NAMES, actionName, auditDiff, foldable, localDate, localDayInstant, localOffsetLabel, localSecond, objectName, resourceName, shortId, shownValue, utcSecond } from "../../lib/audit-display.ts";
import { failureText } from "../../lib/failure.ts";
import { FX_FETCH_BADGES, FX_PATH, FX_STATE_BADGES, fxErrorText } from "../../lib/fx-display.ts";
import { formatLocalDateTime } from "../../lib/master-display.ts";
import { tidyDate } from "../../lib/time-input.ts";
import { useCopyText } from "../../lib/use-copy-text.tsx";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
const TRAIL = [{ label: "系统设置" }];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 50;

// ───────────── 审计日志 ─────────────

/** 一个值：短的一行；一组东西是文本块；长的先折起来。 */
function ValueView({ field, value, resource }: { field: string; value: unknown; resource: string }) {
  const [open, setOpen] = useState(false);
  const shown = shownValue(field, value, resource);
  if (shown.empty) return <span className="audit-value audit-value--empty">{shown.text}</span>;
  const fold = foldable(shown.text);
  const text = fold !== null && !open ? fold.folded : shown.text;
  return (
    <span className="audit-value">
      {shown.block || fold !== null ? <span className="audit-value__block">{text}</span> : text}
      {shown.raw !== undefined && <code className="audit-raw">{shown.raw}</code>}
      {fold !== null && (
        <button type="button" className="link audit-value__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "收起" : `展开（共 ${fold.lines} 行）`}
        </button>
      )}
    </span>
  );
}

function FieldName({ field }: { field: string }) {
  const known = FIELD_NAMES[field];
  return known ? (
    <>
      {known}
      <code className="audit-raw">{field}</code>
    </>
  ) : (
    <code className="audit-raw audit-raw--only">{field}</code>
  );
}

function DiffView({ log }: { log: AuditLog }) {
  const [all, setAll] = useState(false);
  const diff = auditDiff(log);
  if (diff.kind === "none") return <p className="page-intro">这次操作没有记下更多内容。</p>;
  const rows: DiffRow[] = diff.kind === "both" && !all ? diff.rows.filter((row) => row.changed) : diff.rows;
  const both = diff.kind === "both";
  return (
    <>
      <div className="audit-diff__scroll">
        <table className={both ? "table audit-diff audit-diff--both" : "table audit-diff"}>
          <caption className="visually-hidden">{both ? "改了什么" : diff.kind === "after" ? "记下的内容" : "删除前的内容"}</caption>
          <thead>
            <tr>
              <th scope="col">项目</th>
              {both ? (
                <>
                  <th scope="col">改前</th>
                  <th scope="col">改后</th>
                </>
              ) : (
                <th scope="col">{diff.kind === "after" ? "内容" : "删除前的内容"}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <FieldName field={row.key} />
                </th>
                {both ? (
                  <>
                    <td className="audit-diff__before" data-label="改前">
                      <ValueView field={row.key} value={row.before} resource={log.resource} />
                    </td>
                    <td data-label="改后">{row.changed ? <ValueView field={row.key} value={row.after} resource={log.resource} /> : <span className="audit-value audit-value--empty">没有变</span>}</td>
                  </>
                ) : (
                  <td>
                    <ValueView field={row.key} value={diff.kind === "after" ? row.after : row.before} resource={log.resource} />
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>没有哪一项变了。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {both && diff.unchanged > 0 && !all && (
        <p className="page-intro">
          {`另有 ${diff.unchanged} 项没有变`}
          <Button variant="text" size="sm" onClick={() => setAll(true)}>
            全部显示
          </Button>
        </p>
      )}
    </>
  );
}

/** 手机宽度的「筛选」面板里的草稿：两个日期是输入框里的原文。 */
interface PanelDraft {
  from: string;
  to: string;
  resource: string | null;
  action: string | null;
  tenant: string | null;
}

const DATE_PROBLEM = "这不是一个日期，请按 2026-10-08 的格式填写";
const DATE_REVERSED = "结束日期不能早于开始日期，请改一下「从」或「到」";

/** 日期输入哪里不对：某一格不是日期；或两格都对、「到」早于「从」（标红「到」）。 */
type DateProblem = "from" | "to" | "reversed";

function Mono({ children }: { children: string }) {
  return <code className="audit-raw audit-raw--only">{children}</code>;
}

export function AuditLogPage() {
  const { portal, account } = usePortalSession();
  useDocumentTitle(`审计日志 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("audit_log.read");
  const canSeeTenants = usePlatformCan("tenant.read");
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tenants = useLoad<{ items: Tenant[]; truncated: boolean }>("platform-tenants", canRead && canSeeTenants ? listAllTenants : null);
  const copier = useCopyText();
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const [fromText, setFromText] = useState(params.get("from") ?? "");
  const [toText, setToText] = useState(params.get("to") ?? "");
  /** 手机宽度的「筛选」面板里改的是这份草稿，点「查看结果」才一起写进网址 */
  const [panel, setPanel] = useState<PanelDraft | null>(null);
  const [panelDateProblem, setPanelDateProblem] = useState<DateProblem | null>(null);
  /** 表格上方那一排里没能生效的日期（填的不是日期）：留着原文，标红并说明 */
  const [inlineDateProblem, setInlineDateProblem] = useState<"from" | "to" | null>(null);
  /** 带进来的操作人邮箱、对象名称（从别的页面、或在表格里点「只看…」时记下）；直接从网址进来时没有 */
  const carried = location.state as { actorEmail?: unknown; resourceName?: unknown } | null;
  const [actorEmail, setActorEmail] = useState<string | null>(typeof carried?.actorEmail === "string" ? carried.actorEmail : null);
  const [targetName, setTargetName] = useState<string | null>(typeof carried?.resourceName === "string" ? carried.resourceName : null);

  // 网址里的条件：不合法的忽略那一个
  let ignored = false;
  const pick = (name: string, ok: (value: string) => boolean): string | null => {
    const value = params.get(name);
    if (value === null || value === "") return null;
    if (ok(value)) return value;
    ignored = true;
    return null;
  };
  const from = pick("from", (value) => localDayInstant(value, false) !== null);
  const to = pick("to", (value) => localDayInstant(value, true) !== null);
  const resource = pick("resource", (value) => /^[a-z_]{1,40}$/.test(value));
  const action = pick("action", (value) => /^[a-z_]{1,40}$/.test(value));
  const tenant = pick("tenant", (value) => UUID_PATTERN.test(value));
  const actor = pick("actor", (value) => UUID_PATTERN.test(value));
  const rid = resource === null ? null : pick("rid", (value) => value.length <= 100);
  const sizeParam = Number(params.get("size"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  /** 「从」晚于「到」：一条记录也不可能符合，不去查，直接说日期填反了 */
  const reversed = from !== null && to !== null && from > to;
  const filterKey = JSON.stringify([from, to, resource, action, tenant, actor, rid, pageSize]);
  const [paging, setPaging] = useState<{ key: string; stack: (string | null)[] }>({ key: filterKey, stack: [null] });
  const stack = paging.key === filterKey ? paging.stack : [null];
  const cursor = stack[stack.length - 1] ?? null;
  // 网址里的日期变了就把两格换成网址里的值；但正挂着「不是日期」提示的那一格保留用户填的原文，提示和框里的字才对得上
  const dateProblem = useRef(inlineDateProblem);
  dateProblem.current = inlineDateProblem;
  useEffect(() => {
    if (dateProblem.current !== "from") setFromText(from ?? "");
    if (dateProblem.current !== "to") setToText(to ?? "");
  }, [from, to]);

  const loaded = useLoad<ApiPage<AuditLog>>(
    `audit-logs:${filterKey}:${cursor}`,
    canRead && !reversed
      ? (token) =>
          listAuditLogs(token, {
            ...(actor !== null ? { actor_id: actor } : {}),
            ...(tenant !== null ? { tenant_id: tenant } : {}),
            ...(resource !== null ? { resource } : {}),
            ...(rid !== null ? { resource_id: rid } : {}),
            ...(action !== null ? { action } : {}),
            ...(from !== null ? { from: localDayInstant(from, false) as string } : {}),
            ...(to !== null ? { to: localDayInstant(to, true) as string } : {}),
            limit: pageSize,
            ...(cursor !== null ? { cursor } : {}),
          })
      : null,
  );

  const setParam = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="审计日志" trail={TRAIL}>
      <Page title="审计日志">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  const tenantName = (id: string | null): string | null => (id === null ? null : (tenants.state.data?.items.find((entry) => entry.id === id)?.name ?? null));
  const filtered = from !== null || to !== null || resource !== null || action !== null || tenant !== null || actor !== null || rid !== null;
  const clearFilters = (): void => {
    setInlineDateProblem(null);
    setFromText("");
    setToText("");
    setActorEmail(null);
    setTargetName(null);
    setParam({ from: null, to: null, resource: null, action: null, tenant: null, actor: null, rid: null });
  };
  const commitDate = (name: "from" | "to", text: string): void => {
    const tidy = text.trim() === "" ? null : tidyDate(text);
    if (text.trim() !== "" && tidy === null) return setInlineDateProblem(name);
    if (inlineDateProblem === name) setInlineDateProblem(null);
    setParam({ [name]: tidy });
  };
  const swapDates = (): void => setParam({ from: to, to: from });
  const quickRange = (days: number): { from: string; to: string } => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
    return { from: localDate(start), to: localDate(today) };
  };
  const applyPanel = (): void => {
    if (panel === null) return;
    const dateOf = (text: string): string | null => (text.trim() === "" ? null : tidyDate(text));
    const [nextFrom, nextTo] = [dateOf(panel.from), dateOf(panel.to)];
    const bad: DateProblem | null =
      panel.from.trim() !== "" && nextFrom === null ? "from" : panel.to.trim() !== "" && nextTo === null ? "to" : nextFrom !== null && nextTo !== null && nextFrom > nextTo ? "reversed" : null;
    setPanelDateProblem(bad);
    if (bad !== null) return void document.getElementById(`audit-panel-${bad === "reversed" ? "to" : bad}`)?.focus();
    setParam({ from: nextFrom, to: nextTo, resource: panel.resource, action: panel.action, tenant: panel.tenant, ...(panel.resource !== resource ? { rid: null } : {}) });
    setPanel(null);
  };
  const objectLabel = (log: AuditLog): string => [resourceName(log.resource).text, objectName(log)].filter((part) => part !== null).join(" ");

  const columns: Column<AuditLog>[] = [
    {
      key: "time",
      header: `时间（你的本地时区，${localOffsetLabel()}）`,
      cell: (row) => (
        <time className="audit-time" dateTime={row.occurred_at} title={utcSecond(row.occurred_at)}>
          {localSecond(row.occurred_at)}
        </time>
      ),
    },
    {
      key: "actor",
      header: "操作人",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          {row.actor.email !== null && row.actor.id !== null ? (
            <Dropdown buttonClassName="link audit-menu" buttonContent={row.actor.email} label={`操作人 ${row.actor.email}`} align="start">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setActorEmail(row.actor.email);
                  setParam({ actor: row.actor.id });
                }}
              >
                <span className="menu-item__text">只看这个人</span>
              </button>
            </Dropdown>
          ) : (
            <span>{row.actor.email ?? "—"}</span>
          )}
          <span className="audit-sub">{ACTOR_TYPE_NAMES[row.actor.type] ?? row.actor.type}</span>
        </span>
      ),
    },
    {
      key: "action",
      header: "操作",
      cell: (row) => {
        const name = actionName(row.action);
        return name.known ? <span className="tag">{name.text}</span> : <Mono>{name.text}</Mono>;
      },
    },
    {
      key: "object",
      header: "对象",
      wrap: true,
      cell: (row) => {
        const type = resourceName(row.resource);
        const name = objectName(row);
        const label = (
          <>
            {type.known ? type.text : <Mono>{type.text}</Mono>}
            {name !== null && ` ${name}`}
          </>
        );
        return (
          <span className="table__names">
            {row.resource_id !== null ? (
              <Dropdown buttonClassName="link audit-menu" buttonContent={label} label={`对象 ${objectLabel(row)}`} align="start">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setTargetName(name);
                    setParam({ resource: row.resource, rid: row.resource_id });
                  }}
                >
                  <span className="menu-item__text">只看这个对象</span>
                </button>
              </Dropdown>
            ) : (
              <span>{label}</span>
            )}
            {row.resource_id !== null && (
              <span className="audit-sub product-code" title={row.resource_id}>
                {shortId(row.resource_id)}
              </span>
            )}
          </span>
        );
      },
    },
    { key: "source", header: "来源", cell: (row) => SOURCE_NAMES[row.source] ?? row.source },
    {
      key: "detail",
      header: "详情",
      cell: (row) => (
        <Button variant="text" size="sm" aria-label={`第 ${row.id} 条记录的详情`} onClick={() => setDetail(row)}>
          详情
        </Button>
      ),
    },
  ];

  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : reversed ? "ready" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const empty = reversed ? (
    <StateBlock
      tone="neutral"
      title="日期填反了"
      description={`「从」${from} 晚于「到」${to}，这样一条记录也查不到。请改一下其中一个日期，或把两个日期对调。`}
      action={
        <Button variant="secondary" onClick={swapDates}>
          对调两个日期
        </Button>
      }
    />
  ) : filtered ? (
    <StateBlock
      tone="neutral"
      title="没有符合条件的记录"
      description="换个条件试试，或清空筛选。"
      action={
        <Button variant="secondary" onClick={clearFilters}>
          清空筛选
        </Button>
      }
    />
  ) : (
    <StateBlock tone="neutral" title="还没有记录" />
  );
  const chip = (text: string, remove: () => void): ReactNode => (
    <span className="filter-chip" title={text}>
      <span className="filter-chip__text">{text}</span>
      <button type="button" className="filter-chip__remove" aria-label={`移除条件：${text}`} onClick={remove}>
        <Icon name="x" />
      </button>
    </span>
  );
  /** 筛选的控件。`draft` 为 null 是表格上方那一排（一改就查询）；不为 null 是面板里的（改的是草稿）。 */
  const conditions = (draft: PanelDraft | null): ReactNode => {
    const prefix = draft === null ? "audit" : "audit-panel";
    const size = draft === null ? " input--sm" : "";
    const change = (changes: Partial<PanelDraft>): void => {
      if (draft !== null) return setPanel({ ...draft, ...changes });
      if ("from" in changes || "to" in changes) {
        // 网址可能没变（比如点了和当前范围相同的快捷范围），上面的同步不会触发：这里直接把框里的字换成新值
        setInlineDateProblem(null);
        if ("from" in changes) setFromText(changes.from ?? "");
        if ("to" in changes) setToText(changes.to ?? "");
      }
      setParam({ ...changes, ...("resource" in changes ? { rid: null } : {}) });
    };
    const dateInput = (name: "from" | "to", label: string, value: string, set: (value: string) => void): ReactNode => {
      const problem: DateProblem | null = draft !== null ? panelDateProblem : inlineDateProblem ?? (reversed ? "reversed" : null);
      const wrong = problem === name || (problem === "reversed" && name === "to");
      const message = problem === "reversed" ? DATE_REVERSED : DATE_PROBLEM;
      return (
        <label className="audit-filters__item" htmlFor={`${prefix}-${name}`}>
          <span className="audit-filters__label">{label}</span>
          <input
            className={`input${size} input--mono`}
            id={`${prefix}-${name}`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="不限"
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? `${prefix}-${name}-error` : undefined}
            value={value}
            onChange={(event) => {
              set(event.target.value);
              // 出过错后实时重新校验：改对了（或清空了）就收起提示，离开输入框时再生效
              if (draft === null && inlineDateProblem === name && (event.target.value.trim() === "" || tidyDate(event.target.value) !== null)) setInlineDateProblem(null);
            }}
            {...(draft === null ? { onBlur: () => commitDate(name, value), onKeyDown: (event) => event.key === "Enter" && commitDate(name, value) } : {})}
          />
          {wrong && (
            <span className="field__error" id={`${prefix}-${name}-error`} role="alert">
              {message}
            </span>
          )}
        </label>
      );
    };
    const select = (name: "resource" | "action", label: string, value: string | null, names: Readonly<Record<string, string>>): ReactNode => (
      <label className="audit-filters__item" htmlFor={`${prefix}-${name}`}>
        <span className="audit-filters__label">{label}</span>
        <select className={`input${size} select`} id={`${prefix}-${name}`} value={value ?? ""} onChange={(event) => change({ [name]: event.target.value === "" ? null : event.target.value })}>
          <option value="">全部</option>
          {value !== null && names[value] === undefined && <option value={value}>{value}</option>}
          {Object.entries(names).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
    );
    return (
      <>
        {dateInput("from", "从", draft === null ? fromText : draft.from, draft === null ? setFromText : (value) => change({ from: value }))}
        {dateInput("to", "到", draft === null ? toText : draft.to, draft === null ? setToText : (value) => change({ to: value }))}
        <span className="audit-filters__quick">
          {(
            [
              [1, "今天"],
              [7, "最近 7 天"],
              [30, "最近 30 天"],
            ] as const
          ).map(([days, text]) => (
            <Button key={days} variant="text" size="sm" onClick={() => change(quickRange(days))}>
              {text}
            </Button>
          ))}
        </span>
        {select("resource", "对象类型", draft === null ? resource : draft.resource, RESOURCE_NAMES)}
        {select("action", "操作", draft === null ? action : draft.action, ACTION_NAMES)}
        {canSeeTenants && (
          <Combobox
            inline
            label="供应商"
            clearLabel="全部"
            placeholder="全部"
            options={(tenants.state.data?.items ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
            value={draft === null ? tenant : draft.tenant}
            onChange={(value) => change({ tenant: value })}
            loading={tenants.state.data === null && tenants.state.status === "loading"}
            loadFailed={tenants.state.data === null && tenants.state.status === "error"}
          />
        )}
      </>
    );
  };
  const panelCount = [from, to, resource, action, tenant].filter((value) => value !== null).length;
  const detailTitle = detail === null ? "" : `${actionName(detail.action).text} · ${objectLabel(detail)}`;

  return shell(
    <>
      <p className="page-intro">平台和供应商后台里的每一次登录、新建、修改、停用都记在这里，只能查看，不能修改或删除。密码、链接里的令牌不会被记录。</p>
      <div role="status">{ignored && <Alert kind="info">网址里有一个筛选条件不对，已经忽略。</Alert>}</div>
      <div className="filter-bar">
        <Button
          className="filter-bar__toggle"
          aria-haspopup="dialog"
          onClick={() => {
            setPanelDateProblem(null);
            setPanel({ from: from ?? "", to: to ?? "", resource, action, tenant });
          }}
        >
          <Icon name="filter" />
          {panelCount > 0 ? `筛选 · ${panelCount}` : "筛选"}
        </Button>
        <div className="audit-filters" role="group" aria-label="筛选">
          {conditions(null)}
        </div>
        {filtered && (
          <Button variant="text" size="sm" className="filter-bar__clear" onClick={clearFilters}>
            清空筛选
          </Button>
        )}
      </div>
      <Dialog
        open={panel !== null}
        title="筛选"
        onClose={() => setPanel(null)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPanelDateProblem(null);
                setPanel({ from: "", to: "", resource: null, action: null, tenant: null });
              }}
            >
              清空
            </Button>
            <Button variant="primary" onClick={applyPanel}>
              查看结果
            </Button>
          </>
        }
      >
        {panel !== null && <div className="filter-bar__panel">{conditions(panel)}</div>}
      </Dialog>
      {(actor !== null || rid !== null) && (
        <p className="filter-chips">
          {actor !== null &&
            chip(`操作人：${actorEmail ?? shortId(actor)}`, () => {
              setActorEmail(null);
              setParam({ actor: null });
            })}
          {rid !== null &&
            resource !== null &&
            chip(`对象：${resourceName(resource).text} ${targetName ?? shortId(rid)}`, () => {
              setTargetName(null);
              setParam({ rid: null });
            })}
        </p>
      )}
      <div className="card-table">
        <DataTable label="审计日志" columns={columns} rows={state.data?.items ?? []} rowKey={(row) => row.id} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={loaded.reload} empty={empty} />
      </div>
      <CursorPagination
        total={null}
        pageSize={pageSize}
        onPageSizeChange={(size) => setParam({ size: size === DEFAULT_PAGE_SIZE ? null : String(size) })}
        hasPrevious={stack.length > 1}
        hasNext={state.status === "ready" && state.data.next_cursor !== null}
        busy={state.status === "loading"}
        onPrevious={() => setPaging({ key: filterKey, stack: stack.slice(0, -1) })}
        onNext={() => {
          const next = state.data?.next_cursor;
          if (next) setPaging({ key: filterKey, stack: [...stack, next] });
        }}
      />
      {state.data !== null && <p className="page-intro">{`本页 ${state.data.items.length} 条`}</p>}
      <Dialog
        open={detail !== null}
        size="form"
        title={detailTitle}
        onClose={() => setDetail(null)}
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail !== null && (
          <div className="audit-detail">
            <dl className="audit-detail__list">
              <dt>时间</dt>
              <dd>
                {localSecond(detail.occurred_at)}
                <span className="audit-sub">{utcSecond(detail.occurred_at)}</span>
              </dd>
              <dt>操作人</dt>
              <dd>
                {detail.actor.email ?? "—"}
                <span className="audit-sub">{ACTOR_TYPE_NAMES[detail.actor.type] ?? detail.actor.type}</span>
              </dd>
              <dt>操作</dt>
              <dd>{actionName(detail.action).known ? actionName(detail.action).text : <Mono>{detail.action}</Mono>}</dd>
              <dt>对象</dt>
              <dd>
                {objectLabel(detail)}
                {detail.resource_id !== null && (
                  <span className="audit-sub tenant-id">
                    <span className="product-code">{detail.resource_id}</span>
                    <CopyButton text={detail.resource_id} label="复制对象编号" />
                  </span>
                )}
              </dd>
              <dt>所属供应商</dt>
              <dd>{detail.tenant_id === null ? "—" : (tenantName(detail.tenant_id) ?? <span className="product-code">{detail.tenant_id}</span>)}</dd>
              <dt>来源</dt>
              <dd>{SOURCE_NAMES[detail.source] ?? detail.source}</dd>
              <dt>来源地址</dt>
              <dd>{detail.ip ?? "—"}</dd>
              <dt>记录编号</dt>
              <dd className="product-code">{detail.id}</dd>
            </dl>
            <div className="card__title-row">
              <h3 className="card__title">{detail.before !== null && detail.after !== null ? "改了什么" : detail.after !== null ? "记下的内容" : detail.before !== null ? "删除前的内容" : "改了什么"}</h3>
              <Button variant="text" size="sm" onClick={() => copier.copy(JSON.stringify(detail, null, 2))}>
                复制这条记录
              </Button>
            </div>
            <DiffView key={detail.id} log={detail} />
            <p className="page-intro">密码、密码的哈希、邀请和重置链接里的令牌不会被记录，所以这里看不到，不是被隐藏了。</p>
          </div>
        )}
      </Dialog>
      {copier.dialog}
    </>,
  );
}

// ───────────── 系统状态 ─────────────

const when = (iso: string | null): string => (iso === null ? "—" : formatLocalDateTime(iso));

/** 汇率数据源在运行得怎么样（接口的 `fx_center`；M1-14）：是否过期、这批汇率的时间、最近一次拉取。 */
function FxCenterCard({ fx }: { fx: FxCenterStatus }) {
  const reason = fx.last_attempt_status === "failed" || fx.last_attempt_status === "rejected" ? fxErrorText(fx.last_error_code) : null;
  return (
    <section className="card" aria-labelledby="integrations-fx-title">
      <div className="card__header">
        <h2 className="card__title" id="integrations-fx-title">
          汇率数据
        </h2>
        <StatusBadge {...FX_STATE_BADGES[fx.state]} />
      </div>
      <dl className="details">
        <div className="details__item">
          <dt>是否过期</dt>
          <dd>{fx.state === "fresh" ? "没有过期，跨币种报价照常" : fx.state === "stale" ? "已过期（超过 48 小时没有更新），跨币种报价已暂停" : "还没有汇率，跨币种报价都报不出"}</dd>
        </div>
        <div className="details__item">
          <dt>这批汇率的时间（数据源给的）</dt>
          <dd>{when(fx.as_of)}</dd>
        </div>
        <div className="details__item">
          <dt>最近一次拉取</dt>
          <dd>
            {fx.last_attempt_status === null ? (
              "还没有拉过"
            ) : (
              <span className="fx-attempt">
                <span>{when(fx.last_attempt_at)}</span>
                <StatusBadge {...FX_FETCH_BADGES[fx.last_attempt_status]} />
                {reason !== null && <span className="fx-attempt__detail">{reason}</span>}
              </span>
            )}
          </dd>
        </div>
        <div className="details__item">
          <dt>定时拉取</dt>
          <dd>{fx.auto_fetch ? "已打开（每天自动拉取）" : "没有打开，只能在汇率页手动拉取"}</dd>
        </div>
      </dl>
      <p>
        <Link className="link" to={FX_PATH}>
          看汇率和拉取记录
        </Link>
      </p>
    </section>
  );
}

export function IntegrationsPage() {
  const { portal, account, token, handleAuthFailure } = usePortalSession();
  useDocumentTitle(`系统状态 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("integration.read");
  // 不自动刷新：只在进来时和点「重新检查」时请求（每次请求都会写一条审计日志）
  const loaded = useLoad<{ items: IntegrationStatus[]; fx_center: FxCenterStatus }>("integrations", canRead ? listIntegrations : null);
  const [announce, setAnnounce] = useState("");
  const [rechecking, setRechecking] = useState(false);
  const [recheckFailed, setRecheckFailed] = useState<string | null>(null);
  const items = loaded.state.data?.items ?? null;
  const fx = loaded.state.data?.fx_center ?? null;
  const missing = (items ?? []).filter((item) => item.state === "missing");
  /** 首次加载失败时走列表自己的「重试」；已经有结果以后的「重新检查」在这里请求，等应答回来才换结果、才播报 */
  const recheck = async (): Promise<void> => {
    if (rechecking) return;
    if (loaded.state.data === null) return loaded.reload();
    setRechecking(true);
    setAnnounce("");
    setRecheckFailed(null);
    try {
      const fresh = await listIntegrations(token);
      loaded.set(fresh);
      setAnnounce(`已重新检查，${fresh.items.filter((item) => item.state === "missing").length} 项未配置`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setRecheckFailed(err instanceof ApiError && err.status === 403 ? "你没有权限查看系统状态。需要的话，请联系管理员开通。" : failureText(err, "检查"));
    } finally {
      setRechecking(false);
    }
  };

  const shell = (content: ReactNode, action?: ReactNode): ReactNode => (
    <AppShell pageName="系统状态" trail={TRAIL}>
      <Page title="系统状态" width="form" {...(action ? { action } : {})}>
        {content}
      </Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(NO_ACCESS);

  const columns: Column<IntegrationStatus>[] = [
    { key: "label", header: "项目", cell: (row) => row.label },
    { key: "state", header: "状态", cell: (row) => <StatusBadge tone={row.state === "configured" ? "success" : "warning"} label={row.state === "configured" ? "已配置" : "未配置"} /> },
    { key: "detail", header: "说明", wrap: true, cell: (row) => (row.detail === "" ? "—" : <span className="product-code integration-detail">{row.detail}</span>) },
  ];
  const state = loaded.state;
  const tableState: TableState = !canRead ? "loading" : state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.data !== null ? "ready" : state.status === "loading" ? "loading" : "error";
  return shell(
    <>
      <p className="page-intro">这里只显示各项配好了没有，以及打过码的信息；看不到密钥原文。每次打开这一页都会记入审计日志。</p>
      <div role="status" className="visually-hidden">
        {announce}
      </div>
      <div role="alert">
        {recheckFailed !== null && (
          <Alert kind="danger">
            <strong className="alert__title">没有检查成功。</strong>
            <span>{`${recheckFailed}下面是上一次检查的结果。`}</span>
          </Alert>
        )}
      </div>
      {missing.length > 0 && (
        <Alert kind="warning">
          <strong className="alert__title">{`有 ${missing.length} 项还没有配置`}</strong>
          <span>
            {`：${missing.map((item) => item.label).join("、")}。用到它们的功能现在不能用。配置要由技术在服务器上做；`}
            <strong>密钥只能由负责人本人填进各平台的设置页面，不要发在聊天里。</strong>
          </span>
        </Alert>
      )}
      {fx?.state === "stale" && (
        <Alert kind="danger">
          <strong className="alert__title">汇率超过 48 小时没有更新，跨币种报价已暂停</strong>
          <span>{`现在这批汇率是 ${when(fx.as_of)} 的。请到汇率页检查数据源，或立即拉取一次。`}</span>
          <Link to={FX_PATH}>去汇率页处理</Link>
        </Alert>
      )}
      <div className="card-table">
        <DataTable label="系统状态" columns={columns} rows={items ?? []} rowKey={(row) => row.key} state={tableState} refreshing={state.status === "loading" && state.data !== null} onRetry={loaded.reload} empty={<StateBlock tone="neutral" title="没有可以检查的项目" />} />
      </div>
      {fx !== null && <FxCenterCard fx={fx} />}
    </>,
    <Button
      loading={rechecking}
      loadingText="检查中…"
      onClick={() => void recheck()}
    >
      <Icon name="refresh" />
      重新检查
    </Button>,
  );
}
