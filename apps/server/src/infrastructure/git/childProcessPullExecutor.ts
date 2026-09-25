/**
 * ChildProcessPullExecutor — IPullExecutor 實作（封裝 execFile）。
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { IFileLogStore, IPullExecutor } from '../../domain/ports.js';
import type { PullResult } from '../../domain/types.js';

const execFileAsync = promisify(execFile);
export const PULL_TIMEOUT_MS = 25_000;

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  GIT_OPTIONAL_LOCKS: '0',
};

function isTimeout(e: unknown): boolean {
  const err = e as { killed?: boolean; code?: string | number; signal?: string };
  return err.killed === true || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM';
}

export class ChildProcessPullExecutor implements IPullExecutor {
  constructor(
    private readonly logStore: IFileLogStore,
    private readonly jobsDir: string = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      'data',
      'jobs',
    ),
  ) {}

  async pullFastForward(repoPath: string, jobId: string): Promise<PullResult> {
    const header = `pull --ff-only\npath ${repoPath}\n`;

    let porcelain = '';
    try {
      const r = await execFileAsync('git', ['status', '--porcelain=v1'], {
        cwd: repoPath,
        timeout: 12_000,
        env: gitEnv,
        windowsHide: true,
        maxBuffer: 2_000_000,
        encoding: 'utf8',
      });
      porcelain = r.stdout;
    } catch (e) {
      const message = isTimeout(e) ? 'git status 逾時' : String(e).slice(0, 500);
      return {
        ok: false,
        code: isTimeout(e) ? 'timeout' : 'git',
        message,
        output: message,
        logPath: this.writeLog(`pull-${jobId}.log`, `${header + message}\n`),
      };
    }
    if (porcelain.split(/\r?\n/).some((l) => l.length > 0)) {
      const message = '工作區有未提交變更，已跳過 pull';
      return {
        ok: false,
        code: 'dirty',
        message,
        output: porcelain,
        logPath: this.writeLog(`pull-${jobId}.log`, `${header + message}\n${porcelain}`),
      };
    }

    try {
      await execFileAsync('git', ['rev-parse', '--abbrev-ref', '@{u}'], {
        cwd: repoPath,
        timeout: 8_000,
        env: gitEnv,
        windowsHide: true,
        maxBuffer: 2_000_000,
        encoding: 'utf8',
      });
    } catch (e) {
      if (isTimeout(e)) {
        const message = '檢查 upstream 逾時';
        return {
          ok: false,
          code: 'timeout',
          message,
          output: message,
          logPath: this.writeLog(`pull-${jobId}.log`, `${header + message}\n`),
        };
      }
      const message = '沒有 upstream（未設定 origin 追蹤分支）';
      return {
        ok: false,
        code: 'no_upstream',
        message,
        output: '',
        logPath: this.writeLog(`pull-${jobId}.log`, `${header + message}\n`),
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        'git',
        ['-c', 'credential.interactive=never', 'pull', '--ff-only'],
        {
          cwd: repoPath,
          timeout: PULL_TIMEOUT_MS,
          env: gitEnv,
          windowsHide: true,
          maxBuffer: 2_000_000,
          encoding: 'utf8',
        },
      );
      const output = `${stdout}${stderr}`;
      const message = output.trim() || 'Already up to date.';
      return {
        ok: true,
        code: 'ok',
        message,
        output,
        logPath: this.writeLog(`pull-${jobId}.log`, header + output),
      };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      const output = `${err.stdout ?? ''}${err.stderr ?? ''}${isTimeout(e) ? '' : String(e)}`.slice(0, 2000);
      const message = isTimeout(e)
        ? `git pull 逾時（${PULL_TIMEOUT_MS / 1000} 秒）。遠端可能在等憑證，請在終端機先 pull 一次把憑證存好。`
        : (err.stderr || String(e)).slice(0, 500);
      return {
        ok: false,
        code: isTimeout(e) ? 'timeout' : 'git',
        message,
        output,
        logPath: this.writeLog(`pull-${jobId}.log`, `${header + message}\n${output}`),
      };
    }
  }

  private writeLog(name: string, body: string): string {
    mkdirSync(this.jobsDir, { recursive: true });
    const logPath = join(this.jobsDir, name);
    writeFileSync(logPath, body.endsWith('\n') ? body : `${body}\n`);
    this.logStore.prune(this.jobsDir, 50);
    return logPath;
  }
}
