/**
 * agent-tools/tool-defs/agent-orchestration.js — agent-orchestration 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "interrupt_agent",
      "description": "中断一个仍在运行的子 agent（当前任务派生的）：发出取消请求，子 agent 在下一个取消检查点让出，之后用 wait_agent 可拿到其终态摘要。已终态的子 agent 幂等返回。",
      "parameters": {
        "type": "object",
        "properties": {
          "agentId": {
            "type": "string",
            "description": "list_agents/spawn_agent 返回的子 agent ID"
          }
        },
        "required": [
          "agentId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "send_message",
      "description": "向自己的一个子 agent 投递父消息（持久化到其事件流）。运行中的子 agent 会在下一个模型请求边界实时看到（前缀「父智能体消息」），可用来中途纠偏、补充约束；未被消费的消息仍会随 followup_task 续派注入。已终态的子 agent 会报错——此时应改用 followup_task。",
      "parameters": {
        "type": "object",
        "properties": {
          "agentId": {
            "type": "string"
          },
          "message": {
            "type": "string",
            "description": "要投递的消息内容"
          }
        },
        "required": [
          "agentId",
          "message"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "followup_task",
      "description": "对一个已终态（完成/失败/取消）的子 agent 追加任务：以前次任务摘要 + 期间收到的父消息为上下文，续派一个新子 agent（模型/权限继承链与 spawn_agent 一致）。子 agent 仍在运行时会被拒绝——可先 interrupt_agent。",
      "parameters": {
        "type": "object",
        "properties": {
          "agentId": {
            "type": "string",
            "description": "要续派的子 agent ID（须已终态）"
          },
          "task": {
            "type": "string",
            "description": "追加的子任务描述"
          },
          "goals": {
            "type": "array",
            "items": { "type": "string" },
            "maxItems": 5,
            "description": "可选，新的可核对目标清单（1-5 条）；不传则继承原子智能体的 goals"
          },
          "todoRefs": {
            "type": "array",
            "items": { "type": "string" },
            "maxItems": 5,
            "description": "可选，新的任务清单条目归属（清单条目 id，≤5 条）；不传则继承原子智能体的 todoRefs"
          },
          "model": {
            "type": "string",
            "description": "可选：指定模型 preset（默认继承父）"
          }
        },
        "required": [
          "agentId",
          "task"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "spawn_agent",
      "description": "派生一个子智能体异步执行独立子任务。子智能体拥有自己的思考和工具调用能力，权限与当前会话一致（继承只读/项目写/完全访问），完成后用 wait_agent 获取结果摘要。适合可并行的独立子任务（如分别分析多个文件、分别跑多个校验）。子 agent 不能再派生子 agent。可用 role 指定专职角色（检索/搜集/整理/读取/分析/测试/写作/规划/修复等，注入对应职责指令）；未指定时按任务内容自动推断。汇报契约：task 文本应要求子智能体只回传其所辖部分的核对要点/事实/结论（要点式，不要全面重整理）；全部相关子任务终态后由你做一次统一汇总——子智能体摘要会自动汇入「阶段汇总」结果卡，不要在正文中逐个转述。",
      "parameters": {
        "type": "object",
        "properties": {
          "task": {
            "type": "string",
            "description": "子智能体要完成的任务描述，应清晰、自包含（子 agent 看不到当前对话历史）"
          },
          "role": {
            "type": "string",
            "enum": [
              "search",
              "collect",
              "organize",
              "read",
              "analysis",
              "general",
              "test",
              "write",
              "plan",
              "fix",
              "investigator"
            ],
            "description": "可选，子智能体的专职角色：search=检索 collect=搜集 organize=整理 read=读取 analysis=分析 general=通用 test=测试 write=写作 plan=规划 fix=修复 investigator=代码库调查员（注入对应职责指令，软约束）"
          },
          "profile": {
            "type": "string",
            "description": "可选，子智能体 profile 名（声明式缺省：role/model/并发/tools.allow·deny）；未配置 profile 或省略时走原路径"
          },
          "schema": {
            "type": "object",
            "description": "可选，结构化输出 JSON Schema（最小子集：type/required/properties/items/enum/additionalProperties/minimum/maximum）。终态正文必须是符合该 schema 的 JSON；校验失败自动纠正重试（≤2 次），仍失败如实回错误清单"
          },
          "model": {
            "type": "string",
            "description": "可选，子智能体使用的模型（须是已配置的模型 preset 的 model 或 id）；默认继承当前会话模型"
          },
          "instructions": {
            "type": "string",
            "description": "可选，对子智能体的额外约束或指导（如输出格式、边界）"
          },
          "goals": {
            "type": "array",
            "items": { "type": "string" },
            "maxItems": 5,
            "description": "可选，可核对的目标清单（1-5 条、每条一句话）：随任务书作为完成判据下发给子智能体，其终态汇报将逐目标核对完备性，未达成会在汇报门判词中点名"
          },
          "todoRefs": {
            "type": "array",
            "items": { "type": "string" },
            "maxItems": 5,
            "description": "可选，本子任务对应的任务清单条目 id（最近一次 todo_write 清单中的 id，≤5 条）：终态对账按此归属——若本子任务失败/被取消而其对应清单条目仍标记完成，条目会被点名请核对"
          }
        },
        "required": [
          "task"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_agent_journal",
      "description": "读取当前多代理运行的 journal：一行一个子智能体终态（血缘/角色/状态/耗时/结果头/结构化有效性）。**诊断多代理运行前先读它**；journal 是诊断摘要，事件真相仍看时间线（task_events）。只能读当前运行（子代理读所属 leader 的运行）。",
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "type": "integer",
            "description": "最多返回行数（默认 50，上限 200）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "list_agents",
      "description": "列出当前会话派生的全部子智能体及其状态（running/done/failed/cancelled）。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "wait_agent",
      "description": "等待指定子智能体结束并返回结果摘要（阻塞调用）。摘要含最终回复正文（受 token 预算截断）、改动文件清单与失败原因。超时不会终止子智能体，可稍后重试。",
      "parameters": {
        "type": "object",
        "properties": {
          "agentId": {
            "type": "string",
            "description": "spawn_agent 返回的 agentId"
          },
          "timeout": {
            "type": "integer",
            "description": "超时毫秒数，默认 300000（5 分钟），上限 600000"
          }
        },
        "required": [
          "agentId"
        ]
      }
    }
  }
];
