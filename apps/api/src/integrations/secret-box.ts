/**
 * 库里需要还原原文的密钥的加密：供应商的 Webhook 签名密钥（M3-02，ADR 0027）、平台员工的两步验证密钥（M4-05，ADR 0030）、
 * 运营后台填写的第三方密钥（M4-09，ADR 0041）、供应商的收款账号（M5-02，ADR 0051）。
 *
 * 为什么不是只存哈希（像登录密码、API 客户端密钥那样）：推送时平台要用密钥原文算 HMAC 签名、验证动态码时要用密钥原文算 HMAC，哈希还原不出原文。
 * 做法：
 * - 主密钥是配置 `DATA_ENCRYPTION_KEY`（只经 packages/config 读取，规则 5）。每个用途用 HKDF-SHA256 从主密钥派生一把 256 位的子密钥（`info` 是用途名），
 *   乘客信息（ADR 0057）用 `passenger-data`、`passenger-index`，互不相通；
 * - AES-256-GCM，每次加密随机 96 位 IV；附加数据（AAD）是这条记录的归属（如租户编号、员工编号），密文搬到别人的行里解不开；
 * - 存储格式 `v1.<IV>.<认证标签>.<密文>`（各段 base64url），以后换算法时加 `v2`。
 * 解不开（主密钥换了、密文被改过、搬到了别的行）抛 `SecretBoxError`，调用方按「密钥不可用」处理，不把原因细节往外说。
 *
 * 换主密钥（ADR 0106）：换的那段时间同时带着旧主密钥（`DATA_ENCRYPTION_KEY_PREVIOUS`）。加密、指纹只用新的；解密先试新的、再试旧的，
 * 所以换密钥那一刻起旧密文照常能读，后台任务再把它们逐行改成新密钥的密文（`data-key-rotation.ts`）。
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export type SecretPurpose = "tenant-webhook-secret" | "platform-totp-secret" | "integration-secret" | "payout-account" | "passenger-data" | "passenger-index";

export class SecretBoxError extends Error {
  constructor() {
    super("加密的密钥解不开（主密钥换了，或者内容被改过）");
    this.name = "SecretBoxError";
  }
}

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBox {
  private readonly keys = new Map<SecretPurpose, Buffer>();
  private readonly macKeys = new Map<SecretPurpose, Buffer>();
  private readonly masterKey: string;
  /** 换密钥期间的旧主密钥；只用来解密 */
  readonly previous: SecretBox | null;

  constructor(masterKey: string, previousMasterKey: string | null = null) {
    if (masterKey.length < 32) throw new RangeError("主密钥至少 32 个字符");
    if (previousMasterKey === masterKey) throw new RangeError("旧主密钥和新主密钥相同");
    this.masterKey = masterKey;
    this.previous = previousMasterKey === null ? null : new SecretBox(previousMasterKey);
  }

  private key(purpose: SecretPurpose): Buffer {
    let key = this.keys.get(purpose);
    if (key === undefined) {
      key = Buffer.from(hkdfSync("sha256", Buffer.from(this.masterKey, "utf8"), Buffer.from("nozomi.secret-box", "utf8"), Buffer.from(`nozomi.${purpose}.v1`, "utf8"), 32));
      this.keys.set(purpose, key);
    }
    return key;
  }

  /** 这段内容的指纹（HMAC-SHA256，十六进制）：只有持主密钥的人算得出来，改库的人重算不了。和加密用的子密钥分开。 */
  mac(purpose: SecretPurpose, text: string): string {
    let key = this.macKeys.get(purpose);
    if (key === undefined) {
      key = Buffer.from(hkdfSync("sha256", Buffer.from(this.masterKey, "utf8"), Buffer.from("nozomi.secret-box", "utf8"), Buffer.from(`nozomi.${purpose}.mac.v1`, "utf8"), 32));
      this.macKeys.set(purpose, key);
    }
    return createHmac("sha256", key).update(text, "utf8").digest("hex");
  }

  /** 加密。`owner` 是这条密文归属的记录（如租户编号、员工编号），解密时必须给同一个值。 */
  seal(purpose: SecretPurpose, owner: string, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(purpose), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(owner, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  /** 解密：先试当前主密钥，换密钥期间再试旧主密钥。 */
  open(purpose: SecretPurpose, owner: string, sealed: string): string {
    try {
      return this.openCurrent(purpose, owner, sealed);
    } catch (err) {
      if (this.previous === null) throw err;
      return this.previous.openCurrent(purpose, owner, sealed);
    }
  }

  /** 只用当前主密钥解密：换密钥时用来判断这一行是不是已经换成新密钥了。 */
  openCurrent(purpose: SecretPurpose, owner: string, sealed: string): string {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError();
    const [, ivText, tagText, bodyText] = parts as [string, string, string, string];
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretBoxError();
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(purpose), iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(owner, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretBoxError();
    }
  }
}

/** 按配置建：没配置主密钥时为 null；换密钥期间带上旧主密钥（ADR 0106）。 */
export function secretBoxFromConfig(config: { dataEncryptionKey: string | null; dataEncryptionPreviousKey: string | null }): SecretBox | null {
  return config.dataEncryptionKey === null ? null : new SecretBox(config.dataEncryptionKey, config.dataEncryptionPreviousKey);
}
