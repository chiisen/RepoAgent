import { useState } from 'react';
import { chartBars } from '../format';
import type { CommitMetric, CommitRank } from '../types';

export const COMMIT_CHART_LIMIT = 10;

const METRICS: { key: CommitMetric; label: string }[] = [
  { key: 'commitCount', label: '總計' },
  { key: 'commitsToday', label: '今日' },
  { key: 'commitsWeek', label: '本週' },
  { key: 'commitsMonth', label: '本月' },
];

type Props = { rows: CommitRank[]; limit?: number };

export function CommitChart({ rows, limit = COMMIT_CHART_LIMIT }: Props) {
  const [metric, setMetric] = useState<CommitMetric>('commitCount');
  if (!rows.length) return null;
  const bars = chartBars(rows, metric, limit);
  const label = METRICS.find((m) => m.key === metric)!.label;
  const heading = bars.length
    ? (metric === 'commitCount' ? '' : label + ' ') + 'commit 次數（前 ' + bars.length + ' 名）'
    : label + ' commit：此期間沒有 commit';
  return (
    <section className="chart" id="commitChart" aria-label="各專案 commit 次數排行">
      <div className="chart-head">
        <h2>{heading}</h2>
        <label className="chart-filter">
          排行
          <select
            id="chartMetric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as CommitMetric)}
          >
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {bars.length > 0 && (
        <ol className="bars">
          {bars.map((b) => (
            <li key={b.id}>
              <span className="bar-name" title={b.name}>
                {b.name}
              </span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: b.pct + '%' }} />
              </span>
              <span className="bar-val">{b.value}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
