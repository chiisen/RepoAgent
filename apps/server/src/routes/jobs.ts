import { Router, Request, Response } from 'express';

export function createJobsRouter(): Router {
  const router = Router();

  router.get('/jobs/:id', (_req: Request, res: Response) => {
    res.json({ status: 'not_found' });
  });

  return router;
}