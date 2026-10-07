/**
 * 测试专用：在一个独立的进程里验证「事务进行到一半，数据库把这条连接断掉」之后进程还活着、连接池还能用。
 * 必须用独立进程：如果实现有问题，表现是进程因未捕获的异常直接退出，在测试进程里验证会把测试进程本身带崩。
 *
 * 用法：node tx-connection-loss-child.ts <system|tenant> <idle|querying> [租户编号]
 * 连接串来自环境变量 DATABASE_URL。只会断开本进程自己的那一条连接，不影响同一个库上的其他测试。
 * 进程活到最后时打印一行 JSON：{"survived":true,"failed":事务是否如预期地失败,"recovered":之后连接池是否还能用}，退出码 0。
 */
import { withSystemTx, withTenantTx } from "../db/context.ts";
import { createPool } from "../db/pool.ts";
import { sleep } from "./process.ts";

const [kind, moment, tenantId] = process.argv.slice(2);
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl || (kind !== "system" && kind !== "tenant") || (moment !== "idle" && moment !== "querying")) {
  console.log(JSON.stringify({ error: "USAGE" }));
  process.exit(2);
}

const pool = createPool(databaseUrl, { max: 1 });
const killer = createPool(databaseUrl, { max: 1 });
pool.on("error", () => undefined);

const run = <T>(fn: Parameters<typeof withSystemTx<T>>[1]): Promise<T> =>
  kind === "tenant" ? withTenantTx(pool, tenantId ?? "", fn) : withSystemTx(pool, fn);

let failed = false;
try {
  await run(async (db) => {
    const pid = (await db.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
    if (moment === "idle") {
      await killer.query("select pg_terminate_backend($1)", [pid]);
      await sleep(300);
      await db.query("select 1");
    } else {
      const running = db.query("select pg_sleep(5)");
      // 先挂上处理：连接被断开后这条语句会在下面的 await 之前就失败，
      // 没有处理的话是这个测试脚本自己的「未处理的拒绝」把进程带崩，而不是被测代码的问题。下面仍然 await 它，失败照常抛出。
      running.catch(() => undefined);
      await sleep(300);
      await killer.query("select pg_terminate_backend($1)", [pid]);
      await running;
    }
  });
} catch {
  failed = true;
}
// 留出时间让驱动把「连接断开」的事件发完
await sleep(500);

let recovered = false;
try {
  const result = await withSystemTx(pool, (db) => db.query<{ ok: number }>("select 1 as ok"));
  recovered = result.rows[0]?.ok === 1;
} catch {
  recovered = false;
}
await pool.end();
await killer.end();
console.log(JSON.stringify({ survived: true, failed, recovered }));
process.exit(0);
