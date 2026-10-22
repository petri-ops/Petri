import { describe, expect, it } from 'vitest';

/**
 * BLOCK-245 P1 — 上下文通道「拆前行为基线」（先冻结，再收敛）。
 *
 * 现状是三条互不复用的平行通道：选中文段（selectionReferences）/ 图片引用
 * （imageReferences）/ 附件行块（attachmentUpload）。本文件不测单通道内部细节
 * （已有 selectionReferences.test.ts / imageReferences.test.ts /
 * attachmentUpload.test.ts 覆盖），只冻结**跨通道的可观察形状**：
 *   1) 每条通道渲染出的引用块逐字形状（含全角【】头、blockquote、artifact 元数据序）；
 *   2) 三者的**组合顺序**（SimpleChat.tsx:1203-1206 现实现 = 先叠选中文段、
 *      再叠图片引用、最后尾追附件行块）；
 *   3) 各自上限与「同源相邻重复不重复计入」的去重语义（上限值也在此钉住）；
 *   4) 超长截断的可见文案。
 *
 * 纪律：P2 收敛为单一 ComposerContextItem 后，本文件的断言**必须逐字不变**地通过。
 * 若某条断言需要改，说明那不是纯组织重构，而是行为变更——必须停下来重新判定。
 */

import {
  MAX_SELECTION_REFERENCES,
  MAX_SELECTION_REFERENCE_CHARS,
  appendSelectionReference,
  composeMessageWithSelectionReferences,
  makeSelectionReference,
} from './selectionReferences';
import {
  MAX_IMAGE_REFERENCES,
  appendImageReference,
  composeMessageWithImageReferences,
  makeImageReference,
} from './imageReferences';
import { composeAttachmentReferenceLines } from './attachmentUpload';
import type { ImageReference } from './imageReferences';
import type { SelectionReference } from './selectionReferences';
import type { ImageQuoteDetail, SelectionQuoteDetail } from '@/lib/events';

function selectionDetail(overrides: Partial<SelectionQuoteDetail> = {}): SelectionQuoteDetail {
  return {
    projectId: 'p1',
    path: 'analysis/plots.R',
    startLine: 42,
    endLine: 48,
    text: 'ggplot(d, aes(x, y))\n+ geom_point()',
    ...overrides,
  };
}

function imageDetail(overrides: Partial<ImageQuoteDetail> = {}): ImageQuoteDetail {
  return {
    projectId: 'p1',
    kind: 'result-artifact',
    name: 'umap.png',
    path: 'figures/umap.png',
    url: 'file:///ws/figures/umap.png',
    artifact: {
      toolJobId: 'job-7',
      revisionId: 'rev-3',
      artifactId: 'art-9',
      revisionOrdinal: 3,
    },
    ...overrides,
  };
}

/** 现实现（SimpleChat.tsx:1203-1206）的组合次序：选中文段 → 图片 → 附件尾追。 */
function composeAsOfP1(
  text: string,
  selections: (SelectionReference | null)[],
  images: (ImageReference | null)[],
  attachments: Parameters<typeof composeAttachmentReferenceLines>[0],
): string {
  return composeMessageWithImageReferences(
    composeMessageWithSelectionReferences(text, selections.filter(Boolean) as SelectionReference[]),
    images.filter(Boolean) as ImageReference[],
  ) + composeAttachmentReferenceLines(attachments);
}

describe('BLOCK-245 P1 上下文通道拆前行为基线', () => {
  it('基线常量：三通道各自上限与截断阈（改动=行为变更，不是重构）', () => {
    expect(MAX_SELECTION_REFERENCES).toBe(8);
    expect(MAX_SELECTION_REFERENCE_CHARS).toBe(8000);
    expect(MAX_IMAGE_REFERENCES).toBe(4);
  });

  it('基线形状：单条选中文段 → 全角【引用 路径:L起-L止】+ 逐行 blockquote', () => {
    const ref = makeSelectionReference(selectionDetail());
    expect(ref).not.toBeNull();
    expect(composeMessageWithSelectionReferences('帮我看看这段', [ref!])).toBe(
      '【引用 analysis/plots.R:L42-L48】\n> ggplot(d, aes(x, y))\n> + geom_point()\n\n帮我看看这段',
    );
  });

  it('基线形状：无行号来源只给路径；多条选区按加入序以空行分隔', () => {
    const first = makeSelectionReference(selectionDetail({ startLine: undefined, endLine: undefined, text: 'AAA' }));
    const second = makeSelectionReference(selectionDetail({ path: 'notes/lab.md', startLine: 7, endLine: undefined, text: 'BBB' }));
    expect(composeMessageWithSelectionReferences('正文', [first!, second!])).toBe(
      '【引用 analysis/plots.R】\n> AAA\n\n【引用 notes/lab.md:L7】\n> BBB\n\n正文',
    );
  });

  it('基线形状：空引用列表零干扰（原样返回，不产生前导空行）', () => {
    expect(composeMessageWithSelectionReferences('原文', [])).toBe('原文');
    expect(composeMessageWithImageReferences('原文', [])).toBe('原文');
    expect(composeAttachmentReferenceLines([])).toBe('');
  });

  it('基线形状：图片引用带来源行与 artifact 元数据（键序 toolJobId→ordinal→revisionId→artifactId）', () => {
    const ref = makeImageReference(imageDetail());
    expect(ref).not.toBeNull();
    expect(composeMessageWithImageReferences('跑一下', [ref!])).toBe(
      '【引用图片 umap.png】\n> 来源：Result Studio 结果图 · rev #3\n> artifact: toolJobId=job-7 revisionOrdinal=3 revisionId=rev-3 artifactId=art-9\n\n跑一下',
    );
  });

  it('基线形状：工作区静态图只给 path 行；血统不完整的结果图降级为不登记', () => {
    const staticRef = makeImageReference(imageDetail({ kind: 'workspace-file', artifact: undefined }));
    expect(composeMessageWithImageReferences('看图', [staticRef!])).toBe(
      '【引用图片 umap.png】\n> 来源：figures/umap.png\n> path: figures/umap.png\n\n看图',
    );
    expect(makeImageReference(imageDetail({ artifact: { toolJobId: '', revisionId: 'rev-1' } }))).toBeNull();
  });

  it('基线形状：附件行块尾追（半角 [] 头，与引用块的【】头不同）且大小标签一位小数', () => {
    const block = composeAttachmentReferenceLines([
      { name: 'counts.csv', path: '.chat-attachments/counts.csv', size: 2048, type: 'text/csv' },
      { name: 'zero.bin', path: '.chat-attachments/zero.bin', size: 0, type: 'application/octet-stream' },
    ]);
    expect(block).toBe('\n\n[附件: .chat-attachments/counts.csv（2.0KB）]\n[附件: .chat-attachments/zero.bin]');
  });

  it('基线形状：超长选区截断到 8000 字符并追加可见提示', () => {
    const long = makeSelectionReference(selectionDetail({ text: 'x'.repeat(MAX_SELECTION_REFERENCE_CHARS + 10) }));
    expect(long!.text).toBe(`${'x'.repeat(MAX_SELECTION_REFERENCE_CHARS)}\n…（选中内容过长，已截断）`);
  });

  it('基线次序：三通道同时在场 → 图片块最前、选中文段次之、用户文本居中、附件尾追', () => {
    const selection = makeSelectionReference(selectionDetail({ text: 'SEL', startLine: 1, endLine: 1 }));
    const image = makeImageReference(imageDetail());
    const composed = composeAsOfP1(
      '我的问题',
      [selection],
      [image],
      [{ name: 'a.csv', path: '.chat-attachments/a.csv', size: 1024, type: 'text/csv' }],
    );
    expect(composed).toBe(
      [
        '【引用图片 umap.png】',
        '> 来源：Result Studio 结果图 · rev #3',
        '> artifact: toolJobId=job-7 revisionOrdinal=3 revisionId=rev-3 artifactId=art-9',
        '',
        '【引用 analysis/plots.R:L1】',
        '> SEL',
        '',
        '我的问题',
        '',
        '[附件: .chat-attachments/a.csv（1.0KB）]',
      ].join('\n'),
    );
  });

  it('基线纪律：引用头一律全角【】——服务端 cleanContent 会剥行首半角 [...]，不得漂回半角', () => {
    const composed = composeAsOfP1(
      'q',
      [makeSelectionReference(selectionDetail({ text: 'SEL' }))],
      [makeImageReference(imageDetail({ kind: 'workspace-file', artifact: undefined }))],
      [],
    );
    for (const line of composed.split('\n')) {
      if (/^[[]/.test(line) && line.includes('引用')) {
        throw new Error(`引用头漂回半角方括号，将被服务端 cleanContent 剥掉：${line}`);
      }
    }
    expect(composed).toContain('【引用 ');
    expect(composed).toContain('【引用图片 ');
  });

  it('基线去重：与上一条完全同源不重复计入；不同源则追加', () => {
    const once = appendSelectionReference([], selectionDetail());
    const twice = appendSelectionReference(once, selectionDetail());
    expect(twice.length).toBe(1);
    const third = appendSelectionReference(twice, selectionDetail({ text: '别的文字' }));
    expect(third.length).toBe(2);

    const imgOnce = appendImageReference([], imageDetail());
    const imgTwice = appendImageReference(imgOnce, imageDetail());
    expect(imgTwice.length).toBe(1);
    expect(appendImageReference(imgTwice, imageDetail({ name: 'other.png' })).length).toBe(2);
  });

  it('基线上限：超限只保留最后 N 条（P5 要在此处加可见提示，但保留集合不得变）', () => {
    let refs: SelectionReference[] = [];
    for (let i = 0; i < MAX_SELECTION_REFERENCES + 3; i += 1) {
      refs = appendSelectionReference(refs, selectionDetail({ text: `seg-${i}`, startLine: i + 1, endLine: undefined }));
    }
    expect(refs.length).toBe(MAX_SELECTION_REFERENCES);
    expect(refs[0]?.text).toBe('seg-3');
    expect(refs[refs.length - 1]?.text).toBe(`seg-${MAX_SELECTION_REFERENCES + 2}`);

    let images: ImageReference[] = [];
    for (let i = 0; i < MAX_IMAGE_REFERENCES + 2; i += 1) {
      images = appendImageReference(images, imageDetail({ name: `pic-${i}.png` }));
    }
    expect(images.length).toBe(MAX_IMAGE_REFERENCES);
    expect(images[0]?.name).toBe('pic-2.png');
  });
});
