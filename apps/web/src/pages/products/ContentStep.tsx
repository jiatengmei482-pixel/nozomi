/**
 * ⑤ 商品详情（docs/design/pages/tenant-products.md 第 6 节）：给客人看的文字，四种语言各一张卡片（不做成页签）。
 * 至少一种语言要有标题；接送机商品，每种有标题的语言都要有接机指引。长度和缺项问 @nozomi/domain。
 */
import { PRODUCT_LIMITS, type ProductContent, contentIssues, contentMissing } from "@nozomi/domain";
import { useEffect, useMemo, useState } from "react";
import { type Product, type ProductContentBody, type ProductContentResponse, getProductContent, putProductContent } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Button, IconButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { CONTENT_LANGUAGES, type ContentLanguage, LANGUAGE_NAMES, LANGUAGE_TAGS, checkReasons } from "../../lib/product-display.ts";
import type { ServerIssue } from "../../lib/product-failure.ts";
import { useLoad } from "../../lib/use-load.ts";
import { type StepController, StepShell } from "./StepShell.tsx";
import type { ProductFrame, StepProblem } from "./frame.ts";

interface LanguageForm {
  title: string;
  summary: string;
  includes: string[];
  excludes: string[];
  itinerary: string;
  pickupGuide: string;
}
type ContentForm = Record<ContentLanguage, LanguageForm>;
const EMPTY: LanguageForm = { title: "", summary: "", includes: [], excludes: [], itinerary: "", pickupGuide: "" };

const clean = (text: string): string | null => (text.trim() === "" ? null : text.trim());
const cleanList = (list: readonly string[]): string[] => list.map((item) => item.trim()).filter((item) => item !== "");
const isBlank = (form: LanguageForm): boolean => clean(form.title) === null && clean(form.summary) === null && clean(form.itinerary) === null && clean(form.pickupGuide) === null && cleanList(form.includes).length === 0 && cleanList(form.excludes).length === 0;

function formFromContent(content: ProductContentBody): ContentForm {
  const one = (language: ContentLanguage): LanguageForm => {
    const text = content[language];
    return text ? { title: text.title ?? "", summary: text.summary ?? "", includes: [...text.includes], excludes: [...text.excludes], itinerary: text.itinerary ?? "", pickupGuide: text.pickup_guide ?? "" } : { ...EMPTY };
  };
  return { zh: one("zh"), ja: one("ja"), en: one("en"), ko: one("ko") };
}

/** 表单 → 请求体（一项都没填的语言不提交）和域里的写法。包车才有行程路线，接送机才有接机指引。 */
function readContent(form: ContentForm, category: Product["category"]): { body: ProductContentBody; content: ProductContent } {
  const body: ProductContentBody = {};
  const content: ProductContent = {};
  for (const language of CONTENT_LANGUAGES) {
    const text = form[language];
    if (isBlank(text)) continue;
    const itinerary = category === "charter" ? clean(text.itinerary) : null;
    const pickupGuide = category === "airport_transfer" ? clean(text.pickupGuide) : null;
    body[language] = { title: clean(text.title), summary: clean(text.summary), includes: cleanList(text.includes), excludes: cleanList(text.excludes), itinerary, pickup_guide: pickupGuide };
    content[language] = { title: clean(text.title), summary: clean(text.summary), includes: cleanList(text.includes), excludes: cleanList(text.excludes), itinerary, pickupGuide };
  }
  return { body, content };
}

export function ContentStep({ frame, product }: { frame: ProductFrame; product: Product }) {
  const { readOnly } = frame;
  const { token } = usePortalSession();
  const loaded = useLoad<ProductContentResponse>(`product-content:${product.id}`, (authToken) => getProductContent(authToken, product.id));
  const data = loaded.state.data;
  const category = product.category;
  const guideName = product.poi?.type === "station" ? "接站指引" : "接机指引";
  const FIELD_NAMES: Readonly<Record<string, string>> = { title: "标题", summary: "简介", includes: "包含", excludes: "不含", itinerary: "行程路线", pickup_guide: guideName };

  const [form, setForm] = useState<ContentForm | null>(null);
  const [baseline, setBaseline] = useState("");
  const [adopted, setAdopted] = useState<ProductContentResponse | null>(null);
  const [open, setOpen] = useState<ReadonlySet<ContentLanguage>>(new Set());
  const [clearing, setClearing] = useState<ContentLanguage | null>(null);
  const [server, setServer] = useState<Record<string, string[]>>({});
  const syncVersion = frame.syncVersion;
  useEffect(() => {
    if (data === null || data === adopted) return;
    const next = formFromContent(data.content);
    setForm(next);
    setBaseline(JSON.stringify(readContent(next, category).body));
    setAdopted(data);
    setServer({});
    const filled = CONTENT_LANGUAGES.filter((language) => !isBlank(next[language]));
    setOpen(new Set(filled.length > 0 ? filled : readOnly ? [] : ["zh"]));
    syncVersion(data.version);
  }, [data]);
  const reading = useMemo(() => (form ? readContent(form, category) : null), [form, category]);

  if (form === null || reading === null || data === null) {
    return (
      <div className="step">
        <h2 className="step__title">⑤ 商品详情</h2>
        <section className="card">
          {loaded.state.status === "error" ? (
            <StateBlock
              title="加载失败"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={loaded.reload}>
                  重试
                </Button>
              }
            />
          ) : (
            <Skeleton lines={["medium", "control", "long"]} />
          )}
        </section>
      </div>
    );
  }

  /** 域里的路径（/zh/includes/2）→ 页面上元素的 id 和字段的中文名。 */
  const place = (path: string): { target: string; label: string } => {
    const [, language = "zh", field = "title", index] = path.split("/");
    const name = `${(LANGUAGE_NAMES as Record<string, string>)[language] ?? ""}的${FIELD_NAMES[field] ?? "内容"}`;
    const base = field === "pickup_guide" ? `pickup-guide-${language}` : `${field}-${language}`;
    return { target: index !== undefined ? `${base}-${index}` : field === "includes" || field === "excludes" ? `${base}-add` : base, label: index !== undefined ? `${name}第 ${Number(index) + 1} 条` : name };
  };
  const problems: StepProblem[] = contentIssues(reading.content)
    .filter((issue) => issue.reason !== "REQUIRED")
    .map((issue) => {
      const at = place(issue.path);
      const max = issue.detail?.["max"] ?? "";
      return { target: at.target, text: issue.reason === "TOO_MANY" ? `${at.label}最多 ${max} 条` : `${at.label}最多 ${max} 个字` };
    });
  const gaps = checkReasons({ key: "content", required: true, passed: false, issues: contentMissing(reading.content, category).map((issue) => ({ ...issue, message: "" })) }, { category, brandName: "", cityName: "", placeName: null, station: product.poi?.type === "station" });

  const controller: StepController = {
    dirty: JSON.stringify(reading.body) !== baseline,
    missing: { count: gaps.length, anchor: gaps[0]?.anchor ?? null },
    validate: () => {
      const languages = new Set(problems.map((problem) => problem.target.split("-").find((part) => (CONTENT_LANGUAGES as readonly string[]).includes(part)) as ContentLanguage));
      if (languages.size > 0) setOpen(new Set([...open, ...languages]));
      return problems;
    },
    submit: async () => {
      const saved = await putProductContent(token, product.id, frame.version, reading.body);
      loaded.set(saved);
      frame.saved(saved.version);
      return product.id;
    },
    placeServerIssues: (issues: ServerIssue[]): StepProblem[] => {
      const errors: Record<string, string[]> = {};
      const found = issues.map((issue) => {
        const at = place(issue.path);
        errors[at.target] = [...(errors[at.target] ?? []), issue.message];
        return { target: at.target, text: `${at.label}：${issue.message}` };
      });
      setServer(errors);
      return found;
    },
    reload: loaded.reload,
  };

  return (
    <StepShell frame={frame} slug="content" title="⑤ 商品详情" next={{ slug: "publish", label: "保存并看上架检查" }} controller={controller} intro={<p className="step__intro">这里的内容会显示给客人。至少要有一种语言填了标题；客人用哪种语言看这个商品，就看到哪种语言的内容。使用条款、取消政策、附加费用这些文字以后由平台的模版按你设的规则自动生成，不用在这里写。</p>}>
      {({ busy, attempted, hint }) => {
        const locked = busy || readOnly;
        const errors = (target: string): string[] => [...(attempted ? problems.filter((problem) => problem.target === target).map((problem) => problem.text) : []), ...(server[target] ?? [])];
        return (
          <div id="title" className="step__cards">
            {CONTENT_LANGUAGES.map((language) => {
              const text = form[language];
              const name = LANGUAGE_NAMES[language];
              const lang = LANGUAGE_TAGS[language];
              const blank = isBlank(text);
              const expanded = open.has(language);
              const change = (changes: Partial<LanguageForm>): void => {
                setForm({ ...form, [language]: { ...text, ...changes } });
                setServer({});
              };
              const status: { icon: IconName | null; tone: string; text: string } = blank
                ? { icon: null, tone: "muted", text: "没有填" }
                : clean(text.title) === null
                  ? { icon: "alert-triangle", tone: "warning", text: "还没有标题，这种语言不会显示给客人" }
                  : category === "airport_transfer" && clean(text.pickupGuide) === null
                    ? { icon: "alert-triangle", tone: "warning", text: `还差${guideName}` }
                    : { icon: "check", tone: "success", text: "已填" };
              if (readOnly && blank) return null;
              const area = (id: string, label: string, value: string, onChange: (value: string) => void, help: string, required = false) => (
                <div className="field">
                  <label className="field__label" htmlFor={id}>
                    {label}
                    {required && (
                      <span className="field__required" aria-hidden="true">
                        {" *"}
                      </span>
                    )}
                  </label>
                  <textarea className="input textarea content__text" id={id} rows={4} lang={lang} readOnly={locked} aria-invalid={errors(id).length > 0 || undefined} value={value} onChange={(event) => onChange(event.target.value)} />
                  <FieldErrors id={`${id}-error`} errors={errors(id)} />
                  {hint === id && value.trim() === "" && (
                    <p className="field__hint field__hint--warning">
                      <Icon name="alert-triangle" />
                      <span>上架前要填这一项。</span>
                    </p>
                  )}
                  {help !== "" && <p className="field__hint">{help}</p>}
                </div>
              );
              const list = (field: "includes" | "excludes", label: string, help: string) => (
                <fieldset className="field fieldset">
                  <legend className="field__label">{`${label}（选填）`}</legend>
                  {text[field].map((item, index) => (
                    <div key={index} className="prow">
                      <input className="input" id={`${field}-${language}-${index}`} lang={lang} aria-label={`${name}${label}第 ${index + 1} 条`} readOnly={locked} aria-invalid={errors(`${field}-${language}-${index}`).length > 0 || undefined} value={item} onChange={(event) => change({ [field]: text[field].map((entry, at) => (at === index ? event.target.value : entry)) })} />
                      {!readOnly && <IconButton icon="x" label={`删除${name}${label}第 ${index + 1} 条`} disabled={busy} onClick={() => change({ [field]: text[field].filter((_, at) => at !== index) })} />}
                      <FieldErrors id={`${field}-${language}-${index}-error`} errors={errors(`${field}-${language}-${index}`)} />
                    </div>
                  ))}
                  {!readOnly && (
                    <div>
                      <Button size="sm" id={`${field}-${language}-add`} disabled={busy || text[field].length >= PRODUCT_LIMITS.maxListItems} onClick={() => change({ [field]: [...text[field], ""] })}>
                        <Icon name="plus" />
                        添加一条
                      </Button>
                      {text[field].length >= PRODUCT_LIMITS.maxListItems && <span className="field__hint">{` 最多 ${PRODUCT_LIMITS.maxListItems} 条`}</span>}
                    </div>
                  )}
                  <p className="field__hint">{help}</p>
                </fieldset>
              );
              return (
                <section key={language} className="card" aria-labelledby={`content-${language}-title`}>
                  <div className="card__title-row">
                    <h3 className="card__title" id={`content-${language}-title`}>
                      {name}
                    </h3>
                    <span className={`content__status content__status--${status.tone}`}>
                      {status.icon && <Icon name={status.icon} />}
                      {status.text}
                    </span>
                  </div>
                  {!expanded ? (
                    <div>
                      <Button
                        aria-expanded={false}
                        disabled={busy}
                        onClick={() => {
                          setOpen(new Set([...open, language]));
                          requestAnimationFrame(() => document.getElementById(`title-${language}`)?.focus());
                        }}
                      >
                        {`填写${name}`}
                      </Button>
                    </div>
                  ) : (
                    <div className="form">
                      <div className="field">
                        <label className="field__label" htmlFor={`title-${language}`}>
                          标题
                          <span className="field__required" aria-hidden="true">
                            {" *"}
                          </span>
                        </label>
                        <input className="input" id={`title-${language}`} lang={lang} autoComplete="off" readOnly={locked} aria-invalid={errors(`title-${language}`).length > 0 || undefined} value={text.title} onChange={(event) => change({ title: event.target.value })} />
                        <FieldErrors id={`title-${language}-error`} errors={errors(`title-${language}`)} />
                        {hint === "title" && gaps.some((gap) => gap.anchor === "title") && (
                          <p className="field__hint field__hint--warning">
                            <Icon name="alert-triangle" />
                            <span>上架前至少一种语言要填标题。</span>
                          </p>
                        )}
                        <p className="field__hint">商品的名字，也是你们在后台列表里看到的名字。例如「羽田机场接送」「东京市内包车」。</p>
                      </div>
                      {area(`summary-${language}`, "简介（选填）", text.summary, (summary) => change({ summary }), "")}
                      {list("includes", "包含", "价格里已经包含的，一条写一项。例如「高速费」「停车费」「举牌接机」。")}
                      {list("excludes", "不含", "价格里不包含、可能另收的，一条写一项。")}
                      {category === "charter" && area(`itinerary-${language}`, "行程路线（选填）", text.itinerary, (itinerary) => change({ itinerary }), "推荐的行程或可以去的范围。")}
                      {category === "airport_transfer" && area(`pickup-guide-${language}`, guideName, text.pickupGuide, (pickupGuide) => change({ pickupGuide }), "客人到达后怎么找到司机：在哪个出口、司机举什么牌、找不到时打哪个电话。", true)}
                      {!readOnly && (
                        <div>
                          <Button variant="text" className="button--danger-text" disabled={busy} onClick={() => (blank ? setOpen(new Set([...open].filter((entry) => entry !== language))) : setClearing(language))}>
                            {`清空${name}`}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            {readOnly && CONTENT_LANGUAGES.every((language) => isBlank(form[language])) && (
              <section className="card">
                <p className="field__hint">还没有填任何一种语言的商品详情。</p>
              </section>
            )}
            <Dialog
              open={clearing !== null}
              title={clearing ? `清空${LANGUAGE_NAMES[clearing]}的全部内容？` : ""}
              onClose={() => setClearing(null)}
              footer={
                <>
                  <Button variant="secondary" data-autofocus onClick={() => setClearing(null)}>
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (clearing === null) return;
                      setForm({ ...form, [clearing]: { ...EMPTY } });
                      setOpen(new Set([...open].filter((entry) => entry !== clearing)));
                      setClearing(null);
                    }}
                  >
                    清空
                  </Button>
                </>
              }
            >
              <p>保存后生效。</p>
            </Dialog>
          </div>
        );
      }}
    </StepShell>
  );
}
