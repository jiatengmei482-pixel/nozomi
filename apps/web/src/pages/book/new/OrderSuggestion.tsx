/**
 * 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节、第四节）：主站 `/book` 和嵌入页 `/embed/book` 共用。
 * - `useOrderSuggestion`：经停点集合或其他询价字段变了、当前顺序有了可核对的询价（报价编号，或超长时的询价日志编号）以后，
 *   停 `ORDER_SUGGESTION_SETTLE` 再调 `POST /site/v1/charter/order-suggestion`；只换顺序不调（建议块在页面里按新的当前报价重算）；
 *   「保持我的顺序」以后同一组点这次不再提示；
 * - `OrderSuggestionBlock`：行程列表上方的一块提示（不弹窗）：标题（可省多少）、「当前顺序」「建议顺序」两栏（各一张行程地图、一行编号顺序、该车型的价），
 *   「采用建议顺序」「保持我的顺序」；手机上两栏改成切换，切到「建议顺序」才要那张图。
 *   建议顺序也按指定到达时间检查（M9P-20 P3）：预计晚到的经停在「建议顺序」一栏列出（只提示）。
 * 新文案走键（`itineraryCopy`，M11-01）。
 */
import { useEffect, useRef, useState } from "react";
import { type SiteMoney, type SiteOrderSuggestion, type SitePoint, type SiteQuoteRequest, createSiteOrderSuggestion } from "../../../api/site.ts";
import { Button } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { itineraryCopy } from "../../../lib/itinerary-texts.ts";
import { type LiveSuggestion, draftRequestKey, orderChain, stopSetKey, suggestionTitle } from "../../../lib/order-suggestion.ts";
import { SitePrice } from "../SitePrice.tsx";
import { ItineraryMap } from "./ItineraryMap.tsx";

/** 经停点集合或其他字段停止变化多久以后才调接口（毫秒） */
export const ORDER_SUGGESTION_SETTLE = { ms: 800 };

export interface SuggestionBasis {
  quote_id?: string;
  inquiry_ref?: string;
}

interface Fetched {
  stopKey: string;
  requestKey: string;
  suggestion: SiteOrderSuggestion | null;
}

/** 这台浏览器这次预订的会话标识（没有预订草稿时用；只用来限频） */
function newSession(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `s-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * `body`：当前顺序的按行程计价询价（≥ 2 个经停，否则 null）；`refs`：每个经停的标识（页面草稿的 `key`）；
 * `basis`：这份询价的报价编号或询价日志编号（当前报价回来、对得上 `body` 才有）；`draftId`：预订草稿编号（有就当会话）。
 */
export function useOrderSuggestion(body: SiteQuoteRequest | null, refs: readonly string[], basis: SuggestionBasis | null, draftId: string | null) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const session = useRef<string>(draftId ?? newSession());
  if (draftId !== null) session.current = draftId;
  const stopKey = body === null ? null : stopSetKey(body);
  const requestKey = body === null ? null : draftRequestKey(body);
  const asked = useRef<string | null>(null);
  const latest = useRef({ body, refs, basis });
  latest.current = { body, refs, basis };
  const wantKey = stopKey === null || requestKey === null || basis === null ? null : `${stopKey}#${requestKey}`;

  useEffect(() => {
    if (wantKey === null || asked.current === wantKey || dismissed === stopKey) return;
    let alive = true;
    const timer = setTimeout(() => {
      const now = latest.current;
      if (now.body === null || now.basis === null) return;
      asked.current = wantKey;
      const sentStop = stopKey as string;
      const sentRequest = requestKey as string;
      createSiteOrderSuggestion({ quote: now.body, refs: [...now.refs], ...now.basis, session: session.current }).then(
        (answer) => {
          if (alive) setFetched({ stopKey: sentStop, requestKey: sentRequest, suggestion: answer.suggestion });
        },
        () => {
          // 建议取不到只是不提示，报价照常；下次点集合或其他字段变了再试
          if (alive) setFetched({ stopKey: sentStop, requestKey: sentRequest, suggestion: null });
        },
      );
    }, ORDER_SUGGESTION_SETTLE.ms);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [wantKey, dismissed, stopKey, requestKey]);

  const suggestion = fetched !== null && fetched.stopKey === stopKey && dismissed !== stopKey ? fetched.suggestion : null;
  /** 其他字段变了、新的建议还没回来：「采用」先不可用 */
  const recomputing = suggestion !== null && requestKey !== null && suggestion.request_key !== requestKey;
  return { suggestion, recomputing, requestKey, keep: () => setDismissed(stopKey) };
}

interface BlockProps {
  suggestion: SiteOrderSuggestion;
  live: Extract<LiveSuggestion, { visible: true }>;
  recomputing: boolean;
  /** 两种顺序的点（地图）和名称（编号顺序一行） */
  currentPoints: readonly SitePoint[];
  suggestedPoints: readonly SitePoint[];
  currentNames: readonly string[];
  suggestedNames: readonly string[];
  /** 标题行那个车型的两个价（没有时不写） */
  currentPrice: SiteMoney | null;
  suggestedPrice: SiteMoney | null;
  /** 按建议顺序预计晚于指定到达时间的经停（M9P-20 P3）：「横滨：预计 11:20 到，晚于指定的 11:00」，没有为空 */
  suggestedLate?: readonly string[];
  /** 手机：两栏改成切换 */
  compact: boolean;
  onAdopt: () => void;
  onKeep: () => void;
}

export function OrderSuggestionBlock(props: BlockProps) {
  const { suggestion, live } = props;
  const [side, setSide] = useState<"current" | "suggested">("current");
  const title = suggestionTitle(live, suggestion);
  const column = (which: "current" | "suggested") => {
    const current = which === "current";
    const names = current ? props.currentNames : props.suggestedNames;
    const price = current ? props.currentPrice : props.suggestedPrice;
    return (
      <div className="order-suggestion__column" key={which}>
        <h4 className="order-suggestion__label">{itineraryCopy(current ? "suggestCurrent" : "suggestSuggested")}</h4>
        <ItineraryMap points={current ? props.currentPoints : props.suggestedPoints} alt={itineraryCopy("mapAlt", { chain: orderChain(names) })} />
        <p className="order-suggestion__chain">{orderChain(names)}</p>
        {!current && (props.suggestedLate ?? []).length > 0 && (
          <ul className="order-suggestion__late">
            {(props.suggestedLate ?? []).map((text) => (
              <li key={text}>
                <Icon name="alert-triangle" /> {text}
              </li>
            ))}
          </ul>
        )}
        {price !== null && !live.pending && <SitePrice text={moneyText(price)} size="sm" />}
      </div>
    );
  };
  return (
    <section className="order-suggestion" aria-labelledby="order-suggestion-title" aria-busy={live.pending ? true : undefined}>
      <h4 id="order-suggestion-title" className="order-suggestion__title">
        {title}
      </h4>
      {props.compact ? (
        <>
          <div className="order-suggestion__switch" role="group" aria-label={itineraryCopy("suggestRegion")}>
            {(["current", "suggested"] as const).map((which) => (
              <button key={which} type="button" className="order-suggestion__tab" aria-pressed={side === which} onClick={() => setSide(which)}>
                {itineraryCopy(which === "current" ? "suggestCurrent" : "suggestSuggested")}
              </button>
            ))}
          </div>
          {column(side)}
        </>
      ) : (
        <div className="order-suggestion__columns">
          {column("current")}
          {column("suggested")}
        </div>
      )}
      <div className="order-suggestion__actions">
        <Button variant="primary" disabled={live.pending || props.recomputing} onClick={props.onAdopt}>
          {props.recomputing ? itineraryCopy("suggestRecomputing") : itineraryCopy("suggestAdopt")}
        </Button>
        <Button variant="secondary" onClick={props.onKeep}>
          {itineraryCopy("suggestKeep")}
        </Button>
      </div>
    </section>
  );
}
