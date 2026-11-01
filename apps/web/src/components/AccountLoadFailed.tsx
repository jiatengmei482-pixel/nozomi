/**
 * 账号信息（`auth/me`）取不到时页面显示什么：不知道角色有什么权限，页面不能判断也不能取数据，给一个重试，不一直停在骨架屏（M4-15）。
 */
import { usePortalSession } from "../auth/PortalSession.tsx";
import { Button } from "./Button.tsx";
import { StateBlock } from "./States.tsx";

export function AccountLoadFailed() {
  const { reloadAccount } = usePortalSession();
  return (
    <StateBlock
      title="加载失败"
      description="请检查网络后重试。"
      action={
        <Button variant="secondary" onClick={reloadAccount}>
          重试
        </Button>
      }
    />
  );
}
