import { describe, expect, it } from 'vitest';

/**
 * BLOCK-245 P2 — 单列表收敛的等价性与语义测试。
 *
 * 核心一条：`composeContextMessage` 必须与收敛前三层套嵌
 * （composeMessageWithImageReferences ∘ composeMessageWithSelectionReferences
 * ∘ composeAttachmentReferenceLines）**逐字等价**；`contextChannels.baseline.test.ts`
 * 冻结形状，本文件冻结「并一之后仍是同一件事」。
 */

import {
  MAX_SELECTION_REFERENCES,
  appendSelectionReference,
  composeMessageWithSelectionReferences,
  makeSelectionReference,
  type SelectionReference,
} from './selectionReferences';
import {
  MAX_IMAGE_REFERENCES,
  appendImageReference,
  composeMessageWithImageReferences,
  makeImageReference,
  type ImageReference,
} from './imageReferences';
import { composeAttachmentReferenceLines, type UploadedAttachmentRef } from './attachmentUpload';
import {
  CONTEXT_GROUP_CAPS,
  appendContextItem,
  attachmentContextItems,
  composeContextMessage,
  countContextGroup,
  imageContextItem,
  removeContextItem,
  selectionContextItem,
  type ComposerContextItem,
} from './contextItems';
import type { ImageQuoteDetail, SelectionQuoteDetail } from '@/lib/events';

/** 收敛前的组装次序（SimpleChat.tsx:1203-1206 原样搬运，仅用于对账）。 */
function legacyCompose(
  text: string,
  selections: SelectionReference[],
  images: ImageReference[],
  attachments: UploadedAttachmentRef[],
): string {
  return composeMessageWithImageReferences(
    composeMessageWithSelectionReferences(text, selections),
    images,
  ) + composeAttachmentReferenceLines(attachments);
}

function selDetail(overrides: Partial<SelectionQuoteDetail> = {}): SelectionQuoteDetail {
  return {
    projectId: 'p1',
    path: 'analysis/plots.R',
    name: 'plots.R',
    startLine: 42,
    endLine: 48,
    text: 'ggplot(d, aes(x, y))\n+ geom_point()',
    ...overrides,
  };
}

function imgDetail(overrides: Partial<ImageQuoteDetail> = {}): ImageQuoteDetail {
  return {
    projectId: 'p1',
    kind: 'workspace-file',
    name: 'umap.png',
    path: 'figures/umap.png',
    url: 'file:///ws/figures/umap.png',
    ...overrides,
  };
}

/** 同一批事件流分别喂给「旧三通道」与「新单列表」，得到可比较的两份结果。 */
function replay(events: Array<{ selection?: Partial<SelectionQuoteDetail>; image?: Partial<ImageQuoteDetail> }>) {
  let refs: SelectionReference[] = [];
  let images: ImageReference[] = [];
  let items: ComposerContextItem[] = [];
  for (const event of events) {
    if (event.selection) {
      const detail = selDetail(event.selection);
      refs = appendSelectionReference(refs, detail);
      const ref = makeSelectionReference(detail);
      if (ref) items = appendContextItem(items, selectionContextItem(ref)).items;
    } else if (event.image) {
      const detail = imgDetail(event.image);
      images = appendImageReference(images, detail);
      const ref = makeImageReference(detail);
      if (ref) items = appendContextItem(items, imageContextItem(ref)).items;
    }
  }
  return { refs, images, items };
}

const attachments: UploadedAttachmentRef[] = [
  { name: 'counts.csv', path: '.chat-attachments/counts.csv', size: 2048, type: 'text/csv' },
  { name: 'zero.bin', path: '.chat-attachments/zero.bin', size: 0, type: 'application/octet-stream' },
];

describe('contextItems (BLOCK-245 P2)', () => {
  it('分组上限单源等于收敛前两通道各自上限', () => {
    expect(CONTEXT_GROUP_CAPS.reference).toBe(MAX_SELECTION_REFERENCES);
    expect(CONTEXT_GROUP_CAPS.image).toBe(MAX_IMAGE_REFERENCES);
    expect(CONTEXT_GROUP_CAPS.attachment).toBeNull();
  });

  it('与收敛前实现逐字等价（选中文段 + 图片 + 附件全在场）', () => {
    const { refs, images, items } = replay([
      { selection: {} },
      { selection: { path: 'notes/lab.md', name: 'lab.md', startLine: 7, endLine: undefined, text: 'BBB' } },
      { image: { kind: 'result-artifact', artifact: { toolJobId: 'job-7', revisionId: 'rev-3', artifactId: 'art-9', revisionOrdinal: 3 } } },
      { image: { name: 'scatter.png', path: 'figures/scatter.png' } },
    ]);
    expect(composeContextMessage('我的问题', [...items, ...attachmentContextItems(attachments)])).toBe(
      legacyCompose('我的问题', refs, images, attachments),
    );
  });

  it('逐字等价（只有选中文段 / 只有图片 / 只有附件 / 全空）', () => {
    const scenarios = [
      [{ selection: {} }],
      [{ image: {} }],
      [],
      [{ selection: {} }, { image: {} }, { selection: {} }],
    ] as const;
    for (const events of scenarios) {
      const { refs, images, items } = replay([...events]);
      for (const atts of [[], attachments]) {
        expect(composeContextMessage('q', [...items, ...attachmentContextItems(atts)]))
          .toBe(legacyCompose('q', refs, images, atts));
      }
    }
  });

  it('相邻同源去重语义与旧通道一致（同 path/行/文字重复计入被丢）', () => {
    const { refs, images, items } = replay([
      { selection: { text: 'AAA' } },
      { selection: { text: 'AAA' } },
      { selection: { text: 'BBB' } },
      { image: { name: 'a.png', path: 'a.png' } },
      { image: { name: 'a.png', path: 'a.png' } },
    ]);
    expect(refs.length).toBe(2);
    expect(images.length).toBe(1);
    expect(countContextGroup(items, 'reference')).toBe(2);
    expect(countContextGroup(items, 'image')).toBe(1);
  });

  it('超限保留最后 N 条与旧通道一致，并给出可提示的 dropped 计数', () => {
    const events = Array.from({ length: MAX_SELECTION_REFERENCES + 3 }, (_, i) => ({
      selection: { text: `seg-${i}`, startLine: i + 1, endLine: undefined },
    }));
    const { refs, items } = replay(events);
    expect(refs.length).toBe(MAX_SELECTION_REFERENCES);
    expect(countContextGroup(items, 'reference')).toBe(MAX_SELECTION_REFERENCES);
    const last = appendContextItem(items, selectionContextItem(makeSelectionReference(selDetail({ text: 'seg-X' }))!));
    expect(last.dropped).toBe(1);
    expect(last.items.length).toBe(items.length);
  });

  it('超限/去重信号可被 UI 消费（P5 的可见提示就靠这两个字段，不再静默）', () => {
    const base = appendContextItem([], selectionContextItem(makeSelectionReference(selDetail())!));
    expect(base.deduped).toBe(false);
    const dupe = appendContextItem(base.items, selectionContextItem(makeSelectionReference(selDetail())!));
    expect(dupe.deduped).toBe(true);
    expect(dupe.items).toBe(base.items);
  });

  it('两组成员互不占额度（与收敛前两条独立通道一致）', () => {
    const events = [
      ...Array.from({ length: MAX_IMAGE_REFERENCES + 2 }, (_, i) => ({ image: { name: `p${i}.png`, path: `f/p${i}.png` } })),
      ...Array.from({ length: MAX_SELECTION_REFERENCES + 1 }, (_, i) => ({ selection: { text: `s${i}` } })),
    ];
    const { refs, images, items } = replay(events);
    expect(images.length).toBe(MAX_IMAGE_REFERENCES);
    expect(refs.length).toBe(MAX_SELECTION_REFERENCES);
    expect(countContextGroup(items, 'image')).toBe(MAX_IMAGE_REFERENCES);
    expect(countContextGroup(items, 'reference')).toBe(MAX_SELECTION_REFERENCES);
  });

  it('附件组不去重、不设组内上限（上限属暂存文件面）', () => {
    let items: ComposerContextItem[] = [];
    for (const item of attachmentContextItems(attachments)) {
      items = appendContextItem(items, item).items;
    }
    const again = appendContextItem(items, attachmentContextItems(attachments)[0]);
    expect(again.items.length).toBe(items.length + 1);
    expect(again.deduped).toBe(false);
    expect(again.dropped).toBe(0);
  });

  it('removeContextItem 精确移除单项且不波及其他组', () => {
    const { items } = replay([{ selection: {} }, { image: {} }]);
    const withAttachments = [...items, ...attachmentContextItems(attachments)];
    const imageId = withAttachments.find((entry) => entry.group === 'image')!.id;
    const next = removeContextItem(withAttachments, imageId);
    expect(next.length).toBe(withAttachments.length - 1);
    expect(countContextGroup(next, 'image')).toBe(0);
    expect(countContextGroup(next, 'reference')).toBe(1);
    expect(countContextGroup(next, 'attachment')).toBe(2);
  });
});
