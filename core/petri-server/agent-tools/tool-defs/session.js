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
  },
  {
    "type": "function",
    "function": {
      "name": "decision_summary",
      "description": "查看决策系统的按接点聚合统计（最近 N 天：调用量/平均延迟/降级率/最近判定时间）。只读观测面：用于了解各决策接点（意图路由/工具预路由/汇报门等）的运行情况。不提供任何修改配置的能力。",
      "parameters": {
        "type": "object",
        "properties": {
          "days": {
            "type": "number",
            "description": "可选，统计窗口天数（1-90，默认 7）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "decision_recent",
      "description": "逐条回放最近的决策判定记录（判定值/置信度/阈值/是否降级/耗时），可按接点过滤。只读观测面：用于核对某类决策（如 intent-route/report-guard）最近的判定形态。不提供任何修改配置的能力。",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "number",
            "description": "可选，返回条数（1-20，默认 10）"
          },
          "point": {
            "type": "string",
            "description": "可选，按接点过滤（如 intent-route / tool-route / report-guard / output-judge）"
          }
        }
      }
    }
  }
,
  {
    "type": "function",
    "function": {
      "name": "run_tool",
      "description": "执行 Petri 的分析工具，真实跑 R/Python 脚本出图出表（不是模拟）。\n六个操作：\n - op=list：不带 toolId 时列紧凑工具目录；带 toolId 时返回该工具完整参数契约。先列目录再精确查询，禁止猜测工具 ID\n - op=plan：按标准模板生成 Agent 主导的多步骤计划，只规划、不自动执行\n - op=status：从真实 tool jobs 和 artifact truth 重建计划状态\n - op=next：返回当前可执行步骤与恢复建议，不自动执行\n - op=bind_artifact：校验上一步 tool_job 的 artifact truth，并把真实产物绑定到下游输入\n - op=run：执行指定工具，传 toolId + params\n可用工具包括：deseq2（bulk 差异分析）、volcano-plot（火山图）、gene-correlation（基因相关性热图）、pca-explorer（PCA）等。\n用户说\"帮我跑差异分析\"/\"画火山图\"/\"做 DESeq2\"/\"分析这个 count 矩阵\"时使用。\n注意：file 类型参数传**本地绝对路径**（如 /Users/.../counts.csv）。执行返回 jobDir + 输出文件路径 + toolJobId，可读取出图/表。\nplan 联动：跑完返回 toolJobId，若当前在 plan 推进中，立刻调 plan(op=update_step, toolJobId=<返回的 toolJobId>) 绑定，分析状态（completed/failed）自动同步 step。\n自动化边界：完全访问模式下，deseq2/wgcna 等项目内可复现分析直接执行，由 Agent 检查结果并在安全范围内诊断重试，不弹二次确认。旧调用或非完全访问边界仍可能返回 {needApproval, ackToken}，此时必须遵守确认协议。",
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
  },
  {
    "type": "function",
    "function": {
      "name": "result_summary",
      "description": "按 toolJobId 有界读取一次分析结果的真实内容：任务状态 + artifact truth（可信/需复核/阻断）+ 关键统计（如总基因/显著/上调/下调）+ 产物清单 + 主表前几行真值。用户追问「这个结果说明了什么/差异基因有哪些/数字是多少」而结果不是本轮刚跑出时，先调本工具读真值再回答；禁止凭记忆或猜测报告数字。输出有界（产物 ≤20、列 ≤8、行 ≤6），不整表倾倒。",
      "parameters": {
        "type": "object",
        "properties": {
          "toolJobId": {
            "type": "string",
            "description": "run_tool 返回的 toolJobId（如 tj_xxx）；会话历史里有就传它"
          }
        },
        "required": [
          "toolJobId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "codegraph_who_imports",
      "description": "查询当前项目里「哪些文件导入了指定符号」的静态引用关系（AST 级：ESM import / require / 动态 import / 命名空间全识别）。每处引用带使用三态：USED_PROD（生产代码在用）/ USED_TEST（仅测试在用）/ UNUSED（导入但未用）。改函数/改签名/删导出前先用它判影响面；「仅测试在用」意味着改动要同步动测试。诚实边界：变量形式动态 require、字符串拼接路径在静态盲区（如实报 UNRESOLVED 不猜测），零命中≠绝对无人引用，删除裁决需复核。项目源文件超 5000 个时拒绝建图并如实返回文件数。",
      "parameters": {
        "type": "object",
        "properties": {
          "symbol": {
            "type": "string",
            "description": "要查询的导出符号名（如函数名/常量名，精确匹配非模糊）"
          }
        },
        "required": [
          "symbol"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "codegraph_classify_edges",
      "description": "对项目内一个文件做依赖盘点：出边（它 import 了谁、各符号是否真实使用）+ 每个导出的入边分类（USED_PROD / USED_TEST / DEAD=静态无已解析使用）。重构/清理单文件前先盘它。DEAD≠可安全删除：动态消费方在静态盲区查不到，删除仍需复核。输出有界（导出 ≤150、出边 ≤60，截断带标记）。",
      "parameters": {
        "type": "object",
        "properties": {
          "file": {
            "type": "string",
            "description": "项目内相对路径（如 src/lib.ts），不允许越出项目根"
          }
        },
        "required": [
          "file"
        ]
      }
    }
  }
];
