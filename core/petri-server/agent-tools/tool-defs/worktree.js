/**
 * agent-tools/tool-defs/worktree.js — worktree 域工具 Schema（BLOCK-336 P1；物理目录即域）。
 * 由 tool-defs.js facade 汇编，勿直接 require。执行元数据见 ../tool-metadata.js；
 * 纪律翻译见 ../../helpers/worktree-contract.js 与 docs/worktree-governance.md。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "workspace_worktree_create",
      "description": "为当前项目的 git 仓创建一个隔离 worktree（独立目录 + 分支），用于并行任务或大胆实验。一分支一 worktree、一 Agent 一 worktree、一包一 worktree；目录由系统约定，不可指定。",
      "parameters": {
        "type": "object",
        "properties": {
          "branch": { "type": "string", "description": "分支名（不存在则基于 baseRef 新建；已存在则直接检出）" },
          "baseRef": { "type": "string", "description": "新建分支的起点，默认 HEAD" },
          "packageId": { "type": "string", "description": "绑定的工作包 id（如 BLOCK-335），同一包只允许一个活动 worktree" },
          "note": { "type": "string", "description": "用途说明（≤300 字）" }
        },
        "required": ["branch"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_worktree_list",
      "description": "列出当前项目登记在册的活动 worktree，并对账实时 git 状态：目录是否仍在、是否脏树（改动/未跟踪文件）、相对 baseRef 的 ahead/behind、是否仍被 git 认领。",
      "parameters": { "type": "object", "properties": {} }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_worktree_remove",
      "description": "移除一个 worktree 目录（分支保留）。前置：登记在册、目录存在、工作树干净；有未合并提交时拒绝，除非显式 allowUnmergedAhead=true。不使用 --force，脏树会列出文件后拒绝。",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "worktree 登记 id（与 branch 二选一）" },
          "branch": { "type": "string", "description": "分支名（与 id 二选一）" },
          "allowUnmergedAhead": { "type": "boolean", "description": "明确表示：分支有未合并提交也只删目录（分支仍保留）。默认 false" }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_worktree_merge_request",
      "description": "为一个 worktree 分支生成评审摘要：相对 baseRef 的 ahead/behind、提交列表、diff --stat、文件状态、工作树是否脏。只出摘要并留痕，不执行 merge（合并由人工在评审后进行）。",
      "parameters": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "worktree 登记 id（与 branch 二选一）" },
          "branch": { "type": "string", "description": "分支名（与 id 二选一）" },
          "baseRef": { "type": "string", "description": "比较基线，默认创建时的 baseRef" }
        }
      }
    }
  }
];
