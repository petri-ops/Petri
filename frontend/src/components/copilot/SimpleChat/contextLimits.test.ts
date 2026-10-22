import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * BLOCK-245 P5 — 上限诚实化（C16 部分）。
 *
 * 收敛前：附件超量/超大只 `console.warn` + `slice`，引用超限由 append 静默移出
 * 最早一条。本测试钉住三件事：
 *   ① 超限**必有可见文案**（返回给宿主 / 走 notice），不再只有 console；
 *   ② 文案说清"谁被拒"与"已有项不动"（C16 的核心抱怨）；
 *   ③ 保留集合本身不变（P1 基线「超限只保留最后 N 条」的语义不得被顺手改掉）。
 */

import { MAX_ATTACHMENTS, onDrop } from './attachments';
import {
  attachmentCountNotice,
  attachmentTooLargeNotice,
  contextDedupedNotice,
  contextLimitNotice,
} from './contextLimits';

function fakeDropEvent(files: File[]) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = {
    dataTransfer: { files, items: files.map((f) => ({ type: f.type, getAsFile: () => f })) },
    preventDefault,
    stopPropagation,
  };
  return { event: event as unknown as React.DragEvent, preventDefault };
}

function csv(name: string, bytes = 4) {
  return new File(['x'.repeat(bytes)], name, { type: 'text/csv' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BLOCK-245 P5 文案单源', () => {
  it('超体积：一句说清文件名与上限（MB 取整，drop 与上传前置校验共用）', () => {
    expect(attachmentTooLargeNotice('big.csv', 10 * 1024 * 1024)).toBe('big.csv 超过 10MB 附件上限');
  });

  it('超数量：说明本次几个未加入，并明确已有附件不受影响', () => {
    const text = attachmentCountNotice(MAX_ATTACHMENTS, 2);
    expect(text).toContain(`上限 ${MAX_ATTACHMENTS}`);
    expect(text).toContain('2 个未加入');
    expect(text).toContain('不受影响');
  });

  it('引用超限：说明保留最后 N 条语义（最早那条被移出），不假装没发生', () => {
    const text = contextLimitNotice('reference', 8, 1);
    expect(text).toContain('最多 8 条');
    expect(text).toContain('最早加入的 1 条已移出');
  });

  it('同源去重：给"点了但有反应"的反馈（不是静默无效果）', () => {
    expect(contextDedupedNotice('image')).toContain('已经在列表里');
  });
});

describe('BLOCK-245 P5 附件 drop：console.warn → 可见文案', () => {
  it('超体积文件被拒时返回可见文案，且不再只往 console 里说', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setAttachments = vi.fn();
    const notice = onDrop(
      fakeDropEvent([new File(['x'.repeat(11 * 1024 * 1024)], 'huge.csv', { type: 'text/csv' })]).event,
      setAttachments,
      vi.fn(),
    );
    expect(notice).toContain('huge.csv 超过 10MB 附件上限');
    expect(setAttachments).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('数量超限：已有项一条不丢，只加得下的那些，并返回"本次几个未加入"', () => {
    const setAttachments = vi.fn();
    const notice = onDrop(
      fakeDropEvent([csv('a.csv'), csv('b.csv'), csv('c.csv')]).event,
      setAttachments,
      vi.fn(),
      undefined,
      MAX_ATTACHMENTS - 1,
    );
    expect(notice).toContain('2 个未加入');
    // 渲染面按 prev 实算：已有 7 条 + 新增 3 条 → 只落 1 条，前 7 条原样保留
    const updater = setAttachments.mock.calls[0][0] as (prev: unknown[]) => unknown[];
    const prev = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, i) => ({ id: `old-${i}` }));
    const next = updater(prev);
    expect(next.length).toBe(MAX_ATTACHMENTS);
    expect(next.slice(0, MAX_ATTACHMENTS - 1)).toEqual(prev);
  });

  it('既有超体积又有超数量：两条文案都出现（逐因可见，不合并成一句含糊话）', () => {
    const notice = onDrop(
      fakeDropEvent([
        new File(['x'.repeat(11 * 1024 * 1024)], 'huge.csv', { type: 'text/csv' }),
        csv('a.csv'),
        csv('b.csv'),
      ]).event,
      vi.fn(),
      vi.fn(),
      undefined,
      MAX_ATTACHMENTS,
    );
    expect(notice).toContain('huge.csv 超过 10MB 附件上限');
    expect(notice).toContain('2 个未加入');
    expect(notice).toContain('；');
  });

  it('未超限时零提示（提示只在真发生拒收时出现，不制造噪声）', () => {
    const notice = onDrop(fakeDropEvent([csv('a.csv')]).event, vi.fn(), vi.fn());
    expect(notice).toBeUndefined();
  });
});
