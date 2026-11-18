/**
 * 嵌入组件的图标（M9E-10）：内联 SVG，不加载任何外部资源、不用 emoji；都是装饰（aria-hidden），旁边总有文字或 aria-label。
 * 路径是本项目自己画的（24 × 24），描边图标用 currentColor 描边，实心图标（上下车点的圆点）用 currentColor 填充。
 */
const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  calendar: "M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2",
  user: "M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
  swap: "M7.5 4 4 7.5 7.5 11M4 7.5h14M16.5 13l3.5 3.5-3.5 3.5M20 16.5H6",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20",
  dot: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  chevron: "M6.5 9.5 12 15l5.5-5.5",
} as const;

export type IconName = keyof typeof PATHS;
const FILLED: readonly IconName[] = ["dot"];

export function icon(name: IconName, className = "nzb-icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", PATHS[name]);
  const filled = FILLED.includes(name);
  for (const [attr, value] of Object.entries(
    filled ? { fill: "currentColor", "fill-rule": "evenodd" } : { fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
  ))
    svg.setAttribute(attr, value);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  svg.append(path);
  return svg;
}
