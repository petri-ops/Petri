/**
 * agent-tools/tool-defs/session.js — session 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "process_status",
      "description": "查询本会话通过 workspace_exec_background 启动的后台进程状态：存活/退出/停止、退出码、运行时长与日志尾部。不带 processId 时返回本会话全部后台进程；进程表为内存态，应用重启后失效（日志文件仍在，可手工查看）。",
      "parameters": {
        "type": "object",
        "properties": {
          "processId": {
            "type": "string",
            "description": "可选；workspace_exec_background 返回的进程 ID。省略时列出本会话全部后台进程"
          },
          "logTailBytes": {
            "type": "integer",
            "description": "日志尾部读取字节数，默认 4096，最大 65536"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "process_stop",
      "description": "停止本会话启动的后台进程：先 SIGTERM，宽限 3 秒后仍存活则 SIGKILL（Windows 使用 taskkill /T /F）。只能停止本工具启动的进程，不能按系统 pid 任意杀进程。",
      "parameters": {
        "type": "object",
        "properties": {
          "processId": {
            "type": "string",
            "description": "workspace_exec_background 返回的进程 ID"
          }
        },
        "required": [
          "processId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "system_info",
      "description": "获取当前系统与命令执行环境信息：操作系统与架构、shell 解释器、路径分隔符、Node/npm/Python/Git 版本等。只读、零副作用。在编写或执行任何平台相关命令（workspace_exec）之前先调用，避免跨平台命令语法错误；探测命令不存在时对应版本返回 null。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "plan",
      "description": "PLAN_TOOL_v1 — 持久化任务计划。当用户给出一个**多步骤的任务**（例如\"做完整的 PBMC 分析\"或\"对比两种方案\"）时，应当先创建一个 plan，再按步骤执行。Plan 跨会话保存，用户和 AI 都能看到推进进度。\n\n操作： create（创建新 plan，需要 title + steps[]；计划模式下必须传 draft=true + specMd）; update_step（更新某 step 的状态/结果）; update_spec（BLOCK-55：更新 draft 计划的 specMd 正文）; propose_revision（BLOCK-55：执行期提交修订案 steps[]，用户批准后替换）; list（列用户所有 plan）; get（按 id 获取详情）; pause / resume（暂停/恢复整个 plan）; complete / cancel（完成或取消 plan）。",
      "parameters": {
        "type": "object",
        "properties": {
          "op": {
            "type": "string",
            "enum": [
              "create",
              "update_step",
              "update_spec",
              "propose_revision",
              "list",
              "get",
              "pause",
              "resume",
              "complete",
              "cancel"
            ],
            "description": "操作类型"
          },
          "planId": {
            "type": "string",
            "description": "update_step / update_spec / propose_revision / get / pause / resume / complete / cancel 用"
          },
          "title": {
            "type": "string",
            "description": "create 用：plan 简短标题（一句话）"
          },
          "goal": {
            "type": "string",
            "description": "create 用：plan 的最终目标（详细描述）"
          },
          "draft": {
            "type": "boolean",
            "description": "create 用：计划模式（Spec 门）下必须传 true，创建 draft 态计划等待用户批准"
          },
          "specMd": {
            "type": "string",
            "description": "create/update_spec 用：计划正文 Markdown，必须自包含——目标与边界、每步做什么用什么工具、验收标准（批准后可能仅凭它在全新上下文执行）"
          },
          "steps": {
            "type": "array",
            "description": "create / propose_revision 用：步骤数组，每步 {n, title, hint?, assignee?}。建议 3-8 步",
            "items": {
              "type": "object",
              "properties": {
                "n": {
                  "type": "integer"
                },
                "title": {
                  "type": "string"
                },
                "hint": {
                  "type": "string",
                  "description": "可选：执行此步的提示或参数建议"
                },
                "assignee": {
                  "type": "string",
                  "enum": [
                    "subagent"
                  ],
                  "description": "可选：填 \"subagent\" 表示该步骤派子智能体独立执行（BLOCK-55 P2）"
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "pending",
                    "done",
                    "skipped"
                  ],
                  "description": "仅 propose_revision 用：修订案中已完成步骤保留 done 以延续进度"
                },
                "result": {
                  "type": "string",
                  "description": "仅 propose_revision 用：已完成步骤的结果引用"
                }
              }
            }
          },
          "reason": {
            "type": "string",
            "description": "propose_revision 用：为什么要修订（失败了什么、偏离了什么）"
          },
          "stepN": {
            "type": "integer",
            "description": "update_step 用：步骤序号（从 1 开始）"
          },
          "stepStatus": {
            "type": "string",
            "enum": [
              "pending",
              "running",
              "done",
              "failed",
              "skipped"
            ],
            "description": "update_step 用：步骤新状态"
          },
          "stepResult": {
            "type": "string",
            "description": "update_step 用：步骤结果摘要（done 时建议填）"
          },
          "chatExcerpt": {
            "type": "string",
            "description": "create 用（可选）：触发该计划的用户原话片段（≤ 200 字），用于以后回顾\"当时为什么定这个计划\"。"
          },
          "analysisId": {
            "type": "string",
            "description": "PLAN_STEP_LINK_v1_TOOL — update_step 用：把当前 step 关联到已有 analysis id，使其状态变化同步到步骤。"
          },
          "toolJobId": {
            "type": "string",
            "description": "PLAN_TOOL_JOB_LINK_v1 — update_step 用：把当前 step 关联到某个 tool_job id（bulk 工具，方案 C）。当你 run_tool 后立刻在该步骤调用 plan(update_step, toolJobId=<返回的 toolJobId>) 绑定。tool_jobs 状态 completed/failed 会自动同步 step status。"
          }
        },
        "required": [
          "op"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "todo_write",
      "description": "任务清单维护——把多步任务拆成编号清单并在执行中实时勾选，清单会显示在会话摘要卡中供用户查看进度。\n使用纪律：\n- 接到多步任务（约 ≥3 步）时先用本工具写清单再开工；简单问答不用。\n- 每条 content 用一句话可验证的动词短语（如「跑通登录冒烟测试」），不塞实现细节。\n- 开工某条前将其置 in_progress，完成立即置 completed；计划变化时整单重发（增删改条目）。\n- 整单幂等替换：每次调用都提交完整清单（1-20 条），按执行顺序排列。",
      "parameters": {
        "type": "object",
        "properties": {
          "items": {
            "type": "array",
            "description": "完整清单（整单替换）",
            "minItems": 1,
            "maxItems": 20,
            "items": {
              "type": "object",
              "properties": {
                "content": {
                  "type": "string",
                  "description": "一句话条目（≤300 字符）"
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "pending",
                    "in_progress",
                    "completed"
                  ],
                  "description": "pending=未开始 / in_progress=进行中 / completed=已完成"
                }
              },
              "required": [
                "content",
                "status"
              ]
            }
          }
        },
        "required": [
          "items"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "verify_state",
      "description": "VERIFY_STATE_v1 — 确认某个实体的当前状态符合预期。在执行写操作后调用此工具核实，避免在没有真实反馈时声称\"已完成\"。 例如：act(rename_project) 后 verify_state(kind=\"project\", id=<id>, expect={name:<新名>}); act(switch_result_tab) 后 verify_state(kind=\"context\", expect={page:\"single-cell-result\"})。",
      "parameters": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "analysis",
              "project",
              "dataset",
              "plan",
              "plan_step",
              "context"
            ],
            "description": "实体类型"
          },
          "id": {
            "type": "string",
            "description": "kind 为 analysis/project/dataset/plan 时的 id"
          },
          "planId": {
            "type": "string",
            "description": "kind=plan_step 时的 plan id"
          },
          "stepN": {
            "type": "integer",
            "description": "kind=plan_step 时的步骤序号"
          },
          "expect": {
            "type": "object",
            "description": "预期字段值，例如 {status:\"running\"} 或 {name:\"foo\"}。"
          }
        },
        "required": [
          "kind"
        ]
      }
    }
  }
];
