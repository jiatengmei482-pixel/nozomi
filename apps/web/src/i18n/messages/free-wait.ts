/** 接机免费等待按航班定（M9E-28，ADR 0097）的页面文案：供应商审批提示、订单页、改单表单、供应商和司机看到的依据。 */
import { defineMessages } from "../i18n.ts";

export const freeWait = defineMessages("freeWait", {
  minutes: "{minutes} 分钟",
  unlimited: "不限时",
  previewDispatched: "已派车：同意后免费等待不变（{current}）",
  previewUnchanged: "同意后免费等待不变（{current}）",
  previewChange: "同意后免费等待 {from} → {to}",
  dispatchedNote: "按派单时{kind}锁定 {minutes} 分钟",
  dispatchedKindInternational: "的国际航班",
  dispatchedKindDomestic: "的国内航班",
  dispatchedKindUnconfirmed: "航班类型未确认（按国内线）",
  basisKindInternational: "国际航班",
  basisKindDomestic: "国内航班",
  basisKindUnconfirmed: "航班类型未确认，按国内线",
  basisRaised: "；{base}，按平台规定补到 {minutes} 分钟",
  baseNotSet: "商品没设",
  baseSet: "商品设 {minutes} 分钟",
  flightKindLegend: "航班类型",
  flightKindHint: "按航班定免费等待：国际航班等得更久",
  flightKindDispatched: "已派车，免费等待不再变化",
  flightKindOption: "落地后免费等待 {minutes} 分钟",
  p2pFlightHint: "如 NH211。清空表示不是从机场接人，免费等待回到商品的设置",
});
