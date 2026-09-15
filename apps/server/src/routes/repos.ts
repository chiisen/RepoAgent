import { Router, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { simpleGit } from 'simple-git';
import { randomUUID } from 'node:crypto';
import { createJob, startJob, DEFAULT_PROMPT_TEMPLATE } from '../optimizer.js';
import { lastOutputLine, pullFastForward } from '../pull.js';
import { refreshRepo } from '../scanner.js';

export function createReposRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/repos', (req: Request, res: Response) => {
    const { q = '', filter = 'all', sort = 'name' } = req.query;
    let sql = 'SELECT * FROM repos';
    const params: any[] = [];
    const conditions: string[] = [];

    if (q) {
      conditions.push('name LIKE ?');
      params.push(`%${q}%`);
    }
    if (filter === 'dirty') {
      conditions.push('isDirty = 1');
    } else if (filter === 'clean') {
      conditions.push('isDirty = 0');
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    if (sort === 'lastCommitTime') {
      sql += ' ORDER BY lastCommitTime DESC';
    } else {
      sql += ' ORDER BY name ASC';
    }

    const rows = db.prepare(sql).all(...params) as any[];
    res.json({ repos: rows, total: rows.length });
  });

  // 詳情：repo 欄位 + status --short 前 50 行 + log5（hash|date|subject）
  router.get('/repos/:id', async (req: Request, res: Response) => {
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(req.params.id) as any;
    if (!repo) return res.status(404).json({ error: 'repo not found' });
    try {
      const git = simpleGit(repo.path);
      const [short, logOut] = await Promise.all([
        git.raw(['status', '--short']),
        git.raw(['log', '-5', '--format=%H|%ad|%s', '--date=iso']),
      ]);
      const statusShort = short.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 50);
      const recentCommits = logOut
        .split(/\r?\n/)
        .filter((l) => l.length > 0)
        .map((l) => {
          const [hash = '', date = '', ...msg] = l.split('|');
          return { hash, date, message: msg.join('|') };
        });
      res.json({ repo, statusShort, recentCommits });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 300) });
    }
  });

  // 優化：建 job 並 fire-and-forget 啟動，以 WS/輪詢追蹤進度
  router.post('/repos/:id/optimize', (req: Request, res: Response) => {
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(req.params.id) as any;
    if (!repo) return res.status(404).json({ error: 'repo not found' });
    const custom = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    const prompt = custom
      || DEFAULT_PROMPT_TEMPLATE.replace('{repoPath}', repo.path).replace('{branch}', repo.branch);
    const job = createJob(repo.path, prompt);
    startJob(job, db);
    res.status(202).json({ job });
  });

  router.post('/repos/:id/pull', async (req: Request, res: Response) => {
    const repo = db.prepare('SELECT * FROM repos WHERE id=?').get(req.params.id) as any;
    if (!repo) return res.status(404).json({ error: 'repo not found' });
    try {
      const result = await pullFastForward(repo.path, randomUUID());
      await refreshRepo(db, repo.path, result.ok ? '' : result.message);
      const pullMsg = lastOutputLine(result.message || result.output);
      db.prepare('UPDATE repos SET lastPullAt=?, lastPullMsg=? WHERE id=?').run(
        new Date().toISOString(),
        pullMsg,
        req.params.id,
      );
      const updated = db.prepare('SELECT * FROM repos WHERE id=?').get(req.params.id);
      const status = result.ok ? 200 : result.code === 'dirty' ? 409 : 400;
      res.status(status).json({ ...result, repo: updated });
    } catch (e) {
      res.status(500).json({ error: String(e).slice(0, 300) });
    }
  });

  return router;
}