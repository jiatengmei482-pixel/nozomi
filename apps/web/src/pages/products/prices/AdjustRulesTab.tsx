/**
 * 「调价规则」页签的列表（docs/design/pages/tenant-prices.md 5.1、5.2、5.7、5.8）。
 * 顺序就是先后：只靠「上移」「下移」，动过以后要点「保存顺序」；启用 / 停用、删除立即生效。
 */
import { adjustRuleCoversPrice, adjustRuleIsUnusual, applyAdjustRules, applyAdjustSteps, basePrice, compareExact } from "@nozomi/domain";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { type AdjustRuleBody, deleteAdjustRule, saveAdjustRuleOrder, setAdjustRuleStatus } from "../../../api/prices.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../../components/Alert.tsx";
import { Button, IconButton, LinkButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Dropdown } from "../../../components/Dropdown.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { StatusBadge } from "../../../components/StatusBadge.tsx";
import { useToast } from "../../../components/Toast.tsx";
import { cycleText, exactMoneyText, firstAndCount, reachWarning, ruleFromBody, slotText, stepsText, travelText, tripDirectionsText } from "../../../lib/adjust-form.ts";
import { displayName } from "../../../lib/master-display.ts";
import { type PriceContext, activePriceRules, directionName, isStationPlace } from "../../../lib/price-form.ts";
import { moneyText } from "../../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText, serverIssues } from "../../../lib/product-failure.ts";
import { pricePath, productPath } from "../../../lib/product-paths.ts";
import { useLeaveGuard } from "../../../lib/use-leave-guard.ts";
import { focusAnchor } from "../frame.ts";
import type { PricesShared } from "./PricesStep.tsx";

interface ListNotice {
  kind: AlertKind;
  title?: string;
  text: string;
  action?: ReactNode;
}

type Confirm = { kind: "toggle"; rule: AdjustRuleBody; action: "enable" | "disable" } | { kind: "unusual"; rule: AdjustRuleBody; label: string; from: string; to: string; change: string } | { kind: "delete"; rule: AdjustRuleBody };

const linkId = (id: string): string => `adjust-rule-${id}`;

/** 后端说「调完不大于 0」：返回有几条价格；不是这个原因返回 null。 */
export function nonPositiveCount(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  const issue = serverIssues(err).find((entry) => entry.reason === "ADJUST_RESULT_NOT_POSITIVE");
  if (!issue && err.code !== "ADJUST_RESULT_NOT_POSITIVE") return null;
  const count = issue?.detail["count"] ?? err.details["count"];
  return typeof count === "number" ? count : 0;
}

export function AdjustRulesTab({ shared, loadStatus }: { shared: PricesShared; loadStatus: string }) {
  const { frame, product, prices, adjusts } = shared;
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const readOnly = frame.readOnly;
  const published = product.status === "published";
  const station = isStationPlace(product.poi?.type);
  const currency = prices.currency;
  const [order, setOrder] = useState<string[] | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [notice, setNotice] = useState<ListNotice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [working, setWorking] = useState<"order" | "confirm" | string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const savedId = typeof (location.state as { savedRule?: unknown } | null)?.savedRule === "string" ? (location.state as { savedRule: string }).savedRule : null;
  const [highlight, setHighlight] = useState<string | null>(savedId);

  const items = adjusts?.items ?? [];
  const loaded = adjusts !== null;
  const live = useMemo(() => items.filter((rule) => !rule.ended), [items]);
  const ended = useMemo(() => items.filter((rule) => rule.ended), [items]);
  const liveIds = live.map((rule) => rule.id).join(",");
  const ordered = useMemo(() => {
    if (order === null || [...order].sort().join(",") !== live.map((rule) => rule.id).sort().join(",")) return live;
    return order.flatMap((id) => live.filter((rule) => rule.id === id));
  }, [order, live]);
  const moved = ordered.map((rule) => rule.id).join(",") !== liveIds;
  const context: PriceContext = { category: product.category, currency, today: prices.today, station };
  const active = useMemo(() => activePriceRules(prices.items, context).map((entry) => entry.rule), [prices.items, prices.today, currency]);

  useLeaveGuard(moved && working === null, setLeaving);

  // 刚新建 / 保存完回来：把那一行标出来 2 秒，焦点落到它的名称上
  useEffect(() => {
    if (savedId === null || !loaded) return;
    focusAnchor(linkId(savedId));
    const timer = setTimeout(() => setHighlight(null), 2000);
    return () => clearTimeout(timer);
  }, [savedId, loaded]);

  const areaName = (id: string): string => {
    const area = product.areas.find((entry) => entry.area_id === id);
    return area ? displayName(area.name).text : "已不在这个商品里的区域";
  };
  const groupName = (id: string): string => {
    const group = product.vehicle_groups.find((entry) => entry.vehicle_group_id === id);
    return group ? displayName(group.name).text : "已不在这个商品里的车型组";
  };

  /** 去价格日历：月份是这条规则开始的那个月（已经开始的去本月），组合是它适用的第一个。 */
  const calendarLink = (rule: AdjustRuleBody): string => {
    const start = rule.cycle.type === "dates" ? ([...rule.cycle.dates].sort().find((date) => date >= prices.today) ?? null) : rule.travel_from;
    const query = new URLSearchParams();
    const area = rule.area_ids.find((id) => product.areas.some((entry) => entry.area_id === id));
    const group = rule.vehicle_group_ids.find((id) => product.vehicle_groups.some((entry) => entry.vehicle_group_id === id));
    if (area !== undefined || group !== undefined) {
      query.set("area", area ?? product.areas[0]?.area_id ?? "");
      query.set("vg", group ?? product.vehicle_groups[0]?.vehicle_group_id ?? "");
    }
    if (rule.directions.length === 1 && rule.directions[0] === "dropoff") query.set("dir", "dropoff");
    if (rule.package_hours[0] !== undefined) query.set("pkg", String(rule.package_hours[0]));
    if (rule.time_slot !== null) query.set("time", rule.time_slot.start);
    if (start !== null && start.slice(0, 7) > prices.today.slice(0, 7)) query.set("month", start.slice(0, 7));
    const search = query.toString();
    return `${pricePath(product.id, "calendar")}${search === "" ? "" : `?${search}`}`;
  };

  const failed = (err: unknown, what: string, rule?: AdjustRuleBody): void => {
    if (handleAuthFailure(err)) return;
    const count = nonPositiveCount(err);
    if (count !== null && rule) {
      return setNotice({
        kind: "danger",
        title: "没有启用。",
        text: count > 0 ? `按现在的价格算，这条规则有 ${count} 条价格调完不大于 0。请先改这条规则。` : "按现在的价格算，这条规则有价格调完不大于 0。请先改这条规则。",
        action: (
          <Link className="link" to={pricePath(product.id, "adjust", `/${rule.id}`)}>
            去修改
          </Link>
        ),
      });
    }
    if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
      frame.refresh();
      shared.reloadAdjusts();
      return setNotice({ kind: "warning", title: `这个商品刚被别人修改过，${what}。`, text: "已经载入最新的内容，请再试一次。" });
    }
    if (err instanceof ApiError && err.code === "CONCURRENT_UPDATE") return setNotice({ kind: "warning", text: `同时有其他人在修改相关的数据，${what}。请再试一次。` });
    if (err instanceof ApiError && err.code === "PUBLISH_CHECK_FAILED") return setNotice({ kind: "danger", title: `${what}。`, text: "这个商品已上架，改成这样就不满足上架的条件了。" });
    if (err instanceof ApiError && err.status === 403) return setNotice({ kind: "danger", text: PRODUCT_FORBIDDEN_TEXT });
    if (err instanceof ApiError && err.status === 404) {
      shared.reloadAdjusts();
      return setNotice({ kind: "warning", title: "找不到这条调价规则，它可能已被别人删除。", text: "已经载入最新的列表。" });
    }
    setNotice({ kind: "danger", text: saveFailureText(err, what.replace(/^(顺序)?没有/, "")) });
  };

  const toggle = async (rule: AdjustRuleBody, action: "enable" | "disable", viaConfirm: boolean): Promise<void> => {
    if (working !== null || adjusts === null) return;
    setWorking(viaConfirm ? "confirm" : rule.id);
    setNotice(null);
    try {
      const result = await setAdjustRuleStatus(token, product.id, rule.id, action);
      shared.setAdjusts({ ...adjusts, version: result.version, items: adjusts.items.map((entry) => (entry.id === rule.id ? result.adjust_rule : entry)) });
      frame.saved(result.version);
      toast(action === "enable" ? `已启用「${rule.name}」` : `已停用「${rule.name}」`);
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      failed(err, action === "enable" ? "没有启用" : "没有停用", rule);
    } finally {
      setWorking(null);
    }
  };

  const requestToggle = (rule: AdjustRuleBody): void => {
    const action = rule.status === "enabled" ? "disable" : "enable";
    if (action === "enable") {
      const domainRule = ruleFromBody(rule);
      const price = active.find((entry) => adjustRuleCoversPrice(domainRule, entry) && adjustRuleIsUnusual(domainRule, [basePrice(entry.pricing, {}, entry.packageHours)]));
      if (price) {
        const base = basePrice(price.pricing, {}, price.packageHours);
        const after = applyAdjustSteps(base, rule.steps).result;
        // 差额用同一个函数取整后的数（只为了把话说完整）
        const delta = applyAdjustRules(base, [{ steps: rule.steps }], 1).adjustMinor;
        const variant = price.direction !== null ? directionName(price.direction, station) : price.packageHours !== null ? `${price.packageHours} 小时` : null;
        return setConfirm({
          kind: "unusual",
          rule,
          label: [areaName(price.areaId), groupName(price.vehicleGroupId), variant].filter((part) => part !== null).join(" · "),
          from: exactMoneyText(base, currency),
          to: exactMoneyText(after, currency),
          change: delta === null ? "" : `${compareExact(after, base) > 0 ? "上调" : "下调"}了约 ${moneyText(Math.abs(delta), currency)}`,
        });
      }
    }
    if (published) return setConfirm({ kind: "toggle", rule, action });
    void toggle(rule, action, false);
  };

  const remove = async (rule: AdjustRuleBody): Promise<void> => {
    if (working !== null || adjusts === null) return;
    setWorking("confirm");
    setNotice(null);
    try {
      const result = await deleteAdjustRule(token, product.id, rule.id, frame.version);
      const index = ordered.findIndex((entry) => entry.id === rule.id);
      const nextFocus = ordered[index + 1]?.id ?? null;
      shared.setAdjusts({ ...adjusts, version: result.version, items: adjusts.items.filter((entry) => entry.id !== rule.id) });
      if (order !== null) setOrder(order.filter((id) => id !== rule.id));
      frame.saved(result.version);
      toast(`已删除调价规则「${rule.name}」`);
      setConfirm(null);
      requestAnimationFrame(() => focusAnchor(nextFocus !== null ? linkId(nextFocus) : "adjust-new"));
    } catch (err) {
      setConfirm(null);
      failed(err, "没有删除", rule);
    } finally {
      setWorking(null);
    }
  };

  const move = (rule: AdjustRuleBody, delta: -1 | 1): void => {
    const ids = ordered.map((entry) => entry.id);
    const from = ids.indexOf(rule.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setOrder(ids);
    setAnnounce(`${rule.name} 现在排第 ${to + 1}，共 ${ids.length} 条`);
    requestAnimationFrame(() => {
      const button = document.getElementById(`adjust-move-${delta === -1 ? "up" : "down"}-${rule.id}`);
      if (button instanceof HTMLButtonElement && !button.disabled) button.focus();
      else focusAnchor(`adjust-move-${delta === -1 ? "down" : "up"}-${rule.id}`);
    });
  };

  const saveOrder = async (then: string | null): Promise<void> => {
    if (working !== null || adjusts === null) return;
    setWorking("order");
    setNotice(null);
    // 接口要的是全部规则：已结束的不参与排序，留在原来的位置
    const queue = ordered.map((rule) => rule.id);
    const ids = adjusts.items.map((rule) => (rule.ended ? rule.id : (queue.shift() ?? rule.id)));
    try {
      const result = await saveAdjustRuleOrder(token, product.id, frame.version, ids);
      shared.setAdjusts(result);
      setOrder(null);
      frame.saved(result.version);
      toast("已保存顺序");
      if (then !== null) void navigate(then);
    } catch (err) {
      const mismatch = err instanceof ApiError && (err.code === "IDS_MISMATCH" || serverIssues(err).some((issue) => issue.reason === "IDS_MISMATCH"));
      if (mismatch) {
        setOrder(null);
        shared.reloadAdjusts();
        setNotice({ kind: "warning", title: "调价规则刚被别人改过，顺序没有保存。", text: "已经载入最新的列表，请重新排一下。" });
      } else failed(err, "顺序没有保存");
    } finally {
      setWorking(null);
    }
  };

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, rule: AdjustRuleBody): void => {
    if (!event.altKey || readOnly || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(rule, event.key === "ArrowUp" ? -1 : 1);
  };

  const intro = (
    <div className="adjust-intro">
      <p className="adjust-intro__text">
        调价规则可以不设。设了以后，命中的日子会在基础价上再调一次。
        <br />
        同一天命中好几条时，从上到下依次算：后一条在前一条算完的结果上接着算。
      </p>
      {!readOnly && loaded && items.length > 0 && (
        <LinkButton variant="primary" to={pricePath(product.id, "adjust", "/new")} id="adjust-new">
          <Icon name="plus" />
          新建调价规则
        </LinkButton>
      )}
    </div>
  );

  if (!loaded) {
    return (
      <>
        {intro}
        <section className="card">
          {loadStatus === "error" ? (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={shared.reloadAdjusts}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton lines={["long", "long", "long"]} />
          )}
        </section>
      </>
    );
  }

  const row = (rule: AdjustRuleBody, index: number | null): ReactNode => {
    const domainRule = ruleFromBody(rule);
    const areas = rule.area_ids.map(areaName);
    const groups = rule.vehicle_group_ids.map(groupName);
    const warning = rule.status === "enabled" && !rule.ended ? reachWarning(domainRule, active) : null;
    const busy = working !== null;
    const scope = product.category === "airport_transfer" ? tripDirectionsText(rule.directions, station) : product.category === "charter" ? (rule.package_hours.length === 0 ? "全部套餐" : rule.package_hours.map((hours) => `${hours} 小时`).join("、")) : null;
    return (
      <tr key={rule.id} className={highlight === rule.id ? "adjust-table__row adjust-table__row--saved" : "adjust-table__row"} onKeyDown={(event) => index !== null && onRowKey(event, rule)}>
        <td className="adjust-table__order" data-label="顺序">
          {index === null ? (
            "—"
          ) : (
            <>
              <span className="adjust-table__number">{index + 1}</span>
              {!readOnly && (
                <>
                  <IconButton icon="arrow-up" label={`上移 ${rule.name}`} id={`adjust-move-up-${rule.id}`} disabled={busy || index === 0} onClick={() => move(rule, -1)} />
                  <IconButton icon="arrow-down" label={`下移 ${rule.name}`} id={`adjust-move-down-${rule.id}`} disabled={busy || index === ordered.length - 1} onClick={() => move(rule, 1)} />
                </>
              )}
            </>
          )}
        </td>
        <th scope="row" className="adjust-table__name">
          <Link className="link" id={linkId(rule.id)} to={pricePath(product.id, "adjust", `/${rule.id}`)}>
            {rule.name}
          </Link>
          {rule.ended && <StatusBadge tone="neutral" label="已结束" />}
          {warning !== null && (
            <span className="adjust-warning">
              <Icon name="alert-triangle" />
              {warning}
            </span>
          )}
        </th>
        <td data-label="什么时候">
          <span className="adjust-table__line">{rule.cycle.type === "dates" ? cycleText(rule.cycle) : travelText(rule.travel_from, rule.travel_to)}</span>
          <span className="adjust-table__line adjust-table__line--sub">{rule.cycle.type === "dates" ? slotText(rule.time_slot) : `${cycleText(rule.cycle)} · ${slotText(rule.time_slot)}`}</span>
        </td>
        <td data-label="对哪些">
          <span className="adjust-table__line" title={[...areas, ...groups].join("、") || undefined}>{`${areas.length === 0 ? "全部区域" : firstAndCount(areas)} · ${groups.length === 0 ? "全部车型组" : firstAndCount(groups)}`}</span>
          {scope !== null && <span className="adjust-table__line adjust-table__line--sub">{scope}</span>}
        </td>
        <td data-label="怎么调">
          {stepsText(rule.steps, currency).map((text, step) => (
            <span key={step} className="adjust-table__line">
              {text}
            </span>
          ))}
        </td>
        <td data-label="启用">
          {readOnly ? (
            rule.status === "enabled" ? "已启用" : "已停用"
          ) : (
            <label className="switch">
              <input type="checkbox" role="switch" className="switch__input" checked={rule.status === "enabled"} disabled={busy} aria-label={`启用 ${rule.name}`} onChange={() => requestToggle(rule)} />
              <span className="switch__track" aria-hidden="true" />
              <span className="switch__text">{rule.status === "enabled" ? "已启用" : "已停用"}</span>
            </label>
          )}
        </td>
        <td className="adjust-table__actions">
          <Link className="link" to={pricePath(product.id, "adjust", `/${rule.id}`)} aria-label={`${readOnly ? "查看" : "编辑"} ${rule.name}`}>
            {readOnly ? "查看" : "编辑"}
          </Link>
          {!readOnly && (
            <Dropdown buttonClassName="icon-button" buttonContent={<Icon name="more" />} label={`${rule.name} 的更多操作`}>
              <Link role="menuitem" className="menu-item" to={calendarLink(rule)}>
                <span className="menu-item__text">在价格日历里看</span>
              </Link>
              <Link role="menuitem" className="menu-item" to={pricePath(product.id, "adjust", "/new")} state={{ copyRule: rule.id }}>
                <span className="menu-item__text">复制一条</span>
              </Link>
              <button type="button" role="menuitem" className="menu-item menu-item--danger" disabled={busy} onClick={() => setConfirm({ kind: "delete", rule })}>
                <span className="menu-item__text">删除</span>
              </button>
            </Dropdown>
          )}
        </td>
      </tr>
    );
  };

  const noPrices = prices.items.length === 0;
  return (
    <>
      {intro}
      <div role="status" className="visually-hidden">
        {announce}
      </div>
      <div role="alert" className="step__alerts">
        {notice && (
          <Alert kind={notice.kind}>
            {notice.title && <strong className="alert__title">{notice.title}</strong>}
            <span>{notice.text}</span>
            {notice.action && <span className="alert__actions">{notice.action}</span>}
          </Alert>
        )}
      </div>
      {noPrices && <Alert kind="info">这个商品还没有价格。调价规则是在基础价上调的，先到「价格规则」页签把价格填上。</Alert>}
      {moved && <Alert kind="info">顺序改了，还没有保存。</Alert>}
      {items.length === 0 ? (
        <section className="card">
          <StateBlock
            tone="neutral"
            title="还没有调价规则"
            description="调价规则可以不设：不设的话，每天都按价格规则里的基础价报价。节假日、旺季、周末、夜里想调高或调低时再来建。"
            action={
              readOnly ? undefined : (
                <>
                  <LinkButton variant="primary" to={pricePath(product.id, "adjust", "/new")} id="adjust-new">
                    新建调价规则
                  </LinkButton>
                  {!noPrices && (
                    <LinkButton variant="text" to={pricePath(product.id, "calendar")}>
                      去价格日历上选日期
                    </LinkButton>
                  )}
                </>
              )
            }
          />
        </section>
      ) : (
        <section className="card adjust-list" aria-label="调价规则">
          {ordered.length === 0 && !showEnded ? (
            <p className="adjust-list__none">现在没有生效或将要生效的调价规则。</p>
          ) : (
            <div className="adjust-table__scroll" tabIndex={0} role="region" aria-label="调价规则列表">
              <table className="table adjust-table">
                <thead>
                  <tr>
                    <th scope="col">顺序</th>
                    <th scope="col">规则</th>
                    <th scope="col">什么时候</th>
                    <th scope="col">对哪些</th>
                    <th scope="col">怎么调</th>
                    <th scope="col">启用</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.length === 0 && (
                    <tr>
                      <td colSpan={7}>现在没有生效或将要生效的调价规则。</td>
                    </tr>
                  )}
                  {ordered.map((rule, index) => row(rule, index))}
                </tbody>
                {showEnded && ended.length > 0 && (
                  <tbody>
                    <tr>
                      <th scope="colgroup" colSpan={7} className="adjust-table__group">
                        已结束
                      </th>
                    </tr>
                    {ended.map((rule) => row(rule, null))}
                  </tbody>
                )}
              </table>
            </div>
          )}
          {ended.length > 0 && (
            <label className="choice adjust-list__ended">
              <input type="checkbox" checked={showEnded} onChange={(event) => setShowEnded(event.target.checked)} />
              <span className="choice__text">{`显示已结束的（${ended.length} 条）`}</span>
            </label>
          )}
        </section>
      )}
      <div className="form-bar step__bar">
        <span className="form-bar__note step__summary">{moved ? "顺序有未保存的修改" : published ? "已上架，启用、停用和删除约 1 分钟生效" : ""}</span>
        {moved ? (
          <>
            <Button variant="secondary" disabled={working !== null} onClick={() => setOrder(null)}>
              还原顺序
            </Button>
            <Button variant="primary" loading={working === "order"} loadingText="保存中…" disabled={working !== null && working !== "order"} onClick={() => void saveOrder(null)}>
              保存顺序
            </Button>
          </>
        ) : (
          <LinkButton variant="secondary" to={productPath(product.id, "inventory")}>
            下一步
          </LinkButton>
        )}
      </div>
      <Dialog
        open={confirm !== null}
        title={confirm === null ? "" : confirm.kind === "delete" ? `删除调价规则「${confirm.rule.name}」？` : confirm.kind === "unusual" ? "这条规则调得很多，确认保存？" : `${confirm.action === "enable" ? "启用" : "停用"}「${confirm.rule.name}」？`}
        busy={working === "confirm"}
        onClose={() => setConfirm(null)}
        footer={
          confirm === null ? undefined : (
            <>
              <Button variant="text" data-autofocus disabled={working !== null} onClick={() => setConfirm(null)}>
                {confirm.kind === "unusual" ? "回去检查" : "取消"}
              </Button>
              {confirm.kind === "delete" ? (
                <Button variant="danger" loading={working === "confirm"} loadingText="删除中…" onClick={() => void remove(confirm.rule)}>
                  删除
                </Button>
              ) : (
                <Button variant="primary" loading={working === "confirm"} loadingText={confirm.kind === "unusual" ? "保存中…" : confirm.action === "disable" ? "停用中…" : "启用中…"} onClick={() => void toggle(confirm.rule, confirm.kind === "toggle" ? confirm.action : "enable", true)}>
                  {confirm.kind === "unusual" ? "确认保存" : confirm.action === "enable" ? "启用" : "停用"}
                </Button>
              )}
            </>
          )
        }
      >
        {confirm?.kind === "delete" && <p>{`删除后不能恢复。${published ? "这个商品已上架，删除后大约 1 分钟生效。" : ""}只是暂时不用的话，可以停用。`}</p>}
        {confirm?.kind === "toggle" && <p>{`这个商品已上架，${confirm.action === "enable" ? "启用" : "停用"}后大约 1 分钟生效，之后的报价就会${confirm.action === "enable" ? "按这条规则调价" : "不再按这条规则调价"}。已经下的订单不受影响。`}</p>}
        {confirm?.kind === "unusual" && (
          <p>
            {`按「${confirm.label}」的价格算，${confirm.from} 会变成 `}
            <strong>{confirm.to}</strong>
            {confirm.change === "" ? "" : `（${confirm.change}）`}。如果是多敲了一个 0，请回去改。
          </p>
        )}
      </Dialog>
      <Dialog
        open={leaving !== null}
        title="顺序改了，还没有保存"
        busy={working === "order"}
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="text" data-autofocus disabled={working !== null} onClick={() => setLeaving(null)}>
              继续编辑
            </Button>
            <Button
              variant="secondary"
              className="button--danger-text"
              disabled={working !== null}
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                setOrder(null);
                if (to !== null) requestAnimationFrame(() => void navigate(to));
              }}
            >
              不保存
            </Button>
            <Button
              variant="primary"
              loading={working === "order"}
              loadingText="保存中…"
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                void saveOrder(to);
              }}
            >
              保存并继续
            </Button>
          </>
        }
      >
        <p>要先保存吗？</p>
      </Dialog>
    </>
  );
}
