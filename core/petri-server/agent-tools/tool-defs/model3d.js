/**
 * agent-tools/tool-defs/model3d.js — NEXT-04A SceneSpec / 3D 工具 Schema。
 */

const scene = {
  type: 'object',
  description: 'SceneSpec v1（mm、z-up-right-handed）；由 model3d_validate 校验',
  additionalProperties: true,
};

module.exports = [
  {
    type: 'function',
    function: {
      name: 'model3d_inspect',
      description: '只读摘要 SceneSpec：节点、尺寸、单位、约束、统计与几何哈希。',
      parameters: {
        type: 'object',
        properties: { scene },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_validate',
      description: '只读校验 SceneSpec：schema、单位、坐标、参数引用、mesh source hash、约束、复杂度；同时返回 Blender 能力状态。',
      parameters: {
        type: 'object',
        properties: { scene },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_propose',
      description: '把白名单 operations 应用到 SceneSpec 并返回候选 before/after 哈希；只读、不写盘，用户批准后调用 model3d_apply。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          operations: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'set_parameter / update_node / add_node / remove_node / set_metadata',
          },
        },
        required: ['scene', 'operations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_apply',
      description: '把已校验 operations 写入项目内 *.scene3d.json，写入前落本地修订快照；返回 before/after 哈希、语义 diff 与 revisionId。不接受任意脚本或路径逃逸。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          operations: { type: 'array', items: { type: 'object', additionalProperties: true } },
          path: { type: 'string', description: '项目相对路径，默认 model3d/scene.scene3d.json' },
        },
        required: ['scene', 'operations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_render',
      description: '用本地 Blender 构建 SceneSpec 并渲染 front/top/side/iso 多视角；Blender 缺席时诚实返回 capability_unavailable。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          views: { type: 'array', items: { type: 'string', enum: ['front', 'top', 'side', 'iso'] } },
        },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_visual_qa',
      description: 'Blender 渲染多视角并用当前 vision 角色做辅助 QA：观察/疑似问题/不确定项。视觉不替代尺寸、约束和网格校验；无视觉凭据时几何结果仍返回。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          views: { type: 'array', items: { type: 'string', enum: ['front', 'top', 'side', 'iso'] } },
        },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_export',
      description: '用本地 Blender 构建 SceneSpec 并导出 GLB/STL/OBJ，写 manifest（scene hash、provider 版本、输出哈希、网格报告）。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          formats: { type: 'array', items: { type: 'string', enum: ['glb', 'stl', 'obj'] } },
          taskSpecId: { type: 'string' },
          workflowRunId: { type: 'string' },
          recipeId: { type: 'string' },
          recipeVersion: { type: 'integer' },
        },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_recipe',
      description: '五类参数化 recipe（box-enclosure/bracket/room-layout/experiment-rig/from-table）：dryRun 返回候选 SceneSpec 与 TaskSpec；执行时写盘并可渲染/导出 GLB/STL/OBJ + manifest。',
      parameters: {
        type: 'object',
        properties: {
          recipeId: { type: 'string', enum: ['box-enclosure', 'bracket', 'room-layout', 'experiment-rig', 'from-table'] },
          params: { type: 'object', additionalProperties: true, description: 'recipe 参数；from-table 传 rows 数组（≤40 行）' },
          dryRun: { type: 'boolean', description: '默认 true：只生成候选，不写盘/不渲染' },
          path: { type: 'string', description: '项目相对路径，默认 model3d/recipes/<recipeId>.scene3d.json' },
          render: { type: 'boolean', description: '执行时是否渲染四视图（默认 true）' },
          formats: { type: 'array', items: { type: 'string', enum: ['glb', 'stl', 'obj'] } },
          views: { type: 'array', items: { type: 'string', enum: ['front', 'top', 'side', 'iso'] } },
        },
        required: ['recipeId'],
      },
    },
  },
];
