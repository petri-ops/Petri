const taskQueue = require('../task-queue');
const taskStore = require('../task-store');

const VALID_R_TASK_TYPES = [
  'scrna_standard',
  'recluster',
  'deg',
  'enrichment',
  'cell_annotation',
  'scrna_integration',
  'trajectory',
  'communication',
  'cell_cycle',
  'doublet',
];

async function enforceMonthlyAnalysisLimit(req, res) {
  if (!req.user || req.user.role === 'admin') return true;

  const db = require('../db');
  const user = await db.getUserByIdAsync(req.user.id);
  const maxMonth = (user && user.max_analyses_month) || 50;
  const thisMonth = new Date().toISOString().slice(0, 7) + '-01';
  const count = await db.countAnalysesForUserSinceAsync(req.user.id, thisMonth);

  if (count >= maxMonth) {
    res
      .status(429)
      .json({
        status: 'error',
        error: '本月分析次数已达上限（' + maxMonth + ' 次/月）。请联系管理员提升额度。',
      });
    return false;
  }
  return true;
}

function syncPlanStepFromTask(taskId) {
  setImmediate(async () => {
    try {
      const db = require('../db');
      const analysis = await db.getAnalysisByTaskIdAsync(taskId);
      if (analysis) {
        const { syncPlanStepStatusFromAnalysisAsync } = require('../helpers/plans');
        await syncPlanStepStatusFromAnalysisAsync(analysis.id, analysis.status, analysis.error);
      }
    } catch {}
  });
}

module.exports = function registerTaskRoutes(app) {
  /**
   * POST /api/task — Submit a new R analysis task.
   * ECS platform enqueues into PostgreSQL; Dell workers claim and execute.
   */
  app.post('/api/task', async (req, res) => {
    if (!(await enforceMonthlyAnalysisLimit(req, res))) return;

    const { type, ossInputUrl, params, parentTaskId } = req.body;

    if (!type) {
      return res.status(400).json({ status: 'error', error: '缺少 type 参数' });
    }
    if (!VALID_R_TASK_TYPES.includes(type)) {
      return res
        .status(400)
        .json({
          status: 'error',
          error: `不支持的任务类型: ${type}，支持: ${VALID_R_TASK_TYPES.join(', ')}`,
        });
    }
    if (!ossInputUrl) {
      return res.status(400).json({ status: 'error', error: '缺少 ossInputUrl（数据文件地址）' });
    }

    try {
      console.log(
        '[DEBUG /api/task]',
        JSON.stringify({
          type,
          parentTaskId,
          hasCellIds: !!(params && params.cellIds),
          nCells: params?.cellIds?.length,
        })
      );
      const result = taskQueue.submitTask({ type, params, ossInputUrl, parentTaskId });
      res.json({ status: 'ok', taskId: result.taskId, taskStatus: result.status });
    } catch (err) {
      res.status(500).json({ status: 'error', error: err.message });
    }
  });

  /**
   * GET /api/task/:id — Poll task status.
   */
  app.get('/api/task/:id', (req, res) => {
    try {
      syncPlanStepFromTask(req.params.id);
    } catch {}

    const task = taskStore.publicTask(taskStore.getTask(req.params.id));
    if (!task) {
      return res.status(404).json({ status: 'error', error: '任务不存在' });
    }
    res.json({ status: 'ok', task });
  });

  /**
   * GET /api/tasks — List recent tasks.
   */
  app.get('/api/tasks', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 20;
    const taskList = taskStore.listTasks(limit).map(taskStore.publicTask);
    res.json({ status: 'ok', tasks: taskList });
  });
};
