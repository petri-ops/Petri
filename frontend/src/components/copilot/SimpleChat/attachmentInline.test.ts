import { describe, expect, it } from 'vitest';

import { isImagePath, parseInlineAttachments, workspaceFileUrl } from './attachmentInline';

describe('BLOCK-150 加映 — 用户消息图片附件内联渲染（UI-477）', () => {
  it('isImagePath：png/jpg/webp 等 true；csv/txt false', () => {
    expect(isImagePath('.chat-attachments/1-a.png')).toBe(true);
    expect(isImagePath('.chat-attachments/1-a.PNG')).toBe(true);
    expect(isImagePath('.chat-attachments/1-a.jpeg')).toBe(true);
    expect(isImagePath('.chat-attachments/1-a.webp')).toBe(true);
    expect(isImagePath('.chat-attachments/1-a.csv')).toBe(false);
    expect(isImagePath('.chat-attachments/no-ext')).toBe(false);
  });

  it('parseInlineAttachments：图片附件行抽出为图、非图片行保留在正文', () => {
    const text = '这是啥\n\n[附件: .chat-attachments/1791547106365-pasted-image-1791547101263.png（50.7KB）]\n[附件: .chat-attachments/1-a.csv（2.0KB）]';
    const r = parseInlineAttachments(text);
    expect(r.images).toHaveLength(1);
    expect(r.images[0].name).toContain('pasted-image');
    expect(r.text).toContain('[附件: .chat-attachments/1-a.csv（2.0KB）]');
    expect(r.text).not.toContain('pasted-image');
    expect(r.text).toContain('这是啥');
  });

  it('无附件行时原样返回（零成本路径）', () => {
    const r = parseInlineAttachments('普通消息');
    expect(r.text).toBe('普通消息');
    expect(r.images).toHaveLength(0);
  });

  it('workspaceFileUrl：DEV 走 :3001、路径编码', () => {
    const url = workspaceFileUrl('p_1', '.chat-attachments/a b.png');
    expect(url).toContain('/api/workspaces/p_1/file?path=');
    expect(url).toContain(encodeURIComponent('.chat-attachments/a b.png'));
  });
});
