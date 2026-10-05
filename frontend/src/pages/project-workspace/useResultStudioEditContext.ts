import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';
import type { ResultEditSubmission } from '@/components/result-studio/ResultEditPanel';
import type { ConversationRunSnapshot } from '@/components/copilot/conversationRunStore';
import type { CopilotContext } from '@/lib/copilotContext';
import type { ResultStudioEditControls } from '@/lib/result-studio-interaction-client';
import { fetchResultStudioContext } from '@/lib/result-studio-interaction-client';
import { summarizeSelectionForAgent } from '@/lib/artifact-selection';
import { isResultStudioContextToken } from '@/lib/result-edit-agent-bridge';
import { buildResultEditCopilotAsk } from '@/lib/result-edit-agent-bridge';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import { useSelectionBus, setSelectionBusSelection } from '@/lib/selectionBus';
import { isConversationRunning } from '@/components/copilot/conversationRunStore';

// BLOCK-92 Wave B-1 — Result Studio 编辑上下文簇外迁（原 ProjectWorkspace 内联，纯搬运零行为变化）。

// G0-RS-P3: Agent 上下文就绪状态。真相来自后端 context-envelope 投影，
// 前端不自行判断"坐标是否齐备"，也不把缺失坐标伪装成可用。
interface ResultContextState {
  status: 'ready' | 'blocked' | 'loading';
  bindingKey: string;
  contextToken?: string | null;
  reason?: string | null;
  selectionUsable?: boolean;
  selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
  publicPhases?: string[];
}

interface UseResultStudioEditContextOptions {
  projectId: string | undefined;
  activeConvId: string | null;
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: Dispatch<SetStateAction<ActiveArtifact | null>>;
  activeJobId: string | null;
  activeConversationRun: ConversationRunSnapshot | null;
  setWorkspaceNotice: (notice: string) => void;
}

export function useResultStudioEditContext(options: UseResultStudioEditContextOptions): {
  resultEditBusy: boolean;
  effectiveResultContextState: ResultContextState | null;
  effectiveResultEditControls: ResultStudioEditControls | null;
  resultAgentDraft: string;
  setResultAgentDraft: (draft: string) => void;
  copilotActiveArtifact: NonNullable<CopilotContext['activeArtifact']> | null;
  handleResultEditSubmit: (submission: ResultEditSubmission) => boolean;
} {
  const {
    projectId,
    activeConvId,
    activeArtifact,
    setActiveArtifact,
    activeJobId,
    activeConversationRun,
    setWorkspaceNotice,
  } = options;

  const [resultContextState, setResultContextState] = useState<ResultContextState | null>(null);
  // G0-RS-P4: Schema 驱动控件与该 Job 真实执行过的参数值。两者都由后端
  // descriptor 投影，前端不合成控件也不用默认值冒充"当前生效值"。
  const [resultEditControls, setResultEditControls] = useState<ResultStudioEditControls | null>(null);
  const [resultEditSubmitting, setResultEditSubmitting] = useState(false);
  // P4R-3: result Composer drafts live above the conditional result surface,
  // keyed by exact result/revision/selection so result↔chat does not discard a
  // draft and a draft can never silently move onto a different context.
  const [resultAgentDrafts, setResultAgentDrafts] = useState<Record<string, string>>({});

  const resultEditBusy = resultEditSubmitting || activeConversationRun?.status === 'running';

  const activeSelectionBindingKey = useMemo(() => {
    const selection = activeArtifact?.selection;
    if (!selection) return '';
    return JSON.stringify({
      selectionId: activeArtifact?.selectionId || null,
      entityIdsHash: selection.entityIdsHash,
      filterHash: selection.filterHash || null,
      fields: selection.fields,
      sort: selection.sort,
      compatibility: selection.compatibility || null,
      createdAt: selection.createdAt,
    });
  }, [
    activeArtifact?.selectionId,
    activeArtifact?.selection?.entityIdsHash,
    activeArtifact?.selection?.filterHash,
    activeArtifact?.selection?.fields,
    activeArtifact?.selection?.sort,
    activeArtifact?.selection?.compatibility,
    activeArtifact?.selection?.createdAt,
  ]);
  const resultContextBindingKey = useMemo(() => {
    if (!projectId || !activeArtifact) return '';
    return [
      projectId,
      activeConvId || '',
      activeArtifact.jobId,
      activeArtifact.name,
      activeArtifact.revisionId || '',
      activeArtifact.artifactFamilyId || '',
      activeSelectionBindingKey,
    ].join('\u0000');
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeSelectionBindingKey,
  ]);
  const effectiveResultContextState = !activeArtifact
    ? null
    : resultContextState?.bindingKey === resultContextBindingKey
      ? resultContextState
      : !activeConvId
        ? {
            status: 'blocked' as const,
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '请先创建或选择一个 Agent 会话，再修改当前结果。',
          }
        : { status: 'loading' as const, bindingKey: resultContextBindingKey, contextToken: null };
  const effectiveResultEditControls = resultContextState?.bindingKey === resultContextBindingKey
    ? resultEditControls
    : null;
  const resultAgentDraftKey = useMemo(() => {
    if (!activeArtifact) return '';
    return [
      projectId || '',
      activeConvId || '',
      activeArtifact.jobId,
      activeArtifact.name,
      activeArtifact.revisionId || '',
      activeArtifact.artifactFamilyId || '',
      activeArtifact.selectionId || '',
      activeSelectionBindingKey,
    ].join('\u0000');
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeArtifact?.selectionId,
    activeSelectionBindingKey,
  ]);
  const resultAgentDraft = resultAgentDraftKey ? resultAgentDrafts[resultAgentDraftKey] || '' : '';
  const setResultAgentDraft = useCallback((draft: string) => {
    if (!resultAgentDraftKey) return;
    setResultAgentDrafts((current) => {
      const next = { ...current, [resultAgentDraftKey]: draft };
      const keys = Object.keys(next);
      for (const key of keys.slice(0, Math.max(0, keys.length - 24))) delete next[key];
      return next;
    });
  }, [resultAgentDraftKey]);

  // BLOCK-139 P0-2（D2 单注入通道）：选择坐标的真相源是选择总线（D1 单选择真相）。
  // 注入优先级=可用性：shell 投影 compatible 时沿用 prop 链（零回归）；shell 投影
  // 过期（stale/invalid）而总线持有 fresh 选择时，总线胜——compatibility 跟随
  // **实际被注入的通道**（走查 R2-S1 抓真：旧写法把被弃 prop 的 stale 透给
  // composer，造成「注入正常但 UI 自称不会交给 Agent」的双通道矛盾）。
  // 两通道皆不可用=不注入，compatibility 如实透出原因。总线 stale 依旧不注入
  // （不比既有链更宽）。
  const selectionBusState = useSelectionBus();
  const copilotActiveArtifact = useMemo<NonNullable<CopilotContext['activeArtifact']> | null>(() => {
    if (!activeArtifact) return null;
    const contextToken = effectiveResultContextState?.status === 'ready'
      && isResultStudioContextToken(effectiveResultContextState.contextToken)
      ? effectiveResultContextState.contextToken
      : null;
    const propSelection = activeArtifact.selection;
    const propSelectionUsable = propSelection?.compatibility === 'compatible';
    const busSelection = selectionBusState.selection;
    // BLOCK-141 R-5（D2 注入归属校验）：总线选择必须与当前活跃 artifact **同源**
    //（busSelection.artifactId === activeArtifact.artifactId，后者来自 viewer
    // interaction manifest，经 ResultArtifactShell 投影）才可注入。竞窗：换
    // artifact 后、shell 重绑总线前（依赖异步 manifest fetch），总线仍持有上一
    // artifact 的选择——不同源不注入（自愈清选见下方 effect），旧 artifact 的
    // 选择不得附着到新 artifact 的 Agent 上下文。清单未绑定（artifactId 未知、
    // 产物不支持交互）时不启用校验，维持 BLOCK-139 既有注入契约（不比既有链更严）。
    const busSelectionSameSource = !activeArtifact.artifactId
      || busSelection?.artifactId === activeArtifact.artifactId;
    const busSelectionUsable = !!busSelection
      && busSelectionSameSource
      && (!busSelection.compatibility || busSelection.compatibility === 'compatible');
    const injectedSelection = propSelectionUsable
      ? summarizeSelectionForAgent(propSelection)
      : busSelectionUsable
        ? summarizeSelectionForAgent(busSelection)
        : null;
    return {
      jobId: activeArtifact.jobId,
      toolId: activeArtifact.toolId,
      name: activeArtifact.name,
      type: activeArtifact.type,
      label: activeArtifact.label,
      url: activeArtifact.url,
      revisionId: activeArtifact.revisionId,
      artifactFamilyId: activeArtifact.artifactFamilyId,
      entityType: activeArtifact.entityType,
      idField: activeArtifact.idField,
      selectionId: propSelectionUsable ? activeArtifact.selectionId : null,
      selection: injectedSelection,
      selectionCompatibility: propSelectionUsable
        ? (propSelection?.compatibility ?? null)
        : busSelectionUsable
          ? (busSelection?.compatibility ?? null)
          : (propSelection?.compatibility ?? busSelection?.compatibility ?? null),
      contextToken,
    };
  }, [activeArtifact, effectiveResultContextState?.contextToken, effectiveResultContextState?.status, selectionBusState.selection]);

  // BLOCK-141 R-5 自愈：竞窗内异源选择就地清选（旧 artifact 的选择不跨 artifact
  // 存活）。外部 store 写入放 effect，不在渲染期广播；同源或清单未绑定时不动作，
  // 清选后 selection 为 null 自然短路，无循环。
  useEffect(() => {
    const busSelection = selectionBusState.selection;
    if (!busSelection || !activeArtifact?.artifactId) return;
    if (busSelection.artifactId !== activeArtifact.artifactId) {
      setSelectionBusSelection(null);
    }
  }, [activeArtifact?.artifactId, selectionBusState.selection]);

  useEffect(() => {
    setActiveArtifact(null);
    setResultContextState(null);
    setResultEditControls(null);
  }, [activeJobId]);

  // G0-RS-P3: 每当打开的结果或其版本变化，就从后端重新投影一次上下文。
  // 这里只提供 job/文件名/revision 线索，坐标齐备与否由后端裁决；
  // 409 时如实记录阻断原因，UI 不把它显示成"Agent 可以直接改"。
  useEffect(() => {
    if (!projectId || !activeArtifact?.jobId || !activeArtifact.name) {
      setResultContextState(null);
      setResultEditControls(null);
      return;
    }
    if (!activeConvId) {
      setResultContextState({
        status: 'blocked',
        bindingKey: resultContextBindingKey,
        contextToken: null,
        reason: '请先创建或选择一个 Agent 会话，再修改当前结果。',
      });
      setResultEditControls(null);
      return;
    }
    let cancelled = false;
    setResultContextState({ status: 'loading', bindingKey: resultContextBindingKey, contextToken: null });
    setResultEditControls(null);
    fetchResultStudioContext({
      language: 'r',
      projectId,
      conversationId: activeConvId,
      jobId: activeArtifact.jobId,
      artifact: activeArtifact.name,
      revisionId: activeArtifact.revisionId ?? null,
    })
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'blocked') {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: result.diagnostics[0]?.message || null,
          });
          setResultEditControls(null);
          return;
        }
        const contextToken = result.agentView?.contextToken ?? null;
        if (!isResultStudioContextToken(contextToken)) {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '本地服务没有返回可验证的结果上下文，请刷新后重试。',
          });
          setResultEditControls(null);
          return;
        }
        setResultContextState({
          status: 'ready',
          bindingKey: resultContextBindingKey,
          contextToken,
          selectionUsable: result.agentView?.selectionState.usableByAgent === true,
          selectionCompatibility: result.agentView?.selectionState.compatibility ?? null,
          publicPhases: result.agentView?.publicPhases || [],
        });
        // G0-RS-P4: 控件 schema 与 Agent 可见参数出自同一后端投影。
        setResultEditControls(result.editControls ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setResultContextState({
            status: 'blocked',
            bindingKey: resultContextBindingKey,
            contextToken: null,
            reason: '无法连接本地服务读取结果上下文。',
          });
          setResultEditControls(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    activeConvId,
    activeArtifact?.jobId,
    activeArtifact?.name,
    activeArtifact?.revisionId,
    activeArtifact?.artifactFamilyId,
    activeArtifact?.selectionId,
    activeSelectionBindingKey,
    resultContextBindingKey,
  ]);

  // P4R-3: 焦点 Composer 与高级控件在这里汇合。可见 prompt 只包含用户目标/
  // 手动 patch；opaque token + Artifact/Revision/Selection 快照走事件 context，
  // 不进入消息文字。后端仍会重新投影真相并拒绝陈旧 token。
  const handleResultEditSubmit = useCallback((submission: ResultEditSubmission) => {
    if (!activeConvId || isConversationRunning(activeConvId)) {
      setWorkspaceNotice('当前 Agent 仍在处理上一条请求；完成或停止后可继续修改结果。');
      return false;
    }
    setResultEditSubmitting(true);
    try {
      const detail = buildResultEditCopilotAsk({
        submission,
        activeArtifact: copilotActiveArtifact,
        currentContextToken: effectiveResultContextState?.status === 'ready'
          ? effectiveResultContextState.contextToken
          : null,
      });
      if (!detail) {
        setWorkspaceNotice('当前结果上下文已经变化，请等待上下文刷新后再提交。');
        return false;
      }
      setWorkspaceNotice('');
      dispatchGewuEvent(gewuEvents.copilotAsk, detail);
      return true;
    } finally {
      setResultEditSubmitting(false);
    }
  }, [activeConvId, copilotActiveArtifact, effectiveResultContextState?.contextToken, effectiveResultContextState?.status]);

  return {
    resultEditBusy,
    effectiveResultContextState,
    effectiveResultEditControls,
    resultAgentDraft,
    setResultAgentDraft,
    copilotActiveArtifact,
    handleResultEditSubmit,
  };
}
