export type Lamp = { cls: string; label: string };

export function lampOf(r: { lastError?: string | null; isDirty?: boolean }): Lamp {
  if (r.lastError) return { cls: 'lamp-fail', label: '失敗' };
  if (r.isDirty) return { cls: 'lamp-dirty', label: '有變更' };
  return { cls: 'lamp-clean', label: '乾淨' };
}

export function sliceTime(iso?: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

export function trackingLine(r: { ahead?: number | null; behind?: number | null }): string {
  if (r.ahead == null && r.behind == null) return '無 upstream';
  const a = r.ahead ?? 0;
  const b = r.behind ?? 0;
  if (a === 0 && b === 0) return '與遠端同步';
  return '領先 ' + a + '／落後 ' + b;
}

export function sliceMsg(s: string | null | undefined, n: number): string {
  return (s || '').slice(0, n);
}

export function normalizeRootDirInput(s: string): string {
  const t = s.trim();
  if (/^[a-zA-Z]:[\\/]$/.test(t)) return t[0] + ':\\';
  return t.replace(/[\\/]+$/, '');
}

export function scanCaption(p: { done?: number; total?: number; current?: string } | null): string {
  if (!p) return '掃描中…';
  const n = typeof p.done === 'number' ? p.done : 0;
  const t = typeof p.total === 'number' ? p.total : 0;
  if (!t && p.current) return p.current;
  const cur = p.current ? ' · ' + p.current : '';
  return '掃描中 ' + n + ' / ' + t + cur;
}

export function formatSize(bytes?: number | null): string {
  const n = typeof bytes === 'number' ? bytes : 0;
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
  return (n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
}

export function activityLabel(iso?: string | null, nowMs = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const days = (nowMs - t) / 86_400_000;
  if (days < 7) return '7 天內';
  if (days < 30) return '30 天內';
  if (days < 365) return '一年內';
  return '較久';
}

export function jobCls(st: string): string {
  return st === 'done' ? 'job-done' : st === 'failed' || st === 'cancelled' ? 'job-failed' : 'job-running';
}

export function repoLabel(repoId?: string | null, fallback = '專案'): string {
  if (!repoId) return fallback;
  const parts = String(repoId).replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

export function jobEndToast(
  status?: string | null,
  repoId?: string | null,
  repoName?: string | null,
): string {
  const name = (repoName && repoName.trim()) || repoLabel(repoId);
  if (status === 'cancelled') return '已取消 pi 優化：' + name;
  if (status === 'failed') return 'pi 優化失敗：' + name;
  return 'pi 優化完成：' + name;
}

export function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export type GitDiff = {
  before: { isDirty: boolean; dirtyCount: number; branch?: string | null; lastCommitHash?: string | null };
  after: { isDirty: boolean; dirtyCount: number; branch?: string | null; lastCommitHash?: string | null };
};

export function diffHtml(df: GitDiff | null | undefined): string {
  if (!df) return '';
  const flag = (v: boolean) => (v ? '有變更' : '乾淨');
  const short = (h?: string | null) => (h || '').slice(0, 7) || '—';
  return (
    '狀態 ' +
    flag(df.before.isDirty) +
    '→' +
    flag(df.after.isDirty) +
    '（M ' +
    df.before.dirtyCount +
    '→' +
    df.after.dirtyCount +
    '）<br>' +
    '分支 ' +
    escHtml(df.before.branch || '—') +
    '→' +
    escHtml(df.after.branch || '—') +
    '<br>' +
    'commit ' +
    escHtml(short(df.before.lastCommitHash)) +
    '→' +
    escHtml(short(df.after.lastCommitHash))
  );
}
