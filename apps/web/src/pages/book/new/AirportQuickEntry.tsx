/**
 * 包车快捷入口「机场接机开始」「机场送机结束」（M9P-22，ADR 0098 第三节第 7 小节）：点了以后上车点（或下车点）改成按航站楼选，
 * 只列能报机场套餐的机场、只列机场区域里的航站楼（`GET /site/v1/charter-airports`）；「改填其他地点」退回普通地址输入。
 * 不走快捷入口、直接输入机场地址也会按几何匹配机场套餐（后端），这里不用另外判断。文案走 i18n key（M11-01）。
 */
import { useEffect, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { type SiteAirportScenario, type SiteCharterAirport, listSiteCharterAirports } from "../../../api/site.ts";
import { charterAirportText } from "../../../lib/charter-airport-copy.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { displayName } from "../../../lib/master-display.ts";

export type AirportQuickMode = SiteAirportScenario | null;

/** 一个航站楼选成上车 / 下车点：名称写「成田机场 第 1 航站楼」，类型是机场 */
export function terminalPoint(airport: SiteCharterAirport, terminal: SiteCharterAirport["terminals"][number]): TripPoint {
  const terminalName = displayName(terminal.name).text;
  return { name: terminalName === airport.name || terminalName === "" ? airport.name : `${airport.name} ${terminalName}`, lat: terminal.location.lat, lng: terminal.location.lng, kind: "airport" };
}

/** 两个快捷入口按钮 */
export function AirportQuickButtons({ mode, onMode }: { mode: AirportQuickMode; onMode(mode: AirportQuickMode): void }) {
  return (
    <div className="book-new__airport-quick" role="group" aria-label={`${charterAirportText("book.charter.quickAirportStart")} / ${charterAirportText("book.charter.quickAirportEnd")}`}>
      {(["airport_start", "airport_end"] as const).map((scenario) => (
        <Button key={scenario} size="sm" variant={mode === scenario ? "primary" : "secondary"} aria-pressed={mode === scenario} onClick={() => onMode(mode === scenario ? null : scenario)}>
          {charterAirportText(scenario === "airport_start" ? "book.charter.quickAirportStart" : "book.charter.quickAirportEnd")}
        </Button>
      ))}
    </div>
  );
}

/** 按航站楼选（快捷入口打开时代替那一端的地址输入） */
export function TerminalSelect({ scenario, label, value, onChange, onExit }: { scenario: SiteAirportScenario; label: string; value: TripPoint | null; onChange(point: TripPoint): void; onExit(): void }) {
  const [airports, setAirports] = useState<SiteCharterAirport[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setAirports(null);
    setFailed(false);
    listSiteCharterAirports(scenario).then(
      (result) => alive && setAirports(result.items),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [scenario]);
  const id = `book-terminal-${scenario}`;
  const options = (airports ?? []).flatMap((airport) => airport.terminals.map((terminal) => ({ key: terminal.id, airport, terminal, point: terminalPoint(airport, terminal) })));
  const selected = value === null ? "" : (options.find((option) => option.point.lat === value.lat && option.point.lng === value.lng)?.key ?? "");
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}（{charterAirportText("book.charter.pickTerminal")}）
      </label>
      <select
        id={id}
        className="input select"
        value={selected}
        disabled={airports === null || failed}
        onChange={(event) => {
          const option = options.find((entry) => entry.key === event.target.value);
          if (option !== undefined) onChange(option.point);
        }}
      >
        <option value="">{charterAirportText("book.charter.pickTerminal")}</option>
        {(airports ?? []).map((airport) => (
          <optgroup key={airport.id} label={airport.name}>
            {airport.terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminalPoint(airport, terminal).name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {scenario === "airport_start" && <p className="field__hint">{charterAirportText("book.charter.airportTimingHint")}</p>}
      <Button variant="text" size="sm" onClick={onExit}>
        {charterAirportText("book.charter.quickExit")}
      </Button>
    </div>
  );
}
