import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const names = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

describe('agent docs sync', () => {
  it('AGENTS.md CLAUDE.md GEMINI.md 內容完全相同', () => {
    const bodies = names.map((n) => readFileSync(join(repoRoot, n), 'utf8'));
    expect(bodies[0].length).toBeGreaterThan(100);
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
  });
});
