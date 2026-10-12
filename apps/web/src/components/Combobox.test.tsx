import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { assertAbsent, resetBrowser } from "../testing/harness.tsx";
import { Combobox } from "./Combobox.tsx";

afterEach(resetBrowser);

const CITIES = [
  { value: "fuk", label: "福冈", detail: "CTY-JP-FUK" },
  { value: "fks", label: "福岛", detail: "CTY-JP-FKS" },
  { value: "fki", label: "福井", detail: "CTY-JP-FKI" },
  { value: "tyo", label: "东京", detail: "CTY-JP-TYO" },
];

function Harness({ onSubmit }: { onSubmit(): void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Combobox label="所属城市" options={CITIES} value={value} onChange={setValue} />
      <output data-testid="value">{value ?? ""}</output>
      <button type="submit">提交</button>
    </form>
  );
}

const chosen = (): string => screen.getByTestId("value").textContent ?? "";
const highlighted = (): string[] => [...document.querySelectorAll(".combobox__option--active")].map((option) => option.textContent ?? "");

test("多个匹配项：输入后第一个匹配项是暂定的高亮；「输入 → ↓ → Enter」选中第一个匹配项，不是第二个", async () => {
  const user = userEvent.setup();
  render(<Harness onSubmit={() => undefined} />);
  const input = screen.getByRole("combobox", { name: "所属城市" });
  await user.click(input);
  await user.keyboard("福");
  assert.deepEqual(within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent), ["福冈CTY-JP-FUK", "福岛CTY-JP-FKS", "福井CTY-JP-FKI"]);
  assert.deepEqual(highlighted(), ["福冈CTY-JP-FUK"], "输入后暂定高亮第一个");
  assert.match(input.getAttribute("aria-activedescendant") ?? "", /option-0$/);
  await user.keyboard("{ArrowDown}");
  assert.deepEqual(highlighted(), ["福冈CTY-JP-FUK"], "第一次按 ↓ 落在第一个上，不跳到第二个");
  await user.keyboard("{Enter}");
  assert.equal(chosen(), "fuk");
  assert.equal((input as HTMLInputElement).value, "福冈");
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("多个匹配项：「输入 → Enter」也选第一个匹配项；↓↓ 到第二个；输入后按 ↑ 到最后一个", async () => {
  const user = userEvent.setup();
  render(<Harness onSubmit={() => undefined} />);
  const input = screen.getByRole("combobox", { name: "所属城市" });
  await user.click(input);
  await user.keyboard("福{Enter}");
  assert.equal(chosen(), "fuk");

  await user.clear(input);
  await user.keyboard("福{ArrowDown}{ArrowDown}{Enter}");
  assert.equal(chosen(), "fks");

  await user.clear(input);
  await user.keyboard("福{ArrowUp}{Enter}");
  assert.equal(chosen(), "fki");
});

test("面板关着时 Enter 提交表单；面板开着、没输入也没高亮时 Enter 只关面板，不乱选；没有匹配项时 Enter 不选任何东西", async () => {
  const user = userEvent.setup();
  let submitted = 0;
  render(<Harness onSubmit={() => (submitted += 1)} />);
  const input = screen.getByRole("combobox", { name: "所属城市" });
  await user.click(input);
  assert.equal(input.getAttribute("aria-expanded"), "true");
  await user.keyboard("{Enter}");
  assert.equal(chosen(), "");
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.equal(submitted, 0);
  await user.keyboard("{Enter}");
  assert.equal(submitted, 1, "面板关着时 Enter 提交表单");

  await user.keyboard("zzz");
  assert.ok(screen.getByText("没有匹配的选项"));
  await user.keyboard("{Enter}");
  assert.equal(chosen(), "");
  assertAbsent(document.querySelector(".combobox__option--active"));
});
