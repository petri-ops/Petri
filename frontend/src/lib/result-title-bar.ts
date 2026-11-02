// BLOCK-334 — 中央 result/code/compare/history 四态退役后，标题不再按工作区模式拼
// 「· 结果/代码/…」后缀；判据改为「右栏结果 tab 是否激活且有产物」。项目名始终在场
// （UI-181：用户任何时候都要看见自己在哪个项目）。
export function buildResultTitleBarTitle(
  resultsActive: boolean,
  projectTitle: string | null | undefined,
  artifactTitle?: string | null,
): string {
  const project = projectTitle || '梳理开发进展';
  if (!resultsActive || !artifactTitle) return project;
  return `${artifactTitle} · ${project}`;
}
