import { useCallback, useEffect, useState } from 'react';
import type { ToolJob } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import type { ResultArtifactRecord } from '@/lib/result-manifest';

// BLOCK-92 Wave B-2 — HTML 报告生成 / 复现包导出状态簇外迁
// （原 ResultArtifactShell 内联，纯搬运零行为变化）。
interface UseResultReportActionsOptions {
  job: ToolJob | null;
  lang: 'r' | 'python';
  buildUrl: (name: string) => string;
  materializedReportArtifact: ResultArtifactRecord | null;
  resolvedTheme: string;
}

export function useResultReportActions(options: UseResultReportActionsOptions): {
  reportGenerating: boolean;
  finalReportUrl: string;
  reportGenerationError: string;
  replayPackageBusy: boolean;
  replayPackageMessage: string;
  generateFinalReport: () => Promise<void>;
  exportReplayPackage: () => Promise<void>;
} {
  const { job, lang, buildUrl, materializedReportArtifact, resolvedTheme } = options;

  const [reportGenerating, setReportGenerating] = useState(false);
  const [finalReportUrl, setFinalReportUrl] = useState('');
  const [reportGenerationError, setReportGenerationError] = useState('');
  const [replayPackageBusy, setReplayPackageBusy] = useState(false);
  const [replayPackageMessage, setReplayPackageMessage] = useState('');

  useEffect(() => {
    setFinalReportUrl('');
    setReportGenerationError('');
  }, [job?.id]);

  useEffect(() => {
    if (!materializedReportArtifact) return;
    setFinalReportUrl(materializedReportArtifact.url || buildUrl(materializedReportArtifact.name));
  }, [buildUrl, materializedReportArtifact]);

  const generateFinalReport = useCallback(async () => {
    if (!job) return;
    setReportGenerating(true);
    setReportGenerationError('');
    try {
      const token = getToken();
      const response = await fetch(`${getApiPrefix(lang)}/tools/report/${encodeURIComponent(job.id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        body: JSON.stringify({ theme: resolvedTheme }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.fileName) throw new Error(data.message || data.error || '报告生成失败');
      setFinalReportUrl(buildUrl(data.fileName));
    } catch (error) {
      setReportGenerationError(error instanceof Error ? error.message : '报告生成失败');
    } finally {
      setReportGenerating(false);
    }
  }, [buildUrl, job, lang, resolvedTheme]);

  const exportReplayPackage = useCallback(async () => {
    if (!job) return;
    setReplayPackageBusy(true);
    setReplayPackageMessage('');
    try {
      const token = getToken();
      const response = await fetch(`${getApiPrefix(lang)}/harness/scientific-task-by-job/${encodeURIComponent(job.id)}/replay-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '复现包导出失败');
      const completeness = data.replayPackageRef?.status === 'complete' ? '完整历史' : '历史部分可用';
      setReplayPackageMessage(`复现包已写入项目结果目录 · ${completeness}`);
    } catch (error) {
      setReplayPackageMessage(error instanceof Error ? error.message : '复现包导出失败');
    } finally {
      setReplayPackageBusy(false);
    }
  }, [job, lang]);

  return {
    reportGenerating,
    finalReportUrl,
    reportGenerationError,
    replayPackageBusy,
    replayPackageMessage,
    generateFinalReport,
    exportReplayPackage,
  };
}
