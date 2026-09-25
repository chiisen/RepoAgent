/**
 * ScanProgressTracker — IScanProgressTracker 實作（in-memory 進度狀態）。
 */
import type { IScanProgressTracker } from '../domain/ports.js';
import type { ScanProgress } from '../domain/types.js';

export class ScanProgressTracker implements IScanProgressTracker {
  private state: ScanProgress = { running: false, total: 0, done: 0, current: '' };

  get(): ScanProgress {
    return { ...this.state };
  }

  reset(): void {
    this.state = { running: false, total: 0, done: 0, current: '' };
  }

  setTotal(total: number): void {
    this.state = { ...this.state, total };
  }

  setCurrent(current: string): void {
    this.state = { ...this.state, current };
  }

  bumpDone(): void {
    this.state = { ...this.state, done: this.state.done + 1 };
  }

  markRunning(running: boolean): void {
    this.state = { ...this.state, running };
  }
}
