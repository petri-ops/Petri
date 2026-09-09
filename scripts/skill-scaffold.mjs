#!/usr/bin/env node
/**
 * scripts/skill-scaffold.mjs — 产品 Skill 脚手架与校验器（BLOCK-71）
 *
 * 两种模式：
 *   --check                 校验 resources/skills/ 下全部内置 Skill（默认随 closeout 跑）
 *   --scaffold <id> --name <名称> [--category <c>] [--version <v>]
 *                           生成新 Skill 目录骨架（skill.json / README.md / manifest.json /
 *                           prompts/system.md），随后 skills:check 会因顶层 manifest
 *                           未登记而 FAIL —— 这是故意的 fail-closed 提醒。
 *
 * 校验范围（对齐真实消费方 core/shared-backend/skill-registry.js）：
 *   - skill.json 存在且可解析；核心校验单源复用 skill-registry 的 validateSkillManifest，
 *     不建第二套字段校验真相
 *   - id 与目录名一致；README.md 存在；prompts 引用的文件存在
 *   - 顶层 resources/skills/manifest.json 已登记且 version 一致（双向核对）
 *   - plugins.required/optional 引用的插件在 resources/built-in-plugins/ 真实存在
 *
 * 退出码：0 = 全部通过；1 = 存在校验失败；2 = 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'resources', 'skills');
const PLUGINS_DIR = path.join(ROOT, 'resources', 'built-in-plugins');

// 单源复用产品侧校验逻辑（skill-registry 同时服务 MCP skill_* 工具）
const { validateSkillManifest, isValidSkillId } = require(
  path.join(ROOT, 'core', 'shared-backend', 'skill-registry.js'),
);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function checkAll() {
  const problems = [];
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`skills 目录不存在: ${SKILLS_DIR}`);
    process.exit(1);
  }
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const topLevelManifest = readJson(path.join(SKILLS_DIR, 'manifest.json'));
  if (!topLevelManifest?.skills) problems.push('顶层 manifest.json 缺失或无 skills 字段');

  for (const dir of dirs) {
    const skillDir = path.join(SKILLS_DIR, dir);
    const label = `skills/${dir}`;

    const skill = readJson(path.join(skillDir, 'skill.json'));
    if (!skill) {
      problems.push(`${label}: skill.json 缺失或 JSON 非法`);
      continue;
    }
    if (skill.id !== dir) problems.push(`${label}: skill.json id "${skill.id}" 与目录名不一致`);

    const v = validateSkillManifest(skill);
    if (!v.ok) for (const e of v.errors) problems.push(`${label}: ${e}`);

    if (!fs.existsSync(path.join(skillDir, 'README.md'))) problems.push(`${label}: 缺 README.md`);

    for (const [key, rel] of Object.entries(skill.prompts || {})) {
      if (typeof rel !== 'string') continue;
      if (!fs.existsSync(path.join(skillDir, rel))) problems.push(`${label}: prompts.${key} 指向不存在的文件 ${rel}`);
    }

    // required = 硬依赖，必须是真实存在的内置插件；optional 允许 R 包能力名（如 enrichplot），不查存在性
    for (const pluginId of skill.plugins?.required || []) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginId)) continue;
      if (!fs.existsSync(path.join(PLUGINS_DIR, pluginId, 'tool-definition.json'))) {
        problems.push(`${label}: plugins.required 引用插件 "${pluginId}" 在 built-in-plugins 中不存在`);
      }
    }

    const registered = topLevelManifest?.skills?.[dir];
    if (!registered) {
      problems.push(`${label}: 未登记进顶层 manifest.json`);
    } else if (registered.version && skill.version && registered.version !== skill.version) {
      problems.push(`${label}: 顶层 manifest version ${registered.version} ≠ skill.json version ${skill.version}`);
    }
  }

  // 反向核对：顶层 manifest 里的 id 必须有对应目录
  for (const id of Object.keys(topLevelManifest?.skills || {})) {
    if (!dirs.includes(id)) problems.push(`顶层 manifest.json: skill "${id}" 无对应目录`);
  }

  if (problems.length) {
    console.log(`== 产品 Skill 校验: FAIL（${problems.length} 项）==`);
    for (const p of problems) console.log(`  ❌ ${p}`);
    process.exit(1);
  }
  console.log(`== 产品 Skill 校验: PASS（${dirs.length} 个内置 Skill）==`);
}

function scaffold(args) {
  const get = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const id = get('--scaffold') || get('--id');
  const name = get('--name');
  if (!id || !name) {
    console.error('用法: node scripts/skill-scaffold.mjs --scaffold <id> --name "<名称>" [--category <c>] [--version <v>]');
    process.exit(2);
  }
  if (!isValidSkillId(id)) {
    console.error(`非法 Skill id: ${id}（必须 kebab-case）`);
    process.exit(2);
  }
  const category = get('--category', 'bioinformatics/general');
  const version = get('--version', '1.0.0');
  const skillDir = path.join(SKILLS_DIR, id);
  if (fs.existsSync(skillDir)) {
    console.error(`目录已存在: ${skillDir}`);
    process.exit(2);
  }

  const kebabCaps = id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  fs.mkdirSync(path.join(skillDir, 'prompts', 'user'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify({
    skillManifestVersion: 1,
    id,
    name,
    version,
    description: `${name}（脚手架占位描述，收口前改写为真实能力说明）`,
    category,
    tags: [],
    source: 'built-in',
    capabilities: [],
    plugins: { required: [], optional: [] },
    workflows: { default: null, variants: [] },
    prompts: { system: 'prompts/system.md' },
    parameters: { required: [], optional: {} },
    outputs: { primary: [], secondary: [] },
    metadata: {
      author: 'Gewu Team',
      license: 'MIT',
      source: 'built-in',
      created: new Date().toISOString().slice(0, 10),
      updated: new Date().toISOString().slice(0, 10),
    },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(skillDir, 'README.md'),
    `# ${name}（${kebabCaps}）\n\n> 脚手架占位：在此写清本 Skill 的适用场景、输入约定与产出。\n\n- 状态：scaffold，未实现\n- 校验：\`npm run skills:check\`（登记进顶层 manifest 前会 FAIL，属预期 fail-closed）\n`);
  fs.writeFileSync(path.join(skillDir, 'prompts', 'system.md'),
    `# ${name} — system prompt 占位\n\n在此定义本 Skill 的系统提示词（角色、边界、失败语义）。\n`);
  fs.writeFileSync(path.join(skillDir, 'prompts', 'user', 'README.md'),
    '# user prompt 模板目录\n\n本 Skill 的用户侧 prompt 模板放这里（.md）。\n');

  console.log(`✅ 已生成骨架: ${skillDir}`);
  console.log('下一步（缺一不可）:');
  console.log(`  1. 在 resources/skills/manifest.json 的 skills 中登记 "${id}"（含 version ${version}）`);
  console.log(`  2. 改写 skill.json 占位描述 / README / prompts/system.md`);
  console.log(`  3. npm run skills:check 确认全绿`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--check')) return checkAll();
  if (argv.includes('--scaffold')) return scaffold(argv);
  console.error('用法: node scripts/skill-scaffold.mjs --check | --scaffold <id> --name "<名称>"');
  process.exit(2);
}

main();
