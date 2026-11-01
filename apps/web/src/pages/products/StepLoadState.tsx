/**
 * 商品配置各步骤「内容还没到手」时显示什么：还在取是骨架屏；403、404、其余错误各有说明，不会一直停在骨架屏（M4-15）。
 */
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import type { LoadState } from "../../lib/use-load.ts";

export function StepLoadState({ status, reload, lines }: { status: LoadState<unknown>["status"]; reload(): void; lines: readonly ("short" | "medium" | "long" | "control")[] }) {
  if (status === "forbidden") return <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系管理员开通。" />;
  if (status === "not-found") return <StateBlock tone="neutral" title="找不到这部分内容" description="这个商品可能已被删除，或链接有误。请回到商品列表再看。" />;
  if (status === "loading" || status === "ready") return <Skeleton lines={lines} />;
  return (
    <StateBlock
      title="加载失败"
      description="请检查网络后重试。"
      action={
        <Button variant="secondary" onClick={reload}>
          重试
        </Button>
      }
    />
  );
}
