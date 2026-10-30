// ============================================================
// workspaceFileUpload — renderer 侧文件/字节写入项目工作区的唯一分片通道。
//
// 复用 BLOCK-90 `POST /api/workspaces/:id/fs/upload`（local/ssh 双后端同构）：
// 64KB 二进制/片（b64 后仍低于服务端 96KB 上限），offset 续写；
// offset=0 且目标已存在 → 409 `target_already_exists`（用 code 判别，不靠文案）。
// 此前同一逻辑在 RightFileTree 与 attachmentUpload 各写一份，P1c 是第三个消费方 —— 收敛为此处单源。
// ============================================================
import { getApiPrefix } from '@/lib/authClient';

const UPLOAD_CHUNK_BYTES = 64 * 1024;

export class WorkspaceUploadError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'WorkspaceUploadError';
    this.status = status;
    this.code = code;
  }
}

export function isTargetAlreadyExists(error: unknown): boolean {
  return error instanceof WorkspaceUploadError && error.code === 'target_already_exists';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function uploadChunk(projectId: string, toPath: string, dataB64: string, offset: number): Promise<void> {
  const response = await fetch(
    `${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/fs/upload`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toPath, dataB64, offset }),
    },
  );
  const data = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown; code?: unknown } | null;
  if (!response.ok || !data?.ok) {
    const message = typeof data?.error === 'string' && data.error ? data.error : `上传失败（${response.status}）`;
    throw new WorkspaceUploadError(message, response.status, typeof data?.code === 'string' ? data.code : null);
  }
}

export async function uploadBytesToWorkspace(projectId: string, toPath: string, bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) {
    await uploadChunk(projectId, toPath, '', 0);
    return;
  }
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
    await uploadChunk(projectId, toPath, bytesToBase64(bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES)), offset);
  }
}

/** 逐片读取 File（不把整文件读进内存再 base64）。 */
export async function uploadFileToWorkspace(projectId: string, toPath: string, file: File): Promise<void> {
  if (file.size === 0) {
    await uploadChunk(projectId, toPath, '', 0);
    return;
  }
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
    const chunk = new Uint8Array(await file.slice(offset, offset + UPLOAD_CHUNK_BYTES).arrayBuffer());
    await uploadChunk(projectId, toPath, bytesToBase64(chunk), offset);
  }
}
