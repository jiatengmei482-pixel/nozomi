import { useMemo } from "react";
import { type Colleague, listColleagues } from "../api/order-center.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";
import { useLoad } from "./use-load.ts";

/**
 * 同事名单（`/platform/v1/colleagues`）：工单、异常、账单里的处理人、判定人只有编号，页面用它换成名字；转交时从在用的人里选。
 * 取不到时名字写「（同事）」，不影响别的。
 */
export function useColleagues(): { names: ReadonlyMap<string, string>; active: readonly Colleague[]; me: string | null } {
  const { account } = usePortalSession();
  const { state } = useLoad<{ items: Colleague[] }>("colleagues", account.status === "ready" ? listColleagues : null);
  const items = state.data?.items;
  return useMemo(
    () => ({
      names: new Map((items ?? []).map((item) => [item.id, item.active ? item.name : `${item.name}（已停用）`])),
      active: (items ?? []).filter((item) => item.active),
      me: account.status === "ready" ? account.account.id : null,
    }),
    [items, account],
  );
}
