// ============================================================
// ResultArtifactShell - UI-305 P2 extracted from ResultView.tsx (lines 165-1533),
// behavior unchanged; main file imports it back as needed.
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { findCatalogTool, useToolCatalog } from '@/lib/tool-catalog';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import { Lightbox } from '@/components/ui/Lightbox';
import { SimpleChat } from '@/components/copilot/SimpleChat';
import { isDirectRecoveryAction, useHarnessWorkflowStatus } from '@/hooks/useHarnessWorkflowStatus';
import { gewuEvents, subscribeGewuEvent, dispatchGewuEvent } from '@/lib/events';
import { useTheme } from '@/themes/ThemeProvider';
import {
  fetchHarnessIndex,
  runHarnessWorkflowAction,
  type HarnessIndexSummary,
  type HarnessWorkflowJobState,
} from '@/lib/harness-client';
import {
  normalizeResultManifest,
  classifyArtifact,
  buildResultArtifactNavigation,
  findArtifactByName,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactKind,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import {
  artifactFormatLabel,
  buildResultArtifactPickerGroups,
  filterResultArtifactRelatedSections,
  findResultArtifactPickerOption,
  isRelatedArtifactKind,
} from '@/lib/result-artifact-display';
import {
  summarizeSelectionForAgent,
  type ArtifactInteractionManifest,
  type ArtifactSelection,
  type InteractionCapability,
} from '@/lib/artifact-selection';
import { ResultStudioChangeSetPanel } from '@/components/result-studio/ResultStudioChangeSetPanel';
import { isSameActiveArtifactProjection } from '@/components/result-studio/activeArtifactProjection';
import { RevisionCodeView } from '@/components/result-studio/RevisionCodeView';
import { revisionArtifactUrl, type ArtifactRevision } from '@/components/result-studio/resultStudioClient';
import { shouldShowWorkflowBar } from '@/components/result-studio/resultFirstScreen';
import {
  canCommitResultFetch,
  nextResultBodyState,
  revisionAfterJobSelection,
  type ResultBodyState,
} from '@/components/result-studio/resultBodyState';
import { getResultScrollPosition, setResultScrollPosition } from '@/components/result-studio/resultScrollMemory';
import { ScientificInteractionViewer } from '@/components/result-studio/ScientificInteractionViewer';
import { CompactResultNavigator } from '@/components/result-studio/CompactResultNavigator';
import {
  deleteResultStudioSelection,
  fetchArtifactInteraction,
  fetchResultStudioContext,
  restoreResultStudioSelection,
  saveResultStudioSelection,
  type ResultStudioEditControls,
  type ResultTableQuery,
} from '@/lib/result-studio-interaction-client';
import {
  beginResultSurfaceMeasure,
  chooseResultArtifactName,
  completeResultSurfaceMeasure,
  describeTruthStatus,
  requestedArtifactRequestKey,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  shouldApplyRequestedArtifact,
  shouldRequestArtifactInteraction,
  shouldShowResultInteraction,
  shouldSurfaceInteractionFailure,
  type ResultSurfaceMode,
} from '@/components/result-studio/resultSurface';
import { getBridge } from '@/lib/desktopBridge';
import styles from '@/pages/project-workspace.module.css';
// BLOCK-92 Wave B-2 — 状态簇外迁（./ResultArtifactShell/，纯搬运零行为变化）。
import { useArtifactRecovery } from './ResultArtifactShell/useArtifactRecovery';
import { useResultReportActions } from './ResultArtifactShell/useResultReportActions';
import { useArtifactInteractionSelection } from './ResultArtifactShell/useArtifactInteractionSelection';
import { fileExtension, isImageFile, isTextFile, isMarkdownFile, workspaceFileUrlFor, formatPreviewText } from '@/lib/previewFileUtils';
import {
  toArtifactRevision,
  artifactName,
  artifactKindIcon,
  artifactPreviewLabel,
  workflowStageLabel,
} from './ResultView/helpers';
import type {
  ActiveArtifact,
  JobStats,
  JobResultFile,
  DeliveryManifestSummary,
  JobResult,
  JobDetailMeta,
} from './ResultView/types';

// 预览可用性状态：字面量联合在条件表达式的对象字面量分支里会被拓宽成 string，
// 故与载荷一起显式声明类型（同一联合此前在 useState 内联拼写）。
type PreviewAvailabilityStatus = 'checking' | 'available' | 'unavailable';
type PreviewAvailability = {
  key: string;
  status: PreviewAvailabilityStatus;
  reason: string | null;
};

export function ResultArtifactShell({
  project,
  conversationId,
  job,
  workflow,
  activeArtifact,
  onActiveArtifactChange,
  onAskAgent,
  onWorkflowChanged,
  onAgentCodeRequest,
  replayContext,
  onOpenRevisionWorkspaceFile,
  pendingArtifactName = null,
  onPendingArtifactConsumed,
  onOpenBrowser,
  onBack,
  onAskCurrentResult,
  mode = 'result',
  onModeChange,
}: {
  project: Project;
  conversationId?: string | null;
  job: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  activeArtifact: ActiveArtifact | null;
  onActiveArtifactChange: (artifact: ActiveArtifact | null) => void;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged?: () => void;
  onAgentCodeRequest?: (request: 'explain' | 'modify' | 'replay') => void;
  replayContext?: { conversationId?: string | null; contextToken: string } | null;
  onOpenRevisionWorkspaceFile?: (relativePath: string) => void;
  /**
   * Optional artifact name the host wants pre-selected once the manifest
   * (or fallback artifacts) becomes available. Populated by the chat
   * `projectOpenArtifact` event after a cross-project jump.
   */
  pendingArtifactName?: string | null;
  /** Fires after the pending artifact has been applied (or dismissed). */
  onPendingArtifactConsumed?: () => void;
  /** Opens a generated delivery report in the right-side Electron webview. */
  onOpenBrowser?: (url: string) => void;
  onBack?: () => void;
  onAskCurrentResult?: () => void;
  mode?: ResultSurfaceMode;
  onModeChange?: (mode: ResultSurfaceMode, jobId?: string | null) => void;
}): React.ReactElement {
  const { resolvedTheme } = useTheme();
  // BLOCK-59 P1 — 弹出独立窗入口（仅桌面桥可用时渲染；浏览器内为 null）
  // UI-385 — 结果独立窗退役：windowManager 桥不再使用（结果统一右栏承载）
  const [result, setResult] = useState<JobResult | null>(null);
  // P0-3：结果请求的网络/服务错误必须与"确实没有结果文件"区分开，
  // 否则网络抖动会被谎报为"分析已完成，但未生成可视化结果文件"。
  const [resultError, setResultError] = useState('');
  const [resultRetryVersion, setResultRetryVersion] = useState(0);
  // Which job the currently displayed body belongs to. Without this the
  // effects below cannot tell "re-observing the same job" from "a different
  // job", and cleared unconditionally for both.
  const bodyJobRef = useRef<string | null>(null);
  const activeBodyJobRef = useRef<string | null>(job?.id ?? null);
  activeBodyJobRef.current = job?.id ?? null;
  // P4R-2: result↔chat scroll preservation. `.resultView` is the scroll
  // container; the result projection layer unmounts in chat mode, so the
  // position is held in the module-level memory keyed by job id and restored
  // once the body is mounted. See resultScrollMemory.ts.
  const resultViewRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [jobMeta, setJobMeta] = useState<JobDetailMeta | null>(null);
  const [manifestRaw, setManifestRaw] = useState<unknown>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState('');
  const [manifestRetryVersion, setManifestRetryVersion] = useState(0);
  const [selectedName, setSelectedName] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetryVersion, setPreviewRetryVersion] = useState(0);
  const [previewAvailability, setPreviewAvailability] = useState<PreviewAvailability>({
    key: '',
    status: 'checking',
    reason: null,
  });
  // RS3：交互清单由后端基于完整文件判定（稳定 ID 列、可选维度），前端只消费。
  // P4R-4: a historical Revision can share its Job with a later restored
  // Revision. Keep the clicked identity as disposable view state and pass it
  // explicitly to the interaction route; do not infer it from job+artifact.
  const [viewedRevision, setViewedRevision] = useState<ArtifactRevision | null>(null);
  useEffect(() => {
    setViewedRevision((current) => revisionAfterJobSelection(current, job?.id ?? null));
  }, [job?.id]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [artifactSwitchMs, setArtifactSwitchMs] = useState<number | null>(null);

  // BLOCK-83 D4：工具 manifest 从插件目录投影取，不再依赖核心静态清单。
  const { tools: catalogTools } = useToolCatalog();
  const tool = useMemo(
    () => (job ? findCatalogTool(catalogTools, job.tool_id) : null),
    [job?.tool_id, catalogTools]
  );
  const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
  const effectiveJobStatus: ToolJob['status'] = workflow?.jobStatus === 'completed'
    ? 'done'
    : workflow?.jobStatus === 'failed' || workflow?.jobStatus === 'cancelled'
      ? 'failed'
      : workflow?.jobStatus === 'running'
        ? 'running'
        : workflow?.jobStatus === 'pending' || workflow?.jobStatus === 'queued'
          ? 'pending'
          : job?.status || 'pending';

  const buildUrl = useCallback(
    (name: string) => {
      if (!job) return '';
      const base = getApiPrefix(lang);
      const token = getToken();
      const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${base}/tools/file/${job.id}/${encodeURIComponent(name)}${tokenQs}`;
    },
    [job?.id, lang]
  );
  const scientificScriptUrl = useMemo(() => {
    if (!job || !result?.deliveryManifest) return '';
    const token = getToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${getApiPrefix(lang)}/harness/scientific-task-by-job/${encodeURIComponent(job.id)}/script${query}`;
  }, [job?.id, lang, result?.deliveryManifest]);

  useEffect(() => {
    if (!job) {
      bodyJobRef.current = null;
      setResult(null);
      setResultError('');
      setJobMeta(null);
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
      setSelectedSectionId('');
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
      // interactionError 的清空由 useArtifactInteractionSelection 的绑定键
      // 变更路径覆盖（job→null 亦改变绑定键，行为与拆分前一致）。
      return;
    }

    if (effectiveJobStatus === 'done') {
      const requestedJobId = job.id;
      let cancelled = false;
      setLoading(true);
      setResultError('');
      // The decision is the reducer's, not a condition restated here. An
      // earlier version reimplemented the same rule inline and left
      // resultBodyState.ts with no production importer — so its tests were
      // green while nothing they described was running.
      const shownBefore: ResultBodyState = bodyJobRef.current
        ? { kind: 'artifact', jobId: bodyJobRef.current, artifactName: selectedName || '' }
        : { kind: 'empty' };
      const shownAfter = nextResultBodyState(shownBefore, { type: 'result_fetch_started', jobId: job.id });
      if (shownAfter !== shownBefore) {
        bodyJobRef.current = null;
        setResult(null);
        setJobMeta(null);
        setSelectedName('');
        setSelectedSectionId('');
      }
      (async () => {
        try {
          const token = getToken();
          const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + requestedJobId, {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          });
          if (!resp.ok) {
            // HTTP 层失败（5xx/403 等）：不是"没有结果"，是服务出错
            if (canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) {
              setResultError(`结果服务返回 HTTP ${resp.status}`);
            }
            return;
          }
          const data = await resp.json();
          if (!canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) return;
          if (data.ok && data.result) {
            bodyJobRef.current = requestedJobId;
            setResult(data.result);
            setResultError('');
            setJobMeta({
              params: data.params || {},
              ackStatus: data.ackStatus || null,
              projectId: data.projectId || null,
            });
          } else if (!data.ok) {
            // 服务显式报错：如实展示，不归入"未生成结果"
            setResultError(data.error || '结果服务返回失败');
          }
          // data.ok 但无 result：确实没有结果文件，保持 resultError 为空，
          // 由 !result 分支展示"未生成可视化结果文件"
        } catch (e: any) {
          // 网络层失败（服务不可达/超时）：必须让用户知道是连接问题而非"没有结果"
          if (canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) {
            setResultError(e?.message || '网络错误，无法获取结果');
          }
        } finally {
          if (canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) {
            setLoading(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    } else if (nextResultBodyState(
      bodyJobRef.current
        ? { kind: 'artifact', jobId: bodyJobRef.current, artifactName: selectedName || '' }
        : { kind: 'empty' },
      { type: 'job_status_observed', jobId: job.id, status: String(effectiveJobStatus), source: 'job-list' },
    ).kind === 'artifact') {
      // job_status_observed from the 15s job-list fetch, which is never updated
      // in place for an already-present job — so its status may be arbitrarily
      // stale and must not replace a rendered artifact with a spinner. Losing
      // an observation is not observing a change.
      //
      // Guarded on the ref rather than on `result`: this effect's deps are
      // [effectiveJobStatus, job?.id, lang], so a `result` read here would be a
      // stale closure value.
      setLoading(false);
    } else {
      bodyJobRef.current = null;
      setResult(null);
      setResultError('');
      setJobMeta(null);
      setLoading(false);
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
      setSelectedSectionId('');
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
    }
    return undefined;
  }, [effectiveJobStatus, job?.id, lang, resultRetryVersion]);

  // P4R-2: restore `.resultView` scroll position once the body is mounted.
  // Runs only when there is a result to render (success-state return); the
  // stateBlock exits have no scrollable content. Re-runs on artifact switch
  // so a re-mount within the same job also restores.
  useEffect(() => {
    if (!result || !job?.id) return;
    const el = resultViewRef.current;
    if (!el) return;
    el.scrollTop = getResultScrollPosition(job.id);
  }, [result, job?.id]);

  const files = result?.artifacts || result?.files || [];
  const fallbackArtifacts = useMemo<ResultArtifactRecord[]>(
    () =>
      files.map((file) => ({
        name: artifactName(file),
        type: file.type,
        label: file.label || file.title,
        title: file.title,
        url: buildUrl(artifactName(file)),
        preview: file.preview,
        download: file.download,
      })),
    [buildUrl, files]
  );

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done') {
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      return;
    }
    if (result?.manifest && typeof result.manifest === 'object') {
      setManifestRaw(result.manifest);
      setManifestLoading(false);
      setManifestError('');
      return;
    }
    let cancelled = false;
    setManifestLoading(true);
    setManifestError('');
    fetch(buildUrl('manifest.json'))
      .then((resp) => {
        if (!resp.ok) throw new Error('manifest missing');
        return resp.json();
      })
      .then((json) => {
        if (!cancelled) setManifestRaw(json);
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setManifestRaw(null);
        setManifestError(error.message === 'manifest missing' ? '' : (error.message || 'manifest 解析失败'));
      })
      .finally(() => {
        if (!cancelled) setManifestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildUrl, effectiveJobStatus, job?.id, manifestRetryVersion, result?.manifest]);

  const manifest = useMemo(
    () => normalizeResultManifest(manifestRaw, fallbackArtifacts),
    [fallbackArtifacts, manifestRaw]
  );
  const manifestArtifacts = manifest?.artifacts?.length ? manifest.artifacts : fallbackArtifacts;
  const artifacts = manifestArtifacts;
  const coreArtifacts = useMemo(
    () => artifacts.filter((artifact) => classifyArtifact(artifact) !== 'report'),
    [artifacts]
  );
  const navSections = useMemo(
    () => buildResultArtifactNavigation(manifest, artifacts),
    [artifacts, manifest]
  );
  const primaryNavSections = useMemo(
    () => navSections.filter((section) => !isRelatedArtifactKind(section.kind)),
    [navSections]
  );
  const relatedNavSections = useMemo(
    () => navSections.filter((section) => isRelatedArtifactKind(section.kind)),
    [navSections]
  );
  const resultPickerSections = useMemo(
    () => (primaryNavSections.length > 0 ? primaryNavSections : navSections),
    [navSections, primaryNavSections],
  );
  const artifactPickerGroups = useMemo(
    () => buildResultArtifactPickerGroups(resultPickerSections, {
      includeRelated: primaryNavSections.length === 0,
      allArtifacts: artifacts,
    }),
    [artifacts, primaryNavSections.length, resultPickerSections],
  );
  const compactRelatedSections = useMemo(
    () => primaryNavSections.length > 0
      ? filterResultArtifactRelatedSections(relatedNavSections, artifactPickerGroups)
      : [],
    [artifactPickerGroups, primaryNavSections.length, relatedNavSections],
  );
  const reportArtifact = useMemo(
    () =>
      artifacts.find((artifact) => classifyArtifact(artifact) === 'report') ||
      artifacts.find((artifact) => /\.(html?|xhtml)$/i.test(artifact.name)) ||
      null,
    [artifacts]
  );
  const materializedReportArtifact = useMemo(
    () => artifacts.find((artifact) => /(^|\/)final-report\.html$/i.test(artifact.name)) || null,
    [artifacts]
  );
  // BLOCK-92 Wave B-2 — 报告/复现包簇外迁（./ResultArtifactShell/useResultReportActions.ts）。
  const {
    reportGenerating,
    finalReportUrl,
    reportGenerationError,
    replayPackageBusy,
    replayPackageMessage,
    generateFinalReport,
    exportReplayPackage,
  } = useResultReportActions({
    job,
    lang,
    buildUrl,
    materializedReportArtifact,
    resolvedTheme,
  });
  const preferredArtifactName =
    activeArtifact && activeArtifact.jobId === job?.id ? activeArtifact.name : '';
  const selectedArtifact = useMemo(() => {
    const asPrimaryArtifact = (artifact: ResultArtifactRecord | null): ResultArtifactRecord | null => {
      if (!artifact) return null;
      const grouped = findResultArtifactPickerOption(artifactPickerGroups, artifact.name);
      return grouped
        ? findArtifactByName(artifacts, grouped.option.primary.name) || artifact
        : artifact;
    };
    const current = findArtifactByName(artifacts, selectedName);
    if (current) return asPrimaryArtifact(current);
    // The pending artifact (from chat click / cross-project navigation)
    // wins over the active-artifact hint when both are present.
    const pending = pendingArtifactName ? findArtifactByName(artifacts, pendingArtifactName) : null;
    if (pending) return asPrimaryArtifact(pending);
    return asPrimaryArtifact(
      pickPreferredArtifact(coreArtifacts, preferredArtifactName) ||
      coreArtifacts[0] ||
      null
    );
  }, [artifactPickerGroups, artifacts, coreArtifacts, pendingArtifactName, preferredArtifactName, selectedName]);
  const viewedArtifactName = viewedRevision
    ? viewedRevision.outputPath.split('/').pop() || viewedRevision.artifactId
    : '';
  const selectedArtifactName = viewedArtifactName || selectedArtifact?.name || '';
  const selectedArtifactUrl = viewedRevision
    ? revisionArtifactUrl(viewedRevision.revisionId)
    : selectedArtifact
      ? resolveResultArtifactUrl(selectedArtifact.url, buildUrl(selectedArtifact.name))
      : '';
  const selectedArtifactKind = selectedArtifact
    ? classifyArtifact(selectedArtifact)
    : classifyArtifact({ name: selectedArtifactName, type: '' });
  const selectedArtifactLabel = selectedArtifact
    ? selectedArtifact.label || selectedArtifact.title || selectedArtifact.name
    : '';
  const activeIsHtml = selectedArtifactKind === 'report' || /\.html?$/i.test(selectedArtifactName);
  const activeIsText =
    !activeIsHtml &&
    (selectedArtifactKind === 'text' || isTextFile(selectedArtifactName) || isMarkdownFile(selectedArtifactName) || /\.json$/i.test(selectedArtifactName) || /\.(csv|tsv)$/i.test(selectedArtifactName));
  const activeIsPreviewText = activeIsText && !activeIsHtml;
  const viewerAdapter = selectedArtifact
    ? resolveResultViewerAdapter({
        kind: selectedArtifactKind,
        fileName: selectedArtifactName,
        preview: selectedArtifact.preview,
      })
    : 'binary';
  // BLOCK-92 Wave B-2 — 交互清单与选择状态簇外迁
  // （./ResultArtifactShell/useArtifactInteractionSelection.ts，纯搬运零行为变化；
  // interactionBindingKey/manifestArtifactRef/选择变更队列随之内聚）。
  const {
    interactionBindingKey,
    interactionPreviewKey,
    setInteractionPreviewKey,
    boundInteractionManifest,
    boundInteractionRevision,
    boundInteractionBackingTable,
    boundArtifactSelection,
    interactionError,
    selectionError,
    setInteractionRetryVersion,
    handleSelectionChange,
    resetInteractionSelection,
  } = useArtifactInteractionSelection({
    project,
    conversationId,
    job,
    effectiveJobStatus,
    lang,
    selectedArtifactName,
    viewedRevision,
    viewerAdapter,
  });
  // BLOCK-92 Wave B-2 — 恢复动作簇外迁（./ResultArtifactShell/useArtifactRecovery.ts）。
  const {
    recoveryAction,
    recoveryBusy,
    pendingRecovery,
    recoveryError,
    requestRecovery,
    resolveRecovery,
  } = useArtifactRecovery({ job, workflow, onAskAgent, onWorkflowChanged });
  const usesInteractiveViewer = Boolean(
    boundInteractionManifest?.interactionMode && boundInteractionManifest.interactionMode !== 'read_only',
  );
  const interactionPreviewActive = interactionPreviewKey === interactionBindingKey;
  const imageInteractionAvailable = viewerAdapter === 'image' && usesInteractiveViewer;
  const showInteractiveViewer = shouldShowResultInteraction({
    adapter: viewerAdapter,
    interactionAvailable: usesInteractiveViewer,
    interactionRequested: interactionPreviewActive,
  });
  const requiresPreviewAvailabilityCheck = activeIsPreviewText
    || viewerAdapter === 'image';
  const previewAvailabilityKey = `${viewedRevision?.revisionId || 'current'}::${job?.id || ''}::${selectedArtifactName}::${selectedArtifactUrl}`;
  const effectivePreviewAvailability: PreviewAvailability = previewAvailability.key === previewAvailabilityKey
    ? previewAvailability
    : {
        key: previewAvailabilityKey,
        status: (requiresPreviewAvailabilityCheck ? 'checking' : 'available'),
        reason: null,
      };

  useEffect(() => {
    setPreviewAvailability({
      key: previewAvailabilityKey,
      status: requiresPreviewAvailabilityCheck ? 'checking' : 'available',
      reason: null,
    });
  }, [previewAvailabilityKey, previewRetryVersion, requiresPreviewAvailabilityCheck]);

  useEffect(() => {
    if (!selectedArtifactName) return;
    const duration = completeResultSurfaceMeasure({
      start: RESULT_SURFACE_PERFORMANCE_MARKS.artifactStart,
      end: RESULT_SURFACE_PERFORMANCE_MARKS.artifactEnd,
      measure: RESULT_SURFACE_PERFORMANCE_MARKS.artifactMeasure,
    });
    if (duration !== null) setArtifactSwitchMs(duration);
  }, [selectedArtifactName]);

  useEffect(() => {
    if (!selectedArtifactName || navSections.length === 0) return;
    const nextSection = navSections.find((section) => section.artifactNames.includes(selectedArtifactName));
    if (!nextSection) return;
    setSelectedSectionId((current) => (current === nextSection.id ? current : nextSection.id));
  }, [navSections, selectedArtifactName]);

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done' || artifacts.length === 0) return;
    const preferredPool = coreArtifacts.length > 0 ? coreArtifacts : artifacts;
    const preferred = pickPreferredArtifact(preferredPool, preferredArtifactName) || preferredPool[0];
    const preferredName = preferred ? preferred.name : '';
    setSelectedName((current) => chooseResultArtifactName({
      currentName: current,
      pendingName: pendingArtifactName,
      preferredName,
      availableNames: artifacts.map((artifact) => artifact.name),
    }));
    setSelectedSectionId((current) => {
      if (current && navSections.some((section) => section.id === current)) return current;
      const focusName =
        (pendingArtifactName && artifacts.some((artifact) => artifact.name === pendingArtifactName)
          ? pendingArtifactName
          : preferredName);
      const nextSection =
        (focusName && navSections.find((item) => item.artifactNames.includes(focusName))) ||
        navSections[0];
      return nextSection?.id || '';
    });
  }, [artifacts, coreArtifacts, effectiveJobStatus, job?.id, navSections, pendingArtifactName, preferredArtifactName]);

  // Clear the pending artifact after it's been applied so a subsequent
  // unrelated render doesn't keep forcing it.
  useEffect(() => {
    if (!pendingArtifactName) return;
    if (artifacts.length === 0) return;
    const matches = artifacts.some((artifact) => artifact.name === pendingArtifactName);
    if (matches) {
      onPendingArtifactConsumed?.();
    }
  }, [artifacts, onPendingArtifactConsumed, pendingArtifactName]);

  // BLOCK-92 Wave B-2 — 交互清单重取 effect 与选择变更队列已随
  // useArtifactInteractionSelection 外迁（含乐观投影/失败回滚语义，逐行平移）。

  useEffect(() => {
    if (!job || effectiveJobStatus !== 'done' || (!selectedArtifact && !viewedRevision)) {
      onActiveArtifactChange(null);
      return;
    }
    const artifact: ActiveArtifact = {
      jobId: viewedRevision?.toolJobId || job.id,
      toolId: job.tool_id,
      name: selectedArtifactName,
      type: selectedArtifact?.type || selectedArtifactKind,
      label: selectedArtifact?.label || selectedArtifact?.title || selectedArtifactName,
      url: selectedArtifactUrl,
      // RS3 semantic 维度：来自后端基于完整文件产出的交互清单。
      // 清单还没到（或该类型不支持交互）时保持 null，不猜测。
      semanticKind: selectedArtifactKind,
      revisionId: viewedRevision?.revisionId ?? boundInteractionManifest?.revisionId ?? null,
      revisionOrdinal: viewedRevision?.revisionOrdinal ?? boundInteractionRevision?.revisionOrdinal ?? null,
      artifactFamilyId: viewedRevision?.artifactFamilyId ?? boundInteractionManifest?.artifactFamilyId ?? null,
      entityType: boundInteractionManifest?.entityType ?? null,
      idField: boundInteractionManifest?.idField ?? null,
      selectionDurable: boundInteractionManifest?.selectionDurable ?? false,
      interactionCapabilities: boundInteractionManifest?.capabilities ?? [],
      selection: boundArtifactSelection,
      selectionId: boundArtifactSelection?.selectionId || null,
      truthStatus: viewedRevision?.validationStatus ?? result?.deliveryManifest?.status ?? null,
      conclusion: viewedRevision && !viewedRevision.isCurrent ? null : result?.deliveryManifest?.summary?.conclusion ?? null,
      availabilityStatus: selectedArtifact ? effectivePreviewAvailability.status : 'available',
      availabilityReason: selectedArtifact ? effectivePreviewAvailability.reason : null,
    };
    // The interaction manifest arrives after the file body. Compare the full
    // projection so late revision/family/semantic hydration reaches the header.
    if (!isSameActiveArtifactProjection(activeArtifact, artifact)) {
      onActiveArtifactChange(artifact);
    }
  }, [
    activeArtifact,
    boundArtifactSelection,
    boundInteractionManifest,
    boundInteractionRevision,
    effectivePreviewAvailability.reason,
    effectivePreviewAvailability.status,
    effectiveJobStatus,
    job,
    onActiveArtifactChange,
    result?.deliveryManifest?.status,
    result?.deliveryManifest?.summary?.conclusion,
    selectedArtifact ?? null,
    selectedArtifactKind,
    selectedArtifactUrl,
    viewedRevision,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedArtifact || !selectedArtifactUrl || !activeIsPreviewText) {
      setPreviewText(null);
      setPreviewData(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPreviewLoading(true);
    setPreviewAvailability({ key: previewAvailabilityKey, status: 'checking', reason: null });
    fetch(selectedArtifactUrl)
      .then((resp) => {
        if (!resp.ok) throw new Error('preview failed');
        return resp.text();
      })
      .then((text) => {
        if (cancelled) return;
        setPreviewAvailability({ key: previewAvailabilityKey, status: 'available', reason: null });
        if (/\.(csv|tsv)$/i.test(selectedArtifactName)) {
          setPreviewData(buildPreviewTable(text, selectedArtifactName));
          setPreviewText(null);
          return;
        }
        if (selectedArtifactName.toLowerCase().endsWith('.json')) {
          try {
            setPreviewText(JSON.stringify(JSON.parse(text), null, 2));
          } catch {
            setPreviewText(formatPreviewText(selectedArtifactName, text).slice(0, 12000));
          }
        } else {
          setPreviewText(formatPreviewText(selectedArtifactName, text).slice(0, 12000));
        }
        setPreviewData(null);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewText(null);
          setPreviewData(null);
          const reason = '结果记录仍在，但当前产物文件不可读取。';
          setPreviewAvailability({ key: previewAvailabilityKey, status: 'unavailable', reason });
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeIsPreviewText, previewAvailabilityKey, previewRetryVersion, selectedArtifact, selectedArtifactName, selectedArtifactUrl]);

  // BLOCK-52 P2（图片/结果图引用）：把当前结果图 + artifact 血统派发给 SimpleChat composer。
  const handleQuoteArtifactImage = () => {
    if (!selectedArtifactUrl) return;
    dispatchGewuEvent(gewuEvents.imageQuote, {
      projectId: project.id,
      kind: 'result-artifact',
      name: selectedArtifactName,
      url: selectedArtifactUrl,
      artifact: {
        toolJobId: viewedRevision?.toolJobId || job?.id || '',
        revisionId: viewedRevision?.revisionId,
        artifactId: viewedRevision?.artifactId,
        revisionOrdinal: viewedRevision?.revisionOrdinal,
      },
    });
  };

  const retryCurrentPreview = () => {
    setPreviewAvailability({ key: previewAvailabilityKey, status: 'checking', reason: null });
    setPreviewRetryVersion((value) => value + 1);
  };

  const unavailablePreview = effectivePreviewAvailability.status === 'unavailable' ? (
    <div className={styles.resultPreviewUnavailable} role="alert">
      <Icon name="flag" size={20} />
      <strong>当前产物文件不可用</strong>
      <span>{effectivePreviewAvailability.reason || '结果记录仍在，但无法读取对应文件。'}</span>
      <div>
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={retryCurrentPreview}>重试预览</button>
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
          type="button"
          onClick={() => onAskAgent(`请检查并恢复当前结果文件“${selectedArtifactLabel || selectedArtifactName}”。先说明缺失原因和可恢复边界，不要覆盖原始数据。`)}
        >
          让 Agent 检查
        </button>
      </div>
    </div>
  ) : null;

  const renderPreview = () => {
    if (!selectedArtifact) {
      return <div className={styles.resultPreviewPlaceholder}>未发现可预览的结果文件</div>;
    }
    if (showInteractiveViewer && boundInteractionManifest) {
      return (
        <ScientificInteractionViewer
          language={lang}
          jobId={viewedRevision?.toolJobId || job!.id}
          artifactName={selectedArtifactName}
          manifest={boundInteractionManifest}
          backingTable={boundInteractionBackingTable}
          selection={boundArtifactSelection}
          onSelectionChange={(next) => void handleSelectionChange(next)}
        />
      );
    }
    if (unavailablePreview) return unavailablePreview;
    if (viewerAdapter === 'report' && selectedArtifactUrl) {
      return (
        <iframe
          className={styles.resultReportPreview}
          src={selectedArtifactUrl}
          title={selectedArtifactLabel || selectedArtifact.name}
          sandbox="allow-same-origin"
        />
      );
    }
    if (viewerAdapter === 'image' && selectedArtifactUrl) {
      return (
        <div className={styles.resultPreviewImageColumn}>
          <div className={styles.workspaceMarkdownDiffActions}>
            {/* BLOCK-52 P2（图片/结果图引用）：把当前结果图引用到对话 composer */}
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              onClick={handleQuoteArtifactImage}
              title="把这张结果图引用到对话"
            >
              引用到对话
            </button>
          </div>
          <div className={styles.resultPreviewImageCanvas}>
            <button
              type="button"
              className={styles.resultPreviewImageButton}
              onClick={() => setLightboxSrc(selectedArtifactUrl)}
            >
              <img
                key={`${previewAvailabilityKey}:${previewRetryVersion}`}
                src={selectedArtifactUrl}
                alt={selectedArtifactLabel || selectedArtifact.name}
                className={styles.resultPreviewImage}
                onLoad={() => {
                  setPreviewAvailability({ key: previewAvailabilityKey, status: 'available', reason: null });
                }}
                onError={() => {
                  const reason = '结果记录仍在，但当前产物文件不可读取。';
                  setPreviewAvailability({ key: previewAvailabilityKey, status: 'unavailable', reason });
                }}
              />
            </button>
          </div>
        </div>
      );
    }
    if (previewLoading && !previewText && !previewData) {
      return <div className={styles.resultPreviewPlaceholder}>加载预览中…</div>;
    }
    if (viewerAdapter === 'table' && previewData && previewData.length > 0) {
      const [header, ...rows] = previewData;
      return (
        <div className={styles.csvPreviewBody}>
          <table>
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={`${cell || 'col'}-${idx}`} scope="col">{cell || `列 ${idx + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 24).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{row[cellIndex] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if ((viewerAdapter === 'json' || viewerAdapter === 'text') && previewText) {
      return <pre className={styles.textPreview}>{previewText}</pre>;
    }
    return (
      <div className={styles.resultPreviewPlaceholder}>
        <strong>当前文件暂不支持内嵌预览</strong>
        <span>{selectedArtifact.name}</span>
        {selectedArtifactUrl && (
          <a href={selectedArtifactUrl} target="_blank" rel="noreferrer">打开或下载原文件</a>
        )}
      </div>
    );
  };

  if (!job) {
    return <EmptyAnalysisResult />;
  }

  const selectedDisplayGroup = findResultArtifactPickerOption(
    artifactPickerGroups,
    selectedArtifactName,
  )?.option || null;
  // BLOCK-92 Wave B-2 — 恢复动作/报告生成/复现包导出回调已随
  // useArtifactRecovery / useResultReportActions 外迁。

  const workflowBar = shouldShowWorkflowBar({
    hasWorkflow: Boolean(workflow),
    resumeFrom: workflow?.resumeFrom ?? null,
    hasRecoveryAction: Boolean(recoveryAction),
  }) && workflow ? (
    <div className={styles.resultWorkflowBar} data-state={workflow.resumeFrom || 'completed'}>
      <div className={styles.resultWorkflowBarMain}>
        <span className={styles.resultWorkflowDot} data-terminal={workflow.terminal} />
        <span>
          {workflow.resumeFrom
            ? `当前阶段：${workflowStageLabel(workflow.resumeFrom)}`
            : `结果已校验 · ${workflow.artifactCount} 项产物`}
        </span>
        {/*
          Trust state is stated once, by ResultStudioContextBar, in words the
          user can act on (可信结果 / 需要复核 / 结果已阻断) — see
          describeTruthStatus in result-studio/resultSurface.ts. This rendered
          the same fact a second time as the raw enum (「truth valid」), which
          both duplicated the header and leaked an internal value into a normal
          view, against plan §P4R.3. The bar keeps what only it knows: the
          current stage, the artifact count and the recovery action.
        */}
      </div>
      {recoveryAction && (
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
          type="button"
          disabled={recoveryBusy}
          onClick={() => void requestRecovery()}
        >
          {recoveryBusy ? '处理中…' : recoveryAction.label}
        </button>
      )}
    </div>
  ) : null;
  const recoveryConfirmation = pendingRecovery ? (
    <div className={styles.resultWorkflowConfirmation}>
      <span>确认执行“{pendingRecovery.label}”？该操作会写入任务审计记录。</span>
      <div>
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(false)}>
          取消
        </button>
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(true)}>
          确认执行
        </button>
      </div>
    </div>
  ) : recoveryError ? (
    <div className={styles.resultWorkflowError}>{recoveryError}</div>
  ) : null;

  const toolbarSecondaryActions = result ? (
    <>
      {selectedArtifactName && (
        <span className={styles.resultReportTechnicalName}>{selectedArtifactName}</span>
      )}
      {/* UI-385 — 结果独立窗（「弹出」按钮）退役：结果统一由右栏承载 */}
      {selectedDisplayGroup && selectedDisplayGroup.variants.length > 1 && (
        <div className={styles.resultReportExportLinks}>
          {selectedDisplayGroup.variants
            .filter((artifact) => artifact.name !== selectedDisplayGroup.primary.name && /\.(svg|pdf)$/i.test(artifact.name))
            .map((artifact) => (
              <a
                key={artifact.name}
                href={resolveResultArtifactUrl(artifact.url, buildUrl(artifact.name))}
                target="_blank"
                rel="noreferrer"
              >
                导出 {artifactFormatLabel(artifact)}
              </a>
            ))}
        </div>
      )}
      {reportArtifact && (
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
          type="button"
          disabled={reportGenerating}
          onClick={() => void generateFinalReport()}
        >
          {reportGenerating ? '生成报告中…' : finalReportUrl ? '重新生成 HTML 报告' : '生成 HTML 报告'}
        </button>
      )}
      {finalReportUrl && onOpenBrowser && (
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => onOpenBrowser(finalReportUrl)}>查看 HTML 报告</button>
      )}
      {finalReportUrl && (
        <a href={finalReportUrl} download="final-report.html">导出 HTML 报告</a>
      )}
      {result.deliveryManifest && (
        <>
          <a href={buildUrl('delivery-manifest.json')} target="_blank" rel="noreferrer">查看交付清单</a>
          <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" disabled={replayPackageBusy} onClick={() => void exportReplayPackage()}>
            {replayPackageBusy ? '导出中…' : '导出复现包'}
          </button>
        </>
      )}
      {scientificScriptUrl && (
        <a href={scientificScriptUrl} target="_blank" rel="noreferrer">查看脚本</a>
      )}
      {result.deliveryManifest && (
        <button className="gewu-btn gewu-btn--ghost gewu-btn--sm"
          type="button"
          onClick={() => onAskAgent(`请为任务 ${job.id} 的产物 ${selectedArtifactName} 发起重放验证；先展示输入、资源和副作用确认摘要，不要直接执行。`)}
        >
          重放验证
        </button>
      )}
      {reportGenerationError && <span className={styles.resultReportActionError}>{reportGenerationError}</span>}
      {replayPackageMessage && <span className={styles.resultReportActionStatus}>{replayPackageMessage}</span>}
    </>
  ) : undefined;
  const toolbarTruthStatus = typeof activeArtifact?.truthStatus === 'string'
    ? activeArtifact.truthStatus
    : typeof workflow?.artifactTruth?.status === 'string'
      ? workflow.artifactTruth.status
      : null;
  const matchingActiveArtifact = activeArtifact
    && activeArtifact.jobId === (viewedRevision?.toolJobId || job.id)
    && activeArtifact.name === selectedArtifactName
    ? activeArtifact
    : null;
  const versionFamilyId = viewedRevision?.artifactFamilyId
    || boundInteractionManifest?.artifactFamilyId
    || matchingActiveArtifact?.artifactFamilyId
    || null;
  const versionRevisionId = viewedRevision?.revisionId
    || boundInteractionManifest?.revisionId
    || matchingActiveArtifact?.revisionId
    || null;
  const versionRevisionOrdinal = viewedRevision?.revisionOrdinal
    || boundInteractionRevision?.revisionOrdinal
    || matchingActiveArtifact?.revisionOrdinal
    || null;

  const resultToolbar = (
    <CompactResultNavigator
      groups={artifactPickerGroups}
      selectedArtifactName={selectedArtifactName || activeArtifact?.name || ''}
      selectedArtifactLabel={selectedArtifactLabel || activeArtifact?.label || activeArtifact?.name || job.name || job.tool_id}
      selectedKindLabel={selectedArtifact ? artifactKindLabel(selectedArtifactKind) : '结果'}
      selectedIcon={artifactKindIcon(selectedArtifactKind)}
      selectedArtifactUrl={
        selectedArtifactUrl && effectivePreviewAvailability.status !== 'unavailable'
          ? selectedArtifactUrl
          : undefined
      }
      relatedSections={compactRelatedSections}
      secondaryActions={toolbarSecondaryActions}
      truth={describeTruthStatus(toolbarTruthStatus, effectiveJobStatus)}
      availabilityStatus={selectedArtifact ? effectivePreviewAvailability.status : 'checking'}
      activeMode={mode}
      canReviewVersions={Boolean(versionFamilyId)}
      canProjectSource={Boolean(versionRevisionId)}
      canUseInteraction={imageInteractionAvailable}
      interactionActive={interactionPreviewActive}
      onBack={onBack}
      onAskAgent={onAskCurrentResult}
      onInteractionToggle={() => setInteractionPreviewKey((current) => (
        current === interactionBindingKey ? null : interactionBindingKey
      ))}
      onModeChange={onModeChange ? (nextMode) => onModeChange(nextMode, job.id) : undefined}
      onSelectArtifact={(artifactName, sectionId) => {
        beginResultSurfaceMeasure(RESULT_SURFACE_PERFORMANCE_MARKS.artifactStart);
        setViewedRevision(null);
        setSelectedSectionId(sectionId);
        setSelectedName(artifactName);
      }}
    />
  );

  const stateBlock = (title: string, body: React.ReactNode, status: 'running' | 'pending' | 'failed' | 'done') => {
    const containerClass = styles.resultView;
    return (
      <div className={containerClass}>
        {mode === 'result' && resultToolbar}
        {workflowBar}
        {recoveryConfirmation}
        <div className={styles.resultHeader}>
          <strong>{title}</strong>
          <span className={styles.resultStatus} data-status={status}>
            {status === 'running' ? '运行中…' : status === 'pending' ? '排队中' : status === 'failed' ? '失败' : '完成'}
          </span>
        </div>
        {body}
      </div>
    );
  };

  if (effectiveJobStatus === 'running' || effectiveJobStatus === 'pending') {
    return stateBlock(
      job.name || job.tool_id,
      <div className={styles.resultRunning}>
        <div className={styles.spinner} />
        <p>分析正在执行，请稍候…</p>
      </div>,
      effectiveJobStatus
    );
  }

  if (effectiveJobStatus === 'failed') {
    return stateBlock(
      job.name || job.tool_id,
      <pre className={styles.resultError}>{job.error || '执行失败，无错误信息'}</pre>,
      'failed'
    );
  }

  if (loading) {
    return stateBlock(
      job.name || job.tool_id,
      <p className={styles.resultPlaceholder}>加载结果中…</p>,
      'done'
    );
  }

  if (!result) {
    if (resultError) {
      // 网络/服务错误：如实告知并提供重试，绝不谎报为"未生成结果"
      return stateBlock(
        job.name || job.tool_id,
        <div className={styles.resultPlaceholder}>
          <p>结果加载失败：{resultError}</p>
          <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => setResultRetryVersion((value) => value + 1)}>重试</button>
        </div>,
        'done'
      );
    }
    return stateBlock(
      job.name || job.tool_id,
      <p className={styles.resultPlaceholder}>分析已完成，但未生成可视化结果文件。</p>,
      'done'
    );
  }

  const shellBody = (
    <>
      {mode === 'result' && workflowBar}
      {mode === 'result' && recoveryConfirmation}
      {(mode === 'compare' || mode === 'history') && versionFamilyId && (
        <ResultStudioChangeSetPanel
          projectId={project.id}
          artifactFamilyId={versionFamilyId}
          activeRevisionId={versionRevisionId}
          mode={mode}
          onModeChange={(nextMode) => onModeChange?.(nextMode, job.id)}
          onRevisionViewed={(revision) => {
            if (!revision.toolJobId) return;
            setViewedRevision(revision);
            resetInteractionSelection();
            onModeChange?.('result', job.id);
          }}
          onRevisionActivated={(revision) => {
            if (!revision.toolJobId) return;
            setViewedRevision(revision);
            resetInteractionSelection();
            onModeChange?.('result', revision.toolJobId);
            dispatchGewuEvent(gewuEvents.projectOpenArtifact, {
              projectId: project.id,
              jobId: revision.toolJobId,
              artifactName: revision.outputPath.split('/').pop() || revision.artifactId,
            });
            onWorkflowChanged?.();
          }}
        />
      )}
      {mode === 'code' && (
        <RevisionCodeView
          projectId={project.id}
          revisionId={versionRevisionId}
          revisionOrdinal={versionRevisionOrdinal}
          onAgentRequest={onAgentCodeRequest}
          replayContext={replayContext}
          onReplayCreated={() => {
            onWorkflowChanged?.();
            onModeChange?.('compare', job?.id || null);
          }}
          onOpenWorkspaceFile={onOpenRevisionWorkspaceFile}
        />
      )}
      {mode === 'result' && (
      viewedRevision && !viewedRevision.isCurrent ? (
        <section className={styles.resultReportSection} data-viewing="historical-revision">
          <div className={styles.resultSidebarPreviewBody}>{renderPreview()}</div>
        </section>
      ) : (
      <section className={styles.resultReportSection}>
        {selectionError && <div className={styles.resultWorkflowError}>{selectionError}</div>}
        {manifestError && (
          <div className={styles.resultWorkflowError} role="alert">
            <span>结果清单暂不可用；已保留可直接读取的结果文件。</span>
            <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" disabled={manifestLoading} onClick={() => setManifestRetryVersion((value) => value + 1)}>
              {manifestLoading ? '重试中…' : '重试结果清单'}
            </button>
          </div>
        )}
        {interactionError && (
          <div className={styles.resultWorkflowError} role="alert">
            <span>{interactionError}</span>
            <button className="gewu-btn gewu-btn--ghost gewu-btn--sm" type="button" onClick={() => setInteractionRetryVersion((value) => value + 1)}>重试交互能力</button>
          </div>
        )}
        <div className={styles.resultSidebarPreviewBody}>
          {renderPreview()}
        </div>
      </section>
      )
      )}
    </>
  );

  return (
    <div
      className={styles.resultView}
      ref={resultViewRef}
      onScroll={(e) => setResultScrollPosition(job?.id, e.currentTarget.scrollTop)}
      data-artifact-switch-ms={artifactSwitchMs === null ? undefined : artifactSwitchMs.toFixed(2)}
      data-debug-selected-name={selectedArtifactName || null}
      data-debug-artifact-count={artifacts.length}
      data-debug-job-status={effectiveJobStatus}
      data-debug-viewer={viewerAdapter}
      data-debug-revision={viewedRevision?.revisionId || null}
    >
      {mode === 'result' && resultToolbar}
      {shellBody}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}


// UI-305 P2 - moved from ResultView.tsx (only consumer is this shell empty state):
export function EmptyAnalysisResult(): React.ReactElement {
  return (
    <div className="rv-empty">
      <Icon name="bar-chart" size={40} />
      <p>暂无分析结果</p>
      <span>在对话中发起分析后，结果会显示在这里</span>
    </div>
  );
}
