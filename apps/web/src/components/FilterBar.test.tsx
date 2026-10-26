import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { SearchBox } from "./FilterBar.tsx";

afterEach(cleanup);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const inRouter = (node: ReactNode, path = "/"): ReactNode => <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>;

function Where() {
  const location = useLocation();
  return <output aria-label="地址">{`${location.pathname}${location.search}`}</output>;
}

test("搜索框：按 Enter 查过之后马上「清空筛选」，还没到点的延时查询作废，不会把旧关键字又写回去", async () => {
  const searched: string[] = [];
  let clear = (): void => undefined;
  function Harness() {
    const [q, setQ] = useState("");
    clear = () => setQ("");
    return (
      <>
        <SearchBox label="按名称搜索" value={q} onSearch={(value) => { searched.push(value); setQ(value); }} />
        <output>{`q=${q}`}</output>
      </>
    );
  }
  render(inRouter(<Harness />));
  const box = screen.getByRole("searchbox", { name: "按名称搜索" });
  fireEvent.change(box, { target: { value: "没有这个名字" } });
  fireEvent.keyDown(box, { key: "Enter" });
  assert.deepEqual(searched, ["没有这个名字"]);
  act(() => clear());
  await act(() => wait(450));
  assert.deepEqual(searched, ["没有这个名字"], "延时查询不应再触发");
  assert.ok(screen.getByText("q="));
  assert.equal((box as HTMLInputElement).value, "");
});

test("搜索框：停止输入 300ms 后查询一次；期间按 Enter 只查一次", async () => {
  const searched: string[] = [];
  render(inRouter(<SearchBox label="搜索" value="" onSearch={(value) => searched.push(value)} />));
  const box = screen.getByRole("searchbox", { name: "搜索" });
  fireEvent.change(box, { target: { value: "成田" } });
  await act(() => wait(450));
  assert.deepEqual(searched, ["成田"]);
  fireEvent.change(box, { target: { value: "羽田" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await act(() => wait(450));
  assert.deepEqual(searched, ["成田", "羽田"]);
});

test("搜索框：输入后马上点进详情页（列表卸载），延时到点后不把网址换回列表", async () => {
  const searched: string[] = [];
  function List() {
    const [params, setParams] = useSearchParams();
    return (
      <>
        <SearchBox label="搜索" value={params.get("q") ?? ""} onSearch={(value) => { searched.push(value); setParams({ q: value }); }} />
        <Link to="/items/1">详情</Link>
      </>
    );
  }
  render(
    inRouter(
      <>
        <Routes>
          <Route path="/items" element={<List />} />
          <Route path="/items/:id" element={<p>详情页</p>} />
        </Routes>
        <Where />
      </>,
      "/items",
    ),
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索" }), { target: { value: "成田" } });
  fireEvent.click(screen.getByRole("link", { name: "详情" }));
  await act(() => wait(450));
  assert.deepEqual(searched, []);
  assert.equal(screen.getByRole("status", { name: "地址" }).textContent, "/items/1");
  assert.ok(screen.getByText("详情页"));
});

test("搜索框：输入后马上换了路由、搜索框还留在页面上（同一个布局里），延时到点后也不改网址", async () => {
  const searched: string[] = [];
  function Layout() {
    const navigate = useNavigate();
    return (
      <>
        <SearchBox label="搜索" value="" onSearch={(value) => { searched.push(value); navigate({ pathname: "/items", search: `?q=${value}` }); }} />
        <Link to="/items/1">详情</Link>
      </>
    );
  }
  render(
    inRouter(
      <>
        <Routes>
          <Route path="/items/*" element={<Layout />} />
        </Routes>
        <Where />
      </>,
      "/items",
    ),
  );
  const box = screen.getByRole("searchbox", { name: "搜索" });
  fireEvent.change(box, { target: { value: "成田" } });
  fireEvent.click(screen.getByRole("link", { name: "详情" }));
  await act(() => wait(450));
  assert.deepEqual(searched, [], "离开列表后不再查询");
  assert.equal(screen.getByRole("status", { name: "地址" }).textContent, "/items/1");
  // 还在这个页面上继续输入：照常 300ms 后查询
  fireEvent.change(box, { target: { value: "羽田" } });
  await act(() => wait(450));
  assert.deepEqual(searched, ["羽田"]);
});
