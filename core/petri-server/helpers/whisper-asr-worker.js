'use strict';

/**
 * whisper-asr-worker.js — BLOCK-519 阶段二：native addon 隔离子进程。
 * 只在 worker 内 require @fugood/whisper.node（native），主进程零加载。
 * 输出单行 JSON 信封：{ ok:true, text, durationMs } 或 { ok:false, code, message }。
 */
(async () => {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const model = get('--model');
  const wav = get('--wav');
  const language = get('--language') || 'auto';
  const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  try {
    if (!model || !wav) throw Object.assign(new Error('缺少 --model/--wav'), { code: 'whisper_args_missing' });
    const { initWhisper } = require('@fugood/whisper.node');
    if (typeof initWhisper !== 'function') throw Object.assign(new Error('native addon 无 initWhisper'), { code: 'whisper_native_unavailable' });
    // 实测 1.0.13：README 写 { model }，但 native WhisperContext.cpp 读 `filePath`
    // （文档漂移）——两个键都给，兼容未来修正版。
    const ctx = await initWhisper({ model, filePath: model, useGpu: true });
    const started = Date.now();
    // transcribeFile 返回 { stop, promise }（非直接 promise）
    const call = ctx.transcribeFile(wav, { language: language === 'auto' ? undefined : language, temperature: 0 });
    const result = await (call && typeof call.promise === 'object' ? call.promise : call);
    const text = typeof result === 'string'
      ? result
      : (result && (result.text || result.result || result.output)) || '';
    emit({ ok: true, text: String(text), durationMs: Date.now() - started });
  } catch (error) {
    emit({ ok: false, code: (error && error.code) || 'whisper_worker_failed', message: error && error.message ? error.message : 'unknown' });
  }
})();
