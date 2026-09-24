/**
 * HeartbeatService — 包裝 IHeartbeatProbe。
 */
import type { IHeartbeatProbe } from '../domain/ports.js';
import type { PiHeartbeat } from '../domain/types.js';

export class HeartbeatService {
  constructor(private readonly probe: IHeartbeatProbe) {}

  get(sinceIso: string): PiHeartbeat | null {
    return this.probe.getHeartbeat(sinceIso);
  }
}
