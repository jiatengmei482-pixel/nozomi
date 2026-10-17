/**
 * 本机的假汇率源（集成测试、端到端测试用；测试从不访问真实的汇率源）。
 * 按 ExchangeRate-API 的格式回应答；回什么由测试随时改（`respond`），可以模拟出错、超时、内容不对。
 * 汇率是测试里现场给的数，不是业务数据。
 */
import { type Server, createServer } from "node:http";

export interface FakeFxReply {
  status?: number;
  body: string;
  /** 晚多少毫秒才回（模拟慢、超时） */
  delayMs?: number;
}

export interface FakeFxSource {
  /** 配置给 `FX_SOURCE_URL` 的地址 */
  url: string;
  /** 收到过几次请求 */
  requests(): number;
  respond(reply: FakeFxReply | (() => FakeFxReply)): void;
  close(): Promise<void>;
}

/**
 * 按数据源的格式拼一份响应原文。汇率按给的字符串原样写成 JSON 数字（不加引号），所以 `"151.210"` 在响应里就是 `151.210`。
 * `asOf`、`nextUpdate` 换成 Unix 秒。
 */
export function fxSourceBody(input: { asOf: Date; nextUpdate?: Date | null; rates: Record<string, string>; base?: string }): string {
  const seconds = (date: Date): number => Math.floor(date.getTime() / 1000);
  const rates = Object.entries({ USD: "1", ...input.rates })
    .map(([code, rate]) => `"${code}":${rate}`)
    .join(",");
  const next = input.nextUpdate === null ? "" : `"time_next_update_unix":${seconds(input.nextUpdate ?? new Date(input.asOf.getTime() + 86_400_000))},`;
  return `{"result":"success","provider":"https://www.exchangerate-api.com","time_last_update_unix":${seconds(input.asOf)},${next}"base_code":"${input.base ?? "USD"}","rates":{${rates}}}`;
}

export async function startFakeFxSource(port = 0): Promise<FakeFxSource> {
  let count = 0;
  let reply: FakeFxReply | (() => FakeFxReply) = { status: 503, body: "" };
  const server: Server = createServer((request, response) => {
    count += 1;
    const current = typeof reply === "function" ? reply() : reply;
    const send = (): void => {
      if (response.destroyed) return;
      response.writeHead(current.status ?? 200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(current.body);
    };
    if (current.delayMs) setTimeout(send, current.delayMs).unref();
    else send();
    request.resume();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}/v6/latest/USD`,
    requests: () => count,
    respond: (next) => {
      reply = next;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
