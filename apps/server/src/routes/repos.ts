import { Router, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';

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

  return router;
}