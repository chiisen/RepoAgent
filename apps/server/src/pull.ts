import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pruneJobLogs } from './optimizer.js';

export const PULL_TIMEOUT_MS = 25_000;
const execFileAsync = promisify(execFile);

export function lastOutputLine(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return (lines[lines.length - 1] || text.trim() || '').slice(0, 200);
}

export type PullResult = {
  ok: boolean;
  code: 'ok' | 'dirty' | 'no_upstream' | 'git' | 'timeout';
  message: string;
  output: string;
  logPath: string;
};

const gitEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  GIT_OPTIONAL_LOCKS: '0',
};

function jobsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'jobs');
}

function writeLog(name: string, body: string): string {
  const dir = jobsDir();
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, name);
  writeFileSync(logPath, body.endsWith('\n') ? body : body + '\n');
  pruneJobLogs(dir); // 與 optimize job 共用同一輪轉上限（規格 §5）
  return logPath;
}

async function gitExec(repoPath: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd: repoPath,
    timeout: timeoutMs,
    env: gitEnv,
    windowsHide: true,
    maxBuffer: 2_000_000,
    encoding: 'utf8',
  });
}

function isTimeout(e: unknown): boolean {
  const err = e as { killed?: boolean; code?: string | number; signal?: string };
  return err.killed === true || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM';
}

export async function pullFastForward(repoPath: string, jobId: string): Promise<PullResult> {
  const header = `pull --ff-only\npath ${repoPath}\n`;

  let porcelain = '';
  try {
    porcelain = (await gitExec(repoPath, ['status', '--porcelain=v1'], 12_000)).stdout;
  } catch (e) {
    const message = isTimeout(e) ? 'git status 逾時' : String(e).slice(0, 500);
    return {
      ok: false,
      code: isTimeout(e) ? 'timeout' : 'git',
      message,
      output: message,
      logPath: writeLog(`pull-${jobId}.log`, header + message + '\n'),
    };
  }
  if (porcelain.split(/\r?\n/).some((l) => l.length > 0)) {
    const message = '工作區有未提交變更，已跳過 pull';
    return {
      ok: false,
      code: 'dirty',
      message,
      output: porcelain,
      logPath: writeLog(`pull-${jobId}.log`, header + message + '\n' + porcelain),
    };
  }

  try {
    await gitExec(repoPath, ['rev-parse', '--abbrev-ref', '@{u}'], 8_000);
  } catch (e) {
    if (isTimeout(e)) {
      const message = '檢查 upstream 逾時';
      return {
        ok: false,
        code: 'timeout',
        message,
        output: message,
        logPath: writeLog(`pull-${jobId}.log`, header + message + '\n'),
      };
    }
    const message = '沒有 upstream（未設定 origin 追蹤分支）';
    return {
      ok: false,
      code: 'no_upstream',
      message,
      output: '',
      logPath: writeLog(`pull-${jobId}.log`, header + message + '\n'),
    };
  }

  try {
    const { stdout, stderr } = await gitExec(repoPath, ['-c', 'credential.interactive=never', 'pull', '--ff-only'], PULL_TIMEOUT_MS);
    const output = `${stdout}${stderr}`;
    const message = output.trim() || 'Already up to date.';
    return {
      ok: true,
      code: 'ok',
      message,
      output,
      logPath: writeLog(`pull-${jobId}.log`, header + output),
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
      logPath: writeLog(`pull-${jobId}.log`, header + message + '\n' + output),
    };
  }
}
