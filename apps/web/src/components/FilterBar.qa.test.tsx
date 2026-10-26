/**
 * M4-10 测试角色：搜索框停止输入 300ms 后写网址的延时，不能在用户已经离开列表后把页面换回列表。
 * 开发的用例（FilterBar.test.tsx）覆盖了「点进详情（卸载）」「换路由、搜索框还在」；这里补：
 * 浏览器后退、搜索框被条件渲染拿掉、离开后又马上回到列表、真实的 FilterBar + useFilterParam 写网址，以及正常停顿仍会查询的时间点。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { FilterBar, SearchBox, useFilterParam } from "./FilterBar.tsx";

afterEach(cleanup);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function Where() {
  const location = useLocation();
  return <output aria-label="地址">{`${location.pathname}${location.search}`}</output>;
}
const where = (): string => screen.getByRole("status", { name: "地址" }).textContent ?? "";

function inRouter(routes: ReactNode, entries: string[], index?: number): ReactNode {
  return (
    <MemoryRouter initialEntries={entries} {...(index === undefined ? {} : { initialIndex: index })}>
      <Routes>{routes}</Routes>
      <Where />
    </MemoryRouter>
  );
}

/** 真实页面的写法：FilterBar 的搜索框读写网址里的 q（useFilterParam，replace） */
function ListPage({ searched }: { searched: string[] }) {
  const [q, setQ] = useFilterParam("q");
  return (
    <>
      <FilterBar
        paramNames={["status"]}
        active={q !== null}
        onClear={() => setQ(null)}
        search={
          <SearchBox
            label="搜索订单"
            value={q ?? ""}
            onSearch={(value) => {
              searched.push(value);
              setQ(value);
            }}
          />
        }
      />
      <Link to="/orders/42">订单 42</Link>
    </>
  );
}

test("真实的 FilterBar + useFilterParam：输入后马上点进详情，过了 300ms 网址仍是详情页，没有被换回列表", async () => {
  const searched: string[] = [];
  render(inRouter([<Route key="list" path="/orders" element={<ListPage searched={searched} />} />, <Route key="detail" path="/orders/:id" element={<h1>订单详情</h1>} />], ["/orders?status=confirmed"]));
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索订单" }), { target: { value: "NZ2026" } });
  fireEvent.click(screen.getByRole("link", { name: "订单 42" }));
  await act(() => wait(500));
  assert.deepEqual(searched, []);
  assert.equal(where(), "/orders/42");
  assert.ok(screen.getByRole("heading", { name: "订单详情" }));
});

test("输入后马上按浏览器的后退（回到上一页）：到点后不查询，网址停在上一页", async () => {
  const searched: string[] = [];
  function Back() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        后退
      </button>
    );
  }
  render(
    inRouter(
      [
        <Route key="home" path="/" element={<p>首页</p>} />,
        <Route
          key="list"
          path="/orders"
          element={
            <>
              <ListPage searched={searched} />
              <Back />
            </>
          }
        />,
        <Route key="detail" path="/orders/:id" element={<h1>订单详情</h1>} />,
      ],
      ["/", "/orders"],
      1,
    ),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索订单" }), { target: { value: "成田" } });
  fireEvent.click(screen.getByRole("button", { name: "后退" }));
  await act(() => wait(500));
  assert.deepEqual(searched, []);
  assert.equal(where(), "/");
});

test("搜索框被条件渲染拿掉（同一路由里切换了视图）：到点后不查询", async () => {
  const searched: string[] = [];
  function Page() {
    const [showSearch, setShowSearch] = useState(true);
    return (
      <>
        {showSearch && <SearchBox label="搜索" value="" onSearch={(value) => searched.push(value)} />}
        <button type="button" onClick={() => setShowSearch(false)}>
          换成地图视图
        </button>
      </>
    );
  }
  render(inRouter([<Route key="page" path="/places" element={<Page />} />], ["/places"]));
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索" }), { target: { value: "羽田" } });
  fireEvent.click(screen.getByRole("button", { name: "换成地图视图" }));
  await act(() => wait(500));
  assert.deepEqual(searched, []);
  assert.equal(where(), "/places");
});

test("离开列表后又马上回到列表（300ms 内）：上一次没到点的输入作废，不会在回来以后突然写进网址", async () => {
  const searched: string[] = [];
  function Back() {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        返回列表
      </button>
    );
  }
  render(
    inRouter(
      [
        <Route key="list" path="/orders" element={<ListPage searched={searched} />} />,
        <Route
          key="detail"
          path="/orders/:id"
          element={
            <>
              <h1>订单详情</h1>
              <Back />
            </>
          }
        />,
      ],
      ["/orders"],
    ),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索订单" }), { target: { value: "旧关键字" } });
  fireEvent.click(screen.getByRole("link", { name: "订单 42" }));
  await act(() => wait(50));
  fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
  await act(() => wait(500));
  assert.deepEqual(searched, []);
  assert.equal(where(), "/orders");
  assert.equal((screen.getByRole("searchbox", { name: "搜索订单" }) as HTMLInputElement).value, "", "回来的列表是新的，框里是空的");
});

test("正常使用：停止输入后 300ms 之前不查询，过了 300ms 查一次并写进网址（保留别的筛选条件）；连续输入只按最后一次查", async () => {
  const searched: string[] = [];
  render(inRouter([<Route key="list" path="/orders" element={<ListPage searched={searched} />} />], ["/orders?status=confirmed"]));
  const box = screen.getByRole("searchbox", { name: "搜索订单" });
  fireEvent.change(box, { target: { value: "N" } });
  await act(() => wait(150));
  fireEvent.change(box, { target: { value: "NZ" } });
  await act(() => wait(150));
  assert.deepEqual(searched, [], "一直在输入：还没停够 300ms");
  await act(() => wait(300));
  assert.deepEqual(searched, ["NZ"]);
  assert.equal(where(), "/orders?status=confirmed&q=NZ");
});

test("搜索框所在的布局跨路由保留（不卸载）：输入后按浏览器后退换了网址，到点后不查询、不改网址；之后在新网址上照常输入仍会查询", async () => {
  const searched: string[] = [];
  function Layout() {
    const navigate = useNavigate();
    return (
      <>
        <SearchBox
          label="搜索"
          value=""
          onSearch={(value) => {
            searched.push(value);
            navigate({ pathname: "/orders", search: `?q=${value}` });
          }}
        />
        <button type="button" onClick={() => navigate(-1)}>
          后退
        </button>
      </>
    );
  }
  render(inRouter([<Route key="layout" path="/orders/*" element={<Layout />} />], ["/orders/7", "/orders"], 1));
  const box = screen.getByRole("searchbox", { name: "搜索" });
  fireEvent.change(box, { target: { value: "成田" } });
  fireEvent.click(screen.getByRole("button", { name: "后退" }));
  await act(() => wait(500));
  assert.deepEqual(searched, []);
  assert.equal(where(), "/orders/7");
  fireEvent.change(box, { target: { value: "羽田" } });
  await act(() => wait(500));
  assert.deepEqual(searched, ["羽田"]);
});
