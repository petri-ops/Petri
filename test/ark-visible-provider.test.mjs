/**
 * owner msg_5523f9e5c8aa 裁决A：模型接口面板加可视 Ark 条目（与 DeepSeek 同构）。
 * HK-01：provider 在用户可配置集合内（否则被面板过滤）、credentialId 派生 'ark'、key 不回显形态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const opts = fs.readFileSync(path.join(ROOT, 'frontend/src/lib/model-provider-options.ts'), 'utf8');
const types = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/model-types.ts'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel.tsx'), 'utf8');

test('HK-01-1：面板 provider 集合含 openai-compatible（Ark 走此协议进入列表）', () => {
  assert.match(opts, /value:\s*'openai-compatible'/);
  assert.match(opts, /isUserConfigurableModelProvider/);
});

test('HK-01-2：credentialRef provider:ark → credentialId ark（凭据状态匹配）', () => {
  const fn = types.slice(types.indexOf('export function credentialId'));
  assert.match(fn, /ref\.includes\(':'\)\s*\?\s*ref\.slice\(ref\.indexOf\(':'\)\s*\+\s*1\)/);
});

test('HK-01-3：面板 Key 输入不回显（password + 留空保持不变）', () => {
  assert.match(panel, /visibleCredentialIds\[id\] \? 'text' : 'password'/);
  const detail = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/sections/DecisionConfigPanel.tsx'), 'utf8');
  assert.match(detail, /留空保持不变/);
});

test('HK-01-4：面板遍历 userModelProfiles 渲染（Ark 条目自动可见）', () => {
  assert.match(panel, /userModelProfiles\.map\(/);
  assert.match(panel, /credentialStatus\[id\]/);
});

test('HK-01-5：实际 dev 数据目录 Ark profile 对面板可见（provider 在过滤白名单）', () => {
  const devDir = path.join(process.cwd(), '.petri-dev-user-data', 'data');
  const settingsPath = path.join(devDir, 'ai-settings.json');
  if (!fs.existsSync(settingsPath)) return; // 非 dev 环境跳过（CI 无该目录）
  const d = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const ark = (d.model_profiles || []).find((p) => p.id === 'ark-creative');
  assert.ok(ark, 'dev 数据须含 Ark profile');
  assert.match(ark.provider, /^(openai-compatible|anthropic)$/, 'provider 须在面板白名单内，否则被过滤');
  assert.equal(ark.credentialRef, 'provider:ark');
  assert.ok(ark.label && ark.label.includes('Ark'), '面板 label 可见');
});
