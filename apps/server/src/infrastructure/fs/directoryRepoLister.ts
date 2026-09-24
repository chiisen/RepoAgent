/**
 * DirectoryRepoLister — IRepoLister 實作（遞迴列出含 .git 的子目錄）。
 */

import type { Dirent } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { IRepoLister } from '../../domain/ports.js';

const MAX_SCAN_DEPTH = 5;
const _ALWAYS_SKIP = new Set(['.git']);

export class DirectoryRepoLister implements IRepoLister {
  constructor(private readonly skipNames: () => Set<string>) {}

  list(root: string, recursive: boolean, maxDepth: number): { path: string; name: string }[] {
    const depthCap = recursive ? Math.min(Math.max(1, maxDepth), MAX_SCAN_DEPTH) : 1;
    const out: { path: string; name: string }[] = [];
    const walk = (dir: string, depth: number, rel: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
      } catch {
        return;
      }
      const skip = this.skipNames();
      for (const entry of entries) {
        const entryName = entry.name as string;
        if (!entry.isDirectory() || skip.has(entryName.toLowerCase())) continue;
        const p = join(dir, entryName);
        const name = rel ? `${rel}/${entryName}` : entryName;
        if (existsSync(join(p, '.git'))) {
          out.push({ path: p, name });
          continue;
        }
        if (depth < depthCap) walk(p, depth + 1, name);
      }
    };
    walk(root, 1, '');
    return out;
  }
}
