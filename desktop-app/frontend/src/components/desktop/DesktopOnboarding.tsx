/**
 * DesktopOnboarding — 桌面版首次启动引导
 *
 * 新用户第一次打开桌面版时显示的 3 步向导：
 *   1. 检测环境（R / Python 运行时是否就绪）
 *   2. 填 AI key（DeepSeek / DashScope，可跳过）
 *   3. 选装插件（引导去插件商店，可跳过）
 *
 * 完成或跳过后写 localStorage 标志，不再弹出。
 * 用户可从设置页重新触发（清除标志）。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import './desktop.css';

const ONBOARDING_FLAG = 'biof3-onboarding-completed';

interface RuntimeStatus {
  r: { installed: boolean; path: string | null };
  python: { installed: boolean; path: string | null };
}

type Step = 0 | 1 | 2;

const STEPS: Array<{ title: string; icon: IconName }> = [
  { title: '检测环境', icon: 'cpu' },
  { title: '配置 AI', icon: 'key' },
  { title: '选装插件', icon: 'puzzle' },
];

export function DesktopOnboarding(): React.ReactElement | null {
  const [step, setStep] = useState<Step>(0);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [chatProvider, setChatProvider] = useState('deepseek');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 拉取 runtime 状态
  useEffect(() => {
    if (!window.biof3Desktop?.runtime) return;
    window.biof3Desktop.runtime.status().then((s: RuntimeStatus) => setRuntime(s));
  }, []);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, '1');
    } catch {}
    // 触发关闭：通过自定义事件让挂载点卸载本组件
    window.dispatchEvent(new CustomEvent('biof3:onboarding-done'));
  }, []);

  const handleSaveAi = useCallback(async () => {
    if (!window.biof3Desktop?.aiSettings) return;
    setSaving(true);
    try {
      await window.biof3Desktop.aiSettings.save({
        deepseek_api_key: deepseekKey || undefined,
        llm_provider: chatProvider,
      });
    } finally {
      setSaving(false);
    }
  }, [deepseekKey, chatProvider]);

  const handleTest = useCallback(async () => {
    if (!window.biof3Desktop?.aiSettings || !deepseekKey) return;
    setTesting(true);
    try {
      const result = await window.biof3Desktop.aiSettings.test('deepseek', deepseekKey);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }, [deepseekKey]);

  const next = () => setStep((s) => (s < 2 ? ((s + 1) as Step) : s));
  const prev = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

  return (
    <div className="biof3-onboarding-overlay" role="dialog" aria-label="首次启动引导">
      <div className="biof3-onboarding">
        {/* 进度指示器 */}
        <div className="biof3-onboarding__steps">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className={`biof3-onboarding__step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            >
              <span className="biof3-onboarding__step-icon">
                <Icon name={i < step ? 'check' : s.icon} size={16} />
              </span>
              <span className="biof3-onboarding__step-label">{s.title}</span>
            </div>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="biof3-onboarding__body">
          {step === 0 && <StepEnv runtime={runtime} />}
          {step === 1 && (
            <StepAi
              deepseekKey={deepseekKey}
              setDeepseekKey={setDeepseekKey}
              chatProvider={chatProvider}
              setChatProvider={setChatProvider}
              testing={testing}
              testResult={testResult}
              onTest={handleTest}
              saving={saving}
              onSave={handleSaveAi}
            />
          )}
          {step === 2 && <StepPlugins />}
        </div>

        {/* 底部按钮 */}
        <div className="biof3-onboarding__footer">
          <button
            type="button"
            className="biof3-btn biof3-btn--ghost biof3-btn--sm"
            onClick={finish}
          >
            跳过引导
          </button>
          <div className="biof3-onboarding__footer-right">
            {step > 0 && (
              <button
                type="button"
                className="biof3-btn biof3-btn--ghost biof3-btn--sm"
                onClick={prev}
              >
                上一步
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                className="biof3-btn biof3-btn--primary biof3-btn--sm"
                onClick={next}
              >
                下一步
                <Icon name="arrow-right" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className="biof3-btn biof3-btn--primary biof3-btn--sm"
                onClick={finish}
              >
                <Icon name="check" size={14} />
                开始使用
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: 环境检测 ──────────────────────────────────────────
function StepEnv({ runtime }: { runtime: RuntimeStatus | null }): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">欢迎来到 BioF3</h2>
      <p className="biof3-onboarding__subtitle">
        全组学数据分析的工作台。先检查一下你的运行环境是否就绪。
      </p>
      <div className="biof3-onboarding__env-list">
        <EnvRow
          icon="cpu"
          name="R 运行时"
          desc="差异分析、富集、单细胞 Seurat 流程的基础"
          installed={runtime?.r?.installed}
        />
        <EnvRow
          icon="sparkles"
          name="Python 运行时"
          desc="Scanpy / scVI / 空间组学 / 机器学习的基础"
          installed={runtime?.python?.installed}
        />
      </div>
      {runtime && !runtime.r.installed && !runtime.python.installed && (
        <p className="biof3-onboarding__hint">
          两个运行时都还没装。稍后可在「插件商店 → 运行时」一键安装（约 1GB）。
        </p>
      )}
    </div>
  );
}

function EnvRow({
  icon,
  name,
  desc,
  installed,
}: {
  icon: IconName;
  name: string;
  desc: string;
  installed?: boolean;
}): React.ReactElement {
  return (
    <div className={`biof3-onboarding__env-row ${installed ? 'ok' : 'pending'}`}>
      <span className="biof3-onboarding__env-icon">
        <Icon name={icon} size={20} />
      </span>
      <div className="biof3-onboarding__env-info">
        <span className="biof3-onboarding__env-name">{name}</span>
        <span className="biof3-onboarding__env-desc">{desc}</span>
      </div>
      <span className="biof3-onboarding__env-status">
        {installed === undefined ? (
          '检测中…'
        ) : installed ? (
          <>
            <Icon name="check" size={14} /> 已就绪
          </>
        ) : (
          '未安装'
        )}
      </span>
    </div>
  );
}

// ── Step 2: AI 配置 ───────────────────────────────────────────
function StepAi({
  deepseekKey,
  setDeepseekKey,
  chatProvider,
  setChatProvider,
  testing,
  testResult,
  onTest,
  saving,
  onSave,
}: {
  deepseekKey: string;
  setDeepseekKey: (v: string) => void;
  chatProvider: string;
  setChatProvider: (v: string) => void;
  testing: boolean;
  testResult: { ok: boolean; message: string } | null;
  onTest: () => void;
  saving: boolean;
  onSave: () => void;
}): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">配置 AI 陪学</h2>
      <p className="biof3-onboarding__subtitle">
        BioF3 内置 AI Copilot，能给你学习计划、出题验证、解释代码。填一个 DeepSeek API key
        即可启用（可跳过，稍后在设置页补）。
      </p>
      <div className="biof3-field">
        <label className="biof3-field__label">Chat 模型 Provider</label>
        <select
          className="biof3-select"
          value={chatProvider}
          onChange={(e) => setChatProvider(e.target.value)}
        >
          <option value="deepseek">DeepSeek（深度求索）</option>
          <option value="openai">OpenAI（未来支持）</option>
          <option value="ollama">Ollama 本地模型（未来支持）</option>
        </select>
      </div>
      <div className="biof3-field">
        <label className="biof3-field__label">DeepSeek API Key</label>
        <div className="biof3-input-row">
          <input
            type="password"
            className="biof3-input"
            value={deepseekKey}
            onChange={(e) => setDeepseekKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxx"
          />
          <button
            type="button"
            className="biof3-btn biof3-btn--ghost biof3-btn--sm"
            onClick={onTest}
            disabled={!deepseekKey || testing}
          >
            {testing ? '测试中…' : '测试'}
          </button>
        </div>
        {testResult && (
          <div
            className={`biof3-field__result ${testResult.ok ? 'biof3-field__result--ok' : 'biof3-field__result--err'}`}
          >
            {testResult.message}
          </div>
        )}
        <p className="biof3-field__hint">
          获取地址：platform.deepseek.com → API Keys。Key 仅存在本地，不上传。
        </p>
      </div>
      {deepseekKey && (
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
      )}
    </div>
  );
}

// ── Step 3: 选装插件 ──────────────────────────────────────────
function StepPlugins(): React.ReactElement {
  const openStore = () => {
    window.dispatchEvent(new CustomEvent('biof3:open-plugin-store'));
    window.dispatchEvent(new CustomEvent('biof3:onboarding-done'));
    try {
      localStorage.setItem(ONBOARDING_FLAG, '1');
    } catch {}
  };

  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">按需装插件</h2>
      <p className="biof3-onboarding__subtitle">
        BioF3 的工具和绘图卡片都是插件化按需安装。先装运行时，再按你要做的分析装对应工具。
      </p>
      <div className="biof3-onboarding__plugin-tips">
        <div className="biof3-onboarding__tip">
          <Icon name="cpu" size={18} />
          <div>
            <strong>R / Python 运行时</strong>
            <p>所有分析的基础，必装（约 1GB）。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="bar-chart" size={18} />
          <div>
            <strong>分析工具</strong>
            <p>DESeq2 / GO-KEGG / GSEA / 生存分析等，按需选装。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="image" size={18} />
          <div>
            <strong>FigCode 绘图</strong>
            <p>SCI 论文图类型的可复制代码，按需选装。</p>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="biof3-btn biof3-btn--primary biof3-btn--sm"
        onClick={openStore}
      >
        <Icon name="puzzle" size={14} />
        打开插件商店
      </button>
    </div>
  );
}

export default DesktopOnboarding;
