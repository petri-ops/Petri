/**
 * agent-tools/learning.js — Learning and reporting tools
 * (generate_methods, suggest_next_steps,
 *  verify_understanding, suggest_review, record_learning_signal)
 */
const dbMod = require('../db');
const { withSessionExecutionTarget } = require('../helpers/remote-execution/session-target');
const { runTaskConfirmationHooks } = require('../../shared-backend/task-confirmation-hooks');
const { createResultStudioRepository } = require('../../shared-backend/result-studio-repository');
const { ensureChainRevisions } = require('../../shared-backend/result-changeset-service');
const sqlite = dbMod.getDatabase();
// SUGGEST_NEXT_STEPS_BRIDGE_v1 marker

// GENERATE_METHODS_v1 — academic Methods paragraph generator
async function tool_generate_methods(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) throw new Error('未授权');
  const gather = ctx && ctx.gatherAnalysisContextForMethods;
  const render = ctx && ctx.renderMethodsParagraph;
  if (!gather || !render)
    return { error: 'helpers_missing', message: 'GENERATE_METHODS_v1 helpers not wired' };
  if (!args.analysisId && !args.planId && !args.datasetId) {
    return { error: 'missing_target', message: '需要 analysisId / planId / datasetId 之一' };
  }
  const data = gather(userId, {
    analysisId: args.analysisId,
    planId: args.planId,
    datasetId: args.datasetId,
  });
  if (!data) return { error: 'not_found', message: '未找到对应数据或无权访问' };
  if (!data.analyses || data.analyses.length === 0) {
    return { error: 'no_analyses', message: '目标范围内没有 done 状态的分析，无法生成 Methods' };
  }
  data._userId = userId;
  data._conversationId = ctx && ctx.conversationId;
  const r = await render(data, { language: args.language || 'zh' });
  if (r.error) return r;
  return {
    ok: true,
    methods: r.methods,
    language: r.language,
    sources: {
      analyses: data.analyses.length,
      datasets: data.datasets.length,
      plans: data.plans.length,
    },
  };
}

// SUGGEST_NEXT_STEPS_v1 — recommend 3-5 next-step resources for user
async function tool_suggest_next_steps(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) return { error: 'unauthorized' };

  const idx = ctx.docsIndex || {};
  const docs = Array.isArray(idx.docs) ? idx.docs : [];
  const figcode = Array.isArray(idx.figcode) ? idx.figcode : [];
  const acts = Array.isArray(idx.acts) ? idx.acts : [];
  const all = [
    ...docs.map((d) => ({ kind: 'doc', ...d })),
    ...figcode.map((f) => ({ kind: 'figcode', ...f, url: f.url || '/figcode#' + f.id })),
    ...acts.map((a) => ({ kind: 'act', ...a, url: 'act://' + a.id })),
  ];

  // Read user's progress from SQLite
  const db = sqlite;
  let progressRows = [];
  try {
    progressRows = db
      .prepare(
        'SELECT resource, type, status, updated_at FROM user_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500'
      )
      .all(userId);
  } catch {
    progressRows = [];
  }
  const progressByResource = new Map();
  for (const row of progressRows) progressByResource.set(row.resource, row);

  // Topic hint: explicit > most-recent progress's domain > most-completed domain > basics
  const topicArg = args && typeof args.topic === 'string' ? args.topic.toLowerCase().trim() : null;
  let topicHint = null;
  if (topicArg) topicHint = topicArg;
  else if (progressRows.length > 0) {
    // Find latest doc/figcode whose copilot.domain we know
    for (const row of progressRows) {
      const r = all.find((x) => x.url === row.resource);
      if (r && r.copilot && r.copilot.domain) {
        topicHint = r.copilot.domain;
        break;
      }
    }
  }

  // Score each candidate
  const limit = Math.max(1, Math.min(6, (args && args.limit) || 4));
  const scored = [];
  const completedSet = new Set(
    progressRows.filter((r) => r.status === 'completed').map((r) => r.resource)
  );
  const startedSet = new Set(
    progressRows.filter((r) => r.status === 'started').map((r) => r.resource)
  );

  // SUGGEST_NEXT_STEPS_BRIDGE_v1 — compute domain saturation
  const domainTotals = {};
  const domainCompleted = {};
  for (const item of all) {
    const d = item.copilot && item.copilot.domain;
    if (!d) continue;
    domainTotals[d] = (domainTotals[d] || 0) + 1;
    if (item.url && completedSet.has(item.url)) {
      domainCompleted[d] = (domainCompleted[d] || 0) + 1;
    }
  }
  const saturatedDomains = new Set();
  for (const d of Object.keys(domainTotals)) {
    const total = domainTotals[d];
    const done = domainCompleted[d] || 0;
    if (total >= 4 && done / total >= 0.7) saturatedDomains.add(d);
  }

  for (const item of all) {
    if (!item.url) continue;
    if (completedSet.has(item.url)) continue; // already done — never re-recommend
    const meta = item.copilot || {};
    let score = 0;
    const reasons = [];

    // Started but not completed → strongly recommend continuing
    if (startedSet.has(item.url)) {
      score += 60;
      reasons.push('上次没看完');
    }

    // Topic match
    if (topicHint && meta.domain === topicHint) {
      score += 30;
      reasons.push('与当前学习领域一致');
    }

    // Prerequisites — boost when all are completed; penalize when missing
    const prereqs = Array.isArray(meta.prerequisites) ? meta.prerequisites : [];
    if (prereqs.length > 0) {
      const completedCount = prereqs.filter((p) => completedSet.has(p)).length;
      const ratio = completedCount / prereqs.length;
      if (ratio === 1) {
        score += 25;
        reasons.push('前置已学完');
      } else if (ratio === 0) {
        score -= 15;
      } else {
        score += 5;
      }
    } else {
      // No prereqs declared → considered safe entry, mild bonus
      score += 5;
    }

    // Level pacing — beginners first if user has no progress yet
    if (progressRows.length === 0) {
      if (meta.level === 'beginner') {
        score += 15;
        reasons.push('适合刚入门');
      } else if (meta.level === 'advanced') {
        score -= 10;
      }
    } else {
      // Returning user: avoid pushing beginner content unless directly next
      if (meta.level === 'beginner' && completedSet.size >= 5) score -= 5;
    }

    // Estimated time — short tasks score slightly higher (tie-breaker)
    const minutes = Number(meta.estimated_minutes) || 0;
    if (minutes > 0 && minutes <= 15) score += 3;
    else if (minutes > 60) score -= 3;

    // Has metadata at all is a tiny bonus — items without copilot.* are less reliable to recommend
    if (Object.keys(meta).length > 0) score += 2;

    // hands_on items score higher when the user has > 3 doc completions
    const docCompleted = progressRows.filter(
      (r) => r.type === 'doc' && r.status === 'completed'
    ).length;
    if (meta.hands_on === true && docCompleted >= 3) {
      score += 8;
      reasons.push('该动手了');
    }

    // SUGGEST_NEXT_STEPS_BRIDGE_v1 — cross-domain bridge boost
    if (prereqs.length >= 2) {
      const prereqDomains = new Set();
      for (const p of prereqs) {
        if (!completedSet.has(p)) continue;
        const r = all.find((x) => x.url === p);
        const d = r && r.copilot && r.copilot.domain;
        if (d) prereqDomains.add(d);
      }
      if (prereqDomains.size >= 2) {
        score += 25;
        reasons.push('跨领域：前置已跨组学学完');
      }
    }
    // Domain-saturation nudge — if user has saturated their dominant domain,
    // gently prefer other domains to encourage breadth.
    if (saturatedDomains.size > 0 && meta.domain && !saturatedDomains.has(meta.domain)) {
      score += 5;
    }

    if (score <= 0) continue;
    scored.push({
      kind: item.kind,
      url: item.url,
      title: item.title || item.subtitle || item.id,
      domain: meta.domain || null,
      level: meta.level || null,
      estimated_minutes: meta.estimated_minutes || null,
      hands_on: meta.hands_on === true,
      score,
      reasons,
    });
  }

  scored.sort(
    (a, b) => b.score - a.score || (a.estimated_minutes || 999) - (b.estimated_minutes || 999)
  );
  // Diversify: don't return more than 2 from the same domain
  const picked = [];
  const domainCounts = {};
  for (const c of scored) {
    const d = c.domain || '_unknown';
    if ((domainCounts[d] || 0) >= 2 && picked.length >= 2) continue;
    picked.push(c);
    domainCounts[d] = (domainCounts[d] || 0) + 1;
    if (picked.length >= limit) break;
  }

  return {
    suggestions: picked.map((p) => ({
      kind: p.kind,
      url: p.url,
      title: p.title,
      domain: p.domain,
      level: p.level,
      estimated_minutes: p.estimated_minutes,
      hands_on: p.hands_on,
      reasons: p.reasons,
    })),
    user_state: {
      progress_count: progressRows.length,
      completed_count: completedSet.size,
      topic_hint: topicHint,
    },
    note:
      picked.length === 0
        ? '当前 copilot-index 里没有足够 metadata 可推荐。请先让运营给资产填好 copilot.* 字段。'
        : null,
  };
}

// VERIFY_UNDERSTANDING_v1 — generate 1-3 questions from learning_outcomes
async function tool_verify_understanding(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) return { error: 'unauthorized' };

  const docUrl = args && typeof args.docUrl === 'string' ? args.docUrl.trim() : '';
  if (!docUrl) return { error: 'missing_docUrl' };
  const count = Math.max(1, Math.min(3, (args && args.count) || 2));

  const idx = ctx.docsIndex || {};
  const doc = (idx.docs || []).find((d) => d.url === docUrl);
  if (!doc) {
    return {
      error: 'doc_not_found',
      message: '在索引里找不到 ' + docUrl + '，确认 url 写对（不要带末尾 /）。',
    };
  }
  const meta = doc.copilot || {};
  const outcomes = Array.isArray(meta.learning_outcomes) ? meta.learning_outcomes.slice(0, 5) : [];

  if (outcomes.length === 0) {
    return {
      questions: [],
      doc: { url: doc.url, title: doc.title },
      note: '该 doc 还没填 copilot.learning_outcomes，无法生成针对性的理解题。请回答：你刚学完的内容里，你能用一段话说清楚最关键的概念是什么吗？',
    };
  }

  // Try LLM-driven question generation first
  const llmQuestions = await _generateQuestionsViaLLM(doc, outcomes, count).catch(() => null);
  let questions = llmQuestions && llmQuestions.length > 0 ? llmQuestions : null;

  // Fallback: outcome-based deterministic questions
  if (!questions) {
    questions = _outcomesToQuestions(outcomes, count);
  }

  return {
    questions: questions.slice(0, count).map((q, i) => ({
      n: i + 1,
      question: q.question || q,
      hint: q.hint || null,
      addresses_outcome: q.outcome || outcomes[i] || null,
    })),
    doc: {
      url: doc.url,
      title: doc.title,
      learning_outcomes: outcomes,
    },
    instruction:
      '逐道把题目发给用户，等他回答后给简短反馈（对/不对 + 一句修正/扩展）。' +
      '所有题答完后给一句总结：哪几条 outcome 看起来稳了，哪条还需补一下。',
  };
}

/** Convert learning_outcomes into question wordings deterministically. */
function _outcomesToQuestions(outcomes, count) {
  const out = [];
  for (let i = 0; i < Math.min(outcomes.length, count); i++) {
    const o = outcomes[i];
    // Heuristic — strip leading verbs that don't translate well into a question
    const cleaned = o.replace(
      /^[\s\u4e00-\u9fff]{0,4}(理解|知道|会|能|掌握|区分|看懂|学会|跑通|完成|用|写出)\s*/g,
      ''
    );
    const q = '请用你自己的话讲一遍：' + cleaned + '。';
    out.push({ question: q, outcome: o });
  }
  return out;
}

/** Optional explanation-role question generation. Best-effort. */
async function _generateQuestionsViaLLM(doc, outcomes, count) {
  const sys =
    '你是一位生信教学助手。基于一篇 docs 的标题、摘要和学习产出（learning_outcomes），生成 ' +
    count +
    ' 道用来验证学生是否掌握的简短问题。' +
    '每个问题必须明确针对一条 learning_outcome（在 outcome 字段填出对应原文），' +
    '问题语言为中文，避免选择题，鼓励让学生用自己的话回答。' +
    '严格输出 JSON：{"questions":[{"question":"...","outcome":"...","hint":"..."}]}';

  const user =
    '篇目：' +
    (doc.title || '(无标题)') +
    '\n' +
    '摘要：' +
    (doc.summary || '').slice(0, 500) +
    '\n' +
    'learning_outcomes:\n' +
    outcomes.map((o, i) => i + 1 + '. ' + o).join('\n');

  const { callModelTask, parseJsonText } = require('../helpers/model-tasks');
  const result = await callModelTask({
    role: 'explanation',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.4,
    maxTokens: 600,
    responseFormat: { type: 'json_object' },
    telemetry: { kind: 'learning_questions' },
  });
  const parsed = parseJsonText(result.text);
  const questions = parsed && Array.isArray(parsed.questions) ? parsed.questions : [];
  const filtered = questions.filter(
    (question) => question && typeof question.question === 'string' && question.question.length > 4
  );
  return filtered.length > 0 ? filtered : null;
}

// LEARNING_MEMORY_v1 — suggest_review now reads review_queue first
async function tool_suggest_review(args, ctx) {
  // Queue-first: any non-retired weak/moderate items override age-based picks.
  const userId = ctx && ctx.userId;
  if (userId) {
    const db = sqlite;
    let queueRows = [];
    try {
      queueRows = db
        .prepare(
          `
        SELECT resource, concept, signal, note, updated_at
        FROM review_queue
        WHERE user_id = ? AND retired_at IS NULL
        ORDER BY CASE signal WHEN 'weak' THEN 0 WHEN 'moderate' THEN 1 ELSE 2 END,
                 updated_at ASC
      `
        )
        .all(userId);
    } catch {}
    if (queueRows && queueRows.length > 0) {
      const docs = (ctx.docsIndex && ctx.docsIndex.docs) || [];
      const docByUrl = new Map(docs.map((d) => [d.url, d]));
      // Group by resource so we don't repeat the same doc multiple times.
      const seenRes = new Set();
      const queueCandidates = [];
      for (const r of queueRows) {
        if (seenRes.has(r.resource)) continue;
        seenRes.add(r.resource);
        const doc = docByUrl.get(r.resource);
        const meta = doc ? doc.copilot || {} : {};
        queueCandidates.push({
          source: 'queue',
          url: r.resource,
          title: (doc && doc.title) || r.resource,
          domain: meta.domain || null,
          level: meta.level || null,
          estimated_minutes: meta.estimated_minutes || null,
          weak_concepts: queueRows
            .filter((x) => x.resource === r.resource)
            .map((x) => ({
              concept: x.concept,
              signal: x.signal,
              note: x.note,
            })),
        });
      }
      const limit = Math.max(1, Math.min(5, (args && args.limit) || 3));
      if (queueCandidates.length > 0) {
        return {
          candidates: queueCandidates.slice(0, limit),
          source: 'queue',
          instruction:
            '该用户在 verify_understanding 答题时表现较弱的概念优先复习。' +
            '挑 1 条 candidates，针对 weak_concepts 里挑 1-2 个概念，让他用自己话讲一遍。' +
            '答到位就 record_learning_signal({resource, concept, signal:"strong"}) 让该条退出队列。',
        };
      }
    }
  }
  // Fallback: original age-based picks
  return await _tool_suggest_review_age(args, ctx);
}

// SUGGEST_REVIEW_v1 — find completed docs that are due for review (age-based fallback)
async function _tool_suggest_review_age(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) return { error: 'unauthorized' };

  const daysThreshold = Math.max(1, Math.min(180, (args && args.days_threshold) || 7));
  const limit = Math.max(1, Math.min(5, (args && args.limit) || 3));

  const idx = ctx.docsIndex || {};
  const docs = Array.isArray(idx.docs) ? idx.docs : [];
  const docByUrl = new Map();
  for (const d of docs) docByUrl.set(d.url, d);

  const db = sqlite;
  const cutoff = new Date(Date.now() - daysThreshold * 86400000).toISOString();

  let rows;
  try {
    rows = db
      .prepare(
        `
      SELECT resource, type, completed_at, updated_at
      FROM user_progress
      WHERE user_id = ?
        AND status = 'completed'
        AND type = 'doc'
        AND completed_at IS NOT NULL
        AND completed_at <= ?
      ORDER BY completed_at ASC
    `
      )
      .all(userId, cutoff);
  } catch (e) {
    return { error: 'db_error', message: e.message };
  }

  if (!rows || rows.length === 0) {
    return {
      candidates: [],
      threshold_days: daysThreshold,
      note:
        '当前没有 ' +
        daysThreshold +
        ' 天前已完成、可以复习的 doc。' +
        '如果用户在问"该学什么"，请改用 suggest_next_steps 推荐新内容。',
    };
  }

  const now = Date.now();
  const candidates = [];
  for (const r of rows) {
    const doc = docByUrl.get(r.resource);
    if (!doc) continue; // skip if doc disappeared from index
    const meta = doc.copilot || {};
    const outcomes = Array.isArray(meta.learning_outcomes) ? meta.learning_outcomes : [];
    const completedTs = Date.parse(r.completed_at) || now;
    const ageDays = Math.max(0, Math.round((now - completedTs) / 86400000));
    candidates.push({
      url: doc.url,
      title: doc.title,
      domain: meta.domain || null,
      level: meta.level || null,
      estimated_minutes: meta.estimated_minutes || null,
      learning_outcomes: outcomes.slice(0, 4),
      completed_at: r.completed_at,
      age_days: ageDays,
      // Score: older + more outcomes (richer review material) wins
      _score: ageDays + Math.min(outcomes.length, 5) * 3,
    });
  }

  if (candidates.length === 0) {
    return {
      candidates: [],
      threshold_days: daysThreshold,
      note:
        '虽有 ' +
        rows.length +
        ' 条历史完成记录，但对应 doc 缺少元数据，无法生成有意义的复习建议。',
    };
  }

  candidates.sort((a, b) => b._score - a._score);
  const picked = candidates.slice(0, limit).map((c) => {
    const { _score, ...rest } = c;
    return rest;
  });

  return {
    candidates: picked,
    threshold_days: daysThreshold,
    instruction:
      '把 1-2 条候选讲给用户听（"上次你学了 X，已经过去 N 天了"），' +
      '问他要不要花几分钟再过一遍。如果他答 yes，' +
      '可以从该 doc 的 learning_outcomes 里挑 1 条，让用户尝试用自己的话回答；' +
      '如果他答 no，记下不强推。',
  };
}

// LEARNING_MEMORY_v1 — record_learning_signal
const _LEARNING_SIGNALS = new Set(['weak', 'moderate', 'strong']);

function _ensureReviewQueueTable() {
  const db = sqlite;
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_queue (
      user_id     TEXT NOT NULL,
      resource    TEXT NOT NULL,
      concept     TEXT NOT NULL,
      signal      TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      retired_at  TEXT,
      PRIMARY KEY (user_id, resource, concept)
    );
    CREATE INDEX IF NOT EXISTS idx_review_user_signal
      ON review_queue(user_id, signal, retired_at, updated_at DESC);
  `);
}
_ensureReviewQueueTable();

async function tool_record_learning_signal(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) return { error: 'unauthorized' };
  const resource = args && typeof args.resource === 'string' ? args.resource.trim() : '';
  const concept = args && typeof args.concept === 'string' ? args.concept.trim().slice(0, 80) : '';
  const signal = args && typeof args.signal === 'string' ? args.signal.trim().toLowerCase() : '';
  const note = args && typeof args.note === 'string' ? args.note.trim().slice(0, 240) : null;

  if (!resource || !/^(\/docs\/|\/figcode#|act:\/\/)/.test(resource)) {
    return { error: 'invalid_resource' };
  }
  if (!concept) return { error: 'missing_concept' };
  if (!_LEARNING_SIGNALS.has(signal)) return { error: 'invalid_signal' };

  const db = sqlite;
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM review_queue WHERE user_id=? AND resource=? AND concept=?')
    .get(userId, resource, concept);

  if (existing) {
    // strong overrides any weaker prior signal & retires the row
    const retiredAt = signal === 'strong' ? now : null;
    db.prepare(
      `UPDATE review_queue SET signal=?, note=?, updated_at=?, retired_at=?
                WHERE user_id=? AND resource=? AND concept=?`
    ).run(signal, note, now, retiredAt, userId, resource, concept);
  } else {
    const retiredAt = signal === 'strong' ? now : null;
    db.prepare(
      `INSERT INTO review_queue
        (user_id, resource, concept, signal, note, created_at, updated_at, retired_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(userId, resource, concept, signal, note, now, now, retiredAt);
  }

  const row = db
    .prepare('SELECT * FROM review_queue WHERE user_id=? AND resource=? AND concept=?')
    .get(userId, resource, concept);
  return { ok: true, signal: row.signal, retired: !!row.retired_at };
}

// VERIFY_STATE_v1 marker
// OPEN_FIGCODE_PLOT_v1 marker
// SCRNA_DATA_ACT_v1 marker
// SCRNA_UI_ACT_v1 marker
// FIGCODE_ACT_v1 marker
// RUN_TOOL_v1 — 执行 BioF3 分析工具（复用 biof3-server/mcp/registry）
// 让平台 AI Copilot 能真实跑 R/Python 分析出图，不只是前端交互。
// 断点2（A1）：从 desktop-app/src/mcp-tool-registry 下沉到 biof3-server/mcp/registry，
// 斩断 biof3-server → desktop-app 的反向引用。
// 懒加载 registry（避免模块加载副作用 + 路径找不到时 graceful）。
let _registry = null;
function _getRegistry() {
  if (_registry) return _registry;
  const path = require('path');
  // biof3-server/agent-tools/ → biof3-server/mcp/registry（同 biof3-server 内，循环斩断）
  const registryPath = path.resolve(__dirname, '..', 'mcp', 'registry');
  _registry = require(registryPath);
  return _registry;
}

// TOOL_JOB_APPROVAL_v1（阶段2 Task3）：重操作白名单 + 确认超时。
// 命中白名单的 toolId，run_tool 跑前先落 tool_jobs 待批准，前端确认卡 ack 后才续跑。
// 白名单标准：多步骤全流程 / 耗时较长 / 不可轻易重跑的工具。单图小工具（volcano-plot 等）不进。
// BLOCK-150 ⑤ 死链清理：BLOCK-83 P4 生信包迁出核心后，ml-feature-select /
// ml-classifier / rsf-survival / lasso-cox / consensus-cluster / ml-scvi-annotate /
// mo-mofa / mo-snf / maftools-mutation 九个 id 已无载体（不在 gewu-pack-bio
// manifest），且 unknown_tool 检查先于 heavy 门（下方注册表校验在前）——死成员
// 不可达，纯误导性条目，删除。守卫=test/agent-approval.test.mjs 死链锚（成员
// 必须存在于 pack manifest ∪ 中性夹具 manifest）。
const HEAVY_TOOLS = new Set([
  // BLOCK-83 P4：中性夹具插件也走 heavy 确认门（核心机制测试的载体）。
  'sample-metrics',
  'deseq2',
  'wgcna',
  'seurat-standard',
  'cellchat',
]);
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟内未确认自动取消

function shouldAutoExecuteLocalAnalysis(ctx) {
  return Boolean(ctx && ctx.accessMode === 'full' && ctx.allowExecution !== false);
}

function runToolExecutor(ctx) {
  return ctx && typeof ctx.executeRunTool === 'function'
    ? ctx.executeRunTool
    : _executeRunTool;
}

function trustedConversationId(ctx) {
  return ctx && typeof ctx.conversationId === 'string' && ctx.conversationId.trim()
    ? ctx.conversationId.trim()
    : null;
}

function trustedProjectId(ctx) {
  return ctx && typeof ctx.projectId === 'string' && ctx.projectId.trim()
    ? ctx.projectId.trim()
    : null;
}

function toolJobMatchesTrustedContext(job, ctx, userId) {
  if (!job || job.user_id !== userId) return false;
  const jobProjectId = job.project_id || job.projectId || null;
  const jobConversationId = job.conversation_id || job.conversationId || null;
  return jobProjectId === trustedProjectId(ctx)
    && jobConversationId === trustedConversationId(ctx);
}

function sanitizeWorkflowPlanJobRefs(plan, ctx, userId) {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (!step || !step.toolJobId) return step;
      const job = dbMod.getToolJob(step.toolJobId);
      return toolJobMatchesTrustedContext(job, ctx, userId)
        ? step
        : { ...step, toolJobId: null };
    }),
  };
}

function sameJsonValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
}

// BLOCK-138 §9 方向 1（补刃）：plan 链 run——把 bound 上游的产物引用解析成
// 服务端 lineage（inputId → validateLineage 合同形状），经既有 resultStudioInputLineage
// 选项随执行传入，使下游 job manifest 输入携带 lineage 元数据、权威图可成边
// （attempt-5 实证根因：下游 manifest 输入无 lineage → 三链 0 边）。
// 只认链形成点已注册的 ArtifactRevision（findRevisionByJobArtifact 命中）——
// 未注册即跳过该输入，绝不启发式造边；解析失败回退既有无边状态（fail-closed 附加，
// 不阻断执行）。materializationHash=上游产物 hash：plan 输入值即上游产物文件路径，
// 物化字节=上游产物字节（kind='artifact' 精确交接合同，契约⑤b 钉死）。
function resolvePlanStepInputLineage(plan, stepId, projectId) {
  try {
    const entries = Array.isArray(plan && plan.lineage) ? plan.lineage : [];
    if (entries.length === 0) return null;
    const repository = createResultStudioRepository(dbMod.getDatabase());
    const inputLineage = {};
    for (const entry of entries) {
      if (!entry || entry.toStepId !== stepId) continue;
      const inputId = String(entry.inputId || '').trim();
      const fromToolJobId = String(entry.fromToolJobId || '').trim();
      const artifactId = String(entry.artifactId || '').trim();
      if (!inputId || !fromToolJobId || !artifactId) continue;
      const revision = repository.findRevisionByJobArtifact({
        projectId,
        toolJobId: fromToolJobId,
        artifactId,
      });
      if (!revision || !revision.revisionId || !revision.outputHash) continue;
      inputLineage[inputId] = {
        lineageVersion: 1,
        kind: 'artifact',
        sourceRevisionId: revision.revisionId,
        sourceToolJobId: fromToolJobId,
        sourceArtifactId: artifactId,
        sourceOutputHash: revision.outputHash,
        materializationHash: revision.outputHash,
      };
    }
    return Object.keys(inputLineage).length > 0 ? inputLineage : null;
  } catch {
    return null;
  }
}

async function tool_run_tool(args, ctx) {
  const userId = ctx && ctx.userId;
  if (!userId) throw new Error('未授权');
  const op = args && args.op;
  if (op === 'list') {
    const tools = await _getRegistry().listTools();
    const { listAgentWorkflowTemplates } = require('../../shared-backend/agent-workflow');
    const requestedToolId = args && args.toolId;
    if (requestedToolId) {
      const tool = tools.find((item) => item.name === requestedToolId);
      if (!tool) {
        return {
          ok: false,
          error: 'unknown_tool',
          message: `未知工具: ${requestedToolId}`,
          availableToolIds: tools.map((item) => item.name),
        };
      }
      return {
        ok: true,
        tool: {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          pluginVersion: tool._pluginVersion,
          language: tool._language,
          inputs: tool._inputs || [],
          outputs: tool._outputs || [],
          _isStep: tool._isStep || false,
        },
      };
    }
    return {
      ok: true,
      count: tools.length,
      // Keep the catalog below projection limits so every registered tool ID
      // remains visible. Full schemas are fetched deterministically by passing
      // toolId to op=list; the Agent must never guess an ID.
      tools: tools.map((t) => ({
        name: t.name,
        summary: String(t.description || '').replace(/\s+/g, ' ').trim().slice(0, 96),
        inputIds: Object.keys(t.inputSchema?.properties || {}),
        requiredInputIds: Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [],
        pluginVersion: t._pluginVersion,
        language: t._language,
        _isStep: t._isStep || false,
      })),
      workflowTemplates: listAgentWorkflowTemplates(tools.map((tool) => tool.name)),
    };
  }
  if (op === 'plan') {
    const templateId = args && args.templateId;
    if (!templateId) return { error: 'missing_template_id', message: 'op=plan 需要 templateId' };
    const tools = await _getRegistry().listTools();
    const { createAgentWorkflowPlan } = require('../../shared-backend/agent-workflow');
    try {
      return {
        ok: true,
        plan: createAgentWorkflowPlan({
          templateId,
          availableToolIds: tools.map((tool) => tool.name),
          initialInputs: (args && args.initialInputs) || {},
        }),
      };
    } catch (error) {
      return { ok: false, error: 'workflow_plan_failed', message: error.message };
    }
  }
  if (op === 'bind_artifact') {
    const plan = args && args.workflowPlan;
    const fromToolJobId = args && args.fromToolJobId;
    if (!plan || !fromToolJobId || !args.fromStepId || !args.toStepId || !args.inputId) {
      return {
        ok: false,
        error: 'missing_lineage_binding',
        message: 'bind_artifact 需要 workflowPlan、fromToolJobId、fromStepId、toStepId 和 inputId',
      };
    }
    const job = dbMod.getToolJob(fromToolJobId);
    if (!toolJobMatchesTrustedContext(job, ctx, userId)) {
      return { ok: false, error: 'tool_job_not_found' };
    }
    const result = job.result || {};
    const artifactTruth = result.artifactTruth;
    const artifacts = result.artifacts || result.files || [];
    const artifact = artifacts.find((item) => {
      const identity = item && (item.id || item.name || item.filename);
      return !args.artifactId || identity === args.artifactId;
    });
    if (!artifact) return { ok: false, error: 'artifact_not_found' };
    try {
      const { bindVerifiedArtifact } = require('../../shared-backend/agent-workflow');
      const scopedPlan = sanitizeWorkflowPlanJobRefs(plan, ctx, userId);
      const linkedPlan = {
        ...scopedPlan,
        steps: scopedPlan.steps.map((step) =>
          step.id === args.fromStepId ? { ...step, toolJobId: fromToolJobId } : step
        ),
      };
      const boundPlan = bindVerifiedArtifact(linkedPlan, {
        fromStepId: args.fromStepId,
        toStepId: args.toStepId,
        inputId: args.inputId,
        artifact,
        artifactTruth,
      });
      // BLOCK-138 §9 方向 1（F1）：plan/bind 链形成点——绑定即把来源 job 产物经既有
      // changeset 管线注册为 pending ChangeSet+preview revisions（幂等、绝不自动 adopt），
      // 使下游血缘边可解析。注册失败不回退既有 bind 行为（fail-closed 附加，原因如实透出）。
      let chainPreview;
      try {
        const chain = ensureChainRevisions({
          projectId: trustedProjectId(ctx),
          toolJobId: fromToolJobId,
          artifactId: args.artifactId || null,
        }, {
          repository: createResultStudioRepository(dbMod.getDatabase()),
          getToolJob: (id) => dbMod.getToolJob(id),
          getProject: (id) => dbMod.getProject(id),
          listProjectToolJobs: (id) => dbMod.listProjectToolJobsForWorkflow(id),
        });
        chainPreview = {
          ok: chain.ok === true,
          registered: chain.registered === true,
          idempotent: chain.idempotent === true,
          ...(chain.reason ? { reason: chain.reason } : {}),
          ...(chain.changeSetId ? { changeSetId: chain.changeSetId } : {}),
          ...(chain.revision && chain.revision.revisionId ? { revisionId: chain.revision.revisionId } : {}),
        };
      } catch (error) {
        chainPreview = { ok: false, registered: false, reason: (error && error.code) || 'chain_preview_failed' };
      }
      return {
        ok: true,
        chainPreview,
        plan: boundPlan,
      };
    } catch (error) {
      return { ok: false, error: 'artifact_binding_failed', message: error.message };
    }
  }
  if (op === 'run') {
    let toolId = args && args.toolId;
    let params = (args && args.params) || {};
    // 补刃：plan 链步骤的上游输入 lineage（resolvePlanStepInputLineage 解析，
    // 非 plan 链恒 null → 四执行点回退既有 ctx 透传行为）。
    let planStepInputLineage = null;
    if (args && args.workflowPlan && args.stepId) {
      const { projectWorkflowPlan, runToolJobs } = require('../../shared-backend/agent-workflow');
      const scopedPlan = sanitizeWorkflowPlanJobRefs(args.workflowPlan, ctx, userId);
      const jobs = runToolJobs(scopedPlan, (id) => {
        const job = dbMod.getToolJob(id);
        return toolJobMatchesTrustedContext(job, ctx, userId) ? job : null;
      });
      const projected = projectWorkflowPlan(scopedPlan, jobs);
      const step = projected.steps.find((item) => item.id === args.stepId);
      if (!step) return { ok: false, error: 'workflow_step_not_found' };
      if (!projected.readyStepIds.includes(step.id) || step.status !== 'ready') {
        return { ok: false, error: 'workflow_step_not_ready', stepId: step.id, status: step.status };
      }
      toolId = step.toolId;
      params = { ...step.inputs, ...params };
      planStepInputLineage = resolvePlanStepInputLineage(scopedPlan, args.stepId, trustedProjectId(ctx));
    }
    if (!toolId) return { error: 'missing_toolId', message: 'op=run 需要 toolId' };

    // BLOCK-138 §9 方向 1（F1）：plan 链（op='run' + workflowPlan+stepId）步骤执行完成后，
    // 把该步 job 产物经既有 changeset 管线注册为 pending ChangeSet+preview revisions
    // （幂等、绝不自动 adopt），使下游血缘边可解析。注册失败不阻断已完成的执行结果
    // （fail-closed 附加：chainPreview 如实透出原因，系统行为回退为既有无边状态）。
    const isPlanStepRun = Boolean(args && args.workflowPlan && args.stepId);
    const registerChainPreviewAfterRun = (executed) => {
      if (!isPlanStepRun || !executed || executed.ok !== true
          || !executed.toolJobId || executed.needApproval === true) {
        return executed;
      }
      try {
        const chain = ensureChainRevisions({
          projectId: trustedProjectId(ctx),
          toolJobId: executed.toolJobId,
        }, {
          repository: createResultStudioRepository(dbMod.getDatabase()),
          getToolJob: (id) => dbMod.getToolJob(id),
          getProject: (id) => dbMod.getProject(id),
          listProjectToolJobs: (id) => dbMod.listProjectToolJobsForWorkflow(id),
        });
        return {
          ...executed,
          chainPreview: {
            ok: chain.ok === true,
            registered: chain.registered === true,
            idempotent: chain.idempotent === true,
            ...(chain.reason ? { reason: chain.reason } : {}),
            ...(chain.changeSetId ? { changeSetId: chain.changeSetId } : {}),
          },
        };
      } catch (error) {
        return {
          ...executed,
          chainPreview: { ok: false, registered: false, reason: (error && error.code) || 'chain_preview_failed' },
        };
      }
    };

    // An ACK token is a capability for one exact heavy-operation request. It
    // must be checked before target-tool validation or any execution policy so
    // a caller cannot retarget it into a different (including non-heavy) tool.
    let approvalContinuationJob = null;
    if (args && args.ackToken) {
      const scopedJob = dbMod.getToolJobByAckToken(args.ackToken, {
        userId,
        projectId: trustedProjectId(ctx),
        conversationId: trustedConversationId(ctx),
      });
      const persistedToolId = scopedJob && (scopedJob.tool_id || scopedJob.toolId);
      const capabilityMatches = scopedJob
        && HEAVY_TOOLS.has(persistedToolId)
        && persistedToolId === toolId
        && (!scopedJob.ack_expires_at || Number(scopedJob.ack_expires_at) > Date.now())
        && sameJsonValue(scopedJob.params || {}, params);
      if (!capabilityMatches) {
        return { ok: false, error: 'approval_invalid', message: '确认 token 无效或已过期', toolId };
      }
      approvalContinuationJob = scopedJob;
    }

    // 注册表是唯一工具事实源。先拒绝不存在的工具，避免旧步骤 ID 在确认阶段
    // 提前生成永远无法执行的 tool_job。
    const registeredTools = await _getRegistry().listTools();
    const registeredTool = registeredTools.find((tool) => tool.name === toolId);
    if (!registeredTool) {
      return { ok: false, error: 'unknown_tool', message: `未知工具: ${toolId}`, toolId };
    }
    const requiredFileInputs = (registeredTool._inputs || []).filter(
      (input) => input && input.type === 'file' && input.required !== false
    );
    const missingFileInputs = requiredFileInputs
      .map((input) => input.id)
      .filter((id) => {
        const value = params && params[id];
        if (typeof value !== 'string' || !value.trim()) return true;
        try { return !require('fs').statSync(value).isFile(); } catch { return true; }
      });
    if (missingFileInputs.length > 0) {
      return {
        ok: false,
        error: 'missing_required_file_inputs',
        toolId,
        missing: missingFileInputs,
        message: `缺少必需输入文件: ${missingFileInputs.join(', ')}`,
      };
    }

    // HRT-3 scientific task path: a scientificTaskRef is a strict gate, not
    // metadata decoration. It must resolve to a confirmed, same-project,
    // unbound task whose selected tool and final params still match.
    let scientificTask = null;
    if (args.scientificTaskRef) {
      const ref = args.scientificTaskRef;
      scientificTask = dbMod.getScientificTaskSpec(ref.taskId, Number(ref.version || 1));
      // BLOCK-83 D3：执行确认经领域钩子注册表（核心零注册 = 直通）。
      const gate = runTaskConfirmationHooks({ persistedTask: scientificTask, projectId: trustedProjectId(ctx), toolId, params });
      if (!gate.ok) return gate;
      const taskConversationId = scientificTask && (scientificTask.conversation_id || scientificTask.conversationId || null);
      if (taskConversationId !== trustedConversationId(ctx)) {
        return { ok: false, error: 'scientific_task_conversation_mismatch', message: 'ScientificTask 必须在其确认的会话中执行。' };
      }
      const executed = registerChainPreviewAfterRun(await _executeRunTool(toolId, params, userId, null, trustedProjectId(ctx), {
        taskId: ref.taskId,
        version: Number(ref.version || 1),
      }, {
        conversationId: trustedConversationId(ctx),
        resultStudioInputLineage: planStepInputLineage || (ctx && ctx.resultStudioInputLineage) || null,
      }));
      return { ...executed, scientificTaskRef: { taskId: ref.taskId, version: Number(ref.version || 1) } };
    }

    // BLOCK-57 UI-290：会话级执行目标（composer 选择器）统一注入——位于
    // scientific 严格门之后（其 params 必须与已确认任务逐字匹配，不注入）、
    // heavy/非 heavy 执行之前（ack 创建与续跑两侧同 ctx 注入，确定性一致，
    // sameJsonValue 校验不受影响）。未知目标 fail-closed 丢弃（回退本机）。
    params = await withSessionExecutionTarget(params, ctx, async (id) => {
      try {
        return Boolean(await dbMod.getAsyncDatabase().prepare('SELECT id FROM execution_targets WHERE id=?').get(id));
      } catch {
        return false;
      }
    });

    // Full access is an explicit delegation boundary. Local, reproducible
    // scientific computation can run without a second UI confirmation; its
    // ToolResult/Job/Artifact facts remain fully audited. The legacy approval
    // path stays available for callers that do not carry this delegation.
    if (HEAVY_TOOLS.has(toolId)) {
      if (shouldAutoExecuteLocalAnalysis(ctx) && !args.ackToken) {
        const executed = registerChainPreviewAfterRun(await runToolExecutor(ctx)(toolId, params, userId, null, trustedProjectId(ctx), null, {
          conversationId: trustedConversationId(ctx),
          resultStudioInputLineage: planStepInputLineage || (ctx && ctx.resultStudioInputLineage) || null,
        }));
        return {
          ...executed,
          automationDecision: {
            mode: 'full',
            decision: 'auto_execute',
            reason: 'local_reproducible_analysis',
          },
        };
      }
      // 已带 ackToken 且 ackStatus='approved' → 续跑（第二轮调用）
      if (args.ackToken) {
        const job = approvalContinuationJob;
        if (job && job.ack_status === 'approved') {
          return registerChainPreviewAfterRun(await _executeRunTool(toolId, params, userId, args.ackToken, trustedProjectId(ctx), null, {
            conversationId: trustedConversationId(ctx),
            resultStudioInputLineage: planStepInputLineage || (ctx && ctx.resultStudioInputLineage) || null,
          }));
        }
        if (job && job.ack_status === 'rejected') {
          return { ok: false, error: 'user_rejected', message: '用户取消了该重操作', toolId };
        }
        return { ok: false, error: 'approval_invalid', message: '确认 token 无效或已过期', toolId };
      }
      // 首次跑：建 tool_jobs 待批准记录 + 返回 needApproval
      const ackToken = 'ack_' + require('uuid').v4().slice(0, 12);
      const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS;
      const job = dbMod.createToolJob({
        toolId,
        userId,
        projectId: trustedProjectId(ctx),
        conversationId: trustedConversationId(ctx),
        params,
        status: 'pending',
        name: `${toolId} 待确认`,
      });
      if (!job || !job.id) {
        return { ok: false, error: 'tool_job_create_failed', message: '无法建立可审计的工具任务。', toolId };
      }
      dbMod.setToolJobApproval(job.id, ackToken, expiresAt);
      return {
        ok: true,
        needApproval: true,
        ackToken,
        toolJobId: job && job.id,
        toolId,
        params,
        message: `重操作 ${toolId} 需用户确认。请在前端确认卡点"开始"后重调 run_tool(op=run, ackToken=${ackToken})。${Math.round(APPROVAL_TIMEOUT_MS / 1000)} 秒内未确认将自动取消。`,
      };
    }

    // 非重操作：直接跑（原逻辑）
    return registerChainPreviewAfterRun(await _executeRunTool(toolId, params, userId, null, trustedProjectId(ctx), null, {
      conversationId: trustedConversationId(ctx),
      resultStudioInputLineage: planStepInputLineage || (ctx && ctx.resultStudioInputLineage) || null,
    }));
  }
  if (op === 'status') {
    // Phase 6: project workflow plan status from real tool jobs in DB.
    // Does NOT auto-execute anything.
    const plan = args && args.workflowPlan;
    if (!plan) return { ok: false, error: 'missing_workflow_plan', message: 'op=status 需要 workflowPlan' };
    try {
      const { projectWorkflowPlan, runToolJobs } = require('../../shared-backend/agent-workflow');
      const { summarizeWorkflow } = require('../../shared-backend/orchestration-query');
      const scopedPlan = sanitizeWorkflowPlanJobRefs(plan, ctx, userId);
      const jobs = runToolJobs(scopedPlan, (id) => {
        const job = dbMod.getToolJob(id);
        return toolJobMatchesTrustedContext(job, ctx, userId) ? job : null;
      });
      // BLOCK-163 W3 P2（ORC-4）— 恢复投影走编排查询门面（单源）
      const projected = summarizeWorkflow(projectWorkflowPlan, scopedPlan, jobs);
      return {
        ok: true,
        plan: projected,
        stepCount: projected.steps.length,
        completedCount: projected.steps.filter((s) => s.status === 'complete').length,
        terminal: projected.terminal,
        recoverable: projected.recoverable,
        readyStepIds: projected.readyStepIds,
        resumeFromStepId: projected.resumeFromStepId,
        nextActions: projected.nextActions,
        jobs: jobs.map((j) => ({
          id: j.id,
          toolId: j.tool_id,
          status: j.status,
          stepId: j._stepId,
          harnessState: j.harnessState || null,
        })),
      };
    } catch (error) {
      return { ok: false, error: 'status_projection_failed', message: error.message };
    }
  }
  if (op === 'next') {
    // Phase 6: return next runnable steps for the workflow plan.
    // Uses real DB jobs; does NOT auto-execute.
    const plan = args && args.workflowPlan;
    if (!plan) return { ok: false, error: 'missing_workflow_plan', message: 'op=next 需要 workflowPlan' };
    try {
      const { projectWorkflowPlan, runToolJobs } = require('../../shared-backend/agent-workflow');
      const { summarizeWorkflow } = require('../../shared-backend/orchestration-query');
      const scopedPlan = sanitizeWorkflowPlanJobRefs(plan, ctx, userId);
      const jobs = runToolJobs(scopedPlan, (id) => {
        const job = dbMod.getToolJob(id);
        return toolJobMatchesTrustedContext(job, ctx, userId) ? job : null;
      });
      const projected = summarizeWorkflow(projectWorkflowPlan, scopedPlan, jobs);
      const next = projected.readyStepIds
        .filter((stepId) => {
          const step = projected.steps.find((s) => s.id === stepId);
          return step && (step.status === 'waiting_for_dependency' || step.status === 'ready') && step.toolId;
        })
        .map((stepId) => {
          const step = projected.steps.find((s) => s.id === stepId);
          const job = jobs.find((j) => j._stepId === stepId) || null;
          return {
            stepId,
            toolId: step.toolId,
            toolCandidates: step.toolCandidates,
            inputs: step.inputs,
            dependencies: step.dependsOn,
            blockedReason: step.blockedReason,
            harnessState: job ? (job.harnessState || null) : null,
            toolJobId: step.toolJobId,
            status: step.status,
          };
        });
      return {
        ok: true,
        nextSteps: next,
        planStatus: projected.status,
        terminal: projected.terminal,
        recoverable: projected.recoverable,
        resumeFromStepId: projected.resumeFromStepId,
        nextActions: projected.nextActions,
      };
    } catch (error) {
      return { ok: false, error: 'next_steps_failed', message: error.message };
    }
  }
  return { error: 'unknown_op', message: 'op 只能是 list、plan、bind_artifact、run、status 或 next' };
}

// 实际执行 callTool（重操作确认通过后 + 非重操作都走这里）
async function _executeRunTool(toolId, params, userId, ackToken, projectId, scientificTaskRef = null, executionOptions = {}) {
  let scientificJob = null;
  try {
    const conversationId = executionOptions && Object.prototype.hasOwnProperty.call(executionOptions, 'conversationId')
      ? executionOptions.conversationId || null
      : null;
    const approvedJob = ackToken
      ? dbMod.getToolJobByAckToken(ackToken, { userId, projectId: projectId || null, conversationId })
      : null;
    if (scientificTaskRef) {
      scientificJob = dbMod.createToolJob({
        toolId,
        userId,
        params,
        status: 'pending',
        name: `${toolId} scientific task`,
        projectId,
        conversationId,
      });
      dbMod.bindScientificTaskToolJob({ taskId: scientificTaskRef.taskId, version: scientificTaskRef.version, toolJobId: scientificJob.id });
    }
    const result = await _getRegistry().callTool(toolId, params, {
      userId,
      projectId,
      conversationId,
      toolJobId: (scientificJob && scientificJob.id) || (approvedJob && approvedJob.id),
      resultStudioInputLineage: executionOptions && executionOptions.resultStudioInputLineage || null,
    });
    const text = result.content && result.content[0] && result.content[0].text;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 文本保持 null */ }
    if (result.isError) {
      return {
        ok: false,
        error: 'tool_failed',
        message: text,
        toolId,
        ...(parsed && typeof parsed === 'object' ? { result: parsed } : {}),
        ...(result.toolJobId ? { toolJobId: result.toolJobId } : {}),
      };
    }
    // 透传 callTool 返回的 toolJobId（tool_jobs 表的真实 id，tj_xxx），
    // 供 agent 调 read_image / plan(update_step, toolJobId) 使用；结果面板由前端
    // 根据成功的 run_tool 事件确定性打开，不再依赖模型调用页面动作。
    // 注意：toolJobId 是 db.createToolJob 生成的 tj_xxx，不是 summary.jobDir 里的 mcp_xxx。
    return {
      ok: true,
      toolId,
      result: parsed || text,
      ...(result.toolJobId ? { toolJobId: result.toolJobId } : {}),
      ...(ackToken ? { ackToken } : {}),
    };
  } catch (e) {
    if (scientificJob?.id) {
      try { dbMod.updateToolJob(scientificJob.id, { status: 'failed', error: e.message, completedAt: Date.now() }); } catch {}
    }
    return { ok: false, error: 'run_exception', message: e.message, toolId };
  }
}

/**
 * Agent tools — server-side dispatcher for LLM tool calls.
 * Each tool is user-scoped (uses req.user.id implicitly via wrapper).
 */

module.exports = {
  tool_run_tool,
  shouldAutoExecuteLocalAnalysis,
  // BLOCK-150 ⑤ — 治理审计面：死链守卫测试（agent-approval.test.mjs）据其校验
  // 白名单成员真实性；非执行 API，勿在工具链消费。
  HEAVY_TOOLS,
  tool_generate_methods,
  tool_suggest_next_steps,
  tool_verify_understanding,
  tool_suggest_review,
  tool_record_learning_signal,
};
