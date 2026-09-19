import { activityLabel, formatSize, lampOf, sliceMsg, sliceTime, trackingLine } from '../format';
import type { Repo } from '../types';

type Props = {
  repo: Repo;
  busy: boolean;
  extras?: boolean;
  onDetail: () => void;
  onPull: () => void;
  onOpt: () => void;
};

export function RepoCard({ repo: r, busy, extras, onDetail, onPull, onOpt }: Props) {
  const lamp = lampOf(r);
  const msg = sliceMsg(r.lastCommitMsg, 72);
  const t = sliceTime(r.lastCommitTime);
  const pullAt = sliceTime(r.lastPullAt);
  const pullMsg = sliceMsg(r.lastPullMsg, 80);
  return (
    <article className="card" data-id={r.id}>
      <div className="title">
        <span>{r.name}</span>
        <span className={lamp.cls}>{lamp.label}</span>
      </div>
      <div className="meta">
        分支 {r.branch || '—'}
        <br />
        遠端 {sliceMsg(r.remoteUrl, 80) || '—'}
        <br />
        追蹤 {trackingLine(r)}
        <br />
        狀態 {r.isDirty ? '變更 ' + r.dirtyCount : '乾淨'}
        <br />
        {extras ? (
          <>
            語言 {r.language || '—'}
            <br />
            大小 {formatSize(r.sizeBytes)}
            {r.extrasTruncated ? '（截斷）' : ''}
            <br />
            活躍 {activityLabel(r.lastCommitTime)}
            <br />
          </>
        ) : null}
        最後 commit {t} {msg}
        <br />
        上次掃描 {r.lastScannedAt || '—'}
        <br />
        最後更新 <span className="pull-time">{pullAt || '—'}</span> <span className="pull-msg">{pullMsg || ''}</span>
      </div>
      <div className="actions">
        <button data-act="detail" onClick={onDetail}>
          詳情
        </button>
        <button data-act="pull" disabled={busy} onClick={onPull}>
          {busy ? '更新中' : '更新'}
        </button>
        <button data-act="opt" disabled={busy} onClick={onOpt}>
          用 pi 優化
        </button>
      </div>
    </article>
  );
}
