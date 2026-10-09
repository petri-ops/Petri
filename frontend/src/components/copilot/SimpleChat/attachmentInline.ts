// ============================================================
// attachmentInline.ts — BLOCK-150 加映（UI-477）：用户消息图片附件内联渲染
//
// 用户裁决（2026-10-09「这个是附件的形式给到聊天框 我觉得这样并不好
// 直接是图片发送是否可以呢」）：粘贴图片发出的消息应显示为图片本体，
// 不应停留在一行「[附件: 路径（大小）]」文本。
//
// 发送管线（BLOCK-91 上传 .chat-attachments/ + 正文追加引用行）不动——
// 模型/vision 按路径读图的架构不变；本模块只做**渲染层**解析：用户消息
// 正文里的图片附件行抽出来经 /file 端点内联成 <img>，非图片附件行保留
// 原文（历史消息渲染时同样生效）。
// ============================================================

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** 是否图片路径（决定附件行内联成图还是保留文本）。 */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path);
}

/** 匹配发送管线产出的附件行：`[附件: path]` 或 `[附件: path（50.7KB）]`（全角括号）。 */
const ATTACHMENT_LINE_RE = /^\[附件: (.+?)(?:（[^）]*）)?\]$/;

export interface InlineAttachmentImage {
  /** workspace 相对路径（取图 URL 用）。 */
  path: string;
  /** 显示名（路径末段）。 */
  name: string;
}

/**
 * 解析用户消息正文：图片附件行抽出为 images，其余文本（含非图片附件行）保留。
 * 无附件行时零成本返回原文。
 */
export function parseInlineAttachments(text: string): { text: string; images: InlineAttachmentImage[] } {
  if (!text || !text.includes('[附件: ')) return { text, images: [] };
  const images: InlineAttachmentImage[] = [];
  const keptLines: string[] = [];
  for (const line of text.split('\n')) {
    const m = ATTACHMENT_LINE_RE.exec(line.trim());
    if (m && isImagePath(m[1])) {
      images.push({ path: m[1], name: m[1].split('/').pop() || m[1] });
      continue;
    }
    keptLines.push(line);
  }
  if (images.length === 0) return { text, images: [] };
  // 抽行后清理仅由附件行形成的连续空段（发送管线在正文后接 \n\n）
  const cleaned = keptLines.join('\n').replace(/\n{3,}$/, '\n').replace(/\s+$/, '');
  return { text: cleaned, images };
}

/** workspace 文件取图 URL（GET /api/workspaces/:id/file?path=…，Content-Type 按扩展名）。 */
export function workspaceFileUrl(projectId: string, path: string): string {
  const base = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
  return `${base}/workspaces/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`;
}
