import { spawn } from 'node:child_process';
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
const jobMap = new Map<string, JobRecord>();

// exported for testing
export { jobMap, JOB_TIMEOUT_MS };

let wsInstance: Server | null = null;
let dbInstance: DatabaseSync | null = null;

export function initOptimizer(io: Server, db: DatabaseSync): void {
  wsInstance = io;
  dbInstance = db;
  jobMap.clear();
}

// Core job start function - extracted for testing
export function startJob(job: JobRecord, db: DatabaseSync): Promise<void> {
  return new Promise((resolve) => {
    const piPath = process.env.PI_PATH || 'pi';
    const prompt = job.prompt || '';
    const repoPath = job.repoId;

    // Check if pi exists
    try {
      fs.accessSync(piPath);
    } catch {
      job.status = 'failed';
      job.exitCode = -1;
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      resolve();
      return;
    }

    job.logPath = path.join('data', 'jobs', `${job.id}.log`);
    fs.mkdirSync(path.dirname(job.logPath), { recursive: true });

    const args = ['build', prompt, '--repo', repoPath];
    const child = spawn(piPath, args, { cwd: repoPath, env: { ...process.env, PI_JOB_ID: job.id } });

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout!.on('data', (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          wsInstance?.emit('job:log', { jobId: job.id, line });
        }
      }
    });

    child.stderr!.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          wsInstance?.emit('job:log', { jobId: job.id, line: line.substring(0, 200) });
        }
      }
    });

    job.finishedAt = new Date().toISOString();

    child.on('exit', (code) => {
      clearTimeout((job as any).timeoutId);
      job.exitCode = code;
      if (code === 0) {
        job.status = 'done';
        wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      } else {
        job.status = 'failed';
      }
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      resolve();
    });

    child.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        job.status = 'failed';
        job.exitCode = -1;
      }
      job.finishedAt = new Date().toISOString();
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      resolve();
    });

    // Timeout watchdog
    (job as any).timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      job.status = 'failed';
      wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
      resolve();
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

// Cancel a job
export function cancelJob(jobId: string): void {
  const job = jobMap.get(jobId);
  if (job) {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    wsInstance?.emit('job:done', { jobId: job.id, repoId: job.repoId });
    jobMap.delete(jobId);
  }
}

// Get job status
export function getJobStatus(jobId: string): JobRecord | undefined {
  return jobMap.get(jobId);
}