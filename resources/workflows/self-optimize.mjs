// eslint-env node
// workflow 宿主经 vm realm 注入的原语（BLOCK-262/335）：agent / phase / checkpoint / verify / log
/* global agent, phase, checkpoint, verify, log */
// BLOCK-335 P2 — 自优化闭环脚本（判据驱动驾驶员的执行载体）。
//
// phase 链：checkpoint → agent 改动 → verify → 判定（红即回滚）。
// 红线：不建第二执行器/第二验证器/第二快照——agent() 唯一经宿主 launchSubAgent，
// verify() 消费既有 test-affected 门禁，checkpoint() 复用 shared workspace-checkpoint；
// 回滚显式携带 phase 1 的 ref（宁慢勿腐）；journal 每 phase 落 ref / verdict。
export const meta = {
  name: 'self-optimize',
  version: 1,
  budget: { maxAgents: 2, maxSteps: 16, timeoutMs: 1800000 },
  concurrency: 1,
};

export default async function run(args) {
  const projectId = args.projectId;
  if (!projectId) return { ok: false, error: 'project_required' };
  const taskPrompt = String(args.taskPrompt || '完成给定的小改动，保持验证绿。');

  // phase 1 — checkpoint（失败可回滚的安全网；工作树与 HEAD 一致 = created:false，如实无 ref）
  const snap = await phase('checkpoint', () => checkpoint({ projectId, action: 'create' }));
  log('checkpoint', snap && snap.ref);

  // phase 2 — agent 改动：verify spec 随任务进 loop（模型自报 complete 需结构化验证背书）
  const spawned = await phase('agent', () => agent({
    prompt: taskPrompt,
    goals: ['改动只落在不需重启即可验证的面（scripts/ test/ frontend/ docs/ resources/）'],
    verify: { kind: 'test-affected', projectId },
    // accessMode 显式 full：档位判定不是 observe 的替代品——首批任务的工具写仍由
    // observe 规则护航（复盘面可见），这里只是不被默认档位拦在观察之前
    context: { projectId, accessMode: 'full' },
  }));

  // phase 3 — verify：独立复核，不信任 agent 自报
  const verdict = await phase('verify', () => verify({ kind: 'test-affected', projectId }));

  // phase 4 — 判定：ready 留改动；红回滚到 checkpoint（显式 ref）
  if (verdict && verdict.verdict === 'ready') {
    return { outcome: 'ready', checkpointRef: (snap && snap.ref) || null, verify: verdict, agent: spawned };
  }
  const rolled = snap && snap.ref
    ? await phase('rollback', () => checkpoint({ projectId, action: 'rollback', ref: snap.ref }))
    : { ok: false, error: 'no_checkpoint_ref' };
  log('rolled_back', rolled && rolled.ok);
  return {
    outcome: 'rolled_back',
    checkpointRef: (snap && snap.ref) || null,
    verify: verdict,
    rollback: rolled,
    agent: spawned,
  };
}
