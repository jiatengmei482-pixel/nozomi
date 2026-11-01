/**
 * 本机的假谷歌地图（Routes API）和假 Stripe（集成测试、端到端测试用；测试从不访问真实的外部服务，ADR 0041）。
 * 记下收到的每个请求（方法、路径、请求头），回什么由测试随时改（`respond`），可以模拟密钥无效、没开通 API、出错、超时。
 * 默认应答是「可用」：谷歌给一条路线（6.8 公里、18 分钟），Stripe 给一份测试模式的余额。
 * 路线预估的测试（ADR 0042）看请求体（起终点、字段掩码）和请求次数（并发同一组只调一次、缓存命中不调用）。
 * 官网地址搜索、反查（ADR 0044）：假 Places Text Search 默认找到一个地点（东京站），假 Geocoding 反查默认给一个地址。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import { type Server as NetServer, type Socket, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket, createSecureContext, createServer as createTlsServer } from "node:tls";

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
  /** 请求体原文 */
  body: string;
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
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });
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

/** 谷歌 computeRoutes 的成功应答：一条路线的里程（米）和时长（秒）。 */
export function googleRouteBody(meters: number, seconds: number): unknown {
  return { routes: [{ distanceMeters: meters, duration: `${seconds}s` }] };
}

export function startFakeGoogleRoutes(port = 0): Promise<FakeService> {
  return startFake("/directions/v2:computeRoutes", { body: googleRouteBody(6_800, 1_080) }, port);
}

export function startFakeStripe(port = 0): Promise<FakeService> {
  return startFake("", { body: stripeBalanceBody() }, port);
}

/** 谷歌 Places Text Search 的一个地点。 */
export function googlePlace(id: string, name: string, lat: number, lng: number, address: string): unknown {
  return { id, displayName: { text: name, languageCode: "ja" }, formattedAddress: address, location: { latitude: lat, longitude: lng } };
}

/** 谷歌 Places Text Search 的成功应答；没有地点时谷歌回空对象。 */
export function googlePlacesBody(places: unknown[]): unknown {
  return places.length === 0 ? {} : { places };
}

/** 谷歌 Geocoding 反查的成功应答；null = 这里没有地址（空对象）。 */
export function googleGeocodeBody(address: string | null): unknown {
  return address === null ? {} : { results: [{ formattedAddress: address }] };
}

export function startFakeGooglePlaces(port = 0): Promise<FakeService> {
  return startFake("/v1/places:searchText", { body: googlePlacesBody([googlePlace("ChIJfakeTokyoStation", "東京駅", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目")]) }, port);
}

/** 假 Geocoding：`url` 是反查的前缀，请求是 `前缀/纬度,经度?…`。 */
export function startFakeGoogleGeocode(port = 0): Promise<FakeService> {
  return startFake("/v4beta/geocode/location", { body: googleGeocodeBody("日本、〒100-0005 東京都千代田区丸の内１丁目９") }, port);
}

// ---- 假 SMTP 服务器（ADR 0048）：测试从不连真实的邮件服务 ----

export interface FakeSmtpMessage {
  from: string;
  to: string[];
  /** 邮件原文（邮件头 + 正文） */
  data: string;
  /** 这封信走的连接是不是加密的 */
  secure: boolean;
}

/** 假服务器这一次怎么表现：不给的都是正常接收。 */
export interface FakeSmtpBehavior {
  /** 连上之后一句话都不说（模拟超时） */
  silent?: boolean;
  /** 在这条命令之后不再回话（模拟中途超时） */
  stallOn?: "EHLO" | "AUTH" | "MAIL" | "RCPT" | "DATA";
  /** 用户名密码一律不对 */
  rejectAuth?: boolean;
  /** MAIL FROM 回 550 */
  rejectSender?: boolean;
  /** RCPT TO 回 550 */
  rejectRecipient?: boolean;
  /** DATA 之后回 554 */
  rejectData?: boolean;
  /** 连上之后立刻断开 */
  dropOnConnect?: boolean;
  /** 不支持 STARTTLS：明明要求升级却回 502 */
  refuseStartTls?: boolean;
  /** 打招呼说的是听不懂的话 */
  garbageGreeting?: boolean;
  /** 错误应答里带上这段文字（检查它不会传给接口的调用方） */
  errorDetail?: string;
}

export interface FakeSmtp {
  host: string;
  port: number;
  /** 这台假服务器的连接次数 */
  connections: () => number;
  auths: { method: string; user: string; pass: string }[];
  messages: FakeSmtpMessage[];
  behave(next: FakeSmtpBehavior): void;
  /** 清掉记录，恢复正常 */
  reset(): void;
  close(): Promise<void>;
}

/** 本机假服务器用的自签证书（现场生成，用完即弃）。 */
export interface FakeTlsCert {
  key: string;
  cert: string;
}

export function generateFakeTlsCert(subjectAltName = "IP:127.0.0.1,DNS:localhost,DNS:smtp.pinned.test"): FakeTlsCert {
  const dir = mkdtempSync(join(tmpdir(), "nozomi-fake-smtp-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=fake-smtp", "-addext", `subjectAltName=${subjectAltName}`], { stdio: "ignore" });
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 假 SMTP 服务器。`tls`：`implicit` 一连上就是 TLS；`starttls` 支持升级；不给就是明文。
 * 懂 EHLO、STARTTLS、AUTH PLAIN / LOGIN、MAIL、RCPT、DATA、QUIT，记下认证和收到的信。
 */
export async function startFakeSmtp(options: { tls?: { mode: "implicit" | "starttls"; cert: FakeTlsCert } } = {}): Promise<FakeSmtp> {
  let behavior: FakeSmtpBehavior = {};
  let connections = 0;
  const auths: FakeSmtp["auths"] = [];
  const messages: FakeSmtpMessage[] = [];
  const open = new Set<Socket>();
  const context = options.tls === undefined ? null : createSecureContext({ key: options.tls.cert.key, cert: options.tls.cert.cert });

  const serve = (initial: Socket, initiallySecure: boolean): void => {
    connections += 1;
    open.add(initial);
    initial.on("close", () => open.delete(initial));
    initial.on("error", () => undefined);
    if (behavior.dropOnConnect) {
      initial.destroy();
      return;
    }
    if (behavior.silent) return;
    let socket = initial;
    let secure = initiallySecure;
    let buffer = "";
    let state: "command" | "data" | "login-user" | "login-pass" = "command";
    let loginUser = "";
    let from = "";
    let to: string[] = [];
    const detail = (): string => (behavior.errorDetail === undefined ? "" : ` ${behavior.errorDetail}`);
    const say = (line: string): void => void socket.write(`${line}\r\n`);
    const stalled = (command: NonNullable<FakeSmtpBehavior["stallOn"]>): boolean => behavior.stallOn === command;
    const handleCommand = (line: string): void => {
      const verb = line.split(" ")[0]?.toUpperCase() ?? "";
      if (verb === "EHLO" || verb === "HELO") {
        if (stalled("EHLO")) return;
        const startTls = options.tls?.mode === "starttls" && !secure && !behavior.refuseStartTls;
        say(`250-fake.smtp.test\r\n${startTls ? "250-STARTTLS\r\n" : ""}250 AUTH PLAIN LOGIN`);
      } else if (verb === "STARTTLS") {
        if (options.tls?.mode !== "starttls" || behavior.refuseStartTls || context === null) {
          say(`502 5.5.1 STARTTLS not supported${detail()}`);
          return;
        }
        say("220 2.0.0 ready");
        socket.removeListener("data", onData);
        const upgraded = new TLSSocket(socket, { isServer: true, secureContext: context });
        upgraded.on("error", () => undefined);
        upgraded.on("data", onData);
        open.add(upgraded);
        upgraded.on("close", () => open.delete(upgraded));
        socket = upgraded;
        secure = true;
        buffer = "";
      } else if (verb === "AUTH") {
        if (stalled("AUTH")) return;
        const [, method = "", initialResponse] = line.split(" ");
        if (method.toUpperCase() === "LOGIN") {
          state = "login-user";
          say("334 VXNlcm5hbWU6");
          return;
        }
        const parts = Buffer.from(initialResponse ?? "", "base64").toString("utf8").split("\u0000");
        finishAuth("PLAIN", parts[1] ?? "", parts[2] ?? "");
      } else if (verb === "MAIL") {
        if (stalled("MAIL")) return;
        if (behavior.rejectSender) return say(`550 5.7.1 sender refused${detail()}`);
        from = /<([^>]*)>/.exec(line)?.[1] ?? "";
        to = [];
        say("250 2.1.0 ok");
      } else if (verb === "RCPT") {
        if (stalled("RCPT")) return;
        if (behavior.rejectRecipient) return say(`550 5.1.1 recipient refused${detail()}`);
        to.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
        say("250 2.1.5 ok");
      } else if (verb === "DATA") {
        if (stalled("DATA")) return;
        state = "data";
        say("354 go ahead");
      } else if (verb === "RSET") {
        say("250 2.0.0 ok");
      } else if (verb === "QUIT") {
        say("221 2.0.0 bye");
        socket.end();
      } else {
        say("500 5.5.2 unknown command");
      }
    };
    const finishAuth = (method: string, user: string, pass: string): void => {
      auths.push({ method, user, pass });
      state = "command";
      say(behavior.rejectAuth ? `535 5.7.8 bad credentials${detail()}` : "235 2.7.0 ok");
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (state === "data") {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          const data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          state = "command";
          if (behavior.rejectData) {
            say(`554 5.7.1 message refused${detail()}`);
            continue;
          }
          messages.push({ from, to, data, secure });
          say("250 2.0.0 queued as fake");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        if (state === "login-user") {
          loginUser = Buffer.from(line, "base64").toString("utf8");
          state = "login-pass";
          say("334 UGFzc3dvcmQ6");
        } else if (state === "login-pass") {
          finishAuth("LOGIN", loginUser, Buffer.from(line, "base64").toString("utf8"));
        } else {
          handleCommand(line);
        }
      }
    };
    socket.on("data", onData);
    say(behavior.garbageGreeting ? "hello? this is not smtp" : "220 fake.smtp.test ESMTP");
  };

  const server: NetServer =
    options.tls?.mode === "implicit"
      ? createTlsServer({ key: options.tls.cert.key, cert: options.tls.cert.cert }, (socket) => serve(socket, true)).on("tlsClientError", () => undefined)
      : createNetServer((socket) => serve(socket, false));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return {
    host: "127.0.0.1",
    port: typeof address === "object" && address !== null ? address.port : 0,
    connections: () => connections,
    auths,
    messages,
    behave: (next) => {
      behavior = next;
    },
    reset: () => {
      behavior = {};
      connections = 0;
      auths.length = 0;
      messages.length = 0;
    },
    close: async () => {
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
