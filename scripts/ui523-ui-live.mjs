#!/usr/bin/env node
/**
 * UI-523 — composer 运行计量条实机腿一键封装（mock provider，零真实 key）。
 *
 * 做四件事，任何一步失败都进 finally 还原：
 *   ① 起本地 mock provider（:39001，零外网）；
 *   ② 临时把 dev 后端指向 mock（ai-settings 备份/改写 + keychain 临时凭据 ui523-mock）；
 *   ③ 跑 dev-verify flow `ui523-run-stats`（连 CDP 9223 测试实例，绝不碰用户主窗）；
 *   ④ 还原 ai-settings（逐字节校验）、删除临时 keychain 凭据、停 mock。
 *
 * 前置：dev 栈在跑（后端 :3001 / vite :3000）+ `R_SERVER_PORT=3002` 测试实例已在 9223
 * （`bash scripts/start-test-instance.sh` 即可；后端端口由 Electron 自己解析，本脚本只消费 3001）。
 *
 * 证据：acceptance/ui-523/ui523-run-stats-live.json + 两张截图（flow 产出）。
 * 诚实边界：provider=mock —— 证明代码链，不表述为「真实 Provider 已验」。
 */
import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = join(ROOT, '.petri-dev-user-data', 'data', 'ai-settings.json');
const BACKUP = join(ROOT, '.petri-dev-user-data', 'data', 'ai-settings.ui523-backup.json');
const MOCK_PORT = Number(process.env.UI523_MOCK_PORT || 39001);
const KEYCHAIN_SERVICE = 'com.petri.desktop.ai';
const KEYCHAIN_ACCOUNT = 'ui523-mock';

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function portOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.on('error', () => resolvePort(false));
    socket.setTimeout(800, () => { socket.destroy(); resolvePort(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(SETTINGS)) throw new Error('ai-settings.json 不存在：' + SETTINGS);

  // ── ① mock provider ──
  let mock = null;
  if (!(await portOpen(MOCK_PORT))) {
    mock = spawn(process.execPath, [join(ROOT, 'scripts', 'ui523-mock-provider.mjs')], {
      env: { ...process.env, UI523_MOCK_PORT: String(MOCK_PORT) },
      stdio: 'ignore',
    });
    for (let i = 0; i < 20; i += 1) {
      if (await portOpen(MOCK_PORT)) break;
      await sleep(200);
    }
    if (!(await portOpen(MOCK_PORT))) throw new Error('mock provider 未就绪');
  }

  // ── ② 备份 + 指向 mock（keychain 临时凭据）──
  copyFileSync(SETTINGS, BACKUP);
  const beforeHash = sha256(BACKUP);
  execFileSync('/usr/bin/security', [
    'add-generic-password', '-U', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w', 'mock-key',
  ], { stdio: 'ignore' });

  const settings = JSON.parse(readFileSync(SETTINGS, 'utf8'));
  const preset = {
    id: 'ui523-mock',
    label: 'UI-523 Mock DeepSeek',
    provider: 'deepseek',
    model: 'deepseek-chat',
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
  };
  const baseProfile = (settings.model_profiles || []).find((p) => p && p.provider === 'deepseek') || {};
  const profile = {
    ...baseProfile,
    schemaVersion: 1,
    id: preset.id,
    label: preset.label,
    provider: 'deepseek',
    protocol: 'openai-compatible',
    model: preset.model,
    defaultModel: preset.model,
    baseUrl: preset.baseUrl,
    credentialRef: `provider:${KEYCHAIN_ACCOUNT}`,
    capabilities: ['chat', 'streaming', 'tools'],
    roles: [],
    parameters: {},
  };
  settings.chat_model_presets = [...(settings.chat_model_presets || []), preset];
  settings.model_profiles = [
    ...(settings.model_profiles || []).filter((p) => p && p.id !== preset.id),
    profile,
  ];
  settings.active_chat_model_id = preset.id;
  // UI-523 实机腿踩点：渲染层真实生效值是 model_role_bindings.chat（优先于
  // active_chat_model_id）——只改后者会让 UI 继续用旧 preset、凭据查空。
  settings.model_role_bindings = { ...(settings.model_role_bindings || {}), chat: preset.id };
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2), { mode: 0o600 });

  let exitCode = 1;
  try {
    // 给后端一次 settings 签名刷新（getAiSettings 按文件签名重读，无需重启）
    await sleep(800);
    exitCode = execFileSync(
      process.execPath,
      [join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'run.cjs'), 'ui523-run-stats'],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DEV_VERIFY_TIMEOUT_MS: '180000' } },
    ) && 0;
  } catch (e) {
    exitCode = typeof e.status === 'number' ? e.status : 1;
  } finally {
    // ── ④ 还原 ──
    copyFileSync(BACKUP, SETTINGS);
    const afterHash = sha256(SETTINGS);
    if (afterHash !== beforeHash) {
      console.error('WARN: ai-settings 还原哈希不一致（请检查 ' + SETTINGS + '）');
      exitCode = 1;
    } else {
      // 还原成功即删备份，避免 dev 数据目录残留
      try { rmSync(BACKUP, { force: true }); } catch { /* 删除失败不判红 */ }
    }
    try {
      execFileSync('/usr/bin/security', ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE], { stdio: 'ignore' });
    } catch { /* 已不存在 */ }
    if (mock) mock.kill('SIGTERM');
    try {
      const check = execFileSync('/usr/bin/security', ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE], { stdio: 'ignore' });
      void check;
      console.error('WARN: 临时 keychain 凭据未删除');
      exitCode = 1;
    } catch { /* 预期：已删除 */ }
  }
  return exitCode;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
