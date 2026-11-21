/**
 * 运营后台「第三方密钥」里 Claude 那一项下面的「使用的型号」（M9T-32，ADR 0104 第六节）：
 * 三选一（Sonnet / Haiku / 先 Haiku 出错再用 Sonnet，默认第三种：业主 2026-11-21 选定，ADR 0104 第十二节），保存后下一次解析就用新的，不重新部署；
 * 下面一行是东京时间今天每个型号用了几次、全站已用 / 上限。只有超级管理员能改，技术只能看。
 */
import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type AiTripModelMode, type AiTripSettings, getAiTripSettings, updateAiTripSettings } from "../../api/platform.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { type ChoiceOption, RadioGroup } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { useLoad } from "../../lib/use-load.ts";

export const AI_TRIP_MODE_OPTIONS: readonly ChoiceOption<AiTripModelMode>[] = [
  { value: "sonnet", label: "Sonnet", hint: "测试集准确率和 Haiku 一样（99.6%），慢约 1 秒。一次约 ¥0.4。客人反馈填错多时可以切到这一项。" },
  { value: "haiku", label: "Haiku", hint: "最便宜、最快，一次约 ¥0.03；出错时不重试，直接让客人手填。" },
  { value: "haiku_then_sonnet", label: "先 Haiku，出错再用 Sonnet（默认，推荐）", hint: "多数时候是 Haiku 的价钱；Haiku 超时、出错、拒答时自动改用 Sonnet 重试一次。理解错了但格式对的情况它发现不了，靠客人在表单上看、改。" },
];

const modeLabel = (mode: AiTripModelMode): string => AI_TRIP_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;

/** 「今天（东京时间）：Sonnet 3 次（其中改用 Sonnet 重试 1 次）· Haiku 5 次 · 全站已用 7 / 300 次」 */
export function aiTripUsageText(today: AiTripSettings["today"]): string {
  const retries = today.sonnet_retries > 0 ? `（其中改用 Sonnet 重试 ${today.sonnet_retries} 次）` : "";
  return `今天（东京时间 ${today.date}）：Sonnet ${today.sonnet} 次${retries} · Haiku ${today.haiku} 次 · 全站已用 ${today.used} / ${today.limit} 次`;
}

export function AiTripModelCard({ canManage }: { canManage: boolean }) {
  const loaded = useLoad<AiTripSettings>("ai-trip-settings", getAiTripSettings);
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const titleId = useId();
  const [choice, setChoice] = useState<AiTripModelMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = loaded.state.data;
  const current = choice ?? data?.model_mode ?? null;

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (data === null || current === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateAiTripSettings(token, data.version, current);
      loaded.set(saved);
      setChoice(null);
      toast(`AI 行程解析改为「${modeLabel(saved.model_mode)}」，下一次解析起生效`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        setError("别人刚改过这里，已经换成最新的设置，请再确认一次。");
        setChoice(null);
        loaded.reload();
      } else setError(failureText(err, "保存"));
    } finally {
      setSaving(false);
    }
  };

  let body;
  if (data === null) {
    body =
      loaded.state.status === "loading" ? (
        <Skeleton lines={["medium", "control"]} label="使用的型号加载中" />
      ) : loaded.state.status === "forbidden" ? (
        <StateBlock headingLevel="h3" tone="neutral" title="你没有权限查看使用的型号" />
      ) : (
        <StateBlock headingLevel="h3" title="使用的型号加载失败" description="请检查网络后重试。" action={<Button onClick={loaded.reload}>重试</Button>} />
      );
  } else {
    body = (
      <form onSubmit={(event) => void save(event)} noValidate>
        <RadioGroup legend="AI 行程解析用哪个 Claude 型号" name="ai-trip-model" options={AI_TRIP_MODE_OPTIONS} value={current} onChange={(mode: AiTripModelMode) => setChoice(mode)} readOnly={!canManage} hint="保存后下一次解析起生效，不用重新部署。价格只由报价引擎算，和型号无关。" />
        {error !== null && (
          <Alert kind="danger">
            <span>{error}</span>
          </Alert>
        )}
        {canManage && (
          <div className="card__actions">
            <Button type="submit" variant="primary" loading={saving} loadingText="保存中…" disabled={current === data.model_mode && data.version > 0}>
              保存
            </Button>
          </div>
        )}
        <p className="field__hint">{aiTripUsageText(data.today)}</p>
      </form>
    );
  }

  return (
    <section className="card secret-card" aria-labelledby={titleId}>
      <div className="card__header">
        <h3 className="card__title" id={titleId}>
          Claude（AI 行程解析）· 使用的型号
        </h3>
      </div>
      {body}
    </section>
  );
}
