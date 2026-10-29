'use strict';

/**
 * helpers/model3d-recipes.js — NEXT-05 五类参数化 recipe（纯生成，不写盘/不渲染）。
 *
 * 每个 recipe 声明输入、默认值、输出 SceneSpec 与 task-spec/v1 验收；
 * 未建模的布尔孔、材料力学、制造公差必须进入 missingInfo，禁止假装完成。
 */

const scene3d = require('./scene3d');

const RECIPE_SCHEMA = 'model3d-recipe/v1';
const MAX_TABLE_ROWS = 40;

const RECIPES = [
  {
    id: 'box-enclosure',
    version: 1,
    title: '箱体外壳',
    description: '带正面端口凸台的长方体外壳示意。',
    inputs: {
      width: { type: 'number', default: 120, min: 20, max: 1000 },
      height: { type: 'number', default: 40, min: 10, max: 1000 },
      depth: { type: 'number', default: 80, min: 10, max: 1000 },
      portRadius: { type: 'number', default: 6, min: 0.5, max: 100 },
      portLength: { type: 'number', default: 8, min: 1, max: 100 },
    },
    build(params) {
      const width = numberParam(params, 'width', 120, 20, 1000);
      const height = numberParam(params, 'height', 40, 10, 1000);
      const depth = numberParam(params, 'depth', 80, 10, 1000);
      const portRadius = numberParam(params, 'portRadius', 6, 0.5, 100);
      const portLength = numberParam(params, 'portLength', 8, 1, 100);
      return {
        parameters: { width, height, depth, wall: 2, portRadius, portLength },
        nodes: [
          box('enclosure', 'width', 'depth', 'height', [0, 0, 0], '#4c78a8', '外壳主体'),
          cylinder('port', 'portRadius', 'portLength', [width / 2, 0, 0], [0, 90, 0], '#d29b42', '正面端口凸台'),
        ],
        constraints: [],
        acceptance: [
          `外壳包围盒 ${width} × ${depth} × ${height} mm（X × Y × Z）`,
          `端口位于 +X 面，半径 ${portRadius}mm，凸台长度 ${portLength}mm`,
          '网格报告需 watertight 且非流形边为 0',
        ],
        missingInfo: [
          '壁厚与内腔为参数占位，未做布尔抽壳',
          '端口是凸台示意，未做真实通孔/螺纹',
          '材料力学与制造公差未建模',
        ],
        goal: `生成 ${width}×${depth}×${height}mm 的带端口外壳 SceneSpec 并导出。`,
      };
    },
  },
  {
    id: 'bracket',
    version: 1,
    title: '安装支架',
    description: 'L 型底座 + 立板 + 加强筋与螺栓凸台示意。',
    inputs: {
      width: { type: 'number', default: 80, min: 20, max: 600 },
      depth: { type: 'number', default: 50, min: 10, max: 600 },
      thickness: { type: 'number', default: 6, min: 1, max: 40 },
      plateHeight: { type: 'number', default: 60, min: 10, max: 600 },
      bossRadius: { type: 'number', default: 5, min: 1, max: 30 },
    },
    build(params) {
      const width = numberParam(params, 'width', 80, 20, 600);
      const depth = numberParam(params, 'depth', 50, 10, 600);
      const thickness = numberParam(params, 'thickness', 6, 1, 40);
      const plateHeight = numberParam(params, 'plateHeight', 60, 10, 600);
      const bossRadius = numberParam(params, 'bossRadius', 5, 1, 30);
      const bosses = [
        [-width / 2 + bossRadius * 2, -depth / 2 + bossRadius * 2],
        [width / 2 - bossRadius * 2, -depth / 2 + bossRadius * 2],
      ];
      const nodes = [
        box('base', 'width', 'depth', 'thickness', [0, 0, thickness / 2], '#4c78a8', '底座'),
        box('plate', 'width', 'thickness', 'plateHeight', [0, depth / 2 - thickness / 2, thickness + plateHeight / 2], '#6a8caf', '立板'),
        box('gusset', width * 0.4, thickness, plateHeight * 0.5, [0, depth / 2 - thickness * 1.4, thickness + plateHeight * 0.25], '#557a9e', '加强筋'),
        ...bosses.map((position, index) => cylinder(
          `boss-${index + 1}`,
          'bossRadius',
          thickness * 1.6,
          [position[0], position[1], thickness * 1.8],
          [0, 0, 0],
          '#d29b42',
          `螺栓凸台 ${index + 1}`,
        )),
      ];
      return {
        parameters: { width, depth, thickness, plateHeight, bossRadius },
        nodes,
        constraints: [{ kind: 'align', a: 'base', b: 'plate', axis: 'x' }],
        acceptance: [
          `底座 ${width} × ${depth} × ${thickness}mm`,
          `立板高度 ${plateHeight}mm，与底座同宽`,
          `两个螺栓凸台半径 ${bossRadius}mm（凸台示意，非通孔）`,
          '网格报告需 watertight 且非流形边为 0',
        ],
        missingInfo: [
          '安装孔是凸台示意，未做布尔通孔',
          '加强筋为矩形近似，未做三角肋/倒角',
          '载荷、材料与安全系数未建模',
        ],
        goal: `生成 ${width}×${depth}、立板高 ${plateHeight}mm 的支架 SceneSpec。`,
      };
    },
  },
  {
    id: 'room-layout',
    version: 1,
    title: '房间布局',
    description: '地板 + 四面墙 + 桌/柜/设备体块布局。',
    inputs: {
      roomWidth: { type: 'number', default: 4000, min: 1000, max: 20000 },
      roomDepth: { type: 'number', default: 3000, min: 1000, max: 20000 },
      wallHeight: { type: 'number', default: 2800, min: 1000, max: 6000 },
      wallThickness: { type: 'number', default: 100, min: 20, max: 500 },
    },
    build(params) {
      const roomWidth = numberParam(params, 'roomWidth', 4000, 1000, 20000);
      const roomDepth = numberParam(params, 'roomDepth', 3000, 1000, 20000);
      const wallHeight = numberParam(params, 'wallHeight', 2800, 1000, 6000);
      const wallThickness = numberParam(params, 'wallThickness', 100, 20, 500);
      const nodes = [
        box('floor', 'roomWidth', 'roomDepth', 20, [0, 0, 10], '#4c78a8', '地板'),
        box('wall-north', 'roomWidth', 'wallThickness', 'wallHeight', [0, roomDepth / 2, wallHeight / 2], '#6a8caf', '北墙'),
        box('wall-south', 'roomWidth', 'wallThickness', 'wallHeight', [0, -roomDepth / 2, wallHeight / 2], '#6a8caf', '南墙'),
        box('wall-east', 'wallThickness', 'roomDepth', 'wallHeight', [roomWidth / 2, 0, wallHeight / 2], '#6a8caf', '东墙'),
        box('wall-west', 'wallThickness', 'roomDepth', 'wallHeight', [-roomWidth / 2, 0, wallHeight / 2], '#6a8caf', '西墙'),
        box('desk-1', roomWidth * 0.35, roomDepth * 0.18, 750, [-roomWidth * 0.18, 0, 375], '#d29b42', '工位桌'),
        box('cabinet-1', roomWidth * 0.15, roomDepth * 0.15, 1800, [roomWidth * 0.28, roomDepth * 0.28, 900], '#8aa36a', '设备柜'),
      ];
      return {
        parameters: { roomWidth, roomDepth, wallHeight, wallThickness },
        nodes,
        constraints: [],
        acceptance: [
          `房间内空约 ${roomWidth} × ${roomDepth}mm，墙高 ${wallHeight}mm`,
          '地板与四面墙均在边界内，Z 轴向上',
          '桌与柜不穿墙（包围盒在房间内）',
        ],
        missingInfo: [
          '门窗/通道净宽未建模',
          '家具细节与人体工学尺寸未建模',
          '照明、插座与设备散热未建模',
        ],
        goal: `生成 ${roomWidth}×${roomDepth}×${wallHeight}mm 房间与家具体块布局。`,
      };
    },
  },
  {
    id: 'experiment-rig',
    version: 1,
    title: '实验台架',
    description: '平台 + 容器 + 传感器 + 采样位置标注。',
    inputs: {
      platformWidth: { type: 'number', default: 600, min: 100, max: 3000 },
      platformDepth: { type: 'number', default: 400, min: 100, max: 3000 },
      platformHeight: { type: 'number', default: 20, min: 5, max: 200 },
      containerRadius: { type: 'number', default: 60, min: 5, max: 500 },
      containerHeight: { type: 'number', default: 120, min: 10, max: 1000 },
      sensorCount: { type: 'number', default: 3, min: 1, max: 8 },
    },
    build(params) {
      const platformWidth = numberParam(params, 'platformWidth', 600, 100, 3000);
      const platformDepth = numberParam(params, 'platformDepth', 400, 100, 3000);
      const platformHeight = numberParam(params, 'platformHeight', 20, 5, 200);
      const containerRadius = numberParam(params, 'containerRadius', 60, 5, 500);
      const containerHeight = numberParam(params, 'containerHeight', 120, 10, 1000);
      const sensorCount = Math.round(numberParam(params, 'sensorCount', 3, 1, 8));
      const sensors = Array.from({ length: sensorCount }, (_value, index) => {
        const angle = (Math.PI * 2 * index) / sensorCount;
        return box(
          `sensor-${index + 1}`,
          Math.max(8, containerRadius * 0.18),
          Math.max(8, containerRadius * 0.18),
          Math.max(8, containerRadius * 0.2),
          [Math.cos(angle) * containerRadius * 1.6, Math.sin(angle) * containerRadius * 1.6, platformHeight + Math.max(8, containerRadius * 0.2) / 2],
          '#8aa36a',
          `传感器 ${index + 1}`,
        );
      });
      return {
        parameters: { platformWidth, platformDepth, platformHeight, containerRadius, containerHeight, sensorCount },
        nodes: [
          box('platform', 'platformWidth', 'platformDepth', 'platformHeight', [0, 0, platformHeight / 2], '#4c78a8', '实验平台'),
          cylinder('container', 'containerRadius', 'containerHeight', [0, 0, platformHeight + containerHeight / 2], [0, 0, 0], '#6a8caf', '实验容器'),
          ...sensors,
        ],
        constraints: [],
        acceptance: [
          `平台 ${platformWidth} × ${platformDepth} × ${platformHeight}mm`,
          `容器半径 ${containerRadius}mm、高度 ${containerHeight}mm，位于平台中心`,
          `${sensorCount} 个传感器围绕容器均匀布置`,
        ],
        missingInfo: [
          '容器为实心圆柱示意，未做壁厚/液体体积',
          '传感器安装孔、线缆走向未建模',
          '采样位置只做体块标注，未做真实坐标标定',
        ],
        goal: `生成平台 + 容器 + ${sensorCount} 个传感器的实验台架 SceneSpec。`,
      };
    },
  },
  {
    id: 'from-table',
    version: 1,
    title: '表格驱动布局',
    description: 'CSV/表格行 → 有界箱体阵列（每行一个体块）。',
    inputs: {
      rows: { type: 'array', required: true, maxItems: MAX_TABLE_ROWS },
    },
    build(params) {
      const rows = Array.isArray(params.rows) ? params.rows : [];
      if (rows.length === 0) return { error: 'rows_required' };
      if (rows.length > MAX_TABLE_ROWS) return { error: 'rows_too_many' };
      const nodes = [];
      const missingInfo = [];
      for (const [index, row] of rows.entries()) {
        if (!row || typeof row !== 'object') return { error: 'row_invalid', row: index + 1 };
        const width = strictNumber(row.width, 0.1, 100000);
        const depth = strictNumber(row.depth, 0.1, 100000);
        const height = strictNumber(row.height, 0.1, 100000);
        if (![width, depth, height].every(Number.isFinite)) return { error: 'row_invalid', row: index + 1 };
        const x = strictNumber(row.x === undefined ? 0 : row.x, -1000000, 1000000);
        const y = strictNumber(row.y === undefined ? 0 : row.y, -1000000, 1000000);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: 'row_invalid', row: index + 1 };
        const label = typeof row.label === 'string' ? row.label.slice(0, 80) : `row-${index + 1}`;
        nodes.push(box(`row-${index + 1}`, width, depth, height, [x, y, height / 2], '#4c78a8', label));
      }
      return {
        parameters: { rowCount: rows.length },
        nodes,
        constraints: [],
        acceptance: [
          `${rows.length} 行表格全部生成体块（上限 ${MAX_TABLE_ROWS}）`,
          '每行 width/depth/height > 0，位置 x/y 为有限数值',
          '异常行必须显式报错，不得静默跳过',
        ],
        missingInfo: [
          '单位与列映射由调用方保证；本 recipe 只接受 mm',
          ...(missingInfo.length ? missingInfo : []),
        ],
        goal: `把 ${rows.length} 行表格数据生成为有界箱体阵列 SceneSpec。`,
      };
    },
  },
];

function numberParam(params, key, fallback, min, max) {
  const raw = params && typeof params === 'object' ? params[key] : undefined;
  const value = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() ? Number(raw) : NaN);
  const effective = Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(effective)) return NaN;
  return Math.min(max, Math.max(min, effective));
}

function strictNumber(value, min, max) {
  const numeric = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return NaN;
  return numeric;
}

function box(id, width, depth, height, position, color, label) {
  return {
    id,
    type: 'box',
    transform: { position, rotation: [0, 0, 0] },
    dimensions: { width, height, depth },
    material: { color, roughness: 0.65 },
    label,
  };
}

function cylinder(id, radius, height, position, rotation, color, label) {
  return {
    id,
    type: 'cylinder',
    transform: { position, rotation },
    dimensions: { radius, height },
    material: { color, roughness: 0.55 },
    label,
  };
}

function recipeSummaries() {
  return RECIPES.map((recipe) => ({
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
    description: recipe.description,
    inputs: recipe.inputs,
  }));
}

function findRecipe(recipeId) {
  return RECIPES.find((recipe) => recipe.id === recipeId) || null;
}

function buildRecipe(recipeId, params = {}) {
  const recipe = findRecipe(recipeId);
  if (!recipe) return { ok: false, error: 'recipe_not_found' };
  const built = recipe.build(params && typeof params === 'object' ? params : {});
  if (built.error) return { ok: false, ...built };
  const scene = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: built.parameters,
    nodes: built.nodes,
    constraints: built.constraints || [],
    metadata: {
      title: recipe.title,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      generatedAt: new Date().toISOString(),
    },
  };
  const validated = scene3d.validateSceneSpec(scene);
  if (!validated.ok) return { ok: false, error: 'recipe_scene_invalid', errors: validated.errors };
  const taskSpec = {
    version: 'task-spec/v1',
    taskType: 'modeling',
    goal: built.goal,
    deliverables: ['scene3d/v1 SceneSpec', 'GLB/STL/OBJ 导出', 'manifest 与网格报告'],
    constraints: built.acceptance.slice(0, 8),
    assumptions: ['单位为 mm，Z-up 右手系', `recipe=${recipe.id}@${recipe.version}`],
    acceptance: built.acceptance.slice(0, 8),
    missingInfo: built.missingInfo.slice(0, 8),
  };
  return {
    ok: true,
    schema: RECIPE_SCHEMA,
    recipe: { id: recipe.id, version: recipe.version, title: recipe.title },
    scene,
    stats: validated.stats,
    hash: scene3d.hashSceneSpec(scene),
    taskSpec,
    acceptance: built.acceptance,
    missingInfo: built.missingInfo,
  };
}

module.exports = {
  RECIPE_SCHEMA,
  MAX_TABLE_ROWS,
  recipeSummaries,
  buildRecipe,
  findRecipe,
};
