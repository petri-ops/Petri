'use strict';

/**
 * shared-backend/do-coaching.js
 *
 * item 87 第二阶段 —— 教练循环引擎（方案 §3 四阶段）。
 *
 * 四阶段（wb 状态机骨架之上的教练层扩展态，不是替换）：
 *   影子 shadowing → 交接 scaffolding → 独立 independent（渐进放权，与 88 worker
 *   放权方向相反：88 是 agent 渐进获得自主权，这里是**用户**渐进获得自主权——
 *   滑移依据同为「难度加权的任务成功记录」，纯函数单源可测）。
 *   复盘 reflecting 是任务收尾后的动作（不在滑移曲线上，每次收尾必做）。
 *
 * HK-01 四钉对应：
 *   ①影子决策讲解轨迹钉：recordDecisionExplanation——每个决策点必须有结构化讲解
 *     （decision/why/domainConvention 非空），落 task_events（coaching.decision_explanation，
 *     可回放），缺项拒绝；
 *   ②交接比例滑移钉：computeHandoverPhase——随成功记录（accepted/total + pass 率）
 *     自动滑移 shadowing→scaffolding→independent，阈值纯函数；
 *   ③复盘分歧点结构化钉：recordReview——分歧点必须结构化五字段
 *     （decision/userChoice/domainConvention/costOfDeviation/sourceRef），自由文本拒绝；
 *   ④反馈对照钉：compareAgainstSamples——产物观察 vs 品味样本判例，逐维度结构化
 *     对照输出（只呈现对照事实，不下终判，终审归人）。
 *
 * 试点边界：PILOT_DOMAINS 白名单——只有 bio 试点域（petri-pack-bio）激活，
 * 其它域 create/记录一律拒绝（方案 §11）。
 *
 * 隐私（方案 §9）：全部本地 SQLite，零外发。
 */

const crypto = require('crypto');
const {
  DO_COACHING_CONTRACT_VERSION,
  ensureDoCoachingSchema,
} = require('./do-coaching-schema');

const PILOT_DOMAINS = Object.freeze(['bioinformatics']);

/** 教练阶段（滑移曲线 + 复盘动作）。 */
const COACHING_PHASES = Object.freeze(['shadowing', 'scaffolding', 'independent']);

/**
 * 渐进放权滑移（HK-01 钉②，纯函数）。
 * 依据：accepted/total 成功率 × 样本量置信（样本少不动）。
 *   - total < 2                        → shadowing（影子全做，数据不足不滑移）
 *   - accepted >= 2 且成功率 >= 0.5    → scaffolding（关键步骤交接）
 *   - accepted >= 5 且成功率 >= 0.8    → independent（agent 只验收）
 * 方向与 88 worker 放权相反（用户渐进获得自主权），引擎形状同源（纯函数阈值判定）。
 */
function computeHandoverPhase({ accepted, total }) {
  const acceptedN = Number(accepted) || 0;
  const totalN = Number(total) || 0;
  if (totalN < 2 || acceptedN < 2) {
    return { phase: 'shadowing', handoverRatio: 0, reason: '样本不足（total<2 或 accepted<2），保持影子全做' };
  }
  const passRate = acceptedN / Math.max(1, totalN);
  if (acceptedN >= 5 && passRate >= 0.8) {
    return { phase: 'independent', handoverRatio: 1, reason: `成功率 ${(passRate * 100).toFixed(0)}%（${acceptedN}/${totalN}）达独立阈值` };
  }
  if (passRate >= 0.5) {
    return { phase: 'scaffolding', handoverRatio: 0.5, reason: `成功率 ${(passRate * 100).toFixed(0)}%（${acceptedN}/${totalN}）进入交接档` };
  }
  return { phase: 'shadowing', handoverRatio: 0, reason: `成功率 ${(passRate * 100).toFixed(0)}% 未达交接阈值，退回影子档` };
}

function fail(error) {
  return { ok: false, error };
}

function newId(prefix) {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return `${prefix}_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** 结构化决策讲解（钉①）：decision/why/domainConvention 必填非空，forkOptions 可选数组。 */
function validateDecisionExplanation(explanation) {
  if (!explanation || typeof explanation !== 'object') return fail('讲解输入缺失');
  const decisionText = typeof explanation.decision === 'string' ? explanation.decision.trim() : '';
  const whyText = typeof explanation.why === 'string' ? explanation.why.trim() : '';
  const conventionText = typeof explanation.domainConvention === 'string' ? explanation.domainConvention.trim() : '';
  if (!decisionText || whyText.length === 0) return fail('决策讲解缺 decision/why（每决策点必须有讲解记录）');
  if (!conventionText) return fail('决策讲解缺 domainConvention（每决策点必须有讲解记录）');
  if (decisionText.length > 2000 || whyText.length > 2000 || conventionText.length > 2000) {
    return fail('决策讲解字段超限（≤2000 字符）');
  }
  if (explanation.forkOptions !== undefined && !Array.isArray(explanation.forkOptions)) {
    return fail('forkOptions 必须是数组（岔路口选项）');
  }
  return { ok: true };
}

/**
 * 创建教练循环 engaging（钉域白名单：只 bio 试点激活）。
 * 返回 { ok, runId, phase, handoverRatio }。
 */
function createCoachingRun(db, { goalId, taskId, domain, userId, accepted = 0, total = 0 }) {
  if (!PILOT_DOMAINS.includes(domain)) {
    return fail(`域 ${domain} 不在试点白名单（当前仅 ${PILOT_DOMAINS.join('/')}）`);
  }
  if (typeof goalId !== 'string' || !goalId.trim()) return fail('goalId 缺失');
  if (typeof userId !== 'string' || !userId.trim()) return fail('userId 缺失');
  const sliding = computeHandoverPhase({ accepted, total });
  const runId = newId('dorun');
  const now = nowIso();
  ensureDoCoachingSchema(db);
  db.prepare(`INSERT INTO do_coaching_runs (
    run_id, contract_version, goal_id, task_id, domain, user_id,
    phase, handover_ratio, accepted_count, total_count, decision_count, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId, DO_COACHING_CONTRACT_VERSION, goalId, taskId || null, domain, userId,
    sliding.phase, sliding.handoverRatio, Number(accepted) || 0, Number(total) || 0, 0, now, now,
  );
  // 轨迹可回放：创建事件落 task_events（若 task_id 在场）
  if (taskId) {
    const seqRow = db.prepare('SELECT COALESCE(MAX(seq),0) + 1 AS s FROM task_events WHERE task_id = ?').get(taskId);
    db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
      .run(taskId, seqRow.s, 'coaching.run_started', JSON.stringify({
        runId, goalId, domain, phase: sliding.phase, handoverRatio: sliding.handoverRatio,
      }), now);
  }
  return { ok: true, runId, phase: sliding.phase, handoverRatio: sliding.handoverRatio };
}

/**
 * 影子阶段决策讲解（钉①）：每决策点一条结构化讲解，落 task_events 可回放。
 * run 存在性 + 域白名单校验。
 */
function recordDecisionExplanation(db, { runId, taskId, explanation }) {
  const check = validateDecisionExplanation(explanation);
  if (!check.ok) return check;
  const run = db.prepare('SELECT * FROM do_coaching_runs WHERE run_id = ?').get(runId);
  if (!run) return fail(`教练 run 不存在：${runId}`);
  if (!PILOT_DOMAINS.includes(run.domain)) return fail(`域 ${run.domain} 不在试点白名单`);
  const targetTask = taskId || run.task_id;
  const now = nowIso();
  const seqRow = db.prepare('SELECT COALESCE(MAX(seq),0) + 1 AS s FROM task_events WHERE task_id = ?').get(targetTask || runId);
  const payload = {
    runId,
    decision: explanation.decision.trim(),
    why: explanation.why.trim(),
    domainConvention: explanation.domainConvention.trim(),
    ...(Array.isArray(explanation.forkOptions) ? { forkOptions: explanation.forkOptions } : {}),
  };
  const insert = db.transaction(() => {
    if (targetTask) {
      db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
        .run(targetTask, seqRow.s, 'coaching.decision_explanation', JSON.stringify(payload), now);
    }
    db.prepare('UPDATE do_coaching_runs SET decision_count = decision_count + 1, updated_at = ? WHERE run_id = ?')
      .run(now, runId);
  });
  insert();
  return { ok: true, seq: seqRow.s, decisionCount: run.decision_count + 1 };
}

/**
 * 复盘分歧点（钉③）：结构化五字段数组，自由文本拒绝；append-only 落画像表。
 * divergences: [{ decision, userChoice, domainConvention, costOfDeviation, sourceRef }]
 */
function validateDivergences(divergences) {
  if (!Array.isArray(divergences) || divergences.length === 0) {
    return fail('分歧点必须是非空数组（结构化，非自由文本）');
  }
  for (const [index, item] of divergences.entries()) {
    if (!item || typeof item !== 'object') return fail(`分歧点 #${index} 非对象`);
    const str = (value) => (typeof value === 'string' ? value.trim() : '');
    const decision = str(item.decision);
    const userChoice = str(item.userChoice);
    const domainConvention = str(item.domainConvention);
    const costOfDeviation = str(item.costOfDeviation);
    const sourceRef = str(item.sourceRef);
    if (!decision || !userChoice || !domainConvention || !costOfDeviation || !sourceRef) {
      return fail(`分歧点 #${index} 缺结构化字段（decision/userChoice/domainConvention/costOfDeviation/sourceRef 必填，自由文本拒绝）`);
    }
    for (const value of [decision, userChoice, domainConvention, costOfDeviation, sourceRef]) {
      if (value.length > 1000) return fail('分歧点字段超限（≤1000 字符）');
    }
  }
  return { ok: true };
}

/** 复盘落画像（append-only）。divergences 结构化校验通过才入库。 */
function recordReview(db, { runId, userId, divergences }) {
  const check = validateDivergences(divergences);
  if (!check.ok) return check;
  const run = db.prepare('SELECT * FROM do_coaching_runs WHERE run_id = ?').get(runId);
  if (!run) return fail(`教练 run 不存在：${runId}`);
  if (!PILOT_DOMAINS.includes(run.domain)) return fail(`域 ${run.domain} 不在试点白名单`);
  const profileId = newId('doprofile');
  const now = nowIso();
  db.prepare(`INSERT INTO do_competence_profiles (
    profile_id, contract_version, user_id, domain, run_id, divergences_json, created_at
  ) VALUES (?,?,?,?,?,?,?)`).run(
    profileId, DO_COACHING_CONTRACT_VERSION, userId || run.user_id, run.domain, runId,
    JSON.stringify(divergences), now,
  );
  return { ok: true, profileId, divergenceCount: divergences.length };
}

/** 画像读取（复盘 diff 的历史清单，结构化返回）。 */
function listDivergences(db, { userId, domain }) {
  const rows = db.prepare(
    'SELECT * FROM do_competence_profiles WHERE user_id = ? AND domain = ? ORDER BY created_at DESC',
  ).all(userId, domain);
  return rows.map((row) => ({
    profileId: row.profile_id,
    runId: row.run_id,
    divergences: JSON.parse(row.divergences_json),
    createdAt: row.created_at,
  }));
}

/** 品味样本入库（幂等按 sample_id；bio 试点域白名单）。 */
function insertTasteSample(db, sample) {
  if (!PILOT_DOMAINS.includes(sample.domain)) return fail(`域 ${sample.domain} 不在试点白名单`);
  const dimension = typeof sample.dimension === 'string' ? sample.dimension.trim() : '';
  const good = typeof sample.good === 'string' ? sample.good.trim() : '';
  const bad = typeof sample.bad === 'string' ? sample.bad.trim() : '';
  const rationale = typeof sample.rationale === 'string' ? sample.rationale.trim() : '';
  if (!dimension || !good || !bad || !rationale) return fail('品味样本缺 dimension/good/bad/rationale');
  const sampleId = sample.sampleId || newId('dosample');
  const existing = db.prepare('SELECT sample_id FROM do_sample_libraries WHERE sample_id = ?').get(sampleId);
  if (existing) return { ok: true, sampleId, existed: true };
  db.prepare(`INSERT INTO do_sample_libraries (
    sample_id, contract_version, domain, dimension, good_json, bad_json, rationale, source_ref, version, status, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    sampleId, DO_COACHING_CONTRACT_VERSION, sample.domain, sample.dimension,
    sample.good, sample.bad, sample.rationale, sample.sourceRef || null,
    sample.version || 1, sample.status || 'candidate', nowIso(),
  );
  return { ok: true, sampleId };
}

/**
 * 反馈对照（钉④）：产物观察 vs 品味样本判例，逐维度结构化输出。
 * artifactObservations: [{ dimension, observation }]——观察是结构化事实（非自由评论）；
 * 对照只呈现「样本期待 vs 产物观察」事实，matches 由观察与期待的结构化判据比对给出，
 * 终审归人（方案 §4：agent 预评不下好/坏终判）。
 */
function compareAgainstSamples(db, { domain, artifactObservations }) {
  if (!Array.isArray(artifactObservations) || artifactObservations.length === 0) {
    return fail('产物观察必须是非空数组（逐维度结构化）');
  }
  for (const [index, obs] of artifactObservations.entries()) {
    if (!obs || typeof obs.dimension !== 'string' || typeof obs.observation !== 'string' || !obs.observation.trim()) {
      return fail(`产物观察 #${index} 缺 dimension/observation（结构化）`);
    }
  }
  const samples = db.prepare('SELECT * FROM do_sample_libraries WHERE domain = ? ORDER BY dimension').all(domain);
  const comparisons = [];
  for (const obs of artifactObservations) {
    const sample = samples.find((s) => s.dimension === obs.dimension);
    if (!sample) {
      comparisons.push({ dimension: obs.dimension, status: 'no_sample', observation: obs.observation, sample: null, matches: null });
      continue;
    }
    const expectationKeys = (() => {
      try { return JSON.parse(sample.good_json); } catch { return { expectation: sample.good_json }; }
    })();
    const matches = typeof obs.matches === 'boolean' ? obs.matches : null;
    comparisons.push({
      dimension: obs.dimension,
      status: 'compared',
      observation: obs.observation,
      sample: { good: expectationKeys, bad: sample.bad_json, rationale: sample.rationale, sourceRef: sample.source_ref, status: sample.status },
      matches,
    });
  }
  return { ok: true, comparisons, sampleCount: samples.length };
}

/**
 * 87 第一阶段 bio 品味样本草稿（resources/.../taste-samples.md）→ 结构化入库。
 * md 形状为本包自定（## 样本 N · 标题 / **维度**：/**坏判例**：/**好判例**：
 * /**为什么（对照事实）**：/ 来源: id / 状态: 候选）。解析 fail-closed：
 * 字段缺失即抛错（草稿结构漂移必须显式暴露）。
 */
function parseBioTasteSamplesMarkdown(markdown) {
  const sections = String(markdown).split(/^## /m).slice(1);
  const samples = [];
  for (const section of sections) {
    if (!section.includes('样本')) continue;
    const grab = (label) => {
      const match = section.match(new RegExp(`\\*\\*${label}\\*\\*：([\\s\\S]*?)(?=\\n\\*\\*|\\n来源:|\\n状态:)`));
      if (!match || !match[1].trim()) throw new Error(`品味样本段缺 **${label}**：字段`);
      return match[1].trim();
    };
    const sourceMatch = section.match(/^来源:\s*(\S+)\s*$/m);
    const statusMatch = section.match(/^状态:\s*(\S+)\s*$/m);
    if (!sourceMatch) throw new Error('品味样本段缺 来源: 行（引用纪律钉）');
    const title = section.split('\n')[0].trim();
    samples.push({
      dimension: grab('维度'),
      good: JSON.stringify({ 判例: grab('好判例') }),
      bad: JSON.stringify({ 判例: grab('坏判例') }),
      rationale: grab('为什么（对照事实）'),
      sourceRef: sourceMatch[1],
      status: statusMatch ? statusMatch[1] : 'candidate',
      title,
    });
  }
  if (samples.length === 0) throw new Error('md 中未解析到品味样本段');
  return samples;
}

function seedBioTasteSamplesFromMarkdown(db, markdown, { domain = 'bioinformatics', sampleIdPrefix = 'dosample_bio' } = {}) {
  const parsed = parseBioTasteSamplesMarkdown(markdown);
  const results = [];
  parsed.forEach((sample, index) => {
    const result = insertTasteSample(db, { ...sample, sampleId: `${sampleIdPrefix}_s${index + 1}`, domain });
    if (!result.ok) throw new Error(`样本 ${index + 1} 入库失败：${result.error}`);
    results.push(result);
  });
  return { ok: true, seeded: results.filter((r) => !r.existed).length, total: results.length };
}

module.exports = {
  PILOT_DOMAINS,
  parseBioTasteSamplesMarkdown,
  seedBioTasteSamplesFromMarkdown,
  COACHING_PHASES,
  computeHandoverPhase,
  validateDecisionExplanation,
  validateDivergences,
  createCoachingRun,
  recordDecisionExplanation,
  recordReview,
  listDivergences,
  insertTasteSample,
  compareAgainstSamples,
};
