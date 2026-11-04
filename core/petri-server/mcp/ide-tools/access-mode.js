'use strict';

/**
 * core/petri-server/mcp/ide-tools/access-mode.js — BLOCK-346 T5 追加（IDE MCP 档位）。
 *
 * 背景：MCP 的调用方是外部 IDE（Cursor / VSCode 插件），没有 Petri 侧的
 * `accessMode` 会话概念，所以此前 ide_* 工具完全不受档位约束。真正的协议级
 * 档位协商（MCP 握手期带 accessMode）属协议层改造，短期不可行。
 *
 * 本模块提供**进程级档位**作为过渡：
 *   PETRI_IDE_MCP_ACCESS_MODE = read | workspace-write | full（默认 workspace-write）
 *
 * 语义与 agent 侧一致：
 *   read             —— 只允许只读工具（sideEffect === 'none'）
 *   workspace-write  —— 允许只读 + 工作区写（workspace-write），拒执行类（execution）
 *   full             —— 全允许
 *
 * 默认取 workspace-write：终端写（execution）需显式放开，避免外部 IDE 默认就能
 * 在用户机器上执行任意命令。被拒时返回明确 message 告知如何放开，不静默失败。
 */

const MODES = Object.freeze(['read', 'workspace-write', 'full']);
const DEFAULT_MODE = 'workspace-write';

/** 当前生效档位（非法值回落默认并保留原因，供诊断）。 */
function resolveIdeAccessMode(env = process.env) {
  const raw = String((env && env.PETRI_IDE_MCP_ACCESS_MODE) || '').trim().toLowerCase();
  if (!raw) return { mode: DEFAULT_MODE, source: 'default' };
  if (MODES.includes(raw)) return { mode: raw, source: 'env' };
  return { mode: DEFAULT_MODE, source: `env_invalid:${raw}` };
}

/** sideEffect → 所需最低档位。 */
const REQUIRED_MODE_BY_SIDE_EFFECT = Object.freeze({
  none: 'read',
  'workspace-write': 'workspace-write',
  execution: 'full',
});

const RANK = Object.freeze({ read: 0, 'workspace-write': 1, full: 2 });

/**
 * 判定某契约在给定档位下是否放行。
 * @returns {{ allowed: boolean, requiredMode: string|null }}
 */
function isAllowed(mode, contract) {
  if (!contract) return { allowed: true, requiredMode: null };
  const requiredMode = REQUIRED_MODE_BY_SIDE_EFFECT[contract.sideEffect] || 'full';
  const have = RANK[mode] ?? RANK[DEFAULT_MODE];
  const need = RANK[requiredMode] ?? RANK.full;
  return { allowed: have >= need, requiredMode };
}

/** 生成拒绝信封（含可操作提示，便于外部 IDE 读取）。 */
function denyEnvelope(name, mode, requiredMode) {
  return {
    ok: false,
    error: 'policy_denied',
    toolId: name,
    accessMode: mode,
    requiredMode,
    message: `${name} 需要 ${requiredMode} 档，当前 IDE MCP 档位为 ${mode}；设置环境变量 PETRI_IDE_MCP_ACCESS_MODE=${requiredMode} 后重启 Petri。`,
  };
}

module.exports = { MODES, DEFAULT_MODE, resolveIdeAccessMode, isAllowed, denyEnvelope, REQUIRED_MODE_BY_SIDE_EFFECT };
