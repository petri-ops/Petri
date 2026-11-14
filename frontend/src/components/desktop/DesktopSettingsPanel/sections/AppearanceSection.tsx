/**
 * AppearanceSection — 外观分区（BLOCK-424 信息架构拆分 / BLOCK-425 排版重构）。
 *
 * 原本混在「常规」里：外观主题 / 界面字号 / 主题色 / 动效 + 桌面行为 + 外部导入
 * 六件事挤在一个分区，既是左栏显空的根因（分类粒度太粗），也让「外观」这个
 * 最高频的设置埋在低频项后面。拆出后「常规」只剩配置迁移，默认落点改为本分区。
 *
 * BLOCK-425：每项收敛为「图标 + 名称 + 一句说明 + 控件」，去掉两行长 hint。
 * 复用既有控件与 `useTheme()`，零新增状态、零新增依赖。
 */
import React from 'react';
import { useTheme, FONT_SCALE_MIN, FONT_SCALE_MAX } from '@/themes/ThemeProvider';
import { ThemeControl } from '../../ThemeControl';
import { AccentControl } from '../../AccentControl';
import { SettingsField } from '../SettingsField';
import { MotionControl } from './MotionControl';

export function AppearanceSection(): React.ReactElement {
  const { preference: themePreference, fontScale, setFontScale } = useTheme();
  const themeLabel = themePreference === 'system' ? '跟随系统' : themePreference === 'light' ? '日间' : '夜间';

  return (
    <section className="petri-settings-section">
      <div className="petri-settings-section__heading">
        <h3>外观</h3>
        <p>主题、字号与动效——只影响呈现方式，不改动任何数据。</p>
      </div>

      <SettingsField icon="sun" label="外观主题" hint="跟随系统，或固定日间 / 夜间" meta={`当前：${themeLabel}`}>
        <ThemeControl menuPlacement="bottom" />
      </SettingsField>

      <SettingsField
        icon="list-details"
        label="界面字号"
        htmlFor="font-scale-input"
        hint="只改文字大小（80–140%），不改动布局与图标"
      >
        <input
          id="font-scale-input"
          type="number"
          min={Math.round(FONT_SCALE_MIN * 100)}
          max={Math.round(FONT_SCALE_MAX * 100)}
          step={5}
          value={Math.round(fontScale * 100)}
          onChange={(e) => {
            const pct = Number(e.target.value);
            if (Number.isFinite(pct)) setFontScale(pct / 100);
          }}
          style={{ width: 90, height: 32, textAlign: 'right',
            border: '1px solid var(--petri-border)', borderRadius: 6,
            background: 'var(--petri-bg-surface)', color: 'var(--petri-text)' }}
        />
        <span style={{ color: 'var(--petri-text-secondary)', fontSize: 'var(--petri-font-size-sm, 12px)' }}>%</span>
      </SettingsField>

      <SettingsField icon="sparkles" label="主题色" hint="按钮与高亮的强调色">
        <AccentControl />
      </SettingsField>

      <MotionControl />
    </section>
  );
}
