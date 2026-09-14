import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb } from '../src/db.js';
import { initOptimizer, createJob, cancelJob, getJobStatus, JobStatus, JOB_TIMEOUT_MS, jobMap } from '../src/optimizer.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(':memory:');
  initOptimizer({ emit: vi.fn() } as any, db);
});

afterEach(() => {
  vi.restoreAllMocks();
  jobMap.clear();
});

describe('optimizer runtime', () => {
  it('should have JOB_TIMEOUT_MS constant', () => {
    expect(JOB_TIMEOUT_MS).toBe(600_000);
  });

  it('should have createJob function', () => {
    expect(typeof createJob).toBe('function');
  });

  it('should create a job with correct structure', () => {
    const job = createJob('/test/repo', 'test prompt');
    expect(job).toHaveProperty('id');
    expect(job).toHaveProperty('repoId', '/test/repo');
    expect(job).toHaveProperty('prompt', 'test prompt');
    expect(job).toHaveProperty('status');
    expect(typeof job.status).toBe('string');
  });

  it('should have cancelJob function', () => {
    expect(typeof cancelJob).toBe('function');
  });

  it('should have getJobStatus function', () => {
    expect(typeof getJobStatus).toBe('function');
  });

  it('should create jobs with unique IDs', () => {
    const job1 = createJob('/repo1', 'prompt1');
    const job2 = createJob('/repo2', 'prompt2');
    expect(job1.id).not.toBe(job2.id);
  });

  it('should cancel a job and remove it from map', () => {
    const job = createJob('/test/repo', 'prompt');
    expect(job.status).toBeDefined();
    cancelJob(job.id);
    const after = getJobStatus(job.id);
    // cancelJob removes the job from the map
    expect(after).toBeUndefined();
  });

  it('should return undefined for non-existent job', () => {
    const result = getJobStatus('non-existent-id');
    expect(result).toBeUndefined();
  });
});