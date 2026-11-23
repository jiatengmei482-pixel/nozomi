/**
 * `/book/trip` 表单上方的「一句话描述您的行程」（M9T-33，ADR 0104 第二节第 1 小节）。
 *
 * - 先问一次 `GET /site/v1/trips/parse-status`：不可用（没配密钥、功能关了）或问不到时整块不显示，页面照常手填；
 *   全站今天的额度用完（`reason: DAILY_LIMIT`）时只显示标题和一句「今天的自动整理次数已满，请直接填写」，没有输入框。
 * - 多行输入框（最多 500 字，右下角字数）+「帮我填好」+ 一行小字。点了以后按钮变「正在整理…」、输入框只读。
 * - 成功：表单还没填行程内容时直接整份替换；已经填了先问「用 AI 整理的结果替换现在填的内容吗？」（页面上的一块，不用浏览器弹窗），选「替换」才换。
 * - 失败：输入框下面一句话（ADR 0104 第三节失败表），表单不动；没配密钥（503 `AI_NOT_CONFIGURED`）整块收起。
 * 价格和下单都不经过这里：替换后客人照常点「查看报价」，页面检查照旧。文案都在 `lib/trip-texts.ts`。
 */
import { useEffect, useId, useRef, useState } from "react";
import { getSiteTripParseStatus, parseSiteTrip } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TRIP_AI_MAX_CHARS, type TripAiFill, tripAiFailureOf, tripAiFillOf, tripAiLength } from "../../../lib/trip-ai.ts";
import { tripCopy } from "../../../lib/trip-texts.ts";

export type TripAiFilled = Extract<TripAiFill, { kind: "filled" }>;

type Status = { kind: "checking" } | { kind: "hidden" } | { kind: "limit" } | { kind: "ready"; maxChars: number };

export function TripAiInput({ isBlank, onFill }: { /** 表单现在还没填行程内容（不用问「替换吗」）；结果回来时再问一次，整理期间客人可能已经动手填了 */ isBlank(): boolean; onFill(fill: TripAiFilled): void }) {
  const id = useId();
  const inputId = `${id}-text`;
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TripAiFilled | null>(null);
  /** 用的时候才发现没配密钥（503 AI_NOT_CONFIGURED）：整块收起。用 hidden 藏起来而不是卸掉（卸掉正在用的输入框在测试环境里会卡死，见 #348） */
  const [off, setOff] = useState(false);
  const alive = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    alive.current = true;
    let current = true;
    getSiteTripParseStatus()
      .then((result) => {
        if (!current) return;
        const available = typeof result === "object" && result !== null && result.available === true;
        const max = available ? result.max_chars : 0;
        const maxChars = Number.isInteger(max) && max > 0 ? Math.min(max, TRIP_AI_MAX_CHARS) : TRIP_AI_MAX_CHARS;
        const limit = typeof result === "object" && result !== null && result.reason === "DAILY_LIMIT";
        setStatus(available ? { kind: "ready", maxChars } : limit ? { kind: "limit" } : { kind: "hidden" });
      })
      .catch(() => {
        if (current) setStatus({ kind: "hidden" });
      });
    return () => {
      current = false;
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (pending !== null) replaceButton.current?.focus();
  }, [pending]);

  if (status.kind === "limit") {
    return (
      <section aria-labelledby={`${id}-title`} className="site-section trip-ai">
        <h2 id={`${id}-title`} className="site-section__title">
          {tripCopy("ai.title")}
        </h2>
        <p className="site-muted">{tripCopy("ai.dailyLimit")}</p>
      </section>
    );
  }
  if (status.kind !== "ready") return null;
  const { maxChars } = status;
  const length = tripAiLength(text);
  const over = length > maxChars;

  const submit = async (): Promise<void> => {
    if (working) return;
    setPending(null);
    if (length === 0 || over) {
      setError(length === 0 ? tripCopy("ai.empty") : tripCopy("ai.tooManyChars", { max: maxChars }));
      input.current?.focus();
      return;
    }
    setError(null);
    setWorking(true);
    try {
      const fill = tripAiFillOf(await parseSiteTrip(text.trim()));
      if (!alive.current) return;
      if (fill.kind === "failed") setError(fill.text);
      else if (isBlank()) onFill(fill);
      else setPending(fill);
    } catch (err) {
      if (!alive.current) return;
      const failure = tripAiFailureOf(err);
      if (failure.hide) setOff(true);
      else setError(failure.text);
    } finally {
      if (alive.current) setWorking(false);
    }
  };

  const describedBy = [`${id}-count`, `${id}-note`, error !== null ? `${id}-error` : null].filter((value) => value !== null).join(" ");

  return (
    <section aria-labelledby={`${id}-title`} className="site-section trip-ai" hidden={off}>
      <h2 id={`${id}-title`} className="site-section__title">
        {tripCopy("ai.title")}
      </h2>
      <div className="field">
        <label className="visually-hidden" htmlFor={inputId}>
          {tripCopy("ai.label")}
        </label>
        <textarea
          ref={input}
          id={inputId}
          className="input textarea trip-ai__text"
          rows={3}
          value={text}
          readOnly={working}
          placeholder={tripCopy("ai.placeholder")}
          aria-invalid={error !== null && (length === 0 || over) ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            setText(event.target.value);
            setPending(null);
            setError(null);
          }}
        />
        <p id={`${id}-count`} className={over ? "field__hint trip-ai__count trip-ai__count--over" : "field__hint trip-ai__count"}>
          {tripCopy("ai.count", { n: length, max: maxChars })}
        </p>
        {error !== null && (
          <ul className="field__errors" id={`${id}-error`} role="alert">
            <li className="field__error">
              <Icon name="alert-triangle" className="field__error-icon" />
              {error}
            </li>
          </ul>
        )}
      </div>
      <div className="trip-ai__actions">
        <Button variant="primary" loading={working} loadingText={tripCopy("ai.working")} onClick={() => void submit()}>
          {tripCopy("ai.submit")}
        </Button>
      </div>
      <p id={`${id}-note`} className="site-muted trip-ai__note">
        {tripCopy("ai.note")}
      </p>
      {pending !== null && (
        <div className="trip-ai__confirm" role="group" aria-labelledby={`${id}-confirm`}>
          <p id={`${id}-confirm`}>{tripCopy("ai.replaceConfirm")}</p>
          <div className="trip-ai__actions">
            <Button
              ref={replaceButton}
              variant="primary"
              onClick={() => {
                const fill = pending;
                setPending(null);
                onFill(fill);
              }}
            >
              {tripCopy("ai.replace")}
            </Button>
            <Button
              onClick={() => {
                setPending(null);
                input.current?.focus();
              }}
            >
              {tripCopy("ai.cancel")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
