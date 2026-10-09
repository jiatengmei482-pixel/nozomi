/**
 * 供应商后台「区域」的组件测试：补充（测试工程师）。areas.test.tsx 是开发自己写的。
 * 这里补的是「不丢数据」和「两个入口同一份状态」：
 * - 坐标表和撤销 / 重做：表里改一个数、加点、删点、改圆，撤销重做后表里的数跟着变；撤销后保存的就是画面上的；
 * - 粘贴替换、粘贴一个空的图形；
 * - 版本冲突后「复制我画的图形」拿到的是画面上的内容；复制不成功时要说；「载入最新内容」取不到时自己画的还在；
 * - 登录过期被送去登录页以后，画的图形能不能找回来（规范 10.7 的草稿）；
 * - 自测：同一组图形和位置，问后端的那条路和按画面算的那条路结论一致。
 * 接口用测试替身；底图配置是「没有配置」，所以全程不靠地图。名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { type Position, circleToRing, locatePoint } from "@nozomi/domain";
import { App } from "../../App.tsx";
import type { Area, AreaPolygon } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const AREA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FORBID_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CIRCLE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 3, ...stamps };
const areaCity = { id: TOKYO_ID, code: tokyo.code, name: tokyo.name, status: "active" as const, center: tokyo.center, boundary: null };
const closed = (ring: Position[]): [number, number][][] => [[...ring, ring[0] as Position]] as [number, number][][];
const OUTER: Position[] = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]];
const INNER: Position[] = [[139.68, 35.68], [139.72, 35.68], [139.72, 35.72], [139.68, 35.72]];
const CIRCLE = { center: { lat: 35.75, lng: 139.75 }, radius_m: 1000 };
const operate: AreaPolygon = { id: OPERATE_ID, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: closed(OUTER) } };
const forbid: AreaPolygon = { id: FORBID_ID, kind: "forbid", seq: 1, label: "皇居", source: "pasted", circle: null, geometry: { type: "Polygon", coordinates: closed(INNER) } };
const circle: AreaPolygon = { id: CIRCLE_ID, kind: "forbid", seq: 2, label: null, source: "circle", circle: CIRCLE, geometry: { type: "Polygon", coordinates: closed(circleToRing(CIRCLE.center, CIRCLE.radius_m)) } };
const areaOf = (overrides: Partial<Area> = {}): Area => ({ id: AREA_ID, name: { zh: "东京 23 区" }, city_id: TOKYO_ID, city: areaCity, biz_type: "general", status: "active", operate_polygon_count: 1, forbid_polygon_count: 1, usage: { product_count: 0, published_product_count: 0 }, version: 4, ...stamps, polygons: [operate, forbid], ...overrides });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, routes: Route = () => null, role = "admin"): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (call.url.pathname === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 1, disabled: 0 } });
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/cities") return json(200, { items: [tokyo], next_cursor: null, total: 1 });
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return json(200, { items: [], next_cursor: null, total: 0 });
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}`) return json(200, areaOf());
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const saveButton = (): HTMLButtonElement => screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
const cell = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const undoButton = (): HTMLButtonElement => screen.getByRole("button", { name: /撤销/ }) as HTMLButtonElement;
const redoButton = (): HTMLButtonElement => screen.getByRole("button", { name: /重做/ }) as HTMLButtonElement;

async function openEditor(user: ReturnType<typeof userEvent.setup>, routes: Route = () => null): Promise<ApiCall[]> {
  const calls = open(`/areas/${AREA_ID}`, routes);
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  await screen.findByRole("heading", { level: 3, name: "营运区（1）" });
  await user.click(document.querySelector('[data-shape="s1"] .shape__toggle') as HTMLElement);
  return calls;
}

/** 换掉 navigator.clipboard，返回被写进去的内容；`fail` 为真时写入被拒绝（浏览器不给权限时就是这样）。 */
function stubClipboard(fail = false): { written: string[]; restore(): void } {
  const written: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => (fail ? Promise.reject(new DOMException("denied", "NotAllowedError")) : (written.push(text), Promise.resolve())) },
  });
  return {
    written,
    restore: () => {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as unknown as Record<string, unknown>)["clipboard"];
    },
  };
}

// ───────────── 坐标表和撤销 / 重做 ─────────────

test("坐标表里加点、删点、改圆的半径、删一块：每个操作后表里的行数和数值跟着变；撤销、重做后表里显示的也跟着变；撤销回原样后没有「未保存的修改」，直接保存不发请求", async () => {
  const user = userEvent.setup();
  const calls = await openEditor(user, (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}` ? json(200, areaOf({ polygons: [operate, forbid, circle], forbid_polygon_count: 2 })) : null));
  const summary = (): string => document.querySelector(".area-editor__summary")?.textContent ?? "";
  const shapeText = (key: string): string => document.querySelector(`[data-shape="${key}"] .shape__summary`)?.textContent ?? "";
  assert.equal(cell("营运 1 第 1 个点的纬度").value, "35.600000");
  assert.equal(undoButton().disabled, true);

  await user.click(screen.getByRole("button", { name: "在 营运 1 第 4 个点后面加一个点" }));
  assert.equal(shapeText("s1"), "多边形 · 5 个点");
  assert.equal(cell("营运 1 第 5 个点的纬度").value, "");
  await user.click(screen.getByRole("button", { name: "删除 营运 1 第 5 个点" }));
  assert.equal(shapeText("s1"), "多边形 · 4 个点");
  await user.click(screen.getByRole("button", { name: "删除 营运 1 第 2 个点" }));
  assert.equal(shapeText("s1"), "多边形 · 3 个点");
  assert.equal(cell("营运 1 第 2 个点的经度").value, "139.800000");
  assert.equal(cell("营运 1 第 2 个点的纬度").value, "35.800000", "删掉第 2 个点后，原来的第 3 个点顶上来");
  assert.equal((screen.getByRole("button", { name: "删除 营运 1 第 1 个点" }) as HTMLButtonElement).disabled, true, "只剩 3 个点时不能再删");
  assert.match(summary(), /有未保存的修改/);

  await user.click(undoButton());
  assert.equal(shapeText("s1"), "多边形 · 4 个点");
  assert.equal(cell("营运 1 第 2 个点的纬度").value, "35.600000", "撤销后表里的数回来了");
  await user.click(redoButton());
  assert.equal(cell("营运 1 第 2 个点的纬度").value, "35.800000");
  await user.click(undoButton());
  await user.click(undoButton());
  await user.click(undoButton());
  assert.equal(undoButton().disabled, true);
  assert.equal(shapeText("s1"), "多边形 · 4 个点");
  assert.doesNotMatch(summary(), /有未保存的修改/, "撤销回原样算没改");

  // 删一块再撤销：它带着原来的名字、备注名回来
  await user.click(screen.getByRole("button", { name: "禁行 1 · 皇居 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除这一块" }));
  await screen.findByRole("heading", { level: 3, name: "禁行区（1）" });
  await user.click(undoButton());
  await screen.findByRole("heading", { level: 3, name: "禁行区（2）" });
  assert.match(document.querySelector('[data-shape="s2"]')?.textContent ?? "", /禁行 1 · 皇居/);
  assert.doesNotMatch(summary(), /有未保存的修改/);

  // 圆转成多边形，再撤销回圆
  await user.click(document.querySelector('[data-shape="s3"] .shape__toggle') as HTMLElement);
  assert.equal((screen.getByLabelText("禁行 2 半径（公里）") as HTMLInputElement).value, "1");
  await user.click(screen.getByRole("button", { name: "禁行 2 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "转成多边形" }));
  assert.equal(shapeText("s3"), "多边形 · 64 个点");
  await user.click(undoButton());
  assert.equal(shapeText("s3"), "圆 · 半径 1 公里");
  assert.doesNotMatch(summary(), /有未保存的修改/);

  await user.click(saveButton());
  await screen.findByRole("heading", { level: 1, name: "区域" });
  assert.equal(writes(calls).length, 0, "撤销回原样以后保存不发请求");
});

test("撤销后保存：提交的是撤销以后画面上的内容，被撤销掉的那一步不在里面", async () => {
  const user = userEvent.setup();
  const calls = await openEditor(user, (call) => (call.method === "PUT" ? json(200, areaOf({ version: 5 })) : null));
  await user.click(screen.getByRole("button", { name: "删除 营运 1 第 4 个点" }));
  await user.click(screen.getByRole("button", { name: "禁行 1 · 皇居 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除这一块" }));
  await screen.findByRole("heading", { level: 3, name: "禁行区（0）" });
  await user.click(undoButton());
  await screen.findByRole("heading", { level: 3, name: "禁行区（1）" });
  await user.click(saveButton());
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const put = writes(calls)[0] as ApiCall;
  assert.equal(put.headers["if-match"], '"4"');
  assert.deepEqual(put.body, {
    name: { zh: "东京 23 区" },
    biz_type: "general",
    polygons: [
      { id: OPERATE_ID, kind: "operate", label: null, source: "drawn", geometry: { type: "Polygon", coordinates: closed(OUTER.slice(0, 3)) } },
      { id: FORBID_ID, kind: "forbid", label: "皇居", source: "pasted", geometry: forbid.geometry },
    ],
  });
});

test("【缺陷】坐标表里把一个格子改成另一个数（规范 7.6：一个格子的一次生效算一步）：点一次「撤销」应当回到改之前的数，实际每打一个字符记一步——打 9 个字符要点 9 次，100 步的撤销记录很快被占满", async () => {
  const user = userEvent.setup();
  await openEditor(user);
  const input = cell("营运 1 第 1 个点的纬度");
  assert.equal(input.value, "35.600000");
  await user.clear(input);
  await user.type(input, "35.612345");
  await user.tab();
  assert.equal(cell("营运 1 第 1 个点的纬度").value, "35.612345");
  await user.click(undoButton());
  assert.equal(cell("营运 1 第 1 个点的纬度").value, "35.600000", "点一次撤销后格子里的数");
  assert.equal(undoButton().disabled, true, "这一处修改只应当占一步撤销");
});

// ───────────── 粘贴 ─────────────

test("粘贴坐标替换一块：名字、类型、编号不变，形状换成粘贴的；是一步撤销；原来是圆的变成多边形", async () => {
  const user = userEvent.setup();
  const calls = await openEditor(user, (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}`) return json(200, areaOf({ polygons: [operate, forbid, circle], forbid_polygon_count: 2 }));
    return call.method === "PUT" ? json(200, areaOf({ version: 5 })) : null;
  });
  await user.click(screen.getByRole("button", { name: "禁行 2 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "粘贴坐标替换" }));
  const dialog = await screen.findByRole("dialog", { name: "粘贴坐标替换「禁行 2」" });
  const text = within(dialog).getByLabelText(/内容/);
  // 两个多边形：替换时不接受
  await user.click(text);
  await user.paste("MULTIPOLYGON(((139.7 35.7,139.71 35.7,139.71 35.71,139.7 35.7)),((139.72 35.7,139.73 35.7,139.73 35.71,139.72 35.7)))");
  await user.click(within(dialog).getByRole("button", { name: "替换" }));
  assert.match(dialog.textContent ?? "", /这里要的是一个多边形，这段内容里有 2 个/);
  await user.clear(text);
  await user.click(text);
  await user.paste("POLYGON((139.7 35.7,139.71 35.7,139.71 35.71,139.7 35.71,139.7 35.7))");
  await user.click(within(dialog).getByRole("button", { name: "替换" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog", { name: /粘贴坐标替换/ }), null));
  assert.match(document.querySelector('[data-shape="s3"]')?.textContent ?? "", /禁行 2.*多边形 · 4 个点/);
  await user.click(undoButton());
  assert.match(document.querySelector('[data-shape="s3"]')?.textContent ?? "", /圆 · 半径 1 公里/);
  await user.click(redoButton());
  await user.click(saveButton());
  await waitFor(() => assert.equal(writes(calls).length, 1));
  const sent = (writes(calls)[0]?.body as { polygons: Record<string, unknown>[] }).polygons[2];
  assert.deepEqual(sent, { id: CIRCLE_ID, kind: "forbid", label: null, source: "pasted", geometry: { type: "Polygon", coordinates: [[[139.7, 35.7], [139.71, 35.7], [139.71, 35.71], [139.7, 35.71], [139.7, 35.7]]] } });
});

test("【缺陷】粘贴一个空的多边形（{\"type\":\"Polygon\",\"coordinates\":[[]]}）：应当说明「里面没有多边形」，实际识别为「1 个多边形，共 0 个点」并加进来一块没有任何坐标行、也没有加点按钮的图形（只能删掉）", async () => {
  const user = userEvent.setup();
  await openEditor(user);
  await user.click(screen.getByRole("toolbar", { name: "绘制工具" }).querySelector("button:nth-of-type(4)") as HTMLElement);
  const dialog = await screen.findByRole("dialog", { name: "粘贴坐标" });
  await user.click(within(dialog).getByLabelText(/内容/));
  await user.paste('{"type":"Polygon","coordinates":[[]]}');
  await user.click(within(dialog).getByRole("button", { name: "添加到地图" }));
  assert.ok(screen.queryByRole("dialog", { name: "粘贴坐标" }) !== null, "对话框应当留着并说明原因");
  assert.match(dialog.textContent ?? "", /没有多边形/);
  assert.equal(screen.queryByRole("heading", { level: 3, name: "营运区（2）" }), null, "不应当加进来一块没有点的图形");
});

// ───────────── 版本冲突：不丢数据 ─────────────

/** 改一个顶点、加一块禁行区（逐点输入），然后保存撞上版本冲突。返回当时画面上应有的图形。 */
async function editThenConflict(user: ReturnType<typeof userEvent.setup>, extra: Route = () => null): Promise<ApiCall[]> {
  let latest = areaOf();
  const calls = await openEditor(user, (call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method === "PUT") {
      latest = areaOf({ version: 9, name: { zh: "别人改的名字" }, polygons: [operate] });
      return apiError(409, "VERSION_CONFLICT", "stale", { current_version: 9 });
    }
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}`) return json(200, latest);
    return null;
  });
  const lat = cell("营运 1 第 1 个点的纬度");
  await user.clear(lat);
  await user.type(lat, "35.5");
  await user.click(screen.getByRole("button", { name: /^添加禁行区/ }));
  await user.click(screen.getByRole("menuitem", { name: "逐点输入坐标" }));
  const mine: Position[] = [[139.61, 35.61], [139.62, 35.61], [139.62, 35.62]];
  for (const [index, point] of mine.entries()) {
    await user.type(cell(`禁行 2 第 ${index + 1} 个点的纬度`), String(point[1]));
    await user.type(cell(`禁行 2 第 ${index + 1} 个点的经度`), String(point[0]));
  }
  await user.click(saveButton());
  await screen.findByText("这个区域刚被别人修改过，你的修改还没有保存。");
  return calls;
}

test("版本冲突后「复制我画的图形」：复制出来的是画面上的全部图形（含没保存的改动和新加的一块），每一块带类型和名字；复制以后画面原样、保存仍然禁用", async () => {
  const user = userEvent.setup();
  const clipboard = stubClipboard();
  try {
    await editThenConflict(user);
    await user.click(screen.getByRole("button", { name: "复制我画的图形" }));
    await screen.findByText("已复制");
    assert.equal(clipboard.written.length, 1);
    const copied = JSON.parse(clipboard.written[0] as string) as { type: string; features: { properties: { kind: string; name: string }; geometry: { coordinates: Position[][] } }[] };
    assert.equal(copied.type, "FeatureCollection");
    assert.deepEqual(copied.features.map((feature) => [feature.properties.kind, feature.properties.name]), [["operate", "营运 1"], ["forbid", "禁行 1 · 皇居"], ["forbid", "禁行 2"]]);
    assert.deepEqual(copied.features[0]?.geometry.coordinates[0]?.[0], [139.6, 35.5], "没保存的那个改动在里面");
    assert.deepEqual(copied.features[2]?.geometry.coordinates[0], [[139.61, 35.61], [139.62, 35.61], [139.62, 35.62], [139.61, 35.61]]);
    assert.equal(saveButton().disabled, true);
    assert.equal(cell("营运 1 第 1 个点的纬度").value, "35.500000");
    await screen.findByRole("heading", { level: 3, name: "禁行区（2）" });
  } finally {
    clipboard.restore();
  }
});

test("【缺陷】版本冲突后「复制我画的图形」而浏览器不让写剪贴板：应当告诉用户没有复制成功（否则他接着点「载入最新内容」，自己画的就没了），实际什么提示都没有", async () => {
  const user = userEvent.setup();
  const clipboard = stubClipboard(true);
  try {
    await editThenConflict(user);
    await user.click(screen.getByRole("button", { name: "复制我画的图形" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(screen.queryByText("已复制"), null);
    assert.match(document.body.textContent ?? "", /没有复制成功|复制失败|没能复制|无法复制|不能复制/, "复制不成功时页面上应当有说明");
  } finally {
    clipboard.restore();
  }
});

test("版本冲突后「载入最新内容」时网络不通：自己画的图形还在画面上（还能复制），可以再点一次；取到以后才换成最新内容", async () => {
  const user = userEvent.setup();
  const clipboard = stubClipboard();
  let failing = false;
  try {
    await editThenConflict(user, (call) => (failing && call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}` ? Promise.reject(new TypeError("Failed to fetch")) : null));
    failing = true;
    await user.click(screen.getByRole("button", { name: "载入最新内容" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(screen.queryByLabelText("营运 1 第 1 个点的纬度") !== null, "取不到最新内容时，自己画的图形应当还在画面上");
    assert.equal(cell("营运 1 第 1 个点的纬度").value, "35.500000");
    assert.ok(screen.queryByRole("heading", { level: 3, name: "禁行区（2）" }) !== null);
    await user.click(screen.getByRole("button", { name: "复制我画的图形" }));
    await waitFor(() => assert.equal(clipboard.written.length, 1));
    failing = false;
    await user.click(screen.getByRole("button", { name: "载入最新内容" }));
    await screen.findByText("已载入最新内容。");
    assert.equal((screen.getByLabelText("中文") as HTMLInputElement).value, "别人改的名字");
    await screen.findByRole("heading", { level: 3, name: "禁行区（0）" });
    assert.equal(undoButton().disabled, true, "载入最新内容以后撤销记录清空");
  } finally {
    clipboard.restore();
  }
});

test("【缺陷】登录过期：保存时接口返回 401 被送去登录页；重新登录回到这个页面后，应当提示「有一份上次没保存的修改」并能恢复（规范 10.2、10.7 的草稿），实际没有草稿，画的图形全部丢失", async () => {
  const user = userEvent.setup();
  await openEditor(user, (call) => (call.method === "PUT" ? apiError(401, "UNAUTHENTICATED", "expired") : null));
  await user.click(screen.getByRole("button", { name: /^添加禁行区/ }));
  await user.click(screen.getByRole("menuitem", { name: "逐点输入坐标" }));
  for (const [index, point] of ([[139.61, 35.61], [139.62, 35.61], [139.62, 35.62]] as Position[]).entries()) {
    await user.type(cell(`禁行 2 第 ${index + 1} 个点的纬度`), String(point[1]));
    await user.type(cell(`禁行 2 第 ${index + 1} 个点的经度`), String(point[0]));
  }
  // 规范：内容变化后 1 秒内写入草稿
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  await user.click(saveButton());
  await screen.findByRole("button", { name: "登录" });
  const drafts = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index) ?? "");
  // 重新登录后再打开同一个页面（同一个标签页：sessionStorage 还在）
  render(<span />).unmount();
  document.body.innerHTML = "";
  open(`/areas/${AREA_ID}`);
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  await screen.findByRole("heading", { level: 3, name: "禁行区（1）" });
  assert.ok(drafts.length > 0 && screen.queryByText(/有一份上次没保存的修改/) !== null, `登录回来以后应当能找回没保存的图形；sessionStorage 里的键：${JSON.stringify(drafts)}`);
});

// ───────────── 自测：两条路的结论一致 ─────────────

test("自测的两条路（规范 9.3）：同一组图形、同一批位置，「没改过 → 问后端」和「改过 → 按画面算」的结论、列出的图形名字逐个相同；后端的应答由 domain 的同一个函数按保存的图形算出", async () => {
  const user = userEvent.setup();
  const stored = [operate, forbid, circle].map((polygon) => ({ id: polygon.id, kind: polygon.kind, ring: polygon.geometry.coordinates[0]?.slice(0, -1) as Position[] }));
  const checks: { lat: number; lng: number }[] = [];
  const calls = await openEditor(user, (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}`) return json(200, areaOf({ polygons: [operate, forbid, circle], forbid_polygon_count: 2 }));
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/areas/${AREA_ID}/check-point`) {
      const point = call.body as { lat: number; lng: number };
      checks.push(point);
      const located = locatePoint(stored, point);
      return json(200, { result: located.result, operate_polygon_ids: located.operatePolygonIds, forbid_polygon_ids: located.forbidPolygonIds });
    }
    return null;
  });
  const points: [number, number][] = [
    [35.61, 139.61], // 营运区里
    [35.7, 139.7], // 禁行 1 里
    [35.75, 139.75], // 圆（禁行 2）的圆心
    [35.6, 139.7], // 营运区的边上
    [35.68, 139.68], // 禁行 1 的顶点上
    [35.758, 139.75], // 圆里靠近边
    [35.7595, 139.75], // 圆外一点，仍在营运区里
    [35.9, 139.9], // 都不在
    [35.8, 139.8], // 营运区的顶点
  ];
  const card = document.querySelector(".area-editor__probe") as HTMLElement;
  const probe = async (lat: number, lng: number): Promise<string> => {
    const latInput = within(card).getByLabelText(/^纬度/) as HTMLInputElement;
    const lngInput = within(card).getByLabelText(/^经度/) as HTMLInputElement;
    await user.clear(latInput);
    await user.type(latInput, String(lat));
    await user.clear(lngInput);
    await user.type(lngInput, String(lng));
    const before = checks.length;
    await user.click(within(card).getByRole("button", { name: "检查" }));
    await waitFor(() => assert.ok((card.querySelector(".probe")?.textContent ?? "").includes("这个位置")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    return `${(card.querySelector(".probe .probe__sentence")?.textContent ?? "").trim()}|${card.querySelector(".probe .badge, .probe [class*=badge]")?.textContent ?? ""}|${checks.length - before}`;
  };
  const viaBackend: string[] = [];
  for (const [lat, lng] of points) viaBackend.push(await probe(lat, lng));
  assert.ok(viaBackend.every((entry) => entry.endsWith("|1")), "没改过图形时每次都问后端");
  assert.doesNotMatch(card.textContent ?? "", /按画面上还没保存的图形判断/);

  // 只改备注名：图形的坐标没变，但页面上有未保存的修改 → 按画面算
  await user.click(screen.getByRole("button", { name: "禁行 2 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "改备注名" }));
  const rename = await screen.findByRole("dialog", { name: "改备注名" });
  await user.type(within(rename).getByLabelText(/备注名/), "x");
  await user.click(within(rename).getByRole("button", { name: "确定" }));
  await waitFor(() => assert.match(document.querySelector('[data-shape="s3"]')?.textContent ?? "", /禁行 2 · x/));
  const viaScreen: string[] = [];
  for (const [lat, lng] of points) viaScreen.push(await probe(lat, lng));
  assert.ok(viaScreen.every((entry) => entry.endsWith("|0")), "有未保存的修改时不问后端");
  assert.match(card.textContent ?? "", /按画面上还没保存的图形判断/);
  // 名字里多了备注名「x」，去掉以后两条路的句子、徽标逐个相同
  const strip = (entry: string): string => entry.replace(/\|[01]$/, "").replace(" · x", "");
  assert.deepEqual(viaScreen.map(strip), viaBackend.map(strip));
  assert.equal(new Set(viaBackend.map((entry) => entry.split("|")[1])).size, 3, "三种结果都出现过");
  assert.equal(writes(calls).filter((call) => !call.path.endsWith("/check-point")).length, 0);
});
