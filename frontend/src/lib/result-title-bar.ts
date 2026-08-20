export type ResultTitleBarMode = 'chat' | 'result' | 'code' | 'compare' | 'history' | string;

const MODE_LABELS: Record<string, string> = {
  result: '结果',
  code: '代码',
  compare: '审查修改',
  history: '版本历史',
};

export function buildResultTitleBarTitle(
  mode: ResultTitleBarMode,
  projectTitle: string | null | undefined,
  artifactTitle?: string | null,
): string {
  const project = projectTitle || '梳理开发进展';
  const modeLabel = MODE_LABELS[mode];
  // chat mode (or any unrecognized mode) keeps project identity front-and-center
  // so the user always sees WHICH project they're in. handleOpenResult preserves
  // 'chat' on auto-open from HomePage; 'scheduled' / 'search' / 'plugins' / null
  // never end up here because ProjectWorkspace normalizes to 'chat' via T85.
  if (!modeLabel) return project;
  // Result/code/compare/history mode: artifact name dominates, project name
  // remains visible as the secondary context marker.
  return artifactTitle ? `${artifactTitle} · ${modeLabel} · ${project}` : `${modeLabel} · ${project}`;
}
