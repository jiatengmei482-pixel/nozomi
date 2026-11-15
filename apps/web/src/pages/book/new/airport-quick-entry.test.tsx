/**
 * 包车快捷入口（M9P-22，ADR 0098 第三节第 7 小节）的组件测试：两个按钮切换；按航站楼选（只列接口给的机场区域里的航站楼），
 * 选中后把航站楼的坐标、名称交出去；「机场接机开始」时提示从预约时间开始计时；「改填其他地点」退出。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { SiteCharterAirport } from "../../../api/site.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { type AirportQuickMode, AirportQuickButtons, TerminalSelect, terminalPoint } from "./AirportQuickEntry.tsx";

afterEach(() => {
  cleanup();
  resetBrowser();
});

const NARITA: SiteCharterAirport = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "NRT",
  name: "成田机场",
  city_id: "22222222-2222-4222-8222-222222222222",
  terminals: [
    { id: "33333333-3333-4333-8333-333333333331", code: "NRT-T1", name: { zh: "第 1 航站楼" }, location: { lng: 140.385, lat: 35.77 } },
    { id: "33333333-3333-4333-8333-333333333332", code: "NRT-T2", name: { zh: "第 2 航站楼" }, location: { lng: 140.388, lat: 35.765 } },
  ],
};

function Harness({ onPick }: { onPick(point: TripPoint | null, mode: AirportQuickMode): void }) {
  const [mode, setMode] = useState<AirportQuickMode>(null);
  const [from, setFrom] = useState<TripPoint | null>(null);
  return (
    <>
      <AirportQuickButtons mode={mode} onMode={setMode} />
      {mode === "airport_start" ? (
        <TerminalSelect
          scenario="airport_start"
          label="上车地点"
          value={from}
          onChange={(point) => {
            setFrom(point);
            onPick(point, mode);
          }}
          onExit={() => setMode(null)}
        />
      ) : (
        <p>普通地址输入</p>
      )}
    </>
  );
}

test("机场接机开始：按航站楼选，交出航站楼坐标；有计时提示；改填其他地点退出", async () => {
  const calls = stubApiWith((call) => (call.url.pathname === "/site/v1/charter-airports" ? json(200, { items: [NARITA] }) : null));
  const picked: TripPoint[] = [];
  render(<Harness onPick={(point) => point !== null && picked.push(point)} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场接机开始" }));
  assert.equal(screen.getByRole("button", { name: "机场接机开始" }).getAttribute("aria-pressed"), "true");
  const select = (await screen.findByLabelText("上车地点（选择航站楼）")) as HTMLSelectElement;
  await waitFor(() => assert.equal(select.disabled, false));
  assert.equal(calls[0]?.path.includes("scenario=airport_start"), true);
  assert.deepEqual([...select.options].map((option) => option.textContent), ["选择航站楼", "成田机场 第 1 航站楼", "成田机场 第 2 航站楼"]);
  assert.ok(screen.getByText(/包车从预约的上车时间开始计时，没有免费等待/));
  await user.selectOptions(select, "33333333-3333-4333-8333-333333333331");
  assert.deepEqual(picked, [{ name: "成田机场 第 1 航站楼", lat: 35.77, lng: 140.385, kind: "airport" }]);
  await user.click(screen.getByRole("button", { name: "改填其他地点" }));
  assert.ok(screen.getByText("普通地址输入"));
});

test("航站楼名称：和机场同名或没有中文名时只写机场名", () => {
  assert.equal(terminalPoint(NARITA, { ...NARITA.terminals[0]!, name: { zh: "成田机场" } }).name, "成田机场");
});
