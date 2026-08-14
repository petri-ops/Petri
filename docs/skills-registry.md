# BioF3 Desktop Skills 注册与发现机制

> 状态：**设计稿**（待实现）
>
> 最后更新：2026-08-14
>
> 阅读前置：`docs/skills-architecture.md`（整体架构）、`docs/skills-schema.md`（Skill Schema）、`docs/third-party-plugin-guide.md`（Plugin 注册机制）

---

## 概述

本文档定义 Skills 的注册与发现机制，包括三来源发现路径、manifest 结构、与 MCP 工具的集成方式，以及优先级规则。

**设计原则**：
- 与 Plugin Registry 保持一致的三来源发现模式
- 支持 built-in / installed / marketplace 三种来源
- 与 MCP 工具发现无缝集成

---

## 1. 三来源发现

Skills 的发现遵循与 Plugins 相同的三来源模式：

| 来源 | 优先级 | 位置 | 用途 |
|------|--------|------|------|
| `built-in` | 10（最高） | `resources/skills/`（打包只读） | 随 app 打包的官方 Skills |
| `installed` | 20 | `USER_DATA_DIR/skills/` | 用户安装的 Skills |
| `marketplace` | 30 | 远程 manifest | 商店下载的 Skills |

### 1.1 来源说明

**built-in（内置）**
- 随 Electron app 打包
- 位于 `resources/skills/` 目录
- 只读，不可修改
- 最高优先级，已安装或市场版本不会覆盖

**installed（已安装）**
- 用户从市场安装的 Skills
- 位于 `USER_DATA_DIR/skills/`
- 可升级、卸载
- 优先级高于 marketplace

**marketplace（市场）**
- 远程 manifest 描述
- 首次使用时按需下载
- 缓存到 installed 目录
- 最低优先级，仅当本地无匹配时使用

---

## 2. manifest.json 结构

每个来源都有一个 `manifest.json` 文件描述可用的 Skills：

### 2.1 built-in manifest

位置：`resources/skills/manifest.json`

```json
{
  "manifestVersion": 1,
  "source": "built-in",
  "updated": "2026-08-14T00:00:00Z",
  "skills": {
    "deg-analysis-standard": {
      "id": "deg-analysis-standard",
      "version": "1.0.0",
      "source": "built-in",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": { "url": "built-in://skills/deg-analysis-standard", "sha256": null }
      },
      "capabilities": ["r-enrichment"],
      "plugins": { "required": ["deseq2", "volcano-plot"] }
    },
    "go-enrichment-full": {
      "id": "go-enrichment-full",
      "version": "1.0.0",
      "source": "built-in",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": { "url": "built-in://skills/go-enrichment-full", "sha256": null }
      },
      "capabilities": ["r-enrichment"],
      "plugins": { "required": ["go-kegg"] }
    },
    "wgcna-analysis": {
      "id": "wgcna-analysis",
      "version": "1.0.0",
      "source": "built-in",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": { "url": "built-in://skills/wgcna-analysis", "sha256": null }
      },
      "capabilities": ["r-wgcna"],
      "plugins": { "required": ["wgcna"] }
    }
  }
}
```

### 2.2 installed manifest

位置：`USER_DATA_DIR/skills/manifest.json`

```json
{
  "manifestVersion": 1,
  "source": "installed",
  "updated": "2026-08-14T10:30:00Z",
  "skills": {
    "custom-deg-pipeline": {
      "id": "custom-deg-pipeline",
      "version": "1.2.0",
      "source": "installed",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": { "url": "file://./custom-deg-pipeline", "sha256": "abc123..." }
      },
      "capabilities": [],
      "plugins": { "required": ["deseq2", "custom-normalizer"] }
    }
  }
}
```

### 2.3 marketplace manifest

远程 `manifest.json` 示例（`https://marketplace.biof3.com/skills/manifest.json`）：

```json
{
  "manifestVersion": 1,
  "source": "marketplace",
  "updated": "2026-08-14T08:00:00Z",
  "skills": {
    "single-cell-trajectory": {
      "id": "single-cell-trajectory",
      "version": "2.1.0",
      "source": "marketplace",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": { 
          "url": "https://cdn.biof3.com/skills/single-cell-trajectory/2.1.0/macos-arm64.tar.gz",
          "sha256": "def456...",
          "sizeBytes": 15728640
        }
      },
      "capabilities": ["python-scanpy"],
      "plugins": { "required": ["monocle3"] }
    },
    "spatial-transcriptomics": {
      "id": "spatial-transcriptomics",
      "version": "1.0.0",
      "source": "marketplace",
      "kind": "skill",
      "artifacts": {
        "macos-arm64": {
          "url": "https://cdn.biof3.com/skills/spatial-transcriptomics/1.0.0/macos-arm64.tar.gz",
          "sha256": "ghi789...",
          "sizeBytes": 20971520
        }
      },
      "capabilities": ["python-seurat"],
      "plugins": { "required": ["seurat", "spatial-viz"] }
    }
  }
}
```

---

## 3. Skill Registry 实现

### 3.1 注册表 API

```typescript
// core/shared-backend/skill-registry.js

interface SkillEntry {
  id: string;              // 唯一标识
  name: string;            // 显示名称
  version: string;         // 版本
  source: string;          // 来源
  category: string;        // 分类
  tags: string[];          // 标签
  description: string;     // 描述
  capabilities: string[]; // 依赖能力
  plugins: {              // 依赖插件
    required: string[];
    optional: string[];
  };
  manifest: SkillManifest; // 完整 Manifest
}

class SkillRegistry {
  // 发现与加载
  discoverSkills(): SkillEntry[];
  loadSkill(id: string): SkillManifest;
  
  // 查询
  listSkills(filter?: SkillFilter): SkillEntry[];
  getSkill(id: string): SkillEntry | null;
  findSkills(query: string): SkillEntry[];
  getSkillsByCategory(category: string): SkillEntry[];
  getSkillsByTag(tag: string): SkillEntry[];
  getSkillsByPlugin(pluginId: string): SkillEntry[];
  
  // 安装/卸载
  installSkill(id: string, version?: string): Promise<SkillEntry>;
  uninstallSkill(id: string): Promise<void>;
  updateSkill(id: string): Promise<SkillEntry>;
  
  // 验证
  validateSkillManifest(manifest: SkillManifest): ValidationResult;
  
  // 状态
  getInstalledSkills(): SkillEntry[];
  getUpdateAvailable(): SkillEntry[];
}
```

### 3.2 发现流程

```javascript
// 发现所有 Skills
function discoverSkills() {
  const skills = [];
  
  // 1. 加载 built-in Skills（最高优先级）
  const builtInManifest = loadManifest('resources/skills/manifest.json');
  for (const [id, info] of Object.entries(builtInManifest.skills)) {
    skills.push(loadBuiltInSkill(id, info));
  }
  
  // 2. 加载 installed Skills
  const installedManifest = loadManifest(`${USER_DATA_DIR}/skills/manifest.json`);
  for (const [id, info] of Object.entries(installedManifest.skills)) {
    // 跳过已被 built-in 占用的
    if (!skills.find(s => s.id === id)) {
      skills.push(loadInstalledSkill(id, info));
    }
  }
  
  // 3. marketplace Skills（仅注册发现，不下载）
  const marketplaceManifest = loadRemoteManifest(MARKETPLACE_URL);
  for (const [id, info] of Object.entries(marketplaceManifest.skills)) {
    // 跳过本地已有的
    if (!skills.find(s => s.id === id)) {
      skills.push(createMarketplaceEntry(id, info));
    }
  }
  
  return skills;
}
```

### 3.3 安装流程

```javascript
// 安装 Skill
async function installSkill(id, version) {
  // 1. 获取 marketplace manifest
  const marketplace = loadRemoteManifest(MARKETPLACE_URL);
  const skillInfo = marketplace.skills[id];
  
  if (!skillInfo) {
    throw new Error(`Skill not found in marketplace: ${id}`);
  }
  
  // 2. 下载并校验
  const targetVersion = version || skillInfo.version;
  const artifact = skillInfo.artifacts[currentPlatform];
  
  await downloadAndVerify(artifact.url, artifact.sha256);
  
  // 3. 解压到 installed 目录
  const destDir = `${USER_DATA_DIR}/skills/${id}/`;
  await extract(artifact.url, destDir);
  
  // 4. 更新 installed manifest
  updateInstalledManifest(id, skillInfo);
  
  // 5. 返回已安装的 Skill
  return loadInstalledSkill(id, skillInfo);
}
```

---

## 4. 与 MCP 工具的集成

### 4.1 MCP 工具定义

```javascript
// src/mcp-server.js 新增工具

const skillTools = {
  name: "biof3_skills",
  description: "BioF3 Desktop Skills 管理与执行",
  tools: [
    {
      name: "list_skills",
      description: "列出所有可用的 Skills",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          tag: { type: "string" },
          source: { type: "string", enum: ["built-in", "installed", "marketplace"] }
        }
      }
    },
    {
      name: "get_skill",
      description: "获取 Skill 详细信息",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" }
        },
        required: ["id"]
      }
    },
    {
      name: "run_skill",
      description: "执行 Skill",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          params: { type: "object" },
          workflow: { type: "string" }
        },
        required: ["id"]
      }
    },
    {
      name: "install_skill",
      description: "从市场安装 Skill",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          version: { type: "string" }
        },
        required: ["id"]
      }
    },
    {
      name: "search_skills",
      description: "搜索 Skills",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    }
  ]
};
```

### 4.2 工具处理器

```javascript
// MCP 工具处理器

async function handleListSkills(request) {
  const { category, tag, source } = request.params;
  const registry = new SkillRegistry();
  
  let skills = registry.listSkills();
  
  if (category) {
    skills = skills.filter(s => s.category === category);
  }
  if (tag) {
    skills = skills.filter(s => s.tags.includes(tag));
  }
  if (source) {
    skills = skills.filter(s => s.source === source);
  }
  
  return {
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
      source: s.source,
      category: s.category,
      description: s.description
    }))
  };
}

async function handleRunSkill(request) {
  const { id, params, workflow } = request.params;
  const registry = new SkillRegistry();
  
  const skill = registry.getSkill(id);
  if (!skill) {
    throw new Error(`Skill not found: ${id}`);
  }
  
  // 执行 Skill
  const skillRuntime = new SkillRuntime(skill);
  const result = await skillRuntime.execute(params, { workflow });
  
  return {
    skill_id: id,
    artifacts: result.artifacts,
    outputs: result.outputs,
    execution_time: result.duration
  };
}
```

---

## 5. 优先级规则

### 5.1 同 ID 多来源

当多个来源提供相同 ID 的 Skill 时：

| 优先级 | 来源 | 行为 |
|--------|------|------|
| 1（最高） | built-in | 使用 built-in 版本，不允许覆盖 |
| 2 | installed | 使用 installed 版本，可卸载 |
| 3（最低） | marketplace | 永不自动安装，需用户确认 |

**规则**：
- built-in Skill 独占，installed/marketplace 无法替换
- installed Skill 可升级到 marketplace 新版本
- marketplace Skill 按需下载，缓存后视为 installed

### 5.2 版本选择

```javascript
function resolveVersion(id, requestedVersion) {
  // 1. 优先使用 built-in
  const builtIn = getBuiltInSkill(id);
  if (builtIn) {
    return builtIn.version;
  }
  
  // 2. 检查 installed
  const installed = getInstalledSkill(id);
  if (installed) {
    if (!requestedVersion) {
      return installed.version;
    }
    if (requestedVersion === installed.version) {
      return installed.version;
    }
    // 有新版本可用
    return checkMarketplaceVersion(id, requestedVersion);
  }
  
  // 3. marketplace
  return requestedVersion || getLatestMarketplaceVersion(id);
}
```

---

## 6. Skill Runtime 实现

### 6.1 执行器

```javascript
// core/shared-backend/skill-runtime.js

class SkillRuntime {
  constructor(skillManifest) {
    this.skill = skillManifest;
    this.workflowRuntime = new WorkflowRuntime();
    this.pluginRegistry = new PluginRegistry();
  }
  
  async execute(params, options = {}) {
    const { workflow: workflowName } = options;
    const workflow = this.resolveWorkflow(workflowName);
    
    // 1. 验证参数
    this.validateParams(params);
    
    // 2. 检查依赖就绪
    await this.checkDependencies();
    
    // 3. 执行 Workflow
    const result = await this.workflowRuntime.run(workflow, params);
    
    // 4. 应用恢复策略（如果需要）
    if (result.status === 'failed') {
      const recoveryResult = await this.applyRecovery(result.error);
      if (recoveryResult.recovered) {
        return recoveryResult.result;
      }
    }
    
    // 5. 聚合结果
    return this.aggregateResults(result);
  }
  
  validateParams(params) {
    const { required, optional } = this.skill.parameters;
    
    // 检查必填参数
    for (const param of required) {
      if (!(param in params)) {
        throw new Error(`Missing required parameter: ${param}`);
      }
    }
    
    // 合并默认可选参数
    for (const [key, spec] of Object.entries(optional)) {
      if (!(key in params)) {
        params[key] = spec.default;
      }
    }
    
    // 类型校验
    for (const [key, value] of Object.entries(params)) {
      const spec = this.getParamSpec(key);
      if (spec && !this.validateType(value, spec)) {
        throw new Error(`Invalid type for parameter ${key}`);
      }
    }
  }
  
  async checkDependencies() {
    const capabilities = this.skill.capabilities || [];
    const capabilityProvisioning = new CapabilityProvisioning();
    
    for (const cap of capabilities) {
      const ready = await capabilityProvisioning.checkReady(cap);
      if (!ready) {
        await capabilityProvisioning.provision(cap);
      }
    }
  }
  
  async applyRecovery(error) {
    const strategies = this.skill.recovery_strategies || [];
    
    for (const strategy of strategies) {
      if (error.code === strategy.when && strategy.recoverable) {
        try {
          const result = await this.executeRecovery(strategy, error);
          return { recovered: true, result };
        } catch (e) {
          // 尝试下一个策略
          continue;
        }
      }
    }
    
    return { recovered: false, error };
  }
}
```

---

## 7. 目录结构

```
USER_DATA_DIR/
└── skills/
    ├── manifest.json              # 已安装 Skills 清单
    ├── deg-analysis-standard/     # Skill 目录
    │   ├── skill.json            # Manifest
    │   ├── prompts/              # Prompt 模板
    │   ├── workflows/            # Workflow 定义
    │   └── cache/                # 缓存数据
    └── wgcna-analysis/
        ├── skill.json
        ├── prompts/
        └── workflows/
```

---

## 8. 缓存与更新

### 8.1 缓存策略

| 内容 | 缓存位置 | 过期策略 |
|------|----------|----------|
| marketplace manifest | `USER_DATA_DIR/skills/.cache/manifest.json` | 24 小时 |
| marketplace metadata | `USER_DATA_DIR/skills/.cache/metadata/` | 24 小时 |
| downloaded skill | `USER_DATA_DIR/skills/<id>/` | 永久（直到卸载） |

### 8.2 更新检查

```javascript
async function checkForUpdates() {
  const localManifest = loadInstalledManifest();
  const remoteManifest = await loadRemoteManifest(MARKETPLACE_URL);
  
  const updates = [];
  
  for (const [id, remoteInfo] of Object.entries(remoteManifest.skills)) {
    const localInfo = localManifest.skills[id];
    
    if (!localInfo) continue;
    
    if (semver.gt(remoteInfo.version, localInfo.version)) {
      updates.push({
        id,
        current: localInfo.version,
        available: remoteInfo.version
      });
    }
  }
  
  return updates;
}
```

---

## 9. 验收标准

### 9.1 功能验收

```bash
# 列出所有 Skills
curl http://localhost:3002/api/skills

# 按分类筛选
curl http://localhost:3002/api/skills?category=bioinformatics/ngs

# 按标签搜索
curl http://localhost:3002/api/skills?tag=deg

# 获取 Skill 详情
curl http://localhost:3002/api/skills/deg-analysis-standard

# 搜索 Skills
curl http://localhost:3002/api/skills/search?q=differential+expression

# 安装 Skill
curl -X POST http://localhost:3002/api/skills/install \
  -d '{"id": "single-cell-trajectory"}'

# 检查更新
curl http://localhost:3002/api/skills/updates
```

### 9.2 门禁

```bash
# 验证 manifest 合规
npm run skills:check -- --manifest resources/skills/manifest.json

# 验证所有 Skills
npm run skills:check

# 回归测试
node --test test/skill-registry.test.mjs
```
