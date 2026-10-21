/**
 * agent-tools/tool-defs/browser.js — browser 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "query",
      "description": "查询当前项目范围内的结构化资源。返回 JSON 数组。资源类型：projects | datasets | analyses | facts | memories. 当你需要更详细的资源信息（system prompt 里没有的字段）时调用此工具。",
      "parameters": {
        "type": "object",
        "properties": {
          "resource": {
            "type": "string",
            "enum": [
              "projects",
              "datasets",
              "analyses",
              "facts",
              "memories"
            ],
            "description": "资源类型"
          },
          "id": {
            "type": "string",
            "description": "可选：精确查找某条记录"
          },
          "parentId": {
            "type": "string",
            "description": "可选：父级 id（如 projectId 用来列 datasets）"
          },
          "limit": {
            "type": "integer",
            "description": "默认 50，最大 200"
          }
        },
        "required": [
          "resource"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_page",
      "description": "读取已安装内容插件的教程片段。url 形如 /plugin/<pluginId>/<slug>。当分析现场卡住、不确定某工具/流程怎么用时，先调 read_page 查对应插件教程片段再回答用户。",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "已安装内容插件路径，格式为 /plugin/<id>/<slug>。"
          }
        },
        "required": [
          "url"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "search",
      "description": "在当前项目记忆或已安装内容插件中做语义 + 关键词检索。分析卡住、不确定某工具或流程怎么用时，优先用 scope=plugins。",
      "parameters": {
        "type": "object",
        "properties": {
          "q": {
            "type": "string",
            "description": "查询语句"
          },
          "scope": {
            "type": "string",
            "enum": [
              "memories",
              "plugins"
            ],
            "description": "memories 搜当前项目记忆；plugins 搜已安装内容插件。"
          },
          "topK": {
            "type": "integer",
            "description": "返回多少条，默认 5，最大 15"
          }
        },
        "required": [
          "q",
          "scope"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "act",
      "description": "ACT_TOOL_v2 — 执行领域中性动作。type 枚举=核心动作：rename_project / rename_dataset / rename_analysis / update_analysis_params（仅重命名/参数修改可撤销，30 秒内撤销；其余动作不支持撤销）/ open_tool（打开工具）；ui_action（把已安装领域包提供的 UI 动作派发到 pack 视图，actionId 由领域包提供）。已安装领域包的 UI action 会追加在描述末尾；pack 缺失/停用时对应 action 消失。所有操作都会审计；不允许删除、跨用户操作或代用户上传。",
      "parameters": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "rename_project",
              "rename_dataset",
              "rename_analysis",
              "update_analysis_params",
              "open_tool",
              "ui_action"
            ],
            "description": "操作类型"
          },
          "projectId": {
            "type": "string",
            "description": "rename_project 用"
          },
          "datasetId": {
            "type": "string",
            "description": "rename_dataset 用"
          },
          "analysisId": {
            "type": "string",
            "description": "rename_analysis / update_analysis_params 用"
          },
          "newName": {
            "type": "string",
            "description": "rename_* 时的新名字"
          },
          "params": {
            "type": "object",
            "description": "update_analysis_params 用：要合并的参数对象"
          },
          "toolId": {
            "type": "string",
            "description": "open_tool 用：工具 id"
          },
          "actionId": {
            "type": "string",
            "description": "ui_action 用：已安装领域包提供的 action id（见描述末尾的已安装 action 清单）"
          },
          "payload": {
            "type": "object",
            "description": "ui_action 用：传给 pack 视图的 JSON 载荷（≤8KB）"
          }
        },
        "required": [
          "type"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_image",
      "description": "读取一张图交给多模态模型解读图内容。两种输入二选一：\n1) toolJobId：读取某个 tool_job 结果里的图（PNG）。run_tool 跑完出图后，如果你需要看图内容才能回答（如\"图里上调基因集中在哪？\"），调本工具拿图；可选 fileName 指定哪张图，不传读第一张 plot。\n2) filePath：读取项目工作区里的静态图片（相对路径，如 \"figures/map.png\"）。当用户在消息里引用了工作区图片（消息开头有 【引用图片 …】 块且含 path: 行）时，用该 path 调本工具看图。\n注意：token 消耗较高，仅在用户明确问图内容或引用图片提问时调，不要每次出图都读。",
      "parameters": {
        "type": "object",
        "properties": {
          "toolJobId": {
            "type": "string",
            "description": "tool_job id（run_tool 返回的 toolJobId）。与 filePath 二选一"
          },
          "filePath": {
            "type": "string",
            "description": "workspace 相对路径（png/jpg/jpeg/svg），如 \"figures/umap.png\"。与 toolJobId 二选一"
          },
          "fileName": {
            "type": "string",
            "description": "可选（仅 toolJobId 模式）：指定读哪个图（如 plot.png）。不传则读第一张 plot"
          },
          "question": {
            "type": "string",
            "description": "可选：问图什么（默认描述图的主要内容）"
          }
        }
      }
    }
  }
];
