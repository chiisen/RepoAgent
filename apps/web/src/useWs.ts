import { useEffect, useRef, useState } from 'react';
import type { Repo } from './types';

export type WsMsg = {
  type: string;
  jobId?: string;
  repoId?: string;
  status?: string;
  line?: string;
  okCount?: number;
  failCount?: number;
  repo?: Repo;
};

/** 開發與正式都連目前頁面的 /ws；Vite 把該路徑轉到後端。 */
export function wsUrl(loc: { protocol: string; host: string }): string {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

export function useWs(onMsg: (m: WsMsg) => void) {
  const [open, setOpen] = useState(false);
  const wanted = useRef(true);
  const handler = useRef(onMsg);
  handler.current = onMsg;

  useEffect(() => {
    wanted.current = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!wanted.current || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 3000);
    };

    const connect = () => {
      if (!wanted.current) return;
      try {
        ws = new WebSocket(wsUrl(location));
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        (window as unknown as { __wsOpen: boolean }).__wsOpen = true;
        setOpen(true);
      };
      ws.onmessage = (ev) => {
        let m: WsMsg | null = null;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m && m.type) handler.current(m);
      };
      const down = () => {
        (window as unknown as { __wsOpen: boolean }).__wsOpen = false;
        setOpen(false);
        ws = null;
        schedule();
      };
      ws.onclose = down;
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* 忽略 */
        }
      };
    };

    connect();
    const unload = () => {
      wanted.current = false;
      try {
        ws?.close();
      } catch {
        /* 忽略 */
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      unload();
      window.removeEventListener('beforeunload', unload);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return { open };
}
