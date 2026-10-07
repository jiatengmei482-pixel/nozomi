/** 四类主数据的列表页、表单页共用的小部件和取数。 */
import { COUNTRY_CODES, type LocalizedText } from "@nozomi/domain";
import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import { ApiError, NetworkError } from "../../api/client.ts";
import { type City, type MasterKind, listAllMaster } from "../../api/master.ts";
import type { ComboboxOption } from "../../components/Combobox.tsx";
import { countryLabel, countryName, displayName, otherNames } from "../../lib/master-display.ts";
import { masterEditPath } from "../../lib/master-paths.ts";
import { type LoadState, useLoad } from "../../lib/use-load.ts";

/** 从列表去新增页、编辑页时带上「从哪来」，保存或取消后回到原来的筛选条件下。 */
export interface ReturnState {
  from?: string;
}

export function useReturnState(): ReturnState {
  const location = useLocation();
  return { from: `${location.pathname}${location.search}` };
}

/** 回到来的地方；直接用网址打开的回 `fallback`。只接受运营后台主数据下的站内路径。 */
export function returnPath(state: unknown, fallback: string): string {
  const from = typeof state === "object" && state !== null ? (state as ReturnState).from : undefined;
  return typeof from === "string" && from.startsWith("/platform/master/") && !from.includes("//") ? from : fallback;
}

export function CodeLink({ kind, id, code }: { kind: MasterKind; id: string; code: string }) {
  const state = useReturnState();
  return (
    <Link className="link" to={masterEditPath(kind, id)} state={state}>
      {code}
    </Link>
  );
}

/** 名称列：第一行显示名，第二行其余语言。 */
export function NameCell({ name }: { name: LocalizedText }) {
  const shown = displayName(name);
  const others = otherNames(name);
  return (
    <span className="table__names">
      <span lang={shown.lang}>{shown.text}</span>
      {others.length > 0 && (
        <span className="table__other-names" title={others.map((other) => other.text).join(" / ")}>
          {others.map((other, index) => (
            <span key={other.lang} lang={other.lang}>
              {index > 0 ? " / " : ""}
              {other.text}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** 整份城市清单（按游标取到完）：给筛选和表单的组合框做选项。每次进入页面重新取。 */
export function useAllCities(): { state: LoadState<City[]>; reload(): void; set(cities: City[]): void } {
  return useLoad<City[]>("all-cities", (token) => listAllMaster("cities", token, { status: "all" }));
}

/** 国家选项：「日本（JP）」，输入中文国名或两位代码都能筛出来；已经有城市的国家排在最前。 */
export function useCountryOptions(cities: readonly City[] | null): ComboboxOption[] {
  return useMemo(() => {
    const used = new Set((cities ?? []).map((city) => city.country_code));
    const option = (code: string): ComboboxOption => ({ value: code, label: countryLabel(code), keywords: `${code} ${countryName(code) ?? ""}` });
    const sorted = [...COUNTRY_CODES].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b), "zh-Hans"));
    return [...sorted.filter((code) => used.has(code)), ...sorted.filter((code) => !used.has(code))].map(option);
  }, [cities]);
}

export function cityOption(city: City): ComboboxOption {
  return { value: city.id, label: displayName(city.name).text, detail: city.code, keywords: `${Object.values(city.name).join(" ")} ${countryLabel(city.country_code)}` };
}

/** 网络不通还是服务器出错，写成半句话，前面接「…没有成功。」之类。 */
export function failureReason(err: unknown, action: string): string {
  return err instanceof NetworkError ? "网络连接失败，请检查网络后重试。" : `系统暂时无法${action}，请稍后再试。`;
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export const FORBIDDEN_TEXT = "你没有权限修改主数据。需要的话，请联系管理员开通。";
