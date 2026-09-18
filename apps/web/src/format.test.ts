import { describe, expect, it } from 'vitest';
import {
  diffHtml,
  jobCls,
  lampOf,
  normalizeRootDirInput,
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

describe('jobCls', () => {
  it('依狀態上色', () => {
    expect(jobCls('done')).toBe('job-done');
    expect(jobCls('failed')).toBe('job-failed');
    expect(jobCls('cancelled')).toBe('job-failed');
    expect(jobCls('running')).toBe('job-running');
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
