/**
 * DesktopOnboarding — 桌面版首次启动引导（M2-4 / E2）
 *
 * 新用户第一次打开桌面版时显示的 3 步向导：
 *   1. 欢迎页：介绍 BioF3 是什么
 *   2. 选模式：学习还是实战（影响首页推荐卡片，可跳过）
 *   3. 运行时检测：未装 R/Python 时引导去插件商店（/admin）
 *
 * 可跳过；完成或跳过后写 localStorage 标志 `biof3-onboarding-completed`，
 * 不再弹出。挂载逻辑在 App.tsx 的 DesktopOnboardingMount，本组件不改挂载方式。
 *
 * 约束：仅用 useState/useCallback；运行时状态复用 useBackendStatus()。
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import './desktop.css';

const ONBOARDING_FLAG = 'biof3-onboarding-completed';
const MODE_FLAG = 'biof3-onboarding-mode';

type Step = 0 | 1 | 2;
type Mode = 'learn' | 'practice' | null;

const STEPS: Array<{ title: string; icon: IconName }> = [
  { title: '欢迎', icon: 'sparkles' },
  { title: '选模式', icon: 'graduation-cap' },
  { title: '准备运行时', icon: 'cpu' },
];

export function DesktopOnboarding(): React.ReactElement | null {
  const [step, setStep] = useState<Step>(0);
  const [mode, setMode] = useState<Mode>(null);
  const backend = useBackendStatus();
  const navigate = useNavigate();

  // 运行时是否就绪：任一已装即视为"有运行时"
  const hasAnyRuntime = backend.rRuntime || backend.pyRuntime;
  const hasAllRuntime = backend.rRuntime && backend.pyRuntime;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, '1');
      if (mode) localStorage.setItem(MODE_FLAG, mode);
    } catch {}
    dispatchBioF3Event(biof3Events.onboardingDone);
  }, [mode]);

  const goToPluginStore = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, '1');
      if (mode) localStorage.setItem(MODE_FLAG, mode);
    } catch {}
    dispatchBioF3Event(biof3Events.onboardingDone);
    navigate('/admin');
  }, [mode, navigate]);

  const next = useCallback(() => setStep((s) => (s < 2 ? ((s + 1) as Step) : s)), []);
  const prev = useCallback(() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s)), []);

  const selectMode = useCallback((m: Mode) => setMode(m), []);

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
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepMode mode={mode} onSelect={selectMode} />}
          {step === 2 && (
            <StepRuntime
              rOk={backend.rRuntime}
              pyOk={backend.pyRuntime}
              hasAnyRuntime={hasAnyRuntime}
              hasAllRuntime={hasAllRuntime}
              onGoToStore={goToPluginStore}
            />
          )}
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
            ) : hasAnyRuntime ? (
              <button
                type="button"
                className="biof3-btn biof3-btn--primary biof3-btn--sm"
                onClick={finish}
              >
                <Icon name="check" size={14} />
                开始使用
              </button>
            ) : (
              <button
                type="button"
                className="biof3-btn biof3-btn--primary biof3-btn--sm"
                onClick={goToPluginStore}
              >
                <Icon name="puzzle" size={14} />
                去插件商店装运行时
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: 欢迎 ─────────────────────────────────────────────
function StepWelcome(): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">欢迎来到 BioF3</h2>
      <p className="biof3-onboarding__subtitle">
        BioF3 是一个全组学数据分析工作台：差异分析、富集、单细胞、空间组学、SCI 论文级绘图，
        全部以插件化按需安装。跟着引导走两步，就能开始你的第一条分析。
      </p>
      <div className="biof3-onboarding__plugin-tips">
        <div className="biof3-onboarding__tip">
          <Icon name="cpu" size={18} />
          <div>
            <strong>R / Python 运行时</strong>
            <p>所有分析的基础，下一步会帮你检测是否已就绪。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="graduation-cap" size={18} />
          <div>
            <strong>学习 / 实战双模式</strong>
            <p>新手走学习路径（计划+出题验证），老手直接进实战工具台。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="brain" size={18} />
          <div>
            <strong>AI Copilot 陪学</strong>
            <p>内置 DeepSeek 驱动的 Copilot，解释代码、出学习计划、查文档。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: 选模式（学习 / 实战） ────────────────────────────
function StepMode({
  mode,
  onSelect,
}: {
  mode: Mode;
  onSelect: (m: Mode) => void;
}): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">你想怎么用 BioF3？</h2>
      <p className="biof3-onboarding__subtitle">
        选一个模式，首页会优先展示对应入口。随时可在设置里切换，不影响功能。
      </p>
      <div className="biof3-onboarding__choice-list">
        <button
          type="button"
          className={`biof3-onboarding__choice ${mode === 'learn' ? 'selected' : ''}`}
          onClick={() => onSelect('learn')}
        >
          <span className="biof3-onboarding__choice-icon">
            <Icon name="graduation-cap" size={22} />
          </span>
          <span className="biof3-onboarding__choice-body">
            <strong>学习模式</strong>
            <p>从零入门：系统化学习路径、配套练习、AI 出题验证掌握度。</p>
          </span>
          <span className="biof3-onboarding__choice-check">
            {mode === 'learn' && <Icon name="check" size={16} />}
          </span>
        </button>
        <button
          type="button"
          className={`biof3-onboarding__choice ${mode === 'practice' ? 'selected' : ''}`}
          onClick={() => onSelect('practice')}
        >
          <span className="biof3-onboarding__choice-icon">
            <Icon name="bar-chart" size={22} />
          </span>
          <span className="biof3-onboarding__choice-body">
            <strong>实战模式</strong>
            <p>直接进工具台：DESeq2 / GO-KEGG / Scanpy / FigCode 绘图按需调用。</p>
          </span>
          <span className="biof3-onboarding__choice-check">
            {mode === 'practice' && <Icon name="check" size={16} />}
          </span>
        </button>
      </div>
      <p className="biof3-onboarding__hint">
        不确定？默认进学习模式，随时可切。也可点"跳过引导"稍后再选。
      </p>
    </div>
  );
}

// ── Step 3: 运行时检测 ───────────────────────────────────────
function StepRuntime({
  rOk,
  pyOk,
  hasAnyRuntime,
  hasAllRuntime,
  onGoToStore,
}: {
  rOk: boolean;
  pyOk: boolean;
  hasAnyRuntime: boolean;
  hasAllRuntime: boolean;
  onGoToStore: () => void;
}): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">准备运行时</h2>
      <p className="biof3-onboarding__subtitle">
        BioF3 的分析工具依赖 R / Python 运行时。先看看你的环境是否就绪。
      </p>
      <div className="biof3-onboarding__env-list">
        <EnvRow
          icon="cpu"
          name="R 运行时"
          desc="差异分析、富集、Seurat 单细胞流程的基础"
          installed={rOk}
        />
        <EnvRow
          icon="sparkles"
          name="Python 运行时"
          desc="Scanpy / scVI / 空间组学 / 机器学习的基础"
          installed={pyOk}
        />
      </div>
      {hasAllRuntime && (
        <p className="biof3-onboarding__hint">两个运行时都已就绪，可以直接开始分析了。</p>
      )}
      {hasAnyRuntime && !hasAllRuntime && (
        <p className="biof3-onboarding__hint">
          已装一个运行时，可先开始对应流程；另一个稍后可在插件商店补装。
        </p>
      )}
      {!hasAnyRuntime && (
        <div className="biof3-onboarding__store-callout">
          <div className="biof3-onboarding__store-callout-body">
            <strong>还没装运行时</strong>
            <p>
              没关系——插件商店里有一键安装包（R + Python 约 1GB）。 点下方按钮直接跳到「插件商店 →
              运行时」。
            </p>
          </div>
          <button
            type="button"
            className="biof3-btn biof3-btn--primary biof3-btn--sm"
            onClick={onGoToStore}
          >
            <Icon name="puzzle" size={14} />
            打开插件商店
          </button>
        </div>
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
  installed: boolean;
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
        {installed ? (
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

export default DesktopOnboarding;
