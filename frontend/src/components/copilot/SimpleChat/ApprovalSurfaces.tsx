// BLOCK-244 Q1-REM — 审批控制面收尾的渲染面：完全访问确认 / 编辑重发 checkpoint /
// 结构化提问卡 + 送达失败提示。状态与回调见 hooks/useApprovalSurfaces.ts。
import { UserQuestionCard } from './UserQuestionCard';
import { FullAccessConfirmDialog } from './FullAccessConfirmDialog';
import { EditCheckpointDialog } from './EditCheckpointDialog';
import type { ApprovalSurfacesState } from './hooks/useApprovalSurfaces';

export function ApprovalSurfaces({ state }: { state: ApprovalSurfacesState }) {
  const {
    fullAccessConfirmOpen,
    cancelFullAccess,
    confirmFullAccess,
    pendingUserQuestion,
    userQuestionBusy,
    userQuestionNotice,
    handleAnswerQuestion,
    pendingCheckpointEdit,
    checkpointEditBusy,
    checkpointEditError,
    handleCheckpointRollback,
    handleCheckpointResend,
    handleCheckpointCancel,
  } = state;
  return (
    <>
      <FullAccessConfirmDialog
        open={fullAccessConfirmOpen}
        onConfirm={confirmFullAccess}
        onCancel={cancelFullAccess}
      />
      <EditCheckpointDialog
        open={Boolean(pendingCheckpointEdit)}
        at={pendingCheckpointEdit?.checkpoint.at ?? null}
        busy={checkpointEditBusy}
        error={checkpointEditError}
        onRollback={handleCheckpointRollback}
        onResend={handleCheckpointResend}
        onCancel={handleCheckpointCancel}
      />
      {userQuestionNotice && (
        <div className="sc-attachment-notice" role="alert" data-testid="user-question-notice">{userQuestionNotice}</div>
      )}
      {pendingUserQuestion && (
        <UserQuestionCard
          key={pendingUserQuestion.questionId}
          questionId={pendingUserQuestion.questionId}
          question={pendingUserQuestion.question}
          options={pendingUserQuestion.options}
          multiSelect={pendingUserQuestion.multiSelect}
          allowFreeText={pendingUserQuestion.allowFreeText}
          busy={userQuestionBusy}
          onSubmit={handleAnswerQuestion}
        />
      )}
    </>
  );
}
