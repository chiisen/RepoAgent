import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function configPath(): string {
  return path.join(__dirname, '..', '..', '..', 'data', 'config.json');
}

export function loadConfig(): ConfigStore {
  const p = configPath();
  try {
    if (fs.existsSync(p)) {
      const stored = JSON.parse(fs.readFileSync(p, 'utf-8'));
      config = { ...defaults, ...stored };
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
