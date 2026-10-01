import { describe, expect, it } from 'vitest';
import { wsUrl } from './useWs';

describe('wsUrl', () => {
  it('一律連目前頁面的 /ws', () => {
    expect(wsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(wsUrl({ protocol: 'https:', host: 'example.test' })).toBe('wss://example.test/ws');
  });
});
