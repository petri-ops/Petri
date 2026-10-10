'use strict';

const path = require('path');
const pluginLoader = require('../plugin-loader');

// BLOCK-83 P4：demo 提示清单只保留中性夹具（生信插件的 demo 提示随领域包交付）。
const PROMPT_DEMO_FILES = {
  'sample-metrics': [
    ['samples', 'demo-samples.csv'],
  ],
};

function renderPluginDemoPathsForPrompt() {
  const lines = [];
  for (const [pluginId, inputs] of Object.entries(PROMPT_DEMO_FILES)) {
    const demoDir = pluginLoader.getDemoDataDir(pluginId);
    if (!demoDir) continue;
    const renderedInputs = inputs
      .map(([inputId, filename]) => `${inputId}=${path.join(demoDir, filename)}`)
      .join('，');
    lines.push(`  ${pluginId}: ${renderedInputs}`);
  }
  if (lines.length === 0) {
    return '\n- 用户要求使用 demo 数据时，先用 run_tool(op="list") 核对工具契约；不得猜测或拼接历史安装目录。';
  }
  return (
    '\n- 用户要求使用 demo 数据时，只能使用当前插件加载器解析出的路径：' +
    `\n${lines.join('\n')}` +
    '\n  不得拼接 ~/Documents/Petri-Local/plugins/<toolId> 等历史安装路径。'
  );
}

module.exports = { renderPluginDemoPathsForPrompt };
