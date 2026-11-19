/**
 * 包车快捷入口「机场接机开始」「机场送机结束」（M9P-22，ADR 0098 第三节第 7 小节；业主 2026-11-19 两次改）：
 * 那一端的地点和别的地点一样用地址搜索（`PlaceField`，任何语言输入机场名或地址，如「成田机场」「Narita Airport」「羽田第3ターミナル」），
 * 选中后这里按坐标认出是哪个机场、哪个航站楼（`GET /site/v1/airports/at`，和按两个坐标报价同一个认机场的规则），客人不用选机场、不用记三字码：
 * - 认出航站楼（离登记的航站楼 ≤ 500 米）：只显示「已识别」；
 * - 认出机场、没认出航站楼：机场登记了航站楼就下拉选填（不选 = 用客人选的地点），没登记就让客人自己填（可空）；
 * - 认不出机场：说明一句，照常可以询价（价格按地点算，机场套餐由报价按坐标匹配），不卡住。
 * 「机场接机开始」的计时提示照旧；「改填其他地点」退出快捷入口。文案走 i18n key（M11-01）。
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { type SiteAirportAt, type SiteAirportScenario, findSiteAirportAt } from "../../../api/site.ts";
import { charterAirportText } from "../../../lib/charter-airport-copy.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { displayName } from "../../../lib/master-display.ts";

export type AirportQuickMode = SiteAirportScenario | null;

type Airport = NonNullable<SiteAirportAt["airport"]>;
type Terminal = Airport["terminals"][number];

/** 主数据名称的显示文字；一种语言都没有时是空字符串（`displayName` 这时给的是占位的「—」） */
const nameText = (name: Airport["name"]): string => (Object.values(name ?? {}).some((text) => typeof text === "string" && text.trim() !== "") ? displayName(name).text : "");

/** 机场的显示名（中文，没有按日文、英文；都没有用编码） */
export const airportName = (airport: Airport): string => nameText(airport.name) || airport.code;

/** 一个航站楼选成上车 / 下车点：名称写「成田机场 第 1 航站楼」（航站楼和机场同名、或没有名称时只写机场名），坐标是航站楼的，类型是机场 */
export function terminalPoint(airportLabel: string, terminal: Terminal): TripPoint {
  const terminalName = nameText(terminal.name);
  return { name: terminalName === airportLabel || terminalName === "" ? airportLabel : `${airportLabel} ${terminalName}`, lat: terminal.location.lat, lng: terminal.location.lng, kind: "airport" };
}

/** 两个快捷入口按钮 */
export function AirportQuickButtons({ mode, onMode }: { mode: AirportQuickMode; onMode(mode: AirportQuickMode): void }) {
  return (
    <div className="book-new__airport-quick" role="group" aria-label={`${charterAirportText("book.charter.quickAirportStart")} / ${charterAirportText("book.charter.quickAirportEnd")}`}>
      {(["airport_start", "airport_end"] as const).map((scenario) => (
        <Button key={scenario} size="sm" variant="secondary" aria-pressed={mode === scenario} onClick={() => onMode(mode === scenario ? null : scenario)}>
          {charterAirportText(scenario === "airport_start" ? "book.charter.quickAirportStart" : "book.charter.quickAirportEnd")}
        </Button>
      ))}
    </div>
  );
}

const samePoint = (a: TripPoint | null, b: TripPoint | null): boolean => a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng && a.name === b.name);

type Lookup = { state: "idle" } | { state: "loading" } | { state: "failed" } | { state: "done"; result: SiteAirportAt };

/**
 * 快捷入口打开时放在那一端的地址搜索下面：客人选了地点后认机场、航站楼，没认出航站楼时给选填。
 * `value` 是那一端现在的地点；这里改航站楼时交出新的地点（`onChange`），客人在地址搜索里换了地点就重新认。
 */
export function AirportMatch({ scenario, label, value, onChange, onExit }: { scenario: SiteAirportScenario; label: string; value: TripPoint | null; onChange(point: TripPoint): void; onExit(): void }) {
  const id = useId();
  // 客人在地址搜索里选的那个地点（选航站楼、填航站楼都从它出发）；这里交出去的最后一个地点不算客人选的
  const [base, setBase] = useState<TripPoint | null>(value);
  const emitted = useRef<TripPoint | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [terminalId, setTerminalId] = useState("");
  const [terminalText, setTerminalText] = useState("");

  useEffect(() => {
    if (samePoint(value, emitted.current)) return;
    setBase(value);
    setTerminalId("");
    setTerminalText("");
  }, [value]);

  useEffect(() => {
    if (base === null) {
      setLookup({ state: "idle" });
      return;
    }
    let alive = true;
    setLookup({ state: "loading" });
    findSiteAirportAt(base).then(
      (result) => alive && setLookup({ state: "done", result }),
      () => alive && setLookup({ state: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [base]);

  const emit = (point: TripPoint): void => {
    emitted.current = point;
    onChange(point);
  };

  const timing = scenario === "airport_start" ? <p className="field__hint">{charterAirportText("book.charter.airportTimingHint")}</p> : null;
  const exit = (
    <Button variant="text" size="sm" onClick={onExit}>
      {charterAirportText("book.charter.quickExit")}
    </Button>
  );
  const terminalSelectId = `${id}-terminal`;
  const terminalTextId = `${id}-terminal-text`;

  let status: string;
  let picker: ReactNode = null;
  if (base === null) status = charterAirportText("book.charter.searchAirportHint", { label });
  else if (lookup.state === "loading" || lookup.state === "idle") status = charterAirportText("book.charter.matchingAirport");
  else if (lookup.state === "failed" || lookup.result.airport === null) status = charterAirportText(lookup.state === "failed" ? "book.charter.matchFailed" : "book.charter.noAirport");
  else {
    const airport = lookup.result.airport;
    const recognized = airport.terminals.find((terminal) => terminal.id === lookup.result.terminalId) ?? null;
    if (recognized !== null) status = charterAirportText("book.charter.recognized", { place: terminalPoint(airportName(airport), recognized).name });
    else {
      status = charterAirportText("book.charter.recognized", { place: airportName(airport) });
      picker =
        airport.terminals.length > 0 ? (
          <>
            <label className="field__label" htmlFor={terminalSelectId}>
              {label}（{charterAirportText("book.charter.terminalOptional")}）
            </label>
            <select
              id={terminalSelectId}
              className="input select"
              value={terminalId}
              onChange={(event) => {
                setTerminalId(event.target.value);
                const terminal = airport.terminals.find((entry) => entry.id === event.target.value);
                emit(terminal === undefined ? base : terminalPoint(airportName(airport), terminal));
              }}
            >
              <option value="">{charterAirportText("book.charter.anyTerminal")}</option>
              {airport.terminals.map((terminal) => (
                <option key={terminal.id} value={terminal.id}>
                  {terminalPoint(airportName(airport), terminal).name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label className="field__label" htmlFor={terminalTextId}>
              {label}（{charterAirportText("book.charter.terminalOptional")}）
            </label>
            <input
              id={terminalTextId}
              className="input"
              type="text"
              maxLength={40}
              value={terminalText}
              aria-describedby={`${terminalTextId}-hint`}
              onChange={(event) => {
                setTerminalText(event.target.value);
                const text = event.target.value.trim();
                emit(text === "" ? base : { ...base, name: `${base.name} ${text}` });
              }}
            />
            <p id={`${terminalTextId}-hint`} className="field__hint">
              {charterAirportText("book.charter.terminalFreeHint")}
            </p>
          </>
        );
    }
  }

  return (
    <div className="field book-new__airport-match">
      <p className="field__hint" role="status">
        {status}
      </p>
      {picker}
      {timing}
      {exit}
    </div>
  );
}
