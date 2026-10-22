import { useMemo, useState } from 'react';
import { Icon } from '@/components/icons/Icon';

/**
 * UserQuestionCard — AskUserQuestion 结构化提问卡（BLOCK-244 Q1-REM C19）。
 *
 * 模型经 ask_user_question 暂停等待；本卡渲染问题/选项/自由输入，
 * 提交后由 task 路由唤醒同一 tool 结果（answered/timedOut 如实回传）。
 */
interface UserQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface UserQuestionCardProps {
  questionId: string;
  question: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
  allowFreeText?: boolean;
  busy?: boolean;
  onSubmit: (answer: { selected: string[]; text: string }) => void;
}

export function UserQuestionCard({
  question,
  options = [],
  multiSelect = false,
  allowFreeText = true,
  busy = false,
  onSubmit,
}: UserQuestionCardProps): React.ReactElement {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');

  const toggle = (id: string) => {
    setSelected((current) => {
      if (multiSelect) {
        return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      }
      return current.includes(id) ? [] : [id];
    });
  };

  const canSubmit = useMemo(
    () => selected.length > 0 || (allowFreeText && text.trim().length > 0),
    [allowFreeText, selected.length, text],
  );

  return (
    <div className="sc-question-card" role="form" aria-label="结构化提问" data-testid="user-question-card">
      <div className="sc-question-card__head">
        <span className="sc-question-card__icon" aria-hidden="true"><Icon name="message-circle" size={14} /></span>
        <span className="sc-question-card__title">需要你的回答</span>
      </div>
      <p className="sc-question-card__question" data-testid="user-question-text">{question}</p>
      {options.length > 0 ? (
        <div className="sc-question-card__options" role={multiSelect ? 'group' : 'radiogroup'} aria-label="选项">
          {options.map((option) => {
            const active = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={`sc-question-card__option${active ? ' is-selected' : ''}`}
                aria-pressed={active}
                disabled={busy}
                data-testid={`user-question-option-${option.id}`}
                onClick={() => toggle(option.id)}
              >
                <span className="sc-question-card__marker">{active ? '✓' : ''}</span>
                <span className="sc-question-card__option-body">
                  <span className="sc-question-card__option-label">{option.label}</span>
                  {option.description ? <span className="sc-question-card__option-desc">{option.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {allowFreeText ? (
        <textarea
          className="sc-question-card__input"
          aria-label="补充回答"
          placeholder={options.length > 0 ? '可补充说明（可选）' : '输入你的回答'}
          value={text}
          rows={2}
          disabled={busy}
          data-testid="user-question-free-text"
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      <div className="sc-question-card__actions">
        <button
          type="button"
          className="sc-question-card__btn sc-question-card__btn-primary"
          disabled={busy || !canSubmit}
          data-testid="user-question-submit"
          onClick={() => onSubmit({ selected, text: text.trim() })}
        >
          {busy ? '提交中…' : '提交回答'}
        </button>
        <button
          type="button"
          className="sc-question-card__btn sc-question-card__btn-ghost"
          disabled={busy}
          data-testid="user-question-skip"
          onClick={() => onSubmit({ selected: [], text: '（用户跳过）' })}
        >
          跳过
        </button>
      </div>
    </div>
  );
}
