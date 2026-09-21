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
            "description": "协作成员 ID（gpeer_ 开头，来自联邦协作成员列表）"
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
      "name": "run_tool",
      "description": "执行 BioF3 的分析工具，真实跑 R/Python 脚本出图出表（不是模拟）。\n六个操作：\n - op=list：不带 toolId 时列紧凑工具目录；带 toolId 时返回该工具完整参数契约。先列目录再精确查询，禁止猜测工具 ID\n - op=plan：按标准模板生成 Agent 主导的多步骤计划，只规划、不自动执行\n - op=status：从真实 tool jobs 和 artifact truth 重建计划状态\n - op=next：返回当前可执行步骤与恢复建议，不自动执行\n - op=bind_artifact：校验上一步 tool_job 的 artifact truth，并把真实产物绑定到下游输入\n - op=run：执行指定工具，传 toolId + params\n可用工具包括：deseq2（bulk 差异分析）、volcano-plot（火山图）、gene-correlation（基因相关性热图）、pca-explorer（PCA）等。\n用户说\"帮我跑差异分析\"/\"画火山图\"/\"做 DESeq2\"/\"分析这个 count 矩阵\"时使用。\n注意：file 类型参数传**本地绝对路径**（如 /Users/.../counts.csv）。执行返回 jobDir + 输出文件路径 + toolJobId，可读取出图/表。\nplan 联动：跑完返回 toolJobId，若当前在 plan 推进中，立刻调 plan(op=update_step, toolJobId=<返回的 toolJobId>) 绑定，分析状态（completed/failed）自动同步 step。\n自动化边界：完全访问模式下，deseq2/wgcna 等项目内可复现分析直接执行，由 Agent 检查结果并在安全范围内诊断重试，不弹二次确认。旧调用或非完全访问边界仍可能返回 {needApproval, ackToken}，此时必须遵守确认协议。",
      "parameters": {
        "type": "object",
        "properties": {
          "op": {
            "type": "string",
            "enum": [
              "list",
              "plan",
              "status",
              "next",
              "bind_artifact",
              "run"
            ],
            "description": "list 列工具；plan 生成计划；status 重建状态；next 给出下一步；bind_artifact 绑定已验证产物；run 执行工具"
          },
          "toolId": {
            "type": "string",
            "description": "op=run 用于执行；op=list 时用于读取单个工具完整契约。先用不带 toolId 的 list 获取真实 id"
          },
          "params": {
            "type": "object",
            "description": "op=run 用：工具参数对象。file 类型传本地绝对路径。具体参数见 op=list 返回的 inputSchema。"
          },
          "templateId": {
            "type": "string",
            "description": "op=plan 用：标准模板 id，可先通过 op=list 查看 workflowTemplates"
          },
          "initialInputs": {
            "type": "object",
            "description": "op=plan 用：第一步可直接使用的文件或参数；后续输入由 verified artifact lineage 绑定"
          },
          "workflowPlan": {
            "type": "object",
            "description": "status/next/bind_artifact 或 workflow step run 用：op=plan 返回并由 Agent 持续更新的计划对象"
          },
          "stepId": {
            "type": "string",
            "description": "workflow step run 用：执行前会从真实 jobs 重新投影，只有 ready 步骤可提交"
          },
          "fromToolJobId": {
            "type": "string",
            "description": "bind_artifact 用：产生上游 artifact 的真实 tool_job id"
          },
          "fromStepId": {
            "type": "string",
            "description": "bind_artifact 用：上游步骤 id"
          },
          "toStepId": {
            "type": "string",
            "description": "bind_artifact 用：下游步骤 id"
          },
          "inputId": {
            "type": "string",
            "description": "bind_artifact 用：下游参数名"
          },
          "artifactId": {
            "type": "string",
            "description": "bind_artifact 可选：指定 artifact id/name；省略时取首个已验证产物"
          },
          "ackToken": {
            "type": "string",
            "description": "兼容确认用：仅当 run_tool 返回 needApproval=true 时原样传回；完全访问模式的项目内分析通常不需要。"
          },
          "scientificTaskRef": {
            "type": "object",
            "description": "HRT-3 科学任务执行引用。存在时必须指向已确认且尚未绑定 Job 的 TaskSpec 版本。",
            "properties": {
              "taskId": {
                "type": "string"
              },
              "version": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "taskId"
            ]
          }
        },
        "required": [
          "op"
        ]
      }
    }
  }
];
