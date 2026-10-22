// BLOCK-244 Q1-REM — 审批控制面收尾的状态簇（完全访问确认 / 结构化提问 /
// 编辑重发 checkpoint）。纯搬运自 SimpleChat 内联段，零行为变化；JSX 面见
// ../ApprovalSurfaces.tsx。
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { findTurnCheckpoint, type TurnCheckpoint } from '@/lib/turn-checkpoints';
import {
  clearConversationRun,
  getConversationRunSnapshot,
} from '../../conversationRunStore';
import { saveConversationDraft } from '../../conversationDraft';
import type { SimpleMessage } from '../types';
import type { AccessMode } from './useModelAccessMenus';

interface QuestionLike {
  needQuestion?: boolean;
  questionId?: string;
  question?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
  multiSelect?: boolean;
  allowFreeText?: boolean;
  answered?: boolean;
  timedOut?: boolean;
}

interface ToolActivityLike {
  name?: string;
  question?: QuestionLike;
}

interface UseApprovalSurfacesOptions {
  conversationId: string | null;
  projectId: string;
  activeRun: { toolActivities?: unknown[] } | null | undefined;
  messages: SimpleMessage[];
  setMessages: Dispatch<SetStateAction<SimpleMessage[]>>;
  setInput: (value: string) => void;
  taRef: MutableRefObject<HTMLTextAreaElement | null>;
  streaming: boolean;
  setAccessMode: Dispatch<SetStateAction<AccessMode>>;
}

interface PendingCheckpointEdit {
  message: SimpleMessage;
  checkpoint: TurnCheckpoint;
}

interface PendingUserQuestion {
  questionId: string;
  question: string;
  options: Array<{ id: string; label: string; description?: string }>;
  multiSelect: boolean;
  allowFreeText: boolean;
  toolName: string;
}

export interface ApprovalSurfacesState {
  fullAccessConfirmOpen: boolean;
  requestFullAccess: () => void;
  cancelFullAccess: () => void;
  confirmFullAccess: () => void;
  pendingUserQuestion: PendingUserQuestion | null;
  userQuestionBusy: boolean;
  userQuestionNotice: string | null;
  handleAnswerQuestion: (answer: { selected: string[]; text: string }) => void;
  handleEditUserMessage: (message: SimpleMessage) => void;
  pendingCheckpointEdit: PendingCheckpointEdit | null;
  checkpointEditBusy: boolean;
  checkpointEditError: string | null;
  handleCheckpointRollback: () => void;
  handleCheckpointResend: () => void;
  handleCheckpointCancel: () => void;
}

const FULL_ACCESS_STORAGE_KEY = 'petri_full_access_confirmed';

function derivePendingUserQuestion(
  activeRun: { toolActivities?: unknown[] } | null | undefined,
  answeredQuestionIds: string[],
): PendingUserQuestion | null {
  const acts = (activeRun?.toolActivities || []) as ToolActivityLike[];
  for (let i = acts.length - 1; i >= 0; i -= 1) {
    const activity = acts[i];
    const question = activity.question;
    if (!question || !question.questionId) continue;
    if (question.answered === true || question.timedOut === true || question.needQuestion === false) continue;
    if (answeredQuestionIds.includes(question.questionId)) continue;
    return {
      questionId: question.questionId,
      question: question.question || '',
      options: Array.isArray(question.options) ? question.options : [],
      multiSelect: question.multiSelect === true,
      allowFreeText: question.allowFreeText !== false,
      toolName: activity.name || '',
    };
  }
  return null;
}

export function useApprovalSurfaces(options: UseApprovalSurfacesOptions): ApprovalSurfacesState {
  const {
    conversationId,
    projectId,
    activeRun,
    messages,
    setMessages,
    setInput,
    taRef,
    streaming,
    setAccessMode,
  } = options;

  const [fullAccessConfirmOpen, setFullAccessConfirmOpen] = useState(false);
  const [fullAccessConfirmed, setFullAccessConfirmed] = useState(() => {
    try { return window.sessionStorage.getItem(FULL_ACCESS_STORAGE_KEY) === '1'; } catch { return false; }
  });

  const confirmFullAccess = useCallback(() => {
    setAccessMode('full');
    setFullAccessConfirmed(true);
    try { window.sessionStorage.setItem(FULL_ACCESS_STORAGE_KEY, '1'); } catch { /* sessionStorage 不可用不阻塞 */ }
    setFullAccessConfirmOpen(false);
  }, [setAccessMode]);

  const cancelFullAccess = useCallback(() => setFullAccessConfirmOpen(false), []);
  const requestFullAccess = useCallback(() => {
    if (fullAccessConfirmed) {
      setAccessMode('full');
      return;
    }
    setFullAccessConfirmOpen(true);
  }, [fullAccessConfirmed, setAccessMode]);

  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<string[]>([]);
  const [userQuestionBusy, setUserQuestionBusy] = useState(false);
  const [userQuestionNotice, setUserQuestionNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!userQuestionNotice) return undefined;
    const timer = window.setTimeout(() => setUserQuestionNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [userQuestionNotice]);

  const pendingUserQuestion = derivePendingUserQuestion(activeRun, answeredQuestionIds);

  const handleAnswerQuestion = useCallback((answer: { selected: string[]; text: string }) => {
    if (!pendingUserQuestion || !conversationId || userQuestionBusy) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    if (!runTaskId) {
      setUserQuestionNotice('回答未送达：当前运行已结束，请重新发起。');
      return;
    }
    setUserQuestionBusy(true);
    void fetch(
      getPlatformApiPrefix()
      + '/ai/agent/task/' + encodeURIComponent(runTaskId)
      + '/question/' + encodeURIComponent(pendingUserQuestion.questionId),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
        },
        body: JSON.stringify({ answer }),
      },
    )
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ok?: unknown; message?: unknown; error?: unknown };
        if (data && data.ok) {
          setAnsweredQuestionIds((current) => [...current, pendingUserQuestion.questionId]);
          setUserQuestionNotice(null);
          return;
        }
        const reason = typeof data.message === 'string' && data.message
          ? data.message
          : typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`;
        setUserQuestionNotice(`回答未送达：${reason}`);
      })
      .catch(() => setUserQuestionNotice('回答未送达：网络错误，请重试。'))
      .finally(() => setUserQuestionBusy(false));
  }, [conversationId, pendingUserQuestion, userQuestionBusy]);

  const [pendingCheckpointEdit, setPendingCheckpointEdit] = useState<PendingCheckpointEdit | null>(null);
  const [checkpointEditBusy, setCheckpointEditBusy] = useState(false);
  const [checkpointEditError, setCheckpointEditError] = useState<string | null>(null);

  const applyUserMessageEdit = useCallback((message: SimpleMessage) => {
    const idx = messages.indexOf(message);
    if (idx < 0) return;
    setMessages(messages.slice(0, idx));
    if (conversationId) clearConversationRun(conversationId);
    const content = message.content ?? '';
    setInput(content);
    try { saveConversationDraft(projectId, conversationId, content); } catch { /* 草稿面失败不阻塞 */ }
    if (taRef.current) {
      taRef.current.focus();
      const len = content.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [conversationId, messages, projectId, setInput, setMessages, taRef]);

  const handleEditUserMessage = useCallback((message: SimpleMessage) => {
    if (streaming) return;
    if (messages.indexOf(message) < 0) return;
    const checkpoint = conversationId ? findTurnCheckpoint(conversationId, message.content ?? '') : null;
    if (checkpoint) {
      setCheckpointEditError(null);
      setPendingCheckpointEdit({ message, checkpoint });
      return;
    }
    applyUserMessageEdit(message);
  }, [applyUserMessageEdit, conversationId, messages, streaming]);

  const handleCheckpointRollback = useCallback(() => {
    if (!pendingCheckpointEdit) return;
    const bridge = getBridge('workingTreeReview');
    if (!bridge || typeof bridge.checkpointRollback !== 'function') {
      setCheckpointEditError('当前环境不支持工作树回退。');
      return;
    }
    setCheckpointEditBusy(true);
    setCheckpointEditError(null);
    void bridge.checkpointRollback({
      ...(projectId ? { projectId } : {}),
      ref: pendingCheckpointEdit.checkpoint.ref,
    }).then((result) => {
      if (!result || !result.ok || !result.data || result.data.ok !== true) {
        setCheckpointEditError(result?.message || result?.data?.message || '回退失败，未重发。');
        return;
      }
      applyUserMessageEdit(pendingCheckpointEdit.message);
      setPendingCheckpointEdit(null);
    }).catch((reason) => {
      setCheckpointEditError(reason instanceof Error ? reason.message : '回退失败，未重发。');
    }).finally(() => setCheckpointEditBusy(false));
  }, [applyUserMessageEdit, pendingCheckpointEdit, projectId]);

  const handleCheckpointResend = useCallback(() => {
    if (!pendingCheckpointEdit) return;
    applyUserMessageEdit(pendingCheckpointEdit.message);
    setPendingCheckpointEdit(null);
  }, [applyUserMessageEdit, pendingCheckpointEdit]);

  const handleCheckpointCancel = useCallback(() => {
    if (checkpointEditBusy) return;
    setPendingCheckpointEdit(null);
    setCheckpointEditError(null);
  }, [checkpointEditBusy]);

  return {
    fullAccessConfirmOpen,
    requestFullAccess,
    cancelFullAccess,
    confirmFullAccess,
    pendingUserQuestion,
    userQuestionBusy,
    userQuestionNotice,
    handleAnswerQuestion,
    handleEditUserMessage,
    pendingCheckpointEdit,
    checkpointEditBusy,
    checkpointEditError,
    handleCheckpointRollback,
    handleCheckpointResend,
    handleCheckpointCancel,
  };
}
