/**
 * agent-tools/tool-defs/computer.js — computer 域工具 Schema（BLOCK-109-CORE-ARCH P2-1 按域拆分；
 * 物理目录即域）。由 tool-defs.js facade 汇编，勿直接 require（统一走 facade）。
 * 执行元数据（readOnly/destructive/...）见 ../tool-metadata.js。
 */

module.exports = [
  {
    "type": "function",
    "function": {
      "name": "computer_snapshot",
      "description": "【macOS/Windows】读取当前应用的无障碍语义树，返回可交互元素清单（ref/角色/标题/值/坐标/尺寸）。电脑控制的第一步：先 snapshot 拿到元素 ref，再 click/type 定位操作。默认读前台应用；app 可传 bundleId/进程名（macOS 如 com.apple.TextEdit，Windows 如 notepad）或数字 pid。Electron/Chromium 应用在 macOS 传 axManual:true 规避语义树懒初始化（Windows 端 UIA 客户端连接即暴露，无需此参）。",
      "parameters": {
        "type": "object",
        "properties": {
          "app": {
            "type": "string",
            "description": "目标应用：'frontmost'（默认前台）| bundleId | pid 字符串"
          },
          "maxElements": {
            "type": "number",
            "description": "元素数量上限（默认 300）"
          },
          "axManual": {
            "type": "boolean",
            "description": "Electron/Chromium 应用设 true 规避 AX 懒初始化"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_click",
      "description": "【macOS/Windows】点击 snapshot 返回的元素（ref）：优先语义动作（AXPress/Invoke），自动回退坐标合成点击。需要用户确认（首调返回 ackToken，前端确认卡批准后携 confirm+ackToken 重调）。",
      "parameters": {
        "type": "object",
        "properties": {
          "ref": {
            "type": "string",
            "description": "snapshot 返回的元素 ref（如 e12）"
          },
          "app": {
            "type": "string",
            "description": "目标应用（默认前台；须与 snapshot 同一应用）"
          },
          "prefer": {
            "type": "string",
            "enum": [
              "coordinate"
            ],
            "description": "强制坐标点击"
          },
          "confirm": {
            "type": "boolean",
            "description": "用户批准后置 true"
          },
          "ackToken": {
            "type": "string",
            "description": "首调返回的确认 token"
          }
        },
        "required": [
          "ref"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_type",
      "description": "【macOS/Windows】向目标应用键入文本（支持中文）。无换行且带 ref 时优先整体回写（macOS AX SetValue / Windows UIA ValuePattern，后台确定性）；含换行走逐字合成注入（Windows 部分受控宿主可能拦截合成键盘，诚实上报 mode）。建议先 click 文本框聚焦（传 ref）。需要用户确认（ackToken 两段式）。",
      "parameters": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "description": "要键入的文本（支持换行 \n）"
          },
          "ref": {
            "type": "string",
            "description": "要聚焦的文本框 ref"
          },
          "app": {
            "type": "string",
            "description": "目标应用（默认前台）"
          },
          "activate": {
            "type": "boolean",
            "description": "先把应用调到前台（后台注入无效时的兜底）"
          },
          "confirm": {
            "type": "boolean"
          },
          "ackToken": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_press",
      "description": "【macOS/Windows】按键：return/tab/escape/backspace/delete/方向键/home/end/pageup/pagedown/F1-F12/字母数字等。macOS 修饰键 cmd/shift/alt/ctrl；Windows 修饰键 ctrl/alt/shift/win（被拦宿主上修饰键组合诚实拒绝）。需要用户确认（ackToken 两段式）。",
      "parameters": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string",
            "description": "键名（如 return、escape、left、f4）"
          },
          "modifiers": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "cmd",
                "shift",
                "alt",
                "ctrl",
                "win"
              ]
            }
          },
          "app": {
            "type": "string"
          },
          "activate": {
            "type": "boolean"
          },
          "confirm": {
            "type": "boolean"
          },
          "ackToken": {
            "type": "string"
          }
        },
        "required": [
          "key"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_scroll",
      "description": "【macOS/Windows】在目标位置滚轮滚动（默认前台窗口中心，或 ref 元素处）。需要用户确认（ackToken 两段式）。",
      "parameters": {
        "type": "object",
        "properties": {
          "direction": {
            "type": "string",
            "enum": [
              "up",
              "down",
              "left",
              "right"
            ]
          },
          "amount": {
            "type": "number",
            "description": "滚动行数（默认 3，上限 30）"
          },
          "ref": {
            "type": "string",
            "description": "滚动锚定元素 ref"
          },
          "app": {
            "type": "string"
          },
          "confirm": {
            "type": "boolean"
          },
          "ackToken": {
            "type": "string"
          }
        },
        "required": [
          "direction"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_screenshot",
      "description": "【macOS/Windows】对目标应用窗口截图，PNG 落盘到当前项目工作区 computer-use/ 目录。macOS 按窗口取像遮挡免疫、需屏幕录制权限；Windows 无 TCC 权限门。",
      "parameters": {
        "type": "object",
        "properties": {
          "filename": {
            "type": "string",
            "description": "产物文件名（默认 screenshot.png；仅支持改文件名，目录固定项目内）"
          },
          "app": {
            "type": "string",
            "description": "目标应用（默认前台）"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_wait",
      "description": "【macOS/Windows】等待目标应用出现满足条件的元素（自适应轮询，默认上限 5s）。用于点击/输入后等界面就绪，避免盲重试。只读。",
      "parameters": {
        "type": "object",
        "properties": {
          "role": {
            "type": "string",
            "description": "元素角色（如 'button'、'textField'，大小写与 AX 前缀不敏感）"
          },
          "textContains": {
            "type": "string",
            "description": "标题/描述/值包含的文本"
          },
          "ref": {
            "type": "string",
            "description": "等待某 ref 重新出现"
          },
          "timeoutMs": {
            "type": "number",
            "description": "超时毫秒（默认 5000，上限 30000）"
          },
          "app": {
            "type": "string"
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "computer_authorize",
      "description": "【macOS/Windows】诚实探测电脑控制可用性：macOS 返回辅助功能/屏幕录制权限态与系统设置引导；Windows 返回平台标识与宿主提权边界（无 TCC 式授权门）。使用任何 computer_* 工具前先调用。只读零副作用。",
      "parameters": {
        "type": "object",
        "properties": {}
      }
    }
  }
];
