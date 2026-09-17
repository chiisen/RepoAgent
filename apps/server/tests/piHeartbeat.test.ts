import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPiHeartbeat, parseSessionStart } from '../src/piHeartbeat.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-heart-'));
  dirs.push(root);
  return root;
}

describe('parseSessionStart', () => {
  it('解析檔名前綴時間', () => {
    expect(parseSessionStart('2026-09-16T23-45-51-900Z_x.jsonl')).toBe(
      Date.parse('2026-09-16T23:45:51Z'),
    );
  });
  it('格式不符回 NaN', () => {
    expect(parseSessionStart('notes.jsonl')).toBeNaN();
  });
});

describe('getPiHeartbeat', () => {
  it('session 目錄不存在回 null', () => {
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', join(tmpdir(), 'no-such-dir-xyz'));
    expect(getPiHeartbeat(new Date().toISOString())).toBeNull();
  });

  it('只認檔名時間相近的，不誤報舊 job 的 session', () => {
    const root = makeRoot();
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', root);
    mkdirSync(join(root, 'slug-a'), { recursive: true });
    // 舊 job 的 session：檔名時間差 1 小時，但 mtime 最新（孤兒進程仍在寫）
    writeFileSync(join(root, 'slug-a', '2026-09-16T22-59-12-000Z_old.jsonl'), 'x'.repeat(2000));
    // 本 job 的 session：檔名時間相符
    const start = new Date('2026-09-17T00:03:52.000Z');
    mkdirSync(join(root, 'slug-b'), { recursive: true });
    writeFileSync(join(root, 'slug-b', '2026-09-17T00-03-53-000Z_new.jsonl'), 'y'.repeat(100));

    const hb = getPiHeartbeat(start.toISOString());
    expect(hb).not.toBeNull();
    expect(hb!.file).toContain('_new.jsonl');
    expect(hb!.size).toBe(100);
  });

  it('無效時間回 null', () => {
    expect(getPiHeartbeat('not-a-date')).toBeNull();
  });
});
