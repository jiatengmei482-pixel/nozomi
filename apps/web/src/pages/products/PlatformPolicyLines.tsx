/**
 * 商品「服务规则」里的取消规则：只读展示平台统一取消政策里这个品类的各车型级别（M3-03，ADR 0029；第五轮决策 ④）。
 * 供应商不设取消规则；政策由平台改（双人复核），只对之后下的单生效。
 */
import type { ServiceCategory } from "@nozomi/domain";
import { type CancellationPolicy, getCancellationPolicy } from "../../api/order-money.ts";
import { levelName, tiersText } from "../../lib/order-money-display.ts";
import { useLoad } from "../../lib/use-load.ts";

export function PlatformPolicyLines({ category, portal }: { category: ServiceCategory; portal: "tenant" | "platform" }) {
  const { state } = useLoad<{ policy: CancellationPolicy }>(`cancellation-policy|${portal}`, (token) => getCancellationPolicy(token, portal));
  const rules = state.data?.policy.rules.filter((rule) => rule.category === category) ?? null;
  if (rules === null) return <p className="field__hint">{state.status === "error" ? "平台的取消政策没取到，刷新后再看。" : "正在取平台的取消政策…"}</p>;
  return (
    <ul className="plain-list" aria-label="平台的取消政策">
      {rules.map((rule) => (
        <li key={rule.level}>
          <strong>{levelName(rule.level)}</strong>
          {`：${tiersText(rule.tiers)}`}
        </li>
      ))}
    </ul>
  );
}
