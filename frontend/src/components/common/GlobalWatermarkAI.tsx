// 国风背景水印 · 可替换版（2026-11-25）。
// 偏好真值走 ThemeProvider / user-prefs（与主题同源）；内置图交给 Vite 处理指纹，
// 自定义图取自本地图片缓存或同源路径；暗色反相沿用 watermark-ai.css 的既有规则。
import React from 'react';
import builtinWatermarkUrl from '@/assets/cultural-watermark.png';
import { useTheme } from '@/themes/ThemeProvider';
import { readCachedWatermarkCustom } from '@/themes/watermarkPrefs';

export function GlobalWatermarkAI(): React.ReactElement {
  const { watermarkMode, watermarkOpacity, watermarkCustomPath } = useTheme();

  const customData = watermarkMode === 'custom' ? readCachedWatermarkCustom() : '';
  const source = watermarkMode === 'custom'
    ? (customData || watermarkCustomPath)
    : builtinWatermarkUrl;

  const style = {
    backgroundImage: source ? `url("${source}")` : 'none',
    '--wm-opacity': watermarkOpacity,
  } as React.CSSProperties;

  return (
    <div
      className="petri-watermark-global"
      data-watermark-mode={watermarkMode}
      style={style}
      aria-hidden="true"
    />
  );
}
