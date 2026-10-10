/**
 * shared-backend/index.js — barrel 导出 + 注入口
 *
 * 让 `require('shared-backend')` 真正可用（CLAUDE.md 声称的 barrel 之前不存在，
 * 断点1 补上）。同时聚合各子模块的 configure 注入点，调用方只需一次：
 *
 *   require('shared-backend').configure({
 *     getConfig: () => require('./config'),
 *     recordAiUsage: require('./helpers/ai-usage').recordAiUsage,
 *   });
 *
 * 斩断 shared-backend 对 petri-server 的反向 require（分仓前置；BLOCK-30 P1 起 py-server 已摘除）。
 */

const configHelper = require('./config-helper');
const aiUsageHelper = require('./ai-usage-helper');
const init = require('./init');

// configure 聚合：转发给 config-helper + ai-usage-helper + agent-workflow
function configure(provider) {
  if (!provider) return;
  if (provider.getConfig) configHelper.configure({ getConfig: provider.getConfig });
  if (provider.recordAiUsage) aiUsageHelper.configure({ recordAiUsage: provider.recordAiUsage });
  // A-003: inject projectHarnessWorkflowJob into agent-workflow (breaks shared-backend → petri-server reverse require)
  if (provider.projectHarnessWorkflowJob) {
    const { agentWorkflow } = module.exports;
    if (agentWorkflow && typeof agentWorkflow.configure === 'function') {
      agentWorkflow.configure({ projectHarnessWorkflowJob: provider.projectHarnessWorkflowJob });
    }
  }
}

module.exports = {
  configure,
  initSharedBackend: init.initSharedBackend,
  // 子模块直接导出（调用方可按需 require）
  logger: require('./logger'),
  errorLog: require('./error-log'),
  redaction: require('./redaction'),
  pathSafe: require('./path-safe'),
  executionContext: require('./execution-context'),
  agentWorkflow: require('./agent-workflow'),
  capabilityProvisioning: require('./capability-provisioning'),
  capabilityBundles: require('./capability-bundles'),
  scientificTaskSpec: require('./scientific-task-spec'),
  scientificTaskPlanner: require('./scientific-task-planner'),
  scientificTaskConfirmation: require('./scientific-task-confirmation'),
  executionProvenance: require('./execution-provenance'),
  deliveryManifest: require('./delivery-manifest'),
  scientificReplayPackage: require('./scientific-replay-package'),
  runtimeResourceSnapshot: require('./runtime-resource-snapshot'),
  artifactProfiles: require('./artifact-profiles'),
  resultStudioPluginSdk: require('./result-studio-plugin-sdk'),
  resultStudioLifecycle: require('./result-studio-lifecycle'),
  resultStudioQualification: require('./result-studio-qualification'),
  resultStudioEvidenceBundle: require('./result-studio-evidence-bundle'),
  g0Baseline: require('./g0-baseline'),
  g0TruthProjection: require('./g0-truth-projection'),
  g0DurableState: require('./g0-durable-state'),
  g0ScientificAccuracy: require('./g0-scientific-accuracy'),
  g0ReproducibilityLab: require('./g0-reproducibility-lab'),
  g0AdaptiveRuntime: require('./g0-adaptive-runtime'),
  g0ModelMemoryCost: require('./g0-model-memory-cost'),
  g0ObservableExperience: require('./g0-observable-experience'),
  g0CapabilitySupplyChain: require('./g0-capability-supply-chain'),
  g0SecurityPermission: require('./g0-security-permission'),
  g0ResilienceLab: require('./g0-resilience-lab'),
  executors: require('./executors'),
  storage: require('./storage'),
  llmProviders: require('./llm-providers'),
  // config-helper 也暴露（执行器/storage 内部改读它，Step 2）
  configHelper,
  aiUsageHelper,
  // Phase 2: Tool Registry (Gateway 数据源)
  toolRegistry: require('./tool-registry'),
  // Phase 1: Skill Registry (Skills 层注册与发现)
  skillRegistry: require('./skill-registry'),
};
