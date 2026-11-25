/**
 * UI-638 加映 — 识图模型默认走 DeepSeek（用户 2026-10-30 裁决「软件写定！
 * 识图模型默认使用 DeepSeek，以后省得再设置」）。
 *
 * 契约：
 * 1) 零配置归一化后 vision 角色绑定到声明 vision 的 DeepSeek 档案（开箱可用）；
 * 2) 旧配置把 vision 显式绑到「未配置凭据的 dashscope-vision」时，若 chat 档案
 *    已声明 vision → 自动改绑并落盘（一次性迁移，之后以落盘值为准）；
 * 3) BLOCK-454 P1 加映：旧安装版档案由 UI-638 之前的版本写盘，capabilities 缺
 *    vision 声明——chat 档案是 OPENAI_FAMILY 通道上的 deepseek 模型（V4.1 起原生
 *    多模态，findings §0）时同样迁移，且补声明 capability（运行时 + 落盘），
 *    否则改绑后 resolve 报 model_capability_mismatch；
 * 4) chat 是真文本模型（非 deepseek 形态）时不迁移（显式配置真相优先，resolve
 *    会诚实报错）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeModelConfig, resolveModelProfile } = require('../core/shared-backend/llm-providers/model-profile.js');

const SETTINGS_MODULE = path.resolve('core/petri-server/helpers/ai-settings.js');

function runSettingsProbe(dir) {
  const script = `
    const fs = require('fs');
    const settings = require(${JSON.stringify(SETTINGS_MODULE)});
    const { resolveModelProfile } = require(${JSON.stringify(path.resolve('core/shared-backend/llm-providers/model-profile.js'))});
    const current = settings.getAiSettings();
    const onDisk = JSON.parse(fs.readFileSync(settings.SETTINGS_FILE, 'utf8'));
    const resolveVision = resolveModelProfile({ profiles: current.model_profiles, roleBindings: current.model_role_bindings }, 'vision');
    const deepseekProfile = (current.model_profiles || []).find((p) => p.id === 'deepseek-chat');
    const onDiskDeepseek = (onDisk.model_profiles || []).find((p) => p.id === 'deepseek-chat');
    process.stdout.write(JSON.stringify({
      vision: current.model_role_bindings && current.model_role_bindings.vision,
      onDiskVision: onDisk.model_role_bindings && onDisk.model_role_bindings.vision,
      deepseekCaps: deepseekProfile ? deepseekProfile.capabilities : null,
      onDiskDeepseekCaps: onDiskDeepseek ? onDiskDeepseek.capabilities : null,
      visionResolveError: resolveVision.error || null,
      visionResolvedProfile: resolveVision.profile ? resolveVision.profile.id : null,
    }));
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PETRI_LOCAL_DATA_DIR: dir,
      PETRI_CREDENTIAL_BACKEND: 'file',
    },
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

function writeSettings(dir, profiles, bindings) {
  fs.writeFileSync(path.join(dir, 'ai-settings.json'), JSON.stringify({
    model_profiles: profiles,
    model_role_bindings: bindings,
    model_fallback_enabled: false,
  }, null, 2));
}

const DEEPSEEK_VISION = {
  id: 'deepseek-chat',
  provider: 'deepseek',
  model: 'deepseek-flash',
  credentialRef: 'provider:deepseek',
  capabilities: ['chat', 'streaming', 'tools', 'vision'],
};
const DASHSCOPE_VISION = {
  id: 'dashscope-vision',
  provider: 'dashscope-vision',
  model: 'qwen-vl-max',
  credentialRef: 'provider:dashscope',
  capabilities: ['vision'],
};

test('零配置：vision 角色绑定默认 DeepSeek 档案（开箱可用；BLOCK-518 后能力位只载 tools）', () => {
  const config = normalizeModelConfig({});
  assert.equal(config.roleBindings.vision, 'deepseek-chat');
  const profile = config.profiles.find((item) => item.id === 'deepseek-chat');
  assert.ok(profile, '默认档案必须存在');
  assert.deepEqual(profile.capabilities, ['tools'], 'BLOCK-518 收窄：默认档案能力位=[tools]');
  // 槽位撤门：vision 绑定不再要求 vision 声明，解析无 mismatch。
  assert.equal(resolveModelProfile(config, 'vision').profile.id, 'deepseek-chat');
});

test('旧配置迁移：vision 绑未配置的 dashscope-vision → 改绑 chat 档案并落盘', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-vision-default-'));
  writeSettings(dir, [DEEPSEEK_VISION, DASHSCOPE_VISION], {
    chat: 'deepseek-chat',
    agent: 'deepseek-chat',
    vision: 'dashscope-vision',
    embedding: 'dashscope-embedding',
  });
  const result = runSettingsProbe(dir);
  assert.equal(result.vision, 'deepseek-chat', `运行时绑定=${result.vision}`);
  assert.equal(result.onDiskVision, 'deepseek-chat', `迁移必须落盘，磁盘=${result.onDiskVision}`);
});

test('BLOCK-454 P1 — 旧安装版档案缺 vision 声明：deepseek 多模态形态仍迁移并补声明（运行时 + 落盘）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-vision-legacy-caps-'));
  writeSettings(dir, [
    { ...DEEPSEEK_VISION, capabilities: ['chat', 'streaming', 'tools'] },
    DASHSCOPE_VISION,
  ], {
    chat: 'deepseek-chat',
    agent: 'deepseek-chat',
    vision: 'dashscope-vision',
    embedding: 'dashscope-embedding',
  });
  const result = runSettingsProbe(dir);
  assert.equal(result.vision, 'deepseek-chat', `运行时绑定=${result.vision}`);
  assert.equal(result.onDiskVision, 'deepseek-chat', `迁移必须落盘，磁盘=${result.onDiskVision}`);
  // BLOCK-518 — 运行时归一化把 vision 位收窄掉（能力位只载 tools）；
  // 落盘档案的补声明写面保留（读取侧 normalize 收窄，无害）。
  assert.deepEqual(result.deepseekCaps, ['tools'], `运行时档案能力位收窄: ${JSON.stringify(result.deepseekCaps)}`);
  assert.equal(result.visionResolveError, null, `改绑后 vision 角色必须可解析（槽位撤门）: ${JSON.stringify(result)}`);
  assert.equal(result.visionResolvedProfile, 'deepseek-chat');
});

test('chat 是真文本模型（非 deepseek 形态）时不迁移（显式配置真相优先）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-vision-nodefault-'));
  writeSettings(dir, [
    {
      id: 'text-only-chat',
      provider: 'openai-compatible',
      model: 'my-text-llm',
      credentialRef: 'provider:deepseek',
      capabilities: ['chat', 'streaming', 'tools'],
    },
    DASHSCOPE_VISION,
  ], {
    chat: 'text-only-chat',
    agent: 'text-only-chat',
    vision: 'dashscope-vision',
    embedding: 'dashscope-embedding',
  });
  const result = runSettingsProbe(dir);
  assert.equal(result.vision, 'dashscope-vision');
  assert.equal(result.onDiskVision, 'dashscope-vision');
});
