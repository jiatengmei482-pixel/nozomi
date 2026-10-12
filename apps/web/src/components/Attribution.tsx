/**
 * 公开数据源的署名。GeoNames 的许可（CC BY 4.0）要求使用时注明来源并链过去，凡是展示城市的页面都要带这一行；
 * OurAirports 是公有领域，注明来源是为了让人知道数据从哪来。
 */
import { ExternalLink } from "./ExternalLink.tsx";

export type DataSource = "geonames" | "ourairports";

export function Attribution({ source }: { source: DataSource }) {
  return source === "geonames" ? (
    <p className="page__attribution">
      城市数据来自 <ExternalLink to="geonames">GeoNames</ExternalLink>（geonames.org），<ExternalLink to="ccBy4">CC BY 4.0</ExternalLink>
    </p>
  ) : (
    <p className="page__attribution">
      机场数据来自 <ExternalLink to="ourairports">OurAirports</ExternalLink>（ourairports.com），公有领域
    </p>
  );
}

export function Attributions({ sources }: { sources: readonly DataSource[] }) {
  return (
    <>
      {sources.map((source) => (
        <Attribution key={source} source={source} />
      ))}
    </>
  );
}
