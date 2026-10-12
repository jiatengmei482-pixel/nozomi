// `pnpm dev` 的预加载脚本：仓库根目录有 .env 就加载，没有也照常启动。
// 已经存在的环境变量优先，不会被 .env 覆盖。
//
// 不用 `node --watch --env-file-if-exists=.env`：Node 24 的 --watch 在 .env 不存在时，
// 退出阶段会去关闭对这个不存在文件的监听而崩溃（退出码 134），并留下占着端口的服务进程。
import { existsSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
