// BLOCK-92 Wave B-1 — 右栏 tab 词表外迁；BLOCK-216 Q5 改为 work-surface 注册表
// 驱动（标签/图标/顺序单源在 lib/workSurface/registry.ts），本文件只保留类型边界。
// 原导出路径 '@/pages/project-workspace' 经页面 re-export 保持兼容。

type CoreRightPanelMode =
  | 'home'
  | 'results'
  | 'files'
  | 'generated'
  | 'browser'
  | 'analyze'
  | 'review'
  | 'io'
  | 'jobs'
  | 'agent'
  | 'plan'
  | 'evidence';

/** Core modes + pack view ids (`pack:<packId>:<viewId>`). */
export type RightPanelMode = CoreRightPanelMode | `pack:${string}`;
