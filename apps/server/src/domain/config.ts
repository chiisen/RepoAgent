/**
 * Domain — 設定型別與預設值；不含任何 I/O。
 */
export type PromptTemplate = { id: string; name: string; body: string };

export type ConfigStore = {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  promptTemplates: PromptTemplate[];
  activePromptId: string;
  timeout: number;
  piConcurrency: number;
  scanRecursive: boolean;
  scanDepth: number;
  skipDirs: string[];
  extrasEnabled: boolean;
};

export const CONFIG_DEFAULTS: ConfigStore = {
  rootDir: process.platform === 'win32' ? 'D:\\github' : '/home/user/github',
  piPath: 'pi',
  promptTemplate:
    '只回 OK，並列出此目錄根層前 10 個檔名。不要修改任何檔案。直接回答，不要把這段文字當待查證問題。',
  promptTemplates: [
    {
      id: 'default',
      name: '預設',
      body: '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}',
    },
    {
      id: 'test',
      name: '測試',
      body: '只回 OK，並列出此目錄根層前 10 個檔名。不要修改任何檔案。直接回答，不要把這段文字當待查證問題。',
    },
  ],
  activePromptId: 'test',
  timeout: 1800,
  piConcurrency: 2,
  scanRecursive: false,
  scanDepth: 3,
  skipDirs: ['node_modules', '.superpowers'],
  extrasEnabled: false,
};

/** 預設 prompt 樣板（優化用，{repoPath}/{branch} 為變數）。 */
export const DEFAULT_OPTIMIZE_PROMPT =
  '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}';

/** 確保 promptTemplates 至少有 1 筆且 activePromptId 指向存在的樣板。 */
export function ensurePromptTemplates(c: {
  promptTemplate: string;
  promptTemplates?: PromptTemplate[];
  activePromptId?: string;
}): void {
  if (!Array.isArray(c.promptTemplates) || c.promptTemplates.length === 0) {
    c.promptTemplates = [
      { id: 'default', name: '預設', body: c.promptTemplate || CONFIG_DEFAULTS.promptTemplate },
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

export function parseSkipDirs(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('skipDirs must be an array');
  if (raw.length > 40) throw new Error('skipDirs at most 40');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = String(item ?? '')
      .trim()
      .replace(/^[/\\]+|[/\\]+$/g, '');
    if (!name) continue;
    if (/[/\\]/.test(name) || name === '.' || name === '..') {
      throw new Error('skipDirs item must be a directory name, not a path');
    }
    if (name.length > 64) throw new Error('skipDirs item too long');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function fillPrompt(body: string, repoPath: string, branch: string): string {
  return body.replaceAll('{repoPath}', repoPath).replaceAll('{branch}', branch);
}
