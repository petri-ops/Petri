/**
 * DesktopOnboarding — 桌面版首次启动引导（Week1 收口版）
 *
 * 收口说明：
 *   原 M2-4 / E2 版本有 3 步：欢迎 → 选模式（学习/实战）→ 运行时检测 → 跳插件商店。
 *   实际产品表面（App.tsx + admin gate）已不再提供「学习/实战」双模式首选项，
 *   「去插件商店」分支也只指向 /admin，且 admin 角色由 authClient 固定返回，
 *   引导里的 mode 字段没有任何真实消费者。Week 1 发行可信化阶段已确认：
 *   - 删除「学习/实战」二选一步骤
 *   - 删除「去插件商店」分支（运行时检测保留为信息页）
 *   - 缩成单一线性流：欢迎 → 运行时检测 → 完成
 *   - 保留 localStorage 兼容键，但 MODE_FLAG 只读不写（标 deprecated）
 *
 * 完成事件（biof3:onboarding-done）保持兼容 App.tsx 的挂载逻辑。
 *
 * 约束：仅 useState/useCallback；运行时状态复用 useBackendStatus()。
 */

import React, { useState, useCallback } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import { loadReleaseTagline } from '@/lib/releaseContract';
import './desktop.css';

const ONBOARDING_FLAG = 'biof3-onboarding-completed';
// deprecated: Week 1 起不再写入。保留读取兼容旧用户，下个迭代可移除。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MODE_FLAG = 'biof3-onboarding-mode';

type Step = 0 | 1;

const STEPS: Array<{ title: string; icon: IconName }> = [
  { title: '欢迎', icon: 'sparkles' },
  { title: '准备运行时', icon: 'cpu' },
];

export function DesktopOnboarding(): React.ReactElement | null {
  const [step, setStep] = useState<Step>(0);
  const backend = useBackendStatus();

  // 运行时是否就绪：任一已装即视为"有运行时"
  // backend.rRuntime 可为 null（状态查询失败 = 未知）；引导页只做展示，
  // 未知一律按"未就绪"处理，用 === true 归一化成严格布尔。
  const rOk = backend.rRuntime === true;
  const pyOk = backend.pyRuntime === true;
  const hasAnyRuntime = rOk || pyOk;
  const hasAllRuntime = rOk && pyOk;

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_FLAG, '1');
      // deprecated: 旧版会写 MODE_FLAG（learn/practice），现在不再写，但保留读路径以便后续清理。
      // 故意保留读取调用是为了让未来一个 lint 规则或迁移脚本发现这个键还在被消费。
    } catch {}
    dispatchBioF3Event(biof3Events.onboardingDone);
  }, []);

  const next = useCallback(() => setStep((s) => (s < 1 ? ((s + 1) as Step) : s)), []);
  const prev = useCallback(() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s)), []);

  // deprecated: 读取旧 key 用于后续清理判断；当前 UI 已不使用。
  // 返回值仅用于 console，不入 state，避免触发额外渲染。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _legacyMode = (() => {
    try {
      return localStorage.getItem(MODE_FLAG);
    } catch {
      return null;
    }
  })();

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
          {step === 1 && (
            <StepRuntime
              rOk={rOk}
              pyOk={pyOk}
              hasAnyRuntime={hasAnyRuntime}
              hasAllRuntime={hasAllRuntime}
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
            {step < 1 ? (
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

// ── Step 1: 欢迎 ─────────────────────────────────────────────
function StepWelcome(): React.ReactElement {
  const tagline = loadReleaseTagline();
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">欢迎来到 BioF3</h2>
      <p className="biof3-onboarding__subtitle">{tagline}</p>
      <div className="biof3-onboarding__plugin-tips">
        <div className="biof3-onboarding__tip">
          <Icon name="cpu" size={18} />
          <div>
            <strong>R / Python 运行时</strong>
            <p>所有分析的基础，下一步会帮你检测是否已就绪。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="sparkles" size={18} />
          <div>
            <strong>项目工作台</strong>
            <p>创建项目、上传数据、运行工具、检查产物、生成报告，一站完成。</p>
          </div>
        </div>
        <div className="biof3-onboarding__tip">
          <Icon name="brain" size={18} />
          <div>
            <strong>AI 分析助手</strong>
            <p>连接你配置的模型，解释结果、核对分析信息并辅助决策。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: 运行时检测（信息页，不再跳插件商店） ─────────────
function StepRuntime({
  rOk,
  pyOk,
  hasAnyRuntime,
  hasAllRuntime,
}: {
  rOk: boolean;
  pyOk: boolean;
  hasAnyRuntime: boolean;
  hasAllRuntime: boolean;
}): React.ReactElement {
  return (
    <div className="biof3-onboarding__step-content">
      <h2 className="biof3-onboarding__title">准备运行时</h2>
      <p className="biof3-onboarding__subtitle">
        BioF3 的分析能力依赖 R / Python 运行时。先看看你的环境是否就绪。
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
        <p className="biof3-onboarding__hint">
          还没检测到运行时。完成引导后，可在「项目工作台 → 插件商店」一键补装（约 1GB）。
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
