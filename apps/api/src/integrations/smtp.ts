/**
 * 真正把邮件发出去（M4-14，ADR 0048）：nodemailer 只在这个文件出现。每封新建一条连接，不复用。
 *
 * 防 SSRF（主机是人填的，不能让它把服务器的连接引到内网去）：
 * 1. 主机不能是内网 / 回环 / 元数据地址或只在内网解析的名字（@nozomi/domain 的 `smtpHostAllowed`）；
 * 2. 发信前解析域名，**解析到的每一个地址**都必须是公网地址，有一个不是就整体拒绝；
 * 3. 只连第 2 步检查过的地址：连接是这里建好交给 nodemailer 的（`connection`），nodemailer 不再解析——防 DNS 重绑定。
 *    TLS 证书仍按原来的域名校验，任何环境都不关校验。
 *
 * 时限：一次发信总共 15 秒，到点直接断开连接。只有连接这一步失败才换下一个地址再试 1 次；连上之后失败不重试（可能已经发出去了）。
 * 错误只归成代码 + 我们自己写的一句话：服务器返回的原文不外传，nodemailer 的日志关闭。
 * 服务器拒收的归类见 ADR 0049「邮件服务器拒收的归类」：只看哪一步、应答码和增强状态码，不看说明文字（各家写法不同，也可能含收件人地址）。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { type Socket, connect as netConnect, isIP, isIPv4 } from "node:net";
import { type SmtpSettings } from "@nozomi/config";
import { type MailMessage, smtpAddressAllowed, smtpHostAllowed } from "@nozomi/domain";
import { createTransport } from "nodemailer";

export type SmtpFailureCode =
  /** 主机或解析到的地址是内网地址 */
  | "TARGET_FORBIDDEN"
  /** 连不上：网络不通、域名解析不了、连接被断开 */
  | "UNREACHABLE"
  /** TLS 失败：证书不对、过期，服务器不支持 STARTTLS，或加密方式和端口不配 */
  | "TLS_FAILED"
  /** 用户名或密码不对 */
  | "AUTH_FAILED"
  /** 能确定被拒的是发件人：MAIL FROM 被永久拒绝，或增强状态码说是发件人地址的问题 */
  | "SENDER_REJECTED"
  /** 能确定被拒的是这个收件人（永久拒绝）。这封不再重试 */
  | "RECIPIENT_REJECTED"
  /** 永久拒绝，但分不清是发件人、收件人还是内容的问题（常见于 DATA 阶段才拒） */
  | "MESSAGE_REJECTED"
  /** 暂时拒绝（4xx）：限流、灰名单、对方暂时不可用。过一会儿再试 */
  | "TEMPORARILY_REJECTED"
  /** 在时限内没有完成 */
  | "TIMEOUT"
  /** 服务器的应答看不懂 */
  | "UNEXPECTED";

export const SMTP_FAILURE_MESSAGES: Readonly<Record<SmtpFailureCode, string>> = {
  TARGET_FORBIDDEN: "邮件服务器的地址不允许：主机是内网地址，或解析到了内网地址。请填写邮件服务商给的公网主机名",
  UNREACHABLE: "连不上邮件服务器：请检查主机名和端口；云服务器常常封了 25 端口，可以换 465 或 587",
  TLS_FAILED: "和邮件服务器建立加密连接失败：请检查加密方式和端口是否相配（通常 465 配 TLS、587 配 STARTTLS），以及服务器的证书是否有效",
  AUTH_FAILED: "邮件服务器不接受这组用户名和密码：请检查是否填对；很多邮箱要用「应用专用密码」或 SMTP 专用密码，不是登录密码",
  SENDER_REJECTED: "邮件服务器拒绝了发件人地址：请确认这个账号可以用这个发件人地址发信",
  RECIPIENT_REJECTED: "邮件服务器拒绝了收件人地址：这个地址可能不存在或不收信，请核对邮箱地址",
  MESSAGE_REJECTED: "邮件服务器拒绝了这封邮件，分不清是发件人还是收件人的问题：请确认这个账号可以用这个发件人地址发信，并核对收件人邮箱地址",
  TEMPORARILY_REJECTED: "邮件服务器暂时不接收这封邮件（可能是限流或对方暂时不可用），通常过一会儿就好",
  TIMEOUT: "邮件服务器在时限内没有完成：请检查主机名和端口，以及加密方式和端口是否相配（通常 465 配 TLS、587 配 STARTTLS）",
  UNEXPECTED: "邮件服务器的应答看不懂，请确认主机名和端口填的是 SMTP 服务",
};

export type MailSendResult = { ok: true; messageId: string } | { ok: false; code: SmtpFailureCode; message: string };

export interface Mailer {
  send(settings: SmtpSettings, message: MailMessage): Promise<MailSendResult>;
}

/** 一次发信的总时限（毫秒）。 */
export const SMTP_SEND_DEADLINE_MS = 15_000;
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_ATTEMPTS = 2;
const CONNECT_RETRY_DELAY_MS = 300;

export interface SmtpMailerOptions {
  /** 只有 local / ci：放行回环地址（本机的假 SMTP 服务器） */
  allowLoopback?: boolean;
  /** 打招呼时报的名字；不给时 nodemailer 会报这台机器的主机名 */
  ehloName?: string;
  /** 总时限（毫秒），测试缩短用 */
  deadlineMs?: number;
  /** 域名解析（测试替换）；默认系统解析，返回全部地址 */
  resolve?: (hostname: string) => Promise<string[]>;
  /** 额外信任的证书（只给测试：本机假服务器的自签证书）。证书校验本身没有开关 */
  tlsCa?: string;
}

class SmtpFailure extends Error {
  readonly code: SmtpFailureCode;
  constructor(code: SmtpFailureCode) {
    super(code);
    this.code = code;
  }
}

const failure = (code: SmtpFailureCode): MailSendResult => ({ ok: false, code, message: SMTP_FAILURE_MESSAGES[code] });

const TLS_ERROR_CODE = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH|EPROTO$)/;
const TLS_ERROR_TEXT = /\b(ssl|tls|certificate)\b/i;

/** 应答开头的增强状态码（RFC 3463）的后两段：`550 5.1.1 …` → `1.1`。只留数字，说明文字不看。 */
const ENHANCED_STATUS = /^\d{3}[ -][245]\.(\d{1,3}\.\d{1,3})(?:\s|$)/;
/** 发件人地址的问题：5.1.7 发件人邮箱写法不对、5.1.8 发件人域名不对。 */
const SENDER_STATUS = new Set(["1.7", "1.8"]);
/** 收件人的问题：5.1.1 没有这个邮箱、5.1.2 没有这个域名、5.1.3 地址写法不对、5.1.6 邮箱搬走了、5.1.10 对方域名不收信（空 MX）、5.2.1 邮箱停用、5.2.2 邮箱满了。 */
const RECIPIENT_STATUS = new Set(["1.1", "1.2", "1.3", "1.6", "1.10", "2.1", "2.2"]);
/** RCPT TO 没有带增强状态码时，这几个应答码按 RFC 5321 说的是收件人邮箱；554 和语法类的 5xx 不算。 */
const RECIPIENT_REPLY = new Set([550, 551, 552, 553]);

/**
 * 服务器拒收：4xx 都是暂时的；MAIL FROM 的 5xx 一定是发件人；其余看增强状态码。
 * 5.7.x 不算收件人：Postfix 默认等到 RCPT TO 才拒发件人，`553 5.7.1 Sender address rejected` 就在这一步，说不清是谁的问题。
 * 判断错了的代价：多试两次（当成说不清），不会把发件人配置错误算成某个收件人的问题而不再重试。
 */
function classifyRejection(stage: "MAIL FROM" | "RCPT TO" | "DATA", responseCode: unknown, response: unknown): SmtpFailureCode {
  if (typeof responseCode === "number" && responseCode >= 400 && responseCode < 500) return "TEMPORARILY_REJECTED";
  if (stage === "MAIL FROM") return "SENDER_REJECTED";
  const status = typeof response === "string" ? (ENHANCED_STATUS.exec(response)?.[1] ?? null) : null;
  if (status !== null && SENDER_STATUS.has(status)) return "SENDER_REJECTED";
  if (status !== null && RECIPIENT_STATUS.has(status)) return "RECIPIENT_REJECTED";
  const noDetail = status === null || status === "0.0";
  if (stage === "RCPT TO" && noDetail && (responseCode === undefined || RECIPIENT_REPLY.has(responseCode as number))) return "RECIPIENT_REJECTED";
  return "MESSAGE_REJECTED";
}

/**
 * nodemailer 的错误归类：只看错误码、命令、应答码和增强状态码，错误说明里只找「是不是 TLS 的问题」，不外传。
 * nodemailer 10 的行为（ADR 0049，实测）：MAIL FROM 被拒 `EENVELOPE` + `MAIL FROM`；RCPT TO 全部被拒 `EENVELOPE` + `RCPT TO` + `rejected`、`rejectedErrors`；
 * DATA 命令被拒 `EENVELOPE` + `DATA`；正文发完被拒 `EMESSAGE` + `DATA`。都带 `responseCode` 和 `response`。本地校验不过时 `command` 是 `API`，没有应答码。
 */
export function classifySmtpError(err: unknown): SmtpFailureCode {
  if (err instanceof SmtpFailure) return err.code;
  if (typeof err !== "object" || err === null) return "UNEXPECTED";
  const { code, command, originalCode, message, responseCode, response } = err as { code?: unknown; command?: unknown; originalCode?: unknown; message?: unknown; responseCode?: unknown; response?: unknown };
  const isTls = (typeof originalCode === "string" && TLS_ERROR_CODE.test(originalCode)) || (typeof message === "string" && TLS_ERROR_TEXT.test(message));
  switch (code) {
    case "ETIMEDOUT":
      return "TIMEOUT";
    case "EAUTH":
    case "ENOAUTH":
      return "AUTH_FAILED";
    case "ETLS":
      return "TLS_FAILED";
    case "EDNS":
      return "UNREACHABLE";
    case "EMESSAGE":
      return classifyRejection("DATA", responseCode, response);
    case "EENVELOPE":
      return classifyRejection(command === "MAIL FROM" || command === "RCPT TO" ? command : "DATA", responseCode, response);
    case "ESOCKET":
    case "ECONNECTION":
      return isTls ? "TLS_FAILED" : "UNREACHABLE";
    default:
      return "UNEXPECTED";
  }
}

async function systemResolve(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
}

export class SmtpMailer implements Mailer {
  readonly #allowLoopback: boolean;
  readonly #ehloName: string | undefined;
  readonly #deadlineMs: number;
  readonly #resolve: (hostname: string) => Promise<string[]>;
  readonly #tlsCa: string | undefined;

  constructor(options: SmtpMailerOptions = {}) {
    this.#allowLoopback = options.allowLoopback === true;
    this.#ehloName = options.ehloName;
    this.#deadlineMs = options.deadlineMs ?? SMTP_SEND_DEADLINE_MS;
    this.#resolve = options.resolve ?? systemResolve;
    this.#tlsCa = options.tlsCa;
  }

  async send(settings: SmtpSettings, message: MailMessage): Promise<MailSendResult> {
    const deadline = Date.now() + this.#deadlineMs;
    let socket: Socket | null = null;
    let expired = false;
    const work = this.#deliver(settings, message, deadline, (current) => {
      socket = current;
      if (expired) current.destroy();
    }).catch((err: unknown) => failure(classifySmtpError(err)));
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<MailSendResult>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        (socket as Socket | null)?.destroy();
        resolve(failure("TIMEOUT"));
      }, this.#deadlineMs);
    });
    try {
      return await Promise.race([work, limit]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #deliver(settings: SmtpSettings, message: MailMessage, deadline: number, onSocket: (socket: Socket) => void): Promise<MailSendResult> {
    const addresses = await this.#targets(settings.host);
    const socket = await this.#connect(addresses, settings.port, deadline, onSocket);
    try {
      const idleMs = Math.max(1, deadline - Date.now());
      const transport = createTransport({
        connection: socket,
        host: settings.host,
        port: settings.port,
        secure: settings.encryption === "tls",
        requireTLS: settings.encryption === "starttls",
        ignoreTLS: settings.encryption === "none",
        auth: { user: settings.username, pass: settings.password },
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(this.#tlsCa === undefined ? {} : { ca: this.#tlsCa }) },
        ...(this.#ehloName === undefined ? {} : { name: this.#ehloName }),
        greetingTimeout: idleMs,
        socketTimeout: idleMs,
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const info = await transport.sendMail({
        from: { name: settings.fromName, address: settings.fromAddress },
        to: message.to,
        envelope: { from: settings.fromAddress, to: [message.to] },
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      });
      return { ok: true, messageId: info.messageId };
    } finally {
      socket.destroy();
    }
  }

  /** 这个主机可以连的地址（IPv4 排前面：很多服务器没有 IPv6）。主机或解析到的任何一个地址不合格都整体拒绝。 */
  async #targets(host: string): Promise<string[]> {
    const options = { allowLoopback: this.#allowLoopback };
    if (!smtpHostAllowed(host, options)) throw new SmtpFailure("TARGET_FORBIDDEN");
    const name = host.toLowerCase() === "localhost" ? "127.0.0.1" : host;
    const addresses = isIP(name) !== 0 ? [name] : await this.#resolve(name).catch(() => {
      throw new SmtpFailure("UNREACHABLE");
    });
    if (addresses.length === 0) throw new SmtpFailure("UNREACHABLE");
    if (!addresses.every((address) => smtpAddressAllowed(address, options))) throw new SmtpFailure("TARGET_FORBIDDEN");
    return [...addresses.filter((address) => isIPv4(address)), ...addresses.filter((address) => !isIPv4(address))];
  }

  /** 连上检查过的地址。失败时一封邮件都没有发出去，所以可以换下一个地址再试。 */
  async #connect(addresses: readonly string[], port: number, deadline: number, onSocket: (socket: Socket) => void): Promise<Socket> {
    let last: SmtpFailureCode = "UNREACHABLE";
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new SmtpFailure("TIMEOUT");
      const address = addresses[attempt % addresses.length] as string;
      try {
        return await connectOnce(address, port, Math.min(CONNECT_TIMEOUT_MS, remaining), onSocket);
      } catch (err) {
        last = err instanceof SmtpFailure ? err.code : "UNREACHABLE";
      }
    }
    throw new SmtpFailure(last);
  }
}

function connectOnce(address: string, port: number, timeoutMs: number, onSocket: (socket: Socket) => void): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = netConnect({ host: address, port });
    onSocket(socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SmtpFailure("TIMEOUT"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      // nodemailer 接手之后还可能有迟到的错误；它有自己的监听，这一个只防止进程因为没人监听而退出
      socket.on("error", () => undefined);
      resolve(socket);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new SmtpFailure("UNREACHABLE"));
    });
  });
}
