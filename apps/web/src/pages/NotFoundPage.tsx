/** 后台里不存在的页面：保留侧边栏和顶栏（docs/design/02-components.md 第 13 节）。 */
import { usePortalSession } from "../auth/PortalSession.tsx";
import { AppShell } from "../components/AppShell.tsx";
import { LinkButton } from "../components/Button.tsx";
import { StateBlock } from "../components/States.tsx";
import { useDocumentTitle } from "../lib/use-document-title.ts";

export function NotFoundPage() {
  const { portal } = usePortalSession();
  useDocumentTitle(`找不到这个页面 · NOZOMI ${portal.name}`);
  return (
    <AppShell pageName="找不到这个页面">
      <div className="page page--content">
        <StateBlock
          headingLevel="h1"
          title="找不到这个页面"
          description="它可能已被删除，或链接有误。"
          action={
            <LinkButton to={portal.paths.home} variant="primary">
              回到首页
            </LinkButton>
          }
        />
      </div>
    </AppShell>
  );
}
