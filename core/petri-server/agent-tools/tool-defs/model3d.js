/**
 * agent-tools/tool-defs/model3d.js — NEXT-04A SceneSpec / 3D 工具 Schema。
 */

const {
  RENDER_VIEWS,
  DEFAULT_TURNTABLE_FRAMES,
  TURNTABLE_MIN_FRAMES,
  TURNTABLE_MAX_FRAMES,
  TURNTABLE_MIN_ELEVATION_DEG,
  TURNTABLE_MAX_ELEVATION_DEG,
} = require('../../helpers/model3d-views');

const scene = {
  type: 'object',
  description: 'SceneSpec v1（mm、z-up-right-handed）；由 model3d_validate 校验',
  additionalProperties: true,
};

// 边界数值取自 helpers/model3d-views（唯一声明处），schema 不再自己抄一份。
const turntable = {
  type: 'object',
  description: `转盘视频请求（属输出参数，不进 SceneSpec、不参与 hash）：产出 ${TURNTABLE_MIN_FRAMES}..${TURNTABLE_MAX_FRAMES} 帧 PNG 序列 + 同名 mp4（Blender 内置 ffmpeg，零新依赖）；缺省 ${DEFAULT_TURNTABLE_FRAMES} 帧。`,
  properties: {
    frames: { type: 'integer', minimum: TURNTABLE_MIN_FRAMES, maximum: TURNTABLE_MAX_FRAMES },
    elevationDeg: { type: 'number', minimum: TURNTABLE_MIN_ELEVATION_DEG, maximum: TURNTABLE_MAX_ELEVATION_DEG },
  },
  additionalProperties: false,
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
      description: '用本地 Blender 构建 SceneSpec 并渲染 front/top/side/iso 多视角；可附 turntable 请求转盘序列帧与 mp4；Blender 缺席时诚实返回 capability_unavailable。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          views: { type: 'array', items: { type: 'string', enum: [...RENDER_VIEWS] } },
          turntable,
          lineart: { type: 'boolean', description: 'P4-03：额外输出前/顶/侧 Freestyle 线稿（非 GD&T 工程图）' },
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
          views: { type: 'array', items: { type: 'string', enum: [...RENDER_VIEWS] } },
        },
        required: ['scene'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_export',
      description: '用本地 Blender 构建 SceneSpec 并导出 GLB/STL/OBJ/FBX/USDZ，写 manifest（scene hash、provider 版本、输出哈希、网格报告）；formats 含 step 时由 OCCT 把 Blender STL 转为 faceted STEP（非解析曲面/特征保真）；可附 turntable 同时产出转盘序列帧与 mp4。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          formats: { type: 'array', items: { type: 'string', enum: ['glb', 'stl', 'obj', 'fbx', 'usdz', 'step'] } },
          turntable,
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
      name: 'model3d_share',
      description: '生成本地 3D 分享包（SceneSpec + manifest + 已登记产物 + checksums.json）并返回 zip sha/bytes；缺件或 manifest sha 不符直接拒绝，不上传云端。',
      parameters: {
        type: 'object',
        properties: {
          scenePath: { type: 'string', description: '项目内 SceneSpec 相对路径' },
          manifestPath: { type: 'string', description: '项目内 manifest 相对路径' },
          outputs: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '缺省取 manifest.outputs' },
          name: { type: 'string' },
        },
        required: ['scenePath', 'manifestPath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_asset',
      description: '外部资产入链与资产库：action=import 把工作区 glb/gltf/stl/obj 复制到 model3d/assets/<sha>，或把 step/stp/iges/igs 转换为派生 GLB/STL 后入链，记录 provenance，返回可直接 add_node 的 mesh-reference；action=list 检索；action=get 取回引用；action=drawing 对 STEP/IGES 源文件生成 HLR 多视图 SVG（线框工程图基础，不含尺寸链/GD&T）；action=generate 调用已配置的外部文生 3D 服务（默认关；mock 仅测试），生成 GLB 后走同一资产链。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['import', 'list', 'get', 'drawing', 'generate'] },
          sourcePath: { type: 'string', description: 'import/drawing：工作区相对路径（drawing 需 step/stp/iges/igs）' },
          name: { type: 'string', description: 'import/generate：资产名称' },
          prompt: { type: 'string', description: 'generate：文生 3D 提示词（3..1024 字）' },
          provenance: { type: 'object', additionalProperties: true, description: 'model/promptHash/parameters 等来源留痕' },
          query: { type: 'string', description: 'list：名称/路径/sha/model 检索' },
          limit: { type: 'integer', description: 'list 上限 ≤50' },
          assetId: { type: 'string', description: 'get：asset id 或 sha256' },
          views: { type: 'array', items: { type: 'string', enum: ['front', 'back', 'top', 'bottom', 'left', 'right', 'iso'] }, description: 'drawing：视图（缺省 front/top/right/iso）' },
          width: { type: 'integer', description: 'drawing：单视图宽度 px（120..1600）' },
          height: { type: 'integer', description: 'drawing：单视图高度 px（120..1600）' },
          showHidden: { type: 'boolean', description: 'drawing：是否画隐藏线（缺省 true）' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'model3d_bom',
      description: '用本地 Blender 网格报告生成 BOM/质量属性（CSV/MD/JSON + sha + manifest）：体积×密度→质量；要求 watertight 且 0 非流形边。密度可经节点 material.densityKgM3 或 scene.metadata.defaultDensityKgM3 声明，缺省 1000 kg/m³。',
      parameters: {
        type: 'object',
        properties: {
          scene,
          defaultDensityKgM3: { type: 'number', description: '缺省密度，默认 1000 kg/m³' },
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
          formats: { type: 'array', items: { type: 'string', enum: ['glb', 'stl', 'obj', 'fbx', 'usdz'] } },
          views: { type: 'array', items: { type: 'string', enum: [...RENDER_VIEWS] } },
        },
        required: ['recipeId'],
      },
    },
  },
];
