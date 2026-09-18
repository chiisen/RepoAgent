import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { diffHtml, jobCls } from '../format';
import type { Config, JobDetail, RepoDetail } from '../types';

export type DrawerMode =
  | { kind: 'closed' }
  | { kind: 'detail'; id: string }
  | { kind: 'job'; jobId: string; repoName: string }
  | { kind: 'settings' };

type Props = {
  mode: DrawerMode;
  onClose: () => void;
  toast: (m: string) => void;
  wsOpen: boolean;
  extraLog?: string;
  onJobEnded: (jobId?: string) => void;
};

export function Drawer({ mode, onClose, toast, wsOpen, extraLog, onJobEnded }: Props) {
  const open = mode.kind !== 'closed';
  return (
    <aside id="drawer" className={open ? 'open' : undefined}>
      {mode.kind === 'detail' && <DetailBody id={mode.id} onClose={onClose} toast={toast} />}
      {mode.kind === 'job' && (
        <JobBody
          jobId={mode.jobId}
          repoName={mode.repoName}
          onClose={onClose}
          toast={toast}
          wsOpen={wsOpen}
          extraLog={extraLog}
          onJobEnded={onJobEnded}
        />
      )}
      {mode.kind === 'settings' && <SettingsBody onClose={onClose} toast={toast} />}
    </aside>
  );
}

function DetailBody({ id, onClose, toast }: { id: string; onClose: () => void; toast: (m: string) => void }) {
  const [d, setD] = useState<RepoDetail | null>(null);
  useEffect(() => {
    api<RepoDetail>('/api/repos/' + id)
      .then(setD)
      .catch((e) => toast(String(e.message || e)));
  }, [id, toast]);
  if (!d) return <button onClick={onClose}>關閉</button>;
  return (
    <>
      <button id="closeD" onClick={onClose}>
        關閉
      </button>
      <h2>{d.repo.name}</h2>
      <h3>status</h3>
      <pre>{d.statusShort.join('\n') || '(乾淨)'}</pre>
      <h3>log -5</h3>
      <pre>{d.recentCommits.map((c) => c.hash.slice(0, 7) + ' ' + c.date + ' ' + c.message).join('\n')}</pre>
    </>
  );
}

function JobBody({
  jobId,
  repoName,
  onClose,
  toast,
  wsOpen,
  extraLog,
  onJobEnded,
}: {
  jobId: string;
  repoName: string;
  onClose: () => void;
  toast: (m: string) => void;
  wsOpen: boolean;
  extraLog?: string;
  onJobEnded: (jobId?: string) => void;
}) {
  const [d, setD] = useState<JobDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const endedRef = useRef(false);

  useEffect(() => {
    let stop = false;
    endedRef.current = false;
    const finish = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      onJobEnded(jobId);
    };
    const refresh = async () => {
      try {
        const next = await api<JobDetail>('/api/jobs/' + jobId);
        if (stop) return;
        setD(next);
        const st = next.job.status;
        if (st === 'done' || st === 'failed' || st === 'cancelled') {
          finish();
        }
      } catch {
        if (stop) return;
        setMissing(true);
        finish();
      }
    };
    void refresh();
    const ms = wsOpen ? 5000 : 3000;
    const t = setInterval(refresh, ms);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [jobId, wsOpen, onJobEnded]);

  const cancel = async () => {
    try {
      await api('/api/jobs/' + jobId, { method: 'DELETE' });
    } catch (e) {
      toast(String((e as Error).message || e));
    }
  };

  if (missing) {
    return (
      <>
        <button id="closeD" onClick={onClose}>
          關閉
        </button>
        <p id="jobStatus">查無 job（可能已取消或 server 重啟）</p>
        <pre id="jobLog" />
      </>
    );
  }
  const st = d?.job.status || '查詢中…';
  const hb = d?.heartbeat;
  const toMin = d?.timeoutSec ? Math.round(d.timeoutSec / 60) : null;
  const log = extraLog || (d?.logTail || []).join('\n') || (d ? '(尚無 log)' : '載入中…');
  return (
    <>
      <button id="closeD" onClick={onClose}>
        關閉
      </button>
      <h2>{repoName} 優化中</h2>
      <p>
        job <code>{jobId}</code>{' '}
        <span id="jobStatus">
          {d ? (
            <>
              <span className={jobCls(st)}>{st}</span> exit={String(d.job.exitCode)} 開始={d.job.startedAt || '—'} 結束=
              {d.job.finishedAt || '—'}
            </>
          ) : (
            st
          )}
        </span>{' '}
        <button id="cancelJob" onClick={cancel}>
          取消
        </button>
      </p>
      <p id="jobHeart">
        {d
          ? (hb
              ? 'pi 心跳：' + hb.ageSec + ' 秒前有思考紀錄（session ' + Math.round(hb.size / 1024) + 'KB）'
              : '尚無心跳（啟動中或 pi 未寫 session）') + (toMin ? '，逾時 ' + toMin + ' 分鐘' : '')
          : '心跳查詢中…'}
      </p>
      <p id="jobDiff" dangerouslySetInnerHTML={{ __html: d?.job.diff ? diffHtml(d.job.diff) : '' }} />
      <pre id="jobLog">{log}</pre>
    </>
  );
}

function SettingsBody({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [rootDir, setRootDir] = useState('');
  const [piPath, setPiPath] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [timeout, setTimeoutSec] = useState('600');
  const [piConcurrency, setPiConcurrency] = useState('2');

  useEffect(() => {
    api<Config>('/api/config')
      .then((c) => {
        setCfg(c);
        setRootDir(c.rootDir || '');
        setPiPath(c.piPath || 'pi');
        setPromptTemplate(c.promptTemplate || '');
        setTimeoutSec(String(c.timeout ?? 600));
        setPiConcurrency(String(c.piConcurrency ?? 2));
      })
      .catch((e) => toast(String(e.message || e)));
  }, [toast]);

  const save = async () => {
    try {
      await api('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootDir,
          piPath,
          promptTemplate,
          timeout: Number(timeout),
          piConcurrency: Number(piConcurrency),
        }),
      });
      toast('設定已儲存');
    } catch (e) {
      toast(String((e as ApiError).message || e));
    }
  };

  if (!cfg) {
    return (
      <>
        <button id="closeD" onClick={onClose}>
          關閉
        </button>
        <p>載入設定…</p>
      </>
    );
  }

  return (
    <>
      <button id="closeD" onClick={onClose}>
        關閉
      </button>
      <h2>設定</h2>
      <div className="field">
        <label htmlFor="cfgRootDir">rootDir</label>
        <input id="cfgRootDir" value={rootDir} onChange={(e) => setRootDir(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cfgPiPath">pi 路徑</label>
        <input id="cfgPiPath" value={piPath} onChange={(e) => setPiPath(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cfgPrompt">指令樣板</label>
        <textarea id="cfgPrompt" value={promptTemplate} onChange={(e) => setPromptTemplate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cfgTimeout">timeout（秒）</label>
        <input id="cfgTimeout" type="number" value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cfgPiConcurrency">pi 併發（1–4）</label>
        <input
          id="cfgPiConcurrency"
          type="number"
          min={1}
          max={4}
          value={piConcurrency}
          onChange={(e) => setPiConcurrency(e.target.value)}
        />
      </div>
      <button id="btnSaveConfig" type="button" onClick={save}>
        儲存
      </button>
    </>
  );
}
