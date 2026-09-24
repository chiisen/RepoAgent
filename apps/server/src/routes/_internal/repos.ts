/**
 * /api/repos 系列 Controller — 透過建構子注入 RepoService。
 */
import { type Request, type Response, Router } from 'express';

import type { RepoService } from '../../application/repoService.js';
import type { RepoQuery } from '../../domain/types.js';

export function createReposRouter(
  service: Pick<RepoService, 'list' | 'getDetail' | 'optimize' | 'pullRepo'>,
): Router {
  const router = Router();

  router.get('/repos', (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const filterRaw = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'name';
    const filter = filterRaw === 'dirty' || filterRaw === 'clean' ? filterRaw : 'all';
    const sort = sortRaw === 'lastCommitTime' ? 'lastCommitTime' : 'name';
    const query: RepoQuery = { q, filter, sort };
    res.json(service.list(query));
  });

  router.get('/repos/:id', async (req: Request, res: Response) => {
    try {
      const { repo, extra } = await service.getDetail(req.params.id);
      res.json({ repo, statusShort: extra.statusShort, recentCommits: extra.recentCommits });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'repo_not_found') return res.status(404).json({ error: (e as Error).message });
      res.status(500).json({ error: String((e as Error).message || e).slice(0, 300) });
    }
  });

  router.post('/repos/:id/optimize', (req: Request, res: Response) => {
    try {
      const out = service.optimize(req.params.id, req.body || {});
      res.status(202).json(out);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'repo_not_found') return res.status(404).json({ error: (e as Error).message });
      if (code === 'pi_already_running') {
        return res.status(409).json({
          error: (e as Error).message,
          jobId: (e as { jobId?: string }).jobId,
        });
      }
      if (code === 'pi_concurrency_limit') {
        return res.status(409).json({
          error: (e as Error).message,
          limit: (e as { limit?: number }).limit,
        });
      }
      if (code === 'invalid_prompt') return res.status(400).json({ error: (e as Error).message });
      res.status(500).json({ error: String((e as Error).message || e).slice(0, 300) });
    }
  });

  router.post('/repos/:id/pull', async (req: Request, res: Response) => {
    try {
      const { result, repo } = await service.pullRepo(req.params.id);
      const status = result.ok ? 200 : result.code === 'dirty' ? 409 : 400;
      res.status(status).json({ ...result, repo });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'repo_not_found') return res.status(404).json({ error: (e as Error).message });
      res.status(500).json({ error: String((e as Error).message || e).slice(0, 300) });
    }
  });

  return router;
}
