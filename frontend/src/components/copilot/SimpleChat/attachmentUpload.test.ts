import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, validateAttachmentSize } from './attachments';
import { composeAttachmentReferenceLines } from './attachmentUpload';
import type { AttachmentFile } from './attachments';

describe('attachmentUpload', () => {
  it('validateAttachmentSize：超限报错、正常通过', () => {
    expect(validateAttachmentSize(MAX_ATTACHMENT_BYTES + 1, 'big.bin') || '').toMatch(/超过 10MB/);
    expect(validateAttachmentSize(1024, 'ok.txt')).toBeNull();
  });

  it('MAX_ATTACHMENTS 上限为 8', () => {
    expect(MAX_ATTACHMENTS).toBe(8);
  });

  it('composeAttachmentReferenceLines：空数组返回空串', () => {
    expect(composeAttachmentReferenceLines([])).toBe('');
  });

  it('composeAttachmentReferenceLines：多附件逐行引用，含工作区相对路径与大小', () => {
    const refs = [
      { name: 'a.csv', path: '.chat-attachments/1-a.csv', size: 2048, type: 'text/csv' },
      { name: 'b.png', path: '.chat-attachments/2-b.png', size: 0, type: 'image/png' },
    ];
    const block = composeAttachmentReferenceLines(refs);
    expect(block).toBe('\n\n[附件: .chat-attachments/1-a.csv（2.0KB）]\n[附件: .chat-attachments/2-b.png]');
  });

  it('AttachmentFile：file 句柄与 dataUrl 互斥场景的类型契约', () => {
    const dragIn: AttachmentFile = { id: '1', name: 'x.csv', type: 'text/csv', size: 3, file: new File(['abc'], 'x.csv') };
    const pasteIn: AttachmentFile = { id: '2', name: 'p.png', type: 'image/png', size: 4, dataUrl: 'data:image/png;base64,aaaa' };
    expect(dragIn.file && !dragIn.dataUrl).toBe(true);
    expect(pasteIn.dataUrl && !pasteIn.file).toBe(true);
  });
});
