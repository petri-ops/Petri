/**
 * generation-intent.js — 意图预设 + 任务感知自动参数（owner 授权 msg_b9d146535752，推荐 A；
 * env 后门终裁移除 msg_b8392b7ee460）。
 *
 * 红线：①预设=策展常量表（有界范围），**agent 不可自写自己的生成参数**（防自我强化回路，
 * 与 A3 注入防护/外部监督器只观测同哲学）；②优先级链 意图覆盖 > 旧 generation 裸值 > 自动档
 * （env 通道已死，产品化后不暴露环境变量设参）；③判定失败一律落平衡 0.4；④底层 provider 链/
 * DB/schema 零改、思考档位 reasoning 键零改、零新依赖。
 */

/** 策展四档（有界常量；agent 不可写）。maxTokens='adaptive' = 交给 loop 既有 resolveOutputBudget。 */
const PRESETS = Object.freeze({
  precise: Object.freeze({ temperature: 0.2, maxTokens: undefined }),
  balanced: Object.freeze({ temperature: 0.4, maxTokens: undefined }),
  creative: Object.freeze({ temperature: 0.8, maxTokens: undefined }),
  longform: Object.freeze({ temperature: 0.4, maxTokens: 'adaptive' }),
});

// 本地零依赖关键词白名单（参考 plan-intent.js 形态；显式列表 + 兜底，不做模糊推断）。
const PRECISE_RE = /精确|逐条|走查|严格|准确|不要发挥|精准|precise/i;
const CREATIVE_RE = /创意|创作|故事|诗歌|脑暴|构思|发散|创意写|creative/i;
const LONGFORM_RE = /长文|完整展开|全文|长篇|所有章节|详尽报告|long.?form/i;

/**
 * 本地规则分层判定（纯函数，零外发、零依赖）。
 * 顺序：显式意图关键词 > taskKind/工具动作提示 > 兜底平衡；判定失败一律平衡。
 * @param {{userText?:string, taskKind?:string, toolsUsed?:string[]}} input
 * @returns {{preset:string, reason:string}}
 */
function detectIntentPreset(input = {}) {
  const text = String(input.userText || '');
  if (LONGFORM_RE.test(text)) return { preset: 'longform', reason: 'keyword_longform' };
  if (CREATIVE_RE.test(text)) return { preset: 'creative', reason: 'keyword_creative' };
  if (PRECISE_RE.test(text)) return { preset: 'precise', reason: 'keyword_precise' };
  // taskKind/工具动作仅作弱提示（subagent 多为执行类→精准；无信号→平衡）
  if (input.taskKind === 'subagent') return { preset: 'precise', reason: 'task_kind_subagent' };
  return { preset: 'balanced', reason: 'fallback_balanced' };
}

function parseBounded(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n >= 0 && n <= 2) return n;
  return fallback;
}

/** maxTokens 是 token 数（非负整数），不套温度的 0–2 约束。 */
function parseMaxTokens(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/**
 * 优先级链解析（意图覆盖 > 旧 generation 裸值 > 自动档；env 通道已移除）。
 * 忽略 env 与 agentDeclared（红线：agent 不可自写参数、产品化后不靠环境变量设参）。
 * @returns {{temperature:number, maxTokens:number|string|undefined, source:string}}
 */
function resolveGenerationParams({ intentPreset = '', generation = {}, detected = 'balanced' } = {}) {
  // env 后门已移除（owner 终裁 msg_b8392b7ee460）：即使调用方传 env 字段也忽略，
  // 不再有 'env' source。产品化后能力通道=config/API（intentPreset）+ 旧 generation 兼容 + 自动档。
  // 1) 意图覆盖（用户在设置页选了意图）
  if (intentPreset && Object.prototype.hasOwnProperty.call(PRESETS, intentPreset)) {
    const p = PRESETS[intentPreset];
    return { temperature: p.temperature, maxTokens: p.maxTokens, source: 'intent_override' };
  }
  // 2) 旧 generation 裸值兼容（今天行为零突变）
  if (generation && (generation.temperature != null || generation.maxTokens != null)) {
    return {
      temperature: parseBounded(generation.temperature, 0.4),
      maxTokens: parseMaxTokens(generation.maxTokens),
      source: 'legacy_generation',
    };
  }
  // 3) 自动档（默认）：本地规则判定，未知档落平衡
  const preset = Object.prototype.hasOwnProperty.call(PRESETS, detected) ? detected : 'balanced';
  const p = PRESETS[preset];
  return { temperature: p.temperature, maxTokens: p.maxTokens, source: 'auto' };
}

module.exports = { PRESETS, detectIntentPreset, resolveGenerationParams };
