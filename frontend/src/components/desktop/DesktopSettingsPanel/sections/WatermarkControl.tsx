/**
 * WatermarkControl — 背景水印设置项（2026-11-25 水印可替换能力）。
 *
 * 三态（无 / 内置水墨 / 自定义图片）+ 内置图样六选一（远山/竹/梅/鲤/松/莲，默认远山）
 * + 自定义图导入/路径 + 透明度 0–30%。内置图样直接写 `builtin:<id>` mode，不新增 schema 键。
 * 偏好全部经 useTheme() 写，与主题/字号同源（服务端 user-prefs 为真值）；
 * 图片本体是资产不是偏好标量（PUT 4kb 上限），data URI 只落本地缓存，
 * prefs 里只存来源标签/应用内路径。观感零代签。
 */
import React, { useRef, useState } from 'react';
import { useTheme, type WatermarkMode } from '@/themes/ThemeProvider';
import {
  BUILTIN_WATERMARK_IDS,
  DEFAULT_WATERMARK_MODE,
  builtinWatermarkId,
  toBuiltinWatermarkMode,
  writeCachedWatermarkCustom,
  type BuiltinWatermarkId,
} from '@/themes/watermarkPrefs';
import {
  parseWatermarkInput,
  readFileAsDataUri,
  toTransparentWatermark,
  validateWatermarkFile,
} from './watermarkImage';

const MODES: ReadonlyArray<{ value: WatermarkMode; label: string }> = [
  { value: 'none', label: '无' },
  { value: DEFAULT_WATERMARK_MODE, label: '内置水墨' },
  { value: 'custom', label: '自定义图片' },
];

const BUILTIN_LABELS: Readonly<Record<BuiltinWatermarkId, string>> = {
  mountain: '远山',
  bamboo: '竹',
  plum: '梅',
  koi: '鲤',
  pine: '松',
  lotus: '莲',
};

const controlStyle: React.CSSProperties = {
  height: 32,
  borderRadius: 6,
  border: '1px solid var(--petri-border)',
  background: 'var(--petri-bg-surface)',
  color: 'var(--petri-text)',
  padding: '0 8px',
};

export function WatermarkControl(): React.ReactElement {
  const {
    watermarkMode, setWatermarkMode,
    watermarkOpacity, setWatermarkOpacity,
    watermarkCustomPath, setWatermarkCustomPath,
  } = useTheme();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pathDraft, setPathDraft] = useState(watermarkCustomPath);
  const [makeTransparent, setMakeTransparent] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyDataUri = async (dataUri: string, label: string): Promise<void> => {
    const final = makeTransparent ? await toTransparentWatermark(dataUri) : dataUri;
    writeCachedWatermarkCustom(final);
    setWatermarkCustomPath(label);
    setWatermarkMode('custom');
    setError('');
  };

  const onFilePicked = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = ''; // 允许再次选择同一文件
    if (!file) return;
    const check = validateWatermarkFile(file);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    try {
      const dataUri = await readFileAsDataUri(file);
      await applyDataUri(dataUri, file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取图片失败');
    } finally {
      setBusy(false);
    }
  };

  const onApplyPath = (): void => {
    const parsed = parseWatermarkInput(pathDraft);
    if (parsed.kind !== 'data' && parsed.kind !== 'same-origin') {
      setError(parsed.error || '无法应用该图片路径。');
      return;
    }
    if (parsed.kind === 'data') {
      setBusy(true);
      void applyDataUri(parsed.value, '粘贴的图片数据').finally(() => setBusy(false));
      return;
    }
    writeCachedWatermarkCustom('');
    setWatermarkCustomPath(parsed.value);
    setWatermarkMode('custom');
    setError('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          id="watermark-mode-input"
          value={builtinWatermarkId(watermarkMode) ? DEFAULT_WATERMARK_MODE : watermarkMode}
          onChange={(event) => setWatermarkMode(event.target.value as WatermarkMode)}
          style={controlStyle}
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
        {builtinWatermarkId(watermarkMode) && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            color: 'var(--petri-text-secondary)', fontSize: 'var(--petri-font-size-sm, 12px)' }}>
            内置图样
            <select
              id="watermark-builtin-input"
              value={builtinWatermarkId(watermarkMode) ?? 'mountain'}
              onChange={(event) => setWatermarkMode(toBuiltinWatermarkMode(event.target.value as BuiltinWatermarkId))}
              style={controlStyle}
            >
              {BUILTIN_WATERMARK_IDS.map((id) => (
                <option key={id} value={id}>{Object.entries(BUILTIN_LABELS).find(([k]) => k === id)?.[1]}</option>
              ))}
            </select>
          </label>
        )}
        {watermarkMode === 'custom' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
            color: 'var(--petri-text-secondary)', fontSize: 'var(--petri-font-size-sm, 12px)' }}>
            <input
              type="checkbox"
              checked={makeTransparent}
              onChange={(event) => setMakeTransparent(event.target.checked)}
            />
            浅色底转透明
          </label>
        )}
      </div>

      {watermarkMode === 'custom' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => { void onFilePicked(event); }}
              style={{ display: 'none' }}
              aria-label="选择水印图片文件"
            />
            <button type="button" style={controlStyle} onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? '处理中…' : '选择文件'}
            </button>
            <input
              type="text"
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              placeholder="图片 data URI 或应用内路径"
              aria-label="水印图片路径"
              style={{ ...controlStyle, flex: '1 1 220px', minWidth: 180 }}
            />
            <button type="button" style={controlStyle} onClick={onApplyPath} disabled={busy}>应用路径</button>
          </div>
          {watermarkCustomPath && (
            <span style={{ color: 'var(--petri-text-secondary)', fontSize: 'var(--petri-font-size-sm, 12px)' }}>
              当前图片：{watermarkCustomPath}
            </span>
          )}
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id="watermark-opacity-input"
          type="range"
          min={0}
          max={30}
          step={1}
          value={Math.round(watermarkOpacity * 100)}
          onChange={(event) => setWatermarkOpacity(Number(event.target.value) / 100)}
          style={{ flex: '0 1 220px' }}
        />
        <span style={{ color: 'var(--petri-text-secondary)', fontSize: 'var(--petri-font-size-sm, 12px)' }}>
          {Math.round(watermarkOpacity * 100)}%
        </span>
      </div>

      {error && (
        <p className="petri-field__result petri-field__result--err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
