export interface ConfigStore {
  rootDir: string;
  piPath: string;
  promptTemplate: string;
  timeout: number;
}

export const defaults = {
  rootDir: process.platform === 'win32' ? 'D:\\github' : '/home/user/github',
  piPath: 'pi',
  promptTemplate:
    '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}',
  timeout: 600,
};

let config: ConfigStore = { ...defaults };

export function loadConfig(): ConfigStore {
  const fs = require('node:fs');
  const path = require('node:path');
  const configPath = path.join(__dirname, '..', '..', '..', 'data', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const stored = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = { ...defaults, ...stored };
      // Validate rootDir exists
      try {
        require('node:path').resolve(config.rootDir);
        if (!require('node:fs').existsSync(config.rootDir)) {
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
  const fs = require('node:fs');
  const path = require('node:path');
  const configPath = path.join(__dirname, '..', '..', '..', 'data', 'config.json');
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

export const configStore: ConfigStore = loadConfig();