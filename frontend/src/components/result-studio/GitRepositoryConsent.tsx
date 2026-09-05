import React from 'react';
import {
  fetchRepositoryBinding,
  submitExistingRepositoryConsent,
  type RepositoryBindingStatus,
} from './resultStudioClient';
import styles from './GitRepositoryConsent.module.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: RepositoryBindingStatus };

/**
 * 用户自有 Git 仓库的显式同意 UI。
 *
 * 后端在 `e14a8e6` 已把"是否授权 Gewu 把 Result Studio 历史写入用户自有仓库"
 * 收敛为独立持久 consent truth，生产调用零硬编码 `true`。本组件只消费后端投影：
 * 当 `decisionRequired` 为 true 时展示 detected / dirty 风险与肯定式 opt-in；
 * 一旦用户明确同意，才调用 `submitExistingRepositoryConsent`。绝不在前端伪造同意。
 *
 * 本组件仅提供用户明示授权边界；开发态 UI 证据不得外推 packaged 或 P7 资格。
 */
export function GitRepositoryConsent({ projectId }: { projectId: string }): React.ReactElement | null {
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchRepositoryBinding(projectId)
      .then((status) => setState({ kind: 'ready', status }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : '读取仓库绑定状态失败' });
      });
    return () => controller.abort();
  }, [projectId]);

  React.useEffect(() => load(), [load]);

  const handleOptIn = React.useCallback(() => {
    if (!projectId || submitting) return;
    setSubmitting(true);
    submitExistingRepositoryConsent(projectId)
      .then(() => load())
      .catch((err: unknown) => {
        setState({ kind: 'error', message: err instanceof Error ? err.message : '提交同意失败' });
      })
      .finally(() => setSubmitting(false));
  }, [projectId, submitting, load]);

  if (state.kind === 'loading') {
    return (
      <section className={styles.consent} data-state="loading" aria-busy="true" role="status">
        <p className={styles.line}>正在读取项目 Git 仓库绑定状态…</p>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className={styles.consent} data-state="error" role="alert">
        <p className={styles.line}>仓库同意状态读取失败：{state.message}</p>
        <button type="button" className={styles.action} onClick={load}>重试</button>
      </section>
    );
  }

  const { status } = state;

  // 已授权：展示当前 consent 与绑定状态，不再打扰用户。
  if (status.existingRepositoryConsent?.allowExistingRepository) {
    const bindingLabel = status.binding
      ? `绑定模式 ${status.binding.mode}（${status.binding.status}）`
      : '尚未建立运行态绑定';
    return (
      <section className={styles.consent} data-state="consented">
        <p className={styles.line}>
          已授权 Gewu 将 Result Studio 历史写入此项目的自有 Git 仓库。{bindingLabel}。
        </p>
      </section>
    );
  }

  // 未检测到用户自有仓库：无需同意，静默不渲染。
  if (!status.existingRepositoryDetected) {
    return null;
  }

  // 检测到用户自有仓库但未授权：展示风险并提供肯定式 opt-in。
  if (status.decisionRequired) {
    return (
      <section className={styles.consent} data-state="decision-required" role="group" aria-label="Git 仓库同意">
        <p className={styles.title}>检测到项目目录中已有 Git 仓库</p>
        <p className={styles.line}>
          Gewu 想把 Result Studio 的版本历史写入你自己的仓库。这需要你的明确授权——
          默认只使用 Gewu 受管理的私有存储，不会触碰你的仓库。
        </p>
        {status.existingRepositoryDirty && (
          <p className={styles.warning}>
            当前仓库有未提交改动。授权不会自动暂存、提交或覆盖这些改动；
            如改动与 Result Studio 管理路径冲突，后续写入将被阻止。
          </p>
        )}
        {status.managedRepositoryExists && (
          <p className={styles.hint}>注意：当前项目已存在 Gewu 受管理仓库，附加自有仓库前请确认不会覆盖未提交的改动。</p>
        )}
        <button
          type="button"
          className={styles.action}
          onClick={handleOptIn}
          disabled={submitting}
        >
          {submitting ? '正在授权…' : '授权 Gewu 写入我的仓库'}
        </button>
      </section>
    );
  }

  // 检测到仓库、已授权为 false、但后端判定无需决策（边界态）：展示只读提示。
  return (
    <section className={styles.consent} data-state="detected">
      <p className={styles.line}>项目目录中存在 Git 仓库，但当前未授权 Gewu 写入。Result Studio 历史将只保存在受管理存储中。</p>
    </section>
  );
}
