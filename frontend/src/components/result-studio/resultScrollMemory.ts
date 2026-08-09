/**
 * P4R-2: result↔chat 跨切换的滚动位置保持。
 *
 * `.resultView` 是 ResultArtifactShell 的滚动容器（`overflow:auto`）。result
 * 投影层在 chat 模式下条件渲染卸载，重新进入时滚动位置丢失。chat 侧的
 * `sc-messages` 因 SimpleChat 常驻（`8e58f98`）天然保持，故本模块只服务 result 侧。
 *
 * 存储按 jobId 隔离：切换 job 视为新一轮，重置；切换 workspaceMode（result↔chat）
 * 不重置，因为 job 没变。模块级 Map 而非 props 链路，避免改动
 * ResultView/CenterPanel/ctx；ResultArtifactShell 重新挂载时仍能按 job.id 取回。
 *
 * 只对 result↔chat 验证（计划 §P4R-2）：code/history 不在 WorkspaceMode 内，
 * compare 与 result 渲染相同，对应验证随 P4R-4/P4R-5 补齐。
 */

const scrollMemory = new Map<string, number>();

/** Read the last recorded scrollTop for a job (0 when never recorded). */
export function getResultScrollPosition(jobId: string | null | undefined): number {
  if (!jobId) return 0;
  return scrollMemory.get(jobId) ?? 0;
}

/** Record the current scrollTop for a job. No-op for null/missing ids. */
export function setResultScrollPosition(jobId: string | null | undefined, scrollTop: number): void {
  if (!jobId) return;
  scrollMemory.set(jobId, scrollTop);
}

/** Drop the recorded position for a job (e.g. when the job itself is removed). */
export function clearResultScrollPosition(jobId: string | null | undefined): void {
  if (!jobId) return;
  scrollMemory.delete(jobId);
}

/** Test-only: reset all memory. Not wired to production. */
export function __resetResultScrollMemoryForTest(): void {
  scrollMemory.clear();
}
