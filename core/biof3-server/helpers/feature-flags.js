'use strict';

/**
 * helpers/feature-flags.js — 灰度功能开关单一真相（2026-09-18 用户裁决「翻默认+设置页开关」）
 *
 * 管辖三个已实机验证的灰度开关（BLOCK-95 B1/B2 + BLOCK-98 M1-M3）：
 *   server_history_assembly  BIOF3_SERVER_HISTORY_ASSEMBLY  B1 历史拼装收归后端
 *   session_compaction       BIOF3_SESSION_COMPACTION       B2 会话级压缩（依赖 B1）
 *   agent_resilience         BIOF3_AGENT_RESILIENCE         长任务韧性（microcompact/熔断/重试）
 *
 * 解析优先级（高→低）：
 *   1. 环境变量强制覆盖：=1/true 强制开，=0/false 强制关（kill-switch，杀进程级回滚）
 *   2. 设置页持久化选择：<dataDir>/feature-flags.json（仅存用户显式改动，删 key 即回默认）
 *   3. 默认值：全部 true（2026-09-18 裁决；此前灰度期默认关）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE_FILENAME = 'feature-flags.json';

const FLAG_DEFAULTS = Object.freeze({
  server_history_assembly: true,
  session_compaction: true,
  agent_resilience: true,
});

const FLAG_META = Object.freeze({
  server_history_assembly: {
    env: 'BIOF3_SERVER_HISTORY_ASSEMBLY',
    label: '会话历史后端拼装（B1）',
    description: 'LLM 请求历史由数据库拼装（与对话记录同源），替代前端每轮全量上报。',
  },
  session_compaction: {
    env: 'BIOF3_SESSION_COMPACTION',
    label: '长会话自动压缩（B2）',
    description: '超过阈值的历史轮次折叠为摘要参与模型视图，显著节省 token；数据库原文永不改动，压缩诚实可见。',
  },
  agent_resilience: {
    env: 'BIOF3_AGENT_RESILIENCE',
    label: 'Agent 长任务韧性',
    description: '长任务自动清理旧工具结果（microcompact）、连续失败熔断、上下文超限原地重试。',
  },
});

function flagStorePath() {
  const root = process.env.BIOF3_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'BioF3-Local');
  return path.join(root, STORE_FILENAME);
}

/** 读持久化选择（文件缺失/损坏 = 空选择，全走默认）。 */
function readStore() {
  try {
    const raw = fs.readFileSync(flagStorePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.flags === 'object' && parsed.flags ? parsed.flags : {};
  } catch {
    return {};
  }
}

function writeStore(flags) {
  const clean = {};
  for (const key of Object.keys(FLAG_DEFAULTS)) {
    if (typeof flags[key] === 'boolean') clean[key] = flags[key];
  }
  const dir = path.dirname(flagStorePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(flagStorePath(), JSON.stringify({ flags: clean, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  return clean;
}

/**
 * 单开关解析：env 强制覆盖 > 持久化选择 > 默认值。
 * @param {keyof typeof FLAG_DEFAULTS} key
 * @param {object|undefined} env 可注入供测试（缺省 process.env）
 */
function resolveFlag(key, env = process.env) {
  const meta = FLAG_META[key];
  if (!meta) throw new Error(`feature_flag_unknown:${key}`);
  const raw = (env && env[meta.env]) || '';
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  const stored = readStore()[key];
  if (typeof stored === 'boolean') return stored;
  return FLAG_DEFAULTS[key];
}

/** 全量快照（设置页投影用）：key → { enabled, envOverride, default } */
function getFlagsSnapshot(env = process.env) {
  const store = readStore();
  const flags = {};
  for (const key of Object.keys(FLAG_DEFAULTS)) {
    const meta = FLAG_META[key];
    const raw = (env && env[meta.env]) || '';
    const envOverride = raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : null;
    const stored = typeof store[key] === 'boolean' ? store[key] : null;
    const enabled = envOverride != null ? envOverride : stored != null ? stored : FLAG_DEFAULTS[key];
    flags[key] = {
      enabled,
      envOverride,
      stored,
      default: FLAG_DEFAULTS[key],
      env: meta.env,
      label: meta.label,
      description: meta.description,
    };
  }
  return flags;
}

/** 设置页写入：仅接受三把已知开关；写持久化选择（env 强制覆盖时 UI 诚实标注不可写）。 */
function setFlag(key, enabled) {
  if (!(key in FLAG_DEFAULTS)) throw new Error(`feature_flag_unknown:${key}`);
  if (typeof enabled !== 'boolean') throw new Error('feature_flag_value_invalid');
  const store = readStore();
  store[key] = enabled;
  return writeStore(store);
}

module.exports = {
  FLAG_DEFAULTS,
  FLAG_META,
  STORE_FILENAME,
  flagStorePath,
  readStore,
  writeStore,
  resolveFlag,
  getFlagsSnapshot,
  setFlag,
};
