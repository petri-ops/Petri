import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectCapabilityAxis } from '@/lib/statusProjection';
import {
  enhancePrompt,
  type PromptEnhanceContext,
  type PromptEnhanceResult,
} from '@/lib/promptEnhanceClient';
import button from '@/components/ui/controls/button.module.css';
import styles from './PromptEnhanceDialog.module.css';

const TASK_TYPE_LABEL: Record<string, string> = {
  general: '通用',
  coding: '编码',
  analysis: '分析',
  result: '结果解读',
  workflow: '工作流',
  modeling: '建模',
};

function Section({ title, items }: { title: string; items: string[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <section className={styles.section}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </section>
  );
}

export function PromptEnhanceDialog({
  prompt,
  context,
  onApply,
  onInsert,
  onClose,
}: {
  prompt: string;
  context: PromptEnhanceContext;
  onApply: (next: string) => void;
  onInsert: (original: string, optimized: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<PromptEnhanceResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    enhancePrompt({ prompt, context, signal: controller.signal })
      .then((next) => {
        setResult(next);
        setLoading(false);
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'prompt_enhance_failed');
        setResult(null);
        setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, context, prompt]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.optimizedPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-enhance-title"
        onKeyDown={onKeyDown}
        data-testid="prompt-enhance-dialog"
      >
        <header className={styles.header}>
          <span className={styles.titleRow}>
            <Icon name="sparkles" size={16} />
            <h3 id="prompt-enhance-title">优化提示词</h3>
          </span>
          <span className={styles.truth}>仅预览 · 不自动发送</span>
          <button ref={closeRef} type="button" className={button.ghost} aria-label="关闭提示词增强" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading} role="status">
              <span className={styles.spinner} aria-hidden />
              正在结合当前项目上下文生成 TaskSpec 草稿…
            </div>
          ) : null}
          {error ? (
            <div className={styles.errorBox} role="alert">
              <p>优化失败：{error}。原稿未修改。</p>
              <button
                type="button"
                className={button.ghost}
                onClick={() => {
                  setResult(null);
                  setError(null);
                  setLoading(true);
                  setAttempt((value) => value + 1);
                }}
              >
                重试
              </button>
            </div>
          ) : null}
          {result ? (
            <>
              <section className={styles.block}>
                <div className={styles.blockHead}>
                  <h4>优化后提示词</h4>
                  <span className={styles.meta}>{TASK_TYPE_LABEL[result.taskSpec.taskType] || result.taskSpec.taskType} · {result.model || '当前模型'}</span>
                </div>
                <p className={styles.promptText} data-testid="prompt-enhance-result">{result.optimizedPrompt}</p>
              </section>

              <section className={styles.block} data-testid="task-spec">
                <div className={styles.blockHead}>
                  <h4>TaskSpec</h4>
                  <span className={styles.meta}>{result.taskSpec.version}</span>
                </div>
                <p className={styles.goal}>{result.taskSpec.goal}</p>
                <div className={styles.grid}>
                  <Section title="交付物" items={result.taskSpec.deliverables} />
                  <Section title="约束" items={result.taskSpec.constraints} />
                  <Section title="假设" items={result.taskSpec.assumptions} />
                  <Section title="验收" items={result.taskSpec.acceptance} />
                  <Section title="仍需补充" items={result.taskSpec.missingInfo} />
                  <Section title="改变摘要" items={result.changeSummary} />
                </div>
              </section>

              <section className={styles.block}>
                <div className={styles.blockHead}><h4>使用上下文与能力</h4></div>
                <div className={styles.capabilities}>
                  {result.capabilitySnapshot.map((row) => {
                    const projection = projectCapabilityAxis(row.status);
                    return (
                      <span key={row.id} className={styles.capabilityRow} title={row.reason || row.note}>
                        <span>{row.id}</span>
                        <StatusBadge projection={projection} />
                      </span>
                    );
                  })}
                </div>
                <p className={styles.contextUsed}>{result.contextUsed.length > 0 ? result.contextUsed.join(' · ') : '仅使用原始提示词'}</p>
              </section>

              <section className={styles.block}>
                <div className={styles.blockHead}><h4>原稿</h4></div>
                <p className={styles.original} data-testid="prompt-enhance-original">{prompt}</p>
              </section>
            </>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={button.ghost} onClick={onClose}>保留原稿</button>
          <button type="button" className={button.ghost} disabled={!result || copied} onClick={() => void copy()}>
            {copied ? '已复制' : '复制'}
          </button>
          <button type="button" className={button.ghost} disabled={!result} onClick={() => result && onInsert(prompt, result.optimizedPrompt)}>
            插入原文后
          </button>
          <button type="button" className={button.primary} disabled={!result} onClick={() => result && onApply(result.optimizedPrompt)}>
            替换原稿
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
