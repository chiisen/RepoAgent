/**
 * JobRegistry — IJobRegistry 實作（in-memory job tracker）。
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import type { IJobRegistry } from '../domain/ports.js';
import type { JobRecord } from '../domain/types.js';

export class JobRegistry implements IJobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pulses = new Map<string, ReturnType<typeof setInterval>>();

  create(repoId: string, prompt: string): JobRecord {
    const job: JobRecord = {
      id: randomUUID(),
      repoId,
      prompt,
      status: 'queued',
      logPath: '',
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      diff: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  setStatus(id: string, status: JobRecord['status'], patch?: Partial<JobRecord>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch ?? {}, { status });
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  delete(id: string): void {
    this.jobs.delete(id);
  }

  listActive(): JobRecord[] {
    return [...this.jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running');
  }

  activeForRepo(repoPath: string): JobRecord | undefined {
    const want = path.resolve(repoPath);
    return this.listActive().find((job) => path.resolve(job.repoId) === want);
  }

  setChild(id: string, child: ChildProcess): void {
    this.children.set(id, child);
  }

  getChild(id: string): ChildProcess | undefined {
    return this.children.get(id);
  }

  removeChild(id: string): void {
    this.children.delete(id);
  }

  setTimeoutHandle(id: string, handle: ReturnType<typeof setTimeout>): void {
    this.timeouts.set(id, handle);
  }

  clearTimeoutHandle(id: string): void {
    const t = this.timeouts.get(id);
    if (t) clearTimeout(t);
    this.timeouts.delete(id);
  }

  setPulseHandle(id: string, handle: ReturnType<typeof setInterval>): void {
    this.pulses.set(id, handle);
  }

  clearPulseHandle(id: string): void {
    const t = this.pulses.get(id);
    if (t) clearInterval(t);
    this.pulses.delete(id);
  }

  clearAll(): void {
    for (const t of this.timeouts.values()) clearTimeout(t);
    this.timeouts.clear();
    for (const t of this.pulses.values()) clearInterval(t);
    this.pulses.clear();
    for (const child of this.children.values()) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* 已退出則忽略 */
      }
    }
    this.children.clear();
    this.jobs.clear();
  }
}
