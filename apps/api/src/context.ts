/**
 * 各接口共用的依赖：配置、连接池、时钟。由 buildApp 组装后传给路由和业务流程。
 * 时钟可以替换，测试靠它验证「8 小时过期」「15 分钟限速窗口」「邀请 7 天过期」而不用真的等。
 */
import type { AppConfig } from "@nozomi/config";
import type { Pool } from "./db/pool.ts";
import type { PaymentProvider } from "./integrations/payments.ts";
import type { SecretBox } from "./integrations/secret-box.ts";
import type { WebhookSender } from "./integrations/webhook-sender.ts";
import type { FxCenter } from "./services/fx-center.ts";
import type { QuoteDeps } from "./services/quote-deps.ts";

export interface AppContext {
  config: AppConfig;
  pool: Pool;
  now: () => Date;
  /** 报价引擎用到的外部依赖（路线预估、汇率、加价规则、评分）；见 services/quote-deps.ts */
  quote: QuoteDeps;
  /** 汇率中心：拉取、确认、过期告警、给报价引擎的汇率（ADR 0022） */
  fx: FxCenter;
  /** 收款服务（Stripe，ADR 0026）；Stripe 没配置时为 null：不能下单，/health 和 config:check 显示「未配置」 */
  payments: PaymentProvider | null;
  /** 数据加密（供应商的 Webhook 签名密钥，ADR 0027）；没配置 DATA_ENCRYPTION_KEY 时为 null：供应商不能设置 Webhook */
  secretBox: SecretBox | null;
  /** 推送给供应商的 Webhook 的发送器（防 SSRF、超时、不跟随重定向，ADR 0027） */
  webhookSender: WebhookSender;
}
