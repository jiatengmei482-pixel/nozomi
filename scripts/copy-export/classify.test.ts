import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_ENTRIES, type SourceFile, importedBy, placeFile, reachingEntries } from "./classify.ts";

const web = (rel: string, imports: readonly string[] = []): SourceFile => ({ path: `apps/web/src/${rel}`, text: imports.map((spec, i) => `import { x${i} } from "${spec}";`).join("\n") });

// 一个小的前端：两个供应商后台页面、一个运营后台页面、官网预订页，加上被它们 import 的组件和共用文件
const files: SourceFile[] = [
  web("App.tsx", ["./pages/areas/AreaListPage.tsx", "./pages/products/ProductEditorPage.tsx", "./pages/platform/routes.tsx"]),
  web("pages/platform/routes.tsx", ["./ProductPages.tsx"]),
  web("pages/areas/AreaListPage.tsx", ["./AreaUsage.tsx", "../../lib/area-roles.ts", "../../components/Button.tsx"]),
  web("pages/areas/AreaUsage.tsx"),
  web("pages/products/ProductEditorPage.tsx", ["./BasicStep.tsx", "../../lib/area-roles.ts", "../../components/Button.tsx"]),
  web("pages/products/BasicStep.tsx"),
  web("pages/platform/ProductPages.tsx", ["../products/BasicStep.tsx", "../../components/Button.tsx"]),
  web("pages/book/new/BookNewPage.tsx", ["./PlaceField.tsx", "../../../components/Button.tsx"]),
  web("pages/book/new/PlaceField.tsx"),
  web("lib/area-roles.ts"),
  web("components/Button.tsx"),
  web("pages/somewhere/NewPage.tsx"),
];
const reverse = importedBy(files);

test("import 关系：相对路径解析到文件，记录被谁 import", () => {
  assert.deepEqual([...(reverse.get("apps/web/src/components/Button.tsx") ?? [])].sort(), ["apps/web/src/pages/areas/AreaListPage.tsx", "apps/web/src/pages/book/new/BookNewPage.tsx", "apps/web/src/pages/platform/ProductPages.tsx", "apps/web/src/pages/products/ProductEditorPage.tsx"]);
  assert.deepEqual(reachingEntries("apps/web/src/pages/products/BasicStep.tsx", reverse), ["pages/platform/ProductPages.tsx", "pages/products/ProductEditorPage.tsx"]);
});

test("路由直接挂的页面文件用固定的页面名", () => {
  assert.deepEqual(placeFile("apps/web/src/pages/areas/AreaListPage.tsx", "区域列表页", reverse), { area: "tenant", page: "区域列表", usedIn: [] });
  assert.equal(PAGE_ENTRIES["pages/book/new/BookNewPage.tsx"]?.area, "site");
});

test("只有一个页面用的文件归到那个页面", () => {
  assert.deepEqual(placeFile("apps/web/src/pages/areas/AreaUsage.tsx", "区域被谁引用", reverse), { area: "tenant", page: "区域列表", usedIn: [] });
  assert.deepEqual(placeFile("apps/web/src/pages/book/new/PlaceField.tsx", null, reverse), { area: "site", page: "预订页（/book）", usedIn: [] });
});

test("同一区域几个页面用的归到这个区域，写明用在哪些页面", () => {
  assert.deepEqual(placeFile("apps/web/src/lib/area-roles.ts", "区域的角色", reverse), {
    area: "tenant",
    page: "多个页面共用：区域的角色（area-roles.ts）",
    usedIn: ["供应商后台 · 区域列表", "供应商后台 · 商品编辑"],
  });
});

test("跨区域用的：页面目录下的留在目录所属区域，组件和共用文件归到公共", () => {
  assert.deepEqual(placeFile("apps/web/src/pages/products/BasicStep.tsx", "① 基础信息", reverse), {
    area: "tenant",
    page: "多个页面共用：① 基础信息（BasicStep.tsx）",
    usedIn: ["供应商后台 · 商品编辑", "运营后台 · 商品（只读查看）"],
  });
  const button = placeFile("apps/web/src/components/Button.tsx", "按钮", reverse);
  assert.equal(button.area, "shared");
  assert.equal(button.page, "按钮（Button.tsx）");
  assert.equal(button.usedIn.length, 4);
});

test("没有页面用到的页面文件按目录归区域，页面名取开头注释", () => {
  assert.deepEqual(placeFile("apps/web/src/pages/somewhere/NewPage.tsx", "新页面", reverse), { area: "tenant", page: "新页面（NewPage.tsx）", usedIn: [] });
});

test("后端：邮件模板单列，接口提示和 domain 包各一个区域", () => {
  assert.equal(placeFile("packages/domain/src/notifications.ts", "通知中心", reverse).area, "mail");
  assert.deepEqual(placeFile("packages/domain/src/orders.ts", "订单与付款", reverse), { area: "domain", page: "订单与付款（orders.ts）", usedIn: [] });
  assert.deepEqual(placeFile("apps/api/src/routes/site.ts", null, reverse), { area: "api", page: "site.ts", usedIn: [] });
});
