import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import {
  collectAssistantUiPattern,
  validateAssistantUiPatternIntegrity,
  scanStreamingMessages,
  scanBoundaries,
  READING_IDS,
  PATTERN_FLOOR,
  LICENSE_REGISTER,
} from '../scripts/c52-assistant-ui-pattern.mjs';

// BLOCK-478 / C-52 P2（余项首发）— HK-01 红绿先行 + 篡改负测。
// assistant-ui 五种交互形态只做「模式借鉴 + 契约冻结」：Petri 已有本地形态锚点，
// 不替换 SimpleChat、不新增产品依赖、观感 pending_human_eye 零代签。
// ① 快照/契约结构完整 ② 逐读数现读一致 ③ 流式消息 ④ 工具调用确认 ⑤ 附件
// ⑥ 结构化数据 ⑦ 选项列表 ⑧ 边界（零依赖/不替换/许可证/观感零签）
// ⑨ manifest sha256 ⑩ 篡改负测 fail-closed ⑪ 零回归基线。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'acceptance/block478-c52-p2-assistant-ui/assistant-ui-pattern-snapshot.json');
const CONTRACT = path.join(ROOT, 'resources/design-context/assistant-ui-pattern.json');
const MANIFEST = path.join(ROOT, 'resources/design-context/manifest.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];

describe('C-52 P2 assistant-ui 模式借鉴契约可复算（HK-01）', () => {
  it('快照与契约在场且结构完整（六组读数带 value/source/command/capturedAt）', () => {
    assert.equal(fs.existsSync(SNAPSHOT), true, 'assistant-ui-pattern-snapshot.json 必须在场');
    assert.equal(fs.existsSync(CONTRACT), true, 'assistant-ui-pattern.json 必须在场');
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    assert.equal(snap.kind, 'c52-assistant-ui-pattern');
    assert.deepEqual(Object.keys(snap.readings).sort(), [...READING_IDS].sort());
    const check = validateAssistantUiPatternIntegrity(snap.readings);
    assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  });

  it('逐读数现读一致（collectAssistantUiPattern 重算与落盘 value 深等）', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const fresh = collectAssistantUiPattern(ROOT);
    for (const id of READING_IDS) {
      assert.deepEqual(
        ownGet(fresh, id).value,
        ownGet(snap.readings, id).value,
        `读数 ${id} 与现真源漂移（快照过期或真源变更未重算）`,
      );
    }
  });

  it('流式消息：pending 强制 / compose 投影 / completed 升级 + SSE 续传在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'streamingMessages').value;
    assert.equal(s.streamingForcesPending, true, 'streaming 分支必须强制 pending');
    assert.equal(s.composeToPending, true, 'compose→pending 替换必须在场');
    assert.equal(s.completedUpgrade, true, 'completed 升级路径必须在场');
    assert.equal(s.jsonPrefixGuard, true, '嵌套 JSON 前缀判据必须在场');
    assert.equal(s.sseResume, true, 'SSE afterSeq/[DONE]/ping 续传契约必须在场');
    assert.ok(s.streamingContractIts >= PATTERN_FLOOR.streamingContractIts, '流式契约 it 数不得低于冻结下限');
    assert.ok(s.sseContractTests >= PATTERN_FLOOR.sseContractTests, 'SSE 契约测试数不得低于冻结下限');
  });

  it('工具调用确认：批准卡 / 防护确认 / 计划三选一 / 两个 hook 在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const a = ownGet(snap.readings, 'toolApproval').value;
    assert.equal(a.approvalCardApproveReject, true, 'ApprovalCard onApprove/onReject 必须在场');
    assert.equal(a.guardAckVariants, true, 'GuardAckCard dynamic_guard/user_rule/mcp_trust 三变体必须在场');
    assert.equal(a.planApprovalThreeWay, true, 'PlanApprovalCard 批准三选一必须在场');
    assert.equal(a.approvalFlowHook, true, 'useApprovalFlow 必须在场');
    assert.equal(a.guardAckHook, true, 'useGuardAck 必须在场');
  });

  it('附件：大小上限 / 大小校验 / 工作区落盘 / 拖放粘贴在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const a = ownGet(snap.readings, 'attachments').value;
    assert.equal(a.sizeLimits, true, '附件大小/数量上限必须在场');
    assert.equal(a.sizeGuard, true, 'validateAttachmentSize 必须在场');
    assert.equal(a.workspaceUpload, true, '.chat-attachments 工作区落盘必须在场');
    assert.equal(a.dragDrop, true, '拖放 onDrop/onDragOver 必须在场');
    assert.ok(a.attachmentContractIts >= PATTERN_FLOOR.attachmentContractIts, '附件契约 it 数不得低于冻结下限');
  });

  it('结构化数据：compose 五 kind / fail-closed / $state 引用 / 零依赖校验器在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const s = ownGet(snap.readings, 'structuredData').value;
    assert.equal(s.composeKindCount, PATTERN_FLOOR.composeKinds, 'compose kind 数必须与冻结值一致');
    assert.equal(s.failClosed, true, '未知 kind/悬空引用/环 fail-closed 必须在场');
    assert.equal(s.stateRefs, true, '$state 安全引用校验必须在场');
    assert.equal(s.zeroDepSchema, true, '手写零依赖 schema 必须在场');
    assert.ok(s.structuredContractIts >= PATTERN_FLOOR.structuredContractIts, '结构化契约 it 数不得低于冻结下限');
  });

  it('选项列表：AskUserQuestion 结构化提问 / 多选自由输入 / 诚实回传在场', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const o = ownGet(snap.readings, 'optionLists').value;
    assert.equal(o.structuredQuestion, true, 'AskUserQuestion/ask_user_question 必须在场');
    assert.equal(o.optionFields, true, 'multiSelect/allowFreeText/UserQuestionOption 必须在场');
    assert.equal(o.busyGuard, true, 'busy 防重复提交必须在场');
    assert.equal(o.honestRouting, true, 'answered/timedOut 诚实回传必须在场');
    assert.ok(o.optionContractIts >= PATTERN_FLOOR.optionContractIts, '选项列表契约 it 数不得低于冻结下限');
  });

  it('边界：零新增依赖 / 不替换 SimpleChat / 观感零代签 / 许可证来源记录在册', () => {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
    const b = ownGet(snap.readings, 'boundaries').value;
    assert.equal(b.noNewDependency, true, '根/前端 package.json 不得出现 assistant-ui/react-bits/21st/framer-motion');
    assert.equal(b.simpleChatIntact, true, 'SimpleChat.tsx 必须仍导出 export function SimpleChat');
    assert.equal(b.simpleChatNotReplaced, true, 'SimpleChat 不得改为 import assistant-ui');
    assert.equal(b.humanEyeZeroSign, true, 'UI-706/707/709/710 必须 in_progress + pending_human_eye + 零 verified');
    assert.equal(Object.keys(b.licenseRegister).length, PATTERN_FLOOR.licenseSources, '许可证登记条数必须对齐冻结值');
    assert.deepEqual(b.licenseRegister, LICENSE_REGISTER, '快照许可证登记必须与冻结 register 一致');
  });

  it('manifest sha256 一致 + 契约模型可读标识在场', () => {
    const contractBuf = fs.readFileSync(CONTRACT);
    const contract = JSON.parse(contractBuf);
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === 'assistant-ui-pattern.json');
    assert.ok(entry, 'manifest 必须登记 assistant-ui-pattern.json');
    assert.equal(entry.sha256, sha256(contractBuf), 'manifest sha256 与契约文件不一致');
    assert.equal(contract.kind, 'model-readable-assistant-ui-pattern');
    assert.equal(contract.boundaries.humanEyeSigned, false);
    assert.equal(contract.boundaries.readOnly, true);
  });

  it('篡改负测：改真源/改依赖/改观感状态一律 fail-closed', () => {
    const fresh = collectAssistantUiPattern(ROOT);
    const override = (id, value) => {
      const clone = Object.fromEntries(READING_IDS.map((rid) => [rid, { ...ownGet(fresh, rid) }]));
      clone[id] = { ...ownGet(clone, id), value };
      return clone;
    };
    const tamperedStreaming = { ...ownGet(fresh, 'streamingMessages').value, streamingForcesPending: false };
    assert.equal(validateAssistantUiPatternIntegrity(override('streamingMessages', tamperedStreaming)).ok, false);
    const tamperedDep = { ...ownGet(fresh, 'boundaries').value, noNewDependency: false };
    assert.equal(validateAssistantUiPatternIntegrity(override('boundaries', tamperedDep)).ok, false);
    const tamperedEye = { ...ownGet(fresh, 'boundaries').value, humanEyeZeroSign: false };
    assert.equal(validateAssistantUiPatternIntegrity(override('boundaries', tamperedEye)).ok, false);
    // 直接注入篡改真源：streaming 文本删去 pending 强制后必须检测到缺席。
    const scanTampered = scanStreamingMessages(ROOT, {
      'frontend/src/components/copilot/gen-ui/referencesStreaming.ts': 'export function project() {}',
    });
    assert.equal(scanTampered.streamingForcesPending, false, '删去 pending 强制的篡改源必须被检测');
    // 直接注入篡改依赖：package.json 加入 assistant-ui 后 noNewDependency 必须翻红。
    const depTampered = scanBoundaries(ROOT, {
      'package.json': '{"dependencies":{"assistant-ui":"^1.0.0"}}',
    });
    assert.equal(depTampered.noNewDependency, false, '新增 assistant-ui 依赖的篡改源必须被检测');
  });

  it('零回归基线：相关契约测试与真源文件在场', () => {
    for (const f of [
      'test/c53-performance-trust.test.mjs',
      'test/c53-human-eye-closeout.test.mjs',
      'frontend/src/components/copilot/gen-ui/references-streaming.test.ts',
      'frontend/src/components/copilot/SimpleChat/GuardAckCard.test.tsx',
      'frontend/src/components/copilot/SimpleChat/attachments.test.ts',
      'frontend/src/components/copilot/gen-ui/compose/spec.test.ts',
      'frontend/src/components/copilot/SimpleChat/UserQuestionCard.test.tsx',
      'scripts/c53-performance-trust.mjs',
    ]) {
      assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${f} 零回归基线不得被破坏`);
    }
  });
});
