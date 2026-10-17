/**
 * scripts/lib/harness/judge-supply.mjs — judge 供给装载单源（BLOCK-119 抽出 · BLOCK-194 复用）。
 *
 * 为什么是单源：'output-judge' 阈值的配对语料校准**绑死模型 jev-1.13.0**（decision-thresholds
 * 注册表里就写着这个 model），换供给=换校准。所以任何要调 judge 的地方（dev CLI、评测层）都必须
 * 走同一份供给解析，而不是各读各的 env 文件。
 * 本模块只做 IO 与解析：不 exit、不打印密钥内容（取不到就返回 null，降级语义归调用方）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeOutput } from './judge-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENV_FILE = path.join('.petri-dev-user-data', 'jev.env.bak-by-user-request');
const DEV_DB = path.join('.petri-dev-user-data', 'data', 'petri.db');
const JUDGE_MODEL_PIN = 'jev-1.13.0';
const JUDGE_BASE_URL = 'https://api.typesafe.ai';
const KEY_LINE = /^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/;

/** 从 dev 备份 env 取密钥（逐行匹配，绝不回显值）。 */
export function readCloudApiKey({ root = ROOT, file = ENV_FILE } = {}) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
  let apiKey = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(KEY_LINE);
    if (m) apiKey = m[1].replace(/^['"]|['"]$/g, '');
  }
  return apiKey || null;
}

/** decision-api 的 overrides 形状（apiKey 之外都是非敏感固定值）。取不到返回 null。 */
export function resolveCloudJudgeOverrides(options = {}) {
  const apiKey = readCloudApiKey(options);
  if (!apiKey) return null;
  return { apiKey, baseUrl: JUDGE_BASE_URL, model: JUDGE_MODEL_PIN };
}

/**
 * 把决策台账锚到 dev 库（裸 shell 下防 best-effort 记账静默丢失，也防开发工具把行写进
 * 用户真实数据目录）。已显式设置 PETRI_DB_PATH 时不动。
 */
export function anchorJudgeDecisionDb({ root = ROOT, env = process.env } = {}) {
  if (env.PETRI_DB_PATH) return false;
  const candidate = path.join(root, DEV_DB);
  if (!fs.existsSync(candidate)) return false;
  env.PETRI_DB_PATH = candidate;
  return true;
}

/** 绑好供给的 judge 调用器：每次调用时再解析（便于 env/文件变化即时生效）。 */
export function makeSuppliedJudge({ root = ROOT } = {}) {
  return async function judge(input) {
    anchorJudgeDecisionDb({ root });
    const overrides = resolveCloudJudgeOverrides({ root }) || {};
    return judgeOutput({ ...input, overrides });
  };
}
