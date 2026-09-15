import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Server } from 'ws';
import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  repoId: string;
  prompt: string;
  status: JobStatus;
  logPath: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

const JOB_TIMEOUT_MS = 600_000; // 600 seconds default
const KILL_GRACE_MS = 10_000; // SIGTERM 後等 10 秒再 SIGKILL（雙平台）
const jobMap = new Map<string, JobRecord>();
const childMap = new Map<string, ChildProcess>();

// exported for testing
export { jobMap, childMap, JOB_TIMEOUT_MS, KILL_GRACE_MS };

let wsInstance: Server | null = null;
let dbInstance: DatabaseSync | null = null;

export function initOptimizer(io: Server, db: DatabaseSync): void {
  wsInstance = io;
  dbInstance = db;
  jobMap.clear();
  for (const child of childMap.values()) {
    try { child.kill('SIGKILL'); } catch { /* 已退出則忽略 */ }
  }
  childMap.clear();
}

// 跨平台 kill：Windows 上 SIGTERM/SIGKILL 皆為強制終止（Node 模擬），
// macOS/Linux 上先 SIGTERM 給 graceful 機會，超時再 SIGKILL。
function terminate(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch { return; }
  setTimeout(() => {
    try {
      if (child.exitCode === null) child.kill('SIGKILL');
    } catch { /* 已退出則忽略 */ }
  }, KILL_GRACE_MS).unref?.();
}

// Core job start function - extracted for testing
export function startJob(job: JobRecord, db: DatabaseSync): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const piPath = process.env.PI_PATH || 'pi';
    const prompt = job.prompt || '';
    // job.repoId 實為 repo 絕對路徑（呼叫方約定）；resolve 保證雙平台絕對路徑
    const repoPath = path.resolve(job.repoId);

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    // 絕對路徑：避免 Windows 服務 / macOS launchd 下 cwd 不同導致相對路徑漂移
    job.logPath = path.resolve('data', 'jobs', `${job.id}.log`);
    try {
      fs.mkdirSync(path.dirname(job.logPath), { recursive: true });
      fs.writeFileSync(job.logPath, '');
    } catch (e) {
      job.status = 'failed';
      job.exitCode = -1;
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      done();
      return;
    }

    const args = ['build', prompt, '--repo', repoPath];
    let child: ChildProcess;
    try {
      child = spawn(piPath, args, {
        cwd: repoPath,
        env: { ...process.env, PI_JOB_ID: job.id },
        // Windows：pi 常為 pi.cmd/.bat/.ps1，需 shell 才能解析；
        // macOS/Linux：shell:false 避免多一層 shell 與引號問題。
        // args 陣列傳參，中文/空白路徑雙平台安全。
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch (e) {
      job.status = 'failed';
      job.exitCode = -1;
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      done();
      return;
    }
    childMap.set(job.id, child);

    let outRest = '';
    let errRest = '';

    child.stdout?.on('data', (chunk) => {
      // \r?\n：相容 Windows CRLF 與 Unix LF
      const lines = (outRest + chunk.toString()).split(/\r?\n/);
      outRest = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          wsInstance?.emit('job:log', { jobId: job.id, line });
        }
      }
    });

    child.stderr?.on('data', (chunk) => {
      const lines = (errRest + chunk.toString()).split(/\r?\n/);
      errRest = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          wsInstance?.emit('job:log', { jobId: job.id, line: line.substring(0, 200) });
        }
      }
    });

    child.on('exit', (code) => {
      clearTimeout((job as any).timeoutId);
      childMap.delete(job.id);
      job.exitCode = code;
      job.status = code === 0 ? 'done' : 'failed';
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      done();
    });

    child.on('error', (err) => {
      clearTimeout((job as any).timeoutId);
      childMap.delete(job.id);
      const e = err as NodeJS.ErrnoException;
      // ENOENT：pi 不存在（不在 PATH / 路徑錯誤），雙平台皆經此分支；
      // 不再用 fs.accessSync 預檢（它不查 PATH，會誤判）。
      job.status = 'failed';
      job.exitCode = -1;
      job.finishedAt = new Date().toISOString();
      try {
        fs.appendFileSync(job.logPath!, `spawn failed [${e.code ?? 'UNKNOWN'}]: check pi path / PI_PATH\n`);
      } catch { /* log 寫失敗不影響狀態 */ }
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      done();
    });

    // Timeout watchdog：先 SIGTERM，10 秒不死才 SIGKILL
    (job as any).timeoutId = setTimeout(() => {
      const c = childMap.get(job.id);
      if (c) terminate(c);
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      done();
    }, JOB_TIMEOUT_MS);
  });
}

// Public API for creating a job
export function createJob(repoId: string, prompt: string): JobRecord {
  const jobId = randomUUID();
  const job: JobRecord = {
    id: jobId,
    repoId,
    prompt,
    status: 'queued' as JobStatus,
    logPath: '',
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobMap.set(jobId, job);
  return job;
}

// Cancel a job：先殺子進程（SIGTERM→10s→SIGKILL，雙平台），再標 cancelled 並移除
export function cancelJob(jobId: string): void {
  const job = jobMap.get(jobId);
  if (!job) return;
  const child = childMap.get(jobId);
  if (child) {
    terminate(child);
    childMap.delete(jobId);
  }
  clearTimeout((job as any).timeoutId);
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
  jobMap.delete(jobId);
}

// Get job status
export function getJobStatus(jobId: string): JobRecord | undefined {
  return jobMap.get(jobId);
}