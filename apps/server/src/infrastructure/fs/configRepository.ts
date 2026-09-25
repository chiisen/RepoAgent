/**
 * FileConfigRepository — IConfigRepository 實作（讀寫 data/config.json）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigStore } from '../../domain/config.js';
import {
  CONFIG_DEFAULTS,
  ensurePromptTemplates,
  parsePromptTemplates,
  parseSkipDirs,
} from '../../domain/config.js';
import { RootDirNotFoundError } from '../../domain/errors.js';
import type { IConfigRepository } from '../../domain/ports.js';
import type { PromptTemplate } from '../../domain/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FileConfigRepository implements IConfigRepository {
  private config: ConfigStore;

  constructor(private readonly filePath: string = FileConfigRepository.defaultPath()) {
    this.config = { ...CONFIG_DEFAULTS };
    this.loadFromDisk();
  }

  static defaultPath(): string {
    return path.join(__dirname, '..', '..', '..', 'data', 'config.json');
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const stored = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<ConfigStore>;
        this.config = { ...CONFIG_DEFAULTS, ...stored };
        ensurePromptTemplates(this.config);
        try {
          path.resolve(this.config.rootDir);
          if (!fs.existsSync(this.config.rootDir)) {
            throw new RootDirNotFoundError(this.config.rootDir);
          }
        } catch (e) {
          this.config = { ...CONFIG_DEFAULTS };
          throw e instanceof Error ? e : new RootDirNotFoundError(this.config.rootDir);
        }
      }
    } catch (e) {
      if (!(e instanceof RootDirNotFoundError)) {
        console.error('Failed to load config, using defaults:', e);
      }
      this.config = { ...CONFIG_DEFAULTS };
    }
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  }

  snapshot(): ConfigStore {
    return { ...this.config };
  }

  patch(input: Partial<ConfigStore> & Record<string, unknown>): void {
    if (input.rootDir !== undefined) this.config.rootDir = input.rootDir as string;
    if (input.piPath !== undefined) this.config.piPath = input.piPath as string;
    if (input.promptTemplates !== undefined)
      this.config.promptTemplates = input.promptTemplates as PromptTemplate[];
    if (input.activePromptId !== undefined) this.config.activePromptId = input.activePromptId as string;
    if (input.promptTemplate !== undefined) this.config.promptTemplate = input.promptTemplate as string;
    if (input.timeout !== undefined) this.config.timeout = input.timeout as number;
    if (input.piConcurrency !== undefined) this.config.piConcurrency = input.piConcurrency as number;
    if (input.scanRecursive !== undefined) this.config.scanRecursive = input.scanRecursive as boolean;
    if (input.scanDepth !== undefined) this.config.scanDepth = input.scanDepth as number;
    if (input.skipDirs !== undefined) this.config.skipDirs = input.skipDirs as string[];
    if (input.extrasEnabled !== undefined) this.config.extrasEnabled = input.extrasEnabled as boolean;
  }

  setPromptTemplates(raw: unknown): PromptTemplate[] {
    return parsePromptTemplates(raw);
  }

  setSkipDirs(raw: unknown): string[] {
    return parseSkipDirs(raw);
  }

  setRootDir(raw: string): string {
    const normalized = this.normalizeRootDir(raw);
    if (!normalized || !fs.existsSync(normalized)) {
      throw new RootDirNotFoundError(raw);
    }
    this.config.rootDir = normalized;
    return normalized;
  }

  setPiPath(raw: string): void {
    if (raw !== 'pi' && !path.isAbsolute(raw)) {
      throw new Error(`piPath must be 'pi' or an absolute path, got: ${raw}`);
    }
    this.config.piPath = raw;
  }

  setTimeout(raw: unknown): void {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 60 || n > 7200) {
      throw new Error(`timeout must be an integer 60..7200 (seconds), got: ${raw}`);
    }
    this.config.timeout = n;
  }

  setPiConcurrency(raw: unknown): void {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      throw new Error(`piConcurrency must be an integer 1..4, got: ${raw}`);
    }
    this.config.piConcurrency = n;
  }

  setScanRecursive(raw: unknown): void {
    this.config.scanRecursive = Boolean(raw);
  }

  setScanDepth(raw: unknown): void {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error(`scanDepth must be an integer 1..5, got: ${raw}`);
    }
    this.config.scanDepth = n;
  }

  setActivePromptId(raw: unknown): void {
    this.config.activePromptId = String(raw);
  }

  setPromptTemplateBody(raw: unknown): void {
    ensurePromptTemplates(this.config);
    const active = this.config.promptTemplates.find((t) => t.id === this.config.activePromptId);
    if (active) active.body = String(raw);
    this.config.promptTemplate = String(raw);
  }

  setExtrasEnabled(raw: unknown): void {
    this.config.extrasEnabled = Boolean(raw);
  }

  private normalizeRootDir(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    const resolved = path.resolve(trimmed);
    const { root } = path.parse(resolved);
    if (resolved === root) return resolved;
    return resolved.replace(/[\\/]+$/, '');
  }
}
