/**
 * 运营看手写内容的原文（M4-21，ADR 0055）：接口里默认打码，只有 `POST /platform/v1/orders/{id}/passenger/reveal` 给原文，每次记审计。
 * 订单详情的「查看联系方式」和工单详情的「查看原文」走同一个接口。
 */
import { useState } from "react";
import { type RevealedText, revealPlatformPassenger } from "../../api/order-money.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button } from "../../components/Button.tsx";
import { useToast } from "../../components/Toast.tsx";
import { failureText } from "../../lib/failure.ts";
import { Detail } from "./order-center-parts.tsx";

export const REVEALED_SOURCE_NAMES: Readonly<Record<RevealedText["source"], string>> = {
  order_cancel_note: "取消说明",
  contact_note: "司机的联系记录",
  event_proxy_reason: "代传原因",
  change_before: "改单前",
  change_after: "改单后",
  change_decision_note: "改单确认说明",
  extra_charge_description: "加收说明",
  extra_charge_dispute_reason: "客人的异议",
  extra_charge_decision_note: "加收审核说明",
  rescue_reason: "救援原因",
  rescue_force_majeure_note: "不可抗力说明",
  exception_resolution: "异常处理说明",
  ticket_subject: "工单标题",
  ticket_description: "工单经过",
  ticket_decision_note: "工单判定说明",
  ticket_close_note: "工单关闭说明",
  ticket_message: "工单对话",
  ticket_note: "工单内部备注",
  approval_request_note: "复核说明",
  approval_decision_note: "复核决定说明",
  approval_payload: "复核内容",
};

export function RevealedTexts({ texts }: { texts: readonly RevealedText[] }) {
  if (texts.length === 0) return null;
  return (
    <dl className="details">
      {texts.map((entry, index) => (
        <Detail key={`${entry.source}-${entry.source_id ?? ""}-${index}`} label={REVEALED_SOURCE_NAMES[entry.source]}>
          <span className="prewrap">{entry.text}</span>
        </Detail>
      ))}
    </dl>
  );
}

const TICKET_SOURCES: readonly RevealedText["source"][] = ["ticket_subject", "ticket_description", "ticket_decision_note", "ticket_close_note", "ticket_message", "ticket_note"];

/** 工单详情：这张工单里被打码的手写内容。需要 `order.read`（接口同样检查），没有权限不显示按钮。 */
export function TicketTextReveal({ orderId, ticketId }: { orderId: string; ticketId: string }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [texts, setTexts] = useState<RevealedText[] | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async (): Promise<void> => {
    setBusy(true);
    try {
      const revealed = await revealPlatformPassenger(token, orderId);
      setTexts(revealed.texts.filter((entry) => entry.source_id === ticketId && TICKET_SOURCES.includes(entry.source)));
    } catch (err) {
      if (!handleAuthFailure(err)) toast(failureText(err, "查看"));
    } finally {
      setBusy(false);
    }
  };
  if (texts === null) {
    return (
      <p className="field__hint">
        手写内容里的联系方式已打码。{" "}
        <Button variant="text" size="sm" loading={busy} onClick={() => void show()}>
          查看原文
        </Button>{" "}
        查看会记进审计日志。
      </p>
    );
  }
  return texts.length === 0 ? <p className="field__hint">这张工单没有被打码的内容。</p> : <RevealedTexts texts={texts} />;
}
