/**
 * 导入价格 / 导入库存（docs/design/pages/tenant-inventory.md 第 8 节）：同一个页面模板，三段——选文件 → 看检查结果 → 完成。
 * 先检查、看结果，确认了才写入；确认时把页面还拿着的那个文件再传一次，带检查时返回的文件指纹、版本号和幂等键。
 * 每一行对不对由后端判断，页面只把结果写成给人看的话。
 */
import { CURRENCIES, INVENTORY_LIMITS, PRICE_LIMITS, addDays, isCurrencyCode } from "@nozomi/domain";
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, CancelledError } from "../../../api/client.ts";
import {
  type ImportCellIssue,
  type InventoryImportPreview,
  type PriceImportPreview,
  exportInventory,
  exportPrices,
  getInventory,
  importInventory,
  importPrices,
  previewInventoryImport,
  previewPriceImport,
} from "../../../api/inventory.ts";
import type { Product, PublishCheckItemBody } from "../../../api/products.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../../components/Alert.tsx";
import { Button, LinkButton } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { Icon, type IconName } from "../../../components/Icon.tsx";
import { StateBlock } from "../../../components/States.tsx";
import { fileInvalidText, fileSizeText, inventoryConflictText, inventoryRowText, localFileIssue, priceConflictText, priceRowText } from "../../../lib/inventory-form.ts";
import { isStationPlace } from "../../../lib/price-form.ts";
import { CURRENCY_NAMES, checkItemName, checkReasons, isUnavailable } from "../../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT } from "../../../lib/product-failure.ts";
import { inventoryPath, pricePath } from "../../../lib/product-paths.ts";
import type { ProductFrame } from "../frame.ts";
import { useDownload } from "./useDownload.tsx";

type Kind = "prices" | "inventory";
type RowKind = "add" | "change" | "same" | "error" | "conflict";

/** 两种导入的检查结果，整理成页面用的同一个样子。 */
interface CheckedRow {
  row: number;
  kind: RowKind;
  what: string;
  issues: ImportCellIssue[];
  conflicts: string[];
  date: string | null;
}
interface Checked {
  version: number;
  fileSha256: string;
  canImport: boolean;
  rows: CheckedRow[];
  counts: Record<RowKind, number>;
  total: number;
}

const ROW_LOOK: Readonly<Record<RowKind, { icon: IconName; tone: string }>> = { add: { icon: "plus", tone: "info" }, change: { icon: "refresh", tone: "info" }, same: { icon: "minus", tone: "muted" }, error: { icon: "alert-circle", tone: "danger" }, conflict: { icon: "alert-triangle", tone: "warning" } };
const KIND_NAMES: Readonly<Record<Kind, Record<RowKind, string>>> = {
  prices: { add: "新增", change: "修改", same: "没变", error: "出错", conflict: "冲突" },
  inventory: { add: "设库存", change: "清除", same: "没变", error: "出错", conflict: "冲突" },
};

function fromPrices(preview: PriceImportPreview, station: boolean): Checked {
  const map = { create: "add", update: "change", unchanged: "same", error: "error", conflict: "conflict" } as const;
  const summary = preview.summary;
  return {
    version: preview.version,
    fileSha256: preview.file_sha256,
    canImport: preview.can_import,
    total: summary.rows,
    counts: { add: summary.create, change: summary.update, same: summary.unchanged, error: summary.error, conflict: summary.conflict },
    rows: preview.rows.map((row) => ({ row: row.row, kind: map[row.action], what: priceRowText(row.content, preview.currency, station), issues: row.issues, conflicts: row.conflicts_with.map((conflict) => priceConflictText(conflict, station)), date: null })),
  };
}
function fromInventory(preview: InventoryImportPreview): Checked {
  const map = { set: "add", clear: "change", unchanged: "same", error: "error", conflict: "conflict" } as const;
  const summary = preview.summary;
  return {
    version: preview.version,
    fileSha256: preview.file_sha256,
    canImport: preview.can_import,
    total: summary.rows,
    counts: { add: summary.set, change: summary.clear, same: summary.unchanged, error: summary.error, conflict: summary.conflict },
    rows: preview.rows.map((row) => ({ row: row.row, kind: map[row.action], what: inventoryRowText(row), issues: row.issues, conflicts: row.action === "conflict" ? [inventoryConflictText(row)] : [], date: row.date })),
  };
}

const count = (value: number): string => value.toLocaleString("en-US");
const problemsText = (counts: Record<RowKind, number>): string => [counts.error > 0 ? `${count(counts.error)} 行出错` : "", counts.conflict > 0 ? `${count(counts.conflict)} 行冲突` : ""].filter((part) => part !== "").join("、");

export function ImportPage({ kind, frame, product }: { kind: Kind; frame: ProductFrame; product: Product }) {
  const { token, handleAuthFailure } = usePortalSession();
  const navigate = useNavigate();
  const download = useDownload();
  const station = isStationPlace(product.poi?.type);
  const published = product.status === "published";
  const currency = product.brand?.currency ?? "";
  const digits = isCurrencyCode(currency) ? CURRENCIES[currency].minorDigits : 0;
  const back = kind === "prices" ? pricePath(product.id) : inventoryPath(product.id);
  const backName = kind === "prices" ? "价格规则" : "库存";
  const names = KIND_NAMES[kind];

  const [stage, setStage] = useState<"pick" | "checking" | "result" | "done">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [pickProblem, setPickProblem] = useState<{ text: string; retry: boolean } | null>(null);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowKind | "problems" | "all">("all");
  const [rejection, setRejection] = useState<{ kind: AlertKind; title?: string; text: string; items?: string[]; recheck?: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ text: string; date: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");
  const abort = useRef<AbortController | null>(null);
  const idempotencyKey = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const summaryTitle = useRef<HTMLDivElement>(null);

  useEffect(() => heading.current?.focus(), []);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (stage === "result" || stage === "done") summaryTitle.current?.focus();
  }, [stage, checked, rejection]);

  /** 检查：把文件传上去，只校验、不写入。 */
  const check = async (target: File): Promise<void> => {
    setFile(target);
    setStage("checking");
    setPickProblem(null);
    setPickNote(null);
    setRejection(null);
    setAnnounce(`正在检查 ${target.name}`);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = kind === "prices" ? fromPrices(await previewPriceImport(token, product.id, target, controller.signal), station) : fromInventory(await previewInventoryImport(token, product.id, target, controller.signal));
      setChecked(result);
      setCheckedAt(new Date().toLocaleTimeString("zh-Hans", { hour: "2-digit", minute: "2-digit", hour12: false }));
      setFilter(result.counts.error + result.counts.conflict > 0 ? "problems" : "all");
      idempotencyKey.current = crypto.randomUUID();
      setStage("result");
      setAnnounce(result.counts.error + result.counts.conflict > 0 ? `检查完成：${problemsText(result.counts)}` : "检查完成，没有问题");
    } catch (err) {
      setStage("pick");
      setAnnounce("");
      if (err instanceof CancelledError) return setPickNote("已取消，没有改动任何东西。");
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && (err.code === "IMPORT_FILE_INVALID" || err.status === 413)) return setPickProblem({ text: fileInvalidText(err.status, err.details), retry: false });
      if (err instanceof ApiError && err.status === 403) return setPickProblem({ text: PRODUCT_FORBIDDEN_TEXT, retry: false });
      if (err instanceof ApiError && err.status === 404) return setPickProblem({ text: "找不到这个商品，它可能已被别人删除。", retry: false });
      setPickProblem({ text: "没有检查成功，请检查网络后重试。", retry: true });
    } finally {
      abort.current = null;
    }
  };

  const choose = (files: readonly File[]): void => {
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    const issue = localFileIssue(files);
    setPickNote(null);
    if (issue !== null) return setPickProblem({ text: issue, retry: false });
    void check(files[0] as File);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    choose([...event.dataTransfer.files]);
  };
  const pickAnother = (): void => {
    if (checked !== null && file !== null && checked.counts.error + checked.counts.conflict > 0) setPickNote(`上一次检查：${file.name}，${problemsText(checked.counts)}。`);
    setStage("pick");
    setRejection(null);
    setPickProblem(null);
  };
  const backToPick = (title: string, text: string): void => {
    setStage("pick");
    setChecked(null);
    setPickProblem({ text: `${title}${text}`, retry: false });
  };

  /** 确认导入：再传一次同一个文件。 */
  const confirm = async (): Promise<void> => {
    if (file === null || checked === null || importing) return;
    setImporting(true);
    setRejection(null);
    let body: Blob;
    try {
      // 检查之后文件被改过或移走时，浏览器不让再读
      body = new Blob([await file.arrayBuffer()]);
    } catch {
      setImporting(false);
      setConfirming(false);
      return backToPick("没有导入。", "这个文件在检查之后被改动或移走了。请重新选择文件，再检查一次。");
    }
    const request = { file: body, fileSha256: checked.fileSha256, version: checked.version, idempotencyKey: idempotencyKey.current };
    try {
      if (kind === "prices") {
        const result = await importPrices(token, product.id, request);
        frame.saved(result.version);
        setDone({ text: `新增了 ${count(result.summary.create)} 条、修改了 ${count(result.summary.update)} 条价格。`, date: null });
      } else {
        const result = await importInventory(token, product.id, request);
        frame.saved(result.version);
        const earliest = checked.rows.filter((row) => row.date !== null && (row.kind === "add" || row.kind === "change")).map((row) => row.date as string).sort()[0] ?? null;
        setDone({ text: `已给 ${count(result.summary.set)} 天设了库存、清除了 ${count(result.summary.clear)} 天，共变了 ${count(result.changed_days)} 天。`, date: earliest });
      }
      setConfirming(false);
      setStage("done");
    } catch (err) {
      setConfirming(false);
      if (handleAuthFailure(err)) return;
      if (!(err instanceof ApiError)) return setRejection({ kind: "danger", title: "不确定有没有导入成功。", text: "请检查网络后再点一次「确认导入」——重复点不会导入两次。" });
      switch (err.code) {
        case "IMPORT_FILE_CHANGED":
          return backToPick("没有导入。", "这次传上去的文件和刚才检查的不是同一份。请重新选择文件，再检查一次。");
        case "IMPORT_FILE_INVALID":
          return backToPick("", fileInvalidText(err.status, err.details));
        case "VERSION_CONFLICT":
          frame.refresh();
          return setRejection({ kind: "danger", title: "没有导入。", text: "检查之后，这个商品被别人修改过。请重新检查这份文件。", recheck: true });
        case "IMPORT_NOT_CLEAN": {
          const latest = err.details["preview"];
          if (typeof latest === "object" && latest !== null) {
            const result = kind === "prices" ? fromPrices(latest as PriceImportPreview, station) : fromInventory(latest as InventoryImportPreview);
            setChecked(result);
            setFilter(result.counts.error + result.counts.conflict > 0 ? "problems" : "all");
            idempotencyKey.current = crypto.randomUUID();
          } else void check(file);
          return setRejection({ kind: "danger", title: "没有导入。", text: "再检查时发现有问题（检查之后情况有变化）。下面是最新的检查结果。" });
        }
        case "PUBLISH_CHECK_FAILED": {
          const items = Array.isArray(err.details["items"]) ? (err.details["items"] as PublishCheckItemBody[]) : [];
          const context = frame.checkContext;
          const reasons = context === null ? [] : items.filter((item) => item.required && !item.passed && !isUnavailable(item)).flatMap((item) => checkReasons(item, context).map((reason) => `${checkItemName(item.key)}：${reason.text}`));
          return setRejection({ kind: "danger", title: "没有导入。", text: "这个商品已上架，导入之后就不满足上架的条件了。请改文件，或先下架。", items: reasons });
        }
        case "CONCURRENT_UPDATE":
          return setRejection({ kind: "warning", text: "同时有其他人在修改，这次没有导入。请再点一次「确认导入」。" });
        default:
          if (err.status === 403) return setRejection({ kind: "danger", text: PRODUCT_FORBIDDEN_TEXT });
          if (err.status === 404) return setRejection({ kind: "danger", text: "找不到这个商品，它可能已被别人删除。" });
          if (err.status >= 500 || err.code === "UNKNOWN") return setRejection({ kind: "danger", title: "不确定有没有导入成功。", text: "请检查网络后再点一次「确认导入」——重复点不会导入两次。" });
          return setRejection({ kind: "danger", title: "没有导入。", text: "系统暂时无法导入，请稍后再试。" });
      }
    } finally {
      setImporting(false);
    }
  };

  if (frame.readOnly) {
    return (
      <section className="card">
        <StateBlock tone="neutral" title="你没有权限查看这里" description="导入需要修改商品的权限。需要的话，请联系你们的管理员开通。" action={<LinkButton to={back}>{`回到${backName}`}</LinkButton>} />
      </section>
    );
  }

  const exportDefault = async (): Promise<void> => {
    // 「今天」要用城市当地的：先问一次库存接口
    const day = new Date().toISOString().slice(0, 10);
    await download.run(async (session) => {
      const today = (await getInventory(session, product.id, { from: day, to: day })).today;
      return exportInventory(session, product.id, { from: today, to: addDays(today, 89) });
    }, "inventory.xlsx");
  };
  const stepsLine = (
    <p className="import-steps">
      {(["选文件", "看检查结果", "完成"] as const).map((name, index) => {
        const current = (stage === "pick" || stage === "checking" ? 0 : stage === "result" ? 1 : 2) === index;
        return (
          <span key={name}>
            {index > 0 && <span aria-hidden="true"> → </span>}
            <span className={current ? "import-steps__step import-steps__step--current" : "import-steps__step"} aria-current={current ? "step" : undefined}>{`${index + 1} ${name}`}</span>
          </span>
        );
      })}
    </p>
  );
  const head = (
    <div className="adjust-form__head">
      <Link className="link adjust-form__back" to={back}>{`‹ 回到${backName}`}</Link>
      <h3 className="adjust-form__title" ref={heading} tabIndex={-1}>
        {kind === "prices" ? "导入价格" : "导入库存"}
      </h3>
      {stepsLine}
    </div>
  );
  const status = (
    <div role="status" className="visually-hidden">
      {announce}
    </div>
  );

  if (stage === "done" && done !== null) {
    return (
      <div className="import-page">
        {head}
        {status}
        <div ref={summaryTitle} tabIndex={-1} className="import-page__focus">
          <Alert kind="success">
            <strong className="alert__title">已导入</strong>
            <span>{done.text}</span>
          </Alert>
        </div>
        <div className="import-page__actions">
          <Button variant="primary" onClick={() => void navigate(kind === "inventory" && done.date !== null ? `${back}?month=${done.date.slice(0, 7)}` : back, kind === "inventory" && done.date !== null ? { state: { inventoryDate: done.date } } : {})}>{`回到${backName}`}</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setStage("pick");
              setChecked(null);
              setFile(null);
              setDone(null);
              setPickNote(null);
            }}
          >
            再导入一份
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "result" && checked !== null && file !== null) {
    const problems = checked.counts.error + checked.counts.conflict;
    const changes = checked.counts.add + checked.counts.change;
    const willDo = kind === "prices" ? `新增 ${count(checked.counts.add)} 条、修改 ${count(checked.counts.change)} 条价格` : `给 ${count(checked.counts.add)} 天设库存、清除 ${count(checked.counts.change)} 天`;
    const shown = checked.rows.filter((row) => (filter === "all" ? true : filter === "problems" ? row.kind === "error" || row.kind === "conflict" : row.kind === filter));
    const blockedReason = problems > 0 ? "先把有问题的行改好" : changes === 0 ? "没有要导入的内容" : null;
    const summary =
      rejection !== null ? (
        <Alert kind={rejection.kind}>
          {rejection.title && <strong className="alert__title">{rejection.title}</strong>}
          <span>{rejection.text}</span>
          {rejection.items && rejection.items.length > 0 && (
            <span className="error-summary__list">
              {rejection.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </span>
          )}
          {rejection.recheck && (
            <span className="alert__actions">
              <Button size="sm" onClick={() => void check(file)}>
                重新检查
              </Button>
            </span>
          )}
        </Alert>
      ) : problems > 0 ? (
        <Alert kind="danger">
          <strong className="alert__title">{`现在不能导入：有 ${problemsText(checked.counts)}`}</strong>
          <span>
            <strong>只要有一行有问题，整份都不会写入。</strong>请在 Excel 里改好（下面写了是哪一格），保存后点「换一个文件」重新上传。没问题的行不用动。
          </span>
        </Alert>
      ) : changes === 0 ? (
        <Alert kind="info">
          <strong className="alert__title">没有要导入的内容</strong>
          <span>{checked.total === 0 ? "文件里没有填任何一行。" : `文件里的 ${count(checked.total)} 行都和现在的一样。`}</span>
        </Alert>
      ) : (
        <Alert kind="success">
          <strong className="alert__title">检查通过，可以导入</strong>
          <span>
            会<strong>{willDo}</strong>
            {checked.counts.same > 0 ? `，另有 ${count(checked.counts.same)} ${kind === "prices" ? "行" : "天"}和现在一样，不动` : ""}。点「确认导入」才会写入。
          </span>
        </Alert>
      );
    return (
      <div className="import-page">
        {head}
        {status}
        <div className="import-file">
          <span className="import-file__name">{`${file.name} · ${fileSizeText(file.size)} · ${checkedAt} 检查`}</span>
          <Button size="sm" onClick={pickAnother}>
            换一个文件
          </Button>
        </div>
        <div ref={summaryTitle} tabIndex={-1} role={rejection !== null || problems > 0 ? "alert" : "status"} className="import-page__focus">
          {summary}
        </div>
        <div className="import-counts" role="group" aria-label="各类行数">
          <span className="import-counts__total">{`共 ${count(checked.total)} 行：`}</span>
          {(["add", "change", "same", "error", "conflict"] as const).map((entry) => (
            <button key={entry} type="button" className={filter === entry ? "import-counts__item import-counts__item--on" : "import-counts__item"} aria-pressed={filter === entry} onClick={() => setFilter(filter === entry ? "all" : entry)}>
              {names[entry]} <span className="import-counts__number">{count(checked.counts[entry])}</span>
            </button>
          ))}
        </div>
        {problems > 0 && (
          <label className="choice">
            <input type="checkbox" checked={filter === "problems"} onChange={(event) => setFilter(event.target.checked ? "problems" : "all")} />
            <span className="choice__text">只看有问题的</span>
          </label>
        )}
        <div className="import-table__scroll" tabIndex={0} role="region" aria-label="检查结果">
          <table className="table import-table">
            <caption className="visually-hidden">{`检查结果，共 ${count(checked.total)} 行`}</caption>
            <thead>
              <tr>
                <th scope="col">Excel 行号</th>
                <th scope="col">结果</th>
                <th scope="col">这一行是什么</th>
                <th scope="col">说明</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const look = ROW_LOOK[row.kind];
                return (
                  <tr key={row.row}>
                    <th scope="row" className="import-table__row" data-label="Excel 行号">
                      <span className="import-table__mobile">第 </span>
                      {row.row}
                      <span className="import-table__mobile"> 行</span>
                    </th>
                    <td data-label="结果">
                      <span className={`price-state price-state--${look.tone}`}>
                        <Icon name={look.icon} />
                        {names[row.kind]}
                      </span>
                    </td>
                    <td className="import-table__what" data-label="这一行是什么">
                      {row.what}
                    </td>
                    <td className="import-table__notes" data-label="说明">
                      {row.issues.map((issue) => (
                        <span key={`${issue.cell}${issue.reason}`} className="import-table__issue">
                          <code className="import-table__cell">{issue.cell}</code> {issue.column}：{/[一-鿿]/.test(issue.message) ? issue.message : "这一格的内容不对"}
                        </span>
                      ))}
                      {row.conflicts.map((text) => (
                        <span key={text} className="import-table__issue">
                          {text}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={4}>{checked.total === 0 ? "文件里没有填任何一行。" : "没有这一类的行。"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filter !== "all" && shown.length < checked.rows.length && <p className="page-intro">{filter === "problems" ? `另有 ${count(checked.rows.length - shown.length)} 行没有问题，没有列出。` : `另有 ${count(checked.rows.length - shown.length)} 行没有列出。`}</p>}
        <p className="page-intro" id="import-confirm-note">
          检查不会改动任何东西。点「确认导入」时，系统会把这份文件再传一次，并<strong>再检查一遍文件和商品有没有变</strong>；有变化就不会写入，会请你重新检查。写入是整份一起成功或一起不写。
        </p>
        <div className="import-page__actions">
          <Button
            variant="primary"
            aria-disabled={blockedReason !== null || undefined}
            aria-describedby={blockedReason !== null ? "import-blocked" : "import-confirm-note"}
            onClick={() => {
              if (blockedReason === null) setConfirming(true);
            }}
          >
            确认导入
          </Button>
          <Button variant="secondary" onClick={pickAnother}>
            换一个文件
          </Button>
          {blockedReason !== null && (
            <span className="page-intro" id="import-blocked">
              {blockedReason}
            </span>
          )}
        </div>
        <Dialog
          open={confirming}
          title="确认导入？"
          busy={importing}
          dismissOnBackdrop={!importing}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="text" data-autofocus disabled={importing} onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button variant="primary" loading={importing} loadingText="正在导入…" onClick={() => void confirm()}>
                确认导入
              </Button>
            </>
          }
        >
          <p>{`会${willDo}。${published ? "这个商品已上架，导入后大约 1 分钟生效。" : ""}`}</p>
          <p>
            <strong>写入后不能一键撤销</strong>；要改回去，只能再导入一次或在页面上改。
          </p>
        </Dialog>
      </div>
    );
  }

  const guide: ReactNode =
    kind === "prices" ? (
      <ol className="import-guide__list">
        <li>
          第一行是表头，不要改；每一行是一条价格，<strong>{`一次最多 ${PRICE_LIMITS.maxBatchChanges} 行`}</strong>。
        </li>
        <li>
          「价格编号」：导出的行带着它，<strong>留着 = 修改这一条；新增的行留空</strong>。导入不会删除价格，要删请在页面上删。
        </li>
        <li>「区域」填区域的名称，「车型组」填车型组的编码——只能用文件第二张表「填写说明」里列出的。</li>
        <li>
          金额是<strong>结算价</strong>，币种 {currency}，{digits === 0 ? "只能填整数" : `最多 ${digits} 位小数`}。<strong>小数位多了会报错，不会自动四舍五入。</strong>
        </li>
        <li>日期写成 2026-10-01。「生效结束」留空 = 一直有效。</li>
        <li>
          <strong>不要用公式</strong>：带公式的格子会报错，请填算好的数。
        </li>
      </ol>
    ) : (
      <ol className="import-guide__list">
        <li>
          第一行是表头，不要改；每一行是一天，<strong>{`一次最多 ${INVENTORY_LIMITS.maxRangeDays} 行`}</strong>。
        </li>
        <li>
          「可售单数」填 0 到 {count(INVENTORY_LIMITS.maxDailyTotal)} 的整数。<strong>填 0 = 停售；留空 = 清除</strong>（限量时没设的日子卖不出去）。
        </li>
        <li>只能改今天和以后的日子。文件里没有的日子不会动。</li>
        <li>
          <strong>不要用公式。</strong>
        </li>
      </ol>
    );

  return (
    <div className="import-page">
      {head}
      {status}
      <div role="alert" className="step__alerts">
        {download.notice}
      </div>
      <p className="import-page__intro">
        {kind === "prices" ? "先下载模版或导出现有的价格，在 Excel 里填好，再传到这里。" : "先导出一段日期的库存，在 Excel 里填好，再传到这里。"}传上来以后先检查，<strong>检查不会改动任何东西</strong>；你看过结果、点了确认才会写入。
      </p>
      <div className="import-page__actions">
        {kind === "prices" ? (
          <>
            <Button disabled={download.busy} onClick={() => void download.run((session) => exportPrices(session, product.id, "none"), "price-template.xlsx")}>
              下载空白模版
            </Button>
            <Button disabled={download.busy} onClick={() => void download.run((session) => exportPrices(session, product.id, "all"), "prices.xlsx")}>
              导出现有的价格
            </Button>
          </>
        ) : (
          <Button disabled={download.busy} onClick={() => void exportDefault()}>
            导出今后 90 天的库存
          </Button>
        )}
        {download.busy && <span className="page-intro">正在准备文件…</span>}
      </div>
      <details className="import-guide" open>
        <summary className="import-guide__summary">怎么填</summary>
        {guide}
        {currency !== "" && kind === "prices" && digits === 0 && <p className="page-intro">{`${CURRENCY_NAMES[currency] ?? currency}没有小数。`}</p>}
      </details>
      {pickNote !== null && (
        <p className="page-intro" role="status">
          {pickNote}
        </p>
      )}
      {stage === "checking" && file !== null ? (
        <div className="import-drop import-drop--busy">
          <span className="import-file__name">{`${file.name} · ${fileSizeText(file.size)}`}</span>
          <span className="import-progress" role="progressbar" aria-label="正在检查" />
          <span>正在检查…</span>
          <Button variant="text" size="sm" onClick={() => abort.current?.abort()}>
            取消
          </Button>
        </div>
      ) : (
        <div
          className={dragging ? "import-drop import-drop--over" : "import-drop"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="import-drop__hint">把 .xlsx 文件拖到这里，或</span>
          <input ref={input} className="import-drop__input" id="import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => choose([...(event.target.files ?? [])])} />
          <label className="button button--secondary button--md import-drop__button" htmlFor="import-file">
            选择文件
          </label>
          <span className="import-drop__limit">只收 .xlsx，最大 1 MB</span>
        </div>
      )}
      <div role="alert">
        {pickProblem !== null && (
          <Alert kind="danger">
            <span>{pickProblem.text}</span>
            {pickProblem.retry && file !== null && (
              <span className="alert__actions">
                <Button size="sm" onClick={() => void check(file)}>
                  重试
                </Button>
              </span>
            )}
          </Alert>
        )}
      </div>
    </div>
  );
}
