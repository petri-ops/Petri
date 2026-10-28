// ============================================================
// ResultArtifactShell - UI-305 P2 extracted from ResultView.tsx (lines 165-1533),
// behavior unchanged; main file imports it back as needed.
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Project, ToolJob } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { ErrorNotice } from '@/components/ui/controls/Status';
import { findCatalogTool, useToolCatalog } from '@/lib/tool-catalog';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import { csvPreviewPageCount, csvPreviewPageRows } from '@/lib/csv-preview-pagination';
import { Lightbox } from '@/components/ui/Lightbox';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import { useTheme } from '@/themes/ThemeProvider';
import { type HarnessWorkflowJobState } from '@/lib/harness-client';
import {
  normalizeResultManifest,
  classifyArtifact,
  buildResultArtifactNavigation,
  findArtifactByName,
  pickPreferredArtifact,
  artifactKindLabel,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import {
  artifactFormatLabel,
  buildResultArtifactPickerGroups,
  filterResultArtifactRelatedSections,
  findResultArtifactPickerOption,
  isRelatedArtifactKind,
} from '@/lib/result-artifact-display';
import { ResultStudioChangeSetPanel } from '@/components/result-studio/ResultStudioChangeSetPanel';
import { isSameActiveArtifactProjection, withHydratedArtifactIdentity } from '@/components/result-studio/activeArtifactProjection';
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
// BLOCK-138 P1 — 血缘形态切换（条带默认 + LineageGraph 画布并存，plan D1）
import { LineageViewSwitch } from '@/components/result-studio/LineageViewSwitch';
// BLOCK-140 P0 — 多 artifact 分屏：钉住=视图级快照（plan D1），副栏 result 模式专属
import { ArtifactPinPane, type ArtifactPinSnapshot } from './ArtifactPinPane';
// BLOCK-140 P1 — 跨 job 钉住：血缘节点「钉住」→ 按既有打开链同源数据源构建快照
import { fetchCrossJobPinSnapshot } from './crossJobPinSnapshot';
// BLOCK-142 切片 E — md/xlsx/pdf 三 viewer（注册表 spreadsheet/markdown/pdf adapter 的挂载面）
import { SegmentBoundary } from '@/components/shell/SegmentBoundary';
import { MarkdownResultViewer } from './MarkdownResultViewer';
import { SpreadsheetResultViewer } from './SpreadsheetResultViewer';
// BLOCK-219 Q6 — 批注接线（身份推导/两个宿主/不可批注提示）外置，见同目录 resultAnnotation.tsx
import {
  AnnotatedResultPdf,
  AnnotationUnavailableNote,
  ResultImagePreview,
  buildResultAnnotationProps,
} from './ResultArtifactShell/resultAnnotation';
// BLOCK-175 CP-14 — 只读文本族选择总线接线（canSelect 位消费面）
import { viewerProfileCanSelect } from '@/components/result-studio/viewerRegistry';
import { useArtifactTextSelection } from './ResultArtifactShell/useArtifactTextSelection';
import {
  beginResultSurfaceMeasure,
  chooseResultArtifactName,
  completeResultSurfaceMeasure,
  describeTruthStatus,
  RESULT_SURFACE_PERFORMANCE_MARKS,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  shouldShowResultInteraction,
  type ResultSurfaceMode,
} from '@/components/result-studio/resultSurface';
import styles from '@/pages/project-workspace.module.css';
// BLOCK-92 Wave B-2 — 状态簇外迁（./ResultArtifactShell/，纯搬运零行为变化）。
import { useArtifactRecovery } from './ResultArtifactShell/useArtifactRecovery';
import { useResultReportActions } from './ResultArtifactShell/useResultReportActions';
import { useArtifactInteractionSelection } from './ResultArtifactShell/useArtifactInteractionSelection';
// BLOCK-151 B 轨（审视吸收二波）— viewerRegistry canExport 声明位消费面。
import { ViewerExportAction } from './ResultArtifactShell/ViewerExportAction';
import { isTextFile, isMarkdownFile, formatPreviewText } from '@/lib/previewFileUtils';
import {
  artifactName,
  artifactKindIcon,
  workflowStageLabel,
} from './ResultView/helpers';
import type {
  ActiveArtifact,
  JobResult,
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
  onAskAgent: (prompt: string, options?: { compose?: boolean }) => void;
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
  const [manifestRaw, setManifestRaw] = useState<unknown>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState('');
  const [manifestRetryVersion, setManifestRetryVersion] = useState(0);
  const [selectedName, setSelectedName] = useState('');
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  // UI-454：静态 CSV 预览本地分页页码；previewData 更新时在读取 effect 内重置。
  const [csvPreviewPage, setCsvPreviewPage] = useState(0);
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
  // job 切换时重置查看态：render 期 adjust-state（React「You Might Not Need an Effect」官方模式，
  // 替代原 effect 同步 setState——同一提交内生效，少一次级联 render）。
  const [prevViewedJobId, setPrevViewedJobId] = useState<string | null>(job?.id ?? null);
  if ((job?.id ?? null) !== prevViewedJobId) {
    setPrevViewedJobId(job?.id ?? null);
    setViewedRevision((current) => revisionAfterJobSelection(current, job?.id ?? null));
  }
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [artifactSwitchMs, setArtifactSwitchMs] = useState<number | null>(null);
  // BLOCK-140 P0 — 钉住副栏快照：pin 时刻捕获当前产物渲染载荷（视图级快照，
  // 非第二数据通道）；主区切换产物/版本不触碰此状态，mode≠result 时副栏由
  // ArtifactPinPane 自隐（快照保留，回到 result 恢复双栏），解除钉住恢复单栏。
  const [pinnedArtifact, setPinnedArtifact] = useState<ArtifactPinSnapshot | null>(null);

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
      // BLOCK-132（PL-6）：token 常量无鉴权价值（后端无条件放行）——URL 不再携带。
      return `${base}/tools/file/${job.id}/${encodeURIComponent(name)}`;
    },
    [job?.id, lang]
  );
  const scientificScriptUrl = useMemo(() => {
    if (!job || !result?.deliveryManifest) return '';
    // BLOCK-132（PL-6）：token 常量无鉴权价值（后端无条件放行）——URL 不再携带。
    return `${getApiPrefix(lang)}/harness/scientific-task-by-job/${encodeURIComponent(job.id)}/script`;
  }, [job?.id, lang, result?.deliveryManifest]);

  // BLOCK-140 P1 — 跨 job 钉住：血缘节点「钉住」→ 拉目标 job 产物构建视图级快照
  // （一次取数；副栏照常零取数渲染）。失败不猜、不动现有钉住态（D1 语义不变）；
  // BLOCK-169 A4-1 — 失败不再静默：行内提示用户可见（job 无产物/网络失败分文案）。
  const [lineagePinNotice, setLineagePinNotice] = useState('');
  const handleLineagePin = useCallback((request: { projectId: string | null; toolJobId: string }) => {
    void fetchCrossJobPinSnapshot({ toolJobId: request.toolJobId, lang }).then((snapshot) => {
      if (snapshot) {
        setPinnedArtifact(snapshot);
        setLineagePinNotice('');
        return;
      }
      setLineagePinNotice(`钉住失败：job ${request.toolJobId} 无可用产物或取数失败，已保留现有钉住态`);
    });
  }, [lang]);

  useEffect(() => {
    if (!job) {
      bodyJobRef.current = null;
      setResult(null);
      setResultError('');
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
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
        setSelectedName('');
      }
      void (async () => {
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
          const data = (await resp.json()) as { ok?: unknown; result?: JobResult; params?: Record<string, unknown>; ackStatus?: string | null; projectId?: string | null; error?: unknown };
          if (!canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) return;
          if (data.ok && data.result) {
            bodyJobRef.current = requestedJobId;
            setResult(data.result);
            setResultError('');
          } else if (!data.ok) {
            // 服务显式报错：如实展示，不归入"未生成结果"
            setResultError(typeof data.error === 'string' && data.error ? data.error : '结果服务返回失败');
          }
          // data.ok 但无 result：确实没有结果文件，保持 resultError 为空，
          // 由 !result 分支展示"未生成可视化结果文件"
        } catch (e) {
          // 网络层失败（服务不可达/超时）：必须让用户知道是连接问题而非"没有结果"
          if (canCommitResultFetch(requestedJobId, activeBodyJobRef.current, cancelled)) {
            setResultError(e instanceof Error ? e.message : '网络错误，无法获取结果');
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
      setLoading(false);
      setManifestRaw(null);
      setManifestLoading(false);
      setManifestError('');
      setSelectedName('');
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
    if (!job || effectiveJobStatus !== 'done') {
      onActiveArtifactChange(null);
      return;
    }
    if (!selectedArtifact && !viewedRevision) return; // BLOCK-252 keep hydrated identity
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
      // BLOCK-141 R-5：viewer interaction manifest 的 artifactId 上投影——
      // D2 注入归属校验（useResultStudioEditContext）的可比来源。
      artifactId: boundInteractionManifest?.artifactId ?? null,
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
    // Interaction manifest arrives after the file body; compare full projection for late hydration.
    const projected = withHydratedArtifactIdentity(activeArtifact, artifact, selectedArtifactName, viewedRevision);
    if (!isSameActiveArtifactProjection(activeArtifact, projected)) onActiveArtifactChange(projected);
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
          setCsvPreviewPage(0);
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

  // BLOCK-219 Q6 — 批注身份：权威坐标 (artifactId, revisionId)；缺 artifactId 即不可批注。
  const annotationProps = buildResultAnnotationProps({ projectId: project.id, revision: viewedRevision, jobId: job?.id ?? null, artifactName: selectedArtifactLabel || selectedArtifactName || null });

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
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={retryCurrentPreview}>重试预览</button>
        <button className="petri-btn petri-btn--ghost petri-btn--sm"
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
        <ResultImagePreview
          key={`${previewAvailabilityKey}:${previewRetryVersion}`}
          url={selectedArtifactUrl}
          alt={selectedArtifactLabel || selectedArtifact.name}
          name={selectedArtifactName}
          projectId={project.id}
          artifact={{
            toolJobId: viewedRevision?.toolJobId || job?.id || '',
            revisionId: viewedRevision?.revisionId,
            artifactId: viewedRevision?.artifactId,
            revisionOrdinal: viewedRevision?.revisionOrdinal,
          }}
          conversationId={conversationId ?? null}
          onAddToContext={(prompt) => onAskAgent(prompt, { compose: true })}
          onLightbox={() => setLightboxSrc(selectedArtifactUrl)}
          onImageLoad={() => setPreviewAvailability({ key: previewAvailabilityKey, status: 'available', reason: null })}
          onImageError={() => setPreviewAvailability({
            key: previewAvailabilityKey, status: 'unavailable', reason: '结果记录仍在，但当前产物文件不可读取。',
          })}
          {...annotationProps}
        />
      );
    }
    // BLOCK-142 切片 E — markdown/spreadsheet/pdf 三分支：组件自取数（产物 URL 同
    // 既有分支 selectedArtifactUrl），故置于 shell previewText 载荷闸门之前。
    // BLOCK-151 B 轨：markdown/pdf 分支叠加 ViewerExportAction（viewerRegistry
    // canExport=true 档案消费——此前声明位零消费，挂载面无打开/导出出口）；
    // spreadsheet 档案 canExport=false → 出口自然不在场。viewer 渲染面不变。
    if (viewerAdapter === 'markdown' && selectedArtifactUrl) {
      return (
        <>
          <ViewerExportAction adapter={viewerAdapter} url={selectedArtifactUrl} />
          <MarkdownResultViewer
            url={selectedArtifactUrl}
            name={selectedArtifactLabel || selectedArtifact.name}
          />
        </>
      );
    }
    if (viewerAdapter === 'spreadsheet' && selectedArtifactUrl) {
      return (
        <>
          <SpreadsheetResultViewer
            url={selectedArtifactUrl}
            name={selectedArtifactLabel || selectedArtifact.name}
          />
          {/* BLOCK-219 Q6 — 表格类产物无文本层可锚定；如实说明而不是给死按钮 */}
          <AnnotationUnavailableNote />
        </>
      );
    }
    if (viewerAdapter === 'pdf' && selectedArtifactUrl) {
      return (
        <>
          <ViewerExportAction adapter={viewerAdapter} url={selectedArtifactUrl} />
          <AnnotatedResultPdf
            url={selectedArtifactUrl}
            name={selectedArtifactLabel || selectedArtifact.name}
            conversationId={conversationId ?? null}
            onAddToContext={(prompt) => onAskAgent(prompt, { compose: true })}
            {...annotationProps}
          />
        </>
      );
    }
    if (previewLoading && !previewText && !previewData) {
      return <div className={styles.resultPreviewPlaceholder}>加载预览中…</div>;
    }
    if (viewerAdapter === 'table' && previewData && previewData.length > 0) {
      const [header, ...rows] = previewData;
      const pageCount = csvPreviewPageCount(rows.length);
      const pageRows = csvPreviewPageRows(rows, csvPreviewPage);
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
              {pageRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {header.map((_, cellIndex) => (
                    <td key={cellIndex}>{row[cellIndex] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.csvPreviewPager}>
            <span>共 {rows.length.toLocaleString()} 行（预览文本预算内） · 第 {Math.min(csvPreviewPage, pageCount - 1) + 1}/{pageCount} 页</span>
            <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={csvPreviewPage <= 0} onClick={() => setCsvPreviewPage((p) => Math.max(0, p - 1))}>上一页</button>
            <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={csvPreviewPage >= pageCount - 1} onClick={() => setCsvPreviewPage((p) => Math.min(pageCount - 1, p + 1))}>下一页</button>
          </div>
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
        <AnnotationUnavailableNote />
      </div>
    );
  };

  // BLOCK-175 CP-14 — 只读文本族文本选择→选择总线（canSelect 位消费面）。
  // 容器=预览体包裹层；window 级 pointerup 采样，容器包含判定防跨容器误采。
  // 位置：早退（if !job）之前——hooks 规则要求无条件调用。
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const textSelectionEnabled = viewerProfileCanSelect(viewerAdapter) && activeIsPreviewText
    && Boolean(selectedArtifact) && Boolean(viewedRevision || job);
  useArtifactTextSelection({
    enabled: textSelectionEnabled,
    containerRef: previewBodyRef,
    artifactId: viewedRevision?.revisionId || job?.id || selectedArtifactName,
    revisionId: viewedRevision?.revisionId ?? null,
  });

  if (!job) {
    return <EmptyAnalysisResult />;
  }

  const selectedDisplayGroup = findResultArtifactPickerOption(
    artifactPickerGroups,
    selectedArtifactName,
  )?.option || null;
  // BLOCK-140 P0 — 「钉住」动作：捕获当前查看产物的渲染载荷（renderPreview 同一
  // 渲染路径的现值），副栏据此离线渲染；预览仍在加载时不允许钉出空快照。
  const handlePinArtifact = () => {
    if (!selectedArtifact) return;
    setPinnedArtifact({
      jobId: viewedRevision?.toolJobId || job.id,
      artifactName: selectedArtifactName,
      label: selectedArtifact?.label || selectedArtifact?.title || selectedArtifactName,
      viewerAdapter,
      previewText,
      previewData,
      url: selectedArtifactUrl,
    });
  };
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
        <button className="petri-btn petri-btn--ghost petri-btn--sm"
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
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(false)}>
          取消
        </button>
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={recoveryBusy} onClick={() => void resolveRecovery(true)}>
          确认执行
        </button>
      </div>
    </div>
  ) : recoveryError ? (
    <div className={styles.resultWorkflowError}>{recoveryError}</div>
  ) : null;

  const toolbarSecondaryActions = result ? (
    <>
      {/* BLOCK-140 P0 — 「钉住」：把当前查看产物钉入副栏（视图级快照） */}
      {selectedArtifact && (
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={previewLoading} onClick={handlePinArtifact}>钉住</button>
      )}
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
        <button className="petri-btn petri-btn--ghost petri-btn--sm"
          type="button"
          disabled={reportGenerating}
          onClick={() => void generateFinalReport()}
        >
          {reportGenerating ? '生成报告中…' : finalReportUrl ? '重新生成 HTML 报告' : '生成 HTML 报告'}
        </button>
      )}
      {finalReportUrl && onOpenBrowser && (
        <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={() => onOpenBrowser(finalReportUrl)}>查看 HTML 报告</button>
      )}
      {finalReportUrl && (
        <a href={finalReportUrl} download="final-report.html">导出 HTML 报告</a>
      )}
      {result.deliveryManifest && (
        <>
          <a href={buildUrl('delivery-manifest.json')} target="_blank" rel="noreferrer">查看交付清单</a>
          <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={replayPackageBusy} onClick={() => void exportReplayPackage()}>
            {replayPackageBusy ? '导出中…' : '导出复现包'}
          </button>
        </>
      )}
      {scientificScriptUrl && (
        <a href={scientificScriptUrl} target="_blank" rel="noreferrer">查看脚本</a>
      )}
      {result.deliveryManifest && (
        <button className="petri-btn petri-btn--ghost petri-btn--sm"
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
      jobId={viewedRevision?.toolJobId || job.id}
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
      onSelectArtifact={(artifactName, _sectionId) => {
        beginResultSurfaceMeasure(RESULT_SURFACE_PERFORMANCE_MARKS.artifactStart);
        setViewedRevision(null);
        setSelectedName(artifactName);
      }}
    />
  );

  const stateBlock = (title: string, body: React.ReactNode, status: 'running' | 'pending' | 'failed' | 'done') => {
    const containerClass = styles.resultView;
    return (
      <div className={containerClass}>
        {mode === 'result' && resultToolbar}
        {mode === 'result' && <LineageViewSwitch projectId={project.id} jobId={job.id} onPinArtifact={handleLineagePin} />}
        {mode === 'result' && lineagePinNotice && (
          <div className={styles.resultError} role="status">{lineagePinNotice}</div>
        )}
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
        <ErrorNotice message={`结果加载失败：${resultError}`} onRetry={() => setResultRetryVersion((value) => value + 1)} />,
        'done'
      );
    }
    return stateBlock(
      job.name || job.tool_id,
      <p className={styles.resultPlaceholder}>分析已完成，但未生成可视化结果文件。</p>,
      'done'
    );
  }

  const shellBodyMain = (
    <>
      {/* BLOCK-138 加映：完成态稳定面与 stateBlock（loading/running/failed）同位挂载——
          走查实证切换器此前仅在瞬态区在场，完成态被替换后画布形态不可达 */}
      {mode === 'result' && <LineageViewSwitch projectId={project.id} jobId={job.id} onPinArtifact={handleLineagePin} />}
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
            dispatchPetriEvent(petriEvents.projectOpenArtifact, {
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
          {/* BLOCK-222 Q9 — 预览段独立兜底：异形产物数据不该带走整个结果面 */}
        <div className={styles.resultSidebarPreviewBody} ref={previewBodyRef}>
          <SegmentBoundary segment="result-preview" resetKey={`${viewedRevision?.artifactId || selectedArtifact?.name || ''}:${previewAvailabilityKey}`}>{renderPreview()}</SegmentBoundary>
        </div>
        </section>
      ) : (
      <section className={styles.resultReportSection}>
        {selectionError && <div className={styles.resultWorkflowError}>{selectionError}</div>}
        {manifestError && (
          <div className={styles.resultWorkflowError} role="alert">
            <span>结果清单暂不可用；已保留可直接读取的结果文件。</span>
            <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" disabled={manifestLoading} onClick={() => setManifestRetryVersion((value) => value + 1)}>
              {manifestLoading ? '重试中…' : '重试结果清单'}
            </button>
          </div>
        )}
        {interactionError && (
          <div className={styles.resultWorkflowError} role="alert">
            <span>{interactionError}</span>
            <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={() => setInteractionRetryVersion((value) => value + 1)}>重试交互能力</button>
          </div>
        )}
        <div className={styles.resultSidebarPreviewBody} ref={previewBodyRef}>
          {renderPreview()}
        </div>
      </section>
      )
      )}
    </>
  );
  // BLOCK-140 P0 — 双栏接线：钉住态=主区（现流 renderPreview 投影）+ 副栏快照；
  // mode≠result 或未钉住 → 单栏（ArtifactPinPane 自隐副栏，快照保留归宿主）。
  const shellBody = (
    <ArtifactPinPane
      mode={mode}
      snapshot={pinnedArtifact}
      onUnpin={() => setPinnedArtifact(null)}
    >
      {shellBodyMain}
    </ArtifactPinPane>
  );

  return (
    <div
      className={styles.resultView}
      ref={resultViewRef}
      onScroll={(e) => setResultScrollPosition(job?.id, e.currentTarget.scrollTop)}
      {.../* UI-457（PL-5b）— debug 属性 DEV 门控：生产剥离（曾泄入 dist）；dev 保留供 P6 压测驱动 */ (
        import.meta.env.DEV
        ? {
            'data-artifact-switch-ms': artifactSwitchMs === null ? undefined : artifactSwitchMs.toFixed(2),
            'data-debug-selected-name': selectedArtifactName || null,
            'data-debug-artifact-count': artifacts.length,
            'data-debug-job-status': effectiveJobStatus,
            'data-debug-viewer': viewerAdapter,
            'data-debug-revision': viewedRevision?.revisionId || null,
          }
        : {}
      )}
    >
      {mode === 'result' && resultToolbar}
      {shellBody}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );
}


// UI-305 P2 - moved from ResultView.tsx (only consumer is this shell empty state):
function EmptyAnalysisResult(): React.ReactElement {
  return (
    <div className="rv-empty">
      <Icon name="bar-chart" size={40} />
      <p>暂无分析结果</p>
      <span>在对话中发起分析后，结果会显示在这里</span>
    </div>
  );
}
