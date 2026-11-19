/**
 * 包车快捷入口（M9P-22，ADR 0098 第三节第 7 小节；业主 2026-11-19 改成先选机场）的组件测试：
 * - 两个按钮切换；先输入机场名称或三字码搜（`/site/v1/airports`），从候选里选机场 → 交出机场坐标；
 * - 机场登记了航站楼：下拉选（可以不指定，回到机场坐标）；没登记：客人自己填航站楼（可空），坐标仍是机场的；
 * - 搜不到、搜索出错都有说明，不卡住（「改填其他地点」一直在）；「机场接机开始」提示从预约时间开始计时。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { SiteAirport } from "../../../api/site.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { type AirportQuickMode, AirportQuickButtons, TerminalSelect, airportPoint, terminalPoint } from "./AirportQuickEntry.tsx";

afterEach(() => {
  cleanup();
  resetBrowser();
});

const NARITA: SiteAirport = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "NRT",
  name: { zh: "成田机场", en: "Narita Airport" },
  city_id: "22222222-2222-4222-8222-222222222222",
  location: { lng: 140.3887, lat: 35.7686 },
  terminals: [
    { id: "33333333-3333-4333-8333-333333333331", code: "NRT-T1", name: { zh: "第 1 航站楼" }, location: { lng: 140.385, lat: 35.77 } },
    { id: "33333333-3333-4333-8333-333333333332", code: "NRT-T2", name: { zh: "第 2 航站楼" }, location: { lng: 140.388, lat: 35.765 } },
  ],
};
/** 没登记航站楼的机场 */
const HANEDA: SiteAirport = { id: "44444444-4444-4444-8444-444444444444", code: "HND", name: { zh: "羽田机场" }, city_id: NARITA.city_id, location: { lng: 139.7798, lat: 35.5494 }, terminals: [] };

function Harness({ scenario = "airport_start", onPick }: { scenario?: "airport_start" | "airport_end"; onPick(point: TripPoint): void }) {
  const [mode, setMode] = useState<AirportQuickMode>(null);
  const [point, setPoint] = useState<TripPoint | null>(null);
  return (
    <>
      <AirportQuickButtons mode={mode} onMode={setMode} />
      {mode === scenario ? (
        <TerminalSelect
          scenario={scenario}
          label="上车地点"
          value={point}
          onChange={(next) => {
            setPoint(next);
            onPick(next);
          }}
          onExit={() => setMode(null)}
        />
      ) : (
        <p>普通地址输入</p>
      )}
    </>
  );
}

const SEARCH = "上车地点（输入机场名称或三字码）";

test("机场接机开始：输入「成田」搜机场 → 选机场交出机场坐标 → 下拉选航站楼交出航站楼坐标、改回「不指定」回到机场坐标；有计时提示；改填其他地点退出", async () => {
  const calls = stubApiWith((call) => (call.url.pathname === "/site/v1/airports" ? json(200, { items: [NARITA] }) : null));
  const picked: TripPoint[] = [];
  render(<Harness onPick={(point) => picked.push(point)} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场接机开始" }));
  assert.equal(screen.getByRole("button", { name: "机场接机开始" }).getAttribute("aria-pressed"), "true");
  assert.ok(screen.getByText(/包车从预约的上车时间开始计时，没有免费等待。建议把上车时间定在航班落地后 60–90 分钟/));
  await user.type(screen.getByLabelText(SEARCH), "成田");
  await user.click(await screen.findByRole("button", { name: "成田机场（NRT）" }, { timeout: 2000 }));
  assert.ok(calls.some((call) => call.path === `/site/v1/airports?q=${encodeURIComponent("成田")}`), JSON.stringify(calls.map((call) => call.path)));
  assert.deepEqual(picked.at(-1), { name: "成田机场", lat: 35.7686, lng: 140.3887, kind: "airport" });
  assert.ok(screen.getByText("上车地点：已选机场：成田机场（NRT）"));

  const select = screen.getByLabelText("上车地点（选择航站楼）") as HTMLSelectElement;
  assert.deepEqual([...select.options].map((option) => option.textContent), ["不指定航站楼", "成田机场 第 1 航站楼", "成田机场 第 2 航站楼"]);
  await user.selectOptions(select, NARITA.terminals[0]!.id);
  assert.deepEqual(picked.at(-1), { name: "成田机场 第 1 航站楼", lat: 35.77, lng: 140.385, kind: "airport" });
  await user.selectOptions(select, "");
  assert.deepEqual(picked.at(-1), { name: "成田机场", lat: 35.7686, lng: 140.3887, kind: "airport" });

  await user.click(screen.getByRole("button", { name: "改填其他地点" }));
  assert.ok(screen.getByText("普通地址输入"));
});

test("机场没登记航站楼（输入三字码 HND）：不出下拉，客人自己填航站楼（可空），坐标是机场的；「换一个机场」回到搜索", async () => {
  stubApiWith((call) => (call.url.pathname === "/site/v1/airports" ? json(200, { items: [HANEDA] }) : null));
  const picked: TripPoint[] = [];
  render(<Harness scenario="airport_end" onPick={(point) => picked.push(point)} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场送机结束" }));
  // 机场送机结束不出计时提示
  assert.equal(screen.queryByText(/包车从预约的上车时间开始计时/), null);
  await user.type(screen.getByLabelText(SEARCH), "HND");
  await user.click(await screen.findByRole("button", { name: "羽田机场（HND）" }, { timeout: 2000 }));
  assert.deepEqual(picked.at(-1), { name: "羽田机场", lat: 35.5494, lng: 139.7798, kind: "airport" });
  assert.equal(screen.queryByLabelText("上车地点（选择航站楼）"), null);
  const free = screen.getByLabelText("上车地点（航站楼（选填））");
  await user.type(free, "第 3 航站楼");
  assert.deepEqual(picked.at(-1), { name: "羽田机场 第 3 航站楼", lat: 35.5494, lng: 139.7798, kind: "airport" });
  await user.clear(free);
  assert.deepEqual(picked.at(-1), { name: "羽田机场", lat: 35.5494, lng: 139.7798, kind: "airport" });
  await user.click(screen.getByRole("button", { name: "换一个机场" }));
  assert.ok(screen.getByLabelText(SEARCH));
});

test("搜不到、搜索出错：都写明可以改填其他地点，不卡住", async () => {
  let fail = false;
  stubApiWith((call) => (call.url.pathname === "/site/v1/airports" ? (fail ? json(503, { error: { code: "SITE_NOT_OPEN", message: "x", details: {} } }) : json(200, { items: [] })) : null));
  render(<Harness onPick={() => undefined} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场接机开始" }));
  await user.type(screen.getByLabelText(SEARCH), "不存在");
  await waitFor(() => assert.ok(screen.getByText("没有找到这个机场，换个写法试试；也可以点「改填其他地点」直接输入地址")), { timeout: 2000 });
  fail = true;
  await user.type(screen.getByLabelText(SEARCH), "的");
  await waitFor(() => assert.ok(screen.getByText("机场搜索暂时用不了，请点「改填其他地点」直接输入地址")), { timeout: 2000 });
  assert.ok(screen.getByRole("button", { name: "改填其他地点" }));
});

test("名称：航站楼和机场同名或没有名称时只写机场名；没登记航站楼时填的航站楼接在机场名后面", () => {
  assert.equal(terminalPoint("成田机场", { ...NARITA.terminals[0]!, name: { zh: "成田机场" } }).name, "成田机场");
  assert.equal(terminalPoint("成田机场", { ...NARITA.terminals[0]!, name: {} }).name, "成田机场");
  assert.equal(airportPoint(HANEDA, "  T3 ").name, "羽田机场 T3");
});
