/**
 * 用法：node apps/web/build/edge-config-cli.ts <构建好的 index.html>
 * 把给 Caddy 用的配置片段（见 edge-config.ts）写到标准输出。只在构建前端镜像时运行（apps/web/Dockerfile）。
 */
import { readFileSync } from "node:fs";
import { renderEdgeConfig } from "./edge-config.ts";

const indexPath = process.argv[2];
if (indexPath === undefined || process.argv.length !== 3) {
  process.stderr.write("用法：node apps/web/build/edge-config-cli.ts <构建好的 index.html>\n");
  process.exit(2);
}
process.stdout.write(renderEdgeConfig(readFileSync(indexPath, "utf8")));
