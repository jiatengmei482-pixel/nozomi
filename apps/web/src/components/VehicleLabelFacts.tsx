/**
 * 车型标识的 4 项（ADR 0068）：代表车型、同级车型说明、最多乘客、最多行李。
 * 后台车型组表单的预览、官网和订单详情都用它，保证各处写法一致；值由 @nozomi/domain 的 vehicleLabelLines 算出。
 * 车型名一般是英文（如 Toyota Alphard），值上标 lang="en" 让读屏按英文读。
 */
import { type VehicleLabelLanguage, type VehicleLabelSource, vehicleLabelLines } from "@nozomi/domain";

export function VehicleLabelFacts({ group, language = "zh", className = "details" }: { group: VehicleLabelSource; language?: VehicleLabelLanguage; className?: string }) {
  const lines = vehicleLabelLines(group, language);
  if (lines.length === 0) return null;
  const itemClass = className === "details" ? "details__item" : `${className}__item`;
  return (
    <dl className={`${className} vehicle-label`}>
      {lines.map((line, index) => (
        <div key={line.label} className={itemClass}>
          <dt>{line.label}</dt>
          <dd {...(index < 2 ? { lang: "en" } : {})}>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}
