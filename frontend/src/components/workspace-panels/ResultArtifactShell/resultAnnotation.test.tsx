import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { subscribePetriEvent, petriEvents } from '@/lib/events';
import { ResultImagePreview, buildResultAnnotationProps } from './resultAnnotation';

/**
 * BLOCK-219 Q6 — 结果面批注接线（从 shell 抽出的身份推导 + 图像整块）。
 *
 * 这里钉两件事：
 * 1. 身份：缺 artifactId 时 scope 必须为 null（不许伪造可写批注）；
 * 2. 出口：图像整块仍保留 BLOCK-52 的「引用到对话」，且批注「加入任务」走同一回调。
 */

afterEach(cleanup);

describe('buildResultAnnotationProps', () => {
  it('有 revision 坐标时给出 scope 与 target', () => {
    const props = buildResultAnnotationProps({
      projectId: 'p1',
      revision: {
        revisionId: 'r2',
        artifactId: 'a1',
        revisionOrdinal: 2,
        toolJobId: 'job-1',
        outputPath: 'out/volcano.png',
      } as never,
      jobId: null,
      artifactName: 'volcano.png',
    });
    expect(props.scope).toEqual({
      projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r2',
    });
    expect(props.target).toMatchObject({ artifactId: 'a1', revisionId: 'r2', revisionOrdinal: 2, jobId: 'job-1' });
  });

  it('缺 artifactId 时 scope=null（不可批注），target 仍如实带 job', () => {
    const props = buildResultAnnotationProps({
      projectId: 'p1',
      revision: null,
      jobId: 'job-9',
      artifactName: 'volcano.png',
    });
    expect(props.scope).toBeNull();
    expect(props.target).toMatchObject({ artifactId: null, jobId: 'job-9' });
  });
});

describe('ResultImagePreview', () => {
  it('保留引用到对话（imageQuote），批注加入任务走 onAddToTask', () => {
    const quotes: Array<{ kind?: string; name?: string }> = [];
    const unsubscribe = subscribePetriEvent(petriEvents.imageQuote, (detail) => {
      quotes.push({ kind: detail.kind, name: detail.name });
    });
    const onAddToTask = vi.fn();
    const { getByText, getByTestId, getByLabelText } = render(
      <ResultImagePreview
        url="http://mock/volcano.png"
        alt="火山图"
        name="volcano.png"
        projectId="p1"
        artifact={{ toolJobId: 'job-1', artifactId: 'a1', revisionId: 'r2', revisionOrdinal: 2 }}
        conversationId={null}
        scope={null}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png', jobId: 'job-1' }}
        onAddToTask={onAddToTask}
        onLightbox={() => undefined}
        onImageLoad={() => undefined}
        onImageError={() => undefined}
      />,
    );

    fireEvent.click(getByText('引用到对话'));
    expect(quotes).toEqual([{ kind: 'result-artifact', name: 'volcano.png' }]);

    // scope=null：条上只给原因，不渲染可写入口
    expect(getByTestId('annotation-unavailable')).toBeTruthy();
    expect(getByLabelText('查看 火山图')).toBeTruthy();
    expect(onAddToTask).not.toHaveBeenCalled();
    unsubscribe();
  });
});
