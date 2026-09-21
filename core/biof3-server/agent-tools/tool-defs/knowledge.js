/**
 * agent-tools/tool-defs/knowledge.js — knowledge 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "knowledge_search",
      "description": "在用户上传的知识空间（知识库）中检索。双通道（语义向量 + 关键词全文）混合检索，返回最相关的知识块。当知识空间启用且对话涉及用户上传的背景资料（基因笔记、方案文档、代码、表格等）时主动使用；可多轮检索、可更换关键词。",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "检索查询词（关键词或语义短语）"
          },
          "topK": {
            "type": "integer",
            "description": "返回块数，默认 3，最大 8"
          },
          "spaceId": {
            "type": "string",
            "description": "可选：目标知识空间 ID（BLOCK-99 多空间；缺省为默认空间）"
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
      "name": "knowledge_status",
      "description": "查看知识空间状态：是否启用、文档清单与摄取状态（ready/parsing/failed 等）。零副作用。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "可选：目标知识空间 ID（BLOCK-99 多空间；缺省为默认空间）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_read",
      "description": "按文档整篇读取知识空间中已就绪文档的分块原文（配合 knowledge_search 命中结果溯源全文）。",
      "parameters": {
        "type": "object",
        "properties": {
          "docId": {
            "type": "string",
            "description": "文档 ID（来自 knowledge_search 命中结果的 docId 或 knowledge_status 清单）"
          },
          "spaceId": {
            "type": "string",
            "description": "可选：目标知识空间 ID（BLOCK-99 多空间；缺省为默认空间）"
          }
        },
        "required": [
          "docId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_list",
      "description": "列出全部知识空间（名称/启停/文档数/块数，BLOCK-99 空间管理会话台）。零副作用。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_impact",
      "description": "查看某知识空间的影响面统计（文档数/块数），删空间/清空前的诚实影响面数据源。零副作用。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "知识空间 ID（缺省为默认空间）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_create",
      "description": "创建新知识空间（1..60 字符命名，重名拒绝；新建默认停用，可用 knowledge_space_enable 启用）。",
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "新空间名称（1..60 字符，全局唯一）"
          }
        },
        "required": [
          "name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_rename",
      "description": "重命名知识空间（1..60 字符，重名拒绝；默认空间也可改名）。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "知识空间 ID"
          },
          "name": {
            "type": "string",
            "description": "新名称（1..60 字符，全局唯一）"
          }
        },
        "required": [
          "spaceId",
          "name"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_enable",
      "description": "启用或停用知识空间（停用后该空间的自动召回与检索整体不可见，文档保留）。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "知识空间 ID（缺省为默认空间）"
          },
          "enabled": {
            "type": "boolean",
            "description": "true 启用 / false 停用"
          }
        },
        "required": [
          "enabled"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_bind",
      "description": "把当前会话绑定到指定知识空间（影响本会话的自动召回范围；绑定默认空间即解绑回落默认）。绑定关系随会话持久，目标空间被删除时自动掉绑。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "知识空间 ID（缺省=绑定默认空间即解绑）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_delete",
      "description": "删除知识空间（级联删除其全部文档/知识块/索引/原始文件，不可恢复）。破坏性确认门：首调（不带 confirmToken）返回影响面与一次性 confirmToken，必须先向用户复述影响面并获明确确认后，凭 token 重调才执行。默认空间不可删除。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "要删除的知识空间 ID"
          },
          "confirmToken": {
            "type": "string",
            "description": "确认令牌（首调返回；用户明确确认后才可携带）"
          }
        },
        "required": [
          "spaceId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_space_clear",
      "description": "清空知识空间的全部文档与知识块（空间本身保留，不可恢复）。破坏性确认门：首调（不带 confirmToken）返回影响面与一次性 confirmToken，必须先向用户复述影响面并获明确确认后，凭 token 重调才执行。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "要清空的知识空间 ID（缺省为默认空间）"
          },
          "confirmToken": {
            "type": "string",
            "description": "确认令牌（首调返回；用户明确确认后才可携带）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_doc_list",
      "description": "列出某知识空间的文档清单（id/名称/摄取状态/块数），跨空间文档管理的数据源。零副作用。",
      "parameters": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "description": "知识空间 ID（缺省为默认空间）"
          },
          "status": {
            "type": "string",
            "description": "可选：按状态过滤（ready/parsing/failed 等）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_doc_move",
      "description": "把一批文档移动到目标知识空间（归类移动，非破坏：块/索引/原始文件不动，只改归属）。",
      "parameters": {
        "type": "object",
        "properties": {
          "docIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "要移动的文档 ID 列表（≤200）"
          },
          "targetSpaceId": {
            "type": "string",
            "description": "目标知识空间 ID"
          }
        },
        "required": [
          "docIds",
          "targetSpaceId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_doc_delete",
      "description": "删除文档（含知识块/索引/原始文件，不可恢复）。单篇直接删除；批量（多篇）走破坏性确认门：首调（不带 confirmToken）返回影响面与一次性 confirmToken，须用户明确确认后凭 token 重调。",
      "parameters": {
        "type": "object",
        "properties": {
          "docIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "要删除的文档 ID 列表"
          },
          "confirmToken": {
            "type": "string",
            "description": "确认令牌（批量删除时首调返回；用户明确确认后才可携带）"
          }
        },
        "required": [
          "docIds"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "knowledge_doc_reindex",
      "description": "重建文档索引：清旧块后按原始文件重跑摄取管道（解析失败/换嵌入模型后使用）。",
      "parameters": {
        "type": "object",
        "properties": {
          "docId": {
            "type": "string",
            "description": "文档 ID"
          }
        },
        "required": [
          "docId"
        ]
      }
    }
  }
];
