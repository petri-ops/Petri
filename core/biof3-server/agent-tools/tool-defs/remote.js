/**
 * agent-tools/tool-defs/remote.js — remote 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "delegate_to_gewu_node",
      "description": "BLOCK-85/88 格物联邦委托：把一段工作委托给协作成员（另一台电脑上的格物）的 AI agent 独立执行。对方 agent 在它自己的机器与环境里干活，本工具等待其完成后返回执行回执（状态 + 对方 agent 的回复摘要）。涉及对方项目文件/分析的任务需带 projectId（仅限宿主已授权项目；未带时回执会附 grantedProjects 清单，越权会被诚实拒绝）；纯问答类可不带。普通分析任务优先用 run_tool（本机执行）。委托最长等待约 10 分钟（可调 1-30）。",
      "parameters": {
        "type": "object",
        "properties": {
          "peerId": {
            "type": "string",
            "description": "协作成员 ID（gpeer_ 开头，来自 federation_list_peers 查询结果）"
          },
          "task": {
            "type": "string",
            "description": "要委托给对方 agent 的工作描述（写清楚目的与期望产出，对方的 AI 会自主执行）"
          },
          "projectId": {
            "type": "string",
            "description": "对端项目 ID（可选；仅限宿主已授权项目——未授权会被 403 诚实拒绝；未带时回执附 grantedProjects 清单）"
          },
          "timeoutMinutes": {
            "type": "integer",
            "description": "最长等待分钟数，默认 10，范围 1-30"
          }
        },
        "required": [
          "peerId",
          "task"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "federation_list_peers",
      "description": "BLOCK-164 W1 格物联邦节点清单：列出已配对的协作节点（名称/工程师署名/在线态/对端授权给本机的项目）与本机授权概览。委托前必查——delegate_to_gewu_node 所需的 peerId 与可选 projectId 都从这里取，不要让用户提供 gpeer_* ID。",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  }
];
