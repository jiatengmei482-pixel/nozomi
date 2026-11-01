# ADR 0047：运营后台下拉框的主数据选项接口

- 状态：已采纳（2026-10-27，M4-13）
- 补充 ADR 0030「平台账号安全——自建角色与数据范围」：自建角色的「菜单 × 操作」表不变，新增几种「有其中任一个操作即可」的只读接口；数据范围的城市维度多管到这些接口。
- 主数据本身的接口（`/platform/v1/master/*`，ADR 0014 起）不变，仍只给 `master_data.read` / `master_data.manage`。

## 背景

渠道、加价规则、订单和商品的城市筛选、报价试算、角色的数据范围这些页面里都有「选城市」，加价规则和报价试算里还要选车型组，报价试算要选机场 / 车站，运营后台查看商品要显示附加服务的目录。
这些下拉框原来直接调主数据的列表接口（`/platform/v1/master/*`），要求 `master_data.read`。内置角色都有这个操作，所以一直没出问题；
M4-05 起可以自建角色，一个只勾了「订单 · 查看」或「渠道 · 编辑」的角色没有 `master_data.read`，页面上的城市框就是空的（显示成「平台还没有启用中的城市」），渠道建不了「只卖选中的城市」，订单按城市筛不了（M4-10 复验发现，M4-13）。

让这些角色都去勾「主数据 · 查看」不对：那会连带看到主数据页面、坐标边界、导入来源、取消政策、赔付表（同一个操作），超出他们的工作；而且数据范围限定了城市的人会在下拉里看到范围外的城市。

## 决定

### 四个选项接口

只读、只给下拉需要的字段、不分页（按编码排序）、默认只列启用中的：

| 接口 | 返回每项的字段 | 允许的操作（任一个即可） | 用在哪里 |
| --- | --- | --- | --- |
| `GET /platform/v1/city-options` | `id`、`code`、`name`（多语言）、`country_code`、`timezone`；带 `include_disabled=true` 时多 `status` | `channel.manage`、`order.read`、`product.read`、`quote.preview`、`role.manage`、`master_data.read` | 新建 / 编辑渠道的授权范围、加价规则、订单和商品列表的城市筛选、报价试算、角色的数据范围 |
| `GET /platform/v1/vehicle-group-options` | `id`、`code`、`name` | `channel.manage`、`quote.preview`、`master_data.read` | 加价规则对话框、报价试算的结果 |
| `GET /platform/v1/place-options?city_id=&type=` | `id`、`code`、`type`、`name` | `quote.preview`、`master_data.read` | 报价试算的机场 / 车站 |
| `GET /platform/v1/addon-options` | `id`、`code`、`name`、`description`（多语言）、`categories`、`charge_unit`；带 `include_disabled=true` 时多 `status` | `product.read`、`master_data.read` | 运营后台只读查看供应商商品的附加服务 |

- **允许的操作按用途定**：哪个页面要用，就放行进那个页面（或做那个动作）所需的操作。`channel.read`（只看渠道）不在城市、车型组的名单里：渠道详情和加价规则列表里的城市、车型组名称随渠道接口一起返回，不用下拉；要选的只有编辑的人。
  `master_data.read` 都在名单里（主数据页面本身也会用到）。`role.manage` 只归超级管理员（ADR 0030），超级管理员本来什么都有，写进名单是为了说明角色页的数据范围用的是这个接口。
  名单在代码里只有一份（`routes/master-options.ts` 的 `OPTION_ACTIONS`），权限矩阵测试和本表都以它为准。
- **一个都没有**：403 `FORBIDDEN`，`details.required_any` 是这几个操作（单一操作的接口仍是 `details.required`）。鉴权函数 `authenticatePlatform` 多了 `anyOf`，和 `action` 一样在同一个地方判断，前面的令牌、IP 白名单、两步验证、强制改密的顺序不变。
- **`include_disabled`**：城市给订单、商品列表的城市筛选用——要能筛出已停用城市的历史数据；前端在已停用的城市名后标「（已停用）」。附加服务给商品查看用——商品里勾着、后来被平台停用的附加服务要照样显示并标「平台已停用」（和供应商后台看到的一致）。车型组、地点不需要：加价规则里已选着的已停用车型组，名称随规则返回；报价试算只会报出启用中的车型组，「没报出价的」里因车型组停用（`VEHICLE_GROUP_DISABLED`）而没报的，车型组一栏写「已停用的车型组」，原因一栏本来就写明了。
- **地点**：`city_id`、`type` 必填（`airport`、`station`、`poi` 中的一个或多个，逗号分隔）。航站楼、出口挂在机场、车站下面，不单独选，所以不在可选类型里。不带城市的「全部机场」不给：不分页的接口不该一次吐出几千个机场。
- **不含**：坐标、边界、导入来源、人口、版本、时间戳。这些只在主数据页面要。查询参数一律严格校验（多带的参数 400），不让前端误以为 `status=all`、`limit` 这类主数据列表的参数在这里也生效。

### 数据范围

在 ADR 0030「数据范围」的表里加一行：

| 维度 | 管到哪里 | 范围外的表现 |
| --- | --- | --- |
| 城市（M4-13） | 城市选项；地点选项（按地点所属城市） | 列表里没有；`place-options` 的 `city_id` 在范围外时和不存在的城市一样，得到空列表 |

车型组、附加服务没有城市之分，不按范围过滤。范围里的城市停用了，默认不出现，带 `include_disabled=true` 才出现。

### 为什么不是别的做法

- **把「主数据 · 查看」拆细**（城市查看、车型组查看……）：要改菜单表、已有自建角色的勾选要迁移，而且仍然解决不了「数据范围限定了城市的人不该在下拉里看到范围外的城市」。
- **页面按权限说明原因、不给选**：订单按城市筛选、渠道按城市授权是这些角色的本职工作，说明原因等于功能不可用。
- **在各业务接口里顺带返回城市清单**（如订单列表多一个 `cities`）：每个页面一份，重复且各自要记得按范围过滤；选项接口一处过滤、一处测试。

## 前端

`apps/web/src/api/city-options.ts`、`master-options.ts` 和 `lib/use-city-options.ts`：渠道、加价规则、订单、商品、报价试算、角色页的城市改用城市选项；加价规则对话框和报价试算的车型组、报价试算的机场 / 车站、商品查看的附加服务改用对应的选项接口。主数据页面自己的管理仍用 `/platform/v1/master/*`。

## 验证

- 集成（真实 PostgreSQL）：`master-options.itest.ts`（自建角色逐个操作能否调、一个都没有 403 和 `required_any`、默认只有启用中的、`include_disabled`、数据范围过滤城市和地点、字段和 openapi 一致且没有多余字段、租户 / 渠道 / 官网令牌 401）；`platform-admin.itest.ts` 的权限矩阵（内置角色 × 四个接口，全部路由都登记）；`password-change-bypass.itest.ts` 的业务接口清单；两步验证、强制改密的遍历自动覆盖新路由。
- 前端：组件测试（自建角色没有主数据查看时各下拉正常、不请求主数据列表）、接口对账测试（`*.contract.test.ts`，前端类型的字段和 openapi 一致）、端到端（渠道、报价试算、订单列表）。

## 补充（2026-11-01，M4-15）：平台取消政策放宽给商品查看

M4-13 验收发现：只勾「商品 · 查看」的角色打开商品「② 服务规则」，`GET /platform/v1/cancellation-policy` 返回 403（要 `master_data.read`），取消规则一栏一直写「正在取平台的取消政策…」。

**决定：放宽这个只读接口，不是给没权限的说明。** 允许的操作改成 `master_data.read`、`product.read` 任一个（名单在 `routes/order-actions.ts` 的 `CANCELLATION_POLICY_READ_ACTIONS`，一个都没有：403，`details.required_any`）。判断依据和本 ADR「允许的操作按用途定」相同：取消规则是商品服务规则的一部分（第五轮决策 ④：平台统一规定，商品里只读展示），看商品的人要看到完整的服务规则才算能查看商品；说明原因等于这块功能不可用。

**不会多看到什么**：返回只有版本、生效时间和每个品类 × 车型级别的取消阶梯（提前小时数、费率基点）。没有订单、金额、对外价、加价比例、发起人或备注，供应商后台本来就能看到同样的内容（`/tenant/v1/cancellation-policy`）。政策全平台一份，没有城市之分，不按数据范围过滤（和 ADR 0030 相同）。

**不变的**：

- 「取消政策」页面和菜单仍要 `master_data.read`：只有商品查看的角色看不到这个入口，只在商品里看到自己品类的那几行。菜单 × 操作表（`取消政策 · 查看` = `master_data.read`）不改，已有角色不用迁移。
- 改政策仍要 `cancellation_policy.manage`，审核要 `cancellation_policy.review`。赔付表（`GET /platform/v1/compensation-table`，也带一份政策）、主数据接口仍只给 `master_data.read`。
- 这个接口不是下拉选项，不进「四个选项接口」的表和 `OPTION_ACTIONS`。

**前端**：这一栏分清还在取、没有权限（403，写「你的角色不能查看平台的取消政策……」，给以后别的角色和供应商后台兜底）、其他错误（可重试）。商品配置各步骤抽出 `StepLoadState`：内容没取到时 403、404、其他错误都有说明，不再只认网络错误、其余一直停在骨架屏；商品页取不到账号信息时给重试（`AccountLoadFailed`）。

**验证**：`master-options.itest.ts`（只勾商品查看 200、字段和供应商看到的相同、其他角色 403 和 `required_any`、改政策和赔付表仍 403）、`platform-admin.itest.ts` 的权限矩阵（从 `PROTECTED` 移到 `ANY_OF`）；组件测试（标题带 M4-15）在 `pages/platform/products.test.tsx`、`pages/products/products.test.tsx`、`pages/platform/city-options.test.tsx`；端到端在 `e2e/cancellation-policy-access.spec.ts`。
