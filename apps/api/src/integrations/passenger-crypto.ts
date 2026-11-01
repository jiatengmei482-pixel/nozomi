/**
 * 乘客信息的加密和盲索引（M4-22，ADR 0057）。密钥从 `DATA_ENCRYPTION_KEY` 按用途派生（`SecretBox`），不新增要人填的密钥。
 *
 * - 密文：AES-256-GCM，附加数据带这条记录的种类、租户和编号，搬到别的行、别的租户解不开。存的时候前面加密钥标记 `<kid>:`，能在库里数出哪些行还是旧密钥的。
 * - 盲索引：HMAC-SHA256，输入带租户、种类和规范化后的值。没有主密钥穷举不出来；同一个邮箱在两家的值不同。同样带密钥标记。
 * - 读：`PASSENGER_READ_SOURCE=plaintext` 读明文；否则有当前密钥的密文就解密，没有（没回填、密钥换过）读明文。解不开时退回明文并报警；明文只是占位时（第 6 步之后）报错，不把占位当内容。
 * - 日志和错误里只有种类、记录编号和数量，没有内容。
 */
import { ENCRYPTED_PASSENGER, ENCRYPTED_TEXT, type ContactIndexKind, type PassengerContact, containsPassenger, isPassengerPlaceholder, normalizeEmailForIndex, normalizeNameForIndex, normalizePhoneForIndex, passengersArePlaceholders, replacePassengers } from "@nozomi/domain";
import { AppError } from "../errors.ts";
import type { SecretBox } from "./secret-box.ts";

export type PassengerCopyKind = "order_change" | "webhook_delivery" | "notification";

export interface PassengerCryptoLog {
  error(obj: object, msg: string): void;
}

export interface PassengerEncryptionSettings {
  readSource: "ciphertext" | "plaintext";
  plaintextWrite: boolean;
  backfillEnabled: boolean;
}

export interface OrderPassengerColumns {
  /** 写进 `orders.passenger` 的内容 */
  plain: PassengerContact;
  enc: string;
  emailBidx: string | null;
  phoneBidx: string | null;
  nameBidx: string | null;
}

const ALERT_INTERVAL_MS = 60_000;
const SILENT_LOG: PassengerCryptoLog = { error: () => undefined };

export function passengerEncryptionNotConfigured(): AppError {
  return new AppError(503, "PASSENGER_ENCRYPTION_NOT_CONFIGURED", "服务器还没有配置数据加密密钥（DATA_ENCRYPTION_KEY），现在不能保存乘客信息。请联系技术人员");
}

function samePassenger(a: PassengerContact, b: PassengerContact): boolean {
  return a.name === b.name && a.phone === b.phone && a.email === b.email;
}

export class PassengerCrypto {
  private readonly box: SecretBox | null;
  private readonly settings: PassengerEncryptionSettings;
  private readonly log: PassengerCryptoLog;
  private readonly kid: string | null;
  private readonly alerts = new Map<string, { at: number; suppressed: number }>();

  constructor(box: SecretBox | null, settings: PassengerEncryptionSettings, log: PassengerCryptoLog = SILENT_LOG) {
    this.box = box;
    this.settings = settings;
    this.log = log;
    this.kid = box === null ? null : box.mac("passenger-index", "nozomi.key-id").slice(0, 8);
  }

  get configured(): boolean {
    return this.box !== null;
  }

  get readsCiphertext(): boolean {
    return this.box !== null && this.settings.readSource === "ciphertext";
  }

  get plaintextWrite(): boolean {
    return this.settings.plaintextWrite;
  }

  get backfillEnabled(): boolean {
    return this.box !== null && this.settings.backfillEnabled;
  }

  /** `like` 用的当前密钥前缀；没配置主密钥时为 null。 */
  get currentPrefix(): string | null {
    return this.kid === null ? null : `${this.kid}:`;
  }

  /** 这个密文或盲索引是不是当前密钥算的。 */
  isCurrent(stored: string | null | undefined): stored is string {
    return this.kid !== null && typeof stored === "string" && stored.startsWith(`${this.kid}:`);
  }

  /** 盲索引。`value` 必须已经规范化（`normalizeEmailForIndex` 等）。 */
  index(tenantId: string, kind: ContactIndexKind, value: string): string {
    if (this.box === null) throw passengerEncryptionNotConfigured();
    return `${this.kid}:${this.box.mac("passenger-index", JSON.stringify([tenantId, kind, value]))}`;
  }

  /** 新写入一单的乘客信息：没有主密钥时报错，不写明文冒充加密。 */
  sealOrderPassenger(tenantId: string, orderId: string, passenger: PassengerContact): OrderPassengerColumns {
    if (this.box === null) throw passengerEncryptionNotConfigured();
    const email = normalizeEmailForIndex(passenger.email);
    const phone = normalizePhoneForIndex(passenger.phone);
    const name = normalizeNameForIndex(passenger.name);
    return {
      plain: this.settings.plaintextWrite ? passenger : { ...ENCRYPTED_PASSENGER },
      enc: this.seal("order", tenantId, orderId, JSON.stringify(passenger)),
      emailBidx: email === "" ? null : this.index(tenantId, "email", email),
      phoneBidx: phone === "" ? null : this.index(tenantId, "phone", phone),
      nameBidx: name === "" ? null : this.index(tenantId, "name", name),
    };
  }

  /** 读一单的乘客信息。`plain` 是 `orders.passenger` 列的内容。 */
  readOrderPassenger(tenantId: string, orderId: string, enc: string | null, plain: PassengerContact): PassengerContact {
    if (!this.readsCiphertext || !this.isCurrent(enc)) return this.usablePlain("order", orderId, plain.name, plain);
    const opened = this.tryOpen("order", tenantId, orderId, enc);
    if (opened === null) return this.usablePlain("order", orderId, plain.name, plain);
    const passenger = JSON.parse(opened) as PassengerContact;
    if (!isPassengerPlaceholder(plain.name) && !samePassenger(passenger, plain)) this.alert("passenger.cipher_mismatch", { kind: "order", id: orderId }, "乘客信息的密文和明文对不上");
    return passenger;
  }

  /** 副本（改单前后值、推送内容）写库：有乘客的才加密。 */
  sealValues<T>(kind: PassengerCopyKind, tenantId: string, id: string, value: T): { plain: T; enc: string | null } {
    if (!containsPassenger(value) || this.box === null) return { plain: value, enc: null };
    return { plain: this.settings.plaintextWrite ? value : replacePassengers(value, ENCRYPTED_PASSENGER), enc: this.seal(kind, tenantId, id, JSON.stringify(value)) };
  }

  readValues<T>(kind: PassengerCopyKind, tenantId: string, id: string, enc: string | null, plain: T): T {
    const opened = this.readsCiphertext && this.isCurrent(enc) ? this.tryOpen(kind, tenantId, id, enc) : null;
    if (opened !== null) return JSON.parse(opened) as T;
    return this.usablePlain(kind, id, passengersArePlaceholders(plain) && JSON.stringify(plain).includes(ENCRYPTED_TEXT) ? ENCRYPTED_TEXT : "", plain);
  }

  /** 给客人的通知的收件地址。 */
  sealRecipient(tenantId: string, eventId: string, recipient: string): { plain: string; enc: string | null } {
    if (this.box === null) return { plain: recipient, enc: null };
    return { plain: this.settings.plaintextWrite ? recipient : ENCRYPTED_TEXT, enc: this.seal("notification", tenantId, eventId, recipient) };
  }

  readRecipient(tenantId: string | null, eventId: string, enc: string | null, plain: string): string {
    const opened = tenantId !== null && this.readsCiphertext && this.isCurrent(enc) ? this.tryOpen("notification", tenantId, eventId, enc) : null;
    return opened ?? this.usablePlain("notification", eventId, plain, plain);
  }

  /** `--verify` 用：这段密文能不能用当前密钥解开，解开是什么。解不开返回 null，不报警。 */
  openForVerify(kind: "order" | PassengerCopyKind, tenantId: string, id: string, enc: string): string | null {
    if (this.box === null) return null;
    try {
      return this.box.open("passenger-data", this.owner(kind, tenantId, id), enc.slice(enc.indexOf(":") + 1));
    } catch {
      return null;
    }
  }

  private owner(kind: string, tenantId: string, id: string): string {
    return `${kind}:${tenantId}:${id}`;
  }

  private seal(kind: "order" | PassengerCopyKind, tenantId: string, id: string, text: string): string {
    if (this.box === null) throw passengerEncryptionNotConfigured();
    return `${this.kid}:${this.box.seal("passenger-data", this.owner(kind, tenantId, id), text)}`;
  }

  private tryOpen(kind: "order" | PassengerCopyKind, tenantId: string, id: string, enc: string): string | null {
    const opened = this.openForVerify(kind, tenantId, id, enc);
    if (opened === null) this.alert("passenger.decrypt_failed", { kind, id }, "乘客信息的密文解不开，退回读明文");
    return opened;
  }

  /** 退回明文。第 6 步之后明文只是加密占位：没有密文可读时不能把占位当乘客信息，报错。 */
  private usablePlain<T>(kind: string, id: string, marker: string, plain: T): T {
    if (marker !== ENCRYPTED_TEXT) return plain;
    this.alert("passenger.unreadable", { kind, id }, "乘客信息只有密文，解不开");
    throw new AppError(503, "PASSENGER_DECRYPT_FAILED", "乘客信息暂时读不出来，请联系技术人员");
  }

  /** 同一种报警每分钟最多一条，带这段时间压下去的条数：密钥配错时每个列表都会触发。 */
  private alert(event: string, detail: { kind: string; id: string }, msg: string): void {
    const now = Date.now();
    const state = this.alerts.get(event);
    if (state !== undefined && now - state.at < ALERT_INTERVAL_MS) {
      state.suppressed += 1;
      return;
    }
    this.alerts.set(event, { at: now, suppressed: 0 });
    this.log.error({ event, ...detail, suppressed: state?.suppressed ?? 0 }, msg);
  }
}
