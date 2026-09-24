// ============================================================
// attachmentUpload.ts — BLOCK-91 附件真实接入发送管线
//
// 附件（拖入/粘贴）在发送前上传到项目工作区 `.chat-attachments/`
// （复用 BLOCK-90 fs/upload 分片上传，local/ssh 双后端同构），
// 消息文本追加引用行，模型/agent 按路径读取——与 imageRefs 同构。
// ============================================================

import { validateAttachmentSize, type AttachmentFile } from './attachments';

/** 附件落盘目录（工作区相对路径）。 */
export const ATTACHMENT_DIR = '.chat-attachments';
/** fs/upload 分片大小（64KB 二进制，b64 后 <128KB argv 上限，与 BLOCK-90 对齐）。 */
const UPLOAD_CHUNK = 64 * 1024;

export interface UploadedAttachmentRef {
  name: string;
  /** 工作区相对路径（.chat-attachments/…）。 */
  path: string;
  size: number;
  type: string;
}

function getApiBase(): string {
  // 与 copilotClient.getApiPrefix 同源（避免跨层 import pages/ 的 fileOps）。
  // dev 下后端固定 :3001；生产同源相对 /api。
  if (import.meta.env.DEV) return 'http://localhost:3001/api';
  return '/api';
}

/** base64 → 二进制（渲染层无 node Buffer，用 Uint8Array 承载）。 */
function base64ToBytes(dataB64: string): Uint8Array {
  const bin = atob(dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fileToBase64(file: File): Promise<string> {
  let out = '';
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK) {
    const buf = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK).arrayBuffer());
    for (let i = 0; i < buf.length; i += 0x8000) {
      out += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
  }
  return btoa(out);
}

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function uploadChunk(projectId: string, toPath: string, dataB64: string, offset: number): Promise<void> {
  const resp = await fetch(
    `${getApiBase()}/workspaces/${encodeURIComponent(projectId)}/fs/upload`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toPath, dataB64, offset }),
    },
  );
  const data = (await resp.json().catch(() => ({ ok: false, error: `请求失败（${resp.status}）` }))) as { ok?: unknown; error?: unknown };
  if (!resp.ok || !data?.ok) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : `附件上传失败（${resp.status}）`);
  }
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

  const dataB64 = att.file
    ? await fileToBase64(att.file)
    : att.dataUrl
      ? dataUrlToBase64(att.dataUrl)
      : null;
  if (dataB64 === null) throw new Error(`${att.name} 无可上传内容`);

  const binary = base64ToBytes(dataB64);
  if (binary.length === 0) {
    await uploadChunk(projectId, toPath, '', 0);
  }
  for (let offset = 0; offset < binary.length; offset += UPLOAD_CHUNK) {
    const slice = binary.subarray(offset, offset + UPLOAD_CHUNK);
    let chunkB64 = '';
    for (let i = 0; i < slice.length; i += 0x8000) {
      chunkB64 += String.fromCharCode(...slice.subarray(i, i + 0x8000));
    }
    await uploadChunk(projectId, toPath, btoa(chunkB64), offset);
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
