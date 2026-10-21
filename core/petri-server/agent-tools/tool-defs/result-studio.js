/**
 * agent-tools/tool-defs/result-studio.js — result-studio 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "generate_methods",
      "description": "基于用户在 Petri 上执行过的分析自动生成论文 Methods 段落（学术风格，引用实际使用的关键包及版本，报告 QC 阈值、分辨率等关键参数）。\n输入三选一：\n - analysisId：基于该分析及其父分析链生成；\n - planId：基于整个 plan 的所有步骤；\n - datasetId：基于该数据集的所有 done 分析。\n可选 language：zh / en / both（默认 zh）。\n用户说\"帮我写 Methods\" / \"导出方法部分\" / \"整理出方法学描述\"时使用。",
      "parameters": {
        "type": "object",
        "properties": {
          "analysisId": {
            "type": "string",
            "description": "可选：起点 analysis id（会沿父链向上拉取）"
          },
          "planId": {
            "type": "string",
            "description": "可选：plan id（取所有 step 关联分析）"
          },
          "datasetId": {
            "type": "string",
            "description": "可选：dataset id（取所有完成的分析）"
          },
          "language": {
            "type": "string",
            "enum": [
              "zh",
              "en",
              "both"
            ],
            "description": "语言，默认 zh"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_edit_plan",
      "description": "RESULT_EDIT_INTENT_v1 — 对已有科学结果的修改请求做只读规划：精确定位来源 Job/Artifact/脚本/输入，区分查看、重绘、转换、重算或工作流重规划，并计算受影响 DAG。此工具不修改文件、不创建 Job 或 ChangeSet；缺少真实来源或 DAG 时会明确阻断。",
      "parameters": {
        "type": "object",
        "properties": {
          "toolJobId": {
            "type": "string",
            "description": "产生当前结果的真实 tool_job id"
          },
          "artifactId": {
            "type": "string",
            "description": "Artifact 的稳定 id；不能用文件名代替"
          },
          "revisionId": {
            "type": "string",
            "description": "当前持久化 ArtifactRevision id"
          },
          "requestedOutcome": {
            "type": "string",
            "description": "用户希望得到的结果变化"
          },
          "requestedEditClass": {
            "type": "string",
            "enum": [
              "view_only",
              "presentation_rerender",
              "data_transform",
              "scientific_recompute",
              "workflow_replan"
            ],
            "description": "可选的用户意图类别；参数影响规则可以保守升级它，不能被它降级"
          },
          "proposedParameterPatch": {
            "type": "object",
            "description": "拟议参数 Patch；未知参数自动按科学重算处理"
          },
          "selectionId": {
            "type": "string",
            "description": "可选 SelectionContext id"
          },
          "sourceNodeId": {
            "type": "string",
            "description": "可选来源节点 id；不传时由 toolJobId 唯一匹配"
          },
          "userMessageId": {
            "type": "string",
            "description": "可选来源用户消息 id"
          }
        },
        "required": [
          "toolJobId",
          "artifactId",
          "revisionId",
          "requestedOutcome"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_create",
      "description": "RESULT_CHANGESET_v1 — 根据 result_edit_plan 返回的完整 ResultEditIntent 创建隔离候选版本。它会派生独立脚本与参数、创建真实 Git candidate commit，并通过现有 run_tool→tool_job→artifact truth 执行和验证；不会采用候选或覆盖当前结果。科学重算必须 scientificConfirmed=true。",
      "parameters": {
        "type": "object",
        "properties": {
          "intent": {
            "type": "object",
            "description": "result_edit_plan 返回且状态为 ready/confirmation_required 的完整 intent 对象"
          },
          "scriptPatch": {
            "type": "array",
            "description": "可选的精确脚本替换；每段 oldText 必须唯一匹配",
            "items": {
              "type": "object",
              "properties": {
                "oldText": {
                  "type": "string"
                },
                "newText": {
                  "type": "string"
                }
              },
              "required": [
                "oldText",
                "newText"
              ]
            }
          },
          "scientificConfirmed": {
            "type": "boolean",
            "description": "科学参数/方法变化已完成确认时为 true"
          }
        },
        "required": [
          "intent"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_status",
      "description": "读取当前项目中一个 Result Studio ChangeSet、候选 Revision 和恢复状态；只读，不采用、不撤销。",
      "parameters": {
        "type": "object",
        "properties": {
          "changeSetId": {
            "type": "string",
            "description": "ChangeSet id"
          }
        },
        "required": [
          "changeSetId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_compare",
      "description": "读取一个 Result Studio ChangeSet 的紧凑摘要、Git 文本 diff、JSON 字段 diff、表格语义比较、视觉版本引用和历史；只读且结果有界。",
      "parameters": {
        "type": "object",
        "properties": {
          "changeSetId": {
            "type": "string"
          }
        },
        "required": [
          "changeSetId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_adopt",
      "description": "采用已验证且仍基于当前父版本的 preview_ready ChangeSet。会以 Git CAS 与 SQLite 事务原子切换 current；仅在用户明确要求采用当前候选时调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "changeSetId": {
            "type": "string"
          }
        },
        "required": [
          "changeSetId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_revert",
      "description": "撤销未采用候选，或在其仍为 current 时撤销已采用 ChangeSet；不会删除历史。较旧版本已被新版本覆盖时应使用 artifact_revision_restore。",
      "parameters": {
        "type": "object",
        "properties": {
          "changeSetId": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "changeSetId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "artifact_revision_list",
      "description": "列出当前项目一个 Artifact family 的版本历史和唯一 current Revision；只读。",
      "parameters": {
        "type": "object",
        "properties": {
          "artifactFamilyId": {
            "type": "string"
          }
        },
        "required": [
          "artifactFamilyId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "artifact_revision_restore",
      "description": "将历史 ArtifactRevision 恢复为一个新的 commit、ChangeSet 和 Revision 后采用；不改写或删除旧历史。仅在用户明确要求恢复该版本时调用。",
      "parameters": {
        "type": "object",
        "properties": {
          "revisionId": {
            "type": "string"
          }
        },
        "required": [
          "revisionId"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_selection_run",
      "description": "RESULT_SELECTION_ACTION_v1 — 将当前兼容 SelectionContext 解析为稳定科学实体，生成独立物化脚本/参数/基因表，并通过既有 run_tool→tool_job→artifact truth 执行正式 GO/KEGG。选择过期、来源哈希漂移、插件未声明动作或无法权威重建时会阻断。",
      "parameters": {
        "type": "object",
        "properties": {
          "selectionId": {
            "type": "string",
            "description": "当前主画布持久化 SelectionContext id"
          },
          "action": {
            "type": "string",
            "enum": [
              "go_kegg"
            ],
            "description": "当前支持的插件声明下游动作"
          },
          "species": {
            "type": "string",
            "enum": [
              "human",
              "mouse"
            ]
          },
          "geneIdType": {
            "type": "string",
            "enum": [
              "auto",
              "SYMBOL",
              "ENSEMBL",
              "ENTREZID"
            ]
          },
          "analysisType": {
            "type": "string",
            "enum": [
              "all",
              "GO",
              "GO-BP",
              "GO-MF",
              "GO-CC",
              "KEGG"
            ]
          }
        },
        "required": [
          "selectionId",
          "action"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_studio_context",
      "description": "RESULT_STUDIO_CONTEXT_v1 — 读取用户当前打开结果的完整工程坐标（结果名/工具/版本序号/验证与复现状态/可编辑参数/插件动作/当前选择）。优先调用它，然后使用返回的 contextToken 调用 *_in_context 工具；不要向用户索要或自行猜测 job、artifact、revision、changeset、selection 等内部 id。返回值有界，不含完整实体 ID 列表、路径或结果值。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_edit_plan_in_context",
      "description": "RESULT_EDIT_INTENT_v1（context-bound）— 只读规划当前打开结果的修改：来源 Job/Artifact/Revision/脚本坐标由后端上下文自动补齐，用户和模型都不需要提供内部 id。区分查看、重绘、转换、重算与工作流重规划，未知参数保守按科学重算；不修改文件、不创建 Job 或 ChangeSet。归因只能到 Job、选择已过期或缺 DAG 时明确阻断并给出修复路径。",
      "parameters": {
        "type": "object",
        "properties": {
          "requestedOutcome": {
            "type": "string",
            "description": "用户希望得到的结果变化（自然语言）"
          },
          "requestedEditClass": {
            "type": "string",
            "enum": [
              "view_only",
              "presentation_rerender",
              "data_transform",
              "scientific_recompute",
              "workflow_replan"
            ],
            "description": "可选意图类别；插件影响规则可保守升级它，不能被它降级"
          },
          "proposedParameterPatch": {
            "type": "object",
            "description": "拟议参数 Patch。只能使用 result_studio_context 的 editControls 声明过的参数名；未声明参数会被拒绝，未知影响按科学重算处理"
          },
          "useCurrentSelectionForLabels": {
            "type": "boolean",
            "description": "仅火山图：将当前完整、兼容的稳定 gene 选择绑定为额外标签。不能与 label_genes 同时传入，模型不提供基因 ID。"
          },
          "editOrigin": {
            "type": "string",
            "enum": [
              "manual",
              "agent"
            ],
            "description": "参数来源，仅用于审计与解释文案；不影响校验强度或影响分级"
          },
          "userMessageId": {
            "type": "string",
            "description": "可选来源用户消息 id"
          },
          "contextToken": {
            "type": "string",
            "description": "可选：result_studio_context 返回的 token"
          }
        },
        "required": [
          "requestedOutcome"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_create_in_context",
      "description": "RESULT_CHANGESET_v1（context-bound）— 用 result_edit_plan_in_context 返回的 intent 在当前打开结果上创建隔离候选版本，经既有 run_tool→tool_job→artifact truth 执行与验证，不采用候选也不覆盖当前结果。必须携带 contextToken：结果、版本或选择在规划后发生变化时拒绝执行。科学重算需 scientificConfirmed=true。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string",
            "description": "result_studio_context 返回的 token"
          },
          "intent": {
            "type": "object",
            "description": "result_edit_plan_in_context 返回的 intent 引用；只需原样携带 intentId，执行字段由服务器 sealed plan 解析",
            "properties": {
              "intentId": {
                "type": "string"
              }
            },
            "required": [
              "intentId"
            ]
          },
          "scientificConfirmed": {
            "type": "boolean",
            "description": "科学参数或方法变化已完成确认时为 true"
          }
        },
        "required": [
          "contextToken",
          "intent"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_enrichment_from_context",
      "description": "RESULT_ENRICHMENT_FROM_CONTEXT_v1 — 从当前打开的正式 DEG 表版本继续 GO/KEGG。Revision、输入文件、来源 hash、下游工具与持久 DAG 边均由后端绑定；模型不能提交路径、toolId 或 lineage。仅当前 DEG Revision 且插件声明稳定 gene_id/derive_enrichment_input 时执行。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string",
            "description": "result_studio_context 返回的 token"
          },
          "species": {
            "type": "string",
            "enum": [
              "human",
              "mouse"
            ]
          },
          "geneIdType": {
            "type": "string",
            "enum": [
              "auto",
              "SYMBOL",
              "ENSEMBL",
              "ENTREZID"
            ]
          },
          "analysisType": {
            "type": "string",
            "enum": [
              "all",
              "GO",
              "GO-BP",
              "GO-MF",
              "GO-CC",
              "KEGG"
            ]
          },
          "padjCutoff": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "lfcCutoff": {
            "type": "number",
            "minimum": 0
          }
        },
        "required": [
          "contextToken"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_status_in_context",
      "description": "读取当前打开结果上进行中修改的阶段结论、候选版本与恢复状态；ChangeSet 由上下文自动绑定，只读。存在多个进行中修改时要求先确认，不自行猜测。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string"
          },
          "changeSetId": {
            "type": "string",
            "description": "可选：显式指定要查看的修改"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_compare_in_context",
      "description": "比较当前打开结果的候选版本与当前版本：视觉/表格语义/JSON 字段/文本差异与版本历史；ChangeSet 由上下文自动绑定，只读且结果有界。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string"
          },
          "changeSetId": {
            "type": "string"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_adopt_in_context",
      "description": "采用当前打开结果上已验证的候选版本，以 Git CAS + SQLite 事务原子切换 current；仅在用户明确要求采用时调用。必须携带 contextToken，父版本已变化时拒绝。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string"
          },
          "changeSetId": {
            "type": "string"
          }
        },
        "required": [
          "contextToken"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "result_changeset_revert_in_context",
      "description": "撤销当前打开结果上的候选修改，或在其仍为 current 时撤销已采用修改；不删除任何历史。必须携带 contextToken。较旧版本已被覆盖时应使用 artifact_revision_restore。",
      "parameters": {
        "type": "object",
        "properties": {
          "contextToken": {
            "type": "string"
          },
          "changeSetId": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "contextToken"
        ]
      }
    }
  }
];
