/**
 * @deprecated Shim：保留舊 `getPiHeartbeat` / `parseSessionStart` / `sessionRoot`。
 */

import { sharedContainer } from '../composition/_sharedContainer.js';
import { parseSessionStart as _parseSessionStart } from '../infrastructure/fs/piSessionHeartbeatProbe.js';

export type { PiHeartbeat } from '../domain/types.js';

export function sessionRoot(): string {
  return sharedContainer().sessionRoot.root();
}

export function getPiHeartbeat(sinceIso: string) {
  return sharedContainer().heartbeatService.get(sinceIso);
}

export const parseSessionStart = _parseSessionStart;
