/**
 * FsExtrasCollector — IRepoExtrasCollector 實作（語言 / 大小 / 截斷偵測）。
 */

import type { Dirent } from 'node:fs';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import type { IRepoExtrasCollector } from '../../domain/ports.js';
import type { RepoExtras } from '../../domain/types.js';

export const EXTRAS_TIMEOUT_MS = 2_000;

const EXT_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.vue': 'Vue',
  '.swift': 'Swift',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.h': 'C/C++',
  '.hpp': 'C++',
};

const MANIFEST: { file: string; lang: string }[] = [
  { file: 'tsconfig.json', lang: 'TypeScript' },
  { file: 'go.mod', lang: 'Go' },
  { file: 'Cargo.toml', lang: 'Rust' },
  { file: 'pyproject.toml', lang: 'Python' },
  { file: 'requirements.txt', lang: 'Python' },
  { file: 'composer.json', lang: 'PHP' },
  { file: 'Gemfile', lang: 'Ruby' },
  { file: 'Package.swift', lang: 'Swift' },
];

export class FsExtrasCollector implements IRepoExtrasCollector {
  collect(repoPath: string, skipNames: Set<string>, timeoutMs: number): RepoExtras {
    return collectExtras(repoPath, skipNames, timeoutMs);
  }
}

export function collectExtras(
  repoPath: string,
  skipNames: Set<string>,
  timeoutMs = EXTRAS_TIMEOUT_MS,
  now = Date.now,
): RepoExtras {
  const deadline = now() + timeoutMs;
  const skip = new Set([...skipNames].map((s) => s.toLowerCase()));
  const scores = new Map<string, number>();
  let sizeBytes = 0;
  let truncated = false;

  const bump = (lang: string, n: number) => scores.set(lang, (scores.get(lang) || 0) + n);

  try {
    const top = readdirSync(repoPath, { withFileTypes: true }) as Dirent[];
    for (const e of top) {
      if (e.isFile()) {
        const name = e.name as string;
        if (name.endsWith('.csproj') || name.endsWith('.sln')) bump('C#', 50);
        if (name === 'package.json')
          bump(existsSync(join(repoPath, 'tsconfig.json')) ? 'TypeScript' : 'JavaScript', 40);
      }
    }
    for (const m of MANIFEST) {
      if (existsSync(join(repoPath, m.file))) bump(m.lang, 50);
    }
  } catch {
    /* 列根層失敗則只走 walk */
  }

  const queue: string[] = [repoPath];
  while (queue.length) {
    if (now() > deadline) {
      truncated = true;
      break;
    }
    const dir = queue.shift() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    } catch {
      continue;
    }
    for (const e of entries) {
      if (now() > deadline) {
        truncated = true;
        break;
      }
      const name = e.name as string;
      if (skip.has(name.toLowerCase())) continue;
      const p = join(dir, name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        queue.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        sizeBytes += statSync(p).size;
      } catch {
        continue;
      }
      const lang = EXT_LANG[extname(name).toLowerCase()];
      if (lang) bump(lang, 1);
    }
  }

  let language = '';
  let best = 0;
  for (const [lang, n] of scores) {
    if (n > best) {
      best = n;
      language = lang;
    }
  }

  return { language, sizeBytes, truncated };
}
