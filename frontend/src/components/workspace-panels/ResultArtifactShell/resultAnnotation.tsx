import React from 'react';
import { AnnotatableImagePane } from '@/components/annotations/AnnotatableImagePane';
import { AnnotatablePdfPane } from '@/components/annotations/AnnotatablePdfPane';
import { dispatchPetriEvent, petriEvents, type ImageQuoteArtifact } from '@/lib/events';
import type { AnnotationScope, AnnotationTaskTarget } from '@/lib/annotations';
import styles from '@/pages/project-workspace.module.css';
import type { ArtifactRevision } from '@/components/result-studio/resultStudioClient';

/**
 * resultAnnotation.tsx — BLOCK-219 Q6 结果面批注接线（从 1329 行的 shell 抽出）。
 *
 * 抽出理由：`ResultArtifactShell` 已在 code-size 预算例外里，批注接线若内联会
 * 抬高棘轮基线；把「身份推导 + 两个宿主 + 不可批注提示」搬进本文件，shell 只留
 * 一行 props 与两个宿主标签。
 *
 * 身份纪律：结果产物批注的权威坐标是 (artifactId, revisionId)。缺 artifactId
 * 时 scope=null → 条上只显示原因，不伪造可写入口。
 */

export interface ResultAnnotationProps {
  scope: AnnotationScope | null;
  target: AnnotationTaskTarget;
}

export function buildResultAnnotationProps(input: {
  projectId: string;
  revision: ArtifactRevision | null;
  jobId: string | null;
  artifactName: string | null;
}): ResultAnnotationProps {
  const revision = input.revision;
  return {
    scope: revision?.artifactId
      ? {
        projectId: input.projectId,
        surface: 'result-artifact',
        artifactId: revision.artifactId,
        revisionId: revision.revisionId ?? null,
      }
      : null,
    target: {
      surface: 'result-artifact',
      artifactId: revision?.artifactId ?? null,
      revisionId: revision?.revisionId ?? null,
      artifactName: input.artifactName,
      revisionOrdinal: revision?.revisionOrdinal ?? null,
      jobId: revision?.toolJobId || input.jobId,
    },
  };
}

/**
 * 结果图预览整块（BLOCK-52 P2「引用到对话」+ BLOCK-219 Q6 批注）。
 *
 * 从 shell 的 `renderPreview` 抽出：这两件事都只对图像产物成立，搬进来后 shell
 * 的 image 分支只剩一次组件调用，也不再单独持有 quote 派发函数。
 */
export function ResultImagePreview({
  url,
  alt,
  name,
  projectId,
  artifact,
  conversationId,
  scope,
  target,
  onAddToContext,
  onLightbox,
  onImageLoad,
  onImageError,
}: {
  url: string;
  alt: string;
  name: string;
  projectId: string;
  artifact: ImageQuoteArtifact;
  conversationId: string | null;
  onAddToContext: (prompt: string) => void;
  onLightbox: () => void;
  onImageLoad: () => void;
  onImageError: () => void;
} & ResultAnnotationProps): React.ReactElement {
  const quote = () => {
    dispatchPetriEvent(petriEvents.imageQuote, {
      projectId,
      kind: 'result-artifact',
      name,
      url,
      artifact,
    });
  };
  return (
    <div className={styles.resultPreviewImageColumn}>
      <div className={styles.workspaceMarkdownDiffActions}>
        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={quote} title="把这张结果图引用到对话">
          引用到对话
        </button>
      </div>
      <div className={styles.resultPreviewImageCanvas}>
        <AnnotatedResultImage
          url={url}
          alt={alt}
          conversationId={conversationId}
          onOpenImage={onLightbox}
          onImageLoad={onImageLoad}
          onImageError={onImageError}
          onAddToContext={onAddToContext}
          scope={scope}
          target={target}
        />
      </div>
    </div>
  );
}

function AnnotatedResultImage({
  url,
  alt,
  scope,
  target,
  conversationId,
  onOpenImage,
  onImageLoad,
  onImageError,
  onAddToContext,
}: {
  url: string;
  alt: string;
  conversationId: string | null;
  onOpenImage: () => void;
  onImageLoad: () => void;
  onImageError: () => void;
  onAddToContext: (prompt: string) => void;
} & ResultAnnotationProps): React.ReactElement {
  return (
    <AnnotatableImagePane
      src={url}
      alt={alt}
      onOpenImage={onOpenImage}
      onImageLoad={onImageLoad}
      onImageError={onImageError}
      scope={scope}
      conversationId={conversationId}
      target={target}
      onAddToContext={onAddToContext}
    />
  );
}

export function AnnotatedResultPdf({
  url,
  name,
  scope,
  target,
  conversationId,
  onAddToContext,
}: {
  url: string;
  name: string;
  conversationId: string | null;
  onAddToContext: (prompt: string) => void;
} & ResultAnnotationProps): React.ReactElement {
  return (
    <AnnotatablePdfPane
      url={url}
      name={name}
      scope={scope}
      conversationId={conversationId}
      target={target}
      onAddToContext={onAddToContext}
    />
  );
}

/** 该格式不支持批注时的诚实说明（表格/二进制产物共用）。 */
export function AnnotationUnavailableNote(): React.ReactElement {
  return (
    <span className={styles.resultAnnotationUnavailable} data-testid="annotation-unavailable-hint">
      该格式暂不支持批注：批注只支持 PDF 与图像。
    </span>
  );
}
