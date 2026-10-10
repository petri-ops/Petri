/**
 * agent-tools/tool-defs/resident.js — resident 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "resident_task_create",
      "description": "BLOCK-77 驻留任务创建：后台启动长时命令（复用 workspace_exec_background 通道）并在项目 .petri/resident/ 一次成型落盘「意图卡」（taskId/意图/成功标准/失败处置/backing pid/日志路径/状态机）。意图卡是跨会话交接班凭据：软件重开后可经 resident_task_list/read 读取续接。软件关闭不影响已在服务器/本机 detached 运行的进程。需完全访问模式。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "要挂机后台执行的 shell 命令（长时运行，如训练/流水线/服务）"
          },
          "intent": {
            "type": "string",
            "description": "意图卡核心字段：这个任务在干什么（一句话，写清楚目的与产出物位置）"
          },
          "success_criteria": {
            "type": "string",
            "description": "成功标准：怎样算完成（如退出码 0 且 results/ 下有输出）"
          },
          "failure_handling": {
            "type": "string",
            "description": "失败处置预案：失败时留什么/做什么（仅记录，回访循环不会自动重启）"
          },
          "cwd": {
            "type": "string",
            "description": "相对项目根目录的工作子目录（可选，必须已存在）"
          }
        },
        "required": [
          "command",
          "intent"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "resident_task_list",
      "description": "列出本项目全部驻留任务意图卡（.petri/resident/*.json，按创建时间倒序）。用于交接班：重开软件/新会话先读清单，了解有哪些挂机任务、各自意图与状态。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "resident_task_read",
      "description": "读取单张驻留任务意图卡全文（intent/成功标准/失败处置/backing pid/日志路径/状态/最近回访记录）。",
      "parameters": {
        "type": "object",
        "properties": {
          "taskId": {
            "type": "string",
            "description": "resident_task_list 返回的 taskId"
          }
        },
        "required": [
          "taskId"
        ]
      }
    }
  }
];
