'use strict';

/**
 * shared-backend/skill-preflight.js — 技能依赖自检 preflight（BLOCK-176 W7 CP-21）。
 *
 * 三态语义（plan §2；blocked_platform 为诚实的第四态）：
 *  - available       平台适用且 requires.bins 全部在场 → 可用
 *  - installable     平台适用、缺 bins、但有 install 配方 → 待装（走既有 run_cmd
 *                    审批链执行配方，guard-ack/审批记录链既有留痕，不建第二确认通道）
 *  - missing_deps    平台适用、缺 bins、无配方 → 缺依赖（如实报告缺什么）
 *  - blocked_platform 声明 os 不含当前平台 → 平台不适用（非缺依赖，不提示安装）
 *
 * 纯函数面 checkSkillDeps 注入 platform/hasBin（测试直打）；probeBinSync 为运行时
 * 探测面（which/where）。探测失败 fail-open 为「未检出」=缺，不虚报可用。
 */

const { spawnSync } = require('node:child_process');

/**
 * 依赖三态判定（纯函数，测试直打）。
 * @param {object} skill - registry entry（dependencies 归一结构）
 * @param {{ platform?: string, hasBin?: (bin: string) => boolean }} [opts]
 */
function checkSkillDeps(skill, opts = {}) {
  const platform = opts.platform || process.platform;
  const hasBin = typeof opts.hasBin === 'function' ? opts.hasBin : () => true;
  // BLOCK-211（W8 · C-33）：`plugins.required` 是**硬依赖**，此前被 preflight 完全忽略——
  // 于是"依赖是插件而不是二进制"的技能（生物信息学两族）恒报 available，货架显示"依赖可用"
  // 但实际缺 5 个插件包，正是「货架可见不可用」。默认 `() => true` 保持纯函数既有语义
  // （不传探测面的调用方行为不变），真实探测由路由层注入。
  const hasPlugin = typeof opts.hasPlugin === 'function' ? opts.hasPlugin : () => true;
  const deps = (skill && skill.dependencies) || {};
  const requiresBins = Array.isArray(deps.requiresBins) ? deps.requiresBins : [];
  const requiresPlugins = Array.isArray(skill && skill.plugins && skill.plugins.required) ? skill.plugins.required : [];
  const declaredOs = Array.isArray(deps.os) ? deps.os : null;

  if (declaredOs && !declaredOs.includes(platform)) {
    return { status: 'blocked_platform', platformOk: false, missingBins: [], missingPlugins: [], declaredOs, install: deps.install || null };
  }
  const missingBins = requiresBins.filter((bin) => !hasBin(bin));
  const missingPlugins = requiresPlugins.filter((pluginId) => !hasPlugin(pluginId));
  if (missingBins.length === 0 && missingPlugins.length === 0) {
    return { status: 'available', platformOk: true, missingBins: [], missingPlugins: [], declaredOs, install: deps.install || null };
  }
  return {
    // 插件包**没有**自动安装配方：缺插件只能算缺依赖，不能标"可安装"
    status: missingBins.length > 0 && deps.install ? 'installable' : 'missing_deps',
    platformOk: true,
    missingBins,
    missingPlugins,
    declaredOs,
    install: deps.install || null,
  };
}

/** 运行时二进制探测：win32=where，其余=which；spawn 失败=未检出（false）。 */
function probeBinSync(bin) {
  if (!bin || typeof bin !== 'string') return false;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(cmd, [bin], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    return res.status === 0 && String(res.stdout || '').trim() !== '';
  } catch {
    return false;
  }
}

/** 单技能 preflight（真实探测面）。 */
function preflightSkill(skill, opts = {}) {
  return checkSkillDeps(skill, { ...opts, hasBin: opts.hasBin || ((b) => probeBinSync(b)) });
}

/** 全量 preflight：skills 数组 → { id: result }。 */
function preflightAll(skills, opts = {}) {
  const out = {};
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (skill && skill.id) out[skill.id] = preflightSkill(skill, opts);
  }
  return out;
}

const DEPS_STATUS_LABELS = {
  available: '可用',
  installable: '待装',
  missing_deps: '缺依赖',
  blocked_platform: '平台不适用',
};

module.exports = {
  checkSkillDeps,
  probeBinSync,
  preflightSkill,
  preflightAll,
  DEPS_STATUS_LABELS,
};
