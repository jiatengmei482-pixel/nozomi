/**
 * 「航班类型」单选（M9E-28，ADR 0097 Q1 方案 B）：客人填航班号时选国际 / 国内航班，下单时按它锁定免费等待
 * （M9E-31 起平台统一：国际 90、国内 60，不看商品设的）。新预订页第 3 步、旧下单页、订单页改单共用。
 */
import type { FlightKind } from "@nozomi/domain";
import { RadioGroup } from "../../components/FormFields.tsx";
import { type ArrivalFreeWait, FLIGHT_KIND_NAMES, arrivalFreeWait } from "../../lib/book-new.ts";
import { FREE_WAIT_TEXTS } from "../../lib/free-wait-display.ts";

/** 每个选项后面的小字：这种航班免费等多久（不限时的不写）。 */
function optionHint(quoted: { free_wait_minutes: number | null } | null, kind: FlightKind): string | undefined {
  const wait: ArrivalFreeWait = arrivalFreeWait(quoted, kind);
  return wait.kind === "minutes" ? FREE_WAIT_TEXTS.flightKindOption(wait.minutes) : undefined;
}

export function FlightKindField({ value, onChange, errors, quoted, name = "flight-kind", hint = FREE_WAIT_TEXTS.flightKindHint }: { value: FlightKind | ""; onChange(value: FlightKind): void; errors: readonly string[]; quoted: { free_wait_minutes: number | null } | null; name?: string; hint?: string }) {
  return (
    <RadioGroup<FlightKind>
      legend={FREE_WAIT_TEXTS.flightKindLegend}
      name={name}
      required
      value={value === "" ? null : value}
      onChange={onChange}
      errors={errors}
      hint={hint}
      options={(["international", "domestic"] as const).map((kind) => {
        const hint = optionHint(quoted, kind);
        return { value: kind, label: FLIGHT_KIND_NAMES[kind], ...(hint === undefined ? {} : { hint }) };
      })}
    />
  );
}
