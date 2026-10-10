import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PERSISTED_ENTITY_IDS,
  buildRowSelection,
  summarizeSelectionForAgent,
  type ArtifactInteractionManifest,
} from '@/lib/artifact-selection';
import { petriEvents, subscribePetriEvent } from '@/lib/events';
import {
  getSelectionBusState,
  setSelectionBusArtifact,
  setSelectionBusSelection,
  subscribeSelectionBus,
  useSelectionBus,
  type SelectionBusState,
} from '@/lib/selectionBus';

// ============================================================================
// 红侧契约测试 — BLOCK-139 P0-1 选择总线（plan=docs/block-139-selection-loop-plan.md）
//
// 被钉裁决（此刻尚无实现，测试必须真实失败于「模块不存在」）：
// - D1 总线形态：lib 层自定义 store hook（useState + petriEvents 广播）；
//   单选择真相=「当前活跃 artifact 的当前选择」；切换 artifact 即换选择上下文。
// - D3 有界不变量：MAX_PERSISTED_ENTITY_IDS=2000 / Agent 样本 12，前端不得放宽。
// - plan §2 P0-1：产出结构化 SelectionContext v1 投影——词汇表镜像
//   artifact-selection.ts（后端为权威），不造第二套词汇。
//
// 契约 API 面（实现须落在此形状；测试钉行为不钉内部结构）：
//   getSelectionBusState(): SelectionBusState
//   setSelectionBusArtifact({ artifactId, revisionId }): void
//   setSelectionBusSelection(selection: ArtifactSelection | null): void
//   subscribeSelectionBus(listener): () => void
//   useSelectionBus(): SelectionBusState          // React hook
//   petriEvents.selectionBus                        // events.ts 注册表键（PetriEventMap 同步登记）
//   interface SelectionBusState {
//     artifactId: string;                          // '' = 未绑定活跃 artifact
//     revisionId: string | null;
//     selection: ArtifactSelection | null;
//     agentProjection: AgentSelectionSummary | null; // 恒等 summarizeSelectionForAgent(selection)
//   }
// ============================================================================

function manifestFor(artifactId: string, rowCount: number): ArtifactInteractionManifest {
  return {
    interactionVersion: 1,
    artifactId,
    revisionId: 'rev_1',
    artifactKind: 'table',
    entityType: 'gene',
    idField: 'gene',
    idStrategy: 'declared_column',
    selectionDurable: true,
    columns: [{ field: 'gene' }, { field: 'padj' }],
    totalRowCount: rowCount,
    capabilities: ['row_select', 'filter', 'sort'],
    interactionMode: 'table',
    mapping: { artifactId, mode: 'table', entityType: 'gene', idField: 'gene' },
  };
}

function rows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    gene: `G${index}`,
    padj: String(index / 1000),
  }));
}

function bindArtifact(artifactId: string): void {
  setSelectionBusArtifact({ artifactId, revisionId: 'rev_1' });
}

beforeEach(() => {
  // 单例 store 的测试间归位：清活跃上下文与选择（「清除无条件可行」本身是总线契约）。
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
  setSelectionBusSelection(null);
});

describe('BLOCK-139 P0-1 选择总线（D1 单选择真相）', () => {
  it('初始为空真相：未绑定 artifact、无选择、无 Agent 投影', () => {
    const state = getSelectionBusState();
    expect(state.artifactId).toBe('');
    expect(state.revisionId).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.agentProjection).toBeNull();
  });

  it('setSelectionBusArtifact 建立当前活跃 artifact 上下文', () => {
    bindArtifact('deg_table');
    const state = getSelectionBusState();
    expect(state.artifactId).toBe('deg_table');
    expect(state.revisionId).toBe('rev_1');
  });

  it('单选择真相：后写替换先写，读取面只有一份当前选择', () => {
    bindArtifact('deg_table');
    const first = buildRowSelection(manifestFor('deg_table', 4), rows(2)).selection;
    const second = buildRowSelection(manifestFor('deg_table', 4), rows(3)).selection;
    setSelectionBusSelection(first);
    setSelectionBusSelection(second);
    const state = getSelectionBusState();
    expect(state.selection).toEqual(second);
  });

  it('跨 viewer 共享：subscribeSelectionBus 订阅者收到与读取面一致的状态', () => {
    bindArtifact('volcano');
    const received: SelectionBusState[] = [];
    const unsubscribe = subscribeSelectionBus((state: SelectionBusState) => received.push(state));
    const selection = buildRowSelection(manifestFor('volcano', 4), rows(2)).selection;
    setSelectionBusSelection(selection);
    unsubscribe();
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1]).toEqual(getSelectionBusState());
    expect(received[received.length - 1].selection).toEqual(selection);
  });

  it('切换 artifact 即换选择上下文：旧 artifact 的选择不泄漏进新 artifact 的读取面', () => {
    bindArtifact('deg_table');
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table', 4), rows(3)).selection);
    expect(getSelectionBusState().selection).not.toBeNull();
    // 切换活跃 artifact：新上下文里要么无选择，要么是新 artifact 自己的选择。
    setSelectionBusArtifact({ artifactId: 'volcano', revisionId: null });
    const state = getSelectionBusState();
    expect(state.artifactId).toBe('volcano');
    expect(state.selection === null || state.selection.artifactId === 'volcano').toBe(true);
    expect(state.selection?.artifactId).not.toBe('deg_table');
  });

  it('清除选择（null）无条件回到该上下文的空选择', () => {
    bindArtifact('deg_table');
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table', 4), rows(2)).selection);
    setSelectionBusSelection(null);
    expect(getSelectionBusState().selection).toBeNull();
    expect(getSelectionBusState().agentProjection).toBeNull();
  });
});

describe('BLOCK-139 P0-1 SelectionContext v1 投影（词汇镜像，不造第二套词汇）', () => {
  it('agentProjection 逐字段恒等 summarizeSelectionForAgent 的产物', () => {
    bindArtifact('deg_table');
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table', 6), rows(5)).selection);
    const state = getSelectionBusState();
    expect(state.agentProjection).toEqual(summarizeSelectionForAgent(state.selection));
    // 恒等断言之外补字面量期望（评审 Minor：同函数自证钉不出投影正确性，
    // 相邻用例的字段断言 + 此处样本列字面量共同补强）。
    expect(state.agentProjection!.sampleEntityIds).toEqual(['G0', 'G1', 'G2', 'G3', 'G4']);
  });

  it('Agent 投影携带实体坐标：artifactId / revisionId / entityType / origin / 计数', () => {
    bindArtifact('deg_table');
    setSelectionBusSelection(buildRowSelection(manifestFor('deg_table', 6), rows(5)).selection);
    const projection = getSelectionBusState().agentProjection;
    expect(projection).not.toBeNull();
    expect(projection!.artifactId).toBe('deg_table');
    expect(projection!.revisionId).toBe('rev_1');
    expect(projection!.entityType).toBe('gene');
    expect(projection!.origin).toBe('row_select');
    expect(projection!.entityIdCount).toBe(5);
  });
});

describe('BLOCK-139 P0-1 D3 有界不变量（前端不得放宽）', () => {
  it('超大选择：持久面 ≤ MAX_PERSISTED_ENTITY_IDS、Agent 样本 ≤ 12、计数如实不因截断说谎', () => {
    bindArtifact('big_table');
    const total = 2500;
    setSelectionBusSelection(buildRowSelection(manifestFor('big_table', total), rows(total)).selection);
    const state = getSelectionBusState();
    expect(state.selection!.entityIds.length).toBeLessThanOrEqual(MAX_PERSISTED_ENTITY_IDS);
    expect(state.selection!.entityIdsTruncated).toBe(true);
    expect(state.selection!.entityIdCount).toBe(total);
    expect(state.agentProjection!.sampleEntityIds.length).toBeLessThanOrEqual(12);
    expect(state.agentProjection!.entityIdCount).toBe(total);
    expect(state.agentProjection!.truncated).toBe(true);
  });
});

describe('BLOCK-139 P0-1 petriEvents 事件模式延伸（D1）', () => {
  it('events.ts 注册表登记 selectionBus 键；写入选择经 window 事件广播', () => {
    expect(typeof petriEvents.selectionBus).toBe('string');
    bindArtifact('deg_table');
    const received: SelectionBusState[] = [];
    const unsubscribe = subscribePetriEvent(petriEvents.selectionBus, (detail) => {
      received.push(detail);
    });
    const selection = buildRowSelection(manifestFor('deg_table', 4), rows(2)).selection;
    setSelectionBusSelection(selection);
    unsubscribe();
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].selection).toEqual(selection);
  });
});

describe('BLOCK-139 P0-1 useSelectionBus hook（React 消费面）', () => {
  it('hook 返回当前总线状态并随写入刷新', () => {
    const { result } = renderHook(() => useSelectionBus());
    expect(result.current.selection).toBeNull();
    act(() => {
      setSelectionBusArtifact({ artifactId: 'deg_table', revisionId: 'rev_1' });
      setSelectionBusSelection(buildRowSelection(manifestFor('deg_table', 4), rows(3)).selection);
    });
    expect(result.current.artifactId).toBe('deg_table');
    expect(result.current.selection).toEqual(getSelectionBusState().selection);
    expect(result.current.agentProjection).toEqual(summarizeSelectionForAgent(result.current.selection));
  });
});
