/**
 * /api/jobs 系列 Controller。
 */
import { type Request, type Response, Router } from 'express';
import type { JobService } from '../../application/jobService.js';
import { JobNotFoundError } from '../../domain/errors.js';

export function createJobsRouter(
  jobService: Pick<JobService, 'listActive' | 'getJobDetail' | 'cancel' | 'jobTimeoutSec'>,
): Router {
  const router = Router();

  router.get('/jobs', (_req: Request, res: Response) => {
    res.json({ jobs: jobService.listActive() });
  });

  router.get('/jobs/:id', (req: Request, res: Response) => {
    const detail = jobService.getJobDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'job not found' });
    res.json({
      job: detail.job,
      logTail: detail.logTail,
      heartbeat: detail.heartbeat,
      timeoutSec: detail.timeoutSec,
    });
  });

  router.delete('/jobs/:id', (req: Request, res: Response) => {
    try {
      jobService.cancel(req.params.id);
      res.json({ status: 'cancelled', jobId: req.params.id });
    } catch (e) {
      if (e instanceof JobNotFoundError) {
        return res.status(404).json({ error: (e as Error).message });
      }
      res.status(500).json({ error: String((e as Error).message || e) });
    }
  });

  return router;
}
