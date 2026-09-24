import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configStore,
  defaults,
  ensurePromptTemplates,
  parsePromptTemplates,
  resolveOptimizePrompt,
} from '../src/config.js';

const saved = {
  promptTemplate: configStore.promptTemplate,
  promptTemplates: configStore.promptTemplates,
  activePromptId: configStore.activePromptId,
};

afterEach(() => {
  configStore.promptTemplate = saved.promptTemplate;
  configStore.promptTemplates = saved.promptTemplates;
  configStore.activePromptId = saved.activePromptId;
});

describe('ensurePromptTemplates（issue #11）', () => {
  it('無樣板時用 promptTemplate 種一筆預設', () => {
    const c = {
      ...defaults,
      promptTemplates: undefined,
      activePromptId: undefined,
      promptTemplate: 'hello {repoPath}',
    } as typeof defaults & { promptTemplates?: unknown; activePromptId?: string };
    ensurePromptTemplates(c);
    expect(c.promptTemplates).toHaveLength(1);
    expect(c.promptTemplates[0].body).toBe('hello {repoPath}');
    expect(c.activePromptId).toBe(c.promptTemplates[0].id);
  });
});

describe('parsePromptTemplates', () => {
  it('拒絕空陣列與過長', () => {
    expect(() => parsePromptTemplates([])).toThrow(/at least 1/);
    expect(() =>
      parsePromptTemplates([
        { id: 'a', name: 'n', body: 'x' },
        ...Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, name: 'n', body: 'b' })),
      ]),
    ).toThrow(/at most 20/);
  });
  it('接受合法列表', () => {
    const t = parsePromptTemplates([
      { id: 'a', name: '品質', body: 'qa {repoPath}' },
      { id: 'b', name: '註解', body: 'docs {branch}' },
    ]);
    expect(t).toHaveLength(2);
    expect(t[0].id).toBe('a');
  });
});

describe('resolveOptimizePrompt', () => {
  beforeEach(() => {
    configStore.promptTemplates = [
      { id: 'qa', name: '品質', body: 'qa repo={repoPath} branch={branch}' },
      { id: 'docs', name: '文件', body: 'docs {branch}' },
    ];
    configStore.activePromptId = 'qa';
    configStore.promptTemplate = configStore.promptTemplates[0].body;
  });

  it('自訂 prompt 優先', () => {
    const r = resolveOptimizePrompt('/r', 'main', { prompt: 'custom {branch}' });
    expect(r.prompt).toBe('custom main');
    expect(r.promptId).toBe('custom');
  });
  it('promptId 選樣板', () => {
    const r = resolveOptimizePrompt('/r', 'dev', { promptId: 'docs' });
    expect(r.prompt).toBe('docs dev');
    expect(r.promptId).toBe('docs');
  });
  it('未指定用 active', () => {
    const r = resolveOptimizePrompt('/abs/path', 'main', {});
    expect(r.prompt).toContain('/abs/path');
    expect(r.promptId).toBe('qa');
  });
  it('未知 promptId 丟錯', () => {
    expect(() => resolveOptimizePrompt('/r', 'main', { promptId: 'nope' })).toThrow(/unknown promptId/);
  });
});
