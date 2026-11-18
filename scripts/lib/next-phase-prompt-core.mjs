/**
 * scripts/lib/next-phase-prompt-core.mjs — BLOCK-470 / T1 纯函数核心。
 *
 * 下一阶段提示词生成器的判据核心：只机械派生「草案骨架 + 继承的 R 项 + 现读盘点 + 七要素模板」，
 * **仅 advice、不自动发令**；新裁决点标 pending_user_ruling，观感零代签，幂等不覆盖。
 * 由 scripts/next-phase-prompt.mjs 调用；纯函数供 HK-01 负测直测。
 */

const R_LINE = /^\s*-\s*(R\d+)\s/;
const VERDICT_SAFE = /pending_human_eye[\s\S]{0,80}verified/;

/**
 * 分类预置裁决 R 项：只继承「已授权且未消耗」，范围消耗完则标 pending_user_ruling。
 * completedPhases 是已完成的阶段号数组（如 ['P2','P3']）。
 */
export function classifyRulings({ previousBody = '', completedPhases = [] } = {}) {
  const lines = String(previousBody).split('\n').filter((l) => R_LINE.test(l));
  const consumed = new Set((completedPhases || []).map((p) => String(p).trim().toUpperCase()));
  const phaseOf = (line) => {
    const m = line.match(/\bP([0-7])\b/);
    return m ? `P${m[1]}` : null;
  };
  const inherited = [];
  for (const line of lines) {
    const phase = phaseOf(line);
    // 若该 R 项锚定到某阶段且该阶段已完成 → 视作已消耗，不继承；否则继承。
    if (phase && consumed.has(phase)) continue;
    inherited.push(line.trim());
  }
  // C-53 全域消耗（P2–P7 全完成）→ 无可继承阶段，标待用户发令。
  const allDone = ['P2', 'P3', 'P4', 'P5', 'P6', 'P7'].every((p) => consumed.has(p));
  if (allDone || inherited.length === 0) {
    return { mode: 'pending_user_ruling', inherited: [], consumed: [...consumed] };
  }
  return { mode: 'inherit', inherited, consumed: [...consumed] };
}

/** 幂等判据：目标草案已存在则不写。 */
export function shouldWriteDraft(targetExists) {
  return !Boolean(targetExists);
}

/**
 * 机械派生下一阶段提示词草案。返回 { ok, reason?, diagnostics[], draft?, inherited[], recommendation? }。
 * 缺关键输入 → external-blocked（不臆造）。
 */
export function deriveNextPhaseDraft(inputs = {}) {
  const diagnostics = [];
  const { date, batch, stateSummary, auditHead, suggestion, previousBody, completedPhases, humanEyeItems } = inputs;

  if (!suggestion || !suggestion.suggestion) {
    diagnostics.push('缺 next:suggest 单一建议（suggestion）——external-blocked，不臆造下一阶段主线');
  }
  if (!previousBody || !String(previousBody).trim()) {
    diagnostics.push('缺上一批提示词 §2 正文（无法继承预置裁决 R 项）——external-blocked');
  }
  if (!stateSummary || !auditHead) {
    diagnostics.push('缺 state/AUDIT-LOG 现读盘点——external-blocked');
  }
  if (diagnostics.length) return { ok: false, reason: 'external-blocked', diagnostics };

  const ruling = classifyRulings({ previousBody, completedPhases });
  const inheritedBlock = ruling.mode === 'inherit'
    ? `（继承上一批未消耗 R 项，仅更新现读数字，不自造新阶段）\n${ruling.inherited.join('\n')}`
    : '（上一批范围已消耗完毕）下一阶段属新裁决点 → pending_user_ruling，列用户动作清单，待用户发令，不写入预置裁决 R 项。';
  const humanEye = (humanEyeItems || []).map((x) => `- ${x}：in_progress（pending_human_eye，待用户实机过目，零代签）`).join('\n');
  const anchorLine = suggestion.confidence === null || suggestion.confidence === undefined
    ? `建议锚=${suggestion.suggestion}（Jev 不可用，按队列首项兜底，如实标注）`
    : `建议锚=${suggestion.suggestion}（Jev confidence=${Number(suggestion.confidence).toFixed(2)}，advice-only）`;

  const draft = [
    `---`,
    `capability: next-phase-prompt-${date}-b${batch}`,
    `status: active`,
    `kind: roadmap`,
    `goal: 下一阶段无人值守提示词草案（机械派生 / advice-only / 未获发令不得开工）`,
    `generatedAt: ${new Date().toISOString()}`,
    `generator: scripts/next-phase-prompt.mjs（BLOCK-470 T1）`,
    `---`,
    ``,
    `# 下一阶段提示词草案（${date} b${batch} · 机械派生）`,
    ``,
    `> 本文件由生成器机械派生，**仅 advice**：自动落档草案，不自动发令。预置裁决只继承，新裁决点 pending_user_ruling。`,
    ``,
    `## 现读盘点`,
    `- ${stateSummary}`,
    `- ${auditHead}`,
    `- ${anchorLine}`,
    ``,
    `## 预置裁决（继承，不自造）`,
    inheritedBlock,
    ``,
    `## 观感边界（零代签，永久 in_progress）`,
    humanEye || '- （本次无登记观感项；如新增 UI 面须追加并留槽）',
    ``,
    `## 草案骨架（七要素，待 agent 按现读蓝图填充）`,
    `1. 核心目标与交付物 · 2. 任务清单与执行顺序 · 3. 自动推进触发与依赖 ·`,
    `4. 每任务完成标准 · 5. 异常降级策略 · 6. 输出格式与进度汇报 · 7. 边界与约束。`,
    ``,
    `G0 开发期常态 · 不外推 packaged/Provider/GA。`,
  ].join('\n');

  // 自检：草案不得出现「观感 pending_human_eye 被写 verified」模式。
  if (VERDICT_SAFE.test(draft)) {
    return { ok: false, reason: 'selfcheck-failed', diagnostics: ['草案观感项出现了 verified 冒签模式，拒绝输出'], draft: null };
  }
  return {
    ok: true,
    reason: 'ok',
    diagnostics: [],
    draft,
    inherited: ruling.inherited,
    recommendation: ruling.mode === 'inherit' ? 'inherit_advice' : 'advice_only',
  };
}
