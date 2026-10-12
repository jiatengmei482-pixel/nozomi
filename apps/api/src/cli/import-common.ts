/**
 * 两个主数据导入命令（机场、城市）共用的部分：国家参数、清单的显示、把各种失败换成给人看的说明。
 */
import { ConfigError } from "@nozomi/config";
import { CsvError, isCountryCode } from "@nozomi/domain";
import { DbIdentityError } from "../db/identity.ts";
import { driverErrorCode } from "../db/pool.ts";
import { GeoNamesError } from "../integrations/geonames.ts";
import { OurAirportsError } from "../integrations/ourairports.ts";
import { ZipError } from "../integrations/zip.ts";
import { MasterImportError } from "../services/import-errors.ts";

/** 清单太长时只列前面这么多条 */
export const LIST_LIMIT = 20;

export class UsageError extends Error {}

export function listed(items: readonly string[]): string {
  const shown = items.slice(0, LIST_LIMIT).join("、");
  return items.length > LIST_LIMIT ? `${shown} 等 ${items.length} 个` : shown;
}

/** `--country JP,KR` 和 `--all-countries` 必须给且只能给一个。返回国家码列表；全部国家是 null。 */
export function readCountries(country: string | undefined, allCountries: boolean | undefined): string[] | null {
  if ((allCountries === true) === (country !== undefined)) throw new UsageError("--country 和 --all-countries 必须给且只能给一个。");
  if (country === undefined) return null;
  const countries = [...new Set(country.split(",").map((code) => code.trim().toUpperCase()))];
  const unknown = countries.filter((code) => !isCountryCode(code));
  if (unknown.length > 0) throw new UsageError(`不是合法的国家码：${unknown.map((code) => code || "（空）").join("、")}`);
  return countries;
}

/** 导入失败时打印什么。不打印异常本身：驱动的报错里可能带连接信息（规则 5）。 */
export function failureMessage(err: unknown, usage: string): string {
  if (err instanceof UsageError) return `${err.message}\n${usage}`;
  if (err instanceof ConfigError) return `${err.message}\n\n怎么配置：见 docs/secrets.md`;
  if (err instanceof CsvError || err instanceof ZipError) return `没有导入：${err.message}。数据库没有任何变化。`;
  if (err instanceof MasterImportError) return `没有导入：${err.message}（${err.code}）。`;
  if (err instanceof OurAirportsError || err instanceof GeoNamesError) {
    return `没有导入：${err.message}（${err.code}）。可以稍后再试，或先把文件下载到本地再用 --file 指定。`;
  }
  if (err instanceof DbIdentityError) return `没有导入：${err.message}`;
  if (driverErrorCode(err) !== null) {
    return `没有导入：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。数据库没有任何变化。`;
  }
  return `没有导入：${err instanceof Error ? err.message : "未知错误"}`;
}
