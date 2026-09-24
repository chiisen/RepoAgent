/**
 * WebsocketBroadcaster — IEventBroadcaster 實作（封裝 ws Server）。
 */
import { WebSocket } from 'ws';
import type { WsEventPayload } from '../../domain/events.js';
import type { IEventBroadcaster } from '../../domain/ports.js';

interface WsLikeServer {
  emit?: (event: string, payload: unknown) => void;
  clients?: Iterable<unknown>;
}

export class WebsocketBroadcaster implements IEventBroadcaster {
  private server: WsLikeServer | null = null;

  attach(server: WsLikeServer | null): void {
    this.server = server;
  }

  reset(): void {
    this.server = null;
  }

  broadcast(event: WsEventPayload): void {
    try {
      this.server?.emit?.(event.type, event);
    } catch {
      /* 無監聽器時忽略 */
    }
    const clients = this.server?.clients;
    if (!clients) return;
    let text: string;
    try {
      text = JSON.stringify(event);
    } catch {
      return;
    }
    for (const client of clients) {
      try {
        const c = client as { readyState: number; send: (data: string) => void };
        if (c.readyState === WebSocket.OPEN) c.send(text);
      } catch {
        /* 單一 client 失敗不影響其他 */
      }
    }
  }
}
