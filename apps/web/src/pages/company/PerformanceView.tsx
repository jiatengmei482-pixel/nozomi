/**
 * 履约评分（M4-01，ADR 0028）：最近一次每日评分的五项指标、权重和得分，近 90 天的趋势，观察 / 暂停的规则。
 * 供应商后台的「履约评分」页和运营后台供应商详情的「履约评分」卡片用的是同一个组件。
 * 趋势图是装饰（`aria-hidden`），读屏和窄屏看下面的趋势表。
 */
import type { ScoreComponentKey, TenantPerformance } from "../../api/onboarding.ts";
import { Alert } from "../../components/Alert.tsx";
import { SCORE_COMPONENT_NAMES, componentValueText, observationText, scoreText, suspensionText } from "../../lib/onboarding-display.ts";

const KEYS: readonly ScoreComponentKey[] = ["dispatch", "arrival", "rating", "complaint", "failure"];

/** 近 90 天的分数折线：纵轴 0–5 分，画出 4.00、3.50 两条线。 */
function TrendChart({ trend, rules }: { trend: TenantPerformance["trend"]; rules: TenantPerformance["rules"] }) {
  if (trend.length < 2) return null;
  const width = 600;
  const height = 120;
  const x = (index: number): number => (index / (trend.length - 1)) * width;
  const y = (centi: number): number => height - (centi / 500) * height;
  const points = trend.map((day, index) => `${x(index).toFixed(1)},${y(day.score_centi).toFixed(1)}`).join(" ");
  return (
    <svg className="score-trend" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <line className="score-trend__threshold score-trend__threshold--watch" x1="0" x2={width} y1={y(rules.observation_below_centi)} y2={y(rules.observation_below_centi)} />
      <line className="score-trend__threshold score-trend__threshold--suspend" x1="0" x2={width} y1={y(rules.suspend_below_centi)} y2={y(rules.suspend_below_centi)} />
      <polyline className="score-trend__line" points={points} />
    </svg>
  );
}

export function PerformanceView({ performance, audience }: { performance: TenantPerformance; audience: "tenant" | "platform" }) {
  const { latest, rules, trend } = performance;
  const recent = [...trend].reverse().slice(0, 14);
  return (
    <div className="performance">
      {performance.status === "suspended" && performance.suspension_reasons.length > 0 && (
        <Alert kind="warning">
          <strong className="alert__title">已暂停。</strong>
          <span>{`原因：${suspensionText(performance.suspension_reasons)}。`}</span>
        </Alert>
      )}
      {performance.observation_reasons.length > 0 && (
        <Alert kind="info">
          <strong className="alert__title">在观察期。</strong>
          <span>{`原因：${observationText(performance.observation_reasons)}。观察期里比价时排序价按对外价 ×1.05 计算；原因消除后自动退出。`}</span>
        </Alert>
      )}
      {latest === null ? (
        <p className="page-intro">还没有评分：每天会按最近 {rules.window_days} 天的数据算一次。完成不足 {rules.min_completed_orders} 单时按默认 {scoreText(rules.default_score_centi)} 分参与比价。</p>
      ) : (
        <>
          <dl className="details score-summary">
            <div>
              <dt>比价用的分</dt>
              <dd className="score-summary__value">{scoreText(latest.score_centi)}</dd>
            </div>
            <div>
              <dt>按数据算出的分</dt>
              <dd>{latest.raw_score_centi === null ? "还没有数据" : scoreText(latest.raw_score_centi)}</dd>
            </div>
            <div>
              <dt>{`近 ${rules.window_days} 天完成订单`}</dt>
              <dd>{`${latest.completed_orders} 单`}</dd>
            </div>
            <div>
              <dt>{`近 ${rules.no_show_window_days} 天司机未到`}</dt>
              <dd>{`${latest.no_shows} 次`}</dd>
            </div>
            <div>
              <dt>算的是哪一天</dt>
              <dd>{`${latest.date}（${latest.window_from} 起）`}</dd>
            </div>
          </dl>
          {latest.is_default && <p className="page-intro">{`完成不足 ${rules.min_completed_orders} 单：比价时按默认 ${scoreText(rules.default_score_centi)} 分算。下面是按现有数据算出的各项，供参考。`}</p>}
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="评分的各项指标">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">指标</th>
                    <th scope="col">近 90 天</th>
                    <th scope="col">得分（5 分制）</th>
                    <th scope="col">权重</th>
                  </tr>
                </thead>
                <tbody>
                  {KEYS.map((key) => {
                    const component = latest.components[key];
                    return (
                      <tr key={key}>
                        <th scope="row">{SCORE_COMPONENT_NAMES[key]}</th>
                        <td>{componentValueText(key, component.value)}</td>
                        <td>{component.points_centi === null ? "—" : scoreText(component.points_centi)}</td>
                        <td>{component.weight_bp === 0 ? "不计（没有数据）" : `${(component.weight_bp / 100).toFixed(component.weight_bp % 100 === 0 ? 0 : 2)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <p className="field__hint">
        {`规则：评分按最近 ${rules.window_days} 天滚动、每天重算；低于 ${scoreText(rules.observation_below_centi)} 进入观察期，低于 ${scoreText(rules.suspend_below_centi)} 自动暂停${audience === "tenant" ? "，需要平台人工恢复" : "，由运营人工恢复"}；近 ${rules.no_show_window_days} 天司机未到 ${rules.no_show_observation} 次进入观察期、${rules.no_show_suspend} 次自动暂停。某一项没有数据时不计入，其余按比例。`}
      </p>
      {trend.length > 0 && (
        <section aria-labelledby="score-trend-title" className="score-trend-section">
          <h3 className="card__subtitle" id="score-trend-title">
            评分趋势
          </h3>
          <TrendChart trend={trend} rules={rules} />
          <div className="table-wrap">
            <div className="table-scroll" tabIndex={0} role="region" aria-label="评分趋势（最近 14 天）">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">比价用的分</th>
                    <th scope="col">按数据的分</th>
                    <th scope="col">完成订单</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((day) => (
                    <tr key={day.date}>
                      <th scope="row">{day.date}</th>
                      <td>{`${scoreText(day.score_centi)}${day.is_default ? "（默认）" : ""}`}</td>
                      <td>{scoreText(day.raw_score_centi)}</td>
                      <td>{day.completed_orders}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
