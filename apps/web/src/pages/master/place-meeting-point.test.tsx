/** 主数据地点编辑页：机场、航站楼的「地址」「集合地点说明」（M12-06）。接口用测试替身，路由表用真实的 <App>。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { City, Place } from "../../api/master.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const HND_ID = "33333333-3333-4333-8333-333333333333";
const T3_ID = "44444444-4444-4444-8444-444444444444";
const STATION_ID = "55555555-5555-4555-8555-555555555555";
const POI_ID = "66666666-6666-4666-8666-666666666666";

const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 }, boundary: null, status: "active", version: 3, ...stamps };
const hnd: Place = {
  id: HND_ID,
  type: "airport",
  charter_coverage: false,
  code: "HND",
  country_code: "JP",
  city_id: TOKYO_ID,
  parent_id: null,
  city: { id: TOKYO_ID, code: tokyo.code, name: tokyo.name },
  parent: null,
  name: { zh: "东京羽田机场" },
  location: { lng: 139.781111, lat: 35.553333 },
  category: null,
  flight_scope: null,
  address: null,
  meeting_point: null,
  source: null,
  status: "active",
  version: 4,
  ...stamps,
};
const t3: Place = { ...hnd, id: T3_ID, type: "terminal", code: "HND-T3", parent_id: HND_ID, parent: { id: HND_ID, code: "HND", name: hnd.name, type: "airport" }, name: { zh: "第 3 航站楼" }, meeting_point: { zh: "2 楼到达大厅", en: "Arrivals lobby, 2F" }, address: "〒144-0041 東京都大田区羽田空港2-6-5", version: 2 };
const station: Place = { ...hnd, id: STATION_ID, type: "station", code: "STN-JP-TOKYO", name: { zh: "东京站" }, category: "rail", version: 1 };
const poi: Place = { ...hnd, id: POI_ID, type: "poi", code: "POI-000123", name: { zh: "东京塔" }, category: "attraction", version: 1 };

const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[]) => json(200, { items, next_cursor: null, total: items.length });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/cities") return page([tokyo]);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/places") return page([]);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const written = (calls: ApiCall[]) => calls.filter((call) => call.method !== "GET");
const fieldset = (): HTMLElement => screen.getByRole("group", { name: "集合地点说明" });

test("机场编辑页：填地址和集合地点（中文、日文），只提交改过的两项，去掉首尾空白、空着的语言不提交；If-Match 带版本号", async () => {
  const calls = open(`/platform/master/places/${HND_ID}`, "master_data", (call) => {
    if (call.url.pathname !== `/platform/v1/master/places/${HND_ID}`) return null;
    return call.method === "GET" ? json(200, hnd) : json(200, { ...hnd, address: "〒144-0041 東京都大田区羽田空港3-3-2", meeting_point: { zh: "到达大厅出口外", ja: "到着ロビー出口" }, version: 5 });
  });
  const user = userEvent.setup();
  const address = await screen.findByLabelText("地址（选填）");
  assert.ok(screen.getByText(/日文地址，含邮编/));
  assert.ok(within(fieldset()).getByText(/只有一个航站楼的机场写在这里/));
  await user.type(address, " 〒144-0041 東京都大田区羽田空港3-3-2 ");
  await user.type(within(fieldset()).getByLabelText("中文"), "到达大厅出口外 ");
  await user.type(within(fieldset()).getByLabelText("日文（选填）"), "到着ロビー出口");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("已保存「东京羽田机场」"));
  const patch = written(calls)[0];
  assert.equal(patch?.method, "PATCH");
  assert.deepEqual(patch?.body, { address: "〒144-0041 東京都大田区羽田空港3-3-2", meeting_point: { zh: "到达大厅出口外", ja: "到着ロビー出口" } });
  assert.equal(patch?.headers["if-match"], '"4"');
});

test("集合地点：只填日文没填中文时报错、不发请求；超过 1000 字报错", async () => {
  const calls = open(`/platform/master/places/${HND_ID}`, "master_data", (call) => (call.url.pathname === `/platform/v1/master/places/${HND_ID}` ? json(200, hnd) : null));
  const user = userEvent.setup();
  await screen.findByLabelText("地址（选填）");
  await user.type(within(fieldset()).getByLabelText("日文（选填）"), "到着ロビー");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await within(fieldset()).findByText("填了日文或英文时，中文必填"));
  assert.ok(screen.getByRole("button", { name: "集合地点说明" }), "出错汇总里有这一项");
  await user.clear(within(fieldset()).getByLabelText("日文（选填）"));
  await user.click(within(fieldset()).getByLabelText("英文（选填）"));
  await user.paste("x".repeat(1001));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await within(fieldset()).findByText("最多 1000 个字"));
  assert.deepEqual(written(calls), []);
});

test("航站楼编辑页：带出已有的地址和集合地点；清空集合地点提交 null；后端的校验说明显示在对应语言下", async () => {
  let saves = 0;
  const calls = open(`/platform/master/places/${T3_ID}`, "master_data", (call) => {
    if (call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, hnd);
    if (call.url.pathname !== `/platform/v1/master/places/${T3_ID}`) return null;
    if (call.method === "GET") return json(200, t3);
    saves += 1;
    return saves === 1
      ? json(400, { error: { code: "VALIDATION_FAILED", message: "请求内容不正确", details: { issues: [{ path: "/meeting_point/zh", message: "不能只有空白或不可见字符" }] } } })
      : json(200, { ...t3, meeting_point: null, version: 3 });
  });
  const user = userEvent.setup();
  const zh = (await within(await screen.findByRole("group", { name: "集合地点说明" })).findByLabelText("中文")) as HTMLTextAreaElement;
  assert.equal(zh.value, "2 楼到达大厅");
  assert.equal((within(fieldset()).getByLabelText("英文（选填）") as HTMLTextAreaElement).value, "Arrivals lobby, 2F");
  assert.equal((screen.getByLabelText("地址（选填）") as HTMLInputElement).value, "〒144-0041 東京都大田区羽田空港2-6-5");
  assert.ok(within(fieldset()).getByText(/司机在这个航站楼的哪里等客人/));

  await user.clear(zh);
  await user.clear(within(fieldset()).getByLabelText("英文（选填）"));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await within(fieldset()).findByText("不能只有空白或不可见字符"));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("已保存「第 3 航站楼」"));
  const patches = written(calls);
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[1]?.body, { meeting_point: null });
  assert.equal(patches[1]?.headers["if-match"], '"2"');
});

test("新增航站楼：填了集合地点就一起提交；没填不带这一项", async () => {
  const calls = open(`/platform/master/places/new?type=terminal&parent=${HND_ID}`, "master_data", (call) => {
    if (call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, hnd);
    if (call.method === "POST" && call.url.pathname === "/platform/v1/master/places") return json(201, { ...t3, id: "77777777-7777-4777-8777-777777777777", code: "HND-T1", version: 1 });
    return null;
  });
  const user = userEvent.setup();
  const code = await screen.findByLabelText(/^编码/);
  await screen.findByDisplayValue("HND-");
  await user.type(code, "T1");
  await user.type(screen.getByLabelText("名称 中文"), "第 1 航站楼");
  await user.click(screen.getByRole("button", { name: "填入机场的坐标" }));
  await user.type(within(fieldset()).getByLabelText("中文"), "1 楼到达大厅");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(written(calls).length, 1));
  const post = written(calls)[0];
  assert.equal(post?.method, "POST");
  assert.deepEqual((post?.body as Record<string, unknown>)["meeting_point"], { zh: "1 楼到达大厅" });
  assert.equal("address" in (post?.body as Record<string, unknown>), false, "地址没填不带");
});

test("只读角色：看到地址和集合地点的文字，没有输入框；车站、地标没有集合地点，车站没有地址", async () => {
  open(`/platform/master/places/${T3_ID}`, "readonly", (call) => {
    if (call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, hnd);
    return call.url.pathname === `/platform/v1/master/places/${T3_ID}` ? json(200, t3) : null;
  });
  assert.ok(await screen.findByText("2 楼到达大厅"));
  assert.ok(screen.getByText("Arrivals lobby, 2F"));
  assert.ok(screen.getByText("〒144-0041 東京都大田区羽田空港2-6-5"));
  assertAbsent(screen.queryByRole("textbox", { name: "中文" }));
  resetBrowser();

  open(`/platform/master/places/${STATION_ID}`, "master_data", (call) => (call.url.pathname === `/platform/v1/master/places/${STATION_ID}` ? json(200, station) : null));
  await screen.findByLabelText("名称 中文");
  assertAbsent(screen.queryByText("集合地点说明"));
  assertAbsent(screen.queryByLabelText("地址（选填）"));
  resetBrowser();

  open(`/platform/master/places/${POI_ID}`, "master_data", (call) => (call.url.pathname === `/platform/v1/master/places/${POI_ID}` ? json(200, poi) : null));
  assert.ok(await screen.findByLabelText("地址（选填）"));
  assertAbsent(screen.queryByText("集合地点说明"));
  assertAbsent(screen.queryByText(/日文地址，含邮编/));
});
