/**
 * scripts/lib/jev-cloud-supply.mjs — Jev 云供给读取（dev 工具共用）。
 *
 * 唯一来源：`.petri-dev-user-data/jev.env.bak-by-user-request`（用户裁决的本地备份 env，
 * 只读；值不回显、不落日志）。block118 test/doc suggest 与 next-work-suggest 共用本模块，
 * 避免第二份 key 路径知识。
 */
import fs from 'node:fs';
import path from 'node:path';

export const JEV_ENV_BASENAME = 'jev.env.bak-by-user-request';

/** @returns {{overrides?: {apiKey:string, baseUrl:string, model:string}, error?: string}} */
export function cloudOverrides(rootDir) {
  const envFile = path.join(rootDir, '.petri-dev-user-data', JEV_ENV_BASENAME);
  let raw = '';
  try {
    raw = fs.readFileSync(envFile, 'utf8');
  } catch {
    return { error: `cloud 供给不可用：读不到 ${path.relative(rootDir, envFile)}` };
  }
  let apiKey = null;
  let baseUrl = null;
  let model = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(TYPESAFE_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (m[1] === 'TYPESAFE_API_KEY') apiKey = value;
    else if (m[1] === 'TYPESAFE_BASE_URL') baseUrl = value;
    else if (m[1] === 'TYPESAFE_MODEL') model = value;
  }
  if (!apiKey) return { error: 'cloud 供给不可用：备份 env 文件无 TYPESAFE_API_KEY' };
  return { overrides: { apiKey, baseUrl: baseUrl || 'https://api.typesafe.ai', model: model || 'jev-1.13.0' } };
}
