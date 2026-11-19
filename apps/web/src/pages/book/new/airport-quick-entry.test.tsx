/**
 * 包车快捷入口（M9P-22，ADR 0098 第三节第 7 小节；业主 2026-11-19 改成地址搜索 + 按坐标认机场）的组件测试：
 * - 两个按钮切换；那一端还没选地点时提示在地址搜索里输入机场名（任何语言）；「机场接机开始」提示从预约时间开始计时；
 * - 选了地点后按坐标认机场（`/site/v1/airports/at`，带地址搜索给的类型）：认出航站楼只显示「已识别」；
 *   认出机场没认出航站楼：登记了航站楼就下拉选填（不选 = 客人选的地点），没登记就自己填（可空）；认不出 / 出错都不卡住；
 * - 客人在地址搜索里换了地点就重新认；「改填其他地点」退出。接口用测试替身（地址搜索本身由页面级测试覆盖）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { SiteAirportAt } from "../../../api/site.ts";
import type { TripPoint } from "../../../lib/book-new.ts";
import { type ApiCall, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { AirportMatch, type AirportQuickMode, AirportQuickButtons, terminalPoint } from "./AirportQuickEntry.tsx";

afterEach(() => {
  cleanup();
  resetBrowser();
});

type Airport = NonNullable<SiteAirportAt["airport"]>;
const NARITA: Airport = {
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
/** 没有中文名、没登记航站楼的机场 */
const HANEDA: Airport = { id: "44444444-4444-4444-8444-444444444444", code: "HND", name: { ja: "東京国際空港", en: "Tokyo Haneda International Airport" }, city_id: NARITA.city_id, location: { lng: 139.7798, lat: 35.5494 }, terminals: [] };

/** 地址搜索选中的地点 */
const NARITA_T1_PLACE: TripPoint = { name: "成田空港 第1ターミナル", lat: 35.7701, lng: 140.3852, kind: "airport" };
const NARITA_PLACE: TripPoint = { name: "Narita International Airport", lat: 35.7647, lng: 140.3863, kind: "airport" };
const HANEDA_PLACE: TripPoint = { name: "羽田空港", lat: 35.5494, lng: 139.7798, kind: "airport" };
const SHINJUKU: TripPoint = { name: "新宿駅", lat: 35.6896, lng: 139.7006, kind: "other" };

let setOutside: ((point: TripPoint | null) => void) | null = null;
function Harness({ scenario = "airport_start", onPick }: { scenario?: "airport_start" | "airport_end"; onPick(point: TripPoint): void }) {
  const [mode, setMode] = useState<AirportQuickMode>(null);
  const [point, setPoint] = useState<TripPoint | null>(null);
  setOutside = setPoint;
  return (
    <>
      <AirportQuickButtons mode={mode} onMode={setMode} />
      {mode === scenario ? (
        <AirportMatch
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

/** 页面上那一端的地址搜索选了地点（这里由外面直接改值） */
const choose = (point: TripPoint | null): void => {
  act(() => setOutside?.(point));
};
type Answer = { airport: Airport | null; terminal_id: string | null } | "fail";
const stubAt = (answer: (call: ApiCall) => Answer): ApiCall[] =>
  stubApiWith((call) => {
    if (call.url.pathname !== "/site/v1/airports/at") return null;
    const body = answer(call);
    return body === "fail" ? json(503, { error: { code: "SITE_NOT_OPEN", message: "x", details: {} } }) : json(200, body);
  });

test("还没选地点：提示在地址搜索里输入机场名（任何语言）；接机开始有计时提示；改填其他地点退出", async () => {
  stubAt(() => ({ airport: null, terminal_id: null }));
  render(<Harness onPick={() => undefined} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场接机开始" }));
  assert.equal(screen.getByRole("button", { name: "机场接机开始" }).getAttribute("aria-pressed"), "true");
  assert.ok(screen.getByText("在上面的「上车地点」里输入机场名称或地址（任何语言都可以，如 成田机场、Narita Airport、羽田第 3 ターミナル），选中后自动识别机场和航站楼"));
  assert.ok(screen.getByText(/包车从预约的上车时间开始计时，没有免费等待。建议把上车时间定在航班落地后 60–90 分钟/));
  await user.click(screen.getByRole("button", { name: "改填其他地点" }));
  assert.ok(screen.getByText("普通地址输入"));
});

test("认出航站楼：只显示「已识别：成田机场 第 1 航站楼」，不出选填，地点不改；请求带坐标和地址搜索给的类型", async () => {
  const calls = stubAt(() => ({ airport: NARITA, terminal_id: NARITA.terminals[0]!.id }));
  const picked: TripPoint[] = [];
  render(<Harness onPick={(point) => picked.push(point)} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "机场接机开始" }));
  choose(NARITA_T1_PLACE);
  await screen.findByText("已识别：成田机场 第 1 航站楼");
  assert.ok(calls.some((call) => call.path === "/site/v1/airports/at?lat=35.7701&lng=140.3852&kind=airport"), JSON.stringify(calls.map((call) => call.path)));
  assert.equal(screen.queryByLabelText(/航站楼，选填/), null);
  assert.deepEqual(picked, []);
});

test("认出机场、没认出航站楼、登记了航站楼：下拉选填——选了交出航站楼坐标，改回「不指定」交回客人选的地点", async () => {
  const calls = stubAt(() => ({ airport: NARITA, terminal_id: null }));
  const picked: TripPoint[] = [];
  render(<Harness onPick={(point) => picked.push(point)} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场接机开始" }));
  choose(NARITA_PLACE);
  await screen.findByText("已识别：成田机场");
  const select = screen.getByLabelText("上车地点（航站楼，选填）") as HTMLSelectElement;
  assert.deepEqual([...select.options].map((option) => option.textContent), ["不指定航站楼", "成田机场 第 1 航站楼", "成田机场 第 2 航站楼"]);
  await user.selectOptions(select, NARITA.terminals[1]!.id);
  assert.deepEqual(picked.at(-1), { name: "成田机场 第 2 航站楼", lat: 35.765, lng: 140.388, kind: "airport" });
  // 交出去的地点不算客人新选的：不重新认、选择还在
  assert.equal((screen.getByLabelText("上车地点（航站楼，选填）") as HTMLSelectElement).value, NARITA.terminals[1]!.id);
  assert.equal(calls.length, 1);
  await user.selectOptions(screen.getByLabelText("上车地点（航站楼，选填）"), "");
  assert.deepEqual(picked.at(-1), NARITA_PLACE);
});

test("机场没登记航站楼（羽田没有中文名，按主数据的显示顺序显示英文名）：自己填航站楼（可空）；客人换了地点就重新认、清掉填的", async () => {
  let answer: Answer = { airport: HANEDA, terminal_id: null };
  stubAt(() => answer);
  const picked: TripPoint[] = [];
  render(<Harness scenario="airport_end" onPick={(point) => picked.push(point)} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "机场送机结束" }));
  // 机场送机结束不出计时提示
  assert.equal(screen.queryByText(/包车从预约的上车时间开始计时/), null);
  choose(HANEDA_PLACE);
  await screen.findByText("已识别：Tokyo Haneda International Airport");
  const free = screen.getByLabelText("上车地点（航站楼，选填）");
  await user.type(free, "第 3 航站楼");
  assert.deepEqual(picked.at(-1), { ...HANEDA_PLACE, name: "羽田空港 第 3 航站楼" });
  await user.clear(free);
  assert.deepEqual(picked.at(-1), HANEDA_PLACE);
  answer = { airport: null, terminal_id: null };
  choose(SHINJUKU);
  await screen.findByText("没有认出这是哪个机场。可以照常询价（价格按这个地点算），也可以换一个地点");
  assert.equal(screen.queryByLabelText("上车地点（航站楼，选填）"), null);
});

test("识别出错：说明可以照常询价，不卡住", async () => {
  stubAt(() => "fail");
  render(<Harness onPick={() => undefined} />);
  await userEvent.setup().click(screen.getByRole("button", { name: "机场接机开始" }));
  choose(NARITA_PLACE);
  await waitFor(() => assert.ok(screen.getByText("机场识别暂时用不了，可以照常询价（价格按这个地点算）")));
  assert.ok(screen.getByRole("button", { name: "改填其他地点" }));
});

test("航站楼名称：和机场同名或没有名称时只写机场名", () => {
  assert.equal(terminalPoint("成田机场", { ...NARITA.terminals[0]!, name: { zh: "成田机场" } }).name, "成田机场");
  assert.equal(terminalPoint("成田机场", { ...NARITA.terminals[0]!, name: {} }).name, "成田机场");
});
