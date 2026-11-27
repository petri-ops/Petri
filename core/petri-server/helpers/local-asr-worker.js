'use strict';

/**
 * local-asr-worker.js — BLOCK-519：短生命周期 native 子进程。
 * 由 local-asr.js spawn，DYLD_LIBRARY_PATH 在 spawn 时注入（主进程 env 零污染）。
 * 输出恒为 JSON 信封：{ok:true,text,durationMs} 或 {ok:false,code,message}。
 */
const { buildLocalRecognizeConfig } = require('./local-asr');

function parseArgs(argv) {
  const pairs = [];
  for (let i = 0; i < argv.length; i += 2) {
    const key = String(argv.at(i) || '').replace(/^--/, '');
    if (key) pairs.push([key, argv.at(i + 1)]);
  }
  return Object.fromEntries(pairs);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelDir = String(args.model || '');
  const wavPath = String(args.wav || '');
  if (!modelDir || !wavPath) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'local_asr_invalid_args', message: 'worker 参数缺失' }));
    process.exitCode = 1;
    return;
  }
  let sherpa;
  try {
    sherpa = require('sherpa-onnx-node');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'local_asr_unavailable', message: `sherpa-onnx-node 不可用：${error.message}` }));
    process.exitCode = 1;
    return;
  }
  try {
    const startedAt = Date.now();
    const recognizer = new sherpa.OfflineRecognizer(buildLocalRecognizeConfig({ modelDir, language: args.language || 'auto' }));
    const wave = sherpa.readWave(wavPath);
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    recognizer.decode(stream);
    const text = recognizer.getResult(stream).text;
    if (typeof text !== 'string') throw new Error('recognizer 未返回文本');
    process.stdout.write(JSON.stringify({
      ok: true,
      text,
      durationMs: Date.now() - startedAt,
      language: args.language || 'auto',
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'local_asr_failed', message: error && error.message ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
