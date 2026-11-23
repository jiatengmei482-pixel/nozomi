/**
 * 法律页面（M9E-24，ADR 0107）：特定商取引法に基づく表記・キャンセルポリシー・プライバシーポリシー。
 * 正文逐字照业主定稿（2026-11-23，#288 监工贴出）；定稿里留空（【 】）的几项来自运营后台的设置，没填显示「未設定」；
 * 取消费表和「ちょうど…」那句按后台当前的取消政策生成。先只有日文（其他语言随 M11）。
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type SiteLegalPages, getSiteLegalPages } from "../../api/legal-pages.ts";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { LEGAL_PATHS, LEGAL_TITLES, LEGAL_UNSET, type LegalPageKey, legalBoundarySentence, legalCancellationTable, legalDateText } from "../../lib/legal-pages.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { SiteLayout } from "../book/SiteLayout.tsx";

type Load = { kind: "loading" } | { kind: "ready"; data: SiteLegalPages } | { kind: "error" };

function useLegalPages(): { load: Load; retry: () => void } {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    getSiteLegalPages().then(
      (data) => alive && setLoad({ kind: "ready", data }),
      () => alive && setLoad({ kind: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [round]);
  const retry = useCallback(() => setRound((value) => value + 1), []);
  return { load, retry };
}

/** 运营后台填的一项；没填写「未設定」 */
function Setting({ value }: { value: string | null }) {
  return value === null ? <span className="legal-unset">{LEGAL_UNSET}</span> : <>{value}</>;
}

function LegalFrame({ page, children }: { page: LegalPageKey; children: (data: SiteLegalPages) => ReactNode }) {
  const { load, retry } = useLegalPages();
  useDocumentTitle(`${LEGAL_TITLES[page]} · NOZOMI 用车`);
  return (
    <SiteLayout>
      <article className="legal" lang="ja" aria-labelledby="legal-title">
        <h1 id="legal-title" className="legal__title">
          {LEGAL_TITLES[page]}
        </h1>
        {load.kind === "loading" && <Skeleton lines={["long", "long", "medium", "long"]} label="読み込み中" />}
        {load.kind === "error" && <StateBlock title="読み込めませんでした" description="通信状況をご確認のうえ、もう一度お試しください。" action={<Button onClick={retry}>再読み込み</Button>} />}
        {load.kind === "ready" && children(load.data)}
      </article>
    </SiteLayout>
  );
}

export function TokushohoPage() {
  return (
    <LegalFrame page="tokushoho">
      {(data) => {
        const rows: [string, ReactNode][] = [
          ["販売事業者", <Setting key="seller" value={data.seller} />],
          ["運営統括責任者", "Lucas"],
          ["所在地", "807A, 8/F, Two Harbourfront, 22 Tak Fung Street, Hung Hom, Kowloon, Hong Kong"],
          ["日本国内の連絡先", <Setting key="contact" value={data.japan_contact} />],
          ["電話番号", "+852 5809 0316"],
          ["メールアドレス", <Setting key="email" value={data.email} />],
          ["役務の内容", "空港送迎、地点間送迎、貸切（チャーター）の配車手配。実際の運行は当社提携の運行事業者が行います。"],
          ["販売価格", "予約画面に表示する金額（税込）。空港送迎・地点間送迎は高速料金・駐車料込みの確定運賃です。"],
          ["商品代金以外の必要料金", "貸切の超過時間・超過距離・高速料金・駐車料、有料待機、当日の立寄り追加・オプション追加があった場合は、サービス後に追加請求します。カード会社が定める手数料等がかかる場合があります。"],
          ["お支払い方法", "クレジットカード・デビットカード（Stripe 経由）"],
          ["お支払い時期", "ご予約時に全額をお支払いいただきます（予約後 30 分以内）。期限を過ぎたご予約は自動的に取り消され、料金はかかりません。日時変更による差額とサービス後の追加請求は、ご同意のうえ保存したカードに請求します。"],
          ["役務の提供時期", "ご予約いただいた日時に提供します。"],
          [
            "キャンセル・返金",
            <>
              役務の性質上、クーリング・オフはありません。キャンセルは下記「
              <a className="link" href={LEGAL_PATHS.cancellation}>
                キャンセルポリシー
              </a>
              」のとおりです。
            </>,
          ],
          ["動作環境", "最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）"],
        ];
        return (
          <table className="legal-table">
            <caption className="visually-hidden">{LEGAL_TITLES.tokushoho}</caption>
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">内容</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }}
    </LegalFrame>
  );
}

function CancellationTable({ data }: { data: SiteLegalPages }) {
  const table = legalCancellationTable(data.cancellation_policy.rules);
  return (
    <div className="legal-table-scroll" tabIndex={0} role="region" aria-label="キャンセル料の表">
      <table className="legal-table legal-table--grid">
        <thead>
          <tr>
            <th scope="col">サービス</th>
            <th scope="col">車種</th>
            {table.feeColumns === null ? (
              <th scope="col">キャンセル料</th>
            ) : (
              table.feeColumns.map((fee) => (
                <th key={fee} scope="col">
                  {fee}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={`${row.service}|${row.vehicles}`}>
              <td>{row.service}</td>
              <td>{row.vehicles}</td>
              {table.feeColumns === null ? (
                <td>
                  {row.tiers.map((tier) => (
                    <span key={tier.period} className="legal-table__tier">
                      {tier.period}：{tier.fee}
                    </span>
                  ))}
                </td>
              ) : (
                row.tiers.map((tier) => <td key={tier.period}>{tier.period}</td>)
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CancellationPolicyPage() {
  return (
    <LegalFrame page="cancellation">
      {(data) => {
        const boundary = legalBoundarySentence(data.cancellation_policy.rules);
        return (
          <div className="legal__body">
            <p>
              <strong>1. キャンセル方法</strong>　予約確認メールに記載のリンクから、オンラインでキャンセルできます。確定前にキャンセル料を表示します。お客様をお迎えしてサービスが始まった後はキャンセルできません。
            </p>
            <p>
              <strong>2. キャンセル料</strong>（ご利用日時までの時間に応じ、ご予約総額に対する割合）
            </p>
            <CancellationTable data={data} />
            <p>
              {boundary === null ? "" : boundary}
              ご予約画面に、そのご予約に適用されるキャンセル料を表示します。
            </p>
            <p>
              <strong>3. ノーショー（無断不乗車）</strong>　ご連絡なくお客様がお越しにならなかった場合は、キャンセル扱いとせず、全額をいただきます。
            </p>
            <p>
              <strong>4. 無料でキャンセルできる場合</strong>
            </p>
            <ul>
              <li>航空便の欠航（証明書類をご提出ください）</li>
              <li>天災地変等の不可抗力</li>
              <li>運行事業者または当社の都合による場合</li>
              <li>日時変更を運行事業者がお断りした場合、または 30 分以内に確認できなかった場合</li>
            </ul>
            <p>
              <strong>5. 返金</strong>　お支払い額からキャンセル料を差し引いた金額を、お支払いに使用されたカードへ返金します。入金までの期間はカード発行会社により異なります（目安：5〜10 営業日）。
            </p>
            <p>
              <strong>6. 日時変更</strong>　無料キャンセル期間内で、ドライバーの出発前であれば、日時を変更できます。新しい日時で料金を再計算し、差額は返金または保存したカードへ請求します。ご利用 24 時間前を切ってからの変更は、運行事業者の確認が必要です。
            </p>
            <p>
              <strong>7. サービス後の追加請求</strong>　追加料金が発生した場合は、金額と根拠をメールでお知らせします。お知らせから 48 時間以内に異議をお申し出いただけます。異議がない場合は、保存したカードへ請求します。
            </p>
          </div>
        );
      }}
    </LegalFrame>
  );
}

function ProviderRow({ name, country, purpose, info }: { name: ReactNode; country: ReactNode; purpose: string; info: string }) {
  return (
    <tr>
      <td>{name}</td>
      <td>{country}</td>
      <td>{purpose}</td>
      <td>{info}</td>
    </tr>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalFrame page="privacy">
      {(data) => (
        <div className="legal__body">
          <p>
            <Setting value={data.seller} />
            （以下「当社」）は、お客様の個人情報を以下のとおり取り扱います。
          </p>
          <p>
            <strong>1. 取得する情報</strong>
          </p>
          <ul>
            <li>ご予約者の氏名、電話番号、メールアドレス</li>
            <li>ご乗車の方の氏名、電話番号、ネームボードの表記（任意）</li>
            <li>メッセージアプリのアカウント（WhatsApp、LINE、WeChat、KakaoTalk のいずれか、任意）</li>
            <li>航空便名、乗降場所（住所・ホテル名・位置情報）、ご利用日時、人数、荷物数、オプション、ご要望</li>
            <li>旅行予約サイト経由のご予約では、同サイトから上記の情報を受け取ります</li>
          </ul>
          <p>カード番号は決済代行事業者（Stripe）が直接お預かりし、当社は取得・保存しません。</p>
          <p>
            <strong>2. 利用目的</strong>　ご予約の受付・配車・運行、料金の請求・返金、ご予約に関するご連絡、お問い合わせへの対応のために利用します。広告・マーケティングには利用しません。
          </p>
          <p>
            <strong>3. 運行事業者への提供</strong>　お支払い完了後、配車を担当する運行事業者に、配車に必要な情報（ご乗車の方の氏名・電話番号、航空便名、乗降場所等）を提供し、同社が担当ドライバーに伝えます。
          </p>
          <p>
            <strong>4. 業務委託先・外部サービス</strong>　以下の事業者に、必要な範囲で情報を提供します。一部は日本国外に所在します。
          </p>
          <div className="legal-table-scroll" tabIndex={0} role="region" aria-label="業務委託先・外部サービスの表">
            <table className="legal-table legal-table--grid">
              <thead>
                <tr>
                  <th scope="col">事業者</th>
                  <th scope="col">所在国</th>
                  <th scope="col">目的</th>
                  <th scope="col">提供する情報</th>
                </tr>
              </thead>
              <tbody>
                <ProviderRow name="Stripe, Inc.（日本：Stripe Japan 株式会社）" country="米国・日本" purpose="決済・返金・カード保存" info="氏名、メール、電話、予約番号、金額" />
                <ProviderRow name="Google LLC（Google Maps Platform）" country="米国" purpose="住所検索、距離・所要時間の計算" info="入力された住所・位置情報（当社サーバーから送信し、お客様の IP アドレスは送りません）" />
                <ProviderRow name="Anthropic, PBC" country="米国" purpose="AI による行程の整理（ご利用の場合のみ）" info="入力された行程の文章（メール・電話番号等は伏せ字にして送信し、原文は保存しません）" />
                <ProviderRow name={<Setting value={data.mail_provider.name} />} country={<Setting value={data.mail_provider.country} />} purpose="予約確認等のメール送信" info="メールアドレス、氏名、予約内容" />
                <ProviderRow name={<Setting value={data.map_provider.name} />} country={<Setting value={data.map_provider.country} />} purpose="画面上の地図表示" info="お客様のブラウザから直接通信するため IP アドレス" />
                <ProviderRow name={<Setting value={data.server_provider.name} />} country={<Setting value={data.server_provider.country} />} purpose="システム・データの保管" info="保存するすべての情報" />
              </tbody>
            </table>
          </div>
          <p>
            <strong>5. 安全管理と保存期間</strong>　氏名・電話番号・メールアドレス等は暗号化して保存し、閲覧は記録します。ご利用完了から 180 日後に、氏名・電話番号・メールアドレスを自動的に復元できない形で消去します。
          </p>
          <p>
            <strong>6. Cookie</strong>　広告・アクセス解析用の Cookie は使用しません。表示設定（明るい／暗い）と決済手続き中の一時情報のみ、お客様のブラウザに保存します。
          </p>
          <p>
            <strong>7. 開示・訂正・削除のご請求・お問い合わせ</strong>
            {"　"}
            <Setting value={data.email} />
            までご連絡ください。ご本人確認のうえ、法令に従い対応します。
          </p>
          <p>
            <strong>8. 改定</strong>　本ポリシーを変更する場合は、本ページでお知らせします。（制定日：
            <Setting value={data.published_on === null ? null : legalDateText(data.published_on)} />）
          </p>
        </div>
      )}
    </LegalFrame>
  );
}
