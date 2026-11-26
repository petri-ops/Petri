/**
 * Ark 凭据读取链（owner msg_eaf80d3ebd08：与 DeepSeek 同位 provider 条目）。
 *
 * 链路：ai-settings.model_profiles[id='ark-creative'].credentialRef === 'provider:ark'
 *   → credential-store 的 ark provider 条目（本机 file/keychain，与 DeepSeek 同机制同文件）
 *   → 插件 deps.apiKey 注入。
 * 不把 key 写入 ai-settings 明文、不经聊天、不入库；新仓零依赖（纯 Node fs/path/os）。
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROFILE_ID = 'ark-creative';
const CREDENTIAL_REF = 'provider:ark';

function resolveSettingsDir() {
  return process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
}

/** 返回 Ark 凭据描述符（不返回 key 值本身除非 includeKey=true）。 */
function resolveArkCredential({ settingsDir = resolveSettingsDir(), includeKey = false } = {}) {
  const settingsPath = path.join(settingsDir, 'ai-settings.json');
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return { ok: false, error: 'settings_unreadable' }; }
  const profile = (settings.model_profiles || []).find((p) => p.id === PROFILE_ID);
  if (!profile) return { ok: false, error: 'ark_profile_missing' };
  if (profile.credentialRef !== CREDENTIAL_REF) return { ok: false, error: 'credential_ref_mismatch' };

  const out = {
    ok: true,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl,
    credentialRef: profile.credentialRef,
    backend: settings.credential_backend || 'unknown',
    configured: !!(settings.credential_status && settings.credential_status.ark),
  };

  if (includeKey) {
    // file backend：ai-credentials.json 内 provider:ark → enc:v1 密文（由主仓 credential-store 解密）；
    // 本薄脚本只读 env 形态（宿主已注入 ARK_API_KEY 时直返），不自行解密、不落明文。
    if (process.env.ARK_API_KEY) out.apiKey = process.env.ARK_API_KEY;
    else out.apiKey = null;
  }
  return out;
}

module.exports = { resolveArkCredential, PROFILE_ID, CREDENTIAL_REF };
