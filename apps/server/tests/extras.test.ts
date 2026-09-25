import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectExtras, EXTRAS_TIMEOUT_MS } from '../src/extras.js';

describe('collectExtras', () => {
  it('依副檔名與 tsconfig 判斷 TypeScript，並加總大小', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extras-'));
    try {
      writeFileSync(join(dir, 'tsconfig.json'), '{}');
      writeFileSync(join(dir, 'a.ts'), 'x'.repeat(100));
      writeFileSync(join(dir, 'b.ts'), 'y'.repeat(50));
      const r = collectExtras(dir, new Set(['node_modules', '.git']));
      expect(r.language).toBe('TypeScript');
      expect(r.sizeBytes).toBeGreaterThan(150);
      expect(r.truncated).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('略過 skip 目錄不計入大小', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extras-skip-'));
    try {
      writeFileSync(join(dir, 'app.py'), 'print(1)\n');
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(join(dir, 'node_modules', 'huge.js'), 'z'.repeat(10_000));
      const r = collectExtras(dir, new Set(['node_modules']));
      expect(r.language).toBe('Python');
      expect(r.sizeBytes).toBeLessThan(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('逾時標記 truncated 且不拋錯', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extras-to-'));
    try {
      writeFileSync(join(dir, 'a.go'), 'package main\n');
      let t = 0;
      const r = collectExtras(dir, new Set(), 1, () => (t += 10_000));
      expect(r.truncated).toBe(true);
      expect(EXTRAS_TIMEOUT_MS).toBe(2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
