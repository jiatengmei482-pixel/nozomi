/**
 * 步骤导航（docs/design/02-components.md 第 24 节）：一件事分几步配完、每一步单独保存、可以来回跳。
 * 每一步下面一行状态（图标形状 + 文字，颜色只是辅助）。不能进入的步骤不是链接、不是 Tab 停靠点，但读屏读得到。
 * < 1024px 收成一个按钮，点开在原地展开。
 */
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router";
import { Icon, type IconName } from "./Icon.tsx";

export type StepTone = "success" | "warning" | "info" | "muted";

export interface StepStatus {
  icon: IconName | null;
  tone: StepTone;
  text: string;
}

export interface StepEntry {
  key: string;
  /** 编号步骤的序号（1 起）；收尾项（上架检查）不给 */
  number?: number;
  name: string;
  /** 可以进入的步骤给地址；不给就是不能进入 */
  to?: string;
  current: boolean;
  /** "loading" = 完成情况还在取 */
  status: StepStatus | "loading";
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦"];

function StatusLine({ status }: { status: StepStatus | "loading" }) {
  if (status === "loading") return <span className="step-nav__status step-nav__status--loading" aria-hidden="true" />;
  return (
    <span className={`step-nav__status step-nav__status--${status.tone}`}>
      {status.icon && <Icon name={status.icon} />}
      {status.text}
    </span>
  );
}

function Step({ step, onGo }: { step: StepEntry; onGo(): void }) {
  const body = (
    <>
      <span className="step-nav__name">
        {step.number !== undefined && (
          <>
            <span aria-hidden="true">{CIRCLED[step.number - 1]} </span>
            <span className="visually-hidden">{`第 ${step.number} 步，`}</span>
          </>
        )}
        {step.name}
        <span className="visually-hidden">，</span>
      </span>
      <StatusLine status={step.status} />
    </>
  );
  return (
    <li>
      {step.to !== undefined ? (
        <Link className={step.current ? "step-nav__item step-nav__item--current" : "step-nav__item"} to={step.to} aria-current={step.current ? "step" : undefined} onClick={onGo}>
          {body}
        </Link>
      ) : (
        <span className="step-nav__item step-nav__item--closed">{body}</span>
      )}
    </li>
  );
}

export function StepNav({ title, progress, steps, closing, note }: { title: string; progress: string; steps: readonly StepEntry[]; closing: readonly StepEntry[]; note?: ReactNode }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const current = [...steps, ...closing].find((step) => step.current);
  const statusText = current && current.status !== "loading" ? ` · ${current.status.text}` : "";
  const summary = current === undefined ? title : current.number !== undefined ? `第 ${current.number} 步，共 ${steps.length} 步 · ${current.name}${statusText}` : `${current.name}${statusText}`;
  const collapse = (): void => setExpanded(false);
  return (
    <nav className="step-nav card" aria-label={title}>
      <div className="step-nav__header">
        <span className="step-nav__title">{title}</span>
        <span className="step-nav__progress">{progress}</span>
      </div>
      <button type="button" className="button button--secondary step-nav__toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        <span className="step-nav__summary">{summary}</span>
        <Icon name="chevron-down" />
      </button>
      <div id={id} className={expanded ? "step-nav__body" : "step-nav__body step-nav__body--collapsed"}>
        <ol className="step-nav__list">
          {steps.map((step) => (
            <Step key={step.key} step={step} onGo={collapse} />
          ))}
        </ol>
        {closing.length > 0 && (
          <ul className="step-nav__list step-nav__list--closing">
            {closing.map((step) => (
              <Step key={step.key} step={step} onGo={collapse} />
            ))}
          </ul>
        )}
        {note && <p className="step-nav__note">{note}</p>}
      </div>
    </nav>
  );
}
