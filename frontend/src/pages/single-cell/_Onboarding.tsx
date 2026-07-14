// ============================================================
// Onboarding — 首次使用引导
// 新用户第一次登录后显示，引导完成后不再出现
// ============================================================

import React, { useState, useCallback } from 'react';

const ONBOARDING_KEY = 'biof3_onboarding_done';

export function useOnboarding(): [boolean, () => void] {
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem(ONBOARDING_KEY);
  });

  const dismiss = useCallback(() => {
    setShow(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {}
  }, []);

  return [show, dismiss];
}

const STEPS = [
  {
    icon: '📊',
    title: '体验 Demo',
    desc: '点击「初始化 Demo」加载 PBMC3K 示例数据，体验完整分析流程',
  },
  {
    icon: '📁',
    title: '上传数据',
    desc: '支持 .rds / .h5 / .tar.gz（10x）格式，上传后启动标准分析',
  },
  {
    icon: '🔬',
    title: '下游分析',
    desc: '标准分析完成后，使用 DEG、注释、轨迹等工具深入挖掘',
  },
];

export function OnboardingModal({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onDismiss();
    }
  }, [step, onDismiss]);

  return (
    <div className="sc-modal-overlay" onClick={onDismiss}>
      <div
        className="sc-modal sc-onboarding-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', padding: '28px 24px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--biof3-text)', margin: 0 }}>
            欢迎使用 BioF3 单细胞云平台
          </h2>
          <p style={{ fontSize: 12, color: 'var(--biof3-text-muted)', marginTop: 6 }}>
            在线完成 scRNA-seq 数据的标准分析和下游挖掘
          </p>
        </div>

        {/* Steps */}
        <div style={{ padding: '20px 24px' }}>
          {STEPS.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 8,
                marginBottom: 8,
                background: i === step ? '#f0fdf4' : 'transparent',
                border: i === step ? '1px solid #bbf7d0' : '1px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--biof3-text)' }}>
                  <span style={{ color: 'var(--biof3-text-muted)', marginRight: 6 }}>Step {i + 1}</span>
                  {s.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--biof3-text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '0 24px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--biof3-text-muted)',
              fontSize: 11,
              cursor: 'pointer',
            }}
            onClick={onDismiss}
          >
            跳过
          </button>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Dots */}
            {STEPS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: i === step ? 'var(--ifm-color-primary)' : '#e2e8f0',
                  transition: 'background 0.2s',
                }}
              />
            ))}
            <button
              className="sc-btn sc-btn-primary"
              onClick={handleNext}
              style={{ marginLeft: 12, fontSize: 12, padding: '6px 16px' }}
            >
              {step < STEPS.length - 1 ? '下一步' : '开始使用'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
