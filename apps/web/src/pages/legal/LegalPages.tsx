/**
 * 官网的三份法律文案（M9E-24，ADR 0107）：特定商取引法に基づく表記、キャンセルポリシー、プライバシーポリシー。
 *
 * - 正文逐字照搬业主 2026-11-23 确认的日文稿（docs/legal/ja-2026-11-23.md），改正文要业主重新确认；
 * - 稿子里【 】的待补项从 `GET /site/v1/legal` 读（运营后台「官网设置 → 法律文案的待补项」填），没填的显示「未設定」；
 * - キャンセルポリシー第 2 条的表按接口返回的平台当前取消政策生成（domain `cancellationTableRows`），不写死；
 * - 官网没开放时也能读（接口不要登录、不看官网开没开）。官网的外观（SiteLayout），正文 `lang="ja"`。
 */
import { LEGAL_UNSET_TEXT, type LegalFieldKey, cancellationTableColumns, cancellationTableRows, feeLabelJa, legalDateJa } from "@nozomi/domain";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type LegalFieldValues, type SiteLegal, getSiteLegal, legalPolicyOf } from "../../api/legal.ts";
import { Button } from "../../components/Button.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { LEGAL_PAGE_LINKS, LEGAL_CANCELLATION_PATH, LEGAL_PRIVACY_PATH, LEGAL_TOKUSHOHO_PATH } from "../../lib/legal-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { SiteLayout } from "../book/SiteLayout.tsx";

type LegalState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; legal: SiteLegal };

function useSiteLegal(): { state: LegalState; reload(): void } {
  const [state, setState] = useState<LegalState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getSiteLegal().then(
      (legal) => alive && setState({ kind: "ready", legal }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [round]);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  return { state, reload };
}

function titleOf(path: string): string {
  return LEGAL_PAGE_LINKS.find((page) => page.path === path)?.title ?? "";
}

/** 三个页面共用的外壳：标题、读取中、读失败（重试）。读到以后才画正文。 */
function LegalShell({ path, children }: { path: string; children(legal: SiteLegal): ReactNode }) {
  const title = titleOf(path);
  useDocumentTitle(`${title}｜NOZOMI`);
  const { state, reload } = useSiteLegal();
  return (
    <SiteLayout attribution={false}>
      <article className="legal" lang="ja" aria-labelledby="legal-title">
        <h1 className="site__title" id="legal-title">
          {title}
        </h1>
        {state.kind === "loading" && <Skeleton lines={["long", "long", "medium", "long", "short"]} label="読み込み中" />}
        {state.kind === "failed" && (
          <StateBlock
            title="内容を読み込めませんでした"
            description="通信環境をご確認のうえ、「再読み込み」を押してください。"
            action={
              <Button variant="secondary" size="lg" onClick={reload}>
                再読み込み
              </Button>
            }
          />
        )}
        {state.kind === "ready" && children(state.legal)}
      </article>
    </SiteLayout>
  );
}

/** 没填的待补项：「未設定」（警示色的底，带文字，不只靠颜色）。 */
function Unset() {
  return <span className="legal-unset">{LEGAL_UNSET_TEXT}</span>;
}

/** 一项待补项：有值显示值，没值显示「未設定」。邮箱做成 mailto 链接，多行的保留换行，日期写成「YYYY年M月D日」。 */
function Field({ fields, name }: { fields: LegalFieldValues; name: LegalFieldKey }) {
  const value = fields[name];
  if (value === null) return <Unset />;
  if (name === "contact_email") {
    return (
      <a className="link legal-break" href={`mailto:${value}`}>
        {value}
      </a>
    );
  }
  if (name === "japan_contact") return <span className="legal-multiline">{value}</span>;
  if (name === "published_on") return <>{legalDateJa(value)}</>;
  return <span className="legal-break">{value}</span>;
}

/** 表格的容器：只在自己里面横向滚动，键盘能滚（02-components.md 第 5 节） */
function TableBox({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className={wide ? "table legal-table legal-table--wide" : "table legal-table"}>{children}</table>
      </div>
    </div>
  );
}

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section className="legal-section" aria-labelledby={id}>
      <h2 className="legal-section__title" id={id}>
        {heading}
      </h2>
      {children}
    </section>
  );
}

// ---- 特定商取引法に基づく表記 ----

export function TokushohoPage() {
  return (
    <LegalShell path={LEGAL_TOKUSHOHO_PATH}>
      {({ fields }) => {
        const rows: [string, ReactNode][] = [
          ["販売事業者", <Field fields={fields} name="seller_name" />],
          ["運営統括責任者", "Lucas"],
          ["所在地", "807A, 8/F, Two Harbourfront, 22 Tak Fung Street, Hung Hom, Kowloon, Hong Kong"],
          ["日本国内の連絡先", <Field fields={fields} name="japan_contact" />],
          ["電話番号", "+852 5809 0316"],
          ["メールアドレス", <Field fields={fields} name="contact_email" />],
          ["役務の内容", "空港送迎、地点間送迎、貸切（チャーター）の配車手配。実際の運行は当社提携の運行事業者が行います。"],
          ["販売価格", "予約画面に表示する金額（税込）。空港送迎・地点間送迎は高速料金・駐車料込みの確定運賃です。"],
          ["商品代金以外の必要料金", "貸切の超過時間・超過距離・高速料金・駐車料、有料待機、当日の立寄り追加・オプション追加があった場合は、サービス後に追加請求します。カード会社が定める手数料等がかかる場合があります。"],
          ["お支払い方法", "クレジットカード・デビットカード（Stripe 経由）"],
          ["お支払い時期", "ご予約時に全額をお支払いいただきます（予約後 30 分以内）。期限を過ぎたご予約は自動的に取り消され、料金はかかりません。日時変更による差額とサービス後の追加請求は、ご同意のうえ保存したカードに請求します。"],
          ["役務の提供時期", "ご予約いただいた日時に提供します。"],
          ["キャンセル・返金", "役務の性質上、クーリング・オフはありません。キャンセルは下記「キャンセルポリシー」のとおりです。"],
          ["動作環境", "最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）"],
        ];
        return (
          <TableBox label="特定商取引法に基づく表記">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">内容</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([item, content]) => (
                <tr key={item}>
                  <th scope="row">{item}</th>
                  <td>{content}</td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        );
      }}
    </LegalShell>
  );
}

// ---- キャンセルポリシー ----

/** 第 2 条：按平台当前的取消政策生成的表和每一行的「ちょうど…とします」 */
function CancellationFees({ legal }: { legal: SiteLegal }) {
  const policy = legalPolicyOf(legal.cancellation_policy.rules);
  const columns = cancellationTableColumns(policy);
  const rows = cancellationTableRows(policy);
  return (
    <>
      <p>（ご利用日時までの時間に応じ、ご予約総額に対する割合）</p>
      <TableBox label="キャンセル料" wide>
        <thead>
          <tr>
            <th scope="col">サービス</th>
            <th scope="col">車種</th>
            {columns.map((fee) => (
              <th key={fee} scope="col">
                {feeLabelJa(fee)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.categories.join(",")}|${row.levels.join(",")}`}>
              <th scope="row">{row.serviceLabel}</th>
              <td>{row.vehicleLabel}</td>
              {row.cells.map((cell, index) => (
                <td key={columns[index]}>{cell ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableBox>
      {rows.some((row) => row.boundaryNote !== null) && (
        <ul className="legal-list">
          {rows.flatMap((row) => (row.boundaryNote === null ? [] : [<li key={`${row.serviceLabel}|${row.vehicleLabel}`}>{`${row.serviceLabel}（${row.vehicleLabel}）：${row.boundaryNote}。`}</li>]))}
        </ul>
      )}
      <p>ご予約画面に、そのご予約に適用されるキャンセル料を表示します。</p>
    </>
  );
}

export function CancellationPolicyLegalPage() {
  return (
    <LegalShell path={LEGAL_CANCELLATION_PATH}>
      {(legal) => (
        <>
          <Section id="cancel-1" heading="1. キャンセル方法">
            <p>予約確認メールに記載のリンクから、オンラインでキャンセルできます。確定前にキャンセル料を表示します。お客様をお迎えしてサービスが始まった後はキャンセルできません。</p>
          </Section>
          <Section id="cancel-2" heading="2. キャンセル料">
            <CancellationFees legal={legal} />
          </Section>
          <Section id="cancel-3" heading="3. ノーショー（無断不乗車）">
            <p>ご連絡なくお客様がお越しにならなかった場合は、キャンセル扱いとせず、全額をいただきます。</p>
          </Section>
          <Section id="cancel-4" heading="4. 無料でキャンセルできる場合">
            <ul className="legal-list">
              <li>航空便の欠航（証明書類をご提出ください）</li>
              <li>天災地変等の不可抗力</li>
              <li>運行事業者または当社の都合による場合</li>
              <li>日時変更を運行事業者がお断りした場合、または 30 分以内に確認できなかった場合</li>
            </ul>
          </Section>
          <Section id="cancel-5" heading="5. 返金">
            <p>お支払い額からキャンセル料を差し引いた金額を、お支払いに使用されたカードへ返金します。入金までの期間はカード発行会社により異なります（目安：5〜10 営業日）。</p>
          </Section>
          <Section id="cancel-6" heading="6. 日時変更">
            <p>無料キャンセル期間内で、ドライバーの出発前であれば、日時を変更できます。新しい日時で料金を再計算し、差額は返金または保存したカードへ請求します。ご利用 24 時間前を切ってからの変更は、運行事業者の確認が必要です。</p>
          </Section>
          <Section id="cancel-7" heading="7. サービス後の追加請求">
            <p>追加料金が発生した場合は、金額と根拠をメールでお知らせします。お知らせから 48 時間以内に異議をお申し出いただけます。異議がない場合は、保存したカードへ請求します。</p>
          </Section>
        </>
      )}
    </LegalShell>
  );
}

// ---- プライバシーポリシー ----

export function PrivacyPolicyPage() {
  return (
    <LegalShell path={LEGAL_PRIVACY_PATH}>
      {({ fields }) => {
        const vendors: [ReactNode, ReactNode, string, string][] = [
          ["Stripe, Inc.（日本：Stripe Japan 株式会社）", "米国・日本", "決済・返金・カード保存", "氏名、メール、電話、予約番号、金額"],
          ["Google LLC（Google Maps Platform）", "米国", "住所検索、距離・所要時間の計算", "入力された住所・位置情報（当社サーバーから送信し、お客様の IP アドレスは送りません）"],
          ["Anthropic, PBC", "米国", "AI による行程の整理（ご利用の場合のみ）", "入力された行程の文章（メール・電話番号等は伏せ字にして送信し、原文は保存しません）"],
          [<Field fields={fields} name="mail_provider" />, <Field fields={fields} name="mail_provider_country" />, "予約確認等のメール送信", "メールアドレス、氏名、予約内容"],
          [<Field fields={fields} name="map_provider" />, <Field fields={fields} name="map_provider_country" />, "画面上の地図表示", "お客様のブラウザから直接通信するため IP アドレス"],
          [<Field fields={fields} name="server_provider" />, <Field fields={fields} name="server_provider_country" />, "システム・データの保管", "保存するすべての情報"],
        ];
        return (
          <>
            <p>
              <Field fields={fields} name="seller_name" />
              （以下「当社」）は、お客様の個人情報を以下のとおり取り扱います。
            </p>
            <Section id="privacy-1" heading="1. 取得する情報">
              <ul className="legal-list">
                <li>ご予約者の氏名、電話番号、メールアドレス</li>
                <li>ご乗車の方の氏名、電話番号、ネームボードの表記（任意）</li>
                <li>メッセージアプリのアカウント（WhatsApp、LINE、WeChat、KakaoTalk のいずれか、任意）</li>
                <li>航空便名、乗降場所（住所・ホテル名・位置情報）、ご利用日時、人数、荷物数、オプション、ご要望</li>
                <li>旅行予約サイト経由のご予約では、同サイトから上記の情報を受け取ります</li>
              </ul>
              <p>カード番号は決済代行事業者（Stripe）が直接お預かりし、当社は取得・保存しません。</p>
            </Section>
            <Section id="privacy-2" heading="2. 利用目的">
              <p>ご予約の受付・配車・運行、料金の請求・返金、ご予約に関するご連絡、お問い合わせへの対応のために利用します。広告・マーケティングには利用しません。</p>
            </Section>
            <Section id="privacy-3" heading="3. 運行事業者への提供">
              <p>お支払い完了後、配車を担当する運行事業者に、配車に必要な情報（ご乗車の方の氏名・電話番号、航空便名、乗降場所等）を提供し、同社が担当ドライバーに伝えます。</p>
            </Section>
            <Section id="privacy-4" heading="4. 業務委託先・外部サービス">
              <p>以下の事業者に、必要な範囲で情報を提供します。一部は日本国外に所在します。</p>
              <TableBox label="業務委託先・外部サービス" wide>
                <thead>
                  <tr>
                    <th scope="col">事業者</th>
                    <th scope="col">所在国</th>
                    <th scope="col">目的</th>
                    <th scope="col">提供する情報</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(([vendor, country, purpose, info]) => (
                    <tr key={purpose}>
                      <th scope="row">{vendor}</th>
                      <td>{country}</td>
                      <td>{purpose}</td>
                      <td>{info}</td>
                    </tr>
                  ))}
                </tbody>
              </TableBox>
            </Section>
            <Section id="privacy-5" heading="5. 安全管理と保存期間">
              <p>氏名・電話番号・メールアドレス等は暗号化して保存し、閲覧は記録します。ご利用完了から 180 日後に、氏名・電話番号・メールアドレスを自動的に復元できない形で消去します。</p>
            </Section>
            <Section id="privacy-6" heading="6. Cookie">
              <p>広告・アクセス解析用の Cookie は使用しません。表示設定（明るい／暗い）と決済手続き中の一時情報のみ、お客様のブラウザに保存します。</p>
            </Section>
            <Section id="privacy-7" heading="7. 開示・訂正・削除のご請求・お問い合わせ">
              <p>
                <Field fields={fields} name="contact_email" />
                までご連絡ください。ご本人確認のうえ、法令に従い対応します。
              </p>
            </Section>
            <Section id="privacy-8" heading="8. 改定">
              <p>
                本ポリシーを変更する場合は、本ページでお知らせします。（制定日：
                <Field fields={fields} name="published_on" />）
              </p>
            </Section>
          </>
        );
      }}
    </LegalShell>
  );
}
