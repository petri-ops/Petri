// ============================================================
// imageReferences.ts — BLOCK-52 P2「图片/结果图引用」纯函数助手
//
// 职责：imageQuote 事件载荷 → composer 图片引用卡状态管理 + 发送时把
// artifact 元数据渲染进消息正文（模型据此调 read_image 看图 /
// result_studio_context 绑定当前结果改参重跑）。不做 React / IPC /
// 事件订阅（那些分别住在 SimpleChat.tsx、WorkspaceFilePreview 与
// ResultView）。
//
// 数据流：
//   WorkspaceFilePreview（静态图）/ ResultView（结果图）--imageQuote-->
//   SimpleChat appendImageReference --> 引用卡列表
//   发送时 composeMessageWithImageReferences(text, refs) --> 消息正文
// ============================================================

import type { ImageQuoteArtifact, ImageQuoteDetail } from '@/lib/events';

/** 单个图片引用卡（composer 卡片状态 + 发送渲染输入）。 */
export interface ImageReference {
  id: string;
  /** 引用来源：工作区静态图片文件（无血统）/ Result Studio 结果图（带血统）。 */
  kind: ImageQuoteDetail['kind'];
  /** 图片名（卡片显示用）。 */
  name: string;
  /** workspace 相对路径（kind=workspace-file 时提供，供模型按路径读图）。 */
  path?: string;
  /** 图片 src（卡片缩略图直接显示）。 */
  url: string;
  /** artifact 血统（kind=result-artifact 时提供）。 */
  artifact?: ImageQuoteArtifact;
}

/** composer 图片引用卡数量上限——防误操作连点刷屏（比文字引用更占视觉空间，取小值）。 */
export const MAX_IMAGE_REFERENCES = 4;

let seq = 0;
function nextId(): string {
  seq += 1;
  return `imgref-${Date.now()}-${seq}`;
}

/** 由 imageQuote 事件载荷创建图片引用卡（无效载荷返回 null）。 */
export function makeImageReference(detail: ImageQuoteDetail): ImageReference | null {
  const name = detail.name?.trim();
  const url = detail.url?.trim();
  if (!name || !url) return null;
  const kind = detail.kind === 'result-artifact' ? 'result-artifact' : 'workspace-file';
  const path = detail.path?.trim() || undefined;
  const artifact = kind === 'result-artifact' && detail.artifact?.toolJobId
    ? { ...detail.artifact }
    : undefined;
  // 血统不完整的结果图引用降级为普通图片引用（没有 toolJobId 模型无法读图）。
  if (kind === 'result-artifact' && !artifact) return null;
  return {
    id: nextId(),
    kind,
    name,
    path: kind === 'workspace-file' ? path : undefined,
    url,
    artifact,
  };
}

/**
 * 追加一个图片引用卡：上限截断 + 与上一条完全同源
 * （同 kind + 同名 + 同 revisionId/path）时去重。返回新数组；无效载荷原样返回。
 */
export function appendImageReference(
  prev: ImageReference[],
  detail: ImageQuoteDetail,
): ImageReference[] {
  const ref = makeImageReference(detail);
  if (!ref) return prev;
  const last = prev[prev.length - 1];
  if (
    last
    && last.kind === ref.kind
    && last.name === ref.name
    && last.path === ref.path
    && last.artifact?.revisionId === ref.artifact?.revisionId
  ) {
    return prev;
  }
  return [...prev, ref].slice(-MAX_IMAGE_REFERENCES);
}

/** 引用卡的来源行文案：`Result Studio 结果图 · rev #3` / workspace 相对路径。 */
export function imageReferenceSourceLine(ref: ImageReference): string {
  if (ref.kind === 'result-artifact') {
    const ordinal = ref.artifact?.revisionOrdinal;
    return `Result Studio 结果图${ordinal ? ` · rev #${ordinal}` : ''}`;
  }
  return ref.path || ref.name;
}

/**
 * 发送时把图片引用卡渲染成消息正文前缀（引用块在前、用户文本在后）。
 * 元数据行对模型可见：结果图给 read_image 的 toolJobId 定位 + 血统交叉核对
 * 字段；静态图给 workspace 路径。无引用时原样返回，零干扰。
 * 注意：引用头用全角【】而非 []——服务端落库会剥掉行首半角 [...] 前缀
 * （chat.js cleanContent legacy 正则），[] 会导致落库消息缺头 + 前后端重复渲染。
 */
export function composeMessageWithImageReferences(
  raw: string,
  refs: ImageReference[],
): string {
  if (refs.length === 0) return raw;
  const block = refs
    .map((ref) => {
      const lines = [`【引用图片 ${ref.name}】`, `> 来源：${imageReferenceSourceLine(ref)}`];
      if (ref.kind === 'result-artifact' && ref.artifact) {
        const { toolJobId, revisionId, artifactId, revisionOrdinal } = ref.artifact;
        const meta = [
          `toolJobId=${toolJobId}`,
          revisionOrdinal ? `revisionOrdinal=${revisionOrdinal}` : '',
          revisionId ? `revisionId=${revisionId}` : '',
          artifactId ? `artifactId=${artifactId}` : '',
        ].filter(Boolean).join(' ');
        lines.push(`> artifact: ${meta}`);
      } else if (ref.path) {
        lines.push(`> path: ${ref.path}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
  return `${block}\n\n${raw}`;
}
