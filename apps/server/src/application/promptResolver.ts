/**
 * PromptResolver — 解析 optimize 請求要用的 prompt。
 * 純業務邏輯，無 I/O。
 */
import type { ConfigStore } from '../domain/config.js';
import { fillPrompt } from '../domain/config.js';

export function resolveOptimizePrompt(
  snap: ConfigStore,
  repoPath: string,
  branch: string,
  body: { prompt?: unknown; promptId?: unknown },
): { prompt: string; promptId: string } {
  const custom = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (custom) return { prompt: fillPrompt(custom, repoPath, branch), promptId: 'custom' };
  const id =
    typeof body.promptId === 'string' && body.promptId.trim() ? body.promptId.trim() : snap.activePromptId;
  const t = snap.promptTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`unknown promptId: ${id}`);
  return { prompt: fillPrompt(t.body, repoPath, branch), promptId: t.id };
}
