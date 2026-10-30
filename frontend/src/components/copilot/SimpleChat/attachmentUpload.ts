// ============================================================
// attachmentUpload.ts — BLOCK-91 附件真实接入发送管线
//
// 附件（拖入/粘贴）在发送前上传到项目工作区 `.chat-attachments/`，
// 消息文本追加引用行，模型/agent 按路径读取——与 imageRefs 同构。
// 分片上传走 lib/workspaceFileUpload 单源（BLOCK-322 P1c 收敛，行为不变）。
// ============================================================

import { uploadBytesToWorkspace, uploadFileToWorkspace } from '@/lib/workspaceFileUpload';
import { validateAttachmentSize, type AttachmentFile } from './attachments';

/** 附件落盘目录（工作区相对路径）。 */
const ATTACHMENT_DIR = '.chat-attachments';

export interface UploadedAttachmentRef {
  name: string;
  /** 工作区相对路径（.chat-attachments/…）。 */
  path: string;
  size: number;
  type: string;
}

/** base64 → 二进制（渲染层无 node Buffer，用 Uint8Array 承载）。 */
function base64ToBytes(dataB64: string): Uint8Array {
  const bin = atob(dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : '';
}

/**
 * 上传单个附件到工作区 `.chat-attachments/`，返回引用描述。
 * 内容来源：优先 File 句柄（拖入），否则 dataUrl（粘贴图片）。
 */
export async function uploadAttachment(
  projectId: string,
  att: AttachmentFile,
): Promise<UploadedAttachmentRef> {
  const sizeError = validateAttachmentSize(att.size, att.name);
  if (sizeError) throw new Error(sizeError);

  const sanitized = (att.name || 'attachment').replace(/[\\/]/g, '_');
  const toPath = `${ATTACHMENT_DIR}/${Date.now()}-${sanitized}`;

  if (att.file) {
    await uploadFileToWorkspace(projectId, toPath, att.file);
  } else if (att.dataUrl) {
    await uploadBytesToWorkspace(projectId, toPath, base64ToBytes(dataUrlToBase64(att.dataUrl)));
  } else {
    throw new Error(`${att.name} 无可上传内容`);
  }
  return { name: att.name, path: toPath, size: att.size, type: att.type || 'application/octet-stream' };
}

/** 引用行块：追加到消息文本尾部，模型按工作区路径读取附件。 */
export function composeAttachmentReferenceLines(refs: UploadedAttachmentRef[]): string {
  if (refs.length === 0) return '';
  const lines = refs.map((ref) => {
    const sizeLabel = ref.size > 0 ? `（${(ref.size / 1024).toFixed(1)}KB）` : '';
    return `[附件: ${ref.path}${sizeLabel}]`;
  });
  return `\n\n${lines.join('\n')}`;
}
