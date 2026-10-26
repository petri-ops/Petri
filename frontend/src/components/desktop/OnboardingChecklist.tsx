import { useEffect, useState } from 'react';
import { getApiPrefix } from '@/components/copilot/copilotClient/apiBase';
import { Icon } from '@/components/icons/Icon';
import styles from '@/pages/home.module.css';

/**
 * BLOCK-264（C-35）— 首启分步引导清单。
 *
 * 三步全部由后端真实状态派生（GET /api/app/onboarding-status：模型已配置 /
 * 已有项目 / 已有会话），完成即真——不存进度偏好、不虚构「已读」。
 * 全部完成时整块隐藏（老用户零打扰）。
 */

interface OnboardingSteps {
  modelConfigured: boolean;
  hasProject: boolean;
  hasConversation: boolean;
}

interface OnboardingStatus {
  ok: boolean;
  steps?: OnboardingSteps;
  allDone?: boolean;
}

const STEP_LABELS: { key: keyof OnboardingSteps; title: string; hint: string }[] = [
  { key: 'modelConfigured', title: '配置模型', hint: '设置 → 模型服务里填一个可用模型与密钥' },
  { key: 'hasProject', title: '创建项目', hint: '在下方选一个工作目录' },
  { key: 'hasConversation', title: '开始对话', hint: '进入项目工作台发第一条消息' },
];

export function OnboardingChecklist({ apiBase }: { apiBase?: string } = {}) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const resp = await fetch(`${apiBase ?? getApiPrefix()}/app/onboarding-status`);
        const data = (await resp.json()) as OnboardingStatus;
        if (alive) setStatus(data);
      } catch {
        if (alive) setStatus({ ok: false });
      }
    };
    void load();
    return () => { alive = false; };
  }, [apiBase]);

  if (!status || !status.ok || !status.steps || status.allDone) return null;

  const doneCount = STEP_LABELS.filter((s) => status.steps?.[s.key]).length;

  return (
    <div className={styles.runtimeBanner} role="status" data-onboarding-checklist aria-label="开始使用清单">
      <Icon name="check" size={15} />
      <div className={styles.onboardingSteps}>
        <span className={styles.runtimeBannerText}>
          开始使用（{doneCount}/{STEP_LABELS.length}）：
        </span>
        <ul className={styles.onboardingStepList}>
          {STEP_LABELS.map((step) => {
            const done = Boolean(status.steps?.[step.key]);
            return (
              <li key={step.key} data-onboarding-step={step.key} data-done={done}>
                <span aria-hidden>{done ? '✓' : '○'}</span>
                <span>{step.title}</span>
                <span className={styles.onboardingStepHint}>{done ? '已完成' : step.hint}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
