/**
 * BLOCK-188 P2 — context_snapshot 棘轮契约单测（纯函数，离线无后端、无 provider）。
 * 守：①确定性（同组装同指纹）②易变 token 归一（run/machine 特定值被抹→同指纹）
 *     ③漂移检出（prompt 文案/工具名/参数 schema/上下文骨架任一变更→指纹变）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeContextString, buildContextSnapshot } from '../scripts/lib/evals-harness.mjs';

function agentReq(over = {}) {
  const system = [
    '你是生物信息学分析助手。',
    '=== 桌面项目 Agent 工具规则 ===',
    '- 当前执行环境：Windows_NT 10.0.26300 · x64 · shell=C:\\windows\\system32\\cmd.exe',
    '- 生成 UI fragment 写入 projects\\evals-golden-first-success-abcdef\\.petri\\gen-ui\\conv_0862064f-73c 目录。',
    '- [项目] evals-golden-first-success (id=p_mvakgg1c_abny, 0 数据集, 0 分析)',
  ].join('\n');
  return {
    model: 'evals-model',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: '随便回一句' },
    ],
    tools: [
      { type: 'function', function: { name: 'workspace_write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
      { type: 'function', function: { name: 'run_tool', parameters: { type: 'object', properties: { toolId: { type: 'string' } } } } },
    ],
    ...over,
  };
}
const TMP_A = '/var/folders/xx/T/petri-evals-AAA111';
const TMP_B = '/var/folders/yy/T/petri-evals-BBB222';

test('确定性：同一请求两次构建指纹一致', () => {
  const r = agentReq();
  assert.equal(buildContextSnapshot(r, { tmpRoot: TMP_A }).fingerprint, buildContextSnapshot(r, { tmpRoot: TMP_A }).fingerprint);
});

test('易变 token 归一：run/machine 特定值不同 → 同指纹（这是棘轮不误红的核心）', () => {
  // run B：项目名文案相同，仅易变 token 不同（项目 id / conv / 项目目录后缀 / 平台 / tmp 根）
  const systemB = [
    '你是生物信息学分析助手。',
    '=== 桌面项目 Agent 工具规则 ===',
    '- 当前执行环境：darwin 23.5.0 · arm64 · shell=/bin/zsh',
    '- 生成 UI fragment 写入 projects\\evals-golden-first-success-zzz999\\.petri\\gen-ui\\conv_9999aaaa-111 目录。',
    '- [项目] evals-golden-first-success (id=p_zzzzzzzz_9999, 0 数据集, 0 分析)',
  ].join('\n');
  const reqB = { ...agentReq(), messages: [{ role: 'system', content: systemB }, { role: 'user', content: '随便回一句' }] };
  const sA = buildContextSnapshot(agentReq(), { tmpRoot: TMP_A });
  const sB = buildContextSnapshot(reqB, { tmpRoot: TMP_B });
  assert.equal(sA.fingerprint, sB.fingerprint, '仅易变 token 不同应折叠为同指纹');
});

test('漂移检出：system 静态文案变更 → 指纹变', () => {
  const base = agentReq();
  const changed = { ...base, messages: [{ role: 'system', content: base.messages[0].content + '\n- 新增一条行为规则。' }, base.messages[1]] };
  assert.notEqual(buildContextSnapshot(base, { tmpRoot: TMP_A }).fingerprint, buildContextSnapshot(changed, { tmpRoot: TMP_A }).fingerprint);
});

test('漂移检出：工具名变更 → 指纹变', () => {
  const base = agentReq();
  const changed = { ...base, tools: base.tools.map((t, i) => (i === 0 ? { function: { name: 'workspace_write_V2', parameters: t.function.parameters } } : t)) };
  assert.notEqual(buildContextSnapshot(base, { tmpRoot: TMP_A }).fingerprint, buildContextSnapshot(changed, { tmpRoot: TMP_A }).fingerprint);
});

test('漂移检出：工具参数 schema 变更 → 指纹变', () => {
  const base = agentReq();
  const changed = { ...base, tools: base.tools.map((t, i) => (i === 1 ? { function: { name: t.function.name, parameters: { type: 'object', properties: { toolId: { type: 'string' }, extra: { type: 'number' } } } } } : t)) };
  assert.notEqual(buildContextSnapshot(base, { tmpRoot: TMP_A }).fingerprint, buildContextSnapshot(changed, { tmpRoot: TMP_A }).fingerprint);
});

test('工具按名排序（顺序无关）+ role 骨架入快照', () => {
  const base = agentReq();
  const swapped = { ...base, tools: [base.tools[1], base.tools[0]] };
  assert.equal(buildContextSnapshot(base, { tmpRoot: TMP_A }).fingerprint, buildContextSnapshot(swapped, { tmpRoot: TMP_A }).fingerprint);
  const snap = buildContextSnapshot(base, { tmpRoot: TMP_A });
  assert.deepEqual(snap.skeleton, ['system', 'user']);
});

test('normalizeContextString 逐类抹除易变值', () => {
  assert.match(normalizeContextString('id=p_aaaaaaaa_bbbb x', TMP_A), /<PROJECT_ID>/);
  assert.match(normalizeContextString('dir conv_deadbeef-12 tail', TMP_A), /<CONV_ID>/);
  assert.match(normalizeContextString('写入 projects\\foo-bar\\.petri\\gen-ui 内', TMP_A), /projects\/<WORKSPACE>/);
  assert.match(normalizeContextString('当前执行环境：win · x64 · shell=c:\\x', TMP_A), /<ENV>/);
  assert.match(normalizeContextString('见 2026-10-16T12:00:00.000Z 起', TMP_A), /<DATETIME>/);
  assert.match(normalizeContextString(`${TMP_A}/projects`, TMP_A), /<TMP>/);
});
