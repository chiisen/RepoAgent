/**
 * JobService — 對外提供 list / detail / cancel + 建立並啟動 job。
 *
 * 設計重點：spawn / log / heartbeat / timeout 都透過 port 注入，
 * 本類別不直接 import child_process / ws / fs。
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { JobNotFoundError } from '../domain/errors.js';
import { WS_EVENT } from '../domain/events.js';
import type {
  IConfigRepository,
  IEventBroadcaster,
  IFileLogStore,
  IGitInspector,
  IHeartbeatProbe,
  IJobRegistry,
  IProcessRunner,
  IRepoRepository,
} from '../domain/ports.js';
import type { JobRecord } from '../domain/types.js';

const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000;
const KILL_GRACE_MS = 10_000;
const HEARTBEAT_MS = 5_000;
const LOG_TAIL_LINES = 50;
const MAX_KEEP = 50;

export class JobService {
  constructor(
    private readonly repos: IRepoRepository,
    private readonly jobs: IJobRegistry,
    private readonly config: IConfigRepository,
    private readonly broadcaster: IEventBroadcaster,
    private readonly logStore: IFileLogStore,
    private readonly heartbeat: IHeartbeatProbe,
    private readonly runner: IProcessRunner,
    readonly _git: IGitInspector,
    private readonly repoRefresh: (repoPath: string, lastError?: string) => Promise<void>,
  ) {}

  /** 對外讀取目前 pi concurrency（給 /api/jobs 用）。 */
  piConcurrency(): number {
    const n = Number(this.config.snapshot().piConcurrency);
    if (!Number.isInteger(n) || n < 1 || n > 4) return 2;
    return n;
  }

  /** 對外讀取目前 job timeout（ms）。 */
  jobTimeoutMs(): number {
    const s = Number(this.config.snapshot().timeout);
    if (!Number.isFinite(s) || s < 60 || s > 7200) return DEFAULT_JOB_TIMEOUT_MS;
    return Math.floor(s) * 1000;
  }

  /** 對外讀取目前 job timeout（sec）。 */
  jobTimeoutSec(): number {
    return Math.round(this.jobTimeoutMs() / 1000);
  }

  listActive(): JobRecord[] {
    return this.jobs.listActive();
  }

  getJobDetail(id: string): {
    job: JobRecord;
    logTail: string[];
    heartbeat: ReturnType<IHeartbeatProbe['getHeartbeat']>;
    timeoutSec: number;
  } | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    let logTail: string[] = [];
    try {
      if (job.logPath && existsSync(job.logPath)) {
        const lines = readFileSync(job.logPath, 'utf8').split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        logTail = lines.slice(-LOG_TAIL_LINES);
      }
    } catch {
      /* log 讀失敗不影響狀態 */
    }
    return {
      job,
      logTail,
      heartbeat: this.heartbeat.getHeartbeat(job.startedAt),
      timeoutSec: this.jobTimeoutSec(),
    };
  }

  getJob(id: string): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(id);
    return job;
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(id);
    const child = this.jobs.getChild(id);
    if (child) {
      this.runner.killTree(child);
      this.jobs.removeChild(id);
    }
    this.jobs.clearTimeoutHandle(id);
    this.jobs.clearPulseHandle(id);
    this.jobs.setStatus(id, 'cancelled', { finishedAt: new Date().toISOString() });
    this.emitJobDone(this.jobs.get(id) as JobRecord);
    this.jobs.delete(id);
  }

  /** 啟動 job（spawn pi）；回呼 child.on('exit') 時自動重掃 + 標記 done。 */
  startJob(job: JobRecord): Promise<void> {
    return new Promise((resolveP) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolveP();
        }
      };
      const piPath = process.env.PI_PATH || 'pi';
      const prompt = job.prompt || '';
      const repoPath = resolve(job.repoId);
      const before = this.repos.readSnapshot(repoPath);

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.logPath = resolve('data', 'jobs', `${job.id}.log`);

      try {
        this.logStore.ensureLogFile(job.logPath);
        this.logStore.prune(resolve('data', 'jobs'), MAX_KEEP);
      } catch {
        job.status = 'failed';
        job.exitCode = -1;
        job.finishedAt = new Date().toISOString();
        this.emitJobDone(job);
        done();
        return;
      }

      const args = ['--offline', '--print', '--approve'];
      let child: ChildProcess;
      try {
        child = this.runner.spawn(piPath, args, {
          cwd: repoPath,
          shell: process.platform === 'win32',
          windowsHide: true,
          env: { ...process.env, PI_JOB_ID: job.id } as unknown as Record<string, string>,
        });
      } catch {
        job.status = 'failed';
        job.exitCode = -1;
        job.finishedAt = new Date().toISOString();
        this.emitJobDone(job);
        done();
        return;
      }
      this.jobs.setChild(job.id, child);

      try {
        this.logStore.writeJobLog(
          job.logPath,
          `$ spawn: ${piPath} ${args.map((a) => JSON.stringify(a)).join(' ')} (pid=${child.pid}, cwd=${repoPath}, prompt ${prompt.length} chars via stdin)`,
        );
      } catch {
        /* 忽略 */
      }
      try {
        child.stdin?.on('error', () => {});
        child.stdin?.write(prompt, 'utf8');
        child.stdin?.end();
      } catch {
        /* pi 已退出 */
      }

      let outRest = '';
      let errRest = '';
      const startedMs = Date.now();

      const appendLogLine = (line: string, notify = true): void => {
        this.logStore.writeJobLog(job.logPath, line);
        if (notify) this.broadcaster.broadcast({ type: WS_EVENT.JOB_LOG, jobId: job.id, line });
      };

      this.jobs.setPulseHandle(
        job.id,
        setInterval(() => {
          if (outRest.trim()) appendLogLine(`$ partial stdout: ${clipLog(outRest)}`);
          if (errRest.trim()) appendLogLine(`$ partial stderr: ${clipLog(errRest)}`);
          const secs = Math.max(1, Math.round((Date.now() - startedMs) / 1000));
          appendLogLine(`$ still running ${secs}s`);
        }, HEARTBEAT_MS),
      );

      child.stdout?.on('data', (chunk) => {
        const lines = (outRest + chunk.toString()).split(/\r?\n/);
        outRest = lines.pop() as string;
        for (const line of lines) {
          if (line.trim()) {
            this.logStore.writeJobLog(job.logPath, line);
            this.broadcaster.broadcast({ type: WS_EVENT.JOB_LOG, jobId: job.id, line });
          }
        }
      });

      child.stderr?.on('data', (chunk) => {
        const lines = (errRest + chunk.toString()).split(/\r?\n/);
        errRest = lines.pop() as string;
        for (const line of lines) {
          if (line.trim()) {
            this.logStore.writeJobLog(job.logPath, line);
            this.broadcaster.broadcast({
              type: WS_EVENT.JOB_LOG,
              jobId: job.id,
              line: line.substring(0, 200),
            });
          }
        }
      });

      child.on('exit', async (code) => {
        this.jobs.clearTimeoutHandle(job.id);
        this.jobs.clearPulseHandle(job.id);
        this.jobs.removeChild(job.id);
        for (const rest of [outRest, errRest]) {
          if (rest.trim()) {
            try {
              this.logStore.writeJobLog(job.logPath, rest);
            } catch {
              /* 忽略 */
            }
          }
        }
        job.exitCode = code;
        job.status = code === 0 ? 'done' : 'failed';
        job.finishedAt = new Date().toISOString();
        try {
          this.logStore.writeJobLog(job.logPath, `$ exit: code=${code}`);
        } catch {
          /* 忽略 */
        }
        if (code === 0) {
          try {
            await this.repoRefresh(repoPath);
            const after = this.repos.readSnapshot(repoPath);
            job.diff = { before, after };
          } catch {
            job.diff = null;
          }
        }
        this.emitJobDone(job);
        done();
      });

      child.on('error', (err) => {
        const e = err as NodeJS.ErrnoException;
        this.jobs.clearTimeoutHandle(job.id);
        this.jobs.clearPulseHandle(job.id);
        this.jobs.removeChild(job.id);
        job.status = 'failed';
        job.exitCode = -1;
        job.finishedAt = new Date().toISOString();
        try {
          this.logStore.writeJobLog(
            job.logPath,
            `spawn failed [${e.code ?? 'UNKNOWN'}]: check pi path / PI_PATH`,
          );
        } catch {
          /* 忽略 */
        }
        this.emitJobDone(job);
        done();
      });

      this.jobs.setTimeoutHandle(
        job.id,
        setTimeout(() => {
          this.jobs.clearTimeoutHandle(job.id);
          this.jobs.clearPulseHandle(job.id);
          const c = this.jobs.getChild(job.id);
          if (c) this.runner.killTree(c);
          job.status = 'failed';
          job.finishedAt = new Date().toISOString();
          try {
            this.logStore.writeJobLog(
              job.logPath,
              `$ timeout: exceeded ${Math.round(this.jobTimeoutMs() / 1000)}s`,
            );
          } catch {
            /* 忽略 */
          }
          this.emitJobDone(job);
          done();
        }, this.jobTimeoutMs()),
      );
    });
  }

  /** 初始化（清除殘留狀態；測試可重置用）。 */
  reset(): void {
    this.jobs.clearAll();
  }

  /** 對外給 repoService 使用的輔助：取得 optimize prompt 的 jobId 建立流程。 */
  static newJobId(): string {
    return randomUUID();
  }

  /** 對舊 import 兼容：把內部 spawn function 也 export。 */
  static createSpawn(): typeof spawn {
    return spawn;
  }

  private emitJobDone(job: JobRecord): void {
    this.broadcaster.broadcast({
      type: WS_EVENT.JOB_DONE,
      jobId: job.id,
      repoId: job.repoId,
      status: job.status,
      exitCode: job.exitCode,
      diff: job.diff,
    });
  }
}

function clipLog(s: string, n = 200): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(-n);
}

// KILL_GRACE_MS 供測試讀取（向後相容 export）
export const JOB_KILL_GRACE_MS = KILL_GRACE_MS;
export const JOB_HEARTBEAT_MS = HEARTBEAT_MS;
export const JOB_DEFAULT_TIMEOUT_MS = DEFAULT_JOB_TIMEOUT_MS;
