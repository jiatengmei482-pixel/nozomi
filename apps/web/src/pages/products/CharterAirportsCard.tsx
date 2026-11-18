/**
 * 商品页「机场套餐」（M9P-22，ADR 0098 第三节第 2、8 小节）：包车、迁移过三层区域的商品，两组「机场开始」「机场结束」，
 * 每组一行一个机场：选机场（主数据）、选机场区域（本供应商的启用区域，业务类型不限）、可选中文简称；保存即整组替换，带商品版本号。
 * 供应商后台可以改（有改商品的权限时）；运营后台只读。没迁移过的商品这一块写「迁移三层区域后可用」。
 * 校验错误落到那一行那一格（页面先查必填 / 重复 / 长度，其余以后端为准，后端的 path 对回到行）。这一块单独保存，不跟第 ① 步的保存走。
 * 文案只有中文，全部走 charter-airport-copy.ts 的 key 表（M11-01）。
 */
import { useEffect, useRef, useState } from "react";
import type { AreaSummary } from "../../api/areas.ts";
import { type CharterAirportBinding, type CharterAirports, listAirportOptions, putCharterAirports } from "../../api/charter-airports.ts";
import { ApiError } from "../../api/client.ts";
import type { Place } from "../../api/master.ts";
import type { PriceRules } from "../../api/prices.ts";
import type { Product } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { type BindingDraft, type BindingField, type BindingProblem, MAX_AIRPORTS_PER_SCENARIO, SHORT_NAME_MAX, bindingDraftsOf, bindingFieldId, bindingInputs, bindingProblems, bindingsDirty, placeBindingIssues } from "../../lib/charter-airport-bindings.ts";
import { charterAirportText as t } from "../../lib/charter-airport-copy.ts";
import { displayName } from "../../lib/master-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import type { ProductFrame } from "./frame.ts";

const SCENARIOS = ["airport_start", "airport_end"] as const;
const groupName = (scenario: (typeof SCENARIOS)[number]): string => t(scenario === "airport_start" ? "tenant.charterAirport.group.airportStart" : "tenant.charterAirport.group.airportEnd");
const scenarioName = (scenario: (typeof SCENARIOS)[number]): string => t(scenario === "airport_start" ? "tenant.charterAirport.scenario.airportStart" : "tenant.charterAirport.scenario.airportEnd");

type Notice = { kind: "danger" | "success"; title?: string; text: string; reload?: boolean } | null;

export function CharterAirportsCard({ frame, product }: { frame: ProductFrame; product: Product }) {
  const onPlatform = frame.source.portal === "platform";
  const editable = !frame.readOnly && !onPlatform;
  const { token } = usePortalSession();
  // 迁移过三层区域才能配（价格规则的 charter_layout）；没迁移过的写「迁移三层区域后可用」
  const layout = useLoad<PriceRules>(`charter-airport-layout:${frame.source.portal}:${product.id}`, (authToken) => frame.source.priceRules(authToken, product.id));
  const layered = layout.state.data?.charter_layout === "three_layer";
  const bindings = useLoad<CharterAirports>(`charter-airports:${frame.source.portal}:${product.id}`, layered ? (authToken) => frame.source.charterAirports(authToken, product.id) : null);
  const country = product.city?.country_code ?? "";
  const airports = useLoad<Place[]>(`airport-options:${country}`, editable && layered && country !== "" ? (authToken) => listAirportOptions(authToken, country) : null);
  const areas = useLoad<AreaSummary[]>(`airport-area-options:${frame.source.portal}:${product.id}`, editable && layered ? frame.source.areas : null);

  const saved = bindings.state.data?.bindings ?? null;
  const [drafts, setDrafts] = useState<BindingDraft[]>([]);
  const adopted = useRef<CharterAirportBinding[] | null>(null);
  useEffect(() => {
    if (saved === null || adopted.current === saved) return;
    adopted.current = saved;
    setDrafts(bindingDraftsOf(saved));
  }, [saved]);
  const [problems, setProblems] = useState<BindingProblem[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);
  const noticeRef = useRef<HTMLDivElement>(null);

  const heading = (
    <h2 className="card__title" id="charter-airports-title">
      {t("tenant.charterAirport.title")}
    </h2>
  );
  if (product.category !== "charter") return null;
  if (layout.state.status === "loading" && layout.state.data === null) return null;
  if (!layered) {
    if (layout.state.data === null) return null;
    return (
      <section className="card" aria-labelledby="charter-airports-title" data-charter-airports="">
        {heading}
        <p className="field__hint">{t("tenant.charterAirport.notMigrated")}</p>
      </section>
    );
  }
  if (saved === null) {
    return (
      <section className="card" aria-labelledby="charter-airports-title" data-charter-airports="">
        {heading}
        {bindings.state.status === "loading" ? (
          <p className="field__hint">…</p>
        ) : (
          <p className="field__hint">
            {t("tenant.charterAirport.loadFailed")}
            <Button size="sm" variant="text" onClick={bindings.reload}>
              {t("tenant.charterAirport.retry")}
            </Button>
          </p>
        )}
      </section>
    );
  }

  // ── 只读（运营后台、没有改的权限）：一张表 ──
  if (!editable) {
    return (
      <section className="card" aria-labelledby="charter-airports-title" data-charter-airports="">
        {heading}
        <p className="field__hint">{t("tenant.charterAirport.leadPlatform")}</p>
        {saved.length === 0 ? (
          <p className="field__hint">{t("tenant.charterAirport.platformEmpty")}</p>
        ) : (
          <div className="price-table__scroll" role="region" aria-label={t("tenant.charterAirport.title")} tabIndex={0}>
            <table className="price-table">
              <thead>
                <tr>
                  <th scope="col">{t("tenant.charterAirport.scenario")}</th>
                  <th scope="col">{t("tenant.charterAirport.airport")}</th>
                  <th scope="col">{t("tenant.charterAirport.area")}</th>
                  <th scope="col">{t("tenant.charterAirport.shortName")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t("tenant.charterAirport.status")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {saved.map((binding) => (
                  <tr key={`${binding.scenario}-${binding.place_id}`} className="price-table__row">
                    <th scope="row">{scenarioName(binding.scenario)}</th>
                    <td>{displayName(binding.place_name).text}</td>
                    <td>{displayName(binding.area_name).text}</td>
                    <td>{binding.short_name_zh ?? "—"}</td>
                    <td>{!binding.effective && <IneffectiveNote />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  // ── 供应商后台编辑 ──
  const dirty = bindingsDirty(drafts, saved);
  const airportList = airports.state.data ?? [];
  const areaList = areas.state.data ?? [];
  const errorsOf = (key: string, field: BindingField): string[] => problems.filter((problem) => problem.key === key && problem.field === field).map((problem) => problem.text);
  const general = problems.filter((problem) => problem.key === null);
  const update = (key: string, change: Partial<BindingDraft>): void => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
    const field: BindingField | null = change.placeId !== undefined ? "place_id" : change.areaId !== undefined ? "area_id" : change.shortName !== undefined ? "short_name_zh" : null;
    if (field !== null) setProblems((current) => current.filter((problem) => !(problem.key === key && problem.field === field)));
  };
  const add = (scenario: (typeof SCENARIOS)[number]): void => {
    counter.current += 1;
    const key = `new-${counter.current}`;
    setDrafts((current) => [...current, { key, scenario, placeId: "", areaId: "", shortName: "" }]);
    requestAnimationFrame(() => document.getElementById(bindingFieldId(key, "place_id"))?.focus());
  };
  const remove = (key: string): void => {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setProblems((current) => current.filter((problem) => problem.key !== key));
  };
  const focusFirst = (found: readonly BindingProblem[]): void => {
    const first = found.find((problem) => problem.key !== null && problem.field !== null);
    requestAnimationFrame(() => {
      if (first?.key && first.field) document.getElementById(bindingFieldId(first.key, first.field))?.focus();
      else noticeRef.current?.focus();
    });
  };
  const fail = (found: BindingProblem[]): void => {
    setProblems(found);
    setNotice({ kind: "danger", title: t("tenant.charterAirport.notSaved"), text: t("tenant.charterAirport.fixBelow", { count: found.length }) });
    focusFirst(found);
  };
  const save = async (): Promise<void> => {
    setNotice(null);
    const local = bindingProblems(drafts);
    if (local.length > 0) {
      fail(local);
      return;
    }
    setBusy(true);
    try {
      const result = await putCharterAirports(token, product.id, frame.version, bindingInputs(drafts));
      adopted.current = result.bindings;
      bindings.set(result);
      setDrafts(bindingDraftsOf(result.bindings));
      setProblems([]);
      setNotice({ kind: "success", text: t("tenant.charterAirport.saved") });
      frame.saved(result.version);
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED" && Array.isArray(err.details["issues"])) fail(placeBindingIssues(err.details["issues"] as { path?: string; reason?: string; message?: string }[], drafts));
      else {
        const text =
          err instanceof ApiError && err.code === "VERSION_CONFLICT"
            ? t("tenant.charterAirport.versionConflict")
            : err instanceof ApiError && err.code === "AIRPORT_PRICES_EXIST"
              ? t("tenant.charterAirport.pricesExist")
              : err instanceof ApiError && err.code === "CHARTER_LAYOUT_NOT_MIGRATED"
                ? t("tenant.charterAirport.layoutNotMigrated")
                : err instanceof Error
                  ? err.message
                  : String(err);
        setNotice({ kind: "danger", title: t("tenant.charterAirport.notSaved"), text, reload: err instanceof ApiError && err.code === "VERSION_CONFLICT" });
        requestAnimationFrame(() => noticeRef.current?.focus());
      }
    } finally {
      setBusy(false);
    }
  };

  const airportOptions = (selected: string): { value: string; label: string }[] => {
    const active = airportList.filter((place) => place.status === "active").map((place) => ({ value: place.id, label: displayName(place.name).text }));
    if (selected !== "" && !active.some((option) => option.value === selected)) {
      const known = saved.find((binding) => binding.place_id === selected);
      active.unshift({ value: selected, label: t("tenant.charterAirport.disabledOption", { name: known ? displayName(known.place_name).text : selected }) });
    }
    return active;
  };
  const areaOptions = (selected: string): { value: string; label: string }[] => {
    const active = areaList.filter((area) => area.status === "active").map((area) => ({ value: area.id, label: displayName(area.name).text }));
    if (selected !== "" && !active.some((option) => option.value === selected)) {
      const area = areaList.find((entry) => entry.id === selected);
      const known = saved.find((binding) => binding.area_id === selected);
      active.unshift({ value: selected, label: t("tenant.charterAirport.disabledOption", { name: area ? displayName(area.name).text : known ? displayName(known.area_name).text : selected }) });
    }
    return active;
  };

  return (
    <section className="card" aria-labelledby="charter-airports-title" data-charter-airports="">
      {heading}
      <p className="field__hint">{t("tenant.charterAirport.lead")}</p>
      <div ref={noticeRef} tabIndex={-1} className="alert-slot">
        <div role="alert">
          {notice?.kind === "danger" && (
            <Alert kind="danger">
              {notice.title && <strong className="alert__title">{notice.title}</strong>}
              <span>{notice.text}</span>
              {general.length > 0 && (
                <span className="error-summary__list">
                  {general.map((problem) => (
                    <span key={problem.text}>{problem.text}</span>
                  ))}
                </span>
              )}
              {notice.reload && (
                <span className="alert__actions">
                  <Button
                    size="sm"
                    variant="text"
                    onClick={() => {
                      setNotice(null);
                      adopted.current = null;
                      bindings.reload();
                      frame.refresh();
                    }}
                  >
                    {t("tenant.charterAirport.reload")}
                  </Button>
                </span>
              )}
            </Alert>
          )}
        </div>
        <div role="status">{notice?.kind === "success" && <Alert kind="success">{notice.text}</Alert>}</div>
      </div>
      {SCENARIOS.map((scenario) => {
        const group = drafts.filter((draft) => draft.scenario === scenario);
        const name = groupName(scenario);
        return (
          <fieldset key={scenario} className="airport-bindings__group" data-scenario={scenario}>
            <legend className="field__label">{name}</legend>
            {group.length === 0 && <p className="field__hint">{t("tenant.charterAirport.empty")}</p>}
            {group.map((draft, index) => {
              const label = (field: string): string => t("tenant.charterAirport.rowLabel", { group: scenarioName(scenario), index: index + 1, field });
              const binding = saved.find((entry) => entry.scenario === scenario && entry.place_id === draft.placeId && entry.area_id === draft.areaId);
              const select = (field: "place_id" | "area_id", value: string, options: { value: string; label: string }[], placeholder: string, fieldName: string, onChange: (value: string) => void) => {
                const id = bindingFieldId(draft.key, field);
                const errors = errorsOf(draft.key, field);
                return (
                  <div className="field">
                    <label className="field__label" htmlFor={id}>
                      {fieldName}
                    </label>
                    <select id={id} className="input select" aria-label={label(fieldName)} value={value} disabled={busy} aria-invalid={errors.length > 0 || undefined} aria-describedby={errors.length > 0 ? `${id}-errors` : undefined} onChange={(event) => onChange(event.target.value)}>
                      <option value="">{placeholder}</option>
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <FieldErrors id={`${id}-errors`} errors={errors} />
                  </div>
                );
              };
              const shortId = bindingFieldId(draft.key, "short_name_zh");
              const shortErrors = errorsOf(draft.key, "short_name_zh");
              return (
                <div key={draft.key} className="airport-bindings__row" data-binding-row={draft.key}>
                  {select("place_id", draft.placeId, airportOptions(draft.placeId), t("tenant.charterAirport.pickAirport"), t("tenant.charterAirport.airport"), (placeId) => update(draft.key, { placeId }))}
                  {select("area_id", draft.areaId, areaOptions(draft.areaId), t("tenant.charterAirport.pickArea"), t("tenant.charterAirport.area"), (areaId) => update(draft.key, { areaId }))}
                  <div className="field">
                    <label className="field__label" htmlFor={shortId}>
                      {t("tenant.charterAirport.shortName")}
                    </label>
                    <input
                      id={shortId}
                      className="input"
                      autoComplete="off"
                      aria-label={label(t("tenant.charterAirport.shortName"))}
                      value={draft.shortName}
                      readOnly={busy}
                      aria-invalid={shortErrors.length > 0 || undefined}
                      aria-describedby={`${shortId}-hint${shortErrors.length > 0 ? ` ${shortId}-errors` : ""}`}
                      onChange={(event) => update(draft.key, { shortName: event.target.value })}
                    />
                    <p className="field__hint" id={`${shortId}-hint`}>
                      {t("tenant.charterAirport.shortNameHint", { max: SHORT_NAME_MAX })}
                    </p>
                    <FieldErrors id={`${shortId}-errors`} errors={shortErrors} />
                  </div>
                  {binding !== undefined && !binding.effective && <IneffectiveNote />}
                  <Button size="sm" variant="text" disabled={busy} aria-label={t("tenant.charterAirport.removeLabel", { group: scenarioName(scenario), index: index + 1 })} onClick={() => remove(draft.key)}>
                    {t("tenant.charterAirport.remove")}
                  </Button>
                </div>
              );
            })}
            <Button size="sm" disabled={busy || group.length >= MAX_AIRPORTS_PER_SCENARIO} onClick={() => add(scenario)} aria-label={`${t("tenant.charterAirport.add")}：${name}`}>
              {t("tenant.charterAirport.add")}
            </Button>
            {group.length >= MAX_AIRPORTS_PER_SCENARIO && <p className="field__hint">{t("tenant.charterAirport.tooMany", { max: MAX_AIRPORTS_PER_SCENARIO })}</p>}
          </fieldset>
        );
      })}
      <div className="airport-bindings__actions">
        {dirty && <span className="field__hint">{t("tenant.charterAirport.unsaved")}</span>}
        <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
          {t("tenant.charterAirport.save")}
        </Button>
      </div>
    </section>
  );
}

function IneffectiveNote() {
  return (
    <span className="price-state price-state--danger">
      <Icon name="alert-circle" />
      {t("tenant.charterAirport.ineffective")}
    </span>
  );
}
