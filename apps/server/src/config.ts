import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type PromptTemplate = { id: string; name: string; body: string };

export interface ConfigStore {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  promptTemplates: PromptTemplate[];
  activePromptId: string;
  timeout: number;
  piConcurrency: number;
  scanRecursive: boolean;
  scanDepth: number;
}

export const defaults = {
  rootDir: process.platform === 'win32' ? 'D:\\github' : '/home/user/github',
  piPath: 'pi',
  promptTemplate:
    '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}',
  promptTemplates: [
    {
      id: 'default',
      name: '預設',
      body: '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}',
    },
  ],
  activePromptId: 'default',
  timeout: 1800,
  piConcurrency: 2,
  scanRecursive: false,
  scanDepth: 3,
};

let config: ConfigStore = { ...defaults };

function configPath(): string {
  return path.join(__dirname, '..', '..', '..', 'data', 'config.json');
}

/** 去掉尾端多餘分隔符；磁碟根（如 D:\）保留。 */
export function ensurePromptTemplates(c: {
  promptTemplate: string;
  promptTemplates?: PromptTemplate[];
  activePromptId?: string;
}): void {
  if (!Array.isArray(c.promptTemplates) || c.promptTemplates.length === 0) {
    c.promptTemplates = [
      { id: 'default', name: '預設', body: c.promptTemplate || defaults.promptTemplate },
    ];
  }
  if (!c.activePromptId || !c.promptTemplates.some((t) => t.id === c.activePromptId)) {
    c.activePromptId = c.promptTemplates[0].id;
  }
  const active = c.promptTemplates.find((t) => t.id === c.activePromptId);
  if (active) c.promptTemplate = active.body;
}

export function parsePromptTemplates(raw: unknown): PromptTemplate[] {
  if (!Array.isArray(raw) || raw.length < 1) throw new Error('promptTemplates must have at least 1 item');
  if (raw.length > 20) throw new Error('promptTemplates at most 20');
  const ids = new Set<string>();
  const out: PromptTemplate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error('invalid prompt template');
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || '').trim();
    const name = String(rec.name || '').trim();
    const body = String(rec.body || '');
    if (!id || id.length > 64) throw new Error('invalid prompt id');
    if (!name || name.length > 40) throw new Error('invalid prompt name');
    if (!body.trim() || body.length > 8000) throw new Error('invalid prompt body');
    if (ids.has(id)) throw new Error('duplicate prompt id');
    ids.add(id);
    out.push({ id, name, body });
  }
  return out;
}

export function fillPrompt(body: string, repoPath: string, branch: string): string {
  return body.replaceAll('{repoPath}', repoPath).replaceAll('{branch}', branch);
}

export function resolveOptimizePrompt(
  repoPath: string,
  branch: string,
  body: { prompt?: unknown; promptId?: unknown },
): { prompt: string; promptId: string } {
  ensurePromptTemplates(configStore);
  const custom = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (custom) return { prompt: fillPrompt(custom, repoPath, branch), promptId: 'custom' };
  const id = typeof body.promptId === 'string' && body.promptId.trim() ? body.promptId.trim() : configStore.activePromptId;
  const t = configStore.promptTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`unknown promptId: ${id}`);
  return { prompt: fillPrompt(t.body, repoPath, branch), promptId: t.id };
}

export function normalizeRootDir(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const resolved = path.resolve(trimmed);
  const { root } = path.parse(resolved);
  if (resolved === root) return resolved;
  return resolved.replace(/[\\/]+$/, '');
}

export function loadConfig(): ConfigStore {
  const p = configPath();
  try {
    if (fs.existsSync(p)) {
      const stored = JSON.parse(fs.readFileSync(p, 'utf-8'));
      config = { ...defaults, ...stored };
      ensurePromptTemplates(config);
      try {
        path.resolve(config.rootDir);
        if (!fs.existsSync(config.rootDir)) {
          throw new Error(`rootDir not found: ${config.rootDir}`);
        }
      } catch {
        config = { ...defaults };
        throw new Error(`rootDir not found: ${config.rootDir}`);
      }
    }
  } catch (e) {
    console.error('Failed to load config, using defaults:', e);
    config = { ...defaults };
  }
  return config;
}

export function saveConfig(): void {
  const p = configPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

export const configStore: ConfigStore = loadConfig();
ensurePromptTemplates(configStore);
