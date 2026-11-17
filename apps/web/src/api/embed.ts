/**
 * 运营后台「嵌入组件」的接口（M9E-02，ADR 0090）。字段与 `apps/api/openapi.yaml` 对齐，由 embed.contract.test.ts 保证。
 *
 * - 嵌入码（`nze_` 开头）是公开标识，写在合作网站页面里，不是密钥；由服务端生成，改不了。
 * - 白名单是 origin（`https://域名`，可带端口），服务端规范化后存；改白名单、停用要带版本号（If-Match）。
 */
import { apiRequest } from "./client.ts";
import { PLATFORM_BASE } from "./platform.ts";

export const EMBED_KEYS_PATH = `${PLATFORM_BASE}/embed-keys`;

export type EmbedLang = "zh" | "ja" | "en";
export type EmbedService = "transfer" | "charter";
export type EmbedKeyStatus = "active" | "disabled";
/** 组件的外观（M9E-10、M9E-14）：自动（按组件容器宽度）、卡片、横条 */
export type EmbedLayout = "auto" | "card" | "bar";

export interface EmbedKey {
  id: string;
  key: string;
  name: string;
  allowed_origins: string[];
  default_lang: EmbedLang;
  default_services: EmbedService[];
  layout: EmbedLayout;
  /** 允许整页嵌入（M9E-16，ADR 0095 Q13）：默认关 */
  allow_host_page: boolean;
  /** 预订页地址（M9E-26）：合作网站自己的预订页；没填为 null */
  booking_url: string | null;
  status: EmbedKeyStatus;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  /** ①入口小程序（合作网站任何页面）；有②时 init 带 bookingUrl */
  snippet: string;
  /** ②预订程序（只放预订页，M9E-26）；只有①时为 null */
  booking_snippet: string | null;
  /** 为什么只有①（M9E-26）；两段都有时为 null */
  snippet_fallback: EmbedSnippetFallback | null;
}

/** 只有①的原因（M9E-26）：没填预订页地址、没开「允许整页嵌入」、预订页地址的网站不在白名单 */
export type EmbedSnippetFallback = "no_booking_url" | "host_page_off" | "booking_url_not_allowed";

export interface EmbedKeyWrite {
  name: string;
  allowed_origins: string[];
  default_lang: EmbedLang;
  default_services: EmbedService[];
  /** 服务端是选填（不填时新建按自动、修改保持原值）；后台页面总是带上 */
  layout: EmbedLayout;
  /** 服务端是选填（不填时新建按关、修改保持原值）；后台页面总是带上 */
  allow_host_page: boolean;
  /** 预订页地址（M9E-26）：服务端是选填（不填时新建按没有、修改保持原值）；后台页面总是带上，null = 清空 */
  booking_url: string | null;
  note: string | null;
}

/** 订单从哪里来（只做统计）：运营后台订单详情的 `entry_source` */
export interface OrderEntrySource {
  kind: "book" | "embed";
  embed_key_id: string | null;
  embed_key_name: string | null;
  embed_origin: string | null;
  /** M9E-16：redirect 跳主站下单、host_page 在合作网站页面里下单；主站来的单为 null */
  delivery: "redirect" | "host_page" | null;
}

/** 与 openapi.yaml 对账的字段（embed.contract.test.ts）。 */
export const EMBED_SCHEMA_FIELDS = {
  EmbedKey: ["id", "key", "name", "allowed_origins", "default_lang", "default_services", "layout", "allow_host_page", "booking_url", "status", "note", "version", "created_at", "updated_at", "snippet", "booking_snippet", "snippet_fallback"],
  EmbedKeyWrite: ["name", "allowed_origins", "default_lang", "default_services", "layout", "allow_host_page", "booking_url", "note"],
  OrderEntrySource: ["kind", "embed_key_id", "embed_key_name", "embed_origin", "delivery"],
} as const satisfies Record<string, readonly string[]>;

const one = (id: string): string => `${EMBED_KEYS_PATH}/${encodeURIComponent(id)}`;

export function listEmbedKeys(token: string): Promise<{ items: EmbedKey[] }> {
  return apiRequest("GET", EMBED_KEYS_PATH, { token });
}

export function getEmbedKey(token: string, id: string): Promise<EmbedKey> {
  return apiRequest("GET", one(id), { token });
}

export function createEmbedKey(token: string, body: EmbedKeyWrite): Promise<EmbedKey> {
  return apiRequest("POST", EMBED_KEYS_PATH, { token, body });
}

export function updateEmbedKey(token: string, id: string, version: number, body: EmbedKeyWrite & { status: EmbedKeyStatus }): Promise<EmbedKey> {
  return apiRequest("PATCH", one(id), { token, body, headers: { "if-match": `"${version}"` } });
}
