import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Header } from './components/Header';
import { CommitChart } from './components/CommitChart';
import { Drawer, type DrawerMode } from './components/Drawer';
import { RepoGrid } from './components/RepoGrid';
import { insertRepo, jobEndToast, normalizeRootDirInput, scanCaption } from './format';
import type { CommitRank, Config, Repo, RepoStats, ScanProgress } from './types';
import { useWs } from './useWs';

const SCAN_FETCH_MS = 90_000;
const PULL_FETCH_MS = 30_000;

export function App() {
  const [rootDir, setRootDir] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [stats, setStats] = useState<RepoStats | null>(null);
  const [commitRanking, setCommitRanking] = useState<CommitRank[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [scanning, setScanning] = useState(false);
  const [scanLabel, setScanLabel] = useState('掃描中…');
  const [toastMsg, setToastMsg] = useState('');
  const [toastTone, setToastTone] = useState('');
  const [drawer, setDrawer] = useState<DrawerMode>({ kind: 'closed' });
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobsByPath, setJobsByPath] = useState<Record<string, string>>({});
  const [jobExtraLog, setJobExtraLog] = useState('');
  const [promptId, setPromptId] = useState('default');
  const [promptTemplates, setPromptTemplates] = useState<{ id: string; name: string }[]>([]);
  const [extrasEnabled, setExtrasEnabled] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobToastIds = useRef(new Set<string>());

  const toast = useCallback((m: string, ms = 4000, tone = '') => {
    setToastMsg(m);
    setToastTone(tone);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastMsg('');
      setToastTone('');
    }, ms);
  }, []);

  const loadRepos = useCallback(async () => {
    const data = await api<{ repos: Repo[]; total?: number; stats?: RepoStats; commitRanking?: CommitRank[] }>(
      '/api/repos?q=' + encodeURIComponent(q) + '&filter=' + filter + '&sort=' + sort,
    );
    setRepos(data.repos);
    if (data.stats) setStats(data.stats);
    setCommitRanking(data.commitRanking ?? []);
  }, [q, filter, sort]);

  const onJobEnded = useCallback((
    endedId?: string,
    info?: { status?: string; repoId?: string; repoName?: string },
  ) => {
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
      if (!jobToastIds.current.has(id)) {
        jobToastIds.current.add(id);
        const hasInfo = Boolean(info?.status || info?.repoName || info?.repoId);
        const tone = info?.status === 'failed' ? 'fail' : info?.status === 'cancelled' ? 'warn' : 'ok';
        toast(hasInfo ? jobEndToast(info?.status, info?.repoId, info?.repoName) : 'pi 優化已結束', 8000, tone);
      }
    }
    void loadRepos().catch(() => {});
  }, [loadRepos, activeJobId, toast]);

  const { open: wsOpen } = useWs((m) => {
    if (m.type === 'job:log') {
      if (m.jobId === activeJobId) {
        setJobExtraLog((prev) => prev + (m.line || '') + '\n');
      }
    } else if (m.type === 'job:done') {
      if (m.jobId) onJobEnded(m.jobId, { status: m.status, repoId: m.repoId });
      else void loadRepos().catch(() => {});
    } else if (m.type === 'scan:repo') {
      const repo = m.repo;
      if (repo) {
        setRepos((prev) => insertRepo(prev, repo, q, filter, sort));
        setStats((prev) => ({
          total: (prev?.total ?? 0) + 1,
          dirty: (prev?.dirty ?? 0) + (repo.isDirty ? 1 : 0),
        }));
      }
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
        setExtrasEnabled(c.extrasEnabled === true);
        if (c.promptTemplates?.length) {
          setPromptTemplates(c.promptTemplates.map((t) => ({ id: t.id, name: t.name })));
          setPromptId(c.activePromptId || c.promptTemplates[0].id);
        }
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
    setStats({ total: 0, dirty: 0 });
    setCommitRanking([]);
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
        body: JSON.stringify({ promptId }),
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

  const visibleDirty = repos.filter((r) => r.isDirty).length;

  return (
    <>
      <Header
        rootDir={rootDir}
        scanning={scanning}
        repoCount={repos.length}
        stats={stats}
        visibleDirty={visibleDirty}
        q={q}
        filter={filter}
        sort={sort}
        onRootDir={(v) => {
          setRootDir(v);
          setRepos([]);
          setStats(null);
          setCommitRanking([]);
        }}
        onRootDirNorm={applyNorm}
        onScan={() => void scanNow()}
        onQ={setQ}
        onFilter={setFilter}
        onSort={setSort}
        onSettings={() => setDrawer({ kind: 'settings' })}
        promptId={promptId}
        promptTemplates={promptTemplates}
        onPromptId={setPromptId}
      />
      {scanning && (
        <div className="scanbar" aria-live="polite">
          <i className="spin" />
          <span id="scanLabel">{scanLabel}</span>
        </div>
      )}
      <CommitChart rows={commitRanking} />
      <RepoGrid
        repos={repos}
        pullingId={pullingId}
        jobsByPath={jobsByPath}
        onDetail={(id) => setDrawer({ kind: 'detail', id })}
        onPull={(id) => void onPull(id)}
        extras={extrasEnabled}
        scanning={scanning}
        onOpt={(id, name, path) => void onOpt(id, name, path)}
      />
      <Drawer
        mode={drawer}
        onClose={() => setDrawer({ kind: 'closed' })}
        toast={toast}
        wsOpen={wsOpen}
        extraLog={jobExtraLog}
        onJobEnded={onJobEnded}
        onExtras={setExtrasEnabled}
      />
      <div id="toast" className={[toastMsg ? 'show' : '', toastTone ? 'toast-' + toastTone : ''].filter(Boolean).join(' ') || undefined}>
        {toastMsg}
      </div>
    </>
  );
}
