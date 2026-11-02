/**
 * 应答之后才做的事（ADR 0050「防枚举」、ADR 0061）：接口先回应答，查账号、查订单、写库、发信放到这里，
 * 应答的内容和耗时就和「存不存在」无关。服务关闭时等这些任务结束（`backgroundIdle`）。
 * 任务失败只记日志：调用方已经回过应答了，客人重新申请即可。
 */
import type { AppContext } from "../context.ts";

export interface BackgroundLog {
  error(details: object, message: string): void;
}

const running = new WeakMap<AppContext, Set<Promise<void>>>();

/** 排一个后台任务：下一轮事件循环才开始，调用方的应答先发出去。`event` 是失败时日志里的事件名。 */
export function inBackground(ctx: AppContext, log: BackgroundLog, event: string, task: () => Promise<void>): void {
  const tasks = running.get(ctx) ?? new Set<Promise<void>>();
  running.set(ctx, tasks);
  const started: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
    .then(task)
    .catch((err: unknown) => log.error({ event, err }, "后台任务失败"))
    .finally(() => tasks.delete(started));
  tasks.add(started);
}

/** 等现在排着的后台任务都做完（服务关闭时；测试里等结果）。 */
export async function backgroundIdle(ctx: AppContext): Promise<void> {
  const tasks = running.get(ctx);
  while (tasks !== undefined && tasks.size > 0) await Promise.all(tasks);
}
