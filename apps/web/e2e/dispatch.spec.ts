/**
 * 端到端：派车和司机 H5（M3-02，ADR 0027）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 供应商登记司机和车辆 → 订单列表里看到未派车的单 → 派车拿到司机链接 → 司机在手机上打开链接（没有任何价格）、点出发、到达 →
 * 供应商的订单详情里看到履约的时间和距上车点的距离；供应商设置 Webhook，签名密钥只显示一次；运营后台打开推送记录。
 * 端到端测试里没有 Stripe：「已经付过款」的订单由用例用迁移账号直接写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。日期跟着今天走。
 */
import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { CENTER, createProductByApi, createSupplier, createWorld } from "./catalog.ts";
import { adminCredentials, loginAs } from "./support.ts";

/** 写入一张已确认的接机单：用车时间是今天起第 3 天东京 10:00。返回订单号。 */
async function seedPaidOrder(input: { tenantId: string; cityId: string; airportId: string; productId: string; groupId: string }): Promise<string> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3, 1, 0));
    const local = new Date(day.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const orderNo = `NZ${now.toISOString().slice(0, 10).replaceAll("-", "")}${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
    await client.query(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 20000, 'JPY', $12::jsonb, 90, false,
               now() + interval '30 minutes', now(), $7::timestamptz - interval '24 hours', now(), now())`,
      [
        input.tenantId, orderNo, input.cityId, input.airportId, input.productId, input.groupId, day, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 20000, baseMinor: 20000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 }),
      ],
    );
    return orderNo;
  } finally {
    await client.end();
  }
}

test("派车 → 司机链接 → 司机 H5 出发和到达 → 供应商看到履约；Webhook 签名密钥只显示一次；运营后台的推送记录", async ({ page, request, browser }) => {
  test.setTimeout(90_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const orderNo = await seedPaidOrder({ tenantId: supplier.tenant.tenantId, cityId: world.city.id, airportId: world.airport.id, productId: product.id, groupId: world.group.id });

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  // 司机
  await page.getByRole("link", { name: "司机" }).click();
  await page.getByRole("button", { name: "新增司机" }).click();
  const driverDialog = page.getByRole("dialog", { name: "新增司机" });
  await driverDialog.getByLabel("姓名").fill("佐藤一郎");
  await driverDialog.getByLabel("手机").fill("+81 90-1111-2222");
  await driverDialog.getByLabel("驾照到期日").fill("2035-01-01");
  await driverDialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("rowheader", { name: "佐藤一郎" })).toBeVisible();

  // 车辆
  await page.getByRole("link", { name: "车辆" }).click();
  await page.getByRole("button", { name: "新增车辆" }).click();
  const vehicleDialog = page.getByRole("dialog", { name: "新增车辆" });
  await vehicleDialog.getByLabel("车牌").fill("品川 300 あ 12-34");
  await vehicleDialog.getByLabel("车型组").selectOption({ label: `${world.group.name}（${world.group.code}）` });
  await vehicleDialog.getByLabel("品牌车型").fill("丰田埃尔法");
  await vehicleDialog.getByLabel("座位数（含司机）").fill("7");
  await vehicleDialog.getByLabel("累计里程（公里）").fill("12000");
  await vehicleDialog.getByLabel("保险到期日").fill("2035-01-01");
  await vehicleDialog.getByLabel("车检到期日").fill("2035-01-01");
  await vehicleDialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("品川 300 あ 12-34")).toBeVisible();

  // 订单 → 派车
  await page.getByRole("link", { name: "订单", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: orderNo });
  await expect(row).toContainText("未派车");
  await expect(row).toContainText("20,000 JPY");
  await row.getByRole("link", { name: orderNo }).click();
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await page.getByRole("button", { name: "派车", exact: true }).click();
  const assign = page.getByRole("dialog", { name: "派车" });
  await assign.getByLabel("司机").selectOption({ label: "佐藤一郎（ja）" });
  await assign.getByLabel("车辆").selectOption({ label: "品川 300 あ 12-34 · 丰田埃尔法" });
  await assign.getByRole("button", { name: "确定派车" }).click();
  const linkDialog = page.getByRole("dialog", { name: "司机链接" });
  const link = await linkDialog.getByLabel("链接", { exact: true }).inputValue();
  expect(link).toMatch(/\/driver#nzd_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  await linkDialog.getByRole("button", { name: "我已发给司机" }).click();
  await expect(page.getByText("佐藤一郎 · +819011112222")).toBeVisible();

  // 司机在手机上打开链接：给定位权限，先在市区
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 35.7, longitude: 139.75 }, locale: "zh-CN" });
  const driverPage = await phone.newPage();
  await driverPage.goto(link);
  await expect(driverPage.getByText("王小明 · 2 人 1 件行李")).toBeVisible();
  await expect(driverPage.getByText("航班 NH211")).toBeVisible();
  expect(await driverPage.locator("body").innerText()).not.toMatch(/JPY|20,000|结算|对外价|价格/);
  await driverPage.getByRole("button", { name: "我出发了" }).click();
  await expect(driverPage.getByRole("button", { name: "已到达上车点" })).toBeVisible();
  await phone.setGeolocation({ latitude: CENTER_AIRPORT.lat, longitude: CENTER_AIRPORT.lng });
  await driverPage.getByRole("button", { name: "已到达上车点" }).click();
  await expect(driverPage.getByRole("button", { name: "接到客人了" })).toBeVisible();
  await expect(driverPage.getByRole("heading", { name: "客人没出现时" })).toBeVisible();
  await phone.close();

  // 供应商看到履约
  await page.reload();
  await expect(page.getByText("司机已到达").first()).toBeVisible();
  await expect(page.getByText(/距上车点 \d+ 米/)).toBeVisible();

  // Webhook：签名密钥只显示一次
  await page.goto("/settings/webhook");
  await page.getByLabel("接收地址").fill("https://dispatch.e2e.example.com/nozomi");
  await page.getByRole("button", { name: "保存并生成签名密钥" }).click();
  const secretDialog = page.getByRole("dialog", { name: "签名密钥" });
  const secret = await secretDialog.getByLabel("签名密钥", { exact: true }).inputValue();
  expect(secret).toMatch(/^nzwh_[A-Za-z0-9_-]{43}$/);
  await secretDialog.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByText(`签名密钥末 4 位：${secret.slice(-4)}`, { exact: false })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(secret);

  // 运营后台：推送记录
  const { email, password } = adminCredentials();
  const staff = await browser.newContext({ locale: "zh-CN" });
  const platform = await staff.newPage();
  await loginAs(platform, "platform", email, password);
  await platform.getByRole("link", { name: "推送记录" }).click();
  await expect(platform.getByRole("heading", { level: 1, name: "推送给供应商的 Webhook" })).toBeVisible();
  await staff.close();
});

/** 机场的坐标：createWorld 建的机场在城市中心往南、往东各 0.1 度。 */
const CENTER_AIRPORT = { lat: CENTER.lat - 0.1, lng: CENTER.lng + 0.1 };
