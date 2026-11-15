/**
 * M9P-10 新预订页的超限提醒（规格步骤 5）：报价带 `itinerary_warnings` 时，「行程时间表」下方按所选车型（没选时最便宜的）提醒，
 * 写出耗时 / 距离最长的一段；只提醒，照样能选车型、往下走。没有提醒时不显示。
 * 接口用测试替身；真实后端由 e2e/site-booking-itinerary-warnings.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { assertFocused, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

afterEach(() => {
  cleanup();
  resetBrowser();
});

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E6%96%B0%E5%AE%BF&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=09:00";
const SPOTS: Record<string, { lat: number; lng: number }> = { 镰仓: { lat: 35.3192, lng: 139.5467 }, 日光: { lat: 36.7199, lng: 139.6982 } };

function quoteOf(index: number, amount: number, warnings: SiteQuote["itinerary_warnings"], estimated: number): SiteQuote {
  return {
    quote_id: `QT20301120000000000${index}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: false,
    vehicle_group: { id: `33333333-3333-4333-8333-33333333330${index}`, code: `VG-T${index}`, name: { zh: `车型${index}` }, grade: "economy", seats: 7, sample_models: ["Toyota Noah"], combos: [{ passengers: 6, luggage: 4 }] },
    package: { hours: 12, km: 360 },
    price: { total: { amount: String(amount), currency: "JPY" }, fx: null },
    price_breakdown: [{ kind: "base", amount: { amount: String(amount), currency: "JPY" }, area_name: null, stop_seqs: null }],
    free_wait_minutes: 0,
    cancel_policy: { category: "charter", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
    estimated_minutes: estimated,
    includes_buffer: true,
    auto_package_hours: 12,
    itinerary_warnings: warnings,
  };
}

/** 新宿 → 镰仓 → 日光 → 新宿站，454 公里；车型1（便宜）只超距离，车型2 的商品用时也超了 */
const ROUTE: SiteQuoteResult["itinerary_route"] = { legs: [{ minutes: 90, meters: 66_000 }, { minutes: 280, meters: 258_000 }, { minutes: 150, meters: 130_000 }], drive_minutes: 520, stay_minutes: 120, total_minutes: 640, total_meters: 454_000 };

function open(result: SiteQuoteResult): void {
  stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/places/autocomplete") {
      const q = call.url.searchParams.get("q") ?? "";
      const name = Object.keys(SPOTS).find((spot) => q.includes(spot));
      return json(200, { available: true, items: name === undefined ? [] : [{ source: "platform", id: `spot-${name}`, name, address: "", location: SPOTS[name], kind: "station" }] });
    }
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: [{ hours: 12 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") {
      const body = call.body as Record<string, unknown>;
      return json(200, body["itinerary_pricing"] === true ? result : { currency: "JPY", quotes: [quoteOf(1, 70_000, null, 0)], unavailable: [] });
    }
    return null;
  });
  render(
    <MemoryRouter initialEntries={[LINK]}>
      <App />
    </MemoryRouter>,
  );
}

async function withStops(actor: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  for (const spot of ["镰仓", "日光"]) {
    await actor.click(screen.getByRole("button", { name: "添加经停点" }));
    const box = screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).at(-1) as HTMLElement;
    await waitFor(() => assertFocused(box));
    await actor.type(box, spot);
    await actor.click(await screen.findByRole("option", { name: new RegExp(spot) }, SLOW));
    await actor.selectOptions(screen.getAllByLabelText(/^经停点 \d+ 停留时长/).at(-1) as HTMLElement, "60");
  }
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
}

test("距离超限：时间表下方提醒（旧需求原文）并写出距离最长的一段；选了用时也超的车型后按它的报价两条都提醒；照样能选车型往下走", async () => {
  open({ currency: "JPY", quotes: [quoteOf(1, 148_000, ["LONG_DISTANCE"], 700), quoteOf(2, 160_000, ["LONG_DURATION", "LONG_DISTANCE"], 760)], unavailable: [], itinerary_route: ROUTE });
  const actor = userEvent.setup();
  await withStops(actor);
  const box = await screen.findByTestId("itinerary-warnings", {}, SLOW);
  assert.equal(box.getAttribute("role"), "status");
  assert.ok(box.closest("section")?.querySelector("#book-itinerary-title"), "在「行程时间表」这一块里");
  assert.deepEqual(
    [...box.querySelectorAll("p")].map((line) => line.textContent),
    ["您的行程全程约 454 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。", "距离最长的一段：镰仓 → 日光，约 258 公里。"],
  );
  await actor.click(screen.getByRole("button", { name: "选择 车型2" }));
  await waitFor(() =>
    assert.deepEqual(
      [...screen.getByTestId("itinerary-warnings").querySelectorAll("p")].map((line) => line.textContent),
      [
        "您的行程预计用时 12 小时 40 分，已超出司机单日法定工作时长的建议范围。建议适当缩减行程或减少经停点，让旅途更轻松舒适。",
        "耗时最长的一段：镰仓 → 日光，行驶约 4 小时 40 分。",
        "您的行程全程约 454 公里，超出单日包车的建议距离，将产生较多超公里费。建议适当缩减行程或减少经停点，让旅途更轻松舒适。",
        "距离最长的一段：镰仓 → 日光，约 258 公里。",
      ],
    ),
  );
  // 只提醒：照样能往下走
  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 }, SLOW);
});

test("没有提醒（空数组）时不显示提醒", async () => {
  open({ currency: "JPY", quotes: [quoteOf(1, 90_000, [], 600)], unavailable: [], itinerary_route: { ...ROUTE, total_meters: 300_000 } });
  const actor = userEvent.setup();
  await withStops(actor);
  await screen.findByRole("heading", { name: "行程时间表" }, SLOW);
  assert.equal(screen.queryByTestId("itinerary-warnings"), null);
});
