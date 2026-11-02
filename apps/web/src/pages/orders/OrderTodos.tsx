/**
 * 供应商首页的订单待办（M4-29，ADR 0060）：客人的修改申请要决定，已经发生的修改、取消看过点「知道了」。
 * 没有客人信息和价格（规则 4），要同意或拒绝到订单详情。和订单菜单的角标同一个接口。
 */
import { Link } from "react-router";
import { type OrderTodos, acknowledgeOrderTodo, listOrderTodos } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { useToast } from "../../components/Toast.tsx";
import { formatInZone, orderPath } from "../../lib/dispatch-display.ts";
import { failureText } from "../../lib/failure.ts";
import { CHANGE_FIELD_NAMES, ORDER_TODO_NAMES, orderTodoDriverText } from "../../lib/order-money-display.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";

export function OrderTodosSection() {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const canAck = useTenantCan("order.dispatch");
  const { state, reload } = useLoad<OrderTodos>("home-order-todos", listOrderTodos);
  const data = state.data;
  if (data === null || data.total === 0) return null;
  const acknowledge = async (id: string): Promise<void> => {
    try {
      await acknowledgeOrderTodo(token, id);
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "标记"));
    }
    reload();
  };
  return (
    <section className="home-section" aria-labelledby="home-order-todos">
      <h2 className="home-section__title" id="home-order-todos">
        {`订单待办（${data.total}）`}
      </h2>
      <div className="card">
        {data.change_requests > 0 && <Alert kind="warning">{`有 ${data.change_requests} 张单的客人申请了修改，等你处理。确认前原预约仍然有效。`}</Alert>}
        <ul className="plain-list">
          {data.items.map((item) => {
            const driver = orderTodoDriverText(item);
            const fields = item.fields.map((field) => CHANGE_FIELD_NAMES[field] ?? field).join("、");
            return (
              <li key={item.id}>
                <Link className="link mono" to={orderPath(item.order_id)}>
                  {item.order_no}
                </Link>
                {` ${ORDER_TODO_NAMES[item.kind]}${fields === "" ? "" : `（${fields}）`}，用车时间 ${item.service_local.replace("T", " ")}`}
                {item.confirm_due_at !== null && `，请在 ${formatInZone(item.confirm_due_at, item.timezone)} 之前处理`}
                {driver !== null && <Alert kind="warning">{driver}</Alert>}
                {item.kind !== "change_request" && canAck && (
                  <Button variant="text" size="sm" onClick={() => void acknowledge(item.id)}>
                    知道了
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
