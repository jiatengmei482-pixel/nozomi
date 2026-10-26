/** 订单中心、财务结算几个页面共用的小部件。 */
import type { ReactNode } from "react";
import { StateBlock } from "../../components/States.tsx";
import { formatLocalDateTime } from "../../lib/master-display.ts";

export const NO_ACCESS = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

/** 「标签：值」的一项（03-layout.md 第 2 节：详情里用 <dl>）。 */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="details__item">
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

/** 与操作有关的时间：查看者本地时区，`<time>` 带原始时刻。 */
export function LocalTime({ iso }: { iso: string | null }) {
  if (iso === null) return <>—</>;
  return <time dateTime={iso}>{formatLocalDateTime(iso)}</time>;
}

/** 列表在加载、出错、没权限时给 DataTable 的状态。 */
export function tableStateOf(status: string, hasData: boolean): "ready" | "forbidden" | "error" | "loading" {
  if (status === "ready") return "ready";
  if (status === "forbidden") return "forbidden";
  if (status === "loading") return hasData ? "ready" : "loading";
  return hasData ? "ready" : "error";
}
