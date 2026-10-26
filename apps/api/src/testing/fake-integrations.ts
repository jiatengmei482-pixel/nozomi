/**
 * 本机的假谷歌地图（Routes API）和假 Stripe（集成测试、端到端测试用；测试从不访问真实的外部服务，ADR 0041）。
 * 记下收到的每个请求（方法、路径、请求头），回什么由测试随时改（`respond`），可以模拟密钥无效、没开通 API、出错、超时。
 * 默认应答是「可用」：谷歌给一条路线，Stripe 给一份测试模式的余额。
 */
import { type IncomingHttpHeaders, type Server, createServer } from "node:http";

export interface FakeReply {
  status?: number;
  body: unknown;
  /** 晚多少毫秒才回（模拟慢、超时） */
  delayMs?: number;
}

export interface FakeRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
}

export interface FakeService {
  /** 服务的根地址，如 `http://127.0.0.1:41234` */
  origin: string;
  /** 配置用的地址：谷歌是 `GOOGLE_MAPS_ROUTES_URL`，Stripe 是 `STRIPE_API_URL` */
  url: string;
  requests: FakeRequest[];
  respond(reply: FakeReply | (() => FakeReply)): void;
  close(): Promise<void>;
}

/** 谷歌的错误应答（`error.status`、`error.details[].reason`）。 */
export function googleErrorBody(code: number, status: string, reason: string | null): unknown {
  return { error: { code, message: "error from fake google", status, details: reason === null ? [] : [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] } };
}

/** Stripe 的余额（`GET /v1/balance`）。 */
export function stripeBalanceBody(livemode = false): unknown {
  return { object: "balance", livemode, available: [], pending: [] };
}

async function startFake(path: string, initial: FakeReply, port: number): Promise<FakeService> {
  let reply: FakeReply | (() => FakeReply) = initial;
  const requests: FakeRequest[] = [];
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers });
      const current = typeof reply === "function" ? reply() : reply;
      const send = (): void => {
        if (response.destroyed) return;
        response.writeHead(current.status ?? 200, { "content-type": "application/json", "request-id": "req_fake" });
        response.end(JSON.stringify(current.body));
      };
      if (current.delayMs) setTimeout(send, current.delayMs).unref();
      else send();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : port}`;
  return {
    origin,
    url: `${origin}${path}`,
    requests,
    respond: (next) => {
      reply = next;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function startFakeGoogleRoutes(port = 0): Promise<FakeService> {
  return startFake("/directions/v2:computeRoutes", { body: { routes: [{ distanceMeters: 6_800 }] } }, port);
}

export function startFakeStripe(port = 0): Promise<FakeService> {
  return startFake("", { body: stripeBalanceBody() }, port);
}
