/**
 * 运营后台「共享区域去重」（M8-31b，ADR 0083 补充；docs/design/pages/master-data.md 第 13 节）：
 * 选一个城市，列出共享库里的全部区域（含已隐藏的），每行写疑似重复（同名、营运区重叠）和被引用的副本数；
 * 「标为重复」= 在共享库里隐藏这一份，以后引用它的改为引用选中的那份；「撤销」恢复。不改任何供应商的区域和报价。
 * 看要 `master_data.read`；标记、撤销要 `master_data.manage`（没有时不显示按钮）。
 */
import { type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type { ApiError } from "../../api/client.ts";
import { type FilterableCity, listFilterCityOptions } from "../../api/city-options.ts";
import { type PlatformSharedArea, listPlatformSharedAreas, markSharedAreaDuplicate, unmarkSharedAreaDuplicate } from "../../api/shared-area-duplicates.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { type Column, DataTable, type TableState } from "../../components/DataTable.tsx";
import { FilterBar, SearchBox } from "../../components/FilterBar.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { NoteDialog } from "../../components/NoteDialog.tsx";
import { StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { useToast } from "../../components/Toast.tsx";
import { displayName, formatLocalDateTime } from "../../lib/master-display.ts";
import { DUPLICATE_ERROR_TEXT, SIMILARITY_TEXT, keepOptions } from "../../lib/shared-area-duplicates.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { usePlatformCan } from "../../lib/use-master-access.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pending = { kind: "mark"; area: PlatformSharedArea } | { kind: "unmark"; area: PlatformSharedArea } | null;

export function SharedAreaDuplicatesPage() {
  const { portal, account, token } = usePortalSession();
  useDocumentTitle(`共享区域去重 · NOZOMI ${portal.name}`);
  const canRead = usePlatformCan("master_data.read");
  const canManage = usePlatformCan("master_data.manage");
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const cityParam = params.get("city");
  const city = cityParam !== null && UUID_PATTERN.test(cityParam) ? cityParam.toLowerCase() : null;
  const q = params.get("q") ?? "";
  const setParam = (name: string, value: string | null): void => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };

  const cities = useLoad<{ items: FilterableCity[] }>("shared-area-cities", canRead ? listFilterCityOptions : null);
  const { state, reload } = useLoad(`shared-areas:${city ?? ""}:${q}`, canRead && city !== null ? (token) => listPlatformSharedAreas(token, city, q) : null);
  // 疑似重复、保留的那份要在全城里找名字：带关键字时另取一次全城的（没有关键字时就是同一份）
  const whole = useLoad(`shared-areas-all:${city ?? ""}`, canRead && city !== null && q !== "" ? (token) => listPlatformSharedAreas(token, city, "") : null);
  const [pending, setPending] = useState<Pending>(null);
  const [keepId, setKeepId] = useState("");

  const cityOptions = useMemo(() => (cities.state.data?.items ?? []).map((entry) => ({ value: entry.id, label: `${displayName(entry.name).text}${entry.status === "disabled" ? "（已停用）" : ""}`, detail: entry.code, keywords: Object.values(entry.name).join(" ") })), [cities.state.data]);
  const all = (q === "" ? state.data?.items : whole.state.data?.items) ?? state.data?.items ?? [];
  const nameOf = (id: string): string => {
    const found = all.find((item) => item.id === id);
    return found ? `「${displayName(found.name).text}」` : `区域 ${id.slice(0, 8)}`;
  };

  const shell = (content: ReactNode): ReactNode => (
    <AppShell pageName="共享区域去重" trail={[{ label: "主数据" }]}>
      <Page title="共享区域去重">{content}</Page>
    </AppShell>
  );
  if (account.status === "ready" && !canRead) return shell(<StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通「主数据 · 查看」。" />);

  const columns: Column<PlatformSharedArea>[] = [
    {
      key: "name",
      header: "区域",
      wrap: true,
      cell: (row) => (
        <span className="table__names">
          <span>{displayName(row.name).text}</span>
          <span className="table__other-names">{`营运区 ${row.operate_polygon_count} 块 · 禁行区 ${row.forbid_polygon_count} 块 · 第 ${row.shape_version} 版 · ${formatLocalDateTime(row.updated_at)} 修改`}</span>
        </span>
      ),
    },
    { key: "copies", header: "被引用", align: "end", cardLabel: true, cell: (row) => `${row.copy_count} 份` },
    {
      key: "status",
      header: "状态",
      wrap: true,
      cell: (row) =>
        row.duplicate === null ? (
          <StatusBadge tone="success" label="在库里" />
        ) : (
          <span className="table__names">
            <StatusBadge tone="neutral" label="已隐藏" />
            <span className="table__other-names">{`以后的引用指向${row.duplicate.keep_area_name === null ? `区域 ${row.duplicate.keep_area_id.slice(0, 8)}` : `「${displayName(row.duplicate.keep_area_name).text}」`}`}</span>
            <span className="table__other-names">{`${row.duplicate.marked_by.name} ${formatLocalDateTime(row.duplicate.marked_at)}：${row.duplicate.reason}`}</span>
            {!row.duplicate.keep_area_listed && <span className="field__hint field__hint--warning">保留的那份已不在共享库里，现在引用这一份会失败，请撤销</span>}
          </span>
        ),
    },
    {
      key: "similar",
      header: "疑似重复",
      wrap: true,
      cell: (row) =>
        row.similar.length === 0 ? (
          <span className="table__muted">没有</span>
        ) : (
          row.similar.map((entry) => `${nameOf(entry.id)}（${entry.reasons.map((reason) => SIMILARITY_TEXT[reason]).join("、")}）`).join("；")
        ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "操作",
            cell: (row: PlatformSharedArea) => {
              if (row.duplicate === null) {
                // 同城没有别的可保留的（只有它一份，或别的都已隐藏）：不能标
                const first = keepOptions(row, all)[0];
                return first === undefined ? (
                  <span className="table__muted">同城没有别的区域</span>
                ) : (
                  <Button
                    variant="text"
                    size="sm"
                    aria-label={`标为重复：${displayName(row.name).text}`}
                    onClick={() => {
                      setKeepId(first.id);
                      setPending({ kind: "mark", area: row });
                    }}
                  >
                    标为重复
                  </Button>
                );
              }
              return (
                <Button variant="text" size="sm" aria-label={`撤销：${displayName(row.name).text}`} onClick={() => setPending({ kind: "unmark", area: row })}>
                  撤销
                </Button>
              );
            },
          },
        ]
      : []),
  ];

  const tableState: TableState = state.status === "ready" ? "ready" : state.status === "forbidden" ? "forbidden" : state.status === "loading" ? "loading" : "error";
  const describe = (err: ApiError): string | null => DUPLICATE_ERROR_TEXT[err.code] ?? null;
  const done = (text: string): void => {
    setPending(null);
    toast(text);
    reload();
    whole.reload();
  };

  return shell(
    <>
      <p className="page-intro">
        共享库是各供应商启用中的原创区域，供应商新建区域时可以直接引用。同一块区域被几家各画了一份时，把多出来的一份「标为重复」：它从共享库里隐藏，以后引用它的改为引用你选的那份。
        不改任何供应商自己的区域、已经引用的副本和报价；随时可以撤销。
      </p>
      <FilterBar search={<SearchBox label="按名称搜索" value={q} onSearch={(value) => setParam("q", value)} />} paramNames={["city"]} active={city !== null || q !== ""} onClear={() => setParams(new URLSearchParams(), { replace: true })}>
        <Combobox
          inline
          label="城市"
          placeholder="先选城市"
          options={cityOptions}
          value={city}
          onChange={(value) => setParam("city", value)}
          loading={cities.state.data === null && cities.state.status === "loading"}
          loadFailed={cities.state.data === null && cities.state.status === "error"}
        />
      </FilterBar>
      {city === null ? (
        <StateBlock tone="neutral" title="先选一个城市" description="共享库按城市列出，疑似重复只在同一个城市里找。" />
      ) : (
        <>
          {state.data?.truncated && <Alert kind="warning">这个城市的共享区域超过 500 个，只列出了最近修改的 500 个。</Alert>}
          <div className="card-table">
            <DataTable
              label="共享区域"
              columns={columns}
              rows={state.data?.items ?? []}
              rowKey={(row) => row.id}
              state={tableState}
              refreshing={state.status === "loading" && state.data !== null}
              onRetry={reload}
              empty={<StateBlock tone="neutral" title={q === "" ? "这个城市的共享库里还没有区域" : "没有名称符合的区域"} description={q === "" ? "供应商在这个城市新建区域后会自动出现在这里。" : "换个名称试试，或清空搜索。"} />}
            />
          </div>
        </>
      )}
      {pending?.kind === "mark" && (
        <NoteDialog
          title={`把「${displayName(pending.area.name).text}」标为重复`}
          intro="这一份会从共享库里隐藏，以后供应商引用它时改为引用下面选的那份。它在自己供应商那里照常可用；已经引用它的副本和所有报价都不变。"
          label="原因"
          hint="写清为什么是重复，会记进审计日志"
          maxLength={500}
          confirmText="标为重复"
          busyText="正在标记…"
          action="标记"
          describe={describe}
          onClose={() => setPending(null)}
          onSubmit={async (reason) => {
            await markSharedAreaDuplicate(token, pending.area.id, { keep_area_id: keepId, reason });
            done(`已把「${displayName(pending.area.name).text}」标为重复，以后的引用指向${nameOf(keepId)}`);
          }}
        >
          <SelectField
            label="保留哪一份"
            required
            hint="疑似重复的排在前面"
            value={keepId}
            options={keepOptions(pending.area, all).map((option) => ({ value: option.id, label: option.label }))}
            onChange={setKeepId}
          />
        </NoteDialog>
      )}
      {pending?.kind === "unmark" && (
        <NoteDialog
          title={`撤销「${displayName(pending.area.name).text}」的重复标记`}
          intro="撤销后它重新出现在共享库里，以后引用它的照常引用它。标记期间已经转去引用另一份的副本不变。"
          label="原因"
          required={false}
          maxLength={500}
          confirmText="撤销"
          busyText="正在撤销…"
          action="撤销"
          describe={describe}
          onClose={() => setPending(null)}
          onSubmit={async (reason) => {
            await unmarkSharedAreaDuplicate(token, pending.area.id, reason === "" ? null : reason);
            done(`已撤销，「${displayName(pending.area.name).text}」重新出现在共享库里`);
          }}
        />
      )}
    </>,
  );
}
