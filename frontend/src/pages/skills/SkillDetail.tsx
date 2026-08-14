/**
 * SkillDetail — 技能详情弹窗组件
 * 显示技能的完整信息、参数配置和执行选项
 */

import React, { useCallback, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Skill, ParameterSchema } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

interface SkillDetailProps {
  skill: Skill;
  onClose: () => void;
  onExecute: (skill: Skill, params: Record<string, unknown>) => void;
  canExecute?: boolean;
  isExecuting?: boolean;
}

interface ParamValues {
  [key: string]: unknown;
}

function ParameterField({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: ParameterSchema;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}): React.ReactElement {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      let newValue: unknown = e.target.value;
      if (spec.type === 'number') {
        newValue = parseFloat(e.target.value) || 0;
      } else if (spec.type === 'boolean') {
        newValue = (e.target as HTMLInputElement).checked;
      }
      onChange(name, newValue);
    },
    [name, onChange, spec.type]
  );

  const inputId = `param-${name}`;

  return (
    <div className={styles.paramField}>
      <label htmlFor={inputId} className={styles.paramLabel}>
        {name}
        <span className={styles.paramDescription}>{spec.description}</span>
      </label>
      <div className={styles.paramControl}>
        {spec.type === 'boolean' ? (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              id={inputId}
              checked={Boolean(value)}
              onChange={handleChange}
            />
            <span className={styles.toggleSlider} />
          </label>
        ) : spec.type === 'select' ? (
          <select
            id={inputId}
            className={styles.select}
            value={String(value ?? spec.default ?? '')}
            onChange={handleChange}
          >
            {spec.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : spec.type === 'number' ? (
          <input
            type="number"
            id={inputId}
            className={styles.numberInput}
            value={String(value ?? spec.default ?? '')}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            onChange={handleChange}
          />
        ) : (
          <input
            type="text"
            id={inputId}
            className={styles.textInput}
            value={String(value ?? spec.default ?? '')}
            onChange={handleChange}
          />
        )}
        {spec.type !== 'boolean' && spec.default !== undefined && (
          <span className={styles.paramDefault}>默认: {String(spec.default)}</span>
        )}
      </div>
    </div>
  );
}

export function SkillDetail({
  skill,
  onClose,
  onExecute,
  canExecute = true,
  isExecuting = false,
}: SkillDetailProps): React.ReactElement {
  const [paramValues, setParamValues] = useState<ParamValues>(() => {
    const defaults: ParamValues = {};
    const optionalParams = skill.parameters?.optional ?? {};
    for (const [key, spec] of Object.entries(optionalParams)) {
      defaults[key] = spec.default;
    }
    return defaults;
  });

  const handleParamChange = useCallback((name: string, value: unknown) => {
    setParamValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleExecute = useCallback(() => {
    onExecute(skill, paramValues);
  }, [skill, paramValues, onExecute]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const optionalParams = skill.parameters?.optional ?? {};
  const primaryOutputs = skill.outputs?.primary ?? [];
  const secondaryOutputs = skill.outputs?.secondary ?? [];

  return (
    <div
      className={styles.modalBackdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-detail-title"
    >
      <div className={styles.modalContent}>
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleRow}>
            <h2 id="skill-detail-title" className={styles.modalTitle}>
              {skill.name}
            </h2>
            <span className={styles.modalVersion}>v{skill.version}</span>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className={styles.modalBody}>
          <section className={styles.detailSection}>
            <h3 className={styles.sectionTitle}>描述</h3>
            <p className={styles.description}>{skill.description}</p>
          </section>

          <section className={styles.detailSection}>
            <h3 className={styles.sectionTitle}>类别与标签</h3>
            <div className={styles.metaRow}>
              <span className={styles.categoryBadge}>{skill.category}</span>
              {skill.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <section className={styles.detailSection}>
            <h3 className={styles.sectionTitle}>依赖插件</h3>
            {skill.plugins.required.length > 0 ? (
              <div className={styles.pluginList}>
                <span className={styles.pluginLabel}>必需</span>
                {skill.plugins.required.map((plugin) => (
                  <span key={plugin} className={styles.pluginBadge}>
                    <Icon name="puzzle" size={12} />
                    {plugin}
                  </span>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>无必需依赖</p>
            )}
            {skill.plugins.optional.length > 0 && (
              <div className={styles.pluginList}>
                <span className={styles.pluginLabel}>可选</span>
                {skill.plugins.optional.map((plugin) => (
                  <span key={plugin} className={`${styles.pluginBadge} ${styles.pluginOptional}`}>
                    <Icon name="puzzle" size={12} />
                    {plugin}
                  </span>
                ))}
              </div>
            )}
          </section>

          {Object.keys(optionalParams).length > 0 && (
            <section className={styles.detailSection}>
              <h3 className={styles.sectionTitle}>参数配置</h3>
              <div className={styles.paramForm}>
                {skill.parameters.required.length > 0 && (
                  <p className={styles.requiredNote}>
                    必需参数: {skill.parameters.required.join(', ')}
                  </p>
                )}
                {Object.entries(optionalParams).map(([name, spec]) => (
                  <ParameterField
                    key={name}
                    name={name}
                    spec={spec}
                    value={paramValues[name]}
                    onChange={handleParamChange}
                  />
                ))}
              </div>
            </section>
          )}

          {(primaryOutputs.length > 0 || secondaryOutputs.length > 0) && (
            <section className={styles.detailSection}>
              <h3 className={styles.sectionTitle}>输出产物</h3>
              {primaryOutputs.length > 0 && (
                <>
                  <h4 className={styles.outputGroupTitle}>主要输出</h4>
                  <ul className={styles.outputList}>
                    {primaryOutputs.map((output) => (
                      <li key={output.id} className={styles.outputItem}>
                        <Icon
                          name={output.type === 'plot' ? 'image' : output.type === 'table' ? 'table' : 'file'}
                          size={14}
                        />
                        <span className={styles.outputLabel}>{output.label}</span>
                        <span className={styles.outputDesc}>{output.description}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {secondaryOutputs.length > 0 && (
                <>
                  <h4 className={styles.outputGroupTitle}>次要输出</h4>
                  <ul className={styles.outputList}>
                    {secondaryOutputs.map((output) => (
                      <li key={output.id} className={styles.outputItem}>
                        <Icon
                          name={output.type === 'plot' ? 'image' : output.type === 'table' ? 'table' : 'file'}
                          size={14}
                        />
                        <span className={styles.outputLabel}>{output.label}</span>
                        <span className={styles.outputDesc}>{output.description}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>

        <footer className={styles.modalFooter}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className={styles.executeButton}
            onClick={handleExecute}
            disabled={!canExecute || isExecuting}
          >
            {isExecuting ? (
              <>
                <span className={styles.spinner} />
                执行中...
              </>
            ) : (
              <>
                <Icon name="play" size={14} />
                执行 Skill
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
