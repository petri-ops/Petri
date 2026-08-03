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
  if (!modeLabel) return project;
  return artifactTitle ? `${artifactTitle} · ${modeLabel}` : modeLabel;
}
