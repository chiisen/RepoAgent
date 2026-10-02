import { parse, resolve } from 'node:path';

/** 去掉尾端分隔，磁碟根目錄維持原樣。 */
export function normalizeRootDir(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const resolved = resolve(trimmed);
  const { root } = parse(resolved);
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, '');
}
