'use strict';

/**
 * QODER-E12 — Notebook cell 级编辑工具 Schema（2026-11-23）。
 *
 * 零新依赖：ipynb 即 JSON，handler 复用 helpers/notebook-edit.js 纯函数。
 * 执行子操作借道既有 workspace_exec（继承审批门），本工具本身只做 cell CRUD。
 */
module.exports = [
  {
    type: 'function',
    function: {
      name: 'notebook_edit',
      description: '对当前项目工作区的 .ipynb Notebook 做 cell 级读写（insert/update/delete）或生成执行计划。写操作必须传 workspace_read 返回的 expectedSha256 防并发覆盖；dryRun=true 只返回变更摘要不写盘。执行（op=execute）只生成借道 workspace_exec 的计划，由你显式调用该工具执行——不新建执行器、不绕过审批门。无 kernel 状态：执行仅支持 python/R 文本驱动，stdout 回填，不支持 %magic/富 MIME。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的 .ipynb 路径' },
          op: { type: 'string', enum: ['list', 'read', 'insert', 'update', 'delete', 'execute'], description: 'cell 操作' },
          expectedSha256: { type: 'string', description: '写操作必填：改前文件 sha256' },
          cellId: { type: 'string', description: 'update/delete/execute 的目标 cell id' },
          index: { type: 'integer', description: 'insert 的插入位置（缺省末尾）' },
          cellType: { type: 'string', enum: ['code', 'markdown'], description: 'insert 的 cell 类型（缺省 code）' },
          source: { type: 'string', description: 'insert/update 的 cell 源文本；execute 时可覆盖 cell 源码' },
          language: { type: 'string', description: 'execute 时的语言（python/python3/r/Rscript）' },
          dryRun: { type: 'boolean', description: '为 true 时只校验并返回变更摘要，不写盘' },
        },
        required: ['path', 'op'],
      },
    },
  },
];
