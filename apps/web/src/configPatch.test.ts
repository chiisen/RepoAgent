import { describe, expect, it } from 'vitest';
import { draftFromConfig, settingsPatch, type SettingsDraft } from './configPatch';
import type { Config } from './types';

const loaded: Config = {
  rootDir: '/home/user/github',
  piPath: 'pi',
  promptTemplate: 'do {repoPath}',
  promptTemplates: [{ id: 'default', name: '預設', body: 'do {repoPath}' }],
  activePromptId: 'default',
  timeout: 600,
  piConcurrency: 2,
  scanRecursive: false,
  scanDepth: 3,
  skipDirs: ['node_modules', '.superpowers'],
  extrasEnabled: false,
};

function draft(over: Partial<SettingsDraft> = {}): SettingsDraft {
  return { ...draftFromConfig(loaded), ...over };
}

describe('settingsPatch', () => {
  it('未改 rootDir 時不送出，其他欄位仍可存', () => {
    const patch = settingsPatch(draft(), draft({ timeout: '120', piPath: 'C:\\pi\\pi.exe' }));
    expect(patch).toEqual({ timeout: 120, piPath: 'C:\\pi\\pi.exe' });
    expect(patch).not.toHaveProperty('rootDir');
  });

  it('有改 rootDir 才送', () => {
    const patch = settingsPatch(draft(), draft({ rootDir: 'D:\\github' }));
    expect(patch).toEqual({ rootDir: 'D:\\github' });
  });
});
