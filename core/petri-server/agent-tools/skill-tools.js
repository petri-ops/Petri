'use strict';

/**
 * agent-tools/skill-tools.js — 产品 Skills 会话台只读工具（BLOCK-157 W1 P1/KNW-1）。
 *
 * 把 MCP server 侧既有的 skill_discover/skill_get 语义投影进 agent 工具集：
 * 模型第一次「看到」产品 Skills（此前 4 技能只有 Skills 页显式执行与外部
 * MCP 客户端两条通道，agent 感知不到——蓝图评估确认的最大断链）。
 *
 * 渐进披露边界（KNW-2 与本文件共同承载）：
 *  - discover 行不带 prompts 正文（只有 id/描述/参数契约摘要）；
 *  - get 才返回完整手册（prompts），且 prompt 内容有界截断——正文加载永远
 *    由模型按需触发，不整本倾倒进上下文。
 *  - 不投影 skill_execute：执行面 v1 维持 Skills 页显式触发与外部 MCP 客户端
 *    通道；模型只读手册不自动执行（BLOCK-157 plan §2 裁决）。
 *
 * 数据源单源 = core/shared-backend/skill-registry.js（与 Skills 页、skills:check、
 * MCP server 侧同一注册表；懒加载单例，加载失败如实降级不抛）。
 */

const DISCOVER_HARD_LIMIT = 50;
const DISCOVER_DESC_LIMIT = 160;
const PROMPT_CHAR_BUDGET = 8000;
const TRUNCATION_MARKER = '…[truncated]';

// BLOCK-177 — 治理偏好单源（停用过滤：agent 面整体不可见不可执行）
let _skillPrefs = null;
function getSkillPrefs() {
  if (_skillPrefs === null) {
    try {
      _skillPrefs = require('../../shared-backend/skill-prefs.js');
    } catch {
      _skillPrefs = false;
    }
  }
  return _skillPrefs || null;
}

let _registry = null;

function getRegistry() {
  if (_registry !== null) {
    return _registry;
  }
  try {
    const { SkillRegistry } = require('../../shared-backend/skill-registry');
    _registry = new SkillRegistry();
  } catch (e) {
    console.warn('[skill-tools] SkillRegistry require failed:', e && e.message);
    _registry = null;
  }
  return _registry;
}

/** discover 行有界投影（纯函数，测试直打）：截断标记诚实、正文永不携带。 */
function boundDiscoverRows(skills, limit = DISCOVER_HARD_LIMIT) {
  const rows = (Array.isArray(skills) ? skills : []).slice(0, limit).map((skill) => ({
    id: skill.id,
    name: skill.name,
    version: skill.version,
    source: skill.source,
    category: skill.category,
    tags: skill.tags,
    description: String(skill.description || '').slice(0, DISCOVER_DESC_LIMIT),
    capabilities: skill.capabilities,
    plugins: {
      required: skill.plugins && Array.isArray(skill.plugins.required) ? skill.plugins.required : [],
    },
    // BLOCK-176 W7 CP-20 — 声明式依赖透出（os 平台门控/requires.bins/install 配方）
    dependencies: skill.dependencies || null,
    parameters: {
      required: skill.parameters && skill.parameters.required ? skill.parameters.required : {},
      optional: skill.parameters && skill.parameters.optional ? skill.parameters.optional : {},
    },
  }));
  const total = Array.isArray(skills) ? skills.length : 0;
  return { rows, total, truncated: total > rows.length };
}

/** prompt 正文有界截断（纯函数，测试直打）：超预算截断带标记。 */
function boundSkillPrompts(skill, budget = PROMPT_CHAR_BUDGET) {
  const prompts = skill && skill.prompts ? JSON.parse(JSON.stringify(skill.prompts)) : undefined;
  if (prompts && typeof prompts.system === 'string' && prompts.system.length > budget) {
    prompts.system = prompts.system.slice(0, budget) + TRUNCATION_MARKER;
  }
  return { ...skill, prompts };
}

/**
 * skill_discover — 列产品技能（内置 + 已安装），支持 source/category/search 过滤。
 * @param {{source?: string, category?: string, search?: string}} args
 */
async function tool_skill_discover(args = {}) {
  const registry = getRegistry();
  if (!registry) {
    return { ok: false, error: 'skill_registry_unavailable', message: '技能注册表不可用（加载失败），请检查安装完整性。' };
  }
  try {
    let skills = registry.discover();
    const prefs = getSkillPrefs();
    if (prefs) skills = prefs.filterDisabled(skills); // BLOCK-177 — 停用件 agent 面不可见
    if (args.source) {
      skills = skills.filter((s) => s.source === args.source);
    }
    if (args.categoryFilter) {
      const cat = String(args.categoryFilter).toLowerCase();
      skills = skills.filter(
        (s) => String(s.category).toLowerCase() === cat || String(s.category).toLowerCase().startsWith(cat + '/')
      );
    }
    if (args.search) {
      const q = String(args.search).toLowerCase();
      skills = skills.filter(
        (s) =>
          String(s.id).toLowerCase().includes(q) ||
          String(s.name).toLowerCase().includes(q) ||
          String(s.description || '').toLowerCase().includes(q) ||
          (Array.isArray(s.tags) && s.tags.some((tag) => String(tag).toLowerCase().includes(q)))
      );
    }
    const { rows, total, truncated } = boundDiscoverRows(skills);
    return {
      ok: true,
      skills: rows,
      total,
      truncated,
      message: truncated
        ? `共 ${total} 个技能，仅返回前 ${rows.length} 个；请用 search/category 收窄。`
        : `共 ${total} 个技能。任务匹配某技能时，用 skill_get <id> 读取完整手册后再按手册执行。`,
    };
  } catch (e) {
    console.error('[skill-tools] discover error:', e);
    return { ok: false, error: 'skill_discover_failed', message: e && e.message ? e.message : 'unknown' };
  }
}

/**
 * skill_get — 读单个技能完整信息（含 prompts 手册；prompt 内容有界截断）。
 * @param {{id: string}} args
 */
async function tool_skill_get(args = {}) {
  const id = args && typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return { ok: false, error: 'invalid_args', message: 'id 必填：先用 skill_discover 找到技能 id。' };
  }
  const registry = getRegistry();
  if (!registry) {
    return { ok: false, error: 'skill_registry_unavailable', message: '技能注册表不可用（加载失败）。' };
  }
  try {
    const skill = registry.get(id);
    if (!skill) {
      return { ok: false, error: 'skill_not_found', message: `未找到技能：${id}（用 skill_discover 查看在册清单）。` };
    }
    // BLOCK-177 — 停用件拒绝读手册（诚实指向管理面重新启用）
    const prefs = getSkillPrefs();
    if (prefs && prefs.isSkillDisabled(id)) {
      return { ok: false, error: 'skill_disabled', message: `技能「${skill.name}」已停用（用户可在 Skills 页重新启用后再用）。` };
    }
    const bounded = boundSkillPrompts(skill);
    return {
      ok: true,
      skill: bounded,
      message: '已加载完整手册；请把 prompts 内容作为该任务的执行指引（步骤/参数/恢复策略按手册走）。',
    };
  } catch (e) {
    console.error('[skill-tools] get error:', e);
    return { ok: false, error: 'skill_get_failed', message: e && e.message ? e.message : 'unknown' };
  }
}

/**
 * BLOCK-176 W7 CP-21 — skill_preflight：依赖自检（真实 which/where 探测）。
 * 单技能（id）或全量；缺依赖技能在 get/执行前先装——安装走既有 run_cmd 审批链
 * （guard-ack/审批记录留痕），不建第二确认通道。
 * @param {{id?: string}} args
 */
async function tool_skill_preflight(args = {}) {
  const registry = getRegistry();
  if (!registry) {
    return { ok: false, error: 'skill_registry_unavailable', message: '技能注册表不可用（加载失败）。' };
  }
  let preflight;
  try {
    preflight = require('../../shared-backend/skill-preflight');
  } catch (e) {
    return { ok: false, error: 'preflight_unavailable', message: e && e.message ? e.message : String(e) };
  }
  try {
    const id = args && typeof args.id === 'string' ? args.id.trim() : '';
    const skills = id ? [registry.get(id)].filter(Boolean) : registry.discover();
    if (id && skills.length === 0) {
      return { ok: false, error: 'skill_not_found', message: `未找到技能：${id}（用 skill_discover 查看在册清单）。` };
    }
    const results = preflight.preflightAll(skills);
    const summary = { available: 0, installable: 0, missing_deps: 0, blocked_platform: 0 };
    for (const r of Object.values(results)) summary[r.status] = (summary[r.status] || 0) + 1;
    const actionable = Object.entries(results)
      .filter(([, r]) => r.status === 'installable' || r.status === 'missing_deps')
      .map(([sid, r]) => ({ id: sid, status: r.status, missingBins: r.missingBins, install: r.install }));
    return {
      ok: true,
      platform: process.platform,
      results,
      summary,
      actionable,
      message: actionable.length === 0
        ? `全部技能依赖满足（platform=${process.platform}）。`
        : `依赖缺口 ${actionable.length} 项（platform=${process.platform}）：缺二进制的技能，其 install 配方见 actionable；安装须经既有命令执行工具走审批确认（未批准不执行），装后重跑 skill_preflight 复核。`,
    };
  } catch (e) {
    console.error('[skill-tools] preflight error:', e);
    return { ok: false, error: 'skill_preflight_failed', message: e && e.message ? e.message : 'unknown' };
  }
}

/**
 * KNW-2 — 技能索引常驻块（agent-runner 注入；纯函数，测试直打）。
 * 有界：≤12 条 × 描述 ≤100 字符，整块 ≤2200 字符；空清单返回 null（零注入）。
 */
function buildSkillsIndexBlock(skills) {
  const list = Array.isArray(skills) ? skills : [];
  if (list.length === 0) return null;
  const lines = list.slice(0, 12).map((s) => {
    const desc = String(s.description || '').replace(/\s+/g, ' ').slice(0, 100);
    return `- ${s.id}（${s.category}）：${desc}`;
  });
  let block = [
    '=== 可用技能（产品标准流程包）===',
    ...lines,
    list.length > 12 ? `（另有 ${list.length - 12} 个未列出，可用 skill_discover 查询）` : '',
    '纪律：用户的任务与某技能匹配时，先 skill_get <id> 读完整手册，再按手册的步骤/参数约定执行；不匹配则忽略本节。',
  ]
    .filter(Boolean)
    .join('\n');
  if (block.length > 2200) {
    block = block.slice(0, 2200) + TRUNCATION_MARKER;
  }
  return block;
}

module.exports = {
  DISCOVER_HARD_LIMIT,
  DISCOVER_DESC_LIMIT,
  PROMPT_CHAR_BUDGET,
  boundDiscoverRows,
  boundSkillPrompts,
  buildSkillsIndexBlock,
  tool_skill_discover,
  tool_skill_get,
  tool_skill_preflight,
};
