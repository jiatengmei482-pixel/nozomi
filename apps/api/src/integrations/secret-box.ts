/**
 * 库里需要还原原文的密钥的加密：供应商的 Webhook 签名密钥（M3-02，ADR 0027）、平台员工的两步验证密钥（M4-05，ADR 0030）、
 * 运营后台填写的第三方密钥（M4-09，ADR 0041）。
 *
 * 为什么不是只存哈希（像登录密码、API 客户端密钥那样）：推送时平台要用密钥原文算 HMAC 签名、验证动态码时要用密钥原文算 HMAC，哈希还原不出原文。
 * 做法：
 * - 主密钥是配置 `DATA_ENCRYPTION_KEY`（只经 packages/config 读取，规则 5）。每个用途用 HKDF-SHA256 从主密钥派生一把 256 位的子密钥（`info` 是用途名），
 *   以后别的用途（比如乘客电话、邮箱的库级加密）用另一个用途名，互不相通；
 * - AES-256-GCM，每次加密随机 96 位 IV；附加数据（AAD）是这条记录的归属（如租户编号、员工编号），密文搬到别人的行里解不开；
 * - 存储格式 `v1.<IV>.<认证标签>.<密文>`（各段 base64url），以后换算法时加 `v2`。
 * 解不开（主密钥换了、密文被改过、搬到了别的行）抛 `SecretBoxError`，调用方按「密钥不可用」处理，不把原因细节往外说。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type SecretPurpose = "tenant-webhook-secret" | "platform-totp-secret" | "integration-secret";

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
  private readonly masterKey: string;

  constructor(masterKey: string) {
    if (masterKey.length < 32) throw new RangeError("主密钥至少 32 个字符");
    this.masterKey = masterKey;
  }

  private key(purpose: SecretPurpose): Buffer {
    let key = this.keys.get(purpose);
    if (key === undefined) {
      key = Buffer.from(hkdfSync("sha256", Buffer.from(this.masterKey, "utf8"), Buffer.from("nozomi.secret-box", "utf8"), Buffer.from(`nozomi.${purpose}.v1`, "utf8"), 32));
      this.keys.set(purpose, key);
    }
    return key;
  }

  /** 加密。`owner` 是这条密文归属的记录（如租户编号、员工编号），解密时必须给同一个值。 */
  seal(purpose: SecretPurpose, owner: string, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(purpose), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(owner, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  open(purpose: SecretPurpose, owner: string, sealed: string): string {
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
