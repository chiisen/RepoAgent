import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Header } from './components/Header';
import { Drawer, type DrawerMode } from './components/Drawer';
import { RepoGrid } from './components/RepoGrid';
import { normalizeRootDirInput, scanCaption } from './format';
import type { Config, Repo, ScanProgress } from './types';
import { useWs } from './useWs';

const SCAN_FETCH_MS = 90_000;
const PULL_FETCH_MS = 30_000;

export function App() {
  const [rootDir, setRootDir] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [scanning, setScanning] = useState(false);
  const [scanLabel, setScanLabel] = useState('掃描中…');
  const [toastMsg, setToastMsg] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobsByPath, setJobsByPath] = useState<Record<string, string>>({});
  const [jobExtraLog, setJobExtraLog] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 4000);
  }, []);

  const loadRepos = useCallback(async () => {
    const data = await api<{ repos: Repo[]; total?: number }>(
      '/api/repos?q=' + encodeURIComponent(q) + '&filter=' + filter + '&sort=' + sort,
    );
    setRepos(data.repos);
    setTotal(data.total ?? data.repos.length);
  }, [q, filter, sort]);

  const onJobEnded = useCallback((endedId?: string) => {
    const id = endedId || activeJobId;
    if (id) {
      setJobsByPath((prev) => {
        const next = { ...prev };
        for (const [p, j] of Object.entries(next)) {
          if (j === id) delete next[p];
        }
        return next;
      });
      setActiveJobId((cur) => (cur === id ? null : cur));
    }
    void loadRepos().catch(() => {});
  }, [loadRepos, activeJobId]);

  const { open: wsOpen } = useWs((m) => {
    if (m.type === 'job:log') {
      if (m.jobId === activeJobId) {
        setJobExtraLog((prev) => prev + (m.line || '') + '\n');
      }
    } else if (m.type === 'job:done') {
      if (m.jobId) onJobEnded(m.jobId);
      else void loadRepos().catch(() => {});
    } else if (m.type === 'scan:done') {
      if (!scanning) {
        toast('掃描完成：' + m.okCount + ' 成功 / ' + m.failCount + ' 失敗');
        void loadRepos().catch(() => {});
      }
    }
  });

  useEffect(() => {
    api<Config>('/api/config')
      .then((c) => {
        if (c.rootDir) setRootDir(normalizeRootDirInput(c.rootDir));
        return loadRepos();
      })
      .then(() =>
        api<{ jobs: { id: string; repoId: string }[] }>('/api/jobs').then((d) => {
          const map: Record<string, string> = {};
          for (const j of d.jobs || []) map[j.repoId] = j.id;
          setJobsByPath(map);
        }),
      )
      .catch((e) => toast(String(e.message || e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadRepos().catch((e) => toast(String(e.message || e)));
  }, [loadRepos, toast]);

  const applyNorm = () => {
    setRootDir((v) => normalizeRootDirInput(v));
  };

  const scanNow = async () => {
    if (scanning) return;
    const dir = normalizeRootDirInput(rootDir);
    setRootDir(dir);
    if (!dir) {
      toast('請先貼上要掃的目錄');
      return;
    }
    setRepos([]);
    setTotal(0);
    setScanning(true);
    setScanLabel('掃描中…');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SCAN_FETCH_MS);
    const poll = setInterval(async () => {
      try {
        const p = await api<ScanProgress>('/api/scan/progress');
        setScanLabel(scanCaption(p));
      } catch {
        /* 舊伺服器略過 */
      }
    }, 250);
    try {
      await api('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: dir }),
        signal: ac.signal,
      });
      const s = await api<{ okCount: number; failCount: number }>('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootDir: dir }),
        signal: ac.signal,
      });
      toast('掃描完成：' + s.okCount + ' 成功 / ' + s.failCount + ' 失敗');
      await loadRepos();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast('掃描逾時，請改掃較小的目錄（只掃下一層 git 專案）');
      } else {
        toast(String((e as Error).message || e));
      }
    } finally {
      clearInterval(poll);
      clearTimeout(timer);
      setScanning(false);
    }
  };

  const onPull = async (id: string) => {
    setPullingId(id);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PULL_FETCH_MS);
    try {
      const r = await api<{ message?: string }>('/api/repos/' + id + '/pull', { method: 'POST', signal: ac.signal });
      toast((r.message || '已更新').slice(0, 200));
    } catch (e) {
      await loadRepos().catch(() => {});
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast('更新逾時，遠端可能在等 Git 憑證');
      } else {
        toast(String((e as Error).message || e));
      }
    } finally {
      await loadRepos().catch(() => {});
      clearTimeout(timer);
      setPullingId(null);
    }
  };

  const onOpt = async (id: string, name: string, repoPath: string) => {
    const existing = jobsByPath[repoPath];
    if (existing) {
      toast('此專案優化執行中，開啟監控');
      setActiveJobId(existing);
      setJobExtraLog('');
      setDrawer({ kind: 'job', jobId: existing, repoName: name });
      return;
    }
    try {
      const r = await api<{ job: { id: string; repoId: string } }>('/api/repos/' + id + '/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      toast('已排程 job ' + r.job.id);
      setJobsByPath((prev) => ({ ...prev, [r.job.repoId || repoPath]: r.job.id }));
      setActiveJobId(r.job.id);
      setJobExtraLog('');
      setDrawer({ kind: 'job', jobId: r.job.id, repoName: name });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.jobId) {
        toast('此專案優化執行中，開啟監控');
        const jid = String(e.body.jobId);
        setJobsByPath((prev) => ({ ...prev, [repoPath]: jid }));
        setActiveJobId(jid);
        setJobExtraLog('');
        setDrawer({ kind: 'job', jobId: jid, repoName: name });
      } else {
        toast(String((e as Error).message || e));
      }
    }
  };

  return (
    <>
      <Header
        rootDir={rootDir}
        scanning={scanning}
        repoCount={total}
        q={q}
        filter={filter}
        sort={sort}
        onRootDir={(v) => {
          setRootDir(v);
          setRepos([]);
          setTotal(0);
        }}
        onRootDirNorm={applyNorm}
        onScan={() => void scanNow()}
        onQ={setQ}
        onFilter={setFilter}
        onSort={setSort}
        onSettings={() => setDrawer({ kind: 'settings' })}
      />
      <RepoGrid
        repos={repos}
        pullingId={pullingId}
        jobsByPath={jobsByPath}
        onDetail={(id) => setDrawer({ kind: 'detail', id })}
        onPull={(id) => void onPull(id)}
        onOpt={(id, name, path) => void onOpt(id, name, path)}
      />
      <div id="scanMask" className={scanning ? 'show' : undefined} aria-live="polite">
        <span>
          <i className="spin" />
          <span id="scanLabel">{scanLabel}</span>
        </span>
      </div>
      <Drawer
        mode={drawer}
        onClose={() => setDrawer({ kind: 'closed' })}
        toast={toast}
        wsOpen={wsOpen}
        extraLog={jobExtraLog}
        onJobEnded={onJobEnded}
      />
      <div id="toast" className={toastMsg ? 'show' : undefined}>
        {toastMsg}
      </div>
    </>
  );
}
