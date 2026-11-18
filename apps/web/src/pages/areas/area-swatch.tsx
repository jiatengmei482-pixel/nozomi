/**
 * 区域图例的小图样（从 AreaMap.tsx 拆出，M9E-25）：纯 SVG，不依赖 Leaflet，页面可以直接引用，地图组件按需加载。
 */
/** 图例里的小图样：和地图上用同一套类名，所以画法一定相同。 */
export function Swatch({ kind }: { kind: "operate" | "forbid" | "overlap" | "probe" }) {
  const box = "M2,2H22V12H2Z";
  return (
    <svg className="legend-swatch" viewBox="0 0 24 14" aria-hidden="true">
      {kind === "probe" ? (
        <circle className="area-probe__pin" cx="12" cy="7" r="5" />
      ) : (
        <>
          {kind !== "forbid" && <path className="area-fill area-fill--operate" d={box} />}
          {kind !== "operate" && <path className="area-fill area-fill--forbid" d={box} />}
          {kind !== "operate" && <path className="area-hatch" d="M6,2L2,6M12,2L2,12M18,2L8,12M22,4L14,12M22,10L20,12" />}
          {kind !== "overlap" && <path className="area-casing" d={box} />}
          {kind !== "overlap" && <path className={`area-stroke area-stroke--${kind}`} d={box} />}
        </>
      )}
    </svg>
  );
}
