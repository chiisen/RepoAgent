import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Server } from 'ws';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { configStore } from './config.js';
import { refreshRepo } from './scanner.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobDiffState {
  isDirty: number;
  dirtyCount: number;
  branch: string;
  lastCommitHash: string;
}

// issue #2：優化成功重掃後的前後差異（dirty／branch／hash）
export interface JobDiff {
  before: JobDiffState;
  after: JobDiffState;
}

export interface JobRecord {
  id: string;
  repoId: string;
  prompt: string;
  status: JobStatus;
  logPath: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  diff: JobDiff | null;
}

const JOB_TIMEOUT_MS = 1_800_000; // 預設 30 分鐘；實際以 configStore.timeout（秒）為準
const KILL_GRACE_MS = 10_000; // SIGTERM 後等 10 秒再 SIGKILL（雙平台）
const HEARTBEAT_MS = 5_000; // 執行中心跳＋無換行殘行沖刷

// job 逾時改為可設定：讀 configStore.timeout（秒，PUT /api/config 可改 60..7200），
// 異常值退回預設，避免改壞設定導致永不逾時或秒殺。
export function getPiConcurrency(): number {
  const n = Number(configStore.piConcurrency);
  if (!Number.isInteger(n) || n < 1 || n > 4) return 2;
  return n;
}

export function getJobTimeoutMs(): number {
  const s = Number(configStore.timeout);
  if (!Number.isFinite(s) || s < 60 || s > 7200) return JOB_TIMEOUT_MS;
  return Math.floor(s) * 1000;
}

// 規格 §4.3 預設 prompt 樣板（正式優化用：分析品質並執行安全的優化）。
// {repoPath} / {branch} 由呼叫方（routes/repos.ts）代入；prompt 經 stdin 傳遞，
// 故樣板內換行安全。
export const DEFAULT_PROMPT_TEMPLATE =
  '分析此 repo 的程式碼品質（異味、重複、依賴老舊），提出並執行安全的優化，保留 git 可回退，輸出繁中摘要。repo={repoPath} branch={branch}';
const jobMap = new Map<string, JobRecord>();
const childMap = new Map<string, ChildProcess>();
// 逾時計時器獨立存放：job 物件需保持 JSON 可序列化（API 直接回傳），不可掛 Timeout
const timeoutMap = new Map<string, ReturnType<typeof setTimeout>>();
const pulseMap = new Map<string, ReturnType<typeof setInterval>>();

function clearJobTimeout(jobId: string): void {
  const t = timeoutMap.get(jobId);
  if (t) {
    clearTimeout(t);
    timeoutMap.delete(jobId);
  }
}

function clearJobPulse(jobId: string): void {
  const t = pulseMap.get(jobId);
  if (t) {
    clearInterval(t);
    pulseMap.delete(jobId);
  }
}

function clipLog(s: string, n = 200): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(-n);
}

// 規格 §5：log 保留最近 50 個 job 檔，超過刪檔不刪 DB 紀錄
// （jobs 僅存記憶體 jobMap，DB jobs 表目前無寫入，故只需清檔案）。
// 清理為 best-effort：任何失敗都吞掉，不影響建 job／寫 log 主流程。
export const MAX_JOB_LOGS = 50;

export function pruneJobLogs(dir: string, keep = MAX_JOB_LOGS): { kept: number; deleted: number } {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
  } catch {
    return { kept: 0, deleted: 0 }; // 目錄不存在時不做事、不報錯
  }
  if (files.length <= keep) return { kept: files.length, deleted: 0 };
  const withTime = files.map((f) => {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(dir, f)).mtimeMs;
    } catch { /* 競刪的檔視為最舊，優先清掉 */ }
    return { f, mtimeMs };
  });
  withTime.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.f < b.f ? -1 : 1));
  let deleted = 0;
  for (const { f } of withTime.slice(keep)) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
      deleted++;
    } catch { /* 單檔清失敗不中斷，留待下次 */ }
  }
  return { kept: files.length - deleted, deleted };
}

// exported for testing
export { jobMap, childMap, JOB_TIMEOUT_MS, KILL_GRACE_MS, HEARTBEAT_MS };

let wsInstance: Server | null = null;
let dbInstance: DatabaseSync | null = null;

// issue #3：真正推播給瀏覽器。注意 ws Server 的 .emit() 只觸發 server 端監聽器，
// 不會送到 clients，故在此另行遍歷發送；既有 emit 保留（測試與相容）。
function broadcast(msg: object): void {
  // clients 可能不存在（測試用 {emit} 假物件）；缺席即略過
  const clients = (wsInstance as unknown as { clients?: Iterable<unknown> } | null)?.clients;
  if (!clients) return;
  let text: string;
  try {
    text = JSON.stringify(msg);
  } catch {
    return;
  }
  for (const client of clients) {
    try {
      const c = client as { readyState: number; send: (data: string) => void };
      if (c.readyState === WebSocket.OPEN) c.send(text);
    } catch { /* 單一 client 失敗不影響其他 */ }
  }
}

export function notifyEvent(
  type: 'job:log' | 'job:done' | 'scan:done' | 'scan:repo',
  payload: Record<string, unknown>,
): void {
  try {
    wsInstance?.emit(type, payload);
  } catch { /* 無監聽器時忽略 */ }
  broadcast({ type, ...payload });
}

function emitJobDone(job: JobRecord): void {
  notifyEvent('job:done', {
    jobId: job.id,
    repoId: job.repoId,
    status: job.status,
    exitCode: job.exitCode,
    diff: job.diff,
  });
}

export function initOptimizer(io: Server, db: DatabaseSync): void {
  wsInstance = io;
  dbInstance = db;
  jobMap.clear();
  for (const t of timeoutMap.values()) clearTimeout(t);
  timeoutMap.clear();
  for (const t of pulseMap.values()) clearInterval(t);
  pulseMap.clear();
  for (const child of childMap.values()) {
    try { child.kill('SIGKILL'); } catch { /* 已退出則忽略 */ }
  }
  childMap.clear();
}

// 跨平台 kill：Windows 上 SIGTERM/SIGKILL 皆為強制終止（Node 模擬），
// macOS/Linux 上先 SIGTERM 給 graceful 機會，超時再 SIGKILL。
function terminate(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    // shell:true 會包一層 cmd，只殺 wrapper 會留下孤兒 pi 續跑；
    // taskkill /T 把整棵進程樹砍掉（/F 強制）。
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  }
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
    // issue #2：重掃前快照（DB 現存列；pi 跑完成功才重掃比對）
    const before = readRepoSnapshot(db, repoPath);

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    // 絕對路徑：避免 Windows 服務 / macOS launchd 下 cwd 不同導致相對路徑漂移
    job.logPath = path.resolve('data', 'jobs', `${job.id}.log`);
    try {
      fs.mkdirSync(path.dirname(job.logPath), { recursive: true });
      fs.writeFileSync(job.logPath, '');
      pruneJobLogs(path.dirname(job.logPath));
    } catch (e) {
      job.status = 'failed';
      job.exitCode = -1;
      job.finishedAt = new Date().toISOString();
      emitJobDone(job);
      done();
      return;
    }

    // pi 無 build 子命令與 --repo 選項；非互動 job 用 `pi --print <prompt>`，
    // cwd 已是該 repo（見下方 spawn opts），故不需另傳路徑。
    // --approve：該 repo 若不在 pi trust 名單內會等使用者確認，
    // 在無 TTY 的 job 下會無聲卡死直到逾時；使用者既已按優化即視為授權。
    // --offline：跳過啟動期網路動作（更新檢查等），實測啟動從數分鐘級波動降為秒級；
    // 模型呼叫本身仍走網路，不受影響。
    // prompt 走 stdin 而非 argv：Windows shell:true 經 cmd.exe 會把中文 prompt
    // 按空白切成多段 messages；stdin 傳 UTF-8 位元組流，無 cmd 解析問題。
    const args = ['--offline', '--print', '--approve'];
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
      emitJobDone(job);
      done();
      return;
    }
    childMap.set(job.id, child);
    try {
      fs.appendFileSync(job.logPath!, `$ spawn: ${piPath} ${args.map((a) => JSON.stringify(a)).join(' ')} (pid=${child.pid}, cwd=${repoPath}, prompt ${prompt.length} chars via stdin)\n`);
    } catch { /* 首行寫失敗不影響執行 */ }
    // prompt 經 stdin 餵給 pi；pi 先退出的話 write 會 EPIPE，吞掉避免崩服務
    try {
      child.stdin?.on('error', () => {});
      child.stdin?.write(prompt, 'utf8');
      child.stdin?.end();
    } catch { /* pi 已退出的競態，忽略 */ }

    let outRest = '';
    let errRest = '';
    const startedMs = Date.now();

    const appendLogLine = (line: string, notify = true): void => {
      try { fs.appendFileSync(job.logPath!, line + '\n'); } catch { /* 忽略 */ }
      if (notify) notifyEvent('job:log', { jobId: job.id, line });
    };

    pulseMap.set(job.id, setInterval(() => {
      if (outRest.trim()) appendLogLine(`$ partial stdout: ${clipLog(outRest)}`);
      if (errRest.trim()) appendLogLine(`$ partial stderr: ${clipLog(errRest)}`);
      const secs = Math.max(1, Math.round((Date.now() - startedMs) / 1000));
      appendLogLine(`$ still running ${secs}s`);
    }, HEARTBEAT_MS));

    child.stdout?.on('data', (chunk) => {
      // \r?\n：相容 Windows CRLF 與 Unix LF
      const lines = (outRest + chunk.toString()).split(/\r?\n/);
      outRest = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          notifyEvent('job:log', { jobId: job.id, line });
        }
      }
    });

    child.stderr?.on('data', (chunk) => {
      const lines = (errRest + chunk.toString()).split(/\r?\n/);
      errRest = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          fs.appendFileSync(job.logPath!, line + '\n');
          notifyEvent('job:log', { jobId: job.id, line: line.substring(0, 200) });
        }
      }
    });

    child.on('exit', async (code) => {
      clearJobTimeout(job.id);
      clearJobPulse(job.id);
      childMap.delete(job.id);
      // 無結尾換行的殘行（pi 異常退出時常見）直接落檔，避免最後訊息遺失
      for (const rest of [outRest, errRest]) {
        if (rest.trim()) {
          try { fs.appendFileSync(job.logPath!, rest + '\n'); } catch { /* 忽略 */ }
        }
      }
      job.exitCode = code;
      job.status = code === 0 ? 'done' : 'failed';
      job.finishedAt = new Date().toISOString();
      try { fs.appendFileSync(job.logPath!, `$ exit: code=${code}\n`); } catch { /* 忽略 */ }
      if (code === 0) {
        // issue #2：成功才自動重掃該 repo 並記錄前後 diff；
        // 重掃失敗不翻轉 job 狀態，diff 留 null
        try {
          await refreshRepo(db, repoPath);
          job.diff = { before, after: readRepoSnapshot(db, repoPath) };
        } catch {
          job.diff = null;
        }
      }
      emitJobDone(job);
      done();
    });

    child.on('error', (err) => {
      clearJobTimeout(job.id);
      clearJobPulse(job.id);
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
      emitJobDone(job);
      done();
    });

    // Timeout watchdog：先 SIGTERM，10 秒不死才 SIGKILL（時限見 getJobTimeoutMs）
    timeoutMap.set(job.id, setTimeout(() => {
      timeoutMap.delete(job.id);
      clearJobPulse(job.id);
      const c = childMap.get(job.id);
      if (c) terminate(c);
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      try { fs.appendFileSync(job.logPath!, `$ timeout: exceeded ${Math.round(getJobTimeoutMs() / 1000)}s\n`); } catch { /* 忽略 */ }
      emitJobDone(job);
      done();
    }, getJobTimeoutMs()));
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
    diff: null,
  };
  jobMap.set(jobId, job);
  return job;
}

// issue #2：讀 DB 現存列做重掃前快照；列不存在或讀失敗回空快照，不影響主流程
function readRepoSnapshot(db: DatabaseSync, repoPath: string): JobDiffState {
  const empty: JobDiffState = { isDirty: 0, dirtyCount: 0, branch: '', lastCommitHash: '' };
  try {
    const row = db.prepare(
      'SELECT isDirty, dirtyCount, branch, lastCommitHash FROM repos WHERE path=?',
    ).get(repoPath) as JobDiffState | undefined;
    if (!row) return empty;
    return { isDirty: row.isDirty, dirtyCount: row.dirtyCount, branch: row.branch, lastCommitHash: row.lastCommitHash };
  } catch {
    return empty;
  }
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
  clearJobTimeout(jobId);
  clearJobPulse(jobId);
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  emitJobDone(job);
  jobMap.delete(jobId);
}

export function listActiveJobs(): JobRecord[] {
  return [...jobMap.values()].filter((job) => job.status === 'queued' || job.status === 'running');
}

export function getActiveJobForRepo(repoPath: string): JobRecord | undefined {
  const want = path.resolve(repoPath);
  return listActiveJobs().find((job) => path.resolve(job.repoId) === want);
}

// 相容：回傳任一執行中 job（單筆查詢／舊測試）
export function getActiveJob(): JobRecord | undefined {
  return listActiveJobs()[0];
}

// Get job status
export function getJobStatus(jobId: string): JobRecord | undefined {
  return jobMap.get(jobId);
}