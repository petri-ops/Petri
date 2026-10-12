/**
 * agent-tools/tool-defs/skill.js — skill 域工具 Schema（BLOCK-157 W1 P1/KNW-1 新域）。
 * 由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 只读会话台三件：discover（清单）/ get（完整手册=渐进披露触发加载通道）/
 * preflight（依赖自检，BLOCK-176 W7 CP-21）。
 * 不含 skill_execute（执行自动化产品语义另裁，见 BLOCK-157 plan §2）。
 */

module.exports = [
  {
    type: 'function',
    function: {
      name: 'skill_discover',
      description:
        '列出当前系统可用的产品 Skills（标准化分析/工作流程包，含内置与用户安装）。当用户的任务可能对应某个标准流程（已有既定步骤与参数约定的任务）时，先用本工具查看是否有匹配技能，再用 skill_get 读取其完整手册后按手册执行。支持按分类/来源/关键词过滤。只读、零副作用。',
      parameters: {
        type: 'object',
        properties: {
          categoryFilter: {
            type: 'string',
            description: '可选；按分类过滤（如 "bioinformatics"、"coding"，支持前缀匹配）'
          },
          source: {
            type: 'string',
            enum: ['built-in', 'installed'],
            description: '可选；按来源过滤（built-in=随包内置 / installed=用户安装）'
          },
          search: {
            type: 'string',
            description: '可选；关键词（匹配技能 id/名称/描述/标签）'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skill_get',
      description:
        '读取一个 Skill 的完整信息：执行手册（prompts）、参数契约、依赖插件、输出契约与恢复策略。先用 skill_discover 找到 id 再读本工具；读到的手册应作为该任务的执行指引（按手册的步骤与参数约定推进），不要凭记忆猜测流程。只读。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '技能 id（来自 skill_discover 返回，如 "coding-playbook"）'
          }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'skill_preflight',
      description:
        '检查技能的外部依赖在本机是否就绪（声明 os 平台门控与 requires.bins 二进制清单的技能）：可用 / 待装 / 缺依赖 / 平台不适用。待装技能的 install 配方在结果中给出；执行安装必须经既有命令执行工具走用户审批确认（未批准不执行），装完重跑本工具复核。不带 id 时检查全部技能。只读探测。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '可选；只检查这一个技能 id（缺省=全部技能）'
          }
        }
      }
    }
  }
];
