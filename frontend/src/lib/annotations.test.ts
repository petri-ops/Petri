import { describe, expect, it } from 'vitest';
import * as annotationsModule from './annotations';
import {
  ANNOTATION_KINDS,
  ANNOTATION_KIND_LABELS,
  MAX_ANNOTATION_UNDO,
  MAX_ANNOTATIONS_IN_PROMPT,
  MOSAIC_DISCLOSURE,
  MOSAIC_SHORT,
  appendUndoAction,
  arrowHeadPoints,
  buildAnnotationTaskPrompt,
  decimatePath,
  describeAnnotationAnchor,
  describeAnnotationKind,
  mosaicTaskNote,
  normalizePointerRect,
  smoothFreehandPathD,
  pointToNormalized,
  rectToStyle,
  supportsBackdropFilter,
  undoActionLabel,
  type AnnotationUndoAction,
  type ArtifactAnnotation,
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

describe('ANNOTATION_KINDS（BLOCK-254 契约镜像）', () => {
  it('七档形态齐全（BLOCK-270 同步 C-43 契约 v2 的 freehand），且每档都有中文标签', () => {
    expect([...ANNOTATION_KINDS]).toEqual(['region', 'ellipse', 'arrow', 'text', 'mosaic', 'text-selection', 'freehand']);
    for (const kind of ANNOTATION_KINDS) {
      expect(ANNOTATION_KIND_LABELS[kind]).toBeTruthy();
      expect(describeAnnotationKind(kind)).toBe(ANNOTATION_KIND_LABELS[kind]);
    }
  });

  it('缺省/空值回落 region（旧数据不出现空标签）', () => {
    expect(describeAnnotationKind(undefined)).toBe('矩形');
    expect(describeAnnotationKind(null)).toBe('矩形');
    expect(describeAnnotationKind('region')).toBe('矩形');
  });
});

describe('撤销边界（BLOCK-254 B-2）', () => {
  const created = (id: string): AnnotationUndoAction => ({ type: 'created', annotationId: id });
  const deleted: AnnotationUndoAction = {
    type: 'deleted',
    annotation: {
      annotationId: 'ann-x',
      contractVersion: 1,
      projectId: 'p1',
      conversationId: null,
      path: [],
      surface: 'result-artifact',
      artifactId: 'a1',
      revisionId: 'r1',
      filePath: null,
      entryId: null,
      artifactName: 'volcano.png',
      kind: 'ellipse',
      page: null,
      rect: [0.2, 0.3, 0.1, 0.1],
      anchor: null,
      comment: '纵轴尺度看着不对',
      color: 'sky',
      author: 'user',
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    } satisfies ArtifactAnnotation,
  };

  it('有界：只保留最近 N 次补偿，最旧的被丢弃', () => {
    let actions: AnnotationUndoAction[] = [];
    for (let index = 0; index < MAX_ANNOTATION_UNDO + 3; index += 1) {
      actions = appendUndoAction(actions, created(`ann-${index}`));
    }
    expect(actions).toHaveLength(MAX_ANNOTATION_UNDO);
    expect(actions[actions.length - 1]).toMatchObject({ annotationId: `ann-${MAX_ANNOTATION_UNDO + 2}` });
    expect(actions.some((action) => action.type === 'created' && action.annotationId === 'ann-0')).toBe(false);
  });

  it('非法上限回落默认值（不出现空栈/无界栈）', () => {
    expect(appendUndoAction([], created('a'), 0)).toHaveLength(1);
    expect(appendUndoAction([], created('a'), -3)).toHaveLength(1);
    expect(appendUndoAction([], created('a'), Number.NaN)).toHaveLength(1);
    expect(appendUndoAction([created('a')], created('b'), 1)).toHaveLength(1);
  });

  it('文案：创建/删除区分，删除必须说明「重建为新条目」，空栈为空串', () => {
    expect(undoActionLabel(null)).toBe('');
    expect(undoActionLabel(undefined)).toBe('');
    expect(undoActionLabel(created('a'))).toContain('撤销刚才的创建');
    const label = undoActionLabel(deleted);
    expect(label).toContain('撤销刚才的删除');
    expect(label).toContain('重建为新条目');
  });

  it('边界写死：只做撤销，不导出任何 redo 面', () => {
    // 反向守卫：redo 会在这套不对称补偿（删除→重建新 id）上产生 id 漂移链，
    // 一旦有人加了 redo 导出，说明边界被悄悄扩张。
    expect(Object.keys(annotationsModule).some((key) => /redo/i.test(key))).toBe(false);
  });
});

describe('马赛克遮蔽边界（BLOCK-254 B-1）', () => {
  it('声明措辞只能是「屏显遮蔽」，不得暗示脱敏', () => {
    expect(MOSAIC_DISCLOSURE).toContain('屏显遮蔽');
    expect(MOSAIC_DISCLOSURE).toContain('不是脱敏');
    expect(MOSAIC_DISCLOSURE).toContain('不会被修改');
    // 短位与长位必须是同一句话的两种粒度，不允许各自漂移。
    expect(MOSAIC_SHORT).toContain('屏显遮蔽');
    expect(MOSAIC_SHORT).toContain('不是脱敏');
    // 反向守卫：任何"已脱敏/已打码/已移除"式承诺都不允许出现在声明里。
    expect(MOSAIC_DISCLOSURE).not.toMatch(/已脱敏|已打码|已遮蔽敏感|已移除/);
    expect(MOSAIC_SHORT).not.toMatch(/已脱敏|已打码|已遮蔽敏感|已移除/);
  });

  it('mosaicTaskNote 带条数且复用同一措辞', () => {
    const note = mosaicTaskNote(3);
    expect(note).toContain('其中 3 条');
    expect(note).toContain(MOSAIC_DISCLOSURE);
    expect(note).toContain('请勿把遮蔽区域当作已移除的敏感信息');
  });

  it('加入任务：有马赛克才追加边界声明，无马赛克零噪声', () => {
    const base = { rect: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number], path: [] as number[][], page: null, surface: 'result-artifact' as const };

    const withMosaic = buildAnnotationTaskPrompt(
      [{ ...base, comment: '遮住姓名', kind: 'mosaic' }, { ...base, comment: '离群点', kind: 'region' }],
      { surface: 'result-artifact', artifactName: 'volcano.png' },
    );
    expect(withMosaic).toContain('其中 1 条为「马赛克」标记');
    expect(withMosaic).toContain('不是脱敏');

    const withoutMosaic = buildAnnotationTaskPrompt(
      [{ ...base, comment: '离群点', kind: 'region' }],
      { surface: 'result-artifact', artifactName: 'volcano.png' },
    );
    expect(withoutMosaic).not.toContain('马赛克');
  });

  it('能力探测：支持/不支持/探测缺失都收敛到确定布尔', () => {
    expect(supportsBackdropFilter(() => true)).toBe(true);
    expect(supportsBackdropFilter(() => false)).toBe(false);
    // 只支持带前缀的实现也算支持（Safari 形态）
    expect(supportsBackdropFilter((property) => property === '-webkit-backdrop-filter')).toBe(true);
    expect(supportsBackdropFilter(null)).toBe(false);
    expect(supportsBackdropFilter(() => { throw new Error('boom'); })).toBe(false);
  });
});

describe('describeAnnotationAnchor', () => {
  it('有页号说页，无页号说区域', () => {
    expect(describeAnnotationAnchor({ page: 3, surface: 'result-artifact' })).toBe('第 3 页');
    expect(describeAnnotationAnchor({ page: null, surface: 'result-artifact' })).toBe('图像区域');
    expect(describeAnnotationAnchor({ page: null, surface: 'workspace-file' })).toBe('文件区域');
  });

  it('BLOCK-254 P5 — 文本锚点优先说行号（单行/区间两态）', () => {
    const base = {
      page: null,
      surface: 'workspace-file' as const,
      anchor: {
        kind: 'text-range' as const,
        startLine: 12,
        endLine: 12,
        startColumn: null,
        endColumn: null,
        quote: 'x',
        language: null,
      },
    };
    expect(describeAnnotationAnchor(base)).toBe('第 12 行');
    expect(describeAnnotationAnchor({ ...base, anchor: { ...base.anchor, endLine: 15 } })).toBe('第 12–15 行');
    // 没有锚点时不误报行号
    expect(describeAnnotationAnchor({ ...base, anchor: null })).toBe('文件区域');
  });

  it('BLOCK-254 P7 — 段落锚点说「段」、表格行说「表格第 N 行」', () => {
    const base = {
      page: null,
      surface: 'workspace-file' as const,
      anchor: {
        kind: 'text-range' as const,
        startLine: 5,
        endLine: 5,
        startColumn: null,
        endColumn: null,
        quote: 'Methods 段落原文',
        language: null,
      },
    };
    expect(describeAnnotationAnchor(base)).toBe('第 5 行');
    expect(describeAnnotationAnchor({ ...base, anchor: { ...base.anchor, unit: 'paragraph' } })).toBe('第 5 段');
    expect(describeAnnotationAnchor({
      ...base,
      anchor: { ...base.anchor, unit: 'paragraph', endLine: 7 },
    })).toBe('第 5–7 段');
    expect(describeAnnotationAnchor({ ...base, anchor: { ...base.anchor, unit: 'row' } })).toBe('表格第 5 行');
  });
});

describe('buildAnnotationTaskPrompt（加入任务的唯一构造点）', () => {
  const annotations = [
    { rect: [0.1, 0.2, 0.3, 0.1] as [number, number, number, number], path: [], comment: '这个离群点需要复核', page: 2, surface: 'result-artifact' as const },
    { rect: [0.5, 0.5, 0.2, 0.2] as [number, number, number, number], path: [], comment: '纵轴尺度看着不对', page: null, surface: 'result-artifact' as const },
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

  it('BLOCK-304 — 工作区文件 prompt 显式带相对路径与读取指引（Agent 可溯源打开文件）', () => {
    const prompt = buildAnnotationTaskPrompt(annotations, {
      surface: 'workspace-file',
      filePath: 'icons/icon-512.png',
    });
    expect(prompt).toContain('工作区文件「icons/icon-512.png」');
    expect(prompt).toContain('项目工作区内的相对路径');
    expect(prompt).toContain('读取文件对照批注位置');
  });

  it('BLOCK-303 — 箭头两点 path 在 prompt 里报起点→终点坐标，不报假矩形', () => {
    const prompt = buildAnnotationTaskPrompt(
      [
        { rect: [], path: [[0.2, 0.3], [0.5, 0.6]], comment: '指向峰值', page: null, surface: 'workspace-file' as const, kind: 'arrow' as const },
      ],
      { surface: 'workspace-file', filePath: 'icons/logo.png' },
    );
    expect(prompt).toContain('箭头 (20%, 30%) → (50%, 60%)：指向峰值');
    expect(prompt).not.toContain('(0%, 0%, 0%×0%)');
  });

  it('BLOCK-254 P5 — 文本锚点批注在 prompt 里报行号，不编造百分比坐标', () => {
    const prompt = buildAnnotationTaskPrompt([
      {
        rect: [],
    path: [],
        comment: '这段结论要复核',
        page: null,
        surface: 'workspace-file',
        kind: 'text-selection',
        anchor: {
          kind: 'text-range',
          startLine: 12,
          endLine: 12,
          startColumn: null,
          endColumn: null,
          quote: '结论：差异基因数目偏低',
          language: 'md',
        },
      },
    ], { surface: 'workspace-file', filePath: 'notes/plan.md' });

    expect(prompt).toContain('第 12 行：这段结论要复核');
    expect(prompt).not.toContain('(0%');
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

  it('BLOCK-270 — 契约镜像：KINDS 含 freehand，decimatePath 等距抽稀保留首尾', () => {
    expect(ANNOTATION_KINDS).toContain('freehand');
    expect(ANNOTATION_KIND_LABELS.freehand).toBe('画笔');
    const points: [number, number][] = Array.from({ length: 600 }, (_, index) => [index / 600, index / 600]);
    const thinned = decimatePath(points);
    expect(thinned.length).toBe(512);
    expect(thinned[0]).toEqual([0, 0]);
    expect(thinned[511]).toEqual([599 / 600, 599 / 600]);
    // 未超限原样返回
    const small: [number, number][] = [[0, 0], [0.5, 0.5], [1, 1]];
    expect(decimatePath(small)).toEqual(small);
  });

  it('BLOCK-270 — 画笔批注在任务 prompt 里报路径点数，不报假矩形', () => {
    const prompt = buildAnnotationTaskPrompt([
      {
        rect: [],
        path: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]],
        kind: 'freehand',
        comment: '这条曲线的走向需要复核',
        page: null,
        surface: 'result-artifact',
      },
    ], { surface: 'result-artifact', artifactName: 'volcano.png' });
    expect(prompt).toContain('画笔路径（3 个点）');
    expect(prompt).not.toContain('0%');
  });
});

describe('smoothFreehandPathD（BLOCK-288 渲染层贝塞尔平滑；存储 path 契约不变）', () => {
  it('两点=直线段 M/L', () => {
    const d = smoothFreehandPathD([[0, 0], [1, 1]]);
    expect(d).toMatch(/^M 0,0 L 100,100$/);
  });

  it('多点=二次中点平滑（M + Q 段，终点 L 收尾）', () => {
    const d = smoothFreehandPathD([[0, 0], [0.5, 0.2], [1, 0]]);
    expect(d.startsWith('M 0,0 Q')).toBe(true);
    expect(d).toContain('Q');
    expect(d.endsWith('L 100,0')).toBe(true);
    // 平滑曲线不经过中间控制点本身（与 polyline 的逐点连线不同）——Q 控制点是原始点
    expect(d).not.toContain('L 50,20');
  });

  it('少于两点=空路径；坐标按 scale 缩放保留两位小数', () => {
    expect(smoothFreehandPathD([])).toBe('');
    expect(smoothFreehandPathD([[0.12345, 0.99999]])).toBe('');
    const d = smoothFreehandPathD([[0.12345, 0.12345], [0.9, 0.9]]);
    expect(d).toBe('M 12.35,12.35 L 90,90');
  });
});

describe('arrowHeadPoints（BLOCK-303 箭头几何）', () => {
  it('头部 tip=终点、线段缩到头部底边、方向贴合拖拽方向', () => {
    const geo = arrowHeadPoints([0.2, 0.2], [0.8, 0.7]);
    expect(geo.head[0][0]).toBeCloseTo(0.8);
    expect(geo.head[0][1]).toBeCloseTo(0.7);
    // 线端沿方向往回缩（不到达终点，避免穿过三角）
    expect(geo.lineEnd[0]).toBeLessThan(0.8);
    expect(geo.lineEnd[1]).toBeLessThan(0.7);
    // 底边两点分布在方向法线两侧
    expect(geo.head[1][0]).not.toBe(geo.head[2][0]);
  });

  it('反向拖拽（终点在左上）同样成立', () => {
    const geo = arrowHeadPoints([0.8, 0.7], [0.2, 0.2]);
    expect(geo.head[0][0]).toBeCloseTo(0.2);
    expect(geo.lineEnd[0]).toBeGreaterThan(0.2);
  });

  it('零长度（同点）退化不炸', () => {
    const geo = arrowHeadPoints([0.5, 0.5], [0.5, 0.5]);
    expect(geo.head[0]).toEqual([0.5, 0.5]);
    expect(geo.lineEnd).toEqual([0.5, 0.5]);
  });
});
