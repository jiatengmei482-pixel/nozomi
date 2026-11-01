/**
 * no-show 证据（M4-20，验收报告 M3-06 第二轮缺陷 1，ADR 0054）：运营订单详情和工单详情共用，不用跳页、不用调接口。
 * 权限和数据范围跟订单详情接口（`order.read`）。接口里乘客联系方式已打码，这里不提供查看入口。照片走有权限控制的文件接口，每取一次记审计。
 */
import { useCallback, useState } from "react";
import type { PlatformOrderDetail } from "../../api/order-money.ts";
import {
  CLAIM_STATUS_NAMES,
  EVIDENCE_STATE_MARKS,
  arrivalText,
  evidenceContacts,
  evidenceItems,
  freeWaitChangedNote,
  freeWaitText,
  hasEvidence,
  landingText,
  otherPhotos,
  photoOrdinals,
  reviewPhotos,
} from "../../lib/no-show-evidence.ts";
import { formatInZone } from "../../lib/dispatch-display.ts";
import { EvidencePhoto } from "../orders/EvidencePhoto.tsx";

type Source = Pick<PlatformOrderDetail, "order" | "records" | "events">;

const LOCATION_KIND_NAMES: Readonly<Record<string, string>> = { departed: "出发", arrived: "到达", picked_up: "接到客人", completed: "完成", leave_requested: "申请离开", no_show: "提交 no-show", ping: "途中" };

/** 判定对话框里的简表：对话框会盖住页面，这几条要一直看得到。 */
export function NoShowChecklistBrief({ detail }: { detail: Source }) {
  return (
    <section aria-label="5 项证据">
      <ul className="evidence-checklist">
        {evidenceItems(detail).map((entry) => (
          <li key={entry.item} className={`evidence-checklist__item evidence-checklist__item--${entry.state}`}>
            {`${EVIDENCE_STATE_MARKS[entry.state]}：${entry.name}`}
          </li>
        ))}
      </ul>
      <p className="table__muted">照片和联系记录在工单页的「no-show 证据」里，关掉对话框可以看。</p>
    </section>
  );
}

export function NoShowEvidenceSection({ detail }: { detail: Source }) {
  const { order, records } = detail;
  const zone = order.timezone;
  const claim = records.no_show_claim;
  const changed = freeWaitChangedNote(detail);
  const contacts = evidenceContacts(detail);
  const photos = reviewPhotos(detail);
  const others = otherPhotos(detail);
  const hasSignboard = photos.some((file) => file.kind === "signboard");
  const ordinals = photoOrdinals(records.files);
  const [photoProblems, setPhotoProblems] = useState<ReadonlySet<string>>(new Set());
  const reportProblem = useCallback((fileId: string, problem: boolean) => {
    setPhotoProblems((current) => {
      if (current.has(fileId) === problem) return current;
      const next = new Set(current);
      if (problem) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  }, []);
  const photo = (file: (typeof records.files)[number], autoLoad: boolean) => <EvidencePhoto key={file.id} orderId={order.id} file={file} timeZone={zone} portal="platform" autoLoad={autoLoad} ordinal={ordinals.get(file.id) ?? null} onProblem={reportProblem} />;
  return (
    <section className="card" aria-labelledby="no-show-evidence">
      <h2 className="card__title" id="no-show-evidence">{`no-show 证据（当地时间，${zone}）`}</h2>
      {!hasEvidence(detail) ? (
        <p className="table__muted">这一单没有提交 no-show，也没有到达记录、照片和联系记录。</p>
      ) : (
        <>
          <p>{claim === null ? "还没有提交 no-show，没有 5 项核对结果。下面是目前的记录。" : `${formatInZone(claim.submitted_at, zone)} 提交，${CLAIM_STATUS_NAMES[claim.status]}。「满足」是提交那一刻核对的结果。`}</p>
          {claim !== null && (
            <ul className="evidence-checklist">
              {evidenceItems(detail).map((entry) => (
                <li key={entry.item} className={`evidence-checklist__item evidence-checklist__item--${entry.state}`}>
                  <span>{`${EVIDENCE_STATE_MARKS[entry.state]}：${entry.name}`}</span>
                  <span className="table__muted">{entry.facts}</span>
                </li>
              ))}
            </ul>
          )}
          {photoProblems.size > 0 && <p className="field__hint field__hint--warning">{`有 ${photoProblems.size} 张照片没有显示出来，判定前请在下面重新取或下载原图看过。`}</p>}
          {changed !== null && <p className="field__hint field__hint--warning">{changed}</p>}
          <dl className="details">
            <div className="details__item">
              <dt>到达时间和距离</dt>
              <dd>{arrivalText(detail)}</dd>
            </div>
            <div className="details__item">
              <dt>免费等待时段</dt>
              <dd>{freeWaitText(detail)}</dd>
            </div>
            <div className="details__item">
              <dt>落地时间和来源</dt>
              <dd>{landingText(detail)}</dd>
            </div>
          </dl>

          <h3 className="card__subtitle">{`联系记录（${contacts.length} 条）`}</h3>
          {contacts.length === 0 ? (
            <p className="table__muted">司机没有记录联系客人。</p>
          ) : (
            <ul className="evidence-contacts">
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <span>{contact.text}</span>
                  {contact.file !== null && photo(contact.file, false)}
                </li>
              ))}
            </ul>
          )}

          <h3 className="card__subtitle">照片</h3>
          {!hasSignboard && <p className="table__muted">没有举牌照片。</p>}
          <div className="evidence-grid">
            {/* 没提交 no-show 的单不是在审核，不主动取照片（每取一次记一条审计），点了才取 */}
            {photos.map((file) => photo(file, claim !== null))}
            {others.map((file) => photo(file, false))}
          </div>
          <p className="table__muted">查看照片会记入操作记录。截图可能带着客人的联系方式，点了才显示。</p>

          {records.locations.length > 0 && (
            <details className="evidence-locations">
              <summary>{`司机定位记录（${records.locations.length} 条）`}</summary>
              <ul className="plain-list">
                {records.locations.map((location, index) => (
                  <li key={`${location.recorded_at}-${index}`} className="mono">{`${formatInZone(location.recorded_at, zone)} ${LOCATION_KIND_NAMES[location.kind] ?? location.kind} ${location.lat}, ${location.lng}${location.accuracy_m === null ? "" : ` ±${location.accuracy_m} 米`}`}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
