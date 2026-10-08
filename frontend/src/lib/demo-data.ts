/**
 * demo-data.ts — BLOCK-148 #12：demo 示例数据一键载入（前端消费面）。
 *
 * 把已装插件 demo-data/ 目录的输入文件拉到当前项目工作区 `demo-data/<toolId>/`：
 * - 清单：复用既有 `GET /api/tools/demo/:toolId`（handleLegacyDemoList，插件
 *   demo-data 目录投影；零新增端点）；
 * - 文件：复用既有 `GET /api/tools/demo-data/:toolId/:filename`；
 * - 落盘：复用 BLOCK-90 `POST /api/workspaces/:projectId/fs/upload` 分片写通道
 *   （local/ssh 双后端同构，父目录由后端 mkdir）。
 * - 不复制 demo 数据本体（仓库内零 demo 文件副本）；可用性信号 = 目录契约字段
 *   `demoDataUrl`（tools-catalog.js 投影）。
 * - 命名冲突：按插件子目录落（demo-data/<toolId>/）+ 同名已存在 → 409
 *   target_already_exists 跳过（幂等，不产生时间戳后缀污染）。
 */

import { getApiPrefix, getToken } from '@/lib/authClient';

/** fs/upload 分片大小（64KB 二进制，与 BLOCK-90 / attachmentUpload 同约定）。 */
const UPLOAD_CHUNK = 64 * 1024;

export interface DemoLoadSummary {
  /** demo 清单里的文件总数。 */
  listed: number;
  /** 本次实际落盘的文件数。 */
  loaded: number;
  /** 工作区已存在（409 target_already_exists）而跳过的文件数。 */
  skipped: number;
}

/** demo 文件在工作区的落地目录（工作区相对路径，3 段深度在 tree 递归上限内）。 */
export function demoDataTargetDir(toolId: string): string {
  return `demo-data/${toolId}`;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** demo 文件清单（name 来自插件 demo-data/ 目录；空数组 = 该工具无示例数据）。 */
async function listDemoFiles(toolId: string): Promise<string[]> {
  const resp = await fetch(`${getApiPrefix()}/tools/demo/${encodeURIComponent(toolId)}`, {
    headers: authHeaders(),
  });
  const data = (await resp.json().catch(() => ({}))) as { ok?: unknown; files?: Array<{ name?: unknown }> };
  if (!resp.ok || !data?.ok || !Array.isArray(data.files)) {
    throw new Error(`示例数据清单拉取失败（${resp.status}）`);
  }
  return data.files
    .map((f) => (f && typeof f.name === 'string' ? f.name : null))
    .filter((name): name is string => name !== null && name.length > 0 && !name.includes('/') && !name.includes('\\'));
}

/** Uint8Array → 64KB 一段的 base64 分片（渲染层无 node Buffer）。 */
function bytesToBase64Chunks(bytes: Uint8Array): Array<{ offset: number; dataB64: string }> {
  const chunks: Array<{ offset: number; dataB64: string }> = [];
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK) {
    const slice = bytes.subarray(offset, offset + UPLOAD_CHUNK);
    let chunkB64 = '';
    for (let i = 0; i < slice.length; i += 0x8000) {
      chunkB64 += String.fromCharCode(...slice.subarray(i, i + 0x8000));
    }
    chunks.push({ offset, dataB64: btoa(chunkB64) });
  }
  return chunks;
}

async function uploadDemoFile(projectId: string, toolId: string, name: string): Promise<'loaded' | 'skipped'> {
  const resp = await fetch(`${getApiPrefix()}/tools/demo-data/${encodeURIComponent(toolId)}/${encodeURIComponent(name)}`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`示例文件拉取失败：${name}（${resp.status}）`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const toPath = `${demoDataTargetDir(toolId)}/${name.replace(/[\\/]/g, '_')}`;
  const chunks = bytesToBase64Chunks(bytes);
  if (chunks.length === 0) {
    chunks.push({ offset: 0, dataB64: '' });
  }
  const sendChunk = async (offset: number, dataB64: string) => {
    const uploadResp = await fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/fs/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ toPath, dataB64, offset }),
    });
    const body = (await uploadResp.json().catch(() => ({}))) as { ok?: unknown; error?: unknown; code?: unknown };
    return { uploadResp, body };
  };
  // P2-2：409 只证明「目标存在」不证明完整——上次载入中断可留半截文件，
  // 静默跳过会让用户选到残缺 csv 在远处炸出难归因的解析错。demo-data/
  // 命名空间由本装载器管理：删残留后重传当前分片一次自愈；删除失败或
  // 再次 409 = 维持幂等跳过语义。
  let healed = false;
  for (const { offset, dataB64 } of chunks) {
    const { uploadResp, body: data } = await sendChunk(offset, dataB64);
    if (uploadResp.ok && data?.ok) continue;
    if (data?.code === 'target_already_exists') {
      if (!healed) {
        healed = true;
        const delResp = await fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/fs/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ paths: [toPath] }),
        });
        if (delResp.ok) {
          const retry = await sendChunk(offset, dataB64);
          if (retry.uploadResp.ok && retry.body?.ok) continue;
          if (retry.body?.code !== 'target_already_exists') {
            throw new Error(typeof retry.body?.error === 'string' && retry.body.error ? retry.body.error : `示例文件写入失败（${retry.uploadResp.status}）`);
          }
        }
      }
      return 'skipped';
    }
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : `示例文件写入失败（${uploadResp.status}）`);
  }
  return 'loaded';
}

/** 把工具的 demo 输入文件一键落到当前项目工作区（清单为空时零网络写、零副作用）。 */
export async function loadDemoDataIntoWorkspace(projectId: string, toolId: string): Promise<DemoLoadSummary> {
  const names = await listDemoFiles(toolId);
  const summary: DemoLoadSummary = { listed: names.length, loaded: 0, skipped: 0 };
  for (const name of names) {
    const outcome = await uploadDemoFile(projectId, toolId, name);
    if (outcome === 'loaded') summary.loaded += 1;
    else summary.skipped += 1;
  }
  return summary;
}
