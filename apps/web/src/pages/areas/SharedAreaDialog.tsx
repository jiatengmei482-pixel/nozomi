/**
 * 从区域共享库引用（M8-31，ADR 0083）：选城市、按名称搜 → 选一个 → 定名称、业务类型、用途 → 在自己名下建一个副本。
 * 共享库只有名称和形状概况，不显示是哪家供应商建的；引用后副本是你自己的区域，来源以后改图形不会悄悄改你的。
 */
import { AREA_BIZ_TYPES, AREA_BIZ_TYPE_NAMES, AREA_ROLES, AREA_ROLE_NAMES, type AreaBizType, type AreaRole } from "@nozomi/domain";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type Area, type SharedArea, createAreaFromShared, listSharedAreas } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { NETWORK_FAILURE_TEXT } from "../../lib/failure.ts";
import { displayName } from "../../lib/master-display.ts";
import { newIdempotencyKey } from "../../lib/site-display.ts";

export interface SharedAreaDialogProps {
  open: boolean;
  cities: readonly City[] | null;
  /** 新建页里打开时：预先选好的城市和要引用的那一个（相似提示里点「引用」） */
  initial?: { cityId: string; picked?: SharedArea | null };
  onClose(): void;
  onCreated(area: Area): void;
}

export function SharedAreaDialog({ open, cities, initial, onClose, onCreated }: SharedAreaDialogProps) {
  const { token, handleAuthFailure } = usePortalSession();
  const ids = { city: useId(), q: useId(), name: useId(), biz: useId(), role: useId() };
  const activeCities = (cities ?? []).filter((city) => city.status === "active");
  const [cityId, setCityId] = useState(initial?.cityId ?? "");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ items: SharedArea[]; truncated: boolean } | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SharedArea | null>(initial?.picked ?? null);
  const [name, setName] = useState(initial?.picked ? displayName(initial.picked.name).text : "");
  const [bizType, setBizType] = useState<AreaBizType>("general");
  const [role, setRole] = useState<AreaRole>("both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 每选一个来源用一个幂等键：同一个来源重试原样返回，换一个来源不会撞上上一次的键
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => setKey(newIdempotencyKey()), [picked?.id]);

  useEffect(() => {
    if (!open) return;
    setCityId(initial?.cityId ?? "");
    setPicked(initial?.picked ?? null);
    setName(initial?.picked ? displayName(initial.picked.name).text : "");
    setResults(null);
    setError(null);
    setBizType("general");
    setRole("both");
  }, [open, initial?.cityId, initial?.picked]);

  const failure = (err: unknown, action: string): string => {
    if (err instanceof NetworkError) return NETWORK_FAILURE_TEXT;
    if (err instanceof ApiError && err.code === "AREA_NAME_TAKEN") return "这个城市里你已经有同名的区域了，请改个名字再引用。";
    if (err instanceof ApiError && err.status === 404) return "这个区域已经不在共享库里了（可能被停用），请换一个。";
    if (err instanceof ApiError && err.code === "MASTER_DATA_NOT_READY") return "这个城市已被平台停用，不能在它下面新增区域。";
    return `系统暂时无法${action}，请稍后再试。`;
  };

  const search = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (cityId === "") return;
    setSearching(true);
    setError(null);
    try {
      setResults(await listSharedAreas(token, cityId, q));
    } catch (err) {
      if (!handleAuthFailure(err)) setError(failure(err, "查询共享库"));
    } finally {
      setSearching(false);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!picked) return;
    if (name.trim() === "") {
      setError("请填写区域名称。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sameName = name.trim() === displayName(picked.name).text;
      const area = await createAreaFromShared(token, { shared_area_id: picked.id, name: sameName ? null : { zh: name.trim() }, biz_type: bizType, role }, key);
      onCreated(area);
    } catch (err) {
      if (!handleAuthFailure(err)) setError(failure(err, "引用这个区域"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      size="form"
      title="从共享库引用区域"
      busy={busy}
      onClose={onClose}
      footer={
        picked ? (
          <>
            <Button variant="secondary" onClick={() => setPicked(null)} disabled={busy}>
              换一个
            </Button>
            <Button variant="primary" type="submit" form="shared-area-form" loading={busy} loadingText="引用中…">
              引用到我的区域
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
        )
      }
    >
      <p className="field__hint">共享库里是各家供应商画好的区域，只有名称和形状，不显示是谁建的，也不带价格。引用 = 复制一份到你名下；来源以后改了形状，你的区域不会跟着变，会提示你是否切换。</p>
      {error !== null && <Alert kind="danger">{error}</Alert>}
      {picked === null ? (
        <form className="shared-area__search" onSubmit={(event) => void search(event)}>
          <div className="field">
            <label className="field__label" htmlFor={ids.city}>城市</label>
            <select id={ids.city} className="input select" value={cityId} onChange={(event) => setCityId(event.target.value)}>
              <option value="">请选择城市</option>
              {activeCities.map((city) => (
                <option key={city.id} value={city.id}>{displayName(city.name).text}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.q}>名称（选填）</label>
            <input id={ids.q} className="input" value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} />
          </div>
          <Button variant="secondary" type="submit" disabled={cityId === ""} loading={searching} loadingText="查询中…">
            查询共享库
          </Button>
          {results !== null && (
            <div className="shared-area__results" aria-live="polite">
              {results.items.length === 0 ? (
                <p className="field__hint">这个城市的共享库里还没有符合条件的区域，可以自己新建（新建的会自动进共享库）。</p>
              ) : (
                <ul className="shared-area__list" aria-label="共享区域">
                  {results.items.map((item) => (
                    <li key={item.id} className="shared-area__item">
                      <span lang={displayName(item.name).lang}>{displayName(item.name).text}</span>
                      <span className="field__hint">营运区 {item.operate_polygon_count} 块{item.forbid_polygon_count > 0 ? ` · 禁行区 ${item.forbid_polygon_count} 块` : ""}</span>
                      <Button
                        variant="secondary"
                        aria-label={`引用「${displayName(item.name).text}」`}
                        onClick={() => {
                          setPicked(item);
                          setName(displayName(item.name).text);
                        }}
                      >
                        引用
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {results.truncated && <p className="field__hint">只显示了最近修改的 50 个，请输入名称缩小范围。</p>}
            </div>
          )}
        </form>
      ) : (
        <form id="shared-area-form" onSubmit={(event) => void submit(event)}>
          <p>
            引用「<span lang={displayName(picked.name).lang}>{displayName(picked.name).text}</span>」（营运区 {picked.operate_polygon_count} 块）
          </p>
          <div className="field">
            <label className="field__label" htmlFor={ids.name}>在你这里叫什么</label>
            <input id={ids.name} className="input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.biz}>业务类型</label>
            <select id={ids.biz} className="input select" value={bizType} onChange={(event) => setBizType(event.target.value as AreaBizType)}>
              {AREA_BIZ_TYPES.map((value) => (
                <option key={value} value={value}>{AREA_BIZ_TYPE_NAMES[value]}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.role}>用途</label>
            <select id={ids.role} className="input select" value={role} onChange={(event) => setRole(event.target.value as AreaRole)}>
              {AREA_ROLES.map((value) => (
                <option key={value} value={value}>{AREA_ROLE_NAMES[value]}</option>
              ))}
            </select>
          </div>
        </form>
      )}
    </Dialog>
  );
}
