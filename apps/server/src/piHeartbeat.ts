import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface PiHeartbeat {
  file: string;
  size: number;
  mtime: string;
  ageSec: number;
}

export function sessionRoot(): string {
  return (
    process.env.PI_CODING_AGENT_SESSION_DIR ||
    join(homedir(), '.pi', 'agent', 'sessions')
  );
}

// pi --print 要到全部做完才吐 stdout，log 空不代表卡死。
// pi 工作時會持續寫 session jsonl，以此當心跳。
// session 檔名為 `<啟動時間>_<uuid>.jsonl`（如 2026-09-16T23-45-51-900Z_xxx.jsonl），
// 只認檔名時間與 job.startedAt 相差 3 分鐘內的，避免掃到舊 job／孤兒進程的 session
//（server 重啟會留下孤兒 pi，它們仍在寫檔；全域取最新會誤報）。
export function getPiHeartbeat(sinceIso: string): PiHeartbeat | null {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;
  let subdirs: string[];
  try {
    subdirs = readdirSync(sessionRoot(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  const now = Date.now();
  let best: PiHeartbeat | null = null;
  for (const sub of subdirs) {
    let files: string[];
    try {
      files = readdirSync(join(sessionRoot(), sub)).filter((f) =>
        f.endsWith('.jsonl'),
      );
    } catch {
      continue;
    }
    for (const f of files) {
      if (Math.abs(parseSessionStart(f) - since) > 180_000) continue;
      try {
        const st = statSync(join(sessionRoot(), sub, f));
        if (!best || st.mtimeMs > Date.parse(best.mtime)) {
          best = {
            file: f,
            size: st.size,
            mtime: new Date(st.mtimeMs).toISOString(),
            ageSec: Math.max(0, Math.round((now - st.mtimeMs) / 1000)),
          };
        }
      } catch {
        /* session 檔競寫/刪除時略過 */
      }
    }
  }
  return best;
}

// `2026-09-16T23-45-51-900Z_x.jsonl` → 該 session 啟動時間戳；格式不符回 NaN
export function parseSessionStart(file: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(file);
  if (!m) return NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}
