// ============================================================
// workspaceFileTabOps — UI-451 文件面板多 tab 常驻的数组纯函数。
// 仿 hooks/terminalTabs.ts 先例：逻辑抽纯函数便于单测，useWorkspaceFileTabs 只做 setState 接线。
// ============================================================
import type { ActiveWorkspaceFile } from './types';

/** UI-451 加映 v2 — tab 稳定键序号（进程内唯一即可，不持久化） */
let tabSeq = 0;

/**
 * 打开（或重新打开）一个文件 tab：
 * - 新 path 追加尾部并分配稳定 tabId（keep-alive 实例 key）；
 * - 已存在 path 原位替换为新对象（顺序不变、保留既有 tabId）——预览加载 effect 依赖
 *   file 对象身份，换新对象即触发重载拉最新内容（与单文件时代「点开=拉最新」语义对齐）；
 * - tab 点击切换则必须传数组内既有对象（身份不变 → 不重载 → 未保存草稿保留）。
 */
export function openWorkspaceFileTab(
  files: ActiveWorkspaceFile[],
  file: ActiveWorkspaceFile,
): ActiveWorkspaceFile[] {
  const index = files.findIndex((item) => item.path === file.path);
  if (index === -1) return [...files, { ...file, tabId: `wftab-${(tabSeq += 1)}` }];
  const next = [...files];
  next[index] = { ...file, tabId: files[index].tabId };
  return next;
}

/**
 * UI-451 加映 v2（P1-1）— rename/move 后重定向 tab：旧 path 的 tab 原位换成新文件对象
 * （携带旧 tabId——keep-alive 实例不换、滚动/MD 视图态存活；文本按新 path 重载，内容
 * 已被 fsMove 带到新位置）。目标 path 已有另一 tab 时去重保留重定向位（唯一名预检下
 * 罕见）。oldPath 不存在（未打开）时原数组原样返回。
 */
export function renameWorkspaceFileTab(
  files: ActiveWorkspaceFile[],
  oldPath: string,
  nextFile: ActiveWorkspaceFile,
): ActiveWorkspaceFile[] {
  const index = files.findIndex((item) => item.path === oldPath);
  if (index === -1) return files;
  const carried = { ...nextFile, tabId: files[index].tabId };
  const next = [...files];
  next[index] = carried;
  const dup = next.findIndex((item, idx) => idx !== index && item.path === carried.path);
  if (dup !== -1) next.splice(dup, 1);
  return next;
}

/**
 * 批量关闭 tab。活动 tab 被关时按「第一个被关位置之后的第一个存活 tab」回退，
 * 尾部则回退到存活 tab 的最后一个——单关相邻回退语义的批量推广（closeTabs(prev,
 * active, [p]) 与原 handleCloseWorkspaceFile 逐点等价）。
 * pathsToClose 含未打开的 path 时静默忽略；一个都不命中时原数组原样返回。
 */
export function closeWorkspaceFileTabs(
  files: ActiveWorkspaceFile[],
  activePath: string | null,
  pathsToClose: string[],
): { files: ActiveWorkspaceFile[]; nextActivePath: string | null } {
  const closing = new Set(pathsToClose);
  const next = files.filter((item) => !closing.has(item.path));
  if (next.length === files.length) return { files, nextActivePath: activePath };
  let nextActivePath = activePath;
  if (activePath !== null && closing.has(activePath)) {
    const firstClosedIndex = files.findIndex((item) => closing.has(item.path));
    const survivorAfter = files
      .slice(firstClosedIndex)
      .find((item) => !closing.has(item.path));
    nextActivePath = (survivorAfter ?? next[next.length - 1])?.path ?? null;
  }
  return { files: next, nextActivePath };
}

/**
 * 拖拽重排：把 fromPath 移到「原数组 toIndex 位置元素之前」（toIndex = files.length
 * 表示追加尾部）。fromPath 不存在或位置未变化时原数组原样返回。
 */
export function moveWorkspaceFileTab(
  files: ActiveWorkspaceFile[],
  fromPath: string,
  toIndex: number,
): ActiveWorkspaceFile[] {
  const fromIndex = files.findIndex((item) => item.path === fromPath);
  if (fromIndex === -1) return files;
  const clamped = Math.min(Math.max(toIndex, 0), files.length);
  if (clamped === fromIndex || clamped === fromIndex + 1) return files;
  const next = [...files];
  const [moved] = next.splice(fromIndex, 1);
  // 移除后，目标位置在原数组中位于被移元素之后时左移一位
  next.splice(fromIndex < clamped ? clamped - 1 : clamped, 0, moved);
  return next;
}
