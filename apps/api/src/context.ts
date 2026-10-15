/**
 * 各接口共用的依赖：配置、连接池、时钟。由 buildApp 组装后传给路由和业务流程。
 * 时钟可以替换，测试靠它验证「8 小时过期」「15 分钟限速窗口」「邀请 7 天过期」而不用真的等。
 */
import type { AppConfig } from "@nozomi/config";
import type { Pool } from "./db/pool.ts";
import type { QuoteDeps } from "./services/quote-deps.ts";

export interface AppContext {
  config: AppConfig;
  pool: Pool;
  now: () => Date;
  /** 报价引擎用到的外部依赖（路线预估、汇率、加价规则、评分）；见 services/quote-deps.ts */
  quote: QuoteDeps;
}
