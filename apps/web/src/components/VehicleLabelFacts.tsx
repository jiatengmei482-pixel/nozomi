/**
 * 车型标识的 4 项（ADR 0068）：代表车型、同级车型说明、最多乘客、最多行李。
 * 后台车型组表单的预览、官网和订单详情都用它，保证各处写法一致；值由 @nozomi/domain 的 vehicleLabelLines 算出。
 * 车型名一般是英文（如 Toyota Alphard），代表车型和同级车型的值上标 lang="en" 让读屏按英文读。
 *
 * - `VehicleLabelFacts`：自带一个 <dl>（后台车型组预览）。
 * - `VehicleLabelItems`（M7-03）：只出「标签 + 值」的几项，放进页面已有的 <dl> 里，排在「车型」后面，
 *   和同一张卡片的其他项同样排（官网 site-facts、后台 details）。没有可显示的项时什么都不出。
 *   `luggageBasis`（M8-03，ADR 0069 B13）：「最多行李」后面加「（行李按 28 寸行李箱计）」；默认不加，原有页面不变。
 * - `OrderVehicleDetails`（M7-03）：后台订单详情「行程」卡片里的「车型」和 4 项；接口没给车型组（旧数据、找不到）时什么都不出。
 */
import { VEHICLE_LABEL_TEXTS, type VehicleLabelLanguage, type VehicleLabelSource, vehicleLabelLines } from "@nozomi/domain";
import type { OrderVehicleGroup } from "../api/dispatch.ts";
import { displayName } from "../lib/master-display.ts";

export function VehicleLabelItems({ group, language = "zh", itemClassName = "details__item", luggageBasis = false }: { group: VehicleLabelSource; language?: VehicleLabelLanguage; itemClassName?: string; luggageBasis?: boolean }) {
  const texts = VEHICLE_LABEL_TEXTS[language];
  const modelLabels = new Set([texts.representative, texts.similar]);
  return (
    <>
      {vehicleLabelLines(group, language).map((line) => (
        <div key={line.label} className={itemClassName}>
          <dt>{line.label}</dt>
          <dd {...(modelLabels.has(line.label) ? { lang: "en" } : {})}>{luggageBasis && line.label === texts.maxLuggage ? `${line.value}（${texts.luggageBasis}）` : line.value}</dd>
        </div>
      ))}
    </>
  );
}

export function VehicleLabelFacts({ group, language = "zh", className = "details" }: { group: VehicleLabelSource; language?: VehicleLabelLanguage; className?: string }) {
  if (vehicleLabelLines(group, language).length === 0) return null;
  const itemClass = className === "details" ? "details__item" : `${className}__item`;
  return (
    <dl className={`${className} vehicle-label`}>
      <VehicleLabelItems group={group} language={language} itemClassName={itemClass} />
    </dl>
  );
}

export function OrderVehicleDetails({ group }: { group: OrderVehicleGroup | null | undefined }) {
  if (group === null || group === undefined) return null;
  const name = displayName(group.name);
  return (
    <>
      <div className="details__item">
        <dt>车型</dt>
        <dd>
          <span lang={name.lang}>{name.text}</span>（<span className="mono">{group.code}</span>）
        </dd>
      </div>
      <VehicleLabelItems group={group} />
    </>
  );
}
