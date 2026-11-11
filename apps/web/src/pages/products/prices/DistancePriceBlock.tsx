/**
 * 「价格规则」页签里的「计程价」小块（M8-30b，ADR 0080；接送机、点对点商品，供应商后台）。
 * 按车型组设「起步价 + 每公里」（结算价），生效日期、启停、新增 / 编辑 / 删除都立即保存（`/tenant/v1/products/{id}/distance-prices`）。
 * 不挂区域：两端都不在报价区域时按它报；只有一端在时，它的每公里单价也是区域外里程费的单价。规则 4：这里只有结算价。
 * 包车不显示（调用方判断）；运营后台没有这个接口，不显示。
 */
import { type FormEvent, useRef, useState } from "react";
import { ApiError } from "../../../api/client.ts";
import { type DistancePriceBody, type DistancePriceInput, type DistancePrices, createDistancePrice, deleteDistancePrice, listDistancePrices, setDistancePriceStatus, updateDistancePrice } from "../../../api/prices.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { useToast } from "../../../components/Toast.tsx";
import { displayName } from "../../../lib/master-display.ts";
import { amountText, moneyText, readAmount } from "../../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText, serverIssues } from "../../../lib/product-failure.ts";
import { tidyDate } from "../../../lib/time-input.ts";
import { useLoad } from "../../../lib/use-load.ts";
import type { ProductFrame } from "../frame.ts";

export const DISTANCE_PRICE_LEAD = "两端都不在报价区域时按计程价报价；只有一端在区域内时，区域外那段按这里的每公里单价收里程费；不设则这些情况不报价。";

type Field = "group" | "start" | "perKm" | "from" | "to";
interface Draft {
  id: string | null;
  group: string;
  start: string;
  perKm: string;
  from: string;
  to: string;
  status: DistancePriceBody["status"];
  errors: Partial<Record<Field, string>>;
  problem: string | null;
}

const PATH_FIELDS: Readonly<Record<string, Field>> = { "/vehicle_group_id": "group", "/start_price": "start", "/per_km": "perKm", "/valid_from": "from", "/valid_to": "to" };
const BOTH_ZERO = "起步价和每公里不能都是 0";

/** 后端 400 的原因 → 这一栏下面的中文（不显示原因代码） */
export function distanceIssueText(reason: string, path: string, detail: Record<string, unknown>, fallback: string): string {
  if (reason === "NOT_INTEGER") return "请填整数金额（按币种的最小单位）";
  if (reason === "OUT_OF_RANGE") return path === "/per_km" && detail["min"] === 1 ? BOTH_ZERO : "金额太大了，请检查是不是多打了几个零";
  if (reason === "INVALID_DATE") return "日期写法不对，例如 2026-12-01";
  if (reason === "DATE_RANGE_REVERSED") return "结束日期不能早于开始日期";
  if (reason === "VEHICLE_GROUP_NOT_IN_PRODUCT") return "只能选这个商品选了的车型组；车型组在第 ① 步改";
  return fallback;
}

/** 409 `DISTANCE_PRICE_CONFLICT`：撞上的那几条的生效日期 */
export function distanceConflictText(err: ApiError): string {
  const conflicts = Array.isArray(err.details["conflicts"]) ? (err.details["conflicts"] as { valid_from?: unknown; valid_to?: unknown }[]) : [];
  const ranges = conflicts.map((entry) => `${String(entry.valid_from ?? "")} 至 ${typeof entry.valid_to === "string" ? entry.valid_to : "一直有效"}`);
  return `这个车型组已经有计程价的生效日期和这段重叠${ranges.length > 0 ? `（${ranges.join("、")}）` : ""}，停用的也算。请改生效日期，或者先把那一条的结束日期改早。`;
}

const rangeText = (rule: Pick<DistancePriceBody, "valid_from" | "valid_to">): string => (rule.valid_to === null ? `${rule.valid_from} 起，一直有效` : `${rule.valid_from} 至 ${rule.valid_to}`);

export function DistancePriceBlock({ frame, currency, today }: { frame: ProductFrame; currency: string; today: string }) {
  const product = frame.product;
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const load = useLoad<DistancePrices>(product === null ? "distance-prices:none" : `distance-prices:${product.id}`, product === null ? null : (session) => listDistancePrices(session, product.id));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<DistancePriceBody | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: AlertKind; text: string } | null>(null);
  const sent = useRef<{ payload: string; key: string } | null>(null);
  if (product === null) return null;
  const readOnly = frame.readOnly;
  const groups = product.vehicle_groups.map((group) => ({ value: group.vehicle_group_id, label: displayName(group.name).text }));
  const groupName = (id: string): string => groups.find((group) => group.value === id)?.label ?? "已不在这个商品里的车型组";
  const data = load.state.data;
  const busy = working !== null;
  const money = (minor: number): string => moneyText(minor, currency);

  /** 列表上的出错（启停、删除）和表单里的出错共用：返回要显示的一句话；版本冲突时顺便重新载入 */
  const failureText = (err: unknown, what: string): string | null => {
    if (handleAuthFailure(err)) return null;
    if (err instanceof ApiError && err.code === "DISTANCE_PRICE_CONFLICT") return `${what}：${distanceConflictText(err)}`;
    if (err instanceof ApiError && err.code === "DISTANCE_PRICE_NOT_ALLOWED") return `${what}：只有接送机、点对点商品能设计程价。`;
    if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
      frame.refresh();
      load.reload();
      return `这个商品刚被别人修改过，${what}。已经载入最新的内容，请再试一次。`;
    }
    if (err instanceof ApiError && err.code === "CONCURRENT_UPDATE") return `同时有其他人在修改这个商品，${what}。请再试一次。`;
    if (err instanceof ApiError && err.status === 403) return PRODUCT_FORBIDDEN_TEXT;
    if (err instanceof ApiError && err.status === 404) {
      load.reload();
      return `找不到这条计程价，它可能已被别人删除，${what}。已经载入最新的列表。`;
    }
    return saveFailureText(err, what.replace(/^没有/, ""), true);
  };

  const applySaved = (version: number, next: DistancePriceBody[]): void => {
    load.set({ ...(data as DistancePrices), version, items: next });
    frame.saved(version);
  };

  const openNew = (): void => {
    setNotice(null);
    setDraft({ id: null, group: groups.length === 1 ? (groups[0]?.value ?? "") : "", start: "", perKm: "", from: data?.today ?? today, to: "", status: "enabled", errors: {}, problem: null });
  };
  const openEdit = (rule: DistancePriceBody): void => {
    setNotice(null);
    setDraft({ id: rule.id, group: rule.vehicle_group_id, start: amountText(rule.start_price, currency), perKm: amountText(rule.per_km, currency), from: rule.valid_from, to: rule.valid_to ?? "", status: rule.status, errors: {}, problem: null });
  };

  const readDraft = (form: Draft): { input: DistancePriceInput | null; errors: Partial<Record<Field, string>> } => {
    const errors: Partial<Record<Field, string>> = {};
    if (form.group === "") errors.group = "请选车型组";
    const amount = (field: "start" | "perKm"): number | null => {
      if (form[field].trim() === "") {
        errors[field] = field === "start" ? "请填起步价，不收起步价填 0" : "请填每公里单价";
        return null;
      }
      const read = readAmount(form[field], currency);
      if (!read.ok) {
        errors[field] = read.message;
        return null;
      }
      return read.minor;
    };
    const start = amount("start");
    const perKm = amount("perKm");
    if (start === 0 && perKm === 0) errors.perKm = BOTH_ZERO;
    const from = tidyDate(form.from);
    if (from === null) errors.from = "请填生效日期，例如 2026-12-01";
    const to = form.to.trim() === "" ? null : tidyDate(form.to);
    if (form.to.trim() !== "" && to === null) errors.to = "日期写法不对，例如 2026-12-31；一直有效就空着";
    else if (from !== null && to !== null && to < from) errors.to = "结束日期不能早于开始日期";
    if (Object.keys(errors).length > 0 || start === null || perKm === null || from === null) return { input: null, errors };
    return { input: { vehicle_group_id: form.group, start_price: start, per_km: perKm, valid_from: from, valid_to: to, status: form.status }, errors };
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (draft === null || busy || data === null) return;
    const { input, errors } = readDraft(draft);
    if (input === null) {
      setDraft({ ...draft, errors, problem: null });
      requestAnimationFrame(() => document.querySelector<HTMLElement>("#distance-form [aria-invalid=true]")?.focus());
      return;
    }
    setWorking("form");
    try {
      let saved;
      if (draft.id === null) {
        const payload = JSON.stringify(input);
        if (sent.current?.payload !== payload) sent.current = { payload, key: crypto.randomUUID() };
        saved = await createDistancePrice(token, product.id, frame.version, input, sent.current.key);
      } else saved = await updateDistancePrice(token, product.id, draft.id, frame.version, input);
      const row = saved.distance_price;
      applySaved(saved.version, row === null ? data.items : draft.id === null ? [...data.items, row] : data.items.map((entry) => (entry.id === row.id ? row : entry)));
      sent.current = null;
      toast(`${draft.id === null ? "已新增" : "已保存"}「${groupName(input.vehicle_group_id)}」的计程价`);
      setDraft(null);
    } catch (err) {
      const issues = serverIssues(err);
      if (issues.length > 0) {
        const next: Partial<Record<Field, string>> = {};
        for (const issue of issues) {
          const field = PATH_FIELDS[issue.path];
          if (field !== undefined) next[field] = distanceIssueText(issue.reason, issue.path, issue.detail, issue.message);
        }
        setDraft({ ...draft, errors: next, problem: Object.keys(next).length === 0 ? (issues[0]?.message ?? null) : null });
      } else {
        const text = failureText(err, draft.id === null ? "没有新增" : "没有保存");
        setDraft({ ...draft, errors: {}, problem: text });
      }
    } finally {
      setWorking(null);
    }
  };

  const toggle = async (rule: DistancePriceBody): Promise<void> => {
    if (busy || data === null) return;
    const action = rule.status === "enabled" ? "disable" : "enable";
    setWorking(rule.id);
    setNotice(null);
    try {
      const saved = await setDistancePriceStatus(token, product.id, rule.id, action);
      const row = saved.distance_price;
      applySaved(saved.version, row === null ? data.items : data.items.map((entry) => (entry.id === row.id ? row : entry)));
      toast(`${action === "enable" ? "已启用" : "已停用"}「${groupName(rule.vehicle_group_id)}」的计程价`);
    } catch (err) {
      const text = failureText(err, action === "enable" ? "没有启用" : "没有停用");
      if (text !== null) setNotice({ kind: "danger", text });
    } finally {
      setWorking(null);
    }
  };

  const remove = async (rule: DistancePriceBody): Promise<void> => {
    if (busy || data === null) return;
    setWorking("remove");
    try {
      const saved = await deleteDistancePrice(token, product.id, rule.id, frame.version);
      applySaved(saved.version, data.items.filter((entry) => entry.id !== rule.id));
      toast(`已删除「${groupName(rule.vehicle_group_id)}」的一条计程价`);
      setRemoving(null);
      requestAnimationFrame(() => document.getElementById("distance-new")?.focus());
    } catch (err) {
      setRemoving(null);
      const text = failureText(err, "没有删除");
      if (text !== null) setNotice({ kind: "danger", text });
    } finally {
      setWorking(null);
    }
  };

  const set = (patch: Partial<Draft>): void => setDraft((current) => (current === null ? current : { ...current, ...patch }));

  let body;
  if (data === null && load.state.status === "loading") body = <Skeleton lines={["long", "control"]} label="计程价加载中" />;
  else if (load.state.status === "forbidden") body = <StateBlock tone="neutral" headingLevel="h3" title="你没有权限查看计程价" description="需要的话，请联系你们的管理员开通。" />;
  else if (data === null) {
    body = (
      <StateBlock
        headingLevel="h3"
        title="计程价没有加载出来"
        description="请检查网络后重试。"
        action={
          <Button variant="primary" onClick={load.reload}>
            重试
          </Button>
        }
      />
    );
  } else if (data.items.length === 0) {
    body = <p className="distance-prices__empty">{readOnly ? "这个商品没有设计程价。" : "还没有设计程价。不设的话，两端都不在报价区域、或只有一端在的请求，这个商品不报价。"}</p>;
  } else {
    body = (
      <div className="adjust-table__scroll" tabIndex={0} role="region" aria-label="计程价列表">
        <table className="table adjust-table">
          <thead>
            <tr>
              <th scope="col">车型组</th>
              <th scope="col">{`起步价（${currency}）`}</th>
              <th scope="col">{`每公里（${currency}）`}</th>
              <th scope="col">生效日期</th>
              <th scope="col">启用</th>
              {!readOnly && (
                <th scope="col">
                  <span className="visually-hidden">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.items.map((rule) => {
              const name = groupName(rule.vehicle_group_id);
              const expired = rule.valid_to !== null && rule.valid_to < data.today;
              return (
                <tr key={rule.id} data-distance-price={rule.id}>
                  <th scope="row" className="adjust-table__name">
                    {name}
                  </th>
                  <td data-label="起步价" className="price">
                    {money(rule.start_price)}
                  </td>
                  <td data-label="每公里" className="price">
                    {money(rule.per_km)}
                  </td>
                  <td data-label="生效日期">
                    <span className="adjust-table__line">{rangeText(rule)}</span>
                    {expired && <span className="adjust-table__line adjust-table__line--sub">已过期</span>}
                  </td>
                  <td data-label="启用">
                    {readOnly ? (
                      rule.status === "enabled" ? "已启用" : "已停用"
                    ) : (
                      <label className="switch">
                        <input type="checkbox" role="switch" className="switch__input" checked={rule.status === "enabled"} disabled={busy} aria-label={`启用 ${name} 的计程价（${rangeText(rule)}）`} onChange={() => void toggle(rule)} />
                        <span className="switch__track" aria-hidden="true" />
                        <span className="switch__text">{rule.status === "enabled" ? "已启用" : "已停用"}</span>
                      </label>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="adjust-table__actions">
                      <Button variant="text" size="sm" disabled={busy} onClick={() => openEdit(rule)} aria-label={`编辑 ${name} 的计程价（${rangeText(rule)}）`}>
                        编辑
                      </Button>
                      <Button variant="text" size="sm" className="button--danger-text" disabled={busy} onClick={() => setRemoving(rule)} aria-label={`删除 ${name} 的计程价（${rangeText(rule)}）`}>
                        删除
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const editing = draft?.id !== null && draft !== null;
  return (
    <section className="card surcharge distance-prices" aria-labelledby="distance-title">
      <h3 className="surcharge__title" id="distance-title">
        计程价
      </h3>
      <p className="surcharge__lead">
        {DISTANCE_PRICE_LEAD}
        <br />
        {`按车型组设起步价和每公里单价（结算价，${currency}）：计程价 = 起步价 + 路线公里数 × 每公里，不足 1 公里按 1 公里。`}
      </p>
      <div role="alert" className="step__alerts">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      </div>
      {body}
      {!readOnly && data !== null && (
        <div>
          <Button id="distance-new" variant="secondary" disabled={busy || groups.length === 0} onClick={openNew}>
            新增计程价
          </Button>
        </div>
      )}
      <Dialog
        open={draft !== null}
        size="form"
        title={editing ? "编辑计程价" : "新增计程价"}
        busy={working === "form"}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="secondary" disabled={working === "form"} onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="distance-form" loading={working === "form"} loadingText="保存中…">
              {editing ? "保存" : "新增"}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="distance-form" className="form" noValidate onSubmit={(event) => void submit(event)}>
            {draft.problem !== null && (
              <div role="alert">
                <Alert kind="danger">{draft.problem}</Alert>
              </div>
            )}
            <SelectField label="车型组" value={draft.group} options={groups} placeholder="请选择" required errors={draft.errors.group ? [draft.errors.group] : []} onChange={(value) => set({ group: value })} />
            <TextField label={`起步价（${currency}）`} inputMode="decimal" autoComplete="off" data-autofocus value={draft.start} errors={draft.errors.start ? [draft.errors.start] : []} hint="不收起步价填 0" onChange={(event) => set({ start: event.target.value })} />
            <TextField label={`每公里（${currency}）`} inputMode="decimal" autoComplete="off" value={draft.perKm} errors={draft.errors.perKm ? [draft.errors.perKm] : []} hint="区域外里程费也按这个单价收" onChange={(event) => set({ perKm: event.target.value })} />
            <TextField label="生效日期 从" autoComplete="off" placeholder="2026-12-01" value={draft.from} errors={draft.errors.from ? [draft.errors.from] : []} hint="商品所在城市的当地日期，当天也算" onChange={(event) => set({ from: event.target.value })} />
            <TextField label="到（含这一天）" autoComplete="off" placeholder="空着 = 一直有效" value={draft.to} errors={draft.errors.to ? [draft.errors.to] : []} hint="同一个车型组的生效日期不能重叠" onChange={(event) => set({ to: event.target.value })} />
          </form>
        )}
      </Dialog>
      <Dialog
        open={removing !== null}
        title="删除这条计程价？"
        busy={working === "remove"}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button className="button--danger-text" loading={working === "remove"} loadingText="删除中…" onClick={() => removing !== null && void remove(removing)}>
              删除
            </Button>
          </>
        }
      >
        {removing && <p>{`「${groupName(removing.vehicle_group_id)}」起步价 ${money(removing.start_price)}、每公里 ${money(removing.per_km)}（${rangeText(removing)}）。删除后立即生效：这段日期里两端都不在报价区域、或只有一端在的请求，这个车型组不再报价。`}</p>}
      </Dialog>
    </section>
  );
}
