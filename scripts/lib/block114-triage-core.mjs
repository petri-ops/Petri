/**
 * scripts/lib/block114-triage-core.mjs — BLOCK-114 W1-4 测试失败归因分类内核（三层管线）。
 *
 * 契约（plan docs/block-114-test-failure-triage-plan.md §1.1/§2）：
 *  - L1 指纹层（确定性，A 型永不模型化）：sha1(file::testName) 前 12 位比对在册登记表
 *    → known_existing，零模型调用；
 *  - L2 环境特征层（确定性）：报错文本命中环境词表 → environment，零模型调用；
 *  - L3 语义残差层（决策原语）：其余 → askDecision choice 四类 + conf ≥ θ 采纳，
 *    否则 needs_human 转人工；缺 key/任何决策失败 → needs_human（工具失效不产生错误归类）。
 *  - D-3 零容忍：new_regression 的判定允许（保守方向），但 L3 永不把 new_regression
 *    改判成非回归——L3 只在「非指纹命中且非环境词表」的残差上判别，判为
 *    new_regression 直接采纳（报给人工复核的方向性结论），判为其他类仍需 conf ≥ θ。
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../../core/biof3-server/helpers/decision-api.js');

/** D-3（P0 校准证据 acceptance/block-114/calibration.json：θ=0.70 precision 95%/coverage 96.2%/
 *  nrMisroute=0——取偏离边缘的余量档；调整阈值必须先重校准）。 */
export const TRIAGE_THRESHOLD = 0.7;

/** L2 环境特征确定性词表（A 型：命中即 environment，永不模型化；契约测试钉住）。 */
export const ENVIRONMENT_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /ENOSPC/i,
  /EPERM[ :]/i,
  /EACCES[ :]/i,
  /port \d+ already in use/i,
  /listen EADDRINUSE/i,
  /getaddrinfo ENOTFOUND/i,
  /socket hang up/i,
];

export function fingerprintOf(testFile, testName) {
  return crypto.createHash('sha1').update(`${testFile}::${testName}`).digest('hex').slice(0, 12);
}

/** L2：报错摘要命中环境词表。 */
export function matchesEnvironmentPattern(errorText) {
  return ENVIRONMENT_PATTERNS.some((re) => re.test(String(errorText || '')));
}

/** 组装 L3 决策请求（校准 harness 引用本函数——单源，形状漂移即校准失效）。 */
export function buildTriageDecisionRequest({ testFile, testName, errorText }) {
  const summary = String(errorText || '').slice(0, 600);
  return {
    state:
      `一次自动化测试运行中的失败记录：\n`
      + `测试文件：${testFile}\n`
      + `测试用例：${testName}\n`
      + `报错摘要：${summary}`,
    questions: {
      attribution: {
        type: 'choice',
        criteria: {
          defect: '断言失败或逻辑错误——需要人工关注或修复的缺陷类失败（含新回归与未登记的既有缺陷）',
          environment: '网络不可达、权限、磁盘、端口占用等运行环境因素导致的失败',
          flaky: '时序抖动、等待不足、随机顺序依赖等不确定因素导致的偶发失败',
        },
        instructions:
          '对这条测试失败做归因。断言失败或逻辑错误（需要人工关注/修复）为 defect；'
          + '明显由环境因素（网络/权限/磁盘/端口）导致为 environment；'
          + '偶发、时序、等待类不稳定失败为 flaky。不确定时选择最接近的类别。',
      },
    },
  };
}

/** L1+L2：确定性层。命中返回 {layer:'L1'|'L2', classifiedAs}；否则 null。 */
export function deterministicLayer({ testFile, testName, errorText }, knownFailures = []) {
  const fp = fingerprintOf(testFile, testName);
  const hit = (knownFailures || []).find((e) => e && e.fingerprint === fp);
  if (hit) return { layer: 'L1', classifiedAs: 'known_existing', fingerprint: fp, matched: hit };
  if (matchesEnvironmentPattern(errorText)) return { layer: 'L2', classifiedAs: 'environment', fingerprint: fp };
  return null;
}

/**
 * 单条失败完整归因：L1 → L2 → L3（决策原语）→ needs_human。
 * 返回 {classifiedAs, layer, confidence?, reason?, intent?...}；永不 throw。
 * overrides 仅供测试注入（fetchImpl/sleep/apiKey），生产零传参。
 */
export async function triageFailure(failure, knownFailures = [], overrides = {}) {
  const det = deterministicLayer(failure, knownFailures);
  if (det) {
    return { classifiedAs: det.classifiedAs, layer: det.layer, fingerprint: det.fingerprint, confidence: 1 };
  }
  const { state, questions } = buildTriageDecisionRequest(failure);
  const outcome = await decisionApi.askDecision({ state, questions, overrides });
  if (!outcome.ok) {
    return { classifiedAs: 'needs_human', layer: 'L3', reason: outcome.reason, confidence: null };
  }
  const answer = outcome.answers.attribution;
  // D-3 零容忍：defect 保守采纳（方向性结论交人工复核）；environment/flaky 需 conf ≥ θ
  //（known_existing 不在 L3 类目集——P0 校准证实「在册与否」是登记表属性非文本语义，
  //  由 L1 独占；未登记旧缺陷与 新回归 动作等价，统一归 defect。）
  if (answer.choice === 'defect') {
    return { classifiedAs: 'new_regression', layer: 'L3', choice: answer.choice, confidence: answer.confidence, reason: 'adopted_conservative' };
  }
  if (answer.confidence >= TRIAGE_THRESHOLD) {
    return { classifiedAs: answer.choice, layer: 'L3', choice: answer.choice, confidence: answer.confidence, reason: 'adopted' };
  }
  return { classifiedAs: 'needs_human', layer: 'L3', choice: answer.choice, confidence: answer.confidence, reason: 'below_threshold' };
}

/** 批量归因（顺序执行；L3 每条一次出站调用）。 */
export async function triageAll(failures, knownFailures = [], overrides = {}) {
  const results = [];
  for (const f of failures) {
    results.push(await triageFailure(f, knownFailures, overrides));
  }
  return results;
}
