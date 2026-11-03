/**
 * tool-defs/svg.js — BLOCK-342 W1 SVG 编辑工具 Schema（受治理 SVG 桥）。
 */
'use strict';

module.exports = [
  {
    type: 'function',
    function: {
      name: 'svg_inspect',
      description: '检视工作区内的 SVG 文件结构：列出元素清单（结构路径 path / 标签 / id / class / 文本节选 / 属性数）或描述单个目标元素。用于编辑前摸清结构——先 inspect 拿到元素 path/id，再用 svg_edit 定位修改。文件只读，不做任何修改。',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'workspace 相对路径（.svg）'
          },
          target: {
            type: 'object',
            description: '可选：只描述单个元素。{id:"…"} 或 {path:[0,2,5]}（从根 <svg> 起的元素子节点序号路径，[]=根）'
          },
          tag: {
            type: 'string',
            description: '可选：按标签名过滤元素清单（如 text/g/path/image）'
          },
          limit: {
            type: 'number',
            description: '可选：清单上限（默认 200）'
          }
        },
        required: ['filePath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'svg_edit',
      description: '对工作区内的 SVG 文件做白名单编辑（propose/apply 两步，before/after sha256 + 操作列表即语义 diff；文件在 propose 后被改动会以 stale 拒绝，须重新 propose）。白名单操作：set_attr（设属性）/ remove_attr（删属性）/ set_style（style 属性键值合并，null 删键）/ set_text（替换纯文本元素内容，转义安全）/ insert（插入元素片段）/ remove（删元素）/ move（重排/层序）。定位一律 target={id} 或 {path:[…]}。插入片段与属性值经安全校验（禁 script/foreignObject/事件属性/javascript: 链接）。适合改图：换文字、改颜色尺寸、挪位置、调层序、删杂元素。',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'workspace 相对路径（.svg）'
          },
          ops: {
            type: 'array',
            description: '操作列表，顺序应用。每项形如 {op:"set_attr",target:{id:"title"},name:"fill",value:"#cc0000"}；set_text={target,text}；set_style={target,props:{fill:null,stroke:"#333"}}；insert={parent:{path:[0]},index:0|"end",markup:"<rect …/>"}；remove={target}；move={target,parent,index}',
            items: { type: 'object' }
          },
          apply: {
            type: 'boolean',
            description: '可选：true=执行写盘（须与 propose 时同一文件内容）。缺省=false（只 propose 校验并返回 beforeSha256）'
          },
          beforeSha256: {
            type: 'string',
            description: 'apply:true 时必填：propose 返回的 beforeSha256。文件在此期间被人/外部工具改过会以 svg_hash_mismatch 拒绝（须重新 propose），人的修正不会被覆盖'
          }
        },
        required: ['filePath', 'ops']
      }
    }
  },
];
