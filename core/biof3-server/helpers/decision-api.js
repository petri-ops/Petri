/**
 * BLOCK-110-JEV P0：TypeSafe Jev（System One）决策 API 唯一接入 wrapper。
 *
 * 设计契约（plan docs/block-110-jev-decision-integration-plan.md §1.1/§3）：
 *  - 裸 HTTP（全局 fetch），0 npm 新依赖；所有接点必经本模块（退出=删本文件+各接点回退降级路径）。
 *  - 模型 pin `jev-1.13.0`（禁用 jev-latest 别名——阈值校准绑版本，plan §8.2）。
 *  - 响应校验仿 jev-ultrafast validate_choice：choice∈criteria、概率键完备、[0,1] 有限、
 *    和≈1（±0.02）、choice=argmax；score/noul 题型各自校验。
 *  - 降级契约：缺 key、网络失败、校验失败等一律返回 `{ok:false, reason}`，绝不 throw、
 *    绝不让决策 API 成为单点故障；调用方拿 !ok 即回退现行为（降级路径即退出路径）。
 *  - D-B provider 可替换性：base URL / 模型 / key 全部可配，响应契约不绑定任何域名。
 *  - key 只从服务端 env 读（TYPESAFE_API_KEY），绝不入仓、绝不回显（quality:secret 红线）。
 */
'use strict';

const DECISION_MODEL_PIN = 'jev-1.13.0';
const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000; // 内联对话路径不做长睡；超上限的 Retry-After 按上限睡一次后仍败即降级
const RETRY_JITTER_MS = 250;

/**
 * 组装决策调用配置；缺 key 返回 null（调用方降级）。
 * overrides 仅供测试注入（fetchImpl/sleep/now），生产路径零传参。
 */
function resolveDecisionConfig(overrides = {}) {
  const apiKey = overrides.apiKey ?? process.env.TYPESAFE_API_KEY ?? '';
  if (!apiKey) return null;
  const rawBase = overrides.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? DEFAULT_BASE_URL;
  return {
    apiKey,
    baseUrl: String(rawBase).replace(/\/+$/, ''),
    model: overrides.model ?? process.env.TYPESAFE_MODEL ?? DECISION_MODEL_PIN,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxAttempts: overrides.maxAttempts ?? MAX_ATTEMPTS,
    fetchImpl: overrides.fetchImpl ?? fetch,
    sleep: overrides.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: overrides.now ?? (() => Date.now()),
  };
}

// ============================================================
// 客户端请求形状校验（把垃圾挡在出站之前）
// ============================================================

/**
 * 校验 questions 形状；返回 {ok, reason?}。choice≤255 项 / score 2~10 级（官方约束）。
 */
function validateQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return { ok: false, reason: 'questions 必须是非空对象' };
  }
  const keys = Object.keys(questions);
  if (keys.length === 0) return { ok: false, reason: 'questions 不能为空' };
  for (const key of keys) {
    const q = questions[key];
    if (!q || typeof q !== 'object') return { ok: false, reason: `questions[${key}] 必须是对象` };
    if (q.type === 'choice') {
      const criteria = q.criteria;
      if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
        return { ok: false, reason: `questions[${key}] choice 的 criteria 必须是对象` };
      }
      const n = Object.keys(criteria).length;
      if (n < 1) return { ok: false, reason: `questions[${key}] choice criteria 不能为空` };
      if (n > 255) return { ok: false, reason: `questions[${key}] choice criteria 超 255 项上限` };
    } else if (q.type === 'score') {
      const criteria = q.criteria;
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
        return { ok: false, reason: `questions[${key}] score criteria 必须是 2~10 级数组` };
      }
    } else if (q.type === 'noul') {
      // noul 无必填字段（instructions 可选）
    } else {
      return { ok: false, reason: `questions[${key}] type 必须是 choice/score/noul` };
    }
  }
  return { ok: true };
}

// ============================================================
// 响应校验（仿 jev-ultrafast validate_choice，非法即拒收降级——模型无法编造选项外的值）
// ============================================================

function _finiteInUnitRange(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/**
 * choice 题型校验：choice∈ids、概率键完备、值有限 [0,1]、和≈1(±0.02)、choice=argmax、confidence 有限 [0,1]。
 */
function validateChoiceAnswer(answer, criteriaKeys) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'answer 非对象' };
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
    return { ok: false, reason: 'probabilities 缺失或非对象' };
  }
  const probKeys = Object.keys(probabilities);
  const ids = Array.isArray(criteriaKeys) ? criteriaKeys : Object.keys(criteriaKeys || {});
  if (probKeys.length !== ids.length || !ids.every((id) => Object.prototype.hasOwnProperty.call(probabilities, id))) {
    return { ok: false, reason: '概率键与 criteria 不完备一致' };
  }
  const values = probKeys.map((k) => probabilities[k]).concat(answer.confidence);
  if (!values.every(_finiteInUnitRange)) return { ok: false, reason: '概率/confidence 存在非 [0,1] 有限数值' };
  const sum = probKeys.reduce((acc, k) => acc + probabilities[k], 0);
  if (Math.abs(sum - 1) >= 0.02) return { ok: false, reason: `概率和 ${sum} 偏离 1 超 ±0.02` };
  if (!ids.includes(answer.choice)) return { ok: false, reason: `choice "${answer.choice}" 不在 criteria 内` };
  const max = Math.max(...probKeys.map((k) => probabilities[k]));
  if (probabilities[answer.choice] < max - 1e-6) return { ok: false, reason: 'choice 非 argmax' };
  return { ok: true };
}

/**
 * score 题型校验：score 有限且落在 [0, N-1]（Σ级号×概率）、分布键完备归一。
 */
function validateScoreAnswer(answer, criteria) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'answer 非对象' };
  const levels = criteria.length;
  const expectedKeys = Array.from({ length: levels }, (_, i) => String(i));
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
    return { ok: false, reason: 'probabilities 缺失或非对象' };
  }
  const probKeys = Object.keys(probabilities);
  if (probKeys.length !== levels || !expectedKeys.every((k) => Object.prototype.hasOwnProperty.call(probabilities, k))) {
    return { ok: false, reason: '概率键与级号不完备一致' };
  }
  if (!probKeys.map((k) => probabilities[k]).every(_finiteInUnitRange)) {
    return { ok: false, reason: '概率存在非 [0,1] 有限数值' };
  }
  const sum = probKeys.reduce((acc, k) => acc + probabilities[k], 0);
  if (Math.abs(sum - 1) >= 0.02) return { ok: false, reason: `概率和 ${sum} 偏离 1 超 ±0.02` };
  if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > levels - 1) {
    return { ok: false, reason: 'score 非有限数值或越界' };
  }
  const expected = probKeys.reduce((acc, k) => acc + Number(k) * probabilities[k], 0);
  if (Math.abs(expected - answer.score) > 0.05) return { ok: false, reason: 'score 与 Σ级号×概率 偏差超 0.05' };
  return { ok: true };
}

/**
 * noul 题型校验：仅 noul=P(yes) 有限 [0,1]（无 confidence 无分布——官方契约）。
 */
function validateNoulAnswer(answer) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'answer 非对象' };
  if (!_finiteInUnitRange(answer.noul)) return { ok: false, reason: 'noul 非 [0,1] 有限数值' };
  return { ok: true };
}

/**
 * 全量响应校验：每个问题都有答案 + 按题型分发校验。返回 {ok, reason?}。
 */
function validateAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, reason: 'answers 缺失或非对象' };
  }
  for (const key of Object.keys(questions)) {
    const q = questions[key];
    const answer = answers[key];
    if (!Object.prototype.hasOwnProperty.call(answers, key)) {
      return { ok: false, reason: `answers 缺问题 "${key}"` };
    }
    let result;
    if (q.type === 'choice') result = validateChoiceAnswer(answer, Object.keys(q.criteria));
    else if (q.type === 'score') result = validateScoreAnswer(answer, q.criteria);
    else result = validateNoulAnswer(answer);
    if (!result.ok) return { ok: false, reason: `问题 "${key}"：${result.reason}` };
  }
  return { ok: true };
}

// ============================================================
// 出站调用（超时 + 指数退避重试 429/529 尊重 Retry-After + 类型化降级）
// ============================================================

function _sleepDelayForRetry(attempt, retryAfterHeader) {
  const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  let delay = backoff + Math.random() * RETRY_JITTER_MS;
  const retryAfterMs = _parseRetryAfter(retryAfterHeader);
  if (retryAfterMs != null) delay = Math.min(Math.max(retryAfterMs, 0), RETRY_MAX_DELAY_MS);
  return delay;
}

function _parseRetryAfter(header) {
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return asSeconds * 1000;
  const asDate = Date.parse(String(header));
  if (Number.isFinite(asDate)) return Math.max(asDate - Date.now(), 0);
  return null;
}

function _retryableStatus(status) {
  return status === 429 || status === 529;
}

/**
 * 唯一决策入口。state: string|object|array（原样透传）；questions 形状见 API 速查。
 *
 * @returns {Promise<{ok: true, model: string, answers: object, usage: object|undefined, elapsedMs: number, attempts: number}
 *   |{ok: false, reason: 'no_key'|'invalid_request'|'auth_failed'|'rate_limited'|'overloaded'
 *     |'http_error'|'network_error'|'timeout'|'invalid_response'|'aborted', detail?: string, status?: number, elapsedMs: number, attempts: number}>}
 * 永不 throw；!ok 即调用方回退现行为。detail 不含 key/请求头。
 */
async function askDecision({ state, questions, overrides = {} } = {}) {
  const startedAt = Date.now();
  const config = resolveDecisionConfig(overrides || {});
  if (!config) {
    return { ok: false, reason: 'no_key', detail: 'TYPESAFE_API_KEY 未配置，决策 API 降级', elapsedMs: 0, attempts: 0 };
  }
  const shape = validateQuestions(questions);
  if (!shape.ok) {
    return { ok: false, reason: 'invalid_request', detail: shape.reason, elapsedMs: Date.now() - startedAt, attempts: 0 };
  }

  const body = JSON.stringify({ model: config.model, state, questions });
  let lastFailure = null;
  // Node 24：AbortSignal.timeout 触发抛 TimeoutError（可重试）；调用方 signal 触发抛 AbortError（立即降级）
  const callerSignal = overrides.signal instanceof AbortSignal ? overrides.signal : null;
  const attemptSignal = callerSignal
    ? AbortSignal.any([AbortSignal.timeout(config.timeoutMs), callerSignal])
    : AbortSignal.timeout(config.timeoutMs);

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    let response;
    try {
      response = await config.fetchImpl(`${config.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: attemptSignal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, reason: 'aborted', detail: '调用方取消', elapsedMs: Date.now() - startedAt, attempts: attempt + 1 };
      }
      if (err && err.name === 'TimeoutError') {
        lastFailure = { reason: 'timeout', detail: `决策请求超时（${config.timeoutMs}ms）` };
      } else {
        lastFailure = { reason: 'network_error', detail: `网络失败：${(err && err.message) || err}` };
      }
    }

    if (response) {
      if (!response.ok) {
        const status = response.status;
        let detail = `HTTP ${status}`;
        try {
          const text = await response.text();
          if (text) detail += `：${text.slice(0, 300)}`;
        } catch { /* body 读失败不影响分类 */ }
        if (status === 401) {
          return { ok: false, reason: 'auth_failed', detail: 'key 无效（401）', status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1 };
        }
        if (status === 422) {
          return { ok: false, reason: 'invalid_request', detail, status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1 };
        }
        if (!_retryableStatus(status)) {
          return { ok: false, reason: 'http_error', detail, status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1 };
        }
        lastFailure = {
          reason: status === 429 ? 'rate_limited' : 'overloaded',
          detail,
          status,
          retryAfterHeader: response.headers.get('retry-after'),
        };
      } else {
        let payload = null;
        try {
          payload = await response.json();
        } catch (err) {
          return {
            ok: false, reason: 'invalid_response', detail: `响应非 JSON：${(err && err.message) || err}`,
            status: response.status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1,
          };
        }
        if (!payload || typeof payload !== 'object' || !payload.answers) {
          return {
            ok: false, reason: 'invalid_response', detail: '响应缺 answers 对象',
            status: response.status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1,
          };
        }
        const verdict = validateAnswers(questions, payload.answers);
        if (!verdict.ok) {
          return {
            ok: false, reason: 'invalid_response', detail: verdict.reason,
            status: response.status, elapsedMs: Date.now() - startedAt, attempts: attempt + 1,
          };
        }
        return {
          ok: true,
          model: typeof payload.model === 'string' ? payload.model : config.model,
          answers: payload.answers,
          usage: payload.usage,
          elapsedMs: Date.now() - startedAt,
          attempts: attempt + 1,
        };
      }
    }

    const isLastAttempt = attempt === config.maxAttempts - 1;
    if (!isLastAttempt) {
      const delay = _sleepDelayForRetry(attempt, lastFailure && lastFailure.retryAfterHeader);
      await config.sleep(delay);
    }
  }

  return {
    ok: false,
    reason: (lastFailure && lastFailure.reason) || 'network_error',
    detail: (lastFailure && lastFailure.detail) || `重试 ${config.maxAttempts} 次耗尽`,
    status: lastFailure && lastFailure.status,
    elapsedMs: Date.now() - startedAt,
    attempts: config.maxAttempts,
  };
}

module.exports = {
  DECISION_MODEL_PIN,
  DEFAULT_BASE_URL,
  resolveDecisionConfig,
  validateQuestions,
  validateChoiceAnswer,
  validateScoreAnswer,
  validateNoulAnswer,
  validateAnswers,
  askDecision,
};
