/**
 * 包车快捷入口「机场接机开始」「机场送机结束」（M9P-22，ADR 0098 第三节第 7 小节；业主 2026-11-19 改）：点了以后上车点（或下车点）改成先选机场：
 * 1. 输入机场名称（中 / 日 / 英）或三字码，从候选里选机场（`GET /site/v1/airports`，平台主数据，不看哪个商品绑了机场）——选中就带出机场坐标；
 * 2. 再选航站楼：机场登记了航站楼就下拉选（可以不指定，用机场坐标），没登记就让客人自己填（可空，坐标仍是机场的）。
 * 以前只列「绑了机场套餐的机场」，没有可列的时下拉是空的、客人卡住（业主反馈）；现在不管绑没绑都能选，机场套餐由报价按坐标匹配（后端），这里不另外判断。
 * 「改填其他地点」退回普通地址输入。文案走 i18n key（M11-01）。
 */
import { useEffect, useId, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { type SiteAirport, type SiteAirportScenario, searchSiteAirports } from "../../../api/site.ts";
import { charterAirportText } from "../../../lib/charter-airport-copy.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { displayName } from "../../../lib/master-display.ts";

export type AirportQuickMode = SiteAirportScenario | null;

/** 主数据名称的显示文字；一种语言都没有时是空字符串（`displayName` 这时给的是占位的「—」） */
const nameText = (name: SiteAirport["name"]): string => (Object.values(name ?? {}).some((text) => typeof text === "string" && text.trim() !== "") ? displayName(name).text : "");

/** 一个航站楼选成上车 / 下车点：名称写「成田机场 第 1 航站楼」（航站楼和机场同名、或没有名称时只写机场名），坐标是航站楼的，类型是机场 */
export function terminalPoint(airportName: string, terminal: SiteAirport["terminals"][number]): TripPoint {
  const terminalName = nameText(terminal.name);
  return { name: terminalName === airportName || terminalName === "" ? airportName : `${airportName} ${terminalName}`, lat: terminal.location.lat, lng: terminal.location.lng, kind: "airport" };
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

/** 机场的中文名（没有按日文、英文；都没有用编码） */
const airportName = (airport: SiteAirport): string => nameText(airport.name) || airport.code;

/** 选中的机场本身（不指定航站楼；没登记航站楼时把客人填的航站楼接在后面）：坐标是机场的 */
export function airportPoint(airport: SiteAirport, terminalText = ""): TripPoint {
  const name = airportName(airport);
  const terminal = terminalText.trim();
  return { name: terminal === "" ? name : `${name} ${terminal}`, lat: airport.location.lat, lng: airport.location.lng, kind: "airport" };
}

/** 搜索结果里机场的写法：「成田国际机场（NRT）」 */
const airportLabel = (airport: SiteAirport): string => `${airportName(airport)}（${airport.code}）`;

/** 停顿多久再搜（毫秒） */
const SEARCH_DELAY_MS = 300;

/** 先选机场、再选航站楼（快捷入口打开时代替那一端的地址输入） */
export function TerminalSelect({ scenario, label, value, onChange, onExit }: { scenario: SiteAirportScenario; label: string; value: TripPoint | null; onChange(point: TripPoint): void; onExit(): void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SiteAirport[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [airport, setAirport] = useState<SiteAirport | null>(null);
  const [terminalId, setTerminalId] = useState("");
  const [terminalText, setTerminalText] = useState("");
  // 换过机场（或第一次进来）时没有已选的：页面上已有的值（返回上一步时）只显示，不再搜
  const [editing, setEditing] = useState(value === null);

  useEffect(() => {
    const keyword = query.trim();
    if (!editing || keyword === "") {
      setResults(null);
      setState("idle");
      return;
    }
    let alive = true;
    setState("loading");
    const timer = setTimeout(() => {
      searchSiteAirports(keyword).then(
        (result) => {
          if (!alive) return;
          setResults(result.items);
          setState("idle");
        },
        () => alive && setState("failed"),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, editing]);

  const choose = (picked: SiteAirport): void => {
    setAirport(picked);
    setTerminalId("");
    setTerminalText("");
    setEditing(false);
    onChange(airportPoint(picked));
  };
  const restart = (): void => {
    setAirport(null);
    setResults(null);
    setEditing(true);
  };

  const searchId = `${id}-search`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const timing = scenario === "airport_start" ? <p className="field__hint">{charterAirportText("book.charter.airportTimingHint")}</p> : null;
  const exit = (
    <Button variant="text" size="sm" onClick={onExit}>
      {charterAirportText("book.charter.quickExit")}
    </Button>
  );

  if (editing) {
    const empty = results !== null && results.length === 0 && state === "idle";
    return (
      <div className="field">
        <label className="field__label" htmlFor={searchId}>
          {label}（{charterAirportText("book.charter.searchAirport")}）
        </label>
        <input id={searchId} className="input" type="search" autoComplete="off" value={query} aria-describedby={`${hintId} ${statusId}`} onChange={(event) => setQuery(event.target.value)} />
        <p id={hintId} className="field__hint">
          {charterAirportText("book.charter.searchAirportHint")}
        </p>
        <p id={statusId} className="field__hint" role="status">
          {state === "loading" ? charterAirportText("book.charter.searching") : state === "failed" ? charterAirportText("book.charter.searchFailed") : empty ? charterAirportText("book.charter.noAirport") : ""}
        </p>
        {results !== null && results.length > 0 && (
          <ul className="book-new__airport-results" aria-label={charterAirportText("book.charter.airportResults")}>
            {results.map((entry) => (
              <li key={entry.id}>
                <Button variant="secondary" size="sm" onClick={() => choose(entry)}>
                  {airportLabel(entry)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {timing}
        {exit}
      </div>
    );
  }

  const terminalSelectId = `${id}-terminal`;
  const terminalTextId = `${id}-terminal-text`;
  return (
    <div className="field">
      <p className="field__label">
        {label}：{charterAirportText("book.charter.pickedAirport", { airport: airport === null ? (value?.name ?? "") : airportLabel(airport) })}
      </p>
      <Button variant="text" size="sm" onClick={restart}>
        {charterAirportText("book.charter.changeAirport")}
      </Button>
      {airport !== null && airport.terminals.length > 0 && (
        <>
          <label className="field__label" htmlFor={terminalSelectId}>
            {label}（{charterAirportText("book.charter.pickTerminal")}）
          </label>
          <select
            id={terminalSelectId}
            className="input select"
            value={terminalId}
            onChange={(event) => {
              setTerminalId(event.target.value);
              const terminal = airport.terminals.find((entry) => entry.id === event.target.value);
              onChange(terminal === undefined ? airportPoint(airport) : terminalPoint(airportName(airport), terminal));
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
      )}
      {airport !== null && airport.terminals.length === 0 && (
        <>
          <label className="field__label" htmlFor={terminalTextId}>
            {label}（{charterAirportText("book.charter.terminalFree")}）
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
              onChange(airportPoint(airport, event.target.value));
            }}
          />
          <p id={`${terminalTextId}-hint`} className="field__hint">
            {charterAirportText("book.charter.terminalFreeHint")}
          </p>
        </>
      )}
      {timing}
      {exit}
    </div>
  );
}
