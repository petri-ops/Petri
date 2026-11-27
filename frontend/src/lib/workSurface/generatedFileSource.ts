import type { ConversationFileChange } from '@/components/copilot/conversationChangesStore';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

type GeneratedFileEvidenceState = 'workspace' | 'tool-record' | 'both' | 'none';
export type GeneratedFilesPanelState = 'loading' | 'error' | 'empty' | 'ready';

export interface GeneratedFileSource {
  path: string;
  status: 'created' | 'modified';
  tool?: string;
  iteration?: number;
  workspaceAvailable: boolean;
  toolRecordAvailable: boolean;
  toolRecordContent?: string;
  toolRecordTruncated?: boolean;
  toolRecordReason?: 'no_write_activity' | 'tool_result_has_no_content';
  evidenceState: GeneratedFileEvidenceState;
}

const WRITE_TOOLS = new Set(['workspace_write', 'workspace_replace', 'workspace_append']);

function readPathFromResultData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['path', 'filePath', 'file_path', 'relativePath', 'relative_path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readContentFromResultData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['content', 'text', 'preview', 'writtenContent', 'written_content']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function activityMatchesPath(activity: ToolActivityItem, path: string): boolean {
  if (!WRITE_TOOLS.has(activity.name)) return false;
  const fromResult = readPathFromResultData(activity.resultData);
  if (fromResult === path) return true;
  const detail = activity.actionDetail || '';
  return detail.includes(path);
}

export function resolveGeneratedFileSource(input: {
  change: ConversationFileChange;
  activities?: readonly ToolActivityItem[];
  workspaceAvailable?: boolean;
}): GeneratedFileSource {
  const { change, activities = [], workspaceAvailable = true } = input;
  const latest = activities
    .filter((activity) => activityMatchesPath(activity, change.path))
    .slice()
    .reverse()
    .find((activity) => readContentFromResultData(activity.resultData) !== null)
    || activities
      .filter((activity) => activityMatchesPath(activity, change.path))
      .slice()
      .reverse()[0];

  const content = latest ? readContentFromResultData(latest.resultData) : null;
  const toolRecordAvailable = content !== null;
  const evidenceState: GeneratedFileEvidenceState = workspaceAvailable && toolRecordAvailable
    ? 'both'
    : workspaceAvailable
      ? 'workspace'
      : toolRecordAvailable
        ? 'tool-record'
        : 'none';

  return {
    path: change.path,
    status: change.status,
    ...(change.tool ? { tool: change.tool } : {}),
    ...(typeof change.iteration === 'number' ? { iteration: change.iteration } : {}),
    workspaceAvailable,
    toolRecordAvailable,
    ...(content !== null ? { toolRecordContent: content } : {}),
    ...(content !== null && latest?.truncated ? { toolRecordTruncated: true } : {}),
    ...(!toolRecordAvailable ? {
      toolRecordReason: latest ? 'tool_result_has_no_content' : 'no_write_activity',
    } : {}),
    evidenceState,
  };
}

export function resolveGeneratedFilesPanelState(input: {
  loading: boolean;
  error?: string | null;
  fileCount: number;
  /** item 85 — 生成产物（视频等）数量：也算面板内容，空态只看两边都为空 */
  generatedArtifactCount?: number;
}): GeneratedFilesPanelState {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  if (input.fileCount === 0 && (input.generatedArtifactCount ?? 0) === 0) return 'empty';
  return 'ready';
}

// ============================================================
// item 85 — 文件面板的生成视频产物
//
// generate.* 产物落在 <dataDir>/generated（非 workspace），不进 files_changed
// 权威清单；此处从 run.toolActivities 的 resultData 描述符（item 83 补的
// /api/generated/ url 单一真值）归一化出视频产物，供生成文件面内嵌预览
// 与一键系统播放器打开。只认受控读面 URL，fail-closed。
// ============================================================

export interface GeneratedVideoArtifact {
  name: string;
  /** 落盘绝对路径（系统播放器 openPath 用） */
  path: string;
  /** API 相对 url（/api/generated/file/video/...，预览供给唯一真值） */
  url: string;
}

const GENERATED_VIDEO_URL_RE = /^\/api\/generated\/file\/video\//;
const GENERATED_ARTIFACT_URL_RE = /^\/api\/generated\/file\/(image|video|model3d|html)\//;

/** 项目工作区产物 URL 没有 kind 段，按路径扩展名归类（含 .scene3d.json）。 */
function artifactKindFromPath(p: string): GeneratedArtifactKind | null {
  if (/\.scene3d\.json$/i.test(p)) return 'model3d';
  const ext = p.toLowerCase().split('.').pop() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['glb', 'gltf'].includes(ext)) return 'model3d';
  if (['html', 'htm'].includes(ext)) return 'html';
  return null;
}

type GeneratedArtifactKind = 'image' | 'video' | 'model3d' | 'html';

export interface GeneratedArtifact {
  kind: GeneratedArtifactKind;
  name: string;
  path: string;
  url: string;
}

/** item83 返工：四类 generate.* 产物统一从受控读面描述符归一化进文件面板。 */
export function generatedArtifactsFromActivities(activities: readonly ToolActivityItem[]): GeneratedArtifact[] {
  const byUrl = new Map<string, GeneratedArtifact>();
  for (const activity of activities || []) {
    if (activity.status !== 'success') continue;
    const items = Array.isArray(activity.resultData) ? activity.resultData : [activity.resultData];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const d = raw as Record<string, unknown>;
      if (typeof d.path !== 'string' || typeof d.url !== 'string') continue;
      const match = GENERATED_ARTIFACT_URL_RE.exec(d.url);
      const kind = match
        ? match[1] as GeneratedArtifactKind
        : (d.url.startsWith('/api/workspaces/') ? artifactKindFromPath(d.path) : null);
      if (!kind || byUrl.has(d.url)) continue;
      const name = d.path.split(/[\\/]/).pop() || '';
      byUrl.set(d.url, { kind, name, path: d.path, url: d.url });
    }
  }
  return [...byUrl.values()];
}
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function videoExtensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** API 相对 /api/... url → 后端绝对地址（与 ChatArtifactCard.generatedApiUrl 同形，不引 copilot 模块）。 */
export function absoluteGeneratedFileUrl(url: string, apiPrefix: string): string {
  if (!url.startsWith('/api/')) return '';
  return `${apiPrefix}${url.slice(4)}`;
}

export function generatedVideoArtifactsFromActivities(
  activities: readonly ToolActivityItem[]
): GeneratedVideoArtifact[] {
  const byUrl = new Map<string, GeneratedVideoArtifact>();
  for (const activity of activities) {
    if (activity.status !== 'success') continue;
    const items = Array.isArray(activity.resultData) ? activity.resultData : [activity.resultData];
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const descriptor = raw as Record<string, unknown>;
      if (typeof descriptor.path !== 'string' || typeof descriptor.url !== 'string') continue;
      const name = descriptor.path.split(/[\\/]/).pop() || '';
      // item83 第三轮：85 面板供给链必须同时认 legacy /api/generated 与新项目工作区 URL。
      const isWorkspaceVideo = descriptor.url.startsWith('/api/workspaces/')
        && VIDEO_FILE_EXTENSIONS.has(videoExtensionOf(name));
      if ((!GENERATED_VIDEO_URL_RE.test(descriptor.url) && !isWorkspaceVideo) || byUrl.has(descriptor.url)) continue;
      if (!VIDEO_FILE_EXTENSIONS.has(videoExtensionOf(name))) continue;
      byUrl.set(descriptor.url, { name, path: descriptor.path, url: descriptor.url });
    }
  }
  return [...byUrl.values()];
}
