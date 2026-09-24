/**
 * PiSessionHeartbeatProbe — IHeartbeatProbe / ISessionRootProvider 實作。
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { IHeartbeatProbe, ISessionRootProvider } from '../../domain/ports.js';
import type { PiHeartbeat } from '../../domain/types.js';

export class DefaultSessionRootProvider implements ISessionRootProvider {
  root(): string {
    return process.env.PI_CODING_AGENT_SESSION_DIR || join(homedir(), '.pi', 'agent', 'sessions');
  }
}

export class PiSessionHeartbeatProbe implements IHeartbeatProbe {
  constructor(private readonly sessionRoot: ISessionRootProvider) {}

  getHeartbeat(sinceIso: string): PiHeartbeat | null {
    const since = Date.parse(sinceIso);
    if (!Number.isFinite(since)) return null;
    const root = this.sessionRoot.root();
    let subdirs: string[];
    try {
      subdirs = readdirSync(root, { withFileTypes: true })
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
        files = readdirSync(join(root, sub)).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        if (Math.abs(parseSessionStart(f) - since) > 180_000) continue;
        try {
          const st = statSync(join(root, sub, f));
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
}

/** 解析 session 檔名的啟動時間戳；格式不符回 NaN。 */
export function parseSessionStart(file: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(file);
  if (!m) return NaN;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}
