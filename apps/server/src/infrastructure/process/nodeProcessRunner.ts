/**
 * NodeProcessRunner — IProcessRunner 實作（封裝 child_process.spawn + taskkill）。
 */

import type { ChildProcess } from 'node:child_process';
import { execFile, spawn } from 'node:child_process';

import type { IProcessRunner } from '../../domain/ports.js';

export class NodeProcessRunner implements IProcessRunner {
  spawn(
    command: string,
    args: string[],
    opts: { cwd: string; shell: boolean; windowsHide: boolean; env: Record<string, string> },
  ): ChildProcess {
    return spawn(command, args, opts);
  }

  killTree(child: ChildProcess): void {
    if (process.platform === 'win32' && child.pid !== undefined) {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    }
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill('SIGKILL');
      } catch {
        /* 已退出則忽略 */
      }
    }, 10_000).unref?.();
  }
}
