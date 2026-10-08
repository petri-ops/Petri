'use strict';

// BLOCK-92 Wave C-6 — R/Python 插件脚本执行主管线外迁（原 registry.js 679-1340，
// 纯搬运零行为变化）。db/plans 为 registry 运行时动态 require 的可空绑定，
// 经接缝参数传入（调用点同步穿参），函数体逐字未动。

const { execFile } = require('child_process');
const { publishJobTerminalState } = require('../../helpers/job-events');
const { decodeRDeparseManifest } = require('../../../shared-backend/r-deparse-decode');
const {
  armActiveToolJobLifecycle,
  claimActiveToolJob,
  clearActiveToolJobLifecycleTimers,
  releaseActiveToolJob,
} = require('../../helpers/tools-executor/active-job');
const { resolveLifecycleDurations } = require('../../helpers/process-lifecycle');
const { activeToolJobs, countActiveUserToolJobs, notifyScheduler } = require('../../helpers/tool-job-lifecycle-registry');
// 装置层（心跳/硬超时）直接走 better-sqlite3 原句柄；db 参数是高层模块。
let lifecycleDb = null;
try {
  lifecycleDb = require('../../db').db || null;
} catch { /* db 模块不可用时装置退化为无心跳（硬超时仍生效，error 面已 catch） */ }
const fs = require('fs');
const path = require('path');
const {
  captureStagedInputSnapshots,
  reconcileArtifactTruth,
} = require('../../helpers/artifact-truth');
const { checkAllowedDownstream } = require('../../agent-tools/agent-tool-policy');
const { createResultArchive } = require('../../helpers/result-archive');
const { validateDomainUploads } = require('../../helpers/upload-domain-validation');

const { createExecutionProvenance, attachProvenanceToResult } = require('../../../shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../../../shared-backend/artifact-manifest');
const { resolveRLibsForPlugin } = require('../../../shared-backend/r-libs-resolver');
const { ensureBundlesForPlugin, formatRequiredBundleFailure } = require('../../../shared-backend/capability-bundles');
const { R_SERVER, SHARED_BACKEND } = require('./runtime-paths');
const { _normalizeArtifacts, _resolveStagedInputPath } = require('./artifact-normalize');
const pluginLoader = require(path.join(R_SERVER, 'plugin-loader.js'));

async function _runPluginScript(
  db,
  plans,
  plugin,
  scriptPath,
  args,
  userId = 'agent',
  projectId = null,
  existingToolJobId = null,
  resultStudioInputLineage = null,
  conversationId = null,
  seams = {}
) {
  // BLOCK-92 Wave C-6 补全（2026-09-20 Mac p4r-baseline 抓真）：拆分时
  // registry.js 私有函数未穿参，插件作业执行必 ReferenceError。
  // seam 契约=调用方（registry.js）注入；缺失即 fail-closed。
  const { resolveJobLayout, createMcpExecutionContext, runPluginToolRemote } = seams;
  // Stage 3 B2 part2: auto-provision required capability bundle(s) before
  // assembling R_LIBS_USER, so a freshly-downloaded bundle is visible to the
  // resolveRLibsForPlugin readiness check below.
  // BLOCK-146 #9：requiresBundle 声明即插件必需依赖（ensureBundlesForPlugin 语义
  // ——声明列表全量视作 required，当前无 optional 形态）。必需 bundle 未就绪
  // （unknown/unpublished/provision_failed/…）不再 warn 后裸跑 base runtime——
  // 审视发现 #9：那会让作业最终以晦涩的 R library 报错收场且无归因。改为把
  // {bundleId, status, error} + 可行动中文指引（formatRequiredBundleFailure 单源）
  // 并入 job 失败文案 fail-fast。await 必须先于 Promise 构造（executor 不可
  // async），结果经闭包传入——job 建档后立即落 failed，历史与 plan 同步可见。
  let requiredBundleFailureText = null;
  if (plugin && plugin.language === 'r' && plugin.requiresBundle) {
    try {
      const ensureResult = await ensureBundlesForPlugin(plugin);
      if (ensureResult && !ensureResult.ok) {
        requiredBundleFailureText = formatRequiredBundleFailure(plugin.id, ensureResult);
        console.warn(
          `[mcp-registry] capability bundle(s) not ready for ${plugin.id}, failing the job:`,
          JSON.stringify(ensureResult.results)
        );
      }
    } catch (e) {
      requiredBundleFailureText = `执行失败: capability bundle 预检异常（${plugin.id}）: ${e.message}`;
      console.warn(`[mcp-registry] ensureBundlesForPlugin failed for ${plugin.id}:`, e.message);
    }
  }
  return new Promise((resolve) => {
    // Phase 3: 先创建/准备正式 tool_job，再以 tool_job.id 创建物理目录。
    // 方案 C（agent-led Task 1）：跑前建 tool_jobs 记录，跑完更新状态。
    // user_id 用调用方传入的 userId（agent 登录态下跑 = 真实用户 id，
    // 这样用户能在 history 看到，客户端能按 jobId 加载）。
    let toolJobId = existingToolJobId || null;
    if (db) {
      // BLOCK-128：并发准入与 HTTP 路径同语义——每用户 pending+running 超上限
      // 即拒绝（429 max_concurrent 契约字样保持一致），不再绕过装置独跑。
      const maxConcurrent = Number(process.env.BIOF3_TOOL_MAX_CONCURRENT || 2);
      if (Number.isFinite(maxConcurrent) && maxConcurrent > 0
        && countActiveUserToolJobs(lifecycleDb, userId) >= maxConcurrent) {
        return resolve({
          content: [{ type: 'text', text: `执行失败: 已达每用户并发上限（max_concurrent=${maxConcurrent}，pending+running 计入）。请等待在途作业完成或取消后再试。` }],
          isError: true,
        });
      }
      try {
        if (existingToolJobId) {
          const existing = typeof db.getToolJob === 'function' ? db.getToolJob(existingToolJobId) : null;
          const existingProjectId = existing && (existing.project_id || existing.projectId || null);
          const existingConversationId = existing && (existing.conversation_id || existing.conversationId || null);
          const existingUserId = existing && (existing.user_id || existing.userId || null);
          if (!existing
              || existingUserId !== userId
              || (existing.tool_id || existing.toolId) !== plugin.id
              || existingProjectId !== (projectId || null)
              || existingConversationId !== (conversationId || null)) {
            throw new Error('tool_job_identity_mismatch');
          }
        }
        const job = existingToolJobId
          ? db.prepareToolJobForRun(existingToolJobId, {
              toolName: plugin.id,
              projectId,
              conversationId,
              params: args,
              name: `${plugin.id} via agent`,
            })
          : db.createToolJob({
              toolId: plugin.id,
              userId,
              params: args,
              status: 'running',
              name: `${plugin.id} via agent`,
              projectId,
              conversationId,
            });
        if (!job || !job.id) throw new Error('tool_job_create_failed');
        toolJobId = job && job.id;
      } catch (e) {
        console.warn('[mcp-registry] prepare/create toolJob failed:', e.message);
        const failureLabel = existingToolJobId ? '身份校验失败' : '持久化校验失败';
        return resolve({
          content: [{ type: 'text', text: `执行失败: tool_job ${failureLabel}: ${e.message}` }],
          isError: true,
          ...(existingToolJobId ? { toolJobId: existingToolJobId } : {}),
        });
      }
    }

    // BLOCK-146 #9：必需 bundle 未就绪 → 建档后立即失败（历史可见 + plan 步骤
    // 归因同步），不派生脚本进程。
    if (requiredBundleFailureText) {
      const errText = requiredBundleFailureText;
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
          publishJobTerminalState(toolJobId, 'failed');
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
    }

    // Phase 3: 以 tool_job.id 作为物理目录主键（项目沙盒或全局 tool-jobs）。
    let jobDir;
    let outputDir;
    try {
      if (typeof resolveJobLayout !== 'function') {
        throw new Error('mcp_job_layout_seam_missing');
      }
      const layout = resolveJobLayout({ toolJobId, projectId, userId });
      jobDir = layout.jobDir;
      outputDir = layout.outputDir;
    } catch (e) {
      // 有 projectId 但解析失败（不存在/归档/无权限/不可写）→ 硬失败，不静默写全局。
      const errText = `执行失败: 项目结果目录解析失败: ${e.message}`;
      console.warn('[mcp-registry] resolveProjectRunLayout failed:', e.message);
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
          publishJobTerminalState(toolJobId, 'failed');
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
    }

    // 1. 写 params.json（脚本从 args[1]=jobDir 读它）。
    // BLOCK-57：executionTargetId 为会话保留键（composer/模型显式指定），剥离后
    // 不进脚本参数面；仅在远程分派分支消费。
    const sessionExecutionTargetId = args && typeof args.executionTargetId === 'string' && args.executionTargetId.trim()
      ? args.executionTargetId.trim()
      : null;
    const scriptParams = { ...(args || {}) };
    if (sessionExecutionTargetId) delete scriptParams.executionTargetId;
    fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(scriptParams));

    // 1b. file 类型输入：复制文件到 jobDir/<input_id>。
    // BioF3 工具脚本有两种读文件约定：
    //   (a) volcano-plot: 从 params$deg_table 读绝对路径
    //   (b) deseq2: list.files(job_dir, pattern="^counts") 在 jobDir 找文件
    // 为兼容两者，file input 既保留在 params（路径），又复制到 jobDir/<id>。
    // 复刻 tools-executor.js:572-578 的 files 写入约定（文件名 = input id）。
    // BLOCK-146 #4：required file 输入路径不存在 → fail-fast（此前静默 continue
    // 裸跑，脚本侧以晦涩的读文件报错收场、agent 无归因）；非 required 输入
    // 维持跳过（可选输入合法回退语义不变）。
    const toolDef = pluginLoader.getToolDefinition(plugin.id);
    const stagedInputFiles = [];
    if (toolDef && Array.isArray(toolDef.inputs)) {
      for (const inp of toolDef.inputs) {
        if (inp.type !== 'file' || !inp.id) continue;
        const srcPath = args && args[inp.id];
        if (typeof srcPath !== 'string' || !fs.existsSync(srcPath)) {
          if (inp.required) {
            const shownPath = typeof srcPath === 'string'
              ? srcPath
              : `<未提供（收到 ${srcPath === undefined ? 'undefined' : typeof srcPath} 类型）>`;
            const errText = `执行失败: 输入 ${inp.id} 路径不存在: ${shownPath}（需本地绝对路径）`;
            if (db && toolJobId) {
              try {
                db.updateToolJob(toolJobId, {
                  status: 'failed',
                  error: errText,
                  completedAt: Date.now(),
                });
                publishJobTerminalState(toolJobId, 'failed');
                if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
              } catch {}
            }
            return resolve({
              content: [{ type: 'text', text: errText }],
              isError: true,
              toolJobId,
            });
          }
          continue;
        }
        // 文件名 = input id（+ 原扩展名），deseq2 的 list.files("^counts") 才能命中。
        // Descriptor id is still untrusted plugin data, so contain it before writing.
        const staged = _resolveStagedInputPath(jobDir, inp.id, srcPath);
        if (!staged.ok) {
          const errText = `执行失败: 插件文件输入定义无效 (${staged.error})`;
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: errText,
                completedAt: Date.now(),
              });
              publishJobTerminalState(toolJobId, 'failed');
            } catch {}
          }
          return resolve({
            content: [{ type: 'text', text: errText }],
            isError: true,
            toolJobId,
          });
        }
        fs.copyFileSync(srcPath, staged.stagedPath);
        stagedInputFiles.push(staged.stagedPath);
      }
    }

    // 1c. BLOCK-146 B 轨（审视发现 #7）：域校验主路径化——暂存进 jobDir 的
    // file 型输入与 HTTP 上传路径（tools-executor.js handleToolRun，BLOCK-131）
    // 同源过 validateDomainUploads（单源复用，规则体零复制）。此前域校验只在
    // HTTP multipart 直跑路径触发，agent run_tool（MCP/会话）与 UI 表单链
    // （AnalysisLaunchPanel 组装 prompt → 会话 → run_tool → 本函数）不触发，
    // 小数 counts 被脚本静默 round 后出假成功。识别=单源模块的文件名约定
    // （暂存名=<input_id><原扩展名>，即「在册插件输入白名单」起版；deseq2 的
    // counts/coldata 命中，deg_table 等非域命名不做域校验不虚构）。findings
    // 非空 → 中文 fail-closed（带文件名+规则名，UI-457 同源消息体），失败
    // 形态与 #4/#9 一致：job failed + plans 同步 + 不派生脚本进程。
    const domainFindings = validateDomainUploads(
      jobDir,
      stagedInputFiles.map((stagedPath) => path.basename(stagedPath))
    ).findings;
    if (domainFindings.length > 0) {
      const errText = `执行失败: 输入数据域校验未通过（${domainFindings
        .map((finding) => `${finding.code}｜${finding.message}`)
        .join('；')}）——请修正上述输入文件后重试`;
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
          publishJobTerminalState(toolJobId, 'failed');
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
    }
    let stagedInputSnapshots;
    try {
      stagedInputSnapshots = captureStagedInputSnapshots(stagedInputFiles);
    } catch (error) {
      const errText = `执行失败: 暂存输入快照失败 (${error.message})`;
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            completedAt: Date.now(),
          });
          publishJobTerminalState(toolJobId, 'failed');
        } catch {}
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        toolJobId,
      });
    }

    // 2. 复制脚本到 jobDir（run-script.R），避免污染插件原脚本目录
    const scriptExt = plugin.language === 'r' ? '.R' : '.py';
    const runScript = path.join(jobDir, 'run-script' + scriptExt);
    fs.copyFileSync(scriptPath, runScript);

    // 2b. R 工具：复制 _biof3-theme.R 到 jobDir（脚本顶部 source 它）。
    // 复刻 tools-executor.js:361-374：插件脚本目录优先（build-plugin.sh 已复制），
    // 其次 biof3-server/tool-scripts/。漏这步会导致 source("_biof3-theme.R") 找不到文件。
    if (plugin.language === 'r') {
      const helperSearchDirs = [
        path.dirname(scriptPath), // 插件 scripts/ 目录
        path.join(R_SERVER, 'tool-scripts'), // 内置工具脚本目录
      ];
      for (const dir of helperSearchDirs) {
        const src = path.join(dir, '_biof3-theme.R');
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(jobDir, '_biof3-theme.R'));
          break;
        }
      }
    }

    // Keep report generation identical to the HTTP executor: plugin report
    // templates are copied into the isolated job directory under the stable
    // name consumed by tool scripts.
    const reportTemplate = path.join(plugin.pluginDir, plugin.id + '-report-template.html');
    if (fs.existsSync(reportTemplate)) {
      fs.copyFileSync(reportTemplate, path.join(jobDir, 'report-template.html'));
    }

    // 3. 构造执行命令（local 模式）
    const { getExecutor } = require(path.join(SHARED_BACKEND, 'executors'));
    const executor = getExecutor(plugin.language);
    const runtimeReady =
      executor && executor.binPath
        ? { runtime: plugin.language || null, ready: true, command: executor.binPath, reason: null }
        : {
            runtime: plugin.language || null,
            ready: false,
            command: null,
            reason: `未找到 ${plugin.language || 'unknown'} 执行器`,
          };
    const runtimeVersion = runtimeReady.ready && typeof executor.getRuntimeVersion === 'function'
      ? executor.getRuntimeVersion()
      : null;
    const { context: initialExecutionContext, canonicalizePath } = createMcpExecutionContext({
      jobDir,
      outputDir,
      runtime: plugin.language || null,
      runtimeCommand: executor && executor.binPath,
      runtimeReady,
    });
    const provenanceFor = ({ artifacts = [], command = null, startedAt: provenanceStartedAt = null, completedAt = new Date().toISOString() } = {}) => {
      const scientificTask = db && toolJobId && typeof db.getScientificTaskByToolJob === 'function'
        ? db.getScientificTaskByToolJob(toolJobId)
        : null;
      const provenance = createExecutionProvenance({
        toolJobId,
        projectId,
        scientificTask,
        plugin: pluginLoader.getPluginManifest(plugin.id) || plugin,
        params: args || {},
        inputs: collectExecutionInputs({
          inputDefinitions: toolDef && Array.isArray(toolDef.inputs) ? toolDef.inputs : [],
          params: args || {},
          jobDir,
          inputLineage: resultStudioInputLineage,
        }),
        runtime: { name: plugin.language || null, command: executor && executor.binPath, version: runtimeVersion, ready: runtimeReady.ready },
        runScriptPath: runScript,
        command,
        artifacts,
        startedAt: provenanceStartedAt,
        completedAt,
      });
      const provenancePath = path.join(jobDir, 'provenance.json');
      fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2));
      return { provenance, provenancePath };
    };
    if (!runtimeReady.ready) {
      const errText = `执行失败: ${runtimeReady.reason}`;
      const failedProvenance = provenanceFor();
      if (db && toolJobId) {
        try {
          db.updateToolJob(toolJobId, {
            status: 'failed',
            error: errText,
            resultJson: {
              toolJobId,
              jobDir,
              outputDir,
              canonicalJobDir: canonicalizePath(jobDir),
              canonicalOutputDir: canonicalizePath(outputDir),
              execution: initialExecutionContext,
              tool: {
                id: plugin.id,
                version: plugin.version || null,
                language: plugin.language || null,
              },
              failure: { phase: 'runtime', reason: runtimeReady.reason },
              executionProvenance: failedProvenance.provenance,
              provenanceRef: { provenanceHash: failedProvenance.provenance.provenanceHash, path: failedProvenance.provenancePath, toolJobId },
            },
            completedAt: Date.now(),
          });
          publishJobTerminalState(toolJobId, 'failed');
          if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
        } catch (e) {
          console.warn('[mcp-registry] updateToolJob(runtime failed) failed:', e.message);
        }
      }
      return resolve({
        content: [{ type: 'text', text: errText }],
        isError: true,
        _jobDir: jobDir,
        toolJobId,
      });
    }
    let runCmd;
    let runEnv = undefined;
    if (plugin.language === 'r') {
      runCmd = [executor.binPath, runScript, jobDir];
      // 插件包注入 R_LIBS_USER（provisioned bundle → pluginDir/packages/r → R home）。
      // 三段式组装逻辑抽到 shared-backend/r-libs-resolver.js（与 tools-executor.js 共用）。
      const resolvedEnv = resolveRLibsForPlugin(plugin);
      if (resolvedEnv) runEnv = resolvedEnv;
    } else {
      // Harness Python 插件与 R 插件统一使用第一个位置参数传 job_dir。
      // 旧的 --params 约定属于 FigCode/非插件执行，不得混入插件协议。
      runCmd = [executor.binPath, runScript, jobDir];
      const spawnCmd = executor.buildSpawnCommand(runScript, jobDir, args || {});
      if (spawnCmd.env) runEnv = spawnCmd.env;
    }

    // 4. 执行 — BLOCK-10 S-001: enforce plugin → downstream side-effect
    // policy at the execFile boundary. Plugins may only spawn their
    // declared runner (Rscript / python); chaining into `shell` is
    // refused here so a malicious plugin cannot bypass commandVerdict.
    const downstream = plugin && plugin.language === 'r'
      ? 'r-runner'
      : (plugin && plugin.language === 'python') ? 'python-runner' : 'shell';
    if (!checkAllowedDownstream({ allowedDownstream: ['r-runner', 'python-runner'] }, downstream)) {
      return resolve({
        ok: false,
        error: 'policy_denied',
        message: 'Plugin execution path is not whitelisted for downstream side effects.',
      });
    }
    const startedAt = new Date().toISOString();
    // BLOCK-57：插件执行收尾统一入口——本地 execFile 与远程直跑共用同一条
    // 产物/清单/状态落库链路（Artifact Truth 单一真相）。
    const finalizePluginRun = async (err, stdout, stderr, cancelEvidence = null) => {
        // BLOCK-128-①（BLOCK-141 清尾转绿）——取消分类先于失败/artifact 校验分支。
        // 与本地执行链 finalizeJobRun 入口检查同语义（tools-executor.js:1086 flag /
        // :1090 durable）：取消击杀链（killLocalToolJob→requestActiveToolJobCancellation
        // 置位 flag→SIGTERM，active-job.js:69 为全仓唯一写入点，硬超时走 timedOut
        // 不串线）与取消路由 durable 落库（routes/tools-platform.js:97-112）之间
        // child close 先到时，finalize 按取消收敛，不再落 failed/"Required artifact"
        // 误分类（实机两种交错均出现：acceptance/block-128/acceptance-live.json 与
        // heartbeat-timeline.txt）。判据双通道 = kill 来源（release 前捕获的 flag）+
        // durable 取消标记（跨进程可见）；取消 API 语义零改动。
        let durableCancelled = false;
        if (db && toolJobId && typeof db.getToolJob === 'function') {
            try {
                const row = db.getToolJob(toolJobId);
                durableCancelled = !!(row && row.status === 'cancelled');
            } catch { /* 行读取失败按无 durable 标记处理（kill flag 通道仍在） */ }
        }
        const cancelKillConfirmed = !!(cancelEvidence && cancelEvidence.killFlag);
        if (cancelKillConfirmed || durableCancelled) {
            const cancelledResult = {
                toolJobId,
                jobDir,
                outputDir,
                tool: { id: plugin.id, version: plugin.version || null, language: plugin.language || null },
                status: 'cancelled',
                cancellation: {
                    classifiedBy: cancelKillConfirmed ? 'cancel_kill_flag' : 'durable_cancelled_mark',
                    killSignal: (err && err.signal)
                        || (cancelEvidence && cancelEvidence.terminationResult && cancelEvidence.terminationResult.signal)
                        || null,
                    exitCode: err ? (err.code ?? null) : null,
                },
                execution: initialExecutionContext,
                stdout: String(stdout || '').slice(-2000),
            };
            if (db && toolJobId) {
                try {
                    db.updateToolJob(toolJobId, {
                        status: 'cancelled',
                        resultJson: cancelledResult,
                        completedAt: Date.now(),
                    });
                    publishJobTerminalState(toolJobId, 'cancelled');
                    if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'cancelled');
                } catch (e) {
                    console.warn('[mcp-registry] updateToolJob(cancelled) failed:', e.message);
                }
            }
            notifyScheduler();
            console.log('[mcp-registry] Job ' + toolJobId + ' cancellation confirmed by finalize (kill/durable race window)');
            return resolve({
                content: [{ type: 'text', text: JSON.stringify(cancelledResult) }],
                isError: false,
                _jobDir: jobDir,
                toolJobId,
            });
        }
        if (err) {
          const errText = `执行失败: ${err.killed ? '超时（>300s）' : stderr || err.message}\n\nSTDOUT:\n${stdout || ''}`;
          const blockedManifestPath = [
            path.join(outputDir, 'artifact-manifest.json'),
            path.join(jobDir, 'artifact-manifest.json'),
          ].find((candidate) => fs.existsSync(candidate));
          let blockedManifest = null;
          if (blockedManifestPath) {
            try {
              const parsed = JSON.parse(fs.readFileSync(blockedManifestPath, 'utf8'));
              if (parsed && parsed.status === 'blocked') blockedManifest = parsed;
            } catch (manifestError) {
              console.warn('[mcp-registry] blocked artifact manifest parse failed:', manifestError.message);
            }
          }
          const failedProvenance = provenanceFor({
            command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
          });
          const structuredFailureMode = blockedManifest?.failureMode || null;
          const failureResult = {
            toolJobId,
            jobDir,
            outputDir,
            tool: { id: plugin.id, version: plugin.version || null, language: plugin.language || null },
            status: blockedManifest ? 'blocked' : 'failed',
            failureMode: structuredFailureMode,
            manifest: blockedManifest,
            failure: {
              phase: blockedManifest ? 'plugin_validation' : 'execution',
              reason: structuredFailureMode || (err.killed ? 'timeout' : 'nonzero_exit'),
              exitCode: err.code ?? null,
              stderr: String(stderr || '').slice(-2000),
              stdout: String(stdout || '').slice(-2000),
            },
            executionProvenance: failedProvenance.provenance,
            provenanceRef: { provenanceHash: failedProvenance.provenance.provenanceHash, path: failedProvenance.provenancePath, toolJobId },
          };
          // 失败：更新 tool_jobs 状态
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: errText,
                resultJson: failureResult,
                completedAt: Date.now(),
              });
              publishJobTerminalState(toolJobId, 'failed');
              // 同步 plan step 状态（方案 C，agent-led Task 2）
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', errText);
            } catch (e) {
              console.warn('[mcp-registry] updateToolJob(failed) failed:', e.message);
            }
          }
          return resolve({
            content: [{ type: 'text', text: JSON.stringify(failureResult) }],
            isError: true,
            _jobDir: jobDir,
            toolJobId,
          });
        }
        // 5. 读 manifest.json + 列输出文件。
        // 产物位置有两种约定：(a) output/ 子目录（deseq2，tools-executor 标准）
        // (b) jobDir 根（volcano-plot 等独立插件脚本，setwd(jobDir) 后直接写）。
        // 先查 output/，再查 jobDir 根。
        const manifestCandidates = [
          path.join(outputDir, 'manifest.json'),
          path.join(outputDir, 'artifact-manifest.json'),
          path.join(jobDir, 'manifest.json'),
          path.join(jobDir, 'artifact-manifest.json'),
        ];
        const manifestPath = manifestCandidates.find((candidate) => fs.existsSync(candidate)) || manifestCandidates[0];
        const resultDir = path.dirname(manifestPath);
        const runtimeToolDefinition = pluginLoader.getToolDefinition(plugin.id) || {};
        const archiveArtifact = Array.isArray(runtimeToolDefinition.outputs)
          ? runtimeToolDefinition.outputs.find((item) => item && item.id === 'zip' && item.required !== false)
          : null;
        if (archiveArtifact) {
          try {
            await createResultArchive(
              resultDir,
              archiveArtifact.filename || archiveArtifact.name || 'all_results.zip'
            );
          } catch (archiveError) {
            return resolve({
              content: [{ type: 'text', text: `执行失败: 结果归档失败: ${archiveError.message}` }],
              isError: true,
              _jobDir: jobDir,
              toolJobId,
            });
          }
        }
        let manifest = null;
        try {
          if (fs.existsSync(manifestPath)) {
            manifest = decodeRDeparseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); // BLOCK-133：R deparse <U+XXXX> 解码
          }
        } catch {}
        // manifest 有两种格式：(a) {outputs:[{id,filename,...}]} (b) {files:[{name,type,...}]}
        const manifestItems = Array.isArray(manifest?.artifacts)
          ? manifest.artifacts
          : Array.isArray(manifest?.outputs)
            ? manifest.outputs
            : Array.isArray(manifest?.files)
              ? manifest.files
              : [];
        const outFiles = fs.existsSync(resultDir)
          ? fs
              .readdirSync(resultDir, { withFileTypes: true })
              .filter(
                (entry) =>
                  entry.isFile() &&
                  ![
                    'params.json',
                    'run-script.R',
                    'run-script.py',
                    '_biof3-theme.R',
                    'report-template.html',
                  ].includes(entry.name)
              )
              .map((entry) => entry.name)
          : [];
        const { context: executionContext } = createMcpExecutionContext({
          jobDir,
          outputDir,
          resultDir,
          runtime: plugin.language || null,
          runtimeCommand: executor && executor.binPath,
          runtimeReady,
        });
        const artifacts = _normalizeArtifacts({
          manifestItems,
          outFiles,
          resultDir,
          canonicalizePath,
        });
        const rawSummary = {
          toolJobId,
          jobDir,
          outputDir,
          resultDir,
          canonicalJobDir: canonicalizePath(jobDir),
          canonicalOutputDir: canonicalizePath(outputDir),
          canonicalResultDir: canonicalizePath(resultDir),
          execution: executionContext,
          tool: {
            id: plugin.id,
            version: plugin.version || null,
            language: plugin.language || null,
          },
          artifactSchemaVersion: 1,
          artifacts,
          outputs: manifestItems.map((o) => ({
            ...o,
            path: path.join(resultDir, o.filename || o.name || ''),
            canonicalPath: canonicalizePath(path.join(resultDir, o.filename || o.name || '')),
          })),
          files: artifacts.map((artifact) => ({
            name: artifact.name,
            filename: artifact.filename,
            type: artifact.type,
            label: artifact.label,
            title: artifact.title,
            path: artifact.path,
            canonicalPath: artifact.canonicalPath,
          })),
          manifest: manifest,
          stdout: (stdout || '').slice(-2000),
        };
        const toolDefinition = runtimeToolDefinition;
        const truth = reconcileArtifactTruth({
          result: rawSummary,
          resultDir,
          expectedArtifacts: Array.isArray(toolDefinition.outputs) ? toolDefinition.outputs : [],
          canonicalizePath,
          excludedArtifactPaths: stagedInputFiles,
          stagedInputSnapshots,
        });
        const successfulProvenance = provenanceFor({
          artifacts: truth.artifacts,
          command: { executable: runCmd[0], args: runCmd.slice(1), cwd: jobDir },
          startedAt,
        });
        const provenance = successfulProvenance.provenance;
        const provenancePath = successfulProvenance.provenancePath;
        const summary = attachProvenanceToResult(truth.result, provenance, provenancePath);
        writeArtifactManifest({
          outputDir: resultDir,
          result: summary,
          provenance,
          plugin: pluginLoader.getPluginManifest(plugin.id) || plugin,
        });
        if (truth.blocking) {
          const truthError =
            truth.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.message)
              .join('; ') || 'Required result artifacts are missing.';
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'failed',
                error: truthError,
                resultJson: summary,
                completedAt: Date.now(),
              });
              publishJobTerminalState(toolJobId, 'failed');
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'failed', truthError);
            } catch (e) {
              console.warn(
                '[mcp-registry] updateToolJob(artifact validation failed) failed:',
                e.message
              );
            }
          }
          return resolve({
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
            isError: true,
            _jobDir: jobDir,
            toolJobId,
          });
        }
        // 成功：更新 tool_jobs 状态 + 写 result_json
        if (db && toolJobId) {
          try {
            db.updateToolJob(toolJobId, {
              status: 'completed',
              resultJson: summary,
              completedAt: Date.now(),
            });
            publishJobTerminalState(toolJobId, 'completed');
            // 同步 plan step 状态（方案 C，agent-led Task 2）
            if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'completed');
          } catch (e) {
            console.warn('[mcp-registry] updateToolJob(completed) failed:', e.message);
          }
        }
        resolve({
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          isError: false,
          _jobDir: jobDir,
          toolJobId,
        });
    };

    // BLOCK-57：会话执行目标 → 远程直跑。对话内插件工具的本地语义本就是同步
    // 执行（≤300s），远程沿用同一预算：提交 → 轮询节点真相 → 拉回对账 →
    // 共用收尾。超预算：尽力取消节点侧作业并诚实失败（不悬挂模型回合）。
    if (sessionExecutionTargetId) {
      return (async () => {
        // 远程分派前重写 file 型输入为 jobDir 内文件名（bundled copy 命名约定：
        // <input_id><原扩展名>，与 1b 拷贝步骤一致）。启发式：字符串参数值指向
        // 本机真实存在的文件 → 即为 bundled 输入（不依赖 tool-definition 声明，
        // 部分 插件 的 inputs 为空数组）。脚本侧 cwd=jobDir，绝对本地路径在节点上
        // 不存在（macOS 路径 ≠ Linux 路径）。
        try {
          const rewritten = { ...scriptParams };
          for (const [key, value] of Object.entries(rewritten)) {
            if (typeof value === 'string' && value.trim()) {
              try {
                if (path.isAbsolute(value) && fs.existsSync(value) && fs.statSync(value).isFile()) {
                  rewritten[key] = key + path.extname(value);
                }
              } catch {}
            }
          }
          fs.writeFileSync(path.join(jobDir, 'params.json'), JSON.stringify(rewritten));
        } catch (e) {
          console.warn('[mcp-registry] remote file-input rewrite failed:', e.message);
        }
        const remoteOutcome = await runPluginToolRemote({
          sessionExecutionTargetId,
          jobDir,
          plugin,
          language: plugin.language,
          toolJobId,
          startedAt,
          budgetMs: 280000,
          resolve,
          plans,
          outputDir,
        });
        // BLOCK-76 P3 — 直跑终态：ssh 作业 result_json 直记服务器真值（已由
        // runPluginToolSshDirect 持久化），不经本地 finalizePluginRun、无拉回。
        if (remoteOutcome.directSummary) {
          if (db && toolJobId) {
            try {
              db.updateToolJob(toolJobId, {
                status: 'completed',
                resultJson: remoteOutcome.directSummary,
                completedAt: Date.now(),
              });
              publishJobTerminalState(toolJobId, 'completed');
              if (plans) plans.syncPlanStepStatusFromToolJob(toolJobId, 'completed');
            } catch (e) {
              console.warn('[mcp-registry] direct summary persistence failed:', e.message);
            }
          }
          resolve({
            content: [{ type: 'text', text: JSON.stringify(remoteOutcome.directSummary, null, 2) }],
            isError: false,
            _jobDir: jobDir,
            toolJobId,
          });
          return undefined;
        }
        const finalizeErr = remoteOutcome.err;
        await finalizePluginRun(finalizeErr, remoteOutcome.stdout, remoteOutcome.stderr);
        if (!finalizeErr && remoteOutcome.executionTarget) {
        try {
          const provPath = path.join(jobDir, 'provenance.json');
          if (fs.existsSync(provPath)) {
            const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'));
            prov.executionTarget = remoteOutcome.executionTarget;
            fs.writeFileSync(provPath, JSON.stringify(prov, null, 2));
          }
          } catch (e) {
            console.warn('[mcp-registry] executionTarget provenance merge failed:', e.message);
          }
        }
        return undefined;
      })();
    }

    // BLOCK-128（PL-1 执行语义统一）：本地 execFile 路径并入共享 owner 装置
    // ——claim 登记进进程级 activeToolJobs（心跳/硬超时/僵尸扫描/取消链与
    // HTTP 异步路径同装置），execFile 内建 300s 退役（timeout: 0），硬预算
    // 统一走 BIOF3_TOOL_HARD_TIMEOUT_MS（默认 30min）。
    const owner = claimActiveToolJob(activeToolJobs, { jobId: toolJobId, toolId: plugin.id });
    if (!owner) {
      return resolve({
        content: [{ type: 'text', text: `执行失败: tool_job ${toolJobId} 已有在途执行登记（重入拒绝）。` }],
        isError: true,
        toolJobId,
      });
    }
    const child = execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 0, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      async (err, stdout, stderr) => {
        // BLOCK-141：release 前捕获取消击杀证据——cancelRequested 挂在共享装置的
        // owner 上，release 后即不可达；finalize 据此做取消分类（见 finalizePluginRun
        // 入口注释）。硬超时（timedOut）/外部击杀不置此 flag，分类不受影响。
        const cancelEvidence = {
          killFlag: owner.cancelRequested === true,
          terminationResult: owner.lastTerminationResult || null,
        };
        clearActiveToolJobLifecycleTimers(owner);
        releaseActiveToolJob(activeToolJobs, toolJobId, owner);
        await finalizePluginRun(err, stdout, stderr, cancelEvidence);
      }
    );
    owner.process = child;
    const { hardTimeoutMs, heartbeatIntervalMs } = resolveLifecycleDurations();
    armActiveToolJobLifecycle({
      active: owner,
      jobId: toolJobId,
      db: lifecycleDb,
      heartbeatIntervalMs,
      hardTimeoutMs,
    });
  });
}

/**
 * BLOCK-57 — 插件工具远程直跑（同步预算内）：部署 agent → 探测运行时 →
 * 上传 bundle → detached start → 轮询节点真相 → 拉回产物 + sha256 对账。
 * 返回与本地 execFile 同形的 (err, stdout, stderr) 三元组，交由共用收尾。
 */

module.exports = { _runPluginScript };
