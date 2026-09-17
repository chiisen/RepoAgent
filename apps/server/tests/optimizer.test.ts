import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '../src/db.js';
import { initOptimizer, createJob, startJob, cancelJob, getJobStatus, getActiveJob, JobStatus, JOB_TIMEOUT_MS, KILL_GRACE_MS, getJobTimeoutMs, jobMap, childMap } from '../src/optimizer.js';
import { configStore } from '../src/config.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
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
    expect(JOB_TIMEOUT_MS).toBe(1_800_000);
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

  it('getActiveJob 只回傳 queued/running 的 job', () => {
    expect(getActiveJob()).toBeUndefined();
    const job = createJob('/r', 'p');
    expect(getActiveJob()?.id).toBe(job.id);
    cancelJob(job.id);
    expect(getActiveJob()).toBeUndefined();
  });

  it('getJobTimeoutMs 跟隨 configStore.timeout，異常值退回預設', () => {
    const saved = configStore.timeout;
    try {
      configStore.timeout = 1800;
      expect(getJobTimeoutMs()).toBe(1_800_000);
      configStore.timeout = 60;
      expect(getJobTimeoutMs()).toBe(60_000);
      configStore.timeout = NaN;
      expect(getJobTimeoutMs()).toBe(JOB_TIMEOUT_MS);
      (configStore as any).timeout = 'bad';
      expect(getJobTimeoutMs()).toBe(JOB_TIMEOUT_MS);
    } finally {
      configStore.timeout = saved;
    }
  });
});

// mock-spawn 回歸測試：鎖住 startJob 的跨平台行為
// （spawn 參數 / job:done 單次發送 / ENOENT / Windows shell / cancel 殺進程 / 逾時）
describe('startJob with mocked spawn', () => {
  const mockSpawn = vi.mocked(spawn);
  let emit: ReturnType<typeof vi.fn>;
  const createdLogs: string[] = [];

  function makeMockChild() {
    const child: any = new EventEmitter();
    child.kill = vi.fn(() => true);
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
    return child as { kill: ReturnType<typeof vi.fn>; stdout: EventEmitter; stderr: EventEmitter; stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }; emit: EventEmitter['emit']; on: EventEmitter['on'] };
  }

  function jobDoneCount() {
    return emit.mock.calls.filter(([event]) => event === 'job:done').length;
  }

  beforeEach(() => {
    emit = vi.fn();
    initOptimizer({ emit } as any, db);
    vi.stubEnv('PI_PATH', '');
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const logPath of createdLogs.splice(0)) rmSync(logPath, { force: true });
  });

  it('成功時 spawn 參數正確、log 落檔、job:done 只發送一次', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as any);
    const job = createJob('/test/repo', 'test prompt');
    createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    const p = startJob(job, db);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('pi');
    expect(args).toEqual(['--offline', '--print', '--approve', '--thinking', 'minimal']);
    expect(child.stdin.write).toHaveBeenCalledWith('test prompt', 'utf8');
    expect(child.stdin.end).toHaveBeenCalled();
    expect(opts).toMatchObject({
      cwd: resolve('/test/repo'),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    expect((opts as any).env.PI_JOB_ID).toBe(job.id);

    // 串流含 CRLF 與分片行，驗證 /\r?\n/ 與殘行拼接
    child.stdout.emit('data', Buffer.from('line1\r\nline2\npartial'));
    child.stdout.emit('data', Buffer.from('-done\n'));
    child.stderr.emit('data', Buffer.from('warn1\n'));
    child.emit('exit', 0);
    await p;

    expect(job.status).toBe('done');
    expect(job.exitCode).toBe(0);
    expect(job.finishedAt).not.toBeNull();
    expect(job.logPath).toBe(resolve('data', 'jobs', `${job.id}.log`));
    const log = readFileSync(job.logPath, 'utf8');
    expect(log).toContain('line1');
    expect(log).toContain('line2');
    expect(log).toContain('partial-done');
    expect(log).toContain('warn1');
    expect(jobDoneCount()).toBe(1);
    expect(emit.mock.calls.filter(([event]) => event === 'job:log').length).toBeGreaterThanOrEqual(4);
  });

  it('非 0 退出標記 failed 且 job:done 只發送一次', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as any);
    const job = createJob('/test/repo', 'prompt');
    createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    const p = startJob(job, db);
    child.emit('exit', 2);
    await p;

    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(2);
    expect(job.finishedAt).not.toBeNull();
    expect(jobDoneCount()).toBe(1);
  });

  it('pi 不存在（ENOENT）立即 failed 並在 log 留下提示', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as any);
    const job = createJob('/test/repo', 'prompt');
    createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    const p = startJob(job, db);
    const err: any = new Error('spawn pi ENOENT');
    err.code = 'ENOENT';
    child.emit('error', err);
    await p;

    expect(job.status).toBe('failed');
    expect(job.exitCode).toBe(-1);
    expect(job.finishedAt).not.toBeNull();
    expect(readFileSync(job.logPath, 'utf8')).toContain('spawn failed [ENOENT]');
    expect(jobDoneCount()).toBe(1);
  });

  it('Windows 下 spawn 啟用 shell 以解析 pi.cmd/.bat', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child as any);
      const job = createJob('/test/repo', 'prompt');
      createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

      const p = startJob(job, db);
      expect(mockSpawn.mock.calls[0][2]).toMatchObject({ shell: true });
      child.emit('exit', 0);
      await p;
      expect(job.status).toBe('done');
      expect(jobDoneCount()).toBe(1);
    } finally {
      if (descriptor) Object.defineProperty(process, 'platform', descriptor);
    }
  });

  it('cancelJob 實際殺掉子進程並標記 cancelled', () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as any);
    const job = createJob('/test/repo', 'prompt');
    createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    startJob(job, db); // 保持 pending，不觸發 exit
    expect(childMap.get(job.id)).toBeDefined();

    cancelJob(job.id);

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(job.status).toBe('cancelled');
    expect(job.finishedAt).not.toBeNull();
    expect(getJobStatus(job.id)).toBeUndefined();
    expect(childMap.get(job.id)).toBeUndefined();
    expect(jobDoneCount()).toBe(1);
  });

  it('Windows 下 terminate 用 taskkill /T 連樹砍，避免孤兒 pi', async () => {
    if (process.platform !== 'win32') return;
    const { execFile } = await import('node:child_process');
    const child = makeMockChild() as any;
    child.pid = 12345;
    mockSpawn.mockReturnValue(child);
    const job = createJob('/test/repo', 'prompt');
    createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

    startJob(job, db); // 保持 pending，不觸發 exit
    cancelJob(job.id);

    expect(execFile).toHaveBeenCalledWith(
      'taskkill', ['/PID', '12345', '/T', '/F'], expect.anything(), expect.anything(),
    );
  });
  it('逾時先 SIGTERM、10 秒寬限後 SIGKILL 並標記 failed', async () => {
    vi.useFakeTimers();
    try {
      const child = makeMockChild();
      mockSpawn.mockReturnValue(child as any);
      const job = createJob('/test/repo', 'prompt');
      createdLogs.push(resolve('data', 'jobs', `${job.id}.log`));

      const p = startJob(job, db);
      await vi.advanceTimersByTimeAsync(JOB_TIMEOUT_MS);
      await p;

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(job.status).toBe('failed');
      expect(job.finishedAt).not.toBeNull();
      expect(jobDoneCount()).toBe(1);

      // 子進程仍未退出（exitCode null）→ 寬限期到觸發 SIGKILL
      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
});