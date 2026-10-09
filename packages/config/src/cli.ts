/**
 * `pnpm config:check`：检查当前环境变量里哪些账号已经配置。
 * 只打印脱敏信息。可以在本地、claude.ai/code 云端会话、CI、VPS 上运行。
 */
import { ConfigError, integrationStatus, loadConfig } from "./index.ts";

try {
  const config = loadConfig();
  console.log(`环境：${config.appEnv}`);
  for (const s of integrationStatus(config)) {
    console.log(`${s.state === "configured" ? "✓" : "✗"} ${s.label}：${s.detail}`);
  }
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\n怎么配置：见 docs/secrets.md");
    process.exit(1);
  }
  throw err;
}
