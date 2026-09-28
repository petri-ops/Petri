'use strict';

// BLOCK-92 Wave C-6 — R/Python 插件脚本执行主管线外迁（原 registry.js 679-1340，
// 纯搬运零行为变化）。db/plans 为 registry 运行时动态 require 的可空绑定，
// 经接缝参数传入（调用点同步穿参），函数体逐字未动。

const { execFile } = require('child_process');
const { publishJobTerminalState } = require('../../helpers/job-events');
const fs = require('fs');
const path = require('path');
const {
  captureStagedInputSnapshots,
  reconcileArtifactTruth,
} = require('../../helpers/artifact-truth');
const { checkAllowedDownstream } = require('../../agent-tools/agent-tool-policy');
const { createResultArchive } = require('../../helpers/result-archive');

const { createExecutionProvenance, attachProvenanceToResult } = require('../../../shared-backend/execution-provenance');
const { collectExecutionInputs, writeArtifactManifest } = require('../../../shared-backend/artifact-manifest');
const { resolveRLibsForPlugin } = require('../../../shared-backend/r-libs-resolver');
const { ensureBundlesForPlugin } = require('../../../shared-backend/capability-bundles');
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
  // resolveRLibsForPlugin readiness check below. Best-effort only: an
  // unpublished/unknown bundle (or any provisioning failure) MUST NOT fail the
  // job — resolveRLibsForPlugin simply won't find the lib and we run on the
  // base runtime, identical to today's behavior.
  if (plugin && plugin.language === 'r' && plugin.requiresBundle) {
    try {
      const ensureResult = await ensureBundlesForPlugin(plugin);
      if (ensureResult && !ensureResult.ok) {
        console.warn(
          `[mcp-registry] capability bundle(s) not ready for ${plugin.id}, running on base runtime:`,
          JSON.stringify(ensureResult.results)
        );
      }
    } catch (e) {
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
    const toolDef = pluginLoader.getToolDefinition(plugin.id);
    const stagedInputFiles = [];
    if (toolDef && Array.isArray(toolDef.inputs)) {
      for (const inp of toolDef.inputs) {
        if (inp.type !== 'file' || !inp.id) continue;
        const srcPath = args && args[inp.id];
        if (typeof srcPath !== 'string' || !fs.existsSync(srcPath)) continue;
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
    const finalizePluginRun = async (err, stdout, stderr) => {
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
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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

    execFile(
      runCmd[0],
      runCmd.slice(1),
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: runEnv },
      async (err, stdout, stderr) => {
        await finalizePluginRun(err, stdout, stderr);
      }
    );
  });
}

/**
 * BLOCK-57 — 插件工具远程直跑（同步预算内）：部署 agent → 探测运行时 →
 * 上传 bundle → detached start → 轮询节点真相 → 拉回产物 + sha256 对账。
 * 返回与本地 execFile 同形的 (err, stdout, stderr) 三元组，交由共用收尾。
 */

module.exports = { _runPluginScript };
