/**
 * Domain — 純文字／時間工具（無 I/O、無副作用）。
 */

export type CommitWindow = 'today' | 'week' | 'month';

/** 取最後一行非空文字（供 pull／log 摘要使用），最長 200 字。 */
export function lastOutputLine(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return (lines[lines.length - 1] || text.trim() || '').slice(0, 200);
}

/** 今日零點／本週一零點／本月 1 號零點（本地時區）的 ISO 字串。 */
export function windowStartIso(kind: CommitWindow, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (kind === 'today') return new Date(y, m, d).toISOString();
  if (kind === 'week') return new Date(y, m, d - ((now.getDay() + 6) % 7)).toISOString();
  return new Date(y, m, 1).toISOString();
}
