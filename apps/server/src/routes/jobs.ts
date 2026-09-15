import { Router, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { getJobStatus, cancelJob } from '../optimizer.js';

const LOG_TAIL_LINES = 50;

export function createJobsRouter(): Router {
  const router = Router();

  // job 狀態 + log 尾 50 行
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = getJobStatus(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    let logTail: string[] = [];
    try {
      if (job.logPath && existsSync(job.logPath)) {
        const lines = readFileSync(job.logPath, 'utf8').split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        logTail = lines.slice(-LOG_TAIL_LINES);
      }
    } catch { /* log 讀失敗不影響狀態回傳 */ }
    res.json({ job, logTail });
  });

  // 取消：SIGTERM→10s→SIGKILL（見 optimizer.terminate）
  router.delete('/jobs/:id', (req: Request, res: Response) => {
    const job = getJobStatus(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    cancelJob(req.params.id);
    res.json({ status: 'cancelled', jobId: req.params.id });
  });

  return router;
}