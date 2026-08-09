import { useCallback, useEffect, useRef, useState } from 'react';
import { listProjectJobs } from '@/lib/project-store';
import type { ToolJob } from '@/lib/project-types';

export function projectConversationJobs(
  jobs: ToolJob[],
  conversationId: string | null | undefined,
): ToolJob[] {
  if (!conversationId) return [];
  return jobs.filter((job) => job.conversationId === conversationId);
}

export function artifactAfterJobSelection<T>(
  artifact: T | null,
  currentJobId: string | null,
  nextJobId: string | null,
): T | null {
  return currentJobId === nextJobId ? artifact : null;
}

export function canCommitJobOpen(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}

export function useConversationJobs(
  projectId: string | null | undefined,
  conversationId: string | null | undefined,
  pollMs = 15_000,
): {
  jobs: ToolJob[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ToolJob[]>;
} {
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!projectId || !conversationId) {
      setJobs([]);
      setLoading(false);
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const loaded = projectConversationJobs(
        await listProjectJobs(projectId, conversationId),
        conversationId,
      );
      if (requestSequence.current === requestId) {
        setJobs(loaded);
        setLoading(false);
      }
      return loaded;
    } catch (reason) {
      if (requestSequence.current === requestId) {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : '结果列表加载失败');
      }
      return [];
    }
  }, [conversationId, projectId]);

  useEffect(() => {
    setJobs([]);
    setError(null);
    void refresh();
    if (!projectId || !conversationId || pollMs <= 0) {
      return () => {
        requestSequence.current += 1;
      };
    }
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
    };
  }, [conversationId, pollMs, projectId, refresh]);

  return { jobs, loading, error, refresh };
}
