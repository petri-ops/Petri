import { unknownText } from '@/lib/unknownText';
import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type {
  ResultStudioEditControl,
  ResultStudioEditControls,
} from '@/lib/result-studio-interaction-client';
import styles from './ResultEditPanel.module.css';

/**
 * G0-RS-P4 — Schema 驱动的统一编辑面板。
 *
 * 不为任何插件手写结果页：控件全部来自后端投影的 descriptor schema，
 * 插件没声明的参数不会出现在这里。P4R-3 后本组件只承担高级精调；
 * 默认入口是结果焦点区的自然语言 Composer。两者产出的 parameterPatch
 * 仍进入同一条 ResultEditIntent → ChangeSet 链。
 *
 * 诚实边界：
 * - 只有 `scientificallyNeutral` 为真的分组才允许标注"不改变科学结论"。
 * - 科学/流程参数必须显式勾选确认才可提交，UI 不代替用户确认。
 * - 面板不写文件、不覆盖 current Revision：提交只产生候选版本请求。
 */

export type EditSubmissionOrigin = 'manual' | 'agent';
export type ResultEditCompletionExpectation = 'candidate' | 'result_action' | 'none';

export interface ResultEditSubmission {
  origin: EditSubmissionOrigin;
  completionExpectation: ResultEditCompletionExpectation;
  requestedOutcome: string;
  parameterPatch: Record<string, unknown>;
  scientificConfirmed: boolean;
  /** P4R-3：只由结果焦点 Composer 携带；不渲染、不写进用户消息。 */
  contextToken?: string | null;
}

const GROUP_HINTS: Record<string, string> = {
  presentation: '只影响呈现，不重新计算科学结论',
  data: '改变数据呈现范围，会重新生成该产物',
  scientific: '改变科学参数，需要重新计算并确认结论变化',
  workflow: '改变方法或流程，需要重新规划下游步骤',
};

function valueOf(
  control: ResultStudioEditControl,
  draft: Record<string, unknown>,
  currentValues: Record<string, unknown>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(draft, control.name)) return draft[control.name];
  if (Object.prototype.hasOwnProperty.call(currentValues, control.name)) return currentValues[control.name];
  return control.default;
}

function isChanged(
  control: ResultStudioEditControl,
  draft: Record<string, unknown>,
  currentValues: Record<string, unknown>,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(draft, control.name)) return false;
  const baseline = Object.prototype.hasOwnProperty.call(currentValues, control.name)
    ? currentValues[control.name]
    : control.default;
  return draft[control.name] !== baseline;
}

function ResultEditControlField({
  control,
  value,
  onChange,
}: {
  control: ResultStudioEditControl;
  value: unknown;
  onChange: (next: unknown) => void;
}): React.ReactElement {
  const inputId = `rs-edit-${control.name}`;
  if (control.controlType === 'select') {
    return (
      <select
        id={inputId}
        value={unknownText(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {(control.options || []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (control.controlType === 'boolean') {
    return (
      <input
        id={inputId}
        type="checkbox"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }
  if (control.controlType === 'color') {
    return (
      <input
        id={inputId}
        type="color"
        value={typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
      />
    );
  }
  if (control.controlType === 'number') {
    return (
      <input
        id={inputId}
        type="number"
        value={unknownText(value)}
        {...(control.minimum === null || control.minimum === undefined ? {} : { min: control.minimum })}
        {...(control.maximum === null || control.maximum === undefined ? {} : { max: control.maximum })}
        step="any"
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? null : Number(raw));
        }}
      />
    );
  }
  return (
    <input
      id={inputId}
      type="text"
      value={unknownText(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ResultEditPanel({
  editControls,
  disabledReason = null,
  submitting = false,
  onSubmit,
}: {
  editControls: ResultStudioEditControls | null;
  disabledReason?: string | null;
  submitting?: boolean;
  onSubmit: (submission: ResultEditSubmission) => void;
}): React.ReactElement | null {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [outcome, setOutcome] = React.useState('');
  const [confirmed, setConfirmed] = React.useState(false);

  const controls = editControls?.controls ?? [];
  const currentValues = editControls?.currentValues ?? {};
  const byName = React.useMemo(
    () => new Map(controls.map((control) => [control.name, control])),
    [controls],
  );

  const changedNames = controls.filter((control) => isChanged(control, draft, currentValues)).map((c) => c.name);
  const patch: Record<string, unknown> = {};
  for (const name of changedNames) patch[name] = draft[name];

  // 影响级别由 descriptor 声明的分组决定，前端不自行推断也不降级。
  const touchesScience = changedNames.some((name) => {
    const group = byName.get(name)?.group;
    return group === 'scientific' || group === 'workflow';
  });
  const needsConfirm = touchesScience;
  const canSubmit = !disabledReason && !submitting && changedNames.length > 0 && (!needsConfirm || confirmed);

  if (!editControls) return null;

  return (
    <section className={styles.panel} aria-label="结果编辑">
      <header className={styles.header}>
        <span>调整这个结果</span>
        {disabledReason && <span className={styles.disabled}>{disabledReason}</span>}
      </header>

      {controls.length === 0 ? (
        <p className={styles.empty}>该插件没有声明可编辑参数，因此这里不提供控件。</p>
      ) : (
        (editControls.groups || []).map((group) => (
          <fieldset key={group.group} className={styles.group} data-group={group.group}>
            <legend>
              {group.label}
              <span className={styles.groupHint}>{GROUP_HINTS[group.group] || ''}</span>
            </legend>
            {group.parameterNames.map((name) => {
              const control = byName.get(name);
              if (!control) return null;
              const value = valueOf(control, draft, currentValues);
              return (
                <label key={name} className={styles.field} data-changed={isChanged(control, draft, currentValues)}>
                  <span className={styles.fieldName}>{name}</span>
                  <ResultEditControlField
                    control={control}
                    value={value}
                    onChange={(next) => setDraft((prev) => ({ ...prev, [name]: next }))}
                  />
                </label>
              );
            })}
          </fieldset>
        ))
      )}

      <label className={styles.outcome}>
        <span>这次修改想达到什么效果</span>
        <input
          type="text"
          value={outcome}
          placeholder="例如：把上调基因换成更深的红色"
          onChange={(event) => setOutcome(event.target.value)}
        />
      </label>

      {changedNames.length > 0 && (
        <p className={styles.impact} role="status" data-science={touchesScience}>
          {touchesScience
            ? `将修改 ${changedNames.length} 个参数，其中包含科学或流程参数，需要重新计算并确认结论变化。`
            : `将修改 ${changedNames.length} 个参数，只影响呈现，不重新计算科学结论。`}
        </p>
      )}

      {needsConfirm && (
        <label className={styles.confirm}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>我已理解这会改变科学结论，确认继续</span>
        </label>
      )}

      <div className={styles.actions}>
        <button className="petri-btn petri-btn--ghost petri-btn--sm"
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit({
            origin: 'manual',
            completionExpectation: 'candidate',
            requestedOutcome: outcome.trim() || `调整 ${changedNames.join('、')}`,
            parameterPatch: patch,
            scientificConfirmed: needsConfirm && confirmed,
          })}
        >
          <Icon name="sparkles" size={13} />
          生成候选版本
        </button>
        <button
          type="button"
          className={styles.reset}
          disabled={changedNames.length === 0 || submitting}
          onClick={() => { setDraft({}); setConfirmed(false); }}
        >
          放弃改动
        </button>
      </div>

    </section>
  );
}

/**
 * P4R-3 — P4 Core 参数面板的产品位置。
 *
 * 使用原生 details 保留键盘/读屏语义，默认关闭；抽屉只改变显著性，
 * 不改变 ResultEditPanel 的提交结构或科学确认边界。
 */
export function ResultEditAdvancedDrawer({
  editControls,
  disabledReason = null,
  submitting = false,
  onSubmit,
}: {
  editControls: ResultStudioEditControls | null;
  disabledReason?: string | null;
  submitting?: boolean;
  onSubmit: (submission: ResultEditSubmission) => void;
}): React.ReactElement | null {
  if (!editControls) return null;
  return (
    <details className={styles.advancedDrawer} aria-label="高级精细调整">
      <summary>
        <span>高级精细调整</span>
        <small>按插件参数逐项控制</small>
      </summary>
      <ResultEditPanel
        editControls={editControls}
        disabledReason={disabledReason}
        submitting={submitting}
        onSubmit={onSubmit}
      />
    </details>
  );
}
