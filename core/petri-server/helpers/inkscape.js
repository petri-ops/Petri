'use strict';

/**
 * BLOCK-342 切片5 — Inkscape 无头协处理器（探针 + 动作执行）。
 *
 * 诚实边界：本机未装 Inkscape 时一切动作为 `inkscape_unavailable`（前端据此灰化）；
 * 探针只做文件可执行性检查（不 exec，避免探测延迟）；动作执行走 `--actions`/导出参数，
 * 产物写临时文件，写回由调用方（tool 层）带 before-sha 守卫完成——协处理器不绕过治理。
 */

const fs = require('node:fs');
const { execFile } = require('node:child_process');

const ACTIONS = new Set(['union', 'difference', 'intersection', 'text-to-path', 'export-pdf']);

function err(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

/** 探针：env 优先（PETRI_INKSCAPE_BIN），其后常见安装路径；只查 X_OK。 */
function probeInkscape(env) {
  const e = env || process.env;
  const candidates = [];
  if (e.PETRI_INKSCAPE_BIN) candidates.push({ bin: String(e.PETRI_INKSCAPE_BIN), source: 'env' });
  candidates.push(
    { bin: '/Applications/Inkscape.app/Contents/MacOS/inkscape', source: 'path' },
    { bin: '/usr/local/bin/inkscape', source: 'path' },
    { bin: '/opt/homebrew/bin/inkscape', source: 'path' },
    { bin: '/usr/bin/inkscape', source: 'path' },
  );
  for (const c of candidates) {
    try {
      fs.accessSync(c.bin, fs.constants.X_OK);
      return { available: true, bin: c.bin, source: c.source };
    } catch {
      // 候选不可执行：继续下一个（诚实缺席）
    }
  }
  return {
    available: false,
    bin: null,
    source: null,
    hint: '未检测到 Inkscape；安装后重启，或设 PETRI_INKSCAPE_BIN 指向可执行文件',
  };
}

function inkscapeStatus(env) {
  return probeInkscape(env);
}

/**
 * 动作 → Inkscape CLI 参数。
 * Inkscape 1.4 实证（--action-list）：布尔= path-union/path-difference/path-intersection
 * （旧名 union/difference/intersection 不存在，actions 链静默中断导致几何不执行——实机抓真）；
 * select-all 参数枚举只有 all/layers/no-layers/groups/no-groups（无 objects/texts）。
 * 文字转路径=全选后 object-to-path（1.4 对 text 同样生效；副作用=全档 shape 转 path，文档化）。
 */
function buildArgs(action, svgAbs, outAbs) {
  if (action === 'export-pdf') {
    return ['--export-type=pdf', `--export-filename=${outAbs}`, svgAbs];
  }
  if (action === 'text-to-path') {
    // 1.x 官方姿势——text 转路径是导出参数（--export-text-to-path），非 action
    return ['--export-text-to-path', `--export-filename=${outAbs}`, svgAbs];
  }
  // BLOCK-345 实机抓真——1.4 布尔 action 名是 path-*（union/difference/intersection 在
  // 1.4 actions 表不存在，链遇未知 action 中断 → 导出原文件假 changed）
  const verbs = { union: 'path-union', difference: 'path-difference', intersection: 'path-intersection' };
  const verb = verbs[action];
  if (!verb) return [`--actions=select-all:no-groups;${verb};export-filename:${outAbs};export-do`, svgAbs];
  return [`--actions=select-all:no-groups;${verb};export-filename:${outAbs};export-do`, svgAbs];
}

/**
 * 执行动作（callback 风格）。产物写 outAbs（临时文件），由调用方治理写回；
 * export-pdf 的产物即交付物（PDF 二进制），调用方决定落点。
 */
function runInkscapeAction(args, onDone) {
  const status = inkscapeStatus();
  if (!status.available) {
    onDone(err('inkscape_unavailable', status.hint || 'Inkscape 不可用', { hint: status.hint }));
    return;
  }
  const action = args && args.action;
  if (!ACTIONS.has(action)) {
    onDone(err('inkscape_action_invalid', `action 不在支持清单：${[...ACTIONS].join('/')}`));
    return;
  }
  const child = execFile(
    status.bin,
    buildArgs(action, args.svgAbs, args.outAbs),
    { timeout: args.timeoutMs || 120_000, maxBuffer: 8 * 1024 * 1024 },
    (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || '').slice(0, 400);
        onDone(err('inkscape_run_failed', `Inkscape 执行失败：${detail}`, { stderrSnippet: detail }));
        return;
      }
      if (!fs.existsSync(args.outAbs)) {
        onDone(err('inkscape_no_output', 'Inkscape 未产出结果文件（检查动作与文档内容）'));
        return;
      }
      onDone(null, { bin: status.bin, action, outAbs: args.outAbs });
    },
  );
  return child;
}

module.exports = { ACTIONS, probeInkscape, inkscapeStatus, buildArgs, runInkscapeAction };
