/**
 * tool-defs/godot.js — BLOCK-341 P2/P3 Godot 桥工具 Schema（受治理引擎桥）。
 */
'use strict';

module.exports = [
  {
    type: 'function',
    function: {
      name: 'godot_run',
      description: '运行 Godot 项目 ≤N 渲染帧并采集截图序列（PNG）+ stdout 日志 + 退出码 manifest。截图可直接用 read_image 逐帧解读来判断画面是否符合预期（例如检查游戏画面、UI 布局、渲染效果）。引擎在本地执行（需要本机装有 Godot 4.x，未安装会返回 capability_unavailable）。不修改你的项目源文件——截图与日志落 .petri/godot-runs/。',
      parameters: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: '可选：项目目录（workspace 相对路径，须含 project.godot）。缺省=工作区根'
          },
          frames: {
            type: 'number',
            description: '可选：渲染帧数（默认 60，硬顶 600）。帧数越多运行时间越长'
          },
          captureFrames: {
            type: 'boolean',
            description: '可选：是否采集截图序列（默认 true）'
          },
          scene: {
            type: 'string',
            description: '可选：指定运行的场景路径（res:// 相对）。缺省=项目主场景'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'godot_scene_apply',
      description: '对 Godot 场景/脚本文件（.tscn/.gd/.godot）做白名单编辑：set_node_property（节点属性）/ set_resource_ref（资源引用）/ replace_script_snippet（脚本片段替换）。propose/apply 两步：第一次调用校验并返回 beforeSha256；确认后携带 apply:true 执行写盘并返回语义 diff。白名单外的操作会被拒绝并要求人工审批。文件在工作区内，编辑前后 sha256 可复核。',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'workspace 相对路径（.tscn/.gd/.godot）'
          },
          op: {
            type: 'string',
            enum: ['set_node_property', 'set_resource_ref', 'replace_script_snippet'],
            description: '白名单操作类型'
          },
          payload: {
            type: 'object',
            description: '操作载荷：set_node_property={node,property,value}；set_resource_ref={target,resourcePath}；replace_script_snippet={find,replace}'
          },
          apply: {
            type: 'boolean',
            description: '可选：true=执行写盘（须携带上次 propose 返回的 beforeSha256 一致性）。缺省=false（只 propose 校验）'
          }
        },
        required: ['filePath', 'op', 'payload']
      }
    }
  },
];
