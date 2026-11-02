# ADR 0064：司机回传履约的时间窗口

- 状态：已采纳（2026-11-02，M4-32）
- 补充 ADR 0027：司机 H5 回传出发、到达、接到客人、完成，多一道「不能太早」的时间窗口。「时间一律用系统收到的时间」不变。
- 补充 ADR 0052：代传的 `TOO_EARLY` 和司机用同一份窗口（数没变），定义从 `PROXY_FULFILMENT_RULES` 移到 `FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE`。
- 编号说明：写这篇时 main 上最大是 ADR 0060，M4-28 占用了 0062、0063；这篇用 0064。没有迁移。

## 背景

测试环境的测试单 NZ202611023YAEPLFX：用车时间 11-04 20:26（东京），司机通过司机链接在 11-02 19:29 的 20 秒内依次点了出发、到达、接到客人、完成，订单在用车前两天就成了「已完成」。
司机 H5 的状态回传只看状态机（不能跳步、不能重复），不看时间。运营代传（M4-18，ADR 0052）早就有窗口，司机没有。

太早完成的后果和 ADR 0052「接到客人、完成要双人复核」里列的一样：已完成的单按结算价进供应商账单、是终态、打开事后加收的窗口、计入评分和试运营转正；
接到客人把订单推进服务中，客人和运营都不能再取消。司机点错一下就能造成，而且改不回来。

## 决定

### 窗口（一处定义，司机和代传共用）

`packages/domain/src/fulfilment.ts` 的 `FULFILMENT_EARLIEST_HOURS_BEFORE_SERVICE`：

| 这一步 | 最早（含那一刻） |
| --- | --- |
| 出发 `departed` | 用车前 24 小时 |
| 到达 `arrived` | 用车前 24 小时 |
| 接到客人 `picked_up` | 用车前 3 小时 |
| 完成 `completed` | 用车前 3 小时 |

- 司机按**系统收到的时间**和**订单现在的用车时间**比（改单改了用车时间，窗口跟着变）。早 1 毫秒也拒绝，正好那一刻可以。
- **只管太早，不管太晚**：航班晚点时到达、接到客人、完成比计划晚很多都正常（需求「航班延误 6 小时内顺延」，延误更久也还在履约），不设上限。
- 代传的 `TOO_EARLY` 用同一个函数（`fulfilmentTooEarly`），数和 ADR 0052 一样，代传的行为不变。

### 为什么司机和代传用同一组数

先看需求能不能推出司机要不同的窗口：

- 需求只写了「用车前 1 小时仍未『已出发』时提醒租户」（《用车报价服务平台》「履约时间点」、《平台运营端》异常表「司机未出发」）。这说明正常出发在用车前 1 小时以内或更早，但没有说最早多早。远途接人、包车有提前一晚赶到附近的情况，24 小时足够宽，只挡明显点错的（比如这张测试单的提前两天）。所以司机的出发不需要比代传更早。
- 到达和出发同一个数：司机提前到上车点等很正常，到达也不产生不可逆的后果（改派、取消都还能挽回），no-show 要等免费等待结束才能提交，早到达不会让 no-show 提前。
- 接到客人最早是航班提前落地：`LANDING_RULES.earliestHoursBeforeScheduled` 也是 3 小时（报的落地时间最多比计划早 3 小时）。完成在接到之后，最早也是同一刻（短途接送可能在用车时间之前就送到了）。
- 需求和现有 ADR 里没有找到要司机比代传更宽或更严的依据，按「一个规则一处定义」用同一组数。以后要分开，改这张表的同时在这里另写一节。

### 范围：只拦司机 H5

| 来源 | 这次是否拦太早 | 理由 |
| --- | --- | --- |
| 司机 H5（`POST /driver/v1/trip/events`） | **拦** | 本任务 |
| 平台代传（`POST /platform/v1/orders/{id}/events`） | 已有，不变 | ADR 0052，同一份窗口 |
| 供应商调度接口和供应商后台（`POST /tenant/v1/orders/{id}/events`） | **不拦** | 见下 |

供应商的调度接口是对外的接口，有的供应商用自己的调度系统对接。突然对它加限制可能让对接方的系统报错卡住，需要提前通知对接方，比这个任务大；任务也要求不误伤供应商后台。代价：供应商后台或调度系统仍能在用车前很久回传完成，同样的问题在那一侧还在（见「需要决定的」）。集成测试 `driver-time-window.itest.ts` 固定了这一点，以后要收紧时会看到要改它。

实现：判断放在 `applyFulfilmentEvent` 里，只对 `actor.type === "driver"` 生效。**先判状态，再判时间**：页面过时、重复点时得到的仍是 409 `ORDER_STATE_INVALID`（页面会刷新），不会先告诉司机「太早」。太早时什么都不写（订单、状态流水、定位、推送、通知、评分事件都没有）。

### 接口

- 太早：422 `FULFILMENT_TOO_EARLY`。`message` 是给司机看的说明（例：「现在还不能点「已完成」：最早在用车前 3 小时，也就是 2026-11-04 17:26（Asia/Tokyo 当地时间）以后才能点（用车时间 2026-11-04 20:26）。行程有变请联系调度。」）。
  `details`：`type`、`earliest_at`（时刻）、`earliest_local`（城市当地时间 `YYYY-MM-DD HH:mm`）、`timezone`、`hours_before_service`。
- 写给人看的最早时间**进到下一分钟**（用车时间带秒时），照着写的时间去点不会再被拒。真实订单的用车时间都是整分钟，这只是兜底。
- `GET /driver/v1/trip` 等的应答多一个 `next_event: { type, earliest_at, earliest_local } | null`：下一步和它最早什么时候可以点，不能回传履约的状态为 null。只用来提前提示，判断以回传时为准。

### 司机页

- 打开页面时（按服务器的时间）还没到下一步的最早时间：按钮下面写「还没到时间：最早 …（当地时间）才能点「…」。行程有变请联系调度。」
- 按钮**不禁用**：页面开着放到时间以后，司机直接点就行，不用刷新；判断以服务器为准，不认手机时钟。
- 点得太早：显示服务器给的说明，状态不变。

## 已经「提前完成」的订单（不改数据）

这次不写迁移、不改已有订单。下面的只读查询找出履约时间早于本窗口的订单（含司机、供应商、代传各来源；`actor` 看是谁点的），交给运营判断：

```sql
select o.order_no, t.name as tenant, o.status, o.service_at, o.timezone,
       o.departed_at, o.arrived_at, o.picked_up_at, o.completed_at,
       (select string_agg(e.to_status || ':' || e.actor, ', ' order by e.seq) from order_events e
         where e.tenant_id = o.tenant_id and e.order_id = o.id and e.to_status in ('departed', 'arrived', 'in_service', 'completed')) as who,
       (select string_agg(s.statement_no || '(' || s.status || ')', ', ') from statement_lines l join statements s on s.tenant_id = l.tenant_id and s.id = l.statement_id
         where l.tenant_id = o.tenant_id and l.order_id = o.id) as statements
from orders o join tenants t on t.id = o.tenant_id
where o.departed_at < o.service_at - interval '24 hours'
   or o.arrived_at < o.service_at - interval '24 hours'
   or o.picked_up_at < o.service_at - interval '3 hours'
   or o.completed_at < o.service_at - interval '3 hours'
order by o.service_at;
```

用迁移账号或只读账号在数据库里执行（跨租户，绕过行级安全的账号才看得全）。建议的处理（由运营判断，不自动做）：

1. **测试单**（如 NZ202611023YAEPLFX）：确认是测试数据后不处理；`statements` 列有账单的，按已有的账单流程（作废重出、调账）处理。
2. **真实订单、服务其实没发生**：按已有流程走工单——客人要退款的走取消和退款，已进账单的走调账（`statements` 列出了挂在哪一期）。完成是终态，不能改回去。
3. **真实订单、服务其实发生了，只是点早了**（司机事后补点）：履约时间不准，但结果没错，不处理；评分里这一单的准时到达会被算成准时，影响很小。

## 回退

代码回退即可：没有迁移，没有改已有数据。接口的 `next_event` 是新增字段，页面不认识也不影响。

## 本期不做

- 供应商调度接口、供应商后台的时间窗口（见「范围」）。
- 「太晚」的上限（航班晚点的单不能误伤）。
- 出发、到达、接到、完成之间的最小间隔（比如 20 秒内连点四步）：窗口已经挡住了提前几天的情况；用车时间附近连点的，要结合定位判断，比这个任务大。
