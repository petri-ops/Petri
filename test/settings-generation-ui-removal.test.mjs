/**
 * 迭代③终裁 HK-01（owner msg_4639d2fea3a9）：设置页移除整个「默认偏好/意图」区，
 * 自动档为唯一形态（env 后门与 generation 键兼容读取仍在、reasoning 分区保留）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const panel = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel.tsx'), 'utf-8');

test('HK-01-1：设置页不再挂载默认偏好/意图区块（零 UI 入口）', () => {
  assert.doesNotMatch(panel, /GenerationDefaultsPanel/);
  assert.doesNotMatch(panel, /ModelPreferenceTabs/);
  assert.doesNotMatch(panel, /modelPrefTab/);
  assert.doesNotMatch(panel, /默认偏好/);
});

test('HK-01-2：设置页仍保留 API Endpoint 渠道管理（自定义面不被误撤）', () => {
  assert.match(panel, /API Endpoint/);
  assert.match(panel, /petri-model-list/);
});

test('HK-01-3：reasoning 思考档位分区保留（owner 反馈只针对生成参数区）', () => {
  const reasoningPanel = fs.readFileSync(
    path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/sections/ReasoningDefaultsPanel.tsx'), 'utf8',
  );
  assert.match(reasoningPanel, /推理档位|默认档位/);
});

test('HK-01-4：自动档逻辑仍在（本地规则+三层链），env 后门与旧键兼容读取不删', () => {
  const logic = fs.readFileSync(
    path.join(ROOT, 'core/petri-server/helpers/generation-intent.js'), 'utf8',
  );
  assert.match(logic, /detectIntentPreset/);
  assert.match(logic, /resolveGenerationParams/);
  const settings = fs.readFileSync(
    path.join(ROOT, 'core/petri-server/helpers/ai-settings.js'), 'utf8',
  );
  assert.match(settings, /generation\.intentPreset|intentPreset/);
  assert.match(settings, /PETRI_LLM_TEMPERATURE/);
});
