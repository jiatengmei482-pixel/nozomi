import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SearchBox } from "./FilterBar.tsx";

afterEach(cleanup);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  render(<Harness />);
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
  render(<SearchBox label="搜索" value="" onSearch={(value) => searched.push(value)} />);
  const box = screen.getByRole("searchbox", { name: "搜索" });
  fireEvent.change(box, { target: { value: "成田" } });
  await act(() => wait(450));
  assert.deepEqual(searched, ["成田"]);
  fireEvent.change(box, { target: { value: "羽田" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await act(() => wait(450));
  assert.deepEqual(searched, ["成田", "羽田"]);
});
