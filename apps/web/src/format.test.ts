import { describe, expect, it } from 'vitest';
import {
  diffHtml,
  activityLabel,
  formatSize,
  jobCls,
  jobEndToast,
  lampOf,
  normalizeRootDirInput,
  repoCountText,
  scanCaption,
  sliceMsg,
  sliceTime,
  trackingLine,
} from './format';

describe('trackingLine', () => {
  it('無 upstream', () => {
    expect(trackingLine({})).toBe('無 upstream');
    expect(trackingLine({ ahead: null, behind: null })).toBe('無 upstream');
  });
  it('同步', () => {
    expect(trackingLine({ ahead: 0, behind: 0 })).toBe('與遠端同步');
  });
  it('領先與落後', () => {
    expect(trackingLine({ ahead: 2, behind: 1 })).toBe('領先 2／落後 1');
  });
});

describe('lampOf', () => {
  it('失敗優先於 dirty', () => {
    expect(lampOf({ lastError: 'timeout', isDirty: true })).toEqual({
      cls: 'lamp-fail',
      label: '失敗',
    });
  });
  it('有變更為黃燈', () => {
    expect(lampOf({ isDirty: true })).toEqual({ cls: 'lamp-dirty', label: '有變更' });
  });
  it('乾淨為綠燈', () => {
    expect(lampOf({ isDirty: false })).toEqual({ cls: 'lamp-clean', label: '乾淨' });
  });
});

describe('sliceTime', () => {
  it('裁切 ISO 到分鐘並換成空白', () => {
    expect(sliceTime('2026-09-17T08:32:31.000Z')).toBe('2026-09-17 08:32');
  });
  it('空值回空字串', () => {
    expect(sliceTime(null)).toBe('');
    expect(sliceTime(undefined)).toBe('');
  });
});

describe('sliceMsg', () => {
  it('超過長度截斷', () => {
    expect(sliceMsg('abcdefghij', 4)).toBe('abcd');
  });
  it('空值回空字串', () => {
    expect(sliceMsg(null, 72)).toBe('');
  });
});

describe('normalizeRootDirInput', () => {
  it('去掉尾端斜線', () => {
    expect(normalizeRootDirInput('D:\\github\\')).toBe('D:\\github');
    expect(normalizeRootDirInput('/Users/me/github/')).toBe('/Users/me/github');
  });
  it('磁碟根保留', () => {
    expect(normalizeRootDirInput('D:\\')).toBe('D:\\');
  });
});

describe('scanCaption', () => {
  it('顯示已掃 n / 總數', () => {
    expect(scanCaption({ done: 3, total: 10 })).toBe('掃描中 3 / 10');
  });
  it('無 progress 時為掃描中', () => {
    expect(scanCaption(null)).toBe('掃描中…');
  });
});

describe('repoCountText', () => {
  it('無篩選只顯示全庫統計', () => {
    expect(repoCountText(12, 3, { total: 12, dirty: 3, active: false })).toBe('12 個專案 · 有變更 3');
  });
  it('有篩選追加檢視數量', () => {
    expect(repoCountText(12, 3, { total: 5, dirty: 2, active: true })).toBe(
      '12 個專案 · 有變更 3 ｜ 檢視 5 個（有變更 2）',
    );
  });
});

describe('formatSize', () => {
  it('格式化位元組', () => {
    expect(formatSize(0)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(2 * 1024 * 1024)).toBe('2 MB');
  });
});

describe('activityLabel', () => {
  it('依最後 commit 分桶', () => {
    const now = Date.parse('2026-09-19T00:00:00Z');
    expect(activityLabel('2026-09-18T00:00:00Z', now)).toBe('7 天內');
    expect(activityLabel('2026-08-25T00:00:00Z', now)).toBe('30 天內');
    expect(activityLabel('2026-01-01T00:00:00Z', now)).toBe('一年內');
    expect(activityLabel('2020-01-01T00:00:00Z', now)).toBe('較久');
    expect(activityLabel('')).toBe('—');
  });
});

describe('jobCls', () => {
  it('依狀態上色', () => {
    expect(jobCls('done')).toBe('job-done');
    expect(jobCls('failed')).toBe('job-failed');
    expect(jobCls('cancelled')).toBe('job-failed');
    expect(jobCls('running')).toBe('job-running');
  });
});

describe('jobEndToast', () => {
  it('完成／失敗／取消含專案名', () => {
    expect(jobEndToast('done', 'D:\\github\\Foo')).toBe('pi 優化完成：Foo');
    expect(jobEndToast('failed', '/home/me/Bar')).toBe('pi 優化失敗：Bar');
    expect(jobEndToast('cancelled', undefined, 'Baz')).toBe('已取消 pi 優化：Baz');
  });
});

describe('diffHtml', () => {
  it('空 diff 回空', () => {
    expect(diffHtml(null)).toBe('');
  });
  it('描述 dirty／branch／hash 前後', () => {
    const html = diffHtml({
      before: { isDirty: false, dirtyCount: 0, branch: 'main', lastCommitHash: 'abcdef123' },
      after: { isDirty: true, dirtyCount: 2, branch: 'main', lastCommitHash: 'abcdef123' },
    });
    expect(html).toContain('乾淨→有變更');
    expect(html).toContain('M 0→2');
    expect(html).toContain('abcdef1');
  });
});
