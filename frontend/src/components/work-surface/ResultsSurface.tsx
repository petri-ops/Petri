import React from 'react';
import type { Project, ToolJob } from '@/lib/project-types';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import type { ResultStudioEditControls } from '@/lib/result-studio-interaction-client';
import {
  resultEditProgressForContext,
  useConversationRun,
} from '@/components/copilot/conversationRunStore';
import {
  ResultStudioCanvas,
  ResultStudioContextBar,
} from '@/components/result-studio/ResultStudioSurface';
import { resolveResultViewer } from '@/components/result-studio/viewerRegistry';
import type { ResultArtifactKind } from '@/lib/result-manifest';
import {
  ResultAgentComposer,
  type ResultAgentComposerContext,
} from '@/components/result-studio/ResultAgentComposer';
import {
  ResultEditAdvancedDrawer,
  type ResultEditSubmission,
} from '@/components/result-studio/ResultEditPanel';
import {
  buildResultInterpretationPrompt,
  describeSelection,
  describeTruthStatus,
  shortRevisionLabel,
  type ResultSurfaceMode,
} from '@/components/result-studio/resultSurface';
import { ResultView, type ActiveArtifact } from '@/components/workspace-panels/ResultView';
import { ResultsLibrary } from '@/components/workspace-panels/ResultsLibrary';
import { PackSurfaceFrame } from '@/components/work-surface/PackSurfaceFrame';
import { useResultSurfaceHost } from './useResultSurfaceHost';
import styles from './ResultsSurface.module.css';

export interface ResultsSurfaceContext {
  project: Project;
  projectId: string | undefined;
  conversationId: string | null;
  activeJob: ToolJob | null;
  activeWorkflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: (artifact: ActiveArtifact | null) => void;
  jobs: ToolJob[];
  /** BLOCK-216 Q5 — pack 贡献的结果面（无匹配时保留核心 transitional 面）。 */
  packResultSurfaces: WorkSurfaceDescriptor[];
  resultContext: ResultAgentComposerContext | null;
  resultEditControls: ResultStudioEditControls | null;
  resultEditSubmitting: boolean;
  resultAgentDraft: string;
  setResultAgentDraft: (draft: string) => void;
  onResultEditSubmit: (submission: ResultEditSubmission) => boolean | void;
  pendingArtifactName: string | null;
  onPendingArtifactConsumed: () => void;
  onWorkflowChanged: () => void;
  handleAskAgent: (prompt: string, options?: { analysisMode?: boolean; compose?: boolean }) => void;
  handleOpenResult: (jobId: string, projectId?: string | null) => void | Promise<boolean>;
  openRevisionWorkspaceFile: (relativePath: string) => void;
  openResultBrowser: (url: string) => void;
}

/**
 * BLOCK-334 — 右栏「结果」tab 的唯一宿主。
 *
 * 结果查看自中央 result/code/compare/history 四态接管迁入右栏，与「文件」「3D 模型」
 * 同栏同形态：中央永远是会话。四态降为本组件的局部子状态（D1），不进 URL；
 * URL 只承载 `?job=&artifact=`。pack 结果面 / tab 级接管 / 身份水化走
 * useResultSurfaceHost（自 CenterPanel 原样平移）。
 */
export function ResultsSurface({
  ctx,
  active,
}: {
  ctx: ResultsSurfaceContext;
  /** 右栏当前 tab 是否为 results：非激活时 3D 预览不持有 WebGL 上下文（block-322 P3 门控）。 */
  active: boolean;
}): React.ReactElement {
  const [mode, setMode] = React.useState<ResultSurfaceMode>('result');
  // job 切换时子态回到 result：render 期 adjust-state（与 ResultArtifactShell 同模式），
  // 否则上一任务停在 history 子态会让新任务首屏是空的版本面板。
  const activeJobId = ctx.activeJob?.id ?? null;
  const [prevJobId, setPrevJobId] = React.useState<string | null>(activeJobId);
  if (activeJobId !== prevJobId) {
    setPrevJobId(activeJobId);
    setMode('result');
  }

  // Reuse the durable conversation run; the result Composer does not create a
  // second progress store and therefore survives tool switches/stop/failure by
  // the same rules as the conversation surface.
  const activeRun = useConversationRun(ctx.conversationId);
  const activeResultProgress = resultEditProgressForContext(
    activeRun,
    ctx.resultContext?.status === 'ready' ? ctx.resultContext.contextToken : null,
  );
  const { resultSurfaceHost, packTabState, downgradeToCore, packResultData } = useResultSurfaceHost({
    packResultSurfaces: ctx.packResultSurfaces,
    activeArtifact: ctx.activeArtifact,
    setActiveArtifact: ctx.setActiveArtifact,
    activeJob: ctx.activeJob,
    projectId: ctx.projectId,
    mode,
    // 优先用运行中的最新进度；没有运行时用「当前查看版本」的变更集（BLOCK-252：
    // 只有瞬时进度会让重载/普通查看版本后的 compare 永远 missing_changeset_id）。
    changeSetId: activeResultProgress[activeResultProgress.length - 1]?.changeSetId
      ?? ctx.activeArtifact?.changeSetId
      ?? null,
  });

  const truthStatus = typeof ctx.activeArtifact?.truthStatus === 'string'
    ? ctx.activeArtifact.truthStatus
    : typeof ctx.activeWorkflow?.artifactTruth?.status === 'string'
      ? ctx.activeWorkflow.artifactTruth.status
      : null;
  const contextTitle = ctx.activeArtifact?.label || ctx.activeArtifact?.name || ctx.activeJob?.name || ctx.activeJob?.tool_id || '分析结果';
  const contextConclusion = ctx.activeArtifact?.availabilityStatus === 'unavailable'
    ? '科学校验记录仍保留，但当前产物文件不可读取；请重试预览或让 Agent 检查恢复。'
    : ctx.activeArtifact?.conclusion || (
      truthStatus === 'valid'
        ? '结果已经过产物校验，可继续查看、比较或交给 Agent 解释。'
        : truthStatus === 'blocked'
          ? '结果当前被阻断，请先查看原因或让 Agent 处理。'
          : '正在读取结果与可信状态，不会把未知信息标记为成功。'
    );

  const askAboutCurrentResult = React.useCallback((prompt?: string, options?: { compose?: boolean }) => {
    // BIO-6（BIO-D4 裁决 b）— 解读统一走 Agent + result_summary 链，prompt 经
    // resultSurface 单一构造器出词：锚定任务与产物坐标，不接遗留模板。
    // UI-612 — 批注「加入上下文」传入自己的 prompt + compose：只入草稿不发送。
    // onAskAgent 也被直接挂在按钮上（onClick 会把事件作为首参传入）——只认字符串 prompt。
    const explicit = typeof prompt === 'string' ? prompt.trim() : '';
    const text = explicit || buildResultInterpretationPrompt({
      jobId: ctx.activeJob?.id,
      artifactName: ctx.activeArtifact?.name || contextTitle,
    });
    if (!text) return;
    ctx.handleAskAgent(text, options);
  }, [contextTitle, ctx.activeJob, ctx.activeArtifact, ctx.handleAskAgent]);

  const onRevisionAgentRequest = React.useCallback((request: 'explain' | 'modify' | 'replay') => {
    if (ctx.resultContext?.status !== 'ready' || !ctx.resultContext.contextToken) return;
    const requestedOutcome = request === 'explain'
      ? '请解释当前 Revision 对应的精确代码、参数和复现边界，不要执行修改。'
      : request === 'modify'
        ? '请基于当前 Revision 的精确代码提出修改方案；先说明影响并等待确认，不要覆盖当前或历史版本。'
        : '请先展示当前 Revision 的输入、参数、运行时和副作用确认摘要；未经明确确认不要执行受控重放。';
    ctx.onResultEditSubmit({
      origin: 'agent',
      completionExpectation: 'none',
      requestedOutcome,
      parameterPatch: {},
      scientificConfirmed: false,
      contextToken: ctx.resultContext.contextToken,
    });
  }, [ctx.onResultEditSubmit, ctx.resultContext]);

  const handleModeChange = React.useCallback((next: ResultSurfaceMode) => setMode(next), []);
  const packTakesOver = Boolean(ctx.activeJob && resultSurfaceHost.descriptor && !downgradeToCore);
  // L2-4（蓝图 L-03）：canCompare 按当前产物的 viewer 能力位传值（原调用不传 →
  // 默认 false → mode=compare 静默回退；table 族 true 才可进 compare）。
  const canCompare = ctx.activeArtifact
    ? resolveResultViewer({ kind: ctx.activeArtifact.type as ResultArtifactKind, fileName: ctx.activeArtifact.name }).canCompare
    : false;

  return (
    <div className={styles.surface} data-result-mode={mode} data-result-active={active ? 'true' : 'false'}>
      <ResultStudioCanvas
        mode={mode}
        canCompare={canCompare}
        canProjectSource={Boolean(ctx.activeArtifact?.revisionId)}
        composer={mode === 'result' && ctx.activeArtifact ? (
          <ResultAgentComposer
            context={ctx.resultContext}
            draft={ctx.resultAgentDraft}
            onDraftChange={ctx.setResultAgentDraft}
            onSubmit={ctx.onResultEditSubmit}
            submitting={ctx.resultEditSubmitting}
            progress={activeResultProgress}
          />
        ) : null}
        contextBar={(mode === 'result' && !packTakesOver) ? null : (
          <ResultStudioContextBar
            title={contextTitle}
            trust={describeTruthStatus(truthStatus, ctx.activeJob?.status)}
            availabilityStatus={ctx.activeArtifact?.availabilityStatus}
            conclusion={contextConclusion}
            revisionLabel={shortRevisionLabel(ctx.activeArtifact?.revisionId, ctx.activeArtifact?.revisionOrdinal)}
            selectionLabel={describeSelection(ctx.activeArtifact?.selection)}
            // 中央不再是结果宿主：「返回」只回到结果子态，不切会话。
            onBack={mode === 'result' ? undefined : () => setMode('result')}
            onAskAgent={askAboutCurrentResult}
            activeMode={mode}
            canReviewVersions={!!ctx.activeArtifact?.artifactFamilyId}
            canProjectSource={Boolean(ctx.activeArtifact?.revisionId)}
            onModeChange={handleModeChange}
          />
        )}
      >
        {ctx.activeJob ? (
          packTakesOver && resultSurfaceHost.descriptor ? (
            <div data-result-surface-source="pack" data-pack-tab={resultSurfaceHost.tab} style={{ display: 'contents' }}>
              <PackSurfaceFrame
                descriptor={resultSurfaceHost.descriptor}
                projectId={ctx.projectId}
                conversationId={ctx.conversationId}
                artifactContext={{
                  jobId: ctx.activeJob.id,
                  toolId: ctx.activeJob.tool_id,
                  name: ctx.activeArtifact?.name ?? null,
                  type: ctx.activeArtifact?.type ?? null,
                  semanticKind: ctx.activeArtifact?.semanticKind ?? null,
                  revisionId: ctx.activeArtifact?.revisionId ?? null,
                  truthStatus: ctx.activeArtifact?.truthStatus ?? null,
                  url: ctx.activeArtifact?.url ?? null,
                }}
                resultData={packResultData.data}
                tab={resultSurfaceHost.tab ?? null}
                tabData={packTabState.data ?? null}
              />
            </div>
          ) : (
            <div
              data-result-surface-source="core-transitional"
              data-fallback-reason={downgradeToCore ? packTabState.reason : resultSurfaceHost.reason}
              style={{ display: 'contents' }}
            >
              <ResultView
                project={ctx.project}
                conversationId={ctx.conversationId}
                job={ctx.activeJob}
                workflow={ctx.activeWorkflow}
                activeArtifact={ctx.activeArtifact}
                onActiveArtifactChange={ctx.setActiveArtifact}
                onAskAgent={ctx.handleAskAgent}
                onWorkflowChanged={ctx.onWorkflowChanged}
                onAgentCodeRequest={onRevisionAgentRequest}
                replayContext={ctx.resultContext?.status === 'ready' && ctx.resultContext.contextToken
                  ? { conversationId: ctx.conversationId, contextToken: ctx.resultContext.contextToken }
                  : null}
                onOpenRevisionWorkspaceFile={ctx.openRevisionWorkspaceFile}
                pendingArtifactName={ctx.pendingArtifactName}
                onPendingArtifactConsumed={ctx.onPendingArtifactConsumed}
                onOpenBrowser={ctx.openResultBrowser}
                onAskCurrentResult={askAboutCurrentResult}
                mode={mode}
                onModeChange={handleModeChange}
                active={active}
              />
            </div>
          )
        ) : (
          <ResultsLibrary
            projectId={ctx.projectId}
            jobs={ctx.jobs}
            onOpenJob={(jobId) => void ctx.handleOpenResult(jobId, ctx.projectId)}
          />
        )}
      </ResultStudioCanvas>
      {/* UI-109 — 「高级精细调整」默认关闭的抽屉随宿主迁入结果 tab 底部（原右栏 Inspector 旁）。 */}
      {ctx.activeArtifact && (
        <div className={styles.drawer}>
          <ResultEditAdvancedDrawer
            editControls={ctx.resultEditControls}
            disabledReason={
              ctx.resultContext?.status === 'blocked'
                ? ctx.resultContext.reason || '当前结果缺少可复现的来源坐标，暂时无法修改。'
                : ctx.resultContext?.status === 'loading'
                  ? '正在读取结果坐标…'
                  : null
            }
            submitting={ctx.resultEditSubmitting}
            onSubmit={ctx.onResultEditSubmit}
          />
        </div>
      )}
    </div>
  );
}
