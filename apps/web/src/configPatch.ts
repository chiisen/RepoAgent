import type { Config, PromptTemplate } from './types';

export type SettingsDraft = {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  templates: PromptTemplate[];
  activePromptId: string;
  timeout: string;
  piConcurrency: string;
  scanRecursive: boolean;
  scanDepth: string;
  skipDirsText: string;
  extrasEnabled: boolean;
};

export function draftFromConfig(c: Config): SettingsDraft {
  const templates = c.promptTemplates?.length
    ? c.promptTemplates
    : [{ id: 'default', name: '預設', body: c.promptTemplate || '' }];
  return {
    rootDir: c.rootDir || '',
    piPath: c.piPath || 'pi',
    promptTemplate: c.promptTemplate || '',
    templates,
    activePromptId: c.activePromptId || templates[0].id,
    timeout: String(c.timeout ?? 600),
    piConcurrency: String(c.piConcurrency ?? 2),
    scanRecursive: c.scanRecursive === true,
    scanDepth: String(c.scanDepth ?? 3),
    skipDirsText: (c.skipDirs ?? ['node_modules', '.superpowers']).join('\n'),
    extrasEnabled: c.extrasEnabled === true,
  };
}

function sameTemplates(a: PromptTemplate[], b: PromptTemplate[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 只回有改過的欄位，沒動過的 rootDir 不會送出。 */
export function settingsPatch(baseline: SettingsDraft, draft: SettingsDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.rootDir !== baseline.rootDir) patch.rootDir = draft.rootDir;
  if (draft.piPath !== baseline.piPath) patch.piPath = draft.piPath;
  if (!sameTemplates(draft.templates, baseline.templates)) patch.promptTemplates = draft.templates;
  if (draft.activePromptId !== baseline.activePromptId) patch.activePromptId = draft.activePromptId;
  if (draft.promptTemplate !== baseline.promptTemplate && patch.promptTemplates === undefined) {
    patch.promptTemplate = draft.promptTemplate;
  }
  if (draft.timeout !== baseline.timeout) patch.timeout = Number(draft.timeout);
  if (draft.piConcurrency !== baseline.piConcurrency) patch.piConcurrency = Number(draft.piConcurrency);
  if (draft.scanRecursive !== baseline.scanRecursive) patch.scanRecursive = draft.scanRecursive;
  if (draft.scanDepth !== baseline.scanDepth) patch.scanDepth = Number(draft.scanDepth);
  if (draft.skipDirsText !== baseline.skipDirsText) {
    patch.skipDirs = draft.skipDirsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (draft.extrasEnabled !== baseline.extrasEnabled) patch.extrasEnabled = draft.extrasEnabled;
  return patch;
}
