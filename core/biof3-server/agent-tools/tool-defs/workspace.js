/**
 * agent-tools/tool-defs/workspace.js — workspace 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "workspace_list",
      "description": "列出当前 BioF3 项目工作区中的目录内容。路径必须是相对项目根目录的路径；不会返回符号链接或默认隐藏文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对项目根目录的目录，默认 \".\""
          },
          "includeHidden": {
            "type": "boolean",
            "description": "是否包含普通隐藏文件，默认 false；敏感路径始终不可见"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少项，默认 200，最大 500"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_find",
      "description": "在当前项目工作区递归查找文件名。适合先定位 CSV、脚本、配置或报告；不会进入 node_modules、.git、target、dist 等生成目录。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "glob 模式，例如 \"*.csv\"、\"scripts/*.R\"、\"**/report.html\""
          },
          "path": {
            "type": "string",
            "description": "相对搜索起点，默认 \".\""
          },
          "maxDepth": {
            "type": "integer",
            "description": "递归深度，默认 8，最大 20"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回多少项，默认 200，最大 500"
          },
          "includeHidden": {
            "type": "boolean",
            "description": "是否包含普通隐藏文件，默认 false"
          }
        },
        "required": [
          "pattern"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_search",
      "description": "在当前项目工作区的文本文件中搜索内容并返回文件、行号和匹配行。适合定位列名、函数、配置项和错误信息。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "要搜索的文本"
          },
          "path": {
            "type": "string",
            "description": "相对文件或目录，默认 \".\""
          },
          "filePattern": {
            "type": "string",
            "description": "可选 glob，例如 \"*.R\"、\"**/*.ts\""
          },
          "caseSensitive": {
            "type": "boolean",
            "description": "是否区分大小写，默认 false"
          },
          "maxDepth": {
            "type": "integer",
            "description": "递归深度，默认 8，最大 20"
          },
          "limit": {
            "type": "integer",
            "description": "最多返回匹配行数，默认 80，最大 300"
          }
        },
        "required": [
          "query"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_read",
      "description": "分段读取当前项目工作区内的文本文件，返回行号范围、总行数和 sha256。大文件应多次按 startLine/maxLines 分段读取。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对项目根目录的文件路径"
          },
          "startLine": {
            "type": "integer",
            "description": "起始行，从 1 开始，默认 1"
          },
          "maxLines": {
            "type": "integer",
            "description": "最多读取行数，默认 240，最大 1000"
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_write",
      "description": "在当前项目工作区创建或完整覆写一个文本文件。已存在文件必须同时传 overwrite=true 和 workspace_read 返回的 expectedSha256；创建新文件不需要 expectedSha256。dryRun=true 时只校验并返回变更摘要，不写盘；真实写入在只读模式或只检查请求中禁止调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对项目根目录的文件路径"
          },
          "content": {
            "type": "string",
            "description": "完整文本内容，最大 1 MiB"
          },
          "overwrite": {
            "type": "boolean",
            "description": "目标存在时必须显式为 true"
          },
          "expectedSha256": {
            "type": "string",
            "description": "覆写已有文件时必填：写入前文件 sha256"
          },
          "dryRun": {
            "type": "boolean",
            "description": "为 true 时只校验并返回变更摘要，不修改文件"
          }
        },
        "required": [
          "path",
          "content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_replace",
      "description": "在当前项目工作区文本文件中做一次精确替换。oldText 必须唯一匹配，并且必须传 workspace_read 返回的 expectedSha256 防止覆盖并发修改。dryRun=true 时只校验并返回变更摘要，不写盘；真实替换在只读模式或只检查请求中禁止调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对项目根目录的文件路径"
          },
          "oldText": {
            "type": "string",
            "description": "必须在文件中唯一出现的原文本"
          },
          "newText": {
            "type": "string",
            "description": "替换后的文本"
          },
          "expectedSha256": {
            "type": "string",
            "description": "必填：修改前文件 sha256"
          },
          "dryRun": {
            "type": "boolean",
            "description": "为 true 时只校验并返回变更摘要，不修改文件"
          }
        },
        "required": [
          "path",
          "oldText",
          "newText"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_exec",
      "description": "在当前项目工作区打开通用命令行。完全访问模式允许使用 shell 执行用户机器上可用的命令、脚本、管道和重定向；交互式提权、不可恢复删除、静默远端推送和远程脚本管道仍由安全边界拒绝。只读模式或用户明确要求仅检查/规划时禁止调用。科学分析正式结果仍应通过 run_tool 进入 tool_job 与 artifact truth。长命令建议传 yield_ms：等到产出或超时即交还控制权，未完成时自动转入后台进程表（返回 yielded:true + processId，用 process_status 轮询收尾），避免傻等阻塞。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "要在项目工作目录中执行的 shell 命令，例如 \"head -5 counts.csv\"、\"cat metadata.csv\" 或 \"Rscript scripts/qc.R\""
          },
          "cwd": {
            "type": "string",
            "description": "相对项目根目录的工作子目录（必须已存在）；每条命令都是独立 shell，cd 不跨调用持久，需要子目录时优先用本参数"
          },
          "shell": {
            "type": "string",
            "enum": [
              "auto",
              "posix",
              "powershell",
              "cmd"
            ],
            "description": "shell 选择：auto=平台默认（Windows=cmd，其他=$SHELL）；Windows 建议显式用 powershell 获得现代语法"
          },
          "timeoutMs": {
            "type": "integer",
            "description": "超时毫秒，默认 120000，最大 1800000（仅同步等待模式；传了 yield_ms 时忽略）"
          },
          "yield_ms": {
            "type": "integer",
            "description": "BLOCK-54 yield 中间档：等到产出或本超时即返回。完成→完整结果；超时→{yielded:true, processId} 转入后台进程表（process_status 轮询 / process_stop 停止）。默认 10000，范围 250-30000。预期 >30s 的命令直接用 workspace_exec_background"
          },
          "max_output_tokens": {
            "type": "integer",
            "description": "可选：输出 token 预算（默认 10000，封顶 50000），超出按 token 截断并标记 outputTruncatedByTokenBudget"
          }
        },
        "required": [
          "command"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "workspace_exec_background",
      "description": "在项目工作区以后台进程启动长时间运行的命令（如本地 HTTP 服务、长训练脚本），立即返回进程 ID（processId）、系统 pid 与日志相对路径。stdout 与 stderr 合并写入工作区 .biof3-agent-tmp/ 下的日志文件，可用 workspace_read 查看日志、process_status 查询存活与日志尾部、process_stop 停止。安全边界与 workspace_exec 相同（黑名单先行、需完全访问模式）。科学分析正式结果仍应通过 run_tool。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "要在项目工作目录中后台执行的 shell 命令，例如 \"python -m http.server 8642\""
          },
          "cwd": {
            "type": "string",
            "description": "相对项目根目录的工作子目录（必须已存在）"
          },
          "shell": {
            "type": "string",
            "enum": [
              "auto",
              "posix",
              "powershell",
              "cmd"
            ],
            "description": "shell 选择：auto=平台默认（Windows=cmd，其他=$SHELL）"
          }
        },
        "required": [
          "command"
        ]
      }
    }
  }
];
