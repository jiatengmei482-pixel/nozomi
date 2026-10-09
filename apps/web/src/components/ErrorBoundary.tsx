/** 整个页面出错（前端异常）时的兜底（docs/design/02-components.md 第 13 节）。 */
import { Component, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { StateBlock } from "./States.tsx";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal">
        <StateBlock
          headingLevel="h1"
          title="页面出了点问题"
          description="请刷新重试。如果一直这样，请联系管理员。"
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          }
        />
      </main>
    );
  }
}
