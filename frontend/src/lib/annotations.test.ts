import { describe, expect, it } from 'vitest';
import {
  MAX_ANNOTATIONS_IN_PROMPT,
  buildAnnotationTaskPrompt,
  describeAnnotationAnchor,
  normalizePointerRect,
  pointToNormalized,
  rectToStyle,
} from './annotations';

describe('normalizePointerRect（BLOCK-219 Q6 批注坐标）', () => {
  it('把任意方向的拖拽归一成非负矩形', () => {
    expect(normalizePointerRect({ x: 0.6, y: 0.5 }, { x: 0.4, y: 0.4 })).toEqual([0.4, 0.4, 0.2, 0.1]);
    expect(normalizePointerRect({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.4 })).toEqual([0.2, 0.2, 0.3, 0.2]);
  });

  it('越界点被钳制到 0..1（不产生负坐标或超页矩形）', () => {
    expect(normalizePointerRect({ x: -0.5, y: 0.9 }, { x: 1.4, y: 1.2 })).toEqual([0, 0.9, 1, 0.1]);
  });

  it('误触（过小矩形）返回 null，不产生空批注', () => {
    expect(normalizePointerRect({ x: 0.2, y: 0.2 }, { x: 0.201, y: 0.2 })).toBeNull();
    expect(normalizePointerRect({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 })).toBeNull();
  });
});

describe('pointToNormalized / rectToStyle（跨缩放可复现）', () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };

  it('像素点 → 页内相对坐标', () => {
    expect(pointToNormalized(box, 300, 150)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToNormalized(box, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(pointToNormalized(box, 900, 900)).toEqual({ x: 1, y: 1 });
  });

  it('容器无尺寸时返回 null（未挂载/隐藏不产出坐标）', () => {
    expect(pointToNormalized({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toBeNull();
  });

  it('归一化矩形渲染成百分比（缩放不变）', () => {
    expect(rectToStyle([0.25, 0.5, 0.1, 0.05])).toEqual({
      left: '25.00%', top: '50.00%', width: '10.00%', height: '5.00%',
    });
  });
});

describe('describeAnnotationAnchor', () => {
  it('有页号说页，无页号说区域', () => {
    expect(describeAnnotationAnchor({ page: 3, surface: 'result-artifact' })).toBe('第 3 页');
    expect(describeAnnotationAnchor({ page: null, surface: 'result-artifact' })).toBe('图像区域');
    expect(describeAnnotationAnchor({ page: null, surface: 'workspace-file' })).toBe('文件区域');
  });
});

describe('buildAnnotationTaskPrompt（加入任务的唯一构造点）', () => {
  const annotations = [
    { rect: [0.1, 0.2, 0.3, 0.1] as [number, number, number, number], comment: '这个离群点需要复核', page: 2, surface: 'result-artifact' as const },
    { rect: [0.5, 0.5, 0.2, 0.2] as [number, number, number, number], comment: '纵轴尺度看着不对', page: null, surface: 'result-artifact' as const },
  ];

  it('携带产物身份、页/坐标、评论，并声明原始产物未被修改', () => {
    const prompt = buildAnnotationTaskPrompt(annotations, {
      surface: 'result-artifact',
      artifactName: 'volcano.png',
      revisionOrdinal: 2,
      jobId: 'job-9',
    });
    expect(prompt).toContain('结果产物「volcano.png」');
    expect(prompt).toContain('任务 job-9');
    expect(prompt).toContain('第 2 版');
    expect(prompt).toContain('2 条批注');
    expect(prompt).toContain('第 2 页 (10%, 20%, 30%×10%)：这个离群点需要复核');
    expect(prompt).toContain('图像区域 (50%, 50%, 20%×20%)：纵轴尺度看着不对');
    expect(prompt).toContain('原始产物文件未被修改');
  });

  it('工作区文件走文件措辞，不冒充结果产物', () => {
    const prompt = buildAnnotationTaskPrompt([
      { rect: [0.1, 0.1, 0.2, 0.2], comment: '第 2 页质控图异常', page: 2, surface: 'workspace-file' },
    ], { surface: 'workspace-file', filePath: 'reports/qc.pdf' });
    expect(prompt).toContain('工作区文件「reports/qc.pdf」');
    expect(prompt).not.toContain('结果产物');
  });

  it('明细有界：超过上限只报计数，不无限膨胀上下文', () => {
    const many = Array.from({ length: MAX_ANNOTATIONS_IN_PROMPT + 5 }, (_, index) => ({
      rect: [0.1, 0.1, 0.1, 0.1] as [number, number, number, number],
      comment: `批注 ${index + 1}`,
      page: null,
      surface: 'result-artifact' as const,
    }));
    const prompt = buildAnnotationTaskPrompt(many, { surface: 'result-artifact', artifactName: 'a.png' });
    expect(prompt).toContain(`1. 图像区域`);
    expect(prompt).toContain(`另有 5 条批注未逐条展开`);
    expect(prompt).not.toContain(`批注 ${MAX_ANNOTATIONS_IN_PROMPT + 1}`);
  });

  it('空评论不构造 prompt（不投递空任务）', () => {
    expect(buildAnnotationTaskPrompt([], { surface: 'result-artifact' })).toBe('');
    expect(buildAnnotationTaskPrompt([
      { rect: [0.1, 0.1, 0.1, 0.1], comment: '   ', page: null, surface: 'result-artifact' },
    ], { surface: 'result-artifact' })).toBe('');
  });
});
