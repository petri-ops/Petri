import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import { sketchToTaskSpec, type SketchTaskSpecResult } from '@/lib/sketchSpecClient';
import button from '@/components/ui/controls/button.module.css';
import styles from './SketchSpecDialog.module.css';

const MAX_SKETCH_BYTES = 6 * 1024 * 1024;

const LIST_FIELDS: Array<{ key: keyof SketchTaskSpecResult['taskSpec']; label: string }> = [
  { key: 'deliverables', label: '交付物' },
  { key: 'constraints', label: '约束' },
  { key: 'assumptions', label: '假设' },
  { key: 'acceptance', label: '验收' },
  { key: 'missingInfo', label: '缺失信息' },
];

function taskSpecPrompt(result: SketchTaskSpecResult): string {
  const lines = [
    `[草图 TaskSpec · ${result.model || 'vision'}]`,
    `目标：${result.taskSpec.goal}`,
  ];
  for (const field of LIST_FIELDS) {
    const values = result.taskSpec[field.key];
    if (Array.isArray(values) && values.length > 0) lines.push(`${field.label}：${values.join('；')}`);
  }
  lines.push('请依据该 TaskSpec 推进参数化 3D 建模；尺寸与约束只采用上面明确列出的信息。');
  return lines.join('\n');
}

export function SketchSpecDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [imageDataUrl, setImageDataUrl] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string>('');
  const [dimensions, setDimensions] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [phase, setPhase] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = React.useState<SketchTaskSpecResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [noticed, setNoticed] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    setPhase('idle');
    setNoticed(false);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('草图仅支持 PNG/JPEG/WebP。');
      return;
    }
    if (file.size > MAX_SKETCH_BYTES) {
      setError('草图文件超过 6MB 上限。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:image/')) {
        setError('草图读取失败。');
        return;
      }
      setImageDataUrl(dataUrl);
      setFileName(file.name);
    };
    reader.onerror = () => setError('草图读取失败。');
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!imageDataUrl) return;
    setPhase('running');
    setError(null);
    setResult(null);
    setNoticed(false);
    try {
      const next = await sketchToTaskSpec({ imageDataUrl, dimensions, notes });
      setResult(next);
      setPhase('done');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'sketch_spec_failed');
      setPhase('error');
    }
  };

  const addToComposer = () => {
    if (!result) return;
    dispatchPetriEvent(petriEvents.copilotAsk, { prompt: taskSpecPrompt(result), compose: true });
    setNoticed(true);
  };

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="草图转需求" data-testid="sketch-spec-dialog">
        <header className={styles.header}>
          <span className={styles.title}>
            <Icon name="image" size={15} />
            <strong>草图转需求</strong>
          </span>
          <button type="button" className={button.ghost} onClick={onClose} aria-label="关闭草图转需求">
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className={styles.uploadRow}>
          <button type="button" className={button.ghost} onClick={() => fileRef.current?.click()}>
            {imageDataUrl ? '更换草图' : '选择草图'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }}
          />
          {imageDataUrl ? <img src={imageDataUrl} alt="草图预览" className={styles.preview} /> : null}
          {fileName ? <span className={styles.meta}>{fileName}</span> : <span className={styles.meta}>PNG/JPEG/WebP · ≤6MB</span>}
        </div>

        <label className={styles.field}>
          <span>已知尺寸（可选；未填写的尺度会进入缺失信息）</span>
          <input
            value={dimensions}
            onChange={(event) => setDimensions(event.target.value)}
            placeholder="例如 120 × 80 × 40 mm，壁厚 2mm"
            maxLength={500}
          />
        </label>
        <label className={styles.field}>
          <span>补充说明（材料/用途/装配）</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="例如 ABS 外壳，正面开 USB 口"
          />
        </label>

        <div className={styles.actions}>
          <button type="button" className={button.primary} disabled={!imageDataUrl || phase === 'running'} onClick={() => { void generate(); }}>
            {phase === 'running' ? '正在生成…' : '生成 TaskSpec'}
          </button>
          <span className={styles.meta}>只生成草稿；不会自动建场景或执行。</span>
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {result ? (
          <div className={styles.result}>
            <div className={styles.resultHead}>
              <span className={styles.meta}>{result.model ? `模型 ${result.model}` : '视觉模型'}</span>
              <span className={styles.badge}>task-spec/v1 · modeling</span>
            </div>
            <p><strong>目标：</strong>{result.taskSpec.goal}</p>
            <dl>
              {LIST_FIELDS.map((field) => {
                const values = result.taskSpec[field.key];
                if (!Array.isArray(values) || values.length === 0) return null;
                return (
                  <React.Fragment key={field.key}>
                    <dt className={field.key === 'missingInfo' ? styles.warningText : undefined}>{field.label}</dt>
                    <dd>{values.join('；')}</dd>
                  </React.Fragment>
                );
              })}
            </dl>
            <pre className={styles.prompt}>{result.optimizedPrompt}</pre>
            <div className={styles.actions}>
              <button type="button" className={button.primary} onClick={addToComposer}>
                {noticed ? '已加入输入框' : '加入对话'}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
