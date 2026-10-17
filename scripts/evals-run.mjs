#!/usr/bin/env node
/**
 * scripts/evals-run.mjs — 黄金任务套件运行器（BLOCK-181；BLOCK-193 加录制/回放三态）。
 *
 * 用法：npm run evals:run -- --suite=smoke --provider=mock [--report=<path>]
 * - provider=mock：脚本化回合（任务定义 mockScript）——测 harness 与 loop 机制回归
 * - provider=real：真实 provider——测模型质量（无凭据任务诚实 skip）。BLOCK-193 起出站证据
 *   由生产 io-transcript 台账投影，故 real 层也能跑 outbound_contains 哨兵；加 --record 时把
 *   当次任务的转录收割为 evals/recordings/<suite>/<taskId>.json（入库双闸，不过即拒录）。
 * - provider=replay：零 API、零凭据离线重放录制回合（投递仍走既有 startMockProvider 通道）。
 *   measures=recorded-replay，诚实标注「测的是回放管道与判据评估，不冒充模型质量」；任务缺
 *   outbound_contains 哨兵判据=直接红（罐头假绿闸）。
 * 报告落 acceptance/evals/<suite>[-replay]-latest.json（+时间戳副本）——provider 入产物名，
 * 防回放覆盖 real-latest 把真模型棘轮比到回放数上（假绿通道）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnIsolatedBackend, startMockProvider, runGoldenTask, defaultTmpDir, buildContextSnapshot,
  sanitizeEvalTasksForStorage,
} from './lib/evals-harness.mjs';
import {
  snapshotTranscriptCounts, readNewTranscriptRecords, projectTranscriptToOutbound, buildRecording,
  gateRecording, loadRecording, recordingPath, verifyRecordingForReplay, assertReplaySentinel,
} from './lib/evals-recording.mjs';
import { collectJudgeReading, judgeGate, assertJudgeTier } from './lib/evals-judge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// 取最后一个匹配：命令行显式追加的参数覆盖 npm script 里的预置值（evals:record 等别名靠此可复盖）。
const argValue = (prefix, fallback) => {
  const hit = args.filter((a) => a.startsWith(`${prefix}=`)).pop();
  return hit ? hit.split('=')[1] : fallback;
};
const suiteName = argValue('--suite', 'smoke');
const provider = argValue('--provider', 'mock');
const explicitReport = argValue('--report', '');
const record = args.includes('--record');
if (!['mock', 'real', 'replay'].includes(provider)) {
  console.error(`[evals] 未知 --provider=${provider}（可用：mock | real | replay）`);
  process.exit(2);
}
if (record && provider !== 'real') {
  console.error('[evals] --record 仅对 --provider=real 有效（把脚本化回合写成「真实录制」=伪产物污染录制面）');
  process.exit(2);
}
// BLOCK-194：质量判读只对真模型答卷开放（脚本回合/罐头回放没有质量可言）。
const judgeEnabled = args.includes('--judge');
const judgeTier = assertJudgeTier({ provider, judgeEnabled });
if (!judgeTier.ok) {
  console.error(`[evals] ${judgeTier.reason}`);
  process.exit(2);
}
// 产物 namespace：回放态与真模型态同 suite 目录，但**绝不共享报告/基线**。
const artifactName = provider === 'replay' ? `${suiteName}-replay` : suiteName;

const suiteDir = path.join(root, 'evals', 'suites', suiteName);
if (!fs.existsSync(suiteDir)) {
  console.error(`[evals] 套件不存在：evals/suites/${suiteName}`);
  process.exit(2);
}
const suiteFiles = fs.readdirSync(suiteDir).filter((f) => f.endsWith('.json')).sort();
const tasks = suiteFiles.map((f) => JSON.parse(fs.readFileSync(path.join(suiteDir, f), 'utf8')));
// 合成任务闸的凭据：任务 id → 仓库内套件文件（录制产物必须声明自己的出处）。
const suiteFileOf = new Map(tasks.map((t, i) => [t.id, `evals/suites/${suiteName}/${suiteFiles[i]}`]));

const tmpDir = defaultTmpDir('petri-evals-');
const mock = provider === 'mock' || provider === 'replay' ? startMockProvider() : null;
const mockPort = mock ? await mock.ready : null;
if (mock) process.env.PETRI_EVALS_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;

const backend = await spawnIsolatedBackend({ root, tmpDir, mode: provider });
// BLOCK-192：real 模式凭据 env 缺省已由 harness 回落本机凭据库；仍拿不到才诚实 skip（附原因，不伪造真模型结果）。
const realBlocked = provider === 'real' && !backend.provider.hasKey;
if (realBlocked) console.log(`[evals] provider=real 凭据不可得（${backend.provider.skipReason || '未知原因'}）——全部任务诚实 skip`);
else if (provider === 'real' && backend.provider.source === 'local-store') console.log(`[evals] provider=real 凭据来自本机凭据库（model=${backend.provider.model}）`);
console.log(`[evals] suite=${suiteName} provider=${provider}${record ? ' +record' : ''} tasks=${tasks.length} backend=${backend.ok ? 'up' : 'DOWN'} @${backend.port}`);

const report = {
  suite: suiteName,
  provider,
  artifact: artifactName,
  measures: provider === 'mock' ? 'harness' : (provider === 'replay' ? 'recorded-replay' : 'model'),
  at: new Date().toISOString(),
  tasks: [],
};
let passCount = 0;
let snapshotDrift = false;
let recordFailures = 0;
let recordedAny = false;
const judgeReadings = [];

if (backend.ok) {
  const api = backend.api;
  for (const task of tasks) {
    if (realBlocked) {
      const reason = `real 凭据不可得：${backend.provider.skipReason || '未知'}`;
      report.tasks.push({ id: task.id, skipped: true, passed: false, reason, criteriaResults: [] });
      console.log(`SKIP ${task.id} — ${reason}`);
      continue;
    }
    let replayGuard = null;
    if (provider === 'replay') {
      // 罐头假绿双闸：产物对账（同任务同 prompt）+ 哨兵判据在场；任一不过=红，不是 skip。
      const recording = loadRecording(root, suiteName, task.id);
      const verified = verifyRecordingForReplay({ ...task, suite: suiteName }, recording);
      const sentinel = assertReplaySentinel(task);
      if (!verified.ok || !sentinel.ok) {
        replayGuard = [verified.ok ? null : verified.reason, sentinel.ok ? null : sentinel.reason].filter(Boolean).join('；');
      } else {
        mock.push(...recording.turns);
      }
    } else if (Array.isArray(task.mockScript)) {
      mock.push(...task.mockScript);
    }
    // real：任务前后各取一次转录快照，行号差分即本任务归属（串行跑，故不需时钟也不需 convId 命名）。
    const transcriptBefore = provider === 'real' ? snapshotTranscriptCounts(tmpDir) : null;
    let harvestCache = null;
    const harvest = () => {
      if (!harvestCache) harvestCache = readNewTranscriptRecords(tmpDir, transcriptBefore);
      return harvestCache;
    };
    const outbound = provider === 'real'
      ? () => harvest().records.map(projectTranscriptToOutbound)
      : (mock ? mock.captured : null);
    const result = await runGoldenTask({ api, tmpDir, task, outbound });
    if (replayGuard) {
      result.passed = false;
      result.replayGuard = replayGuard;
      console.log(`  [replay] ✖ ${task.id} 回放闸：${replayGuard}`);
    }
    result.criteriaResults = result.criteriaResults || [];
    if (!result.skipped) {
      for (const c of result.criteriaResults) {
        console.log(`  ${c.passed ? '✔' : '✖'} ${task.id} · ${c.kind}${c.detail ? ` — ${c.detail.slice(0, 90)}` : ''}`);
      }
    }
    // BLOCK-194：质量判读在收口后、sanitize 剥正文前完成——判词与被判正文都只存活于内存，
    // 落报告的读数不含任何文本正文（沿用 BLOCK-192 入库脱敏纪律）。
    // 被测文本=**终点答案**（最后一次 tool_call 之后的正文），不是全程独白拼接（口径同 BLOCK-119）。
    if (judgeEnabled && !result.skipped) {
      const reading = await collectJudgeReading({ task, finalText: result.finalAnswerText });
      judgeReadings.push(reading);
      const green = reading.verdict === 'PASS' && !reading.degraded && reading.measured;
      console.log(`  [judge] ${green ? '✔' : '✖'} ${task.id} · ${reading.verdict}${reading.degraded ? '(degraded)' : ''} · fit=${reading.fit ?? '-'}${reading.fitStatus ? `/${reading.fitStatus}` : ''} · judge=${reading.model || 'null'}${reading.fitReplay ? ` · 邻域复核 k=${reading.fitReplay.k} median=${reading.fitReplay.median}` : ''}${reading.reason ? ` · ${String(reading.reason).slice(0, 60)}` : ''}`);
    }
    if (provider === 'real' && record) {
      const { records, unparsed } = harvest();
      const recording = buildRecording({
        task,
        suite: suiteName,
        sourceSuiteFile: suiteFileOf.get(task.id) || '',
        records,
        provider: { name: backend.provider.source || null, model: backend.provider.model },
      });
      const gate = gateRecording({ recording, task, records });
      if (!gate.ok) {
        recordFailures += 1;
        console.log(`  [record] ✖ ${task.id} 拒录：${gate.reasons.join(' / ')}${unparsed ? `（另有 ${unparsed} 行转录解析失败，如实计数）` : ''}`);
      } else {
        const file = recordingPath(root, suiteName, task.id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
        console.log(`  [record] ✔ ${task.id} → ${path.relative(root, file)}（回合 ${recording.turnCount}/${recording.requestCount}·丢弃 ${recording.droppedCount}）`);
        recordedAny = true;
      }
    }
    report.tasks.push(result);
    if (result.passed) passCount += 1;
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${task.id}（${result.durationMs}ms）`);
  }
} else {
  for (const task of tasks) report.tasks.push({ id: task.id, passed: false, skipped: false, criteriaResults: [], error: 'backend DOWN' });
}

// BLOCK-197 教训入码：录制文件是**可重生成资产**，但 `evals/baselines/<suite>-replay.json` 与它成对。
// 实跑踩过：`evals:record` 重录后 provider-sanity 的回合不再满足 tool_used/file_contains → replay 直接红。
// 所以重录必须同批复验回放并按需显式提升 replay 基线，不能只信"录制成功"。
if (recordedAny) {
  console.log('\n[record] ⚠ 录制资产已刷新——同批复验回放：`npm run evals:replay && npm run evals:gate -- --suite=real --provider=replay`；不绿则 git 还原录制或显式提升 replay 基线。');
}

// ── BLOCK-188 context_snapshot 棘轮（按套件）─────────────────────
// 全局组装契约指纹（system prompt + 工具 schema + role 骨架；动态值归一化）。system prompt
// 随 accessMode/上下文变，故基线**逐套件**（evals/snapshots/<suite>.json），golden=满权限规范组装。
// prompt/工具 schema/上下文组装任一变更 → 漂移红；建立/重打基线仅走显式 --update-snapshot（防退化）。
// 无基线且非 --update → 静默跳过（不为新套件自动 bootstrap 基线）。
if (backend.ok && mock) {
  const agentReq = mock.captured.find((c) => Array.isArray(c.tools) && c.tools.length > 0);
  if (agentReq) {
    const snap = buildContextSnapshot(agentReq, { tmpRoot: tmpDir });
    const baselinePath = path.join(root, 'evals', 'snapshots', `${suiteName}.json`);
    const updating = args.includes('--update-snapshot');
    if (updating) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, `${JSON.stringify({ ...snap, updatedAt: new Date().toISOString() }, null, 2)}\n`);
      console.log(`[context-snapshot] 重打基线 ${path.relative(root, baselinePath)} fp=${snap.fingerprint.slice(0, 16)}`);
    } else if (fs.existsSync(baselinePath)) {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (baseline.fingerprint !== snap.fingerprint) {
        snapshotDrift = true;
        const why = [];
        if (baseline.system !== snap.system) why.push('system prompt 文案变更');
        const bTools = (baseline.tools || []).map((t) => `${t.name}#${t.schema}`).join('|');
        const sTools = snap.tools.map((t) => `${t.name}#${t.schema}`).join('|');
        if (bTools !== sTools) why.push('工具 schema 变更');
        if ((baseline.skeleton || []).join(',') !== snap.skeleton.join(',')) why.push('上下文 role 骨架变更');
        console.log(`[context-snapshot] ✖ 组装契约漂移 fp=${snap.fingerprint.slice(0, 16)} vs 基线 ${String(baseline.fingerprint).slice(0, 16)}｜${why.join('；') || '指纹不一致'}`);
      } else {
        console.log(`[context-snapshot] ✔ 组装契约一致 fp=${snap.fingerprint.slice(0, 16)}`);
      }
    }
  }
}

report.pass = passCount;
report.total = tasks.length;
report.skipped = report.tasks.filter((t) => t.skipped).length;
const failures = report.tasks.filter((t) => !t.skipped && !t.passed).length;
// BLOCK-194：质量读数两层——测量不成立（降级/无门控/零读数）才 exit 非零；
// 落在非达标区（RETRY/ESCALATE）如实记为**质量缺口**并逐条打印，由读数棘轮守「不得后退」。
let judgeGateResult = null;
if (judgeEnabled) {
  judgeGateResult = judgeGate(judgeReadings);
  report.judge = { readings: judgeReadings, gate: judgeGateResult };
  for (const r of judgeGateResult.invalid) console.log(`  [judge] ✖ 测量不成立 ${r.id} — ${r.why}`);
  for (const g of judgeGateResult.gaps) console.log(`  [judge] ⚠ 质量缺口 ${g.id} — ${g.verdict}（fit=${g.fit ?? '-'}${g.fitStatus ? `/${g.fitStatus}` : ''}·判词提示 ${g.hintsCount} 条）`);
  console.log(`[judge] 读数有效性：${judgeGateResult.ok ? 'OK' : 'FAIL'}（读数 ${judgeReadings.length}/${tasks.length}·不成立 ${judgeGateResult.invalid.length}·质量缺口 ${judgeGateResult.gaps.length}）`);
}
// 入库前脱敏：报告与基线不留模型原文（判据结论足够驱动棘轮，见 sanitizeEvalTasksForStorage 注释）
report.tasks = sanitizeEvalTasksForStorage(report.tasks);
await backend.cleanup();
if (mock) await mock.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }

const evidenceDir = path.join(root, 'acceptance', 'evals');
fs.mkdirSync(evidenceDir, { recursive: true });
const reportPath = explicitReport || path.join(evidenceDir, `${artifactName}-latest.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const stamped = path.join(evidenceDir, `${artifactName}-${report.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(stamped, JSON.stringify(report, null, 2));
console.log(`\n=== evals run: ${passCount}/${tasks.length} PASS（skipped ${report.skipped}；报告 ${path.relative(root, reportPath)}；measures=${report.measures}${recordFailures ? `；拒录 ${recordFailures}` : ''}${judgeGateResult ? `；读数有效性 ${judgeGateResult.ok ? 'OK' : 'FAIL'}·质量缺口 ${judgeGateResult.gaps.length}` : ''}）===`);
process.exitCode = failures === 0 && !snapshotDrift && recordFailures === 0 && (!judgeGateResult || judgeGateResult.ok) ? 0 : 1;
