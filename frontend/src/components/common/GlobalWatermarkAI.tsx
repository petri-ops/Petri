// 国风背景水印 · 可替换版（2026-11-25）——内置六图样（远山/竹/梅/鲤/松/莲）。
// 偏好真值走 ThemeProvider / user-prefs（与主题同源）；内置图交给 Vite 处理指纹，
// 自定义图取自本地图片缓存或同源路径；暗色反相沿用 watermark-ai.css 的既有规则。
import React from 'react';
import mountainUrl from '@/assets/cultural-watermark.png';
import bambooUrl from '@/assets/watermark-bamboo.png';
import plumUrl from '@/assets/watermark-plum.png';
import koiUrl from '@/assets/watermark-koi.png';
import pineUrl from '@/assets/watermark-pine.png';
import lotusUrl from '@/assets/watermark-lotus.png';
import { useTheme } from '@/themes/ThemeProvider';
import {
  builtinWatermarkId,
  readCachedWatermarkCustom,
  type BuiltinWatermarkId,
  type WatermarkMode,
} from '@/themes/watermarkPrefs';

const BUILTIN_SOURCES: Readonly<Record<BuiltinWatermarkId, string>> = {
  mountain: mountainUrl,
  bamboo: bambooUrl,
  plum: plumUrl,
  koi: koiUrl,
  pine: pineUrl,
  lotus: lotusUrl,
};

/** mode → 背景图 URL；纯函数（测试可直接对六个 id 逐一验算），none 不出图、custom 原逻辑不变。 */
export function resolveWatermarkSource(mode: WatermarkMode, customData: string, customPath: string): string {
  if (mode === 'none') return '';
  if (mode === 'custom') return customData || customPath;
  const id = builtinWatermarkId(mode);
  return id ? Object.entries(BUILTIN_SOURCES).find(([k]) => k === id)?.[1] ?? BUILTIN_SOURCES.mountain : BUILTIN_SOURCES.mountain;
}

export function GlobalWatermarkAI(): React.ReactElement {
  const { watermarkMode, watermarkOpacity, watermarkCustomPath } = useTheme();

  const customData = watermarkMode === 'custom' ? readCachedWatermarkCustom() : '';
  const source = resolveWatermarkSource(watermarkMode, customData, watermarkCustomPath);

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
