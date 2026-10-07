/**
 * 测试专用的 TCP 转发器：夹在 API 和 PostgreSQL 之间，用来制造真实的数据库故障
 * （查询挂起、连接被掐断、网络中断后恢复），不需要停掉真实数据库。
 *
 * 只监听 127.0.0.1 的随机端口；用完必须 `close()`。
 */
import { type Server, type Socket, connect, createServer } from "node:net";
import { once } from "node:events";

interface Link {
  client: Socket;
  upstream: Socket;
  /** 已被「黑洞」：双向数据全部丢弃，但连接不断开（模拟网络中断后对端毫无响应） */
  dead: boolean;
  /** 挂起期间攒下的数据，恢复时按原顺序补发 */
  held: { to: Socket; chunk: Buffer }[];
}

export interface TcpProxy {
  port: number;
  /** 把连接串里的主机和端口换成本转发器的地址 */
  rewrite(databaseUrl: string): string;
  /** 挂起：新旧连接的数据都先扣住不转发（数据库「卡住」） */
  stall(): void;
  /** 结束挂起：把扣住的数据补发出去 */
  resume(): void;
  /** 把现有连接全部变成黑洞（之后新建的连接不受影响） */
  blackholeExisting(): void;
  /** 数据库「宕机」：掐断现有连接，新连接一接入就断开 */
  down(): void;
  /** 数据库「恢复」：重新接受新连接 */
  up(): void;
  /** 当前还开着的连接数 */
  openConnections(): number;
  close(): Promise<void>;
}

export async function startTcpProxy(target: { host: string; port: number }): Promise<TcpProxy> {
  const links = new Set<Link>();
  let stalled = false;
  let refusing = false;

  const forward = (link: Link, to: Socket, chunk: Buffer): void => {
    if (link.dead) return;
    if (stalled) {
      link.held.push({ to, chunk });
      return;
    }
    if (!to.destroyed) to.write(chunk);
  };

  const server: Server = createServer((client) => {
    if (refusing) {
      client.destroy();
      return;
    }
    const upstream = connect(target.port, target.host);
    const link: Link = { client, upstream, dead: false, held: [] };
    links.add(link);
    const teardown = (): void => {
      links.delete(link);
      client.destroy();
      upstream.destroy();
    };
    client.on("data", (chunk: Buffer) => forward(link, upstream, chunk));
    upstream.on("data", (chunk: Buffer) => forward(link, client, chunk));
    client.on("error", teardown);
    upstream.on("error", teardown);
    client.on("close", teardown);
    upstream.on("close", teardown);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("转发器没有拿到监听端口");
  const port = address.port;

  const destroyAll = (): void => {
    for (const link of [...links]) {
      link.client.destroy();
      link.upstream.destroy();
    }
    links.clear();
  };

  return {
    port,
    rewrite(databaseUrl) {
      const url = new URL(databaseUrl);
      url.hostname = "127.0.0.1";
      url.port = String(port);
      return url.toString();
    },
    stall() {
      stalled = true;
    },
    resume() {
      stalled = false;
      for (const link of links) {
        const held = link.held.splice(0);
        if (link.dead) continue;
        for (const { to, chunk } of held) if (!to.destroyed) to.write(chunk);
      }
    },
    blackholeExisting() {
      for (const link of links) {
        link.dead = true;
        link.held.length = 0;
      }
    },
    down() {
      refusing = true;
      destroyAll();
    },
    up() {
      refusing = false;
    },
    openConnections() {
      return links.size;
    },
    async close() {
      destroyAll();
      server.close();
      await once(server, "close");
    },
  };
}

/** 从连接串里取出真实数据库的主机和端口（给 startTcpProxy 用）。 */
export function databaseTarget(databaseUrl: string): { host: string; port: number } {
  const url = new URL(databaseUrl);
  return { host: url.hostname, port: url.port === "" ? 5432 : Number(url.port) };
}
