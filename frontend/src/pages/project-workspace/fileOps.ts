// ============================================================
// fileOps — BLOCK-89 / UI-378 工作区文件操作前端助手。
// REST 面：POST /api/workspaces/:id/fs/move|copy|delete|mkdir（本地/ssh 双后端同构，
// 前端零感知 workspaceKind）。冲突语义：服务端 409 target_already_exists；
// 拖拽落点由 uniqueTargetName 预检自动 -2 后缀（对齐服务端 import 房风）。
// ============================================================
import { getApiPrefix } from '@/lib/authClient';

export type FileOpAction = 'move' | 'copy' | 'delete' | 'mkdir' | 'upload' | 'import-from';

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: number;
}

/** 拖拽荷载（dataTransfer 内传输的最小条目描述）。 */
export interface DraggedTreeItem {
  path: string;
  name: string;
  type: 'file' | 'dir';
}

async function fsOp(
  projectId: string,
  action: FileOpAction,
  payload: Record<string, unknown>,
): Promise<{ ok: true; entry?: { type: string; size?: number; mtimeMs?: number }; removed?: number }> {
  const resp = await fetch(
    `${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/fs/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const raw = (await resp.json().catch(() => ({ ok: false, error: `请求失败（${resp.status}）` }))) as Record<string, unknown>;
  if (!resp.ok || !raw.ok) {
    throw new Error(typeof raw.error === 'string' && raw.error ? raw.error : `操作失败（${resp.status}）`);
  }
  return raw as { ok: true; entry?: { type: string; size?: number; mtimeMs?: number }; removed?: number };
}

export function fsMove(projectId: string, fromPath: string, toPath: string) {
  return fsOp(projectId, 'move', { fromPath, toPath });
}

export function fsCopy(projectId: string, fromPath: string, toPath: string) {
  return fsOp(projectId, 'copy', { fromPath, toPath });
}

export function fsDelete(projectId: string, paths: string[]) {
  return fsOp(projectId, 'delete', { paths });
}

export function fsMkdir(projectId: string, path: string) {
  return fsOp(projectId, 'mkdir', { path });
}

// BLOCK-90 — OS 拖入导入：分片上传（ssh/本地同构，64KB 二进制/片，b64 后 <128KB argv 上限）。
export function fsUpload(projectId: string, toPath: string, dataB64: string, offset: number) {
  return fsOp(projectId, 'upload', { toPath, dataB64, offset });
}

// BLOCK-90 — 本地项目专属：服务端从桌面绝对路径拷入工作区（文件/目录递归，无 1MB 上限）。
export function fsImportFrom(projectId: string, sourceAbsolutePath: string, toPath: string) {
  return fsOp(projectId, 'import-from', { sourceAbsolutePath, toPath });
}

/** `a/b.txt` → { parent: 'a', name: 'b.txt' }；根级 `b.txt` → { parent: '', name: 'b.txt' }。 */
export function splitPath(path: string): { parent: string; name: string } {
  const segments = String(path || '').split('/').filter(Boolean);
  const name = segments.pop() || String(path || '');
  return { parent: segments.join('/'), name };
}

/** `parent` + `name` 拼相对路径（parent 为空 = 根）。 */
export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** 冲突自动后缀：`a.txt` → `a-2.txt`（已占则继续 -3…）；无扩展名 `dir` → `dir-2`。 */
export function uniqueTargetName(entries: FsEntry[], desired: string): string {
  const taken = new Set(entries.map((entry) => entry.name));
  if (!taken.has(desired)) return desired;
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** 重命名输入合法性：非空、不含路径分隔符、不等于原名。 */
export function validateRename(original: string, next: string): string | null {
  const trimmed = next.trim();
  if (!trimmed) return '名称不能为空';
  if (trimmed.includes('/') || trimmed.includes('\\')) return '名称不能包含路径分隔符';
  if (trimmed === original) return '名称未变化';
  return null;
}
