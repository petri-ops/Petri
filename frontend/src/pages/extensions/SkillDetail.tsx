/**
 * SkillDetail — 技能详情弹窗组件
 * 显示技能的完整信息、参数配置和执行选项
 */

import { unknownText } from '@/lib/unknownText';
import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Skill, ParameterSchema } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

/** BLOCK-177 — 治理操作回调（父层接 useSkillStore；onChanged = 成功后刷新货架；仅本组件消费）。 */
interface SkillGovernance {
  setDisabled: (skillId: string, disabled: boolean, reason?: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  uninstall: (skillId: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  getInstallInfo: (skillId: string) => Promise<{
    ok: boolean;
    sourceDir?: string | null;
    sourceExists?: boolean;
    importedAt?: string | null;
    error?: string;
    message?: string;
  }>;
  reinstall: (skillId: string) => Promise<{ ok: boolean; error?: string; message?: string }>;
  onChanged: () => void;
}

interface SkillDetailProps {
  skill: Skill;
  onClose: () => void;
  onExecute: (skill: Skill, params: Record<string, unknown>) => void;
  canExecute?: boolean;
  isExecuting?: boolean;
  governance?: SkillGovernance;
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
            value={unknownText(value ?? spec.default)}
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
            value={unknownText(value ?? spec.default)}
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
            value={unknownText(value ?? spec.default)}
            onChange={handleChange}
          />
        )}
        {spec.type !== 'boolean' && spec.default !== undefined && (
          <span className={styles.paramDefault}>默认: {unknownText(spec.default)}</span>
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
  governance,
}: SkillDetailProps): React.ReactElement {
  // BLOCK-177 — 治理操作区状态（停用/卸载/重装 + 来源信息）
  const [govNotice, setGovNotice] = useState<string | null>(null);
  const [govBusy, setGovBusy] = useState(false);
  const [installInfo, setInstallInfo] = useState<{
    sourceDir?: string | null;
    sourceExists?: boolean;
    importedAt?: string | null;
  } | null>(null);

  const isGovernable = Boolean(governance) && skill.source !== 'pack';
  const isBuiltin = skill.source === 'built-in';

  // BLOCK-177 — 切技能时重置治理态（React 官方 render 期调整模式；避免 effect 内同步 setState）
  const [prevGovKey, setPrevGovKey] = useState(skill.id);
  if (prevGovKey !== skill.id) {
    setPrevGovKey(skill.id);
    setGovNotice(null);
    setInstallInfo(null);
  }

  useEffect(() => {
    if (!governance || skill.source !== 'installed') return;
    let cancelled = false;
    void governance.getInstallInfo(skill.id).then((info) => {
      if (!cancelled && info.ok) {
        setInstallInfo({ sourceDir: info.sourceDir, sourceExists: info.sourceExists, importedAt: info.importedAt });
      }
    }).catch(() => { /* 来源信息缺失不阻塞详情 */ });
    return () => { cancelled = true; };
  }, [governance, skill.id, skill.source]);

  const handleToggleDisabled = useCallback(async () => {
    if (!governance) return;
    setGovBusy(true);
    setGovNotice(null);
    try {
      const result = await governance.setDisabled(skill.id, !skill.disabled);
      if (result.ok) {
        setGovNotice(!skill.disabled ? '已停用（agent 不再可见/可执行；随时可重新启用）' : '已启用');
        governance.onChanged();
      } else {
        setGovNotice('操作失败：' + (result.error || 'unknown'));
      }
    } finally {
      setGovBusy(false);
    }
  }, [governance, skill.id, skill.disabled]);

  const handleUninstall = useCallback(async () => {
    if (!governance) return;
    if (!window.confirm(`卸载技能「${skill.name}」？将删除其安装副本；导入记录中的来源目录可用于重装。`)) return;
    setGovBusy(true);
    setGovNotice(null);
    try {
      const result = await governance.uninstall(skill.id);
      if (result.ok) {
        governance.onChanged();
        onClose();
      } else {
        setGovNotice('卸载失败：' + (result.message || result.error || 'unknown'));
      }
    } finally {
      setGovBusy(false);
    }
  }, [governance, skill.id, skill.name, onClose]);

  const handleReinstall = useCallback(async () => {
    if (!governance) return;
    setGovBusy(true);
    setGovNotice(null);
    try {
      const result = await governance.reinstall(skill.id);
      if (result.ok) {
        setGovNotice('已从来源目录重装');
        governance.onChanged();
      } else {
        setGovNotice('重装失败：' + (result.message || result.error || 'unknown'));
      }
    } finally {
      setGovBusy(false);
    }
  }, [governance, skill.id]);

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
          {/* BLOCK-177 — 治理操作区（按来源分叉：内置=停用/启用；已导入=卸载/来源/重装） */}
          {isGovernable && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  disabled={govBusy}
                  onClick={() => void handleToggleDisabled()}
                  data-testid="skill-toggle-disabled"
                >
                  {skill.disabled ? '启用' : '停用'}
                </button>
                {!isBuiltin && (
                  <button
                    type="button"
                    className={styles.cancelButton}
                    disabled={govBusy}
                    onClick={() => void handleUninstall()}
                    data-testid="skill-uninstall"
                  >
                    卸载
                  </button>
                )}
                {!isBuiltin && installInfo?.sourceDir && (
                  <button
                    type="button"
                    className={styles.cancelButton}
                    disabled={govBusy || installInfo.sourceExists === false}
                    title={installInfo.sourceExists === false ? `来源目录已不存在：${installInfo.sourceDir}` : `从 ${installInfo.sourceDir} 重装`}
                    onClick={() => void handleReinstall()}
                    data-testid="skill-reinstall"
                  >
                    从原目录重装
                  </button>
                )}
              </div>
              {!isBuiltin && installInfo?.sourceDir && (
                <small style={{ color: 'var(--petri-text-tertiary)' }}>
                  来源：{installInfo.sourceDir}
                </small>
              )}
              {govNotice && <small role="status" data-testid="skill-gov-notice">{govNotice}</small>}
            </div>
          )}
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
            disabled={!canExecute || isExecuting || skill.disabled === true}
            title={skill.disabled ? '技能已停用——先在左侧重新启用' : undefined}
          >
            {isExecuting ? (
              <>
                <span className={styles.spinner} />
                执行中...
              </>
            ) : (
              <>
                <Icon name="play" size={14} />
                {skill.disabled ? '已停用' : '执行 Skill'}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
